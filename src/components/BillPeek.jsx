// v55.83-VY — a bill paid from RTM / NextTrade funds, opened on top of P&L by period (Codex 13:07: "Wire real bill opening and
// supporting-document access ... Max explicitly requested inspecting the underlying bills, not just a summary list").
// Stateless and read-only: it shows the bill facts that came with the funds calculation and opens the bill's own file through
// the handler passed in (the same private-link rule as the Bills screen — the storage rules decide who may open it).
import React from 'react';

var INK = '#0f172a'; var SUB = '#475569'; var LINE = '#e2e8f0';
function money(c) { if (c === null || c === undefined) { return '—'; } var v = c / 100; return (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// props: row (one applied row of expenseDetail().funding[].applied_rows), payer, onOpenDoc(path), onGoBills(), onClose()
export default function BillPeek(props) {
  var b = props.row; if (!b) { return null; }
  function line(k, v) { return <tr style={{ borderTop: '1px solid ' + LINE }}><td className="px-3 py-1" style={{ color: SUB, width: 210 }}>{k}</td><td className="px-3 py-1 font-semibold">{v}</td></tr>; }
  return <div role="dialog" aria-modal="true" aria-label={'Bill ' + (b.bill_number || '') + ' — ' + b.vendor} style={{ background: '#ffffff', color: INK, borderRadius: 12, border: '2px solid #0f172a', width: 520, maxWidth: '94vw', maxHeight: '88vh', overflow: 'auto', boxShadow: '0 16px 40px rgba(15,23,42,0.4)' }}>
    <div className="px-3 py-2 flex items-center gap-2 font-extrabold text-[13px]" style={{ background: '#0f172a', color: '#ffffff' }}><span style={{ flex: 1 }}>{'Bill ' + (b.bill_number || '(no number)') + ' — ' + b.vendor}</span><button onClick={props.onClose} aria-label="Close" style={{ color: '#ffffff', background: 'none', border: 0, fontWeight: 800, cursor: 'pointer' }}>✕</button></div>
    <table className="w-full text-[12px]"><tbody>
      {line('Vendor', b.vendor)}{line('Bill number', b.bill_number || '—')}{line('Bill date', b.bill_date || '—')}{line('Release', b.release || '—')}
      {line('Bill total', money(b.bill_total_cents))}
      {line('Paid from ' + (props.payer || 'these') + ' funds', money(b.cents) + (b.bill_total_cents !== null && b.bill_total_cents !== undefined && b.cents !== b.bill_total_cents ? ' (part of the bill)' : ''))}
      {line('Paid on', b.paid_date || '—')}{line('From the transfer of', b.transfer_date || '—')}
    </tbody></table>
    <div className="px-3 py-2 text-[11px]" style={{ color: SUB }}>Where and in which month this report counts the bill’s cost is not verified here. To see its lines, payments and history: Accounting → Bills → search this bill number.</div>
    <div className="px-3 py-2 flex gap-2 justify-end flex-wrap" style={{ borderTop: '1px solid ' + LINE }}>
      {b.attachment_path ? <button onClick={function () { props.onOpenDoc(b.attachment_path); }} className="px-3 py-1.5 rounded-lg text-[12px] font-extrabold" style={{ background: '#1d4ed8', color: '#ffffff' }}>Open the bill’s document ↗</button> : <span className="text-[11px] self-center" style={{ color: '#b45309' }}>No document is attached to this bill.</span>}
      {props.onGoBills ? <button onClick={props.onGoBills} className="px-3 py-1.5 rounded-lg text-[12px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>Go to Bills</button> : null}
      <button onClick={props.onClose} className="px-3 py-1.5 rounded-lg text-[12px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>Close</button>
    </div>
  </div>;
}
