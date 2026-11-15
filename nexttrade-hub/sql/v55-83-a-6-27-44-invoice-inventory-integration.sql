-- v55.83-A.6.27.44 — Sales Invoice ↔ Inventory integration (Build 4.6 foundation)
--
-- What this enables:
--   • Invoices can now link to inventory variants
--   • Date-driven mode resolution via app_settings.inventory_cutoff_date
--   • FIFO consumption automatic on submit
--   • Backorder tracking when sale qty exceeds available stock
--   • COGS + gross profit denormalized for fast reporting

-- ── 1. App-level cutoff setting (uses existing app_settings k/v table) ──────
-- NOTE: app_settings uses (setting_key, setting_value) where setting_value is text.
-- We store the date as ISO string ("2026-06-01") or null literal "null".
INSERT INTO app_settings (setting_key, setting_value)
VALUES ('inventory_cutoff_date', 'null')
ON CONFLICT (setting_key) DO NOTHING;

-- ── 2. Invoice columns for inventory linkage ────────────────────────────────
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS uses_inventory boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS variant_id uuid REFERENCES inventory_products(id),
  ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES warehouses(id),
  ADD COLUMN IF NOT EXISTS uom text,
  ADD COLUMN IF NOT EXISTS sale_quantity numeric(12,3),
  ADD COLUMN IF NOT EXISTS sale_price_per_uom numeric(14,2),
  ADD COLUMN IF NOT EXISTS consumed_layers jsonb,
  ADD COLUMN IF NOT EXISTS cogs_total numeric(14,2),
  ADD COLUMN IF NOT EXISTS gross_profit numeric(14,2),
  ADD COLUMN IF NOT EXISTS inventory_consumed_at timestamptz,
  ADD COLUMN IF NOT EXISTS inventory_status text DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS backorder_qty numeric(12,3) DEFAULT 0;

-- inventory_status: 'none' (legacy/manual), 'draft', 'consumed', 'reversed'

CREATE INDEX IF NOT EXISTS idx_invoices_variant_id
  ON invoices (variant_id) WHERE variant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_uses_inventory
  ON invoices (uses_inventory) WHERE uses_inventory = true;
CREATE INDEX IF NOT EXISTS idx_invoices_inventory_consumed_at
  ON invoices (inventory_consumed_at DESC) WHERE inventory_consumed_at IS NOT NULL;

-- ── 3. Backorders table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_backorders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid REFERENCES invoices(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES inventory_products(id) ON DELETE RESTRICT,
  warehouse_id uuid REFERENCES warehouses(id),
  qty_short numeric(12,3) NOT NULL,
  uom text,
  status text NOT NULL DEFAULT 'open',  -- open | fulfilled | cancelled
  notes text,
  created_at timestamptz DEFAULT now(),
  created_by uuid,
  fulfilled_at timestamptz,
  fulfilled_by uuid,
  CONSTRAINT chk_backorder_status CHECK (status IN ('open', 'fulfilled', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_backorders_status_open
  ON inventory_backorders (status, created_at DESC) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_backorders_variant
  ON inventory_backorders (variant_id);

ALTER TABLE inventory_backorders ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Allow all inventory_backorders" ON inventory_backorders FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 4. consume_invoice_inventory RPC ───────────────────────────────────────
-- Called automatically when an invoice with uses_inventory=true is submitted.
-- Pulls qty from FIFO layers oldest-first, records which layers were consumed,
-- stamps cogs_total + gross_profit + inventory_consumed_at + inventory_status='consumed'.
-- If layers run out, creates an inventory_backorders row for the remaining qty.
-- Idempotent: if already consumed, returns the existing consumed_layers without changes.
CREATE OR REPLACE FUNCTION consume_invoice_inventory(p_invoice_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_invoice          invoices%ROWTYPE;
  v_layer            record;
  v_remaining        numeric;
  v_consumed_qty     numeric;
  v_consumed_cost    numeric;
  v_total_cogs       numeric := 0;
  v_total_consumed   numeric := 0;
  v_consumed_layers  jsonb := '[]'::jsonb;
  v_backorder_qty    numeric := 0;
  v_backorder_id     uuid;
BEGIN
  -- Lock + load invoice
  SELECT * INTO v_invoice FROM invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice % not found', p_invoice_id; END IF;

  -- Idempotency: if already consumed, return existing data
  IF v_invoice.inventory_status = 'consumed' THEN
    RETURN jsonb_build_object(
      'already_consumed', true,
      'consumed_layers', v_invoice.consumed_layers,
      'cogs_total', v_invoice.cogs_total
    );
  END IF;

  IF v_invoice.uses_inventory IS NOT TRUE THEN
    RAISE EXCEPTION 'Invoice % does not use inventory linkage', p_invoice_id;
  END IF;
  IF v_invoice.variant_id IS NULL THEN
    RAISE EXCEPTION 'Invoice % has no variant_id set', p_invoice_id;
  END IF;
  IF v_invoice.sale_quantity IS NULL OR v_invoice.sale_quantity <= 0 THEN
    RAISE EXCEPTION 'Invoice % has invalid sale_quantity', p_invoice_id;
  END IF;

  v_remaining := v_invoice.sale_quantity;

  -- Walk FIFO layers oldest-first (only layers with qty_remaining > 0)
  -- Try table: inventory_layers (built in Build 4.3)
  BEGIN
    FOR v_layer IN
      SELECT id, product_id, warehouse_id, cost_per_uom, qty_remaining, received_at
      FROM inventory_layers
      WHERE product_id = v_invoice.variant_id
        AND (v_invoice.warehouse_id IS NULL OR warehouse_id = v_invoice.warehouse_id)
        AND qty_remaining > 0
      ORDER BY received_at ASC, id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_consumed_qty := LEAST(v_layer.qty_remaining, v_remaining);
      v_consumed_cost := v_consumed_qty * v_layer.cost_per_uom;
      v_total_cogs := v_total_cogs + v_consumed_cost;
      v_total_consumed := v_total_consumed + v_consumed_qty;
      v_remaining := v_remaining - v_consumed_qty;

      -- Deduct from layer
      UPDATE inventory_layers
      SET qty_remaining = qty_remaining - v_consumed_qty,
          updated_at = now()
      WHERE id = v_layer.id;

      -- Record in jsonb array
      v_consumed_layers := v_consumed_layers || jsonb_build_object(
        'layer_id', v_layer.id,
        'qty_consumed', v_consumed_qty,
        'cost_per_uom', v_layer.cost_per_uom,
        'total_cost', v_consumed_cost,
        'received_at', v_layer.received_at
      );
    END LOOP;
  EXCEPTION WHEN undefined_table THEN
    -- inventory_layers doesn't exist yet (Build 4.3 SQL not run)
    RAISE EXCEPTION 'inventory_layers table missing — run Build 4.3 SQL migration before using inventory-linked invoices';
  END;

  -- Any leftover qty after consuming all layers → backorder
  IF v_remaining > 0 THEN
    v_backorder_qty := v_remaining;
    INSERT INTO inventory_backorders (
      invoice_id, variant_id, warehouse_id, qty_short, uom, status, notes, created_by
    ) VALUES (
      p_invoice_id, v_invoice.variant_id, v_invoice.warehouse_id,
      v_backorder_qty, v_invoice.uom, 'open',
      'Auto-created at invoice submit — sale qty (' || v_invoice.sale_quantity || ') exceeded available stock (' || v_total_consumed || ')',
      v_invoice.created_by
    ) RETURNING id INTO v_backorder_id;
  END IF;

  -- Stamp the invoice
  UPDATE invoices
  SET consumed_layers       = v_consumed_layers,
      cogs_total            = v_total_cogs,
      gross_profit          = COALESCE(total_amount, 0) - v_total_cogs,
      inventory_consumed_at = now(),
      inventory_status      = 'consumed',
      backorder_qty         = v_backorder_qty
  WHERE id = p_invoice_id;

  RETURN jsonb_build_object(
    'consumed_layers', v_consumed_layers,
    'total_consumed', v_total_consumed,
    'cogs_total', v_total_cogs,
    'gross_profit', COALESCE(v_invoice.total_amount, 0) - v_total_cogs,
    'backorder_qty', v_backorder_qty,
    'backorder_id', v_backorder_id
  );
END;
$$ LANGUAGE plpgsql;

-- ── 5. reverse_invoice_inventory RPC ───────────────────────────────────────
-- Called when an invoice is cancelled or reverted. Restores layer qty_remaining
-- and cancels any open backorder from this invoice.
CREATE OR REPLACE FUNCTION reverse_invoice_inventory(p_invoice_id uuid)
RETURNS boolean AS $$
DECLARE
  v_invoice  invoices%ROWTYPE;
  v_entry    jsonb;
  v_layer_id uuid;
  v_qty      numeric;
BEGIN
  SELECT * INTO v_invoice FROM invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice % not found', p_invoice_id; END IF;

  IF v_invoice.inventory_status != 'consumed' THEN
    RAISE EXCEPTION 'Invoice % is not in consumed status (current: %)', p_invoice_id, v_invoice.inventory_status;
  END IF;

  -- Restore each consumed layer
  IF v_invoice.consumed_layers IS NOT NULL AND jsonb_typeof(v_invoice.consumed_layers) = 'array' THEN
    FOR v_entry IN SELECT * FROM jsonb_array_elements(v_invoice.consumed_layers)
    LOOP
      v_layer_id := (v_entry->>'layer_id')::uuid;
      v_qty := (v_entry->>'qty_consumed')::numeric;
      BEGIN
        UPDATE inventory_layers
        SET qty_remaining = qty_remaining + v_qty,
            updated_at = now()
        WHERE id = v_layer_id;
      EXCEPTION WHEN undefined_table THEN
        NULL;  -- Layers table missing — nothing to restore
      END;
    END LOOP;
  END IF;

  -- Cancel any open backorder from this invoice
  UPDATE inventory_backorders
  SET status = 'cancelled',
      notes = COALESCE(notes, '') || ' | Auto-cancelled when invoice was reversed at ' || now()::text
  WHERE invoice_id = p_invoice_id AND status = 'open';

  -- Reset the invoice
  UPDATE invoices
  SET inventory_status      = 'reversed',
      consumed_layers       = NULL,
      cogs_total            = NULL,
      gross_profit          = NULL,
      inventory_consumed_at = NULL,
      backorder_qty         = 0
  WHERE id = p_invoice_id;

  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- ── 6. Helper: get_last_sold_price(variant_id) ──────────────────────────────
-- Returns the most recent inventory-linked invoice's sale_price_per_uom for this variant.
-- Used by the invoice form to pre-fill the price field when operator picks a variant.
CREATE OR REPLACE FUNCTION get_last_sold_price(p_variant_id uuid)
RETURNS numeric AS $$
DECLARE
  v_price numeric;
BEGIN
  SELECT sale_price_per_uom INTO v_price
  FROM invoices
  WHERE variant_id = p_variant_id
    AND uses_inventory = true
    AND sale_price_per_uom IS NOT NULL
  ORDER BY invoice_date DESC, created_at DESC NULLS LAST
  LIMIT 1;
  RETURN v_price;
END;
$$ LANGUAGE plpgsql;

-- ── 7. Helper: get_variant_available_qty(variant_id, warehouse_id) ──────────
-- Returns total FIFO qty available across all layers for a variant in a warehouse.
-- Used by the invoice form to display the "X available" badge.
CREATE OR REPLACE FUNCTION get_variant_available_qty(p_variant_id uuid, p_warehouse_id uuid DEFAULT NULL)
RETURNS numeric AS $$
DECLARE
  v_total numeric := 0;
BEGIN
  BEGIN
    SELECT COALESCE(SUM(qty_remaining), 0) INTO v_total
    FROM inventory_layers
    WHERE product_id = p_variant_id
      AND (p_warehouse_id IS NULL OR warehouse_id = p_warehouse_id)
      AND qty_remaining > 0;
  EXCEPTION WHEN undefined_table THEN
    v_total := 0;
  END;
  RETURN v_total;
END;
$$ LANGUAGE plpgsql;

-- ── Verify ──────────────────────────────────────────────────────
-- SELECT COUNT(*) FROM information_schema.columns WHERE table_name='invoices'
--   AND column_name IN ('uses_inventory','variant_id','warehouse_id','uom','sale_quantity','sale_price_per_uom','consumed_layers','cogs_total','gross_profit','inventory_consumed_at','inventory_status','backorder_qty');
-- Expect: 12
-- SELECT routine_name FROM information_schema.routines WHERE routine_name IN
--   ('consume_invoice_inventory','reverse_invoice_inventory','get_last_sold_price','get_variant_available_qty');
-- Expect: 4 rows
-- SELECT to_regclass('public.inventory_backorders');
-- Expect: inventory_backorders (not null)
