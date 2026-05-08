'use client';
import { useState, useEffect, useCallback } from 'react';
import { fmtET } from '../lib/et-time';

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

  // Load connections and transactions from Supabase
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: conns } = await supabase.from('bank_connections').select('*').order('created_at', { ascending: false });
      setConnections(conns || []);

      const { data: txns } = await supabase.from('bank_transactions').select('*').order('date', { ascending: false }).limit(500);
      setTransactions(txns || []);

      const { data: invs } = await supabase.from('invoices').select('*').order('date', { ascending: false }).limit(200);
      setInvoices(invs || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  // Connect bank via Plaid Link
  const connectBank = async () => {
    setError('');
    try {
      const linkRes = await fetch('/api/plaid/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user?.id || 'default' }),
      });
      const linkData = await linkRes.json();
      if (linkData.error) { setError(linkData.error); return; }

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
            body: JSON.stringify({ public_token, metadata }),
          });
          const exData = await exRes.json();
          if (exData.error) { setError(exData.error); return; }
          await loadData();
          // Auto-sync after connecting
          if (exData.connection?.id) await syncTransactions(exData.connection.id);
        },
        onExit: (err) => { if (err) setError(err.display_message || 'Connection cancelled'); },
      });
      handler.open();
    } catch (e) { setError(e.message); }
  };

  // Sync transactions from Plaid
  const syncTransactions = async (connId) => {
    setSyncing(true);
    setError('');
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
      if (data.error) { setError(data.error); setSyncing(false); return; }
      await loadData();
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

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs p-3 rounded-lg mb-3">
          {error} <button onClick={() => setError('')} className="ml-2 underline">dismiss</button>
        </div>
      )}

      {/* Connected Banks */}
      <div className="bg-white rounded-xl p-4 mb-3 shadow-sm border">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-sm">Connected Accounts / حسابات متصلة</h3>
          <button onClick={connectBank} className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-semibold hover:bg-blue-600">
            + Connect Bank
          </button>
        </div>

        {connections.length === 0 ? (
          <div className="text-center py-6 text-slate-400">
            <div className="text-3xl mb-2">🔗</div>
            <p className="text-xs">No banks connected yet. Click "Connect Bank" to link your account via Plaid.</p>
            <p className="text-[10px] mt-1 text-slate-300">Sandbox mode — use test credentials to try it out</p>
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
            <div className="text-lg font-black text-amber-700">{unmatchedCount}</div>
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
