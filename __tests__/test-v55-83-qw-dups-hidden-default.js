// ═══════════════════════════════════════════════════════════════════════════
// v55.83-QW — Duplicates hidden by default in Bank Review (Max, Nov 8 11:33
// screenshot: "All statuses" showed two DUPLICATE copies of the M&T
// ITL COLL TRANS line: "duplicates should not be displayed by default").
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('QW — duplicates hidden under All statuses');
var br = R('src/components/BankReviewTab.jsx');
var sec = br.split("} else if (fStatus === 'all') {")[1].split('} else {')[0];
ok('1: "All statuses" excludes rows MARKED duplicate (not just the session-hidden ones)',
  /\(t\.review_status \|\| 'unreviewed'\) !== 'duplicate' && !duplicateReview\.hidden\[t\.id\]/.test(sec));
ok('2: the Duplicate filter still shows them on purpose (audit view intact)',
  /if \(fStatus === 'duplicate'\) \{\n\s+list = list\.filter\(function \(t\) \{ return \(t\.review_status \|\| 'unreviewed'\) === 'duplicate'/.test(br));
console.log('');
console.log('QW: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
