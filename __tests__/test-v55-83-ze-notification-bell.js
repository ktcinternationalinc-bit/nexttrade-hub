// v55.83-ZE — the notification bell answered 400 every minute (Supabase edge logs, 25 Nov): it asked for target_user / read_at, but the
// live table public.notifications has ONLY id, user_id, type, title, body, read, created_at. The notify route wrote the same missing
// columns, so its bell rows never landed either. Runs the REAL notify route on an in-memory table with exactly the live columns, and the
// REAL bell queries (taken from the component) against the same table. Made-up people.
var path = require('path'); var Module = require('module'); var fs = require('fs');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'x';
delete process.env.RESEND_API_KEY; // no e-mail: the route writes the bell only
require(path.join(root, 'node_modules/sucrase/register'));
var MemDB = require('./helpers/memdb-wires.js');
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 700))); }
var LIVE_COLS = ['id', 'user_id', 'type', 'title', 'body', 'read', 'created_at'];
var A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222';
var db = new MemDB({ users: [{ id: A, name: 'Aya', email: null, active: true }, { id: B, name: 'Ben', email: null, active: true }], notifications: [] });
// the live table refuses any column it does not have (as PostgREST does: 400 / PGRST204)
var realFrom = db.from.bind(db);
db.from = function (t) {
  var q = realFrom(t); if (t !== 'notifications') { return q; }
  function bad(cols) { var x = cols.filter(function (c) { return LIVE_COLS.indexOf(c) < 0; }); return x.length ? Promise.resolve({ data: null, error: { code: 'PGRST204', message: 'column ' + x[0] + ' does not exist' } }) : null; }
  var ins = q.insert.bind(q); q.insert = function (rows) { var arr = Array.isArray(rows) ? rows : [rows]; var keys = {}; arr.forEach(function (r) { Object.keys(r).forEach(function (k) { keys[k] = true; }); }); var b = bad(Object.keys(keys)); if (b) { return { then: function (ok) { return b.then(ok); }, select: function () { return b; } }; } arr.forEach(function (r) { r.id = r.id || ('n' + Math.random()); r.created_at = r.created_at || new Date().toISOString(); if (r.read === undefined) { r.read = false; } }); return ins(arr); };
  var up = q.update.bind(q); q.update = function (p) { var b = bad(Object.keys(p)); if (b) { return { eq: function () { return this; }, in: function () { return this; }, then: function (ok) { return b.then(ok); } }; } return up(p); };
  var or = q.or ? q.or.bind(q) : null; q.or = function (expr) { var cols = String(expr).split(',').map(function (s) { return s.split('.')[0]; }); var b = bad(cols); if (b) { return { order: function () { return this; }, limit: function () { return b; } }; } return or(expr); };
  return q;
};
global.__db = db;
var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
fs.writeFileSync(mockPath, 'module.exports={createClient:function(){return global.__db;}};');
var orig = Module._resolveFilename;
Module._resolveFilename = function (req) { if (req === '@supabase/supabase-js') { return mockPath; } return orig.apply(this, arguments); };

(async function () {
  // rev2 (Codex 25 Nov): /api/notify is NOT changed in ZE — it takes recipients and text before any sign-in check, so its bell insert stays
  // as it is on live until it authenticates the sender (a separate build). The rows here are made the way reconcile/nexttrade makes them.
  db.t.notifications.push({ id: 'n1', user_id: A, type: 'ticket_assigned', title: 'Ticket T-1 assigned to you', body: 'Please look at T-1', read: false, created_at: '2026-11-25T10:00:00Z' });
  db.t.notifications.push({ id: 'n2', user_id: B, type: 'ticket_assigned', title: 'Ticket T-2 assigned to you', body: 'Please look at T-2', read: false, created_at: '2026-11-25T10:01:00Z' });
  var nsrc = fs.readFileSync(path.join(root, 'src/app/api/notify/route.js'), 'utf8');
  check('HOLD (Codex): the notify route is left exactly as on live — ZE does not make its unauthenticated insert succeed', /target_user: u\.id/.test(nsrc) && !/v55\.83-ZE/.test(nsrc));
  // the bell: its own query and its own mark-read, taken from the component and run against the same table
  var src = fs.readFileSync(path.join(root, 'src/components/NotificationBell.jsx'), 'utf8');
  check('BELL source: it asks only for live columns — user_id and read — and never target_user, read_at or created_by', /\.eq\('user_id', userId\)/.test(src) && /update\(\{ read: true \}\)/.test(src) && !/target_user|read_at|created_by/.test(src.replace(/\/\/.*$/mg, '')));
  var supabase = { from: db.from };
  var loadFn = new Function('supabase', 'userId', 'return (async function () { ' + src.match(/const \{ data \} = await supabase\.from\('notifications'\)[\s\S]*?\.limit\(30\);/)[0] + ' return data; })();');
  var mine = await loadFn(supabase, A);
  check('BELL load (its real query): Aya sees her own row — no 400', Array.isArray(mine) && mine.length === 1 && mine[0].user_id === A, mine);
  var unread = mine.filter(function (n) { return n.read !== true; }).length;
  check('…and it counts as 1 unread', unread === 1 && /setUnread\(\(data \|\| \[\]\)\.filter\(n => n\.read !== true\)\.length\)/.test(src));
  var markSrc = src.match(/await supabase\.from\('notifications'\)\.update\(\{ read: true \}\)\.eq\('id', id\)\.eq\('user_id', userId\);/)[0];
  await new Function('supabase', 'id', 'userId', 'return (async function () { ' + markSrc + ' })();')(supabase, mine[0].id, A);
  check('BELL mark read (its real update): Aya’s row is now read=true; Ben’s row is untouched', db.t.notifications.filter(function (r) { return r.user_id === A; })[0].read === true && db.t.notifications.filter(function (r) { return r.user_id === B; })[0].read === false);
  await new Function('supabase', 'id', 'userId', 'return (async function () { ' + markSrc + ' })();')(supabase, db.t.notifications.filter(function (r) { return r.user_id === B; })[0].id, A);
  check('…marking someone else’s row from Aya’s bell changes nothing (the update is limited to her own user_id)', db.t.notifications.filter(function (r) { return r.user_id === B; })[0].read === false);
  var old = await new Function('supabase', 'userId', 'return (async function () { return await supabase.from("notifications").select("*").or("target_user.eq." + userId + ",target_user.eq.all").order("created_at", { ascending: false }).limit(30); })();')(supabase, A);
  check('CONTROL: the OLD query on the same table is refused (what the edge logs showed every minute)', old && old.error && /target_user/.test(old.error.message), old);
  console.log('\nZE: ' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
