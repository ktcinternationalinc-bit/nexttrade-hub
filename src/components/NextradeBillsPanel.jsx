'use client';
// v55.83-TW — Accounting → 💸 Bills → 🟦 Nextrade bills: the KTC bills made from (or attached to) Nextrade expense lines.
// They are OWED to Nextrade (paid via NextTrade) and stay open until KTC pays Nextrade; the Nextrade line never marks them
// paid. Read-only list; the bill itself is edited in the main Bills list like any other bill.
// v55.83-XX (Max, 23 Nov 2026: "Nextrade bills need to be grouped by each type like the other ktc bills / no need to validate these bills /
// will be available for only Nextrade payments wires / also will be able to use available balance for nextrade that we enter in the
// beginning ... we can use actual ktc transfers or use the existing nextrade balance") — grouped by KTC category (collapsible, count +
// still owed per group, payroll shown without an amount never counted), and Pay ▸ is a small chooser: a KTC transfer to NextTrade (Wires →
// ＋ New wire, NextTrade, this bill ticked) or the NextTrade starting balance (super admin; Funds with RTM / NextTrade, oldest balance with
// money left, this bill ticked). Nothing is paid from this screen.
import React, { useState, useEffect } from 'react';
import { hubFetch } from '../lib/hub-fetch';
import { groupNextradeBills, nextradeRowState, nextradePayChoices, NEXTRADE_OPEN_WIRE_EVENT, NEXTRADE_PAY_OPENING_EVENT } from '../lib/nextrade-bill-groups';

function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function NextradeBillsPanel(props) {
  var userProfile = props.userProfile;
  var isSuper = props.isSuperAdmin === true || (userProfile && userProfile.role === 'super_admin');
  var s1 = useState(null); var rows = s1[0]; var setRows = s1[1];
  var s2 = useState(''); var err = s2[0]; var setErr = s2[1];
  var s3 = useState(false); var showVoid = s3[0]; var setShowVoid = s3[1];
  var s4 = useState(false); var canTotals = s4[0]; var setCanTotals = s4[1];
  var s5 = useState(''); var payNote = s5[0]; var setPayNote = s5[1]; // v55.83-XE
  var s6 = useState(false); var canGroupTotals = s6[0]; var setCanGroupTotals = s6[1]; // v55.83-XX
  var s7 = useState({}); var openG = s7[0]; var setOpenG = s7[1]; // v55.83-XX — which category groups are open
  var s8 = useState(null); var chooser = s8[0]; var setChooser = s8[1]; // v55.83-XX — the bill whose Pay ▸ chooser is open (link id)
  function load() {
    hubFetch('/api/accounting/company-books', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'nextrade_bills', user_id: userProfile && userProfile.id }) })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j && j.ok) { setRows(j.rows || []); setCanTotals(j.can_totals === true); setCanGroupTotals(j.can_group_totals === true); setPayNote(j.payroll_restricted || ''); setErr(j.sql_missing || ''); } else { setErr((j && j.error) || 'Could not load.'); } })
      .catch(function (e) { setErr('Could not reach the server (' + ((e && e.message) || 'network') + ').'); });
  }
  useEffect(function () { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // v55.83-XX — Pay ▸ (it used to open 💼 Advances & fees, retired by WF): the person chooses HOW NextTrade is paid for this bill.
  function payFromTransfer(b) {
    setChooser(null);
    try { window.dispatchEvent(new CustomEvent(NEXTRADE_OPEN_WIRE_EVENT, { detail: { payee: b.paid_via || 'NextTrade Industries', bill_id: b.id, bill_number: b.bill_number } })); } catch (e) { /* old browser */ }
  }
  function payFromOpening(b) {
    setChooser(null);
    try { window.dispatchEvent(new CustomEvent(NEXTRADE_PAY_OPENING_EVENT, { detail: { party: b.paid_via || 'NextTrade Industries', bill_id: b.id, bill_number: b.bill_number } })); } catch (e) { /* old browser */ }
  }
  var choices = nextradePayChoices(isSuper);
  var list = (rows || []).filter(function (r) { return showVoid || r.link.status === 'active'; });
  var open = 0; (rows || []).forEach(function (r) { if (r.link.status === 'active' && r.bill && r.bill.record_status === 'active') { open += Math.max(0, (Number(r.bill.total_amount) || 0) - (r.paid || 0)); } });
  var catLabelOf = {}; (props.cats || []).forEach(function (c) { catLabelOf[c.key] = c.label; }); // the Bills screen's own category labels
  var groups = groupNextradeBills(list, catLabelOf);
  function isOpen(g) { return groups.length === 1 || openG[g.key] === true; }
  function toggle(g) { var o = Object.assign({}, openG); o[g.key] = !isOpen(g); setOpenG(o); }
  function billRow(r) {
    var b = r.bill || {}; var l = r.line || {};
    // v55.83-XE — a payroll bill without 'payroll.view': no amount (null is not zero); its paid / owed state comes from the server
    var rs = nextradeRowState(r);
    var st = rs === 'voided' ? 'voided (category changed)' : rs === 'owed' ? 'owed to Nextrade' : rs;
    var showChooser = chooser === r.link.id;
    return <React.Fragment key={r.link.id}><tr style={{ borderTop: '1px solid #e2e8f0', opacity: r.link.status === 'active' ? 1 : 0.5 }}>
      <td className="p-1 whitespace-nowrap">{b.bill_number}{r.link.mode === 'attached' ? ' 🔗' : ''}</td><td className="p-1">{b.vendor_name}</td><td className="p-1 whitespace-nowrap">{b.due_date}</td>
      <td className="p-1 text-right font-bold">{r.payroll_restricted ? <span title="Payroll amount restricted — needs the Payroll / salaries: view switch" style={{ color: '#64748b' }}>🔒</span> : fmt(b.total_amount)}</td>
      <td className="p-1">{l.date} · {l.name}</td><td className="p-1">{st}{st === 'owed to Nextrade' && !r.payroll_restricted && <button onClick={function () { setChooser(showChooser ? null : r.link.id); }} title="Choose how NextTrade is paid for this bill: a KTC transfer to NextTrade, or the NextTrade starting balance" className="ml-2 px-2 py-0.5 rounded text-[10px] font-extrabold" style={{ background: '#1d4ed8', color: '#ffffff' }}>{showChooser ? 'Pay ▾' : 'Pay ▸'}</button>}</td></tr>
      {showChooser && <tr><td colSpan={6} className="p-2" style={{ background: '#eff6ff' }}>
        <div className="text-[11px] font-extrabold mb-1" style={{ color: '#1e3a8a' }}>{'Pay ' + (b.vendor_name || 'this bill') + ' ' + (b.bill_number || '') + ' — how is NextTrade paid for it?'}</div>
        <div className="flex gap-2 flex-wrap items-start">
          {choices.map(function (c) {
            return <div key={c.key} className="rounded-lg p-2" style={{ background: '#ffffff', border: '1px solid #93c5fd', maxWidth: 360 }}>
              <button onClick={function () { if (c.key === 'transfer') { payFromTransfer(b); } else { payFromOpening(b); } }} className="px-2 py-1 rounded text-[11px] font-extrabold" style={{ background: c.key === 'transfer' ? '#1d4ed8' : '#075985', color: '#ffffff' }}>{c.label + ' →'}</button>
              <div className="text-[10px] mt-1" style={{ color: '#475569' }}>{c.hint}</div></div>;
          })}
          <button onClick={function () { setChooser(null); }} className="px-2 py-1 rounded text-[10px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>Cancel</button>
        </div>
        <div className="text-[10px] mt-1" style={{ color: '#64748b' }}>Nextrade bills need no validation and are paid only through NextTrade — never recorded from a KTC bank line.</div>
      </td></tr>}
    </React.Fragment>;
  }
  return <div className="rounded-xl p-3 mb-3" style={{ background: '#ffffff', color: '#0f172a', border: '1px solid #93c5fd' }}>
    <div className="flex items-center gap-2 flex-wrap mb-2">
      <div className="text-[13px] font-extrabold" style={{ color: '#1e3a8a' }}>🟦 Nextrade bills</div>
      <div className="text-[10px]" style={{ color: '#64748b' }}>Made at once when a Nextrade expense is categorized — owed to Nextrade, due at the end of the month. No validation needed; paid only through NextTrade.</div>
      <div className="flex-1" />
      {canTotals && <span className="text-[11px] font-bold">Still owed: ${fmt(open)}</span>}
      {groups.length > 1 && <span><button onClick={function () { var o = {}; groups.forEach(function (g) { o[g.key] = true; }); setOpenG(o); }} className="text-[10px] underline font-bold mr-2" style={{ color: '#1d4ed8' }}>open all</button><button onClick={function () { setOpenG({}); }} className="text-[10px] underline font-bold" style={{ color: '#1d4ed8' }}>close all</button></span>}
      <label className="text-[10px]"><input type="checkbox" checked={showVoid} onChange={function (e) { setShowVoid(e.target.checked); }} /> show voided</label>
      <button onClick={load} className="px-2 py-1 rounded-lg text-[10px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>↻</button>
      <button onClick={props.onClose} className="px-2 py-1 rounded-lg text-[10px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>✕ Close</button>
    </div>
    {err && <div className="text-[11px] p-2 rounded mb-2" style={{ background: '#fef2f2', color: '#991b1b' }}>{err}</div>}
    <div style={{ overflowX: 'auto' }}><table className="w-full text-[13px]" style={{ color: '#0f172a' }}><thead><tr style={{ background: '#dbeafe', color: '#1e293b' }}>
      <th className="p-1 text-left">Bill #</th><th className="p-1 text-left">Vendor</th><th className="p-1 text-left">Due</th><th className="p-1 text-right">Amount</th><th className="p-1 text-left">From the Nextrade line</th><th className="p-1 text-left">Status</th></tr></thead>
      {groups.map(function (g) {
        var isO = isOpen(g);
        return <tbody key={'ng:' + g.key}>
          <tr onClick={function () { toggle(g); }} title={isO ? 'Close this group' : 'Show this group’s bills'} style={{ background: isO ? '#dbeafe' : '#f1f5f9', color: '#0f172a', borderTop: '2px solid #94a3b8', borderBottom: '1px solid #cbd5e1', cursor: 'pointer' }}>
            <td className="py-2 px-1 font-extrabold" colSpan={3}><span style={{ color: '#1d4ed8' }}>{isO ? '▾ ' : '▸ '}</span><span style={g.key ? null : { color: '#b45309' }}>{g.label}</span><span className="ml-2 font-bold" style={{ color: '#475569' }}>{g.count + (g.count === 1 ? ' bill' : ' bills') + (g.owed_count ? ' · ' + g.owed_count + ' owed' : '')}</span></td>
            <td className="py-2 px-1 text-right font-extrabold">{canGroupTotals ? '$' + fmt(g.owed_cents / 100) : ''}</td>
            <td colSpan={2} className="py-2 px-1 text-[10px]" style={{ color: '#475569' }}>{(canGroupTotals ? 'still owed' + (g.hidden ? ' — ' + g.hidden + ' payroll bill' + (g.hidden === 1 ? '' : 's') + ' 🔒 not counted' : '') + ' · ' : '') + (isO ? 'click to close' : 'click to see the bills')}</td></tr>
          {isO && g.rows.map(billRow)}
        </tbody>;
      })}</table></div>
    {payNote && <div className="text-[10px] mt-2 font-bold" style={{ color: '#92400e' }}>🔒 {payNote} The “Still owed” sum is not shown while payroll is hidden; each group’s sum leaves the hidden payroll bills out.</div>}
    {rows && !list.length && <div className="text-[11px] mt-2" style={{ color: '#64748b' }}>No Nextrade bills yet.</div>}
    <div className="text-[10px] mt-2" style={{ color: '#64748b' }}>🔗 = an existing KTC bill (for example a repeating rent bill) the Nextrade line was attached to, instead of making a second bill.</div>
  </div>;
}
