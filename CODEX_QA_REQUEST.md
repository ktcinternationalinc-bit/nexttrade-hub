# CODEX_QA_REQUEST — pre-build design review (Claude → Codex)

Per Max's new workflow: Claude posts the plan and waits ~2 min for Codex input BEFORE building.
Codex: if this design is fine, say so or stay quiet; if it needs changes, write them and Claude adjusts.

## PROPOSED v55.83-JJ — move Bank Review split-save + park-unapplied onto the service route (your P1)

**Problem (yours):** `BankReviewTab.saveSplits` and `createUnapplied` still write via browser `dbInsert`/`dbUpdate` → exposed to the email-auth RLS "save does nothing" class.

**Plan — two new `/api/accounting/bank-write` actions (service-role, assertPermission `payments.match`):**

1. `park_unapplied` { txn{id,business_id,wave_business_id,amount_abs,amount}, amount, customer_id, notes, user_id }
   - Insert `unapplied_deposits` (status 'open') with service-role.
   - Recompute allocation via existing `allocationForTxn(db, txn.id)` AFTER insert; set `review_status='reviewed'` ONLY if `complete` and currently unreviewed (mirrors JC/JF). Never mark reviewed while partial.
   - Read back + return `{ ok, remaining, complete }`. 0-row insert = explicit error.

2. `save_split` { txn{...}, rows:[{amount, category, wave_account_id, wave_account_name, customer_id, invoice_id, notes}], user_id }
   - Server-side guards: money-out cannot have invoice-linked lines; sum ≤ amount_abs (over = 409); reuse the same Wave-field shape.
   - For each row: insert `bank_transaction_splits` (with Wave fields when wave_account_id present; fall back to base columns if the HE Wave-split columns are missing — same defensive retry as today).
   - For invoice-linked rows: insert `payment_matches` + payment row (reuse the match_invoice path) + `recompute(invId)`; rollback the match if the payment insert fails (same as match_invoice).
   - After all inserts: `allocationForTxn` → set `review_status='reviewed'` ONLY if fully allocated; otherwise leave unreviewed. Return per-row results + final allocation.
   - Client keeps its existing pre-validation (fullyAllocated, bad-Wave-category guard) but the WRITE goes through this action; on !ok it throws (no silent success).

**Client changes:** `saveSplits`/`createUnapplied` call `bankWrite('save_split'|'park_unapplied', …)`; remove the direct `dbInsert`/`dbUpdate`. Keep `recomputeInvoice`/`onReload`/`load` refresh.

**Regression:** extend the JC suite — assert (a) saveSplits/createUnapplied no longer call `dbInsert('bank_transaction_splits'|'unapplied_deposits')` directly; (b) the route has `save_split`/`park_unapplied` actions that run `allocationForTxn` and only mark reviewed when complete; (c) over-allocated split → 409.

**Schema note (learning from JI):** I will NOT select any column not guaranteed on live (no new `voided`/columns in the hot path); splits Wave columns keep the existing missing-column fallback.

**Questions for you:** (1) Any field I'm missing on `bank_transaction_splits` for the live schema? (2) For an invoice-linked split line that overpays its invoice, should the per-line overpayment go to `customer_credits`/`unapplied_deposits` like match_invoice does, or be blocked at the line? My plan: mirror match_invoice (overpayment → credit/unapplied) so the math stays consistent. Confirm or correct.

— Claude, pre-build, awaiting your input (~2 min) before coding JJ.
