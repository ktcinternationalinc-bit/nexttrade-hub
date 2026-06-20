// ============================================================
// v55.83-KP — Codex: don't make the user infer Wave readiness from five scattered checkboxes. Add a
// one-glance top-of-Settings status summary (Production writes / Payment push / Invoice push / Category
// dropdown → READY/BLOCKED) where each BLOCKED item names its exact next action.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var sync = rd('src/components/WaveSyncCenter.jsx');

ok('1: a top-level "Wave setup status" summary exists at the top of Settings',
  /Wave setup status — /.test(sync) &&
  /function Row\(label, ready, nextAction, okText\)/.test(sync));
ok('2: it computes READY/BLOCKED for payment, invoice, and category dropdown from the REAL gates',
  /var payReady = !ph && canOperate && canWrite && !!\(reg && reg\.allow_payment_push === true\) && hasPayAcct;/.test(sync) &&
  /var invReady = !ph && canOperate && canWrite && !!\(reg && reg\.allow_invoice_push === true\) && hasInvProd;/.test(sync) &&
  /var catReady = !ph && catCount > 0;/.test(sync));
ok('3: payment readiness is NOT gated on the invoice product (only deposit account)',
  /function payNext\(\)[\s\S]{0,400}Set the payment deposit account/.test(sync) &&
  !/function payNext\(\)[\s\S]{0,400}Invoice Product/.test(sync));
ok('4: each blocked item names a concrete next action (incl. bind for a placeholder silo)',
  /Bind this silo \(Wave Connection\)/.test(sync) &&
  /Set the Default Invoice Product \(below\)/.test(sync) &&
  /Pull Wave categories \(below\) \/ check token access/.test(sync));
ok('5: a placeholder silo shows the universal BLOCKED-until-bound warning in the summary',
  /This silo is not connected to a real Wave business \(placeholder id\) — bind it in Accounting/.test(sync) &&
  /isPlaceholderWaveBusiness\(active\)/.test(sync));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-KP readiness-summary tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
