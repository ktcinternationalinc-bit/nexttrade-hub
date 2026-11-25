// Reads text-based US statements with labelled posting-date, credit, debit and
// balance columns. Every transaction must reconcile before it can be reviewed
// for import. The original PDF and the full account number stay in the browser.
import { parseStatementFigure, statementLines } from './pdf-statement';

function column(items, pattern) {
  return items.find(item => pattern.test(item.s));
}

function statementColumns(lines, index) {
  const line = lines[index];
  const description = column(line.items, /^(?:transaction )?description$/i);
  if (!description) return null;
  const items = lines.slice(Math.max(0, index - 2), index + 3)
    .filter(other => other.page === line.page && Math.abs(other.y - line.y) <= 10)
    .flatMap(other => other.items);
  const posting = column(items, /^(?:posting|transaction)$/i);
  const plainDate = column(items, /^date$/i);
  const date = column(items, /^(?:posting|transaction) date$/i) ||
    (posting && plainDate && Math.abs(posting.x - plainDate.x) <= 12 ? posting : plainDate);
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

function summaryBalance(items, label) {
  const heading = column(items, label);
  if (!heading) return null;
  const figures = items.filter(item => item.x >= heading.r).map(figure).filter(Boolean);
  return figures.length === 1 ? signedBalance(figures[0]) : null;
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
  let summaryOpening = null;
  let summaryClosing = null;
  let summaryPage = null;
  let checkedBalances = 0;
  let previousLine = null;
  let descriptionX = null;
  const rows = [];

  for (const [index, line] of lines.entries()) {
    const items = line.items;
    const first = items[0];
    const text = items.map(item => item.s).join(' ');
    if (!columns) {
      if (summaryPage !== line.page) {
        summaryPage = line.page;
        summaryOpening = summaryClosing = null;
        accountMask = '';
      }
      accountMask = accountLastFour(text) || accountMask;
      const accountLabel = column(items, /^account (?:number|no\.?)\s*:?$/i);
      const next = lines[index + 1];
      if (accountLabel && next && next.page === line.page && line.y - next.y <= 22) {
        const number = next.items.find(item => item.x >= accountLabel.x - 8 && item.x < accountLabel.r &&
          /^[*x#• -]*\d[\d -]{3,}$/i.test(item.s));
        if (number) accountMask = number.s.replace(/\D/g, '').slice(-4);
      }
      summaryOpening = summaryBalance(items, /^(?:beginning|opening) balance:?$/i) ?? summaryOpening;
      summaryClosing = summaryBalance(items, /^(?:ending|closing) balance:?$/i) ?? summaryClosing;
    }
    const header = statementColumns(lines, index);
    if (header) {
      if (closing !== null) return fail('This PDF contains more than one account activity table. Select a statement for one account.');
      columns = header;
      previousLine = null;
      continue;
    }
    if (!columns || closing !== null) continue;
    if (/^number of deposits\s*\/\s*checks paid\b/i.test(text)) {
      if (summaryClosing !== null) {
        if (running !== summaryClosing) return fail('The extracted transactions do not match the printed closing balance.');
        closing = summaryClosing;
      }
      previousLine = null;
      continue;
    }

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
        if (summaryOpening !== null && balance !== summaryOpening) return fail('The printed opening balances disagree.');
        opening = running = balance;
      } else {
        closing = balance;
        if (running === null || closing !== running || (summaryClosing !== null && closing !== summaryClosing)) {
          return fail('The extracted transactions do not match the printed closing balance.');
        }
      }
      previousLine = null;
      continue;
    }

    const inDateColumn = Math.abs(first.x - columns.date.x) <= 10;
    let rowBalance = null;
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
      rows.push({ date, name, direction: moneyIn ? 'in' : 'out', amount_abs: (moneyIn || moneyOut) / 100 });
      rowBalance = amounts.balance;
      descriptionX = descriptionItems[1].x;
      previousLine = line;
    } else if (previousLine && previousLine.page === line.page && previousLine.y - line.y <= 24 &&
               (!descriptionItems.length || Math.abs(first.x - descriptionX) <= 10)) {
      const row = rows[rows.length - 1];
      const amounts = amountCells(amountItems, columns);
      if (!amounts || amounts.credit || amounts.debit) {
        return fail('An amount on page ' + line.page + ' could not be matched to a dated transaction.');
      }
      if (descriptionItems.length) row.name += ' ' + startText;
      rowBalance = amounts.balance;
      previousLine = line;
    } else {
      if (running !== null && amountItems.some(item => figure(item))) {
        return fail('An amount on page ' + line.page + ' could not be matched to a dated transaction.');
      }
      previousLine = null;
    }
    if (rowBalance) {
      if (running !== signedBalance(rowBalance)) {
        return fail('The extracted transactions do not match the printed balance on ' + rows[rows.length - 1].date + '.');
      }
      checkedBalances++;
    }
  }

  if (!columns) return fail('This PDF layout is unsupported. Use a statement with labelled date, description, credit, debit and balance columns, or import the bank’s CSV.');
  if (!rows.length) return fail('No transactions were found in this PDF.');
  if (closing === null && summaryClosing === null) return fail('The closing balance could not be found. Select the complete statement PDF.');
  if (closing === null && running !== summaryClosing) return fail('The extracted transactions do not match the printed closing balance.');
  return { rows, accountMask, checkedBalances, pages: pages.length };
}
