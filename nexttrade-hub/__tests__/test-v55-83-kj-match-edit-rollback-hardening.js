// ============================================================
// v55.83-KJ — Codex money-safety hardening of update_match. Close the unchecked failure branches so the
// route is genuinely all-or-restored (or honestly warns): overpayment artifact insert is checked (rolls
// back the new match+payment on failure, old untouched); OLD credit/unapplied void errors trigger the
// restore path (no duplicate open credit/deposit); the restore re-opens old credits/unapplied; recompute
// + final restamp errors are surfaced as a `warning` instead of being swallowed.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var route = rd('src/app/api/accounting/bank-write/route.js');
var br = rd('src/components/BankReviewTab.jsx');

ok('1: overpayment artifact insert is error-checked and rolls back the new match+payment (no money lost)',
  /if \(uCrIns && uCrIns\.error\) \{ uOvErr = uCrIns\.error\.message; \}/.test(route) &&
  /if \(uUnIns && uUnIns\.error\) \{ uOvErr = uUnIns\.error\.message; \}/.test(route) &&
  /if \(uOvErr\) \{/.test(route) && /Could not record the overpayment — NO change was made/.test(route));
ok('2: OLD credit/unapplied void errors are captured into uVoidErr (no longer swallowed)',
  /var uVc = await db\.from\('customer_credits'\)\.update\(\{ status: 'void' \}\)[\s\S]{0,160}if \(uVc && uVc\.error\) \{ uVoidErr = 'old credits: '/.test(route) &&
  /var uVu = await db\.from\('unapplied_deposits'\)\.update\(\{ status: 'void' \}\)[\s\S]{0,170}if \(uVu && uVu\.error\) \{ uVoidErr = 'old unapplied: '/.test(route));
ok('3: the restore path snapshots + RE-OPENS old credits/unapplied (not just matches/payments)',
  /var uOldCredits = \(uOldCredR && uOldCredR\.data\) \|\| \[\]/.test(route) &&
  /var uOldUnapplied = \(uOldUnapR && uOldUnapR\.data\) \|\| \[\]/.test(route) &&
  /from\('customer_credits'\)\.update\(\{ status: 'open' \}\)\.eq\('id', uOldCredits\[uri\]\.id\)/.test(route) &&
  /from\('unapplied_deposits'\)\.update\(\{ status: 'open' \}\)\.eq\('id', uOldUnapplied\[uri\]\.id\)/.test(route));
ok('4: recompute + final restamp errors are surfaced as a warning (not swallowed)',
  /catch \(eR1\) \{ uWarn = 'recompute \(old invoice\) failed/.test(route) &&
  /catch \(eR2\) \{ uWarn = 'recompute \(new invoice\) failed/.test(route) &&
  /if \(uStamp && uStamp\.error\) \{ uWarn = 'transaction re-link failed/.test(route) &&
  /warning: uWarn, api_build_marker/.test(route));
ok('5: the client surfaces the warning to the user',
  /if \(j && j\.warning\) \{ toast\.error\('Saved, but: ' \+ j\.warning/.test(br));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-KJ match-edit rollback-hardening tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
