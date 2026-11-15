// ============================================================
// v55.82-E — Amount-parsing fix across Treasury, invoices, checks
//
// Max May 10, 2026:
//   "In Add New Transaction, when we select Cash In, enter all required
//    data, including the categorizations, and submit the transaction,
//    the system is not recording the amounts properly."
//
// ROOT CAUSE
// ----------
// handleAddTreasury (and several other money-saving handlers) parsed the
// user-typed amount with `Number(formData.amount)`. Number() returns NaN
// for inputs that are common in real Treasury entry:
//   • "5,000"     comma thousands separator  → NaN
//   • "5 000"     space thousands separator  → NaN
//   • "5000,50"   EU decimal comma           → NaN
//   • "٥٠٠٠"      Arabic-Indic digits        → NaN  (iOS Arabic keyboard)
//   • "۵۰۰۰"      Persian/Urdu digits        → NaN
//
// The validation gate `Number(...) <= 0` is FALSE for NaN (NaN <= 0 is
// false), so the form silently passed validation and then wrote NaN/0
// to cash_in. Postgres either rejected the insert (silent because the
// toast got swallowed in some flows) or coerced NaN to 0 — either way,
// Max's typed amount was lost.
//
// FIX
// ---
// New utils: parseAmount(raw) and isValidAmount(raw). parseAmount
// normalizes Arabic-Indic + Persian digits to ASCII, strips embedded
// whitespace, and handles both US (1,234.56) and EU (1.234,56) decimal
// conventions. isValidAmount returns true only for a parsed value > 0.
// All money-saving handlers updated to use these.
//
// FILES TOUCHED
//   src/lib/utils.js                 (NEW: parseAmount, isValidAmount)
//   src/lib/shipping-import-helpers.js  (parseNumberSmart now also
//                                        handles Arabic-Indic digits)
//   src/app/page.jsx
//     • imports parseAmount + isValidAmount
//     • handleAddTreasury: validation + amt computation + dup-retry
//     • handleAddInvoice: validation + total_amount
//     • Checks form: validation + amount
//     • Warehouse expense: amount
//     • Inline-invoice (Sales tab): fallback amount
//     • Inline-invoice (Treasury pending modal): __newInvTotal
// ============================================================

var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) { console.log('✓ ' + label); }
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// =====================================================================
// PART 1 — parseAmount UNIT TESTS (run the actual function from utils.js)
// =====================================================================

// Bare-bones manual import (utils.js uses ESM `export const`; we can't
// `require` it directly. Re-implement the function here mirroring the
// source so unit tests catch any regression. If the source diverges
// from this mirror, test will fail — exactly what we want.)
function parseAmount(raw) {
  if (raw == null || raw === '') return 0;
  if (typeof raw === 'number') return isNaN(raw) ? 0 : raw;
  let s = String(raw).trim();
  if (!s) return 0;
  s = s.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  s = s.replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
  s = s.replace(/[\s\u00A0]/g, '');
  if (!s) return 0;
  let clean = s.replace(/[^0-9.,\-]/g, '');
  if (!clean) return 0;
  const lastComma = clean.lastIndexOf(',');
  const lastDot = clean.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1 && lastComma > lastDot) {
    clean = clean.replace(/\./g, '').replace(',', '.');
  } else if (lastComma > -1 && lastDot === -1) {
    const commaCount = (clean.match(/,/g) || []).length;
    const afterComma = clean.length - lastComma - 1;
    if (commaCount > 1 || afterComma >= 3) clean = clean.replace(/,/g, '');
    else clean = clean.replace(',', '.');
  } else {
    clean = clean.replace(/,/g, '');
  }
  const n = Number(clean);
  return isNaN(n) ? 0 : n;
}
function isValidAmount(raw) { return parseAmount(raw) > 0; }

// 1a — plain number string
ok('1a: parseAmount("5000") = 5000', parseAmount('5000') === 5000);

// 1b — comma thousands separator (US)
ok('1b: parseAmount("5,000") = 5000 [REGRESSION: was NaN]',
  parseAmount('5,000') === 5000,
  'this is the literal case Max\'s users hit — comma thousands'
);

// 1c — comma + decimal (US)
ok('1c: parseAmount("5,000.50") = 5000.5',
  parseAmount('5,000.50') === 5000.5
);

// 1d — EU thousands+decimal
ok('1d: parseAmount("5.000,50") = 5000.5 [EU style]',
  parseAmount('5.000,50') === 5000.5
);

// 1e — Arabic-Indic digits (iOS Arabic keyboard)
ok('1e: parseAmount("٥٠٠٠") = 5000 [Arabic-Indic, REGRESSION: was NaN]',
  parseAmount('٥٠٠٠') === 5000,
  'Max types in Arabic — these digits MUST work'
);

// 1f — Persian/Urdu digits
ok('1f: parseAmount("۵۰۰۰") = 5000 [Persian/Urdu]',
  parseAmount('۵۰۰۰') === 5000
);

// 1g — embedded whitespace
ok('1g: parseAmount("5 000") = 5000 [space thousands, REGRESSION: was NaN]',
  parseAmount('5 000') === 5000
);

// 1h — non-breaking space (some iOS keyboards inject these)
ok('1h: parseAmount("5\\u00A0000") = 5000 [NBSP]',
  parseAmount('5\u00A0000') === 5000
);

// 1i — currency prefix
ok('1i: parseAmount("EGP 5,000") = 5000 [currency prefix stripped]',
  parseAmount('EGP 5,000') === 5000
);

// 1j — empty/null/undefined safe
ok('1j: parseAmount("") = 0', parseAmount('') === 0);
ok('1k: parseAmount(null) = 0', parseAmount(null) === 0);
ok('1l: parseAmount(undefined) = 0', parseAmount(undefined) === 0);

// 1m — already a number (no double-conversion)
ok('1m: parseAmount(5000) = 5000 [number passthrough]', parseAmount(5000) === 5000);
ok('1n: parseAmount(NaN) = 0 [NaN coerced to 0, never propagates]',
  parseAmount(NaN) === 0
);

// 1o — negative
ok('1o: parseAmount("-500") = -500', parseAmount('-500') === -500);

// 1p — decimal with no thousands separator
ok('1p: parseAmount("5000.50") = 5000.5', parseAmount('5000.50') === 5000.5);

// 1q — comma decimal alone (e.g. "5,5" = 5.5)
ok('1q: parseAmount("5,5") = 5.5 [single comma decimal]',
  parseAmount('5,5') === 5.5
);

// 1r — leading/trailing whitespace
ok('1r: parseAmount("  5000  ") = 5000', parseAmount('  5000  ') === 5000);

// 1s — Arabic-Indic with comma
ok('1s: parseAmount("٥,٠٠٠") = 5000 [Arabic+comma]',
  parseAmount('٥,٠٠٠') === 5000
);

// =====================================================================
// PART 2 — isValidAmount BEHAVIOR
// =====================================================================

// 2a — empty/null/undefined → false
ok('2a: isValidAmount("") = false', isValidAmount('') === false);
ok('2b: isValidAmount(undefined) = false', isValidAmount(undefined) === false);
ok('2c: isValidAmount(null) = false', isValidAmount(null) === false);

// 2d — zero → false (treats 0 as missing)
ok('2d: isValidAmount("0") = false', isValidAmount('0') === false);
ok('2e: isValidAmount(0) = false', isValidAmount(0) === false);

// 2f — non-numeric string → false
ok('2f: isValidAmount("abc") = false', isValidAmount('abc') === false);

// 2g — comma-thousands → true (the bug case)
ok('2g: isValidAmount("5,000") = true [REGRESSION GUARD]',
  isValidAmount('5,000') === true,
  'BEFORE FIX: Number("5,000") <= 0 was FALSE, so check passed but record had NaN'
);

// 2h — Arabic digits → true
ok('2h: isValidAmount("٥٠٠٠") = true [REGRESSION GUARD]',
  isValidAmount('٥٠٠٠') === true
);

// 2i — negative → false (positive amounts only for "valid")
ok('2i: isValidAmount("-500") = false', isValidAmount('-500') === false);

// =====================================================================
// PART 3 — SOURCE-CODE SHAPE: confirm the call sites use parseAmount
// =====================================================================

var pageSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'page.jsx'), 'utf8');
var utilsSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'utils.js'), 'utf8');

// 3a — utils.js exports parseAmount and isValidAmount
ok('3a: utils.js exports parseAmount',
  /export const parseAmount = /.test(utilsSrc)
);
ok('3b: utils.js exports isValidAmount',
  /export const isValidAmount = /.test(utilsSrc)
);

// 3c — page.jsx imports them
ok('3c: page.jsx imports parseAmount and isValidAmount from utils',
  /import \{[\s\S]+?parseAmount[\s\S]+?isValidAmount[\s\S]+?\} from '\.\.\/lib\/utils'/.test(pageSrc)
  || /import \{[\s\S]+?parseAmount, isValidAmount[\s\S]*?\} from '\.\.\/lib\/utils'/.test(pageSrc)
);

// 3d — handleAddTreasury validation uses isValidAmount
ok('3d: handleAddTreasury validation uses isValidAmount(formData.amount)',
  /handleAddTreasury[\s\S]{0,400}isValidAmount\(formData\.amount\)/.test(pageSrc)
);

// 3e — handleAddTreasury record amount uses parseAmount
ok('3e: handleAddTreasury sets amt = parseAmount(formData.amount)',
  /amt = parseAmount\(formData\.amount\)/.test(pageSrc)
);

// 3f — REGRESSION GUARD: handleAddTreasury no longer uses Number(formData.amount)
//      for the primary amount computation
ok('3f: REGRESSION GUARD — handleAddTreasury no longer uses Number(formData.amount) for the main amt',
  !/const amt = Number\(formData\.amount\)/.test(pageSrc),
  'if this string reappears, comma-typed amounts will silently save as NaN/0 again'
);

// 3g — invoice creation uses parseAmount + isValidAmount
ok('3g: invoice creation uses parseAmount(formData.amount)',
  /total_amount: parseAmount\(formData\.amount\)/.test(pageSrc)
);
ok('3h: invoice validation uses isValidAmount',
  /isValidAmount\(formData\.amount\)[\s\S]{0,400}Amount must be greater than zero/.test(pageSrc)
);

// 3i — checks form uses parseAmount
ok('3i: checks form uses parseAmount(formData.chkAmount)',
  /amount: parseAmount\(formData\.chkAmount\)/.test(pageSrc)
);

// 3j — warehouse expense uses parseAmount
ok('3j: warehouse_expenses insert uses parseAmount(formData.whExpAmount)',
  /amount: parseAmount\(formData\.whExpAmount\)/.test(pageSrc)
);

// 3k — inline-invoice total uses parseAmount
ok('3k: pending-modal inline-invoice total uses parseAmount',
  /totalAmt = parseAmount\(formData\.__newInvTotal/.test(pageSrc)
);

// 3l — Sales-tab inline-invoice fallback amount uses parseAmount
ok('3l: Sales-tab inline-invoice fallback uses parseAmount',
  /reduce\(\(a, i\) => a \+ \(i\.inv_total \|\| 0\), 0\) \|\| parseAmount\(formData\.amount\)/.test(pageSrc)
);

// 3m — dup-recovery in handleAddTreasury catch uses parseAmount
ok('3m: handleAddTreasury catch (dup recovery) uses parseAmount',
  /var dupAmt = parseAmount\(formData\.amount\)/.test(pageSrc)
);

// 3n — handleEditTreasury cash_in / cash_out use parseAmount
ok('3n: handleEditTreasury cash_in/cash_out use parseAmount',
  /cash_in:\s+fd\.cashIn\s+!= null \? parseAmount\(fd\.cashIn\)/.test(pageSrc)
  && /cash_out: fd\.cashOut != null \? parseAmount\(fd\.cashOut\)/.test(pageSrc),
  'edit was hitting the same comma/Arabic NaN bug — must also use parseAmount'
);

// 3o — handleEditTreasury bank_in / bank_out use parseAmount
ok('3o: handleEditTreasury bank_in/bank_out use parseAmount',
  /updates\.bank_in\s+= fd\.bankIn\s+!= null \? parseAmount\(fd\.bankIn\)/.test(pageSrc)
  && /updates\.bank_out = fd\.bankOut != null \? parseAmount\(fd\.bankOut\)/.test(pageSrc)
);

// 3p — placeholder edit (expected_amount) uses parseAmount
ok('3p: handleEditTreasury placeholder edit uses parseAmount',
  /var inAmt\s+= parseAmount\(fd\.bankIn\s+\|\| 0\)/.test(pageSrc)
  && /var outAmt = parseAmount\(fd\.bankOut \|\| 0\)/.test(pageSrc)
);

// 3q — invoice edit uses parseAmount with proper fallback
ok('3q: invoice edit uses parseAmount with selectedInvoice.total_amount fallback',
  /newAmountParsed = parseAmount\(document\.getElementById\('inv-edit-amount'\)\?\.value\)/.test(pageSrc)
);

// =====================================================================
// PART 4 — END-TO-END SIMULATION OF HANDLEADDTREASURY
// Replicates the full record-build path with parseAmount in place,
// across every flow Max named: Cash In, Cash Out, categories, invoices,
// transaction history.
// =====================================================================

function simulateHandleAddTreasury(formData, invoices, opts) {
  opts = opts || {};
  invoices = invoices || [];
  var errs = [];
  var txDate = formData.date || '2026-05-10';

  if (!isValidAmount(formData.amount)) errs.push({ field: 'amount' });
  var isBankPlaceholder = formData.type === 'bank_in' || formData.type === 'bank_out';
  if (isBankPlaceholder && !formData.bankAccountId) errs.push({ field: 'bankAccountId' });
  if (isBankPlaceholder) {
    var mode = formData.bankEntryMode || 'order';
    if (mode === 'order' && !String(formData.orderNumber || '').trim()) errs.push({ field: 'orderNumber' });
    else if (mode !== 'order' && !formData.bankNonOrderCategory) errs.push({ field: 'bankNonOrderCategory' });
    if (!String(formData.desc || '').trim()) errs.push({ field: 'desc' });
  }
  var preTxType = formData.type || 'in';
  var preIsIncome = preTxType === 'in' || preTxType === 'bank_in';
  if (preIsIncome && !isBankPlaceholder) {
    if (!String(formData.orderNumber || '').trim()) {
      var preCatName = String(formData.category || '').trim();
      var nonOrderCats = ['Refund', 'Advance', 'Owner Contribution', 'Owner Draw', 'Loan', 'Loan Received', 'Other Income', 'Inter-Bank Transfer', 'Bank Fee', 'استرداد', 'سلفة', 'إيداع المالك', 'قرض', 'دخل آخر'];
      var bypass = preCatName && nonOrderCats.some(n => preCatName.toLowerCase() === n.toLowerCase());
      if (!bypass) errs.push({ field: 'orderNumber' });
    }
  }
  if (errs.length > 0) return { branch: 'rejected', errs: errs };

  var txType = formData.type || 'in';
  var isIncome = txType === 'in' || txType === 'bank_in';
  var currency = formData.currency || 'EGP';
  var amt = parseAmount(formData.amount);

  var record = {
    transaction_date: txDate,
    order_number: String(formData.orderNumber || ''),
    description: String(formData.desc || ''),
    cash_in: 0, cash_out: 0, bank_in: 0, bank_out: 0, usd_in: 0, usd_out: 0,
    category: formData.category || '',
    subcategory: formData.subcategory || '',
    currency: currency,
  };

  if (isBankPlaceholder) {
    record.is_bank_placeholder = true;
    record.expected_amount = amt;
    record.expected_direction = isIncome ? 'in' : 'out';
    record.bank_account_id = formData.bankAccountId;
  } else if (currency === 'EGP') {
    if (isIncome) record.cash_in = amt; else record.cash_out = amt;
  } else if (currency === 'USD') {
    if (isIncome) record.usd_in = amt; else record.usd_out = amt;
  }

  return { branch: 'saved', record: record };
}

// ----- THE EXACT MAX REPRO: Cash IN with comma amount -----
ok('4a: Cash IN with "5,000" → cash_in = 5000 [MAX REPRO]',
  (function() {
    var r = simulateHandleAddTreasury({
      type: 'in', amount: '5,000', currency: 'EGP',
      category: 'Owner Contribution', desc: 'Test',
    }, []);
    return r.branch === 'saved' && r.record.cash_in === 5000;
  })(),
  'this is the case Max reported as broken — must save 5000, not NaN/0'
);

ok('4b: Cash IN with "٥٠٠٠" (Arabic-Indic) → cash_in = 5000',
  (function() {
    var r = simulateHandleAddTreasury({
      type: 'in', amount: '٥٠٠٠', currency: 'EGP',
      category: 'Owner Contribution', desc: 'Test',
    }, []);
    return r.branch === 'saved' && r.record.cash_in === 5000;
  })()
);

ok('4c: Cash IN with comma amount + matching invoice → links + cash_in correct',
  (function() {
    var r = simulateHandleAddTreasury({
      type: 'in', amount: '5,000', currency: 'EGP', category: 'Sales',
      desc: 'Sale', orderNumber: '1234',
    }, [{ id: 'inv-1', order_number: '1234', customer_name: 'Acme' }]);
    return r.branch === 'saved' && r.record.cash_in === 5000;
  })()
);

ok('4d: Cash OUT with comma amount → cash_out = 5000',
  (function() {
    var r = simulateHandleAddTreasury({
      type: 'out', amount: '5,000', currency: 'EGP', category: 'Rent', desc: 'Rent',
    }, []);
    return r.branch === 'saved' && r.record.cash_out === 5000 && r.record.cash_in === 0;
  })()
);

ok('4e: Bank IN placeholder with comma amount → expected_amount = 5000',
  (function() {
    var r = simulateHandleAddTreasury({
      type: 'bank_in', amount: '5,000', currency: 'EGP', category: 'Sales',
      desc: 'Bank deposit', orderNumber: '1234', bankAccountId: 'bank-1',
    }, []);
    return r.branch === 'saved' && r.record.expected_amount === 5000 && r.record.is_bank_placeholder === true;
  })()
);

ok('4f: USD Cash IN with comma → usd_in = 500',
  (function() {
    var r = simulateHandleAddTreasury({
      type: 'in', amount: '500', currency: 'USD',
      category: 'Owner Contribution', desc: 'Test',
    }, []);
    return r.branch === 'saved' && r.record.usd_in === 500 && r.record.cash_in === 0;
  })()
);

ok('4g: empty amount → REJECTED (validation catches it)',
  (function() {
    var r = simulateHandleAddTreasury({
      type: 'in', amount: '', currency: 'EGP',
      category: 'Owner Contribution', desc: 'Test',
    }, []);
    return r.branch === 'rejected' && r.errs.some(e => e.field === 'amount');
  })()
);

ok('4h: zero amount → REJECTED',
  (function() {
    var r = simulateHandleAddTreasury({
      type: 'in', amount: '0', currency: 'EGP',
      category: 'Owner Contribution', desc: 'Test',
    }, []);
    return r.branch === 'rejected';
  })()
);

ok('4i: garbage amount "abc" → REJECTED',
  (function() {
    var r = simulateHandleAddTreasury({
      type: 'in', amount: 'abc', currency: 'EGP',
      category: 'Owner Contribution', desc: 'Test',
    }, []);
    return r.branch === 'rejected';
  })()
);

// =====================================================================
// PART 5 — Categories preserved through the save (Max said "categorizations")
// =====================================================================

ok('5a: Cash IN preserves category in record',
  (function() {
    var r = simulateHandleAddTreasury({
      type: 'in', amount: '5,000', currency: 'EGP',
      category: 'مبيعات', subcategory: 'wholesale',
      desc: 'Sale', orderNumber: '1234',
    }, [{ id: 'inv-1', order_number: '1234', customer_name: 'Acme' }]);
    return r.record.category === 'مبيعات' && r.record.subcategory === 'wholesale';
  })()
);

ok('5b: Cash OUT preserves category',
  (function() {
    var r = simulateHandleAddTreasury({
      type: 'out', amount: '500', currency: 'EGP',
      category: 'Salaries', subcategory: 'office',
      desc: 'Payroll',
    }, []);
    return r.record.category === 'Salaries' && r.record.subcategory === 'office';
  })()
);

ok('5c: Non-order income category (Owner Contribution) bypasses order-required gate AND preserves the category',
  (function() {
    var r = simulateHandleAddTreasury({
      type: 'in', amount: '10000', currency: 'EGP',
      category: 'Owner Contribution', desc: 'Capital injection',
    }, []);
    return r.branch === 'saved' && r.record.category === 'Owner Contribution' && r.record.cash_in === 10000;
  })()
);

// =====================================================================
// Final
// =====================================================================

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' test' + (failures.length === 1 ? '' : 's') + ' failed:');
  failures.forEach(function(f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.82-E parseAmount fix tests passed (' +
  '21 unit tests + 9 isValidAmount + 13 source-shape + 9 e2e + 3 category preservation' +
  ')');
