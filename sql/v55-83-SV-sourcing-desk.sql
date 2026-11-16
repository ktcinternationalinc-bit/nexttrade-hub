-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-SV — Project 1 (commercial agent), Stage 1: the Sourcing desk.
-- Max, Nov 15 2026: "I need also an agent to procure goods find suppliers … Research trade shows. Maintain correspondence.
-- Discuss prices …" · "You need to find a way to organize communication and requests to you." · "start with project 1"
--
-- Records only. Nothing here sends a message, commits to a purchase or pays anyone.
--   sourcing_requests   — every request is a numbered assignment (SR-0001) with an owner, a stage, a next action, a due date
--   suppliers           — supplier records (duplicates are refused by normalized name / website)
--   supplier_contacts   — how to reach a supplier, with where each contact was found
--   supplier_facts      — what is known about a supplier: VERIFIED (a person has evidence) / CLAIM (stated on a source) /
--                         ESTIMATE — always with the source link and the date. Never edited or erased: a wrong fact is retracted.
--   sourcing_shortlist  — which suppliers were proposed for which request, kept or dropped (with the reason)
--   outreach_drafts     — a message PREPARED for a person to read. Stage 1 has drafts only; nothing is sent.
--   agent_jobs          — background work (web research) with retries and a one-job-at-a-time guard per request
--
-- Server only: row level security is on and no policy is created, so only the Hub's server key can read or write.
-- Safe to run more than once. Deletes nothing.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE SEQUENCE IF NOT EXISTS public.sourcing_request_seq;

CREATE TABLE IF NOT EXISTS public.sourcing_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq           bigint NOT NULL DEFAULT nextval('public.sourcing_request_seq'),
  company       text NOT NULL,
  direction     text NOT NULL CHECK (direction IN ('buy', 'sell', 'offered', 'requested')),
  title         text NOT NULL,
  product       text NOT NULL,
  specs         text,
  quantity      text,
  destination   text,
  needed_by     date,
  internal_note text,                 -- limits, target prices, who asked: NEVER sent to a supplier or to web research
  attachments   jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{path:'pv/…', name}] in the private bucket
  owner_id      uuid,
  created_by    uuid,
  stage         text NOT NULL DEFAULT 'new' CHECK (stage IN ('new', 'researching', 'shortlist', 'drafts_ready', 'on_hold', 'closed')),
  next_action   text,
  due_date      date,
  closed_reason text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sourcing_closed_needs_reason CHECK (stage <> 'closed' OR length(trim(coalesce(closed_reason, ''))) >= 3)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sourcing_requests_seq ON public.sourcing_requests (seq);
CREATE INDEX IF NOT EXISTS ix_sourcing_requests_stage ON public.sourcing_requests (stage, due_date);

CREATE TABLE IF NOT EXISTS public.suppliers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name    text NOT NULL,
  trading_name  text,
  name_key      text NOT NULL,        -- normalized name: one supplier, one record
  role          text NOT NULL DEFAULT 'unknown' CHECK (role IN ('manufacturer', 'distributor', 'broker', 'stockholder', 'auction', 'other', 'unknown')),
  country       text,
  city          text,
  website       text,
  website_key   text,                 -- host without www
  products      text,
  notes         text,
  status        text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'contacted', 'verified', 'rejected')),
  added_by_kind text NOT NULL DEFAULT 'person' CHECK (added_by_kind IN ('person', 'agent')),
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_suppliers_name_key ON public.suppliers (name_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_suppliers_website_key ON public.suppliers (website_key) WHERE website_key IS NOT NULL AND website_key <> '';

CREATE TABLE IF NOT EXISTS public.supplier_contacts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id  uuid NOT NULL REFERENCES public.suppliers(id),
  name         text,
  title        text,
  email        text,
  phone        text,
  whatsapp     text,
  source_url   text,                  -- where this contact was found
  found_on     date,
  verified_at  timestamptz,           -- set only when a person confirms it (a reply, a call)
  verified_by  uuid,
  added_by_kind text NOT NULL DEFAULT 'person' CHECK (added_by_kind IN ('person', 'agent')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_contact_has_a_way CHECK (coalesce(email, phone, whatsapp) IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_supplier_contacts_supplier ON public.supplier_contacts (supplier_id);

CREATE TABLE IF NOT EXISTS public.supplier_facts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id   uuid NOT NULL REFERENCES public.suppliers(id),
  request_id    uuid REFERENCES public.sourcing_requests(id),
  topic         text NOT NULL,
  statement     text NOT NULL,
  grade         text NOT NULL CHECK (grade IN ('verified', 'claim', 'estimate')),
  confidence    text NOT NULL DEFAULT 'medium' CHECK (confidence IN ('high', 'medium', 'low')),
  source_url    text,
  source_title  text,
  observed_on   date NOT NULL DEFAULT current_date,
  evidence_note text,                 -- for VERIFIED: what the person saw (a reply, a document)
  added_by_kind text NOT NULL DEFAULT 'person' CHECK (added_by_kind IN ('person', 'agent')),
  created_by    uuid,
  retracted_at  timestamptz,
  retracted_by  uuid,
  retracted_why text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- the agent never marks anything verified; a claim or an estimate found on the web always carries its link
  CONSTRAINT supplier_fact_agent_never_verifies CHECK (added_by_kind <> 'agent' OR grade <> 'verified'),
  CONSTRAINT supplier_fact_agent_has_source CHECK (added_by_kind <> 'agent' OR (source_url IS NOT NULL AND source_url ~* '^https?://')),
  CONSTRAINT supplier_fact_verified_has_evidence CHECK (grade <> 'verified' OR length(trim(coalesce(evidence_note, ''))) >= 5)
);
CREATE INDEX IF NOT EXISTS ix_supplier_facts_supplier ON public.supplier_facts (supplier_id);

-- a fact is never rewritten or erased: only its retraction fields may be filled in, once
CREATE OR REPLACE FUNCTION public.supplier_fact_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'SUPPLIER_FACT_LOCKED: a recorded fact is never erased — retract it with a reason.'; END IF;
  IF NEW.supplier_id IS DISTINCT FROM OLD.supplier_id OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.topic IS DISTINCT FROM OLD.topic
     OR NEW.statement IS DISTINCT FROM OLD.statement OR NEW.grade IS DISTINCT FROM OLD.grade OR NEW.confidence IS DISTINCT FROM OLD.confidence
     OR NEW.source_url IS DISTINCT FROM OLD.source_url OR NEW.source_title IS DISTINCT FROM OLD.source_title OR NEW.observed_on IS DISTINCT FROM OLD.observed_on
     OR NEW.evidence_note IS DISTINCT FROM OLD.evidence_note OR NEW.added_by_kind IS DISTINCT FROM OLD.added_by_kind OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'SUPPLIER_FACT_LOCKED: a recorded fact is never rewritten — retract it and record the correct one.';
  END IF;
  IF OLD.retracted_at IS NOT NULL THEN RAISE EXCEPTION 'SUPPLIER_FACT_LOCKED: this fact was already retracted.'; END IF;
  IF NEW.retracted_at IS NULL OR length(trim(coalesce(NEW.retracted_why, ''))) < 5 THEN RAISE EXCEPTION 'SUPPLIER_FACT_LOCKED: a retraction needs a reason.'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_supplier_fact_guard ON public.supplier_facts;
CREATE TRIGGER trg_supplier_fact_guard BEFORE UPDATE OR DELETE ON public.supplier_facts FOR EACH ROW EXECUTE FUNCTION public.supplier_fact_guard();

CREATE TABLE IF NOT EXISTS public.sourcing_shortlist (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id     uuid NOT NULL REFERENCES public.sourcing_requests(id),
  supplier_id    uuid NOT NULL REFERENCES public.suppliers(id),
  fit_note       text,
  concerns       text,
  rank           int,
  status         text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'kept', 'dropped')),
  dropped_reason text,
  decided_by     uuid,
  decided_at     timestamptz,
  added_by_kind  text NOT NULL DEFAULT 'person' CHECK (added_by_kind IN ('person', 'agent')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sourcing_shortlist_drop_needs_reason CHECK (status <> 'dropped' OR length(trim(coalesce(dropped_reason, ''))) >= 3)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sourcing_shortlist ON public.sourcing_shortlist (request_id, supplier_id);

CREATE TABLE IF NOT EXISTS public.outreach_drafts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id   uuid NOT NULL REFERENCES public.sourcing_requests(id),
  supplier_id  uuid NOT NULL REFERENCES public.suppliers(id),
  channel      text NOT NULL DEFAULT 'email' CHECK (channel IN ('email')),
  to_address   text,
  subject      text NOT NULL,
  body         text NOT NULL,
  language     text NOT NULL DEFAULT 'en',
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'discarded')),   -- Stage 1: nothing can be sent
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_outreach_draft_live ON public.outreach_drafts (request_id, supplier_id) WHERE status = 'draft';

CREATE TABLE IF NOT EXISTS public.agent_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL CHECK (kind IN ('sourcing_research')),
  ref_id        uuid NOT NULL,
  status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  attempts      int NOT NULL DEFAULT 0,
  max_attempts  int NOT NULL DEFAULT 3,
  run_after     timestamptz NOT NULL DEFAULT now(),
  locked_at     timestamptz,
  last_error    text,
  result        jsonb,
  searches      int NOT NULL DEFAULT 0,          -- paid web searches this job used (as reported by the AI provider)
  input_tokens  bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);
-- one live research job per request: pressing the button twice never pays for the same research twice
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_job_live ON public.agent_jobs (kind, ref_id) WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS ix_agent_jobs_due ON public.agent_jobs (status, run_after);

-- take the next due job (or a stuck one) — one worker at a time gets it
CREATE OR REPLACE FUNCTION public.agent_job_claim(p_stuck_minutes int DEFAULT 10) RETURNS SETOF public.agent_jobs
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE j public.agent_jobs;
BEGIN
  SELECT * INTO j FROM public.agent_jobs
   WHERE (status = 'queued' AND run_after <= now())
      OR (status = 'running' AND locked_at < now() - make_interval(mins => greatest(p_stuck_minutes, 2)))
   ORDER BY run_after
   LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN; END IF;
  IF j.attempts >= j.max_attempts THEN
    UPDATE public.agent_jobs SET status = 'failed', finished_at = now(), last_error = coalesce(last_error, 'gave up after ' || j.attempts || ' attempts') WHERE id = j.id;
    RETURN;
  END IF;
  UPDATE public.agent_jobs SET status = 'running', locked_at = now(), attempts = attempts + 1 WHERE id = j.id RETURNING * INTO j;
  RETURN NEXT j;
END $$;
REVOKE ALL ON FUNCTION public.agent_job_claim(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_job_claim(int) TO service_role;

ALTER TABLE public.sourcing_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_contacts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_facts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sourcing_shortlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_drafts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_jobs         ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sourcing_requests, public.suppliers, public.supplier_contacts, public.supplier_facts, public.sourcing_shortlist, public.outreach_drafts, public.agent_jobs FROM anon, authenticated;
