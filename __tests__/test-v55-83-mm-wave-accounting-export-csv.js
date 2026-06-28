// ============================================================
// v55.83-MM - Wave accounting.csv data export support.
// Wave's accounting.csv is double-entry. The import must use the bank-side row
// for old transaction categories and defer A/R invoice-payment rows to payment sync.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];

function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
function ok(label, cond) {
  if (cond) { console.log('OK ' + label); }
  else { failures.push(label); console.log('FAIL ' + label); }
}

var route = rd('src/app/api/wave/import-transaction-csv/route.js');
var page = rd('src/app/page.jsx');
var wn = rd('src/components/WhatsNewWidget.jsx');
var runner = rd('scripts/run-accounting-bank-regression.js');

ok('1: visible build identifies MM; the import-transaction-csv route carries a current marker',
  /v55\.83-MM/.test(page) &&
  /version: 'v55\.83-MM'/.test(wn) &&
  /API_BUILD_MARKER = 'v55\.83-M[MN]-import-transaction-csv/.test(route));
ok('2: importer detects Wave accounting.csv shape by account name/type + transaction id',
  /accountName: findCol\(headers, \['account name'\], null\)/.test(route) &&
  /accountType: findCol\(headers, \['account type'\], null\)/.test(route) &&
  /var isWaveAccountingExport = ci\.accountName >= 0 && ci\.accountType >= 0 && ci\.category >= 0 && findCol\(headers, \['transaction id'\]\) >= 0;/.test(route));
ok('3: accounting.csv uses signed Amount \(One column\), not journal debit-credit polarity',
  /if \(isWaveAccountingExport && ci\.amount >= 0\) \{ var aw = parseAmount\(rowArr\[ci\.amount\]\); if \(aw != null\) \{ return aw; \} \}/.test(route));
ok('4: category import only uses Cash/Bank rows and skips A/R-A/P bank rows',
  /if \(!\(rAcctType\.indexOf\('cash'\) >= 0 \|\| rAcctType\.indexOf\('bank'\) >= 0\)\) \{ skippedNonBank\+\+; continue; \}/.test(route) &&
  /cCatN\.indexOf\('accounts receivable'\) >= 0 \|\| cCatN\.indexOf\('accounts payable'\) >= 0/.test(route));
ok('5: negative Accounts Receivable invoice rows are deferred to payment sync',
  /var arPaymentRow = cInv && rAcctName\.indexOf\('accounts receivable'\) >= 0 && cSigned != null && cSigned < 0;/.test(route) &&
  /if \(arPaymentRow\) \{ needsInvoiceLink\.push/.test(route));
ok('6: regression gate includes this accounting.csv guard',
  /test-v55-83-mm-wave-accounting-export-csv\.js/.test(runner));

console.log('');
if (failures.length === 0) { console.log('All v55.83-MM accounting.csv importer tests passed'); process.exit(0); }
console.log(failures.length + ' FAILED:');
failures.forEach(function (f) { console.log('   - ' + f); });
process.exit(1);
