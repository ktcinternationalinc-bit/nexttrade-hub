-- ============================================
-- CHECKS TABLE UPGRADE — Post-dated Check System
-- Adds due_date, check_number, bank_name, invoice_id
-- Safe to run multiple times.
-- ============================================

-- Add proper due date (DATE type, not text)
ALTER TABLE checks ADD COLUMN IF NOT EXISTS due_date DATE;

-- Backfill due_date from check_date where possible
UPDATE checks SET due_date = check_date::date WHERE due_date IS NULL AND check_date IS NOT NULL AND check_date ~ '^\d{4}-\d{2}-\d{2}';

-- Add check number tracking
ALTER TABLE checks ADD COLUMN IF NOT EXISTS check_number TEXT;

-- Add bank name
ALTER TABLE checks ADD COLUMN IF NOT EXISTS bank_name TEXT;

-- Add invoice link
ALTER TABLE checks ADD COLUMN IF NOT EXISTS invoice_id UUID;

-- Index for due date lookups (alert queries)
CREATE INDEX IF NOT EXISTS idx_checks_due_date ON checks(due_date);
CREATE INDEX IF NOT EXISTS idx_checks_invoice ON checks(invoice_id);

-- Also ensure treasury has linked_invoice_id
ALTER TABLE treasury ADD COLUMN IF NOT EXISTS linked_invoice_id UUID;
CREATE INDEX IF NOT EXISTS idx_treasury_linked_invoice ON treasury(linked_invoice_id);

-- ─── VERIFY ───
SELECT column_name, data_type FROM information_schema.columns 
WHERE table_name = 'checks' AND column_name IN ('due_date','check_number','bank_name','invoice_id')
ORDER BY column_name;
