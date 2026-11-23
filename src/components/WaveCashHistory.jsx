'use client';

import { useEffect, useState } from 'react';
import { Download, Upload, Pencil, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { currencyScale } from '../lib/wave-history';

const field = 'rounded border border-slate-500 bg-white px-2 py-1.5 text-sm text-slate-900';
const button = 'inline-flex items-center justify-center gap-2 rounded border border-slate-500 px-3 py-2 text-sm disabled:opacity-40';
const icon = button + ' h-9 w-9 p-1';
async function cashFetch(query = {}, body, download = false) {
  const { data } = await supabase.auth.getSession();
  if (!data.session?.access_token) throw new Error('Sign in to view Wave History.');
  const headers = { Authorization: 'Bearer ' + data.session.access_token };
  const multipart = body instanceof FormData;
  if (body && !multipart) headers['Content-Type'] = 'application/json';
  const res = await fetch('/api/wave-history/cash?' + new URLSearchParams(query), { method: body ? 'POST' : 'GET',
    headers, body: body && (multipart ? body : JSON.stringify(body)), cache: 'no-store' });
  if (!res.ok) { const error = await res.json().catch(() => ({})); throw new Error(error.error || 'Cash history is unavailable.'); }
  return download ? res.blob() : res.json();
}
function money(minor, currency) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(minor || 0) / 10 ** currencyScale(currency));
}
function Mapping({ row, data, onClose, onSaved }) {
  const [kind, setKind] = useState(row.mapping?.kind || 'unclassified');
  const [nt, setNt] = useState(row.mapping?.nextrade_category || '');
  const [ktc, setKtc] = useState(row.mapping?.ktc_category || '');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  return <div role="dialog" aria-modal="true" aria-label="Category mapping" className="fixed inset-0 z-[150] flex items-center justify-center bg-black/70 p-4" onKeyDown={e => { if (e.key === 'Escape' && !busy) onClose(); }}>
    <form className="w-full max-w-lg space-y-4 rounded-lg border border-slate-500 bg-gray-950 p-5 text-white" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError('');
      try { await cashFetch({}, { action: 'mapping', account: row.account_key, kind, nextrade: nt || null, ktc: ktc || null, revision: row.mapping?.revision || 0 }); onSaved(); }
      catch (err) { setError(err.message); } finally { setBusy(false); }
    }}>
      <div className="flex items-start justify-between gap-3"><h3 className="text-lg font-semibold break-words">{row.account_name}</h3><button type="button" disabled={busy} title="Close" aria-label="Close mapping" className={icon} onClick={onClose}><X size={18} /></button></div>
      <p className="text-sm text-amber-200">Research mapping only. No bank category, bill or KTC P&amp;L will change.</p>
      <label className="block">Account type<select autoFocus className={field + ' mt-1 w-full'} value={kind} onChange={e => setKind(e.target.value)}>
        <option value="unclassified">Unclassified</option><option value="expense">Expense</option><option value="income">Income</option><option value="other">Balance sheet / clearing / other</option>
      </select></label>
      <label className="block">NextTrade Hub category<select className={field + ' mt-1 w-full'} value={nt} onChange={e => setNt(e.target.value)}><option value="">Unmapped</option>{data.nextrade_categories.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
      <label className="block">KTC internal reporting category<select className={field + ' mt-1 w-full'} value={ktc} onChange={e => setKtc(e.target.value)}><option value="">Unmapped</option>{data.ktc_categories.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
      {error && <p role="alert" className="text-red-300">{error}</p>}
      <button disabled={busy} className={button}>{busy ? 'Saving...' : 'Save mapping'}</button>
    </form>
  </div>;
}
function CashImport({ onSaved }) {
  const [file, setFile] = useState(null), [currency, setCurrency] = useState('USD'), [confirmed, setConfirmed] = useState(false);
  const [preview, setPreview] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function submit(action) {
    setBusy(true); setError('');
    try {
      const form = new FormData(); form.set('csv', file); form.set('currency', currency); form.set('confirmed', String(confirmed)); form.set('action', action);
      if (preview) form.set('fingerprint', preview.fingerprint);
      const result = await cashFetch({}, form);
      if (action === 'preview') setPreview(result.preview); else { setPreview(null); onSaved(result.import); }
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <form className="space-y-3 border-y border-slate-600 py-4" onSubmit={e => { e.preventDefault(); submit('preview'); }} onChange={() => setPreview(null)}>
    <h3 className="font-semibold">Import NextTrade cash history</h3>
    <div className="flex flex-wrap gap-3"><label>Wave CSV<input className={field + ' ml-2 max-w-full'} type="file" accept=".csv,text/csv" required disabled={busy} onChange={e => setFile(e.target.files[0])} /></label>
      <label>Business currency<input className={field + ' ml-2 w-20'} value={currency} maxLength={3} required pattern="[A-Za-z]{3}" disabled={busy} onChange={e => setCurrency(e.target.value.toUpperCase())} /></label></div>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} required disabled={busy} onChange={e => setConfirmed(e.target.checked)} />All accounts are included and the business currency above matches Wave.</label>
    <button disabled={busy || !file || !confirmed} className={button}><Upload size={16} />{busy ? 'Checking...' : 'Preview import'}</button>
    {preview && <div className="space-y-2 text-sm"><p>{preview.profile} | Cash basis | {preview.start} to {preview.end}</p><p>{preview.rows.toLocaleString()} entries | {preview.accounts.length} account sections | Debits {money(preview.debit, preview.currency)} | Credits {money(preview.credit, preview.currency)}</p><button type="button" className={button} disabled={busy} onClick={() => submit('save')}>Save reconciled history</button></div>}
    {error && <p role="alert" className="text-red-300">{error}</p>}
  </form>;
}
export default function WaveCashHistory({ mayManage }) {
  const [filters, setFilters] = useState({ from: '2021-01-01', to: new Date().toISOString().slice(0,10), currency: 'USD' });
  const [draft, setDraft] = useState(filters), [account, setAccount] = useState(''), [offset, setOffset] = useState(0);
  const [data, setData] = useState(null), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0), [mapping, setMapping] = useState(null), [importing, setImporting] = useState(false);
  useEffect(() => {
    let active = true; setData(null); setError('');
    cashFetch({ ...filters, account, offset }).then(r => { if (active) setData(r); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [filters, account, offset, revision]);
  const editable = data?.mayManage ?? mayManage;
  async function download(source) {
    try { const blob = await cashFetch({ source: source.id }, null, true); const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = source.file_name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setError(err.message); }
  }
  return <section className="space-y-4 text-slate-100">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-semibold">NextTrade cash history</h3>{editable && <button className={button} onClick={() => setImporting(!importing)}><Upload size={16} />Import CSV</button>}</div>
    <p className="text-sm text-amber-200">Cash basis (paid). Separate from accrual history and KTC P&amp;L. Unclassified accounts are excluded from expense and income totals.</p>
    {importing && editable && <CashImport onSaved={r => { setMessage(r.rows.toLocaleString() + (r.unchanged ? ' entries already archived.' : ' entries archived.')); setRevision(v => v + 1); }} />}
    <form className="flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); setAccount(''); setOffset(0); setFilters({ ...draft }); }}>
      <label>From<input className={field + ' block'} type="date" required value={draft.from} onChange={e => setDraft({ ...draft, from: e.target.value })} /></label>
      <label>To<input className={field + ' block'} type="date" required value={draft.to} onChange={e => setDraft({ ...draft, to: e.target.value })} /></label>
      <label>Currency<input className={field + ' block w-20'} maxLength={3} required pattern="[A-Za-z]{3}" value={draft.currency} onChange={e => setDraft({ ...draft, currency: e.target.value.toUpperCase() })} /></label><button className={button}>Apply</button>
    </form>
    {message && <p role="status">{message}</p>}{error && <p role="alert" className="text-red-300">{error}</p>}
    {!data && !error && <p role="status">Loading cash history...</p>}
    {data && <>
      <div className="flex flex-wrap gap-6 border-y border-slate-600 py-3">
        {['expense','income'].map(kind => <div key={kind}><span className="block text-sm">Classified {kind}</span><strong>{data.imports.length ? money(data.accounts.filter(r => r.mapping?.kind === kind).reduce((sum,r) => sum + (kind === 'expense' ? Number(r.debit_minor)-Number(r.credit_minor) : Number(r.credit_minor)-Number(r.debit_minor)),0), filters.currency) : 'Unavailable'}</strong></div>)}
        <div><span className="block text-sm">Unclassified accounts</span><strong>{data.accounts.filter(r => !r.mapping || r.mapping.kind === 'unclassified').length}</strong></div>
      </div>
      <details><summary>Archived source coverage ({data.imports.length})</summary>{data.imports.map(i => <div key={i.id} className="flex flex-wrap items-center gap-2 py-2 text-sm"><button className={icon} title="Download original CSV" aria-label={'Download '+i.file_name} onClick={() => download(i)}><Download size={16} /></button><span>{i.date_from} to {i.date_to} | {i.row_count.toLocaleString()} entries | {i.file_name}</span></div>)}{!data.imports.length && <p>No cash history imported for this period.</p>}</details>
      <div className="overflow-x-auto"><table className="w-full min-w-[950px] text-left text-sm"><thead><tr className="border-b border-slate-600">{['Original Wave category','NextTrade category','KTC reporting category','Type','Debit','Credit',''].map((h,i) => <th key={i} className="px-2 py-3">{h}</th>)}</tr></thead><tbody>{data.accounts.map(r => <tr key={r.account_key} className="border-b border-slate-700">
        <td className="px-2 py-3"><button className="text-cyan-300 underline" onClick={() => { setAccount(r.account_key); setOffset(0); }}>{r.account_name}</button></td>
        <td className="px-2">{data.nextrade_categories.find(c => c.key === r.mapping?.nextrade_category)?.label || r.mapping?.nextrade_category || 'Unmapped'}</td>
        <td className="px-2">{data.ktc_categories.find(c => c.key === r.mapping?.ktc_category)?.label || r.mapping?.ktc_category || 'Unmapped'}</td>
        <td className="px-2">{r.mapping?.kind || 'unclassified'}</td><td className="px-2 text-right tabular-nums">{money(r.debit_minor, filters.currency)}</td><td className="px-2 text-right tabular-nums">{money(r.credit_minor, filters.currency)}</td>
        <td>{editable && <button className={icon} title="Edit category mapping" aria-label={'Map '+r.account_name} onClick={() => setMapping(r)}><Pencil size={15} /></button>}</td>
      </tr>)}</tbody></table></div>
      {account && <div className="space-y-3 border-t border-slate-500 pt-4"><div className="flex items-center justify-between"><h4 className="font-semibold">{data.accounts.find(r => r.account_key === account)?.account_name} entries</h4><button className={icon} title="Close entries" aria-label="Close entries" onClick={() => setAccount('')}><X size={16} /></button></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-sm"><thead><tr><th>Date</th><th>Description</th><th>Debit</th><th>Credit</th><th>Source record</th></tr></thead><tbody>{data.entries.slice(0,100).map(r => <tr key={r.import_id+':'+r.source_row} className="border-b border-slate-700"><td className="p-2 whitespace-nowrap">{r.posted_date}</td><td className="p-2 whitespace-pre-wrap">{r.description}</td><td className="p-2 text-right">{money(r.debit_minor,filters.currency)}</td><td className="p-2 text-right">{money(r.credit_minor,filters.currency)}</td><td className="p-2">{r.import_id}:{r.source_row}</td></tr>)}</tbody></table></div>
        <div className="flex items-center gap-3"><button className={icon} title="Previous page" aria-label="Previous page" disabled={!offset} onClick={() => setOffset(v => Math.max(0,v-100))}><ChevronLeft size={16} /></button><span>Page {offset/100+1}</span><button className={icon} title="Next page" aria-label="Next page" disabled={data.entries.length<=100} onClick={() => setOffset(v => v+100)}><ChevronRight size={16} /></button></div>
        <details><summary>Mapping history</summary>{data.mapping_history.map(h => <div key={h.id} className="border-b border-slate-700 py-2 text-sm">{h.changed_at} | {h.actor}<br />NextTrade: {h.before_value?.nextrade_category || 'Unmapped'} to {h.after_value.nextrade_category || 'Unmapped'}; KTC: {h.before_value?.ktc_category || 'Unmapped'} to {h.after_value.ktc_category || 'Unmapped'}; type: {h.after_value.kind}</div>)}</details>
      </div>}
      {mapping && <Mapping row={mapping} data={data} onClose={() => setMapping(null)} onSaved={() => { setMapping(null); setRevision(v => v+1); }} />}
    </>}
  </section>;
}
