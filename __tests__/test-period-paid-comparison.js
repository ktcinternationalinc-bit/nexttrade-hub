const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
require('sucrase/register');

const { buildPaidComparison, combinePaidComparisons } = require('../src/lib/period-paid-comparison');
const { addPeriodCell, blankPeriodRow } = require('../src/lib/pnl-period');
const { identifyNexPacFeeLines, nexPacFeeSchedule } = require('../src/lib/partner-fee-months');
const { applyVendorWirePaymentDates } = require('../src/lib/vendor-wire-payment-dates');
const { profitabilityWorkItems } = require('../src/lib/profitability-work-feed');
const { pnlFormula, periodInvoices } = require('../src/lib/pnl-expense-detail');
const { readExpenseAnswer } = require('../src/lib/pnl-expenses');
const { isNextradeKtcExpense, nextradeExpenseCategory } = require('../src/lib/nextrade-expenses-server');
const { managedCashReceipts, MANAGED_SALES_OPENING_ID } = require('../src/lib/nextrade-managed-sales');
const PeriodPaidComparison = require('../src/components/PeriodPaidComparison.jsx').default;
const ExpenseDetail = require('../src/components/ExpenseDetail.jsx').default;
const PnlFormula = require('../src/components/PnlFormula.jsx').default;

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
const banks = rows => rows.map(r => ({ id: r.id, name: r.who, iso_currency: r.iso_currency, matched_invoice_id: r.invoice_id,
  account_subtype: r.account_subtype, account_label: r.account_label, is_credit_card: r.is_credit_card }));
function assemble({ spendingRows = [], incomeRows = [], payments = [], funds = [], date = june, ...options } = {}) {
  return buildPaidComparison({ ...date, bills, bankLines: banks(spendingRows.concat(incomeRows)), payments, spendingRows, incomeRows, funds,
    labels: { partner_fees: 'Partner Fees', payroll: 'Payroll', trucking: 'Trucking', freight: 'Freight' },
    kinds: { vendor_payment: 'cogs', loan: 'not_pnl', transfer: 'transfer', customer_payment: 'income', returned_checks: 'expense' }, ...options });
}

const bankMonth = assemble({ spendingRows: [row('supplier', 'vendor_payment', 187844.94), row('freight', 'freight', 1000), row('rent', 'rent', 3000), row('loan', 'loan', 2000), row('transfer', 'transfer', 400000), row('unknown', '', 110), row('foreign', 'rent', 999, { iso_currency: 'CAD' }), row('rtm', 'professional_fees', 76000, { funds_sent_to: 'RTM Capital' }), row('rtm-back', 'professional_fees', -1000, { money_back_from: 'RTM Capital' }), row('return', 'returned_checks', 2072), row('returned-deposit', 'returned_checks', -2072)],
  incomeRows: [row('old-customer', 'customer_payment', 409782.20, { invoice_id: 'older-invoice' }), row('unknown-in', '', 9330), row('interest', 'interest', 120), row('returned-deposit', 'customer_payment', 2072, { returned_deposit: true })] });
assert.equal(bankMonth.paid.cents, 19184494);
assert.equal(bankMonth.funding.cents, 7500000);
assert.equal(bankMonth.bank_cash.cents, 26695494);
assert.equal(bankMonth.funded_paid.cents, 0);
assert.equal(bankMonth.receipts.cents, 40978220);
assert.equal(bankMonth.receipts.rows[0].invoice_id, 'older-invoice');
assert.equal(bankMonth.unclassified_receipts.cents, 933000);
assert.equal(bankMonth.unclassified_receipts.rows[0].bank_edit, true);
assert.equal(bankMonth.other_deposits.cents, 12000);
assert.equal(bankMonth.bank_cash.rows.find(r => r.id === 'unknown').category, 'uncategorized');
assert.equal(bankMonth.bank_cash.rows.find(r => r.id === 'freight').category, 'freight');
assert.equal(bankMonth.bank_cash.rows.find(r => r.id === 'rtm').category, 'rtm_funding');
assert.ok(bankMonth.bank_cash.rows.every(r => !['loan', 'transfer', 'foreign'].includes(r.id)));
const categorizedDeposit = assemble({ incomeRows: [row('unknown-in', 'customer_payment', 9330)] });
assert.equal(categorizedDeposit.unclassified_receipts.cents, 0);
assert.equal(categorizedDeposit.receipts.cents, 933000);
assert.equal(categorizedDeposit.receipts.rows[0].id, 'unknown-in');
assert.equal(bankMonth.review.cents, 11000);
assert.equal(bankMonth.partner_billed.cents, 4525000);
assert.equal(bankMonth.partner_billed.rows[0].bill_id, '14277');
assert.deepEqual(bankMonth.partner_schedule, { cents: 0, count: 0, rows: [] });
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
const cashIncome = assemble({
  incomeRows: [row('customer-cash', 'customer_payment', 500), row('other-cash', 'other_income', 250),
    row('interest-cash', 'interest_income', 20), row('loan-cash', 'loan', 400),
    row('funding-return', 'other_income', 15, { money_back_from: 'NextTrade Industries' }),
    row('returned-income', 'other_income', 15, { returned_deposit: true })],
  labels: { customer_payment: 'Customer payment', other_income: 'Other income', interest_income: 'Interest income' },
  kinds: { customer_payment: 'income', other_income: 'other_income', interest_income: 'other_income', loan: 'not_pnl' },
});
assert.deepEqual(cashIncome.receipts.rows.map(r => r.category), ['customer_payment', 'other_income', 'interest_income']);
assert.equal(cashIncome.receipts.cents, 77000);
assert.deepEqual(cashIncome.other_deposits.rows.map(r => r.category), ['loan']);
const ntSales = [
  { id: 'nt-sale', date: '2026-06-07', direction: 'in', category: 'sales', amount: 74210.04, description: 'Managed customer receipts' },
  { id: 'nt-wire', date: '2026-06-08', direction: 'out', category: 'sales_ktc_managed_income', amount: 9330, description: 'IMAD: 0608MMQFMP2L017380' },
];
const bankRemittance = { id: 'ktc-wire', direction: 'in', amount_abs: 9330, name: 'REF:20260608MMQFMP2L017380' };
const actualBankReceipts = [{ id: 'customers', cents: 40978220 }, { id: 'ktc-wire', cents: 933000, category: 'other_income' }];
const managedCash = managedCashReceipts(ntSales, [bankRemittance], actualBankReceipts, june.from, june.to);
assert.equal(managedCash.receipts.reduce((sum, r) => sum + r.cents, 0), 48399224);
assert.deepEqual(managedCash.remittances, [actualBankReceipts[1]]);
assert.equal(managedCashReceipts(ntSales, [{ ...bankRemittance, amount_abs: 9329 }], actualBankReceipts, june.from, june.to).remittances.length, 0);
assert.equal(managedCashReceipts(ntSales, [bankRemittance, { ...bankRemittance, id: 'possible-duplicate' }], actualBankReceipts, june.from, june.to).remittances.length, 0);
const poolPaid = assemble({ payments: [pay('managed-paid', 'trucking', 500, null, { party_opening_id: MANAGED_SALES_OPENING_ID })] });
assert.equal(poolPaid.paid.cents, 50000);
assert.equal(poolPaid.funded_paid.rows[0].source, 'Paid from NextTrade-managed sales');

const direct = assemble({ spendingRows: [row('one-debit', 'vendor_payment', 50000), row('uncategorized-bank', '', 900)], payments: [pay('partner-part', '14277', 45250, 'one-debit'), pay('freight-part', 'freight', 4750, 'one-debit'), pay('linked-unknown', 'freight', 900, 'uncategorized-bank'), pay('void', 'freight', 800, 'one-debit', { voided: true }), pay('bank-missing', 'trucking', 250, 'out-of-period'), pay('legacy-no-bank', 'freight', 500, null)] });
assert.equal(direct.paid.cents, 5090000);
assert.equal(direct.paid.count, 3);
assert.equal(direct.partner_paid_cents, 4525000);
assert.equal(direct.review.cents, 75000);
assert.deepEqual(direct.bank_cash.rows.map(r => [r.id, r.category, r.cents]), [
  ['one-debit', 'vendor_payment', 5000000], ['uncategorized-bank', 'uncategorized', 90000],
]);
const overlap = assemble({ spendingRows: [row('debit', 'freight', 1000)], payments: [pay('a', 'freight', 800, 'debit'), pay('b', 'trucking', 800, 'debit')] });
assert.equal(overlap.paid.cents, 100000);
assert.equal(overlap.review.cents, 160000);

const transfer = row('rtm', 'professional_fees', 80000, { funds_sent_to: 'RTM Capital' });
const fundedBill = (payment_id, bill_id, portion, extra) => ({ payment_id, bill_id, portion, transfer_id: 'rtm', transfer_date: '2026-06-25', paid_date: '2026-06-30', ...extra });
const partner = fundedBill('pt-partner', '14277', 45250);
const juneKtc = assemble({
  bills: { ...bills, 'supplier-bill': bill('supplier-bill', 'vendor_payment', 13447.36, '2026-05-30') },
  spendingRows: [row('supplier', 'vendor_payment', 187844.94), row('tax', 'taxes', 53880.82), row('professional', 'professional_fees', 10250),
    row('consulting-bank', 'consulting', 3600), row('utility-bank', 'utilities', 691.84), row('bank-fees', 'bank_charges', 174.30),
    row('returned-check', 'returned_checks', 4144), row('returned-credit', 'returned_checks', -4144, { money_in: true }),
    row('rtm', 'professional_fees', 76000, { funds_sent_to: 'RTM Capital' }), row('misclassified-debit', 'customer_payment', 110)],
  funds: funding({ applied_rows: [fundedBill('rtm-supplier', 'supplier-bill', 13447.36)] }),
  nextradeExpenses: [{ id: 'nt-utilities', date: '2026-06-15', cents: 45818, category: 'utilities', label: 'Utilities', who: 'NextTrade utility vendor' },
    { id: 'nt-bank', date: '2026-06-16', cents: 15100, category: 'bank_charges', label: 'Bank fees' },
    { id: 'nt-other', date: '2026-06-20', cents: 129192, category: 'warehouse_insurance', label: 'Warehouse insurance' }],
  labels: { vendor_payment: 'Vendor payment', taxes: 'Taxes', professional_fees: 'Professional Fees', consulting: 'Consulting', utilities: 'Utilities', bank_charges: 'Bank Charges', returned_checks: 'Returned checks', customer_payment: 'Customer payment' },
});
assert.equal(juneKtc.bank_cash.cents, 33255190);
assert.equal(juneKtc.paid.cents, 27179036);
const cashCategories = Array.from(new Set(juneKtc.bank_cash.rows.map(r => r.category)));
assert.deepEqual(cashCategories, ['vendor_payment', 'taxes', 'professional_fees', 'consulting', 'utilities', 'bank_charges', 'returned_checks', 'customer_payment', 'rtm_funding']);
assert.equal(juneKtc.bank_cash.count, new Set(juneKtc.bank_cash.rows.map(r => r.id)).size);
assert.equal(juneKtc.bank_cash.rows.reduce((total, row) => total + row.cents, 0), juneKtc.bank_cash.cents);
assert.equal(juneKtc.paid.rows.filter(r => r.category === 'vendor_payment').reduce((total, row) => total + row.cents, 0), 20129230);
assert.deepEqual(juneKtc.bank_review.rows.map(r => [r.id, r.review_reason]), [['misclassified-debit', 'Money out is categorized as Customer payment']]);
assert.equal(juneKtc.other_review.count, 0);
const juneAndJulyKtc = combinePaidComparisons([juneKtc, assemble({ date: july })]);
assert.deepEqual(juneAndJulyKtc.bank_cash, juneKtc.bank_cash);
assert.equal(juneAndJulyKtc.bank_review.cents, 11000);
const juneOperatingExpenses = readExpenseAnswer({ ok: true, ...june, paid_comparison: juneKtc, spending: {
  categories: [{ key: 'utilities', label: 'Utilities', kind: 'expense', total: 691.84, count: 1 }, { key: 'bank_charges', label: 'Bank Charges', kind: 'expense', total: 174.30, count: 1 }],
  rows: [row('utility-bank', 'utilities', 691.84), row('bank-fees', 'bank_charges', 174.30)],
}}, june, undefined, categories => categories);
assert.equal(juneOperatingExpenses.detail.byKey.utilities.cents, 115002);
assert.equal(juneOperatingExpenses.detail.byKey.bank_charges.cents, 32530);
assert.equal(juneOperatingExpenses.detail.byKey.utilities.other_cents, 0);
const nexttradeUtility = { id: 'nt-internet', date: june.from, cents: 45818, category: 'utilities', label: 'Utilities', bill_id: 'nt-bill' };
const utilitiesBill = bill('nt-bill', 'utilities', 458.18, '2026-06-30', { vendor_name: 'NextTrade' });
const reimbursement = { bills: { ...bills, 'nt-bill': utilitiesBill },
  spendingRows: [row('reimbursement', 'utilities', 458.18)], payments: [pay('nt-paid', 'nt-bill', 458.18, 'reimbursement')] };
const included = assemble({ ...reimbursement, nextradeExpenses: [nexttradeUtility] });
const excluded = assemble({ ...reimbursement, nextradeExpenses: [{ ...nexttradeUtility, ktc_pnl_excluded: true }] });
assert.deepEqual(included.nextrade_operating.charges_by_category.map(c => [c.key, c.total]), [['utilities', 458.18]]);
assert.deepEqual(excluded.nextrade_operating.charges_by_category, []);
assert.equal(excluded.bank_cash.cents, included.bank_cash.cents);
assert.equal(included.combined_expenses.cents, 45818);
assert.equal(excluded.combined_expenses.cents, 0);
assert.equal(excluded.nextrade_reimbursements.cents, 45818);
assert.equal(included.paid.cents - excluded.paid.cents, 45818);
assert.equal(included.billed.cents - excluded.billed.cents, 45818);
const afterExclusion = readExpenseAnswer({ ok: true, ...june, paid_comparison: excluded, spending: {
  categories: [{ key: 'utilities', label: 'Utilities', kind: 'expense', total: 458.18, count: 1 }],
  rows: reimbursement.spendingRows,
}}, june, undefined, categories => categories);
assert.equal(afterExclusion.cols.A.cents, 0);
const internet = { key: 'internet', label: 'Internet', kind: 'expense' };
const utilities = { key: 'utilities', label: 'Utilities', kind: 'expense' };
const technology = { key: 'technology', label: 'Technology', kind: 'expense' };
const ktcCategories = new Map([[utilities.key, utilities], [technology.key, technology]]);
assert.equal(nextradeExpenseCategory(internet, new Map(), ktcCategories), utilities);
assert.equal(nextradeExpenseCategory(internet, new Map([['internet', 'technology']]), ktcCategories), technology);
assert.equal(nextradeExpenseCategory(technology, new Map(), ktcCategories), technology);
const payrollTaxes = { key: 'payroll_taxes', label: 'Payroll Taxes', kind: 'expense' };
assert.equal(nextradeExpenseCategory(payrollTaxes, new Map([['payroll_taxes', 'taxes']]), new Map([['payroll_taxes', payrollTaxes]])), payrollTaxes);
const validCharge = { date: june.from, direction: 'out', amount_abs: 458.18 };
assert.equal(isNextradeKtcExpense(validCharge, internet), true);
assert.equal(isNextradeKtcExpense({ ...validCharge, date: '2026-05-31' }, internet), false);
assert.equal(isNextradeKtcExpense({ ...validCharge, pending: true }, internet), false);
assert.equal(isNextradeKtcExpense({ ...validCharge, transfer_group_id: 'card-payment' }, internet), false);
const utilityDetail = renderToStaticMarkup(React.createElement(ExpenseDetail, { makeup: juneOperatingExpenses.detail.byKey.utilities }));
assert.match(utilityDetail, /utility-bank<\/td>/);
assert.match(utilityDetail, /NextTrade utility vendor \(NextTrade\)/);
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
const partlyAllocated = assemble({ spendingRows: [row('rtm', 'professional_fees', 76000, { funds_sent_to: 'RTM Capital' }),
  row('nextrade', 'professional_fees', 1250, { funds_sent_to: 'NextTrade Industries' }),
  row('nextrade-return', 'professional_fees', -50, { money_back_from: 'NextTrade Industries' })],
  funds: [...funding({}, { transfers: [{ id: 'rtm', date: '2026-06-25', sent: 76000, as_of: { applied_to_bills: 13447.36, services_rendered: 0, refunds: 0, held: 62552.64 } }] }),
    { party: 'NextTrade Industries', transfers: [{ id: 'nextrade', date: '2026-06-25', sent: 1250, as_of: { applied_to_bills: 200, refunds: 50, held: 1000 } }] }] });
assert.deepEqual(partlyAllocated.funding_by_company.rtm_funding.reconciliation, { sent: 7600000, bills: 1344736, left: 6255264, fees: 0, refunded: 0 });
assert.deepEqual(partlyAllocated.funding_by_company.nextrade_funding.reconciliation, { sent: 125000, bills: 20000, left: 100000, fees: 0, refunded: 5000 });
assert.deepEqual(partlyAllocated.funding.rows[0].allocation, { linked_cents: 1344736, unallocated_cents: 6255264 });
assert.deepEqual(partlyAllocated.bank_cash.rows.map(r => [r.id, r.category]), [
  ['rtm', 'rtm_funding'], ['nextrade', 'nextrade_funding'], ['nextrade-return', 'nextrade_funding'],
]);
assert.equal(partlyAllocated.funding_by_company.nextrade_funding.cents, 120000);

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
assert.equal(mixed.partner_billed.rows[0].date, '2026-07-31');
assert.equal(mixed.partner_billed.rows[0].bill_id, mixedBill.id);
assert.equal(mixed.partner_schedule.cents, 4525000);
assert.equal(mixed.partner_schedule.count, 1);
assert.match(mixed.partner_schedule.rows[0].source, /source bill missing/);
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
assert.equal(tasks.find(task => task.group === 'supplier_costs_missing').detail, 'Jun 2026 · 2 lines');
const shippingTask = tasks.find(task => task.group === 'shipment_costs_missing');
assert.match(shippingTask.issue, /also blocks the shipping calculation/);
assert.deepEqual(shippingTask.target, { kind: 'cost_entry' });
const spanningTasks = profitabilityWorkItems([cell, { ...cell, invoice_date: '2026-07-06', invoice: 'America 1759' }, supplierCell]);
assert.equal(spanningTasks.filter(task => task.group === 'shipment_costs_missing').length, 1);
assert.equal(spanningTasks.find(task => task.group === 'shipment_costs_missing').detail, 'Jun 2026, Jul 2026 · 2 lines');

const period = blankPeriodRow('2026-06', 'Jun 2026');
addPeriodCell(period, { goods_revenue: 247989.25, goods_profit: 98316.74, transport_revenue: 59524.25, transport_profit: 4409 });
addPeriodCell(period, { goods_revenue: 88159.26, goods_profit: null });
assert.equal(periodInvoices([{ invoice_id: 'a', goods_revenue: 40, transport_revenue: 12 }], false, true)[0].sold_cents, 4000);
assert.equal(periodInvoices([{ invoice_id: 'a', goods_revenue: 40, transport_revenue: 12 }], false)[0].sold_cents, 5200);
assert.deepEqual(pnlFormula(period, null, false).lines.slice(0, 3).map(r => r.cents), [33614851, 8815926, 24798925]);
const html = renderToStaticMarkup(React.createElement(PeriodPaidComparison, { period, periods: [period], comparison: bankMonth, invoiceRows: [], onFixCosts() {}, onOpenBill() {} }));
for (const text of ['Goods invoiced less payments', 'Bank receipts less payments', '$336,148.51', '$98,316.74', '$4,409.00', '$88,159.26', 'Fix missing costs', 'RTM funding']) assert.ok(html.includes(text), text);
assert.doesNotMatch(html, /Partner fee billed|Scheduled NexPac partner fee|Partner fee expected/);
const billedPartnerHtml = renderToStaticMarkup(React.createElement(PeriodPaidComparison, { period, periods: [period], basis: 'billed', invoiceRows: [], comparison: bankMonth, onOpenBill() {} }));
assert.equal(billedPartnerHtml.match(/Partner fee billed/g).length, 1);
assert.doesNotMatch(billedPartnerHtml, /Partner fee expected/);
const expectedHtml = renderToStaticMarkup(React.createElement(PeriodPaidComparison, {
  period, periods: [period], basis: 'billed', invoiceRows: [], comparison: assemble({ bills: {} }),
}));
assert.match(expectedHtml, /Partner fee expected[\s\S]*source bill missing/);
assert.doesNotMatch(expectedHtml, /Partner fee billed/);
const juneReport = renderToStaticMarkup(React.createElement(PeriodPaidComparison, {
  period, periods: [period], invoiceRows: [], basis: 'vendor', pnl: { cents: -2842386, complete: false }, onOpenPnl() {},
  comparison: { ...bankMonth, paid: { cents: 26988926, count: 0, rows: [] }, receipts: { cents: 40978220, count: 0, rows: [] },
    funding: { cents: 7600000, count: 4, rows: [] }, funding_by_company: { rtm_funding: { label: 'RTM funding', cents: 7600000 } },
    funded_paid: { cents: 1344736, count: 2, rows: [] } },
}));
for (const text of ['$336,148.51', '-$269,889.26', '= $66,259.25', '$409,782.20', '= $139,892.94', '$76,000.00', '$13,447.36',
  'Goods profit + transport profit', 'nt-paper']) assert.ok(juneReport.includes(text), text);
assert.match(juneReport, /Jun 2026 P&amp;L · <span style="color:#991b1b">-\$28,423\.86<\/span> · Provisional/);
assert.equal(juneReport.split('-$269,889.26').length - 1, 2);
assert.doesNotMatch(juneReport, /class="[^"]*\b(?:bg-white|bg-slate-50|text-red-800)\b/);
const fundingReport = renderToStaticMarkup(React.createElement(PeriodPaidComparison, {
  period, periods: [period], invoiceRows: [], comparison: juneFunding, onOpenBill() {},
}));
for (const text of ['Cash out for expenses and funding', 'Payments this transfer funded', 'Category</th>', 'Funding transfer 2026-06-25', '$65,750.00', 'Bill 14277']) assert.ok(fundingReport.includes(text), text);
const bankReport = renderToStaticMarkup(React.createElement(PeriodPaidComparison, {
  period, periods: [period], invoiceRows: [], comparison: { ...juneKtc, receipts: { cents: 40978220, count: 0, rows: [] } },
}));
for (const text of ['Cash out for expenses and funding', '-$332,551.90', '= $3,596.61', '= $77,230.30']) assert.ok(bankReport.includes(text), text);
const cashIncomeReport = renderToStaticMarkup(React.createElement(PeriodPaidComparison, { period, periods: [period], invoiceRows: [], comparison: cashIncome }));
assert.match(cashIncomeReport, /Cash receipts from the bank<\/span><span[^>]*>\$770\.00[\s\S]*?<span>Other income<\/span><span[^>]*>\$250\.00/);
const accruedReport = renderToStaticMarkup(React.createElement(PeriodPaidComparison, {
  period, periods: [period], invoiceRows: [], comparison: bankMonth, basis: 'billed', onOpenBill() {},
}));
for (const text of ['Goods invoiced less bills dated this period', '-$90,500.00', 'Bill 14277']) assert.ok(accruedReport.includes(text), text);
assert.doesNotMatch(accruedReport, /Bank receipts less payments/);
const editable = renderToStaticMarkup(React.createElement(PeriodPaidComparison, {
  period, periods: [period], invoiceRows: [], comparison: bankMonth, onOpenBill() {},
  categoryPicker: record => record.bank_edit || record.bill_id ? React.createElement('button', { type: 'button' }, 'Edit category for ' + record.id) : null,
}));
assert.match(editable, /Deposits to identify[\s\S]*Edit category for unknown-in/);
assert.match(editable, /Cash out for expenses and funding[\s\S]*Edit category for rent/);
assert.equal(editable.split('Edit category for rent').length - 1, 1);
assert.match(editable, /Other categorized deposits[\s\S]*Edit category for interest/);
assert.doesNotMatch(editable, /Edit category for rtm/);
const reconciledJune = renderToStaticMarkup(React.createElement(PeriodPaidComparison, { period, periods: [period], invoiceRows: [], comparison: juneKtc }));
assert.match(reconciledJune, /KTC Bank &amp; Card Activity \$332,551\.90[\s\S]*Expenses Paid This Period \$271,790\.36/);
assert.match(reconciledJune, />Bills &amp; Charges Incurred<\/button>/);
assert.match(reconciledJune, /<details open=""[^>]*><summary[^>]*>[\s\S]*?Cash out for expenses and funding · by category<\/span><span[^>]*>\$334,453\.00[\s\S]*?Daily Work → All Transactions/);
for (const [category, amount] of [['Vendor payment', '187,844.94'], ['Taxes', '53,880.82'], ['Professional Fees', '10,250.00'], ['Utilities', '1,150.02'], ['RTM funding', '76,000.00'], ['Customer payment', '110.00']]) {
  assert.equal(reconciledJune.split(`<span>${category}</span>`).length - 1, 1, category);
  assert.ok(reconciledJune.slice(reconciledJune.indexOf(`<span>${category}</span>`)).split('</summary>')[0].includes('$' + amount), category);
}
assert.doesNotMatch(reconciledJune, /Other direct KTC bank expenses|RTM \/ NextTrade funding activity|KTC bank payments awaiting an expense category/);
assert.match(reconciledJune, /<span>Utilities<\/span><span[^>]*>\$1,150\.02[\s\S]*?utility-bank<\/div>[\s\S]*?NextTrade utility vendor \(NextTrade\)/);
assert.match(reconciledJune, /<span>Bank Charges<\/span><span[^>]*>\$325\.30/);
const splitTaxes = assemble({
  spendingRows: [row('tax-payment', 'taxes', 53880.82)],
  nextradeExpenses: [{ id: 'nexttrade-payroll-tax', date: june.from, cents: 1542682, category: 'payroll_taxes', label: 'Payroll Taxes', who: 'Payroll tax payment' }],
  labels: { taxes: 'Taxes', payroll_taxes: 'Payroll Taxes' },
});
const taxHtml = renderToStaticMarkup(React.createElement(PeriodPaidComparison, { period, periods: [period], invoiceRows: [], comparison: splitTaxes }));
assert.match(taxHtml, /<span>Taxes<\/span><span[^>]*>\$69,307\.64/);
assert.match(taxHtml, /<span>General Taxes<\/span><span[^>]*>\$53,880\.82/);
assert.match(taxHtml, /<span>Taxes<\/span><span[^>]*>\$69,307\.64<span[^>]*>\$15,426\.82 \(NextTrade\)/);
assert.match(taxHtml, /<span>Payroll Taxes<\/span><span[^>]*>\$15,426\.82<span[^>]*>\$15,426\.82 \(NextTrade\)/);
assert.match(taxHtml, /Payroll tax payment \(NextTrade\)/);
const screenshotCard = { account_label: 'KTC card •3774', is_credit_card: true };
const cardActivity = assemble({
  spendingRows: [row('Rsc', 'bond', 750, screenshotCard), row('First American Home Warranty', 'insurance', 94.13, screenshotCard),
    row('Hiro Asian Bistro', 'food_entertainment', 45.41, screenshotCard), row("BJ’s Wholesale Club", '', 16.83, screenshotCard)],
  labels: { bond: 'Bond', insurance: 'Insurance', food_entertainment: 'Food & Entertainment' },
});
assert.deepEqual(cardActivity.combined_expenses.rows.map(row => [row.category, row.cents, row.credit_card]),
  [['bond', 75000, true], ['insurance', 9413, true], ['food_entertainment', 4541, true], ['uncategorized', 1683, true]]);
const cardHtml = renderToStaticMarkup(React.createElement(PeriodPaidComparison, { period, periods: [period], invoiceRows: [], comparison: cardActivity }));
assert.match(cardHtml, /Rsc<\/div><div[^>]*>KTC card •3774 · Credit card/);
const accountAudit = assemble({ sourceKtcTransactions: [
  { id: 'fees', date: june.from, direction: 'out', amount_abs: 10000, classification: 'professional_fees', account_id: 'platinum', account_label: 'PLAT BUS CHECKING •6338' },
  { id: 'amex', date: june.from, direction: 'out', amount_abs: 20280, classification: 'transfer', account_id: 'platinum', account_label: 'PLAT BUS CHECKING •6338' },
  { id: 'receipt', date: june.from, direction: 'in', amount_abs: 1950, classification: 'customer_payment', account_id: 'pnc', account_label: 'PNC Checking •9704' },
  { id: 'pending-card', date: june.from, direction: 'out', amount_abs: 3.19, pending: true, account_id: 'card', ...screenshotCard },
] });
assert.equal(accountAudit.ktc_transactions.count, 4);
assert.deepEqual(accountAudit.ktc_transactions.rows.map(row => [row.cents, row.status]), [
  [-1000000, 'Posted'], [-2028000, 'Transfer'], [195000, 'Posted'], [-319, 'Pending'],
]);
assert.equal(accountAudit.ktc_transactions.cents, -2833000);
assert.equal(accountAudit.bank_cash.cents, 0);
const accountHtml = renderToStaticMarkup(React.createElement(PeriodPaidComparison, { period, periods: [period], invoiceRows: [], comparison: accountAudit }));
assert.match(accountHtml, /KTC transactions by account · 4 records/);
assert.match(accountHtml, /PLAT BUS CHECKING •6338 · 2 records/);
assert.match(accountHtml, /PNC Checking •9704 · 1 record/);
assert.match(accountHtml, /KTC card •3774 · 1 record/);
assert.doesNotMatch(reconciledJune, /NextTrade charges incurred for KTC · reference/);
assert.match(reconciledJune, /Customer payment[\s\S]*?misclassified-debit[\s\S]*?Money out is categorized as Customer payment/);
assert.match(reconciledJune, /style="color:#991b1b">-\$4,144\.00<\/td>/);
assert.match(reconciledJune, /style="color:#991b1b">= -\$332,551\.90<\/b>/);
const serviceRows = [row('shipping-paid', 'shipping', 175.25), row('technology-paid', 'technology', 30, { account_subtype: 'credit card' }),
  row('technology-refund', 'technology', -10, { money_in: true }), row('paired-card-payment', 'transfer', 30, { paired: true })];
const serviceCash = assemble({ spendingRows: serviceRows, labels: { shipping: 'Shipping', technology: 'Technology' } });
const serviceHtml = renderToStaticMarkup(React.createElement(PeriodPaidComparison, { period, periods: [period], invoiceRows: [], comparison: serviceCash }));
assert.match(serviceHtml, /<span>Shipping<\/span><span[^>]*>\$175\.25/);
assert.match(serviceHtml, /<span>Technology<\/span><span[^>]*>\$20\.00/);
assert.match(serviceHtml, /technology-paid<\/div><div[^>]*>Credit card<\/div>/);
assert.doesNotMatch(serviceHtml, /paired-card-payment/);
assert.match(serviceHtml, /style="color:#991b1b">-\$10\.00<\/td>/);
const splitFunding = renderToStaticMarkup(React.createElement(PeriodPaidComparison, { period, periods: [period], invoiceRows: [], comparison: partlyAllocated }));
assert.match(splitFunding, /<span>RTM funding<\/span><span[^>]*>\$76,000\.00/);
assert.match(splitFunding, /<span>NextTrade funding<\/span><span[^>]*>\$1,200\.00/);
assert.doesNotMatch(splitFunding, /RTM \/ NextTrade funding/);
const lossFormula = renderToStaticMarkup(React.createElement(PnlFormula, { formula: { lines: [{ sign: '=', label: 'Net loss', cents: -1234 }], not_used: [], notes: [] } }));
assert.match(lossFormula, /style="vertical-align:top;color:#991b1b">−\$12\.34<\/td>/);
const groupedJune = renderToStaticMarkup(React.createElement(PeriodPaidComparison, { period, periods: [period], basis: 'vendor', invoiceRows: [], comparison: juneKtc }));
const tracking = groupedJune.indexOf('NextTrade charges incurred for KTC · reference');
assert.ok(tracking > groupedJune.indexOf('Profit &amp; Loss'));
const mainCategories = groupedJune.slice(0, tracking);
assert.match(mainCategories, /<span>Utilities<\/span><span[^>]*>\$1,150\.02[\s\S]*?utility-bank<\/div>[\s\S]*?NextTrade utility vendor \(NextTrade\)/);
assert.match(mainCategories, /<span>Bank Charges<\/span><span[^>]*>\$325\.30/);
assert.match(groupedJune.slice(tracking), /\$1,901\.10[\s\S]*?already included/);
assert.doesNotMatch(groupedJune.slice(tracking), /NextTrade utility vendor|<span>Utilities<\/span>/);
const restrictedBreakdown = assemble({ spendingRows: [row('restricted-rent', 'rent', 12), row('restricted-unknown', '', 3)], showRows: false });
assert.deepEqual(restrictedBreakdown.bank_cash, { cents: 1500, count: 2, rows: [] });
assert.deepEqual(restrictedBreakdown.bank_review, { cents: 300, count: 1, rows: [] });
console.log('PASS: period comparison reconciliation, source records, RTM funding and refunds, partner duplicates, account transfers, foreign currency, access, and missing costs.');
