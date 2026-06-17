// ============================================================
// v55.83-IM — accounting/Wave QA hardening (final launch review fixes).
// Verifies the guards added for the verified defects: unchecked res.error
// (double-count / wrong-balance / overpayment-misclassification), over-apply
// of a deposit, silent push write-back failure, exchange_rate validation,
// void-flag visibility, canonical void helper, and the restored audit trail.
// ============================================================

var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }

var imp = rd('src/app/api/wave/import-invoices/route.js');
var br = rd('src/components/BankReviewTab.jsx');
var dash = rd('src/components/AccountingDashboard.jsx');
var ledger = rd('src/components/CustomerLedger.jsx');
var push = rd('src/app/api/wave/push-payment/route.js');
var wsc = rd('src/components/WaveSyncCenter.jsx');
var sql = rd('sql/v55-83-IM-wave-sync-log-columns.sql');

// 1 — import-invoices aborts instead of zeroing the double-count guard
ok('1: import-invoices checks ppRes.error and ABORTS (no silent double-count)',
  /if \(ppRes && ppRes\.error\) \{/.test(imp) && /Aborted to avoid double-counting/.test(imp));

// 2 — recomputeInvoice surfaces read errors instead of writing wrong balances
ok('2a: recomputeInvoice throws on payment-read error',
  /if \(r && r\.error\) \{ throw r\.error; \}\s*\n\s*var total = invoiceTotal\(inv\)/.test(br));
ok('2b: recomputeInvoice throws on invoice-fetch error (no silent skip)',
  /if \(r && r\.error\) \{ throw r\.error; \} \/\/ v55\.83-IM/.test(br));

// 3 — applyToInvoice surfaces read error (overpayment classified correctly)
ok('3: applyToInvoice throws on paid-now read error', /if \(pr && pr\.error\) \{ throw pr\.error; \}/.test(br));

// 4 — over-apply cap: cumulative posted from a deposit can't exceed it
ok('4: applyToInvoice caps cumulative application at the deposit amount',
  /var depositAmt = roundMoney\(/.test(br) && /alreadyApplied \+ apply\) > depositAmt \+ 0\.01/.test(br));

// 5 — dashboard payment query includes the voided column
ok('5: AccountingDashboard payment select includes voided',
  /accounting_invoice_payments', 'accounting_invoice_id,amount,payment_date,sync_status,bank_transaction_id,voided'/.test(dash));

// 6 — CustomerLedger uses the canonical (sync_status-aware) void helper
ok('6: CustomerLedger delegates to canonical isPaymentVoid (+legacy union)',
  /import \{ isPaymentVoid as isPaymentVoidCanonical \} from '\.\.\/lib\/payment-matching'/.test(ledger) &&
  /isPaymentVoidCanonical\(p\) \|\|/.test(ledger));

// 7 — push-payment: write-back failure is not silent success
ok('7a: push-payment checks the write-back error', /var wb = await db\.from\('accounting_invoice_payments'\)\.update\(\{ wave_payment_id: wavePaymentId, sync_status: 'synced', last_synced_at/.test(push) && /if \(wb && wb\.error\) \{/.test(push));
ok('7b: push-payment returns manual_reconcile instead of false success', /manual_reconcile: true, wave_payment_id: wavePaymentId/.test(push));

// 8 — exchange_rate validation
ok('8: push-payment validates exchange_rate (positive finite)',
  /if \(!isFinite\(erNum\) \|\| erNum <= 0\)/.test(push));

// 9 — audit trail restored
ok('9a: SQL adds wave_business_id + dry_run to wave_sync_log',
  /ADD COLUMN IF NOT EXISTS wave_business_id text/.test(sql) && /ADD COLUMN IF NOT EXISTS dry_run boolean/.test(sql));
ok('9b: WaveSyncCenter filter no longer hides unscoped audit rows',
  /l\.wave_business_id == null/.test(wsc));

console.log('');
if (failures.length === 0) {
  console.log('✅ All v55.83-IM accounting QA hardening tests passed');
  process.exit(0);
} else {
  console.log('❌ ' + failures.length + ' tests FAILED:');
  failures.forEach(function (f) { console.log('   - ' + f); });
  process.exit(1);
}
