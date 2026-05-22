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

function fmtNum(n) {
  if (n == null || isNaN(Number(n))) return '—';
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(s) {
  if (!s) return '—';
  try { return new Date(s).toISOString().substring(0, 10); } catch (e) { return s; }
}

export default function OpenAccountsTab(props) {
  var userProfile = props.userProfile;
  var modulePerms = props.modulePerms || {};
  var isSuperAdmin = props.isSuperAdmin === true;
  var toast = props.toast || { success: function(){}, error: function(){}, warning: function(){}, info: function(){} };

  // Permission gates
  var canView = isSuperAdmin || modulePerms['Open Accounts'] === true;
  var canEdit = isSuperAdmin || modulePerms['Open Accounts'] === true;

  // Data
  var [accounts, setAccounts] = useState([]);
  var [entries, setEntries] = useState([]);
  // v55.83-A.6.27.53 — entities for branding on prints + Excel exports
  var [entities, setEntities] = useState([]);
  var [loading, setLoading] = useState(true);
  var [error, setError] = useState(null);

  // UI state
  var [collapsedAccounts, setCollapsedAccounts] = useState({}); // { account_id: true } when collapsed
  var [accountModalOpen, setAccountModalOpen] = useState(false);
  var [accountDraft, setAccountDraft] = useState(null); // null | { id?, account_name, account_name_ar, notes }
  var [entryModalOpen, setEntryModalOpen] = useState(false);
  var [entryDraft, setEntryDraft] = useState(null); // null | { id?, account_id, entry_date, description, reference_number, credit_amount, debit_amount, notes }
  var [busy, setBusy] = useState(false);
  var [search, setSearch] = useState('');

  useEffect(function () {
    if (!canView) { setLoading(false); return; }
    var cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        var [accRes, entRes, bizRes] = await Promise.all([
          supabase.from('open_accounts').select('*').order('account_name'),
          supabase.from('open_account_entries').select('*').order('entry_date', { ascending: true }).order('created_at', { ascending: true }),
          supabase.from('business_entities').select('*').eq('active', true).order('display_order'),
        ]);
        if (cancelled) return;
        if (accRes.error) throw accRes.error;
        if (entRes.error) throw entRes.error;
        // bizRes errors gracefully — if migration .53 hasn't been run, we just have no entities
        if (bizRes && !bizRes.error) setEntities(bizRes.data || []);
        else if (bizRes && bizRes.error) console.warn('[open-accounts] business_entities not loaded:', bizRes.error.message);
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
    // v55.83-A.6.27.58 — Per-currency running balance.
    // Walk each account's entries (already sorted by date asc then created_at
    // asc from the DB query). For each entry, track a separate running balance
    // per currency. Each entry gets:
    //   entry._currency           — its own currency (normalized, defaults USD)
    //   entry._running_by_currency — full map of all running balances after this entry
    //                                (so the ledger table can show parallel running
    //                                columns for every currency in this account)
    Object.keys(byAcc).forEach(function (accId) {
      var arr = byAcc[accId];
      var running = {}; // currency code → running balance
      arr.forEach(function (entry) {
        var cur = String(entry.currency || 'USD').toUpperCase().trim() || 'USD';
        entry._currency = cur;
        var credit = Number(entry.credit_amount || 0);
        var debit = Number(entry.debit_amount || 0);
        if (!(cur in running)) running[cur] = 0;
        running[cur] += credit - debit;
        // Snapshot all running balances after this entry (deep copy)
        entry._running_by_currency = Object.assign({}, running);
        // Back-compat: legacy code referenced _running_balance singular — keep
        // a "for this entry's currency only" value for any old consumer.
        entry._running_balance = running[cur];
      });
    });
    return byAcc;
  }, [accounts, entries]);

  // v55.83-A.6.27.58 — Per-currency summary.
  // Returns { byCurrency: { USD: {credit, debit, balance, count}, EGP: {...} },
  //           currencies: ['USD', 'EGP'],   // sorted, only currencies present
  //           totalEntryCount: N }
  // Back-compat fields totalCredit/totalDebit/balance are kept as the SUM ACROSS
  // ALL CURRENCIES (which is meaningless for display — UI should not show this —
  // but old code that hasn't been migrated still calls them).
  function summaryFor(accountId) {
    var arr = entriesByAccount[accountId] || [];
    var byCur = {};
    arr.forEach(function (e) {
      var cur = e._currency || String(e.currency || 'USD').toUpperCase().trim() || 'USD';
      if (!byCur[cur]) byCur[cur] = { credit: 0, debit: 0, balance: 0, count: 0 };
      var credit = Number(e.credit_amount || 0);
      var debit = Number(e.debit_amount || 0);
      byCur[cur].credit += credit;
      byCur[cur].debit += debit;
      byCur[cur].count += 1;
    });
    Object.keys(byCur).forEach(function (cur) {
      byCur[cur].balance = byCur[cur].credit - byCur[cur].debit;
    });
    // Sort currencies — USD first if present (most common), then alphabetical
    var currencies = Object.keys(byCur).sort(function (a, b) {
      if (a === 'USD' && b !== 'USD') return -1;
      if (b === 'USD' && a !== 'USD') return 1;
      return a.localeCompare(b);
    });
    // Back-compat aggregates (DO NOT use for display — sums different currencies)
    var legacyCredit = 0, legacyDebit = 0;
    currencies.forEach(function (cur) {
      legacyCredit += byCur[cur].credit;
      legacyDebit += byCur[cur].debit;
    });
    return {
      byCurrency: byCur,
      currencies: currencies,
      totalEntryCount: arr.length,
      // Legacy fields — back-compat only
      totalCredit: legacyCredit,
      totalDebit: legacyDebit,
      balance: legacyCredit - legacyDebit,
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
  function handlePrintLedger(account) {
    var ent = entityFor(account);
    var rows = entriesByAccount[account.id] || [];
    var s = summaryFor(account.id);
    printAccountLedger(account, ent, rows, s);
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
    // v55.83-A.6.27.58 — default currency from the account's entity
    var acc = accounts.find(function (a) { return a.id === accountId; });
    var ent = acc ? entityFor(acc) : null;
    var defaultCur = (ent && ent.default_currency) || 'USD';
    setEntryDraft({
      account_id: accountId,
      entry_date: today,
      description: '',
      reference_number: '',
      side: 'credit',          // 'credit' or 'debit' — UI choice
      amount: '',              // user enters amount in one box
      currency: defaultCur,    // v55.83-A.6.27.58 — per-entry currency
      notes: '',
    });
    setEntryModalOpen(true);
  }
  function openEditEntry(entry) {
    setEntryDraft({
      id: entry.id,
      account_id: entry.account_id,
      entry_date: entry.entry_date,
      description: entry.description || '',
      reference_number: entry.reference_number || '',
      side: (Number(entry.credit_amount || 0) > 0) ? 'credit' : 'debit',
      amount: String(entry.credit_amount || entry.debit_amount || ''),
      currency: String(entry.currency || 'USD').toUpperCase(),  // v55.83-A.6.27.58
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
    // v55.83-A.6.27.58 — currency validation
    var cur = String(entryDraft.currency || 'USD').toUpperCase().trim();
    if (cur.length < 2) { alert('Currency code is required / كود العملة مطلوب'); return; }
    setBusy(true);
    try {
      var payload = {
        account_id: entryDraft.account_id,
        entry_date: entryDraft.entry_date,
        description: desc,
        reference_number: (entryDraft.reference_number || '').trim() || null,
        credit_amount: entryDraft.side === 'credit' ? amt : null,
        debit_amount: entryDraft.side === 'debit' ? amt : null,
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
    if (!confirm('Delete this entry? This cannot be undone.\n\nحذف هذا الإدخال؟')) return;
    setBusy(true);
    try {
      await supabase.from('open_account_entries').delete().eq('id', entry.id);
      toast.success('Entry deleted');
      await reload();
    } catch (e) {
      console.error('[open-accounts] deleteEntry failed:', e);
      toast.error('Failed to delete entry: ' + ((e && e.message) || String(e)));
    } finally {
      setBusy(false);
    }
  }
  async function reload() {
    try {
      var [accRes, entRes, bizRes] = await Promise.all([
        supabase.from('open_accounts').select('*').order('account_name'),
        supabase.from('open_account_entries').select('*').order('entry_date', { ascending: true }).order('created_at', { ascending: true }),
        supabase.from('business_entities').select('*').eq('active', true).order('display_order'),
      ]);
      setAccounts(accRes.data || []);
      setEntries(entRes.data || []);
      if (bizRes && !bizRes.error) setEntities(bizRes.data || []);
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
              <div className="text-xl font-extrabold mt-0.5">{fmtNum(t.balance)} {cur}</div>
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
                          <span>Cr: <span className="text-emerald-800">{fmtNum(cs.credit)}</span></span>
                          <span>Dr: <span className="text-red-700">{fmtNum(cs.debit)}</span></span>
                          <span className={'px-2 py-0.5 rounded font-extrabold ' + (cs.balance > 0 ? 'bg-emerald-700 text-white' : cs.balance < 0 ? 'bg-red-700 text-white' : 'bg-slate-500 text-white')}>
                            Bal: {fmtNum(cs.balance)} {cur}
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
                    <button onClick={function () { handlePrintLedger(a); }} className="px-2 py-1 bg-slate-700 hover:bg-slate-800 text-white text-[10px] font-extrabold rounded shadow" title="Print or save as PDF">🖨️ Print</button>
                    <button onClick={function () { handleExportExcel(a); }} className="px-2 py-1 bg-green-700 hover:bg-green-800 text-white text-[10px] font-extrabold rounded shadow" title="Download Excel file">📊 Excel</button>
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
                {accEntries.length === 0 ? (
                  <div className="p-6 text-center text-slate-600 text-sm">
                    No entries yet. Click <strong>+ Entry</strong> to add the first one.
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-extrabold text-slate-900 border-b-2 border-slate-300">Date</th>
                        <th className="px-3 py-2 text-left text-xs font-extrabold text-slate-900 border-b-2 border-slate-300">Description</th>
                        <th className="px-3 py-2 text-left text-xs font-extrabold text-slate-900 border-b-2 border-slate-300">Reference</th>
                        <th className="px-3 py-2 text-center text-xs font-extrabold text-slate-900 border-b-2 border-slate-300">Cur</th>
                        <th className="px-3 py-2 text-right text-xs font-extrabold text-emerald-900 border-b-2 border-slate-300 bg-emerald-50">Credit</th>
                        <th className="px-3 py-2 text-right text-xs font-extrabold text-red-900 border-b-2 border-slate-300 bg-red-50">Debit</th>
                        {/* v55.83-A.6.27.58 — One Running Balance column PER currency in this account.
                            User sees parallel running balances for USD and EGP side-by-side. */}
                        {s.currencies.map(function (cur) {
                          return <th key={cur} className="px-3 py-2 text-right text-xs font-extrabold text-slate-900 border-b-2 border-slate-300 bg-slate-100">Running {cur}</th>;
                        })}
                        {canEdit && <th className="px-3 py-2 text-right text-xs font-extrabold text-slate-900 border-b-2 border-slate-300">Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {accEntries.map(function (entry) {
                        var entryCur = entry._currency;
                        return (
                          <tr key={entry.id} className="border-b border-slate-200 hover:bg-slate-50">
                            <td className="px-3 py-1.5 font-mono text-slate-900">{fmtDate(entry.entry_date)}</td>
                            <td className="px-3 py-1.5 text-slate-900">
                              <div className="font-bold">{entry.description}</div>
                              {entry.notes && <div className="text-[10px] text-slate-600 italic">{entry.notes}</div>}
                            </td>
                            <td className="px-3 py-1.5 font-mono text-slate-700">{entry.reference_number || '—'}</td>
                            <td className="px-3 py-1.5 text-center font-mono font-bold text-slate-800 text-[11px]">{entryCur}</td>
                            <td className="px-3 py-1.5 text-right font-mono font-extrabold text-emerald-800 bg-emerald-50">
                              {entry.credit_amount ? fmtNum(entry.credit_amount) : ''}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono font-extrabold text-red-700 bg-red-50">
                              {entry.debit_amount ? fmtNum(entry.debit_amount) : ''}
                            </td>
                            {/* v55.83-A.6.27.58 — parallel running balances. For currencies the entry
                                does NOT affect, we still show the carried-forward running value
                                (or 0 if no entry in that currency has happened yet). The entry's
                                OWN currency cell is highlighted so you can see which line moved. */}
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
                                  {fmtNum(rbForCur)}
                                </td>
                              );
                            })}
                            {canEdit && (
                              <td className="px-3 py-1.5 text-right">
                                <button onClick={function () { openEditEntry(entry); }} className="px-2 py-0.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold rounded mr-1">Edit</button>
                                <button onClick={function () { deleteEntry(entry); }} className="px-2 py-0.5 bg-red-700 hover:bg-red-800 text-white text-[10px] font-bold rounded">Del</button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                      {/* v55.83-A.6.27.58 — Totals row: one row per currency for credit+debit,
                          plus the final balance in each currency's running column. */}
                      {s.currencies.map(function (cur, ci) {
                        var cs = s.byCurrency[cur];
                        return (
                          <tr key={cur} className="bg-slate-100 font-extrabold">
                            <td colSpan={2} className="px-3 py-2 text-right text-xs uppercase text-slate-900">
                              {ci === 0 ? 'Totals →' : ''}
                            </td>
                            <td className="px-3 py-2 text-center text-xs font-mono text-slate-900">{cur}</td>
                            <td className="px-3 py-2 text-center font-mono text-slate-800 text-[11px]">{cur}</td>
                            <td className="px-3 py-2 text-right font-mono text-emerald-900 bg-emerald-100">{fmtNum(cs.credit)}</td>
                            <td className="px-3 py-2 text-right font-mono text-red-900 bg-red-100">{fmtNum(cs.debit)}</td>
                            {s.currencies.map(function (col, colI) {
                              if (col !== cur) return <td key={col + '-' + colI}></td>;
                              return (
                                <td key={col + '-' + colI} className={'px-3 py-2 text-right font-mono ' + (cs.balance > 0 ? 'text-emerald-900' : cs.balance < 0 ? 'text-red-900' : 'text-slate-900')}>
                                  {fmtNum(cs.balance)}
                                </td>
                              );
                            })}
                            {canEdit && <td></td>}
                          </tr>
                        );
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
              <div className="text-xs text-indigo-100 mt-0.5">Credit = money in (they paid us) · Debit = money out (we paid them)</div>
            </div>
            <div className="p-5 space-y-3">
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
              <div className="grid grid-cols-2 gap-3">
                <label className={'block border-2 rounded p-3 cursor-pointer ' + (entryDraft.side === 'credit' ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-slate-50')}>
                  <input type="radio" name="side" checked={entryDraft.side === 'credit'} onChange={function () { setEntryDraft(Object.assign({}, entryDraft, { side: 'credit' })); }} className="mr-2" />
                  <span className="font-extrabold text-emerald-900">CREDIT — money IN</span>
                  <div className="text-[10px] text-slate-700 mt-1">They paid us / we are owed less / they owe us less</div>
                </label>
                <label className={'block border-2 rounded p-3 cursor-pointer ' + (entryDraft.side === 'debit' ? 'border-red-500 bg-red-50' : 'border-slate-200 bg-slate-50')}>
                  <input type="radio" name="side" checked={entryDraft.side === 'debit'} onChange={function () { setEntryDraft(Object.assign({}, entryDraft, { side: 'debit' })); }} className="mr-2" />
                  <span className="font-extrabold text-red-900">DEBIT — money OUT</span>
                  <div className="text-[10px] text-slate-700 mt-1">We paid them / we owe them more</div>
                </label>
              </div>
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
            </div>
            <div className="border-t border-slate-200 px-5 py-3 flex justify-end gap-2 bg-slate-50 rounded-b-2xl">
              <button onClick={function () { setEntryModalOpen(false); setEntryDraft(null); }} disabled={busy} className="px-4 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 text-sm font-bold rounded disabled:opacity-50">Cancel</button>
              <button onClick={saveEntry} disabled={busy} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-extrabold rounded shadow disabled:opacity-50">{busy ? 'Saving...' : '💾 Save Entry'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
