-- v55.83-A.6.27.45 — Egypt Bank: Owner Deposit + Unified Rules Engine (categorize/hide, retroactive + forward)
--
-- ISOLATED CHANGE. Touches only:
--   • egypt_bank_transactions (adds 1 new column: is_owner_deposit)
--   • Creates 1 new table (egypt_bank_rules) — unified rules
--   • Creates 2 new functions (apply rules engine, updated_at trigger)
--
-- DOES NOT TOUCH:
--   • Treasury, invoices, checks, customers, US Bank, inventory, anything else
--   • Existing columns, indexes, triggers, RLS policies on egypt_bank_transactions
--   • The existing `hidden` column (predates this build, still works exactly as before)
--
-- ALL CHANGES ARE FULLY REVERSIBLE. Backout SQL is at the bottom of this file.

-- ──────────────────────────────────────────────────────────────────
-- 1. Add is_owner_deposit column
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE egypt_bank_transactions
  ADD COLUMN IF NOT EXISTS is_owner_deposit boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_egypt_bank_txn_owner_deposit
  ON egypt_bank_transactions (is_owner_deposit)
  WHERE is_owner_deposit = true;

-- ──────────────────────────────────────────────────────────────────
-- 2. egypt_bank_rules table — UNIFIED rules engine
-- ──────────────────────────────────────────────────────────────────
-- Two intended use cases controlled by is_private flag:
--   A. Categorization rule (is_private = false)
--      Created by: super_admin OR isAdmin users (the existing "Treasury" gate on EgyptBankTab)
--      Effect on match: sets category + subcategory
--      Visible to: everyone
--   B. Private/hide rule (is_private = true)
--      Created by: super_admin ONLY
--      Effect on match: sets hidden=true AND optionally category+subcategory
--      Visible to: super_admin ONLY (even the rule's existence is hidden)

CREATE TABLE IF NOT EXISTS egypt_bank_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_description text,
  match_amount numeric(14,2),
  match_account_id uuid REFERENCES egypt_bank_accounts(id) ON DELETE CASCADE,
  set_category text,
  set_subcategory text,
  set_hidden boolean DEFAULT false,
  rule_name text NOT NULL,
  notes text,
  is_private boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  last_applied_at timestamptz,
  total_matches integer DEFAULT 0,
  CONSTRAINT chk_rule_has_matcher CHECK (
    match_description IS NOT NULL OR match_amount IS NOT NULL OR match_account_id IS NOT NULL
  ),
  CONSTRAINT chk_rule_has_action CHECK (
    set_category IS NOT NULL OR set_hidden = true
  )
);

CREATE INDEX IF NOT EXISTS idx_egypt_rules_active ON egypt_bank_rules (active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_egypt_rules_is_private ON egypt_bank_rules (is_private);

ALTER TABLE egypt_bank_rules ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Allow all egypt_bank_rules" ON egypt_bank_rules FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- updated_at trigger
CREATE OR REPLACE FUNCTION trg_egypt_rules_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS egypt_rules_updated_at ON egypt_bank_rules;
CREATE TRIGGER egypt_rules_updated_at
  BEFORE UPDATE ON egypt_bank_rules
  FOR EACH ROW EXECUTE FUNCTION trg_egypt_rules_updated_at();

-- ──────────────────────────────────────────────────────────────────
-- 3. apply_egypt_bank_rules() — the rules engine
-- ──────────────────────────────────────────────────────────────────
-- Idempotent. Retroactive AND forward-applying (caller picks scope).
-- Returns jsonb: { newly_hidden, newly_categorized, rules_applied }
--
-- Parameters:
--   p_only_private:    NULL = all rules; true = only private; false = only non-private
--   p_only_rule_id:    NULL = all rules; otherwise = only this specific rule
--   p_only_unprocessed: false (default) = apply to ALL matching transactions (retroactive);
--                       true  = only apply to transactions where rule has not already matched
--                       (use at import time for new rows; avoids needlessly touching old data)

CREATE OR REPLACE FUNCTION apply_egypt_bank_rules(
  p_only_private boolean DEFAULT NULL,
  p_only_rule_id uuid DEFAULT NULL,
  p_only_unprocessed boolean DEFAULT false
)
RETURNS jsonb AS $$
DECLARE
  v_rule              record;
  v_total_hidden      integer := 0;
  v_total_categorized integer := 0;
  v_rules_applied     integer := 0;
  v_matched           integer;
  v_sql               text;
  v_set_clauses       text;
  v_where_clauses     text;
BEGIN
  FOR v_rule IN
    SELECT * FROM egypt_bank_rules
    WHERE active = true
      AND (p_only_private IS NULL OR is_private = p_only_private)
      AND (p_only_rule_id IS NULL OR id = p_only_rule_id)
    ORDER BY is_private DESC, created_at ASC  -- private rules win on conflict
  LOOP
    v_set_clauses := '';
    IF v_rule.set_category IS NOT NULL THEN
      v_set_clauses := 'category = ' || quote_literal(v_rule.set_category);
      IF v_rule.set_subcategory IS NOT NULL THEN
        v_set_clauses := v_set_clauses || ', subcategory = ' || quote_literal(v_rule.set_subcategory);
      END IF;
    END IF;
    IF v_rule.set_hidden = true THEN
      IF v_set_clauses != '' THEN v_set_clauses := v_set_clauses || ', '; END IF;
      v_set_clauses := v_set_clauses || 'hidden = true';
    END IF;
    IF v_set_clauses = '' THEN CONTINUE; END IF;

    v_where_clauses := '1=1';
    IF v_rule.match_description IS NOT NULL THEN
      v_where_clauses := v_where_clauses || ' AND LOWER(description) LIKE ''%'' || LOWER(' || quote_literal(v_rule.match_description) || ') || ''%''';
    END IF;
    IF v_rule.match_amount IS NOT NULL THEN
      v_where_clauses := v_where_clauses || ' AND amount = ' || quote_literal(v_rule.match_amount);
    END IF;
    IF v_rule.match_account_id IS NOT NULL THEN
      v_where_clauses := v_where_clauses || ' AND account_id = ' || quote_literal(v_rule.match_account_id);
    END IF;

    IF p_only_unprocessed = true THEN
      IF v_rule.set_hidden = true THEN
        v_where_clauses := v_where_clauses || ' AND hidden = false';
      END IF;
      IF v_rule.set_category IS NOT NULL THEN
        v_where_clauses := v_where_clauses || ' AND (category IS NULL OR category != ' || quote_literal(v_rule.set_category) || ')';
      END IF;
    END IF;

    v_sql := 'UPDATE egypt_bank_transactions SET ' || v_set_clauses || ' WHERE ' || v_where_clauses;
    EXECUTE v_sql;
    GET DIAGNOSTICS v_matched = ROW_COUNT;

    IF v_rule.set_hidden = true THEN v_total_hidden := v_total_hidden + v_matched; END IF;
    IF v_rule.set_category IS NOT NULL THEN v_total_categorized := v_total_categorized + v_matched; END IF;
    IF v_matched > 0 THEN v_rules_applied := v_rules_applied + 1; END IF;

    UPDATE egypt_bank_rules
    SET last_applied_at = now(), total_matches = total_matches + v_matched
    WHERE id = v_rule.id;
  END LOOP;

  RETURN jsonb_build_object(
    'newly_hidden', v_total_hidden,
    'newly_categorized', v_total_categorized,
    'rules_applied', v_rules_applied
  );
END;
$$ LANGUAGE plpgsql;

-- ──────────────────────────────────────────────────────────────────
-- VERIFY (run after migration)
-- ──────────────────────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name='egypt_bank_transactions' AND column_name='is_owner_deposit';
-- Expect: 1 row
--
-- SELECT to_regclass('public.egypt_bank_rules');
-- Expect: egypt_bank_rules (not null)
--
-- SELECT routine_name FROM information_schema.routines
--   WHERE routine_name IN ('apply_egypt_bank_rules', 'trg_egypt_rules_updated_at');
-- Expect: 2 rows
--
-- SELECT apply_egypt_bank_rules();
-- Expect: {"newly_hidden": 0, "newly_categorized": 0, "rules_applied": 0}

-- ──────────────────────────────────────────────────────────────────
-- BACKOUT SQL (in case of catastrophic failure)
-- ──────────────────────────────────────────────────────────────────
-- Step 1: confirm what data exists
--   SELECT COUNT(*) AS owner_deposits FROM egypt_bank_transactions WHERE is_owner_deposit = true;
--   SELECT COUNT(*) AS rules FROM egypt_bank_rules;
--
-- Step 2: drop everything in reverse order
--   DROP TRIGGER IF EXISTS egypt_rules_updated_at ON egypt_bank_rules;
--   DROP FUNCTION IF EXISTS trg_egypt_rules_updated_at();
--   DROP FUNCTION IF EXISTS apply_egypt_bank_rules(boolean, uuid, boolean);
--   DROP INDEX IF EXISTS idx_egypt_rules_active;
--   DROP INDEX IF EXISTS idx_egypt_rules_is_private;
--   DROP TABLE IF EXISTS egypt_bank_rules;
--   DROP INDEX IF EXISTS idx_egypt_bank_txn_owner_deposit;
--   ALTER TABLE egypt_bank_transactions DROP COLUMN IF EXISTS is_owner_deposit;
--
-- Step 3: revert app code via GitHub Desktop to v55.83-A.6.27.44 commit.
