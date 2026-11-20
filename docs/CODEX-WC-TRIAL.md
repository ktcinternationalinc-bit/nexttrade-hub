# WC Local Trial - 20 November 2026

Owner: Codex. Base: f6a4662ec1e0e046898282239b06a5042694db28 (WB).
Branch: codex/bank-search-pending-trial.
Location: D:/GITHUB/nextrade-hubA/output/codex-bank-trial.
Status: implemented and built locally, uncommitted, NOT pushed or deployed. WC SQL is authored and tested in isolated Postgres ONLY; it has NOT been installed on live. No live data changes.

## Included

## Priority Queue - Max's Direction, 20 November 2026

1. LOCAL IMPLEMENTATION COMPLETE, LIVE VERIFICATION BLOCKED: pending-to-posted reconciliation now has a preview and confirmed repair endpoint/UI for existing stuck records, plus an atomic SQL repair retaining linked pending UUIDs. Real Postgres and browser/API/DB tests pass. The affected live records are not yet verified or repaired: available local database configuration points at placeholder.supabase.co. Requires the approved WC database installation and application release; no live repair without showing the proposed changes first.
2. NEXT: split deposits and returned checks. Implement the matching-exclusion requirements below in a separate change. A hypothetical $10,000 deposit with a $2,000 returned component has $8,000 eligible, less valid existing allocations.
3. NEXT: RTM and NextTrade consistency. Fix outdated company-marking popup language and verify the underlying report consumers: unused funds are held, not an automatic internal fee; only explicit services rendered is an internal fee. Keep the separate full-transfer tax presentation requirement distinct. Do not claim the older reporting paths already comply.
4. READY FOR INTEGRATION REVIEW: search correction is implemented and locally built/tested, but not deployed. Recheck it in the final candidate rather than restarting it or combining untested financial changes with it.

Claude monitoring resumes at 11:50 AM Eastern today. Before any release: reconcile current upstream and ownership notes, communicate exact files/commit/version/tests and remaining limits in the shared feedback, verify the release candidate, and obtain the required authorization. No deployment, migration, or live financial-data change has occurred in this trial. Do not treat a shared-file write as proof another session read it.

## Implemented Trial Scope

- All Transactions: case-insensitive partial search retained, optional Whole words checkbox, description highlights and full description while searching. NSF in partial mode intentionally matches traNSFer; Whole words excludes it.
- Pending/archived old-account copies cannot suppress posted rows during import deduplication. Existing bank IDs and explicit pending replacement IDs reach ingestion, so final bank fields can update.
- Pending retirement refuses a missing, unreadable, still-pending or archived posted survivor. Budget/cap exhaustion reports an incomplete pass.
- Settlement problems persist as partial connection sync, propagate through scheduled results/logs and manual notices, and show a warning in All Transactions scoped to connections represented by authorized visible rows.
- Existing wire matcher, payment creation and Wave pushes are unchanged. New WC SQL preserves the original UUID and its payment links when an exact bank-confirmed, same-money replacement would otherwise be blocked by TU; conflicts and closed periods still refuse. It archives the unworked posted copy and preserves both original snapshots. Tombstone handling permits later posted refreshes without recreating the old pending identity.
- Normal sync also checks stored posted replacement references, including old records outside the current pull window. No date/amount/name-only automatic pairing.
- All Transactions has a super-admin-only Review pending records preview. Explicitly selected repairs are rechecked on the server and in SQL; unknown, changed or ambiguous matches remain unresolved. A missing database update is reported, never bypassed.

## Verification

- Latest npm run build: PASS, dummy database values only; 117 static pages and /api/plaid/pending-repair present. Existing metadata/Browserslist/dynamic-route warnings remain.
- New WC helper suite: 31 passed. New WC actual Plaid route suite: 7 passed (mock bank/auth/database/downstream matching).
- Existing TU pending suite: 17 passed. QD, QS and RC assertions updated for extracted helper implementations, retaining their behavioral expectations.
- Full suite after pending repair: WC 244/263 passed, 19 failures; independently executed unchanged WB 241/260, the EXACT SAME 19 failing test names (Compare-Object returned no differences). Full suite is not globally green. Latest log output/wc-pending-regression.txt.
- New actual pending-repair route/helper checks: 14 passed. Real Postgres pending-identity SQL: 23 passed (rerunnable install, bill/invoice links, repeated sync, tombstones, changed amount, cross-account rejection, closed periods, two worked copies, permission denial, transactional rollback).
- Browser -> actual PendingBankRepair component -> actual route -> isolated Postgres SQL: PASS. Read-only preview writes no audit rows; confirming one repair retains one original bill payment; unresolved hold stays disabled; refresh removes the repaired candidate. Desktop/mobile screenshots in output/wc-pending-browser. External browser requests blocked; auth is a fixture super admin, not a real sign-in test.
- Actual AllTransactionsTab browser harness: partial/whole-word search, hidden description, highlights, clearing, zero results, account filter, desktop and mobile. Synthetic rows only; external page requests blocked. Output: output/wc-browser/desktop.png and mobile.png.
- Build/log evidence: output/wc-build.txt, wc-regression-final.txt, wb-baseline-regression.txt. Generated visibility-test stubs restored to their original contents after running the suite.
- Final pending-repair build: output/wc-pending-build.txt, exit 0, BUILD_ID 9zRD00lZ6w-RHNj40Cd-z. SQL install is wrapped in one transaction and verifies SO/TU dependencies before installing. Re-ran all 23 SQL checks after this packaging change.
- Local interactive pending-repair preview: http://127.0.0.1:60137, hidden process 30800, synthetic records and isolated in-memory Postgres ONLY. It can demonstrate confirming one repair without touching real money. Source harness __tests__/wc-pending-browser.cjs --serve; output/wc-pending-preview.log and wc-pending-preview-error.log.
- Claude communication is still paused until 11:50 AM Eastern per Max. The completed pending-repair build receipt is recorded here for the next authorized handoff; it has NOT yet been delivered to or acknowledged by Claude.

## Not Claimed

- No live Plaid/DB investigation or repair of Max's specific screenshot rows.
- The new different-ID repair is tested only with isolated records, not Max's live screenshot rows. Rows with no authoritative replacement, changed amounts, work on both copies or closed dates are not force-posted. The old pending UUID is retained when needed; no external payment is created, reversed or migrated.
- No new automatic invoice-matching engine. Existing posted money-out wire matcher is invoked unchanged; unmatched receipts remain available for normal matching.
- No live SQL execution, deployment, release authorization or Claude acknowledgement. The available local .env.local files use placeholder database configuration, so attempted read-only diagnosis did not reach a real Hub database. No real bank API was called.

## Next Change Owned By Codex

Deposit breakdown and returned checks, requested by Max; separate from WC. Not implemented yet. Do not assign this back to Claude implicitly.

Example amounts are hypothetical: one $10,000 deposit contains several checks/categories. Preserve the parent bank transaction and list the component amounts, check references, customers/invoices and categories; splits must sum to the original amount. Mark only the affected check returned, link its actual bank return debit, and reopen only that payment's invoice allocation. Keep bank fees separate. Do not relabel the entire deposit as returned, fabricate a bank movement, duplicate income, or silently delete a Wave-synced payment. Inspect the existing Bank Review save_splits/payment-reversal workflows before implementing. Existing code has save_splits, but its exact fit for partial check returns is not verified.

### Matching Exclusion Clarification From Max

Next item only; no implementation or live change authorized by this clarification. All amounts below are hypothetical.

- From a $10,000 parent deposit, mark a $2,000 component as Returned check and the remaining $8,000 as Customer payment (not another $10,000). Allow other component categories as needed; all components must sum to the original deposit.
- Show original deposit, each component's amount/category/check/customer/invoice, returned amount, eligible customer-payment amount, already matched amount, and remaining available to match.
- The returned component is excluded from matching immediately, even when the separate bank return debit has not yet synced. Missing bank confirmation must remain visibly unresolved, not fabricated.
- Matching availability is eligible customer-payment components minus their active allocations, never the original parent amount minus allocations alone. Enforce this in every matching API as well as Bank and All Transactions UI; repeated actions must not restore the excluded amount.
- If the returned component was already matched, explicitly reverse only its allocation and reopen the affected invoice balance, with history and any required external-payment correction. Preserve other checks' matches. Do not silently leave $10,000 matched against $8,000 eligible.
- When the actual return debit arrives, link it to this returned component without a second invoice reversal or another deduction from matching availability. Preserve both original bank movements and keep return fees separate.
- Acceptance examples: unmatched $10,000 with $2,000 returned permits at most $8,000 of customer matching; $5,000 already matched to non-returned checks leaves $3,000; a fully matched deposit with one $2,000 returned check leaves $8,000 valid matches and reopens only that check's $2,000 invoice allocation.

## Integration And Release Protocol

1. Shared VERSION-LETTERS.md is the ownership/version record; shared warehouse CODEX_QA_FEEDBACK.md holds this build's handoff. Claim one release owner and identify overlapping files before integration; this is advisory coordination, not a technical lock.
2. On actual release authorization, re-read all current handoffs and fetch remote main. Verify the production deployment commit separately; local HEAD is not proof of production. Reconcile newer approved work into THIS branch, never switch/reset another session's worktree.
3. Retest the exact candidate commit. Never force-push. If remote main advances, stop the push attempt, integrate and retest; do not discard the intervening changes. Keep all release-note entries.
4. Separate application release from database updates. WC now requires sql/v55-83-WC-pending-identity.sql AFTER the existing SO and TU scripts. Installation and live repairs require their own approval. Validate installed functions and preview real candidates before any repair. SQL rollback cannot simply restore the old tombstone function after repairs because posted refreshes now rely on the identity-repair audit; retain that compatibility logic when rolling back application code.
5. Verify the deployed commit, badge and targeted behavior, then append a release receipt: owner, previous/new production commit, version, affected files/features, tests, SQL status, rollback reference and known limitations.
6. Other sessions must read the receipt and reconcile their branch with the new main before releasing. For overlapping work, request explicit acknowledgement. A file write is NOT proof that an idle Claude session received/read the message. Do not claim all sessions were notified successfully without evidence.
## Release Authorization Update - 20 Nov 2026

Max explicitly authorized Codex to commit and deploy WC and resume communicating with Claude now. This supersedes the earlier local-only and 11:50 communication restrictions recorded above. Authenticated Vercel inspection verified production deployment dpl_CdbKxFF9oRavKsc7jeMuQgvyzLNR at f6a4662; GitHub main matches. Relevant Claude worktrees (simple-fixes and companies) are clean. The release-in-progress notice was appended to shared CODEX_QA_FEEDBACK.md and VERSION-LETTERS.md; no acknowledgement from sleeping Claude is claimed.

WC's missing-function-only fallback preserves existing TU settlement during staged database installation. A WC accounting refusal cannot fall back around its protections. Two additional route/helper tests pass (16 total). The application release does not install SQL or manually repair live transactions. The new linked-record repair requires the separately installed WC SQL. Final release evidence will be recorded in a separate release receipt.
