-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-VA · READ-ONLY (changes nothing) — Max's five questions of 19 Nov 2026, ONE result to copy back
--   Elite shipping charges · 1002-1164 (Fadi) · AMERICA 1771 (KTC Egypt) · 1002-1160 ($723) · KTC Egypt / Moustafa customers · foam lines
-- It only SELECTs. The answer is ONE cell of JSON: click it, copy, paste it to Claude.
-- ═══════════════════════════════════════════════════════════════════════════
WITH inv_rel AS (   -- every release number written on every invoice ("1002-1160 / 1002-1158" = two)
  SELECT i.id, upper(regexp_replace(p.x, '[^A-Za-z0-9]', '', 'g')) AS k
  FROM public.accounting_invoices i
  CROSS JOIN LATERAL regexp_split_to_table(coalesce(i.release_number, ''), '\s*(?:[,;&/+]|\mand\M)\s*', 'i') AS p(x)
  WHERE regexp_replace(p.x, '[^A-Za-z0-9]', '', 'g') <> ''
), elite AS (       -- the 25 newest invoices of every customer with "elite" in the name
  SELECT i.id FROM public.accounting_invoices i JOIN public.accounting_customers c ON c.id = i.accounting_customer_id
  WHERE coalesce(c.company_name, '') || ' ' || coalesce(c.contact_name, '') ILIKE '%elite%'
  ORDER BY i.invoice_date DESC NULLS LAST LIMIT 25
), seed AS (
  SELECT id FROM public.accounting_invoices WHERE invoice_number ILIKE '%1771%'
  UNION SELECT id FROM inv_rel WHERE k IN ('10021164', '10021160', '10021158')
  UNION SELECT id FROM elite
), keys AS (
  SELECT DISTINCT k FROM inv_rel WHERE id IN (SELECT id FROM seed)
  UNION SELECT unnest(ARRAY['10021164', '10021160', '10021158'])
), scope AS (       -- the invoices asked about + every invoice sharing a release with them (their costs are split by pounds)
  SELECT id FROM seed UNION SELECT id FROM inv_rel WHERE k IN (SELECT k FROM keys)
), its AS (
  SELECT it.id, it.invoice_id, it.description, it.quantity, it.unit_price, it.wave_product_name,
         btrim(regexp_replace(lower(coalesce(nullif(btrim(it.wave_product_name), ''), it.description, '')), '[^a-z0-9&]+', ' ', 'g')) AS name_key
  FROM public.accounting_invoice_items it WHERE it.invoice_id IN (SELECT id FROM scope)
), bill_rel AS (
  SELECT b.id, upper(regexp_replace(p.x, '[^A-Za-z0-9]', '', 'g')) AS k
  FROM public.vendor_bills b
  CROSS JOIN LATERAL regexp_split_to_table(coalesce(b.release_number, ''), '\s*(?:[,;&/+]|\mand\M)\s*', 'i') AS p(x)
), cust AS (
  SELECT DISTINCT c.id FROM public.accounting_customers c
  WHERE c.id IN (SELECT accounting_customer_id FROM public.accounting_invoices WHERE id IN (SELECT id FROM scope))
     OR coalesce(c.company_name, '') || ' ' || coalesce(c.contact_name, '') ~* '(elite|fadi|egypt|m[ou]+sta(f|ph)a)'
)
SELECT jsonb_build_object(
  'made_at', now(),
  'seed_invoice_ids', (SELECT jsonb_agg(id) FROM seed),
  'release_keys', (SELECT jsonb_agg(k) FROM keys),
  'invoices', (SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT id, invoice_number, accounting_customer_id, invoice_date, total_amount, record_status, currency, source, wave_invoice_id, wave_business_id, release_number
                 FROM public.accounting_invoices WHERE id IN (SELECT id FROM scope)) x),
  'items', (SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT id, invoice_id, description, quantity, unit_price, wave_product_name FROM its) x),
  'customers', (SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT id, company_name, contact_name, business_tag FROM public.accounting_customers WHERE id IN (SELECT id FROM cust)) x),
  'customerTerms', (SELECT jsonb_agg(to_jsonb(t)) FROM public.pl_customer_terms t WHERE t.customer_id IN (SELECT id FROM cust)),
  'terms', (SELECT jsonb_agg(to_jsonb(t)) FROM public.pl_invoice_terms t WHERE t.invoice_id IN (SELECT id FROM scope)),
  'nameUnits', (SELECT jsonb_agg(to_jsonb(u)) FROM public.pl_name_units u WHERE u.name_key IN (SELECT name_key FROM its)),
  'lineUnits', (SELECT jsonb_agg(to_jsonb(u)) FROM public.pl_line_units u WHERE u.invoice_item_id IN (SELECT id FROM its)),
  'nameKinds', (SELECT jsonb_agg(to_jsonb(u)) FROM public.pl_name_kinds u WHERE u.name_key IN (SELECT name_key FROM its)),
  'lineReleasePounds', (SELECT jsonb_agg(to_jsonb(u)) FROM public.pl_line_release_pounds u WHERE u.invoice_item_id IN (SELECT id FROM its)),
  'factors', (SELECT jsonb_agg(to_jsonb(u)) FROM public.pl_unit_factors u),
  'partEstimates', (SELECT jsonb_agg(to_jsonb(u)) FROM public.pl_release_part_estimates u WHERE u.release_key IN (SELECT k FROM keys)),
  'estimates', (SELECT jsonb_agg(to_jsonb(u)) FROM public.pl_release_estimates u WHERE u.release_key IN (SELECT k FROM keys)),
  'warehouseSettings', (SELECT jsonb_agg(to_jsonb(u)) FROM public.pl_warehouse_settings u),
  'warehouseRows', (SELECT jsonb_agg(to_jsonb(u)) FROM public.pl_warehouse_shipping u WHERE u.release_key IN (SELECT k FROM keys)),
  'bills', (SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT id, vendor_name, bill_number, bill_date, total_amount, record_status, bill_type, shipment_direction, release_number
              FROM public.vendor_bills WHERE id IN (SELECT id FROM bill_rel WHERE k IN (SELECT k FROM keys))) x),
  -- question 3: every customer whose name has egypt / moustafa / mustafa / mostafa, with its invoices counted per set of books
  'egypt_moustafa_customers', (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.name) FROM (
      SELECT c.id, coalesce(c.company_name, c.contact_name) AS name, c.contact_name, c.business_tag,
             (SELECT basis FROM public.pl_customer_terms ct WHERE ct.customer_id = c.id) AS usual_basis_now,
             count(i.id) AS invoices, min(i.invoice_date) AS first_invoice, max(i.invoice_date) AS last_invoice,
             count(i.id) FILTER (WHERE i.wave_business_id = 'QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk') AS in_ktc_books,
             count(i.id) FILTER (WHERE i.id IS NOT NULL AND (i.wave_business_id IS NULL OR btrim(i.wave_business_id) = '')) AS no_company_set,
             count(i.id) FILTER (WHERE i.wave_business_id IS NOT NULL AND btrim(i.wave_business_id) <> '' AND i.wave_business_id <> 'QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk') AS in_other_books,
             count(t.invoice_id) FILTER (WHERE t.basis IS NOT NULL OR t.shipping_terms IS NOT NULL) AS invoices_with_their_own_setting
      FROM public.accounting_customers c
      LEFT JOIN public.accounting_invoices i ON i.accounting_customer_id = c.id AND coalesce(i.record_status, '') NOT IN ('void', 'cancelled', 'archived', 'deleted')
      LEFT JOIN public.pl_invoice_terms t ON t.invoice_id = i.id
      WHERE coalesce(c.company_name, '') || ' ' || coalesce(c.contact_name, '') ~* '(egypt|m[ou]+sta(f|ph)a)'
      GROUP BY c.id) x),
  -- question 1: every invoice line with "foam" in its name or description, and the unit it is set to
  'foam_lines', (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.lines DESC) FROM (
      SELECT f.nm AS name, f.name_key, (SELECT unit FROM public.pl_name_units u WHERE u.name_key = f.name_key) AS unit_of_name,
             count(*) AS lines, sum(f.quantity) AS quantity, max(f.invoice_date) AS last_sold,
             bool_or(f.nm !~* 'foam') AS foam_only_in_description,
             (SELECT jsonb_agg(DISTINCT lu.unit) FROM public.pl_line_units lu WHERE lu.invoice_item_id = ANY (array_agg(f.id))) AS units_set_on_single_lines
      FROM (SELECT it.id, it.quantity, i.invoice_date, coalesce(nullif(btrim(it.wave_product_name), ''), it.description, '') AS nm,
                   btrim(regexp_replace(lower(coalesce(nullif(btrim(it.wave_product_name), ''), it.description, '')), '[^a-z0-9&]+', ' ', 'g')) AS name_key
            FROM public.accounting_invoice_items it JOIN public.accounting_invoices i ON i.id = it.invoice_id
            WHERE coalesce(it.wave_product_name, '') || ' ' || coalesce(it.description, '') ~* 'foam') f
      GROUP BY f.nm, f.name_key) x)
) AS copy_this_cell_to_claude;
