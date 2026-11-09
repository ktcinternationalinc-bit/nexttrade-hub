// ═══════════════════════════════════════════════════════════════════════════
// v55.83-RD — Max, Nov 8 14:24 (match popup screenshot, PNC Checking •9704):
//   "description should also be displayed in this area when seeing where it
//    was matched"
// The "Where this money went" box now shows the BANK line's description and,
// for every piece, what it was for: invoice → customer + its line
// descriptions; bill → vendor + category + notes.
// The screenshot also showed the bank description was a DATE ("2026-09-29"):
// an old PNC import took "Transaction Date" as the description (the old column
// guess took the first header containing "transaction"). RC's importer picks
// "Transaction Description", and re-importing repairs those lines in place.
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ FAIL: ' + name); } }
console.log('RD — descriptions where the money went');
var b = R('src/app/api/accounting/bills/route.js');
var at = R('src/components/AllTransactionsTab.jsx');
ok('1: invoice pieces carry the customer (company_name/contact_name — never a guessed column) and the invoice line descriptions; fail-soft',
  /db\.from\('accounting_customers'\)\.select\('id, company_name, contact_name'\)\.in\('id', custIdsD\)/.test(b) &&
  /db\.from\('accounting_invoice_items'\)\.select\('invoice_id, description, wave_product_name'\)\.in\('invoice_id', apInvIds\.slice\(0, 50\)\)/.test(b) &&
  /d4\.party = custByD\[r5\.accounting_customer_id\] \|\| null;/.test(b) && /catch \(eDsc\)/.test(b));
ok('2: bill pieces carry vendor + category + notes',
  /db\.from\('vendor_bills'\)\.select\('id, vendor_name, bill_number, category, notes'\)/.test(b) &&
  /d1\.desc = \[r3\.category \? String\(r3\.category\)\.replace/.test(b));
ok('3: the box shows the bank line description and a 📝 line under every matched piece',
  /<span className="font-extrabold">Bank line:<\/span>/.test(at) && /\{d5\.desc && <div className="text-\[10px\] pl-4"/.test(at) &&
  /d5\.kind === 'invoice' && d5\.party \? ' · ' \+ d5\.party : ''/.test(at));
var si = R('src/components/StatementImport.jsx');
var guessSrc = si.split('function guessCol')[1].split('\nexport default')[0];
var guessCol = new Function('return function guessCol' + guessSrc)();
var dc = JSON.parse(si.match(/var descCol = guessCol\(headers, (\[[^\]]+\])\);/)[1].replace(/'/g, '"'));
ok('4: a PNC-style file ("Transaction Date, Transaction Description, Amount") takes the DESCRIPTION, not the date',
  guessCol(['Transaction Date', 'Transaction Description', 'Amount', 'Balance'], dc) === 1 &&
  guessCol(['Date', 'Description', 'Withdrawals', 'Deposits', 'Balance'], dc) === 1);
var imp = R('src/app/api/accounting/statement-import/route.js');
var GEN = new Function('return ' + imp.match(/var GENERIC_DESC = (\/.*\/);/)[1])();
var clean = function (x) { return String(x).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); };
ok('5: lines an old import stored with a DATE as their description are repaired on re-import ("2026-09-29", "09/29/2026")',
  GEN.test(clean('2026-09-29')) && GEN.test(clean('09/29/2026')));
console.log('');
console.log('RD: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
