'use client';
// v55.83-PW — Accounting > 📑 All Transactions (Max, Nov 7 10:51): "should be
// a section where all accounting transactions from all bank accounts that are
// added to see everything and able to sort and filter and do multiple
// category updates and do matching from there as well."
//
// Every account in one table · click a column to sort · filter by account /
// direction / category state / text / dates · tick rows → apply ONE category
// to all of them (learns rules like single picks) · deposits jump straight
// into Bank Review matching.
import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { bankSessionHeaders } from '../lib/bank-visibility-client';

function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function AllTransactionsTab(props) {
  var userProfile = props.userProfile;
  var isSuperAdmin = props.isSuperAdmin === true || (userProfile && userProfile.role === 'super_admin');
  var modulePerms = props.modulePerms || {};
  var canUse = isSuperAdmin || modulePerms['bank.classify'] === true;
  var toast = props.toast || { success: function () {}, error: function () {} };
  var onGo = props.onGo || function () {};

  var s1 = useState(null); var data = s1[0]; var setData = s1[1];
  var s2 = useState(false); var busy = s2[0]; var setBusy = s2[1];
  var s3 = useState('2026-01-01'); var from = s3[0]; var setFrom = s3[1];
  var s4 = useState(new Date().toISOString().substring(0, 10)); var to = s4[0]; var setTo = s4[1];
  var s5 = useState('all'); var fAcct = s5[0]; var setFAcct = s5[1];
  var s6 = useState('all'); var fDir = s6[0]; var setFDir = s6[1];
  var s7 = useState('all'); var fCat = s7[0]; var setFCat = s7[1]; // all/uncategorized/categorized/transfers/matched
  var s8 = useState(''); var q = s8[0]; var setQ = s8[1];
  var s9 = useState('date'); var sortBy = s9[0]; var setSortBy = s9[1];
  var s10 = useState(true); var sortDesc = s10[0]; var setSortDesc = s10[1];
  var s11 = useState({}); var sel = s11[0]; var setSel = s11[1];
  var s12 = useState(''); var bulkCat = s12[0]; var setBulkCat = s12[1];
  var s13 = useState([]); var cats = s13[0]; var setCats = s13[1];
  var s14 = useState(null); var mPanel = s14[0]; var setMPanel = s14[1]; // v55.83-PW inline matching {txn, candidates}
  var s15 = useState({}); var mAmt = s15[0]; var setMAmt = s15[1];       // per-candidate apply amount

  function api(action, payload) {
    return fetch('/api/accounting/expense-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: action, payload: payload || {}, user_id: userProfile && userProfile.id }) })
      .then(function (r) { return r.json(); });
  }
  function load() {
    setBusy(true);
    Promise.all([api('all_transactions', { from: from, to: to }), api('list')]).then(function (rs) {
      var j = rs[0];
      if (j && j.ok) { setData(j); setSel({}); } else { toast.error((j && j.error) || 'Could not load.'); }
      if (rs[1] && rs[1].ok) { setCats((rs[1].categories || []).filter(function (c) { return c.active !== false; })); }
    }).finally(function () { setBusy(false); });
  }
  useEffect(function () { if (canUse) { load(); } }, []); // eslint-disable-line

  if (!canUse) {
    return <div className="rounded-xl p-4 text-sm" style={{ background: '#ffffff', border: '1px solid #e2e8f0', color: '#334155' }}>
      All Transactions needs the <b>Bank: Categorize Transactions</b> permission — ask an admin in Settings → Permissions.</div>;
  }

  var txns = (data && data.transactions) || [];
  var accounts = [];
  txns.forEach(function (t) { if (accounts.indexOf(t.account) < 0) { accounts.push(t.account); } });
  accounts.sort();
  var labelOf = {}; cats.forEach(function (c) { labelOf[c.key] = c.label; });

  var rows = txns.filter(function (t) {
    if (fAcct !== 'all' && t.account !== fAcct) { return false; }
    if (fDir !== 'all' && t.direction !== fDir) { return false; }
    if (fCat === 'uncategorized' && (t.classification || t.transfer || t.matched)) { return false; }
    if (fCat === 'categorized' && !t.classification) { return false; }
    if (fCat === 'transfers' && !(t.transfer || t.classification === 'transfer')) { return false; }
    if (fCat === 'matched' && !t.matched) { return false; }
    if (q.trim() && String(t.who).toLowerCase().indexOf(q.trim().toLowerCase()) < 0) { return false; }
    return true;
  });
  rows = rows.slice().sort(function (a, b) {
    var va = sortBy === 'amount' ? a.amount : sortBy === 'account' ? a.account : sortBy === 'who' ? a.who : a.date;
    var vb = sortBy === 'amount' ? b.amount : sortBy === 'account' ? b.account : sortBy === 'who' ? b.who : b.date;
    if (va < vb) { return sortDesc ? 1 : -1; }
    if (va > vb) { return sortDesc ? -1 : 1; }
    return 0;
  });
  var selIds = Object.keys(sel).filter(function (k) { return sel[k]; });
  var sumSel = 0; rows.forEach(function (t) { if (sel[t.id]) { sumSel += t.direction === 'out' ? -t.amount : t.amount; } });

  function th(key, label, right) {
    return <th className={'py-1.5 pr-2 font-semibold cursor-pointer select-none ' + (right ? 'text-right' : 'text-left')}
      onClick={function () { if (sortBy === key) { setSortDesc(!sortDesc); } else { setSortBy(key); setSortDesc(true); } }}>
      {label}{sortBy === key ? (sortDesc ? ' ↓' : ' ↑') : ''}</th>;
  }
  function toggleAll() {
    var all = {}; var every = rows.length > 0 && rows.every(function (t) { return sel[t.id]; });
    if (!every) { rows.forEach(function (t) { all[t.id] = true; }); }
    setSel(all);
  }
  function applyBulk() {
    if (!bulkCat || selIds.length === 0) { return; }
    setBusy(true);
    api('bulk_classify', { ids: selIds, classification: bulkCat }).then(function (j) {
      if (j && j.ok) { toast.success('Category applied to ' + j.updated + ' transaction(s); ' + (j.rules_learned || 0) + ' rule(s) learned.'); load(); }
      else { toast.error((j && j.error) || 'Bulk update failed.'); }
    }).finally(function () { setBusy(false); });
  }
  function openMatch(t) {
    var isBill = t.direction === 'out'; // v55.83-PW (Max 11:02): spending matches to BILLS the same way
    setBusy(true);
    fetch('/api/accounting/bills', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: isBill ? 'bill_match_candidates' : 'deposit_match_candidates', bank_transaction_id: t.id, user_id: userProfile && userProfile.id }) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.ok) {
          var d2 = {};
          (j.candidates || []).forEach(function (c2) { d2[c2.id || c2.bill_id] = String(Math.min(c2.open, j.txn.amount_abs)); });
          setMAmt(d2); setMPanel({ kind: isBill ? 'bill' : 'invoice', txn: j.txn, candidates: j.candidates || [] });
        } else { toast.error((j && j.error) || 'Could not load match candidates.'); }
      }).finally(function () { setBusy(false); });
  }
  function doBillMatch(cand) {
    var amt = Number(mAmt[cand.bill_id]);
    if (!(amt > 0)) { toast.error('Enter the amount to apply.'); return; }
    setBusy(true);
    // record_payment: overpay + over-allocation + settled-out guards live server-side.
    fetch('/api/accounting/bills', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'record_payment', bill_id: cand.bill_id, amount: amt, paid_date: mPanel.txn.posted_date || mPanel.txn.date, bank_transaction_id: mPanel.txn.id, user_id: userProfile && userProfile.id }) })
      .then(function (r) { return r.json(); }).then(function (j) {
        if (j && (j.ok || !j.error)) { toast.success('Bill ' + cand.ref + ' paid $' + fmt(amt) + ' from this transaction ✓'); setMPanel(null); load(); }
        else { toast.error(j.error || 'Could not record the bill payment.'); }
      }).finally(function () { setBusy(false); });
  }
  function doMatch(cand) {
    var amt = Number(mAmt[cand.id]);
    if (!(amt > 0)) { toast.error('Enter the amount to apply.'); return; }
    setBusy(true);
    // The write goes through bank-write match_invoice — the SAME guarded path
    // as Bank Review (silo guard, over-apply guard, money conservation).
    bankSessionHeaders(supabase, true).then(function (h) {
      return fetch('/api/accounting/bank-write', { method: 'POST', headers: h,
        body: JSON.stringify({ action: 'match_invoice', txn: mPanel.txn, invoice: cand.invoice, amount: amt, user_id: userProfile && userProfile.id }) });
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && (j.ok || j.success)) { toast.success('Matched $' + fmt(amt) + ' to ' + cand.ref + ' ✓ (flows to Wave + ClickBooks automatically)'); setMPanel(null); load(); }
      else { toast.error((j && j.error) || 'Match failed.'); }
    }).finally(function () { setBusy(false); });
  }
  function csv() {
    var lines = ['date,account,description,direction,amount,category,verified,matched,transfer'];
    rows.forEach(function (t) {
      lines.push([t.date, '"' + String(t.account).replace(/"/g, '""') + '"', '"' + String(t.who).replace(/"/g, '""') + '"',
        t.direction, t.amount.toFixed(2), t.classification || '', t.verified ? 'yes' : '', t.matched ? 'yes' : '', t.transfer ? 'yes' : ''].join(','));
    });
    var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'all-transactions-' + from + '_to_' + to + '.csv'; a.click();
  }

  return <div className="flex flex-col gap-2">
    <div className="rounded-xl p-3" style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}>
      <div className="flex gap-2 items-center flex-wrap mb-2">
        <div className="text-sm font-extrabold" style={{ color: '#0f172a' }}>📑 All Transactions — every connected account</div>
        <div className="flex-1" />
        <input type="date" value={from} onChange={function (e) { setFrom(e.target.value); }} className="px-2 py-1 rounded-lg border border-slate-300 text-[10px]" style={{ color: '#0f172a', background: '#ffffff' }} />
        <span className="text-[10px]" style={{ color: '#64748b' }}>→</span>
        <input type="date" value={to} onChange={function (e) { setTo(e.target.value); }} className="px-2 py-1 rounded-lg border border-slate-300 text-[10px]" style={{ color: '#0f172a', background: '#ffffff' }} />
        <button onClick={load} disabled={busy} className="px-2.5 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#1e293b', color: '#ffffff', opacity: busy ? 0.5 : 1 }}>Load</button>
        <button onClick={csv} className="px-2 py-1 rounded-lg text-[10px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>⬇ CSV</button>
      </div>
      <div className="flex gap-1.5 items-center flex-wrap mb-2">
        <select value={fAcct} onChange={function (e) { setFAcct(e.target.value); }} className="px-1.5 py-1 rounded-lg border border-slate-300 text-[10px]" style={{ color: '#0f172a', background: '#ffffff' }}>
          <option value="all">All accounts ({accounts.length})</option>
          {accounts.map(function (a) { return <option key={a} value={a}>{a}</option>; })}
        </select>
        <select value={fDir} onChange={function (e) { setFDir(e.target.value); }} className="px-1.5 py-1 rounded-lg border border-slate-300 text-[10px]" style={{ color: '#0f172a', background: '#ffffff' }}>
          <option value="all">In + out</option><option value="in">Money in</option><option value="out">Money out</option>
        </select>
        {['all', 'uncategorized', 'categorized', 'transfers', 'matched'].map(function (f) {
          var on = fCat === f;
          return <button key={f} onClick={function () { setFCat(f); }} className="px-2 py-1 rounded-lg text-[10px] font-extrabold"
            style={on ? { background: '#1e293b', color: '#ffffff' } : { background: '#f1f5f9', color: '#334155' }}>
            {f === 'all' ? 'Everything' : f === 'uncategorized' ? '⚠ Uncategorized' : f === 'categorized' ? 'Categorized' : f === 'transfers' ? '↔ Transfers' : '🔗 Matched'}</button>;
        })}
        <input value={q} onChange={function (e) { setQ(e.target.value); }} placeholder="search description…"
          className="px-2 py-1 rounded-lg border border-slate-300 text-[10px]" style={{ color: '#0f172a', background: '#ffffff', width: 170 }} />
        <span className="text-[10px] font-bold" style={{ color: '#64748b' }}>{rows.length} of {txns.length} shown{data && data.capped ? ' · ⚠ 5000-row cap — narrow the dates' : ''}</span>
      </div>

      {/* bulk bar */}
      <div className="flex gap-1.5 items-center flex-wrap mb-2 rounded-lg p-2" style={{ background: selIds.length ? '#eef2ff' : '#f8fafc', border: '1px solid #e2e8f0' }}>
        <span className="text-[11px] font-extrabold" style={{ color: '#312e81' }}>{selIds.length} selected{selIds.length ? ' · Σ ' + (sumSel < 0 ? '−$' : '+$') + fmt(Math.abs(sumSel)) : ''}</span>
        <select value={bulkCat} onChange={function (e) { setBulkCat(e.target.value); }} className="px-1.5 py-1 rounded-lg border border-slate-300 text-[10px]" style={{ color: '#0f172a', background: '#ffffff' }}>
          <option value="">apply category…</option>
          {cats.map(function (c) { return <option key={c.key} value={c.key}>{c.label}</option>; })}
        </select>
        <button onClick={applyBulk} disabled={busy || !bulkCat || selIds.length === 0} className="px-2.5 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#047857', color: '#ffffff', opacity: (busy || !bulkCat || selIds.length === 0) ? 0.5 : 1 }}>
          Apply to {selIds.length || '…'} selected</button>
        <span className="text-[9px]" style={{ color: '#64748b' }}>Bulk never touches verified stamps or invoice matches; rules learn from your picks. 🔗 on any deposit matches it to an invoice right here — splits/unapplied live in Bank Review.</span>
      </div>

      <div className="overflow-x-auto" style={{ maxHeight: 520, overflowY: 'auto' }}><table className="w-full text-[11px]">
        <thead><tr style={{ borderBottom: '1px solid #cbd5e1', color: '#475569', position: 'sticky', top: 0, background: '#ffffff' }}>
          <th className="py-1.5 pr-1"><input type="checkbox" checked={rows.length > 0 && rows.every(function (t) { return sel[t.id]; })} onChange={toggleAll} /></th>
          {th('date', 'Date')}{th('account', 'Account')}{th('who', 'Description')}
          {th('amount', 'Amount', true)}
          <th className="py-1.5 pr-2 text-left font-semibold">Category</th>
          <th className="py-1.5 text-left font-semibold">Status</th></tr></thead>
        <tbody style={{ color: '#0f172a' }}>
          {rows.slice(0, 1000).map(function (t) {
            return <tr key={t.id} style={{ borderBottom: '1px solid #f1f5f9', opacity: t.pending ? 0.5 : 1 }}>
              <td className="py-1 pr-1"><input type="checkbox" checked={!!sel[t.id]} onChange={function () { var n2 = Object.assign({}, sel); n2[t.id] = !n2[t.id]; setSel(n2); }} /></td>
              <td className="py-1 pr-2 whitespace-nowrap">{t.date}</td>
              <td className="py-1 pr-2 whitespace-nowrap text-[10px]">{t.account}</td>
              <td className="py-1 pr-2 font-semibold" title={t.who}>{String(t.who).substring(0, 46)}</td>
              <td className="py-1 pr-2 text-right font-extrabold tabular-nums" style={{ color: t.direction === 'out' ? '#7f1d1d' : '#065f46' }}>{(t.direction === 'out' ? '−$' : '+$') + fmt(t.amount)}</td>
              <td className="py-1 pr-2">{t.classification ? <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold" style={{ background: '#f1f5f9', color: '#334155' }}>{labelOf[t.classification] || t.classification}</span> : <span className="text-[9px]" style={{ color: '#9a3412' }}>—</span>}</td>
              <td className="py-1 text-[9px]">
                {t.pending && <span className="mr-1" style={{ color: '#64748b' }}>pending</span>}
                {t.matched && <span className="px-1 py-0.5 rounded font-extrabold mr-1" style={{ background: '#d1fae5', color: '#065f46' }}>🔗 matched</span>}
                {t.transfer && <span className="px-1 py-0.5 rounded font-extrabold mr-1" style={{ background: '#dbeafe', color: '#1e40af' }}>↔ transfer</span>}
                {t.verified && <span className="px-1 py-0.5 rounded font-extrabold mr-1" style={{ background: '#ecfdf5', color: '#064e3b' }}>✓</span>}
                {!t.matched && !t.transfer && !t.pending &&
                  <button onClick={function () { openMatch(t); }} title={t.direction === 'in' ? 'Match this deposit to an invoice right here' : 'Match this payment to an open BILL right here'} className="px-1 py-0.5 rounded font-bold" style={{ background: '#eef2ff', color: '#312e81' }}>🔗 {t.direction === 'in' ? 'match' : 'bill'}</button>}
              </td></tr>;
          })}
        </tbody>
      </table></div>
      {rows.length > 1000 && <div className="text-[10px] mt-1" style={{ color: '#64748b' }}>Showing the first 1,000 of {rows.length} — tighten the filters; the CSV carries all of them.</div>}
      {mPanel && <div className="mt-2 rounded-lg p-2" style={{ background: '#eef2ff', border: '1px solid #c7d2fe' }}>
        <div className="flex gap-2 items-center mb-1 flex-wrap">
          <div className="text-[11px] font-extrabold" style={{ color: '#312e81' }}>
            🔗 {mPanel.kind === 'bill' ? 'Match payment to a BILL' : 'Match deposit to an invoice'}: {String(mPanel.txn.merchant_name || mPanel.txn.name || '').substring(0, 44)} · {(mPanel.kind === 'bill' ? '−$' : '+$') + fmt(mPanel.txn.amount_abs)} on {mPanel.txn.posted_date || mPanel.txn.date} — best candidates first (💯 = open balance equals it to the cent):</div>
          <div className="flex-1" />
          <button onClick={function () { onGo('review'); }} className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>splits / unapplied → Bank Review</button>
          <button onClick={function () { setMPanel(null); }} className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#e2e8f0', color: '#334155' }}>✕</button>
        </div>
        {mPanel.candidates.length === 0 ? <div className="text-[10px]" style={{ color: '#312e81' }}>No open invoices found to match against.</div> :
          mPanel.candidates.map(function (c3) {
            var cid = c3.id || c3.bill_id;
            return <div key={cid} className="flex gap-2 items-center py-1 flex-wrap" style={{ borderBottom: '1px solid #e0e7ff' }}>
              {c3.exact && <span title="Open balance equals this amount to the cent">💯</span>}
              <span className="text-[11px] font-extrabold" style={{ color: '#0f172a' }}>{c3.ref}{c3.rel ? ' · ' + c3.rel : ''}</span>
              <span className="text-[10px] font-semibold" style={{ color: '#334155' }}>{String(c3.customer || c3.vendor || '').substring(0, 34)}</span>
              <span className="text-[10px]" style={{ color: '#64748b' }}>due {c3.due || '—'} · open <b style={{ color: '#78350f' }}>${fmt(c3.open)}</b> of ${fmt(c3.total)}</span>
              <div className="flex-1" />
              <input value={mAmt[cid] || ''} onChange={function (e) { var n3 = Object.assign({}, mAmt); n3[cid] = e.target.value; setMAmt(n3); }}
                className="px-1.5 py-0.5 rounded border border-slate-300 text-[10px] text-right tabular-nums" style={{ color: '#0f172a', background: '#ffffff', width: 100 }} />
              <button onClick={function () { if (mPanel.kind === 'bill') { doBillMatch(c3); } else { doMatch(c3); } }} disabled={busy} className="px-2 py-0.5 rounded text-[10px] font-extrabold" style={{ background: '#1d4ed8', color: '#ffffff', opacity: busy ? 0.5 : 1 }}>apply ✓</button>
            </div>;
          })}
      </div>}
    </div>
  </div>;
}
