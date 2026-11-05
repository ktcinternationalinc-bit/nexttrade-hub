# ClickBooks US — Full System Write-up

**Release:** Priorities 1–8 · **Date:** 2 November 2026 · **Scope:** KTC U.S. Accounting only

## Executive summary

ClickBooks is the proposed native accounting system for the KTC Hub. It is intended to replace the accounting role currently handled through Wave while preserving the existing U.S. Accounting records, bank feeds, invoice/payment relationships, and day-to-day KTC Hub workflows. It is not a replacement for the entire Hub, and it must never import Egyptian Sales, Treasury, Egypt banking, or other subsidiaries merely because a record is denominated in USD or has a similar field name.

The work through priorities 1–8 is now implemented at the database, API, source-code, and operator-control level. The ClickBooks private schema and all 21 recorded ClickBooks migrations are installed in the connected Supabase project. The Hub source package contains the U.S. ClickBooks views for core accounting, migration/rules, reports/tax, parallel/cutover, and operator permissions.

This is **not yet a live accounting cutover**. No real financial journals have been posted to ClickBooks, historical books are not certified, posting is disabled, no business rule is enabled, no bank-to-ledger mapping is approved, no shadow synchronization is active, and Wave remains writable and primary. The frontend source has not been deployed to the current Vercel production project.

## 1. System boundary and verified U.S. source

The ClickBooks book is fixed to:

- Supabase project: `rmwbcfulncgfandhlzvz`
- Schema: `clickbooks_us`
- Book code: `KTC_US`
- Currency: USD
- Verified Wave business: `KTC INTERNATIONAL ENTERPRISES LLC`
- Wave business ID: `QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk`

The U.S. Accounting source must be identified by the verified business binding. A currency, display name, or old/null business UUID is not sufficient company isolation.

Verified U.S. source state on 2 November 2026 at approximately 21:18 UTC:

| Dataset / relationship | Count |
|---|---:|
| USD accounting invoices | 1,366 |
| Invoice line items | 2,531 |
| Active payment rows | 163 |
| Bank transactions | 361 |
| Paid USD invoices with no active local payment-detail rows | 1,142 |
| Invoices with multiple payments | 38 |
| Bank deposits allocated across multiple invoices | 22 |
| Active payments missing a U.S. invoice | 0 |
| Active payments missing a bank transaction | 0 |

These source relationships are important. ClickBooks is designed to preserve invoice → payment → bank evidence rather than re-entering records or treating bank deposits as additional revenue. A deposit allocated across multiple invoices must hit cash once for the exact bank amount while retaining the separate invoice allocations.

## 2. Priority 1 — Source audit and ownership

Priority 1 established the authoritative U.S. source population and separated it from operational/Egyptian data. The audit identified U.S. `accounting_*` records, Plaid/bank transactions, Wave account/category mappings, and the Wave business registry. Treasury, the generic operational invoice table, Egypt bank tables, and Egyptian Sales were explicitly excluded as ClickBooks migration sources.

Important historical limitations remain: 1,142 paid U.S. invoices lack local detailed payment rows, even though their invoice status/paid totals exist. Those payments must not be synthesized or attached to bank transactions by guess. The practical migration path is likely a reconciled opening balance with detailed open receivables/payables, while preserving the old invoice records as historical source evidence.

## 3. Priority 2 — Chart of accounts and double-entry ledger

The private `clickbooks_us` ledger is installed. It includes:

- 176 proposed ledger accounts.
- 1,880 retained Wave source-account identifiers mapped to candidate ClickBooks accounts.
- Control accounts for receivables, payables, transfer clearing and other accounting controls.
- Integer-cent journal amounts.
- Atomic balanced posting.
- Unique source keys and idempotent retries.
- Immutable posted journals and journal lines.
- Exact linked reversals rather than destructive edits.
- Period/cutoff protections.
- U.S.-business and USD source guards.

The proposed account mappings are not accountant-approved merely because they exist. Most accounts remain marked for review. Real posting cannot be treated as production-ready until the chart and relevant mappings are reviewed.

## 4. Priority 3 — Migration and reconciliation engine

The migration engine supports two controlled strategies:

### Opening-balance migration

One reconciled opening journal establishes the ClickBooks ledger at an agreed cutoff. Detailed outstanding receivable/payable items are retained in the opening subledger. This is the most practical strategy when historical payment/journal detail is incomplete.

### Transaction-batch migration

Supported U.S. invoices, invoice payments and standalone reviewed bank transactions can be migrated in bounded source-linked batches. The engine rejects unsupported, incomplete, duplicate, cross-company, non-USD, pending or unreconciled source events.

Migration controls include:

- Immutable source snapshots and hashes.
- Idempotency keys.
- Independent expected account balances.
- Detailed opening AR/AP reconciliation.
- Account and bank mapping review gates.
- Source/economic-event duplicate checks.
- Approval fingerprints covering source, chart, mappings, ledger and locks.
- Separate approval and execution switches.
- Repeatable-read/serializable execution.
- Atomic import and linked batch reversal.

The earlier audit-only run `c5c27993-d696-4fbf-9ae5-360301df9844` is stale because source data changed after it was staged. It is evidence only and must not be used as the real migration.

## 5. Priority 4 — Accounting rules engine

The rules engine creates reviewable classifications for eligible U.S. bank transactions. It supports:

- Money-in / money-out direction.
- Literal case-insensitive merchant or description matching.
- Optional bank/source account restriction.
- Min/max amount boundaries.
- Effective dates.
- Explicit priorities.
- Percentage splits totaling exactly 10,000 basis points.
- Version history and stale-rule detection.
- Preview before save.
- Conflict detection when equal-priority rules match.
- Review-required tax tags.

Pending, already reviewed, already classified, split, linked, payment-matched and non-USD transactions are protected. Rules do not silently overwrite existing human work.

Rules can generate and approve ClickBooks proposals. Approval alone is not money movement and is not a tax filing. Approved proposals can only become ledger postings through the separately guarded ongoing-posting path after ClickBooks history and account mappings are certified.

## 6. Priority 5 — Financial and tax-reporting layer

The report layer is installed and derives financial statements only from **posted ClickBooks journals**. It does not fabricate a P&L from incomplete invoice totals.

Implemented report services:

- Profit & Loss.
- Balance Sheet.
- Trial Balance.
- General Ledger.
- Tax Summary.
- Cash-flow classification report.
- Bank Reconciliation workspace.
- Reporting-readiness status.

Account reporting settings support reviewed cash-flow classifications, tax category, tax-form line/reference, deductibility state and reviewer evidence.

Tax reporting is intentionally described as bookkeeping classification. It does **not** file returns, determine legal deductibility automatically, calculate every tax obligation, or send tax payments. `filingReady` remains false until historical books are certified and used income/expense accounts have reviewed tax mappings.

### Report permissions

- Full Dashboard permission: non-bank P&L, tax summary and redacted balance-sheet view.
- Banking Information permission: bank-sensitive balance-sheet totals, trial balance, general ledger, cash flow and bank reconciliation.
- Super admin: all report access.

A user without Banking Information permission does not receive hidden bank-sensitive rows or complete bank-sensitive totals from the report API.

## 7. Priority 6 — Native KTC Hub integration

The source package integrates ClickBooks inside the **existing U.S. Accounting tab**. It does not create a second stand-alone operational Hub.

Hub views now include:

- ClickBooks core.
- ClickBooks migration and rules workflow.
- ClickBooks Reports & Tax.
- ClickBooks Parallel & Cutover.
- ClickBooks operator permissions in Settings.

Server routes independently authenticate the signed-in identity and do not trust browser-supplied actor IDs, company IDs, or privilege flags. Financial data responses are `no-store`, and privileged database functions are exposed only through narrowly scoped service-role facades.

The current source package must be merged into the **current production repository**. It must not overwrite a newer production tree just because this package contains a full source snapshot.

## 8. Priority 7 — Parallel operation, ongoing posting and Wave cutover

Wave remains primary until ClickBooks is reconciled and proven in parallel.

### Ongoing shadow posting

After a real migration/cutoff, history certification, account review and bank mapping, the shadow engine can post supported new U.S. events into ClickBooks while Wave remains writable:

- Approved, supported new invoices: Debit AR / Credit reviewed sales-income account.
- Linked customer payments: Debit reviewed bank account / Credit AR.
- Approved rule-classified standalone bank transactions: bank side plus reviewed allocation accounts.

Safeguards include:

- Source-id idempotency.
- Exact invoice line-total equality.
- Payment allocation checks.
- Settled USD bank requirement.
- Reviewed bank-to-ledger mapping.
- Deposit allocation sum must equal the entire bank deposit.
- Opening-balance receivables can be cleared by later payments without recreating the old invoice as historical revenue.
- Payment postings cannot exceed the preserved opening receivable.

This design correctly handles the existing real-world pattern of a bank deposit split across more than one invoice.

### Parallel readiness

A cutover cannot be approved merely because a quiet date range has no transactions. Readiness requires:

- `parallel` phase.
- Shadow synchronization enabled.
- Historical books certified.
- Opening/cutoff basis established.
- Reviewed future-invoice income default.
- Every active bank account mapped to a reviewed ClickBooks bank account.
- A successful recent shadow run covering the end of the review period.
- No supported unposted source events in the reviewed period.
- No blocked source events requiring review.
- No posted entries using accounts still marked for review.
- Valid ledger/trial-balance state.
- Review window of 7–31 days ending on the proposed cutover day.

### Wave cutover

Cutover is not a browser button. A trusted operator stages and approves an immutable cutover review. A separate disabled-by-default execution gate is then enabled only for the controlled operation.

Execution changes only the U.S. Wave write/push flags. It does **not** disconnect the U.S. Plaid/bank feed. The exact pre-cutover Wave flags are stored so rollback can restore them.

If cutover is rolled back, Wave write flags return to their exact prior values, ClickBooks shadow execution is stopped, and the system enters `rollback_review`. ClickBooks journals are retained as accounting evidence rather than destructively erased.

## 9. Priority 8 — Permissions, security and activation controls

Four distinct concepts are intentionally separate:

1. Normal Accounting permissions: staff can perform normal invoices/bills/expense/payment work permitted by their existing role.
2. Full Dashboard: special visibility permission for the company-wide financial dashboard and non-bank reports.
3. Banking Information: separate special visibility permission for balances and bank-sensitive financial reports.
4. ClickBooks operator permissions: separate capabilities for rules, migration and cutover.

Super admin has all capabilities. A rules operator does not automatically get bank balances. A migration/cutover operator must also pass the protected dashboard/banking visibility requirements because those workflows reveal complete financial information.

Private ClickBooks schema status after P1–P8:

- Zero browser-callable ClickBooks database functions.
- Zero ClickBooks tables without RLS.
- Zero ClickBooks functions with mutable search paths.
- Zero service-role direct table INSERT/UPDATE/DELETE grants.
- Private RLS-with-no-policy advisor notices are intentional deny-by-default controls behind service-only facades.

The project still has unrelated pre-existing Supabase security/advisor findings in other public-schema Hub objects. This work does not claim to make the entire KTC Hub security-clean.

## 10. QA results

### Database QA

- Priority 1/2 ledger acceptance: 33 passed.
- Priority 3/4 migration/rules: 53 core + 5 source-backed checks passed.
- Priority 5 reporting: 8 passed.
- Priority 7 new invoice/payment shadow posting: 5 passed.
- Priority 7 opening-balance receivable payment path: 2 passed.
- Priority 7 cutover: 12 passed using the actual recent U.S. payment relationships, including a deposit split across two invoices.

All financial QA writes were executed in transactions ending `ROLLBACK`. They did not leave test journals, accounts, Wave flag changes, bank mappings, shadow runs or cutover runs in production.

### Application/API QA

Combined ClickBooks handler suite: **87/87 passed**:

- Core read layer.
- Migration/rules workbench.
- Rules scheduler.
- Reports.
- Cutover/shadow controls.
- Operator-permission handlers.

The existing KTC accounting/bank regression runner remains **121/122 required**. The one blocked test could not import `@supabase/supabase-js` because `npm ci` could not reach `registry.npmjs.org` (`EAI_AGAIN`) and left an incomplete dependency installation. The full Next.js build is therefore **not claimed as passed** in this environment.

This build/network gate must be rerun in the actual repository/CI environment before deployment.

## 11. Installed database migration ledger

The connected Supabase project currently records these ClickBooks migrations:

| Version | Migration |
|---|---|
| 20261102093306 | clickbooks_us_core_tables_v1 |
| 20261102093330 | clickbooks_us_posting_guards_v1 |
| 20261102093537 | clickbooks_us_source_audit_v1 |
| 20261102093732 | clickbooks_us_scope_and_read_facade_v1 |
| 20261102103809 | clickbooks_us_p34_workflow_storage_v1 |
| 20261102103836 | clickbooks_us_p34_source_snapshot_v1 |
| 20261102104015 | clickbooks_us_p34_rules_engine_v1 |
| 20261102104342 | clickbooks_us_p34_migration_validation_v1 |
| 20261102104359 | clickbooks_us_p34_migration_execution_v1 |
| 20261102104612 | clickbooks_us_p34_workbench_facades_v1 |
| 20261102105249 | clickbooks_us_p34_validation_alias_fix_v1 |
| 20261102105553 | clickbooks_us_p34_source_and_rule_hardening_v1 |
| 20261102205803 | clickbooks_us_p58_reporting_v1 |
| 20261102205838 | clickbooks_us_p58_reporting_fix_v1 |
| 20261102210039 | clickbooks_us_p58_parallel_cutover_v1 |
| 20261102210135 | clickbooks_us_p58_operator_permissions_v1 |
| 20261102210435 | clickbooks_us_p58_cutover_fingerprint_fix_v1 |
| 20261102210514 | clickbooks_us_p58_operator_grants_read_v1 |
| 20261102210814 | clickbooks_us_p58_shadow_posting_hardening_v1 |
| 20261102210945 | clickbooks_us_p58_cutover_readiness_hardening_v1 |
| 20261102211650 | clickbooks_us_p58_fk_indexes_v1 |

These migrations are **already installed** in the connected project. Do not blindly replay reproduction SQL there. The SQL files are included for code review, source-control reconciliation and fresh compatible staging environments.

## 12. Current live state — no cutover has happened

After all QA:

- ClickBooks journals: 0.
- ClickBooks journal lines: 0.
- Posting enabled: false.
- Historical data ready: false.
- Opening cutoff: null.
- Enabled ClickBooks business rules: none.
- Reviewed live bank-ledger mappings: none.
- Retained shadow runs: 0.
- Retained cutover runs: 0.
- Posting default: not reviewed / not selected.
- Cutover phase: `wave_primary`.
- Shadow sync: disabled.
- Cutover execution: disabled.
- U.S. Wave writes: enabled.
- U.S. Wave invoice push: enabled.
- U.S. Wave payment push: enabled.
- U.S. Wave customer push: enabled.

The connected U.S. bank feed remains separate and was not disabled by this development work.

## 13. Exact path to production

### Phase A — merge and technical deployment

1. Obtain the current production repository/commit.
2. Preserve the current Vercel deployment as a rollback target.
3. Take a Supabase/database backup and test restore.
4. Merge the ClickBooks source changes into the current repository; do not overwrite newer unrelated work.
5. Reconcile the repository migration history with the 21 already-installed remote migrations.
6. Review and deploy the existing protected bank/dashboard permission prerequisite (`financial_visibility_permissions` / `bank_visibility_profile_for_identity`) together with its matching source. This prerequisite is still absent in the inspected database.
7. Configure actual Supabase Auth UUIDs in the server-only super-admin allowlist. Do not use guessed public-user IDs or editable role strings.
8. Run `npm ci`, all ClickBooks tests, full existing regression, and `npm run build` in a networked CI/developer environment.
9. Deploy a protected Vercel preview with all financial-write/cutover flags off.
10. Browser-test super admin, dashboard-only, banking-only, rules-only, migration/cutover operator, ordinary accounting staff, unauthorized and signed-out sessions.

### Phase B — historical migration and reconciliation

1. Create a **new** source snapshot; the prior one is stale.
2. Review/approve the chart of accounts and the accounts actually required by the migration.
3. Review every active bank-account mapping.
4. Choose the migration strategy and cutoff.
5. Obtain independent trial balance, bank statements, open AR/AP and other accountant evidence.
6. Because historical payment detail is incomplete, strongly consider an opening-balance strategy unless complete Wave GL/payment history is recovered.
7. Preserve all old invoices and their existing source/payment/bank relationships for user-visible history even when the opening-balance ledger strategy is used.
8. Validate the manifest against independent account balances.
9. Approve and commit through trusted operator scripts only.
10. Verify trial balance, open AR/AP, bank balances, sample invoice/payment traces and duplicate-event checks.
11. Certify historical books only after reconciliation evidence is reviewed.

### Phase C — parallel run

1. Select and review the future-invoice income posting account.
2. Confirm every active bank account has a reviewed ClickBooks ledger mapping.
3. Enable `parallel` phase and shadow synchronization.
4. Optionally deploy the 15-minute shadow job and proposal-only rules job after reviewing the `vercel.json` diff and route authentication.
5. Keep Wave writable.
6. Run ClickBooks in parallel for a minimum 7-day review window.
7. Reconcile P&L, balance sheet, trial balance, general ledger, cash flow, bank reconciliation and source-event counts.
8. Resolve every blocked/unposted source event.

### Phase D — Wave write cutover

1. Stage an immutable cutover run covering the final 7–31 day window ending that day.
2. Confirm readiness is green and retain independent evidence.
3. Trusted operator approves the run.
4. Trusted operator enables the separate execution gate and executes the exact approved hash.
5. Verify Wave U.S. writes/pushes are disabled and bank feeds remain connected.
6. Monitor ClickBooks and bank feeds.
7. If necessary, run the trusted rollback script, which restores the exact saved Wave write flags and moves the system to rollback review.

## 14. What is still outside P1–P8

Completing P1–P8 does not mean every QuickBooks product feature exists. Remaining separate work includes, where desired:

- Production deployment and browser acceptance.
- Real historical migration/reconciliation and parallel-run sign-off.
- Complete Wave GL/payment-history recovery if the user wants transaction-level historical financial statements instead of a cutoff opening balance.
- Full accounts-payable/vendor-bill workflow if the current Hub source lacks sufficient bill detail.
- Credit notes, refunds, complex FX and fixed-asset/depreciation workflows beyond mapped source data.
- Payroll provider integration, direct deposit and payroll filings.
- Federal/state/local tax filing and tax-payment provider integration.
- Check issuance/payment rails.
- Accountant-approved tax chart and year-end close policies.

## 15. Review request for Claude / another engineer

Review the source and SQL, not only this summary. Prioritize:

1. U.S. company isolation and exclusion of Egypt/Treasury/Sales.
2. Opening-balance strategy and preservation of historical invoice/payment/bank relationships.
3. Deposit splits across invoices and prevention of duplicate cash/revenue.
4. Posting idempotency, reversal behavior and concurrency.
5. Shadow-posting eligibility and opening-AR payment path.
6. Cutover fingerprint, readiness window, Wave disable/rollback and unchanged bank feed.
7. Report date filtering, bank redaction and tax-readiness semantics.
8. Dashboard/banking/operator permission boundaries.
9. Supabase service-role/database grants and security-definer facade scope.
10. Current-repository merge, full build and signed-in browser behavior.

Do not relax a financial guard simply to make a test pass. Distinguish source-data gaps from software bugs, and record every subsequent migration/source change in the same release ledger.
