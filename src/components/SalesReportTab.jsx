'use client';
// v55.83-ON — Accounting > Sales Report (Max, Oct 11): what we sold, by product
// and by customer, for a period (default June 1, 2026 onward) — quantities,
// revenue, AVERAGE PRICE per product, shipping separated. Click a customer to
// see exactly which products they bought and at what average price.
import React, { useState, useEffect } from 'react';

function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function SalesReportTab(props) {
  var userProfile = props.userProfile;
  var toast = props.toast || { success: function () {}, error: function () {} };
  var s1 = useState('2026-06-01'); var from = s1[0]; var setFrom = s1[1];
  var s2 = useState(''); var to = s2[0]; var setTo = s2[1];
  var s3 = useState(null); var data = s3[0]; var setData = s3[1];
  var s4 = useState(false); var busy = s4[0]; var setBusy = s4[1];
  var s5 = useState('Jun 1 →'); var preset = s5[0]; var setPreset = s5[1];
  var s6 = useState(null); var openCust = s6[0]; var setOpenCust = s6[1];

  function iso(d) { return d.toISOString().substring(0, 10); }
  function agoDays(n) { var d = new Date(); d.setDate(d.getDate() - n); return iso(d); }
  var PRESETS = [
    ['Jun 1 →', '2026-06-01', ''],
    ['Last month', agoDays(30), ''],
    ['Last 3 months', agoDays(90), ''],
    ['This year', '2026-01-01', ''],
    ['2025', '2025-01-01', '2025-12-31'],
    ['All history', '', '']
  ];

  function load(f, t) {
    setBusy(true); setOpenCust(null);
    fetch('/api/accounting/sales-report', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userProfile && userProfile.id, date_from: f || null, date_to: t || null }) })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (!j || j.ok !== true) { toast.error((j && j.error) || 'Report failed'); return; } setData(j); })
      .catch(function (e) { toast.error('Report failed: ' + ((e && e.message) || 'network')); })
      .finally(function () { setBusy(false); });
  }
  useEffect(function () { load('2026-06-01', ''); }, []);

  function csvOf(rows, cols, name) {
    if (!rows || !rows.length) { return; }
    var lines = [cols.join(',')];
    rows.forEach(function (r) { lines.push(cols.map(function (c) { return '"' + String(r[c] == null ? '' : r[c]).replace(/"/g, '""') + '"'; }).join(',')); });
    var blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  }

  var tt = data && data.totals;
  var th = { background: '#0f172a', color: '#fff' };
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3">
      <div className="flex gap-2 items-center flex-wrap mb-2">
        <div className="text-sm font-extrabold text-slate-900 mr-1">📈 Sales Report</div>
        {PRESETS.map(function (ps) {
          var active = preset === ps[0];
          return <button key={ps[0]} disabled={busy} onClick={function () { setPreset(ps[0]); setFrom(ps[1]); setTo(ps[2]); load(ps[1], ps[2]); }}
            className="px-2 py-1 rounded-lg text-[10px] font-extrabold"
            style={active ? { background: '#0f172a', color: '#fff' } : { background: '#f1f5f9', color: '#334155' }}>{ps[0]}</button>;
        })}
        <span className="text-[10px] font-bold text-slate-500 ml-1">custom:</span>
        <input type="date" value={from} onChange={function (e) { setFrom(e.target.value); }} className="px-2 py-1 rounded border border-slate-300 text-xs" />
        <input type="date" value={to} onChange={function (e) { setTo(e.target.value); }} className="px-2 py-1 rounded border border-slate-300 text-xs" />
        <button disabled={busy} onClick={function () { setPreset('custom'); load(from, to); }} className="px-3 py-1 rounded-lg text-xs font-extrabold bg-emerald-600 text-white disabled:opacity-50">Apply</button>
      </div>

      {busy && !data && <div className="text-xs text-slate-500 p-2">Building the report…</div>}
      {tt && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
          <div className="rounded-lg p-2" style={{ background: '#dcfce7', color: '#052e16' }}><div className="text-[10px] font-bold">Product sales (USD)</div><div className="text-lg font-black">{fmt(tt.product_revenue)}</div></div>
          <div className="rounded-lg p-2" style={{ background: '#e0f2fe', color: '#0c2a5e' }}><div className="text-[10px] font-bold">Shipping (separate)</div><div className="text-lg font-black">{fmt(tt.shipping_revenue)}</div><div className="text-[9px]">{tt.shipping_lines} shipping line(s)</div></div>
          <div className="rounded-lg p-2" style={{ background: '#f1f5f9', color: '#0f172a' }}><div className="text-[10px] font-bold">Grand total</div><div className="text-lg font-black">{fmt(tt.grand_total)}</div></div>
          <div className="rounded-lg p-2" style={{ background: '#f1f5f9', color: '#0f172a' }}><div className="text-[10px] font-bold">Invoices · line items</div><div className="text-lg font-black">{tt.invoices} · {tt.line_items}</div></div>
        </div>
      )}
      {data && data.non_usd && data.non_usd.length > 0 && (
        <div className="text-[11px] font-bold p-2 rounded mb-3" style={{ background: '#ffedd5', color: '#431407' }}>
          Not included above (own currency, never summed into USD): {data.non_usd.map(function (n) { return n.currency + ' ' + fmt(n.revenue) + ' (' + n.invoices + ' inv)'; }).join(' · ')}
        </div>
      )}

      {data && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[12px] font-extrabold text-slate-800">🧵 By product — quantity, revenue, AVERAGE price</div>
            <button onClick={function () { csvOf(data.products, ['product', 'qty', 'revenue', 'avg_price', 'invoices'], 'sales-by-product.csv'); }} className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800 text-white">⬇ CSV</button>
          </div>
          <div className="overflow-auto rounded border border-slate-200" style={{ maxHeight: 340 }}>
            <table className="w-full text-[11px]">
              <thead><tr>{['Product', 'Qty', 'Revenue', 'Avg price', 'Invoices'].map(function (h) { return <th key={h} className="px-2 py-1 text-left font-bold sticky top-0" style={th}>{h}</th>; })}</tr></thead>
              <tbody>{(data.products || []).map(function (p, i) {
                return (
                  <tr key={p.product + i} className="border-t border-slate-200" style={{ background: i % 2 ? '#f8fafc' : '#fff', color: '#0f172a' }}>
                    <td className="px-2 py-1 font-bold">{p.product}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmt(p.qty)}</td>
                    <td className="px-2 py-1 text-right font-mono font-black">{fmt(p.revenue)}</td>
                    <td className="px-2 py-1 text-right font-mono">{p.avg_price != null ? fmt(p.avg_price) : '—'}</td>
                    <td className="px-2 py-1 text-right">{p.invoices}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </div>
      )}

      {data && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="text-[12px] font-extrabold text-slate-800">👥 By customer — click a row to see what they bought</div>
            <button onClick={function () { csvOf(data.customers, ['customer', 'revenue', 'qty', 'shipping', 'invoices'], 'sales-by-customer.csv'); }} className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800 text-white">⬇ CSV</button>
          </div>
          <div className="overflow-auto rounded border border-slate-200" style={{ maxHeight: 420 }}>
            <table className="w-full text-[11px]">
              <thead><tr>{['Customer', 'Product revenue', 'Qty', 'Shipping', 'Invoices'].map(function (h) { return <th key={h} className="px-2 py-1 text-left font-bold sticky top-0" style={th}>{h}</th>; })}</tr></thead>
              <tbody>{(data.customers || []).map(function (c, i) {
                var open = openCust === c.customer;
                var rows = [(
                  <tr key={c.customer} onClick={function () { setOpenCust(open ? null : c.customer); }} className="border-t border-slate-200 cursor-pointer hover:bg-sky-50" style={{ background: open ? '#e0f2fe' : (i % 2 ? '#f8fafc' : '#fff'), color: '#0f172a' }}>
                    <td className="px-2 py-1 font-bold">{open ? '▾ ' : '▸ '}{c.customer}</td>
                    <td className="px-2 py-1 text-right font-mono font-black">{fmt(c.revenue)}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmt(c.qty)}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmt(c.shipping)}</td>
                    <td className="px-2 py-1 text-right">{c.invoices}</td>
                  </tr>
                )];
                if (open) {
                  (data.customer_products || []).filter(function (cp) { return cp.customer === c.customer; }).forEach(function (cp, j) {
                    rows.push(
                      <tr key={c.customer + '::' + cp.product + j} className="border-t border-slate-100" style={{ background: '#f0f9ff', color: '#0c2a5e' }}>
                        <td className="px-2 py-1 pl-6">{cp.product}</td>
                        <td className="px-2 py-1 text-right font-mono">{fmt(cp.revenue)}</td>
                        <td className="px-2 py-1 text-right font-mono">{fmt(cp.qty)}</td>
                        <td className="px-2 py-1 text-right font-mono text-slate-500">avg {cp.avg_price != null ? fmt(cp.avg_price) : '—'}</td>
                        <td className="px-2 py-1"></td>
                      </tr>
                    );
                  });
                }
                return rows;
              })}</tbody>
            </table>
          </div>
          <div className="text-[10px] text-slate-500 mt-1">{data.source}</div>
        </div>
      )}
    </div>
  );
}
