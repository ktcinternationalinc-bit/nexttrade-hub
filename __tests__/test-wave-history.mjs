import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildWaveComparison, comparisonPeriods, parseWaveLedger, readWaveMinor, waveCurrency, waveMonth } from '../src/lib/wave-history.js';

const header = 'Account Name,Account Type,Transaction Date,Transaction Description,Other Accounts for this Transaction,Debit Amount (One column),Credit Amount (One column),Amount (One column),Balance';

test('reads both sides of the Wave ledger, keeps split categories and raw descriptions, and skips summary lines', () => {
  const csv = '\uFEFF' + [
    header,
    'Checking,Cash and Bank,,Starting Balance,,,,,0',
    'Checking,Cash and Bank,2023-10-07,"Invoice ""A"", October","Warehouse Rent, Electricity",,150.75,-150.75,0',
    'Warehouse Rent,Operating Expenses,10/7/2023,"Invoice ""A"", October",Checking,100,,100,0',
    'Electricity,Operating Expenses,"Oct 7, 2023","Invoice ""A"", October",Checking,50.75,,50.75,0',
    'Checking,Cash and Bank,2023-10-08,Internal transfer,Savings,,20,-20,0',
    'Savings,Cash and Bank,2023-10-08,Internal transfer,Checking,20,,20,0',
    'Checking,Cash and Bank,,Ending Balance,,,,,0',
  ].join('\r\n');
  const ledger = parseWaveLedger(csv, waveMonth('2023-10'), waveCurrency('USD'));
  assert.equal(ledger.debit, 17075);
  assert.equal(ledger.credit, 17075);
  assert.equal(ledger.entries.length, 5);
  assert.equal(ledger.entries[0].description, 'Invoice "A", October');
  assert.deepEqual(ledger.entries.map(row => row.kind), ['other', 'expense', 'expense', 'other', 'other']);
});

test('rejects incomplete formatting, unexpected months, and incompatible monetary precision', () => {
  assert.throws(() => parseWaveLedger(header + '\nChecking,Cash and Bank,2023-11-01,Transfer,Savings,,1,-1,0', '2023-10', 'USD'), /outside/);
  assert.throws(() => parseWaveLedger(header + '\nChecking,Cash and Bank,2023-10-40,Transfer,Savings,,1,-1,0', '2023-10', 'USD'), /invalid date/);
  assert.throws(() => parseWaveLedger(header + '\nChecking,Cash and Bank,2023-10-10,Transfer,Savings,1,1,0,0', '2023-10', 'USD'), /both a debit and a credit/);
  assert.throws(() => parseWaveLedger('Date,Description,Amount\n2023-10-01,Example,20', '2023-10', 'USD'), /Account Transactions/);
  assert.throws(() => readWaveMinor('9.125', 'USD', 'Debit'), /nonnegative amount/);
  assert.equal(readWaveMinor('$1,025.08', 'USD', 'Debit'), 102508);
  assert.equal(readWaveMinor('9.125', 'KWD', 'Debit'), 9125);
  assert.equal(readWaveMinor('10', 'JPY', 'Debit'), 10);
});

test('uses like-for-like months and only calculates changes when both periods are covered', () => {
  const periods = comparisonPeriods('2023', '10');
  const accounts = [
    { account_key: 'rent-1', account_name: 'Warehouse Rent', kind: 'expense', current_minor: 11000, prior_minor: 10000 },
    { account_key: 'rent-2', account_name: 'Office Rent', kind: 'expense', current_minor: 2000, prior_minor: 0 },
    { account_key: 'insurance', account_name: 'Business Insurance', kind: 'expense', current_minor: 8000, prior_minor: 0 },
  ];
  const partial = buildWaveComparison({ months: ['2023-10'], accounts, unclassified: 0 }, periods);
  assert.equal(partial.complete, false);
  assert.equal(partial.rows[0].change_minor, null);
  assert.deepEqual(partial.prior.imported, []);

  const complete = buildWaveComparison({ months: ['2023-10', '2022-10'], accounts, unclassified: 0 }, periods);
  const rent = complete.rows.find(row => row.category === 'Rent');
  assert.equal(rent.change_minor, 3000);
  assert.equal(rent.change_percent, 30);
  assert.equal(complete.rows.find(row => row.category === 'Insurance').change_percent, null);
  assert.equal(comparisonPeriods('2023', '12').current.end, '2024-01-01');
  assert.equal(comparisonPeriods('2023', '0').current.months.length, 12);
});
