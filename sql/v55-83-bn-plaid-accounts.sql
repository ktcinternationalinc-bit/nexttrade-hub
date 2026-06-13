-- ============================================================
-- v55.83-BN — Plaid accounts store. Holds connected bank accounts (names, masks,
-- balances). Balances are ADMIN-ONLY at display time (bank.view_account_balances).
-- Additive + idempotent. RLS open to authenticated; the app gates who sees balances.
-- ============================================================
CREATE TABLE IF NOT EXISTS plaid_accounts (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  connection_id     uuid,
  business_id       uuid,
  plaid_account_id  text,
  name              text,
  official_name     text,
  mask              text,
  type              text,
  subtype           text,
  iso_currency      text DEFAULT 'USD',
  current_balance   numeric(14,2),
  available_balance numeric(14,2),
  is_read_only      boolean DEFAULT true,
  updated_at        timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_plaid_account_id ON plaid_accounts(plaid_account_id);

ALTER TABLE plaid_accounts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY pa_sel ON plaid_accounts FOR SELECT TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY pa_ins ON plaid_accounts FOR INSERT TO authenticated WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY pa_upd ON plaid_accounts FOR UPDATE TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY pa_del ON plaid_accounts FOR DELETE TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Sync status surface on the connection (last_synced already exists)
ALTER TABLE bank_connections ADD COLUMN IF NOT EXISTS last_sync_status text;
ALTER TABLE bank_connections ADD COLUMN IF NOT EXISTS last_sync_error  text;
