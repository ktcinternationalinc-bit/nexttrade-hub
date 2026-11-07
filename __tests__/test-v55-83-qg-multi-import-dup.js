// ═══════════════════════════════════════════════════════════════════════════
// v55.83-QG — Multi-document bill import + duplicate / previously-paid
// detection (Max, Nov 7 12:19: "can we import multiple documents at the same
// time... check all emails with certain key words.. find the bills add it to
// the system automatically. check for duplicates or previously paid. still
// have a human validation column").
// The email machinery already existed (PF inbound endpoint); QG adds the
// multi-file UI queue and the look-alike/paid suspicion on BOTH paths.
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('QG — multi-import + duplicate/previously-paid detection');

var bills = R('src/app/api/accounting/bills/route.js');
var bt = R('src/components/BillsTab.jsx');
var ib = R('src/app/api/accounting/bills/inbound/route.js');

ok('1a: 📷 Import takes MULTIPLE files — one file keeps the check-every-field editor; several run the queue (≤20, sequential, per-file result lines)',
  /type="file" multiple accept=/.test(bt) && /if \(list\.length === 1\) \{ onPickFile\(list\[0\]\); return; \}/.test(bt) &&
  /slice\.call\(\(e\.target\.files \|\| \[\]\), 0, 20\)/.test(bt));
ok('1b: every queued document becomes a PENDING-VALIDATION bill — never auto-validated; the summary says so and reloads the list',
  /every one awaits YOUR validation/.test(bt) && /→ PENDING VALIDATION/.test(bt));
ok('2a: ingest_bill_file is a WRITE action (bills.manage) — extract never guesses, skips are REPORTED with the reason, original stored privately (pv/), vendor memory fills the category',
  /ingest_bill_file: 1/.test(bills) && /if \(action === 'ingest_bill_file'\)/.test(bills) &&
  /ok: true, skipped: true, file: gName, reason: gRead\.error/.test(bills) &&
  /'pv\/upload-' \+ Date\.now\(\)/.test(bills) && /gCat = await suggestCategory\(db, gD\.vendor_name \|\| ''\)/.test(bills) &&
  /validation_status: 'pending',\n        attachment_path: gUpErr \? null : gPath,/.test(bills));
var dupLib = R('src/lib/bill-dup-server.js');
ok('2b (QH moved the radar into ONE lib): EXACT duplicate (same vendor + bill number, active) is SKIPPED and said — never entered twice; both routes call the same verdict',
  /out\.skip = 'Duplicate of an existing active bill \(' \+ d\.vendor_name \+ ' ' \+ d\.bill_number \+ '\)\.';/.test(dupLib) &&
  /gVerdict = await billDupVerdict\(db, \{ vendor_name: gD\.vendor_name/.test(bills) &&
  /verdict2 = await billDupVerdict\(db, \{ vendor_name: d\.vendor_name/.test(ib));
ok('2c (QH): LOOK-ALIKES are CREATED with a loud ⚠ naming each suspect — and say when that one is already PAID',
  /POSSIBLE DUPLICATE — ' \+ reasons\.join/.test(dupLib) &&
  /— and that one is already PAID/.test(dupLib));
ok('3: the EMAIL path uses the SAME radar; token auth (header OR url for Mailgun/SendGrid) + pending validation unchanged',
  /searchParams\.get\('token'\)/.test(ib) &&
  /x-inbound-token/.test(ib) && /validation_status: 'pending'/.test(ib) &&
  /var warn2 = verdict2\.warn;/.test(ib));

console.log('');
console.log('QG: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
