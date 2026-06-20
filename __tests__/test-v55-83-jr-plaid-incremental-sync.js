// ============================================================
// v55.83-JR — Plaid gap-free incremental sync + backfill (Codex launch FAIL). Normal sync pulls FORWARD
// from the last successful posted date (not the UI date window), pages /transactions/get past 500, and
// connect/re-link can choose a backfill start date. Fails if any of those regress.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var route = rd('src/app/api/plaid/transactions/route.js');
var bank = rd('src/components/BankTab.jsx');
var exch = rd('src/app/api/plaid/exchange/route.js');
var sql = rd('sql/v55-83-JR-plaid-incremental-sync.sql');

// Route: paging past 500
ok('1: /transactions/get is PAGED to total_transactions, not a single offset:0 call',
  /while \(pageGuard < 60\)/.test(route) &&
  /allTxns\.length >= data\.total_transactions/.test(route) &&
  /offset = allTxns\.length/.test(route));
ok('2: NOT a lone single-page fetch (the old offset:0-only pattern is gone)',
  !/options: \{ count: 500, offset: 0 \}/.test(route));

// Route: incremental start derivation (forward from last success, not the UI window)
ok('3: effective start is computed from last_successful_posted_date (minus overlap), then backfill date, then 30d',
  /conn\.last_successful_posted_date/.test(route) &&
  /OVERLAP_DAYS/.test(route) &&
  /conn\.initial_backfill_start_date/.test(route));

// Route: persists the cursor/marker AFTER a successful upsert
ok('4: route stores last_successful_posted_date + last_successful_plaid_sync_at after the upsert',
  /connPatch\.last_successful_posted_date = newestOverall/.test(route) &&
  /last_successful_plaid_sync_at: new Date\(\)\.toISOString\(\)/.test(route));
ok('5: route returns useful counts: newest posted date overall + per account + page count + window',
  /newest_posted_date: newestOverall/.test(route) && /newest_by_account: newestByAccount/.test(route) && /pages: pageGuard/.test(route));

// BankTab: normal sync is incremental (no UI-window start_date); deep re-pull is explicit
ok('6: normal Sync sends NO start_date (incremental); only a deepPull sends a window start',
  /const body = \{ connection_id: connId \};/.test(bank) &&
  /if \(deepPull\) \{/.test(bank) &&
  // the body posted is the incremental body, not a forced UI-window start
  /body: JSON\.stringify\(body\)/.test(bank));
ok('7: BankTab has a "Deep re-pull" control that triggers a backfill (start_date sent)',
  /syncTransactions\(c\.id, 0, true\)/.test(bank) && /Deep re-pull/.test(bank));

// Connect/re-link backfill date
ok('8: connect passes initial_backfill_start_date; exchange stores it (schema-safe fallback)',
  /initial_backfill_start_date: _bfStart/.test(bank) &&
  /connInsert\.initial_backfill_start_date/.test(exch) &&
  /initial_backfill_start_date\|column/.test(exch));

// SQL migration
ok('9: SQL adds the incremental markers to bank_connections',
  /add column if not exists initial_backfill_start_date date/.test(sql) &&
  /add column if not exists last_successful_posted_date date/.test(sql) &&
  /add column if not exists plaid_cursor text/.test(sql));

// --- JT (Codex JR follow-up): backfill UX in the connect flow + admin deep re-pull + no silent marker loss ---
ok('JT1: Connect modal has an explicit backfill-window control (1mo/3mo/6mo/1yr/cy/all/custom) before Plaid Link',
  /How far back to pull history on connect/.test(bank) &&
  /<option value="cy">Current year/.test(bank) && /<option value="all">All available/.test(bank) && /<option value="custom">Custom start date/.test(bank) &&
  /backfillStartDate\(\)/.test(bank));
ok('JT2: connect sends the chosen backfill date + first sync is a full backfill (deepPull)',
  /initial_backfill_start_date: _bfStart/.test(bank) && /syncTransactions\(exData\.connection\.id, 0, true\)/.test(bank));
ok('JT3: Deep re-pull is admin-only (canViewAllAccounts) with a confirm showing start/end dates',
  /canViewAllAccounts && \(/.test(bank) && /Deep re-pull history for this bank\?/.test(bank) && /syncTransactions\(c\.id, 0, true\)/.test(bank));
ok('JT4: route reports markers_persisted + the UI warns when they did NOT save (no silent fallback)',
  /markers_persisted: markersPersisted/.test(route) && /data\.markers_persisted === false/.test(bank) && /Incremental markers could NOT be saved/.test(bank));
ok('JT5: exchange reports backfill_saved + the UI warns when the backfill date did NOT save',
  /backfill_saved: backfillSaved/.test(exch) && /exData\.backfill_saved === false/.test(bank));
// JU (Codex) — if the window exceeds the page cap, FAIL LOUD; do not import a partial set or advance the marker
ok('JU1: route fails loud when the backfill exceeds the page cap (no partial import + no marker advance)',
  /if \(totalAvail != null && allTxns\.length < totalAvail\) \{/.test(route) &&
  /Nothing was imported \(to avoid a partial\/gap\)/.test(route) &&
  // the guard is BEFORE rawTxns/upsert/marker write
  route.indexOf('allTxns.length < totalAvail') < route.indexOf('var rawTxns = allTxns'));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-JR plaid-incremental-sync tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
