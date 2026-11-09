'use client';
// v55.83-RQ — Max, Nov 9 21:10:
//  "Keep track of the qty of items received ... with amount of goods received. and amount of money paid for these"
//  "keep track of the qty of each item ..aggregating each like items and the total cost and total commission paid for each items"
//  "for other types of bills.. keep track of the service, amount and vendor and dates so we can assess the amount of charges
//   we have been billed and paid out over periods of times such as since june 1st and last week, month, quarter or custom
//   dates or last year."
import React, { useState, useEffect } from 'react';
import { REPORT_PERIODS } from '../lib/bill-lines';
import { BILL_TYPE_LABEL } from '../lib/bill-extract';

var INK = '#0f172a'; var SUB = '#334155'; var MUTED = '#64748b';
function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function qtyF(n) { return (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }); }

export default function BillReportsPanel(p) {
  var api = p.api;
  var s1 = useState('since_jun1'); var period = s1[0]; var setPeriod = s1[1];
  var s2 = useState({ from: '', to: '' }); var cust = s2[0]; var setCust = s2[1];
  var s3 = useState(null); var d = s3[0]; var setD = s3[1];
  var s4 = useState('type'); var view = s4[0]; var setView = s4[1];
  function load() {
    if (period === 'custom' && (!cust.from || !cust.to)) { return; }
    setD(null);
    api({ action: 'bill_reports', period: period, from: cust.from, to: cust.to }).then(function (j) { setD(j && j.ok ? j : { ok: false, error: (j && j.error) || 'Could not load the reports.' }); });
  }
  useEffect(function () { load(); }, [period, cust.from, cust.to]); // eslint-disable-line
  var inp = 'px-2 py-1 rounded-lg border text-[12px] nt-light'; var st = { color: INK, background: '#ffffff', borderColor: '#cbd5e1' };
  var sp = d && d.spend; var rows = sp ? (view === 'type' ? sp.by_type : view === 'vendor' ? sp.by_vendor : sp.by_service) : [];
  return <div className="nt-paper rounded-xl p-3 mb-3" style={{ border: '2px solid #86efac' }}>
    <div className="flex gap-2 items-center flex-wrap mb-2">
      <div className="text-[14px] font-extrabold" style={{ color: INK }}>📊 Bill reports</div>
      <select className={inp} style={st} value={period} onChange={function (e) { setPeriod(e.target.value); }}>{REPORT_PERIODS.map(function (x) { return <option key={x[0]} value={x[0]}>{x[1]}</option>; })}</select>
      {period === 'custom' && <span className="flex gap-1 items-center"><input type="date" className={inp} style={st} value={cust.from} onChange={function (e) { setCust(Object.assign({}, cust, { from: e.target.value })); }} /><span style={{ color: SUB }}>→</span><input type="date" className={inp} style={st} value={cust.to} onChange={function (e) { setCust(Object.assign({}, cust, { to: e.target.value })); }} /></span>}
      {d && d.range && <span className="text-[11px]" style={{ color: MUTED }}>{d.range.from + ' → ' + d.range.to + ' (billed = bill date in the period; paid = payments made in the period)'}</span>}
      <div className="flex-1" />
      <button onClick={p.onClose} className="px-3 py-1 rounded-lg text-[12px] font-bold" style={{ background: '#ffffff', color: SUB, border: '1px solid #cbd5e1' }}>✕ Close</button>
    </div>
    {!d && <div className="text-[12px]" style={{ color: MUTED }}>{period === 'custom' && (!cust.from || !cust.to) ? 'Pick both dates.' : 'Loading…'}</div>}
    {d && !d.ok && <div className="text-[12px] font-bold" style={{ color: '#7f1d1d' }}>{d.error}</div>}
    {d && d.ok && <div>
      {/* products from commission vendors */}
      <div className="text-[13px] font-extrabold mb-1" style={{ color: INK }}>{'📦 Products received — ' + (d.commission_vendors || []).map(function (c) { return c.vendor; }).join(', ') + ' bills (like items added together)'}</div>
      {d.commission_bills_without_lines > 0 && <div className="text-[11px] mb-1 font-bold" style={{ color: '#92400e' }}>{d.commission_bills_without_lines + ' bill(s) in this period have no lines yet, so their products are not counted — open them and add the lines (or re-import).'}</div>}
      <div className="overflow-x-auto rounded-lg mb-3" style={{ border: '1px solid #e2e8f0' }}><table className="w-full text-[12px]">
        <thead><tr style={{ background: '#f1f5f9', color: SUB }}><th className="px-2 py-1.5 text-left">Product</th><th className="px-2 py-1.5 text-right">Qty received</th><th className="px-2 py-1.5 text-left">Unit</th>
          <th className="px-2 py-1.5 text-right">Avg cost / unit</th><th className="px-2 py-1.5 text-right">Actual cost</th><th className="px-2 py-1.5 text-right">Commission</th><th className="px-2 py-1.5 text-right">Total billed</th><th className="px-2 py-1.5 text-right">Paid so far</th><th className="px-2 py-1.5 text-right">Bills</th></tr></thead>
        <tbody style={{ color: INK }}>
          {(d.inventory || []).map(function (r) {
            return <tr key={r.item_key + '|' + r.unit} style={{ borderTop: '1px solid #f1f5f9' }}>
              <td className="px-2 py-1.5 font-bold">{r.item}</td><td className="px-2 py-1.5 text-right tabular-nums">{qtyF(r.qty)}</td><td className="px-2 py-1.5">{r.unit || ''}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{r.avg_cost != null ? '$' + Number(r.avg_cost).toLocaleString('en-US', { maximumFractionDigits: 4 }) : '—'}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">${fmt(r.cost)}</td><td className="px-2 py-1.5 text-right tabular-nums" style={{ color: '#92400e' }}>${fmt(r.commission)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums font-extrabold">${fmt(r.billed)}</td><td className="px-2 py-1.5 text-right tabular-nums">${fmt(r.paid)}</td><td className="px-2 py-1.5 text-right">{r.bills}</td></tr>;
          })}
          {(d.inventory || []).length === 0 && <tr><td colSpan={9} className="px-3 py-3 text-center" style={{ color: MUTED }}>No products in this period.</td></tr>}
          {(d.inventory || []).length > 0 && <tr style={{ borderTop: '2px solid #cbd5e1', background: '#f8fafc' }}><td className="px-2 py-1.5 font-extrabold" colSpan={4}>Totals</td>
            <td className="px-2 py-1.5 text-right font-extrabold tabular-nums">${fmt(d.inventory_totals.cost)}</td><td className="px-2 py-1.5 text-right font-extrabold tabular-nums" style={{ color: '#92400e' }}>${fmt(d.inventory_totals.commission)}</td>
            <td className="px-2 py-1.5 text-right font-extrabold tabular-nums">${fmt(d.inventory_totals.billed)}</td><td className="px-2 py-1.5 text-right font-extrabold tabular-nums">${fmt(d.inventory_totals.paid)}</td><td /></tr>}
        </tbody></table></div>
      <div className="text-[11px] mb-3" style={{ color: MUTED }}>“Paid so far” = each product’s share of what has been paid on its bill.</div>

      {/* charges & services */}
      <div className="flex gap-2 items-center flex-wrap mb-1">
        <div className="text-[13px] font-extrabold" style={{ color: INK }}>{'🚚 Charges & services billed — $' + fmt(sp.totals.billed) + ' billed · $' + fmt(sp.totals.paid) + ' paid · ' + sp.totals.bills + ' bill(s)'}</div>
        <div className="flex-1" />
        {[['type', 'by type'], ['vendor', 'by vendor'], ['service', 'by service']].map(function (v) { var on = view === v[0]; return <button key={v[0]} onClick={function () { setView(v[0]); }} className="px-2 py-1 rounded text-[11px] font-extrabold" style={on ? { background: '#14532d', color: '#ffffff' } : { background: '#f0fdf4', color: '#14532d', border: '1px solid #86efac' }}>{v[1]}</button>; })}
      </div>
      <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid #e2e8f0' }}><table className="w-full text-[12px]">
        <thead><tr style={{ background: '#f1f5f9', color: SUB }}><th className="px-2 py-1.5 text-left">{view === 'type' ? 'Type' : view === 'vendor' ? 'Vendor' : 'Service / charge'}</th>{view !== 'type' && <th className="px-2 py-1.5 text-left">Type</th>}
          <th className="px-2 py-1.5 text-right">Billed</th><th className="px-2 py-1.5 text-right">Paid</th><th className="px-2 py-1.5 text-right">{view === 'service' ? 'Lines' : 'Bills'}</th>{view !== 'service' && <th className="px-2 py-1.5 text-left">First → last bill</th>}</tr></thead>
        <tbody style={{ color: INK }}>
          {rows.map(function (r) {
            return <tr key={r.key} style={{ borderTop: '1px solid #f1f5f9' }}>
              <td className="px-2 py-1.5 font-bold">{view === 'type' ? (BILL_TYPE_LABEL[r.key] || '❔ type not set yet') : r.label}</td>{view !== 'type' && <td className="px-2 py-1.5">{BILL_TYPE_LABEL[r.type] || '—'}</td>}
              <td className="px-2 py-1.5 text-right tabular-nums">${fmt(r.billed)}</td><td className="px-2 py-1.5 text-right tabular-nums">${fmt(r.paid)}</td><td className="px-2 py-1.5 text-right">{r.bills}</td>
              {view !== 'service' && <td className="px-2 py-1.5" style={{ color: MUTED }}>{r.first ? r.first + ' → ' + r.last : '—'}</td>}</tr>;
          })}
          {rows.length === 0 && <tr><td colSpan={6} className="px-3 py-3 text-center" style={{ color: MUTED }}>Nothing billed or paid in this period.</td></tr>}
        </tbody></table></div>
    </div>}
  </div>;
}
