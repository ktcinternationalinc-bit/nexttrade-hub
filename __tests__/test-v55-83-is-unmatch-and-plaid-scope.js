// ============================================================
// v55.83-IS — close Codex CORE FAILs on the bank reverse/unmatch + Plaid sync data paths.
//  - unmatch goes through the service-role route (RLS-proof), not client-side writes
//  - BankTab scopes bank_transactions by active silo BEFORE the row limit
//  - /api/plaid/transactions REQUIRES the service-role key (no anon fallback)
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var br = rd('src/components/BankReviewTab.jsx');
var bt = rd('src/components/BankTab.jsx');
var route = rd('src/app/api/plaid/transactions/route.js');

// 1. unmatch via service route, not client writes
ok('1a: unmatch calls bankWrite("unmatch")', /bankWrite\('unmatch', \{ bank_transaction_id: t\.id \}\)/.test(br));
ok('1b: the unmatch() function no longer does direct supabase update chains on payment tables',
  (function () {
    var m = br.match(/function unmatch\(t\)\{?[\s\S]*?\n  \}/);
    var body = m ? m[0] : br.slice(br.indexOf('function unmatch(t)'), br.indexOf('function unmatch(t)') + 1400);
    return body.indexOf("from('accounting_invoice_payments').update") === -1 && body.indexOf("from('payment_matches').update") === -1;
  })());

// 2. BankTab scopes the query by active silo before the limit
ok('2a: loadData scopes bank_transactions by active wave_business_id at the query',
  /_txq = _txq\.eq\('wave_business_id', _activeBizScope\)/.test(bt) && /_txq\.limit\(500\)/.test(bt));
ok('2b: sync notice is honest ("processed", not implying confirmed inserts), no user-error speculation',
  /transaction\(s\) processed/.test(bt) && bt.indexOf('scoped to a different silo than the one selected') === -1);

// 3. Plaid route requires service-role (no anon fallback)
ok('3a: sb() returns null when service-role key is missing (no anon fallback)',
  /var key = process\.env\.SUPABASE_SERVICE_ROLE_KEY;\s*if \(!key\) \{ return null; \}/.test(route) &&
  route.indexOf('NEXT_PUBLIC_SUPABASE_ANON_KEY') === -1);
ok('3b: POST + GET fail loud if the service-role key is missing',
  (route.match(/if \(!supabase\) \{ return NextResponse\.json\(\{ error: 'Server bank-ingestion key missing/g) || []).length >= 2);

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-IS unmatch/plaid-scope tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
