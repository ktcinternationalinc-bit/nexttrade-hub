// ═══════════════════════════════════════════════════════════════════════════
// v55.83-UD — Codex 12:10 / 12:15, run against the REAL advances route handler (stand-in sign-in / permissions / database) and the
// real history-window helpers:
//   • a money step's answer carries advance / fee totals ONLY with "Bank & Financial Summary" (accounting.view_totals)
//   • a click-id clash (23505) is run once more and never assumed saved; a second clash is refused
//   • the starting balance is super-admin only
//   • the history window: fails closed when the setting can't be read; bill records older than the window leave the answer
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path');
var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var FakeDb = require('./fake-supabase.js').FakeDb;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra))); }
console.log('UD — route access (real handlers)');

var state = { perms: {}, db: null, superAdmin: false };
function stub(rel, exportsObj) { var p = require.resolve(path.join(root, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj }; }
stub('src/lib/verified-caller.js', { verifiedCaller: function () { return Promise.resolve({ userId: 'u1' }); } });
stub('src/lib/server-permissions.js', {
  assertPermission: function (db, uid, perm) { return Promise.resolve(state.superAdmin || state.perms[perm] ? { ok: true, ctx: { isSuperAdmin: state.superAdmin } } : { ok: false, status: 403 }); },
  loadUserPermissions: function () { return Promise.resolve({ isSuperAdmin: state.superAdmin, mp: state.perms }); },
  userHasPermission: function (ctx, perm) { return !!(ctx && (ctx.isSuperAdmin || (ctx.mp && ctx.mp[perm]))); },
});
stub('src/lib/bank-allocation-server.js', { autoReviewIfComplete: function () { return Promise.resolve([]); } });
var supa = require.resolve('@supabase/supabase-js', { paths: [root] });
require.cache[supa] = { id: supa, filename: supa, loaded: true, exports: { createClient: function () { return state.db; } } };
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test'; process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
var AD = require(path.join(root, 'src/app/api/accounting/advances/route.js'));
var VW = require(path.join(root, 'src/lib/visibility-window-server.js'));
var PW = require(path.join(root, 'src/lib/profitability-window.js'));
function call(body) { return AD.POST(new Request('http://x/api', { method: 'POST', body: JSON.stringify(Object.assign({ user_id: 'u1' }, body)), headers: { 'content-type': 'application/json' } })).then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); }); }

function seed() {
  var db = new FakeDb({});
  db.t.paid_through_parties = [{ name: 'NextTrade Industries', kind: 'affiliate' }];
  db.t.users = []; db.t.plaid_accounts = []; db.t.bank_transactions = []; db.t.vendor_bills = []; db.t.vendor_bill_payments = []; db.t.party_money_entries = []; db.t.wire_packages = [];
  db.rpcs.hub_party_money_installed = function () { return { data: true, error: null }; };
  db.rpcs.hub_party_ud_installed = function () { return { data: true, error: null }; };
  db.calls = {};
  function counted(name, fn) { db.rpcs[name] = function (a, d) { db.calls[name] = (db.calls[name] || 0) + 1; return fn(a, d, db.calls[name]); }; }
  db.counted = counted;
  return db;
}
var OKRES = { ok: true, bills_paid: 1, left_on_payment: 10, advance_balance: 500, fee_total: 100 };

(async function () {
  // ── totals only with "Bank & Financial Summary" ──
  state.db = seed(); state.perms = { 'accounting.view': true, 'advances.manage': true }; state.superAdmin = false;
  state.db.counted('hub_party_allocate', function () { return { data: OKRES, error: null }; });
  var r1 = await call({ action: 'allocate', party: 'NextTrade Industries', bank_transaction_id: 'L1', bills: [{ bill_id: 'b1', amount: 10 }], request_id: 'req-route-1' });
  check('allocate without "Bank & Financial Summary": done, but NO advance / fee totals in the answer', r1.status === 200 && r1.j.ok && r1.j.result.bills_paid === 1 && r1.j.result.advance_balance === undefined && r1.j.result.fee_total === undefined, r1);
  state.perms['accounting.view_totals'] = true;
  var r2 = await call({ action: 'allocate', party: 'NextTrade Industries', bank_transaction_id: 'L1', bills: [{ bill_id: 'b1', amount: 10 }], request_id: 'req-route-2' });
  check('… with it: the totals are shown', r2.j.result.advance_balance === 500 && r2.j.result.fee_total === 100, r2);
  delete state.perms['accounting.view_totals'];
  state.db.counted('hub_party_money', function () { return { data: { ok: true, advance_balance: 500, fee_total: 100 }, error: null }; });
  var r3 = await call({ action: 'split', party: 'NextTrade Industries', bank_transaction_id: 'L1', amount: 10, fee: 0, request_id: 'req-route-3' });
  var r3b = await call({ action: 'to_fee', party: 'NextTrade Industries', amount: 10, reason: 'because', request_id: 'req-route-3b' });
  check('older money steps (split, advance → fee) also carry no totals without the permission', r3.j.ok && r3.j.result.advance_balance === undefined && r3b.j.ok && r3b.j.result.fee_total === undefined, [r3, r3b]);

  // ── click-id clash ──
  state.db = seed();
  state.db.counted('hub_party_allocate', function (a, d, n) { return n === 1 ? { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "hub_party_requests_pkey"' } } : { data: { ok: true, repeat: true, bills_paid: 1 }, error: null }; });
  var r4 = await call({ action: 'allocate', party: 'NextTrade Industries', bank_transaction_id: 'L1', bills: [{ bill_id: 'b1', amount: 10 }], request_id: 'req-route-4' });
  check('a click-id clash is run once more and the database’s own answer is returned (here: the same click)', state.db.calls.hub_party_allocate === 2 && r4.j.ok && r4.j.repeat === true, r4);
  state.db = seed();
  state.db.counted('hub_party_allocate', function (a, d, n) { return n === 1 ? { data: null, error: { code: '23505', message: 'dup' } } : { data: null, error: { message: 'HUB_GUARD: that click id was already used for a different move — refresh the page and try again.' } }; });
  var r5 = await call({ action: 'allocate', party: 'NextTrade Industries', bank_transaction_id: 'L1', bills: [{ bill_id: 'b1', amount: 10 }], request_id: 'req-route-5' });
  check('… and when the saved click was a DIFFERENT move: refused (409), never "ok"', r5.status === 409 && r5.j.ok === false && /different move/.test(r5.j.error), r5);
  state.db = seed();
  state.db.counted('hub_party_allocate', function () { return { data: null, error: { code: '23505', message: 'dup' } }; });
  var r6 = await call({ action: 'allocate', party: 'NextTrade Industries', bank_transaction_id: 'L1', bills: [{ bill_id: 'b1', amount: 10 }], request_id: 'req-route-6' });
  check('… two clashes in a row: refused, never reported as saved', r6.status === 409 && r6.j.ok === false, r6);
  state.db = seed(); state.db.counted('hub_party_money', function (a, d, n) { return n === 1 ? { data: null, error: { code: '23505', message: 'dup' } } : { data: null, error: { message: 'HUB_GUARD: that click id was already used for a different move — refresh the page and try again.' } }; });
  var r6b = await call({ action: 'apply', party: 'NextTrade Industries', bill_id: 'b1', amount: 10, request_id: 'req-route-6b' });
  check('… the same for the older steps (pay a bill from the advance)', r6b.status === 409 && r6b.j.ok === false, r6b);

  // ── starting balance: super admin only ──
  state.db = seed(); state.perms = { 'accounting.view': true, 'advances.manage': true }; state.superAdmin = false;
  state.db.counted('hub_party_opening', function () { return { data: { ok: true, advance_balance: 1 }, error: null }; });
  var r7 = await call({ action: 'opening', party: 'NextTrade Industries', amount: 100, visible_to_staff: true, reason: 'held for KTC before', request_id: 'req-route-7' });
  check('starting balance is SWITCHED OFF until Max decides (Codex 12:45): refused for staff, database never called', r7.status === 409 && /switched off/.test(r7.j.error) && !state.db.calls.hub_party_opening, r7);
  state.superAdmin = true;
  var r8 = await call({ action: 'opening', party: 'NextTrade Industries', amount: 100, reason: 'held for KTC before', request_id: 'req-route-8' });
  check('… and for the super admin too; the screen does not offer it (can_opening false)', r8.status === 409 && /switched off/.test(r8.j.error) && !state.db.calls.hub_party_opening, r8);
  var src0 = fs.readFileSync(path.join(root, 'src/app/api/accounting/advances/route.js'), 'utf8');
  check('… switched off in one place (OPENING_ENABLED = false), checked before anything else, and the button hidden', /var OPENING_ENABLED = false;/.test(src0) && /can_opening: OPENING_ENABLED && /.test(src0));
  state.superAdmin = false;

  // ── history window helper ──
  function settingsDb(rows, err) { return { from: function () { var q = { select: function () { return q; }, or: function () { return q; }, eq: function () { return q; }, limit: function () { return Promise.resolve(err ? { data: null, error: { message: err } } : { data: rows, error: null }); } }; return q; } }; }
  var w1 = await VW.windowFloorFor(settingsDb(null, 'relation "public.app_settings" does not exist'), { isSuperAdmin: false });
  check('window: settings table missing → an employee gets an error, never all history', !!w1.error && w1.floor === undefined, w1);
  var w2 = await VW.windowFloorFor(settingsDb(null, 'boom'), { isSuperAdmin: false });
  check('window: a read failure → error', !!w2.error, w2);
  var w3 = await VW.windowFloorFor(settingsDb([{ key: 'accounting_visibility_window', value: { window: 'nonsense' } }]), { isSuperAdmin: false });
  check('window: a malformed setting → error', !!w3.error, w3);
  var w4 = await VW.windowFloorFor(settingsDb([{ key: 'accounting_visibility_window', value: { window: '3m' } }]), { isSuperAdmin: false });
  check('window: "last 3 months" → a first day about 91 days ago', !!w4.floor && /^\d{4}-\d{2}-\d{2}$/.test(w4.floor), w4);
  var w5 = await VW.windowFloorFor(settingsDb([{ key: 'accounting_visibility_window', value: { window: 'all' } }]), { isSuperAdmin: false });
  check('window: explicit "all history" → no limit', w5.floor === null, w5);
  var w6 = await VW.windowFloorFor(settingsDb(null, 'boom'), { isSuperAdmin: true });
  check('window: the super admin always sees all-time (no read needed)', w6.floor === null && !w6.error, w6);
  check('clampFrom: no start or an earlier start → the window’s first day; a later start stays', VW.clampFrom(null, '2026-07-01') === '2026-07-01' && VW.clampFrom('2026-06-01', '2026-07-01') === '2026-07-01' && VW.clampFrom('2026-08-01', '2026-07-01') === '2026-08-01');

  // custom window settings must be complete (Codex 12:30)
  var bad = [{ window: 'custom' }, { window: 'custom', customDays: 0 }, { window: 'custom', customDays: -5 }, { window: 'custom', customDays: 'abc' }, { window: 'custom', customDays: '12x' }, { window: 'custom', customDays: 1.5 }, { window: 'custom', customFrom: 'not-a-date' }, { window: 'custom', customFrom: '2026-02-30' }];
  var badOut = []; for (var bi = 0; bi < bad.length; bi++) { badOut.push(await VW.windowFloorFor(settingsDb([{ key: 'accounting_visibility_window', value: bad[bi] }]), { isSuperAdmin: false })); }
  check('window: every incomplete / wrong custom setting → error, never all history (8 cases)', badOut.every(function (x) { return !!x.error && x.floor === undefined; }), badOut);
  var g1 = await VW.windowFloorFor(settingsDb([{ key: 'accounting_visibility_window', value: { window: 'custom', customFrom: '2026-07-01' } }]), { isSuperAdmin: false });
  var g2 = await VW.windowFloorFor(settingsDb([{ key: 'accounting_visibility_window', value: { window: 'custom', customDays: 30 } }]), { isSuperAdmin: false });
  check('window: a real custom date / 30 days work', g1.floor === '2026-07-01' && /^\d{4}-\d{2}-\d{2}$/.test(g2.floor || ''), [g1, g2]);
  var g3 = await VW.windowFloorFor(settingsDb([]), { isSuperAdmin: false });
  check('window: never set up (table readable, no row) = no limit — kept apart from explicit "all" and from errors', g3.floor === null && !g3.error, g3);
  // ── bill records older than the window leave the answer (numbers unchanged) ──
  var outP = { totals: { goods_revenue: 1000, base_cost: 250 }, cells: [{ base_cost: 250, cost_sources: [{ bill_id: 'b1', bill_number: 'NX1', vendor: 'NexPac Corporation', bill_date: '2026-06-01', qty: 100000, cost: 25000 }, { bill_id: 'b2', bill_number: 'NX2', vendor: 'NexPac Corporation', bill_date: '2026-07-05', qty: 10, cost: 5 }], missing_cost_lines: [{ bill_id: 'b1', bill_number: 'NX1' }] }],
    bill_names: [{ key: 'k', name: 'PVC', lines: 3, usable_lines: 3, qty: 100000, cost: 25000, units: ['lb'], vendors: ['NexPac Corporation'], last_date: '2026-06-01' }], groups: [{ id: 'g', link_stats: { lines: 3, usable: 3, first: '2026-05-01' } }] };
  var pj = PW.projectForWindow(JSON.parse(JSON.stringify(outP)), '2026-07-01');
  var txt = JSON.stringify(pj);
  check('window projection: the June bill (NX1, 100,000 / 25,000) is gone from the WHOLE answer; the July one stays', txt.indexOf('NX1') < 0 && txt.indexOf('25000') < 0 && txt.indexOf('100000') < 0 && pj.cells[0].cost_sources.length === 1 && pj.cells[0].cost_sources_hidden === 1, pj);
  check('… the bill-name list keeps names / units only, and the totals are unchanged', pj.bill_names[0].qty === undefined && pj.bill_names[0].vendors === undefined && pj.bill_names[0].last_date === undefined && pj.totals.base_cost === 250 && pj.cells[0].base_cost === 250 && pj.groups[0].link_stats.first === null);
  check('… no window (super admin / all history) = the answer untouched', PW.projectForWindow(outP, null) === outP);

  var proute = fs.readFileSync(path.join(root, 'src/app/api/accounting/profitability/route.js'), 'utf8');
  var pnl = fs.readFileSync(path.join(root, 'src/app/api/accounting/pnl/route.js'), 'utf8');
  check('profitability report is projected for the window before it is sent', /projectForWindow\(assembleProfitability\(/.test(proute) && /vwin\.floor\)/.test(proute));
  check('P&L typed-cost list: ONE window rule (costRow) for products on invoices and never sold (handler test: test-v55-83-ud-pnl-window.js)', /function costRow\(/.test(pnl) && /costRow\(top2\.product_label/.test(pnl) && !/history: hist2/.test(pnl));

  console.log('\nUD route access: ' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
