-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-UZ — ELITE PAPER pays its own freight: freight = $0 on Elite's shipments (Max, Nov 19 2026)
-- "Elite is supposed to pay its own." · "remove freight from elite keep trucking and any surcharge"
--
-- What it does: for EXACTLY the 25 Elite release numbers listed below (the 25 newest Elite invoices Max's read-only check
-- returned on 19 Nov), it saves "freight = 0" in pl_release_part_estimates — the figure typed per release, which the
-- Profitability report uses before any Nextrade warehouse estimate. Nothing else.
-- NOT changed: trucking figures, invoices, invoice lines (the surcharge / trucking lines stay as shipping charged), bills,
-- warehouse rows, any other customer's release. Nothing is deleted. A real shipping BILL for one of these releases would
-- still replace the 0 (a bill always wins).
-- It refuses to run unless the customer is found with exactly the confirmed name AND every listed release has at least one
-- live ELITE PAPER invoice and no live invoice of any other customer. A protected copy of every figure it replaces is
-- saved first (hub_backup_uz_part_estimates). Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── STEP 1 · PREVIEW (read-only — changes nothing). One cell of JSON: copy it to Claude. ─────────────────────────────
WITH elite(id, name) AS (VALUES ('1430a750-6d34-4609-8ed0-d4e5c5054a3c'::uuid, 'ELITE PAPER'::text)),
listed(k) AS (VALUES ('10011541'), ('10011627'), ('10021036'), ('10021059'), ('10021125'), ('10021129'), ('10021130'), ('10021133'), ('10021138'), ('10021144'), ('10021146'), ('10021152'), ('10021154'),
  ('10021168'), ('10021178'), ('10021183'), ('10021184'), ('10021188'), ('10021195'), ('10021202'), ('10021203'), ('10021204'), ('10021207'), ('10021211'), ('10021212')),
inv_rel AS (
  SELECT i.id, i.invoice_number, i.accounting_customer_id, upper(regexp_replace(p.x, '[^A-Za-z0-9]', '', 'g')) AS k
  FROM public.accounting_invoices i
  CROSS JOIN LATERAL regexp_split_to_table(coalesce(i.release_number, ''), '\s*(?:[,;&/+]|\mand\M)\s*', 'i') AS p(x)
  WHERE coalesce(i.record_status, '') NOT IN ('void', 'cancelled', 'archived', 'deleted') AND regexp_replace(p.x, '[^A-Za-z0-9]', '', 'g') <> ''
), bill_rel AS (
  SELECT b.bill_number, b.vendor_name, b.total_amount, upper(regexp_replace(p.x, '[^A-Za-z0-9]', '', 'g')) AS k
  FROM public.vendor_bills b
  CROSS JOIN LATERAL regexp_split_to_table(coalesce(b.release_number, ''), '\s*(?:[,;&/+]|\mand\M)\s*', 'i') AS p(x)
  WHERE b.record_status = 'active' AND b.bill_type = 'shipping'
)
SELECT jsonb_build_object(
  'customer', (SELECT jsonb_build_object('id', e.id, 'confirmed_name', e.name, 'name_now', c.company_name, 'found_with_that_name', (c.id IS NOT NULL AND coalesce(c.company_name, c.contact_name, '') = e.name)) FROM elite e LEFT JOIN public.accounting_customers c ON c.id = e.id),
  'releases', (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.release_key) FROM (
      SELECT l.k AS release_key,
             (SELECT jsonb_agg(r.invoice_number) FROM inv_rel r WHERE r.k = l.k AND r.accounting_customer_id IN (SELECT id FROM elite)) AS elite_invoices,
             (SELECT jsonb_agg(r.invoice_number) FROM inv_rel r WHERE r.k = l.k AND r.accounting_customer_id IS DISTINCT FROM (SELECT id FROM elite)) AS invoices_of_other_customers,
             (SELECT amount FROM public.pl_release_part_estimates e WHERE e.release_key = l.k AND e.part = 'freight') AS freight_typed_now,
             (SELECT note FROM public.pl_release_part_estimates e WHERE e.release_key = l.k AND e.part = 'freight') AS freight_note_now,
             (SELECT amount FROM public.pl_release_part_estimates e WHERE e.release_key = l.k AND e.part = 'trucking') AS trucking_typed_kept,
             (SELECT jsonb_agg(jsonb_build_object('bill', b.bill_number, 'vendor', b.vendor_name, 'amount', b.total_amount)) FROM bill_rel b WHERE b.k = l.k) AS hub_shipping_bills_that_would_still_win,
             CASE WHEN EXISTS (SELECT 1 FROM public.pl_release_part_estimates e WHERE e.release_key = l.k AND e.part = 'freight' AND e.amount = 0) THEN 'already 0' ELSE 'freight becomes 0' END AS step2_does
      FROM listed l) x),
  'other_elite_releases_not_in_this_list', (SELECT jsonb_agg(DISTINCT r.k) FROM inv_rel r WHERE r.accounting_customer_id IN (SELECT id FROM elite) AND r.k NOT IN (SELECT k FROM listed))
) AS copy_this_cell_to_claude;

-- ── STEP 2 · THE CHANGE (run only after Max has seen step 1) ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hub_backup_uz_part_estimates (run_at timestamptz NOT NULL, release_key text NOT NULL, part text NOT NULL, had_row boolean NOT NULL, row_data jsonb);
ALTER TABLE public.hub_backup_uz_part_estimates ENABLE ROW LEVEL SECURITY;   -- no policies: the Supabase SQL editor / server only
REVOKE ALL ON public.hub_backup_uz_part_estimates FROM public, anon, authenticated;

DO $$
DECLARE
  elite_id uuid := '1430a750-6d34-4609-8ed0-d4e5c5054a3c'; n_cust int; bad text; n_set int; n_already int; run timestamptz := clock_timestamp();
BEGIN
  SELECT count(*) INTO n_cust FROM public.accounting_customers c WHERE c.id = elite_id AND coalesce(c.company_name, c.contact_name, '') = 'ELITE PAPER';
  IF n_cust <> 1 THEN RAISE EXCEPTION 'STOPPED: customer ELITE PAPER was not found with exactly that name. Nothing was changed.'; END IF;

  CREATE TEMP TABLE uz_listed ON COMMIT DROP AS SELECT * FROM (VALUES ('10011541'), ('10011627'), ('10021036'), ('10021059'), ('10021125'), ('10021129'), ('10021130'), ('10021133'), ('10021138'), ('10021144'), ('10021146'), ('10021152'), ('10021154'),
    ('10021168'), ('10021178'), ('10021183'), ('10021184'), ('10021188'), ('10021195'), ('10021202'), ('10021203'), ('10021204'), ('10021207'), ('10021211'), ('10021212')) AS l(k);
  CREATE TEMP TABLE uz_inv_rel ON COMMIT DROP AS
    SELECT i.accounting_customer_id AS cust, upper(regexp_replace(p.x, '[^A-Za-z0-9]', '', 'g')) AS k
    FROM public.accounting_invoices i
    CROSS JOIN LATERAL regexp_split_to_table(coalesce(i.release_number, ''), '\s*(?:[,;&/+]|\mand\M)\s*', 'i') AS p(x)
    WHERE coalesce(i.record_status, '') NOT IN ('void', 'cancelled', 'archived', 'deleted');

  -- every listed release must be Elite's and only Elite's
  SELECT string_agg(l.k, ', ' ORDER BY l.k) INTO bad FROM uz_listed l
  WHERE NOT EXISTS (SELECT 1 FROM uz_inv_rel r WHERE r.k = l.k AND r.cust = elite_id)
     OR EXISTS (SELECT 1 FROM uz_inv_rel r WHERE r.k = l.k AND r.cust IS DISTINCT FROM elite_id);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'STOPPED: these releases are not only ELITE PAPER''s any more: %. Nothing was changed.', bad; END IF;

  SELECT count(*) INTO n_already FROM uz_listed l JOIN public.pl_release_part_estimates e ON e.release_key = l.k AND e.part = 'freight' AND e.amount = 0;

  -- copy first — only what this run really changes
  INSERT INTO public.hub_backup_uz_part_estimates (run_at, release_key, part, had_row, row_data)
    SELECT run, l.k, 'freight', (e.release_key IS NOT NULL), to_jsonb(e)
    FROM uz_listed l LEFT JOIN public.pl_release_part_estimates e ON e.release_key = l.k AND e.part = 'freight'
    WHERE e.release_key IS NULL OR e.amount IS DISTINCT FROM 0;

  INSERT INTO public.pl_release_part_estimates (release_key, part, amount, note, updated_by)
    SELECT l.k, 'freight', 0, 'Elite pays its own freight (Max 19 Nov 2026) — set to 0 by v55.83-UZ', 'v55.83-UZ'
    FROM uz_listed l
    WHERE NOT EXISTS (SELECT 1 FROM public.pl_release_part_estimates e WHERE e.release_key = l.k AND e.part = 'freight' AND e.amount = 0)
  ON CONFLICT (release_key, part) DO UPDATE SET amount = 0, note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = now();
  GET DIAGNOSTICS n_set = ROW_COUNT;

  RAISE NOTICE 'Done: freight set to 0 on % Elite release(s); % were already 0. Trucking not touched. Copies of the previous figures saved at %.', n_set, n_already, run;
END $$;

-- ── STEP 3 · CHECK (read-only): 25 rows, every one must say OK ─────────────────────────────────────────────────────
SELECT e.release_key, e.amount AS freight, CASE WHEN e.amount = 0 THEN 'OK' ELSE 'NOT 0 — tell Claude' END AS result,
       (SELECT t.amount FROM public.pl_release_part_estimates t WHERE t.release_key = e.release_key AND t.part = 'trucking') AS trucking_kept
FROM public.pl_release_part_estimates e
WHERE e.part = 'freight' AND e.release_key IN ('10011541', '10011627', '10021036', '10021059', '10021125', '10021129', '10021130', '10021133', '10021138', '10021144', '10021146', '10021152', '10021154',
  '10021168', '10021178', '10021183', '10021184', '10021188', '10021195', '10021202', '10021203', '10021204', '10021207', '10021211', '10021212')
ORDER BY e.release_key;
