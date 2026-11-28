// v55.83-VY — P&L by period: money sent to RTM / NextTrade and what became of it (Max, Nov 20 2026, through Codex: "Click an
// RTM / NextTrade professional-fee component to see original transfers, underlying bill allocations, explicit services-rendered
// fees, and unused funds" · "Only explicit Services rendered designation creates that fee expense").
// Every figure comes from the ONE shared calculation (src/lib/party-funds.js) through expenseDetail().funding — nothing is
// worked out here. Stateless (the lists open with the browser's own <details>).
//   PERIOD  held at the start + funds sent − applied to bills − services rendered = held at the end   (flows of these dates)
//   TODAY   said separately, never as the period's balance (reservations exist only today)
import React from 'react';
import { periodNoBillsLinked, partnerFeeOfRows, OPEN_PARTY_FUNDS_EVENT } from '../lib/partner-fee'; // v55.83-ZP

// v55.83-ZP — Bills → 🏦 Funds with RTM / NextTrade, opened at this company's transfers (the Accounting screen catches the event)
function openFundsToLink(party) { try { window.dispatchEvent(new CustomEvent(OPEN_PARTY_FUNDS_EVENT, { detail: { party: party } })); } catch (e) { /* old browser */ } }

var INK = '#0f172a'; var SUB = '#475569'; var LINE = '#e2e8f0';
function money(c) { if (c === null || c === undefined) { return '—'; } var v = c / 100; return (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// props: funding (one company), catLabel(key), onConfirm(transfer, payer), onOpenBill(billRow, payer)
export default function FundsSent(props) {
  var f = props.funding; if (!f) { return null; }
  var catLabel = props.catLabel || function (k) { return k; };
  var p = f.period;
  var rtmFee = p.provisional_fee_cents != null;
  var fromStartingBalance = f.from_starting_balance_rows || [];
  var unlinked = f.unlinked_rows || [];
  var noBillRows = !f.applied_rows.length && !fromStartingBalance.length && !unlinked.length;
  function billList(title, rows, total) {
    var listed = rows.reduce(function (sum, b) { return sum + b.cents; }, 0);
    return <section className="px-2 py-1.5" style={{ borderBottom: '1px solid ' + LINE }}>
      <div className="flex justify-between gap-2 font-extrabold"><span>{title}</span>{' '}<span>{money(total)}</span></div>
      {rows.length > 0 ? <div className="overflow-auto pl-scroll" style={{ maxHeight: 240 }}><table className="w-full text-[11px]">
        <thead><tr style={{ color: SUB }}><th className="py-1 text-left">Bill / vendor</th><th className="px-2 py-1 text-left">Category</th><th className="px-2 py-1 text-left whitespace-nowrap">Paid on</th><th className="py-1 text-right">Applied</th></tr></thead>
        <tbody>{rows.map(function (b, i) { return <tr key={i} style={{ borderTop: '1px solid ' + LINE }}>
          <td className="py-1">{props.onOpenBill && b.bill_id ? <button type="button" onClick={function (ev) { ev.preventDefault(); ev.stopPropagation(); props.onOpenBill(b, f.payer); }} className="font-extrabold underline text-left" style={{ color: '#1d4ed8' }}>{'Open bill' + (b.bill_number ? ' ' + b.bill_number : '')}</button> : <b>{b.bill_number || '—'}</b>}<div>{b.vendor}</div></td>
          <td className="px-2 py-1">{catLabel(b.category)}</td><td className="px-2 py-1 whitespace-nowrap">{b.paid_date || '—'}</td><td className="py-1 text-right tabular-nums font-extrabold">{money(b.cents)}</td>
        </tr>; })}
        <tr style={{ borderTop: '2px solid ' + LINE, fontWeight: 800 }}><td colSpan={3} className="py-1 text-right">{listed === total ? 'These add up to' : 'Listed ' + money(listed) + ' of'}</td><td className="py-1 text-right tabular-nums">{money(total)}</td></tr></tbody>
      </table></div> : <div className="py-1" style={{ color: SUB }}>The Hub has no bill-payment links for these transfers in this period.</div>}
    </section>;
  }
  function row(label, value, treat, color, strong) { return <tr style={{ borderTop: '1px solid ' + LINE, fontWeight: strong ? 800 : 400, background: strong ? '#f1f5f9' : '#ffffff' }}><td className="px-2 py-1">{label}</td><td className="px-2 py-1 text-right tabular-nums whitespace-nowrap">{value}</td><td className="px-2 py-1" style={{ color: color || SUB }}>{treat}</td></tr>; }
  return <div className="text-[11px] rounded" style={{ color: INK, border: '1px solid #93c5fd', background: '#ffffff' }}>
    <div className="px-2 py-1.5 font-extrabold" style={{ background: '#dbeafe', color: '#1e3a8a' }}>{f.payer + ' — funds, ' + p.from + ' → ' + p.to}</div>
    {rtmFee ? <div className="px-2 py-1.5" style={{ color: SUB }}><b style={{ color: INK }}>Professional Fees in this P&amp;L {money(p.fee_deduction_cents)}</b><div>{p.provisional_fee_cents > 0 ? 'Includes ' + money(p.provisional_fee_cents) + ' in RTM funding pending allocation to bills.' : p.provisional_fee_cents < 0 ? 'Includes a ' + money(-p.provisional_fee_cents) + ' reduction for allocations and adjustments to prior funding.' : 'The report uses the recorded RTM fees.'}</div></div> : null}
    {billList('Bills linked to transfers', f.applied_rows, p.applied_cents)}
    {fromStartingBalance.length > 0 ? billList('Bills paid from the starting balance', fromStartingBalance, p.from_starting_balance_cents) : null}
    {unlinked.length > 0 ? billList('Paid through ' + f.payer + ' — source transfer not named, to link', unlinked, f.unlinked_cents) : null}
    {!noBillRows ? <div className="px-2 py-1" style={{ color: SUB }}>Applied amounts show what was paid toward each bill. Open a bill to see its full amount and document. Check the sale or release for when that cost enters the margin.</div> : null}

    {/* v55.83-ZP (Max 26 Nov: "isnt the 76000 linked to bills so it was sent and spent toward ktc bills") */}
    {periodNoBillsLinked(p) && <div className="px-2 py-1.5" style={{ background: '#fef3c7' }}>
      <button type="button" onClick={function (ev) { ev.preventDefault(); ev.stopPropagation(); openFundsToLink(f.payer); }} className="px-2 py-0.5 rounded font-extrabold" style={{ background: '#92400e', color: '#ffffff' }}>Link the bills it paid</button></div>}
    <details open={noBillRows ? true : undefined}><summary className="px-2 py-1.5 font-extrabold" style={{ cursor: 'pointer', color: '#1d4ed8' }}>{'▸ The transfers sent in these dates (' + f.transfers.length + ') — ' + money(p.funds_sent_cents)}</summary>
      {f.transfers.length === 0 ? <div className="px-2 py-1.5" style={{ color: SUB }}>No money was sent in these dates.</div> : <div className="overflow-auto pl-scroll" style={{ maxHeight: 220 }}><table className="w-full text-[11px]"><tbody>{f.transfers.map(function (t, i) { return <tr key={t.id || i} style={{ borderTop: '1px solid ' + LINE }}><td className="px-2 py-1 whitespace-nowrap">{t.date}</td><td className="px-2 py-1">{String(t.who || 'bank transfer').substring(0, 70)}</td>
        <td className="px-2 py-1" style={{ color: t.marked ? SUB : '#b45309' }}>{t.marked ? 'confirmed — ' + f.payer : <span>not confirmed{props.onConfirm && t.id ? <button onClick={function (ev) { ev.preventDefault(); ev.stopPropagation(); props.onConfirm(t, f.payer); }} className="ml-1 px-1.5 rounded font-extrabold" style={{ background: '#1d4ed8', color: '#ffffff' }} title={'Record that this transfer is money sent to ' + f.payer}>{'Confirm: sent to ' + f.payer}</button> : null}</span>}</td>
        <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap">{money(t.cents)}</td></tr>; })}</tbody></table></div>}</details>
    <details><summary className="px-2 py-1.5 font-extrabold" style={{ cursor: 'pointer', color: '#1d4ed8' }}>Reconciliation details</summary>
    <table className="w-full text-[11px]"><thead><tr style={{ color: SUB }}><th className="px-2 py-1 text-left font-bold">In these dates</th><th className="px-2 py-1 text-right font-bold">Amount</th><th className="px-2 py-1 text-left font-bold">In this P&L</th></tr></thead><tbody>
      {row('Held with ' + f.payer + ' at the start', money(p.opening_held_cents), 'Sent before these dates and not yet used. Not an expense.')}
      {row('+ Funds sent', money(p.funds_sent_cents), 'NOT an expense by itself.')}
      {p.starting_balance_added_cents ? row('+ Starting balance (held before the Hub, not money sent)', money(p.starting_balance_added_cents), 'NOT an expense. Recorded as of a date in these dates.') : null}
      {p.from_starting_balance_cents ? row('− Bills paid from the starting balance', money(p.from_starting_balance_cents), 'NOT deducted here (the bills count in their own categories). Tax report: a new expense when used, from 1 June 2026' + (p.tax_from_starting_balance_cents !== p.from_starting_balance_cents ? ' (' + money(p.tax_from_starting_balance_cents) + ' of it)' : '') + '.') : null}
      {row('− Applied to underlying bills', money(p.applied_cents), 'The linked bills are itemized above.')}
      {/* v55.83-ZP — the partner-fee bills inside that line: shown apart, counted ONCE (as the bill, in C · Partner fee), never again here */}
      {partnerFeeOfRows(f.applied_rows) > 0 ? row('    of which partner fee', money(partnerFeeOfRows(f.applied_rows)), 'Part of the line above, not added to it. Counted once, as the partner-fee bill, in C · Partner fee.') : null}
      {row('− Explicitly marked as services rendered (their fee)', money(p.fee_cents), 'DEDUCTED here, in A · Warehouse / Office.', '#7f1d1d')}
      {row('= Held with ' + f.payer + ' at the end', money(p.closing_held_cents), p.closing_held_cents < 0 ? 'More was used than was sent — needs reconciliation.' : rtmFee ? 'Cash balance for reference.' : 'Funds available for future bills or service fees.', p.closing_held_cents >= 0 ? '#065f46' : '#b91c1c', true)}
      {rtmFee && p.provisional_fee_cents !== 0 && row(p.provisional_fee_cents > 0 ? 'RTM provisional Professional Fees' : 'RTM provisional Professional Fees adjustment', money(p.provisional_fee_cents), 'Included under A · Warehouse / Office.', '#7f1d1d')}
      {row('Professional Fees included in the P&L', money(p.fee_deduction_cents), 'Net expense in A · Warehouse / Office.', '#7f1d1d', true)}
    </tbody></table>    <div className="px-2 py-1.5" style={{ background: '#f8fafc' }}>{f.explanation}</div>
    <div className="px-2 py-1" style={{ color: SUB }}>{f.today_words}</div>
    {f.unlinked_as_of_cents > 0 && <div className="px-2 py-1.5" style={{ background: '#fef3c7', color: '#92400e' }}>{'The held figure is overstated by ' + money(f.unlinked_as_of_cents) + ': that much of bills was paid through ' + f.payer + ' without naming which transfer it came from. Link those payments to their transfer and the held figure comes down.'}</div>}
    {f.needs_reconciliation && <div className="px-2 py-1.5 font-bold" style={{ background: '#fee2e2', color: '#991b1b' }}>Needs reconciliation: on some transfer more was used than was sent, or a fee names no transfer. Review the records before relying on the balance.</div>}
    {f.to_confirm_cents !== 0 && <div className="px-2 py-1.5 font-bold" style={{ background: '#fef3c7', color: '#92400e' }}>{'NOT CONFIRMED YET: ' + money(f.to_confirm_cents) + ' of the funds sent in these dates is recognised only from the bank’s own text (a transfer to the account of ' + f.payer + '). Open “The transfers” and press Confirm on each one that really is money sent to ' + f.payer + '. If one is not, give it its real category in All Transactions. Until then the figures of this period are provisional.'}</div>}
    {f.duplicates.length > 0 && <div className="px-2 py-1.5" style={{ background: '#f3e8ff', color: '#581c87' }}>{'The same bank transfer appears a second time as another bank line (' + f.duplicates.length + ' line' + (f.duplicates.length === 1 ? '' : 's') + ', ' + money(f.duplicates_cents) + '). The copy is counted nowhere — not as funds sent and not as an expense. Mark the copy as a duplicate in All Transactions.'}</div>}
    <details><summary className="px-2 py-1.5 font-extrabold" style={{ cursor: 'pointer', color: '#1d4ed8' }}>{'▸ Services rendered marked in these dates — ' + money(p.fee_cents) + ' (' + f.fee_rows.length + ')'}</summary>
      {f.fee_rows.length === 0 ? <div className="px-2 py-1.5" style={{ color: SUB }}>No services-rendered fees were recorded in these dates.</div> : <table className="w-full text-[11px]"><tbody>{f.fee_rows.map(function (r, i) { return <tr key={i} style={{ borderTop: '1px solid ' + LINE }}><td className="px-2 py-1 whitespace-nowrap">{r.date}</td><td className="px-2 py-1">{r.why}</td><td className="px-2 py-1" style={{ color: SUB }}>{r.transfer_date ? 'from the transfer of ' + r.transfer_date : 'names no transfer'}</td><td className="px-2 py-1 text-right tabular-nums font-extrabold">{money(r.cents)}</td></tr>; })}</tbody></table>}</details>
    </details>
  </div>;
}
