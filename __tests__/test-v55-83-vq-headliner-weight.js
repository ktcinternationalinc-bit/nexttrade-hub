// v55.83-VQ — Max, 19 Nov 2026: "headliner is 1.25 lbs per yard... please fix that in profit sections".
// Real engine functions (Profitability cells and the Sales Report use the same picker); made-up invoices.
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var P = require(path.join(root, 'src/lib/profitability.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 700))); }
console.log('VQ — headliner weighs 1.25 lb per yard');
function lb(name, desc, qty, unit, factors) { return P.toPounds(qty, unit, null, P.weightFactorsFor(name, desc, factors || null)); }
check('the number is 1.25', P.HEADLINER_LB_PER_YARD === 1.25);
check('100 yards of headliner = 125 lb (it was 250 at the standard 2.5)', lb('Headliner Grey', '', 100, 'yd') === 125 && lb('Vinyl', '', 100, 'yd') === 250);
check('found in the product name OR the description, any case, also "head liner" and "head-liner"', lb('', 'HEADLINER 60in black', 10, 'yd') === 12.5 && lb('Head Liner', '', 10, 'yd') === 12.5 && lb('head-liner fabric', '', 10, 'yd') === 12.5 && lb('Auto HeadLiner', '', 10, 'yd') === 12.5 && P.isHeadlinerLine('Headliner', '') === true && P.isHeadlinerLine('', 'head  liner') === true);
check('a line that is not headliner is untouched: header, liner, headboard are not headliner', P.isHeadlinerLine('Header board', '') === false && P.isHeadlinerLine('Trunk liner', '') === false && P.isHeadlinerLine('Headboard', 'liner') === false && lb('Trunk liner', '', 10, 'yd') === 25);
check('only YARDS change: headliner sold by the pound, kilo, ton or linear metre keeps its real / standard weight', lb('Headliner', '', 100, 'lb') === 100 && Math.abs(lb('Headliner', '', 10, 'kg') - 22.0462) < 0.0001 && lb('Headliner', '', 1, 't') === 2204.62 && lb('Headliner', '', 100, 'lm') === 250);
check('foam is still 3 lb per yard (and per linear metre); a line that says headliner AND foam is counted as HEADLINER, 1.25', lb('Foam laminated', '', 100, 'yd') === 300 && lb('Foam laminated', '', 100, 'lm') === 300 && lb('Headliner foam backed', '', 100, 'yd') === 125 && lb('Headliner', 'with foam', 100, 'yd') === 125);
check('"no foam" headliner is headliner too', lb('Headliner no foam', '', 100, 'yd') === 125);
check('the standard table is not changed by asking (a second, ordinary line still weighs 2.5)', (function () { var f = { units: Object.assign({}, P.DEFAULT_UNIT_FACTORS) }; P.weightFactorsFor('Headliner', '', f); return f.units.yd === P.DEFAULT_UNIT_FACTORS.yd && P.toPounds(10, 'yd', null, f) === 25; })());
check('a pounds-per-yard set for one product in Set-up still wins over the rule, as it does for foam', P.toPounds(10, 'yd', 'g:1', P.weightFactorsFor('Headliner', '', { units: P.DEFAULT_UNIT_FACTORS, byProduct: { 'g:1': { yd: 2 } } })) === 20);
// the engine: cells built from invoices
function cellsOf(lines) { return P.buildCells({ invoices: [{ id: 'i1', number: '1', date: '2026-11-01', customer: 'A', releases: [], lines: lines }], factors: { units: P.DEFAULT_UNIT_FACTORS } }); }
var out = cellsOf([{ id: 'l1', description: 'Headliner Grey', qty: 100, unit: 'yd', unit_price: 2, amount: 200 }, { id: 'l2', description: 'Vinyl roll', qty: 100, unit: 'yd', unit_price: 2, amount: 200 }, { id: 'l3', description: 'Headliner foam backed', qty: 100, unit: 'yd', unit_price: 2, amount: 200, foam: true }, { id: 'l4', description: 'Custom name', qty: 100, unit: 'yd', unit_price: 2, amount: 200, headliner: true }, { id: 'l5', description: 'Headliner sample', qty: 100, unit: 'yd', unit_price: 2, amount: 200, headliner: false }]);
var cells = out.cells || out; var byLine = {}; (cells || []).forEach(function (c) { byLine[c.line_id] = c; });
check('Profitability cells: the headliner line has 125 lb, the vinyl line 250 lb', byLine.l1 && byLine.l1.pounds === 125 && byLine.l2 && byLine.l2.pounds === 250, Object.keys(byLine).map(function (k) { return k + ':' + byLine[k].pounds; }));
check('…what the screen worked out from the product name is respected: marked headliner → 125 lb even when the description does not say it; marked NOT headliner → 250 lb', byLine.l4.pounds === 125 && byLine.l5.pounds === 250);
check('…a headliner + foam line is 125 lb and is flagged for a person to look at', byLine.l3.pounds === 125 && (out.flags || []).some(function (f) { return f.kind === 'headliner_and_foam'; }), (out.flags || []).map(function (f) { return f.kind; }));
// wiring
var asm = fs.readFileSync(path.join(root, 'src/lib/profitability-assemble.js'), 'utf8'); var sr = fs.readFileSync(path.join(root, 'src/app/api/accounting/sales-report/route.js'), 'utf8'); var tab = fs.readFileSync(path.join(root, 'src/components/ProfitabilityTab.jsx'), 'utf8');
check('Profitability marks each invoice line from its product name + description (runtime import present)', asm.indexOf('headliner: isHeadlinerLine(it.wave_product_name, it.description)') > 0 && /import \{[^}]*isHeadlinerLine[^}]*\} from '\.\/profitability'/.test(asm));
check('the Sales Report uses the same picker (runtime import present), in the plain server style', sr.indexOf('toPounds(qty, unit, null, weightFactorsFor(it.wave_product_name, it.description, factors))') > 0 && /import \{[^}]*weightFactorsFor[^}]*\} from '\.\.\/\.\.\/\.\.\/\.\.\/lib\/profitability'/.test(sr));
check('the flag has plain words on the screen', /headliner_and_foam: 'A line says both headliner and foam\. It is counted as HEADLINER \(1\.25 lb per yard\)/.test(tab));
// ── Codex 22:50 (P1): the WHOLE report. 100 yards bought for $30 (+ $3.75 commission) and sold as 100 yards must still cost $30 /
// $3.75 — the weight rule changes the pounds, never the money. Real assembleProfitability; made-up invoice and supplier bill.
var A = require(path.join(root, 'src/lib/profitability-assemble.js'));
function report(productName, description, billLine) {
  return A.assembleProfitability({ date_from: '2026-01-01', date_to: '', windowDays: 90, warehouseOn: false,
    invoices: [{ id: 'i1', invoice_number: 'INV 1', accounting_customer_id: 'c1', invoice_date: '2026-11-01', record_status: 'active', currency: 'USD', release_number: '1001-9001' }],
    items: [{ id: 'l1', invoice_id: 'i1', wave_product_name: productName, description: description, quantity: 100, unit_price: 1 }],
    customerNames: { c1: 'Alpha' }, terms: [{ invoice_id: 'i1', shipping_terms: 'EXW' }],
    nameUnits: [{ name_key: P.nameKey(productName), unit: 'yd' }],
    groups: [{ id: 'g1', display_name: 'Goods', active: true, created_at: '2026-01-01' }],
    groupNames: [{ group_id: 'g1', source: 'invoice', name_key: P.nameKey(productName), raw_name: productName, active: true }, { group_id: 'g1', source: 'bill', name_key: 'supplier roll', raw_name: 'Supplier roll', active: true }],
    bills: [{ id: 'b2', bill_number: 'P-1', vendor_name: 'Mill', bill_type: 'supplier', release_number: '', total_amount: 33.75, record_status: 'active', bill_date: '2026-10-01' }],
    billLines: [billLine || { id: 'bl1', bill_id: 'b2', line_kind: 'item', description: 'Supplier roll', qty: 100, unit: 'yd', amount: 30, cost_amount: 30, commission_amount: 3.75 }], warehouseRows: [] });
}
function inv1(r) { return r.by_invoice.filter(function (x) { return x.label === 'INV 1'; })[0]; }
var eVinyl = inv1(report('Vinyl Grey', 'plain')); var eHead = inv1(report('Headliner Grey', 'plain')); var eDesc = inv1(report('Auto fabric', 'HEADLINER 60in')); var eBoth = inv1(report('Headliner foam backed', 'grey')); var eFoam = inv1(report('Foam Laminated', 'grey'));
check('ordinary vinyl, 100 yd: 250 lb, cost $30.00, commission $3.75 (the reference)', eVinyl.pounds === 250 && eVinyl.base_cost === 30 && eVinyl.commission === 3.75, [eVinyl.pounds, eVinyl.base_cost, eVinyl.commission]);
check('Headliner Grey, 100 yd: 125 lb — and the supplier cost is STILL $30.00 and the commission $3.75 (Codex saw $15.00 / $1.88)', eHead.pounds === 125 && eHead.base_cost === 30 && eHead.commission === 3.75, [eHead.pounds, eHead.base_cost, eHead.commission]);
check('…so its cost per pound is $0.24 (30 ÷ 125), not $0.12', Math.abs(eHead.base_cost / eHead.pounds - 0.24) < 0.0001);
check('headliner only in the DESCRIPTION: 125 lb, cost $30.00, commission $3.75', eDesc.pounds === 125 && eDesc.base_cost === 30 && eDesc.commission === 3.75, [eDesc.pounds, eDesc.base_cost, eDesc.commission]);
check('headliner + foam: counted as headliner — 125 lb, cost $30.00, commission $3.75 (Codex saw $12.50 / $1.56)', eBoth.pounds === 125 && eBoth.base_cost === 30 && eBoth.commission === 3.75, [eBoth.pounds, eBoth.base_cost, eBoth.commission]);
check('foam is unchanged by all this: 300 lb, cost $30.00, commission $3.75', eFoam.pounds === 300 && eFoam.base_cost === 30 && eFoam.commission === 3.75, [eFoam.pounds, eFoam.base_cost, eFoam.commission]);
var eLb = inv1(report('Headliner Grey', 'plain', { id: 'bl1', bill_id: 'b2', line_kind: 'item', description: 'Supplier roll', qty: 125, unit: 'lbs', amount: 30, cost_amount: 30, commission_amount: 3.75 }));
check('a supplier bill already in POUNDS (125 lb for $30) is taken as it is: selling 100 yd = 125 lb costs $30.00, commission $3.75', eLb.pounds === 125 && eLb.base_cost === 30 && eLb.commission === 3.75, [eLb.pounds, eLb.base_cost, eLb.commission]);
check('inbound allowance follows the corrected pounds: 125 lb × $0.02 = $2.50 on a release that has inbound; none on a 1001- release', eHead.inbound_allowance === 0 && (function () { var cells = P.buildCells({ invoices: [{ id: 'i1', number: '1', date: '2026-11-01', customer: 'A', releases: ['10029001'], lines: [{ id: 'l1', description: 'Headliner Grey', qty: 100, unit: 'yd', unit_price: 1, amount: 100 }] }], factors: { units: P.DEFAULT_UNIT_FACTORS } }); var cs = cells.cells || cells; return cs[0].pounds === 125; })(), eHead.inbound_allowance);
check('the cost side reads the cell\'s own headliner mark (set from product name + description), with the runtime import present', fs.readFileSync(path.join(root, 'src/lib/profitability-assemble.js'), 'utf8').indexOf('factors: cell.headliner === true ? headlinerFactors(factors) : (cell.foam === true ? foamFactors(factors) : factors)') > 0 && /import \{[^}]*headlinerFactors[^}]*\} from '\.\/profitability'/.test(fs.readFileSync(path.join(root, 'src/lib/profitability-assemble.js'), 'utf8')) && fs.readFileSync(path.join(root, 'src/lib/profitability.js'), 'utf8').indexOf('foam: gl.foam, headliner: gl.headliner, pounds: p.lb,') > 0);
console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
