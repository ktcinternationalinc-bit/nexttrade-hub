-- ============================================================
-- v55.83-AC — PHASE 3 (part 2): App-owned accounting invoices + proformas.
-- All linked to accounting_customer_id (NOT Egypt CRM). Additive + idempotent.
-- Run after -X/-Y/-Z/-AB. No Wave. Balances derived from payment_matches.
-- ============================================================

-- 1) Invoices (app-owned)
CREATE TABLE IF NOT EXISTS accounting_invoices (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid,
  invoice_number text,
  accounting_customer_id uuid,
  invoice_date date,
  due_date date,
  notes text,
  terms text,
  total_amount numeric(14,2) DEFAULT 0,
  amount_paid numeric(14,2) DEFAULT 0,
  balance_due numeric(14,2),
  payment_status text DEFAULT 'unpaid',     -- unpaid | partial | paid | overpaid
  approval_status text DEFAULT 'draft',     -- draft | internal_review | approved
  ready_for_wave boolean DEFAULT false,     -- only true once approved (Phase 4)
  approved_by uuid, approved_at timestamptz,
  created_by uuid, updated_by uuid,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ai_customer ON accounting_invoices(accounting_customer_id);
CREATE INDEX IF NOT EXISTS ix_ai_business ON accounting_invoices(business_id);

-- 2) Invoice line items (SKU/product reserved for future inventory linkage)
CREATE TABLE IF NOT EXISTS accounting_invoice_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid,
  invoice_id uuid NOT NULL,
  description text,
  quantity numeric(14,3) DEFAULT 1,
  unit_price numeric(14,2) DEFAULT 0,
  line_total numeric(14,2) DEFAULT 0,
  sku text, product_ref text, sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_aii_invoice ON accounting_invoice_items(invoice_id);

-- 3) Proformas / estimates (do NOT affect balances until converted)
CREATE TABLE IF NOT EXISTS accounting_proformas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid,
  proforma_number text,
  accounting_customer_id uuid,
  proforma_date date,
  valid_until date,
  notes text,
  terms text,
  total_amount numeric(14,2) DEFAULT 0,
  status text DEFAULT 'draft',              -- draft | sent | accepted | rejected | converted
  converted_invoice_id uuid,
  created_by uuid, updated_by uuid,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ap_customer ON accounting_proformas(accounting_customer_id);

-- 4) Proforma line items
CREATE TABLE IF NOT EXISTS accounting_proforma_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid,
  proforma_id uuid NOT NULL,
  description text,
  quantity numeric(14,3) DEFAULT 1,
  unit_price numeric(14,2) DEFAULT 0,
  line_total numeric(14,2) DEFAULT 0,
  sku text, product_ref text, sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_api_proforma ON accounting_proforma_items(proforma_id);

-- 5) updated_at triggers (reuse set_updated_at() from -Y)
DROP TRIGGER IF EXISTS trg_ai_updated ON accounting_invoices;
CREATE TRIGGER trg_ai_updated BEFORE UPDATE ON accounting_invoices FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_ap_updated ON accounting_proformas;
CREATE TRIGGER trg_ap_updated BEFORE UPDATE ON accounting_proformas FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 6) RLS — business-scoped; deletes locked (admin/system via service role)
DO $$ BEGIN ALTER TABLE accounting_invoices       ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE accounting_invoice_items  ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE accounting_proformas      ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE accounting_proforma_items ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN EXECUTE 'CREATE POLICY ai_sel ON accounting_invoices FOR SELECT TO authenticated USING (business_id IN (SELECT app_user_business_ids()))'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY ai_ins ON accounting_invoices FOR INSERT TO authenticated WITH CHECK (business_id IN (SELECT app_user_business_ids()))'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY ai_upd ON accounting_invoices FOR UPDATE TO authenticated USING (business_id IN (SELECT app_user_business_ids()))'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY ai_del ON accounting_invoices FOR DELETE TO authenticated USING (false)'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN EXECUTE 'CREATE POLICY aii_sel ON accounting_invoice_items FOR SELECT TO authenticated USING (business_id IN (SELECT app_user_business_ids()))'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY aii_ins ON accounting_invoice_items FOR INSERT TO authenticated WITH CHECK (business_id IN (SELECT app_user_business_ids()))'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY aii_upd ON accounting_invoice_items FOR UPDATE TO authenticated USING (business_id IN (SELECT app_user_business_ids()))'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY aii_del ON accounting_invoice_items FOR DELETE TO authenticated USING (business_id IN (SELECT app_user_business_ids()))'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN EXECUTE 'CREATE POLICY ap_sel ON accounting_proformas FOR SELECT TO authenticated USING (business_id IN (SELECT app_user_business_ids()))'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY ap_ins ON accounting_proformas FOR INSERT TO authenticated WITH CHECK (business_id IN (SELECT app_user_business_ids()))'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY ap_upd ON accounting_proformas FOR UPDATE TO authenticated USING (business_id IN (SELECT app_user_business_ids()))'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY ap_del ON accounting_proformas FOR DELETE TO authenticated USING (false)'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN EXECUTE 'CREATE POLICY api_sel ON accounting_proforma_items FOR SELECT TO authenticated USING (business_id IN (SELECT app_user_business_ids()))'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY api_ins ON accounting_proforma_items FOR INSERT TO authenticated WITH CHECK (business_id IN (SELECT app_user_business_ids()))'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY api_upd ON accounting_proforma_items FOR UPDATE TO authenticated USING (business_id IN (SELECT app_user_business_ids()))'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY api_del ON accounting_proforma_items FOR DELETE TO authenticated USING (business_id IN (SELECT app_user_business_ids()))'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
