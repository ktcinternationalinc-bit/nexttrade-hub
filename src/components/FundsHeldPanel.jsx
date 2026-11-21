'use client';
// v55.83-WF — FUNDS WITH RTM / NEXTTRADE (Max, 20 Nov 2026): money KTC already sent each company, transfer by transfer —
// what it paid, what was explicitly marked "services rendered", what is reserved for a request not sent yet, and what is
// still available. Nothing here is an expense by itself; only "services rendered" is. A transfer is spendable only once it
// is CONFIRMED. Every write goes to the server (which goes to the database): this screen computes nothing it then saves.
// Works with or without the WF database step: without it the list shows and the buttons say what is needed.
// Inline colours on white panels (the dark theme repaints bg-white).
import React, { useState, useEffect } from 'react';
import { hubFetch } from '../lib/hub-fetch';

function fmt(n) { return n == null ? '—' : '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function clickId() { return 'pf-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10); }
var INK = '#0f172a', SUB = '#475569', MUTED = '#64748b';
var inp = 'px-2 py-1 rounded border text-[12px] nt-light';
var inpS = { background: '#ffffff', color: INK, borderColor: '#cbd5e1' };
export var STATUS_WORDS = {
  confirmed: { text: 'Confirmed — can be used', bg: '#dcfce7', fg: '#166534' },
  needs_reconciliation: { text: 'Needs reconciliation — not spendable yet', bg: '#fef3c7', fg: '#92400e' },
  to_confirm_identity: { text: 'Recognised from the bank text — mark it for the company first', bg: '#e0e7ff', fg: '#3730a3' },
};
// what the person may do with one transfer right now (pure — tested)
export function transferActions(t, o) {
  var can = !!(o && o.canManage) && !!(o && o.installed);
  return {
    confirm: can && t.status === 'needs_reconciliation',
    unconfirm: can && t.status === 'confirmed',
    markFee: can && t.status === 'confirmed' && Number(t.available) > 0.005,
    reverseFee: can && t.status !== 'to_confirm_identity',
    refund: can && t.status !== 'to_confirm_identity' && Number(t.held) - Number(t.reserved || 0) > 0.005, // v55.83-WF B2 — money back from the company
    why: !(o && o.installed) ? 'not switched on yet' : !(o && o.canManage) ? 'needs the 🔒 Advances: Manage permission' : t.status === 'to_confirm_identity' ? 'mark this bank line as sent to the company first (All Transactions)' : '',
  };
}

export default function FundsHeldPanel(props) {
  var userProfile = props.userProfile; var toast = props.toast || { success: function () {}, error: function () {} };
  var s1 = useState(null); var data = s1[0]; var setData = s1[1];
  var s2 = useState(false); var busy = s2[0]; var setBusy = s2[1];
  var s3 = useState(''); var err = s3[0]; var setErr = s3[1];
  var s4 = useState({}); var open = s4[0]; var setOpen = s4[1];
  var s5 = useState(null); var form = s5[0]; var setForm = s5[1]; // { kind: 'mark' | 'reverse', party, id, fee, amount, date, reason }
  var s6 = useState(false); var shown = s6[0]; var setShown = s6[1];

  function api(payload) {
    return hubFetch('/api/accounting/party-funds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ user_id: userProfile && userProfile.id }, payload)) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'The server did not answer properly (HTTP ' + r.status + ').' }; }); })
      .catch(function (e) { return { ok: false, error: 'Could not reach the server (' + ((e && e.message) || 'network') + ').' }; });
  }
  function load() { setBusy(true); return api({ action: 'funds' }).then(function (j) { if (j && j.ok) { setData(j); setErr(''); } else { setErr((j && j.error) || 'Could not load the funds.'); } }).finally(function () { setBusy(false); }); }
  useEffect(function () { if (shown && !data) { load(); } }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps
  function act(payload, okWords) {
    setBusy(true);
    return api(payload).then(function (j) {
      if (j && j.ok) { toast.success(okWords + (j.repeat ? ' (already saved — same click)' : '')); setForm(null); if (props.onChanged) { props.onChanged(); } return load(); }
      toast.error((j && j.error) || 'Not done. Nothing was changed.');
    }).finally(function () { setBusy(false); });
  }
  function setState(p, t, confirm) {
    var q = confirm ? 'Confirm the ' + fmt(t.sent) + ' transfer of ' + t.date + ' as funds held by ' + p.party + '?\n\nAfter this, what is left on it can be used on bills (with the usual two approvals) or marked as services rendered.'
      : 'Put the transfer of ' + t.date + ' back to "needs reconciliation"?\n\nNothing already recorded changes; nothing more can be drawn from it until it is confirmed again.';
    if (!window.confirm(q)) { return; }
    act({ action: confirm ? 'confirm' : 'unconfirm', party: p.party, bank_transaction_id: t.id }, confirm ? 'Transfer confirmed' : 'Back to needs reconciliation');
  }
  // v55.83-WF B2 — money back: pick the money-in line it arrived on (the server lists the possible ones)
  function openRefund(p, t) {
    setForm({ kind: 'refund', party: p.party, id: t.id, amount: '', date: '', reason: '', click: clickId(), max: Number(t.held) - Number(t.reserved || 0), lines: null, line: '' });
    api({ action: 'refund_candidates', bank_transaction_id: t.id }).then(function (j) { setForm(function (f) { return f && f.kind === 'refund' && f.id === t.id ? Object.assign({}, f, { lines: (j && j.ok) ? (j.lines || []) : [], linesErr: (j && j.ok) ? '' : ((j && j.error) || 'Could not list the money-in lines.') }) : f; }); });
  }
  function saveForm() {
    var a = Number(String(form.amount || '').replace(/,/g, ''));
    if (!(a > 0)) { toast.error('Type an amount above zero.'); return; }
    if (String(form.reason || '').trim().length < 3) { toast.error('Say why, in a few words.'); return; }
    if (form.kind === 'mark') { act({ action: 'fee_mark', party: form.party, bank_transaction_id: form.id, amount: a, entry_date: form.date, reason: form.reason, allow_closed: form.closed === true, request_id: form.click }, fmt(a) + ' marked as services rendered'); }
    else if (form.kind === 'refund') { if (!form.line) { toast.error('Pick the money-in line the money came back on.'); return; } act({ action: 'refund', party: form.party, bank_transaction_id: form.id, incoming_bank_transaction_id: form.line, amount: a, entry_date: form.date || null, reason: form.reason, allow_closed: form.closed === true, request_id: form.click }, fmt(a) + ' recorded as money back from ' + form.party); }
    else { act({ action: 'fee_reverse', party: form.party, bank_transaction_id: form.id, amount: a, entry_date: form.date, reason: form.reason, fee_id: form.fee, allow_closed: form.closed === true, request_id: form.click }, fmt(a) + ' put back to available funds'); }
  }
  var chip = function (st) { var w = STATUS_WORDS[st] || STATUS_WORDS.needs_reconciliation; return <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded" style={{ background: w.bg, color: w.fg }}>{w.text}</span>; };

  return <div className="rounded-xl p-3 mt-3" style={{ background: '#ffffff', color: INK, border: '1px solid #e2e8f0' }}>
    <div className="flex items-center gap-2 flex-wrap">
      <button type="button" onClick={function () { setShown(!shown); }} className="text-[14px] font-extrabold" style={{ color: INK }}>{(shown ? '▾ ' : '▸ ') + '🏦 Funds with RTM / NextTrade'}</button>
      <span className="text-[11px]" style={{ color: MUTED }}>Money already sent to each company: what it paid, services rendered, reserved, and what is still available. Unused money is never an expense.</span>
      {shown && <button type="button" onClick={load} disabled={busy} className="px-2 py-1 rounded text-[10px] font-bold" style={{ background: '#e0f2fe', color: '#075985' }}>{busy ? 'Loading…' : '↻ Refresh'}</button>}
    </div>
    {shown && err && <div className="text-[12px] p-2 rounded mt-2" style={{ background: '#fef2f2', color: '#991b1b' }}>{err}</div>}
    {shown && data && data.sql_missing && <div className="text-[12px] p-2 rounded mt-2" style={{ background: '#fffbeb', color: '#92400e', border: '1px solid #fcd34d' }}>{'Showing what is recorded. Confirming a transfer and marking services rendered are not switched on yet — they arrive with a later update. Until then every transfer shows as “needs reconciliation” and nothing is spendable.'}</div>}
    {shown && data && (data.parties || []).map(function (p) {
      var T = p.totals;
      return <div key={p.party} className="mt-3 rounded-lg p-2" style={{ border: '1px solid #cbd5e1' }}>
        <div className="flex gap-3 items-baseline flex-wrap">
          <div className="text-[13px] font-extrabold" style={{ color: INK }}>{p.party}</div>
          {T ? <div className="flex gap-3 flex-wrap text-[12px]" style={{ color: SUB }}>
            <span>Sent <b style={{ color: INK }}>{fmt(T.funds_sent)}</b></span>{T.refunded > 0.005 ? <span>− money back <b style={{ color: INK }}>{fmt(T.refunded)}</b></span> : null}<span>− to bills <b style={{ color: INK }}>{fmt(T.to_bills)}</b></span><span>− services rendered <b style={{ color: '#991b1b' }}>{fmt(T.services_rendered)}</b></span>
            <span>= held <b style={{ color: INK }}>{fmt(T.held)}</b></span><span>· reserved <b style={{ color: '#92400e' }}>{fmt(T.reserved)}</b></span><span>· available now <b style={{ color: '#166534' }}>{fmt(T.available)}</b></span>
            {T.not_confirmed > 0.005 ? <span>· not confirmed yet <b style={{ color: '#92400e' }}>{fmt(T.not_confirmed)}</b></span> : null}
          </div> : <div className="text-[11px]" style={{ color: MUTED }}>{'Totals hidden — ' + (p.totals_hidden || 'no permission') + '.'}</div>}
        </div>
        {p.needs_reconciliation && <div className="text-[11px] mt-1 font-bold" style={{ color: '#b45309' }}>{'⚠ Needs reconciliation' + (p.paid_without_a_transfer_count ? ': ' + p.paid_without_a_transfer_count + ' bill payment(s) made through ' + p.party + ' name no transfer' + (T ? ' (' + fmt(T.paid_without_a_transfer) + ') — held funds are overstated by that until they are linked' : '') : ': the records disagree on a transfer') + '.'}</div>}
        {p.hidden_private_transfers > 0 && <div className="text-[11px] mt-1" style={{ color: MUTED }}>{p.hidden_private_transfers + ' transfer(s) from a private account are not shown.'}</div>}
        <div style={{ overflowX: 'auto' }}><table className="w-full text-[12px] mt-2" style={{ color: INK }}>
          <thead><tr style={{ background: '#f1f5f9', color: SUB }}><th className="p-1 text-left">Transfer</th><th className="p-1 text-left">Status</th><th className="p-1 text-right">Sent</th><th className="p-1 text-right">To bills</th><th className="p-1 text-right">Services rendered</th><th className="p-1 text-right">Reserved</th><th className="p-1 text-right">Available</th><th className="p-1"></th></tr></thead>
          <tbody>{p.transfers.map(function (t) {
            var a = transferActions(t, { canManage: data.can_manage, installed: data.installed }); var isOpen = !!open[t.id];
            return <React.Fragment key={t.id}>
              <tr style={{ borderTop: '1px solid #e2e8f0' }}>
                <td className="p-1"><button type="button" onClick={function () { var o = Object.assign({}, open); o[t.id] = !isOpen; setOpen(o); }} className="font-bold text-left" style={{ color: '#1d4ed8' }}>{(isOpen ? '▾ ' : '▸ ') + t.date}</button><div className="text-[10px]" style={{ color: MUTED }}>{String(t.reference || '').substring(0, 60)}</div></td>
                <td className="p-1">{chip(t.status)}{t.database_agrees === false ? <div className="text-[10px] font-bold" style={{ color: '#b91c1c' }}>the database and the report disagree — tell Claude</div> : null}</td>
                <td className="p-1 text-right tabular-nums">{fmt(t.sent)}{t.refunded > 0.005 ? <div className="text-[10px]" style={{ color: MUTED }}>{'− ' + fmt(t.refunded) + ' back'}</div> : null}</td><td className="p-1 text-right tabular-nums">{fmt(t.to_bills)}</td><td className="p-1 text-right tabular-nums">{fmt(t.services_rendered)}</td>
                <td className="p-1 text-right tabular-nums">{fmt(t.reserved)}</td><td className="p-1 text-right tabular-nums font-extrabold" style={{ color: '#166534' }}>{fmt(t.available)}</td>
                <td className="p-1 whitespace-nowrap text-right">
                  {a.confirm && <button type="button" disabled={busy} onClick={function () { setState(p, t, true); }} className="px-2 py-0.5 rounded text-[10px] font-extrabold" style={{ background: '#166534', color: '#ffffff' }}>✓ Confirm</button>}
                  {a.markFee && <button type="button" disabled={busy} onClick={function () { setForm({ kind: 'mark', party: p.party, id: t.id, amount: '', date: today(), reason: '', click: clickId(), max: t.available }); }} className="ml-1 px-2 py-0.5 rounded text-[10px] font-extrabold" style={{ background: '#7c2d12', color: '#ffffff' }}>Mark services rendered</button>}
                  {a.refund && <button type="button" disabled={busy} onClick={function () { openRefund(p, t); }} className="ml-1 px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#e0f2fe', color: '#075985' }}>↩ Money back</button>}
                  {a.unconfirm && <button type="button" disabled={busy} onClick={function () { setState(p, t, false); }} className="ml-1 px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>Undo confirm</button>}
                  {!a.confirm && !a.markFee && !a.unconfirm && !a.refund && a.why ? <span className="text-[10px]" style={{ color: MUTED }}>{a.why}</span> : null}
                </td>
              </tr>
              {form && form.id === t.id && <tr><td colSpan={8} className="p-2" style={{ background: form.kind === 'mark' ? '#fff7ed' : form.kind === 'refund' ? '#eff6ff' : '#f0fdf4' }}>
                <div className="flex gap-2 items-center flex-wrap">
                  <span className="text-[12px] font-extrabold">{form.kind === 'mark' ? 'Mark as ' + p.party + ' services rendered (an expense; no payment is made):' : form.kind === 'refund' ? 'Money back from ' + p.party + ' on this transfer (lowers what it holds; not a fee, not income):' : 'Put a services-rendered amount back to available funds (no payment is made):'}</span>
                  {form.kind === 'refund' && (form.lines === null ? <span className="text-[11px]" style={{ color: MUTED }}>Looking for money-in lines…</span> : form.linesErr ? <span className="text-[11px]" style={{ color: '#991b1b' }}>{form.linesErr}</span> : form.lines.length === 0 ? <span className="text-[11px]" style={{ color: '#92400e' }}>No unused money-in line since this transfer — the money must be in the bank feed first.</span> :
                    <select className={inp} style={inpS} value={form.line} onChange={function (e) { var ln = (form.lines || []).filter(function (x) { return x.id === e.target.value; })[0]; setForm(Object.assign({}, form, { line: e.target.value, amount: ln ? String(Math.min(ln.amount, form.max)) : form.amount, date: ln ? ln.date : form.date })); }}><option value="">the money-in line it came back on…</option>{form.lines.map(function (ln) { return <option key={ln.id} value={ln.id}>{ln.date + ' · ' + String(ln.who).substring(0, 40) + ' · ' + fmt(ln.amount)}</option>; })}</select>)}
                  <span className="text-[11px] font-bold">$</span><input autoFocus className={inp} style={Object.assign({ width: 110 }, inpS)} value={form.amount} placeholder={'up to ' + fmt(form.max)} onChange={function (e) { setForm(Object.assign({}, form, { amount: e.target.value })); }} />
                  <span className="text-[11px] font-bold">date</span><input type="date" className={inp} style={inpS} value={form.date} max={today()} onChange={function (e) { setForm(Object.assign({}, form, { date: e.target.value })); }} />
                  <input className={inp} style={Object.assign({ minWidth: 220 }, inpS)} value={form.reason} placeholder="why (required)" onChange={function (e) { setForm(Object.assign({}, form, { reason: e.target.value })); }} />
                  {data.can_closed_month && <label className="text-[10px] font-bold" style={{ color: SUB }}><input type="checkbox" checked={form.closed === true} onChange={function (e) { setForm(Object.assign({}, form, { closed: e.target.checked })); }} /> the date is in a closed month — record it as a correction</label>}
                  <button type="button" disabled={busy} onClick={saveForm} className="px-2 py-1 rounded text-[11px] font-extrabold" style={{ background: INK, color: '#ffffff' }}>{busy ? 'Saving…' : 'Save'}</button>
                  <button type="button" onClick={function () { setForm(null); }} className="px-2 py-1 rounded text-[11px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>Cancel</button>
                </div></td></tr>}
              {isOpen && <tr><td colSpan={8} className="p-2" style={{ background: '#f8fafc' }}>
                <div className="text-[11px] font-extrabold" style={{ color: SUB }}>{'Bills paid from this transfer (' + t.bills.length + ')'}</div>
                {t.bills.length === 0 && <div className="text-[11px]" style={{ color: MUTED }}>None recorded yet.</div>}
                {t.bills.map(function (b, i) { return <div key={i} className="text-[11px] flex gap-2 flex-wrap" style={{ color: INK }}><span>{b.paid_date}</span><b>{b.vendor}</b><span>{'bill ' + (b.bill_number || '—')}</span>{b.release_number ? <span>{'release ' + b.release_number}</span> : null}<span style={{ color: MUTED }}>{b.category}</span><span className="tabular-nums font-bold">{fmt(b.portion)}</span>{b.bill_total != null && b.portion != null && Math.abs(b.bill_total - b.portion) > 0.005 ? <span style={{ color: MUTED }}>{'of a ' + fmt(b.bill_total) + ' bill'}</span> : null}</div>; })}
                <div className="text-[11px] font-extrabold mt-2" style={{ color: SUB }}>{'Services rendered (' + t.fees.length + ' entr' + (t.fees.length === 1 ? 'y' : 'ies') + ')'}</div>
                {t.fees.length === 0 && <div className="text-[11px]" style={{ color: MUTED }}>None — nothing on this transfer is a fee.</div>}
                {t.fees.map(function (f, i) { var canRev = a.reverseFee && String(f.id || '').indexOf('entry:') === 0 && Number(f.amount) > 0;
                  return <div key={i} className="text-[11px] flex gap-2 flex-wrap items-center" style={{ color: INK }}><span>{f.date}</span><span>{f.why}</span><span className="tabular-nums font-bold" style={{ color: Number(f.amount) < 0 ? '#166534' : '#991b1b' }}>{fmt(f.amount)}</span>
                    {canRev && <button type="button" disabled={busy} onClick={function () { setForm({ kind: 'reverse', party: p.party, id: t.id, fee: f.id, amount: String(f.amount), date: today(), reason: '', click: clickId(), max: f.amount }); }} className="px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: '#dcfce7', color: '#166534' }}>↩ Put back</button>}
                    {String(f.id || '').indexOf('request:') === 0 ? <span style={{ color: MUTED }}>(the fee of a wire — change it on the wire)</span> : null}</div>; })}
                {(t.refunds || []).length > 0 && <div><div className="text-[11px] font-extrabold mt-2" style={{ color: SUB }}>Money back from the company (lowers what this transfer holds)</div>
                  {t.refunds.map(function (r, i) { return <div key={i} className="text-[11px]" style={{ color: INK }}>{r.date + ' · ' + r.why + ' · '}<b className="tabular-nums">{fmt(r.amount)}</b></div>; })}</div>}
                {t.reserved_for.length > 0 && <div><div className="text-[11px] font-extrabold mt-2" style={{ color: SUB }}>Reserved for requests not sent yet (held — not paid, not an expense)</div>
                  {t.reserved_for.map(function (r, i) { return <div key={i} className="text-[11px]" style={{ color: INK }}>{'request ' + String(r.request_id).substring(0, 8) + ' · ' + r.status + ' · '}<b className="tabular-nums">{fmt(r.amount)}</b></div>; })}</div>}
                <div className="text-[10px] mt-2" style={{ color: MUTED }}>The date money is USED on a bill is the date entered when the request is sent. It is not proof the vendor was paid — that stays in the wire’s proof step.</div>
              </td></tr>}
            </React.Fragment>;
          })}</tbody></table></div>
        {p.transfers.length === 0 && <div className="text-[11px] mt-1" style={{ color: MUTED }}>{'No transfer to ' + p.party + ' is recorded.'}</div>}
        {p.words && <div className="text-[11px] mt-2" style={{ color: SUB }}>{p.words}</div>}
      </div>;
    })}
    {shown && data && <div className="text-[10px] mt-2" style={{ color: MUTED }}>Internal view: bills are counted once in their own categories; only “services rendered” is a fee; money still held is not an expense. Tax presentation (Max’s requested report design — the accountant confirms treatment and timing): each transfer once, in full, on its payment date.</div>}
  </div>;
}
