-- v55.83-A.6.27.35 — Inventory Phase 1 Build 4.4: Two-Phase Receiving + Roll Detail + Edit/Reopen
--
-- Three changes:
--
-- 1. Add expected_* columns to inventory_stock_receipts — what the supplier said
--    they shipped (rolls + gross + net + meters). Existing 'quantity' becomes the
--    line-level actual UOM total once rolls are entered.
--
-- 2. New child table inventory_receipt_rolls — one row per physical roll under
--    a line. Stores actual per-roll measurements.
--
-- 3. Extend status enum to include 'pending_detail' for the two-phase flow.
--    Existing rows are unaffected (still 'active'/'received'/'finalized'/'cancelled').

-- ─── New columns on inventory_stock_receipts ─────────────────────
-- Expected totals (what the supplier said). Filled at Phase 1.
-- Actuals come from the rolls table; the existing 'quantity' column stores
-- the rolled-up actual UOM total once rolls are entered (or expected if no rolls).
ALTER TABLE inventory_stock_receipts ADD COLUMN IF NOT EXISTS expected_rolls       integer;
ALTER TABLE inventory_stock_receipts ADD COLUMN IF NOT EXISTS expected_gross_kg    numeric;
ALTER TABLE inventory_stock_receipts ADD COLUMN IF NOT EXISTS expected_net_kg      numeric;
ALTER TABLE inventory_stock_receipts ADD COLUMN IF NOT EXISTS expected_uom_total   numeric;
ALTER TABLE inventory_stock_receipts ADD COLUMN IF NOT EXISTS variance_acknowledged boolean DEFAULT false;

-- ─── Status enum extension: add 'pending_detail' ─────────────────
ALTER TABLE inventory_stock_receipts DROP CONSTRAINT IF EXISTS chk_status;
ALTER TABLE inventory_stock_receipts ADD CONSTRAINT chk_status
  CHECK (status IN ('active','pending_detail','received','finalized','cancelled'));

-- ─── New child table: inventory_receipt_rolls ────────────────────
-- One row per physical roll under a receipt line. Foreign key to the parent
-- receipt row. Rolls can be added/edited/deleted any time before finalize.
CREATE TABLE IF NOT EXISTS inventory_receipt_rolls (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id               uuid NOT NULL REFERENCES inventory_stock_receipts(id) ON DELETE CASCADE,

  -- Roll identity
  roll_number              text,                 -- supplier's roll # or operator-assigned ID
  roll_sequence            integer,              -- display order within the line (1, 2, 3...)

  -- Actual measurements
  gross_kg                 numeric,              -- weight with packaging
  net_kg                   numeric,              -- weight without packaging
  meters                   numeric,              -- length (UOM-dependent — actually the primary UOM amount)

  -- Location + condition
  rack                     text,
  notes                    text,

  -- Audit
  created_by               uuid,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_by               uuid,
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_roll_gross_nonneg CHECK (gross_kg IS NULL OR gross_kg >= 0),
  CONSTRAINT chk_roll_net_nonneg   CHECK (net_kg   IS NULL OR net_kg   >= 0),
  CONSTRAINT chk_roll_meters_nonneg CHECK (meters  IS NULL OR meters  >= 0)
);

CREATE INDEX IF NOT EXISTS idx_receipt_rolls_receipt    ON inventory_receipt_rolls (receipt_id);
CREATE INDEX IF NOT EXISTS idx_receipt_rolls_sequence   ON inventory_receipt_rolls (receipt_id, roll_sequence);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_inventory_receipt_rolls_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_receipt_rolls_updated_at ON inventory_receipt_rolls;
CREATE TRIGGER trigger_receipt_rolls_updated_at
BEFORE UPDATE ON inventory_receipt_rolls
FOR EACH ROW EXECUTE FUNCTION update_inventory_receipt_rolls_updated_at();

-- RLS
ALTER TABLE inventory_receipt_rolls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inv_receipt_rolls_read  ON inventory_receipt_rolls;
CREATE POLICY inv_receipt_rolls_read  ON inventory_receipt_rolls FOR SELECT USING (true);
DROP POLICY IF EXISTS inv_receipt_rolls_write ON inventory_receipt_rolls;
CREATE POLICY inv_receipt_rolls_write ON inventory_receipt_rolls FOR ALL USING (true) WITH CHECK (true);

-- ─── Reopen support: function to reverse a finalized receipt ─────
-- When super_admin clicks "Reopen", this function does the layer reversal
-- atomically. The trigger from Build 4.3 (on_receipt_finalize_create_ledger)
-- already handles the reversal-movement-and-layer-status update when status
-- transitions from 'finalized' to 'cancelled' — but for Reopen we want to go
-- from 'finalized' back to 'received' (not 'cancelled'), so we need explicit
-- handling here.

CREATE OR REPLACE FUNCTION reopen_finalized_receipt(p_receipt_id uuid, p_user_id uuid, p_reason text)
RETURNS void AS $$
DECLARE
  r RECORD;
BEGIN
  SELECT * INTO r FROM inventory_stock_receipts WHERE id = p_receipt_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Receipt not found: %', p_receipt_id; END IF;
  IF r.status != 'finalized' THEN
    RAISE EXCEPTION 'Receipt % is not finalized (status: %)', p_receipt_id, r.status;
  END IF;

  -- 1. Create a reversal movement (same as cancellation flow)
  INSERT INTO inventory_movements (
    movement_type, movement_date, product_id, warehouse_id,
    quantity, uom, cost_per_uom, cost_currency, total_cost,
    source_receipt_id, reference_number, notes, created_by
  ) VALUES (
    'reversal', CURRENT_DATE, r.product_id, r.warehouse_id,
    -r.quantity, r.uom, r.landed_cost_per_uom, COALESCE(r.currency, 'EGP'), -COALESCE(r.landed_total, 0),
    r.id, r.receipt_number, 'Receipt reopened for edit: ' || COALESCE(p_reason, '(no reason given)'), p_user_id
  );

  -- 2. Mark the existing layer as reversed (preserves audit)
  UPDATE inventory_layers SET status = 'reversed' WHERE source_receipt_id = r.id AND status = 'open';

  -- 3. Flip status back to 'received' and clear the finalize fields so the
  --    operator can re-finalize after editing. The trigger from Build 4.3
  --    won't fire on status going from 'finalized' to 'received' (only on
  --    transitions TO 'finalized' or to 'cancelled' from finalized).
  UPDATE inventory_stock_receipts SET
    status = 'received',
    landed_cost_per_uom = NULL,
    landed_total = NULL,
    finalized_at = NULL,
    finalized_by = NULL,
    allocation_method = NULL,
    fx_rate_used = NULL,
    updated_by = p_user_id,
    updated_at = now()
  WHERE id = r.id;
END;
$$ LANGUAGE plpgsql;

-- ─── Verify ──────────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'inventory_stock_receipts'
--   AND column_name LIKE 'expected_%';                  -- expect 4 rows
-- SELECT COUNT(*) FROM inventory_receipt_rolls;          -- expect 0
-- SELECT proname FROM pg_proc WHERE proname = 'reopen_finalized_receipt';  -- expect 1 row
