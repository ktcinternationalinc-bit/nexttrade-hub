// v55.83-UL (Max, Nov 18: "Texas cardboard come at a 0 cost for us. so thats that") — a supplier description marked FREE counts its $0
// as a real zero cost; every other $0 line still makes the cost UNKNOWN. Uses Max's real Stock Paper bill figures (NexPac, Aug–Sep 2026).
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var P = require(path.join(root, 'src/lib/profitability.js'));
var A = require(path.join(root, 'src/lib/profitability-assemble.js'));
var pass = 0, failN = 0;
function check(l, c, x) { if (c) { pass++; } else { failN++; } console.log((c ? '  ✓ ' : '  ✗ FAIL: ') + l + (c ? '' : '  ' + JSON.stringify(x === undefined ? '' : x).substring(0, 500))); }

var lines = [
  { bill_id: 'b14647', bill_number: '14647', bill_date: '2026-08-27', description: 'Texas Cardboard Paper (LBS)', qty: 3034, unit: 'LBS', amount: 0, line_kind: 'item' },
  { bill_id: 'b14647', bill_number: '14647', bill_date: '2026-08-27', description: 'Texas Paper (LBS)', qty: 19667, unit: 'LBS', amount: 983.35, line_kind: 'item' },
  { bill_id: 'b14655', bill_number: '14655', bill_date: '2026-08-27', description: 'Cambridge Paper (LBS)', qty: 5593, unit: 'LBS', amount: 279.65, line_kind: 'item' },
  { bill_id: 'b14735', bill_number: '14735', bill_date: '2026-09-18', description: 'Texas Paper (LBS)', qty: 39705.5, unit: 'LBS', amount: 1985.28, line_kind: 'item' }
];
var keys = ['texas paper lbs', 'cambridge paper lbs', 'texas cardboard paper lbs'];
var q = { billNameKeys: keys, invoiceDate: '2026-10-14', releases: [], productKey: 'stock paper' };

console.log('UL — free supplier descriptions');
var before = P.resolveCost(q, lines, { windowDays: 90 });
check('without the free list: one $0 cardboard line makes the Stock Paper cost UNKNOWN (unchanged safety rule)', before.cost_unknown === true && before.base_per_lb === null, before);
var free = P.resolveCost(q, lines, { windowDays: 90, freeNameKeys: { 'texas cardboard paper lbs': true } });
var lb = 3034 + 19667 + 5593 + 39705.5; var cost = 983.35 + 279.65 + 1985.28;
check('cardboard marked free: cost is known, the free pounds are averaged in at $0 = $' + (cost / lb).toFixed(4) + ' / lb', free.cost_unknown === false && Math.abs(free.base_per_lb - cost / lb) < 1e-9 && Math.abs(free.pounds_bought - lb) < 1e-9, free);
var other = lines.concat([{ bill_id: 'bX', bill_number: 'X', bill_date: '2026-09-20', description: 'Cambridge Paper (LBS)', qty: 1000, unit: 'LBS', amount: 0, line_kind: 'item' }]);
var still = P.resolveCost(q, other, { windowDays: 90, freeNameKeys: { 'texas cardboard paper lbs': true } });
check('a $0 line on a description NOT marked free still makes the cost UNKNOWN (a missing price is never turned into $0)', still.cost_unknown === true, still);
var neg = lines.map(function (l) { return l.description === 'Texas Cardboard Paper (LBS)' ? Object.assign({}, l, { amount: -5 }) : l; });
check('free means exactly $0: a negative amount on the free description is still unknown', P.resolveCost(q, neg, { windowDays: 90, freeNameKeys: { 'texas cardboard paper lbs': true } }).cost_unknown === true);
var blank = lines.map(function (l) { return l.description === 'Texas Cardboard Paper (LBS)' ? Object.assign({}, l, { amount: null }) : l; });
check('a BLANK amount on the free description is still unknown (only a typed $0 is free)', P.resolveCost(q, blank, { windowDays: 90, freeNameKeys: { 'texas cardboard paper lbs': true } }).cost_unknown === true);

var asm = fs.readFileSync(path.join(root, 'src/lib/profitability-assemble.js'), 'utf8');
var ld = fs.readFileSync(path.join(root, 'src/lib/profitability-load-server.js'), 'utf8');
check('the report passes the free list into every cost lookup', /freeNameKeys: freeNameKeys/.test(asm) && /d\.freeBillNames/.test(asm));
check('the free list is loaded on the server, and the report still runs before its table exists', /pl_free_bill_names/.test(ld) && /setup\.freeBillNames = \[\]/.test(ld));
var sql = fs.readFileSync(path.join(root, 'sql/v55-83-UL-free-supplier-names.sql'), 'utf8');
check('SQL: table with RLS, no browser access, Texas Cardboard Paper (LBS) marked free under the same key the report uses', /ENABLE ROW LEVEL SECURITY/.test(sql) && /REVOKE ALL/.test(sql) && sql.indexOf("'" + P.nameKey('Texas Cardboard Paper (LBS)') + "'") >= 0);
// ── Codex 20:50: the whole report, not just the cost lookup ──
// one sale of 1,000 lb of "Stock Paper" at $0.12/lb on 2026-10-14, release 1002-77; the group links the paid and free supplier names
function report(billLines, free, opts) {
  var o = opts || {};
  return A.assembleProfitability({ date_from: '2026-10-01', date_to: '2026-10-31',
    invoices: [{ id: 'i1', invoice_number: 'SP-1', accounting_customer_id: 'c1', invoice_date: '2026-10-14', record_status: 'active', currency: 'USD', release_number: '1002-77' }],
    items: [{ id: 'a', invoice_id: 'i1', description: 'Stock Release Paper', quantity: 1000, unit_price: 0.12 }],
    customerNames: { c1: 'Buyer' }, groups: [{ id: 'g1', display_name: 'Stock Paper', active: true }],
    groupNames: [{ group_id: 'g1', source: 'invoice', name_key: 'stock release paper', raw_name: 'Stock Release Paper', active: true },
      { group_id: 'g1', source: 'bill', name_key: 'texas paper lbs', raw_name: 'Texas Paper (LBS)', active: true },
      { group_id: 'g1', source: 'bill', name_key: 'texas cardboard paper lbs', raw_name: 'Texas Cardboard Paper (LBS)', active: true }],
    nameUnits: [{ name_key: 'stock release paper', unit: 'lb' }], lineUnits: [], factors: [], terms: [{ invoice_id: 'i1', basis: 'EXW' }], lineReleasePounds: [], estimates: [],
    freeBillNames: free,
    bills: [{ id: 'b1', vendor_name: 'NexPac Corporation', bill_number: 'NX1', bill_date: '2026-09-20', total_amount: 1, record_status: 'active', bill_type: 'supplier', release_number: o.rel || '' }],
    billLines: billLines });
}
function cell0(r) { return r.cells[0]; }
var FREE = [{ name_key: 'texas cardboard paper lbs', active: true }];
var cb = function (amt, comm) { return { bill_id: 'b1', line_kind: 'item', description: 'Texas Cardboard Paper (LBS)', qty: 1000, unit: 'lb', amount: amt, commission_amount: comm }; };
var tp = { bill_id: 'b1', line_kind: 'item', description: 'Texas Paper (LBS)', qty: 1000, unit: 'lb', amount: 50 };

var r1 = cell0(report([cb(0)], FREE));
check('report: only FREE purchases, no commission → goods cost $0 (known, not missing), goods profit = revenue − inbound allowance', r1.base_cost === 0 && r1.commission === 0 && r1.base_cost_per_lb === 0 && r1.flags.indexOf('cost_missing') < 0 && r1.goods_profit !== null && Math.abs(r1.goods_profit - (120 - r1.inbound_allowance - (r1.bonded || 0) - (r1.brokerage || 0))) < 0.011, r1);
var r2 = cell0(report([cb(0, 5)], FREE));
check('report: only FREE purchases with a recorded $5 commission → cost $0, commission $5 ($0.005/lb) kept', r2.base_cost === 0 && r2.commission === 5 && r2.commission_per_lb === 0.005 && r2.flags.indexOf('cost_missing') < 0, r2);
var r3 = cell0(report([cb(0), tp], FREE));
check('report: paid + free mixed → $50 over 2,000 lb = $0.025/lb → 1,000 lb sold costs $25', r3.base_cost === 25 && r3.base_cost_per_lb === 0.025 && r3.flags.indexOf('cost_missing') < 0, r3);
var r4 = cell0(report([cb(0)], [{ name_key: 'texas cardboard paper lbs', active: false }]));
check('report: free rule switched OFF → the $0 is unknown again (cost missing)', r4.base_cost === null && r4.flags.indexOf('cost_missing') >= 0, r4);
var r5 = cell0(report([cb(0)], []));
check('report: not on the free list → cost missing (unchanged safety rule)', r5.base_cost === null && r5.flags.indexOf('cost_missing') >= 0, r5);
var r6 = cell0(report([cb(null)], FREE));
check('report: blank amount on the free name → cost missing', r6.base_cost === null && r6.flags.indexOf('cost_missing') >= 0, r6);
var r7 = cell0(report([cb(-1)], FREE));
check('report: negative amount on the free name → cost missing', r7.base_cost === null && r7.flags.indexOf('cost_missing') >= 0, r7);
var r8 = cell0(report([cb(0)], FREE, { rel: '1002-77' }));
check('report: the free purchase is on the SAME release as the sale → used first, cost $0 known', r8.base_cost === 0 && r8.cost_method === 'release' && r8.flags.indexOf('cost_missing') < 0, r8);
var r9 = cell0(report([cb(0), Object.assign({}, tp, { amount: 0 })], FREE));
check('report: free + an UNLISTED $0 line together → cost missing (one unknown price blocks a partial rate)', r9.base_cost === null && r9.flags.indexOf('cost_missing') >= 0, r9);
console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
