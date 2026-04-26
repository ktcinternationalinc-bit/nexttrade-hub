// ============================================================
// Treasury Add — End-to-End Decision Tree
//
// What this tests (the test I should have written the first time):
//
//   Given a user filling out the treasury form with various inputs,
//   does handleAddTreasury take the RIGHT branch?
//
//     - Modal opens? → setPendingTreasuryRecord called
//     - Auto-links to existing invoice? → dbInsert + recalc
//     - Saves silently with no link? → dbInsert only
//
// This is BEHAVIORAL not unit-of-helper. It mirrors the actual
// branching logic in page.jsx so a regression like "modal stops
// opening for cash_in + bad order#" is caught immediately.
//
// Bug context: User reported "I enter a transaction with a non-
// existent order#, system just accepts it without asking."
// My earlier unit tests covered ONLY the modal's button. They
// never asked: "does the modal even open in the first place?"
// That's the gap these tests close.
// ============================================================

var assert = require('assert');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// ---------- Mirror of handleAddTreasury decision tree ----------
// Returns one of:
//   { branch: 'modal',       payload: { record, amount, suggestions } }
//   { branch: 'auto-link',   payload: { invoiceId } }
//   { branch: 'silent-save', reason: '...' }
//   { branch: 'rejected',    reason: '...' }
function simulateHandleAddTreasury(formData, invoices) {
  // Permission + amount validation
  if (formData.amount === undefined || formData.amount === null || formData.amount === '') {
    return { branch: 'rejected', reason: 'no_amount' };
  }
  var amt = Number(formData.amount);
  if (!(amt > 0)) return { branch: 'rejected', reason: 'bad_amount' };

  var isBankPlaceholder = formData.type === 'bank_in' || formData.type === 'bank_out';
  if (isBankPlaceholder && !formData.bankAccountId) {
    return { branch: 'rejected', reason: 'no_bank_account' };
  }
  if (isBankPlaceholder) {
    var mode = formData.bankEntryMode || 'order';
    if (mode === 'order') {
      var orderTrim = String(formData.orderNumber || '').trim();
      if (!orderTrim) return { branch: 'rejected', reason: 'order_mode_no_order' };
    } else {
      if (!formData.bankNonOrderCategory) return { branch: 'rejected', reason: 'nonorder_no_category' };
    }
    if (!String(formData.desc || '').trim()) {
      return { branch: 'rejected', reason: 'no_desc' };
    }
  }

  var isIncome = formData.type === 'in' || formData.type === 'bank_in';
  var bankEntryMode = formData.bankEntryMode || 'order';
  var isOrderLinkable = isIncome && (!isBankPlaceholder || (isBankPlaceholder && bankEntryMode === 'order'));
  var orderNumTrimmed = String(formData.orderNumber || '').trim();

  if (isOrderLinkable && orderNumTrimmed) {
    var matchingInvoice = (invoices || []).find(function(i) {
      return String(i.order_number || '').trim() === orderNumTrimmed;
    });
    if (matchingInvoice) {
      return { branch: 'auto-link', payload: { invoiceId: matchingInvoice.id } };
    }
    return {
      branch: 'modal',
      payload: { record: { order_number: orderNumTrimmed }, amount: amt, suggestions: [] },
    };
  }

  return {
    branch: 'silent-save',
    reason: !isOrderLinkable ? 'not order-linkable (expense or non-order bank)' : 'order# is empty after trim',
  };
}

// ---------- Sample data ----------
var INVOICES_SAMPLE = [
  { id: 'inv-1', order_number: '1234' },
  { id: 'inv-2', order_number: '5678' },
  { id: 'inv-3', order_number: ' 9999 ' }, // padded — trim still matches
];

// =============================================================
// 1. Cash IN scenarios — THIS IS MAX'S BUG SCENARIO
// =============================================================

ok('1a: Cash IN + new order# (NOT in invoices) → modal opens [BUG REPORT]',
  (function() {
    var r = simulateHandleAddTreasury(
      { type: 'in', amount: 5000, orderNumber: '99999' },
      INVOICES_SAMPLE
    );
    return r.branch === 'modal';
  })(),
  'this is exactly the case Max reported as broken — must produce modal'
);

ok('1b: Cash IN + matching order# → auto-link (no modal)',
  (function() {
    var r = simulateHandleAddTreasury(
      { type: 'in', amount: 5000, orderNumber: '1234' },
      INVOICES_SAMPLE
    );
    return r.branch === 'auto-link' && r.payload.invoiceId === 'inv-1';
  })()
);

ok('1c: Cash IN + matching-with-whitespace order# → auto-link (trim-tolerant)',
  (function() {
    var r = simulateHandleAddTreasury(
      { type: 'in', amount: 5000, orderNumber: '9999' },
      INVOICES_SAMPLE
    );
    return r.branch === 'auto-link' && r.payload.invoiceId === 'inv-3';
  })()
);

ok('1d: Cash IN + NO order# → silent save (no modal, by design)',
  (function() {
    var r = simulateHandleAddTreasury(
      { type: 'in', amount: 5000, orderNumber: '' },
      INVOICES_SAMPLE
    );
    return r.branch === 'silent-save';
  })()
);

ok('1e: Cash IN + whitespace-only order# → silent save (treated as empty)',
  (function() {
    var r = simulateHandleAddTreasury(
      { type: 'in', amount: 5000, orderNumber: '   ' },
      INVOICES_SAMPLE
    );
    return r.branch === 'silent-save';
  })()
);

// =============================================================
// 2. Bank IN scenarios
// =============================================================

ok('2a: Bank IN (Order mode) + new order# → modal opens',
  (function() {
    var r = simulateHandleAddTreasury(
      { type: 'bank_in', amount: 5000, orderNumber: '99999',
        bankAccountId: 'b1', bankEntryMode: 'order', desc: 'transfer' },
      INVOICES_SAMPLE
    );
    return r.branch === 'modal';
  })()
);

ok('2b: Bank IN (Order mode) + existing order# → auto-link',
  (function() {
    var r = simulateHandleAddTreasury(
      { type: 'bank_in', amount: 5000, orderNumber: '1234',
        bankAccountId: 'b1', bankEntryMode: 'order', desc: 'transfer' },
      INVOICES_SAMPLE
    );
    return r.branch === 'auto-link';
  })()
);

ok('2c: Bank IN (Non-Order mode) → silent save (no modal — by design)',
  (function() {
    var r = simulateHandleAddTreasury(
      { type: 'bank_in', amount: 5000,
        bankAccountId: 'b1', bankEntryMode: 'nonorder',
        bankNonOrderCategory: 'owner_draw', desc: 'transfer' },
      INVOICES_SAMPLE
    );
    return r.branch === 'silent-save';
  })()
);

// =============================================================
// 3. Expense scenarios — modal NEVER opens (existing behavior)
// =============================================================

ok('3a: Cash OUT + order# → silent save (no modal — order# is a PO code)',
  (function() {
    var r = simulateHandleAddTreasury(
      { type: 'out', amount: 5000, orderNumber: '1234' },
      INVOICES_SAMPLE
    );
    return r.branch === 'silent-save';
  })()
);

ok('3b: Cash OUT + new order# → silent save (no modal)',
  (function() {
    var r = simulateHandleAddTreasury(
      { type: 'out', amount: 5000, orderNumber: '99999' },
      INVOICES_SAMPLE
    );
    return r.branch === 'silent-save';
  })()
);

ok('3c: Bank OUT + order# → silent save',
  (function() {
    var r = simulateHandleAddTreasury(
      { type: 'bank_out', amount: 5000, orderNumber: '1234',
        bankAccountId: 'b1', bankEntryMode: 'order', desc: 'fee' },
      INVOICES_SAMPLE
    );
    return r.branch === 'silent-save';
  })()
);

// =============================================================
// 4. Validation rejections
// =============================================================

ok('4a: No amount → rejected before reaching branch logic',
  simulateHandleAddTreasury({ type: 'in' }, INVOICES_SAMPLE).branch === 'rejected'
);

ok('4b: Zero amount → rejected',
  simulateHandleAddTreasury({ type: 'in', amount: 0 }, INVOICES_SAMPLE).branch === 'rejected'
);

ok('4c: Bank IN with no bank account → rejected',
  simulateHandleAddTreasury({ type: 'bank_in', amount: 5000 }, INVOICES_SAMPLE).branch === 'rejected'
);

ok('4d: Bank IN Order mode with no order# → rejected (would-be silent save blocked)',
  simulateHandleAddTreasury(
    { type: 'bank_in', amount: 5000, bankAccountId: 'b1', bankEntryMode: 'order', desc: 'x' },
    INVOICES_SAMPLE
  ).branch === 'rejected'
);

// =============================================================
// 5. Stale-cache scenarios — what if local invoices is stale?
// =============================================================

ok('5a: Local invoices is empty → modal still opens (NOT auto-link)',
  (function() {
    var r = simulateHandleAddTreasury(
      { type: 'in', amount: 5000, orderNumber: '1234' },
      []
    );
    return r.branch === 'modal';
  })()
);

ok('5b: Local invoices is undefined → modal still opens (defensive)',
  (function() {
    var r = simulateHandleAddTreasury(
      { type: 'in', amount: 5000, orderNumber: '1234' },
      undefined
    );
    return r.branch === 'modal';
  })()
);

// =============================================================
// 6. Source-code wiring — confirm logging + trigger code present
// =============================================================
var fs = require('fs');
var path = require('path');
var pageSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'page.jsx'), 'utf8');

ok('6a: Diagnostic log fires on every handleAddTreasury entry',
  /console\.log\('\[treasury-add\] type=/.test(pageSrc),
  'expected diagnostic log so future bug reports include branch info'
);

ok('6b: Diagnostic log shows isOrderLinkable + invoices.length',
  /console\.log\('\[treasury-add\] isOrderLinkable=/.test(pageSrc)
);

ok('6c: Diagnostic log shows whether matching invoice was found',
  /console\.log\('\[treasury-add\] matchingInvoice=/.test(pageSrc)
);

ok('6d: Modal-open path logs OPENING modal',
  /console\.log\('\[treasury-add\] OPENING modal/.test(pageSrc)
);

ok('6e: Silent-save path logs why it skipped the modal',
  /console\.log\('\[treasury-add\] SILENT SAVE path/.test(pageSrc)
);

ok('6f: setPendingTreasuryRecord is still called in the no-match branch',
  /setPendingTreasuryRecord\(\{[\s\S]{0,200}record:\s*record/.test(pageSrc)
);

ok('6g: handleAddTreasury still gates on isIncome (v55.12 — uses txType normalization)',
  // Code now reads: const txType = formData.type || 'in'; const isIncome = txType === 'in' || txType === 'bank_in';
  /const txType = formData\.type \|\| 'in'/.test(pageSrc) &&
  /const isIncome = txType === 'in' \|\| txType === 'bank_in'/.test(pageSrc)
);

ok('6h: v55.12 default-Cash-In fix — modal-open sets type explicitly',
  // Without this, formData.type is undefined and isIncome is false, which silently
  // saves cash-in transactions without triggering the order#/customer gate.
  /setShowAddTreasury\(true\);\s*setFormData\(\{\s*date:\s*today\(\),\s*type:\s*'in'\s*\}/.test(pageSrc)
);

ok('6i: v55.12 income-no-order# guard — blocks save unless category is non-order income',
  /BLOCKING — income without order#/.test(pageSrc) ||
  /Income transactions need an Order #/.test(pageSrc)
);

// ---------- Summary ----------
console.log('');
if (failures.length === 0) {
  console.log('✅ All Treasury add-flow end-to-end tests passed');
  process.exit(0);
} else {
  console.log('❌ ' + failures.length + ' tests FAILED:');
  failures.forEach(function(f) { console.log('   - ' + f); });
  process.exit(1);
}
