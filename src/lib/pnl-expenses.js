// v55.83-VQ — Profitability → P&L by period, stage 2 (Max, Nov 19 2026: "where are the rest of the columns and the total final pnl
// per month" · expense columns "A Warehouse/Office Costs ... C Partner Fee, D Salary - Payroll, E Taxes" · "remove column b
// dealing with commissions").
// The expenses are NOT worked out a second time here. They are the Income Statement's own figures (Accounting → Stats, action
// period_stats: KTC's bank record by payment date, with money sent to RTM / NextTrade replaced by the bills it paid — the
// "real cost" look), asked for once per period. This file only (1) says which dates a period covers and (2) puts each of the
// Income Statement's categories into a column. Pure; money in whole cents.

import { expenseDetail } from './pnl-expense-detail'; // v55.83-VT — what is behind each figure, from the same answer
import { rtmFeeResidual } from './paid-through-blocks';

function cents(x) { return Math.round((Number(x) || 0) * 100); }
function pad(n) { return (n < 10 ? '0' : '') + n; }

// the first and last day of a period key made by bucketOf (src/lib/pnl-period.js). null for the "no date" bucket.
export function bucketRange(key, gran) {
  var k = String(key || '');
  if (gran === 'year' && /^\d{4}$/.test(k)) { return { from: k + '-01-01', to: k + '-12-31' }; }
  var q = k.match(/^(\d{4})-Q([1-4])$/);
  if (gran === 'quarter' && q) { var m0 = (+q[2] - 1) * 3; return { from: q[1] + '-' + pad(m0 + 1) + '-01', to: new Date(Date.UTC(+q[1], m0 + 3, 0)).toISOString().substring(0, 10) }; }
  var mo = k.match(/^(\d{4})-(\d{2})$/);
  if (gran === 'month' && mo) { return { from: k + '-01', to: new Date(Date.UTC(+mo[1], +mo[2], 0)).toISOString().substring(0, 10) }; }
  if (gran === 'week' && /^\d{4}-\d{2}-\d{2}$/.test(k)) { var t = Date.parse(k + 'T00:00:00Z'); if (!isNaN(t)) { return { from: k, to: new Date(t + 6 * 86400000).toISOString().substring(0, 10) }; } }
  return null;
}

export var EXPENSE_COLUMNS = [
  { key: 'A', label: 'A · Warehouse / Office', counted: true },
  { key: 'C', label: 'C · Partner fee', counted: true },
  { key: 'D', label: 'D · Payroll', counted: true },
  { key: 'E', label: 'E · Taxes', counted: true },
  { key: 'unassigned', label: 'Uncategorized expenses', counted: false },
  { key: 'held', label: 'Funds held with RTM / NextTrade', counted: false }
];

// Which column one Income Statement category belongs to. cat = { key, label, kind }.
//   'A' 'C' 'D' 'E'  an expense column, taken off the profit
//   'unassigned'     money out with no usable category yet — SHOWN, never guessed into a column, not taken off
//   'in_profit'      already inside goods profit or transport profit (suppliers, goods cost, freight, trucking, brokerage,
//                    commission) — shown for information, NEVER taken off a second time
//   'not_pnl'        transfers, loans, owner money, advances held     'income'  money in
// There is no commission column (Max): commission stays inside goods profit only.
export function letterOf(cat) {
  var c = cat || {}; var kind = String(c.kind || 'expense'); var key = String(c.key || '').toLowerCase();
  var label = String(c.label || '').toLowerCase();
  var text = (key + ' ' + label).replace(/[_-]/g, ' ');
  // The held balance is a reference. The period's RTM provisional fee and
  // recorded fees are office expenses.
  if (/^__pf_/.test(key)) { return /_fee$/.test(key) ? 'A' : 'held'; } // rows made from the shared funds calculation (party-funds.js)
  if (/^__pt_/.test(key)) { return /_fee$/.test(key) ? 'A' : 'held'; }
  if (key === '__party_advance') { return 'held'; }
  if (kind === 'transfer' || kind === 'not_pnl') { return 'not_pnl'; }
  if (kind === 'income' || kind === 'other_income') { return 'income'; }
  if (!key || key === 'uncategorized' || key === 'needs_clarification' || key === 'other_expense' || /waiting$/.test(key) || /needs clarification|waiting for bills/.test(text)) { return 'unassigned'; }
  if (kind === 'cogs' || /commission|\bgoods cost\b|\binbound allowance\b/.test(text)) { return 'in_profit'; }
  if (/\btax/.test(text)) { return 'E'; }
  if (/payroll|salar|wage|labou?r|staff/.test(text)) { return 'D'; }
  // Max, Nov 19: "professional fee is not a partner fee" — C is ONLY a category named partner fee / management fee. Professional
  // fees, and what is left of the money sent to RTM / NextTrade after the bills it paid (their service fee), are office costs → A.
  if (/partner|management fee/.test(text)) { return 'C'; }
  if (/vendor payment|supplier|purchase|freight|truck|shipping|logistic|brokerage|bonded|customs|inspection/.test(text)) { return 'in_profit'; }
  var shipmentTransport = /^(?:(?:inbound|outbound) )?transport(?:ation)?(?: charg(?:ed|es?)| costs?)?$/;
  if (shipmentTransport.test(key.replace(/[_-]/g, ' ')) || shipmentTransport.test(label.replace(/[_-]/g, ' '))) { return 'in_profit'; }
  return 'A';
}

// One period's expenses in columns. cats = the Income Statement's spending categories for that period, already in the
// real-cost look ([{ key, label, kind, total }]); uncategorized = its "uncategorized" money out (a number).
// Returns { A, C, D, E, unassigned, in_profit: { cents, cats: [{ key, label, cents }] }, total (cents, A + C + D + E only) }.
export function expenseColumns(cats, uncategorized) {
  var out = {}; ['A', 'C', 'D', 'E', 'unassigned', 'in_profit', 'held'].forEach(function (k) { out[k] = { cents: 0, cats: [] }; });
  (cats || []).forEach(function (c) {
    var l = letterOf(c); if (!out[l]) { return; }
    // v55.83-WO — a NET category (returned checks: returns minus the deposits that were returned) is kept even at exactly 0, so the
    // pair behind the zero can still be opened and checked
    var v = cents(c.total); var netCat = c.net === true && (Number(c.credits) > 0 || Number(c.debits) > 0); if (!v && !netCat) { return; }
    if (/_provisional_fee$/.test(c.key)) { out.rtm_provisional_cents = (out.rtm_provisional_cents || 0) + v; }
    out[l].cents += v; var oc = { key: c.key, label: c.label || c.key, cents: v }; if (netCat) { oc.net = true; oc.debits_cents = cents(c.debits); oc.credits_cents = cents(c.credits); } out[l].cats.push(oc);
  });
  var u = cents(uncategorized);
  if (u) { out.unassigned.cents += u; out.unassigned.cats.push({ key: 'uncategorized', label: 'No category at all', cents: u }); }
  ['A', 'C', 'D', 'E', 'unassigned', 'in_profit', 'held'].forEach(function (k) { out[k].cats.sort(function (a, b) { return b.cents - a.cents; }); });
  out.total = out.A.cents + out.C.cents + out.D.cents + out.E.cents;
  out.unconfirmed = out.held.cats.reduce(function (a, c) { return a + (/_unconfirmed$/.test(String(c.key)) ? c.cents : 0); }, 0); // v55.83-VY
  return out;
}

// v55.83-XQ (Max, Nov 22: "show that number so I know it ... it won't fit into the calculation of the P&L because it's already
// been taken"; Codex 23 Nov 12:09 + 18:46 scoped FAILs on XP). The figure must count EVERY bill RTM / NextTrade settled for KTC
// in the period, from ALL THREE of the shared funds calculation's DISJOINT period sources:
//   period.applied_to_bills              — bills paid from a named funding transfer
//   period.from_starting_balance         — bills paid from a starting balance (v55.83-XO)
//   paid_without_a_transfer.period_total — bills paid through the company with no transfer named yet
// Each bill is counted once. `unlinked` returns ONLY the last source (so the screen can label it "funding transfer not linked");
// the starting-balance source is counted in the total but is NOT part of `unlinked`. Nothing else is added here — not the
// starting balance's own amount, not held money, not fees, not any lifetime / as-of value. Moving a payment between the three
// sources (e.g. naming a starting balance on an unlinked payment) leaves the TOTAL unchanged; only the breakdown moves.
// It is NOT a column and is NEVER taken off the profit: each of those bills is already counted once under its own category
// (goods / transport / warehouse), so held funds, allocations, category expenses and the final / tax P&L are untouched.
export function paidThroughBreakdown(sp) {
  var out = { total: 0, unlinked: 0 };
  if (!sp) { return out; }
  if (Array.isArray(sp.party_funds)) {
    sp.party_funds.forEach(function (f) { var p = f.period || {}; var pw = f.paid_without_a_transfer || {}; var u = cents(pw.period_total); out.total += cents(p.applied_to_bills) + cents(p.from_starting_balance) + u; out.unlinked += u; });
    return out;
  }
  (sp.paid_through || (sp.rtm ? [sp.rtm] : [])).forEach(function (b) { out.total += cents(b.allocations_total); });
  return out;
}
// The total only (bills RTM / NextTrade settled this period). A FLOW: the Total row sums it across periods, unlike `held`
// (a balance). NextTrade rides on the same paid-through engine, so its bills fold in here too.
export function paidThroughBillsCents(sp) { return paidThroughBreakdown(sp).total; }

// The final figure of a period: total profit − the four expense columns. It is only COMPLETE when nothing is left unassigned
// and no sale line is missing a cost; otherwise it is the known part and says so.
export function finalPnl(profitCents, cols, incompleteLines) {
  if (profitCents === null || profitCents === undefined || !cols) { return { cents: null, complete: false, assumed: 0 }; }
  // v55.83-VQ (Codex 22:50 P2) — `assumed` = money left out ONLY because its category name says supplier / trucker / broker /
  // commission ("already inside goods and transport profit"). That is an assumption from a name, not a line-by-line check, so a
  // final figure that rests on it is never called complete.
  // unconfirmed = transfers to a company's account that nobody has confirmed: left out of the expenses, but the figure rests on that
  return { cents: profitCents - cols.total, assumed: cols.in_profit.cents, unconfirmed: cols.unconfirmed || 0, rtm_provisional_cents: cols.rtm_provisional_cents || 0,
    complete: cols.unassigned.cents === 0 && cols.in_profit.cents === 0 && !(cols.unconfirmed > 0) && !(cols.rtm_provisional_cents > 0) && !(incompleteLines > 0) };
}

// The Income Statement's categories in its real-cost look, exactly as that screen builds them: every paid-through company's
// payments taken out of the category they were paid under and its bills put into their own. adjust / fold are that screen's own
// functions (rtmAdjust, foldUnc), passed in so there is one copy of the rule.
function slugOf(x) { return String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '_'); }
// Keep the bank balance separate from P&L activity. RTM's provisional and
// recorded fees together equal its transfer residual after allocated bills.
export function partyFundsRows(cats, funds, blocks) {
  var out = (cats || []).filter(function (c) { return !/^__pt_/.test(String(c.key)) && c.key !== '__party_advance'; }).map(function (c) { return Object.assign({}, c); });
  var meta = { unconfirmed: 0, duplicates: 0, needs_reconciliation: false };
  (funds || []).forEach(function (f) {
    var p = f.period || {}; var base = '__pf_' + slugOf(f.party);
    var recorded = Number(p.fee_deduction) || 0;
    if (Math.abs(recorded) > 0.004) { out.push({ key: base + '_fee', label: f.party + ' — recorded service fees', kind: 'expense', count: (p.fee_rows || []).length + (p.loose_fee_rows || []).length, total: recorded }); }
    if (base === '__pf_rtm_capital') {
      // Reclassifying a fee against an older transfer releases its former
      // provisional amount even when this period has no bank transfer.
      var residual = rtmFeeResidual(blocks, f);
      var provisional = (cents(residual) - cents(recorded)) / 100;
      if (provisional) { out.push({ key: base + '_provisional_fee', label: provisional > 0 ? 'RTM — provisional Professional Fees' : 'RTM — provisional Professional Fees adjustment', kind: 'expense', count: 0, total: provisional }); }
    }
    if (Math.abs(Number(p.closing_held) || 0) > 0.004) { out.push({ key: base + '_held', label: f.party + ' — held with them at the end of these dates', kind: 'not_pnl', count: 0, total: Number(p.closing_held) }); }
    (f.transfers || []).forEach(function (t) { if (t.identity === 'bank_text' && (!p.from || t.date >= p.from) && (!p.to || t.date <= p.to)) { meta.unconfirmed += Math.round((Number(t.sent) || 0) * 100); } });
    (f.duplicate_bank_lines || []).forEach(function (d) { if ((!p.from || d.date >= p.from) && (!p.to || d.date <= p.to)) { meta.duplicates += Math.round((Number(d.sent) || 0) * 100); } });
    if (f.needs_reconciliation) { meta.needs_reconciliation = true; }
  });
  return { cats: out, meta: meta };
}
export function explicitFeeRows(cats, blocks) {
  var out = (cats || []).map(function (c) { return Object.assign({}, c); });
  (blocks || []).forEach(function (b) {
    var extra = Math.round(((Number(b.explicit_fees) || 0) - (Number(b.fees_booked) || 0)) * 100) / 100; if (!(extra > 0.004)) { return; }
    var base = '__pt_' + String(b.key || b.payer || 'rtm').toLowerCase().replace(/[^a-z0-9]+/g, '_');
    var rest = out.filter(function (c) { return c.key === base; })[0]; if (!rest) { return; }
    var move = Math.min(extra, Math.max(0, Number(rest.total) || 0)); if (!(move > 0.004)) { return; }
    rest.total = Math.round((Number(rest.total) - move) * 100) / 100;
    var fee = out.filter(function (c) { return c.key === base + '_fee'; })[0];
    if (fee) { fee.total = Math.round((Number(fee.total) + move) * 100) / 100; } else { out.push({ key: base + '_fee', label: (b.payer || 'RTM') + ' — explicitly booked as their fee', kind: 'expense', count: 0, total: move }); }
  });
  // (Codex 12:57) transfers recognised ONLY from the bank's own text, not yet marked by a person: their own row, so the screen can
  // say "not confirmed yet" — they are not an expense, and the final figure is not called complete while they exist
  (blocks || []).forEach(function (b) {
    var um = Math.round((Number(b.unmarked_total) || 0) * 100) / 100; if (!(um > 0.004)) { return; }
    var base = '__pt_' + String(b.key || b.payer || 'rtm').toLowerCase().replace(/[^a-z0-9]+/g, '_');
    var rest = out.filter(function (c) { return c.key === base; })[0]; var mv = rest ? Math.min(um, Math.max(0, Number(rest.total) || 0)) : 0; if (!(mv > 0.004)) { return; }
    rest.total = Math.round((Number(rest.total) - mv) * 100) / 100;
    out.push({ key: base + '_unconfirmed', label: (b.payer || 'RTM') + ' — transfers to its account that nobody has confirmed yet', kind: 'not_pnl', count: 0, total: mv });
  });
  return out.filter(function (c) { return Math.abs(Number(c.total) || 0) > 0.004 || c.via_rtm || c.rtm_out; });
}
export function realCostCategories(spending, adjust, fold) {
  if (!spending) { return null; }
  var cats = spending.categories || [];
  var blocks = spending.paid_through || (spending.rtm ? [spending.rtm] : []);
  blocks.forEach(function (b) { cats = adjust(cats, b); });
  var fundsMeta = null;
  if (Array.isArray(spending.party_funds)) { var pf = partyFundsRows(cats, spending.party_funds, blocks); cats = pf.cats; fundsMeta = pf.meta; }
  else {
    cats = explicitFeeRows(cats, blocks);
    var fallback = rtmFeeResidual(blocks);
    if (fallback !== null) {
      var rtmKeys = blocks.filter(function (b) { return String(b.payer || '').trim().toLowerCase() === 'rtm capital'; }).map(function (b) { return '__pt_' + slugOf(b.key || b.payer); });
      cats = cats.filter(function (row) { return !rtmKeys.some(function (key) { return row.key === key || row.key.indexOf(key + '_') === 0; }); });
      if (fallback) { cats.push({ key: '__pt_rtm_capital_provisional_fee', label: 'RTM — Professional Fees after linked bills', kind: 'expense', count: 0, total: fallback }); }
    }
  }
  var folded = fold(cats);
  var unc = (spending.uncategorized && Number(spending.uncategorized.total)) || 0;
  return { cats: folded, uncategorized: Math.round((unc + (Number(folded.uncShift) || 0)) * 100) / 100, funds: fundsMeta };
}

// ── v55.83-VQ (Codex 19 Nov 22:20 / 22:35) — WHICH dates are asked, and what an answer means. All pure, so the flow is tested.
// The scope of a set of answers: grouping, the report's own dates and the person. Answers from another scope are never shown.
// v55.83-VR (Codex 23:00 P3) — ONE place that says why the expense columns are off, used by the line beside the table, the opened
// period and the CSV, so the three can never disagree. null = expenses are on.
export function expensesOffReason(releasesAll, hasFrom) {
  if (!releasesAll) { return { code: 'releases', short: 'expenses are shown with Releases: All', long: 'Expenses and the final P&L are shown with Releases: All (they are the whole company’s and cannot be split by release).' }; }
  if (!hasFrom) { return { code: 'no_from', short: 'set a From date to see expenses', long: 'Set a From date at the top and press Apply to see expenses and the final P&L — without a start date the months before the first sale cannot be known.' }; }
  return null;
}
export function expenseScope(gran, reportFrom, reportTo, userId) { return [gran || '', reportFrom || '', reportTo || '', userId || ''].join('|'); }

// One request per period, with the period's dates CUT to the report's own dates — a report for 10–19 Nov asks for 10–19 Nov,
// not the whole of November — so the profit and the expenses of a row always cover the same days. `partial` says it was cut.
export function expenseRequests(keys, gran, reportFrom, reportTo) {
  var out = [];
  (keys || []).forEach(function (k) {
    var r = bucketRange(k, gran); if (!r) { return; }
    var f = reportFrom && reportFrom > r.from ? reportFrom : r.from; var t = reportTo && reportTo < r.to ? reportTo : r.to;
    if (f > t) { return; }
    out.push({ key: k, from: f, to: t, partial: f !== r.from || t !== r.to });
  });
  return out;
}

// which of those still have to be asked: the ones with no answer yet, and — when asked to retry — the ones that failed.
// `ignoreCache` = a new report was loaded: every period is asked again, whatever was known before.
export function pendingRequests(requests, cache, scope, opts) {
  var o = opts || {};
  return (requests || []).filter(function (q) { if (o.ignoreCache) { return true; } var e = cache ? cache[scope + '|' + q.key] : null; return !e || (o.retryErrors && e.status === 'error'); });
}

// What the Income Statement's answer means for one request. The answer must be for EXACTLY the dates asked (both ends): when
// the server answered for other dates (dates locked for this person), the figures are not used at all.
export function readExpenseAnswer(j, req, adjust, fold) {
  if (!j || j.ok !== true) { return { status: 'error', why: (j && j.error) || 'The expenses could not be loaded.', from: req.from, to: req.to, partial: !!req.partial }; }
  if (j.from !== req.from || j.to !== req.to) { return { status: 'outside', why: 'Expenses for ' + req.from + ' → ' + req.to + ' are not open to you (the Income Statement only answers for ' + j.from + ' → ' + j.to + ').', from: req.from, to: req.to, partial: !!req.partial }; }
  if (j.spending_restricted) { return { status: 'locked', why: (j.spending_restricted.words || 'Expenses for these dates are withheld: they include a starting balance only the super admin may see.'), restricted: true, from: req.from, to: req.to, partial: !!req.partial }; } // v55.83-XO (Codex 14:52 P1)
  if (!j.spending) { return { status: 'locked', why: 'Expenses are shown only to people with the “see totals” switch.', from: req.from, to: req.to, partial: !!req.partial }; }
  var rc = realCostCategories(j.spending, adjust, fold);
  var colsR = expenseColumns(rc.cats, rc.uncategorized);
  if (rc.funds) { colsR.unconfirmed = rc.funds.unconfirmed; colsR.duplicates = rc.funds.duplicates; colsR.funds_need_reconciliation = rc.funds.needs_reconciliation; colsR.held_is_balance = true; }
  var ptb = paidThroughBreakdown(j.spending); colsR.paid_through_cents = ptb.total; colsR.paid_through_unlinked_cents = ptb.unlinked; // v55.83-XQ — view-only: bills RTM / NextTrade settled this period (linked + unlinked); never added to the P&L
  return { status: 'ok', cols: colsR, detail: expenseDetail(j.spending, rc), from: j.from, to: j.to, partial: !!req.partial };
}

// Asks for the periods one after another. o = { requests, fetchOne(req) → Promise of the answer, put(key, result),
// isCurrent() → false once a newer report / grouping / person has replaced this run, adjust, fold }.
// A failed request is recorded as an error for THAT period and the run goes on. An answer that arrives after the run was
// replaced is thrown away. Returns how it ended: { asked, done, superseded }.
export async function loadExpensePeriods(o) {
  var reqs = o.requests || []; var done = 0;
  reqs.forEach(function (q) { o.put(q.key, { status: 'loading', from: q.from, to: q.to, partial: !!q.partial }); });
  for (var i = 0; i < reqs.length; i++) {
    var q = reqs[i]; var res;
    if (!o.isCurrent()) { return { asked: reqs.length, done: done, superseded: true }; }
    try { res = readExpenseAnswer(await o.fetchOne(q), q, o.adjust, o.fold); } catch (e) { res = { status: 'error', why: 'The expenses could not be loaded.', from: q.from, to: q.to, partial: !!q.partial }; }
    if (!o.isCurrent()) { return { asked: reqs.length, done: done, superseded: true }; }
    o.put(q.key, res); done += 1;
  }
  return { asked: reqs.length, done: done, superseded: false };
}

// The Total row: the sum of the periods — and whether it is the whole story. `complete` only when EVERY period of the report
// has an answer; otherwise the final figure of the total is not shown at all (a total with periods missing is not a total).
export function totalExpenses(keys, cache, scope) {
  var t = { status: 'ok', cols: expenseColumns([], 0), complete: true, loaded: 0, loading: 0, failed: 0, unavailable: 0, missing: 0, periods: (keys || []).length };
  (keys || []).forEach(function (k) {
    var e = cache ? cache[scope + '|' + k] : null;
    if (!e) { t.missing += 1; t.complete = false; return; }
    if (e.status === 'loading') { t.loading += 1; t.complete = false; return; }
    if (e.status === 'error') { t.failed += 1; t.complete = false; return; }
    if (e.status !== 'ok') { t.unavailable += 1; t.complete = false; return; }
    t.loaded += 1; ['A', 'C', 'D', 'E', 'unassigned', 'in_profit'].forEach(function (c) { t.cols[c].cents += e.cols[c].cents; });
    // held is a BALANCE at the end of each period (not a flow): the total row shows the latest period's, never a sum of balances
    if (e.cols.held_is_balance) { t.cols.held.cents = e.cols.held.cents; t.cols.held_is_balance = true; } else { t.cols.held.cents += e.cols.held.cents; }
    t.cols.duplicates = (t.cols.duplicates || 0) + (e.cols.duplicates || 0); t.cols.total += e.cols.total; t.cols.unconfirmed = (t.cols.unconfirmed || 0) + (e.cols.unconfirmed || 0);
    t.cols.rtm_provisional_cents = (t.cols.rtm_provisional_cents || 0) + (e.cols.rtm_provisional_cents || 0);
    t.cols.paid_through_cents = (t.cols.paid_through_cents || 0) + (e.cols.paid_through_cents || 0); // v55.83-XQ — a flow: summed across periods (not a balance)
    t.cols.paid_through_unlinked_cents = (t.cols.paid_through_unlinked_cents || 0) + (e.cols.paid_through_unlinked_cents || 0);
  });
  return t;
}
