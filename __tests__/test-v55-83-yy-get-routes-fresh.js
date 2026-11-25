// v55.83-YY — follows YW (Change Schedule froze at 24 Nov 12:08 UTC). Next.js 14.2 keeps the answers of GET fetches made inside a
// route that exports ONLY `GET` in its Data Cache with no expiry (store.revalidate = userland.revalidate ?? false), even with
// dynamic = 'force-dynamic'; supabase-js select() and auth.getUser() are GET fetches. YW fixed /api/releases/*; YY fixes every other
// GET-only API route (timers, the warehouse's product-cost feed, WhatsApp, phone, Wave checks, backups, Gmail, ask/diag).
// This runs REAL route files through Next's REAL AppRouteRouteModule (so Next's real patched fetch decides what is cached), with the
// REAL supabase-js client, against a fake database whose answers change between calls, and a fake Data Cache that records every
// read and write. Three calls must make three fresh database reads; nothing may be written to or served from the Data Cache.
// Contrast runs with the fix taken out reproduce the frozen answers, so the test can tell the difference.
global.AsyncLocalStorage = require('async_hooks').AsyncLocalStorage;
var path = require('path'); var fs = require('fs'); var Module = require('module');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fixture-db.supabase.co'; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.CRON_SECRET = 'cron-secret-for-the-yy-test-0123456789'; process.env.HUB_COST_TOKEN = 'hub-cost-token-for-the-yy-test-0123456789abcdef';
process.env.NEXT_PUBLIC_APP_URL = 'https://hub.test';
require(path.join(root, 'node_modules/sucrase/register'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 700))); }
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
console.log('YY — every GET-only API route reads the database fresh every time (no Next Data Cache)');

// ── a fake database (PostgREST + GoTrue shape) whose answers change between calls ──
var DB, dbGets, otherCalls, validTokens;
function freshDb() { DB = {}; dbGets = 0; otherCalls = []; validTokens = {}; }
function applyFilters(rows, params) {
  var out = rows.slice();
  params.forEach(function (v, k) {
    if (k === 'select' || k === 'order' || k === 'limit' || k === 'offset' || k === 'columns') { return; }
    if (v.indexOf('eq.') === 0) { var x = v.substring(3); out = out.filter(function (r) { return String(r[k]) === x; }); }
    else if (v.indexOf('in.(') === 0) { var list = v.substring(4, v.length - 1).split(',').map(function (s) { return s.replace(/^"|"$/g, ''); }); out = out.filter(function (r) { return list.indexOf(String(r[k])) >= 0; }); }
  });
  var lim = params.get('limit'); if (lim) { out = out.slice(0, Number(lim)); }
  return out;
}
global.fetch = async function (input, init) {
  var url = new URL(typeof input === 'string' ? input : input.url);
  var method = ((init && init.method) || (typeof input !== 'string' && input.method) || 'GET').toUpperCase();
  if (url.hostname !== 'fixture-db.supabase.co') { otherCalls.push(method + ' ' + url.href); return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); }
  if (url.pathname === '/auth/v1/user') {
    dbGets++;
    var h = new Headers((init && init.headers) || {}); var tok = (h.get('authorization') || '').replace(/^Bearer /, '');
    if (validTokens[tok]) { return new Response(JSON.stringify(validTokens[tok]), { status: 200, headers: { 'content-type': 'application/json' } }); }
    return new Response(JSON.stringify({ code: 401, error_code: 'session_not_found', msg: 'Session from session_id claim in JWT does not exist' }), { status: 401, headers: { 'content-type': 'application/json' } });
  }
  if (method !== 'GET' && method !== 'HEAD') { otherCalls.push(method + ' ' + url.pathname); return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }); }
  dbGets++;
  var m = /\/rest\/v1\/([a-z_]+)/.exec(url.pathname); var table = m && m[1];
  var rows = applyFilters(DB[table] || [], url.searchParams);
  return new Response(method === 'HEAD' ? null : JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json', 'content-range': '0-' + Math.max(rows.length - 1, 0) + '/' + rows.length } });
};

// ── a fake Next Data Cache that records every write and every hit ──
var cacheStore, cacheWrites, cacheHits;
function freshCache() { cacheStore = {}; cacheWrites = 0; cacheHits = 0; }
var fakeCache = { fetchCacheKey: async function (url, init) { return 'k:' + url + ':' + ((init && init.method) || 'GET') + ':' + JSON.stringify((init && init.headers) || {}); },
  get: async function (key) { if (cacheStore[key]) { cacheHits++; return { value: cacheStore[key], isStale: false, lastModified: Date.now() }; } return null; },
  set: async function (key, data) { if (data) { cacheWrites++; cacheStore[key] = data; } }, revalidateTag: async function () {}, lock: async function () { return function () {}; } };

var realLoad = Module._load;
var baseLoad = function (request) {
  if (request === 'react') { arguments[0] = path.join(root, 'node_modules/next/dist/compiled/react/index.js'); }
  return realLoad.apply(this, arguments);
};
Module._load = baseLoad;
var AppRoute = require(path.join(root, 'node_modules/next/dist/server/future/route-modules/app-route/module.js')).AppRouteRouteModule;
var NextRequest = require(path.join(root, 'node_modules/next/dist/server/web/spec-extension/request.js')).NextRequest;
var plainSupabase = require('@supabase/supabase-js');

function loadRoute(rel) { return require(path.join(root, 'src/app/api', rel, 'route.js')); }
// the same route with the fix taken out: a plain supabase-js client everywhere and no segment settings
function loadBrokenRoute(rel) {
  var file = path.join(root, 'src/app/api', rel, 'route.js');
  var keep = {}; Object.keys(require.cache).forEach(function (k) { keep[k] = require.cache[k]; });
  Object.keys(require.cache).forEach(function (k) { if (k.indexOf(path.join(root, 'src')) === 0) { delete require.cache[k]; } });
  Module._load = function (request) {
    if (/no-store-db$/.test(request)) { return { createNoStoreClient: plainSupabase.createClient, noStoreFetch: function (i, o) { return fetch(i, o); } }; }
    return baseLoad.apply(this, arguments);
  };
  var mod = Object.assign({}, require(file));
  Module._load = baseLoad;
  Object.keys(require.cache).forEach(function (k) { if (k.indexOf(path.join(root, 'src')) === 0) { delete require.cache[k]; } });
  Object.keys(keep).forEach(function (k) { require.cache[k] = keep[k]; });
  delete mod.revalidate; delete mod.fetchCache;
  return mod;
}
function mk(rel, userland) { return new AppRoute({ definition: { kind: 'APP_ROUTE', page: '/api/' + rel + '/route', pathname: '/api/' + rel, filename: 'route', bundlePath: 'app/api/' + rel + '/route' }, userland: userland, resolvedPagePath: path.join(root, 'src/app/api', rel, 'route.js'), nextConfigOutput: undefined }); }
async function call(m, url, headers) {
  var ctx = { params: {}, prerenderManifest: { version: 4, routes: {}, dynamicRoutes: {}, notFoundRoutes: [], preview: { previewModeId: 'x', previewModeSigningKey: 'x', previewModeEncryptionKey: 'x' } }, renderOpts: { incrementalCache: fakeCache, supportsDynamicResponse: true, isRevalidate: false, originalPathname: new URL(url).pathname } };
  var before = dbGets;
  var res = await m.handle(new NextRequest(url, { headers: headers || {} }), ctx);
  var text = await res.text(); var body = null; try { body = JSON.parse(text); } catch (e) { body = text; }
  await new Promise(function (r) { setTimeout(r, 30); });
  return { status: res.status, body: body, reads: dbGets - before };
}
var CRON = { authorization: 'Bearer ' + process.env.CRON_SECRET };

// every GET-only route file under src/app/api (scanned, so a new one is covered too)
function routeFiles(dir) { var out = []; fs.readdirSync(dir, { withFileTypes: true }).forEach(function (d) { var p = path.join(dir, d.name); if (d.isDirectory()) { out = out.concat(routeFiles(p)); } else if (d.name === 'route.js') { out.push(p); } }); return out; }
var METHOD_RE = /export\s+(?:async\s+)?(?:function|const|var|let)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;
var getOnly = routeFiles(path.join(root, 'src/app/api')).map(function (f) {
  var s = fs.readFileSync(f, 'utf8'); var ms = {}; var mm; METHOD_RE.lastIndex = 0; while ((mm = METHOD_RE.exec(s))) { ms[mm[1]] = true; }
  return { rel: path.relative(path.join(root, 'src/app/api'), path.dirname(f)).split(path.sep).join('/'), src: s, methods: Object.keys(ms) };
}).filter(function (r) { return r.methods.length === 1 && r.methods[0] === 'GET'; });
// /api/releases/* is YW's (its own test, test-v55-83-yw-release-freshness.js). These two make no fetch of any kind.
var NO_FETCH = { 'gmail/connect': 'builds the Google sign-in address only', 'plaid/env': 'returns which Plaid environment is set only' };
var covered = getOnly.filter(function (r) { return r.rel.indexOf('releases') !== 0 && !NO_FETCH[r.rel]; });
var EXPECTED = ['accounting/clickbooks-us/rules-job', 'accounting/clickbooks-us/shadow-job', 'accounting/expense-rules/job', 'ask/diag', 'backup/download', 'backup/list', 'commercial/worker', 'conversation-log', 'gmail/callback', 'gmail/inbox', 'hub-feed/product-costs', 'phone/diagnose', 'phone/recording-stream', 'phone/transcribe-cron', 'wave/audit', 'wave/check', 'wave/import-preview', 'whatsapp/conversations', 'whatsapp/conversations/[id]', 'whatsapp/diagnostic'];

(async function () {
  // ── 1. the list ──
  var names = covered.map(function (r) { return r.rel; });
  check('1: the GET-only routes found = the 20 reported (+ clickbooks-us and ledgerly data / sync, already fresh with revalidate = 0, now on the same rule)', EXPECTED.every(function (n) { return names.indexOf(n) >= 0; }), { missing: EXPECTED.filter(function (n) { return names.indexOf(n) < 0; }) });
  Object.keys(NO_FETCH).forEach(function (n) { var r = getOnly.filter(function (x) { return x.rel === n; })[0]; check('2: ' + n + ' makes no fetch and opens no database (' + NO_FETCH[n] + ')', r && !/fetch\(|createClient|supabase|from '\.\.\//.test(r.src.replace(/^\s*\/\/.*$/mg, '')), r && r.src.substring(0, 300)); });

  // ── 2. every GET-only route: its own settings alone keep reads out of the Data Cache, even a helper's own plain client ──
  var cfgBad = [];
  for (var i = 0; i < covered.length; i++) {
    var rel = covered[i].rel; var real = loadRoute(rel);
    freshDb(); freshCache(); var n = 0; DB.probe = [{ id: 1, v: 0 }];
    var probe = async function () { var c = plainSupabase.createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }); var r = await c.from('probe').select('v').eq('id', 1).maybeSingle(); return Response.json({ v: r.data && r.data.v }); };
    var m = mk(rel, Object.assign({}, real, { GET: probe }));
    var seen = [];
    for (var k = 0; k < 3; k++) { DB.probe[0].v = ++n; var a = await call(m, 'https://hub.test/api/' + rel); seen.push(a.body && a.body.v); }
    if (!(seen[0] === 1 && seen[1] === 2 && seen[2] === 3 && cacheWrites === 0 && cacheHits === 0 && real.revalidate === 0 && real.fetchCache === 'force-no-store')) { cfgBad.push({ rel: rel, seen: seen, cacheWrites: cacheWrites, cacheHits: cacheHits, revalidate: real.revalidate, fetchCache: real.fetchCache }); }
  }
  check('3: all ' + covered.length + ' GET-only routes: revalidate 0 + force-no-store; three calls = three fresh reads (1, 2, 3), nothing written to / served from the Data Cache', cfgBad.length === 0 && covered.length >= 20, cfgBad);
  // contrast: the same probe in a route WITHOUT the settings (how they were) freezes on its first answer
  freshDb(); freshCache(); DB.probe = [{ id: 1, v: 1 }];
  var bare = mk('hub-feed/product-costs', { GET: async function () { var c = plainSupabase.createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY); var r = await c.from('probe').select('v').eq('id', 1).maybeSingle(); return Response.json({ v: r.data && r.data.v }); }, dynamic: 'force-dynamic' });
  var c1 = await call(bare, 'https://hub.test/api/x'); DB.probe[0].v = 2; var c2 = await call(bare, 'https://hub.test/api/x'); DB.probe[0].v = 3; var c3 = await call(bare, 'https://hub.test/api/x');
  check('4 (contrast): WITHOUT the settings (force-dynamic alone, as before) answers 1, 1, 1 from the Data Cache — the frozen-screen fault', c1.body.v === 1 && c2.body.v === 1 && c3.body.v === 1 && cacheWrites > 0 && cacheHits >= 2, { v: [c1.body.v, c2.body.v, c3.body.v], cacheWrites: cacheWrites, cacheHits: cacheHits });
  // the no-store client alone is also enough (belt and braces)
  freshDb(); freshCache(); DB.probe = [{ id: 1, v: 1 }];
  var nsc = require(path.join(root, 'src/lib/no-store-db.js'));
  var alone = mk('x', { GET: async function () { var c = nsc.createNoStoreClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false }, global: { headers: { 'x-a': 'b' } } }); var r = await c.from('probe').select('v').eq('id', 1).maybeSingle(); return Response.json({ v: r.data && r.data.v }); } });
  var d1 = await call(alone, 'https://hub.test/api/x'); DB.probe[0].v = 2; var d2 = await call(alone, 'https://hub.test/api/x'); DB.probe[0].v = 3; var d3 = await call(alone, 'https://hub.test/api/x');
  check('5: the shared no-store client alone (no segment settings) also reads 1, 2, 3 and writes nothing to the Data Cache', d1.body.v === 1 && d2.body.v === 2 && d3.body.v === 3 && cacheWrites === 0, { v: [d1.body.v, d2.body.v, d3.body.v], cacheWrites: cacheWrites });
  var seenInit = null; var savedFetch = global.fetch; global.fetch = function (u, init) { seenInit = init; return Promise.resolve(new Response('[]')); };
  await nsc.noStoreFetch('https://x.test/', { method: 'GET', headers: { a: 'b' } });
  global.fetch = savedFetch;
  check('6: noStoreFetch always sends cache: no-store and keeps the method / headers', seenInit && seenInit.cache === 'no-store' && seenInit.method === 'GET' && seenInit.headers.a === 'b', seenInit);

  // ── 3. the worst ones, the REAL handlers end to end ──
  // 3a. the warehouse's product-cost feed (Hub → warehouse average cost per lb)
  freshDb(); freshCache();
  var pc = mk('hub-feed/product-costs', loadRoute('hub-feed/product-costs'));
  var H = { 'x-hub-cost-token': process.env.HUB_COST_TOKEN };
  var p1 = await call(pc, 'https://hub.test/api/hub-feed/product-costs', H); var p2 = await call(pc, 'https://hub.test/api/hub-feed/product-costs', H); var p3 = await call(pc, 'https://hub.test/api/hub-feed/product-costs', H);
  check('7: product-cost feed (real handler): 3 calls → 3 full database reads (' + p1.reads + ' / ' + p2.reads + ' / ' + p3.reads + '), 0 cache writes / hits', p1.status === 200 && p1.body.ok === true && p1.reads > 0 && p2.reads === p1.reads && p3.reads === p1.reads && cacheWrites === 0 && cacheHits === 0, { s: p1.status, b: p1.body, r: [p1.reads, p2.reads, p3.reads], cacheWrites: cacheWrites, cacheHits: cacheHits });
  freshDb(); freshCache();
  var pcB = mk('hub-feed/product-costs', loadBrokenRoute('hub-feed/product-costs'));
  var q1 = await call(pcB, 'https://hub.test/api/hub-feed/product-costs', H); var q2 = await call(pcB, 'https://hub.test/api/hub-feed/product-costs', H);
  check('8 (contrast): the feed as it was: the 2nd call reads NOTHING from the database (' + q1.reads + ' then ' + q2.reads + ') — the warehouse got the first copy for ever', q1.reads > 0 && q2.reads === 0 && cacheHits > 0, { r: [q1.reads, q2.reads], cacheWrites: cacheWrites, cacheHits: cacheHits });

  // 3b. the 15-minute category-rules timer
  freshDb(); freshCache();
  var er = mk('accounting/expense-rules/job', loadRoute('accounting/expense-rules/job'));
  var e1 = await call(er, 'https://hub.test/api/accounting/expense-rules/job', CRON); var e2 = await call(er, 'https://hub.test/api/accounting/expense-rules/job', CRON); var e3 = await call(er, 'https://hub.test/api/accounting/expense-rules/job', CRON);
  check('9: category-rules timer (real handler): 3 runs → 3 fresh reads (' + e1.reads + ' / ' + e2.reads + ' / ' + e3.reads + '), 0 cache writes / hits', e1.status === 200 && e1.reads > 0 && e2.reads === e1.reads && e3.reads === e1.reads && cacheWrites === 0 && cacheHits === 0, { s: e1.status, b: e1.body, r: [e1.reads, e2.reads, e3.reads], cacheWrites: cacheWrites });
  freshDb(); freshCache();
  var erB = mk('accounting/expense-rules/job', loadBrokenRoute('accounting/expense-rules/job'));
  var f1 = await call(erB, 'https://hub.test/api/accounting/expense-rules/job', CRON); var f2 = await call(erB, 'https://hub.test/api/accounting/expense-rules/job', CRON);
  check('10 (contrast): the timer as it was: the 2nd run re-used cached reads (' + f1.reads + ' then ' + f2.reads + ')', f2.reads < f1.reads && cacheHits > 0, { r: [f1.reads, f2.reads], cacheHits: cacheHits });

  // 3c. the WhatsApp list: a new conversation shows at once, and a signed-out session is refused at once
  freshDb(); freshCache();
  validTokens['tok-1'] = { id: 'u1', aud: 'authenticated', role: 'authenticated', email: 'staff@example.test' };
  DB.whatsapp_conversations = [{ id: 'c1', customer_wa_id: '1', display_name: 'First', is_archived: false, unread_count: 0 }];
  var wa = mk('whatsapp/conversations', loadRoute('whatsapp/conversations'));
  var WH = { authorization: 'Bearer tok-1' };
  var w1 = await call(wa, 'https://hub.test/api/whatsapp/conversations', WH);
  DB.whatsapp_conversations.push({ id: 'c2', customer_wa_id: '2', display_name: 'Second', is_archived: false, unread_count: 1 });
  var w2 = await call(wa, 'https://hub.test/api/whatsapp/conversations', WH);
  delete validTokens['tok-1'];
  var w3 = await call(wa, 'https://hub.test/api/whatsapp/conversations', WH);
  check('11: WhatsApp list (real handler): 1 conversation, then the new one shows (2)', w1.status === 200 && w1.body.total === 1 && w2.status === 200 && w2.body.total === 2, { w1: w1.body, w2: w2.body });
  check('12: …and after the session is signed out the sign-in check (auth.getUser, a GET) is asked again: refused 401, nothing cached', w3.status === 401 && cacheWrites === 0 && cacheHits === 0, { s: w3.status, cacheWrites: cacheWrites, cacheHits: cacheHits });
  freshDb(); freshCache();
  validTokens['tok-1'] = { id: 'u1', aud: 'authenticated', role: 'authenticated', email: 'staff@example.test' };
  DB.whatsapp_conversations = [{ id: 'c1', customer_wa_id: '1', display_name: 'First', is_archived: false, unread_count: 0 }];
  // the contrast also needs phone-auth as it was (plain client): loadBrokenRoute swaps no-store-db for the whole src tree
  var waB = mk('whatsapp/conversations', loadBrokenRoute('whatsapp/conversations'));
  var x1 = await call(waB, 'https://hub.test/api/whatsapp/conversations', WH);
  DB.whatsapp_conversations.push({ id: 'c2', customer_wa_id: '2', display_name: 'Second', is_archived: false, unread_count: 1 });
  delete validTokens['tok-1'];
  var x2 = await call(waB, 'https://hub.test/api/whatsapp/conversations', WH);
  check('13 (contrast): as it was: after sign-out the old answer is still served (200, still 1 conversation) — stale list AND a stale sign-in check', x2.status === 200 && x2.body.total === 1, { s: x2.status, b: x2.body });

  // 3d. the transcription timer and the Sourcing desk worker run fresh too
  freshDb(); freshCache();
  var old = new Date(Date.now() - 10 * 60000).toISOString();
  DB.phone_voicemails = []; DB.phone_recordings = [];
  var tc = mk('phone/transcribe-cron', loadRoute('phone/transcribe-cron'));
  var t1 = await call(tc, 'https://hub.test/api/phone/transcribe-cron', CRON);
  DB.phone_voicemails.push({ id: 'vm1', recording_url: 'https://rec.test/1', transcript_status: 'pending', created_at: old });
  var t2 = await call(tc, 'https://hub.test/api/phone/transcribe-cron', CRON);
  var t3 = await call(tc, 'https://hub.test/api/phone/transcribe-cron', CRON);
  check('14: transcription timer (real handler): a new voicemail is picked up on the next run; 3 runs = 3 fresh reads, 0 cache writes', t1.body.ok === true && t1.body.results.voicemails === 0 && t2.body.results.voicemails === 1 && t3.reads === t1.reads && cacheWrites === 0 && cacheHits === 0, { t1: t1.body, t2: t2.body, cacheWrites: cacheWrites });
  freshDb(); freshCache();
  var cw = mk('commercial/worker', loadRoute('commercial/worker'));
  var k1 = await call(cw, 'https://hub.test/api/commercial/worker', CRON); var k2 = await call(cw, 'https://hub.test/api/commercial/worker', CRON); var k3 = await call(cw, 'https://hub.test/api/commercial/worker', CRON);
  check('15: Sourcing desk worker (real handler): 3 runs → the same number of fresh reads each (' + k1.reads + ' / ' + k2.reads + ' / ' + k3.reads + '), 0 cache writes / hits', k1.status === 200 && k1.reads > 0 && k2.reads === k1.reads && k3.reads === k1.reads && cacheWrites === 0 && cacheHits === 0, { s: k1.status, b: k1.body, r: [k1.reads, k2.reads, k3.reads] });

  // ── 4. source guards ──
  var dup = [];
  covered.concat(getOnly.filter(function (r) { return r.rel.indexOf('releases') !== 0 && NO_FETCH[r.rel]; })).forEach(function (r) { ['dynamic', 'revalidate', 'fetchCache', 'runtime', 'maxDuration'].forEach(function (key) { var n2 = (r.src.match(new RegExp('^export\\s+(const|var|let)\\s+' + key + '\\b', 'mg')) || []).length; if (n2 > 1) { dup.push(r.rel + ':' + key); } }); });
  check('16 (source): no route exports the same setting twice (a duplicate export breaks the build)', dup.length === 0, dup);
  var plain = covered.filter(function (r) { return /from '@supabase\/supabase-js'|import\('@supabase\/supabase-js'\)/.test(r.src); }).map(function (r) { return r.rel; });
  check('17 (source): none of these routes opens a plain supabase-js client; all use src/lib/no-store-db', plain.length === 0, plain);
  var pa = read('src/lib/phone-auth.js');
  check('18 (source): phone-auth (sign-in check used by WhatsApp / phone / conversation-log) uses the no-store client', /import \{ createNoStoreClient as createClient \} from '\.\/no-store-db'/.test(pa) && !/@supabase\/supabase-js/.test(pa));
  var page = read('src/app/page.jsx'); var wn = read('src/components/WhatsNewWidget.jsx');
  check('19: the badge says YY and What\'s New has a YY entry', /v55\.83-YY<\/span>/.test(page) && /version: 'v55\.83-YY'/.test(wn));
  var parseErr = null;
  try { require('sucrase').transform(wn, { transforms: ['jsx', 'imports'] }); new Function(read('scripts/run-accounting-bank-regression.js').replace(/^#!.*\n/, '').replace(/^\s*(import|export)\b.*$/mg, '')); } catch (eP) { parseErr = eP.message; }
  check('19b: What\'s New and the runner still parse (a stray quote in a note breaks the build)', parseErr === null, parseErr);
  check('20: the test is in the regression runner', read('scripts/run-accounting-bank-regression.js').indexOf('test-v55-83-yy-get-routes-fresh.js') >= 0);
  console.log('\nYY GET routes fresh: ' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('CRASHED: ' + (e && e.stack || e)); process.exit(1); });
