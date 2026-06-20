'use client';
// v55.83-BV — Customer AR Ledger / Customer Statement.
// Select one customer -> every invoice, payment and balance, plus a running
// statement, print and CSV. AR eligibility uses the SHARED isArEligible rule
// (Unsent/SAVED COUNTS; only true Draft + void/cancelled/archived/deleted are
// excluded). Currencies are kept strictly separate (no cross-currency sums).
// Credits/deductions tables do not exist yet -> shown as 0 with an honest note.
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import RestrictedNotice from './RestrictedNotice';
import { fetchAllRows } from '../lib/fetch-all-rows';
import { isArEligible } from '../lib/ar-eligibility';
import { canViewCustomerAr, canViewInvoices } from '../lib/bank-permissions';
import { getActiveWaveBusiness, setActiveWaveBusiness, scopeIfRegistered, canWriteToWaveBusiness } from '../lib/wave-business';
import { isPaymentVoid as isPaymentVoidCanonical } from '../lib/payment-matching';
import { floorDateFor, labelForWindow } from '../lib/visibility-window';

function num(v) { var n = Number(String(v == null ? 0 : v).replace(/,/g, '')); return isNaN(n) ? 0 : n; }
function money(v, cur) { return (cur || 'USD') + ' ' + num(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
// v55.83-IM (QA fix) — the local check ignored sync_status, so a payment reversed only via
// sync_status (void/voided/cancelled/reversed/deleted — what import/push treat as void) was counted
// as LIVE here while the dashboard/BankReview excluded it. Delegate to the canonical helper (adds
// sync_status) and keep the legacy field checks so nothing that was excluded before regresses.
function isPaymentVoid(p) { return isPaymentVoidCanonical(p) || (p && (p.is_void === true || p.void === true || p.status === 'void')); }
function isDraftInv(inv) { return inv && inv.wave_status === 'DRAFT'; }
function isDeadInv(inv) { var rs = inv && inv.record_status; return rs === 'void' || rs === 'cancelled' || rs === 'archived' || rs === 'deleted'; }
function statusLabel(inv) {
  if (isDeadInv(inv)) return (inv.record_status || '').toUpperCase();
  if (inv.wave_status) return inv.wave_status;
  if (inv.approval_status) return inv.approval_status;
  return 'UNKNOWN';
}
function todayStr() { return new Date().toISOString().slice(0, 10); }

export default function CustomerLedger(props) {
  var userProfile = props.userProfile;
  var modulePerms = props.modulePerms || {};
  var isSuperAdmin = props.isSuperAdmin === true;
  // v55.83-IN (Codex FAIL) — these helpers are (isSuperAdmin, mp[, role]); the old call passed
  // userProfile as isSuperAdmin and NOTHING as role, so the admin/owner role fallback never fired
  // and a legit admin/owner without explicit invoice/AR grants was wrongly blocked from this tab.
  var role = userProfile && userProfile.role;
  var allowed = isSuperAdmin || canViewCustomerAr(isSuperAdmin, modulePerms) || canViewInvoices(isSuperAdmin, modulePerms, role);

  var [loading, setLoading] = useState(true);
  var [customers, setCustomers] = useState([]);
  var [invoices, setInvoices] = useState([]);
  var [payments, setPayments] = useState([]);
  var [registry, setRegistry] = useState([]);
  var [activeBiz, setActiveBiz] = useState(getActiveWaveBusiness());
  var [search, setSearch] = useState('');
  var [selectedId, setSelectedId] = useState('');
  var [currency, setCurrency] = useState('');
  var [statusFilter, setStatusFilter] = useState('all');   // all | open | paid | overdue
  var [sourceFilter, setSourceFilter] = useState('all');    // all | wave | hub
  var [pendingSyncOnly, setPendingSyncOnly] = useState(false);
  var [fromDate, setFromDate] = useState('');
  var [toDate, setToDate] = useState('');
  var [expanded, setExpanded] = useState({});
  var [err, setErr] = useState('');
  // v55.83-JP — admin history-visibility window. AR/ledger keep ALL-TIME balances (loaded in full);
  // the floor only limits which EVENTS are DISPLAYED (so aging/running balance stays correct).
  var [visCfg, setVisCfg] = useState({ window: 'all', customDays: null, customFrom: null });
  var ledgerFloor = floorDateFor({ window: visCfg.window, customDays: visCfg.customDays, customFrom: visCfg.customFrom, isSuperAdmin: isSuperAdmin }, new Date());

  var load = useCallback(function () {
    setLoading(true); setErr('');
    fetch('/api/admin/visibility').then(function (x) { return x.json(); }).then(function (j) { if (j && j.value) { setVisCfg(j.value); } }).catch(function () {});
    function safe(p) { return p.then(function (r) { return r && r.data ? r.data : []; }).catch(function (e) { return []; }); }
    Promise.all([
      safe(fetchAllRows('accounting_customers', '*', 'company_name', true)),
      safe(fetchAllRows('accounting_invoices', '*')),
      safe(fetchAllRows('accounting_invoice_payments', '*')),
      safe(fetchAllRows('wave_business_registry', '*')),
    ]).then(function (res) {
      setCustomers(res[0] || []);
      setInvoices(res[1] || []);
      setPayments(res[2] || []);
      var reg = res[3] || [];
      setRegistry(reg);
      // Default to the production business if nothing chosen yet.
      if (!getActiveWaveBusiness() && reg.length) {
        var prod = null; reg.forEach(function (b) { if (!prod && b.is_production !== false) prod = b; });
        var pick = (prod || reg[0]).wave_business_id;
        setActiveBiz(pick); setActiveWaveBusiness(pick);
      }
      setLoading(false);
    }).catch(function (e) { setErr('Could not load accounting data.'); setLoading(false); });
  }, []);
  useEffect(function () { if (allowed) load(); else setLoading(false); }, [load, allowed]);

  // payments indexed by invoice id (non-void)
  var payByInv = useMemo(function () {
    var m = {};
    payments.forEach(function (p) {
      if (isPaymentVoid(p)) return;
      var k = p.accounting_invoice_id;
      if (!k) return;
      if (!m[k]) m[k] = [];
      m[k].push(p);
    });
    return m;
  }, [payments]);
  function hubPaid(invId) { var a = payByInv[invId] || []; var s = 0; a.forEach(function (p) { s += num(p.amount); }); return s; }
  function invBalance(inv) { return num(inv.total_amount) - num(inv.wave_imported_paid) - hubPaid(inv.id); }

  var custInvoices = useMemo(function () {
    if (!selectedId) return [];
    // v55.83-KC (Codex/Max — "AL MOUSTAFA 98 vs 53") — Wave-imported invoices link by wave_customer_id,
    // not accounting_customer_id; match both so the customer's count isn't undercounted.
    var selCust = null; customers.forEach(function (c) { if (c.id === selectedId) selCust = c; });
    var wcid = selCust && selCust.wave_customer_id ? selCust.wave_customer_id : null;
    var mine = invoices.filter(function (i) { return i.accounting_customer_id === selectedId || (wcid && i.wave_customer_id && i.wave_customer_id === wcid); });
    // Wall off other Wave businesses (test vs real KTC). Untagged legacy rows
    // stay visible under the active business until backfill completes.
    return scopeIfRegistered(mine, activeBiz, registry, true);
  }, [invoices, selectedId, activeBiz, customers]);

  // currencies present for this customer
  var currencies = useMemo(function () {
    var set = {};
    custInvoices.forEach(function (i) { set[(i.currency || 'USD')] = true; });
    return Object.keys(set);
  }, [custInvoices]);
  useEffect(function () {
    if (currencies.length && currencies.indexOf(currency) < 0) setCurrency(currencies[0]);
  }, [currencies, currency]);

  var selectedCustomer = useMemo(function () {
    var c = null; customers.forEach(function (x) { if (x.id === selectedId) c = x; }); return c;
  }, [customers, selectedId]);

  // v55.83-IW (Codex P0) — the customer picker must be SILO-SCOPED. Show only customers explicitly
  // assigned to the active Wave business, plus legacy/untagged customers that have invoices/payments
  // in this silo. Exclude customers explicitly assigned to a DIFFERENT silo (no cross-silo bleed).
  var scopedCustomers = useMemo(function () {
    if (!activeBiz || activeBiz === 'all') { return customers; }
    var keep = {};
    customers.forEach(function (c) { if (c.wave_business_id === activeBiz) { keep[c.id] = c; } });
    var actIds = {};
    invoices.forEach(function (i) { if (i.accounting_customer_id && i.wave_business_id === activeBiz) { actIds[i.accounting_customer_id] = true; } });
    payments.forEach(function (p) { if (p.accounting_customer_id && p.wave_business_id === activeBiz) { actIds[p.accounting_customer_id] = true; } });
    customers.forEach(function (c) {
      if (keep[c.id]) { return; }
      if (c.wave_business_id && c.wave_business_id !== activeBiz) { return; } // assigned elsewhere → never show here
      if (actIds[c.id]) { keep[c.id] = c; } // legacy/untagged but has activity in THIS silo
    });
    return Object.keys(keep).map(function (k) { return keep[k]; });
  }, [customers, invoices, payments, activeBiz]);

  // Clear a selected customer that isn't in the active silo's scope (e.g. after switching silo).
  useEffect(function () {
    if (selectedId && scopedCustomers.length && !scopedCustomers.some(function (c) { return c.id === selectedId; })) { setSelectedId(''); }
  }, [activeBiz, scopedCustomers, selectedId]);

  // invoices for the active currency
  var curInvoices = useMemo(function () {
    return custInvoices.filter(function (i) { return (i.currency || 'USD') === currency; });
  }, [custInvoices, currency]);

  // SUMMARY (current currency). AR-eligible only for AR totals; drafts separated.
  // v55.83-KB (Max, final call): EMPLOYEES see ONLY the permitted period in EVERY card, INCLUDING the
  // balance. Super-admin (ledgerFloor null) sees all-time. Everything is gated by the same window.
  var summary = useMemo(function () {
    var s = { invoiced: 0, waveePaid: 0, hubPaid: 0, balance: 0, openCount: 0, overdue: 0, draftValue: 0, draftCount: 0, windowed: !!ledgerFloor };
    var today = todayStr();
    curInvoices.forEach(function (i) {
      if (!isWithinWindow(i.invoice_date, ledgerFloor)) { return; } // employees: only the permitted period (every card)
      if (isDraftInv(i)) { s.draftValue += num(i.total_amount); s.draftCount += 1; return; }
      if (!isArEligible(i)) return; // dead (void/cancelled/archived/deleted) — excluded
      s.invoiced += num(i.total_amount);
      s.waveePaid += num(i.wave_imported_paid);
      s.hubPaid += hubPaid(i.id);
      var bal = invBalance(i);
      s.balance += bal;
      if (bal > 0.005) { s.openCount += 1; if (i.due_date && i.due_date < today) s.overdue += 1; }
    });
    return s;
  }, [curInvoices, payByInv, ledgerFloor]);

  // FILTERED invoice list (current currency)
  var listInvoices = useMemo(function () {
    var today = todayStr();
    return curInvoices.filter(function (i) {
      if (sourceFilter === 'wave' && !i.wave_invoice_id) return false;
      if (sourceFilter === 'hub' && i.wave_invoice_id) return false;
      if (fromDate && (i.invoice_date || '') < fromDate) return false;
      if (toDate && (i.invoice_date || '') > toDate) return false;
      var bal = invBalance(i);
      if (statusFilter === 'open' && !(isArEligible(i) && bal > 0.005)) return false;
      if (statusFilter === 'paid' && !(isArEligible(i) && bal <= 0.005)) return false;
      if (statusFilter === 'overdue' && !(isArEligible(i) && bal > 0.005 && i.due_date && i.due_date < today)) return false;
      return true;
    }).sort(function (a, b) { return (a.invoice_date || '') < (b.invoice_date || '') ? -1 : 1; });
  }, [curInvoices, statusFilter, sourceFilter, fromDate, toDate, payByInv]);

  // PAYMENT HISTORY (current currency invoices)
  var paymentHistory = useMemo(function () {
    var invIds = {}; curInvoices.forEach(function (i) { invIds[i.id] = i; });
    var rows = [];
    payments.forEach(function (p) {
      if (!invIds[p.accounting_invoice_id]) return;
      if (isPaymentVoid(p)) return;
      if (pendingSyncOnly && p.sync_status !== 'pending_wave_sync') return;
      rows.push({ p: p, inv: invIds[p.accounting_invoice_id] });
    });
    rows.sort(function (a, b) { return (a.p.payment_date || '') < (b.p.payment_date || '') ? -1 : 1; });
    return rows;
  }, [payments, curInvoices, pendingSyncOnly]);

  // RUNNING STATEMENT (current currency). Invoice total = Debit; wave-imported
  // paid + each hub payment = Credit. Running balance accumulates by date.
  var statement = useMemo(function () {
    var ev = [];
    curInvoices.forEach(function (i) {
      if (!isArEligible(i)) return; // statement reflects AR only
      ev.push({ date: i.invoice_date || '', type: 'Invoice', ref: i.invoice_number || ('#' + (i.id || '').slice(0, 6)), desc: statusLabel(i), debit: num(i.total_amount), credit: 0 });
      if (num(i.wave_imported_paid) > 0) ev.push({ date: i.invoice_date || '', type: 'Payment', ref: i.invoice_number || '', desc: 'Wave-imported paid', debit: 0, credit: num(i.wave_imported_paid) });
    });
    paymentHistory.forEach(function (row) {
      var p = row.p;
      var src = p.source === 'plaid_match' ? 'Bank match' : p.source === 'manual_payment' ? 'Manual payment' : (p.source || 'Payment');
      ev.push({ date: p.payment_date || '', type: 'Payment', ref: (row.inv && row.inv.invoice_number) || '', desc: src + (p.notes ? ' — ' + p.notes : ''), debit: 0, credit: num(p.amount) });
    });
    ev.sort(function (a, b) { return (a.date || '') < (b.date || '') ? -1 : 1; });
    var run = 0;
    ev.forEach(function (e) { run += e.debit - e.credit; e.running = run; });
    return ev;
  }, [curInvoices, paymentHistory]);

  // v55.83-KB — for an employee with a window, show ONLY the permitted period AND a running balance that
  // is computed over that period (not the all-time cumulative), so the statement is self-consistent with
  // the windowed totals above. Super-admin (ledgerFloor null) sees the full all-time statement unchanged.
  var displayStatement = useMemo(function () {
    if (!ledgerFloor) { return statement; }
    var win = statement.filter(function (e) { return (e.date || '') >= ledgerFloor; });
    var run = 0;
    return win.map(function (e) { run += e.debit - e.credit; return Object.assign({}, e, { running: run }); });
  }, [statement, ledgerFloor]);

  function toggle(id) { setExpanded(function (p) { var n = Object.assign({}, p); n[id] = !n[id]; return n; }); }

  function exportCsv() {
    var lines = [];
    lines.push(['Date', 'Type', 'Reference', 'Description', 'Debit', 'Credit', 'Running Balance'].join(','));
    displayStatement.forEach(function (e) {
      function q(x) { return '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"'; }
      lines.push([q(e.date), q(e.type), q(e.ref), q(e.desc), e.debit ? e.debit.toFixed(2) : '', e.credit ? e.credit.toFixed(2) : '', e.running.toFixed(2)].join(','));
    });
    var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'statement_' + (selectedCustomer ? (selectedCustomer.company_name || 'customer') : 'customer') + '_' + currency + '.csv';
    a.click(); URL.revokeObjectURL(url);
  }

  function printStatement() {
    var c = selectedCustomer || {};
    var rows = displayStatement.map(function (e) {
      return '<tr><td>' + (e.date || '') + '</td><td>' + e.type + '</td><td>' + (e.ref || '') + '</td><td>' + (e.desc || '') + '</td><td style="text-align:right">' + (e.debit ? e.debit.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '') + '</td><td style="text-align:right">' + (e.credit ? e.credit.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '') + '</td><td style="text-align:right">' + e.running.toLocaleString('en-US', { minimumFractionDigits: 2 }) + '</td></tr>';
    }).join('');
    var html = '<html><head><title>Customer Statement</title><style>body{font-family:Arial,sans-serif;color:#0f172a;padding:24px}h1{margin:0}table{width:100%;border-collapse:collapse;margin-top:12px;font-size:12px}th,td{border:1px solid #cbd5e1;padding:4px 8px}th{background:#f1f5f9;text-align:left}.sum{margin-top:8px;font-size:13px}.r{text-align:right}</style></head><body>'
      + '<h1>KTC International — Customer Statement</h1>'
      + '<div style="font-size:13px;margin-top:6px"><b>' + (c.company_name || '') + '</b>' + (c.email ? '<br>' + c.email : '') + '</div>'
      + '<div class="sum">Currency: <b>' + currency + '</b> &nbsp; Statement date: ' + todayStr() + (fromDate || toDate ? ' &nbsp; Range: ' + (fromDate || '…') + ' to ' + (toDate || '…') : '') + '</div>'
      + '<table><thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Description</th><th class="r">Debit</th><th class="r">Credit</th><th class="r">Running Balance</th></tr></thead><tbody>' + rows + '</tbody></table>'
      + '<div class="sum" style="margin-top:12px"><b>Balance due: ' + money(summary.balance, currency) + '</b>'
      + (summary.draftCount ? ' &nbsp; (excludes ' + summary.draftCount + ' draft invoice(s) worth ' + money(summary.draftValue, currency) + ')' : '') + '</div>'
      + '</body></html>';
    var w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); w.focus(); w.print(); }
  }

  if (!allowed) {
    return <div className="p-6"><RestrictedNotice title="Restricted" message={'You don\'t have permission to view the Customer Ledger / AR. Ask a super admin to grant "Customer: View AR" (customer.view_ar) or "Invoice: View" (ACCT-004 / invoice.view) — admin/owner roles also have access.'} /></div>;
  }
  if (loading) return <div className="p-6 text-slate-400 text-sm">Loading customer accounting data…</div>;

  // v55.83-IW — search within the SILO-SCOPED list; show counts instead of a silent 40-row cap.
  var CAP = 50;
  var allScoped = scopedCustomers.filter(function (c) {
    if (!search) return true;
    var q = search.toLowerCase();
    return (String(c.company_name || '').toLowerCase().indexOf(q) >= 0) || (String(c.email || '').toLowerCase().indexOf(q) >= 0) || (String(c.name || '').toLowerCase().indexOf(q) >= 0);
  });
  var matches = allScoped.slice(0, CAP);
  var pickerCountLabel = 'Showing ' + matches.length + ' of ' + allScoped.length + ' ' + (activeBiz && activeBiz !== 'all' ? 'customers in this silo' : 'customers') + (allScoped.length > CAP ? ' — search to narrow' : '');

  function Card(p) { return (<div className={'rounded-lg p-3 ' + (p.bg || 'bg-slate-800')}><div className="text-[10px] font-bold uppercase tracking-wider opacity-80">{p.label}</div><div className="text-lg font-extrabold mt-0.5">{p.val}</div></div>); }

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-extrabold text-slate-100">📑 Customer AR Ledger / Statement</h2>
        {selectedId && (
          <div className="flex gap-1.5">
            <button onClick={printStatement} className="px-3 py-1.5 text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white rounded">🖨 Print Statement</button>
            <button onClick={exportCsv} className="px-3 py-1.5 text-xs font-bold bg-slate-700 hover:bg-slate-600 text-white rounded">⬇ Export CSV</button>
          </div>
        )}
      </div>
      {err && <div className="bg-red-100 text-red-950 rounded p-2 text-xs font-bold">{err}</div>}

      {registry.length > 0 && (
        <div className="bg-slate-900/60 border border-slate-700 rounded-lg p-2 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-bold text-slate-300">Wave business:</span>
          <select value={activeBiz} onChange={function (e) { setActiveBiz(e.target.value); setActiveWaveBusiness(e.target.value); }} className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-xs">
            {isSuperAdmin && <option value="all">All businesses</option>}
            {registry.map(function (b) { return <option key={b.wave_business_id} value={b.wave_business_id}>{b.label || b.wave_business_id}</option>; })}
          </select>
          {(function () {
            var reg = null; registry.forEach(function (b) { if (b.wave_business_id === activeBiz) reg = b; });
            if (reg && reg.is_production !== false) { return <span className="text-[11px] font-bold bg-emerald-100 text-emerald-950 rounded px-2 py-1">🔒 REAL KTC production — read-only{canWriteToWaveBusiness(reg) ? ' · writes ENABLED' : ''}</span>; }
            if (reg) { return <span className="text-[11px] font-bold bg-amber-100 text-amber-950 rounded px-2 py-1">🧪 Test business — writes allowed</span>; }
            if (activeBiz === 'all') { return <span className="text-[11px] font-bold bg-slate-700 text-slate-200 rounded px-2 py-1">Showing all businesses</span>; }
            return null;
          })()}
        </div>
      )}

      {/* Customer select */}
      <div className="bg-slate-900/60 border border-slate-700 rounded-lg p-3">
        <input value={search} onChange={function (e) { setSearch(e.target.value); }} placeholder="Search customer by name, company or email…" className="w-full px-3 py-2 rounded bg-slate-800 border border-slate-600 text-slate-100 text-sm" />
        <div className="mt-1 text-[10px] text-slate-400">{pickerCountLabel}{activeBiz && activeBiz !== 'all' ? '' : ' · all businesses'}</div>
        {(!selectedId || search) && (
          <div className="mt-2 max-h-48 overflow-y-auto flex flex-col gap-1">
            {matches.map(function (c) {
              return <button key={c.id} onClick={function () { setSelectedId(c.id); setSearch(''); setExpanded({}); }} className={'text-left px-3 py-1.5 rounded text-xs font-semibold ' + (c.id === selectedId ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700')}>{c.company_name || c.name || '(unnamed)'}{c.email ? <span className="opacity-60"> · {c.email}</span> : null}</button>;
            })}
            {matches.length === 0 && <div className="text-xs text-slate-500 px-2">No customers match.</div>}
          </div>
        )}
      </div>

      {!selectedId && <div className="text-slate-500 text-sm px-1">Select a customer above to load their full ledger.</div>}

      {selectedId && (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-base font-extrabold text-slate-100">{selectedCustomer ? (selectedCustomer.company_name || selectedCustomer.name) : ''}</div>
            {currencies.length > 1 && (
              <div className="flex gap-1 items-center">
                <span className="text-[11px] text-slate-400 font-bold">Currency:</span>
                {currencies.map(function (cu) { return <button key={cu} onClick={function () { setCurrency(cu); }} className={'px-2 py-1 text-[11px] rounded font-bold ' + (cu === currency ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300')}>{cu}</button>; })}
              </div>
            )}
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-slate-100">
            <Card label="Total invoiced (AR)" val={money(summary.invoiced, currency)} bg="bg-slate-800" />
            <Card label="Wave-imported paid" val={money(summary.waveePaid, currency)} bg="bg-slate-800" />
            <Card label="Hub / Plaid / manual paid" val={money(summary.hubPaid, currency)} bg="bg-slate-800" />
            <Card label="Total paid" val={money(summary.waveePaid + summary.hubPaid, currency)} bg="bg-emerald-100 text-emerald-950" />
            <Card label="Balance due" val={money(summary.balance, currency)} bg="bg-rose-100 text-rose-950" />
            <Card label="Open invoices" val={summary.openCount} bg="bg-slate-800" />
            <Card label="Overdue invoices" val={summary.overdue} bg="bg-amber-100 text-amber-950" />
            <Card label={'Drafts (not in AR)'} val={summary.draftCount + ' · ' + money(summary.draftValue, currency)} bg="bg-slate-800" />
          </div>
          <div className="text-[10px] text-slate-500">Credits & deductions are not tracked in the system yet, so they read as 0. Unsent invoices with a balance DO count in AR; only true Drafts are separated out above. Currencies are kept separate — switch currency to see each.</div>

          {/* Filters */}
          <div className="bg-slate-900/40 border border-slate-700 rounded-lg p-2 flex flex-wrap gap-2 items-center text-xs">
            {['all', 'open', 'paid', 'overdue'].map(function (f) { return <button key={f} onClick={function () { setStatusFilter(f); }} className={'px-2 py-1 rounded font-bold ' + (statusFilter === f ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300')}>{f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}</button>; })}
            <span className="w-px h-4 bg-slate-700" />
            {['all', 'wave', 'hub'].map(function (f) { return <button key={f} onClick={function () { setSourceFilter(f); }} className={'px-2 py-1 rounded font-bold ' + (sourceFilter === f ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300')}>{f === 'all' ? 'Any source' : f === 'wave' ? 'Wave' : 'Hub'}</button>; })}
            <label className="flex items-center gap-1 text-slate-300 font-semibold"><input type="checkbox" checked={pendingSyncOnly} onChange={function (e) { setPendingSyncOnly(e.target.checked); }} /> Pending Wave sync</label>
            <input type="date" value={fromDate} onChange={function (e) { setFromDate(e.target.value); }} className="px-2 py-1 rounded bg-slate-800 border border-slate-600 text-slate-200" />
            <span className="text-slate-500">to</span>
            <input type="date" value={toDate} onChange={function (e) { setToDate(e.target.value); }} className="px-2 py-1 rounded bg-slate-800 border border-slate-600 text-slate-200" />
            <span className="text-[11px] text-slate-400 ml-1" title="Org history-visibility window (super admin sets it in Settings → Accounting Visibility). Employees see ONLY this window — totals, balance and statement are all limited to it. Super-admin sees all history.">Visibility: <b className={ledgerFloor ? 'text-sky-300' : 'text-slate-200'}>{isSuperAdmin ? 'All history (super-admin)' : labelForWindow(visCfg.window, visCfg.customDays)}</b>{ledgerFloor ? <span> (everything from {ledgerFloor})</span> : null}</span>
          </div>

          {/* Invoice list */}
          <div className="bg-slate-900/60 border border-slate-700 rounded-lg overflow-hidden">
            <div className="px-3 py-2 text-[11px] font-extrabold uppercase tracking-wider text-slate-400 border-b border-slate-700">Invoices ({listInvoices.length})</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-slate-400 border-b border-slate-800">
                  <th className="px-2 py-1.5 text-left">Invoice #</th><th className="px-2 py-1.5 text-left">Date</th><th className="px-2 py-1.5 text-left">Due</th><th className="px-2 py-1.5 text-left">Status</th><th className="px-2 py-1.5 text-left">Cur</th><th className="px-2 py-1.5 text-right">Total</th><th className="px-2 py-1.5 text-right">Wave paid</th><th className="px-2 py-1.5 text-right">Hub paid</th><th className="px-2 py-1.5 text-right">Balance</th><th className="px-2 py-1.5 text-left">Source</th><th className="px-2 py-1.5 text-left">Wave sync</th>
                </tr></thead>
                <tbody>
                  {listInvoices.map(function (i) {
                    var dead = isDeadInv(i); var draft = isDraftInv(i); var bal = invBalance(i);
                    var hp = hubPaid(i.id);
                    var rowPays = payByInv[i.id] || [];
                    var sync = rowPays.length ? (rowPays.every(function (p) { return p.sync_status === 'synced'; }) ? 'synced' : 'pending') : '—';
                    return (
                      <React.Fragment key={i.id}>
                        <tr className={'border-b border-slate-800 ' + (dead ? 'opacity-50' : draft ? 'bg-slate-800/40' : 'hover:bg-slate-800/40') + ' cursor-pointer'} onClick={function () { toggle(i.id); }}>
                          <td className="px-2 py-1.5 font-bold text-slate-100">{expanded[i.id] ? '▼ ' : '► '}{i.invoice_number || '—'}</td>
                          <td className="px-2 py-1.5 text-slate-300">{i.invoice_date || '—'}</td>
                          <td className="px-2 py-1.5 text-slate-300">{i.due_date || '—'}</td>
                          <td className="px-2 py-1.5"><span className={'px-1.5 py-0.5 rounded text-[10px] font-bold ' + (draft ? 'bg-slate-600 text-white' : dead ? 'bg-slate-700 text-slate-300' : 'bg-indigo-900 text-indigo-100')}>{statusLabel(i)}</span></td>
                          <td className="px-2 py-1.5 text-slate-400">{i.currency || 'USD'}</td>
                          <td className="px-2 py-1.5 text-right text-slate-200">{num(i.total_amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                          <td className="px-2 py-1.5 text-right text-slate-400">{num(i.wave_imported_paid).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                          <td className="px-2 py-1.5 text-right text-slate-400">{hp.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                          <td className={'px-2 py-1.5 text-right font-bold ' + (draft ? 'text-slate-500' : bal > 0.005 ? 'text-rose-300' : 'text-emerald-300')}>{draft ? '—' : bal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                          <td className="px-2 py-1.5 text-slate-400">{i.wave_invoice_id ? 'Wave' : 'Hub'}</td>
                          <td className="px-2 py-1.5 text-slate-400">{sync}</td>
                        </tr>
                        {expanded[i.id] && (
                          <tr className="bg-slate-950/60"><td colSpan={11} className="px-4 py-2">
                            <div className="text-[11px] text-slate-300 space-y-1">
                              <div className="font-bold text-slate-200">Balance calculation</div>
                              <div>Total {money(i.total_amount, i.currency)} − Wave-imported paid {money(i.wave_imported_paid, i.currency)} − Hub/Plaid/manual {money(hp, i.currency)} − Credits 0.00 − Deductions 0.00 = <b className={bal > 0.005 ? 'text-rose-300' : 'text-emerald-300'}>{money(bal, i.currency)}</b></div>
                              <div className="font-bold text-slate-200 mt-1">Payments applied ({rowPays.length})</div>
                              {rowPays.length === 0 && <div className="text-slate-500">No Hub/Plaid/manual payments recorded against this invoice.</div>}
                              {rowPays.map(function (p) {
                                return <div key={p.id} className="flex flex-wrap gap-x-3 text-slate-300">
                                  <span>{p.payment_date || '—'}</span>
                                  <span className="font-bold">{money(p.amount, i.currency)}</span>
                                  <span>{p.source === 'plaid_match' ? 'Bank match' : p.source === 'manual_payment' ? 'Manual' : (p.source || '—')}</span>
                                  <span className={'px-1 rounded text-[10px] font-bold ' + (p.sync_status === 'synced' ? 'bg-emerald-200 text-emerald-950' : 'bg-amber-200 text-amber-950')}>{p.sync_status || 'pending_wave_sync'}{p.wave_payment_id ? ' · ' + p.wave_payment_id : ''}</span>
                                  {p.notes ? <span className="opacity-70">{p.notes}</span> : null}
                                </div>;
                              })}
                            </div>
                          </td></tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {listInvoices.length === 0 && <tr><td colSpan={11} className="px-3 py-4 text-center text-slate-500">No invoices match the filters.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* Payment history */}
          <div className="bg-slate-900/60 border border-slate-700 rounded-lg overflow-hidden">
            <div className="px-3 py-2 text-[11px] font-extrabold uppercase tracking-wider text-slate-400 border-b border-slate-700">Payment history ({paymentHistory.length})</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-slate-400 border-b border-slate-800"><th className="px-2 py-1.5 text-left">Date</th><th className="px-2 py-1.5 text-right">Amount</th><th className="px-2 py-1.5 text-left">Source</th><th className="px-2 py-1.5 text-left">Invoice</th><th className="px-2 py-1.5 text-left">Bank ref</th><th className="px-2 py-1.5 text-left">Wave sync</th><th className="px-2 py-1.5 text-left">Notes</th></tr></thead>
                <tbody>
                  {paymentHistory.map(function (row) {
                    var p = row.p;
                    return <tr key={p.id} className="border-b border-slate-800 hover:bg-slate-800/40">
                      <td className="px-2 py-1.5 text-slate-300">{p.payment_date || '—'}</td>
                      <td className="px-2 py-1.5 text-right font-bold text-emerald-300">{money(p.amount, currency)}</td>
                      <td className="px-2 py-1.5 text-slate-300">{p.source === 'plaid_match' ? 'Bank match' : p.source === 'manual_payment' ? 'Manual payment' : (p.source || '—')}</td>
                      <td className="px-2 py-1.5 text-slate-400">{row.inv ? row.inv.invoice_number : '—'}</td>
                      <td className="px-2 py-1.5 text-slate-400">{p.bank_transaction_id ? 'bank txn' : (p.payment_match_id ? 'match' : '—')}</td>
                      <td className="px-2 py-1.5"><span className={'px-1 rounded text-[10px] font-bold ' + (p.sync_status === 'synced' ? 'bg-emerald-200 text-emerald-950' : 'bg-amber-200 text-amber-950')}>{p.sync_status || 'pending_wave_sync'}{p.wave_payment_id ? ' · ' + p.wave_payment_id : ''}</span></td>
                      <td className="px-2 py-1.5 text-slate-400">{p.notes || ''}</td>
                    </tr>;
                  })}
                  {paymentHistory.length === 0 && <tr><td colSpan={7} className="px-3 py-4 text-center text-slate-500">No payments recorded for this customer in {currency}.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* Running statement */}
          <div className="bg-slate-900/60 border border-slate-700 rounded-lg overflow-hidden">
            <div className="px-3 py-2 text-[11px] font-extrabold uppercase tracking-wider text-slate-400 border-b border-slate-700">Running statement — {currency}</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-slate-400 border-b border-slate-800"><th className="px-2 py-1.5 text-left">Date</th><th className="px-2 py-1.5 text-left">Type</th><th className="px-2 py-1.5 text-left">Reference</th><th className="px-2 py-1.5 text-left">Description</th><th className="px-2 py-1.5 text-right">Debit</th><th className="px-2 py-1.5 text-right">Credit</th><th className="px-2 py-1.5 text-right">Running balance</th></tr></thead>
                <tbody>
                  {displayStatement.map(function (e, idx) {
                    return <tr key={idx} className="border-b border-slate-800">
                      <td className="px-2 py-1.5 text-slate-300">{e.date || '—'}</td>
                      <td className="px-2 py-1.5 text-slate-300">{e.type}</td>
                      <td className="px-2 py-1.5 text-slate-400">{e.ref || ''}</td>
                      <td className="px-2 py-1.5 text-slate-300">{e.desc}</td>
                      <td className="px-2 py-1.5 text-right text-rose-300">{e.debit ? e.debit.toLocaleString('en-US', { minimumFractionDigits: 2 }) : ''}</td>
                      <td className="px-2 py-1.5 text-right text-emerald-300">{e.credit ? e.credit.toLocaleString('en-US', { minimumFractionDigits: 2 }) : ''}</td>
                      <td className={'px-2 py-1.5 text-right font-bold ' + (e.running > 0.005 ? 'text-rose-300' : 'text-emerald-300')}>{e.running.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                    </tr>;
                  })}
                  {statement.length === 0 && <tr><td colSpan={7} className="px-3 py-4 text-center text-slate-500">No AR activity in {currency}.</td></tr>}
                  {statement.length > 0 && <tr className="bg-slate-950/60"><td colSpan={6} className="px-2 py-2 text-right font-extrabold text-slate-200">Balance due</td><td className="px-2 py-2 text-right font-extrabold text-rose-300">{money(summary.balance, currency)}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

