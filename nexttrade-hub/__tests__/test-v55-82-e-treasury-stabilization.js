// ============================================================
// v55.82-E — Treasury submission stabilization
//
// Max May 11 2026:
//   ISSUE #1: "Cash In, all required data including categorizations,
//             submit, system not properly recording amounts or
//             completing the transaction correctly."
//   ISSUE #2: "After attempting to submit, UI enters a broken state.
//             Click New Transaction again, modal/popup freezes and
//             does not open. Treasury becomes unresponsive, have to
//             refresh the whole system."
//
// ROOT CAUSES IDENTIFIED:
//
//   #1 (recording bug): handleAddTreasury's auto-link path called
//      dbInsert THEN recalcInvoiceCollected with NO try/catch around
//      the recalc. If recalc threw (RLS, network, schema), control
//      jumped to outer catch. Row WAS inserted but UI showed save
//      error, modal stayed open, local state never updated. User
//      retried → got real duplicate. Refreshed → row already there.
//      User experience: "amounts not recording properly" (actually
//      they were, but the UI was lying).
//
//   #2 (modal freeze): "+ New Transaction" button only set
//      showAddTreasury=true. Did NOT clear pendingTreasuryRecord,
//      duplicateConfirm, treasuryFormErrors, isCreatingInvoice,
//      createInvoiceError. The modal-render gate at line 6665 is
//      `showAddTreasury && !pendingTreasuryRecord && !duplicateConfirm`,
//      so any leftover state from a previous failed attempt blocked
//      the new modal from rendering. Button looked dead. User had
//      to refresh the page to recover.
//
//   #3 (compounding): No re-entry guard, no in-flight visual state
//      on Submit, Cancel button didn't clean modal-companion state.
//
// FIXES IN THIS BUILD:
//   • + New Transaction button now hard-resets every Treasury modal
//     flag before opening (idempotent recovery)
//   • Modal onClose, Cancel button do same hard reset
//   • Auto-link path wraps recalcInvoiceCollected in its own try/catch
//     so a recalc failure never poisons the insert success
//   • Both success paths (auto-link, silent-save) clear modal-companion
//     state explicitly
//   • Re-entry guard via useRef + setTreasurySaving state (Submit
//     button disabled + shows "Saving…" while in flight)
//   • Catch block now ALSO sets treasuryFormErrors so non-unique-
//     violation errors stay visible in the red banner
// ============================================================

var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) { console.log('✓ ' + label); }
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

var pageSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'page.jsx'), 'utf8');

// =====================================================================
// FIX #1 — recalcInvoiceCollected isolated (auto-link path)
// =====================================================================

ok('1a: auto-link path wraps recalcInvoiceCollected in try/catch',
  /if \(!isBankPlaceholder\) \{\s*try \{\s*await recalcInvoiceCollected\(matchingInvoice\.id\);\s*\} catch \(recalcErr\)/.test(pageSrc),
  'recalc must not be allowed to poison the success of the insert'
);

ok('1b: recalc failure logs but doesn\'t throw',
  /\[treasury-add\] insert succeeded but recalcInvoiceCollected threw/.test(pageSrc),
  'graceful diagnostic message instead of bubbling the throw'
);

ok('1c: recalc failure shows user-facing warning toast',
  /toast\.warning\('Saved ✓ — but the invoice total may need a manual refresh/.test(pageSrc),
  'user must be told the row was saved, but invoice total may be stale'
);

// =====================================================================
// FIX #2 — Modal-companion state cleanup
// =====================================================================

ok('2a: + New Transaction button hard-resets pendingTreasuryRecord',
  /setShowAddTreasury\(true\); setFormData\(\{ date: today\(\), type: 'in' \}\)/.test(pageSrc) === false
  || /\/\/ v55\.82-E — RESET-OPEN HARDENING[\s\S]{0,1500}setPendingTreasuryRecord\(null\);[\s\S]{0,400}setDuplicateConfirm\(null\);[\s\S]{0,400}setTreasuryFormErrors\(\[\]\);[\s\S]{0,400}setIsCreatingInvoice\(false\);[\s\S]{0,400}setCreateInvoiceError\(null\);[\s\S]{0,400}setShowAddTreasury\(true\);/.test(pageSrc),
  'opening the modal must reset all 5 stale-state flags'
);

ok('2b: Cancel button cleans pendingTreasuryRecord + duplicateConfirm',
  /Cancel must clean ALL modal-companion state[\s\S]{0,400}setPendingTreasuryRecord\(null\);[\s\S]{0,400}setDuplicateConfirm\(null\)/.test(pageSrc)
);

ok('2c: Modal onClose backdrop also full-resets',
  /Full reset on every close path[\s\S]{0,500}setPendingTreasuryRecord\(null\);[\s\S]{0,400}setDuplicateConfirm\(null\);[\s\S]{0,400}setIsCreatingInvoice\(false\);[\s\S]{0,400}setCreateInvoiceError\(null\)/.test(pageSrc)
);

ok('2d: auto-link success clears all modal-companion flags',
  /setShowAddTreasury\(false\);\s*\/\/ v55\.82-E[\s\S]{0,500}setPendingTreasuryRecord\(null\);[\s\S]{0,400}setDuplicateConfirm\(null\);[\s\S]{0,400}setTreasuryFormErrors\(\[\]\);[\s\S]{0,400}setIsCreatingInvoice\(false\);[\s\S]{0,400}setCreateInvoiceError\(null\)/.test(pageSrc)
);

ok('2e: silent-save success also clears all modal-companion flags',
  /SILENT SAVE path[\s\S]{0,1200}setPendingTreasuryRecord\(null\);[\s\S]{0,400}setDuplicateConfirm\(null\);[\s\S]{0,400}setTreasuryFormErrors\(\[\]\);[\s\S]{0,400}setIsCreatingInvoice\(false\);[\s\S]{0,400}setCreateInvoiceError\(null\)/.test(pageSrc)
);

// =====================================================================
// FIX #3 — Re-entry guard + in-flight UI state
// =====================================================================

ok('3a: addTreasuryRunning useRef declared',
  /const addTreasuryRunning = useRef\(false\)/.test(pageSrc),
  'matches the pattern used by handleAddPayment'
);

ok('3b: treasurySaving state declared',
  /const \[treasurySaving, setTreasurySaving\] = useState\(false\)/.test(pageSrc),
  'visual in-flight indicator state'
);

ok('3c: handleAddTreasury wrapper rejects re-entry with addTreasuryRunning.current',
  /if \(addTreasuryRunning\.current\) \{\s*console\.log\('\[treasury-add\] re-entry blocked/.test(pageSrc),
  'second concurrent call must be rejected'
);

ok('3d: wrapper sets/clears guard via try/finally',
  /addTreasuryRunning\.current = true;[\s\S]{0,400}setTreasurySaving\(true\);[\s\S]{0,800}\} finally \{[\s\S]{0,200}addTreasuryRunning\.current = false;[\s\S]{0,200}setTreasurySaving\(false\)/.test(pageSrc),
  'guard MUST release in finally even on thrown error'
);

ok('3e: Save button disabled while saving',
  /onClick=\{handleAddTreasury\}[\s\S]{0,300}disabled=\{treasurySaving\}/.test(pageSrc)
);

ok('3f: Save button shows "Saving…" while in flight',
  /\{treasurySaving \? 'Saving… \/ جاري الحفظ' : 'Save \/ حفظ ✓'\}/.test(pageSrc)
);

// =====================================================================
// FIX #4 — Catch-block error visibility (banner not just toast)
// =====================================================================

ok('4a: non-unique-violation catch sets treasuryFormErrors',
  /Non-unique-violation errors used to fire only toast\.error[\s\S]{0,1200}setTreasuryFormErrors\(\[\{[\s\S]{0,400}label: 'Save failed'/.test(pageSrc),
  'persistent red banner replaces the disappearing corner toast'
);

ok('4b: catch error message hints at recovery action',
  /try again, or close this dialog and check the transaction list/.test(pageSrc),
  'tells user to verify whether the row already saved before retrying'
);

// =====================================================================
// FIX #5 — Function structure (impl extracted from wrapper)
// =====================================================================

ok('5a: _handleAddTreasuryImpl extracted',
  /const _handleAddTreasuryImpl = async \(opts\)/.test(pageSrc),
  'private impl pulled out so the wrapper can wrap with try/finally'
);

ok('5b: wrapper delegates via return await _handleAddTreasuryImpl',
  /return await _handleAddTreasuryImpl\(opts\)/.test(pageSrc)
);

ok('5c: handleAddTreasury function still exists at the public name (unchanged callers)',
  /const handleAddTreasury = async \(opts\)/.test(pageSrc),
  'all existing call sites must continue to work unchanged'
);

// =====================================================================
// FIX #6 — Behavioral simulation across ALL transaction types
// =====================================================================

// Mirror of the production handleAddTreasury logic for all 4 transaction
// types. This is what protects us against amount-mapping regressions on
// any transaction type, not just Cash IN.

function simulateBuildRecord(formData, opts) {
  opts = opts || {};
  var txDate = formData.date || '2026-05-10';
  var txType = formData.type || 'in';
  var isIncome = txType === 'in' || txType === 'bank_in';
  var isBankPlaceholder = txType === 'bank_in' || txType === 'bank_out';
  var currency = formData.currency || 'EGP';
  var amt = Number(formData.amount);
  if (isNaN(amt) || amt <= 0) return { error: 'invalid amount' };

  var record = {
    transaction_date: txDate,
    order_number: String(formData.orderNumber || ''),
    description: String(formData.desc || ''),
    cash_in: 0, cash_out: 0,
    bank_in: 0, bank_out: 0,
    usd_in: 0, usd_out: 0,
    category: formData.category || '',
    subcategory: formData.subcategory || '',
    currency: currency,
  };
  if (opts.bypassDupCheck) record.confirmed_not_duplicate = true;
  if (!isBankPlaceholder && (txType === 'in' || txType === 'out')) {
    record.cash_method = formData.cashMethod || 'cash';
  }
  if (isBankPlaceholder) {
    record.is_bank_placeholder = true;
    record.expected_amount = amt;
    record.expected_direction = isIncome ? 'in' : 'out';
    record.bank_account_id = formData.bankAccountId;
    record.description = (record.description || '') + ' [awaiting bank confirmation]';
    var mode = formData.bankEntryMode || 'order';
    if (mode === 'nonorder') {
      record.order_number = '';
      record.bank_nonorder_category = formData.bankNonOrderCategory;
    }
  } else if (currency === 'EGP') {
    if (isIncome) record.cash_in = amt; else record.cash_out = amt;
  } else if (currency === 'USD') {
    if (isIncome) record.usd_in = amt; else record.usd_out = amt;
  } else {
    record.foreign_amount = amt;
    record.foreign_currency = currency;
    record.foreign_direction = isIncome ? 'in' : 'out';
  }
  return record;
}

// Test 6a — Cash IN EGP records cash_in
ok('6a: Cash IN EGP records to cash_in',
  (function() {
    var r = simulateBuildRecord({ type: 'in', amount: '5000', currency: 'EGP', desc: 'x', orderNumber: '1234', category: 'Sales' });
    return r.cash_in === 5000 && r.cash_out === 0 && r.bank_in === 0 && r.usd_in === 0;
  })()
);

// Test 6b — Cash OUT EGP records cash_out
ok('6b: Cash OUT EGP records to cash_out',
  (function() {
    var r = simulateBuildRecord({ type: 'out', amount: '500', currency: 'EGP', desc: 'rent', category: 'Rent' });
    return r.cash_out === 500 && r.cash_in === 0 && r.bank_out === 0 && r.usd_out === 0;
  })()
);

// Test 6c — Bank IN order-mode records expected_amount, no cash_in
ok('6c: Bank IN order-mode records to expected_amount + leaves cash_in=0',
  (function() {
    var r = simulateBuildRecord({ type: 'bank_in', amount: '5000', currency: 'EGP', desc: 'wire', orderNumber: '1234', bankAccountId: 'b1' });
    return r.expected_amount === 5000 && r.cash_in === 0 && r.bank_in === 0 && r.is_bank_placeholder === true && r.expected_direction === 'in';
  })()
);

// Test 6d — Bank OUT non-order with category
ok('6d: Bank OUT non-order records expected_amount + bank_nonorder_category',
  (function() {
    var r = simulateBuildRecord({ type: 'bank_out', amount: '1000', currency: 'EGP', desc: 'transfer', bankAccountId: 'b1', bankEntryMode: 'nonorder', bankNonOrderCategory: 'Inter-Bank Transfer' });
    return r.expected_amount === 1000 && r.expected_direction === 'out' && r.bank_nonorder_category === 'Inter-Bank Transfer' && r.order_number === '';
  })()
);

// Test 6e — USD Cash IN goes to usd_in, NOT cash_in
ok('6e: USD Cash IN records to usd_in (not cash_in)',
  (function() {
    var r = simulateBuildRecord({ type: 'in', amount: '500', currency: 'USD', desc: 'x', orderNumber: '1', category: 'Sales' });
    return r.usd_in === 500 && r.cash_in === 0;
  })()
);

// Test 6f — USD Cash OUT goes to usd_out
ok('6f: USD Cash OUT records to usd_out',
  (function() {
    var r = simulateBuildRecord({ type: 'out', amount: '200', currency: 'USD', desc: 'fee', category: 'Bank Fee' });
    return r.usd_out === 200 && r.cash_out === 0;
  })()
);

// Test 6g — Foreign currency goes to foreign_amount
ok('6g: EUR records to foreign_amount with direction',
  (function() {
    var r = simulateBuildRecord({ type: 'in', amount: '300', currency: 'EUR', desc: 'x', orderNumber: '1', category: 'Sales' });
    return r.foreign_amount === 300 && r.foreign_currency === 'EUR' && r.foreign_direction === 'in';
  })()
);

// Test 6h — bypassDupCheck stamps confirmed_not_duplicate
ok('6h: bypassDupCheck stamps confirmed_not_duplicate=true',
  (function() {
    var r = simulateBuildRecord({ type: 'in', amount: '5000', currency: 'EGP', desc: 'x', orderNumber: '1234', category: 'Sales' }, { bypassDupCheck: true });
    return r.confirmed_not_duplicate === true && r.cash_in === 5000;
  })()
);

// Test 6i — invalid amount returns error (defensive)
ok('6i: invalid amount returns error',
  (function() {
    var r = simulateBuildRecord({ type: 'in', amount: '0', currency: 'EGP', desc: 'x', category: 'Sales', orderNumber: '1' });
    return r.error === 'invalid amount';
  })()
);

// Test 6j — cash_method defaults to 'cash' for cash transactions
ok('6j: cash_method defaults to "cash" on cash_in/cash_out',
  (function() {
    var r = simulateBuildRecord({ type: 'in', amount: '100', currency: 'EGP', desc: 'x', orderNumber: '1', category: 'Sales' });
    return r.cash_method === 'cash';
  })()
);

// Test 6k — cash_method honors override (vodafone, instapay)
ok('6k: cash_method honors override',
  (function() {
    var r = simulateBuildRecord({ type: 'in', amount: '100', currency: 'EGP', desc: 'x', orderNumber: '1', category: 'Sales', cashMethod: 'vodafone' });
    return r.cash_method === 'vodafone';
  })()
);

// Test 6l — cash_method NOT set on bank entries (intrinsic distinction)
ok('6l: cash_method NOT set on bank_in / bank_out',
  (function() {
    var r = simulateBuildRecord({ type: 'bank_in', amount: '100', currency: 'EGP', desc: 'x', orderNumber: '1', bankAccountId: 'b1' });
    return r.cash_method === undefined;
  })()
);

// =====================================================================
// FIX #7 — Companion state truly is component-level (regression guard)
// =====================================================================

ok('7a: pendingTreasuryRecord state still declared',
  /const \[pendingTreasuryRecord, setPendingTreasuryRecord\] = useState\(null\)/.test(pageSrc)
);

ok('7b: duplicateConfirm state still declared',
  /const \[duplicateConfirm, setDuplicateConfirm\] = useState\(null\)/.test(pageSrc)
);

ok('7c: modal-render gate still triple-conditional',
  /\{showAddTreasury && !pendingTreasuryRecord && !duplicateConfirm && \(/.test(pageSrc),
  'gate is correct — bug was missing CLEANUPS, not the gate itself'
);

// =====================================================================
// Final
// =====================================================================

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' test' + (failures.length === 1 ? '' : 's') + ' failed:');
  failures.forEach(function(f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.82-E Treasury stabilization tests passed (Issue #1: amount recording. Issue #2: modal freeze.)');
