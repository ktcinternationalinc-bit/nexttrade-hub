const assert = require('node:assert/strict');
require('sucrase/register');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { companyTotals } = require('../src/lib/companies');
const { default: CompanyTotalsReport, periodAmount, totalsPeriod, totalsTransactions } = require('../src/components/CompanyTotalsReport');
const { TransactionDetail } = require('../src/components/NextradeTaxReport');
const NextradeBillSplitEditor = require('../src/components/NextradeBillSplitEditor').default;
const { activeSplit, billSplitCents, expandNextradeSplit } = require('../src/lib/nextrade-bill-splits');

const categories = [
  { key: 'taxes', label: 'Taxes', kind: 'expense' },
  { key: 'utilities', label: 'Utilities', kind: 'expense' },
  { key: 'transfer', label: 'Transfer', kind: 'transfer' },
];
function line(id, date, direction, amount, category, extras) {
  return { id, date, direction, amount_abs: amount, company_category: category, name: id, account_label: 'Checking', ...extras };
}
const fixtures = [
  line('tax expense', '2026-06-15', 'out', 13.88, 'taxes'),
  line('earlier tax', '2026-06-01', 'out', 90, 'taxes'),
  line('later tax', '2026-07-02', 'out', 12, 'taxes'),
  line('prior year', '2025-12-31', 'out', 20, 'taxes'),
  line('pending tax', '2026-06-22', 'out', 4, 'taxes', { pending: true }),
  line('private payroll', '2026-06-23', 'out', null, 'taxes', { payroll_restricted: true }),
  line('transfer debit', '2026-06-24', 'out', 10, 'transfer', { transfer_group_id: 'pair' }),
  line('transfer credit', '2026-06-24', 'in', 10, 'transfer', { transfer_group_id: 'pair' }),
  line('uncategorized', '2026-06-25', 'out', 42, null),
];
const range = { from: '2025-12-15', to: '2026-06-27' };
const selection = { category: 'taxes', ...totalsPeriod(range, '2026-06') };
assert.deepEqual(selection, { category: 'taxes', from: '2026-06-01', to: '2026-06-27' });
assert.deepEqual(totalsPeriod(range, '2025'), { from: '2025-12-15', to: '2025-12-31' });
assert.deepEqual(totalsPeriod(range, '2026'), { from: '2026-01-01', to: '2026-06-27' });
assert.deepEqual(totalsPeriod(range, null), range);
assert.deepEqual(totalsPeriod({ from: '2028-02-10', to: '2028-03-01' }, '2028-02'), { from: '2028-02-10', to: '2028-02-29' });

const lines = totalsTransactions(fixtures, categories, selection);
assert.deepEqual(lines.map(row => row.id), ['tax expense', 'earlier tax']);
assert.equal(lines[0].amount, 1388);
assert.deepEqual(totalsTransactions(fixtures, categories, { ...selection, category: '__none' }).map(row => row.id), ['uncategorized']);
assert(totalsTransactions(fixtures, categories, { ...selection, category: 'transfer' }).every(row => row.paired_transfer));

function report(rows) {
  const eligible = rows.filter(row => row.date >= range.from && row.date <= range.to && !row.payroll_restricted);
  return { ...companyTotals(eligible, categories), ...range };
}
const before = report(fixtures);
assert.equal(periodAmount(before.rows.find(row => row.key === 'transfer'), ['2026-06']), 0);
assert.equal(periodAmount(before.rows.find(row => row.key === 'transfer'), ['2025-12']), undefined);
assert.equal(periodAmount(before.rows.find(row => row.key === 'taxes'), before.months), -123.88);
const afterLines = fixtures.map(row => row.id === 'tax expense' ? { ...row, company_category: 'utilities' } : row);
const after = report(afterLines);
assert.equal(after.rows.find(row => row.key === 'taxes').byMonth['2026-06'], -90);
assert.equal(after.rows.find(row => row.key === 'utilities').byMonth['2026-06'], -13.88);
assert.deepEqual(totalsTransactions(afterLines, categories, selection).map(row => row.id), ['earlier tax']);

const markup = renderToStaticMarkup(React.createElement(CompanyTotalsReport, { totals: before }));
assert.match(markup, /View transactions for Taxes · 2026-06, -103\.88/);
assert.match(markup, /View transactions for Transfer · 2026-06, 0\.00/);
assert.doesNotMatch(markup, /View transactions for Transfer · 2025-12/);
assert.match(markup, /View transactions for All categories · Total/);
assert.match(markup, /color:#991b1b[^>]*aria-label="View transactions for Taxes/);
assert.doesNotMatch(renderToStaticMarkup(React.createElement(CompanyTotalsReport, { totals: { ...before, capped: true } })), /View transactions for/);

const details = renderToStaticMarkup(React.createElement(TransactionDetail, {
  transactions: lines, heading: 'Transactions', dateLabel: 'Transaction date', signedOut: true,
  categoriesFor: () => categories, onCategoryChange: () => {},
}));
assert.match(details, /Transaction date/);
assert.match(details, /Category for tax expense on 2026-06-15/);
assert.match(details, /color:#991b1b">-13\.88/);
const splitParts = [{ category: 'taxes', cents: 3000, include_ktc: true }, { category: 'utilities', cents: 1500, include_ktc: false }];
const splitSource = line('split', '2026-06-17', 'out', 45, 'taxes', { category_split: splitParts });
assert.equal(billSplitCents('45.00'), 4500);
assert.equal(billSplitCents('45.001'), 0);
assert.equal(activeSplit(splitSource, { bill_id: 'bill-a', allocations: splitParts }, 'bill-a'), splitParts);
assert.deepEqual(activeSplit(splitSource, { bill_id: 'bill-a', allocations: splitParts }, 'different-bill'), []);
assert.deepEqual(expandNextradeSplit(splitSource).map(part => [part.company_category, part.amount_abs, part.split_include_ktc]), [
  ['taxes', 30, true], ['utilities', 15, false],
]);
assert.equal(totalsTransactions([splitSource], categories, selection)[0].amount, 3000);
const freshEditor = renderToStaticMarkup(React.createElement(NextradeBillSplitEditor, {
  line: { ...splitSource, category_split: [] }, categories: categories.map(category => ({ ...category, active: true })),
}));
assert.equal((freshEditor.match(/checked=""/g) || []).length, 2);
const savedEditor = renderToStaticMarkup(React.createElement(NextradeBillSplitEditor, {
  line: splitSource, categories: categories.map(category => ({ ...category, active: true })),
}));
assert.equal((savedEditor.match(/checked=""/g) || []).length, 1);
console.log('Company totals drill-down scopes, category changes, transfers, and negative amounts passed.');
