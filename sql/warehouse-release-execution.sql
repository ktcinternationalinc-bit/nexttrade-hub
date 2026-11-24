-- Code-release queue coordination only. No warehouse/business tables are touched.
BEGIN;
CREATE TABLE IF NOT EXISTS public.release_worker_credentials (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  worker text NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.release_worker_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.release_worker_credentials FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.release_worker_credentials TO service_role;
CREATE TABLE IF NOT EXISTS public.release_execution (
  request_id bigint PRIMARY KEY REFERENCES public.release_signoffs(id),
  worker text NOT NULL,
  phase text NOT NULL CHECK (phase IN ('running', 'finished', 'attention')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.release_worker_status (
  id integer PRIMARY KEY CHECK (id = 1),
  worker text NOT NULL,
  version text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  last_seen timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.release_execution ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.release_worker_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.release_execution, public.release_worker_status FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.release_execution, public.release_worker_status TO service_role;

-- Atomic batch: either every selected approval is recorded or none is. Fresh heads
-- prevent a stale screen from approving/withdrawing over a newer request or move.
CREATE OR REPLACE FUNCTION public.release_enqueue(p_rows jsonb, p_heads jsonb)
RETURNS SETOF public.release_signoffs LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $fn$
DECLARE r jsonb; latest bigint; inserted public.release_signoffs;
BEGIN
  PERFORM pg_advisory_xact_lock(74109245);
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'Invalid selection'; END IF;
  IF (SELECT count(DISTINCT value->>'item_id') FROM jsonb_array_elements(p_rows)) <> jsonb_array_length(p_rows) THEN RAISE EXCEPTION 'Duplicate selected change'; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    IF r->>'action' NOT IN ('go','rollback','withdraw') THEN RAISE EXCEPTION 'Invalid request action'; END IF;
    IF NOT (p_heads ? (r->>'item_id')) THEN RAISE EXCEPTION 'Missing state version'; END IF;
    SELECT coalesce(max(id),0) INTO latest FROM public.release_signoffs WHERE item_id=r->>'item_id' AND scope='warehouse';
    IF latest <> (p_heads->>(r->>'item_id'))::bigint THEN RAISE EXCEPTION 'Change state changed; refresh and review again'; END IF;
    IF EXISTS (SELECT 1 FROM public.release_execution e JOIN public.release_signoffs s ON s.id=e.request_id WHERE s.item_id=r->>'item_id' AND e.phase IN ('running','attention')) THEN RAISE EXCEPTION 'Change is executing or needs recovery; no new request'; END IF;
  END LOOP;
  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    INSERT INTO public.release_signoffs(item_id,scope,action,sha,approval_text,detail,ref_id,signed_by,signed_by_name)
      VALUES(r->>'item_id','warehouse',r->>'action',r->>'sha',r->>'approval_text',r->'detail',nullif(r->>'ref_id','')::bigint,(r->>'signed_by')::uuid,r->>'signed_by_name') RETURNING * INTO inserted;
    RETURN NEXT inserted;
  END LOOP;
END;
$fn$;

-- No lease expiry/retry on uncertain execution: a stopped worker must not deploy twice.
CREATE OR REPLACE FUNCTION public.release_claim(p_request bigint, p_worker text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $fn$
DECLARE s public.release_signoffs; latest bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(74109245);
  IF length(btrim(p_worker)) < 3 THEN RAISE EXCEPTION 'Worker required'; END IF;
  IF EXISTS(SELECT 1 FROM public.release_execution WHERE phase IN ('running','attention') OR request_id=p_request) THEN RETURN false; END IF;
  SELECT * INTO s FROM public.release_signoffs WHERE id=p_request AND scope='warehouse';
  IF s.id IS NULL OR s.action NOT IN ('go','rollback') OR coalesce(s.detail->>'execution','') <> 'warehouse-worker-v1' THEN RETURN false; END IF;
  SELECT max(id) INTO latest FROM public.release_signoffs WHERE item_id=s.item_id AND scope='warehouse';
  IF latest <> s.id THEN RETURN false; END IF;
  INSERT INTO public.release_execution(request_id,worker,phase) VALUES(p_request,p_worker,'running');
  RETURN true;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.release_finish(p_request bigint, p_worker text, p_event jsonb, p_attention boolean)
RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $fn$
DECLARE s public.release_signoffs; result_id bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(74109245);
  IF NOT EXISTS(SELECT 1 FROM public.release_execution WHERE request_id=p_request AND worker=p_worker AND phase='running') THEN RAISE EXCEPTION 'No running claim owned by worker'; END IF;
  SELECT * INTO s FROM public.release_signoffs WHERE id=p_request;
  IF p_event->>'action' NOT IN ('moved','failed','recovery_incomplete','rolled_back','rollback_failed') THEN RAISE EXCEPTION 'Invalid execution result'; END IF;
  IF (s.action='go' AND p_event->>'action' NOT IN ('moved','failed','recovery_incomplete')) OR (s.action='rollback' AND p_event->>'action' NOT IN ('rolled_back','rollback_failed')) THEN RAISE EXCEPTION 'Result does not match request'; END IF;
  IF p_attention IS DISTINCT FROM (p_event->>'action' IN ('recovery_incomplete','rollback_failed')) THEN RAISE EXCEPTION 'Recovery state mismatch'; END IF;
  INSERT INTO public.release_signoffs(item_id,scope,action,sha,detail,ref_id,recorded_by)
    VALUES(s.item_id,'warehouse',p_event->>'action',s.sha,p_event->'detail',s.id,p_worker) RETURNING id INTO result_id;
  UPDATE public.release_execution SET phase=CASE WHEN p_attention THEN 'attention' ELSE 'finished' END,finished_at=now() WHERE request_id=p_request;
  RETURN result_id;
END;
$fn$;
CREATE OR REPLACE FUNCTION public.release_check(p_move bigint, p_head bigint, p_note text, p_actor uuid, p_name text)
RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $fn$
DECLARE s public.release_signoffs; result_id bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(74109245);
  SELECT * INTO s FROM public.release_signoffs WHERE id=p_move AND action='moved';
  IF s.id IS NULL OR p_actor IS NULL OR length(btrim(coalesce(p_note,''))) < 10 THEN RAISE EXCEPTION 'A deployed change, checker and test notes are required'; END IF;
  IF p_head IS DISTINCT FROM (SELECT max(id) FROM public.release_signoffs WHERE item_id=s.item_id AND scope='warehouse') THEN RAISE EXCEPTION 'Change state changed; refresh and review again'; END IF;
  IF EXISTS(SELECT 1 FROM public.release_execution e JOIN public.release_signoffs r ON r.id=e.request_id WHERE r.item_id=s.item_id AND e.phase IN ('running','attention')) THEN RAISE EXCEPTION 'Execution is not finished'; END IF;
  INSERT INTO public.release_signoffs(item_id,scope,action,sha,detail,ref_id,signed_by,signed_by_name,recorded_by)
    VALUES(s.item_id,'warehouse','checked_live',s.sha,s.detail || jsonb_build_object('checked',left(p_note,2000),'note',left(p_note,2000)),s.id,p_actor,p_name,'Hub verified user ' || p_actor::text) RETURNING id INTO result_id;
  RETURN result_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.release_check(bigint,bigint,text,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_check(bigint,bigint,text,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.release_enqueue(jsonb,jsonb), public.release_claim(bigint,text), public.release_finish(bigint,text,jsonb,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_enqueue(jsonb,jsonb), public.release_claim(bigint,text), public.release_finish(bigint,text,jsonb,boolean) TO service_role;
COMMIT;
