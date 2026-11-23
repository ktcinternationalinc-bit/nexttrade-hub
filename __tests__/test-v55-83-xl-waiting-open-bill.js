// v55.83-XL — Waiting for me: "Open this bill" opens that exact bill; Back returns to the list (Max, 23 Nov 2026).
// Part 1 runs the REAL list builder. Part 2 are source checks of the wiring (they do not prove behaviour in a browser).
var fs = require('fs'); var path = require('path');
var pass = 0; var fail = 0;
function check(name, ok, extra) { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ FAIL: ' + name + (extra ? '  ' + JSON.stringify(extra) : '')); } }
function read(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
console.log('XL — Waiting for me opens the exact bill');
var src = read('src/lib/waiting-list.js').replace(/export var /g, 'var ').replace(/export function /g, 'function ');
var waitingFor = new Function(src + '\nreturn waitingFor;')();
var bills = [
  { id: 'b1', vendor_name: 'Kronos', bill_number: 'K-100', status: 'OPEN', record_status: 'active', validation_status: 'pending', created_at: '2026-11-10', due_date: '2026-11-30', open: 500, total_amount: 500 },
  { id: 'b2', vendor_name: 'AMB', bill_number: '', status: 'OPEN', record_status: 'active', validation_status: 'pending', price_check_status: 'flagged', created_at: '2026-11-20', open: 90, total_amount: 90 },
  { id: 'b3', vendor_name: 'NexPac', bill_number: 'N-7', status: 'OPEN', record_status: 'active', validation_status: 'validated', due_date: '2026-11-24', created_at: '2026-11-01', open: 10, total_amount: 10 }
];
var wires = [{ id: 'w1', label: 'W-1', payee_name: 'Kronos', status: 'awaiting_1st', created_at: '2026-11-22', bills: 1, total: 500 }];
var out = waitingFor({ bills: bills, wires: wires, funding: [{ id: 'f1', payee: 'RTM', date: '2026-11-01', amount: 100, used: 0, planned: 0, remaining: 100 }], perms: { bills: true, prepare: true, signoff: true, send: true }, userId: 'u1', today: '2026-11-23' });
function sec(k) { return (out.sections.filter(function (s) { return s.key === k; })[0] || { items: [] }).items; }
check('1: a bill to validate is marked as a bill and carries its id and number', sec('bill_validate').length === 1 && sec('bill_validate')[0].kind === 'bill' && sec('bill_validate')[0].id === 'b1' && sec('bill_validate')[0].bill_number === 'K-100', sec('bill_validate'));
check('2: a flagged bill is marked as a bill; a missing bill number is an empty text, never undefined', sec('bill_flags').length === 1 && sec('bill_flags')[0].kind === 'bill' && sec('bill_flags')[0].bill_number === '', sec('bill_flags'));
check('3: a validated bill not on a wire is marked as a bill too', sec('bill_ready').length === 1 && sec('bill_ready')[0].kind === 'bill' && sec('bill_ready')[0].id === 'b3', sec('bill_ready'));
check('4: wires and unused transfers are NOT marked as bills (no bill button on them)', sec('wire_sign').length === 1 && sec('wire_sign')[0].kind === undefined && sec('transfer_unused').length === 1 && sec('transfer_unused')[0].kind === undefined);
check('5: counts are unchanged by the new fields', out.total === 5, out.total);
var WT = read('src/components/WaitingTab.jsx'); var AT = read('src/components/AccountingTab.jsx'); var BT = read('src/components/BillsTab.jsx');
check('6: the list shows "Open this bill" only on bill rows and only when the screen can open bills', WT.indexOf("{x.kind === 'bill' && props.onOpenBill && <button onClick={function () { openBill(x, s); }}") > 0 && WT.indexOf('Open this bill →') > 0);
check('7: the click passes the bill id, number and the section it came from', WT.indexOf("props.onOpenBill({ id: x.id, bill_number: x.bill_number || '', title: x.title, section: s.key })") > 0);
check('8: Accounting remembers the bill and jumps with goFrom (so the SO Back button exists)', AT.indexOf("function openBillFrom(t) { if (!t || !t.id) { return; } setBillTarget(Object.assign({}, t, { n: Date.now() })); goFrom('bills'); }") > 0);
check('9: Back and picking a tab both forget the bill (a later plain visit to Bills opens nothing by itself)', AT.indexOf('setBack(null); setBillTarget(null); setSub(b0.sub);') > 0 && AT.indexOf('function pickTab(k) { setBack(null); setBillTarget(null); setSub(k); }') > 0);
check('10: Bills gets the bill only when it was reached from Waiting for me', AT.indexOf("openBillTarget={back && back.sub === 'waiting' ? billTarget : null} onBackFromBill={back && back.sub === 'waiting' ? goBack : null}") > 0);
check('11: Bills waits for its list, acts once per click, and shows the bill with the existing helper', BT.indexOf('if (!data || xlDone.current === t.n) { return; }') > 0 && BT.indexOf('xlDone.current = t.n;') > 0 && BT.indexOf('    showBillInList(b);') > 0);
check('12: validation opens only for a bill that still needs it, for a person who may validate', BT.indexOf("var needsV = (t.section === 'bill_validate' || t.section === 'bill_flags') && canManage && b.record_status === 'active' && b.validation_status !== 'validated';") > 0 && BT.indexOf('if (needsV) { openValidationFor(b); }') > 0);
check('13: the PENDING chip uses the same opener (one place)', BT.indexOf('if (canManage) { openValidationFor(b); } }}') > 0 && BT.split('function openValidationFor(b) {').length === 2 && BT.split('var v0 = { bill: b, checks: dr.checks || {}').length === 2);
check('14: a bill that is gone says so instead of opening something else', BT.indexOf("if (!b) { setFromWaiting({ title: t.title || 'that bill', missing: true }); return; }") > 0 && BT.indexOf('is no longer in the Bills list') > 0);
check('15: the Back button is on the Bills screen itself', BT.indexOf('{props.onBackFromBill && <button onClick={props.onBackFromBill}') > 0 && BT.indexOf('← Back to the Waiting list') > 0);
check('16: opening a bill writes nothing (the effect calls no api)', (function () { var i = BT.indexOf('var xlDone = useRef(0);'); var j = BT.indexOf('}, [xlN, data]);'); return i > 0 && j > i && BT.slice(i, j).indexOf('api(') < 0; })());
var WN = read('src/components/WhatsNewWidget.jsx'); var PG = read('src/app/page.jsx');
check('17: What\'s New has the XL entry and the badge names the newest entry (XL or later)', /version: 'v55\.83-XL'/.test(WN) && (function () { var top = /BUILD_HISTORY = \[\s*\{\s*version: '(v55\.83-[A-Z]+)'/.exec(WN); return !!top && PG.indexOf('>' + top[1] + '</span>') > 0; })());
console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) { process.exit(1); }
