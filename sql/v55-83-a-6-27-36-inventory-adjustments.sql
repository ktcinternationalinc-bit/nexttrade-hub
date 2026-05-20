-- v55.83-A.6.27.36 — Inventory Phase 1 Build 4.5: Adjustments (qty / transfer / cost)
--
-- Adds:
--   1. inventory_adjustments table — one row per adjustment with type + reason + audit
--   2. inventory_movements.transfer_pair_id — links paired transfer_out / transfer_in movements
--   3. consume_layers_fifo() SQL function — atomically decrements oldest open layers for a (product, warehouse, qty)
--   4. apply_quantity_adjustment() — wraps consume + creates adjustment row + movements
--   5. apply_warehouse_transfer() — consumes source layers, creates dest layer, paired movements
--   6. apply_cost_adjustment() — updates layer cost + records the restatement

-- ─── inventory_adjustments table ─────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_adjustments (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adjustment_type          text NOT NULL,
  adjustment_date          date NOT NULL DEFAULT CURRENT_DATE,

  -- What
  product_id               uuid NOT NULL REFERENCES inventory_products(id) ON DELETE RESTRICT,
  source_warehouse_id      uuid REFERENCES inv_warehouses(id) ON DELETE RESTRICT,
  destination_warehouse_id uuid REFERENCES inv_warehouses(id) ON DELETE RESTRICT,
  quantity                 numeric,
  uom                      text,

  -- Cost-restatement-specific fields
  source_layer_id          uuid REFERENCES inventory_layers(id) ON DELETE SET NULL,
  old_cost_per_uom         numeric,
  new_cost_per_uom         numeric,

  -- Linkage
  transfer_pair_id         uuid,                 -- groups paired transfer_out + transfer_in rows
  reference_number         text,

  -- Reason + notes (reason required)
  reason                   text NOT NULL,
  notes                    text,

  -- Audit
  created_by               uuid,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_by               uuid,
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_adjustment_type CHECK (adjustment_type IN (
    'quantity_increase',   -- positive adjustment (found stock / counting under-report)
    'quantity_decrease',   -- negative adjustment (damage, theft, counting over-report)
    'warehouse_transfer',  -- move from one warehouse to another
    'cost_restatement'     -- restate cost on a specific layer
  )),
  CONSTRAINT chk_adj_uom CHECK (uom IS NULL OR uom IN ('kg','meter','yard','roll','piece','liter','sqm'))
);

CREATE INDEX IF NOT EXISTS idx_adjustments_type             ON inventory_adjustments (adjustment_type);
CREATE INDEX IF NOT EXISTS idx_adjustments_date             ON inventory_adjustments (adjustment_date);
CREATE INDEX IF NOT EXISTS idx_adjustments_product          ON inventory_adjustments (product_id);
CREATE INDEX IF NOT EXISTS idx_adjustments_source_wh        ON inventory_adjustments (source_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_adjustments_destination_wh   ON inventory_adjustments (destination_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_adjustments_transfer_pair    ON inventory_adjustments (transfer_pair_id) WHERE transfer_pair_id IS NOT NULL;

CREATE OR REPLACE FUNCTION update_inventory_adjustments_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_adjustments_updated_at ON inventory_adjustments;
CREATE TRIGGER trigger_adjustments_updated_at
BEFORE UPDATE ON inventory_adjustments
FOR EACH ROW EXECUTE FUNCTION update_inventory_adjustments_updated_at();

ALTER TABLE inventory_adjustments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inv_adjustments_read  ON inventory_adjustments;
CREATE POLICY inv_adjustments_read  ON inventory_adjustments FOR SELECT USING (true);
DROP POLICY IF EXISTS inv_adjustments_write ON inventory_adjustments;
CREATE POLICY inv_adjustments_write ON inventory_adjustments FOR ALL USING (true) WITH CHECK (true);

-- ─── inventory_movements: add transfer_pair_id ──────────────────
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS transfer_pair_id uuid;
CREATE INDEX IF NOT EXISTS idx_movements_transfer_pair ON inventory_movements (transfer_pair_id) WHERE transfer_pair_id IS NOT NULL;

-- ─── FIFO consumption helper ────────────────────────────────────
-- Walks open layers for (product, warehouse) oldest-first, decrementing
-- qty_remaining until p_qty is satisfied. Returns the total cost consumed
-- (sum of consumed_qty × cost_per_uom across each layer touched). Raises
-- if insufficient stock. Each layer touched gets a movement row tying back.

CREATE OR REPLACE FUNCTION consume_layers_fifo(
  p_product_id      uuid,
  p_warehouse_id    uuid,
  p_qty             numeric,
  p_movement_type   text,        -- 'sale', 'adjustment_out', 'transfer_out'
  p_movement_date   date,
  p_adjustment_id   uuid,
  p_transfer_pair   uuid,
  p_reference       text,
  p_notes           text,
  p_user_id         uuid
) RETURNS numeric AS $$
DECLARE
  v_remaining_to_consume numeric := p_qty;
  v_total_cost numeric := 0;
  v_layer RECORD;
  v_consume_from_layer numeric;
  v_uom text;
  v_currency text;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'consume_layers_fifo: quantity must be > 0 (got %)', p_qty;
  END IF;

  FOR v_layer IN
    SELECT * FROM inventory_layers
    WHERE product_id = p_product_id
      AND (warehouse_id = p_warehouse_id OR (warehouse_id IS NULL AND p_warehouse_id IS NULL))
      AND status = 'open'
      AND qty_remaining > 0
    ORDER BY receipt_date ASC, created_at ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining_to_consume <= 0;

    v_consume_from_layer := LEAST(v_layer.qty_remaining, v_remaining_to_consume);
    v_uom := v_layer.uom;
    v_currency := v_layer.cost_currency;

    -- Decrement the layer
    UPDATE inventory_layers SET
      qty_remaining = qty_remaining - v_consume_from_layer,
      status = CASE WHEN qty_remaining - v_consume_from_layer <= 0 THEN 'closed' ELSE 'open' END,
      updated_at = now()
    WHERE id = v_layer.id;

    -- Record movement for the slice consumed from this layer
    INSERT INTO inventory_movements (
      movement_type, movement_date, product_id, warehouse_id,
      quantity, uom, cost_per_uom, cost_currency, total_cost,
      source_layer_id, source_adjustment_id, transfer_pair_id,
      reference_number, notes, created_by
    ) VALUES (
      p_movement_type, p_movement_date, p_product_id, p_warehouse_id,
      -v_consume_from_layer, v_uom, v_layer.cost_per_uom, v_currency, -(v_consume_from_layer * v_layer.cost_per_uom),
      v_layer.id, p_adjustment_id, p_transfer_pair,
      p_reference, p_notes, p_user_id
    );

    v_total_cost := v_total_cost + (v_consume_from_layer * v_layer.cost_per_uom);
    v_remaining_to_consume := v_remaining_to_consume - v_consume_from_layer;
  END LOOP;

  IF v_remaining_to_consume > 0 THEN
    RAISE EXCEPTION 'Insufficient stock: requested %, short by % for product=% warehouse=%',
      p_qty, v_remaining_to_consume, p_product_id, p_warehouse_id;
  END IF;

  RETURN v_total_cost;
END;
$$ LANGUAGE plpgsql;

-- ─── apply_quantity_adjustment() ─────────────────────────────────
-- Increase: creates an adjustment row + adjustment_in movement. No layer creation
-- (quantity-only adjustments don't introduce new cost basis — they're treated as
-- corrections to an existing stock count).
-- Decrease: creates adjustment row + consumes FIFO layers via consume_layers_fifo.

CREATE OR REPLACE FUNCTION apply_quantity_adjustment(
  p_product_id      uuid,
  p_warehouse_id    uuid,
  p_quantity        numeric,         -- positive number; direction determined by p_direction
  p_direction       text,            -- 'increase' or 'decrease'
  p_uom             text,
  p_reason          text,
  p_notes           text,
  p_user_id         uuid,
  p_adjustment_date date
) RETURNS uuid AS $$
DECLARE
  v_adj_id uuid;
  v_adj_type text;
  v_movement_type text;
  v_signed_qty numeric;
  v_cost_consumed numeric;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'apply_quantity_adjustment: quantity must be > 0';
  END IF;
  IF p_direction NOT IN ('increase','decrease') THEN
    RAISE EXCEPTION 'apply_quantity_adjustment: direction must be "increase" or "decrease"';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'apply_quantity_adjustment: reason required';
  END IF;

  v_adj_type := CASE WHEN p_direction = 'increase' THEN 'quantity_increase' ELSE 'quantity_decrease' END;
  v_movement_type := CASE WHEN p_direction = 'increase' THEN 'adjustment_in' ELSE 'adjustment_out' END;
  v_signed_qty := CASE WHEN p_direction = 'increase' THEN p_quantity ELSE -p_quantity END;

  INSERT INTO inventory_adjustments (
    adjustment_type, adjustment_date, product_id,
    source_warehouse_id, quantity, uom,
    reason, notes, created_by, updated_by
  ) VALUES (
    v_adj_type, COALESCE(p_adjustment_date, CURRENT_DATE), p_product_id,
    p_warehouse_id, p_quantity, p_uom,
    p_reason, p_notes, p_user_id, p_user_id
  ) RETURNING id INTO v_adj_id;

  IF p_direction = 'increase' THEN
    INSERT INTO inventory_movements (
      movement_type, movement_date, product_id, warehouse_id,
      quantity, uom, source_adjustment_id, reference_number, notes, created_by
    ) VALUES (
      v_movement_type, COALESCE(p_adjustment_date, CURRENT_DATE), p_product_id, p_warehouse_id,
      v_signed_qty, p_uom, v_adj_id, 'ADJ-INCREASE',
      p_reason || COALESCE(' — ' || p_notes, ''), p_user_id
    );
  ELSE
    v_cost_consumed := consume_layers_fifo(
      p_product_id, p_warehouse_id, p_quantity,
      v_movement_type, COALESCE(p_adjustment_date, CURRENT_DATE),
      v_adj_id, NULL,
      'ADJ-DECREASE', p_reason || COALESCE(' — ' || p_notes, ''), p_user_id
    );
  END IF;

  RETURN v_adj_id;
END;
$$ LANGUAGE plpgsql;

-- ─── apply_warehouse_transfer() ─────────────────────────────────
-- Consumes source layers via FIFO, creates ONE new layer at destination with the
-- weighted-average consumed cost (so the transfer doesn't fragment cost layers
-- unnecessarily — Phase 2 can refine this if you want per-layer-preserved transfers).
-- Creates paired transfer_out + transfer_in movements with the same transfer_pair_id.

CREATE OR REPLACE FUNCTION apply_warehouse_transfer(
  p_product_id           uuid,
  p_source_warehouse_id  uuid,
  p_dest_warehouse_id    uuid,
  p_quantity             numeric,
  p_uom                  text,
  p_reason               text,
  p_notes                text,
  p_user_id              uuid,
  p_adjustment_date      date
) RETURNS uuid AS $$
DECLARE
  v_adj_id uuid;
  v_pair_id uuid;
  v_total_cost numeric;
  v_avg_cost numeric;
  v_currency text;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'apply_warehouse_transfer: quantity must be > 0';
  END IF;
  IF p_source_warehouse_id = p_dest_warehouse_id OR p_dest_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'apply_warehouse_transfer: source and destination warehouses must differ';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'apply_warehouse_transfer: reason required';
  END IF;

  v_pair_id := gen_random_uuid();

  -- Currency: peek at one open layer at source to know what currency to use
  SELECT cost_currency INTO v_currency FROM inventory_layers
    WHERE product_id = p_product_id AND warehouse_id = p_source_warehouse_id
      AND status = 'open' AND qty_remaining > 0
    ORDER BY receipt_date ASC LIMIT 1;
  v_currency := COALESCE(v_currency, 'EGP');

  -- Adjustment row
  INSERT INTO inventory_adjustments (
    adjustment_type, adjustment_date, product_id,
    source_warehouse_id, destination_warehouse_id,
    quantity, uom, transfer_pair_id,
    reason, notes, created_by, updated_by
  ) VALUES (
    'warehouse_transfer', COALESCE(p_adjustment_date, CURRENT_DATE), p_product_id,
    p_source_warehouse_id, p_dest_warehouse_id,
    p_quantity, p_uom, v_pair_id,
    p_reason, p_notes, p_user_id, p_user_id
  ) RETURNING id INTO v_adj_id;

  -- Consume source layers (creates transfer_out movements with the pair_id)
  v_total_cost := consume_layers_fifo(
    p_product_id, p_source_warehouse_id, p_quantity,
    'transfer_out', COALESCE(p_adjustment_date, CURRENT_DATE),
    v_adj_id, v_pair_id,
    'TRF-' || substring(v_pair_id::text, 1, 8), p_reason || COALESCE(' — ' || p_notes, ''), p_user_id
  );

  v_avg_cost := v_total_cost / p_quantity;

  -- NOTE: we deliberately do NOT create a new inventory_layers row at the destination.
  -- inventory_layers.source_receipt_id is UNIQUE + NOT NULL — every layer must trace
  -- to a receipt. Transfers preserve the original layers but mark them at the
  -- destination warehouse via the transfer_in movement. Stock-on-hand queries
  -- should aggregate movements per (product, warehouse) rather than reading
  -- layers directly when transfers are involved. Build 5 reports will handle this.

  -- Create the transfer_in movement at destination
  INSERT INTO inventory_movements (
    movement_type, movement_date, product_id, warehouse_id,
    quantity, uom, cost_per_uom, cost_currency, total_cost,
    source_adjustment_id, transfer_pair_id,
    reference_number, notes, created_by
  ) VALUES (
    'transfer_in', COALESCE(p_adjustment_date, CURRENT_DATE), p_product_id, p_dest_warehouse_id,
    p_quantity, p_uom, v_avg_cost, v_currency, v_total_cost,
    v_adj_id, v_pair_id,
    'TRF-' || substring(v_pair_id::text, 1, 8), p_reason || COALESCE(' — ' || p_notes, ''), p_user_id
  );

  RETURN v_adj_id;
END;
$$ LANGUAGE plpgsql;

-- ─── apply_cost_adjustment() ────────────────────────────────────
-- Updates a specific layer's cost_per_uom. Records old + new in the adjustment row.
-- Does NOT create a movement (cost-only changes don't move stock). Future sales
-- drawn from this layer will use the new cost. Sales already consumed at the old
-- cost can be flagged for COGS restatement in reports (Build 5).

CREATE OR REPLACE FUNCTION apply_cost_adjustment(
  p_layer_id              uuid,
  p_new_cost_per_uom      numeric,
  p_reason                text,
  p_notes                 text,
  p_user_id               uuid,
  p_adjustment_date       date
) RETURNS uuid AS $$
DECLARE
  v_adj_id uuid;
  v_layer RECORD;
BEGIN
  IF p_new_cost_per_uom IS NULL OR p_new_cost_per_uom < 0 THEN
    RAISE EXCEPTION 'apply_cost_adjustment: new cost must be >= 0';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'apply_cost_adjustment: reason required';
  END IF;

  SELECT * INTO v_layer FROM inventory_layers WHERE id = p_layer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Layer not found: %', p_layer_id;
  END IF;

  INSERT INTO inventory_adjustments (
    adjustment_type, adjustment_date, product_id, source_warehouse_id,
    source_layer_id, old_cost_per_uom, new_cost_per_uom,
    uom, reason, notes, created_by, updated_by
  ) VALUES (
    'cost_restatement', COALESCE(p_adjustment_date, CURRENT_DATE), v_layer.product_id, v_layer.warehouse_id,
    p_layer_id, v_layer.cost_per_uom, p_new_cost_per_uom,
    v_layer.uom, p_reason, p_notes, p_user_id, p_user_id
  ) RETURNING id INTO v_adj_id;

  UPDATE inventory_layers SET
    cost_per_uom = p_new_cost_per_uom,
    updated_at = now()
  WHERE id = p_layer_id;

  RETURN v_adj_id;
END;
$$ LANGUAGE plpgsql;

-- ─── Verify ──────────────────────────────────────────────────────
-- SELECT COUNT(*) FROM inventory_adjustments;  -- expect 0
-- SELECT proname FROM pg_proc WHERE proname IN ('consume_layers_fifo','apply_quantity_adjustment','apply_warehouse_transfer','apply_cost_adjustment');
-- Expect: 4 rows
