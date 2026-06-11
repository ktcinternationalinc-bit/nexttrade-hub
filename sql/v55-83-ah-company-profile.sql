-- ============================================================
-- v55.83-AH — Company Profile + Wave-compatibility columns.
-- Open RLS (app-wide pattern: app code enforces permissions). Additive.
-- ============================================================

-- 1) Company profile — one row per business; drives invoice/proforma branding.
--    WAVE MAPPING: maps to the Wave *business* (name/address/contact). Logo is
--    Hub-only (Wave has no logo API field) — used for our printed PDF.
CREATE TABLE IF NOT EXISTS company_profile (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid,
  company_name text,
  address text,
  phone text,
  email text,
  website text,
  tax_id text,
  default_invoice_notes text,
  default_proforma_notes text,
  default_payment_terms text,
  logo_data_url text,                       -- base64 data URL (Hub print only)
  created_by uuid, updated_by uuid,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_company_profile_updated ON company_profile;
CREATE TRIGGER trg_company_profile_updated BEFORE UPDATE ON company_profile FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DO $$ BEGIN ALTER TABLE company_profile ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY cp_sel ON company_profile FOR SELECT TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY cp_ins ON company_profile FOR INSERT TO authenticated WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY cp_upd ON company_profile FOR UPDATE TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY cp_del ON company_profile FOR DELETE TO authenticated USING (false); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Wave-compatibility columns (preserve mapping fields so sync is ready later)
--    WAVE MAPPING: wave_invoice_id <-> Wave Invoice id; wave_sync_status tracks
--    not_synced|synced|error; ready_for_wave already gates "approved -> syncable".
ALTER TABLE accounting_invoices  ADD COLUMN IF NOT EXISTS wave_invoice_id text;
ALTER TABLE accounting_invoices  ADD COLUMN IF NOT EXISTS wave_sync_status text DEFAULT 'not_synced';
ALTER TABLE accounting_proformas ADD COLUMN IF NOT EXISTS wave_estimate_id text;
ALTER TABLE accounting_proformas ADD COLUMN IF NOT EXISTS wave_sync_status text DEFAULT 'not_synced';
-- accounting_customers already carries wave_customer_id + sync_status (from -AB).
ALTER TABLE accounting_customers ADD COLUMN IF NOT EXISTS wave_sync_status text DEFAULT 'not_synced';
