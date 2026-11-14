'use client';
// v55.83-SJ — "What we owe, by age" + the switch that puts bills on the books before they are paid.
// White panel, dark text, explicit colours: reads the same in the light and the dark skin.
import React, { useEffect, useState } from 'react';
import { payablesAging, AGING_COLS } from '../lib/payables-aging';

var INK = '#0f172a'; var SUB = '#475569'; var LINE = '#e2e8f0';
function fmt(n) { return (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function PayablesPanel(p) {
  var s1 = useState(null); var st = s1[0]; var setSt = s1[1];
  var s2 = useState(null); var ask = s2[0]; var setAsk = s2[1];
  var s3 = useState(false); var busy = s3[0]; var setBusy = s3[1];
  var ag = payablesAging(p.bills || []);
  function post(payload) {
    return fetch('/api/accounting/payables', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ user_id: p.userId }, payload)) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'The server did not answer properly (HTTP ' + r.status + ').' }; }); })
      .catch(function (e) { return { ok: false, error: 'Could not reach the server (' + ((e && e.message) || 'network') + ').' }; });
  }
  function load() { post({ action: 'status' }).then(function (j) { setSt(j || { ok: false }); }); }
  useEffect(function () { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  function save(off) {
    if (!off && !(ask && ask.date)) { setAsk(Object.assign({}, ask, { err: 'Pick the date to start from.' })); return; }
    setBusy(true);
    post({ action: 'set_start', start_date: off ? null : ask.date }).then(function (j) {
      if (j && j.ok) { setAsk(null); load(); } else { setAsk(Object.assign({}, ask || {}, { err: (j && j.error) || 'Not saved.' })); }
    }).finally(function () { setBusy(false); });
  }
  var on = st && st.installed && st.start_date;
  var cell = 'px-3 py-2 text-right tabular-nums';
  var btn = { background: '#ffffff', color: INK, border: '1px solid #94a3b8' };

  return <div className="nt-paper rounded-xl p-4 mb-3" style={{ background: '#ffffff', border: '1px solid ' + LINE, color: INK }}>
    <div className="flex items-center gap-2 flex-wrap mb-1">
      <div className="text-[15px] font-extrabold" style={{ color: INK }}>📒 What we owe, by age</div>
      <span className="rounded-full px-3 py-1 text-[12px] font-extrabold" style={{ background: '#0f172a', color: '#ffffff' }}>{'$' + fmt(ag.totals.total) + ' · ' + ag.totals.bills + ' bill' + (ag.totals.bills === 1 ? '' : 's')}</span>
    </div>
    <div className="text-[12px] mb-3" style={{ color: SUB }}>Every unpaid bill, by vendor, by how late it is (from the due date; a bill with no due date is aged from its bill date).</div>
    {ag.rows.length === 0 ? <div className="rounded-lg px-3 py-3 text-[13px] font-bold" style={{ background: '#f8fafc', color: INK, border: '1px solid ' + LINE }}>Nothing is owed right now.</div>
      : <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid ' + LINE }}><table className="w-full text-[13px]" style={{ color: INK, background: '#ffffff' }}>
        <thead><tr style={{ background: '#f8fafc', color: SUB }}>
          <th className="px-3 py-2 text-left text-[11px] font-extrabold uppercase">Vendor</th>
          {AGING_COLS.map(function (c) { return <th key={c[0]} className="px-3 py-2 text-right text-[11px] font-extrabold uppercase">{c[1]}</th>; })}
          <th className="px-3 py-2 text-right text-[11px] font-extrabold uppercase">Total owed</th></tr></thead>
        <tbody>
          {ag.rows.map(function (r) {
            return <tr key={r.vendor} style={{ borderTop: '1px solid #f1f5f9' }}>
              <td className="px-3 py-2 font-bold" style={{ color: INK }}>{r.vendor}<div className="text-[11px] font-normal" style={{ color: SUB }}>{r.bills + ' bill' + (r.bills === 1 ? '' : 's') + (r.on_wire > 0 ? ' · $' + fmt(r.on_wire) + ' on a wire' : '') + (r.disputed > 0 ? ' · $' + fmt(r.disputed) + ' disputed' : '')}</div></td>
              {AGING_COLS.map(function (c) { var v = r[c[0]]; var late = c[0] !== 'current' && v > 0; return <td key={c[0]} className={cell} style={{ color: late ? '#991b1b' : v > 0 ? INK : '#94a3b8', fontWeight: late ? 800 : 400 }}>{v > 0 ? '$' + fmt(v) : '—'}</td>; })}
              <td className={cell + ' font-extrabold'} style={{ color: INK }}>{'$' + fmt(r.total)}</td></tr>;
          })}
          <tr style={{ borderTop: '2px solid #cbd5e1', background: '#f8fafc' }}>
            <td className="px-3 py-2 font-extrabold" style={{ color: INK }}>Total</td>
            {AGING_COLS.map(function (c) { return <td key={c[0]} className={cell + ' font-extrabold'} style={{ color: INK }}>{ag.totals[c[0]] > 0 ? '$' + fmt(ag.totals[c[0]]) : '—'}</td>; })}
            <td className={cell + ' font-extrabold'} style={{ color: INK }}>{'$' + fmt(ag.totals.total)}</td></tr>
        </tbody></table></div>}

    <div className="rounded-lg mt-3 px-3 py-3" style={{ background: '#f8fafc', border: '1px solid ' + LINE }}>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="text-[13px] font-extrabold" style={{ color: INK }}>Bills on the books before they are paid</div>
        {st == null ? <span className="text-[12px]" style={{ color: SUB }}>checking…</span>
          : !st.installed ? <span className="rounded-full px-2 py-0.5 text-[11px] font-extrabold" style={{ background: '#fffbeb', color: '#78350f', border: '1px solid #fcd34d' }}>not installed</span>
          : on ? <span className="rounded-full px-2 py-0.5 text-[11px] font-extrabold" style={{ background: '#ecfdf5', color: '#065f46', border: '1px solid #6ee7b7' }}>{'ON since ' + st.start_date}</span>
          : <span className="rounded-full px-2 py-0.5 text-[11px] font-extrabold" style={{ background: '#e2e8f0', color: INK }}>OFF</span>}
        <div className="flex-1" />
        {st && st.installed && st.can_switch && !ask && <button onClick={function () { setAsk({ date: st.start_date || '', err: '' }); }} className="rounded-lg px-3 py-1.5 text-[12px] font-extrabold" style={btn}>{on ? 'Change' : 'Switch on'}</button>}
      </div>
      <div className="text-[12px] mt-1" style={{ color: SUB }}>
        {st && !st.installed ? (st.why || 'Run sql/v55-83-SJ-bills-payable.sql in Supabase first.')
          : on ? 'Each validated bill dated on or after ' + st.start_date + ' is recorded in the ledger on its bill date: the cost, and “we owe this vendor”. Paying it clears the debt. Bills paid through RTM Capital stay one professional-fee line.'
          : 'Off: the ledger records a bill’s cost on the day it is paid. Switch it on from a date (agree the date with your accountant) and validated bills from that date go on the books when they are billed. Earlier bills are not touched.'}
      </div>
      {on && <div className="flex gap-4 flex-wrap mt-2 text-[12px] font-bold" style={{ color: INK }}>
        <span>{'Ledger says we owe: $' + fmt(st.ledger_owed)}</span><span>{st.bills_on_books + ' bill(s) on the books'}</span><span>{st.payments_cleared + ' payment(s) cleared'}</span>
        {st.last_run && st.last_run.waiting && Object.keys(st.last_run.waiting).length > 0 && <span style={{ color: '#9a3412' }}>{'Waiting: ' + Object.keys(st.last_run.waiting).map(function (k) { return st.last_run.waiting[k] + ' × ' + k; }).join('; ')}</span>}
      </div>}
      {st && st.installed && !st.payable_account_ready && <div className="mt-2 rounded-lg px-3 py-2 text-[12px] font-bold" style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fca5a5' }}>⛔ The “Accounts payable” account (2000) is missing or not approved in the chart of accounts. It has to be approved before this can be switched on.</div>}
      {ask && <div className="mt-2 rounded-lg p-2" style={{ background: '#ffffff', border: '1px solid #93c5fd' }}>
        <div className="flex gap-2 items-center flex-wrap">
          <label className="text-[12px] font-bold" style={{ color: SUB }}>Put bills on the books from <input type="date" value={ask.date || ''} onChange={function (e) { setAsk({ date: e.target.value, err: '' }); }} className="px-2 py-1 rounded-lg border text-[12px] nt-light" style={{ color: INK, background: '#ffffff', borderColor: '#cbd5e1' }} /></label>
          <button onClick={function () { save(false); }} disabled={busy} className="rounded-lg px-3 py-1.5 text-[12px] font-extrabold" style={{ background: '#0f766e', color: '#ffffff', border: '1px solid #0f766e' }}>{busy ? 'Saving…' : 'Save'}</button>
          {on && <button onClick={function () { save(true); }} disabled={busy} className="rounded-lg px-3 py-1.5 text-[12px] font-extrabold" style={{ background: '#ffffff', color: '#991b1b', border: '1px solid #fca5a5' }}>Switch off (reverses its entries)</button>}
          <button onClick={function () { setAsk(null); }} className="rounded-lg px-3 py-1.5 text-[12px] font-extrabold" style={btn}>Cancel</button>
        </div>
        <div className="text-[11px] mt-1" style={{ color: SUB }}>The date must be after the opening balance{st && st.opening_cutoff ? ' (' + st.opening_cutoff + ')' : ''}{st && st.locked_through ? ' and after the closed period (' + st.locked_through + ')' : ''}. The ledger job applies it within 15 minutes.</div>
        {ask.err && <div className="mt-1 text-[12px] font-extrabold" style={{ color: '#b91c1c' }}>{'⛔ ' + ask.err}</div>}
      </div>}
    </div>
  </div>;
}
