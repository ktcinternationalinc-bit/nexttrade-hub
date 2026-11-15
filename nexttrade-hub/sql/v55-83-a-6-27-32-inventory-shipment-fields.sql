-- v55.83-A.6.27.32 — Inventory Phase 1 Build 4.1: Missing shipment fields
--
-- Brings the new Receive Stock schema up to parity with the old Shipments form
-- by adding the header-level and line-level fields that were missing, plus
-- extends the status enum to include 'received' and 'finalized' for the
-- cost-finalization flow that Build 4.2 will use.
--
-- Purely additive. Existing rows keep working — new columns are nullable
-- and the old status values ('active','cancelled') still validate.
--
-- Run this in Supabase SQL editor BEFORE deploying the v55.83-A.6.27.32 code.

-- ── Header-level fields ────────────────────────────────────────────
ALTER TABLE inventory_stock_receipts ADD COLUMN IF NOT EXISTS shipment_reference text;
ALTER TABLE inventory_stock_receipts ADD COLUMN IF NOT EXISTS freight_forwarder text;
ALTER TABLE inventory_stock_receipts ADD COLUMN IF NOT EXISTS shipping_line text;
ALTER TABLE inventory_stock_receipts ADD COLUMN IF NOT EXISTS eta_date date;
ALTER TABLE inventory_stock_receipts ADD COLUMN IF NOT EXISTS arrival_date date;
ALTER TABLE inventory_stock_receipts ADD COLUMN IF NOT EXISTS purchase_currency text;

-- ── Per-line fields ────────────────────────────────────────────────
ALTER TABLE inventory_stock_receipts ADD COLUMN IF NOT EXISTS quantity_kg numeric;
ALTER TABLE inventory_stock_receipts ADD COLUMN IF NOT EXISTS roll_count integer;
ALTER TABLE inventory_stock_receipts ADD COLUMN IF NOT EXISTS line_notes text;
ALTER TABLE inventory_stock_receipts ADD COLUMN IF NOT EXISTS ordered_quantity numeric;
ALTER TABLE inventory_stock_receipts ADD COLUMN IF NOT EXISTS variance_reason text;

-- ── Status enum extension ──────────────────────────────────────────
-- Drop the old constraint and replace with one that includes 'received' and 'finalized'.
-- 'active' is kept for backward compatibility with existing rows.
ALTER TABLE inventory_stock_receipts DROP CONSTRAINT IF EXISTS chk_status;
ALTER TABLE inventory_stock_receipts ADD CONSTRAINT chk_status
  CHECK (status IN ('active','received','finalized','cancelled'));

-- ── New currency check on purchase_currency ────────────────────────
ALTER TABLE inventory_stock_receipts DROP CONSTRAINT IF EXISTS chk_purchase_currency;
ALTER TABLE inventory_stock_receipts ADD CONSTRAINT chk_purchase_currency
  CHECK (purchase_currency IS NULL OR purchase_currency IN ('EGP','USD','EUR'));

-- ── New indexes for filtering ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_stock_receipts_shipment_ref ON inventory_stock_receipts (shipment_reference) WHERE shipment_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_receipts_arrival     ON inventory_stock_receipts (arrival_date)        WHERE arrival_date IS NOT NULL;

-- ── Verify ─────────────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'inventory_stock_receipts' AND column_name IN
--   ('shipment_reference','freight_forwarder','shipping_line','eta_date',
--    'arrival_date','purchase_currency','quantity_kg','roll_count',
--    'line_notes','ordered_quantity','variance_reason');
-- Expect: 11 rows
