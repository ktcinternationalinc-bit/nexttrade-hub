// v55.83-VQ — Profitability → P&L by period, stage 2 (Max, Nov 19 2026: "where are the rest of the columns and the total final pnl
// per month" · expense columns "A Warehouse/Office Costs ... C Partner Fee, D Salary - Payroll, E Taxes" · "remove column b
// dealing with commissions").
// The expenses are NOT worked out a second time here. They are the Income Statement's own figures (Accounting → Stats, action
// period_stats: KTC's bank record by payment date, with money sent to RTM / NextTrade replaced by the bills it paid — the
// "real cost" look), asked for once per period. This file only (1) says which dates a period covers and (2) puts each of the
// Income Statement's categories into a column. Pure; money in whole cents.

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
  { key: 'unassigned', label: 'Uncategorized expenses', counted: false }
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
  var text = (key + ' ' + String(c.label || '')).toLowerCase().replace(/_/g, ' ');
  if (kind === 'transfer' || kind === 'not_pnl') { return 'not_pnl'; }
  if (kind === 'income' || kind === 'other_income') { return 'income'; }
  if (!key || key === 'uncategorized' || key === 'needs_clarification' || key === 'other_expense' || /waiting$/.test(key) || /needs clarification|waiting for bills/.test(text)) { return 'unassigned'; }
  if (kind === 'cogs') { return 'in_profit'; }
  if (/commission/.test(text)) { return 'in_profit'; }
  if (/\btax/.test(text)) { return 'E'; }
  if (/payroll|salar|wage|labou?r|staff/.test(text)) { return 'D'; }
  if (/partner|management fee|professional|service fee/.test(text) || /^__pt_.*_fee$/.test(key)) { return 'C'; }
  if (/vendor payment|supplier|purchase|freight|truck|shipping|logistic|brokerage|bonded|customs|inspection/.test(text)) { return 'in_profit'; }
  return 'A';
}

// One period's expenses in columns. cats = the Income Statement's spending categories for that period, already in the
// real-cost look ([{ key, label, kind, total }]); uncategorized = its "uncategorized" money out (a number).
// Returns { A, C, D, E, unassigned, in_profit: { cents, cats: [{ key, label, cents }] }, total (cents, A + C + D + E only) }.
export function expenseColumns(cats, uncategorized) {
  var out = {}; ['A', 'C', 'D', 'E', 'unassigned', 'in_profit'].forEach(function (k) { out[k] = { cents: 0, cats: [] }; });
  (cats || []).forEach(function (c) {
    var l = letterOf(c); if (!out[l]) { return; }
    var v = cents(c.total); if (!v) { return; }
    out[l].cents += v; out[l].cats.push({ key: c.key, label: c.label || c.key, cents: v });
  });
  var u = cents(uncategorized);
  if (u) { out.unassigned.cents += u; out.unassigned.cats.push({ key: 'uncategorized', label: 'No category at all', cents: u }); }
  ['A', 'C', 'D', 'E', 'unassigned', 'in_profit'].forEach(function (k) { out[k].cats.sort(function (a, b) { return b.cents - a.cents; }); });
  out.total = out.A.cents + out.C.cents + out.D.cents + out.E.cents;
  return out;
}

// The final figure of a period: total profit − the four expense columns. It is only COMPLETE when nothing is left unassigned
// and no sale line is missing a cost; otherwise it is the known part and says so.
export function finalPnl(profitCents, cols, incompleteLines) {
  if (profitCents === null || profitCents === undefined || !cols) { return { cents: null, complete: false }; }
  return { cents: profitCents - cols.total, complete: cols.unassigned.cents === 0 && !(incompleteLines > 0) };
}

// The Income Statement's categories in its real-cost look, exactly as that screen builds them: every paid-through company's
// payments taken out of the category they were paid under and its bills put into their own. adjust / fold are that screen's own
// functions (rtmAdjust, foldUnc), passed in so there is one copy of the rule.
export function realCostCategories(spending, adjust, fold) {
  if (!spending) { return null; }
  var cats = spending.categories || [];
  (spending.paid_through || []).forEach(function (b) { cats = adjust(cats, b); });
  var folded = fold(cats);
  var unc = (spending.uncategorized && Number(spending.uncategorized.total)) || 0;
  return { cats: folded, uncategorized: Math.round((unc + (Number(folded.uncShift) || 0)) * 100) / 100 };
}
