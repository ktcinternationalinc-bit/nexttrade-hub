'use client';
// v55.83-A.6.27.52 — Open Accounts ledger tab.
//
// Customer-by-customer running ledger for accounts where the operator keeps
// ongoing balances. Independent of invoices/treasury — a parallel record.
//
// Layout:
//   - Top: list of accounts as collapsible cards (open by default)
//   - Each card collapsed: summary numbers (credits, debits, balance)
//   - Each card expanded: full ledger table with running balance column
//   - "+ New Account" and "+ New Entry" buttons
//
// Convention (locked):
//   CREDIT = money IN to us (paid to us, owed to us cleared)
//   DEBIT  = money OUT from us (we paid them)
//
// Permission: super_admin OR users with the "Open Accounts" module permission.

import { useState, useEffect, useMemo } from 'react';
import { supabase, dbInsert, dbUpdate } from '../lib/supabase';
import { printAccountLedger, exportAccountLedgerToExcel } from '../lib/open-account-export';
import { printOpenAccountInvoice } from '../lib/open-account-invoice-print';
// v55.83-A.6.27.72 — Unified Counterparty Ledger model (FIFO auto-apply + 4 pots per currency).
import { TRANSACTION_TYPES, simulate, computePaidRemaining, findOffsetCandidate, validateOffsetable, buildOffsetEntries } from '../lib/open-account-ledger';
// v55.83-A.6.27.61 — Attachments wire-up
import AttachmentManager from './AttachmentManager';

function fmtNum(n) {
  if (n == null || isNaN(Number(n))) return '—';
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(s) {
  if (!s) return '—';
  try { return new Date(s).toISOString().substring(0, 10); } catch (e) { return s; }
}

// v55.83-A.6.27.72 HOTFIX 11 — Standard accounting two-column layout.
// Groups each transaction by WHICH ACCOUNT is affected (AR or AP), not by cash-flow direction.
// All values are positive magnitudes; the Type column tells you whether the row INCREASES
// the AR/AP side (Sales Invoice / Vendor Bill) or REDUCES it (Payment Received / Payment Sent).
//
// Routing rules per the spec:
//   sales_invoice    → AR Side  (creates AR — they will owe us)
//   payment_received → AR Side  (reduces AR — they paid down what they owed)
//   vendor_bill      → AP Side  (creates AP — we will owe them)
//   payment_sent     → AP Side  (reduces AP — we paid down what we owed)
//   credit_adjustment / offset → routed by which side has the value
function arApSide(entry) {
  if (!entry) return { ar: 0, ap: 0 };
  var credit = Number(entry.credit_amount || 0);
  var debit = Number(entry.debit_amount || 0);
  switch (entry.transaction_type) {
    case 'sales_invoice':    return { ar: credit, ap: 0 };
    case 'payment_received': return { ar: credit, ap: 0 };
    case 'vendor_bill':      return { ar: 0, ap: debit };
    case 'payment_sent':     return { ar: 0, ap: debit };
    case 'credit_adjustment': return { ar: credit, ap: debit };
    case 'offset':           return { ar: credit, ap: debit };
    default: return { ar: credit, ap: debit };
  }
}
// Back-compat alias (some older code paths reference inOutAmount).
function inOutAmount(entry) {
  var s = arApSide(entry);
  return { in: s.ar, out: s.ap };
}

// True if the entry contributes to Accounts Receivable (sales invoice → they owe us).
function isAR(entry) { return entry && entry.transaction_type === 'sales_invoice'; }
// True if the entry contributes to Accounts Payable (vendor bill → we owe them).
function isAP(entry) { return entry && entry.transaction_type === 'vendor_bill'; }

// v55.83-A.6.27.72 HOTFIX 11 — FX rate lookup for the Global Net Position card.
// Given a list of fx_rates rows ({ from_currency, to_currency, rate, rate_date }),
// finds the most recent rate to convert FROM `from` INTO `to`. If the direct pair
// isn't present but the inverse is, returns 1 / inverse rate. Returns null when
// neither direction is available.
function lookupFxRate(fxRates, from, to) {
  if (from === to) return 1;
  if (!Array.isArray(fxRates) || fxRates.length === 0) return null;
  // Most-recent direct rate
  var direct = null;
  var inverse = null;
  fxRates.forEach(function (r) {
    if (r.from_currency === from && r.to_currency === to) {
      if (!direct || (r.rate_date > direct.rate_date)) direct = r;
    } else if (r.from_currency === to && r.to_currency === from) {
      if (!inverse || (r.rate_date > inverse.rate_date)) inverse = r;
    }
  });
  if (direct && Number(direct.rate) > 0) return Number(direct.rate);
  if (inverse && Number(inverse.rate) > 0) return 1 / Number(inverse.rate);
  return null;
}

// Convert a list of per-currency balances into a single base-currency total.
// Returns { total, base, breakdown: [{ cur, amount, rate, baseEquiv, hasRate }], missingRates: [cur,...] }.
function convertToBaseCurrency(byCurrency, baseCur, fxRates) {
  baseCur = baseCur || 'USD';
  var breakdown = [];
  var total = 0;
  var missingRates = [];
  Object.keys(byCurrency).forEach(function (cur) {
    var amount = Number((byCurrency[cur] && byCurrency[cur].balance) || 0);
    if (cur === baseCur) {
      breakdown.push({ cur: cur, amount: amount, rate: 1, baseEquiv: amount, hasRate: true });
      total += amount;
    } else {
      var rate = lookupFxRate(fxRates, cur, baseCur);
      if (rate != null) {
        var baseEquiv = amount * rate;
        breakdown.push({ cur: cur, amount: amount, rate: rate, baseEquiv: baseEquiv, hasRate: true });
        total += baseEquiv;
      } else {
        breakdown.push({ cur: cur, amount: amount, rate: null, baseEquiv: null, hasRate: false });
        missingRates.push(cur);
      }
    }
  });
  return { total: total, base: baseCur, breakdown: breakdown, missingRates: missingRates };
}

// v55.83-A.6.27.72 HOTFIX 6 — signed amount per transaction type.
// Returns the entry's net-effect contribution (positive = improves our position,
// negative = worsens). Makes the Amount column algebraically sum to the Net.
//
// Sign rules (matching how simulate() routes each type through the 4 pots):
//   payment_sent       → +amount  (becomes ourPrepaid or settles ourOpenBills → in our favor)
//   sales_invoice      → +amount  (becomes theirOpenInvoices → in our favor)
//   payment_received   → −amount  (becomes theirPrepaid or settles theirOpenInvoices → against us)
//   vendor_bill        → −amount  (becomes ourOpenBills → against us)
//   credit_adjustment  → +debit − credit  (debit goes to ourPrepaid, credit goes to theirPrepaid)
//   offset             → ±side  (internal — the two halves cancel out)
function signedAmount(entry) {
  if (!entry) return 0;
  var credit = Number(entry.credit_amount || 0);
  var debit = Number(entry.debit_amount || 0);
  switch (entry.transaction_type) {
    case 'payment_sent':     return +debit;
    case 'sales_invoice':    return +credit;
    case 'payment_received': return -credit;
    case 'vendor_bill':      return -debit;
    case 'credit_adjustment': return debit - credit;
    case 'offset':
      // Offset has two halves stamped with offset_invoice_id or offset_bill_id.
      // credit + offset_bill_id → reduces ourOpenBills (in our favor) → +
      // debit + offset_invoice_id → reduces theirOpenInvoices (against us) → −
      if (credit > 0 && entry.offset_bill_id) return +credit;
      if (debit > 0 && entry.offset_invoice_id) return -debit;
      return 0;
    default:
      // Unknown type: fall back to credit − debit (sensible default)
      return credit - debit;
  }
}

// v55.83-A.6.27.72 HOTFIX 10 — signed Paid/Remaining for invoices/bills.
// Sign follows the parent Amount direction so per-row math works:
//   Amount = Paid + Remaining (all signed)
// And totals reconcile:
//   Sum(VB+SI Amount) = Sum(Paid) + Sum(Remaining)  (signed)
//   Sum(Remaining, signed) = Net  (when no prepaid pots — the most common case)
//
// Sales Invoice (Amount +): Paid +, Remaining +
// Vendor Bill (Amount −):  Paid −, Remaining −
// Payment rows have no Paid/Remaining (returns 0/0).
function signedPaidRemaining(entry, simResult) {
  if (!entry) return { paid: 0, remaining: 0 };
  if (entry.transaction_type !== 'sales_invoice' && entry.transaction_type !== 'vendor_bill') {
    return { paid: 0, remaining: 0 };
  }
  var amount = entry.transaction_type === 'sales_invoice' ? Number(entry.credit_amount || 0) : Number(entry.debit_amount || 0);
  var paidMag = (simResult && simResult.applications && simResult.applications[entry.id]) || 0;
  var remainingMag = Math.max(0, amount - paidMag);
  var sign = entry.transaction_type === 'sales_invoice' ? 1 : -1;
  return { paid: sign * paidMag, remaining: sign * remainingMag };
}

// Format a signed amount for display: shows "−" prefix for negatives, no prefix for positives.
// Color callback handles emerald (positive) / red (negative) / slate (zero).
function fmtSigned(n) {
  if (n == null || isNaN(Number(n))) return '—';
  var v = Number(n);
  if (Math.abs(v) < 0.005) return '0.00';
  var abs = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? '−' + abs : abs;
}

export default function OpenAccountsTab(props) {
  var userProfile = props.userProfile;
  var modulePerms = props.modulePerms || {};
  var isSuperAdmin = props.isSuperAdmin === true;

  // v55.83-A.6.27.NEXT (Issue 4) — Permission split.
  //
  //   BEFORE: a single "Open Accounts" key controlled both view + edit.
  //   AFTER:
  //     - "Open Accounts"      → TAB-level (default ON)  → controls canView
  //     - "Edit Open Accounts" → ACTION-level (default OFF) → controls canEdit
  //
  // Back-compat: legacy users with only "Open Accounts: true" set keep BOTH
  // view + edit by falling back to the old key when the new ones aren't
  // defined. Super admins always have full access regardless.
  var legacyOpenAccts = modulePerms['Open Accounts'];
  var newTab = modulePerms['Open Accounts'];          // same key for tab view
  var newEdit = modulePerms['Edit Open Accounts'];    // new edit key

  // canView: new tab key (default ON), falling back to legacy (default true)
  var canView = isSuperAdmin
    || (newTab === undefined ? true : newTab === true);
  // canEdit: new edit key (default OFF), but if the new key is undefined AND
  // the legacy "Open Accounts" key is true, grant edit (back-compat).
  var canEdit = isSuperAdmin
    || newEdit === true
    || (newEdit === undefined && legacyOpenAccts === true);
  var toast = props.toast || { success: function(){}, error: function(){}, warning: function(){}, info: function(){} };

  // Data
  var [accounts, setAccounts] = useState([]);
  var [entries, setEntries] = useState([]);
  // v55.83-A.6.27.53 — entities for branding on prints + Excel exports
  var [entities, setEntities] = useState([]);
  // v55.83-A.6.27.59 — mini-invoices + line items
  var [invoices, setInvoices] = useState([]);
  var [invoiceItems, setInvoiceItems] = useState([]);
  var [loading, setLoading] = useState(true);
  var [error, setError] = useState(null);

  // UI state
  var [collapsedAccounts, setCollapsedAccounts] = useState({}); // { account_id: true } when collapsed
  var [accountModalOpen, setAccountModalOpen] = useState(false);
  var [accountDraft, setAccountDraft] = useState(null); // null | { id?, account_name, account_name_ar, notes }
  var [entryModalOpen, setEntryModalOpen] = useState(false);
  var [entryDraft, setEntryDraft] = useState(null); // null | { id?, account_id, entry_date, description, reference_number, credit_amount, debit_amount, notes }
  // v55.83-A.6.27.59 — invoice modal state
  var [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  var [invoiceDraft, setInvoiceDraft] = useState(null);
    // shape: { id?, account_id, invoice_number, direction, counterparty_name, counterparty_name_ar,
    //          counterparty_address, counterparty_email, counterparty_phone,
    //          invoice_date, due_date, currency, tax_enabled, tax_rate_pct,
    //          shipping_amount, notes, terms, items: [{id?, description, quantity, unit_price}] }
  var [busy, setBusy] = useState(false);
  var [search, setSearch] = useState('');
  // v55.83-A.6.27.66 (Issue 2) — account-level attachments modal: stores
  // v55.83-A.6.27.72 HOTFIX 11 — FX rates table loaded for the Global Net Position card.
  // Lets us collapse all non-base currencies into a single base-currency liquidity number.
  // Schema: { from_currency, to_currency, rate, rate_date }. Base currency = USD by convention.
  var [fxRates, setFxRates] = useState([]);
  // which account the 📎 Files button was clicked on; null when closed.
  var [attachAccountId, setAttachAccountId] = useState(null);

  useEffect(function () {
    if (!canView) { setLoading(false); return; }
    var cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        var [accRes, entRes, bizRes, invRes, itmRes, fxRes] = await Promise.all([
          supabase.from('open_accounts').select('*').order('account_name'),
          supabase.from('open_account_entries').select('*').order('entry_date', { ascending: true }).order('created_at', { ascending: true }),
          supabase.from('business_entities').select('*').eq('active', true).order('display_order'),
          supabase.from('open_account_invoices').select('*').order('invoice_date', { ascending: false }),
          supabase.from('open_account_invoice_items').select('*').order('sort_order', { ascending: true }),
          // v55.83-A.6.27.72 HOTFIX 11 — FX rates for the Global Net Position card.
          // Errors gracefully if fx_rates table isn't populated yet.
          supabase.from('fx_rates').select('*').order('rate_date', { ascending: false }).limit(500),
        ]);
        if (cancelled) return;
        if (accRes.error) throw accRes.error;
        if (entRes.error) throw entRes.error;
        if (bizRes && !bizRes.error) setEntities(bizRes.data || []);
        else if (bizRes && bizRes.error) console.warn('[open-accounts] business_entities not loaded:', bizRes.error.message);
        if (invRes && !invRes.error) setInvoices(invRes.data || []);
        else if (invRes && invRes.error) console.warn('[open-accounts] open_account_invoices not loaded — run sql/v55-83-a-6-27-59 in Supabase:', invRes.error.message);
        if (itmRes && !itmRes.error) setInvoiceItems(itmRes.data || []);
        else if (itmRes && itmRes.error) console.warn('[open-accounts] open_account_invoice_items not loaded:', itmRes.error.message);
        // FX rates load is best-effort — card falls back to "rate not available" if missing.
        if (fxRes && !fxRes.error) setFxRates(fxRes.data || []);
        else if (fxRes && fxRes.error) console.warn('[open-accounts] fx_rates not loaded (Global Net Position card will show fallback):', fxRes.error.message);
        setAccounts(accRes.data || []);
        setEntries(entRes.data || []);
      } catch (e) {
        if (!cancelled) {
          console.error('[open-accounts] load failed:', e);
          var msg = (e && e.message) || String(e);
          if (/relation.*open_accounts.*does not exist|relation.*open_account_entries.*does not exist/i.test(msg)) {
            setError('Database not yet set up. Run SQL migration v55.83-A.6.27.52 (sql/v55-83-a-6-27-52-open-accounts.sql) in Supabase.');
          } else {
            setError(msg);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return function () { cancelled = true; };
  }, [canView]);

  // Group entries by account_id, sorted by date asc + created_at asc.
  // Compute running balance per entry (credits add, debits subtract).
  var entriesByAccount = useMemo(function () {
    var byAcc = {};
    accounts.forEach(function (a) { byAcc[a.id] = []; });
    entries.forEach(function (e) {
      if (!byAcc[e.account_id]) byAcc[e.account_id] = [];
      byAcc[e.account_id].push(e);
    });
    // v55.83-A.6.27.72 HOTFIX 3 — Per-entry running balance now comes from the
    // FIFO simulation trail (not credit−debit running sum). The legacy
    // _running_balance / _running_by_currency fields previously showed
    // simple cumulative debit/credit, which CONTRADICTED the 4-pot strip.
    // Now both come from the same simulate() source → numbers always agree.
    Object.keys(byAcc).forEach(function (accId) {
      var arr = byAcc[accId];
      // Run the FIFO simulation once per account
      var sim = simulate(arr);
      // Build a quick lookup: entry id → snapshotAfter (from trail)
      var trailMap = {};
      sim.trail.forEach(function (t) {
        if (t.entry && t.entry.id) trailMap[t.entry.id] = t;
      });
      arr.forEach(function (entry) {
        var cur = String(entry.currency || 'USD').toUpperCase().trim() || 'USD';
        entry._currency = cur;
        var t = trailMap[entry.id];
        if (t) {
          // FIFO snapshot: { theirOpenInvoices, ourOpenBills, theirPrepaid, ourPrepaid }
          // Net for this currency = (theirOpenInvoices - theirPrepaid) - (ourOpenBills - ourPrepaid)
          // Positive = in our favor; negative = against us.
          var snap = t.snapshotAfter;
          var netForThisCur = (snap.theirOpenInvoices - snap.theirPrepaid) - (snap.ourOpenBills - snap.ourPrepaid);
          // _running_by_currency: for each currency that has had activity by this row,
          // snapshot the net at this point in time. But the FIFO trail only carries
          // the CURRENT row's currency snapshot — we need to reconstruct full map.
          // Walk the entire trail up to and including this row, accumulating per-cur nets.
          var nets = {};
          for (var i = 0; i < sim.trail.length; i++) {
            var ti = sim.trail[i];
            var snapI = ti.snapshotAfter;
            var ciCur = ti.currency;
            nets[ciCur] = (snapI.theirOpenInvoices - snapI.theirPrepaid) - (snapI.ourOpenBills - snapI.ourPrepaid);
            if (ti.entry && ti.entry.id === entry.id) break;
          }
          entry._running_by_currency = nets;
          entry._running_balance = netForThisCur;
        } else {
          // Fallback if entry isn't in trail (shouldn't happen)
          entry._running_by_currency = {};
          entry._running_balance = 0;
        }
      });
    });
    return byAcc;
  }, [accounts, entries]);

  // v55.83-A.6.27.72 HOTFIX 3 — summaryFor now returns FIFO-derived balance fields:
  //   byCurrency[cur].balance       — FIFO net (in our favor positive, against us negative)
  //   byCurrency[cur].theyOweUs     — open sales invoice total (FIFO)
  //   byCurrency[cur].weOweThem     — open vendor bill total (FIFO)
  //   byCurrency[cur].theirPrepaid  — their unapplied payment credits with us
  //   byCurrency[cur].ourPrepaid    — our unapplied payment credits with them
  //   byCurrency[cur].credit        — raw sum (back-compat, for Totals row display)
  //   byCurrency[cur].debit         — raw sum (back-compat)
  //   byCurrency[cur].count         — entry count for this currency
  // Single source of truth — same simulate() that drives the 4-pot strip.
  function summaryFor(accountId) {
    var arr = entriesByAccount[accountId] || [];
    var sim = simulate(arr);
    var byCur = {};
    // Initialize per-currency from simulate + count raw credit/debit alongside
    sim.currencies.forEach(function (cur) {
      var b = sim.byCurrency[cur];
      byCur[cur] = {
        credit: 0,
        debit: 0,
        count: 0,
        balance: b.netBalance,   // FIFO net (THE source of truth)
        theyOweUs: b.theirOpenInvoices,
        weOweThem: b.ourOpenBills,
        theirPrepaid: b.theirPrepaid,
        ourPrepaid: b.ourPrepaid,
      };
    });
    // Walk entries to fill raw credit/debit/count (for the totals row display)
    arr.forEach(function (e) {
      var cur = e._currency || String(e.currency || 'USD').toUpperCase().trim() || 'USD';
      if (!byCur[cur]) {
        byCur[cur] = { credit: 0, debit: 0, count: 0, balance: 0, theyOweUs: 0, weOweThem: 0, theirPrepaid: 0, ourPrepaid: 0 };
      }
      byCur[cur].credit += Number(e.credit_amount || 0);
      byCur[cur].debit += Number(e.debit_amount || 0);
      byCur[cur].count += 1;
    });
    // Sort currencies — USD first if present (most common), then alphabetical
    var currencies = Object.keys(byCur).sort(function (a, b) {
      if (a === 'USD' && b !== 'USD') return -1;
      if (b === 'USD' && a !== 'USD') return 1;
      return a.localeCompare(b);
    });
    // Legacy aggregates kept for back-compat (do NOT use for display — sums across currencies)
    var legacyCredit = 0, legacyDebit = 0, legacyBalance = 0;
    currencies.forEach(function (cur) {
      legacyCredit += byCur[cur].credit;
      legacyDebit += byCur[cur].debit;
      legacyBalance += byCur[cur].balance;
    });
    return {
      byCurrency: byCur,
      currencies: currencies,
      totalEntryCount: arr.length,
      // Legacy fields — back-compat only
      totalCredit: legacyCredit,
      totalDebit: legacyDebit,
      balance: legacyBalance,
      entryCount: arr.length,
    };
  }

  // v55.83-A.6.27.53 — entity lookup by code, used for print + Excel branding.
  var entitiesByCode = useMemo(function () {
    var m = {};
    entities.forEach(function (e) { m[e.entity_code] = e; });
    return m;
  }, [entities]);
  function entityFor(account) {
    if (!account || !account.business_entity_code) return null;
    return entitiesByCode[account.business_entity_code] || null;
  }
  function handlePrintLedger(account, perspective) {
    var ent = entityFor(account);
    var rows = entriesByAccount[account.id] || [];
    var s = summaryFor(account.id);
    var sim = simulate(rows);
    printAccountLedger(account, ent, rows, s, { perspective: perspective || 'internal', simulation: sim });
  }
  function handleExportExcel(account) {
    try {
      var ent = entityFor(account);
      var rows = entriesByAccount[account.id] || [];
      var s = summaryFor(account.id);
      exportAccountLedgerToExcel(account, ent, rows, s);
      toast.success('Excel exported: ' + account.account_name);
    } catch (e) {
      console.error('[open-accounts] Excel export failed:', e);
      toast.error('Excel export failed: ' + ((e && e.message) || String(e)));
    }
  }

  // Filter accounts by search term
  var filteredAccounts = useMemo(function () {
    var q = (search || '').trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(function (a) {
      return ((a.account_name || '') + ' ' + (a.account_name_ar || '') + ' ' + (a.notes || ''))
        .toLowerCase().indexOf(q) >= 0;
    });
  }, [accounts, search]);

  // v55.83-A.6.27.58 — Grand totals broken out per currency.
  // { byCurrency: {USD: {credit, debit, balance, accountsWithCurrency}, EGP: ...},
  //   currencies: ['USD', 'EGP'], accountCount }
  var grandTotals = useMemo(function () {
    var byCur = {};
    filteredAccounts.forEach(function (a) {
      var s = summaryFor(a.id);
      s.currencies.forEach(function (cur) {
        var cs = s.byCurrency[cur];
        if (!byCur[cur]) byCur[cur] = { credit: 0, debit: 0, balance: 0, accountsWithCurrency: 0 };
        byCur[cur].credit += cs.credit;
        byCur[cur].debit += cs.debit;
        byCur[cur].balance += cs.balance;
        byCur[cur].accountsWithCurrency += 1;
      });
    });
    var currencies = Object.keys(byCur).sort(function (a, b) {
      if (a === 'USD' && b !== 'USD') return -1;
      if (b === 'USD' && a !== 'USD') return 1;
      return a.localeCompare(b);
    });
    return {
      byCurrency: byCur,
      currencies: currencies,
      accountCount: filteredAccounts.length,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredAccounts, entriesByAccount]);

  function toggleAccount(id) {
    setCollapsedAccounts(function (prev) {
      var copy = Object.assign({}, prev);
      if (copy[id]) delete copy[id];
      else copy[id] = true;
      return copy;
    });
  }
  function collapseAll() { var c = {}; filteredAccounts.forEach(function (a) { c[a.id] = true; }); setCollapsedAccounts(c); }
  function expandAll() { setCollapsedAccounts({}); }

  // ── Account modal ──────────────────────────────────────────────
  function openNewAccount() {
    // v55.83-A.6.27.53 — default new accounts to KTC International if entities loaded
    var defaultEntity = entities.length > 0 ? entities[0].entity_code : 'ktc_intl';
    setAccountDraft({ account_name: '', account_name_ar: '', notes: '', active: true, business_entity_code: defaultEntity });
    setAccountModalOpen(true);
  }
  function openEditAccount(a) {
    setAccountDraft({
      id: a.id,
      account_name: a.account_name || '',
      account_name_ar: a.account_name_ar || '',
      notes: a.notes || '',
      active: a.active !== false,
      business_entity_code: a.business_entity_code || (entities.length > 0 ? entities[0].entity_code : 'ktc_intl'),
    });
    setAccountModalOpen(true);
  }
  async function saveAccount() {
    if (!accountDraft) return;
    var name = (accountDraft.account_name || '').trim();
    if (!name) { alert('Account name is required / اسم الحساب مطلوب'); return; }
    setBusy(true);
    try {
      var payload = {
        account_name: name,
        account_name_ar: (accountDraft.account_name_ar || '').trim() || null,
        notes: (accountDraft.notes || '').trim() || null,
        active: accountDraft.active !== false,
        business_entity_code: accountDraft.business_entity_code || null,
      };
      if (accountDraft.id) {
        await dbUpdate('open_accounts', accountDraft.id, payload, userProfile && userProfile.id);
        toast.success('Account updated: ' + name);
      } else {
        payload.created_by = userProfile && userProfile.id;
        await dbInsert('open_accounts', payload, userProfile && userProfile.id);
        toast.success('Account created: ' + name);
      }
      setAccountModalOpen(false);
      setAccountDraft(null);
      await reload();
    } catch (e) {
      console.error('[open-accounts] saveAccount failed:', e);
      toast.error('Failed to save account: ' + ((e && e.message) || String(e)));
    } finally {
      setBusy(false);
    }
  }
  async function deleteAccount(a) {
    var s = summaryFor(a.id);
    var prompt_msg = s.entryCount > 0
      ? 'Delete "' + a.account_name + '" AND all ' + s.entryCount + ' entries? This cannot be undone.\n\nحذف الحساب وجميع الإدخالات؟'
      : 'Delete account "' + a.account_name + '"?\n\nحذف الحساب؟';
    if (!confirm(prompt_msg)) return;
    setBusy(true);
    try {
      await supabase.from('open_accounts').delete().eq('id', a.id);
      toast.success('Account deleted: ' + a.account_name);
      await reload();
    } catch (e) {
      console.error('[open-accounts] deleteAccount failed:', e);
      toast.error('Failed to delete: ' + ((e && e.message) || String(e)));
    } finally {
      setBusy(false);
    }
  }

  // ── Entry modal ─────────────────────────────────────────────────
  function openNewEntry(accountId) {
    var today = new Date().toISOString().substring(0, 10);
    var acc = accounts.find(function (a) { return a.id === accountId; });
    var ent = acc ? entityFor(acc) : null;
    var defaultCur = (ent && ent.default_currency) || 'USD';
    setEntryDraft({
      account_id: accountId,
      entry_date: today,
      description: '',
      reference_number: '',
      // v55.83-A.6.27.72 — transaction_type drives credit/debit + cash flow.
      // Defaults to payment_received (most common starting case).
      transaction_type: 'payment_received',
      amount: '',
      currency: defaultCur,
      notes: '',
    });
    setEntryModalOpen(true);
  }
  function openEditEntry(entry) {
    // Derive transaction_type from existing data if not set on the row.
    // Fallback: credit_amount + linked invoice → sales_invoice; debit + linked → vendor_bill;
    //          plain credit → payment_received; plain debit → payment_sent.
    var derivedType = entry.transaction_type;
    if (!derivedType) {
      var hasCredit = Number(entry.credit_amount || 0) > 0;
      var hasInvoice = !!entry.linked_open_invoice_id;
      if (hasCredit && hasInvoice) derivedType = 'sales_invoice';
      else if (!hasCredit && hasInvoice) derivedType = 'vendor_bill';
      else if (hasCredit) derivedType = 'payment_received';
      else derivedType = 'payment_sent';
    }
    setEntryDraft({
      id: entry.id,
      account_id: entry.account_id,
      entry_date: entry.entry_date,
      description: entry.description || '',
      reference_number: entry.reference_number || '',
      transaction_type: derivedType,
      amount: String(entry.credit_amount || entry.debit_amount || ''),
      currency: String(entry.currency || 'USD').toUpperCase(),
      notes: entry.notes || '',
    });
    setEntryModalOpen(true);
  }
  async function saveEntry() {
    if (!entryDraft) return;
    var desc = (entryDraft.description || '').trim();
    if (!desc) { alert('Description is required / الوصف مطلوب'); return; }
    if (!entryDraft.entry_date) { alert('Date is required / التاريخ مطلوب'); return; }
    var amt = Number(entryDraft.amount);
    if (isNaN(amt) || amt <= 0) { alert('Amount must be a positive number / المبلغ يجب أن يكون رقم موجب'); return; }
    var cur = String(entryDraft.currency || 'USD').toUpperCase().trim();
    // v55.83-A.6.27.72 HOTFIX 1 — Tighten currency to known codes to prevent
    // typo'd phantom pots (e.g. "USS" creating a separate ledger for one typo).
    var KNOWN_CURRENCIES = ['USD', 'EGP', 'EUR', 'GBP', 'CAD', 'SAR', 'AED', 'CHF', 'JPY', 'CNY'];
    if (cur.length < 2) { alert('Currency code is required / كود العملة مطلوب'); return; }
    if (KNOWN_CURRENCIES.indexOf(cur) === -1) {
      if (!confirm('Currency "' + cur + '" is not in the standard list (USD, EGP, EUR, GBP, CAD, SAR, AED, CHF, JPY, CNY). ' +
        'A typo here will create a separate phantom balance pot.\n\nUse "' + cur + '" anyway?')) return;
    }
    if (!entryDraft.transaction_type) { alert('Transaction type is required / نوع المعاملة مطلوب'); return; }
    // v55.83-A.6.27.72 — derive credit/debit side from transaction_type.
    // Sales invoice + payment received = credit side. Vendor bill + payment sent = debit side.
    var creditTypes = ['sales_invoice', 'payment_received'];
    var isCredit = creditTypes.indexOf(entryDraft.transaction_type) !== -1;
    setBusy(true);
    try {
      var payload = {
        account_id: entryDraft.account_id,
        entry_date: entryDraft.entry_date,
        description: desc,
        reference_number: (entryDraft.reference_number || '').trim() || null,
        transaction_type: entryDraft.transaction_type,
        credit_amount: isCredit ? amt : null,
        debit_amount: isCredit ? null : amt,
        currency: cur,
        notes: (entryDraft.notes || '').trim() || null,
      };
      if (entryDraft.id) {
        await dbUpdate('open_account_entries', entryDraft.id, payload, userProfile && userProfile.id);
        toast.success('Entry updated');
      } else {
        payload.created_by = userProfile && userProfile.id;
        await dbInsert('open_account_entries', payload, userProfile && userProfile.id);
        toast.success('Entry added');
      }
      setEntryModalOpen(false);
      setEntryDraft(null);
      await reload();
    } catch (e) {
      console.error('[open-accounts] saveEntry failed:', e);
      toast.error('Failed to save entry: ' + ((e && e.message) || String(e)));
    } finally {
      setBusy(false);
    }
  }
  async function deleteEntry(entry) {
    // v55.83-A.6.27.72 HOTFIX 1 — If deleting one half of an offset, also delete the pair
    // (otherwise the math becomes one-sided and corrupts the balances).
    var isOffsetHalf = entry && entry.transaction_type === 'offset' && entry.offset_pair_id;
    var msg = 'Delete this entry? This cannot be undone.\n\nحذف هذا الإدخال؟';
    if (isOffsetHalf) {
      msg = 'This entry is one half of an offset pair. Deleting it will ALSO delete the other half ' +
            '(to keep the books balanced).\n\nهذا الإدخال جزء من مقاصة. سيتم حذف الجزء الآخر تلقائيًا.\n\n' +
            'Proceed? / متابعة؟';
    }
    if (!confirm(msg)) return;
    setBusy(true);
    try {
      if (isOffsetHalf) {
        // Delete both halves by pair_id
        var delPair = await supabase.from('open_account_entries').delete().eq('offset_pair_id', entry.offset_pair_id);
        if (delPair.error) throw delPair.error;
        toast.success('Offset pair deleted (both halves)');
      } else {
        // Check: if this entry is REFERENCED by an offset (as invoice or bill being offset),
        // warn the user that the offset will become stale.
        var refByOffset = (entries || []).find(function (e) {
          return e.transaction_type === 'offset' &&
                 (e.offset_invoice_id === entry.id || e.offset_bill_id === entry.id);
        });
        if (refByOffset) {
          var proceed = confirm('WARNING: This entry is referenced by an offset entry. Deleting it ' +
            'will leave the offset partially broken (one side will silently fail to apply).\n\n' +
            'Recommended: delete the offset pair FIRST (find the row marked 🔄 Offset), then delete this entry.\n\n' +
            'Delete anyway?');
          if (!proceed) { setBusy(false); return; }
        }
        await supabase.from('open_account_entries').delete().eq('id', entry.id);
        toast.success('Entry deleted');
      }
      await reload();
    } catch (e) {
      console.error('[open-accounts] deleteEntry failed:', e);
      toast.error('Failed to delete entry: ' + ((e && e.message) || String(e)));
    } finally {
      setBusy(false);
    }
  }

  // v55.83-A.6.27.72 — One-click Offset handler.
  // Auto-picks oldest open sales_invoice + oldest open vendor_bill in same currency.
  // Creates two linked entries (cross-referenced via offset_pair_id) that net the smaller amount.
  // After insert, reloads — the FIFO simulation will automatically credit both invoice/bill remaining.
  async function handleOffset(accountId) {
    var entries = entriesByAccount[accountId] || [];
    var cand = findOffsetCandidate(entries);
    if (!cand) {
      toast.error('No offsettable pair found. You need at least one open sales invoice + one open vendor bill in the same currency.');
      return;
    }
    var prompt = 'Offset will net ' + cand.currency + ' ' + cand.offsetAmount.toFixed(2) + ':\n\n' +
      '  Sales invoice: ' + (cand.invoice.reference_number || cand.invoice.description) + ' (remaining ' + cand.invoiceRemaining.toFixed(2) + ')\n' +
      '  Vendor bill:   ' + (cand.bill.reference_number || cand.bill.description) + ' (remaining ' + cand.billRemaining.toFixed(2) + ')\n\n' +
      'Proceed?';
    if (!confirm(prompt)) return;
    setBusy(true);
    try {
      var today = new Date().toISOString().substring(0, 10);
      var pair = buildOffsetEntries(cand, today, userProfile && userProfile.id);
      // Insert both halves. If second fails, attempt to roll back the first.
      var first = await dbInsert('open_account_entries', pair[0], userProfile && userProfile.id);
      try {
        await dbInsert('open_account_entries', pair[1], userProfile && userProfile.id);
        toast.success('Offset posted: ' + cand.currency + ' ' + cand.offsetAmount.toFixed(2));
        await reload();
      } catch (e2) {
        // Rollback first entry
        try {
          if (first && first.id) await supabase.from('open_account_entries').delete().eq('id', first.id);
        } catch (rb) { console.warn('[open-accounts] offset rollback failed:', rb); }
        throw e2;
      }
    } catch (e) {
      console.error('[open-accounts] handleOffset failed:', e);
      toast.error('Offset failed: ' + ((e && e.message) || String(e)));
    } finally {
      setBusy(false);
    }
  }

  // ── Invoice modal (v55.83-A.6.27.59) ──────────────────────────────
  // Helper: lookup invoice line items by invoice id (from cached invoiceItems)
  function itemsForInvoice(invoiceId) {
    return invoiceItems.filter(function (it) { return it.invoice_id === invoiceId; });
  }

  // Helper: compute subtotal / tax / total from a draft's items + shipping + tax_rate
  function computeInvoiceTotals(draft) {
    if (!draft) return { subtotal: 0, taxAmount: 0, total: 0 };
    var subtotal = 0;
    (draft.items || []).forEach(function (it) {
      var qty = Number(it.quantity || 0);
      var unit = Number(it.unit_price || 0);
      var line = qty * unit;
      subtotal += line;
    });
    var shipping = Number(draft.shipping_amount || 0);
    var taxableBase = subtotal + shipping;
    var taxAmount = 0;
    if (draft.tax_enabled && draft.tax_rate_pct != null && draft.tax_rate_pct !== '') {
      var rate = Number(draft.tax_rate_pct) / 100;
      taxAmount = taxableBase * rate;
    }
    var total = taxableBase + taxAmount;
    return {
      subtotal: Math.round(subtotal * 100) / 100,
      taxAmount: Math.round(taxAmount * 100) / 100,
      total: Math.round(total * 100) / 100,
    };
  }

  // v55.83-A.6.27.66 (Issue 1, Max May 23 2026) — per-account invoice number.
  // Format B (Max's choice): INV-{ACCT-SLUG}-{YEAR}-{NNN}
  //   • SLUG = uppercase ASCII, alphanumeric only, hyphens for spaces
  //     (e.g. "El Sayad" → "EL-SAYAD", "Stitches & More" → "STITCHES-MORE")
  //   • YEAR = current 4-digit year
  //   • NNN  = next sequential per-account counter for that year (zero-padded
  //            to 3 digits, expands automatically if you reach 1000)
  // Pre-filled when the user clicks + Invoice. Editable — type over it to
  // override; otherwise saved as-is. If counting fails for any reason
  // (account not loaded, no invoices array, etc.) returns the format prefix
  // with NNN = 001 so save still works.
  function slugifyAccountName(name) {
    if (!name) return 'ACCT';
    var s = String(name).toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')   // non-alphanumeric → hyphen
      .replace(/^-+|-+$/g, '');      // trim leading/trailing hyphens
    if (!s) return 'ACCT';
    if (s.length > 18) s = s.substring(0, 18).replace(/-+$/, '');  // keep tidy
    return s;
  }
  function computeNextInvoiceNumber(account) {
    var year = new Date().getFullYear();
    var slug = slugifyAccountName(account && account.account_name);
    var prefix = 'INV-' + slug + '-' + year + '-';
    // Find max existing sequence for this prefix
    var maxN = 0;
    (invoices || []).forEach(function (inv) {
      if (!inv || inv.account_id !== (account && account.id)) return;
      var num = String(inv.invoice_number || '');
      if (num.indexOf(prefix) !== 0) return;
      var tail = num.substring(prefix.length);
      var n = parseInt(tail, 10);
      if (!isNaN(n) && n > maxN) maxN = n;
    });
    var next = maxN + 1;
    var padded = next < 1000 ? ('000' + next).slice(-3) : String(next);
    return prefix + padded;
  }

  function openNewInvoice(accountId) {
    var today = new Date().toISOString().substring(0, 10);
    var acc = accounts.find(function (a) { return a.id === accountId; });
    var ent = acc ? entityFor(acc) : null;
    var defaultCur = (ent && ent.default_currency) || 'USD';
    setInvoiceDraft({
      account_id: accountId,
      // v55.83-A.6.27.66 (Issue 1) — pre-fill the next sequential invoice
      // number per account in format INV-{ACCT-SLUG}-{YEAR}-{NNN}. User can
      // override by typing over it; otherwise save uses it as-is.
      invoice_number: computeNextInvoiceNumber(acc),
      direction: 'credit',  // default: we billed them
      counterparty_name: (acc && acc.account_name) || '',
      counterparty_name_ar: (acc && acc.account_name_ar) || '',
      counterparty_address: '',
      counterparty_email: '',
      counterparty_phone: '',
      invoice_date: today,
      due_date: '',
      currency: defaultCur,
      tax_enabled: false,        // Q1 — optional, default off (Max May 22)
      tax_rate_pct: '',
      shipping_amount: '',
      notes: '',
      terms: '',
      items: [{ description: '', quantity: '1', unit_price: '' }],
    });
    setInvoiceModalOpen(true);
  }

  function openEditInvoice(invoice) {
    var rows = itemsForInvoice(invoice.id);
    setInvoiceDraft({
      id: invoice.id,
      account_id: invoice.account_id,
      invoice_number: invoice.invoice_number || '',
      direction: invoice.direction || 'credit',
      counterparty_name: invoice.counterparty_name || '',
      counterparty_name_ar: invoice.counterparty_name_ar || '',
      counterparty_address: invoice.counterparty_address || '',
      counterparty_email: invoice.counterparty_email || '',
      counterparty_phone: invoice.counterparty_phone || '',
      invoice_date: invoice.invoice_date || '',
      due_date: invoice.due_date || '',
      currency: String(invoice.currency || 'USD').toUpperCase(),
      tax_enabled: invoice.tax_rate_pct != null || Number(invoice.tax_amount || 0) > 0,
      tax_rate_pct: invoice.tax_rate_pct != null ? String(invoice.tax_rate_pct) : '',
      shipping_amount: invoice.shipping_amount != null ? String(invoice.shipping_amount) : '',
      notes: invoice.notes || '',
      terms: invoice.terms || '',
      items: rows.length > 0
        ? rows.map(function (it) {
            return {
              id: it.id,
              description: it.description || '',
              quantity: String(it.quantity || ''),
              unit_price: String(it.unit_price || ''),
            };
          })
        : [{ description: '', quantity: '1', unit_price: '' }],
    });
    setInvoiceModalOpen(true);
  }

  // Update / add / remove line items within the draft
  function setInvoiceItemField(idx, field, value) {
    setInvoiceDraft(function (prev) {
      if (!prev) return prev;
      var next = Object.assign({}, prev);
      next.items = (prev.items || []).slice();
      next.items[idx] = Object.assign({}, next.items[idx] || {}, {});
      next.items[idx][field] = value;
      return next;
    });
  }
  function addInvoiceItem() {
    setInvoiceDraft(function (prev) {
      if (!prev) return prev;
      var next = Object.assign({}, prev);
      next.items = (prev.items || []).slice();
      next.items.push({ description: '', quantity: '1', unit_price: '' });
      return next;
    });
  }
  function removeInvoiceItem(idx) {
    setInvoiceDraft(function (prev) {
      if (!prev) return prev;
      var next = Object.assign({}, prev);
      var nextItems = (prev.items || []).slice();
      nextItems.splice(idx, 1);
      // Always keep at least one row visible
      if (nextItems.length === 0) nextItems.push({ description: '', quantity: '1', unit_price: '' });
      next.items = nextItems;
      return next;
    });
  }

  async function saveInvoice() {
    if (!invoiceDraft) return;
    // Validation
    var invNum = (invoiceDraft.invoice_number || '').trim();
    if (!invNum) { alert('Invoice number is required / رقم الفاتورة مطلوب'); return; }
    if (!invoiceDraft.counterparty_name || !invoiceDraft.counterparty_name.trim()) {
      alert('Counterparty name is required / اسم الطرف الآخر مطلوب');
      return;
    }
    if (!invoiceDraft.invoice_date) { alert('Invoice date is required / تاريخ الفاتورة مطلوب'); return; }
    if (!invoiceDraft.direction) { alert('Direction is required (we billed them OR they billed us)'); return; }
    var cur = String(invoiceDraft.currency || 'USD').toUpperCase().trim();
    if (cur.length < 2) { alert('Currency code is required / كود العملة مطلوب'); return; }

    // Filter blank items, validate at least one
    var validItems = (invoiceDraft.items || []).filter(function (it) {
      var d = (it.description || '').trim();
      var q = Number(it.quantity);
      var u = Number(it.unit_price);
      return d.length > 0 && !isNaN(q) && q > 0 && !isNaN(u) && u >= 0;
    });
    if (validItems.length === 0) {
      alert('Add at least one line item with description, quantity > 0, and unit price.\n\nأضف بندًا واحدًا على الأقل');
      return;
    }

    var totals = computeInvoiceTotals(Object.assign({}, invoiceDraft, { items: validItems }));

    setBusy(true);
    try {
      var nowUserId = userProfile && userProfile.id;
      var invPayload = {
        account_id: invoiceDraft.account_id,
        invoice_number: invNum,
        direction: invoiceDraft.direction,
        counterparty_name: invoiceDraft.counterparty_name.trim(),
        counterparty_name_ar: (invoiceDraft.counterparty_name_ar || '').trim() || null,
        counterparty_address: (invoiceDraft.counterparty_address || '').trim() || null,
        counterparty_email: (invoiceDraft.counterparty_email || '').trim() || null,
        counterparty_phone: (invoiceDraft.counterparty_phone || '').trim() || null,
        invoice_date: invoiceDraft.invoice_date,
        due_date: invoiceDraft.due_date || null,
        currency: cur,
        subtotal: totals.subtotal,
        shipping_amount: Number(invoiceDraft.shipping_amount || 0) || 0,
        tax_rate_pct: invoiceDraft.tax_enabled && invoiceDraft.tax_rate_pct !== '' ? Number(invoiceDraft.tax_rate_pct) : null,
        tax_amount: totals.taxAmount,
        total_amount: totals.total,
        notes: (invoiceDraft.notes || '').trim() || null,
        terms: (invoiceDraft.terms || '').trim() || null,
      };

      var invoiceId;
      if (invoiceDraft.id) {
        // UPDATE existing invoice + items + linked ledger entry
        invoiceId = invoiceDraft.id;
        var updRes = await supabase.from('open_account_invoices').update(invPayload).eq('id', invoiceId).select().single();
        if (updRes.error) throw updRes.error;

        // Replace items: delete existing, insert new
        var delItemsRes = await supabase.from('open_account_invoice_items').delete().eq('invoice_id', invoiceId);
        if (delItemsRes.error) throw delItemsRes.error;
      } else {
        // INSERT new invoice
        invPayload.created_by = nowUserId;
        invPayload.updated_by = nowUserId;
        var insRes = await supabase.from('open_account_invoices').insert(invPayload).select().single();
        if (insRes.error) throw insRes.error;
        invoiceId = insRes.data.id;
      }

      // Insert line items
      var itemRows = validItems.map(function (it, idx) {
        var qty = Number(it.quantity);
        var unit = Number(it.unit_price);
        return {
          invoice_id: invoiceId,
          sort_order: idx,
          description: (it.description || '').trim(),
          quantity: qty,
          unit_price: unit,
          line_total: Math.round(qty * unit * 100) / 100,
        };
      });
      if (itemRows.length > 0) {
        var insItemsRes = await supabase.from('open_account_invoice_items').insert(itemRows);
        if (insItemsRes.error) throw insItemsRes.error;
      }

      // Auto-create or auto-update the linked ledger entry (per Max Q3 = A: auto-update on edit).
      // The entry's amount = total_amount, currency = invoice currency, side = direction.
      var linkedEntryPayload = {
        account_id: invoiceDraft.account_id,
        entry_date: invoiceDraft.invoice_date,
        description: 'Invoice ' + invNum + ' — ' + invoiceDraft.counterparty_name.trim(),
        reference_number: invNum,
        // v55.83-A.6.27.72 — transaction_type lets the FIFO engine know which prepaid
        // pot to consume + which open pot to add the remainder to.
        //   direction === 'credit' → we billed them → sales_invoice (consumes theirPrepaid)
        //   direction === 'debit'  → they billed us → vendor_bill   (consumes ourPrepaid)
        transaction_type: invoiceDraft.direction === 'credit' ? 'sales_invoice' : 'vendor_bill',
        credit_amount: invoiceDraft.direction === 'credit' ? totals.total : null,
        debit_amount: invoiceDraft.direction === 'debit' ? totals.total : null,
        currency: cur,
        notes: 'Auto-synced from invoice ' + invNum + '. Edit the invoice to change this entry.',
        linked_open_invoice_id: invoiceId,
      };

      // Find existing linked entry (if any) for this invoice id
      var existingLinked = entries.find(function (e) { return e.linked_open_invoice_id === invoiceId; });
      if (existingLinked) {
        var updLinkedRes = await supabase.from('open_account_entries').update(linkedEntryPayload).eq('id', existingLinked.id);
        if (updLinkedRes.error) throw updLinkedRes.error;
      } else {
        linkedEntryPayload.created_by = nowUserId;
        var insLinkedRes = await supabase.from('open_account_entries').insert(linkedEntryPayload);
        if (insLinkedRes.error) throw insLinkedRes.error;
      }

      toast.success(invoiceDraft.id ? 'Invoice updated' : 'Invoice saved + linked to ledger');
      setInvoiceModalOpen(false);
      setInvoiceDraft(null);
      await reload();
    } catch (e) {
      console.error('[open-accounts] saveInvoice failed:', e);
      var errMsg = (e && e.message) || String(e);
      var hint = '';
      if (/relation.*open_account_invoices.*does not exist/i.test(errMsg)) {
        hint = '\n\nThe open_account_invoices table does not exist. Run SQL migration v55.83-A.6.27.59 in Supabase.';
      } else if (/column.*does not exist/i.test(errMsg)) {
        hint = '\n\nA database column is missing. The .59 SQL migration was likely not fully run.';
      }
      try { toast.error('Save failed: ' + errMsg); } catch (_) {}
      alert('Save failed: ' + errMsg + hint);
    } finally {
      setBusy(false);
    }
  }

  async function deleteInvoice(invoice) {
    if (!invoice) return;
    var confirmMsg = 'Delete invoice ' + invoice.invoice_number + '?\n\n' +
      'This will ALSO delete the linked ledger entry (auto-cascade).\n\n' +
      'This cannot be undone.';
    if (!confirm(confirmMsg)) return;
    setBusy(true);
    try {
      // FK CASCADE on linked_open_invoice_id deletes the ledger entry automatically.
      // Items also cascade via invoice_id FK.
      var delRes = await supabase.from('open_account_invoices').delete().eq('id', invoice.id);
      if (delRes.error) throw delRes.error;
      toast.success('Invoice deleted + linked ledger entry removed');
      await reload();
    } catch (e) {
      console.error('[open-accounts] deleteInvoice failed:', e);
      toast.error('Failed to delete invoice: ' + ((e && e.message) || String(e)));
      alert('Delete failed: ' + ((e && e.message) || String(e)));
    } finally {
      setBusy(false);
    }
  }

  // Print an existing (saved) invoice
  function handlePrintInvoice(invoice) {
    if (!invoice) return;
    var acc = accounts.find(function (a) { return a.id === invoice.account_id; });
    var ent = acc ? entityFor(acc) : null;
    var rows = itemsForInvoice(invoice.id);
    try {
      printOpenAccountInvoice(invoice, rows, ent);
    } catch (e) {
      console.error('[open-accounts] print invoice failed:', e);
      toast.error('Print failed: ' + ((e && e.message) || String(e)));
    }
  }

  // When a user clicks a ledger row that has a linked invoice, open that invoice for review/edit.
  function openInvoiceFromEntry(entry) {
    if (!entry || !entry.linked_open_invoice_id) return;
    var inv = invoices.find(function (i) { return i.id === entry.linked_open_invoice_id; });
    if (inv) openEditInvoice(inv);
  }

  // Quick lookup: invoices for a given account
  function invoicesForAccount(accountId) {
    return invoices.filter(function (i) { return i.account_id === accountId; });
  }

  async function reload() {
    try {
      var [accRes, entRes, bizRes, invRes, itmRes] = await Promise.all([
        supabase.from('open_accounts').select('*').order('account_name'),
        supabase.from('open_account_entries').select('*').order('entry_date', { ascending: true }).order('created_at', { ascending: true }),
        supabase.from('business_entities').select('*').eq('active', true).order('display_order'),
        supabase.from('open_account_invoices').select('*').order('invoice_date', { ascending: false }),
        supabase.from('open_account_invoice_items').select('*').order('sort_order', { ascending: true }),
      ]);
      setAccounts(accRes.data || []);
      setEntries(entRes.data || []);
      if (bizRes && !bizRes.error) setEntities(bizRes.data || []);
      if (invRes && !invRes.error) setInvoices(invRes.data || []);
      if (itmRes && !itmRes.error) setInvoiceItems(itmRes.data || []);
    } catch (e) { console.error('[open-accounts] reload failed:', e); }
  }

  if (!canView) {
    return (
      <div className="bg-amber-50 border-2 border-amber-300 rounded-lg p-4 text-amber-900 font-semibold">
        You don&apos;t have permission to view Open Accounts. Ask a super admin to grant you the &quot;Open Accounts&quot; permission.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-700 to-teal-700 text-white rounded-xl p-4 shadow-md">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-emerald-100">Open Accounts / حسابات مفتوحة</div>
            <div className="text-2xl font-extrabold mt-0.5">📒 Internal Ledger</div>
            <div className="text-sm font-semibold text-emerald-50 mt-0.5" style={{ direction: 'rtl' }}>دفتر الأستاذ الداخلي للحسابات الخاصة</div>
            <div className="text-xs font-semibold text-emerald-100 mt-1">
              <span className="bg-white text-emerald-800 rounded px-1.5 py-0.5 mr-1">CREDIT</span> = money in to us
              <span className="mx-2">·</span>
              <span className="bg-white text-red-800 rounded px-1.5 py-0.5 mr-1">DEBIT</span> = money out from us
            </div>
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            {canEdit && (
              <button onClick={openNewAccount} className="px-3 py-2 bg-white text-emerald-800 text-sm font-extrabold rounded shadow hover:bg-emerald-50">
                + New Account / حساب جديد
              </button>
            )}
            <button onClick={expandAll} className="px-3 py-1.5 bg-emerald-900 text-white text-xs font-extrabold rounded shadow hover:bg-emerald-950">⬇ Expand All</button>
            <button onClick={collapseAll} className="px-3 py-1.5 bg-slate-800 text-white text-xs font-extrabold rounded shadow hover:bg-slate-900">⬆ Collapse All</button>
          </div>
        </div>
      </div>

      {/* Search + grand totals */}
      <div className="bg-white border-2 border-slate-300 rounded-lg p-3">
        <input
          type="text"
          value={search}
          onChange={function (e) { setSearch(e.target.value); }}
          placeholder="Search accounts by name or notes / بحث..."
          className="w-full px-3 py-2 border-2 border-slate-300 rounded text-sm bg-white text-slate-900 font-bold"
        />
      </div>

      {/* v55.83-A.6.27.72 HOTFIX 11 — Global Net Position card.
          Collapses all currencies into a single base-currency (USD) liquidity number
          using the most recent rates from fx_rates. Shows per-currency contribution
          and flags any missing rates so the user knows which pairs to add. */}
      {grandTotals.currencies.length > 1 && (function () {
        var unified = convertToBaseCurrency(grandTotals.byCurrency, 'USD', fxRates);
        var hasAnyMissing = unified.missingRates.length > 0;
        var totCls = unified.total > 0.005 ? 'bg-emerald-700' : unified.total < -0.005 ? 'bg-red-700' : 'bg-slate-700';
        return (
          <div className={totCls + ' text-white rounded-lg p-3 shadow-xl border-2 border-amber-400'}>
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-[10px] font-extrabold uppercase tracking-widest opacity-90">Global Net Position</div>
                <div className="text-[10px] opacity-80">Base currency: USD · all counterparties combined</div>
              </div>
              <div className="text-right">
                <div className="text-3xl font-extrabold font-mono">{fmtSigned(unified.total)} USD</div>
                <div className="text-[10px] opacity-90 font-semibold">
                  {unified.total > 0.005 ? '↑ Net in our favor' : unified.total < -0.005 ? '↓ Net against us' : 'Settled'}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-2 text-[10px] font-semibold">
              {unified.breakdown.map(function (b) {
                if (!b.hasRate) {
                  return (
                    <div key={b.cur} className="bg-amber-500 text-slate-900 rounded px-2 py-1" title="No FX rate available — add one in the FX Rates panel">
                      <span className="font-extrabold">{fmtSigned(b.amount)} {b.cur}</span>
                      <span className="ml-1 opacity-90">→ rate missing</span>
                    </div>
                  );
                }
                if (b.cur === unified.base) {
                  return (
                    <div key={b.cur} className="bg-slate-900/40 rounded px-2 py-1">
                      <span className="font-extrabold">{fmtSigned(b.amount)} {b.cur}</span>
                      <span className="ml-1 opacity-90">(base)</span>
                    </div>
                  );
                }
                return (
                  <div key={b.cur} className="bg-slate-900/40 rounded px-2 py-1">
                    <span className="font-extrabold">{fmtSigned(b.amount)} {b.cur}</span>
                    <span className="ml-1 opacity-90">× {Number(b.rate).toLocaleString(undefined, { maximumFractionDigits: 6 })} = {fmtSigned(b.baseEquiv)} USD</span>
                  </div>
                );
              })}
            </div>
            {hasAnyMissing && (
              <div className="mt-2 bg-amber-100 text-amber-900 text-[11px] font-bold rounded px-2 py-1.5 border border-amber-300">
                ⚠ Missing FX rates for: {unified.missingRates.join(', ')} — add them in Inventory → FX Rates so this card includes those balances.
              </div>
            )}
          </div>
        );
      })()}

      {/* v55.83-A.6.27.58 — Grand totals broken out PER CURRENCY.
          Previously mixed USD and EGP into one number, which was meaningless.
          Now: one row per currency with Credit / Debit / Balance for that currency.
          Plus an "Accounts" tile on top showing how many accounts use each currency. */}
      <div className="bg-slate-800 text-white rounded p-2 shadow flex items-baseline gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider">Accounts</div>
          <div className="text-xl font-extrabold mt-0.5">{grandTotals.accountCount}</div>
        </div>
        {grandTotals.currencies.length > 0 && (
          <div className="text-[10px] text-slate-300 font-semibold">
            Currencies in use: {grandTotals.currencies.map(function (cur) {
              return cur + ' (' + grandTotals.byCurrency[cur].accountsWithCurrency + ' acct' + (grandTotals.byCurrency[cur].accountsWithCurrency === 1 ? '' : 's') + ')';
            }).join(' · ')}
          </div>
        )}
      </div>

      {grandTotals.currencies.length === 0 && (
        <div className="bg-slate-100 border-2 border-slate-300 rounded p-3 text-center text-slate-600 text-sm font-bold">
          No entries yet — add ledger entries to see currency totals
        </div>
      )}

      {grandTotals.currencies.map(function (cur) {
        var t = grandTotals.byCurrency[cur];
        return (
          <div key={cur} className="grid grid-cols-3 gap-2">
            <div className="bg-emerald-700 text-white rounded p-2 shadow">
              <div className="text-[10px] font-bold uppercase tracking-wider">{cur} Total Credit (money in)</div>
              <div className="text-xl font-extrabold mt-0.5">{fmtNum(t.credit)} {cur}</div>
            </div>
            <div className="bg-red-700 text-white rounded p-2 shadow">
              <div className="text-[10px] font-bold uppercase tracking-wider">{cur} Total Debit (money out)</div>
              <div className="text-xl font-extrabold mt-0.5">{fmtNum(t.debit)} {cur}</div>
            </div>
            <div className={(t.balance >= 0 ? 'bg-emerald-800' : 'bg-red-800') + ' text-white rounded p-2 shadow'}>
              <div className="text-[10px] font-bold uppercase tracking-wider">{cur} Net Balance</div>
              <div className="text-xl font-extrabold mt-0.5">{fmtSigned(t.balance)} {cur}</div>
              <div className="text-[10px] font-semibold opacity-90">
                {t.balance > 0 ? 'they owe us' : t.balance < 0 ? 'we owe them' : 'settled'}
              </div>
            </div>
          </div>
        );
      })}

      {/* Loading / error / empty states */}
      {loading && <div className="text-center py-10 text-slate-600 font-bold">Loading accounts... / جاري التحميل</div>}
      {error && !loading && (
        <div className="bg-red-100 border-2 border-red-400 text-red-900 rounded p-3 font-bold">
          <strong>Error:</strong> {error}
        </div>
      )}
      {!loading && !error && filteredAccounts.length === 0 && (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-lg p-6 text-center">
          <div className="text-base font-extrabold text-amber-900">No accounts yet / لا توجد حسابات</div>
          <div className="text-xs text-amber-700 mt-1">{search ? 'Try a different search term, or click "+ New Account" to create one.' : 'Click "+ New Account" to create your first ledger.'}</div>
        </div>
      )}

      {/* Account cards (accordion) */}
      {!loading && !error && filteredAccounts.map(function (a) {
        var s = summaryFor(a.id);
        var collapsed = !!collapsedAccounts[a.id];
        var accEntries = entriesByAccount[a.id] || [];
        // v55.83-A.6.27.72 — Run FIFO simulation for this account to get:
        //   • per-row Amount/Paid/Remaining (from sim.applications[entryId])
        //   • per-currency final balances (theirOpenInvoices, ourOpenBills, theirPrepaid, ourPrepaid, net)
        //   • offset candidate (if any) for the one-click offset button
        var simResult = simulate(accEntries);
        var offsetCandidate = findOffsetCandidate(accEntries);
        var offsetableCurs = validateOffsetable(accEntries);
        return (
          <div key={a.id} className="bg-white border-2 border-slate-300 rounded-lg overflow-hidden">
            {/* Card header (clickable) */}
            <div className="bg-slate-100 hover:bg-slate-200 transition-colors">
              <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                <button onClick={function () { toggleAccount(a.id); }} className="flex items-center gap-3 flex-1 text-left">
                  <span className="text-lg font-extrabold text-slate-900">{collapsed ? '▶' : '▼'}</span>
                  <div>
                    <div className="text-base font-extrabold text-slate-900">{a.account_name}</div>
                    {a.account_name_ar && <div className="text-sm font-bold text-slate-700" style={{ direction: 'rtl' }}>{a.account_name_ar}</div>}
                  </div>
                  {(function () {
                    var ent = entityFor(a);
                    if (!ent) return null;
                    return (
                      <span className="px-2 py-0.5 bg-indigo-700 text-white text-[9px] font-extrabold uppercase tracking-wider rounded" title="The KTC entity used as the 'us' side on prints and exports">
                        {ent.entity_code === 'ktc_intl' ? '🇺🇸 KTC Intl' : ent.entity_code === 'ktc_egypt' ? '🇪🇬 KTC Egypt' : ent.entity_name}
                      </span>
                    );
                  })()}
                  <div className="flex flex-col gap-1 text-xs font-bold text-slate-800 ml-auto">
                    {s.currencies.length === 0 ? (
                      <div className="text-slate-500 italic">No entries yet</div>
                    ) : s.currencies.map(function (cur) {
                      var cs = s.byCurrency[cur];
                      return (
                        <div key={cur} className="flex items-center gap-2 flex-wrap">
                          <span className="px-1.5 py-0.5 bg-slate-200 text-slate-900 text-[10px] font-mono font-extrabold rounded">{cur}</span>
                          {/* v55.83-A.6.27.72 HOTFIX 6 — REMOVED Cr/Dr raw sums from header.
                              They caused the same reconciliation confusion as the Totals row
                              (e.g. "Cr 0 / Dr 11,888" alongside "Bal -9,888" looked like
                              broken math because raw sums don't match FIFO net). The Bal
                              label alone carries the meaningful number. */}
                          <span className={'px-2 py-0.5 rounded font-extrabold ' + (cs.balance > 0 ? 'bg-emerald-700 text-white' : cs.balance < 0 ? 'bg-red-700 text-white' : 'bg-slate-500 text-white')}>
                            Bal: {fmtSigned(cs.balance)} {cur}
                            <span className="ml-1 text-[10px] opacity-90">
                              {cs.balance > 0 ? '(they owe us)' : cs.balance < 0 ? '(we owe them)' : '(settled)'}
                            </span>
                          </span>
                        </div>
                      );
                    })}
                    <div className="text-slate-700 text-[10px]">({s.totalEntryCount} {s.totalEntryCount === 1 ? 'entry' : 'entries'})</div>
                  </div>
                </button>
                {canEdit && (
                  <div className="flex gap-1 flex-wrap">
                    <button onClick={function () { openNewEntry(a.id); }} className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-extrabold rounded shadow">+ Entry</button>
                    <button onClick={function () { openNewInvoice(a.id); }} className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-extrabold rounded shadow" title="Create a mini-invoice. Will auto-create a linked ledger entry.">+ Invoice</button>
                    {/* v55.83-A.6.27.72 — One-click Offset button. Auto-picks oldest open
                        invoice + oldest open bill in same currency, nets the smaller amount.
                        Disabled if no offsettable pair exists. */}
                    <button
                      onClick={function () { handleOffset(a.id); }}
                      disabled={!offsetCandidate}
                      className={'px-2 py-1 text-[10px] font-extrabold rounded shadow ' +
                        (offsetCandidate
                          ? 'bg-purple-600 hover:bg-purple-700 text-white'
                          : 'bg-slate-300 text-slate-500 cursor-not-allowed')}
                      title={offsetCandidate
                        ? 'Offset ' + offsetCandidate.currency + ' ' + offsetCandidate.offsetAmount.toFixed(2) +
                          ' — auto-applies oldest open sales invoice against oldest open vendor bill'
                        : 'No offsettable pair found. You need at least one open sales invoice + one open vendor bill in the same currency.'}>
                      🔄 Offset
                    </button>
                    <button onClick={function () { handlePrintLedger(a, 'internal'); }} className="px-2 py-1 bg-slate-700 hover:bg-slate-800 text-white text-[10px] font-extrabold rounded shadow" title="Print our internal view as PDF">🖨️ Print (Internal)</button>
                    <button onClick={function () { handlePrintLedger(a, 'customer'); }} className="px-2 py-1 bg-indigo-700 hover:bg-indigo-800 text-white text-[10px] font-extrabold rounded shadow" title="Print customer statement (their perspective) as PDF — for sending to the counterparty">🖨️ Customer Statement</button>
                    <button onClick={function () { handleExportExcel(a); }} className="px-2 py-1 bg-green-700 hover:bg-green-800 text-white text-[10px] font-extrabold rounded shadow" title="Download Excel file">📊 Excel</button>
                    {/* v55.83-A.6.27.66 (Issue 2, Max May 23 2026) — account-level
                        attachments. Stores files (contracts, master agreements,
                        signed docs) against the customer card itself, separate
                        from per-entry and per-invoice attachments. parent_type
                        used is 'open_account' — attachments table is extensible
                        by parent_type per the .61 migration, no SQL needed. */}
                    <button onClick={function () { setAttachAccountId(a.id); }} className="px-2 py-1 bg-slate-600 hover:bg-slate-700 text-white text-[10px] font-extrabold rounded shadow" title="Attach files to this customer (contracts, master agreements, etc.)">📎 Files</button>
                    <button onClick={function () { openEditAccount(a); }} className="px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-extrabold rounded shadow">Edit</button>
                    <button onClick={function () { deleteAccount(a); }} className="px-2 py-1 bg-red-700 hover:bg-red-800 text-white text-[10px] font-extrabold rounded shadow">Delete</button>
                  </div>
                )}
              </div>
              {a.notes && !collapsed && (
                <div className="px-4 pb-2 text-xs text-slate-700 italic">📝 {a.notes}</div>
              )}
            </div>

            {/* Card body — ledger table */}
            {!collapsed && (
              <div className="overflow-auto">
                {/* v55.83-A.6.27.72 — Per-currency tile strip showing the 4-pot model:
                    They owe us (open invoices) · We owe them (open bills) · Their prepaid · Our prepaid · Net.
                    Each currency in the account gets its own strip. */}
                {simResult.currencies.length > 0 && (
                  <div className="bg-slate-50 border-b border-slate-200 px-4 py-3 space-y-2">
                    {simResult.currencies.map(function (cur) {
                      var b = simResult.byCurrency[cur];
                      return (
                        <div key={cur} className="flex flex-wrap items-stretch gap-2">
                          <div className="px-2 py-1 bg-slate-800 text-white rounded font-mono font-extrabold text-xs flex items-center">{cur}</div>
                          <div className="flex-1 min-w-[120px] bg-blue-50 border border-blue-200 rounded px-2 py-1.5">
                            <div className="text-[9px] font-extrabold text-blue-900 uppercase tracking-wider">They owe us</div>
                            <div className="text-sm font-mono font-extrabold text-blue-900">{fmtNum(b.theirOpenInvoices)}</div>
                            <div className="text-[9px] text-blue-700">{b.openInvoices.length} open invoice{b.openInvoices.length === 1 ? '' : 's'}</div>
                          </div>
                          <div className="flex-1 min-w-[120px] bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                            <div className="text-[9px] font-extrabold text-amber-900 uppercase tracking-wider">We owe them</div>
                            <div className="text-sm font-mono font-extrabold text-amber-900">{fmtNum(b.ourOpenBills)}</div>
                            <div className="text-[9px] text-amber-700">{b.openBills.length} open bill{b.openBills.length === 1 ? '' : 's'}</div>
                          </div>
                          <div className="flex-1 min-w-[120px] bg-emerald-50 border border-emerald-200 rounded px-2 py-1.5" title="Money they've paid us with no invoice to apply it to yet">
                            <div className="text-[9px] font-extrabold text-emerald-900 uppercase tracking-wider">Their credit (prepaid)</div>
                            <div className="text-sm font-mono font-extrabold text-emerald-900">{fmtNum(b.theirPrepaid)}</div>
                          </div>
                          <div className="flex-1 min-w-[120px] bg-red-50 border border-red-200 rounded px-2 py-1.5" title="Money we've paid them with no bill to apply it to yet">
                            <div className="text-[9px] font-extrabold text-red-900 uppercase tracking-wider">Our credit (prepaid)</div>
                            <div className="text-sm font-mono font-extrabold text-red-900">{fmtNum(b.ourPrepaid)}</div>
                          </div>
                          <div className={'flex-1 min-w-[140px] rounded px-2 py-1.5 border-2 ' +
                            (b.netBalance > 0 ? 'bg-emerald-600 border-emerald-700 text-white' :
                             b.netBalance < 0 ? 'bg-red-600 border-red-700 text-white' :
                             'bg-slate-500 border-slate-600 text-white')}>
                            <div className="text-[9px] font-extrabold uppercase tracking-wider opacity-90">Net balance</div>
                            <div className="text-base font-mono font-extrabold">{fmtSigned(b.netBalance)}</div>
                            <div className="text-[9px] opacity-90">
                              {b.netBalance > 0.001 ? 'in our favor' : b.netBalance < -0.001 ? 'against us' : 'settled'}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {accEntries.length === 0 ? (
                  <div className="p-6 text-center text-slate-600 text-sm">
                    No entries yet. Click <strong>+ Entry</strong> to add the first one.
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-extrabold text-slate-900 border-b-2 border-slate-300">Date</th>
                        {/* v55.83-A.6.27.72 — Type column is the source of truth for what each row is.
                            5 transaction types + offset. Color-coded pill in body. */}
                        <th className="px-3 py-2 text-left text-xs font-extrabold text-slate-900 border-b-2 border-slate-300">Type</th>
                        <th className="px-3 py-2 text-left text-xs font-extrabold text-slate-900 border-b-2 border-slate-300">Description</th>
                        <th className="px-3 py-2 text-left text-xs font-extrabold text-slate-900 border-b-2 border-slate-300">Reference</th>
                        <th className="px-3 py-2 text-center text-xs font-extrabold text-slate-900 border-b-2 border-slate-300">Currency</th>
                        {/* v55.83-A.6.27.72 HOTFIX 11 — Standard accounting layout: AR Side / AP Side.
                            Groups each row by which ledger account it affects (NOT by cash-flow direction).
                            All values positive. Type column tells you whether the row INCREASES the side
                            (Sales Invoice / Vendor Bill) or REDUCES it (Payment Received / Payment Sent). */}
                        <th className="px-3 py-2 text-right text-xs font-extrabold text-emerald-900 border-b-2 border-slate-300 bg-emerald-50" title="Activity on the Accounts Receivable side — sales invoices billed to them and payments they sent us">AR Side</th>
                        <th className="px-3 py-2 text-right text-xs font-extrabold text-red-900 border-b-2 border-slate-300 bg-red-50" title="Activity on the Accounts Payable side — vendor bills they billed us and payments we sent them">AP Side</th>
                        {/* Single Remaining column — fills only on invoice/bill rows with unsettled balance. */}
                        <th className="px-3 py-2 text-right text-xs font-extrabold text-amber-900 border-b-2 border-slate-300 bg-amber-50" title="Open balance still unsettled on this row (only applies to sales invoices and vendor bills)">Remaining</th>
                        {/* v55.83-A.6.27.72 HOTFIX 11 — "Net" renamed to "Running Balance" (these are
                            cumulative running balances after each row, NOT per-row nets). */}
                        {s.currencies.map(function (cur) {
                          return <th key={cur} className="px-3 py-2 text-right text-xs font-extrabold text-slate-900 border-b-2 border-slate-300 bg-slate-100" title="Cumulative running balance in this currency after this row">Running Balance {cur}</th>;
                        })}
                        {canEdit && <th className="px-3 py-2 text-right text-xs font-extrabold text-slate-900 border-b-2 border-slate-300">Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {accEntries.map(function (entry) {
                        var entryCur = entry._currency;
                        // v55.83-A.6.27.72 — derive transaction type info
                        var txnType = entry.transaction_type;
                        if (!txnType) {
                          // Fallback for old rows without transaction_type set
                          var hasCredit = Number(entry.credit_amount || 0) > 0;
                          var hasInvoice = !!entry.linked_open_invoice_id;
                          if (hasCredit && hasInvoice) txnType = 'sales_invoice';
                          else if (!hasCredit && hasInvoice) txnType = 'vendor_bill';
                          else if (hasCredit) txnType = 'payment_received';
                          else txnType = 'payment_sent';
                        }
                        var typeMeta = TRANSACTION_TYPES[txnType] || TRANSACTION_TYPES.credit_adjustment;
                        var pr = computePaidRemaining(entry, simResult);
                        var rowTint = typeMeta.rowCls || '';
                        return (
                          <tr key={entry.id} className={'border-b border-slate-200 hover:bg-slate-50 ' + rowTint}>
                            <td className="px-3 py-1.5 font-mono text-slate-900">{fmtDate(entry.entry_date)}</td>
                            <td className="px-3 py-1.5">
                              <span className={'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-extrabold whitespace-nowrap ' + typeMeta.pillCls}>
                                <span>{typeMeta.icon}</span>
                                <span>{typeMeta.label}</span>
                              </span>
                            </td>
                            <td className="px-3 py-1.5 text-slate-900">
                              {entry.linked_open_invoice_id ? (
                                <button
                                  onClick={function () { openInvoiceFromEntry(entry); }}
                                  className="text-left hover:underline focus:underline w-full"
                                  title="This entry was auto-created from an invoice. Click to open the invoice."
                                >
                                  <div className="font-bold flex items-center gap-1">
                                    <span className="text-[10px] bg-blue-100 text-blue-900 px-1 rounded font-bold">📄 INV</span>
                                    <span>{entry.description}</span>
                                  </div>
                                </button>
                              ) : (
                                <div className="font-bold">{entry.description}</div>
                              )}
                              {entry.notes && <div className="text-[10px] text-slate-600 italic">{entry.notes}</div>}
                            </td>
                            <td className="px-3 py-1.5 font-mono text-slate-700">{entry.reference_number || '—'}</td>
                            <td className="px-3 py-1.5 text-center font-mono font-bold text-slate-800 text-[11px]">{entryCur}</td>
                            {/* v55.83-A.6.27.72 HOTFIX 11 — Standard accounting two-column display.
                                AR Side (emerald): all activity affecting Accounts Receivable.
                                AP Side (red): all activity affecting Accounts Payable.
                                All values positive — direction (increase vs decrease) is shown by Type. */}
                            <td className="px-3 py-1.5 text-right font-mono font-extrabold text-emerald-800 bg-emerald-50/30">
                              {(function () {
                                var s = arApSide(entry);
                                return s.ar > 0.005 ? fmtNum(s.ar) : <span className="text-slate-300">—</span>;
                              })()}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono font-extrabold text-red-700 bg-red-50/30">
                              {(function () {
                                var s = arApSide(entry);
                                return s.ap > 0.005 ? fmtNum(s.ap) : <span className="text-slate-300">—</span>;
                              })()}
                            </td>
                            {/* Remaining — single column, fills only on invoice/bill rows with unsettled balance.
                                Color matches the side (emerald for AR, red for AP) so direction is still clear. */}
                            <td className="px-3 py-1.5 text-right font-mono font-extrabold bg-amber-50">
                              {(function () {
                                if (txnType !== 'sales_invoice' && txnType !== 'vendor_bill') {
                                  return <span className="text-slate-300">—</span>;
                                }
                                if (pr.remaining < 0.005) {
                                  return <span className="text-emerald-600 text-[10px]" title="Fully settled">✓ paid</span>;
                                }
                                var cls = txnType === 'sales_invoice' ? 'text-emerald-900' : 'text-red-900';
                                return <span className={cls}>{fmtNum(pr.remaining)}</span>;
                              })()}
                            </td>
                            {/* Net per currency — running net balance from the simulation */}
                            {s.currencies.map(function (cur) {
                              var rbForCur = (entry._running_by_currency && entry._running_by_currency[cur]) || 0;
                              var isThisEntryCur = (cur === entryCur);
                              return (
                                <td
                                  key={cur}
                                  className={'px-3 py-1.5 text-right font-mono font-extrabold ' +
                                    (isThisEntryCur ? 'bg-slate-100 ' : 'text-slate-400 ') +
                                    (rbForCur > 0 ? 'text-emerald-800' : rbForCur < 0 ? 'text-red-700' : 'text-slate-500')}
                                >
                                  {fmtSigned(rbForCur)}
                                </td>
                              );
                            })}
                            {canEdit && (
                              <td className="px-3 py-1.5 text-right">
                                {entry.linked_open_invoice_id ? (
                                  <button
                                    onClick={function () { openInvoiceFromEntry(entry); }}
                                    className="px-2 py-0.5 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold rounded"
                                    title="This entry is auto-synced from an invoice. Open the invoice to edit or delete."
                                  >Open Inv</button>
                                ) : (
                                  <>
                                    <button onClick={function () { openEditEntry(entry); }} className="px-2 py-0.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold rounded mr-1">Edit</button>
                                    <button onClick={function () { deleteEntry(entry); }} className="px-2 py-0.5 bg-red-700 hover:bg-red-800 text-white text-[10px] font-bold rounded">Del</button>
                                  </>
                                )}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                      {/* v55.83-A.6.27.72 HOTFIX 11 — Per-currency Summary block.
                          Replaces the cluttered single-row totals with the format from the spec:
                            <CUR> Summary:
                              Total AR (They Owe Us): X
                              Total AP (We Owe Them): Y
                              Net <CUR> Position: X − Y
                          Each currency gets its own 3-line block. AR and AP are NEVER mixed. */}
                      {s.currencies.map(function (cur) {
                        var cs = s.byCurrency[cur];
                        var curEntries = (accEntries || []).filter(function (e) {
                          var ec = String(e.currency || 'USD').toUpperCase().trim();
                          return ec === cur;
                        });
                        var totalAR = 0;
                        var totalAP = 0;
                        curEntries.forEach(function (e) {
                          if (e.transaction_type === 'sales_invoice' || e.transaction_type === 'vendor_bill') {
                            var prT = computePaidRemaining(e, simResult);
                            if (e.transaction_type === 'sales_invoice') totalAR += prT.remaining;
                            else totalAP += prT.remaining;
                          }
                        });
                        var net = totalAR - totalAP;
                        var netCls = net > 0.005 ? 'text-emerald-300' : net < -0.005 ? 'text-red-300' : 'text-slate-200';
                        var netSubLabel = net > 0.005 ? 'in our favor' : net < -0.005 ? 'against us' : 'settled';
                        // colSpan calculation: 4 left text cols + 3 money cols + N currency cols + actions
                        var totalCols = 4 + 3 + s.currencies.length + (canEdit ? 1 : 0);
                        return [
                          // Header row
                          <tr key={cur + '-sumhead'} className="bg-slate-900 text-white">
                            <td colSpan={totalCols} className="px-3 py-1.5 text-left text-[11px] font-extrabold uppercase tracking-widest border-t-2 border-slate-600">
                              {cur} Summary
                            </td>
                          </tr>,
                          // Total AR row
                          <tr key={cur + '-ar'} className="bg-slate-800 text-white">
                            <td colSpan={4} className="px-3 py-1 text-right text-xs text-slate-200">Total AR (They Owe Us)</td>
                            <td className="px-3 py-1 text-right font-mono font-extrabold bg-emerald-900/30">
                              {totalAR > 0.005 ? fmtNum(totalAR) + ' ' + cur : <span className="text-slate-400">0.00 {cur}</span>}
                            </td>
                            <td colSpan={2 + s.currencies.length + (canEdit ? 1 : 0)}></td>
                          </tr>,
                          // Total AP row
                          <tr key={cur + '-ap'} className="bg-slate-800 text-white">
                            <td colSpan={4} className="px-3 py-1 text-right text-xs text-slate-200">Total AP (We Owe Them)</td>
                            <td className="px-3 py-1"></td>
                            <td className="px-3 py-1 text-right font-mono font-extrabold bg-red-900/30">
                              {totalAP > 0.005 ? fmtNum(totalAP) + ' ' + cur : <span className="text-slate-400">0.00 {cur}</span>}
                            </td>
                            <td colSpan={1 + s.currencies.length + (canEdit ? 1 : 0)}></td>
                          </tr>,
                          // Net Position row — the spelled-out arithmetic
                          <tr key={cur + '-net'} className="bg-slate-950 text-white">
                            <td colSpan={4} className="px-3 py-2 text-right text-xs font-extrabold uppercase tracking-wider">
                              Net {cur} Position — Total AR − Total AP →
                            </td>
                            <td colSpan={3} className={'px-3 py-2 text-right font-mono font-extrabold text-base ' + netCls}>
                              {fmtNum(totalAR)} − {fmtNum(totalAP)} = <span className="ml-1">{fmtSigned(net)} {cur}</span>
                              <div className="text-[10px] font-bold opacity-80 mt-0.5">
                                {net > 0.005 ? '↑ in our favor' : net < -0.005 ? '↓ against us' : 'settled'}
                              </div>
                            </td>
                            {/* Running balance final value in its currency column */}
                            {s.currencies.map(function (col, colI) {
                              if (col !== cur) return <td key={col + '-nf-' + colI}></td>;
                              return (
                                <td key={col + '-nf-' + colI} className={'px-3 py-2 text-right font-mono font-extrabold ' + netCls}>
                                  {fmtSigned(cs.balance)}
                                </td>
                              );
                            })}
                            {canEdit && <td></td>}
                          </tr>,
                        ];
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* ─── Account modal ────────────────────────────────────────── */}
      {accountModalOpen && accountDraft && (
        <div className="fixed inset-0 z-[200] bg-black/70 flex items-start justify-center pt-10 px-4 overflow-y-auto" onClick={function () { if (!busy) { setAccountModalOpen(false); setAccountDraft(null); } }}>
          <div className="bg-white text-slate-900 rounded-2xl shadow-2xl w-full max-w-lg" onClick={function (e) { e.stopPropagation(); }}>
            <div className="bg-emerald-700 text-white rounded-t-2xl px-5 py-3">
              <div className="text-lg font-extrabold">{accountDraft.id ? '✏️ Edit Account' : '+ New Account'} / حساب</div>
            </div>
            <div className="p-5 space-y-3">
              <label className="block">
                <span className="text-xs font-extrabold text-slate-900">Account Name * / اسم الحساب</span>
                <input type="text" value={accountDraft.account_name} onChange={function (e) { setAccountDraft(Object.assign({}, accountDraft, { account_name: e.target.value })); }} className="w-full mt-1 px-3 py-2 border-2 border-slate-300 rounded text-sm bg-white text-slate-900 font-bold" />
              </label>
              <label className="block">
                <span className="text-xs font-extrabold text-slate-900">Account Name (Arabic) / اسم بالعربية</span>
                <input type="text" value={accountDraft.account_name_ar} onChange={function (e) { setAccountDraft(Object.assign({}, accountDraft, { account_name_ar: e.target.value })); }} className="w-full mt-1 px-3 py-2 border-2 border-slate-300 rounded text-sm bg-white text-slate-900 font-bold" style={{ direction: 'rtl' }} />
              </label>
              {/* v55.83-A.6.27.53 — Entity picker. Which KTC entity is the "us" side
                  for this account? Used on printed statements + invoice exports. */}
              <label className="block">
                <span className="text-xs font-extrabold text-slate-900">Our Entity for this Account * / كياننا</span>
                <select
                  value={accountDraft.business_entity_code || ''}
                  onChange={function (e) { setAccountDraft(Object.assign({}, accountDraft, { business_entity_code: e.target.value })); }}
                  className="w-full mt-1 px-3 py-2 border-2 border-slate-300 rounded text-sm bg-white text-slate-900 font-bold"
                >
                  {entities.length === 0 && <option value="">— No entities found (run SQL migration .53) —</option>}
                  {entities.map(function (en) {
                    return <option key={en.entity_code} value={en.entity_code}>{en.entity_name}{en.entity_name_ar ? ' / ' + en.entity_name_ar : ''}</option>;
                  })}
                </select>
                <span className="text-[10px] text-slate-600 mt-0.5 block">Which KTC entity is on this ledger&apos;s &quot;us&quot; side. Shown as the header on printed statements.</span>
              </label>
              <label className="block">
                <span className="text-xs font-extrabold text-slate-900">Notes (optional) / ملاحظات</span>
                <textarea value={accountDraft.notes} onChange={function (e) { setAccountDraft(Object.assign({}, accountDraft, { notes: e.target.value })); }} rows={2} className="w-full mt-1 px-3 py-2 border-2 border-slate-300 rounded text-sm bg-white text-slate-900" />
              </label>
            </div>
            <div className="border-t border-slate-200 px-5 py-3 flex justify-end gap-2 bg-slate-50 rounded-b-2xl">
              <button onClick={function () { setAccountModalOpen(false); setAccountDraft(null); }} disabled={busy} className="px-4 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 text-sm font-bold rounded disabled:opacity-50">Cancel</button>
              <button onClick={saveAccount} disabled={busy} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-extrabold rounded shadow disabled:opacity-50">{busy ? 'Saving...' : '💾 Save'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Entry modal ──────────────────────────────────────────── */}
      {entryModalOpen && entryDraft && (
        <div className="fixed inset-0 z-[210] bg-black/80 flex items-start justify-center pt-10 px-4 overflow-y-auto" onClick={function () { if (!busy) { setEntryModalOpen(false); setEntryDraft(null); } }}>
          <div className="bg-white text-slate-900 rounded-2xl shadow-2xl w-full max-w-xl" onClick={function (e) { e.stopPropagation(); }}>
            <div className="bg-indigo-700 text-white rounded-t-2xl px-5 py-3">
              <div className="text-lg font-extrabold">{entryDraft.id ? '✏️ Edit Entry' : '+ New Ledger Entry'} / إدخال</div>
              <div className="text-xs text-indigo-100 mt-0.5">v55.83-A.6.27.72 — Pick the transaction type first; the system handles the rest.</div>
            </div>
            <div className="p-5 space-y-3">
              {/* v55.83-A.6.27.72 — Transaction type picker. 5 types, each with its own
                  color + icon. The system uses this to know what to do with the row
                  (sales invoice creates an obligation, payment received settles invoices
                  oldest-first via FIFO, etc.) */}
              <div>
                <span className="text-xs font-extrabold text-slate-900 block mb-2">Transaction Type * / نوع المعاملة</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
                  <label className={'block border-2 rounded p-2 cursor-pointer text-center ' + (entryDraft.transaction_type === 'sales_invoice' ? 'border-blue-600 bg-blue-100' : 'border-slate-300 bg-white hover:bg-slate-50')}>
                    <input type="radio" name="txn_type" checked={entryDraft.transaction_type === 'sales_invoice'} onChange={function () { setEntryDraft(Object.assign({}, entryDraft, { transaction_type: 'sales_invoice' })); }} className="sr-only" />
                    <div className="text-lg">📤</div>
                    <div className="text-[11px] font-extrabold text-blue-900">Sales Invoice</div>
                    <div className="text-[9px] text-slate-600">We billed them</div>
                  </label>
                  <label className={'block border-2 rounded p-2 cursor-pointer text-center ' + (entryDraft.transaction_type === 'vendor_bill' ? 'border-amber-600 bg-amber-100' : 'border-slate-300 bg-white hover:bg-slate-50')}>
                    <input type="radio" name="txn_type" checked={entryDraft.transaction_type === 'vendor_bill'} onChange={function () { setEntryDraft(Object.assign({}, entryDraft, { transaction_type: 'vendor_bill' })); }} className="sr-only" />
                    <div className="text-lg">📥</div>
                    <div className="text-[11px] font-extrabold text-amber-900">Vendor Bill</div>
                    <div className="text-[9px] text-slate-600">They billed us</div>
                  </label>
                  <label className={'block border-2 rounded p-2 cursor-pointer text-center ' + (entryDraft.transaction_type === 'payment_received' ? 'border-emerald-600 bg-emerald-100' : 'border-slate-300 bg-white hover:bg-slate-50')}>
                    <input type="radio" name="txn_type" checked={entryDraft.transaction_type === 'payment_received'} onChange={function () { setEntryDraft(Object.assign({}, entryDraft, { transaction_type: 'payment_received' })); }} className="sr-only" />
                    <div className="text-lg">💰</div>
                    <div className="text-[11px] font-extrabold text-emerald-900">Payment Received</div>
                    <div className="text-[9px] text-slate-600">They paid us</div>
                  </label>
                  <label className={'block border-2 rounded p-2 cursor-pointer text-center ' + (entryDraft.transaction_type === 'payment_sent' ? 'border-red-600 bg-red-100' : 'border-slate-300 bg-white hover:bg-slate-50')}>
                    <input type="radio" name="txn_type" checked={entryDraft.transaction_type === 'payment_sent'} onChange={function () { setEntryDraft(Object.assign({}, entryDraft, { transaction_type: 'payment_sent' })); }} className="sr-only" />
                    <div className="text-lg">💸</div>
                    <div className="text-[11px] font-extrabold text-red-900">Payment Sent</div>
                    <div className="text-[9px] text-slate-600">We paid them</div>
                  </label>
                  <label className={'block border-2 rounded p-2 cursor-pointer text-center ' + (entryDraft.transaction_type === 'credit_adjustment' ? 'border-slate-600 bg-slate-200' : 'border-slate-300 bg-white hover:bg-slate-50')}>
                    <input type="radio" name="txn_type" checked={entryDraft.transaction_type === 'credit_adjustment'} onChange={function () { setEntryDraft(Object.assign({}, entryDraft, { transaction_type: 'credit_adjustment' })); }} className="sr-only" />
                    <div className="text-lg">⚖️</div>
                    <div className="text-[11px] font-extrabold text-slate-800">Adjustment</div>
                    <div className="text-[9px] text-slate-600">Manual fix</div>
                  </label>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-extrabold text-slate-900">Date * / التاريخ</span>
                  <input type="date" value={entryDraft.entry_date} onChange={function (e) { setEntryDraft(Object.assign({}, entryDraft, { entry_date: e.target.value })); }} className="w-full mt-1 px-3 py-2 border-2 border-slate-300 rounded text-sm bg-white text-slate-900 font-bold" />
                </label>
                <label className="block">
                  <span className="text-xs font-extrabold text-slate-900">Reference # / مرجع</span>
                  <input type="text" value={entryDraft.reference_number} onChange={function (e) { setEntryDraft(Object.assign({}, entryDraft, { reference_number: e.target.value })); }} placeholder="invoice #, payment #, etc." className="w-full mt-1 px-3 py-2 border-2 border-slate-300 rounded text-sm bg-white text-slate-900 font-mono" />
                </label>
              </div>
              <label className="block">
                <span className="text-xs font-extrabold text-slate-900">Description * / الوصف</span>
                <input type="text" value={entryDraft.description} onChange={function (e) { setEntryDraft(Object.assign({}, entryDraft, { description: e.target.value })); }} placeholder="e.g. Invoice for 50 rolls leather / Payment received via wire" className="w-full mt-1 px-3 py-2 border-2 border-slate-300 rounded text-sm bg-white text-slate-900 font-bold" />
              </label>
              <div className="grid grid-cols-3 gap-3">
                <label className="block col-span-2">
                  <span className="text-xs font-extrabold text-slate-900">Amount * / المبلغ</span>
                  <input type="number" step="0.01" min="0" value={entryDraft.amount} onChange={function (e) { setEntryDraft(Object.assign({}, entryDraft, { amount: e.target.value })); }} placeholder="positive number" className="w-full mt-1 px-3 py-2 border-2 border-slate-300 rounded text-base bg-white text-slate-900 font-bold" />
                </label>
                {/* v55.83-A.6.27.58 — Per-entry currency. Defaults from entity. */}
                <label className="block">
                  <span className="text-xs font-extrabold text-slate-900">Currency * / العملة</span>
                  <select
                    value={entryDraft.currency || 'USD'}
                    onChange={function (e) { setEntryDraft(Object.assign({}, entryDraft, { currency: e.target.value })); }}
                    className="w-full mt-1 px-3 py-2 border-2 border-slate-300 rounded text-base bg-white text-slate-900 font-extrabold"
                  >
                    <option value="USD">USD</option>
                    <option value="EGP">EGP</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                    <option value="AED">AED</option>
                    <option value="SAR">SAR</option>
                    <option value="CNY">CNY</option>
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="text-xs font-extrabold text-slate-900">Notes (optional) / ملاحظات</span>
                <textarea value={entryDraft.notes} onChange={function (e) { setEntryDraft(Object.assign({}, entryDraft, { notes: e.target.value })); }} rows={2} className="w-full mt-1 px-3 py-2 border-2 border-slate-300 rounded text-sm bg-white text-slate-900" />
              </label>

              {/* v55.83-A.6.27.61 — Attachments on ledger entries (only when editing — needs id).
                  Use case: warehouse manager attaches receipt PDF/photo to each expense entry. */}
              {entryDraft.id && (
                <AttachmentManager
                  parentType="open_account_entry"
                  parentId={entryDraft.id}
                  currentUserId={userProfile && userProfile.id}
                  isSuperAdmin={userProfile && userProfile.role === 'super_admin'}
                  canEdit={canEdit}
                />
              )}
              {!entryDraft.id && (
                <div className="text-[11px] text-slate-600 italic bg-slate-100 border border-slate-200 rounded p-2 mt-2">
                  💡 Save the entry first, then attach receipts (photos, PDFs) here.
                </div>
              )}
            </div>
            <div className="border-t border-slate-200 px-5 py-3 flex justify-end gap-2 bg-slate-50 rounded-b-2xl">
              <button onClick={function () { setEntryModalOpen(false); setEntryDraft(null); }} disabled={busy} className="px-4 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 text-sm font-bold rounded disabled:opacity-50">Cancel</button>
              <button onClick={saveEntry} disabled={busy} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-extrabold rounded shadow disabled:opacity-50">{busy ? 'Saving...' : '💾 Save Entry'}</button>
            </div>
          </div>
        </div>
      )}

      {/* v55.83-A.6.27.59 — Invoice modal */}
      {invoiceModalOpen && invoiceDraft && (() => {
        var totals = computeInvoiceTotals(invoiceDraft);
        var cur = invoiceDraft.currency || 'USD';
        return (
          <div className="fixed inset-0 bg-black/60 z-[120] flex items-center justify-center p-4 overflow-auto">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl my-4">
              {/* Modal header */}
              <div className="bg-gradient-to-r from-blue-700 to-indigo-700 text-white rounded-t-2xl px-5 py-3 flex justify-between items-center">
                <div>
                  <div className="text-lg font-extrabold">📄 {invoiceDraft.id ? 'Edit Invoice' : 'New Mini-Invoice'}</div>
                  <div className="text-xs font-semibold text-blue-100">
                    {invoiceDraft.id ? 'Editing — linked ledger entry will auto-sync on save' : 'Will auto-create a linked ledger entry on save'}
                  </div>
                </div>
                <button
                  onClick={function () { setInvoiceModalOpen(false); setInvoiceDraft(null); }}
                  aria-label="Close"
                  className="bg-white text-slate-800 w-9 h-9 rounded-full font-bold text-lg shadow"
                >✕</button>
              </div>

              <div className="px-5 py-4 space-y-4">

                {/* Direction toggle */}
                <div className="grid grid-cols-2 gap-3">
                  <label className={'border-2 rounded-lg p-3 cursor-pointer ' + (invoiceDraft.direction === 'credit' ? 'border-emerald-600 bg-emerald-50' : 'border-slate-300 bg-white')}>
                    <input
                      type="radio" name="direction" value="credit"
                      checked={invoiceDraft.direction === 'credit'}
                      onChange={function () { setInvoiceDraft(Object.assign({}, invoiceDraft, { direction: 'credit' })); }}
                      className="mr-2"
                    />
                    <span className="text-sm font-extrabold text-emerald-900">We&apos;re billing them</span>
                    <div className="text-[10px] text-slate-700 mt-1">Creates a CREDIT ledger entry (they owe us)</div>
                  </label>
                  <label className={'border-2 rounded-lg p-3 cursor-pointer ' + (invoiceDraft.direction === 'debit' ? 'border-red-600 bg-red-50' : 'border-slate-300 bg-white')}>
                    <input
                      type="radio" name="direction" value="debit"
                      checked={invoiceDraft.direction === 'debit'}
                      onChange={function () { setInvoiceDraft(Object.assign({}, invoiceDraft, { direction: 'debit' })); }}
                      className="mr-2"
                    />
                    <span className="text-sm font-extrabold text-red-900">They&apos;re billing us</span>
                    <div className="text-[10px] text-slate-700 mt-1">Creates a DEBIT ledger entry (we owe them)</div>
                  </label>
                </div>

                {/* Invoice meta row */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <label className="block">
                    <span className="text-xs font-extrabold text-slate-900">Invoice # * / رقم الفاتورة</span>
                    <input type="text" value={invoiceDraft.invoice_number} onChange={function (e) { setInvoiceDraft(Object.assign({}, invoiceDraft, { invoice_number: e.target.value })); }} placeholder="INV-2026-001" className="w-full mt-0.5 px-2 py-1.5 border-2 border-slate-300 rounded text-sm bg-white text-slate-900 font-mono font-bold" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-extrabold text-slate-900">Date * / التاريخ</span>
                    <input type="date" value={invoiceDraft.invoice_date} onChange={function (e) { setInvoiceDraft(Object.assign({}, invoiceDraft, { invoice_date: e.target.value })); }} className="w-full mt-0.5 px-2 py-1.5 border-2 border-slate-300 rounded text-sm bg-white text-slate-900" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-extrabold text-slate-900">Due Date / تاريخ الاستحقاق</span>
                    <input type="date" value={invoiceDraft.due_date} onChange={function (e) { setInvoiceDraft(Object.assign({}, invoiceDraft, { due_date: e.target.value })); }} className="w-full mt-0.5 px-2 py-1.5 border-2 border-slate-300 rounded text-sm bg-white text-slate-900" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-extrabold text-slate-900">Currency * / العملة</span>
                    <select value={cur} onChange={function (e) { setInvoiceDraft(Object.assign({}, invoiceDraft, { currency: e.target.value })); }} className="w-full mt-0.5 px-2 py-1.5 border-2 border-slate-300 rounded text-sm bg-white text-slate-900 font-extrabold">
                      <option value="USD">USD</option>
                      <option value="EGP">EGP</option>
                      <option value="EUR">EUR</option>
                      <option value="GBP">GBP</option>
                      <option value="AED">AED</option>
                      <option value="SAR">SAR</option>
                      <option value="CNY">CNY</option>
                    </select>
                  </label>
                </div>

                {/* Counterparty info */}
                <div className="bg-slate-50 border border-slate-200 rounded p-3 space-y-2">
                  <div className="text-[11px] font-extrabold text-slate-700 tracking-wider">
                    {invoiceDraft.direction === 'credit' ? 'BILL TO (counterparty)' : 'BILL FROM (counterparty)'} / الطرف الآخر
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="text-xs font-bold text-slate-700">Name * / الاسم</span>
                      <input type="text" value={invoiceDraft.counterparty_name} onChange={function (e) { setInvoiceDraft(Object.assign({}, invoiceDraft, { counterparty_name: e.target.value })); }} className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white text-slate-900 font-semibold" />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold text-slate-700">Name (Arabic) / بالعربية</span>
                      <input type="text" value={invoiceDraft.counterparty_name_ar} onChange={function (e) { setInvoiceDraft(Object.assign({}, invoiceDraft, { counterparty_name_ar: e.target.value })); }} className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white text-slate-900" style={{ direction: 'rtl' }} />
                    </label>
                  </div>
                  <label className="block">
                    <span className="text-xs font-bold text-slate-700">Address / العنوان</span>
                    <textarea value={invoiceDraft.counterparty_address} onChange={function (e) { setInvoiceDraft(Object.assign({}, invoiceDraft, { counterparty_address: e.target.value })); }} rows={2} className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white text-slate-900 resize-none" />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="text-xs font-bold text-slate-700">Phone / الهاتف</span>
                      <input type="text" value={invoiceDraft.counterparty_phone} onChange={function (e) { setInvoiceDraft(Object.assign({}, invoiceDraft, { counterparty_phone: e.target.value })); }} className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white text-slate-900 font-mono" />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold text-slate-700">Email / البريد</span>
                      <input type="email" value={invoiceDraft.counterparty_email} onChange={function (e) { setInvoiceDraft(Object.assign({}, invoiceDraft, { counterparty_email: e.target.value })); }} className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white text-slate-900 font-mono" />
                    </label>
                  </div>
                </div>

                {/* Line items */}
                <div>
                  <div className="text-[11px] font-extrabold text-slate-700 tracking-wider mb-1">LINE ITEMS / البنود</div>
                  <div className="border-2 border-slate-200 rounded overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-100">
                        <tr>
                          <th className="px-2 py-1.5 text-left text-[10px] font-extrabold text-slate-900">Description</th>
                          <th className="px-2 py-1.5 text-right text-[10px] font-extrabold text-slate-900" style={{ width: 100 }}>Qty</th>
                          <th className="px-2 py-1.5 text-right text-[10px] font-extrabold text-slate-900" style={{ width: 130 }}>Unit Price ({cur})</th>
                          <th className="px-2 py-1.5 text-right text-[10px] font-extrabold text-slate-900" style={{ width: 130 }}>Line Total</th>
                          <th style={{ width: 36 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {(invoiceDraft.items || []).map(function (it, idx) {
                          var qty = Number(it.quantity || 0);
                          var unit = Number(it.unit_price || 0);
                          var line = qty * unit;
                          return (
                            <tr key={idx} className="border-b border-slate-200">
                              <td className="px-2 py-1">
                                <input type="text" value={it.description || ''} onChange={function (e) { setInvoiceItemField(idx, 'description', e.target.value); }} placeholder="e.g. Premium leather panels" className="w-full px-2 py-1 border border-slate-300 rounded text-sm bg-white text-slate-900" />
                              </td>
                              <td className="px-2 py-1">
                                <input type="number" step="0.001" min="0" value={it.quantity || ''} onChange={function (e) { setInvoiceItemField(idx, 'quantity', e.target.value); }} className="w-full px-2 py-1 border border-slate-300 rounded text-sm bg-white text-slate-900 text-right font-mono" />
                              </td>
                              <td className="px-2 py-1">
                                <input type="number" step="0.01" min="0" value={it.unit_price || ''} onChange={function (e) { setInvoiceItemField(idx, 'unit_price', e.target.value); }} className="w-full px-2 py-1 border border-slate-300 rounded text-sm bg-white text-slate-900 text-right font-mono" />
                              </td>
                              <td className="px-2 py-1 text-right font-mono font-bold text-slate-900">
                                {line > 0 ? line.toFixed(2) : '—'}
                              </td>
                              <td className="px-1 py-1 text-center">
                                <button onClick={function () { removeInvoiceItem(idx); }} className="text-red-600 hover:text-red-800 font-bold text-base" title="Remove this line">✕</button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <button onClick={addInvoiceItem} className="w-full px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-extrabold border-t border-slate-200">
                      + Add Line Item / إضافة بند
                    </button>
                  </div>
                </div>

                {/* Totals + Shipping + Tax */}
                <div className="grid grid-cols-2 gap-4">
                  {/* Left: Tax & Shipping */}
                  <div className="space-y-2">
                    <label className="block">
                      <span className="text-xs font-extrabold text-slate-900">Shipping / الشحن (optional)</span>
                      <div className="flex items-center gap-1 mt-0.5">
                        <input type="number" step="0.01" min="0" value={invoiceDraft.shipping_amount} onChange={function (e) { setInvoiceDraft(Object.assign({}, invoiceDraft, { shipping_amount: e.target.value })); }} placeholder="0.00" className="flex-1 px-2 py-1.5 border-2 border-slate-300 rounded text-sm bg-white text-slate-900 text-right font-mono" />
                        <span className="text-xs font-bold text-slate-600">{cur}</span>
                      </div>
                    </label>
                    {/* Tax opt-in */}
                    <label className="flex items-center gap-2 mt-2 cursor-pointer">
                      <input type="checkbox" checked={!!invoiceDraft.tax_enabled} onChange={function (e) { setInvoiceDraft(Object.assign({}, invoiceDraft, { tax_enabled: e.target.checked, tax_rate_pct: e.target.checked ? (invoiceDraft.tax_rate_pct || '14') : '' })); }} />
                      <span className="text-xs font-extrabold text-slate-900">Apply tax / تطبيق الضريبة</span>
                      <span className="text-[10px] text-slate-600 italic">(optional, off by default)</span>
                    </label>
                    {invoiceDraft.tax_enabled && (
                      <label className="block">
                        <span className="text-xs font-extrabold text-slate-900">Tax Rate (%) / نسبة الضريبة</span>
                        <div className="flex items-center gap-1 mt-0.5">
                          <input type="number" step="0.001" min="0" max="100" value={invoiceDraft.tax_rate_pct} onChange={function (e) { setInvoiceDraft(Object.assign({}, invoiceDraft, { tax_rate_pct: e.target.value })); }} placeholder="e.g. 14 for VAT" className="flex-1 px-2 py-1.5 border-2 border-slate-300 rounded text-sm bg-white text-slate-900 text-right font-mono" />
                          <span className="text-xs font-bold text-slate-600">%</span>
                        </div>
                      </label>
                    )}
                  </div>
                  {/* Right: Totals */}
                  <div className="bg-slate-50 border border-slate-300 rounded p-3 space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-700 font-semibold">Subtotal</span>
                      <span className="font-mono font-bold text-slate-900">{totals.subtotal.toFixed(2)} {cur}</span>
                    </div>
                    {Number(invoiceDraft.shipping_amount || 0) > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-700 font-semibold">Shipping</span>
                        <span className="font-mono font-bold text-slate-900">{Number(invoiceDraft.shipping_amount).toFixed(2)} {cur}</span>
                      </div>
                    )}
                    {invoiceDraft.tax_enabled && totals.taxAmount > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-700 font-semibold">Tax ({invoiceDraft.tax_rate_pct}%)</span>
                        <span className="font-mono font-bold text-slate-900">{totals.taxAmount.toFixed(2)} {cur}</span>
                      </div>
                    )}
                    <div className="border-t-2 border-slate-400 mt-1 pt-1 flex justify-between text-base">
                      <span className="font-extrabold text-slate-900">TOTAL</span>
                      <span className="font-mono font-extrabold text-slate-900">{totals.total.toFixed(2)} {cur}</span>
                    </div>
                    <div className="text-[10px] text-slate-600 italic mt-1">
                      Ledger entry will be a {invoiceDraft.direction === 'credit' ? 'CREDIT (they owe us)' : 'DEBIT (we owe them)'} of {totals.total.toFixed(2)} {cur}
                    </div>
                  </div>
                </div>

                {/* Notes + Terms */}
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-xs font-extrabold text-slate-900">Payment Terms / شروط الدفع</span>
                    <input type="text" value={invoiceDraft.terms} onChange={function (e) { setInvoiceDraft(Object.assign({}, invoiceDraft, { terms: e.target.value })); }} placeholder="e.g. Net 30" className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white text-slate-900" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-extrabold text-slate-900">Notes / ملاحظات</span>
                    <input type="text" value={invoiceDraft.notes} onChange={function (e) { setInvoiceDraft(Object.assign({}, invoiceDraft, { notes: e.target.value })); }} className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white text-slate-900" />
                  </label>
                </div>

                {/* v55.83-A.6.27.61 — Attachments (only when invoice is saved — needs an id) */}
                {invoiceDraft.id && (
                  <AttachmentManager
                    parentType="open_account_invoice"
                    parentId={invoiceDraft.id}
                    currentUserId={userProfile && userProfile.id}
                    isSuperAdmin={userProfile && userProfile.role === 'super_admin'}
                    canEdit={canEdit}
                  />
                )}
                {!invoiceDraft.id && (
                  <div className="text-[11px] text-slate-600 italic bg-slate-100 border border-slate-200 rounded p-2">
                    💡 Save the invoice first, then attach files (PDFs, photos, supporting docs) here.
                  </div>
                )}
              </div>

              {/* Modal footer */}
              <div className="border-t border-slate-200 px-5 py-3 flex justify-end gap-2 bg-slate-50 rounded-b-2xl flex-wrap">
                <button onClick={function () { setInvoiceModalOpen(false); setInvoiceDraft(null); }} disabled={busy} className="px-4 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 text-sm font-bold rounded disabled:opacity-50">Cancel</button>
                {invoiceDraft.id && (
                  <>
                    <button onClick={function () { handlePrintInvoice(Object.assign({}, invoiceDraft, { subtotal: totals.subtotal, tax_amount: totals.taxAmount, total_amount: totals.total })); }} disabled={busy} className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-extrabold rounded shadow disabled:opacity-50" title="Print or save as PDF">🖨️ Print</button>
                    <button onClick={function () {
                      var inv = invoices.find(function (i) { return i.id === invoiceDraft.id; });
                      if (inv) { setInvoiceModalOpen(false); setInvoiceDraft(null); deleteInvoice(inv); }
                    }} disabled={busy} className="px-4 py-2 bg-red-700 hover:bg-red-800 text-white text-sm font-extrabold rounded shadow disabled:opacity-50">🗑️ Delete Invoice</button>
                  </>
                )}
                <button onClick={saveInvoice} disabled={busy} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-extrabold rounded shadow disabled:opacity-50">{busy ? 'Saving...' : '💾 Save Invoice'}</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* v55.83-A.6.27.66 (Issue 2, Max May 23 2026) — Account-level attachments
          modal. Opens when 📎 Files is clicked on a customer card row. Stores
          contracts, master agreements, signed documents, vendor profile docs
          at the account level (separate from per-entry and per-invoice
          attachments). parent_type='open_account' uses the .61 attachments
          table's extensibility — no SQL needed. */}
      {attachAccountId && (() => {
        var acc = accounts.find(function (a) { return a.id === attachAccountId; });
        if (!acc) return null;
        return (
          <div className="fixed inset-0 z-[210] bg-black/80 flex items-start justify-center pt-10 px-4 overflow-y-auto" onClick={function () { setAttachAccountId(null); }}>
            <div className="bg-white text-slate-900 rounded-2xl shadow-2xl w-full max-w-2xl" onClick={function (e) { e.stopPropagation(); }}>
              <div className="bg-slate-700 text-white rounded-t-2xl px-5 py-3 flex items-center justify-between">
                <div>
                  <div className="text-lg font-extrabold">📎 Account Files — {acc.account_name || '(unnamed)'}</div>
                  <div className="text-xs text-slate-200 mt-0.5">Contracts, agreements, vendor docs — anything that lives at the customer level (not on a single entry or invoice).</div>
                </div>
                <button onClick={function () { setAttachAccountId(null); }} className="text-2xl text-white hover:text-slate-200 leading-none">×</button>
              </div>
              <div className="p-5">
                <AttachmentManager
                  parentType="open_account"
                  parentId={acc.id}
                  currentUserId={userProfile && userProfile.id}
                  isSuperAdmin={userProfile && userProfile.role === 'super_admin'}
                  canEdit={canEdit}
                />
              </div>
              <div className="border-t border-slate-200 px-5 py-3 flex justify-end bg-slate-50 rounded-b-2xl">
                <button onClick={function () { setAttachAccountId(null); }} className="px-4 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 text-sm font-bold rounded">Close</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
