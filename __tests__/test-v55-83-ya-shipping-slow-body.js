// ═══════════════════════════════════════════════════════════════════════════
// v55.83-YA rev2 (Codex QA 23 Nov 22:15) — the shipping-cost sync's 40-second limit covers the WHOLE read (headers + body).
// Runs the REAL warehouse-shipping GET handler (the automatic run) on an in-memory DB with a stand-in feed (no network):
//  • headers arrive at once, the body is still arriving after the deadline → the time limit aborts the read;
//  • failRun records it (finished_at set, ok false, the plain "still arriving … cut off" message), nothing is published;
//  • the next sync is NOT blocked by an unfinished run, and the data already in the Hub is unchanged;
//  • the timer is cleared on every path (success, non-200, thrown fetch) and is never cleared before the body is read.
// The deadline stays 40000 ms in the route; the test only makes the 40000 ms timer fire sooner (fake setTimeout).
// Run: node __tests__/test-v55-83-ya-shipping-slow-body.js
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path');
var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var FakeDb = require('./fake-supabase.js').FakeDb;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 900))); }

// ── stand-ins for the route's server imports (no Supabase, no audit, no sign-in) ──
var state = { db: null, mode: 'slow', events: [], published: 0, fetches: 0 };
function stub(rel, exportsObj) { var p = require.resolve(path.join(root, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj }; }
stub('src/lib/server-permissions.js', { assertPermission: function () { return Promise.resolve({ ok: true }); } });
stub('src/lib/bank-visibility.js', { authorizeBankIdentity: function () { return Promise.resolve({ profileId: 'u1' }); } });
stub('src/lib/audit-server.js', { audit: function () { return Promise.resolve(); } });
var supa = require.resolve('@supabase/supabase-js', { paths: [root] });
require.cache[supa] = { id: supa, filename: supa, loaded: true, exports: { createClient: function () { return state.db; } } };
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test'; process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test'; process.env.CRON_SECRET = 'cron-secret-for-tests';
process.env.NEXTRADE_FEED_URL = 'https://fix.nextrade-staging.com/api/hub-feed/shipping'; process.env.NEXTRADE_FEED_TOKEN = 'TOKEN-ya-never-in-a-message';

// ── fake time limit: the route's 40000 ms timer is recorded and fires after FAST_MS; every other timer is real ──
var FAST_MS = 80; var BODY_LATE_MS = 600; // the body arrives long after the (fast) deadline
var realSetTimeout = global.setTimeout; var realClearTimeout = global.clearTimeout;
var limitTimers = [];
global.setTimeout = function (fn, ms) {
  if (ms === 40000) {
    var rec = { ms: ms, fired: false, cleared: false, firedAt: null };
    rec.h = realSetTimeout(function () { rec.fired = true; rec.firedAt = Date.now(); state.events.push('deadline'); fn(); }, FAST_MS);
    limitTimers.push(rec); state.events.push('timer-set');
    return rec.h;
  }
  return realSetTimeout.apply(null, arguments);
};
global.clearTimeout = function (h) {
  limitTimers.forEach(function (r) { if (r.h === h && !r.cleared) { r.cleared = true; state.events.push('timer-cleared'); } });
  return realClearTimeout(h);
};

var GOOD_FEED = {
  ok: true, source: 'nextrade-staging', site: 'fix.nextrade-staging.com',
  orders: [{ id: 1519, release_number: '1002-1156', customer_name: 'Kenya buyer', warehouse_name: 'Houston', status: 'closed', is_bonded_order: 1, country: 'Kenya', shipped_date: '2026-06-30 12:43:09', created_at: '2026-05-28 19:40:33' }],
  stages: [{ id: 4564, order_id: 1519, order_status: 'shipping_in_process', best_rate_received: '3475', trucker_quote: '1850', load_date: '2026-06-29 09:00:00', updated_at: '2026-06-29 15:15:30' }]
};
function abortErr() { var e = new Error('This operation was aborted'); e.name = 'AbortError'; return e; }
// headers at once; the body (text) resolves only after `late` ms — unless the request's signal aborts first
function slowResponse(signal, late) {
  return { ok: true, status: 200, headers: { get: function () { return 'application/json'; } },
    text: function () {
      return new Promise(function (resolve, reject) {
        if (signal.aborted) { return reject(abortErr()); }
        var t = realSetTimeout(function () { state.events.push('body-complete'); resolve(JSON.stringify(GOOD_FEED)); }, late);
        signal.addEventListener('abort', function () { realClearTimeout(t); state.events.push('body-aborted'); reject(abortErr()); });
      });
    } };
}
global.fetch = function (url, opt) {
  state.fetches++; state.events.push('fetch'); state.lastOpt = opt;
  if (state.mode === 'throw') { return Promise.reject(new Error('getaddrinfo ENOTFOUND (test)')); }
  if (state.mode === 'http500') { return Promise.resolve({ ok: false, status: 500, text: function () { return Promise.resolve('oops'); } }); }
  state.events.push('headers');
  return Promise.resolve(slowResponse(opt.signal, state.mode === 'slow' ? BODY_LATE_MS : 5));
};

function seed() {
  var db = new FakeDb({ pl_warehouse_sync_runs: [{ cols: ['source'], where: function (r) { return r.finished_at == null; } }] }); // = pl_warehouse_one_active_run ((true)) WHERE finished_at IS NULL
  var orig = db.from;
  db.from = function (t) {
    var q = orig(t);
    q.lt = function (k, v) { q.filters.push(function (r) { return r[k] != null && String(r[k]) < String(v); }); return q; };
    if (t === 'pl_warehouse_sync_runs') { var ins = q.insert; q.insert = function (row) { return ins.call(q, Object.assign({ started_at: new Date().toISOString(), finished_at: null, ok: null, error: null }, row)); }; }
    return q;
  };
  db.t.pl_warehouse_settings = [{ key: 'active_source', value: 'nextrade-staging' }];
  db.t.pl_warehouse_sync_runs = [{ id: 'old-ok', started_at: '2026-11-22T10:00:00.000Z', finished_at: '2026-11-22T10:00:30.000Z', ok: true, error: null, source: 'nextrade-staging' }];
  db.t.pl_warehouse_shipping = [{ id: 'ws1', source: 'nextrade-staging', section: 'main', order_id: 1519, release_number: '1002-1156', freight_used: 3400, trucking_used: 1800, combined_used: 5200, cost_status: 'provisional', in_latest_feed: true, superseded: false, last_changed_at: '2026-11-22T10:00:30.000Z' }];
  db.t.pl_warehouse_shipping_history = [{ id: 'h1', order_id: 1519, kind: 'created' }];
  db.t.accounting_invoices = [{ id: 'inv1', invoice_number: 'INV-1', release_number: '1002-1156', total_amount: 9000, record_status: 'active' }];
  db.t.accounting_customers = []; db.t.vendor_bills = [];
  db.rpcs.pl_warehouse_publish = function (args, self) {
    state.published++;
    var run = self.t.pl_warehouse_sync_runs.filter(function (r) { return r.id === args.p_run_id; })[0];
    run.finished_at = new Date().toISOString(); run.ok = true;
    return { error: null, data: { rows: args.p_rows.length, history: Object.keys(args.p_changes || {}).length } };
  };
  return db;
}
var R = require(path.join(root, 'src/app/api/accounting/warehouse-shipping/route.js'));
var H = require(path.join(root, 'src/lib/warehouse-feed-read.js'));
function cron() { return R.GET(new Request('http://x/api/accounting/warehouse-shipping', { headers: { authorization: 'Bearer cron-secret-for-tests' } })).then(function (r) { return r.json().then(function (j) { j._status = r.status; return j; }); }); }
function snap(db) { return JSON.stringify({ s: db.t.pl_warehouse_shipping, h: db.t.pl_warehouse_shipping_history, i: db.t.accounting_invoices, st: db.t.pl_warehouse_settings }); }
function runs(db) { return db.t.pl_warehouse_sync_runs.filter(function (r) { return r.id !== 'old-ok'; }); }
function idx(e) { return state.events.indexOf(e); }

(async function () {
  console.log('YA rev2 — headers at once, body still arriving after the deadline');
  state.db = seed(); state.mode = 'slow'; state.events = []; limitTimers = []; state.published = 0;
  var before = snap(state.db);
  var t0 = Date.now();
  var out = await cron();
  var took = Date.now() - t0;
  var run = runs(state.db)[0] || {};
  check('the answer is a failed sync (502), not a hang and not a success', out._status === 502 && out.ok === false, out);
  check('the time limit fired and ABORTED the body read (signal aborted)', limitTimers.length === 1 && limitTimers[0].fired === true && state.lastOpt.signal.aborted === true && idx('body-aborted') >= 0, { timers: limitTimers.length, ev: state.events });
  check('the limit was still running AFTER the headers arrived (it covers the body, not just the headers)', idx('timer-set') >= 0 && idx('timer-set') < idx('fetch') && idx('headers') < idx('deadline') && idx('deadline') < idx('body-aborted'), state.events);
  check('the late body never completed and was never accepted', idx('body-complete') < 0, state.events);
  check('it stopped at the deadline, not when the body would have finished', took < BODY_LATE_MS, took);
  check('the timer was cleared afterwards, once (finally), after the abort', limitTimers[0].cleared === true && idx('timer-cleared') > idx('body-aborted'), state.events);
  check('failRun recorded the run: finished_at set, ok false', runs(state.db).length === 1 && !!run.finished_at && run.ok === false, run);
  check('… with the plain message (still arriving after 40 seconds and was cut off — may be sending it slowly)', run.error === H.feedIncompleteMessage(40) && /still arriving after 40 seconds and was cut off/.test(run.error) && /may be sending it slowly/.test(run.error), run.error);
  check('… the stored message ends with "Nothing was changed in the Hub." and states no size / compression', /Nothing was changed in the Hub\.$/.test(run.error) && !/10 MB|compress/i.test(run.error), run.error);
  check('the answer says the figures were kept, and never "answered 200"', /^SYNC FAILED — the figures already in the Hub were kept unchanged\. /.test(out.error || '') && !/answered 200/.test(out.error || ''), out.error);
  check('the token is in no message', String(out.error).indexOf('TOKEN-ya') < 0 && String(run.error).indexOf('TOKEN-ya') < 0);
  check('nothing was published (pl_warehouse_publish never called)', state.published === 0, state.published);
  check('existing data unchanged (shipping rows, history, invoices, settings)', snap(state.db) === before);
  check('no unfinished run is left behind', state.db.t.pl_warehouse_sync_runs.every(function (r) { return r.finished_at != null; }), state.db.t.pl_warehouse_sync_runs);

  console.log('YA rev2 — the next sync is not blocked');
  state.mode = 'fast'; state.events = []; limitTimers = [];
  var out2 = await cron();
  var run2 = runs(state.db)[1] || {};
  check('the next sync starts at once (not "Another sync is running") and succeeds', out2._status === 200 && out2.ok === true && !out2.busy, out2);
  check('… it published once and its run is finished ok', state.published === 1 && run2.ok === true && !!run2.finished_at, run2);
  check('… its timer was cleared on success (no timer left running)', limitTimers.length === 1 && limitTimers[0].cleared === true && limitTimers[0].fired === false, limitTimers);

  console.log('YA rev2 — the lock is real (so the check above means something)');
  state.db = seed(); state.db.t.pl_warehouse_sync_runs.push({ id: 'running', started_at: new Date().toISOString(), finished_at: null, source: 'nextrade-staging' });
  state.fetches = 0; state.mode = 'fast';
  var out3 = await cron();
  check('a fresh unfinished run blocks a second sync (409 busy), the feed is not even read', out3._status === 409 && out3.busy === true && state.fetches === 0, out3);

  console.log('YA rev2 — the timer is cleared on the other paths too');
  state.db = seed(); state.mode = 'http500'; state.events = []; limitTimers = []; before = snap(state.db);
  var out4 = await cron(); var run4 = runs(state.db)[0] || {};
  check('non-200: failed run with "answered HTTP 500", timer cleared, not fired', out4._status === 502 && /answered HTTP 500/.test(run4.error || '') && run4.ok === false && limitTimers[0].cleared === true && limitTimers[0].fired === false, { out4: out4, run4: run4, t: limitTimers });
  check('non-200: nothing published, data unchanged', state.published === 1 && snap(state.db) === before);
  state.db = seed(); state.mode = 'throw'; state.events = []; limitTimers = []; before = snap(state.db);
  var out5 = await cron(); var run5 = runs(state.db)[0] || {};
  check('thrown fetch: failed run naming the network error, timer cleared, not fired', out5._status === 502 && /Could not read the warehouse feed \(getaddrinfo ENOTFOUND/.test(run5.error || '') && limitTimers[0].cleared === true && limitTimers[0].fired === false, { out5: out5, run5: run5 });
  check('thrown fetch: data unchanged, run finished', snap(state.db) === before && !!run5.finished_at);

  console.log('YA rev2 — the route source');
  var src = fs.readFileSync(path.join(root, 'src/app/api/accounting/warehouse-shipping/route.js'), 'utf8');
  var blk = src.substring(src.indexOf('// 1. the warehouse feed'), src.indexOf('if (feedFail) { return await failRun(feedFail); }'));
  check('production deadline is still 40000 ms and the timer is created before the try', /var ctl = new AbortController\(\); var tm = setTimeout\(function \(\) \{ ctl\.abort\(\); \}, 40000\);\r?\n\s*try \{/.test(blk));
  check('clearTimeout appears only in the finally, after readFeedBody', (blk.match(/clearTimeout/g) || []).length === 1 && /finally \{ clearTimeout\(tm\); \}/.test(blk) && blk.indexOf('readFeedBody') < blk.indexOf('clearTimeout'));
  check('route keeps var + concatenation (no template literals, no let/const in the changed block)', !/`/.test(blk) && !/\b(let|const)\s/.test(blk));

  global.setTimeout = realSetTimeout; global.clearTimeout = realClearTimeout;
  console.log('\nYA rev2 shipping slow body: ' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('CRASH', e && e.stack); process.exit(1); });
