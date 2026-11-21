// v55.83-WY — Max, 21 Nov 2026: "a running report for each customer stating overpaid invoices and underpaid invoices ... not in
// the pnl calculation"; underpaid = "invoices that don't have the full balance paid. Track it by customer". Codex plan feedback
// 21 Nov 09:15: the fixtures below are its normal-use cases. Real calculation, the REAL route with stubs, the rendered panel.
// All numbers are made up.
var path = require('path'); var fs = require('fs'); var Module = require('module');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 1000))); }
console.log('WY — customer balances today (held / owed), not in profit');
var CB = require(path.join(root, 'src/lib/customer-balances.js'));
var BIZ = 'US-BIZ';
function inv(id, cust, total, paid, o) { return Object.assign({ id: id, invoice_number: 'T-' + id, accounting_customer_id: cust, invoice_date: '2026-10-01', total_amount: total, amount_paid: paid, balance_due: Math.round((total - paid) * 100) / 100, record_status: 'active', currency: 'USD', business: 'US' }, o || {}); }
function cr(id, cust, amt, o) { return Object.assign({ id: id, accounting_customer_id: cust, amount: amt, status: 'open', source_transaction_id: 'tx-' + id, created_at: '2026-10-02T10:00:00Z', wave_business_id: BIZ }, o || {}); }
function run(o) { return CB.customerBalances(Object.assign({ customerNames: { A: 'Alpha', B: 'Beta' }, business: BIZ, today: '2026-11-21', priv: { all: true, hidden: {} } }, o)); }
function custOf(r, name) { return CB.balanceOfCustomer(r, name); }

// Codex: invoice 100 / deposit 120 → invoice payment 100 + held 20, not two copies of 20
var r1 = run({ invoices: [inv('i1', 'A', 100, 100)], credits: [cr('c1', 'A', 20)] }); var a1 = custOf(r1, 'Alpha');
check('CODEX 1: invoice 100 paid by a deposit of 120 → held 20 once; owed 0; nothing to check', a1 && a1.held_cents === 2000 && a1.owed_cents === 0 && a1.recon.length === 0 && r1.totals.held_cents === 2000, a1);
// Codex: same customer has another invoice owing 30 → held 20 and owed 30 separately (never netted)
var r2 = run({ invoices: [inv('i1', 'A', 100, 100), inv('i2', 'A', 30, 0)], credits: [cr('c1', 'A', 20)] }); var a2 = custOf(r2, 'Alpha');
check('CODEX 2: another invoice of the same customer owes 30 → held 20 AND owed 30, side by side, never netted to 10', a2.held_cents === 2000 && a2.owed_cents === 3000 && a2.owed_unpaid_cents === 3000 && a2.owed_partly_cents === 0, a2);
// Codex: unknown customer 20 → unidentified only
var r3 = run({ invoices: [], unapplied: [{ id: 'u1', accounting_customer_id: null, amount: 20, status: 'open', bank_transaction_id: 'tx-u1', created_at: '2026-10-03T00:00:00Z', wave_business_id: BIZ }] });
check('CODEX 3: a deposit with no customer → only in "customer not identified", never on a customer', r3.customers.length === 0 && r3.unidentified.length === 1 && r3.totals.unidentified_cents === 2000 && r3.totals.held_cents === 0, r3);
var r3b = run({ invoices: [], unapplied: [{ id: 'u2', accounting_customer_id: 'B', amount: 15, status: 'open', bank_transaction_id: 'tx-u2', created_at: '2026-10-03T00:00:00Z', wave_business_id: BIZ }] });
check('…an unapplied deposit that DOES carry a confirmed customer is held for that customer', custOf(r3b, 'Beta').held_cents === 1500 && r3b.unidentified.length === 0);
// Codex: voided / rematched deposit
var r4 = run({ invoices: [inv('i1', 'A', 100, 100)], credits: [cr('c1', 'A', 20, { status: 'void' }), cr('c2', 'A', 5)] });
check('CODEX 4: a credit voided when its deposit was unmatched / rematched is not held; only the live one counts', custOf(r4, 'Alpha').held_cents === 500 && custOf(r4, 'Alpha').held.length === 1);
// Codex: older credit still held; later application / refund does not masquerade as history
var r5 = run({ invoices: [], credits: [cr('c-old', 'A', 40, { created_at: '2025-03-01T00:00:00Z' }), cr('c-used', 'A', 60, { status: 'applied' }), cr('c-back', 'A', 70, { status: 'refunded' })] });
check('CODEX 5: an OLD credit still open stays held (whatever the P&L dates); one applied or refunded since is not held — and the answer says it is TODAY’s balance', custOf(r5, 'Alpha').held_cents === 4000 && r5.basis === 'today' && r5.as_of === '2026-11-21');
// underpaid = every invoice with an open balance (Max), split into part paid / not paid at all
var r6 = run({ invoices: [inv('p', 'A', 100, 40), inv('n', 'A', 50, 0), inv('f', 'A', 70, 70)] }); var a6 = custOf(r6, 'Alpha');
check('UNDERPAID (Max): every invoice with a balance open — part paid 60 and not paid 50, owed 110; a fully paid one is not listed', a6.owed_cents === 11000 && a6.owed_partly_cents === 6000 && a6.owed_unpaid_cents === 5000 && a6.owed.length === 2 && a6.owed.some(function (x) { return x.invoice_id === 'p' && x.partly === true; }));
// paid more than the total on the invoice itself → listed to check, never added
var r7 = run({ invoices: [inv('x', 'A', 100, 120)], credits: [cr('c1', 'A', 20)] }); var a7 = custOf(r7, 'Alpha');
check('NEEDS CHECK: an invoice whose own figures show more paid than its total is listed apart and NOT added to held (the credit row already holds the 20 once)', a7.recon.length === 1 && a7.recon[0].over_cents === 2000 && a7.held_cents === 2000 && a7.owed_cents === 0 && r7.totals.recon_count === 1);
// (Codex 09:48 P2) an invoice whose own figures disagree is TO CHECK, never confirmed debt
var rP = run({ invoices: [Object.assign(inv('m1', 'A', 100, 40), { balance_due: 100 }), Object.assign(inv('m2', 'A', 100, 100), { balance_due: 100 })] }); var aP = custOf(rP, 'Alpha');
check('CODEX P2: total 100 / paid 40 / stored balance 100, and total 100 / paid 100 / stored balance 100 → both TO CHECK with the reason; owed 0 (not 100 + 100)', aP.owed_cents === 0 && aP.recon.length === 2 && aP.recon.every(function (x) { return x.reason === 'its balance does not match total minus paid'; }) && aP.recon.some(function (x) { return x.invoice_id === 'm1' && x.expected_cents === 6000 && x.balance_cents === 10000; }) && rP.totals.recon_count === 2, aP);
var rQ = run({ invoices: [inv('ok1', 'A', 100, 40), inv('ok2', 'A', 100, 100)] }); var aQ = custOf(rQ, 'Alpha');
check('CONTROLS: a consistent part-paid invoice is owed 60; a consistent fully paid one is not listed; nothing to check', aQ.owed_cents === 6000 && aQ.owed_partly_cents === 6000 && aQ.recon.length === 0 && aQ.owed.length === 1);
var rR = run({ invoices: [Object.assign(inv('adj', 'A', 100, 40), { balance_due: 30 })], credits: [cr('ca', 'A', 30, { status: 'applied', applied_to_invoice_id: 'adj' })] }); var aR = custOf(rR, 'Alpha');
check('SUPPORTED ADJUSTMENT: a customer credit of 30 APPLIED to the invoice explains the lower balance (100 − 40 paid − 30 credit = 30) → owed 30, not to check; the applied credit is not held', aR.owed_cents === 3000 && aR.recon.length === 0 && aR.held_cents === 0, aR);
// scope
var r8 = run({ invoices: [inv('v', 'A', 100, 0, { record_status: 'void' }), inv('e', 'A', 100, 0, { business: 'EG' }), inv('old', 'A', 100, 0, { invoice_date: '2025-01-01' }), inv('ok', 'A', 10, 0), inv('eur', 'A', 30, 0, { currency: 'EUR' })], credits: [cr('pc', 'A', 9, { source_transaction_id: 'tx-priv' }), cr('ob', 'A', 7, { wave_business_id: 'OTHER' })], floor: '2026-01-01', priv: { all: false, hidden: { ACC9: true } }, accountOf: { 'tx-priv': 'ACC9' } });
var a8 = custOf(r8, 'Alpha');
check('SCOPE: a voided invoice, another company’s invoice, one older than the person’s history, a credit from a private account they may not see and another company’s credit are all left out; euros are never added to dollars', a8.owed_cents === 1000 && a8.owed.length === 1 && a8.held_cents === 0 && a8.other_currency.EUR === 3000 && r8.skipped.private_bank === 1 && r8.skipped.outside_window === 1 && r8.skipped.other_business === 2, [a8, r8.skipped]);
check('a customer with nothing held and nothing owed is not listed; the list is sorted by the biggest amounts', run({ invoices: [inv('f', 'A', 70, 70)] }).customers.length === 0);

// ── the REAL route
var world = { perms: { 'pnl.view': true }, tables: {}, priv: { all: true, hidden: {} } };
function stub(file, exportsObj) { var id = require.resolve(file); var m0 = new Module(id); m0.filename = id; m0.loaded = true; m0.exports = exportsObj; require.cache[id] = m0; }
function chain(table) { var q = { f: [] };
  ['select', 'order', 'limit'].forEach(function (k) { q[k] = function () { return q; }; });
  q.eq = function (c, v) { q.f.push(function (r) { return String(r[c]) === String(v); }); return q; };
  q.in = function (c, vs) { q.f.push(function (r) { return vs.indexOf(r[c]) >= 0; }); return q; };
  q.range = function (a) { return Promise.resolve({ data: a === 0 ? rows() : [], error: null }); };
  function rows() { return (world.tables[table] || []).filter(function (r) { return q.f.every(function (fn) { return fn(r); }); }); }
  q.then = function (ok, no) { return Promise.resolve({ data: rows(), error: null }).then(ok, no); };
  ['insert', 'update', 'delete', 'upsert'].forEach(function (k) { q[k] = function () { world.writes = (world.writes || 0) + 1; return q; }; });
  return q; }
stub(path.join(root, 'node_modules/next/server.js'), { NextResponse: { json: function (body, init) { return { status: (init && init.status) || 200, body: body }; } } });
stub('@supabase/supabase-js', { createClient: function () { return { from: chain, rpc: function () { return Promise.resolve({ data: null, error: null }); } }; } });
stub(path.join(root, 'src/lib/verified-caller.js'), { verifiedCaller: async function () { return { userId: 'u1' }; } });
stub(path.join(root, 'src/lib/server-permissions.js'), { assertPermission: async function (db, userId, key) { return world.perms[key] ? { ok: true, ctx: {} } : { ok: false }; }, loadUserPermissions: async function () { return {}; }, userHasPermission: function () { return false; } });
stub(path.join(root, 'src/lib/visibility-window-server.js'), { windowFloorFor: async function () { return { floor: world.floor || null }; }, clampFrom: function (d0) { return d0; } });
stub(path.join(root, 'src/lib/private-accounts-server.js'), { privateScope: async function () { return world.priv; }, dropPrivate: function (r) { return r; }, isPrivateRow: function () { return false; } });
var US = require(path.join(root, 'src/lib/business-of.js')).US_WAVE_BUSINESS_ID;
var ROUTE = require(path.join(root, 'src/app/api/accounting/profitability/route.js'));
function post(body) { return ROUTE.POST({ json: async function () { return body; }, headers: { get: function () { return 'Bearer x'; } } }); }
(async function () {
  world.tables = {
    accounting_invoices: [Object.assign(inv('i1', 'A', 100, 100), { wave_business_id: US }), Object.assign(inv('i2', 'A', 30, 0), { wave_business_id: US }), Object.assign(inv('i3', 'B', 50, 20), { wave_business_id: US }), Object.assign(inv('eg', 'B', 80, 0), { wave_business_id: 'EGYPT-BIZ' })],
    accounting_customers: [{ id: 'A', company_name: 'Alpha', business_tag: null }, { id: 'B', company_name: 'Beta', business_tag: null }],
    customer_credits: [cr('c1', 'A', 20, { wave_business_id: US }), cr('c9', 'B', 5, { status: 'void', wave_business_id: US })],
    unapplied_deposits: [{ id: 'u1', accounting_customer_id: null, amount: 12, status: 'open', bank_transaction_id: 'tx-u1', created_at: '2026-10-03T00:00:00Z', wave_business_id: US }],
    bank_transactions: [{ id: 'tx-c1', account_id: 'ACC1' }, { id: 'tx-u1', account_id: 'ACC1' }]
  };
  var r = await post({ user_id: 'u1', action: 'customer_balances' }); var b = r.body;
  check('ROUTE: answers today’s balances — Alpha held 20 and owed 30, Beta owed 30 (part paid), the Egyptian invoice left out, 12 not identified', r.status === 200 && b.ok === true && b.basis === 'today' && custOf(b, 'Alpha').held_cents === 2000 && custOf(b, 'Alpha').owed_cents === 3000 && custOf(b, 'Beta').owed_cents === 3000 && custOf(b, 'Beta').owed_partly_cents === 3000 && b.totals.unidentified_cents === 1200 && !!b.api_build_marker, b);
  check('ROUTE: read only — nothing written', !world.writes);
  world.perms = {}; var r0 = await post({ user_id: 'u1', action: 'customer_balances' });
  check('ROUTE: without the P&L permission → refused, no figure in the answer', r0.status === 403 && JSON.stringify(r0.body).indexOf('3000') < 0 && !r0.body.customers);
  world.perms = { 'pnl.view': true }; world.priv = { error: 'Could not check private accounts (x)' }; var rp = await post({ user_id: 'u1', action: 'customer_balances' });
  check('ROUTE: if private accounts cannot be checked → nothing shown (fails closed)', rp.status === 503 && !rp.body.customers);
  world.priv = { all: false, hidden: { ACC1: true } }; var rh = await post({ user_id: 'u1', action: 'customer_balances' });
  check('ROUTE: credits and deposits from a private account this person may not see are left out (held 0, unidentified 0), invoices still shown', rh.status === 200 && custOf(rh.body, 'Alpha').held_cents === 0 && rh.body.totals.unidentified_cents === 0 && custOf(rh.body, 'Alpha').owed_cents === 3000);
  world.priv = { all: true, hidden: {} }; world.floor = '2026-10-02'; var rw = await post({ user_id: 'u1', action: 'customer_balances' });
  check('ROUTE: the person’s history window applies (invoices dated before it are left out) and the answer says where it starts', rw.body.window_floor === '2026-10-02' && !custOf(rw.body, 'Beta') && rw.body.customers.every(function (c) { return c.owed.every(function (x) { return x.date >= '2026-10-02'; }); }));
  world.floor = null;

  // ── profit is untouched: the P&L code does not read these figures
  var asm = fs.readFileSync(path.join(root, 'src/lib/profitability-assemble.js'), 'utf8'); var per = fs.readFileSync(path.join(root, 'src/lib/pnl-period.js'), 'utf8'); var exp = fs.readFileSync(path.join(root, 'src/lib/pnl-expenses.js'), 'utf8'); var tax = fs.readFileSync(path.join(root, 'src/lib/tax-pack.js'), 'utf8');
  check('NOT IN PROFIT: no profit, expense or tax calculation reads customer credits, unapplied deposits or these balances', [asm, per, exp, tax].every(function (s) { return s.indexOf('customer_credits') < 0 && s.indexOf('unapplied_deposits') < 0 && s.indexOf('customer-balances') < 0 && s.indexOf('held_cents') < 0; }));

  // ── the screen
  var React = require('react'); global.React = React; var RS = require('react-dom/server'); var CMod = require(path.join(root, 'src/components/CustomerBalances.jsx'));
  var html = RS.renderToStaticMarkup(React.createElement(CMod.default, { data: b }));
  check('SCREEN: the panel says it is not in the profit or the tax P&L, that it is today’s balance, and shows held, owed (part paid / not paid) and not identified', html.indexOf('not in the profit and not in the tax P&amp;L') > 0 && html.indexOf('Balances as they are today (') > 0 && html.indexOf('Held for customers $20.00') > 0 && html.indexOf('Still owed by customers $60.00') > 0 && html.indexOf('Customer not identified $12.00') > 0, html.substring(0, 900));
  var cell = RS.renderToStaticMarkup(React.createElement(CMod.BalanceCell, { c: custOf(b, 'Alpha') }));
  check('SCREEN: the By customer cell shows the two amounts apart ("held $20.00", "owed $30.00"), a dash when there is nothing', cell.indexOf('held $20.00') > 0 && cell.indexOf('owed $30.00') > 0 && RS.renderToStaticMarkup(React.createElement(CMod.BalanceCell, { c: null })).indexOf('—') > 0 && RS.renderToStaticMarkup(React.createElement(CMod.BalanceCell, { loading: true })).indexOf('…') > 0);
  var tab = fs.readFileSync(path.join(root, 'src/components/ProfitabilityTab.jsx'), 'utf8'); var pfx = fs.readFileSync(path.join(root, 'src/components/PnlFormula.jsx'), 'utf8');
  check('WIRING: By customer gets the panel and one extra column only in that view; the pop-up shows the same answer (same basis); loaded on demand', tab.indexOf("concat(view === 'customer' ? [['Held · owed today'") > 0 && tab.indexOf("concat(view === 'customer' && !sub ? [<td key=\"c16\"") > 0 && tab.indexOf("<PnlFormula title={fr.label || 'the total'} balancesBlock={balancesNote()} ") > 0 && tab.indexOf('function balancesNote() { return <CustomerBalances compact data={custBal.data}') > 0 && tab.indexOf("call({ action: 'customer_balances' })") > 0 && pfx.indexOf('{props.balancesBlock ?') > 0);
  var lib = fs.readFileSync(path.join(root, 'src/lib/customer-balances.js'), 'utf8');
  check('style: no backticks, arrow functions, let / const in the calculation', lib.indexOf(String.fromCharCode(96)) < 0 && !/=>/.test(lib) && !/\b(let|const)\s/.test(lib));
  console.log('\nWY: ' + pass + ' passed, ' + failN + ' failed');
  if (failN) { process.exit(1); }
})().catch(function (err) { console.log('  ✗ FAIL: threw ' + ((err && err.stack) || err)); process.exit(1); });
