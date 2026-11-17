-- v55.83-TW/TX — minimal stand-ins for the EXISTING Supabase tables the new scripts build on (only the columns they use),
-- so the REAL sql files (TO, TV, TW, TX) can be loaded into an in-memory Postgres (PGlite) by
-- __tests__/test-v55-83-tw-tx-real-postgres.mjs. Never run against Supabase.
CREATE ROLE anon; CREATE ROLE authenticated;
CREATE TABLE public.wave_business_registry (wave_business_id text PRIMARY KEY, label text, is_production boolean);
CREATE TABLE public.paid_through_parties (name text PRIMARY KEY, kind text, provider_from date);
INSERT INTO public.paid_through_parties VALUES ('NextTrade Industries', 'affiliate', '2026-11-15'), ('RTM Capital', 'service_provider', null);
CREATE TABLE public.bank_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), wave_business_id text, account_id text, direction text,
  amount_abs numeric, date date, name text, merchant_name text, pending boolean DEFAULT false, third_party_payer text, classification text, review_status text);
CREATE TABLE public.vendor_bills (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), wave_business_id text, vendor_name text NOT NULL, bill_number text,
  bill_date date NOT NULL, due_date date, currency text NOT NULL DEFAULT 'USD', total_amount numeric NOT NULL CHECK (total_amount > 0), category text,
  notes text, record_status text NOT NULL DEFAULT 'active', paid_via text, created_by uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.vendor_bill_payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bill_id uuid NOT NULL REFERENCES public.vendor_bills(id),
  amount numeric NOT NULL CHECK (amount > 0), paid_date date NOT NULL, bank_transaction_id uuid, method text, voided boolean NOT NULL DEFAULT false,
  created_by uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.order_deposit_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bank_transaction_id uuid, amount numeric, voided boolean DEFAULT false);
CREATE TABLE public.accounting_invoice_payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bank_transaction_id uuid, amount numeric, voided boolean DEFAULT false);
CREATE TABLE public.order_closures (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.wire_package_lines (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bill_id uuid, package_id uuid, is_open boolean DEFAULT true);
CREATE TABLE public.wire_packages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bank_transaction_id uuid, fee_amount numeric, status text);
CREATE TABLE public.hub_audit_log (id bigserial PRIMARY KEY, actor_id uuid, action text, entity text, entity_id text, details jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE public.order_alerts (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
