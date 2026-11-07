// ═══════════════════════════════════════════════════════════════════════════
// v55.83-QL — 🩺 Email scanner diagnostics (Max, Nov 7 13:19: "we need to
// figure out how to examine investigate if it is actually working and why
// it is not"). Every layer checked separately, every failure NAMED.
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('QL — email diagnostics');
var es = R('src/app/api/accounting/bills/email-scan/route.js');
var bt = R('src/components/BillsTab.jsx');
ok('1: diagnose mode checks the layers IN ORDER — env present (password length only, value never shown), host named, sign-in attempted, INBOX opened, keywords listed with per-keyword match counts',
  /body\.diagnose === true/.test(es) && /value never shown/.test(es) &&
  /Signed into the mailbox — credentials and host are CORRECT/.test(es) &&
  /INBOX opened read-only — it holds/.test(es) &&
  /matches per keyword/.test(es));
ok('2: failures are NAMED with the fix — missing env says REDEPLOY, bad sign-in points at the Hostinger mailbox password, no-hits lists the real reasons (wrong mailbox, wording, Spam, window)',
  /set it, then REDEPLOY — env only loads at deploy/.test(es) &&
  /use the MAILBOX password from Hostinger hPanel/.test(es) &&
  /sit in Spam \(only INBOX is scanned\)/.test(es));
ok('3: shows the scanner\'s actual VIEW — up to 5 matching emails with date, sender, subject, readable attachments (or the a-link-is-not-an-attachment warning) and already-processed status, then a plain verdict',
  /NO readable attachment \(only PDF\/JPG\/PNG count/.test(es) &&
  /already processed ✓/.test(es) &&
  /8\. Verdict: the scanner CAN reach and search this mailbox\./.test(es));
ok('4: 🩺 Test connection button in Bills (manage-only), uses the selected lookback, renders the steps line by line',
  /🩺 Test connection/.test(bt) && /diagnose: true, days: Number\(scanDays\)/.test(bt) &&
  /setImportNotes\(j\.steps \|\| \[\]\)/.test(bt));
console.log('');
console.log('QL: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
