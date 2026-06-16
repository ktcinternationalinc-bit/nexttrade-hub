import React, { useState, useEffect, useMemo } from 'react';
import { supabase, dbUpdate } from '../lib/supabase';
import { fetchAllRows } from '../lib/fetch-all-rows';
import { isPaymentVoid } from '../lib/payment-matching';
import { getActiveWaveBusiness, scopeIfRegistered } from '../lib/wave-business';
import { dryRunRecord } from '../lib/wave-sync-eligibility';
import SiloBanner from './SiloBanner';

// v55.83-EM — pull the human-readable Wave error out of a response payload.
function waveErrText(rp) {
  if (!rp) { return ''; }
  try {
    var parts = [];
    var roots = [rp];
    if (rp.wave) { roots.push(rp.wave); }
    var r;
    for (r = 0; r < roots.length; r++) {
      var root = roots[r];
      if (!root) { continue; }
      if (root.errors && root.errors.length) {
        root.errors.forEach(function (e) { parts.push(e.message || JSON.stringify(e)); });
      }
      var d = root.data || {};
      var keys = Object.keys(d);
      keys.forEach(function (k) {
        var node = d[k];
        if (node && node.inputErrors && node.inputErrors.length) {
          node.inputErrors.forEach(function (ie) {
            parts.push((ie.message || 'error') + (ie.path ? (' [field: ' + (Array.isArray(ie.path) ? ie.path.join('.') : ie.path) + ']') : '') + (ie.code ? (' (' + ie.code + ')') : ''));
          });
        }
      });
    }
    if (rp.stage) { parts.unshift('(stage: ' + rp.stage + ')'); }
    return parts.join('\n');
  } catch (e) { return ''; }
}

// Turns a wave_sync_log row into a human, accounting-readable label + detail line. Reads the
// rich context saved from v55.83-FU forward (nested response_payload, or flat request_payload);
// old rows lack it, so it falls back to entity/action and never renders blank.
function syncLogParts(l) {
  var rp = (l && l.response_payload) || {};
  var rq = (l && l.request_payload) || {};
  var pmt = rp.payment || {};
  var inv = rp.invoice || {};
  var cust = rp.customer || {};
  var wv = rp.wave || {};
  var customerName = cust.customer_name || rq.customer_name || null;
  var invoiceNumber = inv.invoice_number || rq.invoice_number || null;
  var amount = (pmt.amount != null) ? pmt.amount : ((rq.amount != null) ? rq.amount : null);
  var paymentDate = pmt.payment_date || rq.payment_date || null;
  var wavePaymentId = wv.wave_payment_id || rp.wave_payment_id || null;
  var bankTxn = pmt.bank_transaction_id || rq.bank_transaction_id || null;
  var matchId = pmt.payment_match_id || rq.payment_match_id || null;
  var acctName = wv.payment_account_name || rq.payment_account_name || null;
  var et = (l && l.entity_type) || 'record';
  var hasCtx = !!(customerName || invoiceNumber || amount != null);

  var primary;
  if (et === 'payment' && hasCtx) {
    var pb = ['Payment'];
    if (customerName) { pb.push(customerName); }
    if (invoiceNumber) { pb.push('Invoice ' + invoiceNumber); }
    if (amount != null) { pb.push(Number(amount).toLocaleString()); }
    if (paymentDate) { pb.push(paymentDate); }
    primary = pb.join(' · ');
  } else if (et === 'invoice' && hasCtx) {
    var ib = ['Invoice'];
    if (invoiceNumber) { ib.push(invoiceNumber); }
    if (customerName) { ib.push(customerName); }
    if (amount != null) { ib.push(Number(amount).toLocaleString()); }
    primary = ib.join(' · ');
  } else if (et === 'customer' && customerName) {
    primary = 'Customer · ' + customerName;
  } else {
    // Old row / no context — fall back so it is never just "payment · push · error".
    primary = (et.charAt(0).toUpperCase() + et.slice(1)) + ' · ' + ((l && l.action) || '') + ((l && l.hub_record_id) ? (' · ' + String(l.hub_record_id).substring(0, 8)) : '');
  }

  var detail = [];
  if (et === 'payment') {
    if (wavePaymentId) { detail.push('Wave payment: ' + wavePaymentId); }
    if (bankTxn) { detail.push('Bank txn: ' + String(bankTxn).substring(0, 8)); }
    if (matchId) { detail.push('Match: ' + String(matchId).substring(0, 8)); }
    if (acctName) { detail.push('Account: ' + acctName); }
  }
  return { primary: primary, detail: detail.join(' · ') };
}

export default function WaveSyncCenter(props) {
  var toast = props.toast || { success: function () {}, error: function () {} };
  var userProfile = props.userProfile || null;
  var isSuperAdmin = props.isSuperAdmin === true || (userProfile && userProfile.role === 'super_admin');
  // v55.83-GC — per-action permission flags (super_admin has all). The UI hides/disables
  // restricted actions; the server routes still enforce each permission independently.
  var _mp = props.modulePerms || {};
  function _can(p) { return isSuperAdmin || _mp[p] === true; }
  var canDryRun = _can('wave.sync.dry_run');
  var canViewLog = _can('wave.sync.log.view');
  var canManageSettings = _can('wave.settings.manage');
  var canPullCats = _can('wave.categories.pull');
  var canPushCustomer = _can('wave.customers.push');
  var canPushInvoice = _can('wave.invoices.push');
  var canPushPayment = _can('wave.payments.push');
  var canPushAny = canPushCustomer || canPushInvoice || canPushPayment;

  var [tab, setTab] = useState('pending');
  var [loading, setLoading] = useState(true);
  var [registry, setRegistry] = useState([]);
  var [customers, setCustomers] = useState([]);
  var [invoices, setInvoices] = useState([]);
  var [payments, setPayments] = useState([]);
  var [syncLog, setSyncLog] = useState([]);
  var lo = useState(null); var openLog = lo[0]; var setOpenLog = lo[1];
  var ps0 = useState(null); var prodSetup = ps0[0]; var setProdSetup = ps0[1];
  var ps1 = useState(false); var prodBusy = ps1[0]; var setProdBusy = ps1[1];
  var ps2 = useState(''); var prodMsg = ps2[0]; var setProdMsg = ps2[1];
  var ps3 = useState(null); var prodList = ps3[0]; var setProdList = ps3[1];
  var pa0 = useState(false); var payBusy = pa0[0]; var setPayBusy = pa0[1];
  var pa1 = useState(''); var payMsg = pa1[0]; var setPayMsg = pa1[1];
  var pa2 = useState(null); var payList = pa2[0]; var setPayList = pa2[1];
  var ca0 = useState(false); var catBusy = ca0[0]; var setCatBusy = ca0[1];
  var ca1 = useState(''); var catMsg = ca1[0]; var setCatMsg = ca1[1];
  var ca2 = useState(0); var catCount = ca2[0]; var setCatCount = ca2[1];
  var sp0 = useState(false); var schemaBusy = sp0[0]; var setSchemaBusy = sp0[1];
  var sp1 = useState(null); var schemaResult = sp1[0]; var setSchemaResult = sp1[1];
  var [sel, setSel] = useState({});
  var [busy, setBusy] = useState(false);
  var [savingFlags, setSavingFlags] = useState(false);

  var active = getActiveWaveBusiness();
  var reg = registry.find(function (r) { return r.wave_business_id === active; });
  var isProd = !!(reg && reg.is_production !== false);

  function load() {
    setLoading(true);
    Promise.all([
      fetchAllRows('wave_business_registry', '*'),
      fetchAllRows('accounting_customers', '*', 'company_name', true),
      fetchAllRows('accounting_invoices', '*', 'created_at', false),
      supabase.from('wave_sync_log').select('*').order('attempted_at', { ascending: false }).order('id', { ascending: false }).limit(100),
      fetchAllRows('accounting_invoice_payments', '*', 'payment_date', false),
      fetchAllRows('bank_transactions', 'id, amount_abs, name')
    ]).then(function (res) {
      var rg = (res[0] && res[0].data) || [];
      setRegistry(rg);
      setCustomers(scopeIfRegistered((res[1] && res[1].data) || [], getActiveWaveBusiness(), rg, true));
      // Attach the originating bank deposit amount onto each payment row (for split/duplicate
      // detection in the queue) without changing what is stored.
      var btMap = {};
      ((res[5] && res[5].data) || []).forEach(function (bt) { if (bt && bt.id) { btMap[bt.id] = bt; } });
      var pays = ((res[4] && res[4].data) || []).map(function (p) {
        var bt = p && p.bank_transaction_id ? btMap[p.bank_transaction_id] : null;
        var orphanBank = !!(p && p.bank_transaction_id && !bt); // points to a missing bank txn
        return Object.assign({}, p, { _bank_amount: bt ? (Number(bt.amount_abs) || null) : null, _bank_name: bt ? (bt.name || null) : null, _orphan_bank: orphanBank });
      });
      setPayments(scopeIfRegistered(pays, getActiveWaveBusiness(), rg, true));
      setInvoices(scopeIfRegistered((res[2] && res[2].data) || [], getActiveWaveBusiness(), rg, true));
      setSyncLog(((res[3] && res[3].data) || []).filter(function (l) { return !active || l.wave_business_id === active; }));
    }).catch(function (e) { console.error('[wave-sync] load', e); toast.error('Failed to load sync data'); })
      .finally(function () { setLoading(false); });
  }
  useEffect(function () { load(); }, [active]);

  function loadProdSetup() {
    if (!active) { setProdSetup(null); return; }
    supabase.from('wave_business_settings').select('*').eq('wave_business_id', active).then(function (r) {
      setProdSetup((r && r.data && r.data.length) ? r.data[0] : null);
    }).catch(function () { setProdSetup(null); });
  }
  useEffect(function () { loadProdSetup(); }, [active]);

  function runProductSetup(mode, productId, productName) {
    setProdBusy(true); setProdMsg(''); if (mode !== 'select') { setProdList(null); }
    var payload = { wave_business_id: active, mode: mode, user_id: (userProfile && userProfile.id) || null };
    if (productId) { payload.product_id = productId; payload.product_name = productName; }
    if (mode === 'select') { payload.mode = 'select'; }
    fetch('/api/wave/product-setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.products) { setProdList(d.products); setProdMsg('Found ' + d.products.length + ' products. Pick one to use as the default invoice product.'); }
        else if (d && d.saved) { setProdMsg('Saved. Default invoice product set to ' + (d.default_invoice_product_name || d.default_invoice_product_id) + '. (source: ' + (d.source || '') + ')'); loadProdSetup(); setProdList(null); toast.success('Default invoice product configured'); }
        else if (d && d.db_error) { setProdMsg('Database save FAILED: ' + d.db_error + '\n\nIf this mentions a missing column (e.g. "source"), run:\nALTER TABLE wave_business_settings ADD COLUMN IF NOT EXISTS source text;'); toast.error('Save failed — see message'); }
        else if (d && d.error) { setProdMsg('Error: ' + d.error + (d.response ? ('\n\nWave response:\n' + JSON.stringify(d.response, null, 2)) : '')); }
        else { setProdMsg(JSON.stringify(d, null, 2)); }
      })
      .catch(function (e) { setProdMsg('Request failed: ' + ((e && e.message) || String(e))); })
      .finally(function () { setProdBusy(false); });
  }

  function runPaymentAccountSetup(mode, accountId, accountName) {
    setPayBusy(true); setPayMsg(''); if (mode !== 'select') { setPayList(null); }
    var payload = { wave_business_id: active, mode: mode, user_id: (userProfile && userProfile.id) || null };
    if (accountId) { payload.account_id = accountId; payload.account_name = accountName; }
    fetch('/api/wave/payment-account-setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.accounts) { setPayList(d.accounts); setPayMsg('Found ' + d.accounts.length + ' accounts. Pick the bank/cash account where Wave should record invoice payments.'); }
        else if (d && d.saved) { setPayMsg('Saved. Payment account set to ' + (d.default_payment_account_name || d.default_payment_account_id) + '.'); loadProdSetup(); setPayList(null); toast.success('Wave payment account configured'); }
        else if (d && d.db_error) { setPayMsg('Database save FAILED: ' + d.db_error + '\n\nIf this mentions a missing column, run:\nALTER TABLE wave_business_settings ADD COLUMN IF NOT EXISTS default_payment_account_name text;'); toast.error('Save failed — see message'); }
        else if (d && d.error) { setPayMsg('Error: ' + d.error); }
        else { setPayMsg(JSON.stringify(d, null, 2)); }
      })
      .catch(function (e) { setPayMsg('Request failed: ' + ((e && e.message) || String(e))); })
      .finally(function () { setPayBusy(false); });
  }

  function loadCatCount() {
    if (!active) { setCatCount(0); return; }
    supabase.from('wave_categories').select('id', { count: 'exact', head: true }).eq('wave_business_id', active)
      .then(function (r) { setCatCount((r && r.count) || 0); })
      .catch(function () { setCatCount(0); });
  }
  useEffect(function () { loadCatCount(); }, [active]);

  function runSchemaCheck() {
    setSchemaBusy(true); setSchemaResult(null);
    fetch('/api/wave/preflight-schema', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: (userProfile && userProfile.id) || null }) })
      .then(function (r) { return r.text().then(function (t) { var ct = (r.headers && r.headers.get && r.headers.get('content-type')) || ''; if (!r.ok || ct.indexOf('application/json') < 0) { throw new Error('HTTP ' + r.status + ': ' + t.slice(0, 200)); } return JSON.parse(t); }); })
      .then(function (d) { setSchemaResult(d); if (d && d.all_green) { toast.success('Database setup looks complete'); } else { toast.error('Some database columns are missing — see list'); } })
      .catch(function (e) { setSchemaResult({ ok: false, error: (e && e.message) || String(e) }); })
      .finally(function () { setSchemaBusy(false); });
  }

  function runCategoryPull() {
    if (!active) { toast.error('Select a Wave business first.'); return; }
    setCatBusy(true); setCatMsg('Pulling Wave Chart of Accounts…');
    fetch('/api/wave/sync-categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wave_business_id: active, user_id: (userProfile && userProfile.id) || null }) })
      .then(function (r) { return r.text().then(function (t) { var ct = (r.headers && r.headers.get && r.headers.get('content-type')) || ''; if (!r.ok || ct.indexOf('application/json') < 0) { throw new Error('Got HTTP ' + r.status + ': ' + t.slice(0, 200)); } return JSON.parse(t); }); })
      .then(function (d) {
        if (d && d.results && d.results.length) {
          var sum = d.results[0].summary || d.results[0];
          setCatMsg('Done. ' + (sum.created || 0) + ' new, ' + (sum.updated || 0) + ' updated, ' + (sum.skipped || 0) + ' unchanged.');
          toast.success('Wave categories synced'); loadCatCount();
        } else if (d && (d.created != null || d.updated != null)) {
          setCatMsg('Done. ' + (d.created || 0) + ' new, ' + (d.updated || 0) + ' updated, ' + (d.skipped || 0) + ' unchanged.');
          toast.success('Wave categories synced'); loadCatCount();
        } else if (d && d.message) { setCatMsg(d.message); loadCatCount(); }
        else if (d && d.error) { setCatMsg('Error: ' + d.error); toast.error('Category sync failed'); }
        else { setCatMsg(JSON.stringify(d).slice(0, 300)); loadCatCount(); }
      })
      .catch(function (e) { setCatMsg('Request failed: ' + ((e && e.message) || String(e))); toast.error('Category sync failed'); })
      .finally(function () { setCatBusy(false); });
  }

  // Eligible (pushable) Hub records for the active silo — STRICT same-silo match only.
  // v55.83-EJ — a record is pushable only if its wave_business_id EXACTLY equals the active
  // silo. No legacy/null inclusion here (that is fine for viewing, not for pushing), and
  // never offer placeholder-silo rows (REAL_KTC_WAVE_BUSINESS_ID / TEST_WAVE_BUSINESS_ID).
  var queue = useMemo(function () {
    var rows = [];
    var bad = { 'REAL_KTC_WAVE_BUSINESS_ID': 1, 'TEST_WAVE_BUSINESS_ID': 1 };
    // Known contaminated customers (wrong/unregistered Wave silo) — never push their records.
    // Invoices 01/02/56666/5656 link to these; kept here so payments show a clear blocked reason.
    var contaminatedCust = {
      'e17b9405-275a-45ec-b5f3-8461a2f5d2c0': 1,
      '46bfbd33-47e0-442b-9a51-98ba19b3ed3d': 1,
      'f00a1fff-23bc-4899-9472-576e0f214dbc': 1
    };
    customers.forEach(function (c) {
      if (c.wave_business_id !== active) { return; }
      if (bad[c.wave_business_id]) { return; }
      if (!c.wave_customer_id && c.source !== 'wave_import' && (c.company_name || c.name)) {
        rows.push({ key: 'customer:' + c.id, action: 'customer', id: c.id, label: c.company_name || c.name, amount: null, record: c });
      }
    });
    invoices.forEach(function (inv) {
      if (inv.wave_business_id !== active) { return; }
      if (bad[inv.wave_business_id]) { return; }
      // STRICT (v55.83-FY): only an exactly-approved invoice is pushable. Blank/null/'draft'/
      // 'review' never appears as pushable.
      if (!inv.wave_invoice_id && inv.source !== 'wave_import' && inv.is_historical !== true && inv.approval_status === 'approved') {
        rows.push({ key: 'invoice:' + inv.id, action: 'invoice', id: inv.id, label: 'Invoice ' + inv.invoice_number, amount: inv.total_amount, record: inv });
      }
      // DRAFT REPAIR (v55.83-FY): an approved invoice already in Wave but stuck as DRAFT must be
      // surfaced (not hidden just because it has a wave_invoice_id). Shown as a blocked item with a
      // clear reason — payments to it are refused until the Wave invoice is saved/approved.
      if (inv.wave_invoice_id && inv.approval_status === 'approved' && (inv.wave_status === 'DRAFT' || inv.wave_sync_status === 'pushed_draft')) {
        rows.push({ key: 'invrepair:' + inv.id, action: 'invoice', id: inv.id, label: 'Invoice ' + inv.invoice_number + ' · needs Wave status repair', amount: inv.total_amount, sub: '⛔ Wave invoice is DRAFT — open/save (approve) it in Wave, then run Wave Import/Reconcile so the Hub records it as SAVED.', blocked: 'Wave invoice is DRAFT — save/approve it in Wave first.', record: inv });
      }
    });
    // Pending PAYMENT rows: a matched payment is its own Wave action (invoicePaymentCreateManual),
    // even when the invoice is already in Wave. Without this, a payment matched to an
    // already-synced invoice (e.g. Adel Saeed / invoice 6) would never appear here.
    var invById = {};
    invoices.forEach(function (i) { invById[i.id] = i; });
    var custById = {};
    customers.forEach(function (c) { custById[c.id] = c; });
    // Pre-pass: group actionable payments by bank_transaction_id to detect a single bank
    // deposit allocated to multiple invoices (split) vs the SAME deposit duplicated (error).
    var ACTIONABLE = { 'pending_wave_sync': 1, 'manual_wave_action_required': 1, 'payment_schema_pending': 1, 'sync_failed': 1, 'failed': 1, 'syncing': 1 };
    var byBankTxn = {};
    payments.forEach(function (p) {
      if (!p || p.wave_business_id !== active || bad[p.wave_business_id]) { return; }
      if (isPaymentVoid(p) || p.wave_payment_id) { return; }
      if (!ACTIONABLE[p.sync_status]) { return; }
      if (!p.bank_transaction_id) { return; }
      if (!byBankTxn[p.bank_transaction_id]) { byBankTxn[p.bank_transaction_id] = { count: 0, total: 0, bankAmount: null }; }
      byBankTxn[p.bank_transaction_id].count += 1;
      byBankTxn[p.bank_transaction_id].total = Math.round((byBankTxn[p.bank_transaction_id].total + (Number(p.amount) || 0)) * 100) / 100;
      if (p._bank_amount != null) { byBankTxn[p.bank_transaction_id].bankAmount = Number(p._bank_amount); }
    });
    payments.forEach(function (p) {
      if (!p) { return; }
      if (p.wave_business_id !== active) { return; }
      if (bad[p.wave_business_id]) { return; }
      if (isPaymentVoid(p)) { return; }
      if (p.wave_payment_id) { return; } // already pushed to Wave
      // Show every payment that still needs action — not only pending_wave_sync. Otherwise a
      // payment that a push attempt moved to manual_wave_action_required would vanish.
      if (!ACTIONABLE[p.sync_status]) { return; } // synced / manual_done / void excluded
      if (!(Number(p.amount) > 0)) { return; }
      if (!p.payment_date) { return; }
      var inv = invById[p.accounting_invoice_id];
      var cust = custById[p.accounting_customer_id];
      var invWaveId = p.wave_invoice_id || (inv && inv.wave_invoice_id) || null;
      var custWaveId = p.wave_customer_id || (cust && cust.wave_customer_id) || null;
      var invNo = inv ? (inv.invoice_number || inv.id) : (p.accounting_invoice_id || '?');
      var custName = cust ? (cust.company_name || cust.contact_name || cust.name || '(customer)') : '(customer)';
      // Bank-transaction sharing: is this deposit linked to more than one payment row?
      var grp = p.bank_transaction_id ? byBankTxn[p.bank_transaction_id] : null;
      var shareNote = null;
      var dupBlock = null;
      if (grp && grp.count > 1) {
        var bankAmt = grp.bankAmount;
        if (bankAmt != null && grp.total > bankAmt + 0.0001) {
          dupBlock = 'Same bank deposit over-allocated (' + grp.total + ' across ' + grp.count + ' invoices > deposit ' + bankAmt + ') — review before syncing';
        } else {
          shareNote = 'Split: same bank deposit on ' + grp.count + ' invoices (total ' + grp.total + (bankAmt != null ? ' / deposit ' + bankAmt : '') + ')';
        }
      }
      var blocked = null;
      // Orphaned payment guard: the row references a bank transaction that no longer exists
      // (deleted or replaced by a Plaid re-sync). Never push these to Wave.
      var orphanBank = p._orphan_bank === true;
      if (orphanBank) { blocked = 'Bank deposit not found (stale/deleted match) — review or void'; }
      else if (contaminatedCust[p.accounting_customer_id]) { blocked = 'Invoice/customer belongs to a wrong or unregistered Wave silo — do not push'; }
      else if (!invWaveId) { blocked = 'Invoice not yet in Wave'; }
      else if (!custWaveId) { blocked = 'Customer not yet in Wave'; }
      else if (dupBlock) { blocked = dupBlock; }
      else if (p.sync_status === 'syncing') { blocked = 'Currently syncing to Wave…'; }
      // A push that FAILED is retryable — it is NOT a hard data block. Only the real guards above
      // (orphan, contaminated/wrong silo, missing Wave invoice/customer id, over-allocated deposit,
      // currently syncing) prevent a push. A sync_failed/failed row with none of those stays
      // selectable so it can be retried (e.g. after a code fix deploys), instead of being lumped in
      // with truly blocked/contaminated records.
      var retryFail = null;
      if (!blocked && (p.sync_status === 'sync_failed' || p.sync_status === 'failed')) {
        retryFail = p.sync_error || 'Previous push failed';
      }
      var subBits = [];
      if (p.payment_date) { subBits.push(p.payment_date); }
      subBits.push('status: ' + (p.sync_status || '?'));
      if (p.bank_transaction_id) { subBits.push('bank txn ' + String(p.bank_transaction_id).substring(0, 8)); }
      if (p.payment_match_id) { subBits.push('match ' + String(p.payment_match_id).substring(0, 8)); }
      if (shareNote) { subBits.push('⚠ ' + shareNote); }
      if (blocked) { subBits.push('⛔ ' + blocked); }
      else if (retryFail) { subBits.push('↻ Failed (retryable): ' + retryFail); }
      rows.push({
        key: 'payment:' + p.id, action: 'payment', id: p.id,
        label: 'Payment · ' + custName + ' · Invoice ' + invNo,
        amount: Number(p.amount) || 0,
        sub: subBits.join(' · '),
        blocked: blocked,
        retryable: !!retryFail,
        record: Object.assign({}, p, { wave_invoice_id: invWaveId, wave_customer_id: custWaveId, _invoice_number: invNo, _customer_name: custName })
      });
    });
    return rows;
  }, [customers, invoices, payments, active]);

  function toggle(key) { setSel(function (p) { var n = Object.assign({}, p); if (n[key]) { delete n[key]; } else { n[key] = true; } return n; }); }

  // Mark a queued payment as entered-in-Wave-manually (clears it from the pending queue
  // without faking a wave_payment_id). Logged to audit_log via dbUpdate.
  function markManualDone(paymentId) {
    if (!paymentId) { return; }
    if (!isSuperAdmin) { toast.error('Only a super admin can mark a payment as manually entered in Wave.'); return; }
    var ref = window.prompt('Enter the Wave reference / receipt # for the payment you recorded in Wave (required). This is logged. Leave blank to cancel.');
    if (ref == null) { return; }
    ref = String(ref).trim();
    if (!ref) { toast.error('A Wave reference is required to mark a payment as manually done.'); return; }
    dbUpdate('accounting_invoice_payments', paymentId, { sync_status: 'manual_done', last_synced_at: new Date().toISOString(), sync_error: 'MANUAL WAVE ENTRY by ' + ((userProfile && (userProfile.full_name || userProfile.email || userProfile.id)) || 'super_admin') + ' - Wave ref: ' + ref }, (userProfile && userProfile.id))
      .then(function () {
        try { supabase.from('wave_sync_log').insert({ wave_business_id: active, entity_type: 'payment', hub_record_id: paymentId, action: 'manual_done', dry_run: false, success: true, response_payload: { wave_reference: ref, by: (userProfile && userProfile.id) || null }, error_message: null, attempted_at: new Date().toISOString() }); } catch (eLog) {}
        toast.success('Marked as entered in Wave manually (ref: ' + ref + ')'); load();
      })
      .catch(function (e) { toast.error('Could not update: ' + ((e && e.message) || 'error')); });
  }
  var selectedRows = queue.filter(function (q) { return sel[q.key] && !q.blocked; });

  function runDryRun() {
    if (isProd) { toast.error('Production is read-only in this build. Dry run is available for the Test business only.'); return; }
    if (selectedRows.length === 0) { toast.error('Select at least one record.'); return; }
    var results = selectedRows.map(function (q) {
      var v = dryRunRecord({ action: q.action, record: q.record, waveBusinessId: active, registry: registry });
      return { label: q.label, verdict: v.verdict, message: v.message, wouldDo: v.wouldDo };
    });
    setDryResults(results);
    setTab('dryrun');
  }
  var [dryResults, setDryResults] = useState([]);

  function pushSelected() {
    if (isProd) { toast.error('Production writes are disabled. Use read-only reconcile or unlock production in a future controlled build.'); return; }
    if (selectedRows.length === 0) { toast.error('Select records and Dry Run first.'); return; }
    // v55.83-GC — per-action permission gate (defense alongside the server route checks).
    var lacksPerm = selectedRows.some(function (q) {
      if (q.action === 'customer') { return !canPushCustomer; }
      if (q.action === 'invoice') { return !canPushInvoice; }
      if (q.action === 'payment') { return !canPushPayment; }
      return false;
    });
    if (lacksPerm) { toast.error('You do not have permission to push one or more of the selected record types.'); return; }
    // PAYMENT-PUSH SAFETY (launch): payments go one at a time until Wave's behavior (incl. the
    // paymentMethod enum) is fully confirmed on live data. Customer/invoice pushes are proven
    // and may still go in a batch.
    var selectedPayments = selectedRows.filter(function (q) { return q.action === 'payment'; });
    if (selectedPayments.length > 1) {
      toast.error('Push payments ONE at a time for now. Select a single payment, Dry Run, then Push. (This limit is lifted once the first live payments are confirmed in Wave.)');
      return;
    }
    if (selectedPayments.length === 1 && selectedRows.length > 1) {
      toast.error('Push a payment by itself (do not mix it with other records). Select just the one payment.');
      return;
    }
    setBusy(true);
    var seq = Promise.resolve();
    var done = 0, failed = 0;
    selectedRows.forEach(function (q) {
      seq = seq.then(function () {
        var route = q.action === 'customer' ? '/api/wave/push-customer' : (q.action === 'invoice' ? '/api/wave/push-invoice-v2' : '/api/wave/push-payment');
        return fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wave_business_id: active, hub_record_id: q.id, dry_run: false, user_id: userProfile && userProfile.id }) })
          .then(function (r) { return r.json(); })
          .then(function (d) { if (d && (d.success || d.ok)) { done++; } else { failed++; } })
          .catch(function () { failed++; });
      });
    });
    seq.then(function () { setBusy(false); toast.success('Push finished — ' + done + ' ok, ' + failed + ' blocked/failed. See Sync Log.'); setSel({}); load(); });
  }

  function setFlag(field, val) {
    if (!reg) { return; }
    if (isProd) { toast.error('Production flags are locked in this build.'); return; }
    setSavingFlags(true);
    var patch = {}; patch[field] = val;
    supabase.from('wave_business_registry').update(patch).eq('wave_business_id', active)
      .then(function () { load(); }).catch(function (e) { toast.error('Could not save: ' + (e.message || e)); })
      .finally(function () { setSavingFlags(false); });
  }

  if (loading) { return <div className="p-4 text-slate-400 italic">Loading Wave Sync Center…</div>; }

  var tabs = [['pending', 'Pending Sync'], ['dryrun', 'Dry Run'], ['synced', 'Synced'], ['failed', 'Failed'], ['log', 'Sync Log'], ['settings', 'Settings']].filter(function (t) {
    if (t[0] === 'log') { return canViewLog; }
    if (t[0] === 'settings') { return canManageSettings; }
    return true;
  });

  return (
    <div className="p-4 text-slate-100">
      <div className="text-lg font-extrabold mb-3">🔄 Wave Sync Center</div>
      <SiloBanner registered={!!reg} isTest={!!(reg && reg.is_production === false)} canWrite={!!(reg && reg.writes_enabled === true)} label={reg ? (reg.label || active) : (active || 'No business selected')} />

      {isProd && (
        <div className="mb-3 rounded-lg px-3 py-2 text-sm font-bold" style={{ background: '#7f1d1d', color: '#fff' }}>
          Production writes are disabled in this build. Use read-only reconcile, or unlock production in a future controlled build.
        </div>
      )}

      <div className="flex gap-1 mb-3 flex-wrap">
        {tabs.map(function (t) {
          return <button key={t[0]} onClick={function () { setTab(t[0]); }} className={'px-3 py-1.5 rounded text-xs font-bold ' + (tab === t[0] ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700')}>{t[1]}</button>;
        })}
      </div>

      {tab === 'pending' && (
        <div className="border border-slate-700 rounded overflow-hidden">
          <div className="bg-slate-800/70 px-3 py-2 flex items-center justify-between">
            <div className="text-xs font-bold">Pending in this silo: {queue.length}<span className="ml-2 font-normal text-slate-400">({queue.filter(function (q) { return q.action === 'customer'; }).length} customers · {queue.filter(function (q) { return q.action === 'invoice'; }).length} invoices · {queue.filter(function (q) { return q.action === 'payment'; }).length} payments)</span></div>
            <div className="flex gap-2">
              <button onClick={runDryRun} disabled={isProd || selectedRows.length === 0 || !canDryRun} title={!canDryRun ? 'Requires the Wave: Dry Run permission' : ''} className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-bold rounded">Dry Run Selected ({selectedRows.length})</button>
              <button onClick={pushSelected} disabled={isProd || busy || selectedRows.length === 0 || !canPushAny} title={!canPushAny ? 'Requires a Wave push permission (customers / invoices / payments)' : ''} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded">{busy ? 'Pushing…' : 'Push Selected'}</button>
            </div>
          </div>
          {queue.length === 0 ? <div className="p-4 text-slate-400 italic text-sm">Nothing pending — no Hub customers, invoices, or payments in this silo are waiting to go to Wave.</div> : (
            <div>
              {queue.map(function (q) {
                return (
                  <div key={q.key} className="flex items-center gap-2 px-3 py-2 border-t border-slate-800 text-sm">
                    <input type="checkbox" checked={!!sel[q.key]} disabled={!!q.blocked} onChange={function () { toggle(q.key); }} className="w-4 h-4" />
                    <span className={'px-1.5 py-0.5 rounded text-[10px] font-bold ' + (q.action === 'payment' ? 'bg-emerald-700 text-white' : (q.action === 'invoice' ? 'bg-sky-700 text-white' : 'bg-slate-700 text-white'))}>{q.action}</span>
                    <span className="flex-1">{q.label}{q.sub ? <span className="block text-[10px] text-slate-400">{q.sub}</span> : null}</span>
                    {q.amount != null && <span className="font-mono text-slate-300">{Number(q.amount).toLocaleString()}</span>}
                    {q.action === 'payment' && <button onClick={function () { markManualDone(q.id); }} className="text-[10px] bg-slate-600 hover:bg-slate-500 text-white rounded px-1.5 py-0.5 font-bold" title="I entered this payment in Wave by hand">Mark manual done</button>}
                    <span className={'text-[10px] ' + (q.blocked ? 'text-amber-400 font-bold' : (q.retryable ? 'text-rose-400 font-bold' : 'text-slate-500'))}>{q.blocked ? 'blocked' : (q.retryable ? 'failed · retry' : 'not synced')}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'dryrun' && (
        <div className="border border-slate-700 rounded overflow-hidden">
          {dryResults.length === 0 ? <div className="p-4 text-slate-400 italic text-sm">No dry run yet. Select records under Pending Sync and click Dry Run Selected.</div> : dryResults.map(function (r, i) {
            var color = r.verdict === 'dry_run_ok' ? 'text-emerald-300' : (r.verdict === 'unsupported' ? 'text-amber-300' : 'text-red-300');
            return (
              <div key={i} className="px-3 py-2 border-t border-slate-800 text-sm">
                <div className="font-bold">{r.label}</div>
                <div className={'text-xs ' + color}>{r.verdict} — {r.message}</div>
                {r.targetBusinessId && <div className="text-[10px] text-cyan-300 font-mono mt-0.5">Target: {r.targetBusinessName || ''} · {r.targetBusinessId}</div>}
                {r.wouldDo && <div className="text-[11px] text-slate-400">Would: {r.wouldDo}</div>}
              </div>
            );
          })}
        </div>
      )}

      {tab === 'synced' && (
        <div className="text-sm text-slate-300">
          Customers in Wave: {customers.filter(function (c) { return c.wave_customer_id; }).length} · Invoices in Wave: {invoices.filter(function (i) { return i.wave_invoice_id; }).length}
        </div>
      )}

      {tab === 'failed' && (
        <div className="border border-slate-700 rounded overflow-hidden">
          {syncLog.filter(function (l) { return l.success === false; }).length === 0 ? <div className="p-4 text-slate-400 italic text-sm">No failures logged for this silo.</div> :
            syncLog.filter(function (l) { return l.success === false; }).map(function (l) {
              var fp = syncLogParts(l);
              return (
                <div key={l.id} className="px-3 py-2 border-t border-slate-800 text-xs">
                  <div className="font-bold text-slate-100">{fp.primary}</div>
                  {fp.detail ? <div className="text-[10px] text-slate-400">{fp.detail}</div> : null}
                  <div className="text-[10px] text-red-300 mt-0.5">{l.error_message || 'failed'}</div>
                </div>
              );
            })}
        </div>
      )}

      {tab === 'log' && canViewLog && (
        <div className="border border-slate-700 rounded overflow-hidden">
          {syncLog.length === 0 ? <div className="p-4 text-slate-400 italic text-sm">No sync log entries for this silo yet.</div> :
            syncLog.map(function (l, idx) {
              var mk = (l.response_payload && l.response_payload.api_build_marker) || (l.request_payload && l.request_payload.api_build_marker) || null;
              var rt = (l.request_payload && l.request_payload.route) || (l.response_payload && l.response_payload.route) || null;
              var parts = syncLogParts(l);
              return (
                <div key={l.id} className="px-3 py-2 border-t border-slate-800 text-xs">
                  <div className="font-bold text-slate-100">{parts.primary}</div>
                  {parts.detail ? <div className="text-[10px] text-slate-400">{parts.detail}</div> : null}
                  <div className="flex gap-2 flex-wrap items-center mt-0.5">
                    {idx === 0 && <span className="text-[9px] bg-emerald-700 text-white rounded px-1.5 py-0.5 font-bold">NEWEST</span>}
                    <span className="text-[10px] text-slate-500 font-mono">#{syncLog.length - idx}</span>
                    <span className="text-[10px] text-slate-400 font-mono">{l.attempted_at ? String(l.attempted_at).replace('T', ' ').substring(0, 19) : ''}</span>
                    <span className="text-[10px] text-slate-500">{l.entity_type} · {l.action}{l.dry_run ? ' (dry run)' : ''}</span>
                    <span className={l.success ? 'text-emerald-300' : 'text-red-300'}>{l.success ? 'ok' : 'blocked/failed'}</span>
                    {mk && <span className="text-[9px] text-cyan-300 font-mono">{mk}</span>}
                    {rt && <span className="text-[9px] text-violet-300 font-mono">{rt}</span>}
                    {l.error_message && <span className="text-slate-400">{l.error_message}</span>}
                    {(l.response_payload || l.request_payload) && <button onClick={function () { setOpenLog(openLog === l.id ? null : l.id); }} className="text-[10px] bg-slate-700 hover:bg-slate-600 text-white rounded px-1.5 py-0.5 font-bold">{openLog === l.id ? 'Hide details' : 'View details'}</button>}
                  </div>
                  {openLog === l.id && (
                    <div className="mt-1 space-y-1">
                      {waveErrText(l.response_payload) && <div className="bg-rose-950 border border-rose-700 rounded p-2 text-rose-200 font-mono text-[10px] whitespace-pre-wrap">Wave error: {waveErrText(l.response_payload)}</div>}
                      <details className="bg-slate-950 border border-slate-700 rounded p-2"><summary className="cursor-pointer text-slate-300 text-[10px]">Full request/response payload</summary>
                        {l.request_payload && <pre className="text-[9px] text-cyan-200 whitespace-pre-wrap overflow-auto mt-1">REQUEST: {JSON.stringify(l.request_payload, null, 2)}</pre>}
                        {l.response_payload && <pre className="text-[9px] text-amber-200 whitespace-pre-wrap overflow-auto mt-1">RESPONSE: {JSON.stringify(l.response_payload, null, 2)}</pre>}
                      </details>
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      )}

      {tab === 'settings' && canManageSettings && (
        <div className="bg-white rounded-lg p-4 text-slate-900">
          <div className="mb-4 border border-slate-300 bg-slate-50 rounded-lg p-3">
            <div className="font-bold text-slate-900 mb-1">Database setup check</div>
            <div className="text-xs text-slate-700 mb-2">Confirms the database has every column the Wave payment, settings, and category features need. Run this first if anything fails to save with a "column not found" error.</div>
            <button onClick={runSchemaCheck} disabled={schemaBusy} className="text-xs bg-slate-700 hover:bg-slate-800 text-white rounded px-2 py-1 font-bold disabled:opacity-50">{schemaBusy ? 'Checking…' : 'Check database setup'}</button>
            {schemaResult && schemaResult.results && (
              <div className="mt-2 space-y-1">
                {schemaResult.all_green
                  ? <div className="text-xs bg-emerald-100 text-emerald-950 rounded px-2 py-1 font-medium">✓ All required database columns are present.</div>
                  : <div className="text-xs bg-amber-100 text-amber-950 rounded px-2 py-1 font-medium">Some columns are missing — run the migration pack, then re-check.</div>}
                {schemaResult.results.map(function (r) {
                  return <div key={r.table} className="flex items-start gap-2 text-xs text-slate-900">
                    <span className={r.ok ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>{r.ok ? '✓' : '✗'}</span>
                    <span className="font-mono text-slate-700">{r.table}</span>
                    {!r.ok && <span className="text-rose-700">missing: {r.missing.join(', ')}</span>}
                  </div>;
                })}
              </div>
            )}
            {schemaResult && schemaResult.error && <div className="text-xs mt-2 bg-rose-100 text-rose-950 rounded px-2 py-1 font-medium">{schemaResult.error}</div>}
          </div>
          <div className="mb-4 border border-indigo-200 bg-indigo-50 rounded-lg p-3">
            <div className="font-bold text-slate-900 mb-1">Default Invoice Product (Wave)</div>
            <div className="text-xs text-slate-700 mb-2">Wave requires every invoice line to be tied to a product. Set one reusable product once and all invoice pushes will use it. We recommend creating a product named exactly <b>NextTrade Hub Item</b> in Wave (marked as sold, with an income account), then click Find.</div>
            {prodSetup && prodSetup.default_invoice_product_id ? (
              <div className="text-xs bg-emerald-100 text-emerald-950 rounded px-2 py-1 mb-2 font-medium">Configured product: {prodSetup.default_invoice_product_name || 'NextTrade Hub Item'} ({String(prodSetup.default_invoice_product_id).substring(0, 18)}…)</div>
            ) : <div className="text-xs bg-amber-100 text-amber-950 rounded px-2 py-1 mb-2 font-medium">No default product configured yet — invoice push will be blocked until you set one.</div>}
            <div className="flex gap-2 flex-wrap">
              <button onClick={function () { runProductSetup('find'); }} disabled={prodBusy} className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded px-2 py-1 font-bold disabled:opacity-50">Find "NextTrade Hub Item"</button>
              <button onClick={function () { runProductSetup('create'); }} disabled={prodBusy} className="text-xs bg-slate-700 hover:bg-slate-800 text-white rounded px-2 py-1 font-bold disabled:opacity-50">Create it in Wave</button>
              <button onClick={function () { runProductSetup('list'); }} disabled={prodBusy} className="text-xs bg-slate-200 hover:bg-slate-300 text-slate-900 rounded px-2 py-1 font-bold disabled:opacity-50">List products</button>
            </div>
            {prodMsg && <div className="text-xs mt-2 whitespace-pre-wrap text-slate-800 bg-white border border-slate-200 rounded p-2 font-mono">{prodMsg}</div>}
            {prodList && prodList.length > 0 && (
              <div className="mt-2 max-h-40 overflow-auto border border-slate-200 rounded">
                {prodList.map(function (pr) {
                  return <div key={pr.id} className="flex items-center justify-between px-2 py-1 text-xs border-b border-slate-100"><span className="text-slate-900">{pr.name}{pr.isSold ? '' : ' (not sold)'}</span><button onClick={function () { runProductSetup('select', pr.id, pr.name); }} className="bg-indigo-600 text-white rounded px-2 py-0.5 font-bold">Use this</button></div>;
                })}
              </div>
            )}
          </div>
          <div className="mb-4 border border-teal-200 bg-teal-50 rounded-lg p-3">
            <div className="font-bold text-slate-900 mb-1">Payment Deposit Account (Wave)</div>
            <div className="text-xs text-slate-700 mb-2">Pick the Wave bank/cash account where received invoice payments should land — usually <b>Cash on Hand</b> to start, or your real bank account. This is <b>not</b> Accounts Receivable. Only valid bank/cash accounts can be selected.</div>
            {prodSetup && prodSetup.default_payment_account_id ? (
              <div className="text-xs bg-emerald-100 text-emerald-950 rounded px-2 py-1 mb-2 font-medium">Configured payment account: {prodSetup.default_payment_account_name || prodSetup.default_payment_account_id}</div>
            ) : <div className="text-xs bg-amber-100 text-amber-950 rounded px-2 py-1 mb-2 font-medium">No payment account configured yet — payment push will be blocked until you set one.</div>}
            <div className="flex gap-2 flex-wrap">
              <button onClick={function () { runPaymentAccountSetup('list'); }} disabled={payBusy} className="text-xs bg-teal-600 hover:bg-teal-700 text-white rounded px-2 py-1 font-bold disabled:opacity-50">List bank/cash accounts</button>
            </div>
            {payMsg && <div className="text-xs mt-2 whitespace-pre-wrap text-slate-800 bg-white border border-slate-200 rounded p-2 font-mono">{payMsg}</div>}
            {payList && payList.length > 0 && (
              <div className="mt-2 max-h-40 overflow-auto border border-slate-200 rounded">
                {payList.filter(function (ac) { return ac.payment_capable; }).length === 0 && (
                  <div className="px-2 py-2 text-xs bg-amber-100 text-amber-950 font-medium">No bank/cash accounts found in Wave. In Wave, create a Cash on Hand or bank account, then refresh this list.</div>
                )}
                {payList.slice().sort(function (a, b) { return (b.payment_capable ? 1 : 0) - (a.payment_capable ? 1 : 0); }).map(function (ac) {
                  var capable = ac.payment_capable === true;
                  return <div key={ac.id} className={'flex items-center justify-between px-2 py-1 text-xs border-b border-slate-100 ' + (capable ? '' : 'bg-slate-50')}>
                    <span className={capable ? 'text-slate-900' : 'text-slate-400'}>{ac.name}{ac.subtype ? <span className={capable ? 'text-slate-500' : 'text-slate-400'}> · {ac.subtype}</span> : null}{capable ? null : <span className="text-amber-700"> — not a deposit account</span>}</span>
                    {capable
                      ? <button onClick={function () { runPaymentAccountSetup('select', ac.id, ac.name); }} className="bg-teal-600 hover:bg-teal-700 text-white rounded px-2 py-0.5 font-bold">Use this</button>
                      : <span className="text-slate-300 text-[10px] px-2">can't use</span>}
                  </div>;
                })}
              </div>
            )}
          </div>
          <div className="mb-4 border border-violet-200 bg-violet-50 rounded-lg p-3">
            <div className="font-bold text-slate-900 mb-1">Wave Categories (Chart of Accounts)</div>
            <div className="text-xs text-slate-700 mb-2">Pull your Wave categories into Hub so bank transactions can be categorized with the exact same names Wave uses. This only reads from Wave — it never changes anything in Wave.</div>
            <div className="text-xs bg-white border border-violet-200 text-slate-900 rounded px-2 py-1 mb-2 font-medium">{catCount > 0 ? (catCount + ' Wave categories loaded for this business.') : 'No Wave categories loaded yet for this business.'}</div>
            <div className="flex gap-2 flex-wrap">
              <button onClick={runCategoryPull} disabled={catBusy || !canPullCats} title={!canPullCats ? 'Requires the Wave: Pull Categories permission' : ''} className="text-xs bg-violet-600 hover:bg-violet-700 text-white rounded px-2 py-1 font-bold disabled:opacity-50">{catBusy ? 'Pulling…' : 'Pull Wave categories'}</button>
            </div>
            {catMsg && <div className="text-xs mt-2 whitespace-pre-wrap text-slate-800 bg-white border border-slate-200 rounded p-2 font-mono">{catMsg}</div>}
          </div>
          <div className="font-bold mb-2">Push permissions for: {reg ? (reg.label || active) : 'No business selected'}</div>
          {reg && !isProd && (function () {
            var checks = [
              ['Writes enabled', reg.writes_enabled === true],
              ['Payment push enabled', reg.allow_payment_push === true],
              ['Payment deposit account set', !!(prodSetup && prodSetup.default_payment_account_id)],
              ['Invoice product set', !!(prodSetup && prodSetup.default_invoice_product_id)],
              ['Wave categories loaded', catCount > 0]
            ];
            return <div className="mb-3 border border-slate-300 rounded-lg p-3 bg-white">
              <div className="font-bold text-slate-900 mb-2 text-sm">Payment push readiness</div>
              <div className="space-y-1">
                {checks.map(function (c) {
                  return <div key={c[0]} className="flex items-center gap-2 text-xs text-slate-900">
                    <span className={c[1] ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>{c[1] ? '✓' : '✗'}</span>
                    <span className={c[1] ? 'text-slate-700' : 'text-rose-700 font-semibold'}>{c[0]}</span>
                  </div>;
                })}
              </div>
              {checks.every(function (c) { return c[1]; })
                ? <div className="mt-2 text-xs bg-emerald-100 text-emerald-950 rounded px-2 py-1 font-medium">All set — you can dry-run and push one payment.</div>
                : <div className="mt-2 text-xs bg-amber-100 text-amber-950 rounded px-2 py-1 font-medium">Finish the red items above before pushing payments.</div>}
            </div>;
          })()}
          {!reg ? <div className="text-sm text-slate-500">Select a registered Wave business first.</div> : isProd ? (
            <div className="text-sm text-red-700 font-semibold">This is a PRODUCTION business. All push flags are locked in this build.</div>
          ) : (
            <div className="space-y-2 text-sm">
              {[['writes_enabled', 'Writes enabled (master switch)'], ['allow_customer_push', 'Allow customer push'], ['allow_invoice_push', 'Allow invoice push'], ['allow_payment_push', 'Allow payment push (records payments in Wave)'], ['allow_auto_push', 'Allow auto-push (keep OFF)']].map(function (f) {
                var disabled = savingFlags || f[0] === 'allow_auto_push';
                return (
                  <label key={f[0]} className="flex items-center gap-2">
                    <input type="checkbox" checked={reg[f[0]] === true} disabled={disabled} onChange={function (e) { setFlag(f[0], e.target.checked); }} />
                    <span className={disabled && f[0] === 'allow_auto_push' ? 'text-slate-400' : ''}>{f[1]}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
