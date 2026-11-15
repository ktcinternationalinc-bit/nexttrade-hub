-- v55.83-IQ — pull Wave ESTIMATES into the Hub as PROFORMAS, scoped per silo.
--
-- accounting_proformas already had wave_estimate_id + wave_sync_status (v55.83-AH) but was missing
-- the per-silo tag + currency/status/provenance needed to import + scope estimates per Wave business.
-- This adds them (idempotent) and a unique index so re-imports update instead of duplicating.

ALTER TABLE accounting_proformas ADD COLUMN IF NOT EXISTS wave_business_id text;
ALTER TABLE accounting_proformas ADD COLUMN IF NOT EXISTS currency        text DEFAULT 'USD';
ALTER TABLE accounting_proformas ADD COLUMN IF NOT EXISTS wave_status     text;   -- Wave estimate status (DRAFT/SENT/ACCEPTED/...)
ALTER TABLE accounting_proformas ADD COLUMN IF NOT EXISTS source          text;   -- 'wave_import' for pulled estimates
ALTER TABLE accounting_proformas ADD COLUMN IF NOT EXISTS is_historical   boolean DEFAULT false;
ALTER TABLE accounting_proformas ADD COLUMN IF NOT EXISTS last_synced_at  timestamptz;

-- One Wave estimate maps to one Hub proforma per business (dedupe key for re-import).
CREATE UNIQUE INDEX IF NOT EXISTS uq_acct_proformas_wave_estimate
  ON accounting_proformas (wave_estimate_id) WHERE wave_estimate_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_acct_proformas_wave_business
  ON accounting_proformas (wave_business_id);

-- accounting_proforma_items (line items) — ensure the Wave-line provenance column exists.
ALTER TABLE accounting_proforma_items ADD COLUMN IF NOT EXISTS proforma_id uuid;

-- ──────────────────────────────────────────────────────────────────
-- VERIFY: SELECT column_name FROM information_schema.columns
--   WHERE table_name='accounting_proformas'
--     AND column_name IN ('wave_business_id','currency','wave_status','source','is_historical');
--   Expected: 5 rows. Then run Wave Import → "Import estimates" for a silo and check the Proformas tab.
