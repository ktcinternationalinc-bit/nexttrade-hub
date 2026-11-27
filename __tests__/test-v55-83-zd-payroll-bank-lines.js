// v55.83-ZD rev3 — Max, 26 Nov 2026 ("Yes, hide them"): the payroll KTC bank lines, and the payroll in Wave history and the ClickBooks
// ledger, are hidden from anyone WITHOUT P&L access; the super admin and P&L users still see them. RUNS the real bank lines route
// (Plaid GET) and Bank Review write route with the real permission resolver and verified sign-in, the real Wave cash history route
// and the real ClickBooks US read / reports handlers, against in-memory stand-ins.
var path = require('path'); var Module = require('module'); var fs = require('fs');
var root = path.join(__dirname, '..');
var SUPER = '11111111-1111-4111-8111-111111111111', STAFF = '33333333-3333-4333-8333-333333333333', PNLU = '44444444-4444-4444-8444-444444444444', OFFU = '55555555-5555-4555-8555-555555555555';
var ENV = { NEXT_PUBLIC_SUPABASE_URL: 'https://placeholder.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key', SUPABASE_SERVICE_ROLE_KEY: 'service-key', HUB_SUPER_ADMIN_AUTH_USER_IDS: SUPER };
Object.keys(ENV).forEach(function (k) { process.env[k] = ENV[k]; });
require(path.join(root, 'node_modules/sucrase/register'));
var FakeDb = require('./fake-supabase.js').FakeDb;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 700))); }
console.log('ZD rev3 — payroll bank lines, Wave history and ClickBooks ledger: super admin + P&L only');

var KTC = 'QnVzaW5lc3M6a3Rj'; var B1 = 'b1000000-0000-4000-8000-000000000001';
// payroll KTC lines, each for a different reason; N1 is a NextTrade books line (XE's rule, untouched); O1 is ordinary
var PAYLINES = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
var TOK = { 'tok-super': SUPER, 'tok-staff': STAFF, 'tok-pnl': PNLU, 'tok-off': OFFU };
var world = { db: null };
function g(uid, names, on) { return names.map(function (n, i) { return { id: uid + '-' + n + '-' + i, user_id: uid, module_name: n, has_access: on !== false }; }); }
function line(id, extra) { return Object.assign({ id: id, wave_business_id: KTC, date: '2026-11-02', posted_date: '2026-11-02', amount: 1000, amount_abs: 1000, direction: 'out', name: 'ACH DEBIT', merchant_name: null, category: '', hub_category: null, company_category: null, classification: null, wave_category_name: null, account_id: 'A1', review_status: 'unreviewed', pending: false }, extra || {}); }
function fresh() {
  var db = new FakeDb({});
  db.t.users = [{ id: SUPER, role: 'super_admin', active: true }, { id: STAFF, role: 'team', active: true }, { id: PNLU, role: 'team', active: true }, { id: OFFU, role: 'team', active: true }];
  var SW = ['accounting.view', 'bank_transactions.view', 'bank.view_transactions', 'bank.classify', 'payments.match'];
  db.t.module_permissions = [].concat(g(STAFF, SW), g(PNLU, SW.concat(['pnl.view'])), g(OFFU, SW.concat(['pnl.view'])), g(OFFU, ['pnl.view'], false));
  db.t.hub_audit_log = []; db.t.financial_visibility_permissions = [];
  db.t.expense_categories = [{ key: 'rent', label: 'Rent' }, { key: 'staff_k', label: 'Payroll – staff' }];
  db.t.company_categories = [{ id: 'c1', company_id: 'NEXTRADE_BOOKS', key: 'warehouse_staff', label: 'Warehouse staff', kind: 'expense', is_payroll: true, active: true }];
  db.t.vendor_bills = [{ id: B1, vendor_name: 'ADP Payroll', total_amount: 2470.65, category: null, record_status: 'active' }];
  db.t.vendor_bill_lines = []; db.t.vendor_bill_events = []; db.t.company_bill_links = []; db.t.recurring_bills = []; db.t.wire_packages = []; db.t.wire_package_lines = []; db.t.wire_package_files = [];
  db.t.vendor_bill_payments = [{ id: 'vp1', bill_id: B1, bank_transaction_id: 'T7', amount: 2470.65 }];
  db.t.bank_transactions = [
    line('T1', { category: 'Transfer > Payroll', amount_abs: 2959.27 }),
    line('T2', { company_category: 'payroll_taxes', amount_abs: 504.79 }),
    line('T3', { classification: 'payroll', amount_abs: 30.01 }),
    line('T4', { name: 'GUSTO PAYROLL 1234', amount_abs: 629.11 }),
    line('T5', { hub_category: 'staff_k', amount_abs: 352.85 }),
    line('T6', { amount_abs: 311.21 }), // a split says payroll
    line('T7', { amount_abs: 2470.65 }), // pays a payroll bill
    line('N1', { wave_business_id: 'NEXTRADE_BOOKS', company_category: 'warehouse_staff', amount_abs: 4321.17, name: 'ZELLE JOHN' }),
    line('O1', { name: 'CENTERPOINT ENERGY', amount_abs: 412.5, hub_category: 'rent' })
  ];
  db.t.bank_transaction_splits = [{ id: 's1', bank_transaction_id: 'T6', category: 'Payroll', split_amount: 311.21 }, { id: 's2', bank_transaction_id: 'O1', category: 'rent', split_amount: 412.5 }];
  db.t.plaid_accounts = [];
  db.rpcs.bank_visibility_profile_for_identity = function (a) { return { data: [{ profile_id: a.p_auth_user_id }], error: null }; };
  db.rpcs.bank_visibility_auth_ids_for_profile = function (a) { return { data: [{ auth_user_id: a.p_profile_id }], error: null }; };
  world.db = db; return db;
}
var PAY_AMOUNTS = [2959.27, 504.79, 30.01, 629.11, 352.85, 311.21, 2470.65];
function leaks(o) {
  var found = [];
  (function walk(v, p) {
    if (v === null || v === undefined) { return; }
    if (typeof v === 'number') { if (PAY_AMOUNTS.some(function (a) { return Math.abs(a - v) < 0.005; })) { found.push(p + '=' + v); } return; }
    if (typeof v === 'string') { if (PAYLINES.indexOf(v) >= 0 || /payroll/i.test(v) && !/excluding payroll/i.test(v)) { found.push(p + '="' + v.substring(0, 60) + '"'); } return; }
    if (typeof v === 'object') { Object.keys(v).forEach(function (k) { walk(v[k], p + '.' + k); }); }
  })(o, '$');
  return found;
}
var authClient = { auth: { getUser: function (tok) { var id = TOK[tok]; return Promise.resolve(id ? { data: { user: { id: id, email_confirmed_at: 'x' } }, error: null } : { data: { user: null }, error: { message: 'bad token' } }); } } };
function createClient(url, key) { if (key === 'anon-key') { return authClient; } return new Proxy({}, { get: function (t, k) { var d = world.db; var v = d[k]; return typeof v === 'function' ? v.bind(d) : v; } }); }
var supaPath = require.resolve('@supabase/supabase-js', { paths: [root] });
require.cache[supaPath] = { id: supaPath, filename: supaPath, loaded: true, exports: { createClient: createClient } };
var origResolve = Module._resolveFilename;
Module._resolveFilename = function (req) { if (req === '@supabase/supabase-js') { return supaPath; } if (req === 'server-only') { return path.join(__dirname, 'fake-supabase.js'); } return origResolve.apply(this, arguments); };
var PB = require(path.join(root, 'src/lib/payroll-bills.js'));
var PL = require(path.join(root, 'src/lib/payroll-ledger.js'));
var PLAID = require(path.join(root, 'src/app/api/plaid/transactions/route.js'));
var BW = require(path.join(root, 'src/app/api/accounting/bank-write/route.js'));
var CBR = require(path.join(root, 'src/lib/clickbooks-us-read.js'));
var CBREP = require(path.join(root, 'src/lib/clickbooks-us-reports.js'));
function getReq(url, token) { var h = { origin: 'http://hub.test' }; if (token) { h.authorization = 'Bearer ' + token; } return new Request('http://hub.test' + url, { method: 'GET', headers: h }); }
function postReq(url, token, body) { var h = { origin: 'http://hub.test', 'content-type': 'application/json' }; if (token) { h.authorization = 'Bearer ' + token; } return new Request('http://hub.test' + url, { method: 'POST', headers: h, body: JSON.stringify(body || {}) }); }
async function j(p) { var r = await p; var o = {}; try { o = await r.json(); } catch (e) { o = {}; } return { status: r.status, j: o }; }
function ids(list) { return (list || []).map(function (t) { return t.id; }).sort(); }

(async function () {
  // ── the rule ──
  var ctx = { catLabels: { staff_k: 'Payroll – staff' }, payCompanyKeys: { warehouse_staff: true }, splitLines: { S: true }, billLines: { P: true } };
  check('rule: "payroll" (any case, partial) in the name, merchant, bank / Hub / company / Wave category or classification; a Hub label; a payroll company category; a split; a payroll bill payment — each with its reason',
    PB.bankLineReasons({ category: 'Transfer > Payroll' }, ctx)[0].indexOf('bank category') === 0 && PB.bankLineReasons({ company_category: 'payroll_taxes' }, ctx)[0].indexOf('company category') === 0 &&
    PB.bankLineReasons({ hub_category: 'staff_k' }, ctx)[0].indexOf('Payroll – staff') > 0 && PB.bankLineReasons({ company_category: 'warehouse_staff' }, ctx)[0].indexOf('marked payroll') > 0 &&
    PB.bankLineReasons({ id: 'S' }, ctx)[0].indexOf('split') > 0 && PB.bankLineReasons({ id: 'P' }, ctx)[0].indexOf('payroll bill') > 0 &&
    PB.bankLineReasons({ merchant_name: 'Gusto' }, ctx).length === 0 && PB.bankLineReasons({ wave_category_name: 'PAYROLL Expenses' }, ctx).length === 1);
  check('rule: the NextTrade / RTM books lines are not KTC lines (they keep XE\'s rule)', PB.isKtcBankLine({ wave_business_id: KTC }) && !PB.isKtcBankLine({ wave_business_id: 'NEXTRADE_BOOKS' }) && !PB.isKtcBankLine({ wave_business_id: 'RTM_BOOKS' }));

  // ── who may see them ──
  var db = fresh();
  var sStaff = await PB.payrollBillScope(db, STAFF), sPnl = await PB.payrollBillScope(db, PNLU), sSup = await PB.payrollBillScope(db, SUPER), sOff = await PB.payrollBillScope(db, OFFU);
  check('staff without P&L: cannot see payroll lines; every payroll KTC line found (7 reasons), not the NextTrade line, not the ordinary one', sStaff.canSeeLines === false && JSON.stringify(Object.keys(sStaff.lines.ids).sort()) === JSON.stringify(PAYLINES), sStaff.lines);
  check('P&L user and super admin: see payroll lines (nothing to leave out)', sPnl.canSeeLines === true && sSup.canSeeLines === true && Object.keys(sPnl.lines.ids).length === 0);
  check('an explicit OFF row for P&L: View wins over an ON row — cannot see', sOff.canSeeLines === false);
  var dbE = fresh(); var of = dbE.from.bind(dbE); dbE.from = function (t) { var q = of(t); if (t === 'module_permissions') { q.exec = function () { return { data: null, error: { message: 'timeout' } }; }; } return q; };
  var sErr = await PB.payrollBillScope(dbE, PNLU);
  check('a failed permission read = cannot see (fails closed)', sErr.canSeeLines === false);
  var dbB = fresh(); var ofB = dbB.from.bind(dbB); dbB.from = function (t) { var q = ofB(t); if (t === 'bank_transaction_splits') { q.exec = function () { return { data: null, error: { message: 'reset' } }; }; } return q; };
  var sB = await PB.payrollBillScope(dbB, STAFF);
  check('the payroll line list cannot be read → nothing shown (503)', sB.error && sB.status === 503);

  // ── the filtered connection ──
  var fdb = PB.payrollFilteredDb(fresh(), sStaff);
  var r1 = await fdb.from('bank_transactions').select('*');
  check('staff: bank lines read leaves every payroll KTC line out; the NextTrade and ordinary lines stay', JSON.stringify(ids(r1.data)) === JSON.stringify(['N1', 'O1']), ids(r1.data));
  var r2 = await fdb.from('bank_transaction_splits').select('*');
  check('staff: the payroll line\'s splits are left out too', JSON.stringify(ids(r2.data)) === JSON.stringify(['s2']));
  var r3 = await fdb.from('bank_transactions').update({ hub_category: 'staff_k' }).eq('id', 'O1');
  var r3b = await fdb.from('bank_transactions').update({ company_category: 'payroll' }).eq('id', 'O1');
  check('staff: categorizing a line INTO payroll is refused with the reason; nothing saved', r3.error && /P&L access/.test(r3.error.message) && r3b.error && world.db.t.bank_transactions.filter(function (t) { return t.id === 'O1'; })[0].hub_category === 'rent');
  var r4 = await fdb.from('bank_transactions').update({ review_status: 'reviewed' }).eq('id', 'T1').select();
  check('staff: an update aimed at a payroll line reaches nothing', !(r4.data || []).length && world.db.t.bank_transactions.filter(function (t) { return t.id === 'T1'; })[0].review_status === 'unreviewed');
  var r5 = await fdb.from('bank_transaction_splits').insert({ bank_transaction_id: 'O1', category: 'Payroll' });
  var r5b = await fdb.from('bank_transaction_splits').insert({ bank_transaction_id: 'T1', category: 'rent' });
  check('staff: a split saying payroll, or a split on a payroll line, is refused', !!r5.error && !!r5b.error);
  var r6 = await fdb.from('bank_transactions').upsert([{ plaid_transaction_id: 'new1', category: 'Transfer > Payroll', amount: 5 }], { onConflict: 'plaid_transaction_id' });
  check('a new line arriving from the bank is never refused for its values (the bank sync keeps working)', !r6.error);
  var r7 = await fdb.rpc('bank_duplicate_remove', { p_dup: 'T2', p_keep: 'O1' });
  check('staff: a database function naming a payroll line is refused', !!r7.error);
  check('staff: a request naming a payroll line → 404; P&L user / super admin are not stopped', PB.requestNamesPayroll(sStaff, { bank_transaction_id: 'T4' }) === true && PB.requestNamesPayroll(sPnl, { bank_transaction_id: 'T4' }) === false && PB.requestNamesPayroll(sSup, { bank_transaction_id: 'T4' }) === false);
  var pdb = PB.payrollFilteredDb(fresh(), sPnl); var rp = await pdb.from('bank_transactions').select('*');
  var rpu = await pdb.from('bank_transactions').update({ hub_category: 'staff_k' }).eq('id', 'O1');
  check('P&L user: every line, and may categorize into payroll', ids(rp.data).length === 9 && !rpu.error);
  check('fixed note words for everyone who cannot see them; none for the P&L user / super admin', PB.payrollLinesNote(sStaff) === PB.PAYROLL_LINES_NOTE && PB.payrollLinesNote(sOff) === PB.PAYROLL_LINES_NOTE && PB.payrollLinesNote(sPnl) === undefined && PB.payrollLinesNote(sSup) === undefined);

  // ── the real bank lines route ──
  fresh();
  var gS = await j(PLAID.GET(getReq('/api/plaid/transactions', 'tok-staff')));
  check('bank lines list, staff: answered, no payroll KTC line, no payroll amount, says "excluding payroll bank lines"', gS.status === 200 && ids(gS.j.transactions).indexOf('T1') < 0 && ids(gS.j.transactions).indexOf('O1') >= 0 && gS.j.payroll_lines_note === PB.PAYROLL_LINES_NOTE && leaks((gS.j.transactions || []).filter(function (t) { return t.id !== 'N1'; })).length === 0, gS);
  var gP = await j(PLAID.GET(getReq('/api/plaid/transactions', 'tok-pnl')));
  var gU = await j(PLAID.GET(getReq('/api/plaid/transactions', 'tok-super')));
  check('bank lines list, P&L user and super admin: every payroll line, no note', gP.status === 200 && ids(gP.j.transactions).length === 9 && !gP.j.payroll_lines_note && gU.status === 200 && ids(gU.j.transactions).length === 9, { p: gP.status, u: gU.status });
  // ── the real Bank Review write route ──
  fresh();
  var w1 = await j(BW.POST(postReq('/api/accounting/bank-write', 'tok-staff', { action: 'set_status', bank_transaction_id: 'T3', status: 'unreviewed' })));
  check('Bank Review write, staff, naming a payroll line: 404 "not found", nothing changed', w1.status === 404 && world.db.t.bank_transactions.filter(function (t) { return t.id === 'T3'; })[0].review_status === 'unreviewed', w1);

  // ── Wave history (pure + real cash route) ──
  var data = { accounts: [{ account_key: '["","Payroll Gross Pay",1]', account_name: 'Payroll Gross Pay', debit_minor: 500000, credit_minor: 0, rows: 3 }, { account_key: '["","Chase",1]', account_name: 'Chase', debit_minor: 900000, credit_minor: 700000, rows: 10 }, { account_key: '["","Rent",1]', account_name: 'Rent', debit_minor: 100000, credit_minor: 0, rows: 1, mapping: { ktc_category: 'rent' } }, { account_key: '["","Staff",1]', account_name: 'Staff', debit_minor: 1, credit_minor: 0, mapping: { ktc_category: 'payroll' } }],
    entries: [{ account_name: 'Chase', description: 'Payroll run Nov', debit_minor: 0, credit_minor: 500000 }, { account_name: 'Chase', description: 'Rent Nov', debit_minor: 0, credit_minor: 100000 }],
    imports: [{ id: 1, debit_minor: 1500000, credit_minor: 1500000, row_count: 20 }], mapping_history: [{ account_key: '["","Payroll Gross Pay",1]' }] };
  var sc = PL.scrubCashRead(data, [{ account_key: '["","Chase",1]', rows: 2, debit_minor: 0, credit_minor: 500000 }]);
  var chase = sc.data.accounts.filter(function (a) { return a.account_name === 'Chase'; })[0];
  check('cash history: payroll accounts (by name or by mapping) left out; another account shows its totals WITHOUT the payroll rows; payroll rows left out of the list; file totals withheld; labelled',
    sc.data.accounts.length === 2 && chase.credit_minor === 200000 && chase.rows === 8 && sc.data.entries.length === 1 && sc.data.imports[0].debit_minor === null && sc.data.mapping_history.length === 0 && sc.data.payroll_note === PL.PAYROLL_LEDGER_NOTE, sc);
  check('cash history: without the database step\'s payroll totals nothing is shown (never a total that includes payroll)', !!PL.scrubCashRead(data, null).error);
  var wd = PL.scrubWaveHistoryData({ months: ['2026-10'], accounts: [{ account_name: 'Payroll – Salary & Wages', kind: 'expense' }, { account_name: 'Office', kind: 'expense', category: 'Payroll costs' }, { account_name: 'Rent', kind: 'expense' }] });
  check('monthly Wave ledger: payroll accounts (by name or category) left out before the categories are added up; ledger rows saying payroll left out', wd.accounts.length === 1 && PL.scrubWaveEntries([{ account_name: 'Bank', other_accounts: ['Payroll Liabilities'] }, { account_name: 'Bank', description: 'rent' }]).length === 1);
  check('a write by someone without P&L may neither touch a payroll account nor map one INTO payroll', PL.ledgerWriteTouchesPayroll('["","Payroll Liabilities",1]', []) && PL.ledgerWriteTouchesPayroll('rent', ['payroll']) && !PL.ledgerWriteTouchesPayroll('rent', ['rent', null]));
  // real cash route, with the archive grant / RPC stand-ins
  var calls = []; var mayPay = false; var noTotals = false;
  var ws = require(path.join(root, 'src/lib/wave-history-server.js'));
  var cashPath = path.join(root, 'src/app/api/wave-history/cash/route.js');
  var origAuth = ws.authorizeWaveHistory; var origRpc = ws.waveHistoryRpc;
  var wsPath = require.resolve(path.join(root, 'src/lib/wave-history-server.js'));
  require.cache[wsPath].exports = Object.assign({}, ws, {
    authorizeWaveHistory: async function () { return { db: {}, actor: 'actor', mayManage: true, mayViewPayroll: mayPay }; },
    waveHistoryRpc: async function (d, name, args) { calls.push(name); if (name === 'wave_cash_source') { return { file_name: 's.csv', raw_csv: 'Payroll Gross Pay,500' }; } if (name === 'wave_cash_payroll_totals') { return noTotals ? null : [{ account_key: '["","Chase",1]', rows: 2, debit_minor: 0, credit_minor: 500000 }]; } if (name === 'wave_cash_map') { return { ok: true }; } return JSON.parse(JSON.stringify(data)); }
  });
  delete require.cache[require.resolve(cashPath)];
  var CASH = require(cashPath);
  var c1 = await j(CASH.GET(new Request('https://x.invalid/?from=2021-01-01&to=2021-01-31&currency=USD')));
  check('cash history route, without P&L: payroll accounts gone, totals without payroll, labelled', c1.status === 200 && c1.j.accounts.length === 2 && c1.j.payroll_note === PL.PAYROLL_LEDGER_NOTE && calls.indexOf('wave_cash_payroll_totals') >= 0, c1);
  noTotals = true; var c1b = await j(CASH.GET(new Request('https://x.invalid/?from=2021-01-01&to=2021-01-31&currency=USD')));
  check('cash history route, without P&L, database step missing: refused (503), nothing shown', c1b.status === 503 && !c1b.j.accounts);
  var c2 = await CASH.GET(new Request('https://x.invalid/?source=1'));
  check('cash history route, without P&L: the original Wave file (it contains payroll) cannot be downloaded', c2.status === 403);
  var c3 = await j(CASH.POST(new Request('https://x.invalid/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'mapping', account: '["","Payroll Liabilities",1]', kind: 'expense', revision: 0, nextrade: null, ktc: 'rent' }) })));
  var c3b = await j(CASH.POST(new Request('https://x.invalid/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'mapping', account: 'rent', kind: 'expense', revision: 0, nextrade: null, ktc: 'payroll' }) })));
  check('cash history route, without P&L: mapping a payroll account, or mapping INTO payroll, is refused', c3.status === 403 && c3b.status === 403 && calls.indexOf('wave_cash_map') < 0);
  mayPay = true; noTotals = false; calls = [];
  var c4 = await j(CASH.GET(new Request('https://x.invalid/?from=2021-01-01&to=2021-01-31&currency=USD')));
  var c5 = await CASH.GET(new Request('https://x.invalid/?source=1'));
  check('cash history route, super admin / P&L user: everything as before (all accounts, file download)', c4.status === 200 && c4.j.accounts.length === 4 && !c4.j.payroll_note && c5.status === 200 && calls.indexOf('wave_cash_payroll_totals') < 0);
  require.cache[wsPath].exports = ws;
  // authorizeWaveHistory itself: P&L access decided from the Hub person
  var whs = fs.readFileSync(path.join(root, 'src/lib/wave-history-server.js'), 'utf8');
  check('Wave history sign-in: payroll only for the super admin or P&L: View, one Hub person per sign-in, failed reads refuse', /mayViewPayroll = true/.test(whs) && /userHasPermission\(ctx, 'pnl\.view'\)/.test(whs) && /length !== 1\) mayViewPayroll = false/.test(whs));
  var whr = fs.readFileSync(path.join(root, 'src/app/api/wave-history/route.js'), 'utf8');
  check('monthly Wave history: comparison, ledger rows, AI report and category edits all follow the rule', /getWaveHistoryComparison\(db, params, mayViewPayroll\)/.test(whr) && /scrubWaveEntries\(rows\)/.test(whr) && /mayViewInventory, mayViewPayroll\)\)/.test(whr) && /ledgerWriteTouchesPayroll\(account, \[category\]\)/.test(whr));

  // ── ClickBooks US ledger ──
  var cbData = { book: { code: 'KTC_US', currency: 'USD' }, accounts: [{ id: 'a1', code: '6100', name: 'Payroll Gross Pay', type: 'expense', bankSensitive: false }, { id: 'a2', code: '6200', name: 'Rent', type: 'expense', bankSensitive: false }], trialBalanceAvailable: true, trialBalance: [{ code: '6100', name: 'Payroll Gross Pay', debitCents: 0, creditCents: 0 }, { code: '6200', name: 'Rent', debitCents: 10000, creditCents: 0 }] };
  function cbAccess(uid) { var d = fresh(); d.rpcs.clickbooks_us_read = function () { return { data: JSON.parse(JSON.stringify(cbData)), error: null }; }; return { authUserId: uid, profileId: uid, db: d, isVerifiedSuperAdmin: uid === SUPER, canViewFullDashboard: true, canViewBankBalances: true }; }
  var readFor = function (uid) { return j(CBR.createClickbooksReadHandler(async function () { return cbAccess(uid); }, { CLICKBOOKS_US_ENABLED: 'true' })(new Request('http://hub.test/api/x', { method: 'GET' }))); };
  var k1 = await readFor(STAFF), k2 = await readFor(PNLU), k3 = await readFor(SUPER);
  check('ClickBooks accounts + trial balance, staff: payroll accounts left out, labelled', k1.status === 200 && k1.j.data.accounts.length === 1 && k1.j.data.trialBalance.length === 1 && k1.j.data.payroll_note === PL.PAYROLL_LEDGER_NOTE, k1);
  check('ClickBooks accounts + trial balance, P&L user and super admin: everything', k2.j.data.accounts.length === 2 && k3.j.data.trialBalance.length === 2 && !k2.j.data.payroll_note);
  var repData = null;
  function repAccess(uid) { var d = fresh(); d.rpcs.clickbooks_us_report_read = function () { return { data: JSON.parse(JSON.stringify(repData)), error: null }; }; return { authUserId: uid, profileId: uid, db: d, isVerifiedSuperAdmin: uid === SUPER, canViewFullDashboard: true, canViewBankBalances: true }; }
  var repFor = function (uid, report) { return j(CBREP.createReportsHandlers(async function () { return repAccess(uid); }, { CLICKBOOKS_US_ENABLED: 'true', CLICKBOOKS_US_REPORTS_ENABLED: 'true' }).GET(new Request('http://hub.test/api/x?report=' + report + '&from=2026-11-01&to=2026-11-30'))); };
  repData = { rows: [{ account: 'Payroll Gross Pay', debitCents: 0, creditCents: 0 }, { account: 'Rent', debitCents: 10000, creditCents: 0 }], totals: { debitCents: 10000, creditCents: 10000 } };
  var q1 = await repFor(STAFF, 'trial_balance');
  check('ClickBooks report, staff, payroll accounts with no amount: left out, report shown, labelled', q1.status === 200 && q1.j.data.rows.length === 1 && q1.j.payroll_note === PL.PAYROLL_LEDGER_NOTE, q1);
  repData = { rows: [{ account: 'Rent', debitCents: 10000 }], lines: [{ journal: 'J1', lines: [{ account_name: 'Payroll – Salary & Wages', debit_cents: 250000 }] }], totals: { debitCents: 260000 } };
  var q2 = await repFor(STAFF, 'general_ledger');
  check('ClickBooks report, staff, a payroll amount inside: withheld (403, says why), never a total with payroll hidden inside', q2.status === 403 && /payroll/i.test(q2.j.error) && !q2.j.data, q2);
  var q3 = await repFor(PNLU, 'general_ledger'), q4 = await repFor(SUPER, 'general_ledger');
  check('ClickBooks report, P&L user and super admin: the full report', q3.status === 200 && q3.j.data.lines.length === 1 && !q3.j.payroll_note && q4.status === 200);

  // ── Codex 26 Nov HOLD: the two Wave handlers act for the VERIFIED sign-in; no company move of restricted lines ──
  var PT = require(path.join(root, 'src/app/api/wave/push-transaction/route.js'));
  var IC = require(path.join(root, 'src/app/api/wave/import-transaction-csv/route.js'));
  function pushT(tok, body) { return j(PT.POST(postReq('/api/wave/push-transaction', tok, body))); }
  function impC(tok, body) { return j(IC.POST(postReq('/api/wave/import-transaction-csv', tok, body))); }
  fresh(); world.db.t.module_permissions = world.db.t.module_permissions.concat(g(STAFF, ['wave.payments.push']), g(PNLU, ['wave.payments.push']));
  var h1 = await pushT(null, { wave_business_id: KTC, hub_record_id: 'T1', user_id: SUPER, dry_run: true });
  check('Wave push, no sign-in but the super admin\'s user_id in the body: refused (401), the body id is never used', h1.status === 401, h1);
  var h2 = await pushT('tok-staff', { wave_business_id: KTC, hub_record_id: 'T1', user_id: SUPER, dry_run: true });
  check('Wave push, staff signed in claiming to be the super admin: refused (403)', h2.status === 403, h2);
  var h3 = await pushT('tok-staff', { wave_business_id: KTC, hub_record_id: 'T1', dry_run: true });
  check('Wave push, staff (verified) naming a payroll line: 404 not found', h3.status === 404, h3);
  var h4 = await pushT('tok-pnl', { wave_business_id: KTC, hub_record_id: 'T1', dry_run: true });
  check('Wave push, P&L user naming a payroll line: not stopped by the payroll rule (it goes on to the Wave checks)', h4.status !== 404 && h4.status !== 401 && h4.status !== 403, h4);
  var h5 = await impC(null, { wave_business_id: KTC, csv: 'a,b', user_id: SUPER });
  var h6 = await impC('tok-staff', { wave_business_id: KTC, csv: 'a,b', user_id: SUPER });
  var h7 = await impC('tok-staff', { csv: 'a,b' });
  check('Wave CSV import: no sign-in → 401; a different user_id in the body → 403; the verified staff member is the one checked (gets to the form checks)', h5.status === 401 && h6.status === 403 && h7.status === 400 && /wave_business_id/.test(h7.j.error || ''), { h5: h5.status, h6: h6.status, h7: h7 });
  var wsc = fs.readFileSync(path.join(root, 'src/components/WaveSyncCenter.jsx'), 'utf8'), wit = fs.readFileSync(path.join(root, 'src/components/WaveImportTab.jsx'), 'utf8');
  check('the screens send the signed-in person\'s token to both handlers (hubFetch)', /hubFetch\('\/api\/wave\/import-transaction-csv'/.test(wsc) && /hubFetch\('\/api\/wave\/import-transaction-csv'/.test(wit) && (wsc.match(/return hubFetch\(route,/g) || []).length === 2 && !/fetch\('\/api\/wave\/import-transaction-csv'/.test(wsc.replace(/hubFetch\(/g, 'X(')));
  fresh(); world.db.t.plaid_accounts = [{ plaid_account_id: 'A1', wave_business_id: KTC, connection_id: 'C1' }]; world.db.t.bank_connections = [{ id: 'C1', wave_business_id: KTC }];
  var m1 = await j(BW.POST(postReq('/api/accounting/bank-write', 'tok-staff', { action: 'assign_account_silo', plaid_account_id: 'A1', wave_business_id: 'NEXTRADE_BOOKS' })));
  var m2 = await j(BW.POST(postReq('/api/accounting/bank-write', 'tok-staff', { action: 'assign_connection_silo', connection_id: 'C1', wave_business_id: 'NEXTRADE_BOOKS' })));
  var movedAny = world.db.t.bank_transactions.some(function (t) { return t.id !== 'N1' && t.wave_business_id !== KTC; }) || world.db.t.plaid_accounts[0].wave_business_id !== KTC || world.db.t.bank_connections[0].wave_business_id !== KTC;
  check('without P&L: moving a bank account or connection to another company is refused (403, fixed words) and NOTHING moves — no payroll line moved or left behind', m1.status === 403 && m2.status === 403 && /P&L access/.test(m1.j.error) && m1.j.error === m2.j.error && !movedAny, { m1: m1, m2: m2 });
  var m3 = await j(BW.POST(postReq('/api/accounting/bank-write', 'tok-pnl', { action: 'assign_account_silo', plaid_account_id: 'A1', wave_business_id: 'RTM_BOOKS' })));
  check('P&L user: the account moves with EVERY line on it, payroll included', m3.status === 200 && world.db.t.bank_transactions.every(function (t) { return t.wave_business_id === 'RTM_BOOKS'; }), m3);

  // ── wiring + the database step ──
  ['src/app/api/accounting/bank-write/route.js', 'src/app/api/accounting/duplicates/route.js', 'src/app/api/accounting/manual-transaction/route.js', 'src/app/api/plaid/transactions/route.js', 'src/app/api/wave/import-transaction-csv/route.js', 'src/app/api/wave/push-transaction/route.js'].forEach(function (f) {
    var s = fs.readFileSync(path.join(root, f), 'utf8');
    check('wired: ' + f + ' uses the payroll scope and the filtered connection', /payrollBillScope\(/.test(s) && /payrollFilteredDb\(/.test(s) && /^import \{ payrollBillScope/m.test(s));
  });
  var brt = fs.readFileSync(path.join(root, 'src/components/BankReviewTab.jsx'), 'utf8');
  check('Bank Review says "Excluding payroll bank lines" to everyone without P&L (same words whether or not there are any) — only once the database rule is installed (never a false note)',
    /payrollGuard && !isSuperAdmin && modulePerms\['pnl\.view'\] !== true \? <span[^>]*>Excluding payroll bank lines/.test(brt) && /supabase\.rpc\('hub_payroll_lines_guard_installed'\)/.test(brt) && /setPayrollGuard\(!!\(r && r\.data === true\)\)/.test(brt));
  var sql = fs.readFileSync(path.join(root, 'sql/v55-83-ZD-payroll-bank-lines.sql'), 'utf8');
  check('database step: restrictive rule on bank_transactions and bank_transaction_splits (reads + proposed values), KTC lines only, after the bills step, P&L OFF wins, server-only cash totals',
    /CREATE POLICY hub_payroll_lines_pnl_only ON public\.bank_transactions AS RESTRICTIVE FOR ALL TO authenticated/.test(sql) && /CREATE POLICY hub_payroll_lines_pnl_only ON public\.bank_transaction_splits AS RESTRICTIVE FOR ALL TO authenticated/.test(sql) &&
    (sql.match(/WITH CHECK/g) || []).length === 2 && /NOT IN \('NEXTRADE_BOOKS', 'RTM_BOOKS'\)/.test(sql) && /run sql\/v55-83-ZD-payroll-bills\.sql first/.test(sql) && /has_access IS FALSE/.test(sql) &&
    /GRANT EXECUTE ON FUNCTION public\.wave_cash_payroll_totals\(date, date, text\) TO service_role;/.test(sql) && /REVOKE ALL ON FUNCTION public\.wave_cash_payroll_totals\(date, date, text\) FROM public, anon, authenticated;/.test(sql) && !/\bDELETE\b|\bTRUNCATE\b|DROP TABLE/i.test(sql));

  console.log('\nZD rev3: ' + pass + ' passed, ' + failN + ' failed');
  if (failN) { process.exitCode = 1; }
})().catch(function (e) { console.error(e); process.exitCode = 1; });
