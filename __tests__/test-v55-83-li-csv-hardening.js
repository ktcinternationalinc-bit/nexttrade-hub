// ============================================================
// v55.83-LI — harden the Wave CSV import (Codex's 7 money-safety items on LD), so reflecting Wave-UI
// categorizations into the Hub can't mis-match or silently overwrite:
//  1 ambiguous (>1 candidate) -> NOT auto-applied (manual)
//  2 direction (IN/OUT) must match — never cross an IN and an OUT of the same amount
//  3 separate Debit/Credit columns supported (computed signed amount)
//  4 existing different Hub category = conflict -> needs explicit override
//  5 pushed/synced guard widened to wave_transaction_id (+ apply guard), not just status
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
ok('4: an existing DIFFERENT Hub category is a conflict that needs an explicit override (no silent overwrite)',
  /var allowOverride = body\.override_conflicts === true;/.test(route) &&
  /if \(best\.wave_account_id && wouldChange && !allowOverride\) \{[\s\S]{0,120}conflicts\.push\(/.test(route) &&
  /override existing Hub categories/.test(sync));
ok('5: the pushed/synced guard is widened to wave_transaction_id (candidate filter + apply guard)',
  /!t\.matched_invoice_id && t\.category_status !== 'synced' && !t\.wave_transaction_id/.test(route) &&
  /\.neq\('category_status', 'synced'\)\.is\('wave_transaction_id', null\)/.test(route));
ok('6: an unresolved category name is saved as local_only (never marked synced / masquerading as in Wave)',
  /patch\.category_status = 'synced';/.test(route) &&
  /else \{ patch\.wave_account_name = mm\.csv_category; patch\.category_status = 'local_only'; \}/.test(route));
ok('7: richer audit — batch id, filename, and per-row before/after written to wave_sync_log',
  /var batchId = 'csv-' \+ Date\.now\(\);/.test(route) &&
  /batch_id: batchId, filename: body\.filename \|\| null/.test(route) &&
  /auditRows\.push\(\{ hub_id: mm\.hub_id, csv_row: mm\.row/.test(route));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-LI csv-hardening tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
