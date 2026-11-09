'use client';
// v55.83-RH — 📤 Prepared wires: APPROVED BEFORE THE MONEY LEAVES (Max, Nov 8):
//  16:04 "the wire should be set up before a wire is actually sent ...then
//        later when the wire is sent than we attach that whole audit to that
//        wire with the attached bills etc"
//  16:12 "wirepreparation is a permissioning. not all of wire will be to one
//        vendor-- BECASUE most of the wires would be going out of RTM"
//  16:14 "rtm fee is optional ... i like the rtm proof...attach a wire proof
//        that attaches to wires as part of the approgal. nextrade -- can be
//        only with bills"
import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { PKG_STATUS_LABEL } from '../lib/wire-audit';

function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function d16(x) { return String(x || '').substring(0, 16).replace('T', ' '); }
var PST = {
  needs_check: { background: '#e0e7ff', color: '#312e81' }, flagged: { background: '#fee2e2', color: '#7f1d1d' },
  awaiting_1st: { background: '#fef3c7', color: '#78350f' }, awaiting_2nd: { background: '#ffedd5', color: '#7c2d12' },
  ready_to_send: { background: '#d1fae5', color: '#065f46' }, sent: { background: '#dbeafe', color: '#1e3a8a' },
  awaiting_proof: { background: '#fae8ff', color: '#701a75' }, complete: { background: '#065f46', color: '#ffffff' }, cancelled: { background: '#e2e8f0', color: '#475569' },
};
var inp = 'px-2 py-1 rounded-lg border border-slate-300 text-[11px] nt-light';
var inpS = { color: '#0f172a', background: '#ffffff' };

export default function WirePackagesPanel(props) {
  var userProfile = props.userProfile; var toast = props.toast; var perms = props.perms || {};
  var a1 = useState(null); var list = a1[0]; var setList = a1[1];
  var a2 = useState(false); var busy = a2[0]; var setBusy = a2[1];
  var a3 = useState('open'); var fSt = a3[0]; var setFSt = a3[1];
  var a4 = useState(null); var det = a4[0]; var setDet = a4[1];
  var a5 = useState(null); var ed = a5[0]; var setEd = a5[1];          // the prepare / edit form
  var a6 = useState(null); var payees = a6[0]; var setPayees = a6[1];
  var a7 = useState(''); var note = a7[0]; var setNote = a7[1];
  var a8 = useState({ date: new Date().toISOString().substring(0, 10), ref: '', file: null }); var sendF = a8[0]; var setSendF = a8[1];
  var a9 = useState(null); var cands = a9[0]; var setCands = a9[1];
  var a10 = useState(''); var ovr = a10[0]; var setOvr = a10[1];
  var a11 = useState({ ticks: {}, date: '', ref: '', file: null }); var proofF = a11[0]; var setProofF = a11[1];

  function api(payload) {
    return fetch('/api/accounting/wire-packages', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ user_id: userProfile && userProfile.id }, payload)) }).then(function (r) { return r.json(); });
  }
  function load() { api({ action: 'list' }).then(function (j) { if (j && j.ok) { setList(j.packages || []); } else { setList([]); if (j && j.error) { toast.error(j.error); } } }).catch(function () { setList([]); }); }
  function open(id) {
    setBusy(true); setNote(''); setCands(null); setOvr('');
    api({ action: 'get', id: id }).then(function (j) {
      if (j && j.ok) { setDet(j); setEd(null); setProofF({ ticks: {}, date: '', ref: '', file: null }); if (j.package.raw_status === 'sent') { loadCands(id); } }
      else { toast.error((j && j.error) || 'Could not open the wire.'); }
    }).finally(function () { setBusy(false); });
  }
  function act(payload, okMsg, after) {
    setBusy(true);
    return api(payload).then(function (j) {
      if (j && j.ok) { if (okMsg) { toast.success(typeof okMsg === 'function' ? okMsg(j) : okMsg); } load(); if (after) { after(j); } else if (payload.id) { open(payload.id); } }
      else { toast.error((j && j.error) || 'That did not work.'); }
      return j;
    }).finally(function () { setBusy(false); });
  }
  function upload(file, pkgId) {
    var safe = String(file.name || 'proof').replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 60);
    var path = 'pv/wire-' + pkgId + '-' + Date.now() + '-' + safe;
    return supabase.storage.from('bills-private').upload(path, file, { upsert: false }).then(function (r) {
      if (r && r.error) { throw new Error('Upload failed: ' + r.error.message); }
      return { path: path, name: file.name };
    });
  }
  function openFile(path) {
    supabase.storage.from('bills-private').createSignedUrl(path, 3600).then(function (r) {
      var u = r && r.data && r.data.signedUrl; if (u) { window.open(u, '_blank'); } else { toast.error('Could not open the file.'); }
    });
  }
  // ── prepare / edit
  function startPrepare(existing) {
    var go = function (pl) {
      if (existing) {
        var p = existing.package; var picks = {};
        existing.lines.forEach(function (l) { picks[l.bill_id] = String(l.amount); });
        setEd({ id: p.id, kind: p.payee_kind, payee: p.payee_name, fee: p.fee_amount ? String(p.fee_amount) : '', fee_note: p.fee_note || '', memo: p.memo || '', picks: picks, bills: null });
        loadBills(p.payee_kind, p.payee_name, p.id, picks);
      } else {
        var first = (pl.parties || [])[0];
        setEd({ id: null, kind: first ? first.kind : 'vendor', payee: first ? first.name : '', fee: '', fee_note: '', memo: '', picks: {}, bills: null });
        if (first) { loadBills(first.kind, first.name, null, {}); }
      }
    };
    if (payees) { go(payees); }
    else { api({ action: 'payees' }).then(function (j) { if (j && j.ok) { setPayees(j); go(j); } else { toast.error((j && j.error) || 'Could not load who wires can go to.'); } }); }
  }
  function loadBills(kind, payee, pkgId, picks) {
    if (!payee) { return; }
    api({ action: 'open_bills', payee_kind: kind, payee_name: payee, package_id: pkgId }).then(function (j) {
      setEd(function (e) { return e ? Object.assign({}, e, { bills: (j && j.ok) ? j.bills : [], picks: picks || e.picks }) : e; });
      if (!(j && j.ok)) { toast.error((j && j.error) || 'Could not load the bills.'); }
    });
  }
  function choosePayee(val) {
    // val = 'party:<name>' or 'vendor:<name>'
    var i = val.indexOf(':'); var t = val.substring(0, i); var nm = val.substring(i + 1);
    var kind = 'vendor';
    if (t === 'party') { (payees.parties || []).forEach(function (p) { if (p.name === nm) { kind = p.kind === 'affiliate' ? 'affiliate' : 'service_provider'; } }); }
    setEd(Object.assign({}, ed, { kind: kind, payee: nm, picks: {}, bills: null, fee: kind === 'service_provider' ? ed.fee : '' }));
    loadBills(kind, nm, ed.id, {});
  }
  function saveDraft() {
    var lines = []; Object.keys(ed.picks).forEach(function (k) { var a = Number(ed.picks[k]); if (a > 0) { lines.push({ bill_id: k, amount: Math.round(a * 100) / 100 }); } });
    act({ action: 'save_draft', id: ed.id, payee_kind: ed.kind, payee_name: ed.payee, fee_amount: ed.kind === 'service_provider' ? (Number(ed.fee) || 0) : 0, fee_note: ed.fee_note, memo: ed.memo, lines: lines },
      function (j) { return 'Wire saved ($' + fmt(j.total) + ') — next: 🤖 run the audit.'; }, function (j) { setEd(null); open(j.id); });
  }
  function sendIt() {
    if (!sendF.file) { toast.error("Attach the bank's wire confirmation first."); return; }
    setBusy(true);
    upload(sendF.file, det.package.id).then(function (u) {
      return act({ action: 'mark_sent', id: det.package.id, sent_date: sendF.date, bank_reference: sendF.ref, proof_path: u.path, proof_name: u.name }, '📤 Marked SENT with the bank confirmation — it attaches to the bank line when that posts.');
    }).catch(function (e) { toast.error((e && e.message) || 'Upload failed.'); setBusy(false); });
  }
  function loadCands(id) { api({ action: 'bank_candidates', id: id }).then(function (j) { setCands(j && j.ok ? j : { candidates: [], error: j && j.error }); }); }
  function addProof() {
    var ids = Object.keys(proofF.ticks).filter(function (k) { return proofF.ticks[k]; });
    if (!ids.length) { toast.error('Tick the bills this proof covers.'); return; }
    if (!proofF.file) { toast.error("Attach RTM's proof."); return; }
    setBusy(true);
    upload(proofF.file, det.package.id).then(function (u) {
      return act({ action: 'rtm_proof', id: det.package.id, line_ids: ids, paid_date: proofF.date, reference: proofF.ref, proof_path: u.path, proof_name: u.name }, function (j) { return '📎 Proof saved for ' + j.confirmed + ' bill(s).'; });
    }).catch(function (e) { toast.error((e && e.message) || 'Upload failed.'); setBusy(false); });
  }
  useEffect(function () { load(); }, []); // eslint-disable-line

  var OPEN_ST = { needs_check: 1, flagged: 1, awaiting_1st: 1, awaiting_2nd: 1, ready_to_send: 1, sent: 1, awaiting_proof: 1 };
  var rows = (list || []).filter(function (p) { return fSt === 'all' || (fSt === 'open' ? OPEN_ST[p.status] : p.status === fSt); });
  var P = det && det.package; var st = P && P.status;
  var edTotal = 0; if (ed) { Object.keys(ed.picks).forEach(function (k) { edTotal += Number(ed.picks[k]) || 0; }); if (ed.kind === 'service_provider') { edTotal += Number(ed.fee) || 0; } }

  return <div className="flex flex-col gap-3">
    <div className="bg-white rounded-xl border border-slate-200 p-3">
      <div className="flex gap-2 items-center flex-wrap mb-2">
        <div className="text-sm font-extrabold text-slate-900">📤 Prepared wires — approved BEFORE the money leaves</div>
        <div className="flex-1" />
        {perms.prepare && <button onClick={function () { setDet(null); startPrepare(null); }} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs font-extrabold" style={{ background: '#0f766e', color: '#ffffff' }}>＋ Prepare a wire</button>}
      </div>
      <div className="text-[10px] mb-2" style={{ color: '#475569' }}>① prepare (bills + optional RTM fee) → 🤖 audit + AI → ② ③ two different people sign → 📤 send at the bank, attach its confirmation → 🔗 attach the bank line (bills paid then) → 📎 RTM's proof it paid the vendors.</div>
      <div className="flex gap-1.5 flex-wrap mb-2">
        {['open', 'all', 'ready_to_send', 'sent', 'awaiting_proof', 'complete', 'cancelled'].map(function (k) {
          var n = (list || []).filter(function (p) { return k === 'all' || (k === 'open' ? OPEN_ST[p.status] : p.status === k); }).length;
          return <button key={k} onClick={function () { setFSt(k); }} className="px-2 py-1 rounded-lg text-[10px] font-extrabold"
            style={fSt === k ? { background: '#1e293b', color: '#ffffff' } : { background: '#f1f5f9', color: '#334155' }}>{(k === 'open' ? 'In progress' : k === 'all' ? 'All' : PKG_STATUS_LABEL[k]) + ' (' + n + ')'}</button>;
        })}
      </div>
      {!list ? <div className="text-[11px] text-slate-500">Loading…</div> : <div className="overflow-x-auto"><table className="w-full text-xs">
        <thead><tr style={{ borderBottom: '1px solid #cbd5e1', color: '#475569' }}>
          <th className="py-1.5 pr-2 text-left font-semibold">Wire</th><th className="py-1.5 pr-2 text-left font-semibold">Pay to</th>
          <th className="py-1.5 pr-2 text-left font-semibold">Vendors on it</th><th className="py-1.5 pr-2 text-right font-semibold">Total</th>
          <th className="py-1.5 pr-2 text-left font-semibold">Status</th><th className="py-1.5 text-left font-semibold">Signed · sent</th></tr></thead>
        <tbody style={{ color: '#0f172a' }}>
          {rows.map(function (p) {
            return <tr key={p.id} onClick={function () { open(p.id); }} style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer', background: P && P.id === p.id ? '#eef2ff' : undefined }}>
              <td className="py-1.5 pr-2 font-mono font-bold whitespace-nowrap">{p.label}<div className="text-[9px] font-sans font-normal" style={{ color: '#64748b' }}>{d16(p.created_at)}{p.created_by ? ' · ' + p.created_by : ''}</div></td>
              <td className="py-1.5 pr-2 font-bold">{p.payee_name}{p.payee_kind === 'vendor' ? <span className="text-[9px] font-normal" style={{ color: '#64748b' }}> (vendor)</span> : null}</td>
              <td className="py-1.5 pr-2">{p.vendors.join(', ')} <span style={{ color: '#64748b' }}>· {p.bills} bill(s)</span></td>
              <td className="py-1.5 pr-2 text-right tabular-nums font-bold">${fmt(p.total)}{p.fee > 0 ? <div className="text-[9px] font-normal" style={{ color: '#64748b' }}>incl. fee ${fmt(p.fee)}</div> : null}</td>
              <td className="py-1.5 pr-2"><span className="px-1.5 py-0.5 rounded text-[10px] font-extrabold whitespace-nowrap" style={PST[p.status]}>{PKG_STATUS_LABEL[p.status]}</span>{p.rtm_pending && (p.status === 'awaiting_proof') ? <span className="text-[9px]" style={{ color: '#701a75' }}> {p.rtm_pending} bill(s)</span> : null}</td>
              <td className="py-1.5 text-[10px]" style={{ color: '#334155' }}>{p.signers.join(' · ') || '—'}{p.sent_date ? ' · sent ' + p.sent_date + (p.bank_reference ? ' (' + p.bank_reference + ')' : '') : ''}</td>
            </tr>;
          })}
          {rows.length === 0 && <tr><td colSpan={6} className="py-3 text-center text-[11px]" style={{ color: '#64748b' }}>No wires here.{perms.prepare ? ' ＋ Prepare a wire to start.' : ''}</td></tr>}
        </tbody></table></div>}
    </div>

    {/* ── prepare / edit */}
    {ed && payees && <div className="bg-white rounded-xl border-2 p-3" style={{ borderColor: '#0f766e' }}>
      <div className="flex gap-2 items-center flex-wrap mb-2">
        <div className="text-sm font-extrabold" style={{ color: '#0f172a' }}>{ed.id ? '✏ Edit the wire (sign-offs will need to be redone)' : '＋ Prepare a wire'}</div>
        <div className="flex-1" />
        <button onClick={function () { setEd(null); }} className="px-2 py-1 rounded text-[10px] font-bold" style={{ background: '#e2e8f0', color: '#334155' }}>✕ close</button>
      </div>
      <div className="flex gap-2 items-center flex-wrap mb-2">
        <span className="text-[11px] font-bold" style={{ color: '#334155' }}>Pay to:</span>
        <select value={(ed.kind === 'vendor' ? 'vendor:' : 'party:') + ed.payee} onChange={function (e) { choosePayee(e.target.value); }} className={inp} style={inpS}>
          <optgroup label="Paid through a company">{(payees.parties || []).map(function (p) { return <option key={p.name} value={'party:' + p.name}>{p.name}{p.kind === 'affiliate' ? ' (bills only)' : ''}</option>; })}</optgroup>
          <optgroup label="Straight to the vendor">{(payees.vendors || []).map(function (v) { return <option key={v} value={'vendor:' + v}>{v}</option>; })}</optgroup>
        </select>
        {ed.kind === 'service_provider' && <span className="flex gap-1 items-center"><span className="text-[11px] font-bold" style={{ color: '#334155' }}>{ed.payee} fee (optional) $</span>
          <input value={ed.fee} onChange={function (e) { setEd(Object.assign({}, ed, { fee: e.target.value })); }} placeholder="0.00" className={inp} style={Object.assign({ width: 90 }, inpS)} />
          <input value={ed.fee_note} onChange={function (e) { setEd(Object.assign({}, ed, { fee_note: e.target.value })); }} placeholder="what the fee is for" className={inp} style={Object.assign({ width: 180 }, inpS)} /></span>}
      </div>
      {!ed.bills ? <div className="text-[11px] text-slate-500">Loading the open bills…</div> : <div className="overflow-auto rounded border border-slate-200 mb-2" style={{ maxHeight: 340 }}><table className="w-full text-[11px]">
        <thead><tr style={{ background: '#f1f5f9', color: '#334155' }}>
          <th className="px-1.5 py-1"></th><th className="px-1.5 py-1 text-left">Vendor</th><th className="px-1.5 py-1 text-left">Bill #</th><th className="px-1.5 py-1 text-left">Release #</th>
          <th className="px-1.5 py-1 text-left">Due</th><th className="px-1.5 py-1 text-right">Open</th><th className="px-1.5 py-1 text-right">Pay now</th></tr></thead>
        <tbody style={{ color: '#0f172a' }}>
          {ed.bills.map(function (b) {
            var on = ed.picks[b.id] != null; var blocked = !!b.on_package;
            return <tr key={b.id} className="border-t border-slate-100" style={{ background: on ? '#f0fdfa' : undefined, opacity: blocked ? 0.55 : 1 }}>
              <td className="px-1.5 py-0.5"><input type="checkbox" disabled={blocked} checked={on} onChange={function (e) { var pk = Object.assign({}, ed.picks); if (e.target.checked) { pk[b.id] = String(b.open); } else { delete pk[b.id]; } setEd(Object.assign({}, ed, { picks: pk })); }} /></td>
              <td className="px-1.5 py-0.5 font-bold">{b.vendor_name}{b.disputed ? <span style={{ color: '#b91c1c' }}> · DISPUTED</span> : null}{blocked ? <span style={{ color: '#7c2d12' }}> · on {b.on_package}</span> : null}</td>
              <td className="px-1.5 py-0.5">{b.bill_number || '—'}</td>
              <td className="px-1.5 py-0.5">{b.release_number || <span style={{ color: '#b91c1c', fontWeight: 800 }}>missing</span>}</td>
              <td className="px-1.5 py-0.5 whitespace-nowrap">{b.due_date || b.bill_date || ''}</td>
              <td className="px-1.5 py-0.5 text-right tabular-nums">${fmt(b.open)}</td>
              <td className="px-1.5 py-0.5 text-right">{on ? <input value={ed.picks[b.id]} onChange={function (e) { var pk = Object.assign({}, ed.picks); pk[b.id] = e.target.value; setEd(Object.assign({}, ed, { picks: pk })); }}
                className="px-1 py-0.5 rounded border border-slate-300 text-[11px] text-right nt-light" style={Object.assign({ width: 90 }, inpS)} /> : ''}</td>
            </tr>;
          })}
          {ed.bills.length === 0 && <tr><td colSpan={7} className="px-2 py-2 text-[11px]" style={{ color: '#64748b' }}>{ed.kind === 'vendor' ? 'No open bills for this vendor (bills paid through RTM / NextTrade go on THEIR wire).' : 'No open bills marked "paid through ' + ed.payee + '". Mark them on the bill in 💸 Bills.'}</td></tr>}
        </tbody></table></div>}
      <div className="flex gap-2 items-center flex-wrap">
        <input value={ed.memo} onChange={function (e) { setEd(Object.assign({}, ed, { memo: e.target.value })); }} placeholder="memo (optional)" className={inp} style={Object.assign({ flex: '1 1 220px' }, inpS)} />
        <span className="text-[12px] font-extrabold" style={{ color: '#0f172a' }}>Wire total ${fmt(edTotal)}</span>
        <button onClick={saveDraft} disabled={busy || !Object.keys(ed.picks).length} className="px-3 py-1.5 rounded-lg text-xs font-extrabold disabled:opacity-50" style={{ background: '#0f766e', color: '#ffffff' }}>💾 Save the wire</button>
      </div>
    </div>}

    {/* ── one wire */}
    {P && !ed && <div className="bg-white rounded-xl border-2 p-3" style={{ borderColor: '#6366f1' }}>
      <div className="flex gap-2 items-center flex-wrap mb-1">
        <div className="text-sm font-extrabold" style={{ color: '#0f172a' }}><span className="font-mono">{P.label}</span> · pay {P.payee_name} · ${fmt(P.approved_total != null ? P.approved_total : P.total)}</div>
        <span className="px-2 py-0.5 rounded text-[10px] font-extrabold" style={PST[st]}>{PKG_STATUS_LABEL[st]}</span>
        <div className="flex-1" />
        {perms.prepare && P.raw_status === 'draft' && <button onClick={function () { startPrepare(det); }} className="px-2 py-1 rounded text-[10px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>✏ edit</button>}
        {perms.prepare && P.raw_status === 'draft' && <button onClick={function () { var why = window.prompt('Why is this wire cancelled?'); if (why) { act({ action: 'cancel', id: P.id, note: why }, 'Wire cancelled — its bills are free again.'); } }} className="px-2 py-1 rounded text-[10px] font-bold" style={{ background: '#fee2e2', color: '#7f1d1d' }}>✕ cancel wire</button>}
        <button onClick={function () { setDet(null); }} className="px-2 py-1 rounded text-[10px] font-bold" style={{ background: '#e2e8f0', color: '#334155' }}>✕ close</button>
      </div>
      <div className="text-[11px] mb-2" style={{ color: '#334155' }}>Bills ${fmt(P.bills_total)}{P.fee_amount > 0 ? ' + ' + P.payee_name + ' fee $' + fmt(P.fee_amount) + (P.fee_note ? ' (' + P.fee_note + ')' : '') : ''} · prepared {d16(P.created_at)}{P.created_by ? ' by ' + P.created_by : ''}{P.memo ? ' · ' + P.memo : ''}{P.cancelled ? ' · CANCELLED by ' + P.cancelled.by + ': ' + P.cancelled.note : ''}</div>

      <div className="rounded-lg p-2 mb-2" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
        <div className="flex gap-2 items-center flex-wrap mb-1">
          <div className="text-[11px] font-extrabold" style={{ color: '#0f172a' }}>🤖 Audit + AI — not paid before · every bill has a release · no duplicated release / reference numbers · every bill belongs on this wire{det.frozen_checks ? ' (as signed)' : ''}</div>
          <div className="flex-1" />
          <span className="text-[10px]" style={{ color: '#64748b' }}>{det.audit.checked_at ? 'run ' + d16(det.audit.checked_at) + (det.audit.checked_by ? ' by ' + det.audit.checked_by : '') + (det.audit.stale ? ' — the wire CHANGED since' : '') : 'not run yet'}</span>
          {P.raw_status === 'draft' && (perms.prepare || perms.signoff) && <button onClick={function () { act({ action: 'run_check', id: P.id }, function (j) { return j.pass ? 'Audit passed' + (j.warns ? ' with ' + j.warns + ' warning(s)' : '') + (j.ai_ok === true ? ' · AI: OK' : j.ai_ok === false ? ' · AI raised concerns' : ' · AI unavailable') + ' — ready for sign-off.' : 'Audit found ' + j.blocks + ' blocking problem(s).'; }); }}
            disabled={busy} className="px-2.5 py-1 rounded-lg text-[10px] font-extrabold" style={{ background: '#4338ca', color: '#ffffff', opacity: busy ? 0.5 : 1 }}>🤖 {det.audit.checked_at ? 'Run again' : 'Run the audit'}</button>}
        </div>
        {(det.checks.checks || []).map(function (c, i) {
          var s = c.level === 'block' ? { bg: '#fee2e2', fg: '#7f1d1d', ic: '⛔' } : c.level === 'warn' ? { bg: '#fef3c7', fg: '#78350f', ic: '⚠' } : c.level === 'info' ? { bg: '#e0f2fe', fg: '#0c4a6e', ic: 'ℹ' } : { bg: '#d1fae5', fg: '#065f46', ic: '✅' };
          return <div key={i} className="text-[11px] font-bold rounded px-2 py-1 mb-0.5" style={{ background: s.bg, color: s.fg }}>{s.ic} {c.text}</div>;
        })}
        {det.audit.ai_summary && <div className="mt-1 rounded p-2 text-[11px]" style={{ background: det.audit.ai_ok === true ? '#ecfdf5' : det.audit.ai_ok === false ? '#fff7ed' : '#f1f5f9', border: '1px solid #e2e8f0', color: '#0f172a', whiteSpace: 'pre-wrap' }}><b>AI review:</b>{'\n'}{det.audit.ai_summary}</div>}
      </div>

      <div className="rounded-lg p-2 mb-2" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
        <div className="text-[11px] font-extrabold mb-1" style={{ color: '#0f172a' }}>② ③ ✍ Two different people verify this wire BEFORE it is sent</div>
        <div className="flex gap-2 flex-wrap mb-1">
          {[['1st', det.audit.signoff1], ['2nd', det.audit.signoff2]].map(function (p) {
            var s = p[1];
            return <div key={p[0]} className="rounded p-2 text-[11px]" style={{ flex: '1 1 220px', background: s && s.valid ? '#ecfdf5' : '#ffffff', border: '1px solid ' + (s && s.valid ? '#a7f3d0' : '#e2e8f0'), color: '#0f172a' }}>
              <b>{p[0]} verifier:</b> {s ? s.name + ' · ' + d16(s.at) + (s.valid ? '' : ' — NO LONGER COUNTS (the wire changed after signing)') : '—'}{s && s.note ? <div style={{ color: '#334155' }}>“{s.note}”</div> : null}</div>;
          })}
        </div>
        {perms.signoff && P.raw_status === 'draft' && <div className="flex gap-2 items-center flex-wrap">
          <input value={note} onChange={function (e) { setNote(e.target.value); }} placeholder={det.audit.ai_ok === true ? 'what you verified (optional)' : 'what you verified — required (AI raised concerns or did not run)'} className={inp} style={Object.assign({ flex: '1 1 260px' }, inpS)} />
          <button onClick={function () { act({ action: 'signoff', id: P.id, note: note }, function (j) { return j.approved ? '✅ Second sign-off — APPROVED, ready to send.' : 'First sign-off recorded — a different person signs second.'; }).then(function () { setNote(''); }); }}
            disabled={busy || (st !== 'awaiting_1st' && st !== 'awaiting_2nd')} className="px-3 py-1 rounded-lg text-[11px] font-extrabold disabled:opacity-50" style={{ background: '#047857', color: '#ffffff' }}>✍ Sign off as {st === 'awaiting_2nd' ? '2nd' : '1st'} verifier</button>
          {(st === 'needs_check' || st === 'flagged') && <span className="text-[10px] font-bold" style={{ color: '#7f1d1d' }}>{st === 'flagged' ? 'Fix the ⛔ items, then run the audit again.' : 'Run the audit first.'}</span>}
        </div>}
      </div>

      {/* send — the bank's confirmation is part of the approval record */}
      {(st === 'ready_to_send' || P.sent) && <div className="rounded-lg p-2 mb-2" style={{ background: st === 'ready_to_send' ? '#ecfdf5' : '#f8fafc', border: '1px solid ' + (st === 'ready_to_send' ? '#6ee7b7' : '#e2e8f0') }}>
        <div className="text-[11px] font-extrabold mb-1" style={{ color: '#0f172a' }}>📤 Sent at the bank</div>
        {P.sent ? <div className="text-[11px]" style={{ color: '#0f172a' }}>Sent {P.sent.date} · reference <b>{P.sent.reference}</b> · marked by {P.sent.by} {d16(P.sent.at)}</div>
          : perms.send ? <div className="flex gap-2 items-center flex-wrap">
            <span className="text-[11px] font-bold" style={{ color: '#065f46' }}>Approved — send exactly ${fmt(P.total)} to {P.payee_name}, then:</span>
            <input type="date" value={sendF.date} onChange={function (e) { setSendF(Object.assign({}, sendF, { date: e.target.value })); }} className={inp} style={inpS} />
            <input value={sendF.ref} onChange={function (e) { setSendF(Object.assign({}, sendF, { ref: e.target.value })); }} placeholder="bank wire reference / confirmation #" className={inp} style={Object.assign({ width: 220 }, inpS)} />
            <input type="file" accept="application/pdf,image/*" onChange={function (e) { setSendF(Object.assign({}, sendF, { file: e.target.files && e.target.files[0] })); }} className="text-[10px]" style={{ color: '#0f172a' }} />
            <button onClick={sendIt} disabled={busy} className="px-3 py-1 rounded-lg text-[11px] font-extrabold disabled:opacity-50" style={{ background: '#1d4ed8', color: '#ffffff' }}>📤 Mark sent + attach confirmation</button>
          </div> : <div className="text-[11px]" style={{ color: '#065f46' }}>Approved — waiting for someone with “Wires: Send” to send it.</div>}
      </div>}

      {/* attach the bank line */}
      {P.raw_status === 'sent' && <div className="rounded-lg p-2 mb-2" style={{ background: '#eff6ff', border: '1px solid #bfdbfe' }}>
        <div className="text-[11px] font-extrabold mb-1" style={{ color: '#0f172a' }}>🔗 Attach the bank line — the bills are recorded paid when you do</div>
        {!cands ? <div className="text-[11px] text-slate-500">Looking for the bank line…</div> : (cands.candidates || []).length === 0 ? <div className="text-[11px]" style={{ color: '#334155' }}>{cands.error || 'No matching money-out line yet (around ' + (P.sent && P.sent.date) + ', about $' + fmt(P.approved_total) + '). It appears once the bank feed has it.'} <button onClick={function () { loadCands(P.id); }} className="underline font-bold">refresh</button></div>
          : <div>{cands.candidates.map(function (c) {
            return <div key={c.id} className="flex gap-2 items-center flex-wrap text-[11px] py-0.5" style={{ color: '#0f172a' }}>
              <span className="whitespace-nowrap">{c.date}</span><span className="font-bold tabular-nums">−${fmt(c.amount)}</span><span>{c.looks_like_wire ? '🏦 ' : ''}{c.name}</span>
              {c.exact ? <span className="px-1 rounded text-[9px] font-extrabold" style={{ background: '#d1fae5', color: '#065f46' }}>exact amount</span> : <span className="px-1 rounded text-[9px] font-extrabold" style={{ background: '#fee2e2', color: '#7f1d1d' }}>{(c.amount - P.approved_total > 0 ? '+' : '') + fmt(c.amount - P.approved_total)} vs approved</span>}
              {perms.send && <button onClick={function () { act({ action: 'attach', id: P.id, bank_transaction_id: c.id, override_note: c.exact ? '' : ovr }, function (j) { return '🔗 Attached — ' + j.bills_paid + ' bill(s) recorded paid by this wire.'; }); }}
                disabled={busy} className="px-2 py-0.5 rounded text-[10px] font-extrabold" style={{ background: '#1d4ed8', color: '#ffffff' }}>attach</button>}
            </div>;
          })}
            {cands.candidates.some(function (c) { return !c.exact; }) && <input value={ovr} onChange={function (e) { setOvr(e.target.value); }} placeholder="super admin only: why the bank amount differs (bank fee, FX…)" className={inp + ' mt-1'} style={Object.assign({ width: '100%' }, inpS)} />}
          </div>}
      </div>}
      {P.attached && <div className="rounded-lg p-2 mb-2 text-[11px]" style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#0f172a' }}>
        🔗 Attached to the bank line {P.attached.bank ? P.attached.bank.date + ' −$' + fmt(P.attached.bank.amount) + ' ' + P.attached.bank.name : ''} by {P.attached.by} {d16(P.attached.at)}{P.attached.note ? ' — amount difference accepted: “' + P.attached.note + '”' : ''}. The bills below are recorded paid by this wire.</div>}

      {/* RTM proof per bill */}
      {P.paid_through && (P.raw_status === 'sent' || P.raw_status === 'attached') && <div className="rounded-lg p-2 mb-2" style={{ background: '#fdf4ff', border: '1px solid #f5d0fe' }}>
        <div className="text-[11px] font-extrabold mb-1" style={{ color: '#0f172a' }}>📎 {P.payee_name}'s proof that it paid the vendors — {P.rtm_pending ? P.rtm_pending + ' bill(s) still without proof' : 'all bills have proof'}</div>
        {(perms.send || perms.prepare) && P.rtm_pending > 0 && <div className="flex gap-2 items-center flex-wrap">
          <span className="text-[10px]" style={{ color: '#334155' }}>Tick the bills below this proof covers, then:</span>
          <input type="date" value={proofF.date} onChange={function (e) { setProofF(Object.assign({}, proofF, { date: e.target.value })); }} className={inp} style={inpS} />
          <input value={proofF.ref} onChange={function (e) { setProofF(Object.assign({}, proofF, { ref: e.target.value })); }} placeholder="their payment reference" className={inp} style={Object.assign({ width: 180 }, inpS)} />
          <input type="file" accept="application/pdf,image/*" onChange={function (e) { setProofF(Object.assign({}, proofF, { file: e.target.files && e.target.files[0] })); }} className="text-[10px]" style={{ color: '#0f172a' }} />
          <button onClick={addProof} disabled={busy} className="px-3 py-1 rounded-lg text-[11px] font-extrabold disabled:opacity-50" style={{ background: '#a21caf', color: '#ffffff' }}>📎 Add proof</button>
        </div>}
      </div>}

      <div className="text-[11px] font-extrabold mb-1" style={{ color: '#0f172a' }}>Bills on this wire ({det.lines.length})</div>
      <div className="overflow-x-auto"><table className="w-full text-[11px]">
        <thead><tr style={{ borderBottom: '1px solid #cbd5e1', color: '#475569' }}>
          {P.paid_through && (P.raw_status === 'sent' || P.raw_status === 'attached') ? <th className="py-1 pr-1"></th> : null}
          <th className="py-1 pr-2 text-left font-semibold">Vendor</th><th className="py-1 pr-2 text-left font-semibold">Bill / ref #</th><th className="py-1 pr-2 text-left font-semibold">Release #</th>
          <th className="py-1 pr-2 text-left font-semibold">Bill date</th><th className="py-1 pr-2 text-left font-semibold">Due</th><th className="py-1 pr-2 text-left font-semibold">Category</th>
          <th className="py-1 pr-2 text-right font-semibold">Bill total</th><th className="py-1 pr-2 text-right font-semibold">This wire</th><th className="py-1 pr-2 text-left font-semibold">Paid before</th>
          <th className="py-1 pr-2 text-left font-semibold">Validated</th><th className="py-1 pr-2 text-left font-semibold">Notes</th>{P.paid_through ? <th className="py-1 text-left font-semibold">{P.payee_name} proof</th> : null}</tr></thead>
        <tbody style={{ color: '#0f172a' }}>
          {det.lines.map(function (l) {
            var b = l.bill || {}; var canTick = P.paid_through && (P.raw_status === 'sent' || P.raw_status === 'attached');
            var before = (l.other_payments || []);
            return <tr key={l.line_id} style={{ borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' }}>
              {canTick ? <td className="py-1 pr-1">{!l.rtm.confirmed_at ? <input type="checkbox" checked={!!proofF.ticks[l.line_id]} onChange={function (e) { var t2 = Object.assign({}, proofF.ticks); t2[l.line_id] = e.target.checked; setProofF(Object.assign({}, proofF, { ticks: t2 })); }} /> : '✓'}</td> : null}
              <td className="py-1 pr-2 font-bold">{b.vendor_name || '?'}</td><td className="py-1 pr-2">{b.bill_number || '—'}</td>
              <td className="py-1 pr-2">{b.release_number ? <b>{b.release_number}</b> : <span style={{ color: '#b91c1c', fontWeight: 800 }}>missing</span>}</td>
              <td className="py-1 pr-2 whitespace-nowrap">{b.bill_date || '—'}</td><td className="py-1 pr-2 whitespace-nowrap">{b.due_date || '—'}</td>
              <td className="py-1 pr-2">{b.category ? String(b.category).replace(/_/g, ' ') : '—'}</td>
              <td className="py-1 pr-2 text-right tabular-nums">${fmt(b.total_amount)}</td><td className="py-1 pr-2 text-right tabular-nums font-bold">${fmt(l.amount)}</td>
              <td className="py-1 pr-2" style={{ color: before.length ? '#b45309' : '#64748b' }}>{before.length ? before.map(function (o) { return '$' + fmt(o.amount) + ' ' + (o.paid_date || '') + ' (' + o.label + ')'; }).join('; ') : 'none'}</td>
              <td className="py-1 pr-2">{b.validation_status === 'validated' ? '✓' : (b.validation_status || '—')}{b.disputed ? ' · DISPUTED' : ''}</td>
              <td className="py-1 pr-2" style={{ maxWidth: 240, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{b.notes || ''}{b.attachment_path ? ' 📎' : ''}</td>
              {P.paid_through ? <td className="py-1 text-[10px]">{l.rtm.confirmed_at ? <span style={{ color: '#065f46' }}>✓ paid {l.rtm.paid_date}{l.rtm.reference ? ' · ' + l.rtm.reference : ''}<div style={{ color: '#64748b' }}>{l.rtm.confirmed_by}</div></span> : <span style={{ color: '#a21caf' }}>—</span>}</td> : null}
            </tr>;
          })}
        </tbody></table></div>

      {(det.files || []).length > 0 && <div className="mt-2">
        <div className="text-[11px] font-extrabold mb-1" style={{ color: '#0f172a' }}>Attached proofs</div>
        {det.files.map(function (f) {
          return <div key={f.id} className="text-[11px]" style={{ color: '#0f172a' }}>{f.kind === 'bank_confirmation' ? '🏦 Bank wire confirmation' : f.kind === 'rtm_proof' ? '📎 ' + P.payee_name + ' proof' : '📄 File'} · <button onClick={function () { openFile(f.path); }} className="underline font-bold" style={{ color: '#1d4ed8' }}>{f.file_name || 'open'}</button> · {f.by || ''} {d16(f.at)}</div>;
        })}
      </div>}
    </div>}
  </div>;
}
