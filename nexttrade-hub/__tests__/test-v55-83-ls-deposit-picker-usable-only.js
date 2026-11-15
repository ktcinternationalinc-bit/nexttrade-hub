// ============================================================
// v55.83-LS — Max: the deposit-account picker was a confusing wall of "Accounts Payable · can't use" rows
// (flooded chart). Now it shows ONLY usable bank/cash accounts; if there are none, ONE clear message tells
// the user to create a Cash & Bank account in Wave. No more scrolling past 200 unusable rows.
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

ok('1: deposit picker DEFAULTS to usable bank/cash accounts only (capable filter; full list only via Show-all — LU)',
  /var capable = payList\.filter\(function \(ac\) \{ return ac\.payment_capable === true; \}\);/.test(sync) &&
  /var rows = payShowAll \? payList : capable;/.test(sync));
ok('2: when 0 usable (and not showing all), one clear message: Show all to override OR add a Cash & Bank account in Wave',
  /capable\.length === 0 && !payShowAll/.test(sync) &&
  /Add account → type "Cash &amp; Bank"/.test(sync));
ok('3: usable list shows a count header + "Use this" wired to select',
  /usable bank\/cash account/.test(sync) &&
  /runPaymentAccountSetup\('select', ac\.id, ac\.name\)/.test(sync));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-LS deposit-picker tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
