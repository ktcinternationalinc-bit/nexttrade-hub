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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
              <div className="rounded-lg p-2" style={{ background: '#f1f5f9', color: '#0f172a' }}><div className="text-[10px] font-bold">Orders in scope</div><div className="text-lg font-black">{sm.orders_in_scope}</div></div>
              <div className="rounded-lg p-2" style={{ background: '#dcfce7', color: '#052e16' }}><div className="text-[10px] font-bold">Matched to an invoice</div><div className="text-lg font-black">{sm.matched}</div></div>
              <div className="rounded-lg p-2" style={{ background: sm.orders_without_invoice ? '#fee2e2' : '#dcfce7', color: sm.orders_without_invoice ? '#450a0a' : '#052e16' }}><div className="text-[10px] font-bold">Orders WITHOUT invoice</div><div className="text-lg font-black">{sm.orders_without_invoice}</div></div>
              <div className="rounded-lg p-2" style={{ background: sm.invoices_without_order ? '#fef3c7' : '#dcfce7', color: sm.invoices_without_order ? '#451a03' : '#052e16' }}><div className="text-[10px] font-bold">Invoices without order</div><div className="text-lg font-black">{sm.invoices_without_order}</div></div>
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
    </div>
  );
}
