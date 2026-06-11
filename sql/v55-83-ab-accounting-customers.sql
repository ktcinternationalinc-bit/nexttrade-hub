-- ============================================================
-- v55.83-AB — PHASE 3 (part 1): Separate US accounting customer master.
-- Keeps Egypt CRM OUT of the banking/accounting workflow. Additive + idempotent.
-- Run after -X/-Y/-Z. No Egypt CRM data is copied here — add US customers manually.
-- ============================================================

-- 1) Accounting customer master (the fields the workflow links to)
CREATE TABLE IF NOT EXISTS accounting_customers (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid,
  company_name text NOT NULL,
  contact_name text,
  email text,
  phone text,
  billing_address text,
  shipping_address text,
  tax_id text,                              -- optional
  status text DEFAULT 'active',            -- active | inactive | on_hold
  credit_limit numeric(14,2),              -- optional
  notes text,
  wave_customer_id text,                   -- Phase 4 placeholder (mapping)
  sync_status text DEFAULT 'not_synced',   -- Phase 4 placeholder: not_synced|synced|error
  created_by uuid, updated_by uuid,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_acct_cust_business ON accounting_customers(business_id);

-- 2) Additional contacts (beyond the primary on the customer record)
CREATE TABLE IF NOT EXISTS accounting_customer_contacts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid,
  accounting_customer_id uuid NOT NULL,
  name text, title text, email text, phone text,
  is_primary boolean DEFAULT false, notes text,
  created_by uuid, updated_by uuid,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_acct_contact_cust ON accounting_customer_contacts(accounting_customer_id);

-- 3) Additional structured addresses (billing / shipping)
CREATE TABLE IF NOT EXISTS accounting_customer_addresses (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid,
  accounting_customer_id uuid NOT NULL,
  address_type text DEFAULT 'billing',     -- billing | shipping
  line1 text, line2 text, city text, state text, postal_code text, country text,
  is_default boolean DEFAULT false, notes text,
  created_by uuid, updated_by uuid,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_acct_addr_cust ON accounting_customer_addresses(accounting_customer_id);

-- 4) Re-point the banking/accounting workflow to accounting_customer_id.
--    (Old CRM customer_id columns are LEFT IN PLACE but the app now writes
--     accounting_customer_id so Egypt CRM never mixes into this workflow.)
ALTER TABLE bank_transactions  ADD COLUMN IF NOT EXISTS accounting_customer_id uuid;
ALTER TABLE payment_matches    ADD COLUMN IF NOT EXISTS accounting_customer_id uuid;
ALTER TABLE customer_credits   ADD COLUMN IF NOT EXISTS accounting_customer_id uuid;
ALTER TABLE unapplied_deposits ADD COLUMN IF NOT EXISTS accounting_customer_id uuid;

-- 5) updated_at triggers (reuse set_updated_at() from -Y)
DROP TRIGGER IF EXISTS trg_acct_cust_updated ON accounting_customers;
CREATE TRIGGER trg_acct_cust_updated BEFORE UPDATE ON accounting_customers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_acct_contact_updated ON accounting_customer_contacts;
CREATE TRIGGER trg_acct_contact_updated BEFORE UPDATE ON accounting_customer_contacts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_acct_addr_updated ON accounting_customer_addresses;
CREATE TRIGGER trg_acct_addr_updated BEFORE UPDATE ON accounting_customer_addresses FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 6) RLS — business-scoped; deletes locked (admin/system via service role)
DO $$ BEGIN ALTER TABLE accounting_customers           ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE accounting_customer_contacts   ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE accounting_customer_addresses  ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN EXECUTE 'CREATE POLICY ac_sel ON accounting_customers FOR SELECT TO authenticated USING (business_id IN (SELECT app_user_business_ids()))'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY ac_ins ON accounting_customers FOR INSERT TO authenticated WITH CHECK (business_id IN (SELECT app_user_business_ids()))'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY ac_upd ON accounting_customers FOR UPDATE TO authenticated USING (business_id IN (SELECT app_user_business_ids()))'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY ac_del ON accounting_customers FOR DELETE TO authenticated USING (false)'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN EXECUTE 'CREATE POLICY acc_sel ON accounting_customer_contacts FOR SELECT TO authenticated USING (business_id IN (SELECT app_user_business_ids()))'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY acc_ins ON accounting_customer_contacts FOR INSERT TO authenticated WITH CHECK (business_id IN (SELECT app_user_business_ids()))'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY acc_upd ON accounting_customer_contacts FOR UPDATE TO authenticated USING (business_id IN (SELECT app_user_business_ids()))'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY acc_del ON accounting_customer_contacts FOR DELETE TO authenticated USING (false)'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN EXECUTE 'CREATE POLICY aca_sel ON accounting_customer_addresses FOR SELECT TO authenticated USING (business_id IN (SELECT app_user_business_ids()))'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY aca_ins ON accounting_customer_addresses FOR INSERT TO authenticated WITH CHECK (business_id IN (SELECT app_user_business_ids()))'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY aca_upd ON accounting_customer_addresses FOR UPDATE TO authenticated USING (business_id IN (SELECT app_user_business_ids()))'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY aca_del ON accounting_customer_addresses FOR DELETE TO authenticated USING (false)'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
