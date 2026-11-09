'use client';
// v55.83-RG — 🏦 Wires (Max, Nov 8 15:32): "we need a separate portal for wires
// sent... a quick audit that they were not paid previously and that they all
// belong to a release number - make sure there are no duplicated release
// numbers or reference numbers. and then a manual signoff by 2 people who have
// verified the wire. so an AI validation and then 2 further validations
// manually and then clicking on wire will bring about all the bills paid with
// all of their data."
import React, { useState, useEffect, useContext } from 'react';
import { ToastContext } from '../lib/toast-context';
import { WIRE_STATUS_LABEL } from '../lib/wire-audit';
import WirePackagesPanel from './WirePackagesPanel'; // v55.83-RH
import WireQuickView from './WireQuickView'; // v55.83-RM

function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
var STATUS_STYLE = {
  needs_check: { background: '#e0e7ff', color: '#312e81' }, flagged: { background: '#fee2e2', color: '#7f1d1d' },
  awaiting_1st: { background: '#fef3c7', color: '#78350f' }, awaiting_2nd: { background: '#ffedd5', color: '#7c2d12' },
  approved: { background: '#d1fae5', color: '#065f46' },
};

// v55.83-RH — the after-the-fact view of bank lines (wires already in the bank feed)
function BankWiresView(props) {
  var userProfile = props.userProfile;
  var isSuperAdmin = props.isSuperAdmin === true || (userProfile && userProfile.role === 'super_admin');
  var mp = props.modulePerms || {};
  var ctxToast = useContext(ToastContext);
  var toast = props.toast || ctxToast || { success: function (m) { try { window.alert(m); } catch (e) {} }, error: function (m) { try { window.alert(m); } catch (e) {} } };
  var canView = isSuperAdmin || mp['wires.view'] === true || mp['wires.prepare'] === true || mp['wires.signoff'] === true || mp['wires.send'] === true || (userProfile && (userProfile.role === 'owner' || userProfile.role === 'admin'));
  var canSign = isSuperAdmin || mp['wires.signoff'] === true || (userProfile && (userProfile.role === 'owner' || userProfile.role === 'admin'));
  var canManageBills = isSuperAdmin || mp['bills.manage'] === true || (userProfile && (userProfile.role === 'owner' || userProfile.role === 'admin'));

  var s1 = useState(null); var list = s1[0]; var setList = s1[1];
  var s2 = useState(false); var busy = s2[0]; var setBusy = s2[1];
  var s3 = useState('2026-01-01'); var from = s3[0]; var setFrom = s3[1];
  var s4 = useState(new Date().toISOString().substring(0, 10)); var to = s4[0]; var setTo = s4[1];
  var s5 = useState('all'); var fStatus = s5[0]; var setFStatus = s5[1];
  var s6 = useState(false); var onlyWire = s6[0]; var setOnlyWire = s6[1];
  var s7 = useState(null); var det = s7[0]; var setDet = s7[1];
  var s8 = useState(''); var note = s8[0]; var setNote = s8[1];
  var s9 = useState({}); var relDraft = s9[0]; var setRelDraft = s9[1];
  var s10 = useState(''); var err = s10[0]; var setErr = s10[1];
  var s11 = useState(null); var quick = s11[0]; var setQuick = s11[1]; // v55.83-RM — a line that IS an approved wire opens that wire

  function api(payload) {
    return fetch('/api/accounting/wires', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ user_id: userProfile && userProfile.id }, payload)) }).then(function (r) { return r.json(); });
  }
  function load() {
    setBusy(true); setErr('');
    api({ action: 'list', from: from, to: to }).then(function (j) {
      if (j && j.ok) { setList(j.wires || []); } else { setErr((j && j.error) || 'Could not load the wires.'); }
    }).catch(function () { setErr('Could not load the wires.'); }).finally(function () { setBusy(false); });
  }
  function open(id) {
    setBusy(true); setErr(''); setNote('');
    api({ action: 'detail', bank_transaction_id: id }).then(function (j) {
      if (j && j.ok) { setDet(j); } else { setErr((j && j.error) || 'Could not open the wire.'); }
    }).finally(function () { setBusy(false); });
  }
  function runCheck() {
    setBusy(true);
    api({ action: 'run_check', bank_transaction_id: det.wire.id }).then(function (j) {
      if (j && j.ok) { toast.success(j.pass ? 'Audit passed' + (j.warns ? ' with ' + j.warns + ' warning(s)' : '') + (j.ai_ok === true ? ' · AI: OK' : j.ai_ok === false ? ' · AI raised concerns' : ' · AI unavailable') + ' — ready for sign-off.' : 'Audit found ' + j.blocks + ' blocking problem(s) — fix them, then run it again.'); open(det.wire.id); load(); }
      else { toast.error((j && j.error) || 'The audit could not run.'); }
    }).finally(function () { setBusy(false); });
  }
  function signoff() {
    setBusy(true);
    api({ action: 'signoff', bank_transaction_id: det.wire.id, note: note }).then(function (j) {
      if (j && j.ok) { toast.success(j.approved ? 'Second sign-off recorded — this wire is VERIFIED by two people.' : 'First sign-off recorded — a different person must sign second.'); setNote(''); open(det.wire.id); load(); }
      else { toast.error((j && j.error) || 'Could not sign off.'); }
    }).finally(function () { setBusy(false); });
  }
  function saveRelease(billId) {
    var v = String(relDraft[billId] || '').trim();
    if (!v) { return; }
    setBusy(true);
    api({ action: 'set_release', bank_transaction_id: det.wire.id, bill_id: billId, release_number: v }).then(function (j) {
      if (j && j.ok) { toast.success('Release ' + v.toUpperCase() + ' saved on the bill — run the audit again.'); open(det.wire.id); }
      else { toast.error((j && j.error) || 'Could not save the release number.'); }
    }).finally(function () { setBusy(false); });
  }
  function csv() {
    if (!det) { return; }
    var L = ['vendor,bill_number,release_number,bill_date,due_date,category,bill_total,paid_by_this_wire,paid_before,validation,notes'];
    det.lines.forEach(function (l) {
      var b = l.bill || {}; var before = 0; (l.other_payments || []).forEach(function (o) { before += Number(o.amount) || 0; });
      L.push([b.vendor_name, b.bill_number, b.release_number, b.bill_date, b.due_date, b.category, b.total_amount, l.amount, before.toFixed(2), b.validation_status, b.notes].map(function (x) { return '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"'; }).join(','));
    });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + L.join('\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = 'wire-' + det.wire.date + '-' + fmt(det.wire.amount).replace(/,/g, '') + '.csv'; a.click();
  }
  useEffect(function () { if (canView) { load(); } }, []); // eslint-disable-line

  if (!canView) {
    return <div className="rounded-xl p-4 text-sm" style={{ background: '#ffffff', border: '1px solid #e2e8f0', color: '#334155' }}>
      The Wires portal needs <b>Wires: View</b> (with ClickBooks access) — ask an admin in Settings → 🏦 Banking & Accounting Access.</div>;
  }
  var rows = (list || []).filter(function (w) { return (fStatus === 'all' || w.status === fStatus) && (!onlyWire || w.looks_like_wire); });

  return <div className="flex flex-col gap-3">
    {quick && <WireQuickView wire={quick} userProfile={userProfile} onClose={function () { setQuick(null); }} />}
    <div className="nt-paper rounded-xl p-3">
      <div className="flex gap-2 items-center flex-wrap mb-2">
        <div className="text-sm font-extrabold text-slate-900 mr-1">🏦 Wires in the bank — every money-out line with bills linked</div>
        <div className="flex-1" />
        <input type="date" value={from} onChange={function (e) { setFrom(e.target.value); }} className="px-2 py-1 rounded-lg border border-slate-300 text-[10px] nt-light" style={{ color: '#0f172a', background: '#ffffff' }} />
        <span className="text-[10px]" style={{ color: '#64748b' }}>→</span>
        <input type="date" value={to} onChange={function (e) { setTo(e.target.value); }} className="px-2 py-1 rounded-lg border border-slate-300 text-[10px] nt-light" style={{ color: '#0f172a', background: '#ffffff' }} />
        <button onClick={load} disabled={busy} className="px-2.5 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#1e293b', color: '#ffffff', opacity: busy ? 0.5 : 1 }}>Load</button>
      </div>
      <div className="flex gap-1.5 items-center flex-wrap mb-2">
        {['all', 'needs_check', 'flagged', 'awaiting_1st', 'awaiting_2nd', 'approved'].map(function (k) {
          var on = fStatus === k; var n = (list || []).filter(function (w) { return k === 'all' || w.status === k; }).length;
          return <button key={k} onClick={function () { setFStatus(k); }} className="px-2 py-1 rounded-lg text-[10px] font-extrabold"
            style={on ? { background: '#1e293b', color: '#ffffff' } : { background: '#f1f5f9', color: '#334155' }}>{(k === 'all' ? 'All' : WIRE_STATUS_LABEL[k]) + ' (' + n + ')'}</button>;
        })}
        <label className="flex items-center gap-1 text-[10px] font-bold ml-2" style={{ color: '#334155' }}><input type="checkbox" checked={onlyWire} onChange={function (e) { setOnlyWire(e.target.checked); }} /> only lines the bank calls a WIRE</label>
      </div>
      {err && <div className="mb-2 rounded p-2 text-[11px] font-bold" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#7f1d1d' }}>{err}</div>}
      {!list ? <div className="text-[11px] text-slate-500">Loading…</div> :
        <div className="overflow-x-auto"><table className="w-full text-xs">
          <thead><tr style={{ borderBottom: '1px solid #cbd5e1', color: '#475569' }}>
            <th className="py-1.5 pr-2 text-left font-semibold">Date</th><th className="py-1.5 pr-2 text-left font-semibold">Bank line</th>
            <th className="py-1.5 pr-2 text-left font-semibold">Vendor(s)</th><th className="py-1.5 pr-2 text-right font-semibold">Wire</th>
            <th className="py-1.5 pr-2 text-right font-semibold">Bills</th><th className="py-1.5 pr-2 text-left font-semibold">Status</th>
            <th className="py-1.5 text-left font-semibold">Signed by</th></tr></thead>
          <tbody style={{ color: '#0f172a' }}>
            {rows.map(function (w) {
              return <tr key={w.id} onClick={function () { if (w.package) { setQuick({ kind: 'package', id: w.package.id, label: w.package.label }); } else { open(w.id); } }} title="Open — every bill this wire paid, with all its data" style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer', background: det && det.wire.id === w.id ? '#eef2ff' : undefined }}>
                <td className="py-1.5 pr-2 whitespace-nowrap">{w.date}</td>
                <td className="py-1.5 pr-2">{w.looks_like_wire ? '🏦 ' : ''}{w.name}</td>
                <td className="py-1.5 pr-2">{w.vendors.join(', ')}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums font-bold">−${fmt(w.amount)}</td>
                <td className="py-1.5 pr-2 text-right">{w.bills}{Math.abs(w.placed - w.amount) > 0.009 ? <span style={{ color: '#b45309' }}> (${fmt(w.placed)} linked)</span> : ''}</td>
                <td className="py-1.5 pr-2">{w.package
                  ? <span className="px-1.5 py-0.5 rounded text-[10px] font-extrabold" style={{ background: '#065f46', color: '#ffffff' }} title="Prepared, audited and signed by two people BEFORE it was sent">✅ approved before sending · {w.package.label}</span>
                  : <span><span className="px-1.5 py-0.5 rounded text-[10px] font-extrabold" style={STATUS_STYLE[w.status]}>{WIRE_STATUS_LABEL[w.status]}</span>
                    <div className="text-[9px] font-bold mt-0.5" style={{ color: '#b91c1c' }}>⚠ sent without an approved wire</div></span>}</td>
                <td className="py-1.5 text-[10px]" style={{ color: '#334155' }}>{[w.signoff1_name, w.signoff2_name].filter(Boolean).join(' · ') || '—'}</td>
              </tr>;
            })}
            {rows.length === 0 && <tr><td colSpan={7} className="py-3 text-center text-[11px]" style={{ color: '#64748b' }}>No wires here. A wire appears once bills are linked to an outgoing bank payment (Bills → pay from the bank feed, or 🔗 match in All Transactions).</td></tr>}
          </tbody></table></div>}
    </div>

    {det && <div className="nt-paper rounded-xl p-3" style={{ border: '2px solid #6366f1' }}>
      <div className="flex gap-2 items-center flex-wrap mb-2">
        <div className="text-sm font-extrabold" style={{ color: '#0f172a' }}>🏦 −${fmt(det.wire.amount)} · {det.wire.date} · {det.wire.name}{det.account ? ' · ' + det.account : ''}</div>
        <span className="px-2 py-0.5 rounded text-[10px] font-extrabold" style={STATUS_STYLE[det.status]}>{WIRE_STATUS_LABEL[det.status]}</span>
        <div className="flex-1" />
        <button onClick={csv} className="px-2 py-1 rounded text-[10px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>⬇ CSV of the bills</button>
        <button onClick={function () { setDet(null); }} className="px-2 py-1 rounded text-[10px] font-bold" style={{ background: '#e2e8f0', color: '#334155' }}>✕ close</button>
      </div>
      {det.sql_missing && <div className="mb-2 rounded p-2 text-[11px] font-bold" style={{ background: '#fef3c7', border: '1px solid #fcd34d', color: '#78350f' }}>Run sql/v55-83-RG-wires-recon.sql in Supabase to save audits and sign-offs.</div>}

      {/* step 1 — automatic audit */}
      <div className="rounded-lg p-2 mb-2" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
        <div className="flex gap-2 items-center mb-1 flex-wrap">
          <div className="text-[11px] font-extrabold" style={{ color: '#0f172a' }}>① 🤖 Audit — not paid before · every bill has a release · no duplicated release or reference numbers</div>
          <div className="flex-1" />
          <span className="text-[10px]" style={{ color: '#64748b' }}>{det.audit && det.audit.checked_at ? 'last run ' + String(det.audit.checked_at).substring(0, 16).replace('T', ' ') + (det.audit.checked_by ? ' by ' + det.audit.checked_by : '') + (det.audit.stale ? ' — the bills CHANGED since' : '') : 'not run yet'}</span>
          <button onClick={runCheck} disabled={busy} className="px-2.5 py-1 rounded-lg text-[10px] font-extrabold" style={{ background: '#4338ca', color: '#ffffff', opacity: busy ? 0.5 : 1 }}>🤖 {det.audit && det.audit.checked_at ? 'Run the audit again' : 'Run the audit'}</button>
        </div>
        {(det.checks.checks || []).map(function (c, i) {
          var st = c.level === 'block' ? { bg: '#fee2e2', fg: '#7f1d1d', ic: '⛔' } : c.level === 'warn' ? { bg: '#fef3c7', fg: '#78350f', ic: '⚠' } : { bg: '#d1fae5', fg: '#065f46', ic: '✅' };
          return <div key={i} className="text-[11px] font-bold rounded px-2 py-1 mb-0.5" style={{ background: st.bg, color: st.fg }}>{st.ic} {c.text}</div>;
        })}
        {det.audit && det.audit.ai_summary && <div className="mt-1 rounded p-2 text-[11px]" style={{ background: det.audit.ai_ok === true ? '#ecfdf5' : det.audit.ai_ok === false ? '#fff7ed' : '#f1f5f9', border: '1px solid #e2e8f0', color: '#0f172a', whiteSpace: 'pre-wrap' }}>
          <b>AI review{det.audit.stale ? ' (of the earlier version)' : ''}:</b>{'\n'}{det.audit.ai_summary}</div>}
      </div>

      {/* steps 2 + 3 — two people */}
      <div className="rounded-lg p-2 mb-2" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
        <div className="text-[11px] font-extrabold mb-1" style={{ color: '#0f172a' }}>②③ ✍ Sign-off by TWO different people who verified this wire</div>
        <div className="flex gap-2 flex-wrap mb-1">
          {[['1st', det.audit && det.audit.signoff1], ['2nd', det.audit && det.audit.signoff2]].map(function (p) {
            var s = p[1];
            return <div key={p[0]} className="rounded p-2 text-[11px]" style={{ flex: '1 1 220px', background: s && s.valid ? '#ecfdf5' : '#ffffff', border: '1px solid ' + (s && s.valid ? '#a7f3d0' : '#e2e8f0'), color: '#0f172a' }}>
              <b>{p[0]} verifier:</b> {s ? (s.name + ' · ' + String(s.at || '').substring(0, 16).replace('T', ' ') + (s.valid ? '' : ' — NO LONGER COUNTS (the bills changed after signing)')) : '—'}
              {s && s.note ? <div style={{ color: '#334155' }}>“{s.note}”</div> : null}
            </div>;
          })}
        </div>
        {canSign && det.status !== 'approved' && <div className="flex gap-2 items-center flex-wrap">
          <input value={note} onChange={function (e) { setNote(e.target.value); }} placeholder={det.audit && det.audit.ai_ok === true ? 'what you verified (optional)' : 'what you verified — required (AI raised concerns or did not run)'}
            className="px-2 py-1 rounded-lg border border-slate-300 text-[11px] nt-light" style={{ color: '#0f172a', background: '#ffffff', flex: '1 1 260px' }} />
          <button onClick={signoff} disabled={busy || (det.status !== 'awaiting_1st' && det.status !== 'awaiting_2nd')} className="px-3 py-1 rounded-lg text-[11px] font-extrabold"
            style={{ background: '#047857', color: '#ffffff', opacity: (busy || (det.status !== 'awaiting_1st' && det.status !== 'awaiting_2nd')) ? 0.5 : 1 }}>
            ✍ Sign off as {det.status === 'awaiting_2nd' ? '2nd' : '1st'} verifier</button>
          {(det.status === 'needs_check' || det.status === 'flagged') && <span className="text-[10px] font-bold" style={{ color: '#7f1d1d' }}>{det.status === 'flagged' ? 'Fix the ⛔ items, then run the audit again.' : 'Run the audit first.'}</span>}
        </div>}
        {!canSign && <div className="text-[10px]" style={{ color: '#64748b' }}>Signing needs the “Wires: Sign Off” permission.</div>}
      </div>

      {/* the bills — all their data */}
      <div className="text-[11px] font-extrabold mb-1" style={{ color: '#0f172a' }}>Bills paid by this wire ({det.lines.length})</div>
      <div className="overflow-x-auto"><table className="w-full text-[11px]">
        <thead><tr style={{ borderBottom: '1px solid #cbd5e1', color: '#475569' }}>
          <th className="py-1 pr-2 text-left font-semibold">Vendor</th><th className="py-1 pr-2 text-left font-semibold">Bill / ref #</th>
          <th className="py-1 pr-2 text-left font-semibold">Release #</th><th className="py-1 pr-2 text-left font-semibold">Bill date</th>
          <th className="py-1 pr-2 text-left font-semibold">Due</th><th className="py-1 pr-2 text-left font-semibold">Category</th>
          <th className="py-1 pr-2 text-right font-semibold">Bill total</th><th className="py-1 pr-2 text-right font-semibold">This wire</th>
          <th className="py-1 pr-2 text-left font-semibold">Paid before</th><th className="py-1 pr-2 text-left font-semibold">Validated</th>
          <th className="py-1 text-left font-semibold">Notes</th></tr></thead>
        <tbody style={{ color: '#0f172a' }}>
          {det.lines.map(function (l) {
            var b = l.bill || {};
            return <tr key={l.payment_id} style={{ borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' }}>
              <td className="py-1 pr-2 font-bold">{b.vendor_name || '?'}{b.paid_via ? <div className="text-[9px]" style={{ color: '#9d174d' }}>via {b.paid_via}</div> : null}</td>
              <td className="py-1 pr-2">{b.bill_number || '—'}</td>
              <td className="py-1 pr-2">{b.release_number ? <b>{b.release_number}</b> : (canManageBills ? <span className="flex gap-1">
                <input value={relDraft[l.bill_id] || ''} onChange={function (e) { var d2 = Object.assign({}, relDraft); d2[l.bill_id] = e.target.value; setRelDraft(d2); }} placeholder="add release #"
                  className="px-1 py-0.5 rounded border border-rose-300 text-[10px] nt-light" style={{ width: 90, color: '#0f172a', background: '#ffffff' }} />
                <button onClick={function () { saveRelease(l.bill_id); }} disabled={busy} className="px-1.5 rounded text-[10px] font-extrabold" style={{ background: '#1d4ed8', color: '#ffffff' }}>save</button></span>
                : <span style={{ color: '#b91c1c', fontWeight: 800 }}>missing</span>)}</td>
              <td className="py-1 pr-2 whitespace-nowrap">{b.bill_date || '—'}</td>
              <td className="py-1 pr-2 whitespace-nowrap">{b.due_date || '—'}</td>
              <td className="py-1 pr-2">{b.category ? String(b.category).replace(/_/g, ' ') : '—'}</td>
              <td className="py-1 pr-2 text-right tabular-nums">${fmt(b.total_amount)}</td>
              <td className="py-1 pr-2 text-right tabular-nums font-bold">${fmt(l.amount)}</td>
              <td className="py-1 pr-2" style={{ color: (l.other_payments || []).length ? '#b45309' : '#64748b' }}>{(l.other_payments || []).length ? l.other_payments.map(function (o) { return '$' + fmt(o.amount) + ' ' + (o.paid_date || '') + ' (' + o.label + ')'; }).join('; ') : 'none'}</td>
              <td className="py-1 pr-2">{b.validation_status === 'validated' ? '✓' : (b.validation_status || '—')}{b.disputed ? ' · DISPUTED' : ''}</td>
              <td className="py-1" style={{ maxWidth: 260, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{b.notes || ''}{b.attachment_path ? ' 📎' : ''}</td>
            </tr>;
          })}
        </tbody></table></div>
    </div>}
  </div>;
}

// v55.83-RH (Max, Nov 8 16:04): "the wire should be set up before a wire is
// actually sent ...then later when the wire is sent than we attach that whole
// audit to that wire". Default view = prepared wires (approved BEFORE sending);
// the bank view stays for lines that came in without one.
export default function WiresTab(props) {
  var userProfile = props.userProfile;
  var isSuperAdmin = props.isSuperAdmin === true || (userProfile && userProfile.role === 'super_admin');
  var mp = props.modulePerms || {};
  var ctxToast = useContext(ToastContext);
  var toast = props.toast || ctxToast || { success: function (m) { try { window.alert(m); } catch (e) {} }, error: function (m) { try { window.alert(m); } catch (e) {} } };
  var boss = isSuperAdmin || (userProfile && (userProfile.role === 'owner' || userProfile.role === 'admin'));
  var perms = { view: boss || mp['wires.view'] === true, prepare: boss || mp['wires.prepare'] === true, signoff: boss || mp['wires.signoff'] === true, send: boss || mp['wires.send'] === true,
    override: boss || mp['wires.override'] === true, // v55.83-RL
    undo: isSuperAdmin || (userProfile && userProfile.role === 'owner') }; // v55.83-RL — undoing a SENT wire: super admin / owner only
  var m0 = useState('prepared'); var mode = m0[0]; var setMode = m0[1];
  if (!(perms.view || perms.prepare || perms.signoff || perms.send)) {
    return <div className="rounded-xl p-4 text-sm" style={{ background: '#ffffff', border: '1px solid #e2e8f0', color: '#334155' }}>
      The Wires portal needs <b>Wires: View</b> (or Prepare / Sign Off / Send), with ClickBooks access — ask an admin in Settings → 🏦 Banking & Accounting Access.</div>;
  }
  return <div className="flex flex-col gap-2">
    <div className="flex gap-1.5">
      {[['prepared', '📤 Wires'], ['bank', '🏦 Already in the bank — check after the fact']].map(function (m) {
        return <button key={m[0]} onClick={function () { setMode(m[0]); }} className="px-3 py-1.5 rounded-lg text-[11px] font-extrabold"
          style={mode === m[0] ? { background: '#1e293b', color: '#ffffff' } : { background: '#ffffff', color: '#334155', border: '1px solid #cbd5e1' }}>{m[1]}</button>;
      })}
    </div>
    {mode === 'prepared' ? <WirePackagesPanel userProfile={userProfile} toast={toast} perms={perms} /> : <BankWiresView {...props} />}
  </div>;
}
