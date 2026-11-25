BEGIN;
CREATE SCHEMA IF NOT EXISTS hub_private;
REVOKE ALL ON SCHEMA hub_private FROM public, anon;
GRANT USAGE ON SCHEMA hub_private TO authenticated, service_role;
CREATE OR REPLACE FUNCTION hub_private.bill_is_payroll(p_bill uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.vendor_bills b WHERE b.id = p_bill AND (
      b.vendor_name ILIKE '%payroll%' OR b.vendor_name ILIKE 'warehouse staff%' OR b.category ILIKE '%payroll%'
      OR EXISTS (SELECT 1 FROM public.expense_categories k WHERE k.key = b.category AND k.label ILIKE '%payroll%')))
    OR EXISTS (SELECT 1 FROM public.vendor_bill_lines l WHERE l.bill_id = p_bill AND l.description ILIKE '%payroll%')
    OR EXISTS (SELECT 1 FROM public.company_bill_links cl JOIN public.company_categories cc ON cc.company_id = cl.company_id AND cc.key = cl.category_key
               WHERE cl.bill_id = p_bill AND cl.status = 'active' AND cc.is_payroll IS TRUE);
$$;
CREATE OR REPLACE FUNCTION hub_private.package_is_payroll(p_package uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.wire_package_lines wl WHERE wl.package_id = p_package AND hub_private.bill_is_payroll(wl.bill_id));
$$;
CREATE OR REPLACE FUNCTION hub_private.recurring_is_payroll(p_vendor text, p_category text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_vendor ILIKE '%payroll%' OR p_vendor ILIKE 'warehouse staff%' OR p_category ILIKE '%payroll%'
    OR EXISTS (SELECT 1 FROM public.expense_categories k WHERE k.key = p_category AND k.label ILIKE '%payroll%');
$$;
CREATE OR REPLACE FUNCTION hub_private.file_is_payroll(p_path text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.vendor_bills b WHERE (b.attachment_path = p_path OR b.validation_attachment_path = p_path) AND hub_private.bill_is_payroll(b.id))
    OR EXISTS (SELECT 1 FROM public.wire_package_files f WHERE f.path = p_path AND hub_private.package_is_payroll(f.package_id));
$$;
CREATE OR REPLACE FUNCTION hub_private.caller_is_super_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$ SELECT public.hub_caller_is_super_admin(); $$;
CREATE OR REPLACE FUNCTION public.hub_payroll_bills_guard_installed() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$ SELECT true; $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA hub_private FROM public, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA hub_private TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.hub_payroll_bills_guard_installed() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.hub_payroll_bills_guard_installed() TO authenticated, service_role;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('vendor_bills', 'hub_private.bill_is_payroll(id)'),
      ('vendor_bill_lines', 'hub_private.bill_is_payroll(bill_id)'),
      ('vendor_bill_payments', 'hub_private.bill_is_payroll(bill_id)'),
      ('vendor_bill_events', 'hub_private.bill_is_payroll(bill_id)'),
      ('company_bill_links', 'hub_private.bill_is_payroll(bill_id)'),
      ('recurring_bills', 'hub_private.recurring_is_payroll(vendor_name, category)'),
      ('wire_packages', 'hub_private.package_is_payroll(id)'),
      ('wire_package_lines', '(hub_private.package_is_payroll(package_id) OR hub_private.bill_is_payroll(bill_id))'),
      ('wire_package_files', 'hub_private.package_is_payroll(package_id)')) AS t(tbl, test)
  LOOP
    IF to_regclass('public.' || r.tbl) IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: table public.% is missing - nothing was changed', r.tbl; END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || r.tbl)::regclass) THEN RAISE EXCEPTION 'HUB_GUARD: row security is off on public.% - nothing was changed', r.tbl; END IF;
    EXECUTE format('DROP POLICY IF EXISTS hub_payroll_super_admin_only ON public.%I', r.tbl);
    EXECUTE format('CREATE POLICY hub_payroll_super_admin_only ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT hub_private.caller_is_super_admin()) OR NOT %s) WITH CHECK ((SELECT hub_private.caller_is_super_admin()) OR NOT %s)', r.tbl, r.test, r.test);
  END LOOP;
END $$;
DROP POLICY IF EXISTS hub_payroll_files_super_admin_only ON storage.objects;
CREATE POLICY hub_payroll_files_super_admin_only ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
  USING (bucket_id <> 'bills-private' OR (SELECT hub_private.caller_is_super_admin()) OR NOT hub_private.file_is_payroll(name))
  WITH CHECK (bucket_id <> 'bills-private' OR (SELECT hub_private.caller_is_super_admin()) OR NOT hub_private.file_is_payroll(name));
COMMIT;
