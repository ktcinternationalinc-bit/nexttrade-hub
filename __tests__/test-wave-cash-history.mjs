import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { parseWaveCashHistory, cashHistoryPeriod } from '../src/lib/wave-cash-history.js';
const head = 'Account Transactions\nNextrade LLC\nDate Range: 2021-01-01 to 2026-06-01\nReport Type: Cash Basis (Paid)\nACCOUNT NUMBER,DATE,DESCRIPTION,DEBIT (In Business Currency),CREDIT (In Business Currency),BALANCE (In Business Currency)\n';
const fixture = head + ',Checking,,,,\nStarting Balance,,,,,$0.00\n,2021-01-02,Rent,,$100.00,-$100.00\nTotals and Ending Balance,,,$0.00,$100.00,-$100.00\nBalance Change,,,-$100.00,,\n""\n,Rent Expense,,,,\nStarting Balance,,,,,$0.00\n,2021-01-02,"Rent, first\nmonth",$100.00,,$100.00\nTotals and Ending Balance,,,$100.00,$0.00,$100.00\n';
test('section category, multiline description, full-period reconciliation and raw metadata', () => {
  const r = parseWaveCashHistory(fixture, 'USD');
  assert.equal(r.entries.length, 2); assert.equal(r.accounts.length, 2);
  assert.equal(r.entries[1].account_name, 'Rent Expense');
  assert.equal(r.entries[1].description, 'Rent, first\nmonth');
  assert.equal(r.entries[1].debit_minor, 10000); assert.equal(r.debit, r.credit);
  assert.equal(r.basis, 'cash'); assert.equal(r.start, '2021-01-01');
});
test('wrong company, basis, columns, dates, total, currency and malformed CSV refused', () => {
  for (const csv of [fixture.replace('Nextrade LLC','KTC LLC'), fixture.replace('Cash Basis (Paid)','Accrual'),
    fixture.replace('ACCOUNT NUMBER','Account'), fixture.replace('2021-01-02','2020-01-02'),
    fixture.replace('Totals and Ending Balance,,,$100.00','Totals and Ending Balance,,,$99.00'), fixture + '"unfinished']) {
    assert.throws(() => parseWaveCashHistory(csv,'USD'));
  }
  assert.throws(() => parseWaveCashHistory(fixture,'BAD'));
  assert.throws(() => cashHistoryPeriod('2026-02-30','2026-03-01'));
});
test('repeated headings stay distinct and credits retain their sign', () => {
  const csv = fixture.replace('Checking','Interest Expense').replace('Rent Expense','Interest Expense');
  const r = parseWaveCashHistory(csv,'USD');
  assert.notEqual(r.accounts[0].key,r.accounts[1].key);
  assert.equal(r.accounts[0].credit,10000); assert.equal(r.accounts[0].debit,0);
});
test('actual user export when explicitly provided', { skip: !process.env.WAVE_CASH_TEST_CSV }, () => {
  const r = parseWaveCashHistory(fs.readFileSync(process.env.WAVE_CASH_TEST_CSV,'utf8'),'USD');
  assert.equal(r.entries.length,11646); assert.equal(r.accounts.length,73);
  assert.equal(r.debit,4197041813); assert.equal(r.credit,4197041813);
  assert.equal(r.entries.filter(e=>e.description.includes('\n')).length,19);
  assert(r.entries.every(e=>e.account_name && e.account_key));
});
export { fixture };
