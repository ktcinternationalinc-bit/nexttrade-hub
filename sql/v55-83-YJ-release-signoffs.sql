-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-YJ — Change Schedule: sign-off and roll back (Max, 24 Nov):
--  "i need how to move things to production on changement by just giving the go or on changemgmt screen for the
--   sign off to move forward or to roll back to exactly what it was before."
--
--  release_signoffs   the change-management history of WAREHOUSE changes, one row per event:
--                       go               Max signs a waiting change off for production (bound to the exact build)
--                       rollback         Max asks for a live change to be put back; the row names the exact build and
--                                        backup folder it is for, and the move row it undoes when there is one
--                       withdraw         Max takes a go / roll-back request back (a NEW row; the old one stays)
--                       moved            the files are on production, waiting for a person's check
--                       checked_live     a person checked the change on the live site: it is live
--                       failed           the move failed; detail.outcome = not_replaced (nothing on production was
--                                        touched) or restored (put back automatically, and that was confirmed)
--                       recovery_incomplete  a move stopped part-way and its restore is NOT confirmed
--                       recovery_confirmed   a person checked the live site afterwards; detail.where = staging / live
--                       rolled_back      the change was put back to what it was before
--                       rollback_failed  a roll back did not finish (a person must check the site)
--                     The first three are written by the Hub with the signed-in super admin (signed_by).
--                     The others are written by the office PC after it did the work (recorded_by).
--                     A row is NEVER changed and NEVER deleted. A correction is a new row.
--
-- Reads and writes go through the Hub's server (service role) only: browsers (anon / authenticated) get nothing.
-- Safe to re-run. Deletes nothing. Needs nothing else installed first.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.release_signoffs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id text NOT NULL,
  scope text NOT NULL,
  action text NOT NULL,
  sha text,
  target text NOT NULL DEFAULT 'production',
  approval_text text,
  detail jsonb,
  ref_id bigint REFERENCES public.release_signoffs(id),
  signed_by uuid,
  signed_by_name text,
  recorded_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.release_signoffs DROP CONSTRAINT IF EXISTS rso_scope_ok;
ALTER TABLE public.release_signoffs ADD CONSTRAINT rso_scope_ok CHECK (scope = 'warehouse');
ALTER TABLE public.release_signoffs DROP CONSTRAINT IF EXISTS rso_action_ok;
ALTER TABLE public.release_signoffs ADD COLUMN IF NOT EXISTS recorded_by text;
ALTER TABLE public.release_signoffs ALTER COLUMN signed_by DROP NOT NULL;
ALTER TABLE public.release_signoffs ADD CONSTRAINT rso_action_ok CHECK (action IN ('go', 'rollback', 'withdraw', 'moved', 'checked_live', 'failed', 'recovery_incomplete', 'recovery_confirmed', 'rolled_back', 'rollback_failed'));
ALTER TABLE public.release_signoffs DROP CONSTRAINT IF EXISTS rso_target_ok;
ALTER TABLE public.release_signoffs ADD CONSTRAINT rso_target_ok CHECK (target = 'production');
ALTER TABLE public.release_signoffs DROP CONSTRAINT IF EXISTS rso_item_ok;
ALTER TABLE public.release_signoffs ADD CONSTRAINT rso_item_ok CHECK (length(btrim(item_id)) >= 2 AND length(item_id) <= 200);
-- a go is always for one exact build, with the sentence that was signed
ALTER TABLE public.release_signoffs DROP CONSTRAINT IF EXISTS rso_go_complete;
ALTER TABLE public.release_signoffs ADD CONSTRAINT rso_go_complete CHECK (action <> 'go' OR (length(btrim(COALESCE(sha, ''))) >= 7 AND length(btrim(COALESCE(approval_text, ''))) >= 8));
ALTER TABLE public.release_signoffs DROP CONSTRAINT IF EXISTS rso_rollback_complete;
ALTER TABLE public.release_signoffs ADD CONSTRAINT rso_rollback_complete CHECK (action <> 'rollback' OR (length(btrim(COALESCE(approval_text, ''))) >= 8 AND length(btrim(COALESCE(sha, ''))) >= 7 AND length(btrim(COALESCE(detail->>'backup', ''))) >= 3));
-- a decision always has its signer; a move row always says who recorded it, which build, and (once files moved) where the backup is
ALTER TABLE public.release_signoffs DROP CONSTRAINT IF EXISTS rso_result_ref;
ALTER TABLE public.release_signoffs DROP CONSTRAINT IF EXISTS rso_who;
ALTER TABLE public.release_signoffs ADD CONSTRAINT rso_who CHECK (
  (action IN ('go', 'rollback', 'withdraw') AND signed_by IS NOT NULL)
  OR (action IN ('moved', 'checked_live', 'failed', 'recovery_incomplete', 'recovery_confirmed', 'rolled_back', 'rollback_failed') AND length(btrim(COALESCE(recorded_by, ''))) >= 3 AND length(btrim(COALESCE(sha, ''))) >= 7));
ALTER TABLE public.release_signoffs DROP CONSTRAINT IF EXISTS rso_move_backup;
ALTER TABLE public.release_signoffs ADD CONSTRAINT rso_move_backup CHECK (action NOT IN ('moved', 'checked_live', 'rolled_back') OR length(btrim(COALESCE(detail->>'backup', ''))) >= 3);
-- a move row points at the go / roll-back request it carried out
ALTER TABLE public.release_signoffs DROP CONSTRAINT IF EXISTS rso_move_ref;
ALTER TABLE public.release_signoffs ADD CONSTRAINT rso_move_ref CHECK (action NOT IN ('moved', 'failed', 'recovery_incomplete', 'recovery_confirmed', 'rolled_back', 'rollback_failed') OR ref_id IS NOT NULL);
-- a failed move always says HOW it ended; a recovery check always says where the change now is and who looked
ALTER TABLE public.release_signoffs DROP CONSTRAINT IF EXISTS rso_failed_outcome;
ALTER TABLE public.release_signoffs ADD CONSTRAINT rso_failed_outcome CHECK (action <> 'failed' OR COALESCE(detail->>'outcome', '') IN ('not_replaced', 'restored'));
ALTER TABLE public.release_signoffs DROP CONSTRAINT IF EXISTS rso_recovery_where;
ALTER TABLE public.release_signoffs ADD CONSTRAINT rso_recovery_where CHECK (action <> 'recovery_confirmed' OR (COALESCE(detail->>'where', '') IN ('staging', 'live') AND length(btrim(COALESCE(detail->>'checked', ''))) >= 10));
CREATE INDEX IF NOT EXISTS idx_rso_item ON public.release_signoffs (item_id, id DESC);

-- never changed, never deleted, never emptied
CREATE OR REPLACE FUNCTION public.rso_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'RELEASE_SIGNOFF_LOCKED: a sign-off row is never changed or deleted - add a new row instead';
END;
$fn$;
DROP TRIGGER IF EXISTS trg_rso_guard ON public.release_signoffs;
CREATE TRIGGER trg_rso_guard BEFORE UPDATE OR DELETE ON public.release_signoffs FOR EACH ROW EXECUTE FUNCTION public.rso_guard();
DROP TRIGGER IF EXISTS trg_rso_guard_truncate ON public.release_signoffs;
CREATE TRIGGER trg_rso_guard_truncate BEFORE TRUNCATE ON public.release_signoffs FOR EACH STATEMENT EXECUTE FUNCTION public.rso_guard();

-- server only
ALTER TABLE public.release_signoffs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.release_signoffs FROM PUBLIC;
REVOKE ALL ON public.release_signoffs FROM anon, authenticated;
REVOKE ALL ON public.release_signoffs FROM service_role;
GRANT SELECT, INSERT ON public.release_signoffs TO service_role;
REVOKE ALL ON FUNCTION public.rso_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rso_guard() FROM anon, authenticated;

-- check list: every line must say OK
SELECT 'table release_signoffs exists' AS check, CASE WHEN to_regclass('public.release_signoffs') IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS result
UNION ALL SELECT 'row security is on', CASE WHEN (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.release_signoffs'::regclass) THEN 'OK' ELSE 'OFF' END
UNION ALL SELECT 'no row-security policy (server only)', CASE WHEN (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'release_signoffs') = 0 THEN 'OK' ELSE 'HAS POLICY' END
UNION ALL SELECT 'browsers cannot read', CASE WHEN NOT has_table_privilege('anon', 'public.release_signoffs', 'SELECT') AND NOT has_table_privilege('authenticated', 'public.release_signoffs', 'SELECT') THEN 'OK' ELSE 'OPEN' END
UNION ALL SELECT 'browsers cannot write', CASE WHEN NOT has_table_privilege('anon', 'public.release_signoffs', 'INSERT') AND NOT has_table_privilege('authenticated', 'public.release_signoffs', 'INSERT') THEN 'OK' ELSE 'OPEN' END
UNION ALL SELECT 'server can add rows', CASE WHEN has_table_privilege('service_role', 'public.release_signoffs', 'INSERT') AND has_table_privilege('service_role', 'public.release_signoffs', 'SELECT') THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'server cannot change, delete or empty', CASE WHEN NOT has_table_privilege('service_role', 'public.release_signoffs', 'UPDATE') AND NOT has_table_privilege('service_role', 'public.release_signoffs', 'DELETE') AND NOT has_table_privilege('service_role', 'public.release_signoffs', 'TRUNCATE') THEN 'OK' ELSE 'OPEN' END
UNION ALL SELECT 'change / delete guard installed', CASE WHEN (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.release_signoffs'::regclass AND tgname IN ('trg_rso_guard', 'trg_rso_guard_truncate') AND NOT tgisinternal) = 2 THEN 'OK' ELSE 'MISSING' END;
