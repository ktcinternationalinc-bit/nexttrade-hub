'use client';
import { useState, useEffect, useCallback } from 'react';
import { fmtET } from '../lib/et-time';
import { getActiveWaveBusiness, scopeIfRegistered } from '../lib/wave-business';
import SiloBanner from './SiloBanner';
import { fetchAllRows } from '../lib/fetch-all-rows';

export default function BankTab({ user, supabase }) {
  const [connections, setConnections] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [view, setView] = useState('all'); // all | unmatched | matched
  const [matchingTxn, setMatchingTxn] = useState(null);
  const [searchInv, setSearchInv] = useState('');
  const [dateRange, setDateRange] = useState('30');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [bizRegistry, setBizRegistry] = useState([]);
  const [assignSel, setAssignSel] = useState({}); // { connId: wave_business_id }
  const [assigning, setAssigning] = useState(false);
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [connectBizSel, setConnectBizSel] = useState('');
  const bizLabel = (id) => { if (!id) return 'Unassigned'; const e = bizRegistry.find(b => b.wave_business_id === id); return e ? (e.label || id) : id; };
  const assignConnection = async (conn) => {
    const bizId = assignSel[conn.id];
    if (!bizId) { setError('Choose an accounting silo to assign this bank connection to.'); return; }
    setAssigning(true); setError('');
    try {
      let cnt = 0;
      try { const cr = await supabase.from('bank_transactions').select('id', { count: 'exact', head: true }).eq('connection_id', conn.id); cnt = (cr && cr.count) || 0; } catch (eC) {}
      await supabase.from('bank_connections').update({ wave_business_id: bizId, assigned_by: (user && user.id) || null, assigned_at: new Date().toISOString() }).eq('id', conn.id);
      await supabase.from('bank_transactions').update({ wave_business_id: bizId }).eq('connection_id', conn.id);
      try { await supabase.from('bank_data_assignment_audit').insert({ record_type: 'bank_connection', bank_connection_id: conn.id, transaction_count: cnt, old_wave_business_id: conn.wave_business_id || null, new_wave_business_id: bizId, assigned_by: (user && user.id) || null }); } catch (eA) { console.error('[bank-assign] audit', eA); }
      await loadData();
    } catch (e) { console.error('[bank-assign]', e); setError('Assign failed: ' + ((e && e.message) || e)); }
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
      setConnections(conns || []);

      const { data: txns } = await supabase.from('bank_transactions').select('*').order('date', { ascending: false }).limit(500);
      setTransactions(scopeIfRegistered(txns || [], getActiveWaveBusiness(), bizRegistry, true));

      const { data: invs } = await supabase.from('invoices').select('*').order('date', { ascending: false }).limit(200);
      setInvoices(invs || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadData(); }, [loadData]);

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
          const exRes = await fetch('/api/plaid/exchange', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ public_token, metadata, wave_business_id: chosenBiz || null }),
          });
          const exData = await exRes.json();
          if (exData.error) { setError(exData.error); return; }
          await loadData();
          // Auto-sync after connecting
          if (exData.connection?.id) await syncTransactions(exData.connection.id);
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
  const syncTransactions = async (connId, attempt) => {
    attempt = attempt || 0;
    setSyncing(true);
    setError('');
    setNotice('');
    try {
      const days = parseInt(dateRange) || 30;
      const end = new Date().toISOString().split('T')[0];
      const start = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];

      const res = await fetch('/api/plaid/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connection_id: connId, start_date: start, end_date: end }),
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
      if (data.error) { setError(data.error); setSyncing(false); return; }
      await loadData();
      setNotice('');
    } catch (e) { setError(e.message); }
    setSyncing(false);
  };

  // Match transaction to invoice
  const matchToInvoice = async (txnId, invoiceId) => {
    try {
      await fetch('/api/plaid/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction_id: txnId, invoice_id: invoiceId }),
      });
      setMatchingTxn(null);
      await loadData();
    } catch (e) { setError(e.message); }
  };

  // Unmatch
  const unmatch = async (txnId) => {
    try {
      await fetch('/api/plaid/match', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction_id: txnId }),
      });
      await loadData();
    } catch (e) { setError(e.message); }
  };

  // Filter transactions
  const filtered = transactions.filter(t => {
    if (view === 'matched') return t.matched_invoice_id;
    if (view === 'unmatched') return !t.matched_invoice_id;
    return true;
  });

  const matchedCount = transactions.filter(t => t.matched_invoice_id).length;
  const unmatchedCount = transactions.filter(t => !t.matched_invoice_id).length;
  const totalIn = transactions.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const totalOut = transactions.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);

  // Invoice search for matching modal
  const matchableInvoices = invoices.filter(inv => {
    if (!searchInv) return true;
    const q = searchInv.toLowerCase();
    return (inv.customer || '').toLowerCase().includes(q) ||
           (inv.invoice_number || '').toLowerCase().includes(q) ||
           String(inv.amount || inv.total || '').includes(q);
  }).slice(0, 20);

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
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 rounded-b-2xl p-3">
              <button onClick={function () { setConnectModalOpen(false); }} className="px-4 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 text-sm font-bold rounded-lg">Cancel</button>
              <button onClick={function () { var biz = connectBizSel; setConnectModalOpen(false); connectBank(biz); }} disabled={!connectBizSel} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-extrabold rounded-lg">Continue to Plaid →</button>
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
          <div className="space-y-2">
            {connections.map(c => (
              <div key={c.id} className="flex items-center justify-between bg-slate-50 rounded-lg p-3">
                <div>
                  <div className="font-semibold text-sm">{c.institution_name}</div>
                  <div className="text-[10px] text-slate-500">
                    Last synced: {c.last_synced ? fmtET(c.last_synced, 'datetime') : 'Never'}
                    <span className={`ml-2 px-1.5 py-0.5 rounded text-[9px] font-bold ${c.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {c.status}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => syncTransactions(c.id)}
                  disabled={syncing}
                  className="px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-xs font-semibold hover:bg-emerald-600 disabled:opacity-50"
                >
                  {syncing ? '⏳ Syncing...' : '🔄 Sync'}
                </button>
              </div>
            ))}
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

      {/* Date Range + Filter Tabs */}
      {transactions.length > 0 && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <select value={dateRange} onChange={e => setDateRange(e.target.value)} className="text-xs border rounded-lg px-2 py-1.5">
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="60">60 days</option>
            <option value="90">90 days</option>
          </select>
          {['all', 'unmatched', 'matched'].map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${view === v ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-600'}`}>
              {v === 'all' ? `All (${transactions.length})` : v === 'unmatched' ? `Unmatched (${unmatchedCount})` : `Matched (${matchedCount})`}
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
                        <button onClick={() => unmatch(t.id)} className="ml-1 text-red-400 underline">unmatch</button>
                      </div>
                    )}
                  </div>
                  <div className="text-right ml-2">
                    <div className={`font-bold text-sm ${isInflow ? 'text-green-600' : 'text-red-600'}`}>
                      {isInflow ? '+' : '-'}{fmtMoney(t.amount)}
                    </div>
                    {!t.matched_invoice_id && (
                      <button onClick={() => setMatchingTxn(t)} className="text-[10px] text-blue-500 font-semibold mt-1">
                        🔗 Match
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

      {/* Match Modal */}
      {matchingTxn && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setMatchingTxn(null)}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[80vh] overflow-hidden"
            onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-bold text-sm">Match Transaction / مطابقة</h3>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    {matchingTxn.name} — {fmtMoney(matchingTxn.amount)} on {matchingTxn.date}
                  </p>
                </div>
                <button onClick={() => setMatchingTxn(null)} className="text-slate-400 text-lg">✕</button>
              </div>
              <input
                type="text"
                value={searchInv}
                onChange={e => setSearchInv(e.target.value)}
                placeholder="Search invoices by customer, number, amount..."
                className="w-full border rounded-lg px-3 py-2 text-xs mt-2"
              />
            </div>
            <div className="overflow-y-auto max-h-[50vh] p-2">
              {matchableInvoices.length === 0 ? (
                <p className="text-center text-slate-400 text-xs py-4">No invoices found</p>
              ) : matchableInvoices.map(inv => (
                <button key={inv.id}
                  onClick={() => matchToInvoice(matchingTxn.id, inv.id)}
                  className="w-full text-left p-3 rounded-lg hover:bg-blue-50 border-b last:border-0">
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="font-semibold text-xs">{inv.customer || 'N/A'}</div>
                      <div className="text-[10px] text-slate-500">
                        #{inv.invoice_number || '—'} • {inv.date}
                      </div>
                    </div>
                    <div className="font-bold text-sm text-blue-600">
                      {fmtMoney(inv.amount || inv.total)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
