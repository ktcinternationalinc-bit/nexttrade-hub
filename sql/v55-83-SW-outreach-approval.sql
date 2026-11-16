-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-SW — Project 1 (commercial agent), Stage 2: correspondence with approval.
-- Max, Nov 15 2026: "1. Roma - Executive Assistant to the CEO  2. Super admin or anyone with the permission to.  3. yes"
--   (signature · who approves outgoing messages · use the info@ktcus.com mailbox)
--
-- commercial_messages — one thread per request + supplier, both directions.
--   out: draft → pending_approval → approved → sending → sent (→ bounced) · failed · discarded
--   in : received (a reply read from info@ktcus.com)
-- Rules kept by the database, not only by the screen:
--   · an approval is for an EXACT version: changing the recipient, subject or text after it was sent for approval or
--     approved puts the message back to draft (content_hash is computed here, never by the caller);
--   · a message can only go to "sending" when its approved version is still the current version;
--   · once sent or received, a message is never rewritten and no message is ever deleted;
--   · one live draft per request + supplier, and a Message-ID can exist only once (no double sending, no double import).
-- Server only: row level security on, no policies, no access for web users. Safe to run more than once. Deletes nothing.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.commercial_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id      uuid NOT NULL REFERENCES public.sourcing_requests(id),
  supplier_id     uuid NOT NULL REFERENCES public.suppliers(id),
  direction       text NOT NULL CHECK (direction IN ('out', 'in')),
  kind            text NOT NULL DEFAULT 'first' CHECK (kind IN ('first', 'followup', 'reply', 'inbound', 'bounce')),
  followup_no     int NOT NULL DEFAULT 0,
  from_address    text,
  to_address      text,
  subject         text NOT NULL,
  body            text NOT NULL,
  content_hash    text,
  status          text NOT NULL CHECK (status IN ('draft', 'pending_approval', 'approved', 'sending', 'sent', 'failed', 'bounced', 'discarded', 'received')),
  message_id      text,                -- RFC Message-ID: ours for outgoing (set when sending), theirs for incoming
  in_reply_to     text,
  attachments     jsonb NOT NULL DEFAULT '[]'::jsonb,   -- incoming files saved in the private bucket [{path:'pv/…', name, size}]
  flags           jsonb NOT NULL DEFAULT '[]'::jsonb,   -- warnings on an incoming message (bank details, "are you a person?")
  created_by      uuid,
  submitted_by    uuid,
  submitted_at    timestamptz,
  approved_by     uuid,
  approved_at     timestamptz,
  approved_hash   text,
  sent_at         timestamptz,
  received_at     timestamptz,
  attempts        int NOT NULL DEFAULT 0,
  last_error      text,
  smtp_response   text,
  discarded_why   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cm_direction_status CHECK ((direction = 'in') = (status = 'received')),
  CONSTRAINT cm_sent_has_id CHECK (status NOT IN ('sent', 'bounced', 'received') OR message_id IS NOT NULL)
);
-- an outgoing message cannot go for approval (or further) without a real address — an empty one counts as missing
ALTER TABLE public.commercial_messages DROP CONSTRAINT IF EXISTS cm_out_has_recipient;
ALTER TABLE public.commercial_messages ADD CONSTRAINT cm_out_has_recipient
  CHECK (direction = 'in' OR status IN ('draft', 'discarded') OR coalesce(to_address, '') ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');
CREATE UNIQUE INDEX IF NOT EXISTS uq_cm_message_id ON public.commercial_messages (message_id) WHERE message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cm_one_live_draft ON public.commercial_messages (request_id, supplier_id) WHERE status IN ('draft', 'pending_approval', 'approved', 'sending');
CREATE INDEX IF NOT EXISTS ix_cm_thread ON public.commercial_messages (request_id, supplier_id, created_at);
CREATE INDEX IF NOT EXISTS ix_cm_status ON public.commercial_messages (status, updated_at);

CREATE OR REPLACE FUNCTION public.commercial_message_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'COMMERCIAL_MESSAGE_LOCKED: correspondence is never deleted — discard a draft instead.'; END IF;
  NEW.content_hash := md5(coalesce(lower(trim(NEW.to_address)), '') || '|' || coalesce(NEW.subject, '') || '|' || coalesce(NEW.body, ''));
  NEW.updated_at := now();
  IF TG_OP = 'INSERT' THEN
    IF NEW.direction = 'out' AND NEW.status NOT IN ('draft') THEN RAISE EXCEPTION 'COMMERCIAL_MESSAGE_LOCKED: an outgoing message starts as a draft.'; END IF;
    RETURN NEW;
  END IF;
  -- what was sent or received is history
  IF OLD.status IN ('sent', 'bounced', 'received', 'discarded') THEN
    IF NEW.content_hash IS DISTINCT FROM OLD.content_hash OR NEW.message_id IS DISTINCT FROM OLD.message_id OR NEW.request_id IS DISTINCT FROM OLD.request_id
       OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id OR NEW.direction IS DISTINCT FROM OLD.direction OR NEW.from_address IS DISTINCT FROM OLD.from_address
       OR NEW.sent_at IS DISTINCT FROM OLD.sent_at OR NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_hash IS DISTINCT FROM OLD.approved_hash THEN
      RAISE EXCEPTION 'COMMERCIAL_MESSAGE_LOCKED: a % message is never rewritten.', OLD.status;
    END IF;
    IF NOT (NEW.status = OLD.status OR (OLD.status = 'sent' AND NEW.status = 'bounced')) THEN
      RAISE EXCEPTION 'COMMERCIAL_MESSAGE_LOCKED: a % message cannot become %.', OLD.status, NEW.status;
    END IF;
    RETURN NEW;
  END IF;
  -- an edit after it went for approval sends it back to draft: the approval was for the old version
  IF NEW.content_hash IS DISTINCT FROM OLD.content_hash THEN
    IF OLD.status IN ('sending') THEN RAISE EXCEPTION 'COMMERCIAL_MESSAGE_LOCKED: the message is being sent.'; END IF;
    IF NEW.status IN ('pending_approval', 'approved') THEN
      NEW.status := 'draft'; NEW.approved_by := NULL; NEW.approved_at := NULL; NEW.approved_hash := NULL; NEW.submitted_by := NULL; NEW.submitted_at := NULL;
    END IF;
  END IF;
  IF NEW.status = 'approved' AND (NEW.approved_hash IS NULL OR NEW.approved_hash IS DISTINCT FROM NEW.content_hash OR NEW.approved_by IS NULL) THEN
    RAISE EXCEPTION 'COMMERCIAL_MESSAGE_LOCKED: an approval must name the approver and the exact version.';
  END IF;
  IF NEW.status = 'sending' AND (OLD.status IS DISTINCT FROM 'approved' AND OLD.status IS DISTINCT FROM 'sending') THEN
    RAISE EXCEPTION 'COMMERCIAL_MESSAGE_LOCKED: only an approved message can be sent.';
  END IF;
  IF NEW.status = 'sending' AND NEW.approved_hash IS DISTINCT FROM NEW.content_hash THEN
    RAISE EXCEPTION 'COMMERCIAL_MESSAGE_LOCKED: the message changed after it was approved.';
  END IF;
  IF NEW.status = 'sent' AND OLD.status IS DISTINCT FROM 'sending' THEN
    RAISE EXCEPTION 'COMMERCIAL_MESSAGE_LOCKED: a message is marked sent only by the sending step.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_commercial_message_guard ON public.commercial_messages;
CREATE TRIGGER trg_commercial_message_guard BEFORE INSERT OR UPDATE OR DELETE ON public.commercial_messages FOR EACH ROW EXECUTE FUNCTION public.commercial_message_guard();

-- drafts prepared in Stage 1 (v55.83-SV) move into the thread, once
INSERT INTO public.commercial_messages (request_id, supplier_id, direction, kind, to_address, subject, body, status, created_by, created_at)
SELECT d.request_id, d.supplier_id, 'out', 'first', d.to_address, d.subject, d.body, 'draft', d.created_by, d.created_at
  FROM public.outreach_drafts d
 WHERE d.status = 'draft'
   AND to_regclass('public.outreach_drafts') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.commercial_messages m WHERE m.request_id = d.request_id AND m.supplier_id = d.supplier_id);

-- a request that has written to suppliers is "in contact"
ALTER TABLE public.sourcing_requests DROP CONSTRAINT IF EXISTS sourcing_requests_stage_check;
ALTER TABLE public.sourcing_requests ADD CONSTRAINT sourcing_requests_stage_check
  CHECK (stage IN ('new', 'researching', 'shortlist', 'drafts_ready', 'in_contact', 'on_hold', 'closed'));

-- the mailbox reader remembers how far it has read (one row)
CREATE TABLE IF NOT EXISTS public.commercial_mail_state (
  id            int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_check_at timestamptz,
  last_result   jsonb,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.commercial_messages   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commercial_mail_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.commercial_messages, public.commercial_mail_state FROM anon, authenticated;
