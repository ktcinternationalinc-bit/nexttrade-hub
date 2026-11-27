// v55.83-ZD rev3 (Max, 26 Nov: "Yes, hide them") — payroll in the Wave history archive (monthly ledger + cash history) and in the
// ClickBooks US ledger reports is shown ONLY to the super admin and to people with P&L access ('pnl.view'), the same rule as the
// payroll bank lines (lib/payroll-bills.js). For everyone else:
//   • an account whose name, category or mapping says "payroll" (any case, partial match) is left out, with its rows;
//   • a ledger row whose description (or other accounts) says "payroll" is left out, and the account it sits on shows its
//     totals WITHOUT it (cash history: from the database step's payroll totals; without that step the read is refused);
//   • a report that would still contain a payroll amount after that is refused (never a total that silently includes payroll);
//   • answers carry the same fixed words whether or not any payroll exists.
// Pure (no imports): the routes decide who may see payroll and pass the answer through here. SWC-safe: var + concatenation.

export var PAYROLL_LEDGER_NOTE = 'excluding payroll (shown to the super admin and people with P&L access)';
export var PAYROLL_REPORT_WITHHELD = 'This report contains payroll amounts, which are shown to the super admin and people with P&L access only — it is withheld, not zero.';

function has(s) { return /payroll/i.test(String(s === null || s === undefined ? '' : s)); }
function textOf(v) { try { return typeof v === 'string' ? v : JSON.stringify(v); } catch (e) { return ''; } }

// a Wave account (monthly ledger or cash history) is payroll when its name, its category or its category mapping says so
export function isPayrollAccount(a) {
  if (!a || typeof a !== 'object') { return false; }
  var m = a.mapping || {};
  return has(a.account_name) || has(a.name) || has(a.category) || has(m.nextrade_category) || has(m.ktc_category) || has(a.account_key);
}
// a ledger row is payroll when its account is, or its description / other accounts say "payroll"
export function isPayrollEntry(r) {
  if (!r || typeof r !== 'object') { return false; }
  return isPayrollAccount(r) || has(r.description) || has(textOf(r.other_accounts)) || has(r.memo);
}

// monthly ledger (wave_history_data): the payroll accounts are left out before the categories are added up
export function scrubWaveHistoryData(data) {
  if (!data || !Array.isArray(data.accounts)) { return data; }
  return Object.assign({}, data, { accounts: data.accounts.filter(function (a) { return !isPayrollAccount(a); }) });
}
export function scrubWaveEntries(rows) { return (rows || []).filter(function (r) { return !isPayrollEntry(r); }); }

// cash history (wave_cash_read). payrollTotals = [{ account_key, debit_minor, credit_minor, rows }] — the payroll rows on each account
// (from the database step). Returns { data } or { error } when the totals cannot be made to exclude payroll.
export function scrubCashRead(data, payrollTotals) {
  if (!data || typeof data !== 'object') { return { data: data }; }
  if (!Array.isArray(payrollTotals)) { return { error: 'Cash history needs the database step sql/v55-83-ZD-payroll-ledger.sql so its totals can leave payroll out — nothing was shown.' }; }
  var sub = {}; payrollTotals.forEach(function (t) { if (t && t.account_key !== undefined && t.account_key !== null) { sub[String(t.account_key)] = t; } });
  var accounts = (data.accounts || []).filter(function (a) { return !isPayrollAccount(a); }).map(function (a) {
    var t = sub[String(a.account_key)]; if (!t) { return a; }
    return Object.assign({}, a, {
      debit_minor: Number(a.debit_minor || 0) - Number(t.debit_minor || 0),
      credit_minor: Number(a.credit_minor || 0) - Number(t.credit_minor || 0),
      rows: Number(a.rows || 0) - Number(t.rows || 0)
    });
  });
  var imports = (data.imports || []).map(function (i) { return Object.assign({}, i, { debit_minor: null, credit_minor: null }); }); // whole-file totals include payroll
  var hist = (data.mapping_history || []).filter(function (h) { return !has(textOf(h.before_value)) && !has(textOf(h.after_value)) && !has(h.account_key); });
  return { data: Object.assign({}, data, { accounts: accounts, entries: scrubWaveEntries(data.entries), imports: imports, mapping_history: hist, payroll_note: PAYROLL_LEDGER_NOTE }) };
}

// a mapping / category write by a person without P&L access may neither touch a payroll account nor move an account INTO payroll
export function ledgerWriteTouchesPayroll(accountKey, values) {
  if (has(accountKey)) { return true; }
  return [].concat(values || []).some(function (v) { return has(v); });
}

// ClickBooks US read (accounts + trial balance): payroll accounts left out
export function scrubClickbooksRead(out) {
  if (!out || typeof out !== 'object') { return out; }
  var keep = function (a) { return !(has(a && a.name) || has(a && a.code)); };
  return Object.assign({}, out, {
    accounts: Array.isArray(out.accounts) ? out.accounts.filter(keep) : out.accounts,
    trialBalance: Array.isArray(out.trialBalance) ? out.trialBalance.filter(keep) : out.trialBalance,
    payroll_note: PAYROLL_LEDGER_NOTE
  });
}

// ClickBooks US reports (any shape): every list item that names payroll (account name / description / memo / category) is left
// out. If one of them carried an amount other than zero, the totals around it would still include it → { withheld: true }.
var NAME_KEYS = ['name', 'account', 'account_name', 'accountName', 'description', 'memo', 'category', 'tax_category', 'taxCategory', 'label', 'line'];
function isMoneyKey(k) { return /cents$|_minor$|amount|balance|debit|credit|total|net/i.test(k); }
function carriesMoney(o) {
  var found = false;
  (function walk(v) {
    if (found || v === null || v === undefined) { return; }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (typeof v === 'object') { Object.keys(v).forEach(function (k) { var x = v[k]; if (isMoneyKey(k) && (typeof x === 'number' || (typeof x === 'string' && /^-?\d+(\.\d+)?$/.test(x))) && Number(x) !== 0) { found = true; } else { walk(x); } }); }
  })(o);
  return found;
}
function namesPayroll(o) { return NAME_KEYS.some(function (k) { return typeof o[k] === 'string' && has(o[k]); }); }
export function scrubLedgerReport(data) {
  var withheld = false;
  function walk(v) {
    if (Array.isArray(v)) {
      var out = [];
      v.forEach(function (x) { if (x && typeof x === 'object' && !Array.isArray(x) && namesPayroll(x)) { if (carriesMoney(x)) { withheld = true; } return; } out.push(walk(x)); });
      return out;
    }
    if (v && typeof v === 'object') { var o = {}; Object.keys(v).forEach(function (k) { o[k] = walk(v[k]); }); return o; }
    return v;
  }
  var data2 = walk(data);
  return withheld ? { withheld: true } : { data: data2 };
}
