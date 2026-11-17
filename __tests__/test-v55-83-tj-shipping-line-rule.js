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

console.log('TK — total cost without outbound shipping; goods profit + transport profit = total profit');
// 1756-like: goods 10,544.25 + trucking line 2,000; trucker bill 1,500; supplier cost $0.18/lb; Houston release → $200 bonded
var tk = A.assembleProfitability(Object.assign({}, base, { warehouseOn: true,
  groups: [{ id: 'gf', display_name: 'Fortis', active: true, created_at: '2026-01-01' }],
  groupNames: [{ group_id: 'gf', source: 'invoice', name_key: 'fortis material by tons', raw_name: 'FORTIS MATERIAL BY TONS', active: true }, { group_id: 'gf', source: 'bill', name_key: 'fortis scrap', raw_name: 'Fortis Scrap', active: true }],
  bills: [{ id: 'pb', bill_number: 'F-9', vendor_name: 'Fortis', bill_type: 'purchase', release_number: '', total_amount: 18000, record_status: 'active', bill_date: '2026-09-01' },
          { id: 'tb', bill_number: 'TR-9', vendor_name: 'Trucker', bill_type: 'trucking', shipment_direction: 'outbound', release_number: '1002-1166', total_amount: 1500, record_status: 'active', bill_date: '2026-10-05' }],
  billLines: [{ bill_id: 'pb', line_kind: 'item', description: 'Fortis Scrap', qty: 100000, unit: 'lb', cost_amount: 18000, commission_amount: 2000 }] }));
var row = tk.by_product[0]; var cl = tk.cells[0];
var expectCost = Math.round((cl.base_cost + cl.commission + cl.inbound_allowance + cl.brokerage + cl.bonded) * 100) / 100;
check('total cost = goods cost + commission + inbound + brokerage + bonded — NOT the 1,500 trucking', row.total_cost === expectCost && cl.bonded === 200, { row: row.total_cost, expect: expectCost });
check('goods profit = goods revenue − total cost', row.goods_profit === Math.round((10544.25 - expectCost) * 100) / 100 && cl.goods_profit === row.goods_profit && row.goods_profit_known === true, row);
check('transport profit = 2,000 charged − 1,500 trucking bill = 500', row.transport_profit === 500);
check('total profit = goods profit + transport profit', Math.abs(row.profit - (row.goods_profit + row.transport_profit)) < 0.011, { p: row.profit, g: row.goods_profit, t: row.transport_profit });
// CNF with the shipping inside the price and no shipping line → the container cost is taken out of the price; transport profit 0
var cnfIn = A.assembleProfitability(Object.assign({}, base, { warehouseOn: true, items: [base.items[0]], terms: [{ invoice_id: 'i1', shipping_terms: 'CNF_INCLUDED' }],
  bills: [{ id: 'tb', bill_number: 'TR-9', vendor_name: 'Trucker', bill_type: 'trucking', shipment_direction: 'outbound', release_number: '1002-1166', total_amount: 1500, record_status: 'active', bill_date: '2026-10-05' }] }));
var ci = cnfIn.by_product[0];
check('CNF included, no shipping line: 1,500 shipping taken out of the price (goods 9,044.25) and transport profit = 0', ci.goods_revenue === 9044.25 && ci.transport_revenue === 1500 && ci.transport_profit === 0, ci);

console.log('TL — trucking and freight each on their own; typed per release, the bill wins; bond only when not paper / foil');
var truckBill = { id: 'tb', bill_number: 'TR-9', vendor_name: 'Trucker', bill_type: 'trucking', shipment_direction: 'outbound', release_number: '1002-1166', total_amount: 1500, record_status: 'active', bill_date: '2026-10-05' };
var shipBill = { id: 'sb', bill_number: 'FF-9', vendor_name: 'Forwarder', bill_type: 'shipping', shipment_direction: 'outbound', release_number: '1002-1166', total_amount: 3000, record_status: 'active', bill_date: '2026-10-06' };
var onlyTruck = A.assembleProfitability(Object.assign({}, base, { warehouseOn: true, bills: [truckBill] }));
var ot = onlyTruck.by_product[0];
check('only a trucking bill → trucking $1,500 shown, freight none yet (not "missing everything")', ot.trucking_cost === 1500 && ot.unknown_fields.indexOf('freight_cost') >= 0 && ot.unknown_fields.indexOf('trucking_cost') < 0, ot);
check('…transport profit uses what is known: 2,000 − 1,500 = 500', ot.transport_profit === 500, ot);
var typedF = A.assembleProfitability(Object.assign({}, base, { warehouseOn: true, bills: [truckBill], partEstimates: [{ release_key: '10021166', part: 'freight', amount: 2500 }] }));
var tf = typedF.by_product[0];
check('freight typed for the release (2,500) + trucking bill (1,500) → both shown; outbound 4,000 as ESTIMATE', tf.trucking_cost === 1500 && tf.freight_cost === 2500 && tf.outbound_cost === 4000 && typedF.cells[0].outbound_kind === 'estimate', tf);
check('Containers shows the typed freight', typedF.containers[0].parts.freight.estimate === 2500 && typedF.containers[0].parts.freight.estimate_from === 'typed in the Hub' && typedF.containers[0].parts.freight.typed === 2500, typedF.containers[0].parts.freight);
var billWins = A.assembleProfitability(Object.assign({}, base, { warehouseOn: true, bills: [truckBill, shipBill], partEstimates: [{ release_key: '10021166', part: 'freight', amount: 2500 }] }));
var bw = billWins.by_product[0];
check('the freight bill (3,000) overrides the typed 2,500 → final 4,500', bw.freight_cost === 3000 && bw.outbound_cost === 4500 && billWins.cells[0].outbound_kind === 'actual', bw);
check('…and the difference typed → bill is shown on Containers (+500)', billWins.containers[0].parts.freight.difference === 500 && billWins.containers[0].parts.freight.differs === true, billWins.containers[0].parts.freight);
var whR = { id: 'w1', release_key: '10021166', release_number: '1002-1166', superseded: false, section: 'main', order_id: 7, source_link: 'x', freight_used: 3475, freight_kind: 'estimate', trucking_used: 1850, trucking_kind: 'estimate', manual_freight: null, manual_trucking: null };
var whT = A.assembleProfitability(Object.assign({}, base, { warehouseOn: true, bills: [], warehouseRows: [whR], partEstimates: [{ release_key: '10021166', part: 'trucking', amount: 1700 }] }));
var wt = whT.by_product[0];
check('typed trucking (1,700) wins over Nextrade (1,850); Nextrade freight 3,475 still used', wt.trucking_cost === 1700 && wt.freight_cost === 3475, wt);
var whOnlyF = A.assembleProfitability(Object.assign({}, base, { warehouseOn: true, bills: [], warehouseRows: [Object.assign({}, whR, { trucking_used: null })] }));
var wf = whOnlyF.by_product[0];
check('Nextrade has freight but not trucking → freight 3,475 shown, trucking none yet', wf.freight_cost === 3475 && wf.unknown_fields.indexOf('trucking_cost') >= 0, wf);
var paper = A.assembleProfitability(Object.assign({}, base, { warehouseOn: false, items: [{ id: 'l1', invoice_id: 'i1', description: 'Release Paper', quantity: 24.81, unit_price: 425 }], nameUnits: [{ name_key: 'release paper', unit: 'ton' }] }));
check('Houston container with paper only → no $200 bond', paper.cells[0].bonded === 0, paper.cells[0]);
var foil = A.assembleProfitability(Object.assign({}, base, { warehouseOn: false, items: [{ id: 'l1', invoice_id: 'i1', description: 'Aluminium Foil rolls', quantity: 24.81, unit_price: 425 }], nameUnits: [{ name_key: 'aluminium foil rolls', unit: 'ton' }] }));
check('Houston container with foil only → no $200 bond', foil.cells[0].bonded === 0, foil.cells[0]);
var fortisB = A.assembleProfitability(Object.assign({}, base, { warehouseOn: false }));
check('Houston container with Fortis (not paper / foil) → $200 bond', fortisB.cells[0].bonded === 200, fortisB.cells[0]);
var mixed = A.assembleProfitability(Object.assign({}, base, { warehouseOn: false, items: [base.items[0], { id: 'l3', invoice_id: 'i1', description: 'Release Paper', quantity: 1, unit_price: 100 }], nameUnits: [{ name_key: 'fortis material by tons', unit: 'ton' }, { name_key: 'release paper', unit: 'ton' }] }));
check('mixed container (Fortis + paper) → $200 bond on the container', Math.round(mixed.cells.reduce(function (s0, c) { return s0 + c.bonded; }, 0)) === 200, mixed.cells.map(function (c) { return c.bonded; }));
check('paper / foil words: “Paper”, “papers”, “Foil”, “foils” yes; “Paperboard”, “Fortis” no', A.isPaperOrFoil('Release Paper') && A.isPaperOrFoil('PAPERS') && A.isPaperOrFoil('foil') && A.isPaperOrFoil('Foils') && !A.isPaperOrFoil('Paperboard') && !A.isPaperOrFoil('Fortis'));

console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
