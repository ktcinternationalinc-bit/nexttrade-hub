// v55.83-VT — P&L by period: the formula of one row with its own numbers (Max, Nov 20 2026: "a breakdown of the pnl with the
// formula ... in a hover button so i understand what was used and not used"). Stateless: it shows what pnlFormula() returns.
import React from 'react';

var INK = '#0f172a'; var SUB = '#475569'; var LINE = '#e2e8f0';
function money(c) { if (c === null || c === undefined) { return '—'; } var v = c / 100; return (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// props: title, formula ({ lines, not_used, notes }), onClose (optional — shown as ✕ when the panel is pinned)
export default function PnlFormula(props) {
  var f = props.formula; if (!f) { return null; }
  return <div style={{ background: '#ffffff', color: INK, border: '2px solid #0f172a', borderRadius: 10, boxShadow: '0 12px 32px rgba(15,23,42,0.35)', width: 460, maxWidth: '94vw', maxHeight: '86vh', overflow: 'auto' }}>
    <div className="px-3 py-2 flex items-center gap-2" style={{ background: '#0f172a', color: '#ffffff', fontWeight: 800, fontSize: 12 }}><span style={{ flex: 1 }}>{'How ' + (props.title || 'this row') + ' is worked out'}</span>{props.onClose ? <button onClick={props.onClose} aria-label="Close" style={{ color: '#ffffff', background: 'none', border: 0, fontWeight: 800, cursor: 'pointer' }}>✕</button> : null}</div>
    <div className="px-3 pt-2 font-extrabold text-[11px]" style={{ color: '#065f46' }}>USED in the figure</div>
    <table className="w-full text-[11px]"><tbody>{f.lines.map(function (l, i) { return <tr key={i} style={{ borderTop: '1px solid ' + LINE, fontWeight: l.strong ? 800 : 400, background: l.strong ? '#f1f5f9' : '#ffffff' }}>
      <td className="pl-3 pr-1 py-1" style={{ width: 18 }}>{l.sign}</td><td className="px-1 py-1">{l.label}</td><td className="pl-1 pr-3 py-1 text-right tabular-nums whitespace-nowrap">{money(l.cents)}</td></tr>; })}</tbody></table>
    <div className="px-3 pt-2 font-extrabold text-[11px]" style={{ color: '#b45309' }}>NOT USED in the figure</div>
    {f.not_used.length === 0 ? <div className="px-3 py-1 text-[11px]" style={{ color: SUB }}>Nothing was left out.</div> : <table className="w-full text-[11px]"><tbody>{f.not_used.map(function (x, i) { return <tr key={i} style={{ borderTop: '1px solid ' + LINE }}>
      <td className="pl-3 pr-1 py-1">{x.label}<div style={{ color: SUB, fontSize: 10 }}>{x.why}</div></td><td className="pl-1 pr-3 py-1 text-right tabular-nums whitespace-nowrap">{money(x.cents)}</td></tr>; })}</tbody></table>}
    <div className="px-3 py-2 text-[10px]" style={{ color: SUB }}>{f.notes.map(function (t, i) { return <div key={i}>{t}</div>; })}</div>
  </div>;
}
