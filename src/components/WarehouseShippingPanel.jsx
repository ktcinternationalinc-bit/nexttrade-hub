'use client';
// v55.83-TG — Profitability → Containers: shipping costs from the Nextrade warehouse (Max, Nov 16 2026).
// "Sync Shipping Costs" · "Open Orders — Last 2 Years" · orders shipped since 1 Jun 2026 · the review queue · the P&L switch.
// Everything is worked out on the server (lib/warehouse-shipping.js). Nothing here changes an invoice, a bill or the warehouse.
import React, { useState, useEffect } from 'react';
import { FLAG_TEXT, statusWords } from '../lib/warehouse-shipping';
import { supabase } from '../lib/supabase';

var INK = '#0f172a'; var SUB = '#475569'; var LINE = '#e2e8f0';
var th = { background: '#0f172a', color: '#ffffff' };
var inp = { background: '#ffffff', color: INK, border: '1px solid #94a3b8' };
function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function money(v) { return v === null || v === undefined || v === '' ? null : Number(v); }
function ageDays(d) { if (!d) { return null; } return Math.floor((Date.now() - Date.parse(d + 'T00:00:00Z')) / 86400000); }
var STATUS_LABEL = { final: 'Final', partly_provisional: 'Partly provisional', provisional: 'Provisional — order not closed; final costs pending', missing: 'Missing', not_applicable: '—', customer_own_transport: 'Customer’s own transport (inferred) — 0' };
var STATUS_COLOR = { final: '#166534', customer_own_transport: '#1d4ed8', partly_provisional: '#b45309', provisional: '#b45309', missing: '#b91c1c' };
var SHIPPED_WAITING = { shipped: true, post_loading_documentation: true, end_stage: true };

export default function WarehouseShippingPanel(props) {
  var userProfile = props.userProfile; var toast = props.toast || { success: function () {}, error: function () {} };
  var s1 = useState(null); var data = s1[0]; var setData = s1[1];
  var s2 = useState(false); var busy = s2[0]; var setBusy = s2[1];
  var s3 = useState(''); var show = s3[0]; var setShow = s3[1]; // '' | 'open' | 'shipped' | 'review'
  var s4 = useState(false); var onlyShipped = s4[0]; var setOnlyShipped = s4[1];
  var s5 = useState('oldest'); var sortBy = s5[0]; var setSortBy = s5[1];
  var s6 = useState({}); var draft = s6[0]; var setDraft = s6[1];
  var s7 = useState(null); var hist = s7[0]; var setHist = s7[1];
  var s8 = useState(''); var q = s8[0]; var setQ = s8[1];

  // the server checks WHO is calling from the sign-in token (Codex 16 Nov), not from a user id in the request
  function call(payload) {
    return supabase.auth.getSession().then(function (sres) {
      var token = sres && sres.data && sres.data.session ? sres.data.session.access_token : null;
      if (!token) { return { ok: false, error: 'Sign in again — no sign-in session was found.' }; }
      return fetch('/api/accounting/warehouse-shipping', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify(Object.assign({ user_id: userProfile && userProfile.id }, payload)) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'The server did not answer properly (HTTP ' + r.status + ').' }; }); })
      .catch(function (e) { return { ok: false, error: 'Could not reach the server (' + ((e && e.message) || 'network') + ').' }; });
    });
  }
  function load() { return call({ action: 'list' }).then(function (j) { if (j.ok) { setData(j); } else { setData({ error: j.error }); } }); }
  useEffect(function () { load(); }, []);
  function sync() {
    setBusy(true);
    call({ action: 'sync' }).then(function (j) {
      if (j.ok) { var c = j.counts || {}; toast.success('Synced: ' + c.records + ' warehouse orders checked — ' + c.created + ' new, ' + c.changed + ' changed, ' + c.unchanged + ' unchanged.'); if (props.onChanged) { props.onChanged(); } }
      else { toast.error(j.error || 'Sync failed — nothing stored was changed.'); }
      return load();
    }).finally(function () { setBusy(false); });
  }
  function setSwitch(on) {
    setBusy(true);
    call({ action: 'set_use_in_pnl', on: on }).then(function (j) { if (j.ok) { toast.success(on ? 'The P&L now uses the warehouse shipping costs.' : 'The P&L no longer uses the warehouse shipping costs.'); if (props.onChanged) { props.onChanged(); } } else { toast.error(j.error); } return load(); }).finally(function () { setBusy(false); });
  }
  function saveManual(r) {
    var kf = 'f:' + r.id; var kt = 't:' + r.id; var kn = 'n:' + r.id;
    setBusy(true);
    call({ action: 'set_manual', record_id: r.id, manual_freight: draft[kf] !== undefined ? draft[kf] : (r.manual_freight === null ? '' : r.manual_freight), manual_trucking: draft[kt] !== undefined ? draft[kt] : (r.manual_trucking === null ? '' : r.manual_trucking), note: draft[kn] !== undefined ? draft[kn] : (r.manual_note || '') })
      .then(function (j) { if (j.ok) { toast.success('Correction saved for ' + (r.release_number || 'order ' + r.order_id) + ' (kept in its history; a sync never overwrites it).'); if (props.onChanged) { props.onChanged(); } } else { toast.error(j.error); } return load(); }).finally(function () { setBusy(false); });
  }
  function openHistory(r) { call({ action: 'history', record_id: r.id }).then(function (j) { if (j.ok) { setHist({ row: r, list: j.history }); } else { toast.error(j.error); } }); }

  if (!data) { return <div className="text-[11px] mb-3" style={{ color: SUB }}>Loading the warehouse shipping costs…</div>; }
  if (data.error) { return <div className="text-[11px] mb-3 p-2 rounded" style={{ background: '#fef2f2', color: '#991b1b' }}>{'Warehouse shipping costs: ' + data.error}</div>; }
  if (data.setup_needed) { return <div className="text-[11px] mb-3 p-2 rounded" style={{ background: '#fff7ed', color: '#9a3412' }}>{'Warehouse shipping costs are not set up yet. ' + data.setup_message}</div>; }

  var rows = (data.rows || []).filter(function (r) { return r.section === 'main'; });
  var lastRun = (data.runs || [])[0] || null; var lastOk = data.last_success;
  var isStaging = /staging/i.test(String(data.feed_host || (lastRun && lastRun.source_host) || ''));
  var needle = q.trim().toLowerCase();
  function matchQ(r) { return !needle || [r.release_number, r.customer_name, String(r.order_id)].concat((r.invoice_matches || []).map(function (x) { return x.number; })).join(' ').toLowerCase().indexOf(needle) >= 0; }
  var openRows = rows.filter(function (r) { return r.is_open && r.order_created && r.order_created >= data.open_from && (!onlyShipped || SHIPPED_WAITING[r.status]) && matchQ(r); });
  var shippedRows = rows.filter(function (r) { return r.in_backfill && matchQ(r); });
  var reviewRows = rows.filter(function (r) { return (r.in_backfill || r.is_open) && (r.flags || []).some(function (f) { return f !== 'currency_not_recorded_assumed_usd'; }) && matchQ(r); });
  function sorted(list) {
    return list.slice().sort(function (a, b) {
      if (sortBy === 'oldest') { return String(a.order_created || '').localeCompare(String(b.order_created || '')); }
      if (sortBy === 'newest') { return String(b.ship_date || b.order_created || '').localeCompare(String(a.ship_date || a.order_created || '')); }
      if (sortBy === 'cost') { return (Number(b.combined_used) || 0) - (Number(a.combined_used) || 0); }
      return String(a.release_number || '').localeCompare(String(b.release_number || ''));
    });
  }
  function part(r, name) {
    var man = money(r['manual_' + name]); var used = money(r[name + '_used']); var est = money(r[name + '_estimate']); var fin = money(r[name + '_final']); var kind = r[name + '_kind'];
    return <div>
      <div className="font-bold" style={{ color: used === null && man === null ? '#b91c1c' : INK }}>{man !== null ? '$' + fmt(man) + ' corrected' : used === null ? 'missing' : '$' + fmt(used) + (kind === 'final' ? ' final' : ' quote')}</div>
      <div style={{ color: SUB, fontSize: 10 }}>{'quote ' + (est === null ? '—' : '$' + fmt(est)) + ' · final ' + (fin === null ? '—' : '$' + fmt(fin)) + (est !== null && fin !== null ? ' · Δ ' + (fin - est > 0 ? '+' : '') + fmt(fin - est) : '')}</div>
    </div>;
  }
  function combined(r) {
    var f = money(r.manual_freight) !== null ? money(r.manual_freight) : money(r.freight_used); var t = money(r.manual_trucking) !== null ? money(r.manual_trucking) : money(r.trucking_used);
    return f === null || t === null ? null : Math.round((f + t) * 100) / 100;
  }
  function flagList(r) { return (r.flags || []).filter(function (f) { return f !== 'currency_not_recorded_assumed_usd'; }).map(function (f) { return <div key={f}>{'• ' + (FLAG_TEXT[f] || f)}</div>; }); }
  function table(list, withEdit) {
    var heads = ['Release', 'Customer', 'Hub invoice(s)', 'Ordered', 'Shipped', 'Warehouse status', 'Age (days)', 'Freight', 'Trucking', 'Shipping expense', 'Final / provisional', 'Needs attention', 'Warehouse'];
    return <div className="overflow-auto rounded pl-scroll mt-2" style={{ border: '1px solid ' + LINE, maxHeight: '60vh' }}>
      <table className="w-full text-[11px]" style={{ minWidth: 1500 }}>
        <thead><tr>{heads.map(function (h) { return <th key={h} className="px-2 py-1.5 text-left font-bold sticky top-0" style={Object.assign({}, th, { zIndex: 2 })}>{h}</th>; })}</tr></thead>
        <tbody>{sorted(list).map(function (r, i) {
          var waiting = SHIPPED_WAITING[r.status]; var cmb = combined(r);
          return <tr key={r.id} style={{ background: waiting && r.is_open ? '#eff6ff' : (i % 2 ? '#f8fafc' : '#ffffff'), color: INK, borderTop: '1px solid ' + LINE, verticalAlign: 'top' }}>
            <td className="px-2 py-1.5 font-bold">{r.release_number || <span style={{ color: '#b91c1c' }}>none</span>}</td>
            <td className="px-2 py-1.5">{r.customer_name || '—'}</td>
            <td className="px-2 py-1.5">{(r.invoice_matches || []).length ? r.invoice_matches.map(function (x) { return x.number; }).join(', ') : <span style={{ color: '#b91c1c' }}>none</span>}{(r.review_only_invoices || []).length > 0 && <div style={{ color: '#b45309', fontSize: 10 }}>{'check: ' + r.review_only_invoices.map(function (x) { return x.number; }).join(', ') + ' (PO/SO field only)'}</div>}</td>
            <td className="px-2 py-1.5">{r.order_created || '—'}</td>
            <td className="px-2 py-1.5">{r.ship_date || '—'}{r.ship_date_basis && r.ship_date_basis !== 'shipped date' && <div style={{ color: '#b45309', fontSize: 10 }}>{r.ship_date_basis}</div>}{r.sailing_date && <div style={{ color: SUB, fontSize: 10 }}>{'sails ' + r.sailing_date + ' (not the ship date)'}</div>}</td>
            <td className="px-2 py-1.5">{statusWords(r.status)}{waiting && r.is_open && <div style={{ color: '#1d4ed8', fontWeight: 800, fontSize: 10 }}>SHIPPED — NOT CLOSED</div>}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{ageDays(r.order_created)}</td>
            <td className="px-2 py-1.5">{part(r, 'freight')}<div style={{ color: SUB, fontSize: 10 }}>{(r.freight_forwarder || '') + (r.shipping_line ? ' · ' + r.shipping_line : '')}</div></td>
            <td className="px-2 py-1.5">{part(r, 'trucking')}<div style={{ color: SUB, fontSize: 10 }}>{r.trucker_name || ''}</div></td>
            <td className="px-2 py-1.5 text-right tabular-nums font-bold">{cmb === null ? <span style={{ color: '#b91c1c' }}>missing</span> : '$' + fmt(cmb)}<div style={{ color: SUB, fontSize: 10, fontWeight: 400 }}>{r.currency ? r.currency + (r.currency_confirmed ? '' : ' (unconfirmed)') : ''}</div></td>
            <td className="px-2 py-1.5 font-bold" style={{ color: STATUS_COLOR[r.cost_status] || INK }}>{STATUS_LABEL[r.cost_status] || r.cost_status}</td>
            <td className="px-2 py-1.5" style={{ color: '#92400e', maxWidth: 320 }}>{flagList(r)}
              {withEdit && data.can_edit && <div className="mt-1 flex gap-1 items-center flex-wrap" style={{ color: INK }}>
                <input value={draft['f:' + r.id] !== undefined ? draft['f:' + r.id] : (r.manual_freight === null ? '' : String(r.manual_freight))} onChange={function (e) { var o = Object.assign({}, draft); o['f:' + r.id] = e.target.value; setDraft(o); }} placeholder="freight" className="nt-light rounded px-1 text-[10px]" style={Object.assign({ width: 64 }, inp)} title="Correct the freight for the P&L (blank = use the warehouse figure)" />
                <input value={draft['t:' + r.id] !== undefined ? draft['t:' + r.id] : (r.manual_trucking === null ? '' : String(r.manual_trucking))} onChange={function (e) { var o = Object.assign({}, draft); o['t:' + r.id] = e.target.value; setDraft(o); }} placeholder="trucking" className="nt-light rounded px-1 text-[10px]" style={Object.assign({ width: 64 }, inp)} title="Correct the trucking for the P&L (blank = use the warehouse figure)" />
                <input value={draft['n:' + r.id] !== undefined ? draft['n:' + r.id] : (r.manual_note || '')} onChange={function (e) { var o = Object.assign({}, draft); o['n:' + r.id] = e.target.value; setDraft(o); }} placeholder="why" className="nt-light rounded px-1 text-[10px]" style={Object.assign({ width: 110 }, inp)} />
                <button disabled={busy} onClick={function () { saveManual(r); }} className="px-1.5 rounded text-[10px] font-extrabold" style={{ background: '#7c2d12', color: '#ffffff' }}>save</button>
              </div>}
              <button onClick={function () { openHistory(r); }} className="mt-1 text-[10px] underline" style={{ color: '#1d4ed8' }}>history</button></td>
            <td className="px-2 py-1.5">{r.source_link ? <a href={r.source_link} target="_blank" rel="noreferrer" style={{ color: '#1d4ed8', fontWeight: 700 }}>{'order ' + r.order_id}</a> : 'order ' + r.order_id}</td>
          </tr>; })}
          {list.length === 0 && <tr><td colSpan={13} className="px-2 py-4 text-center" style={{ color: SUB, background: '#ffffff' }}>Nothing to show.</td></tr>}</tbody>
      </table></div>;
  }
  function Btn(p) { return <button onClick={p.onClick} disabled={p.disabled || busy} className="px-3 py-1.5 rounded-lg text-[11px] font-extrabold" style={{ background: p.on ? '#1d4ed8' : (p.bg || '#ffffff'), color: p.on ? '#ffffff' : (p.color || '#1e3a8a'), border: '1px solid #93c5fd', opacity: (p.disabled || busy) ? 0.5 : 1 }}>{p.children}</button>; }

  var totalsLine = (function () { var c = lastOk && lastRun && lastRun.ok ? (lastRun.counts || {}) : null; if (!c) { return null; } var t = c.backfill_totals_by_currency || {}; return Object.keys(t).map(function (k) { return k + ': $' + fmt(t[k].combined) + ' (freight $' + fmt(t[k].freight) + ' + trucking $' + fmt(t[k].trucking) + ', ' + t[k].orders + ' orders)'; }).join(' · '); })();

  return <div className="mb-3 p-3 rounded-xl" style={{ background: '#f8fafc', border: '1px solid ' + LINE, color: INK }}>
    <div className="flex flex-wrap gap-2 items-center">
      <div className="text-[12px] font-extrabold mr-2">🚢 Shipping costs from the Nextrade warehouse</div>
      <span className="px-2 py-0.5 rounded text-[10px] font-extrabold" style={{ background: isStaging ? '#fef3c7' : '#fee2e2', color: isStaging ? '#92400e' : '#991b1b' }}>{(isStaging ? 'SOURCE: STAGING COPY — ' : 'SOURCE: ') + (data.feed_host || (lastRun && lastRun.source_host) || 'not set up')}</span>
      {data.can_edit && <Btn bg="#1d4ed8" color="#ffffff" onClick={sync}>{busy ? 'Working…' : '↻ Sync Shipping Costs'}</Btn>}
      <Btn on={show === 'open'} onClick={function () { setShow(show === 'open' ? '' : 'open'); }}>{'Open Orders — Last 2 Years (' + rows.filter(function (r) { return r.is_open && r.order_created >= data.open_from; }).length + ')'}</Btn>
      <Btn on={show === 'shipped'} onClick={function () { setShow(show === 'shipped' ? '' : 'shipped'); }}>{'Shipped since ' + data.backfill_from + ' (' + rows.filter(function (r) { return r.in_backfill; }).length + ')'}</Btn>
      <Btn on={show === 'review'} onClick={function () { setShow(show === 'review' ? '' : 'review'); }}>{'Review queue (' + rows.filter(function (r) { return (r.in_backfill || r.is_open) && (r.flags || []).some(function (f) { return f !== 'currency_not_recorded_assumed_usd'; }); }).length + ')'}</Btn>
    </div>
    <div className="text-[11px] mt-2" style={{ color: SUB }}>
      {'Last successful check: ' + (lastOk ? new Date(lastOk.finished_at).toLocaleString() : 'never') + '. Runs automatically every 3 hours (and on the button).'}
      {lastRun && lastRun.ok === false && <span style={{ color: '#b91c1c', fontWeight: 800 }}>{' LAST CHECK FAILED (' + new Date(lastRun.started_at).toLocaleString() + '): ' + (lastRun.error || '') + ' — the figures below are from the last successful check.'}</span>}
      {totalsLine && <div>{'Shipped since ' + data.backfill_from + ', shipping expense in use: ' + totalsLine + '. The warehouse does not record a currency — USD is assumed, not confirmed.'}</div>}
      <div>{'Shipping expense = freight + trucking. A wire in "Closed" replaces the quote only when it looks like this order’s payment; otherwise the quote stays and the order is listed in the review queue. A missing part stays missing — never zero.'}</div>
      <div className="mt-1 flex gap-2 items-center flex-wrap">
        <span style={{ fontWeight: 800, color: props.warehouseOn ? '#166534' : '#92400e' }}>{props.warehouseOn ? '✓ The P&L numbers USE these costs (where no Hub bill covers them).' : 'The P&L numbers do NOT use these costs yet — they are shown for checking.'}</span>
        <Btn onClick={function () { setSwitch(!props.warehouseOn); }}>{props.warehouseOn ? 'Stop using them' : 'Use them in the P&L (super admin)'}</Btn>
      </div>
    </div>
    {show && <div className="mt-2 flex gap-2 items-center flex-wrap text-[11px]">
      <input value={q} onChange={function (e) { setQ(e.target.value); }} placeholder="find release, customer, invoice" className="nt-light px-2 py-1 rounded" style={Object.assign({ width: 220 }, inp)} />
      <span>Sort:</span><select value={sortBy} onChange={function (e) { setSortBy(e.target.value); }} className="nt-light rounded px-1 py-0.5" style={inp}><option value="oldest">oldest outstanding first</option><option value="newest">newest first</option><option value="cost">largest shipping expense</option><option value="release">release number</option></select>
      {show === 'open' && <label><input type="checkbox" checked={onlyShipped} onChange={function (e) { setOnlyShipped(e.target.checked); }} />{' only shipped orders waiting to be closed (blue rows)'}</label>}
    </div>}
    {show === 'open' && <div className="text-[11px] mt-1" style={{ color: SUB }}>{'Included: every warehouse order that is not Closed, with an ORDER CREATED date on or after ' + data.open_from + '. Age = days since the order was created.'}</div>}
    {show === 'open' && table(openRows, true)}
    {show === 'shipped' && <div className="text-[11px] mt-1" style={{ color: SUB }}>{'Included: orders at Shipped or later whose ship date (the shipped date, else the load date — never the sailing date) is on or after ' + data.backfill_from + ', open and closed.'}</div>}
    {show === 'shipped' && table(shippedRows, true)}
    {show === 'review' && table(reviewRows, true)}
    {hist && <div className="mt-2 p-2 rounded" style={{ background: '#ffffff', border: '1px solid ' + LINE }}>
      <div className="flex justify-between text-[11px] font-extrabold"><span>{'History — ' + (hist.row.release_number || 'order ' + hist.row.order_id)}</span><button onClick={function () { setHist(null); }}>✕</button></div>
      {(hist.list || []).map(function (h) { return <div key={h.id} className="text-[10px] mt-1" style={{ color: SUB }}>{new Date(h.changed_at).toLocaleString() + ' · ' + h.kind + (h.changed_by ? ' (by a person)' : ' (sync)') + ': ' + Object.keys(h.changes || {}).map(function (k) { var c = h.changes[k]; return c && typeof c === 'object' && 'to' in c ? k + ' ' + JSON.stringify(c.from) + ' → ' + JSON.stringify(c.to) : k + ' ' + JSON.stringify(c); }).join('; ')}</div>; })}
      {(hist.list || []).length === 0 && <div className="text-[10px]" style={{ color: SUB }}>No history yet.</div>}
    </div>}
  </div>;
}
