'use client';
// v55.83-RH/RI — 📤 Wires, approved BEFORE the money leaves.
// RI (Max, Nov 9 10:37): "it is very USER UNFRIENDLY. WHAT IS GOING ON ...i
// don't know how to even proceed. how to even choose a freaking bill. make it
// simple and user friedly"
//  → a guided screen: 1) who gets the money (3 big buttons) 2) tick the bills
//    (every open bill is listed, searchable — no setup first; a missing release
//    # is typed right on the row) 3) Save — the check runs by itself. Each wire
//    then shows ONE "next step" box with the one thing to do now, and a
//    progress bar of the steps.
import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { PKG_STATUS_LABEL } from '../lib/wire-audit';

function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function d16(x) { return String(x || '').substring(0, 16).replace('T', ' '); }
var INK = '#0f172a'; var SUB = '#334155'; var MUTED = '#64748b';
var PST = {
  needs_check: { background: '#e0e7ff', color: '#312e81' }, flagged: { background: '#fee2e2', color: '#7f1d1d' },
  awaiting_1st: { background: '#fef3c7', color: '#78350f' }, awaiting_2nd: { background: '#ffedd5', color: '#7c2d12' },
  ready_to_send: { background: '#d1fae5', color: '#065f46' }, sent: { background: '#dbeafe', color: '#1e3a8a' },
  awaiting_proof: { background: '#fae8ff', color: '#701a75' }, complete: { background: '#065f46', color: '#ffffff' }, cancelled: { background: '#e2e8f0', color: '#475569' },
  reversed: { background: '#e2e8f0', color: '#7f1d1d' },
};
// what the list says to do next, in plain words
var NEXT_WORDS = {
  needs_check: 'Check it', flagged: 'Fix the problems', awaiting_1st: '1st person signs', awaiting_2nd: '2nd person signs',
  ready_to_send: 'Send it at the bank', sent: 'Attach the bank line', awaiting_proof: 'Add RTM proof', complete: 'Done', cancelled: '—', reversed: 'Undone',
};
// v55.83-RL — the wire's history in plain words (Max 12:18: "audit should include whatever ... was done")
var HIST_WORDS = {
  wire_package_prepared: '➕ prepared the wire', wire_package_updated: '✏ changed the wire', wire_package_audit_run: '🤖 check ran',
  wire_check_overridden: '↷ overrode a check', wire_package_signoff_1: '✍ signed 1st', wire_package_signoff_2: '✍ signed 2nd (approved)',
  wire_package_sent: '📤 marked it sent', wire_package_attached: '🔗 attached the bank line', wire_package_rtm_proof: '📎 added RTM proof',
  bill_paid_via_set: '🏢 bills marked “paid through”', wire_package_cancelled: '✕ cancelled', wire_package_reversed: '↩ undid the wire', wire_package_mark_failed: '⚠ marking failed',
};
// how to fix each blocking problem
var FIX = {
  RELEASE_MISSING: 'Type the release # on that bill in the table below.',
  RELEASE_UNKNOWN: 'Double-check the release # on that bill.',
  PAID_BEFORE: 'It is already paid — ✏ Change the wire and untick it.',
  PART_PAID_BEFORE: 'Make sure the amount is only what is still owed.',
  OVERPAID: '✏ Change the wire and lower the amount.',
  PAYEE_MISMATCH: '✏ Change the wire and untick it (it belongs on another wire).',
  IN_OTHER_PACKAGE: 'It is on another wire — untick it here, or cancel that wire.',
  DUP_RELEASE: 'Same vendor, same release AND same date as another bill — a duplicate: check in 💸 Bills and void it (or fix the date if it is a different charge).',
  DUP_RELEASE_IN_WIRE: 'Same vendor, same release, same date twice on this wire — untick one (or fix the bill date if they are different charges).',
  DUP_REF: 'Same reference AND date as another bill — check in 💸 Bills and void the duplicate.',
  DUP_REF_IN_WIRE: 'Same reference and date twice on this wire — untick one.',
  BILL_NUMBER_MISSING: 'Type the bill # in 💸 Bills (or override with the reason).', BILL_DATE_MISSING: 'Set the bill date in 💸 Bills (or override with the reason).',
  DIRECTION_MISSING: 'Tick ⬅ Inbound or Outbound ➡ on that bill in the table below.', REFERENCE_MISSING: 'An inbound bill needs its reference — type it in the table below.',
  DUP_OTHER_REF: 'Same reference and date as another bill of this vendor — check in 💸 Bills.', DUP_OTHER_REF_IN_WIRE: 'Same reference and date twice on this wire — untick one.',
  BILL_VOID: 'The bill is void — untick it.', BILL_DISPUTED: 'The bill is disputed — untick it until it is resolved.',
  FEE_NOT_ALLOWED: 'Only RTM wires can carry a fee — remove it.', NO_BILLS: '✏ Change the wire and tick its bills.',
};
var inp = 'px-2 py-1.5 rounded-lg border border-slate-300 text-[12px] nt-light';
var inpS = { color: INK, background: '#ffffff' };
// v55.83-RL (Max 12:18–12:20) — the bill's release #, INBOUND / OUTBOUND tick and other reference, editable in place.
// outbound → release # required; inbound → reference required; NextTrade overhead → neither.
function BillFields(p) {
  var b = p.bill || {}; var edit = p.editable === true;
  var s1 = useState(null); var relD = s1[0]; var setRelD = s1[1];
  var s2 = useState(null); var refD = s2[0]; var setRefD = s2[1];
  var dir = String(b.shipment_direction || '').toLowerCase();
  var needRel = !p.releaseOptional && dir !== 'inbound';
  var needRef = dir === 'inbound';
  function save(field, value, done) { p.onSave(field, value, function (ok) { if (ok && done) { done(); } }); }
  function chip(v, label) {
    var on = dir === v;
    return <button key={v} disabled={!edit || p.busy} onClick={function () { if (!on) { save('shipment_direction', v); } }} className="px-1.5 py-0.5 rounded text-[10px] font-extrabold"
      style={on ? { background: '#1e293b', color: '#ffffff' } : { background: '#ffffff', color: edit ? '#334155' : '#94a3b8', border: '1px solid ' + (!dir && !p.releaseOptional ? '#f87171' : '#cbd5e1') }}>{label}</button>;
  }
  function field(label, val, draft, setDraft, fieldName, need) {
    if (val && draft == null) {
      return <div className="text-[11px]" style={{ color: '#0f172a' }}>{label + ': '}<b>{val}</b>{edit ? <button onClick={function () { setDraft(val); }} className="ml-1 text-[10px] font-bold underline" style={{ color: '#1d4ed8' }}>change</button> : null}</div>;
    }
    if (!edit) { return need ? <div className="text-[11px] font-extrabold" style={{ color: '#b91c1c' }}>{label + ': missing'}</div> : null; }
    return <div className="flex gap-1 items-center mt-0.5">
      <input value={draft || ''} onChange={function (e) { setDraft(e.target.value); }} placeholder={label + (need ? ' (needed)' : ' (optional)')}
        className="px-1.5 py-0.5 rounded border text-[11px] nt-light" style={{ width: 120, color: '#0f172a', background: '#ffffff', borderColor: need ? '#f87171' : '#cbd5e1' }} />
      <button disabled={p.busy} onClick={function () { save(fieldName, draft, function () { setDraft(null); }); }} className="px-1.5 py-0.5 rounded text-[10px] font-extrabold" style={{ background: '#1d4ed8', color: '#ffffff' }}>save</button>
    </div>;
  }
  return <div onClick={function (e) { e.stopPropagation(); }}>
    <div className="flex gap-1 items-center">{chip('inbound', '⬅ Inbound')}{chip('outbound', 'Outbound ➡')}{!dir && !p.releaseOptional ? <span className="text-[10px] font-bold" style={{ color: '#b91c1c' }}>tick one</span> : null}</div>
    {field('Release #', b.release_number, relD, setRelD, 'release_number', needRel)}
    {field('Reference', b.other_reference, refD, setRefD, 'other_reference', needRef)}
  </div>;
}

function Btn(p) {
  var col = p.color || '#1e293b';
  return <button onClick={p.onClick} disabled={p.disabled} title={p.title} className={'rounded-lg font-extrabold disabled:opacity-40 ' + (p.big ? 'px-4 py-2 text-[13px]' : 'px-3 py-1.5 text-[12px]')}
    style={p.light ? { background: '#ffffff', color: SUB, border: '1px solid #cbd5e1' } : { background: col, color: '#ffffff' }}>{p.children}</button>;
}

export default function WirePackagesPanel(props) {
  var userProfile = props.userProfile; var toast = props.toast; var perms = props.perms || {};
  var a1 = useState(null); var list = a1[0]; var setList = a1[1];
  var a2 = useState(false); var busy = a2[0]; var setBusy = a2[1];
  var a3 = useState('open'); var fSt = a3[0]; var setFSt = a3[1];
  var a4 = useState(null); var det = a4[0]; var setDet = a4[1];
  var a5 = useState(null); var ed = a5[0]; var setEd = a5[1];
  var a6 = useState(null); var payees = a6[0]; var setPayees = a6[1];
  var a7 = useState(''); var note = a7[0]; var setNote = a7[1];
  var a8 = useState({ date: new Date().toISOString().substring(0, 10), ref: '', file: null }); var sendF = a8[0]; var setSendF = a8[1];
  var a9 = useState(null); var cands = a9[0]; var setCands = a9[1];
  var a10 = useState(''); var ovr = a10[0]; var setOvr = a10[1];
  var a11 = useState({ ticks: {}, date: '', ref: '', file: null }); var proofF = a11[0]; var setProofF = a11[1];
  var a12 = useState(''); var q = a12[0]; var setQ = a12[1];
  var a13 = useState({}); var relDraft = a13[0]; var setRelDraft = a13[1];
  var a14 = useState(false); var showMore = a14[0]; var setShowMore = a14[1];
  var a15 = useState(null); var setup = a15[0]; var setSetup = a15[1];
  var a16 = useState({}); var ovrDraft = a16[0]; var setOvrDraft = a16[1]; // v55.83-RL — reasons being typed, per check

  // v55.83-RJ (review gap 9) — every call returns an answer object; a timeout / non-JSON reply becomes a readable error, never a frozen screen
  function api(payload) {
    return fetch('/api/accounting/wire-packages', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ user_id: userProfile && userProfile.id }, payload)) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'The server did not answer properly (HTTP ' + r.status + '). Reload and check the wire list before trying again.' }; }); })
      .catch(function (e) { return { ok: false, error: 'Could not reach the server (' + ((e && e.message) || 'network') + ').' }; });
  }
  function load() { api({ action: 'list' }).then(function (j) { if (j && j.ok) { setList(j.packages || []); } else { setList([]); if (j && j.error) { toast.error(j.error); } } }).catch(function () { setList([]); }); }
  function open(id) {
    setBusy(true); setNote(''); setCands(null); setOvr(''); setRelDraft({});
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
  // ── step 1 + 2: the new / change form
  function withPayees(fn) {
    if (payees) { fn(payees); return; }
    setBusy(true);
    api({ action: 'payees' }).then(function (j) { if (j && j.ok) { setPayees(j); fn(j); } else { toast.error((j && j.error) || 'Could not load who wires can go to.'); } }).finally(function () { setBusy(false); });
  }
  function startNew() { withPayees(function () { setDet(null); setQ(''); setEd({ id: null, kind: null, payee: '', fee: '', fee_note: '', memo: '', picks: {}, bills: null }); }); }
  function startChange(existing) {
    withPayees(function () {
      var p = existing.package; var picks = {}; var info = {};
      existing.lines.forEach(function (l) { picks[l.bill_id] = String(l.amount); info[l.bill_id] = l; });
      setQ('');
      setEd({ id: p.id, kind: p.payee_kind, payee: p.payee_kind === 'vendor' ? '' : p.payee_name, fee: p.fee_amount ? String(p.fee_amount) : '', fee_note: p.fee_note || '', memo: p.memo || '', picks: picks, bills: null, lineInfo: info });
      loadBills(p.payee_kind, p.payee_kind === 'vendor' ? '' : p.payee_name, p.id);
    });
  }
  function pickPayee(kind, name) {
    setEd(Object.assign({}, ed, { kind: kind, payee: name, picks: {}, bills: null, fee: kind === 'service_provider' ? ed.fee : '' }));
    loadBills(kind, name, ed.id);
  }
  function loadBills(kind, payee, pkgId) {
    api({ action: 'open_bills', payee_kind: kind, payee_name: payee, package_id: pkgId }).then(function (j) {
      var current = true;
      setEd(function (e) {
        if (!e || e.kind !== kind || String(e.payee || '') !== String(payee || '')) { current = false; return e; } // review gap 10
        return Object.assign({}, e, { bills: (j && j.ok) ? j.bills : [] });
      });
      if (current && !(j && j.ok)) { toast.error((j && j.error) || 'Could not load the bills.'); }
    });
  }
  function togglePick(b) {
    var pk = Object.assign({}, ed.picks);
    if (pk[b.id] != null) { delete pk[b.id]; } else { pk[b.id] = String(b.open); }
    setEd(Object.assign({}, ed, { picks: pk }));
  }
  // v55.83-RL — save the release # / reference / inbound-outbound of a bill, then refresh where it shows
  function saveField(billId, field, value, done) {
    var v = String(value == null ? '' : value).trim();
    if (field !== 'shipment_direction' && v.length < 2) { toast.error(field === 'other_reference' ? 'Type the reference.' : 'Type the release #.'); if (done) { done(false); } return; }
    var payload = { action: 'set_bill_release', bill_id: billId, field: field }; payload[field] = v;
    setBusy(true);
    api(payload).then(function (j) {
      if (j && j.ok) {
        toast.success((field === 'shipment_direction' ? (v === 'inbound' ? 'Marked INBOUND' : 'Marked OUTBOUND') : (field === 'other_reference' ? 'Reference ' : 'Release ') + j.value + ' saved') + ' on the bill.');
        setEd(function (e) { return (e && e.bills) ? Object.assign({}, e, { bills: e.bills.map(function (x) { if (x.id !== billId) { return x; } var y = Object.assign({}, x); y[field] = j.value; return y; }) }) : e; });
        if (det && det.package && det.package.raw_status === 'draft') { recheck(); }
        if (done) { done(true); }
      } else { toast.error((j && j.error) || 'Could not save it.'); if (done) { done(false); } }
    }).finally(function () { setBusy(false); });
  }
  function saveRelease(billId, after) {
    var v = String(relDraft[billId] || '').trim();
    if (v.length < 2) { toast.error('Type the release #.'); return; }
    setBusy(true);
    api({ action: 'set_bill_release', bill_id: billId, release_number: v }).then(function (j) {
      if (j && j.ok) {
        toast.success('Release ' + j.release_number + ' saved on the bill.');
        var d2 = Object.assign({}, relDraft); delete d2[billId]; setRelDraft(d2);
        if (after) { after(j); }
      } else { toast.error((j && j.error) || 'Could not save the release #.'); }
    }).finally(function () { setBusy(false); });
  }
  function saveWire() {
    var lines = []; var bad = null;
    Object.keys(ed.picks).forEach(function (k) {
      var typed = String(ed.picks[k] == null ? '' : ed.picks[k]).trim();
      var a = Number(typed.replace(/,/g, ''));
      var shapeOk = /^\d+(\.\d+)?$/.test(typed) || /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(typed); // "1,250.00" yes, "1,00.00" no
      if (!(a > 0) || !shapeOk) { var bb0 = (ed.bills || []).filter(function (x) { return x.id === k; })[0]; bad = bad || ((bb0 && (bb0.vendor_name + ' ' + (bb0.bill_number || ''))) || 'a ticked bill'); return; }
      lines.push({ bill_id: k, amount: Math.round(a * 100) / 100 });
    });
    if (bad) { toast.error('The amount for ' + bad + ' is not a number — type it like 1250.00 (or untick the bill).'); return; }
    var feeV = String(ed.fee || '').replace(/,/g, '').trim();
    if (ed.kind === 'service_provider' && feeV && !(Number(feeV) >= 0)) { toast.error('The fee is not a number — type it like 250.00, or leave it empty.'); return; }
    act({ action: 'save_draft', id: ed.id, payee_kind: ed.kind, payee_name: ed.payee, fee_amount: ed.kind === 'service_provider' ? (Number(feeV) || 0) : 0, fee_note: ed.fee_note, memo: ed.memo, lines: lines },
      function (j) { return j.audit ? (j.audit.pass ? '✅ Saved and checked — it is ready for the 1st signature.' : '⛔ Saved — the check found ' + j.audit.blocks + ' problem(s) to fix. See the red box.') : 'Saved.'; },
      function (j) { setEd(null); open(j.id); });
  }
  // ── wire actions
  function recheck() { return act({ action: 'run_check', id: det.package.id }, function (j) { return j.pass ? '✅ Check passed.' : '⛔ Still ' + j.blocks + ' problem(s).'; }); }
  function sign() { act({ action: 'signoff', id: det.package.id, note: note }, function (j) { return j.approved ? '✅ 2nd signature — APPROVED. It can be sent now.' : '✍ 1st signature recorded — now a DIFFERENT person signs.'; }).then(function () { setNote(''); }); }
  function sendIt() {
    if (!sendF.ref || sendF.ref.trim().length < 3) { toast.error("Type the bank's wire reference / confirmation #."); return; }
    if (!sendF.file) { toast.error("Attach the bank's wire confirmation (PDF or screenshot)."); return; }
    setBusy(true);
    upload(sendF.file, det.package.id).then(function (u) {
      return act({ action: 'mark_sent', id: det.package.id, sent_date: sendF.date, bank_reference: sendF.ref, proof_path: u.path, proof_name: u.name }, '📤 Marked SENT. When the money-out shows in the bank feed, attach it here.');
    }).catch(function (e) { toast.error((e && e.message) || 'Upload failed.'); setBusy(false); });
  }
  function loadCands(id) { api({ action: 'bank_candidates', id: id }).then(function (j) { setCands(j && j.ok ? j : { candidates: [], error: j && j.error }); }); }
  function addProof() {
    var ids = Object.keys(proofF.ticks).filter(function (k) { return proofF.ticks[k]; });
    if (!ids.length) { toast.error('Tick the bills this proof covers (in the table below).'); return; }
    if (!proofF.date) { toast.error('The date RTM paid.'); return; }
    if (!proofF.file) { toast.error("Attach RTM's proof."); return; }
    setBusy(true);
    upload(proofF.file, det.package.id).then(function (u) {
      return act({ action: 'rtm_proof', id: det.package.id, line_ids: ids, paid_date: proofF.date, reference: proofF.ref, proof_path: u.path, proof_name: u.name }, function (j) { return '📎 Proof saved for ' + j.confirmed + ' bill(s).'; });
    }).catch(function (e) { toast.error((e && e.message) || 'Upload failed.'); setBusy(false); });
  }
  useEffect(function () { load(); api({ action: 'setup' }).then(function (j) { if (j && j.ok) { setSetup(j); } }); }, []); // eslint-disable-line

  var OPEN_ST = { needs_check: 1, flagged: 1, awaiting_1st: 1, awaiting_2nd: 1, ready_to_send: 1, sent: 1, awaiting_proof: 1 };
  var rows = (list || []).filter(function (p) { return fSt === 'all' || (fSt === 'open' ? OPEN_ST[p.status] : fSt === 'cancelled' ? (p.status === 'cancelled' || p.status === 'reversed') : p.status === fSt); });

  // ═════════ the NEW / CHANGE form ═════════
  if (ed && payees) {
    var picksN = Object.keys(ed.picks).length;
    var billsSum = 0; Object.keys(ed.picks).forEach(function (k) { billsSum += Number(String(ed.picks[k] || '').replace(/,/g, '')) || 0; });
    // review gap 4 — ticked bills that are no longer payable (paid, void, other company) are listed so they can be unticked
    var listedIds = {}; (ed.bills || []).forEach(function (b) { listedIds[b.id] = true; });
    var staleIds = ed.bills ? Object.keys(ed.picks).filter(function (k) { return !listedIds[k]; }) : [];
    var feeN = ed.kind === 'service_provider' ? (Number(String(ed.fee || '').replace(/,/g, '')) || 0) : 0;
    var pickedVendor = null;
    if (ed.kind === 'vendor' && ed.bills) { ed.bills.forEach(function (b) { if (ed.picks[b.id] != null && !pickedVendor) { pickedVendor = b.vendor_name; } }); }
    var qq = q.trim().toLowerCase();
    var shown = (ed.bills || []).filter(function (b) { return !qq || [b.vendor_name, b.bill_number, b.release_number].join(' ').toLowerCase().indexOf(qq) >= 0; });
    var mineB = shown.filter(function (b) { return !b.needs_mark; }); var otherB = shown.filter(function (b) { return b.needs_mark; });
    var renderRow = function (b) {
      var on = ed.picks[b.id] != null;
      var off = !!b.on_package || (ed.kind === 'vendor' && pickedVendor && b.vendor_name !== pickedVendor && !on);
      return <tr key={b.id} onClick={function () { if (!off) { togglePick(b); } }} style={{ borderTop: '1px solid #e2e8f0', background: on ? '#ecfdf5' : '#ffffff', cursor: off ? 'not-allowed' : 'pointer', opacity: off ? 0.45 : 1 }}>
        <td className="px-2 py-2" style={{ width: 28 }}><input type="checkbox" readOnly checked={on} disabled={off} style={{ width: 18, height: 18 }} /></td>
        <td className="px-2 py-2"><div className="text-[13px] font-extrabold" style={{ color: INK }}>{b.vendor_name}</div>
          <div className="text-[11px]" style={{ color: MUTED }}>{'Bill ' + (b.bill_number || '—') + (b.due_date ? ' · due ' + b.due_date : b.bill_date ? ' · ' + b.bill_date : '')}{b.on_package ? ' · already on ' + b.on_package : ''}{b.disputed ? ' · DISPUTED' : ''}</div></td>
        <td className="px-2 py-2"><BillFields bill={b} editable={!!perms.prepare} busy={busy} releaseOptional={b.release_optional} onSave={function (field, value, done) { saveField(b.id, field, value, done); }} /></td>
        <td className="px-2 py-2 text-right text-[12px] tabular-nums" style={{ color: SUB }}>${fmt(b.open)}</td>
        <td className="px-2 py-2 text-right" onClick={function (e) { e.stopPropagation(); }}>{on ? <input value={ed.picks[b.id]} onChange={function (e) { var pk = Object.assign({}, ed.picks); pk[b.id] = e.target.value; setEd(Object.assign({}, ed, { picks: pk })); }}
          className="px-1.5 py-1 rounded border text-[12px] text-right nt-light" style={{ width: 100, color: INK, background: '#ffffff', borderColor: '#cbd5e1' }} /> : <span className="text-[11px]" style={{ color: MUTED }}>tick to pay</span>}</td>
      </tr>;
    };
    var head = <thead><tr style={{ background: '#f1f5f9', color: SUB }}><th></th><th className="px-2 py-1.5 text-left text-[11px]">Vendor · bill</th><th className="px-2 py-1.5 text-left text-[11px]">In / Out · Release # · Reference</th><th className="px-2 py-1.5 text-right text-[11px]">Still owed</th><th className="px-2 py-1.5 text-right text-[11px]">Pay now</th></tr></thead>;
    return <div className="nt-paper rounded-xl p-4" style={{ border: '2px solid #0f766e' }}>
      <div className="flex gap-2 items-center mb-3">
        <div className="text-[16px] font-extrabold" style={{ color: INK }}>{ed.id ? '✏ Change this wire' : '＋ New wire'}</div>
        <div className="flex-1" />
        <Btn light onClick={function () { setEd(null); }}>✕ Close</Btn>
      </div>
      {/* step 1 */}
      <div className="text-[13px] font-extrabold mb-2" style={{ color: INK }}>1 · Who receives the money?</div>
      <div className="flex gap-2 flex-wrap mb-4">
        {(payees.parties || []).map(function (p) {
          var k = p.kind === 'affiliate' ? 'affiliate' : 'service_provider'; var on = ed.kind === k && ed.payee === p.name;
          return <button key={p.name} onClick={function () { pickPayee(k, p.name); }} className="rounded-xl px-4 py-3 text-left" style={{ minWidth: 200, background: on ? '#0f766e' : '#ffffff', color: on ? '#ffffff' : INK, border: '2px solid ' + (on ? '#0f766e' : '#cbd5e1') }}>
            <div className="text-[14px] font-extrabold">🏢 {p.name}</div><div className="text-[11px]" style={{ opacity: 0.85 }}>{k === 'affiliate' ? 'bills only — no fee' : 'pays the vendors for us · optional fee'}</div></button>;
        })}
        <button onClick={function () { pickPayee('vendor', ''); }} className="rounded-xl px-4 py-3 text-left" style={{ minWidth: 200, background: ed.kind === 'vendor' ? '#0f766e' : '#ffffff', color: ed.kind === 'vendor' ? '#ffffff' : INK, border: '2px solid ' + (ed.kind === 'vendor' ? '#0f766e' : '#cbd5e1') }}>
          <div className="text-[14px] font-extrabold">🧾 A vendor directly</div><div className="text-[11px]" style={{ opacity: 0.85 }}>we wire the vendor ourselves · one vendor</div></button>
      </div>
      {/* step 2 */}
      {ed.kind && <div>
        <div className="flex gap-2 items-center flex-wrap mb-2">
          <div className="text-[13px] font-extrabold" style={{ color: INK }}>2 · Tick the bills this wire pays</div>
          <input value={q} onChange={function (e) { setQ(e.target.value); }} placeholder="🔎 search vendor, bill # or release #" className={inp} style={Object.assign({ flex: '1 1 260px' }, inpS)} />
        </div>
        {staleIds.length > 0 && <div className="rounded-lg p-2 mb-2" style={{ background: '#fee2e2', border: '1px solid #fca5a5' }}>
          <div className="text-[12px] font-extrabold mb-1" style={{ color: '#7f1d1d' }}>{'⚠ ' + staleIds.length + ' bill(s) on this wire can no longer be paid by it (already paid, void, or paid through another company) — untick them:'}</div>
          {staleIds.map(function (k) {
            var li = (ed.lineInfo || {})[k] || {}; var bb1 = li.bill || {};
            return <label key={k} className="flex items-center gap-2 text-[12px] py-0.5" style={{ color: '#7f1d1d', cursor: 'pointer' }}>
              <input type="checkbox" checked={true} onChange={function () { var pk = Object.assign({}, ed.picks); delete pk[k]; setEd(Object.assign({}, ed, { picks: pk })); }} style={{ width: 16, height: 16 }} />
              <b>{bb1.vendor_name || 'Bill'}</b>{' ' + (bb1.bill_number || '') + ' · $' + fmt(ed.picks[k]) + (bb1.record_status && bb1.record_status !== 'active' ? ' · VOID' : '') + (bb1.paid_via && ed.kind !== 'vendor' && bb1.paid_via !== ed.payee ? ' · paid through ' + bb1.paid_via : '')}</label>;
          })}</div>}
        {!ed.bills ? <div className="text-[12px] py-3" style={{ color: MUTED }}>Loading the open bills…</div> : <div className="rounded-lg overflow-auto mb-3" style={{ maxHeight: 420, border: '1px solid #e2e8f0' }}>
          <table className="w-full">
            {ed.kind !== 'vendor' && mineB.length > 0 && <tbody><tr><td colSpan={5} className="px-2 py-1.5 text-[11px] font-extrabold" style={{ background: '#ecfeff', color: '#155e75' }}>{'Bills already marked “paid through ' + ed.payee + '” (' + mineB.length + ')'}</td></tr></tbody>}
            {head}
            <tbody>{(ed.kind === 'vendor' ? shown : mineB).map(renderRow)}</tbody>
            {ed.kind !== 'vendor' && otherB.length > 0 && <tbody><tr><td colSpan={5} className="px-2 py-1.5 text-[11px] font-extrabold" style={{ background: '#f8fafc', color: SUB }}>{'Other open bills (' + otherB.length + ') — ticking one marks it “paid through ' + ed.payee + '”'}</td></tr>{otherB.map(renderRow)}</tbody>}
            {shown.length === 0 && <tbody><tr><td colSpan={5} className="px-3 py-4 text-[12px]" style={{ color: MUTED }}>{qq ? 'Nothing matches “' + q + '”.' : 'No open bills. Add the bill in 💸 Bills first.'}</td></tr></tbody>}
          </table></div>}
        {/* step 3 */}
        <div className="rounded-xl p-3 flex gap-3 items-center flex-wrap" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
          <div className="text-[13px] font-extrabold" style={{ color: INK }}>3 · {picksN} bill(s) · ${fmt(billsSum)}</div>
          {ed.kind === 'service_provider' && <span className="flex gap-1 items-center"><span className="text-[12px] font-bold" style={{ color: SUB }}>+ {ed.payee} fee (optional) $</span>
            <input value={ed.fee} onChange={function (e) { setEd(Object.assign({}, ed, { fee: e.target.value })); }} placeholder="0" className={inp} style={Object.assign({ width: 90 }, inpS)} />
            {feeN > 0 && <input value={ed.fee_note} onChange={function (e) { setEd(Object.assign({}, ed, { fee_note: e.target.value })); }} placeholder="what the fee is for" className={inp} style={Object.assign({ width: 170 }, inpS)} />}</span>}
          <div className="flex-1" />
          <div className="text-[15px] font-extrabold" style={{ color: INK }}>Total to wire: ${fmt(billsSum + feeN)}</div>
          <Btn big color="#0f766e" onClick={saveWire} disabled={busy || !picksN}>{busy ? 'Saving & checking…' : '💾 Save & check →'}</Btn>
        </div>
      </div>}
    </div>;
  }

  // ═════════ one wire ═════════
  if (det) {
    var P = det.package; var st = P.status; var A = det.audit;
    var blocks = (det.checks.checks || []).filter(function (c) { return c.level === 'block'; });
    var warnsL = (det.checks.checks || []).filter(function (c) { return c.level === 'warn' || c.level === 'info'; });
    var steps = [['Prepared', true], ['Checked', st !== 'needs_check' && st !== 'flagged'], ['1st signature', !!(A.signoff1 && A.signoff1.valid)], ['2nd signature', !!(A.signoff2 && A.signoff2.valid)], ['Sent at the bank', !!P.sent], ['Bank line attached', !!P.attached]];
    if (P.paid_through) { steps.push([P.payee_name + ' proof', st === 'complete']); }
    var amountNow = P.approved_total != null ? P.approved_total : P.total;
    var canTick = P.paid_through && (P.raw_status === 'sent' || P.raw_status === 'attached') && P.rtm_pending > 0;
    var nextBox = null;
    if (st === 'cancelled') { nextBox = <div style={{ color: SUB }}>{'Cancelled by ' + (P.cancelled && P.cancelled.by) + ': ' + (P.cancelled && P.cancelled.note)}</div>; }
    else if (st === 'reversed') { nextBox = <div style={{ color: '#7f1d1d' }}>{'↩ Undone by ' + (P.reversed && P.reversed.by) + ' on ' + d16(P.reversed && P.reversed.at) + ': “' + (P.reversed && P.reversed.note) + '”. The bill payments it recorded were voided and the bills are back to how they were. This record is kept.'}</div>; }
    else if (st === 'needs_check') {
      nextBox = <div><div className="mb-2" style={{ color: INK }}>The wire changed since it was checked. Check it again.</div>{(perms.prepare || perms.signoff) ? <Btn big color="#4338ca" onClick={recheck} disabled={busy}>🤖 Check it now</Btn> : null}</div>;
    } else if (st === 'flagged') {
      nextBox = <div><div className="mb-2 font-extrabold" style={{ color: '#7f1d1d' }}>{'Fix ' + blocks.length + ' problem(s) before anyone can sign:'}</div>
        {blocks.map(function (c, i) {
          var od = ovrDraft[c.key];
          return <div key={i} className="rounded-lg px-3 py-2 mb-1" style={{ background: '#fee2e2', color: '#7f1d1d' }}><div className="font-bold">⛔ {c.text}</div>
            {FIX[c.code] ? <div className="text-[12px]" style={{ color: '#991b1b' }}>→ {FIX[c.code]}</div> : null}
            {/* v55.83-RL (Max 12:17: "should be override button. with reason and audit of who approved it") */}
            {c.overridable ? (perms.override ? (od == null
              ? <button onClick={function () { var d = Object.assign({}, ovrDraft); d[c.key] = ''; setOvrDraft(d); }} className="mt-1 px-2 py-1 rounded text-[11px] font-extrabold" style={{ background: '#ffffff', color: '#9a3412', border: '1px solid #fdba74' }}>↷ Override…</button>
              : <div className="flex gap-1 items-center mt-1 flex-wrap">
                <input value={od} onChange={function (e) { var d = Object.assign({}, ovrDraft); d[c.key] = e.target.value; setOvrDraft(d); }} placeholder="why it is OK to pay anyway (kept with your name)" className={inp} style={Object.assign({ flex: '1 1 300px' }, inpS)} />
                <Btn color="#9a3412" disabled={busy || String(od).trim().length < 10} onClick={function () { act({ action: 'override_check', id: P.id, check_key: c.key, reason: od }, function (j) { return j.pass ? '↷ Overridden — the wire can be signed now.' : '↷ Overridden — ' + j.blocks + ' problem(s) left.'; }).then(function () { var d = Object.assign({}, ovrDraft); delete d[c.key]; setOvrDraft(d); }); }}>↷ Override</Btn>
                <Btn light onClick={function () { var d = Object.assign({}, ovrDraft); delete d[c.key]; setOvrDraft(d); }}>cancel</Btn></div>)
              : <div className="text-[11px] mt-1" style={{ color: '#9a3412' }}>Can be overridden by someone with “Override wire checks”.</div>)
              : (c.why_not ? <div className="text-[11px] mt-1" style={{ color: '#7f1d1d' }}>{'Cannot be overridden: ' + c.why_not + '.'}</div> : null)}
          </div>;
        })}
        <div className="flex gap-2 mt-2">{perms.prepare && <Btn color="#0f766e" onClick={function () { startChange(det); }}>✏ Change the wire</Btn>}{(perms.prepare || perms.signoff) && <Btn color="#4338ca" onClick={recheck} disabled={busy}>🤖 Check again</Btn>}</div></div>;
    } else if (st === 'awaiting_1st' || st === 'awaiting_2nd') {
      var who = st === 'awaiting_1st' ? '1st' : '2nd';
      var ovrd = (det.checks.checks || []).filter(function (c) { return c.level === 'overridden'; });
      nextBox = <div><div className="mb-2" style={{ color: INK }}>{st === 'awaiting_1st' ? 'The check passed. Someone who verified the bills below signs first.' : 'Signed by ' + A.signoff1.name + '. Now a DIFFERENT person verifies and signs.'}</div>
        {ovrd.length > 0 && <div className="rounded-lg p-2 mb-2" style={{ background: '#fff7ed', border: '1px solid #fdba74' }}>
          <div className="text-[12px] font-extrabold mb-1" style={{ color: '#9a3412' }}>{'↷ ' + ovrd.length + ' problem(s) were OVERRIDDEN — read before signing:'}</div>
          {ovrd.map(function (c, i) { return <div key={i} className="text-[12px]" style={{ color: '#7c2d12' }}>{'• ' + c.text + ' — overridden by ' + ((c.override && c.override.by_name) || 'someone') + ': “' + ((c.override && c.override.reason) || '') + '”'}</div>; })}</div>}
        {A.ai_ok !== true && <div className="text-[12px] mb-2" style={{ color: '#9a3412' }}>{A.ai_ok === false ? 'The AI review raised concerns (see below) — write what you checked.' : 'The AI review did not run — write what you checked.'}</div>}
        {!perms.signoff ? <div style={{ color: SUB }}>Waiting for someone with “Wires: Sign Off”.</div>
          : (st === 'awaiting_2nd' && A.i_signed_first) ? <div className="font-bold" style={{ color: '#9a3412' }}>You signed first — the 2nd signature must be someone else.</div>
          : <div className="flex gap-2 items-center flex-wrap"><input value={note} onChange={function (e) { setNote(e.target.value); }} placeholder={A.ai_ok === true ? 'what you checked (optional)' : 'what you checked (required)'} className={inp} style={Object.assign({ flex: '1 1 280px' }, inpS)} />
            <Btn big color="#047857" onClick={sign} disabled={busy}>{'✍ I verified it — sign as ' + who}</Btn></div>}</div>;
    } else if (st === 'ready_to_send') {
      nextBox = <div><div className="mb-2 font-bold" style={{ color: '#065f46' }}>{'Approved by ' + A.signoff1.name + ' and ' + A.signoff2.name + '. Send exactly $' + fmt(P.total) + ' to ' + P.payee_name + ' at the bank, then fill this in:'}</div>
        {perms.send ? <div className="flex gap-2 items-center flex-wrap">
          <label className="text-[12px] font-bold" style={{ color: SUB }}>Sent on <input type="date" value={sendF.date} onChange={function (e) { setSendF(Object.assign({}, sendF, { date: e.target.value })); }} className={inp} style={inpS} /></label>
          <input value={sendF.ref} onChange={function (e) { setSendF(Object.assign({}, sendF, { ref: e.target.value })); }} placeholder="bank's wire reference #" className={inp} style={Object.assign({ width: 200 }, inpS)} />
          <label className="text-[12px] font-bold rounded-lg px-2 py-1.5" style={{ color: INK, background: '#f1f5f9', border: '1px dashed #94a3b8', cursor: 'pointer' }}>📎 {sendF.file ? sendF.file.name : 'bank confirmation (PDF / screenshot)'}
            <input type="file" accept="application/pdf,image/*" onChange={function (e) { setSendF(Object.assign({}, sendF, { file: e.target.files && e.target.files[0] })); }} style={{ display: 'none' }} /></label>
          <Btn big color="#1d4ed8" onClick={sendIt} disabled={busy}>📤 Mark as sent</Btn></div>
          : <div style={{ color: SUB }}>Waiting for someone with “Wires: Send”.</div>}</div>;
    } else if (st === 'sent') {
      nextBox = <div><div className="mb-2" style={{ color: INK }}>{'Sent ' + P.sent.date + ' (ref ' + P.sent.reference + '). When the $' + fmt(amountNow) + ' money-out shows in the bank feed, attach it — that records the bills as paid.'}</div>
        {!cands ? <div style={{ color: MUTED }}>Looking in the bank feed…</div> : (cands.candidates || []).length === 0
          ? <div style={{ color: SUB }}>{cands.error || 'Not in the bank feed yet.'} <button onClick={function () { loadCands(P.id); }} className="underline font-bold" style={{ color: '#1d4ed8' }}>look again</button></div>
          : <div>{cands.candidates.map(function (c) {
            return <div key={c.id} className="flex gap-2 items-center flex-wrap rounded-lg px-3 py-2 mb-1" style={{ background: c.exact ? '#ecfdf5' : '#fff7ed', border: '1px solid ' + (c.exact ? '#a7f3d0' : '#fed7aa'), color: INK }}>
              <span className="font-bold">{c.date}</span><span className="font-extrabold tabular-nums">−${fmt(c.amount)}</span><span className="flex-1">{c.name}</span>
              <span className="text-[11px] font-bold" style={{ color: c.exact ? '#065f46' : '#9a3412' }}>{c.exact ? 'exact amount' : (c.amount - amountNow > 0 ? '+' : '') + fmt(c.amount - amountNow) + ' different'}</span>
              {perms.send && <Btn color="#1d4ed8" onClick={function () { act({ action: 'attach', id: P.id, bank_transaction_id: c.id, override_note: c.exact ? '' : ovr }, function (j) { return '🔗 Attached — ' + j.bills_paid + ' bill(s) now recorded paid.'; }); }} disabled={busy}>🔗 This is it</Btn>}
            </div>;
          })}{cands.candidates.some(function (c) { return !c.exact; }) && <input value={ovr} onChange={function (e) { setOvr(e.target.value); }} placeholder="if the amount is different — super admin only: why (bank fee, FX…)" className={inp} style={Object.assign({ width: '100%' }, inpS)} />}</div>}</div>;
    } else if (st === 'awaiting_proof') {
      nextBox = <div><div className="mb-2" style={{ color: INK }}>{'In the bank. Now add ' + P.payee_name + '’s proof that it paid the vendors: tick the bills it covers in the table below (' + P.rtm_pending + ' still without proof), then:'}</div>
        {(perms.send || perms.prepare) ? <div className="flex gap-2 items-center flex-wrap">
          <label className="text-[12px] font-bold" style={{ color: SUB }}>{P.payee_name} paid on <input type="date" value={proofF.date} onChange={function (e) { setProofF(Object.assign({}, proofF, { date: e.target.value })); }} className={inp} style={inpS} /></label>
          <input value={proofF.ref} onChange={function (e) { setProofF(Object.assign({}, proofF, { ref: e.target.value })); }} placeholder="their reference (optional)" className={inp} style={Object.assign({ width: 180 }, inpS)} />
          <label className="text-[12px] font-bold rounded-lg px-2 py-1.5" style={{ color: INK, background: '#f1f5f9', border: '1px dashed #94a3b8', cursor: 'pointer' }}>📎 {proofF.file ? proofF.file.name : 'their proof (PDF / screenshot)'}
            <input type="file" accept="application/pdf,image/*" onChange={function (e) { setProofF(Object.assign({}, proofF, { file: e.target.files && e.target.files[0] })); }} style={{ display: 'none' }} /></label>
          <Btn big color="#a21caf" onClick={addProof} disabled={busy}>📎 Save proof</Btn></div> : <div style={{ color: SUB }}>Waiting for someone with “Wires: Send”.</div>}</div>;
    } else if (st === 'complete') { nextBox = <div className="font-bold" style={{ color: '#065f46' }}>🏁 Done — approved, sent, in the bank{P.paid_through ? ', and every bill has ' + P.payee_name + '’s proof' : ''}.</div>; }

    return <div className="nt-paper rounded-xl p-4" style={{ border: '2px solid #6366f1' }}>
      <div className="flex gap-2 items-center flex-wrap mb-3">
        <Btn light onClick={function () { setDet(null); }}>← All wires</Btn>
        <div className="text-[16px] font-extrabold" style={{ color: INK }}><span className="font-mono">{P.label}</span>{' · $' + fmt(amountNow) + ' to ' + P.payee_name}</div>
        <span className="px-2 py-1 rounded text-[11px] font-extrabold" style={PST[st]}>{PKG_STATUS_LABEL[st]}</span>
        <div className="flex-1" />
        {perms.prepare && P.raw_status === 'draft' && <Btn light onClick={function () { startChange(det); }}>✏ Change</Btn>}
        {/* v55.83-RL (Max 12:17: "ability to delete the wire and everything return to previous state") */}
        {perms.prepare && P.raw_status === 'draft' && <Btn light onClick={function () { var why = window.prompt('Delete this wire? Its bills go back to how they were. Why?'); if (why && why.trim().length >= 3) { act({ action: 'delete_wire', id: P.id, reason: why }, '🗑 Wire deleted — everything is back to how it was (the history keeps a copy).', function () { setDet(null); }); } }}>🗑 Delete wire</Btn>}
        {perms.undo && (P.raw_status === 'sent' || P.raw_status === 'attached') && <Btn light onClick={function () {
          var why = window.prompt('UNDO this wire? The bill payments it recorded are voided, bills go back to how they were, the bank line is freed. The record is kept. Why (at least 10 characters)?');
          if (why && why.trim().length >= 10) { act({ action: 'delete_wire', id: P.id, reason: why }, '↩ Wire undone — everything is back to how it was before it.'); } else if (why) { toast.error('Write a longer reason (at least 10 characters).'); }
        }}>↩ Undo &amp; delete wire</Btn>}
      </div>
      {/* progress */}
      <div className="flex gap-1 flex-wrap mb-3">
        {steps.map(function (s0, i) {
          var cur = !s0[1] && (i === 0 || steps[i - 1][1]);
          return <div key={i} className="rounded-lg px-2 py-1 text-[11px] font-extrabold" style={s0[1] ? { background: '#d1fae5', color: '#065f46' } : cur ? { background: '#1e293b', color: '#ffffff' } : { background: '#f1f5f9', color: '#94a3b8' }}>{(s0[1] ? '✓ ' : (i + 1) + ' · ') + s0[0]}</div>;
        })}
      </div>
      {/* the ONE thing to do now */}
      <div className="rounded-xl p-3 mb-3 text-[13px]" style={{ background: '#f8fafc', border: '2px solid #1e293b' }}>
        <div className="text-[11px] font-extrabold mb-1" style={{ color: MUTED, letterSpacing: 1 }}>NEXT STEP</div>{nextBox}</div>

      {/* the bills */}
      <div className="text-[13px] font-extrabold mb-1" style={{ color: INK }}>{'Bills on this wire (' + det.lines.length + ') · bills $' + fmt(P.bills_total) + (P.fee_amount > 0 ? ' + ' + P.payee_name + ' fee $' + fmt(P.fee_amount) + (P.fee_note ? ' (' + P.fee_note + ')' : '') : '')}</div>
      <div className="overflow-x-auto rounded-lg mb-3" style={{ border: '1px solid #e2e8f0' }}><table className="w-full text-[12px]">
        <thead><tr style={{ background: '#f1f5f9', color: SUB }}>
          {canTick ? <th className="px-2 py-1.5"></th> : null}
          <th className="px-2 py-1.5 text-left">Vendor</th><th className="px-2 py-1.5 text-left">Bill #</th><th className="px-2 py-1.5 text-left">In / Out · Release # · Reference</th>
          <th className="px-2 py-1.5 text-left">Bill date</th><th className="px-2 py-1.5 text-left">Due</th><th className="px-2 py-1.5 text-left">Category</th>
          <th className="px-2 py-1.5 text-right">Bill total</th><th className="px-2 py-1.5 text-right">This wire</th><th className="px-2 py-1.5 text-left">Paid before</th>
          <th className="px-2 py-1.5 text-left">Notes</th>{P.paid_through ? <th className="px-2 py-1.5 text-left">{P.payee_name} proof</th> : null}</tr></thead>
        <tbody style={{ color: INK }}>
          {det.lines.map(function (l) {
            var b = l.bill || {}; var before = l.other_payments || [];
            return <tr key={l.line_id} style={{ borderTop: '1px solid #f1f5f9', verticalAlign: 'top' }}>
              {canTick ? <td className="px-2 py-1.5">{!l.rtm.confirmed_at ? <input type="checkbox" style={{ width: 16, height: 16 }} checked={!!proofF.ticks[l.line_id]} onChange={function (e) { var t2 = Object.assign({}, proofF.ticks); t2[l.line_id] = e.target.checked; setProofF(Object.assign({}, proofF, { ticks: t2 })); }} /> : '✓'}</td> : null}
              <td className="px-2 py-1.5 font-bold">{b.vendor_name || '?'}{l.will_mark && P.raw_status === 'draft' ? <div className="text-[10px] font-bold" style={{ color: '#0e7490' }}>{'becomes “paid through ' + P.payee_name + '” when sent'}</div> : null}</td><td className="px-2 py-1.5">{b.bill_number || '—'}</td>
              <td className="px-2 py-1.5"><BillFields bill={b} editable={P.raw_status === 'draft' && !!perms.prepare} busy={busy} releaseOptional={P.payee_kind === 'affiliate'} onSave={function (field, value, done) { saveField(l.bill_id, field, value, done); }} /></td>
              <td className="px-2 py-1.5 whitespace-nowrap">{b.bill_date || <span style={{ color: '#b91c1c', fontWeight: 800 }}>missing</span>}</td><td className="px-2 py-1.5 whitespace-nowrap">{b.due_date || '—'}</td>
              <td className="px-2 py-1.5">{b.category ? String(b.category).replace(/_/g, ' ') : '—'}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">${fmt(b.total_amount)}</td><td className="px-2 py-1.5 text-right tabular-nums font-extrabold">${fmt(l.amount)}</td>
              <td className="px-2 py-1.5" style={{ color: before.length ? '#b45309' : MUTED }}>{before.length ? before.map(function (o) { return '$' + fmt(o.amount) + ' ' + (o.paid_date || '') + ' (' + o.label + ')'; }).join('; ') : 'none'}</td>
              <td className="px-2 py-1.5" style={{ maxWidth: 240, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{b.notes || ''}</td>
              {P.paid_through ? <td className="px-2 py-1.5 text-[11px]">{l.rtm.confirmed_at ? <span style={{ color: '#065f46' }}>✓ paid {l.rtm.paid_date}{l.rtm.reference ? ' · ' + l.rtm.reference : ''}</span> : <span style={{ color: MUTED }}>—</span>}</td> : null}
            </tr>;
          })}
        </tbody></table></div>

      {/* the record: checks, AI, signatures, proofs */}
      <button onClick={function () { setShowMore(!showMore); }} className="text-[12px] font-extrabold mb-2" style={{ color: '#1d4ed8' }}>{(showMore ? '▾' : '▸') + ' The full record — every check, the AI review, signatures and proof files'}</button>
      {showMore && <div className="rounded-xl p-3" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
        <div className="text-[12px] font-extrabold mb-1" style={{ color: INK }}>{'🤖 Checks' + (det.frozen_checks ? ' (as signed)' : '') + (A.checked_at ? ' · ' + d16(A.checked_at) + (A.checked_by ? ' by ' + A.checked_by : '') : '')}</div>
        {(det.checks.checks || []).map(function (c, i) {
          var s = c.level === 'block' ? { bg: '#fee2e2', fg: '#7f1d1d', ic: '⛔' } : c.level === 'overridden' ? { bg: '#ffedd5', fg: '#7c2d12', ic: '↷' } : c.level === 'warn' ? { bg: '#fef3c7', fg: '#78350f', ic: '⚠' } : c.level === 'info' ? { bg: '#e0f2fe', fg: '#0c4a6e', ic: 'ℹ' } : { bg: '#d1fae5', fg: '#065f46', ic: '✅' };
          return <div key={i} className="text-[12px] font-bold rounded px-2 py-1 mb-0.5" style={{ background: s.bg, color: s.fg }}>{s.ic} {c.text}{c.level === 'overridden' && c.override ? ' — overridden by ' + (c.override.by_name || 'someone') + ' ' + d16(c.override.at) + ': “' + c.override.reason + '”' : ''}</div>;
        })}
        {A.ai_summary && <div className="mt-2 rounded p-2 text-[12px]" style={{ background: '#ffffff', border: '1px solid #e2e8f0', color: INK, whiteSpace: 'pre-wrap' }}><b>AI review:</b>{'\n'}{A.ai_summary}</div>}
        <div className="text-[12px] mt-2" style={{ color: INK }}>{'✍ 1st: ' + (A.signoff1 ? A.signoff1.name + ' ' + d16(A.signoff1.at) + (A.signoff1.valid ? '' : ' (no longer counts — the wire changed)') + (A.signoff1.note ? ' — “' + A.signoff1.note + '”' : '') : '—')}</div>
        <div className="text-[12px]" style={{ color: INK }}>{'✍ 2nd: ' + (A.signoff2 ? A.signoff2.name + ' ' + d16(A.signoff2.at) + (A.signoff2.valid ? '' : ' (no longer counts)') + (A.signoff2.note ? ' — “' + A.signoff2.note + '”' : '') : '—')}</div>
        {P.sent && <div className="text-[12px]" style={{ color: INK }}>{'📤 Sent ' + P.sent.date + ' · ref ' + P.sent.reference + ' · by ' + P.sent.by}</div>}
        {P.attached && <div className="text-[12px]" style={{ color: INK }}>{'🔗 Bank line ' + (P.attached.bank ? P.attached.bank.date + ' −$' + fmt(P.attached.bank.amount) + ' ' + P.attached.bank.name : '') + ' · attached by ' + P.attached.by + (P.attached.note ? ' · amount difference accepted: “' + P.attached.note + '”' : '')}</div>}
        {(det.overrides || []).length > 0 && <div className="mt-2">
          <div className="text-[12px] font-extrabold" style={{ color: '#9a3412' }}>↷ Overrides (who approved, why)</div>
          {det.overrides.map(function (o, i) { return <div key={i} className="text-[12px]" style={{ color: INK }}>{d16(o.at) + ' · ' + o.by + ' · ' + (o.text || o.code) + ' — “' + o.reason + '”' + (o.counts ? '' : ' (no longer counts — the wire changed after it)')}</div>; })}</div>}
        {(det.history || []).length > 0 && <div className="mt-2">
          <div className="text-[12px] font-extrabold" style={{ color: INK }}>🧾 History — every step, who and when</div>
          {det.history.map(function (h, i) {
            var d0 = h.details || {}; var extra = '';
            if (h.action === 'wire_package_updated' && d0.changes) { var c0 = d0.changes; extra = [c0.payee ? 'pay to ' + c0.payee.from + ' → ' + c0.payee.to : '', c0.fee ? 'fee ' + c0.fee.from + ' → ' + c0.fee.to : '', (c0.bills_added || []).length ? '+' + c0.bills_added.length + ' bill(s)' : '', (c0.bills_removed || []).length ? '−' + c0.bills_removed.length + ' bill(s)' : '', (c0.amounts_changed || []).length ? (c0.amounts_changed.length + ' amount(s) changed') : ''].filter(Boolean).join(', '); }
            if (h.action === 'wire_package_audit_run') { extra = d0.pass ? 'passed' : (d0.blocks + ' problem(s)'); }
            if (h.action === 'wire_check_overridden') { extra = (d0.check || d0.code) + ' — “' + d0.reason + '”'; }
            if (h.action === 'wire_package_reversed' || h.action === 'wire_package_cancelled') { extra = '“' + (d0.reason || d0.note || '') + '”'; }
            if (h.action === 'wire_package_sent') { extra = 'ref ' + (d0.bank_reference || ''); }
            return <div key={i} className="text-[12px]" style={{ color: INK }}>{d16(h.at) + ' · ' + h.by + ' · ' + (HIST_WORDS[h.action] || h.action) + (extra ? ' · ' + extra : '')}</div>;
          })}</div>}
        {(det.files || []).map(function (f) {
          return <div key={f.id} className="text-[12px]" style={{ color: INK }}>{(f.kind === 'bank_confirmation' ? '🏦 Bank confirmation' : f.kind === 'rtm_proof' ? '📎 ' + P.payee_name + ' proof' : '📄 File') + ' · '}<button onClick={function () { openFile(f.path); }} className="underline font-bold" style={{ color: '#1d4ed8' }}>{f.file_name || 'open'}</button>{' · ' + (f.by || '') + ' ' + d16(f.at)}</div>;
        })}
      </div>}
    </div>;
  }

  // ═════════ the list ═════════
  return <div className="nt-paper rounded-xl p-4">
    <div className="flex gap-2 items-center flex-wrap mb-1">
      <div className="text-[16px] font-extrabold" style={{ color: INK }}>📤 Wires — approved before the money leaves</div>
      <div className="flex-1" />
      {perms.prepare && <Btn big color="#0f766e" onClick={startNew} disabled={busy}>＋ New wire</Btn>}
    </div>
    <div className="text-[12px] mb-3" style={{ color: SUB }}>New wire → pick who gets the money → tick the bills → it checks itself → 2 people sign → send it at the bank → attach the bank line → RTM proof.</div>
    {/* v55.83-RJ (review gaps 7, 15) — anything that would stop a wire, said up front */}
    {setup && (function () {
      var warnsS = [];
      if (!setup.sql_ok) { warnsS.push('The database is not ready for wires: ' + (setup.sql_error || 'run the wire SQL files') + '.'); }
      if (!(setup.parties || []).length) { warnsS.push('No paid-through companies (RTM Capital / NextTrade Industries) are set up.'); }
      Object.keys(setup.unknown_paid_via || {}).forEach(function (k) { warnsS.push(setup.unknown_paid_via[k] + ' open bill(s) say “paid through ' + k + '”, which is not a registered company — fix it on those bills in 💸 Bills, or they cannot go on a wire.'); });
      var signers = (setup.people && setup.people['wires.signoff']) || [];
      if (signers.filter(function (x) { return !x.broken; }).length < 2) { warnsS.push('Only ' + signers.filter(function (x) { return !x.broken; }).length + ' person can sign wires — two DIFFERENT people must sign. Turn on “Sign wires” for someone else in Settings → 🏦 Banking & Accounting Access.'); }
      if (!setup.ai_key_set) { warnsS.push('The AI review is not switched on (no AI key on the server) — signers will be asked to write what they checked.'); }
      if (!warnsS.length) { return null; }
      return <div className="rounded-lg p-2 mb-3" style={{ background: '#fef3c7', border: '1px solid #fcd34d' }}>
        <div className="text-[12px] font-extrabold mb-1" style={{ color: '#78350f' }}>Before your first wire:</div>
        {warnsS.map(function (w, i) { return <div key={i} className="text-[12px]" style={{ color: '#78350f' }}>• {w}</div>; })}</div>;
    })()}
    <div className="flex gap-1.5 flex-wrap mb-2">
      {[['open', 'In progress'], ['all', 'All'], ['complete', 'Done'], ['cancelled', 'Cancelled / undone']].map(function (k) {
        var n = (list || []).filter(function (p) { return k[0] === 'all' || (k[0] === 'open' ? OPEN_ST[p.status] : k[0] === 'cancelled' ? (p.status === 'cancelled' || p.status === 'reversed') : p.status === k[0]); }).length;
        return <button key={k[0]} onClick={function () { setFSt(k[0]); }} className="px-3 py-1.5 rounded-lg text-[12px] font-extrabold"
          style={fSt === k[0] ? { background: '#1e293b', color: '#ffffff' } : { background: '#f1f5f9', color: SUB }}>{k[1] + ' (' + n + ')'}</button>;
      })}
    </div>
    {!list ? <div className="text-[12px]" style={{ color: MUTED }}>Loading…</div> : rows.length === 0
      ? <div className="rounded-xl p-6 text-center" style={{ background: '#f8fafc', border: '1px dashed #cbd5e1' }}>
        <div className="text-[14px] font-extrabold mb-1" style={{ color: INK }}>{fSt === 'open' ? 'No wires in progress.' : 'Nothing here.'}</div>
        {perms.prepare ? <div className="text-[12px] mb-3" style={{ color: SUB }}>Click “＋ New wire” to prepare one.</div> : <div className="text-[12px]" style={{ color: SUB }}>Preparing a wire needs “Wires: Prepare”.</div>}
        {perms.prepare && <Btn big color="#0f766e" onClick={startNew}>＋ New wire</Btn>}</div>
      : <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid #e2e8f0' }}><table className="w-full text-[12px]">
        <thead><tr style={{ background: '#f1f5f9', color: SUB }}><th className="px-2 py-2 text-left">Wire</th><th className="px-2 py-2 text-left">To</th><th className="px-2 py-2 text-left">Vendors</th><th className="px-2 py-2 text-right">Amount</th><th className="px-2 py-2 text-left">Next step</th><th></th></tr></thead>
        <tbody style={{ color: INK }}>
          {rows.map(function (p) {
            return <tr key={p.id} onClick={function () { open(p.id); }} style={{ borderTop: '1px solid #f1f5f9', cursor: 'pointer' }}>
              <td className="px-2 py-2"><div className="font-mono font-extrabold">{p.label}</div><div className="text-[10px]" style={{ color: MUTED }}>{d16(p.created_at)}</div></td>
              <td className="px-2 py-2 font-bold">{p.payee_name}</td>
              <td className="px-2 py-2">{p.vendors.join(', ')}<span style={{ color: MUTED }}>{' · ' + p.bills + ' bill(s)'}</span></td>
              <td className="px-2 py-2 text-right tabular-nums font-extrabold">${fmt(p.total)}</td>
              <td className="px-2 py-2"><span className="px-2 py-1 rounded text-[11px] font-extrabold whitespace-nowrap" style={PST[p.status]}>{NEXT_WORDS[p.status]}</span></td>
              <td className="px-2 py-2 text-right font-extrabold" style={{ color: '#1d4ed8' }}>open →</td>
            </tr>;
          })}
        </tbody></table></div>}
  </div>;
}
