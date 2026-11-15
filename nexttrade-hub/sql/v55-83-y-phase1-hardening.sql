-- ============================================================
-- v55.83-Y — PHASE 1 HARDENING (run AFTER v55.83-X). Additive + idempotent.
-- Tightens RLS, backfills business_id, adds audit fields + updated_at trigger,
-- and supports the credit-account flag. Safe to re-run.
-- ============================================================

-- 1) Business foundation (single business now; multi-business later, no rebuild)
CREATE TABLE IF NOT EXISTS businesses (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
INSERT INTO businesses (name)
SELECT 'KTC International Inc.'
WHERE NOT EXISTS (SELECT 1 FROM businesses);

-- Membership = the source of truth for per-user business access (drives RLS).
-- ASSUMPTION: users.id equals the Supabase auth user id (auth.uid()). If your
-- auth id lives in a different column, change u.id below to that column.
CREATE TABLE IF NOT EXISTS user_business_memberships (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  business_id uuid NOT NULL,
  role text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, business_id)
);
DO $$ BEGIN ALTER TABLE user_business_memberships ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY ubm_self ON user_business_memberships FOR SELECT TO authenticated USING (user_id = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Seed: every current user belongs to the single business.
INSERT INTO user_business_memberships (user_id, business_id, role)
SELECT u.id, (SELECT id FROM businesses ORDER BY created_at LIMIT 1), 'member'
FROM users u
ON CONFLICT (user_id, business_id) DO NOTHING;

-- Helper: businesses the current auth user may access (SECURITY DEFINER so it can
-- read memberships regardless of that table's own RLS).
CREATE OR REPLACE FUNCTION app_user_business_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT business_id FROM user_business_memberships WHERE user_id = auth.uid()
$$;

-- 2) business_id backfill (Item 2) — connections + transactions -> the one business
UPDATE bank_connections
   SET business_id = (SELECT id FROM businesses ORDER BY created_at LIMIT 1)
 WHERE business_id IS NULL;
UPDATE bank_transactions
   SET business_id = (SELECT id FROM businesses ORDER BY created_at LIMIT 1)
 WHERE business_id IS NULL;

-- 3) Audit fields (Item 3) + credit-account columns (Item 5)
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS created_by          uuid;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS updated_by          uuid;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS account_type        text;     -- depository|credit|loan|investment
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS account_subtype     text;     -- checking|savings|credit card|...
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS unsupported_account boolean DEFAULT false;
ALTER TABLE bank_transaction_splits ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE bank_transaction_splits ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- updated_at trigger (Item 3)
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_bank_txn_updated ON bank_transactions;
CREATE TRIGGER trg_bank_txn_updated BEFORE UPDATE ON bank_transactions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_bank_splits_updated ON bank_transaction_splits;
CREATE TRIGGER trg_bank_splits_updated BEFORE UPDATE ON bank_transaction_splits
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 4) Production RLS (Item 1 + Item 6) — replace the dev-open USING(true) policies.
--    Row visibility is scoped to the user's business via app_user_business_ids().
--    Deletion is DISABLED for client sessions (Item 6) — admin/system deletes go
--    through the service role (which bypasses RLS) in the API layer.
--    NOTE: the service-role API path is unaffected (it bypasses RLS). Column-level
--    "See Amounts" and action gating (View/Classify) are enforced in the app/API
--    layer in Phase 2, consistent with how the rest of the app enforces permissions.

-- splits
DROP POLICY IF EXISTS bts_sel ON bank_transaction_splits;
DROP POLICY IF EXISTS bts_ins ON bank_transaction_splits;
DROP POLICY IF EXISTS bts_upd ON bank_transaction_splits;
DROP POLICY IF EXISTS bts_del ON bank_transaction_splits;
CREATE POLICY bts_sel ON bank_transaction_splits FOR SELECT TO authenticated
  USING (business_id IN (SELECT app_user_business_ids()));
CREATE POLICY bts_ins ON bank_transaction_splits FOR INSERT TO authenticated
  WITH CHECK (business_id IN (SELECT app_user_business_ids()));
CREATE POLICY bts_upd ON bank_transaction_splits FOR UPDATE TO authenticated
  USING (business_id IN (SELECT app_user_business_ids()));
CREATE POLICY bts_del ON bank_transaction_splits FOR DELETE TO authenticated USING (false);

-- transactions
DROP POLICY IF EXISTS bt_sel ON bank_transactions;
DROP POLICY IF EXISTS bt_ins ON bank_transactions;
DROP POLICY IF EXISTS bt_upd ON bank_transactions;
DROP POLICY IF EXISTS bt_del ON bank_transactions;
CREATE POLICY bt_sel ON bank_transactions FOR SELECT TO authenticated
  USING (business_id IN (SELECT app_user_business_ids()));
CREATE POLICY bt_ins ON bank_transactions FOR INSERT TO authenticated
  WITH CHECK (business_id IN (SELECT app_user_business_ids()));
CREATE POLICY bt_upd ON bank_transactions FOR UPDATE TO authenticated
  USING (business_id IN (SELECT app_user_business_ids()));
CREATE POLICY bt_del ON bank_transactions FOR DELETE TO authenticated USING (false);

-- 5) Sign-convention verification (Item 4) — run AFTER your first real Plaid sync:
--   -- deposits should be IN, withdrawals OUT, amount_abs always positive:
--   SELECT direction, count(*), min(amount_abs) AS min_abs, sum(amount_abs) AS total
--     FROM bank_transactions GROUP BY direction;
--   -- spot-check a known deposit shows direction='in':
--   SELECT posted_date, name, amount, direction, amount_abs
--     FROM bank_transactions ORDER BY posted_date DESC LIMIT 20;
--   -- any flagged credit/loan accounts (sign NOT verified for these):
--   SELECT account_type, account_subtype, count(*) FROM bank_transactions
--    WHERE unsupported_account GROUP BY 1,2;
