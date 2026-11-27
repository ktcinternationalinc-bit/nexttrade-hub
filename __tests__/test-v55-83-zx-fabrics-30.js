// v55.83-ZX — Fabrics Canada has its own fixed 30% weight tolerance (Max 27 Nov: "individual discrepancy for fabrics - fabrics canada to be
// 30% hardcoded"). Bill 14743: Fabrics Canada billed 301 lb, scanned 388 lb (+28.9%) — FAIL at the approved 15%, PASS at 30%.
// The REAL compareGroup. Run: node __tests__/test-v55-83-zx-fabrics-30.js
var path = require('path'); var crypto = require('crypto');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var W = require(path.join(root, 'src/lib/weight-check.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 700))); }
function fp(inputs) { return inputs ? crypto.createHash('sha256').update(W.canonical(inputs)).digest('hex') : null; }
console.log('ZX — Fabrics Canada fixed 30% weight tolerance');
var NEX = 'NexPac Corporation';
function map(item, unit, pt, cgt, label) { return { id: 'm-' + item + unit, version: 1, state: 'active', vendor_key: W.vendorKey(NEX), item_key: item, bill_unit: unit, wh_product_type: pt, wh_cgt: cgt, wh_label: label }; }
var MAPS = [map('cambridge fabrics', 'LBS', '3', '15', 'Fabrics · Fabrics Canada'), map('cambridge paper', 'LBS', '2', '8', 'Paper · Paper Canada'), map('cambridge fabrics yd', 'YDS', '3', '15', 'Fabrics · Fabrics Canada')];
var TOL = { id: 't15', version: 3, pct: 15, lb: null };
function run(o) {
  var b = { id: 'b14743', vendor_name: NEX, bill_number: '14743', bill_date: '2026-09-15', other_reference: '80216838' };
  var links = W.currentLinks([{ bill_id: b.id, source: 'nextrade-live', receipt_id: 2201, basis: 'reference_number', bill_value: '80216838', receipt_value: '80216838', state: 'confirmed', at: '2026-11-27T00:00:00Z' }]);
  var g = W.buildGroups(links)[0];
  var logs = [];
  (o.scans || []).forEach(function (sc, i) { logs.push({ id: 900 + i, unit: sc.yd != null ? null : 'W', product_type: sc.pt, cgt: sc.cgt, nt: null, color: null, weight: sc.lb != null ? String(sc.lb) : null, yards: sc.yd != null ? String(sc.yd) : null, is_scan_out: 0, skew_number: 'S' + i }); });
  var r = { source: 'nextrade-live', id: 2201, reference_number: '80216838', is_draf: 0, state: 'present', read_complete: true, info: { uom: o.uom || 'Pounds' }, logs: logs };
  var recs = {}; recs[W.receiptKey(r)] = r;
  var lines = {}; lines[b.id] = o.lines;
  var bills = {}; bills[b.id] = b;
  return W.compareGroup({ group: g, bills: bills, linesByBill: lines, receipts: recs, maps: o.maps || MAPS, tolerance: o.tolerance === undefined ? TOL : o.tolerance, lookups: {}, hiddenBillIds: {}, feed: { ok: true } }).filter(function (i) { return i.kind === 'product'; });
}
function ln(desc, qty, unit, no) { return { id: 'L' + (no || 1), line_no: no || 1, line_kind: 'item', description: desc, item_key: null, qty: qty, unit: unit }; }
function one(o) { return run(o)[0]; }

var fab = one({ lines: [ln('Cambridge Fabrics (LBS)', 301, 'LBS')], scans: [{ pt: '3', cgt: '15', lb: 388 }] });
check('BILL 14743 Fabrics Canada: billed 301 lb, scanned 388 lb (+28.9%) → PASS (matched) at Fabrics Canada\'s own 30% — it was FAIL at 15%', fab.outcome === 'matched' && fab.figures.diff === 87, [fab.outcome, fab.figures && fab.figures.diff]);
check('…the weight check on the card carries the 30% (so it reads "within 30%")', fab.figures.checks.weight.tol && fab.figures.checks.weight.tol.pct === 30 && fab.figures.checks.weight.result === 'matched', fab.figures.checks.weight);
var f31 = one({ lines: [ln('Cambridge Fabrics (LBS)', 300, 'LBS')], scans: [{ pt: '3', cgt: '15', lb: 393 }] });
check('Fabrics Canada +31% (300 → 393) → still FAIL (discrepancy)', f31.outcome === 'discrepancy', f31.outcome);
var over = one({ lines: [ln('Cambridge Fabrics (LBS)', 400, 'LBS')], scans: [{ pt: '3', cgt: '15', lb: 390 }] });
check('Fabrics Canada billed ABOVE the scan (400 vs 390) → FAIL, "billed MORE than was scanned … never allowed" — the 30% never covers that', over.outcome === 'discrepancy' && /billed MORE than was scanned/.test((over.reasons || []).join(' ')), [over.outcome, over.reasons]);
var pap = one({ lines: [ln('Cambridge Paper (LBS)', 1000, 'LBS')], scans: [{ pt: '2', cgt: '8', lb: 1200 }] });
check('every other product keeps the approved 15%: Paper Canada +20% → FAIL', pap.outcome === 'discrepancy' && pap.figures.checks.weight.tol.pct === 15, [pap.outcome, pap.figures.checks.weight.tol]);
var yd = one({ lines: [ln('Cambridge Fabrics yd (YDS)', 100, 'YDS')], scans: [{ pt: '3', cgt: '15', yd: 110 }], uom: 'Yards' });
check('YARDS stay an exact match even for Fabrics Canada (100 yd vs 110 yd → FAIL)', yd.outcome === 'discrepancy', yd.outcome);
var noTol = one({ lines: [ln('Cambridge Fabrics (LBS)', 301, 'LBS')], scans: [{ pt: '3', cgt: '15', lb: 388 }], tolerance: null });
check('with NO general tolerance approved, Fabrics Canada still has its fixed 30% (hard-coded, as asked)', noTol.outcome === 'matched', noTol.outcome);
var byGrade = one({ lines: [ln('Cambridge Fabrics (LBS)', 301, 'LBS')], scans: [{ pt: '1', cgt: '15', lb: 388 }], maps: [map('cambridge fabrics', 'LBS', null, '15', 'Fabrics Canada (grade 15, any product type)')] });
check('a Fabrics Canada mapping by GRADE only (any product type) gets the 30% too', byGrade.outcome === 'matched', byGrade.outcome);
check('productToleranceFor: grade 15 with product type 3 or none → 30%; grade 15 with another product type, or another grade → none', W.productToleranceFor({ wh_cgt: '15', wh_product_type: '3' }).pct === 30 && W.productToleranceFor({ wh_cgt: '15', wh_product_type: null }).pct === 30 && W.productToleranceFor({ wh_cgt: '15', wh_product_type: '1' }) === null && W.productToleranceFor({ wh_cgt: '8', wh_product_type: '3' }) === null && W.productToleranceFor(null) === null);
// fingerprint: changes ONLY where 30% flips the result (ZB / ZS pattern) — decisions on unchanged lines stay valid
var fabIn = fab.inputs || null;
check('FINGERPRINT: the 14743 Fabrics line (FAIL at 15% → PASS at 30%) records the rule, so a decision made on the old result is asked again', !!fab.inputs && fab.inputs.product_tolerance === 'Fabrics Canada 30% (v55.83-ZX)', fab.inputs && fab.inputs.product_tolerance);
var same = one({ lines: [ln('Cambridge Fabrics (LBS)', 1000, 'LBS')], scans: [{ pt: '3', cgt: '15', lb: 1050 }] });
check('…a Fabrics line within 15% anyway (+5%) has NO rule entry: its fingerprint is unchanged, earlier decisions stay valid', same.outcome === 'matched' && !!same.inputs && same.inputs.product_tolerance === undefined, same.inputs && same.inputs.product_tolerance);
check('…and a Fabrics line beyond 30% (still FAIL) has none either', !!f31.inputs && f31.inputs.product_tolerance === undefined);
var fs = require('fs'); var page = fs.readFileSync(path.join(root, 'src/app/page.jsx'), 'utf8'); var wn = fs.readFileSync(path.join(root, 'src/components/WhatsNewWidget.jsx'), 'utf8');
var topV = (/version: '([^']+)'/.exec(wn.substring(wn.indexOf('BUILD_HISTORY = ['))) || [])[1];
check('badge and What\'s New name the newest entry, and the ZX entry exists', topV === 'v55.83-ZX' && page.indexOf(topV) >= 0, topV);
console.log('\nZX Fabrics 30%: ' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
