'use client';
// v55.83-TW — Accounting → 🟦 Nextrade and 🟪 RTM: each company's OWN books (Max, Nov 17 2026: "They're three separate
// companies per se when it comes to categorization, all that stuff"). Own bank + credit-card accounts, own categories,
// own rules, own totals and export. Nothing here touches KTC's lists. For Nextrade, a money-out line categorized as an
// expense makes a KTC bill at once (shown in KTC Bills → 🟦 Nextrade bills); payroll does not.
// Inline colours on white panels (the dark theme repaints bg-white).
import React, { useState, useEffect } from 'react';
import { hubFetch } from '../lib/hub-fetch';
import { companyByKey } from '../lib/companies';
import StatementImport from './StatementImport';

function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
var panel = { background: '#ffffff', color: '#0f172a', border: '1px solid #e2e8f0' };
var inp = 'px-2 py-1 rounded border text-[11px] nt-light'; // v55.83-UA — nt-light: dark text on white even under the dark theme (globals.css)
var inpS = { background: '#ffffff', color: '#0f172a', borderColor: '#cbd5e1' };
function btn(bg, fg) { return { background: bg, color: fg }; }
var KTC_BILL_WORDS = { created: '🧾 KTC bill made', attached: '🔗 attached to a KTC bill' };

export default function CompanyBooksTab(props) {
  var comp = companyByKey(props.company);
  var userProfile = props.userProfile; var canManage = props.canManage === true;
  var toast = props.toast || { success: function () {}, error: function () {} };
  var s1 = useState('lines'); var view = s1[0]; var setView = s1[1];
  var s2 = useState(null); var lines = s2[0]; var setLines = s2[1];
  var s3 = useState([]); var cats = s3[0]; var setCats = s3[1];
  var s4 = useState(false); var busy = s4[0]; var setBusy = s4[1];
  var s5 = useState(''); var err = s5[0]; var setErr = s5[1];
  var t0 = new Date(); var f0 = new Date(t0.getFullYear(), t0.getMonth() - 2, 1);
  var s6 = useState(iso(f0)); var from = s6[0]; var setFrom = s6[1];
  var s7 = useState(iso(t0)); var to = s7[0]; var setTo = s7[1];
  var s8 = useState('uncat'); var show = s8[0]; var setShow = s8[1];
  var s9 = useState(''); var q = s9[0]; var setQ = s9[1];
  var s10 = useState({}); var sel = s10[0]; var setSel = s10[1];
  var s11 = useState(''); var bulkCat = s11[0]; var setBulkCat = s11[1];
  var s12 = useState(null); var rules = s12[0]; var setRules = s12[1];
  var s13 = useState(null); var totals = s13[0]; var setTotals = s13[1];
  var s14 = useState(null); var accounts = s14[0]; var setAccounts = s14[1];
  var s15 = useState(null); var mapping = s15[0]; var setMapping = s15[1];
  var s16 = useState(null); var catForm = s16[0]; var setCatForm = s16[1];
  var s17 = useState(null); var ruleForm = s17[0]; var setRuleForm = s17[1];
  var s18 = useState(''); var sqlMissing = s18[0]; var setSqlMissing = s18[1];
  var s19 = useState({}); var kinds = s19[0]; var setKinds = s19[1];

  function api(payload) {
    return hubFetch('/api/accounting/company-books', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ user_id: userProfile && userProfile.id, company: comp.key }, payload)) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'The server did not answer properly (HTTP ' + r.status + ').' }; }); })
      .catch(function (e) { return { ok: false, error: 'Could not reach the server (' + ((e && e.message) || 'network') + ').' }; });
  }
  function loadCats() { return api({ action: 'categories' }).then(function (j) { if (j && j.ok) { setCats(j.categories || []); setKinds(j.kinds || {}); if (j.sql_missing) { setSqlMissing(j.sql_missing); } } }); }
  function loadLines() {
    setBusy(true);
    return api({ action: 'lines', from: from, to: to }).then(function (j) {
      if (j && j.ok) { setLines(j.lines || []); setCats(j.categories || cats); setErr(''); setSqlMissing(j.sql_missing || ''); setSel({}); }
      else { setErr((j && j.error) || 'Could not load the lines.'); }
    }).finally(function () { setBusy(false); });
  }
  function loadView(v) {
    setView(v);
    if (v === 'lines') { loadLines(); }
    if (v === 'rules') { loadCats(); api({ action: 'rules' }).then(function (j) { if (j && j.ok) { setRules(j.rules || []); } else { setErr((j && j.error) || ''); } }); }
    if (v === 'categories') { loadCats(); }
    if (v === 'totals') { setBusy(true); api({ action: 'totals', from: from, to: to }).then(function (j) { if (j && j.ok) { setTotals(j.totals); } else { setErr((j && j.error) || ''); } }).finally(function () { setBusy(false); }); }
    if (v === 'accounts') { api({ action: 'accounts' }).then(function (j) { if (j && j.ok) { setAccounts(j.accounts || []); } else { setErr((j && j.error) || ''); } }); }
    if (v === 'mapping') { api({ action: 'mapping' }).then(function (j) { if (j && j.ok) { setMapping(j); } else { setErr((j && j.error) || ''); } }); }
  }
  useEffect(function () { if (comp) { loadCats(); loadLines(); } }, [props.company]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!comp) { return <div className="p-3 text-[12px]">Unknown company.</div>; }

  function setCategory(ids, key) {
    if (!ids.length) { return; }
    setBusy(true);
    api({ action: 'set_category', ids: ids, category_key: key || null }).then(function (j) {
      var made = ((j && j.results) || []).filter(function (r) { return r.ktc && r.ktc.action && r.ktc.action !== 'none'; });
      if (j && j.ok) { toast.success('Saved ' + j.saved + ' line(s)' + (made.length ? ' · KTC bills: ' + made.map(function (r) { return r.ktc.action + (r.ktc.bill_number ? ' ' + r.ktc.bill_number : ''); }).join(', ') : '')); }
      else { toast.error((j && j.error) || 'Not saved.'); }
      loadLines();
    }).finally(function () { setBusy(false); });
  }
  function exportCsv(rowsOut, name) {
    var csv = rowsOut.map(function (r) { return r.map(function (c) { var s = String(c == null ? '' : c); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(','); }).join('\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = name; a.click();
  }
  var catByKey = {}; cats.forEach(function (c) { catByKey[c.key] = c; });
  var activeCats = cats.filter(function (c) { return c.active; });
  var shown = (lines || []).filter(function (l) {
    if (show === 'uncat' && l.company_category) { return false; }
    if (show !== 'uncat' && show !== 'all' && l.company_category !== show) { return false; }
    if (q && (String(l.name || '') + ' ' + String(l.merchant_name || '') + ' ' + l.amount_abs).toLowerCase().indexOf(q.toLowerCase()) < 0) { return false; }
    return true;
  });
  var selIds = Object.keys(sel).filter(function (k) { return sel[k]; });
  var tabs = [['lines', '📋 Transactions'], ['totals', '📊 Totals'], ['categories', '🏷 Categories'], ['rules', '📏 Rules'], ['accounts', '🏦 Accounts & cards']];
  if (comp.key === 'nextrade') { tabs.push(['mapping', '🔁 Category mapping → KTC']); }

  return <div className="rounded-xl p-3" style={panel}>
    <div className="flex items-center gap-2 flex-wrap mb-2">
      <div className="text-[14px] font-extrabold">{comp.icon} {comp.label} — own books</div>
      <div className="text-[10px]" style={{ color: '#64748b' }}>{comp.key === 'nextrade' ? 'Separate from KTC. A money-out line marked as an expense makes a KTC bill (owed to Nextrade) at once; payroll does not.' : 'Separate from KTC. Categorize RTM’s own lines here; RTM payments and wires in KTC work as before.'}</div>
    </div>
    {sqlMissing && <div className="text-[11px] p-2 rounded mb-2" style={{ background: '#fef2f2', color: '#991b1b' }}>{sqlMissing}</div>}
    {err && <div className="text-[11px] p-2 rounded mb-2" style={{ background: '#fef2f2', color: '#991b1b' }}>{err}</div>}
    <div className="flex gap-1 flex-wrap mb-3">{tabs.map(function (t) { return <button key={t[0]} onClick={function () { setErr(''); loadView(t[0]); }} className="px-2.5 py-1 rounded-lg text-[11px] font-extrabold" style={view === t[0] ? btn('#0f172a', '#ffffff') : btn('#f1f5f9', '#334155')}>{t[1]}</button>; })}</div>

    {(view === 'lines' || view === 'totals') && <div className="flex gap-2 items-center flex-wrap mb-2">
      <span className="text-[10px] font-bold">From</span><input type="date" className={inp} style={inpS} value={from} onChange={function (e) { setFrom(e.target.value); }} />
      <span className="text-[10px] font-bold">to</span><input type="date" className={inp} style={inpS} value={to} onChange={function (e) { setTo(e.target.value); }} />
      <button onClick={function () { loadView(view); }} disabled={busy} className="px-2 py-1 rounded text-[10px] font-bold" style={btn('#e0f2fe', '#075985')}>{busy ? 'Loading…' : '↻ Show'}</button>
    </div>}

    {view === 'lines' && <div>
      <div className="flex gap-2 items-center flex-wrap mb-2">
        <select className={inp} style={inpS} value={show} onChange={function (e) { setShow(e.target.value); }}>
          <option value="uncat">Not categorized yet</option><option value="all">All lines</option>{cats.map(function (c) { return <option key={c.key} value={c.key}>{c.label}</option>; })}</select>
        <input className={inp} style={inpS} placeholder="Find (description or amount)" value={q} onChange={function (e) { setQ(e.target.value); }} />
        {canManage && <button onClick={function () { setBusy(true); api({ action: 'apply_rules', from: from, to: to }).then(function (j) { if (j && j.ok) { toast.success(j.categorized + ' line(s) categorized by the rules' + (j.problems && j.problems.length ? ' · ' + j.problems.length + ' not: ' + j.problems[0] : '')); } else { toast.error((j && j.error) || 'Not done.'); } loadLines(); }).finally(function () { setBusy(false); }); }} disabled={busy} className="px-2 py-1 rounded text-[10px] font-bold" style={btn('#ede9fe', '#5b21b6')}>📏 Apply rules to uncategorized</button>}
        <button onClick={function () { exportCsv([['date', 'account', 'description', 'in/out', 'amount', 'category', 'KTC bill']].concat(shown.map(function (l) { return [l.date, l.account_label, l.name, l.direction, l.amount_abs, l.company_category ? (catByKey[l.company_category] || {}).label || l.company_category : '', l.ktc_bill ? l.ktc_bill.mode : '']; })), comp.key + '-transactions-' + from + '-to-' + to + '.csv'); }} className="px-2 py-1 rounded text-[10px] font-bold" style={btn('#f0fdf4', '#166534')}>⬇ Export CSV</button>
        <span className="text-[10px]" style={{ color: '#64748b' }}>{shown.length} line(s)</span>
      </div>
      {canManage && selIds.length > 0 && <div className="flex gap-2 items-center mb-2 p-2 rounded" style={{ background: '#f8fafc', border: '1px solid #cbd5e1' }}>
        <span className="text-[11px] font-bold">{selIds.length} selected →</span>
        <select className={inp} style={inpS} value={bulkCat} onChange={function (e) { setBulkCat(e.target.value); }}><option value="">pick a category…</option>{activeCats.map(function (c) { return <option key={c.key} value={c.key}>{c.label}</option>; })}<option value="__clear">— take the category off —</option></select>
        <button disabled={busy || !bulkCat} onClick={function () { setCategory(selIds, bulkCat === '__clear' ? null : bulkCat); setBulkCat(''); }} className="px-2 py-1 rounded text-[10px] font-extrabold" style={btn('#0f172a', '#ffffff')}>Save</button>
      </div>}
      <div style={{ overflowX: 'auto' }}>
        <table className="w-full text-[13px]" style={{ color: '#0f172a' }}><thead><tr style={{ background: '#e2e8f0', color: '#1e293b' }}>
          <th className="p-1">{canManage && <input type="checkbox" checked={shown.length > 0 && shown.every(function (l) { return sel[l.id]; })} onChange={function (e) { var n = {}; if (e.target.checked) { shown.forEach(function (l) { n[l.id] = true; }); } setSel(n); }} />}</th>
          <th className="p-1 text-left">Date</th><th className="p-1 text-left">Account</th><th className="p-1 text-left">Description</th><th className="p-1 text-right">Amount</th><th className="p-1 text-left">Category</th>{comp.key === 'nextrade' && <th className="p-1 text-left">KTC bill</th>}</tr></thead>
          <tbody>{shown.map(function (l) {
            return <tr key={l.id} style={{ borderTop: '1px solid #e2e8f0' }}>
              <td className="p-1">{canManage && <input type="checkbox" checked={!!sel[l.id]} onChange={function (e) { var n = Object.assign({}, sel); n[l.id] = e.target.checked; setSel(n); }} />}</td>
              <td className="p-1 whitespace-nowrap">{l.date}{l.pending ? ' ⏳' : ''}</td>
              <td className="p-1 whitespace-nowrap">{l.is_card ? '💳 ' : '🏦 '}{l.account_label}</td>
              <td className="p-1">{l.name}</td>
              <td className="p-1 text-right whitespace-nowrap font-bold" style={{ color: l.direction === 'in' ? '#166534' : '#991b1b' }}>{l.direction === 'in' ? '+' : '−'}{fmt(l.amount_abs)}</td>
              <td className="p-1">{canManage
                ? <select className={inp} style={inpS} value={l.company_category || ''} disabled={busy} onChange={function (e) { setCategory([l.id], e.target.value || null); }}><option value="">— not categorized —</option>{cats.filter(function (c) { return c.active || c.key === l.company_category; }).map(function (c) { return <option key={c.key} value={c.key}>{c.label}</option>; })}</select>
                : ((catByKey[l.company_category] || {}).label || '—')}{l.company_category_source === 'rule' ? <span className="ml-1 text-[9px]" style={{ color: '#6d28d9' }}>📏 rule</span> : null}</td>
              {comp.key === 'nextrade' && <td className="p-1 text-[10px]">{l.ktc_bill ? KTC_BILL_WORDS[l.ktc_bill.mode] || '' : ''}</td>}
            </tr>;
          })}</tbody></table>
      </div>
      {lines && !shown.length && <div className="text-[11px] mt-2" style={{ color: '#64748b' }}>Nothing to show for these dates and filters.</div>}
    </div>}

    {view === 'totals' && totals && <div>
      <div className="flex gap-3 flex-wrap mb-2 text-[11px]">
        <span>Money in: <b style={{ color: '#166534' }}>{fmt(totals.inTotal)}</b></span><span>Money out: <b style={{ color: '#991b1b' }}>{fmt(totals.outTotal)}</b></span>
        <span>Transfers in: <b>{fmt(totals.transfersIn)}</b></span><span>Transfers out: <b>{fmt(totals.transfersOut)}</b></span>
        <button onClick={function () { exportCsv([['category', 'kind'].concat(totals.months).concat(['total'])].concat(totals.rows.map(function (r) { return [r.label, r.kind].concat(totals.months.map(function (m) { return r.byMonth[m] || 0; })).concat([r.total]); })), comp.key + '-totals-' + from + '-to-' + to + '.csv'); }} className="px-2 py-0.5 rounded text-[10px] font-bold" style={btn('#f0fdf4', '#166534')}>⬇ Export CSV</button>
      </div>
      <div className="text-[10px] mb-1" style={{ color: '#64748b' }}>Transfers (own money moving, money from KTC, card payments) are listed but never counted as income or spending.</div>
      <div style={{ overflowX: 'auto' }}><table className="text-[13px]" style={{ color: '#0f172a' }}><thead><tr style={{ background: '#e2e8f0', color: '#1e293b' }}><th className="p-1 text-left">Category</th>{totals.months.map(function (m) { return <th key={m} className="p-1 text-right">{m}</th>; })}<th className="p-1 text-right">Total</th></tr></thead>
        <tbody>{totals.rows.map(function (r) { return <tr key={r.key} style={{ borderTop: '1px solid #e2e8f0', color: r.kind === 'transfer' ? '#64748b' : '#0f172a' }}><td className="p-1">{r.label}{r.kind === 'transfer' ? ' ↔' : ''}</td>{totals.months.map(function (m) { return <td key={m} className="p-1 text-right whitespace-nowrap">{r.byMonth[m] ? fmt(r.byMonth[m]) : ''}</td>; })}<td className="p-1 text-right font-bold whitespace-nowrap">{fmt(r.total)}</td></tr>; })}</tbody></table></div>
    </div>}

    {view === 'categories' && <div>
      {canManage && !catForm && <button onClick={function () { setCatForm({ label: '', kind: 'expense', is_payroll: false, sort: 100 }); }} className="px-2 py-1 rounded text-[11px] font-extrabold mb-2" style={btn('#0f172a', '#ffffff')}>➕ New category</button>}
      {catForm && <div className="flex gap-2 items-center flex-wrap mb-2 p-2 rounded" style={{ background: '#f8fafc', border: '1px solid #cbd5e1' }}>
        <input className={inp} style={inpS} placeholder="Name (e.g. Electricity)" value={catForm.label} onChange={function (e) { setCatForm(Object.assign({}, catForm, { label: e.target.value })); }} />
        <select className={inp} style={inpS} value={catForm.kind} onChange={function (e) { setCatForm(Object.assign({}, catForm, { kind: e.target.value })); }}>{Object.keys(kinds).map(function (k) { return <option key={k} value={k}>{kinds[k]}</option>; })}</select>
        {catForm.kind === 'expense' && <label className="text-[10px] font-bold"><input type="checkbox" checked={catForm.is_payroll === true} onChange={function (e) { setCatForm(Object.assign({}, catForm, { is_payroll: e.target.checked })); }} /> payroll (no KTC bill, shown as "Warehouse staff")</label>}
        <button disabled={busy} onClick={function () { setBusy(true); api({ action: 'save_category', category: catForm }).then(function (j) { if (j && j.ok) { toast.success('Saved' + (j.note ? ' — ' + j.note : '')); setCatForm(null); loadCats(); } else { toast.error((j && j.error) || 'Not saved.'); } }).finally(function () { setBusy(false); }); }} className="px-2 py-1 rounded text-[10px] font-extrabold" style={btn('#0f172a', '#ffffff')}>💾 Save</button>
        <button onClick={function () { setCatForm(null); }} className="px-2 py-1 rounded text-[10px] font-bold" style={btn('#f1f5f9', '#334155')}>Cancel</button>
      </div>}
      {cats.map(function (c) { return <div key={c.key} className="flex items-center gap-2 text-[11px] py-1" style={{ borderTop: '1px solid #e2e8f0', opacity: c.active ? 1 : 0.5 }}>
        <span className="font-bold">{c.label}</span><span style={{ color: '#64748b' }}>{kinds[c.kind] || c.kind}{c.is_payroll ? ' · payroll' : ''}{c.active ? '' : ' · switched off'}</span><div className="flex-1" />
        {canManage && <button onClick={function () { setCatForm({ id: c.id, label: c.label, kind: c.kind, is_payroll: c.is_payroll, sort: c.sort }); }} className="px-2 py-0.5 rounded text-[10px] font-bold" style={btn('#eff6ff', '#1d4ed8')}>✏ Edit</button>}
        {canManage && <button onClick={function () { api({ action: 'category_active', id: c.id, active: !c.active }).then(function (j) { if (j && j.ok) { loadCats(); } else { toast.error((j && j.error) || 'Not saved.'); } }); }} className="px-2 py-0.5 rounded text-[10px] font-bold" style={btn('#f1f5f9', '#334155')}>{c.active ? 'Switch off' : 'Switch on'}</button>}
      </div>; })}
    </div>}

    {view === 'rules' && <div>
      {canManage && !ruleForm && <button onClick={function () { setRuleForm({ match_text: '', category_key: '', direction: 'any' }); }} className="px-2 py-1 rounded text-[11px] font-extrabold mb-2" style={btn('#0f172a', '#ffffff')}>➕ New rule</button>}
      {ruleForm && <div className="flex gap-2 items-center flex-wrap mb-2 p-2 rounded" style={{ background: '#f8fafc', border: '1px solid #cbd5e1' }}>
        <span className="text-[10px] font-bold">When the description contains</span><input className={inp} style={inpS} value={ruleForm.match_text} onChange={function (e) { setRuleForm(Object.assign({}, ruleForm, { match_text: e.target.value })); }} placeholder="e.g. centerpoint" />
        <select className={inp} style={inpS} value={ruleForm.direction} onChange={function (e) { setRuleForm(Object.assign({}, ruleForm, { direction: e.target.value })); }}><option value="any">money in or out</option><option value="out">money out only</option><option value="in">money in only</option></select>
        <span className="text-[10px] font-bold">→</span><select className={inp} style={inpS} value={ruleForm.category_key} onChange={function (e) { setRuleForm(Object.assign({}, ruleForm, { category_key: e.target.value })); }}><option value="">pick a category…</option>{activeCats.map(function (c) { return <option key={c.key} value={c.key}>{c.label}</option>; })}</select>
        <button disabled={busy} onClick={function () { setBusy(true); api({ action: 'save_rule', rule: ruleForm }).then(function (j) { if (j && j.ok) { toast.success('Rule saved — press "Apply rules" on Transactions to use it'); setRuleForm(null); loadView('rules'); } else { toast.error((j && j.error) || 'Not saved.'); } }).finally(function () { setBusy(false); }); }} className="px-2 py-1 rounded text-[10px] font-extrabold" style={btn('#0f172a', '#ffffff')}>💾 Save</button>
        <button onClick={function () { setRuleForm(null); }} className="px-2 py-1 rounded text-[10px] font-bold" style={btn('#f1f5f9', '#334155')}>Cancel</button>
      </div>}
      {(rules || []).map(function (r) { return <div key={r.id} className="flex items-center gap-2 text-[11px] py-1" style={{ borderTop: '1px solid #e2e8f0', opacity: r.active ? 1 : 0.5 }}>
        <span>"{r.match_text}"{r.direction !== 'any' ? ' (money ' + r.direction + ')' : ''} → <b>{(catByKey[r.category_key] || {}).label || r.category_key}</b></span><span style={{ color: '#64748b' }}>used {r.hit_count || 0}×</span><div className="flex-1" />
        {canManage && <button onClick={function () { setRuleForm({ id: r.id, match_text: r.match_text, category_key: r.category_key, direction: r.direction }); }} className="px-2 py-0.5 rounded text-[10px] font-bold" style={btn('#eff6ff', '#1d4ed8')}>✏ Edit</button>}
        {canManage && <button onClick={function () { api({ action: 'rule_active', id: r.id, active: !r.active }).then(function (j) { if (j && j.ok) { loadView('rules'); } else { toast.error((j && j.error) || 'Not saved.'); } }); }} className="px-2 py-0.5 rounded text-[10px] font-bold" style={btn('#f1f5f9', '#334155')}>{r.active ? 'Switch off' : 'Switch on'}</button>}
      </div>; })}
      {rules && !rules.length && <div className="text-[11px]" style={{ color: '#64748b' }}>No rules yet.</div>}
    </div>}

    {view === 'accounts' && <div>
      <div className="text-[11px] mb-2 p-2 rounded" style={{ background: '#eff6ff', color: '#1e3a8a' }}>
        <b>Connect a {comp.label} bank account or credit card (Plaid):</b> Bank (top menu) → 🔗 Connect a bank → when asked which books, pick <b>{comp.label}</b> → sign in to the bank in the Plaid window → choose the accounts and cards. They then show here and update every 2 hours.
        <br /><b>Or from a statement file:</b> below → ➕ add the account (Company = {comp.label}, Bank account or Credit card) → import its CSV.
      </div>
      {(accounts || []).map(function (a) { return <div key={a.plaid_account_id} className="text-[11px] py-1" style={{ borderTop: '1px solid #e2e8f0' }}>{a.is_card ? '💳 Credit card' : '🏦 Bank'} · <b>{a.institution || ''} {a.name}</b>{a.mask ? ' ••' + a.mask : ''}{a.connection_status === 'manual' ? ' · from statement files' : ''}</div>; })}
      {accounts && !accounts.length && <div className="text-[11px]" style={{ color: '#64748b' }}>No {comp.label} accounts yet.</div>}
      <div className="mt-3"><StatementImport userProfile={userProfile} canUse={canManage} companyId={comp.id} /></div>
    </div>}

    {view === 'mapping' && mapping && <div>
      <div className="text-[11px] mb-2" style={{ color: '#475569' }}>Set once per Nextrade expense category: which KTC category its KTC bill gets. Bills already made without a KTC category get it when you save.</div>
      {(mapping.rows || []).filter(function (c) { return ['expense', 'cogs', 'other_expense'].indexOf(c.kind) >= 0; }).map(function (c) { return <div key={c.key} className="flex items-center gap-2 text-[11px] py-1" style={{ borderTop: '1px solid #e2e8f0' }}>
        <span className="font-bold" style={{ minWidth: 200 }}>{c.label}</span>
        {c.is_payroll ? <span style={{ color: '#64748b' }}>payroll — no KTC bill (the repeating "Warehouse staff" bill covers it)</span>
          : <select className={inp} style={inpS} disabled={!canManage || busy} value={c.ktc_category || ''} onChange={function (e) { setBusy(true); api({ action: 'save_mapping', category_key: c.key, ktc_category: e.target.value || null }).then(function (j) { if (j && j.ok) { toast.success('Saved' + (j.bills_filled ? ' · ' + j.bills_filled + ' bill(s) filled in' : '')); loadView('mapping'); } else { toast.error((j && j.error) || 'Not saved.'); } }).finally(function () { setBusy(false); }); }}>
            <option value="">— KTC category not set —</option>{(mapping.ktc_categories || []).map(function (k) { return <option key={k.key} value={k.key}>{k.label}</option>; })}</select>}
      </div>; })}
    </div>}
  </div>;
}
