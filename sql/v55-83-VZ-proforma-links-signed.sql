CREATE TABLE IF NOT EXISTS public.accounting_proforma_invoice_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proforma_id uuid NOT NULL REFERENCES public.accounting_proformas(id) ON DELETE RESTRICT,
  invoice_id uuid NOT NULL,
  proforma_number text,
  invoice_number text,
  other_customer_confirmed boolean NOT NULL DEFAULT false,
  linked_by uuid,
  linked_by_name text,
  linked_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  removed_by uuid,
  removed_by_name text,
  removed_reason text
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pf_inv_links_active_invoice ON public.accounting_proforma_invoice_links (invoice_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pf_inv_links_proforma ON public.accounting_proforma_invoice_links (proforma_id);

CREATE TABLE IF NOT EXISTS public.accounting_proforma_signed_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proforma_id uuid NOT NULL REFERENCES public.accounting_proformas(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version >= 1),
  storage_bucket text NOT NULL DEFAULT 'proforma-signed',
  storage_path text NOT NULL,
  file_name text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  sha256 text NOT NULL,
  note text,
  uploaded_by uuid,
  uploaded_by_name text,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_pf_signed_version UNIQUE (proforma_id, version),
  CONSTRAINT uq_pf_signed_path UNIQUE (storage_path),
  CONSTRAINT uq_pf_signed_hash UNIQUE (proforma_id, sha256)
);
CREATE INDEX IF NOT EXISTS idx_pf_signed_proforma ON public.accounting_proforma_signed_files (proforma_id);

CREATE OR REPLACE FUNCTION public.hub_pf_signed_files_keep() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  RAISE EXCEPTION 'HUB_GUARD: a signed proforma file is never changed or deleted. Add a new version instead.';
END $fn$;

DROP TRIGGER IF EXISTS trg_pf_signed_files_keep ON public.accounting_proforma_signed_files;
CREATE TRIGGER trg_pf_signed_files_keep BEFORE UPDATE OR DELETE ON public.accounting_proforma_signed_files
FOR EACH ROW EXECUTE FUNCTION public.hub_pf_signed_files_keep();
DROP TRIGGER IF EXISTS trg_pf_signed_files_keep_all ON public.accounting_proforma_signed_files;
CREATE TRIGGER trg_pf_signed_files_keep_all BEFORE TRUNCATE ON public.accounting_proforma_signed_files
FOR EACH STATEMENT EXECUTE FUNCTION public.hub_pf_signed_files_keep();

CREATE OR REPLACE FUNCTION public.hub_pf_links_keep() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'HUB_GUARD: a proforma link is never deleted. Unlinking keeps the record.';
  END IF;
  IF OLD.removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'HUB_GUARD: an unlinked proforma link is history and cannot be changed.';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.proforma_id IS DISTINCT FROM OLD.proforma_id OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
     OR NEW.proforma_number IS DISTINCT FROM OLD.proforma_number OR NEW.invoice_number IS DISTINCT FROM OLD.invoice_number
     OR NEW.other_customer_confirmed IS DISTINCT FROM OLD.other_customer_confirmed
     OR NEW.linked_by IS DISTINCT FROM OLD.linked_by OR NEW.linked_by_name IS DISTINCT FROM OLD.linked_by_name OR NEW.linked_at IS DISTINCT FROM OLD.linked_at THEN
    RAISE EXCEPTION 'HUB_GUARD: who linked what and when cannot be changed. Unlink and link again.';
  END IF;
  IF NEW.removed_at IS NULL THEN
    RAISE EXCEPTION 'HUB_GUARD: the only change allowed on a proforma link is unlinking it.';
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_pf_links_keep ON public.accounting_proforma_invoice_links;
CREATE TRIGGER trg_pf_links_keep BEFORE UPDATE OR DELETE ON public.accounting_proforma_invoice_links
FOR EACH ROW EXECUTE FUNCTION public.hub_pf_links_keep();
DROP TRIGGER IF EXISTS trg_pf_links_keep_all ON public.accounting_proforma_invoice_links;
CREATE TRIGGER trg_pf_links_keep_all BEFORE TRUNCATE ON public.accounting_proforma_invoice_links
FOR EACH STATEMENT EXECUTE FUNCTION public.hub_pf_links_keep();

ALTER TABLE public.accounting_proforma_invoice_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_proforma_signed_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.accounting_proforma_invoice_links FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.accounting_proforma_signed_files FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.accounting_proforma_invoice_links TO service_role;
GRANT SELECT, INSERT ON TABLE public.accounting_proforma_signed_files TO service_role;
REVOKE ALL ON FUNCTION public.hub_pf_signed_files_keep() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hub_pf_links_keep() FROM PUBLIC, anon, authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('proforma-signed', 'proforma-signed', false, 15728640, ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

SELECT
  CASE WHEN to_regclass('public.accounting_proforma_invoice_links') IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS links_table,
  CASE WHEN to_regclass('public.accounting_proforma_signed_files') IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS signed_files_table,
  (SELECT CASE WHEN count(*) = 1 AND bool_and(public IS FALSE) THEN 'OK private' ELSE 'CHECK' END FROM storage.buckets WHERE id = 'proforma-signed') AS signed_store,
  (SELECT CASE WHEN count(*) = 0 THEN 'OK nobody but the Hub server' ELSE 'CHECK ' || count(*) || ' storage rule(s) could reach it' END FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND ((coalesce(qual, '') || coalesce(with_check, '')) ILIKE '%proforma-signed%' OR (coalesce(qual, '') || coalesce(with_check, '')) NOT ILIKE '%bucket_id%')) AS store_access,
  (SELECT count(*) FROM public.accounting_proforma_invoice_links) AS links_so_far,
  (SELECT count(*) FROM public.accounting_proforma_signed_files) AS signed_files_so_far;
