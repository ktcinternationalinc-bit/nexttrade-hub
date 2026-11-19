// v55.83-UQ (Max, Nov 18: "the duplicates should be avoided from the begining by not accepting them if they are they exact same bill")
// — the REAL rule (bill-dup-scan exactSameBill) and the REAL import step (bill-extract-server insertImportedBill / findExactSameBill) on a
// FakeDb: the same NexPac #14481 imported again is NOT inserted, with a plain reason; anything not exactly the same still goes in.
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var FakeDb = require('./fake-supabase.js').FakeDb;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra))); }
console.log('UQ — the exact same bill is never accepted twice');
function stub(rel, exportsObj) { var p = require.resolve(path.join(root, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj }; }
stub('src/lib/bill-lines-server.js', { saveBillLines: function () { return Promise.resolve({ saved: 0 }); }, runPriceCheck: function () { return Promise.resolve(null); } });
var D = require(path.join(root, 'src/lib/bill-dup-scan.js'));
var X = require(path.join(root, 'src/lib/bill-extract-server.js'));
var onFile = { id: 'b1', vendor_name: 'NexPac Corporation', bill_number: '14481', bill_date: '2026-06-02', total_amount: 2831, record_status: 'active' };
// ── the rule
check('rule: same vendor, number, date and total → the exact same bill', D.exactSameBill({ vendor_name: 'NexPac Corporation', bill_number: '14481', bill_date: '2026-06-02', total_amount: 2831 }, [onFile]) === onFile);
check('rule: "NEXPAC CORP." / "INV-14481" / 2831.00 still count as the same (spelling, dashes, Inc / Corp)', D.exactSameBill({ vendor_name: 'NEXPAC CORP.', bill_number: 'inv 14481', bill_date: '2026-06-02T00:00:00', total_amount: '2831.00' }, [Object.assign({}, onFile, { bill_number: 'INV-14481' })]) !== null);
check('rule: a different total, date, number or vendor → NOT the exact same bill (the normal duplicate warning still applies)',
  D.exactSameBill(Object.assign({}, onFile, { id: null, total_amount: 2831.01 }), [onFile]) === null && D.exactSameBill(Object.assign({}, onFile, { id: null, bill_date: '2026-06-03' }), [onFile]) === null &&
  D.exactSameBill(Object.assign({}, onFile, { id: null, bill_number: '14482' }), [onFile]) === null && D.exactSameBill(Object.assign({}, onFile, { id: null, vendor_name: 'Ontrek' }), [onFile]) === null);
check('rule: a voided / deleted copy does not count; the bill itself (an edit) does not count', D.exactSameBill(Object.assign({}, onFile, { id: null }), [Object.assign({}, onFile, { record_status: 'void' })]) === null && D.exactSameBill(onFile, [onFile]) === null);
check('rule: no bill number → never called "exact" (cannot be sure)', D.exactSameBill(Object.assign({}, onFile, { id: null, bill_number: '' }), [Object.assign({}, onFile, { bill_number: '' })]) === null);
(async function () {
  // ── the import step on a database
  var db = new FakeDb({}); db.t.vendor_bills = [Object.assign({}, onFile)];
  db.t.bill_commission_rules = [];
  var r1 = await X.insertImportedBill(db, { vendor_name: 'NexPac Corporation', bill_number: '14481', bill_date: '2026-06-02', total_amount: 2831, notes: 'Imported from file Invoice_14481_from_NexPac.pdf' }, { vendor_name: 'NexPac Corporation' });
  check('import of the same NexPac #14481 again → NOT inserted, reason says it is already in the Hub', !!r1.error && r1.error.code === 'HUB_EXACT_DUPLICATE' && /already in the Hub — NexPac Corporation #14481 dated 2026-06-02 for \$2831\.00\. It was NOT added again/.test(r1.error.message) && r1.duplicate_of === 'b1' && db.t.vendor_bills.length === 1, r1);
  var r2 = await X.insertImportedBill(db, { vendor_name: 'NexPac Corporation', bill_number: '14482', bill_date: '2026-06-02', total_amount: 2831 }, { vendor_name: 'NexPac Corporation' });
  check('a different bill number from the same vendor → inserted normally', !r2.error && r2.data && db.t.vendor_bills.length === 2, r2);
  db.fail = { vendor_bills: { select: 'boom' } };
  var r3 = await X.insertImportedBill(db, { vendor_name: 'X', bill_number: '1', bill_date: '2026-06-02', total_amount: 5 }, {});
  check('if the check itself cannot run, that bill is skipped with the reason (nothing added, the rest of a scan carries on)', !!r3.error && r3.error.code === 'HUB_DUP_CHECK_FAILED' && /Could not check for the same bill/.test(r3.error.message) && db.t.vendor_bills.length === 2, r3);
  // ── Codex 23:01
  check('literal pair: "INV-14481" and "14481" are NOT the same number (letters are kept; unrelated bills are never merged)', D.exactSameBill({ vendor_name: 'NexPac Corporation', bill_number: 'INV-14481', bill_date: '2026-06-02', total_amount: 2831 }, [onFile]) === null);
  var big = new FakeDb({}); big.t.vendor_bills = []; big.t.bill_commission_rules = [];
  for (var bi = 0; bi < 2300; bi++) { big.t.vendor_bills.push({ id: 'x' + String(bi).padStart(5, '0'), vendor_name: 'Vendor ' + bi, bill_number: 'N' + bi, bill_date: '2026-06-02', total_amount: 2831, record_status: bi % 2 ? 'void' : 'active' }); }
  big.t.vendor_bills.push(Object.assign({}, onFile, { id: 'zzzzz' }));
  var rb = await X.findExactSameBill(big, { vendor_name: 'NexPac Corp', bill_number: '14481', bill_date: '2026-06-02', total_amount: 2831 });
  check('2,300 other bills (half voided) with the same date and total do not hide the copy — every page is read (no 200 cutoff)', !!rb && rb.id === 'zzzzz', rb);
  var raceDb = new FakeDb({}); raceDb.t.vendor_bills = []; raceDb.t.bill_commission_rules = []; raceDb.fail = { vendor_bills: { insert: 'HUB_EXACT_DUPLICATE: This exact bill is already in the Hub — Race Vendor #R-1 dated 2026-10-01 for $99.50. It was NOT added again.' } };
  var rr = await X.insertImportedBill(raceDb, { vendor_name: 'Race Vendor', bill_number: 'R-1', bill_date: '2026-10-01', total_amount: 99.5 }, {});
  check('the database refusing a same-moment copy (the race) comes back as the plain duplicate message, no retries', !!rr.error && rr.error.code === 'HUB_EXACT_DUPLICATE' && /^This exact bill is already in the Hub — Race Vendor #R-1/.test(rr.error.message), rr);
  var routeSrc = fs.readFileSync(path.join(root, 'src/app/api/accounting/bills/route.js'), 'utf8');
  check('typed by hand: the database refusal is a plain 409 (not a server error)', routeSrc.indexOf('HUB_EXACT_DUPLICATE/.test(String((e && e.message)') > 0 && routeSrc.indexOf("duplicate_level: 'exact' }, { status: 409 }") > 0);
  // ── wiring
  var route = fs.readFileSync(path.join(root, 'src/app/api/accounting/bills/route.js'), 'utf8');
  var iExact = route.indexOf('var exactS = await findExactSameBill('); var iConfirm = route.indexOf("if (!bl.id && dupSave.level === 'strong' && body.confirm_duplicate !== true)");
  check('typed by hand: the exact same bill is refused BEFORE (and regardless of) "save anyway"', iExact > 0 && iExact < iConfirm && /duplicate_level: 'exact'/.test(route));
  check('all three import doors (file, e-mail inbound, e-mail scanner) go through insertImportedBill and report .error as skipped', ['src/app/api/accounting/bills/email-scan/route.js', 'src/app/api/accounting/bills/inbound/route.js'].every(function (f) { var s = fs.readFileSync(path.join(root, f), 'utf8'); return /insertImportedBill\(db,/.test(s) && /if \(ins\.error\) \{ skipped\.push/.test(s); }) && /if \(gIns\.error\) \{ return NextResponse\.json\(\{ ok: true, skipped: true/.test(route));
  console.log('\nUQ exact duplicate bills: ' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
