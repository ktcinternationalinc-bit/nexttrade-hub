'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase, dbInsert, dbUpdate, dbDelete, logActivity } from '../lib/supabase';
import * as XLSX from 'xlsx';

export default function EgyptBankTab({ user, userProfile, isAdmin, invoices }) {
  const [accounts, setAccounts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('transactions'); // transactions | accounts | import
  const [selAccount, setSelAccount] = useState('all');
  const [matchFilter, setMatchFilter] = useState('all'); // all | unmatched | matched
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [matchingTxn, setMatchingTxn] = useState(null);
  const [searchInv, setSearchInv] = useState('');
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [accForm, setAccForm] = useState({ bank_name: '', account_number: '', account_name: '', currency: 'EGP' });
  const [importStep, setImportStep] = useState('select'); // select | preview | importing | done
  const [importData, setImportData] = useState([]);
  const [importAccount, setImportAccount] = useState('');
  const [importStats, setImportStats] = useState(null);

  const myId = userProfile?.id || user?.id;

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: acc }, { data: txn }] = await Promise.all([
      supabase.from('egypt_bank_accounts').select('*').order('bank_name'),
      supabase.from('egypt_bank_transactions').select('*').order('date', { ascending: false }).limit(2000),
    ]);
    setAccounts(acc || []);
    setTransactions(txn || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // ───── Account CRUD ─────
  const saveAccount = async () => {
    if (!accForm.bank_name || !accForm.account_number) { alert('Bank name and account number required'); return; }
    if (accForm.id) {
      await dbUpdate('egypt_bank_accounts', accForm.id, accForm, myId);
    } else {
      await dbInsert('egypt_bank_accounts', accForm, myId);
    }
    setAccForm({ bank_name: '', account_number: '', account_name: '', currency: 'EGP' });
    setShowAddAccount(false);
    load();
  };
  const deleteAccount = async (id) => {
    if (!confirm('Delete this account and all its transactions?')) return;
    await supabase.from('egypt_bank_transactions').delete().eq('account_id', id);
    await dbDelete('egypt_bank_accounts', id, myId);
    load();
  };

  // ───── Import ─────
  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data);
    const ws = wb.Sheets[wb.SheetNames[0]];

    // Read raw grid (not sheet_to_json which fails on sparse layouts)
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    const grid = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        row.push(cell ? (cell.v != null ? String(cell.v).trim() : '') : '');
      }
      grid.push(row);
    }

    // Parse bank date format: 03FEB25 → 2025-02-03
    const MONTHS = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
    const parseBankDate = (v) => {
      if (!v) return '';
      const m = String(v).match(/(\d{1,2})([A-Z]{3})(\d{2,4})/i);
      if (m) {
        const day = m[1].padStart(2, '0');
        const mon = MONTHS[(m[2] || '').toUpperCase()] || '01';
        let yr = m[3]; if (yr.length === 2) yr = (parseInt(yr) > 50 ? '19' : '20') + yr;
        return `${yr}-${mon}-${day}`;
      }
      // Try standard date
      if (typeof v === 'number' && v > 30000) {
        const d = new Date((v - 25569) * 86400000);
        return isNaN(d.getTime()) ? '' : d.toISOString().substring(0, 10);
      }
      const d = new Date(v);
      return isNaN(d.getTime()) ? '' : d.toISOString().substring(0, 10);
    };

    const parseAmt = (v) => {
      if (!v) return 0;
      return parseFloat(String(v).replace(/,/g, '').replace(/[^0-9.\-]/g, '')) || 0;
    };

    // Strategy 1: Detect CIB-style sparse format (date in early column, description in middle, amounts in later columns)
    // Look for rows with bank dates in column 2
    const bankDateRows = grid.filter(row => row[2] && parseBankDate(row[2]));

    if (bankDateRows.length >= 3) {
      // CIB bank statement format
      console.log('📊 Detected CIB bank statement format');
      
      // Detect which columns have amounts by scanning all rows
      const amtCols = {};
      grid.forEach(row => {
        row.forEach((v, c) => {
          if (c >= 10 && parseAmt(v) > 0) {
            amtCols[c] = (amtCols[c] || 0) + 1;
          }
        });
      });
      
      // Find debit, credit, balance columns (most frequent amount columns)
      const sortedAmtCols = Object.entries(amtCols).sort((a, b) => b[1] - a[1]).map(([c]) => parseInt(c));
      // Last amount column is usually balance, before that credit, before that debit
      let balCol = -1, creditCol = -1, debitCol = -1;
      if (sortedAmtCols.length >= 3) {
        const sorted = [...sortedAmtCols].sort((a, b) => a - b);
        debitCol = sorted[0]; creditCol = sorted[1]; balCol = sorted[2];
      } else if (sortedAmtCols.length >= 2) {
        const sorted = [...sortedAmtCols].sort((a, b) => a - b);
        creditCol = sorted[0]; balCol = sorted[1];
      }
      console.log('Columns — debit:', debitCol, 'credit:', creditCol, 'balance:', balCol);

      // Group rows into transactions (each transaction starts with a date in col 2)
      const transactions = [];
      let current = null;
      for (let r = 0; r < grid.length; r++) {
        const row = grid[r];
        const dateStr = parseBankDate(row[2]);
        const desc = (row[9] || '').trim();
        const debit = debitCol >= 0 ? parseAmt(row[debitCol]) : 0;
        const credit = creditCol >= 0 ? parseAmt(row[creditCol]) : 0;

        if (dateStr) {
          // New transaction
          if (current) transactions.push(current);
          const amount = credit > 0 ? credit : (debit > 0 ? -debit : 0);
          current = { date: dateStr, description: desc, amount, _include: true };
        } else if (current && desc && !desc.includes('OPENING BALANCE') && !desc.includes('CLOSING BALANCE')) {
          // Continuation of description
          current.description += ' ' + desc;
        }
      }
      if (current) transactions.push(current);

      // Filter out opening/closing balance rows and empty amounts
      const parsed = transactions
        .filter(t => !t.description.includes('OPENING BALANCE') && !t.description.includes('CLOSING BALANCE'))
        .filter(t => t.amount !== 0)
        .map((t, i) => ({ ...t, _row: i + 1, description: t.description.replace(/\s+/g, ' ').trim() }));

      if (parsed.length === 0) { alert('No transactions found'); return; }
      setImportData(parsed);
      setImportStep('preview');
      return;
    }

    // Strategy 2: Regular tabular format with headers
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    if (rows.length === 0) { alert('No data found'); return; }

    const cols = Object.keys(rows[0]);
    const find = (keywords) => cols.find(c => keywords.some(k => c.toLowerCase().includes(k.toLowerCase())));
    const dateCol = find(['date', 'تاريخ', 'DATE', 'Transaction Date', 'Value Date']) || cols[0];
    const descCol = find(['desc', 'بيان', 'narr', 'detail', 'memo', 'reference', 'الوصف', 'البيان', 'particular', 'transaction']) || cols[1];
    const amountCol = find(['amount', 'مبلغ', 'value', 'المبلغ', 'net']);
    const creditColName = find(['credit', 'دائن', 'إيداع', 'deposit', 'cr']);
    const debitColName = find(['debit', 'مدين', 'سحب', 'withdrawal', 'dr']);

    const parsed = rows.map((r, i) => {
      let date = parseBankDate(r[dateCol]);

      let amount = 0;
      if (amountCol) {
        amount = parseAmt(r[amountCol]);
      } else if (creditColName && debitColName) {
        const cr = parseAmt(r[creditColName]);
        const db = parseAmt(r[debitColName]);
        amount = cr > 0 ? cr : -db;
      } else if (creditColName) {
        amount = parseAmt(r[creditColName]);
      } else if (debitColName) {
        amount = -parseAmt(r[debitColName]);
      }

      return {
        _row: i + 1,
        date,
        description: String(r[descCol] || '').trim(),
        amount,
        _include: true,
      };
    }).filter(r => r.date && (r.description || r.amount));

    setImportData(parsed);
    setImportStep('preview');
  };

  const doImport = async () => {
    if (!importAccount) { alert('Select an account first'); return; }
    const toImport = importData.filter(r => r._include);
    if (toImport.length === 0) { alert('No rows selected'); return; }
    setImportStep('importing');
    let imported = 0, skipped = 0;
    for (const row of toImport) {
      try {
        const { error } = await supabase.from('egypt_bank_transactions').insert({
          account_id: importAccount,
          date: row.date,
          description: row.description,
          amount: row.amount,
          imported_by: myId,
        });
        if (error) { skipped++; } else { imported++; }
      } catch (e) { skipped++; }
    }
    setImportStats({ imported, skipped, total: toImport.length });
    setImportStep('done');
    await logActivity(myId, `Imported ${imported} Egypt bank transactions`, 'finance');
    load();
  };

  // ───── Match ─────
  const matchToInvoice = async (txnId, invoiceId) => {
    await dbUpdate('egypt_bank_transactions', txnId, { matched_invoice_id: invoiceId, matched_at: new Date().toISOString(), matched_by: myId }, myId);
    setMatchingTxn(null);
    setTransactions(prev => prev.map(t => t.id === txnId ? { ...t, matched_invoice_id: invoiceId, matched_at: new Date().toISOString() } : t));
  };
  const unmatch = async (txnId) => {
    await dbUpdate('egypt_bank_transactions', txnId, { matched_invoice_id: null, matched_at: null, matched_by: null }, myId);
    setTransactions(prev => prev.map(t => t.id === txnId ? { ...t, matched_invoice_id: null, matched_at: null } : t));
  };

  // ───── Filters ─────
  const filtered = useMemo(() => {
    let arr = transactions;
    if (selAccount !== 'all') arr = arr.filter(t => t.account_id === selAccount);
    if (matchFilter === 'matched') arr = arr.filter(t => t.matched_invoice_id);
    if (matchFilter === 'unmatched') arr = arr.filter(t => !t.matched_invoice_id);
    if (search) {
      const s = search.toLowerCase();
      arr = arr.filter(t => (t.description || '').toLowerCase().includes(s) || String(t.amount).includes(s));
    }
    if (dateFrom) arr = arr.filter(t => t.date >= dateFrom);
    if (dateTo) arr = arr.filter(t => t.date <= dateTo);
    return arr;
  }, [transactions, selAccount, matchFilter, search, dateFrom, dateTo]);

  const totalIn = filtered.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const totalOut = filtered.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const matchedCount = filtered.filter(t => t.matched_invoice_id).length;
  const unmatchedCount = filtered.filter(t => !t.matched_invoice_id).length;

  const fmtE = (n) => 'E£' + Math.abs(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const getAccName = (id) => { const a = accounts.find(a => a.id === id); return a ? `${a.bank_name} - ${a.account_number}` : ''; };

  // Invoice search for matching
  const matchableInvoices = (invoices || []).filter(inv => {
    if (!searchInv) return true;
    const q = searchInv.toLowerCase();
    return (inv.customer || '').toLowerCase().includes(q) || (inv.invoice_number || '').toLowerCase().includes(q) || String(inv.amount || inv.total || '').includes(q);
  }).slice(0, 20);

  if (loading) return <div className="text-center py-12 text-slate-400">Loading...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-extrabold">🏦 Egypt Banking / البنوك المصرية</h2>
        <div className="flex gap-1.5">
          <button onClick={() => setView('accounts')} className={'px-3 py-1.5 rounded-lg text-xs font-semibold ' + (view === 'accounts' ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-600')}>🏛️ Accounts</button>
          <button onClick={() => { setView('import'); setImportStep('select'); }} className={'px-3 py-1.5 rounded-lg text-xs font-semibold ' + (view === 'import' ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-600')}>📥 Import</button>
          <button onClick={() => setView('transactions')} className={'px-3 py-1.5 rounded-lg text-xs font-semibold ' + (view === 'transactions' ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-600')}>📋 Transactions</button>
        </div>
      </div>

      {/* ===== ACCOUNTS ===== */}
      {view === 'accounts' && (
        <div>
          <button onClick={() => { setShowAddAccount(true); setAccForm({ bank_name: '', account_number: '', account_name: '', currency: 'EGP' }); }} className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-semibold mb-3">+ Add Account</button>
          {showAddAccount && (
            <div className="bg-white rounded-xl p-4 shadow-sm border mb-3">
              <h3 className="font-bold text-sm mb-2">{accForm.id ? 'Edit Account' : 'New Account / حساب جديد'}</h3>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <input value={accForm.bank_name} onChange={e => setAccForm(f => ({ ...f, bank_name: e.target.value }))} placeholder="Bank Name / اسم البنك *" className="border rounded-lg px-3 py-2 text-xs" />
                <input value={accForm.account_number} onChange={e => setAccForm(f => ({ ...f, account_number: e.target.value }))} placeholder="Account # / رقم الحساب *" className="border rounded-lg px-3 py-2 text-xs" />
                <input value={accForm.account_name} onChange={e => setAccForm(f => ({ ...f, account_name: e.target.value }))} placeholder="Account Name / اسم الحساب" className="border rounded-lg px-3 py-2 text-xs" />
                <select value={accForm.currency} onChange={e => setAccForm(f => ({ ...f, currency: e.target.value }))} className="border rounded-lg px-3 py-2 text-xs">
                  <option value="EGP">EGP - جنيه مصري</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button onClick={saveAccount} className="px-4 py-2 bg-blue-500 text-white rounded-lg text-xs font-semibold">Save</button>
                <button onClick={() => setShowAddAccount(false)} className="px-4 py-2 bg-slate-100 rounded-lg text-xs font-semibold">Cancel</button>
              </div>
            </div>
          )}
          <div className="space-y-2">
            {accounts.map(a => {
              const txnCount = transactions.filter(t => t.account_id === a.id).length;
              const balance = transactions.filter(t => t.account_id === a.id).reduce((s, t) => s + (t.amount || 0), 0);
              return (
                <div key={a.id} className="bg-white rounded-xl p-4 shadow-sm border">
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="font-bold text-sm">{a.bank_name}</div>
                      <div className="text-[10px] text-slate-400">{a.account_number} {a.account_name ? `• ${a.account_name}` : ''} • {a.currency}</div>
                      <div className="text-xs mt-1">{txnCount} transactions • Net: <span className={balance >= 0 ? 'text-green-600 font-bold' : 'text-red-600 font-bold'}>{fmtE(balance)}</span></div>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => { setAccForm(a); setShowAddAccount(true); }} className="px-2 py-1 bg-blue-50 text-blue-600 rounded text-[10px] font-semibold">Edit</button>
                      <button onClick={() => deleteAccount(a.id)} className="px-2 py-1 bg-red-50 text-red-600 rounded text-[10px] font-semibold">Delete</button>
                    </div>
                  </div>
                </div>
              );
            })}
            {accounts.length === 0 && <div className="text-center py-8 text-slate-400 text-xs">No accounts yet. Add one above.</div>}
          </div>
        </div>
      )}

      {/* ===== IMPORT ===== */}
      {view === 'import' && (
        <div>
          {importStep === 'select' && (
            <div className="bg-white rounded-xl p-6 text-center border-2 border-dashed border-blue-300">
              <div className="text-4xl mb-2">📁</div>
              <h3 className="font-bold text-sm mb-1">Upload Bank Statement / رفع كشف حساب</h3>
              <p className="text-[10px] text-slate-400 mb-3">Supports CIB bank statements, and any Excel/CSV with Date/Description/Amount columns.<br/>يدعم كشوف حسابات CIB وأي ملف Excel أو CSV بأعمدة التاريخ والوصف والمبلغ</p>
              {accounts.length === 0 ? (
                <p className="text-xs text-red-500 font-semibold">Add a bank account first (🏛️ Accounts tab)</p>
              ) : (
                <>
                  <div className="mb-3">
                    <label className="text-[10px] text-slate-500 font-bold block mb-1">Select Account / اختر الحساب</label>
                    <select value={importAccount} onChange={e => setImportAccount(e.target.value)} className="border rounded-lg px-3 py-2 text-xs">
                      <option value="">Select account...</option>
                      {accounts.map(a => <option key={a.id} value={a.id}>{a.bank_name} - {a.account_number}</option>)}
                    </select>
                  </div>
                  <label className="px-6 py-3 bg-blue-500 text-white rounded-lg text-sm font-semibold cursor-pointer hover:bg-blue-600 inline-block">
                    Select File / اختر ملف
                    <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />
                  </label>
                </>
              )}
            </div>
          )}

          {importStep === 'preview' && (
            <div>
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-bold text-sm">Preview — {importData.filter(r => r._include).length} of {importData.length} rows</h3>
                <div className="flex gap-2">
                  <button onClick={() => { setImportStep('select'); setImportData([]); }} className="px-3 py-1.5 bg-slate-100 rounded-lg text-xs font-semibold">← Back</button>
                  <button onClick={doImport} disabled={!importAccount} className="px-4 py-2 bg-green-500 text-white rounded-lg text-xs font-semibold disabled:opacity-50">✅ Import {importData.filter(r => r._include).length} rows</button>
                </div>
              </div>
              {!importAccount && <p className="text-xs text-red-500 font-semibold mb-2">⚠️ Select an account above first</p>}
              <div className="overflow-auto max-h-[500px] bg-white rounded-xl border">
                <table className="w-full border-collapse text-xs">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr>
                      <th className="px-2 py-2 text-left">✓</th>
                      <th className="px-2 py-2 text-left">Date</th>
                      <th className="px-2 py-2 text-left">Description</th>
                      <th className="px-2 py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importData.slice(0, 200).map((r, i) => (
                      <tr key={i} className={r._include ? '' : 'opacity-30'}>
                        <td className="px-2 py-1.5"><input type="checkbox" checked={r._include} onChange={() => { const d = [...importData]; d[i]._include = !d[i]._include; setImportData(d); }} /></td>
                        <td className="px-2 py-1.5">{r.date}</td>
                        <td className="px-2 py-1.5 max-w-[300px] truncate">{r.description}</td>
                        <td className={'px-2 py-1.5 text-right font-bold ' + (r.amount >= 0 ? 'text-green-600' : 'text-red-600')}>{r.amount >= 0 ? '+' : ''}{r.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {importStep === 'importing' && (
            <div className="text-center py-12">
              <div className="text-3xl mb-2 animate-spin">⏳</div>
              <p className="text-sm font-semibold">Importing transactions...</p>
            </div>
          )}

          {importStep === 'done' && importStats && (
            <div className="bg-green-50 rounded-xl p-6 text-center border border-green-200">
              <div className="text-3xl mb-2">✅</div>
              <h3 className="font-bold text-lg text-green-800">Import Complete!</h3>
              <p className="text-sm mt-2">{importStats.imported} imported{importStats.skipped > 0 ? `, ${importStats.skipped} skipped` : ''}</p>
              <button onClick={() => { setImportStep('select'); setImportData([]); setImportStats(null); setView('transactions'); }} className="mt-3 px-4 py-2 bg-blue-500 text-white rounded-lg text-xs font-semibold">View Transactions</button>
            </div>
          )}
        </div>
      )}

      {/* ===== TRANSACTIONS ===== */}
      {view === 'transactions' && (
        <div>
          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
            <div className="bg-green-50 rounded-xl p-3 border border-green-200">
              <div className="text-[10px] text-green-600 font-bold">Deposits / إيداعات</div>
              <div className="text-lg font-black text-green-700">{fmtE(totalIn)}</div>
            </div>
            <div className="bg-red-50 rounded-xl p-3 border border-red-200">
              <div className="text-[10px] text-red-600 font-bold">Withdrawals / سحب</div>
              <div className="text-lg font-black text-red-700">{fmtE(totalOut)}</div>
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

          {/* Filters */}
          <div className="flex gap-2 mb-3 flex-wrap items-center">
            <select value={selAccount} onChange={e => setSelAccount(e.target.value)} className="border rounded-lg px-2 py-1.5 text-xs">
              <option value="all">All Accounts</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.bank_name} - {a.account_number}</option>)}
            </select>
            {['all', 'unmatched', 'matched'].map(v => (
              <button key={v} onClick={() => setMatchFilter(v)} className={'px-3 py-1.5 rounded-lg text-xs font-semibold ' + (matchFilter === v ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-600')}>
                {v === 'all' ? `All (${transactions.length})` : v === 'unmatched' ? `Unmatched (${unmatchedCount})` : `Matched (${matchedCount})`}
              </button>
            ))}
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." className="border rounded-lg px-2 py-1.5 text-xs flex-1 min-w-[100px]" />
          </div>
          <div className="flex gap-2 mb-3 items-center">
            <span className="text-[10px] text-slate-500">Date:</span>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border rounded-lg px-2 py-1 text-xs" />
            <span className="text-[10px] text-slate-400">→</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="border rounded-lg px-2 py-1 text-xs" />
            {(dateFrom || dateTo) && <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="text-[10px] text-red-500 font-semibold">✕ Clear</button>}
          </div>

          {/* Transaction List */}
          {filtered.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-xs">
              {transactions.length === 0 ? 'No transactions yet. Import a bank statement.' : 'No transactions match your filters.'}
            </div>
          ) : (
            <div className="space-y-1.5">
              {filtered.slice(0, 200).map(t => {
                const isDeposit = t.amount > 0;
                const matchedInv = t.matched_invoice_id ? (invoices || []).find(i => i.id === t.matched_invoice_id) : null;
                const accName = getAccName(t.account_id);
                return (
                  <div key={t.id} className="bg-white rounded-xl p-3 shadow-sm border">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm truncate">{t.description || '—'}</div>
                        <div className="text-[10px] text-slate-400">
                          {t.date} {accName ? `• ${accName}` : ''}
                        </div>
                        {matchedInv && (
                          <div className="text-[10px] text-green-600 mt-0.5">
                            ✅ Matched → {matchedInv.customer || matchedInv.invoice_number || 'Invoice'} ({fmtE(matchedInv.amount || matchedInv.total)})
                            <button onClick={() => unmatch(t.id)} className="ml-1 text-red-400 underline">unmatch</button>
                          </div>
                        )}
                      </div>
                      <div className="text-right ml-2">
                        <div className={'font-bold text-sm ' + (isDeposit ? 'text-green-600' : 'text-red-600')}>
                          {isDeposit ? '+' : ''}{fmtE(t.amount)}
                        </div>
                        {!t.matched_invoice_id && (
                          <button onClick={() => { setMatchingTxn(t); setSearchInv(''); }} className="text-[10px] text-blue-500 font-semibold mt-1">🔗 Match</button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {filtered.length > 200 && <p className="text-center text-xs text-slate-400 py-2">Showing first 200 of {filtered.length}</p>}
            </div>
          )}
        </div>
      )}

      {/* ===== MATCH MODAL ===== */}
      {matchingTxn && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setMatchingTxn(null)}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-bold text-sm">Match Transaction / مطابقة</h3>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {matchingTxn.description} — {fmtE(matchingTxn.amount)} on {matchingTxn.date}
                  </p>
                </div>
                <button onClick={() => setMatchingTxn(null)} className="text-slate-400 text-lg">✕</button>
              </div>
              <input type="text" value={searchInv} onChange={e => setSearchInv(e.target.value)} placeholder="Search invoices by customer, number, amount..." className="w-full border rounded-lg px-3 py-2 text-xs mt-2" />
            </div>
            <div className="overflow-y-auto max-h-[50vh] p-2">
              {matchableInvoices.length === 0 ? (
                <p className="text-center text-slate-400 text-xs py-4">No invoices found</p>
              ) : matchableInvoices.map(inv => (
                <button key={inv.id} onClick={() => matchToInvoice(matchingTxn.id, inv.id)} className="w-full text-left p-3 rounded-lg hover:bg-blue-50 border-b last:border-0">
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="font-semibold text-xs">{inv.customer || 'N/A'}</div>
                      <div className="text-[10px] text-slate-400">#{inv.invoice_number || '—'} • {inv.date}</div>
                    </div>
                    <div className="font-bold text-sm text-blue-600">{fmtE(inv.amount || inv.total)}</div>
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
