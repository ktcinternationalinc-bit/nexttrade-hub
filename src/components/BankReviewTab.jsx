// v55.83-Z — Phase 2: Bank transaction review + classification + matching UI.
// Money math comes from src/lib/payment-matching.js (validated). Permissions from
// src/lib/bank-permissions.js. No Wave sync here. No deletes. Approved = locked.
import { useState, useEffect, useMemo, useRef } from 'react';
import RestrictedNotice from './RestrictedNotice';
import SiloBanner from './SiloBanner';
import { assertMatchSameSilo } from '../lib/wave-silo-guard';
import { supabase, dbInsert, dbUpdate, logActivity } from '../lib/supabase';
import { fetchAllRows } from '../lib/fetch-all-rows';
import { getActiveWaveBusiness, scopeIfRegistered } from '../lib/wave-business';
import {
  canViewBank, canSeeAmounts, canClassify, canMatchPayments, canReopen,
  maskAmount, CLASSIFICATIONS, REVIEW_STATUSES,
} from '../lib/bank-permissions';
import { classifyApplication, computeInvoiceBalance, validateSplit, bankAllocationStatus, roundMoney, isPaymentVoid } from '../lib/payment-matching';
import { floorDateFor, labelForWindow } from '../lib/visibility-window';

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
  // v55.83-LE (Max: "only ~10 chart of accounts… where are the rest" / Codex transparency FAIL) — the
  // picker used to hard-cap at 10, so the rest of a full chart of accounts was invisible (it was there,
  // just not rendered). Show a generous, scrollable window (50) and ALWAYS surface the true total +
  // how many more match, so the full list is reachable by typing and the count is never a mystery.
  var CAP = 50;
  var filtered = q.trim() ? items.filter(function (x) { return getLabel(x).toLowerCase().indexOf(q.trim().toLowerCase()) >= 0; }) : items;
  var shown = filtered.slice(0, CAP);
  var more = filtered.length - shown.length;
  return (
    <div className="relative mb-1">
      <input value={open ? q : (selected ? getLabel(selected) : '')} placeholder={props.placeholder}
        onFocus={function () { setOpen(true); setQ(''); }}
        onBlur={function () { setTimeout(function () { setOpen(false); }, 150); }}
        onChange={function (e) { setQ(e.target.value); setOpen(true); }}
        className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-xs" />
      {open && (
        <div className="absolute z-20 left-0 right-0 bg-slate-900 border border-slate-600 rounded mt-0.5 max-h-64 overflow-auto shadow-xl">
          {props.allowClear && <div onMouseDown={function () { onPick(''); setOpen(false); }} className="px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-800 cursor-pointer">— clear —</div>}
          {shown.length === 0 ? <div className="px-2 py-1 text-[11px] text-slate-500 italic">no matches{items.length ? (' (' + items.length + ' available — adjust your search)') : ''}</div> :
            shown.map(function (x) { return <div key={x.id} onMouseDown={function () { onPick(x.id); setOpen(false); }} className="px-2 py-1 text-[11px] text-slate-100 hover:bg-indigo-600/40 cursor-pointer">{getLabel(x)}</div>; })}
          {more > 0 && <div className="px-2 py-1 text-[10px] text-amber-300 bg-slate-950 sticky bottom-0 border-t border-slate-700">+{more} more of {filtered.length} — type to narrow</div>}
          {more === 0 && shown.length > 0 && <div className="px-2 py-1 text-[10px] text-slate-500 bg-slate-950 sticky bottom-0 border-t border-slate-800">{shown.length} shown{q.trim() ? '' : (' of ' + items.length + ' total')}</div>}
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
  var [paysByTxn, setPaysByTxn] = useState({});   // v55.83-ID — non-voided payment rows per bank txn (orphan detection)
  var [allocByTxn, setAllocByTxn] = useState({}); // v55.83-JC — {paid,split,unapplied} per bank txn (money-conservation gate)
  var [visCfg, setVisCfg] = useState({ window: 'all', customDays: null, customFrom: null }); // v55.83-JE — admin history-visibility window
  // The active date floor: null for super-admin or "all history". Normal users are clamped to it.
  var visFloor = floorDateFor({ window: visCfg.window, customDays: visCfg.customDays, customFrom: visCfg.customFrom, isSuperAdmin: isSuperAdmin }, new Date());
  var [acctCustomers, setAcctCustomers] = useState([]);
  var [acctInvoices, setAcctInvoices] = useState([]);
  var [registry, setRegistry] = useState([]);
  var [plaidAccts, setPlaidAccts] = useState({});
  function bizLabel(id) { if (!id) { return 'All businesses'; } var e = registry.find(function (r) { return r.wave_business_id === id; }); return e ? (e.label || id) : id; }
  var [loading, setLoading] = useState(true);
  var [sel, setSel] = useState(null);            // selected transaction
  var deepLinkRef = useRef(false);               // v55.83-IN — one-shot guard for the Bank-tab deep-link
  var [busy, setBusy] = useState(false);

  // filters
  var [fStatus, setFStatus] = useState('unreviewed');
  var [fDirection, setFDirection] = useState('all');
  var [fAccount, setFAccount] = useState('all');
  var [autoAcctDone, setAutoAcctDone] = useState(false);
  var [fUnsupported, setFUnsupported] = useState(false);
  var [search, setSearch] = useState('');
  var [fFrom, setFFrom] = useState('');
  var [fTo, setFTo] = useState('');

  // match panel working state
  var [mCustomerId, setMCustomerId] = useState('');
  var [mInvoiceId, setMInvoiceId] = useState('');
  var [mAmount, setMAmount] = useState('');
  var [editMatchAmt, setEditMatchAmt] = useState({}); // v55.83-KD — per-match amount editor (reverse & re-apply)
  var [mNotes, setMNotes] = useState('');
  var [splitMode, setSplitMode] = useState(false);
  var [splitRows, setSplitRows] = useState([]);
  var [waveCategories, setWaveCategories] = useState([]);
  var [catDiag, setCatDiag] = useState(null); // v55.83-JA — {total, usable, hidden_receivable, error} for the dropdown empty-state
  var [catPulling, setCatPulling] = useState(false); // v55.83-KF — inline "Pull Wave categories now"
  var [catPullMsg, setCatPullMsg] = useState(null);

  async function load() {
    setLoading(true);
    // v55.83-IT (Codex FAIL — data consistency) — scope by the active silo at the QUERY before the
    // 1000 limit, exactly like BankTab. Previously a global limit(1000) could fill up with other
    // silos' newer rows and leave the active silo a stale subset (KTC 6338 "stopping at June 11").
    var _activeBizRev = getActiveWaveBusiness();
    // v55.83-JE — admin history-visibility window. Fetch the org policy, then clamp the query by
    // posted_date for NON-super-admins. Super-admins (visFloor null) always see all stored history.
    var _floor = visFloor;
    try {
      var _vr = await fetch('/api/admin/visibility').then(function (r) { return r.json(); }).catch(function () { return null; });
      if (_vr && _vr.value) { setVisCfg(_vr.value); _floor = floorDateFor({ window: _vr.value.window, customDays: _vr.value.customDays, customFrom: _vr.value.customFrom, isSuperAdmin: isSuperAdmin }, new Date()); }
    } catch (eVis) {}
    var _txQRev = supabase.from('bank_transactions').select('*').order('posted_date', { ascending: false, nullsFirst: false });
    if (_activeBizRev) { _txQRev = _txQRev.eq('wave_business_id', _activeBizRev); }
    if (_floor) { _txQRev = _txQRev.gte('posted_date', _floor); }
    _txQRev = _txQRev.limit(1000);
    Promise.all([
      _txQRev,
      supabase.from('payment_matches').select('*'),
      fetchAllRows('accounting_customers', '*', 'company_name', true),
      fetchAllRows('accounting_invoices', '*', 'created_at', false),
      fetchAllRows('wave_business_registry', '*'),
      supabase.from('plaid_accounts').select('*'),
      supabase.from('wave_categories').select('wave_business_id, wave_account_id, wave_account_name, type, subtype, is_active').eq('is_active', true),
      supabase.from('wave_business_settings').select('wave_business_id, default_plaid_account_id'),
      supabase.from('accounting_invoice_payments').select('id, bank_transaction_id, accounting_invoice_id, amount, voided, sync_status, wave_payment_id'),
      supabase.from('bank_transaction_splits').select('bank_transaction_id, split_amount, linked_type'),
      supabase.from('unapplied_deposits').select('bank_transaction_id, amount, status'),
      supabase.from('customer_credits').select('source_transaction_id, amount, status'),
    ]).then(function (res) {
      var reg = (res[4] && res[4].data) || []; var t = scopeIfRegistered((res[0] && res[0].data) || [], getActiveWaveBusiness(), reg, true);
      // v55.83-IC (Codex FAIL) — only ACTIVE matches drive the Matched badge / detail panel /
      // unmatch button. Voided payment_matches stay in the DB for audit but must NOT make a
      // transaction look matched (otherwise an unmatched txn still shows as matched).
      var m = ((res[1] && res[1].data) || []).filter(function (x) { return x && x.voided !== true; });
      var byTxn = {};
      m.forEach(function (x) { (byTxn[x.bank_transaction_id] = byTxn[x.bank_transaction_id] || []).push(x); });
      // v55.83-ID — non-voided payment rows grouped by bank txn. Used to detect ORPHAN payments
      // (a recorded payment with no active match) so they can be reversed instead of being stuck.
      var paysBy = {};
      // v55.83-JC — accumulate every piecewise disposition per bank txn for the money-conservation
      // gate: invoice payments + saved split lines + open unapplied deposits.
      var allocBy = {};
      function bucket(id) { if (!allocBy[id]) { allocBy[id] = { paid: 0, split: 0, unapplied: 0 }; } return allocBy[id]; }
      ((res[8] && res[8].data) || []).forEach(function (p) {
        if (!p || !p.bank_transaction_id || isPaymentVoid(p)) { return; }
        (paysBy[p.bank_transaction_id] = paysBy[p.bank_transaction_id] || []).push(p);
        bucket(p.bank_transaction_id).paid += Number(p.amount) || 0;
      });
      ((res[9] && res[9].data) || []).forEach(function (s) {
        if (!s || !s.bank_transaction_id) { return; }
        // v55.83-JK — an invoice-linked split also has a payment row for the same dollars; counting
        // both double-counts. Exclude linked_type==='invoice' here, exactly like the server.
        if (String(s.linked_type || '') === 'invoice') { return; }
        bucket(s.bank_transaction_id).split += Number(s.split_amount) || 0;
      });
      ((res[10] && res[10].data) || []).forEach(function (u) {
        if (!u || !u.bank_transaction_id) { return; }
        if (u.status && u.status !== 'open') { return; } // only open (still-unallocated) deposits count as allocation of the deposit
        bucket(u.bank_transaction_id).unapplied += Number(u.amount) || 0;
      });
      // v55.83-JH (Codex P0) — overpayment can land in customer_credits (keyed by source_transaction_id),
      // not unapplied_deposits. Count OPEN, non-void credits too, or an over-paid deposit looks short in
      // the UI and is wrongly blocked. Mirrors the server allocationForTxn.
      ((res[11] && res[11].data) || []).forEach(function (c) {
        if (!c || !c.source_transaction_id) { return; }
        if (c.status && c.status !== 'open') { return; } // reversed credits are status 'void' — excluded (schema-safe: no `voided` column dependency)
        bucket(c.source_transaction_id).unapplied += Number(c.amount) || 0;
      });
      var pa = {}; ((res[5] && res[5].data) || []).forEach(function (a) { if (a.plaid_account_id) { pa[a.plaid_account_id] = a; } });
      setPlaidAccts(pa);
      // Wave categories scoped to the active silo, for the categorization dropdown.
      // v55.83-GR — dedupe by wave_account_id and drop receivable / system-receivable accounts.
      // Those aren't valid manual categories (a customer payment links to an invoice + the Wave
      // payment account, not to A/R), and Wave returns several near-identical receivable rows,
      // which made the dropdown unusable ("Accounts Receivable / System Receivable / Invoice" spam).
      var activeBiz = getActiveWaveBusiness();
      var seenAcct = {};
      var cats = ((res[6] && res[6].data) || []).filter(function (c) {
        if (activeBiz && c.wave_business_id !== activeBiz) { return false; }
        if (!c.wave_account_id || seenAcct[c.wave_account_id]) { return false; }
        seenAcct[c.wave_account_id] = true;
        var sub = String(c.subtype || '').toUpperCase();
        var nm = String(c.wave_account_name || '').toUpperCase();
        if (sub.indexOf('RECEIVABLE') >= 0 || nm.indexOf('RECEIVABLE') >= 0) { return false; }
        return true;
      });
      setWaveCategories(cats); // fallback (client query); the service-role route below is authoritative
      setRegistry(reg);
      setTxns(t); setMatchesByTxn(byTxn); setPaysByTxn(paysBy); setAllocByTxn(allocBy);
      // v55.83-JA — load categories via the SERVICE-ROLE route too (bypasses RLS). The client query
      // above can come back empty under RLS even when Sync Center shows "89 loaded". The route returns
      // the usable list + diagnostic counts so the dropdown is authoritative and the empty-state honest.
      reloadCats();
      // v55.83-GD — auto-load this silo's default bank account into the account filter, once per
      // mount (the component remounts on silo switch via its key). User can still switch manually.
      try {
        var activeBizA = getActiveWaveBusiness();
        if (!autoAcctDone && activeBizA) {
          var defAcct = null;
          ((res[7] && res[7].data) || []).forEach(function (s) { if (s && s.wave_business_id === activeBizA && s.default_plaid_account_id) { defAcct = s.default_plaid_account_id; } });
          if (defAcct && t.some(function (x) { return x.account_id === defAcct; })) { setFAccount(maskKeyOf(defAcct, pa)); }
          setAutoAcctDone(true);
        }
      } catch (eAuto) {}
      setAcctCustomers(scopeIfRegistered((res[2] && res[2].data) || [], getActiveWaveBusiness(), reg, true));
      setAcctInvoices(scopeIfRegistered((res[3] && res[3].data) || [], getActiveWaveBusiness(), reg, true));
      setSel(function (cur) { if (!cur) { return cur; } var fr = null; t.forEach(function (x) { if (x.id === cur.id) { fr = x; } }); return fr || cur; });
      // v55.83-IN — deep-link from the Bank tab "Match in Bank Review" button: auto-open the txn.
      var deepId = props.deepLink && props.deepLink.txnId;
      if (deepId && !deepLinkRef.current) {
        deepLinkRef.current = true;
        var deepHit = null;
        t.forEach(function (x) { if (x.id === deepId) { deepHit = x; } });
        if (deepHit) {
          // v55.83-IT (Codex FAIL) — preserve the bank-account context the user came from instead of
          // resetting to All accounts. Clear status/search so the row is visible, but keep its account.
          setFStatus('all'); setFAccount(deepHit.account_id ? maskKeyOf(deepHit.account_id, pa) : 'all'); setSearch('');
          openTxn(deepHit);
          if (toast && toast.success) { toast.success('Opened the transaction for matching.'); }
        } else if (toast && toast.error) {
          toast.error('That bank transaction is not loaded in Bank Review here — set the account to the right one and widen the date range, then click it.');
        }
      }
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
  // v55.83-KY — the account FILTER must show ONE entry per real account. Reconnecting a bank gives the
  // same account a new id, so two "··6338" used to appear. Key by mask so duplicates collapse into one
  // entry, and selecting it shows that real account's transactions across BOTH ids (current + historical).
  function maskKeyOf(accountId, mapOverride) { var a = (mapOverride || plaidAccts)[accountId]; return (a && a.mask) ? ('mask:' + a.mask) : ('acct:' + accountId); }
  var accounts = useMemo(function () {
    var s = {}; var order = [];
    txns.forEach(function (t) { if (!t.account_id) { return; } var k = maskKeyOf(t.account_id); if (!s[k]) { s[k] = acctLabel(t); order.push(k); } });
    return order.map(function (k) { return { id: k, label: s[k] }; });
  }, [txns, plaidAccts]);

  var filtered = useMemo(function () {
    var list = txns.slice();
    if (fStatus !== 'all') list = list.filter(function (t) { return (t.review_status || 'unreviewed') === fStatus; });
    if (fDirection !== 'all') list = list.filter(function (t) { return t.direction === fDirection; });
    if (fAccount !== 'all') list = list.filter(function (t) { return maskKeyOf(t.account_id) === fAccount; });
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
  // v55.83-IP — route core Bank Review writes through the SERVICE-ROLE server endpoint so they
  // bypass row-level-security (the app authenticates by email, so client writes were being silently
  // filtered to 0 rows by auth.uid()-based RLS). Returns the parsed JSON or throws with the reason.
  function bankWrite(action, payload) {
    var bodyObj = Object.assign({ action: action, user_id: userProfile && userProfile.id }, payload || {});
    return fetch('/api/accounting/bank-write', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyObj) })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (!j || !j.ok) { throw new Error((j && j.error) || 'Server rejected the write.'); } return j; });
  }

  function patchTxn(t, patch, activity) {
    // v55.83-IN — return the updated row so callers can VERIFY the write actually persisted
    // (a silent 0-row / RLS-filtered update would otherwise look like a successful save).
    return dbUpdate('bank_transactions', t.id, Object.assign({ updated_by: userProfile && userProfile.id }, patch), userProfile && userProfile.id)
      .then(function (row) { if (activity) logActivity(userProfile && userProfile.id, activity, 'bank_review'); return row; });
  }

  // v55.83-KF — load the silo's usable Wave categories via the service-role route (RLS-proof).
  function reloadCats() {
    var abiz = getActiveWaveBusiness();
    if (!abiz || abiz === 'all') { setCatDiag(null); return; }
    fetch('/api/wave/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wave_business_id: abiz, user_id: userProfile && userProfile.id }) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.ok) { setWaveCategories(j.categories || []); setCatDiag({ total: j.total, usable: j.usable_count, hidden_receivable: j.hidden_receivable_count, error: null }); }
        else { setCatDiag({ error: (j && j.error) || 'category load failed' }); }
      })
      .catch(function (e) { setCatDiag({ error: (e && e.message) || 'network error' }); });
  }

  // v55.83-KF (Max — "for the 100th time, categories aren't flowing"): pull THIS silo's Wave Chart of
  // Accounts on demand, right from Bank Review, and surface the exact Wave result inline (incl. a Wave
  // access error verbatim — the usual root cause is the configured token not seeing this Wave business).
  function pullCategories() {
    var abiz = getActiveWaveBusiness();
    if (!abiz || abiz === 'all') { toast.error('Pick a specific silo (top of page) first.'); return; }
    setCatPulling(true); setCatPullMsg(null);
    fetch('/api/wave/sync-categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wave_business_id: abiz, includeProduction: true, user_id: userProfile && userProfile.id }) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.ok) {
          var res = (j.results && j.results[0]) || {};
          if (res.ok === false) { setCatPullMsg('✕ Wave rejected this silo: ' + (res.error || 'unknown') + '. The configured Wave token likely can\'t access this Wave business — that\'s why the dropdown is empty.'); }
          else { setCatPullMsg('✓ Pulled from Wave: ' + (res.created || 0) + ' new, ' + (res.updated || 0) + ' updated, ' + (res.skipped || 0) + ' unchanged. Reloading…'); reloadCats(); }
        } else { setCatPullMsg('✕ Pull failed: ' + ((j && j.error) || 'unknown')); }
      })
      .catch(function (e) { setCatPullMsg('✕ Pull error: ' + ((e && e.message) || 'network')); })
      .finally(function () { setCatPulling(false); });
  }

  function setClassification(t, cls) {
    if (!mayClassify) { toast.error('You do not have Bank: Classify permission.'); return; }
    if (isLocked(t)) { toast.error('Approved — reopen first to edit.'); return; }
    setBusy(true);
    // v55.83-GS — a classification change is Wave-impacting, so mark the txn pending Wave sync
    // (category_status doubles as the bank-txn Wave-sync flag). This is what makes it appear in
    // the Wave Sync Center (as Hub-only/unsupported for now) instead of silently staying hidden.
    var clsPatch = { classification: cls, review_status: t.review_status === 'unreviewed' ? 'reviewed' : t.review_status, category_status: 'pending_wave_sync', category_source: t.category_source || 'classification' };
    // v55.83-IP — service-role endpoint (bypasses RLS) so the categorization persists.
    bankWrite('classify', { bank_transaction_id: t.id, patch: clsPatch })
      .then(function () { toast.success('Classified as ' + labelize(cls)); setSel(Object.assign({}, t, clsPatch)); load(); })
      .catch(function (e) { console.error('[save] Failed: ', e); toast.error('Could not classify: ' + ((e && e.message) || 'unknown error') + ' (screenshot for Claude)'); })
      .finally(function () { setBusy(false); });
  }

  // v55.83-FZ — main Wave-category (Chart of Accounts) selector for a whole transaction (not just
  // inside split mode). Stores the REAL Wave account fields so it can later be pushed to Wave.
  // Requires bank_transactions category columns (see SQL handed to Max).
  function setWaveCategory(t, accountId) {
    if (!mayClassify) { toast.error('You do not have Bank: Classify permission.'); return; }
    if (isLocked(t)) { toast.error('Approved — reopen first to edit.'); return; }
    var patch;
    if (!accountId) {
      patch = { wave_account_id: null, wave_account_name: null, wave_account_type: null, wave_account_subtype: null, category_source: null, category_status: 'local_only' };
    } else {
      var cat = null; waveCategories.forEach(function (c) { if (c.wave_account_id === accountId) { cat = c; } });
      if (!cat) { return; }
      patch = { wave_account_id: cat.wave_account_id, wave_account_name: cat.wave_account_name, wave_account_type: cat.type || null, wave_account_subtype: cat.subtype || null, category_source: 'wave', category_status: 'pending_wave_sync', review_status: t.review_status === 'unreviewed' ? 'reviewed' : t.review_status };
    }
    setBusy(true);
    // v55.83-IP — service-role endpoint (bypasses RLS) so the Wave category persists.
    bankWrite('set_wave_category', { bank_transaction_id: t.id, patch: patch })
      .then(function () { setSel(Object.assign({}, t, patch)); toast.success(accountId ? ('Wave category: ' + patch.wave_account_name) : 'Category cleared'); load(); })
      .catch(function (e) { console.error('[wave-cat] save', e); toast.error('Could not save category: ' + ((e && e.message) || 'unknown error') + ' (screenshot for Claude)'); })
      .finally(function () { setBusy(false); });
  }

  // Group loaded (already silo-scoped) Wave categories by account type, ordering the groups by
  // relevance to the transaction direction (money-out shows EXPENSE/COGS first; money-in INCOME).
  function orderedCatGroups(direction) {
    var groups = {};
    waveCategories.forEach(function (c) { var ty = c.type || 'OTHER'; if (!groups[ty]) { groups[ty] = []; } groups[ty].push(c); });
    var order = direction === 'out'
      ? ['EXPENSE', 'COST_OF_GOODS_SOLD', 'LIABILITY', 'ASSET', 'INCOME', 'EQUITY']
      : ['INCOME', 'ASSET', 'LIABILITY', 'EXPENSE', 'EQUITY'];
    var keys = Object.keys(groups).sort(function (a, b) {
      var ia = order.indexOf(a); var ib = order.indexOf(b);
      if (ia < 0) { ia = 99; } if (ib < 0) { ib = 99; }
      if (ia !== ib) { return ia - ib; }
      return a.localeCompare(b);
    });
    return keys.map(function (k) { return { type: k, items: groups[k].slice().sort(function (x, y) { return String(x.wave_account_name).localeCompare(String(y.wave_account_name)); }) }; });
  }

  // v55.83-JC — money-conservation status for a transaction (see bankAllocationStatus). Uses the
  // allocation map built in load(). A transaction allocated piecewise (invoice payments / splits /
  // unapplied deposits) is only "complete" when those sum to the full transaction amount.
  function txnAllocation(t) {
    if (!t) { return bankAllocationStatus({ txnAmount: 0 }); }
    var a = allocByTxn[t.id] || { paid: 0, split: 0, unapplied: 0 };
    var total = Number(t.amount_abs != null ? t.amount_abs : Math.abs(Number(t.amount) || 0));
    return bankAllocationStatus({ txnAmount: total, paid: a.paid, split: a.split, unapplied: a.unapplied });
  }

  function setStatus(t, status, reasonRequired) {
    if (isLocked(t) && status !== 'approved') { toast.error('Approved — reopen first.'); return; }
    // v55.83-JC — ACCOUNTING INTEGRITY: never let a partially-allocated transaction become reviewed/
    // approved. Money must be fully accounted for first (invoice payment + splits + unapplied =
    // transaction total), or explicitly carried as needs_clarification.
    if (status === 'reviewed' || status === 'approved') {
      var allocS = txnAllocation(t);
      if (allocS.overAllocated) { toast.error('Over-allocated by ' + fmt(Math.abs(allocS.remaining)) + ' — remove or reduce a line before marking ' + labelize(status) + '.'); return; }
      if (!allocS.complete) { toast.error(fmt(allocS.remaining) + ' of this ' + fmt(allocS.total) + ' transaction is unallocated. Apply it to an invoice, split it, park it as unapplied, or mark the remainder Uncategorized / Needs review before marking ' + labelize(status) + '.'); return; }
    }
    var reason = '';
    if (reasonRequired) { reason = window.prompt('Reason for marking ' + labelize(status) + ':') || ''; if (!reason.trim()) { toast.error('Reason required.'); return; } }
    setBusy(true);
    var noteVal = reason ? ((t.notes || '') + (t.notes ? ' | ' : '') + labelize(status) + ': ' + reason.trim()) : null;
    // v55.83-IP — go through the service-role endpoint (bypasses RLS) so the status actually persists.
    bankWrite('set_status', { bank_transaction_id: t.id, status: status, notes: noteVal })
      .then(function (j) {
        var row = j && j.row;
        if (row && row.review_status === status) { toast.success('Marked ' + labelize(status)); }
        else { toast.error('Saved, but the status did not read back as expected. Refresh and verify.'); }
        load(); setSel(null);
      })
      .catch(function (e) { console.error('[save] Failed: ', e); toast.error('Save failed: ' + ((e && e.message) || 'unknown error') + ' (screenshot this for Claude)'); })
      .finally(function () { setBusy(false); });
  }

  function approve(t) {
    if (!mayMatch && !isSuperAdmin) { toast.error('Approval requires Payments: Match (or admin).'); return; }
    // v55.83-JC — same money-conservation gate as setStatus: a partially-allocated transaction can
    // never be approved/locked. Approve is the point of no return for Wave, so this is the hard stop.
    var allocA = txnAllocation(t);
    if (allocA.overAllocated) { toast.error('Over-allocated by ' + fmt(Math.abs(allocA.remaining)) + ' — fix the lines before approving.'); return; }
    if (!allocA.complete) { toast.error(fmt(allocA.remaining) + ' of this ' + fmt(allocA.total) + ' transaction is unallocated. Every dollar must be accounted for before approving — apply it to an invoice, split it, park it as unapplied, or mark the remainder Uncategorized / Needs review.'); return; }
    setBusy(true);
    // v55.83-IP — service-role endpoint (bypasses RLS).
    bankWrite('set_status', { bank_transaction_id: t.id, status: 'approved' })
      .then(function (j) {
        var row = j && j.row;
        if (row && row.review_status === 'approved') { toast.success('Approved & locked'); }
        else { toast.error('Saved, but did not read back as approved. Refresh and verify.'); }
        load(); setSel(null);
      })
      .catch(function (e) { console.error('[save] Failed: ', e); toast.error('Approve failed: ' + ((e && e.message) || 'unknown error') + ' (screenshot this for Claude)'); })
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
      return supabase.from('accounting_invoice_payments').select('amount, voided, sync_status').eq('accounting_invoice_id', invId).then(function (r) {
        // v55.83-IM (QA fix) — Supabase resolves with {error} (no throw). If we don't check it,
        // a failed read yields hubPaid=0 and we'd WRITE a wrong amount_paid/balance_due, corrupting
        // a correct invoice. Throw so the caller's .catch surfaces it and we never persist bad math.
        if (r && r.error) { throw r.error; }
        var total = invoiceTotal(inv);
        var waveImported = (inv && Number(inv.wave_imported_paid)) || 0;
        var hubPaid = 0;
        ((r && r.data) || []).forEach(function (p) { if (!isPaymentVoid(p)) { hubPaid += Number(p.amount) || 0; } });
        var amountPaid = Math.round((waveImported + hubPaid) * 100) / 100;
        var balanceDue = Math.round((total - amountPaid) * 100) / 100;
        if (balanceDue < 0) { balanceDue = 0; } // overpayment goes to customer_credits, not negative balance
        var status = balanceDue <= 0.0001 ? 'paid' : (amountPaid > 0.0001 ? 'partial' : 'unpaid');
        return dbUpdate('accounting_invoices', invId, { amount_paid: amountPaid, balance_due: balanceDue, payment_status: status }, userProfile && userProfile.id);
      });
    }
    if (inMem) { return compute(inMem); }
    return supabase.from('accounting_invoices').select('*').eq('id', invId).then(function (r) {
      if (r && r.error) { throw r.error; } // v55.83-IM — don't silently skip recompute on a failed fetch
      var inv = (r && r.data && r.data.length) ? r.data[0] : null;
      return compute(inv);
    });
  }

  function unmatch(t) {
    if (!t || !mayMatch) { toast.error('You do not have Payments: Match permission.'); return; }
    if (isLocked(t)) { toast.error('Approved — reopen first.'); return; }
    var ms = matchesByTxn[t.id] || [];
    var orphanPays = paysByTxn[t.id] || [];
    // v55.83-ID — also allow reversing a recorded payment that has NO active match (orphan), so
    // such a payment isn't stuck. The void+recompute below keys on bank_transaction_id either way.
    if (ms.length === 0 && orphanPays.length === 0) { toast.error('Nothing to unmatch on this transaction.'); return; }
    // v55.83-IE (Codex FAIL) — do NOT locally void a payment that has already been pushed to Wave
    // (has a wave_payment_id, or sync_status synced/manual_done). Local-only reversal would leave
    // the Hub and Wave out of sync. Reverse it in Wave first, then re-import/reconcile.
    var syncedPay = (paysByTxn[t.id] || []).some(function (p) { return p && (p.wave_payment_id || p.sync_status === 'synced' || p.sync_status === 'manual_done'); });
    if (syncedPay) { toast.error('This payment was already pushed to Wave. Reverse/remove it in Wave first, then run Wave import/reconcile. Local reverse is blocked to keep the Hub and Wave in sync.'); return; }
    var _confirmMsg = ms.length === 0
      ? 'Reverse the recorded payment on this transaction?\n\nThis voids the payment row(s) and restores the invoice balance(s). It is logged, not hard-deleted.'
      : 'Unmatch this payment?\n\nThe invoice balance will be restored. This REVERSES the match (it is voided + logged, not hard-deleted) and can be re-matched afterwards.';
    if (!window.confirm(_confirmMsg)) { return; }
    setBusy(true);
    // v55.83-IS (Codex CORE FAIL) — reverse/unmatch must NOT use client-side Supabase writes (same
    // RLS trap as match: they can silently 0-row under live RLS). Route the whole reversal through the
    // service-role endpoint, which voids the payment rows + matches + overpayment credits, recomputes
    // every affected invoice, and unlinks the bank txn — atomically, RLS-proof.
    bankWrite('unmatch', { bank_transaction_id: t.id, wave_business_id: t.wave_business_id || getActiveWaveBusiness() || null })
      .then(function () { toast.success('Unmatched — invoice balance restored'); onReload(); load(); setSel(null); })
      .catch(function (e) { console.error('[unmatch]', e); toast.error('Unmatch failed: ' + ((e && e.message) || 'unknown error') + ' — screenshot for Claude.'); })
      .finally(function () { setBusy(false); });
  }

  // v55.83-KD (Codex P0 — "editing a matched amount silently no-ops") — there was NO way to change an
  // existing match's amount; the amount field below only ADDS a new match. This reverses the current
  // match(es) on the deposit and re-applies the chosen amount to the same invoice, via the already-tested
  // service-role unmatch + match_invoice routes (atomic each), so an edit actually persists.
  function updateMatchAmount(m) {
    var t = sel; if (!t || !mayMatch) { toast.error('You do not have Payments: Match permission.'); return; }
    if (isLocked(t)) { toast.error('Approved — reopen first.'); return; }
    var inv = acctInvoices.find(function (i) { return i.id === m.invoice_id; });
    if (!inv) { toast.error('Could not find the matched invoice.'); return; }
    var newAmt = roundMoney(Number(editMatchAmt[m.id]));
    if (!(newAmt > 0)) { toast.error('Enter a new amount greater than zero.'); return; }
    var depositAmt = roundMoney(Number(t.amount_abs != null ? t.amount_abs : (t.amount || 0)));
    if (depositAmt > 0 && newAmt > depositAmt + 0.01) { toast.error('Amount can\'t exceed the deposit (' + fmt(depositAmt) + ').'); return; }
    var syncedPay = (paysByTxn[t.id] || []).some(function (p) { return p && (p.wave_payment_id || p.sync_status === 'synced' || p.sync_status === 'manual_done'); });
    if (syncedPay) { toast.error('This payment was already pushed to Wave — change it in Wave, then re-import. Local edit is blocked to keep Hub and Wave in sync.'); return; }
    if (!window.confirm('Update the matched amount on this deposit to ' + fmt(newAmt) + '?\n\nThis reverses the current match(es) and re-applies ' + fmt(newAmt) + ' to invoice ' + (inv.invoice_number || inv.id) + ' — atomically (an overpayment becomes a customer credit).')) { return; }
    setBusy(true);
    var activeBiz = getActiveWaveBusiness();
    var siloId = activeBiz || inv.wave_business_id || t.wave_business_id || null;
    var custForWave = acctCustomers.find(function (cc) { return cc.id === inv.accounting_customer_id; });
    // v55.83-KE — ONE atomic server transition (update_match): reverses old + applies new + recomputes
    // both invoices, blocks Wave-synced rows. No more two-call unmatch→match (which could leave the
    // deposit unmatched if the second call failed).
    bankWrite('update_match', {
      bank_transaction_id: t.id, new_invoice_id: inv.id, amount: newAmt, wave_business_id: siloId,
      wave_customer_id: custForWave && custForWave.wave_customer_id ? custForWave.wave_customer_id : null,
      credit_customer_id: inv.accounting_customer_id || null, match_customer_id: inv.accounting_customer_id || null
    })
      .then(function (j) { toast.success('Match updated to ' + fmt((j && j.applied) || newAmt) + ((j && j.overpayment > 0) ? ' · ' + fmt(j.overpayment) + ' to customer credit' : '')); if (j && j.warning) { toast.error('Saved, but: ' + j.warning + ' — refresh; if balances look off, screenshot for Claude.'); } setEditMatchAmt({}); onReload(); load(); })
      .catch(function (e) { console.error('[update-match]', e); toast.error('Update failed: ' + ((e && e.message) || 'unknown error') + (/pushed to Wave/.test((e && e.message) || '') ? '' : ' — screenshot for Claude.')); load(); })
      .finally(function () { setBusy(false); });
  }

  function addSplitRow() { setSplitRows(splitRows.concat([{ amount: '', category: '', customer_id: '', invoice_id: '', notes: '' }])); }
  function updSplitRow(i, k, v) { var c = splitRows.slice(); c[i] = Object.assign({}, c[i]); c[i][k] = v; setSplitRows(c); }
  function rmSplitRow(i) { var c = splitRows.slice(); c.splice(i, 1); setSplitRows(c); }
  function saveSplits() {
    var t = sel; if (!t || !mayMatch) return;
    if (isLocked(t)) { toast.error('Approved — reopen first.'); return; }
    // Money-in only for invoice-linked splits: an outgoing transfer cannot pay a customer invoice.
    if (t.direction === 'out') {
      var hasInvoiceLine = splitRows.some(function (r) { return r.invoice_id; });
      if (hasInvoiceLine) { toast.error('This is an OUTGOING transaction. Split lines cannot be linked to a customer invoice on money-out.'); return; }
    }
    var txnAmt = Number(t.amount_abs || Math.abs(Number(t.amount)));
    var v = validateSplit(txnAmt, splitRows.map(function (r) { return { split_amount: r.amount }; }));
    if (!v.valid) { toast.error('Splits must be > 0 and not exceed ' + fmt(txnAmt) + ' (allocated ' + fmt(v.allocated) + ').'); return; }
    // v55.83-JC — ACCOUNTING INTEGRITY: a split must consume the WHOLE transaction. Marking a txn
    // reviewed with money left over is the hole Codex flagged. The remainder must be an explicit line
    // (another invoice/category, an unapplied/credit line, or an explicit Uncategorized / Needs review).
    if (!v.fullyAllocated) { toast.error(fmt(v.remaining) + ' remains unallocated. Add another line, park it as unapplied, or mark the remainder Uncategorized / Needs review — a split must cover the full ' + fmt(txnAmt) + '.'); return; }
    // v55.83-HE (Codex QA) — block the save if a split line picked a Wave category that no longer
    // resolves, so we never persist a raw "wave:<uuid>" token as the category.
    var badWave = splitRows.some(function (r) {
      if (!(r.category && r.category.indexOf('wave:') === 0)) { return false; }
      var _id = r.category.slice(5);
      return !waveCategories.some(function (c) { return c.wave_account_id === _id; });
    });
    if (badWave) { toast.error('A split line has an unrecognized Wave category — re-pick it and try again.'); return; }
    setBusy(true);
    // v55.83-JJ — the WRITE now goes through the service-role route (RLS-proof). Resolve each line's
    // Wave category client-side (so the server gets a real wave_account_id, not a "wave:<uuid>" token),
    // then POST the resolved rows. The server inserts splits + invoice match/payment/recompute and only
    // marks the txn reviewed when it is fully allocated. (Was a browser dbInsert/dbUpdate chain.)
    var outRows = splitRows.map(function (r) {
      var row = { amount: roundMoney(Number(r.amount)), category: r.category || null, customer_id: r.customer_id || null, invoice_id: r.invoice_id || null, notes: r.notes || null };
      if (r.category && r.category.indexOf('wave:') === 0) {
        var _wid = r.category.slice(5); var _cat = null; var _ci;
        for (_ci = 0; _ci < waveCategories.length; _ci++) { if (waveCategories[_ci].wave_account_id === _wid) { _cat = waveCategories[_ci]; break; } }
        if (_cat) { row.category = _cat.wave_account_name; row.wave_account_id = _cat.wave_account_id; row.wave_account_name = _cat.wave_account_name; }
      }
      return row;
    });
    bankWrite('save_splits', {
      txn: { id: t.id, business_id: t.business_id, wave_business_id: t.wave_business_id, amount_abs: t.amount_abs, amount: t.amount, posted_date: t.posted_date, date: t.date, direction: t.direction, classification: t.classification, review_status: t.review_status },
      rows: outRows,
      wave_business_id: t.wave_business_id || getActiveWaveBusiness() || null,
      accounting_customer_id: t.accounting_customer_id || null
    })
      .then(function () { toast.success('Split saved (' + splitRows.length + ' lines)'); setSplitMode(false); setSplitRows([]); onReload(); load(); })
      .catch(function (e) { console.error('[save] Split failed: ', e); toast.error('Split failed: ' + ((e && e.message) || 'unknown error') + ' — screenshot for Claude.'); })
      .finally(function () { setBusy(false); });
  }

  function applyToInvoice() {
    var t = sel; if (!t) return;
    if (!mayMatch) { toast.error('You do not have Payments: Match permission.'); return; }
    if (isLocked(t)) { toast.error('Approved — reopen first.'); return; }
    // Money-in only: a customer invoice payment must come from an INCOMING deposit. Outgoing
    // transfers (direction 'out') are money leaving and must never be matched to a customer
    // invoice — that is what produced the bogus duplicate $250 rows.
    if (t.direction === 'out') { toast.error('This is an OUTGOING transaction (money out). Only incoming deposits can be matched to a customer invoice.'); return; }
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
    // v55.83-IM (QA fix) — a single deposit may legitimately pay MULTIPLE invoices (split), but the
    // cumulative amount posted from it must never exceed the deposit, or we over-post cash. Guard
    // against over-application using the already-posted (non-void) payment rows for this txn.
    var depositAmt = roundMoney(Number(t.amount_abs != null ? t.amount_abs : (t.amount || 0)));
    var alreadyApplied = 0;
    (paysByTxn[t.id] || []).forEach(function (p) { if (!isPaymentVoid(p)) { alreadyApplied += Number(p.amount) || 0; } });
    if (depositAmt > 0 && roundMoney(alreadyApplied + apply) > depositAmt + 0.01) {
      toast.error('Cannot apply ' + fmt(apply) + ' — this transaction is ' + fmt(depositAmt) + ' and ' + fmt(alreadyApplied) + ' is already applied. Remaining to apply: ' + fmt(roundMoney(depositAmt - alreadyApplied)) + '.');
      return;
    }
    setBusy(true);
    var siloId = activeBiz || (inv && inv.wave_business_id) || t.wave_business_id || null; // v55.83-DZ
    var custForWave = acctCustomers.find(function (cc) { return cc.id === inv.accounting_customer_id; });
    // v55.83-IP — the ENTIRE match (match row + payment row + recompute + overpayment credit +
    // bank-txn stamp) is now done atomically server-side with the service-role key (bypasses RLS,
    // which was silently dropping these writes). One call, all-or-nothing, anti-double-count enforced.
    bankWrite('match_invoice', {
      txn: { id: t.id, business_id: t.business_id, wave_business_id: t.wave_business_id, amount_abs: t.amount_abs, amount: t.amount, posted_date: t.posted_date, date: t.date, classification: t.classification, accounting_customer_id: t.accounting_customer_id, review_status: t.review_status },
      invoice: { id: inv.id, business_id: inv.business_id, wave_business_id: inv.wave_business_id, total_amount: invoiceTotal(inv), wave_imported_paid: inv.wave_imported_paid, accounting_customer_id: inv.accounting_customer_id, invoice_number: inv.invoice_number, wave_invoice_id: inv.wave_invoice_id },
      amount: apply,
      wave_business_id: siloId,
      wave_customer_id: custForWave && custForWave.wave_customer_id ? custForWave.wave_customer_id : null,
      match_customer_id: mCustomerId || null,
      credit_customer_id: mCustomerId || inv.accounting_customer_id || null,
      notes: mNotes || null
    })
      .then(function (j) {
        // v55.83-JC — be truthful about the bank transaction, not just the invoice. If the deposit
        // is not fully allocated, say what's left and that it must be handled before the txn is done.
        var rem = Number(j.deposit_remaining || 0);
        if (j.fully_allocated === false && rem > 0.01) {
          toast.success('Applied ' + fmt(j.applied) + ' to the invoice. ' + fmt(rem) + ' of this deposit is still unallocated — apply it to another invoice, split it, park it as unapplied, or mark it Uncategorized / Needs review. The transaction stays open until then.');
        } else {
          toast.success('Matched ' + fmt(j.applied) + (j.type === 'partial' ? ' (partial)' : '') + (j.overpayment > 0 ? ' · ' + fmt(j.overpayment) + ' to customer credit' : ''));
        }
        onReload(); load();
      })
      .catch(function (e) { console.error('[save] Match failed: ', e); toast.error('Match failed: ' + ((e && e.message) || 'unknown error') + ' — screenshot this for Claude.'); })
      .finally(function () { setBusy(false); });
  }
  function createUnapplied() {
    var t = sel; if (!t || !mayMatch) return;
    if (isLocked(t)) { toast.error('Approved — reopen first.'); return; }
    var amt = roundMoney(Number(mAmount));
    if (!(amt > 0)) { toast.error('Enter an amount.'); return; }
    // v55.83-JC — money conservation: parking part of a deposit only finishes the transaction if the
    // park (plus anything already allocated) covers the whole deposit. Otherwise leave it unreviewed
    // so the remainder is still surfaced — don't silently mark a partially-parked deposit reviewed.
    var allocU = txnAllocation(t);
    var afterPark = roundMoney(allocU.allocated + amt);
    var parkRemaining = roundMoney(allocU.total - afterPark);
    var parkComplete = !(allocU.total > 0) || parkRemaining <= 0.01;
    setBusy(true);
    // v55.83-JJ — the WRITE now goes through the service-role route (RLS-proof). The server inserts the
    // unapplied deposit and only marks the txn reviewed when the park completes the allocation. (Was a
    // browser dbInsert + patchTxn chain that could silently 0-row under RLS.)
    bankWrite('create_unapplied', {
      txn: { id: t.id, business_id: t.business_id, wave_business_id: t.wave_business_id, classification: t.classification, review_status: t.review_status },
      amount: amt,
      customer_id: mCustomerId || null,
      wave_business_id: t.wave_business_id || getActiveWaveBusiness() || null,
      notes: mNotes || null
    })
      .then(function () { toast.success(parkComplete ? 'Unapplied deposit created — awaiting allocation' : ('Unapplied deposit of ' + fmt(amt) + ' created. ' + fmt(parkRemaining) + ' of this deposit is still unallocated — the transaction stays open until every dollar is handled.')); onReload(); load(); })
      .catch(function (e) { console.error('[save] Failed: ', e); toast.error('Could not park the deposit: ' + ((e && e.message) || 'unknown error') + ' — screenshot for Claude.'); })
      .finally(function () { setBusy(false); });
  }

  if (!canViewBank(isSuperAdmin, modulePerms)) {
    return (
      <div className="p-6">
        <RestrictedNotice title="Bank review restricted" message="Viewing bank transactions requires the Bank: View permission." />
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
        // v55.83-JE — data-freshness: newest loaded posted date + the active visibility window.
        var newestLoaded = null;
        txns.forEach(function (t) { var d = (t.posted_date || t.date || '').substring(0, 10); if (d && (!newestLoaded || d > newestLoaded)) { newestLoaded = d; } });
        var winLabel = isSuperAdmin ? 'All history (super-admin)' : labelForWindow(visCfg.window, visCfg.customDays);
        return (
          <div className="mb-3 rounded-lg bg-slate-800 border border-slate-600 px-3 py-2 text-xs text-slate-100 flex flex-wrap gap-x-4 gap-y-1">
            <span>Silo transactions: <b className="text-white">{inSilo}</b></span>
            <span>Account: <b className="text-white">{acctName}</b></span>
            <span>Status filter: <b className="text-white">{fStatus === 'all' ? 'All' : fStatus}</b></span>
            <span>Showing: <b className="text-white">{showing}</b></span>
            <span>Newest loaded: <b className="text-white">{newestLoaded || '—'}</b></span>
            <span title="How far back history is shown. A super admin can change this in Settings → Accounting visibility.">Visibility: <b className={visFloor ? 'text-sky-300' : 'text-white'}>{winLabel}</b>{visFloor ? <span className="text-slate-400"> (from {visFloor})</span> : null}</span>
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
                    <div className="px-2 py-1.5 text-[11px] text-slate-300">{
                      /* v55.83-LF mirror — show the WAVE category + where it came from (Wave vs Hub), falling
                         back to the Hub classification. This is the "categorized transactions from Wave" view. */
                      t.wave_account_name
                        ? <span className="inline-flex items-center gap-1"><span className="truncate">{t.wave_account_name}</span>{(t.category_source === 'wave' || t.category_source === 'wave_csv') ? <span className="text-[9px] bg-sky-500/20 text-sky-200 border border-sky-500/40 rounded px-1">⇐ Wave</span> : <span className="text-[9px] bg-slate-600/40 text-slate-300 rounded px-1">Hub</span>}</span>
                        : (t.classification ? labelize(t.classification) : <span className="text-slate-500 italic">—</span>)
                    }</div>
                    <div className="px-2 py-1.5">
                      <span className={'text-[10px] px-1.5 py-0.5 rounded font-bold ' + (t.review_status === 'approved' ? 'bg-blue-700 text-white' : t.review_status === 'reviewed' ? 'bg-emerald-700 text-white' : t.review_status === 'ignored' || t.review_status === 'duplicate' ? 'bg-slate-600 text-white' : t.review_status === 'needs_clarification' ? 'bg-amber-600 text-white' : 'bg-slate-700 text-slate-200')}>{labelize(t.review_status || 'unreviewed')}</span>
                      {/* v55.83-GR/LF — Wave sync status is SEPARATE from Hub review. "Approved" never means
                          "synced to Wave". The mirror badge is split-aware: a deposit MATCHED to an invoice
                          syncs as an invoice PAYMENT (show INV# + status); an unmatched categorized txn syncs
                          as a money transaction; a category that came FROM Wave shows "⇐ from Wave". */}
                      {(function () {
                        var ms = matchesByTxn[t.id] || [];
                        var isPayment = ms.length > 0 || !!t.matched_invoice_id;
                        if (isPayment) {
                          var inv = ms.length ? acctInvoices.find(function (iv) { return iv.id === ms[0].invoice_id; }) : null;
                          var ps = (paysByTxn[t.id] || []).filter(function (p) { return !isPaymentVoid(p); });
                          var pushed = ps.some(function (p) { return p.wave_payment_id || p.sync_status === 'synced' || p.sync_status === 'manual_done'; });
                          var invTxt = inv ? ('INV ' + (inv.invoice_number || inv.id) + (inv.payment_status ? (' · ' + inv.payment_status) : '')) : 'invoice';
                          var pcls = pushed ? 'bg-emerald-800 text-emerald-100' : 'bg-violet-700 text-white';
                          return <span className={'block mt-1 text-[9px] px-1.5 py-0.5 rounded font-bold w-fit ' + pcls}>{(pushed ? '✓ Wave payment · ' : '⧖ Pending → Wave · ') + invTxt}</span>;
                        }
                        var cs = t.category_status;
                        var fromWave = (t.category_source === 'wave' || t.category_source === 'wave_csv');
                        var wlabel = (fromWave && cs === 'synced') ? '⇐ from Wave' : cs === 'pending_wave_sync' ? '⧖ Wave: pending' : cs === 'synced' ? '✓ Wave: synced' : (cs === 'sync_failed' || cs === 'failed') ? '✕ Wave: failed' : cs === 'local_only' ? 'Hub only' : (t.wave_account_id ? '⧖ Wave: pending' : 'Wave: not synced');
                        var wcls = cs === 'synced' ? (fromWave ? 'bg-sky-800 text-sky-100' : 'bg-emerald-800 text-emerald-100') : (cs === 'sync_failed' || cs === 'failed') ? 'bg-rose-800 text-rose-100' : cs === 'pending_wave_sync' ? 'bg-violet-700 text-white' : 'bg-slate-700 text-slate-400';
                        return <span className={'block mt-1 text-[9px] px-1.5 py-0.5 rounded font-bold w-fit ' + wcls}>{wlabel}</span>;
                      })()}
                    </div>
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

            {/* v55.83-FZ — Wave Category (Chart of Accounts). Real Wave accounts, scoped to the
                active silo. Separate from invoice matching: for a customer payment matched to an
                invoice you don't need a category; this is for expenses/transfers/other income. */}
            <div className="mb-2">
              <div className="text-[11px] text-slate-400 mb-1">Wave Category (Chart of Accounts)</div>
              {waveCategories.length > 0 ? (
                <div>
                  {/* v55.83-KY — SEARCHABLE category picker (was a native <select> you had to scroll). Items
                      stay in direction-aware order (expense-first for money-out, income-first for money-in);
                      type is shown so two similarly-named accounts are distinguishable. */}
                  {(!mayClassify || isLocked(sel)) ? (
                    <div className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-300 text-xs">{sel.wave_account_name || '— none —'}{isLocked(sel) ? ' (reopen to change)' : ''}</div>
                  ) : (
                    <Typeahead
                      items={[].concat.apply([], orderedCatGroups(sel.direction).map(function (grp) { return grp.items.map(function (c) { return { id: c.wave_account_id, name: c.wave_account_name, subtype: c.subtype, type: grp.type }; }); }))}
                      value={sel.wave_account_id || ''} allowClear={true} placeholder="Search Wave categories…"
                      getLabel={function (c) { return c.name + (c.subtype ? ' (' + c.subtype + ')' : '') + (c.type ? ' · ' + c.type : ''); }}
                      onPick={function (id) { setWaveCategory(sel, id); }} />
                  )}
                  {sel.wave_account_id && <div className="text-[10px] text-violet-300 mt-0.5">Selected: {sel.wave_account_name}{sel.category_status ? (' · ' + sel.category_status) : ''}</div>}
                  {/* v55.83-LE — always show the true usable total + a refresh, so it's clear the full chart of accounts is loaded (not just the ~10 visible). */}
                  <div className="text-[10px] text-slate-500 mt-0.5">{(catDiag && catDiag.usable != null ? catDiag.usable : waveCategories.length) + ' categories available'}{catDiag && catDiag.hidden_receivable ? (' · ' + catDiag.hidden_receivable + ' system/AP/AR hidden') : ''}{mayClassify ? ' · ' : ''}{mayClassify && <button onMouseDown={function (e) { e.preventDefault(); }} onClick={pullCategories} disabled={catPulling} className="underline hover:text-slate-300 disabled:opacity-50">{catPulling ? 'refreshing…' : 'refresh from Wave'}</button>}</div>
                  {sel.direction === 'in' && <div className="text-[10px] text-slate-500 mt-0.5">Money-in: if this is a customer invoice payment, match it to the invoice below instead of categorizing.</div>}
                </div>
              ) : (
                <div className="text-[10px] text-amber-300 space-y-1">
                  <div className="font-semibold">{
                    catDiag && catDiag.error
                      ? ('Could not load Wave categories: ' + catDiag.error)
                      : (catDiag && catDiag.total > 0 && catDiag.usable === 0
                          ? (catDiag.total + ' Wave accounts loaded, but 0 are usable as categories after hiding ' + (catDiag.hidden_receivable || 0) + ' receivable/system account(s).')
                          : 'No Wave categories loaded for this silo yet.')
                  }</div>
                  {/* v55.83-KF — full live diagnostic + one-click pull, right beside the dropdown (Codex/Max). */}
                  <div className="text-slate-400">Silo: <b className="text-slate-200">{getActiveWaveBusiness() || '(none — pick a specific silo)'}</b> · stored in Hub: total {catDiag ? catDiag.total : 0}, usable {catDiag ? (catDiag.usable != null ? catDiag.usable : 0) : 0}{catDiag && catDiag.hidden_receivable ? (', hidden ' + catDiag.hidden_receivable + ' receivable/system') : ''}.</div>
                  {mayClassify && <button onClick={pullCategories} disabled={catPulling} className="px-2 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded text-[11px] font-bold disabled:opacity-50">{catPulling ? 'Pulling from Wave…' : '⟳ Pull Wave categories now'}</button>}
                  {catPullMsg && <div className="text-slate-100 bg-slate-800 rounded px-2 py-1">{catPullMsg}</div>}
                </div>
              )}
            </div>

            {matchesByTxn[sel.id] && matchesByTxn[sel.id].length > 0 && (
              <div className="bg-indigo-100 text-indigo-950 rounded p-2 text-xs font-semibold mb-2">
                <div className="font-bold mb-1">Matched</div>
                {matchesByTxn[sel.id].map(function (m) {
                  var inv = acctInvoices.find(function (i) { return i.id === m.invoice_id; });
                  var cust = inv ? acctCustomers.find(function (cc) { return cc.id === inv.accounting_customer_id; }) : null;
                  return (
                    <div key={m.id} className="flex items-center justify-between gap-2 flex-wrap mb-1">
                      <span>{cust ? (cust.company_name + ' · ') : ''}Invoice {(inv && (inv.invoice_number || inv.id)) || m.invoice_id} · {fmt(m.matched_amount)}{m.match_type ? (' · ' + labelize(m.match_type)) : ''}</span>
                      {/* v55.83-KD — edit the EXISTING match amount (reverse & re-apply), so the amount field isn't a silent no-op. */}
                      {mayMatch && !isLocked(sel) && (
                        <span className="flex items-center gap-1">
                          <input value={editMatchAmt[m.id] != null ? editMatchAmt[m.id] : String(m.matched_amount)} onChange={function (e) { var v = e.target.value; setEditMatchAmt(function (p) { var nx = Object.assign({}, p); nx[m.id] = v; return nx; }); }} className="w-20 bg-white border border-indigo-300 rounded px-1 py-0.5 text-indigo-950 text-[11px]" title="Change the matched amount, then click Update" />
                          <button onClick={function () { updateMatchAmount(m); }} disabled={busy} className="px-1.5 py-0.5 bg-amber-600 hover:bg-amber-500 text-white rounded text-[10px] font-bold disabled:opacity-50">Update amount</button>
                        </span>
                      )}
                    </div>
                  );
                })}
                {/* v55.83-KF — show how much of the deposit is still unaccounted-for (Max: "warn me if the
                    full amount is not accounted for"). Live, before they even try to save/approve. */}
                {(function () {
                  var dep = roundMoney(Number(sel.amount_abs != null ? sel.amount_abs : Math.abs(Number(sel.amount) || 0)));
                  var matchedSum = (matchesByTxn[sel.id] || []).reduce(function (a, m) { return a + (Number(m.matched_amount) || 0); }, 0);
                  var rem = roundMoney(dep - matchedSum);
                  if (rem > 0.005) { return <div className="mt-1 px-2 py-1 rounded bg-amber-200 text-amber-950 text-[11px] font-bold">⚠ {fmt(rem)} of this {fmt(dep)} deposit is still unallocated — apply it to another invoice (split below), park it, or mark the remainder Needs review before approving.</div>; }
                  if (rem < -0.005) { return <div className="mt-1 px-2 py-1 rounded bg-rose-200 text-rose-950 text-[11px] font-bold">⚠ Over-allocated by {fmt(Math.abs(rem))} — reduce a match amount.</div>; }
                  return <div className="mt-1 text-[10px] text-emerald-700 font-bold">✓ Fully allocated ({fmt(dep)}).</div>;
                })()}
                {/* v55.83-KE — show the REAL current attachment + Wave sync state (Codex). */}
                {(function () {
                  var ps = (paysByTxn[sel.id] || []).filter(function (p) { return !isPaymentVoid(p); });
                  var pushed = ps.some(function (p) { return p.wave_payment_id || p.sync_status === 'synced' || p.sync_status === 'manual_done'; });
                  var st = pushed ? 'synced to Wave' : (ps.length ? 'pending Wave sync' : 'no payment row');
                  return <div className="text-[10px] mt-0.5">Wave sync: <b>{st}</b>{ps.length ? (' · ' + ps.length + ' payment row(s)') : ''}. {pushed ? 'Already in Wave — change it in Wave then re-import.' : '“Update amount” reverses & re-applies; “Unmatch” fully reverses.'}</div>;
                })()}
                {mayMatch && !isLocked(sel) && <button onClick={function () { unmatch(sel); }} disabled={busy} className="mt-1.5 px-2 py-1 bg-rose-700 hover:bg-rose-600 text-white rounded text-[11px] font-bold disabled:opacity-50">Unmatch (reverse)</button>}
                {isLocked(sel) && <div className="text-[10px] mt-1">Reopen the transaction to unmatch.</div>}
              </div>
            )}

            {/* v55.83-ID — ORPHAN recorded payment: a payment row with no active match. Surfaced so
                it can be reversed instead of being stuck (inline-styled for guaranteed contrast). */}
            {(!matchesByTxn[sel.id] || matchesByTxn[sel.id].length === 0) && paysByTxn[sel.id] && paysByTxn[sel.id].length > 0 && (
              <div style={{ background: '#7f1d1d', color: '#fff', borderRadius: 8, padding: '8px 10px', marginBottom: 8 }}>
                <div style={{ fontWeight: 800, marginBottom: 2 }}>⚠ Recorded payment with no match</div>
                <div style={{ fontSize: 11 }}>This deposit has {paysByTxn[sel.id].length} recorded payment(s) but no active match — likely an import or a match that didn&apos;t complete. Reverse it to restore the invoice balance.</div>
                {mayMatch && !isLocked(sel) && <button onClick={function () { unmatch(sel); }} disabled={busy} className="mt-1.5 px-2 py-1 bg-white text-rose-800 rounded text-[11px] font-bold disabled:opacity-50">Reverse recorded payment</button>}
                {isLocked(sel) && <div style={{ fontSize: 10, marginTop: 4 }}>Reopen the transaction to reverse.</div>}
              </div>
            )}

            {/* Match to invoice */}
            {mayMatch && !isLocked(sel) && (
              <div className="border-t border-slate-700 pt-2 mb-2">
                <div className="text-[11px] font-bold text-slate-200 mb-1">{(matchesByTxn[sel.id] && matchesByTxn[sel.id].length > 0) ? 'Add ANOTHER invoice to this deposit (split)' : 'Match to invoice'}</div>
                {(matchesByTxn[sel.id] && matchesByTxn[sel.id].length > 0) ? <div className="text-[10px] text-amber-300 mb-1">Already matched above. To CHANGE the amount, use “Update amount” on the match. This panel ADDS a second invoice (a split).</div> : null}
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
                              {waveCategories.length > 0 && <optgroup label="Wave categories">
                                {waveCategories.map(function (c) { return <option key={c.wave_account_id} value={'wave:' + c.wave_account_id}>{c.wave_account_name}{c.subtype ? (' (' + c.subtype + ')') : ''}</option>; })}
                              </optgroup>}
                              <optgroup label="General">
                                {CLASSIFICATIONS.map(function (c) { return <option key={c} value={c}>{labelize(c)}</option>; })}
                              </optgroup>
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
                    {(function () {
                      var txnTot = Number(sel.amount_abs || Math.abs(Number(sel.amount)));
                      var allocd = splitRows.reduce(function (a, r) { return a + (Number(r.amount) || 0); }, 0);
                      var rem = roundMoney(txnTot - allocd);
                      return (
                        <div className="flex items-center justify-between text-[11px] mb-1">
                          <div className="flex gap-2">
                            <button onClick={addSplitRow} className="text-indigo-300 font-bold">+ add line</button>
                            {/* v55.83-JC — explicit residual action (Codex): never auto-guess Uncategorized; the user adds it on purpose. Hub-only — no Wave category push. */}
                            {rem > 0.01 && <button onClick={function () { setSplitRows(splitRows.concat([{ amount: String(rem), category: 'needs_clarification', customer_id: '', invoice_id: '', notes: 'Uncategorized / Needs review (Hub-only — not pushed to Wave)' }])); }} className="text-amber-300 font-bold" title="Add the unallocated remainder as an explicit Uncategorized / Needs review line. Hub-only — it will not create a Wave category transaction.">+ remainder ({fmt(rem)}) as Needs review</button>}
                          </div>
                          <span className={rem > 0.01 ? 'text-amber-300 font-bold' : (rem < -0.01 ? 'text-rose-400 font-bold' : 'text-emerald-300')}>Allocated {fmt(allocd)} / {seeAmounts ? fmt(txnTot) : '•••••'}{rem > 0.01 ? ' · ' + fmt(rem) + ' left' : (rem < -0.01 ? ' · over by ' + fmt(-rem) : ' ✓')}</span>
                        </div>
                      );
                    })()}
                    <button onClick={saveSplits} disabled={busy} className="w-full px-2 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-[11px] font-bold disabled:opacity-50">Save split</button>
                    <div className="text-[10px] text-slate-500 mt-1">Every dollar must be allocated: lines tied to an invoice record a payment and update its balance; the remainder can be another category, an unapplied/credit line, or an explicit Uncategorized / Needs review line. A split must cover the full transaction.</div>
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
