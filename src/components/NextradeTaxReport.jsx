'use client';

import React, { Fragment, useEffect, useState } from 'react';
import { NEXTRADE_SOURCE_LABELS, TAX_REPORT_GROUPS } from '../lib/nextrade-tax-report';

var summaryRows = [['income', 'Income'], ['cost_of_goods', 'Cost of goods sold'], ['expenses', 'Expenses'], ['net', 'Net income']];
var amountFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
var input = 'px-2 py-1 rounded border border-slate-300 bg-white text-slate-900 text-[11px] nt-light';
var buttonBase = 'px-2.5 py-1.5 rounded text-[11px] font-bold disabled:opacity-50';
var button = buttonBase + ' bg-slate-100 text-slate-900';
var detailPageSize = 40;

function cents(value) { return amountFormat.format(value / 100); }
function csvText(value) { return /^[\s]*[=+@-]/.test(value) ? "'" + value : value; }
function today() {
  var date = new Date();
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

function transactionRows(part) {
  return part.rows.flatMap(function (row) {
    return (row.transactions || []).map(function (line) { return { ...line, category: row.label, section: TAX_REPORT_GROUPS[row.kind] }; });
  });
}

function TransactionDetail({ transactions, heading }) {
  var [month, setMonth] = useState('');
  var [account, setAccount] = useState('');
  var [limit, setLimit] = useState(detailPageSize);
  var months = Array.from(new Set(transactions.map(function (line) { return line.date.slice(0, 7); }))).sort().reverse();
  var accounts = Array.from(new Set(transactions.map(function (line) { return line.account; }))).sort();
  var shown = transactions.filter(function (line) {
    return (!month || line.date.startsWith(month)) && (!account || line.account === account);
  });
  return <section className="p-3 bg-slate-50 text-slate-900" aria-label={heading}>
    <div className="flex flex-wrap items-end gap-3 mb-2">
      <h5 className="font-bold mr-auto">{heading}</h5>
      {months.length > 1 && <label>Month <select aria-label="Month" className={input} value={month} onChange={function (e) { setMonth(e.target.value); setLimit(detailPageSize); }}>
        <option value="">All months</option>{months.map(function (value) { return <option key={value}>{value}</option>; })}
      </select></label>}
      {accounts.length > 1 && <label>Account <select aria-label="Account" className={input} value={account} onChange={function (e) { setAccount(e.target.value); setLimit(detailPageSize); }}>
        <option value="">All accounts</option>{accounts.map(function (value) { return <option key={value}>{value}</option>; })}
      </select></label>}
    </div>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] text-[11px]" aria-label={heading + ' transactions'}>
        <thead><tr className="border-b border-slate-300">
          {['Posted date', 'Account', 'Description', 'Source', 'Money in', 'Money out'].map(function (text, index) {
            return <th key={text} scope="col" className={'py-1.5 px-2 ' + (index < 4 ? 'text-left' : 'text-right')}>{text}</th>;
          })}
        </tr></thead>
        <tbody>{shown.slice(0, limit).map(function (line) {
          return <tr key={line.id} className="border-b border-slate-200">
            <td className="px-2 py-1.5 whitespace-nowrap">{line.date}</td>
            <td className="px-2 py-1.5">{line.account}</td>
            <td className="px-2 py-1.5">{line.description}</td>
            <td className="px-2 py-1.5">{NEXTRADE_SOURCE_LABELS[line.source] || '—'}{line.source_row && <span className="block text-slate-600" title={line.source_file}>CSV row {line.source_row}</span>}</td>
            <td className="px-2 py-1.5 text-right">{line.direction === 'in' ? cents(line.amount) : '—'}</td>
            <td className="px-2 py-1.5 text-right">{line.direction === 'out' ? cents(line.amount) : '—'}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    <p className="mt-2 text-slate-600">Showing {Math.min(limit, shown.length)} of {shown.length} transactions.</p>
    {shown.length > limit && <button type="button" className={button + ' mt-1'} onClick={function () { setLimit(limit + detailPageSize); }}>Show more</button>}
  </section>;
}

export default function NextradeTaxReport({ api, exportCsv, onReview }) {
  var [to, setTo] = useState(today);
  var [from, setFrom] = useState(function () { return to.slice(0, 4) + '-01-01'; });
  var [result, setResult] = useState(null);
  var [opened, setOpened] = useState(null);
  var [busy, setBusy] = useState(true);
  var [error, setError] = useState('');

  async function load() {
    setBusy(true);
    setError('');
    try {
      var response = await api({ action: 'tax_report', from: from, to: to });
      if (!response || !response.ok || !response.report) {
        throw new Error(response?.error || response?.sql_missing || 'Could not load the tax report.');
      }
      setOpened(null);
      setResult(response);
    } catch (e) {
      setError(e.message || 'Could not load the tax report.');
    } finally {
      setBusy(false);
    }
  }
  useEffect(function () { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  var rerun = result && (result.from !== from || result.to !== to);

  function download(detail) {
    var file = [['Nextrade cash-basis tax report', result.from, result.to]];
    file.push(['Activity shown', result.report.first, result.report.last]);
    file.push(['Reconciliation status', 'Bank statement reconciliation is needed before filing']);
    if (result.accounts_restricted) { file.push(['Limited to accounts available to the viewer']); }
    if (result.payroll_restricted) { file.push(['Excludes restricted payroll']); }
    file.push(detail
      ? ['Currency', 'Posted date', 'Account', 'Description', 'Source', 'Source file', 'Source row', 'Section', 'Category', 'Money in', 'Money out', 'Hub transaction ID']
      : ['Currency', 'Section', 'Category', 'Transactions', 'Money in', 'Money out', 'Net']);
    result.report.currencies.forEach(function (part) {
      if (detail) {
        transactionRows(part).forEach(function (line) {
          file.push([csvText(part.currency), line.date, csvText(line.account), csvText(line.description), NEXTRADE_SOURCE_LABELS[line.source] || '', csvText(line.source_file), csvText(line.source_row), line.section, csvText(line.category), line.direction === 'in' ? line.amount / 100 : '', line.direction === 'out' ? line.amount / 100 : '', line.id]);
        });
        return;
      }
      summaryRows.forEach(function (field) {
        file.push([csvText(part.currency), 'Summary', field[1], '', '', '', part.summary[field[0]] / 100]);
      });
      part.rows.forEach(function (row) {
        file.push([csvText(part.currency), TAX_REPORT_GROUPS[row.kind], csvText(row.label), row.count, row.money_in / 100, row.money_out / 100, (row.money_in - row.money_out) / 100]);
      });
    });
    exportCsv(file, 'nextrade-tax-' + (detail ? 'transactions-' : 'summary-') + result.from + '-to-' + result.to + '.csv');
  }

  return <section aria-label="Nextrade cash-basis tax report">
    <h3 className="mb-1 text-sm font-extrabold">Nextrade cash-basis tax report</h3>
    <p className="mb-2 text-[11px] text-slate-600">Based on posted activity in Nextrade’s own books. Select a category or use All transactions to see the underlying entries.</p>
    <form className="flex flex-wrap items-end gap-2 mb-3" onSubmit={function (event) { event.preventDefault(); load(); }}>
      <label className="text-[11px] font-bold">From <input required type="date" className={input} value={from} onChange={function (event) { setFrom(event.target.value); }} /></label>
      <label className="text-[11px] font-bold">To <input required type="date" className={input} value={to} onChange={function (event) { setTo(event.target.value); }} /></label>
      <button className={buttonBase + ' bg-blue-900 text-white'} disabled={busy || !from || !to || from > to}>{busy ? 'Loading…' : 'Run report'}</button>
      {result && result.report.currencies.length > 0 && <>
        <button type="button" className={button} disabled={busy || rerun || !!error} onClick={function () { download(false); }}>Export summary CSV</button>
        {result.report.details_available && <button type="button" className={button} disabled={busy || rerun || !!error} onClick={function () { download(true); }}>Export transactions CSV</button>}
      </>}
    </form>
    {error && <p role="alert" className="text-[11px] text-red-800">{error}{result ? ' Showing the last successful report.' : ''}</p>}
    {rerun && <p className="mb-2 text-[11px] text-slate-600">Run the report to apply the new dates.</p>}
    {result && <div>
      <div className="border border-amber-300 bg-amber-50 rounded px-3 py-2 mb-3 text-[11px] text-amber-950">
        <p className="font-semibold">Reconcile the report to statements before filing.</p>
        <p>Activity dates show the entries recorded in the Hub. Uncategorized activity and transfers are listed below the income and expenses.</p>
        {result.accounts_restricted && <p>This report covers the Nextrade accounts you can view.</p>}
        {result.payroll_restricted && <p>The report excludes restricted payroll.</p>}
      </div>
      {result.report.first
        ? <p className="mb-2 text-[11px] text-slate-600">Period {result.from} through {result.to}. {result.report.count} posted transactions from {result.report.first} through {result.report.last}.</p>
        : <p className="text-[11px] text-slate-600">No posted Nextrade activity in this period.</p>}
      {!result.report.details_available && <p className="mb-2 text-[11px] text-slate-600">Run a shorter period to view and export the underlying transactions.</p>}
      {result.report.accounts?.length > 0 && <details className="mb-3 border border-slate-200 rounded px-3 py-2 text-[11px]">
        <summary className="cursor-pointer font-bold">Account activity</summary>
        <div className="overflow-x-auto"><table className="mt-2 w-full text-left" aria-label="Account activity">
          <thead><tr>{['Account', 'Currency', 'First posted', 'Last posted', 'Transactions', 'Wave import'].map(function (label) { return <th key={label} scope="col" className="p-1">{label}</th>; })}</tr></thead>
          <tbody>{result.report.accounts.map(function (account, index) { return <tr key={index} className="border-t border-slate-200">
            <th scope="row" className="p-1 font-medium">{account.account}</th><td className="p-1">{account.currency}</td><td className="p-1">{account.first}</td>
            <td className="p-1">{account.last}</td><td className="p-1">{account.count}</td><td className="p-1">{account.wave_count || '—'}</td>
          </tr>; })}</tbody>
        </table></div>
      </details>}
      {result.report.currencies.map(function (part) {
        var allKey = JSON.stringify([part.currency, null]);
        return <div key={part.currency} className="mb-4">
          <h4 className="mb-1 text-[12px] font-bold">{part.currency}</h4>
          <dl className="flex flex-wrap gap-3 py-2 mb-1 text-[11px]">
            {summaryRows.map(function (field) {
              return <div key={field[0]} className="px-3 py-1 rounded bg-slate-100"><dt>{field[1]}</dt><dd className="font-extrabold text-[13px]">{cents(part.summary[field[0]])}</dd></div>;
            })}
          </dl>
          <div className="flex flex-wrap items-center gap-2 mb-2 text-[11px]">
            {part.summary.review_count > 0 && <p className="font-bold text-amber-900">{part.summary.review_count} transactions need categorization before they can enter the summary.</p>}
            {part.summary.review_count > 0 && onReview && <button type="button" className={button} disabled={busy || rerun || !!error} onClick={function () { onReview(result.from, result.to); }}>Review uncategorized</button>}
            {result.report.details_available && <button type="button" className={button} aria-expanded={opened === allKey} onClick={function () { setOpened(opened === allKey ? null : allKey); }}>All transactions</button>}
          </div>
          {opened === allKey && <TransactionDetail key={allKey} heading={part.currency + ' · All transactions'} transactions={transactionRows(part).sort(function (a, b) { return b.date.localeCompare(a.date) || a.id.localeCompare(b.id); })} />}
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]" aria-label={part.currency + ' report categories'}>
              <thead className="bg-slate-200 text-slate-800"><tr>
                {['Category', 'Section', 'Transactions', 'Money in', 'Money out', 'Net'].map(function (label, index) {
                  return <th key={label} scope="col" className={'p-1 ' + (index < 2 ? 'text-left' : 'text-right')}>{label}</th>;
                })}
              </tr></thead>
              <tbody>{part.rows.map(function (row) {
                var key = JSON.stringify([part.currency, row.key]);
                return <Fragment key={key}>
                  <tr className="border-t border-slate-200">
                    <th scope="row" className="p-1 text-left font-semibold">{row.transactions
                      ? <button type="button" aria-expanded={opened === key} className="text-left text-blue-900 underline underline-offset-2" onClick={function () { setOpened(opened === key ? null : key); }}>{row.label}</button>
                      : row.label}</th>
                    <td className="p-1">{TAX_REPORT_GROUPS[row.kind]}</td>
                    <td className="p-1 text-right">{row.count}</td>
                    <td className="p-1 text-right">{cents(row.money_in)}</td>
                    <td className="p-1 text-right">{cents(row.money_out)}</td>
                    <td className="p-1 text-right font-bold">{cents(row.money_in - row.money_out)}</td>
                  </tr>
                  {opened === key && <tr><td colSpan={6}><TransactionDetail heading={row.label} transactions={row.transactions} /></td></tr>}
                </Fragment>;
              })}</tbody>
            </table>
          </div>
        </div>;
      })}
    </div>}
  </section>;
}
