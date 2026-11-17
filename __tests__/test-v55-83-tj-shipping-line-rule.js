// v55.83-TJ (Max, Nov 17 2026): "if there is a shipping line then assume it is exw or cnf with shipping NOT included in the price
// and cost of the goods". Pure functions only; nothing reads or writes a database.
var path = require('path');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var A = require(path.join(root, 'src/lib/profitability-assemble.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 900))); }

console.log('TJ — a shipping line on the invoice = shipping is NOT inside the goods price');
// like invoice America 1756: 24.81 tons @ $425 + a $2,000 transport line, nothing set on the invoice
var base = {
  date_from: '2026-01-01', date_to: '', windowDays: 90,
  invoices: [{ id: 'i1', invoice_number: 'AMERICA 1756', accounting_customer_id: 'c1', invoice_date: '2026-10-06', record_status: 'active', currency: 'USD', release_number: '1002-1166' }],
  items: [{ id: 'l1', invoice_id: 'i1', description: 'FORTIS MATERIAL BY TONS', quantity: 24.81, unit_price: 425 },
          { id: 'l2', invoice_id: 'i1', description: 'Trucking', quantity: 1, unit_price: 2000 }],
  customerNames: { c1: 'FADI ALSARAG' }, nameUnits: [{ name_key: 'fortis material by tons', unit: 'ton' }],
  bills: [], billLines: [], warehouseRows: []
};
function inv(r) { return r.by_invoice[0].invoice; }
function cell(r) { return r.by_invoice[0]; }
function hasFlag(r, k) { return (r.flags || []).some(function (f) { return f.kind === k; }); }

[false, true].forEach(function (on) {
  var r = A.assembleProfitability(Object.assign({}, base, { warehouseOn: on }));
  var lbl = on ? ' (warehouse switch ON)' : ' (warehouse switch OFF)';
  check('nothing set + shipping line → EXW by the shipping-line rule' + lbl, inv(r).basis === 'EXW' && inv(r).basis_source === 'shipping_line_rule', inv(r));
  check('goods revenue = the goods line only, 10,544.25' + lbl, cell(r).goods_revenue === 10544.25, cell(r));
  check('transport charged = the 2,000 line' + lbl, cell(r).transport_revenue === 2000, cell(r));
  check('the row is noted for review' + lbl, hasFlag(r, 'basis_assumed_from_shipping_line'));
  check('no "basis not stated" guess on top' + lbl, !hasFlag(r, 'basis_not_stated_on_invoice'));
});

var cnf = A.assembleProfitability(Object.assign({}, base, { warehouseOn: false, items: [base.items[0], { id: 'l2', invoice_id: 'i1', description: 'CNF Mombasa freight', quantity: 1, unit_price: 2000 }] }));
check('invoice text says CNF + shipping line → CNF, shipping on its own line', inv(cnf).basis === 'CNF' && inv(cnf).basis_source === 'shipping_line_rule' && cell(cnf).goods_revenue === 10544.25, inv(cnf));

// a CNF customer's usual + a shipping line + a container shipping bill: the container cost is NOT taken out of the goods price
var withBill = Object.assign({}, base, { warehouseOn: false, customerTerms: [{ customer_id: 'c1', basis: 'CNF' }],
  bills: [{ id: 'b1', bill_number: 'TR-1', vendor_name: 'Trucker', bill_type: 'trucking', shipment_direction: 'outbound', release_number: '1002-1166', total_amount: 1500, record_status: 'active', bill_date: '2026-10-05' }] });
var cb = A.assembleProfitability(withBill);
check('customer usual CNF + shipping line → container cost NOT taken out of the price', cell(cb).goods_revenue === 10544.25 && cell(cb).transport_revenue === 2000, cell(cb));
check('…and the 7% check runs: 2,000 ≥ 1,500 × 1.07 → no flag', !(cb.flags || []).some(function (f) { return f.kind === 'shipping_charged_below_cost_plus_7pct'; }));
var low = A.assembleProfitability(Object.assign({}, withBill, { bills: [Object.assign({}, withBill.bills[0], { total_amount: 1900 })] }));
check('2,000 < 1,900 × 1.07 = 2,033 → flagged below cost + 7%', (low.flags || []).some(function (f) { return f.kind === 'shipping_charged_below_cost_plus_7pct'; }));

// "CNF included" chosen on the form is a person's decision → the rule does not override it
var inc = A.assembleProfitability(Object.assign({}, base, { warehouseOn: false, terms: [{ invoice_id: 'i1', shipping_terms: 'CNF_INCLUDED' }] }));
check('form says CNF included → stays the person’s choice', inv(inc).basis === 'CNF' && inv(inc).basis_source === 'invoice_form' && !hasFlag(inc, 'basis_assumed_from_shipping_line'), inv(inc));

// no shipping line → the rule does nothing
var none = A.assembleProfitability(Object.assign({}, base, { warehouseOn: false, items: [base.items[0]] }));
check('no shipping line → no basis assumed', inv(none).basis === null && !hasFlag(none, 'basis_assumed_from_shipping_line'), inv(none));

console.log('TJ — a sale older than every linked purchase: assume it was bought earlier at the first 90 days’ price');
var P = require(path.join(root, 'src/lib/profitability.js'));
var BL = [
  { bill_id: 'b1', bill_number: 'F-1', bill_date: '2026-06-05', description: 'Fortis Thirds', qty: 10000, unit: 'lb', cost_amount: 2000, commission_amount: 200 },
  { bill_id: 'b2', bill_number: 'F-2', bill_date: '2026-08-01', description: 'Fortis Thirds', qty: 10000, unit: 'lb', cost_amount: 3000, commission_amount: 300 },
  { bill_id: 'b3', bill_number: 'F-3', bill_date: '2026-10-01', description: 'Fortis Thirds', qty: 10000, unit: 'lb', cost_amount: 9000, commission_amount: 0 }
];
var q = { billNameKeys: ['fortis thirds'], invoiceDate: '2026-05-01', releases: [], productKey: 'g:1' };
var ae = P.resolveCost(q, BL, { windowDays: 90 });
check('sale 2026-05-01, first bill 2026-06-05 → assumed, from the bills in 06-05 … 09-03 only (F-1 + F-2)', ae && ae.method === 'assumed_earliest' && ae.first_purchase === '2026-06-05' && ae.sources.length === 2, ae);
check('cost per lb = (2000 + 3000) ÷ 20000 = 0.25; commission 0.025', ae && Math.abs(ae.base_per_lb - 0.25) < 1e-9 && Math.abs(ae.commission_per_lb - 0.025) < 1e-9, ae);
var inW = P.resolveCost(Object.assign({}, q, { invoiceDate: '2026-08-15' }), BL, { windowDays: 90 });
check('a sale after a purchase still uses the 90 days before it (unchanged)', inW.method === 'window', inW);
check('no linked bills at all → still nothing (never invented)', P.resolveCost(q, [], { windowDays: 90 }) === null);

var early = {
  date_from: '2026-01-01', date_to: '', windowDays: 90,
  invoices: [{ id: 'i9', invoice_number: 'INV-9', accounting_customer_id: 'c1', invoice_date: '2026-05-01', record_status: 'active', currency: 'USD', release_number: '1001-9' }],
  items: [{ id: 'l9', invoice_id: 'i9', description: 'FORTIS BY KGs', quantity: 1000, unit_price: 1 }],
  customerNames: { c1: 'X' }, nameUnits: [{ name_key: 'fortis by kgs', unit: 'kg' }],
  groups: [{ id: 'g1', display_name: 'Fortis Thirds', active: true, created_at: '2026-01-01' }],
  groupNames: [{ group_id: 'g1', source: 'invoice', name_key: 'fortis by kgs', raw_name: 'FORTIS BY KGs', active: true }, { group_id: 'g1', source: 'bill', name_key: 'fortis thirds', raw_name: 'Fortis Thirds', active: true }],
  bills: [{ id: 'b1', bill_number: 'F-1', vendor_name: 'Fortis', bill_type: 'purchase', release_number: '', total_amount: 2000, record_status: 'active', bill_date: '2026-06-05' }],
  billLines: [{ bill_id: 'b1', line_kind: 'item', description: 'Fortis Thirds', qty: 10000, unit: 'lb', cost_amount: 2000, commission_amount: 0 }],
  warehouseRows: []
};
var er = A.assembleProfitability(early); var ec = er.cells[0];
check('in the report: the old sale now has a cost, labelled as assumed', ec.cost_method === 'assumed_earliest' && ec.base_cost_per_lb === 0.2 && ec.flags.indexOf('cost_assumed_before_first_purchase') >= 0, ec);
var typedEarly = A.assembleProfitability(Object.assign({}, early, { lineCosts: [{ invoice_item_id: 'l9', cost_per_lb: 0.3, commission_per_lb: 0 }] }));
check('a cost typed by hand wins over the assumption', typedEarly.cells[0].cost_method === 'manual' && typedEarly.cells[0].base_cost_per_lb === 0.3, typedEarly.cells[0]);
var unl = A.assembleProfitability(Object.assign({}, early, { groupNames: [early.groupNames[0]] }));
var w0 = (unl.by_product[0].cost_missing_why || [])[0] || {};
check('a missing-cost reason carries its product group, sale date and description (for the → fix button)', w0.why === 'no supplier description linked' && w0.group_id === 'g1' && w0.first_sale === '2026-05-01' && w0.names[0] === 'FORTIS BY KGs', w0);

console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
