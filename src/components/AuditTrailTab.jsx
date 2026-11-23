'use client';
// v55.83-QI — 🧾 Audit Trail (Max, Nov 7 12:33). WHO did WHAT, WHEN:
// categorized, matched, created, paid, validated, flagged, imported —
// merged from the hub's append-only audit log and the bill event trail.
// Read-only by construction: there is no edit or delete, for anyone.
import React, { useState, useEffect } from 'react';
import { describeAudit, niceWhen } from '../lib/audit-words'; // v55.83-TH — plain sentences (Max, Nov 16)
import { hubFetch } from '../lib/hub-fetch'; // v55.83-WQ — every accounting call carries the signed-in person's token

var ACTION_LABELS = {
  bank_classify: '🏷 categorized a transaction', bulk_categorized: '🏷 bulk-categorized',
  category_verified_stamp: '✓ verified a category', deposit_matched_to_invoice: '🔗 matched deposit → invoice',
  deposit_split_saved: '🔗 saved a deposit split', match_reversed: '↩ reversed a match',
  transfer_paired: '↔ paired a transfer', transfer_unpaired: '↔ unpaired a transfer',
  bill_created: '🧾 created a bill', bill_updated: '🧾 edited a bill', bill_payment_recorded: '💵 recorded a bill payment',
  bill_validated: '✅ validated a bill', rtm_payment_flagged: '🏢 flagged an RTM payment', rtm_flag_cleared: '🏢 cleared an RTM flag',
  advance_flagged: '⏳ flagged an advance', advance_flag_cleared: '⏳ cleared an advance',
  bill_imported_from_file: '📷 imported a bill from a file', bill_email_scanned_in: '📧 bill found by the email scanner',
  email_scan_message: '📧 email scanned', statement_rows_imported: '📄 imported statement rows',
  // v55.83-RL — wires and bills: every approval, override, change, deletion
  wire_package_prepared: '📤 prepared a wire', wire_package_updated: '📤 changed a wire', wire_package_audit_run: '🤖 wire check ran',
  wire_check_overridden: '↷ overrode a wire check', wire_package_signoff_1: '✍ signed a wire (1st)', wire_package_signoff_2: '✍ signed a wire (2nd — approved)',
  wire_package_sent: '📤 marked a wire sent', wire_package_attached: '🔗 attached a wire to its bank line', wire_package_rtm_proof: '📎 added RTM proof',
  wire_package_cancelled: '✕ cancelled a wire', wire_package_deleted: '🗑 deleted a wire (draft)', wire_package_reversed: '↩ undid a sent wire',
  bill_payments_from_wire: '💵 bills paid by a wire', bill_payments_voided_by_wire_undo: '↩ wire payments voided (undo)', bill_paid_via_set: '🏢 bills marked paid-through',
  wire_audit_run: '🤖 bank-wire check ran', wire_signoff_1: '✍ signed a bank wire (1st)', wire_signoff_2: '✍ signed a bank wire (2nd)',
  bill_release_set: '🧾 set a release #', bill_reference_set: '🧾 set a bill reference', bill_direction_set: '🧾 set inbound / outbound',
  bill_voided: '🗑 voided a bill', bill_payment_voided: '↩ voided a bill payment',
};

export default function AuditTrailTab(props) {
  var userProfile = props.userProfile;
  // v55.83-YC (Max 23 Nov) — everyone reads the plain sentence; the raw record ("show the full record") stays for the super admin
  var isSuper = props.isSuperAdmin === true || (userProfile && userProfile.role === 'super_admin');
  var s1 = useState(null); var data = s1[0]; var setData = s1[1];
  var s2 = useState(false); var busy = s2[0]; var setBusy = s2[1];
  var s3 = useState(''); var q = s3[0]; var setQ = s3[1];
  var s4 = useState(null); var err = s4[0]; var setErr = s4[1];
  var s5 = useState(null); var open = s5[0]; var setOpen = s5[1];
  var s6 = useState('all'); var scope = s6[0]; var setScope = s6[1]; // v55.83-RL — All / Wire approvals / Bill approvals

  function load(sc) {
    setBusy(true); setErr(null);
    hubFetch('/api/accounting/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list', q: q, limit: 500, scope: sc || scope, user_id: userProfile && userProfile.id }) })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j && j.ok) { setData(j); } else { setErr((j && j.error) || 'Could not load the audit trail.'); } })
      .finally(function () { setBusy(false); });
  }
  useEffect(function () { load(); }, []); // eslint-disable-line

  return <div className="rounded-xl p-3" style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}>
    <div className="flex gap-2 items-center flex-wrap mb-2">
      <div className="text-sm font-extrabold" style={{ color: '#0f172a' }}>🧾 Audit Trail — who did what, when</div>
      {[['all', 'Everything'], ['wires', '📤 Wire approvals'], ['bills', '🧾 Bill approvals']].map(function (sc) {
        return <button key={sc[0]} onClick={function () { setScope(sc[0]); load(sc[0]); }} className="px-2 py-1 rounded-lg text-[10px] font-extrabold"
          style={scope === sc[0] ? { background: '#1e293b', color: '#ffffff' } : { background: '#f1f5f9', color: '#334155' }}>{sc[1]}</button>;
      })}
      <span className="text-[9px] px-1.5 py-0.5 rounded font-extrabold" style={{ background: '#ecfdf5', color: '#064e3b' }}>append-only — nobody can edit or erase this</span>
      <div className="flex-1" />
      <input value={q} onChange={function (e) { setQ(e.target.value); }} onKeyDown={function (e) { if (e.key === 'Enter') { load(); } }}
        placeholder="search person, action, vendor, id…" className="px-2 py-1 rounded-lg border border-slate-300 text-[10px] nt-light" style={{ width: 220 }} />
      <button onClick={function () { load(); }} disabled={busy} className="px-2.5 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#1e293b', color: '#ffffff', opacity: busy ? 0.5 : 1 }}>Search</button>
    </div>
    {err && <div className="text-[11px] font-bold rounded p-2" style={{ background: '#fef2f2', color: '#7f1d1d' }}>{err}</div>}
    {!err && !data && <div className="text-[11px]" style={{ color: '#334155' }}>Loading…</div>}
    {data && <div className="grid gap-1.5">
      {(data.rows || []).map(function (r, i) { var dsc = describeAudit(r, data.ctx); /* v55.83-YC — with category / Wave names */
        return <div key={i} className="rounded-lg px-3 py-2 grid gap-0.5" style={{ border: '1px solid #e2e8f0', background: '#ffffff' }}>
          <div className="flex gap-2 items-baseline flex-wrap">
            <span className="text-[12px]" style={{ color: '#0f172a' }}><b>{r.who}</b>{' — ' + dsc.sentence}</span>
            <span className="flex-1" /><span className="text-[10px] whitespace-nowrap" style={{ color: '#64748b' }}>{niceWhen(r.at)}</span></div>
          {dsc.facts.length > 0 && <div className="text-[11px]" style={{ color: '#334155' }}>{dsc.facts.join(' · ')}</div>}
          {r.details && isSuper && <button type="button" onClick={function () { setOpen(open === i ? null : i); }} className="justify-self-start text-[10px]" style={{ color: '#64748b', background: 'none', border: 0, padding: 0, cursor: 'pointer', textDecoration: 'underline' }}>{open === i ? 'hide the full record' : 'show the full record'}</button>}
          {open === i && r.details && isSuper && <pre className="text-[10px] whitespace-pre-wrap rounded p-2" style={{ background: '#f8fafc', color: '#334155', margin: 0 }}>{JSON.stringify(r.details, null, 2)}</pre>}
        </div>;
      })}
      {(data.rows || []).length === 0 && <div className="py-3 text-center text-[11px]" style={{ color: '#64748b' }}>{'Nothing recorded yet' + (q ? ' for "' + q + '"' : '') + '.'}</div>}
    </div>}
  </div>;
}
