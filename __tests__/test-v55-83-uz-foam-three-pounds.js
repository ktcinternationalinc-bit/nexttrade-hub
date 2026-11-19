// v55.83-UZ (Max, Nov 19 2026): "for foam laminated or anything with foam the weight is 3 LBS per yard".
// Runs the REAL engine (profitability.js + profitability-assemble.js) — pure functions, no database.
var path = require('path');
var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var P = require(path.join(root, 'src/lib/profitability.js'));
var A = require(path.join(root, 'src/lib/profitability-assemble.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 900))); }
console.log('UZ — anything with foam weighs 3 lb per yard');

check('the rule: 3 lb per yard', P.FOAM_LB_PER_YARD === 3);
check('"Foam Laminated", "FOAM-LAMINATED 3MM", "Velvet with foam backing", "foamed PVC" are foam; "Velvet", "Form paper", "" are not',
  ['Foam Laminated', 'FOAM-LAMINATED 3MM', 'Velvet with foam backing', 'foamed PVC'].every(P.isFoamName) && !P.isFoamName('Velvet') && !P.isFoamName('Form paper') && !P.isFoamName('') && !P.isFoamName(null));
var ff = P.foamFactors({ units: { lb: 1, kg: 2.20462, t: 2204.62, yd: 2.4, lm: 2.6 } });
check('foam factors: yards and linear metres 3 (VB: "YES FOAM ALL 3 LBS"); pounds, kilos and tons unchanged', ff.units.yd === 3 && ff.units.lm === 3 && ff.units.lb === 1 && ff.units.kg === 2.20462 && ff.units.t === 2204.62, ff);
var orig = { units: { yd: 2.5, lm: 2.5, lb: 1 } }; P.foamFactors(orig);
check('the general factors are not changed by it (a copy is made)', orig.units.yd === 2.5 && orig.units.lm === 2.5);
check('no factors given → defaults with yards 3', P.foamFactors().units.yd === 3 && P.foamFactors().units.kg === 2.20462);

// ── the engine: two lines on one invoice, both 1,000 yards
function cellsOf(lines, extra) {
  return P.buildCells(Object.assign({ invoices: [{ id: 'i1', number: 'INV 1', date: '2026-11-01', customer: 'C', basis: 'EXW', releases: ['1002-9001'], lines: lines }] }, extra || {})).cells;
}
var c1 = cellsOf([{ id: 'a', description: 'Foam Laminated Velvet', qty: 1000, unit: 'Yards', unit_price: 2 }, { id: 'b', description: 'Plain Velvet', qty: 1000, unit: 'Yards', unit_price: 2 }]);
check('1,000 yards of "Foam Laminated Velvet" = 3,000 lb (factor 3)', c1[0].pounds === 3000 && c1[0].unit_factor === 3 && c1[0].foam === true, c1[0]);
check('1,000 yards of "Plain Velvet" = 2,500 lb (unchanged, factor 2.5)', c1[1].pounds === 2500 && c1[1].unit_factor === 2.5 && c1[1].foam === false, c1[1]);
var c2 = cellsOf([{ id: 'a', description: 'FOAM 5MM', qty: 100, unit: 'LM', unit_price: 1 }, { id: 'b', description: 'Foam scrap', qty: 100, unit: 'lbs', unit_price: 1 }, { id: 'c', description: 'Foam blocks', qty: 100, unit: 'kg', unit_price: 1 }, { id: 'd', description: 'Foam bales', qty: 1, unit: 'ton', unit_price: 1 }]);
check('foam in linear metres = 3 lb each (VB); foam sold by pounds / kilos / tons keeps its real weight', c2[0].pounds === 300 && c2[1].pounds === 100 && Math.abs(c2[2].pounds - 220.462) < 1e-9 && c2[3].pounds === 2204.62, c2.map(function (c) { return c.pounds; }));
var c3 = cellsOf([{ id: 'a', description: 'Foam Laminated', qty: 10, unit: '', unit_price: 1 }]);
check('foam with NO unit set stays unknown (never guessed as yards)', c3[0].pounds === null && c3[0].flags.indexOf('unit_unknown') >= 0, c3[0]);
var c4 = cellsOf([{ id: 'a', description: 'Foam Laminated', qty: 1000, unit: 'yd', unit_price: 2 }, { id: 'b', description: 'Plain Velvet', qty: 1000, unit: 'yd', unit_price: 2 }], { factors: { units: { yd: 2.4, lm: 2.4, lb: 1 } } });
check('a person changed the general yard weight to 2.4 → foam is still 3, everything else follows 2.4', c4[0].pounds === 3000 && c4[1].pounds === 2400, c4.map(function (c) { return c.pounds; }));
var c5 = cellsOf([{ id: 'a', description: 'FL-220 Grey', qty: 1000, unit: 'yd', unit_price: 2 }], { groupOf: function () { return { id: 'g1', name: 'Foam Laminated' }; } });
check('a line that does not say foam, merged into a product called "Foam Laminated", is NOT foam (Codex 07:36: a label a person can rename never changes a weight)', c5[0].pounds === 2500 && c5[0].foam === false, c5[0]);
var c6 = cellsOf([{ id: 'a', description: 'Laminated Fabric', foam: true, qty: 1000, unit: 'yd', unit_price: 2 }]);
check('the caller can say a line is foam (foam only in the line description)', c6[0].pounds === 3000);
var c7 = cellsOf([{ id: 'a', description: 'Foam delivery charge', qty: 1, unit: '', unit_price: 100 }, { id: 'b', description: 'Plain Velvet', qty: 1000, unit: 'yd', unit_price: 2 }]);
check('a shipping line that mentions foam is still a shipping charge, not goods', c7.length === 1 && c7[0].transport_revenue === 100, c7);

// ── the whole report (assemble): shared container split by pounds, supplier cost, foam only in the description
var base = {
  date_from: '2026-01-01', date_to: '', windowDays: 90, warehouseOn: false,
  invoices: [{ id: 'i1', invoice_number: 'ELITE 1', accounting_customer_id: 'c1', invoice_date: '2026-11-01', record_status: 'active', currency: 'USD', release_number: '1002-9001' },
             { id: 'i2', invoice_number: 'ELITE 2', accounting_customer_id: 'c1', invoice_date: '2026-11-01', record_status: 'active', currency: 'USD', release_number: '1002-9001' }],
  items: [{ id: 'l1', invoice_id: 'i1', wave_product_name: 'Foam Laminated', description: 'grey', quantity: 1000, unit_price: 2 },
          { id: 'l2', invoice_id: 'i2', wave_product_name: 'Plain Velvet', description: 'blue', quantity: 1000, unit_price: 2 }],
  customerNames: { c1: 'ELITE' }, terms: [{ invoice_id: 'i1', shipping_terms: 'EXW' }, { invoice_id: 'i2', shipping_terms: 'EXW' }],
  nameUnits: [{ name_key: 'foam laminated', unit: 'yd' }, { name_key: 'plain velvet', unit: 'yd' }],
  groups: [{ id: 'g1', display_name: 'Laminated goods', active: true, created_at: '2026-01-01' }],
  groupNames: [{ group_id: 'g1', source: 'invoice', name_key: 'foam laminated', raw_name: 'Foam Laminated', active: true }, { group_id: 'g1', source: 'bill', name_key: 'laminated roll', raw_name: 'Laminated roll', active: true }],
  bills: [{ id: 'b1', bill_number: 'TR-1', vendor_name: 'Trucker', bill_type: 'trucking', shipment_direction: 'outbound', release_number: '1002-9001', total_amount: 1100, record_status: 'active', bill_date: '2026-10-30' },
          { id: 'b2', bill_number: 'P-1', vendor_name: 'Mill', bill_type: 'goods', release_number: '', total_amount: 5000, record_status: 'active', bill_date: '2026-10-01' }],
  billLines: [{ id: 'bl1', bill_id: 'b2', line_kind: 'item', description: 'Laminated roll', qty: 5000, unit: 'yd', amount: 5000 }],
  warehouseRows: []
};
var r = A.assembleProfitability(base);
function row(n) { return r.by_invoice.filter(function (x) { return x.label === n; })[0]; }
check('report: the foam invoice is 3,000 lb, the other 2,500 lb', row('ELITE 1').pounds === 3000 && row('ELITE 2').pounds === 2500, [row('ELITE 1').pounds, row('ELITE 2').pounds]);
check('shared container $1,100 split by pounds 3,000 : 2,500 → $600 and $500 (adds back to $1,100)', row('ELITE 1').outbound_cost === 600 && row('ELITE 2').outbound_cost === 500, [row('ELITE 1').outbound_cost, row('ELITE 2').outbound_cost]);
check('supplier cost: bought at $1.00 a yard → 1,000 yards cost $1,000 (both sides use 3 lb, cost per yard unchanged)', row('ELITE 1').base_cost === 1000, row('ELITE 1'));
check('inbound allowance follows the pounds: 3,000 lb × $0.02 = $60', row('ELITE 1').inbound_allowance === 60, row('ELITE 1').inbound_allowance);
var inLb = A.assembleProfitability(Object.assign({}, base, { billLines: [{ id: 'bl1', bill_id: 'b2', line_kind: 'item', description: 'Laminated roll', qty: 15000, unit: 'lbs', amount: 5000 }] }));
check('supplier bills it in POUNDS ($5,000 for 15,000 lb): 3,000 lb sold cost $1,000', inLb.by_invoice.filter(function (x) { return x.label === 'ELITE 1'; })[0].base_cost === 1000);
var descOnly = A.assembleProfitability(Object.assign({}, base, { items: [{ id: 'l1', invoice_id: 'i1', wave_product_name: 'Laminated Fabric', description: 'with FOAM backing 3mm', quantity: 1000, unit_price: 2 }, base.items[1]], nameUnits: [{ name_key: 'laminated fabric', unit: 'yd' }, { name_key: 'plain velvet', unit: 'yd' }], groups: [], groupNames: [] }));
check('foam written only in the line description (product name "Laminated Fabric") → 3,000 lb', descOnly.by_invoice.filter(function (x) { return x.label === 'ELITE 1'; })[0].pounds === 3000);
check('totals still reconcile in every view', r.reconciled.product && r.reconciled.customer && r.reconciled.invoice, r.reconciled);

// ── the Sales Report uses the same rule (wiring)
var sr = fs.readFileSync(path.join(root, 'src/app/api/accounting/sales-report/route.js'), 'utf8');
check('Sales Report: pounds use foamFactors for a foam line (imported from the engine)', /import \{[^}]*isFoamLine[^}]*foamFactors[^}]*\} from '..\/..\/..\/..\/lib\/profitability'/.test(sr) && sr.indexOf('toPounds(qty, unit, null, weightFactorsFor(it.wave_product_name, it.description, factors))') > 0); // v55.83-VQ: one picker — headliner, then foam, else standard
var asm = fs.readFileSync(path.join(root, 'src/lib/profitability-assemble.js'), 'utf8');
check('assemble imports isFoamLine + foamFactors from the engine (runtime import present)', /import \{[^}]*isFoamLine, foamEvidenceConflict, foamFactors[^}]*\} from '.\/profitability'/.test(asm));
console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
