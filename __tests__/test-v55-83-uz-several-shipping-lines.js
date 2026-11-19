// v55.83-UZ (Max, Nov 19 2026): "it is possible that there are more than 1 shipping line on an invoice such as 1002-1153. You are
// to aggregate the lines for the transport charged." Runs the REAL engine: every shipping line on an invoice is added together.
var path = require('path');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var A = require(path.join(root, 'src/lib/profitability-assemble.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 900))); }
console.log('UZ — several shipping lines on one invoice are added together');
function run(items, extra) {
  return A.assembleProfitability(Object.assign({ date_from: '', date_to: '', windowDays: 90, warehouseOn: false, customerNames: { c: 'FADI' }, bills: [], billLines: [], warehouseRows: [],
    invoices: [{ id: 'i1', invoice_number: 'AMERICA 1757', accounting_customer_id: 'c', invoice_date: '2026-07-10', record_status: 'active', currency: 'USD', release_number: '1002-1164' }],
    items: items.map(function (x, ix) { return { id: 'l' + ix, invoice_id: 'i1', description: x[0], quantity: x[1], unit_price: x[2] }; }), nameUnits: [{ name_key: 'fortis material by tons', unit: 't' }, { name_key: 'paper a', unit: 'lb' }, { name_key: 'paper b', unit: 'lb' }] }, extra || {})).by_invoice[0];
}
var a = run([['FORTIS MATERIAL BY TONS', 23.35, 425], ['Trucking Charges for one Container', 1, 2000], ['Detention Fees ', 1, 126.67]]);
check('Max\'s real invoice AMERICA 1757: Trucking 2,000 + Detention 126.67 → transport charged 2,126.67; goods 9,923.75', a.transport_revenue === 2126.67 && a.goods_revenue === 9923.75, a);
var b = run([['FORTIS MATERIAL BY TONS', 10, 400], ['Ocean freight', 1, 1500], ['Trucking', 1, 800], ['Overweight surcharge', 1, 150], ['Delivery charge', 2, 50]]);
check('four shipping lines (freight 1,500 + trucking 800 + surcharge 150 + delivery 2 × 50) → 2,550', b.transport_revenue === 2550 && b.goods_revenue === 4000, b);
var c = run([['Paper A', 1000, 1], ['Paper B', 3000, 1], ['Freight', 1, 300], ['Trucking', 1, 100]]);
check('two goods lines share the 400 by pounds and still add up to 400', c.transport_revenue === 400 && c.goods_revenue === 4000, c);
var d = run([['FORTIS MATERIAL BY TONS', 10, 400], ['Freight', 1, 1000], ['Handling fee', 1, 200]], { nameKinds: [{ name_key: 'handling fee', kind: 'transport' }] });
check('a line a person marked as a shipping charge ("Handling fee") is added with the others → 1,200', d.transport_revenue === 1200, d);
var e = run([['FORTIS MATERIAL BY TONS', 10, 400], ['Freight', 1, 1000], ['Handling fee', 1, 200]]);
check('a line whose name is NOT recognised as shipping and is not marked ("Handling fee") is treated as goods with no unit: the shipping total is then shown as not worked out (flagged), never a wrong number — mark it under Names', e.unknown_fields.indexOf('transport_revenue') >= 0 && e.weight_missing === true, e);
console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
