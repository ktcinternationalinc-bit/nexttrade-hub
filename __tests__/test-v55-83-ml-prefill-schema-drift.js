// ============================================================
// v55.83-ML - Step 6 Wave invoice-payment prefill must survive schema drift.
// Live failure: "Deposit read failed: column bank_transactions.wave_transaction_id does not exist".
// The prefill route should not explicitly select that optional column; missing means undefined and
// is treated as "not pushed" instead of crashing the whole Wave payment import.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];

function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
function ok(label, cond) {
  if (cond) { console.log('OK ' + label); }
  else { failures.push(label); console.log('FAIL ' + label); }
}

var route = rd('src/app/api/wave/prefill-payment-links/route.js');
var page = rd('src/app/page.jsx');
var wn = rd('src/components/WhatsNewWidget.jsx');
var runner = rd('scripts/run-accounting-bank-regression.js');

ok('1: prefill route marker is ML and visible build is MM or newer',
  /v55\.83-ML-prefill-payment-links/.test(route) &&
  /v55\.83-MM/.test(page) &&
  /version: 'v55\.83-MM'/.test(wn));

ok('2: deposit read no longer names optional bank_transactions.wave_transaction_id in the select list',
  /from\('bank_transactions'\)\.select\('\*'\)\.eq\('wave_business_id', waveBusinessId\)\.eq\('direction', 'in'\)/.test(route) &&
  !/select\('[^']*wave_transaction_id[^']*'\)\.eq\('wave_business_id', waveBusinessId\)\.eq\('direction', 'in'\)/.test(route));

ok('3: missing wave_transaction_id still filters safely as undefined, preserving idempotency when the column exists',
  /!t\.matched_invoice_id && !t\.wave_transaction_id && !claimedDep\[t\.id\]/.test(route));

ok('4: the fix is included in the accounting-bank regression gate',
  /test-v55-83-ml-prefill-schema-drift\.js/.test(runner));

console.log('');
if (failures.length === 0) { console.log('All v55.83-ML prefill schema-drift tests passed'); process.exit(0); }
console.log(failures.length + ' FAILED:');
failures.forEach(function (f) { console.log('   - ' + f); });
process.exit(1);
