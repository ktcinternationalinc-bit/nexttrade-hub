-- ============================================
-- TREASURY → INVOICE LINKING
-- Adds linked_invoice_id to treasury table
-- so treasury cash-in transactions can be
-- explicitly linked to invoices.
-- Safe to run multiple times.
-- ============================================

-- Add linked_invoice_id column to treasury
ALTER TABLE treasury ADD COLUMN IF NOT EXISTS linked_invoice_id UUID;

-- Comment
COMMENT ON COLUMN treasury.linked_invoice_id IS 'FK to invoices — links this treasury cash-in entry to a specific invoice. When linked, the cash_in amount is added to the invoice total_collected.';

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_treasury_linked_invoice ON treasury(linked_invoice_id);

-- ─── VERIFY ───
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'treasury' AND column_name = 'linked_invoice_id';
