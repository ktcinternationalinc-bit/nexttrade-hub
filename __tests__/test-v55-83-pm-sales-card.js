// ═══════════════════════════════════════════════════════════════════════════
// v55.83-PM — SALES RECEIVED card on the Books home
//
// Max (Nov 7, 04:12): "we should then also have all sales - which are
// related to sales... as a card."
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('PM — sales received card');

var br = R('src/app/api/accounting/bills/route.js');
ok('1a: sales = settled deposits in period that are invoice-matched OR classified customer_payment — never a guess',
  /var isSales = !!t\.matched_invoice_id \|\| t\.classification === 'customer_payment';/.test(br) &&
  /if \(t\.pending === true \|\| t\.direction !== 'in'\) \{ return; \}/.test(br));
ok('1b: same period test as CAME IN (posted-date), so sales is always a subset of came-in',
  /var dS = t\.posted_date \|\| t\.date;\n        if \(!\(dS >= fromD && dS <= toD\)\) \{ return; \}/.test(br));
ok('1c: drill + card figures from the same sum; each row says WHY it counts as sales',
  /sales_in: \{ count: salesRowsL\.length, sum: r2\(sumSalesL\), rows: salesRowsL\.slice\(0, CAPL\) \}/.test(br) &&
  /sales_in: r2\(sumSalesL\), sales_in_count: salesRowsL\.length/.test(br) &&
  /'Deposit matched to an invoice' : 'Deposit categorized customer_payment'/.test(br));

var bh = R('src/components/BooksHomeTab.jsx');
ok('2 (PP): sales card rendered inside BANK REALITY group as "of which SALES", clickable, own drill key',
  /of which SALES \(/.test(bh) && /keys: \[\{ key: 'sales_in', sign: 1 \}\]/.test(bh) &&
  /deposits matched to invoices \/ customer payments/.test(bh));

console.log('');
console.log('PM: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
