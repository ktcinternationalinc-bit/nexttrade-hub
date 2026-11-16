-- READ-ONLY CHECK: what the Profitability report has actually saved for units, newest first.
-- It only reads. It changes nothing. Supabase → SQL Editor → New query → paste → Run, then send a screenshot.
SELECT 'description' AS kind, raw_name AS what, unit, updated_at
  FROM public.pl_name_units
UNION ALL
SELECT 'one invoice line', invoice_item_id::text, unit, updated_at
  FROM public.pl_line_units
UNION ALL
SELECT 'audit: ' || action, coalesce(details ->> 'unit', '') || ' ' || coalesce(left(details ->> 'names', 120), entity_id), '', created_at
  FROM public.hub_audit_log
 WHERE action IN ('pl_name_unit_set', 'pl_line_unit_set')
UNION ALL
SELECT 'allowed units', pg_get_constraintdef(c.oid), '', now()
  FROM pg_constraint c
 WHERE c.conname IN ('pl_name_units_unit_check', 'pl_line_units_unit_check')
ORDER BY 4 DESC
LIMIT 40;
