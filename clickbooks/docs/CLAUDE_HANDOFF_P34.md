# ClickBooks US — Claude review handoff, priorities 3 and 4

**Release:** P3/P4 v1 · **Date:** 2 November 2026 · **Target:** existing KTC Hub U.S. Accounting tab.

## Executive status

This release is more than a design: eight additive database migrations have been installed in the connected Supabase project, a U.S.-only review snapshot has been retained, and new Hub workflow screens/API handlers are included in the code package. It is **not** a live accounting cutover. The new frontend is not deployed, the actual financial ledger is still empty, posting is disabled, no business rules are enabled and no new cron is active.

The existing Wave/Plaid routes and U.S. source records were not redirected or rewritten. Egyptian Sales, Treasury, invoices and other subsidiary data are excluded. Review these additions against the current repository; the full ZIP is a reference snapshot, not a safe replacement for a newer production tree.

Start with `DEPLOYMENT_RUNBOOK_P34.md`, `release-manifest.json` and `qa/p34/verified-results.json`. The prior `CLAUDE_HANDOFF.md` is retained as the P1/P2 historical record; this document supersedes its release-status statements for P3/P4.

## 1. Exact scope and installed foundation

Supabase project: `rmwbcfulncgfandhlzvz`. Schema: `clickbooks_us`. Book: `KTC_US`. Currency: USD. Hard source binding is the verified Wave business `QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk` (KTC INTERNATIONAL ENTERPRISES LLC).

Do not scope by “USD” alone or by the older shared/null `business_id`. Do not import `public.invoices`, `treasury`, `expense_rules` or Egyptian bank tables into this ledger merely because a similarly named column exists. The relevant invoices are `public.accounting_invoices` joined to their U.S.-verified parents, payments and items.

P1/P2 supplied 176 proposed accounts and 1,880 source-ID mappings, protected balanced posting, immutable journals, linked reversals, period locks, read facade and source audit. None of those proposed mappings is a substitute for an accountant's review before real posting.

## 2. Priority 3: migration tools

### Source evidence and duplicate controls

`source_snapshot(cutoff)` reads only the verified U.S. accounting population and stores a bounded set of business fields, not provider access tokens or raw provider payloads. Its immutable snapshot, request UUID and hash support reproducible review. Reusing the same request UUID with different cutoff/strategy is rejected.

Invoice item rows in the existing data have null child `wave_business_id` values. The corrected query accepts those rows **only through an already verified U.S. parent invoice**. A conflicting child tag is excluded. This prevents both silently empty invoices and cross-company currency-based inference.

The report checks duplicate external IDs, possible duplicate bank events, non-USD invoices, missing line items, incomplete payment detail, pending transactions, unapproved invoices and bank records already representing invoice payments. Potential duplicates are held for review, never deleted automatically. Current invoice paid/balance fields are explicitly not represented as historical as-of balances.

The retained review-only run is `c5c27993-d696-4fbf-9ae5-360301df9844`, audit cutoff 2026-11-02, `opening_balance`, state `staged`; there is no approved manifest. Its cutoff is not an approved production cutover date.

### Manifests, validation and posting boundary

Two strategies are supported: a reconciled opening-balance entry in an empty ledger, or supported source-linked transaction batches of up to 200 journals. The manifest carries precise integer-cent lines, independent expected trial-balance totals, supporting evidence and, for opening balances, detailed open AR/AP items.

Validation checks reviewed active accounts, exact debit/credit equality, source ownership, source and economic-event duplication, invoice detail and AR controls, invoice-payment bank/AR controls, bank mappings, source hashes, period locks and all-account reconciliation. Bank transactions already linked to payments are evidence, not a second revenue event. Unsupported or incomplete records are held, not repaired by guessing.

A trusted database operator approves an exact validated plan. Its fingerprint covers the snapshot, manifest, accounts, bank mapping, ledger and locks. Execution requires repeatable-read/serializable isolation, row locks, a matching approval hash and two disabled-by-default switches. An import is atomic and retry-safe. The supplied operator script relocks both switches before committing. An opening cutoff prevents re-importing earlier events.

Reversal creates linked reversing journals, retains the original evidence and relocks posting. Later independent postings prevent automatic batch reversal and require a dependency-aware unwind. Historical completeness remains false; successfully importing one batch is not evidence that the books are complete.

### Explicit limitations

This is not a general import of every historical Wave journal type. Complete GL/payment-history retrieval, full bill/credit-note/FX migration and ongoing automated financial posting are not implemented here. Open payable detail requires independently supported references; no supplier bills were invented. Current source gaps remain review blockers. Accountant-supplied controls must be independent evidence, not merely totals calculated from the same proposed journal plan.

## 3. Priority 4: rule engine and review workflow

Rules support literal case-insensitive description/merchant matching, direction, an optional provider account, amount ranges, effective dates, priority, enable/disable and version history. Advanced definitions support multiple ledger allocations totaling 10,000 basis points and tax-review tags. Splits preserve every cent by assigning a deterministic remainder.

Only settled, unreviewed, unclassified, unlinked USD bank transactions enter automatic proposal staging. Existing manual classifications, invoice-payment matches and splits are protected. Lower priority numbers win; ties at the highest matching priority become explicit conflicts. A preview writes nothing. Staging is idempotent and creates ClickBooks proposals, not ledger entries.

Approval validates the current source hash, winning rule/revision and reviewed target accounts. Changed sources or rules invalidate proposals. Repeated approval still checks freshness. Disabling/editing rules supersedes stale classifications when staging next runs. Source deletion is shown as stale in readback and rejected on approval; the stager currently iterates existing rows rather than proactively sweeping deleted-source proposals.

Categorization approval does not change the bank transaction, Wave category, invoice payment or ledger. `transfer_review` and `invoice_match_review` are review flags, not completed transfers or payment matching. Tax tags are classification metadata requiring review, not tax deductibility decisions, rate calculations or filings. The optional scheduled job only stages proposals. Auto-posting and a financial consumer of approved proposals remain separate integration work.

## 4. Hub API and permissions

The new Workflow tab is located inside the Accounting component and fixed to KTC_US. A category-rule operator can access individual transaction suggestions without full-dashboard or bank-balance access. Migration viewing includes complete snapshots and reconciliation, so it requires all three explicit non-super grants: migration management, full dashboard and bank balances. The verified super-admin allowlist remains authoritative and has all capabilities.

New HTTP routes:

- `/api/accounting/clickbooks-us/migration` — review reads, create snapshot, save manifest, validate.
- `/api/accounting/clickbooks-us/rules` — rule preview/versioned save, proposal staging and decisions.
- `/api/accounting/clickbooks-us/rules-job` — secret-authenticated proposal-only scheduler, disabled by default.

The handler independently authenticates the signed-in identity and rejects client-supplied actor/company identifiers, unsupported actions, cross-site writes, oversized bodies and invalid fields. Responses are no-store and errors are sanitized. No HTTP operation exists for migration approval/commit/reversal, granting privileges, enabling financial posting or switching off Wave.

All private tables have RLS and denied browser/service direct writes. Public workflow facades are service-role-only and rely on the verified server permission boundary; service credentials must never be public. Internal functions have fixed search paths. The source prerequisite `sql/bank-balance-visibility.sql` is **not installed** in the inspected live database and changes existing security privileges; review and deploy it with its matching source, not as an isolated blind patch. Normal user identity and permissions fail closed until this dependency is satisfied.

## 5. Exact change inventory

### Eight installed SQL changes

| Version | Purpose |
|---|---|
| 20261102103809 | Private workflow storage, grants, runs, proposals and audit events |
| 20261102103836 | Fixed-U.S. source snapshot, issue report and immutable evidence |
| 20261102104015 | Rule validation, matching, preview, staging and decisions |
| 20261102104342 | Bank mapping, manifest/fingerprint and reconciliation validation |
| 20261102104359 | Approval, atomic import, linked reversal and opening cutoff |
| 20261102104612 | Service-only workflow facades and proposal job facade |
| 20261102105249 | Corrected validator SQL alias ambiguity discovered by QA |
| 20261102105553 | Parent-based line-item scope and additional stale/null safeguards |

Reproduction SQL is `p34/05..12`. The real remote migration names and hashes are in the manifest. These files are not instructions to replay already installed changes. A fresh staging reproduction needs the compatible Hub schema and P1/P2 first.

### Application and operator files

`src/lib/clickbooks-us-workbench.js` implements access/command boundaries; `clickbooks-us-rules-job.js` guards the scheduler. `src/components/ClickBooksUSWorkflows.jsx` supplies migration and rule screens. `AccountingTab.jsx` is the only changed pre-existing application file in this increment. The three new API routes wrap the handlers.

`deploy/` contains preflight, environment flags, explicit account/bank-map review, operator grants, approval/import/reversal `.psql` scripts, a guarded local cron-config merge utility and the Accounting-tab patch. These deployment helpers are delivered, **not executed against production**. They use symbolic, verified identifiers and a secure `ktc_us` connection-service configuration; never commit credentials.

No application dependency versions, package lock, existing Wave/Plaid routes, existing cron entries or Egyptian modules were changed by P3/P4.

## 6. QA evidence and unresolved gates

**58 database checks passed:** 53 main assertions plus five source-backed transaction validation assertions. All QA writes, temporary accounts, synthetic entries, grants/switch changes and rule proposals were rolled back. Tests exercised precision, scope, input rejection, exact splits, priority conflicts, stale edits, source/account guards, idempotency, balanced/reconciled opening import, exact reversal, cutoff protection, service/browser privileges and source preservation. Source-backed approved unpaid invoices and reviewed standalone bank drafts validated without being posted.

**62 JavaScript handler tests passed:** 47 new workflow/scheduler checks and 15 prior core read checks. JSX syntax transpilation passed for both changed components. That is not a complete build or signed-in browser test.

The existing regression runner remains **121/122 required tests**. `test-v55-83-is-unmatch-and-plaid-scope.js` is blocked by an unavailable Supabase JS dependency in the authoring environment; one unrelated known-stale case is excluded by the existing runner. The full build was blocked before compilation by `next: not found`. Do not mark the release launch-clean until locked dependencies are installed and these gates pass in the actual repository.

QA found and corrected a real SQL alias ambiguity in reconciliation and the line-item child-scope assumption. Corrective migrations are part of the ordered release. Snapshot/legacy source digest comparisons showed no changes to U.S. invoices, payments, bank records or Wave category records during these tests.

The scoped security check found zero ClickBooks tables without RLS, zero browser-executable ClickBooks functions and zero functions without a fixed search path. Private RLS-with-no-policy notices are intentional deny-by-default. Existing unrelated public-schema warnings/errors remain; no claim is made that the whole Hub is security-clean.

## 7. Deployment and financial readiness are separate

The launch sequence is: current-source merge and backup; verify installed migration history; install/review identity and visibility prerequisites; verify super-admin and staff grants; locked dependency install and full build/regressions; protected preview and signed-in browser QA; activate review/staging UI; optionally enable proposal-only scheduling; independently reconcile and approve the chosen migration; perform controlled import; verify balances and evidence; only later activate ongoing accounting and retire Wave after parallel reconciliation.

Vercel inspection still returned 403 for the existing KTC team. The backend SQL can be installed while the frontend remains unpublished; those are separate facts. Authorization, a successful production deployment and browser acceptance still need evidence. The current frontend source must be merged, not pasted over a newer live revision.

The live database remains at zero financial journals, `posting_enabled=false`, `migration_execution_enabled=false`, `historical_data_ready=false`. No enabled business rules or new live scheduler were created. One audit-only staged snapshot was deliberately retained. See the latest preflight result before relying on these counts later.

## 8. Questions for Claude's review

Review the deployment identity boundary and the exact source merge first. Challenge cross-company scoping, payment-vs-bank deduplication, stale approvals, concurrent writes and RLS/service-role boundaries. Review the exact opening-balance/subledger design with the accountant; extend source-backed transaction fixtures for partial/over-payments, reversals, refunds and complete historical payment sequences before declaring full transaction-history migration production-ready.

Confirm that missing paid-history data is recovered or replaced by a reconciled opening-balance strategy rather than synthesized. Inspect rule-proposal consumers: this release stores approved classifications but does not automatically post them. Complete that financial integration separately with idempotent events, permission tests and balanced journal assertions.

Do not relax safeguards to obtain a green screen. Return findings and proposed changes against the supplied files and version IDs; keep every subsequent SQL/source change in the same release register and repeat the relevant QA before activation.
