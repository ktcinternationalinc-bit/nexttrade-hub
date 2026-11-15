-- ============================================================
-- v55.83-BG — Overdue dashboard "Ignore" controls. Lets the owner hide a
-- specific overdue invoice from dashboard overdue reporting WITHOUT deleting it
-- or touching Wave. Reversible + audited. Additive + idempotent.
-- ============================================================
ALTER TABLE accounting_invoices ADD COLUMN IF NOT EXISTS overdue_dashboard_ignored    boolean DEFAULT false;
ALTER TABLE accounting_invoices ADD COLUMN IF NOT EXISTS overdue_dashboard_ignored_by uuid;
ALTER TABLE accounting_invoices ADD COLUMN IF NOT EXISTS overdue_dashboard_ignored_at timestamptz;
ALTER TABLE accounting_invoices ADD COLUMN IF NOT EXISTS overdue_dashboard_ignore_note text;
