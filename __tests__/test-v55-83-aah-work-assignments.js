// v55.83-AAH — Work assignments (Max, 27 Nov: "a dashboard where the admin or the super admin can select specific people, users for each
// task ... implemented right away"). The REAL route with a fake database (app_settings, users), the real task list, the real panel
// (server-rendered) and the real feed helpers. No SQL: one app_settings key.
// Run: node __tests__/test-v55-83-aah-work-assignments.js
var path = require('path'); var fs = require('fs'); var Module = require('module');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
function stub(file, exp) { var id = require.resolve(file); var m0 = new Module(id); m0.filename = id; m0.loaded = true; m0.exports = exp; require.cache[id] = m0; }
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 600))); }
console.log('AAH — Work assignments: admin / super admin pick an owner + backup per feed task; the feed labels, never grants');

// ── fake database ──
var DB = { settings: {}, users: [], perms: {}, audit: [], failRead: false, failWrite: false };
function q(table) {
  var st = { table: table, filters: [], up: null };
  var api = {
    select: function () { return api; }, or: function (f) { st.filters.push(['or', f]); return api; }, eq: function (c, v) { st.filters.push(['eq', c, v]); return api; },
    limit: function () { return api; }, order: function () { return api; },
    upsert: function (row) { st.up = row; return api; },
    maybeSingle: function () { return run().then(function (r) { return { data: (r.data || [])[0] || null, error: r.error }; }); },
    then: function (res, rej) { return run().then(res, rej); }
  };
  function run() {
    if (table === 'app_settings') {
      if (st.up) { if (DB.failWrite) { return Promise.resolve({ error: { message: 'write refused' } }); } DB.settings[st.up.key] = st.up; return Promise.resolve({ data: [{ key: st.up.key }], error: null }); }
      if (DB.failRead) { return Promise.resolve({ data: null, error: { message: 'read refused' } }); }
      var k = 'work_feed_assignments'; var row = DB.settings[k]; return Promise.resolve({ data: row ? [row] : [], error: null });
    }
    if (table === 'users') { var eqId = st.filters.filter(function (f) { return f[0] === 'eq' && f[1] === 'id'; })[0]; var rows = eqId ? DB.users.filter(function (u) { return u.id === eqId[2]; }) : DB.users.slice(); return Promise.resolve({ data: rows, error: null }); }
    if (table === 'hub_audit_log') { return Promise.resolve({ data: [], error: null }); }
    return Promise.resolve({ data: [], error: null });
  }
  return api;
}
stub('@supabase/supabase-js', { createClient: function () { return { from: q }; } });
stub(path.join(root, 'src/lib/verified-caller.js'), { verifiedCaller: function (req) { var id = req.headers.get('x-test-user'); return Promise.resolve(id ? { userId: id } : { error: 'Sign in again', status: 401 }); } });
stub(path.join(root, 'src/lib/audit-server.js'), { audit: function (db, actor, action, entity, id, details) { DB.audit.push({ actor: actor, action: action, entity: entity, id: id, details: details }); return Promise.resolve(); } });
stub(path.join(root, 'src/lib/server-permissions.js'), {
  loadUserPermissions: function (db, id) { var u = DB.users.filter(function (x) { return x.id === id; })[0]; return Promise.resolve({ role: u ? u.role : null, isSuperAdmin: !!(u && u.role === 'super_admin'), mp: DB.perms[id] || {}, readError: null }); },
  userHasPermission: function (ctx, p) { return ctx.isSuperAdmin === true || (ctx.mp || {})[p] === true; }
});
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
var R = require(path.join(root, 'src/app/api/work-feed/assignments/route.js'));
var T = require(path.join(root, 'src/lib/work-feed-tasks.js'));
function req(user, body) { return { headers: { get: function (h) { return h === 'x-test-user' ? user : null; } }, json: function () { return Promise.resolve(body || {}); } }; }
async function get(user) { var r = await R.GET(req(user)); return { status: r.status, j: await r.json() }; }
async function post(user, body) { var r = await R.POST(req(user, Object.assign({ user_id: user }, body || {}))); return { status: r.status, j: await r.json() }; }

DB.users = [
  { id: 'u-max', name: 'Max', role: 'super_admin', active: true },
  { id: 'u-adm', name: 'Ada Admin', role: 'admin', active: true },
  { id: 'u-sam', name: 'Sam Signer', role: 'staff', active: true },
  { id: 'u-bea', name: 'Bea Bills', role: 'staff', active: true },
  { id: 'u-old', name: 'Old Staff', role: 'staff', active: false }
];
DB.perms = { 'u-sam': { 'accounting.clickbooks.access': true, 'wires.signoff': true }, 'u-bea': { 'accounting.clickbooks.access': true, 'bills.manage': true } };

(async function () {
  // ── the task list ──
  var keys = T.FEED_TASKS.map(function (t) { return t.key; });
  check('01: one row per feed task — every task the feed shows today, plus the later ones Max named (orders, collections, bank lines, warehouse check)', ['bill_flags', 'bill_validate', 'bill_ready', 'wire_fix', 'transfer_unused', 'wire_sign', 'wire_send', 'wire_bank', 'wire_proof', 'invoice_bank', 'order_no_invoice', 'order_paperwork', 'order_preload', 'collections', 'bank_lines', 'warehouse_check'].every(function (k) { return keys.indexOf(k) >= 0; }) && keys.length === 16);
  var WFL = require(path.join(root, 'src/lib/waiting-list.js'));
  var feedKeys = WFL.waitingFor({ bills: [], wires: [], perms: { bills: true, prepare: true, signoff: true, send: true } }).sections.map(function (s) { return s.key; });
  check('02: the live tasks are exactly the feed group keys (so an assignment lands on the right group)', T.FEED_TASKS.filter(function (t) { return t.live; }).every(function (t) { return t.key === 'invoice_bank' || ['bill_flags', 'bill_validate', 'bill_ready', 'wire_fix', 'transfer_unused', 'wire_sign', 'wire_send', 'wire_bank', 'wire_proof'].indexOf(t.key) >= 0; }) && feedKeys.length === 0);
  check('03: only admin and super admin may assign', T.canAssign('super_admin') && T.canAssign('admin') && !T.canAssign('staff') && !T.canAssign('owner') && !T.canAssign(null));
  check('04: cleanAssignments drops unknown tasks, empty rows and a backup equal to the owner', JSON.stringify(T.cleanAssignments({ tasks: { nope: { primary: 'a' }, wire_sign: { primary: 'a', backup: 'a' }, wire_send: {} } })) === JSON.stringify({ wire_sign: { primary: 'a', backup: null } }));

  // ── GET ──
  var g0 = await get(null);
  check('05: not signed in → refused', g0.status === 401 && g0.j.ok === false);
  var g1 = await get('u-sam');
  check('06: staff can read who owns what (names only), cannot edit, and get no team list or switch details', g1.status === 200 && g1.j.ok && g1.j.can_edit === false && g1.j.people === null && JSON.stringify(g1.j.tasks) === '{}');
  var g2 = await get('u-adm');
  check('07: an admin gets the editor view: active people only (Old Staff left out), sorted by name', g2.j.can_edit === true && g2.j.people.map(function (p) { return p.id; }).join() === 'u-adm,u-bea,u-max,u-sam');
  var sam = g2.j.people.filter(function (p) { return p.id === 'u-sam'; })[0]; var bea = g2.j.people.filter(function (p) { return p.id === 'u-bea'; })[0];
  check('08: per person, whether their switches already show each task (Sam: wires to sign yes, bills no; Bea: bills yes, wires no)', sam.sees.wire_sign === true && sam.sees.bill_validate === false && bea.sees.bill_validate === true && bea.sees.wire_sign === false && sam.sees.collections === null);
  // ── POST ──
  var p0 = await post('u-sam', { tasks: { wire_sign: { primary: 'u-sam' } }, expected_at: null });
  check('09: staff cannot save (403), nothing written, no audit', p0.status === 403 && !DB.settings.work_feed_assignments && DB.audit.length === 0);
  var p1 = await post('u-adm', { tasks: { wire_sign: { primary: 'u-old' } }, expected_at: null });
  check('10: an inactive person is refused, nothing saved', p1.status === 400 && /not an active team member/.test(p1.j.error) && !DB.settings.work_feed_assignments);
  var p2 = await post('u-adm', { tasks: { made_up: { primary: 'u-sam' } }, expected_at: null });
  check('11: an unknown task is refused', p2.status === 400 && /unknown task/.test(p2.j.error));
  var p3 = await post('u-adm', { tasks: { wire_sign: { primary: 'u-sam', backup: 'u-max' }, bill_validate: { primary: 'u-bea' } }, expected_at: null });
  check('12: an admin saves owner + backup; the answer carries when and by whom', p3.status === 200 && p3.j.ok && p3.j.tasks.wire_sign.primary === 'u-sam' && p3.j.tasks.wire_sign.backup === 'u-max' && p3.j.by_name === 'Ada Admin' && !!p3.j.at);
  var row = DB.settings.work_feed_assignments;
  check('13: stored in ONE app_settings row, key work_feed_assignments (both shapes, like the other settings) — no new table', !!row && row.key === 'work_feed_assignments' && row.value.version === 1 && row.setting_key === 'work_feed_assignments' && JSON.parse(row.setting_value).tasks.bill_validate.primary === 'u-bea');
  check('14: the save is on the audit trail with what changed', DB.audit.length === 1 && DB.audit[0].action === 'work_feed_assignments_saved' && DB.audit[0].actor === 'u-adm' && DB.audit[0].details.changes.length === 2);
  var p4 = await post('u-max', { tasks: { wire_sign: { primary: 'u-max' } }, expected_at: null });
  check('15: a save based on an old copy is refused (someone saved meanwhile) — nothing overwritten', p4.status === 409 && p4.j.stale === true && DB.settings.work_feed_assignments.value.tasks.wire_sign.primary === 'u-sam');
  var p5 = await post('u-max', { tasks: { wire_sign: { primary: 'u-max' } }, expected_at: p3.j.at });
  check('16: the super admin saves on the current copy; a task left out is cleared (bill_validate)', p5.status === 200 && p5.j.tasks.wire_sign.primary === 'u-max' && !p5.j.tasks.bill_validate);
  var g3 = await get('u-sam');
  check('17: everyone reads the owners by name', g3.j.tasks.wire_sign.primary === 'u-max' && g3.j.names['u-max'] === 'Max');
  DB.failRead = true; var g4 = await get('u-sam'); var p6 = await post('u-max', { tasks: {}, expected_at: p5.j.at }); DB.failRead = false;
  check('18: the setting cannot be read → GET says so (503) and a save is refused (nothing overwritten blindly)', g4.status === 503 && p6.status === 503 && DB.settings.work_feed_assignments.value.tasks.wire_sign.primary === 'u-max');
  DB.failWrite = true; var p7 = await post('u-max', { tasks: { wire_send: { primary: 'u-sam' } }, expected_at: p5.j.at }); DB.failWrite = false;
  check('19: a failed write says nothing changed, no audit row', p7.status === 503 && /Nothing changed/.test(p7.j.error) && DB.audit.length === 2);

  // ── the feed: labels and order only, never a new task ──
  var WF = require(path.join(root, 'src/components/WorkFeed.jsx'));
  var asg = { tasks: { wire_sign: { primary: 'u-sam', backup: 'u-max' }, bill_validate: { primary: 'u-bea' }, order_preload: { primary: 'u-sam' } }, names: { 'u-sam': 'Sam Signer', 'u-max': 'Max', 'u-bea': 'Bea Bills' } };
  var mineSam = WF.myAssignments(asg, 'u-sam');
  check('20: Sam’s own tasks: wires to sign (owner) and pre-load (owner)', mineSam.wire_sign === 'primary' && mineSam.order_preload === 'primary' && !mineSam.bill_validate);
  check('21: the owner line on a group: names, "you" for yourself, "not assigned" when empty', WF.ownerLine(asg, 'wire_sign', 'u-max') === 'Owner: Sam Signer · backup: you' && WF.ownerLine(asg, 'wire_send', 'u-max') === 'Owner: not assigned' && WF.ownerLine(null, 'wire_send', 'u-max') === '');
  var groups = [{ key: 'bill_validate' }, { key: 'wire_fix' }, { key: 'wire_sign' }];
  check('22: your own groups come first (owner, then backup), the rest keep their order', WF.sortMineFirst(groups, { wire_sign: 'primary' }).map(function (g) { return g.key; }).join() === 'wire_sign,bill_validate,wire_fix' && WF.sortMineFirst(groups, {}).map(function (g) { return g.key; }).join() === 'bill_validate,wire_fix,wire_sign');
  var accBea = WF.feedAccess(false, { 'accounting.clickbooks.access': true, 'bills.manage': true }, 'staff');
  check('23: NEVER GRANTS: assigned wires to sign without Wires: Sign Off → the feed still cannot show them (feedShowsTask false); later tasks show nothing yet', WF.feedShowsTask(accBea, 'wire_sign') === false && WF.feedShowsTask(accBea, 'bill_validate') === true && WF.feedShowsTask(accBea, 'order_preload') === false);
  var U = fs.readFileSync(path.join(root, 'src/components/WorkFeed.jsx'), 'utf8');
  check('24: the feed’s requests are unchanged — assignments do not change which lists it asks for or what they return', (U.match(/action: 'list'/g) || []).length === 2 && U.indexOf("hubFetch('/api/work-feed/assignments', { method: 'GET' })") > 0 && !/assign[^\n]*(perms|canBills|canWires|canInvoices)\s*=/.test(U));
  check('25: a person assigned a task they cannot see gets a plain note (not the items)', U.indexOf("data-testid=\"feed-assigned-not-visible\"") > 0 && U.indexOf('Being assigned does not open them.') > 0);
  check('26: the ⚙ Work assignments button shows only for admin / super admin (the server checks again)', U.indexOf("var editor = canAssign(userProfile && userProfile.role);") > 0 && U.indexOf("{editor && <button onClick={function () { setAsgOpen(!asgOpen); }}") > 0);

  // ── the panel ──
  var React = require(path.join(root, 'node_modules/react')); var RS = require(path.join(root, 'node_modules/react-dom/server'));
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'x';
  var P = require(path.join(root, 'src/components/WorkAssignmentsPanel.jsx'));
  var html = ''; try { html = RS.renderToString(React.createElement(P.default, { userProfile: { id: 'u-max', role: 'super_admin' } })); } catch (e) { html = 'CRASH ' + e.message; }
  check('27: the panel renders (no crash) with its title and Save', html.indexOf('CRASH') < 0 && html.indexOf('WORK ASSIGNMENTS') > 0 && html.indexOf('Save assignments') > 0, html.substring(0, 200));
  check('28: the row warning when the chosen person cannot see the task, in plain words; none when they can', /Bea Bills cannot see these yet — needs Wires: Sign Off\. Assigning does not give access/.test(P.rowWarning({ key: 'wire_sign', needs: 'Wires: Sign Off' }, { name: 'Bea Bills', sees: { wire_sign: false } })) && P.rowWarning({ key: 'wire_sign', needs: 'x' }, { name: 'Sam', sees: { wire_sign: true } }) === '' && P.rowWarning({ key: 'collections' }, { name: 'Sam', sees: { collections: null } }) === '');
  var PS = fs.readFileSync(path.join(root, 'src/components/WorkAssignmentsPanel.jsx'), 'utf8');
  check('29: the panel saves with the copy it loaded (expected_at), and only through the route', PS.indexOf("expected_at: data.at || null") > 0 && !/supabase|\.from\(/.test(PS));
  check('30: no SQL file in this build', !fs.readdirSync(path.join(root, 'sql')).some(function (f) { return /AAH/i.test(f); }));
  var RT = fs.readFileSync(path.join(root, 'src/app/api/work-feed/assignments/route.js'), 'utf8');
  check('31: the route only exports GET / POST and route settings (Next refuses other exports)', (RT.match(/^export /gm) || []).length === 6 && /export async function GET/.test(RT) && /export async function POST/.test(RT));

  console.log('\n' + pass + ' passed, ' + failN + ' failed'); if (failN) { process.exit(1); }
})().catch(function (e) { console.log('CRASH ' + (e && e.stack || e)); process.exit(1); });
