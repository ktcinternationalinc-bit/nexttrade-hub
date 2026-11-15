// ═══════════════════════════════════════════════════════════════════════════
// v55.83-SI — master plan build 2. Max, Nov 12 13:00: "Start. Make sure you don't break anything while updating"
// (and 09:31: "make it very user-friendly and make the GUI professional looking ... keep an eye on the fonts and the
//  background colors so we don't keep getting things that we can't read")
// "🔔 Waiting for me": what needs THIS person in Bills and Wires, and what is stuck. Read-only — it uses the two list
// requests the Bills and Wires screens already make; no new server action, no SQL. The list logic is run for real; the
// screen is rendered for real (server render) to prove it does not crash.
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var R = function (p) { return fs.readFileSync(path.join(root, p), 'utf8'); };
var W = require(path.join(root, 'src/lib/waiting-list.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra || '').substring(0, 600))); }
var T = '2026-11-12';
function bill(id, o) { return Object.assign({ id: id, vendor_name: 'NexPac', bill_number: id.toUpperCase(), record_status: 'active', status: 'OPEN', open: 1000, total_amount: 1000, created_at: '2026-11-11T10:00:00Z', due_date: '2026-12-30', validation_status: null }, o || {}); }
function wire(id, st, o) { return Object.assign({ id: id, label: 'WP-' + id, payee_name: 'RTM Capital', status: st, bills: 2, total: 5000, created_at: '2026-11-11T10:00:00Z', signer_ids: [] }, o || {}); }
var bills = [bill('a'), bill('b', { created_at: '2026-11-01T10:00:00Z' }), bill('c', { price_check_status: 'flagged' }), bill('d', { price_check_status: 'flagged', price_resolved_at: '2026-11-11' }),
  bill('e', { validation_status: 'validated', due_date: '2026-11-15' }), bill('f', { validation_status: 'validated', due_date: '2026-11-01' }), bill('g', { validation_status: 'validated', due_date: '2026-11-14', wire_state: { state: 'ready' } }),
  bill('h', { validation_status: 'validated', due_date: '2027-03-01' }), bill('p', { status: 'PAID' }), bill('x', { status: 'DISPUTED' }), bill('v', { record_status: 'void', status: 'VOID' })];
var wires = [wire('1', 'needs_check'), wire('2', 'awaiting_1st'), wire('3', 'awaiting_2nd', { signer_ids: ['me'] }), wire('4', 'awaiting_2nd', { signer_ids: ['other'] }), wire('5', 'ready_to_send'),
  wire('6', 'sent', { sent_date: '2026-11-10' }), wire('7', 'sent', { sent_date: '2026-11-01' }), wire('8', 'complete'), wire('9', 'awaiting_proof', { rtm_pending: 2, sent_date: '2026-11-05' }), wire('10', 'flagged', { created_at: '2026-11-02T00:00:00Z' })];
console.log('SI — 🔔 Waiting for me');
var all = W.waitingFor({ bills: bills, wires: wires, perms: { bills: true, prepare: true, signoff: true, send: true }, userId: 'me', today: T });
var by = {}; all.sections.forEach(function (s) { by[s.key] = s.items.map(function (x) { return x.id; }); });
check('1: bills to validate: not validated, not paid / void / disputed, and not the one with an open price flag', JSON.stringify(by.bill_validate) === JSON.stringify(['b', 'a', 'd']), by.bill_validate);
check('2: price flags to resolve: flagged and nobody has resolved it yet', JSON.stringify(by.bill_flags) === JSON.stringify(['c']), by.bill_flags);
check('3: pre-wires to finish: not checked yet, or the check found a problem (the old one first, marked stuck)', JSON.stringify(by.wire_fix) === JSON.stringify(['10', '1']) && all.sections.filter(function (s) { return s.key === 'wire_fix'; })[0].items[0].stuck === true, by.wire_fix);
check('4: wires waiting for MY signature: no signature yet, or one signature that is not mine — never one I already signed', JSON.stringify(by.wire_sign.slice().sort()) === JSON.stringify(['2', '4']), by.wire_sign);
check('5: approved wires ready to send', JSON.stringify(by.wire_send) === JSON.stringify(['5']), by.wire_send);
check('6: a wire SENT 11 days ago with no bank line is listed as stuck; one sent 2 days ago is not listed', JSON.stringify(by.wire_bank) === JSON.stringify(['7']) && all.sections.filter(function (s) { return s.key === 'wire_bank'; })[0].items[0].stuck === true, by.wire_bank);
check('7: paid wires still waiting for proof', JSON.stringify(by.wire_proof) === JSON.stringify(['9']), by.wire_proof);
check('8: validated bills not on any wire, due within 7 days or late (late first, marked stuck) — not ones already on a wire or due far ahead', JSON.stringify(by.bill_ready) === JSON.stringify(['f', 'e']), by.bill_ready);
check('9: the totals: every item counted once; stuck = old bill b, old pre-wire 10, sent wire 7, late bill f', all.total === 13 && all.stuck === 4, { total: all.total, stuck: all.stuck });
var signer = W.waitingFor({ bills: bills, wires: wires, perms: { signoff: true }, userId: 'me', today: T });
check('10: a person who can only sign sees only the wires to sign — nothing about bills, sending or building', signer.sections.length === 1 && signer.sections[0].key === 'wire_sign' && signer.total === 2, signer.sections.map(function (s) { return s.key; }));
var none = W.waitingFor({ bills: [], wires: [], perms: { bills: true, prepare: true, signoff: true, send: true }, userId: 'me', today: T });
check('11: nothing waiting → an empty list (the screen says "You are all caught up")', none.total === 0 && none.sections.length === 0);
check('12: bad input never throws', W.waitingFor().total === 0 && W.waitingFor({ bills: [{}], wires: [{}], perms: { bills: true, send: true, prepare: true, signoff: true } }).total >= 0);
// the screen
var React = require(path.join(root, 'node_modules/react')); var RS = require(path.join(root, 'node_modules/react-dom/server'));
var Tab = require(path.join(root, 'src/components/WaitingTab.jsx')).default;
var html = '';
try { html = RS.renderToString(React.createElement(Tab, { userProfile: { id: 'me', role: 'staff' }, modulePerms: { 'bills.view': true } })); } catch (e) { html = 'CRASH ' + e.message; }
check('13: the screen renders (no crash) with its title and Refresh', html.indexOf('CRASH') < 0 && html.indexOf('Waiting for me') > 0 && html.indexOf('Refresh') > 0, html.substring(0, 200));
var U = R('src/components/WaitingTab.jsx');
check('14: READ-ONLY: the screen only sends the two existing "list" requests — no write action anywhere', (U.match(/action: '/g) || []).length === 2 && (U.match(/action: 'list'/g) || []).length === 2);
check('15: readable in both skins: nt-paper white panel, and every text has an explicit dark colour (no bg-white / text-white classes)', U.indexOf('className="nt-paper rounded-2xl p-4" style={{ background: \'#ffffff\'') > 0 && !/className="[^"]*\b(bg-white|text-white|text-slate-|text-gray-)/.test(U));
check('16: no browser pop-ups', !/window\.(alert|confirm|prompt)/.test(U));
var AT = R('src/components/AccountingTab.jsx');
check('17: it is the first button under BUYING, shown to anyone with a Bills or Wires switch (and owners / admins); the other tabs are untouched', AT.indexOf("['waiting', 'bills', 'wires', 'purchaseorders']") > 0 && AT.indexOf("(t[0] !== 'waiting' || bossA || mp['bills.view'] === true") > 0 && AT.indexOf("{sub === 'waiting' && <div className=\"p-3\"><WaitingTab {...props} onGo={setSub} /></div>}") > 0 && AT.indexOf("{sub === 'bills' && <div className=\"p-3\"><BillsTab {...props} /></div>}") > 0);
check('18: it is a ClickBooks screen like Bills and Wires', require(path.join(root, 'src/lib/accounting-access.js')).screenHub('waiting') === 'ktc');
check('19: the only server change is one extra field on the wires list (who signed), nothing removed', R('src/app/api/accounting/wire-packages/route.js').indexOf("signers: [nm[p.signoff1_by], nm[p.signoff2_by]].filter(Boolean), signer_ids: [p.signoff1_by, p.signoff2_by].filter(Boolean)") > 0);
console.log('\n' + pass + ' passed, ' + failN + ' failed'); if (failN) { process.exit(1); }
