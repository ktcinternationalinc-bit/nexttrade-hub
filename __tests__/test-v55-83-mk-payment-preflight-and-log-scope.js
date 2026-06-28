// ============================================================
// v55.83-MK - payment sync must not feel like "nothing happened".
// Payment Dry Run must use the real server push preflight, and Sync Log must
// load active-silo rows directly instead of depending on a global latest slice.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];

function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
function ok(label, cond) {
  if (cond) { console.log('OK ' + label); }
  else { failures.push(label); console.log('FAIL ' + label); }
}

var sync = rd('src/components/WaveSyncCenter.jsx');
var page = rd('src/app/page.jsx');
var wn = rd('src/components/WhatsNewWidget.jsx');

ok('1: visible build marker is current, and the MK changelog entry is still present',
  /v55\.83-M[A-Z]/.test(page) &&
  /version: 'v55\.83-MK'/.test(wn));
ok('2: payment dry-run is routed to the real server payment push preflight',
  /q\.action !== 'transaction' && q\.action !== 'payment'/.test(sync) &&
  /var route = q\.action === 'payment' \? '\/api\/wave\/push-payment' : '\/api\/wave\/push-transaction';/.test(sync) &&
  /dry_run: true/.test(sync));
ok('3: payment dry-run renders the Wave invoice/account/amount/date returned by the server',
  /if \(q\.action === 'payment'\)/.test(sync) &&
  /Payment account:/.test(sync) &&
  /wouldDo: d\.would_send/.test(sync));
ok('4: non-money records still use the client-side dryRunRecord preview',
  /dryRunRecord\(\{ action: q\.action, record: q\.record, waveBusinessId: active, registry: registry \}\)/.test(sync));
ok('5: Sync Log loads active-silo logs directly before fallback',
  /function loadSyncLogRows\(activeBiz\)/.test(sync) &&
  /\.eq\('wave_business_id', activeBiz\)/.test(sync) &&
  /\.eq\('wave_record_id', activeBiz\)/.test(sync) &&
  /\.is\('wave_business_id', null\)/.test(sync) &&
  /loadSyncLogRows\(activeNow\)/.test(sync));
ok('6: old global latest-100 log dependency is replaced by a broader fallback',
  /orderedSyncLogQuery\(supabase\.from\('wave_sync_log'\)\.select\('\*'\), 500\)/.test(sync) &&
  !/supabase\.from\('wave_sync_log'\)\.select\('\*'\)\.order\('attempted_at'[\s\S]{0,120}\.limit\(100\)/.test(sync));

console.log('');
if (failures.length === 0) { console.log('All v55.83-MK payment preflight + log scope tests passed'); process.exit(0); }
console.log(failures.length + ' FAILED:');
failures.forEach(function (f) { console.log('   - ' + f); });
process.exit(1);
