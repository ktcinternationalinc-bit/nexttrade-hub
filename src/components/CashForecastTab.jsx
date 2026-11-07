'use client';
// v55.83-PD — Accounting > 📈 Forecast (Max, Nov 6): "what's coming in the next
// 30 days, 30-60, 60-90, 90 plus... bills we owe same thing... shortages
// we're expecting... are we in the plus or minus paying our bills... by
// clicking in those cards see the underlying numbers and where they're
// coming from... invoices or expenses that have not been flagged yet."
// OVERDUE gets its own column: money already late is never sold as
// "coming in the next 30 days". Every drill-down sums to its card.
import React, { useState, useEffect } from 'react';

function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
var LABELS = { 'L90+': '⚠ 90+ days late', 'L61-90': '⚠ 61–90 late', 'L31-60': '⚠ 31–60 late', 'L1-30': '⚠ 1–30 late', 'D0-30': 'Due ≤30 days', 'D31-60': 'Due 31–60', 'D61-90': 'Due 61–90', 'D90+': 'Due 90+' };

export default function CashForecastTab(props) {
  var userProfile = props.userProfile;
  var isSuperAdmin = props.isSuperAdmin === true || (userProfile && userProfile.role === 'super_admin');
  var modulePerms = props.modulePerms || {};
  var canView = isSuperAdmin || modulePerms['bills.view'] === true || modulePerms['bills.manage'] === true || modulePerms['ar.view_invoice_balances'] === true;
  var toast = props.toast || { success: function () {}, error: function () {} };
  var onGo = props.onGo || function () {};

  var s1 = useState(null); var data = s1[0]; var setData = s1[1];
  var s2 = useState(false); var busy = s2[0]; var setBusy = s2[1];
  var s3 = useState(null); var drill = s3[0]; var setDrill = s3[1]; // {bucket, kind}

  function load() {
    setBusy(true);
    fetch('/api/accounting/bills', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'forecast', user_id: userProfile && userProfile.id }) })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j && j.ok) { setData(j); } else { toast.error((j && j.error) || 'Could not load the forecast.'); } })
      .finally(function () { setBusy(false); });
  }
  useEffect(function () { if (canView) { load(); } }, []); // eslint-disable-line

  if (!canView) {
    return <div className="bg-white rounded-xl border border-slate-200 p-4 text-sm text-slate-700">
      The forecast needs the <b>Bills: View</b> or <b>AR balances</b> permission — ask an admin in Settings → Permissions.</div>;
  }
  if (!data) { return <div className="bg-white rounded-xl border border-slate-200 p-4 text-sm text-slate-600">{busy ? 'Building the forecast…' : 'No data yet.'}</div>; }

  var order = data.bucket_order || [];
  var B = data.buckets || {};
  var rows = data.rows || [];
  var unf = data.unflagged || {};

  function drillRows() {
    if (!drill) { return []; }
    return rows.filter(function (r) { return r.bucket === drill.bucket && (drill.kind === 'all' || r.kind === drill.kind); })
      .sort(function (a, b) { return b.amount - a.amount; });
  }
  function drillSum() { var s = 0; drillRows().forEach(function (r) { s += r.kind === 'out' ? -r.amount : r.amount; }); return Math.round(s * 100) / 100; }

  function csv() {
    var lines = ['bucket,direction,reference,who,date,amount,source'];
    rows.forEach(function (r) {
      lines.push([r.bucket, r.kind === 'in' ? 'coming in' : 'going out', '"' + String(r.ref).replace(/"/g, '""') + '"',
        '"' + String(r.who).replace(/"/g, '""') + '"', r.date, r.amount.toFixed(2), '"' + r.source + '"'].join(','));
    });
    var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'cash-forecast-' + data.today + '.csv'; a.click();
  }

  return <div className="flex flex-col gap-3">
    <div className="bg-white rounded-xl border border-slate-200 p-3">
      <div className="flex gap-2 items-center flex-wrap mb-2">
        <div className="text-sm font-extrabold text-slate-900">📈 Cash forecast — as of {data.today}</div>
        <div className="flex-1" />
        <button onClick={csv} className="px-3 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#1e293b', color: '#ffffff' }}>⬇ CSV for the accountant</button>
        <button onClick={load} disabled={busy} className="px-2 py-1 rounded-lg text-[10px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>↻</button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs" style={{ minWidth: 640 }}>
          <thead><tr style={{ borderBottom: '1px solid #cbd5e1', color: '#475569' }}>
            <th className="py-2 pr-2 text-left font-semibold">&nbsp;</th>
            {order.map(function (b) {
              return <th key={b} className="py-2 px-2 text-right font-semibold" style={String(b).charAt(0) === 'L' ? { color: '#7f1d1d' } : {}}>{LABELS[b] || b}</th>;
            })}
          </tr></thead>
          <tbody style={{ color: '#0f172a' }}>
            <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
              <td className="py-2 pr-2 font-bold" style={{ color: '#065f46' }}>Coming in (invoices)</td>
              {order.map(function (b) {
                return <td key={b} className="py-1 px-1 text-right">
                  <button onClick={function () { setDrill({ bucket: b, kind: 'in' }); }} className="w-full rounded-lg px-2 py-1.5 text-right"
                    style={{ background: '#d1fae5', color: '#065f46', border: '1px solid #a7f3d0' }}>
                    <div className="font-extrabold tabular-nums">${fmt(B[b].ar)}</div>
                    <div className="text-[10px] font-semibold" style={{ opacity: 0.8 }}>{B[b].ar_count} invoice(s)</div>
                  </button></td>;
              })}
            </tr>
            <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
              <td className="py-2 pr-2 font-bold" style={{ color: '#7f1d1d' }}>Going out (bills)</td>
              {order.map(function (b) {
                return <td key={b} className="py-1 px-1 text-right">
                  <button onClick={function () { setDrill({ bucket: b, kind: 'out' }); }} className="w-full rounded-lg px-2 py-1.5 text-right"
                    style={{ background: '#fee2e2', color: '#7f1d1d', border: '1px solid #fecaca' }}>
                    <div className="font-extrabold tabular-nums">${fmt(B[b].ap)}</div>
                    <div className="text-[10px] font-semibold" style={{ opacity: 0.8 }}>{B[b].ap_count} bill(s)</div>
                  </button></td>;
              })}
            </tr>
            <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
              <td className="py-2 pr-2 font-bold" style={{ color: '#312e81' }}>Net this window</td>
              {order.map(function (b) {
                var pos = B[b].net >= 0;
                return <td key={b} className="py-2 px-2 text-right font-extrabold tabular-nums" style={{ color: pos ? '#065f46' : '#7f1d1d' }}>
                  {(pos ? '+$' : '−$') + fmt(Math.abs(B[b].net))}</td>;
              })}
            </tr>
            <tr>
              <td className="py-2 pr-2 font-bold" style={{ color: '#334155' }}>Running position<div className="text-[9px] font-semibold" style={{ color: '#64748b' }}>can we pay the bills as they come due?</div></td>
              {order.map(function (b) {
                var pos = B[b].running >= 0;
                return <td key={b} className="py-2 px-2 text-right font-extrabold tabular-nums" style={{ color: pos ? '#065f46' : '#7f1d1d', background: pos ? '#f0fdf4' : '#fff1f2' }}>
                  {(pos ? '+$' : '−$') + fmt(Math.abs(B[b].running))}</td>;
              })}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="text-[10px] mt-2" style={{ color: '#64748b' }}>
        Dates come from each invoice's/bill's due date (falling back to its document date). ⚠ columns are money already LATE, aged by how long — never dressed up as future cash. Click any green/red card for the exact rows behind it.
      </div>
    </div>

    {/* Unflagged work — "invoices or expenses that have not been flagged yet" */}
    <div className="bg-white rounded-xl border border-slate-200 p-3">
      <div className="flex gap-3 items-center flex-wrap">
        <div className="text-xs font-extrabold text-slate-900">🚩 Not flagged yet:</div>
        <button onClick={function () { onGo('review'); }} className="px-3 py-1.5 rounded-lg text-[11px] font-extrabold"
          style={{ background: (unf.expenses > 0 ? '#fee2e2' : '#d1fae5'), color: (unf.expenses > 0 ? '#7f1d1d' : '#065f46'), border: '1px solid #e2e8f0' }}>
          {unf.expenses || 0} expense(s) uncategorized →</button>
        <button onClick={function () { onGo('review'); }} className="px-3 py-1.5 rounded-lg text-[11px] font-extrabold"
          style={{ background: (unf.deposits > 0 ? '#ffedd5' : '#d1fae5'), color: (unf.deposits > 0 ? '#431407' : '#065f46'), border: '1px solid #e2e8f0' }}>
          {unf.deposits || 0} deposit(s) unmatched →</button>
        <span className="text-[10px]" style={{ color: '#64748b' }}>Unflagged money is invisible to the books — clear these and the forecast gets sharper.</span>
      </div>
    </div>

    {drill && <div className="bg-white rounded-xl border border-slate-200 p-3">
      <div className="flex gap-2 items-center mb-2 flex-wrap">
        <div className="text-xs font-extrabold text-slate-900">
          {(drill.kind === 'in' ? 'Coming in · ' : 'Going out · ') + (LABELS[drill.bucket] || drill.bucket)} — the rows behind the card</div>
        <div className="flex-1" />
        <button onClick={function () { setDrill(null); }} className="px-2 py-1 rounded-lg text-[10px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>✕ close</button>
      </div>
      <div className="overflow-x-auto"><table className="w-full text-xs">
        <thead><tr style={{ borderBottom: '1px solid #cbd5e1', color: '#475569' }}>
          <th className="py-1.5 pr-2 text-left font-semibold">Reference</th><th className="py-1.5 pr-2 text-left font-semibold">{drill.kind === 'in' ? 'Customer' : 'Vendor'}</th>
          <th className="py-1.5 pr-2 text-left font-semibold">Date</th><th className="py-1.5 pr-2 text-right font-semibold">Open</th><th className="py-1.5 text-left font-semibold">Where it comes from</th></tr></thead>
        <tbody style={{ color: '#0f172a' }}>
          {drillRows().map(function (r, i) {
            return <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td className="py-1.5 pr-2 font-semibold">{r.ref}</td><td className="py-1.5 pr-2">{r.who}</td>
              <td className="py-1.5 pr-2">{r.date || '—'}</td>
              <td className="py-1.5 pr-2 text-right font-extrabold tabular-nums">${fmt(r.amount)}</td>
              <td className="py-1.5 text-[10px]" style={{ color: '#64748b' }}>{r.source}</td></tr>;
          })}
        </tbody>
        <tfoot><tr style={{ borderTop: '2px solid #cbd5e1', color: '#0f172a' }}>
          <td className="py-2 pr-2 font-extrabold" colSpan={3}>Σ total — equals the card to the cent</td>
          <td className="py-2 pr-2 text-right font-extrabold tabular-nums">${fmt(Math.abs(drillSum()))}</td><td /></tr></tfoot>
      </table></div>
    </div>}
  </div>;
}
