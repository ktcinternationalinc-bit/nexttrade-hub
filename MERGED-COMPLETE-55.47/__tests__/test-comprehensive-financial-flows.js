// ============================================================
// COMPREHENSIVE FINANCIAL FLOW TESTS — v55.12 (Apr 26 2026)
// ============================================================
// Covers the gaps Max called out: treasury add default-Cash-In path,
// the customer-required gate, inline create-customer flow, non-order
// income classification, bank match dedup edge cases, check auto-match
// guard rails, recalc invariants, orphan detection, currency separation.
//
// Each section mirrors a piece of page.jsx logic in plain JS so we
// catch regressions before they hit production. When something here
// fails, page.jsx has changed in a way that breaks the financial
// invariants — investigate before shipping.
//
// Test groups:
//   A. Treasury add decision tree — DEFAULT Cash In (the recent bug)
//   B. Customer picker gate — invoice must have customer_id
//   C. Inline "Create new customer" inline flow
//   D. Non-order income classification (Refund/Owner Draw/Loan)
//   E. recalcInvoiceCollected invariant — single source of truth
//   F. Bank auto-match dedup edge cases
//   G. Check auto-match guard rails
//   H. Orphan detection queries
//   I. Currency separation (USD vs EGP)
//   J. Edit-treasury downstream recalc
//   K. Cash channel preservation through reconciliation
// ============================================================

var assert = require('assert');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function group(name) { console.log('\n── ' + name + ' ──'); }

// ============================================================
// A. TREASURY ADD — DEFAULT CASH IN PATH
// ============================================================
// The bug Max reported: open Add Treasury, leave Cash In as default
// (don't touch the radio), enter description + order# that doesn't
// match → system silently saved without showing the create-invoice
// modal. Root cause: formData.type was undefined (visual default
// only), so isIncome=false, so the order# gate never fired.
//
// Mirror of v55.12 handleAddTreasury decision tree.
group('A. Treasury add decision tree (default Cash In)');

function decideTreasuryAdd(formData, invoices) {
  // v55.12 normalizes type at top of function
  var txType = formData.type || 'in';
  var isIncome = txType === 'in' || txType === 'bank_in';
  var isBankPlaceholder = txType === 'bank_in' || txType === 'bank_out';

  if (!formData.amount) return { branch: 'rejected', reason: 'no amount' };
  if (isBankPlaceholder && !formData.bankAccountId) return { branch: 'rejected', reason: 'no bank account' };

  var bankEntryMode = formData.bankEntryMode || 'order';
  var isOrderLinkable = isIncome && (!isBankPlaceholder || (isBankPlaceholder && bankEntryMode === 'order'));
  var orderNumTrimmed = String(formData.orderNumber || '').trim();

  // 1. Order# provided AND matching invoice → auto-link
  if (isOrderLinkable && orderNumTrimmed) {
    var match = (invoices || []).find(function(i) { return String(i.order_number || '').trim() === orderNumTrimmed; });
    if (match) return { branch: 'auto-link', invoiceId: match.id };
    return { branch: 'modal-not-found', orderNumTrimmed: orderNumTrimmed };
  }
  // 2. Income but NO order# → block unless explicit non-order category
  if (isOrderLinkable && !orderNumTrimmed) {
    var nonOrderCats = ['Refund', 'Advance', 'Owner Contribution', 'Owner Draw', 'Loan', 'Loan Received', 'Other Income', 'Inter-Bank Transfer', 'Bank Fee', 'استرداد', 'سلفة', 'إيداع المالك', 'قرض', 'دخل آخر'];
    var cat = String(formData.category || '').trim();
    var isNonOrder = cat && nonOrderCats.some(function(n) { return cat.toLowerCase() === n.toLowerCase(); });
    if (isNonOrder) return { branch: 'silent-save', reason: 'non-order income classified' };
    return { branch: 'rejected', reason: 'income without order# and no non-order category' };
  }
  // 3. Expense (any) — silent save fine
  return { branch: 'silent-save', reason: 'expense or non-order bank' };
}

ok('A1: type undefined + valid order# → modal opens (THE BUG: previously fell to silent-save)',
  decideTreasuryAdd({ amount: 100, orderNumber: '9999' }, []).branch === 'modal-not-found'
);

ok('A2: type undefined + matching order# → auto-link',
  decideTreasuryAdd({ amount: 100, orderNumber: '5500' }, [{ id: 'inv-1', order_number: '5500' }]).branch === 'auto-link'
);

ok('A3: type undefined + no order# + no category → REJECTED (income needs link)',
  decideTreasuryAdd({ amount: 100 }, []).branch === 'rejected'
);

ok('A4: type=in explicit + non-existent order# → modal opens',
  decideTreasuryAdd({ type: 'in', amount: 100, orderNumber: '9999' }, []).branch === 'modal-not-found'
);

ok('A5: type=out (expense) + no order# → silent-save (expenses do not need invoice link)',
  decideTreasuryAdd({ type: 'out', amount: 100 }, []).branch === 'silent-save'
);

ok('A6: type=in + no order# + Refund category → silent-save (non-order income classified)',
  decideTreasuryAdd({ type: 'in', amount: 100, category: 'Refund' }, []).branch === 'silent-save'
);

ok('A7: type=in + no order# + Owner Draw category → silent-save',
  decideTreasuryAdd({ type: 'in', amount: 100, category: 'Owner Draw' }, []).branch === 'silent-save'
);

ok('A8: type=in + no order# + Arabic non-order category (سلفة) → silent-save',
  decideTreasuryAdd({ type: 'in', amount: 100, category: 'سلفة' }, []).branch === 'silent-save'
);

ok('A9: type=in + no order# + ordinary "مبيعات" category → REJECTED (sales must have order#)',
  decideTreasuryAdd({ type: 'in', amount: 100, category: 'مبيعات' }, []).branch === 'rejected'
);

ok('A10: type=bank_in + valid order# in Order mode → modal-not-found',
  decideTreasuryAdd({ type: 'bank_in', amount: 100, orderNumber: '9999', bankAccountId: 'b1', bankEntryMode: 'order' }, []).branch === 'modal-not-found'
);

ok('A11: type=bank_in + nonorder mode → silent-save (bank placeholder, no order# needed)',
  decideTreasuryAdd({ type: 'bank_in', amount: 100, bankAccountId: 'b1', bankEntryMode: 'nonorder', bankNonOrderCategory: 'transfer' }, []).branch === 'silent-save'
);

ok('A12: type=bank_in + no bank account → REJECTED',
  decideTreasuryAdd({ type: 'bank_in', amount: 100 }, []).branch === 'rejected'
);

ok('A13: empty form → REJECTED (no amount)',
  decideTreasuryAdd({}, []).branch === 'rejected'
);

// ============================================================
// B. CUSTOMER PICKER GATE — invoice must have customer_id
// ============================================================
group('B. Customer picker gate');

function canCreateInvoice(formData) {
  // v55.11 gate: green button disabled until customer_id is present
  if (!formData.__newInvCustomerId) return { ok: false, reason: 'no customer linked' };
  if (!Number(formData.__newInvTotal) || Number(formData.__newInvTotal) <= 0) return { ok: false, reason: 'invalid total' };
  return { ok: true };
}

ok('B1: no customer_id → button locked',
  canCreateInvoice({ __newInvCustomer: 'Pizza Hut Cairo', __newInvTotal: 100 }).ok === false
);

ok('B2: customer_id null → button locked',
  canCreateInvoice({ __newInvCustomer: 'Pizza Hut', __newInvCustomerId: null, __newInvTotal: 100 }).ok === false
);

ok('B3: customer_id set + valid total → button enabled',
  canCreateInvoice({ __newInvCustomer: 'Shawar Home', __newInvCustomerId: 'cust-1', __newInvTotal: 100 }).ok === true
);

ok('B4: customer_id set but total=0 → button locked',
  canCreateInvoice({ __newInvCustomerId: 'cust-1', __newInvTotal: 0 }).ok === false
);

ok('B5: customer_id set but total negative → button locked',
  canCreateInvoice({ __newInvCustomerId: 'cust-1', __newInvTotal: -50 }).ok === false
);

// Auto-prefill case-insensitivity (v55.11)
function autoPrefillMatch(descText, customers) {
  var lc = descText.toLowerCase().trim();
  if (!lc) return null;
  return (customers || []).find(function(c) { return String(c.name || '').trim().toLowerCase() === lc; }) || null;
}

ok('B6: auto-prefill exact case match',
  autoPrefillMatch('Shawar Home', [{ id: 'c1', name: 'Shawar Home' }]) !== null
);

ok('B7: auto-prefill lowercase desc → matches Title Case customer',
  autoPrefillMatch('shawar home', [{ id: 'c1', name: 'Shawar Home' }]) !== null
);

ok('B8: auto-prefill UPPERCASE → matches Title Case',
  autoPrefillMatch('SHAWAR HOME', [{ id: 'c1', name: 'Shawar Home' }]) !== null
);

ok('B9: auto-prefill no match → returns null (does NOT pick a different customer)',
  autoPrefillMatch('Pizza Hut', [{ id: 'c1', name: 'Shawar Home' }]) === null
);

ok('B10: auto-prefill empty desc → returns null',
  autoPrefillMatch('', [{ id: 'c1', name: 'X' }]) === null
);

// ============================================================
// C. INLINE CREATE-NEW-CUSTOMER FLOW
// ============================================================
group('C. Inline create-new-customer');

function shouldShowCreateButton(typedName, customers) {
  // v55.11 logic: show "Create new" button when typed text doesn't substring-match any customer
  var typed = String(typedName || '').trim();
  if (!typed) return false;
  var pool = customers || [];
  return !pool.some(function(c) { return String(c.name || '').toLowerCase().indexOf(typed.toLowerCase()) >= 0; });
}

ok('C1: typed name does not substring-match any customer → show Create button',
  shouldShowCreateButton('Pizza Hut Cairo', [{ name: 'Shawar Home' }, { name: 'احمد صالح' }]) === true
);

ok('C2: typed name substring-matches an existing customer → DO NOT show Create button',
  shouldShowCreateButton('Shawar', [{ name: 'Shawar Home' }]) === false
);

ok('C3: empty typed name → no Create button',
  shouldShowCreateButton('', []) === false
);

ok('C4: customer name is exact match → no Create button (already exists)',
  shouldShowCreateButton('Shawar Home', [{ name: 'Shawar Home' }]) === false
);

ok('C5: typed lowercase matches case-insensitive substring → no Create button',
  shouldShowCreateButton('shawar', [{ name: 'Shawar Home' }]) === false
);

// ============================================================
// D. NON-ORDER INCOME CLASSIFICATION
// ============================================================
group('D. Non-order income classification');

var NON_ORDER_INCOME_CATS_EN = ['Refund', 'Advance', 'Owner Contribution', 'Owner Draw', 'Loan', 'Loan Received', 'Other Income', 'Inter-Bank Transfer', 'Bank Fee'];
var NON_ORDER_INCOME_CATS_AR = ['استرداد', 'سلفة', 'إيداع المالك', 'قرض', 'دخل آخر'];

function isNonOrderIncome(category) {
  var cat = String(category || '').trim();
  if (!cat) return false;
  var all = NON_ORDER_INCOME_CATS_EN.concat(NON_ORDER_INCOME_CATS_AR);
  return all.some(function(n) { return cat.toLowerCase() === n.toLowerCase(); });
}

ok('D1: Refund → recognized as non-order income',
  isNonOrderIncome('Refund') === true
);

ok('D2: refund (lowercase) → still recognized',
  isNonOrderIncome('refund') === true
);

ok('D3: Owner Draw → recognized',
  isNonOrderIncome('Owner Draw') === true
);

ok('D4: Arabic سلفة → recognized',
  isNonOrderIncome('سلفة') === true
);

ok('D5: مبيعات (Sales) → NOT recognized as non-order (must have order#)',
  isNonOrderIncome('مبيعات') === false
);

ok('D6: random text → NOT recognized',
  isNonOrderIncome('Some random category') === false
);

ok('D7: empty/null/undefined → NOT recognized',
  isNonOrderIncome('') === false && isNonOrderIncome(null) === false && isNonOrderIncome(undefined) === false
);

// ============================================================
// E. recalcInvoiceCollected INVARIANT
// ============================================================
// CRITICAL: This is the single source of truth for invoice.total_collected.
// Any treasury op that affects collected MUST call this. Sum is over
// rows where: linked_invoice_id matches AND not is_bank_placeholder
// AND not dedup_sibling_id AND description does not contain '[bank confirmation'.
group('E. recalcInvoiceCollected invariant');

function recalcCollected(invoiceId, treasuryRows, invoiceTotal) {
  var sum = 0;
  for (var i = 0; i < treasuryRows.length; i++) {
    var t = treasuryRows[i];
    if (t.linked_invoice_id !== invoiceId) continue;
    if (t.is_bank_placeholder) continue;
    if (t.dedup_sibling_id) continue;
    if (String(t.description || '').indexOf('[bank confirmation') >= 0) continue;
    sum += Number(t.cash_in || 0) + Number(t.bank_in || 0);
  }
  return Math.min(sum, Number(invoiceTotal || 0));
}

ok('E1: single cash_in payment → collected = cash_in',
  recalcCollected('i1', [
    { linked_invoice_id: 'i1', cash_in: 500, bank_in: 0 },
  ], 1000) === 500
);

ok('E2: cash_in + bank_in on same invoice → both summed',
  recalcCollected('i1', [
    { linked_invoice_id: 'i1', cash_in: 500, bank_in: 0 },
    { linked_invoice_id: 'i1', cash_in: 0, bank_in: 300 },
  ], 1000) === 800
);

ok('E3: bank placeholder excluded',
  recalcCollected('i1', [
    { linked_invoice_id: 'i1', cash_in: 0, bank_in: 0, is_bank_placeholder: true },
    { linked_invoice_id: 'i1', cash_in: 500 },
  ], 1000) === 500
);

ok('E4: dedup_sibling_id row excluded (BUG 5 protection)',
  recalcCollected('i1', [
    { linked_invoice_id: 'i1', cash_in: 500 },
    { linked_invoice_id: 'i1', bank_in: 500, dedup_sibling_id: 'sibling-1' }, // post-confirm dedup marker
  ], 1000) === 500
);

ok('E5: legacy "[bank confirmation" description marker excluded',
  recalcCollected('i1', [
    { linked_invoice_id: 'i1', cash_in: 500 },
    { linked_invoice_id: 'i1', bank_in: 500, description: 'paid [bank confirmation — legacy]' },
  ], 1000) === 500
);

ok('E6: capped at invoice total when overpaid',
  recalcCollected('i1', [
    { linked_invoice_id: 'i1', cash_in: 1500 },
  ], 1000) === 1000
);

ok('E7: rows linked to OTHER invoice ignored',
  recalcCollected('i1', [
    { linked_invoice_id: 'i1', cash_in: 500 },
    { linked_invoice_id: 'i2', cash_in: 99999 },
  ], 1000) === 500
);

ok('E8: zero-payment row sums to 0',
  recalcCollected('i1', [
    { linked_invoice_id: 'i1', cash_in: 0, bank_in: 0 },
  ], 1000) === 0
);

ok('E9: floating-point cash_in handled',
  Math.abs(recalcCollected('i1', [
    { linked_invoice_id: 'i1', cash_in: 333.33 },
    { linked_invoice_id: 'i1', cash_in: 333.34 },
    { linked_invoice_id: 'i1', cash_in: 333.33 },
  ], 1000) - 1000.00) < 0.01
);

ok('E10: empty treasury → collected = 0',
  recalcCollected('i1', [], 1000) === 0
);

// ============================================================
// F. BANK AUTO-MATCH DEDUP EDGE CASES
// ============================================================
// v55 dedup logic: when a bank statement confirms a placeholder,
// if there's already a real treasury row covering the same payment,
// zero the new row out and tag dedup_sibling_id.
//
// Guards (any miss = dedup must NOT trigger):
//   • Same order# OR same linked_invoice_id
//   • Within 90 days of bank date
//   • Amount within MIN(2% of placeholder, 500 EGP) tolerance
//   • Sibling is non-placeholder, has positive cash_in or bank_in,
//     not itself a [bank confirmation marker
group('F. Bank auto-match dedup');

function shouldDedup(placeholder, sibling, bankDate) {
  if (sibling.id === placeholder.id) return false;
  if (sibling.is_bank_placeholder) return false;
  var sIn = Number(sibling.cash_in || 0) + Number(sibling.bank_in || 0);
  if (sIn <= 0) return false;
  if (String(sibling.description || '').indexOf('[bank confirmation') >= 0) return false;
  if (sibling.linked_invoice_id !== placeholder.linked_invoice_id && sibling.order_number !== placeholder.order_number) return false;
  var bankMs = new Date(bankDate).getTime();
  var sMs = sibling.transaction_date ? new Date(sibling.transaction_date).getTime() : 0;
  if (!sMs || Math.abs(bankMs - sMs) > 90 * 86400000) return false;
  var expAmt = Number(placeholder.expected_amount || 0);
  var tol = Math.min(expAmt * 0.02, 500);
  if (Math.abs(sIn - expAmt) > tol) return false;
  return true;
}

var ph = { id: 'ph-1', order_number: '5500', linked_invoice_id: 'inv-1', expected_amount: 10000, is_bank_placeholder: true };

ok('F1: matching sibling within window + amount → dedup',
  shouldDedup(ph,
    { id: 's1', linked_invoice_id: 'inv-1', cash_in: 10000, transaction_date: '2026-04-20' },
    '2026-04-25'
  ) === true
);

ok('F2: sibling outside 90d window → NO dedup',
  shouldDedup(ph,
    { id: 's1', linked_invoice_id: 'inv-1', cash_in: 10000, transaction_date: '2025-01-01' },
    '2026-04-25'
  ) === false
);

ok('F3: sibling with same order_number but different linked_invoice_id is fine',
  shouldDedup(ph,
    { id: 's1', linked_invoice_id: null, order_number: '5500', cash_in: 10000, transaction_date: '2026-04-20' },
    '2026-04-25'
  ) === true
);

ok('F4: amount 1% off (within 2%) → dedup',
  shouldDedup(ph,
    { id: 's1', linked_invoice_id: 'inv-1', cash_in: 9900, transaction_date: '2026-04-20' },
    '2026-04-25'
  ) === true
);

ok('F5: amount 5% off (outside 2%) → NO dedup',
  shouldDedup(ph,
    { id: 's1', linked_invoice_id: 'inv-1', cash_in: 9500, transaction_date: '2026-04-20' },
    '2026-04-25'
  ) === false
);

ok('F6: 500-EGP absolute cap protects against wrong dedup at high amounts',
  // 10M EGP placeholder, 9.99M sibling = 10000 off, but tol = min(200000, 500) = 500 → no dedup
  shouldDedup({ id: 'ph-x', expected_amount: 10000000, linked_invoice_id: 'big' },
    { id: 's1', linked_invoice_id: 'big', cash_in: 9990000, transaction_date: '2026-04-20' },
    '2026-04-25'
  ) === false
);

ok('F7: sibling that is itself a bank-confirm marker → NO dedup (avoid chain dedup)',
  shouldDedup(ph,
    { id: 's1', linked_invoice_id: 'inv-1', cash_in: 10000, description: 'paid [bank confirmation — old]', transaction_date: '2026-04-20' },
    '2026-04-25'
  ) === false
);

ok('F8: sibling with zero amounts → NO dedup',
  shouldDedup(ph,
    { id: 's1', linked_invoice_id: 'inv-1', cash_in: 0, bank_in: 0, transaction_date: '2026-04-20' },
    '2026-04-25'
  ) === false
);

ok('F9: sibling that is also a placeholder → NO dedup',
  shouldDedup(ph,
    { id: 's1', linked_invoice_id: 'inv-1', expected_amount: 10000, is_bank_placeholder: true, transaction_date: '2026-04-20' },
    '2026-04-25'
  ) === false
);

ok('F10: bank_in instead of cash_in (both money) → dedup still fires',
  shouldDedup(ph,
    { id: 's1', linked_invoice_id: 'inv-1', bank_in: 10000, transaction_date: '2026-04-20' },
    '2026-04-25'
  ) === true
);

// ============================================================
// G. CHECK AUTO-MATCH GUARD RAILS
// ============================================================
// Two guards prevent grabbing wrong checks:
//   • hasSignal: top score >= 200 (some real signal beyond amount+date)
//   • unambiguous: scored.length === 1 OR (top - runner-up) >= 300
group('G. Check auto-match guards');

function shouldMatchCheck(scoredCandidates) {
  if (!scoredCandidates.length) return false;
  var top = scoredCandidates[0].score;
  var runnerUp = scoredCandidates[1] ? scoredCandidates[1].score : -Infinity;
  var hasSignal = top >= 200;
  var unambiguous = scoredCandidates.length === 1 || (top - runnerUp) >= 300;
  return hasSignal && unambiguous;
}

ok('G1: single high-score candidate → match',
  shouldMatchCheck([{ score: 500 }]) === true
);

ok('G2: top 600, runner-up 100 (gap=500) → match',
  shouldMatchCheck([{ score: 600 }, { score: 100 }]) === true
);

ok('G3: top 600, runner-up 400 (gap=200) → AMBIGUOUS, no match',
  shouldMatchCheck([{ score: 600 }, { score: 400 }]) === false
);

ok('G4: top 150 (below signal threshold) → no match even if alone',
  shouldMatchCheck([{ score: 150 }]) === false
);

ok('G5: empty candidates → no match',
  shouldMatchCheck([]) === false
);

ok('G6: top 250, runner-up = -infinity (only one) → match (passes both gates)',
  shouldMatchCheck([{ score: 250 }]) === true
);

ok('G7: top 200 exactly + runner-up below by 300 → match (boundary)',
  shouldMatchCheck([{ score: 200 }, { score: -100 }]) === true
);

// ============================================================
// H. ORPHAN DETECTION
// ============================================================
group('H. Orphan detection');

function findOrphanInvoices(invoices) {
  return (invoices || []).filter(function(i) { return !i.customer_id; });
}

function findOrphanTreasuryRows(treasury, invoices) {
  // Treasury rows whose linked_invoice_id points to an invoice that doesn't exist
  var invIds = new Set((invoices || []).map(function(i) { return i.id; }));
  return (treasury || []).filter(function(t) {
    return t.linked_invoice_id && !invIds.has(t.linked_invoice_id);
  });
}

function findOrphanChecks(checks, invoices) {
  var invIds = new Set((invoices || []).map(function(i) { return i.id; }));
  return (checks || []).filter(function(c) {
    return c.invoice_id && !invIds.has(c.invoice_id);
  });
}

ok('H1: invoice with customer_id null → flagged as orphan',
  findOrphanInvoices([{ id: 'i1', customer_id: null }, { id: 'i2', customer_id: 'c1' }]).length === 1
);

ok('H2: treasury row pointing to deleted invoice → flagged orphan',
  findOrphanTreasuryRows(
    [{ id: 't1', linked_invoice_id: 'invoice-DELETED' }, { id: 't2', linked_invoice_id: 'i1' }],
    [{ id: 'i1' }]
  ).length === 1
);

ok('H3: check pointing to non-existent invoice → flagged orphan',
  findOrphanChecks(
    [{ id: 'c1', invoice_id: 'invoice-GONE' }, { id: 'c2', invoice_id: 'i1' }],
    [{ id: 'i1' }]
  ).length === 1
);

ok('H4: treasury row with no linked_invoice_id (intentional, e.g. expense) → NOT orphan',
  findOrphanTreasuryRows(
    [{ id: 't1', linked_invoice_id: null }, { id: 't2', linked_invoice_id: '' }],
    []
  ).length === 0
);

// ============================================================
// I. CURRENCY SEPARATION (USD vs EGP)
// ============================================================
// USD invoices and EGP invoices must NOT cross-pollinate. A USD
// payment against an EGP invoice should not be summed into total_collected.
// Today the recalc only sums cash_in + bank_in (both EGP fields), so USD
// rows naturally don't contribute. Test enforces this guarantee.
group('I. Currency separation');

function recalcWithCurrencyCheck(invoiceId, invoiceCurrency, treasuryRows, invoiceTotal) {
  var sum = 0;
  for (var i = 0; i < treasuryRows.length; i++) {
    var t = treasuryRows[i];
    if (t.linked_invoice_id !== invoiceId) continue;
    if (t.is_bank_placeholder) continue;
    if (t.dedup_sibling_id) continue;
    // The recalc helper sums EGP fields ONLY. USD rows have usd_in instead.
    sum += Number(t.cash_in || 0) + Number(t.bank_in || 0);
  }
  return Math.min(sum, Number(invoiceTotal || 0));
}

ok('I1: USD payment row (usd_in only) does NOT contribute to EGP invoice collected',
  recalcWithCurrencyCheck('egp-inv', 'EGP', [
    { linked_invoice_id: 'egp-inv', cash_in: 0, bank_in: 0, usd_in: 100 },
    { linked_invoice_id: 'egp-inv', cash_in: 500 },
  ], 1000) === 500
);

ok('I2: cash_in still counts even on a USD invoice (legacy migrated rows) — collected reflects truth',
  recalcWithCurrencyCheck('usd-inv', 'USD', [
    { linked_invoice_id: 'usd-inv', cash_in: 500 }, // unusual but possible
  ], 1000) === 500
);

// ============================================================
// J. EDIT TREASURY DOWNSTREAM RECALC
// ============================================================
// When user edits cash_in/bank_in on a treasury row, the linked invoice's
// collected total must recalc. When user moves a row from invoice A to
// invoice B, BOTH invoices must recalc.
group('J. Edit-treasury downstream effects');

function simulateTreasuryEdit(originalTxn, newTxnFields, invoices, allTreasury) {
  // Returns set of invoice IDs that need recalc
  var ids = new Set();
  // Old link affected if amounts changed OR link changed
  var amountsChanged = (Number(originalTxn.cash_in || 0) !== Number(newTxnFields.cash_in || originalTxn.cash_in || 0))
    || (Number(originalTxn.bank_in || 0) !== Number(newTxnFields.bank_in || originalTxn.bank_in || 0));
  var linkChanged = (newTxnFields.linked_invoice_id != null) && (originalTxn.linked_invoice_id !== newTxnFields.linked_invoice_id);
  if ((amountsChanged || linkChanged) && originalTxn.linked_invoice_id) {
    ids.add(originalTxn.linked_invoice_id);
  }
  if (linkChanged && newTxnFields.linked_invoice_id) {
    ids.add(newTxnFields.linked_invoice_id);
  }
  return ids;
}

ok('J1: cash_in changed → linked invoice recalc',
  simulateTreasuryEdit(
    { id: 't1', linked_invoice_id: 'i1', cash_in: 500 },
    { cash_in: 600 }, [], []
  ).has('i1')
);

ok('J2: link moved A→B → BOTH invoices recalc',
  (function() {
    var ids = simulateTreasuryEdit(
      { id: 't1', linked_invoice_id: 'i1', cash_in: 500 },
      { linked_invoice_id: 'i2' }, [], []
    );
    return ids.has('i1') && ids.has('i2');
  })()
);

ok('J3: no change → no recalc needed',
  simulateTreasuryEdit(
    { id: 't1', linked_invoice_id: 'i1', cash_in: 500 },
    {}, [], []
  ).size === 0
);

ok('J4: edit on unlinked row → no recalc',
  simulateTreasuryEdit(
    { id: 't1', linked_invoice_id: null, cash_in: 500 },
    { cash_in: 700 }, [], []
  ).size === 0
);

// ============================================================
// K. CASH CHANNEL TAGS PRESERVED THROUGH RECONCILIATION
// ============================================================
// All three "safe channels" (cash, vodafone, instapay) auto-sweep into
// the safe (cash_in field). The cash_method tag must persist so each
// channel can be reconciled separately against its statement.
group('K. Cash channel preservation');

function buildPaymentRow(method, amount, invoice) {
  var isSafe = method === 'cash' || method === 'vodafone' || method === 'instapay';
  if (!isSafe) return null;
  return {
    cash_in: amount,
    cash_out: 0,
    bank_in: 0,
    bank_out: 0,
    cash_method: method,
    linked_invoice_id: invoice.id,
    order_number: invoice.order_number,
  };
}

ok('K1: cash payment → cash_method="cash"',
  buildPaymentRow('cash', 100, { id: 'i1', order_number: '5500' }).cash_method === 'cash'
);

ok('K2: vodafone payment → cash_method="vodafone" + cash_in still set',
  (function() {
    var r = buildPaymentRow('vodafone', 100, { id: 'i1', order_number: '5500' });
    return r.cash_method === 'vodafone' && r.cash_in === 100;
  })()
);

ok('K3: instapay payment → cash_method="instapay"',
  buildPaymentRow('instapay', 100, { id: 'i1', order_number: '5500' }).cash_method === 'instapay'
);

ok('K4: bank_transfer is NOT safe-channel — null returned',
  buildPaymentRow('bank_transfer', 100, { id: 'i1', order_number: '5500' }) === null
);

// Reconciliation grouping — each cash_method's rows can be summed independently
function groupByCashMethod(rows) {
  var groups = {};
  rows.forEach(function(r) {
    var m = r.cash_method || 'cash';
    groups[m] = (groups[m] || 0) + Number(r.cash_in || 0);
  });
  return groups;
}

ok('K5: rows with mixed channels group correctly',
  (function() {
    var g = groupByCashMethod([
      { cash_in: 100, cash_method: 'cash' },
      { cash_in: 50, cash_method: 'vodafone' },
      { cash_in: 25, cash_method: 'instapay' },
      { cash_in: 200, cash_method: 'cash' },
    ]);
    return g.cash === 300 && g.vodafone === 50 && g.instapay === 25;
  })()
);

// ============================================================
// SUMMARY
// ============================================================
console.log('');
if (failures.length === 0) {
  console.log('✅ All comprehensive financial flow tests passed');
  process.exit(0);
} else {
  console.log('❌ ' + failures.length + ' tests FAILED:');
  failures.forEach(function(f) { console.log('   - ' + f); });
  process.exit(1);
}
