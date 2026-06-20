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

ok('1: AR History invoicesFor matches accounting_customer_id OR the customer wave_customer_id',
  /function invoicesFor\(custId\) \{ var w = custWaveId\(custId\); return invoices\.filter\(function \(i\) \{ return i\.accounting_customer_id === custId \|\| \(w && i\.wave_customer_id && i\.wave_customer_id === w\)/.test(ar));
ok('2: AR History proformasFor also matches by wave_customer_id',
  /function proformasFor\(custId\) \{ var w = custWaveId\(custId\); return proformas\.filter\(function \(p\) \{ return p\.accounting_customer_id === custId \|\| \(w && p\.wave_customer_id && p\.wave_customer_id === w\)/.test(ar));
ok('3: AR breakdown shows linkage provenance (byAcctId vs byWaveId) so the count is reconcilable',
  /b\.byAcctId\+\+/.test(ar) && /b\.byWaveId\+\+/.test(ar) && /linked via Wave customer id/.test(ar));
ok('4: CustomerLedger custInvoices also matches accounting_customer_id OR wave_customer_id',
  /var wcid = selCust && selCust\.wave_customer_id/.test(led) &&
  /i\.accounting_customer_id === selectedId \|\| \(wcid && i\.wave_customer_id && i\.wave_customer_id === wcid\)/.test(led));
ok('5: the linkage match is GUARDED by a non-null wave id (no cross-customer bleed when wave_customer_id is null)',
  /\(w && i\.wave_customer_id && i\.wave_customer_id === w\)/.test(ar) && /\(wcid && i\.wave_customer_id && i\.wave_customer_id === wcid\)/.test(led));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-KC customer-wave-linkage tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
