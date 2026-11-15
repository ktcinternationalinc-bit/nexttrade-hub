/* v72 HOTFIX 28 — Type-checked, atomic offset processing.
 *
 * Diagnoses the El Sayad EGP hallucination ("+76,346 they owe us" vs running
 * balance "-998,354.50 we owe them") caused by 4 corrupt offset rows that
 * paired vendor_bill ↔ vendor_bill. The old offset handler processed each
 * row independently; when offset_invoice_id pointed at a vendor_bill, that
 * side silently failed, but the OTHER row in the pair successfully reduced
 * a real bill — phantom-paying it.
 *
 * Fix has three layers:
 *   1. simulate() builds a typeById lookup from ALL entries, then validates
 *      every offset row's offset_invoice_id and offset_bill_id against the
 *      type contract before applying anything. Both halves of a corrupt
 *      pair get rejected because both halves carry both IDs.
 *   2. buildOffsetEntries() throws if candidate.invoice isn't sales_invoice
 *      or candidate.bill isn't vendor_bill (write-time defense).
 *   3. Per-row "already closed or wrong currency" sides skip without
 *      polluting the other side.
 *
 * The regression test loads Max's actual El Sayad CSV (35 entries, 18 offsets,
 * 4 corrupt) and asserts the post-fix state matches the simulator preview that
 * Max + Gemini + ChatGPT all signed off on.
 */
var path = require('path');
var fs = require('fs');

function ok(name, cond) {
  if (!cond) { console.log('  ✗ ' + name); process.exitCode = 1; }
  else { console.log('  ✓ ' + name); }
}

var ledger = fs.readFileSync(path.join(__dirname, '..', 'src/lib/open-account-ledger.js'), 'utf8');

console.log('\n── HOTFIX 28 code structure ──');

ok('A1: simulate builds typeById lookup from ALL entries (not just open)',
  /var typeById = \{\};[\s\S]{0,300}entries \|\| \[\]\)\.forEach[\s\S]{0,200}typeById\[e\.id\] = e\.transaction_type/.test(ledger));

ok('A2: offset handler validates offset_invoice_id against transaction_type === sales_invoice',
  /invType[\s\S]{0,200}invType !== 'sales_invoice'/.test(ledger));

ok('A3: offset handler validates offset_bill_id against transaction_type === vendor_bill',
  /billType[\s\S]{0,200}billType !== 'vendor_bill'/.test(ledger));

ok('A4: TYPE GUARD runs BEFORE the side-application logic (atomic)',
  (function () {
    var block = ledger.match(/else if \(type === 'offset'\)[\s\S]*?else \{[\s\S]*?Unknown transaction_type/);
    if (!block) return false;
    var typeGuardIdx = block[0].indexOf('TYPE GUARD');
    var resolveIdx = block[0].indexOf('Resolve OPEN-pool memberships');
    return typeGuardIdx > 0 && resolveIdx > typeGuardIdx;
  })());

ok('A5: REJECTED warning emitted with type-error context',
  /REJECTED malformed offset row/.test(ledger) &&
  /offset_invoice_type:/.test(ledger) &&
  /offset_bill_type:/.test(ledger));

ok('A6: buildOffsetEntries throws if candidate.invoice is not sales_invoice',
  /candidate\.invoice\.transaction_type !== 'sales_invoice'[\s\S]{0,200}throw new Error/.test(ledger));

ok('A7: buildOffsetEntries throws if candidate.bill is not vendor_bill',
  /candidate\.bill\.transaction_type !== 'vendor_bill'[\s\S]{0,200}throw new Error/.test(ledger));

ok('A8: buildOffsetEntries refuses cross-currency offset',
  /invCur !== billCur[\s\S]{0,200}throw new Error/.test(ledger));

ok('A9: buildOffsetEntries refuses self-offset',
  /candidate\.invoice\.id === candidate\.bill\.id[\s\S]{0,200}throw new Error/.test(ledger));

console.log('\n── HOTFIX 28 behavioral test (real El Sayad data) ──');

var spawn = require('child_process').spawnSync;
var ledgerPath = path.join(__dirname, '..', 'src/lib/open-account-ledger.js');

// The exact 35-row El Sayad CSV, inlined so the test is hermetic.
var csvData = `id,account_id,entry_date,transaction_type,currency,debit_amount,credit_amount,offset_invoice_id,offset_bill_id,created_at
4fcafaf9,acc,2025-03-14,payment_sent,EGP,300000,0,,,2026-05-28T16:05:09Z
963bae32,acc,2025-06-26,payment_sent,USD,5000,0,,,2026-05-28T16:06:17Z
532eaabc,acc,2025-08-27,sales_invoice,EGP,0,1119502,,,2026-05-28T15:55:54Z
375261d9,acc,2025-10-02,sales_invoice,EGP,0,395797.50,,,2026-05-28T16:02:04Z
fe8a769d,acc,2025-10-23,vendor_bill,EGP,560000,0,,,2026-05-28T17:07:53Z
7349bf47,acc,2025-11-23,vendor_bill,EGP,560000,0,,,2026-05-28T17:09:01Z
160646df,acc,2025-11-27,vendor_bill,USD,151570,0,,,2026-05-28T16:40:58Z
6ad843c9,acc,2025-11-27,credit_adjustment,USD,10609.90,0,,,2026-05-28T16:53:44Z
13b83ffe,acc,2025-12-01,vendor_bill,EGP,560000,0,,,2026-05-28T17:09:57Z
3caac4eb,acc,2025-12-16,payment_sent,USD,29240,0,,,2026-05-28T16:08:54Z
bb853123,acc,2025-12-30,payment_sent,USD,80000,0,,,2026-05-28T16:09:51Z
78a7d630,acc,2026-02-17,payment_sent,USD,20000,0,,,2026-05-28T16:10:26Z
94fe952a,acc,2026-02-27,vendor_bill,EGP,560000,0,,,2026-05-28T17:10:35Z
d392245e,acc,2026-04-28,vendor_bill,EGP,650000,0,,,2026-05-28T20:12:06Z
f544a251,acc,2026-05-10,sales_invoice,USD,0,30600,,,2026-05-28T20:33:14Z
f56293d6,acc,2026-05-10,sales_invoice,EGP,0,726346,,,2026-05-28T20:36:36Z
a42d734d,acc,2026-05-13,vendor_bill,EGP,650000,0,,,2026-05-28T17:11:19Z
73373794,acc,2026-05-28,offset,EGP,260000,0,532eaabc,fe8a769d,2026-05-28T17:07:53.7Z
bfa246d1,acc,2026-05-28,offset,EGP,0,260000,532eaabc,fe8a769d,2026-05-28T17:07:54Z
d5088e1c,acc,2026-05-28,offset,EGP,560000,0,532eaabc,7349bf47,2026-05-28T17:09:02Z
4e19f1d2,acc,2026-05-28,offset,EGP,0,560000,532eaabc,7349bf47,2026-05-28T17:09:03Z
11397387,acc,2026-05-28,offset,EGP,299502,0,532eaabc,94fe952a,2026-05-28T17:20:31.5Z
046707f2,acc,2026-05-28,offset,EGP,0,299502,532eaabc,94fe952a,2026-05-28T17:20:31.9Z
cac26c45,acc,2026-05-28,offset,EGP,260498,0,375261d9,94fe952a,2026-05-28T17:20:32.6Z
b148ea3f,acc,2026-05-28,offset,EGP,0,260498,375261d9,94fe952a,2026-05-28T17:20:33Z
88247330,acc,2026-05-28,offset,EGP,135299.50,0,375261d9,a42d734d,2026-05-28T17:20:55.9Z
bc13c224,acc,2026-05-28,offset,EGP,0,135299.50,375261d9,a42d734d,2026-05-28T17:20:56.2Z
62878a56,acc,2026-05-28,offset,EGP,514700.50,0,13b83ffe,a42d734d,2026-05-28T17:20:56.7Z
65865722,acc,2026-05-28,offset,EGP,0,514700.50,13b83ffe,a42d734d,2026-05-28T17:20:57Z
3218fe57,acc,2026-05-28,offset,EGP,560000,0,d392245e,13b83ffe,2026-05-28T20:12:06.8Z
f08db69d,acc,2026-05-28,offset,EGP,0,560000,d392245e,13b83ffe,2026-05-28T20:12:07.3Z
80e63548,acc,2026-05-28,offset,USD,17330,0,f544a251,160646df,2026-05-28T20:33:14.8Z
f12f2021,acc,2026-05-28,offset,USD,0,17330,f544a251,160646df,2026-05-28T20:33:15.3Z
fd40e1b4,acc,2026-05-28,offset,EGP,650000,0,f56293d6,d392245e,2026-05-28T20:36:37.8Z
c2f23028,acc,2026-05-28,offset,EGP,0,650000,f56293d6,d392245e,2026-05-28T20:36:38.2Z`;

var script = `
import { simulate, buildOffsetEntries } from '${ledgerPath}';
const csv = ${JSON.stringify(csvData)};
const lines = csv.trim().split('\\n');
const headers = lines[0].split(',');
const rows = lines.slice(1).map(line => {
  const fields = line.split(',');
  const obj = {};
  headers.forEach((h, i) => obj[h] = fields[i] === '' ? null : fields[i]);
  obj.debit_amount = Number(obj.debit_amount || 0);
  obj.credit_amount = Number(obj.credit_amount || 0);
  return obj;
});

const r = simulate(rows);
const egp = r.byCurrency.EGP;
const usd = r.byCurrency.USD;

console.log('egpNet:' + egp.netBalance.toFixed(2));
console.log('egpOpenInvoicesTotal:' + egp.theirOpenInvoices.toFixed(2));
console.log('egpOpenBillsTotal:' + egp.ourOpenBills.toFixed(2));
console.log('egpOpenBillsCount:' + egp.openBills.length);
console.log('egpRejectedWarnings:' + r.warnings.filter(w => /REJECTED/.test(w.msg)).length);
console.log('usdNet:' + usd.netBalance.toFixed(2));
console.log('usdOurPrepaid:' + usd.ourPrepaid.toFixed(2));
console.log('usdOpenInvoiceRemaining:' + (usd.openInvoices[0] ? usd.openInvoices[0].remaining.toFixed(2) : 'NONE'));

// Check that INV-006 (560k) and INV-008 (514,700.50) are still in the open pool
const inv006Open = egp.openBills.find(b => b.id === '13b83ffe');
const inv008Open = egp.openBills.find(b => b.id === 'a42d734d');
const customsOpen = egp.openInvoices.find(i => i.id === 'f56293d6');
console.log('inv006Remaining:' + (inv006Open ? inv006Open.remaining.toFixed(2) : 'NOT_OPEN'));
console.log('inv008Remaining:' + (inv008Open ? inv008Open.remaining.toFixed(2) : 'NOT_OPEN'));
console.log('customsRemaining:' + (customsOpen ? customsOpen.remaining.toFixed(2) : 'NOT_OPEN'));

// Test buildOffsetEntries refuses bad input
let throwsOnBadInvoice = false;
try {
  buildOffsetEntries({ invoice: { id: 'x', transaction_type: 'vendor_bill', currency: 'EGP' }, bill: { id: 'y', transaction_type: 'vendor_bill', currency: 'EGP' }, offsetAmount: 100, currency: 'EGP' }, '2026-05-28', 'u');
} catch (e) { throwsOnBadInvoice = /sales_invoice/.test(e.message); }
console.log('throwsOnBadInvoice:' + throwsOnBadInvoice);

let throwsOnCrossCur = false;
try {
  buildOffsetEntries({ invoice: { id: 'x', transaction_type: 'sales_invoice', currency: 'EGP' }, bill: { id: 'y', transaction_type: 'vendor_bill', currency: 'USD' }, offsetAmount: 100, currency: 'EGP' }, '2026-05-28', 'u');
} catch (e) { throwsOnCrossCur = /currency/.test(e.message); }
console.log('throwsOnCrossCur:' + throwsOnCrossCur);
`;

fs.writeFileSync('/tmp/hotfix28_check.mjs', script);
var out = spawn('node', ['--experimental-modules', '/tmp/hotfix28_check.mjs'], { encoding: 'utf8' });
var stdout = out.stdout || '';

function parseNum(re) {
  var m = stdout.match(re);
  return m ? parseFloat(m[1]) : NaN;
}
function parseInt2(re) {
  var m = stdout.match(re);
  return m ? parseInt(m[1], 10) : NaN;
}
function parseBool(re) {
  var m = stdout.match(re);
  return m && m[1] === 'true';
}

var egpNet = parseNum(/egpNet:(-?[\d.]+)/);
var egpOpenBillsTotal = parseNum(/egpOpenBillsTotal:([\d.]+)/);
var egpOpenInvoicesTotal = parseNum(/egpOpenInvoicesTotal:([\d.]+)/);
var egpOpenBillsCount = parseInt2(/egpOpenBillsCount:(\d+)/);
var egpRejectedWarnings = parseInt2(/egpRejectedWarnings:(\d+)/);
var usdNet = parseNum(/usdNet:(-?[\d.]+)/);
var usdOurPrepaid = parseNum(/usdOurPrepaid:([\d.]+)/);
var usdOpenInvoiceRemaining = parseNum(/usdOpenInvoiceRemaining:([\d.]+)/);
var inv006Remaining = parseNum(/inv006Remaining:([\d.]+)/);
var inv008Remaining = parseNum(/inv008Remaining:([\d.]+)/);
var customsRemaining = parseNum(/customsRemaining:([\d.]+)/);
var throwsOnBadInvoice = parseBool(/throwsOnBadInvoice:(true|false)/);
var throwsOnCrossCur = parseBool(/throwsOnCrossCur:(true|false)/);

ok('B1: EGP net = -998,354.50 (matches Max + Gemini + ChatGPT expected state)',
  Math.abs(egpNet - (-998354.50)) < 0.01);

ok('B2: EGP open bills total = 1,074,700.50 (INV-006 + INV-008 reopened)',
  Math.abs(egpOpenBillsTotal - 1074700.50) < 0.01);

ok('B3: EGP open invoice total = 76,346 (Customs invoice partially open)',
  Math.abs(egpOpenInvoicesTotal - 76346) < 0.01);

ok('B4: EGP has exactly 2 open bills (INV-006 fully open + INV-008 partial)',
  egpOpenBillsCount === 2);

ok('B5: 4 corrupt offset rows REJECTED at simulation time',
  egpRejectedWarnings === 4);

ok('B6: INV-006 reopens at full 560,000 (was phantom-paid)',
  Math.abs(inv006Remaining - 560000) < 0.01);

ok('B7: INV-008 reopens at 514,700.50 (135,299.50 legitimately offset against INV-002)',
  Math.abs(inv008Remaining - 514700.50) < 0.01);

ok('B8: Customs invoice still partial at 76,346 (650k legitimately offset against INV-009)',
  Math.abs(customsRemaining - 76346) < 0.01);

// HOTFIX 32 (May 28 evening) — credit_adjustment now drains the open pool.
// Raw sim against the CSV (without the post-32 surgical SQL fix to the 2 USD
// offset rows) leaves USD net at $13,270, because the offset row's $17,330
// applies to INV-010 (full) but only $6,720.10 of the matching bill side
// can absorb against INV-003 (the rest was drained by credit_adjustment).
// The full $23,879.90 net target is restored AFTER the surgical SQL runs
// (UPDATE the 2 USD offset rows from $17,330 → $6,720.10). See HOTFIX 32 test
// for assertions on the post-SQL result.
ok('B9: USD net = +13,270 BEFORE post-32 surgical SQL (was 23,879.90 before HOTFIX 32 added the drain)',
  Math.abs(usdNet - 13270.00) < 0.01);

ok('B10: USD our prepaid = 0 after HOTFIX 32 drains Algeria credit into INV-003',
  Math.abs(usdOurPrepaid - 0) < 0.01);

ok('B11: USD INV-010 remaining = 13,270 (after 17,330 legitimately offset against INV-003)',
  Math.abs(usdOpenInvoiceRemaining - 13270) < 0.01);

ok('B12: buildOffsetEntries throws if invoice slot has wrong type',
  throwsOnBadInvoice === true);

ok('B13: buildOffsetEntries throws on cross-currency attempt',
  throwsOnCrossCur === true);

console.log('\n══════════════════════════════════════════════');
if (process.exitCode) console.log('FAILED');
else console.log('✅ HOTFIX 28 — atomic + type-checked offsets; El Sayad regression locked in');
console.log('══════════════════════════════════════════════');
