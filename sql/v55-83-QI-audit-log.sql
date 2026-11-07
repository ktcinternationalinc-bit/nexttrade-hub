-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-QI — HUB AUDIT LOG (Max, Nov 7 12:33: "should be audit of whoever
-- changes or matches or creates or validates etc.. separate audit record
-- also permissioning").
-- One append-only table; every money-touching server action writes a row
-- (fail-soft — a failed audit write never blocks the work). Viewing it is
-- its own permission (Audit: View Trail); nobody can edit or delete rows
-- through the app — there is no update/delete path, period.
-- Paste into the Supabase SQL Editor and Run. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS hub_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid,
  action text NOT NULL,
  entity text,
  entity_id text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hub_audit_log_at_idx ON hub_audit_log (at DESC);
CREATE INDEX IF NOT EXISTS hub_audit_log_actor_idx ON hub_audit_log (actor_id, at DESC);
CREATE INDEX IF NOT EXISTS hub_audit_log_action_idx ON hub_audit_log (action, at DESC);

ALTER TABLE hub_audit_log ENABLE ROW LEVEL SECURITY;
-- append-only: authenticated may INSERT (server routes write via service
-- role anyway); reads go through the gated API; NO update/delete policies.
DO $$ BEGIN
  CREATE POLICY hub_audit_ins ON hub_audit_log FOR INSERT TO authenticated WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

select 'QI ok — audit rows so far: ' || count(*) from hub_audit_log;
