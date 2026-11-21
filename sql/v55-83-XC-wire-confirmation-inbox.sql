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
ALTER TABLE public.wire_discrepancy_notices ADD CONSTRAINT wdn_mail_status_ok CHECK (mail_status IN ('pending', 'sent', 'partly_sent', 'not_sent', 'no_recipients'));
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
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_wdn_guard ON public.wire_discrepancy_notices;
CREATE TRIGGER trg_wdn_guard BEFORE UPDATE OR DELETE ON public.wire_discrepancy_notices FOR EACH ROW EXECUTE FUNCTION public.wdn_guard();

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
UNION ALL SELECT 'browsers cannot read the inbox', CASE WHEN NOT has_table_privilege('authenticated', 'public.wire_confirmation_inbox', 'SELECT') AND NOT has_table_privilege('anon', 'public.wire_confirmation_inbox', 'SELECT') THEN 'OK' ELSE 'OPEN' END;
