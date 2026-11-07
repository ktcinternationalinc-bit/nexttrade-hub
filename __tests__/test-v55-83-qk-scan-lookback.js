// ═══════════════════════════════════════════════════════════════════════════
// v55.83-QK — Selectable mailbox lookback (Max, Nov 7 13:10: "i want to
// check the last 3 months of emails. can we select how far back").
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('QK — selectable scan lookback');
var es = R('src/app/api/accounting/bills/email-scan/route.js');
var bt = R('src/components/BillsTab.jsx');
ok('1: lookback selectable per scan (body.days), env default BILLS_EMAIL_LOOKBACK_DAYS, hard cap 120 days, default 14',
  /body\.days\) \|\| process\.env\.BILLS_EMAIL_LOOKBACK_DAYS \|\| 14/.test(es) &&
  /if \(days > 120\) \{ days = 120; \}/.test(es) &&
  /new Date\(Date\.now\(\) - days \* 86400000\)/.test(es));
ok('2: per-pass budget — 8 NEW emails per pass (an AI read per attachment, so no timeouts); the rest are COUNTED and reported, and repeat passes walk the whole backlog because processed messages are remembered',
  /var NEW_PER_PASS = 8;/.test(es) &&
  /if \(scanned >= NEW_PER_PASS\) \{ remainingNew\+\+; continue; \}/.test(es) &&
  /remaining_new: remainingNew/.test(es));
ok('3: Bills UI — lookback dropdown (2 weeks → 4 months incl. LAST 3 MONTHS) next to 📧 Scan; result names the window and says how many are left with click-again guidance',
  /<option value="90">last 3 months<\/option>/.test(bt) &&
  /days: Number\(scanDays\)/.test(bt) &&
  /more matching email\(s\) not yet read — click 📧 Scan again to continue/.test(bt));
console.log('');
console.log('QK: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
