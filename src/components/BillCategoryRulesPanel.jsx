// v55.83-WX — Bills → "Category rules" (Max, 21 Nov 2026: "i need to be able to create rules for bills as well to place categories. even
// using a certain amount ... to always be partner fees ... and this will be used in the pnl breakdowns").
// A rule = vendor (+ exact bill total, or a range, + optional words on the bill) → category. New bills get it automatically. For bills
// already on file: Preview shows bill by bill what would change and why not; Apply changes only the ticked ones. A category a person
// picked is never changed. Nothing is deleted: a rule is switched off.
import React, { useState, useEffect } from 'react';
import { hubFetch } from '../lib/hub-fetch';

function post(body) {
  return hubFetch('/api/accounting/bill-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'The server did not answer properly (HTTP ' + r.status + ').' }; }); })
    .catch(function (e) { return { ok: false, error: 'Could not reach the server (' + ((e && e.message) || 'network') + ').' }; });
}
function money(v) { return '$' + (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function amountWords(r) {
  if (r.amount_exact !== null && r.amount_exact !== undefined) { return 'exactly ' + money(r.amount_exact); }
  if (r.amount_min !== null && r.amount_min !== undefined && r.amount_max !== null && r.amount_max !== undefined) { return money(r.amount_min) + ' to ' + money(r.amount_max); }
  if (r.amount_min !== null && r.amount_min !== undefined) { return money(r.amount_min) + ' or more'; }
  if (r.amount_max !== null && r.amount_max !== undefined) { return 'up to ' + money(r.amount_max); }
  return 'any amount';
}
var STATUS = {
  will_set: { label: 'Will change', bg: '#ecfdf5', fg: '#065f46' },
  already: { label: 'Already set by this rule', bg: '#f1f5f9', fg: '#334155' },
  protected_manual: { label: 'Kept — a person picked it', bg: '#eff6ff', fg: '#1e3a8a' },
  protected_unknown: { label: 'Kept — set before rules existed', bg: '#eff6ff', fg: '#1e3a8a' },
  other_rule_wins: { label: 'Another rule fits better', bg: '#fefce8', fg: '#713f12' },
  conflict: { label: 'Rules disagree — decide on the bill', bg: '#fef2f2', fg: '#991b1b' },
  counted_in_profit: { label: 'Kept — already in goods / transport profit', bg: '#fff7ed', fg: '#9a3412' }
};
var EMPTY = { id: null, name: '', vendor_match: '', amount_mode: 'exact', amount_exact: '', amount_min: '', amount_max: '', words: '', category: '', priority: 0 };

// props: userProfile, onClose(), onChanged() (reload the bills)
export default function BillCategoryRulesPanel(props) {
  var s1 = useState({ loading: true, rules: [], categories: [], ready: true, can_manage: false, error: '' }); var st = s1[0]; var setSt = s1[1];
  var s2 = useState(null); var form = s2[0]; var setForm = s2[1];
  var s3 = useState(null); var pv = s3[0]; var setPv = s3[1];
  var s4 = useState({}); var ticked = s4[0]; var setTicked = s4[1];
  var s5 = useState(false); var busy = s5[0]; var setBusy = s5[1];
  var s6 = useState(null); var msg = s6[0]; var setMsg = s6[1];
  function load() {
    post({ action: 'list', user_id: props.userProfile && props.userProfile.id }).then(function (j) {
      setSt(j && j.ok ? { loading: false, rules: j.rules || [], categories: j.categories || [], ready: j.ready !== false, can_manage: j.can_manage === true, error: '', sql_file: j.sql_file }
        : { loading: false, rules: [], categories: [], ready: true, can_manage: false, error: (j && j.error) || 'Could not load.' });
    });
  }
  useEffect(function () { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // v55.83-ZP — opened from a bill flagged "looks like the monthly partner fee": the new-rule form starts filled in (vendor, exact
  // amount, category). Nothing is saved or applied until the person presses Save rule, then Preview / Apply as usual.
  var pfN = props.prefill && props.prefill.n;
  useEffect(function () {
    var p0 = props.prefill; if (!p0) { return; }
    setPv(null); setMsg(null);
    setForm(Object.assign({}, EMPTY, { name: p0.name || '', vendor_match: p0.vendor_match || '', amount_mode: p0.amount_exact ? 'exact' : 'any', amount_exact: p0.amount_exact ? String(p0.amount_exact) : '', category: p0.category || '' }));
  }, [pfN]); // eslint-disable-line react-hooks/exhaustive-deps
  var catLabel = {}; st.categories.forEach(function (c) { catLabel[c.key] = c.label; });
  function edit(r) {
    setPv(null); setMsg(null);
    setForm(r ? { id: r.id, name: r.name || '', vendor_match: r.vendor_match || '', amount_mode: r.amount_exact !== null && r.amount_exact !== undefined ? 'exact' : ((r.amount_min !== null && r.amount_min !== undefined) || (r.amount_max !== null && r.amount_max !== undefined) ? 'range' : 'any'),
      amount_exact: r.amount_exact === null || r.amount_exact === undefined ? '' : String(r.amount_exact), amount_min: r.amount_min === null || r.amount_min === undefined ? '' : String(r.amount_min),
      amount_max: r.amount_max === null || r.amount_max === undefined ? '' : String(r.amount_max), words: r.words || '', category: r.category || '', priority: r.priority || 0 } : Object.assign({}, EMPTY));
  }
  function set(k, v) { setForm(Object.assign({}, form, (function () { var o = {}; o[k] = v; return o; })())); }
  function save() {
    var f = form; var rule = { id: f.id || undefined, name: f.name, vendor_match: f.vendor_match, words: f.words, category: f.category, priority: f.priority, currency: 'USD',
      amount_exact: f.amount_mode === 'exact' ? f.amount_exact : null, amount_min: f.amount_mode === 'range' ? f.amount_min : null, amount_max: f.amount_mode === 'range' ? f.amount_max : null };
    setBusy(true);
    post({ action: 'save', rule: rule, user_id: props.userProfile && props.userProfile.id }).then(function (j) {
      setBusy(false);
      if (j && j.ok) { setForm(null); setMsg({ bad: false, text: 'Rule saved. New bills that fit it get the category. Use Preview to see which bills already on file it would change.' }); load(); }
      else { setMsg({ bad: true, text: (j && j.error) || 'Not saved.' }); }
    });
  }
  function onOff(r) {
    setBusy(true);
    post({ action: 'set_active', id: r.id, active: r.active === false, user_id: props.userProfile && props.userProfile.id }).then(function (j) {
      setBusy(false); setMsg(j && j.ok ? { bad: false, text: j.note || (r.active === false ? 'Switched on.' : 'Switched off.') } : { bad: true, text: (j && j.error) || 'Not changed.' }); if (pv && pv.rule && pv.rule.id === r.id) { setPv(null); } load();
    });
  }
  function preview(r) {
    setBusy(true); setMsg(null); setForm(null);
    post({ action: 'preview', id: r.id, user_id: props.userProfile && props.userProfile.id }).then(function (j) {
      setBusy(false);
      if (!j || !j.ok) { setMsg({ bad: true, text: (j && j.error) || 'Could not preview.' }); return; }
      var t = {}; (j.rows || []).forEach(function (x) { if (x.status === 'will_set') { t[x.id] = true; } });
      setTicked(t); setPv(j);
    });
  }
  function apply() {
    var ids = Object.keys(ticked).filter(function (k) { return ticked[k]; });
    if (!ids.length) { setMsg({ bad: true, text: 'Tick the bills to change.' }); return; }
    var paidN = (pv.rows || []).filter(function (x) { return ticked[x.id] && (x.paid > 0 || x.paid_via); }).length;
    if (typeof window !== 'undefined' && !window.confirm('Set "' + (catLabel[pv.rule.category] || pv.rule.category) + '" on ' + ids.length + ' bill(s)?' + (paidN ? '\n\n' + paidN + ' of them are already paid (or paid through RTM / NextTrade): the P&L of the period they were paid in can change.' : '') + '\n\nEach change is on the audit trail.')) { return; }
    setBusy(true);
    post({ action: 'apply', id: pv.rule.id, bill_ids: ids, user_id: props.userProfile && props.userProfile.id }).then(function (j) {
      setBusy(false);
      if (!j || !j.ok) { setMsg({ bad: true, text: (j && j.error) || 'Nothing was changed.' }); return; }
      setMsg({ bad: (j.skipped || []).length > 0, text: j.applied + ' bill(s) changed.' + (j.note ? ' ' + j.note : '') + ((j.skipped || []).length ? ' Not changed: ' + j.skipped.length + ' (' + j.skipped.map(function (s) { return s.why; }).slice(0, 3).join('; ') + ').' : '') });
      setPv(null); if (props.onChanged) { props.onChanged(); }
    });
  }
  var manage = st.can_manage && st.ready;
  return (
    <div className="rounded-xl p-3 mb-2" style={{ background: '#ffffff', border: '1px solid #a5b4fc', color: '#0f172a' }}>
      <div className="flex items-center gap-2 mb-1">
        <b className="text-[13px]">Category rules for bills</b>
        <span className="text-[11px]" style={{ color: '#64748b' }}>Vendor (+ exact amount, a range, or words on the bill) → category. Used for new bills and in the P&L breakdowns. A category a person picked is never changed.</span>
        <button type="button" onClick={function () { if (props.onClose) { props.onClose(); } }} className="ml-auto text-[11px] font-bold" style={{ color: '#64748b' }}>✕ Close</button>
      </div>
      {msg && <div className="text-[11px] mb-1 px-2 py-1 rounded" style={{ background: msg.bad ? '#fef2f2' : '#ecfdf5', color: msg.bad ? '#991b1b' : '#065f46' }}>{msg.text}</div>}
      {st.loading && <div className="text-[11px]" style={{ color: '#64748b' }}>Loading…</div>}
      {st.error && <div className="text-[11px]" style={{ color: '#991b1b' }}>{st.error}</div>}
      {!st.loading && !st.ready && <div className="text-[11px] px-2 py-1 rounded" style={{ background: '#fffbeb', color: '#78350f' }}>Bill rules need a one-time database step ({st.sql_file || 'sql/v55-83-WX-bill-category-rules.sql'}). Until then new bills keep getting the vendor's remembered category.</div>}
      {!st.loading && st.ready && <table className="w-full text-[11px] mt-1"><thead><tr style={{ color: '#475569' }}><th className="text-left">Rule</th><th className="text-left">Vendor</th><th className="text-left">Bill total</th><th className="text-left">Words</th><th className="text-left">Category</th><th className="text-left">Weight</th><th /></tr></thead>
        <tbody>{st.rules.length === 0 && <tr><td colSpan={7} className="py-1" style={{ color: '#64748b' }}>No rules yet.</td></tr>}
          {st.rules.map(function (r) { return <tr key={r.id} style={{ borderTop: '1px solid #f1f5f9', opacity: r.active === false ? 0.5 : 1 }}>
            <td className="py-1 font-bold">{r.name}{r.active === false ? ' (off)' : ''}</td><td>{r.vendor_match}</td><td>{amountWords(r)}</td><td>{r.words || '—'}</td>
            <td>{catLabel[r.category] || r.category}</td><td>{r.priority || 0}</td>
            <td className="text-right whitespace-nowrap">
              {r.active !== false && <button type="button" disabled={busy} onClick={function () { preview(r); }} className="px-2 py-0.5 rounded font-extrabold mr-1" style={{ background: '#e0e7ff', color: '#312e81' }}>Preview bills on file</button>}
              {manage && <button type="button" disabled={busy} onClick={function () { edit(r); }} className="px-2 py-0.5 rounded font-extrabold mr-1" style={{ background: '#f1f5f9', color: '#0f172a' }}>Edit</button>}
              {manage && <button type="button" disabled={busy} onClick={function () { onOff(r); }} className="px-2 py-0.5 rounded font-extrabold" style={{ background: '#f1f5f9', color: '#0f172a' }}>{r.active === false ? 'Switch on' : 'Switch off'}</button>}
            </td></tr>; })}</tbody></table>}
      {manage && !form && <button type="button" onClick={function () { edit(null); }} className="mt-2 px-3 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#312e81', color: '#ffffff' }}>+ New rule</button>}
      {form && <div className="mt-2 p-2 rounded-lg" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px]">
          <label>Vendor (part of its name)<input value={form.vendor_match} onChange={function (e) { set('vendor_match', e.target.value); }} className="w-full border rounded px-1 py-0.5" placeholder="e.g. NexPac" /></label>
          <label>Category<select value={form.category} onChange={function (e) { set('category', e.target.value); }} className="w-full border rounded px-1 py-0.5"><option value="">— pick —</option>{st.categories.map(function (c) { return <option key={c.key} value={c.key}>{c.label}</option>; })}</select></label>
          <label>Rule name (optional)<input value={form.name} onChange={function (e) { set('name', e.target.value); }} className="w-full border rounded px-1 py-0.5" placeholder="e.g. Monthly partner fee" /></label>
          <label>Bill total<select value={form.amount_mode} onChange={function (e) { set('amount_mode', e.target.value); }} className="w-full border rounded px-1 py-0.5"><option value="exact">exactly this amount</option><option value="range">between two amounts</option><option value="any">any amount</option></select></label>
          {form.amount_mode === 'exact' && <label>Amount (USD, the whole bill)<input value={form.amount_exact} onChange={function (e) { set('amount_exact', e.target.value); }} className="w-full border rounded px-1 py-0.5" inputMode="decimal" /></label>}
          {form.amount_mode === 'range' && <label>From / to (USD)<span className="flex gap-1"><input value={form.amount_min} onChange={function (e) { set('amount_min', e.target.value); }} className="w-full border rounded px-1 py-0.5" inputMode="decimal" /><input value={form.amount_max} onChange={function (e) { set('amount_max', e.target.value); }} className="w-full border rounded px-1 py-0.5" inputMode="decimal" /></span></label>}
          <label>Words on the bill (optional)<input value={form.words} onChange={function (e) { set('words', e.target.value); }} className="w-full border rounded px-1 py-0.5" placeholder="e.g. partner fee" /></label>
          <label title="When two rules fit a bill equally well, the higher weight wins. Equal weight and different categories: the bill is left for a person.">Weight (0 = normal)<input value={form.priority} onChange={function (e) { set('priority', e.target.value); }} className="w-full border rounded px-1 py-0.5" inputMode="numeric" /></label>
        </div>
        <div className="text-[10px] mt-1" style={{ color: '#64748b' }}>All conditions must match. A more exact rule wins over a looser one (exact amount, then a range, then words). Only KTC USA bills in US dollars. A bill already counted inside goods or transport profit is never moved into an expense column by a rule.</div>
        <div className="mt-2 flex gap-2"><button type="button" disabled={busy} onClick={save} className="px-3 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#047857', color: '#ffffff' }}>Save rule</button><button type="button" onClick={function () { setForm(null); }} className="px-3 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#e2e8f0', color: '#0f172a' }}>Cancel</button></div>
      </div>}
      {pv && <div className="mt-2 p-2 rounded-lg" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
        <div className="text-[12px] font-extrabold">{'Bills on file that "' + pv.rule.name + '" fits — ' + (pv.rows || []).length}</div>
        <div className="text-[10px] mb-1" style={{ color: '#64748b' }}>{Object.keys(pv.counts || {}).map(function (k) { return (STATUS[k] ? STATUS[k].label : k) + ': ' + pv.counts[k]; }).join(' · ') || 'No bill fits this rule.'}</div>
        <table className="w-full text-[11px]"><tbody>{(pv.rows || []).map(function (x) { var s = STATUS[x.status] || { label: x.status, bg: '#f1f5f9', fg: '#334155' }; return <tr key={x.id} style={{ borderTop: '1px solid #f1f5f9' }}>
          <td className="py-1">{x.status === 'will_set' && manage ? <input type="checkbox" checked={!!ticked[x.id]} onChange={function (e) { var t = Object.assign({}, ticked); t[x.id] = e.target.checked; setTicked(t); }} /> : null}</td>
          <td>{x.vendor_name + ' #' + (x.bill_number || '—')}</td><td>{x.bill_date || '—'}</td><td>{money(x.total_amount)}</td>
          <td>{x.category ? (catLabel[x.category] || x.category) : 'no category'}</td>
          <td>{(x.paid > 0 ? 'paid ' + money(x.paid) : '') + (x.paid_via ? (x.paid > 0 ? ' · ' : '') + 'via ' + x.paid_via : '')}</td>
          <td><span className="px-1.5 py-0.5 rounded font-bold" style={{ background: s.bg, color: s.fg }} title={x.why || ''}>{s.label}</span></td></tr>; })}</tbody></table>
        {manage && (pv.counts || {}).will_set > 0 && <button type="button" disabled={busy} onClick={apply} className="mt-2 px-3 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#047857', color: '#ffffff' }}>Apply to ticked bills</button>}
        <button type="button" onClick={function () { setPv(null); }} className="mt-2 ml-2 px-3 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#e2e8f0', color: '#0f172a' }}>Close preview</button>
      </div>}
    </div>
  );
}
