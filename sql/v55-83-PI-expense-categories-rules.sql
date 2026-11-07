-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-PI — EXPENSE CATEGORIES + SELF-LEARNING RULES + VERIFIED STAMP
--
-- Max (Nov 6): "we need to be able to create categories to mark expenses..
-- and should automatically remember previous selections for the future and
-- use them and have a verified tab.. but verified will not prevent it from
-- being counted against the expense and rules automatically saved and
-- updated if i manually change something. and have a rules tab to create
-- new rules for expenses."
--
-- WHAT THIS CREATES (idempotent, safe to run repeatedly):
--   1. expense_categories — YOUR OWN category list (the 11 built-ins seeded;
--      add as many as you want from the 🏷 Categories & Rules tab).
--   2. expense_rules — "if the bank description contains X → category Y".
--      source='learned' rows are written AUTOMATICALLY every time a human
--      categorizes an expense; changing your mind updates the same rule.
--   3. bank_transactions.category_verified (+ who/when) — the human stamp.
--      It is a flag ONLY: nothing anywhere excludes a verified (or
--      unverified) expense from expense totals.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1 ── Categories ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expense_categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key        text NOT NULL UNIQUE,          -- stable slug stored on transactions (classification)
  label      text NOT NULL,                 -- what humans see
  active     boolean NOT NULL DEFAULT true,
  sort       integer NOT NULL DEFAULT 100,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed the built-in classifications so ONE list drives every dropdown.
INSERT INTO expense_categories (key, label, sort) VALUES
  ('vendor_payment',      'Vendor payment',      10),
  ('payroll',             'Payroll',             20),
  ('bank_fee',            'Bank fee',            30),
  ('transfer',            'Transfer',            40),
  ('refund',              'Refund',              50),
  ('loan',                'Loan',                60),
  ('owner_contribution',  'Owner contribution',  70),
  ('customer_payment',    'Customer payment',    80),
  ('other_income',        'Other income',        90),
  ('other_expense',       'Other expense',       95),
  ('needs_clarification', 'Needs clarification', 99)
ON CONFLICT (key) DO NOTHING;

-- 2 ── Rules (manual + learned) ──────────────────────────────────────────────
-- NAMED us_expense_rules because a LEGACY public.expense_rules table (the old
-- Egypt-side categorize system: description_match/category) already exists and
-- stays untouched.
CREATE TABLE IF NOT EXISTS us_expense_rules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_text     text NOT NULL,             -- lowercase substring matched against merchant/description
  classification text NOT NULL,             -- expense_categories.key
  auto_apply     boolean NOT NULL DEFAULT true,
  active         boolean NOT NULL DEFAULT true,
  source         text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','learned')),
  hit_count      integer NOT NULL DEFAULT 0,
  last_hit_at    timestamptz,
  created_by     uuid,
  updated_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
-- One rule per match text — "remember previous selections": a manual change
-- UPDATES the existing rule instead of piling up contradictory ones.
CREATE UNIQUE INDEX IF NOT EXISTS us_expense_rules_match_uq ON us_expense_rules (lower(match_text));
CREATE INDEX IF NOT EXISTS us_expense_rules_active_ix ON us_expense_rules (active) WHERE active = true;

-- 3 ── Verified stamp on the transaction ─────────────────────────────────────
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS category_verified    boolean NOT NULL DEFAULT false;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS category_verified_by uuid;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS category_verified_at timestamptz;

-- 4 ── RLS: same open-authenticated pattern as the rest of accounting
--     (app authenticates by EMAIL, so auth.uid()-keyed policies match zero
--     rows — see v55-83-IN. App code enforces permissions.) DELETE stays
--     locked: categories/rules are deactivated, never erased.
ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE us_expense_rules ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY ecat_sel ON expense_categories FOR SELECT TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY ecat_ins ON expense_categories FOR INSERT TO authenticated WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY ecat_upd ON expense_categories FOR UPDATE TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY erul_sel ON us_expense_rules FOR SELECT TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY erul_ins ON us_expense_rules FOR INSERT TO authenticated WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY erul_upd ON us_expense_rules FOR UPDATE TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

SELECT 'v55.83-PI expense categories + rules installed' AS status,
  (SELECT count(*) FROM expense_categories) AS categories,
  (SELECT count(*) FROM us_expense_rules) AS rules;
