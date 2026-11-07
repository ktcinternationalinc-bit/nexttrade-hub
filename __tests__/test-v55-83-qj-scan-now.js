// ═══════════════════════════════════════════════════════════════════════════
// v55.83-QJ — 📧 Scan mailbox now (Max, Nov 7 12:42–12:47: setting the bills
// mailbox up on Hostinger needs an instant test, not an hour's wait).
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('QJ — scan mailbox now');
var bt = R('src/components/BillsTab.jsx');
ok('1: 📧 Scan mailbox now button in Bills (manage-only) → POSTs the scanner as the signed-in user (server re-checks bills.manage)',
  /📧 Scan mailbox now/.test(bt) && /fetch\('\/api\/accounting\/bills\/email-scan'/.test(bt) &&
  /canManage && <button onClick=\{scanMailbox\}/.test(bt));
ok('2: the result is SHOWN line by line — mailbox, keywords, matched/new/created counts, each bill (with ⚠ duplicate note), each skip with its reason',
  /matching email\(s\) in the last ' \+ \(j\.days \|\| scanDays\) \+ ' days/.test(bt) && /PENDING VALIDATION/.test(bt) && // (QK made the window selectable)
  /⚠ possible duplicate — check the note/.test(bt) && /'⏭ ' \+ s0\.file \+ ' — ' \+ s0\.reason/.test(bt));
ok('3: a not-configured server answers with the NAMED env vars, never a mystery error (route behavior)',
  /set BILLS_IMAP_EMAIL and BILLS_IMAP_APP_PASSWORD/.test(R('src/app/api/accounting/bills/email-scan/route.js')));
console.log('');
console.log('QJ: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
