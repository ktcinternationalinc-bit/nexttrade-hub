'use client';
// v55.83-TX — Accounting → 💸 Bills: NextTrade / RTM ADVANCES and extra fees (Max, Nov 17 2026).
// The strip (always on the Bills screen) shows each company's advance balance. "💼 Advances & fees" opens the panel:
//   • Split a payment already sent to them → extra professional fee and / or advance (the rest stays as bills)
//   • Use part of the advance to pay one of their bills
//   • Turn part of the advance into a fee, or a fee back into advance — with a reason
// Nothing is automatic; every move is a new entry with who / when / why (the original is never erased), and the database
// refuses anything that would take a balance below zero. Inline colours on white panels.
// v55.83-UD (Max, Nov 18) — "Pay bills / fee / advance" on each payment: tick the bills it pays + a fee + an advance, ONE step
// (all or nothing). Likely payments not marked yet get "This is a payment to …". The super admin can enter a STARTING balance
// they already hold for KTC. The 🟦 Nextrade bills panel's "Pay ▸" opens this panel with that bill ticked (event hub-pay-party).
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
  var s6 = useState(null); var want = s6[0]; var setWant = s6[1]; // { party, bill_id } from a Pay ▸ click: pick the payment next
  function call(payload) {
    return hubFetch('/api/accounting/advances', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ user_id: userProfile && userProfile.id }, payload)) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'The server did not answer properly (HTTP ' + r.status + ').' }; }); })
      .catch(function (e) { return { ok: false, error: 'Could not reach the server (' + ((e && e.message) || 'network') + ').' }; });
  }
  function load() { call({ action: 'summary' }).then(function (j) { if (j && j.ok) { setData(j); setErr(j.sql_missing || ''); } else { setErr((j && j.error) || ''); } }); }
  useEffect(function () { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(function () { // v55.83-UD: "Pay ▸" on a Nextrade bill
    function onPay(ev) { var d = (ev && ev.detail) || {}; setOpen(true); setWant({ party: d.party, bill_id: d.bill_id, bill_number: d.bill_number }); load(); }
    if (typeof window !== 'undefined') { window.addEventListener('hub-pay-party', onPay); return function () { window.removeEventListener('hub-pay-party', onPay); }; }
    return undefined;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  function startAllocate(p, l) {
    var picked = {}; if (want && want.party === p.name && want.bill_id) { (p.open_bills || []).forEach(function (b) { if (b.id === want.bill_id) { picked[b.id] = String(Math.min(b.open, l.left)); } }); }
    setWant(null);
    start(p.name, 'allocate', { bank_transaction_id: l.id, line: l, picked: picked, advance: '' });
  }
  function allocTotal() { if (!form || form.action !== 'allocate') { return 0; } var t = Number(form.fee) || 0; t += Number(form.advance) || 0; Object.keys(form.picked || {}).forEach(function (k) { t += Number(form.picked[k]) || 0; }); return Math.round(t * 100) / 100; }
  function markPayment(party, l) {
    if (busy) { return; } setBusy(true);
    call({ action: 'mark_payment', party: party, bank_transaction_id: l.id }).then(function (j) { if (j && j.ok) { toast.success('Marked as a payment to ' + party + '.'); load(); } else { toast.error((j && j.error) || 'Not done.'); } }).finally(function () { setBusy(false); });
  }
  function start(party, action, extra) { setForm(Object.assign({ party: party, action: action, amount: '', fee: '', reason: '', request_id: newId() }, extra || {})); }
  function submit() {
    if (!form || busy) { return; }
    setBusy(true);
    var payload = { action: form.action, party: form.party, amount: form.amount, fee: form.fee, bank_transaction_id: form.bank_transaction_id, bill_id: form.bill_id, reason: form.reason, request_id: form.request_id };
    if (form.action === 'allocate') { payload.advance = form.advance; payload.bills = Object.keys(form.picked || {}).filter(function (k) { return Number(form.picked[k]) > 0; }).map(function (k) { return { bill_id: k, amount: form.picked[k] }; }); }
    if (form.action === 'opening') { payload.as_of = form.as_of; payload.visible_to_staff = form.vis === 'yes' ? true : form.vis === 'no' ? false : null; payload.corrects = Number(form.amount) < 0 ? form.corrects || null : null; }
    call(payload).then(function (j) {
      if (j && j.ok) { var rr = j.result || {}; toast.success(j.repeat ? 'Already done (the same click arrived twice).' : form.action === 'allocate' ? 'Done — ' + (rr.bills_paid || 0) + ' bill(s) paid' + (Number(rr.fee) ? ', fee ' + fmt(rr.fee) : '') + (Number(rr.advance) ? ', advance ' + fmt(rr.advance) : '') + '; ' + fmt(rr.left_on_payment) + ' left on the payment.' : (rr.advance_balance != null ? 'Done — advance now ' + fmt(rr.advance_balance) + (rr.fee_total != null ? ', fees ' + fmt(rr.fee_total) : '') : 'Done.')); setForm(null); load(); if (props.onChanged) { props.onChanged(); } }
      else { toast.error((j && j.error) || 'Not done.'); }
    }).finally(function () { setBusy(false); });
  }
  var parties = (data && data.parties) || [];
  var canMove = !!(data && data.can_move);
  var retired = !!(data && data.wf); // v55.83-WF B2: once Funds-with-company is in the database, the old pool moves are retired (the database refuses them too)
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
      {data && data.ud_missing && <div className="text-[11px] p-2 rounded mb-2" style={{ background: '#fef2f2', color: '#991b1b' }}>{data.ud_missing}</div>}
      {want && <div className="text-[11px] p-2 rounded mb-2 flex items-center gap-2" style={{ background: '#eff6ff', color: '#1e3a8a', border: '1px solid #bfdbfe' }}><b>Pay {want.bill_number || 'the bill'}:</b> pick the payment to {want.party} it is paid from — press “Pay bills / fee / advance” on that payment below (the bill is ticked for you). No payment yet? Mark it under “Possible payments”, or use “Pay from the advance”.<button onClick={function () { setWant(null); }} className="ml-auto px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#ffffff', color: '#334155', border: '1px solid #cbd5e1' }}>Cancel</button></div>}
      <div className="text-[10px] mb-2" style={{ color: '#64748b' }}>An advance is money held by NextTrade / RTM for later — not an expense. Using it to pay their bills, or turning it into a fee, is always done by a person here. Every move is kept with who, when and why.</div>
      {parties.map(function (p) {
        return <div key={p.name} className="rounded-lg p-2 mb-3" style={{ border: '1px solid #e2e8f0' }}>
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-[13px] font-extrabold">{p.name}</span>
            <span className="text-[11px]">{p.advance == null ? 'Balance hidden — ' + p.balance_hidden : <span>Advance <b>${fmt(p.advance)}</b> · extra fees on record <b>${fmt(p.fee)}</b></span>}</span>
            <div className="flex-1" />
            {canMove && p.can_move_pool !== false && !retired && <button disabled={!(p.advance > 0)} onClick={function () { start(p.name, 'to_fee'); }} className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#fef3c7', color: '#92400e', opacity: p.advance > 0 ? 1 : 0.4 }}>Advance → fee</button>}
            {data && data.can_opening && p.can_move_pool !== false && <button onClick={function () { start(p.name, 'opening', { as_of: '', vis: '', corrects: '' }); }} title="Money they already hold for KTC, with no KTC transfer in the Hub (super admin)" className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0' }}>Starting balance</button>}
            {canMove && p.can_move_pool !== false && !retired && <button disabled={!(p.fee > 0)} onClick={function () { start(p.name, 'to_advance'); }} className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#fef3c7', color: '#92400e', opacity: p.fee > 0 ? 1 : 0.4 }}>Fee → advance</button>}
          </div>
          <div className="text-[11px] font-bold mt-1">Payments sent to {p.name} (last ~6 months)</div>
          {(p.payments || []).slice(0, 15).map(function (l) { return <div key={l.id} className="flex items-center gap-2 text-[11px] py-0.5" style={{ borderTop: '1px solid #f1f5f9' }}>
            <span>{l.date}</span><span>${fmt(l.amount)}</span><span style={{ color: '#64748b' }}>bills / fees / advance so far ${fmt(l.used)} · not split ${fmt(l.left)}</span><div className="flex-1" />
            {canMove && l.left > 0.005 && data && data.ud_ready && <button onClick={function () { startAllocate(p, l); }} className="px-2 py-0.5 rounded text-[10px] font-extrabold" style={{ background: want && want.party === p.name ? '#1d4ed8' : '#dbeafe', color: want && want.party === p.name ? '#ffffff' : '#1e3a8a' }}>Pay bills / fee / advance</button>}
            {canMove && p.can_move_pool !== false && !retired && l.left > 0.005 && <button onClick={function () { start(p.name, 'split', { bank_transaction_id: l.id, line: l }); }} className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#eff6ff', color: '#1d4ed8' }}>Split → fee / advance</button>}
          </div>; })}
          {!(p.payments || []).length && <div className="text-[10px]" style={{ color: '#64748b' }}>No payments marked as sent to {p.name} yet (All Transactions → 🏢 flag the bank line, or below).</div>}
          {canMove && (p.possible_payments || []).length > 0 && <div className="mt-1 p-1 rounded" style={{ background: '#f8fafc', border: '1px dashed #cbd5e1' }}>
            <div className="text-[10px] font-bold" style={{ color: '#334155' }}>Possible payments to {p.name} not marked yet (KTC money out with “{p.name.split(' ')[0]}” in the description):</div>
            {p.possible_payments.map(function (l) { return <div key={l.id} className="flex items-center gap-2 text-[11px] py-0.5"><span>{l.date}</span><span>${fmt(l.amount)}</span><span style={{ color: '#64748b' }}>{l.name}</span><div className="flex-1" /><button disabled={busy} onClick={function () { markPayment(p.name, l); }} className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#fce7f3', color: '#9d174d' }}>This is a payment to {p.name}</button></div>; })}
          </div>}
          <div className="text-[11px] font-bold mt-2">Their open bills</div>
          {(p.open_bills || []).slice(0, 25).map(function (b) { return <div key={b.id} className="flex items-center gap-2 text-[11px] py-0.5" style={{ borderTop: '1px solid #f1f5f9' }}>
            <span>{b.bill_number}</span><span>{b.vendor_name}</span><span>due {b.due_date || '—'}</span><span>open <b>${fmt(b.open)}</b></span><div className="flex-1" />
            {canMove && p.can_move_pool !== false && !retired && p.advance > 0.005 && <button onClick={function () { start(p.name, 'apply', { bill_id: b.id, bill: b, amount: String(Math.min(b.open, p.advance)) }); }} className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#dcfce7', color: '#166534' }}>Pay from the advance</button>}
          </div>; })}
          {!(p.open_bills || []).length && <div className="text-[10px]" style={{ color: '#64748b' }}>No open bills paid via {p.name}.</div>}
          {form && form.party === p.name && <div className="mt-2 p-2 rounded flex gap-2 items-center flex-wrap" style={{ background: '#f8fafc', border: '1px solid #cbd5e1' }}>
            <span className="text-[11px] font-extrabold">{form.action === 'allocate' ? 'Pay bills / fee / advance from the ' + form.line.date + ' payment ($' + fmt(form.line.left) + ' not used yet):' : form.action === 'opening' ? 'Starting balance ' + p.name + ' already holds for KTC (a correction = a minus amount):' : form.action === 'split' ? 'Split the ' + form.line.date + ' payment ($' + fmt(form.line.left) + ' not split):' : form.action === 'apply' ? 'Pay ' + form.bill.bill_number + ' from the advance:' : form.action === 'to_fee' ? 'Turn advance into a professional fee:' : 'Turn fees back into advance:'}</span>
            {form.action === 'allocate' && <div className="w-full">
              <div className="text-[10px] font-bold mb-1" style={{ color: '#334155' }}>Tick the bills this payment pays (the amount starts at what is still open):</div>
              {(p.open_bills || []).map(function (b) { var on = Object.prototype.hasOwnProperty.call(form.picked || {}, b.id); return <label key={b.id} className="flex items-center gap-2 text-[11px] py-0.5"><input type="checkbox" checked={on} onChange={function (e) { var pk = Object.assign({}, form.picked || {}); if (e.target.checked) { pk[b.id] = String(b.open); } else { delete pk[b.id]; } setForm(Object.assign({}, form, { picked: pk })); }} /><span>{b.bill_number}</span><span>{b.vendor_name}</span><span style={{ color: '#64748b' }}>due {b.due_date || '—'} · open ${fmt(b.open)}</span>{on && <input className={inp} style={Object.assign({ width: 90 }, inpS)} type="number" step="0.01" min="0" value={form.picked[b.id]} onChange={function (e) { var pk = Object.assign({}, form.picked); pk[b.id] = e.target.value; setForm(Object.assign({}, form, { picked: pk })); }} />}</label>; })}
              {!(p.open_bills || []).length && <div className="text-[10px]" style={{ color: '#64748b' }}>No open bills paid via {p.name}.</div>}
              <div className="flex gap-2 items-center flex-wrap mt-1">
                <label className="text-[10px] font-bold">extra fee $<input className={inp} style={Object.assign({ width: 90 }, inpS)} type="number" step="0.01" min="0" value={form.fee} onChange={function (e) { setForm(Object.assign({}, form, { fee: e.target.value })); }} /></label>
                <label className="text-[10px] font-bold">advance $<input className={inp} style={Object.assign({ width: 90 }, inpS)} type="number" step="0.01" min="0" value={form.advance} onChange={function (e) { setForm(Object.assign({}, form, { advance: e.target.value })); }} /></label>
                <span className="text-[11px] font-bold" style={{ color: allocTotal() > form.line.left + 0.005 ? '#b91c1c' : '#166534' }}>this step ${fmt(allocTotal())} · left after this ${fmt(form.line.left - allocTotal())}</span>
              </div>
            </div>}
            {form.action === 'opening' && <div className="w-full text-[10px]" style={{ color: '#334155' }}>Money {p.name} already HOLDS FOR KTC from before the Hub (not their own bank balance). The as-of date must be before the first payment already in the advance, so nothing is counted twice. Using it later to pay their bills is not a new expense in the tax view (it was booked when it was sent).</div>}
            {form.action === 'opening' && <select className={inp} style={inpS} value={form.vis} onChange={function (e) { setForm(Object.assign({}, form, { vis: e.target.value })); }}><option value="">Staff may see it? (choose)</option><option value="yes">Yes — staff may see this balance</option><option value="no">No — private (hides this company's advance from staff without the private-accounts permission)</option></select>}
            {form.action === 'opening' && Number(form.amount) < 0 && <select className={inp} style={inpS} value={form.corrects} onChange={function (e) { setForm(Object.assign({}, form, { corrects: e.target.value })); }}><option value="">Corrects which starting balance?</option>{(p.entries || []).filter(function (e) { return e.kind === 'opening_balance' && Number(e.amount) > 0; }).map(function (e) { return <option key={e.id} value={e.id}>{String(e.entry_date) + ' · $' + fmt(e.amount) + (e.reason ? ' · ' + e.reason.substring(0, 40) : '')}</option>; })}</select>}
            {form.action === 'opening' && <label className="text-[10px] font-bold">as of <input className={inp} style={inpS} type="date" value={form.as_of} onChange={function (e) { setForm(Object.assign({}, form, { as_of: e.target.value })); }} /></label>}
            {form.action === 'split' && <label className="text-[10px] font-bold">extra fee $<input className={inp} style={Object.assign({ width: 90 }, inpS)} type="number" step="0.01" min="0" value={form.fee} onChange={function (e) { setForm(Object.assign({}, form, { fee: e.target.value })); }} /></label>}
            {form.action !== 'allocate' && <label className="text-[10px] font-bold">{form.action === 'split' ? 'advance $' : 'amount $'}<input className={inp} style={Object.assign({ width: 90 }, inpS)} type="number" step="0.01" min="0" value={form.amount} onChange={function (e) { setForm(Object.assign({}, form, { amount: e.target.value })); }} /></label>}
            <input className={inp} style={Object.assign({ minWidth: 200 }, inpS)} placeholder={form.action === 'opening' ? 'Where this balance comes from (required)' : form.action === 'to_fee' || form.action === 'to_advance' ? 'Why (required)' : 'Note (optional)'} value={form.reason} onChange={function (e) { setForm(Object.assign({}, form, { reason: e.target.value })); }} />
            <button disabled={busy || (form.action === 'allocate' && (allocTotal() <= 0 || allocTotal() > form.line.left + 0.005)) || (form.action === 'opening' && (!form.vis || (Number(form.amount) < 0 && !form.corrects)))} onClick={submit} className="px-2 py-1 rounded text-[10px] font-extrabold" style={{ background: '#0f172a', color: '#ffffff' }}>{busy ? 'Saving…' : 'Confirm'}</button>
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
