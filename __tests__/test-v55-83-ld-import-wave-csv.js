// ============================================================
// v55.83-LD — Max "item 2 / do it": pull existing Wave categorizations into the Hub. Wave's API can't
// read transactions back (WAVE_API_TRANSACTION_EVIDENCE.md), so this ingests Wave's CSV export, matches
// each row to a Hub bank transaction by date + abs(amount) + description, resolves the category name to a
// Wave account id, and (on apply) refreshes the Hub category from Wave. dry-run is the default + previews first.
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
var imp = rd('src/components/WaveImportTab.jsx');

ok('1: the import route exists, is gated (bank.classify), and does NOT call Wave (no gql/fetch to Wave)',
  exists('src/app/api/wave/import-transaction-csv/route.js') &&
  /assertPermission\(db, by, 'bank\.classify', req\)/.test(route) &&
  !/gql\.waveapps\.com/.test(route));
ok('2: safety-first — defaults to DRY RUN (must explicitly pass dry_run:false to apply) and rejects placeholder silos',
  /var isDry = body\.dry_run !== false;/.test(route) &&
  /isPlaceholderWaveBusiness\(waveBusinessId\)/.test(route));
ok('3: auto-detects date/amount(+debit/credit)/category columns and reports them (so the user can verify)',
  /date: findCol\(headers, \['date'\]\)/.test(route) &&
  /amount: findCol\(headers, \['amount', 'total'\]/.test(route) &&
  /detected_columns: detected/.test(route) &&
  /if \(ci\.date < 0 \|\| !hasAmount \|\| ci\.category < 0\)/.test(route));
ok('4: matches Hub txns by EQUAL abs(amount) + date window + description similarity, excludes invoice-matched rows only',
  /if \(amt !== target\) \{ continue; \}/.test(route) &&
  /if \(dd > windowDays\) \{ continue; \}/.test(route) &&
  /sim\(cDesc, t\.name \|\| t\.merchant_name\)/.test(route) &&
  /filter\(function \(t\) \{ return !t\.matched_invoice_id; \}\)/.test(route));
ok('5: apply reflects the Wave category (resolves name->wave_account_id), source wave_csv, refreshes by id, logs it',
  /catByName\[norm\(cCat\)\]/.test(route) &&
  /category_source: 'wave_csv'/.test(route) &&
  /\.update\(patch\)\.eq\('id', mm\.hub_id\)\.select\('id'\)/.test(route) &&
  /action: 'import_csv'/.test(route));
ok('6: Wave Import has the old Wave transaction category CSV flow wired with preview+apply',
  /Wave -> Hub import map/.test(imp) &&
  /Step 3 - Import old Wave transaction categories/.test(imp) &&
  /fetch\('\/api\/wave\/import-transaction-csv'/.test(imp) &&
  /function runCsvImport\(apply\)/.test(imp) &&
  /Preview CSV match/.test(imp) &&
  /Apply \{csvResult && csvResult\.dry_run/.test(imp));
ok('7: Sync Center no longer exposes a second Import from Wave tab',
  !/\['import', 'Import from Wave'\]/.test(sync));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-LD import-wave-csv tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
