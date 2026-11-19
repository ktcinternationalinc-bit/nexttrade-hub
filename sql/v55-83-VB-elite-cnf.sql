CREATE TABLE IF NOT EXISTS public.hub_backup_uz_customer_terms (run_at timestamptz NOT NULL, customer_id uuid NOT NULL, had_row boolean NOT NULL, row_data jsonb);
ALTER TABLE public.hub_backup_uz_customer_terms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hub_backup_uz_customer_terms FROM public, anon, authenticated;

DO $$
DECLARE
  n_listed int; n_ok int; n_dup int; n_already int; n_set int; run timestamptz := clock_timestamp();
BEGIN
  CREATE TEMP TABLE uz_approved ON COMMIT DROP AS SELECT * FROM (VALUES
  ('1430a750-6d34-4609-8ed0-d4e5c5054a3c'::uuid, 'ELITE PAPER'::text)
  ) AS a(id, name);
  SELECT count(*), count(*) - count(DISTINCT id) INTO n_listed, n_dup FROM uz_approved;
  SELECT count(*) INTO n_ok FROM uz_approved a JOIN public.accounting_customers c ON c.id = a.id AND coalesce(c.company_name, c.contact_name, '') = a.name;
  IF n_listed = 0 OR n_dup <> 0 OR n_ok <> n_listed THEN
    RAISE EXCEPTION 'STOPPED: % customer(s) listed, % found with exactly the confirmed name (% listed twice). Nothing was changed.', n_listed, n_ok, n_dup;
  END IF;
  SELECT count(*) INTO n_already FROM uz_approved a JOIN public.pl_customer_terms ct ON ct.customer_id = a.id AND ct.basis = 'CNF';

  INSERT INTO public.hub_backup_uz_customer_terms (run_at, customer_id, had_row, row_data)
    SELECT run, a.id, (ct.customer_id IS NOT NULL), to_jsonb(ct)
    FROM uz_approved a LEFT JOIN public.pl_customer_terms ct ON ct.customer_id = a.id
    WHERE ct.customer_id IS NULL OR ct.basis IS DISTINCT FROM 'CNF';

  INSERT INTO public.pl_customer_terms (customer_id, customer_name, basis, updated_by)
    SELECT a.id, a.name, 'CNF', 'v55.83-VB (Max 19 Nov: Elite goods are CNF except for a small fee; trucking comes out of the price, the fee is transport profit)'
    FROM uz_approved a
    WHERE NOT EXISTS (SELECT 1 FROM public.pl_customer_terms ct WHERE ct.customer_id = a.id AND ct.basis = 'CNF')
  ON CONFLICT (customer_id) DO UPDATE SET basis = 'CNF', updated_by = EXCLUDED.updated_by, updated_at = now();
  GET DIAGNOSTICS n_set = ROW_COUNT;

  RAISE NOTICE 'Done: % customer(s) set to CNF, % were already CNF. Copies of the previous settings saved at %.', n_set, n_already, run;
END $$;

WITH approved(id, name) AS (VALUES
  ('1430a750-6d34-4609-8ed0-d4e5c5054a3c'::uuid, 'ELITE PAPER'::text)
)
SELECT a.name AS customer, ct.basis AS usual_basis, CASE WHEN ct.basis = 'CNF' THEN 'OK' ELSE 'NOT SET — tell Claude' END AS result,
       (SELECT count(*) FROM public.hub_backup_uz_customer_terms b WHERE b.customer_id = a.id) AS copies_saved
FROM approved a LEFT JOIN public.pl_customer_terms ct ON ct.customer_id = a.id
ORDER BY a.name;
