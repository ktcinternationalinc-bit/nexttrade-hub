'use client';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase, dbInsert, dbUpdate, dbDelete } from '../lib/supabase';
import { fmt, fE, COLORS, EXPENSE_CATS, getReconStatus, STATUS_STYLES, today, inRange, monthOf } from '../lib/utils';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend
} from 'recharts';

// ============================================
// TABS CONFIG
// ============================================
const TABS = [
  { id: 'dashboard', label: 'Dashboard / لوحة', icon: '📊' },
  { id: 'sales', label: 'Sales / المبيعات', icon: '💰' },
  { id: 'customers', label: 'Customers / العملاء', icon: '👥' },
  { id: 'treasury', label: 'Treasury / الخزنة', icon: '🏦' },
  { id: 'checks', label: 'Checks / شيكات', icon: '📝' },
  { id: 'debts', label: 'Debts / المديونية', icon: '⚠️' },
  { id: 'warehouse', label: 'Warehouse / المخزن', icon: '🏭' },
  { id: 'crm', label: 'CRM', icon: '🤝' },
  { id: 'tickets', label: 'Tickets / تذاكر', icon: '🎫' },
  { id: 'calendar', label: 'Calendar / تقويم', icon: '📅' },
  { id: 'dailylog', label: 'Daily Log / يومي', icon: '📓' },
  { id: 'admin', label: 'Admin / إدارة', icon: '👑' },
  { id: 'settings', label: 'Settings / إعدادات', icon: '⚙️' },
  { id: 'import', label: 'Import / استيراد', icon: '📥' },
];

// ============================================
// MAIN APP
// ============================================
export default function App() {
  // Auth
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Navigation
  const [tab, setTab] = useState('dashboard');
  const [mode, setMode] = useState('custom');
  const [df, setDf] = useState('2024-01-01');
  const [dt, setDt] = useState(today());
  const [query, setQuery] = useState('');

  // Data
  const [invoices, setInvoices] = useState([]);
  const [treasury, setTreasury] = useState([]);
  const [checks, setChecks] = useState([]);
  const [debts, setDebts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [warehouse, setWarehouse] = useState([]);
  const [invoiceItems, setInvoiceItems] = useState([]);

  // Modals
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [drillType, setDrillType] = useState(null);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [selectedDebtor, setSelectedDebtor] = useState(null);
  const [treasuryDrill, setTreasuryDrill] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [checkView, setCheckView] = useState('pending');
  const [reconcileCheck, setReconcileCheck] = useState(null);
  const [expenseDrill, setExpenseDrill] = useState(null);
  const [customerGroup, setCustomerGroup] = useState('all');

  // Forms
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [showAddInvoice, setShowAddInvoice] = useState(false);
  const [showAddTreasury, setShowAddTreasury] = useState(false);
  const [editingTxn, setEditingTxn] = useState(null);
  const [splittingTxn, setSplittingTxn] = useState(null);
  const [splitData, setSplitData] = useState({ order1: '', amount1: 0, order2: '', amount2: 0 });
  const [linkSearch, setLinkSearch] = useState('');
  const [showLinkSearch, setShowLinkSearch] = useState(false);
  const [formData, setFormData] = useState({});

  // ==========================================
  // AUTH CHECK
  // ==========================================
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        window.location.href = '/login';
      } else {
        setUser(session.user);
        loadAllData();
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) window.location.href = '/login';
      else setUser(session.user);
    });

    return () => subscription?.unsubscribe();
  }, []);

  // ==========================================
  // DATA LOADING
  // ==========================================
  const fetchAll = async (table, orderCol, asc = false) => {
    let all = [];
    let from = 0;
    const batch = 1000;
    while (true) {
      const { data } = await supabase.from(table).select('*').order(orderCol, { ascending: asc }).range(from, from + batch - 1);
      if (!data || data.length === 0) break;
      all = all.concat(data);
      if (data.length < batch) break;
      from += batch;
    }
    return all;
  };

  const loadAllData = async () => {
    try {
      const [inv, tres, chk, dbt, cust, wh, items] = await Promise.all([
        fetchAll('invoices', 'invoice_date'),
        fetchAll('treasury', 'transaction_date'),
        fetchAll('checks', 'check_date', true),
        fetchAll('debts', 'total_debt'),
        fetchAll('customers', 'name', true),
        fetchAll('warehouse_expenses', 'expense_date'),
        fetchAll('invoice_items', 'created_at', true),
      ]);
      setInvoices(inv);
      setTreasury(tres);
      setChecks(chk);
      setDebts(dbt);
      setCustomers(cust);
      setWarehouse(wh);
      setInvoiceItems(items);
    } catch (err) {
      console.error('Load error:', err);
    }
  };

  // ==========================================
  // COMPUTED VALUES
  // ==========================================
  const filteredInvoices = useMemo(() => {
    let arr = invoices.filter(s => inRange(s.invoice_date, mode, df, dt));
    if (query) arr = arr.filter(s =>
      (s.customer_name || '').includes(query) || (s.order_number || '').includes(query)
    );
    return arr;
  }, [invoices, mode, df, dt, query]);

  const totalInvoiced = useMemo(() => filteredInvoices.reduce((a, r) => a + Number(r.total_amount || 0), 0), [filteredInvoices]);
  const totalCollected = useMemo(() => filteredInvoices.reduce((a, r) => a + Number(r.total_collected || 0), 0), [filteredInvoices]);
  const totalOutstanding = useMemo(() => filteredInvoices.reduce((a, r) => a + Number(r.outstanding || 0), 0), [filteredInvoices]);
  const totalDebt = useMemo(() => debts.reduce((a, d) => a + Number(d.total_debt || 0), 0), [debts]);

  const filteredTreasury = useMemo(() =>
    treasury.filter(t => inRange(t.transaction_date, mode, df, dt)),
    [treasury, mode, df, dt]
  );
  const totalCashIn = useMemo(() => filteredTreasury.reduce((a, t) => a + Number(t.cash_in || 0), 0), [filteredTreasury]);
  const totalCashOut = useMemo(() => filteredTreasury.reduce((a, t) => a + Number(t.cash_out || 0), 0), [filteredTreasury]);

  // Treasury by order for reconciliation
  const treasuryByOrder = useMemo(() => {
    const map = {};
    treasury.forEach(t => {
      if (t.order_number) {
        if (!map[t.order_number]) map[t.order_number] = [];
        map[t.order_number].push(t);
      }
    });
    return map;
  }, [treasury]);

  // Monthly treasury totals
  const monthlyTreasury = useMemo(() => {
    const mo = {};
    filteredTreasury.forEach(t => {
      const m = monthOf(t.transaction_date);
      if (!mo[m]) mo[m] = { month: m, cashIn: 0, cashOut: 0, count: 0 };
      mo[m].cashIn += Number(t.cash_in || 0);
      mo[m].cashOut += Number(t.cash_out || 0);
      mo[m].count++;
    });
    return Object.values(mo).sort((a, b) => a.month.localeCompare(b.month));
  }, [filteredTreasury]);

  // Expense buckets
  const expenseBuckets = useMemo(() => {
    const cats = {};
    filteredTreasury.forEach(t => {
      if (t.cash_out > 0) {
        const cat = t.category || 'Operations';
        cats[cat] = (cats[cat] || 0) + Number(t.cash_out);
      }
    });
    return Object.entries(cats)
      .map(([cat, total]) => ({ cat, eng: EXPENSE_CATS[cat] || cat, total: Math.round(total) }))
      .sort((a, b) => b.total - a.total);
  }, [filteredTreasury]);

  // Checks
  const pendingChecks = useMemo(() => checks.filter(c => c.status === 'pending'), [checks]);
  const collectedChecks = useMemo(() => checks.filter(c => c.status === 'collected'), [checks]);

  // Yearly summary
  const yearlySummary = useMemo(() => {
    const years = {};
    invoices.forEach(inv => {
      const y = inv.invoice_date ? parseInt(inv.invoice_date.substring(0, 4)) : 0;
      if (!years[y]) years[y] = { year: y, invoiced: 0, cashIn: 0, cashOut: 0 };
      years[y].invoiced += Number(inv.total_amount || 0);
    });
    treasury.forEach(t => {
      const y = t.transaction_date ? parseInt(t.transaction_date.substring(0, 4)) : 0;
      if (!years[y]) years[y] = { year: y, invoiced: 0, cashIn: 0, cashOut: 0 };
      years[y].cashIn += Number(t.cash_in || 0);
      years[y].cashOut += Number(t.cash_out || 0);
    });
    return Object.values(years).filter(y => {
      if (mode === 'all') return true;
      if (mode === '3yr') return y.year >= 2024;
      return y.year >= parseInt(df.substring(0, 4)) && y.year <= parseInt(dt.substring(0, 4));
    }).sort((a, b) => a.year - b.year);
  }, [invoices, treasury, mode, df, dt]);

  // Month transactions for drill-down
  const monthTransactions = useMemo(() => {
    if (!selectedMonth) return [];
    return filteredTreasury
      .filter(t => monthOf(t.transaction_date) === selectedMonth)
      .sort((a, b) => a.transaction_date.localeCompare(b.transaction_date));
  }, [selectedMonth, filteredTreasury]);

  // ==========================================
  // ACTIONS
  // ==========================================
  const navigate = (t) => {
    setTab(t); setQuery(''); setSelectedCustomer(null); setSelectedDebtor(null);
    setSelectedInvoice(null); setDrillType(null); setTreasuryDrill(null); setSelectedMonth(null);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  const handleAddPayment = async () => {
    if (!formData.amount || !formData.date || !selectedInvoice) return;
    try {
      await dbInsert('treasury', {
        transaction_date: formData.date,
        order_number: selectedInvoice.order_number,
        description: formData.desc || 'Payment',
        cash_in: Number(formData.amount),
        cash_out: 0,
      }, user?.id);
      // Update invoice collected
      const newCollected = Number(selectedInvoice.total_collected) + Number(formData.amount);
      await dbUpdate('invoices', selectedInvoice.id, {
        total_collected: newCollected,
      }, user?.id);
      setShowAddPayment(false);
      setFormData({});
      await loadAllData();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  const handleAddInvoice = async () => {
    if (!formData.orderNumber || !formData.customerName || !formData.amount) return;
    try {
      await dbInsert('invoices', {
        order_number: formData.orderNumber,
        customer_name: formData.customerName,
        invoice_date: formData.date || today(),
        total_amount: Number(formData.amount),
        total_collected: 0,
        sales_rep: formData.salesRep || '',
        notes: formData.notes || '',
        source: 'manual',
      }, user?.id);
      setShowAddInvoice(false);
      setFormData({});
      await loadAllData();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  const handleAddTreasury = async () => {
    if (!formData.amount || !formData.date) return;
    try {
      const isIncome = formData.type === 'in';
      await dbInsert('treasury', {
        transaction_date: formData.date,
        order_number: formData.orderNumber || '',
        description: formData.desc || '',
        cash_in: isIncome ? Number(formData.amount) : 0,
        cash_out: !isIncome ? Number(formData.amount) : 0,
        category: formData.category || '',
      }, user?.id);
      setShowAddTreasury(false);
      setFormData({});
      await loadAllData();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  const handleEditTreasury = async (txn) => {
    try {
      await dbUpdate('treasury', txn.id, {
        transaction_date: formData.date || txn.transaction_date,
        description: formData.desc || txn.description,
        cash_in: formData.cashIn != null ? Number(formData.cashIn) : txn.cash_in,
        cash_out: formData.cashOut != null ? Number(formData.cashOut) : txn.cash_out,
        order_number: formData.orderNumber || txn.order_number,
      }, user?.id);
      setEditingTxn(null);
      setFormData({});
      await loadAllData();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  const handleSplitTreasury = async () => {
    if (!splittingTxn) return;
    const txn = splittingTxn;
    const a1 = Number(splitData.amount1) || 0;
    const a2 = Number(splitData.amount2) || 0;
    const isIn = Number(txn.cash_in) > 0;
    const total = isIn ? Number(txn.cash_in) : Number(txn.cash_out);
    if (a1 + a2 !== total) {
      alert('Split amounts must equal the original (' + total.toLocaleString() + '). Currently: ' + (a1 + a2).toLocaleString());
      return;
    }
    if (!splitData.order1 && !splitData.order2) {
      alert('Please enter at least one order number');
      return;
    }
    try {
      await dbUpdate('treasury', txn.id, {
        order_number: splitData.order1,
        cash_in: isIn ? a1 : 0,
        cash_out: isIn ? 0 : a1,
        description: txn.description + ' (split 1/2)',
      }, user?.id);
      await dbInsert('treasury', {
        transaction_date: txn.transaction_date,
        order_number: splitData.order2,
        description: txn.description + ' (split 2/2)',
        cash_in: isIn ? a2 : 0,
        cash_out: isIn ? 0 : a2,
        source: txn.source || 'main',
      }, user?.id);
      setSplittingTxn(null);
      setSplitData({ order1: '', amount1: 0, order2: '', amount2: 0 });
      await loadAllData();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  const handleUnlinkTreasury = async (txn) => {
    if (!confirm('Unlink this transaction from order ' + (selectedInvoice?.order_number || '') + '?')) return;
    try {
      await dbUpdate('treasury', txn.id, { order_number: '' }, user?.id);
      await loadAllData();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  const handleLinkTreasury = async (txn) => {
    if (!selectedInvoice) return;
    try {
      await dbUpdate('treasury', txn.id, { order_number: selectedInvoice.order_number }, user?.id);
      setLinkSearch('');
      setShowLinkSearch(false);
      await loadAllData();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  const handleCollectCheck = async () => {
    if (!reconcileCheck || !formData.collectionDate) return;
    try {
      const payMethod = formData.paymentMethod || 'check';
      // 1. Mark check as collected
      await dbUpdate('checks', reconcileCheck.id, {
        status: 'collected',
        collection_date: formData.collectionDate,
      }, user?.id);
      // 2. Only create treasury entry for bank transfer/deposit/other
      // Cash and check payments already have treasury entries created by the accountant
      if (payMethod !== 'cash' && payMethod !== 'check') {
        const desc = reconcileCheck.customer_name + ' (' + payMethod + ' - check reconciled)';
        await dbInsert('treasury', {
          transaction_date: formData.collectionDate,
          order_number: reconcileCheck.order_number || '',
          description: desc,
          cash_in: Number(reconcileCheck.amount),
          cash_out: 0,
          source: 'check',
        }, user?.id);
        // Update invoice collected amount
        if (reconcileCheck.order_number) {
          const inv = invoices.find(i => i.order_number === reconcileCheck.order_number);
          if (inv) {
            const newCollected = Number(inv.total_collected) + Number(reconcileCheck.amount);
            await dbUpdate('invoices', inv.id, {
              total_collected: newCollected,
              outstanding: Math.max(0, Number(inv.total_amount) - newCollected),
            }, user?.id);
          }
        }
      }
      setReconcileCheck(null);
      setFormData({});
      await loadAllData();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  // ==========================================
  // UI HELPERS
  // ==========================================
  const ModeBar = () => (
    <div className="flex gap-1 items-center flex-wrap">
      {[['3yr', '3yr'], ['all', 'All'], ['custom', 'Custom']].map(([v, l]) => (
        <button key={v} onClick={() => setMode(v)}
          className={`px-3 py-1 rounded-md text-xs font-semibold transition ${mode === v ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
        >{l}</button>
      ))}
      {mode === 'custom' && (
        <span className="flex gap-1">
          <input type="date" value={df} onChange={e => setDf(e.target.value)}
            className="px-2 py-1 rounded border border-slate-200 text-xs" />
          <input type="date" value={dt} onChange={e => setDt(e.target.value)}
            className="px-2 py-1 rounded border border-slate-200 text-xs" />
        </span>
      )}
    </div>
  );

  const Card = ({ title, titleAr, value, sub, color, onClick }) => (
    <div onClick={onClick}
      className={`bg-white rounded-xl p-4 border-l-4 ${onClick ? 'cursor-pointer hover:shadow-md transition' : ''}`}
      style={{ borderLeftColor: color || '#0ea5e9' }}
    >
      <div className="text-xs font-semibold text-slate-500 uppercase">{title}</div>
      {titleAr && <div className="text-sm font-bold text-slate-900 mt-0.5" style={{ direction: 'rtl' }}>{titleAr}</div>}
      <div className="text-2xl font-extrabold mt-1">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );

  const Modal = ({ onClose, title, children }) => (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-3" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 max-w-2xl w-full max-h-[85vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold">{title}</h3>
          <button onClick={onClose} className="text-2xl text-slate-400 hover:text-slate-600">×</button>
        </div>
        {children}
      </div>
    </div>
  );

  const StatusBadge = ({ invoice }) => {
    const txns = treasuryByOrder[invoice.order_number] || [];
    const tTotal = txns.reduce((a, t) => a + Number(t.cash_in || 0), 0);
    const status = getReconStatus(invoice, tTotal);
    const s = STATUS_STYLES[status];
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: s.bg, color: s.color }}>
        {s.icon}
      </span>
    );
  };

  const InvoiceTable = ({ data, onSelect }) => (
    <div className="overflow-auto rounded-lg border border-slate-200 max-h-[420px]">
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-10">
          <tr className="bg-slate-50">
            <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">Date</th>
            <th className="px-3 py-2 text-xs font-semibold text-slate-600">#</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">Customer</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">Invoiced</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">Paid</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">Owed</th>
            <th className="px-3 py-2 text-xs"></th>
          </tr>
        </thead>
        <tbody>
          {data.map(inv => (
            <tr key={inv.id} onClick={() => onSelect(inv)}
              className="border-b border-slate-50 cursor-pointer hover:bg-blue-50 transition">
              <td className="px-3 py-2 text-xs">{inv.invoice_date || '—'}</td>
              <td className="px-3 py-2 text-xs font-semibold">{inv.order_number}</td>
              <td className="px-3 py-2 text-xs font-semibold text-right" style={{ direction: 'rtl' }}>{inv.customer_name}</td>
              <td className="px-3 py-2 text-xs text-right">{fE(inv.total_amount)}</td>
              <td className="px-3 py-2 text-xs text-right text-emerald-600">{fE(inv.total_collected)}</td>
              <td className="px-3 py-2 text-xs text-right" style={{ color: inv.outstanding > 0 ? '#ef4444' : '#10b981' }}>
                {inv.outstanding > 0 ? fE(inv.outstanding) : '✓'}
              </td>
              <td className="px-3 py-2"><StatusBadge invoice={inv} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  // ==========================================
  // LOADING
  // ==========================================
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-xl font-bold text-slate-400">Loading...</div>
    </div>
  );

  // ==========================================
  // RENDER
  // ==========================================
  return (
    <div className="min-h-screen bg-slate-100">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-900 to-blue-900 px-4 py-3 flex justify-between items-center">
        <div>
          <h1 className="text-white text-xl font-extrabold">KANDIL KTC EGYPT HUB</h1>
          <p className="text-white/40 text-xs">KTC — لوحة التحكم المالية</p>
        </div>
        <button onClick={handleSignOut} className="text-white/60 text-xs hover:text-white transition">
          Sign Out
        </button>
      </div>

      {/* Tab Navigation */}
      <div className="bg-white border-b border-slate-200 px-1 overflow-x-auto flex">
        {TABS.map(t => (
          <button key={t.id} onClick={() => navigate(t.id)}
            className={`px-3 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 transition ${
              tab === t.id ? 'text-blue-500 border-blue-500' : 'text-slate-500 border-transparent hover:text-slate-700'
            }`}
          >{t.icon} {t.label}</button>
        ))}
      </div>

      {/* Content */}
      <div className="p-4 max-w-7xl mx-auto">

        {/* ==========================================
            INVOICE DETAIL MODAL
        ========================================== */}
        {selectedInvoice && (
          <Modal onClose={() => { setSelectedInvoice(null); setShowAddPayment(false); setFormData({}); setEditingTxn(null); setShowLinkSearch(false); setLinkSearch(''); }}
            title={`Invoice / فاتورة #${selectedInvoice.order_number}`}>
            <div style={{ direction: 'rtl' }} className="text-lg font-bold mb-4 pb-3 border-b border-slate-200">
              {selectedInvoice.customer_name}
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-blue-50 rounded-lg p-3">
                <div className="text-[10px] text-blue-700">Invoiced / الفاتورة</div>
                <div className="text-xl font-extrabold text-blue-500">{fE(selectedInvoice.total_amount)}</div>
              </div>
              <div className="bg-emerald-50 rounded-lg p-3">
                <div className="text-[10px] text-emerald-700">Collected / المحصّل</div>
                <div className="text-xl font-extrabold text-emerald-500">{fE(selectedInvoice.total_collected)}</div>
              </div>
              <div className={`rounded-lg p-3 ${selectedInvoice.outstanding > 0 ? 'bg-red-50' : 'bg-green-50'}`}>
                <div className="text-[10px]">Outstanding / المتبقّي</div>
                <div className={`text-xl font-extrabold ${selectedInvoice.outstanding > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                  {selectedInvoice.outstanding > 0 ? fE(selectedInvoice.outstanding) : 'Paid ✓'}
                </div>
              </div>
            </div>

            {/* Reconciliation Status */}
            {(() => {
              const txns = treasuryByOrder[selectedInvoice.order_number] || [];
              const tTotal = txns.reduce((a, t) => a + Number(t.cash_in || 0), 0);
              const status = getReconStatus(selectedInvoice, tTotal);
              const s = STATUS_STYLES[status];
              return (
                <div className="rounded-lg p-3 mb-4" style={{ background: s.bg }}>
                  <div className="text-sm font-bold" style={{ color: s.color }}>
                    {s.icon} {s.label}
                    {status === 'overpaid' && ` — ${fE(tTotal - selectedInvoice.total_amount)}`}
                    {status === 'unverified' && ` — Gap: ${fE(selectedInvoice.total_amount - tTotal)}`}
                    {status === 'open' && ` — ${fE(selectedInvoice.outstanding)}`}
                  </div>
                </div>
              );
            })()}

            {/* Invoice Line Items */}
            {(() => {
              const items = invoiceItems.filter(it => it.invoice_id === selectedInvoice.id);
              if (items.length === 0) return null;
              return (
                <div className="bg-blue-50 rounded-lg p-4 mb-4 border border-blue-200">
                  <h4 className="text-sm font-bold text-blue-800 mb-2">📦 Items / البضاعة ({items.length})</h4>
                  <div className="overflow-auto max-h-[200px]">
                    <table className="w-full border-collapse">
                      <thead><tr className="bg-blue-100">
                        <th className="px-2 py-1.5 text-[10px] text-left" style={{ direction: 'rtl' }}>Description</th>
                        <th className="px-2 py-1.5 text-[10px] text-right">Qty</th>
                        <th className="px-2 py-1.5 text-[10px] text-right">Price</th>
                        <th className="px-2 py-1.5 text-[10px] text-right">Total</th>
                      </tr></thead>
                      <tbody>
                        {items.map(it => (
                          <tr key={it.id} className="border-b border-blue-100">
                            <td className="px-2 py-1 text-xs" style={{ direction: 'rtl' }}>{it.description}</td>
                            <td className="px-2 py-1 text-xs text-right">{fmt(it.quantity)}</td>
                            <td className="px-2 py-1 text-xs text-right">{fmt(it.unit_price)}</td>
                            <td className="px-2 py-1 text-xs text-right font-semibold">{fE(it.line_total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex justify-between pt-2 mt-1 border-t-2 border-blue-300">
                    <span className="text-xs font-bold">Items Total</span>
                    <span className="text-sm font-extrabold text-blue-600">{fE(items.reduce((a, it) => a + Number(it.line_total || 0), 0))}</span>
                  </div>
                </div>
              );
            })()}

            {/* Treasury Transactions */}
            {(treasuryByOrder[selectedInvoice.order_number] || []).length > 0 && (
              <div className="bg-emerald-50 rounded-lg p-4 mb-4 border border-emerald-200">
                <h4 className="text-sm font-bold text-emerald-800 mb-2">🏦 Treasury / الخزنة #{selectedInvoice.order_number}</h4>
                {(treasuryByOrder[selectedInvoice.order_number] || []).map((txn, i) => (
                  <div key={txn.id}>
                    {editingTxn === txn.id ? (
                      <div className="bg-blue-50 rounded-lg p-3 mb-2 border border-blue-200">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] font-semibold text-slate-600">Date / تاريخ</label>
                            <input type="date" value={formData.date || txn.transaction_date}
                              onChange={e => setFormData({ ...formData, date: e.target.value })}
                              className="w-full px-2 py-1 rounded border border-slate-200 text-xs" />
                          </div>
                          <div>
                            <label className="text-[10px] font-semibold text-slate-600">Amount / مبلغ</label>
                            <input type="number" value={formData.cashIn ?? txn.cash_in}
                              onChange={e => setFormData({ ...formData, cashIn: e.target.value })}
                              className="w-full px-2 py-1 rounded border border-slate-200 text-xs" />
                          </div>
                          <div className="col-span-2">
                            <label className="text-[10px] font-semibold text-slate-600">Description / الوصف</label>
                            <input value={formData.desc ?? txn.description}
                              onChange={e => setFormData({ ...formData, desc: e.target.value })}
                              className="w-full px-2 py-1 rounded border border-slate-200 text-xs" />
                          </div>
                          <div className="col-span-2">
                            <label className="text-[10px] font-semibold text-slate-600">Order# / رقم الأمر</label>
                            <input value={formData.orderNumber ?? txn.order_number}
                              onChange={e => setFormData({ ...formData, orderNumber: e.target.value })}
                              className="w-full px-2 py-1 rounded border border-slate-200 text-xs" />
                          </div>
                        </div>
                        <div className="flex gap-2 mt-2">
                          <button onClick={() => handleEditTreasury(txn)}
                            className="px-3 py-1 bg-blue-500 text-white rounded text-xs font-semibold">Save / حفظ</button>
                          <button onClick={() => { setEditingTxn(null); setFormData({}); }}
                            className="px-3 py-1 border border-slate-200 rounded text-xs">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex justify-between items-center py-2 border-b border-emerald-100">
                        <div className="flex-1">
                          <div className="text-xs font-semibold" style={{ direction: 'rtl' }}>{txn.description}</div>
                          <div className="text-[10px] text-slate-500">{txn.transaction_date}</div>
                        </div>
                        <div className="text-sm font-bold text-emerald-600 mr-2">{fE(txn.cash_in)}</div>
                        <button onClick={() => { setEditingTxn(txn.id); setFormData({}); }}
                          className="px-2 py-0.5 rounded border border-blue-300 text-blue-600 text-[10px] mr-1 hover:bg-blue-50">
                          Edit
                        </button>
                        <button onClick={() => handleUnlinkTreasury(txn)}
                          className="px-2 py-0.5 rounded border border-red-300 text-red-500 text-[10px] hover:bg-red-50">
                          Unlink
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                <div className="flex justify-between pt-2 mt-1 border-t-2 border-emerald-300">
                  <span className="text-xs font-bold">Total / الإجمالي</span>
                  <span className="text-sm font-extrabold text-emerald-600">
                    {fE((treasuryByOrder[selectedInvoice.order_number] || []).reduce((a, t) => a + Number(t.cash_in || 0), 0))}
                  </span>
                </div>
              </div>
            )}

            {/* Link Existing Transaction */}
            {!showLinkSearch ? (
              <button onClick={() => { setShowLinkSearch(true); setLinkSearch(''); }}
                className="px-4 py-2 bg-purple-500 text-white rounded-lg font-semibold text-sm hover:bg-purple-600 transition mb-3 mr-2">
                🔗 Link Transaction / ربط معاملة
              </button>
            ) : (
              <div className="bg-purple-50 rounded-lg p-4 border border-purple-200 mb-3">
                <h4 className="text-sm font-bold text-purple-800 mb-2">Search Treasury to Link / بحث للربط</h4>
                <input value={linkSearch} onChange={e => setLinkSearch(e.target.value)}
                  placeholder="Search by name, description, date, amount... / بحث"
                  className="w-full px-3 py-2 rounded-lg border border-purple-200 text-sm mb-2" autoFocus />
                {linkSearch.length >= 2 && (
                  <div className="max-h-[200px] overflow-auto rounded border border-purple-200 bg-white">
                    {treasury
                      .filter(t => !t.order_number || t.order_number === '')
                      .filter(t => {
                        const words = linkSearch.split(/\s+/).filter(w => w.length > 0);
                        const haystack = [t.description || '', t.transaction_date || '', String(t.cash_in || 0), String(t.cash_out || 0)].join(' ');
                        return words.every(w => haystack.includes(w));
                      })
                      .slice(0, 20)
                      .map(txn => (
                        <div key={txn.id} className="flex justify-between items-center px-3 py-2 border-b border-slate-50 hover:bg-purple-50">
                          <div className="flex-1">
                            <div className="text-xs font-semibold" style={{ direction: 'rtl' }}>{txn.description}</div>
                            <div className="text-[10px] text-slate-500">{txn.transaction_date} {txn.cash_in > 0 ? '| In: ' + fE(txn.cash_in) : '| Out: ' + fE(txn.cash_out)}</div>
                          </div>
                          <button onClick={() => handleLinkTreasury(txn)}
                            className="px-3 py-1 bg-purple-600 text-white rounded text-[10px] font-semibold ml-2 hover:bg-purple-700">
                            Link / ربط
                          </button>
                        </div>
                      ))}
                    {treasury.filter(t => !t.order_number || t.order_number === '').filter(t => {
                      const words = linkSearch.split(/\s+/).filter(w => w.length > 0);
                      const haystack = [t.description || '', t.transaction_date || '', String(t.cash_in || 0), String(t.cash_out || 0)].join(' ');
                      return words.every(w => haystack.includes(w));
                    }).length === 0 && (
                      <div className="px-3 py-3 text-xs text-slate-400 text-center">No unlinked transactions found</div>
                    )}
                  </div>
                )}
                <button onClick={() => { setShowLinkSearch(false); setLinkSearch(''); }}
                  className="mt-2 px-3 py-1 border border-slate-200 rounded text-xs">Cancel / إلغاء</button>
              </div>
            )}

            {/* Add Payment */}
            {!showAddPayment ? (
              <button onClick={() => setShowAddPayment(true)}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg font-semibold text-sm hover:bg-blue-600 transition">
                + Add Payment / إضافة دفعة
              </button>
            ) : (
              <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-600">Date / تاريخ</label>
                    <input type="date" value={formData.date || ''}
                      onChange={e => setFormData({ ...formData, date: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-600">Amount / المبلغ</label>
                    <input type="number" value={formData.amount || ''}
                      onChange={e => setFormData({ ...formData, amount: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs font-semibold text-slate-600">Description / الوصف</label>
                    <input value={formData.desc || ''}
                      onChange={e => setFormData({ ...formData, desc: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <button onClick={handleAddPayment}
                    className="px-4 py-2 bg-blue-500 text-white rounded-lg font-semibold text-sm">Save / حفظ ✓</button>
                  <button onClick={() => { setShowAddPayment(false); setFormData({}); }}
                    className="px-4 py-2 border border-slate-200 rounded-lg font-semibold text-sm">Cancel / إلغاء</button>
                </div>
              </div>
            )}
          </Modal>
        )}

        {/* ==========================================
            TREASURY DRILL-DOWN MODAL
        ========================================== */}
        {treasuryDrill && (
          <Modal onClose={() => { setTreasuryDrill(null); setSelectedMonth(null); }}
            title={selectedMonth ? `Transactions ${selectedMonth}` : `Cash ${treasuryDrill === 'in' ? 'In / وارد' : 'Out / منصرف'}`}>
            {!selectedMonth ? (
              <div>
                <p className="text-xs text-slate-400 mb-3">Tap month for transactions / اضغط الشهر للتفاصيل</p>
                <div className="overflow-auto max-h-[350px] rounded-lg border border-slate-200">
                  <table className="w-full border-collapse">
                    <thead><tr className="bg-slate-50">
                      <th className="px-3 py-2 text-xs text-left">Month</th>
                      <th className="px-3 py-2 text-xs text-right">{treasuryDrill === 'in' ? 'In / وارد' : 'Out / منصرف'}</th>
                      <th className="px-3 py-2 text-xs text-right">Entries</th>
                    </tr></thead>
                    <tbody>
                      {monthlyTreasury.map(m => (
                        <tr key={m.month} onClick={() => setSelectedMonth(m.month)}
                          className="border-b border-slate-50 cursor-pointer hover:bg-blue-50">
                          <td className="px-3 py-2 text-xs font-semibold">{m.month}</td>
                          <td className="px-3 py-2 text-xs text-right font-semibold"
                            style={{ color: treasuryDrill === 'in' ? '#10b981' : '#ef4444' }}>
                            {fE(treasuryDrill === 'in' ? m.cashIn : m.cashOut)}
                          </td>
                          <td className="px-3 py-2 text-xs text-right">{m.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div>
                <button onClick={() => setSelectedMonth(null)}
                  className="px-3 py-1 rounded border border-slate-200 text-xs font-semibold mb-3 hover:bg-slate-50">
                  ← Back / رجوع
                </button>
                <p className="text-xs text-slate-500 mb-2">{monthTransactions.length} transactions</p>
                <div className="overflow-auto max-h-[300px] rounded-lg border border-slate-200">
                  <table className="w-full border-collapse">
                    <thead><tr className="bg-slate-50">
                      <th className="px-3 py-2 text-xs text-left">Date</th>
                      <th className="px-3 py-2 text-xs">Order</th>
                      <th className="px-3 py-2 text-xs" style={{ direction: 'rtl' }}>Description</th>
                      <th className="px-3 py-2 text-xs text-right">In</th>
                      <th className="px-3 py-2 text-xs text-right">Out</th>
                      <th className="px-3 py-2 text-xs"></th>
                    </tr></thead>
                    <tbody>
                      {monthTransactions.map(txn => (
                        editingTxn === txn.id ? (
                          <tr key={txn.id} className="bg-blue-50">
                            <td className="px-2 py-1.5"><input type="date" defaultValue={txn.transaction_date}
                              onChange={e => setFormData({...formData, date: e.target.value})}
                              className="w-full text-xs border rounded px-1 py-1" /></td>
                            <td className="px-2 py-1.5"><input defaultValue={txn.order_number || ''}
                              onChange={e => setFormData({...formData, orderNumber: e.target.value})}
                              className="w-16 text-xs border rounded px-1 py-1" /></td>
                            <td className="px-2 py-1.5"><input defaultValue={txn.description}
                              onChange={e => setFormData({...formData, desc: e.target.value})}
                              className="w-full text-xs border rounded px-1 py-1" style={{ direction: 'rtl' }} /></td>
                            <td className="px-2 py-1.5"><input type="number" defaultValue={txn.cash_in || 0}
                              onChange={e => setFormData({...formData, cashIn: e.target.value})}
                              className="w-20 text-xs border rounded px-1 py-1" /></td>
                            <td className="px-2 py-1.5"><input type="number" defaultValue={txn.cash_out || 0}
                              onChange={e => setFormData({...formData, cashOut: e.target.value})}
                              className="w-20 text-xs border rounded px-1 py-1" /></td>
                            <td className="px-2 py-1.5 flex gap-1">
                              <button onClick={() => handleEditTreasury(txn)}
                                className="px-2 py-0.5 rounded bg-emerald-500 text-white text-[10px]">Save</button>
                              <button onClick={() => { setEditingTxn(null); setFormData({}); }}
                                className="px-2 py-0.5 rounded bg-slate-300 text-[10px]">Cancel</button>
                            </td>
                          </tr>
                        ) : (
                        <tr key={txn.id} className="border-b border-slate-50">
                          <td className="px-3 py-2 text-xs">{txn.transaction_date}</td>
                          <td className="px-3 py-2 text-xs font-semibold">{txn.order_number || '—'}</td>
                          <td className="px-3 py-2 text-xs" style={{ direction: 'rtl' }}>{txn.description}</td>
                          <td className="px-3 py-2 text-xs text-right text-emerald-600 font-semibold">
                            {txn.cash_in > 0 ? fE(txn.cash_in) : ''}
                          </td>
                          <td className="px-3 py-2 text-xs text-right text-red-500 font-semibold">
                            {txn.cash_out > 0 ? fE(txn.cash_out) : ''}
                          </td>
                          <td className="px-3 py-2 flex gap-1">
                            <button onClick={() => { setEditingTxn(txn.id); setFormData({}); }}
                              className="px-2 py-0.5 rounded border border-blue-300 text-blue-600 text-[10px]">Edit</button>
                            <button onClick={() => { setSplittingTxn(txn); const isIn = Number(txn.cash_in) > 0; const total = isIn ? Number(txn.cash_in) : Number(txn.cash_out); setSplitData({ order1: txn.order_number || '', amount1: total, order2: '', amount2: 0 }); }}
                              className="px-2 py-0.5 rounded border border-purple-300 text-purple-600 text-[10px]">Split</button>
                          </td>
                        </tr>
                        )
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Modal>
        )}

        {/* SPLIT PAYMENT MODAL */}
        {splittingTxn && (
          <Modal onClose={() => setSplittingTxn(null)} title="Split Payment / تقسيم الدفعة">
            <div className="space-y-3">
              <div className="bg-slate-50 rounded-lg p-3 text-xs">
                <div className="font-bold mb-1">{splittingTxn.transaction_date} — {splittingTxn.description}</div>
                <div>Original: <span className="font-bold text-emerald-600">{fE(Number(splittingTxn.cash_in) > 0 ? Number(splittingTxn.cash_in) : Number(splittingTxn.cash_out))}</span>
                  {splittingTxn.order_number ? (' — Order: ' + splittingTxn.order_number) : ''}
                </div>
              </div>
              <div className="bg-white rounded-lg border p-3">
                <div className="text-xs font-bold text-purple-700 mb-2">Split 1</div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-[10px] text-slate-500">Order #</label>
                    <input value={splitData.order1} onChange={e => setSplitData({...splitData, order1: e.target.value})}
                      className="w-full px-2 py-1.5 border rounded text-sm" placeholder="Order #" />
                  </div>
                  <div className="flex-1">
                    <label className="text-[10px] text-slate-500">Amount</label>
                    <input type="number" value={splitData.amount1} onChange={e => {
                      const a1 = Number(e.target.value) || 0;
                      const isIn = Number(splittingTxn.cash_in) > 0;
                      const total = isIn ? Number(splittingTxn.cash_in) : Number(splittingTxn.cash_out);
                      setSplitData({...splitData, amount1: a1, amount2: total - a1});
                    }} className="w-full px-2 py-1.5 border rounded text-sm" />
                  </div>
                </div>
              </div>
              <div className="bg-white rounded-lg border p-3">
                <div className="text-xs font-bold text-purple-700 mb-2">Split 2</div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-[10px] text-slate-500">Order #</label>
                    <input value={splitData.order2} onChange={e => setSplitData({...splitData, order2: e.target.value})}
                      className="w-full px-2 py-1.5 border rounded text-sm" placeholder="Order #" />
                  </div>
                  <div className="flex-1">
                    <label className="text-[10px] text-slate-500">Amount</label>
                    <input type="number" value={splitData.amount2} onChange={e => {
                      const a2 = Number(e.target.value) || 0;
                      const isIn = Number(splittingTxn.cash_in) > 0;
                      const total = isIn ? Number(splittingTxn.cash_in) : Number(splittingTxn.cash_out);
                      setSplitData({...splitData, amount2: a2, amount1: total - a2});
                    }} className="w-full px-2 py-1.5 border rounded text-sm" />
                  </div>
                </div>
              </div>
              <div className="text-xs text-center text-slate-400">
                Total: {fE(Number(splitData.amount1) + Number(splitData.amount2))} / {fE(Number(splittingTxn.cash_in) > 0 ? Number(splittingTxn.cash_in) : Number(splittingTxn.cash_out))}
                {Number(splitData.amount1) + Number(splitData.amount2) === (Number(splittingTxn.cash_in) > 0 ? Number(splittingTxn.cash_in) : Number(splittingTxn.cash_out))
                  ? ' ✅' : ' ❌ Must match'}
              </div>
              <button onClick={handleSplitTreasury}
                className="w-full py-2 bg-purple-600 text-white rounded-lg font-semibold text-sm hover:bg-purple-700">
                Split Payment / تقسيم
              </button>
            </div>
          </Modal>
        )}

        {/* ==========================================
            DRILL MODAL (Invoices/Collected/Outstanding)
        ========================================== */}
        {drillType && (
          <Modal onClose={() => setDrillType(null)}
            title={drillType === 'invoiced' ? 'Invoices / الفواتير' : drillType === 'collected' ? 'Collected / المحصّل' : 'Outstanding / المتبقّي'}>
            <InvoiceTable
              data={drillType === 'invoiced' ? filteredInvoices :
                drillType === 'collected' ? filteredInvoices.filter(s => s.total_collected > 0) :
                  filteredInvoices.filter(s => s.outstanding > 0)}
              onSelect={(inv) => { setDrillType(null); setSelectedInvoice(inv); }}
            />
          </Modal>
        )}

        {/* EXPENSE DRILL MODAL */}
        {expenseDrill && (
          <Modal onClose={() => setExpenseDrill(null)}
            title={`${EXPENSE_CATS[expenseDrill] || expenseDrill} / ${expenseDrill}`}>
            <p className="text-xs text-slate-500 mb-2">
              {filteredTreasury.filter(t => (t.category || 'Operations') === expenseDrill && t.cash_out > 0).length} transactions
            </p>
            <div className="overflow-auto max-h-[400px] rounded-lg border border-slate-200">
              <table className="w-full border-collapse">
                <thead><tr className="bg-slate-50 sticky top-0">
                  <th className="px-2 py-2 text-xs text-left">Date</th>
                  <th className="px-2 py-2 text-xs" style={{ direction: 'rtl' }}>Description</th>
                  <th className="px-2 py-2 text-xs text-right">Amount</th>
                </tr></thead>
                <tbody>
                  {filteredTreasury
                    .filter(t => (t.category || 'Operations') === expenseDrill && t.cash_out > 0)
                    .sort((a, b) => b.transaction_date.localeCompare(a.transaction_date))
                    .map(txn => (
                      <tr key={txn.id} className="border-b border-slate-50">
                        <td className="px-2 py-1.5 text-xs">{txn.transaction_date}</td>
                        <td className="px-2 py-1.5 text-xs" style={{ direction: 'rtl' }}>{txn.description}</td>
                        <td className="px-2 py-1.5 text-xs text-right text-red-500 font-semibold">{fE(txn.cash_out)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-between pt-2 mt-2 border-t-2 border-slate-300">
              <span className="text-xs font-bold">Total</span>
              <span className="text-sm font-extrabold text-red-500">
                {fE(filteredTreasury.filter(t => (t.category || 'Operations') === expenseDrill && t.cash_out > 0).reduce((a, t) => a + Number(t.cash_out), 0))}
              </span>
            </div>
          </Modal>
        )}

        {/* ==========================================
            CHECK RECONCILE MODAL
        ========================================== */}
        {reconcileCheck && (
          <Modal onClose={() => { setReconcileCheck(null); setFormData({}); }} title="Reconcile Check / تسوية شيك">
            <div style={{ direction: 'rtl' }} className="text-lg font-bold mb-1">{reconcileCheck.customer_name}</div>
            <div className="text-sm mb-2">{fE(reconcileCheck.amount)} | {reconcileCheck.check_date}</div>
            {reconcileCheck.order_number && (
              <div className="text-xs text-blue-600 mb-3">Order #{reconcileCheck.order_number}</div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-600">Collection Date / تاريخ التحصيل</label>
                <input type="date" value={formData.collectionDate || ''}
                  onChange={e => setFormData({ ...formData, collectionDate: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600">Method / طريقة</label>
                <select value={formData.paymentMethod || 'check'}
                  onChange={e => setFormData({ ...formData, paymentMethod: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm">
                  <option value="cash">Cash / نقداً</option>
                  <option value="check">Check / شيك</option>
                  <option value="bank_transfer">Bank Transfer / تحويل بنكي</option>
                  <option value="deposit">Bank Deposit / إيداع</option>
                  <option value="other">Other / أخرى</option>
                </select>
              </div>
            </div>
            <p className="text-[10px] text-slate-400 mt-2">Cash/Check: marks as collected only (treasury entry already exists). Bank transfer/Deposit/Other: also creates a treasury entry and updates invoice.</p>
            <button onClick={handleCollectCheck}
              className="mt-3 px-4 py-2 bg-emerald-500 text-white rounded-lg font-semibold w-full">Reconcile / تسوية ✓</button>
          </Modal>
        )}

        {/* ==========================================
            ADD INVOICE MODAL
        ========================================== */}
        {showAddInvoice && (
          <Modal onClose={() => { setShowAddInvoice(false); setFormData({}); }} title="New Invoice / فاتورة جديدة">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-600">Order # / رقم الأمر</label>
                <input value={formData.orderNumber || ''}
                  onChange={e => setFormData({ ...formData, orderNumber: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600">Date / التاريخ</label>
                <input type="date" value={formData.date || today()}
                  onChange={e => setFormData({ ...formData, date: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-semibold text-slate-600">Customer / العميل</label>
                <input value={formData.customerName || ''}
                  onChange={e => setFormData({ ...formData, customerName: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600">Amount / المبلغ</label>
                <input type="number" value={formData.amount || ''}
                  onChange={e => setFormData({ ...formData, amount: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600">Sales Rep / المندوب</label>
                <input value={formData.salesRep || ''}
                  onChange={e => setFormData({ ...formData, salesRep: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-semibold text-slate-600">Notes / ملاحظات</label>
                <input value={formData.notes || ''}
                  onChange={e => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={handleAddInvoice}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg font-semibold">Create / إنشاء ✓</button>
              <button onClick={() => { setShowAddInvoice(false); setFormData({}); }}
                className="px-4 py-2 border border-slate-200 rounded-lg font-semibold">Cancel / إلغاء</button>
            </div>
          </Modal>
        )}

        {/* ==========================================
            ADD TREASURY MODAL
        ========================================== */}
        {showAddTreasury && (
          <Modal onClose={() => { setShowAddTreasury(false); setFormData({}); }} title="New Transaction / معاملة جديدة">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-600">Type / النوع</label>
                <select value={formData.type || 'in'}
                  onChange={e => setFormData({ ...formData, type: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm">
                  <option value="in">Cash In / وارد</option>
                  <option value="out">Cash Out / منصرف</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600">Date / التاريخ</label>
                <input type="date" value={formData.date || today()}
                  onChange={e => setFormData({ ...formData, date: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600">Amount / المبلغ</label>
                <input type="number" value={formData.amount || ''}
                  onChange={e => setFormData({ ...formData, amount: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600">Order # / رقم</label>
                <input value={formData.orderNumber || ''}
                  onChange={e => setFormData({ ...formData, orderNumber: e.target.value })}
                  placeholder="Type to search..."
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                {formData.orderNumber && formData.orderNumber.length >= 2 && (
                  <div className="mt-1 max-h-[120px] overflow-auto rounded border border-slate-200 bg-white">
                    {invoices
                      .filter(inv => (inv.order_number || '').includes(formData.orderNumber) || (inv.customer_name || '').includes(formData.orderNumber))
                      .slice(0, 8)
                      .map(inv => (
                        <div key={inv.id} onClick={() => setFormData({ ...formData, orderNumber: inv.order_number, desc: inv.customer_name })}
                          className="px-3 py-1.5 text-xs cursor-pointer hover:bg-blue-50 border-b border-slate-50">
                          <span className="font-bold">{inv.order_number}</span> — <span style={{ direction: 'rtl' }}>{inv.customer_name}</span>
                          <span className="text-slate-400 ml-1">{fE(inv.total_amount)}</span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
              <div className="col-span-2">
                <label className="text-xs font-semibold text-slate-600">Description / الوصف</label>
                <input value={formData.desc || ''}
                  onChange={e => setFormData({ ...formData, desc: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={handleAddTreasury}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg font-semibold">Save / حفظ ✓</button>
              <button onClick={() => { setShowAddTreasury(false); setFormData({}); }}
                className="px-4 py-2 border border-slate-200 rounded-lg font-semibold">Cancel / إلغاء</button>
            </div>
          </Modal>
        )}

        {/* ==========================================
            DASHBOARD TAB
        ========================================== */}
        {tab === 'dashboard' && (
          <div>
            <div className="flex justify-between flex-wrap gap-2 mb-4">
              <h2 className="text-xl font-extrabold">Dashboard / لوحة التحكم</h2>
              <ModeBar />
            </div>

            <div className="bg-blue-100 rounded-lg px-3 py-2 mb-3">
              <span className="text-sm font-bold text-blue-800">📋 INVOICES / فواتير العملاء</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
              <Card title="Invoiced" titleAr="الفواتير" value={fE(totalInvoiced)} sub={`${filteredInvoices.length} inv`} color="#0ea5e9" onClick={() => setDrillType('invoiced')} />
              <Card title="Collected" titleAr="المحصّل" value={fE(totalCollected)} color="#10b981" onClick={() => setDrillType('collected')} />
              <Card title="Outstanding" titleAr="المتبقّي" value={fE(totalOutstanding)} sub={`${filteredInvoices.filter(s => s.outstanding > 0).length} open`} color="#ef4444" onClick={() => setDrillType('outstanding')} />
              <Card title="Debt" titleAr="المديونية" value={fE(totalDebt)} sub={`${debts.length} debtors`} color="#dc2626" onClick={() => navigate('debts')} />
            </div>

            <div className="bg-emerald-100 rounded-lg px-3 py-2 mb-3">
              <span className="text-sm font-bold text-emerald-800">🏦 CASH REGISTER / الخزنة</span>
              <span className="text-xs text-emerald-600 ml-2">(Loaded: {treasury.length} rows, Filtered: {filteredTreasury.length})</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
              <Card title="Cash In" titleAr="وارد" value={fE(totalCashIn)} sub="Tap / اضغط" color="#10b981" onClick={() => setTreasuryDrill('in')} />
              <Card title="Cash Out" titleAr="منصرف" value={fE(totalCashOut)} sub="Tap / اضغط" color="#ef4444" onClick={() => setTreasuryDrill('out')} />
              <Card title="Net" titleAr="صافي" value={fE(totalCashIn - totalCashOut)} color={totalCashIn > totalCashOut ? '#10b981' : '#ef4444'} />
              <Card title="Checks" titleAr="شيكات" value={fE(pendingChecks.reduce((a, c) => a + Number(c.amount), 0))} sub={`${pendingChecks.length} pending`} color="#f59e0b" onClick={() => navigate('checks')} />
            </div>

            {/* Yearly Chart */}
            <div className="bg-white rounded-xl p-4 mb-4">
              <h3 className="text-sm font-bold mb-2">Yearly / نظرة سنوية</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={yearlySummary}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 9 }} tickFormatter={v => (v / 1e6).toFixed(0) + 'M'} />
                  <Tooltip formatter={v => fE(v)} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="invoiced" fill="#0ea5e9" name="Invoiced" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="cashIn" fill="#10b981" name="Cash In" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="cashOut" fill="#ef4444" name="Cash Out" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Expense Buckets */}
            <div className="bg-white rounded-xl p-4">
              <h3 className="text-sm font-bold mb-2">Expense Buckets / تصنيف المنصرفات</h3>
              {expenseBuckets.map((e, i) => (
                <div key={e.cat} onClick={() => setExpenseDrill(e.cat)}
                  className="flex justify-between py-1 border-b border-slate-50 text-xs cursor-pointer hover:bg-slate-50">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                    <span>{e.eng}</span>
                  </div>
                  <span className="font-bold">{fE(e.total)} →</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ==========================================
            SALES TAB
        ========================================== */}
        {tab === 'sales' && (
          <div>
            <div className="flex justify-between flex-wrap gap-2 mb-3">
              <h2 className="text-xl font-extrabold">Sales / المبيعات ({filteredInvoices.length})</h2>
              <div className="flex gap-2 items-center flex-wrap">
                <ModeBar />
                <input value={query} onChange={e => setQuery(e.target.value)}
                  placeholder="بحث / Search" className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs w-32" />
                <button onClick={() => setShowAddInvoice(true)}
                  className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-semibold hover:bg-blue-600">
                  + New Invoice
                </button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div className="bg-white rounded-lg p-3 border-l-3" style={{ borderLeftWidth: 3, borderLeftColor: '#0ea5e9' }}>
                <div className="text-[10px] text-slate-500">Invoiced</div>
                <div className="text-lg font-extrabold">{fE(totalInvoiced)}</div>
              </div>
              <div className="bg-white rounded-lg p-3" style={{ borderLeftWidth: 3, borderLeftColor: '#10b981' }}>
                <div className="text-[10px] text-slate-500">Collected</div>
                <div className="text-lg font-extrabold">{fE(totalCollected)}</div>
              </div>
              <div className="bg-white rounded-lg p-3" style={{ borderLeftWidth: 3, borderLeftColor: '#ef4444' }}>
                <div className="text-[10px] text-slate-500">Outstanding</div>
                <div className="text-lg font-extrabold">{fE(totalOutstanding)}</div>
              </div>
            </div>
            <InvoiceTable data={filteredInvoices} onSelect={setSelectedInvoice} />
          </div>
        )}

        {/* ==========================================
            CUSTOMERS TAB
        ========================================== */}
        {tab === 'customers' && !selectedCustomer && (
          <div>
            <div className="flex justify-between flex-wrap gap-2 mb-3">
              <h2 className="text-xl font-extrabold">Customers / العملاء</h2>
              <div className="flex gap-2 items-center flex-wrap">
                <ModeBar />
                <input value={query} onChange={e => setQuery(e.target.value)}
                  placeholder="بحث / Search" className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs w-32" />
              </div>
            </div>
            <div className="flex gap-2 mb-3 flex-wrap">
              {[['all', 'All'], ['owing', 'Owing / مدين'], ['paid', 'Paid / مسدد'], ['top', 'Top Sales']].map(([v, l]) => (
                <button key={v} onClick={() => setCustomerGroup(v)}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition ${customerGroup === v ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                  {l}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {(() => {
                let custList = [...new Set(filteredInvoices.map(x => x.customer_name))].map(c => {
                  const cs = filteredInvoices.filter(x => x.customer_name === c);
                  const tot = cs.reduce((a, r) => a + Number(r.total_amount), 0);
                  const rem = cs.reduce((a, r) => a + Number(r.outstanding), 0);
                  const col = cs.reduce((a, r) => a + Number(r.total_collected), 0);
                  return { name: c, total: tot, outstanding: rem, collected: col, count: cs.length };
                });
                if (query) custList = custList.filter(c => c.name.includes(query));
                if (customerGroup === 'owing') custList = custList.filter(c => c.outstanding > 0);
                if (customerGroup === 'paid') custList = custList.filter(c => c.outstanding <= 0);
                if (customerGroup === 'top') custList.sort((a, b) => b.total - a.total);
                else custList.sort((a, b) => a.name.localeCompare(b.name));
                return custList.map(c => (
                  <div key={c.name} onClick={() => setSelectedCustomer(c.name)}
                    className="bg-white rounded-lg p-3 cursor-pointer border border-slate-200 hover:shadow-md transition">
                    <div className="text-sm font-bold" style={{ direction: 'rtl' }}>{c.name}</div>
                    <div className="text-[9px] text-slate-400 mt-1">{c.count} invoices</div>
                    <div className="flex justify-between mt-1">
                      <div>
                        <div className="text-[9px] text-slate-400">Sales</div>
                        <div className="text-xs font-bold text-blue-500">{fmt(c.total)}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[9px] text-slate-400">Owed</div>
                        <div className={`text-xs font-bold ${c.outstanding > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                          {c.outstanding > 0 ? fmt(c.outstanding) : '✓'}
                        </div>
                      </div>
                    </div>
                  </div>
                ));
              })()}
            </div>
          </div>
        )}
        {tab === 'customers' && selectedCustomer && (
          <div>
            <button onClick={() => setSelectedCustomer(null)}
              className="px-3 py-1 rounded border border-slate-200 text-xs font-semibold mb-3 hover:bg-slate-50">
              ← Back / رجوع
            </button>
            <h3 className="text-xl font-extrabold mb-1" style={{ direction: 'rtl' }}>{selectedCustomer}</h3>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div className="bg-blue-50 rounded-lg p-2 text-center">
                <div className="text-[9px] text-slate-500">Total Sales</div>
                <div className="text-sm font-bold text-blue-600">{fE(invoices.filter(s => s.customer_name === selectedCustomer).reduce((a, r) => a + Number(r.total_amount), 0))}</div>
              </div>
              <div className="bg-emerald-50 rounded-lg p-2 text-center">
                <div className="text-[9px] text-slate-500">Collected</div>
                <div className="text-sm font-bold text-emerald-600">{fE(invoices.filter(s => s.customer_name === selectedCustomer).reduce((a, r) => a + Number(r.total_collected), 0))}</div>
              </div>
              <div className="bg-red-50 rounded-lg p-2 text-center">
                <div className="text-[9px] text-slate-500">Outstanding</div>
                <div className="text-sm font-bold text-red-500">{fE(invoices.filter(s => s.customer_name === selectedCustomer).reduce((a, r) => a + Number(r.outstanding), 0))}</div>
              </div>
            </div>
            <InvoiceTable
              data={invoices.filter(s => s.customer_name === selectedCustomer)}
              onSelect={setSelectedInvoice}
            />
          </div>
        )}

        {/* ==========================================
            TREASURY TAB
        ========================================== */}
        {tab === 'treasury' && (
          <div>
            <div className="flex justify-between flex-wrap gap-2 mb-3">
              <h2 className="text-xl font-extrabold">Treasury / الخزنة</h2>
              <div className="flex gap-2 items-center flex-wrap">
                <ModeBar />
                <button onClick={() => setShowAddTreasury(true)}
                  className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-semibold hover:bg-blue-600">
                  + New Transaction
                </button>
              </div>
            </div>
            <div className="mb-3">
              <input value={query} onChange={e => setQuery(e.target.value)}
                placeholder="Search order #, description, date / بحث"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
            </div>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div onClick={() => setTreasuryDrill('in')} className="bg-white rounded-lg p-3 cursor-pointer hover:shadow-md" style={{ borderLeftWidth: 3, borderLeftColor: '#10b981' }}>
                <div className="text-[10px] text-slate-500">Cash In / وارد</div>
                <div className="text-lg font-extrabold">{fE(totalCashIn)}</div>
              </div>
              <div onClick={() => setTreasuryDrill('out')} className="bg-white rounded-lg p-3 cursor-pointer hover:shadow-md" style={{ borderLeftWidth: 3, borderLeftColor: '#ef4444' }}>
                <div className="text-[10px] text-slate-500">Cash Out / منصرف</div>
                <div className="text-lg font-extrabold">{fE(totalCashOut)}</div>
              </div>
              <div className="bg-white rounded-lg p-3" style={{ borderLeftWidth: 3, borderLeftColor: totalCashIn > totalCashOut ? '#10b981' : '#ef4444' }}>
                <div className="text-[10px] text-slate-500">Net / صافي</div>
                <div className="text-lg font-extrabold">{fE(totalCashIn - totalCashOut)}</div>
              </div>
            </div>
            {query && (
              <div className="bg-white rounded-xl p-4 mb-3">
                <h3 className="text-sm font-bold mb-2">Search Results ({filteredTreasury.filter(t => {
                  const words = query.split(/\s+/).filter(w => w.length > 0);
                  const hay = [t.order_number || '', t.description || '', t.transaction_date || '', String(t.cash_in || 0), String(t.cash_out || 0)].join(' ');
                  return words.every(w => hay.includes(w));
                }).length})</h3>
                <div className="overflow-auto max-h-[400px] rounded-lg border border-slate-200">
                  <table className="w-full border-collapse">
                    <thead><tr className="bg-slate-50 sticky top-0">
                      <th className="px-2 py-2 text-xs text-left">Date</th>
                      <th className="px-2 py-2 text-xs">Order</th>
                      <th className="px-2 py-2 text-xs" style={{ direction: 'rtl' }}>Description</th>
                      <th className="px-2 py-2 text-xs text-right">In</th>
                      <th className="px-2 py-2 text-xs text-right">Out</th>
                    </tr></thead>
                    <tbody>
                      {filteredTreasury.filter(t => {
                        const words = query.split(/\s+/).filter(w => w.length > 0);
                        const hay = [t.order_number || '', t.description || '', t.transaction_date || '', String(t.cash_in || 0), String(t.cash_out || 0)].join(' ');
                        return words.every(w => hay.includes(w));
                      }).slice(0, 200).map(txn => (
                        <tr key={txn.id} className="border-b border-slate-50">
                          <td className="px-2 py-1.5 text-xs">{txn.transaction_date}</td>
                          <td className="px-2 py-1.5 text-xs font-semibold text-center">{txn.order_number || ''}</td>
                          <td className="px-2 py-1.5 text-xs" style={{ direction: 'rtl' }}>{txn.description}</td>
                          <td className="px-2 py-1.5 text-xs text-right text-emerald-600 font-semibold">
                            {txn.cash_in > 0 ? fE(txn.cash_in) : ''}
                          </td>
                          <td className="px-2 py-1.5 text-xs text-right text-red-500 font-semibold">
                            {txn.cash_out > 0 ? fE(txn.cash_out) : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div className="bg-white rounded-xl p-4">
              <h3 className="text-sm font-bold mb-2">Expense Buckets / تصنيف المنصرفات</h3>
              {expenseBuckets.map((e, i) => (
                <div key={e.cat} className="flex justify-between py-1.5 border-b border-slate-50 text-xs cursor-pointer hover:bg-slate-50">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                    <span>{e.eng}</span>
                  </div>
                  <span className="font-bold">{fE(e.total)} →</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ==========================================
            CHECKS TAB
        ========================================== */}
        {tab === 'checks' && (
          <div>
            <h2 className="text-xl font-extrabold mb-2">Checks / شيكات</h2>
            <div className="flex gap-2 mb-3">
              <button onClick={() => setCheckView('pending')}
                className={`px-4 py-2 rounded-lg font-semibold text-xs transition ${checkView === 'pending' ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
                Pending / معلقة ({pendingChecks.length})
              </button>
              <button onClick={() => setCheckView('done')}
                className={`px-4 py-2 rounded-lg font-semibold text-xs transition ${checkView === 'done' ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
                Collected / محصّلة ({collectedChecks.length})
              </button>
            </div>
            <div className="overflow-auto rounded-lg border border-slate-200">
              <table className="w-full border-collapse">
                <thead><tr className="bg-slate-50">
                  <th className="px-3 py-2 text-xs" style={{ direction: 'rtl' }}>Customer</th>
                  <th className="px-3 py-2 text-xs text-right">Amount</th>
                  <th className="px-3 py-2 text-xs">Check</th>
                  <th className="px-3 py-2 text-xs">{checkView === 'done' ? 'Collected' : ''}</th>
                </tr></thead>
                <tbody>
                  {(checkView === 'pending' ? pendingChecks : collectedChecks).map(c => (
                    <tr key={c.id} className="border-b border-slate-50">
                      <td className="px-3 py-2 text-xs font-semibold" style={{ direction: 'rtl' }}>{c.customer_name}</td>
                      <td className="px-3 py-2 text-xs text-right font-semibold">{fE(c.amount)}</td>
                      <td className="px-3 py-2 text-xs">{c.check_date}</td>
                      <td className="px-3 py-2">
                        {checkView === 'pending' ? (
                          <button onClick={() => { setReconcileCheck(c); setFormData({}); }}
                            className="px-3 py-1 bg-blue-500 text-white rounded text-[10px] font-semibold">
                            Reconcile / تسوية
                          </button>
                        ) : (
                          <span className="text-emerald-500 text-xs">{c.collection_date} ✓</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ==========================================
            DEBTS TAB
        ========================================== */}
        {tab === 'debts' && !selectedDebtor && (
          <div>
            <h2 className="text-xl font-extrabold mb-2">Debts / المديونية — {fE(totalDebt)}</h2>
            <div className="overflow-auto rounded-lg border border-slate-200">
              <table className="w-full border-collapse">
                <thead><tr className="bg-slate-50">
                  <th className="px-3 py-2 text-xs" style={{ direction: 'rtl' }}>Customer</th>
                  <th className="px-3 py-2 text-xs text-right">Debt</th>
                </tr></thead>
                <tbody>
                  {debts.map(d => (
                    <tr key={d.id} onClick={() => setSelectedDebtor(d.customer_name)}
                      className="border-b border-slate-50 cursor-pointer hover:bg-blue-50">
                      <td className="px-3 py-2 text-xs font-semibold" style={{ direction: 'rtl' }}>{d.customer_name}</td>
                      <td className="px-3 py-2 text-xs text-right font-semibold text-red-500">{fE(d.total_debt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {tab === 'debts' && selectedDebtor && (
          <div>
            <button onClick={() => setSelectedDebtor(null)}
              className="px-3 py-1 rounded border border-slate-200 text-xs font-semibold mb-3">← رجوع</button>
            <h3 className="text-xl font-extrabold mb-3" style={{ direction: 'rtl' }}>{selectedDebtor}</h3>
            <InvoiceTable
              data={invoices.filter(s => s.customer_name && s.customer_name.includes(selectedDebtor) && s.outstanding > 0)}
              onSelect={setSelectedInvoice}
            />
          </div>
        )}

        {/* ==========================================
            WAREHOUSE TAB
        ========================================== */}
        {tab === 'warehouse' && (
          <div>
            <h2 className="text-xl font-extrabold mb-3">Warehouse / عهدة المخزن</h2>
            <ModeBar />
            <div className="bg-white rounded-xl p-4 mt-3 mb-3" style={{ borderLeftWidth: 3, borderLeftColor: '#8b5cf6' }}>
              <div className="text-[10px] text-slate-500">Total / الإجمالي</div>
              <div className="text-2xl font-extrabold text-purple-600">
                {fE(warehouse.filter(w => inRange(w.expense_date, mode, df, dt)).reduce((a, w) => a + Number(w.amount), 0))}
              </div>
            </div>
            <div className="overflow-auto rounded-lg border border-slate-200 max-h-[400px]">
              <table className="w-full border-collapse">
                <thead className="sticky top-0"><tr className="bg-slate-50">
                  <th className="px-3 py-2 text-xs text-left">Date</th>
                  <th className="px-3 py-2 text-xs" style={{ direction: 'rtl' }}>Description</th>
                  <th className="px-3 py-2 text-xs text-right">Amount</th>
                  <th className="px-3 py-2 text-xs">Ref</th>
                </tr></thead>
                <tbody>
                  {warehouse.filter(w => inRange(w.expense_date, mode, df, dt)).map(w => (
                    <tr key={w.id} className="border-b border-slate-50">
                      <td className="px-3 py-2 text-xs">{w.expense_date}</td>
                      <td className="px-3 py-2 text-xs" style={{ direction: 'rtl' }}>{w.description}</td>
                      <td className="px-3 py-2 text-xs text-right font-semibold text-purple-600">{fE(w.amount)}</td>
                      <td className="px-3 py-2 text-xs">{w.america_ref || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ==========================================
            CRM TAB
        ========================================== */}
        {tab === 'crm' && (
          <div>
            <div className="flex justify-between flex-wrap gap-2 mb-3">
              <h2 className="text-xl font-extrabold">CRM / إدارة العملاء</h2>
              <div className="flex gap-2">
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="بحث" className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs w-28" />
                <button className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-semibold">+ Client</button>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {customers.map(c => (
                <div key={c.id} className="bg-white rounded-lg p-3 cursor-pointer border border-slate-200 hover:shadow-md transition">
                  <div className="text-sm font-bold" style={{ direction: 'rtl' }}>{c.name}</div>
                  <div className="text-xs text-slate-500 mt-1">{c.phone || ''}</div>
                  {c.client_type && <span className="inline-block mt-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[8px] font-semibold">{c.client_type}</span>}
                  {c.group_name && <span className="inline-block mt-1 ml-1 px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-[8px] font-semibold">{c.group_name}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ==========================================
            TICKETS TAB
        ========================================== */}
        {tab === 'tickets' && (
          <div>
            <div className="flex justify-between flex-wrap gap-2 mb-3">
              <h2 className="text-xl font-extrabold">Tickets / التذاكر</h2>
              <button className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-semibold">+ New Ticket</button>
            </div>
            <div className="bg-white rounded-xl p-6 text-center text-slate-400">
              <p className="text-4xl mb-2">🎫</p>
              <p className="text-sm font-semibold">Ticket system ready</p>
              <p className="text-xs mt-1">Create tickets, assign to team, track status workflow</p>
              <p className="text-xs mt-1">New → Acknowledged → In Progress → Review → Closed</p>
            </div>
          </div>
        )}

        {/* ==========================================
            CALENDAR TAB
        ========================================== */}
        {tab === 'calendar' && (
          <div>
            <div className="flex justify-between flex-wrap gap-2 mb-3">
              <h2 className="text-xl font-extrabold">Calendar / التقويم</h2>
              <button className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-semibold">+ Event</button>
            </div>
            <div className="bg-white rounded-xl p-6 text-center text-slate-400">
              <p className="text-4xl mb-2">📅</p>
              <p className="text-sm font-semibold">Calendar ready</p>
              <p className="text-xs mt-1">Day and month views, recurring events, team calendar</p>
            </div>
          </div>
        )}

        {/* ==========================================
            DAILY LOG TAB
        ========================================== */}
        {tab === 'dailylog' && (
          <div>
            <div className="flex justify-between flex-wrap gap-2 mb-3">
              <h2 className="text-xl font-extrabold">Daily Log / السجل اليومي</h2>
              <button className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-semibold">+ Log Entry</button>
            </div>
            <div className="bg-white rounded-xl p-6 text-center text-slate-400">
              <p className="text-4xl mb-2">📓</p>
              <p className="text-sm font-semibold">Daily activity log ready</p>
              <p className="text-xs mt-1">Auto-captures all actions, manual entries, team view for admin</p>
            </div>
          </div>
        )}

        {/* ==========================================
            ADMIN TAB
        ========================================== */}
        {tab === 'admin' && (
          <div>
            <h2 className="text-xl font-extrabold mb-3">Admin Dashboard / لوحة الإدارة</h2>
            <div className="bg-white rounded-xl p-6 text-center text-slate-400">
              <p className="text-4xl mb-2">👑</p>
              <p className="text-sm font-semibold">Admin dashboard ready</p>
              <p className="text-xs mt-1">Team activity feeds, performance stats, date filters</p>
              <p className="text-xs mt-1">Filter by team member, see all actions, notification logs</p>
            </div>
          </div>
        )}

        {/* ==========================================
            SETTINGS TAB
        ========================================== */}
        {tab === 'settings' && (
          <div>
            <h2 className="text-xl font-extrabold mb-3">Settings / إعدادات</h2>
            <div className="bg-white rounded-xl p-4 mb-3">
              <h3 className="text-sm font-bold mb-2">Role Hierarchy</h3>
              <div className="space-y-1 text-xs">
                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-red-500"></span> Super Admin — sees everything</div>
                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-purple-500"></span> Admin/Manager — sees their team</div>
                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-blue-500"></span> Team Member — sees own data</div>
              </div>
            </div>
            <div className="bg-white rounded-xl p-4 mb-3">
              <h3 className="text-sm font-bold mb-2">Module Access / صلاحيات</h3>
              <p className="text-xs text-slate-500">Toggle which modules each user can see (Financial, CRM, Tickets, Calendar, etc.)</p>
            </div>
            <div className="bg-white rounded-xl p-4 mb-3">
              <h3 className="text-sm font-bold mb-2">Email Notifications / إشعارات</h3>
              <p className="text-xs text-slate-500">Per-user, per-notification-type toggle matrix</p>
            </div>
            <div className="bg-white rounded-xl p-4">
              <h3 className="text-sm font-bold mb-2">Team Management / إدارة الفريق</h3>
              <p className="text-xs text-slate-500">Add/edit team members, assign roles, set reporting lines</p>
            </div>
          </div>
        )}


                {/* ==========================================
            IMPORT TAB
        ========================================== */}
        {tab === 'import' && (
          <div>
            <h2 className="text-xl font-extrabold mb-3">Import / استيراد البيانات</h2>
            <div className="bg-white rounded-xl p-4 mb-4">
              <h3 className="text-sm font-bold mb-3">Import Types / أنواع الاستيراد</h3>
              <div className="space-y-2">
                <div className="bg-blue-50 rounded-lg p-3">
                  <div className="text-xs font-bold text-blue-700">1. Override / استبدال كامل</div>
                  <div className="text-[10px] text-slate-500">Replace all data with new file</div>
                </div>
                <div className="bg-emerald-50 rounded-lg p-3">
                  <div className="text-xs font-bold text-emerald-700">2. Insert / إضافة جديد</div>
                  <div className="text-[10px] text-slate-500">Add new transactions within existing periods</div>
                </div>
                <div className="bg-amber-50 rounded-lg p-3">
                  <div className="text-xs font-bold text-amber-700">3. Append / إلحاق من تاريخ</div>
                  <div className="text-[10px] text-slate-500">Add data from last recorded date forward</div>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-xl p-4">
              <h3 className="text-sm font-bold mb-3">File Templates / قوالب الملفات</h3>
              {['Treasury / الخزنة', 'Sales / المبيعات', 'Merchandiser / الأوامر', 'Checks / شيكات', 'Warehouse / المخزن'].map((f, i) => (
                <div key={i} className="flex justify-between items-center py-3 border-b border-slate-100">
                  <div>
                    <div className="text-xs font-semibold">{f}</div>
                    <div className="text-[10px] text-slate-400">Excel (.xlsx)</div>
                  </div>
                  <label className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-semibold cursor-pointer hover:bg-blue-600">
                    Upload
                    <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files[0];
                        if (!file) return;
                        alert(`File "${file.name}" selected. Import processing will be available soon.`);
                      }} />
                  </label>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
