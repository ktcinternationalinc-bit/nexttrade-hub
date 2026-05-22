-- v55.83-A.6.27.52 — Open Accounts ledger
--
-- ISOLATED CHANGE. Creates 2 new tables:
--   • open_accounts          — the master list of accounts you maintain ledgers for
--   • open_account_entries   — the ledger lines (credits and debits)
--
-- DOES NOT TOUCH:
--   • Treasury, invoices, customers, checks, US Bank, Egypt Bank, inventory
--   • Any existing column, index, RLS policy, trigger, or function
--
-- ALL CHANGES ARE FULLY REVERSIBLE. Backout SQL is at the bottom of this file.
--
-- Credit/debit convention (locked in for this build):
--   CREDIT = money IN to us (they paid us, or we received from them)
--   DEBIT  = money OUT from us (we paid them)
-- This is cash-flow oriented, NOT formal accounting convention.

-- ──────────────────────────────────────────────────────────────────
-- 1. open_accounts — master list of accounts with ledgers
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS open_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_name text NOT NULL,
  account_name_ar text,
  notes text,
  active boolean NOT NULL DEFAULT true,

  -- Audit
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_open_account_name_not_blank CHECK (length(trim(account_name)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_open_accounts_active ON open_accounts (active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_open_accounts_name ON open_accounts (lower(account_name));

-- ──────────────────────────────────────────────────────────────────
-- 2. open_account_entries — the ledger lines
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS open_account_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES open_accounts(id) ON DELETE CASCADE,

  entry_date date NOT NULL,
  description text NOT NULL,
  reference_number text,

  -- EXACTLY ONE of credit_amount / debit_amount must be set per entry.
  -- This is enforced by the CHECK constraint below.
  credit_amount numeric(14,2),
  debit_amount numeric(14,2),

  notes text,

  -- Audit
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- An entry is EITHER a credit OR a debit. Never both. Never neither.
  CONSTRAINT chk_entry_one_amount CHECK (
    (credit_amount IS NOT NULL AND debit_amount IS NULL AND credit_amount > 0) OR
    (debit_amount  IS NOT NULL AND credit_amount IS NULL AND debit_amount  > 0)
  ),
  CONSTRAINT chk_entry_description_not_blank CHECK (length(trim(description)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_open_entries_account ON open_account_entries (account_id);
CREATE INDEX IF NOT EXISTS idx_open_entries_date ON open_account_entries (account_id, entry_date);

-- ──────────────────────────────────────────────────────────────────
-- 3. RLS — open policies; app code enforces who-sees-what via the new
--    "Open Accounts" permission.
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE open_accounts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Allow all open_accounts" ON open_accounts FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE open_account_entries ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Allow all open_account_entries" ON open_account_entries FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ──────────────────────────────────────────────────────────────────
-- 4. updated_at triggers
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_open_accounts_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS open_accounts_updated_at ON open_accounts;
CREATE TRIGGER open_accounts_updated_at
  BEFORE UPDATE ON open_accounts
  FOR EACH ROW EXECUTE FUNCTION trg_open_accounts_updated_at();

DROP TRIGGER IF EXISTS open_account_entries_updated_at ON open_account_entries;
CREATE TRIGGER open_account_entries_updated_at
  BEFORE UPDATE ON open_account_entries
  FOR EACH ROW EXECUTE FUNCTION trg_open_accounts_updated_at();

-- ──────────────────────────────────────────────────────────────────
-- VERIFY (run these after migration to confirm success)
-- ──────────────────────────────────────────────────────────────────
-- SELECT to_regclass('public.open_accounts');
-- Expect: open_accounts
--
-- SELECT to_regclass('public.open_account_entries');
-- Expect: open_account_entries
--
-- SELECT COUNT(*) FROM open_accounts;
-- Expect: 0 (nothing seeded; you add accounts via the UI)
--
-- SELECT COUNT(*) FROM open_account_entries;
-- Expect: 0
--
-- Try inserting a test row to confirm the CHECK constraint works:
-- INSERT INTO open_accounts (account_name) VALUES ('Test Account');
-- INSERT INTO open_account_entries (account_id, entry_date, description, credit_amount)
--   SELECT id, CURRENT_DATE, 'Test credit', 100.00 FROM open_accounts WHERE account_name='Test Account';
-- Expect: success
--
-- INSERT INTO open_account_entries (account_id, entry_date, description, credit_amount, debit_amount)
--   SELECT id, CURRENT_DATE, 'Bad row', 100.00, 50.00 FROM open_accounts WHERE account_name='Test Account';
-- Expect: ERROR — both credit and debit set
--
-- DELETE FROM open_accounts WHERE account_name='Test Account';  -- cascades to entries

-- ──────────────────────────────────────────────────────────────────
-- BACKOUT SQL (only if something goes catastrophically wrong)
-- ──────────────────────────────────────────────────────────────────
-- Step 1: confirm what data exists before destroying anything
--   SELECT COUNT(*) FROM open_accounts;
--   SELECT COUNT(*) FROM open_account_entries;
--   -- If both are zero, backout is safe with no data loss.
--   -- If non-zero, decide whether you want to preserve the ledger data first.
--
-- Step 2: drop everything in reverse order
--   DROP TRIGGER IF EXISTS open_account_entries_updated_at ON open_account_entries;
--   DROP TRIGGER IF EXISTS open_accounts_updated_at ON open_accounts;
--   DROP FUNCTION IF EXISTS trg_open_accounts_updated_at();
--   DROP INDEX IF EXISTS idx_open_entries_date;
--   DROP INDEX IF EXISTS idx_open_entries_account;
--   DROP TABLE IF EXISTS open_account_entries;
--   DROP INDEX IF EXISTS idx_open_accounts_name;
--   DROP INDEX IF EXISTS idx_open_accounts_active;
--   DROP TABLE IF EXISTS open_accounts;
--
-- Step 3: confirm clean state
--   SELECT to_regclass('public.open_accounts');         -- Expect: NULL
--   SELECT to_regclass('public.open_account_entries');  -- Expect: NULL
--
-- Step 4: revert code via GitHub Desktop to the v55.83-A.6.27.51 commit.
