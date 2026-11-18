-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-UE — MAA KIRPA: CNF with the shipping INSIDE the price (Max, Nov 18 2026)
-- "for the maa kirpa orders this is a CNF where the shipping is included in the price. but we have a surcharge which should just be
--  an additional income to the transport. so please fix all the orders"
-- Codex QA 18 Nov 12:20 + Max 18 Nov: EXACTLY the two Maa Kirpa customer ids (refuses unless both are found), backs up BOTH the customer default and the
-- invoice terms (and which invoices had no terms row), protected backups kept across reruns, and the SAME "is this a real
-- freight line" test as the Profitability engine: the line's Wave product name or description, freight / trucking / shipping /
-- delivery / demurrage / chassis words in English or Arabic (a surcharge or overweight line alone is NOT freight), or a name
-- marked "transport" by a person (a name marked "goods" never counts).
-- Nothing is deleted. Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── STEP 1 · PREVIEW (read-only — changes nothing) ───────────────────────────
-- the customers this touches — EXACTLY these two (Max, Nov 18, both are Maa Kirpa): M/S MAA KIRPA (7 invoices, 2021) and MAA KIRPA (183, 2021–2026)
SELECT id, company_name FROM public.accounting_customers WHERE id IN ('d7b31bc2-d70a-4f83-bfcb-caa4bf6b4752', 'f5e08702-c1bb-4128-ab91-acf7117d1c3a');
-- every Maa Kirpa invoice: what it is set to now and what step 2 would do
WITH lines AS (
  SELECT it.invoice_id, coalesce(nullif(btrim(it.wave_product_name), ''), it.description, '') AS nm, coalesce(it.quantity, 0) * coalesce(it.unit_price, 0) AS amt
  FROM public.accounting_invoice_items it
), freight AS (
  SELECT DISTINCT l.invoice_id FROM lines l
  LEFT JOIN public.pl_name_kinds k ON k.name_key = btrim(regexp_replace(lower(l.nm), '[^a-z0-9&]+', ' ', 'g'))
  WHERE l.amt > 0 AND (k.kind = 'transport' OR (coalesce(k.kind, '') <> 'goods' AND l.nm ~* '(ship|freight|forward|truck|deliver|courier|cartage|drayage|overweight|over-weight|surcharge|demurrage|detention|chassis|شحن|توصيل)' AND NOT (l.nm ~* '(surcharge|over[ -]?weight)' AND l.nm !~* '(ship|freight|forward|truck|deliver|courier|cartage|drayage|شحن|توصيل)')))
)
SELECT i.invoice_number, i.invoice_date, c.company_name, t.shipping_terms AS now_terms,
       CASE WHEN f.invoice_id IS NOT NULL THEN 'left as is (has a real freight line)'
            WHEN t.shipping_terms = 'CNF_INCLUDED' THEN 'already CNF included'
            ELSE 'will become CNF included' END AS step2_does,
       t.embedded_transport AS shipping_typed_by_hand_kept
FROM public.accounting_invoices i
JOIN public.accounting_customers c ON c.id = i.accounting_customer_id
LEFT JOIN public.pl_invoice_terms t ON t.invoice_id = i.id
LEFT JOIN freight f ON f.invoice_id = i.id
WHERE c.id IN ('d7b31bc2-d70a-4f83-bfcb-caa4bf6b4752', 'f5e08702-c1bb-4128-ab91-acf7117d1c3a')
ORDER BY i.invoice_date;

-- ── STEP 2 · THE CHANGE (run only after checking step 1) ──────────────────────
CREATE TABLE IF NOT EXISTS public.hub_backup_ue_invoice_terms (run_at timestamptz NOT NULL, invoice_id uuid NOT NULL, had_row boolean NOT NULL, row_data jsonb);
CREATE TABLE IF NOT EXISTS public.hub_backup_ue_customer_terms (run_at timestamptz NOT NULL, customer_id uuid NOT NULL, had_row boolean NOT NULL, row_data jsonb);
ALTER TABLE public.hub_backup_ue_invoice_terms ENABLE ROW LEVEL SECURITY;   -- no policies: the Supabase SQL editor / server only
ALTER TABLE public.hub_backup_ue_customer_terms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hub_backup_ue_invoice_terms FROM public, anon, authenticated;
REVOKE ALL ON public.hub_backup_ue_customer_terms FROM public, anon, authenticated;

DO $$
DECLARE
  n_cust int; custs uuid[]; run timestamptz := now(); n_change int;
BEGIN
  SELECT count(*) INTO n_cust FROM public.accounting_customers WHERE id IN ('d7b31bc2-d70a-4f83-bfcb-caa4bf6b4752', 'f5e08702-c1bb-4128-ab91-acf7117d1c3a');
  IF n_cust <> 2 THEN
    RAISE EXCEPTION 'STOPPED: found % of the 2 Maa Kirpa customers — expected both. Nothing was changed.', n_cust;
  END IF;
  SELECT array_agg(id) INTO custs FROM public.accounting_customers WHERE id IN ('d7b31bc2-d70a-4f83-bfcb-caa4bf6b4752', 'f5e08702-c1bb-4128-ab91-acf7117d1c3a');

  -- the invoices to change: this customer only, no real freight line, not already CNF included
  CREATE TEMP TABLE ue_targets ON COMMIT DROP AS
  WITH lines AS (
    SELECT it.invoice_id, coalesce(nullif(btrim(it.wave_product_name), ''), it.description, '') AS nm, coalesce(it.quantity, 0) * coalesce(it.unit_price, 0) AS amt
    FROM public.accounting_invoice_items it
    JOIN public.accounting_invoices i2 ON i2.id = it.invoice_id AND i2.accounting_customer_id = ANY (custs)
  ), freight AS (
    SELECT DISTINCT l.invoice_id FROM lines l
    LEFT JOIN public.pl_name_kinds k ON k.name_key = btrim(regexp_replace(lower(l.nm), '[^a-z0-9&]+', ' ', 'g'))
    WHERE l.amt > 0 AND (k.kind = 'transport' OR (coalesce(k.kind, '') <> 'goods' AND l.nm ~* '(ship|freight|forward|truck|deliver|courier|cartage|drayage|overweight|over-weight|surcharge|demurrage|detention|chassis|شحن|توصيل)' AND NOT (l.nm ~* '(surcharge|over[ -]?weight)' AND l.nm !~* '(ship|freight|forward|truck|deliver|courier|cartage|drayage|شحن|توصيل)')))
  )
  SELECT i.id AS invoice_id, (t.invoice_id IS NOT NULL) AS had_row, to_jsonb(t) AS row_data
  FROM public.accounting_invoices i
  LEFT JOIN public.pl_invoice_terms t ON t.invoice_id = i.id
  WHERE i.accounting_customer_id = ANY (custs)
    AND i.id NOT IN (SELECT invoice_id FROM freight)
    AND t.shipping_terms IS DISTINCT FROM 'CNF_INCLUDED';
  SELECT count(*) INTO n_change FROM ue_targets;

  -- copies first (every run keeps its own copy, marked with its time)
  INSERT INTO public.hub_backup_ue_invoice_terms (run_at, invoice_id, had_row, row_data) SELECT run, invoice_id, had_row, row_data FROM ue_targets;
  INSERT INTO public.hub_backup_ue_customer_terms (run_at, customer_id, had_row, row_data)
    SELECT run, c.id, (ct.customer_id IS NOT NULL), to_jsonb(ct) FROM unnest(custs) AS c(id) LEFT JOIN public.pl_customer_terms ct ON ct.customer_id = c.id;

  -- Maa Kirpa's usual basis = CNF
  INSERT INTO public.pl_customer_terms (customer_id, customer_name, basis, updated_by)
    SELECT id, company_name, 'CNF', 'v55.83-UE (Max: Maa Kirpa is CNF, shipping in the price)' FROM public.accounting_customers WHERE id = ANY (custs)
  ON CONFLICT (customer_id) DO UPDATE SET basis = 'CNF', updated_by = EXCLUDED.updated_by, updated_at = now();

  -- its invoices → CNF, shipping included (embedded_transport typed by hand is not touched)
  INSERT INTO public.pl_invoice_terms (invoice_id, basis, shipping_terms, updated_by)
    SELECT invoice_id, 'CNF', 'CNF_INCLUDED', 'v55.83-UE (Max: Maa Kirpa CNF, shipping in the price; surcharge = transport income)' FROM ue_targets
  ON CONFLICT (invoice_id) DO UPDATE SET basis = 'CNF', shipping_terms = 'CNF_INCLUDED', updated_by = EXCLUDED.updated_by, updated_at = now();

  RAISE NOTICE 'Done: both Maa Kirpa customers — % invoice(s) set to CNF included. Copies saved at %.', n_change, run;
END $$;

-- check after step 2
SELECT i.invoice_number, i.invoice_date, t.shipping_terms, t.basis, t.embedded_transport
FROM public.accounting_invoices i
JOIN public.accounting_customers c ON c.id = i.accounting_customer_id
LEFT JOIN public.pl_invoice_terms t ON t.invoice_id = i.id
WHERE c.id IN ('d7b31bc2-d70a-4f83-bfcb-caa4bf6b4752', 'f5e08702-c1bb-4128-ab91-acf7117d1c3a')
ORDER BY i.invoice_date;
