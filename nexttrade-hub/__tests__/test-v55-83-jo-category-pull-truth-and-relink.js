// ============================================================
// v55.83-JO — two live launch blockers Max reported:
//  (1) Bank Review classification not showing Wave Chart of Accounts for Real KTC — the per-silo
//      category pull SWALLOWED per-business failures ("Done. 0 new" + success toast) so a token that
//      can't reach Real KTC's Wave business looked like a successful pull. Now it tells the truth.
//  (2) Bank data frozen (stale) — a Plaid item that needs re-auth (ITEM_LOGIN_REQUIRED) silently
//      stopped syncing. Now the route flags needs_relink + records last_sync_error, and the Bank tab
//      shows a clear re-connect CTA.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var wsc = rd('src/components/WaveSyncCenter.jsx');
var catRoute = rd('src/app/api/wave/sync-categories/route.js');
var plaid = rd('src/app/api/plaid/transactions/route.js');
var bank = rd('src/components/BankTab.jsx');

// (1) Category pull truthfulness
ok('1: runCategoryPull surfaces a per-business FAILURE instead of a false "Done. 0 new"',
  /res0\.ok === false/.test(wsc) && /Wave returned an error/.test(wsc) && /token likely cannot access this business/.test(wsc));
ok('2: runCategoryPull flags a 0-accounts pull (token has no access / no Chart of Accounts)',
  /if \(!totalAcc\)/.test(wsc) && /Wave returned 0 accounts/.test(wsc));
ok('3: runCategoryPull only reports success with a real account count',
  /' Wave accounts \('/.test(wsc) && /toast\.success\('Wave categories synced'\)/.test(wsc));
ok('4: sync-categories route returns per-business ok/total/error the UI can read',
  /results\.push\(\{ business: biz\.label, wave_business_id: biz\.wave_business_id, ok: errors\.length === 0, total: accounts\.length/.test(catRoute) &&
  /results\.push\(\{ business: biz\.label, wave_business_id: biz\.wave_business_id, ok: false, error: fetched\.error \}\)/.test(catRoute));

// (2) Plaid re-link surfacing
ok('5: Plaid route flags needs_relink for ITEM_LOGIN_REQUIRED / PENDING_EXPIRATION + records the error',
  /needsRelink = \(data\.error_code === 'ITEM_LOGIN_REQUIRED' \|\| data\.error_code === 'PENDING_EXPIRATION'\)/.test(plaid) &&
  /last_sync_status: 'error', last_sync_error: \(data\.error_message \|\| data\.error_code\)/.test(plaid) &&
  /needs_relink: needsRelink/.test(plaid));
ok('6: BankTab shows an actionable re-connect CTA when needs_relink',
  /if \(data\.needs_relink\)/.test(bank) && /needs to be re-connected to Plaid/.test(bank) && /existing transactions and matches are kept/.test(bank));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-JO category-pull-truth + relink tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
