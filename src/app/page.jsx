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
import BankTab from '../components/BankTab';
import QuotesTab from '../components/QuotesTab';

// Modal must be outside main component to prevent re-mounting on every render
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
import CommunicationsTab from '../components/CommunicationsTab';
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
  { id: 'quotes', label: 'Quotes / عروض', icon: '📋' },
  { id: 'treasury', label: 'Treasury / الخزنة', icon: '🏦' },
  { id: 'bank', label: 'Bank / البنك', icon: '🏛️' },
  { id: 'checks', label: 'Checks / شيكات', icon: '📝' },
  { id: 'debts', label: 'Debts / المديونية', icon: '⚠️' },
  { id: 'warehouse', label: 'Warehouse / المخزن', icon: '🏭' },
  { id: 'inventory', label: 'Inventory / المخزون', icon: '📦' },
  { id: 'customs', label: 'Customs / جمارك', icon: '🚢' },
  { id: 'shipping', label: 'Shipping Rates / شحن', icon: '🛳️' },
  { id: 'crm', label: 'CRM', icon: '🤝' },
  { id: 'tickets', label: 'Tickets / تذاكر', icon: '🎫' },
  { id: 'comms', label: 'Communications / رسائل', icon: '📬' },
  { id: 'calendar', label: 'Calendar / تقويم', icon: '📅' },
  { id: 'dailylog', label: 'Daily Log / يومي', icon: '📓' },
  { id: 'admin', label: 'Admin / إدارة', icon: '👑' },
  { id: 'ai', label: 'AI Assistant / ذكي', icon: '🤖' },
  { id: 'settings', label: 'Settings / إعدادات', icon: '⚙️' },
  { id: 'import', label: 'Import / استيراد', icon: '📥' },
];

// ============================================
// PAYMENT FORM (isolated state to prevent focus loss)
// ============================================
function PaymentForm({ invoice, categories, existingSubcats, onSave, onCancel, formData, setFormData }) {
  const [pf, setPf] = useState({ date: formData.date || new Date().toISOString().substring(0, 10), amount: formData.amount || '', payMethod: formData.payMethod || 'cash', desc: formData.desc || '', category: formData.category || 'مبيعات', subcategory: formData.subcategory || '' });

  const handleSave = () => {
    setFormData({ ...formData, ...pf });
    setTimeout(() => onSave(pf), 50);
  };

  return (
    <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-slate-600">Date / تاريخ</label>
          <input type="date" value={pf.date}
            onChange={e => setPf({ ...pf, date: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-600">Amount / المبلغ</label>
          <input type="number" value={pf.amount}
            onChange={e => setPf({ ...pf, amount: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
            placeholder={invoice ? 'Remaining: ' + (Number(invoice.outstanding || 0)).toLocaleString() : ''} />
        </div>
      </div>

      {/* Payment Method — Radio Buttons */}
      <div className="mt-3">
        <label className="text-xs font-semibold text-slate-600 block mb-1.5">Payment Method / طريقة الدفع</label>
        <div className="flex gap-2 flex-wrap">
          {[
            { v: 'cash', l: '💵 Cash', sub: 'Adds to treasury' },
            { v: 'bank_transfer', l: '🏦 Bank Transfer', sub: 'Invoice only' },
            { v: 'check', l: '📝 Check', sub: 'Invoice only' },
            { v: 'vodafone', l: '📱 Vodafone Cash', sub: 'Invoice only' },
            { v: 'other', l: '📋 Other', sub: 'Invoice only' },
          ].map(m => (
            <label key={m.v} onClick={() => setPf({ ...pf, payMethod: m.v })}
              className={'flex items-center gap-2 px-3 py-2 rounded-lg border-2 cursor-pointer transition text-xs ' +
                (pf.payMethod === m.v ? 'bg-blue-100 border-blue-400 font-bold text-blue-700' : 'bg-white border-slate-200 text-slate-600 hover:border-blue-200')}>
              <input type="radio" name="payMethod" checked={pf.payMethod === m.v} onChange={() => {}} className="w-3.5 h-3.5" />
              <div><div>{m.l}</div><div className="text-[9px] font-normal text-slate-400">{m.sub}</div></div>
            </label>
          ))}
        </div>
        {pf.payMethod !== 'cash' && <div className="text-[10px] text-blue-600 mt-1">ℹ️ Only cash adds to treasury register. {pf.payMethod === 'bank_transfer' ? 'Bank transfer' : pf.payMethod === 'check' ? 'Check' : pf.payMethod === 'vodafone' ? 'Vodafone Cash' : 'This method'} updates the invoice only.</div>}
      </div>

      {/* Category & Subcategory */}
      <div className="grid grid-cols-2 gap-3 mt-3">
        <div>
          <label className="text-xs font-semibold text-slate-600">Category / التصنيف</label>
          <select value={pf.category || ''} onChange={e => setPf({ ...pf, category: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm">
            <option value="">Select...</option>
            {categories.map(([ar, en]) => <option key={ar} value={ar}>{en} / {ar}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-600">Subcategory / تصنيف فرعي</label>
          <input list="pay-subcats" value={pf.subcategory || ''}
            onChange={e => setPf({ ...pf, subcategory: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
            placeholder="Type or select..." />
          <datalist id="pay-subcats">
            {existingSubcats.map(s => <option key={s} value={s} />)}
          </datalist>
        </div>
      </div>

      <div className="mt-3">
        <label className="text-xs font-semibold text-slate-600">Description / الوصف</label>
        <input value={pf.desc}
          onChange={e => setPf({ ...pf, desc: e.target.value })}
          className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
          placeholder="Optional notes..." />
      </div>

      <div className="flex gap-2 mt-3">
        <button onClick={handleSave}
          className="px-4 py-2 bg-blue-500 text-white rounded-lg font-semibold text-sm">Save / حفظ ✓</button>
        <button onClick={onCancel}
          className="px-4 py-2 border border-slate-200 rounded-lg font-semibold text-sm">Cancel / إلغاء</button>
      </div>
    </div>
  );
}

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
  const [customerFilter, setCustomerFilter] = useState('');

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
  const [invInbounds, setInvInbounds] = useState([]);
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
  const [reconcileDate, setReconcileDate] = useState('');
  const [reconcileMethod, setReconcileMethod] = useState('check');
  const [expenseDrill, setExpenseDrill] = useState(null);
  const [tSearch, setTSearch] = useState({ show: false, type: 'all', cat: '', subcat: '', desc: '', dateFrom: '', dateTo: '', inboundRef: '' });
  const [bucketSub, setBucketSub] = useState(null);
  const [bucketSearch, setBucketSearch] = useState('');
  const [editSubTxnId, setEditSubTxnId] = useState(null);
  const [editSubValue, setEditSubValue] = useState('');
  const [editCatValue, setEditCatValue] = useState('');
  const [divisionDrill, setDivisionDrill] = useState(null);
  const [renamingBucket, setRenamingBucket] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [warehouseDrill, setWarehouseDrill] = useState(null);
  const [whDescDrill, setWhDescDrill] = useState(null);
  const [whSubFilter, setWhSubFilter] = useState('all');
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
  const [hideSections, setHideSections] = useState({});
  const [announcements, setAnnouncements] = useState([]);
  const [showAddAnnouncement, setShowAddAnnouncement] = useState(false);
  const [reminders, setReminders] = useState([]);
  const [showReminderForm, setShowReminderForm] = useState(false);
  const [showReminderArchive, setShowReminderArchive] = useState(false);
  const seenRemindersRef = useRef(new Set());
  
  // Emergency sound for new reminders
  useEffect(() => {
    if (!reminders.length || !userProfile) return;
    const todayStr = new Date().toISOString().substring(0, 10);
    const myActive = reminders.filter(r => {
      const isForMe = !r.target_users || r.target_users === 'all' || (r.target_users || '').includes(userProfile?.id);
      const isToday = r.reminder_date === todayStr || (!r.reminder_date && r.created_at && r.created_at.substring(0, 10) === todayStr);
      return isForMe && isToday;
    });
    const newOnes = myActive.filter(r => !seenRemindersRef.current.has(r.id));
    if (newOnes.length > 0) {
      newOnes.forEach(r => seenRemindersRef.current.add(r.id));
      // Play emergency alert sound using Web Audio API
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const playTone = (freq, start, dur) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain); gain.connect(ctx.destination);
          osc.frequency.value = freq;
          osc.type = 'square';
          gain.gain.setValueAtTime(0.3, ctx.currentTime + start);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + start + dur);
          osc.start(ctx.currentTime + start);
          osc.stop(ctx.currentTime + start + dur);
        };
        // 5-second alert pattern: urgent ascending tones
        const urgent = newOnes.some(r => r.priority === 'urgent');
        if (urgent) {
          for (let i = 0; i < 10; i++) { playTone(800 + (i % 2) * 400, i * 0.5, 0.4); }
        } else {
          for (let i = 0; i < 6; i++) { playTone(600, i * 0.8, 0.3); playTone(800, i * 0.8 + 0.3, 0.3); }
        }
      } catch(e) {}
    }
  }, [reminders, userProfile]);
  
  // Poll for new reminders every 60 seconds
  useEffect(() => {
    const pollReminders = setInterval(async () => {
      try {
        const { data: rems } = await supabase.from('team_reminders').select('*').order('created_at', { ascending: false }).limit(50);
        if (rems) setReminders(rems);
      } catch(e) {}
    }, 60000);
    return () => clearInterval(pollReminders);
  }, []);

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

    // Heartbeat: update last_seen every 5 min
    const heartbeat = setInterval(async () => {
      const { data: { session: s } } = await supabase.auth.getSession();
      if (s?.user) {
        const today = new Date().toISOString().split('T')[0];
        await supabase.from('user_sessions')
          .update({ last_seen: new Date().toISOString() })
          .eq('user_id', s.user.id)
          .eq('date', today)
          .order('login_at', { ascending: false })
          .limit(1);
      }
    }, 5 * 60 * 1000);

    // Record last_seen on page close
    const handleUnload = () => {
      const uid = user?.id;
      if (uid) {
        const today = new Date().toISOString().split('T')[0];
        navigator.sendBeacon('/api/plaid/link', ''); // no-op, just to keep alive
        supabase.from('user_sessions')
          .update({ last_seen: new Date().toISOString(), logout_at: new Date().toISOString() })
          .eq('user_id', uid).eq('date', today)
          .order('login_at', { ascending: false }).limit(1).then(() => {});
      }
    };
    window.addEventListener('beforeunload', handleUnload);

    return () => { subscription?.unsubscribe(); clearInterval(heartbeat); window.removeEventListener('beforeunload', handleUnload); };
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
          const authEmail = (authUser.email || '').toLowerCase();
          const profile = usrs.find(u => (u.email || '').toLowerCase() === authEmail);
          if (profile) {
            setUserProfile(profile);
            // Log first login of the day
            try {
              const todayStr = new Date().toISOString().substring(0, 10);
              const loginTime = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
              const { data: existing } = await supabase.from('daily_log')
                .select('id').eq('user_id', profile.id).eq('log_date', todayStr)
                .ilike('entry_text', '%logged in%').limit(1);
              if (!existing || existing.length === 0) {
                await supabase.from('daily_log').insert({
                  user_id: profile.id,
                  entry_text: '🟢 Logged in at ' + loginTime,
                  auto_generated: true,
                  log_date: todayStr,
                  log_category: 'login',
                });
              }
            } catch(e) { /* non-fatal */ }
          }
        }
        // Load module permissions for current user
        if (authUser) {
          const authEmail = (authUser.email || '').toLowerCase();
          const currentProfile = (usrs || []).find(u => (u.email || '').toLowerCase() === authEmail);
          const currentUserId = currentProfile?.id;
          if (currentUserId) {
            const { data: perms } = await supabase.from('module_permissions').select('*').eq('user_id', currentUserId);
            const permMap = {};
            (perms || []).forEach(p => { permMap[p.module_name] = p.has_access; });
            setModulePerms(permMap);
          }
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
      // Load inbounds (may not exist yet)
      try {
        const ib = await fetchAll('inventory_inbounds', 'inbound_date', true);
        setInvInbounds(ib || []);
      } catch(e) { setInvInbounds([]); }
      // Load reminders
      try {
        const { data: rems } = await supabase.from('team_reminders').select('*').order('created_at', { ascending: false }).limit(200);
        setReminders(rems || []);
      } catch(e) { setReminders([]); }
      // Load announcements
      try {
        const { data: ann } = await supabase.from('announcements').select('*').order('created_at', { ascending: false }).limit(20);
        setAnnouncements(ann || []);
      } catch(e) { setAnnouncements([]); }
    } catch (err) {
      console.error('Load error:', err);
    }
  };

  // ==========================================
  // COMPUTED VALUES
  // ==========================================
  const isAdmin = userProfile?.role === 'super_admin' || userProfile?.role === 'admin';

  // Tab-to-module mapping for permission filtering
  const TAB_MODULE_MAP = {
    dashboard: 'Dashboard', sales: 'Sales', customers: 'Customers', treasury: 'Treasury',
    checks: 'Checks', debts: 'Debts', warehouse: 'Warehouse', inventory: 'Inventory',
    crm: 'CRM', tickets: 'Tickets', calendar: 'Calendar', customs: 'Customs', shipping: 'Shipping Rates',
    dailylog: 'Daily Log', admin: 'Admin', ai: 'AI Assistant', settings: 'Settings', import: 'Import', bank: 'Bank', quotes: 'Quotes',
  };

  const visibleTabs = useMemo(() => {
    if (userProfile?.role === 'super_admin') return TABS; // super admin sees all
    if (!userProfile) return TABS.filter(t => t.id === 'dashboard'); // loading — show nothing
    return TABS.filter(t => {
      const moduleName = TAB_MODULE_MAP[t.id];
      // If permission explicitly set, use it
      if (moduleName && modulePerms[moduleName] !== undefined) return modulePerms[moduleName];
      // Admin with no explicit permission: see everything
      if (userProfile.role === 'admin') return true;
      // Team/viewer with no explicit permission: hide financial + admin tabs
      if (['treasury', 'checks', 'debts', 'sales', 'warehouse', 'inventory', 'admin', 'settings', 'import', 'bank'].includes(t.id)) return false;
      return true;
    });
  }, [userProfile, modulePerms]);

  const filteredInvoices = useMemo(() => {
    let arr = invoices.filter(s => inRange(s.invoice_date, mode, df, dt));
    if (customerFilter) arr = arr.filter(s => s.customer_name === customerFilter || s.customer_name_en === customerFilter);
    if (query) arr = arr.filter(s =>
      (s.customer_name || '').includes(query) || (s.customer_name_en || '').toLowerCase().includes(query.toLowerCase()) || (s.order_number || '').includes(query)
    );
    return arr;
  }, [invoices, mode, df, dt, query, customerFilter]);

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
  const uniqueSubcats = useMemo(() => [...new Set([...treasury.map(t=>t.subcategory), ...expenseRules.map(r=>r.subcategory)].filter(Boolean))].sort().slice(0, 100), [treasury, expenseRules]);
  const customCats = useMemo(() => [...new Set([...treasury.map(t=>t.category), ...expenseRules.map(r=>r.category)].filter(c=>c&&!EXPENSE_CATS[c]&&!c.startsWith('__')))].sort(), [treasury, expenseRules]);

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
    setTab(t); setQuery(''); setCustomerFilter(''); setSelectedCustomer(null); setSelectedDebtor(null);
    setSelectedInvoice(null); setDrillType(null); setTreasuryDrill(null); setSelectedMonth(null);
  };

  const handleSignOut = async () => {
    if (user?.id) {
      const today = new Date().toISOString().split('T')[0];
      await supabase.from('user_sessions')
        .update({ logout_at: new Date().toISOString(), last_seen: new Date().toISOString() })
        .eq('user_id', user.id).eq('date', today)
        .order('login_at', { ascending: false }).limit(1);
    }
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  const handleAddPayment = async (pf) => {
    var pd = pf || formData;
    if (!pd.amount || !pd.date || !selectedInvoice) return;
    try {
      const isCash = pd.payMethod === 'cash';
      // Only CASH goes to treasury (cash register). Check, bank transfer, vodafone, other = invoice only
      if (isCash) {
        await dbInsert('treasury', {
          transaction_date: pd.date,
          order_number: selectedInvoice.order_number,
          description: pd.desc || selectedInvoice.customer_name + ' payment',
          cash_in: Number(pd.amount),
          cash_out: 0,
          category: pd.category || 'مبيعات',
          subcategory: pd.subcategory || '',
        }, user?.id);
      }
      // Update invoice collected
      const newCollected = Number(selectedInvoice.total_collected) + Number(pd.amount);
      await dbUpdate('invoices', selectedInvoice.id, {
        total_collected: newCollected,
        outstanding: Math.max(0, Number(selectedInvoice.total_amount) - newCollected),
        notes: (selectedInvoice.notes || '') + (!isCash ? '\n' + pd.payMethod + ': ' + fE(Number(pd.amount)) + ' on ' + pd.date : ''),
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
        'Customer / العميل': inv.customer_name_en || inv.customer_name,
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
        customer_id: formData.customerId || null,
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
      let cat = formData.category || '';
      let subcat = formData.subcategory || '';
      // Auto-apply rule if no category manually set
      if (!cat && formData.desc) {
        const ruleType = isIncome ? 'income' : 'expense';
        const rule = expenseRules.find(r => (formData.desc || '').includes(r.description_match) && (r.rule_type === ruleType || (!r.rule_type && ruleType === 'expense')));
        if (rule) { cat = rule.category; subcat = rule.subcategory || ''; }
      }
      await dbInsert('treasury', {
        transaction_date: formData.date,
        order_number: formData.orderNumber || '',
        description: formData.desc || '',
        cash_in: isIncome ? Number(formData.amount) : 0,
        cash_out: !isIncome ? Number(formData.amount) : 0,
        category: cat,
        subcategory: subcat,
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
      const fd = {
        date: document.getElementById('tx-date')?.value,
        desc: document.getElementById('tx-desc')?.value,
        cashIn: document.getElementById('tx-in')?.value,
        cashOut: document.getElementById('tx-out')?.value,
        orderNumber: document.getElementById('tx-order')?.value,
        category: document.getElementById('tx-cat')?.value,
        subcategory: document.getElementById('tx-subcat')?.value,
      };
      // Guard against placeholder values
      if (fd.category === '__custom') fd.category = txn.category || '';
      if (fd.subcategory === '__custom') fd.subcategory = txn.subcategory || '';
      const updates = {
        transaction_date: fd.date || txn.transaction_date,
        description: fd.desc || txn.description,
        cash_in: fd.cashIn != null ? Number(fd.cashIn) : txn.cash_in,
        cash_out: fd.cashOut != null ? Number(fd.cashOut) : txn.cash_out,
        order_number: fd.orderNumber != null ? fd.orderNumber : txn.order_number,
        category: fd.category != null ? fd.category : txn.category,
        subcategory: fd.subcategory != null ? fd.subcategory : txn.subcategory,
      };
      await dbUpdate('treasury', txn.id, updates, user?.id);

      // Auto-apply category/subcategory to ALL entries with same description + create rule
      const catChanged = fd.category && fd.category !== txn.category;
      const subChanged = fd.subcategory !== undefined && fd.subcategory !== (txn.subcategory || '');
      if ((catChanged || subChanged) && (fd.category || fd.subcategory)) {
        const desc = (txn.description || '').trim();
        if (desc) {
          // Batch update all matching descriptions
          const batchUpdates = {};
          if (catChanged) batchUpdates.category = fd.category;
          if (subChanged) batchUpdates.subcategory = fd.subcategory;
          await supabase.from('treasury').update(batchUpdates).eq('description', desc);
          
          // Create/update rule
          const ruleType = Number(txn.cash_in || 0) > 0 ? 'income' : 'expense';
          const existing = expenseRules.find(r => r.description_match === desc && (r.rule_type === ruleType || (!r.rule_type && ruleType === 'expense')));
          const ruleData = {
            category: fd.category || txn.category || '',
            subcategory: fd.subcategory !== undefined ? fd.subcategory : (txn.subcategory || ''),
            rule_type: ruleType,
          };
          if (existing) {
            await dbUpdate('expense_rules', existing.id, ruleData, user?.id);
          } else {
            await dbInsert('expense_rules', { description_match: desc, ...ruleData }, user?.id);
          }
        }
      }

      setEditingTxn(null);
      setFormData({});
      setTimeout(() => loadAllData(), 800);
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
      // Recalculate collected from ALL linked treasury entries
      const linked = treasury.filter(t => t.order_number === selectedInvoice.order_number);
      const newCollected = linked.reduce((a, t) => a + Number(t.cash_in || 0), 0) + Number(txn.cash_in || 0);
      await dbUpdate('invoices', selectedInvoice.id, {
        total_collected: newCollected,
        outstanding: Math.max(0, Number(selectedInvoice.total_amount) - newCollected),
        notes: (selectedInvoice.notes || '').replace('UNVERIFIED:', 'RECONCILED:') || 'RECONCILED: Linked to treasury',
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
              const isIncome = Number(row.cash_in || 0) > 0;
              const ruleType = isIncome ? 'income' : 'expense';
              const rule = expenseRules.find(r => (row.description || '').includes(r.description_match) && (r.rule_type === ruleType || (!r.rule_type && ruleType === 'expense')));
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
    if (!reconcileCheck || !reconcileDate) { alert('Please select a collection date'); return; }
    const payMethod = reconcileMethod || 'check';
    try {
      // 1. Mark check as collected
      await dbUpdate('checks', reconcileCheck.id, {
        status: 'collected',
        collection_date: reconcileDate,
      }, user?.id);
      // 2. Only create treasury entry for bank transfer/deposit/other
      // Cash and check payments already have treasury entries created by the accountant
      if (payMethod !== 'cash' && payMethod !== 'check') {
        const desc = reconcileCheck.customer_name + ' (' + payMethod + ' - check reconciled)';
        await dbInsert('treasury', {
          transaction_date: reconcileDate,
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
      setReconcileDate('');
      setReconcileMethod('check');
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
              <td className="px-3 py-2 text-xs font-semibold text-right">
                {inv.customer_name_en ? (
                  <div><div>{inv.customer_name_en}</div><div className="text-[10px] text-slate-400" style={{direction:'rtl'}}>{inv.customer_name}</div></div>
                ) : (
                  <div style={{direction:'rtl'}}>{inv.customer_name}</div>
                )}
              </td>
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
          {(true) && (
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
            {/* Delete Invoice */}
            {(() => {
              const createdAt = new Date(selectedInvoice.created_at || 0);
              const hourAgo = Date.now() - 60 * 60 * 1000;
              const isCreator = selectedInvoice.created_by === userProfile?.id;
              const withinHour = createdAt.getTime() > hourAgo;
              const hasDeletePerm = userProfile?.role === 'super_admin' || modulePerms?.['Delete Invoices'] === true;
              const canDelete = (isCreator && withinHour) || hasDeletePerm;
              if (!canDelete) return null;
              return (
                <div className="flex justify-end mb-2">
                  <button onClick={async () => {
                    if (!confirm('Delete invoice #' + selectedInvoice.order_number + '?\n\nحذف الفاتورة #' + selectedInvoice.order_number + '؟\n\nThis cannot be undone.')) return;
                    try {
                      // Delete line items first
                      await supabase.from('invoice_items').delete().eq('invoice_id', selectedInvoice.id);
                      await supabase.from('invoices').delete().eq('id', selectedInvoice.id);
                      setSelectedInvoice(null);
                      await loadAllData();
                    } catch(err) { alert('Error: ' + err.message); }
                  }} className="px-3 py-1 bg-red-500 text-white rounded-lg text-[10px] font-bold hover:bg-red-600">
                    🗑️ Delete Invoice {isCreator && withinHour && !hasDeletePerm ? '(within 1hr)' : ''}
                  </button>
                </div>
              );
            })()}
            <div className="grid grid-cols-3 gap-3 mb-4">
              {/* Division / Category */}
              <div className="col-span-3 flex items-center gap-2 mb-1">
                <span className="text-[10px] font-bold text-slate-500">Division / القسم:</span>
                <select defaultValue={selectedInvoice.division || ''} key={selectedInvoice.id + '-div'}
                  onChange={async (e) => {
                    let val = e.target.value;
                    if (val === '__custom') {
                      const custom = prompt('Enter custom division name:');
                      if (!custom) { e.target.value = selectedInvoice.division || ''; return; }
                      val = custom.trim();
                    }
                    try {
                      await dbUpdate('invoices', selectedInvoice.id, { division: val || null }, user?.id);
                      await loadAllData();
                    } catch(err) { alert('Error: ' + err.message); }
                  }}
                  className="px-2 py-1 rounded border text-xs bg-indigo-50 min-w-[140px]">
                  <option value="">Default (from CRM group)</option>
                  {[...new Set([
                    ...customers.map(c => c.group_name).filter(Boolean),
                    ...invoices.map(i => i.division).filter(Boolean)
                  ])].sort().map(g => <option key={g} value={g}>{g}</option>)}
                  <option value="__custom">+ Custom...</option>
                </select>
                {(() => {
                  const cust = customers.find(c => c.id === selectedInvoice.customer_id || c.name === selectedInvoice.customer_name);
                  const effective = selectedInvoice.division || cust?.group_name || 'Unassigned';
                  return <span className="text-[10px] text-indigo-600 font-semibold">→ {effective}</span>;
                })()}
              </div>
              <div className="bg-blue-50 rounded-lg p-3">
                <div className="text-[10px] text-blue-700">Invoiced / الفاتورة</div>
                <div className="text-xl font-extrabold text-blue-500">{fE(selectedInvoice.total_amount)}</div>
              </div>
              <div className="bg-emerald-50 rounded-lg p-3">
                <div className="text-[10px] text-emerald-700">Collected / المحصّل</div>
                <div className="text-xl font-extrabold text-emerald-500">{fE(selectedInvoice.total_collected)}</div>
                {Number(selectedInvoice.total_collected) > Number(selectedInvoice.total_amount) && (
                  <div className="text-[9px] text-red-500 font-bold mt-1">⚠️ OVERPAID — may be doubled</div>
                )}
                <button onClick={async () => {
                  const newAmt = prompt('Correct collected amount for this invoice:\n\nCurrent: ' + fE(selectedInvoice.total_collected) + '\nInvoiced: ' + fE(selectedInvoice.total_amount) + '\n\nEnter correct amount:', selectedInvoice.total_collected);
                  if (newAmt === null) return;
                  const n = Number(newAmt);
                  try {
                    await dbUpdate('invoices', selectedInvoice.id, { total_collected: n, outstanding: Math.max(0, Number(selectedInvoice.total_amount) - n) }, user?.id);
                    await loadAllData();
                  } catch(err) { alert('Error: ' + err.message); }
                }} className="text-[9px] text-blue-500 underline mt-1 block">✏️ Fix amount</button>
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
              const items = invoiceItems.filter(it => it.invoice_id === selectedInvoice.id || (it.order_number && it.order_number === String(selectedInvoice.order_number)));
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
                      <button onClick={() => setFormData({...formData, addingItems: true, newItems: [], prodSearch: ''})}
                        className="mt-2 px-3 py-1 bg-blue-100 text-blue-700 rounded text-[10px] font-bold hover:bg-blue-200">
                        + Add More Items / إضافة بنود
                      </button>
                    </div>
                  ) : (
                    <div>
                      <div className="text-xs text-slate-400 mb-2 text-center">No item breakdown available / لا يوجد تفاصيل بنود</div>
                      {!formData.addingItems && (
                        <div className="text-center">
                          <button onClick={() => setFormData({...formData, addingItems: true, newItems: [], prodSearch: ''})}
                            className="px-4 py-2 bg-blue-500 text-white rounded-lg text-xs font-bold">
                            + Add Breakdown / إضافة تفاصيل
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {/* Add Items Form — shared for both cases */}
                  {formData.addingItems && (
                        <div className="bg-white rounded-lg p-3 border border-blue-200">
                          {/* Search inventory or add custom */}
                          <div className="mb-2">
                            <input value={formData.prodSearch || ''} onChange={e => setFormData({...formData, prodSearch: e.target.value})}
                              placeholder="Search inventory / بحث في المخزون..." className="w-full px-2 py-1.5 border rounded text-xs" />
                            {formData.prodSearch && (
                              <div className="max-h-[120px] overflow-auto border rounded mt-1 bg-white">
                                {inventory.filter(p => {
                                  const sq = (formData.prodSearch || '').toLowerCase();
                                  return (p.reference_number || '').toLowerCase().includes(sq) || (p.description || '').includes(formData.prodSearch) || (p.description_en || '').toLowerCase().includes(sq);
                                }).slice(0, 8).map(p => (
                                  <div key={p.id} onClick={() => {
                                    const items = [...(formData.newItems || [])];
                                    items.push({ description: (p.reference_number || '') + ' - ' + (p.description || ''), quantity: 1, unit_price: Number(p.unit_price) || 0, line_total: Number(p.unit_price) || 0, product_id: p.id });
                                    setFormData({...formData, newItems: items, prodSearch: ''});
                                  }} className="px-2 py-1.5 text-[10px] cursor-pointer hover:bg-blue-50 border-b border-slate-50">
                                    <span className="font-bold">{p.reference_number}</span> — {p.description}
                                    <span className="text-emerald-600 ml-1">{fE(p.unit_price)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          {/* Custom item row */}
                          <div className="flex gap-1 mb-2">
                            <input value={formData.customDesc || ''} onChange={e => setFormData({...formData, customDesc: e.target.value})}
                              placeholder="Custom item description" className="flex-1 px-2 py-1 border rounded text-[10px]" />
                            <input type="number" value={formData.customQty || ''} onChange={e => setFormData({...formData, customQty: e.target.value})}
                              placeholder="Qty" className="w-14 px-1 py-1 border rounded text-[10px]" />
                            <input type="number" value={formData.customPrice || ''} onChange={e => setFormData({...formData, customPrice: e.target.value})}
                              placeholder="Price" className="w-20 px-1 py-1 border rounded text-[10px]" />
                            <button onClick={() => {
                              if (!formData.customDesc) return;
                              const qty = Number(formData.customQty) || 1;
                              const price = Number(formData.customPrice) || 0;
                              const items = [...(formData.newItems || [])];
                              items.push({ description: formData.customDesc, quantity: qty, unit_price: price, line_total: qty * price });
                              setFormData({...formData, newItems: items, customDesc: '', customQty: '', customPrice: ''});
                            }} className="px-2 py-1 bg-emerald-500 text-white rounded text-[10px]">+</button>
                          </div>
                          {/* Pending items list */}
                          {(formData.newItems || []).length > 0 && (
                            <div className="mb-2">
                              <table className="w-full border-collapse text-[10px]">
                                <thead><tr className="bg-blue-50">
                                  <th className="px-1 py-1 text-left">Item</th>
                                  <th className="px-1 py-1 text-right">Qty</th>
                                  <th className="px-1 py-1 text-right">Price</th>
                                  <th className="px-1 py-1 text-right">Total</th>
                                  <th className="px-1 py-1 w-6"></th>
                                </tr></thead>
                                <tbody>
                                  {(formData.newItems || []).map((item, idx) => (
                                    <tr key={idx} className="border-b border-slate-50">
                                      <td className="px-1 py-1">{item.description}</td>
                                      <td className="px-1 py-1 text-right">{item.quantity}</td>
                                      <td className="px-1 py-1 text-right">{fE(item.unit_price)}</td>
                                      <td className="px-1 py-1 text-right font-bold">{fE(item.line_total)}</td>
                                      <td className="px-1 py-1 text-center">
                                        <button onClick={() => {
                                          const items = (formData.newItems || []).filter((_, i) => i !== idx);
                                          setFormData({...formData, newItems: items});
                                        }} className="text-red-400 hover:text-red-600">✕</button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              <div className="flex justify-between pt-1 mt-1 border-t border-blue-200 text-xs">
                                <span className="font-bold">Total</span>
                                <span className="font-extrabold text-blue-600">{fE((formData.newItems || []).reduce((a, i) => a + (i.line_total || 0), 0))}</span>
                              </div>
                            </div>
                          )}
                          {/* Save / Cancel */}
                          <div className="flex gap-2">
                            <button onClick={async () => {
                              const items = formData.newItems || [];
                              if (items.length === 0) return;
                              try {
                                for (const item of items) {
                                  await dbInsert('invoice_items', {
                                    invoice_id: selectedInvoice.id,
                                    description: item.description,
                                    quantity: item.quantity || 1,
                                    unit_price: item.unit_price || 0,
                                    line_total: item.line_total || 0,
                                    product_id: item.product_id || null,
                                  }, user?.id);
                                }
                                setFormData({...formData, addingItems: false, newItems: []});
                                await loadAllData();
                              } catch(err) { alert('Error: ' + err.message); }
                            }} className="px-3 py-1.5 bg-blue-500 text-white rounded text-xs font-bold" disabled={(formData.newItems || []).length === 0}>
                              💾 Save {(formData.newItems || []).length} Items
                            </button>
                            <button onClick={() => setFormData({...formData, addingItems: false, newItems: []})}
                              className="px-3 py-1.5 border rounded text-xs">Cancel</button>
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
                            <input type="date" id="tx-date" defaultValue={txn.transaction_date}
                              className="w-full px-2 py-1 rounded border border-slate-200 text-xs" />
                          </div>
                          <div>
                            <label className="text-[10px] font-semibold text-slate-600">Amount / مبلغ</label>
                            <input type="number" id="tx-in" defaultValue={txn.cash_in}
                              className="w-full px-2 py-1 rounded border border-slate-200 text-xs" />
                          </div>
                          <div className="col-span-2">
                            <label className="text-[10px] font-semibold text-slate-600">Description / الوصف</label>
                            <input id="tx-desc" defaultValue={txn.description}
                              className="w-full px-2 py-1 rounded border border-slate-200 text-xs" />
                          </div>
                          <div className="col-span-2">
                            <label className="text-[10px] font-semibold text-slate-600">Order# / رقم الأمر</label>
                            <input id="tx-order" defaultValue={txn.order_number}
                              className="w-full px-2 py-1 rounded border border-slate-200 text-xs" />
                          </div>
                          <div>
                            <label className="text-[10px] font-semibold text-slate-600">Category / التصنيف</label>
                            <select id="tx-cat" defaultValue={txn.category || ''} onChange={e => {
                              if (e.target.value === '__custom') {
                                const custom = prompt('New category name / اسم التصنيف الجديد:');
                                if (custom) {
                                  const opt = document.createElement('option');
                                  opt.value = custom.trim(); opt.text = '✨ ' + custom.trim();
                                  e.target.insertBefore(opt, e.target.querySelector('[value="__custom"]'));
                                  e.target.value = custom.trim();
                                } else e.target.value = txn.category || '';
                              }
                            }} className="w-full px-2 py-1 rounded border border-slate-200 text-xs bg-amber-50">
                              <option value="">None</option>
                              {Object.entries(EXPENSE_CATS).map(([ar, en]) => <option key={ar} value={ar}>{en} / {ar}</option>)}
                              {customCats.map(c => <option key={c} value={c}>{c}</option>)}
                              <option value="__custom">+ New Category</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] font-semibold text-slate-600">Subcategory / فرعي</label>
                            <select id="tx-subcat" defaultValue={txn.subcategory || ''} onChange={e => {
                              if (e.target.value === '__custom') {
                                const custom = prompt('New subcategory / تصنيف فرعي جديد:');
                                if (custom) {
                                  const opt = document.createElement('option');
                                  opt.value = custom.trim(); opt.text = '✨ ' + custom.trim();
                                  e.target.insertBefore(opt, e.target.querySelector('[value="__custom"]'));
                                  e.target.value = custom.trim();
                                } else e.target.value = txn.subcategory || '';
                              }
                            }} className="w-full px-2 py-1 rounded border border-slate-200 text-xs bg-orange-50">
                              <option value="">None</option>
                              {uniqueSubcats.map(s => <option key={s} value={s}>{s}</option>)}
                              <option value="__custom">+ New Subcategory</option>
                            </select>
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
                <h4 className="text-sm font-bold text-purple-800 mb-1">Search Treasury to Link / بحث للربط</h4>
                <input value={linkSearch} onChange={e => setLinkSearch(e.target.value)}
                  placeholder="Search name, date, amount / بحث"
                  className="w-full px-3 py-2 rounded-lg border border-purple-200 text-sm mb-2" autoFocus />
                {linkSearch.length >= 2 && (
                  <div className="max-h-[200px] overflow-auto rounded border border-purple-200 bg-white">
                    {treasury
                      .filter(t => (!t.order_number || t.order_number === '') && Number(t.cash_in) > 0)
                      .filter(t => {
                        const words = linkSearch.split(/\s+/).filter(w => w.length > 0);
                        const haystack = [t.description || '', t.transaction_date || '', String(t.cash_in || 0)].join(' ');
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
                            className="px-3 py-1.5 bg-purple-600 text-white rounded text-xs font-semibold hover:bg-purple-700 ml-2">
                            🔗 Link
                          </button>
                        </div>
                      ))}
                    {treasury.filter(t => (!t.order_number || t.order_number === '') && Number(t.cash_in) > 0).filter(t => {
                      const words = linkSearch.split(/\s+/).filter(w => w.length > 0);
                      const haystack = [t.description || '', t.transaction_date || '', String(t.cash_in || 0)].join(' ');
                      return words.every(w => haystack.includes(w));
                    }).length === 0 && (
                      <div className="px-3 py-3 text-xs text-slate-400 text-center">No unlinked cash-in transactions found</div>
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
              <PaymentForm
                invoice={selectedInvoice}
                categories={Object.entries(EXPENSE_CATS)}
                existingSubcats={uniqueSubcats}
                onSave={handleAddPayment}
                onCancel={() => { setShowAddPayment(false); setFormData({}); }}
                formData={formData}
                setFormData={setFormData}
              />
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
                            <td className="px-2 py-1.5"><input type="date" id="tx-date" defaultValue={txn.transaction_date}
                              className="w-full text-xs border rounded px-1 py-1" /></td>
                            <td className="px-2 py-1.5"><input id="tx-order" defaultValue={txn.order_number || ''}
                              className="w-16 text-xs border rounded px-1 py-1" /></td>
                            <td className="px-2 py-1.5">
                              <input id="tx-desc" defaultValue={txn.description}
                                className="w-full text-xs border rounded px-1 py-1 mb-1" style={{ direction: 'rtl' }} />
                              <select id="tx-cat" defaultValue={txn.category || ''} onChange={e => {
                                if (e.target.value === '__custom') {
                                  const custom = prompt('New category name / اسم التصنيف الجديد:');
                                  if (custom) { const opt = document.createElement('option'); opt.value = custom.trim(); opt.text = '✨ ' + custom.trim(); e.target.insertBefore(opt, e.target.querySelector('[value="__custom"]')); e.target.value = custom.trim(); }
                                  else e.target.value = txn.category || '';
                                }
                              }} className="w-full text-[10px] border rounded px-1 py-0.5 bg-amber-50">
                                <option value="">None</option>
                                {Object.entries(EXPENSE_CATS).map(([ar, en]) => <option key={ar} value={ar}>{en}</option>)}
                                {customCats.map(c => <option key={c} value={c}>{c}</option>)}
                                <option value="__custom">+ New Category</option>
                              </select>
                              <select id="tx-subcat" defaultValue={txn.subcategory || ''} onChange={e => {
                                if (e.target.value === '__custom') {
                                  const custom = prompt('New subcategory / تصنيف فرعي جديد:');
                                  if (custom) { const opt = document.createElement('option'); opt.value = custom.trim(); opt.text = '✨ ' + custom.trim(); e.target.insertBefore(opt, e.target.querySelector('[value="__custom"]')); e.target.value = custom.trim(); }
                                  else e.target.value = txn.subcategory || '';
                                }
                              }} className="w-full text-[10px] border rounded px-1 py-0.5 mt-1 bg-orange-50">
                                <option value="">No subcategory</option>
                                {uniqueSubcats.map(s => <option key={s} value={s}>{s}</option>)}
                                <option value="__custom">+ New Subcategory</option>
                              </select>
                            </td>
                            <td className="px-2 py-1.5"><input type="number" id="tx-in" defaultValue={txn.cash_in || 0}
                              className="w-20 text-xs border rounded px-1 py-1" /></td>
                            <td className="px-2 py-1.5"><input type="number" id="tx-out" defaultValue={txn.cash_out || 0}
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
                                {editSubTxnId === txn.id ? (
                                  <div className="space-y-1">
                                    <select value={editCatValue} onChange={e => {
                                      if (e.target.value === '__custom') {
                                        const custom = prompt('New category name / اسم التصنيف الجديد:');
                                        if (custom) setEditCatValue(custom.trim());
                                        else e.target.value = editCatValue;
                                      } else setEditCatValue(e.target.value);
                                    }} className="w-full text-[9px] border-2 border-blue-400 rounded px-1 py-0.5 bg-amber-50">
                                      <option value="">None</option>
                                      {editCatValue && !EXPENSE_CATS[editCatValue] && !customCats.includes(editCatValue) && editCatValue !== '__custom' && (
                                        <option value={editCatValue}>✨ {editCatValue}</option>
                                      )}
                                      {Object.entries(EXPENSE_CATS).map(([ar, en]) => <option key={ar} value={ar}>{en}</option>)}
                                      {customCats.map(c => <option key={c} value={c}>{c}</option>)}
                                      <option value="__custom">+ New Category</option>
                                    </select>
                                    <select value={editSubValue} onChange={e => {
                                      if (e.target.value === '__custom') {
                                        const custom = prompt('New subcategory / تصنيف فرعي جديد:');
                                        if (custom) setEditSubValue(custom.trim());
                                        else e.target.value = editSubValue;
                                      } else setEditSubValue(e.target.value);
                                    }} className="w-full text-[9px] border-2 border-blue-400 rounded px-1 py-0.5 bg-orange-50">
                                      <option value="">No subcategory</option>
                                      {editSubValue && !uniqueSubcats.includes(editSubValue) && editSubValue !== '__custom' && (
                                        <option value={editSubValue}>✨ {editSubValue}</option>
                                      )}
                                      {uniqueSubcats.map(s => <option key={s} value={s}>{s}</option>)}
                                      <option value="__custom">+ New Subcategory</option>
                                    </select>
                                    <div className="flex gap-1">
                                      <button onClick={async () => {
                                        try {
                                          const desc = (txn.description || '').trim();
                                          const updates = {};
                                          if (editCatValue !== (txn.category || '')) updates.category = editCatValue;
                                          if (editSubValue !== (txn.subcategory || '')) updates.subcategory = editSubValue;
                                          if (Object.keys(updates).length === 0) { setEditSubTxnId(null); return; }
                                          if (desc) {
                                            await supabase.from('treasury').update(updates).eq('description', desc);
                                            const existing = expenseRules.find(r => r.description_match === desc);
                                            const ruleUpdates = {};
                                            if (updates.category !== undefined) ruleUpdates.category = editCatValue;
                                            if (updates.subcategory !== undefined) ruleUpdates.subcategory = editSubValue;
                                            if (existing) { await dbUpdate('expense_rules', existing.id, ruleUpdates, user?.id); }
                                            else { await dbInsert('expense_rules', { description_match: desc, category: editCatValue || txn.category || '', subcategory: editSubValue || txn.subcategory || '', rule_type: Number(txn.cash_in || 0) > 0 ? 'income' : 'expense' }, user?.id); }
                                          } else {
                                            await dbUpdate('treasury', txn.id, updates, user?.id);
                                          }
                                          setEditSubTxnId(null); setEditSubValue(''); setEditCatValue('');
                                          setTimeout(() => loadAllData(), 800);
                                        } catch(err) { alert('Error: ' + err.message); }
                                      }} className="px-2 py-0.5 bg-blue-500 text-white rounded text-[9px] font-bold">Save</button>
                                      <button onClick={() => { setEditSubTxnId(null); setEditSubValue(''); setEditCatValue(''); }}
                                        className="px-2 py-0.5 border rounded text-[9px]">Cancel</button>
                                    </div>
                                  </div>
                                ) : (
                                  <div onClick={() => { setEditSubTxnId(txn.id); setEditCatValue(txn.category || ''); setEditSubValue(txn.subcategory || ''); }}
                                    className="cursor-pointer hover:bg-slate-100 rounded px-1 py-0.5">
                                    <div className="text-[9px] font-semibold text-amber-700">{EXPENSE_CATS[txn.category] || txn.category || <span className="text-slate-300 italic">+ category</span>}</div>
                                    <div className="text-[9px] text-orange-500">{txn.subcategory || <span className="text-slate-300 italic">+ subcategory</span>}</div>
                                  </div>
                                )}
                                <datalist id="subs-all">
                                  {uniqueSubcats.map(s => <option key={s} value={s}/>)}
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
          <Modal onClose={() => { setReconcileCheck(null); setReconcileDate(''); setReconcileMethod('check'); }} title="Reconcile Check / تسوية شيك">
            <div style={{ direction: 'rtl' }} className="text-lg font-bold mb-1">{reconcileCheck.customer_name}</div>
            <div className="text-sm mb-2">{fE(reconcileCheck.amount)} | {reconcileCheck.check_date}</div>
            {reconcileCheck.order_number && (
              <div className="text-xs text-blue-600 mb-3">Order #{reconcileCheck.order_number}</div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-600">Collection Date / تاريخ التحصيل</label>
                <input type="date" value={reconcileDate}
                  onChange={e => setReconcileDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600">Method / طريقة</label>
                <select value={reconcileMethod}
                  onChange={e => setReconcileMethod(e.target.value)}
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
                {formData.showNewCustomer ? (
                  <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-200 mt-1 space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold text-emerald-700">New Customer / عميل جديد</span>
                      <button onClick={() => setFormData({...formData, showNewCustomer: false})} className="text-xs text-slate-400">Cancel</button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input value={formData.newCustName || ''} onChange={e => setFormData({...formData, newCustName: e.target.value})}
                        placeholder="Name (English)" className="px-2 py-1.5 border rounded text-xs" />
                      <input value={formData.newCustNameAr || ''} onChange={e => setFormData({...formData, newCustNameAr: e.target.value})}
                        placeholder="الاسم بالعربي" className="px-2 py-1.5 border rounded text-xs" style={{direction:'rtl'}} />
                      <input value={formData.newCustPhone || ''} onChange={e => setFormData({...formData, newCustPhone: e.target.value})}
                        placeholder="Phone / هاتف" className="px-2 py-1.5 border rounded text-xs" />
                      <input value={formData.newCustEmail || ''} onChange={e => setFormData({...formData, newCustEmail: e.target.value})}
                        placeholder="Email / بريد" className="px-2 py-1.5 border rounded text-xs" />
                      <input value={formData.newCustAddress || ''} onChange={e => setFormData({...formData, newCustAddress: e.target.value})}
                        placeholder="Address / عنوان" className="col-span-2 px-2 py-1.5 border rounded text-xs" />
                    </div>
                    <button onClick={async () => {
                      if (!formData.newCustName && !formData.newCustNameAr) return;
                      try {
                        const { data: newCust, error } = await supabase.from('customers').insert({
                          name: formData.newCustName || formData.newCustNameAr || '',
                          name_ar: formData.newCustNameAr || '',
                          phone: formData.newCustPhone || '',
                          email: formData.newCustEmail || '',
                          address: formData.newCustAddress || '',
                          created_by: userProfile?.id,
                        }).select().single();
                        if (error) throw error;
                        // Refresh customers and select the new one
                        const { data: updatedCusts } = await supabase.from('customers').select('*').order('name');
                        if (updatedCusts) setCustomers(updatedCusts);
                        setFormData({...formData,
                          customerId: newCust.id,
                          customerName: newCust.name,
                          showNewCustomer: false,
                          newCustName: '', newCustNameAr: '', newCustPhone: '', newCustEmail: '', newCustAddress: ''
                        });
                      } catch(err) { alert('Error creating customer: ' + err.message); }
                    }} className="px-3 py-1.5 bg-emerald-500 text-white rounded text-xs font-bold w-full">
                      ✅ Create & Select
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2 mt-1">
                    <div className="flex-1 relative">
                      <input value={formData.custSearch !== undefined ? formData.custSearch : (formData.customerName || '')}
                        onChange={e => setFormData({...formData, custSearch: e.target.value, showCustDropdown: true})}
                        onFocus={() => setFormData({...formData, showCustDropdown: true})}
                        placeholder="Search or select customer..."
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                      {formData.showCustDropdown && (
                        <>
                        <div className="fixed inset-0 z-10" onClick={() => setFormData({...formData, showCustDropdown: false})} />
                        <div className="absolute z-20 top-full left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-lg max-h-[200px] overflow-auto mt-1">
                          {customers.filter(c => {
                            const sq = (formData.custSearch || '').toLowerCase();
                            if (!sq) return true;
                            return (c.name || '').toLowerCase().includes(sq) || (c.name_ar || '').includes(formData.custSearch || '') || (c.phone || '').includes(sq);
                          }).slice(0, 20).map(c => (
                            <div key={c.id} onClick={() => {
                              setFormData({...formData,
                                customerId: c.id,
                                customerName: c.name || c.name_ar,
                                custSearch: undefined,
                                showCustDropdown: false,
                                salesRep: formData.salesRep || c.assigned_rep || '',
                              });
                            }} className="px-3 py-2 text-xs cursor-pointer hover:bg-blue-50 border-b border-slate-50">
                              <span className="font-bold">{c.name}</span>
                              {c.name_ar && <span className="text-slate-400 ml-2" style={{direction:'rtl'}}>{c.name_ar}</span>}
                              {c.phone && <span className="text-blue-400 ml-2">{c.phone}</span>}
                            </div>
                          ))}
                          {customers.filter(c => {
                            const sq = (formData.custSearch || '').toLowerCase();
                            if (!sq) return true;
                            return (c.name || '').toLowerCase().includes(sq) || (c.name_ar || '').includes(formData.custSearch || '');
                          }).length === 0 && (
                            <div className="px-3 py-2 text-xs text-slate-400 italic">No customers found</div>
                          )}
                        </div>
                        </>
                      )}
                    </div>
                    {formData.customerName && (
                      <span className="self-center text-xs text-emerald-600 font-bold whitespace-nowrap">✓ {formData.customerName}</span>
                    )}
                    <button onClick={() => setFormData({...formData, showNewCustomer: true, showCustDropdown: false})}
                      className="px-3 py-2 bg-emerald-500 text-white rounded-lg text-xs font-bold whitespace-nowrap">+ New</button>
                  </div>
                )}
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
                        product_id: item.product_id || null,
                      }, user?.id);
                      // Auto-deduct from inventory if product linked
                      if (item.product_id) {
                        const prod = inventory.find(p => p.id === item.product_id);
                        if (prod) {
                          const newQty = Math.max(0, Number(prod.current_quantity || prod.roll_count || 0) - Number(item.inv_qty || 0));
                          await dbUpdate('inventory', prod.id, { current_quantity: newQty, stock_status: newQty <= 0 ? 'out_of_stock' : newQty < 5 ? 'low' : 'in_stock' }, user?.id);
                        }
                      }
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
                          <span className="font-bold">{inv.order_number}</span> — <span>{inv.customer_name_en || inv.customer_name}</span>
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
                  <select value={formData.category || ''} onChange={e => {
                    if (e.target.value === '__custom') {
                      const custom = prompt('Enter new category name / أدخل اسم التصنيف الجديد:');
                      if (custom) setFormData({ ...formData, category: custom.trim() });
                      else e.target.value = formData.category || '';
                    } else {
                      setFormData({ ...formData, category: e.target.value });
                    }
                  }} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-amber-50">
                    <option value="">Select category...</option>
                    {formData.category && !EXPENSE_CATS[formData.category] && !customCats.includes(formData.category) && formData.category !== '__custom' && (
                      <option value={formData.category}>✨ {formData.category}</option>
                    )}
                    {Object.entries(EXPENSE_CATS).map(([ar, en]) => (
                      <option key={ar} value={ar}>{en} / {ar}</option>
                    ))}
                    {customCats.map(c => <option key={c} value={c}>{c}</option>)}
                    <option value="__custom">+ Add New Category / إضافة تصنيف جديد</option>
                  </select>
                  {formData.category && !EXPENSE_CATS[formData.category] && !customCats.includes(formData.category) && (
                    <div className="text-[10px] text-emerald-600 font-semibold mt-1">✓ New category: "{formData.category}"</div>
                  )}
                  <select value={formData.subcategory || ''} onChange={e => {
                    if (e.target.value === '__custom') {
                      const custom = prompt('Enter new subcategory / أدخل تصنيف فرعي جديد:');
                      if (custom) setFormData({ ...formData, subcategory: custom.trim() });
                      else e.target.value = formData.subcategory || '';
                    } else {
                      setFormData({ ...formData, subcategory: e.target.value });
                    }
                  }} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm mt-1 bg-orange-50">
                    <option value="">Subcategory (optional)...</option>
                    {formData.subcategory && !uniqueSubcats.includes(formData.subcategory) && formData.subcategory !== '__custom' && (
                      <option value={formData.subcategory}>✨ {formData.subcategory}</option>
                    )}
                    {uniqueSubcats.map(s => <option key={s} value={s}>{s}</option>)}
                    <option value="__custom">+ Add New Subcategory / إضافة فرعي جديد</option>
                  </select>
                  {formData.subcategory && !uniqueSubcats.includes(formData.subcategory) && (
                    <div className="text-[10px] text-emerald-600 font-semibold mt-1">✓ New subcategory: "{formData.subcategory}"</div>
                  )}
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

        {/* ===== FLOATING REMINDER BANNER (all tabs) ===== */}
        {tab !== 'dashboard' && (() => {
          const todayStr = new Date().toISOString().substring(0, 10);
          const myActive = reminders.filter(r => {
            const isForMe = !r.target_users || r.target_users === 'all' || (r.target_users || '').includes(userProfile?.id);
            const isToday = r.reminder_date === todayStr;
            return isForMe && isToday;
          });
          if (myActive.length === 0) return null;
          return (
            <div className="mb-3 rounded-xl p-3 border-2 border-amber-400 cursor-pointer"
              onClick={() => { setTab('dashboard'); }}
              style={{ background: 'linear-gradient(135deg, #fef3c7, #fde68a)' }}>
              <div className="text-sm font-extrabold text-amber-900">
                📢 {myActive.length} active reminder{myActive.length > 1 ? 's' : ''} — {myActive[0].message.substring(0, 80)}{myActive[0].message.length > 80 ? '...' : ''}
                {myActive.length > 1 && <span className="text-amber-600 font-normal"> +{myActive.length - 1} more</span>}
                <span className="text-xs text-amber-500 font-normal ml-2">Tap to view →</span>
              </div>
            </div>
          );
        })()}

        {/* ==========================================
            DASHBOARD TAB
        ========================================== */}
        {tab === 'dashboard' && (
          <div>
            {/* ===== TEAM REMINDERS ===== */}
            {(() => {
              const todayStr = new Date().toISOString().substring(0, 10);
              const myReminders = reminders.filter(r => {
                const isForMe = !r.target_users || r.target_users === 'all' || (r.target_users || '').includes(userProfile?.id);
                return isForMe;
              });
              const activeReminders = myReminders.filter(r => r.reminder_date === todayStr || (!r.reminder_date && r.created_at && r.created_at.substring(0, 10) === todayStr));
              const archivedReminders = myReminders.filter(r => (r.reminder_date || r.created_at?.substring(0, 10)) < todayStr);
              const getUserName = (id) => (teamUsers || []).find(u => u.id === id)?.name || '';
              
              return (
                <div className="mb-4">
                  {/* Active reminders — prominent display */}
                  {activeReminders.length > 0 && (
                    <div className="space-y-2 mb-3">
                      {activeReminders.map(r => (
                        <div key={r.id} className="rounded-xl p-4 border-2 border-amber-400"
                          style={{ background: 'linear-gradient(135deg, #fef3c7, #fde68a)', boxShadow: '0 4px 15px rgba(245,158,11,0.2)' }}>
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <div className="text-base font-extrabold text-amber-900" style={{ fontSize: '16pt', lineHeight: '1.4' }}>
                                📢 {r.message}
                              </div>
                              <div className="flex gap-3 mt-2 text-[10px] text-amber-700">
                                <span>From: {getUserName(r.created_by) || 'Admin'}</span>
                                <span>{r.reminder_date || r.created_at?.substring(0, 10)}</span>
                                {r.target_users === 'all' ? <span className="font-bold">👥 All Team</span> : <span>👤 Targeted</span>}
                              </div>
                            </div>
                            {r.priority === 'urgent' && (
                              <span className="px-2 py-1 bg-red-500 text-white rounded-lg text-[10px] font-bold animate-pulse">URGENT</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {/* Admin/permitted create + archive link */}
                  <div className="flex justify-between items-center mb-2">
                    {(isAdmin || modulePerms?.['Post Reminders']) && (
                      <button onClick={() => setShowReminderForm(!showReminderForm)}
                        className="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-xs font-bold hover:bg-amber-600">
                        📢 {showReminderForm ? 'Close' : 'Post Reminder'}
                      </button>
                    )}
                    {archivedReminders.length > 0 && (
                      <button onClick={() => setShowReminderArchive(!showReminderArchive)}
                        className="text-[10px] text-slate-400 hover:text-blue-500 hover:underline">
                        📋 {showReminderArchive ? 'Hide' : 'View'} past reminders ({archivedReminders.length})
                      </button>
                    )}
                  </div>

                  {/* Create reminder form */}
                  {showReminderForm && (isAdmin || modulePerms?.['Post Reminders']) && (
                    <div className="bg-white rounded-xl p-4 border border-amber-200 mb-3">
                      <h4 className="text-sm font-bold mb-2">📢 Post Team Reminder</h4>
                      <textarea value={formData.reminderMsg || ''} onChange={e => setFormData({...formData, reminderMsg: e.target.value})}
                        placeholder="Type your reminder message..."
                        rows={3} className="w-full px-3 py-2 rounded-lg border text-sm mb-2" />
                      <div className="flex gap-2 flex-wrap items-center mb-3">
                        <div>
                          <label className="text-[9px] text-slate-500">Date</label>
                          <input type="date" value={formData.reminderDate || todayStr} onChange={e => setFormData({...formData, reminderDate: e.target.value})}
                            className="px-2 py-1.5 border rounded text-xs" />
                        </div>
                        <div>
                          <label className="text-[9px] text-slate-500">Priority</label>
                          <select value={formData.reminderPriority || 'normal'} onChange={e => setFormData({...formData, reminderPriority: e.target.value})}
                            className="px-2 py-1.5 border rounded text-xs">
                            <option value="normal">Normal</option>
                            <option value="urgent">🔴 Urgent</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-[9px] text-slate-500">Send To</label>
                          <select value={formData.reminderTarget || 'all'} onChange={e => setFormData({...formData, reminderTarget: e.target.value})}
                            className="px-2 py-1.5 border rounded text-xs">
                            <option value="all">👥 All Team</option>
                            {(teamUsers || []).map(u => <option key={u.id} value={u.id}>👤 {u.name}</option>)}
                          </select>
                        </div>
                      </div>
                      <button onClick={async () => {
                        if (!formData.reminderMsg?.trim()) { alert('Enter a message'); return; }
                        try {
                          await dbInsert('team_reminders', {
                            message: formData.reminderMsg.trim(),
                            reminder_date: formData.reminderDate || todayStr,
                            priority: formData.reminderPriority || 'normal',
                            target_users: formData.reminderTarget || 'all',
                            created_by: userProfile?.id,
                          }, userProfile?.id);
                          // Send email notification
                          try {
                            const targetIds = formData.reminderTarget === 'all'
                              ? (teamUsers || []).map(u => u.id)
                              : [formData.reminderTarget];
                            await fetch('/api/notify', {
                              method: 'POST', headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                type: 'reminder', recipientIds: targetIds,
                                subject: (formData.reminderPriority === 'urgent' ? '🔴 URGENT: ' : '📢 ') + formData.reminderMsg.trim().substring(0, 60),
                                triggeredBy: userProfile?.id,
                              })
                            });
                          } catch(e) {}
                          // Send WhatsApp to targeted users
                          try {
                            const targetUsers = formData.reminderTarget === 'all'
                              ? (teamUsers || [])
                              : (teamUsers || []).filter(u => u.id === formData.reminderTarget);
                            const whatsappMsg = (formData.reminderPriority === 'urgent' ? '🔴 URGENT REMINDER\n\n' : '📢 Team Reminder\n\n')
                              + formData.reminderMsg.trim()
                              + '\n\n— ' + (userProfile?.name || 'Admin') + ' via KTC Hub';
                            for (const u of targetUsers) {
                              const phone = u.whatsapp_number || u.phone;
                              if (phone) {
                                await fetch('/api/whatsapp/send', {
                                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ to: phone, body: whatsappMsg })
                                }).catch(() => {});
                              }
                            }
                          } catch(e) {}
                          setFormData({...formData, reminderMsg: '', reminderPriority: 'normal'});
                          setShowReminderForm(false);
                          await loadAllData();
                        } catch(err) { alert('Error: ' + err.message); }
                      }} className="px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-bold w-full">
                        📢 Post Reminder
                      </button>
                    </div>
                  )}

                  {/* Archive */}
                  {showReminderArchive && archivedReminders.length > 0 && (
                    <div className="bg-white rounded-xl p-3 mb-3 border border-slate-200 max-h-[250px] overflow-auto">
                      <h4 className="text-xs font-bold text-slate-500 mb-2">📋 Past Reminders</h4>
                      {archivedReminders.slice(0, 30).map(r => (
                        <div key={r.id} className="flex justify-between py-1.5 border-b border-slate-50 text-xs">
                          <div className="flex-1">
                            <span className="font-semibold">{r.message}</span>
                            {r.priority === 'urgent' && <span className="ml-1 text-red-500 text-[9px] font-bold">URGENT</span>}
                          </div>
                          <div className="text-[10px] text-slate-400 ml-2 whitespace-nowrap">
                            {r.reminder_date || r.created_at?.substring(0, 10)} · {getUserName(r.created_by)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            <div className="flex justify-between flex-wrap gap-2 mb-4">
              <h2 className="text-xl font-extrabold">Dashboard / لوحة التحكم</h2>
              {isAdmin && <ModeBar />}
            </div>

            {/* ===== ANNOUNCEMENTS / URGENT MESSAGES ===== */}
            {isAdmin && (
              <button onClick={() => setShowAddAnnouncement(true)}
                className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-bold mb-3 shadow-lg">📢 Send Message to Team / إرسال رسالة للفريق</button>
            )}
            {showAddAnnouncement && (
              <div className="bg-red-50 rounded-xl p-5 mb-4 border-2 border-red-400 shadow-lg">
                <h4 className="text-lg font-extrabold text-red-800 mb-3">📢 New Message / رسالة جديدة</h4>
                <input id="ann-title" placeholder="Subject / الموضوع *" className="w-full px-4 py-3 rounded-lg border-2 border-red-200 text-base font-bold mb-3" />
                <textarea id="ann-body" placeholder="Message details / تفاصيل الرسالة" rows={4} className="w-full px-4 py-3 rounded-lg border-2 border-red-200 text-sm mb-3" />
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="text-xs font-bold text-red-800 block mb-1">Priority / الأهمية</label>
                    <select id="ann-priority" className="w-full px-3 py-2 rounded-lg border text-sm">
                      <option value="urgent">🚨 URGENT / عاجل</option>
                      <option value="warning">⚠️ Important / مهم</option>
                      <option value="info">ℹ️ Info / معلومة</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-red-800 block mb-1">Send To / إرسال إلى</label>
                    <select id="ann-target" className="w-full px-3 py-2 rounded-lg border text-sm">
                      <option value="all">👥 Everyone / الجميع</option>
                      {teamUsers.map(u => <option key={u.id} value={u.id}>👤 {u.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="flex gap-3 items-center mb-3">
                  <label className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" id="ann-pin" defaultChecked className="w-4 h-4" /> 📌 Pin to top / تثبيت</label>
                  <label className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" id="ann-email" defaultChecked className="w-4 h-4" /> 📧 Email notify / إشعار بريد</label>
                  <label className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" id="ann-whatsapp" className="w-4 h-4" /> 💬 WhatsApp</label>
                </div>
                <div className="flex gap-2">
                  <button onClick={async () => {
                    var title = document.getElementById('ann-title').value;
                    var body = document.getElementById('ann-body').value;
                    var priority = document.getElementById('ann-priority').value;
                    var pinned = document.getElementById('ann-pin').checked;
                    var sendEmail = document.getElementById('ann-email').checked;
                    var sendWhatsapp = document.getElementById('ann-whatsapp').checked;
                    var target = document.getElementById('ann-target').value;
                    if (!title) { alert('Subject is required / الموضوع مطلوب'); return; }
                    try {
                      await dbInsert('announcements', {
                        title, body, priority, pinned,
                        target_user: target === 'all' ? null : target,
                        posted_by: userProfile?.id || user?.id,
                        active: true, send_email: sendEmail, send_whatsapp: sendWhatsapp
                      }, user?.id);
                      if (sendEmail) {
                        try {
                          var recipients = target === 'all' ? teamUsers : teamUsers.filter(u => u.id === target);
                          for (var r of recipients) {
                            if (r.email) {
                              await fetch('/api/notify', {
                                method: 'POST', headers: {'Content-Type':'application/json'},
                                body: JSON.stringify({ to: r.email, subject: (priority === 'urgent' ? '🚨 URGENT: ' : priority === 'warning' ? '⚠️ ':'') + title, html: '<div style="font-family:sans-serif;padding:20px;'+(priority==='urgent'?'background:#fef2f2;border:3px solid #ef4444;':priority==='warning'?'background:#fffbeb;border:2px solid #f59e0b;':'background:#eff6ff;border:1px solid #3b82f6;')+'border-radius:12px;"><h2 style="margin:0 0 10px;font-size:18px;">'+(priority==='urgent'?'🚨':'⚠️')+' '+title+'</h2>'+(body?'<p style="font-size:14px;color:#333;">'+body.replace(/\n/g,'<br/>')+'</p>':'')+'<hr style="margin:15px 0;border-color:#eee;"/><p style="font-size:11px;color:#999;">From KTC Hub — '+(userProfile?.name||'Admin')+'</p></div>' })
                              });
                            }
                          }
                        } catch(emailErr) { console.error('Email send error:', emailErr); }
                      }
                      setShowAddAnnouncement(false);
                      await loadAllData();
                    } catch(err) { alert('Error: ' + err.message); }
                  }} className="px-6 py-3 bg-red-600 text-white rounded-lg text-sm font-extrabold shadow-lg">📢 SEND NOW / أرسل الآن</button>
                  <button onClick={() => setShowAddAnnouncement(false)} className="px-4 py-3 border-2 border-slate-300 rounded-lg text-sm font-bold">Cancel</button>
                </div>
              </div>
            )}
            {/* Active Announcements — BIG and highlighted */}
            {(() => {
              var myId = userProfile?.id;
              var today = new Date().toISOString().substring(0, 10);
              var active = announcements.filter(a => a.active !== false && (!a.target_user || a.target_user === myId));
              var todayMsgs = active.filter(a => (a.created_at || '').substring(0, 10) === today);
              var olderMsgs = active.filter(a => (a.created_at || '').substring(0, 10) !== today);
              var pinnedMsgs = active.filter(a => a.pinned);
              var showMsgs = [...pinnedMsgs, ...todayMsgs.filter(a => !a.pinned)].filter((a, i, arr) => arr.findIndex(x => x.id === a.id) === i);
              if (showMsgs.length === 0 && olderMsgs.length === 0) return null;
              return (<div className="mb-4">
                {showMsgs.length > 0 && showMsgs.map(a => {
                  var styles = a.priority === 'urgent'
                    ? { border: '3px solid #ef4444', shadow: '0 4px 20px rgba(239,68,68,0.25)' }
                    : a.priority === 'warning'
                    ? { border: '2px solid #f59e0b', shadow: '0 4px 15px rgba(245,158,11,0.2)' }
                    : { border: '2px solid #3b82f6', shadow: '0 4px 15px rgba(59,130,246,0.15)' };
                  var icon = a.priority === 'urgent' ? '🚨' : a.priority === 'warning' ? '⚠️' : 'ℹ️';
                  var poster = teamUsers.find(u => u.id === a.posted_by);
                  var isTargeted = a.target_user === myId;
                  return (
                    <div key={a.id} className="rounded-2xl p-5 mb-3" style={{ background: a.priority === 'urgent' ? 'linear-gradient(135deg,#fef2f2,#fee2e2)' : a.priority === 'warning' ? 'linear-gradient(135deg,#fffbeb,#fef3c7)' : 'linear-gradient(135deg,#eff6ff,#dbeafe)', border: styles.border, boxShadow: styles.shadow }}>
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div style={{ fontSize: '1.1rem', fontWeight: 900, lineHeight: 1.3, color: a.priority === 'urgent' ? '#dc2626' : a.priority === 'warning' ? '#b45309' : '#1d4ed8' }}>
                            {icon} {a.pinned && '📌 '}{isTargeted && '👤 '}{a.title}
                          </div>
                          {a.body && <div style={{ fontSize: '0.95rem', marginTop: '0.5rem', lineHeight: 1.6, color: '#1e293b', whiteSpace: 'pre-wrap' }}>{a.body}</div>}
                          <div style={{ fontSize: '0.7rem', marginTop: '0.5rem', color: '#94a3b8' }}>
                            {poster ? poster.name : 'Admin'} • {new Date(a.created_at).toLocaleDateString()} {new Date(a.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}
                            {isTargeted && <span style={{ color: '#7c3aed', fontWeight: 700, marginLeft: 8 }}>📩 Sent to you directly</span>}
                          </div>
                        </div>
                        {isAdmin && (
                          <div className="flex flex-col gap-1 ml-3">
                            <button onClick={async () => { await dbUpdate('announcements', a.id, { active: false }, user?.id); await loadAllData(); }}
                              style={{ fontSize: '0.65rem', color: '#ef4444', cursor: 'pointer', background: 'rgba(239,68,68,0.1)', padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.3)' }}>Archive ✕</button>
                            <button onClick={async () => { await dbUpdate('announcements', a.id, { pinned: !a.pinned }, user?.id); await loadAllData(); }}
                              style={{ fontSize: '0.65rem', color: '#6b7280', cursor: 'pointer', background: 'rgba(0,0,0,0.05)', padding: '4px 8px', borderRadius: 6 }}>{a.pinned ? 'Unpin' : '📌 Pin'}</button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {olderMsgs.length > 0 && !hideSections.archivedMsgs && (
                  <button onClick={() => setHideSections({...hideSections, archivedMsgs: true})}
                    style={{ fontSize: '0.75rem', color: '#6b7280', cursor: 'pointer', background: 'rgba(0,0,0,0.03)', padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.08)', display: 'block', width: '100%', textAlign: 'center' }}>
                    📂 View {olderMsgs.length} older message{olderMsgs.length > 1 ? 's' : ''} / عرض الرسائل السابقة
                  </button>
                )}
                {hideSections.archivedMsgs && olderMsgs.length > 0 && (
                  <div className="mt-2">
                    <div className="flex justify-between items-center mb-2">
                      <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#64748b' }}>📂 Archived Messages</span>
                      <button onClick={() => setHideSections({...hideSections, archivedMsgs: false})}
                        style={{ fontSize: '0.65rem', color: '#94a3b8', cursor: 'pointer' }}>Hide ▲</button>
                    </div>
                    <div className="space-y-2 max-h-[300px] overflow-auto">
                      {olderMsgs.map(a => {
                        var icon = a.priority === 'urgent' ? '🚨' : a.priority === 'warning' ? '⚠️' : 'ℹ️';
                        var poster = teamUsers.find(u => u.id === a.posted_by);
                        return (
                          <div key={a.id} style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(0,0,0,0.02)', border: '1px solid rgba(0,0,0,0.06)' }}>
                            <div style={{ fontSize: '0.85rem', fontWeight: 700 }}>{icon} {a.title}</div>
                            {a.body && <div style={{ fontSize: '0.75rem', color: '#475569', marginTop: 4 }}>{a.body}</div>}
                            <div style={{ fontSize: '0.6rem', color: '#94a3b8', marginTop: 4 }}>
                              {poster ? poster.name : 'Admin'} • {new Date(a.created_at).toLocaleDateString()}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>);
            })()}

            {/* ===== FINANCIAL DASHBOARD (shown first for users with access) ===== */}
            {(isAdmin || modulePerms['Sales'] || modulePerms['Treasury']) && (<>
            <div className="bg-blue-100 rounded-lg px-3 py-2 mb-3 flex justify-between items-center cursor-pointer" onClick={() => setHideSections({...hideSections, invoices: !hideSections.invoices})}>
              <span className="text-sm font-bold text-blue-800">📋 INVOICES / فواتير العملاء</span>
              <span className="text-xs text-blue-600">{hideSections.invoices ? '👁️ Show' : '🙈 Hide'}</span>
            </div>
            {!hideSections.invoices && <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
              <Card title="Invoiced" titleAr="الفواتير" value={fE(totalInvoiced)} sub={`${filteredInvoices.length} inv`} color="#0ea5e9" onClick={() => setDrillType('invoiced')} />
              <Card title="Collected" titleAr="المحصّل" value={fE(totalCollected)} color="#10b981" onClick={() => setDrillType('collected')} />
              <Card title="Outstanding" titleAr="المتبقّي" value={fE(totalOutstanding)} sub={`${filteredInvoices.filter(s => s.outstanding > 0).length} open`} color="#ef4444" onClick={() => setDrillType('outstanding')} />
              <Card title="Debt" titleAr="المديونية" value={fE(totalDebt)} sub={`${debts.length} debtors`} color="#dc2626" onClick={() => navigate('debts')} />
            </div>}

            <div className="bg-emerald-100 rounded-lg px-3 py-2 mb-3 flex justify-between items-center cursor-pointer" onClick={() => setHideSections({...hideSections, cash: !hideSections.cash})}>
              <div>
                <span className="text-sm font-bold text-emerald-800">🏦 CASH REGISTER / الخزنة</span>
                <span className="text-xs text-emerald-600 ml-2">(Loaded: {treasury.length} rows, Filtered: {filteredTreasury.length})</span>
              </div>
              <span className="text-xs text-emerald-600">{hideSections.cash ? '👁️ Show' : '🙈 Hide'}</span>
            </div>
            {!hideSections.cash && <><div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
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
                              <button onClick={() => { setReconcileCheck(c); setReconcileDate(''); setReconcileMethod('check'); }}
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
            </>}
            </>)}

            {/* ===== USD DOLLAR LEDGER ===== */}
            {(isAdmin || modulePerms['Treasury']) && (() => {
              const usdIn = filteredTreasury.reduce((a, t) => a + Number(t.usd_in || 0), 0);
              const usdOut = filteredTreasury.reduce((a, t) => a + Number(t.usd_out || 0), 0);
              const usdNet = usdIn - usdOut;
              const usdTxns = filteredTreasury.filter(t => Number(t.usd_in || 0) > 0 || Number(t.usd_out || 0) > 0);
              if (usdTxns.length === 0) return null;
              return (
                <div className="mt-6">
                  <div className="bg-amber-100 rounded-lg px-3 py-2 mb-3 flex justify-between items-center cursor-pointer" onClick={() => setHideSections({...hideSections, usd: !hideSections.usd})}>
                    <span className="text-sm font-bold text-amber-800">💵 USD DOLLAR LEDGER / دفتر الدولار</span>
                    <span className="text-xs text-amber-600">{hideSections.usd ? '👁️ Show' : '🙈 Hide'}</span>
                  </div>
                  {!hideSections.usd && (<>
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#10b981'}}>
                      <div className="text-[10px] text-slate-500">USD In / وارد دولار</div>
                      <div className="text-lg font-extrabold text-emerald-600">${usdIn.toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:0})}</div>
                    </div>
                    <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#ef4444'}}>
                      <div className="text-[10px] text-slate-500">USD Out / صادر دولار</div>
                      <div className="text-lg font-extrabold text-red-500">${usdOut.toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:0})}</div>
                    </div>
                    <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:usdNet >= 0 ? '#10b981' : '#ef4444'}}>
                      <div className="text-[10px] text-slate-500">USD Net / صافي دولار</div>
                      <div className={'text-lg font-extrabold ' + (usdNet >= 0 ? 'text-emerald-600' : 'text-red-500')}>${usdNet.toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:0})}</div>
                    </div>
                  </div>
                  <div className="bg-white rounded-xl p-4 mb-4">
                    <h4 className="text-sm font-bold mb-2">USD Transactions ({usdTxns.length})</h4>
                    <div className="overflow-auto max-h-[300px] rounded-lg border border-slate-200">
                      <table className="w-full border-collapse text-xs">
                        <thead className="sticky top-0"><tr className="bg-slate-50">
                          <th className="px-2 py-2 text-[10px] text-left">Date</th>
                          <th className="px-2 py-2 text-[10px] text-left">Order</th>
                          <th className="px-2 py-2 text-[10px] text-left" style={{direction:'rtl'}}>Description</th>
                          <th className="px-2 py-2 text-[10px] text-right">USD In</th>
                          <th className="px-2 py-2 text-[10px] text-right">USD Out</th>
                        </tr></thead>
                        <tbody>
                          {usdTxns.sort((a,b) => (b.transaction_date||'').localeCompare(a.transaction_date||'')).map(t => (
                            <tr key={t.id} className="border-b border-slate-50">
                              <td className="px-2 py-1.5">{t.transaction_date}</td>
                              <td className="px-2 py-1.5 font-semibold text-blue-600">{t.order_number || '—'}</td>
                              <td className="px-2 py-1.5" style={{direction:'rtl'}}>{t.description}</td>
                              <td className="px-2 py-1.5 text-right font-bold text-emerald-600">{Number(t.usd_in) > 0 ? '$' + Number(t.usd_in).toLocaleString() : ''}</td>
                              <td className="px-2 py-1.5 text-right font-bold text-red-500">{Number(t.usd_out) > 0 ? '$' + Number(t.usd_out).toLocaleString() : ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  </>)}
                </div>
              );
            })()}

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
                <select value={customerFilter} onChange={e => setCustomerFilter(e.target.value)}
                  className="px-2 py-1 rounded-lg border border-slate-200 text-xs max-w-[180px]">
                  <option value="">All Customers / كل العملاء</option>
                  {[...new Set(invoices.map(i => i.customer_name_en || i.customer_name).filter(Boolean))].sort().map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
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
              const divisionInvoices = {};
              filteredInvoices.forEach(inv => {
                const cust = customers.find(c => c.id === inv.customer_id || c.name === inv.customer_name);
                const div = inv.division || cust?.group_name || 'Unassigned / غير مصنف';
                if (!divisionData[div]) { divisionData[div] = { sales: 0, collected: 0, outstanding: 0, count: 0 }; divisionInvoices[div] = []; }
                divisionData[div].sales += Number(inv.total_amount || 0);
                divisionData[div].collected += Number(inv.total_collected || 0);
                divisionData[div].outstanding += Number(inv.outstanding || 0);
                divisionData[div].count++;
                divisionInvoices[div].push(inv);
              });
              const sorted = Object.entries(divisionData).sort((a, b) => b[1].sales - a[1].sales);
              if (sorted.length <= 1 && !divisionDrill) return null;
              return (
                <div className="bg-white rounded-xl p-4 mb-3">
                  <h3 className="text-sm font-bold mb-2">Sales by Division / المبيعات حسب القسم</h3>
                  {!divisionDrill ? (
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
                            <tr key={div} className="border-b border-slate-50 cursor-pointer hover:bg-blue-50" onClick={() => setDivisionDrill(div)}>
                              <td className="px-2 py-1.5 font-semibold">
                                <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{background: COLORS[i % COLORS.length]}}></span>
                                {div} <span className="text-blue-400">→</span>
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
                  ) : (
                    <div>
                      <button onClick={() => setDivisionDrill(null)} className="text-xs text-blue-600 font-bold mb-2 hover:underline">← Back to all divisions</button>
                      <div className="text-sm font-bold mb-2">{divisionDrill} — {divisionData[divisionDrill]?.count || 0} orders</div>
                      <div className="grid grid-cols-3 gap-2 mb-3">
                        <div className="bg-blue-50 rounded-lg p-2 text-center">
                          <div className="text-[9px] text-blue-600 font-bold">Sales</div>
                          <div className="text-sm font-extrabold text-blue-700">{fE(divisionData[divisionDrill]?.sales || 0)}</div>
                        </div>
                        <div className="bg-emerald-50 rounded-lg p-2 text-center">
                          <div className="text-[9px] text-emerald-600 font-bold">Collected</div>
                          <div className="text-sm font-extrabold text-emerald-700">{fE(divisionData[divisionDrill]?.collected || 0)}</div>
                        </div>
                        <div className="bg-red-50 rounded-lg p-2 text-center">
                          <div className="text-[9px] text-red-500 font-bold">Outstanding</div>
                          <div className="text-sm font-extrabold text-red-600">{fE(divisionData[divisionDrill]?.outstanding || 0)}</div>
                        </div>
                      </div>
                      <div className="overflow-auto max-h-[400px] rounded-lg border border-slate-200">
                        <table className="w-full border-collapse text-xs">
                          <thead className="sticky top-0"><tr className="bg-slate-50">
                            <th className="px-2 py-1.5 text-left">Order#</th>
                            <th className="px-2 py-1.5 text-left">Date</th>
                            <th className="px-2 py-1.5" style={{direction:'rtl'}}>Customer</th>
                            <th className="px-2 py-1.5 text-right">Amount</th>
                            <th className="px-2 py-1.5 text-right">Collected</th>
                            <th className="px-2 py-1.5 text-right">Outstanding</th>
                          </tr></thead>
                          <tbody>
                            {(divisionInvoices[divisionDrill] || []).sort((a,b) => (b.invoice_date||'').localeCompare(a.invoice_date||'')).map(inv => (
                              <tr key={inv.id} className="border-b border-slate-50 cursor-pointer hover:bg-blue-50" onClick={() => { setSelectedInvoice(inv); setDivisionDrill(null); }}>
                                <td className="px-2 py-1.5 font-bold text-blue-600">{inv.order_number}</td>
                                <td className="px-2 py-1.5">{inv.invoice_date}</td>
                                <td className="px-2 py-1.5" style={{direction:'rtl'}}>{inv.customer_name}</td>
                                <td className="px-2 py-1.5 text-right font-bold">{fE(inv.total_amount)}</td>
                                <td className="px-2 py-1.5 text-right text-emerald-600">{fE(inv.total_collected)}</td>
                                <td className="px-2 py-1.5 text-right text-red-500">{Number(inv.outstanding) > 0 ? fE(inv.outstanding) : '✓'}</td>
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
                {!formData.mergeMode ? (
                  <button onClick={() => setFormData({...formData, mergeMode: true, mergeTargets: []})}
                    className="px-3 py-1.5 bg-purple-500 text-white rounded-lg text-xs font-bold">🔀 Merge</button>
                ) : (
                  <button onClick={() => setFormData({...formData, mergeMode: false, mergeTargets: []})}
                    className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs">Cancel Merge</button>
                )}
              </div>
            </div>
            {/* Merge bar */}
            {formData.mergeMode && (formData.mergeTargets || []).length >= 2 && (
              <div className="bg-purple-50 rounded-xl p-4 mb-3 border border-purple-200">
                <div className="text-xs font-bold text-purple-800 mb-2">Merge {(formData.mergeTargets || []).length} customers into one:</div>
                <div className="flex flex-wrap gap-1 mb-2">
                  {(formData.mergeTargets || []).map(name => (
                    <span key={name} className="px-2 py-0.5 bg-purple-100 rounded text-[10px] font-semibold">
                      {name}
                      <button onClick={() => setFormData({...formData, mergeTargets: (formData.mergeTargets || []).filter(t => t !== name)})}
                        className="ml-1 text-red-500">✕</button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2 items-center">
                  <input id="merge-cust-name" defaultValue={(formData.mergeTargets || [])[0] || ''} placeholder="Final customer name..."
                    className="flex-1 px-3 py-2 rounded border text-sm" style={{direction:'rtl'}} />
                  <button onClick={async () => {
                    const finalName = document.getElementById('merge-cust-name')?.value?.trim();
                    if (!finalName) return;
                    const targets = formData.mergeTargets || [];
                    if (!confirm('Merge ' + targets.length + ' customers into:\n\n"' + finalName + '"\n\nThis will update ALL invoices, checks, and treasury entries. Continue?')) return;
                    try {
                      // Find or create the target customer record
                      let targetCust = customers.find(c => c.name === finalName || c.name_ar === finalName);
                      if (!targetCust) {
                        const { data } = await supabase.from('customers').insert({ name: finalName, created_by: userProfile?.id }).select().single();
                        targetCust = data;
                      }
                      for (const name of targets) {
                        if (name === finalName) continue;
                        // Update invoices
                        await supabase.from('invoices').update({ customer_name: finalName, customer_id: targetCust?.id || null }).eq('customer_name', name);
                        // Update checks
                        await supabase.from('checks').update({ customer_name: finalName }).eq('customer_name', name);
                        // Update treasury descriptions that reference this customer
                        // Delete the old customer record
                        const oldCust = customers.find(c => c.name === name || c.name_ar === name);
                        if (oldCust && oldCust.id !== targetCust?.id) {
                          // Move any CRM data (notes, contacts) to target
                          await supabase.from('customers').delete().eq('id', oldCust.id);
                        }
                      }
                      alert('Merged ' + targets.length + ' customers into "' + finalName + '"');
                      setFormData({...formData, mergeMode: false, mergeTargets: []});
                      await loadAllData();
                    } catch(err) { alert('Error: ' + err.message); }
                  }} className="px-4 py-2 bg-purple-600 text-white rounded-lg text-xs font-bold">
                    ✅ Merge All
                  </button>
                </div>
              </div>
            )}
            {formData.mergeMode && (formData.mergeTargets || []).length < 2 && (
              <div className="bg-purple-50 rounded-lg p-3 mb-3 text-xs text-purple-600 font-semibold text-center">
                Select 2 or more customers to merge / اختر ٢ أو أكثر للدمج
              </div>
            )}
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
                  const isSelected = (formData.mergeTargets || []).includes(c.name);
                  return (
                  <div key={c.name} onClick={() => {
                    if (formData.mergeMode) {
                      const targets = formData.mergeTargets || [];
                      if (isSelected) setFormData({...formData, mergeTargets: targets.filter(t => t !== c.name)});
                      else setFormData({...formData, mergeTargets: [...targets, c.name]});
                    } else {
                      setSelectedCustomer(c.name);
                    }
                  }}
                    className={'bg-white rounded-lg p-3 cursor-pointer border transition hover:shadow-md ' + (isSelected ? 'border-purple-400 bg-purple-50 ring-2 ring-purple-300' : 'border-slate-200')}>
                    {formData.mergeMode && (
                      <div className="flex justify-end mb-1">
                        <div className={'w-5 h-5 rounded border-2 flex items-center justify-center text-[10px] ' + (isSelected ? 'bg-purple-500 border-purple-500 text-white' : 'border-slate-300')}>
                          {isSelected && '✓'}
                        </div>
                      </div>
                    )}
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
            {/* Advanced Search */}
            <div className="mb-3">
              <button onClick={() => setTSearch(prev => ({...prev, show: !prev.show}))}
                className="text-xs font-bold text-blue-600 hover:underline mb-2">
                {tSearch.show ? '▼ Hide Advanced Search' : '▶ Advanced Search / بحث متقدم'}
              </button>
              {tSearch.show && (() => {
                const allCats = [...new Set(treasury.map(t => t.category).filter(Boolean))].sort();
                const allSubcats = [...new Set(treasury.map(t => t.subcategory).filter(Boolean))].sort();
                // Compute filtered results
                const searchResults = treasury.filter(t => {
                  if (tSearch.type === 'income' && !(Number(t.cash_in) > 0)) return false;
                  if (tSearch.type === 'expense' && !(Number(t.cash_out) > 0)) return false;
                  if (tSearch.cat && t.category !== tSearch.cat) return false;
                  if (tSearch.subcat && !(t.subcategory || '').toLowerCase().includes(tSearch.subcat.toLowerCase())) return false;
                  if (tSearch.desc && !(t.description || '').includes(tSearch.desc) && !(t.description_en || '').toLowerCase().includes(tSearch.desc.toLowerCase())) return false;
                  if (tSearch.dateFrom && (t.transaction_date || '') < tSearch.dateFrom) return false;
                  if (tSearch.dateTo && (t.transaction_date || '') > tSearch.dateTo) return false;
                  if (tSearch.inboundRef && !(t.inbound_ref || '').toLowerCase().includes(tSearch.inboundRef.toLowerCase())) return false;
                  return true;
                });
                const srIn = searchResults.reduce((a, t) => a + Number(t.cash_in || 0), 0);
                const srOut = searchResults.reduce((a, t) => a + Number(t.cash_out || 0), 0);
                // Group by category
                const byCat = {};
                searchResults.forEach(t => {
                  const c = (EXPENSE_CATS[t.category] || t.category || 'Uncategorized');
                  if (!byCat[c]) byCat[c] = { in: 0, out: 0, count: 0, subs: {} };
                  byCat[c].in += Number(t.cash_in || 0);
                  byCat[c].out += Number(t.cash_out || 0);
                  byCat[c].count++;
                  if (t.subcategory) {
                    if (!byCat[c].subs[t.subcategory]) byCat[c].subs[t.subcategory] = { in: 0, out: 0, count: 0 };
                    byCat[c].subs[t.subcategory].in += Number(t.cash_in || 0);
                    byCat[c].subs[t.subcategory].out += Number(t.cash_out || 0);
                    byCat[c].subs[t.subcategory].count++;
                  }
                });
                const hasFilters = tSearch.type !== 'all' || tSearch.cat || tSearch.subcat || tSearch.desc || tSearch.dateFrom || tSearch.dateTo || tSearch.inboundRef;
                return (
                  <div className="bg-white rounded-xl p-4 border border-blue-100">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-3">
                      <div>
                        <label className="text-[10px] font-bold text-slate-500">Type</label>
                        <select value={tSearch.type} onChange={e => setTSearch({...tSearch, type: e.target.value})}
                          className="w-full px-2 py-1.5 rounded border text-xs">
                          <option value="all">All</option>
                          <option value="income">💰 Income Only</option>
                          <option value="expense">📤 Expense Only</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-500">Category</label>
                        <select value={tSearch.cat} onChange={e => setTSearch({...tSearch, cat: e.target.value})}
                          className="w-full px-2 py-1.5 rounded border text-xs">
                          <option value="">All Categories</option>
                          {allCats.map(c => <option key={c} value={c}>{EXPENSE_CATS[c] || c}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-500">Subcategory</label>
                        <input list="tsearch-subs" value={tSearch.subcat} onChange={e => setTSearch({...tSearch, subcat: e.target.value})}
                          placeholder="Type to filter..." className="w-full px-2 py-1.5 rounded border text-xs" />
                        <datalist id="tsearch-subs">{allSubcats.map(s => <option key={s} value={s} />)}</datalist>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-500">Description</label>
                        <input value={tSearch.desc} onChange={e => setTSearch({...tSearch, desc: e.target.value})}
                          placeholder="Search text..." className="w-full px-2 py-1.5 rounded border text-xs" />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-500">Inbound Ref #</label>
                        <input value={tSearch.inboundRef} onChange={e => setTSearch({...tSearch, inboundRef: e.target.value})}
                          placeholder="Shipment ref..." className="w-full px-2 py-1.5 rounded border text-xs bg-blue-50" />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-500">From Date</label>
                        <input type="date" value={tSearch.dateFrom} onChange={e => setTSearch({...tSearch, dateFrom: e.target.value})}
                          className="w-full px-2 py-1.5 rounded border text-xs" />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-500">To Date</label>
                        <input type="date" value={tSearch.dateTo} onChange={e => setTSearch({...tSearch, dateTo: e.target.value})}
                          className="w-full px-2 py-1.5 rounded border text-xs" />
                      </div>
                    </div>
                    <button onClick={() => setTSearch({ show: true, type: 'all', cat: '', subcat: '', desc: '', dateFrom: '', dateTo: '', inboundRef: '' })}
                      className="text-[10px] text-slate-400 hover:text-red-500 mb-3">Clear All Filters</button>

                    {hasFilters && (
                      <div>
                        {/* Totals */}
                        <div className="grid grid-cols-3 gap-2 mb-3">
                          <div className="bg-emerald-50 rounded-lg p-2.5 text-center">
                            <div className="text-[9px] text-emerald-600 font-bold">Total In</div>
                            <div className="text-sm font-extrabold text-emerald-700">{fE(srIn)}</div>
                          </div>
                          <div className="bg-red-50 rounded-lg p-2.5 text-center">
                            <div className="text-[9px] text-red-500 font-bold">Total Out</div>
                            <div className="text-sm font-extrabold text-red-600">{fE(srOut)}</div>
                          </div>
                          <div className="bg-blue-50 rounded-lg p-2.5 text-center">
                            <div className="text-[9px] text-blue-500 font-bold">Transactions</div>
                            <div className="text-sm font-extrabold text-blue-700">{searchResults.length}</div>
                          </div>
                        </div>
                        {/* Breakdown by category */}
                        <div className="mb-3">
                          <h4 className="text-[10px] font-bold text-slate-500 mb-1">BREAKDOWN BY CATEGORY</h4>
                          {Object.entries(byCat).sort((a,b) => (b[1].out + b[1].in) - (a[1].out + a[1].in)).map(([cat, data]) => (
                            <div key={cat} className="mb-1">
                              <div className="flex justify-between py-1 text-xs border-b border-slate-50">
                                <span className="font-semibold">{cat} <span className="text-slate-400 font-normal">({data.count})</span></span>
                                <div className="flex gap-3">
                                  {data.in > 0 && <span className="text-emerald-600">{fE(data.in)}</span>}
                                  {data.out > 0 && <span className="text-red-500">{fE(data.out)}</span>}
                                </div>
                              </div>
                              {Object.entries(data.subs).sort((a,b) => (b[1].out+b[1].in)-(a[1].out+a[1].in)).map(([sub, sd]) => (
                                <div key={sub} className="flex justify-between py-0.5 pl-4 text-[10px] text-slate-500">
                                  <span>↳ {sub} ({sd.count})</span>
                                  <div className="flex gap-3">
                                    {sd.in > 0 && <span className="text-emerald-500">{fE(sd.in)}</span>}
                                    {sd.out > 0 && <span className="text-red-400">{fE(sd.out)}</span>}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                        {/* Transaction list */}
                        <details className="text-xs">
                          <summary className="cursor-pointer text-blue-600 font-bold mb-1">Show {searchResults.length} transactions</summary>
                          <div className="overflow-auto max-h-[300px] rounded-lg border border-slate-200 mt-1">
                            <table className="w-full border-collapse text-xs">
                              <thead className="sticky top-0"><tr className="bg-slate-50">
                                <th className="px-2 py-1.5 text-left">Date</th>
                                <th className="px-2 py-1.5" style={{direction:'rtl'}}>Description</th>
                                <th className="px-2 py-1.5 text-xs">Category</th>
                                <th className="px-2 py-1.5 text-right">In</th>
                                <th className="px-2 py-1.5 text-right">Out</th>
                              </tr></thead>
                              <tbody>
                                {searchResults.sort((a,b) => (b.transaction_date||'').localeCompare(a.transaction_date||'')).slice(0, 300).map(t => (
                                  <tr key={t.id} className="border-b border-slate-50">
                                    <td className="px-2 py-1 text-[10px]">{t.transaction_date}</td>
                                    <td className="px-2 py-1 text-[10px]" style={{direction:'rtl'}}>{t.description}</td>
                                    <td className="px-2 py-1 text-[10px] text-amber-600">{EXPENSE_CATS[t.category] || t.category || ''}{t.subcategory ? ' / ' + t.subcategory : ''}</td>
                                    <td className="px-2 py-1 text-[10px] text-right text-emerald-600 font-semibold">{Number(t.cash_in) > 0 ? fE(t.cash_in) : ''}</td>
                                    <td className="px-2 py-1 text-[10px] text-right text-red-500 font-semibold">{Number(t.cash_out) > 0 ? fE(t.cash_out) : ''}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </details>
                      </div>
                    )}
                    {!hasFilters && <div className="text-xs text-slate-400 text-center py-3">Set filters above to see aggregated results</div>}
                  </div>
                );
              })()}
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
            {query && (() => {
              const searchResults = filteredTreasury.filter(t => {
                const words = query.split(/\s+/).filter(w => w.length > 0);
                const hay = [t.order_number || '', t.description || '', t.transaction_date || '', String(t.cash_in || 0), String(t.cash_out || 0), t.category || '', t.subcategory || ''].join(' ');
                return words.every(w => hay.includes(w));
              });
              const srIn = searchResults.reduce((a, t) => a + Number(t.cash_in || 0), 0);
              const srOut = searchResults.reduce((a, t) => a + Number(t.cash_out || 0), 0);
              return (
              <div className="bg-white rounded-xl p-4 mb-3">
                <h3 className="text-sm font-bold mb-2">Search Results ({searchResults.length})</h3>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div className="bg-emerald-50 rounded-lg p-2 text-center">
                    <div className="text-[9px] text-emerald-600 font-bold">Total In</div>
                    <div className="text-sm font-extrabold text-emerald-700">{fE(srIn)}</div>
                  </div>
                  <div className="bg-red-50 rounded-lg p-2 text-center">
                    <div className="text-[9px] text-red-500 font-bold">Total Out</div>
                    <div className="text-sm font-extrabold text-red-600">{fE(srOut)}</div>
                  </div>
                  <div className="rounded-lg p-2 text-center" style={{background: srIn >= srOut ? '#ecfdf5' : '#fef2f2'}}>
                    <div className="text-[9px] text-slate-500 font-bold">Net</div>
                    <div className={'text-sm font-extrabold ' + (srIn >= srOut ? 'text-emerald-700' : 'text-red-600')}>{fE(srIn - srOut)}</div>
                  </div>
                </div>
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
                      {searchResults.slice(0, 200).map(txn => (
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
              </div>);
            })()}
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
                          <button onClick={() => { setReconcileCheck(c); setReconcileDate(''); setReconcileMethod('check'); }}
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
                <ModeBar />
                <button onClick={() => setFormData({...formData, showAddWarehouse: true, whType: 'general'})}
                  className="px-3 py-1.5 bg-purple-500 text-white rounded-lg text-xs font-semibold hover:bg-purple-600">
                  + New Expense / مصروف جديد
                </button>
              </div>
            </div>
            {/* Add Warehouse Expense Modal */}
            {formData.showAddWarehouse && (
              <Modal onClose={() => setFormData({...formData, showAddWarehouse: false})} title="New Warehouse Expense / مصروف مخزن جديد">
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-600">Date / التاريخ</label>
                    <input type="date" value={formData.whExpDate || today()}
                      onChange={e => setFormData({...formData, whExpDate: e.target.value})}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-600">Amount / المبلغ</label>
                    <input type="number" value={formData.whExpAmount || ''}
                      onChange={e => setFormData({...formData, whExpAmount: e.target.value})}
                      placeholder="0.00" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs font-semibold text-slate-600">Description / الوصف</label>
                    <input value={formData.whExpDesc || ''}
                      onChange={e => setFormData({...formData, whExpDesc: e.target.value})}
                      placeholder="Expense description..." className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" style={{direction:'rtl'}} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-600">Category / التصنيف</label>
                    <select value={formData.whExpCat || ''} onChange={e => setFormData({...formData, whExpCat: e.target.value})}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm">
                      <option value="">Select category...</option>
                      {[...new Set(warehouse.map(w => w.category).filter(Boolean))].sort().map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                      <option value="__custom">+ Custom...</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-600">Subcategory / فرعي</label>
                    <input list="wh-subcats" value={formData.whExpSub || ''}
                      onChange={e => setFormData({...formData, whExpSub: e.target.value})}
                      placeholder="Optional..." className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                    <datalist id="wh-subcats">
                      {[...new Set(warehouse.map(w => w.subcategory).filter(Boolean))].sort().map(s => <option key={s} value={s} />)}
                    </datalist>
                  </div>
                </div>
                {/* Reference Type */}
                <div className="bg-slate-50 rounded-lg p-3 mb-3">
                  <label className="text-xs font-semibold text-slate-600 mb-2 block">Reference Type / نوع المرجع</label>
                  <div className="flex gap-3 mb-2">
                    {[['general', '🏭 General / عام'], ['shipment', '🚢 Shipment / شحنة']].map(([v, l]) => (
                      <button key={v} onClick={() => setFormData({...formData, whType: v})}
                        className={'px-3 py-1.5 rounded-lg text-xs font-bold transition ' + (formData.whType === v ? 'bg-purple-500 text-white' : 'bg-white border border-slate-200')}>
                        {l}
                      </button>
                    ))}
                  </div>
                  {formData.whType === 'shipment' && (
                    <div>
                      <label className="text-[10px] font-semibold text-slate-500">Order # / رقم الأمر</label>
                      <input list="wh-orders" value={formData.whExpRef || ''}
                        onChange={e => setFormData({...formData, whExpRef: e.target.value})}
                        placeholder="Type or select order number..."
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-blue-50" />
                      <datalist id="wh-orders">
                        {[...new Set(invoices.map(i => i.order_number).filter(Boolean))].sort().map(o => <option key={o} value={o} />)}
                      </datalist>
                    </div>
                  )}
                  {formData.whType === 'general' && (
                    <div className="text-[10px] text-slate-400">This expense is for general warehouse operations, not tied to a specific shipment.</div>
                  )}
                </div>
                <button onClick={async () => {
                  if (!formData.whExpDesc || !formData.whExpAmount) { alert('Please fill in description and amount'); return; }
                  let cat = formData.whExpCat || '';
                  if (cat === '__custom') {
                    const custom = prompt('Enter custom category name:');
                    if (!custom) return;
                    cat = custom.trim();
                  }
                  try {
                    await dbInsert('warehouse_expenses', {
                      expense_date: formData.whExpDate || today(),
                      description: formData.whExpDesc,
                      amount: Number(formData.whExpAmount),
                      category: cat,
                      subcategory: formData.whExpSub || '',
                      america_ref: formData.whType === 'shipment' ? (formData.whExpRef || '') : 'GENERAL',
                      created_by: userProfile?.id,
                    }, userProfile?.id);
                    setFormData({...formData, showAddWarehouse: false, whExpDate: '', whExpDesc: '', whExpAmount: '', whExpCat: '', whExpSub: '', whExpRef: '', whType: 'general'});
                    await loadAllData();
                  } catch(err) { alert('Error: ' + err.message); }
                }} className="w-full px-4 py-2 bg-purple-500 text-white rounded-lg font-semibold">
                  💾 Save Expense / حفظ المصروف
                </button>
              </Modal>
            )}
            {/* Advanced Search */}
            <div className="mb-3">
              <button onClick={() => setFormData({...formData, whAdvanced: !formData.whAdvanced})}
                className="text-xs font-bold text-purple-600 hover:underline mb-2">
                {formData.whAdvanced ? '▼ Hide Advanced Search' : '▶ Advanced Search / بحث متقدم'}
              </button>
              {formData.whAdvanced && (
                <div className="bg-white rounded-xl p-4 border border-purple-100">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-3">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500">Description</label>
                      <input value={formData.whSearch||''} onChange={e=>setFormData({...formData,whSearch:e.target.value})}
                        placeholder="Arabic or English..." className="w-full px-2 py-1.5 rounded border text-xs" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500">Inbound Ref #</label>
                      <input value={formData.whInboundRef||''} onChange={e=>setFormData({...formData,whInboundRef:e.target.value})}
                        placeholder="Shipment ref..." className="w-full px-2 py-1.5 rounded border text-xs bg-blue-50" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500">Subcategory</label>
                      <input value={formData.whSubSearch||''} onChange={e=>setFormData({...formData,whSubSearch:e.target.value})}
                        placeholder="Filter..." className="w-full px-2 py-1.5 rounded border text-xs" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500">From Date</label>
                      <input type="date" value={formData.whDateFrom||''} onChange={e=>setFormData({...formData,whDateFrom:e.target.value})}
                        className="w-full px-2 py-1.5 rounded border text-xs" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500">To Date</label>
                      <input type="date" value={formData.whDateTo||''} onChange={e=>setFormData({...formData,whDateTo:e.target.value})}
                        className="w-full px-2 py-1.5 rounded border text-xs" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500">Category</label>
                      <input value={formData.whCatSearch||''} onChange={e=>setFormData({...formData,whCatSearch:e.target.value})}
                        placeholder="Category..." className="w-full px-2 py-1.5 rounded border text-xs" />
                    </div>
                  </div>
                  <button onClick={() => setFormData({...formData, whSearch:'', whInboundRef:'', whSubSearch:'', whDateFrom:'', whDateTo:'', whCatSearch:''})}
                    className="text-[10px] text-slate-400 hover:text-red-500">Clear All Filters</button>
                </div>
              )}
            </div>
            {(() => {
              const filtered = warehouse.filter(w => {
                if (!inRange(w.expense_date, mode, df, dt)) return false;
                if (formData.whSearch && !(w.description||'').includes(formData.whSearch) && !(w.description_en||'').toLowerCase().includes((formData.whSearch||'').toLowerCase())) return false;
                if (formData.whInboundRef && !(w.inbound_ref||'').toLowerCase().includes((formData.whInboundRef||'').toLowerCase())) return false;
                if (formData.whSubSearch && !(w.subcategory||'').toLowerCase().includes((formData.whSubSearch||'').toLowerCase())) return false;
                if (formData.whDateFrom && (w.expense_date||'') < formData.whDateFrom) return false;
                if (formData.whDateTo && (w.expense_date||'') > formData.whDateTo) return false;
                if (formData.whCatSearch && !(getWarehouseCat(w.description)||'').toLowerCase().includes((formData.whCatSearch||'').toLowerCase())) return false;
                return true;
              });
              const total = filtered.reduce((a, w) => a + Number(w.amount), 0);
              const hasWhFilters = formData.whSearch || formData.whInboundRef || formData.whSubSearch || formData.whDateFrom || formData.whDateTo || formData.whCatSearch;

              // Build category → description → entries hierarchy
              const catMap = {};
              filtered.forEach(w => {
                const cat = getWarehouseCat(w.description);
                const desc = (w.description || '').trim();
                if (!catMap[cat]) catMap[cat] = { total: 0, count: 0, descs: {} };
                catMap[cat].total += Number(w.amount);
                catMap[cat].count++;
                if (!catMap[cat].descs[desc]) catMap[cat].descs[desc] = { total: 0, count: 0, entries: [], descEn: '', subcategory: '' };
                catMap[cat].descs[desc].total += Number(w.amount);
                catMap[cat].descs[desc].count++;
                catMap[cat].descs[desc].entries.push(w);
                if (w.description_en && !catMap[cat].descs[desc].descEn) catMap[cat].descs[desc].descEn = w.description_en;
                if (w.subcategory && !catMap[cat].descs[desc].subcategory) catMap[cat].descs[desc].subcategory = w.subcategory;
              });

              const sortedCats = Object.entries(catMap).sort((a, b) => b[1].total - a[1].total);

              // Get all unique subcategories across all descriptions
              const allSubcats = [...new Set(filtered.map(w => w.subcategory).filter(Boolean))].sort();

              // Subcategory assignment handler
              const assignSubcat = async (desc, newSubcat) => {
                const matching = warehouse.filter(w => (w.description || '').trim() === desc);
                for (const w of matching) {
                  await dbUpdate('warehouse_expenses', w.id, { subcategory: newSubcat }, user?.id);
                }
                await loadAllData();
              };

              // Translate a description
              const translateDesc = async (desc) => {
                try {
                  const res = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: desc, targetLang: 'en' }) });
                  const data = await res.json();
                  const translated = data.translated || data.text || '';
                  if (translated) {
                    const matching = warehouse.filter(w => (w.description || '').trim() === desc);
                    for (const w of matching) {
                      await dbUpdate('warehouse_expenses', w.id, { description_en: translated }, user?.id);
                    }
                    await loadAllData();
                  }
                } catch (e) { alert('Translation error: ' + e.message); }
              };

              // Current drill state
              const drillCat = warehouseDrill;
              const drillDesc = whDescDrill;
              const currentCatData = drillCat ? catMap[drillCat] : null;
              const currentDescData = drillCat && drillDesc && currentCatData ? currentCatData.descs[drillDesc] : null;

              // Filter descriptions by subcategory within drilled category
              let descEntries = currentCatData ? Object.entries(currentCatData.descs).sort((a, b) => b[1].total - a[1].total) : [];
              if (whSubFilter !== 'all' && currentCatData) {
                descEntries = descEntries.filter(([_, d]) =>
                  whSubFilter === 'uncategorized' ? !d.subcategory : d.subcategory === whSubFilter
                );
              }

              return (
                <div>
                  {/* Summary Cards */}
                  <div className="grid grid-cols-3 gap-3 mb-3">
                    <div className="bg-white rounded-xl p-3" style={{ borderLeftWidth: 3, borderLeftColor: '#8b5cf6' }}>
                      <div className="text-[10px] text-slate-500">Total Expenses</div>
                      <div className="text-lg font-extrabold text-purple-600">{fE(total)}</div>
                    </div>
                    <div className="bg-white rounded-xl p-3" style={{ borderLeftWidth: 3, borderLeftColor: '#6366f1' }}>
                      <div className="text-[10px] text-slate-500">Entries</div>
                      <div className="text-lg font-extrabold text-indigo-600">{filtered.length}</div>
                    </div>
                    <div className="bg-white rounded-xl p-3" style={{ borderLeftWidth: 3, borderLeftColor: '#0ea5e9' }}>
                      <div className="text-[10px] text-slate-500">Categories</div>
                      <div className="text-lg font-extrabold text-sky-600">{sortedCats.length}</div>
                    </div>
                  </div>

                  {/* Aggregation breakdown when filters active */}
                  {hasWhFilters && filtered.length > 0 && (
                    <div className="bg-white rounded-xl p-4 mb-3 border border-purple-100">
                      <h4 className="text-[10px] font-bold text-slate-500 mb-2">FILTERED BREAKDOWN</h4>
                      {sortedCats.map(([cat, data], i) => (
                        <div key={cat} className="mb-1">
                          <div className="flex justify-between py-1 text-xs border-b border-slate-50">
                            <span className="font-semibold">{cat} <span className="text-slate-400 font-normal">({data.count})</span></span>
                            <span className="font-bold text-purple-600">{fE(data.total)}</span>
                          </div>
                          {Object.entries(data.descs).sort((a,b) => b[1].total - a[1].total).slice(0, 5).map(([desc, dd]) => (
                            <div key={desc} className="flex justify-between py-0.5 pl-4 text-[10px] text-slate-500">
                              <span className="truncate max-w-[60%]" style={{direction:'rtl'}}>↳ {dd.descEn || desc} ({dd.count})</span>
                              <span className="text-purple-500">{fE(dd.total)}</span>
                            </div>
                          ))}
                        </div>
                      ))}
                      {/* By inbound ref */}
                      {(() => {
                        const byRef = {};
                        filtered.forEach(w => {
                          const ref = w.inbound_ref || 'No Ref';
                          if (!byRef[ref]) byRef[ref] = { total: 0, count: 0 };
                          byRef[ref].total += Number(w.amount); byRef[ref].count++;
                        });
                        const refs = Object.entries(byRef).sort((a,b) => b[1].total - a[1].total);
                        if (refs.length <= 1 && refs[0]?.[0] === 'No Ref') return null;
                        return (
                          <div className="mt-3 pt-2 border-t border-slate-100">
                            <h4 className="text-[10px] font-bold text-blue-500 mb-1">BY INBOUND REF</h4>
                            {refs.map(([ref, rd]) => (
                              <div key={ref} className="flex justify-between py-0.5 text-xs">
                                <span className={'font-medium ' + (ref === 'No Ref' ? 'text-slate-400 italic' : 'text-blue-700')}>{ref} <span className="text-slate-400 font-normal">({rd.count})</span></span>
                                <span className="font-bold text-purple-600">{fE(rd.total)}</span>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* Breadcrumb */}
                  {(drillCat || drillDesc) && (
                    <div className="flex items-center gap-1 text-xs mb-3 flex-wrap">
                      <button onClick={() => { setWarehouseDrill(null); setWhDescDrill(null); setWhSubFilter('all'); }}
                        className="text-blue-600 hover:underline font-semibold">All Categories</button>
                      {drillCat && <>
                        <span className="text-slate-400">›</span>
                        <button onClick={() => { setWhDescDrill(null); }}
                          className={'font-semibold ' + (drillDesc ? 'text-blue-600 hover:underline' : 'text-slate-800')}>{drillCat}</button>
                      </>}
                      {drillDesc && <>
                        <span className="text-slate-400">›</span>
                        <span className="text-slate-800 font-semibold truncate max-w-[200px]" style={{ direction: 'rtl' }}>{drillDesc}</span>
                      </>}
                    </div>
                  )}

                  {/* ===== LEVEL 1: Category Buckets ===== */}
                  {!drillCat && (
                    <div className="bg-white rounded-xl p-4 mb-3">
                      <h3 className="text-sm font-bold mb-2">Expense Categories / تصنيف المصروفات</h3>
                      {sortedCats.map(([cat, data], i) => (
                        <div key={cat} onClick={() => { setWarehouseDrill(cat); setWhDescDrill(null); setWhSubFilter('all'); }}
                          className="flex justify-between py-2 border-b border-slate-50 text-xs cursor-pointer hover:bg-purple-50 px-1">
                          <div className="flex items-center gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                            <span className="font-medium">{cat}</span>
                            <span className="text-slate-400">({data.count} entries, {Object.keys(data.descs).length} types)</span>
                          </div>
                          <span className="font-bold text-purple-600">{fE(data.total)} →</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* ===== LEVEL 2: Description Buckets within Category ===== */}
                  {drillCat && !drillDesc && currentCatData && (
                    <div className="bg-white rounded-xl p-4 mb-3">
                      <div className="flex justify-between items-center flex-wrap gap-2 mb-3">
                        <div>
                          <h3 className="text-sm font-bold">{drillCat}</h3>
                          <div className="text-[10px] text-slate-500">{descEntries.length} unique descriptions · {fE(descEntries.reduce((a, [_, d]) => a + d.total, 0))}</div>
                        </div>
                        <div className="flex gap-2 items-center">
                          <select value={whSubFilter} onChange={e => setWhSubFilter(e.target.value)}
                            className="px-2 py-1 rounded border text-xs">
                            <option value="all">All Subcategories</option>
                            <option value="uncategorized">⚠️ No Subcategory</option>
                            {allSubcats.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="overflow-auto max-h-[500px]">
                        {descEntries.map(([desc, data], i) => (
                          <div key={desc} onClick={() => setWhDescDrill(desc)}
                            className="flex justify-between items-center py-2 border-b border-slate-50 cursor-pointer hover:bg-purple-50 px-1">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                                <span className="text-xs truncate" style={{ direction: 'rtl' }}>{desc}</span>
                              </div>
                              {data.descEn && <div className="text-[10px] text-blue-500 ml-3.5 truncate">{data.descEn}</div>}
                              {data.subcategory && <div className="text-[10px] text-amber-600 ml-3.5">📁 {data.subcategory}</div>}
                            </div>
                            <div className="text-right flex-shrink-0 ml-2">
                              <div className="text-xs font-bold text-purple-600">{fE(data.total)}</div>
                              <div className="text-[10px] text-slate-400">{data.count}x →</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ===== LEVEL 3: Individual Entries for a Description ===== */}
                  {drillCat && drillDesc && currentDescData && (
                    <div className="bg-white rounded-xl p-4 mb-3">
                      <div className="mb-3">
                        <div className="text-sm font-bold" style={{ direction: 'rtl' }}>{drillDesc}</div>
                        {currentDescData.descEn ? (
                          <div className="text-xs text-blue-600 mt-0.5">{currentDescData.descEn}</div>
                        ) : (
                          <button onClick={() => translateDesc(drillDesc)}
                            className="text-[10px] text-blue-500 hover:underline mt-0.5">🌐 Translate to English</button>
                        )}
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-[10px] text-slate-500">Subcategory:</span>
                          <input id="wh-subcat-input" defaultValue={currentDescData.subcategory || ''} placeholder="Enter subcategory..."
                            className="px-2 py-1 border rounded text-xs w-40" 
                            list="wh-subcats" />
                          <datalist id="wh-subcats">
                            {allSubcats.map(s => <option key={s} value={s} />)}
                          </datalist>
                          <button onClick={() => {
                            const val = document.getElementById('wh-subcat-input')?.value;
                            if (val) assignSubcat(drillDesc, val);
                          }}
                            className="px-2 py-1 bg-amber-500 text-white rounded text-[10px] font-semibold">Save</button>
                        </div>
                      </div>
                      <div className="flex justify-between items-center mb-2">
                        <div className="text-xs text-slate-500">{currentDescData.count} entries</div>
                        <div className="text-sm font-extrabold text-purple-600">{fE(currentDescData.total)}</div>
                      </div>
                      <div className="overflow-auto max-h-[350px] rounded-lg border border-slate-200">
                        <table className="w-full border-collapse">
                          <thead className="sticky top-0"><tr className="bg-slate-50">
                            <th className="px-2 py-2 text-xs text-left">Date</th>
                            <th className="px-2 py-2 text-xs" style={{ direction: 'rtl' }}>Description</th>
                            <th className="px-2 py-2 text-xs">Inbound Ref</th>
                            <th className="px-2 py-2 text-xs text-right">Amount</th>
                          </tr></thead>
                          <tbody>
                            {currentDescData.entries
                              .sort((a, b) => (b.expense_date || '').localeCompare(a.expense_date || ''))
                              .map(w => (
                                <tr key={w.id} className="border-b border-slate-50">
                                  <td className="px-2 py-1.5 text-xs">{w.expense_date}</td>
                                  <td className="px-2 py-1.5 text-xs" style={{ direction: 'rtl' }}>{w.description}</td>
                                  <td className="px-2 py-1.5">
                                    <input defaultValue={w.inbound_ref || ''} placeholder="—"
                                      className="text-xs border rounded px-1.5 py-0.5 w-24 text-center bg-blue-50"
                                      onBlur={async (e) => {
                                        const val = e.target.value.trim();
                                        if (val === (w.inbound_ref || '')) return;
                                        await supabase.from('warehouse_expenses').update({ inbound_ref: val || null }).eq('id', w.id);
                                      }} />
                                  </td>
                                  <td className="px-2 py-1.5 text-xs text-right font-semibold text-purple-600">{fE(w.amount)}</td>
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
                <select value={formData.invTypeFilter || 'all'} onChange={e => setFormData({...formData, invTypeFilter: e.target.value, invSubFilter: 'all'})}
                  className="px-2 py-1.5 rounded border text-xs">
                  <option value="all">All Categories</option>
                  {[...new Set(inventory.map(p => p.product_type).filter(Boolean))].sort().map(t =>
                    <option key={t} value={t}>{t}</option>)}
                </select>
                <select value={formData.invSubFilter || 'all'} onChange={e => setFormData({...formData, invSubFilter: e.target.value})}
                  className="px-2 py-1.5 rounded border text-xs">
                  <option value="all">All Subcategories</option>
                  {[...new Set(inventory
                    .filter(p => !formData.invTypeFilter || formData.invTypeFilter === 'all' || p.product_type === formData.invTypeFilter)
                    .map(p => p.subcategory).filter(Boolean))].sort().map(s =>
                    <option key={s} value={s}>{s}</option>)}
                </select>
                <select value={formData.invView || 'cards'} onChange={e => setFormData({...formData, invView: e.target.value})}
                  className="px-2 py-1.5 rounded border text-xs">
                  <option value="cards">📷 Cards</option>
                  <option value="table">📋 Table</option>
                </select>
                <button onClick={() => setFormData({...formData, showAddProduct: true})}
                  className="px-3 py-1.5 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg text-xs font-bold shadow-sm">
                  + Add Product
                </button>
              </div>
            </div>

            {/* Summary */}
            {(() => {
              const filtered = inventory.filter(p => {
                if (formData.invTypeFilter && formData.invTypeFilter !== 'all' && p.product_type !== formData.invTypeFilter) return false;
                if (formData.invSubFilter && formData.invSubFilter !== 'all' && p.subcategory !== formData.invSubFilter) return false;
                if (query) return (p.product_id||'').includes(query)||(p.reference_number||'').includes(query)||(p.description||'').includes(query)||(p.description_en||'').toLowerCase().includes(query.toLowerCase())||(p.color||'').includes(query)||(p.product_type||'').toLowerCase().includes(query.toLowerCase())||(p.subcategory||'').toLowerCase().includes(query.toLowerCase());
                return true;
              });
              const totalOriginal = filtered.reduce((a, p) => a + Number(p.original_quantity || p.roll_count || 0), 0);
              const totalCurrent = filtered.reduce((a, p) => a + Number(p.current_quantity || p.roll_count || 0), 0);
              const totalWeight = filtered.reduce((a, p) => a + Number(p.net_weight || 0), 0);
              const totalValue = filtered.reduce((a, p) => a + (Number(p.current_quantity || p.roll_count || 0) * Number(p.unit_price || 0)), 0);

              return (<>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <div className="bg-white rounded-xl p-3 border border-slate-100">
                  <div className="text-[9px] text-slate-400 uppercase tracking-wide">Products</div>
                  <div className="text-xl font-extrabold">{filtered.length}</div>
                </div>
                <div className="bg-white rounded-xl p-3 border border-slate-100">
                  <div className="text-[9px] text-slate-400 uppercase tracking-wide">Original Qty</div>
                  <div className="text-xl font-extrabold text-blue-600">{totalOriginal.toLocaleString()}</div>
                </div>
                <div className="bg-white rounded-xl p-3 border border-slate-100">
                  <div className="text-[9px] text-slate-400 uppercase tracking-wide">Current Qty</div>
                  <div className="text-xl font-extrabold text-emerald-600">{totalCurrent.toLocaleString()}</div>
                </div>
                <div className="bg-white rounded-xl p-3 border border-slate-100">
                  <div className="text-[9px] text-slate-400 uppercase tracking-wide">Est. Value</div>
                  <div className="text-xl font-extrabold text-purple-600">{fE(totalValue)}</div>
                </div>
              </div>

              {/* Cards View */}
              {(formData.invView || 'cards') === 'cards' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {filtered.map(p => {
                    const origQty = Number(p.original_quantity || p.roll_count || 0);
                    const currQty = Number(p.current_quantity || p.roll_count || 0);
                    const usedPct = origQty > 0 ? Math.round(((origQty - currQty) / origQty) * 100) : 0;
                    return (
                      <div key={p.id} onClick={() => setFormData({...formData, selectedProduct: p})}
                        className="bg-white rounded-2xl overflow-hidden border border-slate-100 hover:border-slate-300 hover:shadow-lg transition cursor-pointer group">
                        {/* Photo */}
                        {p.photo_url ? (
                          <div className="h-40 bg-slate-100 overflow-hidden">
                            <img src={p.photo_url} alt={p.description_en || p.description} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                          </div>
                        ) : (
                          <div className="h-24 bg-gradient-to-br from-slate-100 to-slate-50 flex items-center justify-center">
                            <span className="text-3xl opacity-30">📦</span>
                          </div>
                        )}
                        <div className="p-3">
                          {/* Category pills */}
                          <div className="flex gap-1 mb-2 flex-wrap">
                            {p.product_type && <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-md text-[9px] font-bold">{p.product_type}</span>}
                            {p.subcategory && <span className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded-md text-[9px] font-medium">{p.subcategory}</span>}
                            <span className={'px-2 py-0.5 rounded-md text-[9px] font-bold ' +
                              (p.stock_status === 'in_stock' ? 'bg-green-50 text-green-700' :
                               p.stock_status === 'low' ? 'bg-amber-50 text-amber-700' :
                               p.stock_status === 'reserved' ? 'bg-blue-50 text-blue-700' : 'bg-red-50 text-red-700')}>
                              {p.stock_status === 'in_stock' ? 'In Stock' : p.stock_status === 'low' ? 'Low' : p.stock_status === 'reserved' ? 'Reserved' : p.stock_status === 'out_of_stock' ? 'Out' : 'Available'}
                            </span>
                          </div>
                          {/* Name */}
                          <div className="text-sm font-bold truncate">{p.reference_number || p.product_id}</div>
                          <div className="text-[11px] text-slate-500 truncate" style={{direction:'rtl'}}>{lang === 'en' && p.description_en ? p.description_en : p.description}</div>
                          {p.color && <div className="text-[10px] text-slate-400 mt-0.5">🎨 {lang === 'en' && p.color_en ? p.color_en : p.color}</div>}
                          {/* Quantity bar */}
                          <div className="mt-2">
                            <div className="flex justify-between text-[9px] mb-0.5">
                              <span className="text-slate-400">Qty: {currQty.toLocaleString()} / {origQty.toLocaleString()}</span>
                              <span className="font-bold text-emerald-600">{fE(p.unit_price)}</span>
                            </div>
                            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{width: Math.max(5, 100 - usedPct) + '%', background: usedPct > 80 ? '#ef4444' : usedPct > 50 ? '#f59e0b' : '#10b981'}} />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Table View */}
              {formData.invView === 'table' && (
                <div className="overflow-auto rounded-xl border border-slate-200 max-h-[450px]">
                  <table className="w-full border-collapse">
                    <thead className="sticky top-0"><tr className="bg-slate-50">
                      <th className="px-2 py-2 text-[10px] text-left">Photo</th>
                      <th className="px-2 py-2 text-[10px] text-left">Product</th>
                      <th className="px-2 py-2 text-[10px]">Category</th>
                      <th className="px-2 py-2 text-[10px]">Subcategory</th>
                      <th className="px-2 py-2 text-[10px] text-right">Original</th>
                      <th className="px-2 py-2 text-[10px] text-right">Current</th>
                      <th className="px-2 py-2 text-[10px] text-right">Weight</th>
                      <th className="px-2 py-2 text-[10px] text-right">Price</th>
                      <th className="px-2 py-2 text-[10px]">Status</th>
                    </tr></thead>
                    <tbody>
                      {filtered.map(p => (
                        <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50 cursor-pointer"
                          onClick={() => setFormData({...formData, selectedProduct: p})}>
                          <td className="px-2 py-1.5">
                            {p.photo_url ? <img src={p.photo_url} className="w-10 h-10 rounded object-cover" /> : <span className="text-slate-300 text-lg">📦</span>}
                          </td>
                          <td className="px-2 py-1.5">
                            <div className="text-xs font-bold text-blue-600">{p.reference_number || p.product_id}</div>
                            <div className="text-[10px] text-slate-500">{lang === 'en' && p.description_en ? p.description_en : p.description}</div>
                          </td>
                          <td className="px-2 py-1.5">{p.product_type && <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded text-[9px]">{p.product_type}</span>}</td>
                          <td className="px-2 py-1.5">{p.subcategory && <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-[9px]">{p.subcategory}</span>}</td>
                          <td className="px-2 py-1.5 text-xs text-right">{Number(p.original_quantity || p.roll_count || 0).toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-xs text-right font-bold text-emerald-600">{Number(p.current_quantity || p.roll_count || 0).toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-xs text-right">{fmt(p.net_weight)} kg</td>
                          <td className="px-2 py-1.5 text-xs text-right font-semibold text-emerald-600">{fE(p.unit_price)}</td>
                          <td className="px-2 py-1.5">
                            <span className={'px-1.5 py-0.5 rounded-full text-[9px] font-semibold ' +
                              (p.stock_status === 'in_stock' ? 'bg-green-100 text-green-700' :
                               p.stock_status === 'low' ? 'bg-amber-100 text-amber-700' :
                               p.stock_status === 'reserved' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700')}>
                              {p.stock_status === 'in_stock' ? 'In Stock' : p.stock_status === 'low' ? 'Low' : p.stock_status === 'reserved' ? 'Reserved' : 'Out'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              </>);
            })()}

            {/* Add Product Form */}
            {formData.showAddProduct && (
              <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center overflow-auto p-4" onClick={e => { if (e.target === e.currentTarget) setFormData({}); }}>
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[600px] my-8 overflow-hidden">
                  <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-5 py-4">
                    <h3 className="text-white font-bold text-base">📦 New Product / منتج جديد</h3>
                  </div>
                  <div className="p-5 space-y-3 max-h-[70vh] overflow-auto">
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className="text-[10px] font-bold text-slate-500">Product ID</label>
                        <input value={formData.prodId || ''} onChange={e => setFormData({...formData, prodId: e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
                      <div><label className="text-[10px] font-bold text-slate-500">Shipment Reference #</label>
                        <input value={formData.prodShipment || ''} onChange={e => setFormData({...formData, prodShipment: e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
                      <div><label className="text-[10px] font-bold text-slate-500">Category / النوع</label>
                        <select value={formData.prodType || ''} onChange={e => { if (e.target.value === '_new') { const n = prompt('New category:'); if (n) setFormData({...formData, prodType: n}); } else setFormData({...formData, prodType: e.target.value}); }}
                          className="w-full px-3 py-2 rounded-lg border text-sm">
                          <option value="">Select...</option>
                          {['Pool','Leather','Roofing','Fabrics','PVC','Chemicals','Headliner','Boat Flooring','Upholstery',
                            ...new Set(inventory.map(p => p.product_type).filter(Boolean))].filter((v,i,a) => v && a.indexOf(v)===i).sort().map(t =>
                            <option key={t} value={t}>{t}</option>)}
                          <option value="_new">+ New Category</option>
                        </select></div>
                      <div><label className="text-[10px] font-bold text-slate-500">Subcategory / تصنيف فرعي</label>
                        <input list="inv-subcats-add" value={formData.prodSubcat || ''} onChange={e => setFormData({...formData, prodSubcat: e.target.value})}
                          placeholder="e.g. Mosaic Liner, Looks..." className="w-full px-3 py-2 rounded-lg border text-sm" />
                        <datalist id="inv-subcats-add">{[...new Set(inventory.map(p => p.subcategory).filter(Boolean))].sort().map(s => <option key={s} value={s} />)}</datalist></div>
                      <div><label className="text-[10px] font-bold text-slate-500">Inbound Date</label>
                        <input type="date" value={formData.prodDate || today()} onChange={e => setFormData({...formData, prodDate: e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
                      {formData.prodId && inventory.find(p => p.product_id === formData.prodId) && (
                        <div className="col-span-2 bg-amber-50 rounded-lg p-2 border border-amber-200">
                          <div className="text-[10px] font-bold text-amber-700">⚠️ Product ID "{formData.prodId}" already exists — this will be added as a new inbound and quantities/costs will be aggregated.</div>
                        </div>
                      )}
                      <div><label className="text-[10px] font-bold text-slate-500">Description (Arabic)</label>
                        <input value={formData.prodDesc || ''} onChange={e => setFormData({...formData, prodDesc: e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" style={{direction:'rtl'}} /></div>
                      <div><label className="text-[10px] font-bold text-slate-500">Description (English)</label>
                        <input value={formData.prodDescEn || ''} onChange={e => setFormData({...formData, prodDescEn: e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
                      <div><label className="text-[10px] font-bold text-slate-500">Color (Arabic)</label>
                        <input value={formData.prodColor || ''} onChange={e => setFormData({...formData, prodColor: e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" style={{direction:'rtl'}} /></div>
                      <div><label className="text-[10px] font-bold text-slate-500">Color (English)</label>
                        <input value={formData.prodColorEn || ''} onChange={e => setFormData({...formData, prodColorEn: e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
                      <div><label className="text-[10px] font-bold text-slate-500">Original Quantity</label>
                        <input type="number" value={formData.prodOrigQty || ''} onChange={e => setFormData({...formData, prodOrigQty: e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
                      <div><label className="text-[10px] font-bold text-slate-500">Current Quantity</label>
                        <input type="number" value={formData.prodCurrQty || ''} onChange={e => setFormData({...formData, prodCurrQty: e.target.value || formData.prodOrigQty})} placeholder="Same as original if blank" className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
                      <div><label className="text-[10px] font-bold text-slate-500">Gross Weight (kg)</label>
                        <input type="number" value={formData.prodGross || ''} onChange={e => setFormData({...formData, prodGross: e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
                      <div><label className="text-[10px] font-bold text-slate-500">Net Weight (kg)</label>
                        <input type="number" value={formData.prodNet || ''} onChange={e => setFormData({...formData, prodNet: e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
                      <div><label className="text-[10px] font-bold text-slate-500">Unit Price</label>
                        <input type="number" value={formData.prodPrice || ''} onChange={e => setFormData({...formData, prodPrice: e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
                      <div><label className="text-[10px] font-bold text-slate-500">Roll Count</label>
                        <input type="number" value={formData.prodRolls || ''} onChange={e => setFormData({...formData, prodRolls: e.target.value})} className="w-full px-3 py-2 rounded-lg border text-sm" /></div>
                      <div className="col-span-2">
                        <label className="text-[10px] font-bold text-slate-500">Product Photo / صورة المنتج</label>
                        <input type="file" accept="image/*" id="prod-photo" className="w-full px-3 py-2 rounded-lg border text-sm" />
                        <div className="text-[9px] text-slate-400 mt-1">JPEG or PNG. Stored in Supabase Storage.</div>
                      </div>
                      {(userProfile?.role === 'super_admin' || modulePerms?.['View Costs'] === true) && (<>
                        <div className="col-span-2 mt-2 pt-2 border-t border-red-200">
                          <div className="text-[10px] font-bold text-red-700">🔒 Cost Fields (Internal)</div>
                        </div>
                        <div><label className="text-[9px] font-bold text-slate-500">Purchase Cost</label>
                          <div className="flex gap-1">
                            <input type="number" value={formData.prodPurchaseCost || ''} onChange={e => setFormData({...formData, prodPurchaseCost: e.target.value})} placeholder="0.00" className="flex-1 px-2 py-1.5 rounded border text-sm" />
                            <select value={formData.prodPurchaseCurr || 'USD'} onChange={e => setFormData({...formData, prodPurchaseCurr: e.target.value})} className="px-1 py-1 rounded border text-xs w-16"><option value="USD">USD</option><option value="EGP">EGP</option></select>
                          </div></div>
                        <div><label className="text-[9px] font-bold text-slate-500">Customs / Duties</label>
                          <div className="flex gap-1">
                            <input type="number" value={formData.prodCustomsCost || ''} onChange={e => setFormData({...formData, prodCustomsCost: e.target.value})} placeholder="0.00" className="flex-1 px-2 py-1.5 rounded border text-sm" />
                            <select value={formData.prodCustomsCurr || 'EGP'} onChange={e => setFormData({...formData, prodCustomsCurr: e.target.value})} className="px-1 py-1 rounded border text-xs w-16"><option value="USD">USD</option><option value="EGP">EGP</option></select>
                          </div></div>
                        <div><label className="text-[9px] font-bold text-slate-500">Shipping & Freight</label>
                          <div className="flex gap-1">
                            <input type="number" value={formData.prodShippingCost || ''} onChange={e => setFormData({...formData, prodShippingCost: e.target.value})} placeholder="0.00" className="flex-1 px-2 py-1.5 rounded border text-sm" />
                            <select value={formData.prodShippingCurr || 'USD'} onChange={e => setFormData({...formData, prodShippingCurr: e.target.value})} className="px-1 py-1 rounded border text-xs w-16"><option value="USD">USD</option><option value="EGP">EGP</option></select>
                          </div></div>
                        <div><label className="text-[9px] font-bold text-slate-500">Other Charges</label>
                          <div className="flex gap-1">
                            <input type="number" value={formData.prodOtherCost || ''} onChange={e => setFormData({...formData, prodOtherCost: e.target.value})} placeholder="0.00" className="flex-1 px-2 py-1.5 rounded border text-sm" />
                            <select value={formData.prodOtherCurr || 'EGP'} onChange={e => setFormData({...formData, prodOtherCurr: e.target.value})} className="px-1 py-1 rounded border text-xs w-16"><option value="USD">USD</option><option value="EGP">EGP</option></select>
                          </div></div>
                        <div><label className="text-[9px] font-bold text-slate-500">FX Rate (USD→EGP)</label>
                          <input type="number" value={formData.prodFxRate || 50} onChange={e => setFormData({...formData, prodFxRate: e.target.value})} step="0.01" className="w-full px-2 py-1.5 rounded border text-sm" /></div>
                      </>)}
                    </div>
                    <div className="flex gap-2 pt-2">
                      <button onClick={async () => {
                        try {
                          const origQty = Number(formData.prodOrigQty) || Number(formData.prodRolls) || 0;
                          const currQty = Number(formData.prodCurrQty) || origQty;
                          const costData = {
                            purchase_cost: Number(formData.prodPurchaseCost) || 0, purchase_currency: formData.prodPurchaseCurr || 'USD',
                            customs_cost: Number(formData.prodCustomsCost) || 0, customs_currency: formData.prodCustomsCurr || 'EGP',
                            shipping_cost: Number(formData.prodShippingCost) || 0, shipping_currency: formData.prodShippingCurr || 'USD',
                            other_cost: Number(formData.prodOtherCost) || 0, other_currency: formData.prodOtherCurr || 'EGP',
                            fx_rate: Number(formData.prodFxRate) || 50,
                          };
                          
                          // Check if product_id already exists — aggregate if so
                          const existingProduct = formData.prodId ? inventory.find(p => p.product_id === formData.prodId) : null;
                          
                          // Upload photo if selected
                          let photoUrl = '';
                          const fileInput = document.getElementById('prod-photo');
                          if (fileInput && fileInput.files && fileInput.files[0]) {
                            const file = fileInput.files[0];
                            const ext = file.name.split('.').pop();
                            const fileName = 'product-' + Date.now() + '.' + ext;
                            const { data: uploadData, error: uploadErr } = await supabase.storage.from('product-photos').upload(fileName, file);
                            if (!uploadErr && uploadData) {
                              const { data: urlData } = supabase.storage.from('product-photos').getPublicUrl(fileName);
                              photoUrl = urlData?.publicUrl || '';
                            }
                          }
                          
                          // Record inbound
                          await dbInsert('inventory_inbounds', {
                            product_id: formData.prodId || '',
                            reference_number: formData.prodShipment || '',
                            shipment_reference: formData.prodShipment || '',
                            inbound_date: formData.prodDate || today(),
                            quantity: origQty,
                            unit_price: Number(formData.prodPrice) || 0,
                            ...costData,
                            notes: formData.prodDescEn || formData.prodDesc || '',
                          }, userProfile?.id);
                          
                          if (existingProduct) {
                            // AGGREGATE: update existing product
                            const oldQty = Number(existingProduct.original_quantity || 0);
                            const oldCurr = Number(existingProduct.current_quantity || 0);
                            const newOrigQty = oldQty + origQty;
                            const newCurrQty = oldCurr + currQty;
                            // Weighted average costs
                            const toEgp = (amt, curr, fx) => curr === 'USD' ? amt * fx : amt;
                            const oldFx = Number(existingProduct.fx_rate) || 50;
                            const newFx = costData.fx_rate;
                            const oldTotal = toEgp(Number(existingProduct.purchase_cost)||0, existingProduct.purchase_currency, oldFx);
                            const newTotal = toEgp(costData.purchase_cost, costData.purchase_currency, newFx);
                            const avgPurchase = oldQty + origQty > 0 ? (oldTotal + newTotal) / 2 : 0;
                            const oldCustoms = toEgp(Number(existingProduct.customs_cost)||0, existingProduct.customs_currency, oldFx);
                            const newCustoms = toEgp(costData.customs_cost, costData.customs_currency, newFx);
                            const avgCustoms = oldQty + origQty > 0 ? (oldCustoms + newCustoms) / 2 : 0;
                            
                            await dbUpdate('inventory', existingProduct.id, {
                              original_quantity: newOrigQty,
                              current_quantity: newCurrQty,
                              purchase_cost: Math.round(avgPurchase * 100) / 100,
                              purchase_currency: 'EGP',
                              customs_cost: Math.round(avgCustoms * 100) / 100,
                              customs_currency: 'EGP',
                              shipping_cost: (Number(existingProduct.shipping_cost)||0) + costData.shipping_cost,
                              other_cost: (Number(existingProduct.other_cost)||0) + costData.other_cost,
                              fx_rate: newFx,
                              shipment_reference: (existingProduct.shipment_reference || '') + (formData.prodShipment ? ', ' + formData.prodShipment : ''),
                              ...(photoUrl ? { photo_url: photoUrl } : {}),
                            }, userProfile?.id);
                            alert('✅ Added ' + origQty + ' to existing product ' + formData.prodId + ' (now ' + newCurrQty + ' total)');
                          } else {
                            // NEW product
                            const record = {
                              product_id: formData.prodId || '', reference_number: formData.prodShipment || '',
                              shipment_reference: formData.prodShipment || '', product_type: formData.prodType || '',
                              subcategory: formData.prodSubcat || '',
                              description: formData.prodDesc || '', description_en: formData.prodDescEn || '',
                              color: formData.prodColor || '', color_en: formData.prodColorEn || '',
                              roll_count: Number(formData.prodRolls) || 0, gross_weight: Number(formData.prodGross) || 0,
                              net_weight: Number(formData.prodNet) || 0, unit_price: Number(formData.prodPrice) || 0,
                              original_quantity: origQty, current_quantity: currQty,
                              ...costData,
                              ...(photoUrl ? { photo_url: photoUrl } : {}),
                            };
                            await dbInsert('inventory', record, user?.id);
                          }
                          setFormData({});
                          await loadAllData();
                        } catch (err) { alert('Error: ' + err.message); }
                      }} className="flex-1 py-3 rounded-xl text-sm font-bold text-white"
                        style={{background:'linear-gradient(135deg, #10b981, #059669)'}}>
                        Save / حفظ
                      </button>
                      <button onClick={() => setFormData({})} className="px-5 py-3 rounded-xl text-sm border border-slate-200">Cancel</button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Product Detail Modal */}
            {formData.selectedProduct && (() => {
              const p = formData.selectedProduct;
              const origQty = Number(p.original_quantity || p.roll_count || 0);
              const currQty = Number(p.current_quantity || p.roll_count || 0);
              const usedPct = origQty > 0 ? Math.round(((origQty - currQty) / origQty) * 100) : 0;
              return (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center overflow-auto p-4" onClick={e => { if (e.target === e.currentTarget) setFormData({...formData, selectedProduct: null}); }}>
                  <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[600px] my-8 overflow-hidden">
                    {/* Photo header */}
                    {p.photo_url ? (
                      <div className="h-48 overflow-hidden relative">
                        <img src={p.photo_url} alt="" className="w-full h-full object-cover" />
                        <button onClick={() => setFormData({...formData, selectedProduct: null})}
                          className="absolute top-3 right-3 w-8 h-8 bg-black/50 rounded-full text-white flex items-center justify-center">✕</button>
                      </div>
                    ) : (
                      <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-5 py-4 flex justify-between items-center">
                        <h3 className="text-white font-bold">{p.reference_number || p.product_id}</h3>
                        <button onClick={() => setFormData({...formData, selectedProduct: null})} className="text-white/70 text-xl">✕</button>
                      </div>
                    )}
                    <div className="p-5 space-y-3">
                      {/* Upload photo for existing product */}
                      {!p.photo_url && (
                        <div className="flex gap-2 items-center">
                          <input type="file" accept="image/*" id="prod-photo-edit" className="text-xs flex-1" />
                          <button onClick={async () => {
                            const fi = document.getElementById('prod-photo-edit');
                            if (!fi?.files?.[0]) return;
                            const file = fi.files[0];
                            const fileName = 'product-' + Date.now() + '.' + file.name.split('.').pop();
                            const { data: ud, error: ue } = await supabase.storage.from('product-photos').upload(fileName, file);
                            if (!ue && ud) {
                              const { data: url } = supabase.storage.from('product-photos').getPublicUrl(fileName);
                              await dbUpdate('inventory', p.id, { photo_url: url?.publicUrl || '' }, user?.id);
                              setFormData({...formData, selectedProduct: {...p, photo_url: url?.publicUrl}});
                              await loadAllData();
                            } else { alert('Upload error: ' + (ue?.message || 'unknown')); }
                          }} className="px-3 py-1.5 bg-blue-500 text-white rounded text-xs font-bold">📷 Upload</button>
                        </div>
                      )}
                      {/* Category pills */}
                      <div className="flex gap-2 flex-wrap">
                        {p.product_type && <span className="px-2 py-1 bg-indigo-100 text-indigo-700 rounded-lg text-xs font-bold">{p.product_type}</span>}
                        {p.subcategory && <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded-lg text-xs font-bold">{p.subcategory}</span>}
                      </div>
                      <div>
                        <div className="text-lg font-bold">{p.reference_number || p.product_id}</div>
                        <div className="text-sm text-slate-600" style={{direction:'rtl'}}>{p.description}</div>
                        {p.description_en && <div className="text-sm text-blue-600">{p.description_en}</div>}
                        {p.color && <div className="text-xs text-slate-400 mt-1">🎨 {p.color}{p.color_en ? ' / ' + p.color_en : ''}</div>}
                      </div>
                      {/* Quantity tracking */}
                      <div className="bg-slate-50 rounded-xl p-4">
                        <div className="flex justify-between mb-2">
                          <div><div className="text-[9px] text-slate-400">Original</div><div className="text-lg font-bold text-blue-600">{origQty.toLocaleString()}</div></div>
                          <div className="text-center"><div className="text-[9px] text-slate-400">Used</div><div className="text-lg font-bold text-red-500">{(origQty - currQty).toLocaleString()}</div></div>
                          <div className="text-right"><div className="text-[9px] text-slate-400">Remaining</div><div className="text-lg font-bold text-emerald-600">{currQty.toLocaleString()}</div></div>
                        </div>
                        <div className="h-3 bg-slate-200 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{width: Math.max(3, 100 - usedPct) + '%', background: usedPct > 80 ? '#ef4444' : usedPct > 50 ? '#f59e0b' : '#10b981'}} />
                        </div>
                        <div className="text-[10px] text-slate-400 text-center mt-1">{usedPct}% used</div>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="bg-blue-50 rounded-lg p-2 text-center"><div className="text-[9px] text-slate-500">Rolls</div><div className="text-sm font-bold">{p.roll_count}</div></div>
                        <div className="bg-emerald-50 rounded-lg p-2 text-center"><div className="text-[9px] text-slate-500">Net Weight</div><div className="text-sm font-bold">{fmt(p.net_weight)} kg</div></div>
                        <div className="bg-purple-50 rounded-lg p-2 text-center"><div className="text-[9px] text-slate-500">Unit Price</div><div className="text-sm font-bold text-emerald-600">{fE(p.unit_price)}</div></div>
                      </div>
                      {/* Update current quantity */}
                      <div className="flex gap-2 items-center bg-amber-50 rounded-lg p-3">
                        <span className="text-xs font-bold text-amber-700">Update Qty:</span>
                        <input type="number" id="update-qty" defaultValue={currQty} className="flex-1 px-2 py-1.5 rounded border text-sm" />
                        <button onClick={async () => {
                          const val = Number(document.getElementById('update-qty')?.value);
                          if (isNaN(val)) return;
                          await dbUpdate('inventory', p.id, { current_quantity: val }, user?.id);
                          setFormData({...formData, selectedProduct: {...p, current_quantity: val}});
                          await loadAllData();
                        }} className="px-3 py-1.5 bg-amber-500 text-white rounded text-xs font-bold">Save</button>
                      </div>
                      {/* ===== COST & PROFIT (Super Admin / View Costs permission) ===== */}
                      {(userProfile?.role === 'super_admin' || modulePerms?.['View Costs'] === true) && (
                        <div className="bg-red-50/50 rounded-xl p-4 border border-red-200/50">
                          <h4 className="text-xs font-bold text-red-800 mb-2">🔒 Cost & Profit (Internal)</h4>
                          <div className="grid grid-cols-2 gap-2 mb-3">
                            <div>
                              <label className="text-[9px] font-bold text-slate-500">Purchase Cost</label>
                              <div className="flex gap-1">
                                <input type="number" id="cost-purchase" defaultValue={p.purchase_cost || ''} placeholder="0.00" className="flex-1 px-2 py-1.5 rounded border text-sm" />
                                <select id="cost-purchase-curr" defaultValue={p.purchase_currency || 'USD'} className="px-2 py-1.5 rounded border text-xs w-16">
                                  <option value="USD">USD</option><option value="EGP">EGP</option></select>
                              </div>
                            </div>
                            <div>
                              <label className="text-[9px] font-bold text-slate-500">Customs / Duties</label>
                              <div className="flex gap-1">
                                <input type="number" id="cost-customs" defaultValue={p.customs_cost || ''} placeholder="0.00" className="flex-1 px-2 py-1.5 rounded border text-sm" />
                                <select id="cost-customs-curr" defaultValue={p.customs_currency || 'EGP'} className="px-2 py-1.5 rounded border text-xs w-16">
                                  <option value="USD">USD</option><option value="EGP">EGP</option></select>
                              </div>
                            </div>
                            <div>
                              <label className="text-[9px] font-bold text-slate-500">Shipping & Freight</label>
                              <div className="flex gap-1">
                                <input type="number" id="cost-shipping" defaultValue={p.shipping_cost || ''} placeholder="0.00" className="flex-1 px-2 py-1.5 rounded border text-sm" />
                                <select id="cost-shipping-curr" defaultValue={p.shipping_currency || 'USD'} className="px-2 py-1.5 rounded border text-xs w-16">
                                  <option value="USD">USD</option><option value="EGP">EGP</option></select>
                              </div>
                            </div>
                            <div>
                              <label className="text-[9px] font-bold text-slate-500">Other Charges</label>
                              <div className="flex gap-1">
                                <input type="number" id="cost-other" defaultValue={p.other_cost || ''} placeholder="0.00" className="flex-1 px-2 py-1.5 rounded border text-sm" />
                                <select id="cost-other-curr" defaultValue={p.other_currency || 'EGP'} className="px-2 py-1.5 rounded border text-xs w-16">
                                  <option value="USD">USD</option><option value="EGP">EGP</option></select>
                              </div>
                            </div>
                            <div>
                              <label className="text-[9px] font-bold text-slate-500">FX Rate (USD→EGP)</label>
                              <input type="number" id="cost-fx" defaultValue={p.fx_rate || 50} step="0.01" className="w-full px-2 py-1.5 rounded border text-sm" />
                            </div>
                            <div>
                              <label className="text-[9px] font-bold text-slate-500">Sale Price (per unit)</label>
                              <div className="flex gap-1">
                                <input type="number" id="cost-sale" defaultValue={p.unit_price || ''} className="flex-1 px-2 py-1.5 rounded border text-sm bg-emerald-50" disabled />
                                <span className="px-2 py-1.5 text-xs text-slate-500">EGP</span>
                              </div>
                            </div>
                          </div>
                          <button onClick={async () => {
                            const costs = {
                              purchase_cost: Number(document.getElementById('cost-purchase')?.value) || 0,
                              purchase_currency: document.getElementById('cost-purchase-curr')?.value || 'USD',
                              customs_cost: Number(document.getElementById('cost-customs')?.value) || 0,
                              customs_currency: document.getElementById('cost-customs-curr')?.value || 'EGP',
                              shipping_cost: Number(document.getElementById('cost-shipping')?.value) || 0,
                              shipping_currency: document.getElementById('cost-shipping-curr')?.value || 'USD',
                              other_cost: Number(document.getElementById('cost-other')?.value) || 0,
                              other_currency: document.getElementById('cost-other-curr')?.value || 'EGP',
                              fx_rate: Number(document.getElementById('cost-fx')?.value) || 50,
                            };
                            try {
                              await dbUpdate('inventory', p.id, costs, user?.id);
                              setFormData({...formData, selectedProduct: {...p, ...costs}});
                              await loadAllData();
                            } catch (err) { alert('Error: ' + err.message); }
                          }} className="px-4 py-2 bg-red-600 text-white rounded-lg text-xs font-bold w-full mb-3">Save Costs</button>

                          {/* Profit Calculation */}
                          {(() => {
                            const fx = Number(p.fx_rate) || 50;
                            const toEGP = (amt, curr) => curr === 'USD' ? amt * fx : amt;
                            const toUSD = (amt, curr) => curr === 'EGP' ? amt / fx : amt;
                            const purchaseEGP = toEGP(Number(p.purchase_cost || 0), p.purchase_currency || 'USD');
                            const customsEGP = toEGP(Number(p.customs_cost || 0), p.customs_currency || 'EGP');
                            const shippingEGP = toEGP(Number(p.shipping_cost || 0), p.shipping_currency || 'USD');
                            const otherEGP = toEGP(Number(p.other_cost || 0), p.other_currency || 'EGP');
                            const totalCostEGP = purchaseEGP + customsEGP + shippingEGP + otherEGP;
                            const totalCostUSD = totalCostEGP / fx;
                            const salesEGP = Number(p.unit_price || 0) * origQty;
                            const linkedInvs = invoiceItems.filter(it => (it.description||'').includes(p.description)||(it.description||'').includes(p.reference_number));
                            const actualSalesEGP = linkedInvs.reduce((a, it) => a + Number(it.line_total || 0), 0);
                            const profitEGP = (actualSalesEGP || salesEGP) - totalCostEGP;
                            const profitUSD = profitEGP / fx;
                            const margin = (actualSalesEGP || salesEGP) > 0 ? (profitEGP / (actualSalesEGP || salesEGP) * 100).toFixed(1) : 0;
                            return (
                              <div className="bg-white rounded-lg p-3 border">
                                <div className="grid grid-cols-2 gap-2 mb-2">
                                  <div className="text-center"><div className="text-[9px] text-slate-400">Total Cost</div>
                                    <div className="text-sm font-bold text-red-600">{fE(totalCostEGP)}</div>
                                    <div className="text-[9px] text-slate-400">${totalCostUSD.toLocaleString(undefined,{maximumFractionDigits:2})} USD</div></div>
                                  <div className="text-center"><div className="text-[9px] text-slate-400">Revenue</div>
                                    <div className="text-sm font-bold text-blue-600">{fE(actualSalesEGP || salesEGP)}</div>
                                    <div className="text-[9px] text-slate-400">{actualSalesEGP > 0 ? 'From invoices' : 'Estimated'}</div></div>
                                </div>
                                <div className={'rounded-lg p-3 text-center ' + (profitEGP >= 0 ? 'bg-emerald-50' : 'bg-red-50')}>
                                  <div className="text-[9px] text-slate-400">Profit / الربح</div>
                                  <div className={'text-lg font-extrabold ' + (profitEGP >= 0 ? 'text-emerald-600' : 'text-red-600')}>{fE(profitEGP)}</div>
                                  <div className="text-xs text-slate-500">${profitUSD.toLocaleString(undefined,{maximumFractionDigits:2})} USD · {margin}% margin</div>
                                </div>
                                {/* Customs Cost/kg per Inbound Reference */}
                                {(() => {
                                  const shipRefs = [...new Set([p.shipment_reference, ...invInbounds.filter(ib => ib.product_id === p.product_id).map(ib => ib.shipment_reference)].filter(Boolean).flatMap(s => s.split(',').map(x => x.trim())).filter(Boolean))];
                                  if (shipRefs.length === 0) return null;
                                  return (
                                    <div className="mt-2 pt-2 border-t border-slate-200">
                                      <div className="text-[9px] font-bold text-slate-500 mb-1">Customs Cost/kg per Inbound Reference</div>
                                      {shipRefs.map(ref => {
                                        // All products with this shipment reference
                                        const prodsInShipment = inventory.filter(pr => (pr.shipment_reference || '').includes(ref));
                                        const inboundsInShipment = invInbounds.filter(ib => (ib.shipment_reference || '').includes(ref));
                                        // Total customs from inventory records
                                        const totalCustomsInv = prodsInShipment.reduce((a, pr) => {
                                          const f = Number(pr.fx_rate) || 50;
                                          return a + ((pr.customs_currency || 'EGP') === 'USD' ? Number(pr.customs_cost || 0) * f : Number(pr.customs_cost || 0));
                                        }, 0);
                                        // Total customs from inbounds
                                        const totalCustomsIb = inboundsInShipment.reduce((a, ib) => {
                                          const f = Number(ib.fx_rate) || 50;
                                          return a + ((ib.customs_currency || 'EGP') === 'USD' ? Number(ib.customs_cost || 0) * f : Number(ib.customs_cost || 0));
                                        }, 0);
                                        const totalCustoms = Math.max(totalCustomsInv, totalCustomsIb);
                                        // Total weight from products
                                        const totalKg = prodsInShipment.reduce((a, pr) => a + Number(pr.net_weight || pr.gross_weight || 0), 0);
                                        const costPerKg = totalKg > 0 ? totalCustoms / totalKg : 0;
                                        // This product's weight
                                        const thisKg = Number(p.net_weight || p.gross_weight || 0);
                                        const thisCustomsShare = thisKg > 0 ? costPerKg * thisKg : 0;
                                        return (
                                          <div key={ref} className="flex justify-between text-[10px] py-1 border-b border-slate-50">
                                            <span className="font-semibold text-blue-600">{ref}</span>
                                            <div className="flex gap-3 text-right">
                                              <span className="text-slate-500">{totalKg.toLocaleString()} kg</span>
                                              <span className="text-amber-600">Customs: {fE(totalCustoms)}</span>
                                              <span className="font-bold text-purple-600">{fE(costPerKg)}/kg</span>
                                              {thisKg > 0 && <span className="text-red-500">This: {fE(thisCustomsShare)}</span>}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  );
                                })()}
                                <div className="grid grid-cols-4 gap-1 mt-2 text-center">
                                  <div><div className="text-[8px] text-slate-400">Purchase</div><div className="text-[10px] font-bold">{fE(purchaseEGP)}</div></div>
                                  <div><div className="text-[8px] text-slate-400">Customs</div><div className="text-[10px] font-bold">{fE(customsEGP)}</div></div>
                                  <div><div className="text-[8px] text-slate-400">Shipping</div><div className="text-[10px] font-bold">{fE(shippingEGP)}</div></div>
                                  <div><div className="text-[8px] text-slate-400">Other</div><div className="text-[10px] font-bold">{fE(otherEGP)}</div></div>
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      )}
                      {/* Linked Invoices */}
                      <h4 className="text-xs font-bold">Linked Invoices</h4>
                      <div className="overflow-auto max-h-[200px] rounded border border-slate-200">
                        {invoiceItems.filter(it => (it.description||'').includes(p.description)||(it.description||'').includes(p.reference_number)).length > 0 ? (
                          <table className="w-full border-collapse">
                            <thead><tr className="bg-slate-50">
                              <th className="px-2 py-1 text-[10px] text-left">Invoice</th>
                              <th className="px-2 py-1 text-[10px] text-right">Qty</th>
                              <th className="px-2 py-1 text-[10px] text-right">Price</th>
                              <th className="px-2 py-1 text-[10px] text-right">Total</th>
                            </tr></thead>
                            <tbody>
                              {invoiceItems.filter(it => (it.description||'').includes(p.description)||(it.description||'').includes(p.reference_number)).map(it => {
                                const inv = invoices.find(i => i.id === it.invoice_id);
                                return (
                                  <tr key={it.id} className="border-b border-slate-50 cursor-pointer hover:bg-blue-50"
                                    onClick={() => { if (inv) { setFormData({...formData, selectedProduct: null}); setSelectedInvoice(inv); } }}>
                                    <td className="px-2 py-1 text-xs font-semibold">{inv ? '#'+inv.order_number : '—'}</td>
                                    <td className="px-2 py-1 text-xs text-right">{fmt(it.quantity)}</td>
                                    <td className="px-2 py-1 text-xs text-right">{fmt(it.unit_price)}</td>
                                    <td className="px-2 py-1 text-xs text-right font-semibold">{fE(it.line_total)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        ) : (<div className="px-3 py-4 text-xs text-slate-400 text-center">No linked invoices</div>)}
                      </div>
                      
                      {/* Inbound History */}
                      {(() => {
                        const inbounds = invInbounds.filter(ib => ib.product_id === p.product_id);
                        if (inbounds.length === 0) return null;
                        return (
                          <div className="mt-3 pt-3 border-t border-slate-200">
                            <h4 className="text-xs font-bold mb-2">📥 Inbound History ({inbounds.length})</h4>
                            <div className="overflow-auto max-h-[200px] rounded border border-slate-200">
                              <table className="w-full border-collapse text-[10px]">
                                <thead className="sticky top-0"><tr className="bg-slate-50">
                                  <th className="px-2 py-1 text-left">Date</th>
                                  <th className="px-2 py-1 text-left">Shipment</th>
                                  <th className="px-2 py-1 text-right">Qty</th>
                                  <th className="px-2 py-1 text-right">Purchase</th>
                                  <th className="px-2 py-1 text-right">Customs</th>
                                  <th className="px-2 py-1 text-right">Customs/kg</th>
                                  <th className="px-2 py-1 text-right">Total Cost</th>
                                </tr></thead>
                                <tbody>
                                  {inbounds.sort((a,b) => (b.inbound_date||'').localeCompare(a.inbound_date||'')).map(ib => {
                                    const fx = Number(ib.fx_rate) || 50;
                                    const toEgp = (amt, curr) => curr === 'USD' ? amt * fx : amt;
                                    const total = toEgp(Number(ib.purchase_cost)||0, ib.purchase_currency) + toEgp(Number(ib.customs_cost)||0, ib.customs_currency) + toEgp(Number(ib.shipping_cost)||0, ib.shipping_currency) + toEgp(Number(ib.other_cost)||0, ib.other_currency);
                                    return (
                                      <tr key={ib.id} className="border-b border-slate-50">
                                        <td className="px-2 py-1">{ib.inbound_date}</td>
                                        <td className="px-2 py-1 text-blue-600 font-semibold">{ib.shipment_reference || '—'}</td>
                                        <td className="px-2 py-1 text-right font-bold">{fmt(ib.quantity)}</td>
                                        <td className="px-2 py-1 text-right">{fE(toEgp(Number(ib.purchase_cost)||0, ib.purchase_currency))}</td>
                                        <td className="px-2 py-1 text-right">{fE(toEgp(Number(ib.customs_cost)||0, ib.customs_currency))}</td>
                                        <td className="px-2 py-1 text-right text-purple-600 font-semibold">{(() => {
                                          const shipRef = ib.shipment_reference;
                                          if (!shipRef) return '—';
                                          const prodsInShip = inventory.filter(pr => (pr.shipment_reference || '').includes(shipRef));
                                          const totalKg = prodsInShip.reduce((a, pr) => a + Number(pr.net_weight || pr.gross_weight || 0), 0);
                                          const ibsInShip = invInbounds.filter(i2 => (i2.shipment_reference || '').includes(shipRef));
                                          const totalCustoms = ibsInShip.reduce((a, i2) => { const f2 = Number(i2.fx_rate)||50; return a + ((i2.customs_currency||'EGP')==='USD'?Number(i2.customs_cost||0)*f2:Number(i2.customs_cost||0)); }, 0);
                                          return totalKg > 0 ? fE(totalCustoms / totalKg) + '/kg' : '—';
                                        })()}</td>
                                        <td className="px-2 py-1 text-right font-bold text-red-600">{fE(total)}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        );
                      })()}
                      
                      {/* P&L Summary */}
                      {(userProfile?.role === 'super_admin' || modulePerms?.['View Costs'] === true) && (() => {
                        const fx = Number(p.fx_rate) || 50;
                        const toEgp = (amt, curr) => curr === 'USD' ? amt * fx : amt;
                        const totalCost = toEgp(Number(p.purchase_cost)||0, p.purchase_currency) + toEgp(Number(p.customs_cost)||0, p.customs_currency) + toEgp(Number(p.shipping_cost)||0, p.shipping_currency) + toEgp(Number(p.other_cost)||0, p.other_currency);
                        const linkedItems = invoiceItems.filter(it => it.product_id === p.id);
                        const totalRevenue = linkedItems.reduce((a, it) => a + Number(it.line_total || 0), 0);
                        const profit = totalRevenue - totalCost;
                        const margin = totalRevenue > 0 ? Math.round((profit / totalRevenue) * 100) : 0;
                        const inbounds = invInbounds.filter(ib => ib.product_id === p.product_id);
                        const shipments = [...new Set([p.shipment_reference, ...inbounds.map(ib => ib.shipment_reference)].filter(Boolean).flatMap(s => s.split(',').map(x => x.trim())).filter(Boolean))];
                        
                        return (
                          <div className="mt-3 pt-3 border-t border-red-200">
                            <h4 className="text-xs font-bold text-red-700 mb-2">📊 P&L Summary</h4>
                            <div className="grid grid-cols-4 gap-2 mb-2">
                              <div className="bg-red-50 rounded p-2 text-center">
                                <div className="text-[8px] text-red-500">Total Cost</div>
                                <div className="text-xs font-extrabold text-red-600">{fE(totalCost)}</div>
                              </div>
                              <div className="bg-blue-50 rounded p-2 text-center">
                                <div className="text-[8px] text-blue-500">Revenue</div>
                                <div className="text-xs font-extrabold text-blue-600">{fE(totalRevenue)}</div>
                              </div>
                              <div className={'rounded p-2 text-center ' + (profit >= 0 ? 'bg-emerald-50' : 'bg-red-50')}>
                                <div className="text-[8px] text-slate-500">Profit</div>
                                <div className={'text-xs font-extrabold ' + (profit >= 0 ? 'text-emerald-600' : 'text-red-600')}>{fE(profit)}</div>
                              </div>
                              <div className={'rounded p-2 text-center ' + (margin >= 0 ? 'bg-emerald-50' : 'bg-red-50')}>
                                <div className="text-[8px] text-slate-500">Margin</div>
                                <div className={'text-xs font-extrabold ' + (margin >= 0 ? 'text-emerald-600' : 'text-red-600')}>{margin}%</div>
                              </div>
                            </div>
                            {shipments.length > 0 && (
                              <div>
                                <h5 className="text-[10px] font-bold text-slate-500 mb-1">Per Shipment</h5>
                                {shipments.map(ship => {
                                  const ibsForShip = inbounds.filter(ib => (ib.shipment_reference || '').includes(ship));
                                  const shipCost = ibsForShip.reduce((a, ib) => {
                                    const f = Number(ib.fx_rate) || 50;
                                    const te = (amt, c) => c === 'USD' ? amt * f : amt;
                                    return a + te(Number(ib.purchase_cost)||0, ib.purchase_currency) + te(Number(ib.customs_cost)||0, ib.customs_currency) + te(Number(ib.shipping_cost)||0, ib.shipping_currency) + te(Number(ib.other_cost)||0, ib.other_currency);
                                  }, 0);
                                  const shipRevItems = linkedItems.filter(it => {
                                    const inv = invoices.find(i => i.id === it.invoice_id);
                                    return inv && (inv.order_number || '').includes(ship);
                                  });
                                  const shipRev = shipRevItems.reduce((a, it) => a + Number(it.line_total || 0), 0);
                                  const shipProfit = shipRev - shipCost;
                                  return (
                                    <div key={ship} className="flex justify-between text-[10px] py-0.5 border-b border-slate-50">
                                      <span className="font-semibold text-blue-600">{ship}</span>
                                      <div className="flex gap-3">
                                        <span className="text-red-500">Cost: {fE(shipCost)}</span>
                                        <span className="text-blue-500">Rev: {fE(shipRev)}</span>
                                        <span className={shipProfit >= 0 ? 'text-emerald-600 font-bold' : 'text-red-600 font-bold'}>{fE(shipProfit)}</span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* ==========================================
            CRM TAB
        ========================================== */}
        {tab === 'crm' && (
          <CRMTab customers={customers} invoices={invoices} user={user} userProfile={userProfile} users={teamUsers} onReload={loadAllData} isAdmin={isAdmin} onSelectInvoice={setSelectedInvoice} lang={lang} modulePerms={modulePerms} />
        )}

        {/* ==========================================
            TICKETS TAB
        ========================================== */}
        {tab === 'tickets' && (
          <TicketsTab customers={customers} user={user} userProfile={userProfile} users={teamUsers} onReload={loadAllData} lang={lang} isAdmin={isAdmin} modulePerms={modulePerms} />
        )}

        {/* ==========================================
            CALENDAR TAB
        ========================================== */}
        {tab === 'calendar' && (
          <CalendarTab customers={customers} user={user} userProfile={userProfile} users={teamUsers} onReload={loadAllData} />
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
          <ShippingRatesTab user={user} userProfile={userProfile} isAdmin={isAdmin} customers={customers} />
        )}

        {tab === 'bank' && (
          <BankTab user={user} supabase={supabase} />
        )}

        {tab === 'quotes' && (
          <QuotesTab user={user} userProfile={userProfile} isAdmin={isAdmin} />
        )}

        {/* ==========================================
            DAILY LOG TAB
        ========================================== */}
        {tab === 'dailylog' && (
          <DailyLogTab user={user} userProfile={userProfile} users={teamUsers} isAdmin={isAdmin} />
        )}

        {/* ==========================================
            ADMIN TAB
        ========================================== */}
        {tab === 'admin' && (
          <AdminTab user={user} userProfile={userProfile} users={teamUsers} isAdmin={isAdmin} customers={customers} />
        )}

        {/* ==========================================
            AI ASSISTANT TAB
        ========================================== */}
        {tab === 'ai' && (
          <AIAssistant user={user} userProfile={userProfile} users={teamUsers} customers={customers} />
        )}

        {tab === 'comms' && (
          <CommunicationsTab user={user} supabase={supabase} />
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
