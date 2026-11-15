-- v55.83-IN — DEFINITIVE RLS FIX for the "nothing saves" bug across accounting + banking.
--
-- ──────────────────────────────────────────────────────────────────
-- WHY (root cause)
-- ──────────────────────────────────────────────────────────────────
-- This app authenticates by EMAIL (custom session), so the app's users.id is
-- NOT the same as Supabase auth.uid(). Any RLS policy keyed to auth.uid()
-- therefore matches ZERO rows on write → the UPDATE/INSERT "succeeds" with no
-- error but changes nothing → saves silently do nothing. (See v55-83-ag-rls-fix.)
--
-- ag-rls-fix opened RLS on most tables but MISSED accounting_invoice_payments —
-- the exact table a bank-match writes the payment into. If RLS is enabled on it
-- (or any of these tables) without an open policy, that write is blocked/filtered.
--
-- This migration FORCES the app-wide pattern on EVERY accounting/banking write
-- table: RLS enabled + open authenticated SELECT/INSERT/UPDATE (app code enforces
-- permissions); DELETE locked on financial-record tables, open on line-item tables.
-- Idempotent — safe to run repeatedly.

DO $$
DECLARE r text[];
  -- financial record tables: SELECT/INSERT/UPDATE open, DELETE locked
  rec_tables text[][] := ARRAY[
    ['bank_transactions','bt'], ['bank_transaction_splits','bts'],
    ['payment_matches','pm'], ['customer_credits','cc'], ['unapplied_deposits','ud'],
    ['accounting_customers','ac'], ['accounting_customer_contacts','acc'],
    ['accounting_customer_addresses','aca'],
    ['accounting_invoices','ai'], ['accounting_proformas','ap'],
    ['accounting_invoice_payments','aip'],          -- <<< the one ag-rls-fix missed
    ['wave_business_registry','wbr'], ['wave_business_settings','wbs'],
    ['wave_sync_log','wsl'], ['wave_categories','wcat'] ];
  -- line-item / child tables: all four ops open (needed for edit = delete+reinsert)
  item_tables text[][] := ARRAY[
    ['accounting_invoice_items','aii'], ['accounting_proforma_items','api'],
    ['attachments','att'] ];
BEGIN
  FOREACH r SLICE 1 IN ARRAY rec_tables LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r[1]);
      EXECUTE format('DROP POLICY IF EXISTS %1$s_sel ON %2$I', r[2], r[1]);
      EXECUTE format('DROP POLICY IF EXISTS %1$s_ins ON %2$I', r[2], r[1]);
      EXECUTE format('DROP POLICY IF EXISTS %1$s_upd ON %2$I', r[2], r[1]);
      EXECUTE format('DROP POLICY IF EXISTS %1$s_del ON %2$I', r[2], r[1]);
      EXECUTE format('CREATE POLICY %1$s_sel ON %2$I FOR SELECT TO authenticated USING (true)', r[2], r[1]);
      EXECUTE format('CREATE POLICY %1$s_ins ON %2$I FOR INSERT TO authenticated WITH CHECK (true)', r[2], r[1]);
      EXECUTE format('CREATE POLICY %1$s_upd ON %2$I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)', r[2], r[1]);
      EXECUTE format('CREATE POLICY %1$s_del ON %2$I FOR DELETE TO authenticated USING (false)', r[2], r[1]);
    EXCEPTION WHEN undefined_table THEN NULL; END;
  END LOOP;
  FOREACH r SLICE 1 IN ARRAY item_tables LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r[1]);
      EXECUTE format('DROP POLICY IF EXISTS %1$s_sel ON %2$I', r[2], r[1]);
      EXECUTE format('DROP POLICY IF EXISTS %1$s_ins ON %2$I', r[2], r[1]);
      EXECUTE format('DROP POLICY IF EXISTS %1$s_upd ON %2$I', r[2], r[1]);
      EXECUTE format('DROP POLICY IF EXISTS %1$s_del ON %2$I', r[2], r[1]);
      EXECUTE format('CREATE POLICY %1$s_sel ON %2$I FOR SELECT TO authenticated USING (true)', r[2], r[1]);
      EXECUTE format('CREATE POLICY %1$s_ins ON %2$I FOR INSERT TO authenticated WITH CHECK (true)', r[2], r[1]);
      EXECUTE format('CREATE POLICY %1$s_upd ON %2$I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)', r[2], r[1]);
      EXECUTE format('CREATE POLICY %1$s_del ON %2$I FOR DELETE TO authenticated USING (true)', r[2], r[1]);
    EXCEPTION WHEN undefined_table THEN NULL; END;
  END LOOP;
END $$;

-- ──────────────────────────────────────────────────────────────────
-- VERIFY (run after): every table below should list sel/ins/upd policies.
--   SELECT tablename, policyname, cmd FROM pg_policies
--   WHERE tablename IN ('bank_transactions','accounting_invoice_payments',
--     'payment_matches','accounting_invoices','accounting_customers')
--   ORDER BY tablename, cmd;
-- Then in the app: open a bank transaction → Save reviewed → it should persist
-- (the v55.83-IN self-check toast will say "Marked reviewed", not "did NOT persist").
