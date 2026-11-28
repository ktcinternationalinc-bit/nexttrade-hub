const assert = require('node:assert/strict');
const { resolve } = require('node:path');
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://test.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'test-key';
require(resolve(__dirname, '../node_modules/sucrase/register'));
const { buildPaidThroughBlocks, spendingCategoryBankRows, uniquePaidThroughBankRows } = require('../src/lib/paid-through-blocks');
const { rtmAdjust, foldUnc } = require('../src/components/PeriodStatsTab.jsx');
const { fundingIdentity, partyFundsBreakdown } = require('../src/lib/party-funds');
const { finalPnl, readExpenseAnswer } = require('../src/lib/pnl-expenses');

const category = 'professional_fees';
const direct = { id: 'fee', category, amount: 247350 };
const rt = { id: 'rtm', category, amount: 827195 };
const nt = { id: 'nextrade', category, amount: 29000 };
const rtReturn = { id: 'rtm-return', category, amount: -195, money_in: true };
const rows = [direct, rt, nt, rtReturn];
const parties = [{ name: 'RTM Capital', kind: 'service_provider' }, { name: 'NextTrade Industries', kind: 'affiliate' }];
const blockRows = [rt, nt, rtReturn].map((row, index) => ({ ...row, date: '2026-09-30', classification: category,
  payer: parties[index === 1 ? 1 : 0].name, money_back: row.money_in === true }));
const blocks = buildPaidThroughBlocks({ from: '2026-01-01', to: '2026-11-28', parties, lines: blockRows });

assert.deepEqual(spendingCategoryBankRows(rows, category, []), rows);
assert.deepEqual(spendingCategoryBankRows(rows, category, [blocks[0]]), [direct, nt]);
assert.deepEqual(spendingCategoryBankRows(rows, category, blocks), [direct]);
const total = rows.reduce((sum, row) => sum + row.amount, 0);
const projected = blocks.reduce(rtmAdjust, [{ key: category, label: 'Professional Fees', count: rows.length, total }]);
const fees = projected.find(row => row.key === category);
assert.equal(fees.count, 1);
assert.equal(fees.total, 247350);
assert.equal(projected.reduce((sum, row) => sum + row.total, 0), total);
console.log('PASS: Paid-through transfers and refunds move together in totals, row counts, and drill-down.');

const transfer = { id: 'deposit', direction: 'out', date: '2026-06-25', amount_abs: 80000, name: 'Online Transfer to CHK ...9909 transaction#: 12345678', third_party_payer: 'RTM Capital' };
const copy = { ...transfer, id: 'copy', third_party_payer: null };
const other = { ...copy, id: 'other', name: 'Online Transfer to CHK ...9909 transaction#: 12345679' };
assert.deepEqual(uniquePaidThroughBankRows([copy, transfer, other], fundingIdentity), [transfer, other]);
const billById = { rent: { category: 'rent', total_amount: 75000, paid_via: 'RTM Capital' }, later: { category: 'utilities', total_amount: 5000, paid_via: 'RTM Capital' } };
const pays = [
  { id: 'june-portion', bill_id: 'rent', bank_transaction_id: transfer.id, method: 'rtm', paid_date: '2026-06-28', amount: 75000 },
  { id: 'july-portion', bill_id: 'later', bank_transaction_id: transfer.id, method: 'rtm', paid_date: '2026-07-03', amount: 5000 },
];
function report(from, to, payments = pays, bills = billById) {
  const hasTransfer = from <= transfer.date && transfer.date <= to;
  const categories = hasTransfer ? [{ key: category, label: 'Professional Fees', kind: 'expense', total: 80000, count: 1 }] : [];
  const lines = hasTransfer ? [{ ...transfer, payer: 'RTM Capital', classification: category, amount: transfer.amount_abs }] : [];
  const paid_through = buildPaidThroughBlocks({ parties, pays: payments, billById: bills, lines, from, to });
  const party_funds = partyFundsBreakdown({ parties, bankLines: [transfer, copy], pays: payments, bills, from, to });
  return readExpenseAnswer({ ok: true, from, to, spending: { categories, paid_through, party_funds } }, { from, to }, rtmAdjust, foldUnc);
}
const june = report('2026-06-01', '2026-06-30');
const july = report('2026-07-01', '2026-07-31');
const whole = report('2026-06-01', '2026-07-31');
assert.equal(june.detail.funding[0].period.tax_cents, 8000000);
assert.equal(june.detail.byKey.rent.cents, 7500000);
assert.equal(june.detail.byKey.__pf_rtm_capital_provisional_fee.cents, 500000);
assert.equal(june.cols.total, 8000000);
assert.equal(july.detail.funding[0].period.tax_cents, 0);
assert.equal(july.detail.byKey.utilities.cents, 500000);
assert.equal(july.detail.byKey.__pf_rtm_capital_provisional_fee.cents, -500000);
assert.equal(july.cols.total, 0);
assert.equal(whole.cols.total, june.cols.total + july.cols.total);
assert.equal(whole.detail.funding[0].period.provisional_fee_cents, 0);
console.log('PASS: An $80,000 transfer with $75,000 in linked bills leaves $5,000 in Professional Fees; a later allocation replaces it cent for cent.');

const shipmentCosts = { goods_cost: 47000, commission: 5000, inbound_allowance: 3000, bonded: 2000, outbound_transport: 18000 };
const shipmentBills = Object.fromEntries(Object.entries(shipmentCosts).map(([key, amount]) => [key, { category: key, total_amount: amount, paid_via: 'RTM Capital' }]));
const shipmentPayments = Object.entries(shipmentCosts).map(([key, amount]) => ({ ...pays[0], id: key, bill_id: key, amount }));
const shipmentReport = report('2026-06-01', '2026-06-30', shipmentPayments, shipmentBills);
assert.equal(shipmentReport.detail.funding[0].applied_rows.length, 5);
assert.equal(shipmentReport.detail.funding[0].period.tax_cents, 8000000);
assert.equal(shipmentReport.cols.in_profit.cents, 7500000);
assert.equal(shipmentReport.cols.A.cents, 500000);
assert.equal(finalPnl(10272574, shipmentReport.cols, 0).cents, 9772574);
console.log('PASS: $75,000 of RTM-funded shipment costs are excluded from overhead and only $5,000 is deducted from the shipment margin.');
