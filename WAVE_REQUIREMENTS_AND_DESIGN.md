# Wave ⇄ Hub — Requirements & Design (fresh, 2026-06-28)

## Roles (per Max)
- **Developer: Claude.** Builds + tests + deploys.
- **QA: Codex.** Reviews every change, writes pass/fail, does not build the feature.

## What Max wants (his words, restated as requirements)
- **R1.** The categories already in Wave (historical) must show in the Hub.
- **R2.** Whatever Max sets in the Hub (a transaction's category, or a deposit→invoice link) must transfer to Wave.
- **R3.** It must also stay in the Hub (persisted, not lost).
- **R4.** Each transaction appears **ONCE** in each system — no duplicates.
- "I've seen this done before" — yes, and it's doable. See how, below.

## The single hard fact everything depends on
Wave's public API can **create** a transaction and **read/write invoices + invoice payments** — but it has **NO way to edit a transaction Wave already imported** (no read, no update/categorize mutation; proven against all 224 schema types — `scripts/introspect-wave-read-update.mjs`). Tools that "categorize Wave transactions" do it one of two ways: (a) they are the **source** that feeds Wave (Wave's own bank feed is off, the tool posts each transaction already-categorized) — that's the supported way, and what we do; or (b) they drive Wave's **internal/website API** — which violates Wave's API Terms of Service and breaks without warning — we will NOT do that.

## How each requirement is met (and where it's built)

| Req | Lane | How | Status |
|---|---|---|---|
| R1 | Historical categories | Import Wave's **Account Transactions CSV** (Reports → Account Transactions → Export). The Hub reads the category from the "Other Accounts for this Transaction" column and stamps it on the matching Hub transaction. (Wave's API can't read transactions, so CSV is the only door for history.) | Built — `import-transaction-csv` (MM) |
| R1 | Historical invoice payments/links | Read Wave invoice payments via API; show which deposit paid which invoice. | Built — `prefill-payment-links` / Step 6 |
| R3 | Stays on Hub | Category + link stored on `bank_transactions` / `payment_matches`. | Built |
| R2 | Hub deposit→invoice link → Wave | Hub records the payment on the **existing Wave invoice** (`invoicePaymentCreateManual`). One payment, no duplicate invoice. | Built — `push-payment` |
| R2 + R4 | Hub category → Wave, shown ONCE | The Hub **creates** the transaction in Wave already categorized (`moneyTransactionCreate`, balanced debit/credit). For it to appear ONCE, Wave's own auto-import must be **OFF** for that account, so the Hub is the only creator. | Built — `push-transaction`; needs the one Wave setup step below |

## The ONE setup step that makes "once" true (R4)
For each bank account the Hub manages: in **Wave → Banking → Connected Accounts**, turn **OFF** "Automatically import transactions into account." Then the Hub is the sole feeder → each transaction is created once in Wave with the Hub's category. If Wave's auto-import stays ON *and* the Hub also posts, you get two copies — that is the only source of duplicates, and it's a Wave-side toggle, not a Hub bug.

## Honest limits (no pretending)
- Re-categorizing a transaction the Hub **already pushed** can't be auto-updated in Wave (Wave has no update API). The first categorization lands at create-time; a later change is the gap.
- Historical transactions Wave **already imported** are not retroactively re-created by the Hub (that would duplicate). They're imported read-only for display (R1); going forward the Hub is the source.

## QA acceptance tests (Codex verifies these PASS before we call it done)
1. Import Wave's real Account-Transactions CSV → the historical category shows on the matching Hub transaction (R1).
2. Set a category in the Hub on a Hub-owned account → push → it appears once in Wave with that category (R2/R4).
3. Link a deposit to an invoice in the Hub → push → the existing Wave invoice shows the payment, no duplicate (R2/R4).
4. The category + link persist on the Hub after a refresh (R3).
5. No path creates a second Wave transaction for the same Hub transaction (externalId idempotency; R4).
