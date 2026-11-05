-- READ ONLY. Run as a trusted operator in the intended project before any activation.
-- This is an observation, not a backup, a migration or a permission grant.
select jsonb_build_object(
 'checked_at',now(),
 'book',(select jsonb_build_object('code',code,'currency',currency,'wave_business_id',wave_business_id,'posting_enabled',posting_enabled,'historical_data_ready',historical_data_ready,'opening_cutoff',opening_cutoff) from clickbooks_us.books where code='KTC_US'),
 'migrations',(select jsonb_agg(jsonb_build_object('version',version,'name',name) order by version) from supabase_migrations.schema_migrations where name like 'clickbooks_us%'),
 'security',jsonb_build_object(
  'visibility_table',to_regclass('public.financial_visibility_permissions'),
  'identity_rpc',to_regprocedure('public.bank_visibility_profile_for_identity(uuid)'),
  'tables_without_rls',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='clickbooks_us' and c.relkind='r' and not c.relrowsecurity),
  'browser_callable_functions',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='clickbooks_us' or (n.nspname='public' and p.proname like 'clickbooks_us_%')) and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute')))),
 'counts',jsonb_build_object('accounts',(select count(*) from clickbooks_us.accounts),'journals',(select count(*) from clickbooks_us.journals),'snapshots',(select count(*) from clickbooks_us.migration_runs),'rules',(select count(*) from clickbooks_us.rules),'proposals',(select count(*) from clickbooks_us.rule_proposals)),
 'execution_enabled',(select migration_execution_enabled from clickbooks_us.workflow_settings where singleton),
 'source_digests',clickbooks_us.audit_source()->'source_digests',
 'source_report',clickbooks_us.migration_report(clickbooks_us.source_snapshot(current_date))
) as clickbooks_preflight;
