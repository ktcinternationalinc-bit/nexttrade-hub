// ═══════════════════════════════════════════════════════════════════════════
// v55.83-PC — Bill import (photo/PDF → pre-filled bill, human confirms)
// Max (Nov 5): "i should be able to import a bill and it will be read and
// entered as a bill with all of the correct vendors dates amounts etc"
// The model PROPOSES, parseBillExtraction DISCIPLINES, the human CONFIRMS.
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('PC — bill import');

// ── 1. FUNCTIONAL: the real parser (eval the actual module)
var src = R('src/lib/bill-extract.js');
var names = [];
var cjs = src
  .replace(/export var ([a-zA-Z0-9_]+)/g, function (m, n) { names.push(n); return 'var ' + n; })
  .replace(/export function ([a-zA-Z0-9_]+)/g, function (m, n) { names.push(n); return 'function ' + n; });
cjs += '\n;module.exports = {' + names.map(function (n) { return n + ': ' + n; }).join(',') + '};';
/* eslint-disable no-new-func */
var mod = { exports: {} };
new Function('module', 'exports', cjs)(mod, mod.exports);
var parse = mod.exports.parseBillExtraction;

var good = parse('```json\n{"vendor_name":" ACME Freight LLC ","bill_number":"INV-882","bill_date":"2026-11-02","due_date":"2026-12-02","total_amount":"1,234.56","currency":"USD","category":"Freight","notes":"ocean freight"}\n```');
ok('1a: clean extraction parses, amounts like "1,234.56" become 1234.56, vendor trimmed',
  good.draft && good.draft.vendor_name === 'ACME Freight LLC' && good.draft.total_amount === 1234.56 &&
  good.draft.bill_date === '2026-11-02' && good.problems.length === 0);
var badDate = parse('{"vendor_name":"X Co","bill_number":null,"bill_date":"2026-13-45","due_date":"soon","total_amount":50,"currency":"USD","category":null,"notes":null}');
ok('1b: impossible/vague dates become NULL and are flagged — never guessed',
  badDate.draft && badDate.draft.bill_date === null && badDate.draft.due_date === null &&
  badDate.problems.some(function (p) { return /bill date/i.test(p); }));
var neg = parse('{"vendor_name":"X","total_amount":-20,"bill_date":"2026-11-01"}');
ok('1c: zero/negative amounts rejected to null and flagged', neg.draft.total_amount === null && neg.problems.some(function (p) { return /amount/i.test(p); }));
var junk = parse('I could not read this document, sorry!');
ok('1d: non-JSON model output fails SAFELY with a manual-entry message', junk.draft === null && junk.problems.length === 1);
var egp = parse('{"vendor_name":"Cairo Supplies","total_amount":900,"bill_date":"2026-11-01","currency":"EGP"}');
ok('1e: non-USD bill is flagged for the human (US book is USD)', egp.problems.some(function (p) { return /EGP/.test(p); }));
ok('1f: the prompt FORBIDS guessing dates and demands the supplier not the recipient',
  /NEVER guess/.test(mod.exports.BILL_EXTRACT_PROMPT) && /never the recipient/.test(mod.exports.BILL_EXTRACT_PROMPT));

// ── 2. Route wiring
var br = R('src/app/api/accounting/bills/route.js');
ok('2a: extract_bill requires bills.manage (it is in WRITE_ACTIONS)', /extract_bill: 1/.test(br));
// (PF moved the reading engine into src/lib/bill-extract-server.js so the
// email-inbound endpoint shares it — pins follow the code.)
var bes = R('src/lib/bill-extract-server.js');
ok('2b (PF): PDF as document block, images as image blocks, via the hub\'s Anthropic pattern (shared server lib)',
  /type: 'document', source: \{ type: 'base64', media_type: 'application\/pdf'/.test(bes) &&
  /type: 'image', source: \{ type: 'base64', media_type: mediaType/.test(bes) && /api\.anthropic\.com\/v1\/messages/.test(bes));
ok('2c (PF): extraction returns a DRAFT — the extract action never inserts a bill',
  /draft: rd\.draft, problems: rd\.problems/.test(br) && !/extract_bill[\s\S]{0,400}vendor_bills'\)\.insert/.test(br));
ok('2d: attachment_path travels on save with graceful retry when the PC column is missing',
  /fields\.attachment_path = String\(bl\.attachment_path\)/.test(br) && /run sql\/v55-83-PC-bill-attachments\.sql/.test(br));

// ── 3. UI wiring
var bt = R('src/components/BillsTab.jsx');
ok('3a: 📷 Import bill button + file input accepting photos and PDFs',
  /📷 Import bill/.test(bt) && /accept="image\/jpeg,image\/png,image\/webp,image\/gif,application\/pdf"/.test(bt));
ok('3b: the imported draft lands in the SAME form with a CHECK-before-saving banner',
  /_imported: true/.test(bt) && /CHECK every field before saving/.test(bt));
// (PE superseded the original 3c: QA flagged the public bucket as a critical —
// bill documents now live in the PRIVATE bills-private bucket, opened via
// 1-hour signed URLs; legacy public paths still resolve.)
ok('3c (PE): file stored PRIVATELY (bills-private bucket, pv/ prefix) and linked with 📎 via signed URL',
  /storage\.from\('bills-private'\)\.upload/.test(bt) && /'pv\/' \+ Date\.now\(\)/.test(bt) && /createSignedUrl/.test(bt));
ok('3d: upload failure never blocks saving the bill (path only added when upload succeeded)',
  /catch\(function \(\) \{ return null; \}\)/.test(bt) && /if \(att\) \{ d\.attachment_path = att; \}/.test(bt));

// ── 4. SQL exists and is additive-only
var sql = R('sql/v55-83-PC-bill-attachments.sql');
ok('4: PC SQL adds only attachment_path (IF NOT EXISTS) with verification',
  /ADD COLUMN IF NOT EXISTS attachment_path text/.test(sql) && /check_name/.test(sql) && !/DROP|DELETE|UPDATE /i.test(sql));

console.log('');
console.log('PC: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
