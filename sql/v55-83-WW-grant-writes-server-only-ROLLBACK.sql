BEGIN;
REVOKE UPDATE (language_access, ai_memory, greeter_personality, greeter_language, greeter_enabled, forwarding_number, phone_routing, phone_vacation_mode) ON TABLE public.users FROM authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.module_permissions TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.users TO anon, authenticated;
GRANT ALL ON TABLE public.hub_audit_log TO anon, authenticated;
COMMIT;
