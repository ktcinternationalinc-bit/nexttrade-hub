// v55.83-VB (Max, Nov 19 2026): asked whether foam sold by the LINEAR METRE is also 3 lb, he answered "YES FOAM ALL 3 LBS".
// Foam = 3 lb per yard AND per linear metre. Still decided by the invoice line only; "No Foam" still wins. Real engine.
var path = require('path');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var P = require(path.join(root, 'src/lib/profitability.js'));
var A = require(path.join(root, 'src/lib/profitability-assemble.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 900))); }
console.log('VB — foam weighs 3 lb per linear metre too');
var ff = P.foamFactors({ units: { lb: 1, kg: 2.20462, t: 2204.62, yd: 2.5, lm: 2.5 } }).units;
check('foam factors: yards 3 AND linear metres 3; pounds, kilos, tons unchanged', ff.yd === 3 && ff.lm === 3 && ff.lb === 1 && ff.kg === 2.20462 && ff.t === 2204.62, ff);
var gen = { units: { lb: 1, kg: 2.20462, t: 2204.62, yd: 2.4, lm: 2.7 } }; var f2 = P.foamFactors(gen).units;
check('a person set general yards 2.4 and linear metres 2.7 → foam is still 3 and 3; the general figures are not changed', f2.yd === 3 && f2.lm === 3 && gen.units.yd === 2.4 && gen.units.lm === 2.7, [f2, gen]);
function cells(lines, extra) { return P.buildCells(Object.assign({ invoices: [{ id: 'i', number: 'i', date: '2026-11-01', customer: 'C', basis: 'EXW', releases: ['1002-9001'], lines: lines }] }, extra || {})).cells; }
var c = cells([{ id: 'a', description: 'Foam laminated PVC', qty: 1000, unit: 'LM', unit_price: 1 }, { id: 'b', description: 'Plain PVC', qty: 1000, unit: 'LM', unit_price: 1 },
  { id: 'c', description: 'Foam laminated PVC', qty: 1000, unit: 'linear meters', unit_price: 1 }, { id: 'd', description: 'Foam laminated PVC', qty: 1000, unit: 'm', unit_price: 1 }, { id: 'e', description: 'Foam laminated PVC', qty: 1000, unit: 'yd', unit_price: 1 }]);
check('1,000 linear metres of foam = 3,000 lb (written LM, linear meters or m); inbound $60', c[0].pounds === 3000 && c[0].unit_factor === 3 && c[0].inbound_allowance === 60 && c[2].pounds === 3000 && c[3].pounds === 3000, c.map(function (x) { return x.pounds; }));
check('1,000 linear metres of plain PVC = 2,500 lb (unchanged)', c[1].pounds === 2500 && c[1].unit_factor === 2.5 && c[1].foam === false);
check('1,000 yards of foam = 3,000 lb (unchanged from UZ)', c[4].pounds === 3000);
var nf = cells([{ id: 'a', description: 'Face Goods- No Foam', qty: 1000, unit: 'lm', unit_price: 1 }, { id: 'b', description: 'PVC without foam', qty: 1000, unit: 'm', unit_price: 1 }, { id: 'c', description: 'Laminated', foam: false, qty: 1000, unit: 'lm', unit_price: 1 }], { groupOf: function () { return { id: 'g', name: 'FOAM' }; } });
check('"No Foam" / "without foam" in linear metres stay 2,500 lb, also inside a group called FOAM', nf.every(function (x) { return x.pounds === 2500 && x.foam === false; }), nf.map(function (x) { return x.pounds; }));
var real = cells([{ id: 'a', description: 'Foam blocks', qty: 100, unit: 'kg', unit_price: 1 }, { id: 'b', description: 'Foam scrap', qty: 100, unit: 'lbs', unit_price: 1 }, { id: 'c', description: 'Foam bales', qty: 1, unit: 'ton', unit_price: 1 }, { id: 'd', description: 'Foam', qty: 5, unit: '', unit_price: 1 }]);
check('foam by kilo / pound / ton keeps its real weight; foam with no unit stays unknown', Math.abs(real[0].pounds - 220.462) < 1e-9 && real[1].pounds === 100 && real[2].pounds === 2204.62 && real[3].pounds === null, real.map(function (x) { return x.pounds; }));
// whole report: sold in linear metres, bought in linear metres and in yards and in pounds
function rep(billLines) {
  return A.assembleProfitability({ date_from: '', date_to: '', windowDays: 90, warehouseOn: false, customerNames: { c: 'C' }, warehouseRows: [],
    invoices: [{ id: 'i1', invoice_number: 'F', accounting_customer_id: 'c', invoice_date: '2026-11-01', record_status: 'active', currency: 'USD', release_number: '1002-9001' }, { id: 'i2', invoice_number: 'P', accounting_customer_id: 'c', invoice_date: '2026-11-01', record_status: 'active', currency: 'USD', release_number: '1002-9001' }],
    items: [{ id: 'l1', invoice_id: 'i1', wave_product_name: 'Laminated Fabric', description: 'with foam backing', quantity: 1000, unit_price: 2 }, { id: 'l2', invoice_id: 'i2', wave_product_name: 'Plain Fabric', description: 'blue', quantity: 1000, unit_price: 2 }],
    terms: [{ invoice_id: 'i1', shipping_terms: 'EXW' }, { invoice_id: 'i2', shipping_terms: 'EXW' }],
    nameUnits: [{ name_key: 'laminated fabric', unit: 'lm' }, { name_key: 'plain fabric', unit: 'lm' }],
    groups: [{ id: 'g1', display_name: 'Fabric', active: true, created_at: '2026-01-01' }],
    groupNames: [{ group_id: 'g1', source: 'invoice', name_key: 'laminated fabric', raw_name: 'Laminated Fabric', active: true }, { group_id: 'g1', source: 'invoice', name_key: 'plain fabric', raw_name: 'Plain Fabric', active: true }, { group_id: 'g1', source: 'bill', name_key: 'roll', raw_name: 'Roll', active: true }],
    bills: [{ id: 'b1', bill_number: 'TR', vendor_name: 'T', bill_type: 'trucking', shipment_direction: 'outbound', release_number: '1002-9001', total_amount: 1100, record_status: 'active', bill_date: '2026-10-30' }, { id: 'b2', bill_number: 'P', vendor_name: 'Mill', bill_type: 'goods', release_number: '', total_amount: 5000, record_status: 'active', bill_date: '2026-10-01' }],
    billLines: billLines });
}
function row(r, n) { return r.by_invoice.filter(function (x) { return x.label === n; })[0]; }
var r1 = rep([{ id: 'x', bill_id: 'b2', line_kind: 'item', description: 'Roll', qty: 5000, unit: 'lm', amount: 5000 }]);
check('report: foam invoice in linear metres 3,000 lb, plain 2,500 lb; trucking 1,100 split 600 / 500; inbound 60 / 50', row(r1, 'F').pounds === 3000 && row(r1, 'P').pounds === 2500 && row(r1, 'F').outbound_cost === 600 && row(r1, 'P').outbound_cost === 500 && row(r1, 'F').inbound_allowance === 60 && row(r1, 'P').inbound_allowance === 50, [row(r1, 'F'), row(r1, 'P')]);
check('supplier bills in LINEAR METRES at $1.00: both sales cost $1,000 (cost per metre unchanged)', row(r1, 'F').base_cost === 1000 && row(r1, 'P').base_cost === 1000, [row(r1, 'F').base_cost, row(r1, 'P').base_cost]);
var r2 = rep([{ id: 'x', bill_id: 'b2', line_kind: 'item', description: 'Roll', qty: 5000, unit: 'yd', amount: 5000 }]);
check('supplier bills in YARDS at $1.00: both sales cost $1,000', row(r2, 'F').base_cost === 1000 && row(r2, 'P').base_cost === 1000);
var r3 = rep([{ id: 'x', bill_id: 'b2', line_kind: 'item', description: 'Roll', qty: 15000, unit: 'lbs', amount: 5000 }]);
check('supplier bills in POUNDS (15,000 lb for $5,000): foam sale 3,000 lb costs $1,000; plain sale 2,500 lb costs $833.33', row(r3, 'F').base_cost === 1000 && row(r3, 'P').base_cost === 833.33, [row(r3, 'F').base_cost, row(r3, 'P').base_cost]);
check('totals reconcile', r1.reconciled.product && r1.reconciled.customer && r1.reconciled.invoice);
console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
