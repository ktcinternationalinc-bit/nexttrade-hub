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
var STATUS_WORDS = { done: 'Completed', missing: 'Missing', waiting: 'Waiting', na: 'Not applicable', untracked: 'Not tracked yet' }; // UU
var INV_KEY = { current: 'done', in_approval: 'wait', draft_only: 'wait', awaiting: 'na', po_so_only: 'blocked', cancelled_only: 'blocked', missing_overdue: 'blocked' };
var INV_WORDS = { current: 'Current', in_approval: 'In approval', draft_only: 'Draft only', awaiting: 'Awaiting invoice', po_so_only: 'In P.O./S.O. only', cancelled_only: 'Cancelled only', missing_overdue: 'Missing — overdue' };
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
  var s10 = useState('orders'); var view = s10[0]; var setView = s10[1]; // v55.83-TM — 'orders' | 'recon'
  var s11 = useState(null); var archF = s11[0]; var setArchF = s11[1]; // v55.83-UC — { id, choice, note }: the row being marked Non issue / Corrected
  var s12 = useState(null); var backF = s12[0]; var setBackF = s12[1]; // v55.83-UC — { id, note }: the archived row being put back

  function call(payload) {
    return supabase.auth.getSession().then(function (sres) {
      var token = sres && sres.data && sres.data.session ? sres.data.session.access_token : '';
      // v55.83-TO — one request id per click for the actions that write money / close an order (a retry never does it twice)
      var rid = (payload && (payload.action === 'link_deposit' || payload.action === 'close_order' || payload.action === 'archive_row') && !payload.request_id) ? { request_id: 'om-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 10) } : {};
      return fetch('/api/accounting/order-monitor', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(Object.assign({ user_id: userProfile && userProfile.id }, rid, payload)) });
    }).then(function (r) { return r.json().catch(function () { return { ok: false, error: 'The server did not answer properly (HTTP ' + r.status + ').' }; }); })
      .catch(function (e) { return { ok: false, error: 'Could not reach the server (' + ((e && e.message) || 'network') + ').' }; });
  }
  // UC (Codex QA 12:05) — load() returns the fresh report (or null when it could not be read), so callers can wait for it
  function load() { setBusy(true); setErr(''); return call({ action: 'report' }).then(function (j) { if (j && j.ok) { setData(j); return j; } setErr((j && j.error) || 'Could not load the orders.'); return null; }).finally(function () { setBusy(false); }); }
  function openOrder(id) { setOpenId(id); setRep(null); setForm({}); call({ action: 'order', order_id: id }).then(function (j) { if (j && j.ok) { setRep(j); } else { setErr((j && j.error) || 'Could not load the order.'); setOpenId(null); } }); }
  useEffect(function () {
    load();
    try { var m = String(window.location.search || '').match(/[?&]order=(\d+)/); if (m) { openOrder(Number(m[1])); } } catch (e) { /* no deep link */ }
  }, []); // eslint-disable-line
  // v55.83-TM (Max, Nov 17: "links should lead to something to fix it") — open an invoice in the editor / start a new one
  function openInvoice(id) { try { window.__ntOpenInvoiceEdit = id; window.dispatchEvent(new CustomEvent('nt-open-invoice-edit', { detail: id })); } catch (e) {} if (props.onGo) { props.onGo('invoices'); } }
  function newInvoice() { if (props.onGo) { props.onGo('invoices'); } else { toast.error('Open Accounting → Invoices → + New invoice.'); } }
  function copyRelease(ids) { setBusy(true); return call({ action: 'copy_release_from_po', invoice_ids: ids }).then(function (j) { if (j && j.ok) { toast.success((j.copied.length ? 'Release Number filled on ' + j.copied.join(', ') + '.' : 'Nothing copied.') + (j.skipped.length ? ' Skipped: ' + j.skipped.map(function (x) { return x.number + ' (' + x.why + ')'; }).join('; ') : '')); load(); return true; } toast.error((j && j.error) || 'Not saved.'); return false; }).finally(function () { setBusy(false); }); }
  // v55.83-UC (Max, Nov 18) — "Non issue" / "Corrected": the row leaves the report (and the counts at the top) at once and goes to
  // the archive; nothing is deleted. "Put back" returns it. The screen updates straight away; ↻ Refresh re-reads everything.
  var ARCH_WORDS = { non_issue: 'Non issue', corrected: 'Corrected' };
  // UC (Codex QA) — one click id per Archive form: a retry after a lost answer sends the SAME id (the server answers the saved entry);
  // changing the note or the choice makes a new id
  function newRid() { return 'om-arch-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 10); }
  function archiveRow(r, choice, note, rid) {
    var snap = { customer: r.customer, country: r.country, stage_label: r.stage_label, readiness: r.readiness && r.readiness.words, invoice: INV_WORDS[r.invoice.state] || r.invoice.state, deposit: DEP_WORDS[r.deposit.status] || r.deposit.status, shipped_date: r.shipped_date, scheduled: r.scheduled, next_action: r.next_action, outstanding: r.outstanding };
    setBusy(true);
    return call({ action: 'archive_row', order_id: r.id, release_number: r.release_number, choice: choice, note: note || '', snapshot: snap, request_id: rid }).then(function (j) {
      if (!(j && j.ok)) { toast.error((j && j.error) || 'Not archived.'); return false; }
      setArchF(null);
      if (j.audit_warning) { toast.error(j.audit_warning); }
      if (j.already_recorded) {
        // UC (Codex QA 16:25, P2) — a retried click: say what the SAVED earlier click did (and whether it was put back since), then
        // say where the order is NOW only from the re-read report; never claim it is archived when someone has put it back
        var lblR = j.release_number || r.release_number || ('Order ' + r.id);
        var saidR = j.restored_at ? lblR + ': your earlier click had been saved, but the row was put back since — this retry did NOT archive it again.' : lblR + ': your earlier click had already been saved — nothing new was archived.';
        return load().then(function (fresh) {
          if (!fresh) { toast.error(saidR + ' The report could not be read again — press ↻ Refresh; the list and the counts may be out of date.'); return true; }
          var inArch = (fresh.archived || []).some(function (x) { return Number(x.archive.order_id) === Number(r.id); });
          var onRep = (fresh.rows || []).some(function (x) { return Number(x.id) === Number(r.id); });
          toast.success(saidR + (inArch ? ' It is in the archive now.' : (onRep ? ' It is on the report now.' : ' It is not on the open list now.')));
          return true;
        });
      }
      setData(function (d) { if (!d) { return d; } var entry = { archive: { id: j.id, order_id: r.id, release_number: j.release_number || r.release_number, choice: choice, choice_words: ARCH_WORDS[choice], note: note || null, archived_at: j.archived_at || new Date().toISOString(), by_name: j.by_name || (userProfile && (userProfile.name || userProfile.email)) || 'you', snapshot: snap }, row: r, warehouse_status: null };
        return Object.assign({}, d, { rows: (d.rows || []).filter(function (x) { return x.id !== r.id; }), archived: [entry].concat((d.archived || []).filter(function (a) { return a.archive.order_id !== r.id; })) }); });
      if (openId === r.id) { setOpenId(null); setRep(null); }
      toast.success((r.release_number || 'Order ' + r.id) + ' — ' + ARCH_WORDS[choice] + ': moved to the archive.');
      return true;
    }).finally(function () { setBusy(false); });
  }
  function putBack(a, note) {
    setBusy(true);
    return call({ action: 'unarchive_row', id: a.archive.id, note: note || '' }).then(function (j) {
      if (!(j && j.ok)) { toast.error((j && j.error) || 'Not put back.'); return false; }
      setBackF(null);
      // UC (Codex QA 12:05) — the entry left the archive (the server said so); whether the order is back on the OPEN report, and the
      // counts, are only stated after the report is read again — never from the copy cached when the archive list was loaded
      setData(function (d) { if (!d) { return d; } return Object.assign({}, d, { archived: (d.archived || []).filter(function (x) { return x.archive.id !== a.archive.id; }) }); });
      if (j.audit_warning) { toast.error(j.audit_warning); }
      var label = a.archive.release_number || ('Order ' + a.archive.order_id);
      return load().then(function (fresh) {
        if (!fresh) { toast.error(label + ' was put back, but the report could not be read again — press ↻ Refresh; the list and the counts may be out of date.'); return true; }
        var onReport = (fresh.rows || []).some(function (x) { return Number(x.id) === Number(a.archive.order_id); });
        toast.success(label + (onReport ? ' is back on the report.' : ' left the archive. It is not on the open list: the warehouse shows it closed, cancelled or no longer listed.'));
        return true;
      });
    }).finally(function () { setBusy(false); });
  }
  function act(payload, okMsg) { setBusy(true); return call(payload).then(function (j) { if (j && j.ok) { toast.success(okMsg); setForm({}); if (openId) { openOrder(openId); } load(); return true; } toast.error((j && j.error) || 'It did not go through.'); return false; }).finally(function () { setBusy(false); }); }

  if (!data) { return <div className="rounded-xl p-4" style={{ background: '#ffffff', border: '1px solid ' + LINE, color: INK }}>{err ? <div className="text-[12px] font-bold" style={{ color: '#b42318' }}>{'⛔ ' + err}</div> : <div className="text-[12px]" style={{ color: SUB }}>Reading the warehouse and the Hub…</div>}</div>; }

  var rows = data.rows || [];
  var archivedAll = data.archived || []; // v55.83-UC — rows marked Non issue / Corrected (not in `rows`, so not in any count above)
  var canArchive = !!(data.can_manage && data.archive_ready);
  var FILTERS = [['all', 'All open'], ['deadline', 'Deadline'], ['invoice', 'Invoice problems'], ['deposit', 'Deposit'], ['shipped', 'Shipped — outstanding'], ['close', 'Ready to close'], ['archived', '🗄 Archived · ' + archivedAll.length]];
  var tq = q.trim().toLowerCase();
  var archShown = archivedAll.filter(function (a) { var x = a.archive; var sn = x.snapshot || {}; return !tq || (String(x.release_number || '') + ' ' + x.order_id + ' ' + (sn.customer || '') + ' ' + (sn.country || '') + ' ' + (x.note || '') + ' ' + x.by_name + ' ' + x.choice_words).toLowerCase().indexOf(tq) >= 0; });
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
  // the invoice cell: each invoice opens in the editor; a missing one has + New invoice; a P.O./S.O.-only one has a one-click copy
  function invFix(inv, rel) {
    var items = inv.items || [];
    return <div className="grid gap-0.5 mt-0.5">
      {items.map(function (i) { return <div key={i.id} className="flex items-center gap-1 flex-wrap"><button type="button" onClick={function () { openInvoice(i.id); }} className="underline font-bold" style={{ color: '#0f5c8c', background: 'none', border: 0, padding: 0 }} title="Open this invoice in the editor">{'✏ ' + i.number}</button>{i.po_so_only && <span style={{ color: S.wait[0] }}>{'in P.O./S.O. only'}</span>}{i.po_so_only && i.record_status === 'active' && <button type="button" disabled={busy} onClick={function () { copyRelease([i.id]); }} className="px-1.5 rounded text-[10px] font-bold" style={{ background: S.wait[0], color: '#ffffff', border: 0 }} title={'Copy ' + rel + ' from its P.O./S.O. into its empty Release Number'}>copy to Release #</button>}</div>; })}
      {(inv.state === 'missing_overdue' || inv.state === 'awaiting' || inv.state === 'cancelled_only') && <button type="button" onClick={newInvoice} className="px-1.5 py-0.5 rounded text-[10px] font-bold justify-self-start" style={{ background: inv.state === 'awaiting' ? '#ffffff' : S.blocked[0], color: inv.state === 'awaiting' ? INK : '#ffffff', border: '1px solid ' + (inv.state === 'awaiting' ? LINE : S.blocked[0]) }}>{'＋ New invoice for ' + (rel || 'this order')}</button>}
    </div>;
  }

  return <div className="grid gap-3" style={{ color: INK }}>
    <div className="rounded-xl" style={{ background: '#ffffff', border: '1px solid ' + LINE }}>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid ' + LINE, background: BG }}>
        <b className="text-[14px]">🚚 Orders — stage and what is missing</b>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: data.source === 'nextrade-staging' ? '#fdf1df' : '#e3f4ea', color: data.source === 'nextrade-staging' ? '#a35a00' : '#157347' }}>{data.source === 'nextrade-staging' ? 'WAREHOUSE STAGING COPY' : 'LIVE WAREHOUSE'}</span>
        <div className="flex-1" />
        <span className="text-[11px]" style={{ color: SUB }}>{'Overnight review: ' + (runs.last_ok_nightly ? when(runs.last_ok_nightly) + ' ✓' : 'not run yet') + ' · 30-hour check: ' + (runs.last_ok_deadline ? when(runs.last_ok_deadline) : 'not run yet') + ' · alerts ' + (set.alerts_enabled === true ? 'ON' : 'OFF')}</span>
        {runs.nightly && runs.nightly.ok === false && <span className="text-[11px] font-bold" style={{ color: '#b42318' }}>{'⛔ last review failed: ' + (runs.nightly.error || '')}</span>}
        <Btn dark={view === 'recon'} onClick={function () { setView(view === 'recon' ? 'orders' : 'recon'); }}>{view === 'recon' ? '← Back to orders' : '🔎 Releases with no KTC invoice'}</Btn>
        <Btn onClick={load} disabled={busy}>{busy ? 'Reading…' : '↻ Refresh'}</Btn>
        {data.is_super_admin && <Btn onClick={function () { setShowSet(!showSet); }}>⚙ Alerts & closing</Btn>}
      </div>
      {err && <div className="px-3 py-2 text-[12px] font-bold" style={{ background: '#fde8e6', color: '#b42318' }}>{'⚠ The last refresh failed (' + err + ') — the list and the counts below may be out of date. Press ↻ Refresh.'}</div>}
      {!data.tables_ready && <div className="px-3 py-2 text-[12px] font-bold" style={{ background: '#fdf1df', color: '#a35a00' }}>{'Deposit decisions, overrides, alerts and the overnight review need one SQL first: ' + data.sql_hint}</div>}
      {/* UU — reading the LIVE warehouse: what it does not track yet, and decisions kept from the other copy */}
      {(data.untracked_fields || []).length > 0 && <div className="px-3 py-1.5 text-[11px]" style={{ background: '#eef0f3', color: '#3b4552' }}>{'This warehouse copy does not track ' + data.untracked_fields.map(function (f) { return ({ shipping_doc_type: 'the shipping document type', order_payment_type: 'the order / payment type', load_time_known: 'whether a load time is real' })[f] || f; }).join(', ') + ' yet. Those items show “Not tracked yet”: never counted as done, and such an order is never ready to close.'}</div>}
      {data.other_copy && (data.other_copy.unavailable || []).length > 0 && <div className="px-3 py-1.5 text-[11px] font-bold" style={{ background: '#fde8e6', color: '#b42318' }}>{'What was kept from the other warehouse copy could not be checked (' + data.other_copy.unavailable.join(', ') + ') — press ↻ Refresh; do not assume there is none.'}</div>}
      {data.other_copy && ((data.other_copy.deposit_status || 0) + (data.other_copy.deposit_links || 0) + (data.other_copy.overrides || 0) + (data.other_copy.archived || 0)) > 0 && <div className="px-3 py-1.5 text-[11px] font-bold" style={{ background: '#fdf1df', color: '#a35a00' }}>{'Kept from the other warehouse copy (not used here, nothing deleted): ' + [data.other_copy.deposit_status ? data.other_copy.deposit_status + ' deposit decision(s)' : null, data.other_copy.deposit_links ? data.other_copy.deposit_links + ' deposit link(s) for $' + fmt(data.other_copy.deposit_links_amount) + ' — these still use that bank money until undone' : null, data.other_copy.overrides ? data.other_copy.overrides + ' override(s)' : null, data.other_copy.archived ? data.other_copy.archived + ' archived row(s)' : null].filter(Boolean).join(' · ') + '.'}</div>}
      {data.closing_allowed === false && data.source === 'nextrade-live' && <div className="px-3 py-1.5 text-[11px]" style={{ background: '#eef0f3', color: '#3b4552' }}>Read-only: the Hub does not close orders in the LIVE warehouse — close them in Nextrade. Keep open / Close anyway are still recorded in the Hub.</div>}
      {data.history_in_feed === false && <div className="px-3 py-1.5 text-[11px]" style={{ background: '#fdf1df', color: '#a35a00' }}>The warehouse is not sending its stage history yet (the Nextrade update is not on this copy), so “reached in time / late” cannot be told yet.</div>}
      {showSet && <SettingsBox set={set} busy={busy} act={act} />}
      {view === 'recon' && <ReconView call={call} openInvoice={openInvoice} newInvoice={newInvoice} copyRelease={copyRelease} busy={busy} />}
      {view === 'orders' && <div>
      <div className="grid gap-2 p-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        {[[k.dead, '30-hour deadline missed or due', 'blocked'], [k.inv, 'Shipped — missing invoice', 'blocked'], [k.dep, 'Waiting for deposit — blocked', 'wait'], [k.shipped, 'Shipped — outstanding requirements', 'wait'], [k.close, 'Ready to close', 'done']].map(function (x) {
          return <div key={x[1]} className="rounded-lg px-3 py-2" style={{ border: '1px solid ' + (x[0] && x[2] === 'blocked' ? S.blocked[0] : LINE) }}><div className="text-[22px] font-extrabold tabular-nums" style={{ color: x[0] ? S[x[2]][0] : INK }}>{x[0]}</div><div className="text-[11px]" style={{ color: SUB }}>{x[1]}</div></div>; })}
      </div>
      <div className="flex flex-wrap gap-1.5 px-3 pb-2 items-center">
        {FILTERS.map(function (f) { return <button key={f[0]} type="button" onClick={function () { setFilter(f[0]); }} className="px-3 py-1 rounded-full text-[11px] font-bold" style={filter === f[0] ? { background: INK, color: '#ffffff' } : { background: '#ffffff', color: INK, border: '1px solid ' + LINE }}>{f[1]}</button>; })}
        <input value={q} onChange={function (e) { setQ(e.target.value); }} placeholder="release, order, customer, country…" className="px-2 py-1 rounded-lg text-[11px] nt-light" style={{ border: '1px solid ' + LINE, width: 220, color: INK, background: '#ffffff' }} />
        <span className="text-[11px]" style={{ color: SUB }}>{filter === 'archived' ? archShown.length + ' of ' + archivedAll.length + ' archived (not counted above)' : shown.length + ' of ' + rows.length + ' open orders' + (archivedAll.length ? ' · ' + archivedAll.length + ' archived, not counted' : '')}</span>
      </div>
      {data.can_manage && data.archive_ready === false && <div className="px-3 pb-2 text-[11px] font-bold" style={{ color: '#a35a00' }}>{'Non issue / Corrected needs one SQL first: ' + (data.archive_sql_hint || 'sql/v55-83-UC-order-report-archive.sql')}</div>}
      {filter === 'archived' && <ArchiveView list={archShown} canManage={!!data.can_manage} busy={busy} backF={backF} setBackF={setBackF} putBack={putBack} openOrder={openOrder} />}
      {filter !== 'archived' && <div>
      <div className="overflow-auto nt-solid-head" style={{ borderTop: '1px solid ' + LINE, maxHeight: '62vh' }}>
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
              <td className="px-2 py-1.5"><Pill k={INV_KEY[r.invoice.state] || 'na'}>{INV_WORDS[r.invoice.state] || r.invoice.state}</Pill>{invFix(r.invoice, r.release_number)}</td>
              <td className="px-2 py-1.5"><Pill k={DEP_KEY[r.deposit.status] || 'na'}>{DEP_WORDS[r.deposit.status] || r.deposit.status}</Pill></td>
              <td className="px-2 py-1.5" style={{ maxWidth: 320 }}>{r.outstanding.length > 0 && <div style={{ color: S.blocked[0] }}>{r.outstanding.slice(0, 4).join(' · ') + (r.outstanding.length > 4 ? ' · +' + (r.outstanding.length - 4) + ' more' : '')}</div>}<div style={{ color: SUB }}>{r.next_action ? 'Next: ' + r.next_action : ''}</div></td>
              <td className="px-2 py-1.5" style={{ minWidth: 120 }}><div className="grid gap-1 justify-items-stretch">
                <Btn onClick={function () { openOrder(r.id); setTimeout(function () { try { document.getElementById('nt-order-report').scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {} }, 80); }}>Open report</Btn>
                {canArchive && (!archF || archF.id !== r.id) && <>
                  <Btn disabled={busy} onClick={function () { setArchF({ id: r.id, choice: 'non_issue', note: '', rid: newRid() }); }} style={{ color: '#6b7380' }}>Non issue</Btn>
                  <Btn disabled={busy} onClick={function () { setArchF({ id: r.id, choice: 'corrected', note: '', rid: newRid() }); }} style={{ color: S.done[0], border: '1px solid ' + S.done[0] }}>✓ Corrected</Btn></>}
                {canArchive && archF && archF.id === r.id && <div className="grid gap-1 p-1.5 rounded-lg" style={{ border: '1px solid ' + LINE, background: '#fbfcfd', width: 190 }}>
                  <b className="text-[11px]">{(archF.choice === 'corrected' ? '✓ Corrected' : 'Non issue') + ' — move to the archive'}</b>
                  <input id={'nt-om-arch-note-' + r.id} autoFocus value={archF.note} onChange={function (e) { var v = e.target.value; setArchF(function (c) { return Object.assign({}, c, { note: v, rid: newRid() }); }); }} onKeyDown={function (e) { if (e.key === 'Enter' && !busy) { archiveRow(r, archF.choice, archF.note, archF.rid); } if (e.key === 'Escape') { setArchF(null); } }} placeholder="note (optional)" className="px-1.5 py-1 rounded text-[11px] nt-light" style={{ border: '1px solid ' + LINE, color: INK, background: '#ffffff' }} />
                  <div className="flex gap-1"><Btn dark disabled={busy} onClick={function () { archiveRow(r, archF.choice, archF.note, archF.rid); }}>Archive</Btn><Btn onClick={function () { setArchF(null); }}>Cancel</Btn></div>
                  <span className="text-[10px]" style={{ color: SUB }}>Kept with your name and the time; 🗄 Archived → Put back returns it.</span></div>}
              </div></td></tr>; })}
            {shown.length === 0 && <tr><td colSpan={9} className="px-3 py-4 text-center" style={{ color: SUB }}>No order matches this filter.</td></tr>}</tbody>
        </table>
      </div>
      </div>}
      </div>}
    </div>
    <div id="nt-order-report">{openId && <OrderReport rep={rep} openInvoice={openInvoice} canManage={data.can_manage} busy={busy} act={act} call={call} form={form} setForm={setForm} onClose={function () { setOpenId(null); setRep(null); }} />}</div>
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

// v55.83-UC — 🗄 Archived: rows someone marked Non issue / Corrected. Who, when, the choice, the note, what the row showed then, and
// how the order looks NOW (so a row that went bad again is visible). "Put back" returns it to the report; the entry stays as history.
function ArchiveView(p) {
  var list = p.list || []; var f = p.backF;
  return <div className="overflow-auto nt-solid-head" style={{ borderTop: '1px solid ' + LINE, maxHeight: '62vh' }}>
    <table className="w-full text-[11px]" style={{ minWidth: 1080 }}>
      <thead><tr>{['Release · order', 'Customer · destination', 'Marked', 'By · when', 'Note', 'What it showed then', 'Now', ''].map(function (h) { return <th key={h} className="px-2 py-1.5 text-left font-semibold sticky top-0" style={{ background: BG, color: SUB, borderBottom: '1px solid ' + LINE }}>{h}</th>; })}</tr></thead>
      <tbody>{list.map(function (a) {
        var x = a.archive; var sn = x.snapshot || {}; var vf = sn.verified || {}; var now = a.row;
        var nowWords = !now ? 'not in the warehouse list any more' : (a.warehouse_status === 'closed' || a.warehouse_status === 'cancelled' ? a.warehouse_status + ' in the warehouse' : now.stage_label + ' · ' + (INV_WORDS[now.invoice.state] || now.invoice.state) + ' · ' + (DEP_WORDS[now.deposit.status] || now.deposit.status));
        var stillOpen = now && now.outstanding && now.outstanding.length;
        return <tr key={x.id} style={{ borderBottom: '1px solid ' + LINE, background: '#ffffff' }}>
          <td className="px-2 py-1.5"><b style={{ fontFamily: 'ui-monospace, Consolas, monospace' }}>{x.release_number || '—'}</b><div style={{ color: SUB }}>{'order ' + x.order_id}</div></td>
          <td className="px-2 py-1.5">{vf.customer || sn.customer || (now && now.customer) || '—'}<div style={{ color: SUB }}>{vf.country || sn.country || (now && now.country) || ''}</div></td>
          <td className="px-2 py-1.5"><Pill k={x.choice === 'corrected' ? 'done' : 'na'}>{x.choice_words}</Pill></td>
          <td className="px-2 py-1.5 whitespace-nowrap">{x.by_name}<div style={{ color: SUB }}>{when(x.archived_at)}</div></td>
          <td className="px-2 py-1.5" style={{ maxWidth: 220 }}>{x.note || <span style={{ color: SUB }}>—</span>}</td>
          <td className="px-2 py-1.5" style={{ maxWidth: 280, color: SUB }}>{[sn.stage, sn.invoice, sn.deposit].filter(Boolean).join(' · ')}{(sn.outstanding || []).length > 0 && <div style={{ color: S.blocked[0] }}>{sn.outstanding.slice(0, 3).join(' · ') + (sn.outstanding.length > 3 ? ' · +' + (sn.outstanding.length - 3) + ' more' : '')}</div>}</td>
          <td className="px-2 py-1.5" style={{ maxWidth: 240 }}>{nowWords}{stillOpen ? <div style={{ color: S.wait[0] }}>{now.outstanding.length + ' requirement' + (now.outstanding.length === 1 ? '' : 's') + ' still open'}</div> : null}</td>
          <td className="px-2 py-1.5" style={{ minWidth: 130 }}><div className="grid gap-1">
            {now && <Btn onClick={function () { p.openOrder(x.order_id); setTimeout(function () { try { document.getElementById('nt-order-report').scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {} }, 80); }}>Open report</Btn>}
            {p.canManage && (!f || f.id !== x.id) && <Btn disabled={p.busy} onClick={function () { p.setBackF({ id: x.id, note: '' }); }}>↩ Put back</Btn>}
            {p.canManage && f && f.id === x.id && <div className="grid gap-1 p-1.5 rounded-lg" style={{ border: '1px solid ' + LINE, background: '#fbfcfd', width: 190 }}>
              <b className="text-[11px]">Put back on the report</b>
              <input id={'nt-om-back-note-' + x.id} autoFocus value={f.note} onChange={function (e) { var v = e.target.value; p.setBackF(function (c) { return Object.assign({}, c, { note: v }); }); }} onKeyDown={function (e) { if (e.key === 'Enter' && !p.busy) { p.putBack(a, f.note); } if (e.key === 'Escape') { p.setBackF(null); } }} placeholder="why (optional)" className="px-1.5 py-1 rounded text-[11px] nt-light" style={{ border: '1px solid ' + LINE, color: INK, background: '#ffffff' }} />
              <div className="flex gap-1"><Btn dark disabled={p.busy} onClick={function () { p.putBack(a, f.note); }}>Put back</Btn><Btn onClick={function () { p.setBackF(null); }}>Cancel</Btn></div></div>}
          </div></td></tr>; })}
        {list.length === 0 && <tr><td colSpan={8} className="px-3 py-4 text-center" style={{ color: SUB }}>Nothing archived{' '}— rows marked Non issue or Corrected show here.</td></tr>}</tbody>
    </table>
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
        <div className="rounded-lg p-3 grid gap-1.5" style={{ border: '1px solid ' + LINE }}><span className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: SUB }}>Invoice</span><Pill k={INV_KEY[r.invoice.state] || 'na'}>{INV_WORDS[r.invoice.state]}</Pill><span className="text-[11px]">{r.invoice.words}</span>{(r.invoice.items || []).map(function (i) { return <button key={i.id} type="button" onClick={function () { p.openInvoice(i.id); }} className="text-[11px] underline font-bold justify-self-start" style={{ color: '#0f5c8c', background: 'none', border: 0, padding: 0 }}>{'✏ Open invoice ' + i.number}</button>; })}{(j.report.invoice_flags || []).map(function (x) { return <span key={x} className="text-[11px]" style={{ color: S.wait[0] }}>{'⚠ ' + x}</span>; })}</div>
        <div className="rounded-lg p-3 grid gap-1.5" style={{ border: '1px solid ' + LINE }}><span className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: SUB }}>Shipping readiness</span><Pill k="prog">{r.groups.shipping.done + ' of ' + r.groups.shipping.total + ' applicable'}</Pill>{bar(r.groups.shipping.done, r.groups.shipping.total, 'prog')}<span className="text-[11px]" style={{ color: SUB }}>{r.groups.shipping.na + ' not applicable, not counted'}</span></div>
        <div className="rounded-lg p-3 grid gap-1.5" style={{ border: '1px solid ' + LINE }}><span className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: SUB }}>Documents</span><Pill k="wait">{r.groups.documents.done + ' of ' + r.groups.documents.total + ' applicable'}</Pill>{bar(r.groups.documents.done, r.groups.documents.total, 'wait')}<span className="text-[11px]" style={{ color: SUB }}>{r.groups.documents.na + ' not applicable, not counted'}</span></div>
      </div>
      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)' }}>
        <div className="rounded-lg overflow-hidden" style={{ border: '1px solid ' + LINE }}>
          {STAGES.filter(function (st) { return groups[st[0]]; }).map(function (st) { var g = groups[st[0]]; var ap = g.filter(function (it) { return it.applies; });
            return <div key={st[0]}><div className="flex justify-between px-3 py-1.5 text-[11px] font-bold" style={{ background: BG, borderTop: '1px solid ' + LINE }}><span>{st[1]}</span><span style={{ color: SUB }}>{ap.filter(function (it) { return it.status === 'done'; }).length + ' / ' + ap.length}</span></div>
              {g.map(function (it) { var key = it.status === 'done' ? 'done' : (it.status === 'na' || it.status === 'untracked') ? 'na' : it.status === 'missing' ? 'blocked' : 'wait';
                return <div key={it.key} title={it.status === 'untracked' ? 'This warehouse copy does not have this field yet' : undefined} className="flex justify-between gap-2 px-3 py-1.5 text-[12px]" style={{ borderTop: '1px solid ' + LINE }}><span>{it.label}{it.why && <span className="block text-[10px]" style={{ color: SUB }}>{it.why}</span>}</span>
                  <span className="flex items-center gap-1">{p.canManage && it.status === 'missing' && <button type="button" title="Mark this requirement not applicable for this order (needs a reason)" onClick={function () { setF({ na: it.key, na_label: it.label, reason: '' }); }} className="text-[10px] underline" style={{ color: SUB, background: 'none', border: 0 }}>N/A?</button>}<Pill k={key}>{STATUS_WORDS[it.status] || it.status}</Pill></span></div>; })}</div>; })}
        </div>
        <div className="grid gap-3 content-start">
          <div className="rounded-lg p-3 grid gap-1.5" style={{ border: '2px solid ' + (missing.length ? S.blocked[0] : S.done[0]) }}><b className="text-[13px]" style={{ color: missing.length ? S.blocked[0] : S.done[0] }}>{missing.length ? 'Missing — ' + missing.length + ' item' + (missing.length === 1 ? '' : 's') : 'Nothing missing for the stages reached'}</b>
            <ol className="text-[12px] grid gap-1" style={{ margin: 0, paddingLeft: 18 }}>{missing.slice(0, 12).map(function (it) { return <li key={it.key}>{it.label}</li>; })}</ol></div>
          {r.next_action && <div className="rounded-lg p-3" style={{ background: INK, color: '#ffffff' }}><div className="text-[10px] uppercase opacity-75">Next action</div><b className="text-[13px]">{r.next_action}</b></div>}
          <div className="flex flex-wrap gap-2 text-[11px]">{j.closing_allowed === false && <span style={{ color: SUB }}>{'Closing from the Hub: off (' + (j.closing_blocked_why || '') + ')'}</span>}{r.links.nextrade && <a href={r.links.nextrade} target="_blank" rel="noreferrer" style={{ color: '#0f5c8c', border: '1px solid ' + LINE, borderRadius: 5, padding: '3px 9px' }}>Order in Nextrade ↗</a>}<a href={r.links.hub} style={{ color: '#0f5c8c', border: '1px solid ' + LINE, borderRadius: 5, padding: '3px 9px' }}>Link to this report</a></div>
          <div className="rounded-lg p-3 grid gap-1 text-[12px]" style={{ border: '1px solid ' + LINE }}><b>Closing</b>
            {j.extra.closures.length > 0 && j.extra.closures.map(function (c, i) { return <div key={i} style={{ color: SUB }}>{'Closed (' + c.mode + ') ' + when(c.closed_at) + (c.written_to_nextrade ? ' — also closed in Nextrade' : ' — NOT closed in Nextrade') + (c.reason ? ': ' + c.reason : '')}</div>; })}
            <div>{r.closure.eligible ? <span style={{ color: S.done[0], fontWeight: 700 }}>{r.closure.forced ? 'Will be closed: ' + r.closure.words : 'Ready — closes automatically in the overnight review (when automatic closing is on).'}</span> : r.closure.held ? <span style={{ color: S.wait[0], fontWeight: 700 }}>{r.closure.words}</span> : <span style={{ color: SUB }}>{'Not ready to close: ' + (r.closure.missing || []).slice(0, 4).join('; ')}</span>}</div>
            {r.closure.forced && (r.closure.missing || []).length > 0 && <div style={{ color: S.wait[0] }}>{'Still open underneath: ' + r.closure.missing.slice(0, 4).join('; ')}</div>}
          </div>
          <div className="rounded-lg p-3 grid gap-1 text-[12px]" style={{ border: '1px solid ' + LINE }}><b>Bills on this release</b>
            {(r.bills || []).length === 0 ? <span style={{ color: SUB }}>No forwarder or trucker bill in the Hub yet.</span> : r.bills.map(function (b) { return <div key={b.id}>{(b.bill_type === 'shipping' ? 'Forwarder' : 'Trucker') + ' · ' + (b.vendor || '') + ' ' + (b.number || '') + ' · $' + fmt(b.total) + ' · ' + (b.paid + 0.005 >= b.total ? 'paid' : 'paid $' + fmt(b.paid))}</div>; })}</div>
          {(j.extra.archive || []).length > 0 && <div className="rounded-lg p-3 grid gap-1 text-[12px]" style={{ border: '1px solid ' + LINE }}><b>Archive history (Non issue / Corrected)</b>{j.extra.archive.map(function (a, i) { return <div key={i} style={{ color: SUB }}>{({ non_issue: 'Non issue', corrected: 'Corrected' })[a.choice] + ' — ' + (a.archived_by_name || 'someone') + ', ' + when(a.archived_at) + (a.note ? ': ' + a.note : '') + (a.restored_at ? ' · put back by ' + (a.restored_by_name || 'someone') + ', ' + when(a.restored_at) + (a.restore_note ? ': ' + a.restore_note : '') : ' · in the archive now')}</div>; })}</div>}
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
          {r.stage !== 'closed' && j.closing_allowed !== false && <Btn onClick={function () { setF({ mode: 'close_now', reason: '' }); }}>Close now…</Btn>}
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

// v55.83-TM (Max, Nov 17: "Need a reconciliation of orders release numbers from NT warehouse that do not have a linked KTC invoice
// from June 2026 on ... links should lead to something to fix it") — every warehouse order (main + obsolete) since the date whose
// release is on no active KTC invoice, grouped by what is wrong, each with the button that fixes it.
var REC_GROUPS = [['none', 'No invoice at all', 'blocked'], ['in_notes', 'Only in an invoice’s notes', 'wait'], ['cancelled_only', 'Only on cancelled / void invoices', 'blocked'], ['no_release', 'No release number in Nextrade', 'wait'], ['po_so_only', 'Linked the Wave way (P.O./S.O.) — Release # empty', 'prog']];
function ReconView(p) {
  var s1 = useState(null); var d = s1[0]; var setD = s1[1];
  var s2 = useState('2026-06-01'); var since = s2[0]; var setSince = s2[1];
  var s3 = useState('problems'); var g = s3[0]; var setG = s3[1];
  var s4 = useState(''); var err = s4[0]; var setErr = s4[1];
  var s5 = useState(''); var q = s5[0]; var setQ = s5[1];
  var s6 = useState('shipped'); var ph = s6[0]; var setPh = s6[1]; // v55.83-VH — warehouse phase: shipped first (the real alarm)
  function load(sv) { setD(null); setErr(''); p.call({ action: 'reconcile', since: sv || since }).then(function (j) { if (j && j.ok) { setD(j); } else { setErr((j && j.error) || 'Could not build the reconciliation.'); } }); }
  useEffect(function () { load(); }, []); // eslint-disable-line
  if (err) { return <div className="px-3 py-3 text-[12px] font-bold" style={{ color: S.blocked[0] }}>{'⛔ ' + err}</div>; }
  if (!d) { return <div className="px-3 py-3 text-[12px]" style={{ color: SUB }}>Comparing every warehouse release with the KTC invoices…</div>; }
  var allRows = d.rows || [];
  // VH (Max 19 Nov) — shipped orders with no invoice are kept apart from orders not shipped yet and from other statuses
  var phCnt = { shipped: 0, not_shipped: 0, other: 0 }; allRows.forEach(function (r) { var k = r.phase || 'other'; phCnt[k] = (phCnt[k] || 0) + 1; });
  var rows = ph === 'all' ? allRows : allRows.filter(function (r) { return (r.phase || 'other') === ph; });
  var cnt = {}; rows.forEach(function (r) { cnt[r.state] = (cnt[r.state] || 0) + 1; });
  var t = q.trim().toLowerCase();
  var shown = rows.filter(function (r) { if (g === 'problems' ? r.state === 'po_so_only' : (g !== 'all' && r.state !== g)) { return false; } return !t || (r.release_number + ' ' + r.order_id + ' ' + r.customer).toLowerCase().indexOf(t) >= 0; });
  var poIds = rows.filter(function (r) { return r.state === 'po_so_only'; }).reduce(function (a, r) { return a.concat(r.po_so.map(function (i) { return i.id; })); }, []);
  function csv() {
    var head = ['Release', 'Order', 'Source', 'Customer', 'Date', 'Date kind', 'Warehouse status', 'Shipped?', 'Problem', 'Invoices (P.O./S.O.)', 'Cancelled invoices', 'Invoices whose notes mention it', 'Possible invoices (same customer, no release)'];
    var lines = [head].concat(shown.map(function (r) { return [r.release_number, r.order_id, r.source, r.customer, r.date, r.date_kind, r.status, ({ shipped: 'Shipped', not_shipped: 'Not shipped yet', other: 'Other status' })[r.phase] || 'Other status', r.words, r.po_so.map(function (i) { return i.number; }).join(' '), r.cancelled.map(function (i) { return i.number; }).join(' '), (r.in_notes || []).map(function (i) { return i.number; }).join(' '), r.suggestions.map(function (i) { return i.number + ' ' + i.date; }).join(' | ')]; }));
    var text = lines.map(function (l) { return l.map(function (c) { var v = String(c === null || c === undefined ? '' : c); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }).join('\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = 'releases-without-ktc-invoice-since-' + d.since + '.csv'; a.click();
  }
  function invBtn(i, label) { return <button key={i.id} type="button" onClick={function () { p.openInvoice(i.id); }} className="underline font-bold" style={{ color: '#0f5c8c', background: 'none', border: 0, padding: 0 }} title="Open this invoice in the editor">{(label || '✏ ') + i.number}</button>; }
  return <div style={{ borderTop: '1px solid ' + LINE }}>
    <div className="flex flex-wrap items-center gap-2 px-3 py-2" style={{ background: '#fbfcfd' }}>
      <b className="text-[13px]">🔎 Warehouse releases with no KTC invoice</b>
      <span className="text-[11px]" style={{ color: SUB }}>since</span>
      <input type="date" value={since} onChange={function (e) { setSince(e.target.value); }} className="px-2 py-0.5 rounded text-[11px] nt-light" style={{ border: '1px solid ' + LINE, color: INK, background: '#ffffff' }} />
      <Btn onClick={function () { load(since); }}>Check again</Btn>
      <span className="text-[11px]" style={{ color: SUB }}>{d.orders_checked + ' warehouse orders read (main + obsolete). Date = shipped, else load date, else created. Cancelled and test orders are left out.'}</span>
      <div className="flex-1" />
      <Btn onClick={csv}>⬇ CSV</Btn>
    </div>
    <div className="flex flex-wrap gap-1.5 px-3 pt-2 items-center">
      <span className="text-[11px] font-bold" style={{ color: SUB }}>Warehouse status:</span>
      {[['shipped', 'Shipped', 'blocked'], ['not_shipped', 'Not shipped yet', 'wait'], ['other', 'Other statuses', 'na'], ['all', 'All statuses', 'na']].map(function (x) {
        var n = x[0] === 'all' ? allRows.length : (phCnt[x[0]] || 0);
        return <button key={x[0]} type="button" onClick={function () { setPh(x[0]); }} className="px-3 py-1 rounded-full text-[11px] font-bold" style={ph === x[0] ? { background: INK, color: '#ffffff' } : { background: '#ffffff', color: n && x[2] === 'blocked' ? S.blocked[0] : INK, border: '1px solid ' + LINE }}>{x[1] + ' · ' + n}</button>; })}
      <span className="text-[11px]" style={{ color: SUB }}>{ph === 'shipped' ? 'Shipped (or later) with no KTC invoice — these need one now.' : ph === 'not_shipped' ? 'Not shipped yet — an invoice may still come; not an alarm yet.' : ph === 'other' ? 'Any status the Hub does not recognise.' : 'Every status together.'}</span>
    </div>
    <div className="flex flex-wrap gap-1.5 px-3 py-2 items-center">
      {[['problems', 'Needs an invoice or a fix', 'blocked']].concat(REC_GROUPS).concat([['all', 'Everything', 'na']]).map(function (x) {
        var n = x[0] === 'problems' ? rows.filter(function (r) { return r.state !== 'po_so_only'; }).length : x[0] === 'all' ? rows.length : (cnt[x[0]] || 0);
        return <button key={x[0]} type="button" onClick={function () { setG(x[0]); }} className="px-3 py-1 rounded-full text-[11px] font-bold" style={g === x[0] ? { background: INK, color: '#ffffff' } : { background: '#ffffff', color: n && x[2] === 'blocked' ? S.blocked[0] : INK, border: '1px solid ' + LINE }}>{x[1] + ' · ' + n}</button>; })}
      <input value={q} onChange={function (e) { setQ(e.target.value); }} placeholder="release, order, customer…" className="px-2 py-1 rounded-lg text-[11px] nt-light" style={{ border: '1px solid ' + LINE, width: 200, color: INK, background: '#ffffff' }} />
      {(g === 'po_so_only' || g === 'all') && poIds.length > 0 && d.can_edit_invoices && <Btn dark disabled={p.busy} onClick={function () { p.copyRelease(poIds).then(function (ok) { if (ok) { load(); } }); }}>{'Copy P.O./S.O. → Release # on all ' + poIds.length}</Btn>}
    </div>
    <div className="px-3 pb-2 text-[11px]" style={{ color: SUB }}>Wave invoices keep the release in their P.O./S.O. field — those count as linked (last group). The Release Number on the invoice is what the profit report uses, so copying it across is worth doing; it fills only an empty Release Number and is recorded in the audit trail.</div>
    <div className="overflow-auto nt-solid-head" style={{ borderTop: '1px solid ' + LINE, maxHeight: '62vh' }}>
      <table className="w-full text-[11px]" style={{ minWidth: 1000 }}>
        <thead><tr>{['Release · order', 'Customer', 'Date', 'Warehouse status', 'What is wrong', 'Fix it'].map(function (h) { return <th key={h} className="px-2 py-1.5 text-left font-semibold sticky top-0" style={{ background: BG, color: SUB, borderBottom: '1px solid ' + LINE }}>{h}</th>; })}</tr></thead>
        <tbody>{shown.map(function (r) {
          var grp = REC_GROUPS.filter(function (x) { return x[0] === r.state; })[0] || ['', r.state, 'na'];
          return <tr key={r.source + ':' + r.order_id} style={{ borderBottom: '1px solid ' + LINE, boxShadow: grp[2] === 'blocked' ? 'inset 3px 0 0 ' + S.blocked[0] : 'none' }}>
            <td className="px-2 py-1.5"><b style={{ fontFamily: 'ui-monospace, Consolas, monospace' }}>{r.release_number || '—'}</b><div style={{ color: SUB }}>{(r.source === 'obsolete' ? 'obsolete order ' : 'order ') + r.order_id}{r.link && <a href={r.link} target="_blank" rel="noreferrer" style={{ color: '#0f5c8c', marginLeft: 6 }}>Nextrade ↗</a>}</div></td>
            <td className="px-2 py-1.5">{r.customer || '—'}</td>
            <td className="px-2 py-1.5 whitespace-nowrap">{nd(r.date)}<div style={{ color: SUB }}>{r.date_kind}</div></td>
            <td className="px-2 py-1.5">{r.status || '—'}</td>
            <td className="px-2 py-1.5" style={{ maxWidth: 320 }}><Pill k={grp[2]}>{grp[1]}</Pill><div className="mt-0.5">{r.words}</div></td>
            <td className="px-2 py-1.5"><div className="grid gap-1 justify-items-start">
              {r.state === 'po_so_only' && r.po_so.map(function (i) { return <div key={i.id} className="flex gap-1 items-center flex-wrap">{invBtn(i)}{d.can_edit_invoices && <button type="button" disabled={p.busy} onClick={function () { p.copyRelease([i.id]).then(function (ok) { if (ok) { load(); } }); }} className="px-1.5 rounded text-[10px] font-bold" style={{ background: S.prog[0], color: '#ffffff', border: 0 }}>copy to Release #</button>}</div>; })}
              {r.state === 'in_notes' && (r.in_notes || []).map(function (i) { return <div key={i.id}>{invBtn(i, '✏ Open ')}<span style={{ color: SUB }}>{' — type ' + r.release_number + ' in Release Number'}</span></div>; })}
              {r.state === 'cancelled_only' && r.cancelled.map(function (i) { return <div key={i.id}>{invBtn(i, 'See cancelled ')}</div>; })}
              {(r.state === 'none' || r.state === 'cancelled_only' || r.state === 'in_notes') && r.suggestions.length > 0 && <div className="grid gap-0.5"><span style={{ color: SUB }}>Maybe one of these (same customer, no release number) — open it and type the release:</span>{r.suggestions.map(function (i) { return <div key={i.id}>{invBtn(i)}<span style={{ color: SUB }}>{' · ' + nd(i.date) + ' · $' + fmt(i.total)}</span></div>; })}</div>}
              {(r.state === 'none' || r.state === 'cancelled_only') && <button type="button" onClick={p.newInvoice} className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: S.blocked[0], color: '#ffffff', border: 0 }}>{'＋ New invoice for ' + (r.release_number || 'this order')}</button>}
              {r.state === 'no_release' && (r.link ? <a href={r.link} target="_blank" rel="noreferrer" className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: S.wait[0], color: '#ffffff' }}>Open the order in Nextrade — fill the release ↗</a> : <span style={{ color: SUB }}>Fill the release number on this order in Nextrade.</span>)}
            </div></td></tr>; })}
          {shown.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-center" style={{ color: SUB }}>Nothing in this group.</td></tr>}</tbody>
      </table>
    </div>
  </div>;
}
