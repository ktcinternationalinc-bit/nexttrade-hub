// ============================================================
// v55.83-LB — Max: "tried to push transaction... nothing happened, and no sync logs." A push that failed
// validation (e.g. no Wave deposit account set after a fresh connect) returned a 400 BEFORE any logging,
// and pushSelected swallowed the reason into a generic toast. Now: every blocked/failed transaction push
// writes a wave_sync_log row + returns the specific reason, and pushSelected surfaces that reason. Also
// the transaction gate uses the MASTER switches (writes + production unlock), not the payment sub-toggle.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var route = rd('src/app/api/wave/push-transaction/route.js');
var sync = rd('src/components/WaveSyncCenter.jsx');

ok('1: push-transaction has a blocked() helper that writes a wave_sync_log row AND returns the specific reason',
  /async function blocked\(reason, status\) \{/.test(route) &&
  /from\('wave_sync_log'\)\.insert\(\{[\s\S]{0,200}success: false, error_message: reason/.test(route) &&
  /return NextResponse\.json\(\{ ok: false, error: reason/.test(route));
ok('2: the no-deposit-account / no-category / locked / matched failures all go through blocked() (so they log)',
  /if \(!anchorAcct\) \{/.test(route) && /return blocked\('Could not resolve the Wave bank account for this transaction/.test(route) &&
  /if \(!categoryAcct\) \{ return blocked\('No Wave category assigned/.test(route) &&
  /if \(!_isApprovedTest && !_prodUnlocked\) \{ return blocked\(/.test(route) &&
  /if \(bt\.matched_invoice_id\) \{ return blocked\(/.test(route));
ok('3: the transaction gate uses MASTER switches (writes + production unlock), NOT the payment sub-toggle',
  /var _prodUnlocked = !!\(_preg && _preg\.is_production !== false && _preg\.production_push_unlocked === true && _preg\.writes_enabled === true\);/.test(route) &&
  !/_prodUnlocked = !!\([^;]*allow_payment_push === true\)/.test(route));
ok('4: pushSelected captures each push\'s specific error and surfaces it (not a silent "nothing happened")',
  /var done = 0, failed = 0; var errs = \[\];/.test(sync) &&
  /errs\.push\(\(q\.label \|\| q\.action\) \+ ': ' \+ \(d\.error \|\| \('HTTP ' \+ x\.http\)\)\)/.test(sync) &&
  /if \(failed > 0\) \{ setPushMsg\('Push: ' \+ done \+ ' ok, ' \+ failed \+ ' failed.[\s\S]{0,80}toast\.error\('Push: '/.test(sync));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-LB push-feedback tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
