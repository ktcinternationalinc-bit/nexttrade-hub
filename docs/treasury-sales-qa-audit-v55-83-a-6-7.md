# Treasury + Sales — Comprehensive QA Audit (REVISED)
## v55.83-A.6.7 pre-deploy gate
## Date: May 13, 2026

**MAJOR REVISION:** Confirmed actual Supabase schema. Several earlier
"findings" were based on assumed columns that don't exist. The real
problems are different — and bigger.

---

## CONFIRMED SCHEMA (treasury table)

```
id, transaction_date, order_number, description, description_en,
cash_in, cash_out, bank_in, bank_out, usd_in, usd_out,
foreign_amount, foreign_currency, foreign_direction,
currency, source (main/safe/bank), category, subcategory,
cash_method (cash/vodafone/instapay),
linked_invoice_id, bank_account_id, matched_bank_txn_id,
dedup_sibling_id, is_bank_placeholder, expected_amount,
expected_direction, bank_nonorder_category, needs_bank_match,
created_by, created_at, updated_at
```

**CRITICAL: Missing columns referenced by code:**
- `payment_source` — used by aggregatePaymentSources, badge logic — DOES NOT EXIST
- `source_check_id` — used by check collection/uncollection flow — DOES NOT EXIST

Every code path that branches on `payment_source` is silently broken.
The check unstamp flow that looks for `source_check_id` matches NOTHING
in the database — collected checks can never be uncollected reliably.

---

## CRITICAL findings

### CRIT-0 — Schema/code mismatch — phantom columns
Code references `treasury.payment_source` and `treasury.source_check_id`
which don't exist. Payment-Source Breakdown shows "100% Cash" for everything;
check rollback silently fails.

**Fix:** Add columns, backfill from `cash_method` + `is_bank_placeholder` +
`source_check_id` lookup.

### CRIT-1 — Treasury orphans (linked_invoice_id NULL) — confirmed on 2303
Path B inserts treasury rows with order_number text but doesn't auto-link
to existing invoice. Recalc joins on linked_invoice_id, finds nothing.

**Fix:** SQL backfill + code patch on insert paths + DB trigger.

### CRIT-2 — total_collected vs confirmed+pending drift
Three fields hold related data, invariant not enforced. Old code paths
write only total_collected.

**Fix:** Backfill recomputes all three from treasury+checks; going forward
every recalc writes all three.

### CRIT-3 — Instapay/Vodafone misclassified as pending bank match
Likely the bug Max saw on 2317. Backfill flagged every bank_in > 0 row as
needs_bank_match=TRUE regardless of cash_method.

**Fix:** Unflag instapay/vodafone in backfill; never flag them in code.

### CRIT-4 — Overpayment silently hidden by cap
When treasury+checks > invoice total, recalc proportionally scales down.
The overflow is lost. Could indicate duplicate payment.

**Fix:** Surface overpayment warning, don't silently cap.

### CRIT-5 — Check + treasury double-count after v55.83-A.6.6
Code inserts a treasury row when check collected (stamps source_check_id
which doesn't exist → silently dropped). My A.6.6 tTotalForInvoice sums
BOTH treasury and checks → 2x.

**Fix:** After CRIT-0 adds source_check_id, backfill links treasury rows
to checks by amount+date proximity. tTotalForInvoice excludes
source_check_id-stamped rows.

### CRIT-6 — Bank match race condition
auto-matcher updates treasury then calls recalc — non-transactional.

**Fix:** Wrap in transaction with retry.

---

## HIGH findings

- HIGH-1: Outstanding rounding error allows phantom OPEN status
- HIGH-2: Currency mismatch in reconciliation (USD rows on EGP invoice)
- HIGH-3: No idempotency on check collection (double-click duplicates)
- HIGH-4: Treasury delete loses audit trail
- HIGH-5: Reports don't expose confirmed/pending split

## MEDIUM findings

- MED-1: No duplicate-placeholder warning
- MED-2: No bulk reconcile UI
- MED-3: Badge doesn't refresh real-time
- MED-4: Dedup sibling cycle risk
- MED-5: Check rollback recalc broken (depends on missing source_check_id)

## LOW findings

- LOW-1: MISMATCH banner not specific
- LOW-2: Yellow color ambiguity
- LOW-3: No "last reconciled at" timestamp
- LOW-4: Time-zone display slippage

## ARCHITECTURAL gaps

- ARCH-1: No DB triggers keeping total_collected fresh
- ARCH-2: Schema/code drift not caught in CI
- ARCH-3: Derived field stored = drift risk

## TEST gaps (12 scenarios needed)

Full payment lifecycle; multi-currency; free-goods; partial check;
treasury edit/delete recalc; orphan-link backfill; double-count;
instapay/vodafone-not-pending; overpayment surface; idempotent collect;
currency mismatch detection.

---

## v55.83-A.6.7 BUILD PLAN

**Must fix before deploy:**
1. CRIT-0: Add payment_source + source_check_id columns
2. CRIT-1: Backfill linked_invoice_id + code patch on insert paths
3. CRIT-2: Backfill total_confirmed/pending/collected
4. CRIT-3: Exclude instapay/vodafone from needs_bank_match
5. CRIT-4: Surface overpayment warning, don't silently cap
6. CRIT-5: tTotalForInvoice excludes source_check_id-stamped rows
7. CRIT-6: Bank match transaction with retry

**ONE comprehensive SQL block** with all backfills + verification.
**ONE code patch** with 6 CRIT fixes + 12 regression tests.

**Verification on three known invoices:**
- 2302 → Cash 35% + Check 65%, no MISMATCH
- 2303 → Confirmed 0, Pending 1,320,000
- 2317 → instapay payment recognized correctly
