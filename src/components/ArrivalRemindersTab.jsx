'use client';
// v55.83-XG — ARRIVAL + FINAL-PAYMENT REMINDERS (Max, 22 Nov 2026), Phase 1: e-mail, sent by hand.
// The orders whose arrival is 21 days away or less (or already past), each with its invoice total / received / remaining
// from the Hub's invoices. "Prepare reminder" shows the exact approved message in the chosen language; nothing leaves
// until the person presses Send. All figures and all text come from the server (src/lib/arrival-reminders*.js).
import React, { useState, useEffect, useRef } from 'react';
import { hubFetch } from '../lib/hub-fetch';

var INK = '#0f172a'; var SUB = '#475569'; var LINE = '#cbd5e1';
// the same colours as the warehouse Day Counter: yellow 15-21, orange 8-14, red 0-7, pink past the date
var PHASE_LOOK = { friendly: ['Friendly', '#422006', '#fde047'], firmer: ['Firmer', '#431407', '#fb923c'], urgent: ['Urgent', '#ffffff', '#dc2626'], overdue: ['Beyond urgent', '#500724', '#f9a8d4'] };
var LANG_NAMES = { en: 'English', es: 'Spanish', fr: 'French', ar: 'Arabic' };
function fmt(n) { return '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function when(iso) { if (!iso) { return ''; } try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { return String(iso); } }
export function counterWords(days) { return days < 0 ? Math.abs(days) + ' day' + (days === -1 ? '' : 's') + ' past' : (days === 0 ? 'today' : days + ' day' + (days === 1 ? '' : 's')); }

// the list — no state of its own, so it can be rendered and checked on its own
export function ArrivalRemindersView(p) {
  var rows = p.rows || [];
  var head = ['Release', 'Customer', 'Route · container', 'Arrival', 'Day counter', 'Stage', 'Invoice total', 'Received', 'Still owed', 'Last reminder', ''];
  return <table className="w-full text-[12px]" style={{ background: '#ffffff', border: '1px solid ' + LINE }}>
    <thead><tr style={{ background: '#f1f5f9', color: '#334155' }}>{head.map(function (h, i) { return <th key={i} className={'px-2 py-1.5 font-bold ' + (i >= 6 && i <= 8 ? 'text-right' : 'text-left')}>{h}</th>; })}</tr></thead>
    <tbody>
      {rows.map(function (r) {
        var look = PHASE_LOOK[r.phase] || PHASE_LOOK.friendly; var last = r.reminders && r.reminders.last;
        return <tr key={r.order_id} style={{ borderTop: '1px solid ' + LINE, color: INK }}>
          <td className="px-2 py-1.5 font-extrabold">{r.release_number || '(none)'}</td>
          <td className="px-2 py-1.5">{r.customer || '—'}{r.hub_customer && r.hub_customer !== r.customer && <div style={{ color: SUB, fontSize: 10 }}>{'Hub invoice: ' + r.hub_customer}</div>}</td>
          <td className="px-2 py-1.5">{(r.pol || '?') + ' → ' + (r.country || '?')}{r.pol_needs_confirm && <div style={{ color: '#9a3412', fontSize: 10, fontWeight: 800 }}>{'Port of loading to confirm (release ' + (r.release_prefix || 'has no prefix') + ')'}</div>}<div style={{ color: SUB, fontSize: 10 }}>{'Container ' + (r.container || '—')}</div></td>
          <td className="px-2 py-1.5">{r.arrival_date}</td>
          <td className="px-2 py-1.5 font-extrabold" style={{ color: look[1], background: look[2] }}>{counterWords(r.days)}</td>
          <td className="px-2 py-1.5"><span className="px-1.5 py-0.5 rounded font-extrabold" style={{ color: look[1], background: look[2] }}>{look[0]}</span></td>
          <td className="px-2 py-1.5 text-right tabular-nums">{r.limited ? 'not shown' : (r.balance ? fmt(r.balance.total) : '—')}</td>
          <td className="px-2 py-1.5 text-right tabular-nums">{r.limited ? 'not shown' : (r.balance ? fmt(r.balance.received) : '—')}</td>
          <td className="px-2 py-1.5 text-right tabular-nums font-extrabold" style={{ color: r.balance && r.balance.remaining > 0 ? '#991b1b' : '#065f46' }}>{r.limited ? 'not shown' : (r.balance ? fmt(r.balance.remaining) : '—')}</td>
          <td className="px-2 py-1.5">{last ? <span>{when(last.at)}<div style={{ color: SUB, fontSize: 10 }}>{(PHASE_LOOK[last.phase] ? PHASE_LOOK[last.phase][0] : last.phase) + ' · ' + last.channel + ' · ' + (LANG_NAMES[last.language] || last.language) + ' · ' + r.reminders.sent + ' sent'}</div></span> : <span style={{ color: SUB }}>none yet</span>}
            {r.reminders && r.reminders.unconfirmed && <div className="mt-1 px-1.5 py-0.5 rounded font-extrabold" style={{ color: '#7c2d12', background: '#fed7aa', border: '1px solid #ea580c', fontSize: 10 }}>{'Delivery unconfirmed — ' + when(r.reminders.unconfirmed.at) + (r.reminders.unconfirmed.sent_to ? ' to ' + r.reminders.unconfirmed.sent_to : '') + '. It may have reached the customer.'}</div>}
            {r.reminders && (r.reminders.sent > 0 || r.reminders.unconfirmed) && p.onHistory && <button onClick={function () { p.onHistory(r); }} className="mt-1 underline font-bold" style={{ color: '#1d4ed8', fontSize: 11 }}>History</button>}</td>
          <td className="px-2 py-1.5 text-right">
            {r.blocks.length > 0
              ? <span title={r.blocks.join(' ')} style={{ color: '#991b1b', fontWeight: 800, fontSize: 11 }}>{'Cannot send: ' + r.blocks[0]}</span>
              : <button onClick={function () { p.onPrepare(r); }} className="px-3 py-1.5 rounded-lg text-[12px] font-extrabold" style={{ background: '#1d4ed8', color: '#ffffff' }}>Prepare reminder</button>}
          </td>
        </tr>; })}
      {rows.length === 0 && <tr><td colSpan={11} className="px-2 py-3" style={{ color: SUB }}>No shipped, open order has an arrival date 21 days away or less.</td></tr>}
    </tbody>
  </table>;
}

// ── the send dialog's logic, outside the component so it can be run and checked on its own (Codex 22 Nov 14:19) ──
// open = { row, lang, pol, polDraft, draft, to, ack, again, unsure, sending, note, check }
export function canSendNow(open) {
  var d = open && open.draft; if (!d || !d.can_send || open.sending) { return false; }
  var warns = d.warnings || [];
  return !!(String(open.to || '').indexOf('@') > 0 && (!warns.length || open.ack) && (!open.row.slot_sent || open.again) && (!open.row.slot_unconfirmed || open.unsure));
}
var UNSURE_NOTE = 'DELIVERY UNCONFIRMED — the mail server did not answer, so this reminder may or may not have reached the customer. Open the history and check before sending another one.';
var LOST_NOTE = 'DELIVERY UNCONFIRMED — the answer from the Hub was lost, so the reminder may or may not have gone out. This order was read again: open the history and check before sending another one.';
// io = { call(body) → Promise(answer), getOpen(), setOpen(value | updater), load(), toast(msg, kind), confirm(msg) → boolean }
export function createReminderActions(io) {
  function patch(p) { io.setOpen(function (o) { return o && Object.assign({}, o, p); }); }
  // extra = { note, check }: kept on the dialog through the fresh read (used after an unconfirmed delivery)
  function prepare(row, lang, pol, keepTo, extra) {
    var x = extra || {}; var lg = lang || row.language || 'en'; var pl = String(pol || '').trim();
    // a fresh dialog state: no text, every tick cleared — nothing can be sent until the server has written the reminder again
    io.setOpen({ row: row, lang: lg, pol: pl, polDraft: pl, draft: null, to: keepTo || row.email || '', ack: false, again: false, unsure: false, sending: false, check: !!x.check, keepNote: x.note || '', note: x.note || (row.pol_needs_confirm && !pl ? '' : 'Writing the reminder…') });
    if (row.pol_needs_confirm && !pl) { return Promise.resolve(); } // XG (Max 22 Nov): not 1002 / 1001 → the person confirms the port of loading first
    return io.call({ action: 'preview', order_id: row.order_id, lang: lg, pol: pl }).then(function (j) {
      if (!j.ok) { patch({ note: (x.note ? x.note + ' ' : '') + (j.error || 'Could not write the reminder.') }); return; }
      io.setOpen(function (o) { return o && Object.assign({}, o, { draft: j, note: o.keepNote || '', row: j.row || o.row, to: o.to || j.to || '' }); });
    }, function () { patch({ note: (x.note ? x.note + ' ' : '') + 'Could not reach the Hub — press "Read this order again".' }); });
  }
  function send(test) {
    var o = io.getOpen(); if (!o || !o.draft || o.sending) { return Promise.resolve(); }
    if (!test && !canSendNow(o)) { return Promise.resolve(); } // the button is disabled in this state; a stray click sends nothing
    var to = String(o.to || '').trim();
    if (!test && !io.confirm('Send this reminder to ' + to + ' now?\n\nIt goes to the customer from ' + ((o.draft.mailbox && o.draft.mailbox.from) || 'info@ktcus.com') + '.')) { return Promise.resolve(); }
    io.setOpen(Object.assign({}, o, { sending: true, note: '' }));
    return io.call({ action: 'send', order_id: o.row.order_id, lang: o.lang, pol: o.pol, draft_hash: o.draft.draft_hash, to: to, confirm_to: to, confirm: true, ack_warnings: o.ack, again: o.again, resend_after_unconfirmed: o.unsure, test: !!test }).then(function (j) {
      if (!j.ok) {
        if (j.delivery_unconfirmed && !test) {
          // the reminder may have reached the customer. THIS dialog is put into the unconfirmed state at once (no text, no ticks,
          // Send off), the order is read again into it, and the list is refreshed. Nothing is sent again by itself.
          io.load();
          return prepare(Object.assign({}, o.row, { slot_unconfirmed: true }), o.lang, o.pol, o.to, { note: j.outcome_unknown ? UNSURE_NOTE : (j.error || UNSURE_NOTE), check: true });
        }
        patch({ sending: false, note: j.error || 'Not sent.' });
        if (j.changed) { return prepare(o.row, o.lang, o.pol, o.to); }
        return;
      }
      io.toast(j.test ? 'Test sent to ' + j.to + ' (your own address).' : 'Reminder sent to ' + j.to + '.', 'success');
      if (j.test) { patch({ sending: false, note: 'Test sent to ' + j.to + ' — the customer received nothing.' }); }
      else { io.setOpen(null); io.load(); }
    }, function () {
      if (test) { patch({ sending: false, note: 'The answer was lost — the test may or may not have reached your own address.' }); return; }
      // the answer never came back: treated as unconfirmed until the order has been read again
      io.load();
      return prepare(Object.assign({}, o.row, { slot_unconfirmed: true }), o.lang, o.pol, o.to, { note: LOST_NOTE, check: true });
    });
  }
  return { prepare: prepare, send: send };
}

var OUTCOME = { sent: ['Sent', '#065f46', '#d1fae5'], failed: ['Not sent', '#334155', '#e2e8f0'], unknown: ['Delivery unconfirmed', '#7c2d12', '#fed7aa'], sending: ['Delivery unconfirmed (never finished)', '#7c2d12', '#fed7aa'] };
// every attempt for one order, newest first — no state of its own
export function ReminderHistoryView(p) {
  var rows = p.rows || [];
  if (!rows.length) { return <div className="mt-2 text-[12px]" style={{ color: SUB }}>Nothing has been sent or tried for this order.</div>; }
  return <div className="mt-2">{rows.map(function (x) {
    var o = OUTCOME[x.status] || [x.status, INK, '#e2e8f0'];
    return <div key={x.id} className="mt-2 p-2 rounded" style={{ border: '1px solid ' + LINE }}>
      <div className="flex items-center gap-2 flex-wrap text-[12px]">
        <span className="px-1.5 py-0.5 rounded font-extrabold" style={{ color: o[1], background: o[2] }}>{o[0]}</span>
        {x.mode === 'test' && <span className="px-1.5 py-0.5 rounded font-extrabold" style={{ color: '#1e3a8a', background: '#dbeafe' }}>TEST — not to the customer</span>}
        <b>{when(x.sent_at || x.created_at)}</b><span>{'to ' + x.sent_to}</span><span style={{ color: SUB }}>{(PHASE_LOOK[x.phase] ? PHASE_LOOK[x.phase][0] : x.phase) + ' · ' + (LANG_NAMES[x.language] || x.language) + (x.sent_by_name ? ' · by ' + x.sent_by_name : '')}</span>
      </div>
      {x.error && <div className="text-[11px] mt-1" style={{ color: '#7c2d12' }}>{x.error}</div>}
      {x.withheld ? <div className="text-[11px] mt-1" style={{ color: SUB }}>The text and the amounts of this entry are outside the history you may see.</div>
        : <div><div className="text-[11px] mt-1 font-bold">{x.subject}</div><div dir={x.language === 'ar' ? 'rtl' : 'ltr'} className="text-[11px] mt-1 px-2 py-1 rounded" style={{ background: '#f8fafc', whiteSpace: 'pre-wrap', textAlign: x.language === 'ar' ? 'right' : 'left' }}>{x.body}</div></div>}
    </div>; })}</div>;
}

export default function ArrivalRemindersTab(props) {
  var _d = useState(null); var data = _d[0]; var setData = _d[1];
  var _e = useState(''); var err = _e[0]; var setErr = _e[1];
  var _b = useState(false); var busy = _b[0]; var setBusy = _b[1];
  var _h = useState(null); var hist = _h[0]; var setHist = _h[1];      // { row, rows, note } — every attempt logged for one order
  var openRef = useRef(null);
  var _o = useState(null); var open = _o[0]; var setOpen = _o[1];      // { row, lang, draft, to, ack, again, sending, note }
  function toast(m, kind) { if (props.toast) { props.toast(m, kind); } }
  function call(body) { return hubFetch('/api/accounting/arrival-reminders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) { return r.json().then(function (j) { j._status = r.status; return j; }); }); }
  function load() {
    setBusy(true); setErr('');
    call({ action: 'list' }).then(function (j) { setBusy(false); if (!j.ok) { setErr(j.error || 'Could not load.'); return; } setData(j); }, function () { setBusy(false); setErr('Could not reach the Hub.'); });
  }
  useEffect(function () { load(); }, []);
  // the dialog's state is also kept in a ref, so an answer that arrives later always works on the CURRENT dialog (Codex 22 Nov 14:19)
  function setOpenNow(v) { var nv = typeof v === 'function' ? v(openRef.current) : v; openRef.current = nv; setOpen(nv); }
  var act = createReminderActions({ call: call, getOpen: function () { return openRef.current; }, setOpen: setOpenNow, load: load, toast: toast, confirm: function (m) { return window.confirm(m); } });
  var prepare = act.prepare; var send = act.send;
  function history(row) {
    setHist({ row: row, rows: null, note: 'Reading…' });
    call({ action: 'history', order_id: row.order_id }).then(function (j) { setHist(function (x) { return x && Object.assign({}, x, j.ok ? { rows: j.rows || [], note: '' } : { rows: [], note: j.error || 'Could not read the history.' }); }); }, function () { setHist(function (x) { return x && Object.assign({}, x, { rows: [], note: 'Could not reach the Hub.' }); }); });
  }
  var d = open && open.draft; var warns = d ? (d.warnings || []) : [];
  var canSend = canSendNow(open);
  return <div style={{ color: INK }}>
    <div className="rounded-xl p-3 mb-3" style={{ background: '#ffffff', border: '1px solid ' + LINE }}>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="text-[15px] font-extrabold">📨 Arrival & final-payment reminders</div>
        <button onClick={load} disabled={busy} className="px-3 py-1 rounded-lg text-[12px] font-bold" style={{ background: '#e2e8f0', color: INK }}>{busy ? 'Reading…' : 'Refresh'}</button>
        {data && <span className="text-[11px]" style={{ color: SUB }}>{'Warehouse: ' + (data.source === 'nextrade-live' ? 'LIVE' : 'staging copy') + ' · today ' + data.today + ' (New York) · ' + data.counts.ready + ' ready, ' + data.counts.blocked + ' cannot be sent'}</span>}
      </div>
      <div className="text-[12px] mt-1" style={{ color: SUB }}>Shipped, open orders arriving in 21 days or less. Each reminder tells the customer the expected arrival and asks for the final payment, with the invoice total, what was received and what is still owed. <b>Nothing is sent automatically</b> — you see the message and press Send.</div>
      {data && !data.log_ready && <div className="mt-2 px-3 py-2 rounded text-[12px] font-bold" style={{ background: '#fef3c7', color: '#78350f', border: '1px solid #d97706' }}>{data.sql_hint}</div>}
      {data && data.mailbox && !data.mailbox.configured && <div className="mt-2 px-3 py-2 rounded text-[12px] font-bold" style={{ background: '#fee2e2', color: '#7f1d1d', border: '1px solid #dc2626' }}>The info@ktcus.com mailbox is not connected on the server — reminders can be read here but not sent.</div>}
      {err && <div className="mt-2 px-3 py-2 rounded text-[12px] font-bold" style={{ background: '#fee2e2', color: '#7f1d1d', border: '1px solid #dc2626' }}>{err}</div>}
    </div>
    {data && <ArrivalRemindersView rows={data.rows} onPrepare={function (r) { prepare(r); }} onHistory={history} />}
    {hist && <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', zIndex: 70, overflowY: 'auto' }}>
      <div className="rounded-xl p-4" style={{ background: '#ffffff', color: INK, maxWidth: 820, margin: '40px auto', border: '2px solid #1d4ed8' }}>
        <div className="flex items-center gap-2"><div className="text-[15px] font-extrabold">{'Reminder history — release ' + (hist.row.release_number || '')}</div>
          <button onClick={function () { setHist(null); }} className="ml-auto px-3 py-1 rounded-lg text-[12px] font-bold" style={{ background: '#e2e8f0', color: INK }}>Close</button></div>
        {hist.note && <div className="mt-2 text-[12px] font-bold" style={{ color: SUB }}>{hist.note}</div>}
        {hist.rows && <ReminderHistoryView rows={hist.rows} />}
      </div>
    </div>}
    {open && <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', zIndex: 60, overflowY: 'auto' }}>
      <div className="rounded-xl p-4" style={{ background: '#ffffff', color: INK, maxWidth: 760, margin: '40px auto', border: '2px solid #1d4ed8' }}>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-[15px] font-extrabold">{'Reminder — release ' + (open.row.release_number || '')}</div>
          <span className="px-1.5 py-0.5 rounded font-extrabold text-[11px]" style={{ color: (PHASE_LOOK[open.row.phase] || [])[1], background: (PHASE_LOOK[open.row.phase] || [])[2] }}>{(PHASE_LOOK[open.row.phase] || [''])[0] + ' · ' + counterWords(open.row.days)}</span>
          <button onClick={function () { setOpenNow(null); }} className="ml-auto px-3 py-1 rounded-lg text-[12px] font-bold" style={{ background: '#e2e8f0', color: INK }}>Close</button>
        </div>
        <div className="mt-3 flex items-center gap-2 flex-wrap text-[12px]">
          <b>Language:</b>
          {['en', 'es', 'fr', 'ar'].map(function (l) { return <button key={l} onClick={function () { prepare(open.row, l, open.pol, open.to); }} className="px-3 py-1 rounded-lg font-extrabold" style={open.lang === l ? { background: '#1d4ed8', color: '#ffffff' } : { background: '#ffffff', color: INK, border: '1px solid ' + LINE }}>{LANG_NAMES[l]}</button>; })}
          {!open.row.language_from_warehouse && <span style={{ color: SUB }}>(no language on the customer yet — English unless you pick another)</span>}
        </div>
        {open.row.pol_needs_confirm && <div className="mt-3 px-3 py-2 rounded text-[12px]" style={{ background: '#ffedd5', color: '#7c2d12', border: '2px solid #ea580c' }}>
          <b>{'Confirm the port of loading. '}</b>{'Release ' + (open.row.release_number || '') + ' does not start with 1002 (Houston) or 1001 (Canada), so the Hub does not guess it.'}{open.row.pol_suggestion ? ' The warehouse on the order is "' + open.row.pol_suggestion + '".' : ''}
          <div className="flex items-center gap-2 flex-wrap mt-1">
            <input value={open.polDraft || ''} onChange={function (e) { var v = e.target.value; setOpenNow(function (o) { return Object.assign({}, o, { polDraft: v }); }); }} placeholder="port of loading, as the customer should read it" maxLength={60} className="px-2 py-1.5 rounded" style={{ border: '1px solid ' + LINE, color: INK, background: '#ffffff', minWidth: 280 }} />
            <button onClick={function () { if (String(open.polDraft || '').trim()) { prepare(open.row, open.lang, open.polDraft, open.to); } }} disabled={!String(open.polDraft || '').trim()} className="px-3 py-1.5 rounded-lg font-extrabold" style={{ background: String(open.polDraft || '').trim() ? '#1d4ed8' : '#94a3b8', color: '#ffffff' }}>{open.pol ? 'Change and write again' : 'Confirm and write the reminder'}</button>
            {open.pol && <span style={{ fontWeight: 800 }}>{'Confirmed: ' + open.pol}</span>}
          </div>
        </div>}
        {open.check && <div className="mt-3 px-3 py-2 rounded text-[12px] flex items-center gap-2 flex-wrap" style={{ background: '#fee2e2', color: '#7f1d1d', border: '2px solid #dc2626' }}>
          <b>Check before anything else is sent:</b>
          <button onClick={function () { history(open.row); }} className="px-3 py-1 rounded-lg font-extrabold" style={{ background: '#ffffff', color: '#7f1d1d', border: '1px solid #dc2626' }}>Open the history</button>
          <button onClick={function () { prepare(open.row, open.lang, open.pol, open.to, { note: open.keepNote, check: true }); }} className="px-3 py-1 rounded-lg font-extrabold" style={{ background: '#ffffff', color: '#7f1d1d', border: '1px solid #dc2626' }}>Read this order again</button>
        </div>}
        {open.note && <div className="mt-3 px-3 py-2 rounded text-[12px] font-bold" style={{ background: '#fef3c7', color: '#78350f', border: '1px solid #d97706' }}>{open.note}</div>}
        {d && d.blocks && d.blocks.length > 0 && <div className="mt-3 px-3 py-2 rounded text-[12px] font-bold" style={{ background: '#fee2e2', color: '#7f1d1d', border: '1px solid #dc2626' }}>{'Cannot send: ' + d.blocks.join(' ')}</div>}
        {d && d.subject && <div className="mt-3">
          <div className="text-[11px] font-bold" style={{ color: SUB }}>SUBJECT</div>
          <div className="px-3 py-2 rounded text-[13px] font-bold" style={{ background: '#f1f5f9', border: '1px solid ' + LINE }}>{d.subject}</div>
          <div className="text-[11px] font-bold mt-2" style={{ color: SUB }}>MESSAGE (exactly what the customer receives)</div>
          <div dir={d.rtl ? 'rtl' : 'ltr'} className="px-3 py-2 rounded text-[13px]" style={{ background: '#f8fafc', border: '1px solid ' + LINE, whiteSpace: 'pre-wrap', lineHeight: 1.7, textAlign: d.rtl ? 'right' : 'left' }}>{d.body}</div>
          {warns.length > 0 && <div className="mt-3 px-3 py-2 rounded text-[12px]" style={{ background: '#ffedd5', color: '#7c2d12', border: '2px solid #ea580c' }}>
            <b>Check before sending:</b>{warns.map(function (w, i) { return <div key={i}>{'• ' + w}</div>; })}
            <label className="flex items-center gap-2 mt-1 font-extrabold"><input type="checkbox" checked={open.ack} onChange={function (e) { var v = e.target.checked; setOpenNow(function (o) { return Object.assign({}, o, { ack: v }); }); }} />I checked — it is right to send.</label>
          </div>}
          {open.row.slot_unconfirmed && <div className="mt-3 px-3 py-2 rounded text-[12px]" style={{ background: '#fee2e2', color: '#7f1d1d', border: '2px solid #dc2626' }}>
            <b>Delivery unconfirmed: an earlier reminder for this stage may already have reached the customer.</b> The mail server did not answer, so the Hub cannot say either way (the Sent folder does not settle it). <button onClick={function () { history(open.row); }} className="underline font-extrabold">Open the history</button>, and ask the customer if you need to be sure.
            <label className="flex items-center gap-2 mt-1 font-extrabold"><input type="checkbox" checked={open.unsure} onChange={function (e) { var v = e.target.checked; setOpenNow(function (o) { return Object.assign({}, o, { unsure: v }); }); }} />I checked — send another one.</label>
          </div>}
          {open.row.slot_sent && <div className="mt-3 px-3 py-2 rounded text-[12px]" style={{ background: '#ffedd5', color: '#7c2d12', border: '2px solid #ea580c' }}>
            <b>A reminder for this stage was already sent for this order.</b>
            <label className="flex items-center gap-2 mt-1 font-extrabold"><input type="checkbox" checked={open.again} onChange={function (e) { var v = e.target.checked; setOpenNow(function (o) { return Object.assign({}, o, { again: v }); }); }} />Send another one anyway.</label>
          </div>}
          <div className="mt-3 flex items-center gap-2 flex-wrap text-[12px]">
            <b>Send to:</b>
            <input value={open.to} onChange={function (e) { var v = e.target.value; setOpenNow(function (o) { return Object.assign({}, o, { to: v }); }); }} placeholder="customer e-mail address" className="px-2 py-1.5 rounded" style={{ border: '1px solid ' + LINE, color: INK, background: '#ffffff', minWidth: 280 }} />
            <span style={{ color: SUB }}>{open.row.email ? ('on file in the ' + (open.row.email_from === 'hub' ? 'Hub customer' : 'warehouse customer')) : 'no address on file — type one'}</span>
          </div>
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <button onClick={function () { send(false); }} disabled={!canSend} className="px-4 py-2 rounded-lg text-[13px] font-extrabold" style={{ background: canSend ? '#15803d' : '#94a3b8', color: '#ffffff' }}>{open.sending ? 'Sending…' : 'Send to the customer'}</button>
            <button onClick={function () { send(true); }} disabled={!d.can_send || open.sending || (warns.length > 0 && !open.ack)} className="px-4 py-2 rounded-lg text-[13px] font-extrabold" style={{ background: '#ffffff', color: INK, border: '2px solid #1d4ed8' }}>Send a test to myself</button>
            <span className="text-[11px]" style={{ color: SUB }}>{'From ' + ((d.mailbox && d.mailbox.from) || 'info@ktcus.com') + ' · replies go to that mailbox · every send is logged'}</span>
          </div>
        </div>}
      </div>
    </div>}
  </div>;
}
