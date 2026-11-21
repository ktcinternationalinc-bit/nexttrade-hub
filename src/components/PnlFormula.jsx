// v55.83-VT — P&L by period: the formula of one row with its own numbers (Max, Nov 20 2026: "a breakdown of the pnl with the
// formula ... in a hover button so i understand what was used and not used").
// v55.83-WE (Max, Nov 20: "all of the underlying ... should have a link to see the underlying including taxes" · "not used in
// figures..should be able to click it and see underlying and fix it from right there") — every line that has something behind
// it opens: A / C / D / E and the NOT USED lines show their categories, each category opens to its bank lines (the category
// can be changed there), the RTM / NextTrade lines open the company panels, and the lines waiting for a cost jump to the list
// where they are fixed. Stateless: it shows what pnlFormula() returns; opening uses the browser's own <details>.
import React from 'react';
import FundsSent from './FundsSent'; // v55.83-VY
import ExpenseDetail from './ExpenseDetail'; // v55.83-WE

var INK = '#0f172a'; var SUB = '#475569'; var LINE = '#e2e8f0';
function money(c) { if (c === null || c === undefined) { return '—'; } var v = c / 100; return (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// props: title, formula ({ lines, not_used, notes, funding }), detail (expenseDetail() of the period, or null), picker(row),
//        catLabel(key), onConfirm, onOpenBill, onShowOpen() (jump to the period's list of things to fix), onClose, openAll (tests)
export default function PnlFormula(props) {
  var f = props.formula; if (!f) { return null; }
  var det = props.detail || null; var open = props.openAll === true || props.openA === true ? true : undefined;
  function fundingOf(key) { var mk = det && det.byKey ? det.byKey[key] : null; if (!mk || mk.funding_key === undefined) { return null; } return ((det.funding || []).filter(function (fu) { return fu.key === mk.funding_key; })[0]) || null; }
  // the categories behind a line; each one opens to what is behind IT
  function catList(cats) {
    if (!cats || !cats.length) { return <div className="text-[10px] py-1" style={{ color: SUB }}>Nothing in it.</div>; }
    return <div>{cats.map(function (c) { return <details key={c.key} open={props.openAll === true ? true : undefined} style={{ borderTop: '1px solid ' + LINE }}>
      <summary style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 8, padding: '2px 0' }}><span style={{ color: '#1d4ed8', textDecoration: 'underline' }}>{'▸ ' + c.label}</span><span className="tabular-nums">{money(c.cents)}</span></summary>
      {det ? <div style={{ background: '#f0f9ff', border: '1px solid #7dd3fc', padding: 4, marginBottom: 4 }}><ExpenseDetail makeup={det.byKey ? det.byKey[c.key] : null} rowsListed={det.rows_listed} picker={props.picker} funding={fundingOf(c.key)} catLabel={props.catLabel} onConfirm={props.onConfirm} onOpenBill={props.onOpenBill} /></div> : <div className="text-[10px]" style={{ color: SUB }}>The lines behind it are not loaded.</div>}
    </details>; })}</div>;
  }
  function companies() { var fu = f.funding || []; return fu.length ? fu.map(function (x) { return <div key={x.key} className="mt-1"><FundsSent funding={x} catLabel={props.catLabel} onConfirm={props.onConfirm} onOpenBill={props.onOpenBill} /></div>; }) : <div className="text-[10px]" style={{ color: SUB }}>No money was sent to RTM / NextTrade in these dates.</div>; }
  return <div style={{ background: '#ffffff', color: INK, border: '2px solid #0f172a', borderRadius: 10, boxShadow: '0 12px 32px rgba(15,23,42,0.35)', width: 600, maxWidth: '94vw', maxHeight: '86vh', overflow: 'auto' }}>
    <div className="px-3 py-2 flex items-center gap-2" style={{ background: '#0f172a', color: '#ffffff', fontWeight: 800, fontSize: 12 }}><span style={{ flex: 1 }}>{'How ' + (props.title || 'this row') + ' is worked out'}</span>{props.onClose ? <button onClick={props.onClose} aria-label="Close" style={{ color: '#ffffff', background: 'none', border: 0, fontWeight: 800, cursor: 'pointer' }}>✕</button> : null}</div>
    <div className="px-3 pt-2 font-extrabold text-[11px]" style={{ color: '#065f46' }}>USED in the figure <span style={{ color: SUB, fontWeight: 400 }}>— click a blue line to see what is behind it</span></div>
    <table className="w-full text-[11px]"><tbody>{f.lines.map(function (l, i) { return <tr key={i} style={{ borderTop: '1px solid ' + LINE, fontWeight: l.strong ? 800 : 400, background: l.strong ? '#f1f5f9' : '#ffffff' }}>
      <td className="pl-3 pr-1 py-1" style={{ width: 18, verticalAlign: 'top' }}>{l.sign}</td><td className="px-1 py-1">{l.cats ? <details open={open}><summary style={{ cursor: 'pointer', color: '#1d4ed8', fontWeight: 800 }}>{l.label + ' — click to see what is in it'}</summary>
        {catList(l.cats)}{/^A · /.test(l.label) ? companies() : null}</details> : l.label}</td><td className="pl-1 pr-3 py-1 text-right tabular-nums whitespace-nowrap" style={{ verticalAlign: 'top' }}>{money(l.cents)}</td></tr>; })}</tbody></table>
    <div className="px-3 pt-2 font-extrabold text-[11px]" style={{ color: '#b45309' }}>NOT USED in the figure <span style={{ color: SUB, fontWeight: 400 }}>— click a blue line to see it and fix it here</span></div>
    {f.not_used.length === 0 ? <div className="px-3 py-1 text-[11px]" style={{ color: SUB }}>Nothing was left out.</div> : <table className="w-full text-[11px]"><tbody>{f.not_used.map(function (x, i) { var can = !!(x.cats || x.funding || (x.open_list && props.onShowOpen)); return <tr key={i} style={{ borderTop: '1px solid ' + LINE }}>
      <td className="pl-3 pr-1 py-1">{x.cats || x.funding ? <details open={props.openAll === true ? true : undefined}><summary style={{ cursor: 'pointer', color: '#1d4ed8', fontWeight: 800 }}>{x.label + ' — click to see what is in it'}</summary>{x.cats ? catList(x.cats) : companies()}</details> : <span>{x.label}</span>}
        <div style={{ color: SUB, fontSize: 10 }}>{x.why}</div>{x.open_list && props.onShowOpen ? <button onClick={function (ev) { ev.stopPropagation(); props.onShowOpen(); }} className="mt-0.5 px-2 py-0.5 rounded font-extrabold" style={{ background: '#b45309', color: '#ffffff' }}>Show these lines and fix them →</button> : null}{can ? null : null}</td>
      <td className="pl-1 pr-3 py-1 text-right tabular-nums whitespace-nowrap" style={{ verticalAlign: 'top' }}>{money(x.cents)}</td></tr>; })}</tbody></table>}
    {/* v55.83-WY — customer balances today: noted here, never part of this figure or of the tax P&L */}
    {props.balancesBlock ? <div style={{ borderTop: '1px solid #e2e8f0' }}>{props.balancesBlock}</div> : null}
    <div className="px-3 py-2 text-[10px]" style={{ color: SUB }}>{f.notes.map(function (t, i) { return <div key={i}>{t}</div>; })}</div>
  </div>;
}
