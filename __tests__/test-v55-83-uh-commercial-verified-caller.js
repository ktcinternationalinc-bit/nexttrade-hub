// ═══════════════════════════════════════════════════════════════════════════
// v55.83-UH — Codex QA 18 Nov 12:40 (P1): the Sourcing desk route must act only for the person whose sign-in token
// was verified, never for a user_id in the request body.
// Runs the REAL /api/commercial POST handler with the REAL verified-caller.js, bank-visibility.js (identity part) and
// server-permissions.js. Only the database / Supabase Auth (in-memory stand-in), the audit writer, the research worker
// and the mail sender are stand-ins — no network, no mail, no paid search.
// Run: node __tests__/test-v55-83-uh-commercial-verified-caller.js
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path');
var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var FakeDb = require('./fake-supabase.js').FakeDb;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 600))); }

// ── identities (Supabase Auth ids → Hub profile ids)
var MAX = '11111111-1111-4111-8111-111111111111', MAX_AUTH = 'a1111111-1111-4111-8111-111111111111';
var STAFF = '22222222-2222-4222-8222-222222222222', STAFF_AUTH = 'a2222222-2222-4222-8222-222222222222';
var APPROVER = '33333333-3333-4333-8333-333333333333', APPROVER_AUTH = 'a3333333-3333-4333-8333-333333333333';
var ADMIN = '44444444-4444-4444-8444-444444444444', ADMIN_AUTH = 'a4444444-4444-4444-8444-444444444444';
var BANNED_AUTH = 'a5555555-5555-4555-8555-555555555555';
var NOBODY = '66666666-6666-4666-8666-666666666666', NOBODY_AUTH = 'a6666666-6666-4666-8666-666666666666';
var TOKENS = {
  'tok-max': { id: MAX_AUTH }, 'tok-staff': { id: STAFF_AUTH }, 'tok-approver': { id: APPROVER_AUTH }, 'tok-admin': { id: ADMIN_AUTH },
  'tok-banned': { id: BANNED_AUTH, banned_until: '2999-01-01T00:00:00Z' }, 'tok-noprofile': { id: NOBODY_AUTH },
};
var PROFILE_OF = {}; PROFILE_OF[MAX_AUTH] = MAX; PROFILE_OF[STAFF_AUTH] = STAFF; PROFILE_OF[APPROVER_AUTH] = APPROVER; PROFILE_OF[ADMIN_AUTH] = ADMIN;

var state = { db: null, audits: [], sends: [], getUserCalls: 0, jobs: 0 };
function stub(rel, exportsObj) { var p = require.resolve(path.join(root, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj }; }
stub('src/lib/audit-server.js', { audit: function (db, actor, action, entity, id, details) { state.audits.push({ actor: actor, action: action, id: id, details: details }); return Promise.resolve(); } });
stub('src/lib/sourcing-server.js', {
  monthUsage: function () { return Promise.resolve({ searches: 0, usd: 0 }); },
  integrationHealth: function () { return Promise.resolve([]); },
  runNextJob: function () { state.jobs++; return Promise.resolve({ ran: false }); },
});
stub('src/lib/commercial-mail-server.js', {
  mailConfig: function () { return { configured: true, user: 'info@ktcus.com', sender: null, smtp_host: 'x', smtp_port: 465 }; },
  sendApproved: function (db, id, o) { state.sends.push({ id: id, actorId: o && o.actorId }); return Promise.resolve({ ok: true }); },
  testMailbox: function () { return Promise.resolve({ ok: true }); },
  checkInbox: function () { return Promise.resolve({ ok: true }); },
  prepareFollowUps: function () { return Promise.resolve(0); },
});
var supa = require.resolve('@supabase/supabase-js', { paths: [root] });
require.cache[supa] = { id: supa, filename: supa, loaded: true, exports: { createClient: function (url, key) {
  if (key === 'anon-key') {
    return { auth: { getUser: function (t) { state.getUserCalls++; var u = TOKENS[t]; return Promise.resolve(u ? { data: { user: Object.assign({ is_anonymous: false }, u) }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } }); } } };
  }
  return state.db;
} } };
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'; process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test'; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
process.env.CRON_SECRET = 'cron-secret-for-tests-0123456789';

var R = require(path.join(root, 'src/app/api/commercial/route.js'));
function post(body, token, extraHeaders) {
  var h = Object.assign({ 'content-type': 'application/json', origin: 'http://hub.test' }, extraHeaders || {});
  if (token) { h.authorization = 'Bearer ' + token; }
  return R.POST(new Request('http://hub.test/api/commercial', { method: 'POST', body: JSON.stringify(body), headers: h })).then(function (r) { return r.json().then(function (j) { j._status = r.status; return j; }); });
}

var REQ = '77777777-7777-4777-8777-777777777777', SUP = '88888888-8888-4888-8888-888888888888', MSG = '99999999-9999-4999-8999-999999999999';
function seed() {
  var db = new FakeDb({});
  var orig = db.from;
  db.from = function (t) { var q = orig(t); state.reads = state.reads || []; state.reads.push(t); q.single = function () { q._one = true; return q; };
    var ex = q.exec; q.exec = function () { var s = q.single; if (typeof s === 'function') { q.single = false; } var out = ex.call(q); q.single = s; if (q._one && out && Array.isArray(out.data)) { out.data = out.data[0] || null; } return out; }; return q; };
  db.rpc = function (name, args) {
    if (name !== 'bank_visibility_profile_for_identity') { return Promise.resolve({ data: null, error: { message: 'no such rpc' } }); }
    var p = PROFILE_OF[args.p_auth_user_id]; return Promise.resolve({ data: p ? [{ profile_id: p }] : [], error: null });
  };
  db.t.users = [{ id: MAX, name: 'Max', role: 'super_admin' }, { id: STAFF, name: 'Staff', role: 'employee' }, { id: APPROVER, name: 'Approver', role: 'employee' }, { id: ADMIN, name: 'Admin', role: 'admin' }];
  db.t.module_permissions = [
    { user_id: STAFF, module_name: 'commercial.access', has_access: true },
    { user_id: APPROVER, module_name: 'commercial.access', has_access: true }, { user_id: APPROVER, module_name: 'commercial.approve', has_access: true },
    { user_id: ADMIN, module_name: 'commercial.approve', has_access: false }, { user_id: ADMIN, module_name: 'commercial.research', has_access: false },
  ];
  db.t.suppliers = [{ id: SUP, legal_name: 'Secret Supplier Ltd', products: 'PVC' }];
  db.t.sourcing_requests = [{ id: REQ, seq: 1, stage: 'drafts_ready', created_by: STAFF, owner_id: STAFF }];
  db.t.commercial_messages = [{ id: MSG, request_id: REQ, supplier_id: SUP, direction: 'out', kind: 'first', status: 'pending_approval', to_address: 'sales@example.test', subject: 'Price', body: 'Hello', content_hash: 'h1', submitted_by: STAFF, created_by: STAFF }];
  return db;
}
function msg() { return state.db.t.commercial_messages.filter(function (m) { return m.id === MSG; })[0]; }

(async function () {
  console.log('UH — who is calling comes from the verified token, never from body.user_id');
  state.db = seed(); state.reads = [];
  var r1 = await post({ action: 'suppliers', user_id: MAX });
  check('no token + a super admin id in the body → 401, no supplier data', r1._status === 401 && !r1.suppliers, r1);
  check('… no supplier / permission table was read', state.reads.indexOf('suppliers') < 0 && state.reads.indexOf('module_permissions') < 0, state.reads);
  var r2 = await post({ action: 'suppliers', user_id: MAX }, 'tok-forged');
  check('an invalid token → 401, no data', r2._status === 401 && !r2.suppliers, r2);
  var r3 = await post({ action: 'suppliers' }, 'tok-banned');
  check('an inactive (banned) sign-in → 403, no data', r3._status === 403 && !r3.suppliers, r3);
  var r3b = await post({ action: 'suppliers' }, 'tok-noprofile');
  check('a sign-in that is not one active Hub user → 403, no data', r3b._status === 403 && !r3b.suppliers, r3b);
  state.reads = [];
  var r4 = await post({ action: 'suppliers', user_id: MAX }, 'tok-staff');
  check('staff token + Max\'s id in the body → 403 (mismatch refused), no data', r4._status === 403 && /not the signed-in user/.test(r4.error) && !r4.suppliers, r4);
  check('… no supplier table was read', state.reads.indexOf('suppliers') < 0, state.reads);
  var r4b = await post({ action: 'suppliers', user_id: MAX.toUpperCase() }, 'tok-max');
  check('the signed-in person\'s own id in the body (any letter case) is accepted', r4b._status === 200 && r4b.ok, r4b);
  var r5 = await post({ action: 'suppliers' }, 'tok-staff');
  check('staff with the "Sourcing desk" switch, own token, no body id → 200 with suppliers', r5._status === 200 && r5.suppliers && r5.suppliers.length === 1, r5);
  var cs = await post({ action: 'suppliers' }, 'cron-secret-for-tests-0123456789');
  check('the timer secret is not a sign-in on this route → 401', cs._status === 401 && !cs.suppliers, cs);

  console.log('UH — permissions are decided for the VERIFIED person');
  state.db.t.module_permissions.push({ user_id: STAFF, module_name: 'commercial.access', has_access: false });
  state.db.t.module_permissions = state.db.t.module_permissions.filter(function (p) { return !(p.user_id === STAFF && p.module_name === 'commercial.access' && p.has_access === true); });
  var r6 = await post({ action: 'suppliers', user_id: STAFF }, 'tok-staff');
  check('staff whose switch is OFF → 403 even though the body names them', r6._status === 403 && !r6.suppliers, r6);
  state.db = seed();
  // v55.83-UH on UG: a role (admin / owner) no longer gives commercial.* — only switches do
  var r6b = await post({ action: 'suppliers' }, 'tok-admin');
  check('an admin with NO "Sourcing desk" switch → 403 (since UG the role alone gives nothing here)', r6b._status === 403 && !r6b.suppliers, r6b);
  state.db.t.module_permissions.push({ user_id: ADMIN, module_name: 'commercial.access', has_access: true });
  var r6c = await post({ action: 'suppliers' }, 'tok-admin');
  check('… the same admin once the switch is ON → 200', r6c._status === 200 && r6c.suppliers && r6c.suppliers.length === 1, r6c);
  var r7 = await post({ action: 'start_research', id: REQ }, 'tok-staff');
  check('staff without "Start web research" → 403 for paid research, no job queued', r7._status === 403 && !(state.db.t.agent_jobs || []).length, r7);
  var r7b = await post({ action: 'run_now', id: REQ }, 'tok-staff');
  check('… and "Run now" → 403, the worker is not started', r7b._status === 403 && state.jobs === 0, r7b);
  var r7c = await post({ action: 'start_research', id: REQ, user_id: MAX }, 'tok-staff');
  check('… naming Max in the body does not help → 403', r7c._status === 403, r7c);

  console.log('UH — approval and sending: only a verified approver, recorded under that person');
  var a1 = await post({ action: 'approve', id: REQ, message_id: MSG, seen_hash: 'h1', user_id: MAX });
  check('approve with no token but Max\'s id → 401, still waiting, nothing sent', a1._status === 401 && msg().status === 'pending_approval' && state.sends.length === 0, a1);
  var a2 = await post({ action: 'approve', id: REQ, message_id: MSG, seen_hash: 'h1', user_id: APPROVER }, 'tok-staff');
  check('staff token + an approver\'s id in the body → 403, nothing sent', a2._status === 403 && msg().status === 'pending_approval' && state.sends.length === 0, a2);
  var a3 = await post({ action: 'approve', id: REQ, message_id: MSG, seen_hash: 'h1' }, 'tok-staff');
  check('staff (desk switch only) with own token → 403 for approving, nothing sent', a3._status === 403 && msg().status === 'pending_approval' && state.sends.length === 0, a3);
  var a4 = await post({ action: 'approve', id: REQ, message_id: MSG, seen_hash: 'h1' }, 'tok-admin');
  check('an admin whose "Approve outgoing messages" switch is OFF → 403, nothing sent', a4._status === 403 && msg().status === 'pending_approval' && state.sends.length === 0, a4);
  var a5 = await post({ action: 'approve', id: REQ, message_id: MSG, seen_hash: 'h1' }, 'tok-approver');
  check('a verified approver → approved and handed to the sender', a5._status === 200 && a5.ok && msg().status === 'approved' && state.sends.length === 1, a5);
  check('… approved_by and the sender\'s actor are the VERIFIED approver', msg().approved_by === APPROVER && state.sends[0].actorId === APPROVER, [msg().approved_by, state.sends[0]]);
  check('… the audit entry is under the verified approver', state.audits.some(function (a) { return a.action === 'commercial_message_approved' && a.actor === APPROVER; }), state.audits);
  check('no audit entry was ever written under an id taken from a body', state.audits.every(function (a) { return a.actor === APPROVER || a.actor === STAFF || a.actor === MAX || a.actor === ADMIN; }) && !state.audits.some(function (a) { return a.actor === MAX; }), state.audits);

  console.log('UH — the screen sends the sign-in token');
  var tab = fs.readFileSync(path.join(root, 'src/components/SourcingDeskTab.jsx'), 'utf8');
  check('SourcingDeskTab calls /api/commercial through hubFetch (sends the token)', /import \{ hubFetch \} from '\.\.\/lib\/hub-fetch'/.test(tab) && /hubFetch\('\/api\/commercial'/.test(tab) && !/[^b]fetch\('\/api\/commercial'/.test(tab));
  var route = fs.readFileSync(path.join(root, 'src/app/api/commercial/route.js'), 'utf8');
  check('the route never reads body.user_id as the identity', !/userId\s*=\s*body\.user_id/.test(route) && /verifiedCaller\(req, body, createClient\)/.test(route));
  check('verifiedCaller runs before the first permission check', route.indexOf('verifiedCaller(req, body') < route.indexOf("assertPermission(db, userId, 'commercial.access'"));

  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
