// v55.83-YD — Bills → "🧾 Vendor credits" (Max, 23 Nov 2026: "make sure we have ... credit memo for bills").
// A vendor's credit memo is recorded once, then APPLIED to that vendor's open bills (lowers what each owes — no money moves) or marked
// REFUNDED on the money-in bank line the vendor paid it back on. Never more than the credit has left or a bill still owes; undo keeps a
// record. The database checks every step again (sql/v55-83-YD-vendor-credits.sql).
import React, { useState, useEffect } from 'react';
import { hubFetch } from '../lib/hub-fetch';
import { suggestApplication } from '../lib/vendor-credits';

function post(body) {
  return hubFetch('/api/accounting/vendor-credits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'The server did not answer properly (HTTP ' + r.status + ').' }; }); })
    .catch(function (e) { return { ok: false, error: 'Could not reach the server (' + ((e && e.message) || 'network') + ').' }; });
}
function money(v, cur) { return (cur && cur !== 'USD' ? cur + ' ' : '$') + (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function clickId() { return 'vc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10); }
var INK = '#0f172a', SUB = '#334155', MUTED = '#64748b';
var inp = { border: '1px solid #cbd5e1', background: '#ffffff', color: INK };

export default function VendorCreditsPanel(props) {
  var toast = props.toast || { success: function () {}, error: function () {} };
  var s1 = useState(null); var data = s1[0]; var setData = s1[1];
  var s2 = useState(false); var busy = s2[0]; var setBusy = s2[1];
  var s3 = useState(''); var err = s3[0]; var setErr = s3[1];
  var s4 = useState(null); var form = s4[0]; var setForm = s4[1]; // { kind: 'new' | 'apply' | 'refund' | 'undo' | 'void', ... }
  function load() { setBusy(true); return post({ action: 'list' }).then(function (j) { if (j && j.ok) { setData(j); setErr(''); } else { setErr((j && j.error) || 'Could not load the vendor credits.'); } }).finally(function () { setBusy(false); }); }
  useEffect(function () { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  function done(j, words) {
    if (j && j.ok) { toast.success(words + (j.repeat ? ' (already saved — same click)' : '')); setForm(null); if (props.onChanged) { props.onChanged(); } return load(); }
    toast.error((j && j.error) || 'Not done. Nothing was changed.');
  }
  function act(payload, words) { setBusy(true); return post(payload).then(function (j) { return done(j, words); }).finally(function () { setBusy(false); }); }
  function openApply(c) {
    setForm({ kind: 'apply', credit: c, bills: null, amounts: {}, click: clickId(), date: '' });
    post({ action: 'bills_for', credit_id: c.id }).then(function (j) {
      if (!j || !j.ok) { toast.error((j && j.error) || 'Could not read the bills.'); setForm(null); return; }
      var sug = {}; suggestApplication(c.left, j.bills).forEach(function (x) { sug[x.bill_id] = x.amount.toFixed(2); });
      setForm(function (f) { return f && f.kind === 'apply' && f.credit.id === c.id ? Object.assign({}, f, { bills: j.bills, amounts: sug }) : f; });
    });
  }
  function openRefund(c) {
    setForm({ kind: 'refund', credit: c, lines: null, line: '', click: clickId() });
    post({ action: 'refund_candidates', credit_id: c.id }).then(function (j) {
      setForm(function (f) { return f && f.kind === 'refund' && f.credit.id === c.id ? Object.assign({}, f, { lines: (j && j.ok) ? j.lines : [], linesErr: (j && !j.ok) ? j.error : null }) : f; });
    });
  }
  function submit() {
    if (!form) { return; }
    if (form.kind === 'new') {
      return act({ action: 'create', vendor_name: form.vendor, credit_number: form.number, credit_date: form.date, amount: form.amount, currency: form.currency || 'USD', reason: form.reason, request_id: form.click }, 'Credit memo recorded');
    }
    if (form.kind === 'apply') {
      var picks = Object.keys(form.amounts).map(function (k) { return { bill_id: k, amount: Number(form.amounts[k]) }; }).filter(function (x) { return x.amount > 0; });
      if (!picks.length) { toast.error('Enter an amount on at least one bill.'); return; }
      return act({ action: 'apply', credit_id: form.credit.id, bills: picks, applied_date: form.date || null, request_id: form.click }, 'Credit applied');
    }
    if (form.kind === 'refund') {
      if (!form.line) { toast.error('Pick the money-in line the refund arrived on.'); return; }
      return act({ action: 'refund', credit_id: form.credit.id, bank_transaction_id: form.line, request_id: form.click }, 'Refund recorded');
    }
    if (form.kind === 'undo') { return act({ action: 'unapply', application_id: form.use.id, reason: form.reason }, 'Undone'); }
    if (form.kind === 'void') { return act({ action: 'void', credit_id: form.credit.id, reason: form.reason, request_id: form.click }, 'Credit memo voided'); }
  }
  var canManage = !!(data && data.can_manage);
  var btn = function (bg, fg) { return { background: bg, color: fg }; };
  return <div className="mt-3 rounded-xl p-3" style={{ background: '#ffffff', border: '1px solid #cbd5e1' }}>
    <div className="flex items-center gap-2 flex-wrap mb-2">
      <span className="text-sm font-extrabold" style={{ color: INK }}>🧾 Vendor credits</span>
      <span className="text-[11px]" style={{ color: SUB }}>A credit memo from a vendor lowers what we owe that vendor. Apply it to their open bills, or mark it refunded when the money comes back to the bank.</span>
      <span className="flex-1" />
      {canManage && data && data.installed && <button type="button" disabled={busy} onClick={function () { setForm({ kind: 'new', vendor: '', number: '', date: '', amount: '', currency: 'USD', reason: '', click: clickId() }); }} className="px-2 py-1 rounded text-[11px] font-extrabold" style={btn('#1e3a8a', '#ffffff')}>＋ New credit memo</button>}
      {props.onClose && <button type="button" onClick={props.onClose} className="px-2 py-1 rounded text-[11px] font-bold" style={btn('#f1f5f9', SUB)}>Close</button>}
    </div>
    {err && <div className="text-[12px] font-bold p-2 rounded mb-2" style={{ background: '#fee2e2', color: '#7f1d1d' }}>{err}</div>}
    {data && !data.installed && <div className="text-[12px] p-2 rounded" style={{ background: '#fff7ed', color: '#9a3412' }}>{data.sql_missing}</div>}
    {data && data.installed && data.window_from && <div className="text-[10px] mb-1" style={{ color: MUTED }}>{'Showing credit memos from ' + data.window_from + ' (your history window).'}</div>}
    {data && data.installed && <div className="text-[10px] mb-2 p-1.5 rounded" style={{ background: '#f8fafc', color: SUB }}>Not counted yet in Profitability / P&L costs, the ClickBooks ledger or Wave: a credit lowers what a bill still owes (Bills, wires, payments). Profitability shows the credits applied in its dates as a pending adjustment (not final) until that is built.</div>}
    {form && form.kind === 'new' && <div className="p-2 rounded mb-2 flex flex-wrap gap-2 items-end" style={{ background: '#eff6ff' }}>
      <label className="text-[11px] font-bold" style={{ color: SUB }}>Vendor<br /><input value={form.vendor} onChange={function (e) { setForm(Object.assign({}, form, { vendor: e.target.value })); }} className="px-2 py-1 rounded text-[12px]" style={inp} /></label>
      <label className="text-[11px] font-bold" style={{ color: SUB }}>Credit memo #<br /><input value={form.number} onChange={function (e) { setForm(Object.assign({}, form, { number: e.target.value })); }} className="px-2 py-1 rounded text-[12px] w-28" style={inp} /></label>
      <label className="text-[11px] font-bold" style={{ color: SUB }}>Date<br /><input type="date" value={form.date} onChange={function (e) { setForm(Object.assign({}, form, { date: e.target.value })); }} className="px-2 py-1 rounded text-[12px]" style={inp} /></label>
      <label className="text-[11px] font-bold" style={{ color: SUB }}>Amount<br /><input inputMode="decimal" value={form.amount} onChange={function (e) { setForm(Object.assign({}, form, { amount: e.target.value })); }} className="px-2 py-1 rounded text-[12px] w-28" style={inp} /></label>
      <label className="text-[11px] font-bold" style={{ color: SUB }}>Currency<br /><input value={form.currency} onChange={function (e) { setForm(Object.assign({}, form, { currency: e.target.value.toUpperCase().slice(0, 3) })); }} className="px-2 py-1 rounded text-[12px] w-16" style={inp} /></label>
      <label className="text-[11px] font-bold flex-1" style={{ color: SUB }}>What it is for<br /><input value={form.reason} onChange={function (e) { setForm(Object.assign({}, form, { reason: e.target.value })); }} className="px-2 py-1 rounded text-[12px] w-full" style={inp} /></label>
      <button type="button" disabled={busy} onClick={submit} className="px-3 py-1 rounded text-[11px] font-extrabold" style={btn('#1e3a8a', '#ffffff')}>Save credit memo</button>
      <button type="button" onClick={function () { setForm(null); }} className="px-2 py-1 rounded text-[11px] font-bold" style={btn('#f1f5f9', SUB)}>Cancel</button>
    </div>}
    {busy && !data && <div className="text-[12px]" style={{ color: MUTED }}>Loading…</div>}
    {data && data.installed && !data.credits.length && <div className="text-[12px]" style={{ color: MUTED }}>No vendor credits recorded.</div>}
    {data && data.installed && data.credits.length > 0 && <table className="w-full text-[12px]"><thead><tr style={{ color: SUB }}>
      <th className="text-left p-1">Vendor</th><th className="text-left p-1">Credit memo</th><th className="text-left p-1">Date</th><th className="text-right p-1">Amount</th><th className="text-right p-1">Applied</th><th className="text-right p-1">Refunded</th><th className="text-right p-1">Left</th><th className="p-1" /></tr></thead>
      <tbody>{data.credits.map(function (c) {
        var live = c.record_status === 'active';
        return <React.Fragment key={c.id}><tr style={{ borderTop: '1px solid #e2e8f0', color: live ? INK : MUTED }}>
          <td className="p-1 font-bold">{c.vendor_name}</td><td className="p-1">{c.credit_number}{!live && <span className="ml-1 text-[10px]">{'(voided: ' + (c.void_reason || '') + ')'}</span>}<div className="text-[10px]" style={{ color: MUTED }}>{c.reason}</div></td>
          <td className="p-1">{c.credit_date}</td><td className="p-1 text-right tabular-nums">{money(c.total, c.currency)}</td><td className="p-1 text-right tabular-nums">{money(c.applied, c.currency)}</td>
          <td className="p-1 text-right tabular-nums">{money(c.refunded, c.currency)}</td><td className="p-1 text-right tabular-nums font-extrabold">{money(c.left, c.currency)}</td>
          <td className="p-1 text-right whitespace-nowrap">{canManage && live && c.left > 0.004 && <span>
            <button type="button" disabled={busy} onClick={function () { openApply(c); }} className="px-2 py-0.5 rounded text-[10px] font-bold mr-1" style={btn('#dcfce7', '#14532d')}>Apply to bills</button>
            <button type="button" disabled={busy} onClick={function () { openRefund(c); }} className="px-2 py-0.5 rounded text-[10px] font-bold mr-1" style={btn('#e0f2fe', '#075985')}>Refund received</button></span>}
            {canManage && live && c.applied < 0.005 && c.refunded < 0.005 && <button type="button" disabled={busy} onClick={function () { setForm({ kind: 'void', credit: c, reason: '', click: clickId() }); }} className="px-2 py-0.5 rounded text-[10px] font-bold" style={btn('#fee2e2', '#7f1d1d')}>Void</button>}</td></tr>
          {c.uses.length > 0 && <tr><td colSpan={8} className="pl-6 pb-1">{c.uses.map(function (u) {
            return <div key={u.id} className="text-[11px]" style={{ color: u.voided ? MUTED : SUB, textDecoration: u.voided ? 'line-through' : 'none' }}>
              {(u.kind === 'refund' ? 'Refunded on the bank line of ' + u.date : 'Applied to bill ' + (u.bill || '') + ' on ' + u.date) + ' · '}<b className="tabular-nums">{money(u.amount, c.currency)}</b>
              {u.voided && <span>{' — undone: ' + (u.void_reason || '')}</span>}
              {canManage && !u.voided && <button type="button" disabled={busy} onClick={function () { setForm({ kind: 'undo', use: u, reason: '' }); }} className="ml-2 underline text-[10px] font-bold" style={{ color: '#7f1d1d' }}>Undo</button>}</div>;
          })}</td></tr>}
          {form && (form.kind === 'apply' || form.kind === 'refund' || form.kind === 'void') && form.credit.id === c.id && <tr><td colSpan={8} className="p-2" style={{ background: form.kind === 'void' ? '#fef2f2' : '#f0fdf4' }}>
            {form.kind === 'apply' && (form.bills === null ? <span style={{ color: MUTED }}>Looking for this vendor's open bills…</span> : !form.bills.length ? <span style={{ color: MUTED }}>This vendor has no open bills in {c.currency}.</span> : <div>
              <div className="text-[11px] font-extrabold mb-1" style={{ color: INK }}>{'Apply up to ' + money(c.left, c.currency) + ' — oldest first is filled in; change any amount (never more than a bill still owes).'}</div>
              {form.bills.map(function (b) { return <div key={b.id} className="flex items-center gap-2 text-[11px] mb-0.5" style={{ color: SUB }}>
                <span className="w-56">{(b.bill_number || '(no number)') + ' · ' + (b.bill_date || '')}</span><span className="w-48 tabular-nums">{'owes ' + money(b.owed, c.currency) + (b.on_wires ? ' (+' + money(b.on_wires, c.currency) + ' on a wire)' : '')}</span>
                <input inputMode="decimal" value={form.amounts[b.id] || ''} onChange={function (e) { var a = Object.assign({}, form.amounts); a[b.id] = e.target.value; setForm(Object.assign({}, form, { amounts: a })); }} className="px-2 py-0.5 rounded w-28 text-[11px]" style={inp} /></div>; })}
              <label className="text-[11px] mr-2" style={{ color: SUB }}>Date (optional) <input type="date" value={form.date} onChange={function (e) { setForm(Object.assign({}, form, { date: e.target.value })); }} className="px-1 py-0.5 rounded text-[11px]" style={inp} /></label>
              <button type="button" disabled={busy} onClick={submit} className="px-3 py-1 rounded text-[11px] font-extrabold" style={btn('#14532d', '#ffffff')}>Apply credit</button></div>)}
            {form.kind === 'refund' && (form.lines === null ? <span style={{ color: MUTED }}>Looking for money-in lines…</span> : form.linesErr ? <span style={{ color: '#7f1d1d' }}>{form.linesErr}</span> : !form.lines.length ? <span style={{ color: MUTED }}>No money-in line of at most {money(c.left, c.currency)} since {c.credit_date} that is free (not an invoice payment, transfer or other refund).</span> : <div>
              <div className="text-[11px] font-extrabold mb-1" style={{ color: INK }}>The money-in line the refund arrived on (the whole line is used; it then is only this refund):</div>
              <select value={form.line} onChange={function (e) { setForm(Object.assign({}, form, { line: e.target.value })); }} className="px-2 py-1 rounded text-[11px] mr-2" style={inp}>
                <option value="">— pick the bank line —</option>{form.lines.map(function (l) { return <option key={l.id} value={l.id}>{l.date + ' · ' + l.who + ' · ' + money(l.amount, c.currency)}</option>; })}</select>
              <button type="button" disabled={busy} onClick={submit} className="px-3 py-1 rounded text-[11px] font-extrabold" style={btn('#075985', '#ffffff')}>Record refund</button></div>)}
            {form.kind === 'void' && <div className="flex gap-2 items-center"><span className="text-[11px] font-bold" style={{ color: '#7f1d1d' }}>Void this credit memo (kept, marked voided). Why?</span>
              <input value={form.reason} onChange={function (e) { setForm(Object.assign({}, form, { reason: e.target.value })); }} className="px-2 py-1 rounded text-[11px] flex-1" style={inp} />
              <button type="button" disabled={busy} onClick={submit} className="px-3 py-1 rounded text-[11px] font-extrabold" style={btn('#7f1d1d', '#ffffff')}>Void</button></div>}
            <button type="button" onClick={function () { setForm(null); }} className="ml-2 px-2 py-0.5 rounded text-[10px] font-bold" style={btn('#f1f5f9', SUB)}>Cancel</button></td></tr>}
        </React.Fragment>;
      })}</tbody></table>}
    {form && form.kind === 'undo' && <div className="mt-2 p-2 rounded flex gap-2 items-center" style={{ background: '#fef2f2' }}>
      <span className="text-[11px] font-bold" style={{ color: '#7f1d1d' }}>{'Undo ' + (form.use.kind === 'refund' ? 'this refund' : 'this credit on bill ' + (form.use.bill || '')) + ' (it is kept, marked undone). Why?'}</span>
      <input value={form.reason} onChange={function (e) { setForm(Object.assign({}, form, { reason: e.target.value })); }} className="px-2 py-1 rounded text-[11px] flex-1" style={inp} />
      <button type="button" disabled={busy} onClick={submit} className="px-3 py-1 rounded text-[11px] font-extrabold" style={btn('#7f1d1d', '#ffffff')}>Undo</button>
      <button type="button" onClick={function () { setForm(null); }} className="px-2 py-1 rounded text-[11px] font-bold" style={btn('#f1f5f9', SUB)}>Cancel</button></div>}
  </div>;
}
