// ============================================================
// v55.83-LI — harden the Wave CSV import (Codex's 7 money-safety items on LD), so reflecting Wave-UI
// categorizations into the Hub can't mis-match, while Wave export wins by default when refreshing:
//  1 ambiguous (>1 candidate) -> NOT auto-applied (manual)
//  2 direction (IN/OUT) must match — never cross an IN and an OUT of the same amount
//  3 separate Debit/Credit columns supported (computed signed amount)
//  4 existing different Hub category = conflict only if override is explicitly disabled
//  5 historical Wave export includes previously pushed/synced rows and refreshes them by id
//  6 unresolved category name -> category_status 'local_only' (never masquerades as synced)
//  7 richer audit: batch id, filename, per-row before/after in wave_sync_log
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var route = rd('src/app/api/wave/import-transaction-csv/route.js');
var sync = rd('src/components/WaveSyncCenter.jsx');
var imp = rd('src/components/WaveImportTab.jsx');

ok('1: ambiguous rows (>1 candidate matching amount+direction+date) are collected and NOT auto-applied',
  /if \(hits\.length > 1\) \{ ambiguous\.push\(/.test(route) &&
  /ambiguous_count: ambiguous\.length/.test(route));
ok('2: direction must match — an IN and an OUT of the same amount can never be cross-matched',
  /var csvDir = cSigned < 0 \? 'out' : 'in';/.test(route) &&
  /if \(t\.direction && t\.direction !== csvDir\) \{ continue; \}/.test(route));
ok('3: separate Debit/Credit columns are detected and turned into a signed amount',
  /debit: findCol\(headers, \['debit', 'withdrawal'\]/.test(route) &&
  /credit: findCol\(headers, \['credit', 'deposit'\]/.test(route) &&
  /function rowSigned\(rowArr\)/.test(route) &&
  /if \(dv > 0 && cv === 0\) \{ return -dv; \}/.test(route));
ok('4: Wave export category refresh is ON by default; conflict only when override is explicitly disabled',
  /var allowOverride = body\.override_conflicts !== false;/.test(route) &&
  /if \(hasExistingCat && wouldChange && !allowOverride\) \{[\s\S]{0,120}conflicts\.push\(/.test(route) &&
  /var \[csvOverride, setCsvOverride\] = useState\(true\)/.test(sync) &&
  /var \[csvOverride, setCsvOverride\] = useState\(true\)/.test(imp) &&
  /replace Hub category with Wave export when different/.test(sync));
ok('5: historical Wave export includes previously pushed/synced rows and refreshes them by id',
  /filter\(function \(t\) \{ return !t\.matched_invoice_id; \}\)/.test(route) &&
  /\.update\(patch\)\.eq\('id', mm\.hub_id\)\.select\('id'\)/.test(route));
ok('6: an unresolved category name is saved as local_only (never marked synced / masquerading as in Wave)',
  /patch\.category_status = 'synced';/.test(route) &&
  /else \{ patch\.wave_account_name = mm\.csv_category; patch\.category_status = 'local_only'; \}/.test(route));
ok('7: richer audit — batch id, filename, and per-row before/after (+raw row, matched id, who/when) to wave_sync_log',
  /var batchId = 'csv-' \+ Date\.now\(\);/.test(route) &&
  /batch_id: batchId, filename: body\.filename \|\| null/.test(route) &&
  /auditRows\.push\(\{ matched_bank_transaction_id: mm\.hub_id[\s\S]{0,120}before: mm\.before, after:/.test(route));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-LI csv-hardening tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
