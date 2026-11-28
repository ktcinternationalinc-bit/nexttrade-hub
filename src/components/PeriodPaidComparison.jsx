import React from 'react';

const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const money = cents => dollars.format(cents / 100);
const link = 'font-semibold text-left text-[#1d4ed8] underline underline-offset-2';
const expenseBases = [
  { key: 'bank', label: 'Bank cash', expense: 'Cash out for expenses and funding', description: 'Uses KTC’s bank dates. Includes RTM / NextTrade transfers once. Vendor payments funded by those transfers appear below for reconciliation.' },
  { key: 'vendor', label: 'Vendor payments', expense: 'Bills and expenses paid', description: 'Uses recorded payment dates. Payments by RTM or NextTrade count here under the bill category. The transfers that funded them are shown separately.' },
  { key: 'billed', label: 'Bills by date · accrual', expense: 'Vendor bills dated this period', description: 'Includes paid and unpaid vendor bills by bill date. Bank-only expenses without a bill are outside this comparison.' },
];

function RecordList({ rows, visible, onOpenInvoice, onOpenBill, showCategory, paymentsByTransfer }) {
  if (!visible) return <p className="py-2 text-slate-600">Your access includes the totals. Source records require transaction detail access.</p>;
  if (!rows.length) return <p className="py-2 text-slate-600">No records for this period.</p>;
  return <div className="max-h-72 overflow-auto rounded border border-slate-200">
    <table className="w-full text-left">
      <thead className="sticky top-0 bg-[#f1f5f9] text-slate-700"><tr><th scope="col" className="px-2 py-1">Date</th><th scope="col" className="px-2 py-1">Source record</th>{showCategory && <th scope="col" className="px-2 py-1">Category</th>}<th scope="col" className="px-2 py-1 text-right">Amount</th></tr></thead>
      <tbody>{rows.map((row, index) => {
        const linked = row.source === 'Funds sent' && paymentsByTransfer?.get(row.id);
        return <React.Fragment key={row.id + '|' + index}>
          <tr className="border-t border-slate-100 align-top">
            <td className="whitespace-nowrap px-2 py-1.5">{row.date || '—'}</td>
            <td className="px-2 py-1.5">
              {row.invoice_id && onOpenInvoice ? <button type="button" className={link} onClick={() => onOpenInvoice(row.invoice_id)}>{row.ref ? 'Invoice ' + row.ref : 'Open matched invoice'}</button> : null}
              {row.bill_id && onOpenBill ? <button type="button" className={link} onClick={() => onOpenBill(row)}>{'Bill ' + (row.ref || row.who)}</button> : null}
              <div>{row.who || row.label}</div>
              {row.source && <div className="text-slate-600">{row.source}</div>}
              {row.transfer_date && <div className="text-slate-600">Funding transfer {row.transfer_date}</div>}
              {row.bank_ref && <div className="text-slate-600">{row.bank_ref}</div>}
              {paymentsByTransfer && row.source === 'Funds sent' && !linked && <div className="text-slate-600">No linked payments in this period</div>}
            </td>
            {showCategory && <td className="px-2 py-1.5">{row.label || 'Uncategorized'}</td>}
            <td className="whitespace-nowrap px-2 py-1.5 text-right font-semibold tabular-nums">{money(row.cents)}</td>
          </tr>
          {linked && <tr><td colSpan={showCategory ? 4 : 3} className="px-2 pb-2"><Records title={'Payments this transfer funded · ' + row.date} group={linked} visible={visible} onOpenBill={onOpenBill} showCategory /></td></tr>}
        </React.Fragment>;
      })}</tbody>
    </table>
  </div>;
}

function Records({ title, group, visible, onOpenInvoice, onOpenBill, showCategory, paymentsByTransfer, children }) {
  return <details className="rounded border border-slate-200 px-3 py-2">
    <summary className="cursor-pointer font-semibold text-[#1d4ed8]"><span className="inline-flex w-[calc(100%-1rem)] justify-between gap-2 align-top"><span>{title}</span><span className="shrink-0 tabular-nums text-[#0f172a]">{money(group.cents)}</span></span></summary>
    <div className="mt-1.5">{children}<RecordList rows={group.rows} visible={visible} onOpenInvoice={onOpenInvoice} onOpenBill={onOpenBill} showCategory={showCategory} paymentsByTransfer={paymentsByTransfer} /></div>
  </details>;
}

export default function PeriodPaidComparison({ period, periods, onPeriod, comparison, status, invoiceRows, onOpenInvoice, onOpenBill, onFixCosts, pnl, onOpenPnl, basis = 'bank', onBasisChange, canSeeSources = true }) {
  const available = !!(comparison && !comparison.unavailable);
  const visible = available && comparison.rows_visible && canSeeSources;
  const invoices = { cents: period.goods_revenue, rows: invoiceRows };
  const goodsMissing = period.excl.goods_lines;
  const mode = expenseBases.find(option => option.key === basis) || expenseBases[0];
  const expenseGroup = available ? comparison[{ bank: 'bank_cash', vendor: 'paid', billed: 'billed' }[mode.key]] : null;
  const categoryGroups = new Map();
  const paymentsByTransfer = new Map();
  if (visible) (expenseGroup?.rows || []).forEach(row => {
    const key = row.category || '';
    if (!categoryGroups.has(key)) categoryGroups.set(key, { label: row.label, cents: 0, rows: [] });
    const group = categoryGroups.get(key);
    group.rows.push(row);
    group.cents += row.cents;
  });
  if (visible) comparison.funded_paid.rows.forEach(row => {
    if (row.transfer_id) {
      if (!paymentsByTransfer.has(row.transfer_id)) paymentsByTransfer.set(row.transfer_id, { cents: 0, rows: [] });
      const linked = paymentsByTransfer.get(row.transfer_id);
      linked.rows.push(row);
      linked.cents += row.cents;
    }
  });

  function panel(title, total, detail, showBalance = true) {
    const balance = expenseGroup && showBalance ? total - expenseGroup.cents : null;
    return <div className="min-w-0 rounded-lg border border-slate-200 p-3">
      <h3 className="mb-2 text-base font-bold">{title}</h3>
      {detail}
      <div className="mt-2 flex justify-between gap-2 px-3 py-1">
        <span>{mode.expense}</span>
        <b className="shrink-0 tabular-nums">{expenseGroup ? money(0 - expenseGroup.cents) : '—'}</b>
      </div>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-2 border-t border-slate-300 px-3 pt-2">
        <span className="font-semibold">{mode.key === 'billed' ? 'Balance after billed costs' : 'Balance after payments'}</span>
        <b className="text-2xl tabular-nums">{balance === null ? '—' : '= ' + money(balance)}</b>
      </div>
    </div>;
  }

  return <section aria-label="Sales and payments comparison" className="nt-paper mb-3 rounded-lg p-3 text-[14px] leading-relaxed">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-lg font-bold">Sales and payments</h2>
      <label className="flex items-center gap-2 font-semibold">Period <select value={period.key} onChange={event => onPeriod(event.target.value)} className="nt-light rounded border px-2 py-1">{periods.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}</select></label>
    </div>
    <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="Expense timing">
      {expenseBases.map(option => <button key={option.key} type="button" aria-pressed={mode.key === option.key}
        onClick={() => onBasisChange(option.key)}
        className="rounded border px-3 py-1 font-semibold"
        style={mode.key === option.key ? { background: '#0f172a', color: '#ffffff', borderColor: '#0f172a' } : { background: '#ffffff', color: '#1d4ed8', borderColor: '#cbd5e1' }}>{option.label}</button>)}
    </div>
    <p className="mb-3 max-w-4xl">{mode.description}</p>
    <div className={'grid gap-3' + (mode.key === 'billed' ? '' : ' sm:grid-cols-2')}>
      {panel(mode.key === 'billed' ? 'Goods invoiced less bills dated this period' : 'Goods invoiced less payments', period.goods_revenue, <Records title="Goods invoiced" group={invoices} visible={canSeeSources} onOpenInvoice={onOpenInvoice} />, !period.miss.goods_revenue)}
      {mode.key !== 'billed' && panel('Customer receipts less payments', available ? comparison.receipts.cents : 0, available ? <Records title="Customer receipts from the bank" group={comparison.receipts} visible={visible} onOpenInvoice={onOpenInvoice} /> : null)}
    </div>
    {!available && <p role="status" className="mt-2 text-slate-700">{comparison?.unavailable || status || 'Loading payments…'}</p>}
    {available && comparison.notice && <p role="status" className="mt-2 rounded border border-[#d8bc7f] bg-[#fffbeb] px-3 py-2 text-[#713f12]">{comparison.notice}</p>}
    {available && <div className="mt-2 space-y-1.5">
      {expenseGroup && <details key={mode.key} className="rounded border border-slate-200 px-3 py-2">
        <summary className="cursor-pointer font-semibold text-[#1d4ed8]"><span className="inline-flex w-[calc(100%-1rem)] justify-between gap-2 align-top"><span>{mode.expense} <span className="font-normal">· by category</span></span><span className="shrink-0 tabular-nums text-[#0f172a]">{money(expenseGroup.cents)}</span></span></summary>
        <div className="my-1.5 space-y-1.5">{!visible && <p className="text-slate-600">Your access includes the totals. Source records require transaction detail access.</p>}{visible && !categoryGroups.size && <p className="text-slate-600">No records for this period.</p>}{Array.from(categoryGroups, ([key, group]) => ({ key, ...group })).sort((a, b) => b.cents - a.cents).map(group => <Records key={group.key} title={group.label} group={group} visible={visible} onOpenBill={onOpenBill} />)}</div>
      </details>}
      {(comparison.partner_billed.count > 0 || comparison.partner_paid_cents !== 0) && <Records title="Partner fee billed" group={comparison.partner_billed} visible={visible} onOpenBill={onOpenBill}><p className="mb-1.5 text-slate-700">{money(comparison.partner_paid_cents)} in recorded partner-fee payments this period. An RTM-funded payment explains the transfer in Bank cash. The bill itself is included by its date in Bills by date.</p></Records>}
      {comparison.partner_schedule?.count > 0 && <Records title="Scheduled NexPac partner fee" group={comparison.partner_schedule} visible={visible} onOpenBill={onOpenBill}><p className="mb-1.5 text-slate-700">$45,250 at each month-end starting June 30, 2026. Open a source bill where one is on file. The schedule shows expected charges and does not add a payment.</p></Records>}
      {(comparison.funding.count > 0 || comparison.funded_paid.count > 0) && <>
        <Records title="RTM / NextTrade funding activity" group={comparison.funding} visible={visible} onOpenBill={onOpenBill} paymentsByTransfer={paymentsByTransfer}><p className="mb-1.5 text-slate-700">These transfers enter Bank cash on their bank dates. Open a transfer’s linked payments to see its bills and categories for this period.</p></Records>
        <Records title="RTM / NextTrade bills and fees paid" group={comparison.funded_paid} visible={visible} onOpenBill={onOpenBill} showCategory><p className="mb-1.5 text-slate-700">{comparison.funded_paid.count ? 'Each payment enters Vendor payments under its bill category on its recorded payment date.' : 'No bill payments or service fees were recorded through these companies in this period.'}</p></Records>
      </>}
      {comparison.review.count > 0 && <Records title="Money out to reconcile" group={comparison.review} visible={visible} onOpenBill={onOpenBill}><p className="mb-1.5 text-[#713f12]">These items need a category or a verified payment link before they can be included. Some may already appear in the bank total.</p></Records>}
      {comparison.unclassified_receipts.count > 0 && <Records title="Deposits to identify" group={comparison.unclassified_receipts} visible={visible} onOpenInvoice={onOpenInvoice}><p className="mb-1.5 text-amber-900">Confirm these deposits as customer receipts to include them.</p></Records>}
    </div>}
    <div className="mt-3 border-t border-slate-200 pt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-base font-bold">Profit &amp; Loss</h3>
        {pnl?.cents != null && <button type="button" className={link + ' tabular-nums'} onClick={onOpenPnl}>{period.label + ' P&L · ' + money(pnl.cents) + (pnl.complete ? '' : ' · Provisional')} <span aria-hidden="true">↗</span></button>}
      </div>
      <p className="mt-1">Goods profit + transport profit − warehouse and office − partner fees − payroll − taxes.</p>
      <p className="mt-1 text-slate-600">Shipment margins follow invoice dates. Operating expenses follow payment dates.</p>
      {pnl?.rtm_provisional_cents > 0 && <p className="mt-1"><b>{money(pnl.rtm_provisional_cents)}</b> of the RTM funding is in Warehouse / Office as provisional Professional Fees. Linked payments reduce that amount.</p>}
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
        <span>Goods profit <b className="tabular-nums">{money(period.goods_profit)}</b></span>
        <span>Transport billed <b className="tabular-nums">{money(period.transport_revenue)}</b></span>
        <span>Transport profit <b className="tabular-nums">{money(period.transport_profit)}</b></span>
        {goodsMissing > 0 && <span className="text-[#713f12]">{money(period.excl.goods_revenue)} on {goodsMissing} {goodsMissing === 1 ? 'line needs' : 'lines need'} cost information for goods profit. {onFixCosts && <button type="button" className={link} onClick={onFixCosts}>Fix missing costs</button>}</span>}
      </div>
    </div>
  </section>;
}
