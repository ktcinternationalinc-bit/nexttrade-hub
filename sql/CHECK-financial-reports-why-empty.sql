SELECT jsonb_build_object(
  'checked_at', now(),
  'books', (SELECT jsonb_agg(code) FROM clickbooks_us.books),
  'accounts', (SELECT count(*) FROM clickbooks_us.accounts),
  'journals_by_status_and_year', (SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT status, extract(year FROM entry_date)::int AS year, count(*) AS journals, min(entry_date) AS first_date, max(entry_date) AS last_date FROM clickbooks_us.journals GROUP BY 1, 2 ORDER BY 2, 1) x),
  'journal_lines', (SELECT count(*) FROM clickbooks_us.journal_lines),
  'sync_runs_total', (SELECT count(*) FROM clickbooks_us.shadow_sync_runs),
  'last_5_sync_runs', (SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT created_at, from_date, to_date, result FROM clickbooks_us.shadow_sync_runs ORDER BY created_at DESC LIMIT 5) x),
  'hub_invoices_this_year', (SELECT count(*) FROM public.accounting_invoices WHERE invoice_date >= date '2026-01-01'),
  'readiness', public.clickbooks_us_report_read('readiness', date '2026-01-01', current_date, true),
  'profit_and_loss_this_year', public.clickbooks_us_report_read('profit_loss', date '2026-01-01', current_date, true) - 'rows'
) AS copy_this_cell_to_claude;
