// v55.83-WZ — Max, 21 Nov 2026: "i don't want any duplicate bills. it needs to be blocked from the get go with messages" (after
// NexPac #14481 was in the Hub twice, one disputed, one in a signed wire). Real helpers, the REAL new route with stubs, the
// rendered panel, the real wire override rule. The database rule itself is run on PGlite separately (_test-tools/pglite/wz-sql-check.mjs).
var path = require('path'); var fs = require('fs'); var Module = require('module');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 900))); }
console.log('WZ — no duplicate bills');
var D = require(path.join(root, 'src/lib/bill-duplicates.js'));
check('one identity: vendor written any way + number with dashes / spaces / case → the same key; another vendor or no number → different / none', D.billNumberKey('NexPac Corporation', '14481') === D.billNumberKey('NEXPAC CORP.', '14-481') && D.billNumberKey('NexPac Corporation', '14481') !== D.billNumberKey('Kronos Logistics', '14481') && D.billNumberKey('NexPac', '') === null && D.billNumberKey('', '1') === null && D.billNumberKey('A & B Inc', 'x1') === D.billNumberKey('A and B', 'X-1'));
function b(id, o) { return Object.assign({ id: id, vendor_name: 'NexPac Corporation', bill_number: '14481', bill_date: '2026-06-02', total_amount: 2831, record_status: 'active', wave_business_id: 'US', bill_type: 'supplier', disputed: false, validation_status: 'validated', created_at: '2026-11-15T00:00:00Z' }, o || {}); }
var bills = [b('old', { created_at: '2026-11-09T00:00:00Z', disputed: true }), b('new'), b('void', { record_status: 'void' }), b('del', { record_status: 'deleted' }), b('other', { vendor_name: 'Kronos', bill_type: 'trucking' }), b('eg', { wave_business_id: 'EG' }), b('cm', { bill_type: 'credit_memo' }), b('x', { bill_number: '9' }), b('y', { bill_number: '9', vendor_name: 'NEXPAC CORP' })];
var gs = D.duplicateGroups(bills, { y: 100 }, { old: { label: 'WP-0008', status: 'draft' } });
var g1 = gs.filter(function (g) { return g.number === '14481'; })[0]; var g2 = gs.filter(function (g) { return g.number === '9'; })[0];
check('GROUPS: only ACTIVE copies of the same vendor + number in the same company; a void / deleted copy, another vendor, another company and a credit memo are not counted', gs.length === 2 && g1 && g1.copies.length === 2 && g1.copies[0].id === 'old' && g1.copies[1].id === 'new', gs);
check('GROUPS: each copy says whether it can be voided — on a wire or with money on it cannot, with the reason', g1.copies[0].can_void === false && /on wire WP-0008/.test(g1.copies[0].why_not) && g1.copies[1].can_void === true && g2.copies.filter(function (c) { return c.id === 'y'; })[0].can_void === false && /money was recorded/.test(g2.copies.filter(function (c) { return c.id === 'y'; })[0].why_not));
var kp = D.keepPlan(g1, 'old');
check('KEEP the disputed copy on the wire → the other copy is voided with "duplicate of … (kept)"; the kept one is untouched and stays disputed', kp.ok && kp.void_ids.length === 1 && kp.void_ids[0] === 'new' && kp.blocked.length === 0 && /duplicate of NexPac Corporation #14481 entered 2026-11-09 \(kept\)/.test(kp.reason) && kp.keep.disputed === true);
var kp2 = D.keepPlan(g1, 'new');
check('KEEP the other copy → the copy on the wire is NOT voided (it must come off the wire first), and the plan says so', kp2.ok && kp2.void_ids.length === 0 && kp2.blocked.length === 1 && /take it off that wire first/.test(kp2.blocked[0].why));
check('no copy picked → refused', D.keepPlan(g1, 'nope').ok === false);
// wires: the real override rule
var W = require(path.join(root, 'src/lib/wire-audit.js'));
var res = { checks: [{ level: 'block', code: 'BILL_DISPUTED', bill_id: 'old', text: 'disputed' }, { level: 'block', code: 'DUP_REF', bill_id: 'old', text: 'dup' }, { level: 'block', code: 'DUP_OTHER_REF', bill_id: 'old', text: 'dup2' }, { level: 'block', code: 'DUP_REF_IN_WIRE', bill_id: 'old', text: 'd3' }, { level: 'block', code: 'DUP_OTHER_REF_IN_WIRE', bill_id: 'old', text: 'd4' }, { level: 'block', code: 'REFERENCE_MISSING', bill_id: 'z', text: 'ref' }, { level: 'warn', code: 'DUP_REF', bill_id: 'q', text: 'other vendor' }] };
var ov = res.checks.map(function (c) { return { check_key: W.checkKey(c), fingerprint: 'H', reason: 'I voided one of them', overridden_by: 'u', overridden_at: 't' }; });
var ap = W.applyOverrides(res, ov, 'H');
check('WIRES: overrides SAVED BEFORE this change no longer count for a disputed bill or a same-vendor duplicate — they stay blocks; the wire cannot pass', ap.checks.filter(function (c) { return /^(BILL_DISPUTED|DUP_REF|DUP_OTHER_REF|DUP_REF_IN_WIRE|DUP_OTHER_REF_IN_WIRE)$/.test(c.code) && c.level === 'block'; }).length === 5 && ap.pass === false && ap.blocks === 5, ap);
check('WIRES: other overridable checks still work (a missing reference can be overridden), and a different vendor with an equal number stays a warning', ap.checks.filter(function (c) { return c.code === 'REFERENCE_MISSING'; })[0].level === 'overridden' && ap.checks.filter(function (c) { return c.code === 'DUP_REF' && c.bill_id === 'q'; })[0].level === 'warn');
check('WIRES: the screen can say why they cannot be overridden', !W.OVERRIDABLE.BILL_DISPUTED && !W.OVERRIDABLE.DUP_REF && /resolved first/.test(W.NOT_OVERRIDABLE_WHY.BILL_DISPUTED) && /void the extra copy/.test(W.NOT_OVERRIDABLE_WHY.DUP_REF) && W.OVERRIDABLE.DUP_RELEASE === 1);

// ── the REAL route
var world = { perms: { 'bills.manage': true }, tables: {} };
function stub(file, exportsObj) { var id = require.resolve(file); var m0 = new Module(id); m0.filename = id; m0.loaded = true; m0.exports = exportsObj; require.cache[id] = m0; }
function chain(table) { var q = { f: [] };
  ['select', 'order', 'limit'].forEach(function (k) { q[k] = function () { return q; }; });
  q.in = function (c, vs) { q.f.push(function (r) { return vs.indexOf(r[c]) >= 0; }); return q; };
  function rows() { return (world.tables[table] || []).filter(function (r) { return q.f.every(function (fn) { return fn(r); }); }); }
  q.range = function (a) { return Promise.resolve({ data: a === 0 ? rows() : [], error: null }); };
  q.then = function (ok, no) { return Promise.resolve({ data: rows(), error: null }).then(ok, no); };
  ['insert', 'update', 'delete', 'upsert'].forEach(function (k) { q[k] = function () { world.writes = (world.writes || 0) + 1; return q; }; });
  return q; }
stub(path.join(root, 'node_modules/next/server.js'), { NextResponse: { json: function (body, init) { return { status: (init && init.status) || 200, body: body }; } } });
stub('@supabase/supabase-js', { createClient: function () { return { from: chain }; } });
stub(path.join(root, 'src/lib/verified-caller.js'), { verifiedCaller: async function () { return world.who || { userId: 'u1' }; } });
stub(path.join(root, 'src/lib/server-permissions.js'), { assertPermission: async function (db, u, key) { return world.perms[key] ? { ok: true, ctx: {} } : { ok: false }; } });
var ROUTE = require(path.join(root, 'src/app/api/accounting/bill-duplicates/route.js'));
function post(body) { return ROUTE.POST({ json: async function () { return body; }, headers: { get: function () { return 'Bearer x'; } } }); }
(async function () {
  world.tables = { vendor_bills: bills, vendor_bill_payments: [{ bill_id: 'y', amount: 100, voided: false }, { bill_id: 'new', amount: 50, voided: true }], wire_package_lines: [{ bill_id: 'old', package_id: 'P8', is_open: true }], wire_packages: [{ id: 'P8', seq: 8, status: 'draft' }] };
  var r = await post({ action: 'list', user_id: 'u1' });
  var rg = (r.body.groups || []).filter(function (g) { return g.number === '14481'; })[0];
  check('ROUTE: lists the pairs with each copy’s money and wire (an undone payment does not count), read only', r.status === 200 && r.body.ok === true && r.body.groups.length === 2 && rg.copies[0].wire && rg.copies[0].wire.label === 'WP-0008' && rg.copies[1].can_void === true && !world.writes, r.body);
  world.perms = {}; var r0 = await post({ action: 'list', user_id: 'u1' });
  check('ROUTE: without "Bills: manage" → refused, nothing listed', r0.status === 403 && !r0.body.groups);
  world.perms = { 'bills.manage': true }; world.who = { error: 'Sign in again.', status: 401 }; var r1 = await post({ action: 'list', user_id: 'u1' });
  check('ROUTE: an unverified caller → refused (the caller comes from the sign-in, not the request)', r1.status === 401 && !r1.body.groups);
  world.who = null;
  // ── the screen
  var React = require('react'); global.React = React; var RS = require('react-dom/server');
  var P = require(path.join(root, 'src/components/DuplicateBillsPanel.jsx')).default;
  var html = RS.renderToStaticMarkup(React.createElement(P, {}));
  check('SCREEN: the panel says what it is (same vendor and bill number; new ones are refused when saved) and starts loading', html.indexOf('Duplicates to resolve') > 0 && html.indexOf('New ones are refused when saved') > 0 && html.indexOf('Loading') > 0);
  var tab = fs.readFileSync(path.join(root, 'src/components/BillsTab.jsx'), 'utf8'); var pnl = fs.readFileSync(path.join(root, 'src/components/DuplicateBillsPanel.jsx'), 'utf8');
  check('WIRING: Bills has the "Duplicates to resolve" button and panel; the panel lists through the new route and voids only through the Bills route’s own void_bill (which refuses paid / wired bills), with the reason, after a confirmation', /import DuplicateBillsPanel from '\.\/DuplicateBillsPanel'/.test(tab) && tab.indexOf("{panel === 'duplicates' && canView && <DuplicateBillsPanel") > 0 && pnl.indexOf("post('/api/accounting/bill-duplicates', { action: 'list'") > 0 && pnl.indexOf("action: 'void_bill', id: vid, reason: plan.reason") > 0 && pnl.indexOf('window.confirm(') > 0 && pnl.indexOf('hubFetch(') > 0 && pnl.indexOf("action: 'delete") < 0 && pnl.indexOf('.delete(') < 0);
  var sql = fs.readFileSync(path.join(root, 'sql/v55-83-WZ-same-number-bills.sql'), 'utf8');
  check('SQL: no comment lines, raises the same HUB_EXACT_DUPLICATE prefix the Bills route already turns into words, keeps the exact rule, nothing deleted', !/^\s*--/m.test(sql) && /RAISE EXCEPTION 'HUB_EXACT_DUPLICATE: Bill #% from %/.test(sql) && /hub_bill_exact_key\(NEW\.vendor_name/.test(sql) && !/\bDELETE\b/i.test(sql));
  var lib = fs.readFileSync(path.join(root, 'src/lib/bill-duplicates.js'), 'utf8'); var rt = fs.readFileSync(path.join(root, 'src/app/api/accounting/bill-duplicates/route.js'), 'utf8');
  check('style: no backticks, arrow functions, let / const in the helper and the route', [lib, rt].every(function (s) { return s.indexOf(String.fromCharCode(96)) < 0 && !/=>/.test(s) && !/\b(let|const)\s/.test(s); }));
  console.log('\nWZ: ' + pass + ' passed, ' + failN + ' failed');
  if (failN) { process.exit(1); }
})().catch(function (err) { console.log('  ✗ FAIL: threw ' + ((err && err.stack) || err)); process.exit(1); });
