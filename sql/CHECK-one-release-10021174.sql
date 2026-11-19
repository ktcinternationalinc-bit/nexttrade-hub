WITH inv_rel AS (
  SELECT i.id, upper(regexp_replace(p.x, '[^A-Za-z0-9]', '', 'g')) AS k
  FROM public.accounting_invoices i
  CROSS JOIN LATERAL regexp_split_to_table(coalesce(i.release_number, ''), '\s*(?:[,;&/+]|\mand\M)\s*', 'i') AS p(x)
  WHERE regexp_replace(p.x, '[^A-Za-z0-9]', '', 'g') <> ''
), seed AS (
  SELECT id FROM inv_rel WHERE k IN ('10021174')
), keys AS (
  SELECT DISTINCT k FROM inv_rel WHERE id IN (SELECT id FROM seed)
  UNION SELECT unnest(ARRAY['10021174'])
), scope AS (
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
     OR coalesce(c.company_name, '') || ' ' || coalesce(c.contact_name, '') = '__none__'
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
              FROM public.vendor_bills WHERE id IN (SELECT id FROM bill_rel WHERE k IN (SELECT k FROM keys))) x)
) AS copy_this_cell_to_claude;
