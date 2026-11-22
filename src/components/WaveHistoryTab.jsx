'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { currencyScale, MAX_WAVE_CSV_BYTES } from '../lib/wave-history';

const panel = 'rounded-xl border border-slate-700 bg-slate-900/70 p-4 sm:p-5';
const inputClass = 'mt-1 w-full rounded-md border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100';
const button = 'rounded-md bg-slate-700 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50';
const primary = 'rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50';
const link = 'text-left text-indigo-300 hover:text-indigo-100 hover:underline disabled:opacity-50';
const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function defaultPeriod() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric' }).formatToParts(new Date());
  const year = Number(parts.find(part => part.type === 'year').value);
  const month = Number(parts.find(part => part.type === 'month').value);
  return { year: String(month === 1 ? year - 1 : year), month: String(month === 1 ? 12 : month - 1), currency: 'USD' };
}

export async function fetchHistory(query = {}, body) {
  const { data } = await supabase.auth.getSession();
  if (!data.session?.access_token) throw new Error('Sign in again to view Wave History.');
  const headers = { Authorization: 'Bearer ' + data.session.access_token };
  const multipart = body instanceof FormData;
  if (body && !multipart) headers['Content-Type'] = 'application/json';
  const response = await fetch('/api/wave-history?' + new URLSearchParams(query), {
    method: body ? 'POST' : 'GET', headers, body: body && (multipart ? body : JSON.stringify(body)), cache: 'no-store',
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Wave History could not complete this request.');
  return result;
}

function money(value, currency) {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value / 10 ** currencyScale(currency));
}

function Notice({ children, error = false }) {
  return <p role={error ? 'alert' : 'status'} className={error ? 'rounded-md bg-rose-950/60 p-3 text-sm text-rose-200' : 'text-sm text-slate-300'}>{children}</p>;
}

function WaveMonthImport({ onImported }) {
  const [preview, setPreview] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const form = useRef(null);

  async function submit(event, action) {
    event?.preventDefault();
    const body = new FormData(form.current);
    if (body.get('csv')?.size > MAX_WAVE_CSV_BYTES) {
      setError('The monthly CSV exceeds the 3 MB upload limit.');
      return;
    }
    setError('');
    setMessage('');
    setBusy(action);
    body.set('action', action);
    body.set('allAccounts', String(body.has('allAccounts')));
    try {
      if (action === 'save') {
        body.set('fingerprint', preview.fingerprint);
        body.set('revision', String(preview.existing?.revision || 0));
        const result = await fetchHistory({}, body);
        const { month, rows, unchanged } = result.import;
        setMessage(month + ' is reconciled with Wave. ' + rows.toLocaleString() + ' ledger lines ' + (unchanged ? 'were already archived.' : 'saved.'));
        setPreview(null);
        onImported({ year: month.slice(0, 4), month: String(Number(month.slice(5))), currency: String(body.get('currency')).trim().toUpperCase() });
      } else {
        const result = await fetchHistory({}, body);
        setPreview({ ...result.preview, currency: String(body.get('currency')).trim().toUpperCase() });
      }
    } catch (err) {
      setError(err.message);
      if (action === 'preview') setPreview(null);
    } finally {
      setBusy('');
    }
  }

  return <section className={panel}>
    <h3 className="text-lg font-semibold text-slate-100">Import one month</h3>
    <p className="mt-1 text-sm text-slate-300">In Wave, open Reports → Account Transactions (General Ledger). Select the full month, all accounts, and accrual basis. Use the original CSV export and the debit and credit totals from that Wave report.</p>
    <form ref={form} onSubmit={event => submit(event, 'preview')} onChange={() => { setPreview(null); setMessage(''); }} className="mt-4">
      <fieldset disabled={!!busy} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm text-slate-300">Wave profile name<input className={inputClass} name="waveProfile" required maxLength={160} placeholder="As shown in Wave" /></label>
        <label className="text-sm text-slate-300">Report month<input className={inputClass} name="month" type="month" defaultValue={defaultPeriod().year + '-' + defaultPeriod().month.padStart(2, '0')} required /></label>
        <label className="text-sm text-slate-300">Report currency<input className={inputClass + ' uppercase'} name="currency" defaultValue="USD" required maxLength={3} pattern="[A-Za-z]{3}" /></label>
        <label className="text-sm text-slate-300">Wave ledger CSV<input className={inputClass} name="csv" type="file" accept=".csv,text/csv" required /></label>
        <label className="text-sm text-slate-300">Wave total debits<input className={inputClass} name="waveDebit" inputMode="decimal" placeholder="Enter the Wave report total" /></label>
        <label className="text-sm text-slate-300">Wave total credits<input className={inputClass} name="waveCredit" inputMode="decimal" placeholder="Enter the Wave report total" /></label>
        <label className="flex items-start gap-2 text-sm text-slate-300 sm:col-span-2 lg:col-span-3">
          <input name="allAccounts" type="checkbox" required className="mt-1 accent-indigo-500" />
          <span>This is the complete accrual-basis report for the selected Wave profile and month, with all accounts and no contact or tag filters.</span>
        </label>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
          <button className={primary} disabled={!!busy}>{busy === 'preview' ? 'Checking CSV…' : 'Preview and reconcile'}</button>
          {preview?.matchesWave && <button type="button" className={button} disabled={!!busy} onClick={() => submit(null, 'save')}>
            {busy === 'save' ? 'Saving…' : preview.existing ? 'Save reconciled replacement' : 'Save reconciled month'}
          </button>}
        </div>
      </fieldset>
    </form>
    {error && <div className="mt-3"><Notice error>{error}</Notice></div>}
    {message && <div className="mt-3"><Notice>{message}</Notice></div>}
    {preview && <div className="mt-5 space-y-3" aria-live="polite">
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-200">
        <span>{preview.rowCount.toLocaleString()} ledger lines</span>
        <span>CSV debits {money(preview.debit, preview.currency)}</span>
        <span>CSV credits {money(preview.credit, preview.currency)}</span>
        <span>Wave debits {money(preview.expectedDebit, preview.currency)}</span>
        <span>Wave credits {money(preview.expectedCredit, preview.currency)}</span>
      </div>
      {preview.matchesWave ? <p className="text-sm font-semibold text-emerald-300">Both totals match Wave.</p> :
        <Notice error={!preview.balanced || (preview.expectedDebit !== null && preview.expectedCredit !== null)}>
          {!preview.balanced ? 'The CSV debits and credits differ. Check that all Wave accounts were exported.' :
            preview.expectedDebit === null || preview.expectedCredit === null ? 'Enter both totals from Wave and run the preview again to reconcile.' :
              'The CSV totals differ from the Wave totals entered. Check the report filters and the amounts.'}
        </Notice>}
      {preview.existing && <Notice>This month already has a reconciled import. Saving updates the month used in reports and retains the previous version in the archive.</Notice>}
      {preview.unclassified > 0 && <Notice>{preview.unclassified} ledger lines have a Wave account type that needs review before category reporting.</Notice>}
      <details className="text-sm text-slate-300">
        <summary className="cursor-pointer font-semibold text-indigo-300">Compare debits and credits by Wave account</summary>
        <div className="overflow-x-auto"><table className="mt-2 w-full text-left text-sm">
          <thead className="text-slate-400"><tr><th scope="col" className="p-2">Wave account</th><th scope="col" className="p-2 text-right">Debits</th><th scope="col" className="p-2 text-right">Credits</th></tr></thead>
          <tbody>{preview.accounts.map(account => <tr key={account.key} className="border-t border-slate-800">
            <td className="p-2">{account.name} <span className="text-xs text-slate-400">{account.group || account.type}</span></td>
            <td className="p-2 text-right tabular-nums">{money(account.debit, preview.currency)}</td>
            <td className="p-2 text-right tabular-nums">{money(account.credit, preview.currency)}</td>
          </tr>)}</tbody>
        </table></div>
      </details>
    </div>}
  </section>;
}

function LedgerEntries({ filters, comparison, account, mayManage, onSelectAccount, onCategorySaved, onClose }) {
  const [period, setPeriod] = useState('current');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [category, setCategory] = useState(account?.category || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    setData(null);
    setError('');
    fetchHistory({ ...filters, action: 'entries', account: account?.account_key || '', period, offset })
      .then(result => { if (active) setData(result); })
      .catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [filters, account, period, offset]);

  async function saveCategory(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await fetchHistory({}, { action: 'category', account: account.account_key, category });
      onCategorySaved();
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  return <section className={panel}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-base font-semibold text-slate-100">{account?.account_name || 'All archived ledger lines'}</h3>
      <button type="button" className={button} onClick={onClose}>Close ledger</button>
    </div>
    <div className="my-3 flex flex-wrap items-end gap-3">
      <label className="text-sm text-slate-300">Ledger period<select className={inputClass} value={period} onChange={event => { setPeriod(event.target.value); setOffset(0); }}>
        <option value="current">{comparison.current.year}</option><option value="prior">{comparison.prior.year}</option>
      </select></label>
      {account && account.kind !== 'other' && mayManage && <form onSubmit={saveCategory} className="flex flex-wrap items-end gap-2">
        <label className="text-sm text-slate-300">Reporting category<input className={inputClass} value={category} maxLength={100} placeholder="Use Wave category" onChange={event => setCategory(event.target.value)} /></label>
        <button className={button} disabled={saving}>{saving ? 'Saving…' : 'Save category'}</button>
      </form>}
    </div>
    {error && <Notice error>{error}</Notice>}
    {!error && !data && <Notice>Loading ledger lines…</Notice>}
    {data?.rows.length === 0 && <Notice>No ledger lines for this selection.</Notice>}
    {!!data?.rows.length && <div className="overflow-x-auto"><table className="w-full text-left text-sm text-slate-200">
      <thead className="text-slate-400"><tr>{['Date', 'Wave account', 'Description', 'Debit', 'Credit'].map((label, i) => <th key={label} scope="col" className={'p-2 ' + (i > 2 ? 'text-right' : '')}>{label}</th>)}</tr></thead>
      <tbody>{data.rows.map(row => <tr key={row.posted_date + '-' + row.source_row} className="border-t border-slate-800">
        <td className="whitespace-nowrap p-2">{row.posted_date}</td>
        <td className="p-2">{!account && row.kind !== 'other' ? <button type="button" className={link} onClick={() => onSelectAccount(row)}>{row.account_name}</button> : row.account_name}</td>
        <td className="p-2">{row.description}{row.other_accounts && <div className="text-xs text-slate-400">{row.other_accounts}</div>}</td>
        <td className="p-2 text-right tabular-nums">{money(row.debit_minor, comparison.currency)}</td>
        <td className="p-2 text-right tabular-nums">{money(row.credit_minor, comparison.currency)}</td>
      </tr>)}</tbody>
    </table></div>}
    {data && (offset > 0 || data.hasMore) && <div className="mt-3 flex items-center gap-2">
      <button className={button} disabled={!offset} onClick={() => setOffset(offset - 100)}>Previous</button>
      <span className="text-sm text-slate-400">Page {offset / 100 + 1}</span>
      <button className={button} disabled={!data.hasMore} onClick={() => setOffset(offset + 100)}>Next</button>
    </div>}
  </section>;
}

function ClaudeHistoryReport({ filters, mayViewInventory }) {
  const [includeInventory, setIncludeInventory] = useState(false);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function generate(event) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    setResult(null);
    try {
      setResult(await fetchHistory({}, {
        ...filters, action: 'compose', question: fields.get('question'),
        includeInventory, productFilter: fields.get('productFilter'),
      }));
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return <section className={panel}>
    <h3 className="text-lg font-semibold text-slate-100">Write a report with Claude</h3>
    <p className="mt-1 text-sm text-slate-300">Use the selected periods to summarize historical costs and explain year-over-year changes.</p>
    <form onSubmit={generate} className="mt-3 space-y-3">
      <fieldset disabled={busy} className="space-y-3">
        <label className="block text-sm text-slate-300">Report focus<textarea className={inputClass} name="question" rows={2} maxLength={1500} placeholder="Compare rent, utilities, insurance, and goods purchases across the selected periods." /></label>
        {mayViewInventory && <label className="flex items-start gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={includeInventory} onChange={event => setIncludeInventory(event.target.checked)} className="mt-1 accent-indigo-500" />
          <span>Include recorded Hub Inventory receipts by product, family, and unit</span>
        </label>}
        {includeInventory && <label className="block max-w-md text-sm text-slate-300">Product or family filter (optional)<input className={inputClass} name="productFilter" maxLength={100} /></label>}
        <button className={primary}>{busy ? 'Writing report…' : 'Generate report'}</button>
      </fieldset>
    </form>
    {error && <div className="mt-3"><Notice error>{error}</Notice></div>}
    {result && <div className="mt-4 space-y-2" aria-live="polite">
      <div className="whitespace-pre-wrap rounded-md border border-slate-700 bg-slate-950 p-4 text-sm leading-relaxed text-slate-200">{result.report}</div>
      {result.truncated && <Notice>Claude reached its response limit. Narrow the report focus for a shorter analysis.</Notice>}
    </div>}
  </section>;
}

function CategoryComparison({ comparison, onSelectLedger }) {
  const [selected, setSelected] = useState(null);
  const kindLabel = { expense: 'Expenses', income: 'Income', unclassified: 'Reviewed accounts' };
  const hasCurrent = comparison.current.imported.length > 0;
  const hasPrior = comparison.prior.imported.length > 0;

  function coverage(period) {
    const missing = period.months.filter(month => !period.imported.includes(month));
    return period.year + ' · ' + period.imported.length + '/' + period.months.length + ' months reconciled' +
      (missing.length ? ' · Missing ' + missing.map(month => months[Number(month.slice(5)) - 1].slice(0, 3)).join(', ') : '');
  }

  return <section className={panel}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h3 className="text-lg font-semibold text-slate-100">Year-over-year category totals</h3>
        <p className="text-sm text-slate-400">{[comparison.wave_profile, comparison.currency, 'Accrual basis'].filter(Boolean).join(' · ')}</p>
      </div>
      {(hasCurrent || hasPrior) && <button type="button" className={button} onClick={() => onSelectLedger({})}>All ledger lines</button>}
    </div>
    <div className="my-3 grid gap-1 text-sm text-slate-300 sm:grid-cols-2"><span>{coverage(comparison.current)}</span><span>{coverage(comparison.prior)}</span></div>
    {!comparison.complete && (hasCurrent || hasPrior) && <Notice>Totals show imported months. Changes appear once both selected periods are complete.</Notice>}
    {comparison.unclassified > 0 && <Notice>{comparison.unclassified} ledger lines need a reporting category. Open All ledger lines to review them.</Notice>}
    {!comparison.rows.length && <div className="mt-3"><Notice>{hasCurrent || hasPrior ? 'No categorized income or expense lines for these periods.' : 'No reconciled Wave imports for these periods.'}</Notice></div>}
    {!!comparison.rows.length && <div className="mt-3 overflow-x-auto"><table className="w-full text-sm text-slate-200">
      <thead className="border-b border-slate-700 text-slate-400"><tr>
        <th scope="col" className="p-2 text-left">Category</th>
        <th scope="col" className="p-2 text-right">{comparison.current.year}</th>
        <th scope="col" className="p-2 text-right">{comparison.prior.year}</th>
        <th scope="col" className="p-2 text-right">Change</th>
        <th scope="col" className="p-2 text-right">Change %</th>
      </tr></thead>
      {Object.entries(kindLabel).map(([kind, label]) => {
        const rows = comparison.rows.filter(row => row.kind === kind);
        if (!rows.length) return null;
        return <tbody key={kind}>
          <tr><th colSpan={5} scope="rowgroup" className="bg-slate-800/80 p-2 text-left text-xs font-semibold text-slate-300">{label}</th></tr>
          {rows.flatMap(row => {
            const key = JSON.stringify([kind, row.category]);
            const open = selected === key;
            return [<tr key={key} className="border-b border-slate-800">
              <th scope="row" className="p-2 text-left font-medium">
                <button type="button" className={link} aria-expanded={open} onClick={() => setSelected(open ? null : key)}>{row.category}</button>
              </th>
              <td className="p-2 text-right tabular-nums">{money(hasCurrent ? row.current_minor : null, comparison.currency)}</td>
              <td className="p-2 text-right tabular-nums">{money(hasPrior ? row.prior_minor : null, comparison.currency)}</td>
              <td className="p-2 text-right tabular-nums">{money(row.change_minor, comparison.currency)}</td>
              <td className="p-2 text-right tabular-nums">{row.change_percent === null ? '—' : row.change_percent.toLocaleString('en-US', { maximumFractionDigits: 1 }) + '%'}</td>
            </tr>, open ? <tr key={key + '/accounts'}><td colSpan={5} className="bg-slate-800/40 p-3">
              <p className="mb-1 text-xs text-slate-400">Wave accounts</p>
              <ul className="flex flex-wrap gap-x-4 gap-y-1">{row.accounts.map(account => <li key={account.account_key}>
                <button type="button" className={link} onClick={() => onSelectLedger(account)}>{account.account_name}</button>
              </li>)}</ul>
            </td></tr> : null];
          })}
        </tbody>;
      })}
    </table></div>}
  </section>;
}

export default function WaveHistoryTab({ mayManage: initialManage }) {
  const [view, setView] = useState('report');
  const [filters, setFilters] = useState(defaultPeriod);
  const [draft, setDraft] = useState(filters);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [ledger, setLedger] = useState(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setData(null);
    setError('');
    fetchHistory(filters).then(result => { if (active) setData(result); }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [filters, revision]);

  function applyFilters(next) {
    setDraft(next);
    setLedger(null);
    setFilters({ ...next });
  }

  const mayManage = data?.mayManage ?? initialManage;
  return <div className="mx-auto max-w-6xl space-y-4 p-3 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-2xl font-semibold text-slate-100">NextTrade Wave History</h2>
        <p className="mt-1 text-sm text-slate-300">Historical costs, category trends, and year-over-year comparisons.</p>
      </div>
      <div role="group" aria-label="Wave History sections" className="flex gap-2">
        <button type="button" aria-pressed={view === 'report'} className={view === 'report' ? primary : button} onClick={() => setView('report')}>Category reports</button>
        {mayManage && <button type="button" aria-pressed={view === 'import'} className={view === 'import' ? primary : button} onClick={() => setView('import')}>Import a month</button>}
      </div>
    </div>
    {view === 'import' && mayManage ? <WaveMonthImport onImported={applyFilters} /> : <>
      <form className={panel + ' grid items-end gap-3 sm:grid-cols-[1fr_1.5fr_1fr_auto]'} onSubmit={event => {
        event.preventDefault();
        applyFilters({ ...draft, currency: draft.currency.trim().toUpperCase() });
      }}>
        <label className="text-sm text-slate-300">Report year<input className={inputClass} type="number" required min={1900} max={2099} value={draft.year} onChange={event => setDraft({ ...draft, year: event.target.value })} /></label>
        <label className="text-sm text-slate-300">Compare period<select className={inputClass} value={draft.month} onChange={event => setDraft({ ...draft, month: event.target.value })}>
          <option value="0">Full calendar year</option>{months.map((month, index) => <option key={month} value={String(index + 1)}>{month}</option>)}
        </select></label>
        <label className="text-sm text-slate-300">Currency<input className={inputClass + ' uppercase'} required maxLength={3} pattern="[A-Za-z]{3}" value={draft.currency} onChange={event => setDraft({ ...draft, currency: event.target.value })} /></label>
        <button className={primary}>Compare periods</button>
      </form>
      {error && <Notice error>{error}</Notice>}
      {!error && !data && <Notice>Loading historical categories…</Notice>}
      {data && <>
        <CategoryComparison comparison={data.comparison} onSelectLedger={setLedger} />
        {ledger && <LedgerEntries key={ledger.account_key || 'all'} filters={filters} comparison={data.comparison}
          account={ledger.account_key ? ledger : null} mayManage={mayManage} onSelectAccount={setLedger}
          onCategorySaved={() => { setLedger(null); setRevision(value => value + 1); }} onClose={() => setLedger(null)} />}
        <ClaudeHistoryReport key={JSON.stringify(filters) + revision} filters={filters} mayViewInventory={data.mayViewInventory} />
      </>}
    </>}
  </div>;
}
