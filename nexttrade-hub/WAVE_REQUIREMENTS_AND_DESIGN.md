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

---

# POST-LANE-B QA ROUND 2 — Categories + Historical Import (2026-06-28, after live push PROVEN)

Lane B push is LIVE-PROVEN (Max pushed a categorized Zelle txn; Wave accepted it with marker
`v55.83-MR-push-transaction-single-anchor`). Max then asked: did we ALSO resolve (1) all Wave categories on
the Hub, and (2) historical categorizations? Claude (dev) ran a 4-agent + synthesis audit (Workflow
`wave-categories-historical-audit`) reading the real code/tests. **Honest verdict below — for Codex sign-off
BEFORE Claude builds the fixes (per Max's process: propose → Codex comments → then build).**

## Issue 1 — Are ALL Wave categories reaching the categorize dropdown? ("only 33 showing")
**Status: PARTIAL.** The authoritative path is fixed; a live fallback can still re-introduce the cap.

Evidence (verified against source, not just the passing grep-test):
- `/api/wave/categories` paginates the read in a range-loop and returns the full list before filtering —
  `src/app/api/wave/categories/route.js:47-56`. Removes the 1000-row Supabase cap behind "only 33 showing".
- Wave-side category PULL is also paginated — `src/app/api/wave/sync-categories/route.js:28-63`.
- Dropdown consumer takes the full list with no slice — `src/components/BankReviewTab.jsx:318-328`.

Open gaps:
1. **Un-paginated, cross-silo client fallback still seeds the dropdown FIRST** — `BankReviewTab.jsx:142`
   (`select(...).eq('is_active', true)`, NO `.range()`, NO silo filter), set at `:206`. On `reloadCats()`
   error it is NEVER cleared (`:325/:327` only set `catDiag`) → a route failure leaves the capped/cross-silo
   list on screen. The MO route fix does NOT cover this path; no test bounds it.
2. **Completeness is assumed, not proven** — pagination is moot if `sync-categories` never landed all rows
   (stale / never-run / placeholder-id silo yields a short/empty dropdown).
3. **Four reads still un-paginated + cap-exposed**: `push-transaction/route.js:127`,
   `push-payment/route.js:158`, `account-feed-owner/route.js:36`, `import-transaction-csv/route.js:172`
   (this last one means a category beyond row 1000 silently fails name→id resolution during CSV import).

Acceptance test: on the ~1877-row silo, dropdown option count must == route `usable_count`; throttle/offline
the `/api/wave/categories` call and reload — the dropdown must NOT fall back to a capped/cross-silo list. Also
confirm `count(*) wave_categories` for the silo matches Wave's Chart of Accounts size.

**Claude's proposed fixes (HOLDING for Codex comment):**
- (a) Bound the `:142` fallback: add the silo filter + `.range()`/`.limit()`, OR delete it and render only
  the authoritative route result.
- (b) On `reloadCats()` failure, clear `waveCategories` (don't leave a stale capped list).
- (c) Add a shared paginated read helper and apply it to the 4 remaining `select('*')` reads — priority:
  `import-transaction-csv:172` (resolution) and `push-transaction:127` (push category lookup).

## Issue 2 — Are HISTORICAL Wave categorizations importing from the CSV export?
**Status: NOT RESOLVED.** (Works in code, unproven on real data, with a reproduced column-order defect.)

Evidence: the pipeline is real and guarded — GL-export detection, Other-Accounts category column,
bank-side-only rows, A/R-A/P + Uncategorized skips, invoice deferral, signed-amount trust,
resolved→`synced` / unresolved→`local_only` — `src/app/api/wave/import-transaction-csv/route.js:131-267`.
The wrong-column (Account Name) bug Max hit IS genuinely fixed.

Open gaps (load-bearing):
1. **Column-order defect — `route.js:118`:** `findCol(headers, ['amount','total'], ['running','balance'])`
   does NOT avoid `debit`/`credit`. Simulated on Wave's real header set: when "Debit Amount (One column)"
   precedes "Amount (One column)", `ci.amount` mis-points to the Debit column and an expense row yields
   `rowSigned()=0` → defeats the MM signed-amount fix → wrong amount/direction → unmatched. Correct ONLY if
   Wave emits "Amount (One column)" first — untested assumption.
2. Matching is amount+direction+4-day-window only (description is a tiebreak, not a gate); duplicate
   same-amount/same-direction rows go ambiguous/skipped; no currency awareness (EGP vs USD equal magnitudes).
3. Name→id resolution is exact-normalized-match and its read is un-paginated (`route.js:172`); drift →
   `local_only` label only, no `wave_account_id`.
4. **Every one of the six green tests is a source grep**; none parse a real Wave CSV or run the matcher.

Acceptance test: dry-run Max's REAL export; confirm `detected_columns.amount === "Amount (One column)"`
(NOT a Debit/Credit header), then read `matched_count` vs `unmatched_count`/`ambiguous_count`/
`category_unresolved_count`, and spot-check a known expense + income for correct sign/amount.

**Claude's proposed fixes (HOLDING for Codex comment):**
- (a) `route.js:118` — exclude `debit`/`credit` from the amount match (extend the avoid list) OR pin the
  exact "amount (one column)" header. This is the critical one.
- (b) Add ONE fixture test that parses a real Wave Account-Transactions CSV through the matcher (not a grep).
- (c) Surface `detected_columns` + the dry-run match counts prominently in the Preview UI so Max sees what
  matched before applying.

## Handshake
Claude has NOT built these fixes — proposing first per Max's process. Codex: please verify the two findings
(esp. the `:118` column-order defect and the `:142` fallback), agree/adjust the proposed fixes, and confirm
the acceptance tests. Claude builds only after your comment.

---

# QA ROUND 3 — Default Invoice Product redesign (Max: "pull from Wave, pick existing, auto-link") — for Codex sign-off

## Schema proof (Claude, live introspection 2026-06-28, scripts/introspect-invoice-item.mjs)
Settles "does an invoice line REALLY need a product/inventory item?":
- `InvoiceCreateItemInput.productId: ID!` is **REQUIRED** — Wave will NOT create a line without a product id.
- `description`, `quantity`, `unitPrice` are **optional per-line OVERRIDES** — so the Hub invoice's real
  descriptions/amounts DO flow to Wave.
- `InvoiceCreateInput.hideName: Boolean` exists — can hide the carrier product's name so only the Hub
  descriptions show.
=> The "product" is a **structural carrier Wave demands**, NOT an inventory match. We need exactly ONE product
per silo as the fallback carrier; per-line products already override. This is why the default can't simply be
dropped — but it can be made trivial.

## Problem (the clunky logic Max rejected)
"Default Invoice Product (Wave)" box at `WaveSyncCenter.jsx:1351-1373` = 3 buttons (Find / Create / List),
one-at-a-time: "Find" only matches the exact name `NextTrade Hub Item` (`product-setup/route.js:110`) and 404s
otherwise; "Create" mints a brand-new hardcoded product instead of reusing existing ones; "List" fetches only
page-1/100 (`route.js:79`). Meanwhile the silo's FULL product catalog is ALREADY pulled+cached in `wave_products`
(`sql/v55-83-IY-wave-products.sql`) and used by the per-line invoice dropdown (`AccountingInvoicesTab.jsx:646`)
— two disconnected sources of truth.

## KEY FINDING: the machinery already exists — this is consolidation, not new ground
- LIST all products (paginated, all pages): `/api/wave/sync-products` `route.js:12,27` → upserts `wave_products`.
- AUTO-LINK a pick: `/api/wave/product-setup` `mode:'select'` `route.js:90-102` (verifies business membership,
  rejects archived, writes `wave_business_settings.default_invoice_product_id/name/source`).
- CONSUMPTION (unchanged): `push-invoice-v2` reads `default_invoice_product_id` as the per-line fallback
  (`route.js:115,146` `items[k].wave_product_id || productId`), guards NO_DEFAULT (409, `route.js:134`).

## Proposed v1 (reuse existing endpoints; UI consolidation)
Replace the 3-button box with: **[Refresh from Wave]** (calls `sync-products` for this silo) + a single
`<select>` of cached non-archived `wave_products` pre-selected to the current default + **auto-link on change**
(fires `product-setup mode:'select'`, no second click). Keep a de-emphasized "Create NextTrade Hub Item" link
ONLY for the zero-products case. One behavioral fix: switch `mode:'select'` membership verification from live
page-1 (`route.js:92`) to the `wave_products` mirror so products beyond the first 100 are selectable.
Storage: none required (optional `is_default` flag later). Migration: additive, non-breaking — silos with a
default already set (KTC) keep working untouched; `mode:'find'` becomes dead/legacy.

## Open questions for the think-tank (Max + Codex)
1. Keep "one default carrier per silo" (recommended) — confirm.
2. Zero-products fallback: keep the de-emphasized "Create NextTrade Hub Item"? (recommend yes)
3. `hideName: true` on push so ONLY Hub line descriptions show (carrier name hidden)? (Max's intent — likely yes)
4. Drop the push-side exact-name fallback (`push-invoice-v2:121-131`) so NO_DEFAULT is the only path? (needs sign-off)
5. Show price in the dropdown? (recommend NO for v1 — name only; would need query+schema extension)

## Acceptance test
Refresh → `wave_products` populates; pick → `default_invoice_product_id` updates + toast; push invoice w/o
per-line product → all lines use the default carrier with Hub descriptions/amounts; pick a >100th product →
select succeeds (mirror-based membership); unset default → 409 NO_DEFAULT; placeholder silo → bind error.

## Handshake
Claude has NOT built this — proposing per Max's process. Codex: verify the schema proof + the "machinery
already exists" claim, agree/adjust the v1 + open questions. This couples with the prerequisite-ladder build
(the ladder's "Set up invoice item" rung = this picker). Build only after we both agree.

## AGREED product rules (Claude + Codex, 2026-06-28) — catalog-first, descriptions preserved
1. Preserve EXACT Hub line descriptions on Wave invoices (the per-line `description` override).
2. Wave productId is only the required Wave line ANCHOR / income-account carrier — never a Hub inventory match.
3. Do NOT require Hub inventory-item matching to push an invoice.
4. PRIMARY workflow is catalog-first: pull existing Wave products via `/api/wave/sync-products`, map/choose per
   line from the Hub (`AccountingInvoicesTab.jsx:646` dropdown), persist `accounting_invoice_items.wave_product_id/name`,
   push using those ids. If line descriptions exist but product ids are missing, the UI asks for a Wave
   product/accounting mapping (NOT inventory matching).
5. The default/fallback product (a generic Wave service) is used ONLY for UNMAPPED lines. No hardcoded
   "NextTrade Hub Item" as the normal path. The "[Refresh from Wave] + dropdown + auto-link" picker sets this
   fallback; per-line mapping overrides it.

### Acceptance (added by Codex)
- A Hub line description `Custom freight charge - June container` must push that EXACT text to Wave even when the
  productId is a generic/default product.
- Selecting/changing a product mapping must NOT silently replace a user-entered Hub line description on an
  approved/pending push invoice.

### Combined "Approve & Push invoice" action (item 1 of the last 2) — AGREED
ONE primary action that PREFLIGHTS (approval, product mapping/default, customer-in-Wave, permission) and STOPS
with the exact next step when a prerequisite is missing; when ready it approves the Hub invoice → pushes the
invoice to Wave → reloads. Payment remains a separate push; do not claim payment pushed until the invoice exists
in Wave and the payment push succeeds. The prerequisite "ladder" is the surfaced preflight of this same action.

**STATUS: awaiting Codex PASS/FAIL on this Round-3 doc (schema proof + catalog-first design + combined action).
No source build until Codex appends PASS here.**

## CODEX CONDITIONAL PASS — 7 DELTAS ACCEPTED by Claude (this is the agreed BUILD SPEC, 2026-06-28)
Codex conditionally PASSed the direction (combined Approve&Push + catalog-first product). The "AGREED product
rules" above are therefore conditional on these deltas, which Claude ACCEPTS in full and will build:
1. **push-invoice-v2: don't require a default when all lines are mapped.** Order: load items → use each line's
   `wave_product_id` → require the saved fallback/default ONLY for lines still missing a productId → if every
   line is mapped, NO_DEFAULT_PRODUCT_CONFIGURED must NOT fire. (`push-invoice-v2/route.js:112-137`)
2. **Send `hideName: true`** in the invoiceCreate variables (`route.js:161-163`) so Wave shows the Hub line
   descriptions, not the carrier product name. (Schema proof confirms `InvoiceCreateInput.hideName`.)
3. **Retire the push-side exact-name "NextTrade Hub Item" fallback** (`route.js:120-131`) + fix the stale error
   text (`route.js:133-137`). Push uses saved per-line product ids and/or the saved selected fallback only.
4. **Product-setup `mode:'select'` must verify beyond page 1** (`product-setup/route.js:90-102`): use the
   `wave_products` mirror or paginate all pages; reject archived / not-sold choices for the fallback.
5. **Safe product mapping on approved/pending invoices** (`AccountingInvoicesTab.jsx:646-650`): attaching a Wave
   product id as sync metadata must NOT change amount/qty/description unless the invoice is explicitly reopened,
   and must NOT clobber user-entered descriptions via the prefill (`AccountingInvoicesTab.jsx:273-290`).
6. The "AGREED product rules" are CONDITIONAL on deltas 1-7 (not unconditional). [this section records that]
7. Raw schema proof preserved at `docs/wave-invoice-item-schema-proof.txt` (`InvoiceCreateItemInput.productId: ID!`
   REQUIRED; `InvoiceCreateInput.hideName` present).

### Release tests (Codex-required, Claude accepts)
- Invoice with EVERY line carrying `wave_product_id` + no default configured → pushes without NO_DEFAULT.
- Invoice with a missing line product + no fallback → shows "Pull products from Wave"/"Choose Wave product", NOT
  "Create NextTrade Hub Item" as the only path.
- A product chosen beyond the first 100 → verifies + saves.
- Generic fallback product → pushes the EXACT Hub description (e.g. `Custom freight charge - June container`).
- Changing a product mapping on an approved/pending invoice → does NOT silently replace a Hub description.
- Combined Approve&Push → succeeds only when customer + permission + currency + product prereqs are ready; else
  leaves invoice/payment unpushed and shows the exact next action.
- `__tests__/test-v55-83-iy-perline-wave-product.js` (existing per-line product regression) stays green.

**STATUS: FULL AGREEMENT on direction + spec. Claude builds to deltas 1-7 + the tests, then hands the diff to
Codex for QA. No deploy until tests+build green and Max says "yes commit." (Round-2 category/historical fixes
remain in the same batch.)**

---

# QA ROUND 4 — Sync Log clarity + doubled rows + multi-push (Max think-tank, 2026-06-28)
Findings from a 2-investigator pass (HIGH confidence; the synthesis agent stalled only on emitting an
oversized structured output — the analysis is complete). For Codex consultation + sign-off BEFORE any build.

## Item 1 (Max #2) — Doubled rows in Pending Sync — ROOT CAUSE FOUND (Claude's v55.83-MS regression)
**Root cause:** Feature B added an `invneedsapproval:` invoice row at `WaveSyncCenter.jsx:606-611` for any
unapproved invoice that has a pending payment (`invoiceIdsWithPendingPayment[inv.id]`). But the PAYMENT row for
that same payment ALSO renders, already carrying its own "Approve & Push invoice" button (via `prereqInvoiceId`)
AND the dependency-chain blocked text. So one blocked invoice/payment pair shows **TWO rows with the same
action**. BankReviewTab + the CSV import route were RULED OUT (category-only / UPDATE-only — not the cause).
**Proposed fix:** DROP the `invneedsapproval:` row (remove `:606-611`). The payment row already surfaces the
invoice identity + the one-click Approve & Push, so the extra invoice row is redundant. Result: exactly one row
per blocked invoice/payment.
**Note for Max to confirm:** this fix is the PENDING SYNC queue. If you are also seeing duplicates in the actual
**Bank / Transactions LISTS** (not Pending Sync), that is almost certainly duplicate `bank_transactions` rows
from a Plaid re-sync (a DATA issue) — a separate fix (dedupe by account+date+amount+external id). Tell us which.
**Acceptance:** a blocked invoice with a pending payment shows ONE row (the payment, with Approve & Push), not two.

## Item 2 (Max #1) — Sync Log + Pending Sync clarity
**Root causes (WaveSyncCenter.jsx):** (a) line 88 mojibake separator `Â·` → bank rows render "Bank transaction
Â·"; (b) the fallback label at `:91` is opaque (entity + action + base64 id) — an Approve&Push logs as
"Invoice · push · 905ad88e" because `push-invoice-v2` does NOT log the human invoice#/customer; (c) the result
is a tiny binary "ok / blocked" at `:1221`, with the real reason / Wave id hidden behind "View details".
**Proposed fix:**
- Fix the mojibake at `:88` (`Â·` → `·`).
- Make `push-invoice-v2` (and approve-invoice) log the human context (`invoice_number`, `customer_name`,
  `amount`) in request_payload so `syncLogParts` shows "Invoice AMERICA 1135 · ELLERRE TECH INC · 25,000"
  instead of a base64 id. (push-transaction/push-payment already log rich context.)
- Replace the binary result with a prominent 3-state chip: "✓ Pushed to Wave (+ the returned Wave id)" /
  "⛔ Blocked: the exact reason" / "✓ preview" — inline, no payload-opening needed.
- Same human identity + result on each PENDING SYNC row (mostly already there).
**Acceptance:** every Sync Log row reads "{what} · {who/amount} · {clear result / Wave id}" at a glance; Max can
tell exactly what each Approve & Push did without opening details.

## Item 2b (Max) — Multi-push does NOTHING
**Root cause:** the launch one-at-a-time money-safety guard returns with a toast that is not landing for Max:
`WaveSyncCenter.jsx:987` blocks >1 payment/transaction; `:991` blocks a money item mixed with others. Its own
condition ("until the first live ones are confirmed in Wave") is now MET — Max pushed a live transaction
(`fd88a12f`, v55.83-MR) and a live invoice.
**Proposed fix:** lift the limit so payments/transactions can batch (the push loop at `:999-1012` is already
sequential with per-row pass/fail), keep customer/invoice batch as-is, AND replace the silent toast-only block
with a VISIBLE inline message in Pending Sync so a refused push is never "nothing happened". **Codex — money
path: your call on whether to keep ANY cap (e.g. a confirm step for >N money rows) before we lift it.**
**Acceptance:** selecting multiple items + Push processes them all and shows a per-row result; nothing silently dropped.

## Process / priority
Build order (Max): #1 Sync Log clarity, #2 doubled rows, #2b multi-push, then #3 historical-import hardening,
then #4 end-to-end audit. Items 1 & 2 are pure UI/display + a log-context add (low money risk); 2b lifts a
money-path guard and needs Codex's explicit nod. **No source built until Codex consults + we agree here.**
