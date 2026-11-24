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
check('NO DOUBLE COUNTING: the goods bill (40,000) and the trucking bill (15,000) Payco paid are NOT inside professional fees — they sit under goods / trucking, which are "already inside profit" and not taken off again', det.byKey.goods.cents === 4000000 && det.byKey.goods.bills.rows[0].ref === 'M-1' && det.byKey.trucking.cents === 1550000 && e.cols.in_profit.cents === 5550000 && e.cols.A.cents === 200000 + 60000 + 69184 && e.cols.held.cents === 400000); // v55.83-VY — the 4,000 left with Payco is HELD, not an office cost
var remKey = Object.keys(det.byKey).filter(function (k) { return det.byKey[k].remainder; })[0]; var rem = det.byKey[remKey];
check('what is left with Payco (61,000 − 57,000 of bills = 4,000) is its own line, with the sum shown — and the money leaving the bank equals what is counted: 61,000 = 2,000 + 40,000 + 15,000 + 4,000', !!rem && rem.remainder.payer === 'Payco' && rem.remainder.payments_cents === 6100000 && rem.remainder.bills_cents === 5700000 && rem.remainder.left_cents === 400000 && rem.cents === 400000 && pf.bills.cents + det.byKey.goods.bills.cents + det.byKey.trucking.bills.cents + rem.cents === 6100000, rem);
check('Trucking: the trucker paid directly (500, a bank line) and the one paid through Payco (15,000, a bill) are both shown, each once', det.byKey.trucking.bank.rows.length === 1 && det.byKey.trucking.bank.cents === 50000 && det.byKey.trucking.bills.cents === 1500000);
check('Uncategorized: the bank line with no category is listed under "No category at all"', det.byKey.uncategorized.cents === 12000 && det.byKey.uncategorized.bank.rows.length === 1 && det.byKey.uncategorized.bank.rows[0].id === 't6' && e.cols.unassigned.cats[0].key === 'uncategorized');
check('the figures themselves did not move: the columns are exactly what they were without the detail', (function () { var got = Object.assign({}, e.cols); delete got.paid_through_cents; delete got.paid_through_unlinked_cents; return JSON.stringify(got) === JSON.stringify(X.expenseColumns(X.realCostCategories(answer().spending, PS.rtmAdjust, PS.foldUnc).cats, X.realCostCategories(answer().spending, PS.rtmAdjust, PS.foldUnc).uncategorized)); })());
// v55.83-XQ — the view-only "paid through RTM / NextTrade" figure: the bills Payco settled (goods 40,000 + trucking 15,000 + legal 2,000 = 57,000), summed, and NOT in any counted column
check('XQ: the period answer carries paid_through_cents = the bills the paid-through company settled (57,000), and it is NOT added to any column or the total', e.cols.paid_through_cents === 5700000 && e.cols.total === e.cols.A.cents + e.cols.C.cents + e.cols.D.cents + e.cols.E.cents);
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
var row = { key: '2026-06', label: 'Jun 2026', goods_revenue: 10000000, goods_cost: 7000000, goods_profit: 3000000, transport_revenue: 500000, trucking_cost: 200000, freight_cost: 100000, transport_profit: 200000, profit: 3200000, uncounted: 2, uncounted_revenue: 90000, incomplete: 3, excl: { goods_lines: 2, goods_revenue: 90000, transport_lines: 0, transport_revenue: 0 } };
var f = D.pnlFormula(row, e, false); var last = f.lines[f.lines.length - 1];
check('formula: the last line is FINAL P&L = total profit − A − C − D − E with this row’s numbers, equal to the figure in the table', last.cents === 3200000 - e.cols.total && last.cents === X.finalPnl(row.profit, e.cols, 5).cents && f.lines.filter(function (l) { return l.sign === '−'; }).length === 7);
check('formula: goods revenue − goods cost = goods profit, and charged − trucking − freight = transport profit, both hold on the lines shown', f.lines[0].cents - f.lines[1].cents === f.lines[2].cents && f.lines[3].cents - f.lines[4].cents - f.lines[5].cents === f.lines[6].cents && f.lines[2].cents + f.lines[6].cents === f.lines[7].cents);
var nu = f.not_used.map(function (x) { return x.label + '=' + x.cents; }).join(' | ');
check('NOT USED lists: uncategorized 120, supplier / trucker payments 55,500, transfers 5,000 and the revenue of the 2 lines with no cost — each with its reason', /Uncategorized expenses=12000/.test(nu) && /suppliers, truckers, brokers=5550000/.test(nu) && /Transfers between our own accounts=500000/.test(nu) && /Goods revenue of 2 sale lines with no cost yet=90000/.test(nu) && f.not_used.every(function (x) { return !!x.why; }), nu);
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

// ── Codex 12:06 — real engine → the period row → the formula: the transport lines shown must add up, also with a COMBINED shipping amount
var A = require(path.join(root, 'src/lib/profitability-assemble.js')); var PR = require(path.join(root, 'src/lib/profitability.js')); var P = require(path.join(root, 'src/lib/pnl-period.js'));
function eng(o) { return A.assembleProfitability({ date_from: '2026-01-01', date_to: '', windowDays: 90, warehouseOn: false,
  invoices: [{ id: 'i1', invoice_number: 'INV 1', accounting_customer_id: 'c1', invoice_date: '2026-06-10', record_status: 'active', currency: 'USD', release_number: '1001-9001' }],
  items: [{ id: 'l1', invoice_id: 'i1', wave_product_name: 'Paper', description: 'Paper', quantity: 100, unit_price: 20 }], customerNames: { c1: 'Alpha' }, terms: [{ invoice_id: 'i1', shipping_terms: 'CNF_INCLUDED', shipping_cost_estimate: null }],
  // v55.83-YE: these checks are about how a COMBINED amount is shown; with Max's order the invoice box (2nd) would win over the typed
  // parts, so the combined amount here is the total typed for the release (hand-typed, same rank as the parts — the VS rule still applies)
  nameUnits: [{ name_key: PR.nameKey('Paper'), unit: 'lb' }], groups: [], groupNames: [], bills: [], billLines: [], warehouseRows: [], estimates: [{ release_key: PR.relKey('1001-9001'), outbound_estimate: 1000 }], partEstimates: o.partEstimates || [], lineReleasePounds: [] }); }
var RKV = PR.relKey('1001-9001');
function rowOf(cells0) { var r = P.blankPeriodRow('2026-06', 'Jun 2026'); (cells0 || []).forEach(function (c) { P.addPeriodCell(r, c); }); return P.settlePeriodRow(r); }
function transportAdds(fm) { var i0 = -1, i1 = -1; fm.lines.forEach(function (l, i) { if (/^Transport charged/.test(l.label)) { i0 = i; } if (l.label === 'TRANSPORT PROFIT') { i1 = i; } }); var v = fm.lines[i0].cents; for (var i = i0 + 1; i < i1; i++) { v -= fm.lines[i].cents; } return { ok: v === fm.lines[i1].cents, left: v, shown: fm.lines[i1].cents, labels: fm.lines.slice(i0, i1 + 1).map(function (l) { return l.label + '=' + l.cents; }) }; }
var c1 = eng({}); var r1 = rowOf(c1.cells); var f1 = D.pnlFormula(r1, null, false); var t1 = transportAdds(f1);
check('combined shipping $1,000 only (nothing divided): the row carries 1,000 as the combined amount, and charged − trucking − freight − combined = transport profit on the lines shown', r1.combined_cost === 100000 && r1.trucking_cost === 0 && r1.freight_cost === 0 && t1.ok && f1.lines.some(function (l) { return l.combined && l.cents === 100000 && /not divided/.test(l.label); }), t1);
var c2 = eng({ partEstimates: [{ release_key: RKV, part: 'trucking', amount: 0 }] }); var r2 = rowOf(c2.cells); var f2 = D.pnlFormula(r2, null, false); var t2 = transportAdds(f2);
check('Codex’s example — combined $1,000 + trucking typed as 0: charged 1,000 − trucking 0 − freight 0 − combined 1,000 = transport profit 0 (it used to show 1,000 − 0 − 0 = 0)', r2.transport_revenue === 100000 && r2.combined_cost === 100000 && r2.transport_profit === 0 && t2.ok && t2.labels.join(' | ').indexOf('combined amount') > 0, t2);
var c3 = eng({ partEstimates: [{ release_key: RKV, part: 'trucking', amount: 300 }] }); var r3 = rowOf(c3.cells); var t3 = transportAdds(D.pnlFormula(r3, null, false));
check('combined $1,000 with trucking 300 known: 300 is trucking, 700 stays combined, taken off once each', r3.trucking_cost === 30000 && r3.combined_cost === 70000 && t3.ok, t3);
var c4 = eng({ partEstimates: [{ release_key: RKV, part: 'trucking', amount: 300 }, { release_key: RKV, part: 'freight', amount: 500 }] }); var r4 = rowOf(c4.cells); var f4 = D.pnlFormula(r4, null, false); var t4 = transportAdds(f4);
check('an ordinary fully divided shipment (trucking 300 + freight 500): no combined line at all, and the three lines add up', r4.combined_cost === 0 && r4.trucking_cost === 30000 && r4.freight_cost === 50000 && t4.ok && !f4.lines.some(function (l) { return l.combined; }), t4);
var bdc = P.periodBreakdown(c2.cells, false).categories.filter(function (k) { return k.group === 'transport'; }); var bdn = P.periodBreakdown(c4.cells, false).categories;
check('the opened period’s TRANSPORTATION box shows the combined amount as its own line (and only when there is one), so that box adds up too', bdc.some(function (k) { return k.key === 'shipping_combined_share' && k.cents === 100000 && k.missing === 0; }) && bdc.filter(function (k) { return k.kind === 'in'; })[0].cents - bdc.filter(function (k) { return k.kind === 'out'; }).reduce(function (a, k) { return a + k.cents; }, 0) === bdc.filter(function (k) { return k.kind === 'profit'; })[0].cents && !bdn.some(function (k) { return k.key === 'shipping_combined_share'; }), bdc);
check('the period sums themselves are untouched: every figure of the row equals the old in-screen sum of the same cells', (function () { var c = c3.cells[0]; return r3.transport_revenue === Math.round(c.transport_revenue * 100) && r3.transport_profit === Math.round(c.transport_profit * 100) && r3.lines === 1 && r3.profit === r3.goods_profit + r3.transport_profit; })());
check('wording: supplier / trucker payments are ASSUMED already inside the costs (by category name), not asserted', f.not_used.some(function (z) { return /ASSUMED already inside/.test(z.why) && /not checked bill by bill/.test(z.why); }));
check('the screen adds its rows with the tested functions', src.indexOf('var add = addPeriodCell;') > 0 && src.indexOf('var settle = settlePeriodRow; var blank = blankPeriodRow;') > 0);

// ── Codex 12:11 — the ordinary "supplier bill not entered yet" case: the equations use ONLY the lines the profit was made of
function eng3(o) { return A.assembleProfitability({ date_from: '2026-01-01', date_to: '', windowDays: 90, warehouseOn: false,
  invoices: [{ id: 'i1', invoice_number: 'INV 1', accounting_customer_id: 'c1', invoice_date: '2026-06-10', record_status: 'active', currency: 'USD', release_number: '1001-9001' }].concat(o.two ? [{ id: 'i2', invoice_number: 'INV 2', accounting_customer_id: 'c1', invoice_date: '2026-06-12', record_status: 'active', currency: 'USD', release_number: '1001-9002' }] : []),
  items: [{ id: 'l1', invoice_id: 'i1', wave_product_name: 'Paper', description: 'Paper', quantity: 100, unit_price: 10 }].concat(o.two ? [{ id: 'l2', invoice_id: 'i2', wave_product_name: 'Paper', description: 'Paper', quantity: 200, unit_price: 10 }] : []), customerNames: { c1: 'Alpha' },
  terms: [{ invoice_id: 'i1', shipping_terms: 'CNF_INCLUDED', shipping_cost_estimate: 300 }, { invoice_id: 'i2', shipping_terms: 'CNF_INCLUDED', shipping_cost_estimate: 500 }], lineCosts: o.two ? [{ invoice_item_id: 'l2', cost_per_lb: 4, commission_per_lb: 0 }] : [],
  nameUnits: [{ name_key: PR.nameKey('Paper'), unit: 'lb' }], groups: [], groupNames: [], bills: [], billLines: [], warehouseRows: [], estimates: [], partEstimates: [], lineReleasePounds: [] }); }
function goodsAdds(fm) { return fm.lines[0].cents - fm.lines[1].cents === fm.lines[2].cents; }
var m1 = eng3({}); var rm1 = rowOf(m1.cells); var fm1 = D.pnlFormula(rm1, null, false);
check('ONE sale with no supplier cost yet: the goods equation is 0 lines · $0 − $0 = $0 and its revenue is under NOT USED as “no cost yet (not zero)” — it no longer reads revenue − $0 = $0', m1.cells[0].goods_profit === null && rm1.goods_revenue > 0 && rm1.used.goods_lines === 0 && fm1.lines[0].cents === 0 && /0 sale lines whose cost is known/.test(fm1.lines[0].label) && goodsAdds(fm1) && fm1.not_used.some(function (z) { return /Goods revenue of 1 sale line with no cost yet/.test(z.label) && z.cents === rm1.goods_revenue && /not known yet \(not zero\)/.test(z.why); }) && transportAdds(fm1).ok, fm1.lines.slice(0, 3));
var m2 = eng3({ two: true }); var rm2 = rowOf(m2.cells); var em = X.readExpenseAnswer(answer(), q, PS.rtmAdjust, PS.foldUnc); var fm2 = D.pnlFormula(rm2, em, false);
var cA = m2.cells.filter(function (c) { return c.invoice === 'INV 1'; })[0]; var cB = m2.cells.filter(function (c) { return c.invoice === 'INV 2'; })[0];
check('a month with that sale AND a fully costed sale — GOODS: only the costed line’s revenue and cost are in the equation, it equals the goods profit shown, and the other line’s revenue is listed once under NOT USED', cA.goods_profit === null && cB.goods_profit !== null && rm2.used.goods_lines === 1 && rm2.excl.goods_lines === 1 && fm2.lines[0].cents === Math.round(cB.goods_revenue * 100) && fm2.lines[2].cents === Math.round(cB.goods_profit * 100) && fm2.lines[2].cents === rm2.goods_profit && goodsAdds(fm2) && fm2.not_used.filter(function (z) { return /with no cost yet/.test(z.label); }).length === 1 && fm2.not_used.filter(function (z) { return /with no cost yet/.test(z.label); })[0].cents === Math.round(cA.goods_revenue * 100), [fm2.lines.slice(0, 3), rm2.used, rm2.excl]);
var tm2 = transportAdds(fm2);
check('…TRANSPORT: both lines have a shipping cost, so both are in the equation, it adds up, and NOTHING of the goods exclusion is taken off the transport side', rm2.used.transport_lines === 2 && rm2.excl.transport_lines === 0 && tm2.ok && tm2.shown === rm2.transport_profit && !fm2.not_used.some(function (z) { return /Transport charged on/.test(z.label); }), tm2);
var L2 = fm2.lines; var iTot = -1; L2.forEach(function (l, i) { if (/^TOTAL PROFIT/.test(l.label)) { iTot = i; } });
check('…FINAL: goods profit + transport profit = total profit, and total − A − C − D − E = the final figure, on the lines shown', L2[2].cents + L2[iTot - 1].cents === L2[iTot].cents && L2[iTot].cents - L2[iTot + 1].cents - L2[iTot + 2].cents - L2[iTot + 3].cents - L2[iTot + 4].cents === L2[iTot + 5].cents && L2[iTot + 5].cents === X.finalPnl(rm2.profit, em.cols, 1).cents);
check('…the report’s own sums did not move: the row’s profit figures equal the engine’s', rm2.goods_profit === Math.round(cB.goods_profit * 100) && rm2.transport_profit === Math.round(cA.transport_profit * 100) + Math.round(cB.transport_profit * 100) && rm2.goods_revenue === Math.round(cA.goods_revenue * 100) + Math.round(cB.goods_revenue * 100));
check('…and the panel says why its revenue can be smaller than the table’s column', fm2.notes.join(' ').indexOf('ALL sale lines') > 0);

// ── Max, Nov 20: "i have NO IDEA what I am supposed to fix ... it should give you that pop-up there, what to fix, and then it'll update"
// Real engine: release 1001-9001 is on TWO invoices. INV 1 (June, in the report) sells Paper by the pound. INV 0 (last year, outside
// the report) sold 'Mystery cloth by yd', which has no unit. A trucking figure is typed for the release.
function eng2(o) { return A.assembleProfitability({ date_from: '2026-06-01', date_to: '', windowDays: 90, warehouseOn: false,
  invoices: [{ id: 'i1', invoice_number: 'INV 1', accounting_customer_id: 'c1', invoice_date: '2026-06-10', record_status: 'active', currency: 'USD', release_number: '1001-9001' }, { id: 'i0', invoice_number: 'INV 0', accounting_customer_id: 'c1', invoice_date: '2025-11-28', record_status: 'active', currency: 'USD', release_number: '1001-9001' }],
  items: [{ id: 'l1', invoice_id: 'i1', wave_product_name: 'Paper', description: 'Paper', quantity: 100, unit_price: 20 }, { id: 'l0', invoice_id: 'i0', description: 'Mystery cloth by yd', quantity: 500, unit_price: 1 }], customerNames: { c1: 'Alpha' }, terms: [{ invoice_id: 'i1', shipping_terms: 'CNF_SEPARATE' }, { invoice_id: 'i0', shipping_terms: 'CNF_SEPARATE' }] /* v55.83-YE rev2: was EXW — an EXW release now costs $0 unless a bill, so the shared-cost check uses a shipped term */,
  nameUnits: [{ name_key: PR.nameKey('Paper'), unit: 'lb' }].concat(o && o.fixed ? [{ name_key: PR.nameKey('Mystery cloth by yd'), unit: 'yd' }] : []), groups: [], groupNames: [], bills: [], billLines: [], warehouseRows: [], estimates: [], partEstimates: [{ release_key: RKV, part: 'trucking', amount: 1750 }, { release_key: RKV, part: 'freight', amount: 3280 }], lineReleasePounds: [] }); }
var w0 = eng2(); var wt = P.openTasks(w0.cells).tasks.filter(function (k) { return k.kind === 'not_shared'; });
check('a release whose typed trucking + freight cannot be shared: ONE row for the release (not one per part), that NAMES the description with no unit, and the fix is a unit picker in that row', (w0.cells || []).length === 1 && wt.length === 1 && wt[0].action === 'unit' && wt[0].names.join('|') === 'Mystery cloth by yd' && /Mystery cloth by yd/.test(wt[0].how) && /do not type it again/.test(wt[0].how) && wt[0].lines === 1, wt);
check('the other invoice is outside the report’s dates: its description is named (it is what must be fixed) but NOT its invoice number or id', wt[0].blockers.length === 1 && wt[0].blockers[0].older === true && wt[0].blockers[0].invoice === undefined && wt[0].blockers[0].invoice_id === undefined && /older invoice of this release/.test(wt[0].how) && JSON.stringify(wt).indexOf('INV 0') < 0);
check('no typing box is offered for trucking or freight on that release (the figures are there)', !P.openTasks(w0.cells).tasks.some(function (k) { return k.kind === 'trucking' || k.kind === 'freight'; }));
var w1 = eng2({ fixed: true }); var c1x = w1.cells[0];
check('after the unit is picked (yards) the report shares the cost and the row is gone — updated in place', P.openTasks(w1.cells).tasks.filter(function (k) { return k.kind === 'not_shared'; }).length === 0 && c1x.trucking_cost !== null && c1x.freight_cost !== null && (c1x.weight_blockers || []).length === 0, [c1x.trucking_cost, c1x.freight_cost]);
check('the screen: unit picker and cost box are in the task row and save with the existing actions; the buttons that sent you to a whole screen per reason are gone', src.indexOf("act({ action: 'set_name_unit', names: [nm], unit: u }") > 0 && src.indexOf("act({ action: 'set_manual_cost', level: 'group', group_id: t.group_id") > 0 && src.indexOf('goFix(g.go, null)') < 0);

console.log('\nVT: ' + pass + ' passed, ' + failN + ' failed');
if (failN) { process.exit(1); }
