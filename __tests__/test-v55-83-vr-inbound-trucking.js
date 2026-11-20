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
check('every load is a row with its status; unmatched lines carry how to fix them', html.indexOf('80000003') > 0 && html.indexOf('no goods bill found') > 0 && html.indexOf('pounds not known') > 0 && html.indexOf('add the 8-digit load number to the line') > 0 && html.indexOf('Kronos invoices also charged on a supplier bill') > 0 && html.indexOf('counted once in this report, through Supplier One Corp bill T-1') > 0);
check('loading, error and empty states', RS.renderToStaticMarkup(React.createElement(View.default, { busy: true })).indexOf('Loading the Kronos bills') > 0 && RS.renderToStaticMarkup(React.createElement(View.default, { error: 'boom' })).indexOf('boom') > 0 && RS.renderToStaticMarkup(React.createElement(View.default, { report: T.buildInboundTrucking({ bills: [], lines: [] }) })).indexOf('No Kronos freight with a load number in these dates.') > 0);

// ── Codex 20 Nov 06:15 — the three reproductions, executed
function B(id, vendor, num, date, type, ref) { return { id: id, vendor_name: vendor, bill_number: num, bill_date: date, bill_type: type, record_status: 'active', deleted_at: null, other_reference: ref || null }; }
function Ln(id, bill, kind, desc, qty, unit, amount) { return { id: id, bill_id: bill, line_kind: kind, description: desc, qty: qty, unit: unit, amount: amount }; }
// P1 — one supplier bill naming two loads is never given to both in full
var m2 = T.buildInboundTrucking({ bills: [B(1, 'Sup', 'T', '2026-11-05', 'trucking'), B(2, 'Sup', 'G', '2026-11-01', 'supplier', '80221111 / 80221112'), B(3, 'Sup', 'G3', '2026-11-01', 'supplier', '80221113 80221113')],
  lines: [Ln(1, 1, 'charge', 'Freight Kronos - 80221111', 1, null, 100), Ln(2, 1, 'charge', 'Freight Kronos - 80221112', 1, null, 100), Ln(3, 2, 'item', 'Paper', 100, 'LBS', 10), Ln(4, 1, 'charge', 'Freight Kronos - 80221113', 1, null, 50), Ln(5, 3, 'item', 'Paper', 500, 'LBS', 10)] });
check('Codex P1: a 100-lb supplier bill naming two loads gives NEITHER load its pounds — both are unresolved and out of the average (it was 200 lb at $1)', m2.loads.filter(function (x) { return x.status === 'shared_goods_bill'; }).length === 2 && m2.loads.filter(function (x) { return x.status === 'shared_goods_bill'; }).every(function (x) { return x.pounds === null; }) && m2.totals.open_cents === 20000 && m2.totals.all.pounds === 500 && m2.totals.all.freight_cents === 5000, m2.totals);
check('…and the same load number written twice on one bill is one load, counted once (500 lb, not 1,000)', m2.loads.filter(function (x) { return x.load === '80221113'; })[0].pounds === 500 && m2.loads.filter(function (x) { return x.load === '80221113'; })[0].status === 'matched');
check('…and the screen says what to do about a shared bill', RS.renderToStaticMarkup(React.createElement(View.default, { report: m2 })).indexOf('goods bill shared by two loads') > 0 && View.fixWords({ status: 'shared_goods_bill', load: '1' }).indexOf('split it so each load has its own bill') === 0);
// P2 — direct Kronos bill and its supplier re-bill in different periods
var xb = [B(1, 'Kronos Logistics', 'KLNX162', '2026-11-10', 'trucking'), B(2, 'Sup', 'T9', '2026-12-01', 'trucking'), B(3, 'Sup', 'G9', '2026-11-02', 'supplier', '80330001')];
var xl = [Ln(1, 1, 'charge', 'Line haul 80330001', 1, null, 100), Ln(2, 2, 'charge', 'Freight Kronos Invoice # KLNX162 - 80330001', 1, null, 110), Ln(3, 3, 'item', 'Paper', 1000, 'LBS', 10)];
var nov = T.buildInboundTrucking({ bills: xb, lines: xl, from: '2026-11-01', to: '2026-11-30' });
var dec = T.buildInboundTrucking({ bills: xb, lines: xl, from: '2026-12-01', to: '2026-12-31' });
var both = T.buildInboundTrucking({ bills: xb, lines: xl, from: '2026-11-01', to: '2026-12-31' });
check('Codex P2: November holds only the direct bill — it is NOT called counted: it says the re-bill is dated outside these dates, and its $100 is shown as outside this report', nov.totals.tracked_cents === 0 && nov.not_counted.length === 1 && nov.not_counted[0].replacement_in_report === false && /NOT counted in this report/.test(nov.not_counted[0].why) && /dated outside these dates/.test(nov.not_counted[0].why) && nov.totals.not_counted_outside_cents === 10000, nov.not_counted);
check('…December (the re-bill’s own date) counts it once, at the supplier’s amount; nothing is double counted across the two months', dec.totals.tracked_cents === 11000 && dec.totals.all.freight_cents === 11000 && dec.not_counted.length === 0 && nov.totals.tracked_cents + dec.totals.tracked_cents === both.totals.tracked_cents);
check('…both months together: counted once through the re-bill, the direct bill says so, and the different amount ($100 vs $110) is shown', both.totals.tracked_cents === 11000 && both.not_counted.length === 1 && both.not_counted[0].replacement_in_report === true && /counted once in this report/.test(both.not_counted[0].why) && both.not_counted[0].amount_differs === true && both.not_counted[0].replacement_cents === 11000 && both.totals.not_counted_outside_cents === 0);
var rep = T.buildInboundTrucking({ bills: xb.concat([B(4, 'Sup', 'T10', '2026-12-05', 'trucking')]), lines: xl.concat([Ln(9, 4, 'charge', 'Freight Kronos Invoice # KLNX162 (part 2) - 80330001', 1, null, 40)]), from: '2026-11-01', to: '2026-12-31' });
check('…a part re-bill on a second supplier bill: both re-billed lines count ($150 on the load), the direct bill still once', rep.totals.tracked_cents === 15000 && rep.not_counted.length === 1 && rep.not_counted[0].replacement_cents === 15000 && rep.loads[0].lines.length === 2);
check('…the outside-period money is said on the screen', RS.renderToStaticMarkup(React.createElement(View.default, { report: nov })).indexOf('is not in this report’s figures at all') > 0);
// P1 — the history window
var wb = [B(1, 'Sup', 'T-NOV', '2026-11-05', 'trucking'), B(2, 'OldVendor Secret', 'OLD-777', '2025-01-01', 'supplier', '80440001'), B(3, 'Sup', 'G-NOV', '2026-11-02', 'supplier', '80440001'), B(4, 'NoDate Vendor', 'ND-1', null, 'supplier', '80440001'), B(5, 'Sup', 'T-OLD', '2025-02-01', 'trucking'), B(6, 'Kronos Logistics', 'KLNX500', '2026-11-06', 'trucking'), B(7, 'OldRebiller Secret', 'RB-OLD', '2025-03-01', 'trucking')];
var wl = [Ln(1, 1, 'charge', 'Freight Kronos - 80440001', 1, null, 300), Ln(2, 2, 'item', 'Paper', 100, 'LBS', 1), Ln(3, 3, 'item', 'Paper', 900, 'LBS', 1), Ln(4, 4, 'item', 'Paper', 77, 'LBS', 1), Ln(5, 5, 'charge', 'Freight Kronos - 80449999', 1, null, 999), Ln(6, 6, 'charge', 'haul', 1, null, 60), Ln(7, 7, 'charge', 'Freight Kronos Invoice # KLNX500', 1, null, 60)];
var emp = T.buildInboundTrucking({ bills: wb, lines: wl, floor: '2026-06-01', from: '2025-01-01' }); var empS = JSON.stringify(emp);
check('Codex P1: with a floor, an older supplier bill and one with no date still supply POUNDS (1,077), but no id, number, vendor, date or quantity of theirs is in the answer', emp.loads.length === 1 && emp.loads[0].pounds === 1077 && emp.loads[0].goods_bills.length === 1 && emp.loads[0].goods_bills[0].bill_number === 'G-NOV' && emp.loads[0].older_goods_bills === 2 && empS.indexOf('OLD-777') < 0 && empS.indexOf('OldVendor') < 0 && empS.indexOf('2025-01-01') < 0 && empS.indexOf('ND-1') < 0 && empS.indexOf('NoDate') < 0, emp.loads[0]);
check('…freight from before the floor is not there at all, even when an earlier From date is asked', emp.from === '2026-06-01' && empS.indexOf('T-OLD') < 0 && empS.indexOf('80449999') < 0 && empS.indexOf('99900') < 0);
check('…a duplicate explained by a re-bill from before the floor does not name that bill', emp.not_counted.length === 1 && empS.indexOf('RB-OLD') < 0 && empS.indexOf('OldRebiller') < 0 && /a supplier bill/.test(emp.not_counted[0].why));
var sup = T.buildInboundTrucking({ bills: wb, lines: wl });
check('…the super admin (no floor) sees every bill behind the same 1,077 lb', sup.loads.filter(function (x) { return x.load === '80440001'; })[0].goods_bills.length === 3 && sup.loads.filter(function (x) { return x.load === '80440001'; })[0].older_goods_bills === 0 && JSON.stringify(sup).indexOf('OLD-777') > 0 && sup.loads.length === 2);
check('…the screen says older bills are counted but not shown', (function () { var st = RS.renderToStaticMarkup(React.createElement(View.default, { report: emp })); return st.indexOf('OLD-777') < 0; })() && fs.readFileSync(path.join(root, 'src/components/InboundTruckingView.jsx'), 'utf8').indexOf('older bill(s) not shown (before the dates you may see); their pounds are counted') > 0);

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

// ── the REAL route, run (Codex: a route-response test, not a source pin)
var Module = require('module');
function stub(file, exportsObj) { var id = require.resolve(file); var m = new Module(id); m.filename = id; m.loaded = true; m.exports = exportsObj; require.cache[id] = m; }
var world = { who: { userId: 'u1' }, perms: { 'pnl.view': true }, floor: '2026-06-01', tables: { vendor_bills: wb, vendor_bill_lines: wl, pl_unit_factors: [{ unit: 'yd', pounds_per_unit: 2.5 }] }, writes: 0 };
function chain(table) { var q = {};
  ['select', 'order', 'eq'].forEach(function (k) { q[k] = function () { return q; }; });
  ['insert', 'update', 'upsert', 'delete'].forEach(function (k) { q[k] = function () { world.writes += 1; return q; }; });
  q.range = function (a, b2) { return Promise.resolve({ data: (world.tables[table] || []).slice(a, b2 + 1), error: null }); };
  q.maybeSingle = function () { return Promise.resolve({ data: (world.tables[table] || [])[0] || null, error: null }); };
  q.then = function (ok, no) { return Promise.resolve({ data: world.tables[table] || [], error: null }).then(ok, no); };
  return q; }
stub(path.join(root, 'node_modules/next/server.js'), { NextResponse: { json: function (body, init) { return { status: (init && init.status) || 200, body: body }; } } });
stub('@supabase/supabase-js', { createClient: function () { return { from: chain, rpc: function () { world.writes += 1; return Promise.resolve({}); } }; } });
stub(path.join(root, 'src/lib/verified-caller.js'), { verifiedCaller: async function () { return world.who; } });
stub(path.join(root, 'src/lib/server-permissions.js'), { assertPermission: async function (db, userId, key) { return world.perms[key] ? { ok: true, ctx: {} } : { ok: false }; } });
stub(path.join(root, 'src/lib/visibility-window-server.js'), { windowFloorFor: async function () { return world.floorError ? { error: world.floorError } : { floor: world.floor }; }, clampFrom: function (d, f) { return !f ? d : (!d || d < f ? f : d); } });
var ROUTE = require(path.join(root, 'src/app/api/accounting/profitability/route.js'));
function post(body) { return ROUTE.POST({ json: async function () { return body; }, headers: { get: function () { return 'Bearer x'; } } }); }
(async function () {
  var e1 = await post({ user_id: 'u1', action: 'inbound_trucking', date_from: '2025-01-01' }); var e1s = JSON.stringify(e1.body);
  check('ROUTE, employee with a floor of 1 June 2026 asking from 2025: 200, the load keeps its 1,077 lb, and NOTHING of the 2025 bill, the undated bill, the old freight or the old re-biller is in the response', e1.status === 200 && e1.body.ok === true && e1.body.loads.length === 1 && e1.body.loads[0].pounds === 1077 && e1.body.loads[0].older_goods_bills === 2 && e1.body.from === '2026-06-01' && e1s.indexOf('OLD-777') < 0 && e1s.indexOf('OldVendor') < 0 && e1s.indexOf('ND-1') < 0 && e1s.indexOf('NoDate') < 0 && e1s.indexOf('T-OLD') < 0 && e1s.indexOf('RB-OLD') < 0 && e1s.indexOf('OldRebiller') < 0 && e1s.indexOf('2025-') < 0, e1.body);
  world.floor = null; var e2 = await post({ user_id: 'u1', action: 'inbound_trucking' });
  check('ROUTE, super admin (no floor): all history — both loads and all three supplier bills', e2.status === 200 && e2.body.loads.length === 2 && JSON.stringify(e2.body).indexOf('OLD-777') > 0 && e2.body.floor === null);
  world.floor = '2026-06-01'; world.floorError = 'window not readable'; var e3 = await post({ user_id: 'u1', action: 'inbound_trucking' });
  check('ROUTE: when the window cannot be read the answer is refused (503), never all history', e3.status === 503 && !e3.body.loads);
  world.floorError = null; world.perms = {}; var e4 = await post({ user_id: 'u1', action: 'inbound_trucking' });
  check('ROUTE: without P&L: View → 403 and no data', e4.status === 403 && !e4.body.loads);
  world.perms = { 'pnl.view': true }; var e5 = await post({ user_id: 'u1', action: 'inbound_trucking', date_to: 'yesterday' });
  check('ROUTE: a date that is not a date is refused; and nothing was ever written', e5.status === 400 && world.writes === 0);
  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  if (failN > 0) { process.exit(1); }
})().catch(function (e) { console.log('  ✗ FAIL: route run threw ' + (e && e.stack || e)); process.exit(1); });
