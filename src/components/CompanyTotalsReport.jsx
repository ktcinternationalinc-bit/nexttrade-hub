'use client';

import React, { useEffect, useRef, useState } from 'react';
import { endOfMonth } from '../lib/companies';
import { TransactionDetail } from './NextradeTaxReport';

const amountFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const drillButton = 'px-1.5 py-1 rounded underline underline-offset-2 decoration-dotted hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 whitespace-nowrap';
const smallButton = 'px-2 py-1 rounded border border-slate-300 font-bold text-[11px]';

export function totalsPeriod(report, period) {
  if (!period) { return { from: report.from, to: report.to }; }
  const isYear = period.length === 4;
  const start = period + (isYear ? '-01-01' : '-01');
  const end = isYear ? period + '-12-31' : endOfMonth(start);
  return { from: start > report.from ? start : report.from, to: end < report.to ? end : report.to };
}

export function periodAmount(row, months) {
  const values = months.map(month => row.byMonth[month]).filter(value => value !== undefined);
  if (values.length) { return values.reduce((cents, value) => cents + Math.round(value * 100), 0) / 100; }
}

export function totalsTransactions(lines, categories, selection) {
  const labels = new Map(categories.map(category => [category.key, category.label]));
  return lines.filter(line => line.date && line.date >= selection.from && line.date <= selection.to &&
    line.pending !== true && !line.payroll_restricted &&
    (selection.category === null || (line.company_category || '__none') === selection.category)).map(line => ({
    id: line.id,
    date: line.date,
    account: line.account_label,
    description: line.name || line.merchant_name || 'Transaction',
    source: line.source,
    company_category: line.company_category,
    category_label: (line.company_category && (labels.get(line.company_category) || line.company_category)) || 'Uncategorized',
    direction: line.direction,
    amount: Math.round((Number(line.amount_abs) || 0) * 100),
    paired_transfer: !!line.transfer_group_id,
  }));
}

export default function CompanyTotalsReport({ totals, api, categoriesFor, categoryBusy, onCategoryChange, refreshTotals }) {
  const [groupBy, setGroupBy] = useState('month');
  const [selection, setSelection] = useState(null);
  const [details, setDetails] = useState(null);
  const detailHeading = useRef(null);
  const opener = useRef(null);
  const range = totals.from + '/' + totals.to;
  const opened = !totals.capped && selection?.range === range ? selection : null;
  const current = details?.report === totals && details?.selection === opened ? details : null;
  const periods = new Map();
  totals.months.forEach(month => {
    const period = groupBy === 'year' ? month.slice(0, 4) : month;
    if (!periods.has(period)) { periods.set(period, []); }
    periods.get(period).push(month);
  });

  useEffect(() => {
    if (!opened) { return; }
    let active = true;
    api({ action: 'lines', from: opened.from, to: opened.to }).then(result => {
      if (!active) { return; }
      if (!result?.ok || result.sql_missing) {
        setDetails({ report: totals, selection: opened, error: result?.error || result?.sql_missing || 'Could not load the transactions.' });
        return;
      }
      if (result.capped) {
        setDetails({ report: totals, selection: opened, error: 'Choose a shorter date range to see a complete list of transactions.' });
        return;
      }
      const categories = result.categories || [];
      setDetails({ report: totals, selection: opened, categories, transactions: totalsTransactions(result.lines || [], categories, opened) });
    }).catch(() => {
      if (active) { setDetails({ report: totals, selection: opened, error: 'Could not load the transactions.' }); }
    });
    return () => { active = false; };
  }, [api, opened, totals]);

  useEffect(() => { if (opened) { detailHeading.current?.focus(); } }, [opened]);

  function drill(period, row, value, label) {
    const negative = value < 0;
    if (totals.capped) { return <span style={{ color: negative ? '#991b1b' : undefined }}>{label}</span>; }
    const category = row ? row.key : null;
    const heading = (row ? row.label : 'All categories') + ' · ' + (period || 'Total');
    return <button type="button" className={drillButton} style={{ color: negative ? '#991b1b' : '#1e40af' }}
      aria-label={'View transactions for ' + heading + (value === undefined ? '' : ', ' + label)}
      aria-expanded={opened?.category === category && opened?.period === period}
      onClick={event => {
        opener.current = event.currentTarget;
        setSelection({ category, period, range, heading, ...totalsPeriod(totals, period) });
      }}>{label}</button>;
  }

  return <div className="text-[12px]">
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2">
      <div role="group" aria-label="Group totals by" className="flex gap-1">
        {['month', 'year'].map(group => <button type="button" key={group} aria-pressed={groupBy === group}
          className={smallButton} style={{ background: groupBy === group ? '#1e3a8a' : '#ffffff', color: groupBy === group ? '#ffffff' : '#334155' }}
          onClick={() => setGroupBy(group)}>{group === 'month' ? 'By month' : 'By year'}</button>)}
      </div>
      <span style={{ color: '#475569' }}>{totals.from} to {totals.to}</span>
      <span style={{ color: '#475569' }}>Select a period or amount to open its transactions.</span>
    </div>
    {totals.capped && <p role="status" className="mb-2 font-bold" style={{ color: '#92400e' }}>This range contains more transactions than the report can show. Choose a shorter range to open the transactions.</p>}
    {opened && <section className="nt-paper mb-3 rounded" aria-label="Transactions behind the total" aria-busy={!current}>
      <div className="flex items-center justify-between gap-2 p-2" style={{ background: '#eaf1ff', color: '#0f172a' }}>
        <h4 ref={detailHeading} tabIndex={-1} className="font-bold">{opened.heading} <span className="font-normal">({opened.from} to {opened.to})</span></h4>
        <button type="button" className={smallButton} onClick={() => { setSelection(null); opener.current?.focus(); }}>Close transactions</button>
      </div>
      {!current && <p role="status" className="p-3">Loading transactions…</p>}
      {current?.error && <p role="alert" className="p-3" style={{ color: '#991b1b' }}>{current.error}{' '}
        <button type="button" className={smallButton} onClick={() => setSelection({ ...opened })}>Retry</button></p>}
      {current?.transactions && (current.transactions.length
        ? <TransactionDetail heading="Transactions" transactions={current.transactions} dateLabel="Transaction date" signedOut
            categoriesFor={line => categoriesFor(line, current.categories)} categoryBusy={categoryBusy}
            onCategoryChange={onCategoryChange && ((line, category) => onCategoryChange([line.id], category, () => refreshTotals(totals.from, totals.to)))} />
        : <p role="status" className="p-3">No transactions in this selection.</p>)}
    </section>}
    <div className="overflow-x-auto">
      <table className="w-full min-w-max" aria-label="Company totals by category">
        <thead style={{ background: '#e2e8f0', color: '#334155' }}><tr>
          <th scope="col" className="text-left py-1.5 px-3">Category</th>
          {Array.from(periods.keys(), period => <th key={period} scope="col" className="text-right py-1.5 px-2">{drill(period, null, undefined, period)}</th>)}
          <th scope="col" className="text-right py-1.5 px-2">{drill(null, null, undefined, 'Total')}</th>
        </tr></thead>
        <tbody>{totals.rows.map(row => <tr key={row.key} className="border-b border-slate-100" style={{ color: row.kind === 'transfer' ? '#64748b' : undefined }}>
          <th scope="row" className="font-normal text-left px-3 py-1.5">{row.label}{row.kind === 'transfer' ? ' ↔' : ''}</th>
          {Array.from(periods, ([period, months]) => {
            const value = periodAmount(row, months);
            return <td key={period} className="text-right px-2 py-1 tabular-nums">{value !== undefined && !row.payroll_restricted ? drill(period, row, value, amountFormat.format(value)) : null}</td>;
          })}
          <td className="text-right px-2 py-1 font-bold tabular-nums">{row.payroll_restricted ? 'Restricted' : drill(null, row, row.total, amountFormat.format(row.total))}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}
