'use client';
// v55.83-SK — 📅 Month-end: reconcile each bank account to its statement, then close the month.
// White panels, dark text, explicit colours — reads the same in the light and the dark skin. No pop-ups.
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { bankSessionHeaders } from '../lib/bank-visibility-client';

var INK = '#0f172a'; var SUB = '#475569'; var LINE = '#e2e8f0';
function fmt(n) { var v = Math.round((Number(n) || 0) * 100) / 100; return (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
export function lastMonthEnd(today) { var d = new Date(String(today || new Date().toISOString().substring(0, 10)) + 'T00:00:00Z'); d.setUTCDate(0); return d.toISOString().substring(0, 10); }

export default function MonthEndTab() {
  var s1 = useState(lastMonthEnd()); var date = s1[0]; var setDate = s1[1];
  var s2 = useState(null); var d = s2[0]; var setD = s2[1];
  var s3 = useState(false); var busy = s3[0]; var setBusy = s3[1];
  var s4 = useState({}); var typed = s4[0]; var setTyped = s4[1];
  var s5 = useState({}); var msg = s5[0]; var setMsg = s5[1];
  var s6 = useState(null); var open = s6[0]; var setOpen = s6[1];
  var s7 = useState(null); var ask = s7[0]; var setAsk = s7[1];
  var s8 = useState(''); var top = s8[0]; var setTop = s8[1];

  function post(payload) {
    return bankSessionHeaders(supabase, true).then(function (h) {
      return fetch('/api/accounting/month-end', { method: 'POST', headers: h, body: JSON.stringify(payload) });
    }).then(function (r) { return r.json().catch(function () { return { ok: false, error: 'The server did not answer properly (HTTP ' + r.status + ').' }; }); })
      .catch(function (e) { return { ok: false, error: (e && e.message) || 'Could not reach the server.' }; });
  }
  function load(dt) {
    setBusy(true); setTop('');
    post({ action: 'overview', date: dt || date }).then(function (j) { setD(j || { ok: false }); if (!(j && j.ok)) { setTop((j && j.error) || 'Could not load.'); } }).finally(function () { setBusy(false); });
  }
  useEffect(function () { load(date); }, [date]); // eslint-disable-line react-hooks/exhaustive-deps

  function save(a) {
    var v = typed[a.account_id];
    if (v == null || String(v).trim() === '') { var m0 = {}; m0[a.account_id] = { bad: true, text: 'Type the ending balance from the bank statement.' }; setMsg(Object.assign({}, msg, m0)); return; }
    setBusy(true);
    post({ action: 'save', account_id: a.account_id, date: date, statement: v }).then(function (j) {
      var m = {}; m[a.account_id] = j && j.ok ? (j.reconciled ? { bad: false, text: '✓ Reconciled — the statement and the books agree to the cent.' } : { bad: true, text: 'Saved. The statement and the books differ by ' + fmt(Math.abs(j.difference)) + '. Nothing was adjusted — see the lines not on the books yet.' }) : { bad: true, text: (j && j.error) || 'Not saved.' };
      setMsg(Object.assign({}, msg, m)); if (j && j.ok) { load(date); }
    }).finally(function () { setBusy(false); });
  }
  function closeMonth() {
    setBusy(true);
    post({ action: 'close', through: date }).then(function (j) { if (j && j.ok) { setAsk(null); setTop(''); load(date); } else { setAsk({ kind: 'close', err: (j && j.error) || 'Not closed.' }); } }).finally(function () { setBusy(false); });
  }
  function reopen() {
    if (String((ask && ask.reason) || '').trim().length < 10) { setAsk(Object.assign({}, ask, { err: 'Say why it is being reopened (at least 10 characters).' })); return; }
    setBusy(true);
    post({ action: 'reopen', to: (ask && ask.to) || null, reason: ask.reason }).then(function (j) { if (j && j.ok) { setAsk(null); load(date); } else { setAsk(Object.assign({}, ask, { err: (j && j.error) || 'Not reopened.' })); } }).finally(function () { setBusy(false); });
  }

  var accts = (d && d.ok && d.accounts) || [];
  var need = accts.filter(function (a) { return a.has_activity; });
  var done = need.filter(function (a) { return a.reconciled; }).length;
  var closed = d && d.locked_through && date <= d.locked_through;
  var isMonthEnd = date === lastMonthEnd(new Date(new Date(date + 'T00:00:00Z').getTime() + 40 * 86400000).toISOString().substring(0, 8) + '01');
  var btn = { background: '#ffffff', color: INK, border: '1px solid #94a3b8' };
  var inp = { color: INK, background: '#ffffff', border: '1px solid #cbd5e1' };

  return <div className="nt-paper rounded-2xl p-4" style={{ background: '#ffffff', border: '1px solid ' + LINE, color: INK }}>
    <div className="flex items-center gap-3 flex-wrap mb-1">
      <div className="text-[18px] font-extrabold" style={{ color: INK }}>📅 Month-end</div>
      {d && d.ok && (d.locked_through ? <span className="rounded-full px-3 py-1 text-[12px] font-extrabold" style={{ background: '#0f172a', color: '#ffffff' }}>{'🔒 Books closed through ' + d.locked_through}</span>
        : <span className="rounded-full px-3 py-1 text-[12px] font-extrabold" style={{ background: '#e2e8f0', color: INK }}>No month is closed yet</span>)}
      <div className="flex-1" />
      <label className="text-[12px] font-bold" style={{ color: SUB }}>Statement date <input type="date" value={date} onChange={function (e) { if (e.target.value) { setDate(e.target.value); setMsg({}); setTyped({}); setAsk(null); } }} className="px-2 py-1 rounded-lg text-[12px] nt-light" style={inp} /></label>
      <button onClick={function () { load(date); }} disabled={busy} className="rounded-lg px-3 py-1.5 text-[12px] font-extrabold" style={btn}>{busy ? 'Loading…' : '↻ Refresh'}</button>
    </div>
    <div className="text-[12px] mb-3" style={{ color: SUB }}>Step 1: for each bank account, type the ending balance from the bank statement for this date. The Hub compares it with the books to the cent. Step 2: when every account agrees, the super admin closes the month so it cannot change. Nothing is ever adjusted to force a match.</div>
    {top && <div className="rounded-lg px-3 py-2 mb-3 text-[13px] font-bold" style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fca5a5' }}>{'⛔ ' + top}</div>}
    {d && d.ok && d.installed === false && <div className="rounded-lg px-3 py-2 mb-3 text-[13px] font-bold" style={{ background: '#fffbeb', color: '#78350f', border: '1px solid #fcd34d' }}>The ClickBooks ledger is not installed here.</div>}

    {accts.map(function (a) {
      var m = msg[a.account_id]; var nob = a.not_on_books || { count: 0, total: 0, lines: [] };
      var chip = a.reconciled ? { t: '✓ reconciled', s: { background: '#ecfdf5', color: '#065f46', border: '1px solid #6ee7b7' } }
        : a.statement != null ? { t: 'differs by ' + fmt(Math.abs(a.difference)), s: { background: '#fef2f2', color: '#991b1b', border: '1px solid #fca5a5' } }
        : a.has_activity ? { t: 'not reconciled yet', s: { background: '#fffbeb', color: '#78350f', border: '1px solid #fcd34d' } } : { t: 'no activity', s: { background: '#f1f5f9', color: SUB, border: '1px solid ' + LINE } };
      return <div key={a.account_id} className="rounded-xl mb-3 overflow-hidden" style={{ background: '#ffffff', border: '1px solid ' + LINE }}>
        <div className="flex items-center gap-3 flex-wrap px-4 py-3" style={{ background: '#f8fafc' }}>
          <div style={{ flex: '1 1 220px', minWidth: 0 }}>
            <div className="text-[14px] font-extrabold" style={{ color: INK }}>{a.name}</div>
            <div className="text-[11px]" style={{ color: SUB }}>{'ledger account ' + a.code}</div>
          </div>
          <div className="text-right"><div className="text-[11px] font-bold uppercase" style={{ color: SUB }}>Books say</div><div className="text-[15px] font-extrabold tabular-nums" style={{ color: INK }}>{fmt(a.ledger)}</div></div>
          <div className="text-right"><div className="text-[11px] font-bold uppercase" style={{ color: SUB }}>Statement says</div>
            {closed ? <div className="text-[15px] font-extrabold tabular-nums" style={{ color: INK }}>{a.statement != null ? fmt(a.statement) : '—'}</div>
              : <input value={typed[a.account_id] != null ? typed[a.account_id] : (a.statement != null ? String(a.statement) : '')} onChange={function (e) { var t = {}; t[a.account_id] = e.target.value; setTyped(Object.assign({}, typed, t)); }} placeholder="ending balance" inputMode="decimal" className="px-2 py-1 rounded-lg text-[14px] text-right nt-light" style={Object.assign({ width: 150 }, inp)} />}
          </div>
          <span className="rounded-full px-3 py-1 text-[12px] font-extrabold" style={chip.s}>{chip.t}</span>
          {!closed && <button onClick={function () { save(a); }} disabled={busy} className="rounded-lg px-3 py-1.5 text-[12px] font-extrabold" style={{ background: '#0f766e', color: '#ffffff', border: '1px solid #0f766e' }}>Compare &amp; save</button>}
        </div>
        {a.stale && <div className="px-4 py-2 text-[12px] font-bold" style={{ background: '#fffbeb', color: '#78350f', borderTop: '1px solid #fcd34d' }}>The books for this date changed after it was last compared — the difference shown is against the books as they are now.</div>}
        {m && <div className="px-4 py-2 text-[12px] font-bold" style={m.bad ? { background: '#fef2f2', color: '#991b1b', borderTop: '1px solid #fca5a5' } : { background: '#ecfdf5', color: '#065f46', borderTop: '1px solid #6ee7b7' }}>{m.text}</div>}
        {nob.count > 0 && <div className="px-4 py-2" style={{ borderTop: '1px solid #f1f5f9' }}>
          <button onClick={function () { setOpen(open === a.account_id ? null : a.account_id); }} className="text-[12px] font-extrabold" style={{ color: '#1d4ed8', background: 'transparent' }}>{(open === a.account_id ? '▾ ' : '▸ ') + nob.count + ' bank line(s) up to this date may not be on the books yet (' + fmt(nob.total) + ')'}</button>
          {open === a.account_id && <div className="mt-2">
            {(nob.lines || []).map(function (l) { return <div key={l.id} className="flex gap-3 flex-wrap text-[12px] py-1" style={{ borderTop: '1px solid #f1f5f9', color: INK }}>
              <span className="tabular-nums" style={{ color: SUB, width: 86 }}>{l.date}</span><span style={{ flex: '1 1 200px' }}>{l.name || '—'}</span><span style={{ color: SUB }}>{l.status}</span><span className="tabular-nums font-bold" style={{ color: l.amount < 0 ? '#991b1b' : '#065f46' }}>{fmt(l.amount)}</span></div>; })}
            {nob.count > (nob.lines || []).length && <div className="text-[11px] mt-1" style={{ color: SUB }}>{'+ ' + (nob.count - nob.lines.length) + ' more.'}</div>}
            <div className="text-[11px] mt-1" style={{ color: SUB }}>Review and categorize these in Books / All Transactions; the ledger picks them up within 15 minutes. (A customer deposit already matched to an invoice can appear here although its money is counted.)</div>
          </div>}
        </div>}
      </div>;
    })}
    {d && d.ok && accts.length === 0 && d.installed !== false && <div className="rounded-lg px-3 py-3 text-[13px] font-bold" style={{ background: '#f8fafc', color: INK, border: '1px solid ' + LINE }}>No bank account is mapped to the ledger yet.</div>}

    {d && d.ok && d.installed !== false && <div className="rounded-xl px-4 py-3" style={{ background: '#f8fafc', border: '1px solid ' + LINE }}>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="text-[14px] font-extrabold" style={{ color: INK }}>{closed ? '🔒 This date is in a closed period' : 'Close the month ending ' + date}</div>
        {!closed && <span className="text-[12px] font-bold" style={{ color: done === need.length && need.length > 0 ? '#065f46' : '#9a3412' }}>{done + ' of ' + need.length + ' bank account(s) reconciled'}</span>}
        <div className="flex-1" />
        {!closed && d.can_close && <button onClick={function () { setAsk({ kind: 'close' }); }} disabled={busy} className="rounded-lg px-3 py-1.5 text-[12px] font-extrabold" style={{ background: '#0f172a', color: '#ffffff', border: '1px solid #0f172a' }}>🔒 Close this month</button>}
        {d.locked_through && d.can_close && <button onClick={function () { setAsk({ kind: 'reopen', reason: '', to: '' }); }} disabled={busy} className="rounded-lg px-3 py-1.5 text-[12px] font-extrabold" style={{ background: '#ffffff', color: '#991b1b', border: '1px solid #fca5a5' }}>Reopen a closed period</button>}
      </div>
      <div className="text-[12px] mt-1" style={{ color: SUB }}>{closed ? 'Nothing dated on or before ' + d.locked_through + ' can be added or changed in the ledger. A correction goes in as a new entry dated after it.'
        : !isMonthEnd ? 'A month is closed at its last day — pick a month-end date above to close.'
        : !d.can_close ? 'Only the super admin can close a month.'
        : 'Closing locks every ledger entry dated on or before ' + date + '. The ledger refuses to close while any bank account with activity is not reconciled to this date.'}</div>
      {ask && ask.kind === 'close' && <div className="mt-2 rounded-lg p-3" style={{ background: '#ffffff', border: '1px solid #94a3b8' }}>
        <div className="text-[13px] font-bold" style={{ color: INK }}>{'Close the books through ' + date + '? After this, entries dated in that period cannot be added or changed.'}</div>
        <div className="flex gap-2 mt-2 flex-wrap"><button onClick={closeMonth} disabled={busy} className="rounded-lg px-3 py-1.5 text-[12px] font-extrabold" style={{ background: '#0f172a', color: '#ffffff' }}>{busy ? 'Closing…' : 'Yes, close it'}</button><button onClick={function () { setAsk(null); }} className="rounded-lg px-3 py-1.5 text-[12px] font-extrabold" style={btn}>Cancel</button></div>
        {ask.err && <div className="mt-2 text-[12px] font-extrabold" style={{ color: '#b91c1c' }}>{'⛔ ' + ask.err}</div>}</div>}
      {ask && ask.kind === 'reopen' && <div className="mt-2 rounded-lg p-3" style={{ background: '#ffffff', border: '1px solid #fca5a5' }}>
        <div className="flex gap-2 items-center flex-wrap">
          <label className="text-[12px] font-bold" style={{ color: SUB }}>Keep closed through (empty = reopen everything) <input type="date" value={ask.to || ''} onChange={function (e) { setAsk(Object.assign({}, ask, { to: e.target.value, err: '' })); }} className="px-2 py-1 rounded-lg text-[12px] nt-light" style={inp} /></label>
          <input value={ask.reason || ''} onChange={function (e) { setAsk(Object.assign({}, ask, { reason: e.target.value, err: '' })); }} placeholder="why (kept in the history)" className="px-2 py-1 rounded-lg text-[12px] nt-light" style={Object.assign({ flex: '1 1 240px' }, inp)} />
          <button onClick={reopen} disabled={busy} className="rounded-lg px-3 py-1.5 text-[12px] font-extrabold" style={{ background: '#991b1b', color: '#ffffff' }}>Reopen</button><button onClick={function () { setAsk(null); }} className="rounded-lg px-3 py-1.5 text-[12px] font-extrabold" style={btn}>Cancel</button></div>
        {ask.err && <div className="mt-2 text-[12px] font-extrabold" style={{ color: '#b91c1c' }}>{'⛔ ' + ask.err}</div>}</div>}
    </div>}
  </div>;
}
