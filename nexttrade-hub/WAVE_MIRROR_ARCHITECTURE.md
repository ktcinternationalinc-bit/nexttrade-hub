# Wave ⇄ Hub Mirror — Design Contract (v55.83-MC, 2026-06-23)

This is the binding design contract for the Wave integration, from Max (owner) + Codex (QA). It supersedes
the older "push categorized transactions to Wave" framing. Build to THIS.

## What the product must do (Max's words)
1. **Show what Wave already knows.** Every Wave bank transaction that already has a category shows that
   category in the Hub; every existing deposit→invoice link shows which invoice it paid; the
   invoice/open-account/payment views reflect it. Visible, not audit-only.
2. **Surface the unresolved ones.** Wave transactions with no category/link appear as "needs action." The
   user picks a real Wave Chart-of-Accounts category (full searchable list) or links to the correct invoice.
3. **Push the decision back to Wave.** Categorizing/linking in the Hub **updates the EXISTING Wave
   transaction/payment — never a duplicate.**
4. **Confirm by reading Wave back.** Mark "confirmed" only after a re-read of Wave proves the change. No fake
   synced state.

## The hard API reality (live-verified — see WAVE_API_TRANSACTION_EVIDENCE.md)
Wave's public GraphQL API is **CREATE-ONLY** for money transactions: no query to read them, no mutation to
update/categorize them. Invoices + invoice payments have **full read + write**. Consequences per lane:

| Capability | Invoice / payment lane | Raw transaction category lane |
|---|---|---|
| Read Wave's current state | ✅ API (`business.invoices{payments}`) | ⚠️ only via Wave **CSV export** (no API read) |
| Apply Hub decision to Wave | ✅ API (`invoicePaymentCreateManual` links to the existing invoice) | ❌ **No API.** Only Wave UI, or Hub-CREATE if Hub owns the account |
| Confirm by readback | ✅ API | ✅ re-imported CSV |

**Therefore:** the invoice-payment half of the premise is fully achievable. The raw-transaction-category
*write-back* has no API; it is delivered by the **per-account single-writer** rule below, not by "updating"
an existing Wave-fed transaction (which is impossible).

## Per-account single-writer rule (the anti-duplicate firewall)
A Wave silo can hold many bank accounts. For EACH bank account, exactly ONE source may feed Wave:
- **`HUB`** — Wave's own bank feed is OFF for this account. The Hub is the sole writer and CREATES each
  transaction already-categorized (no duplicate, because Wave isn't pulling it). This delivers "Wave shows
  the Hub's categories."
- **`WAVE_FEED`** — Wave pulls this account directly. The Hub must NOT create (would duplicate). The Hub
  SHOWS Wave's state (via CSV), surfaces uncategorized rows, holds the desired category, but the category
  must be applied in Wave (no API). Invoice-payment LINKS still apply via API.
- **UNSET (null)** — HARD BLOCK. Push refuses until the owner is chosen, so a new account can never silently
  duplicate. Stored as `wave_categories.wave_feed_owner` (migration `sql/v55-83-MC-wave-feed-owner.sql`).

## Four-layer architecture (Codex spec)
1. **Wave-state ingestion** — store imported Wave truth SEPARATELY from Hub desired state:
   `current Wave category/link`, `Hub desired category/link`, `confirmation source`, `last imported at`,
   `row hash / evidence`. Sources: invoices/payments via API (`payment-readback`, `prefill-payment-links`,
   `import-invoices`); raw-transaction categories via `import-transaction-csv` (Wave CSV export).
2. **Desired-action layer** — categorizing/linking in the Hub creates a **pending Wave action** keyed to the
   existing Wave row identity (account + date + amount + description + row hash), NOT a fake synced row.
   Category action from `BankReviewTab` category select; link action from the invoice-match path.
3. **Apply layer** — only three honest ways to change Wave: (a) a proven API endpoint [proven absent for raw
   txns]; (b) the Hub-CREATE path for `HUB`-owned accounts (real, in `push-transaction`); (c) the invoice
   payment API for links (`push-payment`). For `WAVE_FEED` accounts there is no programmatic category apply —
   the Hub produces a categorization worklist and the apply happens in Wave; mark `applied_unverified`.
4. **Confirmation layer** — re-import/re-read after apply; if Wave reflects the category/link → `confirmed by
   Wave`; else stay pending/failed with the exact transaction identity + reason.

## Status vocabulary (plain language in the UI)
`Already in Wave` · `Needs Wave update` · `Applied in Wave — awaiting confirmation` · `Confirmed by Wave` ·
`Failed` · `Ambiguous / manual review` · `Blocked: this account is fed directly by Wave (Hub won't duplicate)`.

## Build sequence
- **MC (this build):** shared resolver `src/lib/wave-bank-account-resolver.js` + category classifier + the
  per-account firewall wired into `push-transaction` (Wave-direct/unset → blocked, never duplicates) +
  push-payment/prefill use the shared resolver. SQL for `wave_feed_owner`. Committed proof script. Tests mc*.
- **MD:** the feed-owner toggle UI + one guided Wave flow (Connect → Map accounts → Mirror → Review/Push →
  Logs) + two-lane copy + dark-theme Settings. Tests md*.
- **ME:** Wave-state ingestion + desired-action + confirmation layers with the status vocabulary; show prior
  Wave categories/links on bank/invoice views; CSV re-import confirmation loop. Tests me*.

Anything that only creates new Wave transactions, only changes copy, or marks "synced" on Hub intent without
Wave confirmation does NOT satisfy this contract.
