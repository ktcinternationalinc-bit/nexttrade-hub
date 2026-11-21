BEGIN;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.module_permissions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.users FROM anon, authenticated;
GRANT UPDATE (language_access, ai_memory, greeter_personality, greeter_language, greeter_enabled, forwarding_number, phone_routing, phone_vacation_mode) ON TABLE public.users TO authenticated;
REVOKE ALL ON TABLE public.hub_audit_log FROM anon, authenticated;
COMMIT;
