// ═══════════════════════════════════════════════════════════════════════════
// v55.83-UU — Orders report reads the LIVE warehouse (Max 19 Nov "yes production"; Codex QA 05:38):
//  1. fields the warehouse copy says it does NOT have → "untracked": never done, never ready to close
//  2. closing from the Hub is refused on the server for the live copy (Close now AND the overnight review), unless separately allowed
//  3. decisions recorded against the other copy are counted on the report (kept, nothing moved)
// Runs the REAL lifecycle rules and the REAL POST/GET handlers (in-memory DB, stand-in feed, no network, no mail).
// Run: node __tests__/test-v55-83-uu-orders-live-feed.js
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var FakeDb = require('./fake-supabase.js').FakeDb;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 700))); }
function item(ev, key) { return ev.items.filter(function (i) { return i.key === key; })[0]; }

console.log('UU — rules for a warehouse copy without the stage-rule fields');
var L = require(path.join(root, 'src/lib/order-lifecycle.js'));
var NOW = L.nyLocalToUtcMs('2026-11-19 12:00:00');
var UN = { shipping_doc_type: true, order_payment_type: true, load_time_known: true };
var endRows = { preload: { deposit_received: 'yes', deposit_amount: '1' }, shipping_in_process: {}, end_stage: { bl_received: 'yes', final_document_to_bank: '' } };
var o = { id: 7, release_number: '1002-1777', customer_name: 'Example A', country: 'Ghana', status: 'end_stage', shipped_date: '2026-11-10 10:00:00' };
var evU = L.evaluateOrder({ order: o, rows: endRows, untracked: UN }, NOW);
var evS = L.evaluateOrder({ order: o, rows: endRows }, NOW);
check('document type / payment type → "untracked" with the reason, not "missing"', item(evU, 'shipping_doc_type').status === 'untracked' && item(evU, 'order_payment_type').status === 'untracked' && /not tracked on this warehouse copy/.test(item(evU, 'shipping_doc_type').why), [item(evU, 'shipping_doc_type'), item(evU, 'order_payment_type')]);
check('… not in the red outstanding list', !evU.outstanding.some(function (i) { return i.key === 'shipping_doc_type' || i.key === 'order_payment_type'; }));
check('… but NEVER complete: the order is not ready to close, and they are named as the reason', evU.closure.eligible === false && evU.closure.missing.some(function (m) { return /Shipping document type/.test(m); }) && evU.closure.missing.some(function (m) { return /payment type/.test(m); }), evU.closure);
check('… and readiness is never "Ready to close"', evU.readiness.words !== 'Ready to close');
check('BL Received stays REQUIRED and is judged on its own value (yes → done)', item(evU, 'bl_received').applies && item(evU, 'bl_received').status === 'done' && /required \(the document type is not tracked/.test(item(evU, 'bl_received').why), item(evU, 'bl_received'));
check('Final Documents to bank stays REQUIRED; blank → missing', item(evU, 'final_document_to_bank').applies && item(evU, 'final_document_to_bank').status === 'missing', item(evU, 'final_document_to_bank'));
check('the staging copy (fields present) is unchanged: blank document type → missing', item(evS, 'shipping_doc_type').status === 'missing' && item(evS, 'order_payment_type').status === 'missing' && item(evS, 'bl_received').status === 'missing');
var pre = { id: 8, release_number: '1002-1778', customer_name: 'B', country: 'Ghana', status: 'preload' };
var dMid = L.deadlineState(pre, { load_date: '2026-11-20 00:00:00' }, [], NOW, UN);
var dTime = L.deadlineState(pre, { load_date: '2026-11-20 09:00:00' }, [], NOW, UN);
var dOld = L.deadlineState(pre, { load_date: '2026-11-20 00:00:00' }, [], NOW, {});
check('no load_time_known on the copy: a load date without a time → no 30-hour deadline (never a made-up midnight alert)', dMid.state === 'no_schedule' && /no time on this warehouse copy/.test(dMid.words), dMid);
check('… a load date WITH a time → the 30-hour rule runs', dTime.state !== 'no_schedule' && dTime.deadline_ms > 0, dTime);
check('… the staging behaviour is unchanged when the copy has the field', dOld.state !== 'no_schedule' || /confirmed time/.test(dOld.words || ''), dOld);

console.log('UU — the real handler');
var state = { perms: { 'accounting.view': true, 'orders.monitor': true, 'orders.manage': true }, db: null, feed: null, calls: [] };
function stub(rel, exportsObj) { var p = require.resolve(path.join(root, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj }; }
stub('src/lib/verified-caller.js', { verifiedCaller: function () { return Promise.resolve({ userId: 'u1' }); } });
stub('src/lib/server-permissions.js', {
  assertPermission: function (db, uid, perm) { return Promise.resolve(state.perms[perm] ? { ok: true, ctx: { isSuperAdmin: state.super !== false } } : { ok: false, status: 403 }); },
  loadUserPermissions: function () { return Promise.resolve({ isSuperAdmin: true, mp: state.perms }); },
  userHasPermission: function (ctx, perm) { return !!(ctx && ctx.mp && ctx.mp[perm]); },
});
stub('src/lib/audit-server.js', { audit: function () { return Promise.resolve(); } });
stub('src/lib/notify-server.js', { sendAlertEmail: function () { throw new Error('no mail in tests'); } });
var supa = require.resolve('@supabase/supabase-js', { paths: [root] });
require.cache[supa] = { id: supa, filename: supa, loaded: true, exports: { createClient: function () { return state.db; } } };
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test'; process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test'; process.env.CRON_SECRET = 'cron-secret-for-tests';
var nodeFetch = global.fetch; // the real Node fetch, kept for the redirect check
global.fetch = function (url, opt) {
  state.calls.push({ url: String(url), method: (opt && opt.method) || 'GET', redirect: opt && opt.redirect });
  if (/close-order/.test(String(url))) { return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ ok: true }); } }); }
  var host = new URL(url).host; var src = /nextrade-staging\.com$/.test(host) ? 'nextrade-staging' : 'nextrade-live';
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(Object.assign({ ok: true, source: src, site: host }, state.feed)); } });
};
var R = require(path.join(root, 'src/app/api/accounting/order-monitor/route.js'));
function post(body) { return R.POST(new Request('http://x/api/accounting/order-monitor', { method: 'POST', body: JSON.stringify(Object.assign({ user_id: 'u1' }, body)), headers: { 'content-type': 'application/json' } })).then(function (r) { return r.json().then(function (j) { j._status = r.status; return j; }); }); }
function nightly() { return R.GET(new Request('http://x/api/accounting/order-monitor?job=nightly', { headers: { authorization: 'Bearer cron-secret-for-tests' } })).then(function (r) { return r.json(); }); }
function seed() {
  var db = new FakeDb({});
  var orig = db.from;
  db.from = function (t) { var q = orig(t); q.single = function () { q._one = true; q.one = true; return q; }; q.maybeSingle = function () { q._one = true; q.one = true; return q; }; /* fake-supabase since UM uses .one; Supabase answers null when no row matched */
    if (t === 'order_deposit_links' && state.failOtherLinks) { var neq0 = q.neq; q.neq = function (k, v) { q._failMe = (k === 'source'); return neq0.call(q, k, v); }; }
    var ex = q.exec; q.exec = function () { if (q._failMe) { return { error: { message: 'connection reset (test)' }, data: null }; } var out = ex.call(q); if (q._one && out && Array.isArray(out.data)) { out.data = out.data[0] || null; } return out; }; return q; };
  db.t.users = [{ id: 'u1', name: 'Max', email: 'max@example.test' }];
  db.t.order_monitor_settings = [{ key: 'auto_close_enabled', value: true }];
  db.t.order_report_archive = [];
  // decisions recorded against the STAGING copy (must be kept and counted, not used, when reading live)
  db.t.order_deposit_status = [{ source: 'nextrade-staging', order_id: 7, status: 'not_required', note: 'paid in advance' }];
  db.t.order_deposit_links = [{ id: 'l1', source: 'nextrade-staging', order_id: 7, bank_transaction_id: 'b1', amount: 1250.5, voided: false }, { id: 'l2', source: 'nextrade-staging', order_id: 8, bank_transaction_id: 'b2', amount: 99, voided: true }];
  db.t.order_monitor_overrides = [{ id: 'ov1', source: 'nextrade-staging', order_id: 7, kind: 'force_close', reason: 'checked by hand', active: true }];
  return db;
}
var LIVE_COLS = ['id', 'order_id', 'order_status', 'freight_forwarder', 'bl_received', 'load_date', 'created_at', 'updated_at'];
// an order that is otherwise READY to close on the staging copy (force_close override there) — the shape the nightly would close
state.feed = { orders: [{ id: 7, release_number: '1002-1777', customer_name: 'Example A', country: 'Ghana', status: 'end_stage', shipped_date: '2026-11-10 10:00:00', updated_at: '2026-11-10 10:00:00' }],
  requirements: [{ id: 1, order_id: 7, order_status: 'end_stage', bl_received: 'yes', updated_at: '2026-11-10 10:00:00' }], status_history: [], obsolete_orders: [], capabilities: { requirement_columns: LIVE_COLS, status_history_note: false } };

(async function () {
  // LIVE copy, close token set, but no separate allowance → refused before anything is recorded or sent
  process.env.NEXTRADE_FEED_URL = 'https://nextradeindustries.com/api/hub-feed/shipping'; process.env.NEXTRADE_FEED_TOKEN = 'feed-token'; process.env.NEXTRADE_FEED_ALLOW_LIVE = 'yes'; process.env.NEXTRADE_CLOSE_TOKEN = 'close-token-x'; delete process.env.NEXTRADE_CLOSE_ALLOW_LIVE;
  state.db = seed(); state.calls = [];
  var rep = await post({ action: 'report' });
  check('report reads the live copy and lists the fields it does not track', rep.ok && rep.source === 'nextrade-live' && ['shipping_doc_type', 'order_payment_type', 'load_time_known'].every(function (f) { return rep.untracked_fields.indexOf(f) >= 0; }), [rep.error, rep.untracked_fields]);
  check('… says closing is off for the live copy', rep.closing_allowed === false && /LIVE warehouse/.test(rep.closing_blocked_why || ''), rep.closing_blocked_why);
  check('… counts what was decided on the staging copy (kept, not used): 1 deposit decision, 1 active link $1,250.50, 1 override', rep.other_copy && rep.other_copy.deposit_status === 1 && rep.other_copy.deposit_links === 1 && rep.other_copy.deposit_links_amount === 1250.5 && rep.other_copy.overrides === 1, rep.other_copy);
  check('… the staging override does NOT act on the live order (no force-close carried over)', rep.rows.length === 1 && rep.rows[0].closable === false, rep.rows[0] && rep.rows[0].closable);
  var rC = await post({ action: 'close_order', order_id: 7, reason: 'trying to close on live', request_id: 'req-close-1' });
  check('Close now on the live copy → refused on the server', rC._status === 502 && /switched off for the LIVE warehouse/.test(rC.error || ''), rC);
  check('… nothing was sent to the warehouse and no closure row was recorded', !state.calls.some(function (c) { return /close-order/.test(c.url); }) && !(state.db.t.order_closures || []).length, [state.calls, state.db.t.order_closures]);
  var rO = await post({ action: 'order', order_id: 7 });
  check('the order report says closing is off (the screen hides Close now)', rO.ok && rO.closing_allowed === false, [rO.error, rO.closing_allowed]);
  // overnight review on the live copy: auto-close switched ON in settings, a force-close override ON THE LIVE COPY → still never closes
  state.db.t.order_monitor_overrides.push({ id: 'ov2', source: 'nextrade-live', order_id: 7, kind: 'force_close', reason: 'Max said close', active: true, set_by: 'u1', set_at: '2026-11-19T00:00:00Z' });
  state.calls = [];
  var n = await nightly();
  check('overnight review on the live copy: automatic closing stays off even when switched on, and says why', n.ok && n.summary && n.summary.auto_close_enabled === false && /LIVE warehouse/.test(n.summary.closing_blocked || '') && n.summary.closed.length === 0, n.summary || n);
  check('… no close request was sent', !state.calls.some(function (c) { return /close-order/.test(c.url); }), state.calls);
  // unknown copy name (feed host is neither) is still "live" by host rule, without ALLOW_LIVE it is refused outright
  process.env.NEXTRADE_FEED_ALLOW_LIVE = 'no';
  var rX = await post({ action: 'report' });
  check('a live address without NEXTRADE_FEED_ALLOW_LIVE=yes is refused (fails closed)', rX.ok === false && /LIVE warehouse/.test(rX.error || ''), rX);
  process.env.NEXTRADE_FEED_ALLOW_LIVE = 'yes';
  // Max separately allows closing on live → the guard lets it through to the existing checks
  process.env.NEXTRADE_CLOSE_ALLOW_LIVE = 'yes'; state.db = seed(); state.calls = [];
  var rC2 = await post({ action: 'close_order', order_id: 7, reason: 'allowed now', request_id: 'req-close-2' });
  check('with NEXTRADE_CLOSE_ALLOW_LIVE=yes the close goes through the existing guarded path', rC2.ok === true && state.calls.some(function (c) { return /close-order/.test(c.url); }), rC2);
  delete process.env.NEXTRADE_CLOSE_ALLOW_LIVE;
  // STAGING copy: unchanged behaviour (closing allowed; fields present when the copy says so)
  process.env.NEXTRADE_FEED_URL = 'https://fix.nextrade-staging.com/api/hub-feed/shipping'; state.db = seed(); state.calls = [];
  state.feed.capabilities = { requirement_columns: LIVE_COLS.concat(['shipping_doc_type', 'order_payment_type', 'load_time_known']), status_history_note: true };
  var rS = await post({ action: 'report' });
  check('staging copy: closing allowed, no untracked fields, staging decisions are its own (not "other copy")', rS.ok && rS.closing_allowed === true && rS.untracked_fields.length === 0 && rS.other_copy && rS.other_copy.deposit_status === 0 && rS.other_copy.deposit_links === 0, [rS.error, rS.closing_allowed, rS.untracked_fields, rS.other_copy]);
  delete state.feed.capabilities;
  var rS2 = await post({ action: 'report' });
  check('a copy that says nothing about its fields → every field treated as present (strict: blanks show as missing)', rS2.ok && rS2.untracked_fields.length === 0, rS2.untracked_fields);

  console.log('UU — Codex 05:56: other-copy summary (private money, completeness, errors)');
  process.env.NEXTRADE_FEED_URL = 'https://nextradeindustries.com/api/hub-feed/shipping';
  state.feed.capabilities = { requirement_columns: LIVE_COLS, status_history_note: false };
  state.db = seed(); state.super = false; state.perms = { 'accounting.view': true, 'orders.monitor': true };
  var rN = await post({ action: 'report' });
  check('a person who is NOT super admin (only Accounting + Orders: Monitor) gets NO other-copy summary — no amount, no counts', rN.ok && rN.other_copy === null && JSON.stringify(rN).indexOf('1250.5') < 0, [rN.error, rN.other_copy]);
  state.super = true; state.perms = { 'accounting.view': true, 'orders.monitor': true, 'orders.manage': true };
  state.db = seed(); for (var i = 0; i < 2300; i++) { state.db.t.order_deposit_links.push({ id: 'many' + i, source: 'nextrade-staging', order_id: 1000 + i, bank_transaction_id: 'bx' + i, amount: 1, voided: false }); }
  var rM = await post({ action: 'report' });
  check('more than 1,000 rows: every one is counted (2,301 links, $3,550.50), not cut at 1,000', rM.ok && rM.other_copy && rM.other_copy.deposit_links === 2301 && rM.other_copy.deposit_links_amount === 3550.5, rM.other_copy);
  state.db = seed(); state.failOtherLinks = true;
  var rE = await post({ action: 'report' });
  state.failOtherLinks = false;
  check('a read error on the other-copy links → "could not be checked", never a false 0 (the report still works)', rE.ok && rE.other_copy && rE.other_copy.unavailable.indexOf('deposit_links') >= 0 && rE.other_copy.deposit_links === null && rE.other_copy.deposit_links_amount === null, [rE.error, rE.other_copy]);
  state.db = seed(); state.db.fail = { order_report_archive: { select: 'relation "public.order_report_archive" does not exist' } };
  var rA = await post({ action: 'report' });
  check('archive SQL not run yet → said as "not installed", not as an error and not as zero', rA.ok && rA.other_copy && rA.other_copy.archive_not_installed === true && rA.other_copy.archived === null && rA.other_copy.unavailable.indexOf('archived') < 0, [rA.error, rA.other_copy]);
  state.db.fail = {};

  console.log('UU — Codex 05:56: only approved warehouse addresses, and the feed must name its copy');
  var W = require(path.join(root, 'src/lib/warehouse-feed-config.js'));
  function cfgFor(url, allow) { return W.warehouseFeedConfig({ NEXTRADE_FEED_URL: url, NEXTRADE_FEED_TOKEN: 't', NEXTRADE_FEED_ALLOW_LIVE: allow || '' }); }
  check('fix.nextrade-staging.com → staging; nextradeindustries.com / www. → live (with the go-ahead)', cfgFor('https://fix.nextrade-staging.com/api/hub-feed/shipping').source === 'nextrade-staging' && cfgFor('https://nextradeindustries.com/api/hub-feed/shipping', 'yes').source === 'nextrade-live' && cfgFor('https://www.nextradeindustries.com/api/hub-feed/shipping', 'yes').source === 'nextrade-live');
  check('an unapproved address is refused (never classed as live), even with the live go-ahead', /not an approved warehouse address/.test(cfgFor('https://unrecognized.example.invalid/api/hub-feed/shipping', 'yes').error || ''));
  check('"evilnextrade-staging.com" (no dot boundary) is refused', /not an approved/.test(cfgFor('https://evilnextrade-staging.com/api/hub-feed/shipping', 'yes').error || ''));
  check('"nextradeindustries.com.evil.test" is refused', /not an approved/.test(cfgFor('https://nextradeindustries.com.evil.test/x', 'yes').error || ''));
  check('plain http is refused (the token is never sent unencrypted)', /https/.test(cfgFor('http://fix.nextrade-staging.com/api/hub-feed/shipping').error || ''));
  check('a named port is refused', /port/.test(cfgFor('https://fix.nextrade-staging.com:8443/api/hub-feed/shipping').error || ''));
  check('live without NEXTRADE_FEED_ALLOW_LIVE=yes is refused', /go-ahead/.test(cfgFor('https://nextradeindustries.com/api/hub-feed/shipping', 'no').error || ''));
  check('feed identity: missing / blank / wrong copy → refused; right copy → fine', /did not say/.test(W.feedIdentityProblem({}, { source: 'nextrade-live' })) && /did not say/.test(W.feedIdentityProblem({ source: '  ' }, { source: 'nextrade-live' })) && /expected nextrade-live/.test(W.feedIdentityProblem({ source: 'nextrade-staging' }, { source: 'nextrade-live' })) && W.feedIdentityProblem({ source: 'nextrade-live' }, { source: 'nextrade-live' }) === null);
  // through the REAL handler: an unapproved host sends nothing; a feed without its copy name is refused
  process.env.NEXTRADE_FEED_URL = 'https://unrecognized.example.invalid/api/hub-feed/shipping'; state.calls = []; state.db = seed();
  var rH = await post({ action: 'report' });
  check('handler: unapproved address → refused and NO request was sent (the token never left the Hub)', rH.ok === false && /not an approved/.test(rH.error || '') && state.calls.length === 0, [rH, state.calls]);
  process.env.NEXTRADE_FEED_URL = 'https://nextradeindustries.com/api/hub-feed/shipping';
  var realFetch = global.fetch; global.fetch = function (url, opt) { return realFetch(url, opt).then(function (r) { var j0 = r.json; return Object.assign({}, r, { json: function () { return j0().then(function (j) { delete j.source; return j; }); } }); }); };
  var rI = await post({ action: 'report' });
  global.fetch = realFetch;
  check('handler: a feed answer that does not name its copy → refused', rI.ok === false && /did not say which copy/.test(rI.error || ''), rI);

  console.log('UU — Codex 06:13: built-in object names are not hosts; redirects never carry the token');
  var oddNames = ['constructor', '__proto__', 'hasOwnProperty', 'toString', 'valueOf'];
  check('"constructor", "__proto__", "hasOwnProperty", "toString", "valueOf" are refused as hosts (even with the live go-ahead)', oddNames.every(function (h) { var c = cfgFor('https://' + h + '/api/hub-feed/shipping', 'yes'); return !c.source && /not an approved/.test(c.error || ''); }), oddNames.map(function (h) { return cfgFor('https://' + h + '/api/hub-feed/shipping', 'yes'); }));
  process.env.NEXTRADE_FEED_URL = 'https://constructor/api/hub-feed/shipping'; state.calls = []; state.db = seed();
  var rP1 = await post({ action: 'report' });
  process.env.NEXTRADE_FEED_URL = 'https://__proto__/api/hub-feed/shipping';
  var rP2 = await post({ action: 'report' });
  check('handler: https://constructor/… and https://__proto__/… → refused, ZERO requests sent', rP1.ok === false && rP2.ok === false && /not an approved/.test(rP1.error || '') && /not an approved/.test(rP2.error || '') && state.calls.length === 0, [rP1.error, rP2.error, state.calls]);
  process.env.NEXTRADE_FEED_URL = 'https://nextradeindustries.com/api/hub-feed/shipping'; state.calls = []; state.db = seed();
  await post({ action: 'report' });
  check('handler: the feed read asks fetch to REFUSE redirects (redirect: "error")', state.calls.length > 0 && state.calls.every(function (c) { return c.redirect === 'error'; }), state.calls);
  process.env.NEXTRADE_FEED_URL = 'https://fix.nextrade-staging.com/api/hub-feed/shipping'; state.calls = []; state.db = seed();
  await post({ action: 'close_order', order_id: 7, reason: 'staging close test', request_id: 'req-close-redir' });
  var closeCall = state.calls.filter(function (c) { return /close-order/.test(c.url); })[0];
  check('handler: the close request (staging) also refuses redirects', closeCall && closeCall.redirect === 'error', state.calls);
  var fsT = require('fs');
  var WS = fsT.readFileSync(path.join(root, 'src/app/api/accounting/warehouse-shipping/route.js'), 'utf8');
  check('shipping-cost sync: its feed read also refuses redirects', /'X-Hub-Feed-Token': cfg\.token, 'Accept': 'application\/json' \}, signal: ctl\.signal, cache: 'no-store', redirect: 'error' \}/.test(WS));
  // what redirect: 'error' really does in THIS Node: a 302 is refused and the target never sees the token
  var http = require('http'); var targetHits = [];
  var target = http.createServer(function (q, s) { targetHits.push(q.headers['x-hub-feed-token'] || null); s.end('{}'); });
  await new Promise(function (r) { target.listen(0, '127.0.0.1', r); });
  var origin = http.createServer(function (q, s) { s.writeHead(302, { Location: 'http://127.0.0.1:' + target.address().port + '/steal' }); s.end(); });
  await new Promise(function (r) { origin.listen(0, '127.0.0.1', r); });
  var redirErr = null; try { await nodeFetch('http://127.0.0.1:' + origin.address().port + '/feed', { headers: { 'X-Hub-Feed-Token': 'secret-test-token' }, redirect: 'error' }); } catch (eR) { redirErr = eR; }
  origin.close(); target.close();
  check('real fetch with redirect: "error" refuses a 302 and the redirect target receives nothing', !!redirErr && targetHits.length === 0, [String(redirErr), targetHits]);

  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('CRASH', e && e.stack); process.exit(1); });
