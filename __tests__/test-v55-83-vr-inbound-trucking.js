// v55.83-VR — Max, 19 Nov 2026: "keep track of the real inbound trucking bills ... convert all to weight ... what ends up being
// the average price per lb" · "kronos is for inbound" · "nexpac bills are not truckers" · "now just track it and give us the
// generic .02 per LB costs". The real rule functions and the real screen, run on made-up bills.
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var T = require(path.join(root, 'src/lib/inbound-trucking.js'));
var P = require(path.join(root, 'src/lib/profitability.js'));
var React = require('react'); var RS = require('react-dom/server');
var View = require(path.join(root, 'src/components/InboundTruckingView.jsx'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 700))); }
console.log('VR — inbound trucking tracker (Kronos freight per pound received)');

var bills = [
  { id: 1, vendor_name: 'Supplier One Corp', bill_number: 'T-1', bill_date: '2026-06-30', bill_type: 'trucking', record_status: 'active', deleted_at: null, other_reference: null },
  { id: 2, vendor_name: 'Supplier One Corp', bill_number: 'G-1', bill_date: '2026-06-10', bill_type: 'supplier', record_status: 'active', deleted_at: null, other_reference: '80000001' },
  { id: 3, vendor_name: 'Supplier One Corp', bill_number: 'G-2', bill_date: '2026-06-12', bill_type: 'supplier', record_status: 'active', deleted_at: null, other_reference: '80000002' },
  { id: 4, vendor_name: 'Kronos Logistics Inc.', bill_number: 'KLNT900', bill_date: '2026-07-05', bill_type: 'trucking', record_status: 'active', deleted_at: null, other_reference: null },
  { id: 5, vendor_name: 'Kronos Logistics Inc.', bill_number: 'KLNX100', bill_date: '2026-06-28', bill_type: 'trucking', record_status: 'active', deleted_at: null, other_reference: null },
  { id: 6, vendor_name: 'Supplier One Corp', bill_number: 'G-3', bill_date: '2026-06-15', bill_type: 'supplier', record_status: 'active', deleted_at: null, other_reference: '80000004' },
  { id: 7, vendor_name: 'Supplier One Corp', bill_number: 'G-DEL', bill_date: '2026-06-15', bill_type: 'supplier', record_status: 'active', deleted_at: '2026-07-01', other_reference: '80000001' },
  { id: 8, vendor_name: 'Outbound Trucker LLC', bill_number: 'A-1', bill_date: '2026-06-20', bill_type: 'trucking', record_status: 'active', deleted_at: null, other_reference: null },
  { id: 9, vendor_name: 'Supplier One Corp', bill_number: 'G-1b', bill_date: '2026-06-11', bill_type: 'supplier', record_status: 'active', deleted_at: null, other_reference: 'Load 80000001' }
];
var lines = [
  { id: 11, bill_id: 1, line_kind: 'charge', description: 'Freight Kronos Invoice # KLNX100 - 06/28/26 - 80000001', qty: 1, unit: null, amount: 400 },
  { id: 12, bill_id: 1, line_kind: 'charge', description: 'Freight - Kronos Invoice # KLNX101 - 07/14/2026 - 80000002 (BONDED)', qty: 1, unit: 'BONDED', amount: 750 },
  { id: 13, bill_id: 1, line_kind: 'charge', description: 'Freight Kronos Invoice # KLNX102 - 06/29/26 - 80000003', qty: 1, unit: null, amount: 500 },
  { id: 14, bill_id: 1, line_kind: 'charge', description: 'Freight Kronos Invoice # KLNX103 - no load given', qty: 1, unit: null, amount: 300 },
  { id: 15, bill_id: 1, line_kind: 'charge', description: 'Rewinding & Inspection Fee', qty: 1, unit: null, amount: 999 },
  { id: 16, bill_id: 1, line_kind: 'charge', description: 'Freight Kronos Invoice # KLNX104 - 80000004', qty: 1, unit: null, amount: 200 },
  { id: 17, bill_id: 1, line_kind: 'charge', description: 'Freight Kronos KLNX105 loads 80000005 and 80000006', qty: 1, unit: null, amount: 100 },
  { id: 21, bill_id: 2, line_kind: 'item', description: 'Paper (LBS)', qty: 10000, unit: 'LBS', amount: 1000 },
  { id: 22, bill_id: 2, line_kind: 'commission', description: 'Commission 12.5%', qty: 1, unit: null, amount: 125 },
  { id: 31, bill_id: 3, line_kind: 'item', description: 'Obsoletes (YDS)', qty: 1000, unit: 'YDS', amount: 900 },
  { id: 32, bill_id: 3, line_kind: 'item', description: 'Headliner grey (YDS)', qty: 1000, unit: 'YDS', amount: 500 },
  { id: 33, bill_id: 3, line_kind: 'item', description: 'Foam laminated vinyl', qty: 1000, unit: 'YDS', amount: 500 },
  { id: 41, bill_id: 4, line_kind: 'charge', description: 'Bond', qty: 1, unit: null, amount: 125 },
  { id: 51, bill_id: 5, line_kind: 'charge', description: 'Line haul 80000001', qty: 1, unit: null, amount: 400 },
  { id: 61, bill_id: 6, line_kind: 'item', description: 'Decking', qty: 5, unit: 'CAM', amount: 100 },
  { id: 71, bill_id: 7, line_kind: 'item', description: 'Deleted goods (LBS)', qty: 99999, unit: 'LBS', amount: 1 },
  { id: 81, bill_id: 8, line_kind: 'charge', description: 'Outbound trucking 80000001', qty: 1, unit: null, amount: 5000 },
  { id: 91, bill_id: 9, line_kind: 'item', description: 'More paper', qty: 10000, unit: 'LBS', amount: 1000 }
];
var r = T.buildInboundTrucking({ bills: bills, lines: lines, factors: { units: P.DEFAULT_UNIT_FACTORS } });
function L(k) { return r.loads.filter(function (x) { return x.load === k; })[0]; }

check('a load number is the one 8-digit number on the line; dates and longer numbers are not load numbers', T.loadNumbersIn('Freight Kronos Invoice # KLNX162 - 06/30/26 - 80211703').join() === '80211703' && T.loadNumbersIn('07/14/2026 x').length === 0 && T.loadNumbersIn('123456789').length === 0 && T.loadNumbersIn('2026-07-14 80211703 80211703').join() === '80211703' && T.loadNumbersIn('80000005 and 80000006').length === 2);
check('only Kronos freight is tracked: another trucker and a rewinding fee on the same bill are not', r.loads.every(function (x) { return x.lines.every(function (f) { return /kronos/i.test(f.description) || /kronos/i.test(f.vendor); }); }) && JSON.stringify(r).indexOf('Outbound trucking') < 0 && JSON.stringify(r).indexOf('Rewinding') < 0);
check('load 80000001: $400 freight over 20,000 lb from two supplier bills = $0.0200 per lb (the deleted bill and the commission line add nothing)', L('80000001').status === 'matched' && L('80000001').freight_cents === 40000 && L('80000001').pounds === 20000 && Math.abs(L('80000001').per_lb - 0.02) < 1e-9 && L('80000001').goods_bills.length === 2, L('80000001'));
check('yards become pounds with the Profitability weight table: 1,000 plain yd = 2,500, headliner = 1,250, foam = 3,000', L('80000002').pounds === 6750 && L('80000002').bonded === true && Math.abs(L('80000002').per_lb - 750 / 6750) < 1e-9, L('80000002'));
check('a load with no supplier bill is listed with its money and a reason, and is NOT in the average', L('80000003').status === 'no_goods_bill' && L('80000003').pounds === null && L('80000003').freight_cents === 50000 && /other reference/.test(L('80000003').why));
check('a goods line in a unit that is not a weight (CAM) makes the pounds unknown — never guessed', L('80000004').status === 'pounds_unknown' && L('80000004').pounds === null && L('80000004').per_lb === undefined);
check('a Kronos line with no load number, or with two, is listed as unmatched with a reason', r.unmatched_lines.length === 3 && r.unmatched_lines.filter(function (f) { return f.why === 'no load number on the line'; }).length === 2 && r.unmatched_lines.filter(function (f) { return f.why === 'more than one load number on the line'; }).length === 1 && r.totals.unmatched_cents === 30000 + 10000 + 12500, r.unmatched_lines);
check('the same Kronos invoice entered directly AND re-billed by the supplier is counted once', r.not_counted.length === 1 && r.not_counted[0].bill_number === 'KLNX100' && r.totals.not_counted_cents === 40000 && L('80000001').lines.length === 1);
check('a Kronos bill of its own that nobody re-billed IS tracked (here: no load number, so unmatched)', r.unmatched_lines.some(function (f) { return f.bill_number === 'KLNT900' && f.cents === 12500; }));
check('average = matched freight / matched pounds, split regular and bonded', r.totals.all.loads === 2 && r.totals.all.freight_cents === 115000 && r.totals.all.pounds === 26750 && Math.abs(r.totals.all.per_lb - 1150 / 26750) < 1e-9 && r.totals.regular.loads === 1 && r.totals.regular.pounds === 20000 && r.totals.bonded.loads === 1 && r.totals.bonded.freight_cents === 75000, r.totals);
check('nothing disappears: matched + open loads + unmatched lines = every tracked Kronos cent', r.totals.tracked_cents === 115000 + 70000 + 52500 && r.totals.open_loads === 2 && r.totals.open_cents === 70000);
check('the standard $0.02 on the same pounds is shown beside the real cost, with the difference', r.standard_per_lb === 0.02 && r.standard_cents === 53500 && r.difference_cents === 115000 - 53500 && r.used_in_profit === 'standard');
check('no matched load → no rate at all (never a division by zero or a zero rate)', T.buildInboundTrucking({ bills: [], lines: [] }).totals.all.per_lb === null && T.buildInboundTrucking({ bills: [], lines: [] }).loads.length === 0);
var r2 = T.buildInboundTrucking({ bills: bills, lines: lines, from: '2026-07-01', to: '2026-07-31' });
check('dates are the freight bill’s date: July shows only the July Kronos bill', r2.loads.length === 0 && r2.unmatched_lines.length === 1 && r2.unmatched_lines[0].bill_number === 'KLNT900' && r2.not_counted.length === 0);
var r3 = T.buildInboundTrucking({ bills: bills, lines: lines, factors: { units: { lb: 1, yd: 3, lm: 3, kg: 2.20462, t: 2204.62 } } });
check('the yard weight comes from the weight table in use (3 lb here), headliner stays 1.25', r3.loads.filter(function (x) { return x.load === '80000002'; })[0].pounds === 3000 + 1250 + 3000);

// the screen
var html = RS.renderToStaticMarkup(React.createElement(View.default, { report: r, yardPounds: 2.5 }));
check('the screen says in plain words that this is tracking only and profit keeps the standard $0.02', html.indexOf('Tracking only. Goods profit still uses the standard $0.02 per pound') > 0 && html.indexOf('until you ask for the switch') > 0);
check('the screen shows the real rate, the three groups and what is not in the average', html.indexOf('$0.0430') > 0 && html.indexOf('Regular loads') > 0 && html.indexOf('Bonded loads') > 0 && html.indexOf('2 load(s) without pounds') > 0 && html.indexOf('3 line(s) without a load number') > 0);
check('every load is a row with its status; unmatched lines carry how to fix them', html.indexOf('80000003') > 0 && html.indexOf('no goods bill found') > 0 && html.indexOf('pounds not known') > 0 && html.indexOf('add the 8-digit load number to the line') > 0 && html.indexOf('Entered twice, counted once') > 0);
check('loading, error and empty states', RS.renderToStaticMarkup(React.createElement(View.default, { busy: true })).indexOf('Loading the Kronos bills') > 0 && RS.renderToStaticMarkup(React.createElement(View.default, { error: 'boom' })).indexOf('boom') > 0 && RS.renderToStaticMarkup(React.createElement(View.default, { report: T.buildInboundTrucking({ bills: [], lines: [] }) })).indexOf('No Kronos freight with a load number in these dates.') > 0);

// wiring
var route = fs.readFileSync(path.join(root, 'src/app/api/accounting/profitability/route.js'), 'utf8');
var tab = fs.readFileSync(path.join(root, 'src/components/ProfitabilityTab.jsx'), 'utf8');
var lib = fs.readFileSync(path.join(root, 'src/lib/inbound-trucking.js'), 'utf8');
var a = route.indexOf("if (action === 'inbound_trucking') {"); var b = route.indexOf('everything below changes the REPORT SET-UP only'); var blk = route.substring(a, b);
check('the server action is read only: it sits before the edit-permission gate and writes nothing', a > 0 && b > a && route.indexOf("assertPermission(db, userId, 'pnl.view', req)") < a && !/\.(insert|update|upsert|delete|rpc)\(/.test(blk) && blk.indexOf('buildInboundTrucking(') > 0);
check('employees get only their permitted window: the clamped start date is what the action uses', route.indexOf('body.date_from = clampFrom(body.date_from, vwin.floor);') > 0 && route.indexOf('body.date_from = clampFrom(body.date_from, vwin.floor);') < a && blk.indexOf("from: body.date_from || ''") > 0);
check('the route keeps the API style (no arrow functions, no template literals, no let / const in the new block)', !/=>|`|\blet\b|\bconst\b/.test(blk));
check('the screen imports what it uses and has the tab in the Shipping group', /import InboundTruckingView from '\.\/InboundTruckingView';/.test(tab) && tab.indexOf("['inbound', '🚚 Inbound trucking (Kronos)']") > 0 && tab.indexOf("{view === 'inbound' && <InboundTruckingView") > 0 && tab.indexOf("action: 'inbound_trucking'") > 0 && tab.indexOf('if (gen !== inbGen.current) { return; }') > 0);
check('goods profit is untouched: the tracker is not imported by the profit engine', fs.readFileSync(path.join(root, 'src/lib/profitability.js'), 'utf8').indexOf('inbound-trucking') < 0 && fs.readFileSync(path.join(root, 'src/lib/profitability-assemble.js'), 'utf8').indexOf('inbound-trucking') < 0 && P.INBOUND_ALLOWANCE_PER_LB === 0.02 && lib.indexOf('INBOUND_ALLOWANCE_PER_LB') > 0);

console.log('\n' + pass + ' passed, ' + failN + ' failed');
if (failN > 0) { process.exit(1); }
