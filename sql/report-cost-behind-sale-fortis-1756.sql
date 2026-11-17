-- READ-ONLY report (changes nothing). The supplier bill lines behind the goods cost of invoice AMERICA 1756
-- (FORTIS MATERIAL BY TONS, sale date 2026-10-06): every linked supplier line dated 2026-07-08 → 2026-10-06 (the 90 days before).
-- Same rule as the Profitability report: cost per lb = total cost ÷ total pounds bought; commission the same way.
WITH inv_group AS (
  SELECT g.id, g.display_name
  FROM public.pl_group_names n JOIN public.pl_product_groups g ON g.id = n.group_id
  WHERE n.source = 'invoice' AND n.active AND g.active AND n.name_key = 'fortis material by tons'
),
same_name_groups AS (
  SELECT g.id FROM public.pl_product_groups g JOIN inv_group ig
    ON btrim(regexp_replace(lower(g.display_name), '[^a-z0-9&]+', ' ', 'g')) = btrim(regexp_replace(lower(ig.display_name), '[^a-z0-9&]+', ' ', 'g'))
  WHERE g.active
),
linked AS (
  SELECT DISTINCT n.name_key FROM public.pl_group_names n
  WHERE n.active AND n.source <> 'invoice' AND n.group_id IN (SELECT id FROM same_name_groups)
),
lines AS (
  SELECT b.vendor_name, b.bill_number, b.bill_date, b.release_number, l.description, l.qty, l.unit,
    CASE
      WHEN lower(regexp_replace(coalesce(l.unit, ''), '[^a-zA-Z]', '', 'g')) IN ('lb', 'lbs', 'pound', 'pounds') THEN 1
      WHEN lower(regexp_replace(coalesce(l.unit, ''), '[^a-zA-Z]', '', 'g')) IN ('kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms') THEN 2.20462
      WHEN lower(regexp_replace(coalesce(l.unit, ''), '[^a-zA-Z]', '', 'g')) IN ('t', 'mt', 'ton', 'tons', 'tonne', 'tonnes', 'metricton', 'metrictons') THEN 2204.62
    END AS lb_per_unit,
    coalesce(l.cost_amount, l.amount) AS cost,
    coalesce(l.commission_amount, 0) AS commission
  FROM public.vendor_bill_lines l
  JOIN public.vendor_bills b ON b.id = l.bill_id
  WHERE b.record_status = 'active'
    AND coalesce(b.bill_type, '') NOT IN ('trucking', 'shipping', 'bonded_brokerage')
    AND l.line_kind = 'item'
    AND b.bill_date BETWEEN DATE '2026-07-08' AND DATE '2026-10-06'
    AND btrim(regexp_replace(regexp_replace(lower(coalesce(l.description, '')), '[^a-z0-9&]+', ' ', 'g'), '\s+', ' ', 'g')) IN (SELECT name_key FROM linked)
),
detail AS (
  SELECT 1 AS sort, bill_date::text AS bill_date, vendor_name AS vendor, bill_number::text AS bill, coalesce(release_number, '') AS release,
    description, qty, coalesce(unit, '(no unit)') AS unit,
    round(qty * lb_per_unit, 0) AS pounds, round(cost, 2) AS cost, round(commission, 2) AS commission,
    round(cost / nullif(qty * lb_per_unit, 0), 4) AS cost_per_lb
  FROM lines
)
SELECT * FROM detail
UNION ALL
SELECT 2, 'TOTAL', count(*)::text || ' lines', count(DISTINCT bill)::text || ' bills', '', '', NULL, '',
  sum(pounds), sum(cost), sum(commission),
  round(sum(cost) / nullif(sum(pounds), 0), 4)
FROM detail
UNION ALL
SELECT 3, 'COMMISSION / LB', '', '', '', '', NULL, '', NULL, NULL, NULL,
  round(sum(commission) / nullif(sum(pounds), 0), 4)
FROM detail
ORDER BY 1, 2, 4;
