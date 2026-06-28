// ============================================================
// v55.83-MG - Max hit the payment version of the old silent push bug:
// a payment push/move could fail before Wave was called, yet Sync Log had no
// payment row. Every blocked/failed payment push must now leave an audit trail.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];

function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
function ok(label, cond, hint) {
  if (cond) { console.log('OK ' + label); }
  else {
    failures.push(label + (hint ? ' - ' + hint : ''));
    console.log('FAIL ' + label + (hint ? ' - ' + hint : ''));
  }
}

var route = rd('src/app/api/wave/push-payment/route.js');
var sync = rd('src/components/WaveSyncCenter.jsx');

ok('1: push-payment build marker documents the no-silent-payment-push fix (Lane B: no feed-owner block)',
  /API_BUILD_MARKER = 'v55\.83-MP-push-payment-no-feed-owner-block'/.test(route));

ok('2: push-payment has a blocked() helper that writes a failed payment sync-log row',
  /async function blocked\(reason, status, clientFields, extraPayload\) \{/.test(route) &&
  /from\('wave_sync_log'\)\.insert\(\{[\s\S]{0,500}entity_type: 'payment'[\s\S]{0,300}success: false[\s\S]{0,180}error_message: reason/.test(route) &&
  /return NextResponse\.json\(Object\.assign\(\{ ok: false, error: reason/.test(route));

ok('3: setup and validation blockers use blocked(), not silent direct returns',
  /if \(!_perm\.ok\) \{ return blocked\(_perm\.error, _perm\.status\); \}/.test(route) &&
  /if \(!token\) \{ return blocked\('Wave token not configured\.', 400\); \}/.test(route) &&
  /if \(!hubId\) \{ return blocked\('No payment row id provided\.', 400\); \}/.test(route) &&
  /isPlaceholderWaveBusiness\(waveBusinessId\)\) \{ return blocked\(/.test(route) &&
  /if \(!_isApprovedTest && !_prodUnlocked\) \{[\s\S]{0,120}return blocked\('Production payment push is locked/.test(route));

ok('4: payment-row blockers use blocked() for not-found, voided, already-pushed, missing Wave invoice, and orphan deposit',
  /if \(!pay\) \{ return blocked\('Payment row not found\.', 404\); \}/.test(route) &&
  /if \(pay\.voided === true \|\| pay\.sync_status === 'void'\) \{ return blocked\('Payment is voided\.', 400\); \}/.test(route) &&
  /if \(pay\.wave_payment_id\) \{ return blocked\('Payment already pushed/.test(route) &&
  /if \(!invWaveId\) \{ return blocked\('Invoice is not in Wave yet/.test(route) &&
  /return blocked\('Bank deposit for this payment no longer exists/.test(route));

ok('5: account/input blockers use blocked() + keep the needs-payment-account hint (Lane B: feed-owner firewall removed — no payFw block)',
  /if \(!paymentAccountId\) \{ return blocked\('No Wave bank\/deposit account could be resolved/.test(route) &&
  /needs_payment_account: true/.test(route) &&
  !/feedOwnerVerdict/.test(route) &&
  /if \(!\(amount > 0\)\) \{ return blocked\('Payment amount must be positive\.', 400\); \}/.test(route) &&
  /if \(!paymentDate\) \{ return blocked\('Payment date is required\.', 400\); \}/.test(route) &&
  /return blocked\('Invalid exchange_rate: must be a positive number\.', 400\)/.test(route));

ok('6: cross-silo, draft-approval failure, and already-syncing conflicts all log through blocked()',
  /return blocked\('This payment\\'s invoice belongs to a different Wave business/.test(route) &&
  /return blocked\('This payment belongs to a different Wave business/.test(route) &&
  /return blocked\('Payment cannot be pushed: the Wave invoice is DRAFT/.test(route) &&
  /approve_failed: true/.test(route) &&
  /return blocked\('Payment is already syncing or no longer pending/.test(route));

ok('7: rich payment log context is shared by blocked, Wave failure, and success paths',
  /var pay = null;\s*var logCtx = null;/.test(route) &&
  /logCtx = \{[\s\S]{0,900}payment_account_id: paymentAccountId[\s\S]{0,220}sync_status_before: pay\.sync_status/.test(route) &&
  /buildLogPayload\(logCtx, Object\.assign\(\{ error: reason \}/.test(route) &&
  /buildLogPayload\(logCtx, \{ wave_payment_id: wavePaymentId, sync_status_after: 'synced' \}\)/.test(route));

ok('8: catch path resets a claimed syncing payment to sync_failed and logs the crash',
  /\.update\(\{ sync_status: 'sync_failed', sync_error: errMsg \}\)[\s\S]{0,160}\.eq\('sync_status', 'syncing'\)/.test(route) &&
  /from\('wave_sync_log'\)\.insert\(\{[\s\S]{0,240}entity_type: 'payment'[\s\S]{0,220}error_message: errMsg/.test(route) &&
  /buildLogPayload\(logCtx, \{ error: errMsg, sync_status_after: 'sync_failed' \}\)/.test(route));

ok('9: Wave Sync Center already routes payment pushes to the payment route and surfaces the returned reason',
  /q\.action === 'transaction' \? '\/api\/wave\/push-transaction' : '\/api\/wave\/push-payment'/.test(sync) &&
  /errs\.push\(\(q\.label \|\| q\.action\) \+ ': ' \+ \(d\.error \|\| \('HTTP ' \+ x\.http\)\)\)/.test(sync) &&
  /setPushMsg\('Push: ' \+ done \+ ' ok, ' \+ failed \+ ' failed/.test(sync));

console.log('');
if (failures.length === 0) {
  console.log('All v55.83-MG payment push feedback tests passed');
  process.exit(0);
}

console.log(failures.length + ' FAILED:');
failures.forEach(function (f) { console.log('   - ' + f); });
process.exit(1);
