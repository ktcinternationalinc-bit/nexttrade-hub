'use client';
// v55.83-TW — Accounting → 💸 Bills → 🟦 Nextrade bills: the KTC bills made from (or attached to) Nextrade expense lines.
// They are OWED to Nextrade (paid via NextTrade) and stay open until KTC pays Nextrade; the Nextrade line never marks them
// paid. Read-only list; the bill itself is edited in the main Bills list like any other bill.
import React, { useState, useEffect } from 'react';
import { hubFetch } from '../lib/hub-fetch';

function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function NextradeBillsPanel(props) {
  var userProfile = props.userProfile;
  var s1 = useState(null); var rows = s1[0]; var setRows = s1[1];
  var s2 = useState(''); var err = s2[0]; var setErr = s2[1];
  var s3 = useState(false); var showVoid = s3[0]; var setShowVoid = s3[1];
  var s4 = useState(false); var canTotals = s4[0]; var setCanTotals = s4[1];
  function load() {
    hubFetch('/api/accounting/company-books', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'nextrade_bills', user_id: userProfile && userProfile.id }) })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j && j.ok) { setRows(j.rows || []); setCanTotals(j.can_totals === true); setErr(j.sql_missing || ''); } else { setErr((j && j.error) || 'Could not load.'); } })
      .catch(function (e) { setErr('Could not reach the server (' + ((e && e.message) || 'network') + ').'); });
  }
  useEffect(function () { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  var list = (rows || []).filter(function (r) { return showVoid || r.link.status === 'active'; });
  var open = 0; (rows || []).forEach(function (r) { if (r.link.status === 'active' && r.bill && r.bill.record_status === 'active') { open += Math.max(0, (Number(r.bill.total_amount) || 0) - (r.paid || 0)); } });
  return <div className="rounded-xl p-3 mb-3" style={{ background: '#ffffff', color: '#0f172a', border: '1px solid #93c5fd' }}>
    <div className="flex items-center gap-2 flex-wrap mb-2">
      <div className="text-[13px] font-extrabold" style={{ color: '#1e3a8a' }}>🟦 Nextrade bills</div>
      <div className="text-[10px]" style={{ color: '#64748b' }}>Made at once when a Nextrade expense is categorized — owed to Nextrade, due at the end of the month.</div>
      <div className="flex-1" />
      {canTotals && <span className="text-[11px] font-bold">Still owed: ${fmt(open)}</span>}
      <label className="text-[10px]"><input type="checkbox" checked={showVoid} onChange={function (e) { setShowVoid(e.target.checked); }} /> show voided</label>
      <button onClick={load} className="px-2 py-1 rounded-lg text-[10px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>↻</button>
      <button onClick={props.onClose} className="px-2 py-1 rounded-lg text-[10px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>✕ Close</button>
    </div>
    {err && <div className="text-[11px] p-2 rounded mb-2" style={{ background: '#fef2f2', color: '#991b1b' }}>{err}</div>}
    <div style={{ overflowX: 'auto' }}><table className="w-full text-[11px]"><thead><tr style={{ background: '#eff6ff' }}>
      <th className="p-1 text-left">Bill #</th><th className="p-1 text-left">Vendor</th><th className="p-1 text-left">Due</th><th className="p-1 text-right">Amount</th><th className="p-1 text-left">KTC category</th><th className="p-1 text-left">From the Nextrade line</th><th className="p-1 text-left">Status</th></tr></thead>
      <tbody>{list.map(function (r) {
        var b = r.bill || {}; var l = r.line || {};
        var st = r.link.status !== 'active' ? 'voided (category changed)' : b.record_status !== 'active' ? b.record_status : r.paid >= (Number(b.total_amount) || 0) - 0.005 ? 'paid' : 'owed to Nextrade';
        return <tr key={r.link.id} style={{ borderTop: '1px solid #e2e8f0', opacity: r.link.status === 'active' ? 1 : 0.5 }}>
          <td className="p-1 whitespace-nowrap">{b.bill_number}{r.link.mode === 'attached' ? ' 🔗' : ''}</td><td className="p-1">{b.vendor_name}</td><td className="p-1 whitespace-nowrap">{b.due_date}</td>
          <td className="p-1 text-right font-bold">{fmt(b.total_amount)}</td><td className="p-1">{b.category || <span style={{ color: '#b45309' }}>not set — Nextrade → Category mapping</span>}</td>
          <td className="p-1">{l.date} · {l.name}</td><td className="p-1">{st}</td></tr>;
      })}</tbody></table></div>
    {rows && !list.length && <div className="text-[11px] mt-2" style={{ color: '#64748b' }}>No Nextrade bills yet.</div>}
    <div className="text-[10px] mt-2" style={{ color: '#64748b' }}>🔗 = an existing KTC bill (for example a repeating rent bill) the Nextrade line was attached to, instead of making a second bill.</div>
  </div>;
}
