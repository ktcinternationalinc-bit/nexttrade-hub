// v55.83-UM (Codex 21:50 P1) — the REAL /api/wave/delete-invoice handler on a FakeDb, verified caller and permissions stubbed, Wave
// intercepted: a blocker the Hub already knows (archived / void / cancelled invoice, a live payment match, a payment record, a
// business the person is not in, no switch, the database step not installed) causes ZERO Wave calls and ZERO local changes.
// A clean invoice: check first, then Wave, then the Hub step. A change between the check and the step is reported truthfully.
var path = require('path');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var FakeDb = require('./fake-supabase.js').FakeDb;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 600))); }
console.log('UM — Delete incl. Wave: every Hub blocker is checked BEFORE Wave is touched');
var WB = 'QnVzaW5lc3M6YjYyMzNmMjItMjRkZS00MzYyLWE4MWYtZGQ4ZWQxNGUzNzg4'; // the approved test business in the route
var ID = '00000000-0000-0000-0000-000000000001';
var state = { db: null, who: { userId: 'u-switch' }, users: {}, waveCalls: 0, rpcCalls: [], waveOk: true };
function stub(rel, exportsObj) { var p = require.resolve(path.join(root, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj }; }
stub('src/lib/verified-caller.js', { verifiedCaller: function () { return Promise.resolve(state.who); } });
stub('src/lib/server-permissions.js', {
  loadUserPermissions: function (db, id) { var u = state.users[id] || { role: 'staff', mp: {} }; return Promise.resolve({ role: u.role, isSuperAdmin: u.role === 'super_admin', mp: u.mp || {}, deny: {} }); },
  assertPermission: function () { return Promise.resolve({ ok: true }); }
});
var supa = require.resolve('@supabase/supabase-js', { paths: [root] });
require.cache[supa] = { id: supa, filename: supa, loaded: true, exports: { createClient: function () { return state.db; } } };
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test'; process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test'; process.env.WAVE_ACCESS_TOKEN = 'test-token';
global.fetch = function () { state.waveCalls++; return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(state.waveOk ? { data: { invoiceDelete: { didSucceed: true, inputErrors: [] } } } : { data: { invoiceDelete: { didSucceed: false, inputErrors: [{ message: 'Wave says no' }] } } }); } }); };
var R = require(path.join(root, 'src/app/api/wave/delete-invoice/route.js'));
// the database step, answering like sql/v55-83-UM-invoice-delete.sql (which is proven on real Postgres) for the fixture's state
function step(p) {
  state.rpcCalls.push(p);
  var inv = (state.db.t.accounting_invoices || []).filter(function (x) { return x.id === p.id; })[0];
  if (!inv) { return { data: { ok: false, code: 'not_found' }, error: null }; }
  if (!p.is_super && inv.business_id && !(state.db.t.user_business_memberships || []).some(function (m) { return m.user_id === p.actor && m.business_id === inv.business_id; })) { return { data: { ok: false, code: 'scope' }, error: null }; }
  var st = inv.record_status || 'active';
  if (st !== 'active') { return { data: { ok: false, code: 'state', status: st }, error: null }; }
  if (inv.source === 'wave_import') { return { data: { ok: false, code: 'historical' }, error: null }; }
  if (!p.after_wave_delete && inv.wave_invoice_id) { return { data: { ok: false, code: 'wave' }, error: null }; }
  if ((state.db.t.accounting_invoice_payments || []).some(function (x) { return x.accounting_invoice_id === p.id; }) || (state.db.t.payment_matches || []).some(function (x) { return x.invoice_id === p.id && x.voided !== true; })) { return { data: { ok: false, code: 'payments', count: 1 }, error: null }; }
  if (p.check_only) { return { data: { ok: true, check_only: true, action: 'delete' }, error: null }; }
  state.db.t.accounting_invoices = state.db.t.accounting_invoices.filter(function (x) { return x.id !== p.id; });
  return { data: { ok: true, action: 'delete', released: 0, name: inv.invoice_number }, error: null };
}
function fresh(invPatch, extra) {
  state.db = new FakeDb({}); state.waveCalls = 0; state.rpcCalls = []; state.waveOk = true; state.who = { userId: 'u-switch' };
  state.users = { 'u-switch': { role: 'staff', mp: { 'invoice.delete': true } }, 'u-plain': { role: 'accounting_manager', mp: {} }, 'u-super': { role: 'super_admin', mp: {} } };
  state.db.t.accounting_invoices = [Object.assign({ id: ID, invoice_number: 'INV-9', record_status: 'active', wave_invoice_id: 'W9', wave_business_id: WB, business_id: 'biz-A', total_amount: 10 }, invPatch || {})];
  state.db.t.wave_business_registry = [{ wave_business_id: WB, label: 'Test', writes_enabled: true, allow_invoice_push: true, is_production: false }];
  state.db.t.user_business_memberships = [{ user_id: 'u-switch', business_id: 'biz-A' }];
  state.db.t.accounting_invoice_payments = []; state.db.t.payment_matches = []; state.db.t.wave_sync_log = [];
  Object.assign(state.db.t, extra || {});
  state.db.rpcs.hub_invoice_lifecycle = function (args) { return step(args.p); };
}
function call(body) { return R.POST(new Request('http://x/api', { method: 'POST', body: JSON.stringify(Object.assign({ wave_business_id: WB, hub_record_id: ID, confirm_delete: true }, body || {})), headers: { 'content-type': 'application/json', authorization: 'Bearer t' } })).then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); }); }
function inv() { return (state.db.t.accounting_invoices || [])[0]; }
function untouched() { var i = inv(); return !!i && i.wave_invoice_id === 'W9' && state.waveCalls === 0; }
(async function () {
  for (var st of ['archived', 'void', 'cancelled']) {
    fresh({ record_status: st }); var r = await call();
    check(st + ' invoice → refused (409), ZERO Wave calls, invoice and its Wave link untouched', r.status === 409 && /Nothing was deleted anywhere/.test(r.j.error) && untouched() && inv().record_status === st, r);
  }
  fresh({}, { payment_matches: [{ id: 'pm1', invoice_id: ID, voided: false }] }); var r2 = await call();
  check('a live payment MATCH only (no payment record) → refused, ZERO Wave calls, untouched', r2.status === 409 && /Payments are never deleted/.test(r2.j.error) && untouched(), r2);
  fresh({}, { accounting_invoice_payments: [{ id: 'ap1', accounting_invoice_id: ID, amount: 5 }] }); var r3 = await call({ acknowledge_hub_payments: true });
  check('a payment record → refused even with the old "acknowledge" flag; ZERO Wave calls; the payment record is still there', r3.status === 409 && untouched() && state.db.t.accounting_invoice_payments.length === 1, r3);
  fresh({ business_id: 'biz-B' }); var r4 = await call();
  check('an invoice of a business the person is NOT a member of → 403, ZERO Wave calls, untouched', r4.status === 403 && /not a member of/.test(r4.j.error) && untouched(), r4);
  fresh({ business_id: 'biz-B' }); state.who = { userId: 'u-super' }; var r4b = await call();
  check('… the super admin may (every business): deleted in Wave and the Hub', r4b.status === 200 && r4b.j.ok && state.waveCalls === 1 && !inv(), r4b);
  fresh(); state.who = { userId: 'u-plain' }; var r5 = await call();
  check('no switch (Accounting Manager role alone) → 403 before anything; the database step is never called', r5.status === 403 && untouched() && state.rpcCalls.length === 0, r5);
  fresh(); state.who = { error: 'Sign in again.', status: 401 }; var r6 = await call({ user_id: 'u-super' });
  check('no verified sign-in → 401, nothing called', r6.status === 401 && untouched() && state.rpcCalls.length === 0, r6);
  fresh(); state.db.rpcs.hub_invoice_lifecycle = function () { return { data: null, error: { message: 'Could not find the function public.hub_invoice_lifecycle(p) in the schema cache' } }; }; var r7 = await call();
  check('database step not installed → 409 "run the UM SQL", ZERO Wave calls, untouched', r7.status === 409 && /v55-83-UM-invoice-delete\.sql/.test(r7.j.error) && untouched(), r7);
  fresh({ source: 'wave_import' }); var r8 = await call();
  check('imported from Wave → refused, ZERO Wave calls', r8.status === 409 && untouched(), r8);
  // the good path, in order
  fresh(); var ok = await call();
  check('clean invoice: check first (changes nothing), then ONE Wave delete, then the Hub step; invoice gone', ok.status === 200 && ok.j.ok === true && ok.j.deleted_in_wave === true && state.waveCalls === 1 && state.rpcCalls.length === 2 && state.rpcCalls[0].check_only === true && state.rpcCalls[0].after_wave_delete === true && !state.rpcCalls[1].check_only && state.rpcCalls[1].actor === 'u-switch' && !inv(), [ok, state.rpcCalls]);
  fresh(); state.waveOk = false; var w = await call();
  check('Wave refuses → nothing deleted anywhere, the Hub step never run for real', w.status === 502 && !!inv() && inv().wave_invoice_id === 'W9' && state.rpcCalls.length === 1, w);
  // a payment recorded in the moment between the check and the Hub step
  fresh(); var n = 0; state.db.rpcs.hub_invoice_lifecycle = function (args) { n++; if (n === 2) { state.db.t.accounting_invoice_payments.push({ id: 'late', accounting_invoice_id: ID, amount: 1 }); } return step(args.p); };
  var race = await call();
  check('a payment recorded between the check and the Hub step: the truth is reported — Wave copy deleted, Hub invoice kept (unlinked), told to void / archive (not "use Delete")', race.status === 500 && race.j.deleted_in_wave === true && /NOT deleted/.test(race.j.error) && /void or archive it there/.test(race.j.error) && !/use the normal Delete/.test(race.j.error) && !!inv() && inv().wave_invoice_id === null && state.db.t.accounting_invoice_payments.length === 1, race);
  console.log('\nUM Wave delete preflight: ' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
