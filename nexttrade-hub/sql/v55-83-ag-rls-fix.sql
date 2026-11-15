-- v55.83-AG — FIX: RLS keyed to auth.uid() blocked all accounting saves because
-- this app authenticates by email (users.id != auth.uid()). Revert to the
-- app-wide pattern: open RLS + app-code permission gates. Deletes stay locked
-- on financial record tables; item tables allow delete for line-item editing.
DO $$
DECLARE t text; pfx text; r text[];
  rec_tables text[][] := ARRAY[
    ['bank_transactions','bt'], ['bank_transaction_splits','bts'],
    ['payment_matches','pm'], ['customer_credits','cc'], ['unapplied_deposits','ud'],
    ['accounting_customers','ac'], ['accounting_customer_contacts','acc'],
    ['accounting_customer_addresses','aca'],
    ['accounting_invoices','ai'], ['accounting_proformas','ap'] ];
  item_tables text[][] := ARRAY[
    ['accounting_invoice_items','aii'], ['accounting_proforma_items','api'] ];
BEGIN
  FOREACH r SLICE 1 IN ARRAY rec_tables LOOP
    t := r[1]; pfx := r[2];
    EXECUTE format('DROP POLICY IF EXISTS %1$s_sel ON %2$I', pfx, t);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_ins ON %2$I', pfx, t);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_upd ON %2$I', pfx, t);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_del ON %2$I', pfx, t);
    EXECUTE format('CREATE POLICY %1$s_sel ON %2$I FOR SELECT TO authenticated USING (true)', pfx, t);
    EXECUTE format('CREATE POLICY %1$s_ins ON %2$I FOR INSERT TO authenticated WITH CHECK (true)', pfx, t);
    EXECUTE format('CREATE POLICY %1$s_upd ON %2$I FOR UPDATE TO authenticated USING (true)', pfx, t);
    EXECUTE format('CREATE POLICY %1$s_del ON %2$I FOR DELETE TO authenticated USING (false)', pfx, t);
  END LOOP;
  FOREACH r SLICE 1 IN ARRAY item_tables LOOP
    t := r[1]; pfx := r[2];
    EXECUTE format('DROP POLICY IF EXISTS %1$s_sel ON %2$I', pfx, t);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_ins ON %2$I', pfx, t);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_upd ON %2$I', pfx, t);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_del ON %2$I', pfx, t);
    EXECUTE format('CREATE POLICY %1$s_sel ON %2$I FOR SELECT TO authenticated USING (true)', pfx, t);
    EXECUTE format('CREATE POLICY %1$s_ins ON %2$I FOR INSERT TO authenticated WITH CHECK (true)', pfx, t);
    EXECUTE format('CREATE POLICY %1$s_upd ON %2$I FOR UPDATE TO authenticated USING (true)', pfx, t);
    EXECUTE format('CREATE POLICY %1$s_del ON %2$I FOR DELETE TO authenticated USING (true)', pfx, t);
  END LOOP;
END $$;
UPDATE accounting_customers SET business_id = (SELECT id FROM businesses ORDER BY created_at LIMIT 1) WHERE business_id IS NULL;
UPDATE accounting_invoices  SET business_id = (SELECT id FROM businesses ORDER BY created_at LIMIT 1) WHERE business_id IS NULL;
UPDATE accounting_proformas SET business_id = (SELECT id FROM businesses ORDER BY created_at LIMIT 1) WHERE business_id IS NULL;
