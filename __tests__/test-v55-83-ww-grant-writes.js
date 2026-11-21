// ═══════════════════════════════════════════════════════════════════════════
// v55.83-WW — Max's rule 1 (Codex 21 Nov, step B): permission switches and roles are changed only by the server.
// Runs the REAL /api/admin/permissions route (real verified-caller identity check) and the REAL team-admin handlers
// (/api/users: real authorizeUserAdmin + authorizeUserAdminTarget) on an in-memory database with a stand-in sign-in
// server. Shows:
//   • only the verified super admin changes switches; a switch is written under every name it is stored under; each
//     change leaves an audit row (who, for whom, which switch, before, after)
//   • an admin / staff member is refused, nobody changes their own switches, a super admin's switches are not written,
//     no token = 401, another person's id in the request = 403
//   • roles: only the super admin makes someone super admin; nobody changes their own role; an admin cannot edit, switch
//     off or delete a super admin (also one missing from the env list); only the super admin deletes for good; unknown
//     roles are refused; role / active changes are audited
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path');
var Module = require('module');
var root = path.join(__dirname, '..');
var SUPER = '11111111-1111-4111-8111-111111111111', SUPER2 = '44444444-4444-4444-8444-444444444444', ADMIN = '22222222-2222-4222-8222-222222222222', STAFF = '33333333-3333-4333-8333-333333333333';
var ENV = { NEXT_PUBLIC_SUPABASE_URL: 'https://placeholder.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key', SUPABASE_SERVICE_ROLE_KEY: 'service-key', HUB_SUPER_ADMIN_AUTH_USER_IDS: SUPER, HUB_ADMIN_AUTH_USER_IDS: ADMIN };
Object.keys(ENV).forEach(function (k) { process.env[k] = ENV[k]; });
require(path.join(root, 'node_modules/sucrase/register'));
var FakeDb = require('./fake-supabase.js').FakeDb;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 500))); }
console.log('WW — permission switches and roles only through the server (real handlers)');

// sign-in ids = profile ids here (the legacy e-mail path is not under test)
var TOK = { 'tok-super': SUPER, 'tok-super2': SUPER2, 'tok-admin': ADMIN, 'tok-staff': STAFF };
var world = { db: null };
function fresh() {
  var db = new FakeDb({});
  db.t.users = [{ id: SUPER, role: 'super_admin', active: true, email: 's@x', name: 'Owner' }, { id: SUPER2, role: 'super_admin', active: true, email: 's2@x', name: 'Owner two' },
    { id: ADMIN, role: 'admin', active: true, email: 'a@x', name: 'Admin' }, { id: STAFF, role: 'team', active: true, email: 't@x', name: 'Staff' }];
  db.t.module_permissions = [{ id: 'mp1', user_id: STAFF, module_name: 'Payments: Match', has_access: false }];
  db.t.hub_audit_log = []; db.t.financial_visibility_permissions = [];
  db.rpcs.bank_visibility_profile_for_identity = function (a) { return { data: [{ profile_id: a.p_auth_user_id }], error: null }; };
  db.rpcs.bank_visibility_auth_ids_for_profile = function (a) { return { data: [{ auth_user_id: a.p_profile_id }], error: null }; };
  db.signins = []; // v55.83-WW — sign-ins the team screen created (stand-in for auth.admin)
  db.auth = { admin: { createUser: function (o) { var id = '55555555-5555-4555-8555-' + String(100000000000 + db.signins.length).substring(0, 12); db.signins.push(Object.assign({ id: id }, o)); return Promise.resolve({ data: { user: { id: id } }, error: null }); } } };
  world.db = db; return db;
}
fresh();
var authClient = { auth: { getUser: function (tok) { var id = TOK[tok]; return Promise.resolve(id ? { data: { user: { id: id, email_confirmed_at: 'x' } }, error: null } : { data: { user: null }, error: { message: 'bad token' } }); } } };
function createClient(url, key) { if (key === 'anon-key') { return authClient; } return new Proxy({}, { get: function (t, k) { var d = world.db; var v = d[k]; return typeof v === 'function' ? v.bind(d) : v; } }); }
var supaPath = require.resolve('@supabase/supabase-js', { paths: [root] });
require.cache[supaPath] = { id: supaPath, filename: supaPath, loaded: true, exports: { createClient: createClient } };
var origResolve = Module._resolveFilename;
Module._resolveFilename = function (req) { if (req === '@supabase/supabase-js') { return supaPath; } return origResolve.apply(this, arguments); };

var PERM = require(path.join(root, 'src/app/api/admin/permissions/route.js'));
var H = require(path.join(root, 'src/lib/user-admin-handlers.js')).createUserAdminHandlers(createClient, ENV);
function mkReq(method, token, body, query) {
  var h = { origin: 'http://hub.test', 'content-type': 'application/json' }; if (token) { h.authorization = 'Bearer ' + token; }
  var init = { method: method, headers: h }; if (method !== 'GET' && method !== 'DELETE') { init.body = JSON.stringify(body || {}); }
  return new Request('http://hub.test/api/x' + (query || ''), init);
}
async function perm(token, body) { var r = await PERM.POST(mkReq('POST', token, Object.assign({ action: 'set' }, body))); var j = {}; try { j = await r.json(); } catch (e) { j = {}; } return { status: r.status, j: j }; }
async function users(method, token, body, query) { var r = await H[method](mkReq(method, token, body, query)); var j = {}; try { j = await r.json(); } catch (e) { j = {}; } return { status: r.status, j: j }; }
function rowsOf(uid) { var o = {}; world.db.t.module_permissions.filter(function (r) { return r.user_id === uid; }).forEach(function (r) { o[r.module_name] = r.has_access; }); return o; }
function audits(action) { return world.db.t.hub_audit_log.filter(function (a) { return !action || a.action === action; }); }
function roleOf(id) { return world.db.t.users.filter(function (u) { return u.id === id; })[0].role; }

(async function () {
  // ── switches
  fresh();
  var a = await perm('tok-super', { target_user_id: STAFF, module_name: 'payments.match', has_access: true });
  var st = rowsOf(STAFF);
  check('super admin switches ON "payments.match" for a staff member → saved', a.status === 200 && a.j.ok === true, a);
  check('… under every name the switch is stored under (the old "Payments: Match" row ON too, the new name added)', st['Payments: Match'] === true && st['payments.match'] === true, st);
  var au = audits('permission_changed')[0] || {};
  check('… and an audit row says who, for whom, which switch, before and after', au.actor_id === SUPER && au.entity_id === STAFF && au.details && au.details.switch === 'payments.match' && au.details.to === true && au.details.before && au.details.before['Payments: Match'] === false, au);
  var off = await perm('tok-super', { target_user_id: STAFF, module_name: 'Payments: Match', has_access: false });
  st = rowsOf(STAFF);
  check('switching it OFF under its old name turns OFF every name (no stale ON left behind)', off.j.ok === true && st['Payments: Match'] === false && st['payments.match'] === false, st);
  var sens = await perm('tok-super', { target_user_id: STAFF, module_name: 'accounting.view_totals', has_access: true });
  check('the super admin can switch on a sensitive one (Bank & Financial Summary)', sens.j.ok === true && rowsOf(STAFF)['accounting.view_totals'] === true, sens);

  fresh(); var n0 = world.db.t.module_permissions.length;
  var b = await perm('tok-admin', { target_user_id: STAFF, module_name: 'wires.signoff', has_access: true });
  check('an ADMIN (not super admin) tries to switch on a wire signature for staff → 403, nothing written, nothing audited', b.status === 403 && world.db.t.module_permissions.length === n0 && audits().length === 0, b);
  var c = await perm('tok-staff', { target_user_id: STAFF, module_name: 'wires.signoff', has_access: true });
  check('a staff member tries to switch on their own wire signature → 403, nothing written', c.status === 403 && world.db.t.module_permissions.length === n0, c);
  var c2 = await perm('tok-staff', { user_id: SUPER, target_user_id: STAFF, module_name: 'wires.signoff', has_access: true });
  check('… even sending the super admin\'s id in the request → 403 (the sign-in decides who is asking)', c2.status === 403 && world.db.t.module_permissions.length === n0, c2);
  var c3 = await perm(null, { user_id: SUPER, target_user_id: STAFF, module_name: 'wires.signoff', has_access: true });
  check('… or with no sign-in at all → 401', c3.status === 401 && world.db.t.module_permissions.length === n0, c3);
  var d = await perm('tok-super', { target_user_id: SUPER, module_name: 'wires.signoff', has_access: false });
  check('the super admin cannot change their OWN switches either (403)', d.status === 403 && /own/.test(d.j.error || ''), d);
  var e = await perm('tok-super', { target_user_id: SUPER2, module_name: 'wires.signoff', has_access: false });
  check('a super admin\'s switches are not written (409: they have everything already)', e.status === 409 && world.db.t.module_permissions.length === n0, e);
  var f = await perm('tok-super', { target_user_id: STAFF, module_name: 'bank_balances.view', has_access: true });
  check('bank-balance access is refused here (it keeps its own verified route)', f.status === 400 && world.db.t.module_permissions.length === n0, f);
  var g = await perm('tok-super', { target_user_id: STAFF, module_name: 'wires.signoff', has_access: 'yes' });
  check('a value that is not ON / OFF is refused', g.status === 400, g);
  world.db.t.users[0].active = false;
  var h = await perm('tok-super', { target_user_id: STAFF, module_name: 'wires.signoff', has_access: true });
  check('a switched-off super admin account cannot change switches', h.status === 403, h);

  // ── roles (/api/users)
  fresh();
  var r1 = await users('PUT', 'tok-admin', { id: STAFF, role: 'super_admin' });
  check('an admin tries to make staff a SUPER ADMIN → 403, role unchanged', r1.status === 403 && roleOf(STAFF) === 'team', r1);
  var r2 = await users('PUT', 'tok-admin', { id: ADMIN, role: 'super_admin' });
  check('an admin tries to make THEMSELVES super admin → 403', r2.status === 403 && roleOf(ADMIN) === 'admin', r2);
  var r3 = await users('PUT', 'tok-admin', { id: SUPER2, name: 'Renamed' });
  check('an admin cannot edit a super admin\'s account (also one missing from the env list)', r3.status === 403 && world.db.t.users[1].name === 'Owner two', r3);
  var r4 = await users('PUT', 'tok-admin', { id: STAFF, role: 'root' });
  check('an unknown role is refused (400)', r4.status === 400 && roleOf(STAFF) === 'team', r4);
  var r5 = await users('PUT', 'tok-admin', { id: STAFF, role: 'viewer' });
  check('an admin can still make staff a viewer (ordinary team work goes on) …', r5.status === 200 && roleOf(STAFF) === 'viewer', r5);
  var ra = audits('user_role_changed')[0] || {};
  check('… and the change is audited with before and after', ra.actor_id === ADMIN && ra.entity_id === STAFF && ra.details && ra.details.before === 'team' && ra.details.after === 'viewer', ra);
  var r6 = await users('PUT', 'tok-super', { id: SUPER, role: 'admin' });
  check('nobody changes their own role — not even the super admin (403)', r6.status === 403 && roleOf(SUPER) === 'super_admin', r6);
  var r7 = await users('PUT', 'tok-super', { id: ADMIN, role: 'super_admin' });
  check('the super admin CAN make someone super admin (and it is audited)', r7.status === 200 && roleOf(ADMIN) === 'super_admin' && audits('user_role_changed').some(function (x) { return x.entity_id === ADMIN && x.details.after === 'super_admin'; }), r7);
  fresh();
  var r8 = await users('POST', 'tok-admin', { email: 'n@x', password: 'not-used-in-test', name: 'New', role: 'super_admin' });
  check('an admin cannot CREATE a new super admin (403, no account made)', r8.status === 403 && world.db.t.users.length === 4, r8);
  var r9 = await users('POST', 'tok-admin', { email: 'n@x', password: 'not-used-in-test', name: 'New', role: 'boss' });
  check('creating with an unknown role is refused', r9.status === 400 && world.db.t.users.length === 4, r9);
  var r10 = await users('DELETE', 'tok-admin', null, '?id=' + STAFF + '&permanent=true');
  check('only the super admin deletes an account for good (admin → 403, the person is still there)', r10.status === 403 && world.db.t.users.length === 4, r10);
  var r11 = await users('DELETE', 'tok-admin', null, '?id=' + SUPER2);
  check('an admin cannot switch off a super admin', r11.status === 403 && world.db.t.users[1].active === true, r11);
  var r12 = await users('DELETE', 'tok-admin', null, '?id=' + ADMIN);
  check('nobody switches off their own account', r12.status === 403 && world.db.t.users[2].active === true, r12);
  var r13 = await users('DELETE', 'tok-admin', null, '?id=' + STAFF);
  check('an admin can still switch off a staff account, and it is audited', r13.status === 200 && world.db.t.users[3].active === false && audits('user_deactivated').some(function (x) { return x.entity_id === STAFF && x.actor_id === ADMIN; }), r13);
  // ── Codex 09:02 P1: the starting switches of a NEW person are a grant too
  fresh(); var mp0 = world.db.t.module_permissions.length;
  var c1 = await users('POST', 'tok-admin', { email: 'n1@x', password: 'not-used-in-test', name: 'New one', role: 'team', modules: ['Treasury', 'Admin', 'Reports'] });
  check('an ADMIN adds a person WITH starting switches (Treasury, Admin, Reports) → 403 before anything is made: no sign-in, no profile, no switches, no audit', c1.status === 403 && world.db.signins.length === 0 && world.db.t.users.length === 4 && world.db.t.module_permissions.length === mp0 && audits('user_created').length === 0, { c1: c1, signins: world.db.signins.length });
  var c1b = await users('POST', 'tok-admin', { email: 'n1@x', password: 'not-used-in-test', name: 'New one', role: 'team', modules: 'Treasury' });
  check('starting switches that are not a list are refused (400), nothing made', c1b.status === 400 && world.db.signins.length === 0, c1b);
  var c2 = await users('POST', 'tok-admin', { email: 'n2@x', password: 'not-used-in-test', name: 'New two', role: 'team', modules: [] });
  var newId = c2.j && c2.j.user && c2.j.user.id; var newRows = world.db.t.module_permissions.filter(function (r) { return r.user_id === newId; });
  check('an ADMIN can still add a person with NO switches ticked → made, every starting switch OFF', c2.status === 200 && !!newId && world.db.signins.length === 1 && newRows.length > 0 && newRows.every(function (r) { return r.has_access === false; }), { c2: c2, rows: newRows.length });
  var ac2 = audits('user_created').filter(function (x) { return x.entity_id === newId; })[0] || {};
  check('… and the audit row lists the switches really stored ON (none)', ac2.actor_id === ADMIN && ac2.details && Array.isArray(ac2.details.switches_on) && ac2.details.switches_on.length === 0 && ac2.details.switch_save_error === null, ac2);
  var c3 = await users('POST', 'tok-super', { email: 'n3@x', password: 'not-used-in-test', name: 'New three', role: 'team', modules: ['Treasury', 'Reports'] });
  var id3 = c3.j && c3.j.user && c3.j.user.id; var on3 = world.db.t.module_permissions.filter(function (r) { return r.user_id === id3 && r.has_access === true; }).map(function (r) { return r.module_name; }).sort();
  check('the SUPER ADMIN adds a person with starting switches → made with exactly Treasury + Reports ON', c3.status === 200 && on3.join(',') === 'Reports,Treasury', { c3: c3, on: on3 });
  var ac3 = audits('user_created').filter(function (x) { return x.entity_id === id3; })[0] || {};
  check('… and the audit row lists the switches read back from the database (not just what was asked)', ac3.actor_id === SUPER && ac3.details && (ac3.details.switches_on || []).slice().sort().join(',') === 'Reports,Treasury', ac3);
  var c4 = await users('POST', 'tok-super', { email: 'n4@x', password: 'not-used-in-test', name: 'New four', role: 'team', modules: ['Treasury', 'Not a module'] });
  var id4 = c4.j && c4.j.user && c4.j.user.id; var ac4 = audits('user_created').filter(function (x) { return x.entity_id === id4; })[0] || {};
  check('a name that is not a starting module is not stored, and the audit shows only what is really ON', c4.status === 200 && (ac4.details.switches_on || []).join(',') === 'Treasury' && (ac4.details.switches_asked || []).length === 2, ac4);
  var src = require('fs').readFileSync(require('path').join(root, 'src/components/SettingsTab.jsx'), 'utf8');
  check('the Add member form sends no starting switches unless the person adding is the super admin', /modules: isSuperAdmin \? selectedModules : \[\]/.test(src) && /disabled=\{!isSuperAdmin\} onChange=\{\(\) => toggleModule\(mod\)\}/.test(src));

  var r14 = await users('PUT', 'tok-staff', { id: STAFF, role: 'super_admin' });
  check('a staff member (not on the admin list) cannot use the team screen at all', r14.status === 403 && roleOf(STAFF) === 'team', r14);

  console.log('');
  console.log('WW: ' + pass + ' passed, ' + failN + ' failed');
  if (failN > 0) { process.exit(1); }
})().catch(function (e) { console.log('CRASH ' + (e && e.stack)); process.exit(1); });
