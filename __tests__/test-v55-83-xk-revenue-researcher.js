// v55.83-XK — "P&L: See sales & revenue" (Max, 22 Nov 2026: "build a permission that hides revenue too"). RUNS the real routes
// (Profitability, P&L, the permission-switch writer, the Banking & Accounting Access writer) with the REAL permission resolver, the
// real report engine and the real verified-sign-in check, against an in-memory database. Only the data loader is a fixture.
// People: super admin, an ordinary P&L holder, a RESEARCHER (P&L view + edit costs, revenue OFF), an ADMIN researcher, a researcher
// who still has an old "profit & margin" ON row, and a person whose permission read FAILS. Every researcher answer is searched
// (deep, values AND text) for every seeded sale value; costs, pounds, releases and the open tasks must still be there.
var path = require('path'); var Module = require('module');
var root = path.join(__dirname, '..');
var SUPER = '11111111-1111-4111-8111-111111111111', HOLD = '22222222-2222-4222-8222-222222222222', RES = '33333333-3333-4333-8333-333333333333';
var ADMRES = '44444444-4444-4444-8444-444444444444', MARGRES = '55555555-5555-4555-8555-555555555555', CAND = '66666666-6666-4666-8666-666666666666';
var ENV = { NEXT_PUBLIC_SUPABASE_URL: 'https://placeholder.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key', SUPABASE_SERVICE_ROLE_KEY: 'service-key', HUB_SUPER_ADMIN_AUTH_USER_IDS: SUPER };
Object.keys(ENV).forEach(function (k) { process.env[k] = ENV[k]; });
require(path.join(root, 'node_modules/sucrase/register'));
var FakeDb = require('./fake-supabase.js').FakeDb;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 700))); }
console.log('XK — P&L: See sales & revenue (real routes, real resolver)');

// ── the report fixture: three invoices; sale values chosen so they can be searched for ──
var PR = require(path.join(root, 'src/lib/profitability.js'));
var REV = [1234, 12.34, 321.09, 388.5, 7.77, 55.55, 44.44, 199.8, 9.99, 1555.09, 1433.8, 444.05, 1389.36];
var FIXTURE = { date_from: null, date_to: null, windowDays: 90, warehouseOn: false,
  invoices: [
    { id: 'i1', invoice_number: 'INV-1', accounting_customer_id: 'c1', invoice_date: '2026-11-02', record_status: 'active', currency: 'USD', release_number: '1001-1627' },
    { id: 'i2', invoice_number: 'INV-2', accounting_customer_id: 'c1', invoice_date: '2026-11-03', record_status: 'active', currency: 'USD', release_number: '1001-1700' },
    { id: 'i3', invoice_number: 'INV-3', accounting_customer_id: 'c2', invoice_date: '2026-11-04', record_status: 'active', currency: 'USD', release_number: '1001-1800' }],
  items: [
    { id: 'l1', invoice_id: 'i1', description: 'Paper', quantity: 100, unit_price: 12.34 }, { id: 'l1s', invoice_id: 'i1', description: 'FREIGHT COST', quantity: 1, unit_price: 321.09 },
    { id: 'l2', invoice_id: 'i2', description: 'Widget', quantity: 50, unit_price: 7.77 }, { id: 'l2s', invoice_id: 'i2', description: 'FREIGHT COST', quantity: 1, unit_price: 55.55 },
    { id: 'l3', invoice_id: 'i3', description: 'Paper', quantity: 20, unit_price: 9.99 }],
  customerNames: { c1: 'Alpha', c2: 'Beta' },
  terms: [{ invoice_id: 'i1', shipping_terms: 'CNF_SEPARATE' }, { invoice_id: 'i2', shipping_terms: 'CNF_SEPARATE' }, { invoice_id: 'i3', shipping_terms: 'CNF_INCLUDED', basis: 'CNF', embedded_transport: 44.44 }],
  nameUnits: [{ name_key: PR.nameKey('Paper'), unit: 'lb' }], groups: [], groupNames: [],
  bills: [{ id: 'b1', bill_number: 'TR-1', vendor_name: 'Trucker', bill_type: 'trucking', shipment_direction: 'outbound', release_number: '1001-1627', total_amount: 300, record_status: 'active', bill_date: '2026-11-05' },
    { id: 'b2', bill_number: 'TR-2', vendor_name: 'Trucker', bill_type: 'trucking', shipment_direction: 'outbound', release_number: '1001-1700', total_amount: 250, record_status: 'active', bill_date: '2026-11-05' }],
  billLines: [], warehouseRows: [], estimates: [], partEstimates: [], lineReleasePounds: [],
  lineCosts: [{ invoice_item_id: 'l1', cost_per_lb: 4, commission_per_lb: 0 }, { invoice_item_id: 'l3', cost_per_lb: 4, commission_per_lb: 0 }] };

// ── the in-memory database, sign-in and permissions ──
var TOK = { 'tok-super': SUPER, 'tok-hold': HOLD, 'tok-res': RES, 'tok-admres': ADMRES, 'tok-margres': MARGRES, 'tok-cand': CAND };
var world = { db: null, guard: true, failPerms: null };
function g(uid, names, off) { return names.map(function (n, i) { return { id: uid + '-on-' + i, user_id: uid, module_name: n, has_access: true }; }).concat((off || []).map(function (n, i) { return { id: uid + '-off-' + i, user_id: uid, module_name: n, has_access: false }; })); }
function fresh() {
  var db = new FakeDb({});
  db.t.users = [{ id: SUPER, role: 'super_admin', active: true, email: 's@x' }, { id: HOLD, role: 'team', active: true, email: 'h@x' }, { id: RES, role: 'team', active: true, email: 'r@x' },
    { id: ADMRES, role: 'admin', active: true, email: 'a@x' }, { id: MARGRES, role: 'team', active: true, email: 'm@x' }, { id: CAND, role: 'team', active: true, email: 'c@x' }];
  var NAV = ['accounting.view', 'accounting.clickbooks.access'];
  db.t.module_permissions = [].concat(
    g(HOLD, ['pnl.view', 'pnl.edit_costs', 'pnl.view_margin', 'invoices.view', 'accounting.view']),
    g(RES, ['pnl.view', 'pnl.edit_costs'].concat(NAV), ['pnl.view_revenue']),
    g(ADMRES, ['pnl.view', 'pnl.edit_costs'].concat(NAV), ['pnl.view_revenue']),
    g(MARGRES, ['pnl.view', 'pnl.view_margin', 'invoices.view'], ['pnl.view_revenue']),
    g(CAND, ['pnl.view', 'pnl.edit_costs', 'invoices.view', 'payments.match'].concat(NAV)));
  db.t.hub_audit_log = []; db.t.financial_visibility_permissions = []; db.t.product_costs = []; db.t.accounting_invoice_items = [];
  db.t.pl_manual_costs = []; db.t.pl_line_costs = []; db.t.pl_invoice_terms = [{ invoice_id: 'i3', basis: 'CNF', embedded_transport: 44.44 }];
  db.rpcs.bank_visibility_profile_for_identity = function (a) { return { data: [{ profile_id: a.p_auth_user_id }], error: null }; };
  db.rpcs.bank_visibility_auth_ids_for_profile = function (a) { return { data: [{ auth_user_id: a.p_profile_id }], error: null }; };
  db.rpcs.bank_visibility_list_profiles = function () { return { data: db.t.users.map(function (u) { return { profile_id: u.id, auth_user_id: u.id, name: u.email, email: u.email }; }), error: null }; };
  db.rpcs.bank_visibility_set_grant = function (a) { return { data: { can_view_dashboard: a.p_can_view_dashboard === true, can_view_bank_balances: a.p_can_view_bank_balances === true }, error: null }; };
  db.rpcs.hub_revenue_guard_installed = function () { return world.guard ? { data: true, error: null } : { data: null, error: { message: 'function does not exist' } }; };
  // a failed permission read for one person (module_permissions answers with an error for them only)
  var origFrom = db.from.bind(db);
  db.from = function (t) { var q = origFrom(t); if (t === 'module_permissions' && world.failPerms) { var oe = q.eq.bind(q); q.eq = function (k, v) { if (k === 'user_id' && v === world.failPerms) { q.exec = function () { return { data: null, error: { message: 'connection reset' } }; }; } return oe(k, v); }; } return q; };
  world.db = db; return db;
}
var authClient = { auth: { getUser: function (tok) { var id = TOK[tok]; return Promise.resolve(id ? { data: { user: { id: id, email_confirmed_at: 'x' } }, error: null } : { data: { user: null }, error: { message: 'bad token' } }); } } };
function createClient(url, key) { if (key === 'anon-key') { return authClient; } return new Proxy({}, { get: function (t, k) { var d = world.db; var v = d[k]; return typeof v === 'function' ? v.bind(d) : v; } }); }
var supaPath = require.resolve('@supabase/supabase-js', { paths: [root] });
require.cache[supaPath] = { id: supaPath, filename: supaPath, loaded: true, exports: { createClient: createClient } };
var loaderPath = require.resolve(path.join(root, 'src/lib/profitability-load-server.js'));
require.cache[loaderPath] = { id: loaderPath, filename: loaderPath, loaded: true, exports: { loadProfitabilityInput: function () { return Promise.resolve({ input: JSON.parse(JSON.stringify(FIXTURE)), billsNote: null, whNote: null }); } } };
var origResolve = Module._resolveFilename;
Module._resolveFilename = function (req) { if (req === '@supabase/supabase-js') { return supaPath; } return origResolve.apply(this, arguments); };
var PROF = require(path.join(root, 'src/app/api/accounting/profitability/route.js'));
var PNL = require(path.join(root, 'src/app/api/accounting/pnl/route.js'));
var PERM = require(path.join(root, 'src/app/api/admin/permissions/route.js'));
var BV = require(path.join(root, 'src/lib/bank-visibility.js')).createBankVisibilityHandlers(createClient, ENV);
var SP = require(path.join(root, 'src/lib/server-permissions.js'));
var PP = require(path.join(root, 'src/lib/pnl-period.js'));
function req(url, token, body, method) { var h = { origin: 'http://hub.test', 'content-type': 'application/json' }; if (token) { h.authorization = 'Bearer ' + token; } return new Request('http://hub.test' + url, { method: method || 'POST', headers: h, body: JSON.stringify(body || {}) }); }
async function j(p) { var r = await p; var o = {}; try { o = await r.json(); } catch (e) { o = {}; } return { status: r.status, j: o }; }
function prof(tok, body) { return j(PROF.POST(req('/api/accounting/profitability', tok, Object.assign({ date_from: '2026-11-01', date_to: '2026-11-30' }, body)))); }
function pnl(tok, body) { return j(PNL.POST(req('/api/accounting/pnl', tok, Object.assign({ date_from: '2026-11-01', date_to: '2026-11-30' }, body)))); }
function perm(tok, target, name, on) { return j(PERM.POST(req('/api/admin/permissions', tok, { action: 'set', target_user_id: target, module_name: name, has_access: on }))); }
function grant(tok, target, b) { return j(BV.PUT(req('/api/bank-visibility', tok, Object.assign({ profileId: target }, b), 'PUT'))); }

// deep search of VALUES and TEXT for any seeded sale figure; and of KEYS for revenue / profit names
function leaks(o) {
  var found = [];
  (function walk(v, p) {
    if (v === null || v === undefined) { return; }
    if (typeof v === 'number') { if (REV.some(function (a) { return Math.abs(a - v) < 0.005; })) { found.push(p + '=' + v); } return; }
    if (typeof v === 'string') { if (REV.some(function (a) { return v.indexOf(String(a)) >= 0 || v.indexOf(a.toFixed(2)) >= 0; })) { found.push(p + '="' + v.substring(0, 80) + '"'); } return; }
    if (typeof v === 'object') { Object.keys(v).forEach(function (k) { if (v[k] !== null && v[k] !== undefined && /revenue|invoiced|unit_price|price_per|sale_price|avg_price|charged|sold_for|profit|margin/i.test(k) && !/^(goods_price_confirmed|can_see_revenue|can_see_margin|revenue_hidden|revenue_restricted|revenue_note)$/.test(k)) { found.push(p + '.' + k + ' (key)'); } walk(v[k], p + '.' + k); }); }
  })(o, '$');
  return found;
}
function has(o, n) { return JSON.stringify(o).indexOf(String(n)) >= 0; }

(async function () {
  fresh();
  // ── the resolver ──
  var ctxR = await SP.loadUserPermissions(world.db, RES), ctxH = await SP.loadUserPermissions(world.db, HOLD), ctxA = await SP.loadUserPermissions(world.db, ADMRES), ctxM = await SP.loadUserPermissions(world.db, MARGRES);
  check('resolver: a holder with no revenue row has revenue (default ON with P&L: View)', SP.userHasPermission(ctxH, 'pnl.view_revenue') === true);
  check('resolver: researcher keeps P&L view + edit costs only', SP.userHasPermission(ctxR, 'pnl.view') && SP.userHasPermission(ctxR, 'pnl.edit_costs') && !SP.userHasPermission(ctxR, 'pnl.view_revenue'));
  check('resolver: researcher is refused EVERY other accounting switch, even with an ON row (accounting access, ClickBooks, invoices, margin)', ['accounting.view', 'accounting.clickbooks.access', 'invoices.view', 'pnl.view_margin', 'ar.view_invoice_balances', 'bills.view', 'wave.import.run', 'orders.monitor', 'bank.view'].every(function (k) { return !SP.userHasPermission(ctxR, k) && !SP.userHasPermission(ctxM, k); }));
  check('resolver: an ADMIN with revenue OFF is a researcher too (only the super admin bypasses)', !SP.userHasPermission(ctxA, 'pnl.view_revenue') && !SP.userHasPermission(ctxA, 'accounting.view'));
  world.failPerms = HOLD; var ctxF = await SP.loadUserPermissions(world.db, HOLD); world.failPerms = null;
  check('resolver: a FAILED permission read grants nothing (never read as "no OFF row")', !!ctxF.readError && !SP.userHasPermission(ctxF, 'pnl.view') && !SP.userHasPermission(ctxF, 'pnl.view_revenue'));

  // ── Profitability report ──
  var sup = await prof('tok-super', { action: 'report' }); var hold = await prof('tok-hold', { action: 'report' });
  check('super admin: the report has the sale values (the fixture works)', sup.status === 200 && has(sup.j, 1234) && has(sup.j, 321.09), { status: sup.status, err: sup.j.error });
  check('ordinary holder: revenue and profit as before', hold.status === 200 && has(hold.j, 1234) && hold.j.revenue_hidden !== true && (hold.j.cells || []).some(function (c) { return c.goods_profit !== undefined; }), { status: hold.status, err: hold.j.error });
  var marginOff = await prof('tok-cand', { action: 'report' });
  var restrictedCell = (marginOff.j.cells || []).find(function (c) { return c.invoice === 'INV-1'; }) || {};
  check('margin off: actual report answers with costs and transport charges but without goods sales and sale prices', marginOff.status === 200 && marginOff.j.can_see_margin === false && marginOff.j.revenue_hidden !== true && !has(marginOff.j, 1234) && restrictedCell.goods_revenue === undefined && restrictedCell.orig_unit_price === undefined && restrictedCell.invoiced === undefined && restrictedCell.base_cost === 400 && typeof restrictedCell.transport_revenue === 'number', { status: marginOff.status, cell: restrictedCell });
  var RESEARCHERS = [['researcher', 'tok-res'], ['admin researcher', 'tok-admres'], ['researcher with an old margin ON row', 'tok-margres']];
  for (var i = 0; i < RESEARCHERS.length; i++) {
    var r = await prof(RESEARCHERS[i][1], { action: 'report' });
    check(RESEARCHERS[i][0] + ': report answered, marked revenue hidden', r.status === 200 && r.j.revenue_hidden === true && r.j.can_see_revenue === false, { status: r.status, err: r.j.error });
    check(RESEARCHERS[i][0] + ': NO sale value, revenue key or profit / margin key anywhere (values and text)', leaks(r.j).length === 0, leaks(r.j).slice(0, 12));
    var c1 = (r.j.cells || []).filter(function (c) { return c.invoice === 'INV-1'; })[0] || {};
    check(RESEARCHERS[i][0] + ': costs, pounds and releases still there (goods cost 400, trucking 300, 100 lb, release 1001-1627)', c1.base_cost === 400 && c1.trucking_cost === 300 && c1.pounds === 100 && /1627/.test(String(c1.release)), c1);
    var rflag = (r.j.flags || []).filter(function (f) { return f.kind === 'allocation_unresolved_missing_weight' && f.release; })[0];
    var iflag = (r.j.flags || []).filter(function (f) { return f.kind === 'allocation_unresolved_missing_weight' && f.invoice_id; })[0];
    check(RESEARCHERS[i][0] + ': a COST missing-weight warning keeps its amount (250); the CUSTOMER-charge one keeps the task, not the amount', !!rflag && rflag.amount === 250 && !!iflag && iflag.amount === undefined && iflag.revenue_hidden === true, { rflag: rflag, iflag: iflag });
    if (i === 0) {
      var ot = PP.openTasks(r.j.cells || [], false, { revenueHidden: r.j.revenue_hidden === true }); var lf = PP.linesToFix(r.j.cells || [], false, { revenueHidden: r.j.revenue_hidden === true });
      check('researcher: WITHOUT the explicit option the old rule stands (profit missing → no list): nothing is guessed', PP.openTasks(r.j.cells || [], false).hidden === true);
      check('researcher: the open tasks are LISTED (weight, supplier cost, shipping costs), none about the shipping charge, no sale amounts', !ot.hidden && ot.tasks.length > 0 && ot.tasks.some(function (t) { return t.kind === 'pounds'; }) && !ot.tasks.some(function (t) { return t.kind === 'transport_revenue'; }) && ot.tasks.every(function (t) { return t.sold_for === null; }) && leaks(ot).length === 0, ot.tasks.map(function (t) { return t.kind + ':' + t.sold_for; }));
      check('researcher: "lines to fix" listed too, no "shipping charged" or profit-based "not complete" reason', !lf.hidden && lf.rows.length > 0 && !lf.reasons.some(function (x) { return x.key === 'transport_revenue' || x.key === 'other'; }), lf.reasons);
      var hot = PP.openTasks(hold.j.cells || [], false);
      check('holder: the open tasks still include the shipping-charge items and the sale amounts (unchanged)', hot.tasks.some(function (t) { return t.sold_for > 0; }));
    }
  }

  // ── refusals and writes ──
  var cb = await prof('tok-res', { action: 'customer_balances' });
  check('researcher: customer balances refused (403)', cb.status === 403 && leaks(cb.j).length === 0, cb);
  var st = await prof('tok-res', { action: 'set_terms', invoice_id: 'i3', basis: 'CNF', embedded_transport: '' });
  check('researcher: changing the pricing basis / transportation inside the price refused (403) — the existing 44.44 is NOT erased', st.status === 403 && world.db.t.pl_invoice_terms[0].embedded_transport === 44.44, { st: st, row: world.db.t.pl_invoice_terms[0] });
  var mc = await prof('tok-res', { action: 'set_manual_cost', group_id: null, name: 'Paper', cost_per_lb: 4.5, effective_from: '2026-11-01' });
  check('researcher: a COST save still goes through the cost rules (not refused as revenue)', mc.status !== 403 || !/sales & revenue|revenue/i.test(String(mc.j.error || '')), mc);
  var stH = await prof('tok-hold', { action: 'set_terms', invoice_id: 'i3', basis: 'CNF', embedded_transport: '50' });
  check('holder: changing the terms still works', stH.status === 200, stH);
  world.failPerms = HOLD; var fr = await prof('tok-hold', { action: 'report' }); world.failPerms = null;
  check('a failed permission read: the report is refused (nothing shown), never shown in full', fr.status >= 400 && !has(fr.j, 1234), { status: fr.status, j: fr.j });

  // ── P&L ──
  var pS = await pnl('tok-super', { action: 'report' }); var pR = await pnl('tok-res', { action: 'report' });
  check('P&L: super admin has revenue (fixture works)', pS.status === 200 && has(pS.j, 1234), { status: pS.status, err: pS.j.error });
  check('P&L: researcher answered with NO sale value, revenue or profit key', pR.status === 200 && pR.j.revenue_hidden === true && leaks(pR.j).length === 0, { status: pR.status, leaks: leaks(pR.j).slice(0, 10), err: pR.j.error });
  var pM = await pnl('tok-cand', { action: 'report' });
  check('P&L: margin-off cost data also excludes revenue and sale prices', pM.status === 200 && pM.j.revenue_hidden === true && !has(pM.j, 1234) && leaks(pM.j).length === 0, { status: pM.status, err: pM.j.error });
  var switchTypedOff = await perm('tok-super', HOLD, 'pnl.open_typed', false);
  var pOff = await pnl('tok-hold', { action: 'report' });
  var pTypedOff = await pnl('tok-hold', { action: 'report_typed' });
  var profitStillOpens = await prof('tok-hold', { action: 'report' });
  check('Switching off the typed-cost P&L refuses both report modes and keeps Profitability open', switchTypedOff.status === 200 && pOff.status === 403 && pTypedOff.status === 403 && profitStillOpens.status === 200, { saved: switchTypedOff.status, report: pOff.status, typed: pTypedOff.status, profitability: profitStillOpens.status });

  // ── the permission-switch writer ──
  fresh(); world.guard = false;
  var w0 = await perm('tok-super', HOLD, 'pnl.view_revenue', false);
  check('writer: switching revenue OFF is refused until the database step is installed', w0.status === 409 && /v55-83-XK-revenue-researcher\.sql/.test(w0.j.error || ''), w0);
  world.guard = true;
  var w1 = await perm('tok-super', CAND, 'pnl.view_revenue', false);
  check('writer: OFF refused while the person has invoice / payment switches — they are LISTED; nothing written', w1.status === 409 && (w1.j.conflicts || []).indexOf('invoices.view') >= 0 && (w1.j.conflicts || []).indexOf('payments.match') >= 0 && !world.db.t.module_permissions.some(function (r) { return r.user_id === CAND && r.module_name === 'pnl.view_revenue'; }), w1);
  check('writer: the navigation switches (Accounting access, ClickBooks) are NOT listed as conflicts', (w1.j.conflicts || []).indexOf('accounting.view') < 0 && (w1.j.conflicts || []).indexOf('accounting.clickbooks.access') < 0, w1.j.conflicts);
  world.db.t.financial_visibility_permissions.push({ auth_user_id: CAND, can_view_dashboard: false, can_view_bank_balances: true });
  await perm('tok-super', CAND, 'invoices.view', false); await perm('tok-super', CAND, 'payments.match', false);
  var w2 = await perm('tok-super', CAND, 'pnl.view_revenue', false);
  check('writer: a bank-balance grant (other table) is a conflict too', w2.status === 409 && (w2.j.conflicts || []).indexOf('Bank balances') >= 0, w2);
  world.db.t.financial_visibility_permissions = [];
  var w3 = await perm('tok-super', CAND, 'pnl.view_revenue', false);
  check('writer: with no conflicts left, OFF is saved and audited', w3.status === 200 && world.db.t.module_permissions.some(function (r) { return r.user_id === CAND && r.module_name === 'pnl.view_revenue' && r.has_access === false; }) && world.db.t.hub_audit_log.some(function (a) { return a.action === 'permission_changed'; }), w3);
  var w4 = await perm('tok-super', CAND, 'invoices.view', true);
  check('writer: while OFF, an invoice switch cannot be turned ON (409)', w4.status === 409, w4);
  var w5 = await perm('tok-super', CAND, 'pnl.edit_costs', true);
  check('writer: … but P&L: Edit Product Costs can', w5.status === 200, w5);
  var w6 = await perm('tok-super', CAND, 'pnl.view_revenue', true);
  check('writer: switching revenue back ON is always allowed', w6.status === 200, w6);
  var w7 = await perm('tok-hold', CAND, 'pnl.view_revenue', false);
  check('writer: only the super admin changes switches (unchanged)', w7.status === 403, w7);

  // ── the Banking & Accounting Access writer ──
  fresh();
  var b1 = await grant('tok-super', RES, { canViewBankBalances: true });
  check('bank-access writer: bank balances cannot be given to a researcher (409)', b1.status === 409 && /sales & revenue/.test(b1.j.error || ''), b1);
  var b2 = await grant('tok-super', RES, { canViewFullDashboard: true });
  check('bank-access writer: nor the full dashboard', b2.status === 409, b2);
  var b3 = await grant('tok-super', RES, { canViewBankBalances: false });
  check('bank-access writer: taking access away is always allowed', b3.status === 200, b3);
  var b4 = await grant('tok-super', HOLD, { canViewBankBalances: true });
  check('bank-access writer: an ordinary person is unchanged', b4.status === 200, b4);
  world.failPerms = HOLD; var b5 = await grant('tok-super', HOLD, { canViewBankBalances: true }); world.failPerms = null;
  check('bank-access writer: a failed switch read refuses (fails closed)', b5.status === 503, b5);

  console.log('\nXK: ' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
