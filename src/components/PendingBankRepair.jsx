'use client';
import React, { useState } from 'react';
import { RefreshCw, Wrench, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { bankSessionHeaders } from '../lib/bank-visibility-client';
import { isStalePending, pendingLabel } from '../lib/pending-age'; // v55.83-XT

export default function PendingBankRepair({ onChanged }) {
  var [open, setOpen] = useState(false);
  var [busy, setBusy] = useState(false);
  var [records, setRecords] = useState([]);
  var [selected, setSelected] = useState({});
  var [error, setError] = useState('');
  var [results, setResults] = useState(null);
  var [truncated, setTruncated] = useState(false);
  async function request(body) {
    var r = await fetch('/api/plaid/pending-repair', { method: 'POST', headers: await bankSessionHeaders(supabase, true), body: JSON.stringify(body) });
    var j = await r.json();
    if (!r.ok || j.error) { throw new Error(j.error || 'Pending repair could not be loaded.'); }
    return j;
  }
  async function preview() {
    setOpen(true); setBusy(true); setError(''); setResults(null); setSelected({});
    try { var j = await request({ action: 'preview' }); setRecords(j.records || []); setTruncated(j.truncated === true); }
    catch (e) { setError(e.message); setRecords([]); }
    finally { setBusy(false); }
  }
  async function repair() {
    var ids = Object.keys(selected).filter(function (id) { return selected[id]; });
    if (!ids.length || busy) { return; }
    setBusy(true); setError('');
    try {
      var keepIds = {}; records.forEach(function (r) { if (selected[r.pending_id] && r.keep_id) { keepIds[r.pending_id] = r.keep_id; } });
      var j = await request({ action: 'repair', pending_ids: ids, keep_ids: keepIds, confirm: true });
      setResults(j); setSelected({});
      var done = {}; (j.results || []).forEach(function (r) { if (r.ok) { done[r.pending_id] = true; } });
      setRecords(function (rs) { return rs.filter(function (r) { return !done[r.pending_id]; }); });
      if (j.repaired && onChanged) { onChanged(); }
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  var count = Object.keys(selected).filter(function (id) { return selected[id]; }).length;
  var button = 'inline-flex items-center gap-2 px-3 py-2 border rounded text-sm font-semibold';
  return <>
    <button type="button" onClick={preview} className={button} style={{ background: '#ffffff', color: '#334155', borderColor: '#cbd5e1' }}><Wrench size={16} /> Review pending records</button>
    {open && <div role="dialog" aria-modal="true" aria-labelledby="pending-repair-title" style={{ position: 'fixed', inset: 0, zIndex: 110, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <section className="rounded-lg" style={{ background: '#ffffff', color: '#0f172a', width: '100%', maxWidth: 1000, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <header className="p-3 border-b flex items-center gap-2">
          <h2 id="pending-repair-title" className="text-base font-bold flex-1">Pending bank records</h2>
          <button type="button" title="Refresh preview" aria-label="Refresh preview" disabled={busy} onClick={preview} className="p-2 border rounded"><RefreshCw size={18} /></button>
          <button type="button" title="Close pending records" aria-label="Close pending records" disabled={busy} onClick={function () { setOpen(false); }} className="p-2 border rounded"><X size={18} /></button>
        </header>
        <div className="p-3" style={{ overflow: 'auto' }}>
          {error && <p role="alert" className="p-2 mb-2" style={{ color: '#991b1b', background: '#fef2f2' }}>{error}</p>}
          {results && <div role="status" className="p-2 mb-2" style={{ background: '#f0fdf4', color: '#166534' }}>
            {results.repaired || 0} repaired. {(results.results || []).filter(function (r) { return !r.ok; }).map(function (r) { return <p key={r.pending_id} style={{ color: '#991b1b' }}>{r.reason}</p>; })}
          </div>}
          {truncated && <p role="status">First 500 pending records shown. Refresh after repairing this batch.</p>}
          {busy && <p role="status">Checking bank records...</p>}
          {!busy && !error && !records.length && <p>No pending records remain in this preview.</p>}
          {records.length > 0 && <table className="w-full text-sm" style={{ minWidth: 690 }}>
            <thead><tr className="border-b text-left"><th className="p-2">Select</th><th className="p-2">Bank record</th><th className="p-2 text-right">Amount</th><th className="p-2">Posted date</th><th className="p-2">Finding</th></tr></thead>
            <tbody>{records.map(function (r) { return <tr key={r.pending_id} className="border-b">
              <td className="p-2"><input type="checkbox" aria-label={'Repair ' + r.description} disabled={busy || (r.status !== 'replacement_found' && r.status !== 'reconnect_copy') || (!selected[r.pending_id] && count >= 25)} checked={!!selected[r.pending_id]} onChange={function (e) { var value = e.target.checked; setSelected(function (s) { return Object.assign({}, s, { [r.pending_id]: value }); }); }} /></td>
              <td className="p-2" style={{ maxWidth: 280, overflowWrap: 'anywhere' }}><b>{r.description}</b><div>{r.date}</div>{(function () { var pr = { pending: true, date: r.date }; return <div className="font-bold" style={{ color: isStalePending(pr) ? '#b45309' : '#64748b' }}>{pendingLabel(pr)}</div>; })()}{r.account_label && <div>{r.account_label}</div>}</td>
              <td className="p-2 text-right" style={{ whiteSpace: 'nowrap' }}>{r.currency} {Number(r.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
              <td className="p-2">{r.posted_date || (r.kept_pending ? 'Still pending' : '-')}</td><td className="p-2" style={{ minWidth: 220, overflowWrap: 'anywhere' }}>{r.explanation}{r.keep_id && <div className="mt-2"><b>Keep:</b> {r.kept_date} {r.kept_description}</div>}</td>
            </tr>; })}</tbody>
          </table>}
        </div>
        <footer className="p-3 border-t flex justify-end">
          <button type="button" onClick={repair} disabled={busy || count === 0} className={button} style={{ background: '#047857', color: '#ffffff', opacity: busy || !count ? 0.5 : 1 }}><Wrench size={16} /> Confirm repair ({count})</button>
        </footer>
      </section>
    </div>}
  </>;
}
