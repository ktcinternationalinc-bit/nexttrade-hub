// ============================================================
// v55.83-KL — Codex money-truth: superseded (old relink) alias transactions must be RECONCILED, not
// silently excluded. A relink re-pulls the same history under new ids (true duplicates → drop), but the
// old link may hold a transaction the fresh link did NOT return (unique → must be KEPT, not lost), and a
// matched old-link txn must never be dropped. Kept aliases are re-stamped onto the canonical account so
// the single row + totals stay complete; the reconciliation counts are surfaced (never silent).
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

ok('1: a superseded-alias txn is dropped ONLY if it is an unmatched same-fingerprint duplicate of a canonical txn',
  /var dup = !!canonFp\[txnFp\(t\)\];/.test(bank) &&
  /if \(dup && !t\.matched_invoice_id\) \{ reconHiddenDup\+\+; return null; \}/.test(bank));
ok('2: the duplicate fingerprint is date + amount + normalized description (not the volatile Plaid id)',
  /const txnFp = \(t\) => String\(t\.posted_date \|\| t\.date \|\| ''\)\.slice\(0, 10\) \+ '\|' \+ Math\.round\(Number\(t\.amount \|\| 0\) \* 100\) \+ '\|' \+ normName\(t\.name\)/.test(bank) &&
  /const canonFp = \{\}; transactions\.forEach\(t => \{ if \(t\.account_id && !supersededAcctIds\[t\.account_id\]\) \{ canonFp\[txnFp\(t\)\] = true; \}/.test(bank));
ok('3: a MATCHED old-link transaction is never dropped (match preserved), counted as kept',
  /if \(t\.matched_invoice_id\) \{ reconKeptMatched\+\+; \}/.test(bank));
ok('4: kept alias transactions are re-stamped onto the CANONICAL account (one row, totals complete)',
  /return Object\.assign\(\{\}, t, \{ account_id: canonAcctOf\(t\.account_id\) \}\)/.test(bank) &&
  /const canonAcctOf = \(aid\) => \{ const a = acctById\[aid\]; if \(!a\) \{ return aid; \} return canonicalByKey\[acctKey\(a\)\] \|\| aid; \}/.test(bank));
ok('5: the list/totals/dropdown/count all derive from the SAME reconciled dataset (consistency)',
  /const scopedTxns = reconciledTxns\.filter/.test(bank) &&
  /reconciledTxns\.forEach\(function \(t\) \{ \/\/ v55\.83-KL/.test(bank) &&
  /var cnt = reconciledTxns\.filter\(function \(t\) \{ return t\.account_id === a\.plaid_account_id; \}\)\.length;/.test(bank));
ok('6: the reconciliation is surfaced with counts (never silent) and states nothing was dropped from totals',
  /Reconnected link reconciled: \{reconHiddenDup\}/.test(bank) &&
  /Nothing was dropped from totals/.test(bank));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-KL alias-reconciliation tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
