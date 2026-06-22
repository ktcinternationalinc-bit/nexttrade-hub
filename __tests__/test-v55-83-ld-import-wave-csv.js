// ============================================================
// v55.83-LD — Max "item 2 / do it": pull existing Wave categorizations into the Hub. Wave's API can't
// read transactions back (WAVE_API_TRANSACTION_EVIDENCE.md), so this ingests Wave's CSV export, matches
// each row to a Hub bank transaction by date + abs(amount) + description, resolves the category name to a
// Wave account id, and (on apply) reflects it as already-in-Wave. dry-run is the default + previews first.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
function exists(p) { try { fs.accessSync(path.join(__dirname, '..', p)); return true; } catch (e) { return false; } }
var route = rd('src/app/api/wave/import-transaction-csv/route.js');
var sync = rd('src/components/WaveSyncCenter.jsx');

ok('1: the import route exists, is gated (bank.classify), and does NOT call Wave (no gql/fetch to Wave)',
  exists('src/app/api/wave/import-transaction-csv/route.js') &&
  /assertPermission\(db, by, 'bank\.classify', req\)/.test(route) &&
  !/gql\.waveapps\.com/.test(route));
ok('2: safety-first — defaults to DRY RUN (must explicitly pass dry_run:false to apply) and rejects placeholder silos',
  /var isDry = body\.dry_run !== false;/.test(route) &&
  /isPlaceholderWaveBusiness\(waveBusinessId\)/.test(route));
ok('3: auto-detects date/amount/category columns and reports them (so the user can verify)',
  /date: findCol\(headers, \['date'\]\)/.test(route) &&
  /amount: findCol\(headers, \['amount', 'total', 'debit', 'credit'\]\)/.test(route) &&
  /detected_columns: detected/.test(route) &&
  /if \(ci\.date < 0 \|\| ci\.amount < 0 \|\| ci\.category < 0\)/.test(route));
ok('4: matches Hub txns by EQUAL abs(amount) + date window + description similarity, excludes matched/synced',
  /if \(amt !== target\) \{ continue; \}/.test(route) &&
  /if \(dd > windowDays\) \{ continue; \}/.test(route) &&
  /sim\(cDesc, t\.name \|\| t\.merchant_name\)/.test(route) &&
  /!t\.matched_invoice_id && t\.category_status !== 'synced'/.test(route));
ok('5: apply reflects the Wave category (resolves name->wave_account_id), marks synced w/ source wave_csv, logs it',
  /catByName\[norm\(cCat\)\]/.test(route) &&
  /category_source: 'wave_csv', category_status: 'synced'/.test(route) &&
  /\.neq\('category_status', 'synced'\)/.test(route) &&
  /action: 'import_csv'/.test(route));
ok('6: Sync Center has an "Import from Wave" tab (admin, non-placeholder) wired to the route with preview+apply',
  /\['import', 'Import from Wave'\]/.test(sync) &&
  /if \(t\[0\] === 'import'\) \{ return canManageSettings && !isPlaceholderWaveBusiness\(active\); \}/.test(sync) &&
  /fetch\('\/api\/wave\/import-transaction-csv'/.test(sync) &&
  /function runCsvImport\(apply\)/.test(sync));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-LD import-wave-csv tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
