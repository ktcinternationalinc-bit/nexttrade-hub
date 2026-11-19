// v55.83-UZ (Max, Nov 19 2026): "inbound charges for anything that starts with 1001 or 1003 as an order do NOT have an inbound
// charge in PNL". Runs the REAL engine. Also: "Face Goods- No Foam" (his own product name) is NOT foam.
var path = require('path');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var P = require(path.join(root, 'src/lib/profitability.js'));
var A = require(path.join(root, 'src/lib/profitability-assemble.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 900))); }
console.log('UZ — no inbound charge on 1001- / 1003- releases');
check('1001-1627, 1003-55, "1001 - 9", key 10011627 and key 10030055 → no inbound', ['1001-1627', '1003-55', '1001 - 9', '10011627', '10030055'].every(P.releaseHasNoInbound));
check('1002-1160, key 10021160, 1004-1, HOU-1001, empty → inbound stays', ['1002-1160', '10021160', '1004-1', 'HOU-1001', '', null].every(function (r) { return !P.releaseHasNoInbound(r); }));
function inv(id, rel) { return { id: id, number: id, date: '2026-11-01', customer: 'C', basis: 'EXW', releases: rel ? [rel] : [], lines: [{ id: id + 'l', description: 'Paper', qty: 10000, unit: 'lb', unit_price: 0.5 }] }; }
var cost = function () { return { base_per_lb: 0.2, commission_per_lb: 0, method: 'manual', sources: [] }; };
var c = P.buildCells({ invoices: [inv('a', '1001-1627'), inv('b', '1003-12'), inv('c', '1002-1160'), inv('d', '')], costOf: cost }).cells;
check('10,000 lb on 1001-1627 → inbound $0 (marked exempt)', c[0].inbound_allowance === 0 && c[0].inbound_exempt === true, c[0]);
check('10,000 lb on 1003-12 → inbound $0', c[1].inbound_allowance === 0 && c[1].inbound_exempt === true);
check('10,000 lb on 1002-1160 → inbound $200 as before', c[2].inbound_allowance === 200 && c[2].inbound_exempt === false, c[2]);
check('no release number → inbound $200 as before (not assumed Canada)', c[3].inbound_allowance === 200 && c[3].inbound_exempt === false);
check('goods profit: 1001 = 5,000 − 2,000 = 3,000; 1002 = 5,000 − 2,000 − 200 inbound − 200 bonded… (inbound is the only difference in cost here)', c[0].goods_profit === 3000 && c[2].goods_profit === 2800, [c[0].goods_profit, c[2].goods_profit]);
var u = P.buildCells({ invoices: [{ id: 'e', number: 'e', date: '2026-11-01', customer: 'C', basis: 'EXW', releases: ['1001-9'], lines: [{ id: 'el', description: 'Paper', qty: 5, unit: '', unit_price: 1 }] }] }).cells[0];
check('1001 release with an unknown weight: inbound is still a known $0', u.pounds === null && u.inbound_allowance === 0);
var r = A.assembleProfitability({ date_from: '', date_to: '', windowDays: 90, warehouseOn: false, customerNames: {}, bills: [], billLines: [], warehouseRows: [],
  invoices: [{ id: 'i1', invoice_number: 'CAN 1', accounting_customer_id: 'x', invoice_date: '2026-09-22', record_status: 'active', currency: 'USD', release_number: '1001-1627' },
             { id: 'i2', invoice_number: 'HOU 1', accounting_customer_id: 'x', invoice_date: '2026-09-22', record_status: 'active', currency: 'USD', release_number: '1002-1188' },
             { id: 'i3', invoice_number: 'TWO', accounting_customer_id: 'x', invoice_date: '2026-09-22', record_status: 'active', currency: 'USD', release_number: '1001-1 & 1002-2' }],
  items: [{ id: 'l1', invoice_id: 'i1', description: 'Paper per LBs', quantity: 51448, unit_price: 0.1 }, { id: 'l2', invoice_id: 'i2', description: 'Paper per LBs', quantity: 50000, unit_price: 0.1 }, { id: 'l3', invoice_id: 'i3', description: 'Paper per LBs', quantity: 1000, unit_price: 0.1 }],
  nameUnits: [{ name_key: 'paper per lbs', unit: 'lb' }], lineReleasePounds: [{ invoice_item_id: 'l3', release_key: '10011', pounds: 400 }, { invoice_item_id: 'l3', release_key: '10022', pounds: 600 }] });
function row(n) { return r.by_invoice.filter(function (x) { return x.label === n; })[0]; }
check('whole report: Canada invoice (1001-1627) inbound $0; Houston invoice inbound $1,000', row('CAN 1').inbound_allowance === 0 && row('HOU 1').inbound_allowance === 1000, [row('CAN 1').inbound_allowance, row('HOU 1').inbound_allowance]);
check('an invoice on a 1001 AND a 1002 release: only the pounds on the 1002 release carry inbound (600 lb → $12)', row('TWO').inbound_allowance === 12, row('TWO'));
check('totals reconcile', r.reconciled.product && r.reconciled.customer && r.reconciled.invoice);
// "No Foam" is not foam
check('"Face Goods- No Foam", "Face Goods- No Foam by yard.", "Non-foam vinyl", "without foam", "w/o foam" are NOT foam', ['Face Goods- No Foam', 'Face Goods- No Foam by yard.', 'Face Goods- No Foam  CNF Price', 'Non-foam vinyl', 'PVC without foam', 'PVC w/o foam'].every(function (n) { return !P.isFoamName(n); }));
check('real foam names from the books are still foam', ['Obsolete Foam Back By YD', 'FOAM By YD', 'Foam laminated PVC mixed colors', 'PVC Auto Foam Fabric by Yard', 'Automotive Foam Fabrics - Foam laminated PVC By Yards', 'Sew Foam By YD', 'PU FOAM', 'Auto fabrics with foam'].every(P.isFoamName));
var f = P.buildCells({ invoices: [{ id: 'f', number: 'f', date: '2026-11-01', customer: 'C', basis: 'EXW', releases: ['1002-1'], lines: [{ id: 'f1', description: 'Face Goods- No Foam by yard.', qty: 1000, unit: 'yd', unit_price: 1 }, { id: 'f2', description: 'Automotive Foam Fabrics - Foam laminated PVC By Yards', qty: 8373, unit: 'yd', unit_price: 1 }] }] }).cells;
check('1,000 yards "No Foam" = 2,500 lb; 8,373 yards foam laminated = 25,119 lb', f[0].pounds === 2500 && f[1].pounds === 25119, [f[0].pounds, f[1].pounds]);
console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
