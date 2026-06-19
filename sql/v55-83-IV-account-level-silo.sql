-- v55.83-IV — ACCOUNT-LEVEL bank→silo mapping (Codex/Max launch blocker).
--
-- Until now a whole Plaid CONNECTION was assigned to one Wave silo and every transaction inherited
-- it. But Max's rule is per ACCOUNT: 6353 => KANDIL EGYPT, 6338 => Real KTC Production. If those
-- accounts ever share a connection (or a relink brings multiple accounts), connection-level stamping
-- bleeds them into one silo. This adds per-account assignment on plaid_accounts; ingestion + a repair
-- action stamp each bank_transaction by its OWN account.

ALTER TABLE plaid_accounts ADD COLUMN IF NOT EXISTS wave_business_id   text;
ALTER TABLE plaid_accounts ADD COLUMN IF NOT EXISTS assigned_by        uuid;
ALTER TABLE plaid_accounts ADD COLUMN IF NOT EXISTS assigned_at        timestamptz;
ALTER TABLE plaid_accounts ADD COLUMN IF NOT EXISTS assignment_source  text;  -- 'manual' | 'connection_default' | 'repair'

-- Fast map build during ingestion (plaid_account_id -> wave_business_id).
CREATE INDEX IF NOT EXISTS idx_plaid_accounts_assignment
  ON plaid_accounts (plaid_account_id, wave_business_id);

-- VERIFY:
-- SELECT plaid_account_id, mask, name, wave_business_id FROM plaid_accounts ORDER BY mask;
--   After assigning: 6338 -> Real KTC wave_business_id, 6353 -> Kandil wave_business_id.
-- Then a Plaid sync (or the repair action) stamps bank_transactions.wave_business_id by account_id,
-- and Bank Tab / Bank Review (which scope by wave_business_id) show each account under the right silo.
