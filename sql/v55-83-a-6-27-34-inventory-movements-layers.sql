-- v55.83-A.6.27.34 — Inventory Phase 1 Build 4.3: Movements Ledger + FIFO Cost Layers
--
-- Adds the two engine tables that everything else plugs into:
--
--   1. inventory_movements — append-only ledger of every stock change.
--      Auto-populated by trigger when a receipt is finalized. Future builds
--      will insert sale/transfer/adjustment movements here too.
--
--   2. inventory_layers — FIFO cost layers per (product, warehouse). One row
--      per receipt-finalization. Tracks qty_remaining so consumption (sales/
--      transfers) decrements oldest-first. Drives stock-on-hand and inventory
--      valuation.
--
-- Trigger on inventory_stock_receipts: when status transitions to 'finalized'
-- (and landed_cost_per_uom is set), auto-create one movement row + one layer row.
-- Idempotent: if a movement/layer already exists for this receipt_id, do nothing
-- (so re-finalization or backfills don't duplicate).

-- ── Table: inventory_movements (append-only ledger) ─────────────
CREATE TABLE IF NOT EXISTS inventory_movements (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_type            text NOT NULL,
  movement_date            date NOT NULL DEFAULT CURRENT_DATE,

  -- What moved
  product_id               uuid NOT NULL REFERENCES inventory_products(id) ON DELETE RESTRICT,
  warehouse_id             uuid REFERENCES inv_warehouses(id) ON DELETE RESTRICT,
  quantity                 numeric NOT NULL,     -- signed: positive in, negative out
  uom                      text,

  -- Cost (always at the time the movement happened; doesn't change later)
  cost_per_uom             numeric,
  cost_currency            text DEFAULT 'EGP',
  total_cost               numeric,

  -- What caused this movement (one of receipt_id, layer_id, invoice_id, adjustment_id)
  source_receipt_id        uuid REFERENCES inventory_stock_receipts(id) ON DELETE SET NULL,
  source_layer_id          uuid,
  source_invoice_id        uuid,
  source_adjustment_id     uuid,

  -- Context
  reference_number         text,   -- mirrors receipt_number / invoice_number / etc.
  notes                    text,

  -- Audit
  created_by               uuid,
  created_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_movement_type CHECK (movement_type IN (
    'receipt',          -- stock arriving (from finalized receipt)
    'sale',             -- stock sold (Build 4.6)
    'transfer_in',      -- received via transfer
    'transfer_out',     -- shipped via transfer
    'adjustment_in',    -- positive count correction / found stock
    'adjustment_out',   -- negative correction / damage / theft
    'reversal'          -- cancelled receipt — negates an earlier 'receipt'
  )),
  CONSTRAINT chk_movement_uom CHECK (uom IS NULL OR uom IN ('kg','meter','yard','roll','piece','liter','sqm')),
  CONSTRAINT chk_movement_cost_currency CHECK (cost_currency IS NULL OR cost_currency IN ('EGP','USD','EUR'))
);

CREATE INDEX IF NOT EXISTS idx_movements_product       ON inventory_movements (product_id);
CREATE INDEX IF NOT EXISTS idx_movements_warehouse     ON inventory_movements (warehouse_id);
CREATE INDEX IF NOT EXISTS idx_movements_date          ON inventory_movements (movement_date);
CREATE INDEX IF NOT EXISTS idx_movements_type          ON inventory_movements (movement_type);
CREATE INDEX IF NOT EXISTS idx_movements_receipt       ON inventory_movements (source_receipt_id) WHERE source_receipt_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_movements_product_wh    ON inventory_movements (product_id, warehouse_id);

ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inv_movements_read  ON inventory_movements;
CREATE POLICY inv_movements_read  ON inventory_movements FOR SELECT USING (true);
DROP POLICY IF EXISTS inv_movements_write ON inventory_movements;
CREATE POLICY inv_movements_write ON inventory_movements FOR ALL USING (true) WITH CHECK (true);

-- ── Table: inventory_layers (FIFO cost layers) ──────────────────
CREATE TABLE IF NOT EXISTS inventory_layers (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source receipt (UNIQUE — one layer per receipt row max)
  source_receipt_id        uuid NOT NULL UNIQUE REFERENCES inventory_stock_receipts(id) ON DELETE RESTRICT,

  -- Layer identity
  product_id               uuid NOT NULL REFERENCES inventory_products(id) ON DELETE RESTRICT,
  warehouse_id             uuid REFERENCES inv_warehouses(id) ON DELETE RESTRICT,
  receipt_date             date NOT NULL,
  receipt_number           text,
  batch_number             text,

  -- Quantities — qty_remaining decremented by consumption (sales/transfers)
  qty_received             numeric NOT NULL CHECK (qty_received > 0),
  qty_remaining            numeric NOT NULL,
  uom                      text,

  -- Cost (frozen at finalization)
  cost_per_uom             numeric NOT NULL,
  cost_currency            text DEFAULT 'EGP',
  fx_rate_used             numeric,

  -- Status
  status                   text NOT NULL DEFAULT 'open',   -- 'open' (qty_remaining > 0) or 'closed' (fully consumed) or 'reversed'

  -- Audit
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_layer_status CHECK (status IN ('open','closed','reversed')),
  CONSTRAINT chk_qty_remaining_nonneg CHECK (qty_remaining >= 0),
  CONSTRAINT chk_qty_remaining_lte_received CHECK (qty_remaining <= qty_received),
  CONSTRAINT chk_layer_uom CHECK (uom IS NULL OR uom IN ('kg','meter','yard','roll','piece','liter','sqm')),
  CONSTRAINT chk_layer_cost_currency CHECK (cost_currency IS NULL OR cost_currency IN ('EGP','USD','EUR'))
);

CREATE INDEX IF NOT EXISTS idx_layers_product           ON inventory_layers (product_id);
CREATE INDEX IF NOT EXISTS idx_layers_warehouse         ON inventory_layers (warehouse_id);
CREATE INDEX IF NOT EXISTS idx_layers_status            ON inventory_layers (status);
CREATE INDEX IF NOT EXISTS idx_layers_open_by_product   ON inventory_layers (product_id, warehouse_id, receipt_date) WHERE status = 'open' AND qty_remaining > 0;
CREATE INDEX IF NOT EXISTS idx_layers_receipt_number    ON inventory_layers (receipt_number) WHERE receipt_number IS NOT NULL;

CREATE OR REPLACE FUNCTION update_inventory_layers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_layers_updated_at ON inventory_layers;
CREATE TRIGGER trigger_layers_updated_at
BEFORE UPDATE ON inventory_layers
FOR EACH ROW EXECUTE FUNCTION update_inventory_layers_updated_at();

ALTER TABLE inventory_layers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inv_layers_read  ON inventory_layers;
CREATE POLICY inv_layers_read  ON inventory_layers FOR SELECT USING (true);
DROP POLICY IF EXISTS inv_layers_write ON inventory_layers;
CREATE POLICY inv_layers_write ON inventory_layers FOR ALL USING (true) WITH CHECK (true);

-- Update source_layer_id FK on movements (was forward-referenced above)
DO $$ BEGIN
  ALTER TABLE inventory_movements
    ADD CONSTRAINT fk_movements_source_layer
    FOREIGN KEY (source_layer_id) REFERENCES inventory_layers(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Trigger: on finalize, create movement + layer ───────────────
-- Fires AFTER UPDATE when status transitions to 'finalized' for the first time
-- AND landed_cost_per_uom is set. Idempotent — uses inventory_layers.source_receipt_id
-- UNIQUE constraint to prevent duplicates.

CREATE OR REPLACE FUNCTION on_receipt_finalize_create_ledger()
RETURNS TRIGGER AS $$
DECLARE
  v_layer_id uuid;
  v_existing_layer_id uuid;
BEGIN
  -- Only fire when status transitions to 'finalized' (not already finalized)
  IF NEW.status = 'finalized'
     AND (OLD.status IS NULL OR OLD.status != 'finalized')
     AND NEW.landed_cost_per_uom IS NOT NULL
     AND NEW.quantity > 0
  THEN
    -- Idempotency: don't insert if a layer already exists for this receipt
    SELECT id INTO v_existing_layer_id FROM inventory_layers WHERE source_receipt_id = NEW.id;
    IF v_existing_layer_id IS NULL THEN
      -- Insert layer
      INSERT INTO inventory_layers (
        source_receipt_id, product_id, warehouse_id, receipt_date,
        receipt_number, batch_number,
        qty_received, qty_remaining, uom,
        cost_per_uom, cost_currency, fx_rate_used,
        status
      ) VALUES (
        NEW.id, NEW.product_id, NEW.warehouse_id, NEW.receipt_date,
        NEW.receipt_number, NEW.batch_number,
        NEW.quantity, NEW.quantity, NEW.uom,
        NEW.landed_cost_per_uom, COALESCE(NEW.currency, 'EGP'), NEW.fx_rate_used,
        'open'
      ) RETURNING id INTO v_layer_id;
    ELSE
      v_layer_id := v_existing_layer_id;
    END IF;

    -- Insert movement (skip if a 'receipt' movement already exists for this receipt)
    IF NOT EXISTS (
      SELECT 1 FROM inventory_movements
      WHERE source_receipt_id = NEW.id AND movement_type = 'receipt'
    ) THEN
      INSERT INTO inventory_movements (
        movement_type, movement_date,
        product_id, warehouse_id,
        quantity, uom,
        cost_per_uom, cost_currency, total_cost,
        source_receipt_id, source_layer_id,
        reference_number, notes,
        created_by
      ) VALUES (
        'receipt', NEW.receipt_date,
        NEW.product_id, NEW.warehouse_id,
        NEW.quantity, NEW.uom,
        NEW.landed_cost_per_uom, COALESCE(NEW.currency, 'EGP'), NEW.landed_total,
        NEW.id, v_layer_id,
        NEW.receipt_number, NEW.notes,
        NEW.finalized_by
      );
    END IF;
  END IF;

  -- Also handle CANCELLED → reverse the movement + close the layer
  IF NEW.status = 'cancelled' AND OLD.status = 'finalized' THEN
    -- Insert reversal movement (mirrors the original receipt movement but negative)
    INSERT INTO inventory_movements (
      movement_type, movement_date,
      product_id, warehouse_id,
      quantity, uom,
      cost_per_uom, cost_currency, total_cost,
      source_receipt_id,
      reference_number, notes,
      created_by
    ) VALUES (
      'reversal', CURRENT_DATE,
      NEW.product_id, NEW.warehouse_id,
      -NEW.quantity, NEW.uom,
      NEW.landed_cost_per_uom, COALESCE(NEW.currency, 'EGP'), -COALESCE(NEW.landed_total, 0),
      NEW.id,
      NEW.receipt_number, 'Receipt cancelled: ' || COALESCE(NEW.cancel_reason, '(no reason given)'),
      NEW.cancelled_by
    );
    -- Mark the layer as reversed (don't decrement — preserve audit)
    UPDATE inventory_layers SET status = 'reversed' WHERE source_receipt_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_receipt_finalize_ledger ON inventory_stock_receipts;
CREATE TRIGGER trigger_receipt_finalize_ledger
AFTER UPDATE ON inventory_stock_receipts
FOR EACH ROW EXECUTE FUNCTION on_receipt_finalize_create_ledger();

-- ── Backfill existing finalized receipts ─────────────────────────
-- If you finalized any receipts via Build 4.2 BEFORE this trigger existed,
-- this DO block creates the matching layers + movements for them. Safe to
-- re-run because of the idempotency checks.
DO $$
DECLARE
  r RECORD;
  v_layer_id uuid;
BEGIN
  FOR r IN
    SELECT * FROM inventory_stock_receipts
    WHERE status = 'finalized'
      AND landed_cost_per_uom IS NOT NULL
      AND quantity > 0
      AND NOT EXISTS (SELECT 1 FROM inventory_layers WHERE source_receipt_id = inventory_stock_receipts.id)
  LOOP
    INSERT INTO inventory_layers (
      source_receipt_id, product_id, warehouse_id, receipt_date,
      receipt_number, batch_number,
      qty_received, qty_remaining, uom,
      cost_per_uom, cost_currency, fx_rate_used,
      status
    ) VALUES (
      r.id, r.product_id, r.warehouse_id, r.receipt_date,
      r.receipt_number, r.batch_number,
      r.quantity, r.quantity, r.uom,
      r.landed_cost_per_uom, COALESCE(r.currency, 'EGP'), r.fx_rate_used,
      'open'
    ) RETURNING id INTO v_layer_id;

    INSERT INTO inventory_movements (
      movement_type, movement_date,
      product_id, warehouse_id,
      quantity, uom,
      cost_per_uom, cost_currency, total_cost,
      source_receipt_id, source_layer_id,
      reference_number, notes,
      created_by
    ) VALUES (
      'receipt', r.receipt_date,
      r.product_id, r.warehouse_id,
      r.quantity, r.uom,
      r.landed_cost_per_uom, COALESCE(r.currency, 'EGP'), r.landed_total,
      r.id, v_layer_id,
      r.receipt_number, r.notes,
      r.finalized_by
    );
  END LOOP;
END $$;

-- ── Verify ───────────────────────────────────────────────────────
-- SELECT COUNT(*) AS layers FROM inventory_layers;
-- SELECT COUNT(*) AS movements FROM inventory_movements;
-- SELECT product_id, warehouse_id, SUM(qty_remaining) AS on_hand
--   FROM inventory_layers WHERE status = 'open' AND qty_remaining > 0
--   GROUP BY product_id, warehouse_id;
