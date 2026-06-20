// ============================================================
// v55.83-JY — Bank tab is now SILO-CENTRIC (Codex BA review): the active accounting silo's banks are the
// primary operational area; other silos' connections are collapsed into an admin-diagnostics section so
// a user can't accidentally sync/repair the wrong silo. Business-language buttons. Connect surfaces a
// failed account-stamp instead of hiding it.
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
var exch = rd('src/app/api/plaid/exchange/route.js');

// Layout contract: partition by active silo + collapse other silos
ok('1: connections are partitioned this-silo vs other-silo by each ACCOUNT\'s effective silo, then deduped to newest-per-bank (v55.83-KF/KH)',
  /dedupeNewest\(connections\.filter\(connHasActive\)\)/.test(bank) &&
  /dedupeNewest\(connections\.filter\(connHasOther\)\)/.test(bank) &&
  /var effSilo = function \(a, c\) \{ return \(a && a\.wave_business_id\) \|\| \(c && c\.wave_business_id\) \|\| null; \}/.test(bank));
ok('2: the active silo is the PRIMARY section ("Bank accounts for <silo>")',
  /Bank accounts for \{bizLabel\(activeBiz\)\}/.test(bank));
ok('3: other silos are collapsed behind a super-admin toggle (admin diagnostics), not shown as normal cards',
  /canViewAllAccounts && otherSilo\.length > 0/.test(bank) &&
  /Other silos \/ admin diagnostics/.test(bank) &&
  /showOtherSilos &&/.test(bank));
ok('4: cross-silo cards carry a clear warning when expanded',
  /These accounts belong to OTHER silos/.test(bank));

// Business-language buttons
ok('5: buttons use business language (Sync new transactions / Re-pull history / Archive duplicate / Move account to silo & repair)',
  /🔄 Sync new transactions/.test(bank) && /⏬ Re-pull history/.test(bank) && /Archive duplicate/.test(bank) && /Move account to silo & repair/.test(bank));
ok('6: the account move/repair asks for confirmation showing the silo + transaction count',
  /Move account ··' \+ \(a\.mask \|\| a\.plaid_account_id\) \+ ' to ' \+ bizLabel\(bizId\) \+ ' and re-tag its ' \+ cnt/.test(bank));

// Exchange surfaces a failed account stamp (no silent Unassigned)
ok('7: exchange returns accounts_assigned + account_assignment_error (stamp failure not hidden)',
  /accounts_assigned: accountsAssigned, account_assignment_error: accountAssignmentError/.test(exch) &&
  /accountsAssigned = false; accountAssignmentError = stampRes\.error\.message/.test(exch));
ok('8: BankTab warns when connect could not auto-assign the accounts',
  /exData\.accounts_assigned === false/.test(bank) && /could not be auto-assigned to/.test(bank));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-JY banktab-silo-organization tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
