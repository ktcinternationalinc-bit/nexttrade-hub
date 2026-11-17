-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-TP — TEAM PERMISSIONS (Max, Nov 17 2026; Codex QA findings)
--  1. PRIVATE bank accounts: a 🔒 mark on an account. Its transactions are seen only by the super admin and people Max grants
--     "Bank: See private accounts" (bank.view_private) — enforced HERE for every screen that reads bank_transactions directly,
--     and in the Hub's server routes for everything else.
--  2. The SENSITIVE switches (profit & margin, money totals, private accounts, granting sensitive access) can be switched ON
--     only by the super admin — not by an admin, not by anyone editing Settings.
-- Adds a column, functions, a policy and triggers. Nothing existing is changed or deleted. Safe to run more than once.
-- Uses public.bank_visibility_identity_map() (sql/bank-balance-visibility.sql) to tie a sign-in to exactly one Hub user.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. the private mark (every account starts NOT private)
ALTER TABLE public.plaid_accounts ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false;

-- 2. who is calling: exactly one Hub user for this sign-in, else nobody
CREATE OR REPLACE FUNCTION public.hub_caller_profile() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN count(*) = 1 THEN min(m.profile_id::text)::uuid END
  FROM public.bank_visibility_identity_map() m WHERE m.auth_user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.hub_caller_is_super_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.users u WHERE u.id = public.hub_caller_profile() AND u.role = 'super_admin');
$$;

CREATE OR REPLACE FUNCTION public.hub_caller_can_view_private() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.hub_caller_is_super_admin() OR EXISTS (
    SELECT 1 FROM public.module_permissions mp
    WHERE mp.user_id = public.hub_caller_profile() AND mp.module_name = 'bank.view_private' AND mp.has_access IS TRUE);
$$;

REVOKE ALL ON FUNCTION public.hub_caller_profile() FROM public, anon;
REVOKE ALL ON FUNCTION public.hub_caller_is_super_admin() FROM public, anon;
REVOKE ALL ON FUNCTION public.hub_caller_can_view_private() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.hub_caller_profile() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hub_caller_is_super_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hub_caller_can_view_private() TO authenticated, service_role;

-- 3. bank transactions of a PRIVATE account are invisible to signed-in screens unless the person may see them.
--    If row security was off on this table, it is switched on with an open rule for signed-in users first, so nothing else
--    changes for them; the private rule is then ADDED on top (a restrictive rule: it can only take rows away).
DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.bank_transactions'::regclass) THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'bank_transactions' AND policyname = 'bt_open_signed_in') THEN
      CREATE POLICY bt_open_signed_in ON public.bank_transactions FOR ALL TO authenticated USING (true) WITH CHECK (true);
    END IF;
    ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;
DROP POLICY IF EXISTS bt_private_accounts ON public.bank_transactions;
CREATE POLICY bt_private_accounts ON public.bank_transactions AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    account_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.plaid_accounts pa WHERE pa.plaid_account_id = bank_transactions.account_id AND pa.is_private IS TRUE)
    OR public.hub_caller_can_view_private()
  );

-- 4. only the super admin can switch ON a sensitive permission (switching one OFF is always allowed)
CREATE OR REPLACE FUNCTION public.hub_guard_sensitive_grant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.has_access IS TRUE AND NEW.module_name IN ('pnl.view_margin', 'accounting.view_totals', 'bank.view_private', 'permissions.grant_sensitive') THEN
    -- the Hub server (service key) and the Supabase SQL editor carry no person; the server routes check the super admin themselves
    IF auth.uid() IS NULL OR coalesce(auth.jwt() ->> 'role', '') = 'service_role' THEN RETURN NEW; END IF;
    IF NOT public.hub_caller_is_super_admin() THEN
      RAISE EXCEPTION 'HUB_GUARD: only the super admin can switch on "%".', NEW.module_name;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS hub_guard_sensitive_grant ON public.module_permissions;
CREATE TRIGGER hub_guard_sensitive_grant BEFORE INSERT OR UPDATE OF has_access, module_name, user_id
  ON public.module_permissions FOR EACH ROW EXECUTE FUNCTION public.hub_guard_sensitive_grant();

-- 5. only the super admin can mark / unmark an account private (the Hub's own screen goes through a super-admin-only route)
CREATE OR REPLACE FUNCTION public.hub_guard_private_mark() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.is_private IS TRUE) OR (TG_OP = 'UPDATE' AND NEW.is_private IS DISTINCT FROM OLD.is_private) THEN
    IF auth.uid() IS NULL OR coalesce(auth.jwt() ->> 'role', '') = 'service_role' THEN RETURN NEW; END IF;
    IF NOT public.hub_caller_is_super_admin() THEN RAISE EXCEPTION 'HUB_GUARD: only the super admin can mark an account private.'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS hub_guard_private_mark ON public.plaid_accounts;
CREATE TRIGGER hub_guard_private_mark BEFORE INSERT OR UPDATE OF is_private ON public.plaid_accounts
  FOR EACH ROW EXECUTE FUNCTION public.hub_guard_private_mark();

-- proof: should return one row: is_private column = true, private rule = true, sensitive-grant guard = true
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'plaid_accounts' AND column_name = 'is_private') AS is_private_column,
  EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'bank_transactions' AND policyname = 'bt_private_accounts') AS private_rule,
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hub_guard_sensitive_grant' AND NOT tgisinternal) AS sensitive_grant_guard;
