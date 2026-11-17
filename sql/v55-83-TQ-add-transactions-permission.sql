-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-TQ — "Bank: Add transactions by hand" is a SENSITIVE switch (Max, Nov 17 2026: "super admin or permissioned can add
-- transactions"): only the super admin can switch it ON. Replaces the guard function from v55-83-TP with the longer list.
-- Run AFTER sql/v55-83-TP-permissions.sql. Changes no data. Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.hub_guard_sensitive_grant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.has_access IS TRUE AND NEW.module_name IN ('pnl.view_margin', 'accounting.view_totals', 'bank.view_private', 'permissions.grant_sensitive', 'bank.add_transactions') THEN
    IF auth.uid() IS NULL OR coalesce(auth.jwt() ->> 'role', '') = 'service_role' THEN RETURN NEW; END IF;
    IF NOT public.hub_caller_is_super_admin() THEN
      RAISE EXCEPTION 'HUB_GUARD: only the super admin can switch on "%".', NEW.module_name;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- proof: should return one row saying true
SELECT position('bank.add_transactions' in pg_get_functiondef('public.hub_guard_sensitive_grant()'::regprocedure)) > 0 AS add_transactions_guarded;
