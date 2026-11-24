// v55.83-YF — the REAL /api/accounting/cash route with an in-memory database (the database functions are stand-ins that record their calls;
// their rules run for real in __tests__/sql-v55-83-yf-cash-on-hand.mjs), plus the source wiring (tab, switch, Wave). Fabricated fixtures.
var path = require('path');
var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var FakeDb = require('./fake-supabase.js').FakeDb;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 800))); }
console.log('YF — Cash on Hand: the real route');
var state = { db: null, perms: {}, sup: false, floor: null, privAll: true };
function stub(rel, exportsObj) { var p = require.resolve(path.join(root, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj }; }
stub('src/lib/verified-caller.js', { verifiedCaller: function () { return Promise.resolve({ userId: 'u1' }); } });
stub('src/lib/server-permissions.js', {
  assertPermission: function (db, uid, perm) { return Promise.resolve(state.sup || state.perms[perm] ? { ok: true, ctx: { isSuperAdmin: state.sup } } : { ok: false }); },
  loadUserPermissions: function () { return Promise.resolve({ isSuperAdmin: state.sup, mp: {}, deny: {} }); }, userHasPermission: function () { return true; }, SENSITIVE_PERMS: {} });
stub('src/lib/private-accounts-server.js', { privateScope: function () { return Promise.resolve(state.privAll ? { all: true, hidden: {} } : { all: false, hidden: { 'manual-acct-cash-on-hand-us': true } }); }, isPrivateRow: function () { return false; } });
stub('src/lib/visibility-window-server.js', { windowFloorFor: function () { return Promise.resolve({ floor: state.floor }); }, clampFrom: function (d) { return d; } });
var supa = require.resolve('@supabase/supabase-js', { paths: [root] });
require.cache[supa] = { id: supa, filename: supa, loaded: true, exports: { createClient: function () { return state.db; } } };
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test'; process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
var US = require(path.join(root, 'src/lib/business-of.js')).US_WAVE_BUSINESS_ID;
var R = require(path.join(root, 'src/app/api/accounting/cash/route.js'));
function call(body) { return R.POST(new Request('http://x/api', { method: 'POST', body: JSON.stringify(Object.assign({ user_id: 'u1' }, body)), headers: { 'content-type': 'application/json' } })).then(function (r) { return r.json().then(function (j) { j._status = r.status; return j; }); }); }
function world(installed) {
  var db = new FakeDb({}); db.calls = [];
  db.t.cash_entries = installed ? [{ id: 'e1', kind: 'receive_invoice', amount: 600, entry_date: '2026-10-10', bank_transaction_id: 'L1', invoice_id: 'i1', person: 'Ahmed', reference: 'R-1', voided: false, created_at: '2026-10-10T10:00:00Z' },
    { id: 'e0', kind: 'adjust_in', amount: 50, entry_date: '2026-01-10', bank_transaction_id: 'L0', person: 'Max', reference: 'count', note: 'float', voided: false, created_at: '2026-01-10T10:00:00Z' },
    { id: 'e2', kind: 'deposit', amount: 100, entry_date: '2026-10-12', bank_transaction_id: 'L2', deposit_bank_transaction_id: null, person: 'Ahmed', reference: 'slip 7', voided: false, created_at: '2026-10-12T10:00:00Z' }] : [];
  db.t.accounting_invoices = [{ id: 'i1', invoice_number: 'INV-1', invoice_date: '2026-10-01', total_amount: 1000, balance_due: 400, payment_status: 'partial', accounting_customer_id: 'c1', currency: 'USD', record_status: 'active', wave_business_id: US },
    { id: 'i2', invoice_number: 'EG-1', invoice_date: '2026-10-01', total_amount: 50, balance_due: 50, payment_status: 'unpaid', currency: 'USD', record_status: 'active', wave_business_id: 'EG' },
    { id: 'i3', invoice_number: 'INV-OLD', invoice_date: '2026-01-02', total_amount: 70, balance_due: 70, payment_status: 'unpaid', currency: 'USD', record_status: 'active', wave_business_id: US }];
  db.t.accounting_customers = [{ id: 'c1', company_name: 'Acme Trading' }];
  db.t.vendor_bills = [{ id: 'b1', wave_business_id: US, vendor_name: 'Kronos', bill_number: 'K-1', bill_date: '2026-10-02', total_amount: 400, currency: 'USD', record_status: 'active', disputed: false }];
  db.t.vendor_bill_payments = [{ bill_id: 'b1', amount: 100, voided: false }]; db.t.wire_package_lines = [{ bill_id: 'b1', amount: 50, is_open: true }];
  db.t.bank_transactions = [{ id: 'D1', wave_business_id: US, direction: 'in', pending: false, review_status: 'unreviewed', amount_abs: 100, date: '2026-10-13', name: 'DEPOSIT', account_id: 'A1' },
    { id: 'D2', wave_business_id: US, direction: 'in', pending: false, review_status: 'unreviewed', amount_abs: 100, date: '2026-10-14', name: 'MATCHED', account_id: 'A1', matched_invoice_id: 'iX' }];
  db.t.accounting_invoice_payments = []; db.t.app_settings = [];
  db.rpcs.hub_cash_installed = function () { return { data: installed === true, error: null }; };
  db.rpcs.hub_cash_balance = function () { return { data: 550, error: null }; };
  ['hub_cash_receive_invoice', 'hub_cash_pay_bill', 'hub_cash_deposit', 'hub_cash_deposit_pair', 'hub_cash_adjust', 'hub_cash_undo'].forEach(function (fn) {
    db.rpcs[fn] = function (a, dbx) { dbx.calls.push([fn, a.p]); if (a.p && a.p.amount === 9999) { return { data: null, error: { message: 'P0001 HUB_GUARD: Cash on Hand would go below zero ($-9,449.00) on or after 2026-10-15 — there is not that much cash in the box.' } }; } return { data: { ok: true, action: fn, balance: 550 }, error: null }; };
  });
  state.db = db; return db;
}
(async function () {
  world(true); state.perms = { 'accounting.view': true }; state.privAll = false;
  var a = await call({ action: 'summary' });
  check('without the private-account rule (super admin / "See private accounts"): 403, nothing shown', a._status === 403 && /private account/.test(a.error), a);
  state.privAll = true; state.perms = { 'accounting.view': true };
  var s = await call({ action: 'summary' });
  check('with it: balance 550, the cash book (newest first), the invoice number on a receipt; can_record false', s.ok && s.balance === 550 && s.entries.length === 3 && s.entries[0].id === 'e2' && s.entries.filter(function (e) { return e.id === 'e1'; })[0].invoice === 'INV-1' && s.can_record === false, s);
  var w0 = await call({ action: 'receive_invoice', invoice_id: 'i1', amount: 10, entry_date: '2026-10-15', person: 'Ahmed', reference: 'R-2', request_id: 'c1' });
  check('recording without the "Cash on Hand: record" switch: 403, nothing called', w0._status === 403 && state.db.calls.length === 0, w0);
  state.perms = { 'accounting.view': true, 'cash.manage': true };
  var adj = await call({ action: 'adjust', direction: 'in', amount: 5, entry_date: '2026-10-15', person: 'x', reference: 'y', note: 'opening float', request_id: 'c2' });
  check('a cash count change is super admin only (403 even with the switch)', adj._status === 403 && state.db.calls.length === 0);
  var r1 = await call({ action: 'receive_invoice', invoice_id: 'i1', amount: '10.004', entry_date: '2026-10-15', person: ' Ahmed ', reference: 'R-2', note: 'paid at the desk', request_id: 'c3' });
  var c1 = state.db.calls[0];
  check('receive: ONE database call with the invoice, cents, date, person, receipt, the click id and the verified person', r1.ok && c1 && c1[0] === 'hub_cash_receive_invoice' && c1[1].invoice_id === 'i1' && c1[1].amount === 10 && c1[1].person === 'Ahmed' && c1[1].reference === 'R-2' && c1[1].request_id === 'c3' && c1[1].actor === 'u1', [r1, c1]);
  var other = await call({ action: 'receive_invoice', invoice_id: 'i2', amount: 10, entry_date: '2026-10-15', person: 'A', reference: 'R', request_id: 'c4' });
  check('another company\'s invoice: 404 before the database', other._status === 404 && state.db.calls.length === 1);
  var bads = [[{ entry_date: '' }, /date/], [{ amount: 0 }, /above zero/], [{ request_id: '' }, /click id/]];
  var badOk = true; for (var i = 0; i < bads.length; i++) { var rb = await call(Object.assign({ action: 'pay_bill', bill_id: 'b1', amount: 5, entry_date: '2026-10-15', person: 'A', reference: 'R', request_id: 'x' + i }, bads[i][0])); if (rb.ok || !bads[i][1].test(rb.error || '')) { badOk = false; console.log('    ', JSON.stringify(rb).slice(0, 200)); } }
  check('pay a bill refuses a missing date, a zero amount, a missing click id — nothing called', badOk && state.db.calls.length === 1);
  var big = await call({ action: 'pay_bill', bill_id: 'b1', amount: 9999, entry_date: '2026-10-15', person: 'A', reference: 'R', request_id: 'c5' });
  check('the database refusal ("below zero") is passed on plainly (409)', big._status === 409 && /would go below zero/.test(big.error) && !/HUB_GUARD/.test(big.error), big);
  var oi = await call({ action: 'open_invoices', q: 'acme' });
  check('open invoices: KTC USA only, USD, still owing, with the customer name; search works', oi.ok && oi.invoices.length === 1 && oi.invoices[0].id === 'i1' && oi.invoices[0].customer === 'Acme Trading' && oi.invoices[0].due === 400, oi);
  var ob = await call({ action: 'open_bills' });
  check('open bills: owed = 400 − paid 100 − on an open wire 50 = 250', ob.ok && ob.bills.length === 1 && ob.bills[0].owed === 250, ob);
  var dl = await call({ action: 'deposit_lines', amount: 100 });
  check('deposit lines: free money-in lines of exactly that amount (a matched one left out)', dl.ok && dl.lines.map(function (l) { return l.id; }).join() === 'D1', dl);
  state.db.t.unapplied_deposits = [{ bank_transaction_id: 'D1', amount: 100, status: 'open' }];
  var dlP = await call({ action: 'deposit_lines', amount: 100 });
  check('(Codex 24 Nov) a $100 bank line PARKED as an open unapplied customer deposit is NOT offered for a cash deposit', dlP.ok && dlP.lines.length === 0, dlP);
  state.db.t.unapplied_deposits = [{ bank_transaction_id: 'D1', amount: 100, status: 'void' }];
  var dlV = await call({ action: 'deposit_lines', amount: 100 });
  check('… offered again once that parked deposit is undone (voided)', dlV.ok && dlV.lines.map(function (l) { return l.id; }).join() === 'D1', dlV);
  state.db.t.unapplied_deposits = [];
  state.floor = '2026-06-01';
  var s2 = await call({ action: 'summary' });
  check('history window: older cash entries are not listed (the balance is still the whole box)', s2.ok && !s2.entries.some(function (e) { return e.id === 'e0'; }) && s2.window_from === '2026-06-01' && s2.balance === 550, s2);
  var oi2 = await call({ action: 'open_invoices' });
  check('… and an invoice dated before the window is not offered', oi2.ok && !oi2.invoices.some(function (x) { return x.id === 'i3'; }));
  var u0 = await call({ action: 'undo', entry_id: 'e0', reason: 'mistake' });
  check('… nor can an entry before the window be undone (404)', u0._status === 404);
  state.floor = null; state.db.calls = [];
  var u1 = await call({ action: 'undo', entry_id: 'e1', reason: 'wrong invoice' });
  check('undo: one database call with the reason and the verified person', u1.ok && state.db.calls.length === 1 && state.db.calls[0][1].reason === 'wrong invoice' && state.db.calls[0][1].actor === 'u1', u1);
  check('undo without a reason is refused', (await call({ action: 'undo', entry_id: 'e1', reason: '' }))._status === 400);
  state.sup = true; state.db.calls = [];
  var adj2 = await call({ action: 'adjust', direction: 'in', amount: 5, entry_date: '2026-10-15', person: 'Max', reference: 'count sheet', note: 'opening float', request_id: 'c6' });
  check('the super admin can record a cash count', adj2.ok && state.db.calls[0][0] === 'hub_cash_adjust' && state.db.calls[0][1].direction === 'in');
  world(false); state.sup = false; state.perms = { 'accounting.view': true, 'cash.manage': true };
  var n0 = await call({ action: 'summary' });
  var n1 = await call({ action: 'deposit', amount: 5, entry_date: '2026-10-15', person: 'A', reference: 'R', request_id: 'c7' });
  check('before the database step: the summary says the step is needed; a write answers 409, nothing called', n0.ok && n0.installed === false && /v55-83-YF-cash-on-hand\.sql/.test(n0.sql_missing) && n1._status === 409 && state.db.calls.length === 0, [n0, n1]);
  // wiring
  var src = fs.readFileSync(path.join(root, 'src/app/api/accounting/cash/route.js'), 'utf8');
  check('route style: no arrow functions / template strings / const / let; it never writes a table itself', !/=>/.test(src) && !/`/.test(src) && !/\b(const|let)\s/.test(src) && !/\.insert\(|\.update\(|\.delete\(|\.upsert\(/.test(src));
  var acc = fs.readFileSync(path.join(root, 'src/components/AccountingTab.jsx'), 'utf8');
  check('the 💵 Cash on Hand tab shows only for the super admin or "See private accounts"', acc.indexOf("if (isSuper || mp['bank.view_private'] === true) { tabs.splice(") > 0 && acc.indexOf("{sub === 'cash' && <div className=\"p-3\"><CashOnHandPanel") > 0);
  var sp = fs.readFileSync(path.join(root, 'src/lib/server-permissions.js'), 'utf8'); var st = fs.readFileSync(path.join(root, 'src/components/SettingsTab.jsx'), 'utf8');
  check('the "Cash on Hand: record" switch is sensitive (super admin only) on the server and in both permission screens', /'cash\.manage': 1/.test(sp) && /'cash\.manage': true/.test(st) && st.indexOf("key: 'cash.manage'") > 0 && fs.readFileSync(path.join(root, 'src/components/BankingAccessPanel.jsx'), 'utf8').indexOf("key: 'cash.manage'") > 0);
  var pp = fs.readFileSync(path.join(root, 'src/app/api/wave/push-payment/route.js'), 'utf8'); var pt = fs.readFileSync(path.join(root, 'src/app/api/wave/push-transaction/route.js'), 'utf8');
  check('Wave: a cash payment / cash line goes to Wave\'s "Cash on Hand" account (exactly one), never a bank account by default', pp.indexOf("if (payBtAccountId === 'manual-acct-cash-on-hand-us') {") > 0 && pt.indexOf("if (bt.account_id === 'manual-acct-cash-on-hand-us') {") > 0 && /cashW\.length !== 1/.test(pp) && /cashA\.length !== 1/.test(pt));
  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('CRASHED: ' + (e && e.stack || e)); process.exit(1); });
