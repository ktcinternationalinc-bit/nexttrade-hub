import { parseCsv, parseDate, readWaveMinor, waveCurrency, WaveHistoryError } from './wave-history.js';

export function parseWaveCashHistory(csv, currency) {
  waveCurrency(currency);
  const rows = parseCsv(csv);
  const range = /^Date Range: (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})$/.exec(rows[2]?.[0] || '');
  if (rows[0]?.[0] !== 'Account Transactions' || rows[1]?.[0] !== 'Nextrade LLC' ||
      rows[3]?.[0] !== 'Report Type: Cash Basis (Paid)' || !range ||
      !parseDate(range[1]) || !parseDate(range[2]) || range[1] > range[2]) {
    throw new WaveHistoryError('Use the Nextrade LLC Account Transactions CSV on Cash Basis (Paid).');
  }
  const expected = ['ACCOUNT NUMBER', 'DATE', 'DESCRIPTION', 'DEBIT (In Business Currency)', 'CREDIT (In Business Currency)', 'BALANCE (In Business Currency)'];
  if (JSON.stringify(rows[4]) !== JSON.stringify(expected)) throw new WaveHistoryError('The Wave CSV columns are not recognized.');
  const entries = [], accounts = [], occurrences = new Map();
  let account, debit = 0, credit = 0;
  function finish() {
    if (account && (!account.closed || account.debit !== account.expectedDebit || account.credit !== account.expectedCredit)) {
      throw new WaveHistoryError('The debit/credit totals do not reconcile for ' + account.name + '.');
    }
  }
  for (let index = 5; index < rows.length; index++) {
    const row = rows[index];
    if (!row.some(Boolean)) continue;
    if (row.length !== 6) throw new WaveHistoryError('Invalid CSV record ' + (index + 1) + '.');
    const [marker, date, description, dr, cr] = row;
    if (marker === 'Starting Balance' || marker === 'Balance Change') {
      if (!account) throw new WaveHistoryError('Balance without an account.');
      continue;
    }
    if (marker === 'Totals and Ending Balance') {
      if (!account || account.closed) throw new WaveHistoryError('Unexpected account totals.');
      account.expectedDebit = readWaveMinor(dr, currency, 'Account debit', true);
      account.expectedCredit = readWaveMinor(cr, currency, 'Account credit', true);
      account.closed = true;
      finish();
      continue;
    }
    if (date && !parseDate(date) && !description && !dr && !cr && !row[5]) {
      finish();
      const identity = JSON.stringify([marker, date]);
      const occurrence = (occurrences.get(identity) || 0) + 1;
      occurrences.set(identity, occurrence);
      account = { key: JSON.stringify([marker, date, occurrence]), name: date, number: marker, occurrence,
        rows: 0, debit: 0, credit: 0, closed: false };
      accounts.push(account);
      continue;
    }
    if (!account || account.closed || !parseDate(date) || date < range[1] || date > range[2]) {
      throw new WaveHistoryError('Invalid date or account at CSV record ' + (index + 1) + '.');
    }
    const d = readWaveMinor(dr, currency, 'Debit', true), c = readWaveMinor(cr, currency, 'Credit', true);
    if (d && c) throw new WaveHistoryError('A ledger line contains both debit and credit.');
    entries.push({ source_row: index + 1, account_key: account.key, account_name: account.name,
      posted_date: date, description, debit_minor: d, credit_minor: c });
    account.debit += d; account.credit += c; account.rows++; debit += d; credit += c;
    if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit)) throw new WaveHistoryError('Ledger totals exceed the supported size.');
  }
  finish();
  if (!entries.length || debit !== credit) throw new WaveHistoryError('The complete cash ledger must balance before importing.');
  return { profile: rows[1][0], basis: 'cash', start: range[1], end: range[2], currency,
    entries, accounts, debit, credit };
}

export function cashHistoryPeriod(from, to) {
  if (!parseDate(from || '') || !parseDate(to || '') || from > to) throw new WaveHistoryError('Choose a valid From and To date.');
  return { p_from: from, p_to: to };
}
