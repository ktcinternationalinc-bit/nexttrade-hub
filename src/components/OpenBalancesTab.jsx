'use client';
// v55.83-OJ — Accounting > Open Balances: who owes what, period-scoped,
// overdue rows highlighted light orange (Max's spec).
import React, { useState, useEffect } from 'react';

export default function OpenBalancesTab(props) {
  var userProfile = props.userProfile;
  var toast = props.toast || { success: function () {}, error: function () {} };
  var s1 = useState(''); var from = s1[0]; var setFrom = s1[1];
  var s2 = useState(''); var to = s2[0]; var setTo = s2[1];
  var s3 = useState(null); var data = s3[0]; var setData = s3[1];
  var s4 = useState(false); var busy = s4[0]; var setBusy = s4[1];
  var s5 = useState('Last 3 months'); var preset = s5[0]; var setPreset = s5[1];

  function iso(d) { return d.toISOString().substring(0, 10); }
  function agoDays(n) { var d = new Date(); d.setDate(d.getDate() - n); return iso(d); }
  var PRESETS = [
    ['1 month', agoDays(30), ''],
    ['Last 3 months', agoDays(90), ''],
    ['6 months', agoDays(183), ''],
    ['This year', '2026-01-01', ''],
    ['2025', '2025-01-01', '2025-12-31'],
    ['All history', '', '']
  ];

  function load(f, t) {
    setBusy(true);
    fetch('/api/reconcile/nexttrade', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'open_balances', user_id: userProfile && userProfile.id, date_from: f || null, date_to: t || null }) })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (!j || j.ok !== true) { toast.error((j && j.error) || 'Load failed'); return; } setData(j); })
      .catch(function (e) { toast.error('Load failed: ' + ((e && e.message) || 'network')); })
      .finally(function () { setBusy(false); });
  }
  useEffect(function () { load(agoDays(90), ''); }, []);

  function csv() {
    if (!data || !data.rows || !data.rows.length) { return; }
    var cols = Object.keys(data.rows[0]);
    var lines = [cols.join(',')];
    data.rows.forEach(function (r) { lines.push(cols.map(function (c) { var v = r[c]; return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(',')); });
    var blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'open-balances.csv'; a.click();
  }

  var tt = data && data.totals;
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3">
      <div className="flex gap-2 items-center flex-wrap mb-2">
        <div className="text-sm font-extrabold text-slate-900 mr-1">💰 Invoices with open balances</div>
        {PRESETS.map(function (ps) {
          var active = preset === ps[0];
          return <button key={ps[0]} disabled={busy} onClick={function () { setPreset(ps[0]); setFrom(ps[1]); setTo(ps[2]); load(ps[1], ps[2]); }}
            className="px-2 py-1 rounded-lg text-[10px] font-extrabold"
            style={active ? { background: '#0f172a', color: '#fff' } : { background: '#f1f5f9', color: '#334155' }}>{ps[0]}</button>;
        })}
        <span className="text-[10px] font-bold text-slate-500 ml-1">custom:</span>
        <input type="date" value={from} onChange={function (e) { setFrom(e.target.value); }} className="px-2 py-1 rounded border border-slate-300 text-xs" />
        <input type="date" value={to} onChange={function (e) { setTo(e.target.value); }} className="px-2 py-1 rounded border border-slate-300 text-xs" />
        <button disabled={busy} onClick={function () { setPreset('custom'); load(from, to); }} className="px-3 py-1 rounded-lg text-xs font-extrabold bg-slate-700 text-white disabled:opacity-50">Go</button>
        <button disabled={busy || !data || !(data.rows || []).length} onClick={csv} className="ml-auto px-2 py-1 rounded text-[10px] font-bold bg-slate-800 text-white disabled:opacity-40">⬇ CSV</button>
      </div>
      {tt && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
          <div className="rounded-lg p-2" style={{ background: '#f1f5f9', color: '#0f172a' }}><div className="text-[10px] font-bold">Invoices with balance</div><div className="text-lg font-black">{tt.count}</div></div>
          <div className="rounded-lg p-2" style={{ background: '#fee2e2', color: '#450a0a' }}><div className="text-[10px] font-bold">Total open</div><div className="text-lg font-black">{Number(tt.total_open).toLocaleString()}</div></div>
          <div className="rounded-lg p-2" style={{ background: '#ffedd5', color: '#431407' }}><div className="text-[10px] font-bold">Overdue invoices</div><div className="text-lg font-black">{tt.overdue_count}</div></div>
          <div className="rounded-lg p-2" style={{ background: '#ffedd5', color: '#431407' }}><div className="text-[10px] font-bold">Overdue amount</div><div className="text-lg font-black">{Number(tt.overdue_open).toLocaleString()}</div></div>
        </div>
      )}
      {data && (data.rows || []).length === 0 && <div className="text-[11px] font-bold p-2 rounded" style={{ background: '#dcfce7', color: '#052e16' }}>🎉 No open balances in this period.</div>}
      {data && (data.rows || []).length > 0 && (
        <div className="overflow-auto rounded border border-slate-200" style={{ maxHeight: 480 }}>
          <table className="w-full text-[11px]">
            <thead><tr>{['Invoice', 'Customer', 'Release #', 'Invoice date', 'Due date', 'Total', 'Paid', 'Balance due', 'Days overdue'].map(function (h) { return <th key={h} className="px-2 py-1 text-left font-bold sticky top-0" style={{ background: '#0f172a', color: '#fff' }}>{h}</th>; })}</tr></thead>
            <tbody>{data.rows.map(function (r, i) {
              // Max's spec: late = light orange highlight
              var rowStyle = r.overdue ? { background: '#ffedd5', color: '#431407' } : { background: i % 2 ? '#f8fafc' : '#fff', color: '#0f172a' };
              return (
                <tr key={r.invoice + ':' + i} style={rowStyle} className="border-t border-slate-200">
                  <td className="px-2 py-1 font-bold whitespace-nowrap">{r.invoice}</td>
                  <td className="px-2 py-1 whitespace-nowrap">{r.customer}</td>
                  <td className="px-2 py-1 font-mono whitespace-nowrap">{r.release}</td>
                  <td className="px-2 py-1 whitespace-nowrap">{r.invoice_date || ''}</td>
                  <td className="px-2 py-1 whitespace-nowrap">{r.due_date || ''}</td>
                  <td className="px-2 py-1 text-right whitespace-nowrap">{r.total != null ? Number(r.total).toLocaleString() : ''}</td>
                  <td className="px-2 py-1 text-right whitespace-nowrap">{Number(r.paid).toLocaleString()}</td>
                  <td className="px-2 py-1 text-right font-black whitespace-nowrap">{Number(r.balance_due).toLocaleString()}</td>
                  <td className="px-2 py-1 text-right font-bold whitespace-nowrap">{r.days_overdue > 0 ? r.days_overdue : ''}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
