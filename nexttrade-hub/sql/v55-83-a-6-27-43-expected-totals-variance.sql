-- v55.83-A.6.27.43 — Shipment-level expected totals + variance tracking + status flow
--
-- Adds 11 new columns to inventory_shipment_headers:
--   expected_total_rolls           (integer)
--   expected_total_gross_kg        (numeric 12,3)
--   expected_total_net_kg          (numeric 12,3)
--   expected_total_uom             (numeric 12,3)
--   expected_uom_type              (text)
--   variance_rolls                 (integer)
--   variance_gross_kg              (numeric 12,3)
--   variance_net_kg                (numeric 12,3)
--   variance_uom                   (numeric 12,3)
--   variance_notes                 (text)
--   submitted_at                   (timestamptz)
--   submitted_by                   (uuid)
--   is_balanced                    (boolean)
--
-- Also updates the status CHECK constraint to add 'draft', 'submitted_balanced', 'submitted_unbalanced'.
-- And adds the can_delete_product(uuid) function used by Product Master's Delete button.

-- ── 1. Drop the old CHECK constraint and add the new one with expanded statuses ──
ALTER TABLE inventory_shipment_headers DROP CONSTRAINT IF EXISTS chk_sh_status;
ALTER TABLE inventory_shipment_headers ADD CONSTRAINT chk_sh_status
  CHECK (status IN ('draft', 'pending_detail', 'received', 'submitted_balanced', 'submitted_unbalanced', 'finalized', 'cancelled'));

-- ── 2. Add the 13 new columns ─────────────────────────────────────
ALTER TABLE inventory_shipment_headers
  ADD COLUMN IF NOT EXISTS expected_total_rolls integer,
  ADD COLUMN IF NOT EXISTS expected_total_gross_kg numeric(12,3),
  ADD COLUMN IF NOT EXISTS expected_total_net_kg numeric(12,3),
  ADD COLUMN IF NOT EXISTS expected_total_uom numeric(12,3),
  ADD COLUMN IF NOT EXISTS expected_uom_type text,
  ADD COLUMN IF NOT EXISTS variance_rolls integer,
  ADD COLUMN IF NOT EXISTS variance_gross_kg numeric(12,3),
  ADD COLUMN IF NOT EXISTS variance_net_kg numeric(12,3),
  ADD COLUMN IF NOT EXISTS variance_uom numeric(12,3),
  ADD COLUMN IF NOT EXISTS variance_notes text,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_by uuid,
  ADD COLUMN IF NOT EXISTS is_balanced boolean;

CREATE INDEX IF NOT EXISTS idx_shipment_headers_is_balanced
  ON inventory_shipment_headers (is_balanced) WHERE is_balanced IS NOT NULL;

-- Same columns on inventory_stock_receipts so the per-line shadow has them if needed.
-- (Optional — main copy lives on header. These are for backward compat / legacy receipts.)
ALTER TABLE inventory_stock_receipts
  ADD COLUMN IF NOT EXISTS expected_total_rolls integer,
  ADD COLUMN IF NOT EXISTS expected_total_gross_kg numeric(12,3),
  ADD COLUMN IF NOT EXISTS expected_total_net_kg numeric(12,3),
  ADD COLUMN IF NOT EXISTS expected_total_uom numeric(12,3),
  ADD COLUMN IF NOT EXISTS expected_uom_type text;

-- ── 3. can_delete_product(p_id uuid) RETURNS boolean ────────────────
-- Returns TRUE only when the product has NO references anywhere
-- (no receipts, no movements, no layers). Used by Product Master's Delete button.
CREATE OR REPLACE FUNCTION can_delete_product(p_id uuid)
RETURNS boolean AS $$
DECLARE
  v_count integer := 0;
BEGIN
  -- Check receipts
  SELECT COUNT(*) INTO v_count FROM inventory_stock_receipts WHERE product_id = p_id;
  IF v_count > 0 THEN RETURN false; END IF;

  -- Check movements (if the table exists)
  BEGIN
    SELECT COUNT(*) INTO v_count FROM inventory_movements WHERE product_id = p_id;
    IF v_count > 0 THEN RETURN false; END IF;
  EXCEPTION WHEN undefined_table THEN
    -- inventory_movements doesn't exist yet (Build 4.3 SQL not run); skip the check.
    NULL;
  END;

  -- Check layers (if the table exists)
  BEGIN
    SELECT COUNT(*) INTO v_count FROM inventory_layers WHERE product_id = p_id;
    IF v_count > 0 THEN RETURN false; END IF;
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  -- Check adjustments (if the table exists)
  BEGIN
    SELECT COUNT(*) INTO v_count FROM inventory_adjustments WHERE product_id = p_id;
    IF v_count > 0 THEN RETURN false; END IF;
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- ── Verify ──────────────────────────────────────────────────────
-- After running, these should all return without error:
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'inventory_shipment_headers' AND column_name LIKE 'expected_%' OR column_name LIKE 'variance_%';
--   SELECT routine_name FROM information_schema.routines WHERE routine_name = 'can_delete_product';
--   SELECT can_delete_product('00000000-0000-0000-0000-000000000000'::uuid);  -- should return true (no such product, no references)
