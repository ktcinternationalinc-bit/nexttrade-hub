CREATE TABLE IF NOT EXISTS public.accounting_customs_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL,
  seq integer NOT NULL CHECK (seq >= 1),
  invoice_number_at_creation text,
  invoice_date_at_creation date,
  accounting_customer_id uuid,
  business_id uuid,
  wave_business_id text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  voided_by uuid,
  voided_by_name text,
  void_reason text,
  CONSTRAINT uq_customs_inv_seq UNIQUE (invoice_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_customs_inv_invoice ON public.accounting_customs_invoices (invoice_id);

CREATE TABLE IF NOT EXISTS public.accounting_customs_invoice_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customs_invoice_id uuid NOT NULL REFERENCES public.accounting_customs_invoices(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version >= 1),
  doc jsonb NOT NULL CHECK (jsonb_typeof(doc) = 'object'),
  total numeric(14,2),
  currency text,
  note text,
  saved_by uuid,
  saved_by_name text,
  saved_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_customs_inv_version UNIQUE (customs_invoice_id, version)
);
CREATE INDEX IF NOT EXISTS idx_customs_inv_versions_doc ON public.accounting_customs_invoice_versions (customs_invoice_id);

CREATE OR REPLACE FUNCTION public.hub_customs_versions_keep() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  RAISE EXCEPTION 'HUB_GUARD: a saved customs invoice version is never changed or deleted. Save a new version instead.';
END $fn$;
DROP TRIGGER IF EXISTS trg_customs_versions_keep ON public.accounting_customs_invoice_versions;
CREATE TRIGGER trg_customs_versions_keep BEFORE UPDATE OR DELETE ON public.accounting_customs_invoice_versions
FOR EACH ROW EXECUTE FUNCTION public.hub_customs_versions_keep();
DROP TRIGGER IF EXISTS trg_customs_versions_keep_all ON public.accounting_customs_invoice_versions;
CREATE TRIGGER trg_customs_versions_keep_all BEFORE TRUNCATE ON public.accounting_customs_invoice_versions
FOR EACH STATEMENT EXECUTE FUNCTION public.hub_customs_versions_keep();

CREATE OR REPLACE FUNCTION public.hub_customs_invoices_keep() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'HUB_GUARD: a customs invoice is never deleted. Void it instead (it stays on record).';
  END IF;
  IF OLD.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'HUB_GUARD: a voided customs invoice is history and cannot be changed.';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id OR NEW.seq IS DISTINCT FROM OLD.seq
     OR NEW.invoice_number_at_creation IS DISTINCT FROM OLD.invoice_number_at_creation
     OR NEW.invoice_date_at_creation IS DISTINCT FROM OLD.invoice_date_at_creation
     OR NEW.accounting_customer_id IS DISTINCT FROM OLD.accounting_customer_id OR NEW.business_id IS DISTINCT FROM OLD.business_id
     OR NEW.wave_business_id IS DISTINCT FROM OLD.wave_business_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_by_name IS DISTINCT FROM OLD.created_by_name
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'HUB_GUARD: what a customs invoice is saved under, and who made it when, cannot be changed.';
  END IF;
  IF NEW.voided_at IS NULL THEN
    RAISE EXCEPTION 'HUB_GUARD: the only change allowed on a customs invoice is voiding it.';
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_customs_invoices_keep ON public.accounting_customs_invoices;
CREATE TRIGGER trg_customs_invoices_keep BEFORE UPDATE OR DELETE ON public.accounting_customs_invoices
FOR EACH ROW EXECUTE FUNCTION public.hub_customs_invoices_keep();
DROP TRIGGER IF EXISTS trg_customs_invoices_keep_all ON public.accounting_customs_invoices;
CREATE TRIGGER trg_customs_invoices_keep_all BEFORE TRUNCATE ON public.accounting_customs_invoices
FOR EACH STATEMENT EXECUTE FUNCTION public.hub_customs_invoices_keep();

CREATE OR REPLACE FUNCTION public.hub_customs_invoice_create(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  v_inv uuid := (p ->> 'invoice_id')::uuid;
  v_seq integer;
  v_id uuid;
  v_ver uuid;
BEGIN
  IF v_inv IS NULL THEN RAISE EXCEPTION 'HUB_INPUT: which invoice?'; END IF;
  IF jsonb_typeof(p -> 'doc') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'HUB_INPUT: the customs invoice is empty.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('hub_customs_invoice:' || v_inv::text));
  SELECT coalesce(max(seq), 0) + 1 INTO v_seq FROM public.accounting_customs_invoices WHERE invoice_id = v_inv;
  INSERT INTO public.accounting_customs_invoices (invoice_id, seq, invoice_number_at_creation, invoice_date_at_creation, accounting_customer_id,
    business_id, wave_business_id, created_by, created_by_name)
  VALUES (v_inv, v_seq, p ->> 'invoice_number', nullif(p ->> 'invoice_date', '')::date, nullif(p ->> 'accounting_customer_id', '')::uuid,
    nullif(p ->> 'business_id', '')::uuid, nullif(p ->> 'wave_business_id', ''), nullif(p ->> 'actor_id', '')::uuid, p ->> 'actor_name')
  RETURNING id INTO v_id;
  INSERT INTO public.accounting_customs_invoice_versions (customs_invoice_id, version, doc, total, currency, note, saved_by, saved_by_name)
  VALUES (v_id, 1, p -> 'doc', nullif(p ->> 'total', '')::numeric, p ->> 'currency', nullif(p ->> 'note', ''), nullif(p ->> 'actor_id', '')::uuid, p ->> 'actor_name')
  RETURNING id INTO v_ver;
  RETURN jsonb_build_object('id', v_id, 'seq', v_seq, 'version', 1, 'version_id', v_ver);
END $fn$;

CREATE OR REPLACE FUNCTION public.hub_customs_invoice_save(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  v_id uuid := (p ->> 'customs_invoice_id')::uuid;
  v_base integer := (p ->> 'base_version')::integer;
  v_row public.accounting_customs_invoices%ROWTYPE;
  v_newest integer;
  v_ver uuid;
BEGIN
  IF v_id IS NULL THEN RAISE EXCEPTION 'HUB_INPUT: which customs invoice?'; END IF;
  IF jsonb_typeof(p -> 'doc') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'HUB_INPUT: the customs invoice is empty.'; END IF;
  SELECT * INTO v_row FROM public.accounting_customs_invoices WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HUB_NOT_FOUND: that customs invoice is not on record.'; END IF;
  IF v_row.voided_at IS NOT NULL THEN RAISE EXCEPTION 'HUB_VOIDED: this customs invoice was voided and cannot be edited.'; END IF;
  SELECT coalesce(max(version), 0) INTO v_newest FROM public.accounting_customs_invoice_versions WHERE customs_invoice_id = v_id;
  IF v_base IS NULL OR v_base <> v_newest THEN
    RAISE EXCEPTION 'HUB_STALE: someone saved version % meanwhile. Reload to see it, then make your change again.', v_newest;
  END IF;
  INSERT INTO public.accounting_customs_invoice_versions (customs_invoice_id, version, doc, total, currency, note, saved_by, saved_by_name)
  VALUES (v_id, v_newest + 1, p -> 'doc', nullif(p ->> 'total', '')::numeric, p ->> 'currency', nullif(p ->> 'note', ''), nullif(p ->> 'actor_id', '')::uuid, p ->> 'actor_name')
  RETURNING id INTO v_ver;
  RETURN jsonb_build_object('id', v_id, 'version', v_newest + 1, 'version_id', v_ver);
END $fn$;

CREATE OR REPLACE FUNCTION public.hub_customs_invoice_void(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  v_id uuid := (p ->> 'customs_invoice_id')::uuid;
  v_row public.accounting_customs_invoices%ROWTYPE;
BEGIN
  IF v_id IS NULL THEN RAISE EXCEPTION 'HUB_INPUT: which customs invoice?'; END IF;
  SELECT * INTO v_row FROM public.accounting_customs_invoices WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HUB_NOT_FOUND: that customs invoice is not on record.'; END IF;
  IF v_row.voided_at IS NOT NULL THEN RAISE EXCEPTION 'HUB_VOIDED: this customs invoice was already voided.'; END IF;
  UPDATE public.accounting_customs_invoices
     SET voided_at = now(), voided_by = nullif(p ->> 'actor_id', '')::uuid, voided_by_name = p ->> 'actor_name', void_reason = nullif(p ->> 'reason', '')
   WHERE id = v_id;
  RETURN jsonb_build_object('id', v_id, 'voided', true);
END $fn$;

ALTER TABLE public.accounting_customs_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_customs_invoice_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.accounting_customs_invoices FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.accounting_customs_invoice_versions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.accounting_customs_invoices TO service_role;
GRANT SELECT, INSERT ON public.accounting_customs_invoice_versions TO service_role;
REVOKE ALL ON FUNCTION public.hub_customs_invoice_create(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hub_customs_invoice_save(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hub_customs_invoice_void(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hub_customs_invoice_create(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.hub_customs_invoice_save(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.hub_customs_invoice_void(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.hub_customs_versions_keep() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hub_customs_invoices_keep() FROM PUBLIC, anon, authenticated;

SELECT
  CASE WHEN (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.accounting_customs_invoices'::regclass) THEN 'OK' ELSE 'CHECK: RLS off' END AS customs_table,
  CASE WHEN (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.accounting_customs_invoice_versions'::regclass) THEN 'OK' ELSE 'CHECK: RLS off' END AS versions_table,
  CASE WHEN (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_customs_versions_keep','trg_customs_versions_keep_all','trg_customs_invoices_keep','trg_customs_invoices_keep_all')) = 4 THEN 'OK' ELSE 'CHECK: guards missing' END AS guards,
  CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('hub_customs_invoice_create','hub_customs_invoice_save','hub_customs_invoice_void')) = 3 THEN 'OK' ELSE 'CHECK: steps missing' END AS steps,
  CASE WHEN (SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name IN ('accounting_customs_invoices','accounting_customs_invoice_versions') AND grantee IN ('anon','authenticated','PUBLIC')) = 0
        AND NOT has_function_privilege('anon', 'public.hub_customs_invoice_create(jsonb)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.hub_customs_invoice_save(jsonb)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.hub_customs_invoice_void(jsonb)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.hub_customs_invoice_create(jsonb)', 'EXECUTE')
       THEN 'OK closed to browsers' ELSE 'CHECK: browsers can reach it' END AS browser_access;
