-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-RG — Wires portal + saved order reconciliations (Max, Nov 8 15:32)
--  "we need a separate portal for wires sent ... a quick audit that they were
--   not paid previously and that they all belong to a release number - make
--   sure there are no duplicated release numbers or reference numbers. and then
--   a manual signoff by 2 people who have verified the wire. so an AI
--   validation and then 2 further validations manually and then clicking on
--   wire will bring about all the bills paid with all of their data."
--  "for order reconciliation needs to keep record of each one completed..
--   save it and it needs to be manually reconciled and approved."
--
--  • vendor_bills.release_number — the release a bill belongs to.
--  • wire_audits — one row per wire (outgoing bank transaction paying bills):
--    the audit result, the AI review, and TWO sign-offs by TWO different
--    people, each bound to the exact set of bills checked (a fingerprint):
--    if the bills change afterwards, the sign-offs no longer count.
--  • order_reconciliations — every saved reconciliation run, its exception
--    lines resolved one by one, then RECONCILED by one person and APPROVED by
--    a different person.
--  Both tables: read for signed-in users; writes ONLY through the server
--  (which enforces who may sign) — the two-person rule is ALSO a database
--  constraint, so it cannot be bypassed.
-- SAFE TO RE-RUN.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.vendor_bills ADD COLUMN IF NOT EXISTS release_number text;
CREATE INDEX IF NOT EXISTS idx_vendor_bills_release ON public.vendor_bills (upper(release_number));

CREATE TABLE IF NOT EXISTS public.wire_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_transaction_id uuid NOT NULL UNIQUE,
  check_hash text,
  checked_at timestamptz,
  checked_by uuid,
  check_result jsonb,
  check_pass boolean,
  ai_summary text,
  ai_ok boolean,
  signoff1_by uuid, signoff1_at timestamptz, signoff1_note text, signoff1_hash text,
  signoff2_by uuid, signoff2_at timestamptz, signoff2_note text, signoff2_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wire_two_different_people CHECK (signoff2_by IS NULL OR (signoff1_by IS NOT NULL AND signoff2_by <> signoff1_by))
);
ALTER TABLE public.wire_audits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wire_audits_select ON public.wire_audits;
DROP POLICY IF EXISTS wire_audits_insert ON public.wire_audits;
DROP POLICY IF EXISTS wire_audits_update ON public.wire_audits;
DROP POLICY IF EXISTS wire_audits_delete ON public.wire_audits;
CREATE POLICY wire_audits_select ON public.wire_audits FOR SELECT TO authenticated USING (true);
-- sign-offs are written ONLY by the server (service role), which checks the permission and the two-person rule
CREATE POLICY wire_audits_insert ON public.wire_audits FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY wire_audits_update ON public.wire_audits FOR UPDATE TO authenticated USING (false);
CREATE POLICY wire_audits_delete ON public.wire_audits FOR DELETE TO authenticated USING (false);

CREATE TABLE IF NOT EXISTS public.order_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_from date,
  period_to date,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  snapshot jsonb NOT NULL,
  lines jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reconciled', 'approved')),
  reconciled_by uuid, reconciled_at timestamptz, reconciled_note text,
  approved_by uuid, approved_at timestamptz, approved_note text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recon_two_different_people CHECK (approved_by IS NULL OR (reconciled_by IS NOT NULL AND approved_by <> reconciled_by))
);
ALTER TABLE public.order_reconciliations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_recon_select ON public.order_reconciliations;
DROP POLICY IF EXISTS order_recon_insert ON public.order_reconciliations;
DROP POLICY IF EXISTS order_recon_update ON public.order_reconciliations;
DROP POLICY IF EXISTS order_recon_delete ON public.order_reconciliations;
CREATE POLICY order_recon_select ON public.order_reconciliations FOR SELECT TO authenticated USING (true);
CREATE POLICY order_recon_insert ON public.order_reconciliations FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY order_recon_update ON public.order_reconciliations FOR UPDATE TO authenticated USING (false);
CREATE POLICY order_recon_delete ON public.order_reconciliations FOR DELETE TO authenticated USING (false);
CREATE INDEX IF NOT EXISTS idx_order_recon_created ON public.order_reconciliations (created_at DESC);

-- An APPROVED reconciliation is on record for good: no edit, no delete — even by the server.
CREATE OR REPLACE FUNCTION public.order_recon_lock_approved() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF OLD.status = 'approved' THEN
    RAISE EXCEPTION 'ORDER_RECON_LOCKED: an approved reconciliation cannot be changed or deleted';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_order_recon_lock ON public.order_reconciliations;
CREATE TRIGGER trg_order_recon_lock BEFORE UPDATE OR DELETE ON public.order_reconciliations
  FOR EACH ROW EXECUTE FUNCTION public.order_recon_lock_approved();

SELECT 'release_number on bills' AS check_name,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'vendor_bills' AND column_name = 'release_number') THEN 'OK' ELSE 'MISSING' END AS result
UNION ALL SELECT 'wire_audits', CASE WHEN to_regclass('public.wire_audits') IS NOT NULL THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'order_reconciliations', CASE WHEN to_regclass('public.order_reconciliations') IS NOT NULL THEN 'OK' ELSE 'MISSING' END;
