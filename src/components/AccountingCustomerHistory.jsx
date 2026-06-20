// v55.83-AU — Customer AR History (read-only). Per accounting customer: AR
// summary, invoice history, payment history, proformas. Balance formula (locked):
//   open = total_amount - wave_imported_paid - SUM(hub/plaid payment rows)
// Wave imported paid is NEVER turned into payment rows -> no double-count.
import { useState, useEffect } from 'react';
import RestrictedNotice from './RestrictedNotice';
import { isArEligible } from '../lib/ar-eligibility';
import { supabase } from '../lib/supabase';
import { canViewAccountingCustomers, canViewCustomerAr, canSeeAmounts } from '../lib/bank-permissions';
import { fetchAllRows } from '../lib/fetch-all-rows';
import { isPaymentVoid } from '../lib/payment-matching';
import { getActiveWaveBusiness, scopeIfRegistered } from '../lib/wave-business';
import { floorDateFor, labelForWindow, isWithinWindow } from '../lib/visibility-window';

function n(v) { return v == null || v === '' ? 0 : Number(v) || 0; }
function money(v, show) { if (!show) return '•••'; var x = n(v); return x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function isDead(inv) { var s = inv.record_status; return s === 'void' || s === 'cancelled' || s === 'archived' || s === 'deleted'; }
function isDraft(inv) { return inv.wave_status === 'DRAFT' || inv.wave_status === 'SAVED' || inv.approval_status === 'draft'; }

export default function AccountingCustomerHistory(props) {
  var userProfile = props.userProfile || null;
  var isSuperAdmin = props.isSuperAdmin === true || (userProfile && userProfile.role === 'super_admin');
  var modulePerms = props.modulePerms || {};
  // v55.83-HR (Codex P0) — customer AR history is a customer/AR document view, not bank data.
  var _role = userProfile && userProfile.role;
  var mayView = canViewAccountingCustomers(isSuperAdmin, modulePerms, _role) || canViewCustomerAr(isSuperAdmin, modulePerms);
  var showAmt = canSeeAmounts(isSuperAdmin, modulePerms);
  var toast = props.toast || { error: function () {} };

  var [customers, setCustomers] = useState([]);
  var [invoices, setInvoices] = useState([]);
  var [payments, setPayments] = useState([]);
  var [proformas, setProformas] = useState([]);
  var [bankTxns, setBankTxns] = useState({});
  var [loading, setLoading] = useState(true);
  var [sel, setSel] = useState(null);
  var [filter, setFilter] = useState('all'); // all | review | open
  var [search, setSearch] = useState('');

  // v55.83-JQ — admin history-visibility window. The customer's OPEN BALANCE / aging uses ALL-TIME
  // data (loaded in full); the floor only hides older DETAIL rows (invoices/payments/proformas) for
  // normal users. Super-admin always sees everything (floor = null).
  var [visCfg, setVisCfg] = useState({ window: 'all', customDays: null, customFrom: null });
  var arFloor = floorDateFor({ window: visCfg.window, customDays: visCfg.customDays, customFrom: visCfg.customFrom, isSuperAdmin: isSuperAdmin }, new Date());

  function safe(q) { return q.then(function (r) { return r && r.data ? r.data : []; }).catch(function () { return []; }); }
  useEffect(function () {
    if (!mayView) { setLoading(false); return; }
    fetch('/api/admin/visibility').then(function (x) { return x.json(); }).then(function (j) { if (j && j.value) { setVisCfg(j.value); } }).catch(function () {});
    Promise.all([
      safe(fetchAllRows('accounting_customers', '*', 'company_name', true)),
      safe(fetchAllRows('accounting_invoices', '*')),
      safe(fetchAllRows('accounting_invoice_payments', '*')),
      safe(fetchAllRows('accounting_proformas', '*')),
      safe(fetchAllRows('bank_transactions', 'id, posted_date, name, amount_abs, direction')),
      safe(fetchAllRows('wave_business_registry', '*'))
    ]).then(function (res) {
      var reg = res[5] || [];
      var act = getActiveWaveBusiness();
      setCustomers(scopeIfRegistered(res[0] || [], act, reg, true)); setInvoices(scopeIfRegistered(res[1] || [], act, reg, true)); setPayments(scopeIfRegistered(res[2] || [], act, reg, true)); setProformas(scopeIfRegistered(res[3] || [], act, reg, true));
      var bt = {}; (res[4] || []).forEach(function (t) { bt[t.id] = t; }); setBankTxns(bt);
    }).catch(function (e) { console.error('[ar] load', e); toast.error('Failed to load AR history'); })
      .finally(function () { setLoading(false); });
  }, []);

  // payments grouped by invoice
  function hubPaidForInvoice(invId) {
    var sum = 0; payments.forEach(function (p) { if (p.accounting_invoice_id === invId && !isPaymentVoid(p)) sum += n(p.amount); }); return sum;
  }
  function invoicesFor(custId) { return invoices.filter(function (i) { return i.accounting_customer_id === custId; }); }
  function proformasFor(custId) { return proformas.filter(function (p) { return p.accounting_customer_id === custId; }); }
  function paymentsFor(custId) {
    var invIds = {}; invoicesFor(custId).forEach(function (i) { invIds[i.id] = true; });
    return payments.filter(function (p) { return p.accounting_customer_id === custId || invIds[p.accounting_invoice_id]; });
  }

  // v55.83-KA (Codex FAIL) — PERIOD activity cards (invoiced/paid/counts) must reflect the SAME visible
  // window as the invoice rows below; only the Open balance stays ALL-TIME (labeled). For a super-admin
  // arFloor is null, so period == all-time (no change for the admin). `openAllTime` is the true balance.
  function summary(custId) {
    var invs = invoicesFor(custId);
    var s = { invoiced: 0, waveePaid: 0, hubPaid: 0, openAllTime: 0, openCount: 0, paidCount: 0, partialCount: 0, overdueCount: 0, windowed: !!arFloor };
    var today = new Date().toISOString().substring(0, 10);
    invs.forEach(function (i) {
      if (!isArEligible(i)) return;  // shared rule: drafts + void/cancelled/archived/deleted excluded; unsent INCLUDED
      if ((i.currency || 'USD') !== 'USD') return; // keep currencies separate — USD summary only
      var total = n(i.total_amount);
      var wave = n(i.wave_imported_paid);
      var hub = hubPaidForInvoice(i.id);
      var bal = total - wave - hub;
      // Open balance is ALWAYS all-time (true money owed) — never windowed.
      s.openAllTime += bal;
      // Activity cards + counts: only invoices within the visible window count (matches the rows below).
      if (!isWithinWindow(i.invoice_date, arFloor)) { return; }
      s.invoiced += total; s.waveePaid += wave; s.hubPaid += hub;
      if (bal <= 0.0001) s.paidCount++;
      else { s.openCount++; if (wave + hub > 0.0001) s.partialCount++; if (i.due_date && i.due_date < today) s.overdueCount++; }
    });
    s.totalPaid = s.waveePaid + s.hubPaid;
    return s;
  }

  // v55.83-JZ (Codex — "AL MOUSTAFA 53 vs 98"): explain the invoice count. Shows exactly why the AR
  // summary counts fewer invoices than the customer's total: drafts, void/cancelled/archived/deleted,
  // and non-USD currencies are excluded from AR; the visibility window hides older DETAIL rows for
  // non-super-admins (balances stay all-time). So total = arEligibleUsd + excluded; displayed ≤ total.
  function breakdown(custId) {
    var invs = invoicesFor(custId);
    var b = { total: invs.length, arUsd: 0, paid: 0, open: 0, excludedDraft: 0, excludedDead: 0, excludedNonUsd: 0, hiddenByWindow: 0, displayed: 0 };
    invs.forEach(function (i) {
      var dead = isDead(i);
      var elig = isArEligible(i);
      var usd = (i.currency || 'USD') === 'USD';
      if (dead) { b.excludedDead++; }
      else if (!elig) { b.excludedDraft++; }   // remaining non-eligible = true drafts
      else if (!usd) { b.excludedNonUsd++; }
      else {
        b.arUsd++;
        var bal = n(i.total_amount) - n(i.wave_imported_paid) - hubPaidForInvoice(i.id);
        if (bal <= 0.0001) { b.paid++; } else { b.open++; }
      }
      // displayed in the windowed detail list (super-admin: arFloor null → all shown)
      if (isWithinWindow(i.invoice_date, arFloor)) { b.displayed++; } else { b.hiddenByWindow++; }
    });
    return b;
  }

  if (!mayView) return <div className="p-6"><RestrictedNotice title="Customer AR History restricted" message="Requires Accounting Customers: View (ACCT-002) or Customer: View AR. Bank View is NOT required." /></div>;
  if (loading) return <div className="p-6 text-slate-300">Loading customer AR history…</div>;

  var listed = customers.filter(function (c) {
    if (filter === 'review' && c.needs_review !== true) return false;
    if (filter === 'open' && summary(c.id).openAllTime <= 0.0001) return false;
    if (search.trim()) { var q = search.trim().toLowerCase(); if ((c.company_name || '').toLowerCase().indexOf(q) < 0 && (c.email || '').toLowerCase().indexOf(q) < 0) return false; }
    return true;
  });
  var selCust = sel ? customers.filter(function (c) { return c.id === sel; })[0] : null;
  var sum = selCust ? summary(selCust.id) : null;

  return (
    <div className="p-4 text-slate-100">
      <div className="text-lg font-extrabold mb-2">📒 Customer AR History</div>
      <div className="flex gap-4" style={{ alignItems: 'flex-start' }}>
        {/* left: customer list */}
        <div style={{ width: '300px', flexShrink: 0 }}>
          <input value={search} onChange={function (e) { setSearch(e.target.value); }} placeholder="Search customers…" className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-xs mb-2" />
          <div className="flex gap-1 mb-2">
            {['all', 'review', 'open'].map(function (fk) {
              return <button key={fk} onClick={function () { setFilter(fk); }} className={'px-2 py-1 text-[11px] rounded font-bold ' + (filter === fk ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300')}>{fk === 'all' ? 'All' : fk === 'review' ? 'Needs review' : 'Open balance'}</button>;
            })}
          </div>
          <div style={{ maxHeight: '70vh', overflowY: 'auto' }} className="border border-slate-700 rounded">
            {listed.length === 0 ? <div className="p-3 text-slate-400 italic text-xs">No customers.</div> :
              listed.map(function (c) {
                var st = summary(c.id);
                return (
                  <div key={c.id} onClick={function () { setSel(c.id); }} className={'px-2 py-1.5 cursor-pointer border-b border-slate-800 ' + (sel === c.id ? 'bg-slate-700' : 'hover:bg-slate-800')}>
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-bold text-xs text-slate-100 truncate">{c.company_name || '(no name)'}</span>
                      {c.needs_review === true && <span className="text-[9px] bg-amber-400 text-amber-950 rounded px-1 font-bold">review</span>}
                    </div>
                    <div className="text-[10px] text-slate-400">Open: {money(st.open, showAmt)}</div>
                  </div>
                );
              })}
          </div>
        </div>

        {/* right: detail */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {!selCust ? <div className="text-slate-400 italic text-sm p-4">Select a customer to see their receivables history.</div> : (
            <div>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <div className="text-base font-extrabold">{selCust.company_name}</div>
                {selCust.needs_review === true && <span className="text-[10px] bg-amber-400 text-amber-950 rounded px-1.5 py-0.5 font-bold">NEEDS REVIEW (placeholder from import)</span>}
                <span className="text-[11px] text-slate-400 ml-1" title="Org history-visibility window (super admin sets it in Settings → Accounting Visibility). The OPEN BALANCE above always uses full history; only the detail rows below older than the window are hidden for normal users.">Visibility: <b className={arFloor ? 'text-sky-300' : 'text-slate-200'}>{isSuperAdmin ? 'All history (super-admin)' : labelForWindow(visCfg.window, visCfg.customDays)}</b>{arFloor ? <span> (detail from {arFloor}; balance all-time)</span> : null}</span>
              </div>

              {/* AR summary — v55.83-KA: activity cards reflect the visible window; Open balance is all-time. */}
              <div className="grid grid-cols-4 gap-2 mb-3">
                <Card label={sum.windowed ? 'Total invoiced (in view)' : 'Total invoiced'} val={money(sum.invoiced, showAmt)} bg="bg-slate-100 text-slate-900" />
                <Card label={sum.windowed ? 'Paid · Wave (in view)' : 'Paid (Wave)'} val={money(sum.waveePaid, showAmt)} bg="bg-sky-100 text-sky-950" />
                <Card label={sum.windowed ? 'Paid · Hub/Plaid (in view)' : 'Paid (Hub/Plaid)'} val={money(sum.hubPaid, showAmt)} bg="bg-violet-100 text-violet-950" />
                <Card label="Open balance (all-time)" val={money(sum.openAllTime, showAmt)} bg="bg-rose-100 text-rose-950" />
              </div>
              {sum.windowed ? <div className="text-[10px] text-slate-500 mb-2 -mt-1">Activity cards above show the visible window ({labelForWindow(visCfg.window, visCfg.customDays)}); <b>Open balance is all-time</b>. Switch the window in Settings → Accounting Visibility.</div> : null}
              <div className="flex gap-2 mb-2 text-[11px]">
                <Pill label="Open" v={sum.openCount} c="bg-rose-200 text-rose-950" />
                <Pill label="Paid" v={sum.paidCount} c="bg-emerald-200 text-emerald-950" />
                <Pill label="Partial" v={sum.partialCount} c="bg-amber-200 text-amber-950" />
                <Pill label="Overdue" v={sum.overdueCount} c="bg-rose-300 text-rose-950" />
                <Pill label="Total paid" v={money(sum.totalPaid, showAmt)} c="bg-slate-200 text-slate-900" />
              </div>
              {/* v55.83-JZ — invoice-count breakdown so a "98 vs 53" mismatch is explainable on-screen. */}
              {(function () {
                var b = breakdown(selCust.id);
                var excluded = b.excludedDraft + b.excludedDead + b.excludedNonUsd;
                return (
                  <div className="mb-4 text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded p-2 leading-5">
                    <b>Invoice count for this customer:</b> {b.total} total · <b>{b.arUsd}</b> counted in AR all-time (USD) = {b.open} open + {b.paid} paid.
                    {excluded > 0 ? <span> · {excluded} excluded from AR ({b.excludedDraft} draft, {b.excludedDead} void/cancelled/archived/deleted, {b.excludedNonUsd} non-USD).</span> : null}
                    {arFloor ? <span> · The activity cards above are limited to the visible window ({b.displayed} invoice row(s) shown, {b.hiddenByWindow} older hidden from employees); <b>Open balance is all-time</b>.</span> : null}
                  </div>
                );
              })()}

              {/* invoices */}
              <Section title="Invoices">
                <div className="overflow-x-auto"><table className="w-full text-xs">
                  <thead><tr className="text-slate-400 text-left"><th className="py-1">Invoice</th><th>Source</th><th>Date</th><th>Due</th><th>Status</th><th className="text-right">Total</th><th className="text-right">Wave paid</th><th className="text-right">Hub paid</th><th className="text-right">Balance</th><th>Sync</th></tr></thead>
                  <tbody>{invoicesFor(selCust.id).filter(function (i) { return isWithinWindow(i.invoice_date, arFloor); }).map(function (i) {
                    var hub = hubPaidForInvoice(i.id); var bal = n(i.total_amount) - n(i.wave_imported_paid) - hub; var dead = isDead(i);
                    return <tr key={i.id} className={'border-t border-slate-800 ' + (dead ? 'opacity-50 line-through' : '')}>
                      <td className="py-1 font-bold text-slate-100">{i.invoice_number || i.id.slice(0, 6)}</td>
                      <td>{i.source === 'wave_import' ? <span className="text-[9px] bg-sky-700 text-white rounded px-1">Wave</span> : <span className="text-[9px] bg-emerald-700 text-white rounded px-1">Hub</span>}{i.is_historical ? <span className="ml-1 text-[9px] bg-slate-600 text-white rounded px-1">hist</span> : null}</td>
                      <td>{i.invoice_date || ''}</td><td>{i.due_date || ''}</td><td>{i.payment_status || ''}{i.record_status && i.record_status !== 'active' ? ' · ' + i.record_status : ''}</td>
                      <td className="text-right">{money(i.total_amount, showAmt)}</td><td className="text-right">{money(i.wave_imported_paid, showAmt)}</td><td className="text-right">{money(hub, showAmt)}</td>
                      <td className="text-right font-bold">{money(bal, showAmt)}</td><td>{i.wave_sync_status || ''}</td>
                    </tr>;
                  })}</tbody>
                </table></div>
              </Section>

              {/* payments */}
              <Section title="Payment history (Hub / Plaid matches)">
                <div className="text-[10px] text-slate-400 italic mb-1">Wave-imported invoices carry only an aggregate paid total (shown per invoice as "Wave paid") — Wave's API does not expose individual historical payment dates. Bank-matched payments below show full detail.</div>
                {paymentsFor(selCust.id).length === 0 ? <div className="text-slate-400 italic text-xs">No Hub/Plaid payments matched yet. (Wave-imported paid amounts are shown per invoice above, not as separate payments.)</div> :
                  <div className="overflow-x-auto"><table className="w-full text-xs">
                    <thead><tr className="text-slate-400 text-left"><th className="py-1">Date</th><th>Bank description</th><th className="text-right">Amount</th><th>Source</th><th>Sync to Wave</th></tr></thead>
                    <tbody>{paymentsFor(selCust.id).filter(function (p) { return isWithinWindow(p.payment_date || (bankTxns[p.bank_transaction_id] && bankTxns[p.bank_transaction_id].posted_date), arFloor); }).map(function (p) {
                      var bt = p.bank_transaction_id ? bankTxns[p.bank_transaction_id] : null;
                      return <tr key={p.id} className="border-t border-slate-800">
                        <td className="py-1">{p.payment_date || (bt && bt.posted_date) || ''}</td>
                        <td>{bt && bt.name ? bt.name : (p.memo || '—')}</td>
                        <td className="text-right font-bold">{money(p.amount, showAmt)}</td>
                        <td>{p.source || ''}</td>
                        <td>{p.sync_status === 'synced' ? <span className="text-emerald-400">synced</span> : p.sync_status === 'failed' ? <span className="text-rose-400" title={p.sync_error || ''}>failed</span> : <span className="text-amber-400">pending Wave sync</span>}</td>
                      </tr>;
                    })}</tbody>
                  </table></div>}
              </Section>

              {/* proformas */}
              <Section title="Proformas">
                {proformasFor(selCust.id).length === 0 ? <div className="text-slate-400 italic text-xs">No proformas.</div> :
                  <div className="overflow-x-auto"><table className="w-full text-xs">
                    <thead><tr className="text-slate-400 text-left"><th className="py-1">Proforma</th><th>Status</th><th className="text-right">Total</th><th>Converted invoice</th></tr></thead>
                    <tbody>{proformasFor(selCust.id).filter(function (pf) { return isWithinWindow(pf.proforma_date, arFloor); }).map(function (pf) {
                      return <tr key={pf.id} className="border-t border-slate-800"><td className="py-1 font-bold text-slate-100">{pf.proforma_number || pf.id.slice(0, 6)}</td><td>{pf.status || ''}</td><td className="text-right">{money(pf.total_amount, showAmt)}</td><td>{pf.converted_invoice_id ? 'yes' : '—'}</td></tr>;
                    })}</tbody>
                  </table></div>}
              </Section>

              {/* deductions placeholder */}
              <Section title="Deductions / claims">
                <div className="text-slate-400 italic text-xs">Deductions not yet enabled.</div>
              </Section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Card(props) { return <div className={'rounded p-2 ' + props.bg}><div className="text-[10px] font-semibold opacity-80">{props.label}</div><div className="text-base font-extrabold">{props.val}</div></div>; }
function Pill(props) { return <span className={'rounded px-2 py-1 font-bold ' + props.c}>{props.label}: {props.v}</span>; }
function Section(props) { return <div className="mb-4"><div className="text-xs font-bold text-slate-300 mb-1 border-b border-slate-700 pb-0.5">{props.title}</div>{props.children}</div>; }
