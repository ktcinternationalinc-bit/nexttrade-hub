# ClickBooks US — Claude handoff

**Version 1.0 · 2 November 2026 · US Accounting only**


## ClickBooks · U.S. accounting

Database foundation installed. Historical migration and production application activation remain locked. Prepared for independent technical review; Claude has not reviewed or approved this work.


### Scope and non-negotiable boundary

ClickBooks extends only the U.S. Accounting operation in the existing KTC / Nexttrade Hub. It does not replace the hub. Egyptian invoices, Treasury, operational Sales and other subsidiaries are excluded. The implementation binds to the verified U.S. production Wave business, not to a generic business UUID or currency alone.

| Workstream | Verified status |
|---|---|
| Priority 1 — source audit | Hub database and supplied source audited. Migration exceptions recorded. Direct Wave/Plaid provider verification remains open. |
| Priority 2 — accounting core | Private US ledger installed; 176 proposed accounts and 1,880 Wave account mappings loaded; posting controls tested. |
| Hub integration | Read-only US screen and server handler added to source. Not deployed or signed-in browser tested. |
| Historical books | No live journals or historical transactions migrated. Opening balances and reconciliation remain open. |
| Existing operations | No existing US source rows changed in checked datasets. No new writes to Egyptian, Treasury or Sales records. |


### Current safety state

Book KTC_US uses USD. Both posting_enabled and historical_data_ready are false. There are zero journals, journal lines, posting-audit events and leftover QA accounts. The two application feature flags are disabled by default. Neither Wave synchronization nor existing bank connections was switched off or redirected.

Evidence date: 2 November 2026. Final database verification: 09:43:11 UTC. Source baseline: NEXTTRADE-HUB-v55.83-OW.zip, Library version 2. This is a staged accounting foundation, not a completed QuickBooks replacement or a tax-filing system.


## 1 / Source audit and migration exceptions

| U.S.-scoped dataset | Verified count |
|---|---|
| USD accounting invoices | 1,366 |
| Additional non-USD invoices in the US business | 3 EGP — held for review |
| Accounting customers | 244 |
| Invoice payment rows | 159 active; 11 void |
| Bank transactions | 360 total: 353 posted; 7 pending |
| Wave source account identifiers | 1,880 |


### Issues to resolve before financial migration

1,144 USD invoices have a Wave-imported paid amount but no local active payment-detail rows. Do not synthesize receipts from these cumulative balances. Obtain detailed ledger/payment history or agree and reconcile a cutoff-opening-balance approach. Otherwise payments, receivables and revenue can be counted twice.

Three EGP invoices inside the US Wave business are excluded from USD posting: 2232, AMERICA 620aa and SH1003. They were not moved or edited. Currency alone does not establish subsidiary ownership. One USD invoice, America 501a1, has no local line items.

206 bank transactions are unreviewed; 304 lack a Wave account mapping. All 360 have a null legacy business UUID, so that field is unsuitable as the sole company filter. Exact Wave-business scope remains present. Pending transactions are not eligible for posting.


### Feed evidence and its limits

The active US Chase connection records its last successful sync at 31 October 2026, 12:59:04 UTC, with a last successful posted date of 30 October. The reviewed US logs contain no scheduled_pull or scheduled_sync entries. In the supplied source, scheduled Wave/Plaid routes default to test businesses; the cron paths do not opt in to production. This is a production-scheduling verification gap, not proof that all bank refreshing has stopped. Existing routes and schedules were not changed.

Checks found zero duplicate Wave invoice IDs, duplicate bank source IDs, invoice total-minus-paid arithmetic mismatches, or active payments missing a scoped invoice/bank record. These checks do not establish complete historical balances or provider reconciliation.


## 2 / Data ownership and account mapping


### Existing data is retained, not overwritten

Read existing US accounting tables through the exact production Wave-business binding. Preserve external IDs, invoice/payment links, timestamps and existing classifications. Imported Wave history and hub-originated documents are separate source records; neither can be assumed to be a complete general ledger. Bank feeds provide transaction evidence, not a second revenue ledger.

| Source group | Handling in this increment |
|---|---|
| accounting_invoices / items / customers | Read-only audit. No historic journal generation or customer migration. |
| accounting_invoice_payments | Audit active/void detail and bank linkage. Preserve original rows. |
| bank_transactions / connections | Audit only the US business. No credentials exported or connection re-created. |
| wave_categories | Load proposed account definitions and retain all 1,880 external account mappings. |
| public.invoices / Treasury / Sales | Not migration sources. No new queries or writes in the US audit implementation. |


### Why 1,880 Wave IDs become 176 ledger accounts

| Mapping policy | External IDs | Target treatment |
|---|---|---|
| Ordinary accounts | 168 | One-to-one candidate accounts |
| System receivables | 1,205 | One accounts-receivable control |
| System payables | 36 | One accounts-payable control |
| Transfers | 471 | One transfer-clearing control |

The chart includes 168 ordinary Wave-derived accounts plus eight bootstrap control accounts: bank settlement, transfers, receivables, payables, payroll clearing, sales tax payable, unapplied customer receipts and opening-balance offset. Every external identifier remains in source_account_map; no historic amount was posted or collapsed.

The ordinary accounts and all mapping-review flags still require review. Accumulated depreciation is treated as a contra asset and sales discounts as contra income. Bank, credit-card and transfer accounts are marked sensitive. Bootstrap tax/clearing accounts are not tax advice or a completed statutory mapping. Technical account codes can be replaced with an approved human-readable chart before live posting.


## 3 / Ledger design and executed QA


### Installed protections

Journal lines store integer USD cents. Composite foreign keys prevent mixing books. Posting requires at least two nonzero, single-sided lines and equal debits and credits. Draft creation, line insertion, posting and audit logging occur atomically. The book row is locked to serialize posting; account rows and journal-line mutations are also guarded.

The source key is unique per book, source type and source ID. An identical posted retry returns the original journal; conflicting content is rejected. Posted headers and lines are immutable. Corrections use an exact linked reversal with a reason; the original remains. Closed periods, non-USD source invoices, pending bank items and unsupported source types are rejected.

A tested invoice/payment example debits receivables and credits income once, then debits bank and credits receivables on payment. The payment does not create revenue again. Trial-balance calculations include original and reversing entries at the requested date.

| QA gate | Observed result |
|---|---|
| Database acceptance checks | 33 passed in one rolled-back transaction. |
| Read-handler unit tests | 15 passed; 0 failed. Permission, redaction, scope and error-path cases. |
| New JavaScript syntax | Handler, route and React component pass node --check. |
| Existing accounting/bank suite | 121/122 required cases pass both before and after; one blocked by a missing package. One pre-existing stale case excluded. |
| Source isolation | Only AccountingTab.jsx changed among pre-existing files. No original files deleted. |
| Financial-source preservation | Four US dataset digests match before/after. No test journal or QA account remains. |


### What these results do not prove

Full Next.js compilation and signed-in browser behavior were not verified: dependencies could not be installed in the execution environment. The blocked legacy test could not import @supabase/supabase-js. Multi-client concurrency/load tests, direct provider calls, bank-statement reconciliation and complete historical financial statements remain unverified. Do not label this release launch-clean.

Reproducible evidence is included in clickbooks/tests and clickbooks/qa. The rollback-only database test temporarily enables posting inside its uncommitted transaction; that change is not retained or exposed to other sessions.


## 4 / Access controls and hub source integration


### Separate dashboard and banking access

The new screen requires the full-dashboard grant or a verified super-admin identity. Banking access is checked independently on the server. A dashboard user without banking access receives no bank-sensitive accounts, bank audit counts or complete trial balance. Existing employee invoice, bill and transaction-matching permissions are not changed.

The endpoint is GET /api/accounting/clickbooks-us. It accepts no query parameters, browser-selected business IDs, client banking flags or writes. Responses are private/no-store and projected through an allowlist. Unknown account sensitivity is withheld for non-bank viewers. Failed access checks do not return financial data.


### Database boundaries

All seven clickbooks_us tables have row-level security. Browser roles lack schema/table access; the service role has no direct table-write privilege. Internal functions use SECURITY INVOKER with a fixed search path. The one read facade is SECURITY DEFINER, executable only by service_role after server-side authorization. No posting RPC is exposed to browser or application roles.

The security advisor reports seven informational no-policy notices for these private, deny-direct-client tables. No new ClickBooks error/warning appeared in the returned advisor results. Existing shared-project security warnings remain, including public tables without RLS and other privileged functions; they were not changed because they are outside this increment. This is not an all-project security clearance.


### Activation prerequisites still missing

The existing verified-identity helper depends on financial_visibility_permissions and bank_visibility_profile_for_identity(uuid), which were absent in the checked database. Review the existing sql/bank-balance-visibility.sql separately and configure verified Supabase Auth UUIDs in HUB_SUPER_ADMIN_AUTH_USER_IDS. Do not substitute user-editable roles or guessed IDs. Until prerequisites are correct, the new server route fails closed.

The source screen refreshes a saved audit view every 60 seconds; it does not claim to ingest new financial history. Both CLICKBOOKS_US_ENABLED and NEXT_PUBLIC_CLICKBOOKS_US_ENABLED default off. Changing the public build-time flag requires a rebuild. No frontend deployment was performed.


## 5 / Deployment, reconciliation and rollback


### Developer implementation sequence

First, merge only this increment into the current repository. The supplied full ZIP is based on version 55.83-OW and is not evidence of the latest production code. Do not overwrite later live changes. Inspect the exact AccountingTab patch and the three new application files.

Second, verify the four named remote database migrations and live schema. Their SQL review/reproduction files are included, but the schema has already been installed. Do not rerun files 01, 03 or 04 blindly; their CREATE statements are not rerun-safe. The account seed in file 02 is idempotent. Do not enable live posting.

Third, review and deploy the existing verified financial-permission prerequisites in a controlled preview. Confirm one active hub identity per verified Auth UUID, super-admin allowlisting and separate bank/dashboard grants. This broader prerequisite migration was not applied in this increment.

Fourth, install the locked dependencies; run the new tests, the complete existing regression suite and npm run build. Exercise an authenticated preview as super admin, dashboard-only, bank-only and unauthorized users. Test logout, permission revocation, stale requests and cross-company attempts. Only then activate the read-only preview flags.


### Before posting can ever be enabled

Approve the proposed chart and account mappings. Resolve the three foreign-currency records and missing invoice detail. Obtain historical Wave journal/payment evidence or reconcile a chosen opening-balance cutoff. Resolve bank account mappings, pending/posted transitions and duplicate economic events across invoices and bank receipts. Reconcile receivables, payables, bank balances and trial balance before any switch in accounting authority.

A future write API must verify the actor, apply role-specific posting permissions and permit only one authoritative ledger entry for each economic event. The current private posting function is for a trusted database operator; caller-supplied actor UUIDs alone are not an authorization boundary. Automatic reconciliation, tax-return filing and money movement are not activated.


### Rollback without losing work

Keep or restore both app flags to false and redeploy the UI. Keep posting_enabled=false and historical_data_ready=false. Leave the additive schema in place for review; do not drop source records, mappings or eventual accounting history. No Wave/Plaid routing change needs reversal because none was made.


## 6 / Change register and Claude review request

| Artifact / change | Purpose |
|---|---|
| src/components/AccountingTab.jsx | Only changed pre-existing file: adds a feature-gated US tab. |
| src/components/ClickBooksUSCore.js | Read-only US audit and proposed chart screen. |
| src/lib/clickbooks-us-read.js | Scoped, permission-aware response handler and projection. |
| src/app/api/accounting/clickbooks-us/route.js | GET wiring to verified identity and service-only RPC. |
| clickbooks/sql/01–04 | Core, seed, audit, source guards and read-facade review SQL. |
| clickbooks/tests and clickbooks/qa | Database assertions, handler tests, logs, patch and recorded results. |


### Applied remote migration names

clickbooks_us_core_tables_v1; clickbooks_us_posting_guards_v1; clickbooks_us_source_audit_v1; clickbooks_us_scope_and_read_facade_v1. The chart seed was a separate verified DML operation. The reproduction bundle combines the first two schema migrations in file 01; file 02 is the seed.


### Requested independent review

Claude: inspect the SQL and source, not only this summary. Challenge company isolation, money precision, lock ordering and concurrency, idempotency, reversal invariants, account-review gates, source guards and bank-data leakage. Review the control-account mapping policy and the missing historical-payment strategy. Identify authorization prerequisites or production differences before recommending activation. Do not interpret balanced fixtures as reconciled real books.

Please return findings by severity with file/function references, reproducible cases and recommended patches. Distinguish observed bugs from assumptions. Review only the US Accounting scope; do not modify Treasury, Sales, Egypt or unrelated subsidiaries. This document does not record any review already performed by Claude.


### Evidence and reference material

Primary implementation evidence: clickbooks/qa/verified-results.json; tests/ledger_qa.sql; read-handler-final.log; post-change-regression.log; source-diff.json; AccountingTab.patch. These are dated snapshots, not continuous monitoring.

Technical references: Supabase row-level security documentation; PostgreSQL 17 CREATE TRIGGER and explicit-locking documentation. Security-advisor remediation links and exact project/business identifiers are included in the Markdown companion. Production deployment and provider checks remain open.


## Appendix A — Exact environment and data identifiers

Supabase project: `rmwbcfulncgfandhlzvz`.

Production Wave business label: `KTC INTERNATIONAL ENTERPRISES LLC`.

Production Wave business ID: `QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk`.

Internal ledger: `clickbooks_us`, book code `KTC_US`, currency `USD`.

The `business_entities` US display name is not assumed to establish the same legal entity as the verified Wave LLC. Confirm legal-entity naming before tax/reporting configuration. No tax identifier was changed.

Excluded non-USD source invoice IDs:
- `e774d9fe-5b21-4d76-9145-89ec8fe4584c` — 2232.
- `bb7393bb-7d2a-48da-8d0c-b37ce93dfd5d` — AMERICA 620aa.
- `205b9d3c-bc32-448c-a1d5-55f60af40e03` — SH1003.

USD invoice missing items: `86ecd761-ed4e-4eeb-8391-fb19b2f347de` — America 501a1.

## Appendix B — Reproducible QA and install discipline

```sh
node --test clickbooks/tests/read-handler.test.mjs
node scripts/run-accounting-bank-regression.js
node --experimental-default-type=module --check src/lib/clickbooks-us-read.js
node --experimental-default-type=module --check src/components/ClickBooksUSCore.js
node --experimental-default-type=module --check src/app/api/accounting/clickbooks-us/route.js
npm ci
npm run build
```

Run the SQL acceptance script only as a trusted operator with the posting lock still disabled. It uses temporary fixtures in a transaction that ends in ROLLBACK. The current test depends on an existing held non-USD invoice and a pending US bank row; on a different environment, replace those dependencies with isolated synthetic source fixtures rather than writing to live source tables. The "unknown or wrong-silo" case uses a nonexistent source UUID, not an Egyptian source read. Multi-client contention is not covered by this single-session suite.

Database installation order for a **new review environment only**: 01, 02, 03, 04. The current project already has the corresponding schema and seed. Public source tables and the exact registry business must exist; missing or ambiguous registry identity fails rather than selecting another subsidiary.

## Appendix C — Database checks executed

1. posting disabled by default.
2. balanced atomic posting.
3. idempotent retry returns original journal.
4. conflicting duplicate rejected.
5. unbalanced journal rejected without partial rows.
6. fractional cents rejected.
7. negative amounts rejected.
8. debit and credit on same line rejected.
9. zero-value line rejected.
10. single-line entry rejected.
11. invalid date rejected.
12. excluded source type rejected.
13. non-USD source invoice rejected.
14. pending bank source rejected.
15. unknown or wrong-silo source rejected.
16. posted journal immutable.
17. posted journal lines immutable.
18. posted journal deletion rejected.
19. appending to posted journal rejected.
20. posted account reclassification blocked.
21. posting audit append-only.
22. invoice payment clears receivable without duplicate revenue.
23. trial balance totals agree.
24. incorrect reversal rejected.
25. reversal is exact and retry-safe.
26. original and reversal both retained and net to zero.
27. reversing a reversal rejected.
28. closed period posting rejected.
29. US business binding immutable.
30. anonymous and browser roles denied; no direct service writes.
31. RLS enabled on every ClickBooks table.
32. bank-disabled response omits sensitive accounts and trial balance.
33. legacy US source digests unchanged.

## Appendix D — Security advisor and primary references

The security advisor returned seven INFO notices for the new tables with RLS enabled and no policies. This is deliberate: the private schema has no browser access, and reads go through a service-only RPC with a separately verified application permission boundary. Do not "fix" the notices by adding permissive policies.

Shared-project findings, not remediated in this US-only increment: 48 public tables with RLS disabled, 2 security-definer views, 46 mutable function search paths, 3 anon-executable and 3 authenticated-executable privileged functions, and disabled leaked-password protection. Counts are advisor findings, not proof of exploitability; investigate separately before a broader security sign-off. No claim is made that the whole hub is secure or ready for accounting cutover.

- [RLS enabled without policy — explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
- [Public RLS-disabled tables — remediation](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public)
- [Security-definer view — remediation](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view)
- [Mutable function search path — remediation](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable)
- [Anon-executable privileged functions](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)
- [Authenticated-executable privileged functions](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
- [Supabase password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
- [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [PostgreSQL 17 CREATE TRIGGER](https://www.postgresql.org/docs/17/sql-createtrigger.html)
- [PostgreSQL 17 explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html)

## Appendix E — Outside this increment

Historical transaction migration, live Wave/Plaid request validation, rule-engine UI, completed P&L/balance-sheet/cash-flow reporting screens, accountant-approved tax mappings, sales-tax calculation, filings, payroll, direct deposits, payable checks and money movement are not delivered as operational services here. There is no QuickBooks dependency. Existing Wave workflows continue until a separately reconciled and approved cutover.

Future step log template: date/version; authorized US scope; exact files and migrations; baseline and changed test results; source digests; deployment state; rollback point; reviewer findings; open production blockers. Update the handoff on each change rather than reusing old pass claims.
