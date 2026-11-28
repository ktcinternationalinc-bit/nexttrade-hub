const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
require('sucrase/register');

const { buildPaidComparison, combinePaidComparisons } = require('../src/lib/period-paid-comparison');
const { addPeriodCell, blankPeriodRow } = require('../src/lib/pnl-period');
const { identifyNexPacFeeLines, nexPacFeeSchedule } = require('../src/lib/partner-fee-months');
const { applyVendorWirePaymentDates } = require('../src/lib/vendor-wire-payment-dates');
const { profitabilityWorkItems } = require('../src/lib/profitability-work-feed');
const PeriodPaidComparison = require('../src/components/PeriodPaidComparison.jsx').default;

const june = { from: '2026-06-01', to: '2026-06-30' };
const july = { from: '2026-07-01', to: '2026-07-31' };
const bill = (id, category, total_amount, bill_date, extra) => ({ id, vendor_name: 'NexPac Corporation', bill_number: id, category, total_amount, bill_date, record_status: 'active', ...extra });
const bills = Object.fromEntries([
  bill('14277', 'partner_fees', 45250, '2026-06-30'),
  bill('void-copy', null, 45250, '2026-06-30', { record_status: 'void', bill_number: '14277' }),
  bill('active-copy', null, 45250, '2026-06-30', { bill_number: '14277' }),
  bill('14487', null, 45250, '2026-07-31'),
  bill('other', null, 45250, '2026-06-30', { vendor_name: 'Other vendor' }),
  bill('fx', null, 45250, '2026-06-30', { currency: 'CAD' }),
  bill('trucking', 'trucking', 20000, '2026-05-10'),
  bill('freight', 'freight', 5000, '2026-05-19'),
  bill('payroll', 'payroll', 700, '2026-05-19'),
].map(b => [b.id, b]));

const row = (id, category, amount, extra) => ({ id, category, amount, date: '2026-06-30', who: id, ...extra });
const pay = (id, bill_id, amount, bank_transaction_id, extra) => ({ id, bill_id, amount, bank_transaction_id, paid_date: '2026-06-30', ...extra });
const funding = (period, extra) => [{ party: 'RTM Capital', period, ...extra }];
const banks = rows => rows.map(r => ({ id: r.id, name: r.who, iso_currency: r.iso_currency, matched_invoice_id: r.invoice_id }));
function assemble({ spendingRows = [], incomeRows = [], payments = [], funds = [], date = june, ...options } = {}) {
  return buildPaidComparison({ ...date, bills, bankLines: banks(spendingRows.concat(incomeRows)), payments, spendingRows, incomeRows, funds,
    labels: { partner_fees: 'Partner Fees', payroll: 'Payroll', trucking: 'Trucking', freight: 'Freight' },
    kinds: { vendor_payment: 'cogs', loan: 'not_pnl', transfer: 'transfer', customer_payment: 'income', returned_checks: 'expense' }, ...options });
}

const bankMonth = assemble({ spendingRows: [row('supplier', 'vendor_payment', 187844.94), row('freight', 'freight', 1000), row('rent', 'rent', 3000), row('loan', 'loan', 2000), row('transfer', 'transfer', 400000), row('unknown', '', 110), row('foreign', 'rent', 999, { iso_currency: 'CAD' }), row('rtm', 'professional_fees', 76000, { funds_sent_to: 'RTM Capital' }), row('rtm-back', 'professional_fees', -1000, { money_back_from: 'RTM Capital' }), row('return', 'returned_checks', 2072), row('returned-deposit', 'returned_checks', -2072)],
  incomeRows: [row('old-customer', 'customer_payment', 409782.20, { invoice_id: 'older-invoice' }), row('unknown-in', '', 9330), row('interest', 'interest', 120), row('returned-deposit', 'customer_payment', 2072, { returned_deposit: true })] });
assert.equal(bankMonth.paid.cents, 19184494);
assert.equal(bankMonth.funding.cents, 7500000);
assert.equal(bankMonth.bank_cash.cents, 26684494);
assert.equal(bankMonth.funded_paid.cents, 0);
assert.equal(bankMonth.receipts.cents, 40978220);
assert.equal(bankMonth.receipts.rows[0].invoice_id, 'older-invoice');
assert.equal(bankMonth.unclassified_receipts.cents, 933000);
assert.equal(bankMonth.review.cents, 11000);
assert.equal(bankMonth.partner_billed.cents, 4525000);
assert.equal(bankMonth.partner_billed.rows[0].bill_id, '14277');
assert.equal(bankMonth.partner_paid_cents, 0);
assert.equal(bankMonth.billed.cents, 9050000);
assert.equal(bankMonth.billed.rows.filter(r => r.category === 'partner_fees').length, 1);
const receiptMatches = assemble({ incomeRows: [row('partial', '', 1000), row('classified', 'customer_payment', 400), row('internal', 'transfer', 200)], customerPayments: [
  { bank_transaction_id: 'partial', accounting_invoice_id: 'older-invoice', amount: 300 },
  { bank_transaction_id: 'classified', accounting_invoice_id: 'invoice', amount: 400 },
  { bank_transaction_id: 'internal', accounting_invoice_id: 'invoice', amount: 200 }
] });
assert.equal(receiptMatches.receipts.cents, 70000);
assert.equal(receiptMatches.unclassified_receipts.cents, 70000);

const direct = assemble({ spendingRows: [row('one-debit', 'vendor_payment', 50000), row('uncategorized-bank', '', 900)], payments: [pay('partner-part', '14277', 45250, 'one-debit'), pay('freight-part', 'freight', 4750, 'one-debit'), pay('linked-unknown', 'freight', 900, 'uncategorized-bank'), pay('void', 'freight', 800, 'one-debit', { voided: true }), pay('bank-missing', 'trucking', 250, 'out-of-period'), pay('legacy-no-bank', 'freight', 500, null)] });
assert.equal(direct.paid.cents, 5090000);
assert.equal(direct.paid.count, 3);
assert.equal(direct.partner_paid_cents, 4525000);
assert.equal(direct.review.cents, 75000);
const overlap = assemble({ spendingRows: [row('debit', 'freight', 1000)], payments: [pay('a', 'freight', 800, 'debit'), pay('b', 'trucking', 800, 'debit')] });
assert.equal(overlap.paid.cents, 100000);
assert.equal(overlap.review.cents, 160000);

const transfer = row('rtm', 'professional_fees', 80000, { funds_sent_to: 'RTM Capital' });
const fundedBill = (payment_id, bill_id, portion, extra) => ({ payment_id, bill_id, portion, transfer_id: 'rtm', transfer_date: '2026-06-25', paid_date: '2026-06-30', ...extra });
const partner = fundedBill('pt-partner', '14277', 45250);
const juneFunding = assemble({ spendingRows: [transfer, row('direct-unlinked', 'freight', 300)], payments: [pay('same-bank', 'freight', 300, 'direct-unlinked')], funds: funding({ applied_rows: [partner, fundedBill('pt-truck', 'trucking', 20000)], from_starting_balance_rows: [fundedBill('old-balance', 'freight', 5000, { transfer_id: null, transfer_date: null })], fee_rows: [{ id: 'actual-fee', date: '2026-06-30', amount: 500, transfer_id: 'rtm' }, { id: 'duplicated-partner', date: '2026-06-30', amount: 45250, transfer_id: 'rtm' }] }, { paid_without_a_transfer: { period_rows: [partner, fundedBill('same-bank', 'freight', 300, { on_bank_line: 'direct-unlinked', transfer_id: null })] } }) });
assert.equal(juneFunding.paid.cents, 7105000);
assert.equal(juneFunding.funded_paid.cents, 7075000);
assert.equal(juneFunding.funding.cents, 8000000);
assert.equal(juneFunding.bank_cash.cents, 8030000);
assert.equal(juneFunding.bank_cash.rows.filter(r => r.category === 'partner_fees').length, 0);
assert.equal(juneFunding.partner_paid_cents, 4525000);
assert.equal(juneFunding.review.rows[0].id, 'duplicated-partner');
assert.deepEqual(juneFunding.funded_paid.rows.filter(r => r.transfer_id === 'rtm').map(r => [r.category, r.cents]), [
  ['partner_fees', 4525000], ['trucking', 2000000], ['professional_fees', 50000],
]);

const julyFunding = assemble({ date: july, partnerFeeLines: [{ id: 'july-fee', bill_id: '14487', description: 'Operational Fee July 2026', amount: 45250 }], funds: funding({ applied_rows: [fundedBill('july-portion', 'freight', 4250, { paid_date: '2026-07-03' })] }) });
assert.equal(julyFunding.funding.cents, 0);
assert.equal(julyFunding.paid.cents, 425000);
assert.equal(julyFunding.bank_cash.cents, 0);
assert.equal(julyFunding.paid.rows[0].transfer_date, '2026-06-25');
assert.equal(julyFunding.partner_billed.rows[0].bill_id, '14487');
assert.equal(combinePaidComparisons([juneFunding, julyFunding]).paid.cents, 7530000);
assert.equal(combinePaidComparisons([juneFunding, julyFunding]).bank_cash.cents, 8030000);
assert.equal(combinePaidComparisons([juneFunding, null]), null);
assert.ok(assemble({ funds: null }).unavailable);

const restricted = assemble({ spendingRows: [row('payroll-bank', 'payroll', 700)], payments: [pay('payroll-bill', 'payroll', 700, 'payroll-bank')], privateBills: { payroll: true } });
assert.equal(restricted.paid.cents, 70000);
assert.ok(!restricted.paid.rows[0].bill_id);
assert.ok(!restricted.paid.rows[0].bank_ref);
assert.deepEqual(assemble({ spendingRows: [row('debit', 'rent', 12)], showRows: false }).paid, { cents: 1200, count: 1, rows: [] });

const mixedBill = bill('mixed', 'freight', 50250, '2026-08-02');
const mixedLines = [{ id: 'line-3', bill_id: mixedBill.id, description: 'Operational Fee July 2026', amount: 45250 }];
const mixed = assemble({ bills: { ...bills, mixed: mixedBill }, date: { from: '2026-07-01', to: '2026-08-31' }, partnerFeeLines: mixedLines,
  spendingRows: [row('part-bank', 'freight', 50250, { date: '2026-08-02' })], payments: [pay('all', mixedBill.id, 50250, 'part-bank', { paid_date: '2026-08-02' })] });
assert.equal(mixed.paid.cents, 5025000);
assert.equal(mixed.partner_paid_cents, 4525000);
assert.equal(mixed.partner_billed.cents, 4525000);
assert.equal(mixed.partner_schedule.cents, 9050000);
assert.equal(mixed.partner_schedule.rows[0].date, '2026-07-31');
assert.equal(mixed.partner_schedule.rows[0].bill_id, mixedBill.id);
assert.match(mixed.partner_schedule.rows[1].source, /source bill missing/);
const duplicateJulyFee = { ...bills['14487'], category: 'partner_fees' };
const sameObligation = assemble({ bills: { [duplicateJulyFee.id]: duplicateJulyFee, mixed: mixedBill }, date: { from: '2026-07-01', to: '2026-08-31' }, partnerFeeLines: mixedLines });
assert.equal(sameObligation.billed.cents, 5025000);
assert.equal(sameObligation.billed.rows.filter(r => r.category === 'partner_fees').length, 1);
assert.equal(sameObligation.billed.rows.find(r => r.bill_id === 'mixed').cents, 500000);
assert.deepEqual(nexPacFeeSchedule(identifyNexPacFeeLines({}, []), '2026-11-01', '2026-11-28'), []);
const proofPay = pay('proof-payment', 'freight', 5000, 'rtm', { method: 'rtm' });
const proof = { bill_id: 'freight', payment_id: proofPay.id, rtm_file_id: 'proof', rtm_confirmed_at: '2026-07-04', rtm_paid_date: '2026-07-03', is_open: false };
assert.equal(applyVendorWirePaymentDates([proofPay], [proof])[0].paid_date, '2026-07-03');
assert.equal(applyVendorWirePaymentDates([proofPay], [{ ...proof, bill_id: 'different' }])[0].paid_date, '2026-06-30');
assert.equal(applyVendorWirePaymentDates([{ ...proofPay, voided: true }], [proof])[0].paid_date, '2026-06-30');

const cell = { invoice_date: '2026-06-24', invoice: 'America 1747', release: '1002-1158', description: 'Stock PVC Rolls BY KGs', goods_profit: null, profit: null, transport_profit: null, transport_revenue: null, pounds: null, trucking_cost: 0, freight_cost: 0 };
const supplierCell = { ...cell, invoice: 'AMERICA 1746', description: 'Miatex Goods', pounds: 100, transport_revenue: 100, transport_profit: 100, base_cost: null };
const tasks = profitabilityWorkItems([cell, supplierCell, supplierCell]);
assert.equal(tasks.length, 2);
assert.equal(tasks.find(task => task.group === 'supplier_costs_missing').detail, 'Jun 2026 · 2 sale lines');
const shippingTask = tasks.find(task => task.group === 'shipment_costs_missing');
assert.match(shippingTask.issue, /also blocks the shipping calculation/);
assert.deepEqual(shippingTask.target, { kind: 'profitability', month: '2026-06', task: 'pounds:Stock PVC Rolls BY KGs' });
const spanningTasks = profitabilityWorkItems([cell, { ...cell, invoice_date: '2026-07-06', invoice: 'America 1759' }, supplierCell]);
assert.equal(spanningTasks.filter(task => task.group === 'shipment_costs_missing').length, 1);
assert.equal(spanningTasks.find(task => task.group === 'shipment_costs_missing').detail, 'Jun 2026, Jul 2026 · 2 sale lines');

const period = blankPeriodRow('2026-06', 'Jun 2026');
addPeriodCell(period, { goods_revenue: 247989.25, goods_profit: 98316.74, transport_revenue: 59524.25, transport_profit: 4409 });
addPeriodCell(period, { goods_revenue: 88159.26, goods_profit: null });
const html = renderToStaticMarkup(React.createElement(PeriodPaidComparison, { period, periods: [period], comparison: bankMonth, invoiceRows: [], onFixCosts() {}, onOpenBill() {} }));
for (const text of ['Goods invoiced less payments', 'Customer receipts less payments', '$336,148.51', '$98,316.74', '$4,409.00', '$88,159.26', 'Fix missing costs', 'Partner fee billed', 'Bill 14277', 'RTM / NextTrade bills and fees paid']) assert.ok(html.includes(text), text);
const juneReport = renderToStaticMarkup(React.createElement(PeriodPaidComparison, {
  period, periods: [period], invoiceRows: [], basis: 'vendor', pnl: { cents: -2842386, complete: false }, onOpenPnl() {},
  comparison: { ...bankMonth, paid: { cents: 26988926, count: 0, rows: [] }, receipts: { cents: 40978220, count: 0, rows: [] },
    funding: { cents: 7600000, count: 4, rows: [] }, funded_paid: { cents: 1344736, count: 2, rows: [] } },
}));
for (const text of ['$336,148.51', '-$269,889.26', '= $66,259.25', '$409,782.20', '= $139,892.94', '$76,000.00', '$13,447.36',
  'Jun 2026 P&amp;L · -$28,423.86 · Provisional', 'Goods profit + transport profit', 'nt-paper']) assert.ok(juneReport.includes(text), text);
assert.equal(juneReport.split('-$269,889.26').length - 1, 2);
assert.doesNotMatch(juneReport, /class="[^"]*\b(?:bg-white|bg-slate-50|text-red-800)\b/);
const fundingReport = renderToStaticMarkup(React.createElement(PeriodPaidComparison, {
  period, periods: [period], invoiceRows: [], comparison: juneFunding, onOpenBill() {},
}));
for (const text of ['by category', 'Payments this transfer funded', 'Category</th>', 'Funding transfer 2026-06-25', '$65,750.00', 'Bill 14277']) assert.ok(fundingReport.includes(text), text);
const bankReport = renderToStaticMarkup(React.createElement(PeriodPaidComparison, {
  period, periods: [period], invoiceRows: [], comparison: { ...bankMonth, bank_cash: { cents: 33244190, count: 0, rows: [] } },
}));
for (const text of ['Cash out for expenses and funding', '-$332,441.90', '= $3,706.61', '= $77,340.30']) assert.ok(bankReport.includes(text), text);
const accruedReport = renderToStaticMarkup(React.createElement(PeriodPaidComparison, {
  period, periods: [period], invoiceRows: [], comparison: bankMonth, basis: 'billed', onOpenBill() {},
}));
for (const text of ['Goods invoiced less bills dated this period', '-$90,500.00', 'Bill 14277']) assert.ok(accruedReport.includes(text), text);
assert.doesNotMatch(accruedReport, /Customer receipts less payments/);
console.log('PASS: period comparison reconciliation, source records, RTM funding and refunds, partner duplicates, account transfers, foreign currency, access, and missing costs.');
