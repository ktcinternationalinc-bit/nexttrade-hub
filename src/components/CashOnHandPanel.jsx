// v55.83-YF — Accounting → 💵 Cash on Hand (Max, 23 Nov 2026: "make sure we have a cash on hand to pay invoices").
// The cash box of KTC USA: its balance, every movement, and four actions — cash received for an invoice, a bill paid in cash, cash taken to
// the bank (paired with the bank's deposit line, so it is never counted twice), and (super admin) a cash count change. Every entry needs
// who handed over / received the cash and a receipt number or note. Undo keeps the record. The database checks everything again.
import React, { useState, useEffect } from 'react';
import { hubFetch } from '../lib/hub-fetch';
import { todayET } from '../lib/et-time';

function post(body) {
  return hubFetch('/api/accounting/cash', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'The server did not answer properly (HTTP ' + r.status + ').' }; }); })
    .catch(function (e) { return { ok: false, error: 'Could not reach the server (' + ((e && e.message) || 'network') + ').' }; });
}
function money(v) { return '$' + (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function clickId() { return 'cash-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10); }
var INK = '#0f172a', SUB = '#334155', MUTED = '#64748b';
var inp = { border: '1px solid #cbd5e1', background: '#ffffff', color: INK };
var KIND = { receive_invoice: 'Cash received — invoice', pay_bill: 'Bill paid in cash', deposit: 'Taken to the bank', adjust_in: 'Cash count — added', adjust_out: 'Cash count — taken out' };
function cashPayload(f) {
  return { entry_date: f.date, amount: f.amount, person: f.person, reference: f.reference, note: f.note || null, request_id: f.click };
}
function CashField(p) {
  return <label className="text-[11px] font-bold" style={{ color: SUB }}>{p.label}<br />
    <input value={p.value} onChange={function (e) { p.onChange(e.target.value); }} className={'px-2 py-1 rounded text-[12px] nt-light ' + (p.cls || '')}
      style={inp} type={p.type || 'text'} inputMode={p.mode} required={p.required} minLength={p.minLength} maxLength={p.maxLength} min={p.min} max={p.max} step={p.step} />
  </label>;
}

export function CashInvoiceReceipt(p) {
  var [form, setForm] = useState(null);
  var [busy, setBusy] = useState(false);
  var [error, setError] = useState('');
  function open() {
    setError('');
    setForm({ date: todayET(), amount: '', person: '', reference: '', note: '', click: clickId() });
  }
  function field(label, key, options) {
    return <CashField {...options} label={label} value={form[key]} onChange={function (value) {
      setForm(function (current) { return Object.assign({}, current, { [key]: value }); });
    }} />;
  }
  function save(e) {
    e.preventDefault();
    if (busy) { return; }
    if (form.person.trim().length < 2 || form.reference.trim().length < 2) {
      setError('Enter who received the cash and a receipt number or short note.'); return;
    }
    setBusy(true); setError('');
    post(Object.assign({ action: 'receive_invoice', invoice_id: p.invoiceId }, cashPayload(form))).then(function (j) {
      if (!j || !j.ok) { setError((j && j.error) || 'Could not record the cash receipt.'); return; }
      setForm(null);
      p.toast.success('Cash received and applied to this invoice.');
      p.onSaved();
    }).finally(function () { setBusy(false); });
  }
  if (!form) {
    return <button type="button" onClick={open} className="rounded px-2 py-1 text-[11px] font-bold" style={{ background: '#dcfce7', color: '#14532d' }}>Record cash received</button>;
  }
  return <form onSubmit={save} className="rounded-lg p-2 mb-2" style={{ background: '#f8fafc', border: '1px solid #cbd5e1', color: INK }}>
    <div className="text-[12px] font-bold mb-1">Record cash received · {money(p.due)} due</div>
    <div className="flex flex-wrap gap-2 items-end">
      {field('Date received', 'date', { type: 'date', max: todayET(), required: true })}
      {field('Amount ($)', 'amount', { type: 'number', mode: 'decimal', cls: 'w-28', min: '0.01', max: p.due, step: '0.01', required: true })}
      {field('Received by', 'person', { required: true, minLength: 2, maxLength: 120 })}
      {field('Receipt # / note', 'reference', { required: true, minLength: 2, maxLength: 120 })}
      {field('Note (optional)', 'note', { maxLength: 300 })}
    </div>
    {error && <div role="alert" className="mt-2 text-[11px] font-bold" style={{ color: '#991b1b' }}>{error}</div>}
    <div className="mt-2 flex gap-2">
      <button type="submit" disabled={busy} className="rounded px-2 py-1 text-[11px] font-bold" style={{ background: '#14532d', color: '#ffffff' }}>{busy ? 'Saving…' : 'Save cash receipt'}</button>
      <button type="button" disabled={busy} onClick={function () { setForm(null); }} className="rounded px-2 py-1 text-[11px] font-bold" style={{ background: '#e2e8f0', color: INK }}>Cancel</button>
    </div>
  </form>;
}

export default function CashOnHandPanel(props) {
  var toast = props.toast || { success: function () {}, error: function () {} };
  var s1 = useState(null); var data = s1[0]; var setData = s1[1];
  var s2 = useState(false); var busy = s2[0]; var setBusy = s2[1];
  var s3 = useState(''); var err = s3[0]; var setErr = s3[1];
  var s4 = useState(null); var form = s4[0]; var setForm = s4[1];
  function load() { setBusy(true); return post({ action: 'summary' }).then(function (j) { if (j && j.ok) { setData(j); setErr(''); } else { setErr((j && j.error) || 'Could not load Cash on Hand.'); } }).finally(function () { setBusy(false); }); }
  useEffect(function () { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  function open(kind) {
    var f = { kind: kind, date: (data && data.today) || '', amount: '', person: '', reference: '', note: '', click: clickId(), q: '', items: null, pick: '', lines: null, line: '', direction: 'in' };
    setForm(f);
    if (kind === 'receive_invoice' || kind === 'pay_bill') { search(f, ''); }
  }
  function search(f, q) {
    var action = f.kind === 'receive_invoice' ? 'open_invoices' : 'open_bills';
    post({ action: action, q: q }).then(function (j) { setForm(function (g) { return g && g.kind === f.kind ? Object.assign({}, g, { items: j && j.ok ? (j.invoices || j.bills || []) : [], itemsErr: j && !j.ok ? j.error : null }) : g; }); });
  }
  function findLines() {
    if (!(Number(form.amount) > 0)) { toast.error('Enter the amount first.'); return; }
    post({ action: 'deposit_lines', amount: form.amount, since: form.date }).then(function (j) { setForm(function (g) { return g ? Object.assign({}, g, { lines: j && j.ok ? j.lines : [], linesErr: j && !j.ok ? j.error : null }) : g; }); });
  }
  function submit() {
    var f = form; if (!f) { return; }
    var base = cashPayload(f);
    var payload = null; var words = 'Saved';
    if (f.kind === 'receive_invoice') { if (!f.pick) { toast.error('Pick the invoice.'); return; } payload = Object.assign({ action: 'receive_invoice', invoice_id: f.pick }, base); words = 'Cash received recorded'; }
    else if (f.kind === 'pay_bill') { if (!f.pick) { toast.error('Pick the bill.'); return; } payload = Object.assign({ action: 'pay_bill', bill_id: f.pick }, base); words = 'Cash payment recorded'; }
    else if (f.kind === 'deposit') { payload = Object.assign({ action: 'deposit', bank_transaction_id: f.line || null }, base); words = f.line ? 'Deposit recorded and paired with the bank line' : 'Deposit recorded — pair it when the bank line arrives'; }
    else if (f.kind === 'adjust') { payload = Object.assign({ action: 'adjust', direction: f.direction }, base); words = 'Cash count recorded'; }
    else if (f.kind === 'undo') { payload = { action: 'undo', entry_id: f.entry.id, reason: f.note }; words = 'Undone'; }
    else if (f.kind === 'pair') { if (!f.line) { toast.error('Pick the bank line.'); return; } payload = { action: 'deposit_pair', entry_id: f.entry.id, bank_transaction_id: f.line }; words = 'Paired'; }
    setBusy(true);
    post(payload).then(function (j) {
      if (j && j.ok) { toast.success(words + (j.repeat ? ' (already saved — same click)' : '') + (j.balance !== undefined ? ' · Cash on Hand ' + money(j.balance) : '')); setForm(null); return load(); }
      toast.error((j && j.error) || 'Not done. Nothing was changed.');
    }).finally(function () { setBusy(false); });
  }
  var btn = function (bg, fg) { return { background: bg, color: fg }; };
  var field = function (label, key, extra) { return <CashField {...extra} label={label} value={form[key]} onChange={function (value) { setForm(Object.assign({}, form, { [key]: value })); }} />; };
  return <div className="rounded-xl p-3" style={{ background: '#ffffff', border: '1px solid #cbd5e1' }}>
    <div className="flex items-center gap-3 flex-wrap mb-2">
      <span className="text-sm font-extrabold" style={{ color: INK }}>💵 Cash on Hand — KTC USA</span>
      {data && data.installed && <span className="text-lg font-extrabold tabular-nums" style={{ color: '#14532d' }}>{money(data.balance)}</span>}
      <span className="text-[11px]" style={{ color: SUB }}>Physical cash: received for invoices, paid out for bills, taken to the bank. Never below zero.</span>
    </div>
    {err && <div className="text-[12px] font-bold p-2 rounded mb-2" style={{ background: '#fee2e2', color: '#7f1d1d' }}>{err}</div>}
    {data && !data.installed && <div className="text-[12px] p-2 rounded" style={{ background: '#fff7ed', color: '#9a3412' }}>{data.sql_missing}</div>}
    {data && data.installed && data.can_record && <div className="flex gap-2 flex-wrap mb-2">
      <button type="button" disabled={busy} onClick={function () { open('receive_invoice'); }} className="px-2 py-1 rounded text-[11px] font-extrabold" style={btn('#dcfce7', '#14532d')}>＋ Cash received for an invoice</button>
      <button type="button" disabled={busy} onClick={function () { open('pay_bill'); }} className="px-2 py-1 rounded text-[11px] font-extrabold" style={btn('#fee2e2', '#7f1d1d')}>− Pay a bill in cash</button>
      <button type="button" disabled={busy} onClick={function () { open('deposit'); }} className="px-2 py-1 rounded text-[11px] font-extrabold" style={btn('#e0f2fe', '#075985')}>🏦 Cash taken to the bank</button>
      {data.can_adjust && <button type="button" disabled={busy} onClick={function () { open('adjust'); }} className="px-2 py-1 rounded text-[11px] font-bold" style={btn('#f1f5f9', SUB)}>Cash count (super admin)</button>}
    </div>}
    {data && data.installed && !data.can_record && <div className="text-[11px] mb-2" style={{ color: MUTED }}>Recording cash needs the "Cash on Hand: record" switch (the super admin grants it).</div>}
    {form && form.kind !== 'undo' && form.kind !== 'pair' && <div className="p-2 rounded mb-2" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
      <div className="text-[12px] font-extrabold mb-1" style={{ color: INK }}>{form.kind === 'adjust' ? 'Cash count change' : KIND[form.kind]}</div>
      {(form.kind === 'receive_invoice' || form.kind === 'pay_bill') && <div className="mb-2">
        <input placeholder={form.kind === 'receive_invoice' ? 'search invoice # or customer' : 'search vendor or bill #'} value={form.q} onChange={function (e) { var q = e.target.value; setForm(Object.assign({}, form, { q: q })); search(form, q); }} className="px-2 py-1 rounded text-[12px] w-72 mb-1" style={inp} />
        {form.items === null ? <div className="text-[11px]" style={{ color: MUTED }}>Loading…</div> : form.itemsErr ? <div className="text-[11px]" style={{ color: '#7f1d1d' }}>{form.itemsErr}</div> : <select value={form.pick} onChange={function (e) { var id = e.target.value; var it = (form.items || []).filter(function (x) { return x.id === id; })[0]; setForm(Object.assign({}, form, { pick: id, amount: it ? String(form.kind === 'receive_invoice' ? it.due : it.owed) : form.amount })); }} className="px-2 py-1 rounded text-[12px] w-full" style={inp}>
          <option value="">{form.items.length ? '— pick —' : 'nothing open'}</option>
          {form.items.map(function (x) { return <option key={x.id} value={x.id}>{form.kind === 'receive_invoice' ? ((x.number || '(no number)') + ' · ' + (x.customer || '') + ' · ' + (x.date || '') + ' · due ' + money(x.due)) : ((x.vendor || '') + ' ' + (x.number || '') + ' · ' + (x.date || '') + ' · owed ' + money(x.owed))}</option>; })}</select>}
      </div>}
      <div className="flex gap-2 flex-wrap items-end">
        {field('Date the cash moved', 'date', { type: 'date' })}
        {field('Amount ($)', 'amount', { mode: 'decimal', cls: 'w-28' })}
        {form.kind === 'adjust' && <label className="text-[11px] font-bold" style={{ color: SUB }}>Direction<br /><select value={form.direction} onChange={function (e) { setForm(Object.assign({}, form, { direction: e.target.value })); }} className="px-2 py-1 rounded text-[12px]" style={inp}><option value="in">added to the box</option><option value="out">taken out of the box</option></select></label>}
        {field(form.kind === 'pay_bill' ? 'Paid by (who handed it over)' : form.kind === 'deposit' ? 'Taken to the bank by' : form.kind === 'adjust' ? 'Counted by' : 'Received by (who took the cash)', 'person')}
        {field('Receipt # / note (required)', 'reference')}
        {field(form.kind === 'adjust' ? 'Reason (required)' : 'Note (optional)', 'note', { cls: 'w-64' })}
      </div>
      {form.kind === 'deposit' && <div className="mt-2 text-[11px]" style={{ color: SUB }}>
        <button type="button" onClick={findLines} className="px-2 py-0.5 rounded text-[11px] font-bold mr-2" style={btn('#e0f2fe', '#075985')}>Find the bank's deposit line</button>
        {form.lines === null ? <span>(optional now — you can pair it when the line arrives)</span> : form.linesErr ? <span style={{ color: '#7f1d1d' }}>{form.linesErr}</span> : !form.lines.length ? <span>No free money-in line of that amount yet — save now and pair it later.</span> :
          <select value={form.line} onChange={function (e) { setForm(Object.assign({}, form, { line: e.target.value })); }} className="px-2 py-1 rounded text-[11px]" style={inp}><option value="">— not yet —</option>{form.lines.map(function (l) { return <option key={l.id} value={l.id}>{l.date + ' · ' + l.who + ' · ' + money(l.amount)}</option>; })}</select>}
      </div>}
      <div className="mt-2 flex gap-2"><button type="button" disabled={busy} onClick={submit} className="px-3 py-1 rounded text-[11px] font-extrabold" style={btn('#1e3a8a', '#ffffff')}>Save</button>
        <button type="button" onClick={function () { setForm(null); }} className="px-2 py-1 rounded text-[11px] font-bold" style={btn('#f1f5f9', SUB)}>Cancel</button></div>
    </div>}
    {form && (form.kind === 'undo' || form.kind === 'pair') && <div className="p-2 rounded mb-2 flex gap-2 items-center flex-wrap" style={{ background: form.kind === 'undo' ? '#fef2f2' : '#eff6ff' }}>
      <span className="text-[11px] font-bold" style={{ color: form.kind === 'undo' ? '#7f1d1d' : '#075985' }}>{form.kind === 'undo' ? 'Undo this cash entry (it is kept, marked undone; its payment is voided). Why?' : 'Pair this deposit with the bank\'s money-in line:'}</span>
      {form.kind === 'undo' ? <input value={form.note} onChange={function (e) { setForm(Object.assign({}, form, { note: e.target.value })); }} className="px-2 py-1 rounded text-[11px] flex-1" style={inp} />
        : form.lines === null ? <span className="text-[11px]" style={{ color: MUTED }}>Looking…</span> : !form.lines.length ? <span className="text-[11px]" style={{ color: MUTED }}>No free money-in line of {money(form.entry.amount)} yet.</span>
        : <select value={form.line} onChange={function (e) { setForm(Object.assign({}, form, { line: e.target.value })); }} className="px-2 py-1 rounded text-[11px]" style={inp}><option value="">— pick —</option>{form.lines.map(function (l) { return <option key={l.id} value={l.id}>{l.date + ' · ' + l.who + ' · ' + money(l.amount)}</option>; })}</select>}
      <button type="button" disabled={busy} onClick={submit} className="px-3 py-1 rounded text-[11px] font-extrabold" style={btn(form.kind === 'undo' ? '#7f1d1d' : '#075985', '#ffffff')}>{form.kind === 'undo' ? 'Undo' : 'Pair'}</button>
      <button type="button" onClick={function () { setForm(null); }} className="px-2 py-1 rounded text-[11px] font-bold" style={btn('#f1f5f9', SUB)}>Cancel</button></div>}
    {data && data.installed && data.window_from && <div className="text-[10px] mb-1" style={{ color: MUTED }}>{'Showing cash entries from ' + data.window_from + ' (your history window). The balance is the whole box.'}</div>}
    {data && data.installed && (data.entries || []).length === 0 && <div className="text-[12px]" style={{ color: MUTED }}>No cash recorded yet.</div>}
    {data && data.installed && (data.entries || []).length > 0 && <table className="w-full text-[12px]"><thead><tr style={{ color: SUB }}><th className="text-left p-1">Date</th><th className="text-left p-1">What</th><th className="text-left p-1">For</th><th className="text-left p-1">Who · receipt</th><th className="text-right p-1">In</th><th className="text-right p-1">Out</th><th className="p-1" /></tr></thead>
      <tbody>{data.entries.map(function (e) {
        return <tr key={e.id} style={{ borderTop: '1px solid #e2e8f0', color: e.voided ? MUTED : INK, textDecoration: e.voided ? 'line-through' : 'none' }}>
          <td className="p-1">{e.date}</td><td className="p-1">{KIND[e.kind] || e.kind}{e.kind === 'deposit' && !e.paired && !e.voided && <span className="ml-1 text-[10px] font-bold" style={{ color: '#9a3412', textDecoration: 'none' }}>(bank line not paired yet)</span>}</td>
          <td className="p-1">{e.invoice ? 'Invoice ' + e.invoice : e.bill ? e.bill : (e.note || '')}</td><td className="p-1">{e.person + ' · ' + e.reference}{e.voided && <div className="text-[10px]">{'undone: ' + (e.void_reason || '')}</div>}</td>
          <td className="p-1 text-right tabular-nums">{e.direction === 'in' ? money(e.amount) : ''}</td><td className="p-1 text-right tabular-nums">{e.direction === 'out' ? money(e.amount) : ''}</td>
          <td className="p-1 text-right whitespace-nowrap">{data.can_record && !e.voided && <span>
            {e.kind === 'deposit' && !e.paired && <button type="button" disabled={busy} onClick={function () { var f = { kind: 'pair', entry: e, lines: null, line: '' }; setForm(f); post({ action: 'deposit_lines', amount: e.amount, since: e.date }).then(function (j) { setForm(function (g) { return g && g.kind === 'pair' ? Object.assign({}, g, { lines: j && j.ok ? j.lines : [] }) : g; }); }); }} className="underline text-[10px] font-bold mr-2" style={{ color: '#075985' }}>Pair</button>}
            <button type="button" disabled={busy} onClick={function () { setForm({ kind: 'undo', entry: e, note: '' }); }} className="underline text-[10px] font-bold" style={{ color: '#7f1d1d' }}>Undo</button></span>}</td></tr>;
      })}</tbody></table>}
  </div>;
}
