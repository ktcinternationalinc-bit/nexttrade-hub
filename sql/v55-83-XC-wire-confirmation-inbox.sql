-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-XC — Wires: the bank-confirmation inbox (Max, 21 Nov):
--  "i also need a place to enter screenshots for wires in one place and the hub able to sort them out and put them in the
--   proper wire for confirmation. If there is a discrepancy somewhere it must create a note and send to emails for all those
--   that are permissioned for accounting and keep an audit"
--  Recipients (Max 21 Nov): "all people with clickbook permissioning" / "The 4 staff + Max".
--
--  wire_confirmation_inbox   one row per uploaded bank confirmation (PDF / screenshot). The file itself stays in the
--                            PRIVATE bucket bills-private under pv/wire-inbox-…; a row is NEVER deleted (dismissed keeps it).
--  wire_discrepancy_notices  one row per discrepancy, UNIQUE dedupe_key, so the same problem is noted and mailed once.
--                            Its mail_status only says 'sent' when a mail really went out.
--
-- Reads and writes go through the Hub's server (service role) only: browsers (anon / authenticated) get nothing.
-- Safe to re-run. Deletes nothing. Run after RH (wire_packages).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.wire_confirmation_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  path text NOT NULL,
  file_name text,
  file_sha256 text,
  uploaded_by uuid,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'new',
  read jsonb,
  read_at timestamptz,
  read_error text,
  candidates jsonb,
  proposed_package_id uuid REFERENCES public.wire_packages(id),
  linked_package_id uuid REFERENCES public.wire_packages(id),
  linked_by uuid,
  linked_at timestamptz,
  dismissed_by uuid,
  dismissed_at timestamptz,
  dismiss_reason text,
  note text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.wire_confirmation_inbox DROP CONSTRAINT IF EXISTS wci_status_ok;
ALTER TABLE public.wire_confirmation_inbox ADD CONSTRAINT wci_status_ok CHECK (status IN ('new', 'read', 'unreadable', 'proposed', 'several', 'no_wire', 'linked', 'dismissed'));
ALTER TABLE public.wire_confirmation_inbox DROP CONSTRAINT IF EXISTS wci_private_path;
ALTER TABLE public.wire_confirmation_inbox ADD CONSTRAINT wci_private_path CHECK (path LIKE 'pv/wire-inbox-%' AND position('..' in path) = 0);
ALTER TABLE public.wire_confirmation_inbox DROP CONSTRAINT IF EXISTS wci_linked_complete;
ALTER TABLE public.wire_confirmation_inbox ADD CONSTRAINT wci_linked_complete CHECK (status <> 'linked' OR (linked_package_id IS NOT NULL AND linked_by IS NOT NULL AND linked_at IS NOT NULL));
ALTER TABLE public.wire_confirmation_inbox DROP CONSTRAINT IF EXISTS wci_dismissed_complete;
ALTER TABLE public.wire_confirmation_inbox ADD CONSTRAINT wci_dismissed_complete CHECK (status <> 'dismissed' OR (dismissed_by IS NOT NULL AND dismissed_at IS NOT NULL AND length(btrim(COALESCE(dismiss_reason, ''))) >= 5));
CREATE UNIQUE INDEX IF NOT EXISTS uq_wci_path ON public.wire_confirmation_inbox (path);
CREATE UNIQUE INDEX IF NOT EXISTS uq_wci_sha ON public.wire_confirmation_inbox (file_sha256) WHERE file_sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wci_status ON public.wire_confirmation_inbox (status);
CREATE INDEX IF NOT EXISTS idx_wci_linked ON public.wire_confirmation_inbox (linked_package_id);

CREATE TABLE IF NOT EXISTS public.wire_discrepancy_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key text NOT NULL,
  kind text NOT NULL,
  package_id uuid REFERENCES public.wire_packages(id),
  inbox_id uuid REFERENCES public.wire_confirmation_inbox(id),
  note text NOT NULL,
  details jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  mail_status text NOT NULL DEFAULT 'pending',
  mail_recipients int,
  mail_sent int,
  mail_at timestamptz,
  mail_error text
);
ALTER TABLE public.wire_discrepancy_notices DROP CONSTRAINT IF EXISTS wdn_kind_ok;
ALTER TABLE public.wire_discrepancy_notices ADD CONSTRAINT wdn_kind_ok CHECK (kind IN ('amount', 'date', 'recipient', 'status', 'currency', 'no_wire', 'missing_confirmation', 'not_readable'));
ALTER TABLE public.wire_discrepancy_notices DROP CONSTRAINT IF EXISTS wdn_mail_status_ok;
-- XC rev3 (Codex 22 Nov 14:36 P2): a note is CLAIMED (pending → sending) by the one caller that e-mails it; who / when is kept
ALTER TABLE public.wire_discrepancy_notices ADD COLUMN IF NOT EXISTS mail_claimed_at timestamptz;
ALTER TABLE public.wire_discrepancy_notices ADD COLUMN IF NOT EXISTS mail_claimed_by uuid;
ALTER TABLE public.wire_discrepancy_notices ADD CONSTRAINT wdn_mail_status_ok CHECK (mail_status IN ('pending', 'sending', 'sent', 'partly_sent', 'not_sent', 'no_recipients'));
ALTER TABLE public.wire_discrepancy_notices DROP CONSTRAINT IF EXISTS wdn_claim_complete;
ALTER TABLE public.wire_discrepancy_notices ADD CONSTRAINT wdn_claim_complete CHECK (mail_status = 'pending' OR mail_claimed_at IS NOT NULL);
ALTER TABLE public.wire_discrepancy_notices DROP CONSTRAINT IF EXISTS wdn_sent_counts;
ALTER TABLE public.wire_discrepancy_notices ADD CONSTRAINT wdn_sent_counts CHECK (mail_status NOT IN ('sent', 'partly_sent') OR (mail_sent IS NOT NULL AND mail_sent > 0 AND mail_at IS NOT NULL));
CREATE UNIQUE INDEX IF NOT EXISTS uq_wdn_dedupe ON public.wire_discrepancy_notices (dedupe_key);
CREATE INDEX IF NOT EXISTS idx_wdn_package ON public.wire_discrepancy_notices (package_id);
CREATE INDEX IF NOT EXISTS idx_wdn_inbox ON public.wire_discrepancy_notices (inbox_id);

-- never deleted; a linked / dismissed confirmation keeps its decision (who, when, which wire, why)
CREATE OR REPLACE FUNCTION public.wci_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'WIRE_INBOX_LOCKED: a bank confirmation is never deleted — dismiss it with a reason'; END IF;
  IF NEW.path IS DISTINCT FROM OLD.path OR NEW.file_sha256 IS DISTINCT FROM OLD.file_sha256 OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by OR NEW.uploaded_at IS DISTINCT FROM OLD.uploaded_at THEN
    RAISE EXCEPTION 'WIRE_INBOX_LOCKED: the file of a bank confirmation cannot change';
  END IF;
  IF OLD.status IN ('linked', 'dismissed') AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.linked_package_id IS DISTINCT FROM OLD.linked_package_id
     OR NEW.linked_by IS DISTINCT FROM OLD.linked_by OR NEW.linked_at IS DISTINCT FROM OLD.linked_at OR NEW.dismissed_by IS DISTINCT FROM OLD.dismissed_by
     OR NEW.dismissed_at IS DISTINCT FROM OLD.dismissed_at OR NEW.dismiss_reason IS DISTINCT FROM OLD.dismiss_reason) THEN
    RAISE EXCEPTION 'WIRE_INBOX_LOCKED: this bank confirmation is already %', OLD.status;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_wci_guard ON public.wire_confirmation_inbox;
CREATE TRIGGER trg_wci_guard BEFORE UPDATE OR DELETE ON public.wire_confirmation_inbox FOR EACH ROW EXECUTE FUNCTION public.wci_guard();

-- a notice is never deleted and never re-pointed; only its mail result is filled in, once it is known
CREATE OR REPLACE FUNCTION public.wdn_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'WIRE_NOTICE_LOCKED: a discrepancy note is never deleted'; END IF;
  IF NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.package_id IS DISTINCT FROM OLD.package_id
     OR NEW.inbox_id IS DISTINCT FROM OLD.inbox_id OR NEW.note IS DISTINCT FROM OLD.note OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'WIRE_NOTICE_LOCKED: a discrepancy note cannot change — only its e-mail result is recorded';
  END IF;
  IF OLD.mail_status IN ('sent', 'partly_sent') AND NEW.mail_status IS DISTINCT FROM OLD.mail_status THEN
    RAISE EXCEPTION 'WIRE_NOTICE_LOCKED: this note was already e-mailed';
  END IF;
  -- rev3: e-mailing goes pending → sending → its result, never back. A claim (who / when) never changes once made.
  IF NEW.mail_status = 'pending' AND OLD.mail_status <> 'pending' THEN
    RAISE EXCEPTION 'WIRE_NOTICE_LOCKED: an e-mail already started for this note cannot be put back to pending (it could be sent twice)';
  END IF;
  IF NEW.mail_status = 'sending' AND OLD.mail_status NOT IN ('pending', 'sending') THEN
    RAISE EXCEPTION 'WIRE_NOTICE_LOCKED: this note''s e-mail already has its result';
  END IF;
  IF OLD.mail_status = 'pending' AND NEW.mail_status NOT IN ('pending', 'sending') THEN
    RAISE EXCEPTION 'WIRE_NOTICE_LOCKED: claim the note (sending) before recording an e-mail result';
  END IF;
  IF OLD.mail_claimed_at IS NOT NULL AND (NEW.mail_claimed_at IS DISTINCT FROM OLD.mail_claimed_at OR NEW.mail_claimed_by IS DISTINCT FROM OLD.mail_claimed_by) THEN
    RAISE EXCEPTION 'WIRE_NOTICE_LOCKED: who claimed this e-mail cannot change';
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_wdn_guard ON public.wire_discrepancy_notices;
CREATE TRIGGER trg_wdn_guard BEFORE UPDATE OR DELETE ON public.wire_discrepancy_notices FOR EACH ROW EXECUTE FUNCTION public.wdn_guard();

-- v55.83-XC rev2 (Codex 22 Nov 08:26 P2) — attaching a confirmation to its wire is ONE step: the file on the wire, its discrepancy
-- notes and the "linked" decision are saved together or not at all (a failed file save leaves the confirmation open to retry).
-- The same confirmation + the SAME wire again finishes / repeats safely: no second file, no second note. Another wire is refused.
-- p_notices = [{ dedupe_key, kind, note }]. Returns which notes it added (their ids), so only those are e-mailed.
CREATE OR REPLACE FUNCTION public.hub_wire_inbox_link(p_inbox_id uuid, p_package_id uuid, p_user uuid, p_note text, p_notices jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $fn$
DECLARE
  r public.wire_confirmation_inbox%ROWTYPE;
  w record;
  v_resumed boolean := false; v_file boolean := false; v_ids uuid[] := '{}'; v_id uuid; x jsonb;
BEGIN
  SELECT * INTO r FROM public.wire_confirmation_inbox WHERE id = p_inbox_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'not_found'); END IF;
  SELECT id, status, funding_txn_id INTO w FROM public.wire_packages WHERE id = p_package_id FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'wire_not_found'); END IF;
  IF r.status = 'dismissed' THEN RETURN jsonb_build_object('ok', false, 'code', 'dismissed'); END IF;
  IF r.status = 'linked' THEN
    IF r.linked_package_id IS DISTINCT FROM p_package_id THEN RETURN jsonb_build_object('ok', false, 'code', 'linked_elsewhere', 'linked_package_id', r.linked_package_id); END IF;
    v_resumed := true;
  ELSIF r.status NOT IN ('new', 'read', 'unreadable', 'proposed', 'several', 'no_wire') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_open');
  END IF;
  IF NOT v_resumed AND (w.status IN ('cancelled', 'reversed') OR w.funding_txn_id IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'wire_not_eligible');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.wire_package_files WHERE package_id = p_package_id AND path = r.path) THEN
    INSERT INTO public.wire_package_files (package_id, kind, path, file_name, uploaded_by) VALUES (p_package_id, 'bank_confirmation', r.path, r.file_name, p_user);
    v_file := true;
  END IF;
  FOR x IN SELECT * FROM jsonb_array_elements(COALESCE(p_notices, '[]'::jsonb)) LOOP
    v_id := NULL;
    INSERT INTO public.wire_discrepancy_notices (dedupe_key, kind, package_id, inbox_id, note, created_by, mail_status)
      VALUES (left(x->>'dedupe_key', 200), x->>'kind', p_package_id, p_inbox_id, left(COALESCE(x->>'note', x->>'kind'), 1000), p_user, 'pending')
      ON CONFLICT (dedupe_key) DO NOTHING RETURNING id INTO v_id;
    IF v_id IS NOT NULL THEN v_ids := v_ids || v_id; END IF;
  END LOOP;
  IF NOT v_resumed THEN
    UPDATE public.wire_confirmation_inbox SET status = 'linked', linked_package_id = p_package_id, linked_by = p_user, linked_at = now(), note = NULLIF(left(COALESCE(p_note, ''), 1000), '')
      WHERE id = p_inbox_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'resumed', v_resumed, 'file_added', v_file, 'notice_ids', to_jsonb(v_ids));
END $fn$;
REVOKE ALL ON FUNCTION public.hub_wire_inbox_link(uuid, uuid, uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hub_wire_inbox_link(uuid, uuid, uuid, text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hub_wire_inbox_link(uuid, uuid, uuid, text, jsonb) TO service_role;

-- browsers get nothing: the Hub's server (service role) reads and writes, after its own permission checks
ALTER TABLE public.wire_confirmation_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wire_discrepancy_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wire_confirmation_inbox FROM anon, authenticated;
REVOKE ALL ON public.wire_discrepancy_notices FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.wire_confirmation_inbox TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.wire_discrepancy_notices TO service_role;

-- check list (every line should say OK)
SELECT 'wire_confirmation_inbox' AS item, CASE WHEN to_regclass('public.wire_confirmation_inbox') IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS result
UNION ALL SELECT 'wire_discrepancy_notices', CASE WHEN to_regclass('public.wire_discrepancy_notices') IS NOT NULL THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'no delete / locked decisions (inbox)', CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_wci_guard') THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'no delete / locked notes', CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_wdn_guard') THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'one note per discrepancy', CASE WHEN to_regclass('public.uq_wdn_dedupe') IS NOT NULL THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'attach = one step (file + notes + decision)', CASE WHEN to_regprocedure('public.hub_wire_inbox_link(uuid, uuid, uuid, text, jsonb)') IS NOT NULL AND NOT has_function_privilege('authenticated', 'public.hub_wire_inbox_link(uuid, uuid, uuid, text, jsonb)', 'EXECUTE') THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'each e-mail claimed once (pending → sending)', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'wire_discrepancy_notices' AND column_name = 'mail_claimed_at') AND to_regclass('public.wire_discrepancy_notices') IS NOT NULL THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'browsers cannot read the inbox', CASE WHEN NOT has_table_privilege('authenticated', 'public.wire_confirmation_inbox', 'SELECT') AND NOT has_table_privilege('anon', 'public.wire_confirmation_inbox', 'SELECT') THEN 'OK' ELSE 'OPEN' END;
