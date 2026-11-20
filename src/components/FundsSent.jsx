// v55.83-VW — P&L by period: money sent to RTM / NextTrade in the period and what became of it (Max, Nov 20 2026, through
// Codex: "Click an RTM / NextTrade professional-fee component to see original transfers, underlying bill allocations, explicit
// services-rendered fees, and unused funds" · "Only explicit Services rendered designation creates that fee expense").
// Stateless (the two lists open with the browser's own <details>): it shows one entry of expenseDetail().funding.
import React from 'react';

var INK = '#0f172a'; var SUB = '#475569'; var LINE = '#e2e8f0';
function money(c) { if (c === null || c === undefined) { return '—'; } var v = c / 100; return (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// props: funding (one company's summary), catLabel(key) → the category's name, onOpenBill(billId) (optional)
export default function FundsSent(props) {
  var f = props.funding; if (!f) { return null; }
  var catLabel = props.catLabel || function (k) { return k; };
  var who = f.payer + (f.era_note ? ' (' + f.era_note + ')' : '');
  function row(label, value, treat, color, strong) { return <tr style={{ borderTop: '1px solid ' + LINE, fontWeight: strong ? 800 : 400, background: strong ? '#f1f5f9' : '#ffffff' }}><td className="px-2 py-1">{label}</td><td className="px-2 py-1 text-right tabular-nums whitespace-nowrap">{value}</td><td className="px-2 py-1" style={{ color: color || SUB }}>{treat}</td></tr>; }
  return <div className="text-[11px] rounded" style={{ color: INK, border: '1px solid #93c5fd', background: '#ffffff' }}>
    <div className="px-2 py-1.5 font-extrabold" style={{ background: '#dbeafe', color: '#1e3a8a' }}>{who + ' — ' + money(f.sent_cents) + ' funds sent in these dates'}</div>
    <table className="w-full text-[11px]"><thead><tr style={{ color: SUB }}><th className="px-2 py-1 text-left font-bold">What became of it</th><th className="px-2 py-1 text-right font-bold">Amount</th><th className="px-2 py-1 text-left font-bold">In this P&L</th></tr></thead><tbody>
      {row('Applied to underlying bills', money(f.applied_cents), 'NOT deducted here. Each bill is counted once, under its own category.')}
      {row('Explicitly marked as services rendered (their fee)', money(f.fee_cents), 'DEDUCTED here, in A · Warehouse / Office.', '#7f1d1d')}
      {f.advance_held_cents !== 0 && row('Advance held (split off by a person)', money(f.advance_held_cents), 'Not an expense.')}
      {f.unused_cents >= 0 ? row('Unused / awaiting allocation', money(f.unused_cents), 'NOT an expense. It stays with ' + f.payer + ' for future bills, or until someone marks it as services rendered.', '#065f46')
        : row('Paid from funds sent BEFORE these dates', money(-f.unused_cents), 'No new money left the bank for it in these dates; it came out of what ' + f.payer + ' already held. Not an expense by itself — the bills are counted in their own categories.', '#065f46')}
      {row('Total funds accounted for', money(f.applied_cents + f.fee_cents + f.advance_held_cents + f.unused_cents), f.applied_cents + f.fee_cents + f.advance_held_cents + f.unused_cents === f.sent_cents ? 'Adds up to the funds sent.' : 'Does NOT add up to the funds sent — tell Claude.', null, true)}
      {row('Professional-fee deduction included here', money(f.fee_cents), 'Only this amount reduces profit.', '#7f1d1d', true)}
    </tbody></table>
    <div className="px-2 py-1.5" style={{ background: '#f8fafc' }}>{'Only ' + money(f.fee_cents) + ' is deducted here as a professional fee. The ' + money(f.applied_cents) + ' applied to underlying bills is not deducted again here; those costs are counted in their own categories. ' + (f.unused_cents >= 0 ? 'The unused ' + money(f.unused_cents) + ' does not reduce profit.' : money(-f.unused_cents) + ' of those bills was paid from funds sent in earlier periods.')}</div>
    {f.unmarked_cents !== 0 && <div className="px-2 py-1.5" style={{ background: '#fef3c7', color: '#92400e' }}>{money(f.unmarked_cents) + ' of this is recognised only from the bank’s own text (a transfer to the account of ' + f.payer + '); nobody has marked those lines with the company yet. If one of them is not money sent to ' + f.payer + ', give it its real category in All Transactions.'}</div>}
    <details><summary className="px-2 py-1.5 font-extrabold" style={{ cursor: 'pointer', color: '#1d4ed8' }}>{'▸ The transfers (' + f.lines.length + ') — ' + money(f.sent_cents)}</summary>
      <div className="overflow-auto pl-scroll" style={{ maxHeight: 220 }}><table className="w-full text-[11px]"><tbody>{f.lines.map(function (t, i) { return <tr key={t.id || i} style={{ borderTop: '1px solid ' + LINE }}><td className="px-2 py-1 whitespace-nowrap">{t.date}</td><td className="px-2 py-1">{String(t.who || 'bank transfer').substring(0, 70)}</td><td className="px-2 py-1" style={{ color: t.marked ? SUB : '#b45309' }}>{t.marked ? 'marked ' + f.payer : 'not marked — recognised by the account'}</td><td className="px-2 py-1 text-right tabular-nums whitespace-nowrap">{money(t.cents)}</td></tr>; })}</tbody></table></div></details>
    <details><summary className="px-2 py-1.5 font-extrabold" style={{ cursor: 'pointer', color: '#1d4ed8' }}>{'▸ Applied to underlying bills — ' + money(f.applied_cents) + ' (' + f.bills.length + ' payment' + (f.bills.length === 1 ? '' : 's') + ')'}</summary>
      {f.bills.length === 0 ? <div className="px-2 py-1.5" style={{ color: SUB }}>No bill was paid from these funds in these dates.</div> : <div className="overflow-auto pl-scroll" style={{ maxHeight: 260 }}><table className="w-full text-[11px]">
        <thead><tr style={{ color: SUB }}>{['Paid', 'Vendor', 'Bill #', 'Bill date', 'Release', 'Counted under', 'Bill total', 'Paid from these funds'].map(function (h, i) { return <th key={i} className={'px-2 py-1 font-bold ' + (i >= 6 ? 'text-right' : 'text-left')}>{h}</th>; })}</tr></thead>
        <tbody>{f.bills.map(function (b, i) { return <tr key={i} style={{ borderTop: '1px solid ' + LINE }}><td className="px-2 py-1 whitespace-nowrap">{b.date}</td><td className="px-2 py-1 font-semibold">{String(b.who).substring(0, 50)}</td><td className="px-2 py-1">{b.ref}</td><td className="px-2 py-1 whitespace-nowrap">{b.bill_date || '—'}</td><td className="px-2 py-1">{b.release || '—'}</td><td className="px-2 py-1">{catLabel(b.category)}</td><td className="px-2 py-1 text-right tabular-nums">{money(b.bill_total_cents)}</td><td className="px-2 py-1 text-right tabular-nums font-extrabold">{money(b.cents)}</td></tr>; })}
          <tr style={{ borderTop: '2px solid ' + LINE, fontWeight: 800 }}><td colSpan={7} className="px-2 py-1 text-right">{f.bills_listed_cents === f.applied_cents ? 'These add up to' : 'Listed ' + money(f.bills_listed_cents) + ' of'}</td><td className="px-2 py-1 text-right tabular-nums">{money(f.applied_cents)}</td></tr></tbody></table></div>}
      <div className="px-2 py-1 text-[10px]" style={{ color: SUB }}>The amount on each row is the part of the bill paid from these funds, not the whole bill. Each bill’s cost is counted where its category puts it (goods and shipping bills inside goods / transport profit — by the category’s name, not checked bill by bill).</div></details>
  </div>;
}
