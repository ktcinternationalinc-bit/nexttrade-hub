-- ============================================================
-- v55.83-AT — Invoice import + future bidirectional-sync readiness.
-- Additive only. These columns let a later hourly Wave<->Hub sync detect
-- changes and conflicts without re-importing blind. Run before deploying AT.
-- ============================================================

-- invoices: sync fingerprint + due date
ALTER TABLE accounting_invoices ADD COLUMN IF NOT EXISTS due_date date;
ALTER TABLE accounting_invoices ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;
ALTER TABLE accounting_invoices ADD COLUMN IF NOT EXISTS last_synced_hash text;

-- customers: placeholder-review flag (for invoices whose Wave customer wasn't
-- imported) + sync fingerprint
ALTER TABLE accounting_customers ADD COLUMN IF NOT EXISTS needs_review boolean DEFAULT false;
ALTER TABLE accounting_customers ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;
ALTER TABLE accounting_customers ADD COLUMN IF NOT EXISTS last_synced_hash text;

-- wave_sync_log: per-run timing (started/completed already covered by attempted_at;
-- add explicit started/completed for the hourly job later)
ALTER TABLE wave_sync_log ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE wave_sync_log ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE wave_sync_log ADD COLUMN IF NOT EXISTS records_pulled int;
ALTER TABLE wave_sync_log ADD COLUMN IF NOT EXISTS records_pushed int;
