// ============================================================
// v55.83-KH — Max live: reconnecting Real KTC created a SECOND identical Chase/6338 line; and "nothing
// refreshed" (newest still 6/11). Fixes: one line per bank (keep the NEWEST connection per institution,
// collect older duplicate links for one-click archive), show each account's NEWEST transaction date so
// "no new activity" is obvious, and drop archived-duplicate transactions from the list/totals.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var bank = rd('src/components/BankTab.jsx');

ok('1: fully-superseded (duplicate relink) connections are collected for one-click archive (account-level — see KK)',
  /var dupConns = connections\.filter\(function \(c\) \{ return supersededConnIds\[c\.id\]; \}\)/.test(bank));
ok('2: a one-click banner archives all duplicate bank links (newest kept, txns/matches preserved)',
  /duplicate bank link\{dupConns\.length === 1 \? '' : 's'\} detected/.test(bank) &&
  /dupConns\.forEach\(function \(d\) \{ archiveConnection\(d\); \}\)/.test(bank));
ok('3: each account row shows its NEWEST transaction date (so "stuck at 6/11" reads as "no newer activity")',
  /var newestD = newestForKey\(acctKey\(a\)\);/.test(bank) &&
  /' · newest ' \+ newestD/.test(bank) && /: ' · none yet'/.test(bank));
ok('4: scopedTxns excludes transactions from ARCHIVED (duplicate) connections (no double-count in totals)',
  /const activeConnIds = \{\}; connections\.forEach\(c => \{ activeConnIds\[c\.id\] = true; \}\)/.test(bank) &&
  /if \(t\.connection_id && !activeConnIds\[t\.connection_id\]\) return false;/.test(bank));
ok('5: the per-card standalone "Archive duplicate" button was removed (declutter) — archive is now the banner',
  bank.indexOf('🗄 Archive duplicate') === -1);

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-KH bank-dedup tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
