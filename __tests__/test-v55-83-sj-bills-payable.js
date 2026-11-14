// ═══════════════════════════════════════════════════════════════════════════
// v55.83-SJ — accounting priority 1. Max, Nov 13 12:50: "Bills are entered before they're paid ... of course, they're going
//  to be put into the books before they're paid." · 12:52: "work on top 2 right now, top 3, and let's move forward."
// A validated bill goes on the ledger on its bill date (cost + "we owe the vendor"); paying it clears the debt.
// ADDITIVE: no existing posting function is changed; OFF until the super admin sets a start date.
// The SQL ran on local PG16 with the real ClickBooks core (clickbooks/tests/qz2-ledger-drift/14_sj.sql): off → nothing;
// on → 2 of 5 bills on the books (not validated / before start / via RTM left out); payment waits for its bank line, then
// clears; NextTrade-paid bill clears; cost counted once; amount change → reversed + re-posted; un-validate → off the books;
// switch off → every entry reversed; trial balance nets to zero.
// Here: the aging list and the API route are run for real.
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path'); var Module = require('module'); var fs = require('fs');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'x';
require(path.join(root, 'node_modules/sucrase/register'));
var MemDB = require('./helpers/memdb-wires.js');
var R = function (p) { return fs.readFileSync(path.join(root, p), 'utf8'); };
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra || '').substring(0, 600))); }
console.log('SJ — bills on the books before they are paid; what we owe by age');
(async function () {
  var A = require(path.join(root, 'src/lib/payables-aging.js'));
  function b(v, open, due, o) { return Object.assign({ vendor_name: v, open: open, due_date: due, record_status: 'active', status: 'OPEN' }, o || {}); }
  var ag = A.payablesAging([b('NexPac', 1000, '2026-12-01'), b('NexPac', 500, '2026-11-01'), b('Trinity', 300, '2026-09-20'), b('Trinity', 200, '2026-07-01', { status: 'PARTIAL' }), b('AMB', 50, null, { bill_date: '2026-10-01', status: 'DISPUTED' }),
    b('Paid Co', 0, '2026-01-01', { status: 'PAID' }), b('Void Co', 900, '2026-01-01', { record_status: 'void', status: 'VOID' }), b('NexPac', 250, '2026-11-13', { wire_state: { amount: 250 } })], '2026-11-13');
  var np = ag.rows.filter(function (r) { return r.vendor === 'NexPac'; })[0]; var tr = ag.rows.filter(function (r) { return r.vendor === 'Trinity'; })[0]; var am = ag.rows.filter(function (r) { return r.vendor === 'AMB'; })[0];
  check('1: by vendor, by how late: NexPac $1,250 not due + $500 1–30 late', np.current === 1250 && np.d1_30 === 500 && np.total === 1750 && np.bills === 3 && np.on_wire === 250, np);
  check('2: Trinity $300 at 31–60 and $200 over 90; a bill with no due date is aged from its bill date (AMB 31–60), and shown as disputed', tr.d31_60 === 300 && tr.d90 === 200 && am.d31_60 === 50 && am.disputed === 50, { tr: tr, am: am });
  check('3: paid and void bills are not owed; totals add up; biggest vendor first', ag.rows.length === 3 && ag.rows[0].vendor === 'NexPac' && ag.totals.total === 2300 && ag.totals.bills === 6 && ag.totals.current === 1250 && ag.totals.d90 === 200, ag.totals);
  check('4: nothing owed / bad input never throws', A.payablesAging([]).totals.total === 0 && A.payablesAging(null).rows.length === 0 && A.payablesAging([{}, null]).totals.total === 0);

  // the API route, for real
  var db = new MemDB({ users: [{ id: 'u1', name: 'Staff', role: 'staff', active: true }, { id: 'u9', name: 'Max', role: 'super_admin', active: true }, { id: 'u3', name: 'NoBills', role: 'staff', active: true }],
    module_permissions: [{ user_id: 'u1', module_name: 'accounting.clickbooks.access', has_access: true }, { user_id: 'u1', module_name: 'bills.view', has_access: true }, { user_id: 'u3', module_name: 'accounting.clickbooks.access', has_access: true }] });
  var calls = []; var start = null;
  db.rpc = function (name, args) { calls.push({ name: name, args: args });
    if (name === 'clickbooks_us_payables_status') { return Promise.resolve({ data: { installed: true, start_date: start, payable_account_ready: true, ledger_owed: 1400, bills_on_books: 2, payments_cleared: 0 }, error: null }); }
    if (name === 'clickbooks_us_payables_set_start') { if (args.p_start && args.p_start <= '2026-10-31') { return Promise.resolve({ data: null, error: { message: 'The start date must be after the opening balance date (2026-10-31).' } }); } var was = start; start = args.p_start; return Promise.resolve({ data: { ok: true, was: was }, error: null }); }
    return Promise.resolve({ data: null, error: { message: 'function does not exist' } }); };
  var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
  fs.writeFileSync(mockPath, 'module.exports={createClient:function(){return global.__db;}};');
  var orig = Module._resolveFilename;
  Module._resolveFilename = function (req) { if (req === '@supabase/supabase-js') { return mockPath; } return orig.apply(this, arguments); };
  global.__db = db;
  var route = require(path.join(root, 'src/app/api/accounting/payables/route.js'));
  async function call(user, body) { var res = await route.POST({ json: function () { return Promise.resolve(Object.assign({ user_id: user }, body)); }, headers: new Map() }); return res.json(); }
  var s1 = await call('u1', { action: 'status' });
  check('5: anyone who can see bills reads the status; only the super admin is offered the switch', s1.ok && s1.installed === true && s1.start_date === null && s1.can_switch === false && (await call('u9', { action: 'status' })).can_switch === true, s1);
  var n3 = await call('u3', { action: 'status' });
  check('6: no Bills switch → refused', !n3.ok && /Bills: View/.test(n3.error), n3);
  var x1 = await call('u1', { action: 'set_start', start_date: '2026-11-02' });
  check('7: staff cannot switch it on', !x1.ok && /Only the super admin/.test(x1.error) && start === null, x1);
  var x2 = await call('u9', { action: 'set_start', start_date: '2099-01-01' }); var x3 = await call('u9', { action: 'set_start', start_date: 'soon' });
  check('8: a future date or a non-date is refused before the ledger is asked', !x2.ok && /future/.test(x2.error) && !x3.ok && start === null, { x2: x2, x3: x3 });
  var x4 = await call('u9', { action: 'set_start', start_date: '2026-10-31' });
  check('9: the ledger’s own refusal (on / before the opening balance) is shown as is', !x4.ok && /after the opening balance date/.test(x4.error), x4);
  var x5 = await call('u9', { action: 'set_start', start_date: '2026-11-02' });
  check('10: the super admin switches it on; the actor is passed to the ledger for its event log', x5.ok && start === '2026-11-02' && calls[calls.length - 1].args.p_actor === 'u9', x5);
  var x6 = await call('u9', { action: 'set_start', start_date: '' });
  check('11: …and off again', x6.ok && start === null && x6.was === '2026-11-02', x6);

  var Q = R('sql/v55-83-SJ-bills-payable.sql');
  check('12: SQL is additive: it defines its own functions and adds ONE step to the 15-minute job after the two existing ones (each step fails on its own)',
    Q.indexOf('create or replace function clickbooks_us.deposit_lines') < 0 && Q.indexOf('create or replace function clickbooks_us.has_piecewise') < 0 && Q.indexOf('create or replace function clickbooks_us.affbill_lines') < 0 &&
    Q.indexOf("begin r1 := clickbooks_us.deposit_sync_run(p_from, p_to, p_actor); exception when others then r1 := jsonb_build_object('error', SQLERRM); end;") > 0 &&
    Q.indexOf("begin r2 := clickbooks_us.affiliate_bill_sync_run(p_from, p_to, p_actor); exception when others then r2 := jsonb_build_object('error', SQLERRM); end;") > 0 &&
    Q.indexOf("begin r3 := clickbooks_us.payable_sync_run(p_from, p_to, p_actor); exception when others then r3 := jsonb_build_object('error', SQLERRM); end;") > 0);
  check('13: SQL: OFF until a start date; only validated, active bills dated on/after it; RTM (service provider) bills left as one line',
    Q.indexOf("if st is null then return jsonb_build_object('ok', false, 'why', 'bills on the books is switched off'); end if;") > 0 && Q.indexOf("if bl.validation_status is distinct from 'validated'") > 0 && Q.indexOf("if bl.bill_date < st then") > 0 && Q.indexOf("'paid through a service provider (stays one line)'") > 0);
  check('14: SQL: a payment is cleared only after its cost is already in the ledger (never ahead of the bank line), and a closed period is never touched',
    Q.indexOf("'waiting for the payment''s bank line to reach the ledger'") > 0 && (Q.match(/b\.locked_through is not null and/g) || []).length >= 3);
  check('15: SQL: the start date must be after the opening balance and the closed period; the setter and the status are service-role only',
    Q.indexOf('The start date must be after the opening balance date') > 0 && Q.indexOf('The start date must be after the closed period') > 0 && Q.indexOf('REVOKE ALL ON FUNCTION public.clickbooks_us_payables_set_start(date, uuid) FROM public, anon, authenticated;') > 0);
  check('16: the ledger scenario file is in the repo for the next person', fs.existsSync(path.join(root, 'clickbooks/tests/qz2-ledger-drift/14_sj.sql')));
  var U = R('src/components/PayablesPanel.jsx'); var BT = R('src/components/BillsTab.jsx');
  check('17: screen: Bills → Reports shows “What we owe, by age” and the switch; white panel, explicit dark text, no pop-ups',
    BT.indexOf("{panel === 'reports' && <PayablesPanel bills={(data && data.bills) || []} userId={userProfile && userProfile.id} />}") > 0 && U.indexOf('📒 What we owe, by age') > 0 && U.indexOf('Bills on the books before they are paid') > 0 &&
    U.indexOf('className="nt-paper rounded-xl p-4 mb-3" style={{ background: \'#ffffff\'') > 0 && !/window\.(alert|confirm|prompt)/.test(U) && !/className="[^"]*\b(bg-white|text-white|text-slate-|text-gray-)/.test(U));
  var React = require(path.join(root, 'node_modules/react')); var RS = require(path.join(root, 'node_modules/react-dom/server'));
  var html = ''; try { html = RS.renderToString(React.createElement(require(path.join(root, 'src/components/PayablesPanel.jsx')).default, { bills: [b('NexPac', 1000, '2026-12-01'), b('Trinity', 300, '2026-09-20')], userId: 'u9' })); } catch (e) { html = 'CRASH ' + e.message; }
  check('18: the screen renders (no crash) with the vendors and the total', html.indexOf('CRASH') < 0 && html.indexOf('NexPac') > 0 && html.indexOf('Trinity') > 0 && html.indexOf('1,300.00') > 0, html.substring(0, 200));
  console.log('\n' + pass + ' passed, ' + failN + ' failed'); if (failN) { process.exit(1); }
})().catch(function (e) { console.error(e); process.exit(1); });
