// ============================================================
// v55.83-LU — Max: deposit account still not set (push blocked) because the picker may auto-detect 0
// usable accounts in a flooded chart even after LR/LS. Escape hatch: "Show all accounts" reveals every
// account; a non-auto-detected one can be set via "Use anyway" (allow_any). Accounts Receivable/Payable
// remain HARD-blocked (never a valid deposit/bank side), even with override.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var route = rd('src/app/api/wave/payment-account-setup/route.js');
var sync = rd('src/components/WaveSyncCenter.jsx');

ok('1: listAccounts returns ar_ap so the route can hard-block Receivable/Payable regardless of override',
  /payment_capable: payable, ar_ap: isReceivableOrPayable/.test(route));
ok('2: select-mode honors allow_any for a non-auto-detected account, but A/R-A/P is ALWAYS blocked',
  /var allowAny = body\.allow_any === true;/.test(route) &&
  /if \(match\.ar_ap\) \{ return NextResponse\.json\(\{ error: 'Accounts Receivable \/ Payable can never be the deposit/.test(route) &&
  /if \(!match\.payment_capable && !allowAny\) \{/.test(route));
ok('3: UI has a "Show all accounts" toggle and a "Use anyway" override (passes allow_any via confirm)',
  /var pa3 = useState\(false\); var payShowAll = pa3\[0\]/.test(sync) &&
  /Show all accounts/.test(sync) &&
  /runPaymentAccountSetup\('select', ac\.id, ac\.name, true\)/.test(sync) &&
  /Use anyway/.test(sync));
ok('4: runPaymentAccountSetup forwards allow_any when override is used',
  /function runPaymentAccountSetup\(mode, accountId, accountName, allowAny\)/.test(sync) &&
  /if \(allowAny\) \{ payload\.allow_any = true; \}/.test(sync));
ok('5: A/R rows in the show-all list are shown as "can\'t use", never with an override button',
  /var cap = ac\.payment_capable === true; var arap = ac\.ar_ap === true;/.test(sync) &&
  /arap \? <span className="text-slate-300 text-\[10px\] px-2">can't use<\/span>/.test(sync));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-LU deposit-account-override tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
