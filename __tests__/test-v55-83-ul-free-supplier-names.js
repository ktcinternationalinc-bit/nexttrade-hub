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
console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
