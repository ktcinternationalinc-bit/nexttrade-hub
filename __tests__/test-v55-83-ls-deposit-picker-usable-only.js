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

ok('1: deposit picker renders ONLY payment_capable accounts (no "can\'t use" / non-capable rows)',
  /var capable = payList\.filter\(function \(ac\) \{ return ac\.payment_capable === true; \}\);/.test(sync) &&
  /capable\.map\(function \(ac\)/.test(sync) &&
  !/not a deposit account/.test(sync) &&
  !/can't use<\/span>/.test(sync));
ok('2: when 0 usable, ONE clear message says to add a Cash & Bank account in Wave',
  /if \(capable\.length === 0\) \{/.test(sync) &&
  /Add account → type "Cash &amp; Bank"/.test(sync));
ok('3: usable list shows a count header + "Use this" wired to select',
  /usable bank\/cash account/.test(sync) &&
  /runPaymentAccountSetup\('select', ac\.id, ac\.name\)/.test(sync));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-LS deposit-picker tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
