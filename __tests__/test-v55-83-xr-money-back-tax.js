// ═══════════════════════════════════════════════════════════════════════════
// v55.83-XR — MONEY BACK FROM RTM / NEXTTRADE in the tax view (Max, 22 Nov 2026: "AS PER YOUR RECOMMENDATION" = Option 1:
// "the returned money reduces that expense in the month it comes back"). A money-in line recorded as a refund of a company
// transfer is taken off Professional fees on its own bank date; it is never income, whatever category the line carries.
// RUN: the REAL bills route (action period_stats) with an in-memory database, plus the real Accountant-pack builders and the
// real screen re-bucketing (rtmAdjust). All amounts are illustrative fixtures.
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path');
var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var FakeDb = require('./fake-supabase.js').FakeDb;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 1000))); }
console.log('XR — money back from RTM / NextTrade lowers Professional fees in the month it comes back');

var state = { db: null };
function stub(rel, exportsObj) { var p = require.resolve(path.join(root, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj }; }
stub('src/lib/verified-caller.js', { verifiedCaller: function () { return Promise.resolve({ userId: 'u1' }); } });
stub('src/lib/server-permissions.js', {
  assertPermission: function () { return Promise.resolve({ ok: true, ctx: { isSuperAdmin: true, mp: {}, deny: {} } }); },
  loadUserPermissions: function () { return Promise.resolve({ isSuperAdmin: true, mp: {}, deny: {} }); },
  userHasPermission: function () { return true; }, SENSITIVE_PERMS: {},
});
var supa = require.resolve('@supabase/supabase-js', { paths: [root] });
require.cache[supa] = { id: supa, filename: supa, loaded: true, exports: { createClient: function () { return state.db; } } };
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test'; process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
var US = require(path.join(root, 'src/lib/business-of.js')).US_WAVE_BUSINESS_ID;
var B = require(path.join(root, 'src/app/api/accounting/bills/route.js'));
function call(body) { return B.POST(new Request('http://x/api', { method: 'POST', body: JSON.stringify(Object.assign({ user_id: 'u1' }, body)), headers: { 'content-type': 'application/json' } })).then(function (r) { return r.json().then(function (j) { j._status = r.status; return j; }); }); }
var NT = 'NextTrade Industries', RTM = 'RTM Capital';
function ln(id, date, amt, extra) { return Object.assign({ id: id, wave_business_id: US, account_id: 'A1', direction: 'out', amount_abs: amt, date: date, posted_date: date, pending: false, review_status: 'unreviewed', third_party_payer: null, name: 'LINE ' + id, merchant_name: null, classification: null, transfer_group_id: null, matched_invoice_id: null }, extra || {}); }

function world(o) {
  o = o || {};
  var db = new FakeDb({});
  db.t.expense_categories = [{ key: 'professional_fees', label: 'Professional fees', kind: 'expense' }, { key: 'trucking', label: 'Trucking', kind: 'expense' }, { key: 'sales', label: 'Sales', kind: 'income' }, { key: 'other_income', label: 'Other income', kind: 'other_income' }, { key: 'customer_payment', label: 'Customer payment', kind: 'income' }];
  db.t.paid_through_parties = [{ name: RTM, kind: 'service_provider', remainder_label: 'RTM service fee', active: true, sort: 1 }, { name: NT, kind: 'affiliate', remainder_label: 'NextTrade advance', active: true, sort: 2, provider_from: o.providerFrom || null }];
  db.t.bank_transactions = [
    ln('T1', '2026-03-05', 1000, { third_party_payer: NT, classification: 'professional_fees', name: 'Online Transfer to CHK ...2061 transaction#: 7000001' })].concat(o.noRtm ? [] : [
    ln('T2', '2026-04-02', 400, { third_party_payer: RTM, classification: null, name: 'WIRE TO RTM' })]).concat([
    ln('B1', '2026-04-08', 200, { direction: 'in', classification: o.backCat === undefined ? 'sales' : o.backCat, name: 'DEPOSIT FROM NEXTTRADE' }), // NextTrade sends back 200 of T1 (March)
    ln('B2', '2026-04-20', 50, { direction: 'in', classification: o.b2Cat || null, name: 'RTM RETURN' }),                                                    // RTM sends back 50 of T2 (same month)
    ln('IN1', '2026-04-22', 5000, { direction: 'in', classification: 'customer_payment', name: 'CUSTOMER WIRE' }),
    ln('DUP', '2026-04-23', 75, { direction: 'in', classification: 'sales', review_status: 'duplicate', name: 'DUPLICATE COPY' })
  ]).filter(function (x) { return !(o.noRtm && x.id === 'B2'); });
  db.t.vendor_bills = o.bill ? [{ id: 'b1', wave_business_id: US, vendor_name: 'Kronos', bill_number: 'K-1', bill_date: '2026-03-10', due_date: '2026-03-20', currency: 'USD', total_amount: 600, category: 'trucking', record_status: 'active', paid_via: NT }] : [];
  db.t.vendor_bill_payments = o.bill ? [{ id: 'p1', bill_id: 'b1', amount: 600, paid_date: '2026-03-12', bank_transaction_id: 'T1', voided: false, method: 'rtm' }] : [];
  db.t.wire_packages = []; db.t.wire_package_lines = [];
  db.t.party_money_entries = o.noEntries ? [] : [
    { id: 'r1', party: NT, bucket: 'refund', kind: 'refund', amount: o.bill ? 400 : 200, source_bank_transaction_id: 'T1', bank_transaction_id: 'B1', entry_date: o.entryDate || '2026-04-15', created_at: (o.entryDate || '2026-04-15') + 'T00:00:00Z', reason: 'unused money back' }, // typed later than the bank date
    { id: 'r2', party: RTM, bucket: 'refund', kind: 'refund', amount: 50, source_bank_transaction_id: 'T2', bank_transaction_id: 'B2', entry_date: '2026-04-20', created_at: '2026-04-20T00:00:00Z' }].filter(function (e) { return !(o.noRtm && e.id === 'r2'); });
  if (o.bill) { db.t.bank_transactions.forEach(function (x) { if (x.id === 'B1') { x.amount_abs = 400; } }); }
  db.rpcs.hub_party_funds_installed = function () { return { data: o.installed === true, error: null }; };
  if (o.readError) { db.fail.party_money_entries = { select: o.readError === true ? 'permission denied for table party_money_entries' : o.readError }; }
  state.db = db; return db;
}
function cat(cats, key) { return (cats || []).filter(function (c) { return c.key === key; })[0] || { total: 0, count: 0 }; }
async function stats(from, to) { var j = await call({ action: 'period_stats', from: from, to: to }); return { j: j, sp: j.spending || j.spend || (j.stats && j.stats.spending) || null }; }
function incomeCat(sp, key) { return cat(sp.in_categories, key); }

(async function () {
  // ── March: the 1,000 transfer to NextTrade, in full ──
  world();
  var m = (await stats('2026-03-01', '2026-03-31')).sp;
  check('MARCH: Professional fees = the 1,000 transfer in full; no money back in March', !!m && cat(m.categories, 'professional_fees').total === 1000 && m.funds_sent_tax.money_back.count === 0 && m.funds_sent_tax.net === 1000, m && m.funds_sent_tax);
  // ── April: RTM transfer 400; NextTrade sends back 200 (of March's transfer), RTM sends back 50 (of April's) ──
  var a = await stats('2026-04-01', '2026-04-30'); var sp = a.sp;
  check('the real route answers with the spending block', a.j.ok !== false && !!sp && Array.isArray(sp.categories), a.j.error || Object.keys(a.j));
  if (!sp) { console.log('\n' + pass + ' passed, ' + (failN + 1) + ' failed'); process.exit(1); }
  var pf = cat(sp.categories, 'professional_fees');
  check('APRIL: Professional fees = 400 (RTM transfer) − 200 − 50 money back = 150: the money back lowers the expense in the month it came back', pf.total === 150 && pf.money_back === 250 && pf.funds_sent === 400, pf);
  check('the transfers line says it: 1 transfer of 400, money back 2 lines 250 (NextTrade 200 · RTM 50), net 150', sp.funds_sent_tax.total === 400 && sp.funds_sent_tax.money_back.count === 2 && sp.funds_sent_tax.money_back.total === 250 && sp.funds_sent_tax.money_back.by_party[NT] === 200 && sp.funds_sent_tax.money_back.by_party[RTM] === 50 && sp.funds_sent_tax.net === 150, sp.funds_sent_tax);
  check('the money back is NOT income: Sales stays 0 although the NextTrade deposit carries the Sales category, and it is not an uncategorized deposit', incomeCat(sp, 'sales').total === 0 && sp.in_uncategorized.total === 0 && incomeCat(sp, 'customer_payment').total === 5000, [sp.in_categories, sp.in_uncategorized]);
  var mbRow = incomeCat(sp, '__party_money_back');
  check('… it has its own NOT-P&L row on the money-in side (250, 2 lines), so taxable income = 5,000 only', mbRow.total === 250 && mbRow.count === 2 && mbRow.kind === 'not_pnl' && sp.taxable_income === 5000 && /not income/.test(mbRow.label || ''), [mbRow, sp.taxable_income]);
  check('money in is still complete: total in = 5,250 (the duplicate copy is ignored, also as money back)', sp.total_in === 5250, sp.total_in);
  var rB1 = (sp.rows || []).filter(function (r) { return r.id === 'B1'; })[0];
  check('the spending list shows the money back as a MINUS row under Professional fees, with the company and what the bank line said', !!rB1 && rB1.amount === -200 && rB1.category === 'professional_fees' && rB1.money_in === true && rB1.money_back_from === NT && rB1.bank_category === 'sales', rB1);
  var early = (await stats('2026-04-01', '2026-04-10')).sp;
  check('the month is the BANK date of the money-in line (8 April), not the later date typed on the refund (15 April): 1–10 April = 400 − 200 = 200', cat(early.categories, 'professional_fees').total === 200 && early.funds_sent_tax.money_back.total === 200, early.funds_sent_tax);
  var may = (await stats('2026-05-01', '2026-05-31')).sp;
  check('MAY (outside both): no Professional fees and no money back', cat(may.categories, 'professional_fees').total === 0 && may.funds_sent_tax.money_back.count === 0);
  // whatever the category on the money-in line
  var cats0 = [null, 'other_income', 'trucking', 'professional_fees'];
  var allSame = true;
  for (var ci = 0; ci < cats0.length; ci++) {
    world({ backCat: cats0[ci] }); var s1 = (await stats('2026-04-01', '2026-04-30')).sp;
    if (cat(s1.categories, 'professional_fees').total !== 150 || s1.taxable_income !== 5000 || cat(s1.categories, 'trucking').total !== 0 || incomeCat(s1, 'other_income').total !== 0) { allSame = false; console.log('    category', cats0[ci], JSON.stringify(s1.categories).substring(0, 300)); }
  }
  check('the same result whatever category the money-in line carries (none, Other income, Trucking, Professional fees)', allSame);
  // ── Accountant pack (files 7, 8, 12) ──
  world(); sp = (await stats('2026-04-01', '2026-04-30')).sp;
  var TP = require(path.join(root, 'src/lib/tax-pack.js'));
  var f7 = TP.spendingByCategoryCsv(sp, {}).join('\n'); var f8 = TP.spendingDetailCsv(sp).join('\n'); var f12 = TP.incomeStatementCsv(sp).join('\n');
  check('file 7: Professional fees 150, and a "less money back" line of −250 under the transfers line', /"Professional fees",[^,\n]*,\d+,150\.00/.test(f7) && /less money back from RTM \/ NextTrade[^\n]*,,2,-250\.00/.test(f7), f7);
  check('file 8: the money back is a minus row (−200.00 under professional_fees)', /DEPOSIT FROM NEXTTRADE",-200\.00,professional_fees/.test(f8), f8);
  check('file 12: revenue 5,000 (money back is neither revenue nor other income), operating expenses 150', /"Revenue \(cash received\)",5000\.00/.test(f12) && /"Operating expenses",-150\.00/.test(f12) && /"Other income",0\.00/.test(f12), f12);
  // drill / export agreement: the detail rows under Professional fees add up to the summary line
  var pfRows = (sp.rows || []).filter(function (r) { return r.category === 'professional_fees'; }).reduce(function (s, r) { return s + r.amount; }, 0);
  check('drill / export agree: the Professional fees rows of the list (400 − 200 − 50) add up to the summary 150', Math.round(pfRows * 100) === 15000, pfRows);
  // ── internal / real-cost view (Codex 09:54 P2): returning unused money is a funds movement, never a fee or a negative fee ──
  var UI = require(path.join(root, 'src/components/PeriodStatsTab.jsx'));
  function internal(sp0) { var c = sp0.categories; (sp0.paid_through || []).forEach(function (b) { c = UI.rtmAdjust(c, b); }); return c; }
  function pnlOf(cats) { return Math.round(cats.reduce(function (s, c) { return s + (c.kind === 'not_pnl' ? 0 : c.total); }, 0) * 100) / 100; }
  function companyPnl(cats) { return Math.round(cats.reduce(function (s, c) { return s + (/^__pt_/.test(c.key) && c.kind !== 'not_pnl' ? c.total : 0); }, 0) * 100) / 100; }
  var intl = internal(sp);
  var negFee = intl.filter(function (c) { return /^__pt_/.test(c.key) && c.kind !== 'not_pnl' && c.total < -0.004; });
  var retN = intl.filter(function (c) { return c.money_back === true && /nextrade|next_trade|nexttrade/i.test(c.key); })[0];
  check('APRIL internal view: NO negative service-fee / expense row for any company', negFee.length === 0, negFee);
  check('… NextTrade\'s 200 back (of March\'s transfer) is its own NOT-P&L row "Money returned by NextTrade", naming the bank line and the transfer', !!retN && retN.kind === 'not_pnl' && retN.total === -200 && retN.money_back_rows.length === 1 && retN.money_back_rows[0].id === 'B1' && retN.money_back_rows[0].transfer_id === 'T1', retN);
  var bR = (sp.paid_through || []).filter(function (b) { return b.payer === RTM; })[0];
  check('… RTM\'s 50 back of its OWN April transfer lowers that transfer\'s unused part (RTM fee 400 − 50 = 350), no "returned" row and nothing counted twice', !!bR && bR.payments_total === 400 && bR.money_back === 50 && bR.back_same === 50 && bR.money_back_other === 0 && companyPnl(intl.filter(function (c) { return /rtm/i.test(c.key); })) === 350, bR);
  check('internal and cash views reconcile as MONEY (every category incl. not-P&L rows adds up to the same total) — a cash check, not a P&L claim', Math.round(sp.categories.reduce(function (s, c) { return s + c.total; }, 0) * 100) === Math.round(intl.reduce(function (s, c) { return s + c.total; }, 0) * 100));
  // Codex's fixture: NextTrade a service provider from 1 Jan, March transfer 1,000, NO bills / services, April return 200
  world({ noRtm: true, providerFrom: '2026-01-01' });
  var mar = (await stats('2026-03-01', '2026-03-31')).sp; var apr = (await stats('2026-04-01', '2026-04-30')).sp;
  var iMar = internal(mar); var iApr = internal(apr);
  check('no-bill unused money, CASH report: March +1,000 Professional fees, April −200 (the requested presentation)', cat(mar.categories, 'professional_fees').total === 1000 && cat(apr.categories, 'professional_fees').total === -200, [cat(mar.categories, 'professional_fees'), cat(apr.categories, 'professional_fees')]);
  check('no-bill unused money, INTERNAL view: April\'s return moves internal profit by 0 (no fee, no negative fee; only a not-P&L "money returned" row of −200)', pnlOf(iApr) === 0 && companyPnl(iApr) === 0 && iApr.some(function (c) { return c.money_back === true && c.total === -200 && c.kind === 'not_pnl'; }), iApr);
  check('… and March\'s internal view is NOT changed by XR (the 1,000 still waits for bills, as before)', companyPnl(iMar) === 1000, iMar);
  // funds held / the shared funds calculation: April 8 bank refund TYPED on 3 May (Codex cross-month case)
  world({ noRtm: true, providerFrom: '2026-01-01', entryDate: '2026-05-03' });
  var a2 = (await stats('2026-04-01', '2026-04-30')).sp; var m2 = (await stats('2026-05-01', '2026-05-31')).sp;
  var fA = (a2.party_funds || []).filter(function (p) { return p.party === NT; })[0]; var fM = (m2.party_funds || []).filter(function (p) { return p.party === NT; })[0];
  check('cross-month entry: the CASH report puts the 200 in April (bank date 8 April), not May (typed 3 May)', cat(a2.categories, 'professional_fees').total === -200 && cat(m2.categories, 'professional_fees').total === 0);
  check('… the shared funds calculation agrees: April refunds 200, closing held 800, as-of April held 800; May refunds 0', !!fA && fA.period.refunds === 200 && fA.period.closing_held === 800 && fA.as_of.held === 800 && !!fM && fM.period.refunds === 0 && fM.period.opening_held === 800, [fA && fA.period, fA && fA.as_of, fM && fM.period]);
  check('… its tax figure is the refund-adjusted net (April −200 = 0 sent − 200 back), same as the cash report', !!fA && fA.period.tax_professional_fees === -200 && fA.period.tax_money_back === 200 && fA.period.tax_transfers_sent === 0 && a2.funds_sent_tax.net === -200, fA && fA.period);
  var fRow = fA ? (fA.transfers.filter(function (t) { return t.id === 'T1'; })[0] || { lifetime_refund_rows: [] }).lifetime_refund_rows[0] : null;
  check('… the typed date is KEPT for the audit (entered 3 May), the report uses the bank date (8 April), and the basis is said', !!fRow && fRow.date === '2026-04-08' && fRow.entered === '2026-05-03' && fRow.date_basis === 'bank' && fA.refund_date_basis === 'bank', fRow);
  // partial bill usage: March 1,000, a 600 bill paid from it in March, April 400 unused money back
  world({ noRtm: true, providerFrom: '2026-01-01', bill: true });
  var pMar = (await stats('2026-03-01', '2026-03-31')).sp; var pApr = (await stats('2026-04-01', '2026-04-30')).sp;
  var ipMar = internal(pMar); var ipApr = internal(pApr);
  var fP = (pApr.party_funds || []).filter(function (p) { return p.party === NT; })[0];
  check('partial use, internal March: the 600 bill in its real category (Trucking) and 400 waiting — as before XR', cat(ipMar, 'trucking').total === 600 && companyPnl(ipMar) === 400, ipMar);
  check('partial use, internal April: the 400 back is a not-P&L "money returned" row; internal profit moves by 0', pnlOf(ipApr) === 0 && ipApr.some(function (c) { return c.money_back === true && c.total === -400; }), ipApr);
  check('partial use, cash April: Professional fees −400; funds held after April = 0 (1,000 − 600 bill − 400 back)', cat(pApr.categories, 'professional_fees').total === -400 && !!fP && fP.period.closing_held === 0, [cat(pApr.categories, 'professional_fees'), fP && fP.period]);
  // a refund-only month exports NUMERIC cells (Codex 09:54 P2: "--200.00")
  var g12 = TP.incomeStatementCsv(apr); var g7 = TP.spendingByCategoryCsv(apr, {});
  var opx = (g12.filter(function (l) { return l.indexOf('"Operating expenses",') === 0; })[0] || '').split(',')[1];
  check('refund-only month, file 12: "Operating expenses" is the number 200.00 (a cost of −200 shown with its sign), every amount cell is numeric', opx === '200.00' && g12.slice(1).every(function (l) { var v = l.substring(l.lastIndexOf(',') + 1); return /^-?\d+\.\d{2}$/.test(v); }), g12);
  check('refund-only month, file 7: the "less money back" cell is -200.00 (numeric), no "--"', g7.join('\n').indexOf('--') < 0 && g7.some(function (l) { return /less money back/.test(l) && /,-200\.00$/.test(l); }), g7);
  // ── no refunds / read failure (Codex 09:54 P2) ──
  world({ noEntries: true }); var n0 = (await stats('2026-04-01', '2026-04-30')).sp;
  check('no refunds recorded: everything exactly as before XR (Professional fees 400; the deposits keep their own categories), complete', cat(n0.categories, 'professional_fees').total === 400 && incomeCat(n0, 'sales').total === 200 && n0.funds_sent_tax.money_back.count === 0 && !n0.incomplete && n0.taxable_income === 5200, n0.in_categories);
  world({ readError: true, installed: true }); var e0 = (await stats('2026-04-01', '2026-04-30')).sp;
  check('read FAILURE on an installed system: the report is marked INCOMPLETE; taxable income, deductible spending and the net are withheld (null)', !!e0 && !!e0.incomplete && /could not be read/.test(e0.incomplete.reason || '') && e0.taxable_income === null && e0.deductible_spending === null && e0.funds_sent_tax.net === null, e0 && [e0.incomplete, e0.taxable_income]);
  var eb12 = TP.incomeStatementCsv(e0).join('\n'); var eb7 = TP.spendingByCategoryCsv(e0, {}).join('\n'); var eb8 = TP.spendingDetailCsv(e0).join('\n');
  check('… the Accountant pack files 7 / 8 / 12 contain NO figures, only "NOT AVAILABLE — incomplete" (no Revenue 5,200 / Operating expenses 400)', [eb7, eb8, eb12].every(function (x) { return /NOT AVAILABLE - this report is incomplete/.test(x) && !/5200\.00|400\.00/.test(x); }) && TP.taxPackBlocked(e0) !== null, eb12);
  var ui = fs.readFileSync(path.join(root, 'src/components/PeriodStatsTab.jsx'), 'utf8');
  check('… the screen refuses the pack download and shows the red INCOMPLETE notice; taxable income / deductible spending show "not available"', ui.indexOf('var blockedWhy = data && data.spending ? taxPackBlocked(data.spending) : null;') > 0 && ui.indexOf('if (blockedWhy) { toast.error(') > 0 && ui.indexOf('{data.spending.incomplete && <div') > 0 && ui.indexOf("data.spending.taxable_income === null ? 'not available (incomplete)'") > 0 && ui.indexOf("data.spending.deductible_spending === null ? 'not available (incomplete)'") > 0 && ui.indexOf("taxPackBlocked } from '../lib/tax-pack'") > 0);
  // (Codex 10:32 P2) the Income Statement itself, RENDERED: Codex's fixture — failed read on an installed system, every deposit categorized
  var RDS = require('react-dom/server'); var React = require('react');
  world({ readError: true, installed: true, b2Cat: 'customer_payment' }); var c0 = (await stats('2026-04-01', '2026-04-30')).sp;
  var html0 = UI.incomeStatementBlocked(c0) ? RDS.renderToStaticMarkup(React.createElement(UI.IncomeStatementUnavailable, { why: c0.incomplete.reason, from: '2026-04-01', to: '2026-04-30' })) : '(statement would render with figures)';
  var text0 = html0.replace(/<[^>]+>/g, ' ');
  check('all-categorized failed read: the route says incomplete, the screen\'s own check BLOCKS the statement, and the rendered statement shows NOT AVAILABLE with no amount, no Revenue / NET PROFIT line and no "covers the whole period" claim', !!c0.incomplete && c0.taxable_income === null && UI.incomeStatementBlocked(c0) === true && /NOT AVAILABLE/.test(text0) && !/\$\s?[0-9]|[0-9],[0-9]{3}|[0-9]\.[0-9]{2}/.test(text0.replace(/2026-0[0-9]-[0-9]{2}/g, '')) && !/Revenue [(]cash|GROSS PROFIT|NET PROFIT|Operating expenses|whole period|Every transaction/.test(text0), text0);
  world({ b2Cat: 'customer_payment' }); var ok0 = (await stats('2026-04-01', '2026-04-30')).sp;
  check('… after a successful reload the normal statement is shown again (the check no longer blocks; taxable income back)', UI.incomeStatementBlocked(ok0) === false && ok0.taxable_income === 5000 && !ok0.incomplete);
  var gate = fs.readFileSync(path.join(root, 'src/components/PeriodStatsTab.jsx'), 'utf8');
  check('… the screen renders EITHER the unavailable box OR the figures, through that one check (both views: tax and real-cost share this block)', gate.indexOf('{data.spending.in_categories && incomeStatementBlocked(data.spending) && <IncomeStatementUnavailable') > 0 && gate.indexOf('{data.spending.in_categories && !incomeStatementBlocked(data.spending) && (function () {') > 0 && (gate.match(/data\.spending\.in_categories && \(function/g) || []).length === 0);
  world({ readError: 'relation "public.party_money_entries" does not exist', installed: false }); var x0 = (await stats('2026-04-01', '2026-04-30')).sp;
  check('a POSITIVELY missing prerequisite (WF not installed AND the table missing) keeps the old complete report (no refunds can exist)', !!x0 && !x0.incomplete && x0.taxable_income === 5200, x0 && [x0.incomplete, x0.taxable_income]);
  world({ readError: 'relation "public.party_money_entries" does not exist', installed: true }); var y0 = (await stats('2026-04-01', '2026-04-30')).sp;
  check('… but the same "missing table" on a system where WF IS installed is a failure: incomplete', !!y0 && !!y0.incomplete && y0.taxable_income === null);
  // ── wiring ──
  var src = fs.readFileSync(path.join(root, 'src/app/api/accounting/bills/route.js'), 'utf8');
  var xAt = src.indexOf('v55.83-XR (Max, 22 Nov 2026'); var xBlk = xAt > 0 ? src.substring(xAt, src.indexOf('spTx.forEach(function (t6) {', xAt)) : '';
  check('API route style kept in the new XR block: no arrow functions / template strings / const / let', xBlk.length > 200 && !/=>/.test(xBlk) && !/`/.test(xBlk) && !/\b(const|let)\s/.test(xBlk));
  var wn = fs.readFileSync(path.join(root, 'src/components/WhatsNewWidget.jsx'), 'utf8').split('\r\n').join('\n');
  var xfAt = wn.indexOf("version: 'v55.83-XR'"); var xfEnd = wn.indexOf('\n  },\n', xfAt); var xfText = xfAt > 0 && xfEnd > xfAt ? wn.substring(xfAt, xfEnd) : '';
  check('the XR release note is the newest entry and carries NO money amount', xfAt > 0 && xfAt < wn.indexOf("version: 'v55.83-WD'") && xfText.length > 200 && !/\$\s?[0-9]/.test(xfText) && !/[0-9][0-9,]{3,}\.[0-9]{2}/.test(xfText));
  var pg = fs.readFileSync(path.join(root, 'src/app/page.jsx'), 'utf8');
  check('What\'s New keeps the XR entry and the badge names the newest entry (XR or later)', (function () { var wnT = require('fs').readFileSync(require('path').join(__dirname, '..', 'src/components/WhatsNewWidget.jsx'), 'utf8'); var top = /BUILD_HISTORY = \[\s*\{\s*version: '(v55\.83-[A-Z]+)'/.exec(wnT); return /version: 'v55\.83-XR'/.test(wnT) && !!top && pg.indexOf('>' + top[1] + '</span>') > 0; })());

  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('CRASHED: ' + (e && e.stack || e)); process.exit(1); });
