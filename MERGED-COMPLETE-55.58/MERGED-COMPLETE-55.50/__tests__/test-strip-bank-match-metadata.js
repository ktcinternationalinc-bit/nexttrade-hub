// ============================================================
// stripBankMatchMetadata + Create-Invoice customer-name pre-fill
//
// Bug reported by Max (Apr 25, 2026):
//   When clicking "+ Create Invoice Now" from a treasury entry that
//   has been auto-matched to a bank statement, the customer name
//   field was pre-filled with text like:
//      "ايداع اشرف سلطان ✅ matched bank 2026-03-29"
//   The "✅ matched bank YYYY-MM-DD" portion is reconciliation
//   metadata appended by the bank-match system — it does NOT belong
//   on an invoice's customer name.
//
// Three auto-appended suffixes can be present on a treasury
// description:
//   1.  [awaiting bank confirmation]
//   2.  ✅ matched bank YYYY-MM-DD
//   3.  [auto-matched from bank YYYY-MM-DD]
//
// Fix:
//   - Added stripBankMatchMetadata() helper in lib/utils.js
//   - Customer-name pre-fill in the "+ Create Invoice Now" handler
//     now runs descText through the helper before using it
//
// These tests lock both pieces in.
// ============================================================

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// ---------- 1. stripBankMatchMetadata helper ----------
// Mirror of the implementation in lib/utils.js — kept here so tests
// run without import/require gymnastics. If the regex changes,
// update both places.
function stripBankMatchMetadata(desc) {
  if (!desc || typeof desc !== 'string') return desc || '';
  return desc
    .replace(/\s*✅\s*matched\s+bank\s+\d{4}-\d{2}-\d{2}.*$/u, '')
    .replace(/\s*\[awaiting bank confirmation\]/g, '')
    .replace(/\s*\[auto-matched from bank \d{4}-\d{2}-\d{2}\]/g, '')
    .trim();
}

// 1a–1d: each suffix individually
ok('1a: strips "✅ matched bank YYYY-MM-DD" suffix [BUG REPORT EXACTLY]',
  stripBankMatchMetadata('ايداع اشرف سلطان ✅ matched bank 2026-03-29') === 'ايداع اشرف سلطان'
);

ok('1b: strips "[awaiting bank confirmation]" suffix',
  stripBankMatchMetadata('Mohamed Ali [awaiting bank confirmation]') === 'Mohamed Ali'
);

ok('1c: strips "[auto-matched from bank YYYY-MM-DD]" suffix',
  stripBankMatchMetadata('شيك محصّل #5 [auto-matched from bank 2026-03-29]') === 'شيك محصّل #5'
);

ok('1d: preserves description with no metadata',
  stripBankMatchMetadata('ابراهيم محمد') === 'ابراهيم محمد'
);

// 1e: combinations + edge cases
ok('1e: strips both [awaiting] and ✅ matched in same string',
  stripBankMatchMetadata('Customer Name [awaiting bank confirmation] ✅ matched bank 2026-03-29') === 'Customer Name'
);

ok('1f: handles no spaces before ✅',
  stripBankMatchMetadata('Customer✅ matched bank 2026-03-29') === 'Customer'
);

ok('1g: handles double-space / weird whitespace before ✅',
  stripBankMatchMetadata('Customer  ✅ matched bank 2026-03-29') === 'Customer'
);

ok('1h: empty string → empty string',
  stripBankMatchMetadata('') === ''
);

ok('1i: null / undefined safe',
  stripBankMatchMetadata(null) === '' && stripBankMatchMetadata(undefined) === ''
);

ok('1j: non-string input safe (defensive)',
  stripBankMatchMetadata(42) === 42
);

ok('1k: pure metadata (no real description) → empty after strip',
  stripBankMatchMetadata(' ✅ matched bank 2026-03-29') === ''
);

ok('1l: Arabic with metadata in middle of long string — strips from match onward',
  stripBankMatchMetadata('عميل قديم — دفعة جزئية ✅ matched bank 2025-12-31') === 'عميل قديم — دفعة جزئية'
);

ok('1m: trailing whitespace after metadata removed too',
  stripBankMatchMetadata('Customer Name ✅ matched bank 2026-03-29   ') === 'Customer Name'
);

ok('1n: any extra text after the date ALSO stripped (e.g. operator notes)',
  stripBankMatchMetadata('Customer Name ✅ matched bank 2026-03-29 (operator note)') === 'Customer Name'
);

// ---------- 2. Customer-name resolution pipeline ----------
// Models the actual flow: descText → stripped → exact-match lookup
function resolveCustomerOnCreateInvoice(rawDesc, customers) {
  var descText = stripBankMatchMetadata(rawDesc).trim();
  var exactMatch = descText
    ? customers.find(function(c) { return String(c.name || '').trim() === descText; })
    : null;
  return {
    descText: descText,
    customerId: exactMatch ? exactMatch.id : null,
  };
}

ok('2a: bug scenario — bank-matched desc, customer EXISTS → auto-links to customer',
  (function() {
    var custs = [{ id: 'c1', name: 'ايداع اشرف سلطان' }];
    var r = resolveCustomerOnCreateInvoice('ايداع اشرف سلطان ✅ matched bank 2026-03-29', custs);
    return r.descText === 'ايداع اشرف سلطان' && r.customerId === 'c1';
  })(),
  'before fix: descText included the metadata so the customer match never fired'
);

ok('2b: bank-matched desc, customer DOES NOT EXIST → clean name, no link',
  (function() {
    var custs = [{ id: 'c1', name: 'someone else' }];
    var r = resolveCustomerOnCreateInvoice('ابراهيم ✅ matched bank 2026-03-29', custs);
    return r.descText === 'ابراهيم' && r.customerId === null;
  })()
);

ok('2c: awaiting-bank desc → strips, looks up clean name',
  (function() {
    var custs = [{ id: 'c2', name: 'محمد علي' }];
    var r = resolveCustomerOnCreateInvoice('محمد علي [awaiting bank confirmation]', custs);
    return r.descText === 'محمد علي' && r.customerId === 'c2';
  })()
);

ok('2d: completely metadata-only desc → empty descText, no link',
  (function() {
    var r = resolveCustomerOnCreateInvoice(' ✅ matched bank 2026-03-29', []);
    return r.descText === '' && r.customerId === null;
  })()
);

ok('2e: clean desc, no metadata → unchanged behavior (regression check)',
  (function() {
    var custs = [{ id: 'c3', name: 'أحمد' }];
    var r = resolveCustomerOnCreateInvoice('أحمد', custs);
    return r.descText === 'أحمد' && r.customerId === 'c3';
  })()
);

// ---------- 3. Source code wiring ----------
var utilsPath = path.join(__dirname, '..', 'src', 'lib', 'utils.js');
var utilsSrc = fs.readFileSync(utilsPath, 'utf8');
var pagePath = path.join(__dirname, '..', 'src', 'app', 'page.jsx');
var pageSrc = fs.readFileSync(pagePath, 'utf8');

ok('3a: utils.js exports stripBankMatchMetadata',
  /export const stripBankMatchMetadata\s*=/.test(utilsSrc)
);

ok('3b: utils.js handles all THREE suffix variants',
  utilsSrc.indexOf('matched bank') > -1
    && utilsSrc.indexOf('awaiting bank confirmation') > -1
    && utilsSrc.indexOf('auto-matched from bank') > -1
);

ok('3c: page.jsx imports stripBankMatchMetadata from utils',
  /import\s*\{[^}]*stripBankMatchMetadata[^}]*\}\s*from\s*'\.\.\/lib\/utils'/.test(pageSrc)
);

ok('3d: "+ Create Invoice Now" handler runs desc through stripBankMatchMetadata',
  /var descText = stripBankMatchMetadata\(rawDesc\)\.trim\(\)/.test(pageSrc)
);

ok('3e: stripBankMatchMetadata is called BEFORE the customers.find lookup',
  (function() {
    var stripIdx = pageSrc.indexOf('stripBankMatchMetadata(rawDesc)');
    // The exactMatch logic uses customers.find — find the FIRST one AFTER stripIdx
    var afterStrip = pageSrc.substring(stripIdx);
    var findIdx = afterStrip.indexOf('customers.find(');
    return stripIdx > -1 && findIdx > -1 && findIdx < 500; // within ~500 chars
  })()
);

// ---------- 4. Regression — earlier customer-link tests still hold ----------
// (i.e. the strip helper doesn't accidentally break exact-match logic)
ok('4a: clean desc still matches existing customer (not regressed)',
  (function() {
    var r = resolveCustomerOnCreateInvoice('Ali Hassan', [{ id: 'c1', name: 'Ali Hassan' }]);
    return r.customerId === 'c1';
  })()
);

ok('4b: substring still does NOT match (no false-positive linking)',
  (function() {
    var r = resolveCustomerOnCreateInvoice('Ali', [{ id: 'c1', name: 'Ali Hassan' }]);
    return r.customerId === null;
  })()
);

// ---------- Summary ----------
console.log('');
if (failures.length === 0) {
  console.log('✅ All stripBankMatchMetadata + create-invoice pre-fill tests passed');
  process.exit(0);
} else {
  console.log('❌ ' + failures.length + ' tests FAILED:');
  failures.forEach(function(f) { console.log('   - ' + f); });
  process.exit(1);
}
