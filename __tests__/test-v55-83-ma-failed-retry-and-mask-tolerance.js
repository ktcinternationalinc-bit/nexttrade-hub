// ============================================================
// v55.83-MA — Codex P0 deep-wiring review (2026-06-23):
//  P0 #1 the moneyTransactionCreate payload was invalid (single INCREASE line). Covered by kz(2)+lc(1b):
//        lineItems now carry a balanced DEBIT+CREDIT pair. (This file covers the rest.)
//  P0 #2 a Wave-rejected txn (category_status='sync_failed') dropped OUT of Pending Sync — user saw nothing.
//        Now failed rows stay in Pending, RETRYABLE, with the exact last error inline.
//  Prefill account match only read 4-digit tokens (\d{4}) → Wave "(338)" never matched Plaid "6338".
//        Now suffix-tolerant (\d{2,}). Prefill paging bumped so the ~1285-invoice tail is scanned.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var sync = rd('src/components/WaveSyncCenter.jsx');
var prefill = rd('src/app/api/wave/prefill-payment-links/route.js');

ok('1: a Wave-FAILED bank txn stays in Pending Sync (sync_failed/failed are retryable, not dropped)',
  /var btStatus = String\(bt\.category_status \|\| ''\);/.test(sync) &&
  /if \(btStatus !== 'pending_wave_sync' && btStatus !== 'sync_failed' && btStatus !== 'failed'\) \{ return; \}/.test(sync) &&
  /var btFailed = \(btStatus === 'sync_failed' \|\| btStatus === 'failed'\);/.test(sync));
ok('2: the failed row shows the exact last error inline (from wave_sync_log) + a retry marker',
  /var lastFailErr = \{\};/.test(sync) &&
  /l\.entity_type !== 'bank_transaction'/.test(sync) &&
  /⚠ last push FAILED — fix & retry: ' \+ \(lastFailErr\[bt\.id\] \|\| 'see Sync Log'\)/.test(sync) &&
  /retry: btFailed/.test(sync));
ok('3: the queue recomputes when the sync log changes (syncLog is a dependency)',
  /\}, \[customers, invoices, payments, bankTxns, splitTxns, active, prodSetup, syncLog\]\);/.test(sync));
ok('4: prefill account match is suffix-tolerant (\\d{2,}, not \\d{4}) — Wave "(338)" maps to Plaid "6338"',
  /var toks = nm\.match\(\/\\d\{2,\}\/g\) \|\| \[\];/.test(prefill) &&
  /dm\.slice\(-t\.length\) === t/.test(prefill) &&
  !/var toks = nm\.match\(\/\\d\{4\}\/g\)/.test(prefill));
ok('5: prefill scans enough invoice pages for a large book (default 80 pages = 2000 invoices)',
  /var maxPages = Math\.min\(Number\(body\.max_pages\) \|\| 80, 200\);/.test(prefill));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-MA failed-retry + mask-tolerance tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
