// v55.83-YW — Max 25 Nov: "even change history shows 0 … this thing needs a lot of work". Change Schedule kept showing the database as it
// was on ~24 Nov 12:08 UTC ("Worker disabled", history 0, only one move) because Next.js 14 kept the GET database reads of the
// GET-only /api/releases route in its Data Cache with no expiry (force-dynamic does not stop that for fetches).
// This runs the REAL route file through Next's REAL AppRouteRouteModule (so Next's real patched fetch decides what is cached), with the
// REAL supabase-js client, against a fake database server whose answers change between calls, and a fake Data Cache that records
// every write. Then the same with the fix taken out, to show the test can tell the difference. Then the 4 real release rows of
// 25 Nov (#1 go / #2 moved wh-order-queue, #3 go / #4 moved wh-xb-receipts-feed) through the route and the screen's own lists.
global.AsyncLocalStorage = require('async_hooks').AsyncLocalStorage;
var path = require('path'); var fs = require('fs'); var Module = require('module');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fixture-db.supabase.co'; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
require(path.join(root, 'node_modules/sucrase/register'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 700))); }
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
console.log('YW — Change Schedule reads the database fresh every time (no Next Data Cache)');

var MAX = '00000000-0000-0000-0000-0000000000a1';
// ── a fake database server (PostgREST shape) ──
var DB; var dbCalls = 0;
function freshDb() {
  DB = { users: [{ id: MAX, role: 'super_admin', name: 'Max', email: 'max@example.test', active: true }], module_permissions: [],
    release_worker_status: [{ id: 1, worker: 'ktc-office-release-worker', version: 'v', enabled: false, last_seen: '2026-11-24T12:08:52Z' }],
    release_execution: [], release_signoffs: [], release_worker_wake: [], release_stop: [] };
  dbCalls = 0;
}
function applyFilters(rows, params) {
  var out = rows.slice();
  params.forEach(function (v, k) {
    if (k === 'select' || k === 'order' || k === 'limit' || k === 'offset') { return; }
    if (v.indexOf('eq.') === 0) { var x = v.substring(3); out = out.filter(function (r) { return String(r[k]) === x; }); }
    else if (v.indexOf('in.(') === 0) { var list = v.substring(4, v.length - 1).split(',').map(function (s) { return s.replace(/^"|"$/g, ''); }); out = out.filter(function (r) { return list.indexOf(String(r[k])) >= 0; }); }
  });
  var ord = params.get('order');
  if (ord) { var p = ord.split('.'); var key = p[0]; var desc = p[1] === 'desc'; out.sort(function (a, b) { var A = a[key], B = b[key]; return (A > B ? 1 : A < B ? -1 : 0) * (desc ? -1 : 1); }); }
  var lim = params.get('limit'); if (lim) { out = out.slice(0, Number(lim)); }
  return out;
}
var originFetch = async function (input, init) {
  var url = new URL(typeof input === 'string' ? input : input.url);
  if (url.hostname !== 'fixture-db.supabase.co') { throw new Error('unexpected address ' + url.href); }
  dbCalls++;
  var m = /\/rest\/v1\/([a-z_]+)/.exec(url.pathname);
  var table = m && m[1];
  var rows = applyFilters(DB[table] || [], url.searchParams);
  return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } });
};
global.fetch = originFetch;

// ── a fake Next Data Cache that records every write ──
var cacheStore = {}; var cacheWrites = 0; var cacheHits = 0;
var fakeCache = { fetchCacheKey: async function (url, init) { return 'k:' + url + ':' + ((init && init.method) || 'GET'); },
  get: async function (key) { if (cacheStore[key]) { cacheHits++; return { value: cacheStore[key], isStale: false, lastModified: Date.now() }; } return null; },
  set: async function (key, data) { if (data) { cacheWrites++; cacheStore[key] = data; } }, revalidateTag: async function () {}, lock: async function () { return function () {}; } };

// Next's own server code expects its bundled React
var realLoad = Module._load;
var stubCaller = function (request) {
  if (request === 'react') { arguments[0] = path.join(root, 'node_modules/next/dist/compiled/react/index.js'); }
  if (/lib\/verified-caller$/.test(request)) { return { verifiedCaller: function () { return Promise.resolve({ userId: MAX }); } }; }
  return realLoad.apply(this, arguments);
};
Module._load = stubCaller;
var AppRoute = require(path.join(root, 'node_modules/next/dist/server/future/route-modules/app-route/module.js')).AppRouteRouteModule;
var NextRequest = require(path.join(root, 'node_modules/next/dist/server/web/spec-extension/request.js')).NextRequest;
var realRoute = require(path.join(root, 'src/app/api/releases/route.js'));
// the same route with the fix taken out (cached client + no segment settings) — the test must see the stale answers
Module._load = function (request) {
  if (/lib\/release-db$/.test(request)) { var sb = realLoad.call(this, '@supabase/supabase-js', module); return { releaseDb: function () { return sb.createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY); } }; }
  return stubCaller.apply(this, arguments);
};
delete require.cache[require.resolve(path.join(root, 'src/app/api/releases/route.js'))];
var brokenRoute = Object.assign({}, require(path.join(root, 'src/app/api/releases/route.js')));
delete brokenRoute.revalidate; delete brokenRoute.fetchCache;
Module._load = stubCaller;

function mk(userland) { return new AppRoute({ definition: { kind: 'APP_ROUTE', page: '/api/releases/route', pathname: '/api/releases', filename: 'route', bundlePath: 'app/api/releases/route' }, userland: userland, resolvedPagePath: path.join(root, 'src/app/api/releases/route.js'), nextConfigOutput: undefined }); }
async function call(m) {
  var ctx = { params: {}, prerenderManifest: { version: 4, routes: {}, dynamicRoutes: {}, notFoundRoutes: [], preview: { previewModeId: 'x', previewModeSigningKey: 'x', previewModeEncryptionKey: 'x' } }, renderOpts: { incrementalCache: fakeCache, supportsDynamicResponse: true, isRevalidate: false, originalPathname: '/api/releases' } };
  var res = await m.handle(new NextRequest('https://hub.test/api/releases', { headers: { authorization: 'Bearer user-token' } }), ctx);
  var body = await res.json(); await new Promise(function (r) { setTimeout(r, 30); }); return body;
}

(async function () {
  // ── 1. the fixed route: every call reads the database again ──
  freshDb(); cacheStore = {}; cacheWrites = 0; cacheHits = 0;
  var route = mk(realRoute);
  check('1: the route says revalidate = 0 and fetchCache = force-no-store', realRoute.revalidate === 0 && realRoute.fetchCache === 'force-no-store' && realRoute.dynamic === 'force-dynamic');
  var a = await call(route);
  DB.release_worker_status[0] = { id: 1, worker: 'ktc-office-release-worker', version: 'v', enabled: true, last_seen: new Date().toISOString() };
  DB.release_signoffs.push({ id: 1, item_id: 'wh-order-queue', scope: 'warehouse', action: 'go', sha: 'ae404ef4f57b2bfe07a9f92fe142817f7917c85d', approval_text: 'Approved', detail: {}, ref_id: null, signed_by_name: 'Max', recorded_by: null, created_at: '2026-11-24T13:12:14Z' });
  var b = await call(route);
  check('2: first answer = what the database said then (worker off, last seen 24 Nov 12:08)', a.ok === true && a.worker && a.worker.enabled === false && a.worker.last_seen === '2026-11-24T12:08:52Z', a.worker || a);
  check('3: second answer = the database NOW (worker on, fresh check-in, 1 history row) — no frozen copy', b.ok === true && b.worker.enabled === true && b.worker.last_seen !== a.worker.last_seen && b.history.length === 1, { w: b.worker, h: (b.history || []).length });
  check('4: nothing at all was written to Next\'s Data Cache, nothing served from it', cacheWrites === 0 && cacheHits === 0, { cacheWrites: cacheWrites, cacheHits: cacheHits });

  // ── 2. the same with the fix taken out: the test must catch the frozen screen ──
  freshDb(); cacheStore = {}; cacheWrites = 0; cacheHits = 0;
  var broken = mk(brokenRoute);
  var c = await call(broken);
  DB.release_worker_status[0] = { id: 1, worker: 'ktc-office-release-worker', version: 'v', enabled: true, last_seen: new Date().toISOString() };
  var d = await call(broken);
  check('5 (contrast): WITHOUT the fix the second answer is the frozen first one — exactly what Max saw', c.worker.enabled === false && d.worker.enabled === false && d.worker.last_seen === '2026-11-24T12:08:52Z' && cacheWrites > 0 && cacheHits > 0, { d: d.worker, cacheWrites: cacheWrites, cacheHits: cacheHits });

  // ── 3. every release route carries the fix; the shared client sends no-store ──
  var files = fs.readdirSync(path.join(root, 'src/app/api/releases'), { withFileTypes: true }).filter(function (d) { return d.isDirectory() && fs.existsSync(path.join(root, 'src/app/api/releases', d.name, 'route.js')); }).map(function (d) { return d.name + '/route.js'; }).concat(['route.js']);
  var missing = files.filter(function (f) { var s = read('src/app/api/releases/' + f); return !/export const revalidate = 0;/.test(s) || !/export const fetchCache = 'force-no-store';/.test(s) || !/releaseDb\(\)/.test(s) || /createClient\(process\.env/.test(s); });
  check('6 (source): every release route (' + files.length + '): revalidate 0 + force-no-store + the no-store client, no other database client', missing.length === 0, missing);
  var seen = null; var saved = global.fetch; global.fetch = function (u, init) { seen = init; return Promise.resolve(new Response('[]')); };
  await require(path.join(root, 'src/lib/release-db.js')).noStoreFetch('https://x.test/', { method: 'GET', headers: { a: 'b' } });
  global.fetch = saved;
  check('7: the release client\'s fetch always asks for cache: no-store (and keeps the method / headers)', seen && seen.cache === 'no-store' && seen.method === 'GET' && seen.headers.a === 'b', seen);

  // ── 4. the 4 real rows of 25 Nov: both moves are on production, both can be rolled back ──
  freshDb();
  DB.release_worker_status[0] = { id: 1, worker: 'ktc-office-release-worker', version: 'v', enabled: true, last_seen: new Date().toISOString() };
  var B1 = '/home/nextueoa/code-backups/request-1-20261124132103'; var B3 = '/home/nextueoa/code-backups/request-3-20261125072858';
  DB.release_signoffs = [
    { id: 1, item_id: 'wh-order-queue', scope: 'warehouse', action: 'go', sha: 'ae404ef4f57b2bfe07a9f92fe142817f7917c85d', approval_text: 'Approved: put wh-order-queue on production @ ae404ef4f57b2bfe07a9f92fe142817f7917c85d', detail: { title: 'Order Queue rebuild', execution: 'warehouse-worker-v1' }, ref_id: null, signed_by_name: 'Max', recorded_by: null, created_at: '2026-11-24T13:12:14.22453+00:00' },
    { id: 2, item_id: 'wh-order-queue', scope: 'warehouse', action: 'moved', sha: 'ae404ef4f57b2bfe07a9f92fe142817f7917c85d', approval_text: null, detail: { note: 'Code fingerprints verified; HTTP 200. Functional verification pending. Both additive Order Queue migrations were verified. Database backup: zz_order_queues_before_1.', title: 'Order Queue rebuild', backup: B1, dependsOn: [] }, ref_id: 1, signed_by_name: null, recorded_by: 'ktc-office-release-worker', created_at: '2026-11-24T13:21:38.432207+00:00' },
    { id: 3, item_id: 'wh-xb-receipts-feed', scope: 'warehouse', action: 'go', sha: '905ef4b81f7c63fd487e4ed372f66c37da9e13ff', approval_text: 'Approved: put wh-xb-receipts-feed on production @ 905ef4b81f7c63fd487e4ed372f66c37da9e13ff', detail: { title: 'Warehouse check: read-only receipts feed for the Hub (XB)', execution: 'warehouse-worker-v1' }, ref_id: null, signed_by_name: 'Max', recorded_by: null, created_at: '2026-11-25T07:28:14.644698+00:00' },
    { id: 4, item_id: 'wh-xb-receipts-feed', scope: 'warehouse', action: 'moved', sha: '905ef4b81f7c63fd487e4ed372f66c37da9e13ff', approval_text: null, detail: { note: 'Code fingerprints verified; HTTP 200. Functional verification pending.', title: 'Warehouse check: read-only receipts feed for the Hub (XB)', backup: B3, dependsOn: [] }, ref_id: 3, signed_by_name: null, recorded_by: 'ktc-office-release-worker', created_at: '2026-11-25T07:29:07.926601+00:00' }
  ];
  DB.release_execution = [{ request_id: 1, phase: 'finished', started_at: '2026-11-24T13:12:58Z', finished_at: '2026-11-24T13:21:38Z' }, { request_id: 3, phase: 'finished', started_at: '2026-11-25T07:28:58Z', finished_at: '2026-11-25T07:29:07Z' }];
  var r = await call(mk(realRoute));
  var so = r.signoffs || {};
  check('8: real rows → wh-order-queue is on production (deployed), can be rolled back, from its own backup', so['wh-order-queue'] && so['wh-order-queue'].where === 'deployed' && so['wh-order-queue'].canRollback === true && so['wh-order-queue'].liveBackup === B1, so['wh-order-queue']);
  check('9: real rows → wh-xb-receipts-feed is on production (deployed), can be rolled back, from its own backup', so['wh-xb-receipts-feed'] && so['wh-xb-receipts-feed'].where === 'deployed' && so['wh-xb-receipts-feed'].canRollback === true && so['wh-xb-receipts-feed'].liveBackup === B3, so['wh-xb-receipts-feed']);
  check('10: real rows → the change history lists all 4 rows (not 0)', r.historyComplete === true && r.history.filter(function (h) { return h.row; }).length === 4, (r.history || []).length);
  // the screen's own lists (the same functions the screen uses)
  Module._load = function (request) { if (/lib\/supabase$/.test(request)) { return { supabase: { auth: { getSession: function () { return Promise.resolve({ data: { session: null } }); } } } }; } return stubCaller.apply(this, arguments); };
  var Tab = require(path.join(root, 'src/components/ChangeScheduleTab.jsx'));
  Module._load = realLoad;
  var lists = Tab.scheduleLists(r);
  var liveIds = lists.live.map(function (it) { return it.id; });
  check('11: the screen\'s "Already on production" list shows BOTH moves (Order Queue + XB receipts), not one', liveIds.indexOf('wh-order-queue') >= 0 && liveIds.indexOf('wh-xb-receipts-feed') >= 0, liveIds);
  check('12: …and both of them offer a roll back', lists.rollbackItems.map(function (it) { return it.id; }).filter(function (id) { return id === 'wh-order-queue' || id === 'wh-xb-receipts-feed'; }).length === 2, lists.rollbackItems.map(function (it) { return it.id; }));
  check('13: neither is still in the "waiting" list', lists.queued.every(function (it) { return it.id !== 'wh-order-queue' && it.id !== 'wh-xb-receipts-feed'; }));

    var page = read('src/app/page.jsx'); var wn = read('src/components/WhatsNewWidget.jsx');
  // v55.83-YX: a later build moves the badge on — the badge names the newest entry, and the YW entry is still there
  check('14: What\'s New has the YW entry and the badge names the newest entry (YW or a later build)', /version: 'v55\.83-YW'/.test(wn) && (function () { var t = /BUILD_HISTORY = \[\s*\{\s*version: '(v55\.83-[A-Z]+)'/.exec(wn); return !!t && page.indexOf('>' + t[1] + '</span>') > 0; })());
  check('15: the test is in the regression runner', read('scripts/run-accounting-bank-regression.js').indexOf('test-v55-83-yw-release-freshness.js') >= 0);
  console.log('\nYW freshness: ' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('CRASHED: ' + (e && e.stack || e)); process.exit(1); });
