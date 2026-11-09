'use client';
// NexttradeReconciliation — v55.83-NM (Max Sep 23 2026)
//
// Paste the Orders table straight from NextTradeIndustries.com/admin (exactly
// the copy-paste Max already did into chat), import it, and reconcile against
// Hub invoices. The parser handles the site's real shape: tab-separated cells
// when copied from the browser, whitespace-collapsed text otherwise, the
// MM-DD-YYYY dates, '-' for missing dates, '0' containers for local runs, and
// duplicate lines within one paste (dedup by RELEASE #, first wins).
import React, { useState, useContext, useEffect } from 'react';
import { ToastContext } from '../lib/toast-context';
import { supabase } from '../lib/supabase';
import { RECON_STATUS_LABEL } from '../lib/order-recon'; // v55.83-RG

// v55.83-RG (Max 15:32): "for order reconciliation needs to keep record of each
// one completed.. save it and it needs to be manually reconciled and approved."
// Every saved run is kept: resolve each exception line with a note → one person
// marks it RECONCILED → a DIFFERENT person APPROVES (or sends it back) → locked.
var RSTYLE = { open: { background: '#fef3c7', color: '#78350f' }, reconciled: { background: '#dbeafe', color: '#1e3a8a' }, approved: { background: '#d1fae5', color: '#065f46' } };
export function SavedReconciliations(props) {
  var userProfile = props.userProfile; var toast = props.toast;
  var a1 = useState(null); var runs = a1[0]; var setRuns = a1[1];
  var a2 = useState(null); var run = a2[0]; var setRun = a2[1];
  var a3 = useState(false); var busy = a3[0]; var setBusy = a3[1];
  var a4 = useState({}); var notes = a4[0]; var setNotes = a4[1];
  var a5 = useState(''); var signNote = a5[0]; var setSignNote = a5[1];
  var a6 = useState(false); var onlyOpen = a6[0]; var setOnlyOpen = a6[1];
  function api(payload) {
    return fetch('/api/reconcile/nexttrade', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ user_id: userProfile && userProfile.id }, payload)) }).then(function (r) { return r.json(); });
  }
  function loadRuns() { api({ action: 'list_runs' }).then(function (j) { if (j && j.ok) { setRuns(j.runs || []); } else { setRuns([]); if (j && j.error) { toast.error(j.error); } } }).catch(function () { setRuns([]); }); }
  function openRun(id) {
    setBusy(true);
    api({ action: 'get_run', run_id: id }).then(function (j) {
      if (j && j.ok) { setRun(j.run); var n = {}; (j.run.lines || []).forEach(function (l) { n[l.key] = l.note || ''; }); setNotes(n); setSignNote(''); }
      else { toast.error((j && j.error) || 'Could not open it.'); }
    }).finally(function () { setBusy(false); });
  }
  function saveRun() {
    setBusy(true);
    api({ action: 'save_run', date_from: props.from || null, date_to: props.to || null }).then(function (j) {
      if (j && j.ok) { toast.success('Saved — ' + j.lines + ' line(s) to resolve. It is now on record.'); loadRuns(); openRun(j.id); }
      else { toast.error((j && j.error) || 'Could not save it.'); }
    }).finally(function () { setBusy(false); });
  }
  function resolve(l, val) {
    setBusy(true);
    api({ action: 'resolve_line', run_id: run.id, key: l.key, resolved: val, note: notes[l.key] || '' }).then(function (j) {
      if (j && j.ok) { openRun(run.id); loadRuns(); } else { toast.error((j && j.error) || 'Could not save the line.'); }
    }).finally(function () { setBusy(false); });
  }
  function step(action, okMsg) {
    setBusy(true);
    api({ action: action, run_id: run.id, note: signNote }).then(function (j) {
      if (j && j.ok) { toast.success(okMsg); openRun(run.id); loadRuns(); } else { toast.error((j && j.error) || 'Could not do that.'); }
    }).finally(function () { setBusy(false); });
  }
  useEffect(function () { loadRuns(); }, []); // eslint-disable-line
  var nx = run && run.next; var pg = run && run.progress;
  var shown = (runs || []).filter(function (r) { return !onlyOpen || r.status !== 'approved'; });
  return <div className="bg-white rounded-xl border border-slate-200 p-3 mb-3">
    <div className="flex gap-2 items-center flex-wrap mb-2">
      <div className="text-sm font-extrabold text-slate-900">💾 Saved reconciliations — kept on record, reconciled by one person, approved by another</div>
      <div className="flex-1" />
      <label className="flex items-center gap-1 text-[10px] font-bold" style={{ color: '#334155' }}><input type="checkbox" checked={onlyOpen} onChange={function (e) { setOnlyOpen(e.target.checked); }} /> hide approved</label>
      {props.canSave && <button onClick={saveRun} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs font-extrabold disabled:opacity-50" style={{ background: '#0f766e', color: '#ffffff' }}>
        💾 Save this reconciliation{props.from || props.to ? ' (' + (props.from || 'start') + ' → ' + (props.to || 'today') + ')' : ' (all dates)'}</button>}
    </div>
    {!runs ? <div className="text-[11px] text-slate-500">Loading…</div> : <div className="overflow-x-auto"><table className="w-full text-[11px]">
      <thead><tr style={{ borderBottom: '1px solid #cbd5e1', color: '#475569' }}>
        <th className="py-1 pr-2 text-left font-semibold">Saved</th><th className="py-1 pr-2 text-left font-semibold">Period</th>
        <th className="py-1 pr-2 text-right font-semibold">Orders</th><th className="py-1 pr-2 text-right font-semibold">Lines resolved</th>
        <th className="py-1 pr-2 text-left font-semibold">Status</th><th className="py-1 text-left font-semibold">Reconciled · Approved</th></tr></thead>
      <tbody style={{ color: '#0f172a' }}>
        {shown.map(function (r) {
          return <tr key={r.id} onClick={function () { openRun(r.id); }} style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer', background: run && run.id === r.id ? '#eef2ff' : undefined }}>
            <td className="py-1 pr-2 whitespace-nowrap">{String(r.created_at || '').substring(0, 16).replace('T', ' ')}{r.created_by ? ' · ' + r.created_by : ''}</td>
            <td className="py-1 pr-2">{(r.period_from || 'all') + ' → ' + (r.period_to || 'all')}</td>
            <td className="py-1 pr-2 text-right">{r.summary ? r.summary.orders_in_scope : '—'}</td>
            <td className="py-1 pr-2 text-right font-bold">{r.progress.resolved + ' / ' + r.progress.total}</td>
            <td className="py-1 pr-2"><span className="px-1.5 py-0.5 rounded text-[10px] font-extrabold" style={RSTYLE[r.status]}>{RECON_STATUS_LABEL[r.status]}</span></td>
            <td className="py-1 text-[10px]" style={{ color: '#334155' }}>{(r.reconciled_by || '—') + ' · ' + (r.approved_by || '—')}</td>
          </tr>;
        })}
        {shown.length === 0 && <tr><td colSpan={6} className="py-2 text-center text-[11px]" style={{ color: '#64748b' }}>Nothing saved yet — run the reconciliation, then 💾 Save it.</td></tr>}
      </tbody></table></div>}

    {run && <div className="mt-3 rounded-lg p-2" style={{ border: '2px solid #6366f1' }}>
      <div className="flex gap-2 items-center flex-wrap mb-1">
        <div className="text-[12px] font-extrabold" style={{ color: '#0f172a' }}>{'Reconciliation ' + (run.period_from || 'all') + ' → ' + (run.period_to || 'all') + ' · saved ' + String(run.created_at || '').substring(0, 16).replace('T', ' ') + (run.created_by ? ' by ' + run.created_by : '')}</div>
        <span className="px-1.5 py-0.5 rounded text-[10px] font-extrabold" style={RSTYLE[run.status]}>{RECON_STATUS_LABEL[run.status]}</span>
        <div className="flex-1" />
        <button onClick={function () { setRun(null); }} className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#e2e8f0', color: '#334155' }}>✕ close</button>
      </div>
      {run.snapshot && run.snapshot.summary && <div className="text-[11px] mb-1" style={{ color: '#334155' }}>
        {'Snapshot: ' + run.snapshot.summary.orders_in_scope + ' orders · ' + run.snapshot.summary.matched + ' matched · ' + run.snapshot.summary.orders_without_invoice + ' without invoice · ' + run.snapshot.summary.invoices_without_order + ' invoices without order · ' + run.snapshot.summary.invoices_with_open_balance + ' open balances (kept for the record; they stay flagged on the AR side until paid)'}</div>}
      <div className="text-[11px] font-extrabold mb-1" style={{ color: '#0f172a' }}>{'① Resolve every exception line (' + pg.resolved + ' of ' + pg.total + ' done)'}</div>
      <div className="overflow-auto rounded border border-slate-200" style={{ maxHeight: 360 }}><table className="w-full text-[11px]">
        <thead><tr style={{ background: '#f1f5f9', color: '#334155' }}>
          <th className="px-1.5 py-1 text-left font-bold">Exception</th><th className="px-1.5 py-1 text-left font-bold">Release / ref</th>
          <th className="px-1.5 py-1 text-left font-bold">Customer</th><th className="px-1.5 py-1 text-left font-bold">Date</th>
          <th className="px-1.5 py-1 text-left font-bold">What was done / found</th><th className="px-1.5 py-1 text-left font-bold">Resolved</th></tr></thead>
        <tbody style={{ color: '#0f172a' }}>
          {(run.lines || []).map(function (l) {
            return <tr key={l.key} className="border-t border-slate-100" style={{ background: l.resolved ? '#f0fdf4' : undefined, verticalAlign: 'top' }}>
              <td className="px-1.5 py-1 whitespace-nowrap" style={{ color: l.kind === 'order_without_invoice' ? '#7f1d1d' : '#78350f', fontWeight: 700 }}>{l.kind === 'order_without_invoice' ? '🚨 order, no invoice' : '🧐 invoice, no order'}</td>
              <td className="px-1.5 py-1 font-bold">{l.ref}</td>
              <td className="px-1.5 py-1">{l.who}</td>
              <td className="px-1.5 py-1 whitespace-nowrap">{l.date || ''}</td>
              <td className="px-1.5 py-1">{nx.can_edit ? <input value={notes[l.key] || ''} onChange={function (e) { var n2 = Object.assign({}, notes); n2[l.key] = e.target.value; setNotes(n2); }}
                placeholder="e.g. invoiced as INV-2231 / order cancelled / sample, no invoice" className="w-full px-1.5 py-0.5 rounded border border-slate-300 text-[11px] nt-light" style={{ color: '#0f172a', background: '#ffffff', minWidth: 220 }} />
                : <span>{l.note}</span>}{l.by ? <div className="text-[9px]" style={{ color: '#64748b' }}>{l.by + ' · ' + String(l.at || '').substring(0, 16).replace('T', ' ')}</div> : null}</td>
              <td className="px-1.5 py-1 whitespace-nowrap">{nx.can_edit ? (l.resolved
                ? <button onClick={function () { resolve(l, false); }} disabled={busy} className="px-1.5 py-0.5 rounded text-[10px] font-extrabold" style={{ background: '#d1fae5', color: '#065f46' }}>✓ resolved (undo)</button>
                : <button onClick={function () { resolve(l, true); }} disabled={busy || String(notes[l.key] || '').trim().length < 3} className="px-1.5 py-0.5 rounded text-[10px] font-extrabold disabled:opacity-50" style={{ background: '#1e293b', color: '#ffffff' }}>mark resolved</button>)
                : (l.resolved ? '✓' : '—')}</td>
            </tr>;
          })}
          {(run.lines || []).length === 0 && <tr><td colSpan={6} className="px-2 py-2 text-[11px]" style={{ color: '#065f46' }}>No exceptions in this run 🎉 — it can be reconciled straight away.</td></tr>}
        </tbody></table></div>
      <div className="mt-2 text-[11px] font-extrabold" style={{ color: '#0f172a' }}>②③ Reconciled by one person · approved by a DIFFERENT person</div>
      <div className="text-[11px] mb-1" style={{ color: '#334155' }}>
        {'Reconciled: ' + (run.reconciled_by ? run.reconciled_by + ' · ' + String(run.reconciled_at || '').substring(0, 16).replace('T', ' ') + (run.reconciled_note ? ' — “' + run.reconciled_note + '”' : '') : '—')}
        {' · Approved: ' + (run.approved_by ? run.approved_by + ' · ' + String(run.approved_at || '').substring(0, 16).replace('T', ' ') + (run.approved_note ? ' — “' + run.approved_note + '”' : '') : '—')}</div>
      {run.status !== 'approved' && <div className="flex gap-2 items-center flex-wrap">
        <input value={signNote} onChange={function (e) { setSignNote(e.target.value); }} placeholder={run.status === 'reconciled' ? 'approval note (required to send back)' : 'note (optional)'}
          className="px-2 py-1 rounded-lg border border-slate-300 text-[11px] nt-light" style={{ color: '#0f172a', background: '#ffffff', flex: '1 1 240px' }} />
        {run.status === 'open' && <button onClick={function () { step('mark_reconciled', 'Marked RECONCILED — a different person must approve it.'); }} disabled={busy || !nx.can_reconcile}
          className="px-3 py-1 rounded-lg text-[11px] font-extrabold disabled:opacity-50" style={{ background: '#1d4ed8', color: '#ffffff' }}>✍ Mark reconciled</button>}
        {run.status === 'reconciled' && <button onClick={function () { step('approve_run', 'APPROVED — this reconciliation is now locked on record.'); }} disabled={busy || !nx.can_approve}
          className="px-3 py-1 rounded-lg text-[11px] font-extrabold disabled:opacity-50" style={{ background: '#047857', color: '#ffffff' }}>✅ Approve</button>}
        {run.status === 'reconciled' && <button onClick={function () { step('send_back', 'Sent back to open — the reconciler fixes it and marks it again.'); }} disabled={busy || !nx.can_approve}
          className="px-3 py-1 rounded-lg text-[11px] font-extrabold disabled:opacity-50" style={{ background: '#fee2e2', color: '#7f1d1d' }}>↩ Send back</button>}
        {nx.why ? <span className="text-[10px] font-bold" style={{ color: '#7f1d1d' }}>{nx.why}</span> : null}
      </div>}
    </div>}
  </div>;
}

var WAREHOUSES = ['Non-Bonded USA', 'CANADA', 'USA', 'Other']; // longest first — 'Non-Bonded USA' contains 'USA'
var STATUSES = ['Post Loading Documentation', 'End Stage', 'Shipped', 'Pending', 'Cancelled', 'Closed', 'Delivered', 'Completed'];

// Parse one pasted blob into row objects. Returns { rows, ignored }.
export function parseOrdersPaste(text) {
  var rows = []; var ignored = 0; var seen = {};
  var lines = String(text || '').split(/\r?\n/);
  var i;
  for (i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) { continue; }
    // A data line: starts with a row index, then a release number somewhere after.
    var m = line.match(/^\d{1,5}[\t ]+(\d{3,4}-\d{2,5})[\t ]+(.+)$/);
    if (!m) { continue; }
    var rel = m[1]; var rest = m[2];
    if (seen[rel]) { continue; }
    var row = { release_number: rel };

    var cells = rest.split('\t').map(function (c) { return c.trim(); }).filter(function (c) { return c !== ''; });
    if (cells.length >= 8) {
      // Tab copy: CUSTOMER, WAREHOUSE, CONTAINER, ORDER, SHIPPED, ARRIVAL, [FROM PENDING], STATUS, [MIX], COUNTRY, SECONDS, THIRDS, PAPER, [ACTIONS junk]
      row.customer_name = cells[0]; row.warehouse = cells[1]; row.container = cells[2];
      row.order_date = cells[3]; row.shipped_date = cells[4]; row.arrival_date = cells[5];
      var restCells = cells.slice(6);
      // STATUS is the first cell matching a known status
      var si = -1; var s;
      for (s = 0; s < restCells.length; s++) { if (STATUSES.indexOf(restCells[s]) > -1) { si = s; break; } }
      row.status = si > -1 ? restCells[si] : null;
      var after = si > -1 ? restCells.slice(si + 1) : restCells;
      // Trailing numeric triple = SECONDS THIRDS PAPER; country = last non-numeric before them
      var nums = []; var a;
      for (a = after.length - 1; a >= 0 && nums.length < 3; a--) {
        if (/^-?[\d,]+$/.test(after[a])) { nums.unshift(after[a].replace(/,/g, '')); } else { break; }
      }
      row.qty_seconds = nums.length === 3 ? Number(nums[0]) : 0;
      row.qty_thirds = nums.length === 3 ? Number(nums[1]) : 0;
      row.qty_paper = nums.length === 3 ? Number(nums[2]) : 0;
      var beforeNums = after.slice(0, after.length - nums.length);
      row.country = beforeNums.length ? beforeNums[beforeNums.length - 1] : null;
    } else {
      // Whitespace-collapsed copy: anchor on the warehouse token to split customer from the rest.
      var wIdx = -1; var wName = null; var w;
      for (w = 0; w < WAREHOUSES.length; w++) {
        var probe = rest.indexOf(WAREHOUSES[w]);
        if (probe > -1 && (wIdx === -1 || probe < wIdx)) { wIdx = probe; wName = WAREHOUSES[w]; }
      }
      if (wIdx === -1) { ignored += 1; continue; }
      row.customer_name = rest.substring(0, wIdx).trim();
      row.warehouse = wName;
      var tail = rest.substring(wIdx + wName.length).trim();
      var tm = tail.match(/^(\S+)\s+(\d{2}-\d{2}-\d{4})\s+(\d{2}-\d{2}-\d{4}|-)\s+(\d{2}-\d{2}-\d{4}|-)\s+(.*)$/);
      if (!tm) { ignored += 1; continue; }
      row.container = tm[1]; row.order_date = tm[2]; row.shipped_date = tm[3]; row.arrival_date = tm[4];
      var tail2 = tm[5];
      var st = null; var st2;
      for (st2 = 0; st2 < STATUSES.length; st2++) { if (tail2.indexOf(STATUSES[st2]) === 0) { st = STATUSES[st2]; break; } }
      row.status = st;
      var tail3 = st ? tail2.substring(st.length).trim() : tail2;
      var nm2 = tail3.match(/^(.*?)\s*([\d,]+)\s+([\d,]+)\s+([\d,]+)\s*$/);
      if (nm2) {
        row.country = nm2[1].trim() || null;
        row.qty_seconds = Number(nm2[2].replace(/,/g, '')) || 0;
        row.qty_thirds = Number(nm2[3].replace(/,/g, '')) || 0;
        row.qty_paper = Number(nm2[4].replace(/,/g, '')) || 0;
      } else { row.country = tail3 || null; row.qty_seconds = 0; row.qty_thirds = 0; row.qty_paper = 0; }
    }
    seen[rel] = true;
    rows.push(row);
  }
  return { rows: rows, ignored: ignored };
}

export default function NexttradeReconciliation(props) {
  var userProfile = props.userProfile;
  // v55.83-NV — mounted under Accounting now, whose props may not carry users;
  // fetch the team ourselves when absent (the flag-to-person picker needs it).
  var sU = useState(props.users || []); var users = sU[0]; var setUsers = sU[1];
  useEffect(function () {
    if (users.length) { return; }
    supabase.from('users').select('id, name, email, is_ai').order('name')
      .then(function (r) { if (r && r.data) { setUsers(r.data); } })
      .catch(function () {});
  }, []);
  var ctxToast = useContext(ToastContext);
  var toast = ctxToast || { success: function (m) { try { window.alert(m); } catch (e) {} }, error: function (m) { try { window.alert(m); } catch (e) {} } };

  var s1 = useState(''); var paste = s1[0]; var setPaste = s1[1];
  var s2 = useState(null); var preview = s2[0]; var setPreview = s2[1];
  var s3 = useState(false); var busy = s3[0]; var setBusy = s3[1];
  var s4 = useState(null); var report = s4[0]; var setReport = s4[1];
  var s5 = useState(''); var from = s5[0]; var setFrom = s5[1];
  var s6 = useState(''); var to = s6[0]; var setTo = s6[1];
  var s7 = useState(''); var flagTo = s7[0]; var setFlagTo = s7[1];
  var s8 = useState(null); var flagged = s8[0]; var setFlagged = s8[1];
  var s9 = useState(null); var missing = s9[0]; var setMissing = s9[1];
  var s10 = useState(''); var msearch = s10[0]; var setMsearch = s10[1];
  var s11 = useState({}); var draft = s11[0]; var setDraft = s11[1];

  function doPreview() {
    var p = parseOrdersPaste(paste);
    setPreview(p);
    if (!p.rows.length) { toast.error('No order lines recognized — paste the table body from the Orders page.'); }
  }
  function doImport() {
    if (!preview || !preview.rows.length) { return; }
    setBusy(true);
    fetch('/api/reconcile/nexttrade', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'import', rows: preview.rows, user_id: userProfile && userProfile.id })
    }).then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || j.ok !== true) { toast.error('Import failed: ' + ((j && j.error) || 'unknown') + (String((j && j.error) || '').indexOf('nexttrade_orders') > -1 ? ' — has the NM SQL been run?' : '')); return; }
        toast.success('Imported ' + j.imported + ' orders' + (j.skipped_invalid ? ' (' + j.skipped_invalid + ' invalid lines skipped)' : '') + '.');
        setPaste(''); setPreview(null);
      })
      .catch(function (e) { toast.error('Import failed: ' + ((e && e.message) || 'network')); })
      .finally(function () { setBusy(false); });
  }
  function runReport() {
    setBusy(true); setReport(null);
    fetch('/api/reconcile/nexttrade', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'report', user_id: userProfile && userProfile.id, date_from: from || null, date_to: to || null })
    }).then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || j.ok !== true) { toast.error('Report failed: ' + ((j && j.error) || 'unknown')); return; }
        setReport(j);
      })
      .catch(function (e) { toast.error('Report failed: ' + ((e && e.message) || 'network')); })
      .finally(function () { setBusy(false); });
  }
  function csv(rows, name) {
    if (!rows || !rows.length) { return; }
    var cols = Object.keys(rows[0]);
    var lines = [cols.join(',')];
    rows.forEach(function (r) { lines.push(cols.map(function (c) { var v = r[c] == null ? '' : String(r[c]); return '"' + v.replace(/"/g, '""') + '"'; }).join(',')); });
    var blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = name + '-' + new Date().toISOString().substring(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  function tbl(rows, tone) {
    if (!rows || !rows.length) { return <div className="text-[11px] text-slate-400 px-2 py-1">None 🎉</div>; }
    var cols = Object.keys(rows[0]);
    return (
      <div className="overflow-auto rounded border border-slate-200" style={{ maxHeight: 240 }}>
        <table className="w-full text-[10px]">
          <thead><tr>{cols.map(function (c) { return <th key={c} className="px-1.5 py-1 text-left font-bold whitespace-nowrap sticky top-0" style={{ background: tone === 'bad' ? '#fee2e2' : '#f1f5f9', color: '#0f172a' }}>{c}</th>; })}</tr></thead>
          <tbody>{rows.slice(0, 200).map(function (r, ri) {
            return <tr key={ri} className="border-t border-slate-100">{cols.map(function (c) { return <td key={c} className="px-1.5 py-0.5 whitespace-nowrap text-slate-800">{r[c] == null ? '' : String(r[c])}</td>; })}</tr>;
          })}</tbody>
        </table>
      </div>
    );
  }

  var isAdm = userProfile && (userProfile.role === 'super_admin' || userProfile.role === 'admin');
  // v55.83-RG — "Order Recon: Reconcile & Approve" alone shows the saved runs (resolve / reconcile / approve)
  var mpR = props.modulePerms || {};
  if (!isAdm && mpR['recon.signoff'] === true) { return <div className="p-3"><SavedReconciliations userProfile={userProfile} toast={toast} canSave={false} /></div>; }
  if (!isAdm) { return <div className="p-3 text-xs rounded" style={{ background: '#fef3c7', color: '#1c1917' }}>Order reconciliation is for Owners/Admins.</div>; }

  var sm = report && report.summary;
  return (
    <div>
      <div className="bg-white rounded-xl border border-slate-200 p-3 mb-3">
        <div className="text-sm font-extrabold text-slate-900">🔎 NextTrade Orders ↔ Invoices Reconciliation</div>
        <div className="text-[11px] text-slate-500 mt-0.5 mb-2">
          Step 1: on NextTradeIndustries.com/admin → Orders, clear Row Limits (blank = all), select the whole table, copy. Step 2: paste below, Preview, Import (re-pasting updates — never duplicates). Step 3: Run the reconciliation.
        </div>
        <textarea value={paste} onChange={function (e) { setPaste(e.target.value); setPreview(null); }} rows={6}
          placeholder="Paste the Orders table here (header row and footer are fine — they are ignored)…"
          className="w-full rounded-lg border border-slate-300 p-2 text-[11px] font-mono text-slate-900 mb-2" />
        <div className="flex gap-2 flex-wrap items-center">
          <button onClick={doPreview} disabled={busy || !paste.trim()} className="px-3 py-1.5 rounded-lg text-xs font-extrabold bg-slate-700 text-white disabled:opacity-50">👁 Preview</button>
          {preview && preview.rows.length > 0 && (
            <span className="text-[11px] font-bold text-slate-600">{preview.rows.length} orders recognized{preview.ignored ? ' · ' + preview.ignored + ' lines not understood' : ''} — releases {preview.rows[preview.rows.length - 1].release_number} → {preview.rows[0].release_number}</span>
          )}
          {preview && preview.rows.length > 0 && (
            <button onClick={doImport} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs font-extrabold bg-indigo-600 text-white disabled:opacity-50">{busy ? '⏳' : '📥 Import ' + preview.rows.length + ' orders'}</button>
          )}
        </div>
      </div>


      {/* v55.83-NP — FAST BACKFILL: every invoice still missing its release
          number, open field, type, save, gone from the list. Built for burning
          through the backlog right here. */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 mb-3">
        <div className="flex gap-2 items-end flex-wrap mb-2">
          <div className="text-sm font-extrabold text-slate-900 mr-2">✍️ Enter release numbers on old invoices</div>
          <input value={msearch} onChange={function (e) { setMsearch(e.target.value); }} placeholder="filter by invoice # / order # / customer"
            className="px-2 py-1 rounded border border-slate-300 text-xs" style={{ minWidth: 220 }} />
          <button disabled={busy} onClick={function () {
            setBusy(true);
            fetch('/api/reconcile/nexttrade', { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'list_missing', user_id: userProfile && userProfile.id, search: msearch || null }) })
              .then(function (r) { return r.json(); })
              .then(function (j) { if (!j || j.ok !== true) { toast.error((j && j.error) || 'Load failed'); return; } setMissing(j); setDraft({}); })
              .catch(function (e) { toast.error('Load failed: ' + ((e && e.message) || 'network')); })
              .finally(function () { setBusy(false); });
          }} className="px-3 py-1.5 rounded-lg text-xs font-extrabold bg-slate-700 text-white disabled:opacity-50">📋 Load invoices without release #</button>
          {missing && <span className="text-[11px] font-bold text-slate-600">{missing.total_missing} still missing{missing.total_missing > (missing.missing || []).length ? ' (showing newest ' + missing.missing.length + ' — use the filter)' : ''}</span>}
        </div>
        {missing && (missing.missing || []).length > 0 && (
          <div className="overflow-auto rounded border border-slate-200" style={{ maxHeight: 340 }}>
            <table className="w-full text-[11px]">
              <thead><tr>
                {['System', 'Invoice / Order', 'Customer', 'Date', 'Amount', 'Release # (type + Save)'].map(function (h) { return <th key={h} className="px-2 py-1 text-left font-bold sticky top-0" style={{ background: '#f1f5f9', color: '#0f172a' }}>{h}</th>; })}
              </tr></thead>
              <tbody>{missing.missing.map(function (r) {
                var k = r.system + ':' + r.id;
                return (
                  <tr key={k} className="border-t border-slate-100">
                    <td className="px-2 py-1"><span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold" style={r.system === 'accounting' ? { background: '#dbeafe', color: '#0c2a5e' } : { background: '#dcfce7', color: '#052e16' }}>{r.system}</span></td>
                    <td className="px-2 py-1 font-bold text-slate-900 whitespace-nowrap">{r.ref}</td>
                    <td className="px-2 py-1 text-slate-700 whitespace-nowrap">{r.customer}</td>
                    <td className="px-2 py-1 text-slate-600 whitespace-nowrap">{r.invoice_date || ''}</td>
                    <td className="px-2 py-1 text-slate-700 whitespace-nowrap">{r.total_amount != null ? Number(r.total_amount).toLocaleString() : ''}</td>
                    <td className="px-2 py-1 whitespace-nowrap">
                      <input value={draft[k] || ''} placeholder="1002-1193"
                        onChange={function (e) { var d = Object.assign({}, draft); d[k] = e.target.value; setDraft(d); }}
                        onKeyDown={function (e) { if (e.key === 'Enter') { e.target.nextSibling && e.target.nextSibling.click(); } }}
                        className="px-2 py-0.5 rounded border border-slate-300 text-[11px] font-mono" style={{ width: 110 }} />
                      <button disabled={busy || !(draft[k] || '').trim()} onClick={function () {
                        fetch('/api/reconcile/nexttrade', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'set_release', user_id: userProfile && userProfile.id, system: r.system, id: r.id, release_number: draft[k] }) })
                          .then(function (rr) { return rr.json(); })
                          .then(function (j) {
                            if (!j || j.ok !== true) { toast.error((j && j.error) || 'Save failed'); return; }
                            toast.success(r.ref + ' → ' + j.saved);
                            setMissing(function (prev) { return Object.assign({}, prev, { missing: prev.missing.filter(function (x) { return (x.system + ':' + x.id) !== k; }), total_missing: prev.total_missing - 1 }); });
                          })
                          .catch(function (e) { toast.error('Save failed: ' + ((e && e.message) || 'network')); });
                      }} className="ml-1 px-2 py-0.5 rounded text-[10px] font-extrabold bg-emerald-600 text-white disabled:opacity-40">💾 Save</button>
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
        {missing && (missing.missing || []).length === 0 && (
          <div className="text-[11px] font-bold p-2 rounded" style={{ background: '#dcfce7', color: '#052e16' }}>🎉 Every invoice has a release number.</div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-3">
        <div className="flex gap-2 items-end flex-wrap mb-2">
          <div className="text-sm font-extrabold text-slate-900 mr-2">Reconciliation report</div>
          {/* v55.83-NU — blank = ALL history (default). The one-tap buttons set
              periods without ever touching the browser's year picker, which
              mangles typed years (Max hit 0024 trying to reach 2024). */}
          <div className="flex gap-1 items-center flex-wrap">
            {[['All history', '', ''],
              ['Last 90d', (function () { var d = new Date(); d.setDate(d.getDate() - 90); return d.toISOString().substring(0, 10); })(), ''],
              ['2026', '2026-01-01', '2026-12-31'],
              ['2025', '2025-01-01', '2025-12-31'],
              ['2024', '2024-01-01', '2024-12-31']].map(function (pset) {
              var active = from === pset[1] && to === pset[2];
              return <button key={pset[0]} onClick={function () { setFrom(pset[1]); setTo(pset[2]); }}
                className="px-2 py-1 rounded-lg text-[10px] font-extrabold"
                style={active ? { background: '#0f172a', color: '#fff' } : { background: '#f1f5f9', color: '#334155' }}>{pset[0]}</button>;
            })}
          </div>
          <div><label className="text-[10px] font-bold text-slate-500 block">from (blank = all)</label>
            <input type="date" value={from} onChange={function (e) { setFrom(e.target.value); }} className="px-2 py-1 rounded border border-slate-300 text-xs" /></div>
          <div><label className="text-[10px] font-bold text-slate-500 block">to</label>
            <input type="date" value={to} onChange={function (e) { setTo(e.target.value); }} className="px-2 py-1 rounded border border-slate-300 text-xs" /></div>
          <button onClick={runReport} disabled={busy} className="px-4 py-1.5 rounded-lg text-xs font-extrabold bg-emerald-600 text-white disabled:opacity-50">{busy ? '⏳ Matching…' : '▶ Run reconciliation'}</button>
        </div>

        {sm && (
          <div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-2">
              <div className="rounded-lg p-2" style={{ background: '#f1f5f9', color: '#0f172a' }}><div className="text-[10px] font-bold">Orders in scope</div><div className="text-lg font-black">{sm.orders_in_scope}</div></div>
              <div className="rounded-lg p-2" style={{ background: '#dcfce7', color: '#052e16' }}><div className="text-[10px] font-bold">Matched to an invoice</div><div className="text-lg font-black">{sm.matched}</div></div>
              <div className="rounded-lg p-2" style={{ background: sm.orders_without_invoice ? '#fee2e2' : '#dcfce7', color: sm.orders_without_invoice ? '#450a0a' : '#052e16' }}><div className="text-[10px] font-bold">Orders WITHOUT invoice</div><div className="text-lg font-black">{sm.orders_without_invoice}</div></div>
              <div className="rounded-lg p-2" style={{ background: sm.invoices_without_order ? '#fef3c7' : '#dcfce7', color: sm.invoices_without_order ? '#451a03' : '#052e16' }}><div className="text-[10px] font-bold">Invoices without order</div><div className="text-lg font-black">{sm.invoices_without_order}</div></div>
              <div className="rounded-lg p-2" style={{ background: sm.invoices_with_open_balance ? '#fee2e2' : '#dcfce7', color: sm.invoices_with_open_balance ? '#450a0a' : '#052e16' }}><div className="text-[10px] font-bold">Open balances ({sm.overdue_open_balance || 0} overdue)</div><div className="text-lg font-black">{sm.invoices_with_open_balance}</div></div>
            </div>
            {Object.keys(sm.matched_by_field || {}).length > 0 && (
              <div className="text-[11px] font-semibold text-slate-600 mb-2">Matched via: {Object.keys(sm.matched_by_field).map(function (k) { return k + ' × ' + sm.matched_by_field[k]; }).join(' · ')}</div>
            )}

            <div className="flex items-center justify-between mt-2 mb-1">
              <div className="text-[11px] font-extrabold" style={{ color: '#7f1d1d' }}>🚨 Orders without any invoice — every one of these left a warehouse with no invoice found in the Hub</div>
              <button onClick={function () { csv(report.orders_without_invoice, 'orders-without-invoice'); }} className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800 text-white">⬇ CSV</button>
            </div>
            {tbl(report.orders_without_invoice, 'bad')}
            {report.orders_without_invoice && report.orders_without_invoice.length > 0 && (
              <div className="flex gap-2 items-center flex-wrap mt-1.5 p-2 rounded-lg" style={{ background: '#fef3c7' }}>
                <span className="text-[11px] font-extrabold" style={{ color: '#451a03' }}>🚩 Flag these to:</span>
                <select value={flagTo} onChange={function (e) { setFlagTo(e.target.value); }} className="px-2 py-1 rounded border border-amber-400 text-xs font-semibold bg-white text-slate-900">
                  <option value="">— pick a team member —</option>
                  {users.filter(function (u) { return !u.is_ai; }).map(function (u) { return <option key={u.id} value={u.id}>{u.name || u.email}</option>; })}
                </select>
                <button disabled={busy || !flagTo} onClick={function () {
                  setBusy(true);
                  fetch('/api/reconcile/nexttrade', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'flag', user_id: userProfile && userProfile.id, assignee_id: flagTo, date_from: from || null, date_to: to || null }) })
                    .then(function (r) { return r.json(); })
                    .then(function (j) {
                      if (!j || j.ok !== true) { toast.error('Flag failed: ' + ((j && j.error) || 'unknown')); return; }
                      setFlagged(j);
                      toast.success('Ticket ' + j.ticket_number + ' created — ' + j.flagged + ' orders flagged.');
                    })
                    .catch(function (e) { toast.error('Flag failed: ' + ((e && e.message) || 'network')); })
                    .finally(function () { setBusy(false); });
                }} className="px-3 py-1 rounded-lg text-xs font-extrabold bg-red-700 text-white disabled:opacity-50">🚩 Create High-priority ticket</button>
                {flagged && flagged.ticket_number && (
                  <span className="text-[11px] font-bold" style={{ color: '#052e16' }}>✅ {flagged.ticket_number} → assigned, due in 3 days</span>
                )}
              </div>
            )}

            <div className="flex items-center justify-between mt-3 mb-1">
              <div className="text-[11px] font-extrabold text-slate-700">💰 Invoices with open balances in this period — stay flagged until paid ({sm.overdue_open_balance || 0} overdue · biggest first)</div>
              <button onClick={function () { csv(report.invoices_with_open_balance, 'invoices-open-balance'); }} className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800 text-white">⬇ CSV</button>
            </div>
            {tbl(report.invoices_with_open_balance)}

            <div className="flex items-center justify-between mt-3 mb-1">
              <div className="text-[11px] font-extrabold text-slate-700">🧐 Hub invoices that look like releases but have no order</div>
              <button onClick={function () { csv(report.invoices_without_order, 'invoices-without-order'); }} className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800 text-white">⬇ CSV</button>
            </div>
            {tbl(report.invoices_without_order)}

            <div className="flex items-center justify-between mt-3 mb-1">
              <div className="text-[11px] font-extrabold text-slate-700">✅ Matched</div>
              <button onClick={function () { csv(report.matched, 'orders-matched'); }} className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800 text-white">⬇ CSV</button>
            </div>
            {tbl(report.matched)}

            <div className="text-[10px] text-slate-400 mt-2">Source: {report.source}</div>
          </div>
        )}
      </div>
      <SavedReconciliations userProfile={userProfile} toast={toast} canSave={true} from={from} to={to} />
    </div>
  );
}
