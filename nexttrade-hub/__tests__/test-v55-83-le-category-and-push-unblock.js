// ============================================================
// v55.83-LE — Max: "category pull only has ~10 chart of accounts, where are the rest" + "I need the
// transaction sync to work." Multi-agent diagnosis found TWO stacked category ceilings (UI .slice(0,10)
// + over-aggressive server filter) and that the LC multi-account anchor block wrongly blocked a real
// single-bank silo (reconnect alias rows). Fixes:
//  - Typeahead shows up to 50 + "+N more / total" hint (full chart reachable).
//  - categories route hides only true SYSTEM rows; no name-collapse of distinct accounts.
//  - push-transaction counts DISTINCT CANONICAL accounts (drop null-mask aliases, exclude archived) — a
//    single-bank silo is no longer blocked.
//  - orphaned 'syncing' rows reset to pending_wave_sync on crash (retryable).
//  - categories auto-pulled after a real bind (so a fresh connect isn't empty).
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
var catRoute = rd('src/app/api/wave/categories/route.js');
var push = rd('src/app/api/wave/push-transaction/route.js');
var sync = rd('src/components/WaveSyncCenter.jsx');
var conn = rd('src/components/WaveConnectionTab.jsx');

ok('1: category picker no longer hard-caps at 10 — shows up to 50 and surfaces "+N more / total" so the full list is reachable',
  !/\.slice\(0, 10\)/.test(br) &&
  /var CAP = 50;/.test(br) &&
  /var more = filtered\.length - shown\.length;/.test(br) &&
  /\+\{more\} more of \{filtered\.length\} — type to narrow/.test(br));
ok('2: the picker shows the true usable count + a refresh affordance when populated (transparency)',
  /categories available/.test(br) &&
  /refresh from Wave/.test(br));
ok('3: categories route hides ONLY Wave system rows, keeps real Payable/Receivable accounts, dedupes by id only',
  /return nm\.indexOf\('\(SYSTEM'\) >= 0 \|\| sub\.indexOf\('SYSTEM'\) >= 0;/.test(catRoute) &&
  !/seenName/.test(catRoute));
ok('4: push no longer BLANKET-blocks a multi-bank silo — it delegates to the shared per-account resolver (LE canonical-count block superseded by LZ/MC)',
  /resolveWaveBankAnchor\(\{/.test(push) &&
  !/if \(distinctAccts > 1\) \{ return blocked\(/.test(push) &&
  !/var m = a\.mask \|\| a\.plaid_account_id;/.test(push));
ok('5: a crash after claiming "syncing" resets the row to pending_wave_sync (retryable) + logs the failure',
  /update\(\{ category_status: 'pending_wave_sync' \}\)\.eq\('id', hubId\)\.eq\('category_status', 'syncing'\)/.test(push));
ok('6: a successful real bind auto-pulls the Wave chart of accounts (both connect paths) so a fresh connect is not empty',
  /Pulling this business[\s\S]{0,40}Wave chart of accounts/.test(sync) &&
  /fetch\('\/api\/wave\/sync-categories'[\s\S]{0,160}includeProduction: true/.test(sync) &&
  /fetch\('\/api\/wave\/sync-categories'[\s\S]{0,160}includeProduction: true/.test(conn));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-LE category + push-unblock tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
