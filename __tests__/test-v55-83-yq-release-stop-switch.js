// v55.83-YQ — Max, 24 Nov 2026: "make the changes necessary to make change mgt better". The STOP switch for warehouse releases:
// while it is on, no move or roll back can be approved and the office worker is handed no request. Super admin only.
var path = require('path'); var fs = require('fs'); var Module = require('module');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://placeholder.supabase.co'; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'placeholder'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder';
require(path.join(root, 'node_modules/sucrase/register'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra))); }
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
console.log('YQ — the stop switch for warehouse releases');

var state;
function fresh(o) { state = Object.assign({ setting: null, settingError: null, writeError: null, audit: [], claims: [], enqueued: [], role: 'super_admin', superAdmin: true, credential: true }, o || {}); }
function run(st) {
  if (st.table === 'app_settings') {
    if (st.op === 'upsert') { if (state.writeError) { return { data: null, error: { message: state.writeError } }; } state.setting = st.row.value; return { data: [{ key: st.row.key }], error: null }; }
    if (state.settingError) { return { data: null, error: { message: state.settingError } }; }
    return { data: state.setting ? [{ key: 'warehouse_release_pause', value: state.setting }] : [], error: null };
  }
  if (st.table === 'hub_audit_log') { state.audit.push(st.row); return { data: null, error: null }; }
  if (st.table === 'users') { return { data: { id: 'u-1', name: 'Max', email: 'm@example.test' }, error: null }; }
  if (st.table === 'release_worker_credentials') { return { data: state.credential ? { worker: 'office', enabled: true } : null, error: null }; }
  if (st.table === 'release_signoffs') { return { data: [], error: null }; }
  return { data: [], error: null };
}
function q(table) {
  var st = { table: table, op: 'select', filters: {} };
  var b = { select: function () { return b; }, eq: function (k, v) { st.filters[k] = v; return b; }, in: function () { return b; }, order: function () { return b; }, limit: function () { return b; },
    insert: function (row) { st.op = 'insert'; st.row = row; return b; }, upsert: function (row) { st.op = 'upsert'; st.row = row; return b; },
    maybeSingle: function () { return Promise.resolve(run(st)); }, then: function (res, rej) { return Promise.resolve(run(st)).then(res, rej); } };
  return b;
}
var dbStub = { from: q, rpc: function (name, p) { if (name === 'release_claim') { state.claims.push(p.p_request); return Promise.resolve({ data: true, error: null }); } if (name === 'release_enqueue') { state.enqueued.push(p.p_rows); return Promise.resolve({ data: p.p_rows.map(function (r, i) { return { id: i + 1, item_id: r.item_id, action: r.action }; }), error: null }); } return Promise.resolve({ data: null, error: null }); } };
var realLoad = Module._load;
Module._load = function (request) {
  if (request === 'next/server') { return { NextResponse: { json: function (body, init) { return { body: body, status: (init && init.status) || 200 }; } } }; }
  if (request === '@supabase/supabase-js') { return { createClient: function () { return dbStub; } }; }
  if (/lib\/verified-caller$/.test(request)) { return { verifiedCaller: function () { return Promise.resolve({ userId: 'u-1' }); } }; }
  if (/server-permissions$/.test(request)) { return { loadUserPermissions: function () { return Promise.resolve({ role: state.role, isSuperAdmin: state.superAdmin, mp: {} }); }, userHasPermission: function () { return true; }, revenueSwitchedOff: function () { return false; }, assertPermission: function () { return Promise.resolve({ ok: true }); } }; }
  return realLoad.apply(this, arguments);
};
var P = require(path.join(root, 'src/lib/release-pause.js'));
var pauseRoute = require(path.join(root, 'src/app/api/releases/pause/route.js'));
var workerRoute = require(path.join(root, 'src/app/api/releases/worker/route.js'));
var signoffRoute = require(path.join(root, 'src/app/api/releases/signoff/route.js'));
Module._load = realLoad;
function req(body, auth) { return { json: function () { return Promise.resolve(body || {}); }, headers: { get: function (k) { return String(k).toLowerCase() === 'authorization' ? (auth || null) : null; } } }; }
var TOKEN = 'Bearer ' + new Array(65).join('a');

(async function () {
  // ── the setting ──
  fresh();
  var p0 = await P.readReleasePause(dbStub);
  check('1: never set → releases are allowed', p0.paused === false && p0.unreadable === false, p0);
  fresh({ settingError: 'connection reset' });
  var p1 = await P.readReleasePause(dbStub);
  check('2: the setting cannot be read → counts as STOPPED (fail closed)', p1.paused === true && p1.unreadable === true, p1);
  fresh({ setting: { paused: 'yes' } });
  check('3: only an exact true stops; any other stored value is "allowed"', (await P.readReleasePause(dbStub)).paused === false);
  check('4: a reason is required to stop (at least 5 characters, spaces do not count)', P.pauseReason('').ok === false && P.pauseReason('    ').ok === false && P.pauseReason('abc').ok === false && P.pauseReason('  waiting  for   review ').reason === 'waiting for review');

  // ── switching it ──
  fresh({ superAdmin: false, role: 'admin' });
  var r = await pauseRoute.POST(req({ paused: true, reason: 'not the super admin' }));
  check('5: an admin who is not the super admin cannot stop releases; nothing is written', r.status === 403 && state.setting === null && state.audit.length === 0, r);
  r = await pauseRoute.GET(req({}));
  check('6: …but can SEE the state, and is told they cannot change it', r.status === 200 && r.body.ok === true && r.body.pause.paused === false && r.body.can_switch === false, r);
  fresh();
  r = await pauseRoute.POST(req({ paused: true, reason: 'x' }));
  check('7: super admin, no real reason → refused, nothing written', r.status === 400 && state.setting === null, r);
  r = await pauseRoute.POST(req({ paused: true, reason: 'waiting for a review of the Order Queue change' }));
  check('8: super admin with a reason → STOPPED, with who, when and why', r.status === 200 && r.body.ok === true && r.body.pause.paused === true && state.setting.paused === true && state.setting.by === 'u-1' && state.setting.by_name === 'Max' && state.setting.reason === 'waiting for a review of the Order Queue change' && !!state.setting.at, [r, state.setting]);
  check('9: …and it is on the audit trail', state.audit.length === 1 && state.audit[0].action === 'warehouse_releases_stopped' && state.audit[0].actor_id === 'u-1', state.audit);
  check('10: the sentence people see says who stopped it and why', /STOPPED by Max — “waiting for a review of the Order Queue change”/.test(r.body.pause.sentence), r.body.pause.sentence);
  r = await pauseRoute.POST(req({ paused: false }));
  check('11: restarting needs an explicit confirmation', r.status === 400 && state.setting.paused === true, r);
  r = await pauseRoute.POST(req({ paused: false, confirm: 'RESTART' }));
  check('12: with it → allowed again, on the audit trail', r.status === 200 && r.body.pause.paused === false && state.setting.paused === false && state.audit.length === 2 && state.audit[1].action === 'warehouse_releases_restarted', [r, state.audit]);
  fresh({ writeError: 'db down' });
  r = await pauseRoute.POST(req({ paused: true, reason: 'cannot save this' }));
  check('13: if the switch cannot be saved the person is told and nothing is claimed as stopped', r.status === 503 && r.body.ok === false && state.audit.length === 0, r);

  // ── the worker ──
  fresh();
  r = await workerRoute.POST(req({ op: 'claim', request: 7, version: 'warehouse-worker-v1-database-releases' }, TOKEN));
  check('14: releases allowed → the worker\'s claim goes through to the database as before', r.status === 200 && r.body.data === true && state.claims.length === 1 && state.claims[0] === 7, [r, state.claims]);
  fresh({ setting: { paused: true, by_name: 'Max', reason: 'hold' } });
  r = await workerRoute.POST(req({ op: 'claim', request: 7, version: 'warehouse-worker-v1-database-releases' }, TOKEN));
  check('15: STOPPED → the worker is handed NOTHING: the answer is "not yours" and the database claim is never called', r.status === 200 && r.body.data === false && state.claims.length === 0, [r, state.claims]);
  fresh({ settingError: 'timeout' });
  r = await workerRoute.POST(req({ op: 'claim', request: 7, version: 'warehouse-worker-v1-database-releases' }, TOKEN));
  check('16: switch unreadable → also nothing handed out', r.body.data === false && state.claims.length === 0, r);
  fresh({ setting: { paused: true } });
  r = await workerRoute.POST(req({ op: 'heartbeat', enabled: true, version: 'warehouse-worker-v1-database-releases' }, TOKEN));
  check('17: STOPPED does not block the worker\'s heartbeat or reading history (so the screen still shows it online)', r.status === 200 && !r.body.error && (await workerRoute.POST(req({ op: 'history' }, TOKEN))).status === 200, r);
  check('18: the pinned office worker needs no change: a false claim is simply skipped', /const claimed = await must\(db\.rpc\('release_claim'[^\n]*\n\s*if \(!claimed\) continue;/.test(read('release-management/deploy/worker.js')));

  // ── approvals ──
  fresh({ setting: { paused: true, by_name: 'Max', reason: 'hold everything' } });
  r = await signoffRoute.POST(req({ item_ids: ['wh-bug-001-save-path'], action: 'go', confirm: 'DEPLOY' }));
  check('19: STOPPED → approving a move is refused with the reason; nothing queued', r.status === 409 && /STOPPED by Max/.test(r.body.error) && /Nothing was recorded/.test(r.body.error) && state.enqueued.length === 0, r);
  r = await signoffRoute.POST(req({ item_ids: ['wh-order-queue'], action: 'rollback', confirm: 'ROLLBACK' }));
  check('20: STOPPED → asking for a roll back is refused too', r.status === 409 && /STOPPED/.test(r.body.error) && state.enqueued.length === 0, r);
  r = await signoffRoute.POST(req({ item_ids: ['wh-order-queue'], action: 'withdraw', confirm: 'WITHDRAW' }));
  check('21: STOPPED does not block taking a request back (it gets past the stop switch to the normal checks)', !/STOPPED/.test(String(r.body.error || '')), r);
  fresh();
  r = await signoffRoute.POST(req({ item_ids: ['wh-bug-001-save-path'], action: 'go', confirm: 'DEPLOY' }));
  check('22: releases allowed → the approval route carries on to its normal checks (not stopped by the switch)', !/STOPPED|stop switch/.test(String(r.body.error || '')), r);

  // ── source / housekeeping ──
  var sg = read('src/app/api/releases/signoff/route.js'); var wk = read('src/app/api/releases/worker/route.js'); var tab = read('src/components/ChangeScheduleTab.jsx'); var bar = read('src/components/ReleasePauseBar.jsx');
  check('23 (source): the approval gate runs BEFORE anything is read or recorded for a go / rollback', sg.indexOf("if (action !== 'withdraw') { var pz = await readReleasePause(db);") > 0 && sg.indexOf('readReleasePause(db)') < sg.indexOf("db.rpc('release_enqueue'"));
  check('24 (source): the worker gate is the first thing in the claim step', /case 'claim':\s*\/\/[^\n]*\n\s*if \(\(await readReleasePause\(db\)\)\.paused\) return response\(\{ data: false, paused: true \}\);/.test(wk));
  check('25 (source): the bar is on Change Schedule, above the heading; the confirmation is on the page, no browser pop-up', tab.indexOf('<ReleasePauseBar ') > 0 && tab.indexOf('onChange={function () { load(); }} />') > 0 && tab.indexOf('<ReleasePauseBar') < tab.indexOf('<h1 ') && bar.indexOf('window.confirm') < 0 && bar.indexOf('window.prompt') < 0 && bar.indexOf('Yes, stop them now') > 0);
  check('26 (source): the stop-switch library imports nothing (safe for server routes) and no SQL file was added for it', !/^import |require\(/m.test(read('src/lib/release-pause.js')) && fs.readdirSync(path.join(root, 'sql')).filter(function (f) { return /YQ/.test(f); }).length === 0);
  var page = read('src/app/page.jsx'); var wn = read('src/components/WhatsNewWidget.jsx');
  check('27: What\'s New has the YQ entry and the badge names the newest entry on top', wn.indexOf("version: 'v55.83-YQ'") > 0 && (function () { var top = /BUILD_HISTORY = \[\s*\{\s*version: '(v55.83-[A-Z]{2,3}(?:\.\d+)?)'/.exec(wn); return !!top && page.indexOf('>' + top[1] + '</span>') > 0; })());
  check('28: the test is in the regression runner', read('scripts/run-accounting-bank-regression.js').indexOf('test-v55-83-yq-release-stop-switch.js') > 0);

  console.log('\nYQ: ' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('CRASHED: ' + (e && e.stack || e)); process.exit(1); });
