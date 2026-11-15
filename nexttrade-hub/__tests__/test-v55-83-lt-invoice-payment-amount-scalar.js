// ============================================================
// v55.83-LT — LIVE: "Check Wave payments" (and the prefill, same query) errored with
//   Field "amount" must not have a selection since type "String" has no subfields.
// Wave's InvoicePayment.amount is a STRING scalar, but both queries asked for amount{ value currency... }.
// Fix: select `amount` as a scalar; parse it tolerantly (string | {value} | number). Guard both routes.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var readback = rd('src/app/api/wave/payment-readback/route.js');
var prefill = rd('src/app/api/wave/prefill-payment-links/route.js');

ok('1: payment-readback selects InvoicePayment.amount as a SCALAR (no amount{ value } subfield selection)',
  /'id amount paymentDate paymentMethod memo account\{ id name \}'/.test(readback) &&
  !/amount\{ value/.test(readback));
ok('2: prefill selects payment amount as a SCALAR (no amount{ value } subfield selection)',
  /payments\{ id amount paymentDate account\{ id name \} \}/.test(prefill) &&
  !/amount\{ value/.test(prefill));
ok('3: both num() helpers parse a STRING amount (not only {value} objects), so amounts aren\'t silently 0',
  /var v = Number\(String\(m\)\.replace\(\/\[,\$\\s\]\/g, ''\)\); return isNaN\(v\) \? 0 : v;/.test(readback) &&
  /var v = Number\(String\(m\)\.replace\(\/\[,\$\\s\]\/g, ''\)\); return isNaN\(v\) \? 0 : v;/.test(prefill));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-LT invoice-payment-amount-scalar tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
