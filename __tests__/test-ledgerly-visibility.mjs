import test from 'node:test';
import assert from 'node:assert/strict';
import { ledgerlyVisibleResources, projectLedgerlyForViewer } from '../src/lib/ledgerly-visibility.js';

const allResources = ['summary', 'invoices', 'bills', 'expenses', 'checks', 'contacts', 'journal', 'bank-accounts', 'bank-transactions'];
const full = { canViewFullDashboard: true, canViewBankBalances: false };
const bank = { canViewFullDashboard: false, canViewBankBalances: true };
const superAdmin = { canViewFullDashboard: true, canViewBankBalances: true };
const reviewer = { ...full, canViewBankAccounts: true, canViewBankTransactions: true, canViewBankTransactionAmounts: true };
function response(resource, data) {
  return { ok: true, configured: true, resources: allResources, status: { available: true }, snapshot: { revision: 12, currency: 'USD' },
    dataset: { resource, total: Array.isArray(data) ? data.length : 1, data, offset: 0, limit: 50, nextOffset: null } };
}

test('two independent special permissions expose their own datasets without inheriting one another', () => {
  assert.deepEqual(ledgerlyVisibleResources(allResources, {}), []);
  assert.deepEqual(ledgerlyVisibleResources(allResources, full), ['summary', 'invoices', 'bills', 'expenses', 'checks', 'contacts']);
  assert.deepEqual(ledgerlyVisibleResources(allResources, bank), ['bank-accounts', 'bank-transactions']);
  assert.deepEqual(ledgerlyVisibleResources(allResources, superAdmin), allResources);
});

test('full dashboard retains all nonbank figures and omits cash totals entirely', () => {
  const raw = response('summary', { revenueCents: 400000, expenseCents: 100000, netProfitCents: 300000, cashCents: 867530999,
    receivablesCents: 4500, payablesCents: 3000, salesTaxPayableCents: 1200, planningReserveCents: 60000, openInvoiceCount: 2, overdueInvoiceCount: 1, balanced: true, futureBankBalance: 700 });
  const actual = projectLedgerlyForViewer(raw, full);
  assert.equal(JSON.stringify(actual).includes('867530999'), false);
  assert.equal(Object.hasOwn(actual.dataset.data, 'cashCents'), false);
  assert.equal(Object.hasOwn(actual.dataset.data, 'futureBankBalance'), false);
  assert.equal(actual.dataset.data.netProfitCents, 300000);
  assert.equal(actual.dataset.data.planningReserveCents, 60000);
  assert.equal(actual.dataset.data.receivablesCents, 4500);
  assert.equal(actual.dataset.data.payablesCents, 3000);
  assert.equal(actual.dataset.data.salesTaxPayableCents, 1200);
  assert.equal(actual.dataset.data.openInvoiceCount, 2);
  assert.equal(raw.dataset.data.cashCents, 867530999, 'Shared snapshot remains complete for authorized viewers');
});

test('bank account labels remain usable for operational staff while current and available balances stay off the wire', () => {
  const account = { id: 'a', connectionId: 'c', institutionName: 'Example Bank', name: 'Checking', mask: '1234', currency: 'USD', ledgerAccountId: '1000',
    currentBalanceCents: 123456789, availableBalanceCents: 987654321, unknownBalance: 777, lastSyncedAt: '2026-10-24T12:00:00Z' };
  const raw = response('bank-accounts', [account]);
  const actual = projectLedgerlyForViewer(raw, reviewer);
  const text = JSON.stringify(actual);
  for (const field of ['currentBalanceCents', 'availableBalanceCents', 'unknownBalance']) assert.equal(text.includes(field), false);
  assert.equal(text.includes('123456789'), false); assert.equal(text.includes('987654321'), false);
  assert.equal(actual.dataset.data[0].mask, '1234'); assert.equal(actual.dataset.data[0].ledgerAccountId, '1000');
  assert.equal(account.currentBalanceCents, 123456789);
});

test('authorized bank viewers receive real zero and unavailable balances without confusing either with hidden values', () => {
  const raw = response('bank-accounts', [{ id: 'a', currentBalanceCents: 0, availableBalanceCents: null }]);
  const actual = projectLedgerlyForViewer(raw, bank);
  assert.equal(actual.dataset.data[0].currentBalanceCents, 0);
  assert.equal(actual.dataset.data[0].availableBalanceCents, null);
  actual.dataset.data[0].currentBalanceCents = 999;
  assert.equal(raw.dataset.data[0].currentBalanceCents, 0);
});

test('invoice, bill, expense, check and contact details preserve permitted ordinary accounting data', () => {
  for (const resource of ['invoices', 'bills', 'expenses', 'checks', 'contacts']) {
    const rows = [{ id: resource + '-1', amountCents: 9900, totalCents: 19900, paidCents: 10000, outstandingCents: 9900,
      payee: 'Vendor', memo: 'Payroll supplies', categoryId: '6100', lines: [{ description: 'Item', quantity: 2 }] }];
    const actual = projectLedgerlyForViewer(response(resource, rows), full);
    assert.deepEqual(actual.dataset.data, rows);
    assert.notEqual(actual.dataset.data, rows);
  }
});

test('individual transaction review and matching data survive without account balance permission', () => {
  const rows = [{ id: 'txn', amountCents: -4500, accountId: 'acct', accountName: 'Operating', accountMask: '1234', status: 'review', journalId: 'payment', description: 'Invoice settlement', currency: 'USD' }];
  assert.deepEqual(projectLedgerlyForViewer(response('bank-transactions', rows), reviewer).dataset.data, rows);
  const withoutAmounts = projectLedgerlyForViewer(response('bank-transactions', rows), { ...reviewer, canViewBankTransactionAmounts: false });
  assert.equal(Object.hasOwn(withoutAmounts.dataset.data[0], 'amountCents'), false);
  assert.equal(withoutAmounts.dataset.data[0].accountId, 'acct');
});

test('complete journal, including opening balances and adjustments, needs both special permissions', () => {
  const raw = response('journal', [{ id: 'opening', sourceType: 'openingBalance', lines: [{ accountId: '1000', debit: 66554433, credit: 0 }] }]);
  for (const access of [full, bank, reviewer]) {
    const result = projectLedgerlyForViewer(raw, access);
    assert.equal(result.dataset, null); assert.equal(result.snapshot, null); assert.equal(result.status.available, false);
    assert.equal(JSON.stringify(result).includes('66554433'), false);
    assert.equal(result.resources.includes('journal'), false);
  }
  assert.deepEqual(projectLedgerlyForViewer(raw, superAdmin).dataset.data, raw.dataset.data);
});

test('a later permission revocation reprojects the same snapshot without retaining an earlier privileged response', () => {
  const raw = response('summary', { cashCents: 123456, revenueCents: 500 });
  const privileged = projectLedgerlyForViewer(raw, superAdmin);
  const revoked = projectLedgerlyForViewer(raw, full);
  assert.equal(privileged.dataset.data.cashCents, 123456);
  assert.equal('cashCents' in revoked.dataset.data, false);
  assert.equal(revoked.dataset.data.revenueCents, 500);
  assert.equal(revoked.capabilities.canViewBankBalances, false);
  assert.equal(raw.dataset.data.cashCents, 123456);
});
