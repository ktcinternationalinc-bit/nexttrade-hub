-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-UG — ADMINS / OWNERS: keep what they can do today, as normal switches (Max, Nov 18 2026)
-- "the admin should not just have access, i need to give him access"
-- From v55.83-UG an admin or owner gets NO accounting / banking access from their role — only the switches that are ON for them.
-- So nobody is locked out overnight, this turns ON, for every admin and owner, the everyday (non-sensitive) switches they had
-- automatically until now. Max then turns OFF what he does not want, in Settings → 🏦 Banking & Accounting Access.
-- The sensitive 🔒 switches (profit & margin, money totals, bank balances, private accounts, add transactions by hand, advances)
-- are NOT turned on — admins never had those automatically.
-- A switch already set for a person (ON or OFF) is never changed — and (Codex QA 12:45) a switch that is OFF under ANY of its names
-- (e.g. invoices.create / invoice.create / "Invoice: Create") is not turned ON under another name either. Nothing is deleted. Safe to run more than once.
-- Run it right after v55.83-UG goes live. Codex QA 18:06: same switch rule as the Hub (permission-aliases.js): an OFF under any
-- name of a switch wins; 'accounting.view' (old "both hubs") never links ClickBooks and Wave together.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · the switch families (the same list the Hub uses) ──
CREATE TEMP TABLE ug_fam (fam text, member text) ON COMMIT PRESERVE ROWS;
INSERT INTO ug_fam VALUES
  ('ar.view_summary', 'ar.view_summary'),
  ('ar.view_summary', 'AR: View Summary'),
  ('ar.view_summary', 'Finance: View Company Totals'),
  ('ar.view_summary', 'finance.view_company_totals'),
  ('ar.view_customer_balances', 'ar.view_customer_balances'),
  ('ar.view_customer_balances', 'AR: View Customer Balances'),
  ('ar.view_customer_balances', 'Finance: View All Customer Balances'),
  ('ar.view_customer_balances', 'finance.view_all_customer_balances'),
  ('ar.view_invoice_balances', 'ar.view_invoice_balances'),
  ('ar.view_invoice_balances', 'AR: View Invoice Balances'),
  ('ar.view_invoice_balances', 'Invoice: View Balance'),
  ('ar.view_invoice_balances', 'invoice.view_balance'),
  ('ar.view_overdue', 'ar.view_overdue'),
  ('ar.view_overdue', 'AR: View Overdue'),
  ('ar.export', 'ar.export'),
  ('ar.export', 'AR: Export'),
  ('ar.full', 'ar.full'),
  ('ar.full', 'AR: Full'),
  ('ar.full', 'Finance: Admin'),
  ('ar.full', 'finance.admin'),
  ('invoices.view', 'invoices.view'),
  ('invoices.view', 'Invoice: View'),
  ('invoices.view', 'invoice.view'),
  ('invoices.create', 'invoices.create'),
  ('invoices.create', 'Invoice: Create'),
  ('invoices.create', 'invoice.create'),
  ('invoices.edit', 'invoices.edit'),
  ('invoices.edit', 'Invoice: Edit'),
  ('invoices.edit', 'invoice.edit'),
  ('invoices.approve', 'invoices.approve'),
  ('invoices.approve', 'Invoice: Approve'),
  ('invoices.approve', 'invoice.approve'),
  ('customers.view', 'customers.view'),
  ('customers.view', 'Customer: View'),
  ('customers.view', 'customer.view'),
  ('customers.create', 'customers.create'),
  ('customers.create', 'Customer: Create'),
  ('customers.create', 'customer.create'),
  ('bank_transactions.view', 'bank_transactions.view'),
  ('bank_transactions.view', 'Bank: View Transactions'),
  ('bank_transactions.view', 'bank.view_transactions'),
  ('bank_transactions.view', 'Bank: View'),
  ('bank_transactions.view', 'bank.view'),
  ('bank_balances.view', 'bank_balances.view'),
  ('payments.match', 'payments.match'),
  ('payments.match', 'Payments: Match'),
  ('payments.unmatch', 'payments.unmatch'),
  ('payments.unmatch', 'Payments: Unmatch'),
  ('payments.mark_manual_done', 'payments.mark_manual_done'),
  ('payments.mark_manual_done', 'Payments: Mark Manual Done'),
  ('categories.apply', 'categories.apply'),
  ('categories.apply', 'Categories: Apply'),
  ('categories.apply', 'Bank: Classify'),
  ('categories.apply', 'bank.classify'),
  ('wave.sync.view', 'wave.sync.view'),
  ('wave.sync.view', 'Wave: Sync View'),
  ('wave.sync.dry_run', 'wave.sync.dry_run'),
  ('wave.sync.dry_run', 'Wave: Dry Run'),
  ('wave.sync.log.view', 'wave.sync.log.view'),
  ('wave.sync.log.view', 'Wave: Sync Log View'),
  ('wave.customers.push', 'wave.customers.push'),
  ('wave.customers.push', 'Wave: Push Customers'),
  ('wave.invoices.push', 'wave.invoices.push'),
  ('wave.invoices.push', 'Wave: Push Invoices'),
  ('wave.payments.push', 'wave.payments.push'),
  ('wave.payments.push', 'Wave: Push Payments'),
  ('wave.categories.pull', 'wave.categories.pull'),
  ('wave.categories.pull', 'Wave: Pull Categories'),
  ('wave.categories.pull', 'categories.sync_from_wave'),
  ('wave.import.run', 'wave.import.run'),
  ('wave.import.run', 'Wave: Import'),
  ('wave.import.run', 'wave.import'),
  ('wave.settings.manage', 'wave.settings.manage'),
  ('wave.settings.manage', 'Wave: Settings Manage'),
  ('wave.production.push', 'wave.production.push'),
  ('wave.production.push', 'Wave: Production Push'),
  ('accounting.view', 'accounting.view'),
  ('accounting.clickbooks.access', 'accounting.clickbooks.access'),
  ('accounting.wavehub.access', 'accounting.wavehub.access');
CREATE TEMP TABLE ug_keys (module_name text) ON COMMIT PRESERVE ROWS;
INSERT INTO ug_keys VALUES
  ('accounting.clickbooks.access'), ('accounting.wavehub.access'), ('accounting.view_invoicing'), ('accounting.change_dates'),
  ('accounting.customers.view'), ('accounting.customers.edit'), ('accounting.company_profile.view'), ('accounting.company_profile.edit'),
  ('invoice.view'), ('invoice.create'), ('invoices.view'), ('invoices.create'), ('invoices.edit'), ('invoices.approve'),
  ('customers.view'), ('customers.create'),
  ('payments.match'), ('payments.unmatch'), ('payments.mark_manual_done'),
  ('ar.view_summary'), ('ar.view_customer_balances'), ('ar.view_invoice_balances'), ('ar.view_overdue'), ('ar.view_upcoming_due'), ('ar.export'),
  ('ar.send_reminders'), ('ar.manage_overdue_dashboard'),
  ('bank.view'), ('bank.see_amounts'), ('bank.view_all_accounts'), ('bank.classify'), ('bank.connections'),
  ('bank_transactions.view'), ('categories.apply'),
  ('bills.view'), ('bills.manage'), ('bills.price_rules'),
  ('wires.view'), ('wires.prepare'), ('wires.signoff'), ('wires.send'), ('wires.override'),
  ('journals.prepare'), ('journals.approve'),
  ('recon.signoff'), ('orders.monitor'), ('orders.manage'),
  ('pnl.view'), ('pnl.edit_costs'),
  ('company.nextrade.view'), ('company.nextrade.manage'), ('company.rtm.view'), ('company.rtm.manage'),
  ('purchase_orders.view'), ('purchase_orders.edit'),
  ('wave.sync.view'), ('wave.sync.dry_run'), ('wave.sync.log.view'), ('wave.customers.push'), ('wave.invoices.push'), ('wave.payments.push'),
  ('wave.categories.pull'), ('wave.import.run')
;

-- ── 2 · PREVIEW: exactly which switches each admin / owner will get ON (nothing changes yet) ──
CREATE TEMP TABLE ug_plan ON COMMIT PRESERVE ROWS AS
SELECT u.id AS user_id, u.name, u.role, k.module_name
FROM public.users u CROSS JOIN ug_keys k
WHERE u.role IN ('admin', 'owner')
  AND NOT EXISTS (SELECT 1 FROM public.module_permissions mp WHERE mp.user_id = u.id AND mp.module_name = k.module_name)
  AND NOT EXISTS (   -- the same switch is OFF for this person under any of its names
    SELECT 1 FROM public.module_permissions mp
    WHERE mp.user_id = u.id AND mp.has_access = false
      AND mp.module_name IN (SELECT f2.member FROM ug_fam f1 JOIN ug_fam f2 ON f2.fam = f1.fam WHERE f1.member = k.module_name));
SELECT name, role, count(*) AS switches_to_turn_on, string_agg(module_name, ', ' ORDER BY module_name) AS which FROM ug_plan GROUP BY name, role ORDER BY name;

-- ── 3 · CONFLICTS to look at (anyone, not only admins): the same switch ON under one name and OFF under another.
--        From UG the OFF wins (it shows OFF in Settings too). To give it back, turn the switch ON in Settings → 🏦 Banking & Accounting Access.
SELECT u.name, u.role, f.fam AS switch, string_agg(DISTINCT CASE WHEN mp.has_access THEN mp.module_name END, ', ') AS on_as,
       string_agg(DISTINCT CASE WHEN NOT mp.has_access THEN mp.module_name END, ', ') AS off_as
FROM public.module_permissions mp JOIN ug_fam f ON f.member = mp.module_name JOIN public.users u ON u.id = mp.user_id
GROUP BY u.name, u.role, f.fam HAVING bool_or(mp.has_access) AND bool_or(NOT mp.has_access) ORDER BY 1, 3;

-- ── 4 · THE CHANGE ──
INSERT INTO public.module_permissions (user_id, module_name, has_access)
SELECT user_id, module_name, true FROM ug_plan
ON CONFLICT (user_id, module_name) DO NOTHING;

-- check: how many switches each admin / owner now has ON
SELECT u.name, u.role, count(*) FILTER (WHERE mp.has_access) AS switches_on
FROM public.users u LEFT JOIN public.module_permissions mp ON mp.user_id = u.id
WHERE u.role IN ('admin', 'owner') GROUP BY u.name, u.role ORDER BY u.name;
DROP TABLE ug_plan; DROP TABLE ug_keys; DROP TABLE ug_fam;
