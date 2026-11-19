CREATE TABLE IF NOT EXISTS public.hub_backup_uz_part_estimates (run_at timestamptz NOT NULL, release_key text NOT NULL, part text NOT NULL, had_row boolean NOT NULL, row_data jsonb);
ALTER TABLE public.hub_backup_uz_part_estimates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hub_backup_uz_part_estimates FROM public, anon, authenticated;
CREATE TABLE IF NOT EXISTS public.hub_backup_uz_customer_terms (run_at timestamptz NOT NULL, customer_id uuid NOT NULL, had_row boolean NOT NULL, row_data jsonb);
ALTER TABLE public.hub_backup_uz_customer_terms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hub_backup_uz_customer_terms FROM public, anon, authenticated;

DO $$
DECLARE
  elite_id uuid := '1430a750-6d34-4609-8ed0-d4e5c5054a3c'; n_cust int; bad text;
  n_listed int; n_ok int; n_dup int;
  n_set_a int; n_already_a int; n_set_b int; n_already_b int; run timestamptz := clock_timestamp();
BEGIN
  CREATE TEMP TABLE uz_listed ON COMMIT DROP AS SELECT * FROM (VALUES ('10011541'), ('10011627'), ('10021036'), ('10021059'), ('10021125'), ('10021129'), ('10021130'), ('10021133'), ('10021138'), ('10021144'), ('10021146'), ('10021152'), ('10021154'),
    ('10021168'), ('10021178'), ('10021183'), ('10021184'), ('10021188'), ('10021195'), ('10021202'), ('10021203'), ('10021204'), ('10021207'), ('10021211'), ('10021212')) AS l(k);
  CREATE TEMP TABLE uz_approved ON COMMIT DROP AS SELECT * FROM (VALUES
    ('2f2b2700-916b-4280-8751-dfe3f82322a8'::uuid, 'KTC EGYPT FOR IMPORT AND EXPORT'::text),
    ('da70bd80-41cc-4c44-accd-6bd6e0db4496'::uuid, 'AL MOUSTAFA CO. FOR IMPORT & EXPORT'::text),
    ('7b0b27b5-a69d-4027-8bd9-5d31e93fa7f9'::uuid, 'Moustafa Tosha'::text),
    ('27132608-be06-4ca3-9e27-9fb0d7549a1a'::uuid, 'SAAD EGYPT'::text),
    ('52ca5339-a6a8-493e-b5d7-1d7ce88630cf'::uuid, 'Saad Moustafa'::text),
    ('f6d0a5f6-0a7f-4907-b3fc-5e9b5857e91f'::uuid, 'Saeed Moustafa'::text)
  ) AS a(id, name);
  CREATE TEMP TABLE uz_inv_rel ON COMMIT DROP AS
    SELECT i.accounting_customer_id AS cust, upper(regexp_replace(p.x, '[^A-Za-z0-9]', '', 'g')) AS k
    FROM public.accounting_invoices i
    CROSS JOIN LATERAL regexp_split_to_table(coalesce(i.release_number, ''), '\s*(?:[,;&/+]|\mand\M)\s*', 'i') AS p(x)
    WHERE coalesce(i.record_status, '') NOT IN ('void', 'cancelled', 'archived', 'deleted');

  SELECT count(*) INTO n_cust FROM public.accounting_customers c WHERE c.id = elite_id AND coalesce(c.company_name, c.contact_name, '') = 'ELITE PAPER';
  IF n_cust <> 1 THEN RAISE EXCEPTION 'STOPPED: customer ELITE PAPER was not found with exactly that name. Nothing was changed.'; END IF;
  SELECT string_agg(l.k, ', ' ORDER BY l.k) INTO bad FROM uz_listed l
  WHERE NOT EXISTS (SELECT 1 FROM uz_inv_rel r WHERE r.k = l.k AND r.cust = elite_id)
     OR EXISTS (SELECT 1 FROM uz_inv_rel r WHERE r.k = l.k AND r.cust IS DISTINCT FROM elite_id);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'STOPPED: these releases are not only ELITE PAPER''s any more: %. Nothing was changed.', bad; END IF;
  SELECT count(*), count(*) - count(DISTINCT id) INTO n_listed, n_dup FROM uz_approved;
  SELECT count(*) INTO n_ok FROM uz_approved a JOIN public.accounting_customers c ON c.id = a.id AND coalesce(c.company_name, c.contact_name, '') = a.name;
  IF n_listed <> 6 OR n_dup <> 0 OR n_ok <> n_listed THEN
    RAISE EXCEPTION 'STOPPED: % customer(s) listed, % found with exactly the confirmed name (% listed twice). Nothing was changed.', n_listed, n_ok, n_dup;
  END IF;

  SELECT count(*) INTO n_already_a FROM uz_listed l JOIN public.pl_release_part_estimates e ON e.release_key = l.k AND e.part = 'freight' AND e.amount = 0;
  INSERT INTO public.hub_backup_uz_part_estimates (run_at, release_key, part, had_row, row_data)
    SELECT run, l.k, 'freight', (e.release_key IS NOT NULL), to_jsonb(e)
    FROM uz_listed l LEFT JOIN public.pl_release_part_estimates e ON e.release_key = l.k AND e.part = 'freight'
    WHERE e.release_key IS NULL OR e.amount IS DISTINCT FROM 0;
  INSERT INTO public.pl_release_part_estimates (release_key, part, amount, note, updated_by)
    SELECT l.k, 'freight', 0, 'Elite pays its own freight (Max 19 Nov 2026) — set to 0 by v55.83-UZ', 'v55.83-UZ'
    FROM uz_listed l
    WHERE NOT EXISTS (SELECT 1 FROM public.pl_release_part_estimates e WHERE e.release_key = l.k AND e.part = 'freight' AND e.amount = 0)
  ON CONFLICT (release_key, part) DO UPDATE SET amount = 0, note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = now();
  GET DIAGNOSTICS n_set_a = ROW_COUNT;

  SELECT count(*) INTO n_already_b FROM uz_approved a JOIN public.pl_customer_terms ct ON ct.customer_id = a.id AND ct.basis = 'CNF';
  INSERT INTO public.hub_backup_uz_customer_terms (run_at, customer_id, had_row, row_data)
    SELECT run, a.id, (ct.customer_id IS NOT NULL), to_jsonb(ct)
    FROM uz_approved a LEFT JOIN public.pl_customer_terms ct ON ct.customer_id = a.id
    WHERE ct.customer_id IS NULL OR ct.basis IS DISTINCT FROM 'CNF';
  INSERT INTO public.pl_customer_terms (customer_id, customer_name, basis, updated_by)
    SELECT a.id, a.name, 'CNF', 'v55.83-UZ (Max 19 Nov: KTC Egypt / Moustafa are CNF, shipping in the price unless a shipping line)'
    FROM uz_approved a
    WHERE NOT EXISTS (SELECT 1 FROM public.pl_customer_terms ct WHERE ct.customer_id = a.id AND ct.basis = 'CNF')
  ON CONFLICT (customer_id) DO UPDATE SET basis = 'CNF', updated_by = EXCLUDED.updated_by, updated_at = now();
  GET DIAGNOSTICS n_set_b = ROW_COUNT;

  RAISE NOTICE 'Done. A: freight set to 0 on % Elite release(s), % already 0. B: % customer(s) set to CNF, % already CNF. Copies saved at %.', n_set_a, n_already_a, n_set_b, n_already_b, run;
END $$;

WITH listed(k) AS (VALUES ('10011541'), ('10011627'), ('10021036'), ('10021059'), ('10021125'), ('10021129'), ('10021130'), ('10021133'), ('10021138'), ('10021144'), ('10021146'), ('10021152'), ('10021154'),
    ('10021168'), ('10021178'), ('10021183'), ('10021184'), ('10021188'), ('10021195'), ('10021202'), ('10021203'), ('10021204'), ('10021207'), ('10021211'), ('10021212')),
approved(id, name) AS (VALUES
    ('2f2b2700-916b-4280-8751-dfe3f82322a8'::uuid, 'KTC EGYPT FOR IMPORT AND EXPORT'::text),
    ('da70bd80-41cc-4c44-accd-6bd6e0db4496'::uuid, 'AL MOUSTAFA CO. FOR IMPORT & EXPORT'::text),
    ('7b0b27b5-a69d-4027-8bd9-5d31e93fa7f9'::uuid, 'Moustafa Tosha'::text),
    ('27132608-be06-4ca3-9e27-9fb0d7549a1a'::uuid, 'SAAD EGYPT'::text),
    ('52ca5339-a6a8-493e-b5d7-1d7ce88630cf'::uuid, 'Saad Moustafa'::text),
    ('f6d0a5f6-0a7f-4907-b3fc-5e9b5857e91f'::uuid, 'Saeed Moustafa'::text)),
a AS (SELECT l.k, (SELECT e.amount FROM public.pl_release_part_estimates e WHERE e.release_key = l.k AND e.part = 'freight') AS amt FROM listed l),
b AS (SELECT p.name, (SELECT ct.basis FROM public.pl_customer_terms ct WHERE ct.customer_id = p.id) AS basis FROM approved p)
SELECT 'A. Elite: freight 0 on its 25 releases' AS item,
       (SELECT count(*) FROM a WHERE amt = 0) || ' of 25' AS done,
       CASE WHEN (SELECT count(*) FROM a WHERE amt = 0) = 25 THEN 'OK' ELSE 'NOT DONE — tell Claude' END AS result,
       coalesce((SELECT string_agg(k, ', ' ORDER BY k) FROM a WHERE amt IS DISTINCT FROM 0), '') AS not_done_yet
UNION ALL
SELECT 'B. KTC Egypt / Moustafa: 6 customers CNF',
       (SELECT count(*) FROM b WHERE basis = 'CNF') || ' of 6',
       CASE WHEN (SELECT count(*) FROM b WHERE basis = 'CNF') = 6 THEN 'OK' ELSE 'NOT DONE — tell Claude' END,
       coalesce((SELECT string_agg(name, ', ' ORDER BY name) FROM b WHERE basis IS DISTINCT FROM 'CNF'), '');
