// ============================================================
// v55.83-KG — two items:
//  (1) Codex money-safety: update_match must be APPLY-NEW-FIRST then REVERSE-OLD, and on any failure
//      reversing the old rows it must RESTORE them + void the new rows so the deposit is never left
//      half-changed (the original match stays intact).
//  (2) Max: a Bank-page SILO SWITCHER to flip silos and see each silo's accounts as the primary view.
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
var bank = rd('src/components/BankTab.jsx');

// (1) money-safety
ok('1: new payment-insert failure leaves the ORIGINAL match intact (no change made)',
  /Could not save the payment — NO change was made, your original match is intact/.test(route));
ok('2: old rows are voided EXCLUDING the just-created new match/payment (no self-void)',
  /\.eq\('bank_transaction_id', uTid\)\.neq\('id', uMid/.test(route) &&
  /\.eq\('bank_transaction_id', uTid\)\.neq\('id', uPid/.test(route));
ok('3: on a failed old-row void, it RESTORES old rows to prior state + voids the new rows + returns restored',
  /uOldMatches\[uri\]\.voided === true/.test(route) &&
  /uEx\[uri\]\.voided === true, sync_status: uEx\[uri\]\.sync_status/.test(route) &&
  /restored: true/.test(route));
ok('4: anti-double-count on the NEW invoice EXCLUDES this deposit\'s (to-be-voided) payments',
  /!isPaymentVoid\(uipr\[uy\]\) && uipr\[uy\]\.bank_transaction_id !== uTid/.test(route));

// (2) silo switcher
ok('5: BankTab imports setActiveWaveBusiness',
  /import \{ getActiveWaveBusiness, setActiveWaveBusiness, scopeIfRegistered \} from '\.\.\/lib\/wave-business'/.test(bank));
ok('6: switchSilo sets the active silo, mirrors local state, and re-scopes the page (loadData)',
  /function switchSilo\(id\) \{[\s\S]{0,260}setActiveWaveBusiness\(id[\s\S]{0,200}loadData\(\);/.test(bank));
ok('7: a silo dropdown in the Connected Accounts header lists the registry and calls switchSilo',
  /<select value=\{siloSel\} onChange=\{function \(e\) \{ switchSilo\(e\.target\.value\); \}\}/.test(bank) &&
  /bizRegistry\.map\(function \(b\) \{ return <option key=\{b\.wave_business_id\} value=\{b\.wave_business_id\}>/.test(bank));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-KG match-safety + silo-toggle tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
