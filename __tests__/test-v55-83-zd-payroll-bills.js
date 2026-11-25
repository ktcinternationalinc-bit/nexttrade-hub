// v55.83-ZD — "all of the payroll bills (partial match ok) should be all under one grouping and ... should only be displayed to
// superadmin" (Max, 25 Nov 2026). RUNS the real Bills, Wire packages and Nextrade books routes with the real permission resolver and
// verified-sign-in check, against an in-memory database. People: super admin, an ordinary ADMIN and accounting STAFF (both with every
// bills / wires / books switch). Every non-super answer is searched (values AND text) for the payroll bills' ids, vendors and amounts.
var path = require('path'); var Module = require('module');
var root = path.join(__dirname, '..');
var SUPER = '11111111-1111-4111-8111-111111111111', ADMIN = '22222222-2222-4222-8222-222222222222', STAFF = '33333333-3333-4333-8333-333333333333';
var ENV = { NEXT_PUBLIC_SUPABASE_URL: 'https://placeholder.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key', SUPABASE_SERVICE_ROLE_KEY: 'service-key', HUB_SUPER_ADMIN_AUTH_USER_IDS: SUPER };
Object.keys(ENV).forEach(function (k) { process.env[k] = ENV[k]; });
require(path.join(root, 'node_modules/sucrase/register'));
var FakeDb = require('./fake-supabase.js').FakeDb;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 700))); }
console.log('ZD — payroll bills: one group, super admin only (real routes)');

var B1 = 'b1000000-0000-4000-8000-000000000001', B2 = 'b2000000-0000-4000-8000-000000000002', B3 = 'b3000000-0000-4000-8000-000000000003', B4 = 'b4000000-0000-4000-8000-000000000004', B5 = 'b5000000-0000-4000-8000-000000000005';
var P1 = 'f1000000-0000-4000-8000-000000000001', P2 = 'f2000000-0000-4000-8000-000000000002';
var PAY_IDS = [B1, B3, B4, B5, P1]; var PAY_VENDORS = ['ADP Payroll', 'Acme Staffing', 'Warehouse staff (Nextrade payroll)', 'County']; var PAY_AMOUNTS = [4321.17, 777.77, 555.55, 333.33, 5320.67];
var TOK = { 'tok-super': SUPER, 'tok-admin': ADMIN, 'tok-staff': STAFF };
var world = { db: null, failLines: false };
function g(uid, names) { return names.map(function (n, i) { return { id: uid + '-' + i, user_id: uid, module_name: n, has_access: true }; }); }
function bill(id, vendor, amount, extra) { return Object.assign({ id: id, vendor_name: vendor, bill_number: 'N-' + id.substring(0, 2), bill_date: '2026-11-02', due_date: '2026-11-30', currency: 'USD', total_amount: amount, category: 'rent', notes: null, record_status: 'active', created_at: '2026-11-02', attachment_path: null }, extra || {}); }
function fresh() {
  var db = new FakeDb({});
  db.t.users = [{ id: SUPER, role: 'super_admin', active: true, email: 's@x' }, { id: ADMIN, role: 'admin', active: true, email: 'a@x' }, { id: STAFF, role: 'team', active: true, email: 't@x' }];
  var ALLSW = ['accounting.view', 'accounting.clickbooks.access', 'bills.view', 'bills.manage', 'wires.view', 'wires.prepare', 'accounting.view_totals', 'company.nextrade.view'];
  db.t.module_permissions = [].concat(g(ADMIN, ALLSW), g(STAFF, ALLSW));
  db.t.hub_audit_log = []; db.t.financial_visibility_permissions = [];
  db.t.expense_categories = [{ key: 'rent', label: 'Rent' }, { key: 'wages_k', label: 'Payroll taxes' }];
  db.t.company_categories = [{ id: 'c1', company_id: 'NEXTRADE_BOOKS', key: 'warehouse_staff', label: 'Warehouse staff', kind: 'expense', is_payroll: true, active: true, sort: 1 }];
  db.t.vendor_bills = [bill(B1, 'ADP Payroll', 4321.17), bill(B2, 'Acme Supplies', 999.5), bill(B3, 'Acme Staffing', 777.77), bill(B4, 'Warehouse staff (Nextrade payroll)', 555.55, { category: null }), bill(B5, 'County', 333.33, { category: 'wages_k' })];
  db.t.vendor_bill_lines = [{ id: 'l1', bill_id: B1, description: 'Nov', amount: 4321.17 }, { id: 'l2', bill_id: B2, description: 'Paper', amount: 999.5 }, { id: 'l3', bill_id: B3, description: 'PAYROLL for November', amount: 777.77 }];
  db.t.vendor_bill_payments = [{ id: 'pay1', bill_id: B1, amount: 1000, paid_date: '2026-11-05', voided: false }, { id: 'pay2', bill_id: B2, amount: 500, paid_date: '2026-11-05', voided: false }];
  db.t.vendor_bill_events = [{ id: 'e1', bill_id: B1, kind: 'created', details: {} }];
  db.t.company_bill_links = [{ id: 'k1', company_id: 'NEXTRADE_BOOKS', source_bank_transaction_id: 'L1', bill_id: B4, mode: 'created', status: 'active', category_key: 'warehouse_staff', updated_at: '2026-11-03' }];
  db.t.bank_transactions = [{ id: 'L1', date: '2026-11-03', amount_abs: 555.55, name: 'ZELLE JOHN', account_id: 'A1', wave_business_id: 'NEXTRADE_BOOKS', company_category: 'warehouse_staff' }];
  db.t.recurring_bills = [{ id: 'r1', vendor_name: 'Gusto payroll', category: null, amount: 9000 }];
  db.t.wire_packages = [{ id: P1, seq: 1, payee_name: 'Mixed wire', approved_total: 5320.67, status: 'draft', created_at: '2026-11-04' }, { id: P2, seq: 2, payee_name: 'Acme only', approved_total: 999.5, status: 'draft', created_at: '2026-11-04' }];
  db.t.wire_package_lines = [{ id: 'w1', package_id: P1, bill_id: B1, amount: 4321.17, is_open: true }, { id: 'w2', package_id: P1, bill_id: B2, amount: 999.5, is_open: true }, { id: 'w3', package_id: P2, bill_id: B2, amount: 999.5, is_open: true }];
  db.t.wire_package_files = [];
  db.rpcs.bank_visibility_profile_for_identity = function (a) { return { data: [{ profile_id: a.p_auth_user_id }], error: null }; };
  db.rpcs.bank_visibility_auth_ids_for_profile = function (a) { return { data: [{ auth_user_id: a.p_profile_id }], error: null }; };
  var origFrom = db.from.bind(db);
  db.from = function (t) { var q = origFrom(t); if (t === 'vendor_bill_lines' && world.failLines) { q.exec = function () { return { data: null, error: { message: 'connection reset' } }; }; } return q; };
  world.db = db; return db;
}
var authClient = { auth: { getUser: function (tok) { var id = TOK[tok]; return Promise.resolve(id ? { data: { user: { id: id, email_confirmed_at: 'x' } }, error: null } : { data: { user: null }, error: { message: 'bad token' } }); } } };
function createClient(url, key) { if (key === 'anon-key') { return authClient; } return new Proxy({}, { get: function (t, k) { var d = world.db; var v = d[k]; return typeof v === 'function' ? v.bind(d) : v; } }); }
var supaPath = require.resolve('@supabase/supabase-js', { paths: [root] });
require.cache[supaPath] = { id: supaPath, filename: supaPath, loaded: true, exports: { createClient: createClient } };
var origResolve = Module._resolveFilename;
Module._resolveFilename = function (req) { if (req === '@supabase/supabase-js') { return supaPath; } return origResolve.apply(this, arguments); };
var BILLS = require(path.join(root, 'src/app/api/accounting/bills/route.js'));
var WP = require(path.join(root, 'src/app/api/accounting/wire-packages/route.js'));
var CB = require(path.join(root, 'src/app/api/accounting/company-books/route.js'));
var BG = require(path.join(root, 'src/lib/bill-groups.js'));
var NG = require(path.join(root, 'src/lib/nextrade-bill-groups.js'));
var PB = require(path.join(root, 'src/lib/payroll-bills.js'));
function rq(url, token, body) { var h = { origin: 'http://hub.test', 'content-type': 'application/json' }; if (token) { h.authorization = 'Bearer ' + token; } return new Request('http://hub.test' + url, { method: 'POST', headers: h, body: JSON.stringify(body || {}) }); }
async function j(p) { var r = await p; var o = {}; try { o = await r.json(); } catch (e) { o = {}; } return { status: r.status, j: o }; }
function bills(tok, body) { return j(BILLS.POST(rq('/api/accounting/bills', tok, body))); }
function wp(tok, body) { return j(WP.POST(rq('/api/accounting/wire-packages', tok, body))); }
function cb(tok, body) { return j(CB.POST(rq('/api/accounting/company-books', tok, body))); }
function leaks(o) {
  var found = [];
  (function walk(v, p) {
    if (v === null || v === undefined) { return; }
    if (typeof v === 'number') { if (PAY_AMOUNTS.some(function (a) { return Math.abs(a - v) < 0.005; })) { found.push(p + '=' + v); } return; }
    if (typeof v === 'string') { if (PAY_IDS.some(function (x) { return v.indexOf(x) >= 0; }) || PAY_VENDORS.some(function (x) { return v.toLowerCase().indexOf(x.toLowerCase()) >= 0; }) || PAY_AMOUNTS.some(function (a) { return v.indexOf(a.toFixed(2)) >= 0; })) { found.push(p + '="' + v.substring(0, 60) + '"'); } return; }
    if (typeof v === 'object') { Object.keys(v).forEach(function (k) { walk(v[k], p + '.' + k); }); }
  })(o, '$');
  return found;
}

(async function () {
  // ── the rule ──
  var ctx = { catLabels: { rent: 'Rent', wages_k: 'Payroll taxes' }, linesBy: { x3: ['PAYROLL for November'] }, linked: { x4: true } };
  check('rule: "payroll" anywhere in the vendor (any case), category key or label, a line, Warehouse staff, a Nextrade payroll link — each with its reason',
    PB.payrollReasons({ id: 'x1', vendor_name: 'Gusto - payroll' }, ctx).length === 1 && PB.payrollReasons({ id: 'x2', vendor_name: 'County', category: 'payroll_taxes' }, ctx)[0].indexOf('category') === 0 &&
    PB.payrollReasons({ id: 'x5', vendor_name: 'County', category: 'wages_k' }, ctx)[0].indexOf('Payroll taxes') > 0 && PB.payrollReasons({ id: 'x3', vendor_name: 'Acme' }, ctx)[0].indexOf('line') > 0 &&
    PB.payrollReasons({ id: 'x4', vendor_name: 'NextTrade' }, ctx)[0].indexOf('Nextrade') > 0 && PB.payrollReasons({ id: 'x6', vendor_name: 'Acme Supplies', category: 'rent' }, ctx).length === 0);

  // ── Bills list ──
  fresh();
  var sup = await bills('tok-super', { action: 'list' });
  var supIds = ((sup.j.bills || sup.j.rows || []).map(function (b) { return b.id; }));
  check('super admin: every bill, the payroll ones with their reasons', sup.status === 200 && [B1, B2, B3, B4, B5].every(function (x) { return supIds.indexOf(x) >= 0; }) && (sup.j.bills || sup.j.rows).filter(function (b) { return b.payroll_reasons; }).length === 4 && !sup.j.payroll_excluded, { status: sup.status, err: sup.j.error, ids: supIds });
  var groups = BG.groupByVendor(sup.j.bills || sup.j.rows || [], '2026-11-25');
  check('super admin: ONE "Payroll" group first, holding all four payroll bills whatever their vendor; the rest by vendor', groups[0].vendor === 'Payroll' && groups[0].payroll === true && groups[0].count === 4 && groups.slice(1).every(function (x) { return !x.payroll; }), groups.map(function (x) { return x.vendor + ':' + x.count; }));
  var PEOPLE = [['ADMIN', 'tok-admin'], ['STAFF', 'tok-staff']];
  for (var i = 0; i < PEOPLE.length; i++) {
    var r = await bills(PEOPLE[i][1], { action: 'list' });
    var ids = (r.j.bills || r.j.rows || []).map(function (b) { return b.id; });
    check(PEOPLE[i][0] + ': the list has the normal bill only', r.status === 200 && ids.length === 1 && ids[0] === B2, { status: r.status, err: r.j.error, ids: ids });
    check(PEOPLE[i][0] + ': NO payroll id, vendor or amount anywhere in the answer (totals, payments, wires included)', leaks(r.j).length === 0, leaks(r.j).slice(0, 10));
    check(PEOPLE[i][0] + ': totals are the normal bill only, and say "excluding payroll"', r.j.totals && r.j.totals.open === 499.5 && /excluding payroll/.test(r.j.payroll_excluded || ''), { totals: r.j.totals, note: r.j.payroll_excluded });
    var bl = await bills(PEOPLE[i][1], { action: 'bill_lines', id: B1 });
    check(PEOPLE[i][0] + ': asking for a payroll bill by its id → 404 "not found", nothing of it returned', bl.status === 404 && leaks(bl.j).length === 0, bl);
  }
  var blS = await bills('tok-super', { action: 'bill_lines', id: B1 });
  check('super admin: the payroll bill’s lines open', blS.status === 200 && JSON.stringify(blS.j).indexOf('4321.17') >= 0, blS);

  // ── wire packages: the WHOLE package that pays a payroll bill ──
  var wS = await wp('tok-staff', { action: 'list' });
  check('STAFF: the wire package that pays a payroll bill is not listed at all (not even its normal bill line or total)', wS.status === 200 && JSON.stringify(wS.j).indexOf(P1) < 0 && leaks(wS.j).length === 0 && JSON.stringify(wS.j).indexOf(P2) >= 0, { status: wS.status, err: wS.j.error, leaks: leaks(wS.j).slice(0, 6) });
  var wSup = await wp('tok-super', { action: 'list' });
  check('super admin: both wire packages', wSup.status === 200 && JSON.stringify(wSup.j).indexOf(P1) >= 0 && JSON.stringify(wSup.j).indexOf(P2) >= 0, { status: wSup.status, err: wSup.j.error });
  var wGet = await wp('tok-staff', { action: 'get', id: P1 });
  check('STAFF: opening that package by its id → 404', wGet.status === 404, wGet);
  var wAdd = await wp('tok-staff', { action: 'add_bill', package_id: P2, bill_id: B1 });
  check('STAFF: putting a payroll bill on a wire → 404, nothing written', wAdd.status === 404 && world.db.t.wire_package_lines.length === 3, wAdd);

  // ── Nextrade bills ──
  var nS = await cb('tok-staff', { action: 'nextrade_bills' });
  check('STAFF: Nextrade bills has no payroll bill (not even a 🔒 row now — super admin only)', nS.status === 200 && (nS.j.rows || []).length === 0 && leaks(nS.j).length === 0, { status: nS.status, j: nS.j });
  var nSup = await cb('tok-super', { action: 'nextrade_bills' });
  var ng = NG.groupNextradeBills(nSup.j.rows || [], {});
  check('super admin: the Nextrade payroll bill with its reason, in a "Payroll" group first', nSup.status === 200 && (nSup.j.rows || []).length === 1 && (nSup.j.rows[0].payroll_reasons || []).length > 0 && ng[0].label === 'Payroll', { status: nSup.status, rows: nSup.j.rows });

  // ── fails closed ──
  world.failLines = true;
  var fl = await bills('tok-staff', { action: 'list' });
  check('the payroll list cannot be read → nothing shown (503), never the full list', fl.status === 503 && leaks(fl.j).length === 0, fl);
  world.failLines = false;

  // ── the switch is retired ──
  var fs = require('fs');
  var st = fs.readFileSync(path.join(root, 'src/components/SettingsTab.jsx'), 'utf8'); var bp = fs.readFileSync(path.join(root, 'src/components/BankingAccessPanel.jsx'), 'utf8');
  check('"Payroll / salaries: view" is gone from Settings (super admin only now)', !/key: 'payroll\.view'/.test(st) && !/key: 'payroll\.view'/.test(bp));
  var PV = require(path.join(root, 'src/lib/payroll-visibility.js'));
  world.db.t.module_permissions.push({ id: 'pv', user_id: STAFF, module_name: 'payroll.view', has_access: true });
  var ps = await PV.payrollScope(world.db, STAFF, null);
  check('an old "payroll.view" ON row no longer lets anyone but the super admin see payroll', ps.canSee === false);

  console.log('\nZD: ' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
