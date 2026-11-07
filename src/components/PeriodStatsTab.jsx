'use client';
// v55.83-PH — Accounting > 📉 Stats (Max, Nov 6): "i need a tab from june 1st
// on for both invoices and bills to see stats". Default June 1, 2026 → today;
// invoices and bills side by side; month-by-month table; CSV.
import React, { useState, useEffect } from 'react';

function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
var TODAY = new Date().toISOString().substring(0, 10);

export default function PeriodStatsTab(props) {
  var userProfile = props.userProfile;
  var isSuperAdmin = props.isSuperAdmin === true || (userProfile && userProfile.role === 'super_admin');
  var modulePerms = props.modulePerms || {};
  var canView = isSuperAdmin || modulePerms['bills.view'] === true || modulePerms['bills.manage'] === true || modulePerms['ar.view_invoice_balances'] === true;
  var toast = props.toast || { success: function () {}, error: function () {} };

  var s1 = useState('2026-06-01'); var from = s1[0]; var setFrom = s1[1];
  var s2 = useState(TODAY); var to = s2[0]; var setTo = s2[1];
  var s3 = useState(null); var data = s3[0]; var setData = s3[1];
  var s4 = useState(false); var busy = s4[0]; var setBusy = s4[1];
  var s5 = useState(null); var drill = s5[0]; var setDrill = s5[1]; // {key, title, unitWho}

  function load(f, t) {
    setBusy(true);
    fetch('/api/accounting/bills', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'period_stats', from: f, to: t, user_id: userProfile && userProfile.id }) })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j && j.ok) { setData(j); } else { toast.error((j && j.error) || 'Could not load stats.'); setData({ denied: true, error: (j && j.error) || '' }); } })
      .finally(function () { setBusy(false); });
  }
  useEffect(function () { if (canView) { load(from, to); } }, []); // eslint-disable-line

  if (!canView) {
    return <div className="bg-white rounded-xl border border-slate-200 p-4 text-sm text-slate-700">
      Stats need the <b>Bills: View</b> or <b>AR balances</b> permission — Settings → Permissions.</div>;
  }

  function csv() {
    if (!data || !data.months) { return; }
    var L = ['month,invoiced,invoices,collected,payments,bills_entered,bills,bills_paid,bill_payments,net_cash'];
    data.months.forEach(function (m) {
      L.push([m.month, m.invoiced.toFixed(2), m.invoiced_count, m.collected.toFixed(2), m.collected_count,
        m.billed.toFixed(2), m.billed_count, m.bills_paid.toFixed(2), m.bills_paid_count, m.net.toFixed(2)].join(','));
    });
    var blob = new Blob([L.join('\n')], { type: 'text/csv' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'period-stats-' + data.from + '-to-' + data.to + '.csv'; a.click();
  }

  function Card(p2) {
    return <button onClick={p2.onClick} className="rounded-xl p-3 text-left" style={{ background: p2.bg, border: '1px solid ' + p2.border, minWidth: 160, flex: '1 1 160px', cursor: 'pointer' }}>
      <div className="text-[10px] font-extrabold uppercase" style={{ color: p2.fg, opacity: 0.75 }}>{p2.label}</div>
      <div className="text-lg font-extrabold tabular-nums" style={{ color: p2.fg }}>{p2.value}</div>
      {p2.sub && <div className="text-[10px] font-semibold" style={{ color: p2.fg, opacity: 0.75 }}>{p2.sub}</div>}
      <div className="text-[9px] font-bold mt-0.5" style={{ color: p2.fg, opacity: 0.55 }}>click for the rows ▸</div>
    </button>;
  }
  function openDrill(key, title, unitWho) { setDrill({ key: key, title: title, unitWho: unitWho }); }
  function drillRows() { return (data && data.drills && data.drills[drill.key]) || []; }
  function drillSum() { var t2 = 0; drillRows().forEach(function (r) { t2 += Number(r.amount) || 0; }); return Math.round(t2 * 100) / 100; }

  var inv = (data && data.invoices) || null;
  var bl = (data && data.bills) || null;
  return <div className="bg-white rounded-xl border border-slate-200 p-3">
    <div className="flex gap-2 items-center flex-wrap mb-2">
      <div className="text-sm font-extrabold text-slate-900">📉 Stats — invoices & bills</div>
      <input type="date" className="px-2 py-1 rounded-lg border border-slate-300 text-xs text-slate-900 bg-white" value={from} onChange={function (e) { setFrom(e.target.value); }} />
      <span className="text-[10px] text-slate-500">→</span>
      <input type="date" className="px-2 py-1 rounded-lg border border-slate-300 text-xs text-slate-900 bg-white" value={to} onChange={function (e) { setTo(e.target.value); }} />
      <button onClick={function () { load(from, to); }} disabled={busy} className="px-3 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#1e293b', color: '#ffffff' }}>{busy ? '…' : 'Go'}</button>
      {/* v55.83-PK (Max): "the dates has something from june 1st as selection next to month year etc" */}
      {(function () {
        var y = TODAY.substring(0, 4);
        var m0 = TODAY.substring(0, 8) + '01';
        var lastM = new Date(Number(y), Number(TODAY.substring(5, 7)) - 2, 1);
        var lmFrom = lastM.toISOString().substring(0, 10);
        var lmEnd = new Date(Number(y), Number(TODAY.substring(5, 7)) - 1, 0).toISOString().substring(0, 10);
        var P = [['Jun 1 →', '2026-06-01', TODAY], ['This month', m0, TODAY], ['Last month', lmFrom, lmEnd], ['This year', y + '-01-01', TODAY]];
        return P.map(function (p2) {
          var on = from === p2[1] && to === p2[2];
          return <button key={p2[0]} onClick={function () { setFrom(p2[1]); setTo(p2[2]); load(p2[1], p2[2]); }}
            className="px-2 py-1 rounded-lg text-[10px] font-extrabold"
            style={on ? { background: '#1e293b', color: '#ffffff' } : { background: '#f1f5f9', color: '#334155' }}>{p2[0]}</button>;
        });
      })()}
      <div className="flex-1" />
      {data && data.months && <button onClick={csv} className="px-2 py-1 rounded-lg text-[10px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>⬇ CSV</button>}
    </div>

    {!data ? <div className="text-[11px] text-slate-500">Loading…</div> :
     data.denied ? <div className="text-[11px]" style={{ color: '#92400e' }}>{data.error || 'Not permitted.'}</div> :
     <div>
      <div className="text-[10px] font-extrabold uppercase mb-1" style={{ color: '#065f46' }}>Invoices (money we earn) · {data.from} → {data.to}</div>
      <div className="flex gap-2 flex-wrap mb-3">
        <Card onClick={function () { openDrill('invoiced', 'Invoiced in period', 'Customer'); }} label={'Invoiced (' + inv.count + ')'} value={'$' + fmt(inv.invoiced)} bg="#d1fae5" border="#a7f3d0" fg="#065f46" sub="invoices dated in period" />
        <Card onClick={function () { openDrill('collected', 'Collected in period', 'Customer'); }} label={'Collected (' + inv.collected_count + ' payments)'} value={'$' + fmt(inv.collected)} bg="#ecfeff" border="#a5f3fc" fg="#155e75" sub="payments received in period" />
        <Card onClick={function () { openDrill('open_invoices', 'Still open — period invoices', 'Customer'); }} label="Still open from these" value={'$' + fmt(inv.still_open_from_period)} bg="#ffedd5" border="#fed7aa" fg="#431407" sub="unpaid balance of period invoices" />
      </div>
      <div className="text-[10px] font-extrabold uppercase mb-1" style={{ color: '#7f1d1d' }}>Bills (money we owe)</div>
      <div className="flex gap-2 flex-wrap mb-3">
        <Card onClick={function () { openDrill('billed', 'Bills entered in period', 'Vendor'); }} label={'Bills entered (' + bl.count + ')'} value={'$' + fmt(bl.billed)} bg="#fee2e2" border="#fecaca" fg="#7f1d1d" sub="bills dated in period" />
        <Card onClick={function () { openDrill('bills_paid', 'Bill payments in period', 'Vendor'); }} label={'Bills paid (' + bl.paid_count + ')'} value={'$' + fmt(bl.paid)} bg="#e0e7ff" border="#c7d2fe" fg="#312e81" sub="bill payments in period" />
        <Card onClick={function () { openDrill('open_bills', 'Still open — period bills', 'Vendor'); }} label="Still open from these" value={'$' + fmt(bl.still_open_from_period)} bg="#ffedd5" border="#fed7aa" fg="#431407" sub={bl.disputed_open > 0.005 ? ('+ $' + fmt(bl.disputed_open) + ' disputed (excluded)') : 'disputed excluded'} />
      </div>

      {drill && <div className="rounded-xl p-3 mb-3" style={{ background: '#f8fafc', border: '1px solid #cbd5e1' }}>
        <div className="flex gap-2 items-center mb-1">
          <div className="text-xs font-extrabold" style={{ color: '#0f172a' }}>{drill.title} — the rows behind the card</div>
          <div className="flex-1" />
          <button onClick={function () { setDrill(null); }} className="px-2 py-1 rounded-lg text-[10px] font-bold" style={{ background: '#e2e8f0', color: '#334155' }}>✕ close</button>
        </div>
        <div className="overflow-x-auto"><table className="w-full text-xs">
          <thead><tr style={{ borderBottom: '1px solid #cbd5e1', color: '#475569' }}>
            <th className="py-1 pr-2 text-left font-semibold">Reference</th>
            <th className="py-1 pr-2 text-left font-semibold">{drill.unitWho}</th>
            <th className="py-1 pr-2 text-left font-semibold">Date</th>
            <th className="py-1 pr-2 text-right font-semibold">Amount</th>
            <th className="py-1 text-left font-semibold">Where it comes from</th></tr></thead>
          <tbody style={{ color: '#0f172a' }}>
            {drillRows().slice().sort(function (a, b2) { return b2.amount - a.amount; }).map(function (r, i) {
              return <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td className="py-1 pr-2 font-semibold">{r.ref}</td><td className="py-1 pr-2">{r.who}</td>
                <td className="py-1 pr-2">{r.date || '—'}</td>
                <td className="py-1 pr-2 text-right font-extrabold tabular-nums">${fmt(r.amount)}</td>
                <td className="py-1 text-[10px]" style={{ color: '#64748b' }}>{r.source}</td></tr>;
            })}
            {drillRows().length === 0 && <tr><td colSpan={5} className="py-2 text-center text-slate-500 text-[11px]">No rows in this period.</td></tr>}
          </tbody>
          <tfoot><tr style={{ borderTop: '2px solid #cbd5e1', color: '#0f172a' }}>
            <td className="py-1.5 pr-2 font-extrabold" colSpan={3}>Σ total — equals the card to the cent</td>
            <td className="py-1.5 pr-2 text-right font-extrabold tabular-nums">${fmt(drillSum())}</td><td /></tr></tfoot>
        </table></div>
      </div>}

      <div className="overflow-x-auto">
        <table className="w-full text-xs" style={{ minWidth: 640 }}>
          <thead><tr style={{ borderBottom: '1px solid #cbd5e1', color: '#475569' }}>
            <th className="py-1.5 pr-2 text-left font-semibold">Month</th>
            <th className="py-1.5 px-2 text-right font-semibold">Invoiced</th>
            <th className="py-1.5 px-2 text-right font-semibold">Collected</th>
            <th className="py-1.5 px-2 text-right font-semibold">Bills entered</th>
            <th className="py-1.5 px-2 text-right font-semibold">Bills paid</th>
            <th className="py-1.5 px-2 text-right font-semibold">Net cash (collected − bills paid)</th>
          </tr></thead>
          <tbody style={{ color: '#0f172a' }}>
            {(data.months || []).map(function (m) {
              return <tr key={m.month} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td className="py-1.5 pr-2 font-bold">{m.month}</td>
                <td className="py-1.5 px-2 text-right tabular-nums">${fmt(m.invoiced)} <span className="text-[9px] text-slate-400">({m.invoiced_count})</span></td>
                <td className="py-1.5 px-2 text-right tabular-nums" style={{ color: '#065f46' }}>${fmt(m.collected)}</td>
                <td className="py-1.5 px-2 text-right tabular-nums">${fmt(m.billed)} <span className="text-[9px] text-slate-400">({m.billed_count})</span></td>
                <td className="py-1.5 px-2 text-right tabular-nums" style={{ color: '#7f1d1d' }}>${fmt(m.bills_paid)}</td>
                <td className="py-1.5 px-2 text-right font-extrabold tabular-nums" style={{ color: m.net >= 0 ? '#065f46' : '#7f1d1d' }}>{(m.net >= 0 ? '+$' : '−$') + fmt(Math.abs(m.net))}</td>
              </tr>;
            })}
            {(data.months || []).length === 0 && <tr><td colSpan={6} className="py-3 text-center text-slate-500 text-[11px]">Nothing in this period.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="text-[10px] mt-2" style={{ color: '#64748b' }}>
        US business, USD. Invoiced = by invoice date; Collected = by payment date (so a payment on an older invoice still counts in its month). Bills by bill date; disputed bills stay out of the open totals.
      </div>
     </div>}
  </div>;
}
