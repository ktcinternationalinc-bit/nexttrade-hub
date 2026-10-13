'use client';
// v55.83-OO — Accounting > P&L (Max, Oct 11). Two permission-gated halves:
//   • Product costs (pnl.edit_costs): enter a cost per product WITH an
//     effective-from date; changing a cost adds a new dated row — history kept.
//   • P&L (pnl.view): revenue − cost per product and per invoice for a period
//     (default June 1, 2026 →). Uncosted products are flagged amber, never
//     guessed into the margin. Shipping stays out of COGS.
import React, { useState, useEffect } from 'react';

function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function PnLTab(props) {
  var userProfile = props.userProfile;
  var isSuperAdmin = props.isSuperAdmin === true || (userProfile && userProfile.role === 'super_admin');
  var modulePerms = props.modulePerms || {};
  var canView = isSuperAdmin || modulePerms['pnl.view'] === true;
  var canEditCosts = isSuperAdmin || modulePerms['pnl.edit_costs'] === true;
  var toast = props.toast || { success: function () {}, error: function () {} };

  var s1 = useState('2026-06-01'); var from = s1[0]; var setFrom = s1[1];
  var s2 = useState(''); var to = s2[0]; var setTo = s2[1];
  var s3 = useState(null); var rep = s3[0]; var setRep = s3[1];
  var s4 = useState(false); var busy = s4[0]; var setBusy = s4[1];
  var s5 = useState('Jun 1 →'); var preset = s5[0]; var setPreset = s5[1];
  var s6 = useState(null); var costs = s6[0]; var setCosts = s6[1];
  var s7 = useState({}); var draft = s7[0]; var setDraft = s7[1];
  var s8 = useState(null); var histOpen = s8[0]; var setHistOpen = s8[1];
  var s9 = useState(false); var showCosts = s9[0]; var setShowCosts = s9[1];

  function iso(d) { return d.toISOString().substring(0, 10); }
  function agoDays(n) { var d = new Date(); d.setDate(d.getDate() - n); return iso(d); }
  var PRESETS = [
    ['Jun 1 →', '2026-06-01', ''],
    ['Last month', agoDays(30), ''],
    ['Last 3 months', agoDays(90), ''],
    ['Last 6 months', agoDays(183), ''],
    ['This year', '2026-01-01', ''],
    ['2025', '2025-01-01', '2025-12-31'],
    ['All history', '', '']
  ];

  function call(payload) {
    return fetch('/api/accounting/pnl', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ user_id: userProfile && userProfile.id }, payload)) })
      .then(function (r) { return r.json(); });
  }
  function loadReport(f, t) {
    setBusy(true);
    call({ action: 'report', date_from: f || null, date_to: t || null })
      .then(function (j) { if (!j || j.ok !== true) { toast.error((j && j.error) || 'P&L failed'); return; } setRep(j); })
      .catch(function (e) { toast.error('P&L failed: ' + ((e && e.message) || 'network')); })
      .finally(function () { setBusy(false); });
  }
  function loadCosts() {
    call({ action: 'list_costs' })
      .then(function (j) { if (!j || j.ok !== true) { toast.error((j && j.error) || 'Costs failed'); return; } setCosts(j); })
      .catch(function () {});
  }
  useEffect(function () { if (canView) { loadReport('2026-06-01', ''); loadCosts(); } }, []);

  function saveCost(productName) {
    var d = draft[productName] || {};
    var c = Number(d.cost); var e = (d.eff || '').trim();
    if (!(c >= 0)) { toast.error('Enter the cost per unit.'); return; }
    if (!e) { toast.error('Pick the effective-from date — the date this cost starts applying.'); return; }
    setBusy(true);
    call({ action: 'set_cost', product: productName, cost_per_unit: c, effective_from: e })
      .then(function (j) {
        if (!j || j.ok !== true) { toast.error((j && j.error) || 'Save failed'); return; }
        toast.success(productName + ': ' + fmt(j.saved.cost_per_unit) + ' from ' + j.saved.effective_from);
        var nd = Object.assign({}, draft); delete nd[productName]; setDraft(nd);
        loadCosts(); loadReport(from, to);
      })
      .catch(function (e2) { toast.error('Save failed: ' + ((e2 && e2.message) || 'network')); })
      .finally(function () { setBusy(false); });
  }

  if (!canView && !canEditCosts) {
    return <div className="bg-white rounded-xl border border-slate-200 p-4 text-xs text-slate-600 font-bold">Restricted — the P&L needs the "P&L: View" permission (Settings → Permissions).</div>;
  }
  var tt = rep && rep.totals;
  var th = { background: '#0f172a', color: '#fff' };
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3">
      <div className="flex gap-2 items-center flex-wrap mb-2">
        <div className="text-sm font-extrabold text-slate-900 mr-1">📊 P&amp;L</div>
        {PRESETS.map(function (ps) {
          var active = preset === ps[0];
          return <button key={ps[0]} disabled={busy} onClick={function () { setPreset(ps[0]); setFrom(ps[1]); setTo(ps[2]); loadReport(ps[1], ps[2]); }}
            className="px-2 py-1 rounded-lg text-[10px] font-extrabold"
            style={active ? { background: '#0f172a', color: '#fff' } : { background: '#f1f5f9', color: '#334155' }}>{ps[0]}</button>;
        })}
        <span className="text-[10px] font-bold text-slate-500 ml-1">custom:</span>
        <input type="date" value={from} onChange={function (e) { setFrom(e.target.value); }} className="px-2 py-1 rounded border border-slate-300 text-xs" />
        <input type="date" value={to} onChange={function (e) { setTo(e.target.value); }} className="px-2 py-1 rounded border border-slate-300 text-xs" />
        <button disabled={busy} onClick={function () { setPreset('custom'); loadReport(from, to); }} className="px-3 py-1 rounded-lg text-xs font-extrabold bg-emerald-600 text-white disabled:opacity-50">Apply</button>
        {canEditCosts && <button onClick={function () { setShowCosts(!showCosts); }} className="ml-auto px-3 py-1 rounded-lg text-xs font-extrabold" style={showCosts ? { background: '#0f172a', color: '#fff' } : { background: '#fef3c7', color: '#451a03' }}>{showCosts ? '✕ Close costs' : '💲 Product costs'}</button>}
      </div>

      {canEditCosts && showCosts && (
        <div className="mb-3 rounded-lg border-2 border-amber-300 p-2" style={{ background: '#fffbeb' }}>
          <div className="text-[12px] font-extrabold text-slate-900 mb-1">💲 Product costs — cost per unit, FROM a date. Changing a cost adds a new dated row; old invoices keep the old cost.</div>
          {!costs ? <div className="text-xs text-slate-500">Loading…</div> : (
            <div className="overflow-auto rounded border border-amber-200" style={{ maxHeight: 340 }}>
              <table className="w-full text-[11px]">
                <thead><tr>{['Product', 'Current cost', 'Effective since', 'New cost', 'Effective from', ''].map(function (h) { return <th key={h} className="px-2 py-1 text-left font-bold sticky top-0" style={th}>{h}</th>; })}</tr></thead>
                <tbody>{(costs.products || []).map(function (p, i) {
                  var d = draft[p.product] || {};
                  var rows = [(
                    <tr key={p.product_key} className="border-t border-amber-100" style={{ background: i % 2 ? '#fffdf5' : '#fff', color: '#0f172a' }}>
                      <td className="px-2 py-1 font-bold cursor-pointer" onClick={function () { setHistOpen(histOpen === p.product_key ? null : p.product_key); }}>{(p.history || []).length > 1 ? (histOpen === p.product_key ? '▾ ' : '▸ ') : ''}{p.product}{p.not_on_invoices ? ' (no sales yet)' : ''}</td>
                      <td className="px-2 py-1 text-right font-mono font-black">{p.current_cost != null ? fmt(p.current_cost) : <span className="text-rose-700 font-extrabold">none</span>}</td>
                      <td className="px-2 py-1">{p.current_since || '—'}</td>
                      <td className="px-2 py-1"><input type="number" step="0.01" value={d.cost == null ? '' : d.cost} onChange={function (e) { var nd = Object.assign({}, draft); nd[p.product] = Object.assign({}, d, { cost: e.target.value }); setDraft(nd); }} placeholder="cost / unit" className="w-24 px-1 py-0.5 rounded border border-amber-400 bg-white text-[11px] font-mono" /></td>
                      <td className="px-2 py-1"><input type="date" value={d.eff || ''} onChange={function (e) { var nd = Object.assign({}, draft); nd[p.product] = Object.assign({}, d, { eff: e.target.value }); setDraft(nd); }} className="px-1 py-0.5 rounded border border-amber-400 bg-white text-[11px]" /></td>
                      <td className="px-2 py-1"><button disabled={busy} onClick={function () { saveCost(p.product); }} className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-emerald-600 text-white disabled:opacity-40">💾 Save</button></td>
                    </tr>
                  )];
                  if (histOpen === p.product_key) {
                    (p.history || []).forEach(function (h, j) {
                      rows.push(
                        <tr key={p.product_key + '::h' + j} className="border-t border-amber-50" style={{ background: '#fef9ec', color: '#78350f' }}>
                          <td className="px-2 py-0.5 pl-6 text-[10px]">cost history</td>
                          <td className="px-2 py-0.5 text-right font-mono text-[10px]">{fmt(h.cost_per_unit)}</td>
                          <td className="px-2 py-0.5 text-[10px]">from {h.effective_from}</td>
                          <td className="px-2 py-0.5 text-[10px]" colSpan="3">{h.notes || ''}</td>
                        </tr>
                      );
                    });
                  }
                  return rows;
                })}</tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {busy && !rep && <div className="text-xs text-slate-500 p-2">Computing the P&amp;L…</div>}
      {tt && (
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 mb-2">
          <div className="rounded-lg p-2" style={{ background: '#f1f5f9', color: '#0f172a' }}><div className="text-[10px] font-bold">Revenue (USD)</div><div className="text-lg font-black">{fmt(tt.revenue)}</div></div>
          <div className="rounded-lg p-2" style={{ background: '#fee2e2', color: '#450a0a' }}><div className="text-[10px] font-bold">COGS</div><div className="text-lg font-black">{fmt(tt.cogs)}</div></div>
          <div className="rounded-lg p-2" style={{ background: tt.gross_profit >= 0 ? '#dcfce7' : '#fee2e2', color: tt.gross_profit >= 0 ? '#052e16' : '#450a0a' }}><div className="text-[10px] font-bold">Gross profit</div><div className="text-lg font-black">{fmt(tt.gross_profit)}</div></div>
          <div className="rounded-lg p-2" style={{ background: '#f1f5f9', color: '#0f172a' }}><div className="text-[10px] font-bold">Margin</div><div className="text-lg font-black">{tt.margin_pct != null ? tt.margin_pct + '%' : '—'}</div><div className="text-[9px]">on costed revenue</div></div>
          <div className="rounded-lg p-2" style={{ background: '#e0f2fe', color: '#0c2a5e' }}><div className="text-[10px] font-bold">Shipping (separate)</div><div className="text-lg font-black">{fmt(tt.shipping_revenue)}</div></div>
          <div className="rounded-lg p-2" style={{ background: tt.uncosted_revenue ? '#ffedd5' : '#dcfce7', color: tt.uncosted_revenue ? '#431407' : '#052e16' }}><div className="text-[10px] font-bold">Uncosted revenue</div><div className="text-lg font-black">{fmt(tt.uncosted_revenue)}</div><div className="text-[9px]">{tt.uncosted_lines} line(s) missing a cost</div></div>
        </div>
      )}
      {rep && rep.uncosted_products && rep.uncosted_products.length > 0 && (
        <div className="text-[11px] font-bold p-2 rounded mb-3" style={{ background: '#ffedd5', color: '#431407' }}>
          ⚠️ Not in the margin until costed: {rep.uncosted_products.slice(0, 8).map(function (u) { return u.product + ' (' + fmt(u.revenue) + ')'; }).join(' · ')}{rep.uncosted_products.length > 8 ? ' · +' + (rep.uncosted_products.length - 8) + ' more' : ''} — open 💲 Product costs and enter them with the right effective date.
        </div>
      )}

      {rep && (
        <div className="mb-3">
          <div className="text-[12px] font-extrabold text-slate-800 mb-1">🧵 P&amp;L by product</div>
          <div className="overflow-auto rounded border border-slate-200" style={{ maxHeight: 340 }}>
            <table className="w-full text-[11px]">
              <thead><tr>{['Product', 'Qty', 'Revenue', 'Avg price', 'Avg cost', 'COGS', 'Profit', 'Margin'].map(function (h) { return <th key={h} className="px-2 py-1 text-left font-bold sticky top-0" style={th}>{h}</th>; })}</tr></thead>
              <tbody>{(rep.products || []).map(function (p, i) {
                return (
                  <tr key={p.product + i} className="border-t border-slate-200" style={{ background: p.uncosted_revenue ? '#fff7ed' : (i % 2 ? '#f8fafc' : '#fff'), color: '#0f172a' }}>
                    <td className="px-2 py-1 font-bold">{p.product}{p.uncosted_revenue ? ' ⚠️' : ''}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmt(p.qty)}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmt(p.revenue)}</td>
                    <td className="px-2 py-1 text-right font-mono">{p.avg_sale_price != null ? fmt(p.avg_sale_price) : '—'}</td>
                    <td className="px-2 py-1 text-right font-mono">{p.avg_cost != null ? fmt(p.avg_cost) : '—'}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmt(p.cogs)}</td>
                    <td className={'px-2 py-1 text-right font-mono font-black ' + (p.profit < 0 ? 'text-rose-700' : 'text-emerald-700')}>{fmt(p.profit)}</td>
                    <td className="px-2 py-1 text-right font-bold">{p.margin_pct != null ? p.margin_pct + '%' : '—'}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </div>
      )}

      {rep && (
        <div>
          <div className="text-[12px] font-extrabold text-slate-800 mb-1">🧾 P&amp;L by invoice</div>
          <div className="overflow-auto rounded border border-slate-200" style={{ maxHeight: 420 }}>
            <table className="w-full text-[11px]">
              <thead><tr>{['Invoice', 'Customer', 'Date', 'Revenue', 'COGS', 'Profit', 'Margin', 'Shipping', 'Uncosted'].map(function (h) { return <th key={h} className="px-2 py-1 text-left font-bold sticky top-0" style={th}>{h}</th>; })}</tr></thead>
              <tbody>{(rep.invoices || []).map(function (b, i) {
                return (
                  <tr key={b.invoice + i} className="border-t border-slate-200" style={{ background: b.uncosted_revenue ? '#fff7ed' : (i % 2 ? '#f8fafc' : '#fff'), color: '#0f172a' }}>
                    <td className="px-2 py-1 font-bold font-mono">{b.invoice}</td>
                    <td className="px-2 py-1 truncate">{b.customer}</td>
                    <td className="px-2 py-1">{b.invoice_date || '—'}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmt(b.revenue)}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmt(b.cogs)}</td>
                    <td className={'px-2 py-1 text-right font-mono font-black ' + (b.profit < 0 ? 'text-rose-700' : 'text-emerald-700')}>{fmt(b.profit)}</td>
                    <td className="px-2 py-1 text-right font-bold">{b.margin_pct != null ? b.margin_pct + '%' : '—'}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmt(b.shipping)}</td>
                    <td className="px-2 py-1 text-right font-mono">{b.uncosted_revenue ? fmt(b.uncosted_revenue) : ''}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
          <div className="text-[10px] text-slate-500 mt-1">{rep.source}</div>
        </div>
      )}
    </div>
  );
}
