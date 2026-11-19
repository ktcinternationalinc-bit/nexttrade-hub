-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-UZ — KTC EGYPT and MOUSTAFA customers: CNF is their USUAL basis (Max, Nov 19 2026)
-- "please make all ktc egypt and moustafa orders to be cnf and thus shipping to be removed from prices (unless there is a
--  shipping line item in the invoice)"
-- TEMPLATE: scripts/uz-make-cnf-sql.js writes the real file from the customer ids Max confirmed. Do NOT run this template.
--
-- What it does: sets pl_customer_terms.basis = 'CNF' for EXACTLY the customers listed (id + the name Max saw). Nothing else.
-- The Profitability report then reads every invoice of those customers that has no setting of its own as CNF with the shipping
-- inside the price: the invoice's share of its container's shipping cost comes out of the goods price. An invoice with a real
-- freight / shipping / trucking / delivery line is read as "shipping on its own line" (price = goods only). A line with the word
-- "surcharge" is extra shipping income and the invoice stays CNF (the rule live since v55.83-UE, Maa Kirpa).
-- NOT changed: any invoice, any invoice's own setting (pl_invoice_terms), any other customer. Nothing is deleted.
-- It refuses to run unless every listed customer is found with exactly the confirmed name. A protected copy of what was there
-- before is saved first (hub_backup_uz_customer_terms). Safe to run more than once.
-- Customer-wide (same as Maa Kirpa, Codex 18 Nov 20:04): it also applies to invoices with no company set — step 1 lists them.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── STEP 1 · PREVIEW (read-only — changes nothing). One cell of JSON: copy it to Claude. ─────────────────────────────
WITH approved(id, name) AS (VALUES
/*APPROVED*/
), lines AS (
  SELECT it.invoice_id, coalesce(nullif(btrim(it.wave_product_name), ''), it.description, '') AS nm, coalesce(it.quantity, 0) * coalesce(it.unit_price, 0) AS amt
  FROM public.accounting_invoice_items it
  JOIN public.accounting_invoices i2 ON i2.id = it.invoice_id AND i2.accounting_customer_id IN (SELECT id FROM approved)
), freight AS (   -- the SAME "real freight line" test as the Profitability engine (a surcharge / overweight-only line is NOT freight)
  SELECT DISTINCT l.invoice_id FROM lines l
  LEFT JOIN public.pl_name_kinds k ON k.name_key = btrim(regexp_replace(lower(l.nm), '[^a-z0-9&]+', ' ', 'g'))
  WHERE l.amt > 0 AND (k.kind = 'transport' OR (coalesce(k.kind, '') <> 'goods' AND l.nm ~* '(ship|freight|forward|truck|deliver|courier|cartage|drayage|overweight|over-weight|surcharge|demurrage|detention|chassis|شحن|توصيل)' AND NOT (l.nm ~* 'surcharge' OR (l.nm ~* 'over[ -]?weight' AND l.nm !~* '(ship|freight|forward|truck|deliver|courier|cartage|drayage|شحن|توصيل)'))))
), inv AS (
  SELECT i.id AS invoice_id, i.invoice_number, i.invoice_date, i.release_number, a.id AS customer_id, a.name AS customer,
         CASE WHEN i.wave_business_id = 'QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk' THEN 'KTC'
              WHEN i.wave_business_id IS NULL OR btrim(i.wave_business_id) = '' THEN 'no company set'
              ELSE 'OTHER company' END AS books,
         t.basis AS own_basis, t.shipping_terms AS own_terms,
         CASE WHEN t.shipping_terms IS NOT NULL OR t.basis IS NOT NULL THEN 'keeps its own setting (' || coalesce(t.shipping_terms, t.basis) || ')'
              WHEN f.invoice_id IS NOT NULL THEN 'CNF, shipping on its own line (has a real shipping line) — price is goods only'
              WHEN i.release_number IS NULL OR btrim(i.release_number) = '' THEN 'CNF, shipping in the price — but NO release number, so no shipping cost can be taken out yet'
              ELSE 'CNF, shipping in the price — its share of the container''s shipping cost comes out of the goods price' END AS after_the_change
  FROM public.accounting_invoices i
  JOIN approved a ON a.id = i.accounting_customer_id
  LEFT JOIN public.pl_invoice_terms t ON t.invoice_id = i.id
  LEFT JOIN freight f ON f.invoice_id = i.id
  WHERE coalesce(i.record_status, '') NOT IN ('void', 'cancelled', 'archived', 'deleted')
)
SELECT jsonb_build_object(
  'customers', (SELECT jsonb_agg(jsonb_build_object('id', a.id, 'confirmed_name', a.name, 'name_now', coalesce(c.company_name, c.contact_name), 'found_with_that_name', (c.id IS NOT NULL AND coalesce(c.company_name, c.contact_name, '') = a.name),
                  'usual_basis_now', (SELECT basis FROM public.pl_customer_terms ct WHERE ct.customer_id = a.id)))
                FROM approved a LEFT JOIN public.accounting_customers c ON c.id = a.id),
  'counts', (SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT customer, books, after_the_change, count(*) AS invoices, min(invoice_date) AS first_invoice, max(invoice_date) AS last_invoice FROM inv GROUP BY customer, books, after_the_change ORDER BY customer, books, after_the_change) x),
  'invoices', (SELECT jsonb_agg(to_jsonb(inv) ORDER BY inv.customer, inv.invoice_date) FROM inv)
) AS copy_this_cell_to_claude;

-- ── STEP 2 · THE CHANGE (run only after Max has seen step 1) ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hub_backup_uz_customer_terms (run_at timestamptz NOT NULL, customer_id uuid NOT NULL, had_row boolean NOT NULL, row_data jsonb);
ALTER TABLE public.hub_backup_uz_customer_terms ENABLE ROW LEVEL SECURITY;   -- no policies: the Supabase SQL editor / server only
REVOKE ALL ON public.hub_backup_uz_customer_terms FROM public, anon, authenticated;

DO $$
DECLARE
  n_listed int; n_ok int; n_dup int; n_already int; n_set int; run timestamptz := clock_timestamp();
BEGIN
  CREATE TEMP TABLE uz_approved ON COMMIT DROP AS SELECT * FROM (VALUES
/*APPROVED*/
  ) AS a(id, name);
  SELECT count(*), count(*) - count(DISTINCT id) INTO n_listed, n_dup FROM uz_approved;
  SELECT count(*) INTO n_ok FROM uz_approved a JOIN public.accounting_customers c ON c.id = a.id AND coalesce(c.company_name, c.contact_name, '') = a.name;
  IF n_listed = 0 OR n_dup <> 0 OR n_ok <> n_listed THEN
    RAISE EXCEPTION 'STOPPED: % customer(s) listed, % found with exactly the confirmed name (% listed twice). Nothing was changed.', n_listed, n_ok, n_dup;
  END IF;
  SELECT count(*) INTO n_already FROM uz_approved a JOIN public.pl_customer_terms ct ON ct.customer_id = a.id AND ct.basis = 'CNF';

  -- copy first — only the customers this run really changes (a rerun that changes nothing saves nothing)
  INSERT INTO public.hub_backup_uz_customer_terms (run_at, customer_id, had_row, row_data)
    SELECT run, a.id, (ct.customer_id IS NOT NULL), to_jsonb(ct)
    FROM uz_approved a LEFT JOIN public.pl_customer_terms ct ON ct.customer_id = a.id
    WHERE ct.customer_id IS NULL OR ct.basis IS DISTINCT FROM 'CNF';

  INSERT INTO public.pl_customer_terms (customer_id, customer_name, basis, updated_by)
    SELECT a.id, a.name, 'CNF', 'v55.83-UZ (Max 19 Nov: KTC Egypt / Moustafa are CNF, shipping in the price unless a shipping line)'
    FROM uz_approved a
    WHERE NOT EXISTS (SELECT 1 FROM public.pl_customer_terms ct WHERE ct.customer_id = a.id AND ct.basis = 'CNF')
  ON CONFLICT (customer_id) DO UPDATE SET basis = 'CNF', updated_by = EXCLUDED.updated_by, updated_at = now();
  GET DIAGNOSTICS n_set = ROW_COUNT;

  RAISE NOTICE 'Done: % customer(s) set to CNF, % were already CNF. Copies of the previous settings saved at %.', n_set, n_already, run;
END $$;

-- ── STEP 3 · CHECK (read-only): every listed customer must show CNF ────────────────────────────────────────────────
WITH approved(id, name) AS (VALUES
/*APPROVED*/
)
SELECT a.name AS customer, ct.basis AS usual_basis, CASE WHEN ct.basis = 'CNF' THEN 'OK' ELSE 'NOT SET — tell Claude' END AS result,
       (SELECT count(*) FROM public.hub_backup_uz_customer_terms b WHERE b.customer_id = a.id) AS copies_saved
FROM approved a LEFT JOIN public.pl_customer_terms ct ON ct.customer_id = a.id
ORDER BY a.name;
