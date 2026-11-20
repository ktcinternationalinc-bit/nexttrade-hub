'use client';
// v55.83-VR — Inbound trucking tracker (Max, Nov 19 2026). Shows only what it is given: no loading, no saving.
// Kronos freight against the pounds received on the same load number, and the real cost per pound next to the standard $0.02.
// TRACKING ONLY — the screen says so in plain words: profit keeps using the standard allowance until Max asks for the switch.
import React, { useState } from 'react';

var INK = '#0f172a'; var SUB = '#475569'; var LINE = '#cbd5e1';
function usd(c) { var n = Math.abs((Number(c) || 0) / 100); return (c < 0 ? '−$' : '$') + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function lbs(p) { return p === null || p === undefined ? '—' : Math.round(p).toLocaleString('en-US'); }
function rate(r) { return r === null || r === undefined ? '—' : '$' + Number(r).toFixed(4); }
export function statusWords(L) { return L.status === 'matched' ? 'matched' : (L.status === 'no_goods_bill' ? 'no goods bill found' : (L.status === 'shared_goods_bill' ? 'goods bill covers several loads' : 'pounds not known')); }
export function fixWords(L) { return L.status === 'no_goods_bill' ? 'put ' + L.load + ' in its “Other reference” box.' : (L.status === 'shared_goods_bill' ? '' : 'give every goods line a quantity and a unit (LBS or YDS).'); }

export default function InboundTruckingView(props) {
  var r = props.report; var [open, setOpen] = useState(null);
  if (props.error) { return <div className="rounded-lg p-3 text-[12px] font-bold" style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fca5a5' }}>{props.error} {props.onReload && <button onClick={props.onReload} className="ml-2 px-2 py-1 rounded font-extrabold" style={{ background: '#991b1b', color: '#ffffff' }}>Try again</button>}</div>; }
  if (!r) { return <div className="text-[12px]" style={{ color: SUB }}>{props.busy ? 'Loading the Kronos bills…' : 'Nothing loaded yet.'}</div>; }
  var t = r.totals; var th = { background: INK, color: '#ffffff' };
  function card(title, s, note) {
    return <div className="rounded-lg p-2.5" style={{ background: '#ffffff', border: '1px solid ' + LINE, minWidth: 190 }}>
      <div className="text-[10px] font-extrabold uppercase" style={{ color: SUB }}>{title}</div>
      <div className="text-[20px] font-extrabold" style={{ color: INK }}>{rate(s.per_lb)}<span className="text-[11px] font-bold" style={{ color: SUB }}> per lb</span></div>
      <div className="text-[11px]" style={{ color: SUB }}>{s.loads + ' load(s) · ' + usd(s.freight_cents) + ' · ' + lbs(s.pounds) + ' lb'}</div>
      {note && <div className="text-[10px]" style={{ color: SUB }}>{note}</div>}
    </div>;
  }
  var problems = (r.loads || []).filter(function (L) { return L.status !== 'matched'; });
  return <div>
    <div className="rounded-lg p-2.5 mb-2 text-[12px] font-bold" style={{ background: '#fffbeb', color: '#78350f', border: '1px solid #fcd34d' }}>
      Tracking only. Goods profit still uses the standard {'$' + Number(r.standard_per_lb).toFixed(2)} per pound for inbound trucking. The real Kronos cost below is not used in any profit figure until you ask for the switch.
    </div>
    <div className="flex gap-2 flex-wrap mb-2">
      {card('Real cost — all matched loads', t.all, 'standard on the same pounds: ' + usd(r.standard_cents) + ' · difference ' + usd(r.difference_cents))}
      {card('Regular loads', t.regular)}
      {card('Bonded loads', t.bonded)}
      <div className="rounded-lg p-2.5" style={{ background: '#ffffff', border: '1px solid ' + LINE, minWidth: 190 }}>
        <div className="text-[10px] font-extrabold uppercase" style={{ color: SUB }}>Not in the average</div>
        <div className="text-[12px] font-bold" style={{ color: (t.open_loads > 0 || (r.unmatched_lines || []).length > 0) ? '#b45309' : '#065f46' }}>{t.open_loads + ' load(s) without pounds · ' + usd(t.open_cents)}</div>
        <div className="text-[12px] font-bold" style={{ color: (r.unmatched_lines || []).length > 0 ? '#b45309' : '#065f46' }}>{(r.unmatched_lines || []).length + ' line(s) without a load number · ' + usd(t.unmatched_cents)}</div>
        <div className="text-[10px]" style={{ color: SUB }}>{'All Kronos freight tracked: ' + usd(t.tracked_cents)}</div>
      </div>
    </div>
    <div className="text-[11px] mb-1" style={{ color: SUB }}>
      {'Bills dated ' + (r.from || 'the start') + ' → ' + (r.to || 'today') + '. Pounds come from the supplier bills with the same load number; yards are counted at ' + (props.yardPounds || 2.5) + ' lb (headliner 1.25, foam 3). Click a load to see its bills.'}
    </div>
    <div style={{ overflowX: 'auto', border: '1px solid ' + LINE, borderRadius: 8 }}>
      <table className="w-full text-[12px]" style={{ borderCollapse: 'collapse', background: '#ffffff', color: INK }}>
        <thead><tr>{['Load number', 'Bill date', 'Kind', 'Kronos freight', 'Pounds received', 'Real cost per lb', 'Standard ($' + Number(r.standard_per_lb).toFixed(2) + ')', 'Status'].map(function (h, i) { return <th key={i} className="px-2 py-1.5 text-left font-extrabold" style={th}>{h}</th>; })}</tr></thead>
        <tbody>
          {(r.loads || []).length === 0 && <tr><td colSpan={8} className="px-2 py-3" style={{ color: SUB }}>No Kronos freight with a load number in these dates.</td></tr>}
          {(r.loads || []).map(function (L) {
            var isOpen = open === L.load; var bad = L.status !== 'matched';
            return <React.Fragment key={L.load}>
              <tr onClick={function () { setOpen(isOpen ? null : L.load); }} style={{ cursor: 'pointer', borderTop: '1px solid ' + LINE, background: bad ? '#fffbeb' : '#ffffff' }}>
                <td className="px-2 py-1.5 font-extrabold">{(isOpen ? '▾ ' : '▸ ') + L.load}</td>
                <td className="px-2 py-1.5">{L.first_date}</td>
                <td className="px-2 py-1.5">{L.bonded ? 'Bonded' : 'Regular'}</td>
                <td className="px-2 py-1.5">{usd(L.freight_cents)}</td>
                <td className="px-2 py-1.5">{lbs(L.pounds)}</td>
                <td className="px-2 py-1.5 font-extrabold">{rate(L.per_lb)}</td>
                <td className="px-2 py-1.5">{L.pounds ? usd(Math.round(L.pounds * r.standard_per_lb * 100)) : '—'}</td>
                <td className="px-2 py-1.5 font-bold" style={{ color: bad ? '#b45309' : '#065f46' }}>{statusWords(L)}</td>
              </tr>
              {isOpen && <tr><td colSpan={8} className="px-3 py-2" style={{ background: '#f8fafc', borderTop: '1px solid ' + LINE }}>
                {bad && <div className="font-bold mb-1" style={{ color: '#b45309' }}>{'Why it is not in the average: ' + L.why + '. ' + (L.status === 'shared_goods_bill' ? 'The bill is correct as it is — leave it unchanged. This load stays out of the average until the weight of each load can be recorded.' : 'To fix: open Accounting → Bills, find the supplier bill for this load and ' + fixWords(L))}</div>}
                <div className="font-extrabold">Kronos freight</div>
                {L.lines.map(function (f) { return <div key={f.line_id}>{f.vendor + ' · bill ' + f.bill_number + ' · ' + f.bill_date + ' · ' + usd(f.cents) + ' · ' + f.description}</div>; })}
                <div className="font-extrabold mt-1">Goods received on this load</div>
                {L.older_goods_bills > 0 && <div style={{ color: SUB }}>{L.older_goods_bills + ' older bill(s) not shown (before the dates you may see); their pounds are counted'}</div>}
                {L.goods_bills.length === 0 ? (L.older_goods_bills > 0 ? null : <div style={{ color: SUB }}>none found</div>) : L.goods_bills.map(function (g) { return <div key={g.bill_id}>{g.vendor + ' · bill ' + g.bill_number + ' · ' + g.bill_date + ' · ' + lbs(g.pounds) + ' lb' + (g.unknown_lines ? ' · ' + g.unknown_lines + ' line(s) without pounds' : '')}</div>; })}
              </td></tr>}
            </React.Fragment>;
          })}
        </tbody>
      </table>
    </div>
    {problems.length > 0 && <div className="text-[11px] mt-1 font-bold" style={{ color: '#b45309' }}>{problems.length + ' load(s) are amber: click one to see why and how to fix it.'}</div>}
    {(r.unmatched_lines || []).length > 0 && <div className="mt-2 rounded-lg p-2.5" style={{ background: '#fffbeb', border: '1px solid #fcd34d', color: INK }}>
      <div className="text-[12px] font-extrabold" style={{ color: '#78350f' }}>{'Kronos lines without a load number (' + usd(t.unmatched_cents) + ') — not in the average'}</div>
      <div className="text-[11px] mb-1" style={{ color: '#78350f' }}>To fix: open Accounting → Bills, open the bill, and add the 8-digit load number to the line’s description.</div>
      {r.unmatched_lines.map(function (f) { return <div key={f.line_id} className="text-[11px]">{f.vendor + ' · bill ' + f.bill_number + ' · ' + f.bill_date + ' · ' + usd(f.cents) + ' · ' + f.description + ' — ' + f.why}</div>; })}
    </div>}
    {(r.not_counted || []).length > 0 && <div className="mt-2 text-[11px]" style={{ color: SUB }}>
      <b>Kronos invoices also charged on a supplier bill:</b> {r.not_counted.map(function (f) { return 'bill ' + f.bill_number + ' ' + usd(f.cents) + (f.line_count > 1 ? ' in ' + f.line_count + ' lines' : '') + ' (' + f.why + (f.amount_differs === true ? '; the supplier charged ' + usd(f.replacement_in_cents + f.replacement_outside_cents) : '') + ')'; }).join(' · ')}
      {t.not_counted_outside_cents > 0 && <div className="font-bold" style={{ color: '#b45309' }}>{usd(t.not_counted_outside_cents) + ' of this is not in this report’s figures — it is counted on bills dated outside these dates.'}</div>}
      {t.several_rebills > 0 && <div style={{ color: '#b45309' }}>{t.several_rebills + ' of these are named on more than one supplier line. The lines are added up as parts of the invoice; if one is the same charge billed twice, this report cannot tell — check the supplier bills.'}</div>}
      {t.not_counted_hidden > 0 && <div style={{ color: SUB }}>{t.not_counted_hidden + ' of these are re-billed on a bill that is not shown; that amount is not given.'}</div>}
    </div>}
  </div>;
}
