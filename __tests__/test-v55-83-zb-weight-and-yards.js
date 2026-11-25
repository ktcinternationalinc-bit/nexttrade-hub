// v55.83-ZB — Warehouse check: weight vs weight AND yards vs yards, side by side (Max 25 Nov: "it will be a second validation with the
// yards as well as ther is a weight so yards and yards and weight and weight comparisoin"). No conversion between the two.
// Figures modelled on bill 14755 ↔ receipt 2219 (Texas Thirds, 12,231.64 yd, 31,333 lb on the scale); all rows made up.
// Run: node __tests__/test-v55-83-zb-weight-and-yards.js
var path = require('path'); var fs = require('fs'); var crypto = require('crypto');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
// the screen module imports the browser database client: a stand-in (no network) so its pure helpers can be loaded
var Module = require('module');
(function () { var id = require.resolve('@supabase/supabase-js'); var m0 = new Module(id); m0.filename = id; m0.loaded = true; m0.exports = { createClient: function () { return {}; } }; require.cache[id] = m0; })();
var W = require(path.join(root, 'src/lib/weight-check.js'));
var INV = require(path.join(root, 'src/components/WeightCheckInvoices.jsx'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 700))); }
function fp(inputs) { return inputs ? crypto.createHash('sha256').update(W.canonical(inputs)).digest('hex') : null; }
console.log('ZB — weight and yards side by side');

var NEX = 'NexPac Corporation';
var MAP_YD = { id: 'm-yd', version: 1, state: 'active', vendor_key: W.vendorKey(NEX), item_key: 'texas thirds', bill_unit: 'YDS', wh_product_type: '1', wh_cgt: '1', wh_label: 'Leather · Thirds USA' };
var MAP_LB = { id: 'm-lb', version: 1, state: 'active', vendor_key: W.vendorKey(NEX), item_key: 'texas thirds', bill_unit: 'LBS', wh_product_type: '1', wh_cgt: '1', wh_label: 'Leather · Thirds USA' };
var TOL = { id: 't1', version: 1, pct: 10, lb: null };
function bill(id) { return { id: id, vendor_name: NEX, bill_number: 'N' + id, bill_date: '2026-09-29', other_reference: '8021' + id }; }
function line(qty, unit) { return { id: 'L-' + unit, line_no: 1, line_kind: 'item', description: 'Texas Thirds (' + unit + ')', item_key: null, qty: qty, unit: unit }; }
// 30 rows like receipt 2219: yards 12,231.64 in total, scale 31,333 lb, packing list 14,401.61 kg
function rows(o) {
  o = o || {}; var out = []; var yd = o.yd == null ? 12231.64 : o.yd; var lb = o.lb == null ? 31333 : o.lb; var kg = 14401.61;
  for (var i = 0; i < 30; i++) {
    var last = i === 29;
    var y = last ? Math.round((yd - Math.round(yd / 30 * 100) / 100 * 29) * 100) / 100 : Math.round(yd / 30 * 100) / 100;
    var w = last ? lb - Math.floor(lb / 30) * 29 : Math.floor(lb / 30);
    var k = last ? Math.round((kg - Math.round(kg / 30 * 1000) / 1000 * 29) * 1000) / 1000 : Math.round(kg / 30 * 1000) / 1000;
    out.push({ id: 47472 + i, unit: null, product_type: '1', cgt: '1', nt: '1', color: '4', weight: String(w), yards: o.noYards ? null : y.toFixed(2), rolls: '11', roll_count: 11, pl_weight: String(k), is_scan_out: 1, skew_number: 'S' + i });
  }
  return out;
}
function receipt(o) { o = o || {}; return { source: 'nextrade-live', id: 2219, reference_number: '80217887', nexpac_bill: null, is_draf: 0, state: 'present', read_complete: true,
  info: { uom: o.uom == null ? 'Yards' : o.uom, declared_quantity: o.declared == null ? '12231.64' : o.declared, cgt_reference: null, container_trailer_number: 'e819143' }, logs: rows(o) }; }
function run(o) {
  var b = bill('7887'); var links = W.currentLinks([{ bill_id: b.id, source: 'nextrade-live', receipt_id: 2219, basis: 'reference_number', bill_value: '80217887', receipt_value: '80217887', state: 'confirmed', at: '2026-11-25T00:00:00Z' }]);
  var g = W.buildGroups(links)[0]; var recs = {}; var r = o.receipt || receipt(); recs[W.receiptKey(r)] = r;
  var lines = {}; lines[b.id] = o.lines;
  var items = W.compareGroup({ group: g, bills: (function () { var x = {}; x[b.id] = b; return x; })(), linesByBill: lines, receipts: recs, maps: o.maps || [MAP_YD, MAP_LB], tolerance: o.tolerance === undefined ? TOL : o.tolerance, lookups: {}, hiddenBillIds: {}, feed: { ok: true } });
  return items.filter(function (i) { return i.kind === 'product'; })[0];
}

// 1. the 14755 / 2219 shape: billed in YARDS, no weight on the bill
var a = run({ lines: [line(12231.64, 'YDS')] });
var c = a && a.figures && a.figures.checks;
check('yards bill: Yards check = billed 12,231.64 yd vs warehouse 12,231.64 yd → PASS (matched)', c && c.yards.billed === 12231.64 && c.yards.received === 12231.64 && c.yards.diff === 0 && c.yards.result === 'matched', c && c.yards);
check('…Weight check = "not on the bill (billed in yards)", the scale weight is still shown (31,333 lb), no mismatch', c && c.weight.result === 'not_recorded' && c.weight.billed === null && c.weight.received === 31333 && /not on the bill \(billed in yards\)/.test(c.weight.note), c && c.weight);
check('…the packing-list weight is shown beside the scale (14,401.61 kg = 31,750.08 lb; scale 417.08 lb below) — information only', c && Math.abs(c.weight.packing_list_lb - 31750.077) < 0.01 && Math.abs(c.weight.scale_vs_packing_list_lb + 417.077) < 0.01, c && c.weight);
check('…the product is PASS (matched) — a missing side never makes it REVIEW', a.outcome === 'matched', [a.outcome, a.reasons]);
check('…the yards equal the packing-list quantity, so the card notes they may be copied, not measured (Codex 25 Nov)', c && /may have been copied from it, not measured/.test(c.yards.copied_note || ''), c && c.yards);
var cw = INV.checkWords('Weight', c.weight); var cy = INV.checkWords('Yards', c.yards);
check('SCREEN words: "Weight: not on the bill (billed in yards) — warehouse 31,333 lb · packing list …" (muted) and "Yards: billed … — PASS" (green)', /^Weight: not on the bill \(billed in yards\) — warehouse 31,333 lb · packing list 31,750 lb$/.test(cw.text) && cw.tone === 'muted' && /^Yards: billed 12,231\.64 yd · warehouse 12,231\.64 yd · 0 .*— PASS$/.test(cy.text) && cy.tone === 'pass', [cw, cy]);

// 2. billed in POUNDS: weight decides, yards "not on the bill"
var b2 = run({ lines: [line(30000, 'LBS')] });
var c2 = b2.figures.checks;
check('pounds bill: Weight check = billed 30,000 lb vs 31,333 lb → PASS (bill below by 4.4%)', c2.weight.billed === 30000 && c2.weight.received === 31333 && c2.weight.result === 'matched' && b2.outcome === 'matched', [c2.weight, b2.outcome]);
check('…Yards check = "not on the bill (billed by weight)", warehouse yards shown, never a mismatch', c2.yards.result === 'not_recorded' && /billed by weight/.test(c2.yards.note) && c2.yards.received === 12231.64, c2.yards);

// 3. one-way rule per check
var b3 = run({ lines: [line(12500, 'YDS')] });
check('yards billed ABOVE the warehouse (12,500 vs 12,231.64) → REVIEW, "billed MORE … never allowed"', b3.outcome === 'discrepancy' && b3.figures.checks.yards.result === 'discrepancy' && b3.figures.checks.yards.over === true && /billed MORE than was scanned/.test(b3.reasons.join(' ')) && /never allowed/.test(INV.checkWords('Yards', b3.figures.checks.yards).text), [b3.outcome, b3.figures.checks.yards, b3.reasons]);
var b4 = run({ lines: [line(10000, 'YDS')] });
check('yards billed 18% BELOW the warehouse (10,000 vs 12,231.64, tolerance 10%) → REVIEW', b4.outcome === 'discrepancy' && b4.figures.checks.yards.result === 'discrepancy' && !b4.figures.checks.yards.over, [b4.outcome, b4.figures.checks.yards]);
var b5 = run({ lines: [line(11500, 'YDS')], tolerance: { id: 't2', version: 1, pct: 10, lb: 5000 } });
check('the POUND allowance never widens the yards check: 11,500 yd vs 12,231.64 (6%) passes on the %, and 9,000 yd (26%) fails even with a 5,000 lb allowance', b5.figures.checks.yards.result === 'matched' && run({ lines: [line(9000, 'YDS')], tolerance: { id: 't2', version: 1, pct: 10, lb: 5000 } }).figures.checks.yards.result === 'discrepancy', [b5.figures.checks.yards]);

// 3b. v55.83-ZC (Max 25 Nov: "if within tolerance it should say Pass within tolerance for each item that is within the tolerance")
check('WITHIN TOLERANCE wording: a pounds line 30,000 vs 31,333 (−4.3%, 10%) says "PASS — within tolerance (10%)"', /— PASS — within tolerance \(10%\)$/.test(INV.checkWords('Weight', c2.weight).text), INV.checkWords('Weight', c2.weight).text);
check('…a yards line inside the % says the same, and never names the pound allowance (yards use the % only)', /— PASS — within tolerance \(10%\)$/.test(INV.checkWords('Yards', b5.figures.checks.yards).text), INV.checkWords('Yards', b5.figures.checks.yards).text);
var b5w = run({ lines: [line(30000, 'LBS')], tolerance: { id: 't2', version: 1, pct: 10, lb: 5000 } });
check('…a weight line names both parts of the tolerance it was judged by: "(10% or 5000 lb)"', /— PASS — within tolerance \(10% or 5000 lb\)$/.test(INV.checkWords('Weight', b5w.figures.checks.weight).text), INV.checkWords('Weight', b5w.figures.checks.weight).text);
check('…an EXACT match stays plain "PASS" (bill 14755: 12,231.64 = 12,231.64), and a REVIEW line never says within tolerance', /— PASS$/.test(INV.checkWords('Yards', c.yards).text) && INV.passWords(0, TOL, 'yd') === 'PASS' && !/within tolerance/.test(INV.checkWords('Yards', b4.figures.checks.yards).text));
var srcW = fs.readFileSync(path.join(root, 'src/components/WeightCheckInvoices.jsx'), 'utf8');
check('…and the product\'s Result pill uses the same wording with the tolerance the comparison used', /\{ok \? passWords\(f\.diff, \(\(f\.checks \|\| \{\}\)\[f\.basis === 'yd' \? 'yards' : 'weight'\] \|\| \{\}\)\.tol \|\| tol, f\.basis\) : 'REVIEW'\}/.test(srcW));

// 4. a side not recorded on the receipt
var b6 = run({ lines: [line(12231.64, 'YDS')], receipt: receipt({ noYards: true }) });
check('yards bill, the receipt has no yards → Yards "not recorded on the receipt", weight "not on the bill" → Cannot compare (nothing to compare), never PASS', b6.outcome === 'cannot_compare' && b6.figures.checks.yards.result === 'not_recorded' && /not recorded on the receipt/.test(b6.figures.checks.yards.note) && b6.figures.checks.weight.result === 'not_recorded', [b6.outcome, b6.figures.checks]);
var b7 = run({ lines: [line(30000, 'LBS')], receipt: receipt({ noYards: true }) });
check('pounds bill, the receipt has no yards → weight decides (PASS), yards "not on the bill"', b7.outcome === 'matched' && b7.figures.checks.weight.result === 'matched' && b7.figures.checks.yards.result === 'not_recorded', [b7.outcome, b7.figures.checks]);

// 5. measured yards ≠ declared → compared as entered, no "copied" note
var b8 = run({ lines: [line(12000, 'YDS')], receipt: receipt({ yd: 12105.3 }) });
check('warehouse yards differ from the packing list (12,105.3 vs 12,231.64) → compared as entered (12,000 billed → PASS), no "copied" note', b8.figures.checks.yards.received === 12105.3 && b8.figures.checks.yards.result === 'matched' && !b8.figures.checks.yards.copied_note && b8.outcome === 'matched', b8.figures.checks.yards);

// 6. no tolerance saved: exact equality only, per check
var b9 = run({ lines: [line(12231.64, 'YDS')], tolerance: null });
var b10 = run({ lines: [line(12000, 'YDS')], tolerance: null });
check('no tolerance saved: exact yards → Equal; 12,000 vs 12,231.64 → REVIEW (nothing is "within tolerance" until Max sets it)', b9.outcome === 'equal' && b9.figures.checks.yards.result === 'equal' && b10.outcome === 'discrepancy' && b10.figures.checks.yards.result === 'discrepancy', [b9.outcome, b10.outcome]);

// 7. decisions: the comparison fingerprint is unchanged by ZB (no old decision is invalidated) but still follows the figures
var before = run({ lines: [line(12231.64, 'YDS')] }); var after = run({ lines: [line(12231.64, 'YDS')], receipt: receipt({ lb: 30000 }) });
check('the fingerprint inputs carry no "checks" (ZB changes no existing decision fingerprint)', before.inputs && before.inputs.checks === undefined && Object.keys(before.inputs).sort().join() === 'basis,bill_lines,conflict,item_key,links,logs,maps,receipts,tolerance', Object.keys(before.inputs));
check('…and a different scale weight still changes the fingerprint (scan rows carry lb), so a decision never covers figures it did not see', fp(before.inputs) !== fp(after.inputs));

// 8. the dashboard's "stop when the confirmed result differs" signature includes both checks
var invA = { bills: [{ id: 'x' }], pass: true, products: [before] }; var invB = { bills: [{ id: 'x' }], pass: true, products: [after] };
check('invoiceSignature changes when only the weight check changes (Approved on a preview stops)', INV.invoiceSignature(invA) !== INV.invoiceSignature(invB));

// 9. a mixed product (part pounds, part yards) is still "cannot be added" — no silent sum
var b11 = run({ lines: [line(12231.64, 'YDS'), Object.assign(line(500, 'LBS'), { id: 'L2', line_no: 2 })] });
check('a product billed partly by weight and partly by yards → Cannot compare (the two cannot be added); both checks "not on the bill"', b11.outcome === 'cannot_compare' && b11.figures.checks.weight.result === 'not_recorded' && b11.figures.checks.yards.result === 'not_recorded' && /cannot be added/.test(b11.reasons.join(' ')), [b11.outcome, b11.reasons]);

// 11. Codex 25 Nov (ZB P1): an OLD saved decision. The rules exactly as on main before ZB (2e2c6c2d) make the old fingerprint;
// where ZB's yards rule flips the result the decision must need revalidation, where it does not the approval stays valid.
var cp = require('child_process'); var os = require('os');
var oldSrc = cp.execFileSync('git', ['-C', root, 'show', '2e2c6c2d8d14a57a7bcbaf847212381b70ce62fc:src/lib/weight-check.js'], { encoding: 'utf8' });
var oldDir = fs.mkdtempSync(path.join(process.env.TMP || os.tmpdir(), 'zb-old-')); var oldFile = path.join(oldDir, 'weight-check-pre-zb.js'); fs.writeFileSync(oldFile, oldSrc);
var OLD = require(oldFile); try { fs.rmSync(oldDir, { recursive: true, force: true }); } catch (e) { /* temp copy only */ }
function runWith(lib, o) { var save = W; W = lib; try { return run(o); } finally { W = save; } }
var TOL_LB = { id: 't2', version: 1, pct: 10, lb: 5000 };
var oldA = runWith(OLD, { lines: [line(9000, 'YDS')], tolerance: TOL_LB }); var newA = run({ lines: [line(9000, 'YDS')], tolerance: TOL_LB });
check('(fixture) before ZB, 9,000 yd vs 12,231.64 yd with 10% + a 5,000 lb allowance was Matched; with ZB it is REVIEW (the lb allowance is weight only)', oldA.outcome === 'matched' && newA.outcome === 'discrepancy' && newA.figures.checks.yards.result === 'discrepancy', [oldA.outcome, newA.outcome]);
var savedA = [{ id: 'd1', kind: 'validate_match', comparison_fp: fp(oldA.inputs), at: '2026-11-25T10:00:00Z' }];
var stA = W.decisionState(savedA, fp(newA.inputs));
check('…so a validation saved before ZB now NEEDS REVALIDATION (fingerprint changed by the yards rule) and is outstanding again', fp(oldA.inputs) !== fp(newA.inputs) && stA.state === 'needs_revalidation' && W.isOutstanding(stA.state) && newA.inputs.yd_rule === 'percent only (v55.83-ZB)', [stA.state, newA.inputs.yd_rule]);
var oldB = runWith(OLD, { lines: [line(12231.64, 'YDS')], tolerance: TOL_LB }); var newB = run({ lines: [line(12231.64, 'YDS')], tolerance: TOL_LB });
var stB = W.decisionState([{ id: 'd2', kind: 'validate_match', comparison_fp: fp(oldB.inputs), at: '2026-11-25T10:00:00Z' }], fp(newB.inputs));
check('…an approval whose comparison still passes is KEPT (12,231.64 = 12,231.64: same fingerprint, still validated)', fp(oldB.inputs) === fp(newB.inputs) && stB.state === 'validated' && newB.inputs.yd_rule === undefined, [stB.state]);
var oldC = runWith(OLD, { lines: [line(30000, 'LBS')], tolerance: TOL_LB }); var newC = run({ lines: [line(30000, 'LBS')], tolerance: TOL_LB });
var oldD = runWith(OLD, { lines: [line(12231.64, 'YDS')], tolerance: TOL }); var newD = run({ lines: [line(12231.64, 'YDS')], tolerance: TOL });
check('…and nothing else moves: a pounds bill and a yards bill without a lb allowance keep their pre-ZB fingerprints', fp(oldC.inputs) === fp(newC.inputs) && fp(oldD.inputs) === fp(newD.inputs));
var oldE = runWith(OLD, { lines: [line(11500, 'YDS')], tolerance: TOL_LB }); var newE = run({ lines: [line(11500, 'YDS')], tolerance: TOL_LB });
check('…a yards bill that passes on the % alone keeps its fingerprint even with a lb allowance (11,500 vs 12,231.64: Matched before and after)', oldE.outcome === 'matched' && newE.outcome === 'matched' && fp(oldE.inputs) === fp(newE.inputs));

// 12. Codex 25 Nov (ZB P2): no green PASS on a draft or an incomplete read
var dr = receipt(); dr.is_draf = 1;
var b12 = run({ lines: [line(12231.64, 'YDS')], receipt: dr });
check('DRAFT receipt: the product is incomplete and the yards check says PROVISIONAL (amber), never a green PASS', b12.outcome === 'incomplete' && b12.figures.checks.yards.result === 'provisional' && b12.figures.checks.yards.raw_result === 'matched' && INV.checkWords('Yards', b12.figures.checks.yards).tone === 'provisional' && /Provisional/.test(INV.checkWords('Yards', b12.figures.checks.yards).text), [b12.outcome, b12.figures.checks.yards]);
var ir = receipt(); ir.read_complete = false;
var b13 = run({ lines: [line(12231.64, 'YDS')], receipt: ir });
check('INCOMPLETE read: cannot compare, the yards check says NOT CHECKED (grey), never PASS', b13.outcome === 'cannot_compare' && b13.figures.checks.yards.result === 'not_checked' && INV.checkWords('Yards', b13.figures.checks.yards).tone === 'muted' && !/PASS/.test(INV.checkWords('Yards', b13.figures.checks.yards).text), [b13.outcome, b13.figures.checks.yards]);
var b14 = run({ lines: [line(30000, 'LBS')], receipt: dr });
check('…the same for weight on a draft (provisional), and a side "not on the bill" stays as it is', b14.figures.checks.weight.result === 'provisional' && b14.figures.checks.yards.result === 'not_recorded');

// 13. the automatic approval reason names what was compared
check('AUTO REASON: a yards-only invoice is approved as "billed yards vs receipt yards", a pounds one as "billed weight vs scanned weight", both when both', INV.autoReason({ products: [a] }) === 'Approved: billed yards vs receipt yards within the approved tolerance' && INV.autoReason({ products: [b2] }) === 'Approved: billed weight vs scanned weight within the approved tolerance' && /weight vs scanned weight and billed yards vs receipt yards/.test(INV.autoReason({ products: [a, b2] })), [INV.autoReason({ products: [a] })]);

// 10. screen + version
var src = fs.readFileSync(path.join(root, 'src/components/WeightCheckInvoices.jsx'), 'utf8');
check('SCREEN: each product row renders the two checks (checksBlock(f.checks)) and the tolerance tile says the % applies to weight and to yards', /\{f\.checks \? <tr><td colSpan=\{5\}[^]*?checksBlock\(f\.checks\)/.test(src) && /The % applies to weight and to yards/.test(src));
var page = fs.readFileSync(path.join(root, 'src/app/page.jsx'), 'utf8'); var wn = fs.readFileSync(path.join(root, 'src/components/WhatsNewWidget.jsx'), 'utf8');
var topV = (/version: '([^']+)'/.exec(wn.substring(wn.indexOf('BUILD_HISTORY'))) || [])[1];
check('badge and What\'s New name the newest entry, and the ZB entry exists', wn.indexOf("version: 'v55.83-ZB'") >= 0 && page.indexOf(topV) >= 0, topV);

console.log('\nZB weight and yards: ' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
