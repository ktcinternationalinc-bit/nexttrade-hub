import { NEXTRADE_COMPANY_ID } from './companies';

export var TAX_REPORT_GROUPS = {
  income: 'Income',
  cogs: 'Cost of goods sold',
  expense: 'Operating expenses',
  other_income: 'Other income',
  other_expense: 'Other expenses',
  transfer: 'Transfers',
  not_pnl: 'Outside profit and loss',
  review: 'Needs categorization',
};

export var NEXTRADE_SOURCE_LABELS = { plaid: 'Plaid', wave_csv: 'Wave CSV', csv: 'CSV import', pdf: 'PDF import', manual: 'Manual entry', statement: 'Statement import' };
export var NEXTRADE_WAVE_TD_SOURCE = '[CSV] Wave · TD Bank';

// Keep the same snapshot for the totals, drill-down and CSV. Large reports still return totals.
var TAX_DETAIL_LIMIT = 4000;

export function nextradeTaxReport(lines, categories, from, to, accounts) {
  var showDetails = lines.length <= TAX_DETAIL_LIMIT;
  var coverage = new Map();
  var count = 0;
  var byKey = new Map(categories.map(function (category) { return [category.key, category]; }));
  var currencies = new Map();
  var first = null;
  var last = null;
  lines.forEach(function (line) {
    if (line.wave_business_id !== NEXTRADE_COMPANY_ID || line.pending === true || line.review_status === 'duplicate') { return; }
    if (line.payroll_restricted || (line.direction !== 'in' && line.direction !== 'out')) { return; }
    var amount = Math.round(Number(line.amount_abs) * 100);
    var date = line.posted_date || line.date;
    if (!date || date < from || date > to || line.amount_abs == null || !Number.isFinite(amount) || amount < 0) { return; }
    count++;
    if (!first || date < first) { first = date; }
    if (!last || date > last) { last = date; }
    var currency = String(line.iso_currency || '').trim().toUpperCase() || 'Unspecified';
    var account = accounts && accounts.get(line.account_id) || 'Unknown account';
    var coverageKey = JSON.stringify([currency, line.account_id || null]);
    if (!coverage.has(coverageKey)) { coverage.set(coverageKey, { account: account, currency: currency, first: date, last: date, count: 0, wave_count: 0 }); }
    var accountCoverage = coverage.get(coverageKey);
    if (date < accountCoverage.first) { accountCoverage.first = date; }
    if (date > accountCoverage.last) { accountCoverage.last = date; }
    accountCoverage.count++;
    if (line.bank_source === NEXTRADE_WAVE_TD_SOURCE) { accountCoverage.wave_count++; }
    if (!currencies.has(currency)) { currencies.set(currency, new Map()); }
    var rows = currencies.get(currency);
    var category = byKey.get(line.company_category);
    var kind = category && Object.prototype.hasOwnProperty.call(TAX_REPORT_GROUPS, category.kind) ? category.kind : 'review';
    if (line.transfer_group_id) { kind = 'transfer'; }
    var label = kind === 'transfer' && (!category || category.kind !== kind) ? 'Paired transfer' : category ? category.label : line.company_category || 'Uncategorized';
    var key = JSON.stringify([kind, category ? category.key : line.company_category]);
    if (!rows.has(key)) { rows.set(key, { key: key, label: label, kind: kind, money_in: 0, money_out: 0, count: 0 }); }
    var row = rows.get(key);
    if (line.direction === 'in') { row.money_in += amount; } else { row.money_out += amount; }
    row.count++;
    if (showDetails) {
      if (!row.transactions) { row.transactions = []; }
      var wave = line.bank_source === NEXTRADE_WAVE_TD_SOURCE;
      row.transactions.push({
        id: line.id,
        date: date,
        account: account,
        description: line.name || line.merchant_name || 'No description',
        direction: line.direction,
        company_category: line.company_category || null,
        category_label: label,
        paired_transfer: !!line.transfer_group_id,
        amount: amount,
        source: line.source || '',
        source_file: wave ? line.source_file || '' : '',
        source_row: wave ? line.source_row || '' : '',
      });
    }
  });
  return {
    first: first,
    last: last,
    count: count,
    details_available: showDetails,
    accounts: Array.from(coverage.values()).sort(function (a, b) { return a.currency.localeCompare(b.currency) || a.account.localeCompare(b.account); }),
    currencies: Array.from(currencies.entries()).sort(function (a, b) { return a[0].localeCompare(b[0]); }).map(function (entry) {
      var rows = Array.from(entry[1].values());
      var groups = Object.keys(TAX_REPORT_GROUPS);
      rows.sort(function (a, b) { return groups.indexOf(a.kind) - groups.indexOf(b.kind) || a.label.localeCompare(b.label); });
      var summary = { income: 0, cost_of_goods: 0, expenses: 0, net: 0, review_count: 0 };
      rows.forEach(function (row) {
        if (row.transactions) {
          row.transactions.sort(function (a, b) { return b.date.localeCompare(a.date) || String(a.id).localeCompare(String(b.id)); });
        }
        var net = row.money_in - row.money_out;
        if (row.kind === 'income' || row.kind === 'other_income') { summary.income += net; }
        if (row.kind === 'cogs') { summary.cost_of_goods -= net; }
        if (row.kind === 'expense' || row.kind === 'other_expense') { summary.expenses -= net; }
        if (row.kind === 'review') { summary.review_count += row.count; }
      });
      summary.net = summary.income - summary.cost_of_goods - summary.expenses;
      return { currency: entry[0], summary: summary, rows: rows };
    }),
  };
}
