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

export function nextradeTaxReport(lines, categories, from, to) {
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
    if (!first || date < first) { first = date; }
    if (!last || date > last) { last = date; }
    var currency = String(line.iso_currency || '').trim().toUpperCase() || 'Unspecified';
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
  });
  return {
    first: first,
    last: last,
    currencies: Array.from(currencies.entries()).sort(function (a, b) { return a[0].localeCompare(b[0]); }).map(function (entry) {
      var rows = Array.from(entry[1].values());
      var groups = Object.keys(TAX_REPORT_GROUPS);
      rows.sort(function (a, b) { return groups.indexOf(a.kind) - groups.indexOf(b.kind) || a.label.localeCompare(b.label); });
      var summary = { income: 0, cost_of_goods: 0, expenses: 0, net: 0, review_count: 0 };
      rows.forEach(function (row) {
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
