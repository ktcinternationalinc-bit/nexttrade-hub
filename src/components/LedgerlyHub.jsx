'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, BookOpen, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Database, ShieldCheck, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import RestrictedNotice from './RestrictedNotice';

var DATASETS = {
  summary: { label: 'Dashboard', note: 'Year-to-date performance.' },
  invoices: { label: 'Invoices', columns: ['number', 'contactName', 'date', 'dueDate', 'totalCents', 'outstandingCents', 'status'] },
  bills: { label: 'Bills', columns: ['number', 'contactName', 'date', 'dueDate', 'amountCents', 'outstandingCents', 'status'] },
  expenses: { label: 'Expenses', columns: ['payee', 'date', 'categoryId', 'amountCents', 'status'] },
  checks: { label: 'Checks', columns: ['number', 'payee', 'date', 'amountCents', 'status'] },
  contacts: { label: 'Contacts', columns: ['name', 'type', 'email', 'address'] },
  journal: { label: 'Journal', columns: ['date', 'description', 'sourceType', 'lines'] },
  'bank-accounts': { label: 'Bank accounts', columns: ['institutionName', 'name', 'mask', 'currency', 'currentBalanceCents', 'availableBalanceCents', 'lastSyncedAt', 'active', 'connectionStatus', 'environment'] },
  'bank-transactions': { label: 'Bank transactions', columns: ['date', 'description', 'accountName', 'amountCents', 'currency', 'pending', 'removed', 'changedSinceReview', 'status', 'environment'] },
};
var LABELS = {
  totalCents: 'Total', amountCents: 'Amount', outstandingCents: 'Outstanding', paidCents: 'Paid',
  currentBalanceCents: 'Bank balance', availableBalanceCents: 'Available', contactName: 'Customer / vendor',
  date: 'Date', dueDate: 'Due', categoryId: 'Category', accountName: 'Bank account', accountMask: 'Account ending',
  connectionStatus: 'Connection', institutionName: 'Bank', pending: 'Pending', environment: 'Environment',
  journalId: 'Matched journal entry', ledgerAccountId: 'Book account', lastSyncedAt: 'Bank snapshot fetched',
  changedSinceReview: 'Changed after review', removed: 'Removed by bank', mask: 'Account ending',
};
function label(key) { return LABELS[key] || key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/Cents$/, '').replace(/^./, function (s) { return s.toUpperCase(); }); }
function money(value, currency) {
  if (value === null || value === undefined) return 'Unavailable';
  if (!Number.isSafeInteger(value)) return '—';
  if (!currency) return (value / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' (currency unavailable)';
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value / 100); }
  catch (_) { return (value / 100).toFixed(2) + ' ' + currency; }
}
function timestamp(value) {
  if (!value) return 'Not yet';
  var d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Unavailable';
}
function display(value, key, row, currency, isBank) {
  if (key.endsWith('Cents')) return money(value, isBank ? row.currency : currency);
  if (key === 'lines' && Array.isArray(value)) return value.length + (value.length === 1 ? ' line' : ' lines');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value === null || value === undefined || value === '') return '—';
  if (key.endsWith('At')) return timestamp(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default function LedgerlyHub(props) {
  var mayView = props.canView === true;
  var [resource, setResource] = useState('summary');
  var [offset, setOffset] = useState(0);
  var [data, setData] = useState(null);
  var [loading, setLoading] = useState(true);
  var [error, setError] = useState('');
  var [detail, setDetail] = useState(null);
  var revision = useRef(null);
  var lastSnapshotTime = useRef(null);
  var lastBalanceAccess = useRef(false);

  useEffect(function () {
    if (!mayView) { setData(null); setDetail(null); lastBalanceAccess.current = false; setLoading(false); return; }
    var stopped = false, inFlight = false, controller = null, authEpoch = 0, signedOut = false;
    async function load() {
      if (stopped || signedOut || inFlight || document.visibilityState === 'hidden') return;
      var loadEpoch = authEpoch;
      inFlight = true; controller = new AbortController();
      var timer = setTimeout(function () { controller?.abort(); }, 15000);
      try {
        var sessionResult = await supabase.auth.getSession();
        var token = sessionResult?.data?.session?.access_token;
        if (stopped || loadEpoch !== authEpoch) return;
        if (!token) { if (!stopped) { setData(null); setDetail(null); revision.current = null; lastSnapshotTime.current = null; setError('Sign in to view your connected accounting data.'); } return; }
        var query = new URLSearchParams({ resource: resource, offset: String(offset), limit: '50' });
        if (offset > 0 && revision.current !== null) query.set('revision', String(revision.current));
        var response = await fetch('/api/ledgerly/data?' + query, { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store', signal: controller.signal });
        if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The automatic data view is temporarily unavailable. It will retry automatically.');
        var body = await response.json();
        if (stopped || loadEpoch !== authEpoch) return;
        if (response.status === 409 && body.code === 'snapshot_changed') { revision.current = null; setOffset(0); setDetail(null); return; }
        if ((response.status === 400 || body.code === 'bank_balances_required' || body.code === 'dataset_permission') && Array.isArray(body.resources) && body.resources.length && body.resources[0] !== resource) {
          setResource(body.resources[0]); setOffset(0); setData(null); setDetail(null); lastBalanceAccess.current = false; return;
        }
        if (!response.ok) {
          if (response.status === 401 || response.status === 403 || body.code === 'viewer_auth') { setData(null); setDetail(null); revision.current = null; lastSnapshotTime.current = null; }
          throw new Error(body.error || 'The automatic data view is temporarily unavailable.');
        }
        if ((lastSnapshotTime.current && lastSnapshotTime.current !== body.snapshot?.fetchedAt) || lastBalanceAccess.current !== (body.capabilities?.canViewBankBalances === true)) setDetail(null);
        lastBalanceAccess.current = body.capabilities?.canViewBankBalances === true;
        lastSnapshotTime.current = body.snapshot?.fetchedAt || null;
        revision.current = body.snapshot?.revision ?? null;
        setData(body); setError('');
      } catch (e) {
        if (!stopped && loadEpoch === authEpoch) {
          // A failed permission recheck must never leave an old privileged card
          // or detail modal visible. The last good server snapshot is retained.
          setData(null); setDetail(null); lastBalanceAccess.current = false;
          setError(e?.name === 'AbortError' ? 'The connection is taking longer than expected. This view will retry automatically.' : e.message || 'The data view will retry automatically.');
        }
      } finally {
        clearTimeout(timer); inFlight = false;
        if (!stopped && loadEpoch === authEpoch) setLoading(false);
      }
    }
    void load();
    var interval = setInterval(function () { void load(); }, 60000);
    var focus = function () { void load(); };
    var accessChanged = function () {
      setData(null); setDetail(null); lastBalanceAccess.current = false;
      authEpoch += 1; controller?.abort();
      setTimeout(function () { if (!stopped) void load(); }, 0);
    };
    window.addEventListener('focus', focus);
    window.addEventListener('bank-visibility-changed', accessChanged);
    document.addEventListener('visibilitychange', focus);
    var authListener = supabase.auth.onAuthStateChange(function (event) {
      if (event === 'SIGNED_OUT') { signedOut = true; authEpoch += 1; controller?.abort(); setData(null); setDetail(null); lastBalanceAccess.current = false; revision.current = null; lastSnapshotTime.current = null; setLoading(false); setError('Sign in to view your connected accounting data.'); }
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') { signedOut = false; accessChanged(); }
    });
    return function () {
      stopped = true; controller?.abort(); clearInterval(interval);
      window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus);
      window.removeEventListener('bank-visibility-changed', accessChanged);
      authListener.data.subscription.unsubscribe();
    };
  }, [resource, offset, mayView]);

  useEffect(function () {
    if (!detail) return;
    var close = function (event) { if (event.key === 'Escape') setDetail(null); };
    document.addEventListener('keydown', close);
    return function () { document.removeEventListener('keydown', close); };
  }, [detail]);

  if (!mayView) return <div className="p-4"><RestrictedNotice title="Ledgerly access" message="This shared source requires Full dashboard access or Banking information access." /></div>;
  var status = data?.status;
  var available = status?.available === true;
  var selected = DATASETS[resource] || { label: resource, columns: [] };
  var canViewBankBalances = data?.capabilities?.canViewBankBalances === true;
  var columns = (selected.columns || []).filter(function (key) {
    if (!canViewBankBalances && ['currentBalanceCents', 'availableBalanceCents'].includes(key)) return false;
    return resource !== 'bank-transactions' || key !== 'amountCents' || data?.capabilities?.canViewBankTransactionAmounts === true;
  });
  var set = data?.dataset;
  var isBank = resource.startsWith('bank-');
  var rows = Array.isArray(set?.data) ? set.data : [];
  var baseCurrency = data?.snapshot?.currency;
  var stateLabel = !data ? 'Checking connection' : !data.configured ? 'Setup required' : !available ? 'Awaiting first sync' : status.stale ? 'Snapshot is stale' : status.state === 'error' ? 'Last sync needs attention' : status.state === 'running' ? 'Updating automatically' : 'Automatic sync';
  var cards = [
    ['revenueCents', 'Revenue'], ['expenseCents', 'Expenses'], ['netProfitCents', 'Net profit'], ['cashCents', 'Cash in the books'],
    ['receivablesCents', 'Accounts receivable'], ['payablesCents', 'Accounts payable'], ['salesTaxPayableCents', 'Recorded invoice tax'], ['planningReserveCents', 'Planning reserve'],
  ].filter(function (card) { return card[0] !== 'cashCents' || canViewBankBalances; });
  function selectResource(value) { setResource(value); setOffset(0); setData(null); setDetail(null); setLoading(true); revision.current = null; }

  return <div className="p-4 md:p-6 space-y-5 text-slate-200">
    <section className="rounded-xl border border-emerald-900 bg-gradient-to-br from-slate-900 to-emerald-950 p-5 md:p-6">
      <div className="flex flex-wrap gap-4 items-start justify-between">
        <div className="flex gap-3 items-start"><span className="rounded-xl bg-emerald-400/10 border border-emerald-500/20 text-emerald-300 p-3"><BookOpen size={24} /></span><div><div className="text-[10px] font-bold tracking-widest text-emerald-300 uppercase">Ledgerly → KTC hub</div><h2 className="text-xl md:text-2xl font-bold text-white mt-1">Your books, automatically in view.</h2><p className="text-sm text-slate-300 mt-2 max-w-2xl">Financial totals, invoices, and bank activity arrive through a scheduled connection. This view keeps itself up to date.</p></div></div>
        <span className={'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ' + (available && !status.stale && status.state !== 'error' ? 'text-emerald-200 border-emerald-600/40 bg-emerald-950' : 'text-amber-200 border-amber-700/50 bg-slate-900')}><Clock3 size={14} />{stateLabel}</span>
      </div>
      <div className="mt-5 pt-4 border-t border-emerald-800/40 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-300">
        <span><strong className="font-medium text-slate-400">Last successful pull</strong> · {timestamp(status?.lastSuccessAt)}</span>
        <span><strong className="font-medium text-slate-400">Scheduled interval</strong> · 15 minutes</span>
        <span className="inline-flex gap-1.5 items-center"><ShieldCheck size={14} className="text-emerald-400" />Read-only source</span>
        {data?.sourceOrigin && <a className="ml-auto inline-flex items-center gap-1 text-emerald-300 hover:text-emerald-100" href={data.sourceOrigin} target="_blank" rel="noopener noreferrer">Open Ledgerly <ArrowUpRight size={14} /></a>}
      </div>
    </section>

    {error && <div role="alert" className="rounded-lg border border-red-700/50 bg-red-950/30 p-4 text-sm text-red-200">{error}{available && <p className="text-xs mt-2 text-slate-300">Showing the last complete snapshot from {timestamp(status.lastSuccessAt)}.</p>}</div>}
    {data && !data.configured && <div className="rounded-xl border border-amber-700/50 bg-slate-900 p-6"><h3 className="font-bold text-amber-200">The automatic connection needs setup.</h3><p className="text-sm text-slate-300 mt-2">The source connection, storage, and scheduled job must be activated on the hub’s server. After activation, data arrives without importing files or pressing refresh.</p><p className="text-xs text-slate-400 mt-3">The integration setup guide includes the deployment steps and required server settings.</p></div>}
    {data?.configured && !available && <div role="status" className="rounded-xl border border-slate-700 bg-slate-900 p-6 text-center"><Database size={30} className="mx-auto text-emerald-300 mb-3" /><h3 className="font-semibold text-white">Waiting for the first complete snapshot.</h3><p className="text-sm text-slate-300 mt-2">This page will display the data automatically after the scheduled connection succeeds.</p>{status.error && <p className="text-sm text-amber-200 mt-3">{status.error}</p>}<p className="text-xs text-slate-400 mt-3">Last attempt: {timestamp(status.lastAttemptAt)}</p></div>}
    {available && (status.stale || status.error) && <div role="status" className="rounded-lg border border-amber-700/50 bg-amber-950/20 p-4 text-sm text-amber-200">{status.error || 'A fresh snapshot has not arrived within 30 minutes.'}<p className="text-xs text-slate-300 mt-2">The last complete snapshot is preserved. New data appears automatically when the connection recovers.</p></div>}

    {available && <>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3" aria-label="Ledgerly datasets">
        {data.resources.map(function (name) { return <button key={name} onClick={function () { selectResource(name); }} className={'rounded-md px-3 py-2 text-xs font-semibold ' + (resource === name ? 'bg-emerald-700 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700')}>{DATASETS[name]?.label || name}</button>; })}
        <span className="ml-auto text-xs text-slate-400">Source revision {data.snapshot.revision}</span>
      </div>
      {resource === 'summary' && set?.data && <>
        <div className="flex items-center justify-between flex-wrap gap-2"><h3 className="text-base font-semibold text-white">Year-to-date overview</h3><span className="text-xs text-slate-400">{set.period.from} through {set.period.to} · {baseCurrency}</span></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {cards.map(function (card) { return <div key={card[0]} className="bg-slate-900 border border-slate-700/70 rounded-xl p-4"><p className="text-xs text-slate-400">{card[1]}</p><p className="text-xl font-bold text-white mt-3 tabular-nums">{money(set.data[card[0]], baseCurrency)}</p><p className="text-[10px] text-slate-500 mt-2">{['revenueCents', 'expenseCents', 'netProfitCents'].includes(card[0]) ? 'Accrual performance for the period' : card[0] === 'planningReserveCents' ? 'Planning estimate, not a tax return' : 'Closing ledger balance'}</p></div>; })}
        </div>
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm"><span>{set.data.openInvoiceCount} open invoices</span><span>{set.data.overdueInvoiceCount} overdue invoices</span><span className={'ml-auto inline-flex items-center gap-1.5 text-xs ' + (set.data.balanced ? 'text-emerald-300' : 'text-red-300')}><CheckCircle2 size={15} />{set.data.balanced ? 'Journal balances' : 'Journal needs review'}</span></div>
        <p className="text-xs leading-6 text-slate-400">{canViewBankBalances ? 'Cash is the balance recorded in Ledgerly. Bank balances appear with bank accounts. ' : 'Bank balances and cash totals require a separate permission. '}Invoice counts reflect current document status. Recorded invoice tax and the planning reserve do not determine a tax filing or initiate a payment.</p>
      </>}
      {resource !== 'summary' && <section className="bg-slate-900 border border-slate-700/70 rounded-xl overflow-hidden">
        <div className="px-4 py-4 border-b border-slate-800"><h3 className="font-semibold text-white">{selected.label}</h3><p className="text-xs text-slate-400 mt-1">{set?.total || 0} records in the complete snapshot. {resource === 'bank-accounts' ? (canViewBankBalances ? 'Latest cached bank snapshots; missing balances remain unavailable.' : 'Account names and masked numbers remain available for reconciliation. Balances require a separate permission.') : resource === 'bank-transactions' ? 'Positive amounts are money in. Pending and removed rows are explicit; sandbox rows are test data.' : resource === 'contacts' ? 'Current contact directory.' : 'All recorded dates; statuses and balances are current as of the snapshot.'}</p></div>
        {rows.length ? <div className="overflow-x-auto"><table className="w-full text-xs text-left"><thead className="bg-slate-950/50 text-slate-400"><tr>{columns.map(function (key) { return <th key={key} className="px-4 py-3 font-medium whitespace-nowrap">{label(key)}</th>; })}<th className="px-4 py-3"><span className="sr-only">Details</span></th></tr></thead><tbody className="divide-y divide-slate-800">{rows.map(function (row) { return <tr key={row.id} className="hover:bg-slate-800/50">{columns.map(function (key) { return <td key={key} className={'px-4 py-3 max-w-xs ' + (key.endsWith('Cents') ? 'tabular-nums whitespace-nowrap' : '')}><span className={key === 'environment' && row[key] === 'sandbox' ? 'rounded px-2 py-1 bg-amber-900/40 text-amber-200' : key === 'description' || key === 'address' ? 'line-clamp-2' : ''}>{display(row[key], key, row, baseCurrency, isBank)}</span></td>; })}<td className="px-4 py-3"><button className="text-emerald-300 hover:text-emerald-100 whitespace-nowrap" onClick={function () { setDetail(row); }}>View details</button></td></tr>; })}</tbody></table></div> : <div className="p-10 text-center text-sm text-slate-400">There are no records in this dataset yet. New records will appear after a successful scheduled pull.</div>}
        <div className="px-4 py-3 border-t border-slate-800 flex items-center justify-between gap-3 text-xs text-slate-400"><span>{rows.length ? offset + 1 : 0}–{offset + rows.length} of {set?.total || 0}</span><div className="flex gap-2"><button disabled={!offset} className="inline-flex items-center gap-1 border border-slate-700 rounded px-3 py-1.5 disabled:opacity-30" onClick={function () { setOffset(Math.max(0, offset - 50)); }}><ChevronLeft size={14} />Previous</button><button disabled={set?.nextOffset == null} className="inline-flex items-center gap-1 border border-slate-700 rounded px-3 py-1.5 disabled:opacity-30" onClick={function () { setOffset(set.nextOffset); }}>Next<ChevronRight size={14} /></button></div></div>
      </section>}
      <p className="text-[11px] text-slate-500 flex items-center gap-2"><ShieldCheck size={13} />Ledgerly records are a separate source. Viewing them does not create duplicate KTC invoices, bank transactions, or payments.</p>
    </>}
    {loading && !data && <div role="status" className="p-8 text-center text-sm text-slate-400">Loading the latest saved accounting snapshot…</div>}

    {detail && <div role="dialog" aria-modal="true" aria-label="Ledgerly record details" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={function (e) { if (e.target === e.currentTarget) setDetail(null); }}><section className="w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-xl border border-slate-600 bg-slate-900 p-5"><div className="flex justify-between items-start gap-3 mb-5"><div><h3 className="text-lg font-semibold text-white">{detail.number || detail.name || detail.description || 'Record details'}</h3><p className="text-xs text-slate-400 mt-1">Read-only Ledgerly snapshot · {timestamp(status.lastSuccessAt)}</p></div><button aria-label="Close record details" className="p-2 hover:bg-slate-800 rounded" onClick={function () { setDetail(null); }}><X size={20} /></button></div><dl className="grid sm:grid-cols-2 gap-4">{Object.keys(detail).filter(function (key) { return key !== 'lines'; }).map(function (key) { return <div key={key} className={key === 'memo' || key === 'description' || key === 'address' ? 'sm:col-span-2' : ''}><dt className="text-[11px] text-slate-400">{label(key)}</dt><dd className="text-sm mt-1 break-words text-slate-200">{display(detail[key], key, detail, baseCurrency, isBank)}</dd></div>; })}</dl>{Array.isArray(detail.lines) && <div className="mt-5 border-t border-slate-700 pt-4"><h4 className="font-semibold text-sm mb-3">Line items</h4><div className="space-y-3">{detail.lines.map(function (line, index) { return <div key={index} className="rounded-lg bg-slate-800 p-3 text-xs"><div className="font-medium text-slate-100">{line.description || 'Account ' + line.accountId}</div>{resource === 'invoices' ? <div className="text-slate-300 mt-2">Quantity {line.quantity} · Unit price {money(line.unitPriceCents, baseCurrency)} · {line.taxable ? 'Taxable' : 'Not taxable'}</div> : <div className="text-slate-300 mt-2">Debit {money(line.debit, baseCurrency)} · Credit {money(line.credit, baseCurrency)}</div>}</div>; })}</div></div>}</section></div>}
  </div>;
}
