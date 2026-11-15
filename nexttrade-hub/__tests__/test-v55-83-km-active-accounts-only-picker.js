// ============================================================
// v55.83-KM — Max live: after archiving the old link, the VIEW account picker still listed TWO ··6338
// (archived + current). Once a connection is archived it drops out of `connections`, so its account loses
// its bank identity and is no longer recognized as an alias — it leaked back into the picker. Fix: the
// account picker lists ACTIVE (non-archived) accounts only, and a selected archived/superseded account
// falls back to All.
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

ok('1: the VIEW account picker skips accounts whose connection is archived (active accounts only)',
  /if \(t\.connection_id && !activeConnIds\[t\.connection_id\]\) \{ return; \} \/\/ v55\.83-KM/.test(bank));
ok('2: a selected account belonging to an ARCHIVED link falls back to All (not stuck on a hidden account)',
  /if \(_a && _a\.connection_id && !activeConnIds\[_a\.connection_id\]\) \{ return 'all'; \}/.test(bank));
ok('3: a selected SUPERSEDED (old alias) account also falls back to All',
  /if \(supersededAcctIds\[acctFilter\]\) \{ return 'all'; \}/.test(bank));
ok('4: activeConnIds is derived from the loaded (non-archived) connections',
  /const activeConnIds = \{\}; connections\.forEach\(c => \{ activeConnIds\[c\.id\] = true; \}\)/.test(bank) &&
  /setConnections\(\(conns \|\| \[\]\)\.filter\(c => c\.status !== 'archived'\)\)/.test(bank));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-KM active-accounts-only-picker tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
