'use client';
// v55.83-TI — 🚚 ORDERS: stage, what is missing, invoice, deposit, the 30-hour deadline, and a report per order (Max, Nov 16 2026).
// Stage (where the order is in the warehouse) is shown APART from readiness (what blocks it). Everything is worked out on the
// server from the Nextrade warehouse + the Hub's own records (lib/order-lifecycle.js); this screen only shows it and records a
// person's decisions (deposit not required, a deposit matched to an order, overrides, a manual close) — each with a reason.
import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

var INK = '#14202e'; var SUB = '#5b6676'; var LINE = '#dfe3ea'; var BG = '#f6f7f9';
var S = { done: ['#157347', '#e3f4ea'], prog: ['#1f5fbf', '#e6eefb'], wait: ['#a35a00', '#fdf1df'], blocked: ['#b42318', '#fde8e6'], na: ['#6b7380', '#eef0f3'] };
var STAGES = [['pending', 'Order created'], ['preload', 'Pre-load Ready'], ['shipping_in_process', 'Shipping In Process'], ['shipped', 'Shipped'], ['post_loading_documentation', 'Post-loading docs'], ['end_stage', 'End stage'], ['closed', 'Closed']];
var STATUS_WORDS = { done: 'Completed', missing: 'Missing', waiting: 'Waiting', na: 'Not applicable' };
var INV_KEY = { current: 'done', in_approval: 'wait', draft_only: 'wait', awaiting: 'na', po_so_only: 'blocked', cancelled_only: 'blocked', missing_overdue: 'blocked' };
var INV_WORDS = { current: 'Current', in_approval: 'In approval', draft_only: 'Draft only', awaiting: 'Awaiting invoice', po_so_only: 'Wrongly linked', cancelled_only: 'Cancelled only', missing_overdue: 'Missing — overdue' };
var DEP_KEY = { received: 'done', partial: 'blocked', not_received: 'blocked', not_required: 'na', unknown: 'wait' };
var DEP_WORDS = { received: 'Received', partial: 'Partly received', not_received: 'Not received', not_required: 'Not required', unknown: 'Amount not set' };
var DL_WORDS = { on_track: 'on track', due_soon: 'deadline soon', missed: '30-h deadline missed', overdue_unshipped: 'scheduled time passed', short_notice: 'short notice', reached: 'reached in time', reached_late: 'reached late', shipped: 'shipped', no_schedule: 'no load date/time', not_applicable: '' };
function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function nd(d) { var m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/); if (!m) { return d || '—'; } var h = m[4] ? ' ' + ((+m[4] % 12) || 12) + ':' + m[5] + (+m[4] < 12 ? ' AM' : ' PM') : ''; return MON[+m[2] - 1] + ' ' + (+m[3]) + h; }
function when(iso) { if (!iso) { return 'never'; } try { return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)); } catch (e) { return String(iso); } }
function Pill(p) { var c = S[p.k] || S.na; return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap" style={{ color: c[0], background: c[1] }}><span style={{ width: 6, height: 6, borderRadius: 9, background: c[0] }} />{p.children}</span>; }
function Btn(p) { return <button type="button" onClick={p.onClick} disabled={p.disabled} className="px-2.5 py-1 rounded-lg text-[11px] font-bold" style={Object.assign({ background: p.dark ? INK : '#ffffff', color: p.dark ? '#ffffff' : INK, border: '1px solid ' + (p.dark ? INK : LINE), opacity: p.disabled ? 0.5 : 1 }, p.style || {})}>{p.children}</button>; }

export default function OrderMonitorTab(props) {
  var userProfile = props.userProfile; var toast = props.toast || { success: function () {}, error: function () {} };
  var s1 = useState(null); var data = s1[0]; var setData = s1[1];
  var s2 = useState(false); var busy = s2[0]; var setBusy = s2[1];
  var s3 = useState(''); var err = s3[0]; var setErr = s3[1];
  var s4 = useState('all'); var filter = s4[0]; var setFilter = s4[1];
  var s5 = useState(''); var q = s5[0]; var setQ = s5[1];
  var s6 = useState(null); var openId = s6[0]; var setOpenId = s6[1];
  var s7 = useState(null); var rep = s7[0]; var setRep = s7[1];
  var s8 = useState({}); var form = s8[0]; var setForm = s8[1];
  var s9 = useState(false); var showSet = s9[0]; var setShowSet = s9[1];

  function call(payload) {
    return supabase.auth.getSession().then(function (sres) {
      var token = sres && sres.data && sres.data.session ? sres.data.session.access_token : '';
      return fetch('/api/accounting/order-monitor', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(Object.assign({ user_id: userProfile && userProfile.id }, payload)) });
    }).then(function (r) { return r.json().catch(function () { return { ok: false, error: 'The server did not answer properly (HTTP ' + r.status + ').' }; }); })
      .catch(function (e) { return { ok: false, error: 'Could not reach the server (' + ((e && e.message) || 'network') + ').' }; });
  }
  function load() { setBusy(true); setErr(''); call({ action: 'report' }).then(function (j) { if (j && j.ok) { setData(j); } else { setErr((j && j.error) || 'Could not load the orders.'); } }).finally(function () { setBusy(false); }); }
  function openOrder(id) { setOpenId(id); setRep(null); setForm({}); call({ action: 'order', order_id: id }).then(function (j) { if (j && j.ok) { setRep(j); } else { setErr((j && j.error) || 'Could not load the order.'); setOpenId(null); } }); }
  useEffect(function () {
    load();
    try { var m = String(window.location.search || '').match(/[?&]order=(\d+)/); if (m) { openOrder(Number(m[1])); } } catch (e) { /* no deep link */ }
  }, []); // eslint-disable-line
  function act(payload, okMsg) { setBusy(true); return call(payload).then(function (j) { if (j && j.ok) { toast.success(okMsg); setForm({}); if (openId) { openOrder(openId); } load(); return true; } toast.error((j && j.error) || 'It did not go through.'); return false; }).finally(function () { setBusy(false); }); }

  if (!data) { return <div className="rounded-xl p-4" style={{ background: '#ffffff', border: '1px solid ' + LINE, color: INK }}>{err ? <div className="text-[12px] font-bold" style={{ color: '#b42318' }}>{'⛔ ' + err}</div> : <div className="text-[12px]" style={{ color: SUB }}>Reading the warehouse and the Hub…</div>}</div>; }

  var rows = data.rows || [];
  var FILTERS = [['all', 'All open'], ['deadline', 'Deadline'], ['invoice', 'Invoice problems'], ['deposit', 'Deposit'], ['shipped', 'Shipped — outstanding'], ['close', 'Ready to close']];
  function inF(r) {
    if (filter === 'deadline' && ['missed', 'overdue_unshipped', 'due_soon', 'short_notice', 'no_schedule'].indexOf(r.deadline.state) < 0) { return false; }
    if (filter === 'invoice' && !(r.invoice.severe || ['po_so_only', 'cancelled_only', 'missing_overdue', 'draft_only'].indexOf(r.invoice.state) >= 0)) { return false; }
    if (filter === 'deposit' && !(r.deposit.blocked || r.deposit.status === 'unknown')) { return false; }
    if (filter === 'shipped' && !r.shipped_outstanding) { return false; }
    if (filter === 'close' && !r.closable) { return false; }
    var t = q.trim().toLowerCase(); if (t && (String(r.release_number) + ' ' + r.id + ' ' + (r.customer || '') + ' ' + (r.country || '')).toLowerCase().indexOf(t) < 0) { return false; }
    return true;
  }
  var shown = rows.filter(inF).sort(function (a, b) { var w = function (r) { return r.readiness.key === 'blocked' ? 0 : (r.invoice.severe ? 1 : (r.readiness.key === 'wait' ? 2 : 3)); }; return w(a) - w(b) || String(a.scheduled || '9').localeCompare(String(b.scheduled || '9')); });
  var k = { dead: rows.filter(function (r) { return ['missed', 'overdue_unshipped', 'due_soon', 'short_notice'].indexOf(r.deadline.state) >= 0; }).length, inv: rows.filter(function (r) { return r.invoice.state === 'missing_overdue'; }).length,
    dep: rows.filter(function (r) { return r.deposit.blocked; }).length, shipped: rows.filter(function (r) { return r.shipped_outstanding; }).length, close: rows.filter(function (r) { return r.closable; }).length };
  var runs = data.runs || {}; var set = data.settings || {};

  return <div className="grid gap-3" style={{ color: INK }}>
    <div className="rounded-xl" style={{ background: '#ffffff', border: '1px solid ' + LINE }}>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid ' + LINE, background: BG }}>
        <b className="text-[14px]">🚚 Orders — stage and what is missing</b>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: data.source === 'nextrade-staging' ? '#fdf1df' : '#e3f4ea', color: data.source === 'nextrade-staging' ? '#a35a00' : '#157347' }}>{data.source === 'nextrade-staging' ? 'WAREHOUSE STAGING COPY' : 'LIVE WAREHOUSE'}</span>
        <div className="flex-1" />
        <span className="text-[11px]" style={{ color: SUB }}>{'Overnight review: ' + (runs.last_ok_nightly ? when(runs.last_ok_nightly) + ' ✓' : 'not run yet') + ' · 30-hour check: ' + (runs.last_ok_deadline ? when(runs.last_ok_deadline) : 'not run yet') + ' · alerts ' + (set.alerts_enabled === true ? 'ON' : 'OFF')}</span>
        {runs.nightly && runs.nightly.ok === false && <span className="text-[11px] font-bold" style={{ color: '#b42318' }}>{'⛔ last review failed: ' + (runs.nightly.error || '')}</span>}
        <Btn onClick={load} disabled={busy}>{busy ? 'Reading…' : '↻ Refresh'}</Btn>
        {data.is_super_admin && <Btn onClick={function () { setShowSet(!showSet); }}>⚙ Alerts & closing</Btn>}
      </div>
      {!data.tables_ready && <div className="px-3 py-2 text-[12px] font-bold" style={{ background: '#fdf1df', color: '#a35a00' }}>{'Deposit decisions, overrides, alerts and the overnight review need one SQL first: ' + data.sql_hint}</div>}
      {data.history_in_feed === false && <div className="px-3 py-1.5 text-[11px]" style={{ background: '#fdf1df', color: '#a35a00' }}>The warehouse is not sending its stage history yet (the Nextrade update is not on this copy), so “reached in time / late” cannot be told yet.</div>}
      {showSet && <SettingsBox set={set} busy={busy} act={act} />}
      <div className="grid gap-2 p-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        {[[k.dead, '30-hour deadline missed or due', 'blocked'], [k.inv, 'Shipped — missing invoice', 'blocked'], [k.dep, 'Waiting for deposit — blocked', 'wait'], [k.shipped, 'Shipped — outstanding requirements', 'wait'], [k.close, 'Ready to close', 'done']].map(function (x) {
          return <div key={x[1]} className="rounded-lg px-3 py-2" style={{ border: '1px solid ' + (x[0] && x[2] === 'blocked' ? S.blocked[0] : LINE) }}><div className="text-[22px] font-extrabold tabular-nums" style={{ color: x[0] ? S[x[2]][0] : INK }}>{x[0]}</div><div className="text-[11px]" style={{ color: SUB }}>{x[1]}</div></div>; })}
      </div>
      <div className="flex flex-wrap gap-1.5 px-3 pb-2 items-center">
        {FILTERS.map(function (f) { return <button key={f[0]} type="button" onClick={function () { setFilter(f[0]); }} className="px-3 py-1 rounded-full text-[11px] font-bold" style={filter === f[0] ? { background: INK, color: '#ffffff' } : { background: '#ffffff', color: INK, border: '1px solid ' + LINE }}>{f[1]}</button>; })}
        <input value={q} onChange={function (e) { setQ(e.target.value); }} placeholder="release, order, customer, country…" className="px-2 py-1 rounded-lg text-[11px] nt-light" style={{ border: '1px solid ' + LINE, width: 220, color: INK, background: '#ffffff' }} />
        <span className="text-[11px]" style={{ color: SUB }}>{shown.length + ' of ' + rows.length + ' open orders'}</span>
      </div>
      <div className="overflow-auto" style={{ borderTop: '1px solid ' + LINE, maxHeight: '62vh' }}>
        <table className="w-full text-[11px]" style={{ minWidth: 1080 }}>
          <thead><tr>{['Release · order', 'Customer · destination', 'Scheduled / shipped', 'Stage', 'Readiness', 'Invoice', 'Deposit', 'Outstanding · next action', ''].map(function (h) { return <th key={h} className="px-2 py-1.5 text-left font-semibold sticky top-0" style={{ background: BG, color: SUB, borderBottom: '1px solid ' + LINE }}>{h}</th>; })}</tr></thead>
          <tbody>{shown.map(function (r) {
            var sev = r.readiness.key === 'blocked' || r.invoice.severe;
            return <tr key={r.id} style={{ borderBottom: '1px solid ' + LINE, background: openId === r.id ? '#eef4fb' : '#ffffff', boxShadow: sev ? 'inset 3px 0 0 ' + S.blocked[0] : (r.readiness.key === 'wait' ? 'inset 3px 0 0 ' + S.wait[0] : 'none') }}>
              <td className="px-2 py-1.5"><b style={{ fontFamily: 'ui-monospace, Consolas, monospace' }}>{r.release_number || '—'}</b><div style={{ color: SUB }}>{'order ' + r.id}</div></td>
              <td className="px-2 py-1.5">{r.customer || '—'}<div style={{ color: SUB }}>{r.country || 'destination missing'}</div></td>
              <td className="px-2 py-1.5 whitespace-nowrap">{r.scheduled ? nd(r.scheduled) : '—'}<div style={{ color: ['missed', 'overdue_unshipped'].indexOf(r.deadline.state) >= 0 ? S.blocked[0] : (r.deadline.state === 'due_soon' || r.deadline.state === 'short_notice' ? S.wait[0] : SUB), fontWeight: 600 }}>{r.shipped_date ? 'shipped ' + nd(r.shipped_date) : (DL_WORDS[r.deadline.state] || '') + (r.deadline.state === 'due_soon' && r.deadline.hours_left != null ? ' (' + Math.max(0, Math.round(r.deadline.hours_left)) + ' h)' : '')}</div></td>
              <td className="px-2 py-1.5"><Pill k={r.stage === 'closed' ? 'done' : 'prog'}>{r.stage_label}</Pill></td>
              <td className="px-2 py-1.5"><Pill k={r.readiness.key}>{r.readiness.words}</Pill></td>
              <td className="px-2 py-1.5"><Pill k={INV_KEY[r.invoice.state] || 'na'}>{INV_WORDS[r.invoice.state] || r.invoice.state}</Pill><div style={{ color: SUB }}>{(r.invoice.numbers || []).join(', ')}</div></td>
              <td className="px-2 py-1.5"><Pill k={DEP_KEY[r.deposit.status] || 'na'}>{DEP_WORDS[r.deposit.status] || r.deposit.status}</Pill></td>
              <td className="px-2 py-1.5" style={{ maxWidth: 320 }}>{r.outstanding.length > 0 && <div style={{ color: S.blocked[0] }}>{r.outstanding.slice(0, 4).join(' · ') + (r.outstanding.length > 4 ? ' · +' + (r.outstanding.length - 4) + ' more' : '')}</div>}<div style={{ color: SUB }}>{r.next_action ? 'Next: ' + r.next_action : ''}</div></td>
              <td className="px-2 py-1.5"><Btn onClick={function () { openOrder(r.id); setTimeout(function () { try { document.getElementById('nt-order-report').scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {} }, 80); }}>Open report</Btn></td></tr>; })}
            {shown.length === 0 && <tr><td colSpan={9} className="px-3 py-4 text-center" style={{ color: SUB }}>No order matches this filter.</td></tr>}</tbody>
        </table>
      </div>
    </div>
    <div id="nt-order-report">{openId && <OrderReport rep={rep} canManage={data.can_manage} busy={busy} act={act} call={call} form={form} setForm={setForm} onClose={function () { setOpenId(null); setRep(null); }} />}</div>
  </div>;
}

function SettingsBox(p) {
  var set = p.set; var s1 = useState((set.alert_recipients || []).join('\n')); var list = s1[0]; var setList = s1[1];
  return <div className="px-3 py-3 grid gap-2" style={{ borderBottom: '1px solid ' + LINE, background: '#fbfcfd' }}>
    <div className="text-[12px] font-bold">30-hour alert recipients (one per line)</div>
    <textarea id="nt-om-recipients" value={list} onChange={function (e) { setList(e.target.value); }} rows={3} className="px-2 py-1 rounded text-[12px] nt-light" style={{ border: '1px solid ' + LINE, maxWidth: 420, color: INK, background: '#ffffff' }} />
    <div className="flex flex-wrap gap-2 items-center">
      <Btn onClick={function () { p.act({ action: 'settings', alert_recipients: list.split(/\n|,/) }, 'Recipients saved.'); }} disabled={p.busy}>Save recipients</Btn>
      <Btn dark={set.alerts_enabled !== true} onClick={function () { p.act({ action: 'settings', alerts_enabled: set.alerts_enabled !== true }, set.alerts_enabled === true ? 'Alerts switched OFF.' : 'Alerts switched ON — emails go out from the next check.'); }} disabled={p.busy}>{set.alerts_enabled === true ? 'Switch alerts OFF' : 'Switch alerts ON'}</Btn>
      <Btn dark={set.auto_close_enabled !== true} onClick={function () { p.act({ action: 'settings', auto_close_enabled: set.auto_close_enabled !== true }, set.auto_close_enabled === true ? 'Automatic closing switched OFF.' : 'Automatic closing switched ON — from the next overnight review.'); }} disabled={p.busy}>{set.auto_close_enabled === true ? 'Switch automatic closing OFF' : 'Switch automatic closing ON'}</Btn>
      <Btn onClick={function () { p.act({ action: 'run_now', job: 'deadline' }, '30-hour check done.'); }} disabled={p.busy}>Run the 30-hour check now</Btn>
      <Btn onClick={function () { p.act({ action: 'run_now', job: 'nightly' }, 'Review done.'); }} disabled={p.busy}>Run the overnight review now</Btn>
    </div>
    <div className="text-[11px]" style={{ color: SUB }}>While the Hub reads the warehouse STAGING copy, alerts and automatic closing stay OFF unless you switch them on; switching on sends real emails about staging orders.</div>
  </div>;
}

function OrderReport(p) {
  var j = p.rep;
  if (!j) { return <div className="rounded-xl p-4 text-[12px]" style={{ background: '#ffffff', border: '1px solid ' + LINE, color: SUB }}>Loading the order…</div>; }
  var r = j.report; var f = p.form; var setF = function (o) { p.setForm(Object.assign({}, f, o)); };
  var rank = STAGES.map(function (x) { return x[0]; }).indexOf(r.stage);
  var groups = {}; (r.items || []).forEach(function (it) { (groups[it.stage] = groups[it.stage] || []).push(it); });
  var missing = (r.items || []).filter(function (it) { return it.applies && it.status === 'missing'; });
  var inp = { border: '1px solid ' + LINE, color: INK, background: '#ffffff' };
  function bar(done, total, key) { var pct = total ? Math.round(done * 100 / total) : 0; return <div style={{ height: 7, background: S.na[1], borderRadius: 9, overflow: 'hidden' }}><div style={{ width: pct + '%', height: '100%', background: S[key][0] }} /></div>; }
  var dl = r.deadline || {};
  return <div className="rounded-xl" style={{ background: '#ffffff', border: '1px solid ' + LINE }}>
    <div className="flex flex-wrap items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid ' + LINE, background: BG }}><b className="text-[13px]">Order report</b><div className="flex-1" /><Btn onClick={p.onClose}>✕ Close</Btn></div>
    <div className="p-4 grid gap-4">
      <div className="flex flex-wrap gap-4 items-start justify-between">
        <div className="grid gap-1"><span className="text-[11px]" style={{ color: SUB }}>Release</span><span className="text-[22px] font-extrabold" style={{ fontFamily: 'ui-monospace, Consolas, monospace' }}>{r.release_number || '—'}</span><Pill k={r.readiness.key}>{r.readiness.words}</Pill></div>
        <div className="grid gap-x-5 gap-y-1.5 text-[12px]" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', flex: '1 1 420px' }}>
          {[['Customer', r.customer || '—'], ['Destination', r.country || 'missing'], ['Scheduled shipping', r.scheduled ? nd(r.scheduled) + ' (New York)' : 'no load date/time'], ['Order · warehouse', r.id + (r.warehouse ? ' · ' + r.warehouse : '')], ['Stage', r.stage_label], ['Shipped', r.shipped_date ? nd(r.shipped_date) : 'not yet'], ['Invoice', r.invoice.words], ['Deposit', r.deposit.words]].map(function (x) { return <div key={x[0]}><div className="text-[10px] uppercase tracking-wide" style={{ color: SUB }}>{x[0]}</div>{x[1]}</div>; })}
        </div>
      </div>
      {(dl.state === 'missed' || dl.state === 'overdue_unshipped' || dl.state === 'short_notice') && <div className="rounded-lg px-3 py-2 text-[12px] font-bold" style={{ background: S.blocked[1], color: S.blocked[0], border: '1px solid ' + S.blocked[0] }}>{'⚠ ' + (dl.state === 'missed' ? '30-hour deadline missed — Shipping In Process was due ' : dl.state === 'short_notice' ? 'Booked with less than 30 hours’ notice — ships ' : 'Scheduled time passed and not shipped — was due ') + nd(dl.state === 'missed' ? new Date(dl.deadline_ms).toLocaleString('sv-SE', { timeZone: 'America/New_York' }) : dl.scheduled)}</div>}
      <div className="overflow-x-auto"><div className="grid" style={{ gridTemplateColumns: 'repeat(7, minmax(100px, 1fr))', minWidth: 700 }}>
        {STAGES.map(function (st, i) { var done = i < rank || r.stage === 'closed'; var cur = i === rank && r.stage !== 'closed';
          return <div key={st[0]} className="grid justify-items-center gap-1 text-center relative px-1">
            {i > 0 && <div style={{ position: 'absolute', top: 15, left: '-50%', width: '100%', height: 3, background: done || cur ? S.done[0] : LINE }} />}
            <div style={{ position: 'relative', zIndex: 1, width: 32, height: 32, borderRadius: 99, display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 13, border: '3px solid ' + (done ? S.done[0] : cur ? S.prog[0] : LINE), background: done ? S.done[0] : '#ffffff', color: done ? '#ffffff' : cur ? S.prog[0] : SUB, boxShadow: cur ? '0 0 0 4px ' + S.prog[1] : 'none' }}>{done ? '✓' : i + 1}</div>
            <div className="text-[11px] font-semibold">{st[1]}</div></div>; })}
      </div></div>
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <div className="rounded-lg p-3 grid gap-1.5" style={{ border: '1px solid ' + LINE }}><span className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: SUB }}>Deposit</span><Pill k={DEP_KEY[r.deposit.status] || 'na'}>{DEP_WORDS[r.deposit.status]}</Pill>{bar(r.deposit.required ? Math.min(r.deposit.matched, r.deposit.required) : (r.deposit.status === 'received' || r.deposit.status === 'not_required' ? 1 : 0), r.deposit.required || 1, DEP_KEY[r.deposit.status] || 'na')}<span className="text-[11px]">{r.deposit.words}</span></div>
        <div className="rounded-lg p-3 grid gap-1.5" style={{ border: '1px solid ' + LINE }}><span className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: SUB }}>Invoice</span><Pill k={INV_KEY[r.invoice.state] || 'na'}>{INV_WORDS[r.invoice.state]}</Pill><span className="text-[11px]">{r.invoice.words}</span>{(j.report.invoice_flags || []).map(function (x) { return <span key={x} className="text-[11px]" style={{ color: S.wait[0] }}>{'⚠ ' + x}</span>; })}</div>
        <div className="rounded-lg p-3 grid gap-1.5" style={{ border: '1px solid ' + LINE }}><span className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: SUB }}>Shipping readiness</span><Pill k="prog">{r.groups.shipping.done + ' of ' + r.groups.shipping.total + ' applicable'}</Pill>{bar(r.groups.shipping.done, r.groups.shipping.total, 'prog')}<span className="text-[11px]" style={{ color: SUB }}>{r.groups.shipping.na + ' not applicable, not counted'}</span></div>
        <div className="rounded-lg p-3 grid gap-1.5" style={{ border: '1px solid ' + LINE }}><span className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: SUB }}>Documents</span><Pill k="wait">{r.groups.documents.done + ' of ' + r.groups.documents.total + ' applicable'}</Pill>{bar(r.groups.documents.done, r.groups.documents.total, 'wait')}<span className="text-[11px]" style={{ color: SUB }}>{r.groups.documents.na + ' not applicable, not counted'}</span></div>
      </div>
      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)' }}>
        <div className="rounded-lg overflow-hidden" style={{ border: '1px solid ' + LINE }}>
          {STAGES.filter(function (st) { return groups[st[0]]; }).map(function (st) { var g = groups[st[0]]; var ap = g.filter(function (it) { return it.applies; });
            return <div key={st[0]}><div className="flex justify-between px-3 py-1.5 text-[11px] font-bold" style={{ background: BG, borderTop: '1px solid ' + LINE }}><span>{st[1]}</span><span style={{ color: SUB }}>{ap.filter(function (it) { return it.status === 'done'; }).length + ' / ' + ap.length}</span></div>
              {g.map(function (it) { var key = it.status === 'done' ? 'done' : it.status === 'na' ? 'na' : it.status === 'missing' ? 'blocked' : 'wait';
                return <div key={it.key} className="flex justify-between gap-2 px-3 py-1.5 text-[12px]" style={{ borderTop: '1px solid ' + LINE }}><span>{it.label}{it.why && <span className="block text-[10px]" style={{ color: SUB }}>{it.why}</span>}</span>
                  <span className="flex items-center gap-1">{p.canManage && it.status === 'missing' && <button type="button" title="Mark this requirement not applicable for this order (needs a reason)" onClick={function () { setF({ na: it.key, na_label: it.label, reason: '' }); }} className="text-[10px] underline" style={{ color: SUB, background: 'none', border: 0 }}>N/A?</button>}<Pill k={key}>{STATUS_WORDS[it.status] || it.status}</Pill></span></div>; })}</div>; })}
        </div>
        <div className="grid gap-3 content-start">
          <div className="rounded-lg p-3 grid gap-1.5" style={{ border: '2px solid ' + (missing.length ? S.blocked[0] : S.done[0]) }}><b className="text-[13px]" style={{ color: missing.length ? S.blocked[0] : S.done[0] }}>{missing.length ? 'Missing — ' + missing.length + ' item' + (missing.length === 1 ? '' : 's') : 'Nothing missing for the stages reached'}</b>
            <ol className="text-[12px] grid gap-1" style={{ margin: 0, paddingLeft: 18 }}>{missing.slice(0, 12).map(function (it) { return <li key={it.key}>{it.label}</li>; })}</ol></div>
          {r.next_action && <div className="rounded-lg p-3" style={{ background: INK, color: '#ffffff' }}><div className="text-[10px] uppercase opacity-75">Next action</div><b className="text-[13px]">{r.next_action}</b></div>}
          <div className="flex flex-wrap gap-2 text-[11px]">{r.links.nextrade && <a href={r.links.nextrade} target="_blank" rel="noreferrer" style={{ color: '#0f5c8c', border: '1px solid ' + LINE, borderRadius: 5, padding: '3px 9px' }}>Order in Nextrade ↗</a>}<a href={r.links.hub} style={{ color: '#0f5c8c', border: '1px solid ' + LINE, borderRadius: 5, padding: '3px 9px' }}>Link to this report</a></div>
          <div className="rounded-lg p-3 grid gap-1 text-[12px]" style={{ border: '1px solid ' + LINE }}><b>Closing</b>
            {j.extra.closures.length > 0 && j.extra.closures.map(function (c, i) { return <div key={i} style={{ color: SUB }}>{'Closed (' + c.mode + ') ' + when(c.closed_at) + (c.written_to_nextrade ? ' — also closed in Nextrade' : ' — NOT closed in Nextrade') + (c.reason ? ': ' + c.reason : '')}</div>; })}
            <div>{r.closure.eligible ? <span style={{ color: S.done[0], fontWeight: 700 }}>{r.closure.forced ? 'Will be closed: ' + r.closure.words : 'Ready — closes automatically in the overnight review (when automatic closing is on).'}</span> : r.closure.held ? <span style={{ color: S.wait[0], fontWeight: 700 }}>{r.closure.words}</span> : <span style={{ color: SUB }}>{'Not ready to close: ' + (r.closure.missing || []).slice(0, 4).join('; ')}</span>}</div>
            {r.closure.forced && (r.closure.missing || []).length > 0 && <div style={{ color: S.wait[0] }}>{'Still open underneath: ' + r.closure.missing.slice(0, 4).join('; ')}</div>}
          </div>
          <div className="rounded-lg p-3 grid gap-1 text-[12px]" style={{ border: '1px solid ' + LINE }}><b>Bills on this release</b>
            {(r.bills || []).length === 0 ? <span style={{ color: SUB }}>No forwarder or trucker bill in the Hub yet.</span> : r.bills.map(function (b) { return <div key={b.id}>{(b.bill_type === 'shipping' ? 'Forwarder' : 'Trucker') + ' · ' + (b.vendor || '') + ' ' + (b.number || '') + ' · $' + fmt(b.total) + ' · ' + (b.paid + 0.005 >= b.total ? 'paid' : 'paid $' + fmt(b.paid))}</div>; })}</div>
          {(j.extra.alerts || []).length > 0 && <div className="rounded-lg p-3 grid gap-1 text-[12px]" style={{ border: '1px solid ' + LINE }}><b>30-hour alerts</b>{j.extra.alerts.map(function (a, i) { return <div key={i} style={{ color: SUB }}>{(DL_WORDS[a.kind] || a.kind) + ' · ' + (a.sent_at ? 'emailed ' + when(a.sent_at) : (a.send_error ? 'NOT sent: ' + a.send_error : 'recorded (alerts off)')) + (a.resolved_at ? ' · resolved ' + when(a.resolved_at) + (a.resolved_why ? ' (' + a.resolved_why + ')' : '') : ' · open')}</div>; })}</div>}
        </div>
      </div>
      {p.canManage && <div className="rounded-lg p-3 grid gap-2" style={{ border: '1px solid ' + LINE, background: '#fbfcfd' }}>
        <b className="text-[12px]">Decisions on this order (each one is kept with your name and reason)</b>
        <div className="flex flex-wrap gap-2">
          <Btn onClick={function () { setF({ mode: 'dep_not_required', reason: '' }); }}>Deposit not required…</Btn>
          {r.deposit.status === 'not_required' && <Btn onClick={function () { p.act({ action: 'set_deposit_status', order_id: r.id, status: 'required', release_number: r.release_number }, 'Deposit marked required again.'); }}>Deposit IS required</Btn>}
          <Btn onClick={function () { setF({ mode: 'link', lines: null, reason: '' }); p.call({ action: 'deposit_candidates', q: (r.customer || '').split(' ')[0] }).then(function (x) { p.setForm(function (cur) { return Object.assign({}, cur, { mode: 'link', lines: (x && x.ok) ? x.lines : [] }); }); }); }}>Match a deposit to this order…</Btn>
          <Btn onClick={function () { setF({ mode: 'keep_open', reason: '' }); }}>Keep open…</Btn>
          <Btn onClick={function () { setF({ mode: 'force_close', reason: '' }); }}>Close anyway…</Btn>
          {r.stage !== 'closed' && <Btn onClick={function () { setF({ mode: 'close_now', reason: '' }); }}>Close now…</Btn>}
        </div>
        {(r.deposit_links || []).map(function (l) { return <div key={l.id} className="text-[11px] flex gap-2 items-center">{'Deposit matched to this order: $' + fmt(l.amount) + (l.note ? ' — ' + l.note : '')}<button type="button" onClick={function () { setF({ mode: 'unlink', link: l, reason: '' }); }} className="underline" style={{ color: S.blocked[0], background: 'none', border: 0 }}>undo</button></div>; })}
        {(r.overrides || []).map(function (o) { return <div key={o.id} className="text-[11px] flex gap-2 items-center">{({ keep_open: 'Kept open', force_close: 'Close anyway', item_na: 'N/A: ' + o.item_key })[o.kind] + ' — ' + o.by_name + ': ' + o.reason}<button type="button" onClick={function () { p.act({ action: 'end_override', id: o.id }, 'Override ended.'); }} className="underline" style={{ color: S.blocked[0], background: 'none', border: 0 }}>end</button></div>; })}
        {f.mode === 'link' && <div className="grid gap-1.5"><div className="text-[11px]" style={{ color: SUB }}>Money IN with something still free (not matched to an invoice). Pick it and the amount that is this order’s deposit. This only records which order the money is for; it does not post a payment.</div>
          <div className="flex gap-2 flex-wrap"><input id="nt-om-dq" placeholder="name" value={f.q || ''} onChange={function (e) { setF({ q: e.target.value }); }} className="px-2 py-1 rounded text-[11px] nt-light" style={inp} /><input id="nt-om-da" placeholder="amount" value={f.amt || ''} onChange={function (e) { setF({ amt: e.target.value }); }} className="px-2 py-1 rounded text-[11px] nt-light" style={Object.assign({ width: 100 }, inp)} /><Btn onClick={function () { p.call({ action: 'deposit_candidates', q: f.q || '', amount: f.amt || '' }).then(function (x) { p.setForm(function (cur) { return Object.assign({}, cur, { lines: (x && x.ok) ? x.lines : [] }); }); }); }}>Find</Btn></div>
          {f.lines === null ? <span className="text-[11px]" style={{ color: SUB }}>Loading…</span> : (f.lines || []).length === 0 ? <span className="text-[11px]" style={{ color: S.wait[0] }}>No money-in bank line with money still free matches.</span> :
            <div className="overflow-auto" style={{ maxHeight: 180, border: '1px solid ' + LINE, borderRadius: 6 }}>{f.lines.map(function (t) { return <label key={t.id} className="flex gap-2 items-center px-2 py-1 text-[11px]" style={{ borderTop: '1px solid ' + LINE, background: f.tx === t.id ? '#e6eefb' : '#ffffff' }}><input type="radio" checked={f.tx === t.id} onChange={function () { setF({ tx: t.id, linkAmt: Math.min(t.free, Number(r.deposit.required || t.free) - Number(r.deposit.matched || 0) > 0 ? Number(r.deposit.required) - Number(r.deposit.matched || 0) : t.free).toFixed(2) }); }} />{nd(t.date) + ' · ' + t.name + ' · $' + fmt(t.amount) + ' · $' + fmt(t.free) + ' free'}</label>; })}</div>}
          {f.tx && <div className="flex gap-2 items-center flex-wrap"><span className="text-[11px]">Amount for this order $</span><input id="nt-om-la" value={f.linkAmt || ''} onChange={function (e) { setF({ linkAmt: e.target.value }); }} className="px-2 py-1 rounded text-[11px] nt-light" style={Object.assign({ width: 110 }, inp)} /><input id="nt-om-ln" placeholder="note (e.g. proforma PF-112)" value={f.reason || ''} onChange={function (e) { setF({ reason: e.target.value }); }} className="px-2 py-1 rounded text-[11px] nt-light" style={Object.assign({ width: 240 }, inp)} /><Btn dark disabled={p.busy} onClick={function () { p.act({ action: 'link_deposit', order_id: r.id, release_number: r.release_number, bank_transaction_id: f.tx, amount: f.linkAmt, note: f.reason }, 'Deposit matched to this order.'); }}>Match it</Btn></div>}
        </div>}
        {(f.mode === 'dep_not_required' || f.mode === 'keep_open' || f.mode === 'force_close' || f.mode === 'close_now' || f.mode === 'unlink' || f.na) && <div className="flex gap-2 items-center flex-wrap">
          <span className="text-[12px] font-bold">{f.na ? 'Mark “' + f.na_label + '” not applicable — why?' : ({ dep_not_required: 'Why is no deposit needed?', keep_open: 'Why keep it open (the overnight review will not close it)?', force_close: 'Why close it although something is open?', close_now: 'Close it now in the Hub and in Nextrade — why?', unlink: 'Why undo this deposit match?' })[f.mode]}</span>
          <input id="nt-om-reason" autoFocus value={f.reason || ''} onChange={function (e) { setF({ reason: e.target.value }); }} placeholder="reason (required)" className="px-2 py-1 rounded text-[12px] nt-light" style={Object.assign({ flex: '1 1 300px' }, inp)} />
          <Btn dark disabled={p.busy || String(f.reason || '').trim().length < 5} onClick={function () {
            var rs = String(f.reason || '').trim();
            if (f.na) { p.act({ action: 'override', kind: 'item_na', item_key: f.na, order_id: r.id, reason: rs, release_number: r.release_number }, 'Marked not applicable.'); return; }
            if (f.mode === 'dep_not_required') { p.act({ action: 'set_deposit_status', order_id: r.id, status: 'not_required', note: rs, release_number: r.release_number }, 'Deposit marked not required.'); }
            if (f.mode === 'keep_open' || f.mode === 'force_close') { p.act({ action: 'override', kind: f.mode, order_id: r.id, reason: rs, release_number: r.release_number }, f.mode === 'keep_open' ? 'Kept open.' : 'It will be closed in the next overnight review.'); }
            if (f.mode === 'close_now') { p.act({ action: 'close_order', order_id: r.id, reason: rs }, 'Closed in the Hub and in Nextrade.'); }
            if (f.mode === 'unlink') { p.act({ action: 'unlink_deposit', id: f.link.id, reason: rs }, 'Deposit match undone.'); }
          }}>Confirm</Btn>
          <Btn onClick={function () { p.setForm({}); }}>Cancel</Btn></div>}
      </div>}
    </div>
  </div>;
}
