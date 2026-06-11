-- ============================================================
-- v55.83-Z — PHASE 2: Classification & matching data layer
-- Additive + idempotent. Run after -X and -Y. USD only. No Wave in Phase 2.
-- Business-scoped RLS via app_user_business_ids() (from -Y); deletes locked.
-- ============================================================

-- 1) payment_matches — links bank money to invoices (all Req-9 patterns)
CREATE TABLE IF NOT EXISTS payment_matches (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid,
  bank_transaction_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  matched_amount numeric(14,2) NOT NULL,
  match_type text DEFAULT 'full',          -- full | partial | overpayment
  is_manual_override boolean DEFAULT false,
  notes text,
  matched_by uuid, matched_at timestamptz DEFAULT now(),
  created_by uuid, updated_by uuid,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_pm_txn     ON payment_matches(bank_transaction_id);
CREATE INDEX IF NOT EXISTS ix_pm_invoice ON payment_matches(invoice_id);

-- 2) customer_credits — overpayments / funds held against a customer
CREATE TABLE IF NOT EXISTS customer_credits (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid,
  customer_id uuid,
  source_transaction_id uuid,
  amount numeric(14,2) NOT NULL,
  status text DEFAULT 'open',              -- open | applied
  applied_to_invoice_id uuid,
  notes text,
  created_by uuid, updated_by uuid,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_cc_customer ON customer_credits(customer_id);

-- 3) unapplied_deposits — deposits awaiting allocation
CREATE TABLE IF NOT EXISTS unapplied_deposits (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid,
  bank_transaction_id uuid NOT NULL,
  customer_id uuid,
  amount numeric(14,2) NOT NULL,
  status text DEFAULT 'open',              -- open | allocated
  notes text,
  created_by uuid, updated_by uuid,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ud_txn ON unapplied_deposits(bank_transaction_id);

-- 4) invoices: balances are DERIVED (Req 6) + approval/lock (Req 10)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS amount_paid     numeric(14,2) DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS balance_due     numeric(14,2);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_status  text DEFAULT 'unpaid';  -- unpaid|partial|paid|overpaid
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS approval_status text DEFAULT 'draft';   -- draft|in_review|approved|void
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS approved_by uuid;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS approved_at timestamptz;

-- 5) updated_at triggers (reuse set_updated_at() from -Y)
DROP TRIGGER IF EXISTS trg_pm_updated ON payment_matches;
CREATE TRIGGER trg_pm_updated BEFORE UPDATE ON payment_matches FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_cc_updated ON customer_credits;
CREATE TRIGGER trg_cc_updated BEFORE UPDATE ON customer_credits FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_ud_updated ON unapplied_deposits;
CREATE TRIGGER trg_ud_updated BEFORE UPDATE ON unapplied_deposits FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 6) RLS — business-scoped; deletes locked (admin/system via service role)
DO $$ BEGIN ALTER TABLE payment_matches    ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE customer_credits   ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE unapplied_deposits ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  EXECUTE 'CREATE POLICY pm_sel ON payment_matches FOR SELECT TO authenticated USING (business_id IN (SELECT app_user_business_ids()))'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY pm_ins ON payment_matches FOR INSERT TO authenticated WITH CHECK (business_id IN (SELECT app_user_business_ids()))'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY pm_upd ON payment_matches FOR UPDATE TO authenticated USING (business_id IN (SELECT app_user_business_ids()))'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY pm_del ON payment_matches FOR DELETE TO authenticated USING (false)'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN EXECUTE 'CREATE POLICY cc_sel ON customer_credits FOR SELECT TO authenticated USING (business_id IN (SELECT app_user_business_ids()))'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY cc_ins ON customer_credits FOR INSERT TO authenticated WITH CHECK (business_id IN (SELECT app_user_business_ids()))'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY cc_upd ON customer_credits FOR UPDATE TO authenticated USING (business_id IN (SELECT app_user_business_ids()))'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY cc_del ON customer_credits FOR DELETE TO authenticated USING (false)'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN EXECUTE 'CREATE POLICY ud_sel ON unapplied_deposits FOR SELECT TO authenticated USING (business_id IN (SELECT app_user_business_ids()))'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY ud_ins ON unapplied_deposits FOR INSERT TO authenticated WITH CHECK (business_id IN (SELECT app_user_business_ids()))'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY ud_upd ON unapplied_deposits FOR UPDATE TO authenticated USING (business_id IN (SELECT app_user_business_ids()))'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY ud_del ON unapplied_deposits FOR DELETE TO authenticated USING (false)'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
