-- ============================================================
-- v55.83-AR — LIFECYCLE EXECUTION FIX. Two problems:
--  (1) Archive/Void wrote to record_status/void_reason which may not exist
--      (AO SQL not fully run) -> silently dropped. Re-add (safe if present).
--  (2) DELETE was locked USING(false) on the accounting record tables, so the
--      app-guarded hard delete was silently refused. Re-open DELETE; the
--      record-lifecycle guard in app code already blocks protected records.
-- Safe to run multiple times.
-- ============================================================

-- (1) lifecycle columns (idempotent)
ALTER TABLE accounting_invoices  ADD COLUMN IF NOT EXISTS record_status text DEFAULT 'active';
ALTER TABLE accounting_invoices  ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE accounting_invoices  ADD COLUMN IF NOT EXISTS archived_by uuid;
ALTER TABLE accounting_invoices  ADD COLUMN IF NOT EXISTS void_reason text;
ALTER TABLE accounting_proformas ADD COLUMN IF NOT EXISTS record_status text DEFAULT 'active';
ALTER TABLE accounting_proformas ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE accounting_proformas ADD COLUMN IF NOT EXISTS archived_by uuid;
ALTER TABLE accounting_customers ADD COLUMN IF NOT EXISTS record_status text DEFAULT 'active';
ALTER TABLE accounting_customers ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE accounting_customers ADD COLUMN IF NOT EXISTS archived_by uuid;

-- (2) re-open DELETE (app-side record-lifecycle guard enforces who/what)
DROP POLICY IF EXISTS ac_del ON accounting_customers;
CREATE POLICY ac_del ON accounting_customers FOR DELETE TO authenticated USING (true);
DROP POLICY IF EXISTS ai_del ON accounting_invoices;
CREATE POLICY ai_del ON accounting_invoices FOR DELETE TO authenticated USING (true);
DROP POLICY IF EXISTS ap_del ON accounting_proformas;
CREATE POLICY ap_del ON accounting_proformas FOR DELETE TO authenticated USING (true);
