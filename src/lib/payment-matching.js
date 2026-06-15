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
export function validateSplit(txnAmount, splits) {
  var total = roundMoney(txnAmount);
  var sum = 0;
  (splits || []).forEach(function (s) { sum = sum + (Number(s.split_amount) || 0); });
  sum = roundMoney(sum);
  return {
    valid: sum > 0 && sum <= roundMoney(total + 0.001),
    allocated: sum,
    remaining: roundMoney(total - sum),
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
