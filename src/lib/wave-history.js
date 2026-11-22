export const MAX_WAVE_CSV_BYTES = 3_000_000;

export class WaveHistoryError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function waveCurrency(value) {
  const currency = String(value || '').trim().toUpperCase();
  if (!Intl.supportedValuesOf('currency').includes(currency)) {
    throw new WaveHistoryError('Enter the three-letter reporting currency shown in Wave.');
  }
  return currency;
}

export function currencyScale(currency) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
}

export function waveMonth(value) {
  if (typeof value !== 'string' || !/^(19\d\d|20\d\d)-(0[1-9]|1[0-2])$/.test(value)) {
    throw new WaveHistoryError('Select a valid Wave report month.');
  }
  return value;
}

export function readWaveMinor(value, currency, label, allowBlank = false) {
  const raw = String(value ?? '').trim();
  if (allowBlank && (!raw || /^[-–—]$/.test(raw))) return 0;
  const unsigned = raw.replace(/^[-+]/, '').replace(/^\(/, '').replace(/\)$/, '').trim();
  const clean = unsigned.replace(/^[A-Z]{3}\s+|\s+[A-Z]{3}$/gi, '').replace(/^\p{Sc}\s*|\s*\p{Sc}$/gu, '').trim();
  const validSign = /^(?:\+?[^()+-]+|-[^()+-]+|\([^()+-]+\))$/.test(raw);
  const match = /^(\d+|\d{1,3}(?:,\d{3})+)(?:\.(\d+))?$/.exec(clean);
  const scale = currencyScale(currency);
  const decimals = match?.[2] || '';
  if (!validSign || !match || raw.startsWith('-') || raw.startsWith('(') || /[1-9]/.test(decimals.slice(scale))) {
    throw new WaveHistoryError(label + ' must be a nonnegative amount in ' + currency + '.');
  }
  const amount = Number(match[1].replace(/,/g, '') + decimals.slice(0, scale).padEnd(scale, '0'));
  if (!Number.isSafeInteger(amount)) throw new WaveHistoryError(label + ' exceeds the supported amount.');
  return amount;
}

function parseCsv(csv) {
  const rows = [];
  const source = csv.replace(/^\uFEFF/, '');
  let row = [];
  let field = '';
  let quoted = false;
  let closed = false;

  for (let cursor = 0; cursor < source.length; cursor++) {
    const char = source[cursor];
    if (quoted) {
      if (char !== '"') field += char;
      else if (source[cursor + 1] === '"') {
        field += char;
        cursor++;
      } else {
        quoted = false;
        closed = true;
      }
    } else if (char === ',' || char === '\n' || char === '\r') {
      row.push(field.trim());
      field = '';
      closed = false;
      if (char !== ',') {
        rows.push(row);
        row = [];
        if (char === '\r' && source[cursor + 1] === '\n') cursor++;
      }
    } else if (char === '"' && !field && !closed) {
      quoted = true;
    } else {
      if (char === '"' || (closed && char !== ' ' && char !== '\t')) {
        throw new WaveHistoryError('Malformed CSV near row ' + (rows.length + 1) + '.');
      }
      if (!closed) field += char;
    }
  }
  if (quoted) throw new WaveHistoryError('The CSV ends in an unfinished quoted field.');
  if (row.length || field || closed) rows.push([...row, field.trim()]);
  return rows;
}

function parseDate(value) {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  const named = /^([a-z]{3,9})\.? (\d{1,2}),? (\d{4})$/i.exec(value);
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const date = iso ? value : us ? [us[3], us[1].padStart(2, '0'), us[2].padStart(2, '0')].join('-') : named ?
    [named[3], String(months.indexOf(named[1].slice(0, 3).toLowerCase()) + 1).padStart(2, '0'), named[2].padStart(2, '0')].join('-') : '';
  const parsed = new Date(date + 'T00:00:00Z');
  return date && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

function accountKind(type, group) {
  for (const label of [group, type]) {
    if (/\b(asset|liabilit(?:y|ies)|equity|cash|bank|credit card|receivable|payable)\b/i.test(label)) return 'other';
    if (/\b(expenses?|cost of (?:goods|sales|services)\b|cogs\b|loss(?:es)?\b)/i.test(label)) return 'expense';
    if (/\b(income|revenues?|gains?|sales)\b/i.test(label)) return 'income';
  }
  return 'unclassified';
}

function accountColumn(header, pattern) {
  return header.findIndex(cell => pattern.test(cell.toLowerCase()));
}

function ledgerColumns(header) {
  return {
    account: accountColumn(header, /^account(?: name)?$/),
    type: accountColumn(header, /^account type$/),
    group: accountColumn(header, /^account (?:group|class)$/),
    date: accountColumn(header, /^(?:transaction |posted )?date$/),
    description: accountColumn(header, /^(?:transaction )?description$|^memo$/),
    debit: accountColumn(header, /^debit(?: amount)?(?: \(one column\))?(?: \([a-z]{3}\))?$/),
    credit: accountColumn(header, /^credit(?: amount)?(?: \(one column\))?(?: \([a-z]{3}\))?$/),
    other: accountColumn(header, /^other accounts? for this transaction$/),
    reference: accountColumn(header, /^(?:wave )?transaction (?:id|ref(?:erence)?)$/),
    currency: accountColumn(header, /^(?:reporting |business )?currency(?: code)?$/),
  };
}

export function parseWaveLedger(csv, month, currency) {
  const rows = parseCsv(csv);
  let headers;
  let headerIndex = -1;
  for (let index = 0; index < Math.min(rows.length, 20); index++) {
    const candidate = ledgerColumns(rows[index]);
    if ([candidate.account, candidate.date, candidate.description, candidate.debit, candidate.credit].every(position => position >= 0) &&
        (candidate.type >= 0 || candidate.group >= 0)) {
      headers = candidate;
      headerIndex = index;
      break;
    }
  }
  if (!headers) throw new WaveHistoryError('Use the Wave Account Transactions (General Ledger) CSV with Account Name, Account Type or Group, Date, Description, Debit and Credit columns.');

  const entries = [];
  const accounts = new Map();
  let debit = 0;
  let credit = 0;
  let unclassified = 0;
  for (let index = headerIndex + 1; index < rows.length; index++) {
    const row = rows[index];
    if (!row.some(Boolean)) continue;
    const get = column => row[headers[column]] || '';
    const rawDate = get('date');
    const description = get('description');
    const name = get('account');
    const type = get('type');
    const group = get('group');
    const marker = /^(?:starting balance|ending balance|beginning balance|opening balance|closing balance|total|totals|balance change|net change)$/i;
    if (!rawDate && (marker.test(description) || marker.test(name))) continue;
    const date = parseDate(rawDate);
    const label = 'CSV row ' + (index + 1);
    if (!date || !name || (!type && !group) || row.length !== rows[headerIndex].length) {
      throw new WaveHistoryError(label + ' has an invalid date, account, or column count.');
    }
    if (!date.startsWith(month + '-')) throw new WaveHistoryError(label + ' is outside the selected month ' + month + '.');
    if (get('currency') && get('currency').toUpperCase() !== currency) {
      throw new WaveHistoryError(label + ' has a different currency from the selected Wave report currency.');
    }
    const rowDebit = readWaveMinor(get('debit'), currency, label + ' debit', true);
    const rowCredit = readWaveMinor(get('credit'), currency, label + ' credit', true);
    if (rowDebit && rowCredit) throw new WaveHistoryError(label + ' contains both a debit and a credit.');

    const kind = accountKind(type, group);
    const key = JSON.stringify([kind, name.toLowerCase().replace(/\s+/g, ' ')]);
    entries.push({
      source_row: index + 1, posted_date: date, transaction_ref: get('reference') || null,
      description, account_key: key, account_name: name, account_type: type, account_group: group,
      other_accounts: get('other'), kind, debit_minor: rowDebit, credit_minor: rowCredit,
    });
    const totals = accounts.get(key) || { key, name, type, group, kind, debit: 0, credit: 0, rows: 0 };
    totals.debit += rowDebit;
    totals.credit += rowCredit;
    totals.rows++;
    accounts.set(key, totals);
    debit += rowDebit;
    credit += rowCredit;
    if (kind === 'unclassified') unclassified++;
    if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit)) {
      throw new WaveHistoryError('The monthly ledger total exceeds the supported amount.');
    }
  }
  return { entries, debit, credit, unclassified, accounts: [...accounts.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}

export function comparisonPeriods(year, monthNumber) {
  const inputYear = String(year ?? '');
  const month = Number(monthNumber || 0);
  if (!/^(19\d\d|20\d\d)$/.test(inputYear) || !Number.isInteger(month) || month < 0 || month > 12) {
    throw new WaveHistoryError('Select a valid comparison year and month.');
  }
  function period(periodYear) {
    const months = Array.from({ length: month ? 1 : 12 }, (_, index) => periodYear + '-' + String(month || index + 1).padStart(2, '0'));
    const endsInDecember = month === 0 || month === 12;
    return {
      year: periodYear, months, start: months[0] + '-01',
      end: endsInDecember ? (periodYear + 1) + '-01-01' : periodYear + '-' + String(month + 1).padStart(2, '0') + '-01',
    };
  }
  return { current: period(Number(inputYear)), prior: period(Number(inputYear) - 1) };
}

export function historicCategory(name, kind) {
  if (kind !== 'expense') return name;
  if (/^(?:office |warehouse |building |property )?rent(?: expense| expenses)?$/i.test(name)) return 'Rent';
  if (/^(?:utilities|electricity|water|gas utility|water and sewer)(?: expense| expenses)?$/i.test(name)) return 'Utilities';
  if (/^(?:business |property |general liability |vehicle |health )?insurance(?: expense| expenses| premiums)?$/i.test(name)) return 'Insurance';
  if (/^(?:goods purchases|merchandise purchases|inventory purchases|purchases of goods)$/i.test(name)) return 'Goods purchases';
  return name;
}

export function buildWaveComparison(data, periods) {
  const waveMonths = new Set(data.months);
  const coverage = period => ({ ...period, imported: period.months.filter(month => waveMonths.has(month)) });
  const current = coverage(periods.current);
  const prior = coverage(periods.prior);
  const complete = current.months.length === current.imported.length && prior.months.length === prior.imported.length;
  const grouped = new Map();
  for (const account of data.accounts) {
    const category = account.category || historicCategory(account.account_name, account.kind);
    const key = JSON.stringify([account.kind, category.toLowerCase()]);
    const row = grouped.get(key) || { category, kind: account.kind, current_minor: 0, prior_minor: 0, accounts: [] };
    row.current_minor += Number(account.current_minor);
    row.prior_minor += Number(account.prior_minor);
    if (!Number.isSafeInteger(row.current_minor) || !Number.isSafeInteger(row.prior_minor)) {
      throw new WaveHistoryError('A category total exceeds the supported amount.', 422);
    }
    row.accounts.push(account);
    grouped.set(key, row);
  }
  const rows = [...grouped.values()].map(row => ({
    ...row, change_minor: complete ? row.current_minor - row.prior_minor : null,
    change_percent: complete && row.prior_minor > 0 ? ((row.current_minor - row.prior_minor) / row.prior_minor) * 100 : null,
  })).sort((a, b) => a.kind.localeCompare(b.kind) || a.category.localeCompare(b.category));
  return { current, prior, complete, rows, unclassified: data.unclassified };
}
