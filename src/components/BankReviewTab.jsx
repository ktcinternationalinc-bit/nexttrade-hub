// v55.83-Z — Phase 2: Bank transaction review + classification + matching UI.
// Money math comes from src/lib/payment-matching.js (validated). Permissions from
// src/lib/bank-permissions.js. No Wave sync here. No deletes. Approved = locked.
import { useState, useEffect, useMemo } from 'react';
import SiloBanner from './SiloBanner';
import { assertMatchSameSilo } from '../lib/wave-silo-guard';
import { supabase, dbInsert, dbUpdate, logActivity } from '../lib/supabase';
import { fetchAllRows } from '../lib/fetch-all-rows';
import { getActiveWaveBusiness, scopeIfRegistered } from '../lib/wave-business';
import {
  canViewBank, canSeeAmounts, canClassify, canMatchPayments, canReopen,
  maskAmount, CLASSIFICATIONS, REVIEW_STATUSES,
} from '../lib/bank-permissions';
import { classifyApplication, computeInvoiceBalance, validateSplit, roundMoney } from '../lib/payment-matching';

function invoiceTotal(inv) {
  // PINNED v55.83-AA: this app stores the invoice total in total_amount
  // (legacy rows may use amount). No other fallbacks.
  if (!inv) return 0;
  var v = inv.total_amount != null ? inv.total_amount : (inv.amount != null ? inv.amount : 0);
  return Number(v) || 0;
}
function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function labelize(s) { return String(s || '').replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }

function Typeahead(props) {
  var items = props.items || [];
  var value = props.value || '';
  var getLabel = props.getLabel || function (x) { return x.id; };
  var onPick = props.onPick || function () {};
  var st = useState(''); var q = st[0]; var setQ = st[1];
  var os = useState(false); var open = os[0]; var setOpen = os[1];
  var selected = items.find(function (x) { return x.id === value; });
  var shown = (q.trim() ? items.filter(function (x) { return getLabel(x).toLowerCase().indexOf(q.trim().toLowerCase()) >= 0; }) : items).slice(0, 10);
  return (
    <div className="relative mb-1">
      <input value={open ? q : (selected ? getLabel(selected) : '')} placeholder={props.placeholder}
        onFocus={function () { setOpen(true); setQ(''); }}
        onBlur={function () { setTimeout(function () { setOpen(false); }, 150); }}
        onChange={function (e) { setQ(e.target.value); setOpen(true); }}
        className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-xs" />
      {open && (
        <div className="absolute z-20 left-0 right-0 bg-slate-900 border border-slate-600 rounded mt-0.5 max-h-48 overflow-auto shadow-xl">
          {props.allowClear && <div onMouseDown={function () { onPick(''); setOpen(false); }} className="px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-800 cursor-pointer">— clear —</div>}
          {shown.length === 0 ? <div className="px-2 py-1 text-[11px] text-slate-500 italic">no matches</div> :
            shown.map(function (x) { return <div key={x.id} onMouseDown={function () { onPick(x.id); setOpen(false); }} className="px-2 py-1 text-[11px] text-slate-100 hover:bg-indigo-600/40 cursor-pointer">{getLabel(x)}</div>; })}
        </div>
      )}
    </div>
  );
}

export default function BankReviewTab(props) {
  var toast = props.toast || { success: function () {}, error: function () {}, warn: function () {} };
  var userProfile = props.userProfile || null;
  var isSuperAdmin = props.isSuperAdmin === true || (userProfile && userProfile.role === 'super_admin');
  var modulePerms = props.modulePerms || {};
  var customers = props.customers || [];
  var invoices = props.invoices || [];
  var onReload = props.onReload || function () {};

  var seeAmounts = canSeeAmounts(isSuperAdmin, modulePerms);
  var mayClassify = canClassify(isSuperAdmin, modulePerms);
  var mayMatch = canMatchPayments(isSuperAdmin, modulePerms);
  var mayReopen = canReopen(isSuperAdmin, modulePerms, userProfile && userProfile.role);

  var [txns, setTxns] = useState([]);
  var [matchesByTxn, setMatchesByTxn] = useState({});
  var [acctCustomers, setAcctCustomers] = useState([]);
  var [acctInvoices, setAcctInvoices] = useState([]);
  var [registry, setRegistry] = useState([]);
  var [plaidAccts, setPlaidAccts] = useState({});
  function bizLabel(id) { if (!id) { return 'All businesses'; } var e = registry.find(function (r) { return r.wave_business_id === id; }); return e ? (e.label || id) : id; }
  var [loading, setLoading] = useState(true);
  var [sel, setSel] = useState(null);            // selected transaction
  var [busy, setBusy] = useState(false);

  // filters
  var [fStatus, setFStatus] = useState('unreviewed');
  var [fDirection, setFDirection] = useState('all');
  var [fAccount, setFAccount] = useState('all');
  var [fUnsupported, setFUnsupported] = useState(false);
  var [search, setSearch] = useState('');
  var [fFrom, setFFrom] = useState('');
  var [fTo, setFTo] = useState('');

  // match panel working state
  var [mCustomerId, setMCustomerId] = useState('');
  var [mInvoiceId, setMInvoiceId] = useState('');
  var [mAmount, setMAmount] = useState('');
  var [mNotes, setMNotes] = useState('');
  var [splitMode, setSplitMode] = useState(false);
  var [splitRows, setSplitRows] = useState([]);

  function load() {
    setLoading(true);
    Promise.all([
      supabase.from('bank_transactions').select('*').order('posted_date', { ascending: false, nullsFirst: false }).limit(1000),
      supabase.from('payment_matches').select('*'),
      fetchAllRows('accounting_customers', '*', 'company_name', true),
      fetchAllRows('accounting_invoices', '*', 'created_at', false),
      fetchAllRows('wave_business_registry', '*'),
      supabase.from('plaid_accounts').select('*'),
    ]).then(function (res) {
      var reg = (res[4] && res[4].data) || []; var t = scopeIfRegistered((res[0] && res[0].data) || [], getActiveWaveBusiness(), reg, true);
      var m = (res[1] && res[1].data) || [];
      var byTxn = {};
      m.forEach(function (x) { (byTxn[x.bank_transaction_id] = byTxn[x.bank_transaction_id] || []).push(x); });
      var pa = {}; ((res[5] && res[5].data) || []).forEach(function (a) { if (a.plaid_account_id) { pa[a.plaid_account_id] = a; } });
      setPlaidAccts(pa);
      setRegistry(reg);
      setTxns(t); setMatchesByTxn(byTxn);
      setAcctCustomers(scopeIfRegistered((res[2] && res[2].data) || [], getActiveWaveBusiness(), reg, true));
      setAcctInvoices(scopeIfRegistered((res[3] && res[3].data) || [], getActiveWaveBusiness(), reg, true));
      setSel(function (cur) { if (!cur) { return cur; } var fr = null; t.forEach(function (x) { if (x.id === cur.id) { fr = x; } }); return fr || cur; });
    }).catch(function (e) { console.error('[bankreview] load', e); toast.error('Failed to load bank transactions'); })
      .finally(function () { setLoading(false); });
  }
  useEffect(function () { if (canViewBank(isSuperAdmin, modulePerms)) load(); else setLoading(false); }, []);

  // Label an account using the REAL Plaid account data (name + mask), joined by
  // account_id -> plaid_accounts.plaid_account_id. Falls back to subtype + a short
  // id suffix only if the account isn't in plaid_accounts yet.
  function acctLabel(t) {
    var src = t.bank_source || 'Account';
    var a = plaidAccts[t.account_id];
    if (a) {
      var nm = a.name || a.official_name || (a.subtype ? (String(a.subtype).charAt(0).toUpperCase() + String(a.subtype).slice(1)) : 'Account');
      var mask = a.mask ? (' \u00b7\u00b7' + a.mask) : '';
      return src + ' \u2014 ' + nm + mask;
    }
    var sub = t.account_subtype ? (' ' + String(t.account_subtype).charAt(0).toUpperCase() + String(t.account_subtype).slice(1)) : '';
    var idTail = t.account_id ? (' \u00b7\u00b7' + String(t.account_id).slice(-4)) : '';
    return src + sub + idTail + ' (mask pending re-sync)';
  }
  var accounts = useMemo(function () {
    var s = {}; txns.forEach(function (t) { if (t.account_id && !s[t.account_id]) { s[t.account_id] = acctLabel(t); } });
    return Object.keys(s).map(function (id) { return { id: id, label: s[id] }; });
  }, [txns, plaidAccts]);

  var filtered = useMemo(function () {
    var list = txns.slice();
    if (fStatus !== 'all') list = list.filter(function (t) { return (t.review_status || 'unreviewed') === fStatus; });
    if (fDirection !== 'all') list = list.filter(function (t) { return t.direction === fDirection; });
    if (fAccount !== 'all') list = list.filter(function (t) { return t.account_id === fAccount; });
    if (fUnsupported) list = list.filter(function (t) { return t.unsupported_account === true; });
    if (fFrom) list = list.filter(function (t) { return (t.posted_date || t.date) >= fFrom; });
    if (fTo) list = list.filter(function (t) { return (t.posted_date || t.date) <= fTo; });
    if (search.trim()) {
      var q = search.trim().toLowerCase();
      list = list.filter(function (t) {
        return (t.name || '').toLowerCase().indexOf(q) >= 0
          || (t.merchant_name || '').toLowerCase().indexOf(q) >= 0
          || String(t.amount_abs || t.amount || '').indexOf(q) >= 0
          || (t.classification || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    return list;
  }, [txns, fStatus, fDirection, fAccount, fUnsupported, fFrom, fTo, search]);

  function openTxn(t) {
    setSel(t); setMCustomerId(t.accounting_customer_id || ''); setMInvoiceId(''); setMAmount(String(t.amount_abs || Math.abs(Number(t.amount)) || ''));
    setMNotes(t.notes || '');
  }
  function isLocked(t) { return t && t.review_status === 'approved'; }

  // ---- mutations ----
  function patchTxn(t, patch, activity) {
    return dbUpdate('bank_transactions', t.id, Object.assign({ updated_by: userProfile && userProfile.id }, patch), userProfile && userProfile.id)
      .then(function () { if (activity) logActivity(userProfile && userProfile.id, activity, 'bank_review'); });
  }

  function setClassification(t, cls) {
    if (!mayClassify) { toast.error('You do not have Bank: Classify permission.'); return; }
    if (isLocked(t)) { toast.error('Approved — reopen first to edit.'); return; }
    setBusy(true);
    patchTxn(t, { classification: cls, review_status: t.review_status === 'unreviewed' ? 'reviewed' : t.review_status },
      'Classified bank txn ' + (t.name || t.id) + ' as ' + cls)
      .then(function () { toast.success('Classified as ' + labelize(cls)); setSel(Object.assign({}, t, { classification: cls, review_status: t.review_status === 'unreviewed' ? 'reviewed' : t.review_status })); load(); })
      .catch(function (e) { console.error('[save] Failed: ', e); toast.error('Failed: ' + ((e && e.message) || 'unknown error — check console')); })
      .finally(function () { setBusy(false); });
  }

  function setStatus(t, status, reasonRequired) {
    if (isLocked(t) && status !== 'approved') { toast.error('Approved — reopen first.'); return; }
    var reason = '';
    if (reasonRequired) { reason = window.prompt('Reason for marking ' + labelize(status) + ':') || ''; if (!reason.trim()) { toast.error('Reason required.'); return; } }
    setBusy(true);
    var patch = { review_status: status };
    if (status === 'reviewed') { patch.reviewed_by = userProfile && userProfile.id; patch.reviewed_at = new Date().toISOString(); }
    if (reason) patch.notes = ((t.notes || '') + (t.notes ? ' | ' : '') + labelize(status) + ': ' + reason.trim());
    patchTxn(t, patch, 'Marked bank txn ' + (t.name || t.id) + ' ' + status + (reason ? (' (' + reason.trim() + ')') : ''))
      .then(function () { toast.success('Marked ' + labelize(status)); load(); setSel(null); })
      .catch(function (e) { console.error('[save] Failed: ', e); toast.error('Failed: ' + ((e && e.message) || 'unknown error — check console')); })
      .finally(function () { setBusy(false); });
  }

  function approve(t) {
    if (!mayMatch && !isSuperAdmin) { toast.error('Approval requires Payments: Match (or admin).'); return; }
    setBusy(true);
    patchTxn(t, { review_status: 'approved', reviewed_by: userProfile && userProfile.id, reviewed_at: new Date().toISOString() },
      'Approved bank txn ' + (t.name || t.id))
      .then(function () { toast.success('Approved & locked'); load(); setSel(null); })
      .catch(function (e) { console.error('[save] Failed: ', e); toast.error('Failed: ' + ((e && e.message) || 'unknown error — check console')); })
      .finally(function () { setBusy(false); });
  }
  function reopen(t) {
    if (!mayReopen) { toast.error('Only an Owner/Admin or Accounting Manager can reopen an approved transaction.'); return; }
    var reason = window.prompt('Reopen this approved transaction for editing. Reason:') || '';
    if (!reason.trim()) { toast.error('Reason required.'); return; }
    setBusy(true);
    patchTxn(t, { review_status: 'reviewed' }, 'Reopened approved bank txn ' + (t.name || t.id) + ' (' + reason.trim() + ')')
      .then(function () { toast.success('Reopened'); load(); })
      .catch(function (e) { console.error('[save] Failed: ', e); toast.error('Failed: ' + ((e && e.message) || 'unknown error — check console')); })
      .finally(function () { setBusy(false); });
  }

  // v55.83-AY — create a Wave-syncable payment row alongside every payment_match.
  function createInvPaymentRow(inv, t, amt, matchId, notes) {
    var cust = acctCustomers.find(function (cc) { return cc.id === inv.accounting_customer_id; });
    return dbInsert('accounting_invoice_payments', {
      business_id: t.business_id || inv.business_id || null,
      wave_business_id: (inv.wave_business_id || t.wave_business_id || getActiveWaveBusiness() || null), // v55.83-DZ — silo tag
      accounting_invoice_id: inv.id,
      accounting_customer_id: inv.accounting_customer_id || null,
      amount: amt,
      payment_date: t.posted_date || t.date || null,
      source: 'plaid_match',
      bank_transaction_id: t.id,
      payment_match_id: matchId || null,
      wave_payment_id: null,
      sync_status: 'pending_wave_sync',
      wave_invoice_id: inv.wave_invoice_id || null,
      wave_customer_id: cust && cust.wave_customer_id ? cust.wave_customer_id : null,
      memo: notes || null,
      created_by: userProfile && userProfile.id
    }, userProfile && userProfile.id);
  }

  // v55.83-AY — canonical balance: amount_paid = wave_imported_paid + SUM(hub payment rows).
  // Reads accounting_invoice_payments (NOT payment_matches) so it never clobbers the
  // Wave-imported paid amount and never double-counts.
  function recomputeInvoice(invId) {
    // Resolve the invoice from memory; if missing (different page/silo not loaded), fetch it
    // from the DB so we never compute against total=0 and corrupt amount_paid/balance_due.
    var inMem = acctInvoices.find(function (i) { return i.id === invId; });
    function compute(inv) {
      if (!inv) { return Promise.resolve(); } // safety: never write balances for an unknown invoice
      return supabase.from('accounting_invoice_payments').select('amount, voided').eq('accounting_invoice_id', invId).then(function (r) {
        var total = invoiceTotal(inv);
        var waveImported = (inv && Number(inv.wave_imported_paid)) || 0;
        var hubPaid = 0;
        ((r && r.data) || []).forEach(function (p) { if (!p.voided) { hubPaid += Number(p.amount) || 0; } });
        var amountPaid = Math.round((waveImported + hubPaid) * 100) / 100;
        var balanceDue = Math.round((total - amountPaid) * 100) / 100;
        if (balanceDue < 0) { balanceDue = 0; } // overpayment goes to customer_credits, not negative balance
        var status = balanceDue <= 0.0001 ? 'paid' : (amountPaid > 0.0001 ? 'partial' : 'unpaid');
        return dbUpdate('accounting_invoices', invId, { amount_paid: amountPaid, balance_due: balanceDue, payment_status: status }, userProfile && userProfile.id);
      });
    }
    if (inMem) { return compute(inMem); }
    return supabase.from('accounting_invoices').select('*').eq('id', invId).then(function (r) {
      var inv = (r && r.data && r.data.length) ? r.data[0] : null;
      return compute(inv);
    });
  }

  function unmatch(t) {
    if (!t || !mayMatch) { toast.error('You do not have Payments: Match permission.'); return; }
    if (isLocked(t)) { toast.error('Approved — reopen first.'); return; }
    var ms = matchesByTxn[t.id] || [];
    if (ms.length === 0) { toast.error('Nothing to unmatch on this transaction.'); return; }
    if (!window.confirm('Unmatch this payment?\n\nThe invoice balance will be restored. This REVERSES the match (it is voided + logged, not hard-deleted) and can be re-matched afterwards.')) { return; }
    var invIds = {}; ms.forEach(function (m) { if (m.invoice_id) { invIds[m.invoice_id] = true; } });
    var stamp = { voided: true, voided_at: new Date().toISOString(), voided_by: (userProfile && userProfile.id) || null };
    setBusy(true);
    supabase.from('accounting_invoice_payments').update(stamp).eq('bank_transaction_id', t.id)
      .then(function () { return supabase.from('payment_matches').update(stamp).eq('bank_transaction_id', t.id); })
      .then(function () { return patchTxn(t, { linked_type: null, linked_id: null, matched_invoice_id: null, review_status: t.review_status === 'approved' ? t.review_status : 'reviewed' }, 'Unmatched bank txn ' + (t.name || t.id) + ' (' + ms.length + ' match(es) reversed)'); })
      .then(function () { var chain = Promise.resolve(); Object.keys(invIds).forEach(function (id) { chain = chain.then(function () { return recomputeInvoice(id); }); }); return chain; })
      .then(function () { toast.success('Unmatched — invoice balance restored'); onReload(); load(); setSel(null); })
      .catch(function (e) { console.error('[unmatch]', e); toast.error('Unmatch failed: ' + ((e && e.message) || 'unknown error — check console')); })
      .finally(function () { setBusy(false); });
  }

  function addSplitRow() { setSplitRows(splitRows.concat([{ amount: '', category: '', customer_id: '', invoice_id: '', notes: '' }])); }
  function updSplitRow(i, k, v) { var c = splitRows.slice(); c[i] = Object.assign({}, c[i]); c[i][k] = v; setSplitRows(c); }
  function rmSplitRow(i) { var c = splitRows.slice(); c.splice(i, 1); setSplitRows(c); }
  function saveSplits() {
    var t = sel; if (!t || !mayMatch) return;
    if (isLocked(t)) { toast.error('Approved — reopen first.'); return; }
    var txnAmt = Number(t.amount_abs || Math.abs(Number(t.amount)));
    var v = validateSplit(txnAmt, splitRows.map(function (r) { return { split_amount: r.amount }; }));
    if (!v.valid) { toast.error('Splits must be > 0 and not exceed ' + fmt(txnAmt) + ' (allocated ' + fmt(v.allocated) + ').'); return; }
    setBusy(true);
    var chain = Promise.resolve();
    splitRows.forEach(function (r) {
      var amt = roundMoney(Number(r.amount));
      if (!(amt > 0)) return;
      chain = chain.then(function () {
        return dbInsert('bank_transaction_splits', { business_id: t.business_id, bank_transaction_id: t.id, split_amount: amt, category: r.category || null, linked_type: r.invoice_id ? 'invoice' : (r.customer_id ? 'customer' : null), linked_id: r.invoice_id || r.customer_id || null, notes: r.notes || null, created_by: userProfile && userProfile.id }, userProfile && userProfile.id);
      });
      if (r.invoice_id) {
        chain = chain.then(function () {
          var inv = acctInvoices.find(function (i) { return i.id === r.invoice_id; });
          if (!inv) return null;
          if (t.business_id && inv.business_id && t.business_id !== inv.business_id) { toast.error('Skipped an invoice from another business.'); return null; }
          return dbInsert('payment_matches', { business_id: t.business_id, wave_business_id: (t.wave_business_id || getActiveWaveBusiness() || null), bank_transaction_id: t.id, invoice_id: r.invoice_id, matched_amount: amt, match_type: 'partial', is_manual_override: true, notes: 'split', matched_by: userProfile && userProfile.id, created_by: userProfile && userProfile.id }, userProfile && userProfile.id)
            .then(function (matchRow) { return createInvPaymentRow(inv, t, amt, matchRow && matchRow.id, 'split'); })
            .then(function () { return recomputeInvoice(r.invoice_id); });
        });
      }
    });
    chain.then(function () { return patchTxn(t, { review_status: t.review_status === 'unreviewed' ? 'reviewed' : t.review_status, accounting_customer_id: t.accounting_customer_id }, 'Split bank txn ' + (t.name || t.id) + ' into ' + splitRows.length + ' line(s)'); })
      .then(function () { toast.success('Split saved (' + splitRows.length + ' lines)'); setSplitMode(false); setSplitRows([]); onReload(); load(); })
      .catch(function (e) { console.error('[save] Split failed: ', e); toast.error('Split failed: ' + ((e && e.message) || 'unknown error — check console')); })
      .finally(function () { setBusy(false); });
  }

  function applyToInvoice() {
    var t = sel; if (!t) return;
    if (!mayMatch) { toast.error('You do not have Payments: Match permission.'); return; }
    if (isLocked(t)) { toast.error('Approved — reopen first.'); return; }
    var inv = acctInvoices.find(function (i) { return i.id === mInvoiceId; });
    if (!inv) { toast.error('Pick an invoice.'); return; }
    // Guardrail: never match across Wave businesses (silo). Routed through the shared
    // wave-silo guard so match + future push enforcement use ONE source of truth.
    var activeBiz = getActiveWaveBusiness();
    var siloCheck = assertMatchSameSilo({ activeBusinessId: activeBiz, bankTxn: t, invoice: inv, customer: null, labelFor: bizLabel });
    if (!siloCheck.ok) { toast.error(siloCheck.message); return; }
    if (t.business_id && inv.business_id && t.business_id !== inv.business_id) { toast.error('That invoice belongs to another business.'); return; }
    var apply = roundMoney(Number(mAmount));
    if (!(apply > 0)) { toast.error('Enter an amount greater than zero.'); return; }
    setBusy(true);
    var biz = t.business_id || (inv ? inv.business_id : null);
    var siloId = activeBiz || (inv && inv.wave_business_id) || t.wave_business_id || null; // v55.83-DZ
    // Compute CURRENT paid from live payment rows (not stale inv.amount_paid) so a second
    // deposit against the same invoice classifies partial/full/overpayment correctly.
    supabase.from('accounting_invoice_payments').select('amount, voided, sync_status').eq('accounting_invoice_id', inv.id).then(function (pr) {
      var waveImp = Number(inv.wave_imported_paid) || 0;
      var existingHub = 0;
      ((pr && pr.data) || []).forEach(function (p) { if (!p.voided && p.sync_status !== 'void') { existingHub += Number(p.amount) || 0; } });
      var paidNow = roundMoney(waveImp + existingHub);
      var c = classifyApplication(invoiceTotal(inv), paidNow, apply);
      return dbInsert('payment_matches', {
        business_id: biz, wave_business_id: siloId, bank_transaction_id: t.id, invoice_id: inv.id,
        matched_amount: c.applied_to_invoice, match_type: c.type, is_manual_override: false,
        notes: mNotes || null, matched_by: userProfile && userProfile.id, created_by: userProfile && userProfile.id,
      }, userProfile && userProfile.id)
      .then(function (matchRow) {
        return createInvPaymentRow(inv, t, c.applied_to_invoice, matchRow && matchRow.id, mNotes);
      })
      .then(function () {
        var chain = recomputeInvoice(inv.id);
        if (c.overpayment > 0 && mCustomerId) {
          chain = chain.then(function () {
            return dbInsert('customer_credits', { business_id: biz, wave_business_id: siloId, accounting_customer_id: mCustomerId, source_transaction_id: t.id, amount: c.overpayment, status: 'open', notes: 'Overpayment on invoice', created_by: userProfile && userProfile.id }, userProfile && userProfile.id);
          });
        }
        return chain;
      })
      .then(function () {
        return patchTxn(t, { classification: t.classification || 'customer_payment', accounting_customer_id: mCustomerId || t.accounting_customer_id, linked_type: 'invoice', linked_id: inv.id, matched_invoice_id: inv.id, review_status: t.review_status === 'unreviewed' ? 'reviewed' : t.review_status },
          'Matched ' + fmt(c.applied_to_invoice) + ' from bank txn to invoice ' + (inv.invoice_number || inv.id) + (c.overpayment > 0 ? (' (+' + fmt(c.overpayment) + ' credit)') : ''));
      })
      .then(function () {
        toast.success('Matched ' + fmt(c.applied_to_invoice) + (c.type === 'partial' ? ' (partial)' : '') + (c.overpayment > 0 ? ' · ' + fmt(c.overpayment) + ' to customer credit' : ''));
        onReload(); load();
      });
    })
    .catch(function (e) { console.error('[save] Match failed: ', e); toast.error('Match failed: ' + ((e && e.message) || 'unknown error — check console')); })
    .finally(function () { setBusy(false); });
  }
  function createUnapplied() {
    var t = sel; if (!t || !mayMatch) return;
    if (isLocked(t)) { toast.error('Approved — reopen first.'); return; }
    var amt = roundMoney(Number(mAmount));
    if (!(amt > 0)) { toast.error('Enter an amount.'); return; }
    setBusy(true);
    dbInsert('unapplied_deposits', { business_id: t.business_id, wave_business_id: (t.wave_business_id || getActiveWaveBusiness() || null), bank_transaction_id: t.id, accounting_customer_id: mCustomerId || null, amount: amt, status: 'open', notes: mNotes || null, created_by: userProfile && userProfile.id }, userProfile && userProfile.id)
      .then(function () { return patchTxn(t, { accounting_customer_id: mCustomerId || t.accounting_customer_id, classification: t.classification || 'customer_payment', review_status: t.review_status === 'unreviewed' ? 'reviewed' : t.review_status }, 'Created unapplied deposit ' + fmt(amt) + ' from bank txn ' + (t.name || t.id)); })
      .then(function () { toast.success('Unapplied deposit created — awaiting allocation'); load(); })
      .catch(function (e) { console.error('[save] Failed: ', e); toast.error('Failed: ' + ((e && e.message) || 'unknown error — check console')); })
      .finally(function () { setBusy(false); });
  }

  if (!canViewBank(isSuperAdmin, modulePerms)) {
    return (
      <div className="p-6">
        <div className="bg-amber-100 border-2 border-amber-300 rounded-lg p-4 text-amber-950">
          <div className="font-extrabold">🔒 Bank review restricted</div>
          <div className="text-sm font-medium mt-1">Viewing bank transactions requires the Bank: View permission.</div>
        </div>
      </div>
    );
  }
  if (loading) return <div className="p-6 text-slate-300">Loading bank transactions…</div>;

  // v55.83-BX (Part 7) — find the selected customer so Wave-imported invoices that
  // link by wave_customer_id (not accounting_customer_id) still appear. Never offer
  // void/cancelled/archived/deleted invoices to match against.
  var selectedCust = null; acctCustomers.forEach(function (c) { if (c.id === mCustomerId) selectedCust = c; });
  var invForCustomer = acctInvoices.filter(function (i) {
    if (sel && sel.business_id && i.business_id && sel.business_id !== i.business_id) return false; // guardrail
    var rs = i.record_status;
    if (rs === 'void' || rs === 'cancelled' || rs === 'archived' || rs === 'deleted') return false;
    if (!mCustomerId) return true;
    if (i.accounting_customer_id === mCustomerId) return true;
    if (selectedCust && selectedCust.wave_customer_id && i.wave_customer_id && i.wave_customer_id === selectedCust.wave_customer_id) return true;
    return false;
  }).sort(function (a, b) {
    // balance-first so open invoices surface above fully-paid ones
    var ba = invoiceTotal(a) - (Number(a.amount_paid) || 0); var bb = invoiceTotal(b) - (Number(b.amount_paid) || 0);
    return bb - ba;
  });

  return (
    <div className="p-4 text-slate-100">
      <div className="flex items-center justify-between mb-3">
        <div className="text-lg font-extrabold">🏦 Bank Review &amp; Matching</div>
        <button onClick={load} className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 rounded font-bold border border-slate-700">↻ Refresh</button>
      </div>

      {(function () {
        var activeBiz = getActiveWaveBusiness();
        var entry = registry.find(function (r) { return r.wave_business_id === activeBiz; });
        return (
          <SiloBanner
            registered={!!entry}
            isTest={!!(entry && entry.is_production === false)}
            canWrite={!!(entry && entry.writes_enabled === true)}
            label={entry ? (entry.label || activeBiz) : (activeBiz || 'No business selected')}
          />
        );
      })()}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-3 text-xs">
        <select value={fStatus} onChange={function (e) { setFStatus(e.target.value); }} className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100">
          <option value="all">All statuses</option>
          {REVIEW_STATUSES.map(function (s) { return <option key={s} value={s}>{labelize(s)}</option>; })}
        </select>
        <select value={fDirection} onChange={function (e) { setFDirection(e.target.value); }} className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100">
          <option value="all">In &amp; Out</option><option value="in">Money In</option><option value="out">Money Out</option>
        </select>
        <select value={fAccount} onChange={function (e) { setFAccount(e.target.value); }} className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100">
          <option value="all">All accounts</option>
          {accounts.map(function (a) { return <option key={a.id} value={a.id}>{a.label}</option>; })}
        </select>
        <input type="date" value={fFrom} onChange={function (e) { setFFrom(e.target.value); }} className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100" />
        <input type="date" value={fTo} onChange={function (e) { setFTo(e.target.value); }} className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100" />
        <input placeholder="Search name / amount / class" value={search} onChange={function (e) { setSearch(e.target.value); }} className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 flex-1 min-w-[160px]" />
        <label className="flex items-center gap-1 text-amber-300"><input type="checkbox" checked={fUnsupported} onChange={function (e) { setFUnsupported(e.target.checked); }} /> Unsupported only</label>
      </div>

      {(function () {
        var inSilo = txns.length;
        var showing = filtered.length;
        var hidden = inSilo - showing;
        var acctName = fAccount === 'all' ? 'All accounts' : (function () { var a = accounts.find(function (x) { return x.id === fAccount; }); return a ? a.label : fAccount; })();
        var unassignedNote = txns.some(function (t) { return !t.wave_business_id; });
        return (
          <div className="mb-3 rounded-lg bg-slate-800 border border-slate-600 px-3 py-2 text-xs text-slate-100 flex flex-wrap gap-x-4 gap-y-1">
            <span>Silo transactions: <b className="text-white">{inSilo}</b></span>
            <span>Account: <b className="text-white">{acctName}</b></span>
            <span>Status filter: <b className="text-white">{fStatus === 'all' ? 'All' : fStatus}</b></span>
            <span>Showing: <b className="text-white">{showing}</b></span>
            {hidden > 0 && <span className="text-amber-300">Hidden by filters: <b>{hidden}</b>{fAccount !== 'all' ? ' (mostly other accounts — pick All accounts to see them)' : ''}</span>}
            {accounts.length > 1 && fAccount === 'all' && <span className="text-slate-400">{accounts.length} accounts in this silo</span>}
            {unassignedNote && <span className="text-amber-300 font-bold">⚠ Some bank transactions are unassigned — assign them on the Bank tab before matching.</span>}
          </div>
        );
      })()}

      <div className="grid" style={{ gridTemplateColumns: sel ? '1fr 420px' : '1fr', gap: '12px' }}>
        {/* List */}
        <div className="border border-slate-700 rounded overflow-hidden">
          <div className="bg-slate-800/70 text-[11px] font-extrabold grid" style={{ gridTemplateColumns: '90px 70px 1fr 110px 120px 110px' }}>
            <div className="px-2 py-1.5">Date</div><div className="px-2 py-1.5">Dir</div><div className="px-2 py-1.5">Description</div>
            <div className="px-2 py-1.5 text-right">Amount</div><div className="px-2 py-1.5">Classification</div><div className="px-2 py-1.5">Status</div>
          </div>
          <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
            {filtered.length === 0 ? <div className="p-4 text-slate-400 italic text-sm">No transactions match these filters.</div> :
              filtered.map(function (t) {
                var matched = matchesByTxn[t.id] && matchesByTxn[t.id].length > 0;
                return (
                  <div key={t.id} onClick={function () { openTxn(t); }}
                       className={'grid items-center border-t border-slate-800 cursor-pointer hover:bg-slate-800/50 ' + (sel && sel.id === t.id ? 'bg-slate-800/70 ' : '') + (t.review_status === 'approved' ? 'opacity-80' : '')}
                       style={{ gridTemplateColumns: '90px 70px 1fr 110px 120px 110px' }}>
                    <div className="px-2 py-1.5 text-[11px] font-mono text-slate-300">{(t.posted_date || t.date || '').toString().substring(0, 10) || <span className="text-orange-300">pending</span>}</div>
                    <div className="px-2 py-1.5 text-[11px] font-bold">{t.direction === 'in' ? <span className="text-emerald-300">IN</span> : <span className="text-rose-300">OUT</span>}</div>
                    <div className="px-2 py-1.5 text-xs text-slate-100 truncate">{t.name}{t.unsupported_account ? <span className="ml-1 text-[10px] bg-amber-500/20 text-amber-200 border border-amber-500/40 rounded px-1">⚠ credit/loan</span> : null}{!t.posted_date ? <span className="ml-1 text-[10px] bg-orange-500/20 text-orange-200 rounded px-1">pending</span> : null}{matched ? <span className="ml-1 text-[10px] bg-indigo-500/20 text-indigo-200 rounded px-1">matched</span> : null}</div>
                    <div className="px-2 py-1.5 text-right text-xs font-mono font-bold text-slate-100">{seeAmounts ? fmt(t.amount_abs || Math.abs(Number(t.amount))) : maskAmount(null, false)}</div>
                    <div className="px-2 py-1.5 text-[11px] text-slate-300">{t.classification ? labelize(t.classification) : <span className="text-slate-500 italic">—</span>}</div>
                    <div className="px-2 py-1.5"><span className={'text-[10px] px-1.5 py-0.5 rounded font-bold ' + (t.review_status === 'approved' ? 'bg-blue-700 text-white' : t.review_status === 'reviewed' ? 'bg-emerald-700 text-white' : t.review_status === 'ignored' || t.review_status === 'duplicate' ? 'bg-slate-600 text-white' : t.review_status === 'needs_clarification' ? 'bg-amber-600 text-white' : 'bg-slate-700 text-slate-200')}>{labelize(t.review_status || 'unreviewed')}</span></div>
                  </div>
                );
              })}
          </div>
          <div className="bg-slate-800/40 text-[10px] text-slate-400 px-2 py-1">{filtered.length} shown{!seeAmounts ? ' · amounts hidden (no See Amounts permission)' : ''}</div>
        </div>

        {/* Detail / match panel */}
        {sel && (
          <div className="border border-slate-700 rounded bg-slate-900/60 p-3 text-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="font-extrabold text-slate-100 truncate">{sel.name}</div>
              <button onClick={function () { setSel(null); }} className="text-slate-400 hover:text-slate-200 text-xs">✕ close</button>
            </div>
            {sel.unsupported_account && <div className="bg-amber-100 text-amber-950 rounded p-2 text-xs font-semibold mb-2">⚠ Credit/loan account — money-in/out direction is NOT auto-verified for these. Review manually before approving.</div>}
            {isLocked(sel) && <div className="bg-blue-100 text-blue-950 rounded p-2 text-xs font-semibold mb-2 flex items-center justify-between"><span>🔒 Approved &amp; locked.</span>{mayReopen ? <button onClick={function () { reopen(sel); }} className="px-2 py-0.5 bg-blue-700 text-white rounded text-[11px] font-bold">Reopen to edit</button> : <span className="text-[11px]">Owner/Accounting only</span>}</div>}

            <div className="bg-white text-slate-900 rounded p-2 mb-2 text-xs font-medium">
              <div className="flex justify-between"><span>Direction</span><span className="font-bold">{sel.direction === 'in' ? 'Money In' : 'Money Out'}</span></div>
              <div className="flex justify-between"><span>Amount</span><span className="font-mono font-bold">{seeAmounts ? fmt(sel.amount_abs || Math.abs(Number(sel.amount))) : '•••••'}</span></div>
              <div className="flex justify-between"><span>Date</span><span>{(sel.posted_date || sel.date || 'pending').toString().substring(0, 10)}</span></div>
              <div className="flex justify-between"><span>Method</span><span>{labelize(sel.channel || 'other')}{sel.check_number ? ' #' + sel.check_number : ''}</span></div>
            </div>

            {/* Classification */}
            <div className="mb-2">
              <div className="text-[11px] text-slate-400 mb-1">Classification</div>
              <select value={sel.classification || ''} disabled={!mayClassify || isLocked(sel)} onChange={function (e) { setClassification(sel, e.target.value); }} className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-xs disabled:opacity-50">
                <option value="">— choose —</option>
                {CLASSIFICATIONS.map(function (c) { return <option key={c} value={c}>{labelize(c)}</option>; })}
              </select>
            </div>

            {matchesByTxn[sel.id] && matchesByTxn[sel.id].length > 0 && (
              <div className="bg-indigo-100 text-indigo-950 rounded p-2 text-xs font-semibold mb-2">
                <div className="font-bold mb-1">Matched</div>
                {matchesByTxn[sel.id].map(function (m) {
                  var inv = acctInvoices.find(function (i) { return i.id === m.invoice_id; });
                  var cust = inv ? acctCustomers.find(function (cc) { return cc.id === inv.accounting_customer_id; }) : null;
                  return <div key={m.id} className="flex items-center justify-between gap-2"><span>{cust ? (cust.company_name + ' · ') : ''}Invoice {(inv && (inv.invoice_number || inv.id)) || m.invoice_id} · {fmt(m.matched_amount)}{m.match_type ? (' · ' + labelize(m.match_type)) : ''}</span></div>;
                })}
                <div className="text-[10px] mt-0.5">Wave sync: Pending Wave sync (push is a later build).</div>
                {mayMatch && !isLocked(sel) && <button onClick={function () { unmatch(sel); }} disabled={busy} className="mt-1.5 px-2 py-1 bg-rose-700 hover:bg-rose-600 text-white rounded text-[11px] font-bold disabled:opacity-50">Unmatch (reverse)</button>}
                {isLocked(sel) && <div className="text-[10px] mt-1">Reopen the transaction to unmatch.</div>}
              </div>
            )}

            {/* Match to invoice */}
            {mayMatch && !isLocked(sel) && (
              <div className="border-t border-slate-700 pt-2 mb-2">
                <div className="text-[11px] font-bold text-slate-200 mb-1">Match to invoice</div>
                <Typeahead items={acctCustomers} value={mCustomerId} allowClear={true} placeholder="Search accounting customer…"
                  getLabel={function (c) { return (c.company_name || c.contact_name || c.id) + (c.email ? ' · ' + c.email : ''); }}
                  onPick={function (id) { setMCustomerId(id); setMInvoiceId(''); }} />
                <Typeahead items={invForCustomer} value={mInvoiceId} allowClear={true} placeholder="Search invoice…"
                  getLabel={function (i) { return (i.invoice_number || i.id) + ' · ' + (i.currency || 'USD') + ' ' + fmt(invoiceTotal(i)) + (i.wave_status ? ' · ' + i.wave_status : '') + (i.amount_paid ? (' · paid ' + fmt(i.amount_paid)) : ''); }}
                  onPick={function (id) { setMInvoiceId(id); }} />
                <div className="flex gap-1 mb-1">
                  <input value={mAmount} onChange={function (e) { setMAmount(e.target.value); }} placeholder="Amount to apply" className="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-xs" />
                  <button onClick={applyToInvoice} disabled={busy} className="px-2 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-bold disabled:opacity-50">Apply</button>
                </div>
                <button onClick={createUnapplied} disabled={busy} className="w-full px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[11px] font-bold border border-slate-700">Park as unapplied deposit</button>
                <div className="text-[10px] text-slate-500 mt-1">Partial applies what you enter; an overpayment automatically becomes a customer credit.</div>
              </div>
            )}

            {/* Split across multiple lines */}
            {mayMatch && !isLocked(sel) && (
              <div className="border-t border-slate-700 pt-2 mb-2">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[11px] font-bold text-slate-200">Split across multiple lines</div>
                  <button onClick={function () { var nx = !splitMode; setSplitMode(nx); if (nx && splitRows.length === 0) addSplitRow(); }} className="text-[11px] text-indigo-300">{splitMode ? 'hide' : 'split…'}</button>
                </div>
                {splitMode && (
                  <div>
                    {splitRows.map(function (r, i) {
                      return (
                        <div key={i} className="border border-slate-700 rounded p-1.5 mb-1 bg-slate-900/50">
                          <div className="flex gap-1 mb-1">
                            <input value={r.amount} onChange={function (e) { updSplitRow(i, 'amount', e.target.value); }} placeholder="Amount" className="w-24 bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-slate-100 text-[11px]" />
                            <select value={r.category} onChange={function (e) { updSplitRow(i, 'category', e.target.value); }} className="flex-1 bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-slate-100 text-[11px]">
                              <option value="">category…</option>
                              {CLASSIFICATIONS.map(function (c) { return <option key={c} value={c}>{labelize(c)}</option>; })}
                            </select>
                            <button onClick={function () { rmSplitRow(i); }} className="text-rose-300 text-[11px] px-1 font-bold">✕</button>
                          </div>
                          <Typeahead items={acctCustomers} value={r.customer_id} allowClear={true} placeholder="accounting customer (optional)"
                            getLabel={function (c) { return (c.company_name || c.contact_name || c.id) + (c.email ? ' · ' + c.email : ''); }}
                            onPick={function (id) { updSplitRow(i, 'customer_id', id); }} />
                          <Typeahead items={acctInvoices.filter(function (iv) { if (sel && sel.business_id && iv.business_id && sel.business_id !== iv.business_id) return false; return !r.customer_id || iv.accounting_customer_id === r.customer_id; })} value={r.invoice_id} allowClear={true} placeholder="invoice (optional)"
                            getLabel={function (iv) { return (iv.invoice_number || iv.id) + ' · ' + fmt(invoiceTotal(iv)); }}
                            onPick={function (id) { updSplitRow(i, 'invoice_id', id); }} />
                          <input value={r.notes} onChange={function (e) { updSplitRow(i, 'notes', e.target.value); }} placeholder="note" className="w-full bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-slate-100 text-[11px] mt-1" />
                        </div>
                      );
                    })}
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <button onClick={addSplitRow} className="text-indigo-300 font-bold">+ add line</button>
                      <span className="text-slate-300">Allocated {fmt(splitRows.reduce(function (a, r) { return a + (Number(r.amount) || 0); }, 0))} / {seeAmounts ? fmt(sel.amount_abs || Math.abs(Number(sel.amount))) : '•••••'}</span>
                    </div>
                    <button onClick={saveSplits} disabled={busy} className="w-full px-2 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-[11px] font-bold disabled:opacity-50">Save split</button>
                    <div className="text-[10px] text-slate-500 mt-1">Lines tied to an invoice also record a payment and update that invoice's balance. Total can't exceed the transaction.</div>
                  </div>
                )}
              </div>
            )}

            {/* Notes + actions */}
            <textarea value={mNotes} onChange={function (e) { setMNotes(e.target.value); }} placeholder="Notes" className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-xs mb-2" rows={2} />
            <div className="flex flex-wrap gap-1">
              <button onClick={function () { setStatus(sel, 'reviewed'); }} disabled={busy || isLocked(sel)} className="px-2 py-1 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-[11px] font-bold disabled:opacity-50">Save reviewed</button>
              <button onClick={function () { approve(sel); }} disabled={busy} className="px-2 py-1 bg-blue-700 hover:bg-blue-600 text-white rounded text-[11px] font-bold disabled:opacity-50">Approve</button>
              <button onClick={function () { setStatus(sel, 'ignored', true); }} disabled={busy || isLocked(sel)} className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-white rounded text-[11px] font-bold disabled:opacity-50">Ignore</button>
              <button onClick={function () { setStatus(sel, 'duplicate', true); }} disabled={busy || isLocked(sel)} className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-white rounded text-[11px] font-bold disabled:opacity-50">Duplicate</button>
              <button onClick={function () { setStatus(sel, 'needs_clarification', true); }} disabled={busy || isLocked(sel)} className="px-2 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded text-[11px] font-bold disabled:opacity-50">Needs clarification</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
