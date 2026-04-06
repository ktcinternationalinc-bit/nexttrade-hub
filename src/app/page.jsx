'use client';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase, dbInsert, dbUpdate, dbDelete } from '../lib/supabase';
import { fmt, fE, COLORS, EXPENSE_CATS, getReconStatus, STATUS_STYLES, today, inRange, monthOf, getWarehouseCat } from '../lib/utils';
import * as XLSX from 'xlsx';
import CRMTab from '../components/CRMTab';
import TicketsTab from '../components/TicketsTab';
import CalendarTab from '../components/CalendarTab';
import DailyLogTab from '../components/DailyLogTab';
import AdminTab from '../components/AdminTab';
import SettingsTab from '../components/SettingsTab';
import CustomsTab from '../components/CustomsTab';
import PersonalDashboard from '../components/PersonalDashboard';
import AIAssistant from '../components/AIAssistant';
import ShippingRatesTab from '../components/ShippingRatesTab';
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
  { id: 'inventory', label: 'Inventory / المخزون', icon: '📦' },
  { id: 'crm', label: 'CRM', icon: '🤝' },
  { id: 'tickets', label: 'Tickets / تذاكر', icon: '🎫' },
  { id: 'calendar', label: 'Calendar / تقويم', icon: '📅' },
  { id: 'customs', label: 'Customs / جمارك', icon: '🚢' },
  { id: 'shipping', label: 'Shipping Rates / شحن', icon: '🛳️' },
  { id: 'dailylog', label: 'Daily Log / يومي', icon: '📓' },
  { id: 'admin', label: 'Admin / إدارة', icon: '👑' },
  { id: 'ai', label: 'AI Assistant / ذكي', icon: '🤖' },
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
  const [mode, setMode] = useState('all');
  const [df, setDf] = useState('2010-01-01');
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
  const [expenseRules, setExpenseRules] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [teamUsers, setTeamUsers] = useState([]);
  const [userProfile, setUserProfile] = useState(null);
  const [modulePerms, setModulePerms] = useState({});
  const [lang, setLang] = useState('ar'); // 'ar' or 'en'

  // Translation helper — picks English text when available and lang is 'en'
  const tx = (arText, enText) => (lang === 'en' && enText) ? enText : (arText || '');
  const txCat = (arCat) => lang === 'en' ? (EXPENSE_CATS[arCat] || arCat || 'Uncategorized') : (arCat || 'Uncategorized');

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
  const [bucketSub, setBucketSub] = useState(null);
  const [bucketSearch, setBucketSearch] = useState('');
  const [editSubTxnId, setEditSubTxnId] = useState(null);
  const [editSubValue, setEditSubValue] = useState('');
  const [renamingBucket, setRenamingBucket] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [warehouseDrill, setWarehouseDrill] = useState(null);
  const [customerGroup, setCustomerGroup] = useState('all');

  // Forms
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [showAddInvoice, setShowAddInvoice] = useState(false);
  const [showAddTreasury, setShowAddTreasury] = useState(false);
  const [editingTxn, setEditingTxn] = useState(null);
  const [splittingTxn, setSplittingTxn] = useState(null);
  const [splits, setSplits] = useState([{ order: '', amount: 0 }, { order: '', amount: 0 }]);
  const [linkSearch, setLinkSearch] = useState('');
  const [showLinkSearch, setShowLinkSearch] = useState(false);
  const [formData, setFormData] = useState({});

  // Import
  const [importStep, setImportStep] = useState('select'); // select, preview, importing, done
  const [importType, setImportType] = useState(null);
  const [importData, setImportData] = useState([]);
  const [importStats, setImportStats] = useState(null);
  const [importProgress, setImportProgress] = useState(0);

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
      const [inv, tres, chk, dbt, cust, wh, items, rules, stock] = await Promise.all([
        fetchAll('invoices', 'invoice_date'),
        fetchAll('treasury', 'transaction_date'),
        fetchAll('checks', 'check_date', true),
        fetchAll('debts', 'total_debt'),
        fetchAll('customers', 'name', true),
        fetchAll('warehouse_expenses', 'expense_date'),
        fetchAll('invoice_items', 'created_at', true),
        fetchAll('expense_rules', 'created_at', true),
        fetchAll('inventory', 'created_at', true),
      ]);
      // Load team users separately (may not exist yet)
      try {
        const { data: usrs } = await supabase.from('users').select('*').eq('active', true).order('name');
        setTeamUsers(usrs || []);
        // Find current user's profile
        const authUser = (await supabase.auth.getUser())?.data?.user;
        if (authUser && usrs) {
          const profile = usrs.find(u => u.email === authUser.email);
          if (profile) setUserProfile(profile);
        }
        // Load module permissions for current user
        if (authUser) {
          const { data: perms } = await supabase.from('module_permissions').select('*');
          const permMap = {};
          (perms || []).forEach(p => { permMap[p.module_name] = p.has_access; });
          setModulePerms(permMap);
        }
      } catch(e) { console.log('Users table not ready'); }
      setInvoices(inv);
      setTreasury(tres);
      setChecks(chk);
      setDebts(dbt);
      setCustomers(cust);
      setWarehouse(wh);
      setInvoiceItems(items);
      setExpenseRules(rules);
      setInventory(stock);
    } catch (err) {
      console.error('Load error:', err);
    }
  };

  // ==========================================
  // COMPUTED VALUES
  // ==========================================
  const isAdmin = !userProfile || userProfile.role === 'super_admin' || userProfile.role === 'admin';

  // Tab-to-module mapping for permission filtering
  const TAB_MODULE_MAP = {
    dashboard: 'Dashboard', sales: 'Sales', customers: 'Customers', treasury: 'Treasury',
    checks: 'Checks', debts: 'Debts', warehouse: 'Warehouse', inventory: 'Inventory',
    crm: 'CRM', tickets: 'Tickets', calendar: 'Calendar', customs: 'Customs', shipping: 'Shipping Rates',
    dailylog: 'Daily Log', admin: 'Admin', ai: 'AI Assistant', settings: 'Settings', import: 'Import',
  };

  const visibleTabs = useMemo(() => {
    if (!userProfile || userProfile.role === 'super_admin') return TABS; // super admin sees all
    return TABS.filter(t => {
      // Admin always sees admin-level tabs
      if (userProfile.role === 'admin' && ['dashboard', 'admin', 'settings'].includes(t.id)) return true;
      // Everyone sees their own core tabs
      if (['dashboard', 'crm', 'tickets', 'calendar', 'dailylog'].includes(t.id)) return true;
      // Check module permissions (default to true if not explicitly set)
      const moduleName = TAB_MODULE_MAP[t.id];
      if (moduleName && modulePerms[moduleName] !== undefined) return modulePerms[moduleName];
      // If no permission set, admins see all, team members see non-financial
      if (userProfile.role === 'admin') return true;
      // Team members: hide financial tabs by default
      if (['treasury', 'checks', 'debts', 'sales', 'warehouse', 'inventory', 'admin', 'settings', 'import'].includes(t.id)) return false;
      return true;
    });
  }, [userProfile, modulePerms]);

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

  // Expense/Income buckets (dual-level for both Cash In and Cash Out)
  const expenseBuckets = useMemo(() => {
    const cats = {};
    filteredTreasury.forEach(t => {
      if (t.cash_out > 0) {
        const cat = t.category || 'Operations';
        const sub = t.subcategory || '';
        if (!cats[cat]) cats[cat] = { total: 0, count: 0, subs: {} };
        cats[cat].total += Number(t.cash_out);
        cats[cat].count++;
        if (sub) {
          if (!cats[cat].subs[sub]) cats[cat].subs[sub] = { total: 0, count: 0 };
          cats[cat].subs[sub].total += Number(t.cash_out);
          cats[cat].subs[sub].count++;
        }
      }
    });
    return Object.entries(cats)
      .map(([cat, data]) => ({ cat, eng: EXPENSE_CATS[cat] || cat, ...data }))
      .sort((a, b) => b.total - a.total);
  }, [filteredTreasury]);

  const incomeBuckets = useMemo(() => {
    const cats = {};
    filteredTreasury.forEach(t => {
      if (t.cash_in > 0) {
        const cat = t.category || 'Customer Payment';
        const sub = t.subcategory || '';
        if (!cats[cat]) cats[cat] = { total: 0, count: 0, subs: {} };
        cats[cat].total += Number(t.cash_in);
        cats[cat].count++;
        if (sub) {
          if (!cats[cat].subs[sub]) cats[cat].subs[sub] = { total: 0, count: 0 };
          cats[cat].subs[sub].total += Number(t.cash_in);
          cats[cat].subs[sub].count++;
        }
      }
    });
    return Object.entries(cats)
      .map(([cat, data]) => ({ cat, eng: EXPENSE_CATS[cat] || cat, ...data }))
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

  // Month transactions for drill-down (filtered by in/out/net)
  const monthTransactions = useMemo(() => {
    if (!selectedMonth) return [];
    return filteredTreasury
      .filter(t => monthOf(t.transaction_date) === selectedMonth)
      .filter(t => {
        if (treasuryDrill === 'in') return Number(t.cash_in) > 0;
        if (treasuryDrill === 'out') return Number(t.cash_out) > 0;
        return true; // 'net' shows all
      })
      .sort((a, b) => a.transaction_date.localeCompare(b.transaction_date));
  }, [selectedMonth, filteredTreasury, treasuryDrill]);

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
      alert('Error / خطأ: ' + err.message);
    }
  };

  // ========== RECONCILIATION REPORT GENERATOR ==========
  const generateReconReport = () => {
    const wb = XLSX.utils.book_new();
    const now = new Date().toLocaleDateString();

    // 1. Categorize all invoices
    const mismatch = [], unverified = [], overpaid = [], overdue = [];
    invoices.forEach(inv => {
      const txns = treasuryByOrder[inv.order_number] || [];
      const tTotal = txns.reduce((a, t) => a + Number(t.cash_in || 0), 0);
      const status = getReconStatus(inv, tTotal);
      const row = {
        'Order # / رقم الأمر': inv.order_number,
        'Customer / العميل': inv.customer_name,
        'Date / التاريخ': inv.invoice_date,
        'Invoice Amount / مبلغ الفاتورة': Number(inv.total_amount || 0),
        'Collected (Sales) / المحصّل': Number(inv.total_collected || 0),
        'Treasury Total / الخزنة': tTotal,
        'Outstanding / المتبقّي': Number(inv.outstanding || 0),
        'Status / الحالة': status.toUpperCase(),
        'Difference / الفرق': Math.abs(tTotal - Number(inv.total_collected || 0)),
      };
      if (status === 'mismatch') mismatch.push(row);
      if (status === 'unverified') unverified.push(row);
      if (status === 'overpaid') { row['Overpaid Amount / المبلغ الزائد'] = tTotal - Number(inv.total_amount || 0); overpaid.push(row); }
      if (status === 'open' && Number(inv.outstanding || 0) > 0) overdue.push(row);
    });

    // 2. Treasury deposits without order number
    const noOrder = treasury
      .filter(t => !t.order_number && Number(t.cash_in || 0) > 0)
      .map(t => ({
        'Date / التاريخ': t.transaction_date,
        'Amount / المبلغ': Number(t.cash_in || 0),
        'Description / الوصف': t.description || '',
        'Category / الفئة': t.category || 'N/A',
      }));

    // 3. Treasury entries without category
    const noCat = treasury
      .filter(t => !t.category || t.category === '')
      .map(t => ({
        'Date / التاريخ': t.transaction_date,
        'Cash In / وارد': Number(t.cash_in || 0),
        'Cash Out / صادر': Number(t.cash_out || 0),
        'Description / الوصف': t.description || '',
        'Order # / رقم الأمر': t.order_number || '',
      }));

    // 4. Summary sheet
    const summary = [
      { 'Category / الفئة': 'Total Invoices / إجمالي الفواتير', 'Count / العدد': invoices.length, 'Amount / المبلغ': invoices.reduce((a, i) => a + Number(i.total_amount || 0), 0) },
      { 'Category / الفئة': 'Mismatch / عدم تطابق', 'Count / العدد': mismatch.length, 'Amount / المبلغ': mismatch.reduce((a, r) => a + r['Invoice Amount / مبلغ الفاتورة'], 0) },
      { 'Category / الفئة': 'Unverified / غير مؤكد', 'Count / العدد': unverified.length, 'Amount / المبلغ': unverified.reduce((a, r) => a + r['Invoice Amount / مبلغ الفاتورة'], 0) },
      { 'Category / الفئة': 'Overpaid / دفع زائد', 'Count / العدد': overpaid.length, 'Amount / المبلغ': overpaid.reduce((a, r) => a + r['Invoice Amount / مبلغ الفاتورة'], 0) },
      { 'Category / الفئة': 'Overdue (Outstanding) / متأخرة', 'Count / العدد': overdue.length, 'Amount / المبلغ': overdue.reduce((a, r) => a + r['Outstanding / المتبقّي'], 0) },
      { 'Category / الفئة': 'Deposits Without Order / إيداعات بدون أمر', 'Count / العدد': noOrder.length, 'Amount / المبلغ': noOrder.reduce((a, r) => a + r['Amount / المبلغ'], 0) },
      { 'Category / الفئة': 'Entries Without Category / بدون فئة', 'Count / العدد': noCat.length, 'Amount / المبلغ': '' },
      { 'Category / الفئة': '', 'Count / العدد': '', 'Amount / المبلغ': '' },
      { 'Category / الفئة': 'Report Generated / تاريخ التقرير', 'Count / العدد': now, 'Amount / المبلغ': '' },
    ];

    const addSheet = (name, data) => { if (data.length > 0) { const ws = XLSX.utils.json_to_sheet(data); ws['!cols'] = Object.keys(data[0]).map(() => ({ wch: 22 })); XLSX.utils.book_append_sheet(wb, ws, name); } };

    addSheet('Summary', summary);
    addSheet('Mismatch', mismatch);
    addSheet('Unverified', unverified);
    addSheet('Overpaid', overpaid);
    addSheet('Overdue', overdue);
    addSheet('No Order #', noOrder);
    addSheet('No Category', noCat);

    XLSX.writeFile(wb, 'KTC_Reconciliation_Report_' + new Date().toISOString().substring(0, 10) + '.xlsx');
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
      alert('Error / خطأ: ' + err.message);
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
        subcategory: formData.subcategory || '',
      }, user?.id);
      setShowAddTreasury(false);
      setFormData({});
      await loadAllData();
    } catch (err) {
      alert('Error / خطأ: ' + err.message);
    }
  };

  const handleEditTreasury = async (txn) => {
    try {
      const updates = {
        transaction_date: formData.date || txn.transaction_date,
        description: formData.desc || txn.description,
        cash_in: formData.cashIn != null ? Number(formData.cashIn) : txn.cash_in,
        cash_out: formData.cashOut != null ? Number(formData.cashOut) : txn.cash_out,
        order_number: formData.orderNumber != null ? formData.orderNumber : txn.order_number,
        category: formData.category != null ? formData.category : txn.category,
        subcategory: formData.subcategory != null ? formData.subcategory : txn.subcategory,
      };
      await dbUpdate('treasury', txn.id, updates, user?.id);

      // Smart categorization: if category changed, offer to apply to all with EXACT same description
      if (formData.category && formData.category !== txn.category) {
        const desc = (txn.description || '').trim();
        if (desc) {
          const matching = treasury.filter(t =>
            t.id !== txn.id &&
            (t.description || '').trim() === desc &&
            t.category !== formData.category
          );
          if (matching.length > 0 && confirm('Apply "' + (EXPENSE_CATS[formData.category] || formData.category) + '" to ' + matching.length + ' transactions with exact same description?\n\n"' + desc + '"\n\nتطبيق على جميع المعاملات بنفس الوصف بالضبط؟')) {
            for (const m of matching) {
              await dbUpdate('treasury', m.id, {
                category: formData.category,
                subcategory: formData.subcategory || '',
              }, user?.id);
            }
          }
          // Save/update rule with full description
          const existing = expenseRules.find(r => r.description_match === desc);
          if (existing) {
            await dbUpdate('expense_rules', existing.id, {
              category: formData.category,
              subcategory: formData.subcategory || '',
            }, user?.id);
          } else {
            await dbInsert('expense_rules', {
              description_match: desc,
              category: formData.category,
              subcategory: formData.subcategory || '',
            }, user?.id);
          }
        }
      }

      setEditingTxn(null);
      setFormData({});
      await loadAllData();
    } catch (err) {
      alert('Error / خطأ: ' + err.message);
    }
  };

  const handleSplitTreasury = async () => {
    if (!splittingTxn) return;
    const txn = splittingTxn;
    const isIn = Number(txn.cash_in) > 0;
    const total = isIn ? Number(txn.cash_in) : Number(txn.cash_out);
    const splitTotal = splits.reduce((a, s) => a + (Number(s.amount) || 0), 0);
    if (splitTotal !== total) {
      alert('Split amounts must equal / يجب أن يساوي المجموع ' + total.toLocaleString() + '. Current / الحالي: ' + splitTotal.toLocaleString());
      return;
    }
    if (splits.every(s => !s.order)) {
      alert('Please enter at least one order number / الرجاء إدخال رقم أمر واحد على الأقل');
      return;
    }
    try {
      // Update original entry to first split
      await dbUpdate('treasury', txn.id, {
        order_number: splits[0].order,
        cash_in: isIn ? Number(splits[0].amount) : 0,
        cash_out: isIn ? 0 : Number(splits[0].amount),
        description: txn.description + ' (split 1/' + splits.length + ')',
      }, user?.id);
      // Create new entries for remaining splits
      for (let i = 1; i < splits.length; i++) {
        await dbInsert('treasury', {
          transaction_date: txn.transaction_date,
          order_number: splits[i].order,
          description: txn.description + ' (split ' + (i + 1) + '/' + splits.length + ')',
          cash_in: isIn ? Number(splits[i].amount) : 0,
          cash_out: isIn ? 0 : Number(splits[i].amount),
          source: txn.source || 'main',
        }, user?.id);
      }
      setSplittingTxn(null);
      setSplits([{ order: '', amount: 0 }, { order: '', amount: 0 }]);
      await loadAllData();
    } catch (err) {
      alert('Error / خطأ: ' + err.message);
    }
  };

  const handleUnlinkTreasury = async (txn) => {
    if (!confirm('Unlink this transaction from order / إلغاء ربط المعاملة من الأمر ' + (selectedInvoice?.order_number || '') + '?')) return;
    try {
      await dbUpdate('treasury', txn.id, { order_number: '' }, user?.id);
      // Recalculate invoice collected from remaining treasury entries
      if (selectedInvoice) {
        const remaining = treasury.filter(t => t.order_number === selectedInvoice.order_number && t.id !== txn.id);
        const newCollected = remaining.reduce((a, t) => a + Number(t.cash_in || 0), 0);
        await dbUpdate('invoices', selectedInvoice.id, {
          total_collected: newCollected,
          outstanding: Math.max(0, Number(selectedInvoice.total_amount) - newCollected),
          notes: newCollected === 0 ? 'UNVERIFIED: No treasury entries linked' : (selectedInvoice.notes || '').replace('UNVERIFIED:', 'VERIFIED:'),
        }, user?.id);
      }
      await loadAllData();
    } catch (err) {
      alert('Error / خطأ: ' + err.message);
    }
  };

  const handleLinkTreasury = async (txn) => {
    if (!selectedInvoice) return;
    try {
      await dbUpdate('treasury', txn.id, { order_number: selectedInvoice.order_number }, user?.id);
      // Recalculate collected from ALL treasury entries now linked to this order
      const linked = treasury.filter(t => t.order_number === selectedInvoice.order_number);
      const newCollected = linked.reduce((a, t) => a + Number(t.cash_in || 0), 0) + Number(txn.cash_in || 0);
      await dbUpdate('invoices', selectedInvoice.id, {
        total_collected: newCollected,
        outstanding: Math.max(0, Number(selectedInvoice.total_amount) - newCollected),
        notes: (selectedInvoice.notes || '').replace('UNVERIFIED:', 'RECONCILED:'),
      }, user?.id);
      setLinkSearch('');
      setShowLinkSearch(false);
      await loadAllData();
    } catch (err) {
      alert('Error / خطأ: ' + err.message);
    }
  };

  const handleRenameBucket = async (oldName, newName, field) => {
    if (!newName || newName === oldName) { setRenamingBucket(null); return; }
    try {
      const matching = treasury.filter(t => t[field] === oldName);
      if (matching.length === 0) { setRenamingBucket(null); return; }
      for (const t of matching) {
        await dbUpdate('treasury', t.id, { [field]: newName }, user?.id);
      }
      const rules = expenseRules.filter(r => r[field] === oldName);
      for (const r of rules) {
        await dbUpdate('expense_rules', r.id, { [field]: newName }, user?.id);
      }
      setRenamingBucket(null);
      setRenameValue('');
      await loadAllData();
    } catch (err) {
      alert('Error / خطأ: ' + err.message);
    }
  };

  const handleMoveSubcategory = async (subcatName, fromCategory, toCategory) => {
    if (!toCategory || toCategory === fromCategory) return;
    if (!confirm('Move "' + subcatName + '" from "' + fromCategory + '" to "' + toCategory + '"?\n\nنقل التصنيف الفرعي إلى تصنيف آخر؟')) return;
    try {
      const matching = treasury.filter(t => t.subcategory === subcatName && t.category === fromCategory);
      for (const t of matching) {
        await dbUpdate('treasury', t.id, { category: toCategory }, user?.id);
      }
      setBucketSub(null);
      await loadAllData();
    } catch (err) {
      alert('Error / خطأ: ' + err.message);
    }
  };

  const processImportFile = async (file) => {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data);

    // Auto-detect file type from first sheet columns
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
    if (rows.length < 2) { alert('Empty file / ملف فارغ'); return; }

    const header = rows[0].map(h => String(h || '').trim());
    const headerStr = header.join(' ').toLowerCase();

    let detected = null;
    let parsed = [];

    // Detect Treasury: has cash_in/cash_out columns or وارد/منصرف
    if (headerStr.includes('وارد') || headerStr.includes('منصرف') || headerStr.includes('cash')) {
      detected = 'treasury';
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r || !r[0]) continue;
        const dateVal = r[0];
        let d = '';
        if (typeof dateVal === 'number') {
          const dt = XLSX.SSF.parse_date_code(dateVal);
          d = dt.y + '-' + String(dt.m).padStart(2,'0') + '-' + String(dt.d).padStart(2,'0');
        } else { d = String(dateVal).substring(0, 10); }
        parsed.push({ transaction_date: d, order_number: String(r[1] || ''), description: String(r[2] || ''), cash_in: Number(r[3]) || 0, cash_out: Number(r[4]) || 0, source: 'import' });
      }
    }
    // Detect Sales: has amount/paid/remaining or اجمالى/مسدد/متبقى
    else if (headerStr.includes('مسدد') || headerStr.includes('متبق') || headerStr.includes('paid') || headerStr.includes('remaining')) {
      detected = 'sales';
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r || !r[0]) continue;
        const dateVal = r[0];
        let d = '';
        if (typeof dateVal === 'number') {
          const dt = XLSX.SSF.parse_date_code(dateVal);
          d = dt.y + '-' + String(dt.m).padStart(2,'0') + '-' + String(dt.d).padStart(2,'0');
        } else { d = String(dateVal).substring(0, 10); }
        const amt = Number(r[3] || r[2]) || 0;
        const paid = Number(r[4] || r[3]) || 0;
        parsed.push({ invoice_date: d, order_number: String(r[1] || ''), customer_name: String(r[2] || r[1] || ''), total_amount: amt, total_collected: paid, outstanding: Math.max(0, amt - paid), source: 'import' });
      }
    }
    // Detect Warehouse: simple date/description/amount
    else if (wb.SheetNames.length === 1 && header.length <= 5) {
      detected = 'warehouse';
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r || !r[0]) continue;
        const dateVal = r[0];
        let d = '';
        if (typeof dateVal === 'number') {
          const dt = XLSX.SSF.parse_date_code(dateVal);
          d = dt.y + '-' + String(dt.m).padStart(2,'0') + '-' + String(dt.d).padStart(2,'0');
        } else { d = String(dateVal).substring(0, 10); }
        parsed.push({ expense_date: d, description: String(r[1] || ''), amount: Number(r[2]) || 0 });
      }
    }
    // Detect Merchandiser: multiple sheets with product data
    else if (wb.SheetNames.length > 5) {
      detected = 'merchandiser';
      for (const sn of wb.SheetNames) {
        const sheet = wb.Sheets[sn];
        const sRows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        for (let i = 1; i < sRows.length; i++) {
          const r = sRows[i];
          if (!r || !r[0] || !String(r[0]).match(/\d/)) continue;
          const desc = String(r[4] || '');
          if (desc.includes('اجمالى') || desc.includes('اجمالي')) continue;
          parsed.push({ customer: sn, order_number: String(r[0]).replace(/[^\d/\-]/g, ''), description: (String(r[3] || '') + ' ' + desc).trim(), quantity: Number(r[5]) || 0, unit_price: Number(r[6]) || 0, line_total: Number(r[7]) || 0 });
        }
      }
    }
    // Detect Checks
    else if (headerStr.includes('شيك') || headerStr.includes('check')) {
      detected = 'checks';
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r || !r[0]) continue;
        parsed.push({ customer_name: String(r[0] || ''), order_number: String(r[1] || ''), amount: Number(r[2]) || 0, check_date: String(r[3] || ''), status: 'pending' });
      }
    }

    if (!detected) {
      alert('Could not detect file type / لم يتم التعرف على نوع الملف. Please check the format.');
      return;
    }

    setImportType(detected);
    setImportData(parsed);
    setImportStats({ total: parsed.length, newCount: parsed.length, file: file.name });
    setImportStep('preview');
  };

  const executeImport = async () => {
    setImportStep('importing');
    setImportProgress(0);
    const batch = 50;
    let imported = 0;
    let skipped = 0;
    const importedIds = [];
    const tableName = importType === 'treasury' ? 'treasury' : importType === 'sales' ? 'invoices' : importType === 'warehouse' ? 'warehouse_expenses' : importType === 'checks' ? 'checks' : importType === 'merchandiser' ? 'invoice_items' : '';

    try {
      for (let i = 0; i < importData.length; i += batch) {
        const chunk = importData.slice(i, i + batch);
        for (const row of chunk) {
          try {
            let result;
            if (importType === 'treasury') {
              const rule = expenseRules.find(r => (row.description || '').includes(r.description_match));
              if (rule) { row.category = rule.category; row.subcategory = rule.subcategory || ''; }
              result = await dbInsert('treasury', row, user?.id);
            } else if (importType === 'sales') {
              const existing = invoices.find(inv => inv.order_number === row.order_number);
              if (existing) { skipped++; continue; }
              result = await dbInsert('invoices', row, user?.id);
            } else if (importType === 'warehouse') {
              result = await dbInsert('warehouse_expenses', row, user?.id);
            } else if (importType === 'checks') {
              result = await dbInsert('checks', row, user?.id);
            } else if (importType === 'merchandiser') {
              const inv = invoices.find(inv => inv.order_number === row.order_number);
              if (inv) {
                result = await dbInsert('invoice_items', { invoice_id: inv.id, description: row.description, quantity: row.quantity, unit_price: row.unit_price, line_total: row.line_total }, user?.id);
              } else { skipped++; continue; }
            }
            if (result?.id) importedIds.push(result.id);
            imported++;
          } catch (e) { skipped++; }
        }
        setImportProgress(Math.round((i + chunk.length) / importData.length * 100));
      }
      // Save import batch for undo
      if (importedIds.length > 0 && tableName) {
        try {
          await supabase.from('import_batches').insert({
            import_type: importType, table_name: tableName,
            record_ids: importedIds, record_count: importedIds.length,
            imported_by: user?.id,
          });
        } catch (e) { console.log('Batch tracking failed:', e); }
      }
      setImportStats({ ...importStats, imported, skipped, lastBatchIds: importedIds, lastBatchTable: tableName });
      setImportStep('done');
      await loadAllData();
    } catch (err) {
      alert('Import error / خطأ في الاستيراد: ' + err.message);
      setImportStep('preview');
    }
  };

  const undoLastImport = async () => {
    const table = importStats?.lastBatchTable;
    const ids = importStats?.lastBatchIds;
    if (!table || !ids || ids.length === 0) { alert('No import to undo / لا يوجد استيراد لإلغائه'); return; }
    if (!confirm('Undo last import? This will DELETE ' + ids.length + ' records from ' + table + '.\n\nإلغاء آخر استيراد؟ سيتم حذف ' + ids.length + ' سجل.')) return;
    try {
      for (const id of ids) {
        await supabase.from(table).delete().eq('id', id);
      }
      // Mark batch as undone
      await supabase.from('import_batches').update({ undone: true, undone_at: new Date().toISOString() })
        .eq('table_name', table).eq('record_count', ids.length).eq('undone', false)
        .order('imported_at', { ascending: false }).limit(1);
      setImportStats({ ...importStats, lastBatchIds: [], lastBatchTable: '' });
      alert('✅ Import undone! / تم إلغاء الاستيراد — ' + ids.length + ' records deleted.');
      await loadAllData();
      setImportStep('select');
    } catch (err) { alert('Error undoing: ' + err.message); }
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
      alert('Error / خطأ: ' + err.message);
    }
  };

  // ==========================================
  // UI HELPERS
  // ==========================================
  const ModeBar = () => (
    <div className="flex gap-1 items-center flex-wrap">
      {[['all', 'All / الكل'], ['1yr', '1 Year'], ['3yr', '3 Years'], ['custom', 'Custom / مخصص']].map(([v, l]) => (
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
      className={`bg-white rounded-xl p-5 border-l-4 ${onClick ? 'cursor-pointer hover:shadow-lg hover:-translate-y-0.5 transition-all' : ''}`}
      style={{ borderLeftColor: color || '#0ea5e9' }}
    >
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{title}</div>
      {titleAr && <div className="text-sm font-bold text-slate-900 mt-0.5" style={{ direction: 'rtl' }}>{titleAr}</div>}
      <div className="text-3xl font-extrabold mt-2">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1.5">{sub}</div>}
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
              <td className="px-3 py-2 text-xs font-semibold text-right" style={{ direction: lang === 'ar' ? 'rtl' : 'ltr' }}>{tx(inv.customer_name, inv.customer_name_en)}</td>
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
    <div className="min-h-screen flex items-center justify-center" style={{background:'#0a0e1a'}}>
      <div className="text-center">
        <div className="text-2xl font-black mb-2" style={{background:'linear-gradient(135deg, #38bdf8, #a78bfa)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>KANDIL KTC EGYPT HUB</div>
        <div className="text-sm" style={{color:'rgba(148,163,184,0.5)'}}>Loading...</div>
      </div>
    </div>
  );

  // ==========================================
  // RENDER
  // ==========================================
  return (
    <div className="min-h-screen" style={{background:'var(--bg-primary)'}}>
      {/* Header */}
      <div style={{background:'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)', borderBottom:'1px solid rgba(56,189,248,0.15)'}} className="px-5 py-4 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-black tracking-tight" style={{background:'linear-gradient(135deg, #38bdf8, #818cf8, #a78bfa)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>KANDIL KTC EGYPT HUB</h1>
          <p style={{color:'rgba(148,163,184,0.5)'}} className="text-xs font-medium tracking-widest uppercase">{lang === 'en' ? 'KTC Trading Operations' : 'KTC — لوحة التحكم المالية'}</p>
        </div>
        <div className="flex items-center gap-3">
          {userProfile && (
            <div className="text-right">
              <div className="text-sm font-bold" style={{color:'#f1f5f9'}}>{userProfile.name}</div>
              <div style={{color:'rgba(148,163,184,0.6)'}} className="text-[10px]">{userProfile.role === 'super_admin' ? '🔴 Super Admin' : userProfile.role === 'admin' ? '🟣 Admin' : '🔵 Team'}</div>
            </div>
          )}
          {(isAdmin || !userProfile || userProfile.language_access === 'both' || userProfile.language_access === 'en') && (
            <button onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
              style={{background: lang === 'en' ? 'linear-gradient(135deg, #0ea5e9, #6366f1)' : 'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', color: lang === 'en' ? 'white' : 'rgba(255,255,255,0.6)'}}
              className="px-3 py-1.5 rounded-lg text-xs font-bold transition">
              {lang === 'ar' ? '🌐 EN' : '🌐 AR'}
            </button>
          )}
          <button onClick={handleSignOut} style={{background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.7)'}} className="px-3 py-1.5 text-xs rounded-lg font-medium hover:bg-white/10 transition">
            Sign Out
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="tab-nav px-1 overflow-x-auto flex" style={{background:'linear-gradient(to bottom, #ffffff, #f8fafc)'}}>
        {visibleTabs.map(t => (
          <button key={t.id} onClick={() => navigate(t.id)}
            className={`px-3 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 transition ${
              tab === t.id ? 'text-blue-600 border-blue-600 bg-blue-50/50' : 'text-slate-400 border-transparent hover:text-slate-600 hover:bg-slate-50'
            }`}
          >{t.icon} {lang === 'en' ? t.label.split(' / ')[0] : t.label}</button>
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
            <div style={{ direction: 'rtl' }} className="mb-4 pb-3 border-b border-slate-200">
              {formData.editingName ? (
                <div className="flex gap-2 items-center">
                  <input value={formData.newName || ''} onChange={e => setFormData({...formData, newName: e.target.value})}
                    className="flex-1 text-lg font-bold px-2 py-1 border rounded" style={{ direction: 'rtl' }} autoFocus />
                  <button onClick={async () => {
                    const oldName = selectedInvoice.customer_name;
                    const newName = formData.newName;
                    if (!newName || newName === oldName) { setFormData({...formData, editingName: false}); return; }
                    const matching = invoices.filter(i => i.customer_name === oldName);
                    const doAll = matching.length > 1 && confirm('Update ALL ' + matching.length + ' invoices from "' + oldName + '" to "' + newName + '"?\n\nتحديث جميع الفواتير من "' + oldName + '" إلى "' + newName + '"؟');
                    try {
                      if (doAll) {
                        for (const inv of matching) {
                          await dbUpdate('invoices', inv.id, { customer_name: newName }, user?.id);
                        }
                      } else {
                        await dbUpdate('invoices', selectedInvoice.id, { customer_name: newName }, user?.id);
                      }
                      setFormData({...formData, editingName: false});
                      await loadAllData();
                    } catch (err) { alert('Error / خطأ: ' + err.message); }
                  }} className="px-2 py-1 bg-emerald-500 text-white rounded text-xs">Save</button>
                  <button onClick={() => setFormData({...formData, editingName: false})}
                    className="px-2 py-1 bg-slate-300 rounded text-xs">Cancel</button>
                </div>
              ) : (
                <div className="flex justify-between items-center">
                  <span className="text-lg font-bold">{tx(selectedInvoice.customer_name, selectedInvoice.customer_name_en)}</span>
                  <button onClick={() => setFormData({...formData, editingName: true, newName: selectedInvoice.customer_name})}
                    className="px-2 py-0.5 rounded border border-slate-300 text-slate-500 text-[10px] hover:bg-slate-50" style={{ direction: 'ltr' }}>
                    Edit Name / تعديل الاسم
                  </button>
                </div>
              )}
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
                    {status === 'overpaid' && ' — ' + fE(tTotal - selectedInvoice.total_amount)}
                    {status === 'mismatch' && ' — Sales / المبيعات: ' + fE(selectedInvoice.total_collected) + ' vs Treasury / الخزنة: ' + fE(tTotal)}
                    {status === 'unverified' && tTotal > 0 && ' — Treasury / الخزنة: ' + fE(tTotal) + ' vs Invoice / الفاتورة: ' + fE(selectedInvoice.total_amount)}
                    {status === 'unverified' && tTotal === 0 && ' — Marked paid but no treasury entries linked / مسجّل كمدفوع لكن لا توجد معاملات مرتبطة في الخزنة'}
                    {status === 'open' && ' — Remaining / المتبقّي: ' + fE(selectedInvoice.outstanding)}
                  </div>
                  {(status === 'unverified' || status === 'mismatch') && (
                    <div className="text-xs mt-1" style={{ color: s.color }}>
                      {status === 'unverified'
                        ? 'Use "Link Transaction" to find the matching payment / استخدم "ربط معاملة" للبحث عن الدفعة المطابقة'
                        : 'Treasury differs from sales record. Link/unlink to correct / الخزنة تختلف عن سجل المبيعات. ربط أو إلغاء الربط للتصحيح'}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Invoice Line Items — always visible */}
            {(() => {
              const items = invoiceItems.filter(it => it.invoice_id === selectedInvoice.id);
              return (
                <div className="bg-blue-50 rounded-lg p-4 mb-4 border border-blue-200">
                  <h4 className="text-sm font-bold text-blue-800 mb-2">📦 Order Breakdown / تفاصيل الأمر {items.length > 0 ? '(' + items.length + ' items)' : ''}</h4>
                  {items.length > 0 ? (
                    <div>
                      <div className="overflow-auto max-h-[250px]">
                        <table className="w-full border-collapse">
                          <thead><tr className="bg-blue-100">
                            <th className="px-2 py-1.5 text-[10px] text-left" style={{ direction: lang === 'ar' ? 'rtl' : 'ltr' }}>Description / البند</th>
                            <th className="px-2 py-1.5 text-[10px] text-right">Qty / الكمية</th>
                            <th className="px-2 py-1.5 text-[10px] text-right">Unit Price / السعر</th>
                            <th className="px-2 py-1.5 text-[10px] text-right">Total / الإجمالي</th>
                          </tr></thead>
                          <tbody>
                            {items.map(it => (
                              <tr key={it.id} className="border-b border-blue-100">
                                <td className="px-2 py-1.5 text-xs" style={{ direction: lang === 'ar' ? 'rtl' : 'ltr' }}>{tx(it.description, it.description_en)}</td>
                                <td className="px-2 py-1.5 text-xs text-right">{fmt(it.quantity)}</td>
                                <td className="px-2 py-1.5 text-xs text-right">{fE(it.unit_price)}</td>
                                <td className="px-2 py-1.5 text-xs text-right font-semibold">{fE(it.line_total)}</td>
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
                  ) : (
                    <div className="text-center py-3">
                      <div className="text-xs text-slate-400 mb-1">No item breakdown available for this order / لا يوجد تفاصيل بنود لهذا الأمر</div>
                      <div className="text-[10px] text-slate-400">Import merchandiser Excel via the Import tab to load product details / استيراد ملف Excel من تبويب الاستيراد لتحميل تفاصيل المنتجات</div>
                      <div className="bg-white rounded-lg p-3 mt-2 border border-blue-100">
                        <div className="flex justify-between text-xs">
                          <span className="font-semibold">Invoice Total / إجمالي الفاتورة</span>
                          <span className="font-extrabold text-blue-600">{fE(selectedInvoice.total_amount)}</span>
                        </div>
                      </div>
                    </div>
                  )}
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
                          <div>
                            <label className="text-[10px] font-semibold text-slate-600">Category / التصنيف</label>
                            <select value={formData.category !== undefined ? formData.category : (txn.category || '')}
                              onChange={e => setFormData({...formData, category: e.target.value})}
                              className="w-full px-2 py-1 rounded border border-slate-200 text-xs bg-amber-50">
                              <option value="">Uncategorized</option>
                              {Object.entries(EXPENSE_CATS).map(([ar, en]) => <option key={ar} value={ar}>{en} / {ar}</option>)}
                              {txn.category && !EXPENSE_CATS[txn.category] && <option value={txn.category}>{txn.category}</option>}
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] font-semibold text-slate-600">Subcategory / فرعي</label>
                            <input list="inv-subcats" value={formData.subcategory !== undefined ? formData.subcategory : (txn.subcategory || '')}
                              onChange={e => setFormData({...formData, subcategory: e.target.value})}
                              className="w-full px-2 py-1 rounded border border-slate-200 text-xs bg-orange-50" />
                            <datalist id="inv-subcats">
                              {[...new Set(treasury.map(t=>t.subcategory).filter(Boolean))].sort().map(s => <option key={s} value={s}/>)}
                            </datalist>
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
                          <div className="text-xs font-semibold" style={{ direction: lang === 'ar' ? 'rtl' : 'ltr' }}>{tx(txn.description, txn.description_en)}</div>
                          <div className="text-[10px] text-slate-500">{txn.transaction_date}</div>
                        </div>
                        <div className="text-sm font-bold text-emerald-600 mr-2">{fE(txn.cash_in)}</div>
                        <button onClick={() => { setEditingTxn(txn.id); setFormData({}); }}
                          className="px-2 py-0.5 rounded border border-blue-300 text-blue-600 text-[10px] mr-1 hover:bg-blue-50">
                          Edit
                        </button>
                        <button onClick={() => { setSplittingTxn(txn); const isIn = Number(txn.cash_in) > 0; const total = isIn ? Number(txn.cash_in) : Number(txn.cash_out); setSplits([{ order: txn.order_number || '', amount: total }, { order: '', amount: 0 }]); }}
                          className="px-2 py-0.5 rounded border border-purple-300 text-purple-600 text-[10px] mr-1 hover:bg-purple-50">
                          Split
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
                  placeholder="Search name, date, amount, order # / بحث"
                  className="w-full px-3 py-2 rounded-lg border border-purple-200 text-sm mb-2" autoFocus />
                {linkSearch.length >= 2 && (
                  <div className="max-h-[200px] overflow-auto rounded border border-purple-200 bg-white">
                    {treasury
                      .filter(t => (!t.order_number || t.order_number === '') && Number(t.cash_in) > 0)
                      .filter(t => {
                        const words = linkSearch.split(/\s+/).filter(w => w.length > 0);
                        const haystack = [t.description || '', t.transaction_date || '', String(t.cash_in || 0), t.order_number || ''].join(' ');
                        return words.every(w => haystack.includes(w));
                      })
                      .slice(0, 20)
                      .map(txn => (
                        <div key={txn.id} className="flex justify-between items-center px-3 py-2 border-b border-slate-50 hover:bg-purple-50">
                          <div className="flex-1">
                            <div className="text-xs font-semibold" style={{ direction: lang === 'ar' ? 'rtl' : 'ltr' }}>{tx(txn.description, txn.description_en)}</div>
                            <div className="text-[10px] text-slate-500">{txn.transaction_date} | {fE(txn.cash_in)}</div>
                          </div>
                          <button onClick={() => handleLinkTreasury(txn)}
                            className="px-3 py-1 bg-purple-600 text-white rounded text-[10px] font-semibold ml-2 hover:bg-purple-700">
                            Link / ربط
                          </button>
                        </div>
                      ))}
                    {treasury.filter(t => (!t.order_number || t.order_number === '') && Number(t.cash_in) > 0).filter(t => {
                      const words = linkSearch.split(/\s+/).filter(w => w.length > 0);
                      const haystack = [t.description || '', t.transaction_date || '', String(t.cash_in || 0), t.order_number || ''].join(' ');
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
            title={selectedMonth ? ('Transactions ' + selectedMonth) : (treasuryDrill === 'in' ? 'Cash In / وارد' : treasuryDrill === 'out' ? 'Cash Out / منصرف' : 'Net / صافي')}>
            {!selectedMonth ? (
              <div>
                <p className="text-xs text-slate-400 mb-3">Tap month for transactions / اضغط الشهر للتفاصيل</p>
                <div className="overflow-auto max-h-[350px] rounded-lg border border-slate-200">
                  <table className="w-full border-collapse">
                    <thead><tr className="bg-slate-50">
                      <th className="px-3 py-2 text-xs text-left">Month</th>
                      {treasuryDrill === 'net' ? (
                        <><th className="px-3 py-2 text-xs text-right">In</th><th className="px-3 py-2 text-xs text-right">Out</th><th className="px-3 py-2 text-xs text-right">Net</th></>
                      ) : (
                        <th className="px-3 py-2 text-xs text-right">{treasuryDrill === 'in' ? 'In / وارد' : 'Out / منصرف'}</th>
                      )}
                      <th className="px-3 py-2 text-xs text-right">Entries</th>
                    </tr></thead>
                    <tbody>
                      {monthlyTreasury
                        .filter(m => treasuryDrill === 'in' ? m.cashIn > 0 : treasuryDrill === 'out' ? m.cashOut > 0 : true)
                        .map(m => (
                        <tr key={m.month} onClick={() => setSelectedMonth(m.month)}
                          className="border-b border-slate-50 cursor-pointer hover:bg-blue-50">
                          <td className="px-3 py-2 text-xs font-semibold">{m.month}</td>
                          {treasuryDrill === 'net' ? (
                            <><td className="px-3 py-2 text-xs text-right text-emerald-600 font-semibold">{fE(m.cashIn)}</td>
                            <td className="px-3 py-2 text-xs text-right text-red-500 font-semibold">{fE(m.cashOut)}</td>
                            <td className="px-3 py-2 text-xs text-right font-bold" style={{ color: m.cashIn - m.cashOut >= 0 ? '#10b981' : '#ef4444' }}>{fE(m.cashIn - m.cashOut)}</td></>
                          ) : (
                            <td className="px-3 py-2 text-xs text-right font-semibold"
                              style={{ color: treasuryDrill === 'in' ? '#10b981' : '#ef4444' }}>
                              {fE(treasuryDrill === 'in' ? m.cashIn : m.cashOut)}
                            </td>
                          )}
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
                            <td className="px-2 py-1.5">
                              <input defaultValue={txn.description}
                                onChange={e => setFormData({...formData, desc: e.target.value})}
                                className="w-full text-xs border rounded px-1 py-1 mb-1" style={{ direction: 'rtl' }} />
                              <select value={formData.category !== undefined ? formData.category : (txn.category || '')}
                                onChange={e => setFormData({...formData, category: e.target.value})}
                                className="w-full text-[10px] border rounded px-1 py-0.5 bg-amber-50">
                                <option value="">Uncategorized</option>
                                {Object.entries(EXPENSE_CATS).map(([ar, en]) => (
                                  <option key={ar} value={ar}>{en} / {ar}</option>
                                ))}
                                {txn.category && !EXPENSE_CATS[txn.category] && txn.category !== '' && (
                                  <option value={txn.category}>{txn.category}</option>
                                )}
                                <option value="_new">+ New Category...</option>
                              </select>
                              {formData.category === '_new' && (
                                <input placeholder="New category name / اسم التصنيف الجديد"
                                  onChange={e => setFormData({...formData, category: e.target.value})}
                                  className="w-full text-[10px] border rounded px-1 py-0.5 mt-1" />
                              )}
                              <input list="all-subcats" value={formData.subcategory !== undefined ? formData.subcategory : (txn.subcategory || '')}
                                onChange={e => setFormData({...formData, subcategory: e.target.value})}
                                placeholder="Subcategory / تصنيف فرعي (optional)"
                                className="w-full text-[10px] border rounded px-1 py-0.5 mt-1 bg-orange-50" />
                              <datalist id="all-subcats">
                                {[...new Set(treasury.map(t=>t.subcategory).filter(Boolean))].sort().map(s => <option key={s} value={s}/>)}
                              </datalist>
                            </td>
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
                          <td className="px-3 py-2 text-xs" style={{ direction: 'rtl' }}>
                            {tx(txn.description, txn.description_en)}
                            {txn.cash_out > 0 && (
                              <div className="text-[9px] text-amber-600 mt-0.5">
                                {txCat(txn.category)}
                                {txn.subcategory && (' > ' + txn.subcategory)}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs text-right text-emerald-600 font-semibold">
                            {txn.cash_in > 0 ? fE(txn.cash_in) : ''}
                          </td>
                          <td className="px-3 py-2 text-xs text-right text-red-500 font-semibold">
                            {txn.cash_out > 0 ? fE(txn.cash_out) : ''}
                          </td>
                          <td className="px-3 py-2 flex gap-1">
                            <button onClick={() => { setEditingTxn(txn.id); setFormData({}); }}
                              className="px-2 py-0.5 rounded border border-blue-300 text-blue-600 text-[10px]">Edit</button>
                            <button onClick={() => { setSplittingTxn(txn); const isIn = Number(txn.cash_in) > 0; const total = isIn ? Number(txn.cash_in) : Number(txn.cash_out); setSplits([{ order: txn.order_number || '', amount: total }, { order: '', amount: 0 }]); }}
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
                <div className="font-bold mb-1" style={{ direction: 'rtl' }}>{splittingTxn.transaction_date} — {splittingTxn.description}</div>
                <div>Original: <span className="font-bold text-emerald-600">{fE(Number(splittingTxn.cash_in) > 0 ? Number(splittingTxn.cash_in) : Number(splittingTxn.cash_out))}</span>
                  {splittingTxn.order_number ? (' — Order: ' + splittingTxn.order_number) : ''}
                </div>
              </div>
              <div className="max-h-[300px] overflow-auto space-y-2">
                {splits.map((sp, idx) => (
                  <div key={idx} className="bg-white rounded-lg border p-3">
                    <div className="flex justify-between items-center mb-2">
                      <div className="text-xs font-bold text-purple-700">Split {idx + 1}</div>
                      {splits.length > 2 && (
                        <button onClick={() => setSplits(splits.filter((_, i) => i !== idx))}
                          className="text-red-400 text-[10px] hover:text-red-600">Remove</button>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="text-[10px] text-slate-500">Order #</label>
                        <input value={sp.order} onChange={e => {
                          const ns = [...splits]; ns[idx] = {...ns[idx], order: e.target.value}; setSplits(ns);
                        }} className="w-full px-2 py-1.5 border rounded text-sm" placeholder="Order #" />
                      </div>
                      <div className="flex-1">
                        <label className="text-[10px] text-slate-500">Amount</label>
                        <input type="number" value={sp.amount} onChange={e => {
                          const ns = [...splits]; ns[idx] = {...ns[idx], amount: Number(e.target.value) || 0}; setSplits(ns);
                        }} className="w-full px-2 py-1.5 border rounded text-sm" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={() => setSplits([...splits, { order: '', amount: 0 }])}
                className="w-full py-1.5 border-2 border-dashed border-purple-300 text-purple-600 rounded-lg text-xs font-semibold hover:bg-purple-50">
                + Add Split
              </button>
              <div className="text-xs text-center text-slate-400">
                {(() => {
                  const isIn = Number(splittingTxn.cash_in) > 0;
                  const total = isIn ? Number(splittingTxn.cash_in) : Number(splittingTxn.cash_out);
                  const splitTotal = splits.reduce((a, s) => a + (Number(s.amount) || 0), 0);
                  const remaining = total - splitTotal;
                  return 'Total: ' + fE(splitTotal) + ' / ' + fE(total) + (remaining === 0 ? ' ✅' : ' — Remaining: ' + fE(remaining));
                })()}
              </div>
              <button onClick={handleSplitTreasury}
                className="w-full py-2 bg-purple-600 text-white rounded-lg font-semibold text-sm hover:bg-purple-700">
                Split into {splits.length} / تقسيم
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

        {/* BUCKET DRILL MODAL — Two-Level with Search & Rename */}
        {expenseDrill && (
          <Modal onClose={() => { setExpenseDrill(null); setBucketSub(null); setBucketSearch(''); setRenamingBucket(null); }}
            title={(() => {
              const isIn = expenseDrill.startsWith('in:');
              const cat = isIn ? expenseDrill.slice(3) : expenseDrill;
              const prefix = isIn ? 'Income / إيرادات' : 'Expense / منصرف';
              return bucketSub ? prefix + ': ' + cat + ' > ' + bucketSub : prefix + ': ' + (EXPENSE_CATS[cat] || cat);
            })()}>
            {(() => {
              const isIn = expenseDrill.startsWith('in:');
              const cat = isIn ? expenseDrill.slice(3) : expenseDrill;
              const defaultCat = isIn ? 'Customer Payment' : 'Operations';
              const amtField = isIn ? 'cash_in' : 'cash_out';
              const color = isIn ? '#10b981' : '#ef4444';
              const allTxns = filteredTreasury.filter(t =>
                (t.category || defaultCat) === cat && Number(t[amtField]) > 0
              );

              // LEVEL 2: Subcategory transactions
              if (bucketSub) {
                const txns = allTxns.filter(t => (t.subcategory || 'Uncategorized') === bucketSub);
                const searched = bucketSearch ? txns.filter(t => {
                  const words = bucketSearch.split(/\s+/).filter(w => w.length > 0);
                  const hay = [t.description || '', t.transaction_date || '', String(t[amtField] || 0)].join(' ');
                  return words.every(w => hay.includes(w));
                }) : txns;
                return (
                  <div>
                    <button onClick={() => { setBucketSub(null); setBucketSearch(''); }}
                      className="px-3 py-1 rounded border border-slate-200 text-xs font-semibold mb-2">← Back / رجوع</button>
                    <div className="flex gap-2 mb-2 items-center">
                      {renamingBucket === 'sub' ? (
                        <div className="flex gap-1 flex-1">
                          <input value={renameValue} onChange={e => setRenameValue(e.target.value)}
                            className="flex-1 px-2 py-1 border rounded text-xs" autoFocus />
                          <button onClick={() => handleRenameBucket(bucketSub, renameValue, 'subcategory')}
                            className="px-2 py-1 bg-emerald-500 text-white rounded text-[10px]">Save / حفظ</button>
                          <button onClick={() => setRenamingBucket(null)}
                            className="px-2 py-1 bg-slate-300 rounded text-[10px]">Cancel</button>
                        </div>
                      ) : (
                        <button onClick={() => { setRenamingBucket('sub'); setRenameValue(bucketSub); }}
                          className="px-2 py-0.5 rounded border border-blue-300 text-blue-500 text-[10px]">Rename / تغيير الاسم</button>
                      )}
                      <select onChange={e => { 
                        if (e.target.value === '_new') {
                          const name = prompt('New category name / اسم التصنيف الجديد:');
                          if (name) handleMoveSubcategory(bucketSub, cat, name);
                        } else if (e.target.value) {
                          handleMoveSubcategory(bucketSub, cat, e.target.value);
                        }
                        e.target.value = '';
                      }} className="px-2 py-0.5 rounded border border-amber-300 text-amber-600 text-[10px]">
                        <option value="">Move to... / نقل إلى</option>
                        {[...new Set(treasury.map(t => t.category).filter(Boolean))].filter(c => c !== cat).sort().map(c => (
                          <option key={c} value={c}>{EXPENSE_CATS[c] || c}</option>
                        ))}
                        <option value="_new">+ New Category</option>
                      </select>
                    </div>
                    <input value={bucketSearch} onChange={e => setBucketSearch(e.target.value)}
                      placeholder="Search transactions / بحث..." className="w-full px-2 py-1.5 border rounded text-xs mb-2" />
                    <p className="text-[10px] text-slate-400 mb-1">{searched.length} transactions</p>
                    <div className="overflow-auto max-h-[300px] rounded-lg border border-slate-200">
                      <table className="w-full border-collapse">
                        <thead><tr className="bg-slate-50 sticky top-0">
                          <th className="px-2 py-1.5 text-[10px] text-left">Date</th>
                          <th className="px-2 py-1.5 text-[10px]" style={{ direction: 'rtl' }}>Description</th>
                          <th className="px-2 py-1.5 text-[10px] text-right">Amount</th>
                          <th className="px-2 py-1.5 text-[10px]">Category</th>
                        </tr></thead>
                        <tbody>
                          {searched.sort((a, b) => b.transaction_date.localeCompare(a.transaction_date)).map(txn => (
                            <tr key={txn.id} className="border-b border-slate-50">
                              <td className="px-2 py-1 text-[10px]">{txn.transaction_date}</td>
                              <td className="px-2 py-1 text-[10px]" style={{ direction: lang === 'ar' ? 'rtl' : 'ltr' }}>{tx(txn.description, txn.description_en)}</td>
                              <td className="px-2 py-1 text-[10px] text-right font-semibold" style={{ color: color }}>{fE(txn[amtField])}</td>
                              <td className="px-1 py-1">
                                <select defaultValue={txn.category || ''} onChange={async (e) => {
                                    const newCat = e.target.value;
                                    try {
                                      await dbUpdate('treasury', txn.id, { category: newCat }, user?.id);
                                      const desc = (txn.description || '').trim();
                                      if (desc) {
                                        const similar = treasury.filter(t => t.id !== txn.id && (t.description || '').trim() === desc && t.category !== newCat);
                                        if (similar.length > 0 && confirm('Apply to ' + similar.length + ' transactions with exact same description?\n"' + desc + '"')) {
                                          for (const s of similar) { await dbUpdate('treasury', s.id, { category: newCat }, user?.id); }
                                        }
                                        const existing = expenseRules.find(r => r.description_match === desc);
                                        if (existing) { await dbUpdate('expense_rules', existing.id, { category: newCat }, user?.id); }
                                        else { await dbInsert('expense_rules', { description_match: desc, category: newCat, subcategory: txn.subcategory || '' }, user?.id); }
                                      }
                                      await loadAllData();
                                    } catch(err) { alert('Error: ' + err.message); }
                                  }} className="w-full text-[9px] border rounded px-1 py-0.5 bg-amber-50">
                                  <option value="">None</option>
                                  {Object.entries(EXPENSE_CATS).map(([ar, en]) => <option key={ar} value={ar}>{en}</option>)}
                                  {[...new Set(treasury.map(t=>t.category).filter(c=>c&&!EXPENSE_CATS[c]))].map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                                {editSubTxnId === txn.id ? (
                                  <div className="flex gap-1 mt-0.5">
                                    <input list="subs-all" autoFocus value={editSubValue}
                                      onChange={e => setEditSubValue(e.target.value)}
                                      onKeyDown={async (e) => {
                                        if (e.key === 'Enter') {
                                          e.preventDefault();
                                          try {
                                            await dbUpdate('treasury', txn.id, { subcategory: editSubValue }, user?.id);
                                            const desc = (txn.description || '').trim();
                                            if (desc) {
                                              const similar = treasury.filter(t => t.id !== txn.id && (t.description || '').trim() === desc && t.category === (txn.category || '') && t.subcategory !== editSubValue);
                                              if (similar.length > 0 && confirm('Apply "' + editSubValue + '" to ' + similar.length + ' exact matches?')) {
                                                for (const s of similar) { await dbUpdate('treasury', s.id, { subcategory: editSubValue }, user?.id); }
                                              }
                                              const existing = expenseRules.find(r => r.description_match === desc);
                                              if (existing) { await dbUpdate('expense_rules', existing.id, { subcategory: editSubValue }, user?.id); }
                                              else { await dbInsert('expense_rules', { description_match: desc, category: txn.category || '', subcategory: editSubValue }, user?.id); }
                                            }
                                            setEditSubTxnId(null); setEditSubValue('');
                                            await loadAllData();
                                          } catch(err) { alert('Error: ' + err.message); }
                                        }
                                        if (e.key === 'Escape') { setEditSubTxnId(null); setEditSubValue(''); }
                                      }}
                                      placeholder="Type & press Enter..."
                                      className="flex-1 text-[9px] border-2 border-blue-400 rounded px-1 py-0.5 bg-blue-50 focus:outline-none" />
                                    <button onClick={() => { setEditSubTxnId(null); setEditSubValue(''); }}
                                      className="text-[9px] text-red-500 px-1">✕</button>
                                  </div>
                                ) : (
                                  <div onClick={() => { setEditSubTxnId(txn.id); setEditSubValue(txn.subcategory || ''); }}
                                    className="text-[9px] mt-0.5 px-1 py-0.5 rounded cursor-pointer hover:bg-orange-100 bg-orange-50 border border-orange-200 min-h-[18px]">
                                    {txn.subcategory || <span className="text-slate-300 italic">+ subcategory</span>}
                                  </div>
                                )}
                                <datalist id="subs-all">
                                  {[...new Set(treasury.map(t=>t.subcategory).filter(Boolean))].sort().map(s => <option key={s} value={s}/>)}
                                </datalist>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex justify-between pt-2 mt-1 border-t-2 border-slate-300">
                      <span className="text-[10px] font-bold">Total / الإجمالي</span>
                      <span className="text-sm font-extrabold" style={{ color: color }}>{fE(searched.reduce((a, t) => a + Number(t[amtField]), 0))}</span>
                    </div>
                  </div>
                );
              }

              // LEVEL 1: Subcategory list
              const subs = {};
              allTxns.forEach(t => {
                const s = t.subcategory || 'Uncategorized';
                if (!subs[s]) subs[s] = { total: 0, count: 0 };
                subs[s].total += Number(t[amtField]);
                subs[s].count++;
              });
              const subList = Object.entries(subs).sort((a, b) => b[1].total - a[1].total);
              const searched = bucketSearch ? subList.filter(([s]) => s.toLowerCase().includes(bucketSearch.toLowerCase())) : subList;

              return (
                <div>
                  <div className="flex gap-2 mb-2 items-center">
                    {renamingBucket === 'cat' ? (
                      <div className="flex gap-1 flex-1">
                        <input value={renameValue} onChange={e => setRenameValue(e.target.value)}
                          className="flex-1 px-2 py-1 border rounded text-xs" autoFocus />
                        <button onClick={() => handleRenameBucket(cat, renameValue, 'category')}
                          className="px-2 py-1 bg-emerald-500 text-white rounded text-[10px]">Save / حفظ</button>
                        <button onClick={() => setRenamingBucket(null)}
                          className="px-2 py-1 bg-slate-300 rounded text-[10px]">Cancel</button>
                      </div>
                    ) : (
                      <button onClick={() => { setRenamingBucket('cat'); setRenameValue(cat); }}
                        className="px-2 py-0.5 rounded border border-blue-300 text-blue-500 text-[10px]">Rename Category / تغيير التصنيف</button>
                    )}
                  </div>
                  <input value={bucketSearch} onChange={e => setBucketSearch(e.target.value)}
                    placeholder="Search subcategories / بحث التصنيفات الفرعية..." className="w-full px-2 py-1.5 border rounded text-xs mb-2" />
                  <p className="text-[10px] text-slate-400 mb-1">{allTxns.length} total transactions, {subList.length} subcategories</p>
                  <div className="overflow-auto max-h-[350px]">
                    {searched.map(([sub, data], i) => (
                      <div key={sub} onClick={() => { setBucketSub(sub); setBucketSearch(''); }}
                        className="flex justify-between py-2 px-3 border-b border-slate-100 cursor-pointer hover:bg-slate-50 rounded">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                          <span className="text-xs font-semibold">{sub}</span>
                          <span className="text-[10px] text-slate-400">({data.count})</span>
                        </div>
                        <span className="text-xs font-bold" style={{ color: color }}>{fE(data.total)} →</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between pt-2 mt-2 border-t-2 border-slate-300">
                    <span className="text-xs font-bold">Total / الإجمالي</span>
                    <span className="text-sm font-extrabold" style={{ color: color }}>{fE(allTxns.reduce((a, t) => a + Number(t[amtField]), 0))}</span>
                  </div>
                </div>
              );
            })()}
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
            <p className="text-[10px] text-slate-400 mt-2">Cash/Check: marks as collected only (treasury entry already exists) — نقد/شيك: يتم تسجيلها كمحصّلة فقط (المعاملة موجودة بالفعل في الخزنة)<br/>Bank transfer/Deposit/Other: also creates a treasury entry and updates invoice — تحويل بنكي/إيداع/أخرى: يتم إنشاء معاملة في الخزنة وتحديث الفاتورة</p>
            <button onClick={handleCollectCheck}
              className="mt-3 px-4 py-2 bg-emerald-500 text-white rounded-lg font-semibold w-full">Reconcile / تسوية ✓</button>
          </Modal>
        )}

        {/* ==========================================
            ADD INVOICE MODAL
        ========================================== */}
        {showAddInvoice && (
          <Modal onClose={() => { setShowAddInvoice(false); setFormData({}); }} title="New Invoice / فاتورة جديدة">
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-xs font-semibold text-slate-600">Order # / رقم الأمر</label>
                <input value={formData.orderNumber || ''}
                  onChange={e => setFormData({ ...formData, orderNumber: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600">Date / التاريخ <span className="text-[9px] text-slate-400">(mm/dd/yyyy)</span></label>
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
                <label className="text-xs font-semibold text-slate-600">Sales Rep / المندوب</label>
                <input value={formData.salesRep || ''}
                  onChange={e => setFormData({ ...formData, salesRep: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600">Notes / ملاحظات</label>
                <input value={formData.notes || ''}
                  onChange={e => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
              </div>
            </div>

            {/* Product Line Items */}
            <div className="bg-blue-50 rounded-lg p-3 mb-3 border border-blue-200">
              <div className="flex justify-between items-center mb-2">
                <h4 className="text-xs font-bold text-blue-800">Items / البضاعة ({(formData.invoiceItems || []).length}/20)</h4>
                {(formData.invoiceItems || []).length < 20 && (
                  <button onClick={() => setFormData({...formData, showProductPicker: true})}
                    className="px-2 py-1 bg-blue-500 text-white rounded text-[10px] font-semibold">+ Add Item / إضافة</button>
                )}
              </div>

              {/* Product Picker */}
              {formData.showProductPicker && (
                <div className="bg-white rounded-lg p-3 mb-2 border border-blue-300">
                  <input value={formData.prodSearch || ''} onChange={e => setFormData({...formData, prodSearch: e.target.value})}
                    placeholder="Search inventory by ref#, name... / بحث" className="w-full px-2 py-1.5 border rounded text-xs mb-2" autoFocus />
                  <div className="max-h-[150px] overflow-auto">
                    {inventory.filter(p => {
                      const sq = formData.prodSearch || '';
                      if (sq.length < 1) return true;
                      return (p.reference_number || '').includes(sq) || (p.description || '').includes(sq) || (p.description_en || '').toLowerCase().includes(sq.toLowerCase());
                    }).slice(0, 10).map(p => (
                      <div key={p.id} onClick={() => {
                        const items = formData.invoiceItems || [];
                        items.push({ inv_desc: (p.reference_number || '') + ' - ' + (p.description || ''), inv_qty: 1, inv_price: Number(p.unit_price) || 0, inv_total: Number(p.unit_price) || 0, product_id: p.id });
                        setFormData({...formData, invoiceItems: items, showProductPicker: false, prodSearch: ''});
                      }} className="px-2 py-1.5 text-xs cursor-pointer hover:bg-blue-50 border-b border-slate-50">
                        <span className="font-bold">{p.reference_number}</span> — <span style={{direction:'rtl'}}>{p.description}</span>
                        {p.description_en && <span className="text-blue-400 ml-1">({p.description_en})</span>}
                        <span className="text-emerald-600 ml-1">{fE(p.unit_price)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-slate-200 pt-2 mt-2">
                    <div className="text-[10px] text-slate-500 mb-1">Or create custom item / أو أضف عنصر مخصص:</div>
                    <div className="flex gap-1">
                      <input value={formData.customDesc || ''} onChange={e => setFormData({...formData, customDesc: e.target.value})}
                        placeholder="Description" className="flex-1 px-2 py-1 border rounded text-[10px]" />
                      <input type="number" value={formData.customPrice || ''} onChange={e => setFormData({...formData, customPrice: e.target.value})}
                        placeholder="Price" className="w-20 px-2 py-1 border rounded text-[10px]" />
                      <button onClick={() => {
                        if (!formData.customDesc) return;
                        const items = formData.invoiceItems || [];
                        items.push({ inv_desc: formData.customDesc, inv_qty: 1, inv_price: Number(formData.customPrice) || 0, inv_total: Number(formData.customPrice) || 0 });
                        setFormData({...formData, invoiceItems: items, showProductPicker: false, customDesc: '', customPrice: ''});
                      }} className="px-2 py-1 bg-emerald-500 text-white rounded text-[10px]">Add</button>
                    </div>
                  </div>
                  <button onClick={() => setFormData({...formData, showProductPicker: false})}
                    className="mt-2 px-2 py-1 border border-slate-200 rounded text-[10px] w-full">Close</button>
                </div>
              )}

              {/* Items List */}
              {(formData.invoiceItems || []).length > 0 && (
                <div>
                  <table className="w-full border-collapse text-xs mb-2">
                    <thead><tr className="bg-blue-100">
                      <th className="px-2 py-1 text-left text-[10px]">Item / البند</th>
                      <th className="px-2 py-1 text-right text-[10px] w-16">Qty</th>
                      <th className="px-2 py-1 text-right text-[10px] w-20">Price</th>
                      <th className="px-2 py-1 text-right text-[10px] w-20">Total</th>
                      <th className="px-2 py-1 text-[10px] w-8"></th>
                    </tr></thead>
                    <tbody>
                      {(formData.invoiceItems || []).map((item, idx) => (
                        <tr key={idx} className="border-b border-blue-100">
                          <td className="px-2 py-1 text-[10px]">{item.inv_desc}</td>
                          <td className="px-2 py-1"><input type="number" value={item.inv_qty}
                            onChange={e => { const items = [...(formData.invoiceItems || [])]; items[idx] = {...items[idx], inv_qty: Number(e.target.value) || 0, inv_total: (Number(e.target.value) || 0) * items[idx].inv_price}; setFormData({...formData, invoiceItems: items}); }}
                            className="w-full text-right text-[10px] border rounded px-1 py-0.5" /></td>
                          <td className="px-2 py-1"><input type="number" value={item.inv_price}
                            onChange={e => { const items = [...(formData.invoiceItems || [])]; items[idx] = {...items[idx], inv_price: Number(e.target.value) || 0, inv_total: items[idx].inv_qty * (Number(e.target.value) || 0)}; setFormData({...formData, invoiceItems: items}); }}
                            className="w-full text-right text-[10px] border rounded px-1 py-0.5" /></td>
                          <td className="px-2 py-1 text-right text-[10px] font-bold">{fE(item.inv_total)}</td>
                          <td className="px-2 py-1"><button onClick={() => { const items = (formData.invoiceItems || []).filter((_, i) => i !== idx); setFormData({...formData, invoiceItems: items}); }}
                            className="text-red-400 text-[10px]">X</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="flex justify-between text-xs font-bold border-t-2 border-blue-300 pt-1">
                    <span>Total / الإجمالي</span>
                    <span className="text-blue-600">{fE((formData.invoiceItems || []).reduce((a, i) => a + (i.inv_total || 0), 0))}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <button onClick={async () => {
                const items = formData.invoiceItems || [];
                const totalAmt = items.reduce((a, i) => a + (i.inv_total || 0), 0) || Number(formData.amount) || 0;
                if (!formData.orderNumber || !formData.customerName || totalAmt <= 0) {
                  alert('Please fill order#, customer, and add items / الرجاء ملء رقم الأمر والعميل وإضافة بنود'); return;
                }
                try {
                  const { data: newInv } = await supabase.from('invoices').insert({
                    order_number: formData.orderNumber, customer_name: formData.customerName,
                    invoice_date: formData.date || today(), total_amount: totalAmt,
                    total_collected: 0, outstanding: totalAmt, sales_rep: formData.salesRep || '',
                    notes: formData.notes || '', source: 'manual',
                  }).select('id').single();
                  if (newInv && items.length > 0) {
                    for (const item of items) {
                      await dbInsert('invoice_items', {
                        invoice_id: newInv.id, description: item.inv_desc,
                        quantity: item.inv_qty, unit_price: item.inv_price, line_total: item.inv_total,
                      }, user?.id);
                    }
                  }
                  setShowAddInvoice(false); setFormData({}); await loadAllData();
                } catch (err) { alert('Error / خطأ: ' + err.message); }
              }} className="px-4 py-2 bg-blue-500 text-white rounded-lg font-semibold">Create Invoice / إنشاء ✓</button>
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
                <label className="text-xs font-semibold text-slate-600">Date / التاريخ <span className="text-[9px] text-slate-400">(mm/dd/yyyy)</span></label>
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
                <label className="text-xs font-semibold text-slate-600">Currency / العملة</label>
                <select value={formData.currency || 'EGP'}
                  onChange={e => setFormData({ ...formData, currency: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm">
                  <option value="EGP">EGP - Egyptian Pound</option>
                  <option value="USD">USD - US Dollar</option>
                  <option value="EUR">EUR - Euro</option>
                  <option value="GBP">GBP - British Pound</option>
                  <option value="SAR">SAR - Saudi Riyal</option>
                  <option value="AED">AED - UAE Dirham</option>
                </select>
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
              {(formData.type === 'out' || formData.type === 'in' || !formData.type) && (
                <div className="col-span-2">
                  <label className="text-xs font-semibold text-slate-600">Category / تصنيف {(formData.type || 'in') === 'in' ? '(Income / إيرادات)' : '(Expense / منصرفات)'}</label>
                  <select value={formData.category || ''}
                    onChange={e => setFormData({ ...formData, category: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-amber-50">
                    <option value="">Select category / اختر التصنيف...</option>
                    {Object.entries(EXPENSE_CATS).map(([ar, en]) => (
                      <option key={ar} value={ar}>{en} / {ar}</option>
                    ))}
                    <option value="_new">+ New Category / تصنيف جديد...</option>
                  </select>
                  {formData.category === '_new' && (
                    <input placeholder="New category name / اسم التصنيف الجديد"
                      onChange={e => setFormData({ ...formData, category: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm mt-1" />
                  )}
                  <input list="add-subcats" value={formData.subcategory || ''} placeholder="Subcategory / تصنيف فرعي (optional)"
                    onChange={e => setFormData({ ...formData, subcategory: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm mt-1 bg-orange-50" />
                  <datalist id="add-subcats">
                    {[...new Set(treasury.map(t=>t.subcategory).filter(Boolean))].sort().map(s => <option key={s} value={s}/>)}
                  </datalist>
                </div>
              )}
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
              {isAdmin && <ModeBar />}
            </div>

            {/* ===== FINANCIAL DASHBOARD (shown first for users with access) ===== */}
            {(isAdmin || modulePerms['Sales'] || modulePerms['Treasury']) && (<>
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
              <Card title="Net" titleAr="صافي" value={fE(totalCashIn - totalCashOut)} sub="Tap / اضغط" color={totalCashIn > totalCashOut ? '#10b981' : '#ef4444'} onClick={() => setTreasuryDrill('net')} />
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

            {/* Monthly Sales Tracking */}
            <div className="bg-white rounded-xl p-4 mb-4">
              <h3 className="text-sm font-bold mb-2">Monthly Sales / المبيعات الشهرية</h3>
              {(() => {
                const months = {};
                let running = 0;
                filteredInvoices.forEach(inv => {
                  const m = (inv.invoice_date || '').substring(0, 7);
                  if (!m) return;
                  if (!months[m]) months[m] = { month: m, invoiced: 0, collected: 0, outstanding: 0, count: 0 };
                  months[m].invoiced += Number(inv.total_amount || 0);
                  months[m].collected += Number(inv.total_collected || 0);
                  months[m].outstanding += Number(inv.outstanding || 0);
                  months[m].count++;
                });
                const sorted = Object.values(months).sort((a, b) => a.month.localeCompare(b.month));
                return (
                  <div className="overflow-auto max-h-[300px] rounded-lg border border-slate-200">
                    <table className="w-full border-collapse">
                      <thead className="sticky top-0"><tr className="bg-slate-50">
                        <th className="px-2 py-1.5 text-[10px] text-left">Month / الشهر</th>
                        <th className="px-2 py-1.5 text-[10px] text-right">Invoiced / فواتير</th>
                        <th className="px-2 py-1.5 text-[10px] text-right">Collected / محصّل</th>
                        <th className="px-2 py-1.5 text-[10px] text-right">Outstanding / متبقّي</th>
                        <th className="px-2 py-1.5 text-[10px] text-right">Running / تراكمي</th>
                        <th className="px-2 py-1.5 text-[10px] text-right">#</th>
                      </tr></thead>
                      <tbody>
                        {sorted.map(m => {
                          running += m.invoiced;
                          return (
                            <tr key={m.month} className="border-b border-slate-50">
                              <td className="px-2 py-1 text-xs font-semibold">{m.month}</td>
                              <td className="px-2 py-1 text-xs text-right text-blue-600">{fE(m.invoiced)}</td>
                              <td className="px-2 py-1 text-xs text-right text-emerald-600">{fE(m.collected)}</td>
                              <td className="px-2 py-1 text-xs text-right text-red-500">{m.outstanding > 0 ? fE(m.outstanding) : '-'}</td>
                              <td className="px-2 py-1 text-xs text-right font-bold text-purple-600">{fE(running)}</td>
                              <td className="px-2 py-1 text-[10px] text-right text-slate-400">{m.count}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>

            {/* Income Buckets */}
            {incomeBuckets.length > 0 && (
              <div className="bg-white rounded-xl p-4 mb-4">
                <h3 className="text-sm font-bold mb-2 text-emerald-700">Income Buckets / تصنيف الإيرادات</h3>
                {incomeBuckets.map((e, i) => (
                  <div key={e.cat}>
                    <div onClick={() => setExpenseDrill('in:' + e.cat)}
                      className="flex justify-between py-1 border-b border-slate-50 text-xs cursor-pointer hover:bg-emerald-50">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                        <span>{e.eng}</span>
                        <span className="text-slate-400">({e.count})</span>
                      </div>
                      <span className="font-bold text-emerald-600">{fE(e.total)} →</span>
                    </div>
                    {Object.entries(e.subs).map(([sub, data]) => (
                      <div key={sub} className="flex justify-between py-0.5 pl-6 text-[10px] text-slate-500">
                        <span>↳ {sub} ({data.count})</span>
                        <span className="text-emerald-500">{fE(data.total)}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {/* Expense Buckets */}
            <div className="bg-white rounded-xl p-4">
              <h3 className="text-sm font-bold mb-2 text-red-700">Expense Buckets / تصنيف المنصرفات</h3>
              {expenseBuckets.map((e, i) => (
                <div key={e.cat}>
                  <div onClick={() => setExpenseDrill(e.cat)}
                    className="flex justify-between py-1 border-b border-slate-50 text-xs cursor-pointer hover:bg-red-50">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                      <span>{e.eng}</span>
                      <span className="text-slate-400">({e.count})</span>
                    </div>
                    <span className="font-bold text-red-500">{fE(e.total)} →</span>
                  </div>
                  {Object.entries(e.subs).map(([sub, data]) => (
                    <div key={sub} className="flex justify-between py-0.5 pl-6 text-[10px] text-slate-500">
                      <span>↳ {sub} ({data.count})</span>
                      <span className="text-red-400">{fE(data.total)}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {/* Upcoming/Pending Checks */}
            {(() => {
              const filtered = pendingChecks.filter(c => inRange(c.check_date, mode, df, dt));
              if (filtered.length === 0) return null;
              return (
                <div className="bg-white rounded-xl p-4 mt-4">
                  <h3 className="text-sm font-bold mb-2">Pending Checks / شيكات معلقة ({filtered.length})</h3>
                  <div className="overflow-auto max-h-[250px] rounded-lg border border-amber-200">
                    <table className="w-full border-collapse">
                      <thead className="sticky top-0"><tr className="bg-amber-50">
                        <th className="px-2 py-2 text-xs text-left">Date / التاريخ</th>
                        <th className="px-2 py-2 text-xs" style={{ direction: 'rtl' }}>Customer / العميل</th>
                        <th className="px-2 py-2 text-xs">Order / أمر</th>
                        <th className="px-2 py-2 text-xs text-right">Amount / المبلغ</th>
                        <th className="px-2 py-2 text-xs"></th>
                      </tr></thead>
                      <tbody>
                        {filtered.sort((a, b) => a.check_date.localeCompare(b.check_date)).map(c => (
                          <tr key={c.id} className="border-b border-amber-50 hover:bg-amber-50">
                            <td className="px-2 py-1.5 text-xs">{c.check_date}</td>
                            <td className="px-2 py-1.5 text-xs font-semibold" style={{ direction: lang === 'ar' ? 'rtl' : 'ltr' }}>{tx(c.customer_name, c.customer_name_en)}</td>
                            <td className="px-2 py-1.5 text-xs text-center">{c.order_number || '—'}</td>
                            <td className="px-2 py-1.5 text-xs text-right font-bold text-amber-600">{fE(c.amount)}</td>
                            <td className="px-2 py-1.5">
                              <button onClick={() => { setReconcileCheck(c); setFormData({}); }}
                                className="px-2 py-0.5 rounded bg-amber-500 text-white text-[10px]">Reconcile / تسوية</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex justify-between pt-2 mt-1 border-t border-amber-200">
                    <span className="text-xs font-bold">Total Pending / إجمالي المعلق</span>
                    <span className="text-sm font-extrabold text-amber-600">{fE(filtered.reduce((a, c) => a + Number(c.amount), 0))}</span>
                  </div>
                </div>
              );
            })()}
            </>)}

            {/* ===== PERSONAL DASHBOARD (tickets, reminders, calendar — after financial for admins, first for team) ===== */}
            <PersonalDashboard user={user} userProfile={userProfile} isAdmin={isAdmin}
              invoices={invoices} customers={customers} navigate={navigate} fE={fE} users={teamUsers} />
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
                <select value={formData.statusFilter || 'all'}
                  onChange={e => setFormData({...formData, statusFilter: e.target.value})}
                  className="px-2 py-1 rounded-lg border border-slate-200 text-xs">
                  <option value="all">All Status / الكل</option>
                  <option value="reconciled">✅ Reconciled / تم التسوية</option>
                  <option value="open">🔴 Open / مفتوح</option>
                  <option value="unverified">⚠️ Unverified / غير مؤكد</option>
                  <option value="mismatch">⚡ Mismatch / عدم تطابق</option>
                  <option value="overpaid">🟠 Overpaid / دفع زائد</option>
                </select>
                <input value={query} onChange={e => setQuery(e.target.value)}
                  placeholder="بحث / Search" className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs w-32" />
                <button onClick={() => setShowAddInvoice(true)}
                  className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-semibold hover:bg-blue-600">
                  + New Invoice
                </button>
                <button onClick={() => generateReconReport()}
                  className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-xs font-semibold hover:bg-red-600">
                  📊 Recon Report
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
            {/* Sales by Division / المبيعات حسب القسم */}
            {(() => {
              const divisionData = {};
              filteredInvoices.forEach(inv => {
                const cust = customers.find(c => c.id === inv.customer_id || c.name === inv.customer_name);
                const div = cust?.group_name || 'Unassigned / غير مصنف';
                if (!divisionData[div]) divisionData[div] = { sales: 0, collected: 0, outstanding: 0, count: 0 };
                divisionData[div].sales += Number(inv.total_amount || 0);
                divisionData[div].collected += Number(inv.total_collected || 0);
                divisionData[div].outstanding += Number(inv.outstanding || 0);
                divisionData[div].count++;
              });
              const sorted = Object.entries(divisionData).sort((a, b) => b[1].sales - a[1].sales);
              if (sorted.length <= 1) return null;
              return (
                <div className="bg-white rounded-xl p-4 mb-3">
                  <h3 className="text-sm font-bold mb-2">Sales by Division / المبيعات حسب القسم</h3>
                  <div className="overflow-auto">
                    <table className="w-full border-collapse text-xs">
                      <thead><tr className="bg-slate-50">
                        <th className="px-2 py-1.5 text-left">Division / القسم</th>
                        <th className="px-2 py-1.5 text-right">Orders</th>
                        <th className="px-2 py-1.5 text-right">Sales</th>
                        <th className="px-2 py-1.5 text-right">Collected</th>
                        <th className="px-2 py-1.5 text-right">Outstanding</th>
                      </tr></thead>
                      <tbody>
                        {sorted.map(([div, d], i) => (
                          <tr key={div} className="border-b border-slate-50">
                            <td className="px-2 py-1.5 font-semibold">
                              <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{background: COLORS[i % COLORS.length]}}></span>
                              {div}
                            </td>
                            <td className="px-2 py-1.5 text-right text-slate-500">{d.count}</td>
                            <td className="px-2 py-1.5 text-right font-bold text-blue-600">{fE(d.sales)}</td>
                            <td className="px-2 py-1.5 text-right text-emerald-600">{fE(d.collected)}</td>
                            <td className="px-2 py-1.5 text-right text-red-500">{d.outstanding > 0 ? fE(d.outstanding) : '✓'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
            <InvoiceTable data={(() => {
              const sf = formData.statusFilter;
              if (!sf || sf === 'all') return filteredInvoices;
              return filteredInvoices.filter(inv => {
                const txns = treasuryByOrder[inv.order_number] || [];
                const tTotal = txns.reduce((a, t) => a + Number(t.cash_in || 0), 0);
                return getReconStatus(inv, tTotal) === sf;
              });
            })()} onSelect={setSelectedInvoice} />
            <div className="bg-white rounded-lg p-3 mt-3 border border-slate-200">
              <h4 className="text-xs font-bold text-slate-600 mb-2">Key / المفتاح</h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-[10px]">
                <div><span className="inline-block w-3 h-3 rounded-full bg-green-500 mr-1 align-middle"></span>✅ Reconciled / تم التسوية — Treasury matches invoice</div>
                <div><span className="inline-block w-3 h-3 rounded-full bg-red-500 mr-1 align-middle"></span>🔴 Open / مفتوح — Outstanding balance remaining</div>
                <div><span className="inline-block w-3 h-3 rounded-full bg-amber-500 mr-1 align-middle"></span>⚠️ Unverified / غير مؤكد — No treasury entries linked</div>
                <div><span className="inline-block w-3 h-3 rounded-full bg-orange-500 mr-1 align-middle"></span>⚡ Mismatch / عدم تطابق — Treasury differs from sales record</div>
                <div><span className="inline-block w-3 h-3 rounded-full bg-orange-600 mr-1 align-middle"></span>🟠 Overpaid / دفع زائد — Collected more than invoiced</div>
                <div><span className="text-blue-500 font-bold mr-1">EGP</span>Egyptian Pound / جنيه مصري — Default currency</div>
              </div>
            </div>
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
                if (query) custList = custList.filter(c => {
                  const cr = customers.find(x => x.name === c.name || x.name_ar === c.name);
                  const en = cr ? (cr.name_en || '') : '';
                  return c.name.includes(query) || en.toLowerCase().includes(query.toLowerCase());
                });
                if (customerGroup === 'owing') custList = custList.filter(c => c.outstanding > 0);
                if (customerGroup === 'paid') custList = custList.filter(c => c.outstanding <= 0);
                if (customerGroup === 'top') custList.sort((a, b) => b.total - a.total);
                else custList.sort((a, b) => a.name.localeCompare(b.name));
                return custList.map(c => {
                  const custRecord = customers.find(cr => cr.name === c.name || cr.name_ar === c.name);
                  const enName = custRecord ? custRecord.name_en : '';
                  return (
                  <div key={c.name} onClick={() => setSelectedCustomer(c.name)}
                    className="bg-white rounded-lg p-3 cursor-pointer border border-slate-200 hover:shadow-md transition">
                    <div className="text-sm font-bold" style={{ direction: lang === 'ar' ? 'rtl' : 'ltr' }}>{lang === 'en' && enName ? enName : c.name}</div>
                    {lang === 'ar' && enName && <div className="text-[10px] text-blue-500">{enName}</div>}
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
                  );
                });
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
            {(() => {
              const custRecord = customers.find(cr => cr.name === selectedCustomer || cr.name_ar === selectedCustomer);
              const enName = custRecord ? custRecord.name_en : '';
              return (
                <div className="mb-3">
                  <h3 className="text-xl font-extrabold" style={{ direction: lang === 'ar' ? 'rtl' : 'ltr' }}>{selectedCustomer}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    {formData.editingEnName ? (
                      <div className="flex gap-2 items-center">
                        <input value={formData.enName || ''} onChange={e => setFormData({...formData, enName: e.target.value})}
                          placeholder="English name" className="px-2 py-1 border rounded text-sm" autoFocus />
                        <button onClick={async () => {
                          try {
                            if (custRecord) {
                              await dbUpdate('customers', custRecord.id, { name_en: formData.enName }, user?.id);
                            } else {
                              await dbInsert('customers', { name: selectedCustomer, name_ar: selectedCustomer, name_en: formData.enName }, user?.id);
                            }
                            setFormData({...formData, editingEnName: false});
                            await loadAllData();
                          } catch (err) { alert('Error / خطأ: ' + err.message); }
                        }} className="px-2 py-1 bg-emerald-500 text-white rounded text-xs">Save</button>
                        <button onClick={() => setFormData({...formData, editingEnName: false})}
                          className="px-2 py-1 bg-slate-300 rounded text-xs">Cancel</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-blue-500">{enName || 'No English name / لا يوجد اسم بالإنجليزية'}</span>
                        <button onClick={() => setFormData({...formData, editingEnName: true, enName: enName || ''})}
                          className="px-2 py-0.5 rounded border border-blue-300 text-blue-500 text-[10px]">
                          {enName ? 'Edit' : '+ Add English Name'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
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
              <div onClick={() => setTreasuryDrill('net')} className="bg-white rounded-lg p-3 cursor-pointer hover:shadow-md" style={{ borderLeftWidth: 3, borderLeftColor: totalCashIn > totalCashOut ? '#10b981' : '#ef4444' }}>
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
                          <td className="px-2 py-1.5 text-xs" style={{ direction: lang === 'ar' ? 'rtl' : 'ltr' }}>{tx(txn.description, txn.description_en)}</td>
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
            {incomeBuckets.length > 0 && (
              <div className="bg-white rounded-xl p-4 mb-3">
                <h3 className="text-sm font-bold mb-2 text-emerald-700">Income Buckets / تصنيف الإيرادات</h3>
                {incomeBuckets.map((e, i) => (
                  <div key={e.cat}>
                    <div onClick={() => setExpenseDrill('in:' + e.cat)}
                      className="flex justify-between py-1 border-b border-slate-50 text-xs cursor-pointer hover:bg-emerald-50">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                        <span>{e.eng}</span>
                        <span className="text-slate-400">({e.count})</span>
                      </div>
                      <span className="font-bold text-emerald-600">{fE(e.total)} →</span>
                    </div>
                    {Object.entries(e.subs).map(([sub, data]) => (
                      <div key={sub} className="flex justify-between py-0.5 pl-6 text-[10px] text-slate-500">
                        <span>↳ {sub} ({data.count})</span>
                        <span className="text-emerald-500">{fE(data.total)}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
            <div className="bg-white rounded-xl p-4">
              <h3 className="text-sm font-bold mb-2 text-red-700">Expense Buckets / تصنيف المنصرفات</h3>
              {expenseBuckets.map((e, i) => (
                <div key={e.cat}>
                  <div onClick={() => setExpenseDrill(e.cat)}
                    className="flex justify-between py-1 border-b border-slate-50 text-xs cursor-pointer hover:bg-red-50">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                      <span>{e.eng}</span>
                      <span className="text-slate-400">({e.count})</span>
                    </div>
                    <span className="font-bold text-red-500">{fE(e.total)} →</span>
                  </div>
                  {Object.entries(e.subs).map(([sub, data]) => (
                    <div key={sub} className="flex justify-between py-0.5 pl-6 text-[10px] text-slate-500">
                      <span>↳ {sub} ({data.count})</span>
                      <span className="text-red-400">{fE(data.total)}</span>
                    </div>
                  ))}
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
                      <td className="px-3 py-2 text-xs font-semibold" style={{ direction: lang === 'ar' ? 'rtl' : 'ltr' }}>{tx(c.customer_name, c.customer_name_en)}</td>
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
                      <td className="px-3 py-2 text-xs font-semibold" style={{ direction: lang === 'ar' ? 'rtl' : 'ltr' }}>{tx(d.customer_name, d.customer_name_en || d.debtor_name_en)}</td>
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
            <h3 className="text-xl font-extrabold mb-3" style={{ direction: lang === 'ar' ? 'rtl' : 'ltr' }}>{selectedDebtor}</h3>
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
            <div className="flex justify-between flex-wrap gap-2 mb-3">
              <h2 className="text-xl font-extrabold">Warehouse / عهدة المخزن</h2>
              <div className="flex gap-2 items-center flex-wrap">
                <input value={formData.whSearch||''} onChange={e=>setFormData({...formData,whSearch:e.target.value})}
                  placeholder="Search / بحث" className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs w-32" />
                <ModeBar />
              </div>
            </div>
            {(() => {
              const filtered = warehouse.filter(w => {
                if (!inRange(w.expense_date, mode, df, dt)) return false;
                if (formData.whSearch && !(w.description||'').includes(formData.whSearch)) return false;
                return true;
              });
              const total = filtered.reduce((a, w) => a + Number(w.amount), 0);
              const buckets = {};
              filtered.forEach(w => {
                const cat = getWarehouseCat(w.description);
                if (!buckets[cat]) buckets[cat] = { total: 0, count: 0 };
                buckets[cat].total += Number(w.amount);
                buckets[cat].count++;
              });
              const sortedBuckets = Object.entries(buckets).sort((a, b) => b[1].total - a[1].total);
              return (
                <div>
                  <div className="bg-white rounded-xl p-4 mb-3" style={{ borderLeftWidth: 3, borderLeftColor: '#8b5cf6' }}>
                    <div className="text-[10px] text-slate-500">Total / الإجمالي ({filtered.length} entries)</div>
                    <div className="text-2xl font-extrabold text-purple-600">{fE(total)}</div>
                  </div>
                  <div className="bg-white rounded-xl p-4 mb-3">
                    <h3 className="text-sm font-bold mb-2">Expense Buckets / تصنيف المصروفات</h3>
                    {sortedBuckets.map(([cat, data], i) => (
                      <div key={cat} onClick={() => setWarehouseDrill(cat)}
                        className="flex justify-between py-1.5 border-b border-slate-50 text-xs cursor-pointer hover:bg-purple-50">
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                          <span>{cat}</span>
                          <span className="text-slate-400">({data.count})</span>
                        </div>
                        <span className="font-bold text-purple-600">{fE(data.total)} →</span>
                      </div>
                    ))}
                  </div>
                  {warehouseDrill ? (
                    <div className="bg-white rounded-xl p-4">
                      <div className="flex justify-between items-center mb-2">
                        <h3 className="text-sm font-bold">{warehouseDrill} ({filtered.filter(w => getWarehouseCat(w.description) === warehouseDrill).length})</h3>
                        <button onClick={() => setWarehouseDrill(null)}
                          className="px-2 py-1 rounded border border-slate-200 text-xs">Close</button>
                      </div>
                      <div className="overflow-auto max-h-[350px] rounded-lg border border-slate-200">
                        <table className="w-full border-collapse">
                          <thead className="sticky top-0"><tr className="bg-slate-50">
                            <th className="px-2 py-2 text-xs text-left">Date</th>
                            <th className="px-2 py-2 text-xs" style={{ direction: 'rtl' }}>Description</th>
                            <th className="px-2 py-2 text-xs text-right">Amount</th>
                          </tr></thead>
                          <tbody>
                            {filtered
                              .filter(w => getWarehouseCat(w.description) === warehouseDrill)
                              .sort((a, b) => b.expense_date.localeCompare(a.expense_date))
                              .map(w => (
                                <tr key={w.id} className="border-b border-slate-50">
                                  <td className="px-2 py-1.5 text-xs">{w.expense_date}</td>
                                  <td className="px-2 py-1.5 text-xs" style={{ direction: 'rtl' }}>{w.description}</td>
                                  <td className="px-2 py-1.5 text-xs text-right font-semibold text-purple-600">{fE(w.amount)}</td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="flex justify-between pt-2 mt-1 border-t-2 border-purple-300">
                        <span className="text-xs font-bold">Total</span>
                        <span className="text-sm font-extrabold text-purple-600">
                          {fE(filtered.filter(w => getWarehouseCat(w.description) === warehouseDrill).reduce((a, w) => a + Number(w.amount), 0))}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-white rounded-xl p-4">
                      <h3 className="text-sm font-bold mb-2">All Transactions</h3>
                      <div className="overflow-auto max-h-[350px] rounded-lg border border-slate-200">
                        <table className="w-full border-collapse">
                          <thead className="sticky top-0"><tr className="bg-slate-50">
                            <th className="px-2 py-2 text-xs text-left">Date</th>
                            <th className="px-2 py-2 text-xs" style={{ direction: 'rtl' }}>Description</th>
                            <th className="px-2 py-2 text-xs text-right">Amount</th>
                            <th className="px-2 py-2 text-xs">Category</th>
                          </tr></thead>
                          <tbody>
                            {filtered.sort((a, b) => b.expense_date.localeCompare(a.expense_date)).slice(0, 200).map(w => (
                              <tr key={w.id} className="border-b border-slate-50">
                                <td className="px-2 py-1.5 text-xs">{w.expense_date}</td>
                                <td className="px-2 py-1.5 text-xs" style={{ direction: lang === 'ar' ? 'rtl' : 'ltr' }}>{tx(w.description, w.description_en)}</td>
                                <td className="px-2 py-1.5 text-xs text-right font-semibold text-purple-600">{fE(w.amount)}</td>
                                <td className="px-2 py-1.5 text-[10px] text-amber-600">{getWarehouseCat(w.description)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* ==========================================
            INVENTORY TAB
        ========================================== */}
        {tab === 'inventory' && (
          <div>
            <div className="flex justify-between flex-wrap gap-2 mb-3">
              <h2 className="text-xl font-extrabold">Inventory / المخزون</h2>
              <div className="flex gap-2 items-center flex-wrap">
                <input value={query} onChange={e => setQuery(e.target.value)}
                  placeholder="Search / بحث" className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs w-32" />
                <select value={formData.invTypeFilter || 'all'} onChange={e => setFormData({...formData, invTypeFilter: e.target.value})}
                  className="px-2 py-1.5 rounded border text-xs">
                  <option value="all">All Types / كل الأنواع</option>
                  {[...new Set(inventory.map(p => p.product_type).filter(Boolean))].sort().map(t =>
                    <option key={t} value={t}>{t}</option>)}
                </select>
                <button onClick={() => setFormData({...formData, showAddProduct: true})}
                  className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-semibold hover:bg-blue-600">
                  + Add Product / إضافة منتج
                </button>
              </div>
            </div>

            {/* Summary */}
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div className="bg-white rounded-lg p-3" style={{ borderLeftWidth: 3, borderLeftColor: '#8b5cf6' }}>
                <div className="text-[10px] text-slate-500">Total Products / إجمالي المنتجات</div>
                <div className="text-lg font-extrabold">{inventory.length}</div>
              </div>
              <div className="bg-white rounded-lg p-3" style={{ borderLeftWidth: 3, borderLeftColor: '#0ea5e9' }}>
                <div className="text-[10px] text-slate-500">Total Rolls / إجمالي اللفات</div>
                <div className="text-lg font-extrabold">{inventory.reduce((a, p) => a + Number(p.roll_count || 0), 0).toLocaleString()}</div>
              </div>
              <div className="bg-white rounded-lg p-3" style={{ borderLeftWidth: 3, borderLeftColor: '#10b981' }}>
                <div className="text-[10px] text-slate-500">Total Net Weight / الوزن الصافي</div>
                <div className="text-lg font-extrabold">{inventory.reduce((a, p) => a + Number(p.net_weight || 0), 0).toLocaleString()} kg</div>
              </div>
            </div>

            {/* Add Product Form */}
            {formData.showAddProduct && (
              <div className="bg-blue-50 rounded-xl p-4 mb-3 border border-blue-200">
                <h3 className="text-sm font-bold text-blue-800 mb-3">New Product / منتج جديد</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-semibold text-slate-600">Product ID / رقم المنتج</label>
                    <input value={formData.prodId || ''} onChange={e => setFormData({...formData, prodId: e.target.value})}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-slate-600">Reference # / رقم المرجع</label>
                    <input value={formData.prodRef || ''} onChange={e => setFormData({...formData, prodRef: e.target.value})}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-[10px] font-semibold text-slate-600">Shipment Reference / مرجع الشحنة</label>
                    <input value={formData.prodShipment || ''} onChange={e => setFormData({...formData, prodShipment: e.target.value})}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-[10px] font-semibold text-slate-600">Product Type / نوع المنتج</label>
                    <div className="flex gap-2">
                      <select value={formData.prodType || ''} onChange={e => { if (e.target.value === '_new') { const n = prompt('New product type / نوع جديد:'); if (n) setFormData({...formData, prodType: n}); } else { setFormData({...formData, prodType: e.target.value}); }}}
                        className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm">
                        <option value="">Select type... / اختر النوع</option>
                        {['Pool', 'Leather', 'Roofing', 'Fabrics', 'PVC', 'Chemicals', 'Headliner', 'Boat Flooring', 'Upholstery',
                          ...new Set(inventory.map(p => p.product_type).filter(Boolean))].filter((v, i, a) => v && a.indexOf(v) === i).sort().map(t =>
                          <option key={t} value={t}>{t}</option>)}
                        <option value="_new">+ Add New Type / إضافة نوع جديد</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-slate-600">Color / اللون</label>
                    <input value={formData.prodColor || ''} onChange={e => setFormData({...formData, prodColor: e.target.value})}
                      placeholder="Arabic" className="w-full px-3 py-1.5 rounded-lg border border-slate-200 text-sm" style={{ direction: 'rtl' }} />
                    <input value={formData.prodColorEn || ''} onChange={e => setFormData({...formData, prodColorEn: e.target.value})}
                      placeholder="English" className="w-full px-3 py-1.5 rounded-lg border border-slate-200 text-sm mt-1" />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-slate-600">Description / الوصف</label>
                    <input value={formData.prodDesc || ''} onChange={e => setFormData({...formData, prodDesc: e.target.value})}
                      placeholder="Arabic" className="w-full px-3 py-1.5 rounded-lg border border-slate-200 text-sm" style={{ direction: 'rtl' }} />
                    <input value={formData.prodDescEn || ''} onChange={e => setFormData({...formData, prodDescEn: e.target.value})}
                      placeholder="English" className="w-full px-3 py-1.5 rounded-lg border border-slate-200 text-sm mt-1" />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-slate-600">Roll Count / عدد اللفات</label>
                    <input type="number" value={formData.prodRolls || ''} onChange={e => setFormData({...formData, prodRolls: e.target.value})}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-slate-600">Gross Weight / الوزن الإجمالي (kg)</label>
                    <input type="number" value={formData.prodGross || ''} onChange={e => setFormData({...formData, prodGross: e.target.value})}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-slate-600">Net Weight / الوزن الصافي (kg)</label>
                    <input type="number" value={formData.prodNet || ''} onChange={e => setFormData({...formData, prodNet: e.target.value})}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-slate-600">Unit Price / سعر الوحدة</label>
                    <input type="number" value={formData.prodPrice || ''} onChange={e => setFormData({...formData, prodPrice: e.target.value})}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <button onClick={async () => {
                    try {
                      await dbInsert('inventory', {
                        product_id: formData.prodId || '',
                        reference_number: formData.prodRef || '',
                        shipment_reference: formData.prodShipment || '',
                        product_type: formData.prodType || '',
                        description: formData.prodDesc || '',
                        description_en: formData.prodDescEn || '',
                        color: formData.prodColor || '',
                        color_en: formData.prodColorEn || '',
                        roll_count: Number(formData.prodRolls) || 0,
                        gross_weight: Number(formData.prodGross) || 0,
                        net_weight: Number(formData.prodNet) || 0,
                        unit_price: Number(formData.prodPrice) || 0,
                      }, user?.id);
                      setFormData({});
                      await loadAllData();
                    } catch (err) { alert('Error / خطأ: ' + err.message); }
                  }} className="px-4 py-2 bg-emerald-500 text-white rounded-lg font-semibold text-sm">Save / حفظ</button>
                  <button onClick={() => setFormData({})} className="px-4 py-2 border border-slate-200 rounded-lg text-sm">Cancel / إلغاء</button>
                </div>
              </div>
            )}

            {/* Product List */}
            <div className="overflow-auto rounded-lg border border-slate-200 max-h-[450px]">
              <table className="w-full border-collapse">
                <thead className="sticky top-0"><tr className="bg-slate-50">
                  <th className="px-2 py-2 text-[10px] text-left">Product ID / المنتج</th>
                  <th className="px-2 py-2 text-[10px] text-left">Ref# / المرجع</th>
                  <th className="px-2 py-2 text-[10px]">Type / النوع</th>
                  <th className="px-2 py-2 text-[10px]">Shipment / الشحنة</th>
                  <th className="px-2 py-2 text-[10px]">Description / الوصف</th>
                  <th className="px-2 py-2 text-[10px]">Color / اللون</th>
                  <th className="px-2 py-2 text-[10px] text-right">Rolls / لفات</th>
                  <th className="px-2 py-2 text-[10px] text-right">Net / صافي</th>
                  <th className="px-2 py-2 text-[10px] text-right">Price / سعر</th>
                  <th className="px-2 py-2 text-[10px]">Status</th>
                </tr></thead>
                <tbody>
                  {inventory
                    .filter(p => {
                      if (formData.invTypeFilter && formData.invTypeFilter !== 'all' && p.product_type !== formData.invTypeFilter) return false;
                      if (!query) return true;
                      return (p.product_id || '').includes(query) || (p.reference_number || '').includes(query) || (p.shipment_reference || '').includes(query) || (p.description || '').includes(query) || (p.description_en || '').toLowerCase().includes(query.toLowerCase()) || (p.color || '').includes(query) || (p.product_type || '').toLowerCase().includes(query.toLowerCase());
                    })
                    .map(p => (
                    <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50 cursor-pointer"
                      onClick={() => setFormData({...formData, selectedProduct: p})}>
                      <td className="px-2 py-1.5 text-xs font-bold text-blue-600">{p.product_id || '—'}</td>
                      <td className="px-2 py-1.5 text-xs font-semibold">{p.reference_number}</td>
                      <td className="px-2 py-1.5">{p.product_type ? <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded text-[9px]">{p.product_type}</span> : <span className="text-[9px] text-slate-300">—</span>}</td>
                      <td className="px-2 py-1.5 text-[10px] text-slate-500">{p.shipment_reference || '—'}</td>
                      <td className="px-2 py-1.5">
                        <div className="text-xs" style={{ direction: lang === 'ar' ? 'rtl' : 'ltr' }}>{lang === 'en' && p.description_en ? p.description_en : p.description}</div>
                        {lang === 'ar' && p.description_en && <div className="text-[10px] text-blue-500">{p.description_en}</div>}
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="text-xs" style={{ direction: lang === 'ar' ? 'rtl' : 'ltr' }}>{lang === 'en' && p.color_en ? p.color_en : p.color}</div>
                        {lang === 'ar' && p.color_en && <div className="text-[10px] text-blue-500">{p.color_en}</div>}
                      </td>
                      <td className="px-2 py-1.5 text-xs text-right font-semibold">{p.roll_count}</td>
                      <td className="px-2 py-1.5 text-xs text-right">{fmt(p.net_weight)} kg</td>
                      <td className="px-2 py-1.5 text-xs text-right font-semibold text-emerald-600">{fE(p.unit_price)}</td>
                      <td className="px-2 py-1.5">
                        <span className={'px-1.5 py-0.5 rounded-full text-[9px] font-semibold ' +
                          (p.stock_status === 'in_stock' ? 'bg-green-100 text-green-700' :
                           p.stock_status === 'low' ? 'bg-amber-100 text-amber-700' :
                           p.stock_status === 'reserved' ? 'bg-blue-100 text-blue-700' :
                           'bg-red-100 text-red-700')}>
                          {p.stock_status === 'in_stock' ? 'In Stock' : p.stock_status === 'low' ? 'Low' : p.stock_status === 'reserved' ? 'Reserved' : 'Out'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Product Detail */}
            {formData.selectedProduct && (
              <Modal onClose={() => setFormData({...formData, selectedProduct: null})}
                title={'Product / منتج: ' + formData.selectedProduct.reference_number}>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-slate-50 rounded-lg p-3">
                      <div className="text-[10px] text-slate-500">Description / الوصف</div>
                      <div className="text-sm font-bold" style={{ direction: 'rtl' }}>{formData.selectedProduct.description}</div>
                      {formData.selectedProduct.description_en && <div className="text-xs text-blue-500">{formData.selectedProduct.description_en}</div>}
                    </div>
                    <div className="bg-slate-50 rounded-lg p-3">
                      <div className="text-[10px] text-slate-500">Color / اللون</div>
                      <div className="text-sm font-bold" style={{ direction: 'rtl' }}>{formData.selectedProduct.color}</div>
                      {formData.selectedProduct.color_en && <div className="text-xs text-blue-500">{formData.selectedProduct.color_en}</div>}
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    <div className="bg-purple-50 rounded-lg p-2 text-center">
                      <div className="text-[9px] text-slate-500">Rolls / لفات</div>
                      <div className="text-lg font-bold text-purple-600">{formData.selectedProduct.roll_count}</div>
                    </div>
                    <div className="bg-blue-50 rounded-lg p-2 text-center">
                      <div className="text-[9px] text-slate-500">Gross / إجمالي</div>
                      <div className="text-sm font-bold">{fmt(formData.selectedProduct.gross_weight)} kg</div>
                    </div>
                    <div className="bg-emerald-50 rounded-lg p-2 text-center">
                      <div className="text-[9px] text-slate-500">Net / صافي</div>
                      <div className="text-sm font-bold">{fmt(formData.selectedProduct.net_weight)} kg</div>
                    </div>
                    <div className="bg-amber-50 rounded-lg p-2 text-center">
                      <div className="text-[9px] text-slate-500">Price / سعر</div>
                      <div className="text-sm font-bold text-emerald-600">{fE(formData.selectedProduct.unit_price)}</div>
                    </div>
                  </div>
                  <h4 className="text-xs font-bold mt-2">Linked Invoices / الفواتير المرتبطة</h4>
                  <div className="overflow-auto max-h-[200px] rounded border border-slate-200">
                    {invoiceItems.filter(it => (it.description || '').includes(formData.selectedProduct.description) || (it.description || '').includes(formData.selectedProduct.reference_number)).length > 0 ? (
                      <table className="w-full border-collapse">
                        <thead><tr className="bg-slate-50">
                          <th className="px-2 py-1 text-[10px] text-left">Invoice</th>
                          <th className="px-2 py-1 text-[10px] text-right">Qty</th>
                          <th className="px-2 py-1 text-[10px] text-right">Price</th>
                          <th className="px-2 py-1 text-[10px] text-right">Total</th>
                        </tr></thead>
                        <tbody>
                          {invoiceItems.filter(it => (it.description || '').includes(formData.selectedProduct.description) || (it.description || '').includes(formData.selectedProduct.reference_number)).map(it => {
                            const inv = invoices.find(i => i.id === it.invoice_id);
                            return (
                              <tr key={it.id} className="border-b border-slate-50 cursor-pointer hover:bg-blue-50"
                                onClick={() => { if (inv) { setFormData({...formData, selectedProduct: null}); setSelectedInvoice(inv); } }}>
                                <td className="px-2 py-1 text-xs font-semibold">{inv ? '#' + inv.order_number : '—'}</td>
                                <td className="px-2 py-1 text-xs text-right">{fmt(it.quantity)}</td>
                                <td className="px-2 py-1 text-xs text-right">{fmt(it.unit_price)}</td>
                                <td className="px-2 py-1 text-xs text-right font-semibold">{fE(it.line_total)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    ) : (
                      <div className="px-3 py-4 text-xs text-slate-400 text-center">No linked invoices / لا توجد فواتير مرتبطة</div>
                    )}
                  </div>
                </div>
              </Modal>
            )}
          </div>
        )}

        {/* ==========================================
            CRM TAB
        ========================================== */}
        {tab === 'crm' && (
          <CRMTab customers={customers} invoices={invoices} user={user} users={teamUsers} onReload={loadAllData} isAdmin={isAdmin} onSelectInvoice={setSelectedInvoice} lang={lang} />
        )}

        {/* ==========================================
            TICKETS TAB
        ========================================== */}
        {tab === 'tickets' && (
          <TicketsTab customers={customers} user={user} users={teamUsers} onReload={loadAllData} lang={lang} />
        )}

        {/* ==========================================
            CALENDAR TAB
        ========================================== */}
        {tab === 'calendar' && (
          <CalendarTab customers={customers} user={user} users={teamUsers} onReload={loadAllData} />
        )}

        {/* ==========================================
            CUSTOMS / BROKER TAB
        ========================================== */}
        {tab === 'customs' && (
          <CustomsTab customers={customers} user={user} />
        )}

        {/* ==========================================
            SHIPPING RATES TAB
        ========================================== */}
        {tab === 'shipping' && (
          <ShippingRatesTab user={user} isAdmin={isAdmin} customers={customers} />
        )}

        {/* ==========================================
            DAILY LOG TAB
        ========================================== */}
        {tab === 'dailylog' && (
          <DailyLogTab user={user} users={teamUsers} isAdmin={isAdmin} />
        )}

        {/* ==========================================
            ADMIN TAB
        ========================================== */}
        {tab === 'admin' && (
          <AdminTab user={user} users={teamUsers} />
        )}

        {/* ==========================================
            AI ASSISTANT TAB
        ========================================== */}
        {tab === 'ai' && (
          <AIAssistant user={user} />
        )}

        {/* ==========================================
            SETTINGS TAB
        ========================================== */}
        {tab === 'settings' && (
          <SettingsTab user={user} users={teamUsers} onReload={loadAllData} isAdmin={isAdmin} />
        )}


                {/* ==========================================
            IMPORT TAB
        ========================================== */}
        {tab === 'import' && (
          <div>
            <h2 className="text-xl font-extrabold mb-3">Import / استيراد البيانات</h2>

            {importStep === 'select' && (
              <div>
                <div className="bg-white rounded-xl p-6 mb-4 text-center border-2 border-dashed border-blue-300">
                  <div className="text-4xl mb-2">📁</div>
                  <h3 className="text-sm font-bold mb-1">Upload Excel File / رفع ملف إكسل</h3>
                  <p className="text-[10px] text-slate-400 mb-3">System auto-detects: Sales, Treasury, Warehouse, Merchandiser, Checks<br/>النظام يكتشف تلقائياً نوع الملف</p>
                  <label className="px-6 py-3 bg-blue-500 text-white rounded-lg text-sm font-semibold cursor-pointer hover:bg-blue-600 inline-block">
                    Select File / اختر ملف
                    <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files[0];
                        if (!file) return;
                        await processImportFile(file);
                      }} />
                  </label>
                </div>
                <div className="bg-white rounded-xl p-4">
                  <h3 className="text-sm font-bold mb-2">Supported File Types / أنواع الملفات المدعومة</h3>
                  <div className="space-y-2 text-xs">
                    <div className="flex gap-3 py-2 border-b border-slate-50"><span className="font-bold text-blue-600 w-28">Sales / المبيعات</span><span className="text-slate-500">Order#, Customer, Amount, Paid, Remaining</span></div>
                    <div className="flex gap-3 py-2 border-b border-slate-50"><span className="font-bold text-emerald-600 w-28">Treasury / الخزنة</span><span className="text-slate-500">Date, Order#, Description, Cash In, Cash Out</span></div>
                    <div className="flex gap-3 py-2 border-b border-slate-50"><span className="font-bold text-purple-600 w-28">Warehouse / المخزن</span><span className="text-slate-500">Date, Description, Amount</span></div>
                    <div className="flex gap-3 py-2 border-b border-slate-50"><span className="font-bold text-amber-600 w-28">Merchandiser / الأوامر</span><span className="text-slate-500">Multiple tabs with Product Code, Qty, Price</span></div>
                    <div className="flex gap-3 py-2"><span className="font-bold text-red-600 w-28">Checks / شيكات</span><span className="text-slate-500">Customer, Order#, Amount, Check Date</span></div>
                  </div>
                </div>
              </div>
            )}

            {importStep === 'preview' && importData.length > 0 && (
              <div>
                <div className="bg-emerald-50 rounded-xl p-4 mb-3 border border-emerald-200">
                  <div className="flex justify-between items-center">
                    <div>
                      <h3 className="text-sm font-bold text-emerald-800">Detected / تم الكشف: {importType.toUpperCase()}</h3>
                      <p className="text-xs text-emerald-600">{importStats.file} — {importStats.total} rows / صفوف</p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => { setImportStep('select'); setImportData([]); setImportType(null); }}
                        className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-semibold">Cancel / إلغاء</button>
                      <button onClick={executeImport}
                        className="px-4 py-1.5 bg-emerald-500 text-white rounded-lg text-xs font-semibold hover:bg-emerald-600">
                        Import {importStats.total} Rows / استيراد
                      </button>
                    </div>
                  </div>
                </div>
                <div className="bg-white rounded-xl p-4">
                  <h3 className="text-sm font-bold mb-2">Preview / معاينة (first 20 rows)</h3>
                  <div className="overflow-auto max-h-[400px] rounded-lg border border-slate-200">
                    <table className="w-full border-collapse text-xs">
                      <thead className="sticky top-0"><tr className="bg-slate-50">
                        {Object.keys(importData[0] || {}).map(k => (
                          <th key={k} className="px-2 py-2 text-[10px] text-left font-semibold">{k}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {importData.slice(0, 20).map((row, i) => (
                          <tr key={i} className="border-b border-slate-50">
                            {Object.values(row).map((v, j) => (
                              <td key={j} className="px-2 py-1.5 text-[10px]" style={{ direction: typeof v === 'string' && /[\u0600-\u06FF]/.test(v) ? 'rtl' : 'ltr' }}>
                                {typeof v === 'number' ? v.toLocaleString() : String(v || '')}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {importStep === 'importing' && (
              <div className="bg-white rounded-xl p-8 text-center">
                <div className="text-4xl mb-3">⏳</div>
                <h3 className="text-lg font-bold mb-2">Importing / جاري الاستيراد...</h3>
                <div className="w-full bg-slate-200 rounded-full h-3 mb-2">
                  <div className="bg-blue-500 h-3 rounded-full transition-all" style={{ width: importProgress + '%' }}></div>
                </div>
                <p className="text-sm text-slate-500">{importProgress}%</p>
              </div>
            )}

            {importStep === 'done' && (
              <div className="bg-white rounded-xl p-8 text-center">
                <div className="text-4xl mb-3">✅</div>
                <h3 className="text-lg font-bold mb-2 text-emerald-700">Import Complete / تم الاستيراد</h3>
                <div className="text-sm space-y-1 mb-4">
                  <p>Type / النوع: <span className="font-bold">{importType}</span></p>
                  <p>Imported / تم استيراد: <span className="font-bold text-emerald-600">{importStats.imported}</span></p>
                  {importStats.skipped > 0 && <p>Skipped (duplicates) / تم تخطي: <span className="font-bold text-amber-600">{importStats.skipped}</span></p>}
                </div>
                <button onClick={() => { setImportStep('select'); setImportData([]); setImportType(null); setImportStats(null); }}
                  className="px-6 py-2 bg-blue-500 text-white rounded-lg font-semibold">
                  Import Another File / استيراد ملف آخر
                </button>
                {importStats?.lastBatchIds?.length > 0 && (
                  <button onClick={undoLastImport}
                    className="px-6 py-2 bg-red-500 text-white rounded-lg font-semibold ml-2">
                    ⏪ Undo Import / إلغاء الاستيراد ({importStats.lastBatchIds.length} records)
                  </button>
                )}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
