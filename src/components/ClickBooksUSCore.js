'use client';
import { createElement as h, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

// Read-only P1/P2 inspection screen. Existing invoicing, Wave and bank flows are untouched.
export default function ClickBooksUSCore(props) {
  var [data, setData] = useState(null), [error, setError] = useState(''), [filter, setFilter] = useState('');
  var mayView = props.canView === true;
  useEffect(function () {
    setData(null);
    if (!mayView) return;
    var stopped = false, signedOut = false, inFlight = false, epoch = 0, controller;
    async function load() {
      if (stopped || signedOut || inFlight || document.visibilityState === 'hidden') return;
      inFlight = true;
      var requestEpoch = epoch;
      controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); }, 15000);
      try {
        var session = await supabase.auth.getSession();
        var token = session?.data?.session?.access_token;
        if (!token) throw new Error('Sign in to verify financial permissions.');
        var response = await fetch('/api/accounting/clickbooks-us', { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store', signal: controller.signal });
        if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The ClickBooks preview is not available on this deployment.');
        var body = await response.json();
        if (!response.ok || body.ok !== true) throw new Error(body.error || 'The US accounting preview could not be loaded.');
        if (!stopped && requestEpoch === epoch) { setData(body.data); setError(''); }
      } catch (e) {
        if (!stopped && requestEpoch === epoch) { setData(null); setError(e?.name === 'AbortError' ? 'The read timed out; no financial data is displayed.' : e.message); }
      } finally { clearTimeout(timer); inFlight = false; }
    }
    function invalidate() { epoch += 1; controller?.abort(); setData(null); setTimeout(function () { void load(); }, 0); }
    var auth = supabase.auth.onAuthStateChange(function (event) {
      if (event === 'SIGNED_OUT') { signedOut = true; invalidate(); setError('Sign in to view ClickBooks.'); }
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') { signedOut = false; invalidate(); }
    });
    var refresh = function () { void load(); };
    void load();
    var interval = setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    window.addEventListener('bank-visibility-changed', invalidate);
    document.addEventListener('visibilitychange', refresh);
    return function () { stopped = true; epoch += 1; controller?.abort(); clearInterval(interval); auth.data.subscription.unsubscribe(); window.removeEventListener('focus', refresh); window.removeEventListener('bank-visibility-changed', invalidate); document.removeEventListener('visibilitychange', refresh); };
  }, [mayView]);
  if (!mayView) return h('p', { className: 'p-5 text-slate-300' }, 'Full dashboard permission is required.');
  var panel = 'rounded-xl border border-slate-700 bg-slate-900 p-5';
  if (!data) return h('section', { className: panel, role: error ? 'alert' : 'status' }, h('h2', { className: 'font-bold text-white' }, 'ClickBooks - US Accounting'), h('p', { className: 'mt-3 text-slate-300' }, error || 'Verifying access and loading the saved audit...'));
  var rows = data.accounts.filter(function (a) { return (a.name + ' ' + a.code + ' ' + a.type).toLowerCase().includes(filter.toLowerCase()); });
  var counts = data.audit?.counts || {};
  var labels = { usd_invoices: 'USD invoices', customers: 'Accounting customers', active_payment_rows: 'Active payment records', bank_rows: 'Bank transactions' };
  var checks = data.audit?.checks || {};
  var checkLabels = {
    invoice_arithmetic_mismatches: 'Invoice arithmetic mismatches', missing_invoice_items: 'USD invoices missing line items',
    payment_missing_us_invoice: 'Payments without a matching US invoice', historical_paid_without_local_payment_rows: 'Wave-paid invoices without local payment detail',
    unreviewed_bank_rows: 'Unreviewed bank transactions', bank_missing_legacy_business_uuid: 'Legacy business IDs absent (exact Wave silo used instead)',
    bank_missing_wave_account_mapping: 'Bank rows without a Wave account mapping', duplicate_wave_invoice_ids: 'Duplicate Wave invoice IDs',
    duplicate_bank_source_ids: 'Duplicate bank source IDs', payment_missing_us_bank_row: 'Payments without a matching US bank row',
  };
  return h('div', { className: 'p-4 space-y-5 text-slate-200' },
    h('section', { className: panel },
      h('p', { className: 'text-xs font-bold uppercase tracking-widest text-emerald-300' }, 'KTC US / USD / Accounting only'),
      h('h2', { className: 'text-2xl font-bold text-white mt-2' }, 'ClickBooks accounting foundation'),
      h('p', { className: 'mt-2 text-sm text-slate-300' }, 'Source audit, chart of accounts and protected double-entry ledger. This screen is fixed to the approved US business; it does not use the Egyptian Sales or Treasury data.'),
      h('div', { className: 'mt-4 rounded-lg border border-amber-700 p-3 text-sm text-amber-200' },
        data.book.historyReady ? 'Historical data is marked ready. Verify the accounting close before using reports for filing.' : 'Historical transactions have NOT been migrated. This is a foundation preview, not a completed P&L, bank reconciliation or tax return.'),
      h('p', { className: 'text-sm mt-3' }, 'Posting: ' + (data.book.postingEnabled ? 'Enabled at the database level; this screen remains read-only.' : 'Locked - no new live postings.')),
      h('p', { className: 'text-xs mt-2 text-slate-400' }, 'Saved audit: ' + (data.audit?.checked_at || 'Not captured') + '. The screen refreshes the saved view every 60 seconds.')),
    h('section', { className: 'grid grid-cols-2 lg:grid-cols-4 gap-3' }, Object.entries(labels).filter(function (entry) { return counts[entry[0]] !== undefined; }).map(function (entry) {
      return h('div', { key: entry[0], className: panel }, h('p', { className: 'text-xs text-slate-400' }, entry[1]), h('p', { className: 'text-2xl font-bold mt-2' }, String(counts[entry[0]])));
    })),
    h('section', { className: panel }, h('h3', { className: 'font-bold text-white' }, 'Migration review items'),
      h('p', { className: 'text-sm text-slate-400 mt-2' }, String(counts.foreign_currency_invoices || 0) + ' non-USD invoices are excluded from USD posting pending review. Currency alone never determines the subsidiary.'),
      h('div', { className: 'mt-3 space-y-2' }, Object.entries(checkLabels).filter(function (e) { return Number(checks[e[0]]) > 0; }).map(function (e) {
        return h('p', { key: e[0], className: 'text-sm' }, e[1] + ': ' + checks[e[0]]);
      }))),
    h('section', { className: panel }, h('div', { className: 'flex flex-wrap justify-between items-center gap-3' },
      h('h3', { className: 'font-bold text-white' }, 'Chart of accounts - ' + data.accounts.length + ' visible accounts'),
      h('input', { 'aria-label': 'Filter chart of accounts', value: filter, onChange: function (e) { setFilter(e.target.value); }, placeholder: 'Filter account name or type', className: 'rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm' })),
      !data.bankingIncluded && h('p', { className: 'text-xs text-amber-200 mt-3' }, 'Bank-sensitive accounts and the full trial balance are withheld by your separate banking permission.'),
      h('div', { className: 'overflow-x-auto mt-4' }, h('table', { className: 'w-full text-sm text-left' },
        h('thead', {}, h('tr', {}, ['Account', 'Type', 'Normal side', 'Review'].map(function (x) { return h('th', { key: x, className: 'pb-3 border-b border-slate-700' }, x); }))),
        h('tbody', {}, rows.map(function (a) { return h('tr', { key: a.id },
          h('td', { className: 'py-2 pr-3 border-b border-slate-800', title: a.code }, a.name),
          h('td', { className: 'py-2 pr-3' }, a.type + (a.contra ? ' (contra)' : '')),
          h('td', { className: 'py-2 pr-3' }, a.normalSide),
          h('td', { className: 'py-2' }, !a.active ? 'Inactive' : a.needsReview ? 'Review required' : 'Control account')); }))))),
    h('section', { className: panel }, h('h3', { className: 'font-bold text-white' }, 'Ledger verification'),
      h('p', { className: 'text-sm mt-2 text-slate-300' }, data.book.hasPostedEntries ? 'Posted entries exist. The backend trial balance is available only with banking permission. Full report screens are a later phase.' : 'No live journal entries are posted. Test fixtures were rolled back; no zero-dollar financial report is being represented as migrated books.')));
}
