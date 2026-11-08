// ═══════════════════════════════════════════════════════════════════════════
// v55.83-QA — Category dropdown on every All-Transactions row + create a
// bill straight from a transaction.
//
// Max (Nov 7, 11:32, screenshot of 📑 All Transactions): "we need to be able
// to enter categories and also attach it to a bill from here."
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('QA — row category dropdown + bill-from-transaction');

var at = R('src/components/AllTransactionsTab.jsx');

ok('1a: the Category column is a DROPDOWN on every row — one pick runs the same engine as bulk (whitelist, rule learned, Wave ride-along)',
  // QZ2 (review, Max Nov 8 12:00) superseded the exact call: the same engine, plus
  // single_pick:true so ONE person-picked row is finished like Bank Review and
  // reaches the ClickBooks ledger. Same intent — realigned, not dropped.
  /api\('bulk_classify', \{ ids: \[t\.id\], classification: key, single_pick: true \}\)/.test(at) &&
  /onChange=\{function \(e\) \{ setCatOne\(t, e\.target\.value\); \}\}/.test(at));
ok('1b: picking Transfer on a row immediately offers the other leg (openTransfer), and says it never counts as income/spending',
  /if \(key === 'transfer'\) \{ toast\.success\('Marked as a TRANSFER — never income, never spending in any report\.'\); openTransfer\(t\); \}/.test(at));
ok('1c: a PAIRED transfer row keeps its locked ↔ chip (no dropdown to accidentally break the pair)',
  /\{t\.transfer \? <span className="px-1\.5 py-0\.5 rounded text-\[9px\] font-extrabold" style=\{\{ background: '#dbeafe', color: '#1e40af' \}\}>↔ transfer<\/span>/.test(at));

ok('2a: ➕ Create bill from this transaction lives in the BILL match modal only (money-out), one click: save_bill then record_payment',
  /mPanel\.kind === 'bill' && <button onClick=\{createBillFromTxn\}/.test(at) &&
  /action: 'save_bill'/.test(at) && /action: 'record_payment', bill_id: j\.id/.test(at));
ok('2b: the created bill is prefilled FROM the transaction — vendor, date, amount; txn category travels; payment linked to the bank txn',
  /vendor_name: vend, bill_date: t\.posted_date \|\| t\.date, total_amount: t\.amount_abs/.test(at) &&
  /category: t\.classification \|\| ''/.test(at) &&
  /bank_transaction_id: t\.id, user_id: userProfile && userProfile\.id \}\) \}\)\n          \.then\(function \(r2\) \{ return r2\.json\(\); \}\)/.test(at));
ok('2c: no merchant name → clear refusal (never a nameless vendor bill); bill-created-but-payment-failed is SAID, not hidden',
  /This transaction has no merchant name — add the bill in the Bills tab instead\./.test(at) &&
  /but the payment link failed/.test(at));
ok('2d: server-side save_bill still fills the vendor\'s REMEMBERED category when none given (PJ memory, unchanged)',
  /autoCat = await suggestCategory\(db, vendor\);/.test(R('src/app/api/accounting/bills/route.js')));

console.log('');
console.log('QA: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
