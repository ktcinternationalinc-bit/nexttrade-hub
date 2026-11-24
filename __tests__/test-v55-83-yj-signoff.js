// v55.83-YJ — Change Schedule sign-off of warehouse changes. The REAL routes (/api/releases, /api/releases/signoff)
// and the REAL permission loader, with stand-ins for the sign-in check and the database. Plus wiring pins for the screen. All names and ids are made up.
var path = require('path'); var fs = require('fs'); var Module = require('module');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ok: ' : '  FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 900))); }
console.log('YJ — sign-off of warehouse changes: real routes, stand-in database');

// ---------------- world
var world = { caller: 'u-max', tableInstalled: true, failInsert: false, rows: [], seq: 0, events: [],
  users: { 'u-max': { id: 'u-max', role: 'super_admin', name: 'Max' }, 'u-staff': { id: 'u-staff', role: 'staff', name: 'Staff' }, 'u-admin': { id: 'u-admin', role: 'admin', name: 'Admin' } },
  perms: [{ user_id: 'u-staff', module_name: 'releases.access', has_access: true }, { user_id: 'u-admin', module_name: 'releases.access', has_access: true }] };
function Q(name) {
  var st = { f: [], op: 'select', vals: null, lim: null, asc: true };
  var q = {
    select: function () { return q; },
    eq: function (k, v) { st.f.push(function (r) { return String(r[k]) === String(v); }); return q; },
    order: function (k, o) { st.asc = !(o && o.ascending === false); return q; },
    limit: function (n) { st.lim = n; return q; },
    insert: function (v) { st.op = 'insert'; st.vals = v; return q; },
    update: function () { st.op = 'update'; return q; },
    delete: function () { st.op = 'delete'; return q; },
    then: function (res, rej) { return Promise.resolve(exec(name, st)).then(res, rej); }
  };
  return q;
}
function exec(name, st) {
  if (name === 'users') { return { data: Object.keys(world.users).map(function (k) { return world.users[k]; }).filter(function (r) { return st.f.every(function (f) { return f(r); }); }), error: null }; }
  if (name === 'module_permissions') { return { data: world.perms.filter(function (r) { return st.f.every(function (f) { return f(r); }); }), error: null }; }
  if (name === 'release_signoffs') {
    if (!world.tableInstalled) { return { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.release_signoffs' in the schema cache" } }; }
    if (st.op === 'update' || st.op === 'delete') { return { data: null, error: { message: 'RELEASE_SIGNOFF_LOCKED' } }; }
    if (st.op === 'insert') {
      if (world.failInsert) { return { data: null, error: { message: 'insert failed' } }; }
      var r = Object.assign({ id: ++world.seq, created_at: new Date(Date.now() + world.seq).toISOString() }, JSON.parse(JSON.stringify(st.vals)));
      world.rows.push(r); world.events.push('row:' + r.action); return { data: [r], error: null };
    }
    var hit = world.rows.filter(function (r) { return st.f.every(function (f) { return f(r); }); }).slice();
    hit.sort(function (a, b) { return st.asc ? a.id - b.id : b.id - a.id; });
    if (st.lim != null) { hit = hit.slice(0, st.lim); }
    return { data: hit, error: null };
  }
  return { data: [], error: null };
}
var fakeDb = { from: function (n) { return Q(n); } };

// No Vercel stand-in: this build makes no call to Vercel. Any outside call fails the test.
global.fetch = function (u) { failN++; console.log('  FAIL: an outside call was made: ' + u); return Promise.reject(new Error('no outside calls in this build')); };

// ---------------- module stand-ins: next/server, supabase client, the sign-in check. Everything else is real.
var REG = { updated: '2026-11-24', items: [
  { id: 'wh-ready', title: 'Order Queue rebuild', repo: 'nextrade_WAREHOUSE', status: 'queued', codexRef: { sha: 'f00dbabe1234', target: 'production', feedbackRef: 'codex 24 Nov' } },
  { id: 'wh-nocodex', title: 'Warehouse look', repo: 'nextrade_WAREHOUSE', status: 'queued', needsCodex: true },
  { id: 'wh-stagingpass', title: 'Staging only pass', repo: 'nextrade_WAREHOUSE', status: 'queued', codexRef: { sha: 'f00dbabe9999', target: 'staging', feedbackRef: 'codex' } },
  { id: 'wh-live', title: 'Hub embed enablement', repo: 'nextrade_WAREHOUSE', status: 'live', build: 'abc1234', backupDir: '/home/u/code-backups/wh-live-20261120101010', backup: '/home/u/code-backups/wh-live-20261120101010' },
  { id: 'wh-hand', title: 'Moved by hand', repo: 'nextrade_WAREHOUSE', status: 'live', build: 'cPanel config (live)', backup: '~/code-backups/embed-20261122/ (by hand)' }
], protocol: [], legend: [] };
var origLoad = Module._load;
Module._load = function (request, parent) {
  if (request === 'next/server') { return { NextResponse: { json: function (body, init) { return { status: (init && init.status) || 200, body: body }; } } }; }
  if (request === '@supabase/supabase-js') { return { createClient: function () { return fakeDb; } }; }
  if (/verified-caller$/.test(request)) { return { verifiedCaller: function () { return Promise.resolve(world.caller ? { userId: world.caller } : { error: 'Sign in again — your sign-in could not be verified.', status: 401 }); } }; }
  if (/release-register\.json$/.test(request)) { return REG; }
  return origLoad.apply(this, arguments);
};
// /api/releases prefers a register file under the current folder (local-dev freshness). Run from a folder
// that has none, so it uses the bundled register — the stand-in above — exactly as on the deployed Hub.
process.chdir(fs.existsSync('D:/GITHUB/_test-tools/tmp') ? 'D:/GITHUB/_test-tools/tmp' : require('os').tmpdir());
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test.invalid'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
var relRoute = require(path.join(root, 'src/app/api/releases/route.js'));
var signRoute = require(path.join(root, 'src/app/api/releases/signoff/route.js'));
var lib = require(path.join(root, 'src/lib/release-signoff.js'));
function req(body) { return { json: function () { return Promise.resolve(body); }, headers: { get: function () { return ''; } } }; }

(async function () {
  var r, s;
  // ============ 1. sign-off route: who
  world.caller = null; r = await signRoute.POST(req({ item_id: 'wh-ready', action: 'go', confirm: 'Order Queue rebuild' }));
  check('not signed in = 401, no row', r.status === 401 && world.rows.length === 0, r);
  world.caller = 'u-staff'; r = await signRoute.POST(req({ item_id: 'wh-ready', action: 'go', confirm: 'Order Queue rebuild' }));
  check('staff WITH releases.access cannot sign = 403, no row', r.status === 403 && world.rows.length === 0, r);
  world.caller = 'u-admin'; r = await signRoute.POST(req({ item_id: 'wh-ready', action: 'go', confirm: 'Order Queue rebuild' }));
  check('an admin (not super admin) cannot sign = 403, no row', r.status === 403 && world.rows.length === 0, r);
  world.caller = 'u-ghost'; r = await signRoute.POST(req({ item_id: 'wh-ready', action: 'go', confirm: 'Order Queue rebuild' }));
  check('an unknown user cannot sign = 403', r.status === 403 && world.rows.length === 0, r);
  world.caller = 'u-staff'; r = await signRoute.POST(req({ item_id: 'wh-ready', action: 'go', confirm: 'Order Queue rebuild', user_id: 'u-max' }));
  check('a user_id in the request does not make the caller Max', r.status === 403 && world.rows.length === 0, r);

  // ============ 2. sign-off route: the rules
  world.caller = 'u-max';
  r = await signRoute.POST(req({ item_id: 'nope', action: 'go', confirm: 'x' }));
  check('a change that is not on the schedule = 404', r.status === 404 && world.rows.length === 0, r);
  r = await signRoute.POST(req({ item_id: 'wh-ready', action: 'go', confirm: 'order queue' }));
  check('the name typed wrong = refused, no row', r.status === 400 && world.rows.length === 0, r);
  r = await signRoute.POST(req({ item_id: 'wh-ready', action: 'go' }));
  check('no name typed = refused', r.status === 400 && world.rows.length === 0, r);
  r = await signRoute.POST(req({ item_id: 'wh-nocodex', action: 'go', confirm: 'Warehouse look' }));
  check('no Codex pass recorded = cannot be signed off', r.status === 409 && /Codex/.test(r.body.error) && world.rows.length === 0, r);
  r = await signRoute.POST(req({ item_id: 'wh-stagingpass', action: 'go', confirm: 'Staging only pass' }));
  check('a Codex pass for STAGING is not a pass for production', r.status === 409 && world.rows.length === 0, r);
  r = await signRoute.POST(req({ item_id: 'wh-live', action: 'go', confirm: 'Hub embed enablement' }));
  check('a change already on production cannot get a go', r.status === 409 && world.rows.length === 0, r);
  r = await signRoute.POST(req({ item_id: 'wh-ready', action: 'rollback', confirm: 'Order Queue rebuild' }));
  check('a change that is not live cannot be rolled back', r.status === 409 && world.rows.length === 0, r);
  r = await signRoute.POST(req({ item_id: 'wh-ready', action: 'withdraw', confirm: 'Order Queue rebuild' }));
  check('nothing to take back = refused', r.status === 409 && world.rows.length === 0, r);
  r = await signRoute.POST(req({ item_id: 'wh-ready', action: 'deploy', confirm: 'Order Queue rebuild' }));
  check('an unknown action = refused', r.status === 400 && world.rows.length === 0, r);

  r = await signRoute.POST(req({ item_id: 'wh-ready', action: 'go', confirm: '  order queue REBUILD ', approval_text: 'FORGED', sha: 'evil', signed_by: 'u-staff', scope: 'hub' }));
  var row = world.rows[0];
  check('a go is recorded (name typed in any letter case)', r.status === 200 && r.body.ok === true && r.body.moved === false && world.rows.length === 1, r);
  check('…bound to the exact build Codex passed, with the server\'s own sentence and the verified signer (nothing from the browser)',
    row.sha === 'f00dbabe1234' && row.target === 'production' && row.approval_text === 'Max: yes, put wh-ready on production @ f00dbabe1234' && row.signed_by === 'u-max' && row.signed_by_name === 'Max' && row.scope === 'warehouse' && row.action === 'go', row);
  r = await signRoute.POST(req({ item_id: 'wh-ready', action: 'go', confirm: 'Order Queue rebuild' }));
  check('the same build cannot be signed twice', r.status === 409 && world.rows.length === 1, r);
  r = await signRoute.POST(req({ item_id: 'wh-ready', action: 'withdraw', confirm: 'Order Queue rebuild' }));
  check('taking it back adds a NEW row; the go row is still there', r.status === 200 && world.rows.length === 2 && world.rows[0].action === 'go' && world.rows[1].action === 'withdraw', world.rows);
  r = await signRoute.POST(req({ item_id: 'wh-ready', action: 'go', confirm: 'Order Queue rebuild' }));
  check('after taking it back, a new go can be given', r.status === 200 && world.rows.length === 3);
  r = await signRoute.POST(req({ item_id: 'wh-live', action: 'rollback', confirm: 'Hub embed enablement' }));
  check('a roll-back request on a change the register says deploy.js moved names that exact build and backup folder', r.status === 200 && world.rows[3].action === 'rollback' && world.rows[3].approval_text === 'Max: roll wh-live back @ abc1234' && world.rows[3].sha === 'abc1234' && world.rows[3].detail.backup === '/home/u/code-backups/wh-live-20261120101010' && world.rows[3].detail.target_from === 'register' && world.rows[3].ref_id === null && r.body.sha === 'abc1234' && r.body.backup === '/home/u/code-backups/wh-live-20261120101010', world.rows[3]);
  var nHand = world.rows.length; r = await signRoute.POST(req({ item_id: 'wh-hand', action: 'rollback', confirm: 'Moved by hand' }));
  check('a change moved BY HAND has no recorded build / backup: a roll back cannot be requested (never a request with no target)', r.status === 409 && /moved by hand/.test(r.body.error) && world.rows.length === nHand, r);
  r = await signRoute.POST(req({ item_id: 'wh-live', action: 'rollback', confirm: 'Hub embed enablement' }));
  check('a second roll-back request while one is open = refused', r.status === 409 && world.rows.length === 4);
  check('the route never updates or deletes a row', world.rows.every(function (x) { return !!x.id; }) && !/\.(update|delete|upsert)\s*\(/.test(fs.readFileSync(path.join(root, 'src/app/api/releases/signoff/route.js'), 'utf8')));
  world.failInsert = true; r = await signRoute.POST(req({ item_id: 'wh-live', action: 'withdraw', confirm: 'Hub embed enablement' })); world.failInsert = false;
  check('a save that fails says so (never "recorded")', r.status === 500 && r.body.ok === false, r);
  world.tableInstalled = false; r = await signRoute.POST(req({ item_id: 'wh-ready', action: 'withdraw', confirm: 'Order Queue rebuild' })); world.tableInstalled = true;
  check('table not installed = a plain "not installed", nothing recorded', r.status === 409 && /not installed/.test(r.body.error) && world.rows.length === 4, r);

  // ============ 3. the schedule read: state + buttons
  world.caller = 'u-max'; r = await relRoute.GET(req());
  s = r.body.signoffs;
  check('super admin: canSign, signed change shows the go and offers only "take it back"', r.body.canSign === true && s['wh-ready'].kind === 'go' && s['wh-ready'].canWithdraw && !s['wh-ready'].canGo && s['wh-ready'].by === 'Max', s['wh-ready']);
  check('no Codex pass: no button and the reason is given', s['wh-nocodex'].canGo === false && /Codex/.test(s['wh-nocodex'].why));
  check('live change with an open roll-back request shows it', s['wh-live'].kind === 'rollback' && s['wh-live'].canWithdraw === true && s['wh-live'].canRollback === false);
  world.caller = 'u-staff'; r = await relRoute.GET(req()); s = r.body.signoffs;
  check('staff with releases.access can READ the state but gets no buttons', r.status === 200 && r.body.canSign === false && s['wh-ready'].kind === 'go' && Object.keys(s).every(function (k) { return !s[k].canGo && !s[k].canRollback && !s[k].canWithdraw; }), s);
  world.caller = 'u-max'; world.tableInstalled = false; r = await relRoute.GET(req()); world.tableInstalled = true;
  check('table not installed: the schedule still loads, says so, and offers no button', r.status === 200 && r.body.signoffsInstalled === false && r.body.items.length === 5 && Object.keys(r.body.signoffs).every(function (k) { return r.body.signoffs[k].kind === 'unknown' && !r.body.signoffs[k].canGo && !r.body.signoffs[k].canRollback; }), r.body.signoffs);
  // a go for an OLDER build does not carry over to a new build
  REG.items[0].codexRef.sha = 'newbuild7777'; r = await relRoute.GET(req()); s = r.body.signoffs['wh-ready'];
  check('a new build does NOT inherit the earlier go: it needs its own', s.kind === 'none' && s.stale === true && s.canGo === true, s);
  REG.items[0].codexRef.sha = 'f00dbabe1234';
  REG.items[0].status = 'live'; REG.items[0].build = 'f00dbabe1234'; REG.items[0].backupDir = '/home/u/code-backups/wh-ready-20261124101010'; r = await relRoute.GET(req()); s = r.body.signoffs['wh-ready'];
  check('once the change is live the go is used up and Roll back is offered for that build', s.kind === 'none' && s.canRollback === true && s.canGo === false && s.liveBuild === 'f00dbabe1234' && s.liveBackup === '/home/u/code-backups/wh-ready-20261124101010', s);
  REG.items[0].status = 'queued'; delete REG.items[0].build; delete REG.items[0].backupDir;
  check('a hand-moved live change offers no roll-back button and says why', r.body.signoffs['wh-hand'].canRollback === false && /moved by hand/.test(r.body.signoffs['wh-hand'].why));

  // ============ 4. the change history, and where a change IS (the office PC's move rows)
  function pcRow(o) { var r = Object.assign({ id: ++world.seq, created_at: new Date(Date.now() + world.seq * 1000).toISOString(), scope: 'warehouse', target: 'production', recorded_by: 'KTC office PC (Claude)' }, o); world.rows.push(r); return r; }
  world.caller = 'u-max'; r = await relRoute.GET(req());
  check('the history lists every row so far, newest first, in plain words', r.body.history.length === world.rows.length && r.body.history[0].at >= r.body.history[r.body.history.length - 1].at && r.body.history.some(function (h) { return h.what === 'Approved for production' && h.title === 'Order Queue rebuild' && h.by === 'Max' && h.build === 'f00dbabe1234'; }) && r.body.history.some(function (h) { return h.what === 'Taken back'; }) && r.body.historyComplete === true, r.body.history);
  var goRow = world.rows.filter(function (x) { return x.item_id === 'wh-ready' && x.action === 'go'; }).pop();
  pcRow({ item_id: 'wh-ready', action: 'moved', sha: 'f00dbabe1234', ref_id: goRow.id, detail: { title: 'Order Queue rebuild', backup: '/home/u/code-backups/wh-ready-20261124101010', note: '3 files' } });
  r = await relRoute.GET(req()); s = r.body.signoffs['wh-ready'];
  check('after the office PC records the move, the change shows as on production / not yet checked — without a new Hub release', s.where === 'deployed' && s.kind === 'none' && s.canGo === false && s.canRollback === true, s);
  check('…and the move is in the history with its build and backup folder', r.body.history[0].what === 'Moved to production — waiting to be checked' && r.body.history[0].backup === '/home/u/code-backups/wh-ready-20261124101010' && r.body.history[0].by === 'KTC office PC (Claude)' && r.body.history[0].build === 'f00dbabe1234', r.body.history[0]);
  r = await signRoute.POST(req({ item_id: 'wh-ready', action: 'go', confirm: 'Order Queue rebuild' }));
  check('a change that was moved cannot be given a second go', r.status === 409 && /already on production/.test(r.body.error), r);
  pcRow({ item_id: 'wh-ready', action: 'checked_live', sha: 'f00dbabe1234', detail: { title: 'Order Queue rebuild', backup: '/home/u/code-backups/wh-ready-20261124101010', checked: 'Max released one test order' } });
  r = await relRoute.GET(req()); s = r.body.signoffs['wh-ready'];
  check('after the check is recorded it shows as live', s.where === 'live' && s.canRollback === true && r.body.history[0].what === 'Checked on the live site — live', s);
  r = await signRoute.POST(req({ item_id: 'wh-ready', action: 'rollback', confirm: 'Order Queue rebuild' }));
  var rbRow = world.rows[world.rows.length - 1];
  var movedRow = world.rows.filter(function (x) { return x.item_id === 'wh-ready' && x.action === 'moved'; }).pop();
  check('a change the register still calls "queued" but the history says is live CAN be rolled back', r.status === 200 && rbRow.action === 'rollback' && rbRow.approval_text === 'Max: roll wh-ready back @ f00dbabe1234', r);
  check('Codex 24 Nov: that request records the EXACT build, backup folder and the move it undoes — taken from the history, not the stale register', rbRow.sha === 'f00dbabe1234' && rbRow.detail.backup === '/home/u/code-backups/wh-ready-20261124101010' && rbRow.ref_id === movedRow.id && rbRow.detail.target_from === 'history' && r.body.sha === 'f00dbabe1234' && r.body.backup === '/home/u/code-backups/wh-ready-20261124101010' && r.body.undoes_row === movedRow.id, rbRow);
  r = await relRoute.GET(req()); var hRb = r.body.history.filter(function (h) { return h.row === rbRow.id; })[0] || {};
  check('…and the history shows that target on the request line', hRb.what === 'Roll back asked for' && hRb.build === 'f00dbabe1234' && hRb.backup === '/home/u/code-backups/wh-ready-20261124101010' && hRb.ref === movedRow.id && hRb.row === rbRow.id, hRb);
  pcRow({ item_id: 'wh-ready', action: 'rollback_failed', sha: 'f00dbabe1234', ref_id: rbRow.id, detail: { title: 'Order Queue rebuild', backup: '/home/u/code-backups/wh-ready-20261124101010', outcome: 'recovery_incomplete', note: 'site answered 500' } });
  r = await relRoute.GET(req()); s = r.body.signoffs['wh-ready'];
  check('a roll back that did not finish: production state UNCONFIRMED, flagged, and nothing new can be asked for', s.where === 'unknown' && s.kind === 'rollback' && /did not finish/.test(s.problem) && s.canGo === false && s.canRollback === false && r.body.history[0].what === 'Roll back did not finish — needs attention', s);
  var nBlk = world.rows.length; r = await signRoute.POST(req({ item_id: 'wh-ready', action: 'go', confirm: 'Order Queue rebuild' }));
  check('…a go is refused while it is unconfirmed, no row', r.status === 409 && /checked the live site/.test(r.body.error) && world.rows.length === nBlk, r);
  pcRow({ item_id: 'wh-ready', action: 'recovery_confirmed', sha: 'f00dbabe1234', ref_id: rbRow.id, detail: { title: 'Order Queue rebuild', backup: '/home/u/code-backups/wh-ready-20261124101010', where: 'live', checked: 'Max opened the order queue; the new version is still there' } });
  r = await relRoute.GET(req()); s = r.body.signoffs['wh-ready'];
  check('after a person records that it is still on production: live again, the old request is used up, a NEW roll back can be asked for the same build', s.where === 'live' && s.kind === 'none' && s.canRollback === true && s.liveBuild === 'f00dbabe1234' && s.problem === '' && r.body.history[0].what === 'Checked by a person after the problem — on production', s);
  r = await signRoute.POST(req({ item_id: 'wh-ready', action: 'rollback', confirm: 'Order Queue rebuild' })); rbRow = world.rows[world.rows.length - 1];
  check('the new request again names the build, the backup and the move row', r.status === 200 && rbRow.sha === 'f00dbabe1234' && rbRow.detail.backup === '/home/u/code-backups/wh-ready-20261124101010' && rbRow.ref_id === movedRow.id);
  pcRow({ item_id: 'wh-ready', action: 'rolled_back', sha: 'f00dbabe1234', ref_id: rbRow.id, detail: { title: 'Order Queue rebuild', backup: '/home/u/code-backups/wh-ready-20261124101010' } });
  r = await relRoute.GET(req()); s = r.body.signoffs['wh-ready'];
  check('after the roll back is recorded: back on staging, both requests used up, a NEW go is needed', s.where === 'staging' && s.kind === 'none' && s.canGo === true && s.canRollback === false && s.problem === '', s);
  r = await signRoute.POST(req({ item_id: 'wh-ready', action: 'go', confirm: 'Order Queue rebuild' })); var go3 = world.rows[world.rows.length - 1];
  pcRow({ item_id: 'wh-ready', action: 'failed', sha: 'f00dbabe1234', ref_id: go3.id, detail: { title: 'Order Queue rebuild', backup: '/home/u/code-backups/wh-ready-20261124101010', outcome: 'restored', note: 'the site answered 500 after the move' } });
  r = await relRoute.GET(req()); s = r.body.signoffs['wh-ready'];
  check('a failed move with a CONFIRMED automatic restore: on staging, the go is used up, the failure is shown', s.where === 'staging' && s.kind === 'none' && s.canGo === true && /failed and was put back/.test(s.problem) && r.body.history[0].what === 'Move failed — put back automatically', s);
  r = await signRoute.POST(req({ item_id: 'wh-ready', action: 'go', confirm: 'Order Queue rebuild' })); var go4 = world.rows[world.rows.length - 1];
  pcRow({ item_id: 'wh-ready', action: 'failed', sha: 'f00dbabe1234', ref_id: go4.id, detail: { title: 'Order Queue rebuild', backup: '', outcome: 'not_replaced', note: 'the backup folder already existed' } });
  r = await relRoute.GET(req()); s = r.body.signoffs['wh-ready'];
  check('a move that stopped before anything was replaced: on staging, said in those words (not "put back")', s.where === 'staging' && s.canGo === true && /before anything on production was replaced/.test(s.problem) && r.body.history[0].what === 'Move failed — nothing on production was replaced', s);
  // Codex 24 Nov: the automatic restore did NOT finish. It must never read as "put back", and no fresh go.
  r = await signRoute.POST(req({ item_id: 'wh-ready', action: 'go', confirm: 'Order Queue rebuild' })); var go5 = world.rows[world.rows.length - 1];
  pcRow({ item_id: 'wh-ready', action: 'recovery_incomplete', sha: 'f00dbabe1234', ref_id: go5.id, detail: { title: 'Order Queue rebuild', backup: '/home/u/code-backups/wh-ready-20261124101010', outcome: 'recovery_incomplete', files_back: true, problems: 'php artisan view:clear failed', note: '' } });
  r = await relRoute.GET(req()); s = r.body.signoffs['wh-ready'];
  check('restore NOT confirmed: production state unconfirmed, needs attention, NO go button, NO roll-back button, never "put back"', s.where === 'unknown' && s.canGo === false && s.canRollback === false && s.kind === 'none' && /restore is not confirmed/.test(s.problem) && r.body.history[0].what === 'Move did not finish — production state unconfirmed, needs attention' && !/put back/.test(r.body.history[0].what), s);
  nBlk = world.rows.length; r = await signRoute.POST(req({ item_id: 'wh-ready', action: 'go', confirm: 'Order Queue rebuild' }));
  var r2b = await signRoute.POST(req({ item_id: 'wh-ready', action: 'rollback', confirm: 'Order Queue rebuild' }));
  check('…and the server refuses a go AND a roll-back request in that state, no row', r.status === 409 && r2b.status === 409 && world.rows.length === nBlk, [r, r2b]);
  check('a "failed" row that does not say how it ended is treated as unconfirmed too, not as put back', (function () { var st = lib.latestByItem([{ id: 1, item_id: 'x', action: 'go', sha: 'f00dbabe1234' }, { id: 2, item_id: 'x', action: 'failed', sha: 'f00dbabe1234', detail: { note: 'restore did not finish' } }]).x; var h = lib.historyList([{ id: 2, item_id: 'x', action: 'failed', detail: {} }], { items: [] })[0]; return st.where === 'unknown' && st.block === true && !/put back/.test(h.what) && /unconfirmed/.test(h.what); })());
  pcRow({ item_id: 'wh-ready', action: 'recovery_confirmed', sha: 'f00dbabe1234', ref_id: go5.id, detail: { title: 'Order Queue rebuild', backup: '/home/u/code-backups/wh-ready-20261124101010', where: 'staging', checked: 'Max compared the three files with the backup; all as before' } });
  r = await relRoute.GET(req()); s = r.body.signoffs['wh-ready'];
  check('only after a person records the checked recovery: back on staging and a go can be given again', s.where === 'staging' && s.canGo === true && s.problem === '' && r.body.history[0].what === 'Checked by a person after the problem — back to what it was before', s);

  // Codex 24 Nov: register says build A is live; a recorded move put build B there. The request must name B.
  var goB = pcRow({ item_id: 'wh-live', action: 'go', sha: 'bbbb2222cccc', approval_text: 'Max: yes, put wh-live on production @ bbbb2222cccc', signed_by: 'u-max', signed_by_name: 'Max', recorded_by: undefined });
  var movB = pcRow({ item_id: 'wh-live', action: 'moved', sha: 'bbbb2222cccc', ref_id: goB.id, detail: { title: 'Hub embed enablement', backup: '/home/u/code-backups/wh-live-20261124121212' } });
  r = await relRoute.GET(req()); s = r.body.signoffs['wh-live'];
  check('the earlier open request (for build A) no longer stands once build B was moved', s.kind === 'none' && s.liveBuild === 'bbbb2222cccc' && s.canRollback === true, s);
  r = await signRoute.POST(req({ item_id: 'wh-live', action: 'rollback', confirm: 'Hub embed enablement' })); var rbB = world.rows[world.rows.length - 1];
  check('the request names build B, B\'s backup and B\'s move row — not the register\'s build A', r.status === 200 && rbB.sha === 'bbbb2222cccc' && rbB.detail.backup === '/home/u/code-backups/wh-live-20261124121212' && rbB.ref_id === movB.id && rbB.approval_text === 'Max: roll wh-live back @ bbbb2222cccc' && rbB.sha !== 'abc1234', rbB);
  pcRow({ item_id: 'wh-live', action: 'rolled_back', sha: 'bbbb2222cccc', ref_id: rbB.id, detail: { title: 'Hub embed enablement', backup: '/home/u/code-backups/wh-live-20261124121212' } });
  r = await relRoute.GET(req()); s = r.body.signoffs['wh-live'];
  check('after B is rolled back the history says staging, and the register\'s old "live, build A" is NOT offered for roll back', s.where === 'staging' && s.canRollback === false && s.liveBuild === '', s);
  check('a request for one build goes stale if a different build is on production', (function () { var st = lib.latestByItem([{ id: 1, item_id: 'x', action: 'moved', sha: 'aaaaaaa1', detail: { backup: '/b/a' } }, { id: 2, item_id: 'x', action: 'rollback', sha: 'aaaaaaa1', ref_id: 1, detail: { backup: '/b/a' } }]).x; st.dep = { id: 9, sha: 'ccccccc3', backup: '/b/c' }; var o = lib.itemSignState({ id: 'x', title: 'X' }, st); return o.kind === 'none' && o.stale === true && o.canRollback === true; })());
  check('nothing was ever dropped from the history: every row is listed', r.body.history.length === world.rows.length);
  REG.events = [{ at: '2026-11-20T10:00:00.000Z', action: 'codex-pass', item: 'wh-ready', build: 'f00dbabe1234', detail: 'target=production ref=codex 24 Nov' }, { at: '2026-11-20T11:00:00.000Z', action: 'state', item: 'wh-ready', detail: 'deploying' }];
  r = await relRoute.GET(req()); delete REG.events;
  check('Codex passes from the release log are in the history too; internal state lines are not', r.body.history.length === world.rows.length + 1 && r.body.history[r.body.history.length - 1].what === 'Codex passed this build');
  world.caller = 'u-staff'; r = await relRoute.GET(req()); world.caller = 'u-max';
  check('staff with the Change Schedule switch can read the history', r.status === 200 && r.body.history.length === world.rows.length);
  world.tableInstalled = false; r = await relRoute.GET(req()); world.tableInstalled = true;
  check('table not installed: an empty history, never a made-up one', r.body.history.length === 0 && r.body.signoffsInstalled === false);
  var compH = fs.readFileSync(path.join(root, 'src/components/ChangeScheduleTab.jsx'), 'utf8');
  check('the screen shows the history and sorts changes into the lists by where they ARE', /<History rows=\{data\.history/.test(compH) && /whereOf\(it, signs\[it\.id\]\) === 'staging'/.test(compH) && /not yet checked/.test(compH));

  // the office PC's history row: built from what deploy.js / rollback.js recorded, never from typed values
  var hr = require(path.join(root, 'release-management/deploy/history-row.js'));
  var moved = { id: "wh-o'brien", title: 'T', lifecycle: 'deployed', deployedSha: 'abc1234def', backupDir: '/home/u/code-backups/x-20261124101010' };
  var stmt = hr.historyRow(moved, { action: 'moved', ref: '12', note: "it's in" });
  check('a moved row carries the build, the backup folder, the go it carried out and who recorded it; quotes are escaped', /^INSERT INTO public\.release_signoffs /.test(stmt) && stmt.indexOf("'wh-o''brien'") > 0 && stmt.indexOf("'abc1234def'") > 0 && stmt.indexOf('code-backups/x-20261124101010') > 0 && stmt.indexOf("it''s in") > 0 && / 12, 'KTC office PC \(Claude\)'\)/.test(stmt) && !/;.*;/.test(stmt), stmt);
  function throwsHR(item, o) { try { hr.historyRow(item, o); return false; } catch (e) { return true; } }
  check('a row that does not match what the register says happened is refused', throwsHR(moved, { action: 'checked_live' }) && throwsHR(moved, { action: 'rolled_back', ref: '12' }) && throwsHR(Object.assign({}, moved, { lifecycle: 'queued' }), { action: 'moved', ref: '12' }));
  check('a moved / failed / rolled_back row without the go it carried out is refused; an unknown action is refused; a non-number ref is refused', throwsHR(moved, { action: 'moved' }) && throwsHR(moved, { action: 'deleted', ref: '1' }) && throwsHR(moved, { action: 'moved', ref: '1; DROP' }));
  check('no backup folder recorded = it cannot be recorded as moved', throwsHR(Object.assign({}, moved, { backupDir: '' }), { action: 'moved', ref: '12' }));
  var att = function (outcome, extra) { return Object.assign({ id: 'wh-f', title: 'F', lifecycle: outcome === 'recovery_incomplete' ? 'needs-attention' : 'failed', lastAttempt: Object.assign({ kind: 'move', sha: 'abc1234def', outcome: outcome, backupDir: '/home/u/code-backups/f-1', replaced: ['a.php'], restoredFiles: ['a.php'], filesBack: true, undoDir: '/home/u/code-backups/f-failed-1', problems: ['php artisan view:clear failed'] }, extra || {}) }); };
  stmt = hr.historyRow(att('restored'), { action: 'failed', ref: '5' });
  check('a failed row states HOW it ended, with the backup, from the recorded attempt', stmt.indexOf('"outcome":"restored"') > 0 && stmt.indexOf('"backup":"/home/u/code-backups/f-1"') > 0 && stmt.indexOf('view:clear failed') > 0, stmt);
  check('Codex 24 Nov: a move whose restore is NOT confirmed can never be recorded as "failed" (= put back)', throwsHR(att('recovery_incomplete'), { action: 'failed', ref: '5' }));
  stmt = hr.historyRow(att('recovery_incomplete'), { action: 'recovery_incomplete', ref: '5' });
  check('…it is recorded as recovery_incomplete, with whether the files are back and what went wrong', stmt.indexOf("'recovery_incomplete'") > 0 && stmt.indexOf('"files_back":true') > 0 && stmt.indexOf('view:clear failed') > 0 && stmt.indexOf('"backup":"/home/u/code-backups/f-1"') > 0, stmt);
  check('a confirmed-restore failure cannot be recorded as recovery_incomplete either, and a failure with no recorded outcome cannot be recorded as failed', throwsHR(att('restored'), { action: 'recovery_incomplete', ref: '5' }) && throwsHR({ id: 'x', title: 'X', lifecycle: 'failed' }, { action: 'failed', ref: '5' }));
  check('recovery_confirmed needs the person\'s check recorded in the register first', throwsHR(att('recovery_incomplete'), { action: 'recovery_confirmed', ref: '5' }) && hr.historyRow(Object.assign(att('recovery_incomplete'), { lifecycle: 'recovered', recovery: { where: 'staging', by: 'Max compared the files with the backup' } }), { action: 'recovery_confirmed', ref: '5' }).indexOf('"where":"staging"') > 0);
  check('a roll back that stopped part-way is recorded as rollback_failed only from a recorded part-way roll back', throwsHR(att('recovery_incomplete'), { action: 'rollback_failed', ref: '5' }) && hr.historyRow(att('recovery_incomplete', { kind: 'rollback' }), { action: 'rollback_failed', ref: '5' }).indexOf("'rollback_failed'") > 0);
  // ============ 9. pure rules
  check('approval sentences are fixed by the server', lib.approvalText('go', { id: 'a' }, 'abc1234') === 'Max: yes, put a on production @ abc1234' && lib.approvalText('rollback', { id: 'a' }, 'abc1234') === 'Max: roll a back @ abc1234');
  check('passedBuild needs sha (7+), production and a feedback reference', lib.passedBuild({ codexRef: { sha: 'abc1234', target: 'production', feedbackRef: 'x' } }) !== null && lib.passedBuild({ codexRef: { sha: 'abc', target: 'production', feedbackRef: 'x' } }) === null && lib.passedBuild({ codexRef: { sha: 'abc1234', target: 'production' } }) === null && lib.passedBuild({ needsCodex: false }) === null);
  check('the stored go sentence opens the existing XH gate only together with Codex + QA for the same build', (function () {
    var gate = require(path.join(root, 'release-management/lib/gate.js'));
    var it = { codexRef: { sha: 'f00dbabe1234', target: 'production', feedbackRef: 'c' }, behavioralQa: { sha: 'f00dbabe1234', target: 'production', kind: 'behavioral', result: 'PASS' }, maxApproval: { text: world.rows[0].approval_text } };
    var okAll = gate.evaluateGate(it, { sha: 'f00dbabe1234', target: 'production', confirm: world.rows[0].approval_text }).ok;
    delete it.behavioralQa;
    return okAll === true && gate.evaluateGate(it, { sha: 'f00dbabe1234', target: 'production', confirm: world.rows[0].approval_text }).ok === false;
  })());

  // ============ 10. wiring pins
  var comp = fs.readFileSync(path.join(root, 'src/components/ChangeScheduleTab.jsx'), 'utf8');
  var libSrc = fs.readFileSync(path.join(root, 'src/lib/release-signoff.js'), 'utf8');
  var routes = ['src/app/api/releases/route.js', 'src/app/api/releases/signoff/route.js'].map(function (f) { return fs.readFileSync(path.join(root, f), 'utf8'); });
  check('the screen calls the sign-off route with the sign-in', /\/api\/releases\/signoff/.test(comp) && /Authorization.*Bearer/.test(comp));
  check('Hub releases are untouched: no Hub roll-back route, panel or Vercel call in this build', !fs.existsSync(path.join(root, 'src/app/api/releases/hub-versions')) && !/HubVersions|hub-versions|vercel/i.test(comp) && !/vercel/i.test(libSrc) && !/vercel\.com/i.test(routes.join('')));
  check('the screen imports what it uses (useState, useEffect, supabase)', /import React, \{ useEffect, useState \} from 'react'/.test(comp) && /import \{ supabase \} from '..\/lib\/supabase'/.test(comp));
  check('the server lib is not a client module and imports only the server permission loader', !/^'use client'/.test(libSrc) && /from '\.\/server-permissions'/.test(libSrc));
  check('server files keep the house style (no let / const / arrow / template literal / optional chaining)', [libSrc].concat(routes).every(function (src) {
    var body = src.replace(/\/\/.*$/gm, '').replace(/export const (runtime|dynamic) = '[a-z-]+';/g, '');
    return !/\blet\s|\bconst\s|=>|`|\?\./.test(body);
  }));
  check('/api/releases itself is still read-only (no POST, no insert)', !/export async function (POST|PUT|DELETE|PATCH)/.test(routes[0]) && !/\.(insert|update|delete|upsert)\s*\(/.test(routes[0]));
  var page = fs.readFileSync(path.join(root, 'src/app/page.jsx'), 'utf8'); var wn = fs.readFileSync(path.join(root, 'src/components/WhatsNewWidget.jsx'), 'utf8');
  check("What's New has a v55.83-YJ entry", /version: 'v55\.83-YJ'/.test(wn));
  check('the badge names the newest What\'s New entry', (function () { var top = /BUILD_HISTORY = \[\s*\{\s*version: '(v55\.83-[A-Z]+)'/.exec(wn); return !!top && page.indexOf('>' + top[1] + '</span>') > 0; })());
  var sql = fs.readFileSync(path.join(root, 'sql/v55-83-YJ-release-signoffs.sql'), 'utf8');
  check('the SQL has no DROP TABLE / DELETE / TRUNCATE statement of its own', !/DROP TABLE|^\s*DELETE\s|^\s*TRUNCATE\s/im.test(sql));

  console.log('\nYJ sign-off: ' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('  FAIL: the test crashed: ' + (e && e.stack || e)); process.exit(1); });
