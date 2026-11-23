// v55.83-XE — "only privileged can see the warehouse salaries" (Max 21 Nov 2026). RUNS the real company-books route with the
// real permission resolver and the verified-sign-in stand-in, as: super admin, payroll holder, Nextrade staff WITHOUT the switch,
// and an admin WITHOUT the switch. Every answer to a person without the switch is searched (deep JSON) for the salary amounts.
var path = require('path');
var Module = require('module');
var root = path.join(__dirname, '..');
var SUPER = '11111111-1111-4111-8111-111111111111', HOLDER = '22222222-2222-4222-8222-222222222222', STAFF = '33333333-3333-4333-8333-333333333333', ADMIN = '44444444-4444-4444-8444-444444444444';
var ENV = { NEXT_PUBLIC_SUPABASE_URL: 'https://placeholder.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key', SUPABASE_SERVICE_ROLE_KEY: 'service-key', HUB_SUPER_ADMIN_AUTH_USER_IDS: SUPER };
Object.keys(ENV).forEach(function (k) { process.env[k] = ENV[k]; });
require(path.join(root, 'node_modules/sucrase/register'));
var FakeDb = require('./fake-supabase.js').FakeDb;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 600))); }
console.log('XE — payroll / salaries: view (real company-books route)');

var SAL1 = 4321.17, SAL2 = 3987.65, ELEC = 412.5; // the two salary amounts must never reach a person without the switch
var TOK = { 'tok-super': SUPER, 'tok-holder': HOLDER, 'tok-staff': STAFF, 'tok-admin': ADMIN };
var world = { db: null };
function grant(uid, names) { return names.map(function (n, i) { return { id: uid + '-' + i, user_id: uid, module_name: n, has_access: true }; }); }
function fresh() {
  var db = new FakeDb({});
  db.t.users = [{ id: SUPER, role: 'super_admin', active: true }, { id: HOLDER, role: 'team', active: true }, { id: STAFF, role: 'team', active: true }, { id: ADMIN, role: 'admin', active: true }];
  var books = ['company.nextrade.view', 'company.nextrade.manage', 'bills.view', 'accounting.view_totals'];
  db.t.module_permissions = [].concat(grant(HOLDER, books.concat(['payroll.view'])), grant(STAFF, books), grant(ADMIN, books));
  db.t.hub_audit_log = []; db.t.financial_visibility_permissions = [];
  db.t.plaid_accounts = [{ plaid_account_id: 'A1', name: 'Chase', mask: '1234', type: 'depository', wave_business_id: 'NEXTRADE_BOOKS', is_private: false }];
  db.t.company_categories = [
    { id: 'c1', company_id: 'NEXTRADE_BOOKS', key: 'warehouse_staff', label: 'Warehouse staff', kind: 'expense', is_payroll: true, active: true, sort: 1, direction: 'out', makes_ktc_bill: true },
    { id: 'c2', company_id: 'NEXTRADE_BOOKS', key: 'electricity', label: 'Electricity', kind: 'expense', is_payroll: false, active: true, sort: 2, direction: 'out', makes_ktc_bill: null }];
  db.t.bank_transactions = [
    { id: 'P1', wave_business_id: 'NEXTRADE_BOOKS', date: '2026-11-05', amount_abs: SAL1, direction: 'out', account_id: 'A1', name: 'ZELLE TO JOHN DOE', merchant_name: 'John Doe', company_category: 'warehouse_staff' },
    { id: 'P2', wave_business_id: 'NEXTRADE_BOOKS', date: '2026-11-12', amount_abs: SAL2, direction: 'out', account_id: 'A1', name: 'ZELLE TO JANE ROE', merchant_name: 'Jane Roe', company_category: 'warehouse_staff' },
    { id: 'E1', wave_business_id: 'NEXTRADE_BOOKS', date: '2026-11-07', amount_abs: ELEC, direction: 'out', account_id: 'A1', name: 'CENTERPOINT ENERGY', merchant_name: 'CenterPoint', company_category: 'electricity' },
    { id: 'U1', wave_business_id: 'NEXTRADE_BOOKS', date: '2026-11-08', amount_abs: SAL1, direction: 'in', account_id: 'A1', name: 'MONEY FROM KTC', company_category: null }];
  db.t.company_bill_links = [
    { id: 'k1', company_id: 'NEXTRADE_BOOKS', source_bank_transaction_id: 'P1', bill_id: 'B1', mode: 'created', status: 'active', category_key: 'warehouse_staff', updated_at: '2026-11-06' },
    { id: 'k2', company_id: 'NEXTRADE_BOOKS', source_bank_transaction_id: 'E1', bill_id: 'B2', mode: 'created', status: 'active', category_key: 'electricity', updated_at: '2026-11-07' }];
  db.t.vendor_bills = [
    { id: 'B1', vendor_name: 'Warehouse staff (Nextrade payroll)', bill_number: 'NT-P1', bill_date: '2026-11-05', due_date: '2026-11-30', total_amount: SAL1, category: null, record_status: 'active', paid_via: 'NextTrade Industries', notes: 'Created from Nextrade' },
    { id: 'B2', vendor_name: 'NextTrade Industries', bill_number: 'NT-E1', bill_date: '2026-11-07', due_date: '2026-11-30', total_amount: ELEC, category: 'utilities', record_status: 'active', paid_via: 'NextTrade Industries' }];
  db.t.vendor_bill_payments = [{ bill_id: 'B1', amount: 1000, voided: false }];
  db.t.company_category_map = []; db.t.expense_categories = []; db.t.company_rules = [];
  db.rpcs.bank_visibility_profile_for_identity = function (a) { return { data: [{ profile_id: a.p_auth_user_id }], error: null }; };
  db.rpcs.bank_visibility_auth_ids_for_profile = function (a) { return { data: [{ auth_user_id: a.p_profile_id }], error: null }; };
  db.rpcs.hub_company_books_installed = function () { return { data: true, error: null }; };
  db.rpcs.hub_company_transfers_installed = function () { return { data: true, error: null }; };
  db.rpcs.hub_company_categorize = function () { return { data: { ok: true, action: 'none' }, error: null }; };
  world.db = db; return db;
}
fresh();
var authClient = { auth: { getUser: function (tok) { var id = TOK[tok]; return Promise.resolve(id ? { data: { user: { id: id, email_confirmed_at: 'x' } }, error: null } : { data: { user: null }, error: { message: 'bad token' } }); } } };
function createClient(url, key) { if (key === 'anon-key') { return authClient; } return new Proxy({}, { get: function (t, k) { var d = world.db; var v = d[k]; return typeof v === 'function' ? v.bind(d) : v; } }); }
var supaPath = require.resolve('@supabase/supabase-js', { paths: [root] });
require.cache[supaPath] = { id: supaPath, filename: supaPath, loaded: true, exports: { createClient: createClient } };
var origResolve = Module._resolveFilename;
Module._resolveFilename = function (req) { if (req === '@supabase/supabase-js') { return supaPath; } return origResolve.apply(this, arguments); };
var R = require(path.join(root, 'src/app/api/accounting/company-books/route.js'));
function mkReq(token, body) { var h = { origin: 'http://hub.test', 'content-type': 'application/json' }; if (token) { h.authorization = 'Bearer ' + token; } return new Request('http://hub.test/api/accounting/company-books', { method: 'POST', headers: h, body: JSON.stringify(body || {}) }); }
async function call(token, body) { var r = await R.POST(mkReq(token, Object.assign({ company: 'nextrade', from: '2026-11-01', to: '2026-11-30' }, body))); var j = {}; try { j = await r.json(); } catch (e) { j = {}; } return { status: r.status, j: j }; }
// deep search: does the answer carry a salary amount (as a number or inside any text), or a salary name?
function leaks(j) {
  var found = []; var amts = [SAL1, SAL2, Math.round((SAL1 + SAL2) * 100) / 100, Math.round((SAL1 - 1000) * 100) / 100];
  (function walk(v, p) {
    if (v == null) { return; }
    if (typeof v === 'number') { if (amts.some(function (a) { return Math.abs(a - v) < 0.005; })) { found.push(p + '=' + v); } return; }
    if (typeof v === 'string') { if (amts.some(function (a) { return v.indexOf(a.toFixed(2)) >= 0 || v.indexOf(String(a)) >= 0; }) || /john doe|jane roe/i.test(v)) { found.push(p + '="' + v + '"'); } return; }
    if (typeof v === 'object') { Object.keys(v).forEach(function (k) { walk(v[k], p + '.' + k); }); }
  })(j, '$');
  return found;
}
// sums that would reveal payroll by subtraction (money out with payroll = SAL1 + SAL2 + ELEC)
function hasFullOut(j) { var s = JSON.stringify(j); var full = Math.round((SAL1 + SAL2 + ELEC) * 100) / 100; return s.indexOf(String(full)) >= 0; }

(async function () {
  var NOPE = ['tok-staff', 'tok-admin'];
  // ── lines ──
  for (var i = 0; i < NOPE.length; i++) {
    var t = NOPE[i]; var r = await call(t, { action: 'lines' });
    check(t + ' lines: answered 200', r.status === 200 && r.j.ok === true, r);
    var p1 = (r.j.lines || []).filter(function (l) { return l.id === 'P1'; })[0];
    check(t + ' lines: payroll line still listed (date, Warehouse staff, restricted, amount null — not zero)', !!p1 && p1.date === '2026-11-05' && p1.name === 'Warehouse staff' && p1.amount_abs === null && p1.payroll_restricted === true, p1);
    check(t + ' lines: ordinary lines unchanged', (r.j.lines || []).some(function (l) { return l.id === 'E1' && l.amount_abs === ELEC && l.name === 'CENTERPOINT ENERGY'; }));
    check(t + ' lines: the answer says payroll is restricted', /Payroll amount restricted/.test(r.j.payroll_restricted || ''));
    // U1 is an ordinary line whose amount happens to equal a salary — it must stay visible, so exclude it from the search
    var lj = JSON.parse(JSON.stringify(r.j)); lj.lines = lj.lines.filter(function (l) { return l.id !== 'U1'; });
    check(t + ' lines: no salary amount or name anywhere in the answer', leaks(lj).length === 0, leaks(lj));
  }
  var rh = await call('tok-holder', { action: 'lines' }); var rs = await call('tok-super', { action: 'lines' });
  check('holder lines: payroll amount shown (names still "Warehouse staff")', (rh.j.lines || []).some(function (l) { return l.id === 'P1' && l.amount_abs === SAL1 && l.name === 'Warehouse staff' && !l.payroll_restricted; }), rh.j.lines);
  check('super admin lines: payroll amount shown', (rs.j.lines || []).some(function (l) { return l.id === 'P2' && l.amount_abs === SAL2; }));

  // ── totals ──
  var ts = await call('tok-staff', { action: 'totals' });
  check('staff totals: answered, labelled WITHOUT payroll', ts.status === 200 && ts.j.totals && ts.j.totals.excludes_payroll === true, ts);
  check('staff totals: money out = only the non-payroll spending', ts.j.totals && ts.j.totals.outTotal === ELEC, ts.j.totals);
  check('staff totals: payroll row listed with no amounts', ts.j.totals && ts.j.totals.rows.some(function (r) { return r.key === 'warehouse_staff' && r.total === null && r.payroll_restricted === true && Object.keys(r.byMonth).length === 0; }));
  var tsj = JSON.parse(JSON.stringify(ts.j)); tsj.totals.inTotal = 0; tsj.totals.rows = tsj.totals.rows.filter(function (r) { return r.key !== '__none'; }); // U1 money in is not payroll
  check('staff totals: no salary amount, no full money-out total', leaks(tsj).length === 0 && !hasFullOut(ts.j), leaks(tsj));
  var th = await call('tok-holder', { action: 'totals' });
  check('holder totals: full money out, not labelled', th.j.totals && th.j.totals.outTotal === Math.round((SAL1 + SAL2 + ELEC) * 100) / 100 && !th.j.totals.excludes_payroll, th.j.totals);

  // ── KTC Bills → Nextrade bills ──
  for (var k = 0; k < NOPE.length; k++) {
    var nb = await call(NOPE[k], { action: 'nextrade_bills' });
    var rowP = (nb.j.rows || []).filter(function (r) { return r.link.bill_id === 'B1'; })[0];
    check(NOPE[k] + ' nextrade bills: payroll bill listed as Warehouse staff, owed, no amount / paid / notes', !!rowP && rowP.payroll_restricted === true && rowP.bill.total_amount === null && rowP.paid === null && rowP.bill.notes === null && rowP.state === 'owed' && rowP.bill.vendor_name === 'Warehouse staff', rowP);
    check(NOPE[k] + ' nextrade bills: the electricity bill unchanged', (nb.j.rows || []).some(function (r) { return r.link.bill_id === 'B2' && r.bill.total_amount === ELEC; }));
    check(NOPE[k] + ' nextrade bills: "still owed" sum withheld while payroll is hidden', nb.j.can_totals === false && /restricted/.test(nb.j.payroll_restricted || ''), nb.j);
    check(NOPE[k] + ' nextrade bills: no salary amount anywhere', leaks(nb.j).length === 0, leaks(nb.j));
  }
  var nbh = await call('tok-holder', { action: 'nextrade_bills' });
  check('holder nextrade bills: amount and paid shown, still-owed sum allowed', (nbh.j.rows || []).some(function (r) { return r.link.bill_id === 'B1' && r.bill.total_amount === SAL1 && r.paid === 1000; }) && nbh.j.can_totals === true, nbh.j);

  // ── Codex 22 Nov 08:43 P2: the categories cannot be read + a payroll line ATTACHED to a bill with its own vendor name ──
  fresh();
  world.db.t.vendor_bills.push({ id: 'B3', vendor_name: 'Acme Staffing LLC', bill_number: 'ACME-11', bill_date: '2026-11-12', due_date: '2026-11-30', total_amount: SAL2, category: 'labor', record_status: 'active', paid_via: 'NextTrade Industries', notes: 'Jane Roe November' });
  world.db.t.company_bill_links.push({ id: 'k3', company_id: 'NEXTRADE_BOOKS', source_bank_transaction_id: 'P2', bill_id: 'B3', mode: 'attached', status: 'active', category_key: 'warehouse_staff', updated_at: '2026-11-12' });
  var nbOk = await call('tok-staff', { action: 'nextrade_bills' });
  check('attached payroll bill (own vendor name) hidden when categories CAN be read', (nbOk.j.rows || []).some(function (r) { return r.link.bill_id === 'B3' && r.payroll_restricted === true && r.bill.total_amount === null; }) && leaks(nbOk.j).length === 0, leaks(nbOk.j));
  world.db.fail.company_categories = { select: 'connection reset' };
  var FAILERS = ['tok-staff', 'tok-admin', 'tok-holder'];
  for (var fi = 0; fi < FAILERS.length; fi++) {
    var nf = await call(FAILERS[fi], { action: 'nextrade_bills' });
    check(FAILERS[fi] + ' nextrade bills, categories unreadable: refused, no rows, no totals, no salary amount or name', nf.status >= 400 && nf.j.ok === false && !nf.j.rows && nf.j.can_totals === undefined && leaks(nf.j).length === 0 && !/Acme/.test(JSON.stringify(nf.j)), { status: nf.status, j: nf.j });
  }
  delete world.db.fail.company_categories;

  // ── missing bills ──
  world.db.t.company_bill_links = world.db.t.company_bill_links.filter(function (l) { return l.source_bank_transaction_id !== 'P2'; });
  var mbS = await call('tok-staff', { action: 'missing_bills' });
  check('staff missing bills: payroll line listed, amount null', (mbS.j.lines || []).some(function (l) { return l.id === 'P2' && l.amount === null && l.payroll_restricted === true && l.name === 'Warehouse staff'; }) && leaks(mbS.j).length === 0, mbS.j);
  var calls = 0; world.db.rpcs.hub_company_categorize = function () { calls++; return { data: { ok: true, action: 'none' }, error: null }; };
  var mkS = await call('tok-staff', { action: 'make_missing_bills' });
  check('staff make missing bills: payroll lines NOT billed by them, left for a holder', calls === 0 && mkS.j.payroll_left === 1 && /Payroll \/ salaries: view/.test(mkS.j.note || ''), { calls: calls, j: mkS.j });

  // ── declassifying: only the super admin ──
  fresh();
  var dc1 = await call('tok-holder', { action: 'save_category', category: { id: 'c1', label: 'Warehouse staff', kind: 'expense', is_payroll: false } });
  check('holder cannot take the payroll mark off a category (403, unchanged)', dc1.status === 403 && world.db.t.company_categories[0].is_payroll === true, dc1);
  var dc2 = await call('tok-staff', { action: 'save_category', category: { id: 'c1', label: 'Warehouse staff', kind: 'other_expense', is_payroll: true } });
  check('staff cannot change the kind (which drops the mark) either', dc2.status !== 200 && world.db.t.company_categories[0].is_payroll === true, dc2);
  var dc3 = await call('tok-staff', { action: 'save_category', category: { id: 'c1', label: 'Warehouse team', kind: 'expense', is_payroll: true } });
  check('staff may rename it while it stays payroll', dc3.status === 200 && world.db.t.company_categories[0].label === 'Warehouse team' && world.db.t.company_categories[0].is_payroll === true, dc3);
  var dc4 = await call('tok-super', { action: 'save_category', category: { id: 'c1', label: 'Warehouse team', kind: 'expense', is_payroll: false } });
  check('super admin may take the mark off — audited with from / to', dc4.status === 200 && world.db.t.company_categories[0].is_payroll === false && world.db.t.hub_audit_log.some(function (a) { return a.action === 'company_category_edited'; }), dc4);

  fresh();
  var mv1 = await call('tok-holder', { action: 'set_category', ids: ['P1'], category_key: 'electricity' });
  check('holder cannot move a salary line out of payroll (403, unchanged)', mv1.status === 403 && world.db.t.bank_transactions[0].company_category === 'warehouse_staff', mv1);
  var mv2 = await call('tok-staff', { action: 'set_category', ids: ['P1'], category_key: null });
  check('staff cannot un-categorize a salary line either', mv2.status === 403, mv2);
  var mv3 = await call('tok-staff', { action: 'set_category', ids: ['E1'], category_key: 'warehouse_staff', learn: false });
  check('staff MAY move a line INTO payroll (hiding is never blocked); KTC answer carries no amount', mv3.status === 200 && mv3.j.ok === true && leaks(mv3.j).length === 0, mv3);
  var mv4 = await call('tok-super', { action: 'set_category', ids: ['P1'], category_key: 'electricity', learn: false });
  check('super admin passes the payroll check', mv4.status === 200, mv4);

  // ── transfers ──
  fresh();
  var tc1 = await call('tok-staff', { action: 'transfer_candidates', line_id: 'P1' });
  check('a payroll line cannot be offered for pairing', tc1.status === 409, tc1);
  var tc2 = await call('tok-staff', { action: 'transfer_candidates', line_id: 'U1', manual: true });
  check('pairing candidates never include a payroll line', tc2.status === 200 && !(tc2.j.candidates || []).some(function (c) { return c.id === 'P1' || c.id === 'P2'; }), tc2.j);
  var pt = await call('tok-super', { action: 'pair_transfer', a: 'P1', b: 'U1' });
  check('pairing a payroll line refused (even super admin: unmark the category first)', pt.status === 409, pt);

  // ── switch wiring ──
  var SP = require(path.join(root, 'src/lib/server-permissions.js'));
  check('payroll.view is sensitive (never from a role, not even admin / owner)', SP.isSensitivePerm('payroll.view') && !SP.userHasPermission({ role: 'admin', mp: {}, deny: {} }, 'payroll.view') && !SP.userHasPermission({ role: 'owner', mp: {}, deny: {} }, 'payroll.view') && SP.userHasPermission({ role: 'super_admin', isSuperAdmin: true, mp: {}, deny: {} }, 'payroll.view'));
  var fs = require('fs');
  var st = fs.readFileSync(path.join(root, 'src/components/SettingsTab.jsx'), 'utf8'); var bp = fs.readFileSync(path.join(root, 'src/components/BankingAccessPanel.jsx'), 'utf8');
  check('Settings lists the switch and marks it sensitive', /key: 'payroll\.view'/.test(st) && /'payroll\.view': true/.test(st));
  check('Banking & Accounting Access lists it, sensitive', /key: 'payroll\.view'[^\n]*sensitive: true/.test(bp));
  var sc = fs.readFileSync(path.join(root, 'src/components/CompanyBooksTab.jsx'), 'utf8'); var np = fs.readFileSync(path.join(root, 'src/components/NextradeBillsPanel.jsx'), 'utf8');
  check('screens show 🔒 for a restricted amount (never 0.00) and label totals without payroll', /l\.payroll_restricted \?/.test(sc) && /excludes_payroll/.test(sc) && /r\.payroll_restricted \?/.test(np) && /!r\.payroll_restricted && <button/.test(np));

  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
