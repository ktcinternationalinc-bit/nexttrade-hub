// ============================================================
// v55.83-HN — overpayment must never vanish from the books.
//
// Bug: in BankReviewTab.applyToInvoice the overpayment portion of a deposit
// (the part beyond the invoice balance) was recorded as a customer credit ONLY
// when the matcher had picked mCustomerId. If not, the overpayment was silently
// dropped — the payment row only stores applied_to_invoice (capped), so the
// residual money disappeared.
//
// Fix: credit defaults to the INVOICE's customer (mCustomerId || inv.accounting_customer_id);
// if there is truly no customer, park the residual as an unapplied_deposit.
//
// Part 1 locks the pure overpayment math (classifyApplication).
// Part 2 locks the source wiring so the gating bug can't come back.
// ============================================================

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// ---- load the pure functions from source (ESM export → eval the two functions) ----
var src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'payment-matching.js'), 'utf8');
var roundSrc = src.substring(src.indexOf('function roundMoney'), src.indexOf('// Classify'));
var classifySrc = src.substring(src.indexOf('function classifyApplication'), src.indexOf('return {', src.indexOf('function classifyApplication')) );
// grab full classifyApplication incl. its return block
classifySrc = src.substring(src.indexOf('function classifyApplication'), src.indexOf('}\n', src.indexOf('balance_due')) + 1);
// eslint-disable-next-line no-eval
eval(roundSrc);
// eslint-disable-next-line no-eval
eval(classifySrc);

// ---- 1. overpayment math ----
ok('1a: partial — apply < remaining', (function () { var c = classifyApplication(1000, 0, 400); return c.type === 'partial' && c.applied_to_invoice === 400 && c.overpayment === 0; })());
ok('1b: full — apply == remaining', (function () { var c = classifyApplication(1000, 0, 1000); return c.type === 'full' && c.applied_to_invoice === 1000 && c.overpayment === 0; })());
ok('1c: overpayment — apply > remaining caps applied + reports residual', (function () { var c = classifyApplication(1000, 0, 1250); return c.type === 'overpayment' && c.applied_to_invoice === 1000 && c.overpayment === 250; })());
ok('1d: overpayment on partially-paid invoice', (function () { var c = classifyApplication(1000, 600, 500); return c.type === 'overpayment' && c.applied_to_invoice === 400 && c.overpayment === 100; })());
ok('1e: applied + overpayment always equals the deposit (money conserved)', (function () {
  var total = 1000, paid = 200, apply = 950; var c = classifyApplication(total, paid, apply);
  return Math.abs((c.applied_to_invoice + c.overpayment) - apply) < 1e-9;
})());

// ---- 2. source wiring (the fix) ----
var bank = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'BankReviewTab.jsx'), 'utf8');
ok('2a: overpayment branch no longer gated on mCustomerId alone',
  bank.indexOf('if (c.overpayment > 0 && mCustomerId)') === -1);
ok('2b: credit customer defaults to the invoice customer',
  /creditCustId\s*=\s*mCustomerId\s*\|\|\s*inv\.accounting_customer_id/.test(bank));
ok('2c: residual with no customer falls back to an unapplied_deposit (never dropped)',
  bank.indexOf("dbInsert('unapplied_deposits'") > -1 && /creditCustId/.test(bank));

console.log('');
if (failures.length === 0) {
  console.log('✅ All v55.83-HN overpayment-credit tests passed');
  process.exit(0);
} else {
  console.log('❌ ' + failures.length + ' tests FAILED:');
  failures.forEach(function (f) { console.log('   - ' + f); });
  process.exit(1);
}
