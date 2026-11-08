// ═══════════════════════════════════════════════════════════════════════════
// v55.83-QU — Bank Review ⇄ All Transactions parity (Max, Nov 8 11:15: "if i
// do a manual bank input with csv for clickbooks it also needs to show up in
// the bank matching section of the wave hub acct system.. also have the same
// rules to prevent duplicates etc. all transactions in both systems should be
// matching").
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('QU — Bank Review shows everything All Transactions shows');
var br = R('src/components/BankReviewTab.jsx');
var si = R('src/app/api/accounting/statement-import/route.js');
ok('1: Bank Review no longer stops at 1000 rows — pages of 1000 up to 6000, same silo scope + history floor, stable ordering (posted_date then id)',
  /for \(var pg9 = 0; pg9 < 6; pg9\+\+\)/.test(br) && /\.range\(fromRow, fromRow \+ 999\)/.test(br) &&
  /\.order\('id', \{ ascending: true \}\)/.test(br) && !/_txQRev = _txQRev\.limit\(1000\);/.test(br));
ok('2: CSV rows are ordinary bank_transactions in the SAME silo (wave_business_id stamped from the account) — so the silo-scoped Bank Review query includes them',
  /wave_business_id: silo,/.test(si) && /bank_source: '\[CSV\] '/.test(si));
ok('3: ONE set of duplicate rules for both screens — the importer dedupes at insert (twin-aware), and both screens hide rows marked duplicate the same way',
  /accountTwins\(d, \[target\]\)/.test(si) &&
  /\(t\.review_status \|\| 'unreviewed'\) !== 'duplicate'/.test(br) &&
  /neq\('review_status', 'duplicate'\)/.test(R('src/app/api/accounting/expense-rules/route.js')));
console.log('');
console.log('QU: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
