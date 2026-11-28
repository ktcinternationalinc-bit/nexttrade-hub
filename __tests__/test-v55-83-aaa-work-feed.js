// v55.83-AAA — 📋 My work feed, build 1 (Max, 27 Nov: "feeds everyone gets depending on roles so they know items that need to be updated or
// corrected with a button that takes you to the exact place that needs to be reviewed and updated and then a back button to take you back
// to your feed"). The REAL work-feed.js + waiting-list.js + WorkFeed.jsx (rendered), and the wiring in page / Accounting / Bills / Wires.
// Run: node __tests__/test-v55-83-aaa-work-feed.js
var path = require('path'); var fs = require('fs'); var Module = require('module');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
function stub(file, exp) { var id = require.resolve(file); var m0 = new Module(id); m0.filename = id; m0.loaded = true; m0.exports = exp; require.cache[id] = m0; }
stub('@supabase/supabase-js', { createClient: function () { return {}; } });
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 700))); }
function R(f) { return fs.readFileSync(path.join(root, f), 'utf8').split('\r\n').join('\n'); }
console.log('AAA — 📋 My work feed: what needs you, a button to the exact place, Back to the feed, Fixed / Still open');

var W = require(path.join(root, 'src/lib/waiting-list.js'));
var F = require(path.join(root, 'src/lib/work-feed.js'));
var today = '2026-11-27';
var bills = [
  { id: 'b1', vendor_name: 'Kronos', bill_number: '14746', status: 'OPEN', record_status: 'active', validation_status: 'pending', created_at: '2026-11-20', due_date: '2026-12-10', total_amount: 500, open: 500 },
  { id: 'b2', vendor_name: 'AMB', bill_number: '900', status: 'OPEN', record_status: 'active', validation_status: 'pending', price_check_status: 'flagged', created_at: '2026-11-26', due_date: '2026-12-01', total_amount: 80, open: 80 },
  { id: 'b3', vendor_name: 'NexPac', bill_number: '14743', status: 'OPEN', record_status: 'active', validation_status: 'validated', created_at: '2026-11-01', due_date: '2026-11-25', total_amount: 1000, open: 1000 },
  { id: 'b4', vendor_name: 'Void Co', bill_number: 'x', status: 'OPEN', record_status: 'void', validation_status: 'pending', created_at: '2026-11-01', total_amount: 1 }
];
var wires = [
  { id: 'w1', label: 'W-12', payee_name: 'RTM', status: 'awaiting_1st', created_at: '2026-11-26', bills: 2, total: 300 },
  { id: 'w2', label: 'W-13', payee_name: 'NextTrade', status: 'ready_to_send', created_at: '2026-11-26', bills: 1, total: 50 }
];
var funding = [{ id: 'f1', payee: 'RTM', date: '2026-11-01', amount: 1000, used: 400, remaining: 600 }];
var all = { bills: true, prepare: true, signoff: true, send: true };
var wAll = W.waitingFor({ bills: bills, wires: wires, funding: funding, perms: all, userId: 'me', today: today });
var feed = F.buildFeed({ waiting: wAll, invoices: null });
function grp(f, k) { return (f.groups || []).filter(function (g) { return g.key === k; })[0] || null; }

// 1. the same items as Waiting for me, nothing more, nothing less
check('1: every Waiting-for-me item is in the feed, once (same total, same sections in the same order)', feed.total + feed.payTotal === wAll.total && feed.groups.map(function (g) { return g.key; }).join() === wAll.sections.map(function (s) { return s.key; }).join(), { feed: feed.total, w: wAll.total });
check('1b: Max 27 Nov — bills not paid are their OWN group, away from the main feed: lane pay, not in To do / Stuck, counted apart', grp(feed, 'bill_ready').lane === 'pay' && feed.payTotal === 1 && feed.payStuck === 1 && feed.total === wAll.total - 1 && feed.stuck === wAll.stuck - 1 && feed.groups.filter(function (g) { return g.key !== 'bill_ready'; }).every(function (g) { return g.lane === 'main'; }) && /^Bills not paid/.test(grp(feed, 'bill_ready').title), { total: feed.total, pay: feed.payTotal, stuck: feed.stuck, wst: wAll.stuck });
check('2: a voided bill never shows (the source rule stays)', JSON.stringify(feed).indexOf('Void Co') < 0);
// 2. targets: the exact place
var bv = grp(feed, 'bill_validate'); var bf = grp(feed, 'bill_flags'); var ws = grp(feed, 'wire_sign'); var tu = grp(feed, 'transfer_unused'); var br = grp(feed, 'bill_ready');
check('3: a bill to validate opens Bills ON that bill, with the section so its validation checks open', bv && bv.items[0].target.kind === 'bill' && bv.items[0].target.id === 'b1' && bv.items[0].target.section === 'bill_validate' && bv.items[0].target.bill_number === '14746', bv && bv.items[0].target);
check('4: a price flag opens Bills ON that bill (section bill_flags)', bf && bf.items[0].target.kind === 'bill' && bf.items[0].target.id === 'b2' && bf.items[0].target.section === 'bill_flags');
check('5: a validated bill due soon opens that bill too', br && br.items[0].target.kind === 'bill' && br.items[0].target.id === 'b3');
check('6: a wire waiting for a signature opens Wires ON that wire', ws && ws.items[0].target.kind === 'wire' && ws.items[0].target.id === 'w1');
check('7: unused transfer money opens the Wires screen (there is no single wire to open)', tu && tu.items[0].target.kind === 'acct' && tu.items[0].target.sub === 'wires');
check('8: every item says what to do in plain words', feed.groups.every(function (g) { return g.items.every(function (x) { return typeof x.todo === 'string' && x.todo.length > 15; }); }));
check('9: item keys are unique (section + id), so Fixed / Still open never mixes two items up', (function () { var k = {}; var ok = true; feed.groups.forEach(function (g) { g.items.forEach(function (x) { if (k[x.key]) { ok = false; } k[x.key] = 1; }); }); return ok; })());
// 3. roles: only what the person's switches allow (waitingFor perms)
var onlySign = F.buildFeed({ waiting: W.waitingFor({ bills: bills, wires: wires, funding: funding, perms: { signoff: true }, userId: 'me', today: today }), invoices: null });
check('10: a signer sees only the wires waiting for a signature — no bills, no money to send', onlySign.groups.map(function (g) { return g.key; }).join() === 'wire_sign', onlySign.groups.map(function (g) { return g.key; }));
var signed = F.buildFeed({ waiting: W.waitingFor({ wires: [{ id: 'w9', label: 'W-9', status: 'awaiting_2nd', signer_ids: ['me'], created_at: today, total: 1 }], perms: { signoff: true }, userId: 'me', today: today }), invoices: null });
check('11: a wire I already signed is not in MY feed (two different people must sign)', signed.total === 0);
// 4. invoices awaiting bank confirmation (same filter as the existing home card)
var invs = [{ id: 'i1', order_number: 'EG-1', customer_name: 'A', total_pending_bank: 100 }, { id: 'i2', order_number: 'EG-2', customer_name: 'B', total_pending_bank: 0 }, { id: 'i3', order_number: 'EG-3', customer_name: 'C', total_pending_bank: 900 }];
var fi = F.buildFeed({ waiting: null, invoices: invs }); var gi = grp(fi, 'invoice_bank');
check('12: invoices with a pending bank amount only, biggest first, each opens that invoice', gi && gi.items.length === 2 && gi.items[0].target.kind === 'invoice' && gi.items[0].target.id === 'i3' && gi.items[1].target.id === 'i1', gi);
check('13: no invoices are asked for → no invoice group (the gate decides, not the list)', !grp(F.buildFeed({ waiting: null, invoices: null }), 'invoice_bank'));
// 5. Fixed / Still open
var after = F.buildFeed({ waiting: W.waitingFor({ bills: bills.filter(function (b) { return b.id !== 'b1'; }), wires: wires, funding: funding, perms: all, userId: 'me', today: today }), invoices: null });
var c1 = F.compareFeed(feed, after, 'bill_validate:b1');
check('14: the bill I opened and validated is gone → "✓ Fixed" (opened item not still open)', c1.fixed.length === 1 && c1.fixed[0].item.key === 'bill_validate:b1' && c1.openedStillOpen === false, c1);
var c2 = F.compareFeed(feed, feed, 'wire_sign:w1');
check('15: nothing changed → nothing marked fixed, and the item I opened says STILL OPEN', c2.fixed.length === 0 && c2.openedStillOpen === true);
check('16a: each group names its area (Codex 25 Nov: USA / Egypt / Warehouse kept apart): bills + wires = USA Accounting, invoices = Egypt Finance', feed.groups.every(function (g) { return g.area === 'USA Accounting'; }) && gi.area === 'Egypt Finance');
check('16b: THE ISSUE is one exact sentence naming the bill / wire and what is wrong', bv.items[0].issue === 'Kronos · bill 14746: not validated yet — it cannot be paid until it is.' && ws.items[0].issue === 'W-12 → RTM: waiting for your signature.' && /^AMB · bill 900: the price check flagged/.test(bf.items[0].issue) && /^NexPac · bill 14743: validated but on no wire, and late by 2 days./.test(br.items[0].issue), [bv.items[0].issue, ws.items[0].issue, br.items[0].issue]);
check('16c: an invoice issue names the invoice, the customer and the EGP not yet matched', gi.items[0].issue === 'Invoice EG-3 · C: 900.00 EGP is recorded as a bank payment but not matched to the bank statement.', gi.items[0].issue);
check('16d: HOW TO RESOLVE: numbered steps for every item, the first says where the button goes, real button names where there is one', feed.groups.every(function (g) { return g.items.every(function (x) { return Array.isArray(x.steps) && x.steps.length >= 2 && /^Press Go resolve/.test(x.steps[0]); }); }) && bv.items[0].steps.join(' ').indexOf('“✓ Mark validated”') > 0 && F.stepsFor('wire_send').join(' ').indexOf('“📤 Mark as sent”') > 0);
var r1 = F.addResolved([], c1.fixed, after, '09:12');
check('16e: RESOLVED group: the resolved bill moves there once, with when and what it was', r1.length === 1 && r1[0].key === 'bill_validate:b1' && r1[0].at === '09:12' && /not validated/.test(r1[0].issue) && r1[0].area === 'USA Accounting');
check('16f: resolving it twice never lists it twice; newest first', F.addResolved(r1, c1.fixed, after, '09:20').length === 1 && F.addResolved(r1, F.compareFeed(after, F.buildFeed({ waiting: null }), null).fixed, F.buildFeed({ waiting: null }), '09:30')[0].at === '09:30');
check('16g: an item that comes back (someone reopened it) leaves Resolved and is in To do again', F.addResolved(r1, [], feed, '').length === 0);
check('16: bad input never throws', F.buildFeed().total === 0 && F.compareFeed(null, null).fixed.length === 0 && F.buildFeed({ invoices: [null, {}] }).total === 0);

// 6. who sees which part (feedAccess) — nothing new: the switches the screens already use
var WF = require(path.join(root, 'src/components/WorkFeed.jsx'));
var A0 = WF.feedAccess(false, {}, 'staff');
check('17: no switches → no feed at all (not even an empty box)', A0.any === false);
var A1 = WF.feedAccess(false, { 'bills.manage': true }, 'staff');
check('18: Bills: Manage WITHOUT the ClickBooks area switch → no bill items (the Accounting screen would be locked)', A1.canBills === false && A1.perms.bills === false);
var A2 = WF.feedAccess(false, { 'accounting.clickbooks.access': true, 'bills.manage': true }, 'staff');
check('19: ClickBooks access + Bills: Manage → bill items, but no wire items', A2.canBills === true && A2.perms.bills === true && A2.canWires === false && !A2.perms.prepare && !A2.perms.signoff && !A2.perms.send);
var A3 = WF.feedAccess(false, { 'accounting.clickbooks.access': true, 'bills.manage': true, 'wires.signoff': true, 'pnl.view_revenue': false }, 'staff');
check('20: a revenue-hidden researcher (XK) gets no bill / wire items even with the switches', A3.canBills === false && A3.canWires === false && A3.perms.bills === false && A3.perms.signoff === false);
var A4 = WF.feedAccess(false, { Treasury: true }, 'staff');
check('21: invoices awaiting bank confirmation = the existing card’s gate (Treasury / View Financial Reports / super admin), nothing else', A4.canInvoices === true && A4.canBills === false && WF.feedAccess(false, { 'View Financial Reports': true }).canInvoices === true && WF.feedAccess(false, { 'bills.manage': true }).canInvoices === false);
var A5 = WF.feedAccess(false, { 'accounting.clickbooks.access': true, 'bills.manage': true }, 'admin');
check('22: an admin / owner role alone opens nothing extra (UG: only the super admin bypasses)', A5.canWires === false && WF.feedAccess(false, {}, 'admin').any === false);
var A6 = WF.feedAccess(true, {}, 'super_admin');
check('23: the super admin sees every part', A6.canBills && A6.canWires && A6.canInvoices && A6.perms.bills && A6.perms.prepare && A6.perms.signoff && A6.perms.send);

// 7. the screen
var React = require(path.join(root, 'node_modules/react')); var RS = require(path.join(root, 'node_modules/react-dom/server'));
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder';
var h0 = ''; var h1 = '';
try { h0 = RS.renderToString(React.createElement(WF.default, { userProfile: { id: 'me', role: 'staff' }, modulePerms: {} })); } catch (e) { h0 = 'CRASH ' + e.message; }
try { h1 = RS.renderToString(React.createElement(WF.default, { userProfile: { id: 'me', role: 'staff' }, modulePerms: { Treasury: true }, invoices: invs })); } catch (e) { h1 = 'CRASH ' + e.message; }
check('24: the panel renders nothing for someone with no switches', h0 === '', h0.substring(0, 200));
check('25: the panel renders (no crash) with its title, Refresh and Hide for someone with a switch', h1.indexOf('CRASH') < 0 && h1.indexOf('MY WORK FEED') > 0 && h1.indexOf('Refresh') > 0 && h1.indexOf('Hide') > 0, h1.substring(0, 300));
var U = R('src/components/WorkFeed.jsx');
check('26: READ-ONLY: lists for bills and wires plus the profitability cost report, with no writes or pop-ups', (U.match(/action: '/g) || []).length === 3 && (U.match(/action: 'list'/g) || []).length === 2 && U.includes("action: 'cost_work_feed'") && !/\.(insert|update|upsert|delete)\(/.test(U) && !/window\.(alert|confirm|prompt)/.test(U));
check('27: a source that failed to load never moves anything to Resolved (compare only when everything loaded)', U.indexOf('if (base && !e.length) {') > 0);
check('28: Fixed / Still open only right after the Back button (backN moved on by one), not after a menu visit', U.indexOf('Number(props.backN || 0) === j.backN + 1') > 0 && U.indexOf('backN: Number(props.backN || 0)') > 0);
check('28b: the 💸 Bills not paid group is a count you can click (own view); the main list shows only the main lane; Back returns to the view you left', U.indexOf("stat('💸 Bills not paid', feed ? payN : '…'") > 0 && U.indexOf("function () { setView('pay'); }") > 0 && U.indexOf("feed.groups.filter(function (g) { return (g.lane || 'main') === lane; })") > 0 && U.indexOf("setView(j.view || 'todo');") > 0 && U.indexOf('view: view };') > 0);
check('28c: mergeInvoices keeps the lanes apart (Egypt invoices stay in the main feed)', (function () { var m = WF.mergeInvoices(feed, invs); return m.payTotal === 1 && m.total === feed.total + 2; })());
check('29: sharp black look: black panel, square edges', U.indexOf("var BG = '#000000'") >= 0 && U.indexOf('borderRadius: 0') > 0 && U.indexOf('rounded-') < 0);

// 8. wiring: home screen first, jump to the exact place, Back to the feed
var P = R('src/app/page.jsx');
var iFeed = P.indexOf('<WorkFeed '); var iPrio = P.indexOf('<DashboardPrioritySections');
var iDash = P.indexOf("{tab === 'dashboard' && (\n          <div className=\"flex flex-col\">");
check('30: the feed is the FIRST thing in the home screen, before the ticket priority cards', iDash > 0 && iFeed > iDash && iFeed < iPrio && P.indexOf('<WorkFeed ', iFeed + 5) < 0);
check('31: the feed gets the person, their switches, the home screen invoices, the jump and the Back counter', /<WorkFeed userProfile=\{userProfile\} isSuperAdmin=\{isSuperAdmin\} modulePerms=\{modulePerms\} invoices=\{invoices\} invoicesStatus=\{invoicesStatus\} onOpen=\{openFromFeed\} backN=\{feedBackN\} \/>/.test(P) /* rev3: + whether the invoices loaded */);
check('32: a bill / wire jump = Accounting deep link + the SO Back bar labelled "your work feed" with what to do', P.indexOf("setAcctReturn({ tab: 'dashboard', y: y0, label: 'your work feed', note: todo });") > 0 && P.indexOf("setAcctDeepLink({ sub: 'bills', bill: {") > 0 && P.indexOf("setAcctDeepLink({ sub: 'wires', wire: { id: target.id } })") > 0);
check('33: Back from Accounting to the home screen counts as a Back to the feed; Back from the Bank tab does not', P.indexOf("if (r0.tab === 'dashboard') { setFeedBackN(function (k) { return k + 1; }); } setTab(r0.tab);") > 0);
check('34: an invoice jump opens that invoice in Sales with a sticky "← Back to your work feed" bar + what to do', P.indexOf("setTab('sales'); setSelectedInvoice(inv);") > 0 && P.indexOf('← Back to your work feed</button>') > 0 && P.indexOf("{feedReturn && tab !== 'dashboard' && tab !== 'accounting' && (") > 0);
check('35: a menu move clears the feed Back (fresh start, like SO)', P.indexOf("setFeedReturn(null); // v55.83-AAA — same for a jump from the work feed") > 0);
check('36: Accounting shows "What to do here" next to the Back button', P.indexOf("returnNote={acctReturn ? (acctReturn.note || '') : ''}") > 0);
var AT = R('src/components/AccountingTab.jsx');
check('37: Accounting opens Bills ON the bill from the feed (XL mechanism), its Back goes to the feed', AT.indexOf("var feedBill = !back && !!props.onReturn && !!billTarget;") > 0 && AT.indexOf("openBillTarget={(back && back.sub === 'waiting') || feedBill ? billTarget : null} onBackFromBill={back && back.sub === 'waiting' ? goBack : (feedBill ? props.onReturn : null)}") > 0);
check('38: the Waiting-for-me path is unchanged (still opens the bill and goes back to the Waiting list)', AT.indexOf("back && back.sub === 'waiting' ? goBack") > 0 && AT.indexOf('onOpenBill={openBillFrom}') > 0);
check('39: picking a tab forgets the bill / wire (a later visit opens nothing by itself)', AT.indexOf('function pickTab(k) { setBack(null); setBillTarget(null); setWireOpen(null); setSub(k); }') > 0);
check('40: Accounting opens Wires ON the wire only when it came from the feed', AT.indexOf('openWire={!back && props.onReturn ? wireOpen : null}') > 0);
var BT = R('src/components/BillsTab.jsx');
check('41: Bills says where it was opened from and where Back goes (defaults unchanged for Waiting for me)', BT.indexOf("{'← Back to ' + (props.backFromBillLabel || 'the Waiting list')}") > 0 && (BT.match(/\(props\.openedFromLabel \|\| '🔔 Waiting for me'\)/g) || []).length === 2);
var WT = R('src/components/WiresTab.jsx'); var WP = R('src/components/WirePackagesPanel.jsx');
check('42: Wires opens that wire with the SAME open() as a click (read only, nothing written)', WT.indexOf('openWire={openWire}') > 0 && WP.indexOf("useEffect(function () { var ow = props.openWire; if (ow && ow.id) { open(ow.id); } }, [openWireN]);") > 0);
// 9. build bookkeeping
check('43: badge v55.83-AAA or a later three-letter build (AAG realign)', />v55\.83-[A-Z]{3}<\/span>/.test(P));
var WN = R('src/components/WhatsNewWidget.jsx');
check('44: What’s New: the AAA entry is there in plain words, and the newest entry is the badge (AAG realign)', WN.indexOf("    version: 'v55.83-AAA',") > 0 && WN.indexOf('📋 My work feed') > 0 && (function () { var top = /BUILD_HISTORY = \[\s*\{\s*version: '(v55\.83-[A-Z]+)'/.exec(WN); return !!top && P.indexOf('>' + top[1] + '</span>') > 0; })());
check('45: no SQL; the only work-feed route is the AAH assignments route (AAH realign — AAA itself added none)', fs.readdirSync(path.join(root, 'src/app/api/work-feed')).join() === 'assignments' && !fs.existsSync(path.join(root, 'sql/v55-83-aaa.sql')) && !fs.existsSync(path.join(root, 'sql/v55-83-AAH-work-assignments.sql')));

console.log('\n' + pass + ' passed, ' + failN + ' failed'); if (failN) { process.exit(1); }
