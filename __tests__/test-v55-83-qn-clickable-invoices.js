// ═══════════════════════════════════════════════════════════════════════════
// v55.83-QN — Invoices clickable + editable from Customer AR History and
// All Invoices (Max, Nov 7 15:49 screenshot of a customer's invoice list:
// "invoices should be clickable and editable").
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('QN — clickable + editable invoices everywhere');
var h = R('src/components/AccountingCustomerHistory.jsx');
var bb = R('src/components/BusinessBooksTab.jsx');
var at = R('src/components/AccountingTab.jsx');
ok('1: Customer AR History — every invoice number is a BUTTON opening the shared InvoicePeek (details, items, payments)',
  /setPeekId\(i\.id\); \}\} title="Open this invoice — details, items, payments, and ✏ Edit"/.test(h) &&
  /\{peekId && <InvoicePeek invoiceId=\{peekId\} onClose=/.test(h));
ok('2: ✏ Edit from the popup jumps to the REAL editor — same flag+event handshake the other tabs use, landing on the Invoices tab',
  /window\.__ntOpenInvoiceEdit = idQ; window\.dispatchEvent\(new CustomEvent\('nt-open-invoice-edit', \{ detail: idQ \}\)\)/.test(h) &&
  /peekGo\('invoices'\)/.test(h));
ok('3: All Invoices — invoice numbers clickable with the SAME peek + edit handshake',
  /setPeekId2\(r\.id\); \}\}/.test(bb) && /\{peekId2 && <InvoicePeek invoiceId=\{peekId2\}/.test(bb) &&
  /onGo2\('invoices'\)/.test(bb));
ok('4: both tabs receive onGo from AccountingTab so the jump actually navigates',
  /<AccountingCustomerHistory key=\{'acct-arh\|' \+ waveKey\} \{\.\.\.props\} onGo=\{setSub\} \/>/.test(at) &&
  /<BusinessBooksTab \{\.\.\.props\} onGo=\{setSub\} \/>/.test(at));
console.log('');
console.log('QN: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
