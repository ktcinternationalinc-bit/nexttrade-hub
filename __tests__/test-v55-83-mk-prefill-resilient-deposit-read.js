// ============================================================
// v55.83-MK — live bug Max hit on "Preview deposit links": "Deposit read failed: column
// bank_transactions.wave_transaction_id does not exist". That column only exists if sql/v55-83-LF was run;
// the prefill route selected it EXPLICITLY, so the whole deposit read errored on any DB without the
// migration. Fix: select('*') (resilient) — a missing column reads as undefined (treated as not-yet-synced)
// instead of failing the request. No migration required to use Step 6.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var route = rd('src/app/api/wave/prefill-payment-links/route.js');

ok('1: the deposit read is resilient — select(*), not an explicit list that names wave_transaction_id',
  /var depRes = await db\.from\('bank_transactions'\)\.select\('\*'\)\.eq\('wave_business_id', waveBusinessId\)\.eq\('direction', 'in'\)/.test(route) &&
  !/select\('id, name, amount, amount_abs, posted_date, date, direction, matched_invoice_id, wave_transaction_id/.test(route));
ok('2: the already-synced filter still tolerates a missing wave_transaction_id (undefined → not skipped)',
  /\.filter\(function \(t\) \{ return !t\.matched_invoice_id && !t\.wave_transaction_id && !claimedDep\[t\.id\]; \}\)/.test(route));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-MK prefill-resilient-deposit-read tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
