// v55.83-Z — Phase 2 payment-matching math (pure, no DB, testable). USD only.
// Invoice balances are ALWAYS derived from matches here — never typed by hand.

export function roundMoney(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// Classify applying `applyAmount` to an invoice given what's already paid.
export function classifyApplication(invoiceTotal, alreadyPaid, applyAmount) {
  var total = roundMoney(invoiceTotal);
  var paid = roundMoney(alreadyPaid);
  var apply = roundMoney(applyAmount);
  var newPaid = roundMoney(paid + apply);
  var remainingBefore = roundMoney(total - paid);
  var type = 'invalid';
  var overpayment = 0;
  var appliedToInvoice = apply;
  if (apply <= 0) {
    type = 'invalid';
  } else if (newPaid < total) {
    type = 'partial';
  } else if (newPaid === total) {
    type = 'full';
  } else {
    type = 'overpayment';
    overpayment = roundMoney(newPaid - total);
    appliedToInvoice = roundMoney(remainingBefore);
  }
  return {
    type: type,
    applied_to_invoice: appliedToInvoice,
    overpayment: overpayment,
    balance_due: roundMoney(Math.max(0, total - newPaid)),
  };
}

// Recompute an invoice's paid / balance / status from ALL of its matches.
export function computeInvoiceBalance(invoiceTotal, matches) {
  var total = roundMoney(invoiceTotal);
  var paid = 0;
  (matches || []).forEach(function (m) { paid = paid + (Number(m.matched_amount) || 0); });
  paid = roundMoney(paid);
  var balance = roundMoney(total - paid);
  var status;
  if (paid <= 0) status = 'unpaid';
  else if (paid < total) status = 'partial';
  else if (paid === total) status = 'paid';
  else status = 'overpaid';
  return {
    amount_paid: paid,
    balance_due: roundMoney(Math.max(0, balance)),
    status: status,
    overpaid_by: balance < 0 ? roundMoney(-balance) : 0,
  };
}

// Validate splitting a bank transaction across targets (must not exceed the txn).
// v55.83-JC — also expose fullyAllocated: a split that does not consume the WHOLE transaction
// leaves money unaccounted, so reviewed/approved flows must require exact allocation (see
// bankAllocationStatus below). `valid` stays the lenient "not over-allocated" check used while the
// user is still building lines; `fullyAllocated` is the strict gate for finalizing.
export function validateSplit(txnAmount, splits) {
  var total = roundMoney(txnAmount);
  var sum = 0;
  (splits || []).forEach(function (s) { sum = sum + (Number(s.split_amount) || 0); });
  sum = roundMoney(sum);
  var remaining = roundMoney(total - sum);
  return {
    valid: sum > 0 && sum <= roundMoney(total + 0.001),
    fullyAllocated: sum > 0 && Math.abs(remaining) <= 0.01,
    allocated: sum,
    remaining: remaining,
  };
}

// v55.83-JK — pure allocation summarizer over the raw rows for a bank transaction. Both the server
// route and the Bank Review UI use this so they agree exactly. CRITICAL: an invoice-linked split line
// also has a payment row for the same dollars, so counting BOTH double-counts — invoice-linked splits
// (linked_type === 'invoice') are therefore EXCLUDED from the split sum (their money is the payment).
// parts: { total, payments:[{amount,voided,sync_status}], splits:[{split_amount,linked_type}],
//          unapplied:[{amount,status}], credits:[{amount,status}] }
export function summarizeBankAllocation(parts) {
  parts = parts || {};
  var total = roundMoney(Number(parts.total) || 0);
  var paid = 0, split = 0, parked = 0;
  (parts.payments || []).forEach(function (p) { if (!isPaymentVoid(p)) { paid += Number(p.amount) || 0; } });
  (parts.splits || []).forEach(function (s) { if (String(s.linked_type || '') !== 'invoice') { split += Number(s.split_amount) || 0; } });
  (parts.unapplied || []).forEach(function (u) { if (!u.status || u.status === 'open') { parked += Number(u.amount) || 0; } });
  (parts.credits || []).forEach(function (c) { if (!c.status || c.status === 'open') { parked += Number(c.amount) || 0; } });
  return bankAllocationStatus({ txnAmount: total, paid: paid, split: split, unapplied: parked });
}

// v55.83-JC — ACCOUNTING INTEGRITY (money conservation). A bank transaction must be FULLY
// accounted for before it can be marked reviewed/approved. Allocation is the sum of every piecewise
// disposition tied to the transaction: invoice payments + saved split lines + open unapplied
// deposits/customer credits. (A transaction categorized as a single whole — one classification/Wave
// category with no piecewise rows — is complete by definition; that case has hasPiecewise=false.)
// Returns the math + a `complete` verdict; the UI blocks reviewed/approved unless complete.
export function bankAllocationStatus(parts) {
  parts = parts || {};
  var total = roundMoney(Number(parts.txnAmount) || 0);
  var paid = roundMoney(Number(parts.paid) || 0);
  var split = roundMoney(Number(parts.split) || 0);
  var unapplied = roundMoney(Number(parts.unapplied) || 0);
  var allocated = roundMoney(paid + split + unapplied);
  var remaining = roundMoney(total - allocated);
  var hasPiecewise = (paid > 0) || (split > 0) || (unapplied > 0);
  return {
    total: total,
    paid: paid,
    split: split,
    unapplied: unapplied,
    allocated: allocated,
    remaining: remaining,
    hasPiecewise: hasPiecewise,
    overAllocated: remaining < -0.01,
    // Complete when there is nothing allocated piecewise (whole-category path) OR the piecewise
    // allocation lands on the transaction total within one cent.
    complete: !hasPiecewise || Math.abs(remaining) <= 0.01,
  };
}

// Given a deposit and the amounts applied to invoices, compute the leftover that
// must become an unapplied deposit / customer credit (never silently dropped).
export function allocatePayment(paymentAmount, applications) {
  var pay = roundMoney(paymentAmount);
  var applied = 0;
  (applications || []).forEach(function (a) { applied = applied + (Number(a.amount) || 0); });
  applied = roundMoney(applied);
  var spill = roundMoney(pay - applied);
  return {
    applied: applied,
    unapplied: spill > 0 ? spill : 0,
    over_allocated: spill < 0,
  };
}

// Canonical "is this payment row void/reversed" test. A row counts as void if the boolean
// voided flag is set OR its sync_status is in the reversed set. Used everywhere paid amounts
// are summed so reversed payments are never counted. SWC-safe.
export function isPaymentVoid(p) {
  if (!p) { return true; }
  if (p.voided === true) { return true; }
  var s = (p.sync_status || '').toLowerCase();
  if (s === 'void' || s === 'voided' || s === 'cancelled' || s === 'reversed' || s === 'deleted') { return true; }
  return false;
}
