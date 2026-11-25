'use client';
// v55.83-VN — CUSTOMERS OVERVIEW (Max, Nov 19 2026): every customer for a period — invoiced, paid on those invoices, received in
// the period, still owed, overdue — open a customer to see its invoices (paid / partially paid / unpaid) and the warehouse
// arrival date, red while an arrived shipment is still unpaid. All figures come from the server (src/lib/customers-overview.js).
import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import InvoicePeek from './InvoicePeek';
import { presetRange, owesOrUnknown, invoiceTone, customerTone, SMALL_OPEN_USD } from '../lib/customers-overview';

var INK = '#0f172a'; var SUB = '#475569'; var LINE = '#cbd5e1';
function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
var PRESETS = [['month', 'Last 30 days'], ['quarter', 'Last 3 months'], ['year', 'This year'], ['june', 'Since 1 June 2026'], ['all', 'All'], ['custom', 'Custom dates']];
var TONE = {
  green: { background: '#86efac', boxShadow: 'inset 5px 0 0 #15803d' },
  yellow: { background: '#fde047', boxShadow: 'inset 5px 0 0 #a16207' },
  smallBalance: { background: '#f0fdf4', boxShadow: 'inset 4px 0 0 #bbf7d0' }
};
var STATUS = { paid: ['Paid', '#065f46', '#d1fae5'], partial: ['Partially paid', '#92400e', '#fef3c7'], unpaid: ['Unpaid', '#991b1b', '#fee2e2'], limited: ['Payments before your history — not shown', '#334155', '#e2e8f0'] };

// the table and the opened customer — no state of its own, so it can be rendered and checked on its own
export function CustomersOverviewView(p) {
  var rep = p.report; var sym = rep.currency === 'EGP' ? 'EGP ' : '$';
  var q = String(p.search || '').trim().toLowerCase();
  var rows = (rep.rows || []).filter(function (r) { return !q || String(r.name).toLowerCase().indexOf(q) >= 0; }).filter(function (r) { return !p.onlyOwing || owesOrUnknown(r); });
  // a figure that is only the known part says so; one that is not known at all says "not shown" — never a plain zero
  function part(v, r) { return v === null || v === undefined ? 'not shown' : sym + fmt(v) + (r.balance_incomplete ? ' (known part)' : ''); }
  function overdueInk(amount) { return rep.currency === 'USD' && amount > 0 && amount <= SMALL_OPEN_USD ? '#991b1b' : '#b45309'; }
  var head = [['Customer', 'left'], ['Invoices', 'right'], ['Invoiced in the period', 'right'], ['Paid on those invoices (to date)', 'right'], ['Received in the period', 'right'], ['Still owed on those invoices (today)', 'right'], ['Overdue (today)', 'right']];
  function invoiceTable(r) {
    return <table className="w-full text-[11px]" style={{ background: '#ffffff', border: '1px solid ' + LINE }}>
      <thead><tr style={{ background: '#f1f5f9', color: '#334155' }}>{['Invoice', 'Date', 'Release', 'Arrival date', 'Status', 'Total', 'Paid', 'Left to pay', 'Due'].map(function (h, i) { return <th key={h} className={'px-2 py-1 font-bold ' + (i >= 5 && i <= 7 ? 'text-right' : 'text-left')}>{h}</th>; })}</tr></thead>
      <tbody>{r.invoices.map(function (v) {
        var s = STATUS[v.status] || STATUS.unpaid;
        var tone = invoiceTone(v);
        return <tr key={v.id} onClick={function () { p.onOpenInvoice(v.id); }} title="Open this invoice" style={Object.assign({ borderTop: '1px solid ' + LINE, color: INK, cursor: 'pointer' }, TONE[tone] || {})}>
          <td className="px-2 py-1 font-bold" style={{ color: '#1d4ed8', textDecoration: 'underline' }}>{v.number || '(no number)'}</td>
          <td className="px-2 py-1">{v.invoice_date}</td>
          <td className="px-2 py-1">{v.release || '—'}</td>
          <td className="px-2 py-1" style={v.arrival_red ? { color: '#ffffff', background: '#dc2626', fontWeight: 800 } : { color: INK }}>{v.arrival_date ? (v.arrival_partial ? (v.arrival_date + ' · only some releases have a date — not known for the whole invoice') : (v.arrival_date + (v.arrived ? (v.arrival_red ? ' · ARRIVED, not paid' : ' · arrived') : ' · expected'))) : 'No date recorded'}</td>
          <td className="px-2 py-1">
            {tone === 'smallBalance' ? (
              v.status === 'partial' && <span className="font-bold" style={{ color: '#14532d' }}>{s[0]}</span>
            ) : <span className="px-1.5 py-0.5 rounded font-extrabold" style={{ color: s[1], background: s[2] }}>{s[0]}</span>}
            {v.overpaid > 0 && <span style={{ color: SUB }}>{' · overpaid ' + sym + fmt(v.overpaid)}</span>}
          </td>
          <td className="px-2 py-1 text-right tabular-nums">{sym + fmt(v.total)}</td>
          <td className="px-2 py-1 text-right tabular-nums">{v.paid === null ? 'not shown' : sym + fmt(v.paid)}{v.paid_in_wave_undated > 0 && <div style={{ color: SUB, fontSize: 9 }}>{sym + fmt(v.paid_in_wave_undated) + ' paid in Wave, date not recorded'}</div>}</td>
          <td className="px-2 py-1 text-right tabular-nums font-extrabold" style={{ color: v.balance > 0 ? '#991b1b' : (v.balance === null ? SUB : '#065f46') }}>{v.balance === null ? 'not shown' : (v.balance > 0 ? sym + fmt(v.balance) : '—')}</td>
          <td className="px-2 py-1">{v.due_date || '—'}{v.days_overdue > 0 && <span style={{ color: '#b45309', fontWeight: 800 }}>{' · ' + v.days_overdue + ' day(s) late'}</span>}</td>
        </tr>; })}
        {r.invoices.length === 0 && <tr><td colSpan={9} className="px-2 py-2" style={{ color: SUB }}>No invoice dated in this period — the amount received was on other invoices (older ones, or ones dated after the period).</td></tr>}</tbody>
    </table>;
  }
  return <div>
    <div className="overflow-auto rounded" style={{ border: '1px solid ' + LINE, maxHeight: '70vh' }}>
      <table className="w-full text-[12px]" style={{ minWidth: 980 }}>
        <thead><tr style={{ background: '#0f172a', color: '#ffffff', position: 'sticky', top: 0 }}>{head.map(function (h) { return <th key={h[0]} className={'px-2 py-2 font-bold text-' + h[1]}>{h[0]}</th>; })}</tr></thead>
        <tbody>{rows.map(function (r, i) {
          var key = r.customer_id || r.name; var isOpen = p.open === key;
          var tone = customerTone(r);
          var out = [<tr key={key} onClick={function () { p.onOpen(isOpen ? null : key); }} title={isOpen ? 'Close' : 'Show the invoices of ' + r.name} style={Object.assign({ background: isOpen ? '#e0f2fe' : (i % 2 ? '#f8fafc' : '#ffffff'), color: INK, borderTop: '1px solid ' + LINE, cursor: 'pointer' }, TONE[tone] || {})}>
            <td className="px-2 py-1.5 font-bold">{(isOpen ? '▾ ' : '▸ ') + r.name}{r.arrived_unpaid > 0 && <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-extrabold" style={{ color: '#ffffff', background: '#dc2626' }}>{r.arrived_unpaid + ' arrived, not paid'}</span>}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{r.invoice_count}{r.open_count > 0 && <span style={{ color: SUB }}>{' · ' + r.open_count + ' open'}</span>}{r.limited_count > 0 && <div style={{ color: '#92400e', fontSize: 9, fontWeight: 700 }}>{r.limited_count + ' not in paid / owed (payments before your history)'}</div>}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{sym + fmt(r.invoiced)}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{part(r.paid_on_those, r)}{r.paid_in_wave_undated > 0 && <div style={{ color: SUB, fontSize: 9 }}>{sym + fmt(r.paid_in_wave_undated) + ' of it paid in Wave, date not recorded'}</div>}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{sym + fmt(r.received)}{r.received_on_older > 0 && <div style={{ color: SUB, fontSize: 9 }}>{sym + fmt(r.received_on_older) + ' of it on older invoices'}</div>}{r.received_on_other > 0 && <div style={{ color: SUB, fontSize: 9 }}>{sym + fmt(r.received_on_other) + ' of it on invoices dated after the period, or with no date'}</div>}</td>
            <td className="px-2 py-1.5 text-right tabular-nums font-extrabold" style={{ color: r.owed > 0 ? '#991b1b' : (r.balance_incomplete ? '#92400e' : '#065f46') }}>{part(r.owed, r)}</td>
            <td className="px-2 py-1.5 text-right tabular-nums" style={{ color: r.overdue > 0 ? overdueInk(r.overdue) : SUB, fontWeight: r.overdue > 0 ? 800 : 400 }}>{r.overdue === null ? 'not shown' : (r.overdue > 0 ? sym + fmt(r.overdue) + ' (' + r.overdue_count + ')' + (r.balance_incomplete ? ' (known part)' : '') : (r.balance_incomplete ? 'not known' : '—'))}</td>
          </tr>];
          if (isOpen) { out.push(<tr key={key + ':open'}><td colSpan={7} className="px-3 py-2" style={{ background: '#f0f9ff', borderTop: '1px solid #7dd3fc' }}>{invoiceTable(r)}</td></tr>); }
          return out; })}
          {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-4 text-center" style={{ color: SUB }}>No customers for these dates.</td></tr>}
          {rep.totals && <tr style={{ background: '#e2e8f0', color: INK, fontWeight: 800, borderTop: '2px solid #64748b' }}>
            <td className="px-2 py-2">{'All ' + rep.totals.customers + ' customers'}</td>
            <td className="px-2 py-2 text-right tabular-nums">{rep.totals.invoice_count}{rep.totals.limited_count > 0 && <div style={{ color: '#92400e', fontSize: 9 }}>{rep.totals.limited_count + ' not in paid / owed'}</div>}</td>
            <td className="px-2 py-2 text-right tabular-nums">{sym + fmt(rep.totals.invoiced)}</td>
            <td className="px-2 py-2 text-right tabular-nums">{part(rep.totals.paid_on_those, rep.totals)}</td>
            <td className="px-2 py-2 text-right tabular-nums">{sym + fmt(rep.totals.received)}</td>
            <td className="px-2 py-2 text-right tabular-nums" style={{ color: '#991b1b' }}>{part(rep.totals.owed, rep.totals)}</td>
            <td className="px-2 py-2 text-right tabular-nums" style={{ color: overdueInk(rep.totals.overdue) }}>{part(rep.totals.overdue, rep.totals)}</td>
          </tr>}
        </tbody>
      </table>
    </div>
    {(rep.rows || []).some(function (r) { return r.limited_count > 0; }) && <div className="text-[11px] mt-1 font-bold rounded p-1.5" style={{ color: '#92400e', background: '#fef3c7', border: '1px solid #fcd34d' }}>Some invoices have payments from before the history you can see. Their paid and left-to-pay are not shown, and they are NOT counted in paid, owed or overdue — so those figures are a known part only, not the full amount. These customers stay in the list when “only customers who still owe” is ticked.</div>}
    {rep.totals_masked && <div className="text-[11px] mt-1" style={{ color: SUB }}>The grand total row is shown only to people with the “see totals” switch.{rep.other_currencies_exist ? ' Some invoices in another currency are not in this list.' : ''}</div>}
    {(rep.other_currencies || []).length > 0 && <div className="text-[11px] mt-1 font-bold" style={{ color: '#92400e' }}>{'Not in these figures (other currency, never added in): ' + rep.other_currencies.map(function (c) { return c.count + ' invoice(s) in ' + c.currency + ' = ' + fmt(c.invoiced); }).join(' · ')}</div>}
  </div>;
}

export default function CustomersOverviewTab(props) {
  var userProfile = props.userProfile; var toast = props.toast; var onGo = props.onGo;
  var s1 = useState('year'); /* v55.83-YL (Max, Nov 24: "default to this year") */ var preset = s1[0]; var setPreset = s1[1];
  var s2 = useState(''); var from = s2[0]; var setFrom = s2[1];
  var s3 = useState(''); var to = s3[0]; var setTo = s3[1];
  var s4 = useState('US'); var biz = s4[0]; var setBiz = s4[1];
  var s5 = useState(null); var report = s5[0]; var setReport = s5[1];
  var s6 = useState(false); var busy = s6[0]; var setBusy = s6[1];
  var s7 = useState(''); var err = s7[0]; var setErr = s7[1];
  var s8 = useState(null); var open = s8[0]; var setOpen = s8[1];
  var s9 = useState(''); var search = s9[0]; var setSearch = s9[1];
  var s10 = useState(false); var onlyOwing = s10[0]; var setOnlyOwing = s10[1];
  var s11 = useState(null); var peekId = s11[0]; var setPeekId = s11[1];

  function load(pr, f, t, b) {
    var today = new Date().toISOString().substring(0, 10);
    var rng = presetRange(pr, today) || { from: f, to: t };
    setBusy(true); setErr('');
    return supabase.auth.getSession().then(function (sres) {
      var token = sres && sres.data && sres.data.session ? sres.data.session.access_token : '';
      return fetch('/api/accounting/customers-overview', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ user_id: userProfile && userProfile.id, date_from: rng.from || null, date_to: rng.to || null, business: b }) });
    }).then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
      .then(function (x) { if (!x.j || x.j.ok !== true) { setReport(null); setErr((x.j && x.j.error) || 'The report could not be loaded.'); } else { setReport(x.j); setOpen(null); } })
      .catch(function (e) { setReport(null); setErr((e && e.message) || 'The report could not be loaded.'); if (toast && toast.error) { toast.error('Customers overview could not be loaded'); } })
      .then(function () { setBusy(false); });
  }
  useEffect(function () { load(preset, from, to, biz); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function pick(pr) { setPreset(pr); if (pr !== 'custom') { load(pr, from, to, biz); } }
  var hd = { background: '#f1f5f9', color: '#334155', border: '1px solid ' + LINE };
  var on = { background: '#0f172a', color: '#ffffff', border: '1px solid #0f172a' };
  return <div className="p-3 rounded-lg" style={{ color: INK, background: '#f8fafc' }}>
    <div className="flex items-center gap-2 flex-wrap mb-2">
      <h2 className="text-[15px] font-extrabold">👥 Customers overview</h2>
      <span className="text-[11px]" style={{ color: SUB }}>What each customer was invoiced, has paid and still owes. Click a customer to see the invoices.</span>
    </div>
    <div className="flex items-center gap-1.5 flex-wrap mb-2 text-[12px]">
      <b>Period:</b>
      {PRESETS.map(function (x) { return <button key={x[0]} onClick={function () { pick(x[0]); }} className="px-2.5 py-1 rounded-lg font-extrabold" style={preset === x[0] ? on : hd}>{x[1]}</button>; })}
      {preset === 'custom' && <span className="flex items-center gap-1">
        <input type="date" value={from} onChange={function (e) { setFrom(e.target.value); }} aria-label="From date" className="nt-light px-2 py-1 rounded" style={{ border: '1px solid ' + LINE, background: '#ffffff', color: INK }} />
        <span>to</span>
        <input type="date" value={to} onChange={function (e) { setTo(e.target.value); }} aria-label="To date" className="nt-light px-2 py-1 rounded" style={{ border: '1px solid ' + LINE, background: '#ffffff', color: INK }} />
        <button onClick={function () { load('custom', from, to, biz); }} className="px-2.5 py-1 rounded-lg font-extrabold" style={{ background: '#1d4ed8', color: '#ffffff' }}>Apply</button>
      </span>}
      <span className="ml-2"><b>Side:</b></span>
      {[['US', '🇺🇸 USA (dollars)'], ['EG', '🇪🇬 Egypt (pounds)']].map(function (x) { return <button key={x[0]} onClick={function () { setBiz(x[0]); load(preset, from, to, x[0]); }} className="px-2.5 py-1 rounded-lg font-extrabold" style={biz === x[0] ? on : hd}>{x[1]}</button>; })}
    </div>
    <div className="flex items-center gap-2 flex-wrap mb-2 text-[12px]">
      <input type="search" value={search} onChange={function (e) { setSearch(e.target.value); }} placeholder="🔎 Search a customer…" aria-label="Search a customer" className="nt-light px-2.5 py-1.5 rounded-lg" style={{ width: 260, border: '1px solid ' + LINE, background: '#ffffff', color: INK }} />
      <label className="flex items-center gap-1 font-bold"><input type="checkbox" checked={onlyOwing} onChange={function () { setOnlyOwing(!onlyOwing); }} /> Only customers who still owe (or whose balance is not shown)</label>
      {busy && <span style={{ color: SUB }}>Loading…</span>}
      {report && <span style={{ color: SUB }}>{(report.from || 'the start') + ' → ' + (report.to || 'today')}{report.window_floor ? ' · you can see from ' + report.window_floor + ' onward' : ''}</span>}
    </div>
    <div className="flex items-center gap-2 flex-wrap text-[11px] mb-2" style={{ color: INK }}>
      <span className="px-2 py-0.5 rounded font-extrabold" style={{ background: '#86efac', color: '#052e16', border: '1px solid #15803d' }}>Green = arrived and fully paid</span>
      {biz === 'US' && <span className="px-2 py-0.5 rounded font-extrabold" style={{ background: TONE.smallBalance.background, color: '#14532d', border: '1px solid #bbf7d0' }}>Light green = $200 or less still owed</span>}
      <span className="px-2 py-0.5 rounded font-extrabold" style={{ background: '#fde047', color: '#422006', border: '1px solid #a16207' }}>Yellow = partially paid{biz === 'US' ? ', more than $200 owed' : ''}</span>
      <span className="px-2 py-0.5 rounded font-extrabold" style={{ background: '#dc2626', color: '#ffffff' }}>{report && report.currency === 'EGP' ? 'Red date = arrived, not paid' : 'Red date = arrived, not paid (more than $200 still owed)'}</span>
      <span style={{ color: SUB }}>A fully paid customer row is green when every invoice in the period has arrived.</span>
    </div>
    {err && <div className="text-[12px] font-bold rounded-lg p-2 mb-2" style={{ color: '#991b1b', background: '#fee2e2', border: '1px solid #fca5a5' }}>{err}</div>}
    {report && report.warehouse_is_staging && !report.warehouse_note && <div className="text-[11px] font-bold rounded-lg p-2 mb-2" style={{ color: '#92400e', background: '#fef3c7', border: '1px solid #fcd34d' }}>Arrival dates come from the STAGING copy of the Nextrade warehouse, not the live one yet. Treat them as a guide until the live feed is switched on.</div>}
    {report && report.warehouse_note && <div className="text-[11px] font-bold mb-2" style={{ color: '#92400e' }}>{report.warehouse_note}</div>}
    {report && <CustomersOverviewView report={report} open={open} onOpen={setOpen} search={search} onlyOwing={onlyOwing} onOpenInvoice={setPeekId} />}
    {report && <div className="text-[10px] mt-2" style={{ color: SUB }}>Invoiced, paid and owed are for invoices DATED in the period; paid and owed are as of TODAY, not as of the end of the period. Received is money dated in the period, on any invoice. Money recorded in Wave before the Hub has no date, so it counts as paid but cannot be placed in a period.</div>}
    {peekId && <InvoicePeek invoiceId={peekId} onClose={function () { setPeekId(null); }} onEdit={function (id2) { try { window.__ntOpenInvoiceEdit = id2; window.dispatchEvent(new CustomEvent('nt-open-invoice-edit', { detail: id2 })); } catch (e4) {} setPeekId(null); if (onGo) { onGo('invoices'); } }} />}
  </div>;
}
