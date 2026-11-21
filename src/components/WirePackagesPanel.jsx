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
import React, { useState, useEffect, useRef } from 'react';
import { fillToAmount, fillVendors } from '../lib/wire-fill'; // v55.83-SC — build a wire for an amount
import { requestFit } from '../lib/wire-funding';
import { wireBillsToShow, groupByVendor, groupTotals, tickGroup } from '../lib/wire-bill-tree'; // v55.83-VK — the company's bills as a tree
import { requestCopyModel, requestCopyHtml } from '../lib/wire-request-print'; // v55.83-SQ — the two printable copies of a request // v55.83-SP — a request drawn from a transfer never goes over it
import { supabase } from '../lib/supabase';
import { todayET, fmtET } from '../lib/et-time';
import { applyConfirmationAnswer, startConfirmationFile, confirmationSendProblem } from '../lib/wire-confirmation';
import { PKG_STATUS_LABEL } from '../lib/wire-audit';
import { BILL_TYPES, BILL_TYPE_LABEL } from '../lib/bill-extract';
import BillLinesPanel, { PriceCheckBox } from './BillLinesPanel';
import { hubFetch } from '../lib/hub-fetch'; // v55.83-WQ — every accounting call carries the signed-in person's token
import WireInboxPanel from './WireInboxPanel'; // v55.83-XC — 📥 Bank confirmations

function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function d16(x) { return String(x || '').substring(0, 16).replace('T', ' '); }
// v55.83-WV (Codex 21 Nov) — ONE business date: today on the Hub's clock (Eastern, et-time.js), the SAME day the server checks "not in
// the future" against. toISOString() was the UTC day: after ~6 pm in Houston it was already tomorrow.
function localStamp(x) { return x ? fmtET(x, 'datetime') : ''; }
function localToday() { return todayET(); }
// the date "Sent on" starts from: the wire date when it is today or earlier, otherwise today
function sendDateFor(pkg) { var t = localToday(); var w = pkg && pkg.planned_send_date ? String(pkg.planned_send_date).substring(0, 10) : ''; return w && w <= t ? w : t; }
var INK = '#0f172a'; var SUB = '#334155'; var MUTED = '#64748b';
var PST = {
  needs_check: { background: '#e0e7ff', color: '#312e81' }, flagged: { background: '#fee2e2', color: '#7f1d1d' },
  awaiting_1st: { background: '#fef3c7', color: '#78350f' }, awaiting_2nd: { background: '#ffedd5', color: '#7c2d12' },
  ready_to_send: { background: '#d1fae5', color: '#065f46' }, sent: { background: '#dbeafe', color: '#1e3a8a' },
  awaiting_proof: { background: '#fae8ff', color: '#701a75' }, complete: { background: '#065f46', color: '#ffffff' }, cancelled: { background: '#e2e8f0', color: '#475569' },
  reversed: { background: '#e2e8f0', color: '#7f1d1d' },
};
// what the list says to do next, in plain words
// v55.83-RX (Max, Nov 9 23:41: "next step after both signatures...SEND TO RTM (if for RTM). SEND to NEXTRADE (if set up for
// nextrade) Send to Supplier/Vendor (if being sent directly)")
function sendWords(p) {
  if (!p) { return 'Send it'; }
  if (p.payee_kind === 'service_provider') { return 'Send to ' + (p.payee_name || 'RTM Capital'); }
  if (p.payee_kind === 'affiliate') { return 'Send to ' + (p.payee_name || 'NextTrade Industries'); }
  return 'Send to the vendor — ' + (p.payee_name || '?');
}
function sentWords(p) {
  if (!p) { return 'Sent'; }
  return 'Sent to ' + (p.payee_kind === 'vendor' ? 'the vendor' : (p.payee_name || '?'));
}
var PRE_WIRE = { needs_check: 1, flagged: 1, awaiting_1st: 1, awaiting_2nd: 1 }; // v55.83-SD — a wire nobody has fully approved yet: still the preparer's to change or delete
var NEXT_WORDS = {
  needs_check: 'Check it', flagged: 'Fix the problems', awaiting_1st: '1st person signs', awaiting_2nd: '2nd person signs',
  ready_to_send: 'Send it at the bank', sent: 'Attach the bank line', awaiting_proof: 'Add RTM proof', complete: 'Done', cancelled: '—', reversed: 'Undone',
};
// v55.83-RL — the wire's history in plain words (Max 12:18: "audit should include whatever ... was done")
var HIST_WORDS = {
  wire_bill_reviewed: '👁 opened and checked a bill', wire_package_deleted: '🗑 deleted the wire', wire_package_prepared: '➕ prepared the wire',
   wire_package_updated: '✏ changed the wire', wire_package_audit_run: '🤖 check ran',
  wire_check_overridden: '↷ overrode a check', wire_package_signoff_1: '✍ signed 1st', wire_package_signoff_2: '✍ signed 2nd (approved)',
  wire_package_sent: '📤 marked it sent', wire_package_attached: '🔗 attached the bank line', wire_package_rtm_proof: '📎 added RTM proof',
  bill_paid_via_set: '🏢 bills marked “paid through”', wire_package_cancelled: '✕ cancelled', wire_package_reversed: '↩ undid the wire', wire_package_mark_failed: '⚠ marking failed',
  wire_recorded_after_the_fact: '🕘 recorded a wire sent before the Hub had wires', wire_sent_date_changed: '📅 corrected the sent date', wire_date_changed: '📅 changed the wire date', wire_confirmation_read: '🔎 bank confirmation read' /* WV */, bank_line_filed_professional_fees: '🗂 bank line filed under professional fees', // v55.83-RZ
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
  FEE_NOT_ALLOWED: 'A wire straight to a vendor cannot carry a fee — remove it.', NO_BILLS: '✏ Change the wire and tick its bills.',
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
    {b.bill_type ? <div className="text-[10px] font-extrabold mb-0.5" style={{ color: '#7c2d12' }}>{BILL_TYPE_LABEL[b.bill_type] || b.bill_type}</div> : null}
    <div className="flex gap-1 items-center">{chip('inbound', '⬅ Inbound')}{chip('outbound', 'Outbound ➡')}{!dir && !p.releaseOptional ? <span className="text-[10px] font-bold" style={{ color: '#b91c1c' }}>tick one</span> : null}</div>
    {field('Release #', b.release_number, relD, setRelD, 'release_number', needRel)}
    {field('Reference', b.other_reference, refD, setRefD, 'other_reference', needRef)}
  </div>;
}

// v55.83-RO (Max, Nov 9 20:49: "validation needs to take place first before wiring ... you cannot pay a wire unless it has
// been validated") — validate a bill right where it is picked: the same 3 checks + HOW, the same audited record as 💸 Bills.
function ValidateInline(p) {
  var s1 = useState(false); var open = s1[0]; var setOpen = s1[1];
  var s2 = useState({ matches_records: false, goods_received: false, charges_accurate: false }); var ck = s2[0]; var setCk = s2[1];
  var s3 = useState(''); var how = s3[0]; var setHow = s3[1];
  var s4 = useState(''); var err = s4[0]; var setErr = s4[1];
  var s5 = useState(false); var busy = s5[0]; var setBusy = s5[1];
  var s6 = useState(p.dir === 'inbound' || p.dir === 'outbound' ? p.dir : ''); var dir = s6[0]; var setDir = s6[1]; // Max 20:54: in / out marked during validation
  var s7 = useState(BILL_TYPE_LABEL[p.btype] ? p.btype : ''); var btype = s7[0]; var setBtype = s7[1]; // Max 21:04: the TYPE too
  // v55.83-RV (review #3) — the same rules as 💸 Bills: the price check is shown, a flagged bill needs a written resolution,
  // and every entry is saved as it is made (type / direction on the bill, ticks / notes as a draft)
  var s8 = useState(null); var pc = s8[0]; var setPc = s8[1];
  var s9 = useState(''); var res = s9[0]; var setRes = s9[1];
  var s10 = useState(''); var savedTxt = s10[0]; var setSavedTxt = s10[1];
  var tRef = useRef(null);
  function post(body) {
    return hubFetch('/api/accounting/bills', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ user_id: p.userId }, body)) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'The server did not answer (HTTP ' + r.status + ').' }; }); })
      .catch(function (e) { return { ok: false, error: 'Could not reach the server (' + ((e && e.message) || 'network') + ').' }; });
  }
  function begin() {
    setOpen(true);
    post({ action: 'bill_lines', id: p.billId }).then(function (j) {
      if (!(j && j.ok)) { return; }
      setPc({ check: j.price_check, status: j.price_check_status, resolved: j.price_resolved_note });
      if (!dir && j.default_direction) { setDir(j.default_direction); setSavedTxt('Pre-picked ' + j.default_direction + ' (this vendor’s bills are always ' + j.default_direction + ') — click the other to change'); } // RW
      var dr = j.validation_draft || {};
      if (dr.checks) { setCk({ matches_records: dr.checks.matches_records === true, goods_received: dr.checks.goods_received === true, charges_accurate: dr.checks.charges_accurate === true }); }
      if (dr.notes) { setHow(dr.notes); } if (dr.price_resolution) { setRes(dr.price_resolution); }
      if (dr.at) { setSavedTxt('Picked up where ' + (dr.by_name || 'someone') + ' left off'); }
    });
  }
  if (!open) {
    return <div onClick={function (e) { e.stopPropagation(); }}><span className="text-[11px] font-extrabold" style={{ color: '#b91c1c' }}>⛔ not validated</span>
      {p.canValidate ? <button onClick={begin} className="ml-1 px-2 py-0.5 rounded text-[11px] font-extrabold" style={{ background: '#047857', color: '#ffffff' }}>✓ Validate now</button>
        : <span className="ml-1 text-[10px]" style={{ color: '#64748b' }}>— validated in 💸 Bills by someone with “Add / change bills”</span>}</div>;
  }
  var all3 = ck.matches_records && ck.goods_received && ck.charges_accurate;
  var flagged = !!(pc && pc.status === 'flagged' && !pc.resolved);
  function keep(patch, now) {
    var body = Object.assign({ action: 'save_validation_progress', id: p.billId, draft: { checks: patch.ck || ck, notes: patch.how != null ? patch.how : how, price_resolution: patch.res != null ? patch.res : res } }, patch.fields || {});
    if (tRef.current) { clearTimeout(tRef.current); }
    var go = function () { setSavedTxt('Saving…'); post(body).then(function (j) { setSavedTxt(j && j.ok ? '✓ Saved' : '⛔ Not saved: ' + ((j && j.error) || 'error')); }); };
    if (now) { go(); } else { tRef.current = setTimeout(go, 700); }
  }
  var missing = !btype ? 'pick the TYPE of bill' : !dir ? 'mark it Inbound or Outbound' : !all3 ? 'tick all three checks' : (how.trim().length < 10 ? 'write HOW you verified it (10+ characters)' : (flagged && res.trim().length < 10 ? 'write how the price issue was resolved (10+ characters)' : ''));
  function box(k, label) {
    return <label key={k} className="flex items-center gap-1.5 text-[11px] py-0.5" style={{ color: '#0f172a', cursor: 'pointer' }}>
      <input type="checkbox" checked={!!ck[k]} onChange={function (e) { var n = Object.assign({}, ck); n[k] = e.target.checked; setCk(n); setErr(''); keep({ ck: n }, true); }} style={{ width: 15, height: 15 }} />{label}</label>;
  }
  function save() {
    if (missing) { setErr('To validate: ' + missing + '.'); return; }
    if (tRef.current) { clearTimeout(tRef.current); }
    setBusy(true);
    post({ action: 'validate_bill', id: p.billId, checks: ck, notes: how, shipment_direction: dir, bill_type: btype, price_resolution: res })
      .then(function (j) {
        if (j && j.ok) { setOpen(false); if (p.onDone) { p.onDone(dir, btype); } }
        else { setErr((j && j.error) || 'Validation refused.'); if (j && j.price_flags) { setPc({ check: { status: 'flagged', flags: j.price_flags }, status: 'flagged' }); } }
      }).finally(function () { setBusy(false); });
  }
  return <div onClick={function (e) { e.stopPropagation(); }} className="rounded-lg p-2 mt-1" style={{ background: '#fffbeb', border: '1px solid #fcd34d', minWidth: 300 }}>
    <div className="text-[11px] font-extrabold mb-0.5" style={{ color: '#78350f' }}>Validate — only what you actually checked (audited with your name; saved as you go)</div>
    <div className="flex gap-1 my-1 flex-wrap">
      {BILL_TYPES.map(function (t) { var on = btype === t; return <button key={t} onClick={function () { setBtype(t); setErr(''); keep({ fields: { bill_type: t } }, true); }} className="px-2 py-1 rounded text-[11px] font-extrabold" style={{ background: on ? '#7c2d12' : '#ffffff', color: on ? '#ffffff' : '#7c2d12', border: '1px solid ' + (on ? '#7c2d12' : (btype ? '#cbd5e1' : '#f87171')) }}>{BILL_TYPE_LABEL[t]}</button>; })}
    </div>
    <div className="flex gap-1 my-1">
      {[['inbound', '⬅ Inbound'], ['outbound', 'Outbound ➡']].map(function (o) { var on = dir === o[0]; return <button key={o[0]} onClick={function () { setDir(o[0]); setErr(''); keep({ fields: { shipment_direction: o[0] } }, true); }} className="px-2 py-1 rounded text-[11px] font-extrabold" style={{ background: on ? '#1d4ed8' : '#ffffff', color: on ? '#ffffff' : '#1e3a8a', border: '1px solid ' + (on ? '#1d4ed8' : (dir ? '#cbd5e1' : '#f87171')) }}>{o[1]}</button>; })}
      <span className="text-[10px] self-center" style={{ color: '#78350f' }}>(required)</span>
    </div>
    {box('matches_records', 'Matches our records (PO / shipment / order)')}{box('goods_received', 'Goods or services were received')}{box('charges_accurate', 'Charges are accurate and legitimate')}
    <input value={how} onChange={function (e) { setHow(e.target.value); setErr(''); keep({ how: e.target.value }); }} placeholder="HOW did you verify it? (required)" className="w-full mt-1 px-1.5 py-1 rounded border text-[11px] nt-light" style={{ color: '#0f172a', background: '#ffffff', borderColor: how.trim().length < 10 ? '#f87171' : '#cbd5e1' }} />
    {pc && pc.status === 'flagged' && <div style={{ maxWidth: 900 }}><PriceCheckBox check={pc.check} status="flagged" resolved={pc.resolved} />
      {!pc.resolved && <input value={res} onChange={function (e) { setRes(e.target.value); setErr(''); keep({ res: e.target.value }); }} placeholder="How was the price issue resolved? (required)" className="w-full px-1.5 py-1 rounded border text-[11px] nt-light" style={{ color: '#0f172a', background: '#ffffff', borderColor: res.trim().length < 10 ? '#f87171' : '#cbd5e1' }} />}</div>}
    <div className="flex gap-1 mt-1 items-center">
      <button onClick={save} disabled={busy} title={missing ? 'Still needed: ' + missing : ''} className="px-2 py-1 rounded text-[11px] font-extrabold" style={{ background: missing ? '#94a3b8' : '#047857', color: '#ffffff' }}>{busy ? 'Saving…' : '✓ Mark validated'}</button>
      <button onClick={function () { setOpen(false); setErr(''); }} className="px-2 py-1 rounded text-[11px] font-bold" style={{ background: '#e2e8f0', color: '#334155' }}>close — finish later</button>
      {savedTxt && <span className="text-[10px] font-bold" style={{ color: /^⛔/.test(savedTxt) ? '#b91c1c' : '#065f46' }}>{savedTxt}</span>}
    </div>
    {err && <div className="mt-1 text-[11px] font-extrabold" style={{ color: '#b91c1c' }}>⛔ {err}</div>}
  </div>;
}

// v55.83-RY (Max, Nov 10 00:11: "should be able to view when you are signing off on a wire. you should be able to view each bill
// and close the bill as you check before you approve it and sign it") — the bill itself, opened from the wire: the document,
// every fact, its lines (cost + commission), its price check and who validated it; "✓ Checked — close" records it.
function BillReviewModal(p) {
  var l = p.line || {}; var b = l.bill || {};
  var s1 = useState(null); var docUrl = s1[0]; var setDocUrl = s1[1];
  var s2 = useState(''); var docErr = s2[0]; var setDocErr = s2[1];
  var s3 = useState(false); var busy = s3[0]; var setBusy = s3[1];
  useEffect(function () {
    if (!b.attachment_path) { return undefined; }
    var alive = true; var path = String(b.attachment_path); var priv = path.indexOf('pv/') === 0;
    supabase.storage.from(priv ? 'bills-private' : 'attachments').createSignedUrl(path, 3600).then(function (r) {
      if (!alive) { return; }
      var u = r && r.data && r.data.signedUrl;
      if (u) { setDocUrl(u); } // signed (private, 1 hour) links only — never a public link to a bill else { setDocErr('The bill document could not be opened (' + ((r && r.error && r.error.message) || 'no link') + ').'); }
    }).catch(function (e) { if (alive) { setDocErr('The bill document could not be opened (' + ((e && e.message) || 'error') + ').'); } });
    return function () { alive = false; };
  }, [b.attachment_path]); // eslint-disable-line
  function billsApi(payload) {
    return hubFetch('/api/accounting/bills', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ user_id: p.userId }, payload)) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'The server did not answer (HTTP ' + r.status + ').' }; }); })
      .catch(function (e) { return { ok: false, error: 'Could not reach the server (' + ((e && e.message) || 'network') + ').' }; });
  }
  var isPdf = /\.pdf($|\?)/i.test(String(b.attachment_path || ''));
  var before = l.other_payments || [];
  function fact(k, v, warn) { return <div className="flex gap-2 text-[12px] py-0.5" style={{ borderBottom: '1px solid #f1f5f9' }}><span className="w-36 shrink-0" style={{ color: MUTED }}>{k}</span><span className="font-bold" style={{ color: warn ? '#b91c1c' : INK }}>{v}</span></div>; }
  return <div onClick={p.onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '24px 12px', overflowY: 'auto' }}>
    <div onClick={function (e) { e.stopPropagation(); }} className="nt-paper rounded-2xl p-4" style={{ width: 'min(1250px, 100%)', border: '2px solid #4f46e5' }}>
      <div className="flex gap-2 items-center flex-wrap mb-3">
        <div className="text-[16px] font-extrabold" style={{ color: INK }}>{(b.vendor_name || '?') + ' · bill ' + (b.bill_number || '—') + ' · $' + fmt(l.amount) + ' on this wire'}</div>
        {p.reviewedByMe && <span className="px-2 py-1 rounded text-[11px] font-extrabold" style={{ background: '#dcfce7', color: '#14532d' }}>✓ you checked it</span>}
        <div className="flex-1" />
        {p.canReview && !p.reviewedByMe && <button disabled={busy} onClick={function () { setBusy(true); Promise.resolve(p.onReviewed()).finally(function () { setBusy(false); }); }} className="px-4 py-2 rounded-lg text-[13px] font-extrabold" style={{ background: '#047857', color: '#ffffff' }}>{busy ? 'Saving…' : '✓ I checked this bill — close'}</button>}
        <button onClick={p.onClose} className="px-3 py-2 rounded-lg text-[12px] font-extrabold" style={{ background: '#ffffff', color: SUB, border: '1px solid #cbd5e1' }}>✕ Close</button>
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)' }}>
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #e2e8f0', background: '#f8fafc', minHeight: 420 }}>
          {!b.attachment_path ? <div className="p-6 text-[13px] font-bold" style={{ color: '#b45309' }}>⚠ No document is attached to this bill — check it against the vendor’s bill outside the Hub, or attach it in 💸 Bills.</div>
            : docErr ? <div className="p-6 text-[13px] font-bold" style={{ color: '#b91c1c' }}>{docErr}</div>
            : !docUrl ? <div className="p-6 text-[12px]" style={{ color: MUTED }}>Loading the bill…</div>
            : isPdf ? <iframe title="bill" src={docUrl} style={{ width: '100%', height: 720, border: 0, background: '#ffffff' }} />
            : <img alt="bill" src={docUrl} style={{ width: '100%', display: 'block', background: '#ffffff' }} />}
          {docUrl && <div className="px-3 py-1.5 text-[11px]" style={{ borderTop: '1px solid #e2e8f0' }}><a href={docUrl} target="_blank" rel="noreferrer" className="underline font-bold" style={{ color: '#1d4ed8' }}>open the document in a new tab</a></div>}
        </div>
        <div>
          <div className="rounded-xl p-3 mb-2" style={{ border: '1px solid #e2e8f0', background: '#ffffff' }}>
            {fact('Vendor', b.vendor_name || '—')}{fact('Bill #', b.bill_number || 'missing', !b.bill_number)}{fact('Bill date', b.bill_date || 'missing', !b.bill_date)}{fact('Due', b.due_date || '—')}
            {fact('Type', BILL_TYPE_LABEL[b.bill_type] || 'not set', !b.bill_type)}{fact('In / Out', b.shipment_direction === 'inbound' ? '⬅ Inbound' : b.shipment_direction === 'outbound' ? 'Outbound ➡' : 'not set', !b.shipment_direction)}
            {fact('Release #', b.release_number || (b.shipment_direction === 'outbound' ? 'MISSING (outbound needs one)' : '—'), b.shipment_direction === 'outbound' && !b.release_number)}
            {fact('Reference', b.other_reference || (b.shipment_direction === 'inbound' ? 'MISSING (inbound needs one)' : '—'), b.shipment_direction === 'inbound' && !b.other_reference)}
            {fact('Bill total', '$' + fmt(b.total_amount))}{fact('Paid before', before.length ? before.map(function (o) { return '$' + fmt(o.amount) + ' ' + (o.paid_date || '') + ' (' + o.label + ')'; }).join('; ') : 'nothing', before.length > 0)}
            {fact('On this wire', '$' + fmt(l.amount))}{fact('Category', b.category ? String(b.category).replace(/_/g, ' ') : '—')}
            {fact('Validated', b.validation_status === 'validated' ? '✓ ' + String(b.validated_at || '').substring(0, 10) + (b.validation_notes ? ' — “' + b.validation_notes + '”' : '') : 'NOT validated', b.validation_status !== 'validated')}
            {b.notes ? fact('Notes', b.notes) : null}
          </div>
          <BillLinesPanel bill={b} api={billsApi} toast={p.toast} canManage={false} />
        </div>
      </div>
      {p.canReview && !p.reviewedByMe && <div className="mt-3 text-[11px]" style={{ color: MUTED }}>“✓ I checked this bill” is recorded with your name for this exact wire. If the wire changes, the bills must be checked again before signing.</div>}
    </div>
  </div>;
}

function Btn(p) {
  var col = p.color || '#1e293b';
  return <button onClick={p.onClick} disabled={p.disabled} title={p.title} className={'rounded-lg font-extrabold disabled:opacity-40 ' + (p.big ? 'px-4 py-2 text-[13px]' : 'px-3 py-1.5 text-[12px]')}
    style={p.light ? { background: '#ffffff', color: SUB, border: '1px solid #cbd5e1' } : { background: col, color: '#ffffff' }}>{p.children}</button>;
}

// v55.83-RZ (Max 00:20: "for those bills paid prior to this function — retroactively — we should be able to update the date of the
// wire and you will look for the actual wire that was sent for that set of bills ... and match them") — super admin only
function PastWireForm(p) {
  var past = p.past; var setPast = p.setPast; var payees = p.payees;
  function set(k, v) { var o = {}; o[k] = v; o.err = ''; setPast(Object.assign({}, past, o)); }
  var picksN = Object.keys(past.picks).length; var sum = 0; Object.keys(past.picks).forEach(function (k) { sum += Number(String(past.picks[k] || '').replace(/,/g, '')) || 0; });
  var vendorPicked = null; if (past.kind === 'vendor' && past.bills) { past.bills.forEach(function (b) { if (past.picks[b.id] != null && !vendorPicked) { vendorPicked = b.vendor_name; } }); }
  return <div className="rounded-xl p-3 mb-3" style={{ background: '#f8fafc', border: '2px solid #0f766e' }}>
    <div className="flex items-center gap-2 mb-1"><div className="text-[14px] font-extrabold" style={{ color: INK }}>🕘 Record a wire that was sent before the Hub had wires</div><div className="flex-1" /><Btn light onClick={function () { setPast(null); }}>Close</Btn></div>
    <div className="text-[12px] mb-2" style={{ color: SUB }}>First pick who actually paid the vendor. <b>A vendor directly</b>: we wired the vendor from our own bank — tick the bills and roughly when, and the Hub finds that money-out in the bank (a week either side; up to $100 more is accepted as an extra charge) and records the bills PAID. No signatures; your reason is kept in the history. <b>A company paid for us</b>: the vendor was paid by that company out of money we had already sent it, so our bank only shows the money we sent the company — you pick that transfer and tick the bills it covered.</div>
    <div className="text-[12px] font-extrabold mb-1" style={{ color: INK }}>1 · Who got the money?</div>
    <div className="flex gap-2 flex-wrap mb-2">
      <button onClick={function () { p.onPick('vendor', ''); }} className="rounded-lg px-3 py-2 text-[12px] font-extrabold" style={{ background: past.kind === 'vendor' ? '#0f766e' : '#ffffff', color: past.kind === 'vendor' ? '#ffffff' : INK, border: '1px solid #94a3b8' }}>🧾 A vendor directly<div className="text-[10px] font-bold" style={{ opacity: 0.85 }}>we wired the vendor from our own bank</div></button>
      {/* v55.83-SV (Max, Nov 16: "how to send a previous wire sent thru RTM? makes 0 sense") — the companies are choices again. They open the steps for
          bills a company paid FOR us out of money we had already sent it (two signatures) — never the no-signature past wire. */}
      {(payees.parties || []).map(function (x) {
        var k = x.kind === 'affiliate' ? 'affiliate' : 'service_provider';
        return <button key={x.name} onClick={function () { p.onParty(k, x.name); }} className="rounded-lg px-3 py-2 text-[12px] font-extrabold text-left" style={{ background: '#ffffff', color: INK, border: '1px solid #94a3b8' }}>{'🏢 ' + x.name + ' paid the vendors for us'}<div className="text-[10px] font-bold" style={{ color: SUB }}>{'out of money we had already sent to ' + x.name}</div></button>;
      })}
    </div>
    {past.kind && <div>
      <div className="text-[12px] font-extrabold mb-1" style={{ color: INK }}>2 · The bills that wire paid (change the amount for a part payment)</div>
      {!past.bills ? <div className="text-[12px]" style={{ color: MUTED }}>Loading the open bills…</div> : past.bills.length === 0 ? <div className="text-[12px]" style={{ color: SUB }}>No open bills for this choice.</div>
        : <div className="overflow-x-auto rounded-lg mb-2" style={{ border: '1px solid #e2e8f0', maxHeight: 320, overflowY: 'auto' }}><table className="w-full text-[12px]"><tbody style={{ color: INK }}>
          {past.bills.map(function (b) {
            var on = past.picks[b.id] != null; var off = (past.kind === 'vendor' && vendorPicked && b.vendor_name !== vendorPicked && !on);
            return <tr key={b.id} style={{ borderTop: '1px solid #f1f5f9', background: on ? '#ecfdf5' : '#ffffff', opacity: off ? 0.45 : 1 }}>
              <td className="px-2 py-1.5"><input type="checkbox" checked={on} disabled={off} onChange={function () { var pk = Object.assign({}, past.picks); if (on) { delete pk[b.id]; } else { pk[b.id] = String(b.open); } set('picks', pk); }} style={{ width: 16, height: 16 }} /></td>
              <td className="px-2 py-1.5 font-bold">{b.vendor_name}<div className="text-[10px]" style={{ color: MUTED }}>{'Bill ' + (b.bill_number || '—') + ' · ' + (b.bill_date || '') + (b.release_number ? ' · rel ' + b.release_number : '') + (b.on_package ? ' · ' + b.on_package + ' already — left for this wire: $' + fmt(b.open) : '')}</div></td>
              <td className="px-2 py-1.5 text-right tabular-nums" style={{ color: SUB }}>{'open $' + fmt(b.open)}</td>
              <td className="px-2 py-1.5 text-right">{on ? <input value={past.picks[b.id]} onChange={function (e) { var pk = Object.assign({}, past.picks); pk[b.id] = e.target.value; set('picks', pk); }} className={inp} style={Object.assign({ width: 110, textAlign: 'right' }, inpS)} /> : null}</td></tr>;
          })}</tbody></table></div>}
      <div className="text-[12px] font-extrabold mb-1" style={{ color: INK }}>{'3 · When and why' + (picksN ? ' — ' + picksN + ' bill(s), $' + fmt(sum) : '')}</div>
      <div className="flex gap-2 items-center flex-wrap">
        <label className="text-[12px] font-bold" style={{ color: SUB }}>Sent about <input type="date" value={past.date} onChange={function (e) { set('date', e.target.value); }} className={inp} style={inpS} /></label>
        <input value={past.ref} onChange={function (e) { set('ref', e.target.value); }} placeholder="bank wire reference (optional)" className={inp} style={Object.assign({ width: 200 }, inpS)} />
        <input value={past.reason} onChange={function (e) { set('reason', e.target.value); }} placeholder="what this was (e.g. June wire to RTM for these NexPac bills)" className={inp} style={Object.assign({ flex: '1 1 280px' }, inpS)} />
        <Btn big color="#0f766e" onClick={p.onSave} disabled={p.busy}>{p.busy ? 'Working…' : '🕘 Record it & find it in the bank'}</Btn>
      </div>
    </div>}
    {past.err && <div className="mt-2 rounded-lg px-3 py-2 text-[12px] font-extrabold" style={{ background: '#ffffff', color: '#b91c1c', border: '1px solid #fca5a5' }}>{'⛔ ' + past.err}</div>}
  </div>;
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
  var a8 = useState({ date: localToday(), ref: '', file: null, path: null, read: null, reading: false, typed: {} }); var sendF = a8[0]; var setSendF = a8[1];
  var a9 = useState(null); var cands = a9[0]; var setCands = a9[1];
  var a10 = useState(''); var ovr = a10[0]; var setOvr = a10[1];
  var a11 = useState({ ticks: {}, date: '', ref: '', file: null }); var proofF = a11[0]; var setProofF = a11[1];
  var a12 = useState(''); var q = a12[0]; var setQ = a12[1];
  var a13 = useState({}); var relDraft = a13[0]; var setRelDraft = a13[1];
  var a14 = useState(false); var showMore = a14[0]; var setShowMore = a14[1];
  var a15 = useState(null); var setup = a15[0]; var setSetup = a15[1];
  var a16 = useState({}); var ovrDraft = a16[0]; var setOvrDraft = a16[1];
  var a17 = useState(null); var delAsk = a17[0]; var setDelAsk = a17[1];
  var a19 = useState(null); var dateAsk = a19[0]; var setDateAsk = a19[1]; // RZ — correcting the sent date
  var a19w = useState(null); var wireDateAsk = a19w[0]; var setWireDateAsk = a19w[1]; // WV — changing the wire date of a wire not sent yet
  var a22 = useState(null); var vCopy = a22[0]; var setVCopy = a22[1];     // SQ — attaching the company's wire copy for one vendor
  var a21 = useState(null); var feeAsk = a21[0]; var setFeeAsk = a21[1];   // SP — changing the service fee of a sent request
  var a20 = useState(null); var past = a20[0]; var setPast = a20[1];         // RZ — recording a wire sent before the Hub had wires
  var a23 = useState(false); var inboxOpen = a23[0]; var setInboxOpen = a23[1]; // XC — the bank-confirmation inbox shown above the list
  var a18 = useState(null); var viewLine = a18[0]; var setViewLine = a18[1]; // RY — the bill opened from the wire // v55.83-RO — the delete / undo question, inline // v55.83-RL — reasons being typed, per check

  // v55.83-RJ (review gap 9) — every call returns an answer object; a timeout / non-JSON reply becomes a readable error, never a frozen screen
  function api(payload) {
    return hubFetch('/api/accounting/wire-packages', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ user_id: userProfile && userProfile.id }, payload)) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'The server did not answer properly (HTTP ' + r.status + '). Reload and check the wire list before trying again.' }; }); })
      .catch(function (e) { return { ok: false, error: 'Could not reach the server (' + ((e && e.message) || 'network') + ').' }; });
  }
  function load() { api({ action: 'list' }).then(function (j) { if (j && j.ok) { setList(j.packages || []); (j.auto_matched || []).forEach(function (m) { toast.success('🔗 ' + m.label + ' found in the bank — ' + m.bills_paid + ' bill(s) now PAID' + (m.bank_fee ? ' (extra charge $' + fmt(m.bank_fee) + ')' : '') + '.'); }); } else { setList([]); if (j && j.error) { toast.error(j.error); } } }).catch(function () { setList([]); }); }
  function open(id) {
    setBusy(true); setNote(''); setCands(null); setOvr(''); setRelDraft({}); setDelAsk(null); setDateAsk(null); setFeeAsk(null); setVCopy(null);
    api({ action: 'get', id: id }).then(function (j) {
      if (j && j.ok) { setDet(j); setEd(null); setProofF({ ticks: {}, date: '', ref: '', file: null }); setSendF({ pkgId: j.package.id, date: sendDateFor(j.package), ref: '', file: null, path: null, read: null, reading: false, typed: {} }); setWireDateAsk(null); if (j.package.raw_status === 'sent') { loadCands(id); } }
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
    var w = null; try { w = window.open('', '_blank'); } catch (eW) { w = null; } // RV (review #10) — opened inside the click
    supabase.storage.from('bills-private').createSignedUrl(path, 3600).then(function (r) {
      var u = r && r.data && r.data.signedUrl; if (u) { if (w) { w.location.href = u; } else { window.location.assign(u); } } else { if (w) { w.close(); } toast.error('Could not open the file.'); }
    });
  }
  // ── step 1 + 2: the new / change form
  function withPayees(fn) {
    if (payees) { fn(payees); return; }
    setBusy(true);
    api({ action: 'payees' }).then(function (j) { if (j && j.ok) { setPayees(j); fn(j); } else { toast.error((j && j.error) || 'Could not load who wires can go to.'); } }).finally(function () { setBusy(false); });
  }
  function startNew() { withPayees(function () { setDet(null); setQ(''); setEd({ id: null, kind: null, payee: '', fee: '', fee_note: '', memo: '', picks: {}, bills: null, fundId: null, fund: null, planned: '' }); }); }
  function startChange(existing) {
    withPayees(function () {
      var p = existing.package; var picks = {}; var info = {};
      existing.lines.forEach(function (l) { picks[l.bill_id] = String(l.amount); info[l.bill_id] = l; });
      setQ('');
      setEd({ id: p.id, kind: p.payee_kind, payee: p.payee_kind === 'vendor' ? '' : p.payee_name, fee: p.fee_amount ? String(p.fee_amount) : '', fee_note: p.fee_note || '', memo: p.memo || '', picks: picks, bills: null, lineInfo: info, fundId: p.funding_txn_id || null, fund: null, planned: p.planned_send_date || '' });
      loadBills(p.payee_kind, p.payee_kind === 'vendor' ? '' : p.payee_name, p.id);
      if (p.payee_kind !== 'vendor') { loadFunding(p.payee_kind, p.payee_name); }
    });
  }
  function pickPayee(kind, name) {
    setEd(Object.assign({}, ed, { kind: kind, payee: name, picks: {}, bills: null, fee: kind !== 'vendor' ? ed.fee : '', fillMsg: null, fillVendors: [], fundId: null, fund: null, onlyTheirs: undefined, shut: {} }));
    loadBills(kind, name, ed.id);
    if (kind !== 'vendor') { loadFunding(kind, name); }
  }
  // v55.83-SP — the transfers already sent to this company that still have money on them
  function loadFunding(kind, payee) {
    api({ action: 'funding_lines', payee_name: payee }).then(function (j) {
      setEd(function (e) {
        if (!e || e.kind !== kind || String(e.payee || '') !== String(payee || '')) { return e; }
        return Object.assign({}, e, { fund: (j && j.ok) ? (j.lines || []) : [], fundErr: (j && j.ok) ? '' : ((j && j.error) || 'Could not load the transfers.') });
      });
    });
  }
  function fundWaiting(x) { return !!x && x.status !== undefined && x.status !== null && x.confirmed !== true; } // v55.83-WF
  function fundLine() { return (ed && ed.fundId && (ed.fund || []).filter(function (x) { return x.id === ed.fundId; })[0]) || null; }
  function fillToLeft() {
    var fl = fundLine(); if (!fl) { return; }
    var f = fillToAmount(ed.bills || [], String(fl.remaining), { fee: ed.fee, vendors: ed.fillVendors || [] });
    if (!f.ok) { setEd(Object.assign({}, ed, { target: String(fl.remaining), fillMsg: { bad: true, text: f.error } })); return; }
    var text = f.count + ' bill(s) chosen, oldest due first — bills $' + fmt(f.bills_total) + (f.fee > 0 ? ' + service fee $' + fmt(f.fee) : '') + ' = $' + fmt(f.total) + ' of the $' + fmt(fl.remaining) + ' left on the transfer.'
      + (f.partial ? ' ' + f.partial.vendor_name + ' ' + (f.partial.bill_number || '') + ' is paid in part: $' + fmt(f.partial.paid) + ' of $' + fmt(f.partial.of) + '.' : '')
      + (f.short > 0.005 ? ' Not enough validated bills yet: $' + fmt(f.short) + ' stays on the transfer, waiting for bills (or raise the service fee to use it).' : '');
    setEd(Object.assign({}, ed, { target: String(fl.remaining), picks: f.picks, fillMsg: { bad: false, text: text } }));
  }
  function loadBills(kind, payee, pkgId) {
    api({ action: 'open_bills', payee_kind: kind, payee_name: payee, package_id: pkgId }).then(function (j) {
      var current = true;
      setEd(function (e) {
        if (!e || e.kind !== kind || String(e.payee || '') !== String(payee || '')) { current = false; return e; } // review gap 10
        return Object.assign({}, e, { bills: (j && j.ok) ? j.bills : [], waiting: (j && j.ok) ? (j.not_validated || []) : [] });
      });
      if (current && !(j && j.ok)) { toast.error((j && j.error) || 'Could not load the bills.'); }
    });
  }
  // v55.83-SC — "build a wire for a certain amount": the Hub ticks validated bills (oldest due first) and pays the last one in part
  function fillWire() {
    var fv = ed.fillVendors || [];
    if (ed.kind === 'vendor' && fv.length !== 1) { setEd(Object.assign({}, ed, { fillMsg: { bad: true, text: 'A wire straight to a vendor pays one vendor — choose exactly one vendor above.' } })); return; }
    var f = fillToAmount(ed.bills || [], ed.target, { fee: ed.kind !== 'vendor' ? ed.fee : 0, vendors: fv });
    if (!f.ok) { setEd(Object.assign({}, ed, { fillMsg: { bad: true, text: f.error } })); return; }
    var text = f.count + ' bill(s) chosen, oldest due first — bills $' + fmt(f.bills_total) + (f.fee > 0 ? ' + service fee $' + fmt(f.fee) : '') + ' = $' + fmt(f.total) + '.'
      + (f.partial ? ' ' + f.partial.vendor_name + ' ' + (f.partial.bill_number || '') + ' is paid in part: $' + fmt(f.partial.paid) + ' of $' + fmt(f.partial.of) + '.' : '')
      + (f.short > 0.005 ? ' There are not enough validated bills: $' + fmt(f.short) + ' short of the amount.' : '') + ' Change any tick or amount below before saving.';
    setEd(Object.assign({}, ed, { picks: f.picks, fillMsg: { bad: f.short > 0.005, text: text } }));
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
    var payload = { action: 'save_draft', id: ed.id, payee_kind: ed.kind, payee_name: ed.payee, fee_amount: ed.kind !== 'vendor' ? (Number(feeV) || 0) : 0, fee_note: ed.fee_note, memo: ed.memo, lines: lines };
    if (ed.planned || ed.id) { payload.planned_send_date = ed.planned || null; } // v55.83-WV — the wire date, for every wire (was requests only)
    if (ed.kind !== 'vendor') { // v55.83-SP — only sent when it applies, so ordinary wires are saved exactly as before
      if (ed.fundId || ed.id) { payload.funding_txn_id = ed.fundId || null; }
      var flS = fundLine();
      if (flS) { var sumS = 0; lines.forEach(function (l) { sumS += l.amount; }); var fitS = requestFit(flS.remaining, sumS, Number(feeV) || 0);
        if (!fitS.fits) { toast.error('This request is $' + fmt(fitS.total) + ' but only $' + fmt(flS.remaining) + ' is left on the transfer — $' + fmt(fitS.over_by) + ' too much. Lower a bill amount or the fee.'); return; } }
    }
    act(payload,
      function (j) { return j.audit ? (j.audit.pass ? '✅ Saved and checked — it is ready for the 1st signature.' : '⛔ Saved — the check found ' + j.audit.blocks + ' problem(s) to fix. See the red box.') : 'Saved.'; },
      function (j) { setEd(null); open(j.id); });
  }
  // ── wire actions
  function recheck() { return act({ action: 'run_check', id: det.package.id }, function (j) { return j.pass ? '✅ Check passed.' : '⛔ Still ' + j.blocks + ' problem(s).'; }); }
  function reviewBill(l) { // RY — "close the bill as you check"
    return api({ action: 'review_bill', id: det.package.id, bill_id: l.bill_id }).then(function (j) {
      if (j && j.ok) { toast.success('✓ Checked — ' + (j.left ? j.left + ' bill(s) left to check before you can sign.' : 'all bills checked. You can sign now.')); setViewLine(null); open(det.package.id); }
      else { toast.error((j && j.error) || 'Not recorded.'); }
    });
  }
  function sign() {
    var mine = (det.audit && det.audit.my_reviewed) || []; var left = det.lines.filter(function (l) { return mine.indexOf(l.bill_id) < 0; });
    if (left.length) { toast.error('Open and check every bill before you sign — ' + left.length + ' not checked yet (👁 Open & check, in the bills list below).'); return; }
    act({ action: 'signoff', id: det.package.id, note: note }, function (j) { return j.approved ? '✅ 2nd signature — APPROVED. It can be sent now.' : '✍ 1st signature recorded — now a DIFFERENT person signs.'; }).then(function () { setNote(''); }); }
  function sendIt() {
    var probS = confirmationSendProblem(sendF, det.package.id, localToday()); // v55.83-WV (Codex 09:09) — one rule set, tested in the library
    if (probS) { toast.error(probS); return; }
    setBusy(true);
    // v55.83-WV — the file read a moment ago is already uploaded: the same file is the proof (no second upload)
    // v55.83-XC — or the confirmation already attached to this wire from 📥 Bank confirmations (the server checks it belongs to this wire)
    var readyPath = sendF.path && sendF.pkgId === det.package.id && (sendF.path.indexOf('pv/wire-' + det.package.id + '-') === 0 || (sendF.file && sendF.file.inbox === true && sendF.path.indexOf('pv/wire-inbox-') === 0));
    (readyPath ? Promise.resolve({ path: sendF.path, name: sendF.file.name }) : upload(sendF.file, det.package.id)).then(function (u) {
      return act({ action: 'mark_sent', id: det.package.id, sent_date: sendF.date, bank_reference: sendF.ref, proof_path: u.path, proof_name: u.name }, '📤 Marked SENT. When the money-out shows in the bank feed, attach it here.');
    }).catch(function (e) { toast.error((e && e.message) || 'Upload failed.'); setBusy(false); });
  }
  // v55.83-WV (Max 21 Nov: "it should be able to read the pdf or screenshot to update the reference ... and the sent on dates") — the
  // confirmation is uploaded the moment it is picked, then READ: Reference and Sent on are filled unless the person typed them
  // already; what was read and anything that does not match this wire is shown. Nothing is saved until "Mark as sent".
  function pickConfirmation(file) {
    if (!file) { return; }
    var pkgId = det.package.id;
    var defDate = sendDateFor(det.package);
    setSendF(function (f0) { return startConfirmationFile(f0, file, pkgId, defDate); }); // v55.83-WV (Codex 09:09) — the previous file's filled values go
    upload(file, pkgId).then(function (u) {
      setSendF(function (f0) { return f0.file === file && f0.pkgId === pkgId ? Object.assign({}, f0, { path: u.path }) : f0; });
      return api({ action: 'read_confirmation', id: pkgId, proof_path: u.path });
    }).then(function (j) { setSendF(function (f0) { return applyConfirmationAnswer(f0, file, pkgId, j); }); })
      .catch(function (e) { setSendF(function (f0) { return applyConfirmationAnswer(f0, file, pkgId, { ok: false, error: (e && e.message) || 'Upload failed — try again.' }); }); });
  }
  // v55.83-XC — the bank confirmation attached to this wire from the inbox: used as the proof, with what the server read from it
  // (reference and Sent on filled the same way as a file picked here; anything the person typed stays)
  function takeInboxConfirmation() {
    var ic = det && det.inbox_confirmation; if (!ic) { return; }
    var pkgId = det.package.id; var pseudo = { name: ic.file_name || 'bank confirmation', inbox: true };
    setSendF(function (f0) {
      var s1 = Object.assign({}, startConfirmationFile(f0, pseudo, pkgId, sendDateFor(det.package)), { path: ic.path });
      return applyConfirmationAnswer(s1, pseudo, pkgId, ic.read ? { ok: true, read: ic.read, fill: ic.fill, warnings: ic.warnings || [] } : { ok: false, error: 'This confirmation could not be read — type the reference and pick the date yourself.' });
    });
  }
  // v55.83-WV (Max 21 Nov: "be able to edit that field in the previous wires i created") — the wire date of a wire not sent yet;
  // signatures stay valid (the date is not part of what was signed)
  function saveWireDate() {
    if (!wireDateAsk) { return; }
    act({ action: 'set_wire_date', id: det.package.id, wire_date: wireDateAsk.date || null, reason: wireDateAsk.reason || '' }, function (j) { return j.to ? '📅 Wire date set to ' + j.to + '.' : '📅 Wire date cleared.'; });
  }
  // v55.83-SP — a request drawn from a transfer: no bank confirmation (nothing leaves our bank); the bills are recorded paid on the transfer
  function sendRequest() {
    if (!sendF.date) { toast.error('Pick the date the request went to ' + det.package.payee_name + '.'); return; }
    act({ action: 'mark_sent', id: det.package.id, sent_date: sendF.date }, function (j) { return '📤 Request sent — ' + j.bills_paid + ' bill payment(s) recorded on the transfer, dated ' + j.paid_date + '. $' + fmt(j.left_on_transfer) + ' left on the transfer.'; });
  }
  // v55.83-SQ — print a copy of the request: for the company (vendor, bills, total) or ours (with the bill breakdown)
  function printCopy(kind) {
    var w = null; try { w = window.open('', '_blank'); } catch (eW) { w = null; }
    if (!w) { toast.error('The browser blocked the print window. Allow pop-ups for this site and press the button again.'); return; }
    var html = requestCopyHtml(requestCopyModel(det.package, det.lines, det.audit, kind, new Date().toISOString().substring(0, 16).replace('T', ' ')));
    w.document.open(); w.document.write(html); w.document.close();
    setTimeout(function () { try { w.focus(); w.print(); } catch (eP) { /* the page is open; the person can print from the browser */ } }, 300);
  }
  // v55.83-SQ — the company's wire copy for ONE vendor of the request
  function saveVendorCopy() {
    if (!vCopy.date) { setVCopy(Object.assign({}, vCopy, { err: 'The date ' + det.package.payee_name + ' wired the vendor is required.' })); return; }
    if (!vCopy.file) { setVCopy(Object.assign({}, vCopy, { err: 'Attach the copy of the wire (PDF or picture).' })); return; }
    setBusy(true);
    upload(vCopy.file, det.package.id).then(function (u) {
      return act({ action: 'rtm_proof', id: det.package.id, line_ids: vCopy.line_ids, paid_date: vCopy.date, reference: vCopy.refText || vCopy.ref, proof_path: u.path, proof_name: u.name }, function () { return '📎 Wire copy saved for ' + vCopy.vendor + ' (' + vCopy.ref + ').'; }, function () { setVCopy(null); open(det.package.id); });
    }).catch(function (e) { setBusy(false); setVCopy(function (v0) { return v0 ? Object.assign({}, v0, { err: (e && e.message) || 'The file could not be uploaded.' }) : v0; }); });
  }
  function saveFee() {
    if (String(feeAsk.reason || '').trim().length < 5) { setFeeAsk(Object.assign({}, feeAsk, { err: 'Say why the service fee changes (at least 5 characters).' })); return; }
    act({ action: 'change_fee', id: det.package.id, fee_amount: feeAsk.fee, reason: feeAsk.reason }, function (j) { return 'Service fee changed from $' + fmt(j.from) + ' to $' + fmt(j.to) + '. $' + fmt(j.left_on_transfer) + ' left on the transfer.'; },
      function () { setFeeAsk(null); open(det.package.id); }).then(function (j) { if (!(j && j.ok)) { setFeeAsk(function (f0) { return f0 ? Object.assign({}, f0, { err: (j && j.error) || 'Not saved.' }) : f0; }); } });
  }
  // v55.83-RZ — look in the bank feed now (the Hub also does this on every bank sync / statement import / opening Wires)
  function matchNow() {
    return act({ action: 'match_now', id: det.package.id }, function (j) {
      var r = j.result || {}; if (j.matched) { return '🔗 Found it in the bank — the bills are now PAID.'; }
      return (r.ambiguous || []).length ? 'Not matched by itself: ' + (r.ambiguous[0].why || 'more than one bank line fits') + '. Pick the right line below.' : 'Not in the bank feed yet. It is checked again on every bank sync (every 2 hours).';
    }, function () { open(det.package.id); });
  }
  function saveSentDate() {
    if (!dateAsk || !dateAsk.date) { setDateAsk(Object.assign({}, dateAsk, { err: 'Pick the date it was really sent.' })); return; }
    if (String(dateAsk.reason || '').trim().length < 5) { setDateAsk(Object.assign({}, dateAsk, { err: 'Say why the date changes (at least 5 characters).' })); return; }
    act({ action: 'set_sent_date', id: det.package.id, sent_date: dateAsk.date, reason: dateAsk.reason }, function (j) { return j.matched ? '📅 Date corrected — and the bank line was found: the bills are now PAID.' : '📅 Date corrected — looking around the new date.'; },
      function () { setDateAsk(null); open(det.package.id); }).then(function (j) { if (!(j && j.ok)) { setDateAsk(function (d0) { return d0 ? Object.assign({}, d0, { err: (j && j.error) || 'Not saved.' }) : d0; }); } });
  }
  // v55.83-SV — bills a company (RTM / NextTrade) already paid for us: the same request steps, opened with the company picked and explained in plain words
  function startPaidFor(kind, name) {
    setPast(null); setDet(null); setQ('');
    setEd({ id: null, kind: kind, payee: name, fee: '', fee_note: '', memo: '', picks: {}, bills: null, fundId: null, fund: null, planned: '', fillMsg: null, fillVendors: [], paidFor: true });
    loadBills(kind, name, null);
    loadFunding(kind, name);
  }
  function startPast() { withPayees(function () { setDet(null); setEd(null); setPast({ kind: null, payee: '', bills: null, picks: {}, date: '', ref: '', reason: '', err: '' }); }); }
  function pastPick(kind, name) {
    var nx = Object.assign({}, past, { kind: kind, payee: name, bills: null, picks: {}, err: '' }); setPast(nx);
    api({ action: 'open_bills', payee_kind: kind, payee_name: name, past: true }).then(function (j) {
      setPast(function (p0) { return p0 && p0.kind === kind && p0.payee === name ? Object.assign({}, p0, { bills: (j && j.ok) ? (j.bills || []) : [], err: (j && j.ok) ? '' : ((j && j.error) || 'Could not load the bills.') }) : p0; });
    });
  }
  function savePast() {
    var lines = []; var bad = null;
    Object.keys(past.picks).forEach(function (k) { var a = Number(String(past.picks[k] || '').replace(/,/g, '')); if (!(a > 0)) { bad = true; } else { lines.push({ bill_id: k, amount: Math.round(a * 100) / 100 }); } });
    var err = !lines.length ? 'Tick the bills that wire paid.' : bad ? 'Every ticked bill needs the amount the wire paid (a number like 1250.00).' : !past.date ? 'Pick the date the wire was sent (roughly is fine — the Hub looks a week either side).' : String(past.reason || '').trim().length < 10 ? 'Say what this wire was (at least 10 characters) — it is kept with the wire.' : '';
    if (err) { setPast(Object.assign({}, past, { err: err })); return; }
    setBusy(true);
    api({ action: 'record_past_wire', payee_kind: past.kind, payee_name: past.payee, lines: lines, sent_date: past.date, bank_reference: past.ref, reason: past.reason }).then(function (j) {
      if (j && j.ok) { toast.success(j.matched ? '🔗 ' + j.label + ' recorded and FOUND in the bank — the bills are now PAID.' : '🕘 ' + j.label + ' recorded as sent on ' + past.date + '. Not found in the bank feed yet — open it to pick the bank line or correct the date.'); setPast(null); load(); open(j.id); }
      else { setPast(function (p0) { return p0 ? Object.assign({}, p0, { err: (j && j.error) || 'Not recorded.' }) : p0; }); }
    }).finally(function () { setBusy(false); });
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
    var feeN = ed.kind !== 'vendor' ? (Number(String(ed.fee || '').replace(/,/g, '')) || 0) : 0; // v55.83-SC — RTM or NextTrade (Max Nov 12 09:40)
    var pickedVendor = null;
    if (ed.kind === 'vendor' && ed.bills) { ed.bills.forEach(function (b) { if (ed.picks[b.id] != null && !pickedVendor) { pickedVendor = b.vendor_name; } }); }
    var qq = q.trim().toLowerCase();
    var shown = (ed.bills || []).filter(function (b) { return !qq || [b.vendor_name, b.bill_number, b.release_number].join(' ').toLowerCase().indexOf(qq) >= 0; });
    var mineB = shown.filter(function (b) { return !b.needs_mark; }); var otherB = shown.filter(function (b) { return b.needs_mark; });
    // v55.83-VK (Max 19 Nov: "filter by nextrade if i am wiring to nextrade..using their bills only") — a wire to NextTrade lists
    // only NextTrade's bills to begin with; one press shows every open bill. A bill already ticked always stays in view.
    var onlyTheirs = ed.kind !== 'vendor' && (ed.onlyTheirs === undefined ? ed.kind === 'affiliate' : ed.onlyTheirs === true);
    var otherShown = ed.kind !== 'vendor' ? wireBillsToShow(otherB, ed.picks, onlyTheirs) : otherB;
    var mineT = groupTotals(mineB, ed.picks); var mineGroups = groupByVendor(mineB, ed.picks);
    var renderRow = function (b) {
      var on = ed.picks[b.id] != null;
      var notValid = b.validation_status !== 'validated'; // v55.83-RO — validate first, then wire
      var off = (ed.kind === 'vendor' && pickedVendor && b.vendor_name !== pickedVendor && !on) || (notValid && !on);
      return <tr key={b.id} onClick={function () { if (!off) { togglePick(b); } }} style={{ borderTop: '1px solid #e2e8f0', background: on ? '#ecfdf5' : '#ffffff', cursor: off ? 'not-allowed' : 'pointer', opacity: off ? 0.45 : 1 }}>
        <td className="px-2 py-2" style={{ width: 28 }}><input type="checkbox" readOnly checked={on} disabled={off} style={{ width: 18, height: 18 }} /></td>
        <td className="px-2 py-2"><div className="text-[13px] font-extrabold" style={{ color: INK }}>{b.vendor_name}</div>
          {notValid ? <ValidateInline billId={b.id} dir={b.shipment_direction} btype={b.bill_type} userId={userProfile && userProfile.id} canValidate={!!perms.bills} onDone={function (d, t) {
            toast.success('✓ ' + b.vendor_name + ' ' + (b.bill_number || '') + ' validated — you can tick it now.');
            setEd(function (e) { return (e && e.bills) ? Object.assign({}, e, { bills: e.bills.map(function (x) { return x.id === b.id ? Object.assign({}, x, { validation_status: 'validated', shipment_direction: d || x.shipment_direction, bill_type: t || x.bill_type }) : x; }) }) : e; });
          }} /> : <div className="text-[10px] font-extrabold" style={{ color: '#065f46' }}>✓ validated</div>}
          <div className="text-[11px]" style={{ color: MUTED }}>{'Bill ' + (b.bill_number || '—') + (b.due_date ? ' · due ' + b.due_date : b.bill_date ? ' · ' + b.bill_date : '')}{b.on_package ? ' · ' + b.on_package + ' already — left for this wire: $' + fmt(b.open) : ''}{b.disputed ? ' · DISPUTED' : ''}</div></td>
        <td className="px-2 py-2"><BillFields bill={b} editable={!!perms.prepare} busy={busy} releaseOptional={b.release_optional} onSave={function (field, value, done) { saveField(b.id, field, value, done); }} /></td>
        <td className="px-2 py-2 text-right text-[12px] tabular-nums" style={{ color: SUB }}>${fmt(b.open)}</td>
        <td className="px-2 py-2 text-right" onClick={function (e) { e.stopPropagation(); }}>{on ? <input value={ed.picks[b.id]} onChange={function (e) { var pk = Object.assign({}, ed.picks); pk[b.id] = e.target.value; setEd(Object.assign({}, ed, { picks: pk })); }}
          className="px-1.5 py-1 rounded border text-[12px] text-right nt-light" style={{ width: 100, color: INK, background: '#ffffff', borderColor: '#cbd5e1' }} /> : <span className="text-[11px]" style={{ color: MUTED }}>tick to pay</span>}</td>
      </tr>;
    };
    var head = <thead><tr style={{ background: '#f1f5f9', color: SUB }}><th></th><th className="px-2 py-1.5 text-left text-[11px]">Vendor · bill</th><th className="px-2 py-1.5 text-left text-[11px]">In / Out · Release # · Reference</th><th className="px-2 py-1.5 text-right text-[11px]">Still owed</th><th className="px-2 py-1.5 text-right text-[11px]">Pay now</th></tr></thead>;
    return <div className="nt-paper rounded-xl p-4" style={{ border: '2px solid #0f766e' }}>
      <div className="flex gap-2 items-center mb-3">
        <div className="text-[16px] font-extrabold" style={{ color: INK }}>{ed.id ? '✏ Change this wire' : (ed.paidFor ? '🏢 Bills ' + ed.payee + ' paid for us' : '＋ New wire')}</div>
        <div className="flex-1" />
        <Btn light onClick={function () { setEd(null); }}>✕ Close</Btn>
      </div>
      {ed.paidFor && <div className="rounded-xl p-3 mb-3 text-[12px]" style={{ background: '#eff6ff', color: '#1e3a8a', border: '1px solid #93c5fd' }}>
        <div className="font-extrabold mb-1">{'How this works — nothing is sent to the bank from here'}</div>
        <div>{'1. We sent ' + ed.payee + ' a lump of money. That is the only line our bank shows.'}</div>
        <div>{'2. ' + ed.payee + ' then paid our vendors out of that lump. Those payments are not in our bank.'}</div>
        <div>{'3. Below: pick the transfer (the lump), then tick the bills it paid. The total cannot be more than the lump, less the service fee.'}</div>
        <div>{'4. Two people sign. The bills are then marked PAID, dated the day the lump left our bank.'}</div>
        <div className="mt-1" style={{ color: '#1e40af' }}>{'If the transfer is not listed below: open All Transactions, find the money we sent ' + ed.payee + ', and mark that line as sent to ' + ed.payee + ' (the 🏢 button on the line). Then come back.'}</div>
      </div>}
      {/* step 1 */}
      <div className="text-[13px] font-extrabold mb-2" style={{ color: INK }}>1 · Who receives the money?</div>
      <div className="flex gap-2 flex-wrap mb-4">
        {(payees.parties || []).map(function (p) {
          var k = p.kind === 'affiliate' ? 'affiliate' : 'service_provider'; var on = ed.kind === k && ed.payee === p.name;
          return <button key={p.name} onClick={function () { pickPayee(k, p.name); }} className="rounded-xl px-4 py-3 text-left" style={{ minWidth: 200, background: on ? '#0f766e' : '#ffffff', color: on ? '#ffffff' : INK, border: '2px solid ' + (on ? '#0f766e' : '#cbd5e1') }}>
            <div className="text-[14px] font-extrabold">🏢 {p.name}</div><div className="text-[11px]" style={{ opacity: 0.85 }}>{k === 'affiliate' ? 'pays the vendors for us · optional service fee' : 'pays the vendors for us · optional service fee'}</div></button>;
        })}
        <button onClick={function () { pickPayee('vendor', ''); }} className="rounded-xl px-4 py-3 text-left" style={{ minWidth: 200, background: ed.kind === 'vendor' ? '#0f766e' : '#ffffff', color: ed.kind === 'vendor' ? '#ffffff' : INK, border: '2px solid ' + (ed.kind === 'vendor' ? '#0f766e' : '#cbd5e1') }}>
          <div className="text-[14px] font-extrabold">🧾 A vendor directly</div><div className="text-[11px]" style={{ opacity: 0.85 }}>we wire the vendor ourselves · one vendor</div></button>
      </div>
      {/* v55.83-SP — where the money comes from: a transfer already sent, or a new wire */}
      {ed.kind && ed.kind !== 'vendor' && <div className="rounded-xl p-3 mb-3" style={{ background: '#ffffff', border: '2px solid ' + (ed.fundId ? '#0f766e' : '#cbd5e1') }}>
        <div className="text-[13px] font-extrabold mb-1" style={{ color: INK }}>{ed.paidFor ? 'Which transfer paid these bills? (Where does the money come from?)' : 'Where does the money come from?'}</div>
        {!ed.fund ? <div className="text-[12px]" style={{ color: MUTED }}>{ed.fundErr ? '⛔ ' + ed.fundErr : 'Looking for transfers already sent to ' + ed.payee + '…'}</div> : <div>
          {ed.fund.length === 0 && <div className="text-[12px] mb-1" style={{ color: SUB }}>{'No transfer to ' + ed.payee + ' has money left on it. To use one, mark the bank line “sent to ' + ed.payee + '” in All Transactions — or continue below with a new wire.'}</div>}
          {ed.fund.length > 0 && <div className="text-[12px] mb-2 font-bold" style={{ color: '#92400e' }}>{'💰 ' + ed.fund.length + ' transfer(s) to ' + ed.payee + ' still have money waiting for bills. Pick one: the bills you tick are then paid OUT OF that transfer (the Hub calls this a request to ' + ed.payee + '). Nothing new leaves our bank.'}</div>}
          <div className="flex flex-col gap-1.5">
            {ed.fund.map(function (x) { var on = ed.fundId === x.id; var waitC = fundWaiting(x); // v55.83-WF: not confirmed = shown, not usable
              if (waitC) { return <div key={x.id} className="rounded-lg px-3 py-2 text-left" style={{ background: '#f1f5f9', color: MUTED, border: '2px dashed #cbd5e1' }}>
                <div className="flex gap-3 items-center flex-wrap text-[12px]"><span className="font-extrabold">{'○ ' + x.date + ' · transfer $' + fmt(x.amount)}</span>
                  <span className="font-extrabold" style={{ color: '#b45309' }}>{'⏳ not confirmed as funds held by ' + ed.payee + ' yet — confirm it in Bills → Funds with ' + ed.payee + ' before using it'}</span></div>
                <div className="text-[11px]">{String(x.name || '').substring(0, 90)}</div></div>; }
              return <button key={x.id} onClick={function () { setEd(Object.assign({}, ed, { fundId: on ? null : x.id, fillMsg: null })); }} className="rounded-lg px-3 py-2 text-left" style={{ background: on ? '#ecfdf5' : '#f8fafc', color: INK, border: '2px solid ' + (on ? '#0f766e' : '#e2e8f0') }}>
                <div className="flex gap-3 items-center flex-wrap text-[12px]">
                  <span className="font-extrabold">{(on ? '◉ ' : '○ ') + x.date + ' · transfer $' + fmt(x.amount)}</span>
                  <span style={{ color: SUB }}>{'already used $' + fmt(x.used) + (x.requests.length ? ' (' + x.requests.map(function (r) { return r.label; }).join(', ') + ')' : '')}</span>
                  <span className="font-extrabold" style={{ color: '#065f46' }}>{'left $' + fmt(x.remaining)}</span>
                  {x.planned > 0 && <span style={{ color: '#92400e' }}>{x.reserved !== undefined ? '· $' + fmt(x.reserved) + ' reserved on other requests not sent yet (already taken off “left”)' : '· $' + fmt(x.planned) + ' on requests not sent yet'}</span>}
                </div>
                <div className="text-[11px]" style={{ color: MUTED }}>{String(x.name || '').substring(0, 90)}</div></button>; })}
            <button onClick={function () { setEd(Object.assign({}, ed, { fundId: null, fillMsg: null })); }} className="rounded-lg px-3 py-2 text-left text-[12px] font-extrabold" style={{ background: !ed.fundId ? '#eff6ff' : '#f8fafc', color: INK, border: '2px solid ' + (!ed.fundId ? '#1d4ed8' : '#e2e8f0') }}>{(!ed.fundId ? '◉ ' : '○ ') + 'A new wire from our bank (not sent yet) — works as before'}</button>
          </div>
          {fundLine() && (function () { var fl = fundLine(); var fit = requestFit(fl.remaining, billsSum, feeN);
            return <div className="mt-2 rounded-lg p-2" style={{ background: fit.fits ? '#ecfdf5' : '#fef2f2', border: '1px solid ' + (fit.fits ? '#6ee7b7' : '#fca5a5') }}>
              <div className="flex gap-4 flex-wrap text-[12px] font-bold" style={{ color: INK }}>
                <span>{'Transfer $' + fmt(fl.amount)}</span><span>{'− already used $' + fmt(fl.used)}</span>
                <span>{'− this request $' + fmt(fit.total) + ' (bills $' + fmt(fit.bills) + ' + service fee $' + fmt(fit.fee) + ')'}</span>
                <span className="font-extrabold" style={{ color: fit.fits ? '#065f46' : '#b91c1c' }}>{fit.fits ? (fit.exact ? '= $0.00 left — the transfer is fully used ✓' : '= $' + fmt(fit.left_after) + ' left, waiting for bills') : '⛔ $' + fmt(fit.over_by) + ' more than the transfer — lower a bill amount or the fee'}</span>
              </div>
              <div className="flex gap-2 items-center flex-wrap mt-1.5">
                <Btn color="#0f766e" onClick={fillToLeft} disabled={busy || !ed.bills}>{'⚡ Fill to the $' + fmt(fl.remaining) + ' that is left'}</Btn>
                <span className="text-[11px]" style={{ color: SUB }}>Validated bills, oldest due first, the last one paid in part. The bills are recorded paid on {fl.date} — the day the money left our bank.</span>
              </div></div>; })()}
        </div>}
      </div>}
      {/* step 2 */}
      {ed.kind && ed.bills && <div className="rounded-xl p-3 mb-3" style={{ background: '#ffffff', border: '1px solid #cbd5e1' }}>
        <div className="flex gap-2 items-center flex-wrap">
          <div className="text-[13px] font-extrabold" style={{ color: INK }}>⚡ Build this wire for an amount</div>
          <span className="text-[13px] font-bold" style={{ color: SUB }}>$</span>
          <input value={ed.target || ''} onChange={function (e) { setEd(Object.assign({}, ed, { target: e.target.value, fillMsg: null })); }} placeholder="e.g. 25000" inputMode="decimal" className={inp} style={Object.assign({ width: 130 }, inpS)} />
          <Btn color="#0f766e" onClick={fillWire} disabled={busy}>Choose the bills for me</Btn>
          <span className="text-[11px]" style={{ color: SUB }}>Validated bills, oldest due first; the last one is paid in part to land on the amount{ed.kind !== 'vendor' ? ' (the service fee below counts toward it)' : ''}.</span>
        </div>
        {/* v55.83-SE (Max Nov 12 09:56: "we should choose the vendor or vendors in which we need to send the wire to") */}
        <div className="flex gap-2 items-center flex-wrap mt-2">
          <span className="text-[12px] font-bold" style={{ color: SUB }}>{ed.kind === 'vendor' ? 'For which vendor?' : 'For which vendors?'}</span>
          {ed.kind !== 'vendor' && <button onClick={function () { setEd(Object.assign({}, ed, { fillVendors: [], fillMsg: null })); }} className="rounded-full px-3 py-1 text-[12px] font-extrabold" style={!(ed.fillVendors || []).length ? { background: '#0f172a', color: '#ffffff', border: '1px solid #0f172a' } : { background: '#ffffff', color: INK, border: '1px solid #94a3b8' }}>All vendors</button>}
          {fillVendors(ed.bills).map(function (v) {
            var on = (ed.fillVendors || []).indexOf(v.vendor) >= 0;
            return <button key={v.vendor} onClick={function () {
              var cur = (ed.fillVendors || []).slice(); var ix = cur.indexOf(v.vendor);
              if (ed.kind === 'vendor') { cur = ix >= 0 ? [] : [v.vendor]; } else if (ix >= 0) { cur.splice(ix, 1); } else { cur.push(v.vendor); }
              setEd(Object.assign({}, ed, { fillVendors: cur, fillMsg: null }));
            }} className="rounded-full px-3 py-1 text-[12px] font-extrabold" style={on ? { background: '#0f766e', color: '#ffffff', border: '1px solid #0f766e' } : { background: '#ffffff', color: INK, border: '1px solid #94a3b8' }}>{(on ? '✓ ' : '') + v.vendor + ' · $' + fmt(v.open)}</button>;
          })}
          {fillVendors(ed.bills).length === 0 && <span className="text-[12px] font-bold" style={{ color: '#9a3412' }}>No validated open bills yet — validate them first (the list below shows what is waiting).</span>}
        </div>
        {ed.fillMsg && <div className="mt-2 rounded-lg px-3 py-2 text-[12px] font-bold" style={ed.fillMsg.bad ? { background: '#fef2f2', color: '#991b1b', border: '1px solid #fca5a5' } : { background: '#ecfdf5', color: '#065f46', border: '1px solid #6ee7b7' }}>{(ed.fillMsg.bad ? '⚠ ' : '✓ ') + ed.fillMsg.text}</div>}
      </div>}
      {ed.kind && <div className="rounded-lg px-3 py-2 mb-2 text-[12px] font-bold" style={{ background: '#fffbeb', border: '1px solid #fcd34d', color: '#78350f' }}>
        Only VALIDATED bills are listed here — a bill has to be validated (Inbound / Outbound, 3 checks, how you verified it) before it can be wired.
        {(ed.waiting || []).length > 0 && <span>{' '}<button onClick={function () { setEd(Object.assign({}, ed, { showWaiting: !ed.showWaiting })); }} className="underline font-extrabold" style={{ color: '#1d4ed8' }}>
          {(ed.showWaiting ? '▾ hide ' : '▸ ') + ed.waiting.length + ' open bill(s) waiting for validation'}</button></span>}
        {ed.showWaiting && (ed.waiting || []).length > 0 && <div className="mt-2 grid gap-1">
          {ed.waiting.map(function (b) {
            return <div key={b.id} className="rounded px-2 py-1.5 flex gap-2 items-start flex-wrap" style={{ background: '#ffffff', border: '1px solid #fde68a' }}>
              <div className="text-[12px]" style={{ color: INK, minWidth: 220 }}><b>{b.vendor_name}</b>{' · Bill ' + (b.bill_number || '—') + (b.bill_date ? ' · ' + b.bill_date : '') + ' · $' + fmt(b.open)}</div>
              <ValidateInline billId={b.id} dir={b.shipment_direction} btype={b.bill_type} userId={userProfile && userProfile.id} canValidate={!!perms.bills} onDone={function (d, t) {
                toast.success('✓ ' + b.vendor_name + ' ' + (b.bill_number || '') + ' validated — it is in the list now.');
                setEd(function (e) { if (!e) { return e; } var nb = Object.assign({}, b, { validation_status: 'validated', shipment_direction: d || b.shipment_direction, bill_type: t || b.bill_type });
                  return Object.assign({}, e, { bills: (e.bills || []).concat([nb]), waiting: (e.waiting || []).filter(function (x) { return x.id !== b.id; }) }); });
              }} />
            </div>;
          })}
        </div>}</div>}
      {ed.kind && <div>
        <div className="flex gap-2 items-center flex-wrap mb-2">
          <div className="text-[13px] font-extrabold" style={{ color: INK }}>2 · Tick the bills this wire pays</div>
          <input value={q} onChange={function (e) { setQ(e.target.value); }} placeholder="🔎 search vendor, bill # or release #" className={inp} style={Object.assign({ flex: '1 1 260px' }, inpS)} />
        </div>
        {ed.kind !== 'vendor' && ed.bills && <div className="flex gap-1 items-center flex-wrap mb-2">
          <span className="text-[11px] font-bold" style={{ color: SUB }}>Show:</span>
          <button type="button" onClick={function () { setEd(Object.assign({}, ed, { onlyTheirs: true })); }} className="px-2.5 py-1 rounded-lg text-[11px] font-extrabold" style={onlyTheirs ? { background: '#0f766e', color: '#ffffff' } : { background: '#f1f5f9', color: '#334155' }}>{'Only ' + ed.payee + '’s bills (' + mineB.length + ')'}</button>
          <button type="button" onClick={function () { setEd(Object.assign({}, ed, { onlyTheirs: false })); }} className="px-2.5 py-1 rounded-lg text-[11px] font-extrabold" style={!onlyTheirs ? { background: '#0f766e', color: '#ffffff' } : { background: '#f1f5f9', color: '#334155' }}>{'All open bills (' + (mineB.length + otherB.length) + ')'}</button>
        </div>}
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
            {/* v55.83-VK (Max 19 Nov) — the company's own bills as a tree: tick ALL, tick one vendor, or tick single bills */}
            {ed.kind !== 'vendor' && mineB.length > 0 && <tbody><tr style={{ background: '#ecfeff' }}>
              <td className="px-2 py-1.5" style={{ width: 28 }}><input type="checkbox" title={'Tick every validated bill paid through ' + ed.payee} checked={mineT.tickable > 0 && mineT.ticked >= mineT.tickable} disabled={!mineT.tickable} onChange={function () { setEd(Object.assign({}, ed, { picks: tickGroup(ed.picks, mineB, !(mineT.tickable > 0 && mineT.ticked >= mineT.tickable)) })); }} style={{ width: 18, height: 18 }} /></td>
              <td colSpan={2} className="px-2 py-1.5 text-[12px] font-extrabold" style={{ color: '#155e75' }}>{'Bills paid through ' + ed.payee + ' — ' + mineT.count + ' bill(s)' + (mineT.tickable < mineT.count ? ' · ' + (mineT.count - mineT.tickable) + ' not validated yet' : '')}<span className="font-normal" style={{ color: SUB }}>{' · tick here to pay them all'}</span></td>
              <td className="px-2 py-1.5 text-right text-[12px] font-extrabold tabular-nums" style={{ color: '#155e75' }}>${fmt(mineT.open)}</td>
              <td className="px-2 py-1.5 text-right text-[12px] font-extrabold tabular-nums" style={{ color: '#065f46' }}>{mineT.ticked ? mineT.ticked + ' ticked · $' + fmt(mineT.pay) : ''}</td></tr></tbody>}
            {head}
            {ed.kind === 'vendor' && <tbody>{shown.map(renderRow)}</tbody>}
            {ed.kind !== 'vendor' && mineGroups.map(function (g) {
              var shut = !!(ed.shut && ed.shut[g.vendor]); var allOn = g.tickable > 0 && g.ticked >= g.tickable;
              return <tbody key={'g-' + g.vendor}>
                {mineGroups.length > 1 && <tr style={{ background: '#f0fdfa', borderTop: '2px solid #99f6e4', cursor: 'pointer' }} onClick={function () { var sh = Object.assign({}, ed.shut || {}); sh[g.vendor] = !shut; setEd(Object.assign({}, ed, { shut: sh })); }}>
                  <td className="px-2 py-1.5" onClick={function (e) { e.stopPropagation(); }}><input type="checkbox" title={'Tick every validated bill of ' + g.vendor} checked={allOn} disabled={!g.tickable} onChange={function () { setEd(Object.assign({}, ed, { picks: tickGroup(ed.picks, g.bills, !allOn) })); }} style={{ width: 16, height: 16 }} /></td>
                  <td colSpan={2} className="px-2 py-1.5 text-[12px] font-extrabold" style={{ color: INK }}>{(shut ? '▸ ' : '▾ ') + g.vendor + ' — ' + g.count + ' bill(s)'}</td>
                  <td className="px-2 py-1.5 text-right text-[12px] font-bold tabular-nums" style={{ color: SUB }}>${fmt(g.open)}</td>
                  <td className="px-2 py-1.5 text-right text-[11px] font-bold tabular-nums" style={{ color: '#065f46' }}>{g.ticked ? g.ticked + ' ticked · $' + fmt(g.pay) : ''}</td></tr>}
                {!(shut && mineGroups.length > 1) && g.bills.map(renderRow)}
              </tbody>; })}
            {ed.kind !== 'vendor' && otherShown.length > 0 && <tbody><tr><td colSpan={5} className="px-2 py-1.5 text-[11px] font-extrabold" style={{ background: '#f8fafc', color: SUB }}>{onlyTheirs ? 'Other bills already ticked on this wire (' + otherShown.length + ')' : 'Other open bills (' + otherShown.length + ') — ticking one marks it “paid through ' + ed.payee + '”'}</td></tr>{otherShown.map(renderRow)}</tbody>}
            {ed.kind !== 'vendor' && onlyTheirs && mineB.length === 0 && otherShown.length === 0 && otherB.length > 0 && <tbody><tr><td colSpan={5} className="px-3 py-4 text-[12px]" style={{ color: MUTED }}>{(qq ? 'No bill paid through ' + ed.payee + ' matches “' + q + '”. ' : 'No open, validated bill is marked “paid through ' + ed.payee + '” yet. ') + 'Press “All open bills” above to see the other ' + otherB.length + '.'}</td></tr></tbody>}
            {shown.length === 0 && <tbody><tr><td colSpan={5} className="px-3 py-4 text-[12px]" style={{ color: MUTED }}>{qq ? 'Nothing matches “' + q + '”.' : 'No open bills. Add the bill in 💸 Bills first.'}</td></tr></tbody>}
          </table></div>}
        {/* step 3 */}
        <div className="rounded-xl p-3 flex gap-3 items-center flex-wrap" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
          <div className="text-[13px] font-extrabold" style={{ color: INK }}>3 · {picksN} bill(s) · ${fmt(billsSum)}</div>
          {ed.kind !== 'vendor' && <span className="flex gap-1 items-center"><span className="text-[12px] font-bold" style={{ color: SUB }}>+ {ed.payee} service fee (optional) $</span>
            <input value={ed.fee} onChange={function (e) { setEd(Object.assign({}, ed, { fee: e.target.value })); }} placeholder="0" className={inp} style={Object.assign({ width: 90 }, inpS)} />
            {feeN > 0 && <input value={ed.fee_note} onChange={function (e) { setEd(Object.assign({}, ed, { fee_note: e.target.value })); }} placeholder="what the fee is for" className={inp} style={Object.assign({ width: 170 }, inpS)} />}</span>}
          {/* v55.83-WV (Max 21 Nov) — the real date of the wire, which may not be today; any date (a wire already sent, or a plan) */}
          <label className="text-[12px] font-bold flex items-center gap-1" style={{ color: SUB }}>{ed.fundId ? '📅 Date funds used' : '📅 Wire date'}
            <input type="date" value={ed.planned || ''} onChange={function (e) { setEd(Object.assign({}, ed, { planned: e.target.value })); }} className={inp} style={inpS} />
            <span className="text-[11px] font-normal" style={{ color: MUTED }}>{(ed.planned ? '' : 'Optional — the day it was / will be sent. ') + 'A label only — nothing is sent or recorded paid on that date by itself.'}</span></label>
          <div className="flex-1" />
          <div className="text-[15px] font-extrabold" style={{ color: INK }}>{(ed.fundId ? 'This request: $' : 'Total to wire: $') + fmt(billsSum + feeN)}</div>
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
    var allValid = det.lines.every(function (l) { return (l.bill || {}).validation_status === 'validated'; });
    var steps = [['Bills validated', allValid], ['Prepared', true], ['Checked', st !== 'needs_check' && st !== 'flagged'], ['1st signature', !!(A.signoff1 && A.signoff1.valid)], ['2nd signature', !!(A.signoff2 && A.signoff2.valid)], [sentWords(P), !!P.sent], ['Bank line attached', !!P.attached]];
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
                <Btn color="#9a3412" disabled={busy} onClick={function () { if (String(od).trim().length < 10) { toast.error('Write why it is OK to pay anyway — at least 10 characters (kept with your name).'); var d0 = Object.assign({}, ovrDraft); d0[c.key + '__err'] = true; setOvrDraft(d0); return; } act({ action: 'override_check', id: P.id, check_key: c.key, reason: od }, function (j) { return j.pass ? '↷ Overridden — the wire can be signed now.' : '↷ Overridden — ' + j.blocks + ' problem(s) left.'; }).then(function () { var d = Object.assign({}, ovrDraft); delete d[c.key]; setOvrDraft(d); }); }}>↷ Override</Btn>
                <Btn light onClick={function () { var d = Object.assign({}, ovrDraft); delete d[c.key]; setOvrDraft(d); }}>cancel</Btn>
                {ovrDraft[c.key + '__err'] && String(od).trim().length < 10 && <div className="w-full text-[11px] font-extrabold" style={{ color: '#b91c1c' }}>⛔ Write why it is OK to pay anyway — at least 10 characters (review #13: the button no longer greys out silently).</div>}</div>)
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
            <Btn big color="#047857" onClick={sign} disabled={busy}>{'✍ I verified it — sign as ' + who}</Btn>
            {(function () { var mine = A.my_reviewed || []; var n = det.lines.filter(function (l) { return mine.indexOf(l.bill_id) >= 0; }).length; return <span className="text-[12px] font-extrabold" style={{ color: n === det.lines.length ? '#065f46' : '#b45309' }}>{n === det.lines.length ? '✓ You checked all ' + n + ' bill(s)' : '👁 You checked ' + n + ' of ' + det.lines.length + ' bills — open and check each one below before signing'}</span>; })()}</div>}</div>;
    } else if (st === 'ready_to_send' && P.funding_txn_id) {
      nextBox = <div><div className="mb-1 text-[15px] font-extrabold" style={{ color: '#065f46' }}>{'📤 Send this request to ' + P.payee_name + ' — $' + fmt(P.total)}</div>
        <div className="mb-2 font-bold" style={{ color: '#065f46' }}>{'Approved by ' + A.signoff1.name + ' and ' + A.signoff2.name + '. The money is already with ' + P.payee_name + (P.funding && P.funding.date ? ' (transfer of ' + P.funding.date + ')' : '') + ' — no wire leaves our bank. When you send, each bill’s payment is recorded against that transfer, dated ' + ((P.funding && P.funding.date) || 'the transfer date') + '.'}</div>
        {P.planned_send_date && <div className="mb-1 text-[12px]" style={{ color: SUB }}>{'Planned for ' + P.planned_send_date + ' (a label — it does not send by itself).'}</div>}
        {perms.send ? <div className="flex gap-2 items-center flex-wrap">
          <label className="text-[12px] font-bold" style={{ color: SUB }}>Request sent on <input type="date" value={sendF.date} max={localToday()} onChange={function (e) { setSendF(Object.assign({}, sendF, { date: e.target.value })); }} className={inp} style={inpS} /></label>
          <Btn big color="#1d4ed8" onClick={sendRequest} disabled={busy}>{'📤 Send request ' + P.label + ' to ' + P.payee_name}</Btn></div>
          : <div style={{ color: SUB }}>Waiting for someone with “Wires: Send”.</div>}</div>;
    } else if (st === 'ready_to_send') {
      nextBox = <div><div className="mb-1 text-[15px] font-extrabold" style={{ color: '#065f46' }}>{'📤 ' + sendWords(P) + ' — $' + fmt(P.total)}</div>
        <div className="mb-2 font-bold" style={{ color: '#065f46' }}>{'Approved by ' + A.signoff1.name + ' and ' + A.signoff2.name + '. Wire exactly $' + fmt(P.total) + ' to ' + P.payee_name + (P.payee_kind === 'vendor' ? ' (the vendor, directly)' : '') + ' from the bank, then fill this in:'}</div>
        {perms.send && det.inbox_confirmation && !(sendF.file && sendF.file.inbox) && <div className="mb-2"><Btn color="#0f766e" disabled={busy} onClick={takeInboxConfirmation}>{'📥 Use the confirmation from the inbox: ' + (det.inbox_confirmation.file_name || 'bank confirmation')}</Btn></div>}
        {perms.send ? <div className="flex gap-2 items-center flex-wrap">
          <label className="text-[12px] font-bold rounded-lg px-2 py-1.5" style={{ color: INK, background: '#f1f5f9', border: '1px dashed #94a3b8', cursor: 'pointer' }}>📎 {sendF.file ? sendF.file.name : '1 · Attach the bank confirmation (PDF / screenshot) — the Hub reads it'}
            <input type="file" accept="application/pdf,image/*" onChange={function (e) { var f1 = e.target.files && e.target.files[0]; e.target.value = ''; pickConfirmation(f1); }} style={{ display: 'none' }} /></label>
          <label className="text-[12px] font-bold" style={{ color: SUB }}>Sent on <input type="date" value={sendF.date} max={localToday()} onChange={function (e) { setSendF(Object.assign({}, sendF, { date: e.target.value, typed: Object.assign({}, sendF.typed, { date: true }) })); }} className={inp} style={inpS} /></label>
          <input value={sendF.ref} onChange={function (e) { setSendF(Object.assign({}, sendF, { ref: e.target.value, typed: Object.assign({}, sendF.typed, { ref: true }) })); }} placeholder="bank's wire reference #" className={inp} style={Object.assign({ width: 240 }, inpS)} />
          <Btn big color="#1d4ed8" onClick={sendIt} disabled={busy || sendF.reading}>{'📤 Mark as sent to ' + (P.payee_kind === 'vendor' ? 'the vendor' : P.payee_name)}</Btn></div>
          : <div style={{ color: SUB }}>Waiting for someone with “Wires: Send”.</div>}
        {/* v55.83-WV — what the Hub read from the bank's confirmation, and anything that does not match this wire */}
        {perms.send && sendF.reading && <div className="mt-2 text-[12px] font-bold" style={{ color: '#1d4ed8' }}>🔎 Reading the confirmation…</div>}
        {perms.send && sendF.read && sendF.read.error && <div className="mt-2 text-[12px] font-extrabold" style={{ color: '#b45309' }}>{'⚠ ' + sendF.read.error}</div>}
        {perms.send && sendF.read && sendF.read.read && <div className="mt-2 rounded-lg p-2 text-[12px]" style={{ background: (sendF.read.warnings || []).length ? '#fff7ed' : '#ecfdf5', border: '1px solid ' + ((sendF.read.warnings || []).length ? '#fdba74' : '#a7f3d0'), color: INK }}>
          <div className="font-extrabold mb-0.5">{'🔎 Read from the confirmation — check it before you press “Mark as sent”:'}</div>
          <div>{['Reference ' + (sendF.read.read.reference || '—') + (sendF.read.read.transaction_number ? ' · Transaction ' + sendF.read.read.transaction_number : ''), 'Wire date ' + (sendF.read.read.sent_date || '—'), 'Amount ' + (sendF.read.read.amount != null ? (sendF.read.read.currency ? sendF.read.read.currency + ' ' + fmt(sendF.read.read.amount) : fmt(sendF.read.read.amount) + ' (currency not shown — unverified)') : '—'), 'To ' + (sendF.read.read.beneficiary || '—'), sendF.read.read.status ? 'Status ' + sendF.read.read.status : null].filter(Boolean).join(' · ')}</div>
          {(sendF.read.warnings || []).map(function (w, i) { return <div key={i} className="font-bold" style={{ color: '#9a3412' }}>{'⚠ ' + w}</div>; })}
          {((sendF.typed && sendF.typed.date && sendF.read.fill && sendF.read.fill.sent_date && sendF.read.fill.sent_date !== sendF.date) || (sendF.typed && sendF.typed.ref && sendF.read.fill && sendF.read.fill.reference && sendF.read.fill.reference !== sendF.ref)) && <div className="mt-0.5" style={{ color: SUB }}>You typed your own value in a box, so it was kept. <button onClick={function () { setSendF(Object.assign({}, sendF, { date: sendF.read.fill.sent_date || sendF.date, ref: sendF.read.fill.reference || sendF.ref, typed: {}, filledFrom: sendF.file })); }} className="underline font-bold" style={{ color: '#1d4ed8' }}>Use what was read</button></div>}
        </div>}</div>;
    } else if (st === 'sent') {
      nextBox = <div><div className="mb-1" style={{ color: INK }}>{(P.sent.after_the_fact ? '🕘 Recorded after the fact — sent about ' : 'Sent ') + P.sent.date + ' (ref ' + P.sent.reference + '). The Hub looks for the $' + fmt(amountNow) + ' money-out in the bank feed by itself (every bank sync / statement import) — when exactly one wire-looking line fits, the bills become PAID automatically. You can always pick the line yourself below. A line up to $' + ((cands && cands.auto_fee_max) || 100) + ' more is accepted — the extra is ' + (P.payee_kind === 'vendor' ? 'booked with the bill it paid (that bill’s category — cost of goods by default).' : 'part of the ' + P.payee_name + ' line, filed under professional fees.')}</div>
        {P.sent.after_the_fact && P.sent.after_the_fact_note && <div className="text-[11px] mb-1" style={{ color: SUB }}>{'Why: “' + P.sent.after_the_fact_note + '”'}</div>}
        <div className="flex gap-2 items-center flex-wrap mb-2">
          {perms.send && <Btn color="#0f766e" onClick={matchNow} disabled={busy}>🔎 Look in the bank now</Btn>}
          {perms.send && !dateAsk && <Btn light onClick={function () { setDateAsk({ date: P.sent.date || '', reason: '', err: '' }); }}>📅 Wrong date? Change the sent date</Btn>}
        </div>
        {dateAsk && <div className="rounded-lg p-2 mb-2" style={{ background: '#eff6ff', border: '1px solid #93c5fd' }}>
          <div className="flex gap-2 items-center flex-wrap">
            <label className="text-[12px] font-bold" style={{ color: SUB }}>Really sent on <input type="date" value={dateAsk.date} onChange={function (e) { setDateAsk(Object.assign({}, dateAsk, { date: e.target.value, err: '' })); }} className={inp} style={inpS} /></label>
            <input value={dateAsk.reason} onChange={function (e) { setDateAsk(Object.assign({}, dateAsk, { reason: e.target.value, err: '' })); }} placeholder="why (e.g. the bank sent it on the 12th)" className={inp} style={Object.assign({ flex: '1 1 240px' }, inpS)} />
            <Btn color="#1d4ed8" onClick={saveSentDate} disabled={busy}>📅 Save date &amp; look again</Btn><Btn light onClick={function () { setDateAsk(null); }}>Cancel</Btn></div>
          {dateAsk.err && <div className="mt-1 text-[12px] font-extrabold" style={{ color: '#b91c1c' }}>{'⛔ ' + dateAsk.err}</div>}</div>}
        {cands && (cands.candidates || []).length > 1 && <div className="text-[12px] font-extrabold mb-1" style={{ color: '#9a3412' }}>{cands.candidates.length + ' bank lines could be this wire — the Hub never guesses. Pick the right one:'}</div>}
        {!cands ? <div style={{ color: MUTED }}>Looking in the bank feed…</div> : (cands.candidates || []).length === 0
          ? <div style={{ color: SUB }}>{cands.error || 'Not in the bank feed yet (searched 3 days before to 2 weeks after ' + P.sent.date + ').'} <button onClick={function () { loadCands(P.id); }} className="underline font-bold" style={{ color: '#1d4ed8' }}>look again</button></div>
          : <div>{cands.candidates.map(function (c) {
            return <div key={c.id} className="flex gap-2 items-center flex-wrap rounded-lg px-3 py-2 mb-1" style={{ background: c.exact ? '#ecfdf5' : '#fff7ed', border: '1px solid ' + (c.exact ? '#a7f3d0' : '#fed7aa'), color: INK }}>
              <span className="font-bold">{c.date}</span><span className="font-extrabold tabular-nums">−${fmt(c.amount)}</span><span className="flex-1">{c.name}</span>
              <span className="text-[11px] font-bold" style={{ color: c.exact ? '#065f46' : (c.amount - amountNow > 0 && c.amount - amountNow <= ((cands && cands.auto_fee_max) || 100) + 0.005) ? '#0e7490' : '#9a3412' }}>{c.exact ? 'exact amount' : (c.amount - amountNow > 0 && c.amount - amountNow <= ((cands && cands.auto_fee_max) || 100) + 0.005) ? '+$' + fmt(c.amount - amountNow) + ' extra charge (accepted)' : (c.amount - amountNow > 0 ? '+' : '') + fmt(c.amount - amountNow) + ' different — super admin only'}</span>
              {perms.send && <Btn color="#1d4ed8" onClick={function () { act({ action: 'attach', id: P.id, bank_transaction_id: c.id, override_note: c.exact ? '' : ovr }, function (j) { return '🔗 Attached — ' + j.bills_paid + ' bill(s) now recorded paid.'; }); }} disabled={busy}>🔗 This is it</Btn>}
            </div>;
          })}{cands.candidates.some(function (c) { return !c.exact && !(c.amount - amountNow > 0 && c.amount - amountNow <= ((cands && cands.auto_fee_max) || 100) + 0.005); }) && <input value={ovr} onChange={function (e) { setOvr(e.target.value); }} placeholder="if the amount is different — super admin only: why (bank fee, FX…)" className={inp} style={Object.assign({ width: '100%' }, inpS)} />}</div>}</div>;
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
      {PRE_WIRE[st] && <div className="rounded-lg px-3 py-2 mb-3 text-[12px] font-bold" style={{ background: '#f1f5f9', color: '#0f172a', border: '1px solid #cbd5e1' }}>
        📝 This is a PRE-WIRE — nothing has been approved or sent. {perms.prepare ? 'You can ✏ Change it (bills, amounts, fee, who gets it) or 🗑 Delete it; the bills go back to open.' : 'The preparer can still change or delete it.'} Changing it after a signature clears that signature.</div>}
      <div className="flex gap-2 items-center flex-wrap mb-3">
        <Btn light onClick={function () { setDet(null); }}>← All wires</Btn>
        <div className="text-[16px] font-extrabold" style={{ color: INK }}><span className="font-mono">{P.label}</span>{' · $' + fmt(amountNow) + ' to ' + P.payee_name}</div>
        {/* v55.83-SD (Max Nov 12 09:44: "after creating the wire from bills it is seen as a prewire status that can be cancelled or modified by the user") */}
        {PRE_WIRE[st] && <span className="px-2 py-1 rounded text-[11px] font-extrabold" style={{ background: '#0f172a', color: '#ffffff' }}>PRE-WIRE</span>}
        <span className="px-2 py-1 rounded text-[11px] font-extrabold" style={PST[st]}>{PKG_STATUS_LABEL[st]}</span>
        <div className="flex-1" />
        {perms.prepare && P.raw_status === 'draft' && <Btn light onClick={function () { startChange(det); }}>✏ Change</Btn>}
        {/* v55.83-RL (Max 12:17: "ability to delete the wire and everything return to previous state") */}
        {perms.prepare && P.raw_status === 'draft' && (st !== 'ready_to_send' || perms.superAdmin) && <Btn color="#b91c1c" onClick={function () { setDelAsk({ mode: 'erase', reason: '' }); }}>{st === 'ready_to_send' ? '🗑 Delete / cancel (super admin)' : '🗑 Delete wire'}</Btn>}
        {/* v55.83-RZ (Max 00:18 + "1 yes") — after both signatures only the super admin can delete or cancel it */}
        {P.raw_status === 'draft' && st === 'ready_to_send' && !perms.superAdmin && <span className="text-[10px] font-bold" style={{ color: MUTED }}>Both signatures are in — only the super admin can delete or cancel it now.</span>}
        {perms.undo && (P.raw_status === 'sent' || P.raw_status === 'attached') && <Btn color="#7f1d1d" onClick={function () { setDelAsk({ mode: 'undo', reason: '' }); }}>↩ Undo &amp; delete wire</Btn>}
        {!perms.undo && (P.raw_status === 'sent' || P.raw_status === 'attached') && <span className="text-[10px]" style={{ color: MUTED }}>A sent wire can be undone only by the super admin.</span>}
      </div>
      {/* v55.83-RO (Max 20:50: "i need to be able to delete a wire that is in progress") — asked right here, no pop-up */}
      {delAsk && <div className="rounded-xl p-3 mb-3" style={{ background: '#fee2e2', border: '2px solid #b91c1c' }}>
        <div className="text-[13px] font-extrabold mb-1" style={{ color: '#7f1d1d' }}>{delAsk.mode === 'erase' ? '🗑 Delete this wire? Its bills go back to how they were (nothing was paid). The history keeps a copy.' : '↩ Undo this SENT wire? The bill payments it recorded are voided, the bills go back to how they were, the bank line is freed. The wire stays on record as undone.'}</div>
        <div className="flex gap-2 items-center flex-wrap">
          {/* v55.83-RV (Max 22:47: "i cannot delete..it doesn't work") — the button was greyed out until a reason was typed and said
              nothing; now it always answers: what is missing, or the server's own reason, right here in the box */}
          <input autoFocus value={delAsk.reason} onChange={function (e) { setDelAsk(Object.assign({}, delAsk, { reason: e.target.value, err: '' })); }} placeholder={delAsk.mode === 'erase' ? 'Why is it being deleted? (required — e.g. made by mistake)' : 'Why is it being undone? (required — at least 10 characters)'} className={inp} style={Object.assign({ flex: '1 1 320px', borderColor: delAsk.err ? '#dc2626' : '#cbd5e1' }, inpS)} />
          <Btn big color="#b91c1c" disabled={busy} onClick={function () {
            var need = delAsk.mode === 'erase' ? 3 : 10;
            if (delAsk.reason.trim().length < need) { setDelAsk(Object.assign({}, delAsk, { err: 'Type why first (at least ' + need + ' characters) — it is kept with the wire’s history.' })); return; }
            var wasErase = delAsk.mode === 'erase'; var idD = P.id;
            act({ action: 'delete_wire', id: idD, reason: delAsk.reason }, wasErase ? '🗑 Wire deleted — everything is back to how it was.' : '↩ Wire undone — everything is back to how it was before it.',
              function () { setDelAsk(null); if (wasErase) { setDet(null); } else { open(idD); } })
              .then(function (j) { if (!(j && j.ok)) { setDelAsk(function (d0) { return d0 ? Object.assign({}, d0, { err: (j && j.error) || 'The wire was not deleted — the server did not say why.' }) : d0; }); } });
          }}>{busy ? 'Working…' : (delAsk.mode === 'erase' ? '🗑 Delete it' : '↩ Undo it')}</Btn>
          <Btn light onClick={function () { setDelAsk(null); }}>Keep it</Btn>
        </div>
        {delAsk.err && <div className="mt-2 rounded-lg px-3 py-2 text-[12px] font-extrabold" style={{ background: '#ffffff', color: '#b91c1c', border: '1px solid #fca5a5' }}>{'⛔ ' + delAsk.err}</div>}
      </div>}
      {viewLine && <BillReviewModal line={viewLine} userId={userProfile && userProfile.id} toast={toast}
        canReview={!!perms.signoff && P.raw_status === 'draft'} reviewedByMe={((A && A.my_reviewed) || []).indexOf(viewLine.bill_id) >= 0}
        onReviewed={function () { return reviewBill(viewLine); }} onClose={function () { setViewLine(null); }} />}
      {/* progress */}
      <div className="flex gap-1 flex-wrap mb-3">
        {steps.map(function (s0, i) {
          var cur = !s0[1] && (i === 0 || steps[i - 1][1]);
          return <div key={i} className="rounded-lg px-2 py-1 text-[11px] font-extrabold" style={s0[1] ? { background: '#d1fae5', color: '#065f46' } : cur ? { background: '#1e293b', color: '#ffffff' } : { background: '#f1f5f9', color: '#94a3b8' }}>{(s0[1] ? '✓ ' : (i + 1) + ' · ') + s0[0]}</div>;
        })}
      </div>
      {/* v55.83-WV (Max 21 Nov) — the two dates kept apart: when the wire was made in the Hub, and when it really went (per the bank) */}
      <div className="rounded-lg px-3 py-2 mb-3 flex gap-x-5 gap-y-1 items-center flex-wrap text-[12px]" style={{ background: '#ffffff', border: '1px solid #e2e8f0', color: INK }}>
        <span><span style={{ color: MUTED }}>Created in the Hub </span><b>{localStamp(P.created_at)}</b>{P.created_by ? <span style={{ color: MUTED }}>{' by ' + P.created_by}</span> : null}</span>
        {P.sent && P.sent.date ? <span><span style={{ color: MUTED }}>{P.funding_txn_id ? 'Date funds used ' : 'Sent (per the bank confirmation) '}</span><b>{P.sent.date}</b></span>
          : <span><span style={{ color: MUTED }}>{P.funding_txn_id ? 'Planned date funds used ' : 'Planned wire date '}</span><b>{P.planned_send_date || 'not set'}</b><span style={{ color: MUTED }}>{' · not marked sent yet'}</span>
            {P.raw_status === 'draft' && (perms.prepare || perms.send) && !wireDateAsk && <button onClick={function () { setWireDateAsk({ date: P.planned_send_date || '', reason: '' }); }} className="ml-2 underline font-bold" style={{ color: '#1d4ed8' }}>📅 Change</button>}</span>}
        {wireDateAsk && P.raw_status === 'draft' && <span className="flex gap-2 items-center flex-wrap">
          <input type="date" value={wireDateAsk.date} onChange={function (e) { setWireDateAsk(Object.assign({}, wireDateAsk, { date: e.target.value })); }} className={inp} style={inpS} />
          <input value={wireDateAsk.reason} onChange={function (e) { setWireDateAsk(Object.assign({}, wireDateAsk, { reason: e.target.value })); }} placeholder="why (optional)" className={inp} style={Object.assign({ width: 180 }, inpS)} />
          <Btn color="#1d4ed8" onClick={saveWireDate} disabled={busy}>Save date</Btn><Btn light onClick={function () { setWireDateAsk(null); }}>Cancel</Btn>
          {(A && (A.signoff1 || A.signoff2)) ? <span className="text-[11px]" style={{ color: MUTED }}>The signatures stay — the date is not part of what was signed.</span> : null}</span>}
      </div>
      {/* the ONE thing to do now */}
      <div className="rounded-xl p-3 mb-3 text-[13px]" style={{ background: '#f8fafc', border: '2px solid #1e293b' }}>
        <div className="text-[11px] font-extrabold mb-1" style={{ color: MUTED, letterSpacing: 1 }}>NEXT STEP</div>{nextBox}</div>

      {/* v55.83-SP — the transfer this request draws from, and the request vendor by vendor */}
      {P.funding_txn_id && <div className="rounded-xl p-3 mb-3" style={{ background: '#ffffff', border: '1px solid #cbd5e1' }}>
        <div className="text-[13px] font-extrabold mb-1" style={{ color: INK }}>{'💰 Request ' + P.label + ' — drawn from a transfer to ' + P.payee_name}</div>
        {!P.funding || P.funding.missing ? <div className="text-[12px] font-bold" style={{ color: '#b91c1c' }}>⛔ The transfer is no longer marked as sent to {P.payee_name}. Mark it again in All Transactions, or change this request.</div>
          : <div className="flex gap-4 flex-wrap text-[12px] font-bold" style={{ color: INK }}>
            <span>{'Transfer of ' + P.funding.date + ': $' + fmt(P.funding.amount)}</span>
            <span style={{ color: SUB }}>{'bills are recorded paid on ' + P.funding.date + (P.sent && P.sent.date ? ' · request sent ' + P.sent.date : (P.planned_send_date ? ' · planned for ' + P.planned_send_date : ''))}</span>
            <span style={{ color: SUB }}>{'bills paid from it $' + fmt(P.funding.bills) + ' · service fees $' + fmt(P.funding.fees)}</span>
            <span className="font-extrabold" style={{ color: P.funding.remaining > 0.005 ? '#92400e' : '#065f46' }}>{P.funding.remaining > 0.005 ? '$' + fmt(P.funding.remaining) + ' still unused — waiting for bills' : 'fully used ✓'}</span>
            {P.funding.fit && <span className="font-extrabold" style={{ color: P.funding.fit.fits ? '#065f46' : '#b91c1c' }}>{P.funding.fit.fits ? 'after this request: $' + fmt(P.funding.fit.left_after) + ' left' : '⛔ this request is $' + fmt(P.funding.fit.over_by) + ' more than what is left — change it'}</span>}
            {P.funding.other_requests.length > 0 && <span style={{ color: SUB }}>{'also on this transfer: ' + P.funding.other_requests.map(function (r) { return r.label + ' $' + fmt(r.total); }).join(', ')}</span>}
          </div>}
        {P.funding && (P.funding.currency_mismatch || []).length > 0 && <div className="mt-2 rounded-lg p-2 text-[12px] font-extrabold" style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fca5a5' }}>
          {'⚠ Currency does not match: the transfer is in ' + P.funding.currency + ' but ' + P.funding.currency_mismatch.map(function (c) { return c.vendor + ' ' + c.bill_number + ' is in ' + c.currency; }).join('; ') + '. Amounts are not converted — check before sending.'}</div>}
        <div className="mt-2 flex gap-2 flex-wrap items-center">
          <Btn light onClick={function () { printCopy('payee'); }}>{'🖨 Copy for ' + P.payee_name}</Btn>
          <Btn light onClick={function () { printCopy('ktc'); }}>🖨 Our copy (bill by bill)</Btn>
          <span className="text-[11px]" style={{ color: MUTED }}>{'Both carry ' + P.label + ' and a reference per vendor. ' + P.payee_name + '’s copy shows vendors, number of bills and totals only.'}</span>
        </div>
        {(P.by_vendor || []).length > 0 && <div className="overflow-x-auto rounded-lg mt-2" style={{ border: '1px solid #e2e8f0' }}><table className="w-full text-[12px]">
          <thead><tr style={{ background: '#f1f5f9', color: SUB }}><th className="px-2 py-1.5 text-left">Reference</th><th className="px-2 py-1.5 text-left">{'Vendor ' + P.payee_name + ' pays'}</th><th className="px-2 py-1.5 text-right">Bills</th><th className="px-2 py-1.5 text-right">Amount</th><th className="px-2 py-1.5 text-left">{P.payee_name + '’s wire copy'}</th></tr></thead>
          <tbody style={{ color: INK }}>
            {P.by_vendor.map(function (v) { return <tr key={v.ref} style={{ borderTop: '1px solid #e2e8f0' }}><td className="px-2 py-1.5 font-extrabold">{v.ref}</td><td className="px-2 py-1.5 font-bold">{v.vendor}{v.partial ? <span className="ml-1 text-[11px]" style={{ color: '#92400e' }}>{'(' + v.partial + ' paid in part)'}</span> : null}</td><td className="px-2 py-1.5 text-right">{v.bills}</td><td className="px-2 py-1.5 text-right font-bold">{'$' + fmt(v.amount)}</td>
              <td className="px-2 py-1.5">{P.raw_status !== 'attached' ? <span style={{ color: MUTED }}>after the request is sent</span> : <span className="flex gap-2 items-center flex-wrap">
                {(v.copies || []).map(function (c) { return <button key={c.id} onClick={function () { openFile(c.path); }} className="underline font-bold" style={{ color: '#1d4ed8' }}>{'📎 ' + (c.file_name || 'wire copy') + (c.paid_date ? ' · wired ' + c.paid_date : '')}</button>; })}
                {(v.waiting_line_ids || []).length === 0 ? <span className="font-extrabold" style={{ color: '#065f46' }}>✓ in</span>
                  : <span className="flex gap-2 items-center"><span className="font-extrabold" style={{ color: '#92400e' }}>{'⏳ waiting' + ((v.copies_in || 0) > 0 ? ' for ' + v.waiting_line_ids.length + ' of ' + v.bills + ' bills' : '')}</span>
                    <Btn light onClick={function () { setVCopy({ ref: v.ref, vendor: v.vendor, line_ids: v.waiting_line_ids, date: '', refText: '', file: null, err: '' }); }}>📎 Attach copy</Btn></span>}
              </span>}</td></tr>; })}
            <tr style={{ borderTop: '2px solid #cbd5e1', background: '#f8fafc' }}><td className="px-2 py-1.5 font-extrabold" colSpan={3}>{P.payee_name + ' service fee' + (P.fee_note ? ' (' + P.fee_note + ')' : '')}</td><td className="px-2 py-1.5 text-right font-bold">{'$' + fmt(P.fee_amount)}</td><td></td></tr>
            <tr style={{ background: '#f8fafc' }}><td className="px-2 py-1.5 font-extrabold" colSpan={3}>Request total</td><td className="px-2 py-1.5 text-right font-extrabold">{'$' + fmt(P.total)}</td><td></td></tr>
          </tbody></table></div>}
        {vCopy && <div className="rounded-lg p-2 mt-2" style={{ background: '#faf5ff', border: '1px solid #d8b4fe' }}>
          <div className="text-[12px] font-extrabold mb-1" style={{ color: INK }}>{'📎 ' + P.payee_name + '’s wire copy for ' + vCopy.vendor + ' — ' + vCopy.ref}</div>
          <div className="flex gap-2 items-center flex-wrap">
            <label className="text-[12px] font-bold" style={{ color: SUB }}>Wired on <input type="date" value={vCopy.date} onChange={function (e) { setVCopy(Object.assign({}, vCopy, { date: e.target.value, err: '' })); }} className={inp} style={inpS} /></label>
            <input value={vCopy.refText} onChange={function (e) { setVCopy(Object.assign({}, vCopy, { refText: e.target.value })); }} placeholder={'their wire reference (optional)'} className={inp} style={Object.assign({ width: 220 }, inpS)} />
            <label className="text-[12px] font-bold rounded-lg px-2 py-1.5" style={{ color: INK, background: '#f1f5f9', border: '1px dashed #94a3b8', cursor: 'pointer' }}>📎 {vCopy.file ? vCopy.file.name : 'the wire copy (PDF / picture)'}
              <input type="file" accept="application/pdf,image/*" onChange={function (e) { setVCopy(Object.assign({}, vCopy, { file: e.target.files && e.target.files[0], err: '' })); }} style={{ display: 'none' }} /></label>
            <Btn color="#7e22ce" onClick={saveVendorCopy} disabled={busy}>Save copy</Btn><Btn light onClick={function () { setVCopy(null); }}>Cancel</Btn></div>
          {vCopy.err && <div className="mt-1 text-[12px] font-extrabold" style={{ color: '#b91c1c' }}>{'⛔ ' + vCopy.err}</div>}</div>}
        {P.raw_status === 'attached' && perms.send && !feeAsk && <div className="mt-2"><Btn light onClick={function () { setFeeAsk({ fee: String(P.fee_amount || 0), reason: '', err: '' }); }}>✏ Change the service fee</Btn>
          {/* v55.83-SU (Max: "We can book it as a professional fee, or we can put it as remaining waiting for bills") */}
          {P.funding && !P.funding.missing && P.funding.remaining > 0.005 && <span> <Btn light onClick={function () { setFeeAsk({ fee: (Math.round(((Number(P.fee_amount) || 0) + P.funding.remaining) * 100) / 100).toFixed(2), reason: 'Book the unused $' + fmt(P.funding.remaining) + ' of the transfer as the service fee', err: '' }); }}>{'💰 Book the unused $' + fmt(P.funding.remaining) + ' as the service fee'}</Btn></span>}
          <span className="text-[11px]" style={{ color: MUTED }}> No new signatures — a reason is kept in the history.</span></div>}
        {feeAsk && <div className="rounded-lg p-2 mt-2" style={{ background: '#eff6ff', border: '1px solid #93c5fd' }}>
          <div className="flex gap-2 items-center flex-wrap">
            <label className="text-[12px] font-bold" style={{ color: SUB }}>Service fee $ <input value={feeAsk.fee} inputMode="decimal" onChange={function (e) { setFeeAsk(Object.assign({}, feeAsk, { fee: e.target.value, err: '' })); }} className={inp} style={Object.assign({ width: 110 }, inpS)} /></label>
            <input value={feeAsk.reason} onChange={function (e) { setFeeAsk(Object.assign({}, feeAsk, { reason: e.target.value, err: '' })); }} placeholder="why it changes" className={inp} style={Object.assign({ flex: '1 1 240px' }, inpS)} />
            <Btn color="#1d4ed8" onClick={saveFee} disabled={busy}>Save fee</Btn><Btn light onClick={function () { setFeeAsk(null); }}>Cancel</Btn></div>
          {P.funding && !P.funding.missing && <div className="mt-1 text-[11px]" style={{ color: SUB }}>{'Room on the transfer: the fee can be at most $' + fmt((Number(P.fee_amount) || 0) + Math.max(0, P.funding.remaining)) + '.'}</div>}
          {feeAsk.err && <div className="mt-1 text-[12px] font-extrabold" style={{ color: '#b91c1c' }}>{'⛔ ' + feeAsk.err}</div>}</div>}
      </div>}

      {/* the bills */}
      <div className="text-[13px] font-extrabold mb-1" style={{ color: INK }}>{'Bills on this wire (' + det.lines.length + ') · bills $' + fmt(P.bills_total) + (P.fee_amount > 0 ? ' + ' + P.payee_name + ' fee $' + fmt(P.fee_amount) + (P.fee_note ? ' (' + P.fee_note + ')' : '') : '')}</div>
      <div className="overflow-x-auto rounded-lg mb-3" style={{ border: '1px solid #e2e8f0' }}><table className="w-full text-[12px]">
        <thead><tr style={{ background: '#f1f5f9', color: SUB }}>
          {canTick ? <th className="px-2 py-1.5"></th> : null}
          <th className="px-2 py-1.5 text-left">Bill</th><th className="px-2 py-1.5 text-left">Vendor</th><th className="px-2 py-1.5 text-left">Bill #</th><th className="px-2 py-1.5 text-left">In / Out · Release # · Reference</th>
          <th className="px-2 py-1.5 text-left">Bill date</th><th className="px-2 py-1.5 text-left">Due</th><th className="px-2 py-1.5 text-left">Category</th>
          <th className="px-2 py-1.5 text-right">Bill total</th><th className="px-2 py-1.5 text-right">This wire</th><th className="px-2 py-1.5 text-left">Paid before</th>
          <th className="px-2 py-1.5 text-left">Notes</th>{P.paid_through ? <th className="px-2 py-1.5 text-left">{P.payee_name} proof</th> : null}</tr></thead>
        <tbody style={{ color: INK }}>
          {det.lines.map(function (l) {
            var b = l.bill || {}; var before = l.other_payments || [];
            var revs = ((A && A.reviews) || []).filter(function (r) { return r.bill_id === l.bill_id; }); var mineRv = revs.some(function (r) { return r.me; });
            return <tr key={l.line_id} style={{ borderTop: '1px solid #f1f5f9', verticalAlign: 'top' }}>
              {canTick ? <td className="px-2 py-1.5">{!l.rtm.confirmed_at ? <input type="checkbox" style={{ width: 16, height: 16 }} checked={!!proofF.ticks[l.line_id]} onChange={function (e) { var t2 = Object.assign({}, proofF.ticks); t2[l.line_id] = e.target.checked; setProofF(Object.assign({}, proofF, { ticks: t2 })); }} /> : '✓'}</td> : null}
              <td className="px-2 py-1.5 whitespace-nowrap"><button onClick={function () { setViewLine(l); }} className="px-2 py-1 rounded-lg text-[11px] font-extrabold" style={mineRv ? { background: '#dcfce7', color: '#14532d', border: '1px solid #86efac' } : { background: '#4f46e5', color: '#ffffff' }}>{mineRv ? '✓ Checked · view' : '👁 Open & check'}</button>
                {revs.length > 0 && <div className="text-[10px] mt-0.5" style={{ color: MUTED }}>{'checked by ' + revs.map(function (r) { return r.by; }).filter(function (x, i, a) { return a.indexOf(x) === i; }).join(', ')}</div>}</td>
              <td className="px-2 py-1.5 font-bold">{b.vendor_name || '?'}{b.validation_status !== 'validated' && P.raw_status === 'draft' ? <ValidateInline billId={l.bill_id} dir={b.shipment_direction} btype={b.bill_type} userId={userProfile && userProfile.id} canValidate={!!perms.bills} onDone={function () { toast.success('✓ Validated.'); recheck(); }} /> : null}{l.will_mark && P.raw_status === 'draft' ? <div className="text-[10px] font-bold" style={{ color: '#0e7490' }}>{'becomes “paid through ' + P.payee_name + '” when sent'}</div> : null}</td><td className="px-2 py-1.5">{b.bill_number || '—'}</td>
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
        {P.attached && <div className="text-[12px]" style={{ color: INK }}>{'🔗 Bank line ' + (P.attached.bank ? P.attached.bank.date + ' −$' + fmt(P.attached.bank.amount) + ' ' + P.attached.bank.name : '') + (P.attached.auto ? ' · matched automatically by the Hub' : ' · attached by ' + P.attached.by) + (P.attached.bank_fee > 0 ? ' · extra charge $' + fmt(P.attached.bank_fee) + (P.payee_kind === 'vendor' ? ' (booked with the bill)' : ' (in the professional-fees line)') : P.attached.note ? ' · amount difference accepted: “' + P.attached.note + '”' : '')}</div>}
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
            if (h.action === 'wire_sent_date_changed') { extra = (d0.from || '?') + ' → ' + d0.to + ' — “' + (d0.reason || '') + '”'; } // RZ
            if (h.action === 'wire_date_changed') { extra = (d0.from || 'none') + ' → ' + (d0.to || 'none') + (d0.reason ? ' — “' + d0.reason + '”' : ''); } // WV
            if (h.action === 'wire_package_sent' && d0.server_read) { extra += (d0.date_as_read === false ? ' · sent date typed over the one read (' + d0.server_read.sent_date + ')' : (d0.date_as_read ? ' · sent date as read from the bank confirmation' : ' · bank confirmation read')) + (d0.reference_as_read === false ? ' · reference typed over the one read' : ''); } // WV
            if (h.action === 'wire_package_attached' && d0.matched) { extra = d0.matched + (d0.bank_fee ? ' · extra charge $' + fmt(d0.bank_fee) : ''); } // RZ
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
      <Btn light={!inboxOpen} color="#1e293b" onClick={function () { setInboxOpen(!inboxOpen); }}>{inboxOpen ? '✕ Close bank confirmations' : '📥 Bank confirmations'}</Btn>
      {perms.superAdmin && <Btn light onClick={startPast} disabled={busy}>🕘 Record a past wire</Btn>}
      {perms.prepare && <Btn big color="#0f766e" onClick={startNew} disabled={busy}>＋ New wire</Btn>}
    </div>
    {inboxOpen && <div className="mb-3"><WireInboxPanel api={function (pl) { return api(pl).then(function (j) { if (j && j.ok && (pl.action === 'inbox_link' || pl.action === 'inbox_dismiss')) { load(); } return j; }); }} toast={toast} supabase={supabase} perms={perms} /></div>}
    {past && payees && <PastWireForm past={past} setPast={setPast} payees={payees} busy={busy} onPick={pastPick} onParty={startPaidFor} onSave={savePast} />}
    <div className="text-[12px] mb-3" style={{ color: SUB }}><b>Paying a vendor now:</b> ＋ New wire → pick who gets the money → tick the bills → it checks itself → 2 people sign → send it at the bank → attach the bank line. <b>Already paid, before the Hub had wires:</b> 🕘 Record a past wire → pick who paid (us, or a company that paid for us).</div>
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
        <thead><tr style={{ background: '#f1f5f9', color: SUB }}><th className="px-2 py-2 text-left">Wire</th><th className="px-2 py-2 text-left whitespace-nowrap">Created in the Hub</th><th className="px-2 py-2 text-left whitespace-nowrap" title="The date the wire was sent, as confirmed when it was marked sent. Not sent yet: the planned wire date, in grey.">Sent (bank confirmation)</th><th className="px-2 py-2 text-left">To</th><th className="px-2 py-2 text-left">Vendors</th><th className="px-2 py-2 text-right">Amount</th><th className="px-2 py-2 text-left">Next step</th><th></th></tr></thead>
        <tbody style={{ color: INK }}>
          {rows.map(function (p) {
            return <tr key={p.id} onClick={function () { open(p.id); }} style={{ borderTop: '1px solid #f1f5f9', cursor: 'pointer' }}>
              <td className="px-2 py-2"><div className="font-mono font-extrabold">{p.label}</div></td>
              {/* v55.83-WV (Max 21 Nov: "a column ... wire creation (in system) and a column when it was actually sent from the confirmation") */}
              <td className="px-2 py-2 whitespace-nowrap tabular-nums" style={{ color: SUB }}>{localStamp(p.created_at)}</td>
              <td className="px-2 py-2 whitespace-nowrap tabular-nums">{p.sent_date ? <b>{p.sent_date}</b> : (p.planned_send_date ? <span style={{ color: MUTED }} title="Not marked sent yet — this is the planned wire date, not proof the money left">{'planned ' + p.planned_send_date + ' · not sent'}</span> : <span style={{ color: MUTED }}>not sent</span>)}</td>
              <td className="px-2 py-2 font-bold">{p.payee_name}</td>
              <td className="px-2 py-2">{p.vendors.join(', ')}<span style={{ color: MUTED }}>{' · ' + p.bills + ' bill(s)'}</span></td>
              <td className="px-2 py-2 text-right tabular-nums font-extrabold">${fmt(p.total)}</td>
              <td className="px-2 py-2"><span className="px-2 py-1 rounded text-[11px] font-extrabold whitespace-nowrap" style={PST[p.status]}>{(PRE_WIRE[p.status] ? 'PRE-WIRE · ' : '') + (p.status === 'ready_to_send' ? sendWords(p) : NEXT_WORDS[p.status])}</span></td>
              <td className="px-2 py-2 text-right font-extrabold whitespace-nowrap" style={{ color: '#1d4ed8' }}>
                {perms.prepare && OPEN_ST[p.status] && p.status !== 'sent' && p.status !== 'awaiting_proof' && (p.status !== 'ready_to_send' || perms.superAdmin) ? <button onClick={function (e) { e.stopPropagation(); open(p.id); setDelAsk({ mode: 'erase', reason: '' }); }} title="Delete this wire (not sent yet)" className="mr-2 px-1.5 py-0.5 rounded text-[11px] font-extrabold" style={{ background: '#fee2e2', color: '#b91c1c' }}>🗑</button> : null}
                open →</td>
            </tr>;
          })}
        </tbody></table></div>}
  </div>;
}
