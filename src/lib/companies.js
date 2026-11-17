// v55.83-TW — THREE SEPARATE COMPANIES (Max, Nov 17 2026: "They're three separate companies per se when it comes to
// categorization, all that stuff."). KTC keeps its books exactly as today (the US Wave business). Nextrade and RTM are
// two more companies with NO Wave: their own bank and credit-card accounts, categories, rules, totals and exports.
// Nothing is shared or copied between companies; every record carries its company and a record with no company is
// refused — never quietly put under KTC.
// Pure + safe on both server and browser. SWC-safe.
import { US_WAVE_BUSINESS_ID } from './business-of';

// The silo id each company's bank lines carry (bank_transactions / plaid_accounts / bank_connections .wave_business_id).
export var NEXTRADE_COMPANY_ID = 'NEXTRADE_BOOKS';
export var RTM_COMPANY_ID = 'RTM_BOOKS';

export var COMPANIES = {
  ktc: { key: 'ktc', id: US_WAVE_BUSINESS_ID, label: 'KTC', wave: true, icon: '🟧' },
  nextrade: { key: 'nextrade', id: NEXTRADE_COMPANY_ID, label: 'Nextrade', wave: false, icon: '🟦', viewPerm: 'company.nextrade.view', managePerm: 'company.nextrade.manage' },
  rtm: { key: 'rtm', id: RTM_COMPANY_ID, label: 'RTM', wave: false, icon: '🟪', viewPerm: 'company.rtm.view', managePerm: 'company.rtm.manage' },
};
export var NON_WAVE_COMPANY_IDS = {};
NON_WAVE_COMPANY_IDS[NEXTRADE_COMPANY_ID] = 'nextrade';
NON_WAVE_COMPANY_IDS[RTM_COMPANY_ID] = 'rtm';

export function isNonWaveCompany(id) { return !!(id && NON_WAVE_COMPANY_IDS[String(id)]); }
// 'nextrade' | 'rtm' → the company; anything else → null (refused by the caller, never defaulted)
export function companyByKey(key) { var k = String(key || '').toLowerCase(); return (k === 'nextrade' || k === 'rtm') ? COMPANIES[k] : null; }
export function companyById(id) {
  var s = String(id || '');
  if (!s) { return null; }
  if (s === US_WAVE_BUSINESS_ID) { return COMPANIES.ktc; }
  var k = NON_WAVE_COMPANY_IDS[s];
  return k ? COMPANIES[k] : null;
}

// Category kinds a company category can have. Only expense kinds can ever become a KTC bill (Nextrade).
export var COMPANY_KINDS = { expense: 'Expense', cogs: 'Cost of goods', other_expense: 'Other expense', income: 'Income', other_income: 'Other income', transfer: 'Transfer (own money moving — never income or spending)', not_pnl: 'Not profit & loss (loan, owner money)' };
export var EXPENSE_KINDS = { expense: 1, cogs: 1, other_expense: 1 };
export function isExpenseKind(kind) { return !!EXPENSE_KINDS[String(kind || '')]; }

// A stable key for a new category label, unique inside its company: "Utilities – Electricity" → utilities_electricity
export function categoryKey(label) {
  var k = String(label || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').substring(0, 50);
  return k || null;
}

// How a rule's match text is compared with a bank line: lower-case, letters/digits only, single spaces.
export function normMatch(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }

// The best rule for a line: the LONGEST match text found inside the line's description / merchant (most specific wins).
export function bestCompanyRule(rules, text) {
  var t = ' ' + normMatch(text) + ' '; var best = null;
  (rules || []).forEach(function (r) {
    if (!r || r.active === false) { return; }
    var m = normMatch(r.match_text);
    if (m.length < 3) { return; }
    if (t.indexOf(' ' + m + ' ') >= 0 || t.indexOf(m) >= 0) { if (!best || m.length > normMatch(best.match_text).length) { best = r; } }
  });
  return best;
}

// Month totals for one company: { months: [...], rows: [{ key, label, kind, byMonth: {ym: signed}, total }], inTotal, outTotal }
// money in is +, money out is −. Transfers are kept in their own rows and never counted as income or spending.
export function companyTotals(lines, cats) {
  var byKey = {}; (cats || []).forEach(function (c) { byKey[c.key] = c; });
  var months = {}; var rows = {}; var inT = 0; var outT = 0; var trIn = 0; var trOut = 0;
  (lines || []).forEach(function (l) {
    var ym = String(l.date || '').substring(0, 7); if (!ym) { return; }
    months[ym] = true;
    var amt = Math.round((Number(l.amount_abs) || 0) * 100) / 100; var signed = l.direction === 'in' ? amt : -amt;
    var key = l.company_category || '__none'; var c = byKey[key];
    var kind = c ? c.kind : (key === '__none' ? 'uncategorized' : 'unknown');
    var row = rows[key] || (rows[key] = { key: key, label: c ? c.label : (key === '__none' ? 'Not categorized yet' : key), kind: kind, byMonth: {}, total: 0 });
    row.byMonth[ym] = Math.round(((row.byMonth[ym] || 0) + signed) * 100) / 100;
    row.total = Math.round((row.total + signed) * 100) / 100;
    if (kind === 'transfer') { if (signed > 0) { trIn += signed; } else { trOut -= signed; } }
    else if (signed > 0) { inT += signed; } else { outT -= signed; }
  });
  var list = Object.keys(rows).map(function (k) { return rows[k]; }).sort(function (a, b) { return a.label < b.label ? -1 : 1; });
  function r2(x) { return Math.round(x * 100) / 100; }
  return { months: Object.keys(months).sort(), rows: list, inTotal: r2(inT), outTotal: r2(outT), transfersIn: r2(trIn), transfersOut: r2(trOut) };
}

// The last day of the line's month — a Nextrade bill is due at the END OF THE MONTH (Max).
export function endOfMonth(dateStr) {
  var y = Number(String(dateStr).substring(0, 4)); var m = Number(String(dateStr).substring(5, 7));
  if (!(y > 0) || !(m >= 1 && m <= 12)) { return null; }
  var d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return y + '-' + (m < 10 ? '0' : '') + m + '-' + d;
}
