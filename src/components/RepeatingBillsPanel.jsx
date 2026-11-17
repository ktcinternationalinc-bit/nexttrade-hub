'use client';
// v55.83-TV — Accounting → 💸 Bills → 🔁 Repeating bills (Max, Nov 17 2026).
// A bill that comes back every week / month / 3 months / year (e.g. the monthly "Warehouse staff" bill) is set up
// once; the Hub makes each bill a few days before its date (7 by default). Pause, resume, edit (future bills only) and
// stop — a stopped one is kept with every bill it made. Nothing is ever deleted.
// Inline colours on white panels (the dark theme repaints bg-white).
import React, { useState, useEffect } from 'react';
import { hubFetch } from '../lib/hub-fetch';
import { FREQUENCIES, DEFAULT_LEAD_DAYS } from '../lib/repeating-bills';

function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function todayStr() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
var STATUS = { active: { t: '● Active', bg: '#dcfce7', fg: '#14532d' }, paused: { t: '⏸ Paused', bg: '#fef9c3', fg: '#713f12' }, stopped: { t: '⏹ Stopped', bg: '#e2e8f0', fg: '#334155' } };
var box = { background: '#ffffff', color: '#0f172a', border: '1px solid #fdba74' };
var inp = 'px-2 py-1 rounded border text-[11px] nt-light'; // v55.83-UA — nt-light: dark text on white even under the dark theme (globals.css)
var inpStyle = { background: '#ffffff', color: '#0f172a', borderColor: '#cbd5e1' };

export default function RepeatingBillsPanel(props) {
  var userProfile = props.userProfile; var canManage = props.canManage === true; var cats = props.cats;
  var toast = props.toast || { success: function () {}, error: function () {} };
  var s1 = useState(null); var rows = s1[0]; var setRows = s1[1];
  var s2 = useState(''); var err = s2[0]; var setErr = s2[1];
  var s3 = useState(false); var busy = s3[0]; var setBusy = s3[1];
  var s4 = useState(null); var form = s4[0]; var setForm = s4[1];
  var s5 = useState(''); var sqlMissing = s5[0]; var setSqlMissing = s5[1];
  var s6 = useState(null); var ask = s6[0]; var setAsk = s6[1]; // { id, action, reason }

  function api(payload) {
    return hubFetch('/api/accounting/bills/repeating', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ user_id: userProfile && userProfile.id }, payload)) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'The server did not answer properly (HTTP ' + r.status + ').' }; }); })
      .catch(function (e) { return { ok: false, error: 'Could not reach the server (' + ((e && e.message) || 'network') + ').' }; });
  }
  function load() {
    setBusy(true);
    api({ action: 'list' }).then(function (j) {
      if (j && j.ok) { setRows(j.rows || []); setErr(''); setSqlMissing(j.sql_missing || ''); } else { setErr((j && j.error) || 'Could not load the repeating bills.'); }
    }).finally(function () { setBusy(false); });
  }
  useEffect(function () { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function runWords(run) {
    if (!run) { return ''; }
    var p = []; if (run.made) { p.push(run.made + ' bill(s) made'); } if (run.skipped) { p.push(run.skipped + ' skipped (looks like a duplicate)'); } if (run.failed) { p.push(run.failed + ' failed'); }
    return p.length ? p.join(' · ') : 'no bill due yet';
  }
  function save() {
    if (!form) { return; }
    setBusy(true);
    api({ action: 'save', repeating: form }).then(function (j) {
      if (j && j.ok) { toast.success((j.created ? 'Repeating bill set up' : 'Saved — future bills only') + (j.run ? ' · ' + runWords(j.run) : '')); setForm(null); load(); if (props.onChanged) { props.onChanged(); } }
      else { toast.error((j && j.error) || 'Not saved.'); }
    }).finally(function () { setBusy(false); });
  }
  function act(id, action, extra) {
    setBusy(true);
    api(Object.assign({ action: action, id: id }, extra || {})).then(function (j) {
      if (j && j.ok) {
        toast.success(action === 'run_now' ? runWords(j) : action === 'make_anyway' ? 'Bill ' + (j.bill_number || '') + ' made.' : 'Done — ' + (j.status || ''));
        setAsk(null); load(); if (props.onChanged) { props.onChanged(); }
      } else { toast.error((j && j.error) || 'Not done.'); }
    }).finally(function () { setBusy(false); });
  }
  function edit(r) {
    setForm({ id: r.id, vendor_name: r.vendor_name, amount: r.amount, category: r.category || '', release_number: r.release_number || '', frequency: r.frequency, start_date: String(r.start_date).substring(0, 10), end_date: r.end_date ? String(r.end_date).substring(0, 10) : '', lead_days: r.lead_days, notes: r.notes || '' });
  }
  function set(k, v) { var n = Object.assign({}, form); n[k] = v; setForm(n); }

  var list = rows || [];
  return <div className="rounded-xl p-3 mb-3" style={box}>
    <div className="flex items-center gap-2 flex-wrap mb-2">
      <div className="text-[13px] font-extrabold" style={{ color: '#9a3412' }}>🔁 Repeating bills</div>
      <div className="text-[10px]" style={{ color: '#64748b' }}>Set up once; the Hub makes each bill on its own, a few days before its date. Every bill goes through the duplicate check.</div>
      <div className="flex-1" />
      {canManage && !form && <button onClick={function () { setForm({ frequency: 'monthly', start_date: todayStr(), lead_days: DEFAULT_LEAD_DAYS }); }} disabled={busy || !!sqlMissing} className="px-3 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#c2410c', color: '#ffffff' }}>➕ New repeating bill</button>}
      <button onClick={load} disabled={busy} className="px-2 py-1 rounded-lg text-[10px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>↻</button>
      <button onClick={props.onClose} className="px-2 py-1 rounded-lg text-[10px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>✕ Close</button>
    </div>
    {sqlMissing && <div className="text-[11px] p-2 rounded mb-2" style={{ background: '#fef2f2', color: '#991b1b' }}>{sqlMissing}</div>}
    {err && <div className="text-[11px] p-2 rounded mb-2" style={{ background: '#fef2f2', color: '#991b1b' }}>{err}</div>}

    {form && <div className="rounded-lg p-2 mb-3" style={{ background: '#fff7ed', border: '1px solid #fed7aa', color: '#0f172a' }}>
      <div className="text-[11px] font-extrabold mb-1">{form.id ? '✏ Edit repeating bill — changes apply to FUTURE bills only' : '➕ New repeating bill'}</div>
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <label className="text-[10px] font-bold">Vendor<input className={inp + ' w-full'} style={inpStyle} value={form.vendor_name || ''} onChange={function (e) { set('vendor_name', e.target.value); }} placeholder="e.g. Warehouse staff" /></label>
        <label className="text-[10px] font-bold">Amount (USD)<input className={inp + ' w-full'} style={inpStyle} type="number" step="0.01" min="0" value={form.amount == null ? '' : form.amount} onChange={function (e) { set('amount', e.target.value); }} /></label>
        <label className="text-[10px] font-bold">Category
          {cats && cats.length
            ? <select className={inp + ' w-full'} style={inpStyle} value={form.category || ''} onChange={function (e) { set('category', e.target.value); }}><option value="">— the vendor’s usual —</option>{cats.map(function (c) { return <option key={c.key} value={c.key}>{c.label}</option>; })}</select>
            : <input className={inp + ' w-full'} style={inpStyle} value={form.category || ''} onChange={function (e) { set('category', e.target.value); }} />}
        </label>
        <label className="text-[10px] font-bold">Release # (if any)<input className={inp + ' w-full'} style={inpStyle} value={form.release_number || ''} onChange={function (e) { set('release_number', e.target.value); }} /></label>
        <label className="text-[10px] font-bold">How often
          <select className={inp + ' w-full'} style={inpStyle} value={form.frequency || 'monthly'} onChange={function (e) { set('frequency', e.target.value); }}>{Object.keys(FREQUENCIES).map(function (k) { return <option key={k} value={k}>{FREQUENCIES[k]}</option>; })}</select></label>
        <label className="text-[10px] font-bold">First date (due)<input className={inp + ' w-full'} style={inpStyle} type="date" value={form.start_date || ''} onChange={function (e) { set('start_date', e.target.value); }} /></label>
        <label className="text-[10px] font-bold">Last date (optional)<input className={inp + ' w-full'} style={inpStyle} type="date" value={form.end_date || ''} onChange={function (e) { set('end_date', e.target.value); }} /></label>
        <label className="text-[10px] font-bold">Make the bill … days before<input className={inp + ' w-full'} style={inpStyle} type="number" min="0" max="60" value={form.lead_days == null ? '' : form.lead_days} onChange={function (e) { set('lead_days', e.target.value); }} /></label>
      </div>
      <label className="text-[10px] font-bold block mt-2">Note (goes on every bill)<input className={inp + ' w-full'} style={inpStyle} value={form.notes || ''} onChange={function (e) { set('notes', e.target.value); }} /></label>
      <div className="flex gap-2 mt-2">
        <button onClick={save} disabled={busy} className="px-3 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#c2410c', color: '#ffffff' }}>{busy ? 'Saving…' : '💾 Save'}</button>
        <button onClick={function () { setForm(null); }} className="px-3 py-1 rounded-lg text-[11px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>Cancel</button>
      </div>
    </div>}

    {rows && !list.length && !sqlMissing && <div className="text-[11px]" style={{ color: '#64748b' }}>No repeating bills yet.</div>}
    {list.map(function (r) {
      var st = STATUS[r.status] || STATUS.active;
      return <div key={r.id} className="rounded-lg p-2 mb-2" style={{ background: '#ffffff', border: '1px solid #e2e8f0', color: '#0f172a' }}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[12px] font-extrabold">{r.vendor_name}</span>
          <span className="text-[12px] font-bold">${fmt(r.amount)}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ background: st.bg, color: st.fg }}>{st.t}</span>
          <span className="text-[10px]" style={{ color: '#475569' }}>{r.schedule_words}{r.category ? ' · ' + r.category : ''}{r.release_number ? ' · release ' + r.release_number : ''} · made {r.lead_days} day(s) before</span>
          <div className="flex-1" />
          {canManage && r.status !== 'stopped' && <button onClick={function () { edit(r); }} disabled={busy} className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#eff6ff', color: '#1d4ed8' }}>✏ Edit</button>}
          {canManage && r.status === 'active' && <button onClick={function () { act(r.id, 'run_now'); }} disabled={busy} title="Make any bill that is due now (the Hub also does this every morning)" className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#f0fdf4', color: '#166534' }}>▶ Make due bills now</button>}
          {canManage && r.status === 'active' && <button onClick={function () { setAsk({ id: r.id, action: 'pause', reason: '' }); }} disabled={busy} className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#fef9c3', color: '#713f12' }}>⏸ Pause</button>}
          {canManage && r.status === 'paused' && <button onClick={function () { setAsk({ id: r.id, action: 'resume', reason: '' }); }} disabled={busy} className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#dcfce7', color: '#14532d' }}>▶ Resume</button>}
          {canManage && r.status !== 'stopped' && <button onClick={function () { setAsk({ id: r.id, action: 'stop', reason: '' }); }} disabled={busy} className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#fee2e2', color: '#991b1b' }}>⏹ Stop</button>}
        </div>
        <div className="text-[10px] mt-1" style={{ color: '#475569' }}>
          {r.next_date ? 'Next bill: ' + r.next_date : (r.status === 'stopped' ? 'Stopped — no more bills.' : 'No more dates (past the last date).')}
          {' · '}{r.made_count} bill(s) made{r.last_made ? ' (last for ' + String(r.last_made.occurrence_date).substring(0, 10) + ')' : ''}
          {r.last_message ? ' · last run: ' + r.last_message : ''}
        </div>
        {(r.skipped || []).map(function (s) {
          var d = String(s.occurrence_date).substring(0, 10);
          return <div key={d} className="text-[10px] mt-1 p-1.5 rounded" style={{ background: '#faf5ff', color: '#581c87', border: '1px solid #d8b4fe' }}>
            ⚠ {d}: {s.message}
            {canManage && r.status !== 'stopped' && <button onClick={function () { act(r.id, 'make_anyway', { date: d }); }} disabled={busy} className="ml-2 px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#7c3aed', color: '#ffffff' }}>These are different — make it anyway</button>}
          </div>;
        })}
        {(r.failed || []).map(function (f) { return <div key={String(f.occurrence_date)} className="text-[10px] mt-1" style={{ color: '#991b1b' }}>✖ {String(f.occurrence_date).substring(0, 10)}: could not be made ({f.message || 'error'}) — it is tried again on the next run.</div>; })}
        {ask && ask.id === r.id && <div className="mt-2 p-2 rounded flex gap-2 items-center flex-wrap" style={{ background: '#f8fafc', border: '1px solid #cbd5e1' }}>
          <span className="text-[11px] font-bold">{ask.action === 'pause' ? 'Pause it? No bills are made while it is paused (none are made later for that time).' : ask.action === 'resume' ? 'Resume it? Bills start again from today.' : 'Stop it for good? It stays on this list with every bill it made; no more bills are made.'}</span>
          <input className={inp} style={inpStyle} placeholder="Why (optional)" value={ask.reason} onChange={function (e) { setAsk(Object.assign({}, ask, { reason: e.target.value })); }} />
          <button onClick={function () { act(r.id, ask.action, { reason: ask.reason }); }} disabled={busy} className="px-2 py-0.5 rounded text-[10px] font-extrabold" style={{ background: '#0f172a', color: '#ffffff' }}>Yes</button>
          <button onClick={function () { setAsk(null); }} className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>No</button>
        </div>}
      </div>;
    })}
  </div>;
}
