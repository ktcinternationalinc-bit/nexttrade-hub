# Wave <-> Hub Categorization Think Tank

Date: 2026-06-28

Status: **DECIDED — Lane B accepted (live proof below).** Claude (dev) builds Lane B; Codex (QA) verifies the acceptance tests.

## ✅ PROOF RESULT (Claude, dev — live introspection 2026-06-28)
Re-ran `scripts/introspect-wave-read-update.mjs` + a direct mutation grep against the live Wave token:
- **42 total mutations.** Transaction/money mutations = **`moneyTransactionCreate`, `moneyTransactionsCreate` ONLY.**
- **Any transaction update / patch / categorize / delete mutation? → NONE.**
- `Transaction` object exposes only `id`; `Business` / `Account` have no transactions connection.
**Conclusion: Lane A (in-place update of an existing Wave transaction) is impossible on the public API → we build Lane B (create-only).** Codex: this is the proof required at "What We Must Confirm" — please verify + sign off.

## Joint Decision Memo For Claude + Codex

Decision: **Claude should build; Codex should QA.**

Best practical path with no more delay:

1. Claude performs one fast live confirmation pass against Wave's schema:
   - Search for public transaction update/categorize mutations.
   - Specifically confirm whether any supported public mutation exists for updating the category on an existing Wave-imported bank transaction.
   - Time-box: this is a proof step, not a research project. If the mutation is not present, proceed with Lane B below.

2. If a public update/categorize mutation exists, Claude builds Lane A:
   - Historical Wave categories import to Hub.
   - Hub category save persists locally.
   - Hub push updates the existing Wave transaction in place.
   - Codex tests import, save, update, refresh, and live proof.

3. If no public update/categorize mutation exists, Claude builds Lane B immediately:
   - Historical Wave categories import to Hub from Wave export.
   - Hub category save persists locally and marks the row pending Wave sync.
   - Hub push sends the category to Wave through `moneyTransactionCreate`.
   - No feed-owner setting blocks this push.
   - Already-pushed rows can be re-pushed when Max changes the category in Hub.
   - The Sync Log must clearly show whether Wave accepted the push and which Wave id was returned.

Codex's recommendation: **Proceed with Lane B unless Claude proves Lane A exists.**

Why this is the best practical path:

- It satisfies Max's operational requirement: category changes made in Hub stay in Hub and are sent to Wave.
- It removes the current dead-end where feed-owner duplicate logic blocks the user.
- It keeps invoice payments separate from non-invoice bank categories.
- It is honest about Wave's public API: if Wave cannot update an existing feed transaction, we still send the Hub category to Wave using the supported create path instead of doing nothing.
- It can be tested quickly and visibly.

Do not let the old duplicate-prevention architecture overrule the user's stated requirement. The new requirement is: **send the Hub category action to Wave and keep the Hub row correct.**

## Roles

- Developer: Claude.
- QA / BA / design challenge: Codex.
- Rule: Claude does not build and Codex does not continue patching until the requirements, chosen design lane, and proof plan below are accepted.

## Shared Discussion Location And Agreement Rule

This file is the shared discussion place for the Wave/Hub category decision:

`D:\GITHUB\nexttrade-hub\WAVE_REQUIREMENTS_AND_DESIGN.md`

Claude and Codex must both use this same document as the decision source before any further source-code changes.

Required handshake before code:

1. Claude reads this document.
2. Claude writes his agreement, disagreement, or proposed alternative in `CLAUDE_HANDOFF.md`.
3. Codex reads Claude's response and either:
   - accepts the agreed lane and QA plan, or
   - writes a concrete objection in `CODEX_QA_FEEDBACK.md`.
4. Only after that handshake may Claude continue source implementation.

If Claude changes source before this handshake, Codex should mark it FAIL / not approved, even if the code looks useful.

## Max's Business Requirement, Restated Plainly

1. Historical Wave categorizations must show in the Hub.
   - If a bank transaction was categorized in Wave before, the Hub must show that category.
   - The Hub must not leave historical Wave work invisible or stale.

2. Hub category changes must persist in the Hub.
   - If Max changes a transaction category in the Hub, that selected category must remain on the Hub row after refresh.
   - The Hub must not revert to blank, stale, or previous category state.

3. Hub category changes must transfer to Wave.
   - If Max changes a transaction category in the Hub, Wave must receive that category action.
   - The Hub must not block the action because a feed-owner setting is missing.

4. The UI must show the real state.
   - No misleading "blocked" if the user action is allowed.
   - No fake "synced" if Wave was not actually updated.
   - No hiding failed pushes in old sync logs.

5. Invoice payments are separate from non-invoice bank categorization.
   - Deposit-to-invoice links must use the invoice payment path.
   - Non-invoice expenses/income must use the bank transaction category path.
   - The CSV import must not turn invoice/payment rows into expense categories.

## What We Must Confirm Before Coding

We need one hard answer before design is final:

Can Wave's current public API update or categorize an existing bank/feed transaction that Wave already imported?

Current evidence says probably no:

- Official Wave API Reference lists `moneyTransactionCreate` and `moneyTransactionsCreate`.
- It lists invoice/payment patch/delete APIs, but no public `moneyTransactionPatch`, `moneyTransactionUpdate`, or category-update mutation.
- The public `Transaction` object exposes only `id`, so it does not appear to provide a full read/update transaction surface.
- Wave distinguishes `PUBLIC`, `INTERNAL`, `STAFF`, and partner-only schemas; if a tool "updates categories" inside Wave, it may be using a private/internal surface or Wave UI automation, not the public API.

Confirmation required:

- Claude must run or re-run a live schema introspection against the active Wave token and save the exact result.
- Claude must grep the live schema for transaction read/update/categorize mutations.
- Codex must verify that proof before accepting any design that claims true in-place Wave category updates.

## Design Decision Fork

### Lane A - True Update, If Wave Supports It

Use this only if live proof shows Wave exposes a supported public mutation to update/categorize an existing transaction.

Behavior:

- Historical Wave category import refreshes Hub.
- Hub category save updates Hub immediately.
- Hub push calls Wave update/categorize mutation for the existing Wave transaction.
- Hub stores Wave confirmation and sync status.

Acceptance:

- Change category in Hub.
- Refresh Hub: new category remains.
- Refresh Wave: the same existing Wave transaction shows the new category.
- No duplicate Wave transaction was created.

### Lane B - Public API Create-Only, If No Update Exists

Use this if live proof confirms Wave public API cannot update existing bank/feed transactions.

Behavior:

- Historical Wave category import refreshes Hub from Wave export.
- Hub category save updates Hub immediately.
- Hub push creates a new categorized Wave money transaction using `moneyTransactionCreate`.
- Feed-owner setting cannot block the push.
- UI must say this is a new Wave money transaction, not an in-place edit of an old Wave-feed transaction.
- If Wave's own bank feed already imported the same raw transaction, duplicate cleanup is operational, not a hidden software blocker.

Acceptance:

- Change category in Hub.
- Refresh Hub: new category remains.
- Push from Hub: Wave receives a categorized money transaction.
- Sync log shows the exact Wave transaction id or exact failure.
- Failed push stays retryable and visible.

### Lane C - Unsupported / Not Shippable

Use this if the team cannot prove either a safe true-update API or an acceptable create-only business path.

Behavior:

- Do not pretend it is fixed.
- Keep historical Wave import read-only.
- Keep Hub category save local.
- Show a clear "manual Wave update required" state.

This lane is not Max's desired outcome, but it is better than lying to the UI.

## Proposed Best Path Right Now

Proceed with Lane B unless live introspection proves Lane A.

Reason:

- It satisfies Max's immediate operational requirement: "when I update from Hub, send it to Wave and keep it on Hub."
- It removes the feed-owner dead-end that blocked real work.
- It is consistent with Wave's documented public API surface as of the official docs reviewed on 2026-06-28.
- It does not pretend that public API create equals editing a Wave-feed transaction in place.

## Current Working Tree Warning

Codex started draft edits before Max ordered the think-tank pause. These edits are NOT approved for release yet.

Draft touched areas include:

- `src/app/api/wave/push-transaction/route.js`
- `src/app/api/wave/import-transaction-csv/route.js`
- `src/app/api/accounting/bank-write/route.js`
- `src/components/WaveSyncCenter.jsx`
- `src/components/WaveImportTab.jsx`
- related static tests

Claude must treat those as draft material only:

- Keep useful ideas only after the design is accepted.
- Rewrite from scratch if cleaner.
- Do not deploy until Codex QA passes the accepted design.

## Build Plan, After Design Is Accepted

1. Historical Wave -> Hub
   - Import Wave Account Transactions CSV.
   - Match by silo, date, amount, direction, and description.
   - Process only non-invoice bank categorization rows.
   - Update Hub category even if the Hub row previously had a category or Wave id.
   - Default behavior: Wave export wins for historical refresh.

2. Hub -> Wave category push
   - Saving a category in Hub writes `wave_account_id`, `wave_account_name`, source, and pending sync state.
   - Push never blocks because feed owner is unset.
   - Push still blocks invalid categories: bank/cash, A/R, A/P, system accounts, missing category, missing amount/date, wrong silo.
   - Push records exact Wave request/response in sync log.

3. UI state
   - Bank Review shows category source: Wave import vs Hub selected vs pushed to Wave.
   - Wave Sync Center shows the transaction as pending/retryable/synced with exact latest log.
   - No stale "not set - push blocked" text for feed owner.

4. Invoice link path
   - Matched invoice deposits use payment push, not transaction category push.
   - DRAFT invoice payment failures remain blocked with clear repair instructions.
   - Partial allocation remains blocked until fully allocated.

## QA Plan

Codex will not accept this until these pass:

1. Historical import test
   - Given a Wave CSV row with Advertising & Promotion, the matching Hub bank transaction shows Advertising & Promotion after apply.
   - Existing Hub category is overwritten by default when Wave export differs.
   - Invoice/payment rows are deferred, not categorized.

2. Hub category save test
   - Change a Hub transaction category.
   - Refresh.
   - The category remains on the same Hub row.
   - Row is marked pending/retryable for Wave push.

3. Hub category push test
   - Push the changed Hub transaction.
   - Feed-owner unset does not block it.
   - Wave receives the category action.
   - Sync log records success with Wave id, or failure with the exact Wave error.

4. Retry test
   - A failed bank transaction push remains visible and retryable.

5. Invoice separation test
   - A deposit linked to an invoice never appears as a generic categorized bank transaction push.
   - Its Wave path is invoice payment push.

6. Live confirmation
   - One real or approved test transaction is pushed end-to-end.
   - User-facing result is checked in Wave and Hub.

## Open Think-Tank Questions

1. Does Max want Lane B even if it creates a new Wave money transaction rather than editing the existing Wave-feed transaction?
2. If Max requires true in-place Wave transaction category update, are we allowed to use only supported public Wave APIs, or is a private/internal/website API integration on the table?
3. Which specific bank account and transaction should be the live acceptance sample?

No source code should continue until these questions are answered or explicitly accepted as Lane B.
