-- ============================================================
-- v55.83-AM — Bidirectional Wave bridge FOUNDATION (schema lock).
-- Additive only. Open RLS + app-code permission gates (app authenticates by
-- email, so auth.uid() RLS would block writes — see AG). DELETE locked on
-- financial/audit tables. No data is moved here — this just makes the import
-- and the Hub->Wave sync safe and duplicate-proof.
-- ============================================================

-- 1) CUSTOMERS — provenance + dedup key -----------------------------------
ALTER TABLE accounting_customers ADD COLUMN IF NOT EXISTS source text DEFAULT 'hub';        -- 'hub' | 'wave_import'
-- wave_customer_id + wave_sync_status already exist. Dedup: one Hub row per Wave customer.
CREATE UNIQUE INDEX IF NOT EXISTS uq_acct_customers_wave_id
  ON accounting_customers (wave_customer_id) WHERE wave_customer_id IS NOT NULL;

-- 2) INVOICES — provenance, historical flag, dedup, Wave paid baseline -----
ALTER TABLE accounting_invoices ADD COLUMN IF NOT EXISTS source text DEFAULT 'hub';          -- 'hub' | 'wave_import'
ALTER TABLE accounting_invoices ADD COLUMN IF NOT EXISTS is_historical boolean DEFAULT false;
-- CRITICAL anti-double-count: the paid amount that ALREADY existed in Wave at
-- import time is stored here, SEPARATE from any later Plaid-matched payments.
-- balance_due = total - (wave_imported_paid + SUM of plaid/manual payments).
ALTER TABLE accounting_invoices ADD COLUMN IF NOT EXISTS wave_imported_paid numeric DEFAULT 0;
-- amount_paid / balance_due / payment_status / wave_invoice_id / wave_sync_status already exist.
CREATE UNIQUE INDEX IF NOT EXISTS uq_acct_invoices_wave_id
  ON accounting_invoices (wave_invoice_id) WHERE wave_invoice_id IS NOT NULL;

-- 3) PAYMENTS — one row per actual payment event (Plaid match / manual).
--    Wave-imported paid totals are NOT stored here (they live in
--    invoices.wave_imported_paid) so an imported invoice never creates
--    phantom payment rows. A later Plaid match is a NEW payment only.
CREATE TABLE IF NOT EXISTS accounting_invoice_payments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid,
  accounting_invoice_id uuid REFERENCES accounting_invoices(id) ON DELETE CASCADE,
  accounting_customer_id uuid,
  amount numeric NOT NULL DEFAULT 0,
  payment_date date,
  source text DEFAULT 'plaid_match',                 -- 'plaid_match' | 'manual' | 'wave_import'
  bank_transaction_id uuid,                           -- the Plaid txn that produced it (dedup)
  payment_match_id uuid,                              -- link to payment_matches
  wave_payment_id text,                               -- set after Hub->Wave sync
  sync_status text DEFAULT 'pending_wave_sync',       -- 'pending_wave_sync' | 'synced' | 'not_required'
  memo text,
  created_by uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
-- dedup: never apply the same bank transaction to the same invoice twice
CREATE UNIQUE INDEX IF NOT EXISTS uq_invpay_bank_txn_per_invoice
  ON accounting_invoice_payments (accounting_invoice_id, bank_transaction_id) WHERE bank_transaction_id IS NOT NULL;
-- dedup: never store the same Wave payment id twice
CREATE UNIQUE INDEX IF NOT EXISTS uq_invpay_wave_id
  ON accounting_invoice_payments (wave_payment_id) WHERE wave_payment_id IS NOT NULL;
DROP TRIGGER IF EXISTS trg_invpay_updated ON accounting_invoice_payments;
CREATE TRIGGER trg_invpay_updated BEFORE UPDATE ON accounting_invoice_payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 4) WAVE SYNC LOG — every Hub<->Wave attempt, success or failure ----------
CREATE TABLE IF NOT EXISTS wave_sync_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid,
  entity_type text,                                  -- 'customer' | 'invoice' | 'payment' | 'product' | 'import'
  hub_record_id uuid,
  wave_record_id text,
  action text,                                       -- 'import' | 'create' | 'update' | 'apply_payment'
  request_payload jsonb,
  response_payload jsonb,
  success boolean,
  error_message text,
  attempted_by uuid,
  attempted_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wave_sync_log_entity ON wave_sync_log (entity_type, hub_record_id);

-- 5) RLS — open SELECT/INSERT/UPDATE (app enforces perms); DELETE locked ---
DO $$
DECLARE t text; pfx text; r text[];
  tbls text[][] := ARRAY[ ['accounting_invoice_payments','aip'], ['wave_sync_log','wsl'] ];
BEGIN
  FOREACH r SLICE 1 IN ARRAY tbls LOOP
    t := r[1]; pfx := r[2];
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_sel ON %2$I', pfx, t);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_ins ON %2$I', pfx, t);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_upd ON %2$I', pfx, t);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_del ON %2$I', pfx, t);
    EXECUTE format('CREATE POLICY %1$s_sel ON %2$I FOR SELECT TO authenticated USING (true)', pfx, t);
    EXECUTE format('CREATE POLICY %1$s_ins ON %2$I FOR INSERT TO authenticated WITH CHECK (true)', pfx, t);
    EXECUTE format('CREATE POLICY %1$s_upd ON %2$I FOR UPDATE TO authenticated USING (true)', pfx, t);
    EXECUTE format('CREATE POLICY %1$s_del ON %2$I FOR DELETE TO authenticated USING (false)', pfx, t);
  END LOOP;
END $$;
