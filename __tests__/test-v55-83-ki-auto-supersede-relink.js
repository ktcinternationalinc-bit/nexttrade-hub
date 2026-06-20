// ============================================================
// v55.83-KI — Max: "of course it has transactions after 6/11!!!" Reconnecting a bank leaves the OLD link
// behind (stale, capped at its last sync) with its own account id; the user was viewing that stale
// account. AUTO-SUPERSEDE the older link per bank: hide its account + exclude its transactions
// automatically (no manual archive), fall back the account filter to All, and flag a stale account.
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

ok('1: older relink accounts are auto-superseded (account-level canonical — newest link instance wins; see KK)',
  /if \(canonicalByKey\[k\]\) \{ supersededAcctIds\[a\.plaid_account_id\] = true; \}/.test(bank) &&
  /const supersededConnIds = \{\}; connections\.forEach\(c => \{ const has = plaidAccts\.some/.test(bank));
ok('2: superseded alias transactions are reconciled out of the canonical totals automatically (no manual archive; see KL)',
  /const reconciledTxns = transactions\.map\(t => \{/.test(bank) &&
  /const scopedTxns = reconciledTxns\.filter/.test(bank));
ok('3: the account filter falls back to All when the selected account was superseded (so fresh data shows)',
  /const effAcctFilter = \(acctFilter !== 'all' && !supersededAcctIds\[acctFilter\]\) \? acctFilter : 'all';/.test(bank) &&
  /if \(effAcctFilter !== 'all' && t\.account_id !== effAcctFilter\) return false;/.test(bank));
ok('4: the VIEW account dropdown is built from the reconciled set + still skips any superseded account',
  /reconciledTxns\.forEach\(function \(t\) \{ \/\/ v55\.83-KL/.test(bank) &&
  /if \(supersededAcctIds\[t\.account_id\]\) \{ return; \}/.test(bank));
ok('5: an account whose newest transaction is >7 days old is flagged stale (Sync or Reconnect)',
  /var _stale = _agoDays != null && _agoDays > 7;/.test(bank) &&
  /d ago — Sync or Reconnect/.test(bank));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-KI auto-supersede-relink tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
