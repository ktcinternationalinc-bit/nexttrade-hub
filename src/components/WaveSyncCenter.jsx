import React, { useState, useEffect, useMemo } from 'react';
import { supabase, dbUpdate } from '../lib/supabase';
import { fetchAllRows } from '../lib/fetch-all-rows';
import { isPaymentVoid } from '../lib/payment-matching';
import { getActiveWaveBusiness, setActiveWaveBusiness, scopeIfRegistered, isPlaceholderWaveBusiness } from '../lib/wave-business';
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
  var canMarkManualDone = _can('payments.mark_manual_done');

  var [tab, setTab] = useState('pending');
  var [loading, setLoading] = useState(true);
  var [registry, setRegistry] = useState([]);
  var [customers, setCustomers] = useState([]);
  var [invoices, setInvoices] = useState([]);
  var [payments, setPayments] = useState([]);
  var [bankTxns, setBankTxns] = useState([]);
  var [splitTxns, setSplitTxns] = useState([]);   // v55.83-HE — split lines with a pending Wave category
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
  var cn0 = useState(false); var connecting = cn0[0]; var setConnecting = cn0[1]; // v55.83-KT one-click connect-to-Wave
  var cn1 = useState(''); var connectMsg = cn1[0]; var setConnectMsg = cn1[1];
  var cn2 = useState(null); var connectChoices = cn2[0]; var setConnectChoices = cn2[1];
  var sp0 = useState(false); var schemaBusy = sp0[0]; var setSchemaBusy = sp0[1];
  var sp1 = useState(null); var schemaResult = sp1[0]; var setSchemaResult = sp1[1];
  var bk0 = useState([]); var bankAccts = bk0[0]; var setBankAccts = bk0[1];
  var bk1 = useState(''); var bankSel = bk1[0]; var setBankSel = bk1[1];
  var bk2 = useState(false); var bankBusy = bk2[0]; var setBankBusy = bk2[1];
  var bk3 = useState(''); var bankMsg = bk3[0]; var setBankMsg = bk3[1];
  var [sel, setSel] = useState({});
  var [busy, setBusy] = useState(false);
  var [savingFlags, setSavingFlags] = useState(false);
  var [flagStatus, setFlagStatus] = useState(null); // v55.83-JN — persistent inline save status for the production unlock

  var active = getActiveWaveBusiness();
  var reg = registry.find(function (r) { return r.wave_business_id === active; });
  var isProd = !!(reg && reg.is_production !== false);
  // v55.83-HI — super-admin master switch to allow REAL production Wave pushes for this business.
  // Default OFF (column absent/false → locked, exactly as before). Flipped only by a super admin
  // after testing on the test silo. Server routes enforce the same flag independently.
  var productionUnlocked = !!(reg && reg.production_push_unlocked === true);

  function load() {
    setLoading(true);
    Promise.all([
      fetchAllRows('wave_business_registry', '*'),
      fetchAllRows('accounting_customers', '*', 'company_name', true),
      fetchAllRows('accounting_invoices', '*', 'created_at', false),
      supabase.from('wave_sync_log').select('*').order('attempted_at', { ascending: false }).order('id', { ascending: false }).limit(100),
      fetchAllRows('accounting_invoice_payments', '*', 'payment_date', false),
      fetchAllRows('bank_transactions', 'id, amount_abs, name, posted_date, date, direction, classification, wave_business_id, wave_account_id, wave_account_name, category_status'),
      // v55.83-HE — split lines categorized to a Wave account. Resilient: if the table is missing
      // the Wave columns (migration not yet run), default to [] so the Sync Center still loads.
      supabase.from('bank_transaction_splits').select('id, bank_transaction_id, split_amount, wave_business_id, wave_account_name, category_status').then(function (x) { return x; }).catch(function () { return { data: [] }; })
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
      setBankTxns(scopeIfRegistered((res[5] && res[5].data) || [], getActiveWaveBusiness(), rg, true));
      setSplitTxns(scopeIfRegistered((res[6] && res[6].data) || [], getActiveWaveBusiness(), rg, true));
      setInvoices(scopeIfRegistered((res[2] && res[2].data) || [], getActiveWaveBusiness(), rg, true));
      // v55.83-IM (QA fix) — wave_business_id didn't exist on wave_sync_log until this build, so the
      // old `=== active` filter matched undefined and HID every audit row (push rows AND import rows,
      // which scope via wave_record_id/business_id). Show rows for the active silo PLUS any row not
      // tagged with a wave_business_id, so the audit trail is visible instead of silently blank.
      setSyncLog(((res[3] && res[3].data) || []).filter(function (l) { return !active || l.wave_business_id === active || l.wave_record_id === active || l.wave_business_id == null; }));
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

  // v55.83-GD — per-silo default bank account. The account list is sourced from THIS silo's bank
  // transactions (the same account_id Bank Review filters on), labelled via plaid_accounts.
  function loadBankAccts() {
    if (!active) { setBankAccts([]); return; }
    Promise.all([
      supabase.from('bank_transactions').select('account_id, name').eq('wave_business_id', active).limit(3000),
      supabase.from('plaid_accounts').select('plaid_account_id, name, mask')
    ]).then(function (res) {
      var pa = {}; ((res[1] && res[1].data) || []).forEach(function (a) { if (a && a.plaid_account_id) { pa[a.plaid_account_id] = a; } });
      var seen = {}; var list = [];
      ((res[0] && res[0].data) || []).forEach(function (t) {
        if (!t.account_id || seen[t.account_id]) { return; }
        seen[t.account_id] = true;
        var a = pa[t.account_id];
        var label = a ? ((a.name || 'Account') + (a.mask ? (' ··' + a.mask) : '')) : (t.name || ('Account ··' + String(t.account_id).slice(-4)));
        list.push({ account_id: t.account_id, label: label });
      });
      setBankAccts(list);
    }).catch(function () { setBankAccts([]); });
  }
  useEffect(function () { loadBankAccts(); setBankSel(''); setBankMsg(''); }, [active]);

  function saveDefaultBank(accId) {
    var chosen = null; bankAccts.forEach(function (a) { if (a.account_id === accId) { chosen = a; } });
    setBankBusy(true); setBankMsg('');
    fetch('/api/wave/default-bank-account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wave_business_id: active, user_id: (userProfile && userProfile.id) || null, default_plaid_account_id: accId || null, default_plaid_account_name: chosen ? chosen.label : null }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.saved) { setBankMsg(accId ? ('Default bank account set: ' + (d.default_plaid_account_name || d.default_plaid_account_id)) : 'Default bank account cleared.'); loadProdSetup(); toast.success('Default bank account saved'); }
        else if (d && d.db_error) { setBankMsg('Database save FAILED: ' + d.db_error + '\n\nIf this mentions a missing column, run the silo migration (adds default_plaid_account_id / default_plaid_account_name / default_bank_connection_id to wave_business_settings).'); toast.error('Save failed — see message'); }
        else if (d && d.error) { setBankMsg('Error: ' + d.error); toast.error('Save failed'); }
        else { setBankMsg(JSON.stringify(d, null, 2)); }
      })
      .catch(function (e) { setBankMsg('Request failed: ' + ((e && e.message) || String(e))); })
      .finally(function () { setBankBusy(false); });
  }

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

  // v55.83-KT — ONE-CLICK CONNECT. Stop telling the user to go hunt the bind tool. This: (1) asks the
  // server what Wave businesses the configured token can actually access, (2) finds the one that matches
  // this silo (by name), (3) binds it via the hardened, all-or-nothing bind route. If the token can't see
  // a match, it says EXACTLY that (the one real blocker: the token doesn't have access to that Wave account).
  function normName(s) { return String(s || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, ''); }
  function doBind(toId, toName) {
    var body = { from_wave_business_id: active, to_wave_business_id: toId, to_label: toName || null, user_id: (userProfile && userProfile.id) || null };
    setConnectMsg('Connecting "' + ((reg && reg.label) || active) + '" → "' + (toName || toId) + '"…');
    fetch('/api/wave/bind-business', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({}, body, { dry_run: true })) })
      .then(function (r) { return r.json(); })
      .then(function (dry) {
        if (!dry || dry.ok === false) { setConnecting(false); setConnectMsg('✕ ' + ((dry && dry.error) || 'Could not preview the connection.')); return null; }
        if (!window.confirm('Connect "' + ((reg && reg.label) || active) + '" to your Wave business "' + (toName || toId) + '"?\n\n' + dry.message)) { setConnecting(false); setConnectMsg('Cancelled — nothing changed.'); return null; }
        return fetch('/api/wave/bind-business', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({}, body, { dry_run: false })) }).then(function (r2) { return r2.json(); });
      })
      .then(function (res) {
        if (!res) { return; }
        setConnecting(false);
        setConnectMsg((res.ok ? '✓ ' : '✕ ') + (res.message || res.error || 'done'));
        if (res.ok) {
          setConnectChoices(null);
          /* v55.83-KW (Codex) — point the browser at the NEW real GUID before reload, else the page stays on the placeholder and still looks unconnected. */
          var newGuid = res.to_wave_business_id || toId;
          try { setActiveWaveBusiness(newGuid); } catch (eS) {}
          /* v55.83-LE (workflow P3) — a freshly-bound real GUID has NO Wave categories yet (the placeholder
             had none to carry over), so the categorize dropdown would be empty until a manual pull. Auto-pull
             the chart of accounts now (production needs includeProduction:true), THEN reload. */
          setConnectMsg('✓ Connected. Pulling this business’s Wave chart of accounts…');
          fetch('/api/wave/sync-categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wave_business_id: newGuid, includeProduction: true, user_id: (userProfile && userProfile.id) || null }) })
            .then(function (rc) { return rc.json(); }).catch(function () { return null; })
            .then(function () { setTimeout(function () { if (typeof window !== 'undefined') { window.location.reload(); } }, 1200); });
        }
      })
      .catch(function (e) { setConnecting(false); setConnectMsg('✕ Connect failed: ' + ((e && e.message) || 'network error')); });
  }
  function connectToWave() {
    setConnecting(true); setConnectChoices(null); setConnectMsg('Checking what your Wave token can access…');
    fetch('/api/wave/check').then(function (r) { return r.json(); })
      .then(function (chk) {
        if (!chk || chk.connected === false) { setConnecting(false); setConnectMsg('✕ ' + ((chk && chk.error) || 'Your Wave token is not connected. Add WAVE_ACCESS_TOKEN in Vercel, then redeploy.')); return; }
        var bizs = (chk.businesses || []).filter(function (b) { return b && !b.isPersonal; });
        if (!bizs.length) { setConnecting(false); setConnectMsg('✕ Your Wave token can\'t see ANY Wave businesses. It needs access to the Wave account that owns this silo\'s books — add/replace WAVE_ACCESS_TOKEN in Vercel with a token for that account.'); return; }
        // v55.83-KU — match the silo to a business the token can see. STRONG = substring either way;
        // otherwise a shared DISTINCTIVE word (len>=3, minus generic terms like production/test/inc) — so
        // "Real KTC (Production)" auto-matches a Wave business named e.g. "KTC International". Exactly one
        // candidate -> auto-connect; more than one -> show a pick-list (safe; bind is dry-run-confirmed).
        var STOP = { production: 1, prod: 1, test: 1, the: 1, and: 1, inc: 1, llc: 1, ltd: 1, co: 1, company: 1, corp: 1 };
        var tokensOf = function (s) { return String(s || '').toLowerCase().replace(/\(.*?\)/g, '').split(/[^a-z0-9]+/).filter(function (t) { return t && t.length >= 3 && !STOP[t]; }); };
        var labelCore = normName((reg && reg.label) || active);
        var labelToks = tokensOf((reg && reg.label) || active);
        var cands = [];
        bizs.forEach(function (b) {
          var n = normName(b.name);
          if (n && labelCore && (n.indexOf(labelCore) >= 0 || labelCore.indexOf(n) >= 0)) { cands.push(b); return; }
          var bt = tokensOf(b.name);
          for (var ti = 0; ti < labelToks.length; ti++) { if (bt.indexOf(labelToks[ti]) >= 0) { cands.push(b); return; } }
        });
        // v55.83-KW (Codex) — auto-connect ONLY a confident NAME match. Never auto-bind a single business
        // that doesn't match the silo (it might be the wrong company's real books) — force an explicit pick.
        var match = (cands.length === 1) ? cands[0] : null;
        if (match) { doBind(match.id, match.name); return; }
        // ambiguous (or no clear match) — let the user pick from what the token can see (one click each)
        setConnecting(false);
        setConnectChoices(cands.length > 1 ? cands : bizs);
        setConnectMsg(cands.length > 1
          ? ('More than one of your Wave businesses could be "' + ((reg && reg.label) || active) + '". Pick the right one:')
          : ('Your Wave token sees ' + bizs.length + ' business(es) but none clearly matches "' + ((reg && reg.label) || active) + '". Pick the right one:'));
      })
      .catch(function (e) { setConnecting(false); setConnectMsg('✕ Could not reach Wave: ' + ((e && e.message) || 'network error')); });
  }

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
        // v55.83-JO — the pull is per-business and can FAIL or return 0 accounts for THIS silo even
        // when the overall request is ok:true (e.g. the single Wave token can't access Real KTC's
        // business). The old code showed "Done. 0 new" + a success toast and hid that — exactly why
        // Real KTC looked "pulled" but had no categories. Surface the real per-business result.
        if (d && d.results && d.results.length) {
          var res0 = d.results[0];
          var sum = res0.summary || res0;
          if (res0.ok === false) {
            setCatMsg('⛔ ' + (res0.business || 'This silo') + ': Wave returned an error — ' + (res0.error || (res0.errors && res0.errors.join('; ')) || 'unknown') + '. The Wave token likely cannot access this business, or it has no Chart of Accounts. No categories were pulled.');
            toast.error('Category pull failed for this silo'); loadCatCount(); return;
          }
          var totalAcc = (res0.total != null) ? res0.total : ((sum.created || 0) + (sum.updated || 0) + (sum.skipped || 0));
          if (!totalAcc) {
            setCatMsg('⚠ ' + (res0.business || 'This silo') + ': Wave returned 0 accounts. Either the Wave token has no access to this business, or this business has no Chart of Accounts yet. Nothing to categorize with until this returns accounts.');
            toast.error('No Wave accounts returned for this silo'); loadCatCount(); return;
          }
          setCatMsg('✅ ' + (res0.business || 'Done') + ': ' + totalAcc + ' Wave accounts (' + (sum.created || 0) + ' new, ' + (sum.updated || 0) + ' updated, ' + (sum.skipped || 0) + ' unchanged).');
          toast.success('Wave categories synced'); loadCatCount();
        } else if (d && (d.created != null || d.updated != null)) {
          setCatMsg('Done. ' + (d.created || 0) + ' new, ' + (d.updated || 0) + ' updated, ' + (d.skipped || 0) + ' unchanged.');
          toast.success('Wave categories synced'); loadCatCount();
        } else if (d && d.message) { setCatMsg('⚠ ' + d.message); toast.error('No categories pulled — see message'); loadCatCount(); }
        else if (d && d.error) { setCatMsg('⛔ Error: ' + d.error); toast.error('Category sync failed'); }
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
    // v55.83-IN — every bank txn that has ANY non-void payment (pending OR already synced) is
    // "matched" and must not also appear in the Hub-only categorize list.
    var matchedTxnIds = {};
    payments.forEach(function (p) {
      if (!p || isPaymentVoid(p) || !p.bank_transaction_id) { return; }
      matchedTxnIds[p.bank_transaction_id] = true;
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
      else if (inv && (inv.wave_status === 'DRAFT' || inv.wave_sync_status === 'pushed_draft')) { blocked = 'Wave invoice is DRAFT — approve/repair it (use "Approve in Wave") before pushing this payment. Retrying the payment will hit the same Wave error.'; }
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
        draftBlockedInvoiceId: (inv && (inv.wave_status === 'DRAFT' || inv.wave_sync_status === 'pushed_draft')) ? inv.id : null,
        record: Object.assign({}, p, { wave_invoice_id: invWaveId, wave_customer_id: custWaveId, _invoice_number: invNo, _customer_name: custName })
      });
    });
    // v55.83-GS — bank transactions categorized/classified for Wave must STILL appear here
    // (truthful), not silently vanish because they aren't a customer/invoice/payment. There is no
    // generic Wave transaction push route yet, so they are shown BLOCKED ("Hub-only — not
    // implemented yet") — visible and never pushed. category_status is the bank-txn sync flag.
    bankTxns.forEach(function (bt) {
      if (!bt || bt.wave_business_id !== active) { return; }
      if (bt.category_status !== 'pending_wave_sync') { return; }
      // v55.83-IN (core fix) — if this transaction has been MATCHED to an invoice, it already
      // produced a payment row (the actual Wave-bound item, shown in the payments section above).
      // Do NOT also list it here as a "Hub-only" categorization — that made a matched deposit look
      // blocked/stuck when its payment is really what pushes to Wave.
      if (matchedTxnIds[bt.id] || bt.matched_invoice_id || bt.linked_id) { return; }
      // v55.83-KZ — Wave DOES accept categorized transactions (moneyTransactionCreate, verified live).
      // A categorized bank txn is now a real PUSH; an uncategorized one stays Hub-only until classified.
      var hasCat = !!bt.wave_account_id;
      var bb = [];
      if (bt.posted_date || bt.date) { bb.push(String(bt.posted_date || bt.date).substring(0, 10)); }
      if (bt.classification) { bb.push('class: ' + bt.classification); }
      if (bt.wave_account_name) { bb.push('→ ' + bt.wave_account_name); }
      if (hasCat) { bb.push('posts to Wave as a money transaction (bank side = this silo\'s deposit account)'); }
      else { bb.push('ℹ Pick a Wave Category for this transaction in Bank Review, then it can post to Wave.'); }
      rows.push({
        key: 'banktxn:' + bt.id, action: 'transaction', id: bt.id,
        label: 'Bank txn · ' + (bt.name || ('#' + String(bt.id).substring(0, 8))) + (bt.wave_account_name ? (' · ' + bt.wave_account_name) : ''),
        amount: Number(bt.amount_abs) || 0,
        sub: bb.join(' · '),
        blocked: hasCat ? null : 'Pick a Wave category first (Bank Review).',
        hubOnly: !hasCat,
        record: bt
      });
    });
    // v55.83-HE (Codex QA FAIL fix) — split lines that picked a Wave category must ALSO appear
    // here (truthful), not vanish because the parent txn was split. Same Hub-only blocked status
    // as bank txns until a generic Wave category push exists.
    splitTxns.forEach(function (sp) {
      if (!sp || sp.wave_business_id !== active) { return; }
      if (sp.category_status !== 'pending_wave_sync') { return; }
      var sb = [];
      if (sp.wave_account_name) { sb.push('→ ' + sp.wave_account_name); }
      sb.push('ℹ Split-line transaction push to Wave is the next step; for now the split stays in the Hub. (Single-category bank transactions DO push now.)');
      rows.push({
        key: 'split:' + sp.id, action: 'bank_transaction_split', id: sp.id,
        label: 'Split line · ' + (sp.wave_account_name || 'Wave category'),
        amount: Number(sp.split_amount) || 0,
        sub: sb.join(' · '),
        blocked: 'Split-line Wave push coming next — stays in the Hub for now.',
        hubOnly: true,
        record: sp
      });
    });
    return rows;
  }, [customers, invoices, payments, bankTxns, splitTxns, active]);

  // v55.83-IN (Codex) — separate actionable Wave pushes (customers/invoices/payments) from
  // Hub-only bank categorizations that Wave's API cannot accept. They must NOT inflate the main
  // pending count or sit in the push list as if they were pushable.
  var actionableQueue = queue.filter(function (q) { return !q.hubOnly; });
  var hubOnlyQueue = queue.filter(function (q) { return q.hubOnly; });

  function toggle(key) { setSel(function (p) { var n = Object.assign({}, p); if (n[key]) { delete n[key]; } else { n[key] = true; } return n; }); }

  // Mark a queued payment as entered-in-Wave-manually (clears it from the pending queue
  // without faking a wave_payment_id). Logged to audit_log via dbUpdate.
  function markManualDone(paymentId) {
    if (!paymentId) { return; }
    if (!isSuperAdmin && !canMarkManualDone) { toast.error('You do not have the Payments: Mark Manual Done permission.'); return; }
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

  // v55.83-IN — one-click approve a DRAFT invoice in Wave (DRAFT -> SAVED) so it accepts payments,
  // instead of telling the user to open Wave and approve by hand + re-import.
  function approveInWave(invoiceId) {
    if (!invoiceId) { return; }
    if (!canPushInvoice) { toast.error('You do not have the Wave: Invoice push permission.'); return; }
    setBusy(true);
    fetch('/api/wave/approve-invoice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wave_business_id: active, hub_record_id: invoiceId, user_id: (userProfile && userProfile.id) || null }) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.success) { toast.success('Invoice approved in Wave (' + (j.wave_status || 'SAVED') + ') — it can now accept payments.'); load(); }
        else if (j && j.approved_in_wave) { toast.success('Approved in Wave — run Wave Import to refresh the status.'); load(); }
        else { toast.error('Approve failed: ' + ((j && j.error) || 'see Sync Log for the exact Wave reason')); }
      })
      .catch(function (e) { toast.error('Approve failed: ' + ((e && e.message) || 'network error')); })
      .finally(function () { setBusy(false); });
  }
  var selectedRows = queue.filter(function (q) { return sel[q.key] && !q.blocked; });

  function runDryRun() {
    if (isProd && !productionUnlocked) { toast.error('Production push is locked. A super admin must enable real production push in Settings first.'); return; }
    if (selectedRows.length === 0) { toast.error('Select at least one record.'); return; }
    // v55.83-LC (Codex) — transaction rows dry-run against the SERVER so the preview shows the exact Wave
    // anchor (bank-side) account + direction, and surfaces a block reason (e.g. multi-account silo, no
    // deposit account). Other entity types keep the client-side dryRunRecord preview.
    var seq = Promise.resolve(); var results = [];
    selectedRows.forEach(function (q) {
      seq = seq.then(function () {
        if (q.action !== 'transaction') {
          var v = dryRunRecord({ action: q.action, record: q.record, waveBusinessId: active, registry: registry });
          results.push({ label: q.label, verdict: v.verdict, message: v.message, wouldDo: v.wouldDo });
          return null;
        }
        return fetch('/api/wave/push-transaction', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wave_business_id: active, hub_record_id: q.id, dry_run: true, user_id: userProfile && userProfile.id }) })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d && d.ok && d.dry_run) { results.push({ label: q.label, verdict: 'WOULD POST', message: 'Bank side (anchor): ' + (d.anchor_account || '?') + ' · ' + d.direction + ' ' + d.amount + ' → category: ' + (d.category_name || d.category_account_id), wouldDo: d.would_send }); }
            else { results.push({ label: q.label, verdict: 'BLOCKED', message: (d && d.error) || 'blocked', wouldDo: null }); }
          })
          .catch(function (e) { results.push({ label: q.label, verdict: 'ERROR', message: (e && e.message) || 'error', wouldDo: null }); });
      });
    });
    seq.then(function () { setDryResults(results); setTab('dryrun'); });
  }
  var [dryResults, setDryResults] = useState([]);
  // v55.83-LD — CSV import: pull Wave-UI categorizations the API can't read (see WAVE_API_TRANSACTION_EVIDENCE.md).
  var [csvText, setCsvText] = useState('');
  var [csvBusy, setCsvBusy] = useState(false);
  var [csvResult, setCsvResult] = useState(null);
  function runCsvImport(apply) {
    if (!csvText.trim()) { toast.error('Paste the CSV you exported from Wave first.'); return; }
    setCsvBusy(true); setCsvResult(null);
    fetch('/api/wave/import-transaction-csv', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wave_business_id: active, csv: csvText, dry_run: !apply, user_id: userProfile && userProfile.id }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        setCsvResult(d); setCsvBusy(false);
        if (!d || !d.ok) { toast.error((d && d.error) || 'Import failed.'); return; }
        if (d.dry_run) { toast.success('Preview: ' + d.matched_count + ' matched, ' + d.unmatched_count + ' unmatched.'); }
        else { toast.success('Applied: ' + d.applied + ' transaction categories reflected from Wave.'); load(); }
      })
      .catch(function (e) { setCsvBusy(false); toast.error((e && e.message) || 'Import failed.'); });
  }
  // v55.83-LG — READ-ONLY probe of Wave's invoice PAYMENTS (these are API-readable, unlike money txns).
  // Confirms, on the live books, that Wave-native payments + the bank account they hit are visible — the
  // gate before auto-linking them to Hub deposits.
  var [probeBusy, setProbeBusy] = useState(false);
  var [probeResult, setProbeResult] = useState(null);
  function runPaymentReadback() {
    setProbeBusy(true); setProbeResult(null);
    fetch('/api/wave/payment-readback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wave_business_id: active, user_id: userProfile && userProfile.id }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { setProbeResult(d); setProbeBusy(false); if (!d || (!d.ok && !d.payments_found)) { toast.error((d && d.error) || 'Read-back failed.'); } else { toast.success('Wave shows ' + (d.payments_found || 0) + ' payment(s) across ' + (d.invoices_scanned || 0) + ' invoice(s).'); } })
      .catch(function (e) { setProbeBusy(false); toast.error((e && e.message) || 'Read-back failed.'); });
  }

  function pushSelected() {
    if (isProd && !productionUnlocked) { toast.error('Production writes are locked. A super admin must enable real production push in Settings first.'); return; }
    if (selectedRows.length === 0) { toast.error('Select records and Dry Run first.'); return; }
    // v55.83-GC — per-action permission gate (defense alongside the server route checks).
    var lacksPerm = selectedRows.some(function (q) {
      if (q.action === 'customer') { return !canPushCustomer; }
      if (q.action === 'invoice') { return !canPushInvoice; }
      if (q.action === 'payment') { return !canPushPayment; }
      if (q.action === 'transaction') { return !canPushPayment; } // v55.83-KZ — same write-to-books permission
      return false;
    });
    if (lacksPerm) { toast.error('You do not have permission to push one or more of the selected record types.'); return; }
    // PAYMENT-PUSH SAFETY (launch): payments go one at a time until Wave's behavior (incl. the
    // paymentMethod enum) is fully confirmed on live data. Customer/invoice pushes are proven
    // and may still go in a batch.
    // v55.83-KZ — anything that posts to real Wave books (payments + categorized transactions) goes ONE
    // at a time until the first live ones are confirmed, and never mixed with other record types.
    var selectedBooks = selectedRows.filter(function (q) { return q.action === 'payment' || q.action === 'transaction'; });
    if (selectedBooks.length > 1) {
      toast.error('Push payments/transactions ONE at a time for now. Select a single one, Dry Run, then Push. (This limit lifts once the first live ones are confirmed in Wave.)');
      return;
    }
    if (selectedBooks.length === 1 && selectedRows.length > 1) {
      toast.error('Push a payment/transaction by itself (do not mix it with other records). Select just the one.');
      return;
    }
    setBusy(true);
    var seq = Promise.resolve();
    var done = 0, failed = 0; var errs = []; // v55.83-LB — capture the SPECIFIC reason so a failed push
    // isn't a silent "nothing happened" (e.g. "no Wave deposit account set" after a fresh connect).
    selectedRows.forEach(function (q) {
      seq = seq.then(function () {
        var route = q.action === 'customer' ? '/api/wave/push-customer' : (q.action === 'invoice' ? '/api/wave/push-invoice-v2' : (q.action === 'transaction' ? '/api/wave/push-transaction' : '/api/wave/push-payment'));
        return fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wave_business_id: active, hub_record_id: q.id, dry_run: false, user_id: userProfile && userProfile.id }) })
          .then(function (r) { return r.json().then(function (d) { return { http: r.status, d: d }; }); })
          .then(function (x) { var d = x.d || {}; if (d.success || d.ok) { done++; } else { failed++; errs.push((q.label || q.action) + ': ' + (d.error || ('HTTP ' + x.http))); } })
          .catch(function (e) { failed++; errs.push((q.label || q.action) + ': ' + ((e && e.message) || 'network error')); });
      });
    });
    seq.then(function () {
      setBusy(false);
      if (failed > 0) { setProdMsg('Push: ' + done + ' ok, ' + failed + ' failed.\n' + errs.join('\n')); toast.error('Push: ' + done + ' ok, ' + failed + ' failed — ' + (errs[0] || '')); }
      else { toast.success('Push finished — ' + done + ' pushed to Wave.'); }
      setSel({}); load();
    });
  }

  function setFlag(field, val) {
    if (!reg) { return; }
    // v55.83-HI — production_push_unlocked is the super-admin master switch; only a super admin
    // may set it, and it can be set even on a production business (that is the whole point). Every
    // OTHER Wave flag stays locked on a production business until it has been unlocked. Test
    // businesses (is_production === false) are unaffected.
    if (field === 'production_push_unlocked') {
      if (!isSuperAdmin) { toast.error('Only a super admin can enable real production push.'); return; }
    } else if (isProd && !productionUnlocked) {
      toast.error('Unlock real production push first (super-admin switch in Settings).'); return;
    }
    setSavingFlags(true);
    setFlagStatus({ field: field, pending: true, msg: 'Saving ' + field + '…' });
    // v55.83-IZ/JN — save through the SERVICE-ROLE route. The old direct client update was silently
    // filtered by RLS (email-auth) and ignored the error/0-row result, so the unlock never persisted.
    // JN: treat success ONLY when the route confirms the readback equals what we asked for, merge the
    // returned row into registry immediately (so the checkbox reflects the server truth before load()),
    // and keep a persistent inline status so a failure no longer just silently snaps the toggle off.
    fetch('/api/wave/registry-flags', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ waveBusinessId: active, field: field, value: val, user_id: (userProfile && userProfile.id) || null }) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var readback = j && (typeof j.value !== 'undefined' ? j.value : (j.row ? j.row[field] : undefined));
        var saved = j && j.ok === true && readback === val;
        if (!saved) {
          var emsg = (j && j.error) || ('Save did not confirm (requested ' + JSON.stringify(val) + ', got ' + JSON.stringify(readback) + ')');
          toast.error('Could not save "' + field + '": ' + emsg);
          setFlagStatus({ field: field, ok: false, msg: emsg, requested: val, saved: readback, rowId: (j && j.registry_row_id) || null, label: (j && j.registry_label) || null });
        } else {
          // Merge the verified server row into the local registry so the toggle reflects truth now.
          if (j.row) {
            setRegistry(function (prev) { return (prev || []).map(function (rr) { return (rr && rr.wave_business_id === active) ? Object.assign({}, rr, j.row) : rr; }); });
          }
          toast.success((val ? 'Enabled' : 'Disabled') + ': ' + field + (j.registry_label ? ' on ' + j.registry_label : ''));
          setFlagStatus({ field: field, ok: true, msg: (val ? 'Enabled' : 'Disabled') + ' ' + field + ' (confirmed saved' + (j.registry_label ? ' on ' + j.registry_label : '') + ')', rowId: j.registry_row_id || null, label: j.registry_label || null });
        }
        load();
      })
      .catch(function (e) { var em = (e && e.message) || String(e); toast.error('Could not save: ' + em); setFlagStatus({ field: field, ok: false, msg: em }); })
      .finally(function () { setSavingFlags(false); });
  }

  if (loading) { return <div className="p-4 text-slate-400 italic">Loading Wave Sync Center…</div>; }

  var tabs = [['pending', 'Pending Sync'], ['dryrun', 'Dry Run'], ['synced', 'Synced'], ['failed', 'Failed'], ['log', 'Sync Log'], ['import', 'Import from Wave'], ['settings', 'Settings']].filter(function (t) {
    if (t[0] === 'log') { return canViewLog; }
    if (t[0] === 'settings') { return canManageSettings; }
    if (t[0] === 'import') { return canManageSettings && !isPlaceholderWaveBusiness(active); }
    return true;
  });

  return (
    <div className="p-4 text-slate-100">
      <div className="text-lg font-extrabold mb-3">🔄 Wave Sync Center</div>
      <SiloBanner registered={!!reg} isTest={!!(reg && reg.is_production === false)} canWrite={!!(reg && reg.writes_enabled === true)} notConnected={isPlaceholderWaveBusiness(active)} label={reg ? (reg.label || active) : (active || 'No business selected')} />

      {/* v55.83-KT — when the silo is on a placeholder id this is the ONLY thing that matters: it's not
          connected to Wave, so every toggle/readiness below is moot. Show ONE clear call-to-action and
          SUPPRESS the contradictory "production push ENABLED / LOCKED" banners (they imply it's working). */}
      {isPlaceholderWaveBusiness(active) ? (
        <div className="mb-3 rounded-lg px-4 py-3" style={{ background: '#7f1d1d', color: '#fff' }}>
          <div className="font-extrabold mb-1 text-base">⚠ This silo is NOT connected to a real Wave business yet</div>
          <div className="text-xs font-medium mb-2">Its Wave ID is a placeholder (<code>{active}</code>), not a real Wave business — so the toggles and setup below do nothing yet, and categories/products/pushes are all blocked. Click below and I&apos;ll connect it:</div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={connectToWave} disabled={connecting} className="px-4 py-2 bg-white text-rose-800 rounded-lg text-sm font-extrabold hover:bg-rose-50 disabled:opacity-60">{connecting ? 'Connecting…' : '🔗 Connect this silo to Wave now'}</button>
            {props.onGoToWaveConnection && <button onClick={function () { props.onGoToWaveConnection(); }} className="px-3 py-1.5 bg-rose-950/40 text-white rounded-lg text-xs font-bold hover:bg-rose-950/60">or open Wave Connection</button>}
          </div>
          {connectMsg && <div className="text-xs mt-2 bg-rose-950/50 rounded px-2 py-1 whitespace-pre-wrap">{connectMsg}</div>}
          {connectChoices && connectChoices.length > 0 && (
            <div className="mt-2 flex flex-col gap-1">
              {connectChoices.map(function (b, i) {
                return <button key={i} onClick={function () { setConnecting(true); doBind(b.id, b.name); }} disabled={connecting} className="text-left px-2 py-1 bg-white text-rose-900 rounded text-xs font-bold hover:bg-rose-50 disabled:opacity-60">Connect to: {b.name}{b.isClassicInvoicing ? ' (⚠ classic invoicing)' : ''}</button>;
              })}
            </div>
          )}
        </div>
      ) : (
        <div>
          {isProd && !productionUnlocked && (
            <div className="mb-3 rounded-lg px-3 py-2 text-sm font-bold" style={{ background: '#7f1d1d', color: '#fff' }}>
              🔒 Production Wave pushes are LOCKED for this business. A super admin can enable them in Settings after testing on the test silo.
            </div>
          )}
          {isProd && productionUnlocked && (
            <div className="mb-3 rounded-lg px-3 py-2 text-sm font-bold" style={{ background: '#b45309', color: '#fff' }}>
              ⚠ REAL PRODUCTION Wave push is ENABLED for this business — pushes will write to your real Wave books. Disable in Settings when not actively syncing.
            </div>
          )}
        </div>
      )}

      <div className="flex gap-1 mb-3 flex-wrap">
        {tabs.map(function (t) {
          return <button key={t[0]} onClick={function () { setTab(t[0]); }} className={'px-3 py-1.5 rounded text-xs font-bold ' + (tab === t[0] ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700')}>{t[1]}</button>;
        })}
      </div>

      {tab === 'pending' && (
        <div className="border border-slate-700 rounded overflow-hidden">
          {queue.some(function (q) { return q.hubOnly; }) && (
            <div className="bg-slate-800/40 border-b border-slate-700 px-3 py-2 text-[11px] text-slate-300">
              ℹ <span className="font-bold">What\'s "Hub-only" below:</span> a bank transaction can post to Wave once it has a Wave Category — those now appear as pushable above. The ones listed as Hub-only are either <span className="font-semibold">not categorized yet</span> (pick a category in Bank Review) or <span className="font-semibold">split lines</span> (split-line push is the next step). Customer-invoice payments still reach Wave by matching the deposit to its invoice in Bank Review.
            </div>
          )}
          <div className="bg-slate-800/70 px-3 py-2 flex items-center justify-between">
            <div className="text-xs font-bold">Pending in this silo: {actionableQueue.length}<span className="ml-2 font-normal text-slate-400">({actionableQueue.filter(function (q) { return q.action === 'customer'; }).length} customers · {actionableQueue.filter(function (q) { return q.action === 'invoice'; }).length} invoices · {actionableQueue.filter(function (q) { return q.action === 'payment'; }).length} payments · {actionableQueue.filter(function (q) { return q.action === 'transaction'; }).length} transactions)</span></div>
            <div className="flex gap-2">
              <button onClick={runDryRun} disabled={(isProd && !productionUnlocked) || selectedRows.length === 0 || !canDryRun} title={!canDryRun ? 'Requires the Wave: Dry Run permission' : ''} className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-bold rounded">Dry Run Selected ({selectedRows.length})</button>
              <button onClick={pushSelected} disabled={(isProd && !productionUnlocked) || busy || selectedRows.length === 0 || !canPushAny} title={!canPushAny ? 'Requires a Wave push permission (customers / invoices / payments)' : ''} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded">{busy ? 'Pushing…' : 'Push Selected'}</button>
            </div>
          </div>
          {actionableQueue.length === 0 ? <div className="p-4 text-slate-400 italic text-sm">Nothing pending — no Hub customers, invoices, or payments in this silo are waiting to go to Wave.</div> : (
            <div>
              {actionableQueue.map(function (q) {
                return (
                  <div key={q.key} className="flex items-center gap-2 px-3 py-2 border-t border-slate-800 text-sm">
                    <input type="checkbox" checked={!!sel[q.key]} disabled={!!q.blocked} onChange={function () { toggle(q.key); }} className="w-4 h-4" />
                    <span className={'px-1.5 py-0.5 rounded text-[10px] font-bold ' + (q.action === 'payment' ? 'bg-emerald-700 text-white' : (q.action === 'invoice' ? 'bg-sky-700 text-white' : 'bg-slate-700 text-white'))}>{q.action}</span>
                    <span className="flex-1">{q.label}{q.sub ? <span className="block text-[10px] text-slate-400">{q.sub}</span> : null}</span>
                    {q.amount != null && <span className="font-mono text-slate-300">{Number(q.amount).toLocaleString()}</span>}
                    {q.action === 'payment' && (isSuperAdmin || canMarkManualDone) && <button onClick={function () { markManualDone(q.id); }} className="text-[10px] bg-slate-600 hover:bg-slate-500 text-white rounded px-1.5 py-0.5 font-bold" title="I entered this payment in Wave by hand">Mark manual done</button>}
                    {String(q.key).indexOf('invrepair:') === 0 && canPushInvoice && <button onClick={function () { approveInWave(q.id); }} disabled={busy} className="text-[10px] bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded px-1.5 py-0.5 font-bold" title="Approve this invoice in Wave (DRAFT → SAVED) so it accepts payments — no need to open Wave">{busy ? '…' : '✅ Approve in Wave'}</button>}
                    {q.action === 'payment' && q.draftBlockedInvoiceId && canPushInvoice && <button onClick={function () { approveInWave(q.draftBlockedInvoiceId); }} disabled={busy} className="text-[10px] bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded px-1.5 py-0.5 font-bold" title="This payment's invoice is DRAFT in Wave. Approve it (DRAFT → SAVED) so the payment can post — then push the payment.">{busy ? '…' : '✅ Approve invoice in Wave'}</button>}
                    <span className={'text-[10px] ' + (q.hubOnly ? 'text-slate-400 font-semibold' : (q.blocked ? 'text-amber-400 font-bold' : (q.retryable ? 'text-rose-400 font-bold' : 'text-slate-500')))} title={q.hubOnly ? 'Wave\'s API does not accept raw bank-transaction/category pushes — this stays in the Hub' : ''}>{q.hubOnly ? 'ℹ Hub-only' : (q.blocked ? 'blocked' : (q.retryable ? 'failed · retry' : 'not synced'))}</span>
                  </div>
                );
              })}
            </div>
          )}
          {hubOnlyQueue.length > 0 && (
            <div className="border-t border-slate-700">
              <div className="bg-slate-900/60 px-3 py-2 text-[11px] font-bold text-slate-300">
                Hub-only — not pushed to Wave ({hubOnlyQueue.length}) <span className="font-normal text-slate-500">· Wave's API can't accept these; customer payments reach Wave via invoice matching in Bank Review.</span>
              </div>
              {hubOnlyQueue.map(function (q) {
                return (
                  <div key={q.key} className="flex items-center gap-2 px-3 py-2 border-t border-slate-800/60 text-sm opacity-80">
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-700 text-slate-200">{q.action === 'bank_transaction_split' ? 'split' : 'bank txn'}</span>
                    <span className="flex-1">{q.label}{q.sub ? <span className="block text-[10px] text-slate-400">{q.sub}</span> : null}</span>
                    {q.amount != null && <span className="font-mono text-slate-400">{Number(q.amount).toLocaleString()}</span>}
                    <span className="text-[10px] text-slate-400 font-semibold" title="Wave's API does not accept raw bank-transaction/category pushes — this stays in the Hub">ℹ Hub-only</span>
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

      {tab === 'import' && canManageSettings && !isPlaceholderWaveBusiness(active) && (
        <div className="bg-white rounded-lg p-4 text-slate-900 space-y-3">
          <div>
            <div className="text-sm font-bold text-slate-900">Import existing categorizations from Wave (CSV)</div>
            <div className="text-xs text-slate-600 mt-1">Wave's API can't read transactions back, so to reflect categories you set <b>directly in Wave</b>, export them: in Wave go to <b>Accounting → Transactions → Export</b>, then paste the CSV here. The Hub matches each row to a bank transaction by date + amount + description and marks it as already-in-Wave (so it won't be pushed again). Nothing is written to Wave.</div>
          </div>
          {/* v55.83-LG — invoice PAYMENTS are API-readable (unlike money transactions). This probe shows
              what Wave reports so payments recorded directly in Wave can be mirrored + linked to deposits. */}
          <div className="border border-emerald-200 bg-emerald-50 rounded p-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-[11px] text-slate-700"><b>Invoice payments mirror (read-only):</b> check what Wave already has — payments recorded in Wave, and the bank account each hit, are readable and can be linked to your deposits.</div>
              <button onClick={runPaymentReadback} disabled={probeBusy} className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white rounded px-3 py-1.5 text-xs font-bold whitespace-nowrap">{probeBusy ? 'Checking…' : 'Check Wave payments'}</button>
            </div>
            {probeResult && (
              <div className="mt-2 text-[11px] text-slate-800">
                {probeResult.error && !probeResult.payments_found ? <div className="text-rose-700">Could not read: {probeResult.error}</div> : (
                  <div className="space-y-1">
                    <div className="font-bold">{probeResult.payments_found} payment(s) across {probeResult.invoices_scanned} invoice(s) · {probeResult.payments_with_bank_account} carry a bank account{probeResult.error ? ' (partial: ' + probeResult.error + ')' : ''}.</div>
                    {/* v55.83-LH — the exact linkage answer that gates LH auto-linking. */}
                    <div className="text-slate-600">Link key: <b>{probeResult.recommended_link_key || 'account+amount+date'}</b>{probeResult.link_fields_supported ? (' · Wave txn-id fields present on ' + (probeResult.payments_with_transaction_id || 0) + '/' + (probeResult.payments_with_accounting_transaction_id || 0) + ' payments') : ' · Wave does not expose payment txn-ids (will match on account+amount+date)'}</div>
                    {probeResult.distinct_bank_accounts && probeResult.distinct_bank_accounts.length > 0 && <div className="text-slate-600">Wave bank/cash accounts seen: {probeResult.distinct_bank_accounts.map(function (a) { return a.name; }).join(', ')}</div>}
                    {probeResult.samples && probeResult.samples.length > 0 && (
                      <details><summary className="cursor-pointer text-slate-700">Sample payments</summary>
                        <div className="mt-1 max-h-48 overflow-auto">{probeResult.samples.map(function (s, i) { return <div key={i} className="border-t border-emerald-100 py-0.5">{s.date} · {s.amount} · INV {s.invoice} · {s.account_name || 'no bank account'}{s.method ? (' · ' + s.method) : ''}</div>; })}</div>
                      </details>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          <textarea value={csvText} onChange={function (e) { setCsvText(e.target.value); }} placeholder="Paste the exported CSV here (including the header row)…" rows={6} className="w-full border border-slate-300 rounded p-2 text-xs font-mono text-slate-900" />
          <div className="flex gap-2">
            <button onClick={function () { runCsvImport(false); }} disabled={csvBusy} className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white rounded px-3 py-1.5 text-xs font-bold">{csvBusy ? 'Working…' : 'Preview match (dry run)'}</button>
            <button onClick={function () { runCsvImport(true); }} disabled={csvBusy || !csvResult || !csvResult.dry_run || !csvResult.matched_count} className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded px-3 py-1.5 text-xs font-bold">Apply {csvResult && csvResult.dry_run ? '(' + csvResult.matched_count + ')' : ''}</button>
          </div>
          {csvResult && csvResult.ok && (
            <div className="border border-slate-200 rounded p-3 text-xs text-slate-800 space-y-2">
              {csvResult.detected_columns && <div className="text-[11px] text-slate-600">Detected columns — date: <b>{String(csvResult.detected_columns.date)}</b>, amount: <b>{String(csvResult.detected_columns.amount)}</b>, category: <b>{String(csvResult.detected_columns.category)}</b>, description: <b>{String(csvResult.detected_columns.description)}</b></div>}
              <div className="flex gap-4 flex-wrap font-bold">
                <span className="text-emerald-700">{csvResult.dry_run ? csvResult.matched_count + ' would match' : csvResult.applied + ' applied'}</span>
                <span className="text-amber-700">{csvResult.unmatched_count} unmatched</span>
                {csvResult.category_unresolved_count ? <span className="text-rose-700">{csvResult.category_unresolved_count} category name not found in this silo's Wave chart</span> : null}
                {csvResult.hub_candidate_count != null ? <span className="text-slate-500">{csvResult.hub_candidate_count} Hub candidates</span> : null}
              </div>
              {csvResult.matched && csvResult.matched.length > 0 && (
                <details><summary className="cursor-pointer text-slate-700">Matched rows</summary>
                  <div className="mt-1 max-h-48 overflow-auto">{csvResult.matched.map(function (m) { return <div key={m.row} className="border-t border-slate-100 py-0.5">{m.hub_date} · {m.amount} · {m.hub_name} → <b>{m.csv_category}</b>{m.category_resolved ? '' : ' (name not in Wave chart — saved as label only)'}</div>; })}</div>
                </details>
              )}
              {csvResult.unmatched && csvResult.unmatched.length > 0 && (
                <details><summary className="cursor-pointer text-amber-700">Unmatched CSV rows</summary>
                  <div className="mt-1 max-h-48 overflow-auto">{csvResult.unmatched.map(function (u, i) { return <div key={i} className="border-t border-slate-100 py-0.5">{u.date} · {u.amount} · {u.category || ''} — {u.reason}</div>; })}</div>
                </details>
              )}
              {csvResult.apply_errors && csvResult.apply_errors.length > 0 && <div className="text-rose-700">Apply errors: {csvResult.apply_errors.length}</div>}
            </div>
          )}
        </div>
      )}

      {tab === 'settings' && canManageSettings && isPlaceholderWaveBusiness(active) && (
        <div className="bg-white rounded-lg p-4 text-slate-900">
          <div className="text-sm font-bold text-slate-900 mb-1">Connect this silo to Wave first</div>
          <div className="text-xs text-slate-600 mb-3">All the setup (deposit account, invoice product, categories, push toggles) only works once this silo is bound to a real Wave business — Wave rejects every call for a placeholder id. Click below to connect it (same one-click action as the red banner above):</div>
          {/* v55.83-KV — put the actual Connect button HERE too, so it's wherever the user is looking. */}
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={connectToWave} disabled={connecting} className="px-4 py-2 bg-rose-700 hover:bg-rose-600 text-white rounded-lg text-sm font-extrabold disabled:opacity-60">{connecting ? 'Connecting…' : '🔗 Connect this silo to Wave now'}</button>
            {props.onGoToWaveConnection && <button onClick={function () { props.onGoToWaveConnection(); }} className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-lg text-xs font-bold">or open Wave Connection</button>}
          </div>
          {connectMsg && <div className="text-xs mt-2 bg-slate-900 text-slate-100 rounded px-2 py-1 whitespace-pre-wrap">{connectMsg}</div>}
          {connectChoices && connectChoices.length > 0 && (
            <div className="mt-2 flex flex-col gap-1">
              {connectChoices.map(function (b, i) {
                return <button key={i} onClick={function () { setConnecting(true); doBind(b.id, b.name); }} disabled={connecting} className="text-left px-2 py-1 bg-rose-100 text-rose-900 rounded text-xs font-bold hover:bg-rose-200 disabled:opacity-60">Connect to: {b.name}{b.isClassicInvoicing ? ' (⚠ classic invoicing)' : ''}</button>;
              })}
            </div>
          )}
        </div>
      )}
      {tab === 'settings' && canManageSettings && !isPlaceholderWaveBusiness(active) && (
        <div className="bg-white rounded-lg p-4 text-slate-900">
          {/* v55.83-KP (Codex) — ONE-GLANCE status summary so the user never has to infer readiness from
              five scattered checkboxes/red lines. Each red item names the exact next action. */}
          {(function () {
            var ph = isPlaceholderWaveBusiness(active);
            var canOperate = !isProd || productionUnlocked;
            var canWrite = !!(reg && (reg.is_production === false || reg.writes_enabled === true));
            var hasPayAcct = !!(prodSetup && prodSetup.default_payment_account_id);
            var hasInvProd = !!(prodSetup && prodSetup.default_invoice_product_id);
            var payReady = !ph && canOperate && canWrite && !!(reg && reg.allow_payment_push === true) && hasPayAcct;
            var invReady = !ph && canOperate && canWrite && !!(reg && reg.allow_invoice_push === true) && hasInvProd;
            var catReady = !ph && catCount > 0;
            function payNext() { if (ph) return 'Bind this silo (Wave Connection)'; if (!canOperate) return 'Unlock production push (below)'; if (!canWrite) return 'Enable writes (below)'; if (!(reg && reg.allow_payment_push === true)) return 'Enable payment push (below)'; if (!hasPayAcct) return 'Set the payment deposit account (below)'; return ''; }
            function invNext() { if (ph) return 'Bind this silo (Wave Connection)'; if (!canOperate) return 'Unlock production push (below)'; if (!canWrite) return 'Enable writes (below)'; if (!(reg && reg.allow_invoice_push === true)) return 'Enable invoice push (below)'; if (!hasInvProd) return 'Set the Default Invoice Product (below)'; return ''; }
            function catNext() { if (ph) return 'Bind this silo (Wave Connection)'; return 'Pull Wave categories (below) / check token access'; }
            function Row(label, ready, nextAction, okText) {
              return <div className="flex items-center justify-between gap-2 py-1 border-b border-slate-100 last:border-0">
                <span className="text-xs font-semibold text-slate-700">{label}</span>
                <span className="flex items-center gap-2">
                  <span className={'text-[10px] font-bold px-1.5 py-0.5 rounded ' + (ready ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white')}>{ready ? (okText || 'READY') : 'BLOCKED'}</span>
                  {!ready && nextAction ? <span className="text-[10px] text-rose-700 font-semibold">→ {nextAction}</span> : null}
                </span>
              </div>;
            }
            return <div className="mb-4 border-2 border-slate-300 rounded-lg p-3 bg-white">
              <div className="font-extrabold text-slate-900 mb-1 text-sm">Wave setup status — {reg ? (reg.label || active) : 'no silo selected'}</div>
              {ph && <div className="text-[11px] text-rose-700 font-bold mb-1">⚠ This silo is not connected to a real Wave business (placeholder id) — bind it in Accounting → Wave Connection. Everything below stays BLOCKED until then.</div>}
              {Row(isProd ? 'Production writes' : 'Test silo writes', isProd ? (reg && reg.writes_enabled === true) : true, isProd ? 'Enable writes (below)' : '', isProd ? 'ON' : 'ON (test)')}
              {Row('Payment push', payReady, payNext())}
              {Row('Invoice push', invReady, invNext())}
              {Row('Category dropdown', catReady, catNext(), catCount + ' loaded')}
            </div>;
          })()}
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
          <div className="mb-4 border border-sky-200 bg-sky-50 rounded-lg p-3">
            <div className="font-bold text-slate-900 mb-1">Default Bank Account for This Silo</div>
            <div className="text-xs text-slate-700 mb-2">Bank Review auto-loads this account when this Wave business is selected (you can still switch accounts manually). This is the local Plaid/bank account whose transactions you review — separate from the Wave payment deposit account above.</div>
            {prodSetup && prodSetup.default_plaid_account_id
              ? <div className="text-xs bg-emerald-100 text-emerald-950 rounded px-2 py-1 mb-2 font-medium">Default bank account: {prodSetup.default_plaid_account_name || prodSetup.default_plaid_account_id}</div>
              : <div className="text-xs bg-amber-100 text-amber-950 rounded px-2 py-1 mb-2 font-medium">No default bank account set for this silo — Bank Review shows all of this silo&#39;s accounts.</div>}
            <div className="flex gap-2 flex-wrap items-center">
              <select value={bankSel} onChange={function (e) { setBankSel(e.target.value); }} className="text-xs bg-white border border-slate-300 text-slate-900 rounded px-2 py-1 min-w-[220px]">
                <option value="">{bankAccts.length ? '— choose an account —' : 'No bank accounts found for this silo'}</option>
                {bankAccts.map(function (a) { return <option key={a.account_id} value={a.account_id}>{a.label}</option>; })}
              </select>
              <button onClick={function () { saveDefaultBank(bankSel); }} disabled={bankBusy || !bankSel} className="text-xs bg-sky-600 hover:bg-sky-700 text-white rounded px-2 py-1 font-bold disabled:opacity-50">{bankBusy ? 'Saving…' : 'Set default'}</button>
              {prodSetup && prodSetup.default_plaid_account_id && <button onClick={function () { saveDefaultBank(''); }} disabled={bankBusy} className="text-xs bg-slate-500 hover:bg-slate-600 text-white rounded px-2 py-1 font-bold disabled:opacity-50">Clear</button>}
            </div>
            {bankMsg && <div className="text-xs mt-2 whitespace-pre-wrap text-slate-800 bg-white border border-slate-200 rounded p-2 font-mono">{bankMsg}</div>}
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
          {reg && (!isProd || productionUnlocked) && (function () {
            // v55.83-KO (audit) — PAYMENT push and INVOICE push have DIFFERENT requirements; conflating
            // them made the checklist lie. Verified against the routes:
            //   • push-payment needs: writes_enabled + allow_payment_push + a deposit account, AND the
            //     invoice must ALREADY be in Wave (it does NOT read any product or category).
            //   • push-invoice needs: writes_enabled + allow_invoice_push + a default invoice product,
            //     AND the customer pushed to Wave first.
            // So we show TWO panels; neither lists categories (those only label expenses).
            function Panel(title, checks, doneMsg, blockedMsg, note) {
              return <div className="mb-3 border border-slate-300 rounded-lg p-3 bg-white">
                <div className="font-bold text-slate-900 mb-2 text-sm">{title}</div>
                <div className="space-y-1">
                  {checks.map(function (c) {
                    return <div key={c[0]} className="flex items-center gap-2 text-xs text-slate-900">
                      <span className={c[1] ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>{c[1] ? '✓' : '✗'}</span>
                      <span className={c[1] ? 'text-slate-700' : 'text-rose-700 font-semibold'}>{c[0]}</span>
                    </div>;
                  })}
                </div>
                {checks.every(function (c) { return c[1]; })
                  ? <div className="mt-2 text-xs bg-emerald-100 text-emerald-950 rounded px-2 py-1 font-medium">{doneMsg}</div>
                  : <div className="mt-2 text-xs bg-amber-100 text-amber-950 rounded px-2 py-1 font-medium">{blockedMsg}</div>}
                {note ? <div className="mt-2 text-[11px] text-slate-500 border-t border-slate-200 pt-1">{note}</div> : null}
              </div>;
            }
            var payChecks = [
              ['Writes enabled (super-admin toggle)', reg.writes_enabled === true],
              ['Payment push enabled (super-admin toggle)', reg.allow_payment_push === true],
              ['Payment deposit account set (one-time setup below)', !!(prodSetup && prodSetup.default_payment_account_id)]
            ];
            var invChecks = [
              ['Writes enabled (super-admin toggle)', reg.writes_enabled === true],
              ['Invoice push enabled (super-admin toggle)', reg.allow_invoice_push === true],
              ['Default Invoice Product set (one-time setup below)', !!(prodSetup && prodSetup.default_invoice_product_id)]
            ];
            return <div>
              {Panel('Payment push readiness',
                payChecks,
                'Setup complete — you can push payments for invoices that are already in Wave.',
                'Finish the red items before pushing payments. (The toggles are super-admin switches; the deposit account is set in the box above.)',
                <span>Each payment also requires its <b>invoice to already be in Wave</b> — match the deposit in Bank Review; if the invoice isn’t in Wave yet, push it first. Wave categories are <b>not</b> needed for payments ({catCount > 0 ? (catCount + ' loaded') : 'none loaded'} — categories only label expenses/transfers).</span>)}
              {Panel('Invoice push readiness',
                invChecks,
                'Setup complete — you can push Hub invoices to Wave.',
                'Finish the red items before pushing invoices. (Set the Default Invoice Product in the box above.)',
                <span>Each invoice’s <b>customer must be in Wave first</b> (push the customer). Invoice-imported-from-Wave records don’t need this — they’re already there.</span>)}
            </div>;
          })()}
          {!reg ? <div className="text-sm text-slate-500">Select a registered Wave business first.</div> : (
            <div className="space-y-2 text-sm">
              {/* v55.83-HI — super-admin master switch: enable REAL production Wave pushes for this
                  business. Default OFF. Other push flags only become editable once this is ON. */}
              {isProd && (
                <div className="border border-rose-400 bg-rose-50 rounded p-2 mb-1">
                  <label className="flex items-center gap-2 text-rose-900 font-bold">
                    <input type="checkbox" checked={productionUnlocked} disabled={savingFlags || !isSuperAdmin} onChange={function (e) { if (e.target.checked && !window.confirm('Enable REAL production Wave pushes for ' + (reg.label || active) + '?\n\nThis lets the Hub WRITE to your real Wave books. Only do this after fully testing on the test silo. You can turn it off again here.')) { return; } setFlag('production_push_unlocked', e.target.checked); }} />
                    ⚠ Enable REAL production Wave push (super-admin only)
                  </label>
                  <div className="text-[11px] text-rose-700 mt-1">Default OFF. When ON, this business can write to real Wave — test on the test silo first, and turn OFF when not actively syncing.{!isSuperAdmin ? ' (Super admin required.)' : ''}</div>
                  {/* v55.83-JN — persistent inline save status so a failed unlock no longer silently snaps back OFF. */}
                  {flagStatus && flagStatus.field === 'production_push_unlocked' && (
                    <div className={'text-[11px] mt-1 rounded px-2 py-1 font-semibold ' + (flagStatus.pending ? 'bg-slate-100 text-slate-700' : (flagStatus.ok ? 'bg-emerald-100 text-emerald-900' : 'bg-rose-200 text-rose-900'))}>
                      {flagStatus.pending ? '⏳ ' : (flagStatus.ok ? '✅ ' : '⛔ ')}{flagStatus.msg}
                      {!flagStatus.ok && !flagStatus.pending && flagStatus.rowId ? <span className="block text-[10px] font-normal">row {String(flagStatus.rowId).substring(0, 8)}{flagStatus.label ? ' · ' + flagStatus.label : ''}</span> : null}
                      {!flagStatus.ok && !flagStatus.pending ? <span className="block text-[10px] font-normal">If this keeps failing: the DB likely has a trigger/RLS on wave_business_registry blocking the write — screenshot this for Claude.</span> : null}
                    </div>
                  )}
                </div>
              )}
              {(!isProd || productionUnlocked) ? [['writes_enabled', 'Writes enabled (master switch)'], ['allow_customer_push', 'Allow customer push'], ['allow_invoice_push', 'Allow invoice push'], ['allow_payment_push', 'Allow payment push (records payments in Wave)'], ['allow_auto_push', 'Allow auto-push (keep OFF)']].map(function (f) {
                var disabled = savingFlags || f[0] === 'allow_auto_push';
                return (
                  <label key={f[0]} className="flex items-center gap-2">
                    <input type="checkbox" checked={reg[f[0]] === true} disabled={disabled} onChange={function (e) { setFlag(f[0], e.target.checked); }} />
                    <span className={disabled && f[0] === 'allow_auto_push' ? 'text-slate-400' : ''}>{f[1]}</span>
                  </label>
                );
              }) : <div className="text-xs text-rose-700 font-semibold">Other push flags unlock once you enable real production push above.</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
