// v55.83-YD — the REAL /api/accounting/vendor-credits route and the REAL bills / wire-packages open-balance code with an in-memory
// database (the database functions are stand-ins that record their calls; their rules are tested for real in
// __tests__/sql-v55-83-yd-vendor-credits.mjs). Fabricated fixtures only.
var path = require('path');
var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var FakeDb = require('./fake-supabase.js').FakeDb;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 800))); }
console.log('YD — vendor credits: the real route, bills list and wire candidates');

var state = { db: null, perms: {}, sup: false, floor: null, priv: {} };
function stub(rel, exportsObj) { var p = require.resolve(path.join(root, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj }; }
stub('src/lib/verified-caller.js', { verifiedCaller: function () { return Promise.resolve({ userId: 'u1' }); } });
stub('src/lib/server-permissions.js', {
  assertPermission: function (db, uid, perm) { return Promise.resolve(state.sup || state.perms[perm] ? { ok: true, ctx: { isSuperAdmin: state.sup, mp: {}, deny: {} } } : { ok: false, error: 'no' }); },
  loadUserPermissions: function () { return Promise.resolve({ isSuperAdmin: state.sup, mp: {}, deny: {} }); },
  userHasPermission: function () { return true; }, SENSITIVE_PERMS: {},
});
stub('src/lib/visibility-window-server.js', { windowFloorFor: function () { return Promise.resolve({ floor: state.floor }); }, clampFrom: function (d, f) { return !f ? (d || null) : (!d || d < f ? f : d); } });
stub('src/lib/private-accounts-server.js', { privateScope: function () { return Promise.resolve({ all: state.sup, priv: state.priv }); }, isPrivateRow: function (row, sc) { return !!(row && state.priv[row.account_id]) && !sc.all; } });
var supa = require.resolve('@supabase/supabase-js', { paths: [root] });
require.cache[supa] = { id: supa, filename: supa, loaded: true, exports: { createClient: function () { return state.db; } } };
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test'; process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
var US = require(path.join(root, 'src/lib/business-of.js')).US_WAVE_BUSINESS_ID;
var R = require(path.join(root, 'src/app/api/accounting/vendor-credits/route.js'));
function call(body) { return R.POST(new Request('http://x/api', { method: 'POST', body: JSON.stringify(Object.assign({ user_id: 'u1' }, body)), headers: { 'content-type': 'application/json' } })).then(function (r) { return r.json().then(function (j) { j._status = r.status; return j; }); }); }

function world(installed) {
  var db = new FakeDb({}); db.calls = [];
  db.t.vendor_bills = [
    { id: 'b1', wave_business_id: US, vendor_name: 'Kronos Logistics, LLC', bill_number: 'K-1', bill_date: '2026-10-01', currency: 'USD', total_amount: 1000, record_status: 'active', disputed: false },
    { id: 'b2', wave_business_id: US, vendor_name: 'KRONOS LOGISTICS', bill_number: 'K-2', bill_date: '2026-10-03', currency: 'USD', total_amount: 500, record_status: 'active', disputed: false },
    { id: 'b3', wave_business_id: US, vendor_name: 'AMB Trucking', bill_number: 'A-1', bill_date: '2026-10-02', currency: 'USD', total_amount: 300, record_status: 'active', disputed: false },
    { id: 'b4', wave_business_id: US, vendor_name: 'Kronos Logistics', bill_number: 'K-0', bill_date: '2026-01-02', currency: 'USD', total_amount: 50, record_status: 'active', disputed: false },
    { id: 'b5', wave_business_id: US, vendor_name: 'Kronos Logistics', bill_number: 'K-PAID', bill_date: '2026-10-04', currency: 'USD', total_amount: 80, record_status: 'active', disputed: false }];
  db.t.vendor_bill_payments = [{ id: 'p1', bill_id: 'b1', amount: 100, voided: false }, { id: 'p2', bill_id: 'b5', amount: 80, voided: false }];
  db.t.wire_package_lines = [{ id: 'w1', package_id: 'pk1', bill_id: 'b1', amount: 200, is_open: true }];
  db.t.vendor_credits = installed ? [
    { id: 'c1', wave_business_id: US, vendor_name: 'Kronos Logistics Inc', credit_number: 'CM-1', credit_date: '2026-10-05', currency: 'USD', total_amount: 600, reason: 'overcharge', record_status: 'active' },
    { id: 'c2', wave_business_id: US, vendor_name: 'Warehouse staff', credit_number: 'PAY-1', credit_date: '2026-10-05', currency: 'USD', total_amount: 40, reason: 'payroll', record_status: 'active' },
    { id: 'c3', wave_business_id: US, vendor_name: 'Kronos Logistics', credit_number: 'CM-OLD', credit_date: '2026-02-01', currency: 'USD', total_amount: 10, reason: 'old', record_status: 'active' }] : [];
  db.t.vendor_credit_applications = installed ? [{ id: 'a1', credit_id: 'c1', kind: 'bill', bill_id: 'b1', amount: 150, applied_date: '2026-10-06', voided: false }, { id: 'a0', credit_id: 'c1', kind: 'bill', bill_id: 'b2', amount: 999, applied_date: '2026-10-06', voided: true, void_reason: 'wrong' }] : [];
  db.t.bank_transactions = [{ id: 'L1', wave_business_id: US, direction: 'in', pending: false, review_status: 'unreviewed', amount_abs: 100, date: '2026-10-20', name: 'KRONOS REFUND', account_id: 'A1', iso_currency: 'USD' },
    { id: 'L2', wave_business_id: US, direction: 'in', pending: false, review_status: 'unreviewed', amount_abs: 90, date: '2026-10-21', name: 'PRIVATE IN', account_id: 'APRIV', iso_currency: 'USD' },
    { id: 'L3', wave_business_id: US, direction: 'in', pending: false, review_status: 'unreviewed', amount_abs: 5000, date: '2026-10-21', name: 'TOO BIG', account_id: 'A1', iso_currency: 'USD' }];
  db.t.accounting_invoice_payments = []; db.t.party_money_entries = []; db.t.app_settings = []; db.t.wire_packages = [{ id: 'pk1', seq: 7, status: 'approved' }];
  db.rpcs.hub_vendor_credits_installed = function () { return { data: installed === true, error: null }; };
  ['hub_vendor_credit_create', 'hub_vendor_credit_apply', 'hub_vendor_credit_unapply', 'hub_vendor_credit_void', 'hub_vendor_credit_refund'].forEach(function (fn) {
    db.rpcs[fn] = function (a, dbx) { dbx.calls.push([fn, a.p]); if (a.p && a.p.amount === 999999) { return { data: null, error: { message: 'P0001 HUB_GUARD: this bill only has $0.00 left to credit' } }; } return { data: { ok: true, action: fn }, error: null }; };
  });
  state.db = db; return db;
}

(async function () {
  // ── before the database step ──
  world(false); state.perms = { 'accounting.view': true, 'bills.view': true, 'bills.manage': true }; state.sup = false; state.floor = null; state.priv = {};
  var l0 = await call({ action: 'list' });
  check('before the database step: the list says the step is needed and shows nothing', l0.ok === true && l0.installed === false && /sql\/v55-83-YD-vendor-credits\.sql/.test(l0.sql_missing) && l0.credits.length === 0, l0);
  var w0 = await call({ action: 'create', vendor_name: 'X', credit_number: '1', credit_date: '2026-10-01', amount: 5, reason: 'abc', request_id: 'r0' });
  check('… and every write answers 409, nothing called', w0._status === 409 && state.db.calls.length === 0, w0);

  // ── permissions ──
  world(true); state.perms = { 'accounting.view': true };
  check('no "Bills: view" → 403', (await call({ action: 'list' }))._status === 403);
  state.perms = { 'accounting.view': true, 'bills.view': true };
  var l1 = await call({ action: 'list' });
  check('"Bills: view" can list (can_manage false)', l1.ok === true && l1.can_manage === false, l1);
  var w1 = await call({ action: 'apply', credit_id: 'c1', bills: [{ bill_id: 'b2', amount: 10 }], request_id: 'r1' });
  check('… but cannot record / apply (403, nothing called)', w1._status === 403 && state.db.calls.length === 0, w1);
  state.perms = { 'accounting.view': true, 'bills.view': true, 'bills.manage': true };

  // ── list ──
  var l2 = await call({ action: 'list' }); var c1 = (l2.credits || []).filter(function (c) { return c.id === 'c1'; })[0];
  check('list: CM-1 600, applied 150 (the voided 999 does not count), left 450; the undone use is still shown, struck', !!c1 && c1.total === 600 && c1.applied === 150 && c1.left === 450 && c1.uses.length === 2 && c1.uses.some(function (u) { return u.voided && u.void_reason === 'wrong'; }), c1);
  check('a payroll vendor\'s credit is hidden from someone without the payroll switch', !(l2.credits || []).some(function (c) { return c.id === 'c2'; }));
  check('no card total without "See money totals"', l2.totals === null);
  state.floor = '2026-06-01';
  var l3 = await call({ action: 'list' });
  check('history window: a credit dated before the window is not listed', !(l3.credits || []).some(function (c) { return c.id === 'c3'; }) && (l3.credits || []).some(function (c) { return c.id === 'c1'; }) && l3.window_from === '2026-06-01');
  var bf = await call({ action: 'bills_for', credit_id: 'c1' }); var bf1 = (bf.bills || []).filter(function (b) { return b.id === 'b1'; })[0];
  check('bills_for: only Kronos bills (any spelling), inside the window, with something still owed (the fully paid one and AMB left out)', bf.ok && bf.bills.map(function (b) { return b.id; }).sort().join() === 'b1,b2', bf);
  check('… K-1 owes 1,000 − paid 100 − on a wire 200 − credited 150 = 550', !!bf1 && bf1.owed === 550 && bf1.on_wires === 200 && bf1.credited === 150, bf1);
  var cOld = await call({ action: 'bills_for', credit_id: 'c3' });
  check('a credit outside the window cannot be opened (404)', cOld._status === 404);
  state.floor = null;

  // ── writes go to ONE database function each, with the verified actor ──
  var cr = await call({ action: 'create', vendor_name: ' Kronos ', credit_number: 'CM-9', credit_date: '2026-10-07', amount: '120.456', currency: 'usd', reason: 'damaged pallets', request_id: 'r-c' });
  var crc = state.db.calls.filter(function (c) { return c[0] === 'hub_vendor_credit_create'; })[0];
  check('create: one database call, amount in cents, currency upper-case, the verified person, the click id', cr.ok && crc && crc[1].amount === 120.46 && crc[1].currency === 'USD' && crc[1].actor === 'u1' && crc[1].request_id === 'r-c' && crc[1].wave_business_id === US, [cr, crc]);
  var bads = [[{ amount: 0 }, /above zero/], [{ reason: 'x' }, /few words/], [{ credit_date: '' }, /date/], [{ credit_number: '' }, /number/], [{ vendor_name: 'Warehouse staff' }, /Payroll/]];
  var badOk = true; for (var i = 0; i < bads.length; i++) { var rb = await call(Object.assign({ action: 'create', vendor_name: 'K', credit_number: 'N', credit_date: '2026-10-07', amount: 5, reason: 'abc', request_id: 'rb' + i }, bads[i][0])); if (rb.ok || !bads[i][1].test(rb.error || '')) { badOk = false; console.log('    ', JSON.stringify(rb).substring(0, 200)); } }
  check('create refuses: zero amount, no reason, no date, no number, a payroll vendor without the switch — nothing called', badOk && state.db.calls.filter(function (c) { return c[0] === 'hub_vendor_credit_create'; }).length === 1);
  state.db.calls = [];
  var ap = await call({ action: 'apply', credit_id: 'c1', bills: [{ bill_id: 'b1', amount: 100 }, { bill_id: 'b2', amount: 50.004 }], request_id: 'r-a' });
  var apc = state.db.calls.filter(function (c) { return c[0] === 'hub_vendor_credit_apply'; });
  check('apply to two bills: one database step PER bill, each with its own click id (r-a:b1, r-a:b2), amounts in cents', ap.ok && apc.length === 2 && apc[0][1].request_id === 'r-a:b1' && apc[1][1].amount === 50 && apc[1][1].actor === 'u1', [ap, apc]);
  state.db.calls = [];
  var ap2 = await call({ action: 'apply', credit_id: 'c1', bills: [{ bill_id: 'b1', amount: 10 }, { bill_id: 'b2', amount: 999999 }], request_id: 'r-b' });
  check('a refusal on the 2nd bill is said plainly, and the 1st stays credited (said too)', ap2._status === 409 && /only has \$0\.00 left/.test(ap2.error) && /1 bill\(s\) before it were already credited/.test(ap2.error), ap2);
  var dupB = await call({ action: 'apply', credit_id: 'c1', bills: [{ bill_id: 'b1', amount: 1 }, { bill_id: 'b1', amount: 1 }], request_id: 'r-d' });
  check('the same bill twice in one apply is refused', dupB._status === 400 && /Each bill once/.test(dupB.error));
  var other = await call({ action: 'apply', credit_id: 'c2', bills: [{ bill_id: 'b1', amount: 1 }], request_id: 'r-e' });
  check('a hidden (payroll) credit cannot be applied by someone without the switch (404)', other._status === 404);
  state.db.calls = [];
  var un = await call({ action: 'unapply', application_id: 'a1', reason: 'wrong bill' });
  check('undo: one database call with the reason and the verified person', un.ok && state.db.calls.length === 1 && state.db.calls[0][1].reason === 'wrong bill' && state.db.calls[0][1].actor === 'u1', un);
  check('undo without a reason is refused', (await call({ action: 'unapply', application_id: 'a1', reason: '' }))._status === 400);

  // ── refunds ──
  state.priv = { APRIV: true };
  var rc = await call({ action: 'refund_candidates', credit_id: 'c1' });
  check('refund candidates: money-in lines since the credit, not bigger than what is left (450), private accounts hidden', rc.ok && rc.lines.map(function (l) { return l.id; }).join() === 'L1' && rc.credit_left === 450, rc);
  state.db.calls = [];
  var rp = await call({ action: 'refund', credit_id: 'c1', bank_transaction_id: 'APRIV-line', request_id: 'r-r' });
  check('a refund on a line that does not exist / is private is refused before the database', rp._status === 404 && state.db.calls.length === 0);
  var rp2 = await call({ action: 'refund', credit_id: 'c1', bank_transaction_id: 'L2', request_id: 'r-r2' });
  check('… a private account\'s line too (404)', rp2._status === 404 && state.db.calls.length === 0);
  var rp3 = await call({ action: 'refund', credit_id: 'c1', bank_transaction_id: 'L1', request_id: 'r-r3' });
  check('refund on a visible money-in line: one database call', rp3.ok && state.db.calls.length === 1 && state.db.calls[0][0] === 'hub_vendor_credit_refund' && state.db.calls[0][1].bank_transaction_id === 'L1');

  // ── the bills list counts the credits (REAL bills route) ──
  stub('src/lib/server-permissions.js', { assertPermission: function () { return Promise.resolve({ ok: true, ctx: { isSuperAdmin: true, mp: {}, deny: {} } }); }, loadUserPermissions: function () { return Promise.resolve({ isSuperAdmin: true, mp: {}, deny: {} }); }, userHasPermission: function () { return true; }, SENSITIVE_PERMS: {} });
  var CF = require(path.join(root, 'src/lib/cashflow.js'));
  var bo = CF.billOpenBalance({ id: 'x', total_amount: 1000 }, [{ bill_id: 'x', amount: 100 }], 150);
  check('billOpenBalance: 1,000 − paid 100 − credited 150 = 750 (credited reported apart from paid)', bo.open === 750 && bo.paid === 100 && bo.credited === 150);
  check('billStatus: fully credited = PAID, partly credited = PARTIAL, nothing = OPEN', CF.billStatus({ id: 'x', total_amount: 100 }, [], 100) === 'PAID' && CF.billStatus({ id: 'x', total_amount: 100 }, [], 30) === 'PARTIAL' && CF.billStatus({ id: 'x', total_amount: 100 }, [], 0) === 'OPEN');
  var VC = require(path.join(root, 'src/lib/vendor-credits.js'));
  var sug = VC.suggestApplication(450, [{ id: 'b2', bill_date: '2026-10-03', owed: 500 }, { id: 'b1', bill_date: '2026-10-01', owed: 300 }]);
  check('suggested split: oldest first, never more than a bill owes or the credit has left', sug.length === 2 && sug[0].bill_id === 'b1' && sug[0].amount === 300 && sug[1].amount === 150);
  check('same vendor as the database decides it (Inc / LLC / punctuation ignored)', VC.vendorKeyOf('Kronos Logistics, LLC') === VC.vendorKeyOf('KRONOS LOGISTICS INC.') && VC.vendorKeyOf('AMB Trucking') !== VC.vendorKeyOf('Kronos Logistics'));

  // ── source wiring ──
  var wsrc = fs.readFileSync(path.join(root, 'src/app/api/accounting/wire-packages/route.js'), 'utf8');
  check('wires: candidates, save, recorded-after-the-fact and the open count all subtract credits (fail closed on a read error)', (wsrc.match(/loadBillCredits\(/g) || []).length === 4 && wsrc.indexOf("- (credBy[b.id] || 0)") > 0 && wsrc.indexOf("- paidS - (credS.byBill[bb.id] || 0)") > 0 && wsrc.indexOf("- resvS[bj.id] - (credS.byBill[bj.id] || 0)") > 0 && wsrc.indexOf("- paid2 - cred2") > 0);
  var bsrc = fs.readFileSync(path.join(root, 'src/app/api/accounting/bills/route.js'), 'utf8');
  check('bills: the shared loader reads credits (a read error stops it), every list goes through decorate with them, both payment pre-checks count them', bsrc.indexOf("var credits = await loadBillCredits(db, bills.map(function (b) { return b.id; }));") > 0 && bsrc.indexOf("if (credits.error) { throw new Error(credits.error); }") > 0 && !/decorate\(\w+\.bills, \w+\.pays\)/.test(bsrc) && bsrc.indexOf("billOpenBalance(bRow.data, exPays.data || [], credB.byBill[billId] || 0)") > 0 && bsrc.indexOf("credP.byBill[x.bill_id] || 0") > 0);
  var rsrc = fs.readFileSync(path.join(root, 'src/app/api/accounting/vendor-credits/route.js'), 'utf8');
  check('route style: no arrow functions / template strings / const / let; never writes a table itself', !/=>/.test(rsrc) && !/`/.test(rsrc) && !/\b(const|let)\s/.test(rsrc) && !/\.insert\(|\.update\(|\.delete\(|\.upsert\(/.test(rsrc));
  var psrc = fs.readFileSync(path.join(root, 'src/components/ProfitabilityTab.jsx'), 'utf8');
  check('Profitability shows credits applied in its dates as a PENDING, not-final adjustment', psrc.indexOf('Pending adjustment — NOT final') > 0 && fs.readFileSync(path.join(root, 'src/app/api/accounting/profitability/route.js'), 'utf8').indexOf('vendor_credits_pending: vcPend') > 0);
  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('CRASHED: ' + (e && e.stack || e)); process.exit(1); });
