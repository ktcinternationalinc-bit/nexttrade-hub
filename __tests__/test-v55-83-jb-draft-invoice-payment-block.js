// ============================================================
// v55.83-JB — Matched payment to a DRAFT Wave invoice must NOT look like a normal retryable push
// (Codex P0 core workflow). Wave refuses: "A payment cannot be added to a draft invoice".
// Fix: Sync Center blocks the payment row when its invoice is DRAFT/pushed_draft (not retryable),
// surfaces an "Approve invoice in Wave" button on that row, and disables the checkbox; eligibility/
// dry-run reports DRAFT as blocked (not ready); the push route already auto-approves then blocks on
// failure with a repair-oriented message.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var elig = rd('src/lib/wave-sync-eligibility.js');
var wsc = rd('src/components/WaveSyncCenter.jsx');
var route = rd('src/app/api/wave/push-payment/route.js');

// 1. Eligibility / Dry Run rejects DRAFT invoices.
ok('1: paymentEligible rejects a DRAFT / pushed_draft invoice',
  /invoice\.wave_status === 'DRAFT' \|\| invoice\.wave_sync_status === 'pushed_draft'/.test(elig) &&
  /approve it in Wave\/Hub before recording payment/.test(elig));

// 2. Sync Center blocks the payment row (so it is NOT marked retryable) when the invoice is DRAFT.
ok('2: Sync Center sets a hard block on the payment row for a DRAFT invoice',
  /inv && \(inv\.wave_status === 'DRAFT' \|\| inv\.wave_sync_status === 'pushed_draft'\)\) \{ blocked = 'Wave invoice is DRAFT/.test(wsc));
ok('2b: block message warns that retrying hits the same Wave error',
  /Retrying the payment will hit the same Wave error/.test(wsc));

// 3. Because retryFail only sets when !blocked, a DRAFT payment is blocked (not retryable) and the
//    checkbox is disabled by the existing disabled={!!q.blocked} + selectedRows filter on !q.blocked.
ok('3: retryable flag is gated on having no block',
  /if \(!blocked && \(p\.sync_status === 'sync_failed' \|\| p\.sync_status === 'failed'\)\)/.test(wsc) &&
  /selectedRows = queue\.filter\(function \(q\) \{ return sel\[q\.key\] && !q\.blocked; \}\)/.test(wsc) &&
  /disabled=\{!!q\.blocked\}/.test(wsc));

// 4. The payment row carries its invoice id and renders an "Approve invoice in Wave" button.
ok('4: payment row carries draftBlockedInvoiceId for the repair button',
  /draftBlockedInvoiceId: \(inv && \(inv\.wave_status === 'DRAFT' \|\| inv\.wave_sync_status === 'pushed_draft'\)\) \? inv\.id : null/.test(wsc));
ok('4b: an Approve-invoice-in-Wave button renders on the DRAFT payment row',
  /q\.action === 'payment' && q\.draftBlockedInvoiceId && canPushInvoice && <button onClick=\{function \(\) \{ approveInWave\(q\.draftBlockedInvoiceId\); \}\}/.test(wsc));

// 5. Push route still auto-approves DRAFT then blocks with a repair-oriented message on failure.
ok('5: push-payment auto-approves a DRAFT invoice then blocks (repair message) if approve fails',
  /invDraftBlocked/.test(route) && /invoiceApprove/.test(route) &&
  /auto-approve did not succeed\. Use "Approve in Wave"/.test(route));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-JB draft-invoice-payment-block tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
