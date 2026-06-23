// ============================================================
// v55.83-LY — Codex hard-FAIL on LX (label-only). Real behavioral fixes:
//  #1 push errors were written into the INVOICE-PRODUCT message box (setProdMsg) → a bank-txn push failure
//     showed under "Default Invoice Product". Now push results use a dedicated pushMsg, rendered in
//     Pending Sync.
//  #2/#3 Pending Sync let a categorized transaction push even when the Wave Deposit Account was missing
//     (server then rejects). Now the queue blocks it client-side with the exact reason + a jump to Settings.
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

ok('1: push results use a DEDICATED pushMsg state (not the invoice-product prodMsg)',
  /var psPush = useState\(''\); var pushMsg = psPush\[0\]; var setPushMsg = psPush\[1\];/.test(sync) &&
  /if \(failed > 0\) \{ setPushMsg\('Push: '/.test(sync) &&
  // and pushSelected no longer writes the push summary into prodMsg
  !/setProdMsg\('Push: '/.test(sync));
ok('2: pushMsg is rendered in the Pending Sync tab (so push failures no longer appear in Default Invoice Product)',
  /\{pushMsg && <div className="px-3 py-2 text-\[11px\] whitespace-pre-wrap[\s\S]{0,80}\{pushMsg\}/.test(sync));
ok('3: the queue BLOCKS a categorized transaction when the Wave deposit account is missing (client-side, not just server)',
  /var hasDeposit = !!\(prodSetup && prodSetup\.default_payment_account_id\);/.test(sync) &&
  /var btBlocked = !hasCat \? 'Pick a Wave category first[\s\S]{0,80}!hasDeposit \? 'Set the Wave Deposit Account first/.test(sync) &&
  /needsDepositAccount: hasCat && !hasDeposit/.test(sync));
ok('4: the queue useMemo recomputes when prodSetup loads (deposit account state is a dependency)',
  /\}, \[customers, invoices, payments, bankTxns, splitTxns, active, prodSetup\]\);/.test(sync));
ok('5: a "Go to Settings → set it" jump appears when a transaction is blocked on the deposit account',
  /actionableQueue\.some\(function \(q\) \{ return q\.needsDepositAccount; \}\)/.test(sync) &&
  /onClick=\{function \(\) \{ setTab\('settings'\); \}\}/.test(sync) &&
  /Go to Settings → set it/.test(sync));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-LY push-routing+block tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
