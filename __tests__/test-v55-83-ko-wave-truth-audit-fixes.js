// ============================================================
// v55.83-KO — fixes from the multi-agent Wave truth-audit (UI claims must match what the routes require).
//  P0  bind route now re-stamps wave_products + bank_transaction_splits (were orphaned on rebind).
//  P1  badge: "writes enabled" not "push ON". Payment vs Invoice push readiness SPLIT into two panels.
//      sync-categories surfaces the REAL Wave error (HTTP/GraphQL/business:null), not a constant.
//      sync-products guards placeholder + no longer treats business:null as an empty catalog.
//  P2  push-payment/invoice/customer name the placeholder root cause; push-invoice surfaces inputErrors;
//      default-bank-account placeholder guard.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var bind = rd('src/app/api/wave/bind-business/route.js');
var sync = rd('src/components/WaveSyncCenter.jsx');
var cat = rd('src/app/api/wave/sync-categories/route.js');
var prod = rd('src/app/api/wave/sync-products/route.js');
var pp = rd('src/app/api/wave/push-payment/route.js');
var pi = rd('src/app/api/wave/push-invoice-v2/route.js');
var pc = rd('src/app/api/wave/push-customer/route.js');
var dba = rd('src/app/api/wave/default-bank-account/route.js');

ok('1 (P0): bind route re-stamps wave_products AND bank_transaction_splits (no orphaned rows after rebind)',
  /'wave_products', 'bank_transaction_splits'/.test(bind));
ok('2 (P1): payment readiness and invoice readiness are SEPARATE panels with the correct gates',
  /var payChecks = \[/.test(sync) && /var invChecks = \[/.test(sync) &&
  /'Payment push enabled \(super-admin toggle\)', reg\.allow_payment_push === true/.test(sync) &&
  /'Invoice push enabled \(super-admin toggle\)', reg\.allow_invoice_push === true/.test(sync) &&
  /'Default Invoice Product set \(one-time setup below\)', !!\(prodSetup && prodSetup\.default_invoice_product_id\)/.test(sync));
ok('3 (P1): payment panel does NOT gate on invoice product; notes the invoice must already be in Wave',
  !/payChecks[\s\S]{0,200}default_invoice_product_id/.test(sync) &&
  /invoice to already be in Wave/.test(sync));
ok('4 (P1): sync-categories surfaces the REAL Wave reason (HTTP / GraphQL errors / business:null)',
  /Wave rejected the request: ' \+ hMsg/.test(cat) &&
  /Wave API error: ' \+ \(parts\.length/.test(cat) &&
  /Wave returned no business for id ' \+ businessId \+ ' — the configured Wave token cannot access/.test(cat));
ok('5 (P1): sync-products guards a placeholder silo + no longer reports business:null as an empty catalog',
  /if \(onlyBiz && isPlaceholderWaveBusiness\(onlyBiz\)\)/.test(prod) &&
  /Wave rejected the product read: '/.test(prod) &&
  /j\.data\.business === null/.test(prod));
ok('6 (P2): push-payment names the placeholder root cause (not the production-lock message)',
  /import \{ isPlaceholderWaveBusiness \}/.test(pp) &&
  /isPlaceholderWaveBusiness\(waveBusinessId\)\) \{ return NextResponse\.json\(\{ ok: false, placeholder: true/.test(pp));
ok('7 (P2): push-invoice-v2 + push-customer guard the placeholder in canPush',
  /isPlaceholderWaveBusiness\(waveBusinessId\)\) \{ return \{ ok: false, message: 'This silo is not connected to a real Wave business yet \(placeholder id\)\. Bind it under Accounting -> Wave Connection before pushing invoices/.test(pi) &&
  /before pushing customers/.test(pc));
ok('8 (P2): push-invoice-v2 surfaces the real Wave reason (errors[] + inputErrors[]) instead of a constant',
  /Wave rejected the invoice: ' \+ _icReason/.test(pi) &&
  /ic\.inputErrors && ic\.inputErrors\.length/.test(pi));
ok('9 (P2): default-bank-account has the placeholder guard',
  /isPlaceholderWaveBusiness\(bid\)\) \{ return NextResponse\.json\(\{ error: 'This silo is not connected to a real Wave business yet \(placeholder id\)/.test(dba));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-KO wave-truth-audit-fix tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
