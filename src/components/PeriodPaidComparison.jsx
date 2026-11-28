import React from 'react';

const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const money = cents => dollars.format(cents / 100);
const link = 'text-blue-800 underline underline-offset-2 font-semibold text-left';

function RecordList({ rows, visible, onOpenInvoice, onOpenBill, empty }) {
  if (!visible) return <p className="py-2 text-slate-600">Your access includes the totals. Source records require transaction detail access.</p>;
  if (!rows.length) return <p className="py-2 text-slate-600">{empty || 'No records for this period.'}</p>;
  return <div className="max-h-72 overflow-auto rounded border border-slate-200">
    <table className="w-full text-left">
      <thead className="sticky top-0 bg-slate-100 text-slate-700"><tr><th scope="col" className="px-2 py-1">Date</th><th scope="col" className="px-2 py-1">Source record</th><th scope="col" className="px-2 py-1 text-right">Amount</th></tr></thead>
      <tbody>{rows.map((row, index) => <tr key={row.id + '|' + index} className="border-t border-slate-100 align-top">
        <td className="whitespace-nowrap px-2 py-1.5">{row.date || '—'}</td>
        <td className="px-2 py-1.5">
          {row.invoice_id && onOpenInvoice ? <button type="button" className={link} onClick={() => onOpenInvoice(row.invoice_id)}>{row.ref ? 'Invoice ' + row.ref : 'Open matched invoice'}</button> : null}
          {row.bill_id && onOpenBill ? <button type="button" className={link} onClick={() => onOpenBill(row)}>{'Bill ' + (row.ref || row.who)}</button> : null}
          <div>{row.who || row.label}</div>
          {row.source && <div className="text-slate-600">{row.source}</div>}
          {row.bank_ref && <div className="text-slate-600">{row.bank_ref}</div>}
        </td>
        <td className="whitespace-nowrap px-2 py-1.5 text-right font-semibold tabular-nums">{money(row.cents)}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

function Records({ title, group, visible, onOpenInvoice, onOpenBill, children }) {
  return <details className="rounded border border-slate-200 bg-white px-2 py-1.5">
    <summary className="cursor-pointer font-semibold text-blue-900"><span className="inline-flex w-[calc(100%-1rem)] justify-between gap-2 align-top"><span>{title}</span><span className="tabular-nums">{money(group.cents)}</span></span></summary>
    <div className="mt-1.5">{children}<RecordList rows={group.rows} visible={visible} onOpenInvoice={onOpenInvoice} onOpenBill={onOpenBill} /></div>
  </details>;
}

export default function PeriodPaidComparison({ period, periods, onPeriod, comparison, status, invoiceRows, onOpenInvoice, onOpenBill, onFixCosts, canSeeSources = true }) {
  const available = !!(comparison && !comparison.unavailable);
  const visible = available && comparison.rows_visible && canSeeSources;
  const invoices = { cents: period.goods_revenue, rows: invoiceRows };
  const goodsMissing = period.excl.goods_lines;
  const paidGroups = new Map();
  if (visible) comparison.paid.rows.forEach(row => {
    const key = row.category || '';
    if (!paidGroups.has(key)) paidGroups.set(key, { label: row.label, cents: 0, rows: [] });
    const group = paidGroups.get(key);
    group.rows.push(row);
    group.cents += row.cents;
  });

  function panel(title, total, detail, showBalance = true) {
    const balance = available && showBalance ? total - comparison.paid.cents : null;
    return <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
      <h3 className="text-sm font-bold text-slate-900">{title}</h3>
      <div className={'my-1 text-2xl font-bold tabular-nums ' + (balance === null ? 'text-slate-500' : balance < 0 ? 'text-red-800' : 'text-emerald-800')}>{balance === null ? '—' : money(balance)}</div>
      <div className="mt-2">{detail}</div>
      {available && <div className="mt-1.5 flex justify-between gap-2 px-2 text-slate-700"><span>Bills and expenses paid</span><b className="tabular-nums">− {money(comparison.paid.cents)}</b></div>}
    </div>;
  }

  return <section aria-label="Sales and payments comparison" className="mb-3 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 text-xs text-slate-900">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-base font-bold">Sales and payments</h2>
      <label className="flex items-center gap-2 font-semibold">Period <select value={period.key} onChange={event => onPeriod(event.target.value)} className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-900">{periods.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}</select></label>
    </div>
    <p className="mb-2 text-slate-700">Both views subtract the same recorded payments. The shipment margins below follow invoice dates.</p>
    <div className="grid gap-2 sm:grid-cols-2">
      {panel('Goods invoiced less payments', period.goods_revenue, <Records title="Goods invoiced" group={invoices} visible={canSeeSources} onOpenInvoice={onOpenInvoice} />, !period.miss.goods_revenue)}
      {panel('Customer receipts less payments', available ? comparison.receipts.cents : 0, available ? <Records title="Customer receipts from the bank" group={comparison.receipts} visible={visible} onOpenInvoice={onOpenInvoice} /> : null)}
    </div>
    {!available && <p role="status" className="mt-2 text-slate-700">{comparison?.unavailable || status || 'Loading payments…'}</p>}
    {available && comparison.notice && <p role="status" className="mt-2 text-amber-900">{comparison.notice}</p>}
    {available && <div className="mt-2 space-y-1.5">
      <details className="rounded border border-slate-200 bg-white px-2 py-1.5">
        <summary className="cursor-pointer font-semibold text-blue-900">Bills and expenses paid in both views <span className="float-right tabular-nums">{money(comparison.paid.cents)}</span></summary>
        <div className="my-1.5 space-y-1.5">{!visible && <p className="text-slate-600">Your access includes the totals. Source records require transaction detail access.</p>}{visible && !paidGroups.size && <p className="text-slate-600">No recorded payments in this period.</p>}{Array.from(paidGroups.values()).sort((a, b) => b.cents - a.cents).map(group => <Records key={group.label} title={group.label} group={group} visible={visible} onOpenBill={onOpenBill} />)}</div>
      </details>
      {(comparison.partner_billed.count > 0 || comparison.partner_paid_cents !== 0) && <Records title="Partner fee billed" group={comparison.partner_billed} visible={visible} onOpenBill={onOpenBill}><p className="mb-1.5 text-slate-700">{money(comparison.partner_paid_cents)} paid this period. The paid amount is already included in the shared payment total.</p></Records>}
      {comparison.partner_schedule?.count > 0 && <Records title="Scheduled NexPac partner fee" group={comparison.partner_schedule} visible={visible} onOpenBill={onOpenBill}><p className="mb-1.5 text-slate-700">$45,250 at each month-end starting June 30, 2026. Open a source bill where one is on file. The schedule shows expected charges and does not add a payment.</p></Records>}
      {(comparison.funding.count > 0 || comparison.funded_paid.count > 0) && <div className="grid gap-1.5 sm:grid-cols-2">
        <Records title="RTM / NextTrade funding activity" group={comparison.funding} visible={visible}><p className="mb-1.5 text-slate-700">These bank transfers are for reconciliation. Both comparisons use the recorded bills and fees.</p></Records>
        <Records title="RTM / NextTrade bills and fees paid" group={comparison.funded_paid} visible={visible} onOpenBill={onOpenBill}><p className="mb-1.5 text-slate-700">{comparison.funded_paid.count ? 'These payments are part of the shared total above.' : 'No bill payments or service fees were recorded through these companies in this period.'}</p></Records>
      </div>}
      {comparison.review.count > 0 && <Records title="Money out to reconcile" group={comparison.review} visible={visible} onOpenBill={onOpenBill}><p className="mb-1.5 text-amber-900">These items need a category or a verified payment link before they can be included. Some may already appear in the bank total.</p></Records>}
      {comparison.unclassified_receipts.count > 0 && <Records title="Deposits to identify" group={comparison.unclassified_receipts} visible={visible} onOpenInvoice={onOpenInvoice}><p className="mb-1.5 text-amber-900">Confirm these deposits as customer receipts to include them.</p></Records>}
    </div>}
    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 border-t border-slate-200 pt-2 text-slate-700">
      <span>Goods profit <b className="tabular-nums">{money(period.goods_profit)}</b></span>
      <span>Transport billed <b className="tabular-nums">{money(period.transport_revenue)}</b></span>
      <span>Transport profit <b className="tabular-nums">{money(period.transport_profit)}</b></span>
      {goodsMissing > 0 && <span className="text-amber-900">{money(period.excl.goods_revenue)} on {goodsMissing} {goodsMissing === 1 ? 'line needs' : 'lines need'} cost information for goods profit. {onFixCosts && <button type="button" className={link} onClick={onFixCosts}>Fix missing costs</button>}</span>}
    </div>
  </section>;
}
