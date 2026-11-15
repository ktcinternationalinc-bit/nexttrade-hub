-- v55.83-A.6.27.7 (Max May 15 2026) — Shipping rates import quarantine
--
-- Bad-data rows detected during shipping rate import land here for the
-- user to review/fix/discard. Nothing in this table is ever displayed
-- in the chart or main rates table.
--
-- Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS shipping_rates_import_quarantine (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL,
  row_num INT NOT NULL,
  raw_row JSONB NOT NULL,
  errors JSONB NOT NULL,
  origin TEXT,
  destination TEXT,
  vendor_name TEXT,
  effective_date_raw TEXT,
  expiry_date_raw TEXT,
  rate_amount NUMERIC,
  imported_by UUID REFERENCES users(id) ON DELETE SET NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed BOOLEAN NOT NULL DEFAULT FALSE,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  outcome TEXT CHECK (outcome IN ('pending', 'fixed_imported', 'discarded'))
);

CREATE INDEX IF NOT EXISTS idx_quarantine_batch ON shipping_rates_import_quarantine(batch_id);
CREATE INDEX IF NOT EXISTS idx_quarantine_pending ON shipping_rates_import_quarantine(reviewed) WHERE reviewed = FALSE;

COMMENT ON TABLE shipping_rates_import_quarantine IS
  'Holding pen for shipping rate import rows that triggered bad-data patterns (same-day eff=exp, year<2020, expiry<effective, zero rate, etc.). Rows here are NOT in the main shipping_rates table and do not appear in any UI except a future quarantine review tab.';
