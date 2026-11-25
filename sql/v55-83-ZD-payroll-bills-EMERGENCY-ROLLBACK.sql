BEGIN;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['vendor_bills','vendor_bill_lines','vendor_bill_payments','vendor_bill_events','company_bill_links','recurring_bills','wire_packages','wire_package_lines','wire_package_files'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN EXECUTE format('DROP POLICY IF EXISTS hub_payroll_super_admin_only ON public.%I', t); END IF;
  END LOOP;
END $$;
DROP POLICY IF EXISTS hub_payroll_files_super_admin_only ON storage.objects;
DROP FUNCTION IF EXISTS public.hub_payroll_bills_guard_installed();
DROP FUNCTION IF EXISTS hub_private.file_is_payroll(text);
DROP FUNCTION IF EXISTS hub_private.recurring_is_payroll(text, text);
DROP FUNCTION IF EXISTS hub_private.package_is_payroll(uuid);
DROP FUNCTION IF EXISTS hub_private.bill_is_payroll(uuid);
DROP FUNCTION IF EXISTS hub_private.caller_is_super_admin();
COMMIT;
