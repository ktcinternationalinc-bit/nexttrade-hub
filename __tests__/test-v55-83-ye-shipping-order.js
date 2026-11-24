// v55.83-YE — Max, 23 Nov 2026, the order for a release's shipping cost: "The first thing that always overrides everything is going
// to be the actual bill ... The shipping costs, the invoices shipping cost box, whenever it's filled, that becomes the first thing ...
// besides the actual [bill] ... whatever's in the next trade warehouse estimate, you use that third. And then the fourth would be typed
// by hand in either the hub or in the P&L boxes." Runs the REAL assembleProfitability (no database) for every ordering case, the
// worked example, and the four settled points (a)–(d). All values are made up.
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var A = require(path.join(root, 'src/lib/profitability-assemble.js')); var PR = require(path.join(root, 'src/lib/profitability.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 900))); }
var REL = '1001-9001'; var RK = PR.relKey(REL);
function bill(type, amount, num, rel) { return { id: 'b-' + num, vendor_name: type === 'trucking' ? 'Kronos' : 'Ocean Co', bill_number: num, bill_date: '2026-06-12', total_amount: amount, record_status: 'active', bill_type: type, shipment_direction: 'outbound', release_number: rel || REL }; }
function wh(o, rel) { return Object.assign({ id: 'w1', section: 'main', superseded: false, conflict: false, order_id: 'o1', release_number: rel || REL, release_key: PR.relKey(rel || REL), status: 'open', manual_trucking: null, manual_freight: null, trucking_used: null, freight_used: null, trucking_kind: null, freight_kind: null, trucking_estimate: null, freight_estimate: null, trucking_final: null, freight_final: null }, o || {}); }
function run(o) {
  var invs = o.invoices || [{ id: 'i1', invoice_number: 'INV 1', accounting_customer_id: 'c1', invoice_date: '2026-06-10', record_status: 'active', currency: 'USD', release_number: REL }];
  var items = o.items || invs.map(function (iv, n) { return { id: 'l' + n, invoice_id: iv.id, wave_product_name: 'Paper', description: 'Paper', quantity: 100, unit_price: 10 }; });
  var terms = o.terms || invs.map(function (iv) { return { invoice_id: iv.id, shipping_terms: 'CNF_SEPARATE', shipping_cost_estimate: o.box === undefined ? null : o.box }; });
  return A.assembleProfitability({ date_from: '2026-01-01', date_to: '', windowDays: 90, warehouseOn: !!(o.warehouseRows && o.warehouseRows.length),
    invoices: invs, items: items, customerNames: { c1: 'Alpha' }, terms: terms, nameUnits: [{ name_key: PR.nameKey('Paper'), unit: 'lb' }], groups: [], groupNames: [],
    bills: o.bills || [], billLines: [], warehouseRows: o.warehouseRows || [], estimates: o.estimates || [], partEstimates: o.partEstimates || [], lineReleasePounds: o.lineReleasePounds || [] });
}
function cost(r, rel) { var c = (r.containers || []).filter(function (x) { return x.key === PR.relKey(rel || REL); })[0]; return c ? (c.shipping_actual !== null && c.shipping_actual !== undefined ? c.shipping_actual : c.shipping_estimate) : undefined; }
function cont(r, rel) { return (r.containers || []).filter(function (x) { return x.key === PR.relKey(rel || REL); })[0]; }
function cell(r) { return (r.cells || [])[0]; }
function typed(part, amount) { return { release_key: RK, part: part, amount: amount }; }

// ── THE ORDER: 1 bill, 2 invoice box, 3 warehouse (correction, then Shipping In Progress), 4 typed by hand
var r1 = run({ box: 4000, bills: [bill('trucking', 1500, 'T1'), bill('shipping', 2000, 'S1')], warehouseRows: [wh({ trucking_used: 900, freight_used: 2500 })], partEstimates: [typed('trucking', 700), typed('freight', 2200)] });
check('1 BILL beats everything: both parts billed (1,500 + 2,000) → 3,500 FINAL, whatever the box (4,000), warehouse or typed figures say', cost(r1) === 3500 && cont(r1).shipping_actual === 3500, cont(r1));
var r1b = run({ box: 4000, bills: [bill('trucking', 1500, 'T1'), bill('shipping', 2900, 'S1')] });
check('…a bill that comes in LATER and differs still wins: billed 4,400 replaces the box 4,000', cost(r1b) === 4400, cont(r1b));
var r2 = run({ box: 4000, warehouseRows: [wh({ trucking_used: 900, freight_used: 2500 })], partEstimates: [typed('trucking', 700), typed('freight', 2200)] });
check('2 BOX beats the warehouse and typed figures: no bill → 4,000 (not 3,400 warehouse, not 2,900 typed), an estimate, from the invoice form', cost(r2) === 4000 && cont(r2).shipping_actual === null && cont(r2).parts.combined_estimate_from === 'invoice form' && cont(r2).parts.estimate_total === 4000, cont(r2) && cont(r2).parts);
check('…with the box filled no part shows its own estimate (the box is ONE amount for both); the cell says the total is not divided', cont(r2).parts.trucking.estimate === null && cont(r2).parts.freight.estimate === null && cell(r2).outbound_cost === 4000 && cell(r2).shipping_total_unsplit === 4000, [cont(r2).parts.trucking, cell(r2).shipping_total_unsplit]);
var r3 = run({ warehouseRows: [wh({ trucking_used: 900, freight_used: 2500 })], partEstimates: [typed('trucking', 700), typed('freight', 2200)] });
check('3 (rev2) TYPED BY HAND beats the warehouse: box empty, no bill → typed 700 + 2,200 = 2,900 (not the warehouse 3,400)', cost(r3) === 2900 && cell(r3).trucking_cost === 700 && cell(r3).freight_cost === 2200, [cost(r3), cell(r3).trucking_cost, cell(r3).freight_cost]);
check('…the Containers list says the same: each part typed in the Hub (700 + 2,200 = 2,900)', cont(r3).parts.trucking.estimate === 700 && cont(r3).parts.trucking.estimate_from === 'typed in the Hub' && cont(r3).parts.estimate_total === 2900, cont(r3).parts);
var r3w = run({ warehouseRows: [wh({ trucking_used: 900, freight_used: 2500 })] });
check('4 (rev2) the WAREHOUSE is used when nothing above it exists: 900 + 2,500 = 3,400, said "warehouse"', cost(r3w) === 3400 && cont(r3w).parts.trucking.estimate_from === 'warehouse', cont(r3w).parts);
var r4 = run({ partEstimates: [typed('trucking', 700), typed('freight', 2200)] });
check('typed by hand alone: 700 + 2,200 = 2,900, said "typed in the Hub"', cost(r4) === 2900 && cont(r4).parts.trucking.estimate_from === 'typed in the Hub' && cont(r4).parts.combined_estimate_from === 'typed in the Hub', cont(r4).parts);
var r4b = run({ warehouseRows: [wh({ trucking_used: 900 })], partEstimates: [typed('freight', 2200)] });
check('…per part: trucking from the warehouse (900, nothing typed for it), freight typed by hand (2,200) → 3,100', cost(r4b) === 3100 && cell(r4b).trucking_cost === 900 && cell(r4b).freight_cost === 2200, [cost(r4b), cell(r4b).trucking_cost, cell(r4b).freight_cost]);
var r4c = run({ warehouseRows: [wh({ trucking_used: 900, freight_used: 2500 })], partEstimates: [typed('trucking', 0)] });
check('(rev2) a warehouse estimate is there, then a person TYPES $0 for trucking → trucking $0 (the typed figure wins), cost 0 + 2,500', cell(r4c).trucking_cost === 0 && cost(r4c) === 2500, [cell(r4c).trucking_cost, cost(r4c)]);
var r4z = run({ warehouseRows: [wh({ trucking_used: 900, freight_used: 2500 })], partEstimates: [typed('trucking', 0), typed('freight', 0)] });
check('(rev2) …both parts typed $0 over warehouse estimates → $0 (a person said so)', cost(r4z) === 0 && cell(r4z).outbound_cost === 0, cost(r4z));
var r4d = run({ bills: [bill('trucking', 1600, 'T9')], warehouseRows: [wh({ trucking_used: 900, freight_used: 2500 })], partEstimates: [typed('freight', 2200)] });
check('…a bill for one part + the typed figure for the other (box empty): 1,600 + 2,200 = 3,800, an estimate (freight not billed)', cost(r4d) === 3800 && cont(r4d).shipping_actual === null, cont(r4d));

// ── (a) the box is ONE combined amount; bills are per part — the VS rule with the box as the combined amount
var ra = run({ box: 4000, bills: [bill('trucking', 1500, 'T1')] });
check('(a) MAX\'S EXAMPLE: box 4,000, trucking bill 1,500, no freight bill → the cost stays 4,000 (estimate): trucking 1,500 from the bill + 2,500 combined, not separated', cost(ra) === 4000 && cont(ra).shipping_actual === null && cell(ra).trucking_cost === 1500 && cell(ra).trucking_kind === 'bill' && cell(ra).freight_cost === null && cell(ra).shipping_total_unsplit === 2500, [cost(ra), cell(ra).trucking_cost, cell(ra).freight_cost, cell(ra).shipping_total_unsplit]);
var ra2 = run({ box: 4000, bills: [bill('trucking', 5000, 'T1')] });
check('(a) …the one bill alone LARGER than the box (5,000 > 4,000) → the bill wins (5,000) and it is flagged', cost(ra2) === 5000 && (ra2.flags || []).some(function (f) { return f.kind === 'part_exceeds_combined_total' && f.part_amount === 5000 && f.combined_total === 4000; }), [cost(ra2), ra2.flags]);
var ra3 = run({ box: 4000, bills: [bill('trucking', 1500, 'T1')], warehouseRows: [wh({ freight_used: 3500 })], partEstimates: [typed('freight', 2800)] });
check('(a) …with the box filled, the warehouse (3,500) and typed (2,800) freight are NOT added beside the trucking bill — still 4,000', cost(ra3) === 4000 && cell(ra3).freight_cost === null, [cost(ra3), cell(ra3).freight_cost]);

// ── (b) "Inside the shipping" parts typed on the invoice fill the box (XV); when the box is changed afterwards the box wins, said
var rb = run({ box: 3000, partEstimates: [typed('trucking', 700), typed('freight', 2200)] });
check('(b) typed parts 700 + 2,200 = 2,900 but the box says 3,000 → the box (3,000) is used and the difference is flagged', cost(rb) === 3000 && (rb.flags || []).some(function (f) { return f.kind === 'typed_parts_differ_from_invoice_box' && f.box === 3000 && f.typed_trucking === 700 && f.typed_freight === 2200; }), [cost(rb), rb.flags]);
var rb2 = run({ box: 2900, partEstimates: [typed('trucking', 700), typed('freight', 2200)] });
check('(b) …when they agree (2,900 = 2,900) nothing is flagged', cost(rb2) === 2900 && !(rb2.flags || []).some(function (f) { return f.kind === 'typed_parts_differ_from_invoice_box'; }), rb2.flags);

// ── (c) the warehouse's typed correction comes before Shipping In Progress (both are the warehouse, 3rd)
var rc = run({ warehouseRows: [wh({ manual_trucking: 1100, trucking_used: 900, freight_used: 2500 })] });
check('(c) within the warehouse: its typed correction (1,100) beats Shipping In Progress (900)', cell(rc).trucking_cost === 1100 && cost(rc) === 3600, [cell(rc).trucking_cost, cost(rc)]);
var rcT = run({ warehouseRows: [wh({ manual_trucking: 1100, trucking_used: 900, freight_used: 2500 })], partEstimates: [typed('trucking', 700)] });
check('(rev2) …and a figure typed in the Hub (700) beats both', cell(rcT).trucking_cost === 700 && cost(rcT) === 3200, [cell(rcT).trucking_cost, cost(rcT)]);
var rc2 = run({ box: 2000, warehouseRows: [wh({ manual_trucking: 1100, freight_used: 2500 })] });
check('(c) …and the box (2,000) still beats a warehouse correction', cost(rc2) === 2000, cost(rc2));

// ── (d) the split rules stay
var REL2 = '1001-9002';
var twoRel = run({ invoices: [{ id: 'i1', invoice_number: 'INV 1', accounting_customer_id: 'c1', invoice_date: '2026-06-10', record_status: 'active', currency: 'USD', release_number: REL + ' & ' + REL2 }], box: 3000,
  lineReleasePounds: [{ invoice_item_id: 'l0', release_key: RK, pounds: 100 }, { invoice_item_id: 'l0', release_key: PR.relKey(REL2), pounds: 200 }] });
check('(d) one invoice over two releases whose split cannot be worked out: flagged "split unresolved" and NO cost is made up for either release — exactly as before (the box is never put whole on one release)', (twoRel.flags || []).some(function (f) { return f.kind === 'invoice_shipping_estimate_split_unresolved' && f.amount === 3000; }) && (cost(twoRel, REL) === null || cost(twoRel, REL) === undefined) && (cost(twoRel, REL2) === null || cost(twoRel, REL2) === undefined), [cost(twoRel, REL), cost(twoRel, REL2), twoRel.flags]);
var SH = require(path.join(root, 'src/lib/shipping-terms.js'));
var sp = SH.invoiceEstimatesByRelease ? SH.invoiceEstimatesByRelease([{ invoice_id: 'i1', invoice_number: 'INV 1', shipping_terms: 'CNF_SEPARATE', shipping_cost_estimate: 3000, releases: [RK, PR.relKey(REL2)] }], (function () { var m = {}; m[RK] = 100; m[PR.relKey(REL2)] = 200; return m; })()) : null;
check('(d) …the split itself is the same unchanged function: 3,000 over 100 / 200 lb → 1,000 / 2,000', !sp || (sp[RK] && sp[RK].amount === 1000 && sp[PR.relKey(REL2)] && sp[PR.relKey(REL2)].amount === 2000), sp);
var twoInv = run({ invoices: [{ id: 'i1', invoice_number: 'INV 1', accounting_customer_id: 'c1', invoice_date: '2026-06-10', record_status: 'active', currency: 'USD', release_number: REL }, { id: 'i2', invoice_number: 'INV 2', accounting_customer_id: 'c1', invoice_date: '2026-06-11', record_status: 'active', currency: 'USD', release_number: REL }],
  terms: [{ invoice_id: 'i1', shipping_terms: 'CNF_SEPARATE', shipping_cost_estimate: 3000 }, { invoice_id: 'i2', shipping_terms: 'CNF_SEPARATE', shipping_cost_estimate: 3500 }] });
check('(d) two invoices on one release with different boxes (3,000 / 3,500): flagged, one is used, as before', (twoInv.flags || []).some(function (f) { return f.kind === 'invoice_shipping_estimates_differ'; }) && (cost(twoInv) === 3000 || cost(twoInv) === 3500), [cost(twoInv), twoInv.flags]);
var exw = run({ terms: [{ invoice_id: 'i1', shipping_terms: 'EXW', shipping_cost_estimate: null }] });
check('(d) EXW with no shipping line and nothing else = a known 0, as before', cost(exw) === 0, cost(exw));
var exw2 = run({ terms: [{ invoice_id: 'i1', shipping_terms: 'EXW', shipping_cost_estimate: null }], warehouseRows: [wh({ trucking_used: 900, freight_used: 2500 })] });
check('(rev2) EXW with no shipping line + a warehouse estimate (3,400, from before the customer took the shipping over) → $0, said "EXW — the customer ships it"', cost(exw2) === 0 && cont(exw2).parts.combined_estimate_from === 'EXW — the customer ships it', [cost(exw2), cont(exw2).parts.combined_estimate_from]);
var exw3 = run({ terms: [{ invoice_id: 'i1', shipping_terms: 'EXW', shipping_cost_estimate: null }], warehouseRows: [wh({ trucking_used: 900, freight_used: 2500 })], bills: [bill('shipping', 1800, 'S7')] });
check('(rev2) …then a FREIGHT BILL arrives (1,800) → the bill is the cost (trucking stays $0, the customer’s)', cost(exw3) === 1800 && cell(exw3).freight_cost === 1800 && cell(exw3).trucking_cost === 0, [cost(exw3), cell(exw3).freight_cost, cell(exw3).trucking_cost]);
var exw4 = run({ terms: [{ invoice_id: 'i1', shipping_terms: 'EXW', shipping_cost_estimate: 1200 }], partEstimates: [typed('freight', 900)] });
check('(rev2) EXW no line with a box (1,200) and a typed freight (900) → still $0, flagged "amount on a release the customer ships himself" so a person looks', cost(exw4) === 0 && (exw4.flags || []).some(function (f) { return f.kind === 'amount_on_customer_shipped_release' && f.box === 1200 && f.typed_freight === 900; }), [cost(exw4), exw4.flags]);
var exwMix = run({ invoices: [{ id: 'i1', invoice_number: 'INV 1', accounting_customer_id: 'c1', invoice_date: '2026-06-10', record_status: 'active', currency: 'USD', release_number: REL }, { id: 'i2', invoice_number: 'INV 2', accounting_customer_id: 'c1', invoice_date: '2026-06-11', record_status: 'active', currency: 'USD', release_number: REL }], terms: [{ invoice_id: 'i1', shipping_terms: 'EXW', shipping_cost_estimate: null }, { invoice_id: 'i2', shipping_terms: 'CNF_SEPARATE', shipping_cost_estimate: null }], warehouseRows: [wh({ trucking_used: 900, freight_used: 2500 })] });
check('(rev2) several invoices, only SOME EXW → we ship part of it → the normal order (warehouse 3,400), no $0', cost(exwMix) === 3400, cost(exwMix));
var rt = run({ estimates: [{ release_key: RK, outbound_estimate: 1000 }], partEstimates: [typed('trucking', 300)] });
check('the total typed for the release (hand-typed, 4th) keeps the VS rule with a hand-typed part: 1,000 stays the cost, trucking 300, 700 not separated', cost(rt) === 1000 && cell(rt).trucking_cost === 300 && cell(rt).shipping_total_unsplit === 700, [cost(rt), cell(rt).trucking_cost]);
var rt2 = run({ box: 2500, estimates: [{ release_key: RK, outbound_estimate: 1000 }] });
check('…and the invoice box (2nd) beats the total typed for the release (4th): 2,500, not 1,000', cost(rt2) === 2500, cost(rt2));

// ── Max, 23 Nov (2nd message): "if something's not available ... it goes to the second ... the third ... the fourth ... It should never be
// empty ... It'll then ask for an input ... if at any point one of these other things supersedes and becomes available, then it overwrites it"
var P = require(path.join(root, 'src/lib/pnl-period.js'));
function shipTasks(r) { return (P.openTasks(r.cells || []).tasks || []).filter(function (k) { return k.kind === 'trucking' || k.kind === 'freight'; }); }
// 1 the fallback chain, one level at a time
var chain = [
  ['bill', { box: 4000, bills: [bill('trucking', 1500, 'T1'), bill('shipping', 2000, 'S1')], warehouseRows: [wh({ trucking_used: 900, freight_used: 2500 })], partEstimates: [typed('trucking', 700), typed('freight', 2200)] }, 3500],
  ['box', { box: 4000, warehouseRows: [wh({ trucking_used: 900, freight_used: 2500 })], partEstimates: [typed('trucking', 700), typed('freight', 2200)] }, 4000],
  ['typed', { warehouseRows: [wh({ trucking_used: 900, freight_used: 2500 })], partEstimates: [typed('trucking', 700), typed('freight', 2200)] }, 2900],
  ['warehouse', { warehouseRows: [wh({ trucking_used: 900, freight_used: 2500 })] }, 3400]
];
var chainBad = chain.filter(function (c) { return cost(run(c[1])) !== c[2]; }).map(function (c) { return c[0]; });
check('FALLBACK CHAIN (rev2): bill (3,500) → when no bill, the box (4,000) → when no box, typed by hand (2,900) → when nothing typed, the warehouse (3,400)', chainBad.length === 0, chainBad);
// 2 never silently empty: nothing anywhere → missing, NOT $0, and the open-task list asks for an input
var none = run({});
check('NEVER SILENTLY EMPTY: all four have nothing → the release is MISSING (no cost, not $0) and the open-task list ASKS for the trucking and the freight', cost(none) === null && cont(none).status === 'missing' && cell(none).outbound_cost === null && shipTasks(none).length >= 1 && shipTasks(none).every(function (k) { return k.action === 'type' || k.action === 'fix' || !!k.action; }), [cost(none), cont(none) && cont(none).status, cell(none).outbound_cost, shipTasks(none)]);
check('…the only known $0 is EXW with no shipping line (no task asked)', cost(exw) === 0 && shipTasks(exw).length === 0, [cost(exw), shipTasks(exw)]);
// 3 always the best source available NOW — worked out fresh from what exists each time (nothing kept from an earlier run)
var whOnly = { warehouseRows: [wh({ trucking_used: 900, freight_used: 2500 })] };
var s1 = run(whOnly); var s2 = run(Object.assign({}, whOnly, { bills: [bill('trucking', 1600, 'T5'), bill('shipping', 2700, 'S5')] }));
check('OVERRIDE AT ONCE: the warehouse estimate (3,400) is used; a bill is entered → the bill (4,300) is the cost at once, final', cost(s1) === 3400 && cost(s2) === 4300 && cont(s2).shipping_actual === 4300, [cost(s1), cost(s2)]);
var h1 = run({ partEstimates: [typed('trucking', 700), typed('freight', 2200)] }); var h2 = run({ box: 3600, partEstimates: [typed('trucking', 700), typed('freight', 2200)] });
check('OVERRIDE AT ONCE: typed by hand (2,900) is used; the invoice box is filled → the box (3,600) is the cost at once', cost(h1) === 2900 && cost(h2) === 3600, [cost(h1), cost(h2)]);
var v1 = Object.assign({}, whOnly, { bills: [bill('trucking', 1600, 'T5'), bill('shipping', 2700, 'S5')] }); var v2 = JSON.parse(JSON.stringify(v1)); v2.bills.forEach(function (b) { b.record_status = 'void'; });
check('AND THE REVERSE: the bills are voided → the cost falls back down the chain to the warehouse (3,400)', cost(run(v1)) === 4300 && cost(run(v2)) === 3400, [cost(run(v1)), cost(run(v2))]);
var bx2 = JSON.parse(JSON.stringify({ box: 3600, partEstimates: [typed('trucking', 700), typed('freight', 2200)] })); bx2.box = null;
check('…the invoice box emptied again → back to the typed figures (2,900)', cost(run(bx2)) === 2900, cost(run(bx2)));
var srcs = fs.readFileSync(path.join(root, 'src/app/api/hub-feed/product-costs/route.js'), 'utf8') + fs.readFileSync(path.join(root, 'src/app/api/accounting/pnl/route.js'), 'utf8');
check('NOTHING FROZEN: the P&L and the warehouse cost feed run the same engine on every request (no stored copy); the feed is sent "no-store"', /assembleProfitability\(/.test(fs.readFileSync(path.join(root, 'src/app/api/hub-feed/product-costs/route.js'), 'utf8')) && /assembleProfitability\(/.test(fs.readFileSync(path.join(root, 'src/app/api/accounting/pnl/route.js'), 'utf8')) && /no-store/.test(srcs) && !/from\('pl_[a-z_]+'\)\.(insert|upsert|update)\([^)]*(outbound|shipping_cost|cost_used)/.test(srcs));
// 4 the screen says where the figure came from
check('SOURCE SHOWN: bill → billed parts; box → "invoice form"; typed → "typed in the Hub"; warehouse → "warehouse"; EXW → "EXW — the customer ships it"', cont(r1).parts.trucking.bill === 1500 && cont(r2).parts.combined_estimate_from === 'invoice form' && cont(r3w).parts.trucking.estimate_from === 'warehouse' && cont(r4).parts.trucking.estimate_from === 'typed in the Hub' && cell(ra).trucking_kind === 'bill' && cont(exw2).parts.freight.estimate_from === 'EXW — the customer ships it', [cont(r2).parts.combined_estimate_from, cont(r3w).parts.trucking.estimate_from, cont(r4).parts.trucking.estimate_from]);

console.log('\nYE: ' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
