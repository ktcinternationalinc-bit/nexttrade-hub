-- v55.83-A.6.27.62 — Warehouse Advances workflow.
--
-- ──────────────────────────────────────────────────────────────────
-- WHAT THIS DOES (in plain English)
-- ──────────────────────────────────────────────────────────────────
-- Adds support for giving cash advances to people who'll spend it on
-- your behalf (warehouse manager, driver, broker, contractor, etc.).
--
-- Workflow:
--   1. You give Mohamed (warehouse manager) $5,000 on May 23, 2026.
--   2. Portal records the advance → debit in treasury → "Advance 5/23/26"
--   3. Mohamed buys stuff. Each expense in Warehouse Expenses points to
--      this advance (advance_id column).
--   4. Portal shows running balance: $5,000 issued, $3,200 spent, $1,800 left.
--   5. When balance hits zero (or you give another advance), the cycle repeats.
--
-- KEY DESIGN:
--   • Recipient is FREE TEXT — could be a team member, a driver, a broker,
--     a customs agent. Anyone receiving money. Not a FK to users.
--   • Each advance has its own currency (could be USD or EGP — different
--     workflows might use different cash).
--   • Each advance has a treasury entry created at issue time (DEBIT).
--   • Warehouse expenses CAN optionally be linked to an advance via
--     the new advance_id column. Expenses with NO advance_id are still
--     valid — they're just "company-paid" rather than "advance-spent".

-- ──────────────────────────────────────────────────────────────────
-- 1. warehouse_advances table
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS warehouse_advances (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- When and how much
  issue_date        DATE NOT NULL,
  amount            NUMERIC(14,2) NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'EGP',

  -- Who got it (free text — driver/manager/broker/etc.)
  recipient_name    TEXT NOT NULL,
  recipient_role    TEXT,                          -- optional, e.g. 'Warehouse Manager', 'Driver', 'Customs Broker'

  -- Purpose
  description       TEXT,                          -- e.g. "Q3 warehouse operations float"
  reference_number  TEXT,                          -- optional cross-reference

  -- Linked treasury debit (auto-created when advance issued)
  linked_treasury_id UUID,

  -- Status — open (still has remaining balance), closed (manually marked done)
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_at         TIMESTAMPTZ,
  closed_by         UUID,
  close_reason      TEXT,                          -- e.g. "Reconciled, returned $250 cash"

  -- Audit
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        UUID,

  CONSTRAINT chk_advance_amount_positive CHECK (amount > 0),
  CONSTRAINT chk_advance_currency_not_blank CHECK (length(trim(currency)) >= 2),
  CONSTRAINT chk_advance_recipient_not_blank CHECK (length(trim(recipient_name)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_warehouse_advances_issue_date ON warehouse_advances (issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_warehouse_advances_status     ON warehouse_advances (status) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_warehouse_advances_recipient  ON warehouse_advances (recipient_name);

-- ──────────────────────────────────────────────────────────────────
-- 2. Link column on warehouse_expenses
--    NULL = company-paid expense (current behavior — preserved).
--    NOT NULL = spent from a specific advance — adds to that advance's "spent" tally.
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE warehouse_expenses
  ADD COLUMN IF NOT EXISTS advance_id UUID;

DO $$ BEGIN
  ALTER TABLE warehouse_expenses
    ADD CONSTRAINT fk_expense_advance
      FOREIGN KEY (advance_id) REFERENCES warehouse_advances(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_warehouse_expenses_advance
  ON warehouse_expenses (advance_id) WHERE advance_id IS NOT NULL;

-- ──────────────────────────────────────────────────────────────────
-- 3. Helper view: advances with running totals
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW warehouse_advances_summary AS
SELECT
  a.id,
  a.issue_date,
  a.amount AS issued_amount,
  a.currency,
  a.recipient_name,
  a.recipient_role,
  a.description,
  a.status,
  a.closed_at,
  a.close_reason,
  a.linked_treasury_id,
  a.created_by,
  a.created_at,
  COALESCE(SUM(e.amount), 0) AS spent_amount,
  a.amount - COALESCE(SUM(e.amount), 0) AS remaining_amount,
  COUNT(e.id) AS expense_count
FROM warehouse_advances a
LEFT JOIN warehouse_expenses e ON e.advance_id = a.id
GROUP BY a.id, a.issue_date, a.amount, a.currency, a.recipient_name, a.recipient_role,
         a.description, a.status, a.closed_at, a.close_reason, a.linked_treasury_id,
         a.created_by, a.created_at;

-- ──────────────────────────────────────────────────────────────────
-- 4. RLS — permissive, app-level access control
-- ──────────────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE warehouse_advances ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Allow all on warehouse_advances" ON warehouse_advances FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ──────────────────────────────────────────────────────────────────
-- 5. updated_at trigger
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_warehouse_advance_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER trg_warehouse_advance_updated_at
    BEFORE UPDATE ON warehouse_advances
    FOR EACH ROW EXECUTE FUNCTION trg_warehouse_advance_set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ──────────────────────────────────────────────────────────────────
-- VERIFY (run after migration)
-- ──────────────────────────────────────────────────────────────────
-- 1) Table + view exist:
--    SELECT table_name, table_type FROM information_schema.tables
--    WHERE table_name IN ('warehouse_advances', 'warehouse_advances_summary')
--    ORDER BY table_name;
--    Expected: 2 rows
--
-- 2) Link column exists with FK:
--    SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name='warehouse_expenses' AND column_name='advance_id';
--    Expected: advance_id, uuid
--
-- 3) FK constraint exists:
--    SELECT conname FROM pg_constraint WHERE conname='fk_expense_advance';
--    Expected: 1 row

-- ──────────────────────────────────────────────────────────────────
-- BACKOUT (only if catastrophic)
-- ──────────────────────────────────────────────────────────────────
--   DROP VIEW IF EXISTS warehouse_advances_summary;
--   ALTER TABLE warehouse_expenses DROP CONSTRAINT IF EXISTS fk_expense_advance;
--   DROP INDEX IF EXISTS idx_warehouse_expenses_advance;
--   ALTER TABLE warehouse_expenses DROP COLUMN IF EXISTS advance_id;
--   DROP TABLE IF EXISTS warehouse_advances;
--   DROP FUNCTION IF EXISTS trg_warehouse_advance_set_updated_at();
