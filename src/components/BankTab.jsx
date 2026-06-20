'use client';
import { useState, useEffect, useCallback } from 'react';
import { fmtET } from '../lib/et-time';
import { getActiveWaveBusiness, scopeIfRegistered } from '../lib/wave-business';
import SiloBanner from './SiloBanner';
import { fetchAllRows } from '../lib/fetch-all-rows';
import { floorDateFor, labelForWindow } from '../lib/visibility-window';

export default function BankTab({ user, supabase, modulePerms, userProfile, onGoToBankReview }) {
  const [connections, setConnections] = useState([]);
  const [plaidAccts, setPlaidAccts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [view, setView] = useState('all'); // all | unmatched | matched
  const [acctFilter, setAcctFilter] = useState('all');
  const [viewRange, setViewRange] = useState('all');
  // v55.83-JT — explicit Plaid BACKFILL window chosen in the Connect flow (and used by Deep re-pull).
  const [backfillWin, setBackfillWin] = useState('90');   // 30/90/180/365/cy/all/custom (days or 'cy'/'all')
  const [backfillCustom, setBackfillCustom] = useState(''); // explicit start date when backfillWin==='custom'
  const [visCfg, setVisCfg] = useState({ window: 'all', customDays: null, customFrom: null }); // v55.83-JE admin visibility window
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [bizRegistry, setBizRegistry] = useState([]);
  const [assignSel, setAssignSel] = useState({}); // { connId: wave_business_id }
  const [acctAssignSel, setAcctAssignSel] = useState({}); // v55.83-IV — { plaid_account_id: wave_business_id }
  const [assigning, setAssigning] = useState(false);
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [connectBizSel, setConnectBizSel] = useState('');
  // v55.83-GJ — without bank.view_all_accounts, staff are locked to the silo default account and
  // can't pick "All accounts" or see other silos' connections.
  const isSuperAdmin = !!(userProfile && userProfile.role === 'super_admin');
  const canViewAllAccounts = isSuperAdmin || (userProfile && (userProfile.role === 'admin' || userProfile.role === 'owner')) || !!(modulePerms && modulePerms['bank.view_all_accounts'] === true);
  const bizLabel = (id) => { if (!id) return 'Unassigned'; const e = bizRegistry.find(b => b.wave_business_id === id); return e ? (e.label || id) : id; };
  // v55.83-JX — connection-level assign via the service-role route (RLS-proof + schema-safe; the old
  // browser write tried assigned_at/assigned_by columns that don't exist on the live table → "Assign failed").
  const assignConnection = async (conn) => {
    const bizId = assignSel[conn.id];
    if (!bizId) { setError('Choose an accounting silo to assign this bank connection to.'); return; }
    setAssigning(true); setError('');
    try {
      const res = await fetch('/api/accounting/bank-write', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'assign_connection_silo', connection_id: conn.id, wave_business_id: bizId, user_id: (userProfile && userProfile.id) || null }) });
      const j = await res.json();
      if (!j || !j.ok) { setError('Assign failed: ' + ((j && j.error) || 'unknown')); }
      else { setNotice('Connection assigned to ' + bizLabel(bizId) + ' — ' + (j.restamped || 0) + ' transaction(s) restamped.'); await loadData(); }
    } catch (e) { console.error('[bank-assign]', e); setError('Assign failed: ' + ((e && e.message) || e)); }
    setAssigning(false);
  };
  // v55.83-JX — archive a duplicate/relinked connection (cleans up the multiple-Chase-groups mess).
  const archiveConnection = async (conn) => {
    if (!window.confirm('Archive this bank connection?\n\nIt will be hidden from the active list. Its transactions and matches are kept; you can re-connect later if needed. Use this to remove duplicate/old connection groups.')) return;
    setAssigning(true); setError('');
    try {
      const res = await fetch('/api/accounting/bank-write', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'archive_connection', connection_id: conn.id, user_id: (userProfile && userProfile.id) || null }) });
      const j = await res.json();
      if (!j || !j.ok) { setError('Archive failed: ' + ((j && j.error) || 'unknown')); }
      else { setNotice('Connection archived — duplicate group removed from the active list.'); await loadData(); }
    } catch (e) { setError('Archive failed: ' + ((e && e.message) || e)); }
    setAssigning(false);
  };
  // v55.83-IV — ACCOUNT-LEVEL assignment + repair via the service-role route (RLS-proof). Sets the
  // per-account silo AND restamps existing transactions for that account so 6338/6353 land correctly.
  const assignAccount = async (a) => {
    const bizId = acctAssignSel[a.plaid_account_id] || a.wave_business_id;
    if (!bizId) { setError('Choose a silo for this account.'); return; }
    setAssigning(true); setError('');
    try {
      const res = await fetch('/api/accounting/bank-write', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'assign_account_silo', plaid_account_id: a.plaid_account_id, wave_business_id: bizId, user_id: (userProfile && userProfile.id) || null }) });
      const j = await res.json();
      if (!j || !j.ok) { setError('Account assign failed: ' + ((j && j.error) || 'unknown')); }
      else { setNotice('Account ··' + (a.mask || a.plaid_account_id) + ' assigned to ' + bizLabel(bizId) + ' — ' + (j.restamped || 0) + ' transaction(s) restamped.'); await loadData(); }
    } catch (e) { setError('Account assign failed: ' + ((e && e.message) || e)); }
    setAssigning(false);
  };
  useEffect(() => { fetchAllRows('wave_business_registry', '*').then((r) => setBizRegistry((r && r.data) || [])).catch(() => {}); }, []);
  // v55.83-BU — know which Plaid environment is live (sandbox vs production) and
  // whether the keys are configured, so the UI tells the truth instead of a
  // hardcoded "Sandbox mode" label.
  const [plaidEnv, setPlaidEnv] = useState('');
  const [plaidStatus, setPlaidStatus] = useState(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/plaid/env').then((r) => r.json()).then((d) => {
      if (!alive) return;
      setPlaidStatus(d);
      if (d && d.env) setPlaidEnv(d.env);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // Load connections and transactions from Supabase
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: conns } = await supabase.from('bank_connections').select('*').order('created_at', { ascending: false });
      // v55.83-JX — hide archived/duplicate connections from the active list.
      setConnections((conns || []).filter(c => c.status !== 'archived'));
      try { const pa = await supabase.from('plaid_accounts').select('*'); setPlaidAccts((pa && pa.data) || []); } catch (ePA) { setPlaidAccts([]); }

      // v55.83-IS (Codex FAIL) — scope by the active silo at the QUERY before the 500 limit, so a
      // silo's freshly-synced rows can't be truncated out by other silos' transactions.
      const _activeBizScope = getActiveWaveBusiness();
      // v55.83-IT (Codex FAIL) — order by posted_date (canonical date) to match Bank Review, so the
      // same silo/account shows the same newest transaction on both screens.
      // v55.83-JE — admin history-visibility window: clamp non-super-admins to the org policy.
      let _visFloor = null;
      try {
        const _vr = await fetch('/api/admin/visibility').then(r => r.json()).catch(() => null);
        if (_vr && _vr.value) { setVisCfg(_vr.value); _visFloor = floorDateFor({ window: _vr.value.window, customDays: _vr.value.customDays, customFrom: _vr.value.customFrom, isSuperAdmin }, new Date()); }
      } catch (eVis) {}
      let _txq = supabase.from('bank_transactions').select('*').order('posted_date', { ascending: false, nullsFirst: false });
      if (_activeBizScope) { _txq = _txq.eq('wave_business_id', _activeBizScope); }
      if (_visFloor) { _txq = _txq.gte('posted_date', _visFloor); }
      const { data: txns } = await _txq.limit(500);
      setTransactions(scopeIfRegistered(txns || [], getActiveWaveBusiness(), bizRegistry, true));
      // v55.83-GG — auto-select this silo's default bank account (only while the filter is still
      // "all", so it never overrides a manual choice). Mirrors Bank Review's auto-load.
      try {
        const activeBizB = getActiveWaveBusiness();
        if (activeBizB) {
          const { data: bsRows } = await supabase.from('wave_business_settings').select('default_plaid_account_id').eq('wave_business_id', activeBizB);
          const defAcctB = (bsRows && bsRows[0] && bsRows[0].default_plaid_account_id) || null;
          const scopedB = scopeIfRegistered(txns || [], activeBizB, bizRegistry, true);
          var firstAcctB = null;
          for (var fi = 0; fi < scopedB.length; fi++) { if (scopedB[fi].account_id) { firstAcctB = scopedB[fi].account_id; break; } }
          var defOk = defAcctB && scopedB.some(t => t.account_id === defAcctB);
          // v55.83-GJ — prefer the silo default; users without view-all can't sit on "All accounts"
          // (fall back to the default, else the first silo account).
          setAcctFilter(function (cur) {
            if (cur !== 'all') return cur;
            if (defOk) return defAcctB;
            if (!canViewAllAccounts && firstAcctB) return firstAcctB;
            return cur;
          });
        }
      } catch (eDefB) {}

      const { data: invs } = await supabase.from('invoices').select('*').order('date', { ascending: false }).limit(200);
      setInvoices(invs || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [supabase, bizRegistry]);

  // v55.83-GI — re-runs when bizRegistry loads, so the first scope isn't computed against an empty
  // registry (which would briefly show all silos' transactions).
  useEffect(() => { loadData(); }, [loadData]);

  // v55.83-JT — resolve the explicit backfill start date from the chosen window (used by connect +
  // Deep re-pull). Options: N days, 'cy' (Jan 1 this year), 'all' (~2yr Plaid default), 'custom' (date).
  const backfillStartDate = () => {
    if (backfillWin === 'all') return new Date(Date.now() - 730 * 86400000).toISOString().split('T')[0];
    if (backfillWin === 'cy') return new Date().getFullYear() + '-01-01';
    if (backfillWin === 'custom') return backfillCustom || new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];
    const days = parseInt(backfillWin, 10) || 90;
    return new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
  };
  const backfillLabel = () => {
    if (backfillWin === 'all') return 'all available (~2 years)';
    if (backfillWin === 'cy') return 'current year';
    if (backfillWin === 'custom') return backfillCustom ? ('since ' + backfillCustom) : 'custom';
    const m = { '30': '1 month', '90': '3 months', '180': '6 months', '365': '1 year' };
    return m[backfillWin] || (backfillWin + ' days');
  };

  // Connect bank via Plaid Link
  const connectBank = async (chosenBiz) => {
    setError('');
    if (!chosenBiz) { setError('Choose which accounting silo this bank connection belongs to before connecting.'); return; }
    try {
      const linkRes = await fetch('/api/plaid/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user?.id || 'default' }),
      });
      const linkData = await linkRes.json();
      if (linkData.error) { setError(linkData.error); return; }
      const linkEnv = linkData.env || plaidEnv || 'sandbox';
      if (linkData.env) setPlaidEnv(linkData.env);

      // Load Plaid Link script dynamically
      if (!window.Plaid) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
      }

      const handler = window.Plaid.create({
        token: linkData.link_token,
        onSuccess: async (public_token, metadata) => {
          // v55.83-JT — pass the admin's EXPLICIT backfill start date (chosen in the Connect modal) so
          // first connect / re-link pulls history back to here (bank_connections.initial_backfill_start_date).
          const _bfStart = backfillStartDate();
          const exRes = await fetch('/api/plaid/exchange', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ public_token, metadata, wave_business_id: chosenBiz || null, initial_backfill_start_date: _bfStart }),
          });
          const exData = await exRes.json();
          if (exData.error) { setError(exData.error); return; }
          // v55.83-JT — if the JR column is missing, the chosen backfill date was NOT saved. Say so.
          if (exData.backfill_saved === false && _bfStart) {
            setNotice('Bank connected, but the backfill start date (' + _bfStart + ') could not be saved — run sql/v55-83-JR-plaid-incremental-sync.sql, then use “Deep re-pull history” to backfill.');
          }
          await loadData();
          // Auto-sync after connecting: a first connect should pull the full chosen backfill window.
          if (exData.connection?.id) await syncTransactions(exData.connection.id, 0, true);
        },
        onExit: (err, metadata) => {
          // v55.83-BU — surface the REAL reason. Plaid's onExit gives an error
          // object (error_code / error_message / display_message) and metadata
          // (status, institution, request_id). Log it all, then show a clear,
          // sandbox-aware message instead of a blanket "Connection cancelled".
          try { console.log('[plaid] Link exit', { error: err, metadata: metadata }); } catch (e2) {}
          const status = metadata && metadata.status ? metadata.status : '';
          const inst = metadata && metadata.institution && metadata.institution.name ? metadata.institution.name : '';
          const reqId = metadata && metadata.request_id ? metadata.request_id : '';
          if (err && (err.error_code || err.error_message || err.display_message)) {
            const parts = [];
            if (err.display_message || err.error_message) parts.push(err.display_message || err.error_message);
            if (err.error_code) parts.push('(' + err.error_code + ')');
            if (inst) parts.push('· ' + inst);
            if (reqId) parts.push('· ref ' + reqId);
            let m = 'Plaid could not connect: ' + parts.join(' ');
            if (linkEnv === 'sandbox') m += ' — Sandbox only accepts Plaid test logins (user_good / pass_good); a real bank will not work here.';
            setError(m);
          } else {
            // Clean exit — user closed the window before finishing.
            let m = 'You closed the Plaid window before finishing — nothing was connected.';
            if (linkEnv === 'sandbox') m += ' This Hub is in Sandbox mode: pick any bank, then log in with user_good / pass_good. Real banks need Production keys.';
            if (status) m += ' [' + status + ']';
            setError(m);
          }
        },
      });
      handler.open();
    } catch (e) { setError(e.message); }
  };

  // Sync transactions from Plaid
  const syncTransactions = async (connId, attempt, deepPull) => {
    attempt = attempt || 0;
    setSyncing(true);
    setError('');
    setNotice('');
    try {
      // v55.83-JR — normal Sync is INCREMENTAL: send NO start_date so the server pulls FORWARD from the
      // connection's last successful posted date (with a 7-day overlap) and pages past 500. The screen's
      // visibility/date window no longer controls ingestion. A "deep re-pull" explicitly backfills from
      // the SYNC PULL window (used to recover history or fill a gap).
      const body = { connection_id: connId };
      if (deepPull) {
        body.start_date = backfillStartDate();
        body.end_date = new Date().toISOString().split('T')[0];
      }
      const res = await fetch('/api/plaid/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.pending) {
        // First-connect: Plaid is still preparing history. Soft message + auto-retry.
        setSyncing(false);
        if (attempt < 3) {
          setNotice((data.message || 'Plaid is still preparing your transactions.') + ' Retrying automatically… (' + (attempt + 1) + '/3)');
          setTimeout(() => { syncTransactions(connId, attempt + 1); }, 15000);
        } else {
          setNotice('Plaid is still preparing your transactions. This can take a few minutes on the first connection — click Sync again shortly.');
        }
        return;
      }
      if (data.error) {
        // v55.83-JO — a Plaid re-auth requirement is the usual reason a connection silently stops
        // pulling (stuck on an old date). Make it explicit + actionable instead of a generic error.
        if (data.needs_relink) {
          setError('⚠ This bank needs to be re-connected to Plaid before it will sync again (Plaid: ' + data.error + '). Click "+ Connect Bank" and re-authenticate this bank — your existing transactions and matches are kept. Until then it will stay frozen on the last successful sync date.');
        } else {
          setError('Sync failed (Plaid: ' + data.error + ').');
        }
        setSyncing(false); return;
      }
      await loadData();
      // v55.83-IR — never leave sync silent. Report exactly what Plaid returned so "nothing happened"
      // becomes actionable (0 new, scoped to another silo, or widen the date range).
      // v55.83-JR — report the incremental window, page count, and newest posted date so "stale" is
      // diagnosable at a glance.
      var procN = Number(data.synced) || 0;
      var totalN = (data.total != null) ? Number(data.total) : null;
      var win = data.window || {};
      var msg = '✅ Sync done — ' + procN + ' transaction(s) processed' + (totalN != null ? (' (Plaid total in window: ' + totalN + ')') : '') + (data.pages > 1 ? (' across ' + data.pages + ' pages') : '') + '.';
      if (win.start) { msg += ' Pulled ' + (win.incremental ? 'forward from ' : 'from ') + win.start + ' → ' + (win.end || 'today') + '.'; }
      if (data.newest_posted_date) { msg += ' Newest posted: ' + data.newest_posted_date + '.'; }
      if (procN === 0) { msg += ' No new transactions since the last sync — this account may have no recent activity (use “Deep re-pull history” to backfill older history).'; }
      // v55.83-JT — if the incremental markers didn't persist (JR SQL not run), warn LOUDLY: the next
      // sync would silently fall back to the legacy 30-day window (the stale/gap class we're fixing).
      if (data.markers_persisted === false) { msg += ' ⚠ Incremental markers could NOT be saved (run sql/v55-83-JR-plaid-incremental-sync.sql) — until then each sync falls back to ~30 days and can miss older gaps.'; }
      setNotice(msg);
    } catch (e) { setError(e.message); }
    setSyncing(false);
  };

  // v55.83-GU/GX — in-tab quick-match REMOVED. The old /api/plaid/match route only
  // stamped bank_transactions.matched_invoice_id; it never created payment_matches /
  // accounting_invoice_payments, never recomputed balances, never queued Wave — it
  // silently corrupted the books. The Match button now just routes the user (via a
  // notice) to Accounting → Bank Review & Matching, the accounting-safe flow. The old
  // match modal + matchToInvoice/matchableInvoices/searchInv/matchingTxn scaffolding
  // were deleted in GZ so nobody can wire them back to the dead route.

  // v55.83-GV — DISABLED. The old /api/plaid/match DELETE only cleared
  // bank_transactions.matched_invoice_id; it never voided
  // accounting_invoice_payments or payment_matches, never recomputed invoice
  // balances, never wrote audit, never reversed a Wave payment. Unmatching a
  // posted payment here would corrupt the books. Unmatch now lives only in
  // Accounting → Bank Review & Matching (accounting-safe reversal).
  const unmatch = async () => {
    setError('');
    setNotice('To unmatch a transaction, go to Accounting → Bank Review & Matching. Unmatching here was disabled because it did not reverse the posted payment, balances, or Wave sync.');
  };

  // Filter transactions: matched/unmatched view + selected account + display date range.
  const rangeCutoff = (function () {
    if (viewRange === 'all') return null;
    const d = new Date();
    d.setDate(d.getDate() - (parseInt(viewRange) || 0));
    return d;
  })();
  // Account + display-range scope (NOT matched/unmatched) — counts, cards, and tab badges
  // all derive from this so the whole screen reflects the selected account and date window.
  const scopedTxns = transactions.filter(t => {
    if (acctFilter !== 'all' && t.account_id !== acctFilter) return false;
    if (rangeCutoff) {
      const td = t.date ? new Date(t.date) : null;
      if (!td || td < rangeCutoff) return false;
    }
    return true;
  });
  const filtered = scopedTxns.filter(t => {
    if (view === 'matched') return t.matched_invoice_id;
    if (view === 'unmatched') return !t.matched_invoice_id;
    return true;
  });

  const matchedCount = scopedTxns.filter(t => t.matched_invoice_id).length;
  const unmatchedCount = scopedTxns.filter(t => !t.matched_invoice_id).length;
  const totalIn = scopedTxns.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const totalOut = scopedTxns.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);

  const fmtMoney = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(n || 0));

  return (
    <div>
      <h2 className="text-xl font-extrabold mb-3">🏦 Bank / البنك</h2>

      {connectModalOpen && (
        <div className="fixed inset-0 z-[210] bg-black/70 backdrop-blur-sm flex items-start justify-center" style={{ padding: 16 }} onClick={function () { setConnectModalOpen(false); }}>
          <div className="bg-white rounded-2xl shadow-2xl" onClick={function (e) { e.stopPropagation(); }} style={{ maxWidth: 480, width: '100%' }}>
            <div className="rounded-t-2xl flex justify-between items-center" style={{ background: '#1d4ed8', padding: '14px 20px' }}>
              <div className="text-base font-extrabold text-white">Which accounting silo does this bank belong to?</div>
              <button onClick={function () { setConnectModalOpen(false); }} className="text-white text-xl font-bold" style={{ width: 32, height: 32 }}>✕</button>
            </div>
            <div className="p-4 text-slate-900">
              <p className="text-xs text-slate-600 mb-3">This bank connection — and every transaction it imports — will belong to the silo you pick here. Choose carefully: it keeps Test and Production separate.</p>
              {bizRegistry.length === 0 ? (
                <div className="bg-amber-100 text-amber-950 rounded-lg p-3 text-sm font-semibold">No Wave businesses are registered yet. Register one in Accounting → Wave Import before connecting a bank.</div>
              ) : (
                <div className="space-y-2">
                  {bizRegistry.map(function (b) {
                    var sel = connectBizSel === b.wave_business_id;
                    var isTest = b.is_production === false;
                    return (
                      <button key={b.wave_business_id} onClick={function () { setConnectBizSel(b.wave_business_id); }}
                        className={'w-full text-left rounded-lg border-2 px-3 py-2 flex items-center justify-between ' + (sel ? 'border-blue-600 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50')}>
                        <span className="font-bold text-sm text-slate-900">{b.label || b.wave_business_id}</span>
                        <span className={'px-2 py-0.5 rounded text-[10px] font-extrabold ' + (isTest ? 'bg-amber-600 text-white' : 'bg-emerald-700 text-white')}>{isTest ? 'TEST' : 'PRODUCTION'}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {/* v55.83-JT — explicit BACKFILL window chosen BEFORE opening Plaid Link. */}
              <div className="mt-3 border-t border-slate-200 pt-3">
                <label className="block text-[12px] font-bold text-slate-700 mb-1">How far back to pull history on connect</label>
                <select value={backfillWin} onChange={function (e) { setBackfillWin(e.target.value); }} className="w-full border border-slate-300 rounded px-2 py-2 text-sm">
                  <option value="30">Last 1 month</option>
                  <option value="90">Last 3 months</option>
                  <option value="180">Last 6 months</option>
                  <option value="365">Last 1 year</option>
                  <option value="cy">Current year (Jan 1 →)</option>
                  <option value="all">All available (~2 years)</option>
                  <option value="custom">Custom start date…</option>
                </select>
                {backfillWin === 'custom' && (
                  <input type="date" value={backfillCustom} onChange={function (e) { setBackfillCustom(e.target.value); }} className="mt-2 border border-slate-300 rounded px-2 py-1 text-sm" />
                )}
                <div className="text-[11px] text-slate-500 mt-1">Will pull transactions from <b>{backfillStartDate()}</b> to today. You can pull more later with “Deep re-pull history”. Normal Sync afterward is incremental (pulls forward automatically).</div>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 rounded-b-2xl p-3">
              <button onClick={function () { setConnectModalOpen(false); }} className="px-4 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 text-sm font-bold rounded-lg">Cancel</button>
              <button onClick={function () { var biz = connectBizSel; setConnectModalOpen(false); connectBank(biz); }} disabled={!connectBizSel} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-extrabold rounded-lg">Continue to Plaid (backfill {backfillLabel()}) →</button>
            </div>
          </div>
        </div>
      )}

      {(function () {
        var active = getActiveWaveBusiness();
        var reg = null; bizRegistry.forEach(function (b) { if (b.wave_business_id === active) reg = b; });
        return (
          <SiloBanner
            registered={!!reg}
            isTest={!!(reg && reg.is_production === false)}
            canWrite={!!(reg && reg.writes_enabled === true)}
            label={reg ? (reg.label || active) : (active ? ('Business ' + String(active).slice(0, 8)) : 'No business selected')}
          />
        );
      })()}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs p-3 rounded-lg mb-3">
          {error} <button onClick={() => setError('')} className="ml-2 underline">dismiss</button>
        </div>
      )}

      {notice && (
        <div className="bg-amber-100 border border-amber-300 text-amber-950 text-xs p-3 rounded-lg mb-3 font-bold">
          ⏳ {notice} <button onClick={() => setNotice('')} className="ml-2 underline">dismiss</button>
        </div>
      )}

      {plaidStatus && (
        <div className={'text-[11px] font-bold p-2.5 rounded-lg mb-3 border ' + (plaidEnv === 'production' ? 'bg-emerald-100 border-emerald-300 text-emerald-950' : 'bg-amber-100 border-amber-300 text-amber-950')}>
          {plaidEnv === 'production'
            ? '🔒 Production mode — "Connect Bank" will link your real bank accounts.'
            : '🧪 Sandbox mode (testing). Real banks will NOT connect here. Pick any bank in the Plaid window, then log in with username user_good and password pass_good. To connect real KTC accounts you need Production keys from Plaid.'}
          {plaidStatus.hasKeys === false && (
            <span className="block mt-1 bg-red-100 text-red-950 rounded px-2 py-1">⚠ Plaid keys are not fully set in Vercel{plaidStatus.hasClientId === false ? ' — missing Client ID' : ''}{plaidStatus.hasSecret === false ? ' — missing Secret' : ''}. Connect Bank will fail until they're added and the app is redeployed.</span>
          )}
        </div>
      )}

      {/* Connected Banks */}
      <div className="bg-white rounded-xl p-4 mb-3 shadow-sm border">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-sm">Connected Accounts / حسابات متصلة</h3>
          <button onClick={function () { setError(''); setConnectBizSel(getActiveWaveBusiness() || ''); setConnectModalOpen(true); }} className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-semibold hover:bg-blue-600">
            + Connect Bank
          </button>
        </div>

        {connections.length === 0 ? (
          <div className="text-center py-6 text-slate-400">
            <div className="text-3xl mb-2">🔗</div>
            <p className="text-xs">No banks connected yet. Click "Connect Bank" to link your account via Plaid.</p>
            {plaidEnv === 'sandbox' && (
              <p className="text-[10px] mt-1 text-slate-300">Sandbox mode — log in with user_good / pass_good (not a real bank)</p>
            )}
            {plaidEnv === 'production' && (
              <p className="text-[10px] mt-1 text-slate-300">Production mode — use your real bank login</p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {connections.filter(function (c) { return canViewAllAccounts || !c.wave_business_id || c.wave_business_id === getActiveWaveBusiness(); }).map(c => {
              var accts = plaidAccts.filter(function (a) { return a.connection_id === c.id; });
              var siloName = bizLabel(c.wave_business_id);
              return (
                <div key={c.id} className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <div className="font-bold text-sm">{c.institution_name || 'Bank'}</div>
                      <div className="text-[10px] text-slate-500">
                        Assigned to: <span className="font-semibold">{siloName}</span> · Last synced: {c.last_synced ? fmtET(c.last_synced, 'datetime') : 'Never'}
                        <span className={`ml-2 px-1.5 py-0.5 rounded text-[9px] font-bold ${c.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{c.status}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => syncTransactions(c.id)} disabled={syncing} title="Pulls forward from the last synced date (gap-free incremental). The list date filter does not affect this." className="px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-xs font-semibold hover:bg-emerald-600 disabled:opacity-50">
                        {syncing ? '⏳ Syncing...' : '🔄 Sync (incremental)'}
                      </button>
                      {canViewAllAccounts && (
                        <button onClick={() => { var s = backfillStartDate(); var e = new Date().toISOString().split('T')[0]; if (window.confirm('Deep re-pull history for this bank?\n\nThis backfills transactions from ' + s + ' to ' + e + ' (window: ' + backfillLabel() + ', change it in the BACKFILL selector below).\n\nIt is idempotent — existing transactions and matches are kept, nothing is duplicated.')) { syncTransactions(c.id, 0, true); } }} disabled={syncing} title="Admin: backfill older history from the BACKFILL window below. Idempotent — never duplicates. Normal Sync stays incremental." className="px-2 py-1.5 bg-slate-200 text-slate-700 rounded-lg text-[11px] font-semibold hover:bg-slate-300 disabled:opacity-50">
                          ⏬ Deep re-pull history
                        </button>
                      )}
                      {canViewAllAccounts && (
                        <button onClick={() => archiveConnection(c)} disabled={syncing} title="Archive this connection (e.g. a duplicate or old re-link). Hidden from the list; transactions/matches are kept." className="px-2 py-1.5 bg-rose-100 text-rose-700 rounded-lg text-[11px] font-semibold hover:bg-rose-200 disabled:opacity-50">
                          🗄 Archive
                        </button>
                      )}
                    </div>
                  </div>
                  {accts.length === 0 ? (
                    <div className="text-[10px] text-amber-700 bg-amber-50 rounded px-2 py-1">Account details pending — click Sync connection to pull account names &amp; masks.</div>
                  ) : (
                    <div className="space-y-1">
                      {accts.map(function (a) {
                        var nm = a.name || a.official_name || (a.subtype ? (String(a.subtype).charAt(0).toUpperCase() + String(a.subtype).slice(1)) : 'Account');
                        var cnt = transactions.filter(function (t) { return t.account_id === a.plaid_account_id; }).length;
                        return (
                          <div key={a.plaid_account_id} className="flex items-center justify-between bg-white rounded px-2 py-1.5 border border-slate-100 gap-2 flex-wrap">
                            <div className="text-xs text-slate-900">
                              <span className="font-semibold">{nm}</span>{a.mask ? <span className="font-mono text-slate-600"> ··{a.mask}</span> : null}
                              {a.subtype ? <span className="text-[10px] text-slate-400"> · {a.subtype}</span> : null}
                              <span className="ml-2 text-[10px] text-slate-500">→ silo: <span className="font-semibold">{bizLabel(a.wave_business_id)}</span></span>
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] text-slate-500">{cnt} txn{cnt === 1 ? '' : 's'}</span>
                              {/* v55.83-IV — account-level silo assignment + repair (super-admin / bank.classify) */}
                              <select value={acctAssignSel[a.plaid_account_id] || a.wave_business_id || ''} onChange={function (e) { var v = e.target.value; setAcctAssignSel(function (p) { var n = Object.assign({}, p); n[a.plaid_account_id] = v; return n; }); }} className="px-1 py-0.5 border border-slate-300 rounded text-[10px] text-slate-900 bg-white" title="Assign THIS account to a silo (6338 → Real KTC, 6353 → Kandil)">
                                <option value="">— silo —</option>
                                {bizRegistry.map(function (b) { return <option key={b.wave_business_id} value={b.wave_business_id}>{(b.label || b.wave_business_id) + (b.is_production === false ? ' (Test)' : ' (Prod)')}</option>; })}
                              </select>
                              <button onClick={function () { assignAccount(a); }} disabled={assigning} className="px-2 py-0.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-[10px] font-bold rounded" title="Assign this account + restamp its existing transactions to the chosen silo">{assigning ? '…' : 'Set & repair'}</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Summary Cards */}
      {(function () {
        var unassigned = connections.filter(function (c) { return !c.wave_business_id; });
        if (unassigned.length === 0) { return null; }
        return (
          <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
            <div className="text-sm font-extrabold text-amber-950 mb-1">⚠ Unassigned Bank Data ({unassigned.length})</div>
            <div className="text-[11px] text-amber-900 mb-2">These bank connections are not assigned to an accounting silo. Their transactions are hidden from normal Bank Review and cannot be synced until assigned. Assign each to a registered Wave business.</div>
            <div className="space-y-2">
              {unassigned.map(function (c) {
                return (
                  <div key={c.id} className="bg-white rounded-lg border border-amber-200 p-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs text-slate-900">
                      <div className="font-bold">{c.institution_name || 'Unknown Bank'}</div>
                      <div className="text-[10px] text-slate-500">Connected {c.created_at ? fmtET(c.created_at, 'date') : '—'} · last sync {c.last_synced ? fmtET(c.last_synced, 'date') : 'never'}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <select value={assignSel[c.id] || ''} onChange={function (e) { var v = e.target.value; setAssignSel(function (p) { var n = Object.assign({}, p); n[c.id] = v; return n; }); }} className="px-2 py-1 border border-slate-300 rounded text-xs text-slate-900 bg-white">
                        <option value="">— assign to silo —</option>
                        {bizRegistry.map(function (b) { return <option key={b.wave_business_id} value={b.wave_business_id}>{(b.label || b.wave_business_id) + (b.is_production === false ? ' (Test)' : ' (Production)')}</option>; })}
                      </select>
                      <button onClick={function () { assignConnection(c); }} disabled={assigning || !assignSel[c.id]} className="px-3 py-1 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-bold rounded">{assigning ? 'Assigning…' : 'Assign'}</button>
                    </div>
                  </div>
                );
              })}
            </div>
            {bizRegistry.length === 0 && <div className="mt-2 text-[10px] text-amber-800">No Wave businesses are registered yet — register one in Accounting → Wave Import before assigning.</div>}
          </div>
        );
      })()}
      {transactions.length > 0 && (
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="bg-green-50 rounded-xl p-3 border border-green-200">
            <div className="text-[10px] text-green-600 font-bold">Money In / وارد</div>
            <div className="text-lg font-black text-green-700">{fmtMoney(totalIn)}</div>
          </div>
          <div className="bg-red-50 rounded-xl p-3 border border-red-200">
            <div className="text-[10px] text-red-600 font-bold">Money Out / صادر</div>
            <div className="text-lg font-black text-red-700">{fmtMoney(totalOut)}</div>
          </div>
          <div className="bg-blue-50 rounded-xl p-3 border border-blue-200">
            <div className="text-[10px] text-blue-600 font-bold">Matched / متطابق</div>
            <div className="text-lg font-black text-blue-700">{matchedCount}</div>
          </div>
          <div className="bg-amber-50 rounded-xl p-3 border border-amber-200">
            <div className="text-[10px] text-amber-600 font-bold">Unmatched / غير متطابق</div>
            <div className="text-lg font-black text-amber-900">{unmatchedCount}</div>
          </div>
        </div>
      )}

      {/* Pull range (changes Plaid import) vs display filters (change only what you see) */}
      {transactions.length > 0 && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <div className="flex items-center gap-1 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
            <label className="text-[10px] text-amber-800 font-bold">⟳ BACKFILL</label>
            <select value={backfillWin} onChange={e => setBackfillWin(e.target.value)} className="text-xs bg-transparent border-0 focus:ring-0 text-amber-900 font-semibold" title="How far back 'Deep re-pull history' (and Connect Bank) will backfill. Normal 'Sync (incremental)' ignores this and pulls forward from the last synced date.">
              <option value="30">1 month</option>
              <option value="90">3 months</option>
              <option value="180">6 months</option>
              <option value="365">1 year</option>
              <option value="cy">Current year</option>
              <option value="all">All (~2 yr)</option>
              <option value="custom">Custom date…</option>
            </select>
            {backfillWin === 'custom' && <input type="date" value={backfillCustom} onChange={e => setBackfillCustom(e.target.value)} className="text-xs border border-amber-300 rounded px-1 text-amber-900" />}
          </div>
          <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">
            <label className="text-[10px] text-slate-500 font-bold">👁 VIEW</label>
            <select value={acctFilter} onChange={e => setAcctFilter(e.target.value)} className="text-xs bg-transparent border-0 focus:ring-0 text-slate-700" title="Show only transactions for one bank account">
              {canViewAllAccounts && <option value="all">All accounts</option>}
              {(function () {
                // v55.83-GI — only list accounts present in THIS silo's (already-scoped) transactions,
                // not every Plaid account, so staff don't see other silos' accounts.
                var seen = {}; var opts = []; var paMap = {};
                plaidAccts.forEach(function (a) { if (a && a.plaid_account_id) { paMap[a.plaid_account_id] = a; } });
                transactions.forEach(function (t) {
                  if (!t.account_id || seen[t.account_id]) { return; }
                  seen[t.account_id] = true;
                  var a = paMap[t.account_id];
                  var label = a ? ((a.name || a.official_name || 'Account') + (a.mask ? (' ••' + a.mask) : '')) : ('Account ••' + String(t.account_id).slice(-4));
                  opts.push(<option key={t.account_id} value={t.account_id}>{label}</option>);
                });
                return opts;
              })()}
            </select>
            <span className="text-slate-300">·</span>
            <select value={viewRange} onChange={e => setViewRange(e.target.value)} className="text-xs bg-transparent border-0 focus:ring-0 text-slate-700" title="Filter the visible list by date (does not re-sync)">
              <option value="all">All dates</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="60">Last 60 days</option>
              <option value="90">Last 90 days</option>
            </select>
            {(() => {
              const f = floorDateFor({ window: visCfg.window, customDays: visCfg.customDays, customFrom: visCfg.customFrom, isSuperAdmin }, new Date());
              const lbl = isSuperAdmin ? 'All history (super-admin)' : labelForWindow(visCfg.window, visCfg.customDays);
              return <span className="text-[11px] text-slate-500 ml-1" title="Org history-visibility window (super admin sets it in Settings → Accounting Visibility).">· Visibility: <b className={f ? 'text-sky-600' : 'text-slate-700'}>{lbl}</b>{f ? ` (from ${f})` : ''}</span>;
            })()}
          </div>
          {['all', 'unmatched', 'matched'].map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${view === v ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-600'}`}>
              {v === 'all' ? `All (${scopedTxns.length})` : v === 'unmatched' ? `Unmatched (${unmatchedCount})` : `Matched (${matchedCount})`}
            </button>
          ))}
        </div>
      )}

      {/* Transaction List */}
      {loading ? (
        <div className="text-center py-8 text-slate-400 text-sm">Loading...</div>
      ) : filtered.length > 0 ? (
        <div className="space-y-1.5">
          {filtered.map(t => {
            const isInflow = t.amount < 0; // Plaid: negative = money in
            const matchedInv = t.matched_invoice_id ? invoices.find(i => i.id === t.matched_invoice_id) : null;
            return (
              <div key={t.id} className="bg-white rounded-xl p-3 shadow-sm border">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm truncate">{t.name}</div>
                    <div className="text-[10px] text-slate-500">
                      {t.date} • {t.category || 'Uncategorized'}
                      {t.pending && <span className="ml-1 text-amber-500 font-bold">PENDING</span>}
                    </div>
                    {matchedInv && (
                      <div className="text-[10px] text-green-600 mt-0.5">
                        ✅ Matched → {matchedInv.customer || matchedInv.invoice_number || 'Invoice'}
                        <button onClick={() => unmatch(t.id)} className="ml-1 text-slate-400 underline" title="Unmatch moved to Accounting → Bank Review & Matching (accounting-safe)">unmatch in Bank Review →</button>
                      </div>
                    )}
                  </div>
                  <div className="text-right ml-2">
                    <div className={`font-bold text-sm ${isInflow ? 'text-green-600' : 'text-red-600'}`}>
                      {isInflow ? '+' : '-'}{fmtMoney(t.amount)}
                    </div>
                    {!t.matched_invoice_id && (
                      <button
                        onClick={() => {
                          // v55.83-IN — actually NAVIGATE to Accounting → Bank Review & Matching and
                          // deep-link this transaction, instead of just showing a notice that felt dead.
                          if (onGoToBankReview) { onGoToBankReview(t.id); }
                          else { setNotice('To match this transaction to an invoice, go to Accounting → Bank Review & Matching.'); }
                        }}
                        className="text-[10px] text-blue-400 hover:text-blue-300 font-bold mt-1 underline"
                        title="Open this transaction in Accounting → Bank Review & Matching">
                        🔗 Match in Bank Review →
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : connections.length > 0 ? (
        <div className="text-center py-8 text-slate-400 text-sm">
          No transactions yet. Click Sync to pull from your bank.
        </div>
      ) : null}

      {/* v55.83-GX — The legacy in-tab Match Modal was REMOVED. It posted to the
          accounting-bypassing /api/plaid/match route (now 410 Gone). Matching and
          unmatching live only in Accounting → Bank Review & Matching. The Match /
          unmatch buttons here now route the user there via a notice. */}
    </div>
  );
}
