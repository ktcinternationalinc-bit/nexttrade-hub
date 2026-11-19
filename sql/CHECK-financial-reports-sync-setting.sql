SELECT jsonb_build_object(
  'job_functions', (SELECT jsonb_agg(jsonb_build_object('fn', p.proname, 'args', pg_get_function_identity_arguments(p.oid), 'settings', p.proconfig, 'calls', substring(p.prosrc from 'clickbooks_us\.[a-z_]+')) ORDER BY p.proname)
                    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'clickbooks\_us\_%job'),
  'inner_functions_that_demand_repeatable_read', (SELECT jsonb_agg(p.proname ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'clickbooks_us' AND p.prosrc LIKE '%CB_REPEATABLE_READ_REQUIRED%'),
  'role_settings', (SELECT jsonb_agg(jsonb_build_object('role', r.rolname, 'settings', s.setconfig)) FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole WHERE r.rolname IN ('service_role', 'authenticator', 'authenticated', 'postgres'))
) AS copy_this_cell_to_claude;
