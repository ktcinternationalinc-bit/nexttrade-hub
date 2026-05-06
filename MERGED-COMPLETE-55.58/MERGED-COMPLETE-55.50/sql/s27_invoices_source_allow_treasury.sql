-- s27_invoices_source_allow_treasury.sql
-- Apr 25 2026
-- =============================================================
-- OPTIONAL — only run this if you want to distinguish invoices
-- that were created from the Treasury "+ Create Invoice Now"
-- workflow vs invoices created directly in the Sales tab.
--
-- The code already works without this SQL — invoices created
-- from Treasury just save with source='manual' (same value as
-- Sales tab invoices), which is what they were doing before
-- this whole feature got added anyway.
--
-- If you do run this, switch the page.jsx insert payload back
-- from source: 'manual' to source: 'treasury' (around line 12042
-- inside the green "Create Invoice + Save Treasury" button).
-- =============================================================

-- Backup the current invoices table just in case
CREATE TABLE IF NOT EXISTS invoices_backup_s27_20260425 AS
  SELECT * FROM invoices;

-- Drop the old constraint
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_source_check;

-- Add the new constraint that includes 'treasury'
ALTER TABLE invoices ADD CONSTRAINT invoices_source_check
  CHECK (source IN ('manual', 'import', 'treasury'));

-- Verify it took
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'invoices'::regclass
  AND conname = 'invoices_source_check';
