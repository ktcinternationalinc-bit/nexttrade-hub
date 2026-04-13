-- ============================================
-- NEXTTRADE HUB — COMBINED MIGRATION
-- Run this once in Supabase SQL Editor
-- Safe to run multiple times (IF NOT EXISTS)
-- ============================================

-- ─── CHECKS: Post-dated check system ───
ALTER TABLE checks ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE checks ADD COLUMN IF NOT EXISTS check_number TEXT;
ALTER TABLE checks ADD COLUMN IF NOT EXISTS bank_name TEXT;
ALTER TABLE checks ADD COLUMN IF NOT EXISTS invoice_id UUID;
CREATE INDEX IF NOT EXISTS idx_checks_due_date ON checks(due_date);
CREATE INDEX IF NOT EXISTS idx_checks_invoice ON checks(invoice_id);

-- Backfill due_date from check_date where possible
UPDATE checks SET due_date = check_date::date 
WHERE due_date IS NULL AND check_date IS NOT NULL AND check_date ~ '^\d{4}-\d{2}-\d{2}';

-- ─── TREASURY: Invoice linking ───
ALTER TABLE treasury ADD COLUMN IF NOT EXISTS linked_invoice_id UUID;
CREATE INDEX IF NOT EXISTS idx_treasury_linked_invoice ON treasury(linked_invoice_id);

-- ─── VERIFY ───
SELECT 'checks' as tbl, column_name FROM information_schema.columns 
WHERE table_name = 'checks' AND column_name IN ('due_date','check_number','bank_name','invoice_id')
UNION ALL
SELECT 'treasury', column_name FROM information_schema.columns 
WHERE table_name = 'treasury' AND column_name = 'linked_invoice_id';
