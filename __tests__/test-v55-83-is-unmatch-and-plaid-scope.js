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
ok('1a: unmatch calls bankWrite("unmatch")', /bankWrite\('unmatch', \{ bank_transaction_id: t\.id/.test(br));
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

// 3. Service-role construction now belongs to the shared verified-identity
// guard. Exercise missing-key behavior instead of requiring the obsolete sb()
// implementation or a particular JSON response constructor in this route.
async function checkServiceRoleBoundary() {
  var auth = await import('../src/app/api/plaid/_auth.js');
  var clientCalls = 0;
  var env = { NEXT_PUBLIC_SUPABASE_URL: 'https://build-only.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon' };
  var authorize = auth.createPlaidAuthorizer(function () { clientCalls++; throw new Error('No client may be constructed without the service key'); }, env,
    async function () { throw new Error('No permission/database work may occur without server configuration'); });
  var statuses = [];
  for (var method of ['POST', 'GET']) {
    var request = new Request('https://hub.example/api/plaid/transactions', { method: method,
      headers: { Origin: 'https://hub.example', Authorization: 'Bearer test-session', 'Content-Type': 'application/json' },
      ...(method === 'POST' ? { body: '{}' } : {}) });
    try { await authorize(request, 'bank_transactions.view', method === 'POST'); statuses.push(200); }
    catch (error) { statuses.push(error.status); }
  }
  ok('3a: shared Plaid authorization rejects missing service-role configuration before constructing any client',
    clientCalls === 0 && statuses.length === 2 && statuses.every(function (status) { return status === 503; }));
  var post = route.slice(route.indexOf('export async function POST'), route.indexOf('export async function GET'));
  var get = route.slice(route.indexOf('export async function GET'));
  ok('3b: POST and GET use the guarded service client and propagate authorization failures',
    /await authorizePlaidOperation\(req, 'bank_transactions.view', true\);\s*var supabase = access\.db;/.test(post) &&
    /await authorizePlaidOperation\(req, 'bank_transactions.view', false\);\s*var supabase = access\.db;/.test(get) &&
    /catch \(e\) \{\s*return plaidError\(e\);/.test(post) && /catch \(e\) \{\s*return plaidError\(e\);/.test(get));
}

checkServiceRoleBoundary().catch(function (error) { ok('shared authorization test completed', false, error.message); }).finally(function () {
  console.log('');
  if (failures.length === 0) { console.log('✅ All v55.83-IS unmatch/plaid-scope tests passed'); process.exit(0); }
  else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
});
