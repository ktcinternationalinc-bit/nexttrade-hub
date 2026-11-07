'use client';
// v55.83-PI — Accounting > 🏷 Categories & Rules (Max, Nov 6): "create
// categories to mark expenses.. automatically remember previous selections..
// a verified tab.. but verified will not prevent it from being counted
// against the expense.. rules automatically saved and updated if i manually
// change something.. a rules tab to create new rules for expenses."
//
// Three panels: ① Categories (add your own), ② Rules (manual + learned, with
// hit counts; ▶ apply now), ③ Expenses with Unverified / Verified / All —
// verify is a HUMAN STAMP only, the expense counts the same either way.
import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { bankSessionHeaders } from '../lib/bank-visibility-client';
import { US_WAVE_BUSINESS_ID } from '../lib/business-of'; // v55.83-PQ — Wave link

function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function ExpenseRulesTab(props) {
  var userProfile = props.userProfile;
  var isSuperAdmin = props.isSuperAdmin === true || (userProfile && userProfile.role === 'super_admin');
  var modulePerms = props.modulePerms || {};
  var canUse = isSuperAdmin || modulePerms['bank.classify'] === true;
  var toast = props.toast || { success: function () {}, error: function () {} };

  var s1 = useState([]); var cats = s1[0]; var setCats = s1[1];
  var s2 = useState([]); var rules = s2[0]; var setRules = s2[1];
  var s3 = useState([]); var exps = s3[0]; var setExps = s3[1];
  var s4 = useState('unverified'); var filter = s4[0]; var setFilter = s4[1];
  var s5 = useState(false); var busy = s5[0]; var setBusy = s5[1];
  var s6 = useState(''); var newCat = s6[0]; var setNewCat = s6[1];
  var s7 = useState({ match_text: '', classification: '' }); var nr = s7[0]; var setNr = s7[1];
  var s8 = useState(null); var needsSql = s8[0]; var setNeedsSql = s8[1];
  var s9 = useState({}); var catDraft = s9[0]; var setCatDraft = s9[1];
  var sW = useState(null); var waveAccts = sW[0]; var setWaveAccts = sW[1]; // v55.83-PQ — Wave chart for the link editor
  var sW2 = useState(false); var showWave = sW2[0]; var setShowWave = sW2[1];
  var sPr = useState(null); var pairPanel = sPr[0]; var setPairPanel = sPr[1]; // v55.83-PQ — {txn, candidates} transfer pairing
  var sSg = useState(null); var suggestions = sSg[0]; var setSuggestions = sSg[1]; // v55.83-PR — scanned transfer pairs
  var sTr = useState(null); var trReport = sTr[0]; var setTrReport = sTr[1];       // v55.83-PR — intra-company transfer register
  var sTf = useState('2026-01-01'); var trFrom = sTf[0]; var setTrFrom = sTf[1];
  var sTt = useState(new Date().toISOString().substring(0, 10)); var trTo = sTt[0]; var setTrTo = sTt[1];

  function api(action, payload) {
    return fetch('/api/accounting/expense-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: action, payload: payload || {}, user_id: userProfile && userProfile.id }) })
      .then(function (r) { return r.json(); });
  }
  function loadAll() {
    api('list').then(function (j) {
      if (j && j.ok) { setCats(j.categories || []); setRules(j.rules || []); setNeedsSql(null); }
      else if (j && j.needs_sql) { setNeedsSql(j.error); }
      else if (j) { toast.error(j.error || 'Could not load.'); }
    });
    loadExpenses(filter);
  }
  function loadExpenses(f) {
    api('expenses', { filter: f }).then(function (j) {
      if (j && j.ok) { setExps(j.expenses || []); }
      else if (j && j.needs_sql) { setNeedsSql(j.error); }
    });
  }
  useEffect(function () { if (canUse) { loadAll(); } }, []); // eslint-disable-line

  if (!canUse) {
    return <div className="rounded-xl p-4 text-sm" style={{ background: '#ffffff', border: '1px solid #e2e8f0', color: '#334155' }}>
      Categories &amp; Rules needs the <b>Bank: Categorize Transactions</b> permission — ask an admin in Settings → Permissions.</div>;
  }

  function addCategory() {
    if (!newCat.trim()) { return; }
    setBusy(true);
    api('save_category', { label: newCat.trim() }).then(function (j) {
      if (j && j.ok) { toast.success('Category "' + newCat.trim() + '" added.'); setNewCat(''); loadAll(); }
      else { toast.error((j && j.error) || 'Could not add the category.'); }
    }).finally(function () { setBusy(false); });
  }
  function toggleCat(c) {
    setBusy(true);
    api('toggle_category', { id: c.id, active: !(c.active === true) }).then(function (j) {
      if (j && j.ok) { loadAll(); } else { toast.error((j && j.error) || 'Could not update.'); }
    }).finally(function () { setBusy(false); });
  }
  function addRule() {
    setBusy(true);
    api('save_rule', { match_text: nr.match_text, classification: nr.classification }).then(function (j) {
      if (j && j.ok) { toast.success('Rule saved — it will categorize matching expenses automatically.'); setNr({ match_text: '', classification: '' }); loadAll(); }
      else { toast.error((j && j.error) || 'Could not save the rule.'); }
    }).finally(function () { setBusy(false); });
  }
  function ruleActive(r, active) {
    setBusy(true);
    var call = active ? api('save_rule', { id: r.id, match_text: r.match_text, classification: r.classification, auto_apply: r.auto_apply !== false, active: true }) : api('deactivate_rule', { id: r.id });
    call.then(function (j) {
      if (j && j.ok) { loadAll(); } else { toast.error((j && j.error) || 'Could not update the rule.'); }
    }).finally(function () { setBusy(false); });
  }
  function applyNow() {
    setBusy(true);
    api('apply_rules').then(function (j) {
      if (j && j.ok) { toast.success('Rules applied to ' + ((j.result && j.result.applied) || 0) + ' expense(s) (scanned ' + ((j.result && j.result.scanned) || 0) + ').'); loadAll(); }
      else { toast.error((j && j.error) || 'Could not apply rules.'); }
    }).finally(function () { setBusy(false); });
  }
  function recategorize(t, cls) {
    if (!cls) { return; }
    setBusy(true);
    // Same classify action as everywhere else — the server LEARNS the pick
    // (upserts the rule), so a manual change updates the rule automatically.
    var patch = { classification: cls, category_source: 'classification' };
    bankSessionHeaders(supabase, true).then(function (h) {
      return fetch('/api/accounting/bank-write', { method: 'POST', headers: h,
        body: JSON.stringify({ action: 'classify', bank_transaction_id: t.id, patch: patch, user_id: userProfile && userProfile.id }) });
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && (j.ok || j.success)) {
        toast.success('Categorized — rule remembered.'); loadExpenses(filter); loadAll();
        if (cls === 'transfer' && !t.transfer_group_id) { openPair(t); } // v55.83-PR — picking "transfer" immediately offers the other leg
      }
      else { toast.error((j && j.error) || 'Could not categorize.'); }
    }).finally(function () { setBusy(false); });
  }
  function scanTransfers() {
    setBusy(true);
    api('transfer_suggestions').then(function (j) {
      if (j && j.ok) { setSuggestions(j.suggestions || []); if ((j.suggestions || []).length === 0) { toast.success('Scanned all accounts — no unlinked transfer pairs found.'); } }
      else { toast.error((j && j.error) || 'Scan failed.'); }
    }).finally(function () { setBusy(false); });
  }
  function acceptSuggestion(sg) {
    setBusy(true);
    api('pair_transfer', { a: sg.out.id, b: sg.inn.id }).then(function (j) {
      if (j && j.ok) { toast.success('Linked as an intra-company transfer ↔'); setSuggestions((suggestions || []).filter(function (x) { return x !== sg; })); loadTransfersReport(); loadExpenses(filter); }
      else { toast.error((j && j.error) || 'Could not link.'); }
    }).finally(function () { setBusy(false); });
  }
  function loadTransfersReport() {
    api('transfers_report', { from: trFrom, to: trTo }).then(function (j) {
      if (j && j.ok) { setTrReport(j); }
    });
  }
  function trCsv() {
    if (!trReport) { return; }
    var lines = ['date,from_account,to_account,amount_usd,legs'];
    (trReport.transfers || []).forEach(function (g) { lines.push((g.date || '') + ',"' + String(g.from_account || '?').replace(/"/g, '""') + '","' + String(g.to_account || '?').replace(/"/g, '""') + '",' + g.amount.toFixed(2) + ',' + g.legs); });
    var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'intra-company-transfers-' + trFrom + '_to_' + trTo + '.csv'; a.click();
  }
  function openPair(t) {
    setBusy(true);
    api('transfer_candidates', { bank_transaction_id: t.id }).then(function (j) {
      if (j && j.ok) { setPairPanel({ txn: j.txn, candidates: j.candidates || [] }); }
      else { toast.error((j && j.error) || 'Could not look for the other leg.'); }
    }).finally(function () { setBusy(false); });
  }
  function doPair(a, b) {
    setBusy(true);
    api('pair_transfer', { a: a, b: b }).then(function (j) {
      if (j && j.ok) { toast.success('Paired ↔ both legs are now ONE transfer — excluded from spending.'); setPairPanel(null); loadExpenses(filter); }
      else { toast.error((j && j.error) || 'Could not pair.'); }
    }).finally(function () { setBusy(false); });
  }
  function unpair(t) {
    setBusy(true);
    api('unpair_transfer', { transfer_group_id: t.transfer_group_id }).then(function (j) {
      if (j && j.ok) { toast.success('Unpaired.'); loadExpenses(filter); }
      else { toast.error((j && j.error) || 'Could not unpair.'); }
    }).finally(function () { setBusy(false); });
  }
  function verify(t, want) {
    setBusy(true);
    api('verify', { bank_transaction_id: t.id, verified: want }).then(function (j) {
      if (j && j.ok) { toast.success(want ? 'Verified ✓' : 'Verification removed.'); loadExpenses(filter); }
      else { toast.error((j && j.error) || 'Could not verify.'); }
    }).finally(function () { setBusy(false); });
  }

  function loadWaveAccts() {
    if (waveAccts) { setShowWave(!showWave); return; }
    setBusy(true);
    fetch('/api/wave/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wave_business_id: US_WAVE_BUSINESS_ID, user_id: userProfile && userProfile.id }) })
      .then(function (r) { return r.json(); }).then(function (j) {
        if (j && j.ok) { setWaveAccts(j.categories || []); setShowWave(true); }
        else { toast.error((j && j.error) || 'Could not load the Wave account list.'); }
      }).finally(function () { setBusy(false); });
  }
  function linkWave(c, waveId) {
    var wa = null; (waveAccts || []).forEach(function (w) { if (w.wave_account_id === waveId) { wa = w; } });
    setBusy(true);
    api('save_category', { id: c.id, label: c.label, wave_account_id: waveId || null, wave_account_name: wa ? wa.wave_account_name : null })
      .then(function (j) {
        if (j && j.ok) { toast.success(waveId ? 'Linked — picking this category now also sets the Wave category.' : 'Wave link removed.'); loadAll(); }
        else { toast.error((j && j.error) || 'Could not save the Wave link.'); }
      }).finally(function () { setBusy(false); });
  }
  var activeCats = cats.filter(function (c) { return c.active !== false; });
  var labelOf = {}; cats.forEach(function (c) { labelOf[c.key] = c.label; });

  return <div className="flex flex-col gap-3">
    {needsSql && <div className="rounded-xl p-3 text-xs font-semibold" style={{ background: '#ffedd5', color: '#431407', border: '1px solid #fdba74' }}>
      ⚠ One SQL to run first: paste <b>sql/v55-83-PI-expense-categories-rules.sql</b> into the Supabase SQL Editor. ({needsSql})</div>}

    {/* ① Categories */}
    <div className="rounded-xl p-3" style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}>
      <div className="text-sm font-extrabold mb-2" style={{ color: '#0f172a' }}>🏷 Your expense categories</div>
      <div className="flex gap-1.5 flex-wrap items-center">
        {cats.map(function (c) {
          var on = c.active !== false;
          return <button key={c.id} onClick={function () { toggleCat(c); }} disabled={busy} title={on ? 'Click to hide from dropdowns' : 'Click to re-activate'}
            className="px-2.5 py-1 rounded-full text-[11px] font-bold"
            style={on ? { background: '#d1fae5', color: '#065f46', border: '1px solid #a7f3d0' } : { background: '#f1f5f9', color: '#94a3b8', border: '1px dashed #cbd5e1', textDecoration: 'line-through' }}>
            {c.label}</button>;
        })}
        <input value={newCat} onChange={function (e) { setNewCat(e.target.value); }} placeholder="new category…"
          className="px-2 py-1 rounded-lg border border-slate-300 text-[11px]" style={{ color: '#0f172a', background: '#ffffff', width: 140 }} />
        <button onClick={addCategory} disabled={busy || !newCat.trim()} className="px-2.5 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#047857', color: '#ffffff', opacity: (busy || !newCat.trim()) ? 0.5 : 1 }}>+ add</button>
      </div>
      <div className="text-[10px] mt-1.5" style={{ color: '#64748b' }}>Categories show in every expense dropdown (Books home, Bank Review, here). Deactivating hides a category from pickers — nothing already categorized changes.</div>
      {/* v55.83-PQ (Max): one click → hub + ClickBooks + Wave */}
      <div className="mt-2">
        <button onClick={loadWaveAccts} disabled={busy} className="px-2.5 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#0e7490', color: '#ffffff', opacity: busy ? 0.5 : 1 }}>
          🌊 {showWave ? 'Hide' : 'Link categories to'} Wave accounts</button>
        {showWave && waveAccts && <div className="mt-2 rounded-lg p-2" style={{ background: '#f0f9ff', border: '1px solid #bae6fd' }}>
          <div className="text-[10px] font-bold mb-1" style={{ color: '#155e75' }}>Optional: give a category its Wave account — then ONE category pick books the expense in the hub, ClickBooks (via your approved map) AND Wave. A transaction that already has a Wave category is never overwritten.</div>
          <div className="grid sm:grid-cols-2 gap-1.5">
            {activeCats.map(function (c) {
              return <div key={c.id} className="flex gap-1.5 items-center">
                <span className="text-[11px] font-bold" style={{ color: '#0f172a', minWidth: 130 }}>{c.label}</span>
                <select value={c.wave_account_id || ''} onChange={function (e) { linkWave(c, e.target.value); }} disabled={busy}
                  className="px-1.5 py-0.5 rounded border border-slate-300 text-[10px] flex-1" style={{ color: '#0f172a', background: '#ffffff' }}>
                  <option value="">— no Wave link —</option>
                  {waveAccts.map(function (w) { return <option key={w.wave_account_id} value={w.wave_account_id}>{w.wave_account_name}{w.type ? ' · ' + w.type : ''}</option>; })}
                </select></div>;
            })}
          </div>
        </div>}
      </div>
    </div>

    {/* ② Rules */}
    <div className="rounded-xl p-3" style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}>
      <div className="flex gap-2 items-center flex-wrap mb-2">
        <div className="text-sm font-extrabold" style={{ color: '#0f172a' }}>🤖 Rules — "contains X → category Y"</div>
        <div className="flex-1" />
        <button onClick={applyNow} disabled={busy} className="px-3 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#1d4ed8', color: '#ffffff', opacity: busy ? 0.5 : 1 }}>▶ Apply rules now</button>
      </div>
      <div className="flex gap-1.5 flex-wrap items-center mb-2">
        <input value={nr.match_text} onChange={function (e) { setNr(Object.assign({}, nr, { match_text: e.target.value })); }} placeholder="bank line contains… (e.g. shell oil)"
          className="px-2 py-1 rounded-lg border border-slate-300 text-[11px]" style={{ color: '#0f172a', background: '#ffffff', width: 220 }} />
        <span className="text-[11px] font-bold" style={{ color: '#64748b' }}>→</span>
        <select value={nr.classification} onChange={function (e) { setNr(Object.assign({}, nr, { classification: e.target.value })); }}
          className="px-2 py-1 rounded-lg border border-slate-300 text-[11px]" style={{ color: '#0f172a', background: '#ffffff' }}>
          <option value="">category…</option>
          {activeCats.map(function (c) { return <option key={c.key} value={c.key}>{c.label}</option>; })}
        </select>
        <button onClick={addRule} disabled={busy || nr.match_text.trim().length < 3 || !nr.classification} className="px-2.5 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#047857', color: '#ffffff', opacity: (busy || nr.match_text.trim().length < 3 || !nr.classification) ? 0.5 : 1 }}>+ new rule</button>
      </div>
      {rules.length === 0 ? <div className="text-[11px]" style={{ color: '#64748b' }}>No rules yet — they appear here automatically the first time you categorize an expense, or add one above.</div> :
        <div className="overflow-x-auto"><table className="w-full text-xs">
          <thead><tr style={{ borderBottom: '1px solid #cbd5e1', color: '#475569' }}>
            <th className="py-1.5 pr-2 text-left font-semibold">When the line contains</th><th className="py-1.5 pr-2 text-left font-semibold">Category</th>
            <th className="py-1.5 pr-2 text-left font-semibold">From</th><th className="py-1.5 pr-2 text-right font-semibold">Hits</th><th className="py-1.5 text-left font-semibold">&nbsp;</th></tr></thead>
          <tbody style={{ color: '#0f172a' }}>
            {rules.map(function (r) {
              var on = r.active !== false;
              return <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9', opacity: on ? 1 : 0.45 }}>
                <td className="py-1.5 pr-2 font-semibold">"{r.match_text}"</td>
                <td className="py-1.5 pr-2">{labelOf[r.classification] || r.classification}</td>
                <td className="py-1.5 pr-2"><span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold" style={r.source === 'learned' ? { background: '#e0e7ff', color: '#312e81' } : { background: '#f1f5f9', color: '#334155' }}>{r.source === 'learned' ? '🧠 learned' : '✍ manual'}</span></td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{r.hit_count || 0}</td>
                <td className="py-1.5"><button onClick={function () { ruleActive(r, !on); }} disabled={busy} className="px-2 py-0.5 rounded text-[10px] font-bold" style={on ? { background: '#fee2e2', color: '#7f1d1d' } : { background: '#d1fae5', color: '#065f46' }}>{on ? 'turn off' : 'turn on'}</button></td></tr>;
            })}
          </tbody>
        </table></div>}
      <div className="text-[10px] mt-1.5" style={{ color: '#64748b' }}>🧠 learned rules are written automatically every time a human categorizes an expense — changing your pick on the same merchant updates the rule. Rules only ever fill in UNCATEGORIZED expenses (they never overwrite a human) and run on their own every 15 minutes.</div>
    </div>

    {/* ②½ Intra-company transfers (v55.83-PR, Max: "read through accounts and
        give suggestions to transfers... link them in the proper accounting
        terminology... sorting filtering and report building") */}
    <div className="rounded-xl p-3" style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}>
      <div className="flex gap-2 items-center flex-wrap mb-1">
        <div className="text-sm font-extrabold" style={{ color: '#0f172a' }}>↔ Intra-company transfers</div>
        <button onClick={scanTransfers} disabled={busy} className="px-3 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#1d4ed8', color: '#ffffff', opacity: busy ? 0.5 : 1 }}>🔎 Scan accounts for transfer pairs</button>
        <div className="flex-1" />
        <input type="date" value={trFrom} onChange={function (e) { setTrFrom(e.target.value); }} className="px-2 py-1 rounded-lg border border-slate-300 text-[10px]" style={{ color: '#0f172a', background: '#ffffff' }} />
        <span className="text-[10px]" style={{ color: '#64748b' }}>→</span>
        <input type="date" value={trTo} onChange={function (e) { setTrTo(e.target.value); }} className="px-2 py-1 rounded-lg border border-slate-300 text-[10px]" style={{ color: '#0f172a', background: '#ffffff' }} />
        <button onClick={loadTransfersReport} disabled={busy} className="px-2 py-1 rounded-lg text-[10px] font-extrabold" style={{ background: '#1e293b', color: '#ffffff' }}>Register</button>
        {trReport && <button onClick={trCsv} className="px-2 py-1 rounded-lg text-[10px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>⬇ CSV</button>}
      </div>
      <div className="text-[10px] mb-2" style={{ color: '#64748b' }}>Money moved between the company's own accounts (checking ↔ savings ↔ credit cards) is an <b>intra-company transfer</b>: one movement of funds, not income and not an expense. Linking the two legs books them through the <b>Inter-account transfer clearing</b> account, which nets to zero — balances move, the P&L doesn't.</div>
      {suggestions && suggestions.length > 0 && <div className="mb-2 rounded-lg p-2" style={{ background: '#eff6ff', border: '1px solid #bfdbfe' }}>
        <div className="text-[11px] font-extrabold mb-1" style={{ color: '#1e3a8a' }}>Suggested pairs ({suggestions.length}) — same amount, opposite direction, different account, ≤7 days apart:</div>
        {suggestions.map(function (sg, i3) {
          return <div key={i3} className="flex gap-2 items-center py-1 flex-wrap" style={{ borderBottom: '1px solid #dbeafe' }}>
            <span className="text-[11px] font-extrabold tabular-nums" style={{ color: '#0f172a', minWidth: 90 }}>${fmt(sg.amount)}</span>
            <span className="text-[10px] font-semibold" style={{ color: '#7f1d1d' }}>{sg.out.date} out of {sg.out.account}</span>
            <span className="text-[10px]" style={{ color: '#64748b' }}>→</span>
            <span className="text-[10px] font-semibold" style={{ color: '#065f46' }}>{sg.inn.date} into {sg.inn.account}</span>
            {sg.days_apart > 0 && <span className="text-[9px]" style={{ color: '#64748b' }}>({sg.days_apart}d apart)</span>}
            <div className="flex-1" />
            <button onClick={function () { acceptSuggestion(sg); }} disabled={busy} className="px-2 py-0.5 rounded text-[10px] font-extrabold" style={{ background: '#1d4ed8', color: '#ffffff' }}>link as transfer ↔</button>
          </div>;
        })}
      </div>}
      {trReport && <div>
        <div className="text-[11px] font-extrabold mb-1" style={{ color: '#0f172a' }}>Transfer register {trReport.from} → {trReport.to}: {trReport.count} transfer(s), ${fmt(trReport.total)} moved between own accounts</div>
        {trReport.transfers.length > 0 && <table className="w-full text-[10px]">
          <thead><tr style={{ borderBottom: '1px solid #cbd5e1', color: '#475569' }}>
            <th className="py-1 pr-2 text-left font-semibold">Date</th><th className="py-1 pr-2 text-left font-semibold">From account</th>
            <th className="py-1 pr-2 text-left font-semibold">To account</th><th className="py-1 text-right font-semibold">Amount</th></tr></thead>
          <tbody style={{ color: '#0f172a' }}>
            {trReport.transfers.map(function (g) {
              return <tr key={g.gid} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td className="py-0.5 pr-2 whitespace-nowrap">{g.date}</td>
                <td className="py-0.5 pr-2">{g.from_account || '?'}{g.legs < 2 ? ' ⚠ one leg only' : ''}</td>
                <td className="py-0.5 pr-2">{g.to_account || '?'}</td>
                <td className="py-0.5 text-right font-extrabold tabular-nums">${fmt(g.amount)}</td></tr>;
            })}
          </tbody>
        </table>}
      </div>}
    </div>

    {/* ③ Expenses — Unverified / Verified / All */}
    <div className="rounded-xl p-3" style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}>
      <div className="flex gap-2 items-center flex-wrap mb-2">
        <div className="text-sm font-extrabold" style={{ color: '#0f172a' }}>✅ Verification</div>
        {['unverified', 'verified', 'all'].map(function (f) {
          var on = filter === f;
          return <button key={f} onClick={function () { setFilter(f); loadExpenses(f); }} className="px-2.5 py-1 rounded-lg text-[11px] font-extrabold"
            style={on ? { background: '#1e293b', color: '#ffffff' } : { background: '#f1f5f9', color: '#334155' }}>
            {f === 'unverified' ? 'To verify' : f === 'verified' ? '✓ Verified' : 'All expenses'}</button>;
        })}
        <span className="text-[10px]" style={{ color: '#64748b' }}>Verified is a human stamp on the category — it never removes the expense from any total.</span>
      </div>
      {exps.length === 0 ? <div className="text-[11px]" style={{ color: '#065f46' }}>{filter === 'unverified' ? 'Nothing waiting for verification ✓' : 'Nothing here yet.'}</div> :
        <div className="overflow-x-auto"><table className="w-full text-xs">
          <thead><tr style={{ borderBottom: '1px solid #cbd5e1', color: '#475569' }}>
            <th className="py-1.5 pr-2 text-left font-semibold">Date</th><th className="py-1.5 pr-2 text-left font-semibold">Merchant / description</th>
            <th className="py-1.5 pr-2 text-right font-semibold">Amount</th><th className="py-1.5 pr-2 text-left font-semibold">Category</th>
            <th className="py-1.5 pr-2 text-left font-semibold">How</th><th className="py-1.5 pr-2 text-left font-semibold">Verified</th><th className="py-1.5 text-left font-semibold">↔</th></tr></thead>
          <tbody style={{ color: '#0f172a' }}>
            {exps.map(function (t) {
              return <tr key={t.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td className="py-1.5 pr-2 whitespace-nowrap">{t.posted_date || t.date}</td>
                <td className="py-1.5 pr-2 font-semibold" title={t.merchant_name || t.name}>{String(t.merchant_name || t.name || '').substring(0, 44)}</td>
                <td className="py-1.5 pr-2 text-right font-extrabold tabular-nums" style={{ color: '#7f1d1d' }}>-${fmt(t.amount_abs)}</td>
                <td className="py-1.5 pr-2">
                  <select value={catDraft[t.id] || t.classification || ''} onChange={function (e) { var d = {}; d[t.id] = e.target.value; setCatDraft(Object.assign({}, catDraft, d)); recategorize(t, e.target.value); }}
                    className="px-1 py-0.5 rounded border border-slate-300 text-[10px]" style={{ color: '#0f172a', background: '#ffffff' }}>
                    <option value="">category…</option>
                    {activeCats.map(function (c) { return <option key={c.key} value={c.key}>{c.label}</option>; })}
                  </select></td>
                <td className="py-1.5 pr-2"><span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold" style={t.category_source === 'rule' ? { background: '#e0e7ff', color: '#312e81' } : { background: '#f1f5f9', color: '#334155' }}>{t.category_source === 'rule' ? '🤖 rule' : t.classification ? '👤 human' : '—'}</span></td>
                <td className="py-1.5">
                  {t.category_verified === true
                    ? <span className="inline-flex items-center gap-1"><span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold" style={{ background: '#d1fae5', color: '#065f46' }}>✓ verified</span>
                      <button onClick={function () { verify(t, false); }} disabled={busy} className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background: '#f1f5f9', color: '#64748b' }}>undo</button></span>
                    : <button onClick={function () { verify(t, true); }} disabled={busy || !t.classification} title={t.classification ? 'Confirm this category' : 'Pick a category first'}
                      className="px-2 py-0.5 rounded text-[10px] font-extrabold" style={{ background: '#047857', color: '#ffffff', opacity: (busy || !t.classification) ? 0.5 : 1 }}>✓ verify</button>}
                </td>
                <td className="py-1.5">
                  {t.transfer_group_id
                    ? <span className="inline-flex items-center gap-1"><span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold" style={{ background: '#dbeafe', color: '#1e40af' }}>↔ paired</span>
                      <button onClick={function () { unpair(t); }} disabled={busy} className="px-1 py-0.5 rounded text-[9px] font-bold" style={{ background: '#f1f5f9', color: '#64748b' }}>undo</button></span>
                    : <button onClick={function () { openPair(t); }} disabled={busy} title="This is a transfer between our own accounts (incl. credit cards) — find its other leg"
                      className="px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe' }}>↔ pair</button>}
                </td></tr>;
            })}
          </tbody>
        </table></div>}
      {pairPanel && <div className="mt-2 rounded-lg p-2" style={{ background: '#eff6ff', border: '1px solid #bfdbfe' }}>
        <div className="flex gap-2 items-center mb-1">
          <div className="text-[11px] font-extrabold" style={{ color: '#1e3a8a' }}>
            ↔ Pair the transfer: {String(pairPanel.txn.merchant_name || pairPanel.txn.name || '').substring(0, 40)} · ${fmt(pairPanel.txn.amount_abs)} on {pairPanel.txn.posted_date || pairPanel.txn.date} — pick its other leg (same amount, opposite direction, different account, ±7 days):</div>
          <div className="flex-1" />
          <button onClick={function () { setPairPanel(null); }} className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#e2e8f0', color: '#334155' }}>✕</button>
        </div>
        {pairPanel.candidates.length === 0 ? <div className="text-[10px]" style={{ color: '#1e3a8a' }}>No matching opposite leg found (same amount within ±7 days on another account). If the other account isn't connected yet, connect it in the Bank tab first.</div> :
          pairPanel.candidates.map(function (c2) {
            return <div key={c2.id} className="flex gap-2 items-center py-0.5" style={{ borderBottom: '1px solid #dbeafe' }}>
              <span className="text-[10px] font-semibold flex-1" style={{ color: '#0f172a' }}>{c2.posted_date || c2.date} · {String(c2.merchant_name || c2.name || '').substring(0, 50)} · ${fmt(c2.amount_abs)} ({c2.direction === 'in' ? 'money in' : 'money out'})</span>
              <button onClick={function () { doPair(pairPanel.txn.id, c2.id); }} disabled={busy} className="px-2 py-0.5 rounded text-[10px] font-extrabold" style={{ background: '#1d4ed8', color: '#ffffff' }}>pair these ↔</button>
            </div>;
          })}
      </div>}
    </div>
  </div>;
}
