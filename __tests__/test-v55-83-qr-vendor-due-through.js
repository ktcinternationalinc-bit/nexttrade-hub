// ═══════════════════════════════════════════════════════════════════════════
// v55.83-QR — Bills due for ONE vendor up to a date (Max, Nov 8 00:41: "able
// to request amount of bills due for a specific vendor up to a certain
// period of time").
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('QR — vendor-specific bills due through a date');
var bills = R('src/app/api/accounting/bills/route.js');
var bt = R('src/components/BillsTab.jsx');
var sec = bills.split("if (action === 'due_through')")[1].split("if (action === 'bill_events')")[0];
ok('1: due_through takes an optional vendor — EXACT name match (case/space-insensitive), never fuzzy; same isPayable gate so the money math is unchanged',
  /var vendQ = String\(body\.vendor \|\| ''\)\.trim\(\)\.toLowerCase\(\)/.test(sec) &&
  /=== vendQ; \}\); \}/.test(sec) && /isPayable\(b\) && \(b\.due_date \|\| b\.bill_date\) <= thru/.test(sec));
ok('2: the answer splits ALREADY OVERDUE vs COMING DUE by the date, and each bill carries bill date, total, paid, owed',
  /overdue_now: overdueNow, not_yet_due:/.test(sec) &&
  /bill_date: b\.bill_date, due_date: b\.due_date \|\| b\.bill_date, total:/.test(sec));
ok('3: UI — vendor dropdown (all active vendors, or all) beside the date; results show the bill-by-bill table with overdue flags; CSV named for the vendor',
  /<option value="">— all vendors —<\/option>/.test(bt) &&
  /api\(\{ action: 'due_through', through: thruDate, vendor: thruVendor \|\| undefined \}\)/.test(bt) &&
  /' ⚠ overdue'/.test(bt) && /'bills-due' \+ \(dueThru\.vendor \?/.test(bt));
console.log('');
console.log('QR: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
