// ============================================================
// v55.83-KK — Codex business rule: ONE LINE PER REAL ACCOUNT per silo (not per bank). Canonical account
// identity = (institution + mask). The NEWEST link's instance of each real account is canonical; older
// same-(institution+mask) instances from a prior relink are superseded aliases (hidden + txns excluded).
// CRUCIALLY: a connection is fully superseded ONLY when ALL its accounts are aliases of a newer link, so
// a genuinely DIFFERENT account in an older link is never hidden (the institution-level dedupe risk).
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

ok('1: canonical account identity is (institution + mask), NOT institution alone',
  /const acctKey = \(a\) => instOf\(connById\[a\.connection_id\]\) \+ '\|' \+ \(a\.mask \|\| a\.plaid_account_id\)/.test(bank));
ok('2: newest link instance per (institution+mask) is canonical; older same-key instances are superseded aliases',
  /\.sort\(\(a, b\) => \(\(\(connById\[b\.connection_id\] \|\| \{\}\)\.last_synced \|\| ''\) < \(\(connById\[a\.connection_id\] \|\| \{\}\)\.last_synced \|\| ''\)/.test(bank) &&
  /if \(canonicalByKey\[k\]\) \{ supersededAcctIds\[a\.plaid_account_id\] = true; \} else \{ canonicalByKey\[k\] = a\.plaid_account_id; \}/.test(bank));
ok('3: a connection is FULLY superseded only when ALL its accounts are aliases (different account in an old link is kept)',
  /const connHasCanonical = \{\}; plaidAccts\.forEach\(a => \{ if \(!supersededAcctIds\[a\.plaid_account_id\]\) \{ connHasCanonical\[a\.connection_id\] = true; \} \}\)/.test(bank) &&
  /const has = plaidAccts\.some\(a => a\.connection_id === c\.id\); if \(has && !connHasCanonical\[c\.id\]\) \{ supersededConnIds\[c\.id\] = true; \}/.test(bank));
ok('4: superseded alias transactions are reconciled (deduped) into the canonical account — no double-count (see KL)',
  /const reconciledTxns = transactions\.map\(t => \{/.test(bank) &&
  /if \(dup && !t\.matched_invoice_id\) \{ reconHiddenDup\+\+; return null; \}/.test(bank));
ok('5: render shows connections with a canonical account; fully-superseded links are offered for archive only',
  /var thisSilo = connections\.filter\(function \(c\) \{ return connHasActive\(c\) && !supersededConnIds\[c\.id\]; \}\)/.test(bank) &&
  /var dupConns = connections\.filter\(function \(c\) \{ return supersededConnIds\[c\.id\]; \}\)/.test(bank) &&
  /&& !supersededAcctIds\[a\.plaid_account_id\]; \}\) : \[\]/.test(bank));
ok('6: newest posted date is computed across ALL aliases of the real account',
  /const newestForKey = \(k\) => \{ let nd = ''; const ids = aliasIdsByKey\[k\] \|\| \[\];/.test(bank) &&
  /var newestD = newestForKey\(acctKey\(a\)\);/.test(bank));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-KK canonical-account-identity tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
