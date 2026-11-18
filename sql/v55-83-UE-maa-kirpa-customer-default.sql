-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-UE · OPTIONAL — make CNF the USUAL basis for the two Maa Kirpa customers (NOT part of the main fix)
-- Codex QA 20:04: this is customer-wide. Every Maa Kirpa invoice that has no setting of its own — including invoices HELD (no company
-- set) or in another company's books — would then be read as CNF in Profitability. Run it ONLY if Max approves that.
-- Step A shows exactly which invoices it would affect (read-only). Step B makes the change, with a protected copy first.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A · PREVIEW (read-only): Maa Kirpa invoices with no setting of their own, which would follow the customer's usual basis
SELECT i.invoice_number, i.invoice_date, c.company_name, i.id AS invoice_id,
       CASE WHEN i.wave_business_id = 'QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk' THEN 'KTC'
            WHEN i.wave_business_id IS NULL OR btrim(i.wave_business_id) = '' THEN 'no company set'
            ELSE 'OTHER company' END AS books,
       (SELECT basis FROM public.pl_customer_terms ct WHERE ct.customer_id = c.id) AS usual_basis_now
FROM public.accounting_invoices i
JOIN public.accounting_customers c ON c.id = i.accounting_customer_id
LEFT JOIN public.pl_invoice_terms t ON t.invoice_id = i.id
WHERE c.id IN ('d7b31bc2-d70a-4f83-bfcb-caa4bf6b4752', 'f5e08702-c1bb-4128-ab91-acf7117d1c3a')
  AND (t.invoice_id IS NULL OR t.basis IS NULL)
ORDER BY books, i.invoice_date;

-- ── B · THE CHANGE (only after Max approves the list above)
CREATE TABLE IF NOT EXISTS public.hub_backup_ue_customer_terms (run_at timestamptz NOT NULL, customer_id uuid NOT NULL, had_row boolean NOT NULL, row_data jsonb);
ALTER TABLE public.hub_backup_ue_customer_terms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hub_backup_ue_customer_terms FROM public, anon, authenticated;
INSERT INTO public.hub_backup_ue_customer_terms (run_at, customer_id, had_row, row_data)
  SELECT now(), c.id, (ct.customer_id IS NOT NULL), to_jsonb(ct)
  FROM (VALUES ('d7b31bc2-d70a-4f83-bfcb-caa4bf6b4752'::uuid), ('f5e08702-c1bb-4128-ab91-acf7117d1c3a'::uuid)) AS c(id)
  LEFT JOIN public.pl_customer_terms ct ON ct.customer_id = c.id;
INSERT INTO public.pl_customer_terms (customer_id, customer_name, basis, updated_by)
  SELECT id, company_name, 'CNF', 'v55.83-UE (Max: Maa Kirpa is CNF, shipping in the price) — customer-wide, approved separately'
  FROM public.accounting_customers WHERE id IN ('d7b31bc2-d70a-4f83-bfcb-caa4bf6b4752', 'f5e08702-c1bb-4128-ab91-acf7117d1c3a')
ON CONFLICT (customer_id) DO UPDATE SET basis = 'CNF', updated_by = EXCLUDED.updated_by, updated_at = now();
SELECT customer_name, basis FROM public.pl_customer_terms WHERE customer_id IN ('d7b31bc2-d70a-4f83-bfcb-caa4bf6b4752', 'f5e08702-c1bb-4128-ab91-acf7117d1c3a');
