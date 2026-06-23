// ============================================================
// v55.83-LX — Max: "two account settings, I don't know what each does." The Settings tab had two boxes
// both labelled "...account" that write different things. Relabeled so it's unmistakable which is the
// Wave push-required one vs the local display-only one. (Build 1 of the Wave-UI consolidation plan.)
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

ok('1: the Wave deposit account box is clearly marked REQUIRED-for-push (the one the push needs)',
  /Wave Deposit Account — REQUIRED for pushing to Wave/.test(sync) &&
  /This is the one the transaction\/payment push needs/.test(sync));
ok('2: the local Bank Review default account box is clearly marked display-only / never-sent-to-Wave',
  /Bank Review default account — display only \(NOT sent to Wave\)/.test(sync) &&
  /never sent to Wave/.test(sync) &&
  /You do not need to set this to push/.test(sync));
ok('3: the two old ambiguous "...account" labels are gone',
  !/>Payment Deposit Account \(Wave\)</.test(sync) &&
  !/>Default Bank Account for This Silo</.test(sync));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-LX settings-clarity tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
