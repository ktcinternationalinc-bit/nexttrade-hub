import React from 'react';

const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const money = cents => dollars.format(cents / 100);
export const negativeInk = cents => cents < 0 ? { color: '#991b1b' } : undefined;
const link = 'font-semibold text-left text-[#1d4ed8] underline underline-offset-2';
const expenseBases = [
  { key: 'bank', label: 'KTC Bank & Card Activity', expense: 'Cash out for expenses and funding', description: 'KTC bank and card transactions by posting date, including funding transfers to RTM and NextTrade.' },
  { key: 'vendor', label: 'Expenses Paid This Period', expense: 'Bills and expenses paid', description: 'Payments toward expenses by KTC, RTM, and NextTrade. Bill payments use the payment date. NextTrade expenses use the original transaction date.' },
  { key: 'billed', label: 'Bills & Charges Incurred', expense: 'Bills and NextTrade charges', description: 'Vendor bills by bill date, including unpaid bills, plus NextTrade charges by transaction date. A linked bill and its charge count once.' },
];
function Amount({ cents }) {
  return cents < 0 ? <span style={negativeInk(cents)}>{money(cents)}</span> : money(cents);
}

function Adjustment({ cents, label }) {
  if (!cents) return null;
  return <> {cents > 0 ? '+' : <span style={negativeInk(cents)}>−</span>} <span style={negativeInk(cents)}>{money(Math.abs(cents))}</span> {label}</>;
}

function PaymentBasisReconciliation({ comparison }) {
  const bankExpenses = comparison.bank_cash.cents - comparison.funding.cents;
  const reimbursements = comparison.nextrade_reimbursements?.cents || 0;
  const nexttradeCharges = comparison.nextrade_charges?.cents || 0;
  const vendorKtc = comparison.paid.cents - comparison.funded_paid.cents - nexttradeCharges + reimbursements;
  const companyFunding = Object.entries(comparison.funding_by_company || {});
  return <details className="mb-3 rounded-lg border border-slate-200 bg-[#f8fafc] px-3 py-2 tabular-nums">
    <summary className="cursor-pointer font-semibold">Why bank and card activity differs from expenses paid</summary>
    <div className="mt-1 space-y-1">
      <p><b>KTC Bank &amp; Card Activity <Amount cents={comparison.bank_cash.cents} /></b> = <Amount cents={bankExpenses} /> in posted KTC transactions
        {companyFunding.length
          ? companyFunding.map(([key, company]) => <Adjustment key={key} cents={company.cents} label={company.label} />)
          : <Adjustment cents={comparison.funding.cents} label="net funding" />}.</p>
      <p><b>Expenses Paid This Period <Amount cents={comparison.paid.cents} /></b> = <Amount cents={vendorKtc} /> in categorized or matched KTC payments
        <Adjustment cents={comparison.funded_paid.cents} label="bills and fees paid through RTM / NextTrade" />
        <Adjustment cents={nexttradeCharges} label="NextTrade’s own expense transactions" />
        <Adjustment cents={-reimbursements} label="reimbursements of charges already counted" />.</p>
    </div>
  </details>;
}

function RecordList({ rows, visible, onOpenInvoice, onOpenBill, showCategory, paymentsByTransfer, categoryPicker }) {
  if (!visible) return <p className="py-2 text-slate-600">Your access includes the totals. Source records require transaction detail access.</p>;
  if (!rows.length) return <p className="py-2 text-slate-600">No records for this period.</p>;
  return <div className="max-h-72 overflow-auto rounded border border-slate-200">
    <table className="w-full text-left">
      <thead className="sticky top-0 z-10 bg-[#f1f5f9] text-slate-700"><tr><th scope="col" className="px-2 py-1">Date</th><th scope="col" className="px-2 py-1">Source record</th>{showCategory && <th scope="col" className="px-2 py-1">Category</th>}<th scope="col" className="px-2 py-1 text-right">Amount</th></tr></thead>
      <tbody>{rows.map((row, index) => {
        const linked = row.source === 'Funds sent' && paymentsByTransfer?.get(row.id);
        return <React.Fragment key={row.id + '|' + index}>
          <tr className="border-t border-slate-100 align-top">
            <td className="whitespace-nowrap px-2 py-1.5">{row.date || '—'}</td>
            <td className="px-2 py-1.5">
              {row.invoice_id && onOpenInvoice ? <button type="button" className={link} onClick={() => onOpenInvoice(row.invoice_id)}>{row.ref ? 'Invoice ' + row.ref : 'Open matched invoice'}</button> : null}
              {row.bill_id && onOpenBill ? <button type="button" className={link} onClick={() => onOpenBill(row)}>{'Bill ' + (row.ref || row.who)}</button> : null}
              <div>{row.who || row.label}{row.source_company === 'NextTrade' && ' (NextTrade)'}</div>
              {row.credit_card && <div className="text-slate-600">Credit card</div>}
              {row.reimbursement_cents != null && <div className="text-slate-600">Reimburses NextTrade charges · <Amount cents={row.reimbursement_cents} /></div>}
              {row.source && row.source !== 'Bank transaction' && row.source_company !== 'NextTrade' && <div className="text-slate-600">{row.source}</div>}
              {row.review_reason && <div className="text-[#713f12]">{row.review_reason}</div>}
              {row.transfer_date && <div className="text-slate-600">Funding transfer {row.transfer_date}</div>}
              {row.bank_ref && <div className="text-slate-600">{row.bank_ref}</div>}
              {paymentsByTransfer && row.allocation && <div className="text-slate-700">Applied to bills <Amount cents={row.allocation.linked_cents} /> · Unallocated at period-end <Amount cents={row.allocation.unallocated_cents} /></div>}
              {categoryPicker && <div>{categoryPicker(row)}</div>}
              {paymentsByTransfer && row.source === 'Funds sent' && !linked && <div className="text-slate-600">No linked payments in this period</div>}
            </td>
            {showCategory && <td className="px-2 py-1.5">{row.label || 'Uncategorized'}</td>}
            <td className="whitespace-nowrap px-2 py-1.5 text-right font-semibold tabular-nums" style={negativeInk(row.cents)}>{money(row.cents)}</td>
          </tr>
          {linked && <tr><td colSpan={showCategory ? 4 : 3} className="px-2 pb-2"><Records title={'Payments this transfer funded · ' + row.date} group={linked} visible={visible} onOpenBill={onOpenBill} categoryPicker={categoryPicker} showCategory /></td></tr>}
        </React.Fragment>;
      })}</tbody>
    </table>
  </div>;
}

function RecordTotals({ cents, nexttradeCents }) {
  return <span className="shrink-0 text-right tabular-nums text-[#0f172a]" style={negativeInk(cents)}>{money(cents)}
    {nexttradeCents != null && <span className="block text-[12px] font-medium text-slate-600"><Amount cents={nexttradeCents} /> (NextTrade)</span>}
  </span>;
}

function Records({ title, group, children, initiallyOpen, nexttradeCents, ...detail }) {
  return <details open={initiallyOpen} className="rounded border border-slate-200 px-3 py-2">
    <summary className="cursor-pointer font-semibold text-[#1d4ed8]"><span className="inline-flex w-[calc(100%-1rem)] justify-between gap-2 align-top"><span>{title}</span><RecordTotals cents={group.cents} nexttradeCents={nexttradeCents} /></span></summary>
    <div className="mt-1.5">{children}<RecordList rows={group.rows} {...detail} /></div>
  </details>;
}

function CategoryRecords({ title, group, nexttrade, visible, children, initiallyOpen, fundingByCompany, ...detail }) {
  const categories = new Map();
  function addRow(row, fromNextTrade) {
    const key = row.category || '';
    if (!categories.has(key)) categories.set(key, { label: row.label, cents: 0, nexttradeCents: null, rows: [] });
    const entry = categories.get(key);
    entry.rows.push(row);
    if (fromNextTrade) entry.nexttradeCents = (entry.nexttradeCents || 0) + row.cents;
    else entry.cents += row.cents;
  }
  if (visible) {
    group.rows.forEach(row => addRow(row, false));
    nexttrade?.rows.forEach(row => addRow(row, true));
  }
  return <details open={initiallyOpen} className="rounded border border-slate-200 px-3 py-2">
    <summary className="cursor-pointer font-semibold text-[#1d4ed8]"><span className="inline-flex w-[calc(100%-1rem)] justify-between gap-2 align-top"><span>{title}</span><RecordTotals cents={group.cents} nexttradeCents={nexttrade?.cents} /></span></summary>
    <div className="my-1.5 space-y-1.5">{children}
      {!visible && <p className="text-slate-600">Transaction detail access is required to see the underlying records.</p>}
      {visible && !categories.size && <p className="text-slate-600">No records for this period.</p>}
      {Array.from(categories, ([key, entry]) => ({ key, ...entry })).sort((a, b) => b.cents + (b.nexttradeCents || 0) - a.cents - (a.nexttradeCents || 0)).map(entry =>
        <Records key={entry.key} title={entry.label || 'Uncategorized'} group={entry} nexttradeCents={entry.nexttradeCents} visible={visible} {...detail}>
          {fundingByCompany?.[entry.key]?.reconciliation && <FundingSummary reconciliation={fundingByCompany[entry.key].reconciliation} />}
        </Records>)}
    </div>
  </details>;
}

function FundingSummary({ reconciliation: r }) {
  return <p className="mb-2 font-semibold">Transfers this period <Amount cents={r.sent} /> − linked bills <Amount cents={r.bills} />
    {r.fees !== 0 && <> − booked fees <Amount cents={r.fees} /></>}{r.refunded !== 0 && <> − funds returned <Amount cents={r.refunded} /></>}
    {' = '}<Amount cents={r.left} /> unallocated at period-end.</p>;
}

function ManagedSalesBalance({ balance }) {
  return <details className="mt-2 rounded border border-slate-200 px-3 py-2">
    <summary className="flex cursor-pointer flex-wrap justify-between gap-x-4 font-semibold text-[#1d4ed8]">
      <span>NextTrade-managed sales balance</span>
      <span className="tabular-nums text-[#0f172a]"><Amount cents={balance.closing} /> held at period end</span>
    </summary>
    <div className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
      <span>Opening balance <b><Amount cents={balance.opening} /></b></span>
      <span>Sales received <b><Amount cents={balance.receipts} /></b></span>
      <span>Remitted to KTC <b><Amount cents={-balance.remitted} /></b></span>
      <span>Bills paid from balance <b><Amount cents={-balance.paid} /></b></span>
      {balance.reversed !== 0 && <span>Sales reversals <b><Amount cents={-balance.reversed} /></b></span>}
    </div>
  </details>;
}

export default function PeriodPaidComparison({ period, periods, onPeriod, comparison, status, invoiceRows, onOpenInvoice, onOpenBill, onOpenTransactions, onFixCosts, pnl, pnlExpenses, onOpenPnl, basis = 'bank', onBasisChange, canSeeSources = true, categoryPicker }) {
  const available = !!(comparison && !comparison.unavailable);
  const visible = available && comparison.rows_visible && canSeeSources;
  const invoices = { cents: period.goods_revenue, rows: invoiceRows };
  const goodsMissing = period.excl.goods_lines;
  const mode = expenseBases.find(option => option.key === basis) || expenseBases[0];
  const expenseGroup = available ? comparison[{ bank: 'bank_cash', vendor: 'paid', billed: 'billed' }[mode.key]] : null;
  const bankView = mode.key === 'bank';
  const nexttradeInBankView = bankView && comparison?.nextrade_charges?.count > 0 ? comparison.nextrade_charges : undefined;
  const review = available ? comparison.other_review ?? comparison.review : null;
  const paymentsByTransfer = new Map();
  const partnerBilled = comparison?.partner_billed;
  const partnerExpected = comparison?.partner_schedule;
  const partnerPaid = comparison?.partner_paid_cents || 0;
  const showPartnerFee = partnerBilled?.count > 0 || partnerExpected?.count > 0 || partnerPaid !== 0;
  const moneyAtNextTrade = comparison?.managed_sales_receipts?.count > 0 || comparison?.managed_sales_remittances?.count > 0;
  if (visible && bankView) comparison.funded_paid.rows.forEach(row => {
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
        <b className="shrink-0 tabular-nums" style={expenseGroup && negativeInk(-expenseGroup.cents)}>{expenseGroup ? money(-expenseGroup.cents) : '—'}</b>
      </div>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-2 border-t border-slate-300 px-3 pt-2">
        <span className="font-semibold">{mode.key === 'billed' ? 'Balance after billed costs' : 'Balance after payments'}</span>
        <b className="text-2xl tabular-nums" style={negativeInk(balance)}>{balance === null ? '—' : '= ' + money(balance)}</b>
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
    {available && mode.key !== 'billed' && <PaymentBasisReconciliation comparison={comparison} />}
    {goodsMissing > 0 && !period.miss.goods_revenue && <p className="mb-3 text-slate-700">
      <Amount cents={period.goods_revenue} /> total goods invoiced − <Amount cents={period.excl.goods_revenue} /> awaiting supplier costs = <Amount cents={period.used.goods_revenue} /> of goods revenue used to calculate margin.
    </p>}
    <div className={'grid gap-3' + (mode.key === 'billed' ? '' : ' sm:grid-cols-2')}>
      {panel(mode.key === 'billed' ? 'Goods invoiced less bills dated this period' : 'Goods invoiced less payments', period.goods_revenue, <Records title="Goods invoiced" group={invoices} visible={canSeeSources} onOpenInvoice={onOpenInvoice} />, !period.miss.goods_revenue)}
      {mode.key !== 'billed' && panel(moneyAtNextTrade ? 'Cash received less payments' : 'Bank receipts less payments', available ? comparison.receipts.cents : 0, available ?
        <CategoryRecords title={moneyAtNextTrade ? 'Cash receipts for KTC' : 'Cash receipts from the bank'} group={comparison.receipts} visible={visible} onOpenInvoice={onOpenInvoice} categoryPicker={categoryPicker}>
          {moneyAtNextTrade
            ? <p className="text-slate-700">KTC bank receipts and NextTrade-managed sales, by bank posting date. Matched remittances are counted on the original NextTrade receipt date.</p>
            : <p className="text-slate-700">Customer collections and other categorized income received this period, by bank posting date.</p>}
        </CategoryRecords> : null)}
    </div>
    {available && comparison.managed_sales_balance && <ManagedSalesBalance balance={comparison.managed_sales_balance} />}
    {!available && <p role="status" className="mt-2 text-slate-700">{comparison?.unavailable || status || 'Loading payments…'}</p>}
    {available && comparison.notice && <p role="status" className="mt-2 rounded border border-[#d8bc7f] bg-[#fffbeb] px-3 py-2 text-[#713f12]">{comparison.notice}</p>}
    {available && <div className="mt-2 space-y-1.5">
      {mode.key !== 'billed' && moneyAtNextTrade && <CategoryRecords title="KTC bank receipts only" group={comparison.bank_receipts}
        visible={visible} onOpenInvoice={onOpenInvoice} categoryPicker={categoryPicker}>
        {comparison.managed_sales_remittances.count > 0 && <p className="text-slate-700">Includes <Amount cents={comparison.managed_sales_remittances.cents} /> transferred in from NextTrade-managed sales.</p>}
      </CategoryRecords>}
      {expenseGroup && <CategoryRecords key={mode.key} title={bankView ? mode.expense : mode.expense + ' · by category'} group={expenseGroup}
        visible={visible} onOpenBill={onOpenBill} categoryPicker={categoryPicker} initiallyOpen={bankView} nexttrade={nexttradeInBankView}
        paymentsByTransfer={bankView ? paymentsByTransfer : undefined} fundingByCompany={bankView ? comparison.funding_by_company : undefined}>
        {bankView && <p className="text-slate-700">KTC bank and credit-card transactions use the saved categories and posting dates from {onOpenTransactions
          ? <button type="button" className={link} onClick={onOpenTransactions}>Daily Work → All Transactions</button>
          : 'Daily Work → All Transactions'}. Open a category to see the payments.</p>}
        {nexttradeInBankView && <p className="text-slate-700">NextTrade charges appear in the same expense categories. Amounts marked (NextTrade) are included in Expenses Paid This Period.</p>}
      </CategoryRecords>}
      {!bankView && comparison.bank_review?.count > 0 && <Records title="KTC bank payments awaiting an expense category" group={comparison.bank_review} visible={visible} categoryPicker={categoryPicker} showCategory><p className="mb-1.5 text-[#713f12]">These amounts appear in KTC Bank &amp; Card Activity. Assign an expense category to include them in Expenses Paid This Period.</p></Records>}
      {!bankView && review?.count > 0 && <Records title="Other payments to reconcile" group={review} visible={visible} onOpenBill={onOpenBill} categoryPicker={categoryPicker}><p className="mb-1.5 text-[#713f12]">Review the underlying bills and funding links. Some amounts are already represented by a bank transaction.</p></Records>}
      {!bankView && showPartnerFee && <Records
        title={partnerBilled?.count ? 'Partner fee billed' : partnerExpected?.count ? 'Partner fee expected' : 'Partner fee'}
        group={{
          cents: partnerBilled?.count ? partnerBilled.cents : partnerExpected?.cents || partnerPaid,
          rows: [...(partnerBilled?.rows || []), ...(partnerExpected?.rows || [])].sort((a, b) => a.date.localeCompare(b.date)),
        }}
        visible={visible} onOpenBill={onOpenBill} categoryPicker={categoryPicker}>
        <p className="mb-1.5 text-slate-700">Recorded payments this period <Amount cents={partnerPaid} />.</p>
        {partnerBilled?.count > 0 && partnerExpected?.count > 0 && <p className="mb-1.5 text-slate-700">Another <Amount cents={partnerExpected.cents} /> in expected fees needs a source bill or reconciliation.</p>}
      </Records>}
      {!bankView && comparison.nextrade_reimbursements?.count > 0 && <Records title="Reimbursements of NextTrade charges" group={comparison.nextrade_reimbursements} visible={visible} onOpenBill={onOpenBill} categoryPicker={categoryPicker} showCategory><p className="mb-1.5 text-slate-700">These payments settle linked bills. The original NextTrade transaction controls whether the expense is included in KTC P&amp;L.</p></Records>}
      {comparison.unclassified_receipts.count > 0 && <Records title="Deposits to identify" group={comparison.unclassified_receipts} visible={visible} onOpenInvoice={onOpenInvoice} categoryPicker={categoryPicker}><p className="mb-1.5 text-amber-900">Choose the bank category on each deposit. Customer payments go under Customer receipts.</p></Records>}
      {comparison.other_deposits?.count > 0 && <CategoryRecords title="Other categorized deposits" group={comparison.other_deposits} visible={visible} categoryPicker={categoryPicker} />}
    </div>}
    <div className="mt-3 border-t border-slate-200 pt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-base font-bold">Profit &amp; Loss</h3>
        {pnl?.cents != null && <button type="button" className={link + ' tabular-nums'} onClick={onOpenPnl}>{period.label + ' P&L · '}<Amount cents={pnl.cents} />{pnl.complete ? '' : ' · Provisional'} <span aria-hidden="true">↗</span></button>}
      </div>
      <p className="mt-1">Goods profit + transport profit − warehouse and office − partner fees − payroll − taxes.</p>
      {pnlExpenses && pnl?.cents != null && <p className="mt-1 font-semibold tabular-nums">
        <Amount cents={period.goods_profit} /><Adjustment cents={period.transport_profit} />
        <Adjustment cents={-pnlExpenses.A.cents} /><Adjustment cents={-pnlExpenses.C.cents} />
        <Adjustment cents={-pnlExpenses.D.cents} /><Adjustment cents={-pnlExpenses.E.cents} /> = <Amount cents={pnl.cents} />
      </p>}
      <p className="mt-1 text-slate-600">Shipment margins follow invoice dates. Direct KTC expenses follow bank dates. NextTrade charges follow the original transaction date.</p>
      {pnl?.rtm_provisional_cents > 0 && <p className="mt-1"><b><Amount cents={pnl.rtm_provisional_cents} /></b> of the RTM funding is in Warehouse / Office as provisional Professional Fees. Linked payments reduce that amount.</p>}
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
        <span>Goods profit <b className="tabular-nums"><Amount cents={period.goods_profit} /></b></span>
        <span>Transport billed <b className="tabular-nums"><Amount cents={period.transport_revenue} /></b></span>
        <span>Transport profit <b className="tabular-nums"><Amount cents={period.transport_profit} /></b></span>
        {goodsMissing > 0 && <span className="text-[#713f12]"><Amount cents={period.excl.goods_revenue} /> on {goodsMissing} {goodsMissing === 1 ? 'line needs' : 'lines need'} cost information for goods profit. {onFixCosts && <button type="button" className={link} onClick={onFixCosts}>Fix missing costs</button>}</span>}
      </div>
    </div>
    {available && !bankView && comparison.nextrade_charges?.count > 0 && <div className="mt-3 rounded border border-slate-200 px-3 py-2">
      <p className="flex flex-wrap justify-between gap-x-2 font-semibold"><span>NextTrade charges incurred for KTC · reference</span><b className="tabular-nums"><Amount cents={comparison.nextrade_charges.cents} /></b></p>
      <p className="text-slate-700">These transactions are already included in their P&amp;L expense categories.</p>
    </div>}
  </section>;
}
