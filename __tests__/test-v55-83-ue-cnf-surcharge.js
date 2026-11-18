// v55.83-UE (Max, Nov 18 2026): "for the maa kirpa orders this is a CNF where the shipping is included in the price. but we have a
// surcharge which should just be an additional income to the transport. so please fix all the orders". Pure functions only.
var path = require('path');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var A = require(path.join(root, 'src/lib/profitability-assemble.js'));
var ST = require(path.join(root, 'src/lib/shipping-terms.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 900))); }
console.log('UE — CNF with shipping inside the price + a surcharge line');
// a Maa Kirpa-like invoice: 20 tons @ $500 = 10,000 (CNF, shipping inside) + Overweight surcharge 150; container shipping bill 800
var base = {
  date_from: '2026-01-01', date_to: '', windowDays: 90, warehouseOn: false,
  invoices: [{ id: 'i1', invoice_number: 'MAA KIRPA 2101', accounting_customer_id: 'mk', invoice_date: '2026-10-06', record_status: 'active', currency: 'USD', release_number: '1002-1300' }],
  items: [{ id: 'l1', invoice_id: 'i1', description: 'Paper rolls by tons', quantity: 20, unit_price: 500 },
          { id: 'l2', invoice_id: 'i1', description: 'Overweight surcharge', quantity: 1, unit_price: 150 }],
  customerNames: { mk: 'MAA KIRPA' }, customerTerms: [{ customer_id: 'mk', basis: 'CNF' }], nameUnits: [{ name_key: 'paper rolls by tons', unit: 'ton' }],
  bills: [{ id: 'b2', bill_number: 'TR-1', vendor_name: 'Trucker', bill_type: 'trucking', shipment_direction: 'outbound', release_number: '1002-1300', total_amount: 800, record_status: 'active', bill_date: '2026-10-05' }],
  billLines: [], warehouseRows: []
};
function inv(r) { return r.by_invoice[0].invoice; }
function cell(r) { return r.by_invoice[0]; }
function hasFlag(r, k) { return (r.flags || []).some(function (f) { return f.kind === k; }); }

var r = A.assembleProfitability(base);
check('Maa Kirpa (CNF customer) + surcharge → stays CNF, shipping INCLUDED (not flipped to "shipping on a separate line")', inv(r).basis === 'CNF' && !hasFlag(r, 'basis_assumed_from_shipping_line') && cell(r).goods_revenue < 10000, inv(r));
check('the container shipping cost (800) comes out of the goods price: goods revenue 10,000 − 800 = 9,200', cell(r).goods_revenue === 9200, cell(r));
check('transport charged = the shipping inside the price (800) + the surcharge (150) = 950', cell(r).transport_revenue === 950, cell(r));
check('transport profit = the surcharge, 150 (the shipping itself breaks even)', cell(r).transport_profit === 150, cell(r));
check('no "charged below cost + 7%" warning (that check is for shipping on its own line)', !hasFlag(r, 'shipping_charged_below_cost_plus_7pct') && !hasFlag(r, 'cnf_separate_without_shipping_line'));

var on = A.assembleProfitability(Object.assign({}, base, { warehouseOn: true }));
check('same with the warehouse switch ON: shipping still taken out of the goods price', cell(on).goods_revenue === 9200 && cell(on).transport_revenue === 950, cell(on));

var noSur = A.assembleProfitability(Object.assign({}, base, { items: [base.items[0]] }));
check('without the surcharge: goods 9,200, transport 800, transport profit 0 (unchanged behaviour)', cell(noSur).goods_revenue === 9200 && cell(noSur).transport_revenue === 800 && cell(noSur).transport_profit === 0, cell(noSur));

var fr = A.assembleProfitability(Object.assign({}, base, { items: [base.items[0], { id: 'l2', invoice_id: 'i1', description: 'Ocean freight', quantity: 1, unit_price: 2000 }] }));
check('a real FREIGHT line on a CNF customer → still "shipping on its own line" (TJ rule kept): price is goods only', cell(fr).goods_revenue === 10000 && cell(fr).transport_revenue === 2000, inv(fr));

var sep = A.assembleProfitability(Object.assign({}, base, { terms: [{ invoice_id: 'i1', shipping_terms: 'CNF_SEPARATE' }] }));
check('a person chose "CNF, separate line" on the form → their choice is kept (fix those with the SQL)', cell(sep).goods_revenue === 10000 && cell(sep).transport_revenue === 150, inv(sep));

var exw = A.assembleProfitability(Object.assign({}, base, { customerTerms: [], terms: [{ invoice_id: 'i1', shipping_terms: 'EXW' }] }));
check('EXW customer with a surcharge → not touched by this rule', inv(exw).basis === 'EXW' && cell(exw).goods_revenue === 10000 && cell(exw).transport_revenue === 150, inv(exw));

check('surcharge-only words: "Overweight surcharge" / "Fuel surcharge" yes; "Trucking surcharge" / "Shipping surcharge" no',
  ST.isSurchargeOnlyLine('Overweight surcharge') && ST.isSurchargeOnlyLine('Fuel surcharge') && !ST.isSurchargeOnlyLine('Trucking surcharge') && !ST.isSurchargeOnlyLine('Shipping surcharge'));
var w = ST.checkShippingTerms('CNF_INCLUDED', '800', [{ description: 'Paper', amount: 10000 }, { description: 'Overweight surcharge', amount: 150 }], require(path.join(root, 'src/lib/profitability.js')).isTransportLine);
check('invoice form: CNF included + a surcharge saves with NO "looks like a separate shipping charge" warning', w.ok === true && w.warnings.length === 0, w);
console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
