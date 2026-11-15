-- v55.83-A.6.27.58 — Multi-currency support for Open Accounts ledger.
--
-- Adds a `currency` column to open_account_entries so each entry tracks
-- its own currency independently. Same vendor/customer can now have a mix
-- of USD and EGP entries on the same ledger.
--
-- The column is backfilled from the account's entity default currency:
--   • Accounts tied to KTC International (ktc_intl) → entries get USD
--   • Accounts tied to KTC Egypt (ktc_egypt) → entries get EGP
--   • Accounts with no entity → entries get USD (last-resort default)
--
-- After migration, every entry has a currency. The app code then enforces
-- per-currency aggregation on the overview, the account cards, the printed
-- ledger, and the Excel export.
--
-- ALL CHANGES ARE FULLY REVERSIBLE — backout SQL at the bottom.

-- ──────────────────────────────────────────────────────────────────
-- 1. Add the currency column
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE open_account_entries
  ADD COLUMN IF NOT EXISTS currency text;

-- ──────────────────────────────────────────────────────────────────
-- 2. Smart backfill — inherit from account's entity default currency
-- ──────────────────────────────────────────────────────────────────
UPDATE open_account_entries e
SET currency = COALESCE(be.default_currency, 'USD')
FROM open_accounts a
LEFT JOIN business_entities be ON be.entity_code = a.business_entity_code
WHERE e.account_id = a.id
  AND e.currency IS NULL;

-- Catch any orphan entries (account got deleted but entry survives — shouldn't
-- happen because of CASCADE, but defensive)
UPDATE open_account_entries
SET currency = 'USD'
WHERE currency IS NULL;

-- ──────────────────────────────────────────────────────────────────
-- 3. Lock the column NOT NULL going forward
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE open_account_entries
  ALTER COLUMN currency SET NOT NULL,
  ALTER COLUMN currency SET DEFAULT 'USD';

-- ──────────────────────────────────────────────────────────────────
-- 4. Constraint: currency must be at least 2 chars (ISO 4217 = 3 chars
-- standard like USD/EGP/EUR; but allow 2+ for flexibility)
-- ──────────────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE open_account_entries
    ADD CONSTRAINT chk_entry_currency_not_blank CHECK (length(trim(currency)) >= 2);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ──────────────────────────────────────────────────────────────────
-- 5. Index for per-currency aggregation performance
-- ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_open_entries_currency ON open_account_entries (account_id, currency);

-- ──────────────────────────────────────────────────────────────────
-- VERIFY (run after migration to confirm)
-- ──────────────────────────────────────────────────────────────────
-- 1) Column exists and is NOT NULL:
--    SELECT column_name, data_type, is_nullable, column_default
--    FROM information_schema.columns
--    WHERE table_name='open_account_entries' AND column_name='currency';
--    Expect 1 row: currency, text, NO, 'USD'
--
-- 2) No entries are missing currency:
--    SELECT COUNT(*) FROM open_account_entries WHERE currency IS NULL;
--    Expect: 0
--
-- 3) Distribution of currencies (if you had data):
--    SELECT currency, COUNT(*) FROM open_account_entries GROUP BY currency;

-- ──────────────────────────────────────────────────────────────────
-- BACKOUT SQL (only if something goes catastrophically wrong)
-- ──────────────────────────────────────────────────────────────────
--   ALTER TABLE open_account_entries DROP CONSTRAINT IF EXISTS chk_entry_currency_not_blank;
--   DROP INDEX IF EXISTS idx_open_entries_currency;
--   ALTER TABLE open_account_entries DROP COLUMN IF EXISTS currency;
