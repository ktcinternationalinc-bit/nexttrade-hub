-- v55.83-A.6.21 (Max May 14 2026) — Inventory Stage B: reconciliation columns
--
-- Adds the three columns the ShipmentsManager UI writes to when the user
-- reconciles a received shipment line item: actual qty received, the variance
-- vs expected, and a reason if non-zero. Idempotent.
--
-- Run this once in Supabase SQL Editor after the v55.83-A inventory schema
-- (sql/v55-83-a-inventory-schema.sql) is already in place.

ALTER TABLE inv_shipment_skus
  ADD COLUMN IF NOT EXISTS qty_received_actual NUMERIC(14,3),
  ADD COLUMN IF NOT EXISTS variance NUMERIC(14,3),
  ADD COLUMN IF NOT EXISTS variance_reason TEXT;

COMMENT ON COLUMN inv_shipment_skus.qty_received_actual IS
  'Actual qty physically received, set during reconciliation. NULL = not reconciled yet.';
COMMENT ON COLUMN inv_shipment_skus.variance IS
  'Computed as qty_received_actual − qty_primary (expected). + = over, − = short, 0 = exact.';
COMMENT ON COLUMN inv_shipment_skus.variance_reason IS
  'Human-entered reason for non-zero variance (damaged, short shipment, etc.).';

-- Verify the columns exist
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'inv_shipment_skus'
  AND column_name IN ('qty_received_actual', 'variance', 'variance_reason');
