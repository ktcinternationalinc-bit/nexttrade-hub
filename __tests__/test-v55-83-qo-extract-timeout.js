// ═══════════════════════════════════════════════════════════════════════════
// v55.83-QO — "attempted to add bill from document and nothing happened"
// (Max, Nov 7 15:53, Trinity Logistics 3-page merged PDF). Root cause: the
// AI read outlived Vercel's DEFAULT 10s function limit — the platform killed
// the request mid-read, and the client had no catch for a dead connection.
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('QO — document-read timeout fix');
ok('1: the AI-reading routes declare maxDuration 60 — bills (extract_bill + ingest_bill_file) and invoice-write (extract_invoice); email-scan already had it',
  /export const maxDuration = 60;/.test(R('src/app/api/accounting/bills/route.js')) &&
  /export const maxDuration = 60;/.test(R('src/app/api/accounting/invoice-write/route.js')) &&
  /export const maxDuration = 60;/.test(R('src/app/api/accounting/bills/email-scan/route.js')));
ok('2: a killed or dropped read is SAID, never silent — catch with a plain explanation and the page-1 fallback suggestion',
  /The reader took too long or the connection dropped/.test(R('src/components/BillsTab.jsx')) &&
  /send just the invoice page \(page 1\) instead of the merged PDF/.test(R('src/components/BillsTab.jsx')));
console.log('');
console.log('QO: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
