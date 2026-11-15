// v55.83-MT — Codex Round 4 (think-tank agreed): Sync Log clarity + remove doubled row + multi-push.
// These guard the agreed fixes so they cannot silently regress.
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond) { if (cond) console.log('OK ' + label); else { failures.push(label); console.log('FAIL ' + label); } }
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var sync = rd('src/components/WaveSyncCenter.jsx');
var inv = rd('src/app/api/wave/push-invoice-v2/route.js');

// ── Item 1: doubled row removed (keep invrepair + payment prereq) ──
ok('1: the duplicate "invneedsapproval:" invoice row path is REMOVED (it duplicated the payment row)',
  !/key: 'invneedsapproval:'/.test(sync) && !/needsApproval: true/.test(sync) && !/var invoiceIdsWithPendingPayment = /.test(sync));
ok('2: the DRAFT-repair row + the payment prereq Approve&Push are KEPT',
  /invrepair:/.test(sync) && /approveAndPushInvoice\(q\.prereqInvoiceId\)/.test(sync) && /prereqInvoiceId:/.test(sync));

// ── Item 2: Sync Log clarity ──
ok('3: the mojibake separator is gone (no "Â·" anywhere in the file)', !/Â·/.test(sync));
ok('4: the result chip is 3-state (preview / pushed+Wave id / blocked) — NOT the old binary ok/blocked',
  /✓ pushed to Wave/.test(sync) && /✓ preview ok/.test(sync) && /⛔ blocked \/ failed/.test(sync) &&
  !/l\.success \? 'ok' : 'blocked\/failed'/.test(sync));
ok('5: the success chip surfaces the returned Wave id',
  /var waveId = l\.wave_record_id/.test(sync) && /pushed to Wave' \+ \(waveId \?/.test(sync));
ok('6: push-invoice-v2 injects human context (invoice#/customer/amount) into EVERY log path (no bare logSync(db, ...) calls)',
  /var invLogCtx = \{ invoice_number: inv\.invoice_number, customer_name: null, amount: inv\.total_amount \}/.test(inv) &&
  /function logInv\(row\)/.test(inv) &&
  /invLogCtx\.customer_name = cust\.company_name/.test(inv) &&
  !/await logSync\(db, \{/.test(inv));

// ── Item 2b: multi-push ──
ok('7: the one-at-a-time money guard is LIFTED (no "ONE at a time" block; no selectedBooks limit)',
  !/Push payments\/transactions ONE at a time/.test(sync) && !/var selectedBooks =/.test(sync));
ok('8: pushSelected pushes SEQUENTIALLY in dependency-safe order (customer->invoice->payment->transaction)',
  /var ORDER = \{ customer: 0, invoice: 1, payment: 2, transaction: 3 \}/.test(sync) &&
  /var ordered = selectedRows\.slice\(\)\.sort/.test(sync) && /seq = seq\.then/.test(sync));
ok('9: every pushSelected early-return shows a VISIBLE inline pushMsg, not a toast-only block',
  /if \(isProd && !productionUnlocked\) \{ setPushMsg\('⛔/.test(sync) &&
  /if \(selectedRows\.length === 0\) \{ setPushMsg\('⛔/.test(sync) &&
  /if \(lacksPerm\) \{ setPushMsg\('⛔/.test(sync));
ok('10: mixed success/failure keeps failed rows selected (retryable) + reports per-row errors, reloads once',
  /var failedKeys = \{\}/.test(sync) && /failedKeys\[q\.key\] = true/.test(sync) &&
  /setSel\(failed > 0 \? failedKeys : \{\}\)/.test(sync));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-MT round-4 tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
