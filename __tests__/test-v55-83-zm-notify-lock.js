// v55.83-ZM — /api/notify, /api/notify/test and the bell (/api/notifications) only work for a VERIFIED signed-in Hub person (or the
// server secret). Runs the REAL route handlers with the REAL sign-in check (notify-auth → bank-visibility authorizeBankIdentity) on an
// in-memory database, a stand-in sign-in server and a stand-in e-mail service (no network). Made-up people.
var path = require('path'); var Module = require('module'); var fs = require('fs');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.CRON_SECRET = 'cron-test-secret-0123456789';
process.env.RESEND_API_KEY = 're_test';
require(path.join(root, 'node_modules/sucrase/register'));
var FakeDb = require('./fake-supabase.js').FakeDb;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 500))); }
console.log('ZM — notices only from a verified signed-in Hub person (real handlers)');

var BOSS = '11111111-1111-4111-8111-111111111111', AYA = '22222222-2222-4222-8222-222222222222', BEN = '33333333-3333-4333-8333-333333333333';
var AUTH = { 'tok-boss': 'aaaaaaaa-0000-4000-8000-000000000001', 'tok-aya': 'aaaaaaaa-0000-4000-8000-000000000002', 'tok-ben': 'aaaaaaaa-0000-4000-8000-000000000003' };
var PROFILE_OF = {}; PROFILE_OF[AUTH['tok-boss']] = BOSS; PROFILE_OF[AUTH['tok-aya']] = AYA; PROFILE_OF[AUTH['tok-ben']] = BEN;
var world = { db: null };
function fresh() {
  var db = new FakeDb({});
  db.t.users = [{ id: BOSS, role: 'super_admin', active: true, name: 'Owner', email: 'owner@hub.test' }, { id: AYA, role: 'staff', active: true, name: 'Aya', email: 'aya@hub.test' }, { id: BEN, role: 'staff', active: true, name: 'Ben', email: 'ben@hub.test' }];
  db.t.notifications = []; db.t.notification_log = []; db.t.notification_settings = [];
  db.rpcs.bank_visibility_profile_for_identity = function (a) { var p = PROFILE_OF[a.p_auth_user_id]; return { data: p ? [{ profile_id: p }] : [], error: null }; };
  world.db = db; return db;
}
fresh();
var authClient = { auth: { getUser: function (tok) { var id = AUTH[tok]; return Promise.resolve(id ? { data: { user: { id: id } }, error: null } : { data: { user: null }, error: { message: 'bad token' } }); } } };
var supaStub = { createClient: function (url, key) { if (key === 'anon-key') { return authClient; } return new Proxy({}, { get: function (t, k) { var d = world.db; var v = d[k]; return typeof v === 'function' ? v.bind(d) : v; } }); } };
var supaPath = require.resolve('@supabase/supabase-js', { paths: [root] });
require.cache[supaPath] = { id: supaPath, filename: supaPath, loaded: true, exports: supaStub };
var origResolve = Module._resolveFilename;
Module._resolveFilename = function (req) { if (req === '@supabase/supabase-js') { return supaPath; } return origResolve.apply(this, arguments); };
var mails = [];
global.fetch = function (url, init) {
  if (String(url).indexOf('api.resend.com') >= 0) { var b = JSON.parse(init.body); mails.push(b); return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ id: 'm' + mails.length }); } }); }
  return Promise.reject(new Error('no network in tests: ' + url));
};
function load(rel) { return require(path.join(root, 'src/app/api', rel, 'route.js')); }
function mk(method, auth, body) {
  var h = { origin: 'http://hub.test', 'content-type': 'application/json' };
  if (auth) { h.authorization = auth.indexOf('cron') === 0 ? 'Bearer ' + auth : 'Bearer ' + auth; }
  var init = { method: method, headers: h }; if (method !== 'GET') { init.body = JSON.stringify(body || {}); }
  return new Request('http://hub.test/api/x', init);
}
async function run(rel, method, auth, body) { var r = await load(rel)[method](mk(method, auth, body)); var j = null; try { j = await r.json(); } catch (e) { j = null; } return { status: r.status, j: j || {} }; }
var NOTE = { type: 'ticket_assigned', recipientIds: [AYA], subject: 'Ticket T-1 assigned to you', body: 'Please look at T-1' };

(async function () {
  // 1) the hole: no sign-in
  var r = await run('notify', 'POST', null, Object.assign({ triggeredBy: BOSS }, NOTE));
  check('NO SIGN-IN: /api/notify refuses (401) — even with the owner named as sender — and nothing is mailed or written', r.status === 401 && mails.length === 0 && world.db.t.notifications.length === 0, r);
  r = await run('notify', 'POST', 'tok-stranger', NOTE);
  check('A made-up token is refused (401)', r.status === 401 && mails.length === 0, r);
  r = await run('notify', 'POST', null, { to: 'anyone@outside.test', subject: 'hi', html: '<p>spam</p>' });
  check('NO SIGN-IN: the direct e-mail send is refused too (it was an open relay)', r.status === 401 && mails.length === 0, r);
  var cross = await load('notify').POST(new Request('http://hub.test/api/x', { method: 'POST', headers: { origin: 'http://evil.test', 'content-type': 'application/json', authorization: 'Bearer tok-aya' }, body: JSON.stringify(NOTE) }));
  check('A request from another web site is refused even with a real token', cross.status === 403 && mails.length === 0, cross.status);

  // 2) a signed-in person
  r = await run('notify', 'POST', 'tok-ben', Object.assign({ triggeredBy: BOSS }, NOTE));
  var row = world.db.t.notifications[0];
  check('SIGNED IN (Ben): the notice goes out — Aya gets the e-mail and a bell row', r.status === 200 && r.j.sent === 1 && mails.length === 1 && mails[0].to === 'aya@hub.test' && world.db.t.notifications.length === 1, r);
  check('…the bell row has the live columns: user_id = Aya, read = false (no target_user / created_by)', row && row.user_id === AYA && row.read === false && !('target_user' in row) && !('created_by' in row), row);
  var log = world.db.t.notification_log[0];
  check('…the sender recorded is Ben (verified), NOT the owner written in the request', log && log.triggered_by === BEN, log);
  r = await run('notify', 'POST', 'tok-ben', Object.assign({}, NOTE, { recipientIds: 'all' }));
  check('A staff member cannot send to everyone (403), nothing sent', r.status === 403 && mails.length === 1, r);
  r = await run('notify', 'POST', 'tok-boss', Object.assign({}, NOTE, { recipientIds: 'all' }));
  check('The super admin can send to everyone (3 people, 3 bell rows)', r.status === 200 && r.j.bell_targets === 3 && world.db.t.notifications.length === 4, r);
  r = await run('notify', 'POST', 'tok-ben', Object.assign({}, NOTE, { recipientIds: ['not-a-user'] }));
  check('A recipient that is not a Hub id is refused (403)', r.status === 403, r);
  var before = mails.length;
  r = await run('notify', 'POST', 'tok-aya', { to: 'anyone@outside.test', subject: 'hi', html: '<p>x</p>' });
  check('SIGNED IN: the direct send to an outside address is refused (403), nothing mailed', r.status === 403 && mails.length === before, r);
  r = await run('notify', 'POST', 'tok-aya', { to: 'Ben@hub.test', subject: 'Announcement', html: '<p>x</p>' });
  check('SIGNED IN: the direct send (announcements) to a Hub person still works', r.status === 200 && r.j.sent === 1 && mails[mails.length - 1].to === 'Ben@hub.test', r);

  // 3) the server secret (internal calls)
  r = await run('notify', 'POST', 'cron-test-secret-0123456789', Object.assign({}, NOTE, { recipientIds: [BEN], triggeredBy: BOSS }));
  check('SERVER SECRET: an internal call is accepted (sender kept from the request, it is the server)', r.status === 200 && r.j.sent === 1 && world.db.t.notification_log[world.db.t.notification_log.length - 1].triggered_by === BOSS, r);

  // 4) the e-mail test panel: admins only
  before = mails.length;
  r = await run('notify/test', 'POST', null, { email: 'anyone@outside.test' });
  check('E-MAIL TEST: no sign-in → 401 (it could mail any typed address)', r.status === 401 && mails.length === before, r);
  r = await run('notify/test', 'POST', 'tok-aya', { all: true });
  check('E-MAIL TEST: a staff member → 403, nothing mailed', r.status === 403 && mails.length === before, r);
  r = await run('notify/test', 'GET', null);
  check('E-MAIL TEST status (GET): no sign-in → 401', r.status === 401, r);
  r = await run('notify/test', 'GET', 'tok-boss');
  check('E-MAIL TEST status (GET): the super admin sees it', r.status === 200 && r.j.resend_configured === true, r);

  // 5) the bell's own route
  world.db.t.notifications.push({ id: '44444444-4444-4444-8444-444444444444', user_id: BEN, type: 'reminder', title: 'For Ben', body: 'x', read: false, created_at: '2026-11-26T09:00:00Z' });
  r = await run('notifications', 'GET', null);
  check('BELL: no sign-in → 401, no notices', r.status === 401 && !r.j.notifications, r);
  r = await run('notifications', 'GET', 'tok-aya');
  var ayaRows = world.db.t.notifications.filter(function (n) { return n.user_id === AYA; });
  ayaRows.forEach(function (n, i) { n.id = '5555555' + i + '-5555-4555-8555-555555555555'; }); // ids are uuids on live (the stand-in db makes short ones)
  check('BELL: Aya sees only her own notices (' + ayaRows.length + '), with the unread count', r.status === 200 && r.j.notifications.length === ayaRows.length && r.j.notifications.every(function (n) { return n.user_id === AYA; }) && r.j.unread === ayaRows.length, r);
  r = await run('notifications', 'POST', 'tok-aya', { action: 'mark_read', ids: ['44444444-4444-4444-8444-444444444444'] });
  check('BELL: Aya marking Ben’s notice changes nothing (marked 0, still unread)', r.status === 200 && r.j.marked === 0 && world.db.t.notifications.filter(function (n) { return n.user_id === BEN && n.title === 'For Ben'; })[0].read === false, r);
  r = await run('notifications', 'POST', 'tok-aya', { action: 'mark_read', ids: [ayaRows[0].id] });
  check('BELL: Aya marks one of hers read', r.status === 200 && r.j.marked === 1 && ayaRows[0].read === true, r);
  r = await run('notifications', 'POST', 'tok-aya', { action: 'mark_all_read' });
  check('BELL: "Mark all read" marks the rest of hers, and none of Ben’s', r.status === 200 && r.j.marked === ayaRows.length - 1 && world.db.t.notifications.filter(function (n) { return n.user_id === BEN; }).some(function (n) { return n.read === false; }), r);
  r = await run('notifications', 'GET', 'cron-test-secret-0123456789');
  check('BELL: the server secret cannot read anyone’s bell (it is not a person)', r.status === 403, r);

  // 6) every sender in the Hub sends the sign-in token
  var files = ['src/lib/notify.js', 'src/app/page.jsx', 'src/components/CalendarTab.jsx', 'src/components/MyHRDesk.jsx', 'src/components/EmailStatusPanel.jsx'];
  var bare = []; var noImport = [];
  files.forEach(function (f) { var s = fs.readFileSync(path.join(root, f), 'utf8'); if (/[^b]fetch\(\s*['"]\/api\/notify/.test(s.replace(/hubFetch/g, 'hubF'))) { bare.push(f); } if (!/import \{ hubFetch \} from '\.\.?\/(lib\/)?hub-fetch'/.test(s)) { noImport.push(f); } });
  check('CALLERS: every browser call to /api/notify(/test) uses hubFetch (sends the sign-in token) and imports it', bare.length === 0 && noImport.length === 0, { bare: bare, noImport: noImport });
  var all = []; (function walk(d) { fs.readdirSync(d).forEach(function (n) { var p = path.join(d, n); if (fs.statSync(p).isDirectory()) { walk(p); } else if (/\.(js|jsx)$/.test(n)) { var s = fs.readFileSync(p, 'utf8'); if (/[^b]fetch\([^)]*\/api\/notify/.test(s.replace(/hubFetch/g, 'hubF'))) { all.push(path.relative(root, p)); } } }); })(path.join(root, 'src'));
  check('CALLERS: no other file in src calls /api/notify without the token', all.length === 0, all);
  var bell = fs.readFileSync(path.join(root, 'src/components/NotificationBell.jsx'), 'utf8');
  check('BELL source: no browser access to the table — it uses /api/notifications', !/supabase\.from\(/.test(bell) && /hubFetch\('\/api\/notifications'/.test(bell));

  console.log('\nZM: ' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
