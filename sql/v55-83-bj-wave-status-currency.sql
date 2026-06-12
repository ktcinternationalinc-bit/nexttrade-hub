-- ============================================================
-- v55.83-BJ — Store Wave status + currency on each accounting invoice so the
-- dashboard can (a) exclude drafts from AR and (b) stop summing EGP with USD.
-- Additive + idempotent. RLS already enabled/open on accounting_invoices.
-- After running this, RE-IMPORT invoices so wave_status + currency populate.
-- ============================================================
ALTER TABLE accounting_invoices ADD COLUMN IF NOT EXISTS wave_status text;
ALTER TABLE accounting_invoices ADD COLUMN IF NOT EXISTS currency    text DEFAULT 'USD';
