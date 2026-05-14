// v55.83-A.6.6 (Max May 13 2026) — Reconciliation includes collected checks.
//
// Bug: invoice 2302 showed MISMATCH because the reconciliation total only
// counted treasury cash_in + bank_in. 10,700 in treasury + 20,000 collected
// check = 30,700 total, matching the invoice. But MISMATCH banner fired
// claiming "Sales 30,700 vs Treasury 10,700".
//
// Same bug hit the Payment-Source Breakdown card — showed "100% Cash" when
// the actual mix was 35% cash + 65% check.
//
// Fix: new tTotalForInvoice() helper in page.jsx adds collected check
// amounts to the treasury total. Used by StatusBadge, sales report
// categorizer, and invoice modal reconciliation. Payment-Source Breakdown
// shims collected checks as virtual rows with payment_source='check' and
// amount, and aggregatePaymentSources in utils.js recognizes that form.

var fs = require('fs');
var path = require('path');
var page = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'page.jsx'), 'utf8');
var utils = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'utils.js'), 'utf8');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// 1. Helper function added
ok('1a: tTotalForInvoice helper defined in page.jsx',
  /const tTotalForInvoice = \(invoice\) =>/.test(page));
ok('1b: helper sums treasury cash_in + bank_in',
  /tTotalForInvoice[\s\S]{0,400}cash_in \|\| 0\) \+ Number\(t\.bank_in \|\| 0\)/.test(page));
ok('1c: helper adds collected check amounts',
  /tTotalForInvoice[\s\S]{0,800}c\.status === 'collected'[\s\S]{0,200}reduce[\s\S]{0,150}c\.amount/.test(page));

// 2. All three call sites use the helper (no more raw cash+bank sum)
ok('2a: StatusBadge uses tTotalForInvoice',
  /const StatusBadge = \(\{ invoice \}\) => \{\s*const tTotal = tTotalForInvoice\(invoice\)/.test(page));
ok('2b: Sales report categorizer uses tTotalForInvoice',
  /invoices\.forEach\(inv => \{\s*const tTotal = tTotalForInvoice\(inv\)/.test(page));
ok('2c: Invoice modal reconciliation uses tTotalForInvoice',
  /Reconciliation Status[\s\S]{0,400}const tTotal = tTotalForInvoice\(selectedInvoice\)/.test(page));

// 3. Payment-Source Breakdown shims collected checks
ok('3a: payment breakdown filters collected checks for this order',
  /collectedChks = \(checks \|\| \)\.filter\(c =>[\s\S]{0,300}c\.status === 'collected'/.test(page) ||
  /collectedChks[\s\S]{0,150}filter[\s\S]{0,200}status === 'collected'/.test(page));
ok('3b: virtual check rows tagged payment_source=check',
  /virtualCheckRows[\s\S]{0,300}payment_source: 'check'/.test(page));
ok('3c: virtual rows merged with txns before aggregation',
  /txnsWithChecks = txns\.concat\(virtualCheckRows\)/.test(page));
ok('3d: aggregatePaymentSources called with merged set',
  /aggregatePaymentSources\(txnsWithChecks\)/.test(page));

// 4. aggregatePaymentSources recognizes virtual check rows
ok('4a: aggregatePaymentSources handles check virtual rows (no cash_in/bank_in)',
  /payment_source \|\| ''\)\.trim\(\)\.toLowerCase\(\) === 'check'[\s\S]{0,200}n\(t\.amount\) \|\| n\(t\.check_amount\)/.test(utils));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.6 check-reconciliation tests passed');
