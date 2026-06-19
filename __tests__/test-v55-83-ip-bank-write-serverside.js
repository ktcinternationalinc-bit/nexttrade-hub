// ============================================================
// v55.83-IP — core Bank Review writes go through a SERVICE-ROLE endpoint that bypasses RLS.
// Root cause of "categorize/link doesn't persist / can't reach Wave": the app authenticates by
// email (users.id != auth.uid()), so auth.uid()-keyed RLS silently filtered client writes to 0 rows.
// Now categorize / set-status / match-to-invoice / unmatch run server-side with the service-role key.
// ============================================================

var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
var route = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'api', 'accounting', 'bank-write', 'route.js'), 'utf8');
var rc = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'BankReviewTab.jsx'), 'utf8');

// ---- 1. endpoint uses service-role + permission + handles all core actions ----
ok('1a: endpoint uses the SERVICE_ROLE key (bypasses RLS)', /SUPABASE_SERVICE_ROLE_KEY/.test(route));
ok('1b: enforces permission per action via assertPermission', /assertPermission\(db, by, permKey, req\)/.test(route));
ok('1c: handles set_status', /action === 'set_status'/.test(route));
ok('1d: handles classify + set_wave_category', /action === 'classify' \|\| action === 'set_wave_category'/.test(route));
ok('1e: handles match_invoice', /action === 'match_invoice'/.test(route));
ok('1f: handles unmatch', /action === 'unmatch'/.test(route));

// ---- 2. match_invoice is atomic + correct ----
ok('2a: inserts payment_matches then accounting_invoice_payments',
  /from\('payment_matches'\)\.insert/.test(route) && /from\('accounting_invoice_payments'\)\.insert/.test(route));
ok('2b: rolls back the match if the payment insert fails (atomic)',
  /from\('payment_matches'\)\.update\(\{ voided: true \}\)\.eq\('id', matchId\)/.test(route));
ok('2c: over-apply guard (cumulative vs deposit) server-side', /already \+ apply\) > depositAmt \+ 0\.01/.test(route));
ok('2d: recompute uses canonical paid = wave_imported_paid + non-void hub rows',
  /paid = Number\(inv\.wave_imported_paid\)/.test(route) && /if \(!isPaymentVoid\(rows\[i\]\)\)/.test(route));
ok('2e: stamps the bank transaction with the invoice relationship',
  /linked_type: 'invoice', linked_id: inv\.id, matched_invoice_id: inv\.id/.test(route));
ok('2f: unmatch refuses to locally reverse a Wave-synced payment',
  /wave_payment_id \|\| pr\[k\]\.sync_status === 'synced' \|\| pr\[k\]\.sync_status === 'manual_done'/.test(route));

// ---- 3. BankReviewTab routes the core writes through the endpoint (not direct client writes) ----
ok('3a: has a bankWrite() helper hitting /api/accounting/bank-write', /function bankWrite\(action, payload\)/.test(rc) && /fetch\('\/api\/accounting\/bank-write'/.test(rc));
ok('3b: applyToInvoice uses bankWrite match_invoice (not a direct client insert chain)',
  /bankWrite\('match_invoice'/.test(rc));
ok('3c: setStatus + approve use bankWrite set_status', (rc.match(/bankWrite\('set_status'/g) || []).length >= 2);
ok('3d: classify + wave-category use bankWrite', /bankWrite\('classify'/.test(rc) && /bankWrite\('set_wave_category'/.test(rc));
ok('3e: unmatch uses bankWrite AND the unmatch() body does NOT write payment tables from the client', (function () {
  if (!/bankWrite\('unmatch'/.test(rc)) { return false; }
  var s = rc.indexOf('function unmatch(t)');
  if (s < 0) { return false; }
  var body = rc.substring(s, s + 1400);
  return body.indexOf("from('accounting_invoice_payments').update") === -1
    && body.indexOf("from('payment_matches').update") === -1
    && body.indexOf("from('customer_credits').update") === -1;
})());

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-IP server-write tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
