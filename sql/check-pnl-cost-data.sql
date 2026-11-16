-- READ-ONLY CHECK for the product / customer / invoice profitability report.
-- It only counts things. It changes nothing. Safe to run as often as you like.
-- Run it in Supabase → SQL Editor → New query → paste → Run, then send back the table it shows.

WITH b AS (
  SELECT id, vendor_name, bill_type, shipment_direction, bill_date,
         upper(regexp_replace(coalesce(release_number, ''), '[^A-Za-z0-9]', '', 'g')) AS rel
    FROM public.vendor_bills WHERE record_status = 'active'
), l AS (
  SELECT vl.*, b.rel, b.bill_type, b.vendor_name
    FROM public.vendor_bill_lines vl JOIN b ON b.id = vl.bill_id
), i AS (
  SELECT id, upper(regexp_replace(coalesce(release_number, ''), '[^A-Za-z0-9]', '', 'g')) AS rel
    FROM public.accounting_invoices
   WHERE invoice_date >= DATE '2026-06-01'
     AND coalesce(record_status, 'active') NOT IN ('void', 'cancelled', 'archived', 'deleted')
     AND coalesce(currency, 'USD') = 'USD'
), ir AS (SELECT DISTINCT rel FROM i WHERE rel <> '')
SELECT * FROM (
  SELECT 10 AS n, 'Active bills: ' || coalesce(bill_type, '(no type)') || ' / ' || coalesce(shipment_direction, '(no direction)') AS what, count(*)::text AS value FROM b GROUP BY 2
  UNION ALL SELECT 20, 'Bills that have their lines stored', count(DISTINCT bill_id)::text FROM l
  UNION ALL SELECT 21, 'Bill lines: ' || line_kind, count(*)::text FROM l GROUP BY 2
  UNION ALL SELECT 22, 'Product lines by unit: ' || lower(coalesce(nullif(unit, ''), '(no unit)')), count(*)::text FROM l WHERE line_kind = 'item' GROUP BY 2
  UNION ALL SELECT 23, 'Product lines with a cost recorded', count(*)::text FROM l WHERE line_kind = 'item' AND cost_amount IS NOT NULL
  UNION ALL SELECT 24, 'Product lines with a commission recorded', count(*)::text FROM l WHERE line_kind = 'item' AND coalesce(commission_amount, 0) <> 0
  UNION ALL SELECT 25, 'Product lines whose bill HAS a release number', count(*)::text FROM l WHERE line_kind = 'item' AND rel <> ''
  UNION ALL SELECT 26, 'Product lines whose bill has NO release number', count(*)::text FROM l WHERE line_kind = 'item' AND rel = ''
  UNION ALL SELECT 27, 'Product lines by vendor: ' || vendor_name, count(*)::text FROM l WHERE line_kind = 'item' GROUP BY 2
  UNION ALL SELECT 30, 'Typed product costs (old P&L table)', count(*)::text FROM public.product_costs
  UNION ALL SELECT 31, 'Bill price rules (active)', count(*)::text FROM public.bill_price_rules WHERE active
  UNION ALL SELECT 32, 'Commission rule: ' || vendor_match || ' at ' || rate::text, CASE WHEN active THEN 'active' ELSE 'off' END FROM public.bill_commission_rules
  UNION ALL SELECT 40, 'Invoices since Jun 1 2026 (live, USD)', count(*)::text FROM i
  UNION ALL SELECT 41, 'Invoices since Jun 1 WITH a release number', count(*)::text FROM i WHERE rel <> ''
  UNION ALL SELECT 42, 'Distinct invoice release numbers', count(*)::text FROM ir
  UNION ALL SELECT 43, 'Invoice releases also on a SUPPLIER bill', count(*)::text FROM ir WHERE EXISTS (SELECT 1 FROM b WHERE b.rel = ir.rel AND b.bill_type = 'supplier')
  UNION ALL SELECT 44, 'Invoice releases also on a TRUCKING bill', count(*)::text FROM ir WHERE EXISTS (SELECT 1 FROM b WHERE b.rel = ir.rel AND b.bill_type = 'trucking')
  UNION ALL SELECT 45, 'Invoice releases also on a SHIPPING bill', count(*)::text FROM ir WHERE EXISTS (SELECT 1 FROM b WHERE b.rel = ir.rel AND b.bill_type = 'shipping')
  UNION ALL SELECT 46, 'Invoice releases also on a BROKERAGE / BONDED bill', count(*)::text FROM ir WHERE EXISTS (SELECT 1 FROM b WHERE b.rel = ir.rel AND b.bill_type = 'bonded_brokerage')
  UNION ALL SELECT 47, 'Invoice releases found in the NextTrade orders list', count(*)::text FROM ir WHERE EXISTS (SELECT 1 FROM public.nexttrade_orders o WHERE upper(regexp_replace(o.release_number, '[^A-Za-z0-9]', '', 'g')) = ir.rel)
  UNION ALL SELECT 50, 'NextTrade orders by warehouse: ' || coalesce(warehouse, '(none)'), count(*)::text FROM public.nexttrade_orders GROUP BY 2
) t ORDER BY n, what;
