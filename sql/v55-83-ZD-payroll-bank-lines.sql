BEGIN;
DO $$ BEGIN
  IF to_regprocedure('hub_private.bill_is_payroll(uuid)') IS NULL OR to_regprocedure('hub_private.package_is_payroll(uuid)') IS NULL THEN
    RAISE EXCEPTION 'HUB_GUARD: run sql/v55-83-ZD-payroll-bills.sql first - nothing was changed';
  END IF;
  IF to_regclass('public.bank_transactions') IS NULL OR to_regclass('public.bank_transaction_splits') IS NULL THEN
    RAISE EXCEPTION 'HUB_GUARD: bank tables are missing - nothing was changed';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.bank_transactions'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.bank_transaction_splits'::regclass) THEN
    RAISE EXCEPTION 'HUB_GUARD: row security is off on a bank table - nothing was changed';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION hub_private.caller_can_see_payroll_lines() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(public.hub_caller_is_super_admin(), false) OR (
    EXISTS (SELECT 1 FROM public.module_permissions mp WHERE mp.user_id = public.hub_caller_profile() AND mp.module_name = 'pnl.view' AND mp.has_access IS TRUE)
    AND NOT EXISTS (SELECT 1 FROM public.module_permissions mp WHERE mp.user_id = public.hub_caller_profile() AND mp.module_name = 'pnl.view' AND mp.has_access IS FALSE));
$$;
CREATE OR REPLACE FUNCTION hub_private.bank_values_are_payroll(p_name text, p_merchant text, p_category text, p_hub text, p_company text, p_class text, p_wave text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT concat_ws(' ', p_name, p_merchant, p_category, p_hub, p_company, p_class, p_wave) ILIKE '%payroll%'
    OR EXISTS (SELECT 1 FROM public.expense_categories k WHERE k.key = p_hub AND (coalesce(k.label, '') ILIKE '%payroll%' OR k.key ILIKE '%payroll%'))
    OR EXISTS (SELECT 1 FROM public.company_categories cc WHERE cc.key = p_company AND cc.is_payroll IS TRUE);
$$;
CREATE OR REPLACE FUNCTION hub_private.bank_line_links_payroll(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.bank_transaction_splits s WHERE s.bank_transaction_id = p_id AND (coalesce(s.category, '') ILIKE '%payroll%'
      OR EXISTS (SELECT 1 FROM public.expense_categories k WHERE k.key = s.category AND coalesce(k.label, '') ILIKE '%payroll%')))
    OR EXISTS (SELECT 1 FROM public.vendor_bill_payments p WHERE p.bank_transaction_id = p_id AND hub_private.bill_is_payroll(p.bill_id))
    OR EXISTS (SELECT 1 FROM public.wire_packages w WHERE w.bank_transaction_id = p_id AND hub_private.package_is_payroll(w.id)));
$$;
CREATE OR REPLACE FUNCTION hub_private.bank_line_is_payroll(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.bank_transactions t WHERE t.id = p_id
    AND coalesce(t.wave_business_id, '') NOT IN ('NEXTRADE_BOOKS', 'RTM_BOOKS')
    AND (hub_private.bank_values_are_payroll(t.name, t.merchant_name, t.category, t.hub_category, t.company_category, t.classification, t.wave_category_name)
      OR hub_private.bank_line_links_payroll(t.id)));
$$;

CREATE OR REPLACE FUNCTION public.wave_cash_payroll_totals(p_from date, p_to date, p_currency text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('account_key', x.account_key, 'rows', x.n, 'debit_minor', x.d, 'credit_minor', x.c)), '[]'::jsonb)
  FROM (SELECT e.account_key, count(*) AS n, sum(e.debit_minor) AS d, sum(e.credit_minor) AS c
        FROM wave_history.cash_entries e JOIN wave_history.cash_imports i ON i.id = e.import_id
        WHERE i.currency = p_currency AND e.posted_date BETWEEN p_from AND p_to AND coalesce(e.description, '') ILIKE '%payroll%'
        GROUP BY e.account_key) x;
$$;
CREATE OR REPLACE FUNCTION public.hub_payroll_lines_guard_installed() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$ SELECT true; $$;

REVOKE ALL ON FUNCTION hub_private.caller_can_see_payroll_lines(), hub_private.bank_values_are_payroll(text, text, text, text, text, text, text),
  hub_private.bank_line_links_payroll(uuid), hub_private.bank_line_is_payroll(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION hub_private.caller_can_see_payroll_lines(), hub_private.bank_values_are_payroll(text, text, text, text, text, text, text),
  hub_private.bank_line_links_payroll(uuid), hub_private.bank_line_is_payroll(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.wave_cash_payroll_totals(date, date, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wave_cash_payroll_totals(date, date, text) TO service_role;
REVOKE ALL ON FUNCTION public.hub_payroll_lines_guard_installed() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.hub_payroll_lines_guard_installed() TO authenticated, service_role;

DROP POLICY IF EXISTS hub_payroll_lines_pnl_only ON public.bank_transactions;
CREATE POLICY hub_payroll_lines_pnl_only ON public.bank_transactions AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT hub_private.caller_can_see_payroll_lines())
    OR coalesce(wave_business_id, '') IN ('NEXTRADE_BOOKS', 'RTM_BOOKS')
    OR NOT (hub_private.bank_values_are_payroll(name, merchant_name, category, hub_category, company_category, classification, wave_category_name) OR hub_private.bank_line_links_payroll(id)))
  WITH CHECK ((SELECT hub_private.caller_can_see_payroll_lines())
    OR coalesce(wave_business_id, '') IN ('NEXTRADE_BOOKS', 'RTM_BOOKS')
    OR NOT (hub_private.bank_values_are_payroll(name, merchant_name, category, hub_category, company_category, classification, wave_category_name) OR hub_private.bank_line_links_payroll(id)));
DROP POLICY IF EXISTS hub_payroll_lines_pnl_only ON public.bank_transaction_splits;
CREATE POLICY hub_payroll_lines_pnl_only ON public.bank_transaction_splits AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT hub_private.caller_can_see_payroll_lines()) OR NOT hub_private.bank_line_is_payroll(bank_transaction_id))
  WITH CHECK ((SELECT hub_private.caller_can_see_payroll_lines()) OR NOT (hub_private.bank_line_is_payroll(bank_transaction_id)
    OR coalesce(category, '') ILIKE '%payroll%' OR EXISTS (SELECT 1 FROM public.expense_categories k WHERE k.key = category AND coalesce(k.label, '') ILIKE '%payroll%')));
COMMIT;
