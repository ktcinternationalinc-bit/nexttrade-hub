ALTER FUNCTION public.clickbooks_us_shadow_sync_job(date, date, uuid) SET default_transaction_isolation TO 'repeatable read';
ALTER FUNCTION public.clickbooks_us_classified_sync_job(date, date, uuid) SET default_transaction_isolation TO 'repeatable read';
ALTER FUNCTION public.clickbooks_us_drift_sync_job(uuid) SET default_transaction_isolation TO 'repeatable read';
ALTER FUNCTION public.clickbooks_us_ledger_extras_job(date, date, uuid) SET default_transaction_isolation TO 'repeatable read';
NOTIFY pgrst, 'reload schema';
SELECT p.proname AS job, CASE WHEN p.proconfig @> ARRAY['default_transaction_isolation=repeatable read'] THEN 'OK' ELSE 'NOT SET — tell Claude' END AS result
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('clickbooks_us_shadow_sync_job', 'clickbooks_us_classified_sync_job', 'clickbooks_us_drift_sync_job', 'clickbooks_us_ledger_extras_job')
ORDER BY p.proname;
