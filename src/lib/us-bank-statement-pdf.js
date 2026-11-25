// Reads text-based US statements with labelled posting-date, credit, debit and
// balance columns. Every transaction must reconcile before it can be reviewed
// for import. The original PDF and the full account number stay in the browser.
import { parseStatementFigure, statementLines } from './pdf-statement';

function column(items, pattern) {
  return items.find(item => pattern.test(item.s));
}

function statementColumns(items) {
  const date = column(items, /^(?:posting|transaction) date$|^date$/i);
  const description = column(items, /^(?:transaction )?description$/i);
  const credit = column(items, /^(?:other )?credits?(?: \(\+\))?$|^deposits?(?: \(\+\))?$/i);
  const debit = column(items, /^(?:other )?debits?(?: \(-\))?$|^withdrawals?(?: \(-\))?$/i);
  const balance = column(items, /^(?:(?:running|daily) )?balance$/i);
  if (!date || !description || !credit || !debit || !balance) return null;
  if (date.x >= description.x || description.x >= Math.min(credit.x, debit.x) || Math.max(credit.x, debit.x) >= balance.x) return null;
  return { date, description, credit, debit, balance };
}

function postingDate(s) {
  const match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  let iso = s;
  if (match) {
    const year = match[3].length === 2 ? '20' + match[3] : match[3];
    iso = year + '-' + match[1].padStart(2, '0') + '-' + match[2].padStart(2, '0');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const value = new Date(iso + 'T00:00:00Z');
  return Number.isFinite(value.getTime()) && value.toISOString().slice(0, 10) === iso ? iso : null;
}

function accountLastFour(text) {
  const match = text.match(/\b(?:(?:checking|savings|money market)(?: account)?|account (?:number|no\.?))\s*:?\s*[*x#• -]*(\d[\d -]{3,})$/i);
  return match ? match[1].replace(/\D/g, '').slice(-4) : '';
}

function figure(item) {
  const parsed = parseStatementFigure(item.s.replace('$', ''));
  return parsed && !parsed.mixed && Number.isSafeInteger(parsed.mag) ? parsed : null;
}

function signedBalance(parsed) {
  return parsed.mark === 'DR' || parsed.mark === 'NEG' ? -parsed.mag : parsed.mag;
}

function amountCells(items, columns) {
  const amounts = {};
  for (const item of items) {
    // Values are right-aligned with the column labels on this statement layout.
    const key = ['credit', 'debit', 'balance'].find(name => Math.abs(item.r - columns[name].r) <= 16);
    const parsed = figure(item);
    if (!key || !parsed || amounts[key]) return null;
    amounts[key] = parsed;
  }
  return amounts;
}

export function readUsStatementText(pages) {
  const fail = error => ({ rows: [], error });
  const lines = statementLines(pages);
  if (!lines.length) return fail('This PDF has no readable text. Download a text-based PDF or CSV from the bank.');
  let accountMask = '';
  let columns = null;
  let opening = null;
  let running = null;
  let closing = null;
  let checkedBalances = 0;
  let previousLine = null;
  const rows = [];

  for (const line of lines) {
    const items = line.items;
    const first = items[0];
    const text = items.map(item => item.s).join(' ');
    if (!columns) accountMask = accountLastFour(text) || accountMask;
    const header = statementColumns(items);
    if (header) {
      if (closing !== null) return fail('This PDF contains more than one account activity table. Select a statement for one account.');
      columns = header;
      previousLine = null;
      continue;
    }
    if (!columns || closing !== null) continue;

    const amountEdge = Math.min(columns.credit.x, columns.debit.x) - 18;
    const descriptionItems = items.filter(item => item.x < amountEdge);
    const amountItems = items.filter(item => item.x >= amountEdge);
    const startText = descriptionItems.map(item => item.s).join(' ');
    const openingLine = /(?:^|\s)(?:beginning|opening) balance:?\s*$/i.test(startText);
    const closingLine = /(?:^|\s)(?:ending|closing) balance:?\s*$/i.test(startText);
    if (openingLine || closingLine) {
      const amounts = amountCells(amountItems, columns);
      if (!amounts || !amounts.balance || amounts.credit || amounts.debit) return fail('A printed opening or closing balance could not be read.');
      const balance = signedBalance(amounts.balance);
      if (openingLine) {
        if (opening !== null) return fail('This PDF contains more than one opening balance. Select a statement for one account.');
        opening = running = balance;
      } else {
        closing = balance;
        if (running === null || closing !== running) return fail('The extracted transactions do not match the printed closing balance.');
      }
      previousLine = null;
      continue;
    }

    const inDateColumn = Math.abs(first.x - columns.date.x) <= 10;
    if (inDateColumn && /^\d{1,4}[/-]\d{1,2}/.test(first.s)) {
      const date = postingDate(first.s);
      const amounts = amountCells(amountItems, columns);
      const name = descriptionItems.slice(1).map(item => item.s).join(' ').trim();
      const credit = amounts && amounts.credit;
      const debit = amounts && amounts.debit;
      const moneyIn = credit ? credit.mag : 0;
      const moneyOut = debit ? debit.mag : 0;
      if (!date || !amounts || !name || running === null || Boolean(moneyIn) === Boolean(moneyOut) ||
          (credit && credit.mark && credit.mark !== 'CR') || (debit && debit.mark === 'CR')) {
        return fail('An activity row on page ' + line.page + ' has an unreadable date, description or amount.');
      }
      running += moneyIn - moneyOut;
      if (!Number.isSafeInteger(running)) return fail('A balance is outside the supported amount range.');
      if (amounts.balance) {
        if (running !== signedBalance(amounts.balance)) return fail('The extracted transactions do not match the printed balance on ' + date + '.');
        checkedBalances++;
      }
      rows.push({ date, name, direction: moneyIn ? 'in' : 'out', amount_abs: (moneyIn || moneyOut) / 100 });
      previousLine = line;
    } else if (previousLine && previousLine.page === line.page && previousLine.y - line.y <= 24 &&
               Math.abs(first.x - columns.description.x) <= 10 && !amountItems.length) {
      const row = rows[rows.length - 1];
      row.name += ' ' + text;
      previousLine = line;
    } else {
      if (running !== null && amountItems.some(item => figure(item))) {
        return fail('An amount on page ' + line.page + ' could not be matched to a dated transaction.');
      }
      previousLine = null;
    }
  }

  if (!columns) return fail('This PDF layout is unsupported. Use a statement with labelled date, description, credit, debit and balance columns, or import the bank’s CSV.');
  if (!rows.length) return fail('No transactions were found in this PDF.');
  if (closing === null) return fail('The closing balance could not be found. Select the complete statement PDF.');
  return { rows, accountMask, checkedBalances, pages: pages.length };
}
