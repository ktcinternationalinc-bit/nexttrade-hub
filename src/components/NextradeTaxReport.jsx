'use client';

import React, { useEffect, useState } from 'react';
import { TAX_REPORT_GROUPS } from '../lib/nextrade-tax-report';

var summaryRows = [['income', 'Income'], ['cost_of_goods', 'Cost of goods sold'], ['expenses', 'Expenses'], ['net', 'Net income']];
var amountFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
var input = 'px-2 py-1 rounded border text-[11px] nt-light';
var button = 'px-2 py-1 rounded text-[11px] font-bold';

function cents(value) { return amountFormat.format(value / 100); }
function csvText(value) { return /^[\s]*[=+@-]/.test(value) ? "'" + value : value; }
function today() {
  var date = new Date();
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

export default function NextradeTaxReport({ api, exportCsv }) {
  var [to, setTo] = useState(today);
  var [from, setFrom] = useState(function () { return to.slice(0, 4) + '-01-01'; });
  var [result, setResult] = useState(null);
  var [busy, setBusy] = useState(true);
  var [error, setError] = useState('');

  async function load() {
    setBusy(true);
    setError('');
    try {
      var response = await api({ action: 'tax_report', from: from, to: to });
      if (!response.ok || !response.report) {
        setResult(null);
        setError(response.error || response.sql_missing || 'Could not load the tax report.');
        return;
      }
      setResult(response);
    } finally {
      setBusy(false);
    }
  }
  useEffect(function () { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function download() {
    var file = [['Nextrade cash-basis tax report', result.from, result.to]];
    file.push(['Activity shown', result.report.first, result.report.last]);
    if (result.accounts_restricted) { file.push(['Limited to accounts available to the viewer']); }
    if (result.payroll_restricted) { file.push(['Payroll visibility is restricted']); }
    file.push(['Currency', 'Section', 'Category', 'Transactions', 'Money in', 'Money out', 'Net']);
    result.report.currencies.forEach(function (part) {
      summaryRows.forEach(function (field) {
        file.push([csvText(part.currency), 'Summary', field[1], '', '', '', part.summary[field[0]] / 100]);
      });
      if (part.summary.review_count) {
        file.push([csvText(part.currency), 'Review', 'Transactions outside the summary pending categorization', part.summary.review_count]);
      }
      part.rows.forEach(function (row) {
        file.push([csvText(part.currency), TAX_REPORT_GROUPS[row.kind], csvText(row.label), row.count, row.money_in / 100, row.money_out / 100, (row.money_in - row.money_out) / 100]);
      });
    });
    exportCsv(file, 'nextrade-tax-report-' + result.from + '-to-' + result.to + '.csv');
  }

  return <section aria-label="Nextrade cash-basis tax report">
    <h3 className="mb-1 text-sm font-extrabold">Nextrade cash-basis tax report</h3>
    <p className="mb-2 text-[11px]" style={{ color: '#475569' }}>Based on posted activity in Nextrade’s own books. The summary uses classified income and expenses. Review the other activity below before sending the report to your accountant.</p>
    <form className="flex flex-wrap items-end gap-2 mb-3" onSubmit={function (event) { event.preventDefault(); load(); }}>
      <label className="text-[11px] font-bold">From <input required type="date" className={input} style={{ background: '#fff', color: '#0f172a' }} value={from} onChange={function (event) { setFrom(event.target.value); }} /></label>
      <label className="text-[11px] font-bold">To <input required type="date" className={input} style={{ background: '#fff', color: '#0f172a' }} value={to} onChange={function (event) { setTo(event.target.value); }} /></label>
      <button className={button} style={{ background: '#1e3a8a', color: '#fff' }} disabled={busy || !from || !to || from > to}>{busy ? 'Loading…' : 'Run report'}</button>
      {result && result.report.currencies.length > 0 && <button type="button" className={button} style={{ background: '#f0fdf4', color: '#166534' }} disabled={busy} onClick={download}>Export CSV</button>}
    </form>
    {error && <p role="alert" className="text-[11px]" style={{ color: '#991b1b' }}>{error}</p>}
    {result && <div>
      {result.accounts_restricted && <p className="mb-1 text-[11px]" style={{ color: '#92400e' }}>This report covers the Nextrade accounts you can view.</p>}
      {result.payroll_restricted && <p className="mb-1 text-[11px]" style={{ color: '#92400e' }}>Payroll visibility is restricted for this report.</p>}
      {result.report.first
        ? <p className="mb-2 text-[11px]" style={{ color: '#475569' }}>Period {result.from} through {result.to}. Activity shown from {result.report.first} through {result.report.last}.</p>
        : <p className="text-[11px]" style={{ color: '#475569' }}>No posted Nextrade activity in this period.</p>}
      {result.report.currencies.map(function (part) {
        return <div key={part.currency} className="mb-4">
          <h4 className="mb-1 text-[12px] font-bold">{part.currency}</h4>
          <dl className="flex flex-wrap gap-3 py-2 mb-1 text-[11px]">
            {summaryRows.map(function (field) {
              return <div key={field[0]} className="px-3 py-1 rounded" style={{ background: '#f1f5f9' }}>
                <dt>{field[1]}</dt><dd className="font-extrabold text-[13px]">{cents(part.summary[field[0]])}</dd>
              </div>;
            })}
          </dl>
          {part.summary.review_count > 0 && <p className="mb-2 text-[11px] font-bold" style={{ color: '#92400e' }}>{part.summary.review_count} transaction(s) need categorization before they can enter the summary.</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]" aria-label={part.currency + ' report categories'}>
              <thead style={{ background: '#e2e8f0', color: '#1e293b' }}><tr>
                <th scope="col" className="p-1 text-left">Category</th>
                <th scope="col" className="p-1 text-left">Section</th>
                <th scope="col" className="p-1 text-right">Transactions</th>
                <th scope="col" className="p-1 text-right">Money in</th>
                <th scope="col" className="p-1 text-right">Money out</th>
                <th scope="col" className="p-1 text-right">Net</th>
              </tr></thead>
              <tbody>{part.rows.map(function (row) {
                return <tr key={row.key} style={{ borderTop: '1px solid #e2e8f0' }}>
                  <th scope="row" className="p-1 text-left font-semibold">{row.label}</th>
                  <td className="p-1">{TAX_REPORT_GROUPS[row.kind]}</td>
                  <td className="p-1 text-right">{row.count}</td>
                  <td className="p-1 text-right">{cents(row.money_in)}</td>
                  <td className="p-1 text-right">{cents(row.money_out)}</td>
                  <td className="p-1 text-right font-bold">{cents(row.money_in - row.money_out)}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        </div>;
      })}
    </div>}
  </section>;
}
