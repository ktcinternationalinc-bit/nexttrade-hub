// ═══════════════════════════════════════════════════════════════════════════
// v55.83-WQ — Codex 21 Nov (permissions plan, F3): every accounting route acts ONLY for the person whose sign-in token
// is verified, never for a user_id written into the request. Run against the REAL route handlers, the REAL
// verified-caller → bank-visibility identity check and the REAL permission resolver (server-permissions.js), with an
// in-memory database and a stand-in sign-in server (no network). For every route:
//   • no sign-in token, even with the super admin's id in the request → 401, nothing answered
//   • a staff member's token with the SUPER ADMIN's id in the request → 403, nothing answered
// plus normal work: a staff member with the right switches still gets their answer (no user_id needed), a staff
// member without them is refused as THEMSELVES, one person cannot record both wire signatures by sending another id,
// and the assistant's cash-totals tool answers only with "Bank & Financial Summary".
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path');
var Module = require('module');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.WAVE_ACCESS_TOKEN = 'wave-test';
require(path.join(root, 'node_modules/sucrase/register'));
var FakeDb = require('./fake-supabase.js').FakeDb;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 400))); }
console.log('WQ — verified identity on every accounting route (real handlers)');

// ── people: Hub profile id ≠ sign-in (auth) id, as on live
var SUPER = '11111111-1111-4111-8111-111111111111', STAFF = '22222222-2222-4222-8222-222222222222', STAFF2 = '33333333-3333-4333-8333-333333333333';
var AUTH = { 'tok-super': 'aaaaaaaa-0000-4000-8000-000000000001', 'tok-staff': 'aaaaaaaa-0000-4000-8000-000000000002', 'tok-staff2': 'aaaaaaaa-0000-4000-8000-000000000003' };
var PROFILE_OF = {}; PROFILE_OF[AUTH['tok-super']] = SUPER; PROFILE_OF[AUTH['tok-staff']] = STAFF; PROFILE_OF[AUTH['tok-staff2']] = STAFF2;

var world = { db: null };
function fresh(perms) {
  var db = new FakeDb({});
  db.t.users = [{ id: SUPER, role: 'super_admin', active: true, name: 'Owner' }, { id: STAFF, role: 'admin', active: true, name: 'Staff' }, { id: STAFF2, role: 'staff', active: true, name: 'Staff two' }];
  db.t.module_permissions = [];
  Object.keys(perms || {}).forEach(function (uid) { perms[uid].forEach(function (k) { db.t.module_permissions.push({ user_id: uid, module_name: k, has_access: true }); }); });
  ['hub_audit_log', 'vendor_bill_events', 'vendor_bills', 'app_settings', 'treasury', 'bank_transactions', 'wire_audits', 'plaid_accounts'].forEach(function (t) { db.t[t] = db.t[t] || []; });
  db.rpcs.bank_visibility_profile_for_identity = function (a) { var p = PROFILE_OF[a.p_auth_user_id]; return { data: p ? [{ profile_id: p }] : [], error: null }; };
  db.writes = 0;
  world.db = db; return db;
}
fresh({});
// the stand-in Supabase: the browser key gives the sign-in server, the service key gives the database
var authClient = { auth: { getUser: function (tok) { var id = AUTH[tok]; return Promise.resolve(id ? { data: { user: { id: id } }, error: null } : { data: { user: null }, error: { message: 'bad token' } }); } } };
var supaStub = { createClient: function (url, key) { if (key === 'anon-key') { return authClient; } return new Proxy({}, { get: function (t, k) { var d = world.db; var v = d[k]; return typeof v === 'function' ? v.bind(d) : v; } }); } };
var supaPath = require.resolve('@supabase/supabase-js', { paths: [root] });
require.cache[supaPath] = { id: supaPath, filename: supaPath, loaded: true, exports: supaStub };
var origResolve = Module._resolveFilename;
Module._resolveFilename = function (req) { if (req === '@supabase/supabase-js') { return supaPath; } return origResolve.apply(this, arguments); };

// the assistant's outside call (Anthropic) — first answer asks for the cash tool, second answer finishes
var aiTurn = 0;
global.fetch = function (url) {
  if (String(url).indexOf('anthropic') >= 0) {
    aiTurn++;
    var body = aiTurn % 2 === 1
      ? { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'query_treasury', input: { date_from: '2026-01-01', date_to: '2026-12-31' } }] }
      : { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] };
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(body); }, text: function () { return Promise.resolve(JSON.stringify(body)); } });
  }
  return Promise.reject(new Error('no network in tests: ' + url));
};

function load(rel) { return require(path.join(root, 'src/app/api', rel, 'route.js')); }
function req(method, token, body, query) {
  var h = { origin: 'http://hub.test', 'content-type': 'application/json' };
  if (token) { h.authorization = 'Bearer ' + token; }
  var init = { method: method, headers: h };
  if (method !== 'GET') { init.body = JSON.stringify(body || {}); }
  return new Request('http://hub.test/api/x' + (query || ''), init);
}
async function run(rel, method, token, body, query) {
  var mod = load(rel); var r = await mod[method](req(method, token, body, query));
  var j = null; try { j = await r.json(); } catch (e) { j = null; }
  return { status: r.status, j: j || {} };
}
function noData(j) { var keys = Object.keys(j || {}).filter(function (k) { return ['ok', 'error', 'api_build_marker', 'answer'].indexOf(k) < 0; }); return keys.length === 0; }

var POST_ROUTES = [
  ['accounting/bills', { action: 'list' }], ['accounting/bills/repeating', { action: 'list' }], ['accounting/bills/email-scan', {}],
  ['accounting/wire-packages', { action: 'list' }], ['accounting/wires', { action: 'list' }], ['accounting/expense-rules', { action: 'list' }],
  ['accounting/duplicates', { action: 'scan' }], ['accounting/audit', { action: 'list' }], ['accounting/payables', { action: 'status' }],
  ['accounting/sales-report', {}], ['accounting/reminders', { action: 'list' }], ['accounting/statement-import', { action: 'targets' }],
  ['accounting/invoice-write', { action: 'set_approval', invoice_id: 'i1', status: 'approved' }], ['ai/reports', { question: 'open invoices' }],
  ['reconcile/nexttrade', { action: 'open_balances' }], ['admin/visibility', { window: 'all' }], ['accountant', { audit: {} }],
  ['ask-v2', { question: 'cash this year' }], ['wave/invoice-diagnostic', { businessId: 'B1' }],
];
var GET_ROUTES = [['wave/audit', ''], ['wave/check', ''], ['wave/import-preview', '?businessId=B1&type=customers&page=1']];

(async function () {
  // ── 1 + 2: every route, no token / someone else's id
  for (var i = 0; i < POST_ROUTES.length; i++) {
    var rt = POST_ROUTES[i][0]; var b = POST_ROUTES[i][1];
    fresh({}); var bodyAsSuper = Object.assign({}, b, { user_id: SUPER, userId: SUPER });
    var a = await run(rt, 'POST', null, bodyAsSuper);
    check(rt + ': no sign-in token, the super admin\'s id in the request → 401, nothing answered', a.status === 401 && noData(a.j), a);
    var s = await run(rt, 'POST', 'tok-staff', bodyAsSuper);
    check(rt + ': a staff token with the SUPER ADMIN\'s id in the request → 403, nothing answered', s.status === 403 && noData(s.j) && /not the signed-in user/.test(String(s.j.error || '')), s);
    var bad = await run(rt, 'POST', 'tok-forged', bodyAsSuper);
    check(rt + ': a token the sign-in server does not know → 401', bad.status === 401 && noData(bad.j), bad);
  }
  for (var g = 0; g < GET_ROUTES.length; g++) {
    fresh({});
    var ga = await run(GET_ROUTES[g][0], 'GET', null, null, GET_ROUTES[g][1]);
    check(GET_ROUTES[g][0] + ': no sign-in token → 401 (this route answered anyone before)', ga.status === 401 && noData(ga.j), ga);
  }

  // ── 3: normal work goes on for the right person, and a refusal is about the SIGNED-IN person
  fresh({}); world.db.t.users[1].role = 'staff';
  world.db.t.module_permissions = ['accounting.clickbooks.access', 'audit.view'].map(function (k) { return { user_id: STAFF, module_name: k, has_access: true }; });
  world.db.t.hub_audit_log = [{ at: '2026-11-20T10:00:00Z', actor_id: STAFF, action: 'bill_created', entity: 'vendor_bill', entity_id: 'b1', details: {} }];
  var au = await run('accounting/audit', 'POST', 'tok-staff', { action: 'list' });
  check('audit: a staff member with "Audit: View Trail" reads the trail with their token alone (no user_id sent)', au.status === 200 && au.j.ok === true && Array.isArray(au.j.rows) && au.j.rows.length >= 1, au);
  var au2 = await run('accounting/audit', 'POST', 'tok-staff', { action: 'list', user_id: STAFF });
  check('audit: … and with their own id in the request (as the screens send it) the same', au2.status === 200 && au2.j.ok === true, au2);
  var au3 = await run('accounting/audit', 'POST', 'tok-staff2', { action: 'list' });
  check('audit: a second staff member WITHOUT the switches is refused as themselves (403), even though the first one has them', au3.status === 403 && au3.j.ok === false && noData(au3.j), au3);
  var auS = await run('accounting/audit', 'POST', 'tok-super', { action: 'list' });
  check('audit: the super admin reads it (role is taken from the VERIFIED profile)', auS.status === 200 && auS.j.ok === true, auS);

  // ── 4: one person cannot record both wire signatures by sending another person's id
  fresh({});
  [STAFF, STAFF2].forEach(function (u) { ['accounting.clickbooks.access', 'wires.signoff', 'wires.view'].forEach(function (k) { world.db.t.module_permissions.push({ user_id: u, module_name: k, has_access: true }); }); });
  world.db.t.wire_audits = [{ id: 'wa1', bank_transaction_id: 'tx1', check_hash: 'h1', check_pass: true, signoff1_by: STAFF, signoff1_at: '2026-11-20T10:00:00Z', signoff1_hash: 'h1', signoff2_by: null }];
  var before = JSON.stringify(world.db.t.wire_audits);
  var w2 = await run('accounting/wires', 'POST', 'tok-staff', { action: 'signoff', bank_transaction_id: 'tx1', user_id: STAFF2 });
  check('wires: the first signer sends the SECOND signature with a colleague\'s id → 403, the record is unchanged', w2.status === 403 && JSON.stringify(world.db.t.wire_audits) === before, w2);
  var wp2 = await run('accounting/wire-packages', 'POST', 'tok-staff', { action: 'signoff', id: 'p1', user_id: STAFF2 });
  check('wire packages: the same attempt on a wire package → 403', wp2.status === 403, wp2);

  // ── 5: history window can only be changed by the verified super admin
  fresh({});
  var hv = await run('admin/visibility', 'POST', 'tok-staff', { window: 'all' });
  check('history window: a staff token (admin role, no id sent) → refused, nothing saved', hv.status === 403 && world.db.t.app_settings.length === 0, hv);
  var hvS = await run('admin/visibility', 'POST', 'tok-super', { window: 'all' });
  check('history window: the verified super admin can still change it', hvS.status === 200 && hvS.j.ok === true, hvS);

  // ── 6: the assistant's cash totals need "Bank & Financial Summary"
  fresh({}); world.db.t.treasury = [{ id: 't1', transaction_date: '2026-03-01', cash_in: 100, cash_out: 40, description: 'x', category: 'c' }];
  aiTurn = 0;
  var n1 = await run('ask-v2', 'POST', 'tok-staff', { question: 'cash this year' });
  var tc1 = (n1.j.tool_calls || [])[0] || {};
  check('assistant: a staff member without "Bank & Financial Summary" asks for cash → the tool answers with a refusal, no rows, no totals', n1.status === 200 && tc1.name === 'query_treasury' && tc1.result && /Bank & Financial Summary/.test(tc1.result.error || '') && tc1.result.total_cash_in === undefined && tc1.result.transactions === undefined, n1);
  world.db.t.module_permissions.push({ user_id: STAFF, module_name: 'accounting.clickbooks.access', has_access: true }, { user_id: STAFF, module_name: 'accounting.view_totals', has_access: true });
  aiTurn = 0;
  var n2 = await run('ask-v2', 'POST', 'tok-staff', { question: 'cash this year' });
  var tc2 = (n2.j.tool_calls || [])[0] || {};
  check('assistant: … once Max switches it on, the same question gets the totals', tc2.result && tc2.result.total_cash_in === 100 && tc2.result.net === 60, n2);
  aiTurn = 0;
  var n3 = await run('ask-v2', 'POST', 'tok-super', { question: 'cash this year' });
  var tc3 = (n3.j.tool_calls || [])[0] || {};
  check('assistant: the super admin always gets them', tc3.result && tc3.result.total_cash_in === 100, n3);

  // ── 7: the scheduled mailbox scan keeps its own secret (no sign-in token involved)
  process.env.CRON_SECRET = 'cron-test-secret-0123456789';
  var cronReq = new Request('http://hub.test/api/x', { method: 'POST', headers: { authorization: 'Bearer cron-test-secret-0123456789', 'content-type': 'application/json' }, body: '{}' });
  var cr = await load('accounting/bills/email-scan').POST(cronReq); var cj = {}; try { cj = await cr.json(); } catch (eC) { cj = {}; }
  check('bills mailbox scan: the scheduled job (secret) is not asked for a person\'s sign-in', cr.status !== 401 && !/sign-in/i.test(String(cj.error || '')), { status: cr.status, j: cj });

  console.log('');
  console.log('WQ: ' + pass + ' passed, ' + failN + ' failed');
  if (failN > 0) { process.exit(1); }
})().catch(function (e) { console.log('CRASH ' + (e && e.stack)); process.exit(1); });
