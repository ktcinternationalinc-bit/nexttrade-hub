-- ============================================================
-- v55.83-AO — Lifecycle (active/void/cancelled/archived) foundation for the
-- controlled delete/void/archive rules. Additive only. The guard logic + UI
-- buttons ship in the next build; this just adds the columns they need.
-- ============================================================
ALTER TABLE accounting_invoices  ADD COLUMN IF NOT EXISTS record_status text DEFAULT 'active'; -- active | void | cancelled | archived
ALTER TABLE accounting_invoices  ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE accounting_invoices  ADD COLUMN IF NOT EXISTS archived_by uuid;
ALTER TABLE accounting_invoices  ADD COLUMN IF NOT EXISTS void_reason text;

ALTER TABLE accounting_proformas ADD COLUMN IF NOT EXISTS record_status text DEFAULT 'active'; -- active | void | cancelled | archived
ALTER TABLE accounting_proformas ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE accounting_proformas ADD COLUMN IF NOT EXISTS archived_by uuid;

ALTER TABLE accounting_customers ADD COLUMN IF NOT EXISTS record_status text DEFAULT 'active'; -- active | archived
ALTER TABLE accounting_customers ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE accounting_customers ADD COLUMN IF NOT EXISTS archived_by uuid;
