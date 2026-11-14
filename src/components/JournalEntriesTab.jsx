'use client';
// v55.83-SL — ✍️ Journal entries: one person writes, a different person approves, then it is in the ledger.
// White panels, dark text, explicit colours — reads the same in the light and the dark skin. No pop-ups.
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { bankSessionHeaders } from '../lib/bank-visibility-client';

var INK = '#0f172a'; var SUB = '#475569'; var LINE = '#e2e8f0';
function fmt(n) { return '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function num(v) { var r = String(v == null ? '' : v).replace(/[$,\s]/g, ''); return /^\d+(\.\d{1,2})?$/.test(r) ? Math.round(Number(r) * 100) : 0; }
// debits, credits and the difference of the lines being typed, in cents
export function entryTotals(lines) { var d = 0; var c = 0; (lines || []).forEach(function (l) { d += num(l.debit); c += num(l.credit); }); return { debit: d, credit: c, diff: d - c, balanced: d > 0 && d === c }; }
function blank() { return { date: new Date().toISOString().substring(0, 10), description: '', lines: [{ account_id: '', debit: '', credit: '', memo: '' }, { account_id: '', debit: '', credit: '', memo: '' }], reverses: null, err: '' }; }
var ST = { pending: ['waiting for approval', { background: '#fffbeb', color: '#78350f', border: '1px solid #fcd34d' }], approved: ['in the ledger', { background: '#ecfdf5', color: '#065f46', border: '1px solid #6ee7b7' }],
  rejected: ['rejected', { background: '#fef2f2', color: '#991b1b', border: '1px solid #fca5a5' }], cancelled: ['cancelled', { background: '#f1f5f9', color: SUB, border: '1px solid ' + LINE }] };

export default function JournalEntriesTab() {
  var s1 = useState(null); var d = s1[0]; var setD = s1[1];
  var s2 = useState(false); var busy = s2[0]; var setBusy = s2[1];
  var s3 = useState(null); var form = s3[0]; var setForm = s3[1];
  var s4 = useState(null); var ask = s4[0]; var setAsk = s4[1];
  var s5 = useState(''); var top = s5[0]; var setTop = s5[1];
  var s6 = useState(null); var open = s6[0]; var setOpen = s6[1];

  function post(payload) {
    return bankSessionHeaders(supabase, true).then(function (h) { return fetch('/api/accounting/journal-entries', { method: 'POST', headers: h, body: JSON.stringify(payload) }); })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'The server did not answer properly (HTTP ' + r.status + ').' }; }); })
      .catch(function (e) { return { ok: false, error: (e && e.message) || 'Could not reach the server.' }; });
  }
  function load() { setBusy(true); post({ action: 'list' }).then(function (j) { setD(j || { ok: false }); setTop(j && j.ok ? '' : ((j && j.error) || 'Could not load.')); }).finally(function () { setBusy(false); }); }
  useEffect(function () { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function setLine(ix, k, v) { var ls = form.lines.map(function (l, i) { if (i !== ix) { return l; } var o = Object.assign({}, l); o[k] = v; if (k === 'debit' && v) { o.credit = ''; } if (k === 'credit' && v) { o.debit = ''; } return o; }); setForm(Object.assign({}, form, { lines: ls, err: '' })); }
  function submit() {
    var t = entryTotals(form.lines);
    var err = !form.date ? 'Pick the date of the entry.' : String(form.description).trim().length < 5 ? 'Say what the entry is for (at least 5 characters).' : !t.balanced ? (t.debit === 0 && t.credit === 0 ? 'Enter the amounts.' : 'The entry does not balance — debits and credits differ by ' + fmt(Math.abs(t.diff) / 100) + '.') : '';
    if (err) { setForm(Object.assign({}, form, { err: err })); return; }
    setBusy(true);
    post({ action: 'create', date: form.date, description: form.description, lines: form.lines, reverses: form.reverses }).then(function (j) {
      if (j && j.ok) { setForm(null); load(); } else { setForm(Object.assign({}, form, { err: (j && j.error) || 'Not saved.' })); }
    }).finally(function () { setBusy(false); });
  }
  function decide(kind) {
    if (kind === 'reject' && String((ask && ask.note) || '').trim().length < 5) { setAsk(Object.assign({}, ask, { err: 'Say why it is rejected (at least 5 characters).' })); return; }
    setBusy(true);
    post({ action: kind, id: ask.id, note: ask.note || '' }).then(function (j) { if (j && j.ok) { setAsk(null); load(); } else { setAsk(Object.assign({}, ask, { err: (j && j.error) || 'Not done.' })); } }).finally(function () { setBusy(false); });
  }
  function reverseOf(e) {
    setForm({ date: new Date().toISOString().substring(0, 10), description: 'Reverse ' + e.label + ': ' + e.description, reverses: e.id, err: '',
      lines: (e.lines || []).map(function (l) { return { account_id: l.account_id, debit: l.credit > 0 ? String(l.credit) : '', credit: l.debit > 0 ? String(l.debit) : '', memo: l.memo || '' }; }) });
    if (typeof window !== 'undefined') { window.scrollTo(0, 0); }
  }

  var btn = { background: '#ffffff', color: INK, border: '1px solid #94a3b8' };
  var inp = { color: INK, background: '#ffffff', border: '1px solid #cbd5e1' };
  var accts = (d && d.accounts) || []; var t = form ? entryTotals(form.lines) : null;
  var entries = (d && d.ok && d.entries) || [];

  return <div className="nt-paper rounded-2xl p-4" style={{ background: '#ffffff', border: '1px solid ' + LINE, color: INK }}>
    <div className="flex items-center gap-3 flex-wrap mb-1">
      <div className="text-[18px] font-extrabold" style={{ color: INK }}>✍️ Journal entries</div>
      {d && d.ok && <span className="rounded-full px-3 py-1 text-[12px] font-extrabold" style={{ background: '#e2e8f0', color: INK }}>{entries.filter(function (e) { return e.status === 'pending'; }).length + ' waiting for approval'}</span>}
      <div className="flex-1" />
      <button onClick={load} disabled={busy} className="rounded-lg px-3 py-1.5 text-[12px] font-extrabold" style={btn}>{busy ? 'Loading…' : '↻ Refresh'}</button>
      {d && d.ok && d.can_write && !form && <button onClick={function () { setForm(blank()); }} className="rounded-lg px-3 py-1.5 text-[12px] font-extrabold" style={{ background: '#0f766e', color: '#ffffff', border: '1px solid #0f766e' }}>＋ New journal entry</button>}
    </div>
    <div className="text-[12px] mb-3" style={{ color: SUB }}>For adjustments an accountant makes by hand — an accrual, a correction, moving a cost between categories. One person writes it; a different person approves it; then it is in the ledger. A wrong entry is never edited: a reversing entry is written and approved the same way. Bank accounts and the receivable / payable control accounts cannot be used here.</div>
    {top && <div className="rounded-lg px-3 py-2 mb-3 text-[13px] font-bold" style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fca5a5' }}>{'⛔ ' + top}</div>}

    {form && <div className="rounded-xl p-4 mb-4" style={{ background: '#f8fafc', border: '2px solid #0f766e' }}>
      <div className="text-[14px] font-extrabold mb-2" style={{ color: INK }}>{form.reverses ? 'Reversing entry' : 'New journal entry'}</div>
      <div className="flex gap-2 items-center flex-wrap mb-3">
        <label className="text-[12px] font-bold" style={{ color: SUB }}>Date <input type="date" value={form.date} onChange={function (e) { setForm(Object.assign({}, form, { date: e.target.value, err: '' })); }} className="px-2 py-1 rounded-lg text-[13px] nt-light" style={inp} /></label>
        <input value={form.description} onChange={function (e) { setForm(Object.assign({}, form, { description: e.target.value, err: '' })); }} placeholder="what this entry is for (e.g. Accrue November rent)" className="px-2 py-1 rounded-lg text-[13px] nt-light" style={Object.assign({ flex: '1 1 320px' }, inp)} />
      </div>
      <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid ' + LINE, background: '#ffffff' }}><table className="w-full text-[13px]" style={{ color: INK }}>
        <thead><tr style={{ background: '#f1f5f9', color: SUB }}><th className="px-2 py-2 text-left text-[11px] font-extrabold uppercase">Account</th><th className="px-2 py-2 text-right text-[11px] font-extrabold uppercase">Debit</th><th className="px-2 py-2 text-right text-[11px] font-extrabold uppercase">Credit</th><th className="px-2 py-2 text-left text-[11px] font-extrabold uppercase">Note</th><th /></tr></thead>
        <tbody>{form.lines.map(function (l, ix) { return <tr key={ix} style={{ borderTop: '1px solid #f1f5f9' }}>
          <td className="px-2 py-1.5"><select value={l.account_id} onChange={function (e) { setLine(ix, 'account_id', e.target.value); }} className="px-2 py-1 rounded-lg text-[13px] nt-light" style={Object.assign({ minWidth: 240 }, inp)}>
            <option value="">— pick an account —</option>{accts.map(function (a) { return <option key={a.id} value={a.id}>{a.name + ' · ' + a.type}</option>; })}</select></td>
          <td className="px-2 py-1.5 text-right"><input value={l.debit} onChange={function (e) { setLine(ix, 'debit', e.target.value); }} inputMode="decimal" placeholder="0.00" className="px-2 py-1 rounded-lg text-[13px] text-right nt-light" style={Object.assign({ width: 120 }, inp)} /></td>
          <td className="px-2 py-1.5 text-right"><input value={l.credit} onChange={function (e) { setLine(ix, 'credit', e.target.value); }} inputMode="decimal" placeholder="0.00" className="px-2 py-1 rounded-lg text-[13px] text-right nt-light" style={Object.assign({ width: 120 }, inp)} /></td>
          <td className="px-2 py-1.5"><input value={l.memo} onChange={function (e) { setLine(ix, 'memo', e.target.value); }} placeholder="optional" className="px-2 py-1 rounded-lg text-[13px] nt-light" style={Object.assign({ width: '100%', minWidth: 140 }, inp)} /></td>
          <td className="px-2 py-1.5">{form.lines.length > 2 && <button onClick={function () { setForm(Object.assign({}, form, { lines: form.lines.filter(function (_, i) { return i !== ix; }), err: '' })); }} className="text-[12px] font-extrabold" style={{ color: '#991b1b', background: 'transparent' }}>remove</button>}</td></tr>; })}
          <tr style={{ borderTop: '2px solid #cbd5e1', background: '#f8fafc' }}><td className="px-2 py-2 font-extrabold" style={{ color: INK }}>Totals</td>
            <td className="px-2 py-2 text-right font-extrabold tabular-nums" style={{ color: INK }}>{fmt(t.debit / 100)}</td><td className="px-2 py-2 text-right font-extrabold tabular-nums" style={{ color: INK }}>{fmt(t.credit / 100)}</td>
            <td className="px-2 py-2" colSpan={2}><span className="rounded-full px-2 py-0.5 text-[11px] font-extrabold" style={t.balanced ? ST.approved[1] : ST.rejected[1]}>{t.balanced ? '✓ balanced' : t.debit === 0 && t.credit === 0 ? 'enter the amounts' : 'off by ' + fmt(Math.abs(t.diff) / 100)}</span></td></tr>
        </tbody></table></div>
      <div className="flex gap-2 items-center flex-wrap mt-3">
        <button onClick={function () { setForm(Object.assign({}, form, { lines: form.lines.concat([{ account_id: '', debit: '', credit: '', memo: '' }]) })); }} className="rounded-lg px-3 py-1.5 text-[12px] font-extrabold" style={btn}>＋ Add a line</button>
        <div className="flex-1" />
        <button onClick={function () { setForm(null); }} className="rounded-lg px-3 py-1.5 text-[12px] font-extrabold" style={btn}>Cancel</button>
        <button onClick={submit} disabled={busy} className="rounded-lg px-4 py-1.5 text-[13px] font-extrabold" style={{ background: '#0f766e', color: '#ffffff', border: '1px solid #0f766e' }}>{busy ? 'Saving…' : 'Send for approval'}</button>
      </div>
      {form.err && <div className="mt-2 rounded-lg px-3 py-2 text-[12px] font-extrabold" style={{ background: '#ffffff', color: '#b91c1c', border: '1px solid #fca5a5' }}>{'⛔ ' + form.err}</div>}
    </div>}

    {d && d.ok && entries.length === 0 && !form && <div className="rounded-xl px-4 py-6 text-center" style={{ background: '#f8fafc', border: '1px solid ' + LINE }}><div className="text-[14px] font-extrabold" style={{ color: INK }}>No journal entries yet</div></div>}
    {entries.map(function (e) {
      var st = ST[e.status] || ST.cancelled; var mine = d.me && e.created_by === d.me; var isOpen = open === e.id || e.status === 'pending';
      return <div key={e.id} className="rounded-xl mb-3 overflow-hidden" style={{ background: '#ffffff', border: '1px solid ' + LINE }}>
        <div className="flex items-center gap-3 flex-wrap px-4 py-3" style={{ background: '#f8fafc', cursor: 'pointer' }} onClick={function () { setOpen(open === e.id ? null : e.id); }}>
          <div className="text-[13px] font-extrabold" style={{ color: INK }}>{e.label}</div>
          <div style={{ flex: '1 1 240px', minWidth: 0 }}><div className="text-[13px] font-bold" style={{ color: INK }}>{e.description}</div>
            <div className="text-[11px]" style={{ color: SUB }}>{'dated ' + e.date + ' · written by ' + (e.created_by_name || 'someone') + (e.decided_by_name ? ' · ' + (e.status === 'approved' ? 'approved' : 'rejected') + ' by ' + e.decided_by_name : '') + (e.reverses ? ' · reverses ' + e.reverses : '') + (e.reversed_by ? ' · reversed by ' + e.reversed_by : '')}</div></div>
          <div className="text-[14px] font-extrabold tabular-nums" style={{ color: INK }}>{fmt(e.total)}</div>
          <span className="rounded-full px-3 py-1 text-[12px] font-extrabold" style={st[1]}>{st[0]}</span>
        </div>
        {isOpen && <div className="px-4 py-3" style={{ borderTop: '1px solid ' + LINE }}>
          <table className="w-full text-[12px]" style={{ color: INK }}><tbody>{(e.lines || []).map(function (l, ix) { return <tr key={ix} style={{ borderTop: ix ? '1px solid #f1f5f9' : 'none' }}>
            <td className="py-1 font-bold" style={{ color: INK }}>{l.name || l.code || '—'}{l.memo ? <span className="font-normal" style={{ color: SUB }}>{' — ' + l.memo}</span> : null}</td>
            <td className="py-1 text-right tabular-nums" style={{ width: 160, whiteSpace: 'nowrap', color: l.debit > 0 ? INK : '#94a3b8' }}>{l.debit > 0 ? fmt(l.debit) + ' debit' : ''}</td>
            <td className="py-1 text-right tabular-nums" style={{ width: 160, whiteSpace: 'nowrap', color: l.credit > 0 ? INK : '#94a3b8' }}>{l.credit > 0 ? fmt(l.credit) + ' credit' : ''}</td></tr>; })}</tbody></table>
          {e.decide_note && <div className="text-[12px] mt-2" style={{ color: SUB }}>{'Note: “' + e.decide_note + '”'}</div>}
          <div className="flex gap-2 items-center flex-wrap mt-3">
            {e.status === 'pending' && d.can_approve && !mine && <button onClick={function () { setAsk({ id: e.id, kind: 'approve', note: '' }); }} disabled={busy} className="rounded-lg px-3 py-1.5 text-[12px] font-extrabold" style={{ background: '#0f766e', color: '#ffffff', border: '1px solid #0f766e' }}>✓ Approve — post to the ledger</button>}
            {e.status === 'pending' && d.can_approve && !mine && <button onClick={function () { setAsk({ id: e.id, kind: 'reject', note: '' }); }} disabled={busy} className="rounded-lg px-3 py-1.5 text-[12px] font-extrabold" style={{ background: '#ffffff', color: '#991b1b', border: '1px solid #fca5a5' }}>Reject</button>}
            {e.status === 'pending' && mine && <span className="text-[12px] font-bold" style={{ color: SUB }}>You wrote this one — a second person has to approve it.</span>}
            {e.status === 'pending' && mine && <button onClick={function () { setAsk({ id: e.id, kind: 'cancel' }); }} disabled={busy} className="rounded-lg px-3 py-1.5 text-[12px] font-extrabold" style={btn}>Cancel my entry</button>}
            {e.status === 'pending' && !d.can_approve && !mine && <span className="text-[12px] font-bold" style={{ color: SUB }}>Approving needs “Journals: approve”.</span>}
            {e.status === 'approved' && d.can_write && !e.reversed_by && <button onClick={function () { reverseOf(e); }} className="rounded-lg px-3 py-1.5 text-[12px] font-extrabold" style={btn}>↩ Write a reversing entry</button>}
          </div>
          {ask && ask.id === e.id && <div className="mt-2 rounded-lg p-3" style={{ background: '#f8fafc', border: '1px solid #94a3b8' }}>
            {ask.kind === 'approve' && <div className="text-[13px] font-bold" style={{ color: INK }}>{'Approve ' + e.label + ' for ' + fmt(e.total) + '? It goes into the ledger dated ' + e.date + ' and cannot be edited afterwards.'}</div>}
            {ask.kind === 'cancel' && <div className="text-[13px] font-bold" style={{ color: INK }}>{'Cancel ' + e.label + '? Nothing was posted.'}</div>}
            {ask.kind === 'reject' && <input value={ask.note || ''} onChange={function (ev) { setAsk(Object.assign({}, ask, { note: ev.target.value, err: '' })); }} placeholder="why it is rejected" className="px-2 py-1 rounded-lg text-[13px] nt-light" style={Object.assign({ width: '100%' }, inp)} />}
            <div className="flex gap-2 mt-2 flex-wrap">
              <button onClick={function () { if (ask.kind === 'cancel') { setBusy(true); post({ action: 'cancel', id: e.id }).then(function (j) { if (j && j.ok) { setAsk(null); load(); } else { setAsk(Object.assign({}, ask, { err: (j && j.error) || 'Not cancelled.' })); } }).finally(function () { setBusy(false); }); } else { decide(ask.kind); } }} disabled={busy}
                className="rounded-lg px-3 py-1.5 text-[12px] font-extrabold" style={ask.kind === 'approve' ? { background: '#0f766e', color: '#ffffff' } : { background: '#991b1b', color: '#ffffff' }}>{ask.kind === 'approve' ? 'Yes, approve' : ask.kind === 'reject' ? 'Reject it' : 'Yes, cancel it'}</button>
              <button onClick={function () { setAsk(null); }} className="rounded-lg px-3 py-1.5 text-[12px] font-extrabold" style={btn}>Back</button></div>
            {ask.err && <div className="mt-2 text-[12px] font-extrabold" style={{ color: '#b91c1c' }}>{'⛔ ' + ask.err}</div>}
          </div>}
        </div>}
      </div>;
    })}
  </div>;
}
