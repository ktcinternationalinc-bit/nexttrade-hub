BEGIN;
CREATE OR REPLACE FUNCTION public.hub_caller_revenue_hidden() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT NOT public.hub_caller_is_super_admin() AND EXISTS (
    SELECT 1 FROM auth.users a
    JOIN public.users p ON p.id = a.id OR (a.email_confirmed_at IS NOT NULL AND nullif(btrim(a.email), '') IS NOT NULL AND lower(btrim(a.email)) = lower(btrim(p.email)))
    JOIN public.module_permissions mp ON mp.user_id = p.id
    WHERE a.id = auth.uid() AND mp.module_name = 'pnl.view_revenue' AND mp.has_access IS FALSE);
$$;
CREATE OR REPLACE FUNCTION public.hub_revenue_guard_installed() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$ SELECT true; $$;
REVOKE ALL ON FUNCTION public.hub_caller_revenue_hidden() FROM public, anon;
REVOKE ALL ON FUNCTION public.hub_revenue_guard_installed() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.hub_caller_revenue_hidden() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hub_revenue_guard_installed() TO authenticated, service_role;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['accounting_invoices','accounting_invoice_items','accounting_invoice_payments','accounting_proformas','accounting_proforma_items','invoice_items','invoices','checks','customer_credits','open_account_invoices','open_account_invoice_items','open_account_entries','inventory_movements','inventory_layers','bank_transactions','bank_transaction_splits','payment_matches','unapplied_deposits','plaid_accounts'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: table public.% is missing - nothing was changed', t; END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN RAISE EXCEPTION 'HUB_GUARD: row security is off on public.% - nothing was changed', t; END IF;
    EXECUTE format('DROP POLICY IF EXISTS hub_revenue_researcher ON public.%I', t);
    EXECUTE format('CREATE POLICY hub_revenue_researcher ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (NOT (SELECT public.hub_caller_revenue_hidden())) WITH CHECK (NOT (SELECT public.hub_caller_revenue_hidden()))', t);
  END LOOP;
END $$;
COMMIT;
