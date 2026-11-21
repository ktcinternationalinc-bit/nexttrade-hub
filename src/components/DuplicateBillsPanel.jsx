// v55.83-WZ — Bills → "Duplicates to resolve" (Max, 21 Nov 2026: "i don't want any duplicate bills"). Bills that share a vendor
// and a bill number were entered before the database started refusing them. Pick the copy to KEEP; the others are voided with
// the Bills screen's own Void (never deleted). A copy with money on it or on a wire is not voided — the reason is shown.
import React, { useState, useEffect } from 'react';
import { hubFetch } from '../lib/hub-fetch';
import { keepPlan } from '../lib/bill-duplicates';

function money(v) { return '$' + (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function post(url, body) {
  return hubFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'The server did not answer properly (HTTP ' + r.status + ').' }; }); })
    .catch(function (e) { return { ok: false, error: 'Could not reach the server (' + ((e && e.message) || 'network') + ').' }; });
}

// props: userProfile, onClose(), onChanged() (reload the bills list), onOpenBill(id)
export default function DuplicateBillsPanel(props) {
  var s1 = useState({ loading: true, groups: [], error: '' }); var st = s1[0]; var setSt = s1[1];
  var s2 = useState(''); var busy = s2[0]; var setBusy = s2[1];
  var s3 = useState(null); var msg = s3[0]; var setMsg = s3[1];
  function load() { setSt({ loading: true, groups: [], error: '' }); post('/api/accounting/bill-duplicates', { action: 'list', user_id: props.userProfile && props.userProfile.id }).then(function (j) { setSt(j && j.ok ? { loading: false, groups: j.groups || [], error: '' } : { loading: false, groups: [], error: (j && j.error) || 'Could not load.' }); }); }
  useEffect(function () { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  function keep(g, id) {
    var plan = keepPlan(g, id); if (!plan.ok) { setMsg({ bad: true, text: plan.error }); return; }
    if (!plan.void_ids.length) { setMsg({ bad: true, text: 'None of the other copies can be voided now: ' + plan.blocked.map(function (b) { return b.why; }).join('; ') + '.' }); return; }
    if (typeof window !== 'undefined' && !window.confirm('Keep the copy entered ' + String(plan.keep.created_at || '').substring(0, 10) + ' and VOID ' + plan.void_ids.length + ' other cop' + (plan.void_ids.length === 1 ? 'y' : 'ies') + '? Voided bills stay on record; nothing is deleted.')) { return; }
    setBusy(g.key); var done = 0; var errs = [];
    plan.void_ids.reduce(function (p, vid) { return p.then(function () { return post('/api/accounting/bills', { action: 'void_bill', id: vid, reason: plan.reason, user_id: props.userProfile && props.userProfile.id }).then(function (j) { if (j && j.ok) { done++; } else { errs.push((j && j.error) || 'not voided'); } }); }); }, Promise.resolve())
      .then(function () { setBusy(''); setMsg({ bad: errs.length > 0, text: done + ' copy(ies) voided.' + (plan.blocked.length ? ' Not voided: ' + plan.blocked.map(function (b) { return b.why; }).join('; ') + '.' : '') + (errs.length ? ' Refused: ' + errs.join('; ') : '') }); load(); if (props.onChanged) { props.onChanged(); } });
  }
  return (
    <div className="rounded-xl p-3 mb-2" style={{ background: '#ffffff', border: '1px solid #fca5a5', color: '#0f172a' }}>
      <div className="flex items-center gap-2 mb-1"><b className="text-[13px]">Duplicates to resolve</b><span className="text-[11px]" style={{ color: '#64748b' }}>Bills with the same vendor and bill number. New ones are refused when saved; these were entered before that rule.</span><button type="button" onClick={function () { if (props.onClose) { props.onClose(); } }} className="ml-auto text-[11px] font-bold" style={{ color: '#64748b' }}>✕ Close</button></div>
      {msg && <div className="text-[11px] mb-1 px-2 py-1 rounded" style={{ background: msg.bad ? '#fef2f2' : '#ecfdf5', color: msg.bad ? '#991b1b' : '#065f46' }}>{msg.text}</div>}
      {st.loading && <div className="text-[11px]" style={{ color: '#64748b' }}>Loading…</div>}
      {st.error && <div className="text-[11px]" style={{ color: '#991b1b' }}>{st.error}</div>}
      {!st.loading && !st.error && st.groups.length === 0 && <div className="text-[11px]" style={{ color: '#065f46' }}>No duplicate bills. ✓</div>}
      {st.groups.map(function (g) { return <div key={g.key} className="mt-2" style={{ borderTop: '1px solid #e2e8f0' }}>
        <div className="text-[12px] font-extrabold mt-1">{g.vendor + ' — bill #' + g.number + ' — ' + g.copies.length + ' active copies'}</div>
        <table className="w-full text-[11px]"><tbody>{g.copies.map(function (c) { return <tr key={c.id} style={{ borderTop: '1px solid #f1f5f9' }}>
          <td className="py-1"><button type="button" onClick={function () { if (props.onOpenBill) { props.onOpenBill(c.id); } }} style={{ color: '#1d4ed8', fontWeight: 800, textDecoration: 'underline' }}>{'entered ' + String(c.created_at || '').substring(0, 10)}</button></td>
          <td className="py-1">{'dated ' + (c.bill_date || '—') + ' · ' + money(c.total_amount) + (c.release_number ? ' · release ' + c.release_number : '')}</td>
          <td className="py-1">{[c.disputed ? 'DISPUTED' : '', c.validation_status === 'validated' ? 'validated' : 'not validated', c.attachment_path ? 'file attached' : 'no file', c.paid > 0 ? 'paid ' + money(c.paid) : '', c.wire ? 'on wire ' + c.wire.label + ' (' + c.wire.status + ')' : ''].filter(Boolean).join(' · ')}</td>
          <td className="py-1 text-right"><button type="button" disabled={!!busy} onClick={function () { keep(g, c.id); }} className="px-2 py-0.5 rounded font-extrabold" style={{ background: busy ? '#94a3b8' : '#047857', color: '#ffffff' }}>Keep this one</button></td>
        </tr>; })}</tbody></table>
      </div>; })}
    </div>
  );
}
