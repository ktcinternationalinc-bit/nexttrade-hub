// ============================================================
// v55.83-HO — unmatch must reverse the overpayment customer credit.
//
// Bug (paired with HN): unmatch() voided the invoice payment + payment_matches and
// recomputed the invoice balance, but left the overpayment customer_credits row "open"
// → the customer kept a phantom credit they never had.
//
// Fix: unmatch() now voids customer_credits WHERE source_transaction_id = t.id AND
// status = 'open' (source_transaction_id is set ONLY by the overpayment credit path, so
// the scope is exact). Non-fatal, like the payment_matches void.
//
// Intentional NON-fix (Codex-agreed): unapplied_deposits created by the rare
// overpayment-with-no-customer fallback share bank_transaction_id with manually-created
// unapplied deposits, so they are NOT auto-voided on unmatch (would risk clobbering a real
// manual deposit). This test documents that decision so it isn't "fixed" wrongly later.
//
// Source-wiring test: the void-on-unmatch is a DB-update chain inside the component, so we
// lock the wiring rather than execute Supabase.
// ============================================================

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

var bank = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'BankReviewTab.jsx'), 'utf8');

// isolate the unmatch() function body so assertions are scoped to it
var umStart = bank.indexOf('function unmatch(');
ok('0: unmatch() exists', umStart > -1);
var umEnd = bank.indexOf('\n  function ', umStart + 1);
var unmatchSrc = umEnd > umStart ? bank.substring(umStart, umEnd) : bank.substring(umStart);

// 1. unmatch reverses the overpayment credit, scoped correctly
ok('1a: unmatch voids customer_credits',
  unmatchSrc.indexOf("from('customer_credits')") > -1 && /status:\s*'void'/.test(unmatchSrc));
ok('1b: scoped by source_transaction_id (the overpayment-only tag)',
  /eq\('source_transaction_id',\s*t\.id\)/.test(unmatchSrc));
ok('1c: only reverses still-open credits',
  /eq\('status',\s*'open'\)/.test(unmatchSrc));
ok('1d: the credit reversal is non-fatal (cannot break unmatch)',
  /customer_credits[\s\S]{0,400}non-fatal/.test(unmatchSrc) || /customer_credits[\s\S]{0,400}function \(e\)/.test(unmatchSrc));

// 2. the overpayment credit insert stamps source_transaction_id so the scope above is valid
ok('2a: overpayment credit insert stamps source_transaction_id: t.id',
  /customer_credits[\s\S]{0,300}source_transaction_id:\s*t\.id/.test(bank));

// 3. document the intentional non-reversal of unapplied_deposits on unmatch
ok('3a: unmatch does NOT blanket-void unapplied_deposits by bank_transaction_id',
  unmatchSrc.indexOf("from('unapplied_deposits')") === -1);

console.log('');
if (failures.length === 0) {
  console.log('✅ All v55.83-HO unmatch credit-reversal tests passed');
  process.exit(0);
} else {
  console.log('❌ ' + failures.length + ' tests FAILED:');
  failures.forEach(function (f) { console.log('   - ' + f); });
  process.exit(1);
}
