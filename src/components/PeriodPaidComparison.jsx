import React from 'react';

const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const money = cents => dollars.format(cents / 100);
const link = 'font-semibold text-left text-[#1d4ed8] underline underline-offset-2';
const expenseBases = [
  { key: 'bank', label: 'Bank cash', expense: 'Cash out for expenses and funding', description: 'Uses KTC’s bank dates. Includes RTM / NextTrade transfers once. Vendor payments funded by those transfers appear below for reconciliation.' },
  { key: 'vendor', label: 'Vendor payments', expense: 'Bills and expenses paid', description: 'Uses recorded payment dates, including the date NextTrade paid each categorized charge. Later reimbursements are shown under funding activity.' },
  { key: 'billed', label: 'Bills by date · accrual', expense: 'Bills and NextTrade charges', description: 'Includes paid and unpaid vendor bills by bill date and NextTrade charges by transaction date. A linked bill and its charge count once.' },
];

function RecordList({ rows, visible, onOpenInvoice, onOpenBill, showCategory, paymentsByTransfer, categoryPicker }) {
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
              {paymentsByTransfer && row.allocation && <div className="text-slate-700">Applied to bills {money(row.allocation.linked_cents)} · Unallocated at period-end {money(row.allocation.unallocated_cents)}</div>}
              {categoryPicker && <div>{categoryPicker(row)}</div>}
              {paymentsByTransfer && row.source === 'Funds sent' && !linked && <div className="text-slate-600">No linked payments in this period</div>}
            </td>
            {showCategory && <td className="px-2 py-1.5">{row.label || 'Uncategorized'}</td>}
            <td className="whitespace-nowrap px-2 py-1.5 text-right font-semibold tabular-nums">{money(row.cents)}</td>
          </tr>
          {linked && <tr><td colSpan={showCategory ? 4 : 3} className="px-2 pb-2"><Records title={'Payments this transfer funded · ' + row.date} group={linked} visible={visible} onOpenBill={onOpenBill} categoryPicker={categoryPicker} showCategory /></td></tr>}
        </React.Fragment>;
      })}</tbody>
    </table>
  </div>;
}

function Records({ title, group, children, ...detail }) {
  return <details className="rounded border border-slate-200 px-3 py-2">
    <summary className="cursor-pointer font-semibold text-[#1d4ed8]"><span className="inline-flex w-[calc(100%-1rem)] justify-between gap-2 align-top"><span>{title}</span><span className="shrink-0 tabular-nums text-[#0f172a]">{money(group.cents)}</span></span></summary>
    <div className="mt-1.5">{children}<RecordList rows={group.rows} {...detail} /></div>
  </details>;
}

function CategoryRecords({ title, group, visible, children, ...detail }) {
  const categories = new Map();
  if (visible) group.rows.forEach(row => {
    const key = row.category || '';
    if (!categories.has(key)) categories.set(key, { label: row.label, cents: 0, rows: [] });
    const entry = categories.get(key);
    entry.rows.push(row);
    entry.cents += row.cents;
  });
  return <details className="rounded border border-slate-200 px-3 py-2">
    <summary className="cursor-pointer font-semibold text-[#1d4ed8]"><span className="inline-flex w-[calc(100%-1rem)] justify-between gap-2 align-top"><span>{title}</span><span className="shrink-0 tabular-nums text-[#0f172a]">{money(group.cents)}</span></span></summary>
    <div className="my-1.5 space-y-1.5">{children}
      {!visible && <p className="text-slate-600">Transaction detail access is required to see the underlying records.</p>}
      {visible && !categories.size && <p className="text-slate-600">No records for this period.</p>}
      {Array.from(categories, ([key, entry]) => ({ key, ...entry })).sort((a, b) => b.cents - a.cents).map(entry =>
        <Records key={entry.key} title={entry.label || 'Uncategorized'} group={entry} visible={visible} {...detail} />)}
    </div>
  </details>;
}

export default function PeriodPaidComparison({ period, periods, onPeriod, comparison, status, invoiceRows, onOpenInvoice, onOpenBill, onFixCosts, pnl, pnlExpenses, onOpenPnl, basis = 'bank', onBasisChange, canSeeSources = true, categoryPicker }) {
  const available = !!(comparison && !comparison.unavailable);
  const visible = available && comparison.rows_visible && canSeeSources;
  const invoices = { cents: period.goods_revenue, rows: invoiceRows };
  const goodsMissing = period.excl.goods_lines;
  const mode = expenseBases.find(option => option.key === basis) || expenseBases[0];
  const expenseGroup = available ? comparison[{ bank: 'bank_cash', vendor: 'paid', billed: 'billed' }[mode.key]] : null;
  const paymentsByTransfer = new Map();
  const rtm = comparison?.rtm_reconciliation;
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
    {goodsMissing > 0 && !period.miss.goods_revenue && <p className="mb-3 text-slate-700">
      {money(period.goods_revenue)} total goods invoiced − {money(period.excl.goods_revenue)} awaiting supplier costs = {money(period.used.goods_revenue)} of goods revenue used to calculate margin.
    </p>}
    <div className={'grid gap-3' + (mode.key === 'billed' ? '' : ' sm:grid-cols-2')}>
      {panel(mode.key === 'billed' ? 'Goods invoiced less bills dated this period' : 'Goods invoiced less payments', period.goods_revenue, <Records title="Goods invoiced" group={invoices} visible={canSeeSources} onOpenInvoice={onOpenInvoice} />, !period.miss.goods_revenue)}
      {mode.key !== 'billed' && panel('Customer receipts less payments', available ? comparison.receipts.cents : 0, available ? <Records title="Customer receipts from the bank" group={comparison.receipts} visible={visible} onOpenInvoice={onOpenInvoice} categoryPicker={categoryPicker} /> : null)}
    </div>
    {!available && <p role="status" className="mt-2 text-slate-700">{comparison?.unavailable || status || 'Loading payments…'}</p>}
    {available && comparison.notice && <p role="status" className="mt-2 rounded border border-[#d8bc7f] bg-[#fffbeb] px-3 py-2 text-[#713f12]">{comparison.notice}</p>}
    {available && <div className="mt-2 space-y-1.5">
      {expenseGroup && <CategoryRecords key={mode.key} title={mode.expense + ' · by category'} group={expenseGroup} visible={visible} onOpenBill={onOpenBill} categoryPicker={categoryPicker} />}
      {comparison.direct_ktc_expenses?.count > 0 && <CategoryRecords title="Direct KTC bank expenses · by category" group={comparison.direct_ktc_expenses} visible={visible} categoryPicker={categoryPicker}><p className="text-slate-700">Posted KTC payments grouped by their bank category and bank date.</p></CategoryRecords>}
      {(comparison.partner_billed.count > 0 || comparison.partner_paid_cents !== 0) && <Records title="Partner fee billed" group={comparison.partner_billed} visible={visible} onOpenBill={onOpenBill} categoryPicker={categoryPicker}><p className="mb-1.5 text-slate-700">{money(comparison.partner_paid_cents)} in recorded partner-fee payments this period. An RTM-funded payment explains the transfer in Bank cash. The bill itself is included by its date in Bills by date.</p></Records>}
      {comparison.partner_schedule?.count > 0 && <Records title="Scheduled NexPac partner fee" group={comparison.partner_schedule} visible={visible} onOpenBill={onOpenBill}><p className="mb-1.5 text-slate-700">$45,250 at each month-end starting June 30, 2026. Open a source bill where one is on file. The schedule shows expected charges and does not add a payment.</p></Records>}
      {comparison.nextrade_charges?.count > 0 && <Records title="NextTrade charges incurred for KTC" group={comparison.nextrade_charges} visible={visible} onOpenBill={onOpenBill} categoryPicker={categoryPicker} showCategory><p className="mb-1.5 text-slate-700">These charges enter the internal P&amp;L once, in the month of the NextTrade transaction.</p></Records>}
      {comparison.nextrade_reimbursements?.count > 0 && <Records title="Reimbursements of recorded NextTrade charges" group={comparison.nextrade_reimbursements} visible={visible} onOpenBill={onOpenBill} categoryPicker={categoryPicker} showCategory><p className="mb-1.5 text-slate-700">The expense stays in the original charge period. The reimbursement settles its bill.</p></Records>}
      {(comparison.funding.count > 0 || comparison.funded_paid.count > 0) && <>
        <Records title="RTM / NextTrade funding activity" group={comparison.funding} visible={visible} onOpenBill={onOpenBill} categoryPicker={categoryPicker} paymentsByTransfer={paymentsByTransfer}><p className="mb-1.5 text-slate-700">These transfers enter Bank cash on their bank dates. Open each transfer to see its linked payments.</p>
          {rtm && <p className="mb-2 font-semibold">RTM transfers this period {money(rtm.sent)} − linked bills {money(rtm.bills)}
            {rtm.fees !== 0 && (' − booked fees ' + money(rtm.fees))}{rtm.refunded !== 0 && (' − funds returned ' + money(rtm.refunded))}
            {' = ' + money(rtm.left) + ' unallocated at period-end'}.</p>}
        </Records>
        <CategoryRecords title="RTM / NextTrade bills and fees paid · by category" group={comparison.funded_paid} visible={visible} onOpenBill={onOpenBill} categoryPicker={categoryPicker} />
      </>}
      {comparison.review.count > 0 && <Records title="Money out to reconcile" group={comparison.review} visible={visible} onOpenBill={onOpenBill} categoryPicker={categoryPicker}><p className="mb-1.5 text-[#713f12]">These items need a category or a verified payment link before they can be included. Some may already appear in the bank total.</p></Records>}
      {comparison.unclassified_receipts.count > 0 && <Records title="Deposits to identify" group={comparison.unclassified_receipts} visible={visible} onOpenInvoice={onOpenInvoice} categoryPicker={categoryPicker}><p className="mb-1.5 text-amber-900">Choose the bank category on each deposit. Customer payments go under Customer receipts.</p></Records>}
      {comparison.other_deposits?.count > 0 && <CategoryRecords title="Other categorized deposits" group={comparison.other_deposits} visible={visible} categoryPicker={categoryPicker} />}
    </div>}
    <div className="mt-3 border-t border-slate-200 pt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-base font-bold">Profit &amp; Loss</h3>
        {pnl?.cents != null && <button type="button" className={link + ' tabular-nums'} onClick={onOpenPnl}>{period.label + ' P&L · ' + money(pnl.cents) + (pnl.complete ? '' : ' · Provisional')} <span aria-hidden="true">↗</span></button>}
      </div>
      <p className="mt-1">Goods profit + transport profit − warehouse and office − partner fees − payroll − taxes.</p>
      {pnlExpenses && pnl?.cents != null && <p className="mt-1 font-semibold tabular-nums">
        {money(period.goods_profit)} + {money(period.transport_profit)} − {money(pnlExpenses.A.cents)} − {money(pnlExpenses.C.cents)} − {money(pnlExpenses.D.cents)} − {money(pnlExpenses.E.cents)} = {money(pnl.cents)}
      </p>}
      <p className="mt-1 text-slate-600">Shipment margins follow invoice dates. Direct KTC expenses follow bank dates. NextTrade charges follow the original transaction date.</p>
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
