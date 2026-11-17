'use client';
// v55.83-TX — Accounting → 💸 Bills: NextTrade / RTM ADVANCES and extra fees (Max, Nov 17 2026).
// The strip (always on the Bills screen) shows each company's advance balance. "💼 Advances & fees" opens the panel:
//   • Split a payment already sent to them → extra professional fee and / or advance (the rest stays as bills)
//   • Use part of the advance to pay one of their bills
//   • Turn part of the advance into a fee, or a fee back into advance — with a reason
// Nothing is automatic; every move is a new entry with who / when / why (the original is never erased), and the database
// refuses anything that would take a balance below zero. Inline colours on white panels.
import React, { useState, useEffect } from 'react';
import { hubFetch } from '../lib/hub-fetch';
import { KIND_WORDS } from '../lib/party-money';

function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function newId() { try { if (typeof crypto !== 'undefined' && crypto.randomUUID) { return crypto.randomUUID(); } } catch (e) { /* older browser */ } return 'r' + Date.now().toString(36) + Math.random().toString(36).substring(2, 12); }
var inp = 'px-2 py-1 rounded border text-[11px] nt-light'; // v55.83-UA — nt-light: dark text on white even under the dark theme (globals.css)
var inpS = { background: '#ffffff', color: '#0f172a', borderColor: '#cbd5e1' };

export default function AdvancesPanel(props) {
  var userProfile = props.userProfile;
  var toast = props.toast || { success: function () {}, error: function () {} };
  var s1 = useState(null); var data = s1[0]; var setData = s1[1];
  var s2 = useState(false); var open = s2[0]; var setOpen = s2[1];
  var s3 = useState(false); var busy = s3[0]; var setBusy = s3[1];
  var s4 = useState(null); var form = s4[0]; var setForm = s4[1]; // { party, action, amount, fee, bank_transaction_id, bill_id, reason, request_id }
  var s5 = useState(''); var err = s5[0]; var setErr = s5[1];
  function call(payload) {
    return hubFetch('/api/accounting/advances', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ user_id: userProfile && userProfile.id }, payload)) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'The server did not answer properly (HTTP ' + r.status + ').' }; }); })
      .catch(function (e) { return { ok: false, error: 'Could not reach the server (' + ((e && e.message) || 'network') + ').' }; });
  }
  function load() { call({ action: 'summary' }).then(function (j) { if (j && j.ok) { setData(j); setErr(j.sql_missing || ''); } else { setErr((j && j.error) || ''); } }); }
  useEffect(function () { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  function start(party, action, extra) { setForm(Object.assign({ party: party, action: action, amount: '', fee: '', reason: '', request_id: newId() }, extra || {})); }
  function submit() {
    if (!form || busy) { return; }
    setBusy(true);
    call({ action: form.action, party: form.party, amount: form.amount, fee: form.fee, bank_transaction_id: form.bank_transaction_id, bill_id: form.bill_id, reason: form.reason, request_id: form.request_id }).then(function (j) {
      if (j && j.ok) { toast.success(j.repeat ? 'Already done (the same click arrived twice).' : 'Done — advance now ' + fmt(j.result && j.result.advance_balance) + ', fees ' + fmt(j.result && j.result.fee_total)); setForm(null); load(); if (props.onChanged) { props.onChanged(); } }
      else { toast.error((j && j.error) || 'Not done.'); }
    }).finally(function () { setBusy(false); });
  }
  var parties = (data && data.parties) || [];
  var canMove = !!(data && data.can_move);
  return <div className="mb-2">
    <div className="flex items-center gap-2 flex-wrap rounded-lg px-2 py-1" style={{ background: '#fefce8', color: '#713f12', border: '1px solid #fde68a' }}>
      <span className="text-[11px] font-extrabold">💼 Advances held:</span>
      {parties.map(function (p) { return <span key={p.name} className="text-[11px]"><b>{p.name}</b> {p.advance == null ? <span title={p.balance_hidden || ''}>hidden ({p.balance_hidden})</span> : <span>${fmt(p.advance)}{p.fee ? <span style={{ color: '#a16207' }}> · extra fees ${fmt(p.fee)}</span> : null}</span>}</span>; })}
      {!data && <span className="text-[11px]">loading…</span>}
      <div className="flex-1" />
      <button onClick={function () { setOpen(!open); if (!open) { load(); } }} className="px-2 py-0.5 rounded text-[10px] font-extrabold" style={{ background: '#a16207', color: '#ffffff' }}>{open ? '✕ Close' : '💼 Advances & fees'}</button>
    </div>
    {err && <div className="text-[11px] p-2 rounded mt-1" style={{ background: '#fef2f2', color: '#991b1b' }}>{err}</div>}
    {open && <div className="rounded-xl p-3 mt-2" style={{ background: '#ffffff', color: '#0f172a', border: '1px solid #fde68a' }}>
      <div className="text-[10px] mb-2" style={{ color: '#64748b' }}>An advance is money held by NextTrade / RTM for later — not an expense. Using it to pay their bills, or turning it into a fee, is always done by a person here. Every move is kept with who, when and why.</div>
      {parties.map(function (p) {
        return <div key={p.name} className="rounded-lg p-2 mb-3" style={{ border: '1px solid #e2e8f0' }}>
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-[13px] font-extrabold">{p.name}</span>
            <span className="text-[11px]">{p.advance == null ? 'Balance hidden — ' + p.balance_hidden : <span>Advance <b>${fmt(p.advance)}</b> · extra fees on record <b>${fmt(p.fee)}</b></span>}</span>
            <div className="flex-1" />
            {canMove && p.can_move_pool !== false && <button disabled={!(p.advance > 0)} onClick={function () { start(p.name, 'to_fee'); }} className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#fef3c7', color: '#92400e', opacity: p.advance > 0 ? 1 : 0.4 }}>Advance → fee</button>}
            {canMove && p.can_move_pool !== false && <button disabled={!(p.fee > 0)} onClick={function () { start(p.name, 'to_advance'); }} className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#fef3c7', color: '#92400e', opacity: p.fee > 0 ? 1 : 0.4 }}>Fee → advance</button>}
          </div>
          <div className="text-[11px] font-bold mt-1">Payments sent to {p.name} (last ~6 months)</div>
          {(p.payments || []).slice(0, 15).map(function (l) { return <div key={l.id} className="flex items-center gap-2 text-[11px] py-0.5" style={{ borderTop: '1px solid #f1f5f9' }}>
            <span>{l.date}</span><span>${fmt(l.amount)}</span><span style={{ color: '#64748b' }}>bills / fees / advance so far ${fmt(l.used)} · not split ${fmt(l.left)}</span><div className="flex-1" />
            {canMove && p.can_move_pool !== false && l.left > 0.005 && <button onClick={function () { start(p.name, 'split', { bank_transaction_id: l.id, line: l }); }} className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#eff6ff', color: '#1d4ed8' }}>Split → fee / advance</button>}
          </div>; })}
          {!(p.payments || []).length && <div className="text-[10px]" style={{ color: '#64748b' }}>No payments marked as sent to {p.name} yet (All Transactions → 🏢 flag the bank line).</div>}
          <div className="text-[11px] font-bold mt-2">Their open bills</div>
          {(p.open_bills || []).slice(0, 25).map(function (b) { return <div key={b.id} className="flex items-center gap-2 text-[11px] py-0.5" style={{ borderTop: '1px solid #f1f5f9' }}>
            <span>{b.bill_number}</span><span>{b.vendor_name}</span><span>due {b.due_date || '—'}</span><span>open <b>${fmt(b.open)}</b></span><div className="flex-1" />
            {canMove && p.can_move_pool !== false && p.advance > 0.005 && <button onClick={function () { start(p.name, 'apply', { bill_id: b.id, bill: b, amount: String(Math.min(b.open, p.advance)) }); }} className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#dcfce7', color: '#166534' }}>Pay from the advance</button>}
          </div>; })}
          {!(p.open_bills || []).length && <div className="text-[10px]" style={{ color: '#64748b' }}>No open bills paid via {p.name}.</div>}
          {form && form.party === p.name && <div className="mt-2 p-2 rounded flex gap-2 items-center flex-wrap" style={{ background: '#f8fafc', border: '1px solid #cbd5e1' }}>
            <span className="text-[11px] font-extrabold">{form.action === 'split' ? 'Split the ' + form.line.date + ' payment ($' + fmt(form.line.left) + ' not split):' : form.action === 'apply' ? 'Pay ' + form.bill.bill_number + ' from the advance:' : form.action === 'to_fee' ? 'Turn advance into a professional fee:' : 'Turn fees back into advance:'}</span>
            {form.action === 'split' && <label className="text-[10px] font-bold">extra fee $<input className={inp} style={Object.assign({ width: 90 }, inpS)} type="number" step="0.01" min="0" value={form.fee} onChange={function (e) { setForm(Object.assign({}, form, { fee: e.target.value })); }} /></label>}
            <label className="text-[10px] font-bold">{form.action === 'split' ? 'advance $' : 'amount $'}<input className={inp} style={Object.assign({ width: 90 }, inpS)} type="number" step="0.01" min="0" value={form.amount} onChange={function (e) { setForm(Object.assign({}, form, { amount: e.target.value })); }} /></label>
            <input className={inp} style={Object.assign({ minWidth: 200 }, inpS)} placeholder={form.action === 'to_fee' || form.action === 'to_advance' ? 'Why (required)' : 'Note (optional)'} value={form.reason} onChange={function (e) { setForm(Object.assign({}, form, { reason: e.target.value })); }} />
            <button disabled={busy} onClick={submit} className="px-2 py-1 rounded text-[10px] font-extrabold" style={{ background: '#0f172a', color: '#ffffff' }}>{busy ? 'Saving…' : 'Confirm'}</button>
            <button onClick={function () { setForm(null); }} className="px-2 py-1 rounded text-[10px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>Cancel</button>
          </div>}
          {canMove && p.can_move_pool === false && <div className="text-[10px] mt-1" style={{ color: '#92400e' }}>This advance includes money from a private bank account — only someone allowed to see private accounts can move it.</div>}
          {(p.entries || []).length > 0 && <details className="mt-2"><summary className="text-[11px] font-bold cursor-pointer">History ({p.history_note || p.entries.length})</summary>
            {p.entries.map(function (e) { return <div key={e.id} className="text-[10px] py-0.5" style={{ borderTop: '1px solid #f1f5f9' }}>{String(e.created_at).substring(0, 16).replace('T', ' ')} · {e.by_name || 'someone'} · {KIND_WORDS[e.kind] || e.kind} · {e.bucket} {Number(e.amount) > 0 ? '+' : ''}{fmt(e.amount)}{e.reason ? ' · “' + e.reason + '”' : ''}</div>; })}
          </details>}
        </div>;
      })}
    </div>}
  </div>;
}
