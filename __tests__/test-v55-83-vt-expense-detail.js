// v55.83-VT — Max, 20 Nov 2026: "i already asked this to be able to click on expenses to see the underlying" · "i should see the
// breakdown of all the underlying expenses with drill down and for me to change if necessary" · "make sure there is no double
// counting with professional fees and the underlying fees that it pays" · "a breakdown of the pnl with the formula ... in a hover
// button so i understand what was used and not used" · "open the invoice from this page with a button that produces a pop up".
// Real functions (the Income Statement's own real-cost rule, the real paid-through blocks); made-up names and amounts.
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';
require(path.join(root, 'node_modules/sucrase/register'));
var React = require('react'); global.React = React; var RS = require('react-dom/server');
var X = require(path.join(root, 'src/lib/pnl-expenses.js'));
var D = require(path.join(root, 'src/lib/pnl-expense-detail.js'));
var B = require(path.join(root, 'src/lib/paid-through-blocks.js'));
var PS = require(path.join(root, 'src/components/PeriodStatsTab.jsx'));
var ExpenseDetail = require(path.join(root, 'src/components/ExpenseDetail.jsx')).default;
var PnlFormula = require(path.join(root, 'src/components/PnlFormula.jsx')).default;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 900))); }
console.log('VT — what is behind each expense figure, the formula of a row, invoices of a period');

// ── a month the way the Income Statement answers it. Bank: $61,000 sent to "Payco" (a paid-through service company) booked as
// professional fees in two lines, a $600 consultant, $691.84 utilities, a $500 trucker paid directly, one line with no category.
// Payco paid three bills with that money: goods 40,000 · trucking 15,000 · legal (professional fees) 2,000 → 4,000 is left.
var labels = { professional_fees: 'Professional Fees', consulting: 'Consulting', utilities: 'Utilities', trucking: 'Trucking', goods: 'Goods purchased' };
var kinds = { goods: 'cogs' };
var bank = [
  { id: 't1', date: '2026-06-03', who: 'PAYCO WIRE', amount: 36000, category: 'professional_fees', payer: 'Payco' },
  { id: 't2', date: '2026-06-17', who: 'PAYCO WIRE', amount: 25000, category: 'professional_fees', payer: 'Payco' },
  { id: 't3', date: '2026-06-09', who: 'Jane Consultant', amount: 600, category: 'consulting' },
  { id: 't4', date: '2026-06-11', who: 'City Power', amount: 691.84, category: 'utilities' },
  { id: 't5', date: '2026-06-12', who: 'Road Trucker', amount: 500, category: 'trucking' },
  { id: 't6', date: '2026-06-20', who: 'UNKNOWN DEBIT', amount: 120, category: '' }
];
function answer(o) {
  var opt = o || {}; var byCat = {}; var unc = { count: 0, total: 0 };
  bank.forEach(function (t) { if (!t.category) { unc.count++; unc.total += t.amount; return; } var c = byCat[t.category] || (byCat[t.category] = { key: t.category, label: labels[t.category], kind: kinds[t.category] || 'expense', count: 0, total: 0 }); c.count++; c.total += t.amount; });
  var blocks = B.buildPaidThroughBlocks({ parties: [{ name: 'Payco', kind: 'service_provider', remainder_label: 'Payco service fee (payments − covered bills)' }],
    lines: bank.filter(function (t) { return t.payer; }).map(function (t) { return { id: t.id, date: t.date, amount: t.amount, classification: t.category, payer: t.payer }; }),
    pays: opt.pays || [{ bill_id: 'b1', amount: 40000, paid_date: '2026-06-05', method: 'rtm' }, { bill_id: 'b2', amount: 15000, paid_date: '2026-06-18', method: 'rtm' }, { bill_id: 'b3', amount: 2000, paid_date: '2026-06-19', method: 'rtm' }],
    billById: { b1: { vendor_name: 'Mill Co', bill_number: 'M-1', category: 'goods', paid_via: 'Payco' }, b2: { vendor_name: 'Road Trucker', bill_number: 'R-9', category: 'trucking', paid_via: 'Payco' }, b3: { vendor_name: 'Law Office', bill_number: 'L-2', category: 'professional_fees', paid_via: 'Payco' } },
    requests: [], catLabels: labels, kindOf: function (k) { return kinds[k] || 'expense'; }, from: '2026-06-01', to: '2026-06-30' });
  return { ok: true, from: '2026-06-01', to: '2026-06-30', spending: { categories: Object.keys(byCat).map(function (k) { return byCat[k]; }), uncategorized: unc, transfers: { count: 1, total: 5000 }, paid_through: blocks,
    rows: opt.noRows ? undefined : bank.map(function (t) { return { id: t.id, date: t.date, who: t.who, amount: t.amount, category: t.category }; }) } };
}
var q = { key: '2026-06', from: '2026-06-01', to: '2026-06-30' };
var e = X.readExpenseAnswer(answer(), q, PS.rtmAdjust, PS.foldUnc);
var det = e.detail; var pf = det.byKey.professional_fees;
check('the answer of a period now carries what is behind every figure (same answer, nothing asked again)', e.status === 'ok' && !!det && !!pf && det.rows_listed === true);
check('EVERY line shown in the six boxes has a make-up, and its figure is the figure on screen', ['A', 'C', 'D', 'E', 'unassigned', 'in_profit'].every(function (k) { return e.cols[k].cats.every(function (c) { var m = det.byKey[c.key]; return m && m.cents === c.cents; }); }));
check('every make-up ADDS UP to its figure to the cent (bank lines + from advances − sent to the company + its bills) — nothing unexplained', Object.keys(det.byKey).every(function (k) { var m = det.byKey[k]; return m.remainder ? true : (m.other_cents === 0 && m.adds_up === true && m.cents === m.bank.cents + m.from_advances_cents - m.taken_out_cents + m.bills.cents); }), Object.keys(det.byKey).map(function (k) { return [k, det.byKey[k].other_cents]; }));
check('Professional Fees: the two wires to Payco (61,000) are listed, taken OUT in full, and only the legal bill Payco paid (2,000) is put in → 2,000', pf.bank.cents === 6100000 && pf.bank.rows.length === 2 && pf.taken_out_cents === 6100000 && pf.taken_out[0].payer === 'Payco' && pf.bills.cents === 200000 && pf.bills.rows.length === 1 && pf.bills.rows[0].ref === 'L-2' && pf.cents === 200000, pf);
check('NO DOUBLE COUNTING: the goods bill (40,000) and the trucking bill (15,000) Payco paid are NOT inside professional fees — they sit under goods / trucking, which are "already inside profit" and not taken off again', det.byKey.goods.cents === 4000000 && det.byKey.goods.bills.rows[0].ref === 'M-1' && det.byKey.trucking.cents === 1550000 && e.cols.in_profit.cents === 5550000 && e.cols.A.cents === 200000 + 60000 + 69184 + 400000);
var remKey = Object.keys(det.byKey).filter(function (k) { return det.byKey[k].remainder; })[0]; var rem = det.byKey[remKey];
check('what is left with Payco (61,000 − 57,000 of bills = 4,000) is its own line, with the sum shown — and the money leaving the bank equals what is counted: 61,000 = 2,000 + 40,000 + 15,000 + 4,000', !!rem && rem.remainder.payer === 'Payco' && rem.remainder.payments_cents === 6100000 && rem.remainder.bills_cents === 5700000 && rem.remainder.left_cents === 400000 && rem.cents === 400000 && pf.bills.cents + det.byKey.goods.bills.cents + det.byKey.trucking.bills.cents + rem.cents === 6100000, rem);
check('Trucking: the trucker paid directly (500, a bank line) and the one paid through Payco (15,000, a bill) are both shown, each once', det.byKey.trucking.bank.rows.length === 1 && det.byKey.trucking.bank.cents === 50000 && det.byKey.trucking.bills.cents === 1500000);
check('Uncategorized: the bank line with no category is listed under "No category at all"', det.byKey.uncategorized.cents === 12000 && det.byKey.uncategorized.bank.rows.length === 1 && det.byKey.uncategorized.bank.rows[0].id === 't6' && e.cols.unassigned.cats[0].key === 'uncategorized');
check('the figures themselves did not move: the columns are exactly what they were without the detail', JSON.stringify(e.cols) === JSON.stringify(X.expenseColumns(X.realCostCategories(answer().spending, PS.rtmAdjust, PS.foldUnc).cats, X.realCostCategories(answer().spending, PS.rtmAdjust, PS.foldUnc).uncategorized)));
// a list that cannot explain the amount says so in plain sight
var e2 = X.readExpenseAnswer((function () { var a = answer(); a.spending.rows = a.spending.rows.filter(function (r) { return r.id !== 't2'; }); return a; })(), q, PS.rtmAdjust, PS.foldUnc);
check('a bank line missing from the list (list limit): the figure is unchanged and the gap is stated (25,000 not listed), never hidden', e2.detail.byKey.professional_fees.cents === 200000 && e2.detail.byKey.professional_fees.bank.unlisted_cents === 2500000 && e2.detail.byKey.professional_fees.bank.listed_cents === 3600000);
var e3 = X.readExpenseAnswer(answer({ noRows: true }), q, PS.rtmAdjust, PS.foldUnc);
check('a person who is not sent the bank lines still gets the sums, and is told the lines are not shown', e3.detail.rows_listed === false && e3.detail.byKey.professional_fees.cents === 200000 && RS.renderToStaticMarkup(React.createElement(ExpenseDetail, { makeup: e3.detail.byKey.professional_fees, rowsListed: false })).indexOf('not shown to you') > 0);
check('locked / outside / error answers carry no detail at all', X.readExpenseAnswer({ ok: true, from: q.from, to: q.to, spending: null }, q, PS.rtmAdjust, PS.foldUnc).detail === undefined && X.readExpenseAnswer({ error: 'x' }, q, PS.rtmAdjust, PS.foldUnc).detail === undefined);

// ── rendered
var picked = []; function picker(r) { picked.push(r.id); return React.createElement('select', { 'data-line': r.id }); }
var html = RS.renderToStaticMarkup(React.createElement(ExpenseDetail, { makeup: pf, rowsListed: true, picker: picker }));
check('rendered Professional Fees: both wires, the amount taken out for Payco with the reason, the legal bill, and "adds up"', html.indexOf('PAYCO WIRE') > 0 && html.indexOf('$36,000.00') > 0 && html.indexOf('$25,000.00') > 0 && html.indexOf('Money sent to Payco') > 0 && html.indexOf('not counted twice') > 0 && html.indexOf('Law Office') > 0 && html.indexOf('adds up') > 0 && html.indexOf('Other adjustments') < 0, html.substring(0, 600));
check('each bank line gets the category picker (t1, t2); a bill paid through the company gets none (changed on the bill)', picked.join(',') === 't1,t2' && html.split('data-line').length - 1 === 2 && html.indexOf('change the category on the bill') > 0);
var htmlR = RS.renderToStaticMarkup(React.createElement(ExpenseDetail, { makeup: rem, rowsListed: true }));
check('rendered remainder line: money sent − bills paid = left over, and it says the bills are NOT in this figure', htmlR.indexOf('$61,000.00') > 0 && htmlR.indexOf('$57,000.00') > 0 && htmlR.indexOf('$4,000.00') > 0 && htmlR.indexOf('NOT in this figure') > 0);
check('nothing behind a line → a plain sentence, no crash', RS.renderToStaticMarkup(React.createElement(ExpenseDetail, { makeup: null })).indexOf('Nothing to show') > 0);

// ── the formula of a row
var row = { key: '2026-06', label: 'Jun 2026', goods_revenue: 10000000, goods_cost: 7000000, goods_profit: 3000000, transport_revenue: 500000, trucking_cost: 200000, freight_cost: 100000, transport_profit: 200000, profit: 3200000, uncounted: 2, uncounted_revenue: 90000, incomplete: 3 };
var f = D.pnlFormula(row, e, false); var last = f.lines[f.lines.length - 1];
check('formula: the last line is FINAL P&L = total profit − A − C − D − E with this row’s numbers, equal to the figure in the table', last.cents === 3200000 - e.cols.total && last.cents === X.finalPnl(row.profit, e.cols, 5).cents && f.lines.filter(function (l) { return l.sign === '−'; }).length === 7);
check('formula: goods revenue − goods cost = goods profit, and charged − trucking − freight = transport profit, both hold on the lines shown', f.lines[0].cents - f.lines[1].cents === f.lines[2].cents && f.lines[3].cents - f.lines[4].cents - f.lines[5].cents === f.lines[6].cents && f.lines[2].cents + f.lines[6].cents === f.lines[7].cents);
var nu = f.not_used.map(function (x) { return x.label + '=' + x.cents; }).join(' | ');
check('NOT USED lists: uncategorized 120, supplier / trucker payments 55,500, transfers 5,000 and the revenue of the 2 lines with no cost — each with its reason', /Uncategorized expenses=12000/.test(nu) && /suppliers, truckers, brokers=5550000/.test(nu) && /Transfers between our own accounts=500000/.test(nu) && /2 sale line\(s\) whose cost is not known=90000/.test(nu) && f.not_used.every(function (x) { return !!x.why; }), nu);
var fh = D.pnlFormula(row, e, true);
check('a person who may not see profit gets no profit and no final figure in the formula (same gate as the cells)', fh.lines.filter(function (l) { return l.strong; }).every(function (l) { return l.cents === null; }));
var fn = D.pnlFormula(row, null, false);
check('expenses not loaded: no final figure is made up, and the note says why', fn.lines[fn.lines.length - 1].cents === null && fn.notes.join(' ').indexOf('not loaded') > 0);
var fhtml = RS.renderToStaticMarkup(React.createElement(PnlFormula, { title: 'Jun 2026', formula: f }));
check('rendered formula: USED and NOT USED sections with the money', fhtml.indexOf('USED in the figure') > 0 && fhtml.indexOf('NOT USED in the figure') > 0 && fhtml.indexOf('$30,000.00') > 0 && fhtml.indexOf('FINAL P&amp;L') > 0);

// ── invoices of a period
var cells = [{ invoice_id: 'i1', invoice: 'A-1', invoice_date: '2026-06-10', customer: 'Alpha', release_raw: '1001-1', goods_revenue: 100, transport_revenue: 20, profit: 30 }, { invoice_id: 'i1', invoice: 'A-1', invoice_date: '2026-06-10', customer: 'Alpha', release_raw: '1001-2', goods_revenue: 50, transport_revenue: null, profit: null }, { invoice_id: 'i2', invoice: 'A-2', invoice_date: '2026-06-02', customer: 'Beta', release_raw: '', goods_revenue: 10, transport_revenue: 0, profit: 4 }];
var iv = D.periodInvoices(cells, false);
check('one row per invoice, oldest first, with its id (so it can be opened), releases, lines, sold-for and the known profit', iv.length === 2 && iv[0].invoice === 'A-2' && iv[1].invoice_id === 'i1' && iv[1].lines === 2 && iv[1].releases.join(',') === '1001-1,1001-2' && iv[1].sold_cents === 17000 && iv[1].profit === 3000 && iv[1].missing === 1);
check('profit hidden for this person → no profit on any invoice row', D.periodInvoices(cells, true).every(function (r) { return r.profit === null; }));

// ── the screen uses them
var src = fs.readFileSync(path.join(root, 'src/components/ProfitabilityTab.jsx'), 'utf8');
check('P&L by period: a category row opens ExpenseDetail from the period’s own answer; the picker is the Income Statement’s save; the formula panel and the invoice pop-up are wired', src.indexOf('<ExpenseDetail makeup={e.detail && e.detail.byKey[c0.key]}') > 0 && src.indexOf("erApi('bulk_classify', { ids: [row.id], classification: key, single_pick: true })") > 0 && src.indexOf('<PnlFormula title=') > 0 && src.indexOf('periodInvoices(cs, hidden)') > 0 && src.indexOf('setPeekId(iv.invoice_id)') > 0 && src.indexOf('setPeekId(x.invoice_id)') > 0);
check('changing a category needs the same switch as the Income Statement (bank.classify; only the super admin bypasses)', src.indexOf("(props.modulePerms || {})['bank.classify'] === true") > 0 && src.indexOf('if (!canPick || !row.id) { return null; }') > 0);

console.log('\nVT: ' + pass + ' passed, ' + failN + ' failed');
if (failN) { process.exit(1); }
