// v55.83-WO — Codex 21 Nov 2026 00:05 UTC, P1 (Max's screenshots): a deposit and the bank's return of it, BOTH categorized
// "Returned checks", must net to zero in the period P&L — not a Warehouse / Office expense and not income.
// RUN: the REAL bills route (action period_stats) with an in-memory database → the REAL realCostCategories → expenseColumns →
// expenseDetail → the tax-pack exports → the rendered panel. All amounts are synthetic.
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var FakeDb = require('./fake-supabase.js').FakeDb;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 1100))); }
console.log('WO — returned checks are counted net');
var state = { db: null };
function stub(rel, exportsObj) { var p = require.resolve(path.join(root, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj }; }
stub('src/lib/verified-caller.js', { verifiedCaller: function () { return Promise.resolve({ userId: 'u1' }); } });
stub('src/lib/server-permissions.js', { assertPermission: function () { return Promise.resolve({ ok: true, ctx: { isSuperAdmin: true, mp: {}, deny: {} } }); }, loadUserPermissions: function () { return Promise.resolve({ isSuperAdmin: true, mp: {}, deny: {} }); }, userHasPermission: function () { return true; }, SENSITIVE_PERMS: {} });
var supa = require.resolve('@supabase/supabase-js', { paths: [root] });
require.cache[supa] = { id: supa, filename: supa, loaded: true, exports: { createClient: function () { return state.db; } } };
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test'; process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
var US = require(path.join(root, 'src/lib/business-of.js')).US_WAVE_BUSINESS_ID;
var B = require(path.join(root, 'src/app/api/accounting/bills/route.js'));
var E = require(path.join(root, 'src/lib/pnl-expenses.js')); var D = require(path.join(root, 'src/lib/pnl-expense-detail.js')); var TP = require(path.join(root, 'src/lib/tax-pack.js'));
function call(body) { return B.POST(new Request('http://x/api', { method: 'POST', body: JSON.stringify(Object.assign({ user_id: 'u1' }, body)), headers: { 'content-type': 'application/json' } })).then(function (r) { return r.json().then(function (j) { j._status = r.status; return j; }); }); }
function ln(id, date, amt, extra) { return Object.assign({ id: id, wave_business_id: US, account_id: 'A1', direction: 'out', amount_abs: amt, date: date, posted_date: date, pending: false, review_status: 'reviewed', third_party_payer: null, name: 'LINE ' + id, merchant_name: null, classification: null, transfer_group_id: null, matched_invoice_id: null }, extra || {}); }
var RC = 'returned_checks';
function world(lines) {
  var db = new FakeDb({});
  db.t.expense_categories = [{ key: RC, label: 'Returned checks', kind: 'expense' }, { key: 'bank_fees', label: 'Bank fees', kind: 'expense' }, { key: 'rent', label: 'Rent', kind: 'expense' }, { key: 'customer_payment', label: 'Customer payments', kind: 'income' }];
  db.t.paid_through_parties = []; db.t.bank_transactions = lines; db.t.vendor_bills = []; db.t.vendor_bill_payments = []; db.t.party_money_entries = []; db.t.wire_packages = []; db.t.wire_package_lines = [];
  db.rpcs.hub_party_funds_installed = function () { return { data: false, error: null }; };
  state.db = db; return db;
}
function cat(sp, key) { return (sp.categories || []).filter(function (c) { return c.key === key; })[0] || null; }
function inCat(sp, key) { return (sp.in_categories || []).filter(function (c) { return c.key === key; })[0] || null; }
async function stats(from, to) { var j = await call({ action: 'period_stats', from: from, to: to }); return j.spending || j.spend || (j.stats && j.stats.spending) || null; }
function ident(c) { return c; }
function cols(sp) { var rc = E.realCostCategories(sp, function (c) { return c; }, function (c) { return c; }); return { rc: rc, cols: E.expenseColumns(rc.cats, rc.uncategorized), det: D.expenseDetail(sp, rc) }; }
function aCat(x, key) { return x.cols.A.cats.filter(function (c) { return c.key === key; })[0] || null; }
var BASE = [ln('RENT', '2026-10-05', 300, { classification: 'rent' }), ln('PAY', '2026-10-06', 5000, { direction: 'in', classification: 'customer_payment' })];

(async function () {
  // ── 1. the same period: +1000 deposit, −1000 return, both "Returned checks"
  world(BASE.concat([ln('DEP', '2026-10-13', 1000, { direction: 'in', classification: RC, name: 'DEPOSIT' }), ln('RET', '2026-10-16', 1000, { classification: RC, name: 'DEPOSITED ITEM RETURNED' })]));
  var sp = await stats('2026-10-01', '2026-10-31'); check('the real route answers', !!sp && Array.isArray(sp.categories), sp);
  if (!sp) { process.exit(1); }
  var c1 = cat(sp, RC);
  check('PAIR: the category is NET 0 — return 1,000 minus deposit 1,000 — and says so (debits, credits, both lines counted)', c1 && c1.total === 0 && c1.net === true && c1.debits === 1000 && c1.credits === 1000 && c1.count === 2, c1);
  check('PAIR: no extra income — the deposit is on the money-in side as NOT income; customer payments are only the real 5,000', inCat(sp, RC) && inCat(sp, RC).kind === 'not_pnl' && inCat(sp, RC).total === 1000 && inCat(sp, 'customer_payment').total === 5000);
  check('PAIR: both original bank lines and the gross cash totals are untouched (in 6,000 · out 1,300)', sp.total_in === 6000 && sp.total_out === 1300 && sp.real_income === 6000 && sp.real_spending === 1300 && state.db.t.bank_transactions.length === 4);
  var rows1 = (sp.rows || []).filter(function (r) { return r.category === RC; });
  check('PAIR: both lines are listed under the category with their own id and date: the return +1,000 and the deposit −1,000 marked money in', rows1.length === 2 && rows1.some(function (r) { return r.id === 'RET' && r.amount === 1000 && r.date === '2026-10-16' && !r.money_in; }) && rows1.some(function (r) { return r.id === 'DEP' && r.amount === -1000 && r.date === '2026-10-13' && r.money_in === true; }), rows1);
  check('PAIR: the answer carries the summary (1 return 1,000 · 1 deposit 1,000)', sp.returned_checks && sp.returned_checks.debits === 1000 && sp.returned_checks.credits === 1000 && sp.returned_checks.debit_count === 1 && sp.returned_checks.credit_count === 1);
  var x1 = cols(sp); var a1 = aCat(x1, RC); var m1 = x1.det.byKey[RC];
  check('P&L BY PERIOD: Warehouse / Office is the rent only (300.00) — the returned check adds 0 — and total expenses are 300.00', x1.cols.A.cents === 30000 && x1.cols.total === 30000, x1.cols.A);
  check('P&L BY PERIOD: the zero category is STILL listed so it can be opened (net, returns 1,000.00, deposits 1,000.00)', a1 && a1.cents === 0 && a1.net === true && a1.debits_cents === 100000 && a1.credits_cents === 100000, x1.cols.A.cats);
  check('P&L BY PERIOD: opening it shows the two bank lines, adds up to 0.00, nothing unexplained', m1 && m1.cents === 0 && m1.adds_up === true && m1.other_cents === 0 && m1.bank.rows.length === 2 && m1.bank.listed_cents === 0 && m1.bank.unlisted_cents === 0 && m1.net && m1.net.debits_cents === 100000 && m1.net.credits_cents === 100000 && m1.bank.rows.some(function (r) { return r.id === 'DEP' && r.money_in === true && r.cents === -100000; }), m1);
  check('FINAL P&L: with a profit of 1,000.00 the final figure is 700.00 (only the rent comes off)', E.finalPnl(100000, x1.cols, 0).cents === 70000);
  // the SCREEN's own rule functions (the ones P&L by period passes in), with a paid-through company present
  var PS = require(path.join(root, 'src/components/PeriodStatsTab.jsx')); var spR = Object.assign({}, sp, { paid_through: [{ key: 'rtm', payer: 'RTM Capital', payments_by_cat: [], allocations_by_cat: [], rows: [] }] });
  var rcR = E.realCostCategories(spR, PS.rtmAdjust, PS.foldUnc); var colsR = E.expenseColumns(rcR.cats, rcR.uncategorized); var aR = colsR.A.cats.filter(function (c) { return c.key === RC; })[0];
  check('REAL RULE FUNCTIONS: through rtmAdjust + foldUnc the zero-net category is still there (0.00, openable) and expenses are still 300.00', aR && aR.cents === 0 && aR.net === true && colsR.total === 30000 && E.readExpenseAnswer({ ok: true, from: '2026-10-01', to: '2026-10-31', spending: spR }, { from: '2026-10-01', to: '2026-10-31' }, PS.rtmAdjust, PS.foldUnc).detail.byKey[RC].adds_up === true, rcR.cats);
  // exports
  var sumCsv = TP.spendingSummaryCsv ? TP.spendingSummaryCsv(sp) : null; var detCsv = TP.spendingDetailCsv(sp).join('\n'); var isCsv = TP.incomeStatementCsv(sp).join('\n');
  check('EXPORTS: the bank-line export lists the return and the deposit (−1000.00) under Returned checks; the income statement has revenue 5,000 and operating expenses 300', /RET|DEPOSITED ITEM RETURNED/.test(detCsv) && detCsv.indexOf('-1000.00,' + RC) > 0 && detCsv.indexOf('1000.00,' + RC) > 0 && isCsv.indexOf('"Revenue (cash received)",5000.00') > 0 && isCsv.indexOf('"Operating expenses",-300.00') > 0, [detCsv, isCsv]);
  // ── 2. +1000 / −200 → signed net, not zeroed
  world(BASE.concat([ln('DEP', '2026-10-13', 1000, { direction: 'in', classification: RC }), ln('RET', '2026-10-16', 200, { classification: RC })]));
  var sp2 = await stats('2026-10-01', '2026-10-31'); var x2 = cols(sp2);
  check('UNEQUAL: deposit 1,000 and return 200 → the category is −800 (signed, not forced to 0); Warehouse / Office = 300 − 800 = −500.00', cat(sp2, RC).total === -800 && aCat(x2, RC).cents === -80000 && x2.cols.A.cents === -50000 && x2.det.byKey[RC].adds_up === true, cat(sp2, RC));
  // ── 3. the return alone
  world(BASE.concat([ln('RET', '2026-10-16', 1000, { classification: RC })]));
  var sp3 = await stats('2026-10-01', '2026-10-31'); var x3 = cols(sp3);
  check('RETURN ALONE: kept as a 1,000 expense (nothing is hidden because of its category)', cat(sp3, RC).total === 1000 && aCat(x3, RC).cents === 100000 && x3.cols.A.cents === 130000 && !inCat(sp3, RC));
  // ── 4. a separate bank fee for the return stays an expense
  world(BASE.concat([ln('DEP', '2026-10-13', 1000, { direction: 'in', classification: RC }), ln('RET', '2026-10-16', 1000, { classification: RC }), ln('FEE', '2026-10-16', 12, { classification: 'bank_fees', name: 'RETURN ITEM FEE' })]));
  var sp4 = await stats('2026-10-01', '2026-10-31'); var x4 = cols(sp4);
  check('RETURN FEE: the bank’s 12.00 fee is still an expense; the pair is still 0', cat(sp4, 'bank_fees').total === 12 && cat(sp4, RC).total === 0 && x4.cols.total === 31200);
  // ── 5. dates: only one side in the range
  world(BASE.concat([ln('DEP', '2026-09-29', 1000, { direction: 'in', classification: RC }), ln('RET', '2026-10-02', 1000, { classification: RC })]));
  var spO = await stats('2026-10-01', '2026-10-31'); var spS = await stats('2026-09-01', '2026-09-30'); var spB = await stats('2026-09-01', '2026-10-31');
  check('DATES: October alone shows only the return (+1,000); September alone only the deposit (−1,000); both months together 0', cat(spO, RC).total === 1000 && cat(spS, RC).total === -1000 && cat(spB, RC).total === 0, [cat(spO, RC), cat(spS, RC), cat(spB, RC)]);
  // ── 6. pending / duplicate / another company are not counted
  world(BASE.concat([ln('RET', '2026-10-16', 1000, { classification: RC }), ln('DEP', '2026-10-13', 1000, { direction: 'in', classification: RC }),
    ln('DUP', '2026-10-13', 1000, { direction: 'in', classification: RC, review_status: 'duplicate' }), ln('PEN', '2026-10-13', 1000, { direction: 'in', classification: RC, pending: true }), ln('OTH', '2026-10-13', 1000, { direction: 'in', classification: RC, wave_business_id: 'another-company' })]));
  var sp6 = await stats('2026-10-01', '2026-10-31');
  check('FILTERS: a duplicate copy, a pending line and another company’s line are left out — still one deposit against one return = 0', cat(sp6, RC).total === 0 && cat(sp6, RC).credits === 1000 && cat(sp6, RC).credit_count === 1 && sp6.total_in === 6000, cat(sp6, RC));
  // ── 7. the deposit is ALSO matched to an invoice
  world(BASE.concat([ln('DEP', '2026-10-13', 1000, { direction: 'in', classification: RC, matched_invoice_id: 'inv-1' }), ln('RET', '2026-10-16', 1000, { classification: RC })]));
  var sp7 = await stats('2026-10-01', '2026-10-31'); var dep7 = (sp7.rows || []).filter(function (r) { return r.id === 'DEP'; })[0] || {};
  check('MATCHED: a deposit categorized Returned checks AND matched to an invoice still offsets the return (0) and is not counted as a customer payment (still 5,000); the row is marked so a person checks the invoice', cat(sp7, RC).total === 0 && inCat(sp7, 'customer_payment').total === 5000 && dep7.matched_invoice === true && sp7.returned_checks.matched_invoice_credits === 1, [cat(sp7, RC), inCat(sp7, 'customer_payment')]);
  check('MATCHED: the match itself is not touched — no write to any bank line or invoice', state.db.t.bank_transactions.filter(function (t) { return t.id === 'DEP'; })[0].matched_invoice_id === 'inv-1');
  // ── 8. nothing is inferred from equal amounts: an ordinary deposit of the same amount is ordinary income
  world(BASE.concat([ln('SAME', '2026-10-13', 1000, { direction: 'in', classification: 'customer_payment' }), ln('RET', '2026-10-16', 1000, { classification: RC })]));
  var sp8 = await stats('2026-10-01', '2026-10-31');
  check('NO GUESSING: a customer payment of the same amount is NOT paired with the return — the return stays 1,000, the payment stays income', cat(sp8, RC).total === 1000 && inCat(sp8, 'customer_payment').total === 6000);
  // ── 9. other categories behave exactly as before
  check('OTHER CATEGORIES: rent is unchanged and carries no net marking; a zero ordinary category is still not listed', cat(sp, 'rent').total === 300 && cat(sp, 'rent').net === undefined && E.expenseColumns([{ key: 'rent', label: 'Rent', kind: 'expense', total: 0 }], 0).A.cats.length === 0);
  // ── the panel
  var React = require('react'); global.React = React; var RS = require('react-dom/server'); var Panel = require(path.join(root, 'src/components/ExpenseDetail.jsx')).default;
  var html = ''; try { html = RS.renderToStaticMarkup(React.createElement(Panel, { makeup: m1, m: m1, rowsListed: true })); } catch (eR) { html = 'RENDER FAILED ' + eR.message; }
  check('SCREEN: the opened category shows “Returns taken out by the bank”, “Deposits that were returned”, the two bank lines and the deposit marked money IN', html.indexOf('Returns taken out by the bank (1)') > 0 && html.indexOf('Deposits that were returned (1)') > 0 && html.indexOf('money IN: the deposit that was returned') > 0 && html.indexOf('DEPOSITED ITEM RETURNED') > 0, html.substring(0, 900));
  var rt = fs.readFileSync(path.join(root, 'src/app/api/accounting/bills/route.js'), 'utf8'); var seg = rt.substring(rt.indexOf('// v55.83-WO (Max screenshots via Codex'), rt.indexOf('returned_checks: contra,'));
  check('server style in the new code: no backticks, no arrow functions, no let / const', seg.length > 500 && seg.indexOf(String.fromCharCode(96)) < 0 && !/=>/.test(seg) && !/\b(let|const)\s/.test(seg));
  console.log('\nWO: ' + pass + ' passed, ' + failN + ' failed');
  if (failN) { process.exit(1); }
})().catch(function (err) { console.log('  ✗ FAIL: threw ' + ((err && err.stack) || err)); process.exit(1); });
