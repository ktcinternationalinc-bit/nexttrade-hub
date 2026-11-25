// v55.83-XB part 2 — the REAL route (src/app/api/accounting/weight-check/route.js) with an in-memory database and a fake
// warehouse feed. Run through test-v55-83-xb-weight-check.js (or alone). All figures are made up.
var path = require('path'); var fs = require('fs'); var Module = require('module'); var crypto = require('crypto');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 700))); }
console.log('XB part 2 — the real route, stubbed database and warehouse');

// ---------------- in-memory database (just enough of the Supabase query builder)
var T = {}; var seq = 0;
function uuid() { seq++; return '00000000-0000-4000-8000-' + String(seq).padStart(12, '0'); }
function tbl(n) { return T[n] || (T[n] = []); }
var IMMUTABLE = { wc_receipt_versions: 1, wc_ref_searches: 1, wc_links: 1, wc_product_maps: 1, wc_tolerances: 1, wc_decisions: 1, wc_reports: 1, wc_report_items: 1 };
var world = { perms: {}, superAdmin: false, floor: null, feed: null, feedCalls: 0, uid: 'u-staff' };
function Q(name) {
  var st = { name: name, f: [], ord: [], lim: null, rng: null, op: 'select', vals: null, sel: '*', single: 0 };
  var q = {
    select: function (s) { if (st.op === 'select') { st.sel = s || '*'; } else { st.ret = true; } return q; },
    eq: function (k, v) { st.f.push(function (r) { return String(r[k]) === String(v); }); return q; },
    is: function (k, v) { st.f.push(function (r) { return v === null ? (r[k] === null || r[k] === undefined) : r[k] === v; }); return q; },
    in: function (k, vs) { var s = (vs || []).map(String); st.f.push(function (r) { return s.indexOf(String(r[k])) >= 0; }); return q; },
    gte: function (k, v) { st.f.push(function (r) { return r[k] != null && String(r[k]) >= String(v); }); return q; },
    lte: function (k, v) { st.f.push(function (r) { return r[k] != null && String(r[k]) <= String(v); }); return q; },
    gt: function (k, v) { st.f.push(function (r) { return r[k] != null && String(r[k]) > String(v); }); return q; },
    lt: function (k, v) { st.f.push(function (r) { return r[k] != null && String(r[k]) < String(v); }); return q; },
    neq: function (k, v) { st.f.push(function (r) { return String(r[k]) !== String(v); }); return q; },
    overlaps: function (k, vs) { st.f.push(function (r) { return (r[k] || []).some(function (x) { return vs.indexOf(x) >= 0; }); }); return q; },
    order: function (k, o) { st.ord.push([k, !(o && o.ascending === false)]); return q; },
    limit: function (n) { st.lim = n; return q; },
    range: function (a, b) { st.rng = [a, b]; return q; },
    maybeSingle: function () { st.single = 1; return q; },
    single: function () { st.single = 2; return q; },
    insert: function (v) { st.op = 'insert'; st.vals = Array.isArray(v) ? v : [v]; return q; },
    update: function (v) { st.op = 'update'; st.vals = v; return q; },
    delete: function () { st.op = 'delete'; return q; },
    then: function (res, rej) { try { return Promise.resolve(exec(st)).then(res, rej); } catch (e) { return Promise.reject(e).then(res, rej); } }
  };
  return q;
}
function now() { return new Date(Date.now() + (seq++)).toISOString(); }
function exec(st) {
  // before Max runs the XB SQL: PostgREST's real answer for a table that is not there (PGRST205)
  if (world.noScopeTable && st.name === 'wc_vendor_scope') { return { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.wc_vendor_scope' in the schema cache" } }; }
  if (world.noSql && /^wc_/.test(st.name)) { world.noSqlHits = (world.noSqlHits || 0) + 1; return { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public." + st.name + "' in the schema cache" } }; }
  var rows = tbl(st.name);
  if (st.op === 'insert') {
    if (world.failInsert && world.failInsert[st.name]) { return { data: null, error: { message: world.failInsert[st.name] } }; }
    var made = st.vals.map(function (v) { var r = Object.assign({ id: st.name === 'wc_receipt_versions' || st.name === 'wc_ref_searches' ? ++seq : uuid(), at: now(), started_at: now() }, JSON.parse(JSON.stringify(v))); rows.push(r); return r; });
    return { data: st.single ? made[0] : made, error: null };
  }
  var hit = rows.filter(function (r) { return st.f.every(function (f) { return f(r); }); });
  if (st.op === 'update') {
    if (IMMUTABLE[st.name]) { return { data: null, error: { message: 'XB: UPDATE on ' + st.name + ' is refused' } }; }
    hit.forEach(function (r) { Object.assign(r, st.vals); }); return { data: hit, error: null };
  }
  if (st.op === 'delete') { return { data: null, error: { message: 'XB: DELETE refused in tests' } }; }
  hit = hit.slice();
  st.ord.slice().reverse().forEach(function (o) { hit.sort(function (a, b) { var x = a[o[0]], y = b[o[0]]; var c = (x == null ? '' : x) < (y == null ? '' : y) ? -1 : ((x == null ? '' : x) > (y == null ? '' : y) ? 1 : 0); if (typeof x === 'number' && typeof y === 'number') { c = x - y; } return o[1] ? c : -c; }); });
  if (st.rng) { hit = hit.slice(st.rng[0], st.rng[1] + 1); }
  if (st.lim != null) { hit = hit.slice(0, st.lim); }
  hit = JSON.parse(JSON.stringify(hit));
  if (st.single) { return { data: hit[0] || null, error: hit[0] || st.single === 1 ? null : { message: 'no rows' } }; }
  return { data: hit, error: null };
}
var storage = { files: {} };
var dbObj = {
  from: function (n) { return Q(n); },
  rpc: function (fn, args) {
    if (world.noSql && /^wc_/.test(fn)) { return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.' + fn + '(p_items, p_report) in the schema cache' } }); }
    if (fn !== 'wc_save_report') { return Promise.resolve({ data: null, error: { message: 'unknown rpc' } }); }
    var y = new Date().getFullYear(); var n = tbl('wc_reports').length + 1; var id = uuid();
    tbl('wc_reports').push(Object.assign({ id: id, report_no: 'WC-' + y + '-' + String(n).padStart(4, '0'), run_at: now() }, args.p_report));
    args.p_items.forEach(function (it, i) { tbl('wc_report_items').push(Object.assign({ report_id: id, seq: i + 1 }, JSON.parse(JSON.stringify(it)))); });
    return Promise.resolve({ data: { id: id, report_no: 'WC-' + y + '-' + String(n).padStart(4, '0'), items: args.p_items.length }, error: null });
  },
  storage: { from: function () { return { upload: function (p, buf) { storage.files[p] = buf.length; return Promise.resolve({ data: { path: p }, error: null }); }, createSignedUrl: function (p) { return Promise.resolve({ data: { signedUrl: 'https://signed/' + p }, error: null }); } }; } }
};

// ---------------- stubs
function stub(file, exportsObj) { var id = require.resolve(file); var m0 = new Module(id); m0.filename = id; m0.loaded = true; m0.exports = exportsObj; require.cache[id] = m0; }
stub(path.join(root, 'node_modules/next/server.js'), { NextResponse: { json: function (body, init) { return { status: (init && init.status) || 200, body: body }; } } });
stub('@supabase/supabase-js', { createClient: function () { return dbObj; } });
stub(path.join(root, 'src/lib/verified-caller.js'), { verifiedCaller: async function () { return world.uid ? { userId: world.uid } : { error: 'Sign in again', status: 401 }; } });
stub(path.join(root, 'src/lib/server-permissions.js'), { assertPermission: async function (db, userId, key) { if (world.superAdmin) { return { ok: true, via: 'super_admin', ctx: { isSuperAdmin: true } }; } return world.perms[key] ? { ok: true, via: 'permission', ctx: {} } : { ok: false, status: 403 }; } });
stub(path.join(root, 'src/lib/visibility-window-server.js'), { windowFloorFor: async function () { return { floor: world.floor }; }, clampFrom: function (d0, f) { return f && d0 < f ? f : d0; } });
stub(path.join(root, 'src/lib/audit-server.js'), { audit: async function (db, actor, act, ent, id, det) { tbl('audit').push({ actor: actor, action: act, entity_id: id, details: det }); } });
// the warehouse: fetch replaced by a fake that answers like the planned /api/hub-feed/receipts endpoint
global.fetch = async function (url, init) {
  world.feedCalls++;
  if (init && init.redirect !== 'error') { throw new Error('redirect must be refused'); }
  world.lastFeedHost = new URL(url).hostname; world.lastToken = init && init.headers && init.headers['X-Hub-Feed-Token'];
  if (!init || !init.headers || init.headers['X-Hub-Feed-Token'] !== (world.acceptToken || 'tok-0123456789abcdef0123456789abcdef')) { return { ok: false, status: 401, json: async function () { return {}; } }; }
  if (world.feed === 'down') { throw new Error('ECONNREFUSED'); }
  if (world.feed === 'missing') { return { ok: false, status: 404, json: async function () { return {}; } }; }
  var u = new URL(url);
  // like the real warehouse: only this exact path answers (24 Nov: the Hub used to ask …/hub-feed/shipping/receipts → 404 for ever)
  world.lastFeedPath = u.pathname;
  if (u.pathname !== '/api/hub-feed/receipts') { return { ok: false, status: 404, json: async function () { return {}; } }; } var ids = (u.searchParams.get('ids') || '').split(',').filter(Boolean); var refs = (u.searchParams.get('refs') || '').split(',').filter(Boolean);
  var W = world.wh; var recs = W.receipts.filter(function (r) { return ids.length ? ids.indexOf(String(r.id)) >= 0 : refs.some(function (x) { return [r.reference_number, r.nexpac_bill, r.info && r.info.cgt_reference].map(function (v) { return String(v || '').toUpperCase().replace(/[\s#.\-\/_]+/g, ''); }).indexOf(x) >= 0; }); });
  var logs = []; recs.forEach(function (r) { (W.logs[r.id] || []).forEach(function (l) { logs.push(Object.assign({ scan_in_inventory_id: r.id }, l)); }); });
  if (world.dropLog) { logs = logs.slice(1); }
  return { ok: true, status: 200, json: async function () { return { ok: true, source: 'nextrade-staging', site: 'nextrade-staging.com', generated_at: '2026-11-21T12:00:00Z',
    receipts: recs.map(function (r) { return Object.assign({ log_count: (W.logs[r.id] || []).length, item_count: 0, cgt_price: 9.99, value: 123 }, r); }), logs: logs.map(function (l) { return Object.assign({ cgt_price: 1.23, value: 99 }, l); }), items: [],
    not_found_ids: ids.filter(function (i) { return !recs.some(function (r) { return String(r.id) === i; }); }), lookups: { product_types: { 7: 'Vinyl' }, cgt_grades: { 2: 'Seconds' } } }; } };
};
// the address as it is really set in Vercel: the Orders report / shipping sync read it as-is, so it ends in /shipping
process.env.NEXTRADE_FEED_URL = 'https://fix.nextrade-staging.com/api/hub-feed/shipping'; process.env.NEXTRADE_FEED_TOKEN = 'tok-0123456789abcdef0123456789abcdef';
var ROUTE = require(path.join(root, 'src/app/api/accounting/weight-check/route.js'));
function call(body) { return ROUTE.POST({ json: async function () { return body; }, headers: { get: function () { return null; } } }).then(function (r) { return r; }); }
var W = require(path.join(root, 'src/lib/weight-check.js'));

// ---------------- data
var US = 'QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk';
function addBill(id, date, ref, lines, o) { tbl('vendor_bills').push(Object.assign({ id: id, vendor_name: 'NexPac Corporation', bill_number: 'N' + id.slice(-3), bill_date: date, other_reference: ref, record_status: 'active', wave_business_id: US, bill_type: 'supplier', shipment_direction: 'inbound', attachment_path: 'pv/' + id + '.pdf', total_amount: 31415.92 }, o || {})); lines.forEach(function (l, i) { tbl('vendor_bill_lines').push(Object.assign({ id: uuid(), bill_id: id, line_no: i + 1, line_kind: 'item', amount: 777.77, unit_price: 0.26 }, l)); }); }
var B1 = 'b0000000-0000-4000-8000-000000000001'; var B2 = 'b0000000-0000-4000-8000-000000000002'; var B3 = 'b0000000-0000-4000-8000-000000000003';
addBill(B1, '2026-10-05', '90000001', [{ description: 'Cambridge Seconds (LBS)', qty: 2000, unit: 'LBS' }]);
addBill(B2, '2026-10-09', '90000002', [{ description: 'Cambridge Seconds (LBS)', qty: 1000, unit: 'LBS' }]);
addBill(B3, '2025-01-04', '90000003', [{ description: 'Cambridge Seconds (LBS)', qty: 500, unit: 'LBS' }]);
world.wh = { receipts: [
  { id: 11, reference_number: 'R-11', nexpac_bill: null, is_draf: 0, info: { cgt_reference: '9000-0001', uom: null, driver_name: 'Secret Person', seal_photo_path: '/x.jpg' }, supplier: { id: 1, name: 'NexPac' }, warehouse: { id: 1, name: 'USA' } },
  { id: 12, reference_number: '90000002', nexpac_bill: null, is_draf: 0, info: { cgt_reference: null }, supplier: { id: 1, name: 'NexPac' }, warehouse: { id: 1, name: 'USA' } },
  { id: 13, reference_number: 'R-13', nexpac_bill: null, is_draf: 0, info: { cgt_reference: '90000002' }, supplier: { id: 1, name: 'NexPac' }, warehouse: { id: 2, name: 'CANADA' } }
], logs: { 11: [{ id: 101, unit: 'W', product_type: 7, cgt: 2, weight: '1000', rolls: '1', pl_weight: '450', is_scan_out: 0 }, { id: 102, unit: 'W', product_type: 7, cgt: 2, weight: '900', rolls: '1', pl_weight: '450', is_scan_out: 0 }],
  12: [{ id: 121, unit: 'W', product_type: 7, cgt: 2, weight: '1000', rolls: '1' }], 13: [{ id: 131, unit: 'W', product_type: 7, cgt: 2, weight: '1000', rolls: '1' }] } };
var STAFF = { 'accounting.view': 1, 'bills.view': 1, 'bills.weight_check.view': 1, 'bills.weight_check.validate': 1 };

(async function () {
  // ---- unauthorized
  world.perms = { 'accounting.view': 1, 'bills.view': 1 };
  var r0 = await call({ action: 'bill', bill_id: B1 });
  check('UNAUTHORIZED: Bills: View alone cannot open the weight check (server refuses, 403)', r0.status === 403 && /Warehouse check: View/.test(r0.body.error));
  world.uid = null; var r0b = await call({ action: 'bill', bill_id: B1 }); world.uid = 'u-staff';
  check('…no verified sign-in → 401', r0b.status === 401);
  world.perms = { 'accounting.view': 1, 'bills.view': 1, 'bills.weight_check.view': 1 };
  var r0c = await call({ action: 'recheck', bill_id: B1 });
  check('…View without Validate cannot recheck the warehouse', r0c.status === 403 && world.feedCalls === 0);
  var r0d = await call({ action: 'map_save', vendor_name: 'NexPac Corporation', bill_description: 'Cambridge Seconds (LBS)', bill_unit: 'LBS', wh_product_type: '7' });
  check('…nor save a product mapping (Settings)', r0d.status === 403);

  // ---- BEFORE THE SQL IS INSTALLED (the code is released first; Max runs the SQL later)
  world.perms = STAFF; world.feed = 'ok'; world.noSql = true; world.noSqlHits = 0;
  var callsBefore = world.feedCalls; var billsBefore = JSON.stringify(tbl('vendor_bills'));
  var ns = [await call({ action: 'bill', bill_id: B1 }), await call({ action: 'report_preview', date_from: '2026-10-01', date_to: '2026-10-31' }), await call({ action: 'reports' }), await call({ action: 'run_report', date_from: '2026-10-01', date_to: '2026-10-31' }), await call({ action: 'recheck', bill_id: B1 })];
  check('NO SQL YET: every action answers 503 "needs its tables first: Max runs sql/v55-83-XB-weight-check.sql" (sql_missing), never a crash or a 500', ns.every(function (r) { return r.status === 503 && r.body.ok === false && r.body.sql_missing === true && /needs its tables first: Max runs sql\/v55-83-XB-weight-check\.sql/.test(r.body.error); }) && world.noSqlHits > 0, ns.map(function (r) { return r.status + ' ' + JSON.stringify(r.body).substring(0, 160); }));
  check('…and nothing else is touched: bills unchanged, no report saved', JSON.stringify(tbl('vendor_bills')) === billsBefore && tbl('wc_reports').length === 0, world.feedCalls - callsBefore);
  var boxSrc = fs.readFileSync(path.join(root, 'src/components/WarehouseCheckBox.jsx'), 'utf8');
  check('SCREEN: the bill\'s Warehouse check box shows that answer as a calm yellow note (not a red error) and the bill view carries on', boxSrc.indexOf('{data.sql_missing ? <div') >= 0 && boxSrc.indexOf('!data.ok && !data.sql_missing') >= 0);
  world.noSql = false;

  // ---- the address (24 Nov): NEXTRADE_FEED_URL really ends in /shipping; receipts live beside it, never under it
  var FS = require(path.join(root, 'src/lib/weight-check-feed-server.js'));
  var forms = ['https://fix.nextrade-staging.com/api/hub-feed/shipping', 'https://fix.nextrade-staging.com/api/hub-feed/shipping/', 'https://fix.nextrade-staging.com/api/hub-feed', 'https://fix.nextrade-staging.com/api/hub-feed/?x=1#y', 'https://fix.nextrade-staging.com/api/hub-feed/grade-flow'];
  check('receipts address = …/api/hub-feed/receipts whether the feed address ends in /shipping, /shipping/, /hub-feed, a query or /grade-flow', forms.every(function (f) { return FS.receiptsUrl(f) === 'https://fix.nextrade-staging.com/api/hub-feed/receipts'; }), forms.map(FS.receiptsUrl));
  world.lastFeedPath = null;
  // ---- its own receipts address (Codex 24 Nov 14:30): the shared feed (Orders report / shipping) stays as it is
  var WFC = require(path.join(root, 'src/lib/warehouse-feed-config.js'));
  var SH = { NEXTRADE_FEED_URL: 'https://fix.nextrade-staging.com/api/hub-feed/shipping', NEXTRADE_FEED_TOKEN: 'tok-0123456789abcdef0123456789abcdef' };
  var RT = 'rtok-live-0123456789abcdef0123456789abcdef';
  var c0 = FS.receiptsFeedConfig(SH);
  check('no receipts settings → the shared feed, exactly as before (staging, its token)', c0.source === 'nextrade-staging' && c0.separate === false && c0.token === SH.NEXTRADE_FEED_TOKEN, c0);
  var c1 = FS.receiptsFeedConfig(Object.assign({}, SH, { NEXTRADE_RECEIPTS_URL: 'https://nextradeindustries.com/api/hub-feed/receipts' }));
  check('receipts address without its own token → refused (never borrows the shipping token)', !!c1.error && /NEXTRADE_RECEIPTS_TOKEN/.test(c1.error) && !c1.token, c1);
  var c2 = FS.receiptsFeedConfig(Object.assign({}, SH, { NEXTRADE_RECEIPTS_URL: 'https://nextradeindustries.com/api/hub-feed/receipts', NEXTRADE_RECEIPTS_TOKEN: RT, NEXTRADE_FEED_ALLOW_LIVE: 'yes' }));
  check('LIVE receipts address needs NEXTRADE_RECEIPTS_ALLOW_LIVE=yes (the shipping feed\'s live switch does not count)', !!c2.error && /NEXTRADE_RECEIPTS_ALLOW_LIVE/.test(c2.error), c2);
  var envLive = Object.assign({}, SH, { NEXTRADE_RECEIPTS_URL: 'https://nextradeindustries.com/api/hub-feed/receipts', NEXTRADE_RECEIPTS_TOKEN: RT, NEXTRADE_RECEIPTS_ALLOW_LIVE: 'yes' });
  var c3 = FS.receiptsFeedConfig(envLive); var s3 = WFC.warehouseFeedConfig(envLive);
  check('with all three set: receipts read the LIVE copy with the receipts token, while the shared feed (Orders / shipping) still reads staging', c3.source === 'nextrade-live' && c3.separate === true && c3.token === RT && s3.source === 'nextrade-staging' && s3.token === SH.NEXTRADE_FEED_TOKEN && FS.receiptsUrl(c3.url) === 'https://nextradeindustries.com/api/hub-feed/receipts', [c3.source, s3.source]);
  var c4 = FS.receiptsFeedConfig(Object.assign({}, SH, { NEXTRADE_RECEIPTS_URL: 'https://evil.example.com/api/hub-feed/receipts', NEXTRADE_RECEIPTS_TOKEN: RT }));
  var c5 = FS.receiptsFeedConfig(Object.assign({}, SH, { NEXTRADE_RECEIPTS_URL: 'http://nextradeindustries.com/api/hub-feed/receipts', NEXTRADE_RECEIPTS_TOKEN: RT, NEXTRADE_RECEIPTS_ALLOW_LIVE: 'yes' }));
  check('the same address rules: another site refused, plain http refused (error names NEXTRADE_RECEIPTS_URL)', !!c4.error && /NEXTRADE_RECEIPTS_URL/.test(c4.error) && /not an approved/.test(c4.error) && !!c5.error && /https/.test(c5.error), [c4.error, c5.error]);
  var nLive = FS.normaliseAnswer({ ok: true, source: 'nextrade-staging', receipts: [], logs: [] }, c3, 'ids', []);
  check('…and an answer claiming to be another copy than the receipts address is refused (identity)', nLive.ok === false && /expected nextrade-live/.test(nLive.error), nLive);

  // ---- outage
  world.perms = STAFF; world.feed = 'down';
  var r1 = await call({ action: 'recheck', bill_id: B1 });
  var it1 = r1.body.items && r1.body.items[0];
  check('WAREHOUSE OUTAGE: recheck fails cleanly → "Warehouse unavailable / not checked", never "No receipt found"', r1.status === 200 && r1.body.recheck.ok === false && it1.outcome === 'warehouse_unavailable' && /not checked/.test(r1.body.recheck.error), r1.body);
  world.feed = 'missing';
  var r1b = await call({ action: 'recheck', bill_id: B1 });
  check('…the receipts feed not installed on the warehouse yet (404) → the same, with that reason', r1b.body.recheck.ok === false && /not installed/.test(r1b.body.recheck.error) && r1b.body.items[0].outcome === 'warehouse_unavailable');
  var failedRuns = tbl('wc_fetch_runs').filter(function (r) { return r.ok === false; }).length;
  check('…each failed read is recorded as a failed run (nothing of it kept as receipts)', failedRuns === 2 && tbl('wc_receipt_versions').length === 0);
  // Codex 11:12 P1 — the expected first state (no receipts feed on the warehouse yet) must never give a "Complete" report
  var pv0 = await call({ action: 'report_preview', date_from: '2026-10-01', date_to: '2026-10-31' });
  check('ENDPOINT MISSING: the default list SHOWS the not-checked bills (rows 2), outstanding 2 — never "nothing outstanding"', pv0.body.rows.length === 2 && pv0.body.summary.outstanding === 2 && pv0.body.summary.blocked === 2 && pv0.body.rows.every(function (r) { return r.outcome === 'warehouse_unavailable' && r.state === 'not_checked' && r.outstanding && r.allowed.length === 0; }), pv0.body);
  var rep0 = await call({ action: 'run_report', date_from: '2026-10-01', date_to: '2026-10-31' });
  check('…the saved report says "Refresh failed · Open — 2 items outstanding (2 not checked or blocked)", NOT Complete, while the recheck says the feed is not installed', rep0.status === 200 && rep0.body.report.status === 'Refresh failed · Open — 2 items outstanding (2 not checked or blocked)' && rep0.body.report.complete === false && rep0.body.recheck.ok === false && /not installed/.test(rep0.body.recheck.error), rep0.body);
  var saved0 = tbl('wc_reports').filter(function (r) { return r.id === rep0.body.report.id; })[0];
  check('…and its history keeps that truthful open state (status and every item as not checked)', saved0.status_at_run === rep0.body.report.status && tbl('wc_report_items').filter(function (i) { return i.report_id === rep0.body.report.id; }).every(function (i) { return i.state === 'not_checked' && i.needs_attention === true; }));
  world.feed = 'down';
  var rep0b = await call({ action: 'report_preview', date_from: '2026-10-01', date_to: '2026-10-31' });
  check('OUTAGE: the same — the not-checked bills stay in the default list', rep0b.body.rows.length === 2 && rep0b.body.rows.every(function (r) { return r.state === 'not_checked'; }));
  var reportsBefore = tbl('wc_reports').length; // the numbering checks below count from here

  // ---- recheck works, proposal, confirm
  world.feed = 'ok';
  var r2 = await call({ action: 'recheck', bill_id: B1 });
  var it2 = r2.body.items[0];
  check('the real route, with the address as set in Vercel (…/api/hub-feed/shipping), asks exactly /api/hub-feed/receipts', world.lastFeedPath === '/api/hub-feed/receipts', world.lastFeedPath);
  check('recheck reads the receipt by the bill’s reference and PROPOSES it (a person confirms; never linked silently)', r2.body.recheck.ok === true && it2.needs_link && it2.candidates.length === 1 && it2.candidates[0].receipt_id === '11' && tbl('wc_links').length === 0, r2.body);
  var stored = tbl('wc_receipt_versions')[0];
  check('ALLOWLIST: prices, values, driver names and photo paths are NOT stored', stored && JSON.stringify(stored.data).indexOf('cgt_price') < 0 && JSON.stringify(stored.data).indexOf('Secret Person') < 0 && JSON.stringify(stored.data).indexOf('seal_photo') < 0 && JSON.stringify(stored.data).indexOf('"value"') < 0);
  check('the browser answer carries NO money (no bill amount, price or line amount)', JSON.stringify(r2.body).indexOf('31415') < 0 && JSON.stringify(r2.body).indexOf('777.77') < 0 && JSON.stringify(r2.body).indexOf('0.26') < 0);
  var r3 = await call({ action: 'link', bill_id: B1, receipt_id: '11', basis: 'cgt_reference', bill_value: '90000001', receipt_value: '9000-0001' });
  var it3 = r3.body.items.filter(function (i) { return i.kind === 'line'; })[0];
  check('after confirming, an unmapped product → Cannot compare (needs an approved mapping), never matched by name', it3 && it3.outcome === 'cannot_compare' && it3.needs_mapping, r3.body.items);
  world.perms = Object.assign({}, STAFF, { 'bills.weight_check.settings': 1 });
  var rm = await call({ action: 'map_save', vendor_name: 'NexPac Corporation', bill_description: 'Cambridge Seconds (LBS)', bill_unit: 'LBS', wh_product_type: '7', wh_cgt: '2', wh_label: 'Vinyl · Seconds', lb_per_yd: 2.5, lb_factor_approved: true });
  check('a pounds-per-yard factor can only be APPROVED by the super admin (Max)', rm.status === 403);
  rm = await call({ action: 'map_save', vendor_name: 'NexPac Corporation', bill_description: 'Cambridge Seconds (LBS)', bill_unit: 'LBS', wh_product_type: '7', wh_cgt: '2', wh_label: 'Vinyl · Seconds' });
  check('a mapping is saved (versioned)', rm.status === 200 && rm.body.map.version === 1);
  world.perms = STAFF;
  var r4 = await call({ action: 'bill', bill_id: B1 });
  var p4 = r4.body.items.filter(function (i) { return i.kind === 'product'; })[0];
  check('REAL DIFFERENCE through the route: billed 2,000 lb, scanned 1,900 → discrepancy −100 lb (−5%)', p4 && p4.outcome === 'discrepancy' && p4.figures.diff === -100 && p4.figures.pct === -5, p4);
  check('…shows the receipt, the scan rows behind it, and the declared packing-list weight apart', p4.receipts[0].reference_number === 'R-11' && p4.scan_rows.length === 2 && p4.figures.declared_pl_kg === 900);

  // ---- decisions
  var bad1 = await call({ action: 'decide', bill_id: B1, item_key: p4.item_key, kind: 'accept_discrepancy', reason: 'Supplier confirmed short shipment', expected_fp: p4.comparison_fp });
  check('UNAUTHORIZED REVIEW: Validate permission alone cannot ACCEPT a discrepancy', bad1.status === 403 && /accept/.test(bad1.body.error));
  var bad2 = await call({ action: 'decide', bill_id: B1, item_key: p4.item_key, kind: 'validate_match', reason: 'looks fine to me', expected_fp: p4.comparison_fp });
  check('"Validate match" is refused on a discrepancy (only for equal / within tolerance)', bad2.status === 409);
  world.perms = Object.assign({}, STAFF, { 'bills.weight_check.accept': 1 });
  var bad3 = await call({ action: 'decide', bill_id: B1, item_key: p4.item_key, kind: 'accept_discrepancy', reason: 'ok', expected_fp: p4.comparison_fp });
  check('Accept needs a reason', bad3.status === 400);
  var bad4 = await call({ action: 'decide', bill_id: B1, item_key: p4.item_key, kind: 'accept_discrepancy', reason: 'Supplier confirmed short shipment', expected_fp: 'stale' });
  check('a decision on figures that changed since the screen opened is refused (409)', bad4.status === 409);
  var acc = await call({ action: 'decide', bill_id: B1, item_key: p4.item_key, kind: 'accept_discrepancy', reason: 'Supplier confirmed short shipment by email', expected_fp: p4.comparison_fp, evidence_files: [{ name: 'email.pdf', type: 'application/pdf', base64: Buffer.from('x'.repeat(200)).toString('base64') }] });
  var pa = acc.body.items.filter(function (i) { return i.kind === 'product'; })[0];
  check('ACCEPTED DISCREPANCY: "Reviewed — discrepancy accepted", still shown as a discrepancy, not outstanding', acc.status === 200 && pa.state === 'accepted' && pa.outcome === 'discrepancy' && !pa.outstanding && /discrepancy accepted/.test(pa.state_words), acc.body);
  var dec = tbl('wc_decisions')[0];
  check('…the decision keeps who / when / reason / evidence / snapshot (bill line, receipt version, scan ids, figures, fingerprint)', dec.actor === 'u-staff' && dec.evidence[0].path.indexOf('weight-check/') === 0 && dec.snapshot.receipt_versions[0].version_no === 1 && dec.snapshot.scan_rows.length === 2 && dec.snapshot.figures.diff === -100 && dec.comparison_fp && dec.evidence_hash);
  var bill1 = tbl('vendor_bills').filter(function (b) { return b.id === B1; })[0];
  check('SAFETY: the bill itself is untouched (not paid, not validated, not disputed, lines unchanged)', !bill1.disputed && !bill1.validation_status && tbl('vendor_bill_lines').filter(function (l) { return l.bill_id === B1; }).length === 1 && !tbl('vendor_bill_payments').length);
  var again = await call({ action: 'decide', bill_id: B1, item_key: p4.item_key, kind: 'accept_discrepancy', reason: 'again for no reason', expected_fp: p4.comparison_fp });
  check('an unchanged accepted item is not asked again (deciding twice is refused until reopened)', again.status === 409);

  // ---- goods shipped (scanned out) + bill re-saved unchanged → stays accepted; weight edited → needs revalidation
  world.wh.logs[11].forEach(function (l) { l.is_scan_out = 1; });
  await call({ action: 'recheck', bill_id: B1 });
  var lines1 = tbl('vendor_bill_lines').filter(function (l) { return l.bill_id === B1; }); lines1[0].id = uuid(); // a re-save gives new line ids
  var r5 = await call({ action: 'bill', bill_id: B1 }); var p5 = r5.body.items.filter(function (i) { return i.kind === 'product'; })[0];
  check('approve → goods shipped → rerun, and an unchanged bill re-save: still accepted (a new receipt version was stored, the fingerprint did not change)', p5.state === 'accepted' && tbl('wc_receipt_versions').filter(function (v) { return v.receipt_id === '11'; }).length === 2, p5);
  world.wh.logs[11][1].weight = '880';
  await call({ action: 'recheck', bill_id: B1 });
  var r6 = await call({ action: 'bill', bill_id: B1 }); var p6 = r6.body.items.filter(function (i) { return i.kind === 'product'; })[0];
  check('SOURCE CHANGE: a scan weight edited in the warehouse → Needs revalidation, the old decision kept, what changed is listed', p6.state === 'needs_revalidation' && p6.outstanding && p6.decision.kind === 'accept_discrepancy' && (p6.changed || []).some(function (s) { return /scan row 102/.test(s) && /900 → 880/.test(s); }), p6);
  check('…the earlier receipt versions are all kept (3 versions)', tbl('wc_receipt_versions').filter(function (v) { return v.receipt_id === '11'; }).length === 3);

  // ---- reported issue
  var p6b = p6;
  var iss = await call({ action: 'decide', bill_id: B1, item_key: p6b.item_key, kind: 'report_issue', reason: 'Twenty pounds less again — ask the warehouse to reweigh', assignee: 'u-boss', expected_fp: p6b.comparison_fp });
  check('REPORT ISSUE: refused when the person to assign does not exist', iss.status === 400);
  tbl('users').push({ id: 'u-boss', name: 'Boss', active: true }, { id: 'u-staff', name: 'Staff One', active: true });
  iss = await call({ action: 'decide', bill_id: B1, item_key: p6b.item_key, kind: 'report_issue', reason: 'Twenty pounds less again — ask the warehouse to reweigh', assignee: 'u-boss', expected_fp: p6b.comparison_fp });
  var pi = iss.body.items.filter(function (i) { return i.kind === 'product'; })[0];
  var tk = tbl('tickets')[0];
  check('REPORTED ISSUE: a ticket is created and assigned; the item stays OUTSTANDING (not approval)', iss.status === 200 && pi.state === 'issue_open' && pi.outstanding && tk && tk.assigned_to === 'u-boss' && /does NOT dispute/.test(tk.description), iss.body);
  check('…the bill is NOT disputed and NOT taken out of payments', !tbl('vendor_bills').filter(function (b) { return b.id === B1; })[0].disputed);
  world.perms = Object.assign({}, STAFF, { 'bills.weight_check.accept': 1 });
  var res0 = await call({ action: 'decide', bill_id: B1, item_key: pi.item_key, kind: 'resolve', reason: 'Reweighed, confirmed', evidence_note: 'scale ticket 4411 attached to the receipt', expected_fp: pi.comparison_fp });
  check('…resolving needs the Resolve permission', res0.status === 403);
  world.perms = Object.assign({}, STAFF, { 'bills.weight_check.resolve': 1 });
  var res1 = await call({ action: 'decide', bill_id: B1, item_key: pi.item_key, kind: 'resolve', reason: 'Reweighed, confirmed', expected_fp: pi.comparison_fp });
  check('…a resolution without evidence is refused', res1.status === 400 && /evidence/.test(res1.body.error));
  var res2 = await call({ action: 'decide', bill_id: B1, item_key: pi.item_key, kind: 'resolve', reason: 'Reweighed, supplier credit agreed', evidence_note: 'scale ticket 4411 and supplier email of 20 Nov', expected_fp: pi.comparison_fp });
  var pr2 = res2.body.items.filter(function (i) { return i.kind === 'product'; })[0];
  check('…resolved with evidence → not outstanding; the ticket is closed', pr2.state === 'resolved' && !pr2.outstanding && tbl('tickets')[0].status === 'Resolved');
  var ro = await call({ action: 'decide', bill_id: B1, item_key: pr2.item_key, kind: 'reopen', reason: 'Credit never arrived', expected_fp: pr2.comparison_fp });
  var pro = ro.body.items.filter(function (i) { return i.kind === 'product'; })[0];
  check('REOPEN with a reason → outstanding again; the whole history stays (accept, issue, resolve, reopen)', pro.state === 'reopened' && pro.outstanding && pro.history.length === 4);

  // ---- split bills on one receipt, ambiguous proposal, history window
  world.perms = STAFF;
  var r7 = await call({ action: 'recheck', bill_id: B2 });
  var u7 = r7.body.items[0];
  check('AMBIGUOUS: the bill’s reference is on two receipts (Reference No of 12, CGT reference of 13) → a person must choose', u7.needs_link && u7.candidates.length === 2 && /choose/.test(u7.reasons[0]), u7);
  await call({ action: 'link', bill_id: B2, receipt_id: '11', basis: 'manual', reason: 'x' }).then(function (r) { check('a hand-chosen link needs a real reason', r.status === 400); });
  await call({ action: 'link', bill_id: B2, receipt_id: '11', basis: 'manual', reason: 'packing list shows the same pallets as receipt 11' });
  var r8 = await call({ action: 'bill', bill_id: B1 }); var p8 = r8.body.items.filter(function (i) { return i.kind === 'product'; })[0];
  check('SPLIT BILLS: a second bill linked to the same receipt joins the group — billed 2,000 + 1,000 compared with the whole receipt (1,880) once, the same item (still outstanding after the reopen)', p8.bill_ids.length === 2 && p8.figures.billed === 3000 && p8.figures.received === 1880 && p8.figures.scans === 2 && p8.state === 'reopened' && p8.outstanding, p8);
  world.floor = '2026-10-07';
  var r9 = await call({ action: 'bill', bill_id: B2 }); var p9 = r9.body.items[0];
  check('LIMITED ACCESS: with a history window that hides bill 1, bill 2’s group shows "limited access" — no figures, no hidden bill', p9.outcome === 'limited_access' && p9.figures === null && JSON.stringify(r9.body).indexOf('N001') < 0 && JSON.stringify(r9.body.items).indexOf(B1) < 0, r9.body.items);
  var r9b = await call({ action: 'bill', bill_id: B3 });
  check('a bill dated before the window cannot be opened at all', r9b.status === 403);
  var pv9 = await call({ action: 'report_preview', date_from: '2026-10-01', date_to: '2026-10-31' });
  check('LIMITED GROUP in the report: shown in the default list as "Blocked — part of this group is outside your access" (outstanding, no decision possible)', pv9.body.rows.some(function (r) { return r.outcome === 'limited_access' && r.state === 'limited' && r.outstanding && r.allowed.length === 0; }) && !/^Complete/.test(W.reportStatus(pv9.body.rows).words), pv9.body.rows.map(function (r) { return [r.outcome, r.state]; }));
  world.floor = null;

  // ---- reports and history (Max's example in small)
  world.perms = Object.assign({}, STAFF, { 'bills.weight_check.accept': 1 });
  var rep1 = await call({ action: 'run_report', date_from: '2026-10-01', date_to: '2026-10-31' });
  check('RUN REPORT: saved with the next number (WC-YYYY-0002, after the not-checked report 0001) and an honest status (open items → "Open — N outstanding")', rep1.status === 200 && reportsBefore === 1 && /^WC-\d{4}-0002$/.test(rep1.body.report.report_no) && /^Open/.test(rep1.body.report.status), rep1.body);
  var savedItems1 = tbl('wc_report_items').filter(function (i) { return i.report_id === rep1.body.report.id; });
  check('…every item of the range is saved (not only the outstanding ones), frozen with figures and state', savedItems1.length >= 1 && savedItems1.every(function (i) { return i.row && i.state; }));
  var open = rep1.body.rows.filter(function (r) { return r.outstanding && r.allowed.indexOf('accept_discrepancy') >= 0; })[0];
  var acc2 = await call({ action: 'decide', bill_id: open.bill_ids[0], item_key: open.item_key, kind: 'accept_discrepancy', reason: 'Both bills checked against the packing lists', expected_fp: open.comparison_fp });
  check('an item of the report is accepted afterwards', acc2.status === 200);
  var prev = await call({ action: 'report_preview', date_from: '2026-10-01', date_to: '2026-10-31' });
  check('NEXT RUN: the accepted item has left the outstanding list (not asked again while unchanged)', !prev.body.rows.some(function (r) { return r.item_key === open.item_key; }));
  var hist = await call({ action: 'report', id: rep1.body.report.id });
  var hi = hist.body.items.filter(function (i) { return i.item_key === open.item_key; })[0];
  check('HISTORY: the old report still shows the item as it stood (frozen), PLUS the later acceptance, PLUS the current state — kept apart', hi && hi.frozen_state !== 'accepted' && hi.later.length === 1 && hi.later[0].kind === 'accept_discrepancy' && hi.current.state === 'accepted', hi);
  var rep2 = await call({ action: 'run_report', date_from: '2026-10-01', date_to: '2026-10-31' });
  check('a second run gets the next number; the first report is never overwritten', /0003$/.test(rep2.body.report.report_no) && tbl('wc_reports').length === 3 && tbl('wc_report_items').filter(function (i) { return i.report_id === rep1.body.report.id; }).length === savedItems1.length);
  var list = await call({ action: 'reports' });
  check('Report History lists every report (the not-checked one too) with who ran them', list.body.reports.length === 3 && list.body.reports[0].run_by_name === 'Staff One');
  world.floor = '2026-10-07';
  var hist2 = await call({ action: 'report', id: rep1.body.report.id });
  check('a viewer with a narrower window sees the old report labelled PARTIAL, never as the whole report', hist2.body.partial === true && /PARTIAL/.test(hist2.body.partial_words));
  // Codex 11:39 — the WHOLE response (header + history list), not only the items, must hide bills outside the window
  var stored1 = tbl('wc_reports').filter(function (r) { return r.id === rep1.body.report.id; })[0];
  var hidB = (stored1.bills_checked || []).filter(function (b) { return !b.bill_date || b.bill_date < '2026-10-07'; });
  var visRefs = {}; (stored1.bills_checked || []).forEach(function (b) { if (b.bill_date >= '2026-10-07' && b.reference) { visRefs[b.reference] = true; } });
  var hidTokens = []; hidB.forEach(function (b) { hidTokens.push('"' + b.id + '"', '"' + b.bill_number + '"'); if (b.reference && !visRefs[b.reference]) { hidTokens.push('"' + b.reference + '"'); } });
  function leaks(obj) { var s = JSON.stringify(obj); return hidTokens.filter(function (t) { return s.indexOf(t) >= 0; }); }
  check('(fixture) the October report really holds a bill before the narrower window, with its reference', hidB.length >= 1 && hidTokens.length >= 3, hidB);
  check('NARROWER VIEW, report by id: the ENTIRE response carries no hidden bill id / number / reference', leaks(hist2.body).length === 0, leaks(hist2.body));
  check('…its header is rebuilt from the visible part: bills / references only in-window, totals marked partial, status says PARTIAL, other filters hidden', hist2.body.report.partial === true && hist2.body.report.bills_checked.every(function (b) { return b.bill_date >= '2026-10-07'; }) && hist2.body.report.counts.partial_totals === true && hist2.body.report.counts.items === hist2.body.items.length && /^PARTIAL — of the items you may see: /.test(hist2.body.report.status_at_run) && typeof hist2.body.report.filters.other_filters_hidden === 'boolean', hist2.body.report);
  var list2 = await call({ action: 'reports' });
  var l1 = list2.body.reports.filter(function (r) { return r.id === rep1.body.report.id; })[0];
  check('NARROWER VIEW, history list: no hidden bill id / number / reference anywhere; the entry is PARTIAL with partial totals', leaks(list2.body).length === 0 && l1 && l1.partial === true && l1.counts.partial_totals === true && /^PARTIAL/.test(l1.status_at_run), leaks(list2.body));
  check('…the stored report itself is untouched (still every bill, original status)', tbl('wc_reports').filter(function (r) { return r.id === rep1.body.report.id; })[0].bills_checked.length === stored1.bills_checked.length && stored1.status_at_run === rep1.body.report.status);
  world.floor = null;
  var hist3 = await call({ action: 'report', id: rep1.body.report.id });
  check('FULL VIEW control: an unrestricted viewer gets the full original header (hidden-to-others bill, its reference, original status)', leaks(hist3.body).length === hidTokens.length && hist3.body.report.partial === false && hist3.body.report.status_at_run === rep1.body.report.status && hist3.body.report.bills_checked.length === stored1.bills_checked.length, leaks(hist3.body));
  var csv = W.toCsv(prev.body.rows.map(function (r) { return { bill_number: r.bills[0] && r.bills[0].bill_number, outcome: r.outcome_words, state: r.state_words }; }));
  check('export: the filtered rows become CSV', /^report,bill_number/.test(csv));
  var ev = await call({ action: 'evidence_url', decision_id: dec.id, path: dec.evidence[0].path });
  check('evidence opens only through its own decision (signed link)', ev.status === 200 && /signed/.test(ev.body.url));
  var ev2 = await call({ action: 'evidence_url', decision_id: dec.id, path: 'pv/someone-else.pdf' });
  check('…any other file path is refused', ev2.status === 403);

  // ---- a receipt chosen by hand that the Hub never read: it is read by its id first (authoritative look-up), then linked
  world.perms = STAFF;
  world.wh.receipts.push({ id: 14, reference_number: 'HAND-14', nexpac_bill: null, is_draf: 0, info: {}, supplier: { id: 1, name: 'NexPac' }, warehouse: { id: 1, name: 'USA' } }); world.wh.logs[14] = [{ id: 141, unit: 'W', product_type: 7, cgt: 2, weight: '500', rolls: '1' }];
  var calls0 = world.feedCalls;
  var hl = await call({ action: 'link', bill_id: B3, receipt_id: '14', basis: 'manual', reason: 'paper receipt in the file shows HAND-14' });
  check('a receipt chosen BY HAND that the Hub never read is first read from the warehouse by its id, then linked (with the reason)', hl.status === 200 && world.feedCalls > calls0 && tbl('wc_links').some(function (l) { return l.receipt_id === '14' && l.basis === 'manual'; }), hl.body);
  var hl2 = await call({ action: 'link', bill_id: B3, receipt_id: '999', basis: 'manual', reason: 'trying a receipt that does not exist' });
  check('…a hand-chosen receipt the warehouse says does not exist is refused (never linked to nothing)', hl2.status === 409 && !tbl('wc_links').some(function (l) { return l.receipt_id === '999'; }), hl2.body);

  // ---- what the screens render (static render of the real components)
  var React = require('react'); var RDS = require('react-dom/server');
  var BOX = require(path.join(root, 'src/components/WarehouseCheckBox.jsx'));
  var pDisc = (await call({ action: 'bill', bill_id: B3 })).body.items.filter(function (i) { return i.kind === 'product'; })[0];
  var html1 = RDS.renderToStaticMarkup(React.createElement(BOX.ItemCard, { item: Object.assign({}, pDisc, { outcome: 'discrepancy', outcome_words: 'Weight / quantity discrepancy', allowed: ['accept_discrepancy', 'report_issue'], state: 'unreviewed', needs_decision: true, decision: null }), perms: { validate: true, accept: true }, onDecide: function () {} }));
  check('SCREEN: a discrepancy card shows billed, scanned, difference and the Accept / Report buttons', /Billed: /.test(html1) && /Scanned in: /.test(html1) && /Accept discrepancy/.test(html1) && /Report an issue/.test(html1) && !/Validate match/.test(html1), html1.substring(0, 400));
  var html2 = RDS.renderToStaticMarkup(React.createElement(BOX.ItemCard, { item: Object.assign({}, pDisc, { outcome: 'equal', outcome_words: 'Equal', allowed: ['validate_match', 'report_issue'], state: 'unreviewed', needs_decision: true, decision: null }), perms: { validate: true }, onDecide: function () {} }));
  check('SCREEN: an Equal card offers Validate match; without Accept permission no Accept button anywhere', /Validate match/.test(html2) && !/Accept discrepancy/.test(html2));
  var html3 = RDS.renderToStaticMarkup(React.createElement(BOX.ItemCard, { item: { item_key: 'x', kind: 'warehouse_only', outcome: 'warehouse_only', outcome_words: 'In the warehouse, not on the linked bill(s)', needs_decision: false, reasons: ['in the warehouse receipt, not on the linked bill(s) — it may be billed elsewhere'] }, perms: { validate: true, accept: true }, onDecide: function () {} }));
  check('SCREEN: an information row has no decision buttons and never says “unbilled”', !/Accept|Validate|Report an issue/.test(html3) && !/unbilled/i.test(html3));
  var html4 = RDS.renderToStaticMarkup(React.createElement(BOX.FeedLine, { feed: { staging: true, last_good: { at: '2026-11-21T10:00:00Z', complete: true }, last_run: { ok: false, at: '2026-11-21T11:00:00Z', error: 'no answer' } } }));
  check('SCREEN: the source line says STAGING, the last good read, and that the last attempt FAILED', /STAGING warehouse data/.test(html4) && /Last read: /.test(html4) && /FAILED/.test(html4));
  var html5 = RDS.renderToStaticMarkup(React.createElement(BOX.StateLine, { item: { needs_decision: true, state: 'needs_revalidation', state_words: 'Needs revalidation — the figures changed since the decision', decision: { actor_name: 'Staff One', at: '2026-11-21T10:00:00Z', reason: 'ok then' }, changed: ['scan row 102: weight 900 → 880 lb'] } }));
  check('SCREEN: needs revalidation shows the old decision and what changed', /Needs revalidation/.test(html5) && /Staff One/.test(html5) && /900 → 880/.test(html5));
  var PANEL = require(path.join(root, 'src/components/WeightCheckPanel.jsx'));
  var html6 = RDS.renderToStaticMarkup(React.createElement(PANEL.default, { bills: [], toast: {}, openDoc: function () {}, onClose: function () {} }));
  check('SCREEN: the panel opens on Invoices (YX: dates + "Check against the warehouse"), with Exceptions / Report history / Mappings tabs', /Bill date from/.test(html6) && />Invoices</.test(html6) && />Exceptions</.test(html6) && /Report history/.test(html6) && /Mappings &amp; tolerance/.test(html6) && /Check against the warehouse/.test(html6) && /Show \(last reading\)/.test(html6), html6.substring(0, 300));
  var bt = fs.readFileSync(path.join(root, 'src/components/BillsTab.jsx'), 'utf8');
  check('Bills wiring: the box sits under the bill lines, the panel opens from a Bills button, both behind the view switch', /<WarehouseCheckBox bill={b}/.test(bt) && /panel === 'weightcheck' && canWeightCheck && <WeightCheckPanel/.test(bt) && bt.indexOf("modulePerms['bills.weight_check.view']") >= 0);
  // ---- a genuinely all-approved report (control): bill 3 (Jan 2025) is linked to receipt 14 — 500 lb billed, 500 lb scanned
  world.perms = STAFF;
  var c0 = await call({ action: 'report_preview', date_from: '2025-01-01', date_to: '2025-01-31' });
  var cItem = c0.body.rows.filter(function (r) { return r.outcome === 'equal'; })[0];
  check('CONTROL: bill 3 against receipt 14 is Equal and outstanding until validated', cItem && cItem.outstanding && cItem.allowed.indexOf('validate_match') >= 0, c0.body.rows);
  var cv = await call({ action: 'decide', bill_id: B3, item_key: cItem.item_key, kind: 'validate_match', reason: 'Packing list and scale both show 500 lb', expected_fp: cItem.comparison_fp });
  var cr = await call({ action: 'run_report', date_from: '2025-01-01', date_to: '2025-01-31' });
  check('…once validated, that report is "Complete — every item decided" and the default list is empty', cv.status === 200 && cr.body.report.status === 'Complete — every item decided' && cr.body.rows.length === 0, cr.body);
  var notChecked = RDS.renderToStaticMarkup(React.createElement(BOX.ItemCard, { item: pv0.body.rows[0], perms: { validate: true, accept: true, resolve: true }, onDecide: function () {} }));
  check('SCREEN: a not-checked row says so plainly, shows no decision button, and is never shown as done', /Warehouse unavailable \/ not checked/.test(notChecked) && /Not checked — the warehouse could not be read/.test(notChecked) && !/Validate match|Accept discrepancy|Report an issue/.test(notChecked), notChecked.substring(0, 500));
  check('SCREEN: the report table shows the state of not-checked rows (needs attention), not a dash', fs.readFileSync(path.join(root, 'src/components/WeightCheckPanel.jsx'), 'utf8').indexOf("{r.needs_attention ? r.state_words : '—'}") >= 0);

  // ---- Codex 11:30 — validated earlier, then the warehouse is down when the NEXT report is generated
  var decBefore = tbl('wc_decisions').filter(function (d) { return d.item_key === cItem.item_key; }).length;
  var verBefore = tbl('wc_receipt_versions').length;
  world.feed = 'missing';
  var fr = await call({ action: 'run_report', date_from: '2025-01-01', date_to: '2025-01-31' });
  var frRow = (fr.body.rows || []).filter(function (r) { return r.item_key === cItem.item_key; })[0];
  check('CACHED + OUTAGE: the new report is "Refresh failed — using last verified warehouse data …", never Complete', fr.status === 200 && /^Refresh failed — using last verified warehouse data for 1 item/.test(fr.body.report.status) && fr.body.report.complete === false && !/^Complete/.test(fr.body.report.status), fr.body.report);
  check('…the affected item is in the DEFAULT list (no “show decided” needed), still validated, marked stale with its last verified time', frRow && frRow.state === 'validated' && frRow.stale === true && !!frRow.last_verified_at && fr.body.freshness.kind === 'refresh_failed' && fr.body.freshness.stale_items === 1, frRow);
  check('…the approval and the stored receipt copy are kept (no re-approval asked, no evidence erased, missing read ≠ missing goods)', tbl('wc_decisions').filter(function (d) { return d.item_key === cItem.item_key; }).length === decBefore && tbl('wc_receipt_versions').length === verBefore && frRow.outcome === 'equal');
  check('…and that truthful status is what the saved report keeps', tbl('wc_reports').filter(function (r) { return r.id === fr.body.report.id; })[0].status_at_run === fr.body.report.status);
  world.feed = 'ok'; world.dropLog = true;
  var fi = await call({ action: 'run_report', date_from: '2025-01-01', date_to: '2025-01-31' });
  world.dropLog = false;
  check('CACHED + INCOMPLETE answer (fewer scan rows than the receipt says): "Refresh incomplete — using last verified …", not Complete, copy not replaced', /^Refresh incomplete — using last verified warehouse data for 1 item/.test(fi.body.report.status) && fi.body.report.complete === false && tbl('wc_receipt_versions').length === verBefore, fi.body.report);
  var fn = await call({ action: 'run_report', date_from: '2025-01-01', date_to: '2025-01-31', recheck: false });
  check('a report deliberately saved WITHOUT refreshing is labelled so ("Saved without refreshing …")', /^Saved without refreshing/.test(fn.body.report.status) && fn.body.report.complete === false);
  var fok = await call({ action: 'run_report', date_from: '2025-01-01', date_to: '2025-01-31' });
  check('RECOVERY: the next successful refresh with nothing changed → "Complete — every item decided" again, WITHOUT a new approval', fok.body.report.status === 'Complete — every item decided' && fok.body.report.complete === true && fok.body.rows.length === 0 && tbl('wc_decisions').filter(function (d) { return d.item_key === cItem.item_key; }).length === decBefore, fok.body.report);
  var hFail = await call({ action: 'report', id: fr.body.report.id });
  check('HISTORY kept: the failed-refresh report still says "Refresh failed …"; the earlier complete report is unchanged; "Now" says what data it is based on', /^Refresh failed/.test(hFail.body.report.status_at_run) && tbl('wc_reports').filter(function (r) { return r.id === cr.body.report.id; })[0].status_at_run === 'Complete — every item decided' && /stored warehouse copy, last successful read/.test(hFail.body.current_note || ''), hFail.body.current_note);
  world.floor = '2026-10-07';
  var outW = await call({ action: 'report', id: cr.body.report.id });
  var outL = await call({ action: 'reports' });
  world.floor = null;
  check('a report wholly before the viewer\'s window: opening it by id → "Report not found." (404), and it is not in their history list', outW.status === 404 && !outW.body.report && !outL.body.reports.some(function (r) { return r.id === cr.body.report.id; }), outW.body);
  var html7 = RDS.renderToStaticMarkup(React.createElement(PANEL.default, { bills: [], toast: {}, openDoc: function () {}, onClose: function () {} }));
  check('SCREEN: the report panel carries the refresh-failed banner and the per-row "last verified" note', fs.readFileSync(path.join(root, 'src/components/WeightCheckPanel.jsx'), 'utf8').indexOf('this report is not complete until a refresh succeeds') >= 0 && fs.readFileSync(path.join(root, 'src/components/WeightCheckPanel.jsx'), 'utf8').indexOf('Not refreshed now — last verified ') >= 0 && /Bill date from/.test(html7));

  // ---- tolerance: Max only
  world.perms = Object.assign({}, STAFF, { 'bills.weight_check.settings': 1 });
  var tl = await call({ action: 'tolerance_save', pct: 1, lb: 50 });
  check('the tolerance can only be set by the super admin', tl.status === 403);
  world.superAdmin = true;
  tl = await call({ action: 'tolerance_save', pct: 1, lb: 50, note: 'Max approved' });
  check('…the super admin sets it (version 1)', tl.status === 200 && tl.body.tolerance.version === 1);
  world.superAdmin = false;

  // ---- an incomplete warehouse answer is never stored as evidence
  var before = tbl('wc_receipt_versions').length; world.dropLog = true; world.wh.logs[11][0].weight = '999';
  world.perms = STAFF;
  var inc = await call({ action: 'recheck', bill_id: B1 });
  world.dropLog = false;
  check('an incomplete answer (fewer scan rows than the receipt says) is not stored; the run says incomplete', inc.body.recheck.ok === true && inc.body.recheck.complete === false && tbl('wc_receipt_versions').length === before, inc.body.recheck);
  check('…and the audit trail recorded every recheck, link and decision', tbl('audit').filter(function (a) { return /weight_check_/.test(a.action); }).length >= 12);

  // ---- YX (Max 25 Nov): only NexPac + the vendors Max selects; one card per invoice with PASS / REVIEW
  var BK = 'b0000000-0000-4000-8000-0000000000k1';
  addBill(BK, '2026-10-06', '90000001', [{ description: 'Inbound freight', qty: 1, unit: 'EA' }], { vendor_name: 'Kronos Logistics', bill_number: 'K-77' });
  world.perms = STAFF; world.feed = 'ok';
  var okK = await call({ action: 'bill', bill_id: BK });
  check('SCOPE default = NexPac only: a Kronos bill answers out_of_scope (the box hides itself)', okK.status === 200 && okK.body.out_of_scope === true && okK.body.scope.is_default === true && okK.body.scope.vendor_keys.join() === 'nexpac', okK.body);
  var rcK = await call({ action: 'recheck', bill_id: BK }); var dcK = await call({ action: 'decide', bill_id: BK, item_key: 'x', kind: 'report_issue', reason: 'trying anyway' });
  check('…recheck and decisions on it are refused (409, "not in the warehouse check")', rcK.status === 409 && /not in the warehouse check/.test(rcK.body.error) && dcK.status === 409, [rcK.body, dcK.body]);
  var pvK = await call({ action: 'report_preview', date_from: '2026-10-01', date_to: '2026-10-31', all: true });
  check('…and the lists leave it out (the NexPac bills are still there)', pvK.status === 200 && !pvK.body.rows.some(function (r) { return (r.bill_ids || []).indexOf(BK) >= 0; }) && pvK.body.rows.some(function (r) { return (r.bill_ids || []).indexOf(B1) >= 0; }) && pvK.body.scope.vendor_names.join() === 'NexPac Corporation', pvK.body.scope);
  var svK0 = await call({ action: 'scope_save', vendor_names: ['NexPac Corporation', 'Kronos Logistics'] });
  check('choosing the vendors is for the super admin only (403 for staff, nothing saved)', svK0.status === 403 && tbl('wc_vendor_scope').length === 0);
  world.superAdmin = true;
  var svK = await call({ action: 'scope_save', vendor_names: ['NexPac Corporation', 'Kronos Logistics', 'nexpac corporation'] });
  var stK = await call({ action: 'settings_view' });
  world.superAdmin = false;
  check('the super admin saves NexPac + Kronos → version 1 (duplicates folded), audited; settings show it and offer the vendors with bill counts', svK.status === 200 && svK.body.scope.version === 1 && svK.body.scope.vendor_keys.join() === 'nexpac,kronos logistics' && tbl('audit').some(function (a) { return a.action === 'weight_check_scope_saved'; }) && stK.body.scope.version === 1 && stK.body.vendor_choices.some(function (v) { return v.key === 'kronos logistics' && v.bills === 1; }), [svK.body, stK.body.scope, (stK.body.vendor_choices || []).slice(0, 3)]);
  var okK2 = await call({ action: 'bill', bill_id: BK });
  check('…then the Kronos bill is in the check (no out_of_scope)', okK2.status === 200 && !okK2.body.out_of_scope, okK2.body.out_of_scope);
  world.noScopeTable = true;
  var okK3 = await call({ action: 'bill', bill_id: BK }); var okN3 = await call({ action: 'bill', bill_id: B1 });
  world.noScopeTable = false;
  check('before the YX SQL is run: NexPac only, said plainly (table_missing), the rest of the check still works', okK3.body.out_of_scope === true && okK3.body.scope.table_missing === true && okN3.status === 200 && !okN3.body.out_of_scope, [okK3.body.scope, okN3.status]);
  var INV = require(path.join(root, 'src/components/WeightCheckInvoices.jsx'));
  var pvI = await call({ action: 'report_preview', date_from: '2026-10-01', date_to: '2026-10-31', all: true });
  var invs = INV.groupInvoices(pvI.body.rows);
  var vB1 = invs.filter(function (v) { return v.key.indexOf(B1) >= 0; })[0];
  check('INVOICES: one card per invoice (no row lost), PASS only when every product line is Matched / Equal, else REVIEW with the reasons', invs.length >= 1 && invs.reduce(function (n, v) { return n + v.rows.length; }, 0) === pvI.body.rows.length && invs.every(function (v) { return v.pass === (v.products.length > 0 && v.others.length === 0 && v.products.every(function (r) { return r.outcome === 'matched' || r.outcome === 'equal'; })); }) && vB1 && (vB1.pass || vB1.why.length > 0), invs.map(function (v) { return [v.key.substring(0, 12), v.pass, v.why.slice(0, 2)]; }));
  var fc0 = world.feedCalls; world.perms = { 'accounting.view': 1, 'bills.view': 1, 'bills.weight_check.view': 1 };
  await call({ action: 'report_preview', date_from: '2026-10-01', date_to: '2026-10-31', all: true, recheck: true });
  var fc1 = world.feedCalls; world.perms = STAFF;
  var pvR = await call({ action: 'report_preview', date_from: '2026-10-01', date_to: '2026-10-31', all: true, recheck: true });
  check('"Check against the warehouse": reads the warehouse only with Validate (View-only stays on the stored copy), saves no numbered report', fc1 === fc0 && world.feedCalls > fc1 && !!pvR.body.recheck && pvR.body.freshness && pvR.body.freshness.kind !== 'stored_copy' && !pvR.body.report, [fc0, fc1, world.feedCalls, pvR.body.freshness]);
  var invSrc = fs.readFileSync(path.join(root, 'src/components/WeightCheckInvoices.jsx'), 'utf8');
  check('SCREEN (Invoices): PASS green / REVIEW red badge, Approved + Disputed buttons, a REVIEW needs a written reason to approve, Disputed always needs one', /'PASS', GREEN/.test(invSrc) && /'REVIEW', RED/.test(invSrc) && />Approved</.test(invSrc) && />Disputed</.test(invSrc) && /mode === 'approve' && !inv.pass && reason.length < 5/.test(invSrc) && /mode === 'dispute' && reason.length < 5/.test(invSrc) && /kind: kind, reason: reason, expected_fp: r.comparison_fp/.test(invSrc));

  // Codex 25 Nov follow-ups: (1) two invoices on one receipt = ONE group result, labelled as such, each invoice's own billing shown;
  // (2) NexPac is always in, whatever is saved
  var vG = invs.filter(function (v) { return v.bills.length === 2 && v.key.indexOf(B1) >= 0 && v.key.indexOf(B2) >= 0; })[0];
  var gB1 = vG && vG.perBill.filter(function (b) { return b.id === B1; })[0]; var gB2 = vG && vG.perBill.filter(function (b) { return b.id === B2; })[0];
  check('SHARED RECEIPT: B1 + B2 (one receipt) give ONE card marked shared, with each invoice\'s own billed lines (2,000 and 1,000), never two separate PASS stamps', !!vG && vG.shared === true && invs.filter(function (v) { return v.key.indexOf(B1) >= 0; }).length === 1 && gB1 && gB2 && gB1.lines.length === 1 && Number(gB1.lines[0].qty) === 2000 && Number(gB2.lines[0].qty) === 1000, vG && vG.perBill);
  check('SCREEN (Invoices): a shared card says "group of N invoices" and that the result is for the group, not for each invoice on its own', /group of ' \+ inv\.bills\.length \+ ' invoices'/.test(invSrc) && /is the result for the group, not for each invoice on its own/.test(invSrc) && /part of the group result — not verified on its own/.test(invSrc));
  var BO = 'b0000000-0000-4000-8000-0000000000o1';
  addBill(BO, '2026-10-07', '90000077', [{ description: 'Office paper', qty: 5, unit: 'EA' }], { vendor_name: 'Other Supplies Co', bill_number: 'O-1' });
  world.superAdmin = true;
  var svOnlyK = await call({ action: 'scope_save', vendor_names: ['Kronos Logistics'] });
  world.superAdmin = false;
  var okN4 = await call({ action: 'bill', bill_id: B1 }); var okK4 = await call({ action: 'bill', bill_id: BK }); var okO4 = await call({ action: 'bill', bill_id: BO });
  check('NEXPAC ALWAYS: saving only Kronos keeps NexPac in (saved as nexpac + kronos logistics); NexPac and Kronos bills are checked, an unrelated vendor is not', svOnlyK.status === 200 && svOnlyK.body.scope.vendor_keys.join() === 'nexpac,kronos logistics' && !okN4.body.out_of_scope && !okK4.body.out_of_scope && okO4.body.out_of_scope === true, [svOnlyK.body, okN4.body.out_of_scope, okK4.body.out_of_scope, okO4.body.out_of_scope]);
  tbl('wc_vendor_scope').push({ id: 'legacy', version: 9, vendor_keys: ['kronos logistics'], vendor_names: ['Kronos Logistics'], actor: 'u-max', at: '2026-11-25T00:00:00Z' });
  var okN5 = await call({ action: 'bill', bill_id: B1 });
  check('…even a stored selection without NexPac (version 9: Kronos only) still checks NexPac', !okN5.body.out_of_scope && okN5.status === 200, okN5.body.out_of_scope);
  var panelSrc = fs.readFileSync(path.join(root, 'src/components/WeightCheckPanel.jsx'), 'utf8');
  check('SCREEN (vendors): NexPac shown ticked and locked ("always")', /var always = v\.key === 'nexpac'/.test(panelSrc) && /disabled=\{always\}/.test(panelSrc) && /NexPac always, plus the ones you tick/.test(panelSrc));
  // ---- Max 25 Nov: the comparison is shown STRAIGHT AWAY against the one receipt carrying the bill's reference (a preview);
  // deciding needs the receipt confirmed first; ambiguous references get no preview
  var BPV = 'b0000000-0000-4000-8000-0000000000p1'; var BAM = 'b0000000-0000-4000-8000-0000000000a1';
  world.wh.receipts.push({ id: 15, reference_number: 'P-15', nexpac_bill: null, is_draf: 0, info: {}, supplier: { id: 1, name: 'NexPac' }, warehouse: { id: 2, name: 'CANADA' } });
  world.wh.logs[15] = [{ id: 151, unit: 'W', product_type: 7, cgt: 2, weight: '1100', rolls: '1', pl_weight: '450', is_scan_out: 0 }];
  addBill(BPV, '2026-10-08', 'P-15', [{ description: 'Cambridge Seconds (LBS)', qty: 1000, unit: 'LBS' }]);
  addBill(BAM, '2026-10-08', '90000002', [{ description: 'Cambridge Seconds (LBS)', qty: 700, unit: 'LBS' }]);
  world.perms = STAFF; world.feed = 'ok';
  var pvP = await call({ action: 'report_preview', date_from: '2026-10-01', date_to: '2026-10-31', all: true, recheck: true });
  var rowsP = pvP.body.rows.filter(function (r) { return (r.bill_ids || []).indexOf(BPV) >= 0; });
  var prevP = rowsP.filter(function (r) { return r.preview; });
  check('PREVIEW: an unlinked bill whose reference is on exactly ONE receipt shows its comparison straight away (billed 1,000 / scanned 1,100 / +100)', prevP.length >= 1 && prevP[0].kind === 'product' && prevP[0].figures && prevP[0].figures.billed === 1000 && prevP[0].figures.received === 1100 && prevP[0].figures.diff === 100 && prevP[0].proposed_receipt && String(prevP[0].proposed_receipt.receipt_id) === '15', rowsP.map(function (r) { return [r.kind, r.outcome, r.preview, r.figures]; }));
  check('…but a preview is never decided or counted: needs_decision false, not outstanding, state "awaiting_link"; the bill\'s own "confirm the receipt" line stays outstanding', prevP.every(function (r) { return !r.needs_decision && !r.outstanding && r.state === 'awaiting_link'; }) && rowsP.some(function (r) { return r.needs_link && r.outstanding && r.preview_available; }), rowsP.map(function (r) { return [r.kind, r.state, r.needs_decision, r.outstanding]; }));
  var dP = await call({ action: 'decide', bill_id: BPV, item_key: prevP[0].item_key, kind: 'accept_discrepancy', reason: 'trying to decide a preview', expected_fp: prevP[0].comparison_fp });
  check('…deciding a preview is refused ("Confirm the warehouse receipt first")', dP.status === 409 && /Confirm the warehouse receipt first/.test(dP.body.error), dP.body);
  var rowsA = pvP.body.rows.filter(function (r) { return (r.bill_ids || []).indexOf(BAM) >= 0; });
  check('…an AMBIGUOUS reference (on two receipts) gets NO preview — a person chooses', rowsA.length >= 1 && !rowsA.some(function (r) { return r.preview; }) && rowsA.some(function (r) { return r.needs_link && (r.candidates || []).length === 2; }), rowsA.map(function (r) { return [r.kind, r.preview, (r.candidates || []).length]; }));
  var invP = INV.groupInvoices(pvP.body.rows).filter(function (v) { return v.key === BPV; })[0];
  check('INVOICES: the previewed invoice is one card with its product line, marked previewed, the receipt it matched, and the confirm line is not a REVIEW reason', invP && invP.previewed === true && invP.products.length >= 1 && invP.proposed && String(invP.proposed.receipt_id) === '15' && invP.others.length === 0 && invP.why.every(function (w) { return !/must confirm the link/.test(w); }), invP && [invP.previewed, invP.others.length, invP.why]);
  // what "Approved" does on such a card: confirm the receipt, then decide the real (no longer preview) lines
  var lkP = await call({ action: 'link', bill_id: BPV, receipt_id: '15', basis: prevP[0].proposed_receipt.bases[0], bill_value: prevP[0].proposed_receipt.bill_value, receipt_value: prevP[0].proposed_receipt.receipt_value, state: 'confirmed' });
  var pvP2 = await call({ action: 'report_preview', date_from: '2026-10-01', date_to: '2026-10-31', all: true });
  var realP = pvP2.body.rows.filter(function (r) { return (r.bill_ids || []).indexOf(BPV) >= 0 && r.kind === 'product'; })[0];
  check('…after a person confirms the receipt, the same comparison becomes a real, decidable line (same figures)', lkP.status === 200 && realP && !realP.preview && realP.needs_decision && realP.figures.billed === 1000 && realP.figures.received === 1100, realP);
  var invSrc2 = fs.readFileSync(path.join(root, 'src/components/WeightCheckInvoices.jsx'), 'utf8');
  check('SCREEN (dashboard): readable fields (white background, dark text), tolerance + vendors tiles, map-this-product form, Approved confirms a previewed receipt first', /var FIELD = \{ background: '#ffffff', color: INK/.test(invSrc2) && /<span style=\{LABEL\}>Tolerance<\/span>/.test(invSrc2) && /<span style=\{LABEL\}>Vendors checked<\/span>/.test(invSrc2) && /action: 'map_save'/.test(invSrc2) && /if \(inv\.previewed\) \{ var conf = await confirmPreview\(inv\)/.test(invSrc2) && /action: 'tolerance_save'/.test(invSrc2) && /action: 'scope_save'/.test(invSrc2));
  // ---- the real route with its OWN receipts address + token (another staging sub-site here, so the fake's identity still fits)
  var keep = { u: process.env.NEXTRADE_RECEIPTS_URL, t: process.env.NEXTRADE_RECEIPTS_TOKEN };
  process.env.NEXTRADE_RECEIPTS_URL = 'https://receipts.nextrade-staging.com/api/hub-feed'; process.env.NEXTRADE_RECEIPTS_TOKEN = 'rtok-0123456789abcdef0123456789abcdef';
  world.acceptToken = 'rtok-0123456789abcdef0123456789abcdef'; world.lastToken = null; world.lastFeedHost = null; world.lastFeedPath = null; world.feed = 'ok';
  var own = await call({ action: 'recheck', bill_id: B1 });
  check('the real route uses the receipts address and ITS token (not the shared feed\'s), and asks /api/hub-feed/receipts', own.status === 200 && own.body.recheck && own.body.recheck.ok === true && world.lastFeedHost === 'receipts.nextrade-staging.com' && world.lastToken === 'rtok-0123456789abcdef0123456789abcdef' && world.lastFeedPath === '/api/hub-feed/receipts', [world.lastFeedHost, world.lastFeedPath, own.body.recheck]);
  world.acceptToken = null;
  if (keep.u === undefined) { delete process.env.NEXTRADE_RECEIPTS_URL; } else { process.env.NEXTRADE_RECEIPTS_URL = keep.u; }
  if (keep.t === undefined) { delete process.env.NEXTRADE_RECEIPTS_TOKEN; } else { process.env.NEXTRADE_RECEIPTS_TOKEN = keep.t; }

  module.exports = { pass: pass, fail: failN };
  if (require.main === module) { console.log('\nXB route: ' + pass + ' passed, ' + failN + ' failed'); process.exit(failN ? 1 : 0); }
})().catch(function (e) { console.log('  ✗ FAIL: crashed ' + (e && e.stack)); failN++; module.exports = { pass: pass, fail: failN }; if (require.main === module) { process.exit(1); } });
