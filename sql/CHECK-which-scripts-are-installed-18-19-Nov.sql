-- READ-ONLY CHECK (changes nothing): which of the scripts from 17–19 Nov 2026 are installed on this database.
-- One row per script. "RUN" = its mark is on the database. "NOT RUN" = you still need to run that file.
WITH f AS (SELECT p.proname, p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'),
     t AS (SELECT tgname FROM pg_trigger WHERE NOT tgisinternal),
     elite(k) AS (VALUES ('10011541'), ('10011627'), ('10021036'), ('10021059'), ('10021125'), ('10021129'), ('10021130'), ('10021133'), ('10021138'), ('10021144'), ('10021146'), ('10021152'), ('10021154'),
       ('10021168'), ('10021178'), ('10021183'), ('10021184'), ('10021188'), ('10021195'), ('10021202'), ('10021203'), ('10021204'), ('10021207'), ('10021211'), ('10021212')),
     cnf(id) AS (VALUES ('2f2b2700-916b-4280-8751-dfe3f82322a8'::uuid), ('da70bd80-41cc-4c44-accd-6bd6e0db4496'::uuid), ('7b0b27b5-a69d-4027-8bd9-5d31e93fa7f9'::uuid), ('27132608-be06-4ca3-9e27-9fb0d7549a1a'::uuid), ('52ca5339-a6a8-493e-b5d7-1d7ce88630cf'::uuid), ('f6d0a5f6-0a7f-4907-b3fc-5e9b5857e91f'::uuid)),
     checks(n, script, what_it_is_for, ok, detail) AS (
  SELECT 1, 'WIRES-1-of-2-run-FIRST-SP.sql (v55-83-SP-funded-requests, amended)', 'Wires: requests drawn from a transfer; safe locking',
         EXISTS (SELECT 1 FROM f WHERE proname = 'wire_request_send' AND prosrc LIKE '%hub-bank-line:%'),
         CASE WHEN EXISTS (SELECT 1 FROM f WHERE proname = 'wire_request_send') THEN 'an OLDER copy is installed — run the amended file' ELSE 'not installed' END
  UNION ALL SELECT 2, 'WIRES-2-of-2-run-SECOND-US.sql (v55-83-US-partial-wires)', 'Wires: one bill on a second wire (Yasmeen, bill 14277)',
         EXISTS (SELECT 1 FROM f WHERE proname = 'hub_wire_line_pay') AND EXISTS (SELECT 1 FROM t WHERE tgname = 'hub_wire_line_cap') AND EXISTS (SELECT 1 FROM t WHERE tgname = 'hub_bill_payment_final') AND to_regclass('public.uq_wpkg_line_open_bill') IS NULL,
         'not installed (or only partly)'
  UNION ALL SELECT 3, 'v55-83-UM-invoice-delete.sql', 'Invoices: Delete / Void / Archive buttons work',
         -- Codex 13:06: COMPLETE = both functions with their exact signatures AND the guard switched on, on the invoices table
         to_regprocedure('public.hub_invoice_lifecycle(jsonb)') IS NOT NULL AND to_regprocedure('public.hub_invoice_lifecycle_check(jsonb)') IS NOT NULL
           AND EXISTS (SELECT 1 FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid JOIN pg_namespace ns ON ns.oid = c.relnamespace
                       WHERE g.tgname = 'hub_guard_invoice_status' AND NOT g.tgisinternal AND g.tgenabled <> 'D' AND ns.nspname = 'public' AND c.relname = 'accounting_invoices'),
         CASE WHEN to_regprocedure('public.hub_invoice_lifecycle(jsonb)') IS NULL AND NOT EXISTS (SELECT 1 FROM t WHERE tgname = 'hub_guard_invoice_status') THEN 'not installed — until then Delete / Void / Archive answer "run the UM SQL"'
              WHEN to_regprocedure('public.hub_invoice_lifecycle_check(jsonb)') IS NULL THEN 'an OLDER / partial copy is installed (the check-only step is missing) — run the current UM file again'
              WHEN EXISTS (SELECT 1 FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid WHERE g.tgname = 'hub_guard_invoice_status' AND c.relname = 'accounting_invoices' AND g.tgenabled = 'D') THEN 'installed, but the invoice guard is switched OFF — tell Claude'
              ELSE 'only partly installed (the invoice guard is missing) — run the current UM file again' END
  UNION ALL SELECT 4, 'v55-83-UQ-exact-duplicate-bills.sql', 'Bills: the exact same bill is refused twice',
         EXISTS (SELECT 1 FROM t WHERE tgname = 'hub_bill_exact_guard'), 'not installed'
  UNION ALL SELECT 5, 'v55-83-UC-order-report-archive.sql', 'Orders report: Non issue / Corrected archive',
         to_regclass('public.order_report_archive') IS NOT NULL, 'not installed'
  UNION ALL SELECT 6, 'v55-83-UL-free-supplier-names.sql', 'Profitability: Texas Cardboard at $0 cost',
         to_regclass('public.pl_free_bill_names') IS NOT NULL, 'not installed'
  UNION ALL SELECT 7, 'v55-83-UJ-plaid-accounts-narrow-grant.sql', 'Bank screens: bank lines readable, balances not leaked',
         to_regclass('public.plaid_accounts') IS NOT NULL AND has_column_privilege('authenticated', 'public.plaid_accounts', 'is_private', 'SELECT') AND NOT has_table_privilege('authenticated', 'public.plaid_accounts', 'SELECT'),
         'not as expected — tell Claude'
  UNION ALL SELECT 8, 'v55-83-TL-trucking-freight.sql', 'Profitability: trucking / freight typed per release',
         to_regclass('public.pl_release_part_estimates') IS NOT NULL, 'not installed'
  UNION ALL SELECT 9, 'v55-83-TV-repeating-bills.sql', 'Repeating bills',
         to_regclass('public.recurring_bills') IS NOT NULL, 'not installed'
  UNION ALL SELECT 10, 'v55-83-TW-company-books.sql', 'Nextrade / RTM own books',
         EXISTS (SELECT 1 FROM f WHERE proname = 'hub_company_books_installed'), 'not installed'
  UNION ALL SELECT 11, 'v55-83-TX-advances-fees.sql', 'NextTrade / RTM advances and extra fees',
         EXISTS (SELECT 1 FROM f WHERE proname = 'hub_party_money_installed'), 'not installed'
  UNION ALL SELECT 12, 'v55-83-UB-company-transfers.sql', 'Nextrade / RTM: pair transfers between own accounts',
         EXISTS (SELECT 1 FROM f WHERE proname = 'hub_company_transfers_installed'), 'not installed'
  UNION ALL SELECT 13, 'v55-83-UD-pay-nextrade.sql', 'Paying NextTrade: pick the bills a payment covers',
         EXISTS (SELECT 1 FROM f WHERE proname = 'hub_party_allocate'), 'not installed'
  UNION ALL SELECT 14, 'v55-83-UE Maa Kirpa (customer usual basis CNF)', 'Profitability: Maa Kirpa is CNF',
         (SELECT count(*) FROM public.pl_customer_terms WHERE basis = 'CNF' AND customer_id IN ('d7b31bc2-d70a-4f83-bfcb-caa4bf6b4752', 'f5e08702-c1bb-4128-ab91-acf7117d1c3a')) = 2, 'not both set'
  UNION ALL SELECT 15, 'v55-83-UZ-egypt-moustafa-cnf.sql (B2)', 'Profitability: KTC Egypt / Moustafa customers are CNF',
         (SELECT count(*) FROM public.pl_customer_terms ct JOIN cnf ON cnf.id = ct.customer_id WHERE ct.basis = 'CNF') = 6,
         (SELECT count(*) FROM public.pl_customer_terms ct JOIN cnf ON cnf.id = ct.customer_id WHERE ct.basis = 'CNF') || ' of 6 customers set — run B2'
  UNION ALL SELECT 16, 'v55-83-UZ-elite-no-freight.sql (A2)', 'Profitability: Elite pays its own freight (freight 0, trucking kept)',
         (SELECT count(*) FROM public.pl_release_part_estimates e JOIN elite ON elite.k = e.release_key WHERE e.part = 'freight' AND e.amount = 0) = 25,
         (SELECT count(*) FROM public.pl_release_part_estimates e JOIN elite ON elite.k = e.release_key WHERE e.part = 'freight' AND e.amount = 0) || ' of 25 releases at 0 — run A2'
)
SELECT n AS "#", script, what_it_is_for, CASE WHEN ok THEN 'RUN' ELSE 'NOT RUN' END AS status, CASE WHEN ok THEN '' ELSE detail END AS what_to_do
FROM checks ORDER BY ok, n;
