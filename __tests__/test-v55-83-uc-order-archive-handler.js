// ═══════════════════════════════════════════════════════════════════════════
// v55.83-UC — Codex QA 18 Nov: run the REAL /api/accounting/order-monitor POST handler (archive_row / unarchive_row / report)
// with an in-memory database, stand-in sign-in / permission / audit modules and a stand-in warehouse feed (no network, no mail).
// Run: node __tests__/test-v55-83-uc-order-archive-handler.js
// The SQL guard itself (delete refused, one active entry, frozen history) is run on real Postgres in test-v55-83-uc-order-archive.mjs.
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var FakeDb = require('./fake-supabase.js').FakeDb;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 600))); }

var state = { perms: {}, db: null, audits: [], auditThrows: false, feedFail: false, feedCalls: 0, feed: null };
function stub(rel, exportsObj) { var p = require.resolve(path.join(root, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj }; }
stub('src/lib/verified-caller.js', { verifiedCaller: function () { return Promise.resolve({ userId: 'u1' }); } });
stub('src/lib/server-permissions.js', {
  assertPermission: function (db, uid, perm) { return Promise.resolve(state.perms[perm] ? { ok: true, ctx: { isSuperAdmin: false } } : { ok: false, status: 403 }); },
  loadUserPermissions: function () { return Promise.resolve({ isSuperAdmin: false, mp: state.perms }); },
  userHasPermission: function (ctx, perm) { return !!(ctx && ctx.mp && ctx.mp[perm]); },
});
stub('src/lib/audit-server.js', { audit: function (db, actor, action, entity, id, details) { if (state.auditThrows) { return Promise.reject(new Error('audit table down')); } state.audits.push({ action: action, id: id, details: details }); return Promise.resolve(); } });
stub('src/lib/notify-server.js', { sendAlertEmail: function () { throw new Error('no mail in tests'); } });
var supa = require.resolve('@supabase/supabase-js', { paths: [root] });
require.cache[supa] = { id: supa, filename: supa, loaded: true, exports: { createClient: function () { return state.db; } } };
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test'; process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
process.env.NEXTRADE_FEED_URL = 'https://nextrade-staging.com/api/hub/shipping'; process.env.NEXTRADE_FEED_TOKEN = 'feed-token';
global.fetch = function (url) {
  state.feedCalls++;
  if (state.feedFail) { return Promise.reject(new Error('feed unreachable')); }
  var host = new URL(url).host; var src = /nextrade-staging\.com$/.test(host) ? 'nextrade-staging' : 'nextrade-live';
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(Object.assign({ ok: true, source: src, site: host }, state.feed)); } });
};
var R = require(path.join(root, 'src/app/api/accounting/order-monitor/route.js'));
function post(body) { return R.POST(new Request('http://x/api/accounting/order-monitor', { method: 'POST', body: JSON.stringify(Object.assign({ user_id: 'u1' }, body)), headers: { 'content-type': 'application/json' } })).then(function (r) { return r.json().then(function (j) { j._status = r.status; return j; }); }); }

function seed() {
  var db = new FakeDb({ order_report_archive: [{ cols: ['request_id'] }, { cols: ['source', 'order_id'], where: function (r) { return r.restored_at == null; } }] });
  // the fake has no .single() and returns arrays from update…maybeSingle(); give it both, like Supabase
  var orig = db.from;
  db.from = function (t) { var q = orig(t); q.single = function () { q.single = true; return q; };
    var ex = q.exec; q.exec = function () { if (typeof q.single === 'function') { q.single = false; } var out = ex.call(q); if (q.single && out && Array.isArray(out.data)) { out.data = out.data[0] || null; } return out; }; return q; };
  db.t.users = [{ id: 'u1', name: 'Max', email: 'max@example.test' }];
  db.t.order_report_archive = [];
  return db;
}
function arch(db) { return db.t.order_report_archive; }
state.feed = { orders: [
  { id: 1427, release_number: '1001-1427', customer_name: 'Agenda 2050', country: 'Ghana', status: 'shipped', shipped_date: '2026-06-20 02:20:00' },
  { id: 1315, release_number: '1001-1315', customer_name: 'Rejo Sports', country: 'Canada', status: 'post_loading_documentation', shipped_date: '2026-07-29 10:22:00' },
  { id: 900, release_number: '1002-0900', customer_name: 'Closed Co', country: 'Egypt', status: 'closed' }], requirements: [], status_history: [], obsolete_orders: [] };
var MANAGE = { 'accounting.view': true, 'orders.monitor': true, 'orders.manage': true };

(async function () {
  console.log('UC — archive_row through the real handler');
  state.db = seed(); state.perms = { 'accounting.view': true, 'orders.monitor': true };
  var r0 = await post({ action: 'archive_row', order_id: 1427, release_number: '1001-1427', choice: 'non_issue', request_id: 'om-arch-0001' });
  check('without Orders: Manage → 403, nothing archived', r0._status === 403 && arch(state.db).length === 0, r0);
  state.perms = { 'accounting.view': true };
  var r0b = await post({ action: 'archive_row', order_id: 1427, release_number: '1001-1427', choice: 'non_issue', request_id: 'om-arch-0001' });
  check('without Orders: Monitor → 403', r0b._status === 403 && arch(state.db).length === 0, r0b);
  state.perms = MANAGE;
  var r0c = await post({ action: 'unarchive_row', id: '00000000-0000-0000-0000-000000000000' }); state.perms = { 'accounting.view': true, 'orders.monitor': true };
  var r0d = await post({ action: 'unarchive_row', id: '00000000-0000-0000-0000-000000000000' }); state.perms = MANAGE;
  check('put back without Orders: Manage → 403; with it, an unknown entry → 404', r0d._status === 403 && r0c._status === 404, [r0c, r0d]);

  state.feedFail = true;
  var rF = await post({ action: 'archive_row', order_id: 1427, release_number: '1001-1427', choice: 'non_issue', request_id: 'om-arch-0002' });
  check('warehouse feed cannot be read → 503, nothing archived (never guessed)', rF._status === 503 && /nothing was archived/.test(rF.error) && arch(state.db).length === 0, rF);
  state.feedFail = false;

  var rU = await post({ action: 'archive_row', order_id: 2147483647, release_number: '', choice: 'non_issue', request_id: 'om-arch-0003' });
  check('order 2147483647 (not in the warehouse) → 404, nothing archived', rU._status === 404 && arch(state.db).length === 0, rU);
  var rBig = await post({ action: 'archive_row', order_id: 99999999999, choice: 'non_issue', request_id: 'om-arch-0004' });
  check('an order id too big for the table → 400', rBig._status === 400 && arch(state.db).length === 0, rBig);
  var rC = await post({ action: 'archive_row', order_id: 900, release_number: '1002-0900', choice: 'corrected', request_id: 'om-arch-0005' });
  check('a closed warehouse order → 409, nothing archived', rC._status === 409 && arch(state.db).length === 0, rC);
  var rRel = await post({ action: 'archive_row', order_id: 1427, release_number: '1001-9999', choice: 'non_issue', request_id: 'om-arch-0006' });
  check('the release the screen sent differs from the warehouse → 409, nothing archived', rRel._status === 409 && /now shows release 1001-1427/.test(rRel.error) && arch(state.db).length === 0, rRel);
  var rNoId = await post({ action: 'archive_row', order_id: 1427, release_number: '1001-1427', choice: 'non_issue' });
  check('no click id → refused', rNoId._status === 400 && arch(state.db).length === 0, rNoId);
  var rBadC = await post({ action: 'archive_row', order_id: 1427, release_number: '1001-1427', choice: 'toString', request_id: 'om-arch-0007' });
  check('a made-up choice (even "toString") → 400', rBadC._status === 400, rBadC);

  var calls0 = state.feedCalls;
  var rOk = await post({ action: 'archive_row', order_id: 1427, release_number: '1001-1427', choice: 'non_issue', note: ' paid in cash ', request_id: 'om-arch-click-1', snapshot: { customer: 'FORGED NAME', outstanding: ['Deposit'] } });
  var saved = arch(state.db)[0] || {};
  check('archive works: saved with the WAREHOUSE release, choice, trimmed note, who', rOk._status === 200 && rOk.ok && arch(state.db).length === 1 && saved.release_number === '1001-1427' && saved.choice === 'non_issue' && saved.note === 'paid in cash' && saved.archived_by === 'u1' && saved.archived_by_name === 'Max', [rOk, saved]);
  check('… the screen\'s snapshot is kept as "as shown on screen"; the warehouse-checked identity is kept apart', saved.snapshot && saved.snapshot.as_shown_on_screen === true && saved.snapshot.customer === 'FORGED NAME' && saved.snapshot.verified && saved.snapshot.verified.customer === 'Agenda 2050' && saved.snapshot.verified.release_number === '1001-1427', saved.snapshot);
  check('… the identity check reused the recent warehouse read (cache) or read it once', state.feedCalls - calls0 <= 1, state.feedCalls - calls0);
  check('… in the audit trail', state.audits.some(function (a) { return a.action === 'order_report_archived' && a.id === '1427' && a.details.request_id === 'om-arch-click-1'; }), state.audits);

  console.log('UC — the same click again (Codex P2: retry identity)');
  var rRe = await post({ action: 'archive_row', order_id: 1427, release_number: '1001-1427', choice: 'non_issue', note: 'paid in cash', request_id: 'om-arch-click-1' });
  check('exact replay → ok, the SAVED entry is answered, nothing new', rRe._status === 200 && rRe.already_recorded === true && rRe.id === saved.id && rRe.choice === 'non_issue' && rRe.note === 'paid in cash' && arch(state.db).length === 1, rRe);
  var rX1 = await post({ action: 'archive_row', order_id: 1315, release_number: '1001-1315', choice: 'corrected', note: 'other', request_id: 'om-arch-click-1' });
  var rX2 = await post({ action: 'archive_row', order_id: 1427, release_number: '1001-1427', choice: 'corrected', note: 'paid in cash', request_id: 'om-arch-click-1' });
  var rX3 = await post({ action: 'archive_row', order_id: 1427, release_number: '1001-1427', choice: 'non_issue', note: 'different note', request_id: 'om-arch-click-1' });
  check('same click id, different ORDER → 409', rX1._status === 409 && /different archive entry/.test(rX1.error), rX1);
  check('same click id, different CHOICE → 409', rX2._status === 409, rX2);
  check('same click id, different NOTE → 409', rX3._status === 409, rX3);
  process.env.NEXTRADE_FEED_URL = 'https://nextrade.example.com/api/hub/shipping'; process.env.NEXTRADE_FEED_ALLOW_LIVE = 'yes';
  var rX4 = await post({ action: 'archive_row', order_id: 1427, release_number: '1001-1427', choice: 'non_issue', note: 'paid in cash', request_id: 'om-arch-click-1' });
  process.env.NEXTRADE_FEED_URL = 'https://nextrade-staging.com/api/hub/shipping'; delete process.env.NEXTRADE_FEED_ALLOW_LIVE;
  check('same click id, other WAREHOUSE COPY → 409', rX4._status === 409, rX4);
  check('… none of those added or changed anything', arch(state.db).length === 1 && arch(state.db)[0].order_id === 1427 && arch(state.db)[0].choice === 'non_issue');
  var rDup = await post({ action: 'archive_row', order_id: 1427, release_number: '1001-1427', choice: 'corrected', request_id: 'om-arch-click-2' });
  check('a NEW click on an order already archived → 409 naming who did it', rDup._status === 409 && /already in the archive \(Non issue by Max\)/.test(rDup.error) && arch(state.db).length === 1, rDup);
  var both = await Promise.all([post({ action: 'archive_row', order_id: 1315, release_number: '1001-1315', choice: 'corrected', request_id: 'om-arch-click-3' }), post({ action: 'archive_row', order_id: 1315, release_number: '1001-1315', choice: 'corrected', request_id: 'om-arch-click-3' })]);
  check('the same click arriving twice at once → both ok, ONE entry', both[0].ok && both[1].ok && both[0].id === both[1].id && arch(state.db).filter(function (a) { return a.order_id === 1315; }).length === 1, both);

  console.log('UC — the report leaves archived rows out of the counts');
  var rep = await post({ action: 'report' });
  check('report: archived orders are NOT in rows (so not in any count)', rep.ok && rep.rows.every(function (r) { return r.id !== 1427 && r.id !== 1315; }), rep.error || rep.rows && rep.rows.map(function (r) { return r.id; }));
  check('… they are listed in archived[] with who, choice, note and the order as it is now', rep.archived && rep.archived.length === 2 && rep.archived.some(function (a) { return a.archive.order_id === 1427 && a.archive.by_name === 'Max' && a.archive.choice_words === 'Non issue' && a.archive.note === 'paid in cash' && a.row && a.row.release_number === '1001-1427'; }) && rep.archive_ready === true, rep.archived);

  console.log('UC — put back');
  var rB = await post({ action: 'unarchive_row', id: '11111111-1111-1111-1111-111111111111' });
  check('an id that is not in the archive → 404', rB._status === 404, rB);
  var aid = arch(state.db).filter(function (a) { return a.order_id === 1427; })[0].id;
  // the fake makes ids like "id12": give the entry a real-looking uuid the route accepts
  var uuid = 'aaaaaaaa-0000-0000-0000-000000001427'; arch(state.db).filter(function (a) { return a.id === aid; })[0].id = uuid;
  var rP = await post({ action: 'unarchive_row', id: uuid, note: 'still no invoice' });
  var e1427 = arch(state.db).filter(function (a) { return a.id === uuid; })[0];
  check('put back fills who / when / why; the entry stays (history)', rP.ok && e1427.restored_at && e1427.restored_by === 'u1' && e1427.restore_note === 'still no invoice' && e1427.choice === 'non_issue' && arch(state.db).length === 2, [rP, e1427]);
  var rP2 = await post({ action: 'unarchive_row', id: uuid });
  check('put back twice → 404, nothing changed', rP2._status === 404, rP2);
  var rep2 = await post({ action: 'report' });
  check('… the order is back in the report rows (and counts)', rep2.rows.some(function (r) { return r.id === 1427; }) && !rep2.archived.some(function (a) { return a.archive.order_id === 1427; }));
  var rRe2 = await post({ action: 'archive_row', order_id: 1427, release_number: '1001-1427', choice: 'non_issue', note: 'paid in cash', request_id: 'om-arch-click-1' });
  check('replay of the ORIGINAL click after put back → answers the saved (put back) entry, does not archive again', rRe2.ok && rRe2.already_recorded && rRe2.restored_at && arch(state.db).filter(function (a) { return a.order_id === 1427 && !a.restored_at; }).length === 0, rRe2);
  var rAg = await post({ action: 'archive_row', order_id: 1427, release_number: '1001-1427', choice: 'corrected', note: 'invoice made', request_id: 'om-arch-click-4' });
  check('a new click after put back archives again; both entries kept', rAg.ok && arch(state.db).filter(function (a) { return a.order_id === 1427; }).length === 2, rAg);
  check('put back is in the audit trail', state.audits.some(function (a) { return a.action === 'order_report_unarchived' && a.id === '1427'; }));
  var rOrd = await post({ action: 'order', order_id: 1427 });
  check('the order report shows the archive history (put back + current)', rOrd.ok && rOrd.extra.archive.length === 2 && rOrd.extra.archive.some(function (a) { return a.restored_at && a.restore_note === 'still no invoice'; }), rOrd.extra);

  console.log('UC — failures');
  state.auditThrows = true;
  var rAu = await post({ action: 'archive_row', order_id: 1315, release_number: '1001-1315', choice: 'non_issue', request_id: 'om-arch-click-5' });
  check('(1315 is already archived → 409 before any audit)', rAu._status === 409, rAu);
  state.db.t.order_report_archive.forEach(function (a) { if (a.order_id === 1315) { a.restored_at = new Date().toISOString(); } });
  var rAu2 = await post({ action: 'archive_row', order_id: 1315, release_number: '1001-1315', choice: 'non_issue', request_id: 'om-arch-click-6' });
  state.auditThrows = false;
  check('audit trail down → archived anyway, answered with a warning (not a failure that invites a second entry)', rAu2.ok && /audit trail line was not written/.test(rAu2.audit_warning || '') && arch(state.db).filter(function (a) { return a.request_id === 'om-arch-click-6'; }).length === 1, rAu2);
  state.db.fail = { order_report_archive: { insert: 'permission denied for table order_report_archive' } };
  var nBefore = arch(state.db).length;
  var rIn = await post({ action: 'archive_row', order_id: 1427, release_number: '1001-1427', choice: 'non_issue', request_id: 'om-arch-click-7' });
  check('the insert fails → 500 "Not archived", nothing added', rIn._status === 500 && /Not archived/.test(rIn.error) && arch(state.db).length === nBefore, rIn);
  state.db.fail = { order_report_archive: { select: 'relation "public.order_report_archive" does not exist' } };
  var rMt = await post({ action: 'archive_row', order_id: 1427, release_number: '1001-1427', choice: 'non_issue', request_id: 'om-arch-click-8' });
  check('the table is missing → archive says which SQL to run', rMt._status === 500 && /v55-83-UC-order-report-archive\.sql/.test(rMt.error), rMt);
  var repMt = await post({ action: 'report' });
  check('… and the report still works (all rows, archive_ready = false + the SQL)', repMt.ok && repMt.archive_ready === false && /v55-83-UC/.test(repMt.archive_sql_hint) && repMt.rows.length === 2 && repMt.archived.length === 0, [repMt.error, repMt.archive_ready, repMt.rows && repMt.rows.length]);
  state.db.fail = {};

  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('CRASH', e && e.stack); process.exit(1); });
