// ============================================================
// v55.83-KC — "AL MOUSTAFA 98 vs 53": a customer's invoices were UNDER-COUNTED because Customer AR
// History and Customer Ledger matched only accounting_customer_id, while Wave-imported invoices link by
// wave_customer_id. Now both screens match BY EITHER, and AR History shows the linkage provenance.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var ar = rd('src/components/AccountingCustomerHistory.jsx');
var led = rd('src/components/CustomerLedger.jsx');

// (PW superseded the single-customer match with GROUP matching for customer
// merge — same KC rule, now across every merged member id + member wave id.)
ok('1 (PW): AR History invoicesFor matches any GROUP member id OR member wave_customer_id',
  /function invoicesFor\(custId\) \{ var ids = groupMembers\(custId\); var ws = groupWaveIds\(custId\); return invoices\.filter\(function \(i\) \{ return ids\.indexOf\(i\.accounting_customer_id\) >= 0 \|\| \(i\.wave_customer_id && ws\.indexOf\(i\.wave_customer_id\) >= 0\)/.test(ar));
ok('2 (PW): AR History proformasFor matches group members + wave ids too',
  /function proformasFor\(custId\) \{ var ids = groupMembers\(custId\); var ws = groupWaveIds\(custId\); return proformas\.filter\(function \(p\) \{ return ids\.indexOf\(p\.accounting_customer_id\) >= 0 \|\| \(p\.wave_customer_id && ws\.indexOf\(p\.wave_customer_id\) >= 0\)/.test(ar));
ok('3: AR breakdown shows linkage provenance (byAcctId vs byWaveId) so the count is reconcilable',
  /b\.byAcctId\+\+/.test(ar) && /b\.byWaveId\+\+/.test(ar) && /linked via Wave customer id/.test(ar));
ok('4: CustomerLedger custInvoices also matches accounting_customer_id OR wave_customer_id',
  /var wcid = selCust && selCust\.wave_customer_id/.test(led) &&
  /i\.accounting_customer_id === selectedId \|\| \(wcid && i\.wave_customer_id && i\.wave_customer_id === wcid\)/.test(led));
ok('5 (PW): the linkage stays GUARDED — group wave list holds only non-null ids, invoice must carry one to match; Ledger guard unchanged',
  /if \(w2\) \{ ws\.push\(w2\); \}/.test(ar) && /i\.wave_customer_id && ws\.indexOf\(i\.wave_customer_id\) >= 0/.test(ar) &&
  /\(wcid && i\.wave_customer_id && i\.wave_customer_id === wcid\)/.test(led));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-KC customer-wave-linkage tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
