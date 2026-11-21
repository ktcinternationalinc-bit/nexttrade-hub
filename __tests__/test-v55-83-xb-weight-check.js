// v55.83-XB — Bill-to-Warehouse weight check (Max 21 Nov 2026; plan revision 2 after Codex 10:16). All figures are made up.
// Part 1: the rules (lib/weight-check.js). Part 2: the REAL route with a stubbed database and feed (see below).
var path = require('path'); var fs = require('fs'); var Module = require('module'); var crypto = require('crypto');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 600))); }
console.log('XB — bill-to-warehouse weight check');
var W = require(path.join(root, 'src/lib/weight-check.js'));
function fp(inputs) { return inputs ? crypto.createHash('sha256').update(W.canonical(inputs)).digest('hex') : null; }

// ---------- fixtures
var NEX = 'NexPac Corporation';
function bill(id, o) { return Object.assign({ id: id, vendor_name: NEX, bill_number: '5' + id, bill_date: '2026-10-05', other_reference: '9000000' + id }, o || {}); }
function line(no, desc, qty, unit, o) { return Object.assign({ id: 'L' + no + '-' + Math.random().toString(36).slice(2, 6), line_no: no, line_kind: 'item', description: desc, item_key: null, qty: qty, unit: unit }, o || {}); }
function log(id, o) { return Object.assign({ id: id, unit: 'W', product_type: '7', cgt: '2', nt: null, color: null, weight: '1000', yards: null, rolls: '1', roll_count: 1, pl_weight: '450', is_scan_out: 0, skew_number: 'W.S.' + id }, o || {}); }
function receipt(id, logs, o) { return Object.assign({ source: 'nextrade-staging', id: id, reference_number: 'R' + id, nexpac_bill: null, is_draf: 0, state: 'present', read_complete: true, info: { cgt_reference: null, uom: null }, logs: logs }, o || {}); }
var MAP_SEC = { id: 'm1', version: 1, state: 'active', vendor_key: W.vendorKey(NEX), item_key: 'cambridge seconds', bill_unit: 'LBS', wh_product_type: '7', wh_cgt: '2', wh_label: 'Vinyl · CGT Seconds' };
var MAP_TH = { id: 'm2', version: 1, state: 'active', vendor_key: W.vendorKey(NEX), item_key: 'texas thirds', bill_unit: 'YDS', wh_product_type: '8', wh_cgt: '3', wh_label: 'Fabric · CGT Thirds' };
function link(billId, rid, o) { return Object.assign({ bill_id: billId, source: 'nextrade-staging', receipt_id: rid, basis: 'cgt_reference', bill_value: 'x', receipt_value: 'x', state: 'confirmed', at: '2026-11-01T00:00:00Z' }, o || {}); }
function run(o) {
  var links = W.currentLinks(o.links);
  var groups = W.buildGroups(links);
  var bills = {}; (o.bills || []).forEach(function (b) { bills[b.id] = b; });
  var recs = {}; (o.receipts || []).forEach(function (r) { recs[W.receiptKey(r)] = r; });
  var items = [];
  groups.forEach(function (g) { items = items.concat(W.compareGroup({ group: g, bills: bills, linesByBill: o.lines || {}, receipts: recs, maps: o.maps || [MAP_SEC, MAP_TH], tolerance: o.tolerance || null, lookups: {}, hiddenBillIds: o.hidden || {} })); });
  return items;
}
function prod(items) { return items.filter(function (i) { return i.kind === 'product'; }); }

// ---------- references
check('normRef: case, spaces, # . - / _ removed; digits and leading zeros kept', W.normRef(' no. 0012-345 ') === '0012345' && W.normRef('#ab 12/3') === 'AB123' && W.normRef('0012345') !== W.normRef('12345'));
var pr = W.proposeLinks(bill('1', { other_reference: '90000001' }), [receipt('11', [], { info: { cgt_reference: '9000-0001' } }), receipt('12', [], { reference_number: '90000002' })]);
check('typed pair: bill reference ↔ receipt CGT reference proposes ONE receipt (to confirm)', pr.candidates.length === 1 && pr.candidates[0].receipt_id === '11' && pr.candidates[0].bases[0] === 'cgt_reference' && !pr.ambiguous);
var pr2 = W.proposeLinks(bill('1', { other_reference: '90000001' }), [receipt('11', [], { info: { cgt_reference: '90000001' } }), receipt('13', [], { reference_number: '90000001' })]);
check('the same reference on two receipts → ambiguous, a person chooses (never guessed)', pr2.ambiguous && pr2.candidates.length === 2 && /choose/.test(pr2.reason));
var pr3 = W.proposeLinks(bill('1', { vendor_name: 'Trinity Logistics', bill_number: '777', other_reference: null }), [receipt('14', [], { nexpac_bill: '777' })]);
check('NexPac bill-number pair is for NexPac only — another vendor’s bill number never matches a NEXPAC Bill field', pr3.candidates.length === 0);
var pr4 = W.proposeLinks(bill('1', { other_reference: '1002-4455' }), [receipt('15', [], { reference_number: 'X' })]);
check('a release-number-like reference finds nothing unless a typed pair holds it (release ≠ receipt)', pr4.candidates.length === 0);
var u1 = W.unlinkedBillItem(bill('9'), { candidates: [] }, false);
check('WAREHOUSE OUTAGE: an unlinked bill while the warehouse could not be read = "Warehouse unavailable / not checked", never "No receipt"', u1.outcome === 'warehouse_unavailable' && /not checked/.test(u1.reasons[0]));
var u2 = W.unlinkedBillItem(bill('9'), { candidates: [] }, true);
check('MISSING RECEIPT: warehouse read, nothing carries the reference → No receipt found (with the references looked for)', u2.outcome === 'no_receipt' && /90000009/.test(u2.reasons[0]));

// ---------- units
check('units: LBS 1 · KG 2.20462 · MT metric 2204.62 · bare TON unknown · YDS / linear metre are lengths · CAM unknown',
  W.billUnit('LBS').toLb === 1 && W.billUnit('kg').toLb === 2.20462 && W.billUnit('MT').toLb === 2204.62 && /metric/.test(W.billUnit('MT').label) && W.billUnit('TON').kind === 'unknown' && /short/.test(W.billUnit('TN').reason)
  && W.billUnit('YDS').kind === 'length' && W.billUnit('LINEAR METER').toYd === W.YD_PER_M && W.billUnit('CAM').kind === 'unknown');
check('numbers: "1,250.5" → 1250.5, "12 lbs" on weight → 12, "" → missing, "abc" → unreadable (never 0)', W.parseNum('1,250.5').value === 1250.5 && W.parseNum('12 lbs', true).value === 12 && W.parseNum('').problem === 'missing' && W.parseNum('abc').problem === 'unreadable' && W.parseNum('abc').value === null);

// ---------- 1 exact match (no tolerance approved yet → "Equal", never "Matched")
var B1 = bill('1'); var L1 = { '1': [line(1, 'Cambridge Seconds (LBS)', 2000, 'LBS')] };
var R1 = receipt('11', [log(101), log(102)]);
var it1 = run({ bills: [B1], lines: L1, receipts: [R1], links: [link('1', '11')] });
var p1 = prod(it1)[0];
check('EXACT MATCH: 2,000 lb billed, two scans of 1,000 lb → Equal (no tolerance approved), diff 0', p1 && p1.outcome === 'equal' && p1.figures.billed === 2000 && p1.figures.received === 2000 && p1.figures.diff === 0, p1);
check('…the packing-list weight (kg) is shown as declared and is NOT the received weight', p1.figures.declared_pl_kg === 900 && p1.figures.received_lb === 2000);
check('…"Matched" is never given without an approved tolerance', it1.every(function (i) { return i.outcome !== 'matched'; }));
var it1t = run({ bills: [B1], lines: L1, receipts: [R1], links: [link('1', '11')], tolerance: { id: 't1', version: 1, pct: 1, lb: 50 } });
check('with an APPROVED tolerance an exact match is Matched', prod(it1t)[0].outcome === 'matched');

// ---------- 2 real weight difference
var R2 = receipt('11', [log(101), log(102, { weight: '900' })]);
var p2 = prod(run({ bills: [B1], lines: L1, receipts: [R2], links: [link('1', '11')] }))[0];
check('REAL DIFFERENCE: billed 2,000, scanned 1,900 → discrepancy −100 lb, −5%', p2.outcome === 'discrepancy' && p2.figures.diff === -100 && p2.figures.pct === -5, p2.figures);
var p2t = prod(run({ bills: [B1], lines: L1, receipts: [R2], links: [link('1', '11')], tolerance: { id: 't1', version: 1, pct: 1, lb: 50 } }))[0];
check('…still a discrepancy when beyond the approved tolerance (100 > max(1%·2000, 50))', p2t.outcome === 'discrepancy');
var p2s = prod(run({ bills: [B1], lines: L1, receipts: [receipt('11', [log(101), log(102, { weight: '970' })])], links: [link('1', '11')], tolerance: { id: 't1', version: 1, pct: 1, lb: 50 } }))[0];
check('…a 30 lb difference inside the approved tolerance is Matched', p2s.outcome === 'matched');

// ---------- 3 missing product
var L3 = { '1': [line(1, 'Cambridge Seconds (LBS)', 2000, 'LBS'), line(2, 'Texas Thirds (YDS)', 300, 'YDS')] };
var it3 = run({ bills: [B1], lines: L3, receipts: [R1], links: [link('1', '11')] });
var miss = it3.filter(function (i) { return i.outcome === 'product_missing'; });
check('MISSING PRODUCT: a billed product with no scan of it in the linked receipt → Billed product missing', miss.length === 1 && /Thirds/.test(miss[0].product_label));
var unm = run({ bills: [B1], lines: { '1': [line(1, 'Cambridge Roofing (LBS)', 500, 'LBS')] }, receipts: [R1], links: [link('1', '11')] });
check('an unmapped bill product → Cannot compare (no approved mapping), never matched by name', unm.some(function (i) { return i.outcome === 'cannot_compare' && i.needs_mapping; }));
check('…and the scans of the receipt show as "in the warehouse, not on the linked bill" (information, never "unbilled")', unm.some(function (i) { return i.outcome === 'warehouse_only' && /may be billed elsewhere/.test(i.reasons[0]); }));

// ---------- 4 partial scan (draft)
var p4 = prod(run({ bills: [B1], lines: L1, receipts: [receipt('11', [log(101)], { is_draf: 1 })], links: [link('1', '11')] }))[0];
check('PARTIAL SCAN: a draft receipt → Receipt incomplete (provisional), figures still shown', p4.outcome === 'incomplete' && p4.provisional === true && p4.figures.received === 1000);

// ---------- 5 split receipts and split bills
var BA = bill('A', { other_reference: '1' }); var BB = bill('B', { other_reference: '2' });
var LS = { A: [line(1, 'Cambridge Seconds (LBS)', 1200, 'LBS')], B: [line(1, 'Cambridge Seconds (LBS)', 800, 'LBS')] };
var RS = receipt('21', [log(201), log(202)]);
var it5 = run({ bills: [BA, BB], lines: LS, receipts: [RS], links: [link('A', '21'), link('B', '21')] });
var p5 = prod(it5);
check('SPLIT BILLS: two bills (1,200 + 800) on one receipt (2,000) → ONE group item, equal; a part bill is never compared with the whole receipt', p5.length === 1 && p5[0].figures.billed === 2000 && p5[0].figures.received === 2000 && p5[0].bill_ids.length === 2, p5);
var it5b = run({ bills: [B1], lines: L1, receipts: [receipt('31', [log(301)]), receipt('32', [log(302)])], links: [link('1', '31'), link('1', '32')] });
check('SPLIT RECEIPTS: one bill over two receipts → one group of both, received 2,000', prod(it5b).length === 1 && prod(it5b)[0].figures.received === 2000 && prod(it5b)[0].receipt_keys.length === 2);
var it5c = run({ bills: [B1], lines: L1, receipts: [receipt('31', [log(301)]), receipt('32', [log(301)])], links: [link('1', '31'), link('1', '32')] });
check('the same scan row id seen twice is counted ONCE', prod(it5c)[0].figures.received === 1000 && prod(it5c)[0].figures.scans === 1);

// ---------- 6 unit conversion
var p6 = prod(run({ bills: [B1], lines: { '1': [line(1, 'Cambridge Seconds', 907.1858, 'KG')] }, maps: [Object.assign({}, MAP_SEC, { bill_unit: 'KG' })], receipts: [R1], links: [link('1', '11')] }))[0];
check('KG bill line converted × 2.20462 to lb and compared (conversion shown)', p6.figures.basis === 'lb' && Math.abs(p6.figures.billed - 2000) < 0.01 && /2\.20462/.test(p6.figures.conversion), p6.figures);
var p6t = prod(run({ bills: [B1], lines: { '1': [line(1, 'Cambridge Seconds', 1, 'TON')] }, maps: [Object.assign({}, MAP_SEC, { bill_unit: 'TON' })], receipts: [R1], links: [link('1', '11')] }))[0];
check('bare TON → Cannot compare, ton type unknown', p6t.outcome === 'cannot_compare' && /ton type unknown/.test(p6t.reasons.join(' ')));
var RY = receipt('41', [log(401, { unit: 'Y', product_type: '8', cgt: '3', weight: '700', yards: '300' })], { info: { uom: 'Yards' } });
var p6y = prod(run({ bills: [B1], lines: { '1': [line(1, 'Texas Thirds (YDS)', 300, 'YDS')] }, receipts: [RY], links: [link('1', '41')] }))[0];
check('YARDS like with like: 300 yd billed vs 300 yd scanned → Equal, no invented pounds', p6y.figures.basis === 'yd' && p6y.outcome === 'equal' && p6y.figures.lb_factor === null && p6y.figures.billed_lb_by_factor === null, p6y.figures);
var p6f = prod(run({ bills: [B1], lines: { '1': [line(1, 'Texas Thirds (YDS)', 300, 'YDS')] }, maps: [Object.assign({}, MAP_TH, { lb_per_yd: 2.5, lb_factor_approved: true })], receipts: [RY], links: [link('1', '41')] }))[0];
check('…pounds for a yard line only with a factor APPROVED for this check on the mapping (shown beside, yards still decide)', p6f.figures.lb_factor === 2.5 && p6f.figures.billed_lb_by_factor === 750 && p6f.figures.received_lb_vs_factor === -50 && p6f.outcome === 'equal');
var p6n = prod(run({ bills: [B1], lines: { '1': [line(1, 'Texas Thirds (YDS)', 300, 'YDS')] }, maps: [Object.assign({}, MAP_TH, { lb_per_yd: 2.5, lb_factor_approved: false })], receipts: [RY], links: [link('1', '41')] }))[0];
check('…an unapproved factor is never used', p6n.figures.lb_factor === null);
var RM = receipt('42', [log(402, { unit: 'Y', product_type: '8', cgt: '3', yards: '100' })], { info: { uom: 'Meters' } });
var p6m = prod(run({ bills: [B1], lines: { '1': [line(1, 'Texas Thirds (YDS)', 109.36133, 'YDS')] }, receipts: [RM], links: [link('1', '42')] }))[0];
check('a receipt counted in metres is converted to yards (× 1.0936133)', p6m.figures.received === 109.361 && p6m.figures.basis === 'yd', p6m.figures);
var RP = receipt('43', [log(403, { unit: 'Y', product_type: '8', cgt: '3', yards: '5' })], { info: { uom: 'Pallets' } });
check('a receipt whose quantity column is pallets / pieces is never read as yards → Cannot compare', prod(run({ bills: [B1], lines: { '1': [line(1, 'Texas Thirds (YDS)', 5, 'YDS')] }, receipts: [RP], links: [link('1', '43')] }))[0].outcome === 'cannot_compare');
check('CAM unit → Cannot compare', prod(run({ bills: [B1], lines: { '1': [line(1, 'Cambridge Seconds', 3, 'CAM')] }, maps: [Object.assign({}, MAP_SEC, { bill_unit: 'CAM' })], receipts: [R1], links: [link('1', '11')] }))[0].outcome === 'cannot_compare');
check('a bill product billed partly in lb and partly in yards → Cannot compare (never added)', prod(run({ bills: [B1], lines: { '1': [line(1, 'Cambridge Seconds (LBS)', 10, 'LBS'), line(2, 'Cambridge Seconds', 10, 'YDS')] }, maps: [MAP_SEC, Object.assign({}, MAP_SEC, { id: 'm9', bill_unit: 'YDS' })], receipts: [R1], links: [link('1', '11')] }))[0].outcome === 'cannot_compare');

// ---------- 7 duplicate / unreadable / removed scans; scanned-out still counted
var p7 = prod(run({ bills: [B1], lines: L1, receipts: [receipt('11', [log(101, { is_scan_out: 1 }), log(102, { is_scan_out: 1 })])], links: [link('1', '11')] }))[0];
check('SCANNED OUT / SOLD goods still count toward their original receipt', p7.figures.received === 2000 && p7.figures.scanned_out === 2 && p7.outcome === 'equal');
var p7u = prod(run({ bills: [B1], lines: L1, receipts: [receipt('11', [log(101), log(102, { weight: 'n/a' })])], links: [link('1', '11')] }))[0];
check('an unreadable scan weight → Cannot compare (never taken as 0)', p7u.outcome === 'cannot_compare' && p7u.figures.received === null && /readable weight/.test(p7u.reasons.join(' ')));
var p7r = prod(run({ bills: [B1], lines: L1, receipts: [{ source: 'nextrade-staging', id: '11', state: 'removed' }], links: [link('1', '11')] }));
check('a receipt CONFIRMED removed (id lookup) → Cannot compare with the reason; nothing invented', p7r.length === 1 && p7r[0].outcome === 'cannot_compare' && /not found/.test(p7r[0].reasons[0]));
var p7i = prod(run({ bills: [B1], lines: L1, receipts: [receipt('11', [log(101)], { read_complete: false })], links: [link('1', '11')] }))[0];
check('an incomplete warehouse answer (fewer rows than its count) → Cannot compare, recheck', p7i.outcome === 'cannot_compare' && /incomplete/.test(p7i.reasons[0]));
var p7o = run({ bills: [B1], lines: L1, receipts: [], links: [link('1', '11')] });
check('a linked receipt the Hub has not read → Warehouse unavailable / not checked (never "no goods received")', p7o.length === 1 && p7o[0].outcome === 'warehouse_unavailable');

// ---------- 8 limited access
var it8 = run({ bills: [BA, BB], lines: LS, receipts: [RS], links: [link('A', '21'), link('B', '21')], hidden: { B: true } });
check('LIMITED ACCESS: part of the group is a bill the viewer may not see → one "limited access" row, no figures, no hidden bill details', it8.length === 1 && it8[0].outcome === 'limited_access' && it8[0].figures === null && !it8[0].bill_lines);

// ---------- 9 decisions and fingerprints
var base9 = prod(run({ bills: [B1], lines: L1, receipts: [R2], links: [link('1', '11')] }))[0];
var fp0 = fp(base9.inputs);
var dAcc = { id: 'd1', kind: 'accept_discrepancy', at: '2026-11-21T10:00:00Z', comparison_fp: fp0 };
check('ACCEPTED DISCREPANCY: state "Reviewed — discrepancy accepted", not outstanding, the outcome stays a discrepancy (never "Matched")', W.decisionState([dAcc], fp0).state === 'accepted' && !W.isOutstanding('accepted') && base9.outcome === 'discrepancy' && /accepted/.test(W.STATE_WORDS.accepted));
var shipped = prod(run({ bills: [B1], lines: L1, receipts: [receipt('11', [log(101, { is_scan_out: 1 }), log(102, { weight: '900', is_scan_out: 1 })])], links: [link('1', '11')] }))[0];
check('approve → goods shipped → rerun: same fingerprint, stays accepted (scanned-out flags do not count)', fp(shipped.inputs) === fp0 && W.decisionState([dAcc], fp(shipped.inputs)).state === 'accepted');
var resaved = prod(run({ bills: [B1], lines: { '1': [line(1, 'Cambridge Seconds (LBS)', 2000, 'LBS')] }, receipts: [R2], links: [link('1', '11')] }))[0];
check('unchanged bill saved again (new line ids) → same fingerprint, stays accepted', fp(resaved.inputs) === fp0 && resaved.bill_lines[0].line_id !== base9.bill_lines[0].line_id);
var edited = prod(run({ bills: [B1], lines: L1, receipts: [receipt('11', [log(101), log(102, { weight: '880' })])], links: [link('1', '11')] }))[0];
var st9 = W.decisionState([dAcc], fp(edited.inputs));
check('SOURCE CHANGE: a scan weight edited in the warehouse → Needs revalidation, the old decision kept', st9.state === 'needs_revalidation' && st9.decision.id === 'd1' && W.isOutstanding(st9.state));
var chg = W.diffInputs(base9.inputs, edited.inputs);
check('…and what changed is said in plain words (scan row 102 weight 900 → 880 lb)', chg.length === 1 && /scan row 102/.test(chg[0]) && /900 → 880/.test(chg[0]), chg);
var lineEdit = prod(run({ bills: [B1], lines: { '1': [line(1, 'Cambridge Seconds (LBS)', 2100, 'LBS')] }, receipts: [R2], links: [link('1', '11')] }))[0];
check('a bill line quantity changed → needs revalidation + "bill line … changed"', fp(lineEdit.inputs) !== fp0 && W.diffInputs(base9.inputs, lineEdit.inputs).some(function (s) { return /bill line/.test(s); }));
var mapEdit = prod(run({ bills: [B1], lines: L1, maps: [Object.assign({}, MAP_SEC, { version: 2 })], receipts: [R2], links: [link('1', '11')] }))[0];
check('a product mapping changed → needs revalidation', fp(mapEdit.inputs) !== fp0 && W.diffInputs(base9.inputs, mapEdit.inputs).some(function (s) { return /mapping/.test(s); }));
var dIss = { id: 'd2', kind: 'report_issue', at: '2026-11-21T11:00:00Z', comparison_fp: fp0 };
check('REPORTED ISSUE: stays outstanding (not approval) until resolved', W.decisionState([dIss], fp0).state === 'issue_open' && W.isOutstanding('issue_open'));
check('…resolve after an issue → resolved (not outstanding)', W.decisionState([dIss, { id: 'd3', kind: 'resolve', at: '2026-11-21T12:00:00Z', comparison_fp: fp0 }], fp0).state === 'resolved');
check('…a resolve without an open issue changes nothing', W.decisionState([{ id: 'd4', kind: 'resolve', at: '2026-11-21T12:00:00Z', comparison_fp: fp0 }], fp0).state === 'unreviewed');
check('REOPEN: reopening an accepted item → reopened (outstanding again), the history keeps both', W.decisionState([dAcc, { id: 'd5', kind: 'reopen', at: '2026-11-21T13:00:00Z' }], fp0).state === 'reopened' && W.decisionState([dAcc, { id: 'd5', kind: 'reopen', at: '2026-11-21T13:00:00Z' }], fp0).history.length === 2);
check('allowed decisions: Equal/Matched → Validate match or Report; discrepancy → Accept or Report; info rows → none', W.allowedDecisions('equal').join() === 'validate_match,report_issue' && W.allowedDecisions('discrepancy').join() === 'accept_discrepancy,report_issue' && W.allowedDecisions('warehouse_only').length === 0 && W.allowedDecisions('warehouse_unavailable').length === 0);

// ---------- 9b every decidable item has a fingerprint (an accepted 'cannot compare' still comes back when things change)
var cc = run({ bills: [B1], lines: { '1': [line(1, 'Cambridge Seconds', 3, 'CAM')] }, maps: [], receipts: [R1], links: [link('1', '11')] }).filter(function (i) { return i.outcome === 'cannot_compare'; })[0];
var cc2 = run({ bills: [B1], lines: { '1': [line(1, 'Cambridge Seconds', 4, 'CAM')] }, maps: [], receipts: [R1], links: [link('1', '11')] }).filter(function (i) { return i.outcome === 'cannot_compare'; })[0];
check('an unmapped line has a fingerprint; its quantity changing changes it (an accepted one would need revalidation)', cc.inputs && fp(cc.inputs) !== fp(cc2.inputs) && cc.item_key === cc2.item_key);
var un1 = W.unlinkedBillItem(bill('9'), W.proposeLinks(bill('9'), [receipt('91', [], { reference_number: '90000009' })]), true);
var un2 = W.unlinkedBillItem(bill('9'), W.proposeLinks(bill('9'), [receipt('91', [], { reference_number: '90000009' }), receipt('92', [], { info: { cgt_reference: '90000009' } })]), true);
check('a bill waiting for its link has a fingerprint; a new candidate receipt changes it', un1.inputs && fp(un1.inputs) !== fp(un2.inputs) && W.unlinkedBillItem(bill('8', { other_reference: null, bill_number: null }), { candidates: [] }, true).inputs.searched === 'no_reference');

// ---------- 9c Codex 11:12 P1 — overlapping product mappings never count the same scan twice
var MAP_BROAD = { id: 'mb', version: 1, state: 'active', vendor_key: W.vendorKey(NEX), item_key: 'vinyl', bill_unit: 'LBS', wh_product_type: '7', wh_label: 'Vinyl (any grade)' };
var R9c = receipt('51', [log(501)]); // ONE 1,000 lb scan: product 7, grade 2
var Lbs = [line(1, 'Vinyl (LBS)', 1000, 'LBS'), line(2, 'Cambridge Seconds (LBS)', 1000, 'LBS')];
var ov1 = prod(run({ bills: [B1], lines: { '1': Lbs }, maps: [MAP_BROAD, MAP_SEC], receipts: [R9c], links: [link('1', '51')] }));
var ov2 = prod(run({ bills: [B1], lines: { '1': Lbs.slice().reverse() }, maps: [MAP_BROAD, MAP_SEC], receipts: [R9c], links: [link('1', '51')] }));
check('MAPPING OVERLAP (Codex probe): broad "product 7 any grade" + specific "product 7 grade 2", ONE 1,000 lb scan, 2,000 lb billed → NEITHER is Equal; both blocked as a mapping conflict',
  ov1.length === 2 && ov1.every(function (i) { return i.outcome === 'mapping_conflict' && /counted twice/.test(i.reasons.join(' ')); }), ov1.map(function (i) { return [i.product_label, i.outcome, i.figures.received]; }));
check('…the same with the bill lines in reverse order', ov2.length === 2 && ov2.every(function (i) { return i.outcome === 'mapping_conflict'; }));
check('…a mapping conflict allows no decision at all (no Validate match, no Accept) and keeps the item outstanding', W.allowedDecisions('mapping_conflict').length === 0 && W.blockedState('mapping_conflict') === 'blocked' && W.isOutstanding('blocked'));
var MAP_OTHER = { id: 'mo', version: 1, state: 'active', vendor_key: W.vendorKey(NEX), item_key: 'vinyl', bill_unit: 'LBS', wh_product_type: '7', wh_cgt: '5', wh_label: 'Vinyl · grade 5' };
var ctl = prod(run({ bills: [B1], lines: { '1': Lbs }, maps: [MAP_OTHER, MAP_SEC], receipts: [receipt('52', [log(521), log(522, { cgt: '5' })])], links: [link('1', '52')] }));
check('CONTROL: two DISTINCT mappings (grade 2 / grade 5), one scan each → both Equal, each scan counted once', ctl.length === 2 && ctl.every(function (i) { return i.outcome === 'equal' && i.figures.received === 1000 && i.figures.scans === 1; }), ctl.map(function (i) { return [i.product_label, i.outcome]; }));
var agg = prod(run({ bills: [B1], lines: { '1': [line(1, 'Cambridge Seconds (LBS)', 600, 'LBS'), line(2, 'Cambridge Seconds (LBS)', 1400, 'LBS')] }, receipts: [R1], links: [link('1', '11')] }));
check('CONTROL: two lines of the SAME mapped product still add up (1 item, 2,000 lb)', agg.length === 1 && agg[0].figures.billed === 2000 && agg[0].outcome === 'equal');

// ---------- 10 report status (Codex 11:12 P1: completeness is apart from "can be decided now")
check('a report with open items never looks approved: "Open — 2 items outstanding"', W.reportStatus([{ needs_attention: true, state: 'unreviewed' }, { needs_attention: true, state: 'accepted' }, { needs_attention: true, state: 'issue_open' }, { needs_attention: false, state: 'unreviewed' }]).words === 'Open — 2 items outstanding');
check('…all decided → "Complete — every item decided"', W.reportStatus([{ needs_attention: true, state: 'accepted' }, { needs_attention: false, state: 'not_applicable' }]).complete === true);
check('UNAVAILABLE / LIMITED / BLOCKED keep a report OPEN and are counted apart: "Open — 3 items outstanding (3 not checked or blocked)"', W.reportStatus([{ needs_attention: true, state: 'not_checked' }, { needs_attention: true, state: 'limited' }, { needs_attention: true, state: 'blocked' }]).words === 'Open — 3 items outstanding (3 not checked or blocked)');
check('…every outcome except the information row needs attention; unavailable / limited cannot be decided now but are not done', W.needsAttention({ outcome: 'warehouse_unavailable' }) && W.needsAttention({ outcome: 'limited_access' }) && !W.needsAttention({ outcome: 'warehouse_only' }) && W.blockedState('warehouse_unavailable') === 'not_checked' && W.blockedState('limited_access') === 'limited' && W.defaultFilter({ needs_attention: true, state: 'not_checked' }));
check('CSV: a cell starting with = + - @ is defused; commas quoted', W.csvCell('=SUM(A1)') === "'=SUM(A1)" && W.csvCell('a,b') === '"a,b"');

console.log('\nXB: ' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
