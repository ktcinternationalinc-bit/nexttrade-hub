'use client';
// v55.83-RM (Max, Nov 9 12:49): "We should always click on the wire transactions.
// Wires and see the bills associated to it and history."
// A bank line that IS a prepared wire (WP-…) — or a money-out that paid bills like
// a wire without one — opens this: who approved it, the bills it paid with all
// their data, overrides, proofs and the full history. Read-only.
import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { PKG_STATUS_LABEL, WIRE_STATUS_LABEL } from '../lib/wire-audit';

var INK = '#0f172a'; var SUB = '#334155'; var MUTED = '#64748b';
function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function d16(x) { return String(x || '').substring(0, 16).replace('T', ' '); }
var HIST = {
  wire_package_prepared: '➕ prepared the wire', wire_package_updated: '✏ changed the wire', wire_package_audit_run: '🤖 check ran',
  wire_check_overridden: '↷ overrode a check', wire_package_signoff_1: '✍ signed 1st', wire_package_signoff_2: '✍ signed 2nd (approved)',
  wire_package_sent: '📤 marked it sent', wire_package_attached: '🔗 attached this bank line', wire_package_rtm_proof: '📎 added RTM proof',
  bill_paid_via_set: '🏢 bills marked “paid through”', wire_package_cancelled: '✕ cancelled', wire_package_reversed: '↩ undid the wire',
};

export default function WireQuickView(props) {
  var w = props.wire; var userProfile = props.userProfile;
  var s1 = useState(null); var d = s1[0]; var setD = s1[1];
  var s2 = useState(''); var err = s2[0]; var setErr = s2[1];
  useEffect(function () {
    if (!w) { return undefined; }
    var alive = true; setD(null); setErr('');
    var url = w.kind === 'package' ? '/api/accounting/wire-packages' : '/api/accounting/wires';
    var body = w.kind === 'package' ? { action: 'get', id: w.id } : { action: 'detail', bank_transaction_id: w.id };
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ user_id: userProfile && userProfile.id }, body)) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'The server did not answer (HTTP ' + r.status + ').' }; }); })
      .then(function (j) { if (!alive) { return; } if (j && j.ok) { setD(j); } else { setErr((j && j.error) || 'Could not open the wire.'); } })
      .catch(function (e) { if (alive) { setErr('Could not reach the server (' + ((e && e.message) || 'network') + ').'); } });
    return function () { alive = false; };
  }, [w && w.kind, w && w.id]); // eslint-disable-line
  if (!w) { return null; }
  function openFile(path) {
    supabase.storage.from('bills-private').createSignedUrl(path, 3600).then(function (r) { var u = r && r.data && r.data.signedUrl; if (u) { window.open(u, '_blank'); } });
  }
  var isPkg = w.kind === 'package';
  var P = isPkg && d ? d.package : null; var A = d ? d.audit : null;
  var lines = (d && d.lines) || [];
  var title = isPkg ? ((P && P.label) || w.label || 'Wire') + (P ? ' · $' + fmt(P.approved_total != null ? P.approved_total : P.total) + ' to ' + P.payee_name : '')
    : (d && d.wire ? '🏦 $' + fmt(d.wire.amount) + ' · ' + d.wire.date + ' · ' + (d.wire.name || '') : '🏦 Wire');
  var statusTxt = isPkg ? (P ? PKG_STATUS_LABEL[P.status] : '') : (d ? WIRE_STATUS_LABEL[d.status] : '');

  return <div onClick={props.onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 12px', overflowY: 'auto' }}>
    <div onClick={function (e) { e.stopPropagation(); }} className="nt-paper rounded-2xl p-4" style={{ width: 'min(1100px, 100%)', border: '2px solid #6366f1' }}>
      <div className="flex gap-2 items-center flex-wrap mb-2">
        <div className="text-[16px] font-extrabold" style={{ color: INK }}>{title}</div>
        {statusTxt && <span className="px-2 py-1 rounded text-[11px] font-extrabold" style={{ background: '#eef2ff', color: '#312e81' }}>{statusTxt}</span>}
        <div className="flex-1" />
        <button onClick={props.onClose} className="px-3 py-1.5 rounded-lg text-[12px] font-extrabold" style={{ background: '#ffffff', color: SUB, border: '1px solid #cbd5e1' }}>✕ Close</button>
      </div>
      {err && <div className="rounded-lg p-2 text-[12px] font-bold" style={{ background: '#fee2e2', color: '#7f1d1d' }}>{err}</div>}
      {!d && !err && <div className="text-[12px]" style={{ color: MUTED }}>Loading…</div>}
      {d && <div>
        {/* who approved it */}
        <div className="rounded-xl p-3 mb-3" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
          {isPkg ? <div className="text-[12px] grid gap-1" style={{ color: INK }}>
            <div><b>Prepared:</b> {(P.created_by || '—') + ' · ' + d16(P.created_at)}</div>
            <div><b>✍ 1st signature:</b> {A.signoff1 ? A.signoff1.name + ' · ' + d16(A.signoff1.at) + (A.signoff1.note ? ' — “' + A.signoff1.note + '”' : '') : '—'}</div>
            <div><b>✍ 2nd signature:</b> {A.signoff2 ? A.signoff2.name + ' · ' + d16(A.signoff2.at) + (A.signoff2.note ? ' — “' + A.signoff2.note + '”' : '') : '—'}</div>
            <div><b>📤 Sent:</b> {P.sent ? P.sent.date + ' · ref ' + P.sent.reference + ' · by ' + P.sent.by : '—'}</div>
            <div><b>🔗 Bank line attached:</b> {P.attached ? P.attached.by + ' · ' + d16(P.attached.at) + (P.attached.note ? ' — amount difference accepted: “' + P.attached.note + '”' : '') : '—'}</div>
            {P.reversed && <div style={{ color: '#7f1d1d' }}><b>↩ Undone:</b> {P.reversed.by + ' · ' + d16(P.reversed.at) + ' — “' + P.reversed.note + '”'}</div>}
            {A.ai_summary && <div><b>🤖 AI review:</b> <span style={{ whiteSpace: 'pre-wrap' }}>{A.ai_summary}</span></div>}
          </div>
          : <div className="text-[12px] grid gap-1" style={{ color: INK }}>
            <div className="font-extrabold" style={{ color: '#b91c1c' }}>⚠ This money went out WITHOUT a wire approved in advance (no WP- number).</div>
            <div><b>Checked after the fact:</b> {A && A.checked_at ? d16(A.checked_at) + (A.checked_by ? ' by ' + A.checked_by : '') : 'not yet'}</div>
            <div><b>✍ 1st:</b> {A && A.signoff1 ? A.signoff1.name + ' · ' + d16(A.signoff1.at) : '—'} · <b>✍ 2nd:</b> {A && A.signoff2 ? A.signoff2.name + ' · ' + d16(A.signoff2.at) : '—'}</div>
          </div>}
        </div>
        {/* overrides */}
        {isPkg && (d.overrides || []).length > 0 && <div className="rounded-xl p-3 mb-3" style={{ background: '#fff7ed', border: '1px solid #fdba74' }}>
          <div className="text-[12px] font-extrabold mb-1" style={{ color: '#9a3412' }}>↷ Overridden problems (who approved, why)</div>
          {d.overrides.map(function (o, i) { return <div key={i} className="text-[12px]" style={{ color: '#7c2d12' }}>{d16(o.at) + ' · ' + o.by + ' · ' + (o.text || o.code) + ' — “' + o.reason + '”'}</div>; })}
        </div>}
        {/* the bills */}
        <div className="text-[13px] font-extrabold mb-1" style={{ color: INK }}>{'Bills paid by this wire (' + lines.length + ')' + (isPkg && P.fee_amount > 0 ? ' · plus ' + P.payee_name + ' fee $' + fmt(P.fee_amount) : '')}</div>
        <div className="overflow-x-auto rounded-lg mb-3" style={{ border: '1px solid #e2e8f0' }}><table className="w-full text-[12px]">
          <thead><tr style={{ background: '#f1f5f9', color: SUB }}>
            <th className="px-2 py-1.5 text-left">Vendor</th><th className="px-2 py-1.5 text-left">Bill #</th><th className="px-2 py-1.5 text-left">In / Out</th><th className="px-2 py-1.5 text-left">Release #</th>
            <th className="px-2 py-1.5 text-left">Reference</th><th className="px-2 py-1.5 text-left">Bill date</th><th className="px-2 py-1.5 text-left">Category</th>
            <th className="px-2 py-1.5 text-right">Bill total</th><th className="px-2 py-1.5 text-right">This wire</th><th className="px-2 py-1.5 text-left">Notes</th></tr></thead>
          <tbody style={{ color: INK }}>
            {lines.map(function (l, i) {
              var b = l.bill || {};
              return <tr key={i} style={{ borderTop: '1px solid #f1f5f9', verticalAlign: 'top' }}>
                <td className="px-2 py-1.5 font-bold">{b.vendor_name || '?'}</td><td className="px-2 py-1.5">{b.bill_number || '—'}</td>
                <td className="px-2 py-1.5">{b.shipment_direction === 'inbound' ? '⬅ In' : b.shipment_direction === 'outbound' ? 'Out ➡' : '—'}</td>
                <td className="px-2 py-1.5">{b.release_number || '—'}</td><td className="px-2 py-1.5">{b.other_reference || '—'}</td>
                <td className="px-2 py-1.5 whitespace-nowrap">{b.bill_date || '—'}</td><td className="px-2 py-1.5">{b.category ? String(b.category).replace(/_/g, ' ') : '—'}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">${fmt(b.total_amount)}</td><td className="px-2 py-1.5 text-right tabular-nums font-extrabold">${fmt(l.amount)}</td>
                <td className="px-2 py-1.5" style={{ maxWidth: 260, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{b.notes || ''}</td>
              </tr>;
            })}
            {lines.length === 0 && <tr><td colSpan={10} className="px-3 py-2" style={{ color: MUTED }}>No bills.</td></tr>}
          </tbody></table></div>
        {/* history */}
        {isPkg && (d.history || []).length > 0 && <div className="mb-3">
          <div className="text-[13px] font-extrabold mb-1" style={{ color: INK }}>🧾 History — every step, who and when</div>
          {d.history.map(function (h, i) { return <div key={i} className="text-[12px]" style={{ color: INK }}>{d16(h.at) + ' · ' + h.by + ' · ' + (HIST[h.action] || h.action)}</div>; })}
        </div>}
        {/* proofs */}
        {isPkg && (d.files || []).length > 0 && <div>
          <div className="text-[13px] font-extrabold mb-1" style={{ color: INK }}>Proofs</div>
          {d.files.map(function (f) { return <div key={f.id} className="text-[12px]" style={{ color: INK }}>{(f.kind === 'bank_confirmation' ? '🏦 Bank confirmation' : f.kind === 'rtm_proof' ? '📎 RTM proof' : '📄 File') + ' · '}<button onClick={function () { openFile(f.path); }} className="underline font-bold" style={{ color: '#1d4ed8' }}>{f.file_name || 'open'}</button>{' · ' + (f.by || '') + ' ' + d16(f.at)}</div>; })}
        </div>}
      </div>}
    </div>
  </div>;
}
