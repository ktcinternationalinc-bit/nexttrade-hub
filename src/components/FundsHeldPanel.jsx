'use client';
// v55.83-WF — FUNDS WITH RTM / NEXTTRADE (Max, 20 Nov 2026): money KTC already sent each company, transfer by transfer —
// what it paid, what was explicitly marked "services rendered", what is reserved for a request not sent yet, and what is
// still available. Nothing here is an expense by itself; only "services rendered" is. A transfer is spendable only once it
// is CONFIRMED. Every write goes to the server (which goes to the database): this screen computes nothing it then saves.
// Works with or without the WF database step: without it the list shows and the buttons say what is needed.
// Inline colours on white panels (the dark theme repaints bg-white).
import React, { useState, useEffect } from 'react';
import { hubFetch } from '../lib/hub-fetch';
import { noBillsLinked, linkTarget } from '../lib/partner-fee'; // v55.83-ZP — transfers with no bills linked, said plainly
import { startingBalanceToPay, openingPickAmount, NEXTRADE_OPEN_WIRE_EVENT, NEXTRADE_PAY_OPENING_EVENT } from '../lib/nextrade-bill-groups'; // v55.83-XX

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
// v55.83-XR (Max 22 Nov, Option 1): Money back is ON — in the tax report it reduces Professional fees in the month the money comes back
export var REFUNDS_ON = true;
// what the person may do with one transfer right now (pure — tested)
export function transferActions(t, o) {
  var can = !!(o && o.canManage) && !!(o && o.installed);
  return {
    confirm: can && t.status === 'needs_reconciliation',
    unconfirm: can && t.status === 'confirmed',
    markFee: can && t.status === 'confirmed' && Number(t.available) > 0.005,
    reverseFee: can && t.status !== 'to_confirm_identity',
    refund: REFUNDS_ON && can && t.status !== 'to_confirm_identity' && Number(t.held) - Number(t.reserved || 0) > 0.005, // v55.83-WF B2 — money back from the company (held)
    recordPaid: can && t.status === 'needs_reconciliation' && Number(t.held) > 0.005, // v55.83-WF — history: bills the company ALREADY paid out of it, before confirming
    why: !(o && o.installed) ? 'not switched on yet' : !(o && o.canManage) ? 'needs the 🔒 Advances: Manage permission' : t.status === 'to_confirm_identity' ? 'mark this bank line as sent to the company first (All Transactions)' : '',
  };
}

// v55.83-XO — what the super admin may do with one starting balance right now (pure — tested). Staff get nothing here.
export var STARTING_BALANCE_PAY_FROM = '2026-06-01';
export function startingBalanceActions(sb, o) {
  var can = !!(o && o.canStart) && !!(o && o.installed);
  var left = Number(sb && sb.left);
  return { pay: can && left > 0.005, correct: can && !sb?.rolling && Number(sb && sb.amount) > 0.005, add: can,
    why: !(o && o.canStart) ? '' : !(o && o.installed) ? 'needs sql/v55-83-XO-starting-balance.sql first' : left > 0.005 ? '' : 'nothing left on it' };
}

export default function FundsHeldPanel(props) {
  var userProfile = props.userProfile; var toast = props.toast || { success: function () {}, error: function () {} };
  var s1 = useState(null); var data = s1[0]; var setData = s1[1];
  var s2 = useState(false); var busy = s2[0]; var setBusy = s2[1];
  var s3 = useState(''); var err = s3[0]; var setErr = s3[1];
  var s4 = useState({}); var open = s4[0]; var setOpen = s4[1];
  var s5 = useState(null); var form = s5[0]; var setForm = s5[1]; // { kind: 'mark' | 'reverse', party, id, fee, amount, date, reason }
  var s6 = useState(false); var shown = s6[0]; var setShown = s6[1];
  var s7 = useState(null); var payAsk = s7[0]; var setPayAsk = s7[1]; // v55.83-XX — { bill_id, bill_number, party, text, bad, offerWire } from 🟦 Nextrade bills → Pay ▸
  var s8 = useState(null); var linkMsg = s8[0]; var setLinkMsg = s8[1]; // v55.83-ZP — { party, text } after “🔗 Link the bills it paid”
  // v55.83-ZP (Max 26 Nov: "isnt the 76000 linked to bills so it was sent and spent toward ktc bills") — open the right place to link
  // the bills a transfer paid: its “📎 Record bills already paid” form when that is open for it, otherwise say plainly what to do first.
  // Nothing is written by this; the person ticks the bills and saves as before.
  function linkBills(p, transferId, d) {
    var dd = d || data || {};
    var lt = linkTarget(p.transfers, transferId, function (t) { return transferActions(t, { canManage: dd.can_manage, installed: dd.installed }).recordPaid; });
    if (!lt) { setLinkMsg({ party: p.party, text: 'Every transfer to ' + p.party + ' shown here already has bills linked to it.' }); return; }
    var t = lt.transfer; setOpen(function (o0) { var o = Object.assign({}, o0); o[t.id] = true; return o; });
    if (lt.how === 'record') { openRecordPaid(p, t); setLinkMsg({ party: p.party, text: 'Tick the bills ' + p.party + ' already paid out of the transfer of ' + t.date + ' (' + fmt(t.sent) + '), the date it paid them and the proof — below.' }); }
    else if (lt.how === 'confirmed') { setLinkMsg({ party: p.party, text: 'The transfer of ' + t.date + ' is confirmed. To record bills ' + p.party + ' ALREADY paid from it, press “Undo confirm” on its row first (it goes back to “needs reconciliation”). New bills paid from it go through Wires → ＋ New wire → ' + p.party + '.' }); }
    else { var why = transferActions(t, { canManage: dd.can_manage, installed: dd.installed }).why; setLinkMsg({ party: p.party, text: 'The transfer of ' + t.date + ' cannot take bills yet' + (why ? ': ' + why : '') + '.' }); }
    setTimeout(function () { try { var el = document.getElementById('nt-funds-transfer-' + t.id); if (el && el.scrollIntoView) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } } catch (eS) { /* old browser */ } }, 80);
  }
  // opened from the P&L funds box (Accounting → Bills): load, find the company, open its first transfer with nothing linked
  var tgN = props.openTarget && props.openTarget.n;
  useEffect(function () {
    var tg = props.openTarget; if (!tg || !tg.n) { return; }
    setShown(true); setForm(null); setLinkMsg({ party: tg.party, text: 'Opening the transfers to ' + tg.party + '…' });
    try { var el = document.getElementById('nt-funds-held'); if (el && el.scrollIntoView) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } } catch (eS) { /* old browser */ }
    setBusy(true);
    api({ action: 'funds' }).then(function (j) {
      if (!(j && j.ok)) { setErr((j && j.error) || 'Could not load the funds.'); setLinkMsg({ party: tg.party, text: 'The funds did not load, so nothing was opened. Press ↻ Refresh and try again.' }); return; }
      setData(j); setErr('');
      var key = String(tg.party).toUpperCase().replace(/[^A-Z0-9]/g, '');
      var pp = (j.parties || []).filter(function (x) { return String(x.party).toUpperCase().replace(/[^A-Z0-9]/g, '') === key; })[0];
      if (!pp) { setLinkMsg({ party: tg.party, text: 'No transfers to ' + tg.party + ' are shown here (they may be in a private account, or outside the history you may see).' }); return; }
      linkBills(pp, tg.transfer_id, j);
    }).finally(function () { setBusy(false); });
  }, [tgN]); // eslint-disable-line react-hooks/exhaustive-deps

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
  // v55.83-WF (Codex 21 Nov 09:05) — Record bills already paid: history, not a new payment. The person ticks the bills, types the date
  // the company actually paid them, a reference / where the proof is, and confirms they were ALREADY paid out of this transfer.
  function openRecordPaid(p, t) {
    setForm({ kind: 'record_paid', party: p.party, id: t.id, max: Number(t.held), date: '', reference: '', reason: '', already: false, picks: {}, bills: null, click: clickId() });
    api({ action: 'record_paid_candidates', party: p.party, bank_transaction_id: t.id }).then(function (j) { setForm(function (f) { return f && f.kind === 'record_paid' && f.id === t.id ? Object.assign({}, f, { bills: (j && j.ok) ? (j.bills || []) : [], billsErr: (j && j.ok) ? '' : ((j && j.error) || 'Could not load the bills.') }) : f; }); });
  }
  function pickedTotal(fm) { var tot = 0; Object.keys((fm && fm.picks) || {}).forEach(function (k) { tot += Number(String(fm.picks[k] || '').replace(/,/g, '')) || 0; }); return Math.round(tot * 100) / 100; }
  function saveRecordPaid() {
    var rows = Object.keys(form.picks || {}).map(function (k) { return { bill_id: k, amount: Number(String(form.picks[k] || '').replace(/,/g, '')) || 0 }; }).filter(function (x) { return x.amount > 0; });
    if (!rows.length) { toast.error('Tick at least one bill and give its amount.'); return; }
    if (!form.date) { toast.error('Type the date ' + form.party + ' actually paid these bills.'); return; }
    if (String(form.reference || '').trim().length < 3) { toast.error('Type the payment reference or where the proof is.'); return; }
    if (form.already !== true) { toast.error('Tick that these bills were ALREADY paid by ' + form.party + ' out of this transfer.'); return; }
    if (String(form.reason || '').trim().length < 3) { toast.error('Say why, in a few words.'); return; }
    act({ action: 'record_paid', party: form.party, bank_transaction_id: form.id, bills: rows, paid_date: form.date, reference: form.reference, already_paid: true, reason: form.reason, allow_closed: form.closed === true, request_id: form.click }, rows.length + ' bill(s) recorded as already paid by ' + form.party);
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
  // v55.83-XO — STARTING BALANCE (super admin): add one, correct one, pay bills from one
  function openOpeningAdd(p) { setForm({ kind: 'opening_add', party: p.party, id: 'sb-add:' + p.party, amount: '', date: '', reason: '', visible: null, click: clickId() }); }
  function openOpeningCorrect(p, sb) { setForm({ kind: 'opening_correct', party: p.party, id: 'sb:' + sb.id, sb: sb.id, amount: '', reason: '', max: Number(sb.left), click: clickId() }); }
  // presetBill (v55.83-XX) = the bill chosen in 🟦 Nextrade bills → Pay ▸: ticked for what is still owed, never more than is left on the balance
  function openOpeningPay(p, sb, presetBill) {
    setForm({ kind: 'opening_pay', party: p.party, id: 'sb:' + sb.id, sb: sb.id, asOf: sb.as_of, max: Number(sb.left), date: '', reference: '', reason: '', picks: {}, bills: null, click: clickId() });
    api({ action: 'opening_pay_candidates', party: p.party, opening_id: sb.id }).then(function (j) { setForm(function (f) {
      if (!(f && f.kind === 'opening_pay' && f.sb === sb.id)) { return f; }
      var nf = Object.assign({}, f, { bills: (j && j.ok) ? (j.bills || []) : [], billsErr: (j && j.ok) ? '' : ((j && j.error) || 'Could not load the bills.') });
      if (presetBill && j && j.ok) {
        var hitB = nf.bills.filter(function (x) { return String(x.id) === String(presetBill); })[0]; var amt = hitB ? openingPickAmount(hitB, sb.left) : null;
        if (amt) { var pk = Object.assign({}, nf.picks); pk[hitB.id] = amt; nf.picks = pk; nf.presetNote = (hitB.vendor || 'The bill') + ' ' + (hitB.bill_number || '') + ' is ticked for $' + amt + '. Fill the paid date, the reference and why, then Pay.'; }
        else { nf.presetNote = 'That bill is not among the bills this balance can pay (it may be on an open wire, already paid, or not in US dollars).'; nf.presetBad = true; }
      }
      return nf;
    }); });
  }
  // v55.83-XX (Max, 23 Nov: "use available balance for nextrade that we enter in the beginning ... until all done") — 🟦 Nextrade bills →
  // Pay ▸ → "From the NextTrade starting balance": open this panel, pick the OLDEST NextTrade starting balance with money left, tick the bill.
  // No balance with money left → said plainly, with the other way (a KTC transfer to NextTrade) one click away. Nothing is paid by opening it.
  useEffect(function () {
    function onPayOpening(e) {
      var d = (e && e.detail) || {}; if (!d.bill_id) { return; }
      var base = { bill_id: d.bill_id, bill_number: d.bill_number || '', party: d.party || 'NextTrade Industries' };
      setShown(true); setForm(null); setPayAsk(Object.assign({}, base, { text: 'Looking for the NextTrade starting balance…' }));
      try { var el = document.getElementById('nt-funds-held'); if (el && el.scrollIntoView) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } } catch (eS) { /* old browser */ }
      setBusy(true);
      api({ action: 'funds' }).then(function (j) {
        if (!(j && j.ok)) { setErr((j && j.error) || 'Could not load the funds.'); setPayAsk(Object.assign({}, base, { bad: true, offerWire: true, text: 'The funds did not load (' + ((j && j.error) || 'error') + '), so the starting balance cannot be used right now.' })); return; }
        setData(j); setErr('');
        var pick = startingBalanceToPay(j, base.party, d.source);
        if (!pick.ok) { setPayAsk(Object.assign({}, base, { bad: true, offerWire: true, text: pick.why })); return; }
        var sourceLabel = d.source === 'managed_sales' ? 'NextTrade-managed sales' : 'the NextTrade starting balance';
        setPayAsk(Object.assign({}, base, { text: 'Bill ' + (base.bill_number || '') + ' is selected for payment from ' + sourceLabel + ' (' + fmt(pick.sb.left) + ' available).' }));
        openOpeningPay(pick.party, pick.sb, base.bill_id);
      }).finally(function () { setBusy(false); });
    }
    try { window.addEventListener(NEXTRADE_PAY_OPENING_EVENT, onPayOpening); } catch (e0) { return undefined; }
    return function () { try { window.removeEventListener(NEXTRADE_PAY_OPENING_EVENT, onPayOpening); } catch (e1) {} };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  function payFromTransferInstead(a) {
    setPayAsk(null);
    try { window.dispatchEvent(new CustomEvent(NEXTRADE_OPEN_WIRE_EVENT, { detail: { payee: a.party, bill_id: a.bill_id, bill_number: a.bill_number } })); } catch (e) { /* old browser */ }
  }
  function saveOpening() {
    if (form.kind === 'opening_pay') {
      var rows = Object.keys(form.picks || {}).map(function (k) { return { bill_id: k, amount: Number(String(form.picks[k] || '').replace(/,/g, '')) || 0 }; }).filter(function (x) { return x.amount > 0; });
      if (!rows.length) { toast.error('Tick at least one bill and give its amount.'); return; }
      if (!form.date || form.date < STARTING_BALANCE_PAY_FROM) { toast.error('Pick the paid date — 1 June 2026 or later.'); return; }
      if (String(form.reference || '').trim().length < 3) { toast.error('Type the payment reference or where the proof is.'); return; }
      if (String(form.reason || '').trim().length < 3) { toast.error('Say why, in a few words.'); return; }
      act({ action: 'opening_pay', party: form.party, opening_id: form.sb, bills: rows, paid_date: form.date, reference: form.reference, reason: form.reason, allow_closed: form.closed === true, request_id: form.click }, rows.length + ' bill(s) paid from the starting balance with ' + form.party);
      return;
    }
    var a = Number(String(form.amount || '').replace(/,/g, ''));
    if (!(a > 0)) { toast.error('Type an amount above zero.'); return; }
    if (String(form.reason || '').trim().length < 10) { toast.error('Say where this number comes from (at least 10 characters).'); return; }
    if (form.kind === 'opening_add') {
      if (!form.date) { toast.error('Pick the date this balance is as of.'); return; }
      if (form.visible !== true && form.visible !== false) { toast.error('Say whether staff may see this balance.'); return; }
      act({ action: 'opening_add', party: form.party, amount: a, as_of: form.date, reason: form.reason, visible_to_staff: form.visible, request_id: form.click }, 'Starting balance of ' + fmt(a) + ' with ' + form.party + ' saved');
    } else {
      act({ action: 'opening_add', party: form.party, amount: -a, corrects_id: form.sb, reason: form.reason, request_id: form.click }, 'Starting balance lowered by ' + fmt(a));
    }
  }
  var chip = function (st) { var w = STATUS_WORDS[st] || STATUS_WORDS.needs_reconciliation; return <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded" style={{ background: w.bg, color: w.fg }}>{w.text}</span>; };

  return <div id="nt-funds-held" className="rounded-xl p-3 mt-3" style={{ background: '#ffffff', color: INK, border: '1px solid #e2e8f0' }}>
    <div className="flex items-center gap-2 flex-wrap">
      <button type="button" onClick={function () { setShown(!shown); }} className="text-[14px] font-extrabold" style={{ color: INK }}>{(shown ? '▾ ' : '▸ ') + '🏦 Funds with RTM / NextTrade'}</button>
      <span className="text-[11px]" style={{ color: MUTED }}>Money already sent to each company: what it paid, services rendered, reserved, and what is still available. Unused money is never an expense.</span>
      {shown && <button type="button" onClick={load} disabled={busy} className="px-2 py-1 rounded text-[10px] font-bold" style={{ background: '#e0f2fe', color: '#075985' }}>{busy ? 'Loading…' : '↻ Refresh'}</button>}
    </div>
    {shown && err && <div className="text-[12px] p-2 rounded mt-2" style={{ background: '#fef2f2', color: '#991b1b' }}>{err}</div>}
    {shown && payAsk && <div className="text-[12px] p-2 rounded mt-2 flex gap-2 items-center flex-wrap font-bold" style={payAsk.bad ? { background: '#fef2f2', color: '#991b1b', border: '1px solid #fca5a5' } : { background: '#eff6ff', color: '#1e3a8a', border: '1px solid #93c5fd' }}>
      <span>{'🟦 ' + payAsk.text}</span>
      {payAsk.offerWire && <button type="button" onClick={function () { payFromTransferInstead(payAsk); }} className="px-2 py-1 rounded text-[11px] font-extrabold" style={{ background: '#1d4ed8', color: '#ffffff' }}>From a KTC transfer to NextTrade →</button>}
      <button type="button" onClick={function () { setPayAsk(null); }} className="px-2 py-1 rounded text-[10px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>✕</button></div>}
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
            {T.starting_balance > 0.005 ? <span>· plus starting balance left <b style={{ color: '#075985' }}>{fmt(T.starting_balance_left)}</b></span> : null}
          </div> : <div className="text-[11px]" style={{ color: MUTED }}>{'Totals hidden — ' + (p.totals_hidden || 'no permission') + '.'}</div>}
        </div>
                {/* v55.83-ZP — money sent and nothing linked: it all shows as held. Say so, and offer the place to link. */}
        {T && noBillsLinked(T) && <div className="text-[12px] mt-1 font-bold rounded px-2 py-1 flex gap-2 items-center flex-wrap" style={{ background: '#fef3c7', color: '#92400e' }}>
          <span>{'These transfers to ' + p.party + ' are not linked to any bills yet, so all of it shows as held. If ' + p.party + ' already paid KTC bills with it, link them to the transfer.'}</span>
          <button type="button" disabled={busy} onClick={function () { linkBills(p, null); }} className="px-2 py-0.5 rounded text-[11px] font-extrabold" style={{ background: '#92400e', color: '#ffffff' }}>🔗 Link the bills it paid</button></div>}
        {linkMsg && linkMsg.party === p.party && <div className="text-[11px] mt-1 rounded px-2 py-1 flex gap-2 items-center" style={{ background: '#eff6ff', color: '#1e3a8a' }}><span>{linkMsg.text}</span><button type="button" onClick={function () { setLinkMsg(null); }} className="px-1.5 rounded text-[10px] font-bold" style={{ background: '#e2e8f0', color: '#334155' }}>✕</button></div>}
        {p.needs_reconciliation && <div className="text-[11px] mt-1 font-bold" style={{ color: '#b45309' }}>{'⚠ Needs reconciliation' + (p.paid_without_a_transfer_count ? ': ' + p.paid_without_a_transfer_count + ' bill payment(s) made through ' + p.party + ' name no transfer' + (T ? ' (' + fmt(T.paid_without_a_transfer) + ') — held funds are overstated by that until they are linked' : '') : ': the records disagree on a transfer') + '.'}</div>}
        {p.hidden_private_transfers > 0 && <div className="text-[11px] mt-1" style={{ color: MUTED }}>{p.hidden_private_transfers + ' transfer(s) from a private account are not shown.'}</div>}
        {/* v55.83-XO — the starting balance(s) with this company: money it already held for KTC before the Hub. Never money sent. */}
        {(function () {
          var sbo = { canStart: data.can_starting_balance, installed: data.starting_balances_installed }; var addA = startingBalanceActions({}, sbo);
          var sbs = p.starting_balances || [];
          return <div className="mt-2">
            {sbs.map(function (sb) { var sa = startingBalanceActions(sb, sbo);
              return <div key={sb.id} className="rounded p-2 mt-1 text-[12px]" style={{ background: '#f0f9ff', border: '1px solid #bae6fd', color: INK }}>
                <div className="flex gap-3 items-baseline flex-wrap">
                  <b>{sb.rolling ? 'NextTrade-managed sales balance' : (sb.source === 'managed_sales' ? 'NextTrade-managed sales balance' : 'Starting balance held with ' + p.party) + ', as of ' + sb.as_of}</b>
                  <span>amount <b>{fmt(sb.amount)}</b>{sb.corrections_count > 0 ? <span style={{ color: MUTED }}>{' (corrected ' + sb.corrections_count + '×)'}</span> : null}</span>
                  <span>· used on bills <b>{fmt(sb.used)}</b></span><span>· left <b style={{ color: sb.left < 0 ? '#991b1b' : '#166534' }}>{fmt(sb.left)}</b></span>
                  {data.can_starting_balance && <span className="text-[10px] font-bold" style={{ color: sb.visible_to_staff ? '#166534' : '#92400e' }}>{sb.visible_to_staff ? 'staff can see it' : 'only you can see it'}</span>}
                  {sa.pay && <button type="button" disabled={busy} onClick={function () { openOpeningPay(p, sb); }} className="px-2 py-0.5 rounded text-[10px] font-extrabold" style={{ background: '#075985', color: '#ffffff' }}>Pay bills from it</button>}
                  {sa.correct && <button type="button" disabled={busy} onClick={function () { openOpeningCorrect(p, sb); }} className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>Lower it (correction)</button>}
                </div>
                <div className="text-[10px]" style={{ color: MUTED }}>{sb.rolling
                  ? 'Posted sales ' + fmt(sb.sales) + ' − remittances to KTC ' + fmt(sb.remitted) + ' − sales reversals ' + fmt(sb.reversed) + '. The balance updates as transactions and payments are recorded.'
                  : 'Where the number comes from: ' + (sb.reason || '—') + '. This is not money sent in any period. Bills paid from it count in their own categories; for the tax report each one is a new expense on the day it is paid (1 June 2026 or later).'}</div>
                {sb.bills && sb.bills.length > 0 && <div className="mt-1">{sb.bills.map(function (b, i) { return <div key={i} className="text-[11px] flex gap-2 flex-wrap"><span>{b.paid_date}</span><b>{b.vendor}</b><span>{'bill ' + (b.bill_number || '—')}</span><span style={{ color: MUTED }}>{b.category}</span><span className="tabular-nums font-bold">{fmt(b.portion)}</span></div>; })}</div>}
                {form && form.id === 'sb:' + sb.id && form.kind === 'opening_correct' && <div className="flex gap-2 items-center flex-wrap mt-2 p-2 rounded" style={{ background: '#ffffff' }}>
                  <span className="text-[11px] font-extrabold">{'Lower this starting balance by (it cannot go below what is already used; ' + fmt(form.max) + ' can come off):'}</span>
                  <span className="text-[11px] font-bold">$</span><input autoFocus className={inp} style={Object.assign({ width: 110 }, inpS)} value={form.amount} onChange={function (e) { setForm(Object.assign({}, form, { amount: e.target.value })); }} />
                  <input className={inp} style={Object.assign({ minWidth: 240 }, inpS)} value={form.reason} placeholder="why it is lower (at least 10 characters)" onChange={function (e) { setForm(Object.assign({}, form, { reason: e.target.value })); }} />
                  <button type="button" disabled={busy} onClick={saveOpening} className="px-2 py-1 rounded text-[11px] font-extrabold" style={{ background: INK, color: '#ffffff' }}>{busy ? 'Saving…' : 'Save'}</button>
                  <button type="button" onClick={function () { setForm(null); }} className="px-2 py-1 rounded text-[11px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>Cancel</button>
                </div>}
                {form && form.id === 'sb:' + sb.id && form.kind === 'opening_pay' && <div className="mt-2 p-2 rounded" style={{ background: '#ffffff', border: '1px solid #bae6fd' }}>
                  <div className="text-[12px] font-extrabold">{'Pay KTC bills from the starting balance with ' + p.party + ' (no bank money moves; ' + fmt(form.max) + ' left):'}</div>
                  {form.presetNote && <div className="text-[11px] font-bold mb-1" style={{ color: form.presetBad ? '#991b1b' : '#1e3a8a' }}>{'🟦 ' + form.presetNote}</div>}
                  <div className="text-[11px] mb-1" style={{ color: SUB }}>{'Tick the bills ' + p.party + ' paid (or will pay) out of this balance and the amount of each. The paid date must be 1 June 2026 or later' + (form.asOf > STARTING_BALANCE_PAY_FROM ? ' and not before ' + form.asOf : '') + '.'}</div>
                  {form.bills === null ? <div className="text-[11px]" style={{ color: MUTED }}>Looking for open bills…</div> : form.billsErr ? <div className="text-[11px]" style={{ color: '#991b1b' }}>{form.billsErr}</div> : form.bills.length === 0 ? <div className="text-[11px]" style={{ color: MUTED }}>No open bill can be paid from it.</div> :
                    <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid #e0f2fe', borderRadius: 6 }}>{form.bills.map(function (b) { var on = Object.prototype.hasOwnProperty.call(form.picks || {}, b.id);
                      return <label key={b.id} className="flex gap-2 items-center text-[11px] px-2 py-0.5" style={{ color: INK, borderTop: '1px solid #f0f9ff' }}>
                        <input type="checkbox" checked={on} onChange={function (e) { var pk = Object.assign({}, form.picks); if (e.target.checked) { pk[b.id] = String(b.open); } else { delete pk[b.id]; } setForm(Object.assign({}, form, { picks: pk })); }} />
                        <span>{b.bill_date || '—'}</span><b>{b.vendor}</b><span>{'bill ' + (b.bill_number || '—')}</span><span style={{ color: MUTED }}>{'open ' + fmt(b.open)}</span>{!b.via ? <span style={{ color: MUTED }}>{'(will be marked paid through ' + p.party + ')'}</span> : null}
                        {on && <input className={inp} style={Object.assign({ width: 90 }, inpS)} value={form.picks[b.id]} onChange={function (e) { var pk = Object.assign({}, form.picks); pk[b.id] = e.target.value; setForm(Object.assign({}, form, { picks: pk })); }} />}
                      </label>; })}</div>}
                  <div className="flex gap-2 items-center flex-wrap mt-2">
                    <span className="text-[11px] font-bold">{'picked ' + fmt(pickedTotal(form)) + ' of ' + fmt(form.max) + ' left'}</span>
                    <span className="text-[11px] font-bold">paid date</span><input type="date" className={inp} style={inpS} value={form.date} min={form.asOf > STARTING_BALANCE_PAY_FROM ? form.asOf : STARTING_BALANCE_PAY_FROM} max={today()} onChange={function (e) { setForm(Object.assign({}, form, { date: e.target.value })); }} />
                    <input className={inp} style={Object.assign({ minWidth: 200 }, inpS)} value={form.reference} placeholder="payment reference / where the proof is (required)" onChange={function (e) { setForm(Object.assign({}, form, { reference: e.target.value })); }} />
                    <input className={inp} style={Object.assign({ minWidth: 180 }, inpS)} value={form.reason} placeholder="why (required)" onChange={function (e) { setForm(Object.assign({}, form, { reason: e.target.value })); }} />
                    {data.can_closed_month && <label className="text-[10px] font-bold" style={{ color: SUB }}><input type="checkbox" checked={form.closed === true} onChange={function (e) { setForm(Object.assign({}, form, { closed: e.target.checked })); }} /> the date is in a closed month — record it as a correction</label>}
                    <button type="button" disabled={busy} onClick={saveOpening} className="px-2 py-1 rounded text-[11px] font-extrabold" style={{ background: INK, color: '#ffffff' }}>{busy ? 'Saving…' : 'Pay'}</button>
                    <button type="button" onClick={function () { setForm(null); }} className="px-2 py-1 rounded text-[11px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>Cancel</button>
                  </div></div>}
              </div>; })}
            {p.hidden_starting_balances > 0 && <div className="text-[11px] mt-1" style={{ color: MUTED }}>{p.hidden_starting_balances + ' starting balance(s) are not shown to you.'}</div>}
            {data.can_starting_balance && <div className="mt-1">
              {addA.add ? <button type="button" disabled={busy} onClick={function () { openOpeningAdd(p); }} className="px-2 py-0.5 rounded text-[10px] font-extrabold" style={{ background: '#e0f2fe', color: '#075985' }}>+ Starting balance</button>
                : <span className="text-[10px]" style={{ color: MUTED }}>{'+ Starting balance: ' + (data.starting_balance_sql_missing || addA.why)}</span>}
              {form && form.id === 'sb-add:' + p.party && <div className="flex gap-2 items-center flex-wrap mt-1 p-2 rounded" style={{ background: '#f0f9ff', border: '1px solid #bae6fd' }}>
                <span className="text-[12px] font-extrabold">{'Money ' + p.party + ' already held for KTC before the Hub (it is not money sent now):'}</span>
                <span className="text-[11px] font-bold">$</span><input autoFocus className={inp} style={Object.assign({ width: 110 }, inpS)} value={form.amount} onChange={function (e) { setForm(Object.assign({}, form, { amount: e.target.value })); }} />
                <span className="text-[11px] font-bold">as of</span><input type="date" className={inp} style={inpS} value={form.date} max={today()} onChange={function (e) { setForm(Object.assign({}, form, { date: e.target.value })); }} />
                <input className={inp} style={Object.assign({ minWidth: 260 }, inpS)} value={form.reason} placeholder="where the number comes from (e.g. their statement of 31 May)" onChange={function (e) { setForm(Object.assign({}, form, { reason: e.target.value })); }} />
                <span className="text-[11px] font-bold">May staff see it?</span>
                <label className="text-[11px]"><input type="radio" checked={form.visible === true} onChange={function () { setForm(Object.assign({}, form, { visible: true })); }} /> yes</label>
                <label className="text-[11px]"><input type="radio" checked={form.visible === false} onChange={function () { setForm(Object.assign({}, form, { visible: false })); }} /> no, only me</label>
                <button type="button" disabled={busy} onClick={saveOpening} className="px-2 py-1 rounded text-[11px] font-extrabold" style={{ background: INK, color: '#ffffff' }}>{busy ? 'Saving…' : 'Save'}</button>
                <button type="button" onClick={function () { setForm(null); }} className="px-2 py-1 rounded text-[11px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>Cancel</button>
              </div>}
            </div>}
          </div>;
        })()}
        <div style={{ overflowX: 'auto' }}><table className="w-full text-[12px] mt-2" style={{ color: INK }}>
          <thead><tr style={{ background: '#f1f5f9', color: SUB }}><th className="p-1 text-left">Transfer</th><th className="p-1 text-left">Status</th><th className="p-1 text-right">Sent</th><th className="p-1 text-right">To bills</th><th className="p-1 text-right">Services rendered</th><th className="p-1 text-right">Reserved</th><th className="p-1 text-right">Available</th><th className="p-1"></th></tr></thead>
          <tbody>{p.transfers.map(function (t) {
            var a = transferActions(t, { canManage: data.can_manage, installed: data.installed }); var isOpen = !!open[t.id];
            return <React.Fragment key={t.id}>
              <tr id={'nt-funds-transfer-' + t.id} style={{ borderTop: '1px solid #e2e8f0' }}>
                <td className="p-1"><button type="button" onClick={function () { var o = Object.assign({}, open); o[t.id] = !isOpen; setOpen(o); }} className="font-bold text-left" style={{ color: '#1d4ed8' }}>{(isOpen ? '▾ ' : '▸ ') + t.date}</button><div className="text-[10px]" style={{ color: MUTED }}>{String(t.reference || '').substring(0, 60)}</div></td>
                <td className="p-1">{chip(t.status)}{t.database_agrees === false ? <div className="text-[10px] font-bold" style={{ color: '#b91c1c' }}>the database and the report disagree — tell Claude</div> : null}</td>
                <td className="p-1 text-right tabular-nums">{fmt(t.sent)}{t.refunded > 0.005 ? <div className="text-[10px]" style={{ color: MUTED }}>{'− ' + fmt(t.refunded) + ' back'}</div> : null}</td><td className="p-1 text-right tabular-nums">{fmt(t.to_bills)}</td><td className="p-1 text-right tabular-nums">{fmt(t.services_rendered)}</td>
                <td className="p-1 text-right tabular-nums">{fmt(t.reserved)}</td><td className="p-1 text-right tabular-nums font-extrabold" style={{ color: '#166534' }}>{fmt(t.available)}</td>
                <td className="p-1 whitespace-nowrap text-right">
                  {a.confirm && <button type="button" disabled={busy} onClick={function () { setState(p, t, true); }} className="px-2 py-0.5 rounded text-[10px] font-extrabold" style={{ background: '#166534', color: '#ffffff' }}>✓ Confirm</button>}
                  {a.markFee && <button type="button" disabled={busy} onClick={function () { setForm({ kind: 'mark', party: p.party, id: t.id, amount: '', date: today(), reason: '', click: clickId(), max: t.available }); }} className="ml-1 px-2 py-0.5 rounded text-[10px] font-extrabold" style={{ background: '#7c2d12', color: '#ffffff' }}>Mark services rendered</button>}
                  {a.recordPaid && <button type="button" disabled={busy} onClick={function () { openRecordPaid(p, t); }} title="Bills this company ALREADY paid out of this transfer, before it is confirmed (history — no money is sent)" className="ml-1 px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#fef3c7', color: '#92400e' }}>📎 Record bills already paid</button>}
                  {a.refund && <button type="button" disabled={busy} onClick={function () { openRefund(p, t); }} className="ml-1 px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#e0f2fe', color: '#075985' }}>↩ Money back</button>}
                  {a.unconfirm && <button type="button" disabled={busy} onClick={function () { setState(p, t, false); }} className="ml-1 px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>Undo confirm</button>}
                  {!a.confirm && !a.markFee && !a.unconfirm && !a.refund && !a.recordPaid && a.why ? <span className="text-[10px]" style={{ color: MUTED }}>{a.why}</span> : null}
                </td>
              </tr>
              {form && form.id === t.id && form.kind === 'record_paid' && <tr><td colSpan={8} className="p-2" style={{ background: '#fffbeb' }}>
                <div className="text-[12px] font-extrabold">{'Record bills ' + p.party + ' ALREADY paid out of this transfer (history — no money is sent, nothing is approved here):'}</div>
                <div className="text-[11px] mb-1" style={{ color: SUB }}>{'Only bills that were really paid by ' + p.party + ' from this money. A new bill that still needs paying goes through Wires → New → ' + p.party + ' (two signatures). Type the date ' + p.party + ' paid, not the date we sent the money.'}</div>
                {form.bills === null ? <div className="text-[11px]" style={{ color: MUTED }}>Looking for open bills…</div> : form.billsErr ? <div className="text-[11px]" style={{ color: '#991b1b' }}>{form.billsErr}</div> : form.bills.length === 0 ? <div className="text-[11px]" style={{ color: MUTED }}>No open bill can be recorded here.</div> :
                  <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid #fde68a', borderRadius: 6 }}>{form.bills.map(function (b) { var on = Object.prototype.hasOwnProperty.call(form.picks || {}, b.id);
                    return <label key={b.id} className="flex gap-2 items-center text-[11px] px-2 py-0.5" style={{ color: b.same_currency === false ? MUTED : INK, borderTop: '1px solid #fef3c7' }} title={b.same_currency === false ? 'This bill is in ' + b.currency + ' and the transfer is not — it cannot be recorded against it (no conversion is made).' : ''}>
                      <input type="checkbox" disabled={b.same_currency === false} checked={on} onChange={function (e) { var pk = Object.assign({}, form.picks); if (e.target.checked) { pk[b.id] = String(b.open); } else { delete pk[b.id]; } setForm(Object.assign({}, form, { picks: pk })); }} />
                      <span>{b.bill_date || '—'}</span><b>{b.vendor}</b><span>{'bill ' + (b.bill_number || '—')}</span><span style={{ color: MUTED }}>{'open ' + fmt(b.open) + (b.currency !== 'USD' ? ' ' + b.currency : '')}</span>{b.same_currency === false ? <span className="font-bold" style={{ color: '#b45309' }}>{'other currency — cannot be recorded here'}</span> : null}
                      {on && <input className={inp} style={Object.assign({ width: 90 }, inpS)} value={form.picks[b.id]} onChange={function (e) { var pk = Object.assign({}, form.picks); pk[b.id] = e.target.value; setForm(Object.assign({}, form, { picks: pk })); }} />}
                    </label>; })}</div>}
                <div className="flex gap-2 items-center flex-wrap mt-2">
                  <span className="text-[11px] font-bold">{'picked ' + fmt(pickedTotal(form)) + ' of ' + fmt(form.max) + ' held'}</span>
                  <span className="text-[11px] font-bold">{'date ' + p.party + ' paid'}</span><input type="date" className={inp} style={inpS} value={form.date} max={today()} onChange={function (e) { setForm(Object.assign({}, form, { date: e.target.value })); }} />
                  <input className={inp} style={Object.assign({ minWidth: 200 }, inpS)} value={form.reference} placeholder="payment reference / where the proof is (required)" onChange={function (e) { setForm(Object.assign({}, form, { reference: e.target.value })); }} />
                  <input className={inp} style={Object.assign({ minWidth: 180 }, inpS)} value={form.reason} placeholder="why (required)" onChange={function (e) { setForm(Object.assign({}, form, { reason: e.target.value })); }} />
                  <label className="text-[11px] font-bold" style={{ color: '#92400e' }}><input type="checkbox" checked={form.already === true} onChange={function (e) { setForm(Object.assign({}, form, { already: e.target.checked })); }} />{' these bills were already paid by ' + p.party + ' out of this transfer'}</label>
                  {data.can_closed_month && <label className="text-[10px] font-bold" style={{ color: SUB }}><input type="checkbox" checked={form.closed === true} onChange={function (e) { setForm(Object.assign({}, form, { closed: e.target.checked })); }} /> the date is in a closed month — record it as a correction</label>}
                  <button type="button" disabled={busy} onClick={saveRecordPaid} className="px-2 py-1 rounded text-[11px] font-extrabold" style={{ background: INK, color: '#ffffff' }}>{busy ? 'Saving…' : 'Record'}</button>
                  <button type="button" onClick={function () { setForm(null); }} className="px-2 py-1 rounded text-[11px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>Cancel</button>
                </div></td></tr>}
              {form && form.id === t.id && form.kind !== 'record_paid' && <tr><td colSpan={8} className="p-2" style={{ background: form.kind === 'mark' ? '#fff7ed' : form.kind === 'refund' ? '#eff6ff' : '#f0fdf4' }}>
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
