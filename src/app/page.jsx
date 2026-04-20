'use client';
import React, { useState, useEffect, useMemo, useCallback, useRef, useContext, createContext } from 'react';
import { supabase, dbInsert, dbUpdate, dbDelete } from '../lib/supabase';
import { fmt, fE, COLORS, EXPENSE_CATS, getReconStatus, STATUS_STYLES, today, inRange, monthOf, getWarehouseCat, sanitize } from '../lib/utils';
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
import AIGreeter, { PERSONALITIES } from '../components/AIGreeter';
import ShippingRatesTab from '../components/ShippingRatesTab';
import ErrorBoundary, { SafeSection } from '../components/ErrorBoundary';
import { DashboardSkeleton, TableSkeleton, CardGridSkeleton } from '../components/LoadingSkeleton';
import NotificationBell from '../components/NotificationBell';
import BankTab from '../components/BankTab';
import QuotesTab from '../components/QuotesTab';
import EgyptBankTab from '../components/EgyptBankTab';
import PhoneWidget from '../components/PhoneWidget';
import ReportsTab from '../components/ReportsTab';
import TreasuryInspectorModal from '../components/TreasuryInspectorModal';
import AccountingAuditorModal from '../components/AccountingAuditorModal';

// Toast notification system — replaces alert() across entire app
const ToastContext = React.createContext();
const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const addToast = useCallback((message, type = 'success', duration = 3500) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration);
  }, []);
  const toast = useMemo(() => ({
    success: (msg) => addToast(msg, 'success'),
    error: (msg) => addToast(msg, 'error', 5000),
    info: (msg) => addToast(msg, 'info'),
    warning: (msg) => addToast(msg, 'warning', 4500),
  }), [addToast]);
  const confirmFn = useCallback((opts) => {
    return new Promise((resolve) => {
      setConfirmState({ ...opts, resolve });
    });
  }, []);
  const handleConfirm = () => { if (confirmState?.resolve) confirmState.resolve(true); setConfirmState(null); };
  const handleCancel = () => { if (confirmState?.resolve) confirmState.resolve(false); setConfirmState(null); };
  const ctx = useMemo(() => ({ ...toast, confirm: confirmFn }), [toast, confirmFn]);
  return (
    <ToastContext.Provider value={ctx}>
      {children}
      <div className="fixed top-16 right-4 z-[300] flex flex-col gap-2 max-w-sm">
        {toasts.map(t => (
          <div key={t.id} className={'px-4 py-3 rounded-xl shadow-2xl border text-sm font-medium flex items-center gap-2 animate-[slideIn_0.2s_ease] ' + ({
            success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
            error: 'bg-red-50 border-red-200 text-red-800',
            info: 'bg-blue-50 border-blue-200 text-blue-800',
            warning: 'bg-amber-50 border-amber-200 text-amber-800',
          }[t.type] || 'bg-white border-slate-200 text-slate-800')}>
            <span>{t.type === 'success' ? '✅' : t.type === 'error' ? '❌' : t.type === 'warning' ? '⚠️' : 'ℹ️'}</span>
            <span className="flex-1">{t.message}</span>
            <button onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))} className="text-lg opacity-40 hover:opacity-100">×</button>
          </div>
        ))}
      </div>
      <ConfirmModal open={!!confirmState} title={confirmState?.title} message={confirmState?.message}
        confirmText={confirmState?.confirmText} cancelText={confirmState?.cancelText} danger={confirmState?.danger}
        onConfirm={handleConfirm} onCancel={handleCancel} />
    </ToastContext.Provider>
  );
};

// Confirmation modal — replaces confirm()
const ConfirmModal = ({ open, title, message, confirmText, cancelText, danger, onConfirm, onCancel }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/50 z-[250] flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-2">{title || 'Confirm'}</h3>
        <p className="text-sm text-slate-600 mb-5">{message}</p>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-semibold hover:bg-slate-50">{cancelText || 'Cancel'}</button>
          <button onClick={onConfirm} className={'px-4 py-2 rounded-lg text-sm font-bold text-white ' + (danger ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-500 hover:bg-blue-600')}>{confirmText || 'Confirm'}</button>
        </div>
      </div>
    </div>
  );
};

// Modal must be outside main component to prevent re-mounting on every render
const Modal = ({ onClose, title, children }) => (
  <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-3" onClick={onClose} role="dialog" aria-modal="true" aria-label={title || 'Dialog'}>
    <div className="bg-white rounded-2xl p-6 max-w-2xl w-full max-h-[85vh] overflow-auto" onClick={e => e.stopPropagation()}>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-bold">{title}</h3>
        <button onClick={onClose} className="text-2xl text-slate-400 hover:text-slate-600" aria-label="Close dialog">×</button>
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
  { id: 'egyptbank', label: 'Egypt Bank / بنوك مصر', icon: '🇪🇬' },
  { id: 'bank', label: 'Bank / البنك', icon: '🏛️' },
  { id: 'checks', label: 'Checks / شيكات', icon: '📝' },
  { id: 'debts', label: 'Debts / المديونية', icon: '⚠️' },
  { id: 'reports', label: 'Reports / تقارير', icon: '📊' },
  { id: 'warehouse', label: 'Warehouse / المخزن', icon: '🏭' },
  { id: 'inventory', label: 'Inventory / المخزون', icon: '📦' },
  { id: 'customs', label: 'Customs / جمارك', icon: '🚢' },
  { id: 'shipping', label: 'Shipping Rates / شحن', icon: '🛳️' },
  { id: 'crm', label: 'CRM', icon: '🤝' },
  { id: 'tickets', label: 'Tickets / تذاكر', icon: '🎫' },
  { id: 'systemtickets', label: 'System Tickets / نظام', icon: '🐛' },
  { id: 'comms', label: 'Communications / رسائل', icon: '📬' },
  { id: 'calendar', label: 'Calendar / تقويم', icon: '📅' },
  { id: 'dailylog', label: 'Daily Log / يومي', icon: '📓' },
  { id: 'admin', label: 'Admin / إدارة', icon: '👑' },
  { id: 'ai', label: 'AI Assistant / ذكي', icon: '🤖' },
  { id: 'settings', label: 'Settings / إعدادات', icon: '⚙️' },
  { id: 'import', label: 'Import / استيراد', icon: '📥' },
];

// ============================================
// NON-ORDER BANK EVENT CATEGORIES
// Bank transactions that are not tied to a sales invoice still need a
// declared identity (Owner Draw, Transfer, Fee, etc.). They write to
// bank_in/bank_out and never touch safe cash_in/cash_out.
// ============================================
const BANK_NONORDER_CATS = [
  { v: 'Owner Draw',         en: 'Owner Draw',         ar: 'سحب صاحب' },
  { v: 'Inter-Bank Transfer', en: 'Inter-Bank Transfer', ar: 'تحويل بين البنوك' },
  { v: 'Bank Fee',           en: 'Bank Fee',           ar: 'رسوم بنكية' },
  { v: 'Loan',               en: 'Loan',               ar: 'قرض' },
  { v: 'Refund',             en: 'Refund',             ar: 'استرداد' },
  { v: 'Other',              en: 'Other',              ar: 'أخرى' },
];

// ============================================
// DATE PICKER WITH YEAR/MONTH/DAY DROPDOWNS (mobile-friendly)
// ============================================
function DatePickerSelect({ value, onChange, className }) {
  const d = value ? new Date(value + 'T00:00:00') : new Date();
  const yr = d.getFullYear(), mo = d.getMonth() + 1, dy = d.getDate();
  const curYear = new Date().getFullYear();
  const years = [];
  for (let y = curYear + 1; y >= 2014; y--) years.push(y);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const daysInMonth = new Date(yr, mo, 0).getDate();
  const days = [];
  for (let dd = 1; dd <= daysInMonth; dd++) days.push(dd);
  const emit = (y, m, day) => {
    const maxD = new Date(y, m, 0).getDate();
    const safeD = Math.min(day, maxD);
    const val = y + '-' + String(m).padStart(2,'0') + '-' + String(safeD).padStart(2,'0');
    onChange(val);
  };
  return (
    <div className={'flex gap-1 ' + (className || '')}>
      <select value={yr} onChange={e => emit(Number(e.target.value), mo, dy)}
        className="flex-1 px-1.5 py-2 rounded-lg border border-slate-200 text-sm font-semibold bg-white">
        {years.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
      <select value={mo} onChange={e => emit(yr, Number(e.target.value), dy)}
        className="flex-1 px-1.5 py-2 rounded-lg border border-slate-200 text-sm bg-white">
        {months.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
      </select>
      <select value={dy} onChange={e => emit(yr, mo, Number(e.target.value))}
        className="w-16 px-1.5 py-2 rounded-lg border border-slate-200 text-sm bg-white">
        {days.map(d => <option key={d} value={d}>{d}</option>)}
      </select>
    </div>
  );
}

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
          <DatePickerSelect value={pf.date} onChange={v => setPf({ ...pf, date: v })} />
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
            { v: 'cash',          l: '💵 Cash',                sub: 'Adds to safe (cash)' },
            { v: 'vodafone',      l: '📱 Vodafone Cash',       sub: 'Adds to safe (cash)' },
            { v: 'instapay',      l: '⚡ InstaPay',            sub: 'Adds to safe (cash)' },
            { v: 'bank_transfer', l: '🏦 Bank Transfer',       sub: 'Bank channel (not safe)' },
            { v: 'check',         l: '📝 Post-dated Check',    sub: 'Goes to Checks (pending)' },
            { v: 'other',         l: '📋 Other',               sub: 'Invoice only' },
          ].map(m => (
            <label key={m.v} onClick={() => setPf({ ...pf, payMethod: m.v })}
              className={'flex items-center gap-2 px-3 py-2 rounded-lg border-2 cursor-pointer transition text-xs ' +
                (pf.payMethod === m.v ? 'bg-blue-100 border-blue-400 font-bold text-blue-700' : 'bg-white border-slate-200 text-slate-600 hover:border-blue-200')}>
              <input type="radio" name="payMethod" checked={pf.payMethod === m.v} onChange={() => {}} className="w-3.5 h-3.5" />
              <div><div>{m.l}</div><div className="text-[9px] font-normal text-slate-400">{m.sub}</div></div>
            </label>
          ))}
        </div>
        {pf.payMethod === 'check' && (
          <div className="mt-2 bg-amber-50 rounded-lg p-3 border border-amber-200">
            <div className="text-[10px] text-amber-700 font-bold mb-2">📝 Post-dated check — NOT added to treasury until collected</div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[9px] font-bold text-slate-500">Due Date / تاريخ الاستحقاق</label>
                <DatePickerSelect value={pf.checkDueDate || ''} onChange={v => setPf({...pf, checkDueDate: v})} />
              </div>
              <div>
                <label className="text-[9px] font-bold text-slate-500">Check # / رقم الشيك</label>
                <input value={pf.checkNumber || ''} onChange={e => setPf({...pf, checkNumber: e.target.value})}
                  className="w-full px-2 py-2 rounded border text-xs" placeholder="Optional" />
              </div>
              <div className="col-span-2">
                <label className="text-[9px] font-bold text-slate-500">Bank / البنك</label>
                <input value={pf.checkBank || ''} onChange={e => setPf({...pf, checkBank: e.target.value})}
                  className="w-full px-2 py-2 rounded border text-xs" placeholder="Issuing bank name..." />
              </div>
            </div>
          </div>
        )}
        {(pf.payMethod === 'bank_transfer' || pf.payMethod === 'other') && (
          <div className="text-[10px] text-indigo-700 mt-1 bg-indigo-50 p-1.5 rounded border border-indigo-200">
            ℹ️ <b>{pf.payMethod === 'bank_transfer' ? 'Bank Transfer' : 'Other'}</b> — updates invoice collected via the bank channel. Does <b>NOT</b> affect safe balance.
          </div>
        )}
        {(pf.payMethod === 'vodafone' || pf.payMethod === 'instapay') && (
          <div className="text-[10px] text-emerald-700 mt-1 bg-emerald-50 p-1.5 rounded border border-emerald-200">
            ℹ️ <b>{pf.payMethod === 'vodafone' ? 'Vodafone Cash' : 'InstaPay'}</b> auto-sweeps to the physical safe, so it counts as <b>cash in</b> (affects safe + invoice collected). Tagged for reconciliation.
          </div>
        )}
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
  const [mode, setMode] = useState('ytd');
  const [df, setDf] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().substring(0, 10); });
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
  const profileIdRef = useRef(null);
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
  const [checkSort, setCheckSort] = useState('date'); // date | customer | order
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
  const [invoiceSort, setInvoiceSort] = useState('newest'); // newest | oldest
  const [treasurySort, setTreasurySort] = useState('newest'); // newest | oldest
  const [treasuryVisible, setTreasuryVisible] = useState(50);
  const [invoiceVisible, setInvoiceVisible] = useState(50);

  // Forms
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [showAddInvoice, setShowAddInvoice] = useState(false);
  const [showAddTreasury, setShowAddTreasury] = useState(false);
  const [editingTxn, setEditingTxn] = useState(null);
  const [splittingTxn, setSplittingTxn] = useState(null);
  const [splits, setSplits] = useState([{ order: '', amount: 0 }, { order: '', amount: 0 }]);
  const [linkSearch, setLinkSearch] = useState('');
  const [showLinkSearch, setShowLinkSearch] = useState(false);
  const [linkingTreasuryTxn, setLinkingTreasuryTxn] = useState(null);
  const [treasuryInvSearch, setTreasuryInvSearch] = useState('');
  const [editTreasuryModal, setEditTreasuryModal] = useState(null);
  const [inspectedTreasury, setInspectedTreasury] = useState(null);
  const [showAccountantReview, setShowAccountantReview] = useState(false);
  // Treasury ↔ Sales navigation return state
  const [treasuryReturnState, setTreasuryReturnState] = useState(null);
  // Mini-modal for "order# doesn't exist, create now?" flow
  const [pendingTreasuryRecord, setPendingTreasuryRecord] = useState(null);
  const [formData, setFormData] = useState({});
  const [hideSections, setHideSections] = useState({});
  const [announcements, setAnnouncements] = useState([]);
  const [announcementAcks, setAnnouncementAcks] = useState([]);
  const [showAddAnnouncement, setShowAddAnnouncement] = useState(false);
  const annAlarmRef = useRef(null);

  // Reusable alarm sound function
  const playAlarmSound = async (isUrgent) => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') await ctx.resume();
      const playTone = (freq, start, dur) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = freq; osc.type = 'square';
        gain.gain.setValueAtTime(0.4, ctx.currentTime + start);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + start + dur);
        osc.start(ctx.currentTime + start); osc.stop(ctx.currentTime + start + dur);
      };
      if (isUrgent) {
        for (let i = 0; i < 12; i++) { playTone(900 + (i % 2) * 500, i * 0.4, 0.35); }
      } else {
        for (let i = 0; i < 6; i++) { playTone(700, i * 0.7, 0.25); playTone(900, i * 0.7 + 0.25, 0.25); }
      }
    } catch(e) { console.warn('Alarm error:', e); }
  };
  const [reminders, setReminders] = useState([]);
  const [recentTicketUpdates, setRecentTicketUpdates] = useState([]);
  const [dashTickets, setDashTickets] = useState([]);
  const [activityFeed, setActivityFeed] = useState([]);
  const [dashEvents, setDashEvents] = useState([]);
  const [dashFollowUps, setDashFollowUps] = useState([]);
  const [fxRate, setFxRate] = useState(null);
  const [globalSearch, setGlobalSearch] = useState('');
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);
  const [showNotifBell, setShowNotifBell] = useState(false);
  const [showFAB, setShowFAB] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  const [lastLoginInfo, setLastLoginInfo] = useState(null);
  const [tabLoading, setTabLoading] = useState(false);
  const [greeterDismissed, setGreeterDismissed] = useState(false);
  const [greeterHasGreeted, setGreeterHasGreeted] = useState(false);
  const [greeterMessages, setGreeterMessages] = useState([]);
  const [greeterSettings, setGreeterSettings] = useState({ personality: 'friendly', language: 'en', enabled: true });
  const [lastLoaded, setLastLoaded] = useState(null);
  const [openTicketId, setOpenTicketId] = useState(null);
  const [egyptBankTxns, setEgyptBankTxns] = useState([]);
  const [egyptBankAccounts, setEgyptBankAccounts] = useState([]);
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
      } catch(e) { console.warn('Silent error:', e.message || e); }
    }
  }, [reminders, userProfile]);
  
  // Poll for new reminders every 60 seconds
  useEffect(() => {
    const pollReminders = setInterval(async () => {
      try {
        const { data: rems } = await supabase.from('team_reminders').select('*').or('completed.is.null,completed.eq.false').order('created_at', { ascending: false }).limit(50);
        if (rems) setReminders(rems);
      } catch(e) { console.warn('Silent error:', e.message || e); }
    }, 60000);
    return () => clearInterval(pollReminders);
  }, []);

  // Announcement alarm for unacknowledged messages — plays on new AND replays every poll
  useEffect(() => {
    if (!announcements.length || !userProfile) return;
    const myId = userProfile?.id;
    const active = announcements.filter(a => a.active !== false && (!a.target_user || a.target_user === myId));
    const myAcks = new Set(announcementAcks.filter(a => a.user_id === myId).map(a => a.announcement_id));
    const unacked = active.filter(a => !myAcks.has(a.id));
    if (unacked.length > 0) {
      const hasUrgent = unacked.some(a => a.priority === 'urgent');
      playAlarmSound(hasUrgent);
    }
  }, [announcements, announcementAcks, userProfile]);

  // Poll announcements every 60 seconds
  useEffect(() => {
    const pollAnn = setInterval(async () => {
      try {
        const { data: ann } = await supabase.from('announcements').select('*').order('created_at', { ascending: false }).limit(20);
        if (ann) setAnnouncements(ann);
        const { data: acks } = await supabase.from('announcement_acks').select('*');
        if (acks) setAnnouncementAcks(acks);
      } catch(e) { console.warn('Silent error:', e.message || e); }
    }, 60000);
    return () => clearInterval(pollAnn);
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
        const uid = profileIdRef.current || s.user.id;
        await supabase.from('user_sessions')
          .update({ last_seen: new Date().toISOString() })
          .eq('user_id', uid)
          .eq('date', today)
          .order('login_at', { ascending: false })
          .limit(1);
      }
    }, 5 * 60 * 1000);

    // Keyboard shortcuts
    const handleKey = (e) => {
      // ⌘K / Ctrl+K: Global search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setShowGlobalSearch(true); return; }
      // Escape: Close modals
      if (e.key === 'Escape') { setShowGlobalSearch(false); setShowNotifBell(false); setShowFAB(false); setSidebarOpen(false); return; }
      // Don't trigger shortcuts when typing in inputs
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || e.target.isContentEditable) return;
      // Alt + key: Navigate tabs
      if (e.altKey) {
        const altMap = { d: 'dashboard', s: 'sales', t: 'treasury', c: 'crm', k: 'tickets', a: 'admin', i: 'inventory', w: 'warehouse', e: 'egyptbank', l: 'calendar' };
        if (altMap[e.key]) { e.preventDefault(); navigate(altMap[e.key]); return; }
        // Alt+N: New (open FAB)
        if (e.key === 'n') { e.preventDefault(); setShowFAB(true); return; }
        // Alt+R: Refresh data
        if (e.key === 'r') { e.preventDefault(); loadAllData(); if (toast) toast.info('Refreshing data...'); return; }
      }
    };
    window.addEventListener('keydown', handleKey);
    const handleClickOutside = (e) => { if (!e.target.closest('.notif-bell-wrap')) setShowNotifBell(false); if (!e.target.closest('.fab-wrap')) setShowFAB(false); };
    document.addEventListener('click', handleClickOutside);

    // Session timeout: auto-logout after 30 min of inactivity (except super_admin)
    let idleTimer;
    const IDLE_TIMEOUT = 30 * 60 * 1000;
    const resetIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(async () => {
        try {
          const { data: { session: s } } = await supabase.auth.getSession();
          if (!s?.user) return;
          const { data: profile } = await supabase.from('users').select('role').eq('email', s.user.email).single();
          if (profile?.role === 'super_admin') return; // super admins stay logged in
          // Record auto-logout in session
          const today = new Date().toISOString().split('T')[0];
          const uid = profileIdRef.current || s.user.id;
          await supabase.from('user_sessions')
            .update({ logout_at: new Date().toISOString(), logout_reason: 'auto_timeout' })
            .eq('user_id', uid).eq('date', today)
            .order('login_at', { ascending: false }).limit(1);
          // Log it
          try { await supabase.from('daily_log').insert({ user_id: uid, entry_text: 'Auto-logged out after 30 min inactivity', log_category: 'login', log_date: today, log_time: new Date().toTimeString().substring(0,8), auto_generated: true }); } catch(e) { console.warn('Silent error:', e.message || e); }
          await supabase.auth.signOut(); window.location.href = '/login';
        } catch(e) { console.warn('Silent error:', e.message || e); }
      }, IDLE_TIMEOUT);
    };
    ['mousedown', 'keydown', 'touchstart', 'scroll'].forEach(evt => window.addEventListener(evt, resetIdle, { passive: true }));
    resetIdle();

    // Record last_seen on page close
    const handleUnload = () => {
      const uid = profileIdRef.current || user?.id;
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

    return () => { subscription?.unsubscribe(); clearInterval(heartbeat); clearTimeout(idleTimer); ['mousedown','keydown','touchstart','scroll'].forEach(evt => window.removeEventListener(evt, resetIdle)); window.removeEventListener('beforeunload', handleUnload); window.removeEventListener('keydown', handleKey); document.removeEventListener('click', handleClickOutside); };
  }, []);

  // ==========================================
  // DATA LOADING
  // ==========================================
  const fetchAll = async (table, orderCol, asc = false) => {
    let all = [];
    let from = 0;
    const batch = 1000;
    while (true) {
      const { data } = await supabase.from(table).select('*').order(orderCol, { ascending: asc }).order('id', { ascending: true }).range(from, from + batch - 1);
      if (!data || data.length === 0) break;
      all = all.concat(data);
      if (data.length < batch) break;
      from += batch;
    }
    return all;
  };

  const loadingRef = useRef(false);
  const loadAllData = async () => {
    if (loadingRef.current) return; // Prevent concurrent loads
    loadingRef.current = true;
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
        const { data: usrs } = await supabase.from('users').select('*').order('name');
        setTeamUsers(usrs || []);
        // Find current user's profile
        const authUser = (await supabase.auth.getUser())?.data?.user;
        if (authUser && usrs) {
          const authEmail = (authUser.email || '').toLowerCase();
          const profile = usrs.find(u => (u.email || '').toLowerCase() === authEmail);
          if (profile) {
            setUserProfile(profile);
            profileIdRef.current = profile.id;
            // Load greeter settings
            setGreeterSettings({
              personality: profile.greeter_personality || 'friendly',
              language: profile.greeter_language || 'en',
              enabled: profile.greeter_enabled !== false,
            });
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
      } catch(e) { console.warn('Users table not ready'); }
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
        const { data: rems } = await supabase.from('team_reminders').select('*').or('completed.is.null,completed.eq.false').order('created_at', { ascending: false }).limit(200);
        setReminders(rems || []);
      } catch(e) { setReminders([]); }
      // Load announcements + acks
      try {
        const { data: ann } = await supabase.from('announcements').select('*').order('created_at', { ascending: false }).limit(20);
        setAnnouncements(ann || []);
        const { data: acks } = await supabase.from('announcement_acks').select('*');
        setAnnouncementAcks(acks || []);
      } catch(e) { setAnnouncements([]); }
      // Load recent ticket updates (comments from last 7 days)
      try {
        const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
        const { data: comments } = await supabase.from('ticket_comments').select('*, tickets(id, ticket_number, title, status, priority, assigned_to)').gte('created_at', sevenDaysAgo).order('created_at', { ascending: false }).limit(30);
        setRecentTicketUpdates(comments || []);
      } catch(e) { setRecentTicketUpdates([]); }
      // Load tickets for dashboard
      try {
        const { data: tix } = await supabase.from('tickets').select('*').order('created_at', { ascending: false }).limit(200);
        setDashTickets(tix || []);
      } catch(e) { setDashTickets([]); }
      // Load Egypt bank transactions
      try {
        const { data: ebt } = await supabase.from('egypt_bank_transactions').select('*').order('date', { ascending: false }).limit(500);
        setEgyptBankTxns(ebt || []);
      } catch(e) { setEgyptBankTxns([]); }
      try {
        const { data: eba } = await supabase.from('egypt_bank_accounts').select('*').order('bank_name');
        setEgyptBankAccounts(eba || []);
      } catch(e) { setEgyptBankAccounts([]); }
      // Load activity feed (recent auto-generated log entries)
      try {
        const { data: feed } = await supabase.from('daily_log').select('*').eq('auto_generated', true).order('created_at', { ascending: false }).limit(50);
        setActivityFeed(feed || []);
      } catch(e) { setActivityFeed([]); }
      // Load calendar events for dashboard
      try {
        const todayStr = new Date().toISOString().substring(0, 10);
        const { data: evts } = await supabase.from('calendar_events').select('*').gte('event_date', todayStr).order('event_date').order('event_time').limit(30);
        setDashEvents(evts || []);
      } catch(e) { setDashEvents([]); }
      // Load follow-ups for dashboard
      try {
        const { data: fups } = await supabase.from('follow_ups').select('*, customers(name, name_en)').eq('completed', false).order('due_date').limit(50);
        setDashFollowUps(fups || []);
      } catch(e) { setDashFollowUps([]); }
      // Fetch USD/EGP exchange rate
      try {
        const fxRes = await fetch('https://open.er-api.com/v6/latest/USD');
        const fxData = await fxRes.json();
        if (fxData?.rates?.EGP) setFxRate({ rate: fxData.rates.EGP, updated: fxData.time_last_update_utc });
      } catch(e) { console.warn('Silent error:', e.message || e); }
      // Refresh greeter settings from latest user profile
      try {
        const myEmail = user?.email?.toLowerCase();
        if (myEmail) {
          const { data: myProfile } = await supabase.from('users').select('greeter_personality, greeter_language, greeter_enabled').eq('email', myEmail).maybeSingle();
          if (myProfile) {
            setGreeterSettings({
              personality: myProfile.greeter_personality || 'friendly',
              language: myProfile.greeter_language || 'en',
              enabled: myProfile.greeter_enabled !== false,
            });
          }
        }
      } catch(e) { console.warn('Greeter settings refresh:', e); }
      setLastLoaded(new Date());
    } catch (err) {
      console.error('Load error:', err);
    } finally {
      loadingRef.current = false;
    }
  };

  // ==========================================
  // COMPUTED VALUES
  // ==========================================
  const isAdmin = userProfile?.role === 'super_admin' || userProfile?.role === 'admin';
  const isSuperAdmin = userProfile?.role === 'super_admin';
  const activeTeamUsers = useMemo(() => teamUsers.filter(u => u.active !== false), [teamUsers]);
  const toast = useContext(ToastContext);

  // Breadcrumb — shows current location
  const TAB_GROUPS = { dashboard:'Overview', sales:'Finance', treasury:'Finance', checks:'Finance', debts:'Finance', egyptbank:'Finance', bank:'Finance', quotes:'Finance', reports:'Finance', warehouse:'Operations', inventory:'Operations', customs:'Operations', shipping:'Operations', customers:'People', crm:'People', tickets:'People', calendar:'People', comms:'People', dailylog:'People', admin:'System', ai:'System', settings:'System', import:'System', systemtickets:'System' };
  const currentTabLabel = TABS.find(t => t.id === tab)?.label?.split(' / ')[0] || tab;
  const currentGroup = TAB_GROUPS[tab] || '';

  // Name resolver
  const getUserName = useCallback((id) => (teamUsers || []).find(u => u.id === id)?.name || '', [teamUsers]);

  // Excel export helper
  const exportExcel = (data, fileName, sheetName) => {
    if (!data || !data.length) { if (toast) toast.warning('No data to export'); return; }
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName || 'Data');
    XLSX.writeFile(wb, fileName + '_' + new Date().toISOString().substring(0, 10) + '.xlsx');
    if (toast) toast.success('Exported ' + data.length + ' rows to Excel');
  };
  const canEditTreasury = isSuperAdmin || modulePerms?.['Edit Treasury'] === true || modulePerms?.['Treasury'] === true;
  const canEditInvoices = isSuperAdmin || modulePerms?.['Edit Invoices'] === true || modulePerms?.['Sales'] === true;
  const canEditInventory = isSuperAdmin || modulePerms?.['Edit Inventory'] === true || modulePerms?.['Inventory'] === true;
  const canEditWarehouse = isSuperAdmin || modulePerms?.['Edit Warehouse'] === true || modulePerms?.['Warehouse'] === true;
  const canExportData = isSuperAdmin || modulePerms?.['Export Data'] === true;
  const canManageCategories = isSuperAdmin || modulePerms?.['Manage Categories'] === true;

  // Tab-to-module mapping for permission filtering
  const TAB_MODULE_MAP = {
    dashboard: 'Dashboard', sales: 'Sales', customers: 'Customers', treasury: 'Treasury',
    checks: 'Treasury', debts: 'Debts', warehouse: 'Warehouse', inventory: 'Inventory',
    crm: 'CRM', tickets: 'Tickets', calendar: 'Calendar', customs: 'Customs', shipping: 'Shipping Rates',
    dailylog: 'Daily Log', admin: 'Admin', ai: 'AI Assistant', settings: 'Settings', import: 'Import', bank: 'Bank', quotes: 'Quotes', egyptbank: 'Egypt Bank', reports: 'Reports',
  };

  const visibleTabs = useMemo(() => {
    if (userProfile?.role === 'super_admin') return TABS; // super admin sees all
    if (!userProfile) return TABS.filter(t => t.id === 'dashboard'); // loading — show nothing
    return TABS.filter(t => {
      const moduleName = TAB_MODULE_MAP[t.id];
      // If permission explicitly set, use it
      if (moduleName && modulePerms[moduleName] !== undefined) return modulePerms[moduleName];
      // No explicit permission: hide all financial + admin tabs (even for admin/manager role)
      if (['treasury', 'checks', 'debts', 'sales', 'warehouse', 'inventory', 'admin', 'settings', 'import', 'bank', 'egyptbank', 'reports', 'customs', 'customers'].includes(t.id)) return false;
      return true;
    });
  }, [userProfile, modulePerms]);

  const filteredInvoices = useMemo(() => {
    let arr = invoices.filter(s => inRange(s.invoice_date, mode, df, dt));
    if (customerFilter) arr = arr.filter(s => s.customer_name === customerFilter || s.customer_name_en === customerFilter);
    if (query) arr = arr.filter(s =>
      (s.customer_name || '').includes(query) || (s.customer_name_en || '').toLowerCase().includes(query.toLowerCase()) || (s.order_number || '').includes(query)
    );
    const dir = invoiceSort === 'oldest' ? 1 : -1;
    arr.sort((a, b) => dir * ((a.created_at || '').localeCompare(b.created_at || '')));
    return arr;
  }, [invoices, mode, df, dt, query, customerFilter, invoiceSort]);

  const totalInvoiced = useMemo(() => filteredInvoices.reduce((a, r) => a + Number(r.total_amount || 0), 0), [filteredInvoices]);
  const totalCollected = useMemo(() => filteredInvoices.reduce((a, r) => a + Number(r.total_collected || 0), 0), [filteredInvoices]);
  const totalOutstanding = useMemo(() => filteredInvoices.reduce((a, r) => a + Number(r.outstanding || 0), 0), [filteredInvoices]);
  const totalDebt = useMemo(() => debts.reduce((a, d) => a + Number(d.total_debt || 0), 0), [debts]);

  const filteredTreasury = useMemo(() => {
    const dir = treasurySort === 'oldest' ? 1 : -1;
    return treasury.filter(t => inRange(t.transaction_date, mode, df, dt))
      .sort((a, b) => {
        const d = (a.transaction_date || '').localeCompare(b.transaction_date || '');
        if (d !== 0) return dir * d;
        // Same date: secondary sort by created_at so newest entry appears first within same day
        return dir * ((a.created_at || '').localeCompare(b.created_at || ''));
      });
  }, [treasury, mode, df, dt, treasurySort]);
  // SAFE (cash_in / cash_out) — physical treasury. Bank entries excluded by
  // definition: bank rows always have cash_in=0 and cash_out=0 (amounts
  // live in bank_in/bank_out). See bank-safe-separation.sql.
  const totalCashIn = useMemo(() => filteredTreasury.reduce((a, t) => a + Number(t.cash_in || 0), 0), [filteredTreasury]);
  const totalCashOut = useMemo(() => filteredTreasury.reduce((a, t) => a + Number(t.cash_out || 0), 0), [filteredTreasury]);
  const allTimeNet = useMemo(() => treasury.reduce((a, t) => a + Number(t.cash_in || 0) - Number(t.cash_out || 0), 0), [treasury]);
  // BANK (bank_in / bank_out) — not counted toward safe net. Bank_in hits
  // count toward invoice.total_collected only.
  const totalBankIn = useMemo(() => filteredTreasury.reduce((a, t) => a + Number(t.bank_in || 0), 0), [filteredTreasury]);
  const totalBankOut = useMemo(() => filteredTreasury.reduce((a, t) => a + Number(t.bank_out || 0), 0), [filteredTreasury]);

  // Running balance — computed in display order so top row always = current net when newest first
  const treasuryBalanceMap = useMemo(() => {
    // Sort by transaction_date (oldest first) for accumulation, then by created_at as tiebreaker
    const sorted = [...treasury].sort((a, b) => {
      const d = (a.transaction_date || '').localeCompare(b.transaction_date || '');
      if (d !== 0) return d;
      return (a.created_at || '').localeCompare(b.created_at || '');
    });
    const map = {};
    let running = 0;
    sorted.forEach(t => {
      running += Number(t.cash_in || 0) - Number(t.cash_out || 0);
      map[t.id] = running;
    });
    return map;
  }, [treasury]);

  // ==========================================
  // AUTO-MATCH BANK PLACEHOLDERS to imported bank transactions
  // Uses ref guard to prevent infinite re-trigger loop
  // ==========================================
  const autoMatchRunning = useRef(false);
  useEffect(() => {
    if (autoMatchRunning.current) return;
    if (!treasury.length || !egyptBankTxns.length) return;
    const placeholders = treasury.filter(t => t.is_bank_placeholder && !t.matched_bank_txn_id);
    if (!placeholders.length) return;

    const unmatchedBank = egyptBankTxns.filter(b => !b.matched_treasury_id);
    if (!unmatchedBank.length) return;

    const matches = [];
    placeholders.forEach(ph => {
      const expAmt = Number(ph.expected_amount || 0);
      const expDir = ph.expected_direction;
      const phDate = new Date(ph.transaction_date);
      const tolAmt = Math.max(expAmt * 0.01, 1);
      const twoDays = 2 * 86400000;

      const candidates = unmatchedBank.filter(b => {
        const bankAmt = Number(b.amount);
        const bankIsIn = bankAmt > 0;
        if (expDir === 'in' && !bankIsIn) return false;
        if (expDir === 'out' && bankIsIn) return false;
        if (ph.bank_account_id && b.account_id && ph.bank_account_id !== b.account_id) return false;
        if (Math.abs(Math.abs(bankAmt) - expAmt) > tolAmt) return false;
        const bDate = new Date(b.date);
        if (Math.abs(bDate - phDate) > twoDays) return false;
        return true;
      });

      if (!candidates.length) return;

      const scored = candidates.map(b => {
        let score = 0;
        if (ph.order_number && (b.description || '').includes(ph.order_number)) score += 1000;
        score -= Math.abs(Math.abs(Number(b.amount)) - expAmt);
        score -= Math.abs(new Date(b.date) - phDate) / 86400000;
        return { b, score };
      }).sort((a, b) => b.score - a.score);

      matches.push({ placeholder: ph, bank: scored[0].b });
    });

    if (!matches.length) return;

    autoMatchRunning.current = true;
    (async () => {
      try {
        for (const m of matches) {
          const { placeholder, bank } = m;
          const expAmt = Number(placeholder.expected_amount || 0);
          const isIn = placeholder.expected_direction === 'in';

          // POST-MATCH: amount lives in bank_in/bank_out (NOT cash_in/cash_out).
          // Treasury safe net is cash-only; bank hits only affect invoice collected.
          const updates = {
            is_bank_placeholder: false,
            matched_bank_txn_id: bank.id,
            cash_in: 0,
            cash_out: 0,
            bank_in:  isIn ?  expAmt : 0,
            bank_out: !isIn ? expAmt : 0,
            description: (placeholder.description || '').replace(' [awaiting bank confirmation]', '') + ' ✅ matched bank ' + bank.date,
          };

          if (placeholder.order_number && !placeholder.linked_invoice_id) {
            const inv = invoices.find(i => i.order_number === placeholder.order_number);
            if (inv) {
              updates.linked_invoice_id = inv.id;
              // Smart dedup: check if another REAL treasury entry already covers this payment
              // Guards: non-placeholder, positive cash_in OR bank_in, not a bank confirmation,
              // AND within 90 days of the bank date.
              const bankDateMs = new Date(bank.date).getTime();
              const ninetyDays = 90 * 86400000;
              const existingLinked = treasury.filter(t => {
                if (t.id === placeholder.id) return false;
                if (t.is_bank_placeholder) return false;
                const tIn = Number(t.cash_in || 0) + Number(t.bank_in || 0);
                if (tIn <= 0) return false;
                if (String(t.description || '').indexOf('[bank confirmation') >= 0) return false;
                if (t.linked_invoice_id !== inv.id && t.order_number !== inv.order_number) return false;
                const tDate = t.transaction_date ? new Date(t.transaction_date).getTime() : 0;
                if (!tDate || Math.abs(bankDateMs - tDate) > ninetyDays) return false;
                return true;
              });
              // Find the sibling that actually matches this amount (cash OR bank)
              const matchingSibling = existingLinked.find(t =>
                Math.abs((Number(t.cash_in || 0) + Number(t.bank_in || 0)) - expAmt) < expAmt * 0.02
              );
              if (matchingSibling) {
                // Dedup: real money already counted — zero this row in every bucket
                updates.linked_invoice_id = inv.id;
                updates.description = (updates.description || placeholder.description || '')
                  + ' [bank confirmation — not added to collected, dedup_sibling=' + matchingSibling.id + ']';
                updates.cash_in = 0;
                updates.cash_out = 0;
                updates.bank_in = 0;
                updates.bank_out = 0;
                updates.dedup_sibling_id = matchingSibling.id;
              }
              // Non-dedup branch: let recalcInvoiceCollected below read truth from DB
              // (after the update commits) instead of maintaining a parallel running total.
            }
          }

          await supabase.from('treasury').update(updates).eq('id', placeholder.id);
          await supabase.from('egypt_bank_transactions').update({
            matched_treasury_id: placeholder.id,
            matched_invoice_id: updates.linked_invoice_id || bank.matched_invoice_id || null,
            matched_at: new Date().toISOString(),
          }).eq('id', bank.id);

          // Recalc the linked invoice from DB truth (cash_in + bank_in on linked rows).
          if (updates.linked_invoice_id) {
            try { await recalcInvoiceCollected(updates.linked_invoice_id); } catch(e) {}
          }
        }
        if (toast) toast.success(matches.length + ' bank transaction(s) auto-matched ✓');
        await loadAllData();
      } catch (e) { console.warn('Auto-match error:', e.message); }
      autoMatchRunning.current = false;
    })();
  }, [treasury, egyptBankTxns]);

  // ==========================================
  // AUTO-MATCH CHECKS ↔ EGYPT BANK DEPOSITS
  // Pairs pending checks with unmatched bank credits.
  // Verifies amount (±1%), date window (±5 days), and description signal
  // (check#, order#, or customer-name tokens). Skips ambiguous cases.
  // On match: creates treasury row, marks check collected, links bank txn,
  // and recalcs invoice. All writes tagged [auto-matched from bank <date>]
  // for audit traceability.
  // ==========================================
  const checkMatchRunning = useRef(false);
  useEffect(() => {
    if (checkMatchRunning.current) return;
    if (!checks.length || !egyptBankTxns.length) return;

    // Only pending, not-yet-linked, positive-amount checks
    var pending = checks.filter(function(c) {
      return c.status === 'pending' && !c.linked_treasury_id && Number(c.amount) > 0;
    });
    if (!pending.length) return;

    // Only unmatched bank credits (money coming in)
    var unmatchedBank = egyptBankTxns.filter(function(b) {
      return Number(b.amount) > 0 && !b.matched_treasury_id;
    });
    if (!unmatchedBank.length) return;

    var fiveDays = 5 * 86400000;
    var matches = [];
    var usedBankIds = new Set();

    for (var i = 0; i < pending.length; i++) {
      var chk = pending[i];
      var chkAmt = Number(chk.amount);
      var tolAmt = Math.max(chkAmt * 0.01, 1);
      var dueRaw = chk.due_date || (chk.check_date && chk.check_date.length >= 10 ? chk.check_date.substring(0, 10) : null);
      if (!dueRaw) continue;
      var chkDate = new Date(dueRaw);
      if (isNaN(chkDate.getTime())) continue;

      // AMOUNT + DATE filter
      var candidates = unmatchedBank.filter(function(b) {
        if (usedBankIds.has(b.id)) return false;
        if (Math.abs(Number(b.amount) - chkAmt) > tolAmt) return false;
        var bDate = new Date(b.date);
        if (isNaN(bDate.getTime())) return false;
        if (Math.abs(bDate - chkDate) > fiveDays) return false;
        return true;
      });
      if (!candidates.length) continue;

      // DESCRIPTION scoring — verifies it's really THIS check
      var scored = candidates.map(function(b) {
        var score = 0;
        var desc = (b.description || '').toLowerCase();

        // Check# in description → strongest signal
        if (chk.check_number && desc.indexOf(String(chk.check_number).toLowerCase()) >= 0) {
          score += 2000;
        }
        // Order# in description → strong signal
        if (chk.order_number && desc.indexOf(String(chk.order_number).toLowerCase()) >= 0) {
          score += 1000;
        }
        // Customer name tokens (3+ chars) → medium signal
        if (chk.customer_name) {
          var tokens = chk.customer_name.split(/\s+/).filter(function(t) { return t.length >= 3; });
          for (var j = 0; j < tokens.length; j++) {
            if (desc.indexOf(tokens[j].toLowerCase()) >= 0) score += 200;
          }
        }
        // Bank name match → weak signal
        if (chk.bank_name && desc.indexOf(String(chk.bank_name).toLowerCase()) >= 0) {
          score += 100;
        }
        // Tie-breakers
        score -= Math.abs(Number(b.amount) - chkAmt) * 0.5;
        score -= Math.abs(new Date(b.date) - chkDate) / 86400000 * 10;

        return { b: b, score: score };
      }).sort(function(a, b) { return b.score - a.score; });

      var topScore = scored[0].score;
      var runnerUp = scored[1] ? scored[1].score : -Infinity;

      // GUARD 1: Need at least ONE real signal (not just amount+date coincidence)
      var hasSignal = topScore >= 200;

      // GUARD 2: Clear winner (or only candidate) — prevents grabbing wrong check
      // when customer has multiple same-amount checks near same date
      var unambiguous = scored.length === 1 || (topScore - runnerUp) >= 300;

      if (!hasSignal || !unambiguous) continue;

      matches.push({ check: chk, bank: scored[0].b });
      usedBankIds.add(scored[0].b.id);
    }

    if (!matches.length) return;

    checkMatchRunning.current = true;
    (async function() {
      try {
        for (var k = 0; k < matches.length; k++) {
          var chk = matches[k].check;
          var bank = matches[k].bank;
          var collectionDate = bank.date;

          var desc = (chk.customer_name || '') + ' — شيك محصّل'
            + (chk.check_number ? ' #' + chk.check_number : '')
            + ' [auto-matched from bank ' + bank.date + ']';

          // 1. Treasury row
          var ins = await supabase.from('treasury').insert({
            transaction_date: collectionDate,
            order_number: chk.order_number || '',
            description: desc,
            cash_in: Number(chk.amount),
            cash_out: 0,
            source: 'main',
            category: 'مبيعات',
            linked_invoice_id: chk.invoice_id || null,
          }).select('id').single();
          if (!ins.data) continue;
          var newTxnId = ins.data.id;

          // 2. Mark check collected
          await supabase.from('checks').update({
            status: 'collected',
            collection_date: collectionDate,
            linked_treasury_id: newTxnId,
          }).eq('id', chk.id);

          // 3. Link bank transaction
          await supabase.from('egypt_bank_transactions').update({
            matched_treasury_id: newTxnId,
            matched_invoice_id: chk.invoice_id || bank.matched_invoice_id || null,
            matched_at: new Date().toISOString(),
            matched_by: (userProfile && userProfile.id) || (user && user.id) || null,
          }).eq('id', bank.id);

          // 4. Recalc invoice collected
          if (chk.invoice_id) {
            try { await recalcInvoiceCollected(chk.invoice_id); } catch(e) {}
          }
        }
        if (toast && toast.success) toast.success(matches.length + ' check(s) auto-matched to bank deposits ✓');
        await loadAllData();
      } catch (e) {
        console.warn('Check auto-match error:', e.message);
      }
      checkMatchRunning.current = false;
    })();
  }, [checks, egyptBankTxns]);

  // Load last login info for welcome briefing
  const [loginHistoryLoaded, setLoginHistoryLoaded] = useState(false);
  useEffect(() => {
    if (!userProfile?.id) return;
    (async () => {
      try {
        const { data } = await supabase.from('user_sessions')
          .select('date, login_at')
          .eq('user_id', userProfile.id)
          .order('login_at', { ascending: false })
          .limit(30);
        setLastLoginInfo(data || []);
      } catch(e) { setLastLoginInfo([]); }
      setLoginHistoryLoaded(true);
    })();
  }, [userProfile?.id]);

  // Reset visible counts when filter changes
  useEffect(() => { setTreasuryVisible(50); setInvoiceVisible(50); }, [mode, df, dt]);

  // Sparkline data: daily totals for last 30 days
  const sparkData = useMemo(() => {
    const days = 30;
    const dates = Array.from({ length: days }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (days - 1 - i)); return d.toISOString().substring(0, 10); });
    const invByDay = dates.map(d => invoices.filter(i => (i.invoice_date || '').substring(0, 10) === d).reduce((a, i) => a + Number(i.amount || i.total_amount || 0), 0));
    const colByDay = dates.map(d => invoices.filter(i => (i.invoice_date || '').substring(0, 10) === d).reduce((a, i) => a + Number(i.total_collected || 0), 0));
    const cinByDay = dates.map(d => treasury.filter(t => (t.transaction_date || '').substring(0, 10) === d).reduce((a, t) => a + Number(t.cash_in || 0), 0));
    const coutByDay = dates.map(d => treasury.filter(t => (t.transaction_date || '').substring(0, 10) === d).reduce((a, t) => a + Number(t.cash_out || 0), 0));
    return { inv: invByDay, col: colByDay, cin: cinByDay, cout: coutByDay };
  }, [invoices, treasury]);

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
    setTabLoading(true);
    setTab(t); setQuery(''); setCustomerFilter(''); setSelectedCustomer(null); setSelectedDebtor(null);
    setSelectedInvoice(null); setDrillType(null); setTreasuryDrill(null); setSelectedMonth(null);
    if (t === 'treasury') setMode('all');
    else if (t === 'sales' || t === 'checks') setMode('ytd');
    setTimeout(() => setTabLoading(false), 300);
  };

  // Open an invoice while preserving the user's exact Treasury position so
  // Back returns them to where they were.
  const openInvoiceFromTreasury = (invoice) => {
    if (!invoice || !invoice.id) return;
    setTreasuryReturnState({
      scrollY: typeof window !== 'undefined' ? window.scrollY : 0,
      mode: mode,
      df: df,
      dt: dt,
      query: query,
      tSearch: tSearch,
      treasuryVisible: treasuryVisible,
      treasurySort: treasurySort,
      anchorId: invoice.order_number || null,
    });
    setSelectedInvoice(invoice);
  };

  // Restore Treasury scroll position + filters after closing an invoice
  // that was opened via openInvoiceFromTreasury.
  const returnToTreasury = () => {
    const saved = treasuryReturnState;
    setSelectedInvoice(null);
    setShowAddPayment(false); setEditingTxn(null); setShowLinkSearch(false); setLinkSearch('');
    if (!saved) { setFormData({}); return; }
    setFormData({});
    // Restore filters
    if (saved.mode !== undefined) setMode(saved.mode);
    if (saved.df !== undefined) setDf(saved.df);
    if (saved.dt !== undefined) setDt(saved.dt);
    if (saved.query !== undefined) setQuery(saved.query);
    if (saved.tSearch !== undefined) setTSearch(saved.tSearch);
    if (saved.treasuryVisible !== undefined) setTreasuryVisible(saved.treasuryVisible);
    if (saved.treasurySort !== undefined) setTreasurySort(saved.treasurySort);
    setTreasuryReturnState(null);
    // Restore scroll after React commits the filter state
    setTimeout(() => {
      if (typeof window !== 'undefined' && typeof saved.scrollY === 'number') {
        window.scrollTo({ top: saved.scrollY, behavior: 'instant' });
      }
    }, 50);
  };

  const handleSignOut = async () => {
    const uid = profileIdRef.current || user?.id;
    if (uid) {
      const today = new Date().toISOString().split('T')[0];
      await supabase.from('user_sessions')
        .update({ logout_at: new Date().toISOString(), last_seen: new Date().toISOString(), logout_reason: 'manual' })
        .eq('user_id', uid).eq('date', today)
        .order('login_at', { ascending: false }).limit(1);
      try { await supabase.from('daily_log').insert({ user_id: uid, entry_text: 'Clocked out (manual)', log_category: 'login', log_date: today, log_time: new Date().toTimeString().substring(0,8), auto_generated: true }); } catch(e) { console.warn('Silent error:', e.message || e); }
    }
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  // ==========================================
  // CHANNEL/DIRECTION HELPERS for treasury rows
  // A treasury row holds money in exactly one of four columns:
  //   cash_in, cash_out  (physical SAFE — affects treasury net)
  //   bank_in, bank_out  (BANK — affects invoice.collected only)
  // These helpers centralize the read/write so split, edit, and unlink
  // behave correctly for both channels.
  // ==========================================
  const readTreasuryMoney = (txn) => {
    const ci = Number(txn.cash_in || 0);
    const co = Number(txn.cash_out || 0);
    const bi = Number(txn.bank_in || 0);
    const bo = Number(txn.bank_out || 0);
    if (ci > 0) return { channel: 'cash', direction: 'in',  amount: ci };
    if (co > 0) return { channel: 'cash', direction: 'out', amount: co };
    if (bi > 0) return { channel: 'bank', direction: 'in',  amount: bi };
    if (bo > 0) return { channel: 'bank', direction: 'out', amount: bo };
    return { channel: null, direction: null, amount: 0 };
  };
  const buildSplitAmounts = (channel, direction, amount) => {
    const amt = Number(amount) || 0;
    return {
      cash_in:  channel === 'cash' && direction === 'in'  ? amt : 0,
      cash_out: channel === 'cash' && direction === 'out' ? amt : 0,
      bank_in:  channel === 'bank' && direction === 'in'  ? amt : 0,
      bank_out: channel === 'bank' && direction === 'out' ? amt : 0,
    };
  };

  // ==========================================
  // SINGLE SOURCE OF TRUTH: Recalculate invoice collected
  // Called after ANY payment/link/unlink/match action
  // Queries DB directly — always accurate, prevents double counting
  // ==========================================
  const recalcInvoiceCollected = async (invoiceId) => {
    if (!invoiceId) return;
    // Get invoice from DB
    const { data: inv } = await supabase.from('invoices').select('id, total_amount, order_number').eq('id', invoiceId).maybeSingle();
    if (!inv) return;
    // Source of truth: treasury rows with linked_invoice_id pointing to this invoice.
    // "Collected" sums BOTH safe cash_in AND bank_in (both are real money received
    // for this invoice — just via different channels). We do NOT filter on cash_in>0
    // in the query anymore because a row might have bank_in>0 and cash_in=0.
    const { data: linked } = await supabase.from('treasury')
      .select('id, cash_in, bank_in, is_bank_placeholder, description')
      .eq('linked_invoice_id', invoiceId);
    // Sum only real entries (not placeholders, not bank-confirmation dedup markers)
    let total = 0;
    for (const t of (linked || [])) {
      if (t.is_bank_placeholder) continue;
      if (t.description && t.description.includes('[bank confirmation')) continue;
      total += Number(t.cash_in || 0) + Number(t.bank_in || 0);
    }
    // Cap at invoice total
    const capped = Math.min(total, Number(inv.total_amount || 0));
    await dbUpdate('invoices', invoiceId, {
      total_collected: capped,
      outstanding: Math.max(0, Number(inv.total_amount || 0) - capped),
    }, userProfile?.id || user?.id);
    return capped;
  };

  const handleAddPayment = async (pf) => {
    if (!canEditInvoices) { toast.error('You do not have permission to edit invoices.'); return; }
    const pd = pf || formData;
    if (!pd.amount || Number(pd.amount) <= 0) { toast.warning('Payment amount is required'); return; }
    if (!pd.date) { toast.warning('Payment date is required'); return; }
    if (!selectedInvoice) { toast.warning('No invoice selected'); return; }
    try {
      const method = pd.payMethod || 'cash';
      const isCheck = method === 'check';
      // "Safe" channels — physical cash and mobile wallets that auto-sweep to the safe
      const isSafeChannel = method === 'cash' || method === 'vodafone' || method === 'instapay';
      const isBankChannel = method === 'bank_transfer';

      if (isCheck) {
        // POST-DATED CHECK → goes to checks table, does NOT update collected
        await dbInsert('checks', {
          customer_name: selectedInvoice.customer_name,
          customer_id: selectedInvoice.customer_id || null,
          order_number: selectedInvoice.order_number,
          invoice_id: selectedInvoice.id,
          amount: Number(pd.amount),
          check_date: pd.checkDueDate || pd.date,
          due_date: pd.checkDueDate || pd.date,
          check_number: pd.checkNumber || '',
          bank_name: pd.checkBank || '',
          status: 'pending',
          notes: pd.desc || '',
        }, user?.id);
        // Add note to invoice but do NOT update collected
        await dbUpdate('invoices', selectedInvoice.id, {
          notes: (selectedInvoice.notes || '') + '\n📝 Post-dated check: ' + fE(Number(pd.amount)) + ' due ' + (pd.checkDueDate || pd.date) + (pd.checkNumber ? ' #' + pd.checkNumber : ''),
        }, user?.id);
      } else if (isSafeChannel) {
        // CASH / VODAFONE / INSTAPAY → treasury cash_in + invoice link.
        // cash_method tag preserves reconciliation: Vodafone statements, InstaPay statements,
        // physical till counts — each can be reconciled against its tagged rows.
        var methodLabel = method === 'vodafone' ? '📱 Vodafone Cash'
                        : method === 'instapay' ? '⚡ InstaPay'
                        : '💵 Cash';
        await dbInsert('treasury', {
          transaction_date: pd.date,
          order_number: selectedInvoice.order_number,
          description: sanitize((pd.desc || selectedInvoice.customer_name + ' payment') + ' [' + methodLabel + ']'),
          cash_in: Number(pd.amount),
          cash_out: 0,
          bank_in: 0,
          bank_out: 0,
          cash_method: method,
          category: pd.category || 'مبيعات',
          subcategory: pd.subcategory || '',
          linked_invoice_id: selectedInvoice.id,
        }, user?.id);
        await recalcInvoiceCollected(selectedInvoice.id);
      } else if (isBankChannel) {
        // BANK TRANSFER → treasury bank_in + invoice link. Does NOT hit safe.
        await dbInsert('treasury', {
          transaction_date: pd.date,
          order_number: selectedInvoice.order_number,
          description: sanitize((pd.desc || selectedInvoice.customer_name + ' payment') + ' [🏦 Bank Transfer]'),
          cash_in: 0, cash_out: 0,
          bank_in: Number(pd.amount),
          bank_out: 0,
          category: pd.category || 'مبيعات',
          subcategory: pd.subcategory || '',
          linked_invoice_id: selectedInvoice.id,
        }, user?.id);
        await recalcInvoiceCollected(selectedInvoice.id);
      } else {
        // "Other" — no treasury row, just a note. Invoice collected unchanged.
        await dbUpdate('invoices', selectedInvoice.id, {
          notes: (selectedInvoice.notes || '') + '\n' + method + ': ' + fE(Number(pd.amount)) + ' on ' + pd.date,
        }, user?.id);
      }
      setShowAddPayment(false); toast.success("Payment recorded ✓");
      setFormData({});
      await loadAllData();
    } catch (err) {
      toast.error(err.message);
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
      const tTotal = txns.reduce((a, t) => a + Number(t.cash_in || 0) + Number(t.bank_in || 0), 0);
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
    if (!formData.orderNumber) { toast.warning('Order number is required / رقم الأمر مطلوب'); return; }
    if (!formData.customerName) { toast.warning('Customer name is required / اسم العميل مطلوب'); return; }
    if (!formData.amount || Number(formData.amount) <= 0) { toast.warning('Amount must be greater than zero / المبلغ يجب أن يكون أكبر من صفر'); return; }
    try {
      const orderNum = sanitize(formData.orderNumber);
      const { data: inserted } = await supabase.from('invoices').insert({
        order_number: orderNum,
        customer_name: sanitize(formData.customerName),
        customer_id: formData.customerId || null,
        invoice_date: formData.date || today(),
        total_amount: Number(formData.amount),
        total_collected: 0,
        sales_rep: formData.salesRep || '',
        notes: sanitize(formData.notes || ''),
        source: 'manual',
      }).select('id').single();

      // BACKFILL: link any existing treasury rows that reference this order_number
      // but don't yet have linked_invoice_id. Recalc collected afterward.
      if (inserted && inserted.id) {
        const { data: orphans } = await supabase.from('treasury')
          .select('id')
          .eq('order_number', orderNum)
          .is('linked_invoice_id', null);
        if (orphans && orphans.length > 0) {
          await supabase.from('treasury')
            .update({ linked_invoice_id: inserted.id })
            .eq('order_number', orderNum)
            .is('linked_invoice_id', null);
          await recalcInvoiceCollected(inserted.id);
          toast.success('Invoice created + linked ' + orphans.length + ' waiting treasury entr' + (orphans.length === 1 ? 'y' : 'ies') + ' ✓');
        } else {
          toast.success('Invoice created ✓');
        }
      } else {
        toast.success('Invoice created ✓');
      }

      setShowAddInvoice(false);
      setFormData({});
      await loadAllData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  // Fuzzy-match order numbers for typo suggestions.
  // Returns up to 3 invoices with numerically-similar or prefix-matching order_numbers.
  const findOrderNumberSuggestions = (typed) => {
    if (!typed) return [];
    const s = String(typed).trim();
    if (!s) return [];
    const lower = s.toLowerCase();
    const scored = [];
    for (const inv of invoices) {
      const on = String(inv.order_number || '').toLowerCase();
      if (!on || on === lower) continue;
      let score = 0;
      // Exact prefix match is strongest
      if (on.startsWith(lower) || lower.startsWith(on)) score += 100;
      // Substring both ways
      if (on.includes(lower) || lower.includes(on)) score += 60;
      // Same length, diff of one char (transposition / single typo)
      if (on.length === lower.length) {
        let diffs = 0;
        for (let i = 0; i < on.length; i++) if (on[i] !== lower[i]) diffs++;
        if (diffs === 1) score += 40;
        if (diffs === 2) score += 15;
      }
      // Length off by 1 (added/removed digit)
      if (Math.abs(on.length - lower.length) === 1) score += 10;
      if (score > 0) scored.push({ inv, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 3).map(x => x.inv);
  };

  const handleAddTreasury = async () => {
    if (!canEditTreasury) { toast.error('You do not have permission to add treasury entries.'); return; }
    const txDate = formData.date || today();
    if (!formData.amount) { toast.warning('Please enter an amount / الرجاء إدخال المبلغ'); return; }
    const isBankPlaceholder = formData.type === 'bank_in' || formData.type === 'bank_out';
    if (isBankPlaceholder && !formData.bankAccountId) { toast.warning('Please select a bank account'); return; }
    // Bank entries must declare their identity: either an Order (links to a
    // sales invoice) or a Non-Order category (owner draw, inter-bank transfer,
    // bank fee, loan, refund, other). Prevents orderless mystery rows that
    // caused the ghost-dedup bug last session.
    if (isBankPlaceholder) {
      const mode = formData.bankEntryMode || 'order'; // 'order' | 'nonorder'
      if (mode === 'order') {
        const orderTrim = String(formData.orderNumber || '').trim();
        if (!orderTrim) {
          toast.warning('Order mode requires an order number. Switch to Non-Order and pick a category if this is not an invoice payment. / وضع الأمر يتطلب رقم أمر.');
          return;
        }
      } else {
        if (!formData.bankNonOrderCategory) {
          toast.warning('Non-Order bank entries require a category (Owner Draw, Inter-Bank Transfer, Bank Fee, Loan, Refund, or Other). / قيد بنكي بدون أمر يتطلب تصنيف.');
          return;
        }
      }
      if (!String(formData.desc || '').trim()) {
        toast.warning('Description is required for bank entries. / الوصف مطلوب للقيود البنكية.');
        return;
      }
    }
    try {
      const isIncome = formData.type === 'in' || formData.type === 'bank_in';
      const currency = formData.currency || 'EGP';
      const amt = Number(formData.amount);
      let cat = formData.category || '';
      let subcat = formData.subcategory || '';
      if (!cat && formData.desc) {
        const ruleType = isIncome ? 'income' : 'expense';
        const rule = expenseRules.find(r => (formData.desc || '').includes(r.description_match) && (r.rule_type === ruleType || (!r.rule_type && ruleType === 'expense')));
        if (rule) { cat = rule.category; subcat = rule.subcategory || ''; }
      }
      const record = {
        transaction_date: txDate,
        order_number: sanitize(formData.orderNumber || ''),
        description: sanitize(formData.desc || ''),
        cash_in: 0, cash_out: 0,
        bank_in: 0, bank_out: 0,
        usd_in: 0, usd_out: 0,
        category: cat,
        subcategory: subcat,
        currency: currency,
      };
      // Tag cash_method for safe-channel rows so Vodafone/InstaPay flows
      // can be reconciled separately from physical cash.
      if (!isBankPlaceholder && (formData.type === 'in' || formData.type === 'out' || !formData.type)) {
        record.cash_method = formData.cashMethod || 'cash';
      }
      if (isBankPlaceholder) {
        // Bank entry — awaits statement verification. cash_in/cash_out stay 0
        // forever. bank_in/bank_out stay 0 until auto-matcher confirms.
        // expected_amount drives the pre-match display; after match the amount
        // is written into bank_in/bank_out (see auto-matcher).
        record.is_bank_placeholder = true;
        record.expected_amount = amt;
        record.expected_direction = isIncome ? 'in' : 'out';
        record.bank_account_id = formData.bankAccountId;
        record.description = (record.description || '') + ' [awaiting bank confirmation]';
        const mode = formData.bankEntryMode || 'order';
        if (mode === 'nonorder') {
          record.order_number = '';           // non-order rows carry no order#
          record.bank_nonorder_category = formData.bankNonOrderCategory;
        }
      } else if (currency === 'EGP') {
        if (isIncome) record.cash_in = amt; else record.cash_out = amt;
      } else if (currency === 'USD') {
        if (isIncome) record.usd_in = amt; else record.usd_out = amt;
      } else {
        record.foreign_amount = amt;
        record.foreign_currency = currency;
        record.foreign_direction = isIncome ? 'in' : 'out';
      }

      // INVOICE-LINK WORKFLOW
      // Triggers for:
      //   (a) cash_in with an order# (real safe money against a sales order) — auto-link + recalc
      //   (b) bank_in in Order mode with an order# — auto-link the placeholder so the
      //       auto-matcher already knows the target invoice; recalc only fires on match
      // Expenses (cash_out / bank_out) skip this — order# there is a PO/project code.
      // Non-Order bank entries skip this — they have no order# by construction.
      const bankEntryMode = formData.bankEntryMode || 'order';
      const isOrderLinkable =
        isIncome && (
          !isBankPlaceholder ||                     // cash_in
          (isBankPlaceholder && bankEntryMode === 'order')  // bank_in Order mode
        );
      const orderNumTrimmed = String(record.order_number || '').trim();
      if (isOrderLinkable && orderNumTrimmed) {
        const matchingInvoice = invoices.find(i => String(i.order_number || '').trim() === orderNumTrimmed);
        if (matchingInvoice) {
          // Auto-link — set linked_invoice_id so recalcInvoiceCollected picks it up
          record.linked_invoice_id = matchingInvoice.id;
          // Insert. Only recalc for real cash_in; placeholders wait for the match.
          await dbInsert('treasury', record, user?.id);
          if (!isBankPlaceholder) {
            await recalcInvoiceCollected(matchingInvoice.id);
          }
          const tempEntry = { id: 'temp-' + Date.now(), ...record };
          setTreasury(prev => [tempEntry, ...prev]);
          setShowAddTreasury(false);
          toast.success(
            (isBankPlaceholder ? 'Bank entry saved (awaiting statement) + linked to ' : 'Transaction saved + linked to ')
            + (matchingInvoice.customer_name || ('#' + matchingInvoice.order_number)) + ' ✓'
          );
          setFormData({});
          setTimeout(() => loadAllData(), 500);
          return;
        }
        // Order# provided but no matching invoice → open "create now or cancel" flow
        setPendingTreasuryRecord({
          record: record,
          amount: amt,
          suggestions: findOrderNumberSuggestions(orderNumTrimmed),
        });
        return; // form stays open behind the mini-modal; no insert yet
      }

      // No order# branch covers: expenses with/without order#, non-order bank entries, cash_in without order#
      await dbInsert('treasury', record, user?.id);
      const tempEntry = { id: 'temp-' + Date.now(), ...record };
      setTreasury(prev => [tempEntry, ...prev]);
      setShowAddTreasury(false);
      toast.success(isBankPlaceholder ? 'Bank entry saved — awaiting bank statement ✓' : 'Transaction saved ✓');
      setFormData({});
      setTimeout(() => loadAllData(), 500);
    } catch (err) {
      toast.error(err.message);
    }
  };

  // Finalize the pending treasury record after the user either:
  // (a) accepts a typo suggestion → use that invoice's id
  // (b) creates a new invoice inline → use the new invoice id
  const finalizePendingTreasury = async (invoiceToLink) => {
    if (!pendingTreasuryRecord) return;
    const rec = { ...pendingTreasuryRecord.record };
    if (invoiceToLink && invoiceToLink.id) {
      rec.linked_invoice_id = invoiceToLink.id;
      rec.order_number = invoiceToLink.order_number; // normalize to canonical
    }
    try {
      await dbInsert('treasury', rec, user?.id);
      if (invoiceToLink && invoiceToLink.id) {
        await recalcInvoiceCollected(invoiceToLink.id);
      }
      const tempEntry = { id: 'temp-' + Date.now(), ...rec };
      setTreasury(prev => [tempEntry, ...prev]);
      setShowAddTreasury(false);
      setPendingTreasuryRecord(null);
      toast.success(invoiceToLink
        ? 'Transaction saved + linked to ' + (invoiceToLink.customer_name || ('#' + invoiceToLink.order_number)) + ' ✓'
        : 'Transaction saved ✓');
      setFormData({});
      setTimeout(() => loadAllData(), 500);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleEditTreasury = async (txn) => {
    try {
      const fd = {
        date: formData.txEditDate || txn.transaction_date,
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
        bank_in:  fd.bankIn  != null ? Number(fd.bankIn)  : txn.bank_in,
        bank_out: fd.bankOut != null ? Number(fd.bankOut) : txn.bank_out,
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
          
          // Create/update rule — "income" if money flowed in (cash or bank), else "expense"
          const inflow = Number(txn.cash_in || 0) + Number(txn.bank_in || 0);
          const ruleType = inflow > 0 ? 'income' : 'expense';
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

      // If this edit changed an amount on a linked row, recalc the invoice
      if (txn.linked_invoice_id && (fd.cashIn != null || fd.bankIn != null)) {
        try { await recalcInvoiceCollected(txn.linked_invoice_id); } catch(e) {}
      }

      setEditingTxn(null);
      setFormData({});
      setTimeout(() => loadAllData(), 800);
    } catch (err) {
      toast.error(err.message);
    }
  };

  // ── Treasury ↔ Invoice Linking ──
  const linkTreasuryToInvoice = async (txnId, invoiceId) => {
    try {
      const txn = treasury.find(t => t.id === txnId);
      if (!txn) return;
      // If already linked to this invoice, skip
      if (txn.linked_invoice_id === invoiceId) { toast.info('Already linked to this invoice'); return; }
      // If linked to a different invoice, unlink old first then recalc old
      const oldInvoiceId = txn.linked_invoice_id;
      // Set the new link
      await dbUpdate('treasury', txnId, { linked_invoice_id: invoiceId }, userProfile?.id || user?.id);
      // Recalculate old invoice if was linked elsewhere
      if (oldInvoiceId && oldInvoiceId !== invoiceId) await recalcInvoiceCollected(oldInvoiceId);
      // Recalculate new invoice
      await recalcInvoiceCollected(invoiceId);
      setLinkingTreasuryTxn(null);
      setTreasuryInvSearch('');
      toast.success('Linked ✓');
      await loadAllData();
    } catch (err) { toast.error('Link error: ' + err.message); }
  };

  const unlinkTreasury = async (txnId) => {
    try {
      const txn = treasury.find(t => t.id === txnId);
      if (!txn || !txn.linked_invoice_id) return;
      const invoiceId = txn.linked_invoice_id;
      // Remove the link
      await dbUpdate('treasury', txnId, { linked_invoice_id: null }, userProfile?.id || user?.id);
      // Recalculate invoice collected (will now exclude this entry)
      await recalcInvoiceCollected(invoiceId);
    } catch (err) { alert('Unlink error: ' + err.message); }
  };

  // ── Delete Treasury Transaction ──
  const handleDeleteTreasury = async (txnId) => {
    try {
      const txn = treasury.find(t => t.id === txnId);
      if (!txn) return;
      const invoiceToRecalc = txn.linked_invoice_id || null;
      await dbDelete('treasury', txnId, userProfile?.id || user?.id);
      setTreasury(prev => prev.filter(t => t.id !== txnId));
      setEditTreasuryModal(null);
      // Recalc from DB truth — handles cash_in and bank_in correctly for any channel.
      if (invoiceToRecalc) {
        try { await recalcInvoiceCollected(invoiceToRecalc); } catch(e) {}
      }
    } catch (err) { alert('Delete error / خطأ حذف: ' + err.message); }
  };

  // ── Save Treasury Edit from Modal ──
  const handleSaveTreasuryEdit = async (txnId, updates) => {
    try {
      await dbUpdate('treasury', txnId, updates, userProfile?.id || user?.id);
      setTreasury(prev => prev.map(t => t.id === txnId ? { ...t, ...updates } : t));
      setEditTreasuryModal(null);
    } catch (err) { alert('Save error / خطأ حفظ: ' + err.message); }
  };

  const handleSplitTreasury = async () => {
    if (!splittingTxn) return;
    const txn = splittingTxn;
    const { channel, direction, amount: total } = readTreasuryMoney(txn);
    if (!channel) {
      alert('Cannot split — this row has no amount to split.');
      return;
    }
    const splitTotal = splits.reduce((a, s) => a + (Number(s.amount) || 0), 0);
    if (splitTotal !== total) {
      alert('Split amounts must equal / يجب أن يساوي المجموع ' + total.toLocaleString() + '. Current / الحالي: ' + splitTotal.toLocaleString());
      return;
    }
    if (splits.every(s => !s.order)) {
      alert('Please enter at least one order number / الرجاء إدخال رقم أمر واحد على الأقل');
      return;
    }
    // Bank rows: carry matched_bank_txn_id + bank_account_id onto every split
    // sibling so the audit trail stays intact (one bank statement line → N
    // invoice legs, all demonstrably from the same deposit).
    const bankMeta = channel === 'bank' ? {
      matched_bank_txn_id: txn.matched_bank_txn_id || null,
      bank_account_id: txn.bank_account_id || null,
      is_bank_placeholder: false, // splits always derive from a confirmed row
    } : {};
    try {
      const affectedInvoiceIds = new Set();
      // Track original invoice link for recalc
      if (txn.linked_invoice_id) affectedInvoiceIds.add(txn.linked_invoice_id);

      // Find invoice for each split by order number
      const findInvoice = (orderNum) => orderNum ? invoices.find(i => i.order_number === orderNum) : null;

      // Update original entry to first split
      const inv0 = findInvoice(splits[0].order);
      await dbUpdate('treasury', txn.id, {
        order_number: splits[0].order,
        ...buildSplitAmounts(channel, direction, splits[0].amount),
        ...bankMeta,
        linked_invoice_id: inv0 ? inv0.id : null,
        description: txn.description + ' (split 1/' + splits.length + (channel === 'bank' ? ', bank' : '') + ')',
      }, user?.id);
      if (inv0) affectedInvoiceIds.add(inv0.id);

      // Create new entries for remaining splits
      for (let i = 1; i < splits.length; i++) {
        const invI = findInvoice(splits[i].order);
        await dbInsert('treasury', {
          transaction_date: txn.transaction_date,
          order_number: splits[i].order,
          description: txn.description + ' (split ' + (i + 1) + '/' + splits.length + (channel === 'bank' ? ', bank' : '') + ')',
          ...buildSplitAmounts(channel, direction, splits[i].amount),
          ...bankMeta,
          source: txn.source || 'main',
          linked_invoice_id: invI ? invI.id : null,
        }, user?.id);
        if (invI) affectedInvoiceIds.add(invI.id);
      }

      // Recalc ALL affected invoices (cash AND bank splits count toward collected)
      for (const invId of affectedInvoiceIds) {
        await recalcInvoiceCollected(invId);
      }

      setSplittingTxn(null);
      setSplits([{ order: '', amount: 0 }, { order: '', amount: 0 }]);
      toast.success('Split completed ✓ ' + (channel === 'bank' ? '(bank deposit across ' + splits.length + ' invoices)' : ''));
      await loadAllData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleUnlinkTreasury = async (txn) => {
    const ok = await toast.confirm({ title: 'Unlink Transaction', message: 'Unlink this transaction from order ' + (selectedInvoice?.order_number || '') + '?', confirmText: 'Unlink', danger: true });
    if (!ok) return;
    try {
      const invoiceId = txn.linked_invoice_id || (selectedInvoice ? selectedInvoice.id : null);
      await dbUpdate('treasury', txn.id, { order_number: '', linked_invoice_id: null }, user?.id);
      // Recalc the affected invoice
      if (invoiceId) await recalcInvoiceCollected(invoiceId);
      toast.success('Unlinked ✓');
      await loadAllData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleLinkTreasury = async (txn) => {
    if (!selectedInvoice) return;
    try {
      await dbUpdate('treasury', txn.id, { order_number: selectedInvoice.order_number, linked_invoice_id: selectedInvoice.id }, user?.id);
      await recalcInvoiceCollected(selectedInvoice.id);
      setLinkSearch('');
      setShowLinkSearch(false);
      toast.success('Linked ✓');
      await loadAllData();
    } catch (err) {
      toast.error(err.message);
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
      toast.error(err.message);
    }
  };

  const handleMoveSubcategory = async (subcatName, fromCategory, toCategory) => {
    if (!toCategory || toCategory === fromCategory) return;
    const ok = await toast.confirm({ title: 'Move Subcategory', message: 'Move "' + subcatName + '" from "' + fromCategory + '" to "' + toCategory + '"?', confirmText: 'Move' });
    if (!ok) return;
    try {
      const matching = treasury.filter(t => t.subcategory === subcatName && t.category === fromCategory);
      for (const t of matching) {
        await dbUpdate('treasury', t.id, { category: toCategory }, user?.id);
      }
      setBucketSub(null);
      await loadAllData();
    } catch (err) {
      toast.error(err.message);
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
        } catch (e) { console.warn('Batch tracking failed:', e); }
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
    const ok = await toast.confirm({ title: 'Undo Import', message: 'This will DELETE ' + ids.length + ' records from ' + table + '. This cannot be undone.', confirmText: 'Delete ' + ids.length + ' Records', danger: true });
    if (!ok) return;
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
    } catch (err) { toast.error(err.message); }
  };

  const handleCollectCheck = async () => {
    if (!reconcileCheck || !reconcileDate) { alert('Please select a collection date / الرجاء تحديد تاريخ التحصيل'); return; }
    try {
      // 1. Create treasury entry for the collected check
      const desc = reconcileCheck.customer_name + ' — شيك محصّل' + (reconcileCheck.check_number ? ' #' + reconcileCheck.check_number : '');
      const { data: newTxn } = await supabase.from('treasury').insert({
        transaction_date: reconcileDate,
        order_number: reconcileCheck.order_number || '',
        description: desc,
        cash_in: Number(reconcileCheck.amount),
        cash_out: 0,
        source: 'main',
        category: 'مبيعات',
        linked_invoice_id: reconcileCheck.invoice_id || null,
      }).select('id').single();

      // 2. Mark check as collected + link to the treasury entry
      await dbUpdate('checks', reconcileCheck.id, {
        status: 'collected',
        collection_date: reconcileDate,
        linked_treasury_id: newTxn?.id || null,
      }, user?.id);

      // 3. Recalculate invoice collected from all linked treasury (single source of truth)
      const invId = reconcileCheck.invoice_id;
      const orderNum = reconcileCheck.order_number;
      const inv = invId ? invoices.find(i => i.id === invId) : (orderNum ? invoices.find(i => i.order_number === orderNum) : null);
      if (inv) await recalcInvoiceCollected(inv.id);

      setReconcileCheck(null);
      setReconcileDate('');
      await loadAllData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  // ==========================================
  // UI HELPERS
  // ==========================================
  const ModeBar = () => (
    <div className="flex gap-1 items-center flex-wrap">
      {[['all', 'All / الكل'], ['ytd', 'This Year'], ['1mo', '1 Month'], ['1yr', '1 Year'], ['3yr', '3 Years'], ['custom', 'Custom / مخصص']].map(([v, l]) => (
        <button key={v} onClick={() => setMode(v)}
          className={`px-3 py-1 rounded-md text-xs font-semibold transition ${mode === v ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
        >{l}</button>
      ))}
      {mode === 'custom' && (
        <span className="flex gap-1 items-center">
          <DatePickerSelect value={df} onChange={v => setDf(v)} />
          <span className="text-xs text-slate-400">→</span>
          <DatePickerSelect value={dt} onChange={v => setDt(v)} />
        </span>
      )}
    </div>
  );

  const Sparkline = ({ data, color, w = 80, h = 24 }) => {
    if (!data || data.length < 2) return null;
    const max = Math.max(...data), min = Math.min(...data), range = max - min || 1;
    const divisor = data.length - 1 || 1;
    const pts = data.map((v, i) => `${(i / divisor) * w},${h - ((v - min) / range) * (h - 2) - 1}`).join(' ');
    return <svg width={w} height={h} className="mt-1"><polyline points={pts} fill="none" stroke={color || '#94a3b8'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><circle cx={(w)} cy={parseFloat(pts.split(' ').pop().split(',')[1])} r="2" fill={color || '#94a3b8'} /></svg>;
  };

  const Card = ({ title, titleAr, value, sub, color, onClick, spark }) => (
    <div onClick={onClick}
      className={`bg-white rounded-xl p-5 border-l-4 ${onClick ? 'cursor-pointer hover:shadow-lg hover:-translate-y-0.5 transition-all' : ''}`}
      style={{ borderLeftColor: color || '#0ea5e9' }}
    >
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{title}</div>
      {titleAr && <div className="text-sm font-bold text-slate-900 mt-0.5" style={{ direction: 'rtl' }}>{titleAr}</div>}
      <div className="flex items-end justify-between">
        <div className="text-3xl font-extrabold mt-2" style={{ color: color || '#e2e8f0' }}>{value}</div>
        {spark && <Sparkline data={spark} color={color} />}
      </div>
      {sub && <div className="text-xs text-slate-500 mt-1.5">{sub}</div>}
    </div>
  );

  const StatusBadge = ({ invoice }) => {
    const txns = treasuryByOrder[invoice.order_number] || [];
    const tTotal = txns.reduce((a, t) => a + Number(t.cash_in || 0) + Number(t.bank_in || 0), 0);
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
    <div className="min-h-screen" style={{background:'#0a0e1a'}}>
      <div style={{background:'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)', borderBottom:'1px solid rgba(56,189,248,0.15)'}} className="px-5 py-4 flex justify-between items-center">
        <div>
          <div className="text-2xl font-black" style={{background:'linear-gradient(135deg, #38bdf8, #a78bfa)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>KANDIL KTC EGYPT HUB</div>
          <div className="text-xs mt-1" style={{color:'rgba(148,163,184,0.4)'}}>Initializing system / جاري التحميل...</div>
        </div>
        <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
      </div>
      <DashboardSkeleton />
    </div>
  );

  // ==========================================
  // RENDER
  // ==========================================
  return (
    <ToastProvider>
    <ErrorBoundary label="KTC Hub encountered an error" showDetails>
    <div className="min-h-screen" style={{background:'var(--bg-primary)'}}>
      {/* Header */}
      <div style={{background:'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)', borderBottom:'1px solid rgba(56,189,248,0.15)'}} role="banner" aria-label="App header" className="px-5 py-3 flex justify-between items-center sticky top-0 z-[101]">
        <div className="flex items-center gap-3">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="lg:hidden text-white/70 hover:text-white text-xl p-1">☰</button>
          <div>
            <h1 className="text-xl sm:text-2xl font-black tracking-tight" style={{background:'linear-gradient(135deg, #38bdf8, #818cf8, #a78bfa)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>KANDIL KTC EGYPT HUB</h1>
            <p style={{color:'rgba(148,163,184,0.5)'}} className="text-[10px] font-medium tracking-widest uppercase hidden sm:block">{lang === 'en' ? 'KTC Trading Operations' : 'KTC — لوحة التحكم المالية'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Treasury Net — treasury access only */}
          {(isSuperAdmin || modulePerms?.['Treasury']) && (
          <div onClick={() => { setTab('treasury'); setMode('all'); }} className="cursor-pointer px-2 sm:px-3 py-1.5 rounded-lg" style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)'}}>
            <div style={{color:'rgba(148,163,184,0.5)'}} className="text-[7px] sm:text-[8px] font-bold uppercase tracking-wider">Treasury Net (All Time)</div>
            <div className={'text-xs sm:text-sm font-black'} style={{color: allTimeNet >= 0 ? '#34d399' : '#f87171'}}>{fE(allTimeNet)}</div>
          </div>
          )}
          {userProfile && (
            <div className="text-right">
              <div className="text-sm font-bold" style={{color:'#f1f5f9'}}>{userProfile?.name}</div>
              <div style={{color:'rgba(148,163,184,0.6)'}} className="text-[10px]">{userProfile?.role === 'super_admin' ? '🔴 Super Admin' : userProfile?.role === 'admin' ? '🟣 Admin' : '🔵 Team'}</div>
            </div>
          )}
          {(true) && (
            <button onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
              style={{background: lang === 'en' ? 'linear-gradient(135deg, #0ea5e9, #6366f1)' : 'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', color: lang === 'en' ? 'white' : 'rgba(255,255,255,0.6)'}}
              className="px-3 py-1.5 rounded-lg text-xs font-bold transition">
              {lang === 'ar' ? '🌐 EN' : '🌐 AR'}
            </button>
          )}
          <button onClick={() => setShowGlobalSearch(true)} style={{background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.6)'}} className="px-3 py-1.5 text-xs rounded-lg font-medium hover:bg-white/10 transition flex items-center gap-1.5">
            🔍 <span className="hidden sm:inline">Search</span> <kbd className="text-[9px] bg-white/10 px-1 rounded">⌘K</kbd>
          </button>
          <NotificationBell userId={userProfile?.id || user?.id} users={teamUsers} />
          {/* Notification Bell */}
          {(() => {
            const overdueCount = invoices.filter(i => i.outstanding > 0 && i.invoice_date && (Date.now() - new Date(i.invoice_date).getTime()) > 30 * 86400000).length;
            const openTickets = dashTickets.filter(t => t.status !== 'Closed' && t.status !== 'Resolved').length;
            const pendingCount = pendingChecks?.length || 0;
            const todayN = new Date().toISOString().substring(0, 10);
            const tomorrowN = new Date(Date.now() + 86400000).toISOString().substring(0, 10);
            const overdueChecks = pendingChecks.filter(c => (c.due_date || c.check_date || '') < todayN && (c.due_date || c.check_date));
            const dueTomorrowChecks = pendingChecks.filter(c => (c.due_date || c.check_date || '') === tomorrowN);
            const thisMonthChecks = pendingChecks.filter(c => (c.due_date || c.check_date || '').substring(0, 7) === todayN.substring(0, 7));
            const total = overdueCount + openTickets + overdueChecks.length + dueTomorrowChecks.length;
            return (
              <div className="relative notif-bell-wrap">
                <button onClick={() => setShowNotifBell(!showNotifBell)} style={{background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.6)'}} className="px-2.5 py-1.5 text-sm rounded-lg hover:bg-white/10 transition relative">
                  🔔
                  {total > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center">{total > 9 ? '9+' : total}</span>}
                </button>
                {showNotifBell && (
                  <div className="absolute right-0 top-10 w-72 bg-white rounded-xl shadow-2xl border z-50 overflow-hidden">
                    <div className="px-3 py-2 bg-slate-50 border-b text-xs font-bold text-slate-700">Notifications</div>
                    <div className="max-h-[300px] overflow-auto">
                      {overdueChecks.length > 0 && (
                        <div className="px-3 py-2.5 border-b border-slate-50 hover:bg-red-50 cursor-pointer" onClick={() => { setTab('checks'); setShowNotifBell(false); }}>
                          <div className="text-xs font-semibold text-red-600">🚨 {overdueChecks.length} OVERDUE checks — {fE(overdueChecks.reduce((a,c) => a + Number(c.amount||0), 0))}</div>
                          <div className="text-[10px] text-slate-400">Past due date, not collected</div>
                        </div>
                      )}
                      {dueTomorrowChecks.length > 0 && (
                        <div className="px-3 py-2.5 border-b border-slate-50 hover:bg-amber-50 cursor-pointer" onClick={() => { setTab('checks'); setShowNotifBell(false); }}>
                          <div className="text-xs font-semibold text-amber-600">⏰ {dueTomorrowChecks.length} checks due TOMORROW — {fE(dueTomorrowChecks.reduce((a,c) => a + Number(c.amount||0), 0))}</div>
                          <div className="text-[10px] text-slate-400">Collect these tomorrow</div>
                        </div>
                      )}
                      {thisMonthChecks.length > 0 && (
                        <div className="px-3 py-2.5 border-b border-slate-50 hover:bg-blue-50 cursor-pointer" onClick={() => { setTab('checks'); setShowNotifBell(false); }}>
                          <div className="text-xs font-semibold text-blue-600">📅 {thisMonthChecks.length} checks due this month — {fE(thisMonthChecks.reduce((a,c) => a + Number(c.amount||0), 0))}</div>
                          <div className="text-[10px] text-slate-400">Expected income this month</div>
                        </div>
                      )}
                      {overdueCount > 0 && (
                        <div className="px-3 py-2.5 border-b border-slate-50 hover:bg-red-50 cursor-pointer" onClick={() => { setTab('sales'); setShowNotifBell(false); }}>
                          <div className="text-xs font-semibold text-red-600">⚠️ {overdueCount} overdue invoices</div>
                          <div className="text-[10px] text-slate-400">30+ days past invoice date</div>
                        </div>
                      )}
                      {openTickets > 0 && (
                        <div className="px-3 py-2.5 border-b border-slate-50 hover:bg-blue-50 cursor-pointer" onClick={() => { setTab('tickets'); setShowNotifBell(false); }}>
                          <div className="text-xs font-semibold text-blue-600">🎫 {openTickets} open tickets</div>
                          <div className="text-[10px] text-slate-400">Awaiting resolution</div>
                        </div>
                      )}
                      {total === 0 && pendingCount === 0 && <div className="px-3 py-6 text-center text-xs text-slate-400">All clear! ✨</div>}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
          <button onClick={handleSignOut} style={{background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.7)'}} className="px-3 py-1.5 text-xs rounded-lg font-medium hover:bg-white/10 transition hidden sm:block">
            Sign Out
          </button>
        </div>
      </div>

      {/* Global Search Modal */}
      {showGlobalSearch && (
        <div className="fixed inset-0 bg-black/60 z-[200] flex items-start justify-center pt-[15vh] px-4" onClick={() => setShowGlobalSearch(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 px-4 py-3 border-b">
              <span className="text-lg">🔍</span>
              <input autoFocus value={globalSearch} onChange={e => setGlobalSearch(e.target.value)} placeholder="Search invoices, customers, tickets, bank..." aria-label="Global search" className="flex-1 outline-none text-sm" />
              <button onClick={() => setShowGlobalSearch(false)} className="text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded">ESC</button>
            </div>
            {globalSearch.length >= 2 && (() => {
              const q = globalSearch.toLowerCase();
              const invResults = (invoices || []).filter(i => [i.invoice_number, i.order_number, i.customer, i.customer_name, i.customer_name_en].filter(Boolean).join(' ').toLowerCase().includes(q)).slice(0, 5);
              const custResults = (customers || []).filter(c => [c.name, c.customer_name, c.phone, c.email].filter(Boolean).join(' ').toLowerCase().includes(q)).slice(0, 5);
              const tickResults = (dashTickets || []).filter(t => [t.title, t.ticket_number, t.description].filter(Boolean).join(' ').toLowerCase().includes(q)).slice(0, 5);
              const bankResults = (egyptBankTxns || []).filter(t => [t.description, t.date, String(t.amount||'')].filter(Boolean).join(' ').toLowerCase().includes(q)).slice(0, 5);
              const tresResults = (treasury || []).filter(t => [t.description, t.order_number, t.transaction_date].filter(Boolean).join(' ').toLowerCase().includes(q)).slice(0, 5);
              const total = invResults.length + custResults.length + tickResults.length + bankResults.length + tresResults.length;
              return (
                <div className="max-h-[50vh] overflow-auto">
                  {invResults.length > 0 && <div className="px-3 py-1.5 bg-slate-50 text-[9px] font-bold text-slate-500 uppercase sticky top-0">💰 Invoices</div>}
                  {invResults.map(i => (
                    <div key={i.id} className="px-4 py-2.5 border-b border-slate-50 hover:bg-blue-50 cursor-pointer" onClick={() => { setTab('sales'); setSelectedInvoice(i); setShowGlobalSearch(false); setGlobalSearch(''); }}>
                      <div className="text-xs font-semibold">{i.invoice_number || i.order_number} — {i.customer || i.customer_name}</div>
                      <div className="text-[10px] text-slate-400">{i.invoice_date} · {fE(i.amount || i.total_amount)}</div>
                    </div>
                  ))}
                  {custResults.length > 0 && <div className="px-3 py-1.5 bg-slate-50 text-[9px] font-bold text-slate-500 uppercase sticky top-0">👥 Customers</div>}
                  {custResults.map(c => (
                    <div key={c.id} className="px-4 py-2.5 border-b border-slate-50 hover:bg-blue-50 cursor-pointer" onClick={() => { setTab('customers'); setShowGlobalSearch(false); setGlobalSearch(''); }}>
                      <div className="text-xs font-semibold">{c.name || c.customer_name}</div>
                      <div className="text-[10px] text-slate-400">{c.phone || ''} {c.email || ''}</div>
                    </div>
                  ))}
                  {tickResults.length > 0 && <div className="px-3 py-1.5 bg-slate-50 text-[9px] font-bold text-slate-500 uppercase sticky top-0">🎫 Tickets</div>}
                  {tickResults.map(t => (
                    <div key={t.id} className="px-4 py-2.5 border-b border-slate-50 hover:bg-blue-50 cursor-pointer" onClick={() => { setTab('tickets'); setOpenTicketId(t.id); setShowGlobalSearch(false); setGlobalSearch(''); }}>
                      <div className="text-xs font-semibold">#{t.ticket_number} {t.title}</div>
                      <div className="text-[10px] text-slate-400">{t.status} · {t.priority}</div>
                    </div>
                  ))}
                  {bankResults.length > 0 && <div className="px-3 py-1.5 bg-slate-50 text-[9px] font-bold text-slate-500 uppercase sticky top-0">🏦 Egypt Bank</div>}
                  {bankResults.map(t => (
                    <div key={t.id} className="px-4 py-2.5 border-b border-slate-50 hover:bg-blue-50 cursor-pointer" onClick={() => { setTab('egyptbank'); setShowGlobalSearch(false); setGlobalSearch(''); }}>
                      <div className="text-xs font-semibold">{t.description}</div>
                      <div className="text-[10px] text-slate-400">{t.date} · {fE(t.amount)}</div>
                    </div>
                  ))}
                  {tresResults.length > 0 && <div className="px-3 py-1.5 bg-slate-50 text-[9px] font-bold text-slate-500 uppercase sticky top-0">💵 Treasury</div>}
                  {tresResults.map(t => (
                    <div key={t.id} className="px-4 py-2.5 border-b border-slate-50 hover:bg-blue-50 cursor-pointer" onClick={() => { setTab('treasury'); setShowGlobalSearch(false); setGlobalSearch(''); }}>
                      <div className="text-xs font-semibold">{t.description}</div>
                      <div className="text-[10px] text-slate-400">{t.transaction_date} · {fE(t.cash_in || t.cash_out)}</div>
                    </div>
                  ))}
                  {total === 0 && <div className="px-4 py-8 text-center text-sm text-slate-400">No results for "{globalSearch}"</div>}
                </div>
              );
            })()}
            {globalSearch.length < 2 && (
              <div className="px-4 py-4">
                <div className="text-center text-xs text-slate-400 mb-4">Type at least 2 characters to search</div>
                <div className="border-t border-slate-100 pt-3">
                  <div className="text-[10px] font-bold text-slate-400 mb-2 uppercase">Keyboard Shortcuts</div>
                  <div className="grid grid-cols-2 gap-1 text-[11px]">
                    {[
                      ['⌘K', 'Search'], ['Esc', 'Close'],
                      ['Alt+D', 'Dashboard'], ['Alt+S', 'Sales'],
                      ['Alt+T', 'Treasury'], ['Alt+C', 'CRM'],
                      ['Alt+K', 'Tickets'], ['Alt+A', 'Admin'],
                      ['Alt+N', 'New Item'], ['Alt+R', 'Refresh Data'],
                    ].map(([key, label]) => (
                      <div key={key} className="flex justify-between py-0.5">
                        <kbd className="px-1.5 py-0.5 bg-slate-100 rounded text-[9px] font-mono font-bold text-slate-600">{key}</kbd>
                        <span className="text-slate-500">{label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mobile sidebar overlay */}
      {sidebarOpen && <div className="fixed inset-0 top-[56px] bg-black/50 z-[99] lg:hidden" onClick={() => setSidebarOpen(false)} />}

      <div className="flex flex-1" style={{ minHeight: 'calc(100vh - 60px)' }}>
        {/* Sidebar */}
        <aside role="navigation" aria-label="Main navigation" className={'fixed lg:sticky top-[56px] lg:top-[56px] left-0 z-[100] lg:z-10 overflow-y-auto transition-transform duration-200 ' + (sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0')}
          style={{ width: 210, height: 'calc(100vh - 56px)', background: 'linear-gradient(180deg, #0f172a 0%, #1e1b4b 100%)', borderRight: '1px solid rgba(56,189,248,0.1)' }}>
          <div className="py-3">
            {[
              { group: 'Overview', items: ['dashboard'] },
              { group: 'Finance', items: ['sales', 'treasury', 'checks', 'debts', 'egyptbank', 'bank', 'quotes', 'reports'] },
              { group: 'Operations', items: ['warehouse', 'inventory', 'customs', 'shipping'] },
              { group: 'People', items: ['customers', 'crm', 'tickets', 'calendar', 'comms', 'dailylog'] },
              { group: 'System', items: ['admin', 'ai', 'settings', 'import', 'systemtickets'] },
            ].map(g => {
              const groupTabs = g.items.map(id => visibleTabs.find(t => t.id === id)).filter(Boolean);
              if (!groupTabs.length) return null;
              return (
                <div key={g.group} className="mb-2">
                  <div className="px-4 py-1.5 text-[9px] font-bold uppercase tracking-widest" style={{ color: 'rgba(148,163,184,0.4)' }}>{g.group}</div>
                  {groupTabs.map(t => (
                    <button key={t.id} onClick={() => { navigate(t.id); setSidebarOpen(false); }}
                      className={'w-full text-left px-4 py-2 text-xs font-medium flex items-center gap-2 transition-colors ' + (tab === t.id
                        ? 'text-white bg-white/10 border-r-2 border-blue-400'
                        : 'text-slate-400 hover:text-white hover:bg-white/5'
                      )}>
                      <span className="text-sm">{t.icon}</span>
                      <span className="truncate">
                        <span>{t.label.split(' / ')[0]}</span>
                        {t.label.includes(' / ') && <span className="text-[8px] text-slate-500 block" style={{direction:'rtl'}}>{t.label.split(' / ')[1]}</span>}
                      </span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
          {/* Sign Out at bottom of sidebar */}
          <div className="px-4 py-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
            <button onClick={handleSignOut} className="w-full px-3 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-white/5 transition text-left flex items-center gap-2">
              🚪 <span>{lang === 'en' ? 'Sign Out' : 'تسجيل خروج'}</span>
            </button>
          </div>
        </aside>

        {/* Content */}
        <main role="main" aria-label="Content area" className="flex-1 p-4 max-w-7xl mx-auto lg:ml-0" style={{ minWidth: 0 }}>

          {/* Breadcrumb */}
          {tab !== 'dashboard' && (
            <div className="flex items-center gap-2 mb-3 text-xs">
              <button onClick={() => navigate('dashboard')} className="text-blue-500 hover:underline font-medium">Dashboard</button>
              <span className="text-slate-300">/</span>
              <span className="text-slate-400">{currentGroup}</span>
              <span className="text-slate-300">/</span>
              <span className="font-bold text-slate-700">{currentTabLabel}</span>
              {tab === 'treasury' && (
                <button onClick={() => exportExcel(filteredTreasury.map(t => {
                  const isBank = Number(t.bank_in || 0) > 0 || Number(t.bank_out || 0) > 0 || t.is_bank_placeholder || t.matched_bank_txn_id;
                  return {
                    Date: t.transaction_date,
                    Order: t.order_number,
                    Description: t.description,
                    Channel: isBank ? 'BANK' : 'SAFE',
                    'Cash Method': t.cash_method || '',
                    'Cash In': t.cash_in,
                    'Cash Out': t.cash_out,
                    'Bank In': t.bank_in || 0,
                    'Bank Out': t.bank_out || 0,
                    'Bank Non-Order Cat': t.bank_nonorder_category || '',
                    Category: t.category,
                    Subcategory: t.subcategory,
                    Currency: t.currency || 'EGP',
                  };
                }), 'Treasury_Export', 'Treasury')}
                  className="ml-auto px-3 py-1 rounded-lg bg-emerald-500 text-white text-[10px] font-bold hover:bg-emerald-600 flex items-center gap-1">📊 Export Excel</button>
              )}
              {tab === 'sales' && (
                <button onClick={() => exportExcel(filteredInvoices.map(i => ({ Date: i.invoice_date, Order: i.order_number, Customer: i.customer_name, Amount: i.total_amount, Collected: i.total_collected, Outstanding: i.outstanding })), 'Invoices_Export', 'Invoices')}
                  className="ml-auto px-3 py-1 rounded-lg bg-emerald-500 text-white text-[10px] font-bold hover:bg-emerald-600 flex items-center gap-1">📊 Export Excel</button>
              )}
              {tab === 'tickets' && (
                <button onClick={() => exportExcel(dashTickets.map(t => ({ Number: t.ticket_number, Title: t.title, Status: t.status, Priority: t.priority, Assigned: getUserName(t.assigned_to), Created: t.created_at, Due: t.due_date, Client: t.client_name })), 'Tickets_Export', 'Tickets')}
                  className="ml-auto px-3 py-1 rounded-lg bg-emerald-500 text-white text-[10px] font-bold hover:bg-emerald-600 flex items-center gap-1">📊 Export Excel</button>
              )}
            </div>
          )}

          {/* Tab loading indicator */}
          {tabLoading && (
            <div className="h-0.5 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 rounded-full mb-3 animate-pulse" />
          )}

        {/* ==========================================
            INVOICE DETAIL MODAL
        ========================================== */}
        {selectedInvoice && (
          <Modal onClose={() => {
            if (treasuryReturnState) { returnToTreasury(); return; }
            setSelectedInvoice(null); setShowAddPayment(false); setFormData({}); setEditingTxn(null); setShowLinkSearch(false); setLinkSearch('');
          }}
            title={`Invoice / فاتورة #${selectedInvoice.order_number}`}>
            {treasuryReturnState && (
              <div className="mb-3">
                <button onClick={returnToTreasury}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-extrabold hover:bg-indigo-700 shadow">
                  ← Back to Treasury / عودة للخزنة
                </button>
              </div>
            )}
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
                    } catch (err) { toast.error(err.message); }
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
            {/* Edit Fields + Delete + PDF Export */}
            {(() => {
              const hasDeletePerm = userProfile?.role === 'super_admin' || ((selectedInvoice.created_by === (userProfile?.id || user?.id)) && (Date.now() - new Date(selectedInvoice.created_at || 0).getTime()) < 86400000);
              const exportPDF = () => {
                const inv = selectedInvoice;
                const items = invoiceItems.filter(it => it.invoice_id === inv.id || it.order_number === inv.order_number);
                const w = window.open('', '_blank');
                w.document.write('<html><head><style>body{font-family:Arial,sans-serif;padding:40px;color:#1e293b}h1{font-size:24px;color:#0ea5e9;margin:0}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{border:1px solid #e2e8f0;padding:8px 12px;font-size:13px}th{background:#f1f5f9;font-weight:600;text-align:left}.r{text-align:right}.lg{font-size:18px;font-weight:700}.meta{color:#64748b;font-size:12px;margin:3px 0}</style></head><body>'
                  + '<h1>KTC Trading Operations</h1><p class="meta">Invoice / فاتورة</p><hr style="border-color:#e2e8f0;margin:12px 0"/>'
                  + '<table><tr><td><strong>Invoice #</strong><br/>' + (inv.invoice_number || inv.order_number) + '</td>'
                  + '<td><strong>Date</strong><br/>' + (inv.invoice_date || '') + '</td>'
                  + '<td><strong>Customer</strong><br/>' + (inv.customer_name || inv.customer || '') + '</td></tr></table>'
                  + (items.length > 0 ? '<table><tr><th>Item</th><th>Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr>'
                    + items.map(function(it) { return '<tr><td>' + (it.description || it.item_name || '') + '</td><td>' + (it.quantity || '') + '</td><td class="r">' + Number(it.unit_price || 0).toLocaleString() + '</td><td class="r">' + Number(it.total || it.amount || 0).toLocaleString() + '</td></tr>'; }).join('')
                    + '</table>' : '')
                  + '<table><tr><td><strong>Total</strong></td><td class="r lg">EGP ' + Number(inv.amount || inv.total_amount || 0).toLocaleString() + '</td></tr>'
                  + '<tr><td>Collected</td><td class="r">EGP ' + Number(inv.total_collected || 0).toLocaleString() + '</td></tr>'
                  + '<tr><td><strong>Outstanding</strong></td><td class="r" style="color:#ef4444;font-weight:700">EGP ' + Number(inv.outstanding || 0).toLocaleString() + '</td></tr></table>'
                  + '<p class="meta" style="margin-top:30px">Generated by KTC NextTrade Hub — ' + new Date().toLocaleDateString() + '</p></body></html>');
                w.document.close();
                setTimeout(function() { w.print(); }, 500);
              };
              return (
                <div className="mb-3">
                  {/* Action buttons */}
                  <div className="flex justify-end gap-2 mb-3">
                    <button onClick={exportPDF} className="px-3 py-1 bg-blue-500 text-white rounded-lg text-[10px] font-bold hover:bg-blue-600">
                      📄 Print / PDF
                    </button>
                    <button onClick={() => setFormData({...formData, editingInvoice: !formData.editingInvoice})}
                      className="px-3 py-1 bg-amber-500 text-white rounded-lg text-[10px] font-bold hover:bg-amber-600">
                      {formData.editingInvoice ? '✕ Close Edit' : '✏️ Edit Invoice'}
                    </button>
                    {hasDeletePerm && !formData.confirmDeleteInv && (
                      <button onClick={() => setFormData({...formData, confirmDeleteInv: true})}
                        className="px-3 py-1 bg-red-500 text-white rounded-lg text-[10px] font-bold hover:bg-red-600">
                        🗑️ Delete
                      </button>
                    )}
                  </div>
                  {/* Delete confirmation */}
                  {formData.confirmDeleteInv && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-3">
                      <div className="text-sm font-bold text-red-700 mb-2">Delete invoice #{selectedInvoice.order_number}? / حذف الفاتورة؟</div>
                      <div className="text-xs text-red-600 mb-3">This cannot be undone. All line items will also be deleted.</div>
                      <div className="flex gap-2">
                        <button onClick={async () => {
                          try {
                            await supabase.from('invoice_items').delete().eq('invoice_id', selectedInvoice.id);
                            await supabase.from('invoices').delete().eq('id', selectedInvoice.id);
                            setSelectedInvoice(null); setFormData({});
                            await loadAllData();
                          } catch(err) { toast.error(err.message); }
                        }} className="px-4 py-2 bg-red-500 text-white rounded-lg text-xs font-bold">Yes, Delete / نعم، حذف</button>
                        <button onClick={() => setFormData({...formData, confirmDeleteInv: false})}
                          className="px-4 py-2 border border-slate-200 rounded-lg text-xs font-semibold">Cancel / إلغاء</button>
                      </div>
                    </div>
                  )}
                  {/* Edit fields */}
                  {formData.editingInvoice && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-3">
                      <h4 className="text-xs font-bold text-amber-800 mb-3">Edit Invoice Details / تعديل الفاتورة</h4>
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <div>
                          <label className="text-[10px] font-bold text-slate-500">Order # / رقم الأمر</label>
                          <input defaultValue={selectedInvoice.order_number || ''} id="inv-edit-order"
                            className="w-full px-3 py-2 rounded-lg border text-sm" />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-500">Date / التاريخ</label>
                          <DatePickerSelect value={formData.invEditDate || selectedInvoice.invoice_date || today()}
                            onChange={v => setFormData({...formData, invEditDate: v})} />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-500">Total Amount / المبلغ</label>
                          <input type="number" defaultValue={selectedInvoice.total_amount || 0} id="inv-edit-amount"
                            className="w-full px-3 py-2 rounded-lg border text-sm font-semibold" />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-500">Sales Rep / المندوب</label>
                          <input defaultValue={selectedInvoice.sales_rep || ''} id="inv-edit-rep"
                            className="w-full px-3 py-2 rounded-lg border text-sm" />
                        </div>
                        <div className="col-span-2">
                          <label className="text-[10px] font-bold text-slate-500">Notes / ملاحظات</label>
                          <input defaultValue={selectedInvoice.notes || ''} id="inv-edit-notes"
                            className="w-full px-3 py-2 rounded-lg border text-sm" />
                        </div>
                      </div>
                      <button onClick={async () => {
                        try {
                          const newOrder = document.getElementById('inv-edit-order')?.value?.trim();
                          const newAmount = Number(document.getElementById('inv-edit-amount')?.value) || selectedInvoice.total_amount;
                          const newDate = formData.invEditDate || selectedInvoice.invoice_date;
                          const newRep = document.getElementById('inv-edit-rep')?.value?.trim();
                          const newNotes = document.getElementById('inv-edit-notes')?.value?.trim();
                          const updates = {
                            order_number: newOrder || selectedInvoice.order_number,
                            invoice_date: newDate,
                            total_amount: newAmount,
                            outstanding: Math.max(0, newAmount - Number(selectedInvoice.total_collected || 0)),
                            sales_rep: newRep || '',
                            notes: newNotes || '',
                          };
                          await dbUpdate('invoices', selectedInvoice.id, updates, userProfile?.id || user?.id);
                          setSelectedInvoice({...selectedInvoice, ...updates});
                          setFormData({...formData, editingInvoice: false, invEditDate: null});
                          setTimeout(() => loadAllData(), 500);
                        } catch(err) { toast.error(err.message); }
                      }} className="px-4 py-2 bg-amber-500 text-white rounded-lg text-xs font-bold hover:bg-amber-600">
                        💾 Save Changes / حفظ التعديلات
                      </button>
                    </div>
                  )}
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
                    } catch(err) { toast.error(err.message); }
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
                  } catch(err) { toast.error(err.message); }
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
              const tTotal = txns.reduce((a, t) => a + Number(t.cash_in || 0) + Number(t.bank_in || 0), 0);
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

            {/* Post-dated Checks for this order */}
            {(() => {
              const orderChecks = checks.filter(c => c.order_number === selectedInvoice.order_number || c.invoice_id === selectedInvoice.id);
              const pendingOC = orderChecks.filter(c => c.status === 'pending');
              const collectedOC = orderChecks.filter(c => c.status === 'collected');
              if (orderChecks.length === 0) return null;
              return (
                <div className="bg-amber-50 rounded-lg p-4 mb-4 border border-amber-200">
                  <h4 className="text-sm font-bold text-amber-800 mb-2">📝 Post-dated Checks / شيكات آجلة ({orderChecks.length})</h4>
                  {pendingOC.length > 0 && (
                    <div className="mb-2">
                      <div className="text-[10px] font-bold text-amber-600 mb-1">Pending / معلقة ({pendingOC.length}) — {fE(pendingOC.reduce((a,c) => a + Number(c.amount||0), 0))}</div>
                      {pendingOC.map(c => (
                        <div key={c.id} className="flex justify-between items-center py-1.5 border-b border-amber-100 text-xs">
                          <div>
                            <span className="font-semibold">{fE(c.amount)}</span>
                            <span className="text-slate-400 ml-2">Due: {c.due_date || c.check_date}</span>
                            {c.check_number && <span className="text-slate-400 ml-2">#{c.check_number}</span>}
                            {c.bank_name && <span className="text-blue-400 ml-2">{c.bank_name}</span>}
                          </div>
                          <button onClick={() => { setReconcileCheck(c); setReconcileDate(today()); }}
                            className="px-2 py-0.5 bg-emerald-500 text-white rounded text-[10px] font-semibold">✓ Collect</button>
                        </div>
                      ))}
                    </div>
                  )}
                  {collectedOC.length > 0 && (
                    <div>
                      <div className="text-[10px] font-bold text-emerald-600 mb-1">Collected / محصّلة ({collectedOC.length}) — {fE(collectedOC.reduce((a,c) => a + Number(c.amount||0), 0))}</div>
                      {collectedOC.map(c => (
                        <div key={c.id} className="flex justify-between py-1 text-xs text-emerald-600">
                          <span>{fE(c.amount)}{c.check_number ? ' #' + c.check_number : ''}</span>
                          <span>Collected {c.collection_date} ✓</span>
                        </div>
                      ))}
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
                              } catch(err) { toast.error(err.message); }
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
                            <DatePickerSelect value={formData.txEditDate || txn.transaction_date || today()}
                              onChange={v => setFormData({...formData, txEditDate: v})} />
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
                        <button onClick={() => setInspectedTreasury(txn)}
                          className="px-2 py-0.5 rounded border border-indigo-300 text-indigo-600 text-[10px] mr-1 hover:bg-indigo-50" title="Inspect / فحص">
                          ⓘ Inspect
                        </button>
                        <button onClick={() => { setEditingTxn(txn.id); setFormData({ txEditDate: txn.transaction_date }); }}
                          className="px-2 py-0.5 rounded border border-blue-300 text-blue-600 text-[10px] mr-1 hover:bg-blue-50">
                          Edit
                        </button>
                        <button onClick={() => { setSplittingTxn(txn); const m = readTreasuryMoney(txn); setSplits([{ order: txn.order_number || '', amount: m.amount }, { order: '', amount: 0 }]); }}
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
                    {fE((treasuryByOrder[selectedInvoice.order_number] || []).reduce((a, t) => a + Number(t.cash_in || 0) + Number(t.bank_in || 0), 0))}
                  </span>
                </div>
              </div>
            )}

            {/* Egypt Bank Linked Entries */}
            {(() => {
              const ebLinked = egyptBankTxns.filter(t => t.matched_invoice_id === selectedInvoice.id);
              if (ebLinked.length === 0) return null;
              return (
                <div className="bg-emerald-50 rounded-lg p-4 mb-4 border border-emerald-200">
                  <h4 className="text-sm font-bold text-emerald-800 mb-2">🇪🇬 Egypt Bank Payments / مدفوعات بنكية</h4>
                  {ebLinked.map(txn => (
                    <div key={txn.id} className="flex justify-between items-center py-1.5 border-b border-emerald-100">
                      <div className="flex-1">
                        <div className="text-xs font-semibold">{txn.description}</div>
                        <div className="text-[10px] text-slate-500">{txn.date}</div>
                      </div>
                      <div className="text-right flex items-center gap-2">
                        <span className="text-sm font-bold text-emerald-600">{fE(txn.amount)}</span>
                        <button onClick={async () => {
                          try {
                            await dbUpdate('egypt_bank_transactions', txn.id, { matched_invoice_id: null, matched_at: null, matched_by: null }, userProfile?.id);
                            const newCollected = Math.max(0, Number(selectedInvoice.total_collected || 0) - Number(txn.amount));
                            await dbUpdate('invoices', selectedInvoice.id, { total_collected: newCollected }, userProfile?.id);
                            setSelectedInvoice({...selectedInvoice, total_collected: newCollected});
                            setEgyptBankTxns(prev => prev.map(t => t.id === txn.id ? {...t, matched_invoice_id: null} : t));
                          } catch(err) { alert(err.message); }
                        }} className="text-[10px] text-red-400 underline">unlink</button>
                      </div>
                    </div>
                  ))}
                  <div className="flex justify-between pt-2 mt-1 border-t-2 border-emerald-300">
                    <span className="text-xs font-bold">Egypt Bank Total</span>
                    <span className="text-sm font-extrabold text-emerald-600">{fE(ebLinked.reduce((a, t) => a + Number(t.amount), 0))}</span>
                  </div>
                </div>
              );
            })()}

            {/* Link Existing Transaction */}
            {!showLinkSearch ? (
              <button onClick={() => { setShowLinkSearch(true); setLinkSearch(''); }}
                className="px-4 py-2 bg-purple-500 text-white rounded-lg font-semibold text-sm hover:bg-purple-600 transition mb-3 mr-2">
                🔗 Link Transaction / ربط معاملة
              </button>
            ) : (
              <div className="bg-purple-50 rounded-lg p-4 border border-purple-200 mb-3">
                <h4 className="text-sm font-bold text-purple-800 mb-1">Search Treasury & Bank to Link / بحث للربط</h4>
                <input value={linkSearch} onChange={e => setLinkSearch(e.target.value)}
                  placeholder="Search name, date, amount / بحث بالاسم أو التاريخ أو المبلغ"
                  className="dark-input"
                  autoFocus />
                {linkSearch.length >= 2 && (() => {
                  const words = linkSearch.split(/\s+/).filter(w => w.length > 0);
                  const treasuryResults = treasury
                    .filter(t => (!t.order_number || t.order_number === '') && Number(t.cash_in) > 0)
                    .filter(t => {
                      const haystack = [t.description || '', t.transaction_date || '', String(t.cash_in || 0)].join(' ');
                      return words.every(w => haystack.includes(w));
                    }).slice(0, 15);
                  const egyptResults = egyptBankTxns
                    .filter(t => Number(t.amount) > 0 && !t.hidden)
                    .filter(t => {
                      const haystack = [t.description || '', t.date || '', String(t.amount || 0)].join(' ');
                      return words.every(w => haystack.includes(w));
                    }).slice(0, 20);
                  return (
                    <div className="max-h-[300px] overflow-auto rounded border border-purple-200 bg-white">
                      {treasuryResults.length > 0 && (
                        <div className="px-2 py-1 bg-slate-100 text-[9px] font-bold text-slate-500 uppercase sticky top-0">💰 Treasury / الخزنة</div>
                      )}
                      {treasuryResults.map(txn => (
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
                      {egyptResults.length > 0 && (
                        <div className="px-2 py-1 bg-emerald-100 text-[9px] font-bold text-emerald-700 uppercase sticky top-0">🇪🇬 Egypt Bank / بنك مصر</div>
                      )}
                      {egyptResults.map(txn => {
                        const alreadyLinked = txn.matched_invoice_id;
                        const linkedToThis = txn.matched_invoice_id === selectedInvoice.id;
                        const linkedInv = alreadyLinked ? (invoices || []).find(i => i.id === txn.matched_invoice_id) : null;
                        return (
                        <div key={'eb_'+txn.id} className="flex justify-between items-center px-3 py-2 border-b border-slate-50 hover:bg-emerald-50" style={{ opacity: alreadyLinked && !linkedToThis ? 0.6 : 1 }}>
                          <div className="flex-1">
                            <div className="text-xs font-semibold" style={{ wordBreak: 'break-word' }}>{txn.description}</div>
                            <div className="text-[10px] text-emerald-600">{txn.date} | {fE(txn.amount)} 🇪🇬</div>
                            {linkedToThis && <div className="text-[10px] text-green-600 font-bold">✅ Linked to this invoice</div>}
                            {alreadyLinked && !linkedToThis && <div className="text-[10px] text-amber-500">⚠️ Linked to {linkedInv?.customer || linkedInv?.invoice_number || 'another invoice'}</div>}
                          </div>
                          {!alreadyLinked && (
                          <button onClick={async () => {
                            try {
                              await dbUpdate('egypt_bank_transactions', txn.id, { matched_invoice_id: selectedInvoice.id, matched_at: new Date().toISOString(), matched_by: userProfile?.id }, userProfile?.id);
                              const newCollected = Number(selectedInvoice.total_collected || 0) + Number(txn.amount);
                              await dbUpdate('invoices', selectedInvoice.id, { total_collected: newCollected }, userProfile?.id);
                              setSelectedInvoice({...selectedInvoice, total_collected: newCollected});
                              setEgyptBankTxns(prev => prev.map(t => t.id === txn.id ? {...t, matched_invoice_id: selectedInvoice.id} : t));
                              setShowLinkSearch(false); setLinkSearch('');
                            } catch(err) { toast.error(err.message); }
                          }}
                            className="px-3 py-1.5 bg-emerald-600 text-white rounded text-xs font-semibold hover:bg-emerald-700 ml-2">
                            🔗 Link
                          </button>
                          )}
                        </div>
                        );
                      })}
                      {treasuryResults.length === 0 && egyptResults.length === 0 && (
                        <div className="px-3 py-3 text-xs text-slate-400 text-center">No matching transactions found</div>
                      )}
                    </div>
                  );
                })()}
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
                            <td className="px-2 py-1.5"><DatePickerSelect value={formData.txEditDate || txn.transaction_date || today()}
                              onChange={v => setFormData({...formData, txEditDate: v})} /></td>
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
                            {txn.linked_invoice_id && (() => {
                              const linkedInv = invoices.find(i => i.id === txn.linked_invoice_id);
                              return linkedInv ? (
                                <div className="text-[9px] text-emerald-600 mt-0.5 flex items-center gap-1">
                                  <span>✅ Linked → {linkedInv.customer_name || linkedInv.order_number} ({fE(linkedInv.total_amount)})</span>
                                  <button onClick={(e) => { e.stopPropagation(); unlinkTreasury(txn.id); }}
                                    className="text-red-400 hover:text-red-600 underline ml-1">unlink</button>
                                </div>
                              ) : null;
                            })()}
                          </td>
                          <td className="px-3 py-2 text-xs text-right text-emerald-600 font-semibold">
                            {txn.cash_in > 0 ? fE(txn.cash_in) : ''}
                          </td>
                          <td className="px-3 py-2 text-xs text-right text-red-500 font-semibold">
                            {txn.cash_out > 0 ? fE(txn.cash_out) : ''}
                          </td>
                          <td className="px-3 py-2 flex gap-1 flex-wrap">
                            <button onClick={() => { setEditingTxn(txn.id); setFormData({ txEditDate: txn.transaction_date }); }}
                              className="px-2 py-0.5 rounded border border-blue-300 text-blue-600 text-[10px]">Edit</button>
                            <button onClick={() => { setSplittingTxn(txn); const m = readTreasuryMoney(txn); setSplits([{ order: txn.order_number || '', amount: m.amount }, { order: '', amount: 0 }]); }}
                              className="px-2 py-0.5 rounded border border-purple-300 text-purple-600 text-[10px]">Split</button>
                            {(Number(txn.cash_in) > 0 || Number(txn.bank_in) > 0) && !txn.linked_invoice_id && (
                              <button onClick={() => { setLinkingTreasuryTxn(txn); setTreasuryInvSearch(''); }}
                                className="px-2 py-0.5 rounded border border-emerald-300 text-emerald-600 text-[10px]">🔗 Link</button>
                            )}
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

        {/* EDIT / DELETE TREASURY MODAL */}
        {editTreasuryModal && (() => {
          const txn = editTreasuryModal;
          const isDelete = txn.confirmDelete;
          const isSuperAdmin = userProfile?.role === 'super_admin';
          const isCreator = txn.created_by === (userProfile?.id || user?.id);
          const within24h = (Date.now() - new Date(txn.created_at || 0).getTime()) < 24 * 60 * 60 * 1000;
          const canDeleteTxn = isSuperAdmin || (isCreator && within24h);
          return (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setEditTreasuryModal(null)}>
              <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[85vh] overflow-auto" onClick={e => e.stopPropagation()}>
                <div className="p-4 border-b">
                  <div className="flex justify-between items-center">
                    <h3 className="font-bold text-sm">{isDelete ? '🗑 Delete Transaction / حذف' : '✏️ Edit Transaction / تعديل'}</h3>
                    <button onClick={() => setEditTreasuryModal(null)} className="text-slate-400 text-lg hover:text-slate-600">✕</button>
                  </div>
                </div>
                {isDelete ? (
                  <div className="p-4">
                    {canDeleteTxn ? (
                    <div>
                    <div className="bg-red-50 rounded-lg p-4 mb-4 border border-red-200">
                      <div className="text-sm font-bold text-red-700 mb-2">Are you sure? / هل أنت متأكد؟</div>
                      <div className="text-xs text-slate-600 space-y-1">
                        <div><span className="font-semibold">Date:</span> {txn.transaction_date}</div>
                        <div style={{direction:'rtl'}}><span className="font-semibold">Description:</span> {txn.description}</div>
                        {Number(txn.cash_in) > 0 && <div><span className="font-semibold text-emerald-600">Cash In:</span> {fE(txn.cash_in)}</div>}
                        {Number(txn.cash_out) > 0 && <div><span className="font-semibold text-red-500">Cash Out:</span> {fE(txn.cash_out)}</div>}
                      </div>
                      {txn.linked_invoice_id && (
                        <div className="text-[10px] text-amber-600 mt-2 font-semibold">⚠️ This is linked to an invoice — unlinking will also adjust the collected amount.</div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => handleDeleteTreasury(txn.id)}
                        className="flex-1 px-4 py-2.5 bg-red-500 text-white rounded-lg font-bold text-sm hover:bg-red-600">
                        Delete / حذف
                      </button>
                      <button onClick={() => setEditTreasuryModal(null)}
                        className="flex-1 px-4 py-2.5 border border-slate-200 rounded-lg font-semibold text-sm">
                        Cancel / إلغاء
                      </button>
                    </div>
                    </div>
                    ) : (
                    <div className="bg-slate-50 rounded-lg p-4 text-center">
                      <div className="text-sm font-bold text-slate-500 mb-2">🔒 Cannot delete / لا يمكن الحذف</div>
                      <div className="text-xs text-slate-400">Only super admins or the creator (within 24 hours) can delete.</div>
                      <button onClick={() => setEditTreasuryModal(null)}
                        className="mt-3 px-4 py-2 border border-slate-200 rounded-lg text-xs font-semibold">OK</button>
                    </div>
                    )}
                  </div>
                ) : (
                  <div className="p-4 space-y-3">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500">Date / التاريخ</label>
                      <DatePickerSelect value={txn.transaction_date || today()} onChange={v => setEditTreasuryModal({...txn, transaction_date: v})} />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500">Order # / رقم الأمر</label>
                      <input value={txn.order_number || ''} onChange={e => setEditTreasuryModal({...txn, order_number: e.target.value})}
                        className="w-full px-3 py-2 rounded-lg border text-sm" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500">Description / الوصف</label>
                      <input value={txn.description || ''} onChange={e => setEditTreasuryModal({...txn, description: e.target.value})}
                        className="w-full px-3 py-2 rounded-lg border text-sm" style={{direction:'rtl'}} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] font-bold text-emerald-600">Cash In / وارد</label>
                        <input type="number" value={txn.cash_in || 0} onChange={e => setEditTreasuryModal({...txn, cash_in: Number(e.target.value) || 0})}
                          className="w-full px-3 py-2 rounded-lg border text-sm text-emerald-600 font-semibold" />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-red-500">Cash Out / منصرف</label>
                        <input type="number" value={txn.cash_out || 0} onChange={e => setEditTreasuryModal({...txn, cash_out: Number(e.target.value) || 0})}
                          className="w-full px-3 py-2 rounded-lg border text-sm text-red-500 font-semibold" />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500">Category / التصنيف</label>
                      <select value={txn.category || ''} onChange={e => setEditTreasuryModal({...txn, category: e.target.value})}
                        className="w-full px-3 py-2 rounded-lg border text-sm bg-amber-50">
                        <option value="">None</option>
                        {Object.entries(EXPENSE_CATS).map(([ar, en]) => <option key={ar} value={ar}>{en}</option>)}
                        {customCats.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500">Subcategory / فرعي</label>
                      <input list="edit-subcats" value={txn.subcategory || ''} onChange={e => setEditTreasuryModal({...txn, subcategory: e.target.value})}
                        className="w-full px-3 py-2 rounded-lg border text-sm" placeholder="Type or select..." />
                      <datalist id="edit-subcats">{uniqueSubcats.map(s => <option key={s} value={s} />)}</datalist>
                    </div>
                    <div className="flex gap-2 pt-2">
                      <button onClick={() => handleSaveTreasuryEdit(txn.id, {
                        transaction_date: txn.transaction_date,
                        order_number: txn.order_number || '',
                        description: txn.description || '',
                        cash_in: Number(txn.cash_in) || 0,
                        cash_out: Number(txn.cash_out) || 0,
                        category: txn.category || null,
                        subcategory: txn.subcategory || null,
                      })} className="flex-1 px-4 py-2.5 bg-blue-500 text-white rounded-lg font-bold text-sm hover:bg-blue-600">
                        Save / حفظ
                      </button>
                      {canDeleteTxn && (
                        <button onClick={() => setEditTreasuryModal({...txn, confirmDelete: true})}
                          className="px-4 py-2.5 bg-red-50 text-red-600 rounded-lg font-bold text-sm hover:bg-red-100 border border-red-200">
                          🗑 Delete
                        </button>
                      )}
                      <button onClick={() => setEditTreasuryModal(null)}
                        className="px-4 py-2.5 border border-slate-200 rounded-lg font-semibold text-sm">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* TREASURY → INVOICE LINK MODAL */}
        {linkingTreasuryTxn && (() => {
          const txn = linkingTreasuryTxn;
          const txnAmount = Number(txn.cash_in || 0);
          const linkableInvoices = invoices.filter(inv => {
            if (treasuryInvSearch) {
              const q = treasuryInvSearch.toLowerCase();
              const haystack = [inv.customer_name || '', inv.customer_name_en || '', inv.order_number || '', String(inv.total_amount || ''), inv.invoice_date || ''].join(' ').toLowerCase();
              if (!haystack.includes(q)) return false;
            }
            return true;
          }).sort((a, b) => {
            // Smart sort: closest amount match first, then by date
            const aDiff = Math.abs(Number(a.total_amount || 0) - txnAmount);
            const bDiff = Math.abs(Number(b.total_amount || 0) - txnAmount);
            if (aDiff !== bDiff) return aDiff - bDiff;
            return (b.invoice_date || '').localeCompare(a.invoice_date || '');
          }).slice(0, 30);
          return (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setLinkingTreasuryTxn(null)}>
              <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[85vh] overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="p-4 border-b bg-gradient-to-r from-emerald-50 to-white">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-bold text-sm">🔗 Link Treasury → Invoice / ربط بفاتورة</h3>
                      <p className="text-[10px] text-slate-500 mt-0.5" style={{direction:'rtl'}}>
                        {txn.transaction_date} — {txn.description}
                      </p>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-xs font-bold">
                          Cash In: {fE(txnAmount)}
                        </span>
                        {txn.order_number && (
                          <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-semibold">
                            Order: {txn.order_number}
                          </span>
                        )}
                      </div>
                    </div>
                    <button onClick={() => setLinkingTreasuryTxn(null)} className="text-slate-400 text-lg hover:text-slate-600">✕</button>
                  </div>
                  <input type="text" value={treasuryInvSearch}
                    onChange={e => setTreasuryInvSearch(e.target.value)}
                    placeholder="Search by customer, order #, amount, date... / بحث بالاسم أو رقم الأمر أو المبلغ"
                    className="dark-input mt-3"
                    autoFocus />
                </div>
                <div className="overflow-y-auto max-h-[55vh] p-2">
                  {linkableInvoices.length === 0 ? (
                    <p className="text-center text-slate-400 text-xs py-8">No invoices found / لم يتم العثور على فواتير</p>
                  ) : linkableInvoices.map(inv => {
                    const isExactMatch = Math.abs(Number(inv.total_amount || 0) - txnAmount) < 1;
                    const isOrderMatch = txn.order_number && inv.order_number === txn.order_number;
                    return (
                      <button key={inv.id} onClick={() => linkTreasuryToInvoice(txn.id, inv.id)}
                        className={'w-full text-left p-3 rounded-lg hover:bg-emerald-50 border-b last:border-0 transition ' + (isExactMatch || isOrderMatch ? 'bg-emerald-50/50 border-emerald-100' : '')}>
                        <div className="flex justify-between items-start">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-xs truncate">{inv.customer_name_en || inv.customer_name || 'N/A'}</span>
                              {isExactMatch && <span className="px-1 py-0.5 bg-emerald-200 text-emerald-800 rounded text-[8px] font-bold flex-shrink-0">EXACT MATCH</span>}
                              {isOrderMatch && <span className="px-1 py-0.5 bg-blue-200 text-blue-800 rounded text-[8px] font-bold flex-shrink-0">ORDER MATCH</span>}
                            </div>
                            <div className="text-[10px] text-slate-400 mt-0.5">
                              #{inv.order_number || '—'} • {inv.invoice_date || '—'}
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0 ml-2">
                            <div className="font-bold text-sm text-blue-600">{fE(inv.total_amount)}</div>
                            <div className="text-[10px]">
                              <span className="text-emerald-600">Paid: {fE(inv.total_collected || 0)}</span>
                              {Number(inv.outstanding || 0) > 0 && (
                                <span className="text-red-500 ml-1">Owed: {fE(inv.outstanding)}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })()}

        {/* SPLIT PAYMENT MODAL */}
        {splittingTxn && (() => {
          const money = readTreasuryMoney(splittingTxn);
          const isBank = money.channel === 'bank';
          return (
          <Modal onClose={() => setSplittingTxn(null)} title={isBank ? 'Split Bank Deposit / تقسيم إيداع بنكي' : 'Split Payment / تقسيم الدفعة'}>
            <div className="space-y-3">
              <div className={(isBank ? 'bg-indigo-50 border border-indigo-200' : 'bg-slate-50') + ' rounded-lg p-3 text-xs'}>
                <div className="font-bold mb-1" style={{ direction: 'rtl' }}>{splittingTxn.transaction_date} — {splittingTxn.description}</div>
                <div>Original: <span className={'font-bold ' + (isBank ? 'text-indigo-700' : 'text-emerald-600')}>
                  {isBank ? '🏦 ' : ''}{fE(money.amount)}
                </span>
                  {splittingTxn.order_number ? (' — Order: ' + splittingTxn.order_number) : ''}
                </div>
                {isBank && (
                  <div className="mt-1.5 text-[10px] text-indigo-800 leading-snug">
                    This is a bank deposit. Splits go to <code>bank_in</code>/<code>bank_out</code> — they will NOT affect the treasury safe balance. Each split updates its linked invoice's collected amount.
                    <br/><span style={{direction:'rtl',display:'block'}}>هذا إيداع بنكي. التقسيمات تذهب إلى خانة البنك — لن تؤثر على رصيد الخزنة. كل تقسيم يحدّث تحصيل الفاتورة المرتبطة.</span>
                  </div>
                )}
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
                  const total = money.amount;
                  const splitTotal = splits.reduce((a, s) => a + (Number(s.amount) || 0), 0);
                  const remaining = total - splitTotal;
                  return 'Total: ' + fE(splitTotal) + ' / ' + fE(total) + (remaining === 0 ? ' ✅' : ' — Remaining: ' + fE(remaining));
                })()}
              </div>
              <button onClick={handleSplitTreasury}
                className={'w-full py-2 text-white rounded-lg font-semibold text-sm ' + (isBank ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-purple-600 hover:bg-purple-700')}>
                {isBank ? '🏦 ' : ''}Split into {splits.length} / تقسيم
              </button>
            </div>
          </Modal>
          );
        })()}

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
                                        } catch(err) { toast.error(err.message); }
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
          <Modal onClose={() => { setReconcileCheck(null); setReconcileDate(''); }} title="✅ Collect Check / تحصيل شيك">
            <div className="bg-emerald-50 rounded-lg p-4 mb-4 border border-emerald-200">
              <div style={{ direction: 'rtl' }} className="text-lg font-bold text-emerald-800">{reconcileCheck.customer_name}</div>
              <div className="text-2xl font-extrabold text-emerald-600 mt-1">{fE(reconcileCheck.amount)}</div>
              <div className="flex gap-3 mt-2 text-xs text-slate-500">
                {reconcileCheck.order_number && <span>Order #{reconcileCheck.order_number}</span>}
                {reconcileCheck.check_number && <span>Check #{reconcileCheck.check_number}</span>}
                {reconcileCheck.bank_name && <span>{reconcileCheck.bank_name}</span>}
                <span>Due: {reconcileCheck.due_date || reconcileCheck.check_date}</span>
              </div>
            </div>
            <div className="mb-4">
              <label className="text-xs font-semibold text-slate-600 mb-1 block">Collection Date / تاريخ التحصيل</label>
              <DatePickerSelect value={reconcileDate || today()} onChange={v => setReconcileDate(v)} />
              <p className="text-[10px] text-slate-400 mt-2">This will create a treasury cash-in entry and update the invoice collected amount / سيتم إنشاء معاملة وارد في الخزنة وتحديث المبلغ المحصّل في الفاتورة</p>
            </div>
            <button onClick={handleCollectCheck}
              className="px-4 py-3 bg-emerald-500 text-white rounded-lg font-bold w-full text-sm hover:bg-emerald-600">✅ Collect & Add to Treasury / تحصيل وإضافة للخزنة</button>
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
                <label className="text-xs font-semibold text-slate-600">Date / التاريخ</label>
                <DatePickerSelect value={formData.date || today()} onChange={v => setFormData({ ...formData, date: v })} />
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
                      <input type="number" value={formData.customQty || ''} onChange={e => setFormData({...formData, customQty: e.target.value})}
                        placeholder="Qty" className="w-14 px-2 py-1 border rounded text-[10px]" min="1" />
                      <input type="number" value={formData.customPrice || ''} onChange={e => setFormData({...formData, customPrice: e.target.value})}
                        placeholder="Price" className="w-20 px-2 py-1 border rounded text-[10px]" />
                      <button onClick={() => {
                        if (!formData.customDesc) return;
                        const items = formData.invoiceItems || [];
                        const qty = Number(formData.customQty) || 1;
                        const price = Number(formData.customPrice) || 0;
                        items.push({ inv_desc: formData.customDesc, inv_qty: qty, inv_price: price, inv_total: qty * price });
                        setFormData({...formData, invoiceItems: items, showProductPicker: false, customDesc: '', customQty: '', customPrice: ''});
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
                          <td className="px-2 py-1">
                            <input type="text" value={item.inv_desc || ''}
                              onChange={e => { const items = [...(formData.invoiceItems || [])]; items[idx] = {...items[idx], inv_desc: e.target.value}; setFormData({...formData, invoiceItems: items}); }}
                              placeholder="Description / الوصف"
                              className="w-full text-[10px] border rounded px-1 py-0.5"
                              style={{direction: (item.inv_desc || '').match(/[\u0600-\u06FF]/) ? 'rtl' : 'ltr'}} />
                          </td>
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
                  const orderNum = sanitize(formData.orderNumber);
                  const { data: newInv } = await supabase.from('invoices').insert({
                    order_number: orderNum, customer_name: sanitize(formData.customerName),
                    invoice_date: formData.date || today(), total_amount: totalAmt,
                    total_collected: 0, outstanding: totalAmt, sales_rep: formData.salesRep || '',
                    notes: sanitize(formData.notes || ''), source: 'manual',
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
                  // BACKFILL: link any orphan treasury rows (cash OR bank) that reference
                  // this order_number but have no linked_invoice_id. Then recalc collected.
                  let backfillCount = 0;
                  if (newInv && newInv.id) {
                    const { data: orphans } = await supabase.from('treasury')
                      .select('id')
                      .eq('order_number', orderNum)
                      .is('linked_invoice_id', null);
                    if (orphans && orphans.length > 0) {
                      await supabase.from('treasury')
                        .update({ linked_invoice_id: newInv.id })
                        .eq('order_number', orderNum)
                        .is('linked_invoice_id', null);
                      await recalcInvoiceCollected(newInv.id);
                      backfillCount = orphans.length;
                    }
                  }
                  // Instant local update so new invoice appears at top immediately
                  const tempInv = {
                    id: newInv?.id || 'temp-' + Date.now(),
                    order_number: orderNum, customer_name: sanitize(formData.customerName),
                    invoice_date: formData.date || today(), total_amount: totalAmt,
                    total_collected: 0, outstanding: totalAmt, sales_rep: formData.salesRep || '',
                    notes: sanitize(formData.notes || ''), source: 'manual',
                  };
                  setInvoices(prev => [tempInv, ...prev]);
                  setShowAddInvoice(false); setFormData({});
                  if (backfillCount > 0) {
                    toast.success('Invoice created + linked ' + backfillCount + ' waiting treasury entr' + (backfillCount === 1 ? 'y' : 'ies') + ' ✓');
                  } else {
                    toast.success('Invoice created ✓');
                  }
                  // Full refresh in background
                  setTimeout(() => loadAllData(), 500);
                } catch (err) { toast.error(err.message); }
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
              <div className="col-span-2">
                <label className="text-xs font-semibold text-slate-600 block mb-2">Type / النوع</label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {[
                    {v:'in', l:'💵 Cash In / وارد نقدي', color:'emerald', desc:'Actual cash received / نقدية فعلية مستلمة'},
                    {v:'out', l:'💸 Cash Out / صادر نقدي', color:'red', desc:'Actual cash paid / نقدية فعلية مدفوعة'},
                    {v:'bank_in', l:'🏦 Bank In / وارد بنكي', color:'indigo', desc:'Placeholder — لا يؤثر على الصافي — يتطابق تلقائياً مع كشف البنك'},
                    {v:'bank_out', l:'🏦 Bank Out / صادر بنكي', color:'indigo', desc:'Placeholder — لا يؤثر على الصافي — يتطابق تلقائياً مع كشف البنك'},
                  ].map(opt => {
                    const selected = (formData.type || 'in') === opt.v;
                    const colorMap = {
                      emerald: selected ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300',
                      red: selected ? 'bg-red-500 text-white border-red-500' : 'bg-white text-slate-600 border-slate-200 hover:border-red-300',
                      indigo: selected ? 'bg-indigo-500 text-white border-indigo-500' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300',
                    };
                    return (
                      <label key={opt.v} className={'cursor-pointer rounded-lg border-2 p-2.5 transition ' + colorMap[opt.color]}>
                        <input type="radio" name="txn-type" value={opt.v} checked={selected}
                          onChange={e => setFormData({ ...formData, type: e.target.value, bankAccountId: '' })}
                          className="hidden" />
                        <div className="text-xs font-bold">{opt.l}</div>
                        <div className={'text-[9px] mt-0.5 ' + (selected ? 'text-white/80' : 'text-slate-400')}>{opt.desc}</div>
                      </label>
                    );
                  })}
                </div>
                {(formData.type === 'bank_in' || formData.type === 'bank_out') && (() => {
                  const mode = formData.bankEntryMode || 'order';
                  return (
                    <div className="mt-2 space-y-2">
                      {/* Order / Non-Order radio */}
                      <div className="p-2 bg-indigo-50 border border-indigo-200 rounded">
                        <label className="text-[11px] font-bold text-indigo-900 block mb-1.5">
                          This bank entry is: / هذا القيد البنكي:
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            { v: 'order',    en: '📄 Order (links to an invoice)', ar: 'أمر (مرتبط بفاتورة)' },
                            { v: 'nonorder', en: '🏦 Non-Order (owner draw, transfer, fee…)', ar: 'بدون أمر (سحب، تحويل، رسوم...)' },
                          ].map(opt => {
                            const sel = mode === opt.v;
                            return (
                              <label key={opt.v}
                                className={'cursor-pointer rounded border-2 p-2 text-center transition ' +
                                  (sel ? 'bg-indigo-600 text-white border-indigo-700' : 'bg-white text-indigo-800 border-indigo-300 hover:border-indigo-500')}>
                                <input type="radio" name="bank-entry-mode" value={opt.v} checked={sel}
                                  onChange={e => setFormData({
                                    ...formData,
                                    bankEntryMode: e.target.value,
                                    // clear the other mode's fields when switching
                                    orderNumber: e.target.value === 'nonorder' ? '' : formData.orderNumber,
                                    bankNonOrderCategory: e.target.value === 'order' ? '' : formData.bankNonOrderCategory,
                                  })}
                                  className="hidden" />
                                <div className="text-[11px] font-bold">{opt.en}</div>
                                <div className={'text-[9px] mt-0.5 ' + (sel ? 'text-white/80' : 'text-indigo-600')} style={{direction:'rtl'}}>{opt.ar}</div>
                              </label>
                            );
                          })}
                        </div>
                      </div>

                      {/* Non-Order category selector — only in non-order mode */}
                      {mode === 'nonorder' && (
                        <div className="p-2 bg-indigo-50 border border-indigo-200 rounded">
                          <label className="text-[11px] font-bold text-indigo-900 block mb-1">
                            What is this? / ما نوع هذا القيد؟ *
                          </label>
                          <select value={formData.bankNonOrderCategory || ''}
                            onChange={e => setFormData({ ...formData, bankNonOrderCategory: e.target.value })}
                            className="w-full px-2 py-1.5 rounded border border-indigo-300 text-sm bg-white">
                            <option value="">Select a category…</option>
                            {BANK_NONORDER_CATS.map(c => (
                              <option key={c.v} value={c.v}>{c.en} / {c.ar}</option>
                            ))}
                          </select>
                        </div>
                      )}

                      {/* Explainer banner */}
                      <div className="p-2 bg-indigo-50 border border-indigo-200 rounded text-[11px] text-indigo-800">
                        ℹ️ <b>Bank entry — safe balance protected:</b> This row will <b>NOT</b> affect the treasury (safe) Cash In / Cash Out / Net. Amount lives in <code>bank_in</code> / <code>bank_out</code> after the bank statement verifies it. {mode === 'order'
                          ? 'On match, the linked invoice\'s collected amount is credited.'
                          : 'No invoice is credited — this is a non-order movement.'}
                        <br/><span style={{direction:'rtl',display:'block',marginTop:4}}>
                          قيد بنكي — رصيد الخزنة محمي: هذا القيد لن يؤثر على صافي الخزنة. المبلغ يُسجَّل في خانة البنك بعد تأكيد الكشف. {mode === 'order' ? 'عند المطابقة، يُضاف المبلغ إلى تحصيل الفاتورة المرتبطة.' : 'لا يُضاف لأي فاتورة — حركة بنكية بدون أمر.'}
                        </span>
                      </div>
                    </div>
                  );
                })()}
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600">Date / التاريخ</label>
                <DatePickerSelect value={formData.date || today()} onChange={v => setFormData({ ...formData, date: v })} />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600">{(formData.type === 'bank_in' || formData.type === 'bank_out') ? 'Expected Amount / المبلغ المتوقع' : 'Amount / المبلغ'}</label>
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
              {(formData.type === 'bank_in' || formData.type === 'bank_out') && (
                <div className="col-span-2">
                  <label className="text-xs font-semibold text-slate-600">Bank Account / الحساب البنكي *</label>
                  <select value={formData.bankAccountId || ''}
                    onChange={e => setFormData({ ...formData, bankAccountId: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-indigo-300 text-sm bg-indigo-50">
                    <option value="">Select bank account...</option>
                    {egyptBankAccounts.map(a => (
                      <option key={a.id} value={a.id}>
                        🏦 {a.bank_name}{a.account_name ? ' — ' + a.account_name : ''}{a.account_number ? ' (' + a.account_number + ')' : ''}
                      </option>
                    ))}
                  </select>
                  {egyptBankAccounts.length === 0 && (
                    <div className="text-[10px] text-red-500 mt-1">⚠️ No bank accounts configured. Add them in Egypt Bank tab first. / لا توجد حسابات بنكية. أضفها في تبويب بنك مصر أولاً.</div>
                  )}
                </div>
              )}
              {/* Cash Method — only for Cash In / Cash Out. Vodafone + InstaPay auto-sweep
                  to the safe so they count as cash_in/cash_out, just tagged for reconciliation. */}
              {(formData.type === 'in' || formData.type === 'out' || !formData.type) && (
                <div className="col-span-2">
                  <label className="text-xs font-semibold text-slate-600 block mb-1.5">Cash Channel / قناة النقد</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { v: 'cash',     en: '💵 Cash',         ar: 'نقدي' },
                      { v: 'vodafone', en: '📱 Vodafone Cash', ar: 'فودافون كاش' },
                      { v: 'instapay', en: '⚡ InstaPay',      ar: 'إنستاباي' },
                    ].map(m => {
                      const sel = (formData.cashMethod || 'cash') === m.v;
                      return (
                        <label key={m.v}
                          className={'cursor-pointer rounded border-2 p-1.5 text-center transition ' +
                            (sel ? 'bg-emerald-500 text-white border-emerald-600' : 'bg-white text-emerald-800 border-emerald-200 hover:border-emerald-400')}>
                          <input type="radio" name="cash-method" value={m.v} checked={sel}
                            onChange={e => setFormData({ ...formData, cashMethod: e.target.value })}
                            className="hidden" />
                          <div className="text-[11px] font-bold">{m.en}</div>
                          <div className={'text-[9px] ' + (sel ? 'text-white/80' : 'text-emerald-600')} style={{direction:'rtl'}}>{m.ar}</div>
                        </label>
                      );
                    })}
                  </div>
                  <div className="text-[10px] text-emerald-700 mt-1 italic">
                    All three auto-sweep to the safe (Cash In/Out). The tag is kept for reconciliation against Vodafone/InstaPay statements.
                  </div>
                </div>
              )}
              {(() => {
                const isBank = formData.type === 'bank_in' || formData.type === 'bank_out';
                const bankMode = formData.bankEntryMode || 'order';
                // Hide Order# in non-order bank mode — it doesn't apply.
                if (isBank && bankMode === 'nonorder') return null;
                return (
                  <div>
                    <label className="text-xs font-semibold text-slate-600">Order # / رقم{isBank ? ' *' : ''}</label>
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
                );
              })()}
              <div className="col-span-2">
                <label className="text-xs font-semibold text-slate-600">Description / الوصف</label>
                <input value={formData.desc || ''}
                  onChange={e => setFormData({ ...formData, desc: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
              </div>
              {(formData.type === 'out' || formData.type === 'in' || formData.type === 'bank_in' || formData.type === 'bank_out' || !formData.type) && (
                <div className="col-span-2">
                  <label className="text-xs font-semibold text-slate-600">Category / تصنيف {(formData.type || 'in') === 'in' || formData.type === 'bank_in' ? '(Income / إيرادات)' : '(Expense / منصرفات)'}</label>
                  {formData.showCustomCat ? (
                    <div className="flex gap-2 mt-1">
                      <input autoFocus value={formData.customCatInput || ''} onChange={e => setFormData({...formData, customCatInput: e.target.value})}
                        placeholder="New category name / اسم التصنيف" className="flex-1 px-3 py-2 rounded-lg border border-amber-400 text-sm bg-amber-50" />
                      <button onClick={() => { if (formData.customCatInput?.trim()) setFormData({...formData, category: formData.customCatInput.trim(), showCustomCat: false, customCatInput: ''}); }}
                        className="px-3 py-2 bg-emerald-500 text-white rounded-lg text-xs font-bold">✓</button>
                      <button onClick={() => setFormData({...formData, showCustomCat: false, customCatInput: ''})}
                        className="px-3 py-2 bg-slate-200 rounded-lg text-xs font-bold">✕</button>
                    </div>
                  ) : (
                    <select value={formData.category || ''} onChange={e => {
                      if (e.target.value === '__custom') setFormData({...formData, showCustomCat: true, customCatInput: ''});
                      else setFormData({ ...formData, category: e.target.value });
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
                  )}
                  {formData.category && !EXPENSE_CATS[formData.category] && !customCats.includes(formData.category) && !formData.showCustomCat && (
                    <div className="text-[10px] text-emerald-600 font-semibold mt-1">✓ New category: "{formData.category}"</div>
                  )}
                  {formData.showCustomSubcat ? (
                    <div className="flex gap-2 mt-1">
                      <input autoFocus value={formData.customSubcatInput || ''} onChange={e => setFormData({...formData, customSubcatInput: e.target.value})}
                        placeholder="New subcategory / تصنيف فرعي" className="flex-1 px-3 py-2 rounded-lg border border-orange-400 text-sm bg-orange-50" />
                      <button onClick={() => { if (formData.customSubcatInput?.trim()) setFormData({...formData, subcategory: formData.customSubcatInput.trim(), showCustomSubcat: false, customSubcatInput: ''}); }}
                        className="px-3 py-2 bg-emerald-500 text-white rounded-lg text-xs font-bold">✓</button>
                      <button onClick={() => setFormData({...formData, showCustomSubcat: false, customSubcatInput: ''})}
                        className="px-3 py-2 bg-slate-200 rounded-lg text-xs font-bold">✕</button>
                    </div>
                  ) : (
                    <select value={formData.subcategory || ''} onChange={e => {
                      if (e.target.value === '__custom') setFormData({...formData, showCustomSubcat: true, customSubcatInput: ''});
                      else setFormData({ ...formData, subcategory: e.target.value });
                    }} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm mt-1 bg-orange-50">
                      <option value="">Subcategory (optional)...</option>
                      {formData.subcategory && !uniqueSubcats.includes(formData.subcategory) && formData.subcategory !== '__custom' && (
                        <option value={formData.subcategory}>✨ {formData.subcategory}</option>
                      )}
                      {uniqueSubcats.map(s => <option key={s} value={s}>{s}</option>)}
                      <option value="__custom">+ Add New Subcategory / إضافة فرعي جديد</option>
                    </select>
                  )}
                  {formData.subcategory && !uniqueSubcats.includes(formData.subcategory) && !formData.showCustomSubcat && (
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
            <div className="mb-3 rounded-xl p-3 cursor-pointer"
              onClick={() => { setTab('dashboard'); }}
              style={{ background: '#1e40af', border: '2px solid #60a5fa', boxShadow: '0 4px 15px rgba(30,64,175,0.3)' }}>
              <div style={{ fontSize: '13px', fontWeight: 800, color: '#ffffff' }}>
                📢 {myActive.length} active reminder{myActive.length > 1 ? 's' : ''} — {(myActive[0].message || myActive[0].title || '').substring(0, 80)}{(myActive[0].message || myActive[0].title || '').length > 80 ? '...' : ''}
                {myActive.length > 1 && <span style={{ color: 'rgba(255,255,255,0.6)', fontWeight: 400 }}> +{myActive.length - 1} more</span>}
                <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', fontWeight: 400, marginLeft: 8 }}>Tap to view →</span>
              </div>
            </div>
          );
        })()}

        {/* ==========================================
            DASHBOARD TAB
        ========================================== */}
        {tab === 'dashboard' && (
          <div>

            {/* ===== PRIORITY: UNACKNOWLEDGED ANNOUNCEMENTS FIRST ===== */}
            {(() => {
              const myId = userProfile?.id;
              const active = announcements.filter(a => a.active !== false && (!a.target_user || a.target_user === myId));
              const myAcks = new Set(announcementAcks.filter(a => a.user_id === myId).map(a => a.announcement_id));
              const unacked = active.filter(a => !myAcks.has(a.id));
              const hasUnacked = unacked.length > 0;

              return (<>
                {/* Unacknowledged messages — MUST acknowledge before seeing anything else */}
                {hasUnacked && (
                  <div className="mb-4">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                      <div style={{ width: 4, height: 28, borderRadius: 2, background: '#ef4444' }} />
                      <div>
                        <h2 style={{ fontSize: 16, fontWeight: 900, color: '#fca5a5', margin: 0 }}>⚠️ ACTION REQUIRED — {unacked.length} message{unacked.length > 1 ? 's' : ''} to acknowledge</h2>
                        <p style={{ fontSize: 10, color: '#64748b', margin: 0 }}>You must acknowledge these before continuing</p>
                      </div>
                    </div>
                    {unacked.map(a => {
                      const poster = teamUsers.find(u => u.id === a.posted_by);
                      const icon = a.priority === 'urgent' ? '🚨' : a.priority === 'warning' ? '⚠️' : 'ℹ️';
                      const isTargeted = a.target_user === myId;
                      const bgColor = a.priority === 'urgent' ? 'linear-gradient(135deg,#fef2f2,#fee2e2)' : a.priority === 'warning' ? 'linear-gradient(135deg,#fffbeb,#fef3c7)' : 'linear-gradient(135deg,#eff6ff,#dbeafe)';
                      const borderColor = a.priority === 'urgent' ? '#ef4444' : a.priority === 'warning' ? '#f59e0b' : '#3b82f6';
                      return (
                        <div key={a.id} className="rounded-2xl p-5 mb-3" style={{ background: bgColor, border: '3px solid ' + borderColor, boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}>
                          <div style={{ fontSize: '1.2rem', fontWeight: 900, lineHeight: 1.3, color: a.priority === 'urgent' ? '#dc2626' : a.priority === 'warning' ? '#b45309' : '#1d4ed8' }}>
                            {icon} {a.pinned && '📌 '}{isTargeted && '👤 '}{a.title}
                          </div>
                          {a.body && <div style={{ fontSize: '1rem', marginTop: '0.5rem', lineHeight: 1.6, color: '#1e293b', whiteSpace: 'pre-wrap' }}>{a.body}</div>}
                          <div style={{ fontSize: '0.75rem', marginTop: '0.5rem', color: '#94a3b8' }}>
                            From: {poster ? poster.name : 'Admin'} • {new Date(a.created_at).toLocaleDateString()} {new Date(a.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}
                            {isTargeted && <span style={{ color: '#7c3aed', fontWeight: 700, marginLeft: 8 }}>📩 Sent to you directly</span>}
                          </div>
                          <button onClick={async () => {
                            await dbInsert('announcement_acks', { announcement_id: a.id, user_id: myId, acked_at: new Date().toISOString() }, myId);
                            setAnnouncementAcks(prev => [...prev, { announcement_id: a.id, user_id: myId, acked_at: new Date().toISOString() }]);
                            if (toast) toast.success('Acknowledged ✓');
                          }} style={{ marginTop: 12, fontSize: '0.9rem', fontWeight: 800, color: '#fff', background: a.priority === 'urgent' ? '#dc2626' : '#2563eb', padding: '10px 24px', borderRadius: 10, cursor: 'pointer', border: 'none', boxShadow: '0 2px 10px rgba(0,0,0,0.2)' }}>
                            👋 Acknowledge / تأكيد الاستلام
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Everything below only shows when all announcements are acknowledged */}
                {!hasUnacked && (<>

            {/* ===== SMART WELCOME BRIEFING ===== */}
            {!welcomeDismissed && userProfile && (isSuperAdmin || modulePerms?.['Welcome Briefing']) && (() => {
              const myId = userProfile.id;
              const todayStr = new Date().toISOString().substring(0, 10);
              const hour = new Date().getHours();
              const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
              const firstName = (userProfile.name || '').split(' ')[0];

              // Permission checks
              const hasTreasury = isSuperAdmin || modulePerms?.['Treasury'];
              const hasSales = isSuperAdmin || modulePerms?.['Sales'];
              const hasTickets = isSuperAdmin || modulePerms?.['Tickets'];
              const hasChecks = isSuperAdmin || modulePerms?.['Checks'];

              // Login analysis
              const prevLogins = (lastLoginInfo || []).filter(s => s.date !== todayStr);
              const lastDate = prevLogins.length > 0 ? prevLogins[0].date : null;
              const daysSinceLast = lastDate ? Math.floor((new Date(todayStr) - new Date(lastDate)) / 86400000) : null;
              const loginStreak = (() => {
                let streak = 1;
                const dates = (lastLoginInfo || []).map(s => s.date).filter((v, i, a) => a.indexOf(v) === i).sort().reverse();
                for (let i = 1; i < dates.length; i++) {
                  const diff = Math.floor((new Date(dates[i-1]) - new Date(dates[i])) / 86400000);
                  if (diff <= 2) streak++; else break;
                }
                return streak;
              })();

              // Ticket analysis (only if permitted)
              const myTickets = hasTickets ? dashTickets.filter(t => t.assigned_to === myId && t.status !== 'Closed') : [];
              const overdueTickets = myTickets.filter(t => t.due_date && t.due_date < todayStr);
              const highPriority = myTickets.filter(t => t.priority === 'high');
              const newTickets = myTickets.filter(t => t.status === 'New');

              // Financial analysis (only if permitted)
              const overdueInvoices = hasSales ? invoices.filter(i => i.outstanding > 0 && i.invoice_date && (Date.now() - new Date(i.invoice_date).getTime()) > 30 * 86400000) : [];
              const upcomingChecks = hasChecks ? pendingChecks.filter(c => {
                const d = c.due_date || c.check_date;
                return d && d >= todayStr && d <= new Date(Date.now() + 7 * 86400000).toISOString().substring(0, 10);
              }) : [];

              // Treasury analysis (only if permitted)
              const treasuryDays = hasTreasury ? (() => {
                const sorted = [...treasury].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
                const last = sorted[0];
                if (!last) return null;
                return Math.floor((Date.now() - new Date(last.created_at).getTime()) / 86400000);
              })() : null;
              const unmatchedPlaceholders = hasTreasury ? treasury.filter(t => t.is_bank_placeholder && !t.matched_bank_txn_id).length : 0;

              // Activity analysis
              const todayLogs = (activityFeed || []).filter(l => l.user_id === myId && (l.created_at || '').substring(0, 10) === todayStr);

              // Build messages
              const messages = [];

              // Login commentary
              if (daysSinceLast === null) {
                messages.push({ icon: '👋', text: 'Welcome to NextTrade Hub! This is your first time here.', type: 'info' });
              } else if (daysSinceLast === 0 || daysSinceLast === 1) {
                if (loginStreak >= 5) messages.push({ icon: '🔥', text: loginStreak + '-day streak! You\'re on fire. Keep it up.', type: 'success' });
              } else if (daysSinceLast === 2) {
                messages.push({ icon: '👀', text: 'You missed yesterday. Things may have piled up — let\'s catch up.', type: 'warning' });
              } else if (daysSinceLast >= 3) {
                messages.push({ icon: '⚠️', text: 'You haven\'t logged in for ' + daysSinceLast + ' days. Here\'s what needs your attention:', type: 'error' });
              }

              // Overdue tickets (only if permitted)
              if (hasTickets && overdueTickets.length > 0) {
                messages.push({ icon: '🚨', text: overdueTickets.length + ' ticket' + (overdueTickets.length > 1 ? 's are' : ' is') + ' OVERDUE. These need to be resolved immediately — clients are waiting.', type: 'error', items: overdueTickets.map(t => t.ticket_number + ' — ' + t.title) });
              }
              if (hasTickets && highPriority.length > 0 && overdueTickets.length === 0) {
                messages.push({ icon: '🔴', text: highPriority.length + ' high-priority ticket' + (highPriority.length > 1 ? 's' : '') + ' in your queue. Handle these before anything else.', type: 'warning' });
              }
              if (hasTickets && newTickets.length > 0) {
                messages.push({ icon: '✨', text: newTickets.length + ' new ticket' + (newTickets.length > 1 ? 's' : '') + ' assigned to you. Acknowledge them so your team knows you\'re on it.', type: 'info' });
              }
              if (hasTickets && myTickets.length === 0) {
                messages.push({ icon: '✅', text: 'No open tickets. You\'re all clear — nice work!', type: 'success' });
              } else if (hasTickets && overdueTickets.length === 0 && highPriority.length === 0 && newTickets.length === 0 && myTickets.length > 0) {
                messages.push({ icon: '👍', text: myTickets.length + ' ticket' + (myTickets.length > 1 ? 's' : '') + ' in your queue, none overdue. You\'re on track.', type: 'success' });
              }

              // Overdue invoices (only if permitted)
              if (hasSales && overdueInvoices.length > 0) {
                const totalOD = overdueInvoices.reduce((a, i) => a + Number(i.outstanding || 0), 0);
                messages.push({ icon: '💰', text: overdueInvoices.length + ' invoice' + (overdueInvoices.length > 1 ? 's' : '') + ' overdue (30+ days) totaling ' + fE(totalOD) + '. Follow up on collections.', type: 'warning' });
              }

              // Upcoming checks (only if permitted)
              if (hasChecks && upcomingChecks.length > 0) {
                const totalChk = upcomingChecks.reduce((a, c) => a + Number(c.amount || 0), 0);
                messages.push({ icon: '📝', text: upcomingChecks.length + ' check' + (upcomingChecks.length > 1 ? 's' : '') + ' due this week totaling ' + fE(totalChk) + '. Make sure to collect.', type: 'info' });
              }

              // Treasury gaps (only if permitted)
              if (hasTreasury && treasuryDays !== null && treasuryDays >= 14) {
                messages.push({ icon: '📭', text: 'No treasury entries in the last ' + treasuryDays + ' days. Is everything being recorded?', type: 'warning' });
              }
              if (hasTreasury && unmatchedPlaceholders > 0) {
                messages.push({ icon: '🏦', text: unmatchedPlaceholders + ' bank placeholder' + (unmatchedPlaceholders > 1 ? 's' : '') + ' still awaiting confirmation. Import your latest bank statement to match.', type: 'info' });
              }

              // Today's activity
              if (todayLogs.length > 0) {
                messages.push({ icon: '📊', text: 'You\'ve already logged ' + todayLogs.length + ' action' + (todayLogs.length > 1 ? 's' : '') + ' today. Keep going!', type: 'success' });
              }

              if (messages.length === 0) return null;

              const typeColors = { success: '#10b981', warning: '#f59e0b', error: '#ef4444', info: '#3b82f6' };
              const typeBgs = { success: 'rgba(16,185,129,0.08)', warning: 'rgba(245,158,11,0.08)', error: 'rgba(239,68,68,0.1)', info: 'rgba(59,130,246,0.08)' };

              return (
                <div style={{ background: 'linear-gradient(135deg, rgba(15,23,42,0.95), rgba(30,27,75,0.95))', borderRadius: 16, border: '1px solid rgba(56,189,248,0.15)', padding: 20, marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                    <div>
                      <div style={{ fontSize: 20, fontWeight: 900, color: '#e2e8f0' }}>{greeting}, {firstName} 👋</div>
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                        {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                        {loginStreak >= 3 && <span style={{ marginLeft: 8, color: '#f59e0b', fontWeight: 700 }}>🔥 {loginStreak}-day streak</span>}
                      </div>
                    </div>
                    <button onClick={() => setWelcomeDismissed(true)}
                      style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '6px 14px', color: '#94a3b8', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                      Got it ✓
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {messages.map((m, i) => (
                      <div key={i} style={{ padding: '10px 14px', borderRadius: 10, background: typeBgs[m.type], borderLeft: '3px solid ' + typeColors[m.type] }}>
                        <div style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 500 }}>
                          <span style={{ marginRight: 8 }}>{m.icon}</span>{m.text}
                        </div>
                        {m.items && (
                          <div style={{ marginTop: 6, marginLeft: 28 }}>
                            {m.items.slice(0, 5).map((item, j) => (
                              <div key={j} style={{ fontSize: 11, color: typeColors[m.type], fontWeight: 600, padding: '2px 0' }}>• {item}</div>
                            ))}
                            {m.items.length > 5 && <div style={{ fontSize: 10, color: '#64748b' }}>+ {m.items.length - 5} more</div>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {welcomeDismissed && (
              <button onClick={() => setWelcomeDismissed(false)}
                className="mb-3 px-4 py-2 rounded-full text-xs font-semibold text-blue-400 border border-blue-400/30 hover:bg-blue-500/10 transition">
                📋 Show Morning Briefing
              </button>
            )}

            {/* ===== AI ASSISTANT (compact — click to expand) ===== */}
            {!greeterDismissed && greeterSettings.enabled ? (
              <div className="mb-4 pt-4">
                <AIGreeter
                  user={user} userProfile={userProfile} users={teamUsers}
                  tickets={dashTickets} invoices={invoices} treasury={treasury}
                  checks={pendingChecks} loginHistory={lastLoginInfo} loginHistoryLoaded={loginHistoryLoaded}
                  lang={lang} personality={greeterSettings.personality}
                  greeterLang={greeterSettings.language}
                  enabled={greeterSettings.enabled}
                  hasGreeted={greeterHasGreeted} onGreeted={() => setGreeterHasGreeted(true)}
                  sessionMessages={greeterMessages} onMessagesUpdate={setGreeterMessages}
                  onToggle={(on) => { if (!on) setGreeterDismissed(true); }}
                  toast={toast}
                />
              </div>
            ) : greeterSettings.enabled ? (
              <button onClick={() => setGreeterDismissed(false)}
                className="mb-4 w-full px-4 py-2.5 rounded-xl text-xs font-semibold text-indigo-300 border border-indigo-500/20 hover:bg-indigo-500/10 transition flex items-center gap-2"
                style={{ background: 'rgba(99,102,241,0.05)' }}>
                🤖 <span>Open AI Assistant</span> <span className="ml-auto text-[10px] text-indigo-400/60">Nadia</span>
              </button>
            ) : null}

                </>)}{/* end !hasUnacked gate */}
              </>);
            })()}{/* end announcement priority IIFE */}

            {/* ===== TODAY'S EVENTS + SCORECARD ===== */}
            {(() => {
              const myId = userProfile?.id;
              const todayStr = new Date().toISOString().substring(0, 10);
              const myTicketsCount = dashTickets.filter(t => t.assigned_to === myId && t.status !== 'Closed').length;
              const assignedByMe = dashTickets.filter(t => t.created_by === myId && t.assigned_to !== myId && t.status !== 'Closed').length;
              const teamTicketsCount = dashTickets.filter(t => t.status !== 'Closed' && t.assigned_to !== myId && t.created_by !== myId).length;
              const todayEvents = dashEvents.filter(e => e.event_date === todayStr && (e.assigned_to === myId || e.created_by === myId || !e.assigned_to));
              // Check due reminders (today + tomorrow) — for treasury-access users
              const hasTreasuryAccess = userProfile?.role === 'super_admin' || userProfile?.role === 'admin' || modulePerms?.['Treasury'] === true;
              const tomorrowStr = new Date(Date.now() + 86400000).toISOString().substring(0, 10);
              const checksDueToday = hasTreasuryAccess ? pendingChecks.filter(c => (c.due_date || c.check_date || '') === todayStr) : [];
              const checksDueTomorrow = hasTreasuryAccess ? pendingChecks.filter(c => (c.due_date || c.check_date || '') === tomorrowStr) : [];
              const checksOverdue = hasTreasuryAccess ? pendingChecks.filter(c => (c.due_date || c.check_date || '') < todayStr && (c.due_date || c.check_date)) : [];
              const myFollowUps = dashFollowUps.filter(fu => fu.assigned_to === myId || fu.created_by === myId);
              return (
                <div style={{ marginBottom: 16 }}>
                  {/* ── TODAY'S EVENTS + CHECK REMINDERS ── */}
                  {(todayEvents.length > 0 || checksDueToday.length > 0 || checksDueTomorrow.length > 0) && (
                    <div style={{ background: 'rgba(17,24,39,0.7)', border: '1px solid rgba(52,211,153,0.15)', borderRadius: 12, padding: 12, marginBottom: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: '#34d399', marginBottom: 8, letterSpacing: '0.05em' }}>📅 TODAY'S SCHEDULE</div>
                      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, flexWrap: 'wrap' }}>
                        {todayEvents.slice(0, 6).map(ev => (
                          <div key={ev.id} onClick={() => setTab('calendar')}
                            style={{ flexShrink: 0, background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.15)', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', minWidth: 180 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#34d399', fontFamily: 'monospace' }}>{ev.event_time ? ev.event_time.substring(0,5) : 'All day'}</div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', marginTop: 2 }}>{ev.title}</div>
                            {ev.event_type && <div style={{ fontSize: 9, color: '#64748b', marginTop: 2 }}>{ev.event_type}</div>}
                          </div>
                        ))}
                        {/* Check reminders as events */}
                        {checksDueToday.map(c => (
                          <div key={'chk-today-'+c.id} onClick={() => setTab('checks')}
                            style={{ flexShrink: 0, background: 'rgba(239,68,68,0.12)', border: '2px solid rgba(239,68,68,0.4)', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', minWidth: 180, animation: 'pulse 2s infinite' }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', fontFamily: 'monospace' }}>📝 CHECK DUE TODAY</div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', marginTop: 2 }}>{c.customer_name}</div>
                            <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 1 }}>{c.order_number ? 'Order #' + c.order_number + ' — ' : ''}{fE(c.amount)}</div>
                          </div>
                        ))}
                        {checksDueTomorrow.map(c => (
                          <div key={'chk-tmrw-'+c.id} onClick={() => setTab('checks')}
                            style={{ flexShrink: 0, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', minWidth: 180 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', fontFamily: 'monospace' }}>📝 CHECK DUE TOMORROW</div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', marginTop: 2 }}>{c.customer_name}</div>
                            <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>{c.order_number ? 'Order #' + c.order_number + ' — ' : ''}{fE(c.amount)}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ── SCORECARD ── */}
                  {(() => {
                    const openTickets = dashTickets.filter(t => t.status !== 'Closed' && t.status !== 'Resolved').length;
                    const overdueTickets = dashTickets.filter(t => t.status !== 'Closed' && t.status !== 'Resolved' && t.due_date && t.due_date < todayStr).length;
                    const teamTickets = dashTickets.filter(t => t.status !== 'Closed' && t.assigned_to !== myId && t.created_by !== myId).length;
                    const cards = [
                      { label: 'Open Tickets', value: openTickets, color: '#60a5fa', icon: '🎫', click: () => setTab('tickets') },
                      { label: 'Overdue Tickets', value: overdueTickets, color: '#ef4444', icon: '⚠️', click: () => setTab('tickets') },
                      { label: 'Team Tickets', value: teamTickets, color: '#38bdf8', icon: '👥', click: () => setTab('tickets') },
                      { label: "Today's Events", value: todayEvents.length, color: '#34d399', icon: '📅', click: () => setTab('calendar') },
                      { label: 'Follow-ups', value: myFollowUps.length, color: '#fbbf24', icon: '🔔', click: () => setTab('crm') },
                    ];
                    if (hasTreasuryAccess) cards.push({ label: 'Pending Checks', value: pendingChecks.length, color: '#f59e0b', icon: '📝', click: () => setTab('checks') });
                    return (
                    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cards.length}, 1fr)`, gap: 8, marginBottom: 10 }}>
                      {cards.map((s, i) => (
                        <div key={i} onClick={s.click}
                          style={{ background: 'rgba(17,24,39,0.7)', border: s.color === '#ef4444' && s.value > 0 ? '2px solid rgba(239,68,68,0.5)' : '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '12px 10px', textAlign: 'center', cursor: 'pointer', transition: 'all 0.2s' }}
                          className="hover:border-blue-500/30">
                          <div style={{ fontSize: 22, fontWeight: 900, color: s.color, fontFamily: 'monospace' }}>{s.value}</div>
                          <div style={{ fontSize: 8, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 2 }}>{s.icon} {s.label}</div>
                        </div>
                      ))}
                    </div>
                    );
                  })()}

                  {/* ── CHECKS CASH FLOW — treasury access only ── */}
                  {hasTreasuryAccess && pendingChecks.length > 0 && (() => {
                    const todayD = new Date().toISOString().substring(0, 10);
                    const tmrwD = new Date(Date.now() + 86400000).toISOString().substring(0, 10);
                    const thisMonthD = todayD.substring(0, 7);
                    const pendingTotal = pendingChecks.reduce((a, c) => a + Number(c.amount || 0), 0);
                    const thisMonthChecks = pendingChecks.filter(c => (c.due_date || c.check_date || '').substring(0, 7) === thisMonthD);
                    const thisMonthTotal = thisMonthChecks.reduce((a, c) => a + Number(c.amount || 0), 0);
                    const overdueList = pendingChecks.filter(c => (c.due_date || c.check_date || '') < todayD && (c.due_date || c.check_date));
                    const overdueTotal = overdueList.reduce((a, c) => a + Number(c.amount || 0), 0);
                    // Show upcoming checks (next 5 soonest)
                    const upcoming5 = [...pendingChecks].sort((a,b) => (a.due_date||a.check_date||'').localeCompare(b.due_date||b.check_date||'')).slice(0, 5);
                    return (
                      <div style={{ background: 'rgba(17,24,39,0.7)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 12, padding: 12, marginBottom: 10 }}>
                        <div onClick={() => setTab('checks')} style={{ cursor: 'pointer' }}>
                          <div style={{ fontSize: 11, fontWeight: 800, color: '#f59e0b', marginBottom: 8, letterSpacing: '0.05em' }}>📝 CHECKS OVERVIEW</div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
                            <div style={{ textAlign: 'center' }}>
                              <div style={{ fontSize: 16, fontWeight: 900, color: '#f59e0b', fontFamily: 'monospace' }}>{fE(pendingTotal)}</div>
                              <div style={{ fontSize: 8, color: '#64748b', textTransform: 'uppercase' }}>Total Outstanding</div>
                            </div>
                            <div style={{ textAlign: 'center' }}>
                              <div style={{ fontSize: 16, fontWeight: 900, color: '#3b82f6', fontFamily: 'monospace' }}>{fE(thisMonthTotal)}</div>
                              <div style={{ fontSize: 8, color: '#64748b', textTransform: 'uppercase' }}>Expected This Month</div>
                            </div>
                            <div style={{ textAlign: 'center' }}>
                              <div style={{ fontSize: 16, fontWeight: 900, color: overdueTotal > 0 ? '#ef4444' : '#10b981', fontFamily: 'monospace' }}>{overdueTotal > 0 ? fE(overdueTotal) : '✓'}</div>
                              <div style={{ fontSize: 8, color: '#64748b', textTransform: 'uppercase' }}>{overdueTotal > 0 ? 'Overdue' : 'None Overdue'}</div>
                            </div>
                          </div>
                        </div>
                        {/* Individual upcoming checks */}
                        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 8 }}>
                          <div style={{ fontSize: 9, color: '#64748b', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Upcoming Checks</div>
                          {upcoming5.map(c => {
                            const dd = c.due_date || c.check_date || '';
                            const isOD = dd < todayD && dd;
                            const isDT = dd === todayD;
                            const isTmrw = dd === tmrwD;
                            const borderColor = isOD ? '#ef4444' : isDT ? '#ef4444' : isTmrw ? '#f59e0b' : 'rgba(255,255,255,0.06)';
                            const bgColor = isOD ? 'rgba(239,68,68,0.08)' : isDT ? 'rgba(239,68,68,0.12)' : isTmrw ? 'rgba(245,158,11,0.08)' : 'transparent';
                            return (
                              <div key={c.id} onClick={() => setTab('checks')}
                                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', borderRadius: 6, marginBottom: 3, cursor: 'pointer', border: '1px solid ' + borderColor, background: bgColor }}>
                                <div>
                                  <div style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0' }}>{c.customer_name}</div>
                                  <div style={{ fontSize: 9, color: '#94a3b8' }}>
                                    {c.order_number ? 'Order #' + c.order_number : ''}
                                    {c.order_number && c.check_number ? ' · ' : ''}{c.check_number ? 'Check #' + c.check_number : ''}
                                  </div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                  <div style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b', fontFamily: 'monospace' }}>{fE(c.amount)}</div>
                                  <div style={{ fontSize: 9, color: isOD ? '#ef4444' : isDT ? '#ef4444' : isTmrw ? '#f59e0b' : '#64748b', fontWeight: isOD || isDT || isTmrw ? 700 : 400 }}>
                                    {isOD ? 'OVERDUE' : isDT ? 'TODAY' : isTmrw ? 'TOMORROW' : dd}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                          {pendingChecks.length > 5 && (
                            <div onClick={() => setTab('checks')} style={{ fontSize: 10, color: '#3b82f6', textAlign: 'center', padding: 4, cursor: 'pointer' }}>
                              View all {pendingChecks.length} checks →
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              );
            })()}

            {/* ===== TEAM REMINDERS ===== */}
            {(() => {
              const todayStr = new Date().toISOString().substring(0, 10);
              const myReminders = reminders.filter(r => {
                const isForMe = !r.target_users || r.target_users === 'all' || (r.target_users || '').includes(userProfile?.id);
                return isForMe;
              });
              const activeReminders = myReminders.filter(r => r.reminder_date === todayStr || (!r.reminder_date && r.created_at && r.created_at.substring(0, 10) === todayStr));
              const archivedReminders = myReminders.filter(r => (r.reminder_date || r.created_at?.substring(0, 10)) < todayStr);
              
              return (
                <div className="mb-4">
                  {/* Active reminders — prominent display */}
                  {activeReminders.length > 0 && (
                    <div className="space-y-2 mb-3">
                      {activeReminders.map(r => {
                        const isUrgent = r.priority === 'urgent';
                        const bgStyle = isUrgent
                          ? { background: '#dc2626', border: '3px solid #fca5a5', boxShadow: '0 4px 20px rgba(220,38,38,0.4)' }
                          : { background: '#1e40af', border: '3px solid #93c5fd', boxShadow: '0 4px 20px rgba(30,64,175,0.3)' };
                        return (
                        <div key={r.id} className="rounded-xl p-4" style={bgStyle}>
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <div style={{ fontSize: '15px', lineHeight: '1.4', fontWeight: 900, color: '#ffffff' }}>
                                📢 {r.message || r.title}
                              </div>
                              <div className="flex gap-3 mt-2" style={{ fontSize: '10px', color: 'rgba(255,255,255,0.7)' }}>
                                <span>From: {getUserName(r.created_by) || 'Admin'}</span>
                                <span>{r.reminder_date || r.created_at?.substring(0, 10)}</span>
                                {r.target_users === 'all' ? <span style={{fontWeight:700}}>👥 All Team</span> : <span>👤 Targeted</span>}
                              </div>
                            </div>
                            <div className="flex flex-col gap-1.5 ml-2">
                              {isUrgent && (
                                <span className="px-2 py-1 rounded-lg text-[10px] font-bold animate-pulse" style={{background:'#fff',color:'#dc2626'}}>🚨 URGENT</span>
                              )}
                              <button onClick={async (e) => { e.stopPropagation(); try { await dbUpdate('team_reminders', r.id, { completed: true }, userProfile?.id); setReminders(prev => prev.filter(x => x.id !== r.id)); } catch(err) { alert(err.message); } }}
                                style={{ background: '#ffffff', color: '#1e40af', border: 'none', padding: '8px 16px', borderRadius: 10, fontSize: '12px', fontWeight: 800, cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}>✓ Dismiss</button>
                              {isAdmin && (
                                <button onClick={async (e) => { e.stopPropagation(); const ok = await toast.confirm({ title: 'Delete Reminder', message: 'Delete this reminder?', confirmText: 'Delete', danger: true }); if (!ok) return; try { await dbDelete('team_reminders', r.id, userProfile?.id); setReminders(prev => prev.filter(x => x.id !== r.id)); } catch(err) { toast.error(err.message); } }}
                                  style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', padding: '4px 10px', borderRadius: 6, fontSize: '10px', cursor: 'pointer' }}>🗑️ Delete</button>
                              )}
                            </div>
                          </div>
                        </div>
                        );
                      })}
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
                            title: formData.reminderMsg.trim(),
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
                          } catch(e) { console.warn('Silent error:', e.message || e); }
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
                          } catch(e) { console.warn('Silent error:', e.message || e); }
                          setFormData({...formData, reminderMsg: '', reminderPriority: 'normal'});
                          setShowReminderForm(false);
                          await loadAllData();
                        } catch(err) { toast.error(err.message); }
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
              {fxRate && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 rounded-lg border border-slate-700">
                  <span className="text-[10px] text-slate-400">USD/EGP</span>
                  <span className="text-sm font-black text-emerald-400">{fxRate.rate.toFixed(2)}</span>
                  <span className="text-[9px] text-slate-500">💱</span>
                </div>
              )}
            </div>


            {/* ===== ANNOUNCEMENTS / URGENT MESSAGES ===== */}
            {isAdmin && (
              <button onClick={() => setShowAddAnnouncement(true)}
                className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-bold mb-3 shadow-lg">📢 Send Message to Team / إرسال رسالة للفريق</button>
            )}
            {showAddAnnouncement && (
              <div className="bg-red-50 rounded-xl p-5 mb-4 border-2 border-red-400 shadow-lg">
                <h4 className="text-lg font-extrabold text-red-800 mb-3">📢 New Message / رسالة جديدة</h4>
                <input value={formData.annTitle || ''} onChange={e => setFormData({...formData, annTitle: e.target.value})}
                  placeholder="Subject / الموضوع *" className="w-full px-4 py-3 rounded-lg border-2 border-red-200 text-base font-bold mb-3" aria-label="Message subject" />
                <textarea value={formData.annBody || ''} onChange={e => setFormData({...formData, annBody: e.target.value})}
                  placeholder="Message details / تفاصيل الرسالة" rows={4} className="w-full px-4 py-3 rounded-lg border-2 border-red-200 text-sm mb-3" aria-label="Message body" />
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="text-xs font-bold text-red-800 block mb-1">Priority / الأهمية</label>
                    <select value={formData.annPriority || 'urgent'} onChange={e => setFormData({...formData, annPriority: e.target.value})}
                      className="w-full px-3 py-2 rounded-lg border text-sm" aria-label="Priority level">
                      <option value="urgent">🚨 URGENT / عاجل</option>
                      <option value="warning">⚠️ Important / مهم</option>
                      <option value="info">ℹ️ Info / معلومة</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-red-800 block mb-1">Send To / إرسال إلى</label>
                    <select value={formData.annTarget || 'all'} onChange={e => setFormData({...formData, annTarget: e.target.value})}
                      className="w-full px-3 py-2 rounded-lg border text-sm" aria-label="Send to">
                      <option value="all">👥 Everyone / الجميع</option>
                      {activeTeamUsers.map(u => <option key={u.id} value={u.id}>👤 {u.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="flex gap-3 items-center mb-3">
                  <label className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" checked={formData.annPin !== false} onChange={e => setFormData({...formData, annPin: e.target.checked})} className="w-4 h-4" /> 📌 Pin to top / تثبيت</label>
                  <label className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" checked={formData.annEmail !== false} onChange={e => setFormData({...formData, annEmail: e.target.checked})} className="w-4 h-4" /> 📧 Email notify / إشعار بريد</label>
                  <label className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" checked={!!formData.annWhatsapp} onChange={e => setFormData({...formData, annWhatsapp: e.target.checked})} className="w-4 h-4" /> 💬 WhatsApp</label>
                </div>
                <div className="flex gap-2">
                  <button onClick={async () => {
                    const title = formData.annTitle || '';
                    const body = formData.annBody || '';
                    const priority = formData.annPriority || 'urgent';
                    const pinned = formData.annPin !== false;
                    const sendEmail = formData.annEmail !== false;
                    const sendWhatsapp = !!formData.annWhatsapp;
                    const target = formData.annTarget || 'all';
                    if (!title) { toast.warning('Subject is required / الموضوع مطلوب'); return; }
                    try {
                      await dbInsert('announcements', {
                        title, body, priority, pinned,
                        target_user: target === 'all' ? null : target,
                        posted_by: userProfile?.id || user?.id,
                        active: true, send_email: sendEmail, send_whatsapp: sendWhatsapp
                      }, user?.id);
                      if (sendEmail) {
                        try {
                          const recipients = target === 'all' ? teamUsers : teamUsers.filter(u => u.id === target);
                          for (const r of recipients) {
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
                      setFormData({});
                      toast.success('Message sent ✓');
                      playAlarmSound(priority === 'urgent');
                      await loadAllData();
                    } catch(err) { toast.error(err.message); }
                  }} className="px-6 py-3 bg-red-600 text-white rounded-lg text-sm font-extrabold shadow-lg">📢 SEND NOW / أرسل الآن</button>
                  <button onClick={() => { setShowAddAnnouncement(false); setFormData({}); }} className="px-4 py-3 border-2 border-slate-300 rounded-lg text-sm font-bold">Cancel</button>
                </div>
              </div>
            )}
            {/* Active Announcements */}
            {(() => {
              const myId = userProfile?.id;
              const active = announcements.filter(a => a.active !== false && (!a.target_user || a.target_user === myId));
              // Sort: pinned first, then by date descending
              const sorted = [...active].sort((a, b) => {
                if (a.pinned && !b.pinned) return -1;
                if (!a.pinned && b.pinned) return 1;
                return (b.created_at || '').localeCompare(a.created_at || '');
              });
              if (sorted.length === 0) return null;
              return (<div className="mb-4">
                {sorted.map(a => {
                  const styles = a.priority === 'urgent'
                    ? { border: '3px solid #ef4444', shadow: '0 4px 20px rgba(239,68,68,0.25)' }
                    : a.priority === 'warning'
                    ? { border: '2px solid #f59e0b', shadow: '0 4px 15px rgba(245,158,11,0.2)' }
                    : { border: '2px solid #3b82f6', shadow: '0 4px 15px rgba(59,130,246,0.15)' };
                  const icon = a.priority === 'urgent' ? '🚨' : a.priority === 'warning' ? '⚠️' : 'ℹ️';
                  const poster = teamUsers.find(u => u.id === a.posted_by);
                  const isTargeted = a.target_user === myId;
                  const thisAcks = announcementAcks.filter(ak => ak.announcement_id === a.id);
                  const myAck = thisAcks.find(ak => ak.user_id === myId);
                  const targetUsers = a.target_user ? teamUsers.filter(u => u.id === a.target_user) : teamUsers;
                  const ackedUsers = targetUsers.filter(u => thisAcks.some(ak => ak.user_id === u.id));
                  const unackedUsers = targetUsers.filter(u => !thisAcks.some(ak => ak.user_id === u.id));
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
                          {/* Acknowledge button */}
                          <div style={{ marginTop: '0.75rem' }}>
                            {myAck ? (
                              <span style={{ fontSize: '0.75rem', color: '#16a34a', fontWeight: 700, background: '#f0fdf4', padding: '4px 12px', borderRadius: 8, border: '1px solid #bbf7d0' }}>✅ Acknowledged {new Date(myAck.acked_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>
                            ) : (
                              <button onClick={async () => {
                                await dbInsert('announcement_acks', { announcement_id: a.id, user_id: myId, acked_at: new Date().toISOString() }, myId);
                                setAnnouncementAcks(prev => [...prev, { announcement_id: a.id, user_id: myId, acked_at: new Date().toISOString() }]);
                              }} style={{ fontSize: '0.8rem', fontWeight: 800, color: '#fff', background: a.priority === 'urgent' ? '#dc2626' : '#2563eb', padding: '6px 16px', borderRadius: 8, cursor: 'pointer', border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
                                👋 Acknowledge / تأكيد الاستلام
                              </button>
                            )}
                          </div>
                          {/* Admin: who acknowledged / who didn't */}
                          {isAdmin && (
                            <div style={{ marginTop: '0.5rem', fontSize: '0.65rem' }}>
                              {ackedUsers.length > 0 && (
                                <div style={{ color: '#16a34a' }}>✅ {ackedUsers.map(u => {
                                  const ack = thisAcks.find(ak => ak.user_id === u.id);
                                  return u.name + (ack ? ' (' + new Date(ack.acked_at).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) + ')' : '');
                                }).join(', ')}</div>
                              )}
                              {unackedUsers.length > 0 && (
                                <div style={{ color: '#dc2626', fontWeight: 700 }}>⏳ Not acknowledged: {unackedUsers.map(u => u.name).join(', ')}</div>
                              )}
                              <div style={{ color: '#94a3b8' }}>{ackedUsers.length}/{targetUsers.length} acknowledged</div>
                            </div>
                          )}
                        </div>
                        {isAdmin && (
                          <div className="flex flex-col gap-1 ml-3">
                            <button onClick={async () => { try { await dbUpdate('announcements', a.id, { active: false }, user?.id); setAnnouncements(prev => prev.map(x => x.id === a.id ? {...x, active: false} : x)); } catch(err) { alert('Archive error: ' + err.message); } }}
                              style={{ fontSize: '0.65rem', color: '#ef4444', cursor: 'pointer', background: 'rgba(239,68,68,0.1)', padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.3)' }}>Archive ✕</button>
                            <button onClick={async () => { try { await dbUpdate('announcements', a.id, { pinned: !a.pinned }, user?.id); setAnnouncements(prev => prev.map(x => x.id === a.id ? {...x, pinned: !x.pinned} : x)); } catch(err) { alert('Pin error: ' + err.message); } }}
                              style={{ fontSize: '0.65rem', color: '#6b7280', cursor: 'pointer', background: 'rgba(0,0,0,0.05)', padding: '4px 8px', borderRadius: 6 }}>{a.pinned ? 'Unpin' : '📌 Pin'}</button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>);
            })()}
            {/* Archived Messages */}
            {(() => {
              const archived = announcements.filter(a => a.active === false);
              if (archived.length === 0) return null;
              return (
                <div className="mb-4">
                  {!hideSections.archivedAnn ? (
                    <button onClick={() => setHideSections({...hideSections, archivedAnn: true})}
                      style={{ fontSize: '0.75rem', color: '#6b7280', cursor: 'pointer', background: 'rgba(0,0,0,0.03)', padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.08)', display: 'block', width: '100%', textAlign: 'center' }}>
                      🗄️ View {archived.length} archived message{archived.length > 1 ? 's' : ''} / عرض الرسائل المؤرشفة
                    </button>
                  ) : (
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#64748b' }}>🗄️ Archived Messages</span>
                        <button onClick={() => setHideSections({...hideSections, archivedAnn: false})}
                          style={{ fontSize: '0.65rem', color: '#94a3b8', cursor: 'pointer' }}>Hide ▲</button>
                      </div>
                      <div className="space-y-2 max-h-[300px] overflow-auto">
                        {archived.map(a => {
                          const icon = a.priority === 'urgent' ? '🚨' : a.priority === 'warning' ? '⚠️' : 'ℹ️';
                          const poster = teamUsers.find(u => u.id === a.posted_by);
                          const thisAcks = announcementAcks.filter(ak => ak.announcement_id === a.id);
                          const targetUsers2 = a.target_user ? teamUsers.filter(u => u.id === a.target_user) : teamUsers;
                          const ackedNames = targetUsers2.filter(u => thisAcks.some(ak => ak.user_id === u.id));
                          const unackedNames = targetUsers2.filter(u => !thisAcks.some(ak => ak.user_id === u.id));
                          return (
                            <div key={a.id} style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(0,0,0,0.02)', border: '1px solid rgba(0,0,0,0.06)' }}>
                              <div className="flex justify-between items-start">
                                <div className="flex-1">
                                  <div style={{ fontSize: '0.85rem', fontWeight: 700 }}>{icon} {a.title}</div>
                                  {a.body && <div style={{ fontSize: '0.75rem', color: '#475569', marginTop: 4, whiteSpace: 'pre-wrap' }}>{a.body}</div>}
                                  <div style={{ fontSize: '0.6rem', color: '#94a3b8', marginTop: 4 }}>
                                    {poster ? poster.name : 'Admin'} • {new Date(a.created_at).toLocaleDateString()}
                                  </div>
                                  {isAdmin && (
                                    <div style={{ fontSize: '0.6rem', marginTop: 4 }}>
                                      {ackedNames.length > 0 && <div style={{ color: '#16a34a' }}>✅ {ackedNames.map(u => {
                                        const ack = thisAcks.find(ak => ak.user_id === u.id);
                                        return u.name + (ack ? ' (' + new Date(ack.acked_at).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) + ')' : '');
                                      }).join(', ')}</div>}
                                      {unackedNames.length > 0 && <div style={{ color: '#dc2626', fontWeight: 700 }}>⏳ {unackedNames.map(u => u.name).join(', ')}</div>}
                                      <div style={{ color: '#94a3b8' }}>{ackedNames.length}/{targetUsers2.length} acknowledged</div>
                                    </div>
                                  )}
                                </div>
                                {isAdmin && (
                                  <button onClick={async () => { try { await dbUpdate('announcements', a.id, { active: true }, user?.id); setAnnouncements(prev => prev.map(x => x.id === a.id ? {...x, active: true} : x)); } catch(err) { alert(err.message); } }}
                                    className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-[10px] font-bold ml-2 hover:bg-blue-600">🔄 Restore</button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}


            {/* Section: Tickets */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '20px 0 12px' }}>
              <div style={{ width: 3, height: 20, borderRadius: 2, background: '#8b5cf6' }} />
              <span style={{ fontSize: 12, fontWeight: 800, color: '#94a3b8', letterSpacing: '0.06em' }}>🎫 TICKETS</span>
              <div style={{ flex: 1, height: 1, background: 'rgba(148,163,184,0.1)' }} />
            </div>

            {/* ===== TICKETS DASHBOARD ===== */}
            {dashTickets.length > 0 && (() => {
              const myId = userProfile?.id;
              const todayStr = new Date().toISOString().substring(0, 10);
              const twoDaysAgo = new Date(Date.now() - 48 * 3600000).toISOString();
              const priColor = (p) => p === 'high' ? '#ef4444' : p === 'low' ? '#10b981' : '#f59e0b';
              const timeAgo = (d) => { const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000); if (m < 60) return m + 'm'; const h = Math.floor(m/60); if (h < 24) return h + 'h'; return Math.floor(h/24) + 'd'; };

              const myTickets = dashTickets.filter(t => (t.assigned_to === myId || t.created_by === myId) && t.status !== 'Closed');
              const newlyAssigned = myTickets.filter(t => t.assigned_to === myId && t.created_at >= twoDaysAgo);
              const myUpdates = recentTicketUpdates.filter(c => c.tickets && (c.tickets.assigned_to === myId || c.tickets.created_by === myId));
              const overdueTickets = myTickets.filter(t => t.due_date && t.due_date < todayStr);

              const sectionStyle = { background: 'rgba(17,24,39,0.7)', borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)', marginBottom: 10, overflow: 'hidden' };
              const sectionHeaderStyle = (color, bgColor) => ({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: bgColor });
              const sectionLabel = (icon, text, count, color) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14 }}>{icon}</span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: color, letterSpacing: '0.03em' }}>{text}</span>
                  <span style={{ fontSize: 10, fontWeight: 800, color: '#fff', background: color, borderRadius: 10, padding: '1px 8px', minWidth: 20, textAlign: 'center' }}>{count}</span>
                </div>
              );

              const TicketCard = ({ t, accent }) => {
                const lastUpdate = recentTicketUpdates.find(c => c.tickets?.id === t.id);
                const updaterName = lastUpdate ? ((teamUsers || []).find(u => u.id === lastUpdate.created_by)?.name || 'System') : null;
                return (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer', transition: 'background 0.15s' }}
                  className="hover:bg-white/5" onClick={() => { setOpenTicketId(t.id); setTab('tickets'); }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: priColor(t.priority), flexShrink: 0, marginTop: 6 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: '#818cf8', fontFamily: 'monospace' }}>{t.ticket_number}</span>
                      <span style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 4, fontSize: 11, color: '#64748b', alignItems: 'center' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 4, fontWeight: 700, fontSize: 10,
                        background: t.status === 'New' ? 'rgba(59,130,246,0.2)' : t.status === 'In Progress' ? 'rgba(234,179,8,0.2)' : 'rgba(139,92,246,0.2)',
                        color: t.status === 'New' ? '#60a5fa' : t.status === 'In Progress' ? '#fbbf24' : '#a78bfa' }}>{t.status}</span>
                      {t.assigned_to && <span style={{ color: '#94a3b8' }}>→ {getUserName(t.assigned_to)}</span>}
                      {t.due_date && t.due_date < todayStr && <span style={{ color: '#f87171', fontWeight: 700 }}>⚠ OVERDUE</span>}
                      {t.due_date && t.due_date >= todayStr && <span>Due: {t.due_date}</span>}
                    </div>
                    {lastUpdate && (
                      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 5, padding: '4px 8px', background: 'rgba(139,92,246,0.06)', borderRadius: 6, borderLeft: '2px solid #a78bfa' }}>
                        <span style={{ fontWeight: 700, color: '#a78bfa' }}>{updaterName}</span>
                        <span style={{ color: '#64748b' }}> · {timeAgo(lastUpdate.created_at)}</span>
                        <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 2 }}>{(lastUpdate.comment_text || '').substring(0, 120)}{(lastUpdate.comment_text || '').length > 120 ? '…' : ''}</div>
                      </div>
                    )}
                    {!lastUpdate && t.updated_by && (
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                        Last updated by <span style={{ fontWeight: 600, color: '#94a3b8' }}>{getUserName(t.updated_by) || 'Unknown'}</span> · {timeAgo(t.updated_at)}
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize: 11, color: '#475569', flexShrink: 0 }}>{timeAgo(t.created_at)}</span>
                </div>
                );
              };

              const UpdateCard = ({ c }) => {
                const ticket = c.tickets;
                if (!ticket) return null;
                const commenter = (teamUsers || []).find(u => u.id === c.created_by);
                return (
                  <div style={{ display: 'flex', gap: 10, padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer', transition: 'background 0.15s' }}
                    className="hover:bg-white/5" onClick={() => { setOpenTicketId(ticket.id); setTab('tickets'); }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(139,92,246,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>
                      {c.is_system ? '🤖' : '💬'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 800, color: '#818cf8', fontFamily: 'monospace' }}>{ticket.ticket_number}</span>
                        <span style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ticket.title}</span>
                      </div>
                      <div style={{ fontSize: 13, color: '#cbd5e1', marginTop: 4, padding: '4px 8px', background: 'rgba(139,92,246,0.06)', borderRadius: 6, borderLeft: '2px solid #a78bfa' }}>
                        <span style={{ fontWeight: 700, color: '#a78bfa' }}>{commenter?.name || 'System'}</span>
                        <span style={{ color: '#64748b' }}> · {timeAgo(c.created_at)}</span>
                        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{(c.comment_text || '').substring(0, 150)}{(c.comment_text || '').length > 150 ? '…' : ''}</div>
                      </div>
                    </div>
                  </div>
                );
              };

              const recentlyUpdated = myTickets.filter(t => t.updated_at && t.updated_at >= twoDaysAgo).sort((a,b) => (b.updated_at||'').localeCompare(a.updated_at||''));

              const toggleSection = (key) => setHideSections(prev => ({...prev, [key]: !prev[key]}));
              const isExpanded = (key) => hideSections[key] === true;

              const CollapsibleSection = ({ id, icon, title, count, color, bgColor, borderColor, items, renderItem, defaultShow }) => {
                const show = defaultShow || 5;
                const expanded = isExpanded('dash_' + id);
                const visible = expanded ? items : items.slice(0, show);
                if (items.length === 0) return null;
                return (
                  <div style={{ ...sectionStyle, ...(borderColor ? { border: '1px solid ' + borderColor } : {}) }}>
                    <div style={sectionHeaderStyle(color, bgColor)} className="cursor-pointer" onClick={() => toggleSection('dash_' + id)}>
                      {sectionLabel(icon, title, count, color)}
                      <span style={{ fontSize: 10, color: '#64748b' }}>{expanded ? '▲ Collapse' : '▼ Show All'}</span>
                    </div>
                    {visible.map(renderItem)}
                    {!expanded && items.length > show && (
                      <div style={{ padding: '8px 14px', fontSize: 11, color: color, fontWeight: 700, textAlign: 'center', cursor: 'pointer', background: 'rgba(255,255,255,0.02)' }}
                        onClick={() => toggleSection('dash_' + id)}>
                        Show all {items.length} (+{items.length - show} more) ▼
                      </div>
                    )}
                  </div>
                );
              };

              return (
                <div style={{ marginBottom: 16 }}>
                  {/* ── 1. NEWLY ASSIGNED ── */}
                  <CollapsibleSection id="newAssign" icon="✨" title="Newly Assigned to You" count={newlyAssigned.length}
                    color="#60a5fa" bgColor="rgba(59,130,246,0.08)" items={newlyAssigned}
                    renderItem={(t) => <TicketCard key={t.id} t={t} accent="#60a5fa" />} />

                  {/* ── 2. OVERDUE TICKETS ── */}
                  <CollapsibleSection id="overdue" icon="🚨" title="Overdue Tickets" count={overdueTickets.length}
                    color="#f87171" bgColor="rgba(239,68,68,0.1)" borderColor="rgba(239,68,68,0.3)" items={overdueTickets}
                    renderItem={(t) => <TicketCard key={t.id} t={t} accent="#f87171" />} />

                  {/* ── 3. RECENTLY UPDATED ── */}
                  {myUpdates.length > 0 && (
                    <CollapsibleSection id="recentUpd" icon="💬" title="Recently Updated" count={myUpdates.length}
                      color="#a78bfa" bgColor="rgba(139,92,246,0.08)" items={myUpdates}
                      renderItem={(c) => <UpdateCard key={c.id} c={c} />} />
                  )}
                  {recentlyUpdated.length > 0 && myUpdates.length === 0 && (
                    <CollapsibleSection id="recentUpd2" icon="🔄" title="Recently Updated Tickets" count={recentlyUpdated.length}
                      color="#a78bfa" bgColor="rgba(139,92,246,0.08)" items={recentlyUpdated}
                      renderItem={(t) => <TicketCard key={t.id} t={t} accent="#a78bfa" />} />
                  )}

                  {/* ── 4. ALL MY OPEN TICKETS ── */}
                  <CollapsibleSection id="allOpen" icon="📋" title="All My Open Tickets" count={myTickets.length}
                    color="#94a3b8" bgColor="rgba(255,255,255,0.03)" items={myTickets}
                    renderItem={(t) => <TicketCard key={t.id} t={t} accent="#94a3b8" />} />
                </div>
              );
            })()}


            {/* Section: Activity */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '20px 0 12px' }}>
              <div style={{ width: 3, height: 20, borderRadius: 2, background: '#0ea5e9' }} />
              <span style={{ fontSize: 12, fontWeight: 800, color: '#94a3b8', letterSpacing: '0.06em' }}>📋 TEAM ACTIVITY</span>
              <div style={{ flex: 1, height: 1, background: 'rgba(148,163,184,0.1)' }} />
            </div>

            {/* ===== TEAM ACTIVITY FEED ===== */}
            {activityFeed.length > 0 && (() => {
              const expanded = hideSections.dash_teamFeed;
              const visible = expanded ? activityFeed.slice(0, 100) : activityFeed.slice(0, 5);
              return (
              <div style={{ background: 'rgba(17,24,39,0.7)', borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)', marginBottom: 16, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(52,211,153,0.06)', cursor: 'pointer' }}
                  onClick={() => setHideSections(prev => ({...prev, dash_teamFeed: !prev.dash_teamFeed}))}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#34d399', boxShadow: '0 0 8px rgba(52,211,153,0.5)', animation: 'pulse 2s infinite' }} />
                    <span style={{ fontSize: 12, fontWeight: 800, color: '#34d399', letterSpacing: '0.03em' }}>Team Activity</span>
                    <span style={{ fontSize: 10, fontWeight: 800, color: '#fff', background: '#34d399', borderRadius: 10, padding: '1px 8px' }}>{activityFeed.length}</span>
                  </div>
                  <span style={{ fontSize: 10, color: '#64748b' }}>{expanded ? '▲ Collapse' : '▼ Show All'}</span>
                </div>
                {visible.map((a, i) => {
                  const who = (teamUsers || []).find(u => u.id === a.user_id);
                  const name = who?.name || 'System';
                  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().substring(0, 2);
                  const colors = ['bg-blue-500','bg-purple-500','bg-emerald-500','bg-amber-500','bg-rose-500','bg-cyan-500'];
                  const color = colors[(name.charCodeAt(0) || 0) % colors.length];
                  const timeAgo = (() => {
                    const diff = Date.now() - new Date(a.created_at).getTime();
                    const mins = Math.floor(diff / 60000);
                    if (mins < 1) return 'just now';
                    if (mins < 60) return mins + 'm ago';
                    const hrs = Math.floor(mins / 60);
                    if (hrs < 24) return hrs + 'h ago';
                    return Math.floor(hrs / 24) + 'd ago';
                  })();
                  const icon = a.log_category === 'finance' ? '💰' : a.log_category === 'crm' ? '🤝' : a.log_category === 'ticket' ? '🎫' : a.log_category === 'shipping' ? '🚢' : a.log_category === 'admin' ? '⚙️' : a.log_category === 'login' ? '🟢' : '📋';
                  return (
                    <div key={a.id || i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 14px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <div className={`w-7 h-7 rounded-full ${color} text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5`}>{initials}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12 }}>
                          <span style={{ fontWeight: 700, color: '#e2e8f0' }}>{name}</span>
                          <span style={{ color: '#94a3b8', marginLeft: 6 }}>{a.entry_text}</span>
                        </div>
                        <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>{icon} {a.log_category || 'general'} · {timeAgo}</div>
                      </div>
                    </div>
                  );
                })}
                {!expanded && activityFeed.length > 5 && (
                  <div style={{ padding: '8px 14px', fontSize: 11, color: '#34d399', fontWeight: 700, textAlign: 'center', cursor: 'pointer', background: 'rgba(255,255,255,0.02)' }}
                    onClick={() => setHideSections(prev => ({...prev, dash_teamFeed: true}))}>
                    Show all ({Math.min(activityFeed.length, 100)}) ▼
                  </div>
                )}
              </div>
              );
            })()}

            {/* ===== PENDING CHECKS ===== */}
            {pendingChecks && pendingChecks.length > 0 && (isSuperAdmin || modulePerms['Treasury']) && (() => {
              const expanded = hideSections.dash_pendChecks;
              const sorted = [...pendingChecks].sort((a,b) => (a.check_date || a.date || '').localeCompare(b.check_date || b.date || ''));
              const visible = expanded ? sorted : sorted.slice(0, 5);
              const total = sorted.reduce((a, c) => a + Number(c.amount || 0), 0);
              return (
                <div style={{ background: 'rgba(17,24,39,0.7)', borderRadius: 14, border: '1px solid rgba(251,191,36,0.2)', marginBottom: 16, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(251,191,36,0.06)', cursor: 'pointer' }}
                    onClick={() => setHideSections(prev => ({...prev, dash_pendChecks: !prev.dash_pendChecks}))}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 14 }}>🧾</span>
                      <span style={{ fontSize: 12, fontWeight: 800, color: '#fbbf24', letterSpacing: '0.03em' }}>Pending Checks</span>
                      <span style={{ fontSize: 10, fontWeight: 800, color: '#fff', background: '#f59e0b', borderRadius: 10, padding: '1px 8px' }}>{sorted.length}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#fbbf24', marginLeft: 8 }}>{fE(total)}</span>
                    </div>
                    <span style={{ fontSize: 10, color: '#64748b' }}>{expanded ? '▲ Collapse' : '▼ Show All'}</span>
                  </div>
                  {visible.map((c, i) => (
                    <div key={c.id || i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>{c.payee || c.description || 'Check #' + (c.check_number || i+1)}</div>
                        <div style={{ fontSize: 10, color: '#64748b' }}>{c.check_date || c.date || '—'} {c.check_number ? '· #' + c.check_number : ''}</div>
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 800, color: '#fbbf24', fontFamily: 'monospace' }}>{fE(Number(c.amount || 0))}</span>
                    </div>
                  ))}
                  {!expanded && sorted.length > 5 && (
                    <div style={{ padding: '8px 14px', fontSize: 11, color: '#fbbf24', fontWeight: 700, textAlign: 'center', cursor: 'pointer', background: 'rgba(255,255,255,0.02)' }}
                      onClick={() => setHideSections(prev => ({...prev, dash_pendChecks: true}))}>
                      Show all {sorted.length} ▼
                    </div>
                  )}
                </div>
              );
            })()}



            {/* Section: Financial */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '20px 0 12px' }}>
              <div style={{ width: 3, height: 20, borderRadius: 2, background: '#10b981' }} />
              <span style={{ fontSize: 12, fontWeight: 800, color: '#94a3b8', letterSpacing: '0.06em' }}>💰 FINANCIAL OVERVIEW</span>
              <div style={{ flex: 1, height: 1, background: 'rgba(148,163,184,0.1)' }} />
            </div>

            {/* ===== FINANCIAL DASHBOARD — COMMAND CENTER ===== */}
            <div className="financial-command">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div style={{ width: 4, height: 28, borderRadius: 2, background: 'linear-gradient(180deg, #38bdf8, #818cf8)' }} />
              <h2 style={{ fontSize: 16, fontWeight: 900, color: '#e2e8f0', letterSpacing: '0.05em' }}>💰 FINANCIAL CONTROL</h2>
              <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.06)' }} />
            </div>

            {/* Timeframe selector */}
            <div className="mb-4 flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold text-slate-500">📅 Viewing / عرض:</span>
              {[['all', '🔄 All Time / كل الوقت'], ['ytd', '📅 This Year'], ['1mo', '1 Month'], ['3mo', '3 Months'], ['custom', '📆 Custom / مخصص']].map(([v, l]) => (
                <button key={v} onClick={() => setMode(v)}
                  className={'px-3 py-1.5 rounded-lg text-[11px] font-bold transition ' + (mode === v ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-white')}
                  style={mode !== v ? { background: 'rgba(255,255,255,0.06)' } : {}}
                >{l}</button>
              ))}
              {mode === 'custom' && (
                <span className="flex gap-1 items-center">
                  <DatePickerSelect value={df} onChange={v => setDf(v)} />
                  <span className="text-xs text-slate-500">→</span>
                  <DatePickerSelect value={dt} onChange={v => setDt(v)} />
                </span>
              )}
            </div>

            {/* Invoices — Sales or Treasury access */}
            {(isSuperAdmin || modulePerms['Sales'] || modulePerms['Treasury']) && (<>
            <div className="bg-blue-100 rounded-lg px-3 py-2 mb-3 flex justify-between items-center cursor-pointer" onClick={() => setHideSections({...hideSections, invoices: !hideSections.invoices})}>
              <span className="text-sm font-bold text-blue-800">📋 INVOICES / فواتير العملاء</span>
              <span className="text-xs text-blue-600">{hideSections.invoices ? '👁️ Show' : '🙈 Hide'}</span>
            </div>
            {!hideSections.invoices && <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
              <Card title="Invoiced" titleAr="الفواتير" value={fE(totalInvoiced)} sub={`${filteredInvoices.length} inv`} color="#0ea5e9" onClick={() => setDrillType('invoiced')} spark={sparkData.inv} />
              <Card title="Collected" titleAr="المحصّل" value={fE(totalCollected)} color="#10b981" onClick={() => setDrillType('collected')} spark={sparkData.col} />
              <Card title="Outstanding" titleAr="المتبقّي" value={fE(totalOutstanding)} sub={`${filteredInvoices.filter(s => s.outstanding > 0).length} open`} color="#ef4444" onClick={() => setDrillType('outstanding')} />
              <Card title="Debt" titleAr="المديونية" value={fE(totalDebt)} sub={`${debts.length} debtors`} color="#dc2626" onClick={() => navigate('debts')} />
            </div>}
            </>)}

            {/* Cash Register — Treasury access ONLY */}
            {(isSuperAdmin || modulePerms['Treasury']) && (<>
            <div className="bg-emerald-100 rounded-lg px-3 py-2 mb-3 flex justify-between items-center cursor-pointer" onClick={() => setHideSections({...hideSections, cash: !hideSections.cash})}>
              <div>
                <span className="text-sm font-bold text-emerald-800">🏦 CASH REGISTER / الخزنة</span>
                <span className="text-xs text-emerald-600 ml-2">(Loaded: {treasury.length} rows, Filtered: {filteredTreasury.length})</span>
              </div>
              <span className="text-xs text-emerald-600">{hideSections.cash ? '👁️ Show' : '🙈 Hide'}</span>
            </div>
            {!hideSections.cash && <>
            <div className="text-[10px] text-emerald-700 font-bold uppercase tracking-wide mb-1">Safe / الخزنة (physical cash)</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
              <Card title="Cash In" titleAr="وارد" value={fE(totalCashIn)} sub="Safe only / خزنة فقط" color="#10b981" onClick={() => setTreasuryDrill('in')} spark={sparkData.cin} />
              <Card title="Cash Out" titleAr="منصرف" value={fE(totalCashOut)} sub="Safe only / خزنة فقط" color="#ef4444" onClick={() => setTreasuryDrill('out')} spark={sparkData.cout} />
              <Card title="Net" titleAr="صافي" value={fE(totalCashIn - totalCashOut)} sub="Safe balance / رصيد الخزنة" color={totalCashIn > totalCashOut ? '#10b981' : '#ef4444'} onClick={() => setTreasuryDrill('net')} />
              <Card title="Checks" titleAr="شيكات" value={fE(pendingChecks.reduce((a, c) => a + Number(c.amount), 0))} sub={`${pendingChecks.length} pending`} color="#f59e0b" onClick={() => navigate('checks')} />
            </div>
            {(totalBankIn > 0 || totalBankOut > 0) && (
              <>
                <div className="text-[10px] text-indigo-700 font-bold uppercase tracking-wide mb-1">🏦 Bank / البنك (tracked separately — does NOT affect safe balance)</div>
                <div className="grid grid-cols-3 gap-3 mb-5">
                  <div className="rounded-xl p-3" style={{ background: '#eef2ff', borderLeft: '4px solid #6366f1' }}>
                    <div className="text-[10px] text-indigo-600 font-bold">Bank In / وارد بنكي</div>
                    <div className="text-lg font-extrabold text-indigo-700">{fE(totalBankIn)}</div>
                    <div className="text-[9px] text-indigo-500">counted toward invoice collected</div>
                  </div>
                  <div className="rounded-xl p-3" style={{ background: '#eef2ff', borderLeft: '4px solid #6366f1' }}>
                    <div className="text-[10px] text-indigo-600 font-bold">Bank Out / صادر بنكي</div>
                    <div className="text-lg font-extrabold text-indigo-700">{fE(totalBankOut)}</div>
                    <div className="text-[9px] text-indigo-500">bank-paid expenses</div>
                  </div>
                  <div className="rounded-xl p-3" style={{ background: '#eef2ff', borderLeft: '4px solid #6366f1' }}>
                    <div className="text-[10px] text-indigo-600 font-bold">Bank Net / صافي البنك</div>
                    <div className={'text-lg font-extrabold ' + (totalBankIn >= totalBankOut ? 'text-indigo-700' : 'text-red-600')}>{fE(totalBankIn - totalBankOut)}</div>
                    <div className="text-[9px] text-indigo-500">not included in safe net</div>
                  </div>
                </div>
              </>
            )}

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

            </>}{/* end cash register gate */}
            </>)}{/* end treasury gate */}

            {/* Monthly Sales — Sales or Treasury permission, current year only */}
            {(isSuperAdmin || modulePerms['Sales'] || modulePerms['Treasury']) && (
            <div className="bg-white rounded-xl p-4 mb-4">
              <h3 className="text-sm font-bold mb-2">📊 Monthly Sales — {new Date().getFullYear()} / المبيعات الشهرية</h3>
              {(() => {
                const currentYear = String(new Date().getFullYear());
                const ytdInvoices = invoices.filter(inv => (inv.invoice_date || '').startsWith(currentYear));
                const months = {};
                let running = 0;
                ytdInvoices.forEach(inv => {
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
            )}{/* end monthly sales gate */}

            {/* Income/Expense Buckets + USD — Treasury access only */}
            {(isSuperAdmin || modulePerms['Treasury']) && (<>
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
                        <span>{e.eng}{e.eng !== e.cat && <span className="text-slate-400 text-[10px] ml-1">({e.cat})</span>}</span>
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
                      <span>{e.eng}{e.eng !== e.cat && <span className="text-slate-400 text-[10px] ml-1">({e.cat})</span>}</span>
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
            </>)}{/* end treasury gate for buckets */}
            </div>{/* end financial-command */}

            {/* ===== EGYPT BANK TRANSACTIONS DASHBOARD ===== */}
            {egyptBankTxns.length > 0 && (isSuperAdmin || modulePerms['Egypt Bank']) && (() => {
              const recent = egyptBankTxns.slice(0, 20);
              const totalIn = egyptBankTxns.filter(t => t.amount > 0).reduce((s, t) => s + Number(t.amount), 0);
              const totalOut = egyptBankTxns.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
              const unmatched = egyptBankTxns.filter(t => !t.matched_invoice_id).length;
              const uncategorized = egyptBankTxns.filter(t => !t.category).length;
              return (
                <div className="mb-4">
                  <div className="flex justify-between items-center mb-2 cursor-pointer" onClick={() => setHideSections({...hideSections, egyptBankDash: !hideSections.egyptBankDash})}>
                    <h3 className="text-sm font-bold" style={{ color: '#059669' }}>🇪🇬 Egypt Bank — {egyptBankTxns.length} transactions</h3>
                    <span className="text-xs text-slate-400">{hideSections.egyptBankDash ? '👁️' : '🙈'}</span>
                  </div>
                  {!hideSections.egyptBankDash && (
                    <div>
                      <div className="grid grid-cols-4 gap-2 mb-2">
                        <div className="bg-green-50 rounded-lg p-2 border border-green-200 text-center">
                          <div className="text-[9px] text-green-600 font-bold">Deposits</div>
                          <div className="text-xs font-black text-green-700">{fE(totalIn)}</div>
                        </div>
                        <div className="bg-red-50 rounded-lg p-2 border border-red-200 text-center">
                          <div className="text-[9px] text-red-600 font-bold">Withdrawals</div>
                          <div className="text-xs font-black text-red-700">{fE(totalOut)}</div>
                        </div>
                        <div className="bg-amber-50 rounded-lg p-2 border border-amber-200 text-center">
                          <div className="text-[9px] text-amber-600 font-bold">Unmatched</div>
                          <div className="text-xs font-black text-amber-700">{unmatched}</div>
                        </div>
                        <div className="bg-slate-50 rounded-lg p-2 border border-slate-200 text-center">
                          <div className="text-[9px] text-slate-600 font-bold">No Category</div>
                          <div className="text-xs font-black text-slate-700">{uncategorized}</div>
                        </div>
                      </div>
                      <div className="space-y-1 max-h-[250px] overflow-auto">
                        {recent.map(t => (
                          <div key={t.id} className="flex items-center justify-between bg-white rounded-lg p-2 border text-xs cursor-pointer hover:bg-slate-50" onClick={() => setTab('egyptbank')}>
                            <div className="flex-1 min-w-0">
                              <div className="font-semibold truncate">{t.description || '—'}</div>
                              <div className="text-[9px] text-slate-400">{t.date} {t.category ? '• ' + (EXPENSE_CATS[t.category] || t.category) : ''}{t.matched_invoice_id ? ' ✅' : ''}</div>
                            </div>
                            <div className={'font-bold ml-2 ' + (t.amount > 0 ? 'text-green-600' : 'text-red-600')}>{t.amount > 0 ? '+' : ''}{fE(t.amount)}</div>
                          </div>
                        ))}
                      </div>
                      <button onClick={() => setTab('egyptbank')} className="w-full mt-2 py-2 text-center text-xs font-bold text-emerald-600 bg-emerald-50 rounded-lg hover:bg-emerald-100 transition">
                        Open Egypt Bank →
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}


            {/* ===== USD DOLLAR LEDGER ===== */}
            {(isSuperAdmin || modulePerms['Treasury']) && (() => {
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

            {/* ===== FOREIGN CURRENCY LEDGER (EUR/GBP/SAR/AED/etc) ===== */}
            {(isSuperAdmin || modulePerms['Treasury']) && (() => {
              const foreignTxns = filteredTreasury.filter(t => Number(t.foreign_amount || 0) > 0 && t.foreign_currency);
              if (foreignTxns.length === 0) return null;
              const byCur = {};
              foreignTxns.forEach(t => {
                const c = t.foreign_currency;
                if (!byCur[c]) byCur[c] = { in: 0, out: 0, txns: [] };
                if (t.foreign_direction === 'in') byCur[c].in += Number(t.foreign_amount);
                else byCur[c].out += Number(t.foreign_amount);
                byCur[c].txns.push(t);
              });
              return (
                <div className="mt-6">
                  <div className="bg-indigo-100 rounded-lg px-3 py-2 mb-3 flex justify-between items-center cursor-pointer" onClick={() => setHideSections({...hideSections, foreign: !hideSections.foreign})}>
                    <span className="text-sm font-bold text-indigo-800">🌍 FOREIGN CURRENCY LEDGER / دفتر العملات الأجنبية</span>
                    <span className="text-xs text-indigo-600">{hideSections.foreign ? '👁️ Show' : '🙈 Hide'}</span>
                  </div>
                  {!hideSections.foreign && Object.entries(byCur).map(([cur, data]) => (
                    <div key={cur} className="mb-4">
                      <div className="grid grid-cols-3 gap-3 mb-2">
                        <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#10b981'}}>
                          <div className="text-[10px] text-slate-500">{cur} In / وارد</div>
                          <div className="text-lg font-extrabold text-emerald-600">{data.in.toLocaleString()} {cur}</div>
                        </div>
                        <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:'#ef4444'}}>
                          <div className="text-[10px] text-slate-500">{cur} Out / صادر</div>
                          <div className="text-lg font-extrabold text-red-500">{data.out.toLocaleString()} {cur}</div>
                        </div>
                        <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3,borderLeftColor:(data.in-data.out)>=0?'#10b981':'#ef4444'}}>
                          <div className="text-[10px] text-slate-500">{cur} Net / صافي</div>
                          <div className={'text-lg font-extrabold ' + ((data.in-data.out)>=0?'text-emerald-600':'text-red-500')}>{(data.in-data.out).toLocaleString()} {cur}</div>
                        </div>
                      </div>
                      <div className="bg-white rounded-lg p-3 overflow-auto max-h-[250px]">
                        <table className="w-full border-collapse">
                          <thead className="sticky top-0"><tr className="bg-slate-50">
                            <th className="px-2 py-1.5 text-[10px] text-left">Date</th>
                            <th className="px-2 py-1.5 text-[10px]" style={{direction:'rtl'}}>Description</th>
                            <th className="px-2 py-1.5 text-[10px] text-right">In</th>
                            <th className="px-2 py-1.5 text-[10px] text-right">Out</th>
                          </tr></thead>
                          <tbody>
                            {data.txns.slice(0, 50).map(t => (
                              <tr key={t.id} className="border-b border-slate-50">
                                <td className="px-2 py-1 text-[10px]">{t.transaction_date}</td>
                                <td className="px-2 py-1 text-[10px]" style={{direction: lang === 'ar' ? 'rtl' : 'ltr'}}>{t.description}</td>
                                <td className="px-2 py-1 text-[10px] text-right text-emerald-600 font-semibold">{t.foreign_direction === 'in' ? Number(t.foreign_amount).toLocaleString() : ''}</td>
                                <td className="px-2 py-1 text-[10px] text-right text-red-500 font-semibold">{t.foreign_direction === 'out' ? Number(t.foreign_amount).toLocaleString() : ''}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}


            {/* ===== SALES BY DIVISION + TREASURY CATEGORIES (side by side) ===== */}
            {isAdmin && (() => {
              const divData = {};
              filteredInvoices.forEach(inv => {
                const cust = customers.find(c => c.id === inv.customer_id || c.name === inv.customer_name);
                const div = inv.division || cust?.group_name || 'Other';
                divData[div] = (divData[div] || 0) + Number(inv.total_amount || 0);
              });
              const divSorted = Object.entries(divData).sort((a, b) => b[1] - a[1]).slice(0, 8);
              const divMax = divSorted[0]?.[1] || 1;

              const catData = {};
              filteredTreasury.forEach(t => {
                const cat = t.expense_category || 'Uncategorized';
                if (Number(t.cash_out || 0) > 0) catData[cat] = (catData[cat] || 0) + Number(t.cash_out);
              });
              const catSorted = Object.entries(catData).sort((a, b) => b[1] - a[1]).slice(0, 8);
              const catMax = catSorted[0]?.[1] || 1;

              if (divSorted.length <= 1 && catSorted.length <= 1) return null;
              return (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                  {divSorted.length > 1 && (
                    <div className="bg-white rounded-xl p-4">
                      <h3 className="text-xs font-extrabold text-slate-700 mb-3">📊 Sales by Division</h3>
                      <div className="space-y-2">
                        {divSorted.map(([div, amt], i) => (
                          <div key={div}>
                            <div className="flex justify-between text-[10px] mb-0.5">
                              <span className="font-semibold text-slate-700 truncate max-w-[60%]">{div}</span>
                              <span className="font-bold text-blue-600">{fE(amt)}</span>
                            </div>
                            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                              <div className="h-full rounded-full transition-all" style={{ width: (amt / divMax * 100) + '%', background: COLORS[i % COLORS.length] }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {catSorted.length > 1 && (
                    <div className="bg-white rounded-xl p-4">
                      <h3 className="text-xs font-extrabold text-slate-700 mb-3">💸 Treasury Categories</h3>
                      <div className="space-y-2">
                        {catSorted.map(([cat, amt], i) => (
                          <div key={cat}>
                            <div className="flex justify-between text-[10px] mb-0.5">
                              <span className="font-semibold text-slate-700 truncate max-w-[60%]">{cat}</span>
                              <span className="font-bold text-red-500">{fE(amt)}</span>
                            </div>
                            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                              <div className="h-full rounded-full transition-all" style={{ width: (amt / catMax * 100) + '%', background: ['#ef4444','#f97316','#eab308','#22c55e','#06b6d4','#8b5cf6','#ec4899','#64748b'][i % 8] }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
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
                <button onClick={() => setInvoiceSort(invoiceSort === 'newest' ? 'oldest' : 'newest')}
                  className="px-2 py-1 rounded-lg border border-slate-200 text-xs font-semibold hover:bg-slate-100">
                  {invoiceSort === 'newest' ? '↓ Newest' : '↑ Oldest'}
                </button>
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
                <button onClick={() => { setShowAddInvoice(true); setFormData({ date: today() }); }}
                  className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-semibold hover:bg-blue-600">
                  + New Invoice
                </button>
                <button onClick={() => generateReconReport()}
                  className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-xs font-semibold hover:bg-red-600">
                  📊 Recon Report
                </button>
                <button onClick={() => {
                  const rows = filteredInvoices.map(i => ({
                    'Invoice #': i.invoice_number || i.order_number || '', Customer: i.customer || i.customer_name || '',
                    Date: i.invoice_date || '', Amount: i.amount || i.total_amount || '',
                    Paid: i.total_collected || 0, Outstanding: i.outstanding || 0,
                    Status: getReconStatus(i)?.label || '', Division: i.product_type || '',
                  }));
                  const ws = XLSX.utils.json_to_sheet(rows);
                  ws['!cols'] = [{wch:14},{wch:30},{wch:12},{wch:14},{wch:14},{wch:14},{wch:14},{wch:14}];
                  const wb = XLSX.utils.book_new();
                  XLSX.utils.book_append_sheet(wb, ws, 'Sales');
                  XLSX.writeFile(wb, `Sales-Export-${new Date().toISOString().substring(0,10)}.xlsx`);
                }} className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-xs font-semibold hover:bg-slate-200">
                  📥 Export
                </button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div className="bg-white rounded-lg p-3 border-l-3" style={{ borderLeftWidth: 3, borderLeftColor: '#0ea5e9' }}>
                <div className="text-[10px] text-slate-500">Invoiced</div>
                <div className="text-lg font-extrabold text-sky-600">{fE(totalInvoiced)}</div>
              </div>
              <div className="bg-white rounded-lg p-3" style={{ borderLeftWidth: 3, borderLeftColor: '#10b981' }}>
                <div className="text-[10px] text-slate-500">Collected</div>
                <div className="text-lg font-extrabold text-emerald-600">{fE(totalCollected)}</div>
              </div>
              <div className="bg-white rounded-lg p-3" style={{ borderLeftWidth: 3, borderLeftColor: '#ef4444' }}>
                <div className="text-[10px] text-slate-500">Outstanding</div>
                <div className="text-lg font-extrabold text-red-500">{fE(totalOutstanding)}</div>
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
                const tTotal = txns.reduce((a, t) => a + Number(t.cash_in || 0) + Number(t.bank_in || 0), 0);
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
                    const ok = await toast.confirm({ title: 'Merge Customers', message: 'Merge ' + targets.length + ' customers into "' + finalName + '"? This will update ALL invoices, checks, and treasury entries.', confirmText: 'Merge', danger: true });
                    if (!ok) return;
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
                    } catch(err) { toast.error(err.message); }
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
                  const lastInvDate = filteredInvoices.filter(x => x.customer_name === c.name).map(x => x.invoice_date).sort().reverse()[0];
                  const daysSince = lastInvDate ? Math.floor((new Date() - new Date(lastInvDate)) / 86400000) : 999;
                  const followColor = daysSince <= 30 ? '#10b981' : daysSince <= 90 ? '#f59e0b' : daysSince <= 180 ? '#ef4444' : '#94a3b8';
                  const followLabel = daysSince <= 30 ? 'Active' : daysSince <= 90 ? daysSince + 'd ago' : daysSince <= 365 ? daysSince + 'd ago' : '1yr+';
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
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: followColor }} />
                      <div className="text-sm font-bold flex-1 min-w-0 truncate" style={{ direction: lang === 'ar' ? 'rtl' : 'ltr' }}>{lang === 'en' && enName ? enName : c.name}</div>
                    </div>
                    {lang === 'ar' && enName && <div className="text-[10px] text-blue-500 ml-3.5">{enName}</div>}
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-[9px] text-slate-400">{c.count} invoices</span>
                      <span className="text-[9px] font-semibold ml-auto" style={{ color: followColor }}>{followLabel}</span>
                    </div>
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
                          } catch (err) { toast.error(err.message); }
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
                <button onClick={() => setTreasurySort(treasurySort === 'newest' ? 'oldest' : 'newest')}
                  className="px-2 py-1 rounded-lg border border-slate-200 text-xs font-semibold hover:bg-slate-100">
                  {treasurySort === 'newest' ? '↓ Newest' : '↑ Oldest'}
                </button>
                <button onClick={() => setShowAccountantReview(true)}
                  className="px-3 py-1.5 bg-gradient-to-br from-indigo-500 to-blue-600 text-white rounded-lg text-xs font-extrabold hover:from-indigo-600 hover:to-blue-700 shadow"
                  title="Run AI accounting review / تشغيل مراجعة المحاسب الذكي">
                  🤖 AI Review
                </button>
                <button onClick={() => { setShowAddTreasury(true); setFormData({ date: today() }); }}
                  className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-semibold hover:bg-blue-600">
                  + New Transaction
                </button>
                <button onClick={() => {
                  const ft = treasury.filter(t => inRange(t.transaction_date, mode, df, dt));
                  const rows = ft.map(t => ({
                    Date: t.transaction_date, Order: t.order_number || '',
                    Description: t.description || '', 'Cash In': t.cash_in || '',
                    'Cash Out': t.cash_out || '', Category: t.expense_category || '',
                  }));
                  const ws = XLSX.utils.json_to_sheet(rows);
                  ws['!cols'] = [{wch:12},{wch:12},{wch:40},{wch:14},{wch:14},{wch:16}];
                  const wb = XLSX.utils.book_new();
                  XLSX.utils.book_append_sheet(wb, ws, 'Treasury');
                  XLSX.writeFile(wb, `Treasury-Export-${new Date().toISOString().substring(0,10)}.xlsx`);
                }} className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-xs font-semibold hover:bg-slate-200">
                  📥 Export
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
                        {/* Transaction list — shown directly */}
                        <div className="text-xs font-bold text-slate-600 mb-1 mt-2">{searchResults.length} Transactions</div>
                          <div className="overflow-auto max-h-[350px] rounded-lg border border-slate-200">
                            <table className="w-full border-collapse text-xs">
                              <thead className="sticky top-0"><tr className="bg-slate-50">
                                <th className="px-2 py-1.5 text-left">Date</th>
                                <th className="px-2 py-1.5" style={{direction:'rtl'}}>Description</th>
                                <th className="px-2 py-1.5 text-xs">Category</th>
                                <th className="px-2 py-1.5 text-right">In</th>
                                <th className="px-2 py-1.5 text-right">Out</th>
                                <th className="px-2 py-1.5"></th>
                              </tr></thead>
                              <tbody>
                                {searchResults.sort((a,b) => (b.transaction_date||'').localeCompare(a.transaction_date||'')).slice(0, 300).map(t => (
                                  <tr key={t.id} className="border-b border-slate-50">
                                    <td className="px-2 py-1 text-[10px]">{t.transaction_date}</td>
                                    <td className="px-2 py-1 text-[10px]" style={{direction:'rtl'}}>
                                      {t.description}
                                      {t.linked_invoice_id && (() => {
                                        const li = invoices.find(i => i.id === t.linked_invoice_id);
                                        return li ? <div className="text-[9px] text-emerald-600">✅ → {li.customer_name || li.order_number}</div> : null;
                                      })()}
                                    </td>
                                    <td className="px-2 py-1 text-[10px] text-amber-600">{EXPENSE_CATS[t.category] || t.category || ''}{t.subcategory ? ' / ' + t.subcategory : ''}</td>
                                    <td className="px-2 py-1 text-[10px] text-right text-emerald-600 font-semibold">{Number(t.cash_in) > 0 ? fE(t.cash_in) : ''}</td>
                                    <td className="px-2 py-1 text-[10px] text-right text-red-500 font-semibold">{Number(t.cash_out) > 0 ? fE(t.cash_out) : ''}</td>
                                    <td className="px-2 py-1 text-[10px]">
                                      <div className="flex gap-1 items-center">
                                        <button onClick={() => setInspectedTreasury(t)}
                                          className="text-slate-500 hover:text-indigo-600" title="Inspect / فحص">ⓘ</button>
                                        <button onClick={() => setEditTreasuryModal({...t})}
                                          className="text-blue-500 hover:text-blue-700" title="Edit">✏️</button>
                                        <button onClick={() => setEditTreasuryModal({...t, confirmDelete: true})}
                                          className="text-red-400 hover:text-red-600" title="Delete">🗑</button>
                                        {Number(t.cash_in) > 0 && !t.linked_invoice_id && (
                                          <button onClick={() => { setLinkingTreasuryTxn(t); setTreasuryInvSearch(''); }}
                                            className="text-blue-500 font-semibold">🔗</button>
                                        )}
                                        {t.linked_invoice_id && (
                                          <button onClick={() => unlinkTreasury(t.id)}
                                            className="text-red-400 text-[9px] underline">unlink</button>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
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
                <div className="text-lg font-extrabold text-emerald-600">{fE(totalCashIn)}</div>
              </div>
              <div onClick={() => setTreasuryDrill('out')} className="bg-white rounded-lg p-3 cursor-pointer hover:shadow-md" style={{ borderLeftWidth: 3, borderLeftColor: '#ef4444' }}>
                <div className="text-[10px] text-slate-500">Cash Out / منصرف</div>
                <div className="text-lg font-extrabold text-red-500">{fE(totalCashOut)}</div>
              </div>
              <div onClick={() => setTreasuryDrill('net')} className="bg-white rounded-lg p-3 cursor-pointer hover:shadow-md" style={{ borderLeftWidth: 3, borderLeftColor: totalCashIn > totalCashOut ? '#10b981' : '#ef4444' }}>
                <div className="text-[10px] text-slate-500">Net / صافي</div>
                <div className={'text-lg font-extrabold ' + (totalCashIn >= totalCashOut ? 'text-emerald-600' : 'text-red-500')}>{fE(totalCashIn - totalCashOut)}</div>
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
                      <th className="px-2 py-2 text-xs"></th>
                    </tr></thead>
                    <tbody>
                      {searchResults.slice(0, 200).map(txn => (
                        <tr key={txn.id} className="border-b border-slate-50">
                          <td className="px-2 py-1.5 text-xs">{txn.transaction_date}</td>
                          <td className="px-2 py-1.5 text-xs font-semibold text-center">
                            {txn.order_number ? (() => {
                              const matchInv = invoices.find(i => i.order_number === txn.order_number);
                              if (matchInv) {
                                return (
                                  <button onClick={() => openInvoiceFromTreasury(matchInv)}
                                    className="text-blue-600 hover:text-blue-800 font-extrabold underline-offset-2 hover:underline"
                                    title="Open invoice / فتح الفاتورة">
                                    {txn.order_number} ↗
                                  </button>
                                );
                              }
                              return <span className="text-slate-500">{txn.order_number}</span>;
                            })() : ''}
                          </td>
                          <td className="px-2 py-1.5 text-xs" style={{ direction: lang === 'ar' ? 'rtl' : 'ltr' }}>
                            {tx(txn.description, txn.description_en)}
                            {txn.linked_invoice_id && (() => {
                              const linkedInv = invoices.find(i => i.id === txn.linked_invoice_id);
                              return linkedInv ? (
                                <div className="text-[9px] text-emerald-600 mt-0.5">
                                  ✅ → {linkedInv.customer_name || linkedInv.order_number}
                                  <button onClick={() => unlinkTreasury(txn.id)} className="text-red-400 underline ml-1">unlink</button>
                                </div>
                              ) : null;
                            })()}
                          </td>
                          <td className="px-2 py-1.5 text-xs text-right font-semibold">
                            {Number(txn.bank_in || 0) > 0 && <div className="text-indigo-700 font-bold">🏦 {fE(txn.bank_in)}</div>}
                            {Number(txn.cash_in) > 0 && <span className="text-emerald-600">{fE(txn.cash_in)}</span>}
                          </td>
                          <td className="px-2 py-1.5 text-xs text-right font-semibold">
                            {Number(txn.bank_out || 0) > 0 && <div className="text-indigo-700 font-bold">🏦 {fE(txn.bank_out)}</div>}
                            {Number(txn.cash_out) > 0 && <span className="text-red-500">{fE(txn.cash_out)}</span>}
                          </td>
                          <td className="px-2 py-1.5 text-xs">
                            <div className="flex gap-1 items-center">
                              <button onClick={() => setInspectedTreasury(txn)}
                                className="text-slate-500 hover:text-indigo-600" title="Inspect / فحص">ⓘ</button>
                              <button onClick={() => setEditTreasuryModal({...txn})}
                                className="text-blue-500 hover:text-blue-700" title="Edit">✏️</button>
                              <button onClick={() => setEditTreasuryModal({...txn, confirmDelete: true})}
                                className="text-red-400 hover:text-red-600" title="Delete">🗑</button>
                              {(Number(txn.cash_in) > 0 || Number(txn.bank_in || 0) > 0) && !txn.linked_invoice_id && (
                                <button onClick={() => { setLinkingTreasuryTxn(txn); setTreasuryInvSearch(''); }}
                                  className="text-[10px] text-blue-500 font-semibold">🔗</button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>);
            })()}
            {/* ── TRANSACTIONS — infinite scroll ── */}
            <div className="bg-white rounded-xl p-4 mb-3">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-sm font-bold">Transactions / المعاملات ({filteredTreasury.length})</h3>
                <button onClick={() => setTreasurySort(treasurySort === 'newest' ? 'oldest' : 'newest')}
                  className="text-[10px] text-blue-600 font-semibold hover:underline">
                  {treasurySort === 'newest' ? '↓ Newest First' : '↑ Oldest First'}
                </button>
              </div>
              <div className="overflow-auto rounded-lg border border-slate-200"
                style={{ maxHeight: '70vh' }}
                onScroll={e => {
                  const el = e.target;
                  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100 && treasuryVisible < filteredTreasury.length) {
                    setTreasuryVisible(v => Math.min(v + 50, filteredTreasury.length));
                  }
                }}>
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 z-10"><tr className="bg-slate-50">
                    <th className="px-2 py-2 text-xs text-left">Date</th>
                    <th className="px-2 py-2 text-xs">Order</th>
                    <th className="px-2 py-2 text-xs" style={{direction:'rtl'}}>Description</th>
                    <th className="px-2 py-2 text-xs text-right">In</th>
                    <th className="px-2 py-2 text-xs text-right">Out</th>
                    <th className="px-2 py-2 text-xs text-right">Balance</th>
                    <th className="px-2 py-2 text-xs"></th>
                  </tr></thead>
                  <tbody>
                    {filteredTreasury.slice(0, treasuryVisible).map(txn => {
                      // isBankRow = any row that holds money in bank_in/bank_out, OR is a placeholder waiting, OR has been matched.
                      const isBankPlaceholder = txn.is_bank_placeholder === true;
                      const isBankMatched = !isBankPlaceholder && txn.matched_bank_txn_id;
                      const hasBankAmount = Number(txn.bank_in || 0) > 0 || Number(txn.bank_out || 0) > 0;
                      const isBankRow = isBankPlaceholder || isBankMatched || hasBankAmount;
                      // ORPHAN: row has an order# and carries inflow (cash_in OR bank_in), but no
                      // invoice with that order# exists yet. Amount is tracked but not yet crediting
                      // any invoice. Will auto-link when someone creates the matching invoice.
                      const hasInflow = Number(txn.cash_in || 0) > 0 || Number(txn.bank_in || 0) > 0;
                      const isOrphanWaiting = hasInflow
                        && txn.order_number
                        && !txn.linked_invoice_id
                        && !txn.is_bank_placeholder
                        && !invoices.find(i => String(i.order_number || '') === String(txn.order_number || ''));
                      const rowClass = "border-b border-slate-100 " +
                        (isBankPlaceholder
                          ? "bg-indigo-100 hover:bg-indigo-200 border-l-4 border-l-indigo-600"
                          : isOrphanWaiting
                          ? "bg-amber-50 hover:bg-amber-100 border-l-4 border-l-amber-500"
                          : isBankMatched
                          ? "border-l-4 border-l-emerald-500 hover:bg-emerald-50/50"
                          : isBankRow
                          ? "bg-indigo-50 hover:bg-indigo-100 border-l-4 border-l-indigo-400"
                          : "hover:bg-blue-50/30");
                      // Matched bank rows get a subtle emerald-to-indigo gradient so the success
                      // state is unmistakable at a glance.
                      const rowStyle = isBankMatched
                        ? { background: 'linear-gradient(90deg, #ecfdf5 0%, #eef2ff 100%)' }
                        : undefined;
                      const bankAcc = isBankRow && txn.bank_account_id ? egyptBankAccounts.find(a => a.id === txn.bank_account_id) : null;
                      return (
                      <tr key={txn.id} className={rowClass} style={rowStyle}
                          title={isOrphanWaiting
                            ? "Waiting for invoice #" + txn.order_number + " to be created — amount shown but not yet credited to any invoice"
                            : isBankRow
                            ? "Bank entry — affects invoice collections only, does NOT impact treasury (safe) net / قيد بنكي — يؤثر على تحصيل الفاتورة فقط، لا يؤثر على رصيد الخزنة"
                            : undefined}>
                        <td className="px-2 py-1.5 text-[10px] whitespace-nowrap">{txn.transaction_date}</td>
                        <td className="px-2 py-1.5 text-[10px] font-semibold text-center">
                          {txn.order_number ? (() => {
                            const matchInv = invoices.find(i => i.order_number === txn.order_number);
                            if (matchInv) {
                              return (
                                <button onClick={() => openInvoiceFromTreasury(matchInv)}
                                  className={(isBankRow ? "text-indigo-700 hover:text-indigo-900" : "text-blue-600 hover:text-blue-800") + " font-extrabold underline-offset-2 hover:underline"}
                                  title="Open invoice / فتح الفاتورة">
                                  {txn.order_number} ↗
                                </button>
                              );
                            }
                            // No invoice exists yet — if this row has inflow, offer to create one inline.
                            if (hasInflow) {
                              return (
                                <button
                                  onClick={() => {
                                    // Pre-fill the Add Invoice form with this treasury row's data
                                    const inflowAmt = Number(txn.cash_in || 0) + Number(txn.bank_in || 0);
                                    setFormData({
                                      orderNumber: txn.order_number,
                                      customerName: txn.description ? String(txn.description).split(/[\[\(]/)[0].trim() : '',
                                      amount: inflowAmt,
                                      date: txn.transaction_date || today(),
                                      invoiceItems: inflowAmt > 0 ? [{
                                        inv_desc: txn.description || 'Invoice for order ' + txn.order_number,
                                        inv_qty: 1,
                                        inv_price: inflowAmt,
                                        inv_total: inflowAmt,
                                      }] : [],
                                    });
                                    setShowAddInvoice(true);
                                  }}
                                  className="text-amber-700 hover:text-amber-900 font-extrabold underline-offset-2 hover:underline"
                                  title="No invoice exists for this order. Click to create one — the amount will auto-link.">
                                  {txn.order_number} ⚠️
                                </button>
                              );
                            }
                            return <span className="text-slate-500" title="No matching invoice">{txn.order_number}</span>;
                          })() : ''}
                        </td>
                        <td className="px-2 py-1.5" style={{direction: lang === 'ar' ? 'rtl' : 'ltr'}}>
                          {/* Badges row */}
                          <div className="flex flex-wrap gap-1 items-center mb-1">
                            {isBankPlaceholder && (
                              <span className="inline-block px-2 py-0.5 rounded bg-indigo-700 text-white text-[10px] font-extrabold shadow">🏦 BANK (awaiting)</span>
                            )}
                            {isBankMatched && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-white text-[10px] font-extrabold shadow"
                                    style={{background: 'linear-gradient(135deg, #4f46e5 0%, #10b981 100%)'}}
                                    title="Bank deposit matched + verified against the statement">
                                🏦 BANK ✅ RECEIVED
                              </span>
                            )}
                            {!isBankPlaceholder && !isBankMatched && hasBankAmount && (
                              <span className="inline-block px-2 py-0.5 rounded bg-indigo-500 text-white text-[10px] font-extrabold shadow">🏦 BANK</span>
                            )}
                            {isOrphanWaiting && (
                              <span className="inline-block px-2 py-0.5 rounded bg-amber-500 text-white text-[10px] font-extrabold shadow" title="No invoice exists for this order — amount shown but not yet credited. Will auto-link when the invoice is created.">
                                ⏳ WAITING FOR INVOICE
                              </span>
                            )}
                            {!isBankRow && txn.cash_method === 'vodafone' && (
                              <span className="inline-block px-2 py-0.5 rounded bg-red-600 text-white text-[10px] font-extrabold shadow">📱 Vodafone</span>
                            )}
                            {!isBankRow && txn.cash_method === 'instapay' && (
                              <span className="inline-block px-2 py-0.5 rounded bg-amber-500 text-white text-[10px] font-extrabold shadow">⚡ InstaPay</span>
                            )}
                          </div>
                          {/* Description — primary content, larger font */}
                          <div className="text-[12px] font-semibold text-slate-800 leading-snug">
                            {tx(txn.description, txn.description_en)}
                          </div>
                          {/* Category — own line, below description, smaller muted */}
                          {(txn.category || txn.subcategory) && (
                            <div className="text-[10px] text-amber-700 mt-0.5">
                              <span className="font-semibold">{txCat(txn.category) || 'Uncategorized'}</span>
                              {txn.subcategory && <span className="text-amber-600"> › {txn.subcategory}</span>}
                            </div>
                          )}
                          {isBankRow && txn.bank_nonorder_category && (
                            <div className="text-[10px] text-indigo-700 font-bold mt-0.5">[{txn.bank_nonorder_category}]</div>
                          )}
                          {bankAcc && (
                            <div className="text-[10px] text-indigo-900 font-bold mt-0.5">→ {bankAcc.bank_name}{bankAcc.account_name ? ' / ' + bankAcc.account_name : ''}</div>
                          )}
                          {txn.linked_invoice_id && (() => {
                            const li = invoices.find(i => i.id === txn.linked_invoice_id);
                            return li ? <div className="text-[10px] text-emerald-700 font-semibold mt-0.5">✅ → {li.customer_name || li.order_number}</div> : null;
                          })()}
                          {isBankRow && (
                            <div className="text-[10px] text-indigo-700 italic mt-0.5">Does not affect safe balance / لا يؤثر على رصيد الخزنة</div>
                          )}
                          {isOrphanWaiting && (
                            <div className="text-[10px] text-amber-700 italic mt-0.5 font-semibold">
                              ⏳ Not yet credited — invoice #{txn.order_number} does not exist. Click the order# to create it.
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-[10px] text-right font-semibold">
                          {/* Awaiting bank placeholder — show expected amount + explicit "won't affect safe" caption */}
                          {isBankPlaceholder && txn.expected_direction === 'in' && (
                            <div>
                              <div className="text-indigo-500 italic font-bold">~{fE(txn.expected_amount)}</div>
                              <div className="text-[8px] text-indigo-400 italic normal-case">won't affect safe / لا يؤثر على الخزنة</div>
                            </div>
                          )}
                          {/* Matched / confirmed bank_in — emerald-tinted indigo + check mark */}
                          {Number(txn.bank_in || 0) > 0 && (
                            <div className="inline-block px-1.5 py-0.5 rounded" style={{background: '#ecfdf5', border: '1.5px solid #10b981'}}>
                              <div className="text-indigo-700 font-extrabold">{fE(txn.bank_in)} <span className="text-emerald-600">✅</span></div>
                              <div className="text-[8px] text-emerald-700 italic">matched — collected only</div>
                            </div>
                          )}
                          {/* Safe cash in — emerald */}
                          {Number(txn.cash_in) > 0 && <span className="text-emerald-600">{fE(txn.cash_in)}</span>}
                          {Number(txn.usd_in) > 0 && <div className="text-emerald-600">${Number(txn.usd_in).toLocaleString()} <span className="text-[8px] text-amber-600">USD</span></div>}
                          {Number(txn.foreign_amount || 0) > 0 && txn.foreign_direction === 'in' && <div className="text-emerald-600">{Number(txn.foreign_amount).toLocaleString()} <span className="text-[8px] text-amber-600">{txn.foreign_currency}</span></div>}
                        </td>
                        <td className="px-2 py-1.5 text-[10px] text-right font-semibold">
                          {isBankPlaceholder && txn.expected_direction === 'out' && (
                            <div>
                              <div className="text-indigo-500 italic font-bold">~{fE(txn.expected_amount)}</div>
                              <div className="text-[8px] text-indigo-400 italic normal-case">won't affect safe / لا يؤثر على الخزنة</div>
                            </div>
                          )}
                          {Number(txn.bank_out || 0) > 0 && (
                            <div className="inline-block px-1.5 py-0.5 rounded" style={{background: '#fef2f2', border: '1.5px solid #ef4444'}}>
                              <div className="text-indigo-700 font-extrabold">{fE(txn.bank_out)} <span className="text-red-500">✅</span></div>
                              <div className="text-[8px] text-red-600 italic">matched — bank ledger only</div>
                            </div>
                          )}
                          {Number(txn.cash_out) > 0 && <span className="text-red-500">{fE(txn.cash_out)}</span>}
                          {Number(txn.usd_out) > 0 && <div className="text-red-500">${Number(txn.usd_out).toLocaleString()} <span className="text-[8px] text-amber-600">USD</span></div>}
                          {Number(txn.foreign_amount || 0) > 0 && txn.foreign_direction === 'out' && <div className="text-red-500">{Number(txn.foreign_amount).toLocaleString()} <span className="text-[8px] text-amber-600">{txn.foreign_currency}</span></div>}
                        </td>
                        <td className="px-2 py-1.5 text-[10px] text-right font-bold whitespace-nowrap" style={{color: (treasuryBalanceMap[txn.id] || 0) >= 0 ? '#059669' : '#dc2626'}}>
                          {/* Bank rows don't contribute to safe running balance — show dash */}
                          {isBankRow ? <span className="text-indigo-400" title="Bank row — not part of safe balance">—</span> : fE(treasuryBalanceMap[txn.id] || 0)}
                        </td>
                        <td className="px-2 py-1.5 text-[10px] whitespace-nowrap">
                          <div className="flex gap-1 items-center">
                            <button onClick={() => setInspectedTreasury(txn)}
                              className="text-slate-500 hover:text-indigo-600" title="Inspect / فحص">ⓘ</button>
                            <button onClick={() => setEditTreasuryModal({...txn})}
                              className="text-blue-500 hover:text-blue-700" title="Edit">✏️</button>
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
                {treasuryVisible < filteredTreasury.length && (
                  <div className="py-3 text-center">
                    <button onClick={() => setTreasuryVisible(v => Math.min(v + 50, filteredTreasury.length))}
                      className="text-blue-500 text-xs font-semibold hover:underline">
                      Load more ({treasuryVisible} of {filteredTreasury.length}) ↓
                    </button>
                  </div>
                )}
                {treasuryVisible >= filteredTreasury.length && filteredTreasury.length > 50 && (
                  <div className="py-2 text-center text-[10px] text-slate-400">All {filteredTreasury.length} transactions loaded ✓</div>
                )}
              </div>
            </div>
            {incomeBuckets.length > 0 && (
              <div className="bg-white rounded-xl p-4 mb-3">
                <h3 className="text-sm font-bold mb-2 text-emerald-700">Income Buckets / تصنيف الإيرادات</h3>
                {incomeBuckets.map((e, i) => (
                  <div key={e.cat}>
                    <div onClick={() => setExpenseDrill('in:' + e.cat)}
                      className="flex justify-between py-1 border-b border-slate-50 text-xs cursor-pointer hover:bg-emerald-50">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                        <span>{e.eng}{e.eng !== e.cat && <span className="text-slate-400 text-[10px] ml-1">({e.cat})</span>}</span>
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
                      <span>{e.eng}{e.eng !== e.cat && <span className="text-slate-400 text-[10px] ml-1">({e.cat})</span>}</span>
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
        {tab === 'checks' && (() => {
          const todayStr = new Date().toISOString().substring(0, 10);
          const thisMonth = todayStr.substring(0, 7);
          const tomorrowStr = new Date(Date.now() + 86400000).toISOString().substring(0, 10);
          const dueThisMonth = pendingChecks.filter(c => (c.due_date || c.check_date || '').substring(0, 7) === thisMonth);
          const overdue = pendingChecks.filter(c => (c.due_date || c.check_date || '') < todayStr && (c.due_date || c.check_date));
          const upcoming = pendingChecks.filter(c => !overdue.includes(c));
          const totalPending = pendingChecks.reduce((a, c) => a + Number(c.amount || 0), 0);
          const dueThisMonthTotal = dueThisMonth.reduce((a, c) => a + Number(c.amount || 0), 0);
          const overdueTotal = overdue.reduce((a, c) => a + Number(c.amount || 0), 0);
          return (
          <div>
            <div className="flex justify-between flex-wrap gap-2 mb-3">
              <h2 className="text-xl font-extrabold">Checks / شيكات</h2>
              <button onClick={() => setFormData({...formData, showAddCheck: true})}
                className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-semibold hover:bg-blue-600">
                + New Check / شيك جديد
              </button>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-4 gap-3 mb-3">
              <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3, borderLeftColor:'#f59e0b'}}>
                <div className="text-[10px] text-slate-500">Total Pending / معلقة</div>
                <div className="text-lg font-extrabold text-amber-600">{fE(totalPending)}</div>
                <div className="text-[9px] text-slate-400">{pendingChecks.length} checks</div>
              </div>
              <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3, borderLeftColor:'#3b82f6'}}>
                <div className="text-[10px] text-slate-500">Expected This Month</div>
                <div className="text-lg font-extrabold text-blue-600">{fE(dueThisMonthTotal)}</div>
                <div className="text-[9px] text-slate-400">{dueThisMonth.length} checks</div>
              </div>
              <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3, borderLeftColor: overdueTotal > 0 ? '#ef4444' : '#10b981'}}>
                <div className="text-[10px] text-slate-500">{overdueTotal > 0 ? 'Overdue / متأخرة' : 'None Overdue'}</div>
                <div className={'text-lg font-extrabold ' + (overdueTotal > 0 ? 'text-red-500' : 'text-emerald-600')}>{overdueTotal > 0 ? fE(overdueTotal) : '✓'}</div>
                <div className="text-[9px] text-slate-400">{overdue.length} checks</div>
              </div>
              <div className="bg-white rounded-lg p-3" style={{borderLeftWidth:3, borderLeftColor:'#10b981'}}>
                <div className="text-[10px] text-slate-500">Collected / محصّلة</div>
                <div className="text-lg font-extrabold text-emerald-600">{fE(collectedChecks.reduce((a,c) => a + Number(c.amount||0), 0))}</div>
                <div className="text-[9px] text-slate-400">{collectedChecks.length} checks</div>
              </div>
            </div>

            {/* Add Check Form */}
            {formData.showAddCheck && (
              <div className="bg-blue-50 rounded-xl p-4 mb-3 border border-blue-200">
                <h4 className="text-xs font-bold text-blue-800 mb-3">New Post-dated Check / شيك آجل جديد</h4>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div className="col-span-2">
                    <label className="text-[10px] font-bold text-slate-500">Customer / العميل</label>
                    <input value={formData.chkCustomer || ''} onChange={e => setFormData({...formData, chkCustomer: e.target.value})}
                      list="chk-custs" className="w-full px-3 py-2 rounded-lg border text-sm" style={{direction:'rtl'}} />
                    <datalist id="chk-custs">{customers.map(c => <option key={c.id} value={c.name} />)}</datalist>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500">Amount / المبلغ</label>
                    <input type="number" value={formData.chkAmount || ''} onChange={e => setFormData({...formData, chkAmount: e.target.value})}
                      className="w-full px-3 py-2 rounded-lg border text-sm" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500">Due Date / تاريخ الاستحقاق</label>
                    <DatePickerSelect value={formData.chkDueDate || today()} onChange={v => setFormData({...formData, chkDueDate: v})} />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500">Check # / رقم الشيك</label>
                    <input value={formData.chkNumber || ''} onChange={e => setFormData({...formData, chkNumber: e.target.value})}
                      className="w-full px-3 py-2 rounded-lg border text-sm" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500">Order # / رقم الأمر</label>
                    <input value={formData.chkOrder || ''} onChange={e => setFormData({...formData, chkOrder: e.target.value})}
                      list="chk-orders" className="w-full px-3 py-2 rounded-lg border text-sm" />
                    <datalist id="chk-orders">{invoices.slice(0,50).map(i => <option key={i.id} value={i.order_number} />)}</datalist>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500">Bank / البنك</label>
                    <input value={formData.chkBank || ''} onChange={e => setFormData({...formData, chkBank: e.target.value})}
                      className="w-full px-3 py-2 rounded-lg border text-sm" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500">Notes / ملاحظات</label>
                    <input value={formData.chkNotes || ''} onChange={e => setFormData({...formData, chkNotes: e.target.value})}
                      className="w-full px-3 py-2 rounded-lg border text-sm" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={async () => {
                    if (!formData.chkCustomer || !formData.chkAmount) { alert('Customer and amount required'); return; }
                    try {
                      const orderNum = formData.chkOrder || '';
                      const matchInv = orderNum ? invoices.find(i => i.order_number === orderNum) : null;
                      await dbInsert('checks', {
                        customer_name: formData.chkCustomer,
                        order_number: orderNum,
                        invoice_id: matchInv?.id || null,
                        amount: Number(formData.chkAmount),
                        check_date: formData.chkDueDate || today(),
                        due_date: formData.chkDueDate || today(),
                        check_number: formData.chkNumber || '',
                        bank_name: formData.chkBank || '',
                        status: 'pending',
                        notes: formData.chkNotes || '',
                      }, user?.id);
                      setFormData({...formData, showAddCheck: false, chkCustomer:'', chkAmount:'', chkDueDate:'', chkNumber:'', chkOrder:'', chkBank:'', chkNotes:''});
                      await loadAllData();
                    } catch(err) { toast.error(err.message); }
                  }} className="px-4 py-2 bg-blue-500 text-white rounded-lg text-xs font-bold">Add Check / إضافة ✓</button>
                  <button onClick={() => setFormData({...formData, showAddCheck: false})}
                    className="px-4 py-2 border border-slate-200 rounded-lg text-xs">Cancel</button>
                </div>
              </div>
            )}

            {/* Tab toggle + Sort */}
            <div className="flex justify-between items-center flex-wrap gap-2 mb-3">
              <div className="flex gap-2">
                <button onClick={() => setCheckView('pending')}
                  className={`px-4 py-2 rounded-lg font-semibold text-xs transition ${checkView === 'pending' ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
                  Pending / معلقة ({pendingChecks.length})
                </button>
                <button onClick={() => setCheckView('done')}
                  className={`px-4 py-2 rounded-lg font-semibold text-xs transition ${checkView === 'done' ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
                  Collected / محصّلة ({collectedChecks.length})
                </button>
              </div>
              <div className="flex gap-1">
                {[['date', '📅 Date'], ['customer', '👤 Customer'], ['order', '📦 Order']].map(([v, l]) => (
                  <button key={v} onClick={() => setCheckSort(v)}
                    className={`px-2.5 py-1 rounded text-[10px] font-semibold transition ${checkSort === v ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500'}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {/* Grouped checks — by month (date sort) or by customer */}
            {(() => {
              const list = checkView === 'pending' ? pendingChecks : collectedChecks;
              // Sort within groups
              const dateSorter = (a, b) => {
                const ad = checkView === 'done' ? (a.collection_date || '') : (a.due_date || a.check_date || '');
                const bd = checkView === 'done' ? (b.collection_date || '') : (b.due_date || b.check_date || '');
                return checkView === 'done' ? bd.localeCompare(ad) : ad.localeCompare(bd);
              };
              const sorted = [...list].sort(dateSorter);

              // Group key depends on sort mode
              const groups = {};
              sorted.forEach(c => {
                let key;
                if (checkSort === 'customer') {
                  key = c.customer_name || 'Unknown';
                } else if (checkSort === 'order') {
                  key = c.order_number || 'No Order #';
                } else {
                  const d = checkView === 'done' ? (c.collection_date || '') : (c.due_date || c.check_date || '');
                  key = d.substring(0, 7) || 'Unknown';
                }
                if (!groups[key]) groups[key] = [];
                groups[key].push(c);
              });

              let groupKeys = Object.keys(groups);
              if (checkSort === 'customer' || checkSort === 'order') {
                groupKeys.sort((a, b) => a.localeCompare(b));
              } else {
                groupKeys.sort((a, b) => checkView === 'done' ? b.localeCompare(a) : a.localeCompare(b));
                if (checkView === 'pending') {
                  const overdueKeys = groupKeys.filter(m => m < todayStr.substring(0, 7));
                  const futureKeys = groupKeys.filter(m => m >= todayStr.substring(0, 7));
                  groupKeys = [...overdueKeys, ...futureKeys];
                }
              }

              return groupKeys.map(gKey => {
                const items = groups[gKey];
                const groupTotal = items.reduce((a, c) => a + Number(c.amount || 0), 0);
                let groupLabel, isOverdueGroup = false;
                if (checkSort === 'customer') {
                  groupLabel = '👤 ' + gKey;
                } else if (checkSort === 'order') {
                  groupLabel = '📦 Order #' + gKey;
                } else {
                  groupLabel = gKey === 'Unknown' ? 'No Date' : new Date(gKey + '-01').toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
                  isOverdueGroup = checkView === 'pending' && gKey < todayStr.substring(0, 7);
                }
                return (
                  <div key={gKey} className="mb-3">
                    <div className={'flex justify-between items-center px-3 py-2 rounded-t-lg text-xs font-bold ' + (isOverdueGroup ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-700')}>
                      <span>{isOverdueGroup && '⚠️ '}{groupLabel}</span>
                      <span>{items.length} checks — {fE(groupTotal)}</span>
                    </div>
                    <div className="overflow-auto border border-t-0 border-slate-200 rounded-b-lg">
                      <table className="w-full border-collapse">
                        <thead><tr className="bg-slate-50/50">
                          <th className="px-2 py-1.5 text-[10px] text-left">Status</th>
                          <th className="px-2 py-1.5 text-[10px]" style={{direction:'rtl'}}>Customer</th>
                          <th className="px-2 py-1.5 text-[10px]">Order #</th>
                          <th className="px-2 py-1.5 text-[10px] text-right">Amount</th>
                          <th className="px-2 py-1.5 text-[10px]">{checkView === 'done' ? 'Due → Collected' : 'Due Date'}</th>
                          <th className="px-2 py-1.5 text-[10px]">Check #</th>
                          <th className="px-2 py-1.5 text-[10px]">Actions</th>
                        </tr></thead>
                        <tbody>
                          {items.map(c => {
                            const dueStr = c.due_date || c.check_date || '';
                            const isOD = checkView === 'pending' && dueStr && dueStr < todayStr;
                            const isDueSoon = checkView === 'pending' && dueStr === tomorrowStr;
                            const isDueThisMonth = checkView === 'pending' && dueStr.substring(0,7) === thisMonth && !isOD && !isDueSoon;
                            return (
                            <tr key={c.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                              <td className="px-2 py-1.5">
                                {checkView === 'done' ? (
                                  <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-[8px] font-bold">✓</span>
                                ) : isOD ? (
                                  <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-[8px] font-bold">OVERDUE</span>
                                ) : isDueSoon ? (
                                  <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-[8px] font-bold">TOMORROW</span>
                                ) : isDueThisMonth ? (
                                  <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-[8px] font-bold">THIS MONTH</span>
                                ) : (
                                  <span className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full text-[8px] font-bold">PENDING</span>
                                )}
                              </td>
                              <td className="px-2 py-1.5 text-xs font-semibold" style={{direction: lang==='ar'?'rtl':'ltr'}}>
                                {tx(c.customer_name, c.customer_name_en)}
                                {c.bank_name && <div className="text-[8px] text-slate-400">{c.bank_name}</div>}
                              </td>
                              <td className="px-2 py-1.5 text-xs font-bold text-blue-600">{c.order_number || '—'}</td>
                              <td className="px-2 py-1.5 text-xs text-right font-bold">{fE(c.amount)}</td>
                              <td className="px-2 py-1.5 text-[10px]">
                                {checkView === 'done' ? (
                                  <span>{dueStr} → <span className="text-emerald-600 font-semibold">{c.collection_date}</span></span>
                                ) : dueStr}
                              </td>
                              <td className="px-2 py-1.5 text-[10px] text-slate-500">{c.check_number || '—'}</td>
                              <td className="px-2 py-1.5">
                                {checkView === 'pending' ? (
                                  <div className="flex gap-1">
                                    <button onClick={() => { setReconcileCheck(c); setReconcileDate(today()); }}
                                      className="px-2 py-0.5 bg-emerald-500 text-white rounded text-[9px] font-semibold hover:bg-emerald-600">✓ Collect</button>
                                    {(userProfile?.role === 'super_admin' || (c.created_by === (userProfile?.id || user?.id) && (Date.now() - new Date(c.created_at || 0).getTime()) < 86400000)) && (
                                      <button onClick={async () => {
                                        const ok = await toast.confirm({ title: 'Delete Check', message: 'Delete this check permanently?', confirmText: 'Delete', danger: true });
                                        if (!ok) return;
                                        try { await dbDelete('checks', c.id, user?.id); await loadAllData(); } catch(err) { alert(err.message); }
                                      }} className="px-1.5 py-0.5 bg-red-50 text-red-500 rounded text-[9px] border border-red-200">🗑</button>
                                    )}
                                  </div>
                                ) : (
                                  <div className="flex gap-1 items-center">
                                    <span className="text-emerald-500 text-[10px]">✓</span>
                                    {c.linked_treasury_id && (
                                      <button onClick={() => {
                                        const linkedTxn = treasury.find(t => t.id === c.linked_treasury_id);
                                        if (linkedTxn) setInspectedTreasury(linkedTxn);
                                      }}
                                        className="px-1.5 py-0.5 rounded border border-indigo-300 text-indigo-600 text-[9px] hover:bg-indigo-50" title="Inspect treasury entry / فحص قيد الخزنة">ⓘ</button>
                                    )}
                                  </div>
                                )}
                              </td>
                            </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              });
            })()}
          </div>
          );
        })()}

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
        {tab === 'warehouse' && (() => {
          const whYears = [...new Set(warehouse.map(w => (w.expense_date || '').substring(0, 4)).filter(y => y.length === 4))].sort().reverse();
          return (
          <div>
            <div className="flex justify-between flex-wrap gap-2 mb-3">
              <div>
                <h2 className="text-xl font-extrabold">Warehouse / عهدة المخزن</h2>
                <span className="text-[10px] text-slate-400">{warehouse.length} total records · {whYears[whYears.length-1] || '?'}–{whYears[0] || '?'}</span>
              </div>
              <div className="flex gap-2 items-center flex-wrap">
                <ModeBar />
                <select value={formData.whYear || ''} onChange={e => setFormData({...formData, whYear: e.target.value})} className="border rounded-lg px-2 py-1 text-xs font-semibold">
                  <option value="">All Years</option>
                  {whYears.map(y => <option key={y} value={y}>{y} ({warehouse.filter(w => (w.expense_date||'').startsWith(y)).length})</option>)}
                </select>
                <button onClick={() => setFormData({...formData, showAddWarehouse: true, whType: 'general'})}
                  className="px-3 py-1.5 bg-purple-500 text-white rounded-lg text-xs font-semibold hover:bg-purple-600">
                  + New Expense / مصروف جديد
                </button>
                <button onClick={() => {
                  const wf = warehouse.filter(w => formData.whYear ? (w.expense_date||'').startsWith(formData.whYear) : inRange(w.expense_date, mode, df, dt));
                  const rows = wf.map(w => ({ Date: w.expense_date, Description: w.description || '', Amount: w.amount || 0, Category: getWarehouseCat(w.description) || '', Subcategory: w.subcategory || '' }));
                  const ws = XLSX.utils.json_to_sheet(rows);
                  ws['!cols'] = [{wch:12},{wch:50},{wch:14},{wch:20},{wch:20}];
                  const wb = XLSX.utils.book_new();
                  XLSX.utils.book_append_sheet(wb, ws, 'Warehouse');
                  XLSX.writeFile(wb, `Warehouse-Export-${formData.whYear || 'All'}-${new Date().toISOString().substring(0,10)}.xlsx`);
                }} className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-xs font-semibold hover:bg-slate-200">
                  📥 Export
                </button>
              </div>
            </div>
            {/* Add Warehouse Expense Modal */}
            {formData.showAddWarehouse && (
              <Modal onClose={() => setFormData({...formData, showAddWarehouse: false})} title="New Warehouse Expense / مصروف مخزن جديد">
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-600">Date / التاريخ</label>
                    <DatePickerSelect value={formData.whExpDate || today()} onChange={v => setFormData({...formData, whExpDate: v})} />
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
                  } catch(err) { toast.error(err.message); }
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
                if (formData.whYear && !(w.expense_date||'').startsWith(formData.whYear)) return false;
                if (!formData.whYear && !inRange(w.expense_date, mode, df, dt)) return false;
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
          );
        })()}

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
                        <DatePickerSelect value={formData.prodDate || today()} onChange={v => setFormData({...formData, prodDate: v})} /></div>
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
                        } catch (err) { toast.error(err.message); }
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
                            } catch (err) { toast.error(err.message); }
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
          <SafeSection label="CRM"><CRMTab toast={toast} customers={customers} invoices={invoices} user={user} userProfile={userProfile} users={teamUsers} onReload={loadAllData} isAdmin={isAdmin} onSelectInvoice={setSelectedInvoice} lang={lang} modulePerms={modulePerms} /></SafeSection>
        )}

        {/* ==========================================
            TICKETS TAB
        ========================================== */}
        {tab === 'tickets' && (
          <SafeSection label="Tickets"><TicketsTab toast={toast} customers={customers} user={user} userProfile={userProfile} users={teamUsers} onReload={loadAllData} lang={lang} isAdmin={isAdmin} modulePerms={modulePerms} openTicketId={openTicketId} onOpenTicketHandled={() => setOpenTicketId(null)} /></SafeSection>
        )}

        {/* ==========================================
            CALENDAR TAB
        ========================================== */}
        {tab === 'calendar' && (
          <SafeSection label="Calendar"><CalendarTab customers={customers} user={user} userProfile={userProfile} users={teamUsers} onReload={loadAllData} /></SafeSection>
        )}

        {/* ==========================================
            CUSTOMS / BROKER TAB
        ========================================== */}
        {tab === 'customs' && (
          <SafeSection label="Customs"><CustomsTab customers={customers} user={user} /></SafeSection>
        )}

        {/* ==========================================
            SHIPPING RATES TAB
        ========================================== */}
        {tab === 'shipping' && (
          <SafeSection label="Shipping"><ShippingRatesTab toast={toast} user={user} userProfile={userProfile} isAdmin={isAdmin} customers={customers} /></SafeSection>
        )}

        {tab === 'bank' && (
          <SafeSection label="Bank"><BankTab user={user} supabase={supabase} /></SafeSection>
        )}

        {tab === 'egyptbank' && (
          <SafeSection label="Egypt Bank"><EgyptBankTab toast={toast} user={user} userProfile={userProfile} isAdmin={isAdmin} invoices={invoices} onReload={loadAllData} /></SafeSection>
        )}

        {tab === 'reports' && (
          <SafeSection label="Reports"><ReportsTab treasury={treasury} invoices={invoices} warehouseExpenses={warehouse} egyptBankTxns={egyptBankTxns} /></SafeSection>
        )}

        {tab === 'quotes' && (
          <SafeSection label="Quotes"><QuotesTab user={user} userProfile={userProfile} isAdmin={isAdmin} /></SafeSection>
        )}

        {/* ==========================================
            DAILY LOG TAB
        ========================================== */}
        {tab === 'dailylog' && (
          <SafeSection label="Daily Log"><DailyLogTab user={user} userProfile={userProfile} users={teamUsers} isAdmin={isAdmin} /></SafeSection>
        )}

        {/* ==========================================
            ADMIN TAB
        ========================================== */}
        {tab === 'admin' && (
          <SafeSection label="Admin"><AdminTab user={user} userProfile={userProfile} users={teamUsers} isAdmin={isAdmin} customers={customers} /></SafeSection>
        )}

        {/* ==========================================
            AI ASSISTANT TAB
        ========================================== */}
        {tab === 'ai' && (
          <SafeSection label="AI Assistant"><AIAssistant user={user} userProfile={userProfile} users={teamUsers} customers={customers} /></SafeSection>
        )}

        {tab === 'comms' && (
          <SafeSection label="Communications"><CommunicationsTab user={user} supabase={supabase} /></SafeSection>
        )}

        {/* ==========================================
            SETTINGS TAB
        ========================================== */}
        {tab === 'settings' && (
          <SafeSection label="Settings"><SettingsTab toast={toast} user={user} users={teamUsers} onReload={loadAllData} isAdmin={isAdmin} userProfile={userProfile} /></SafeSection>
        )}

        {/* ==========================================
            SYSTEM TICKETS TAB
        ========================================== */}
        {tab === 'systemtickets' && (
          <SafeSection label="System Tickets">
          <div>
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-xl font-extrabold">🐛 System Tickets / تذاكر النظام</h2>
              <button onClick={() => setFormData({ showSysTicket: true, sysTitle: '', sysDesc: '', sysPriority: 'medium', sysCategory: 'bug' })}
                className="px-4 py-2 bg-red-500 text-white rounded-lg text-xs font-bold">+ New System Ticket / تذكرة جديدة</button>
            </div>
            <div className="text-xs text-slate-400 mb-3">Report bugs, feature requests, and system issues / الإبلاغ عن الأخطاء وطلبات الميزات</div>

            {formData.showSysTicket && (
              <div className="bg-white rounded-xl p-4 mb-4 border-2 border-red-200">
                <h3 className="text-sm font-bold mb-2">New System Ticket / تذكرة نظام جديدة</h3>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="text-[10px] font-semibold text-slate-500 block mb-1">Category / الفئة</label>
                    <select value={formData.sysCategory || 'bug'} onChange={e => setFormData({...formData, sysCategory: e.target.value})} className="dark-input">
                      <option value="bug">🐛 Bug / خطأ</option>
                      <option value="feature">✨ Feature Request / ميزة</option>
                      <option value="improvement">📈 Improvement / تحسين</option>
                      <option value="question">❓ Question / سؤال</option>
                      <option value="urgent">🚨 Urgent Fix / إصلاح عاجل</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-slate-500 block mb-1">Priority / الأولوية</label>
                    <select value={formData.sysPriority || 'medium'} onChange={e => setFormData({...formData, sysPriority: e.target.value})} className="dark-input">
                      <option value="low">🟢 Low / منخفض</option>
                      <option value="medium">🟡 Medium / متوسط</option>
                      <option value="high">🔴 High / عالي</option>
                      <option value="critical">🚨 Critical / حرج</option>
                    </select>
                  </div>
                </div>
                <input value={formData.sysTitle || ''} onChange={e => setFormData({...formData, sysTitle: e.target.value})}
                  placeholder="Title / العنوان *" className="dark-input mb-3" />
                <textarea value={formData.sysDesc || ''} onChange={e => setFormData({...formData, sysDesc: e.target.value})}
                  placeholder="Description — steps to reproduce, expected vs actual behavior&#10;الوصف — خطوات إعادة الإنتاج، السلوك المتوقع مقابل الفعلي"
                  rows={4} className="dark-input mb-3" />
                <div className="flex gap-2">
                  <button onClick={async () => {
                    if (!formData.sysTitle) { toast.warning('Title is required / العنوان مطلوب'); return; }
                    try {
                      const count = (await supabase.from('system_tickets').select('*', { count: 'exact', head: true })).count || 0;
                      await dbInsert('system_tickets', {
                        ticket_number: 'SYS-' + String(count + 1).padStart(4, '0'),
                        title: sanitize(formData.sysTitle),
                        description: sanitize(formData.sysDesc || ''),
                        category: formData.sysCategory || 'bug',
                        priority: formData.sysPriority || 'medium',
                        status: 'Open',
                        created_by: userProfile?.id || user?.id,
                        assigned_to: null,
                      }, user?.id);
                      toast.success('System ticket created ✓');
                      setFormData({});
                      await loadAllData();
                    } catch(err) { toast.error(err.message); }
                  }} className="px-5 py-2.5 bg-red-500 text-white rounded-lg text-sm font-bold">Submit / إرسال</button>
                  <button onClick={() => setFormData({})} className="px-4 py-2.5 border-2 border-slate-300 rounded-lg text-sm font-bold">Cancel</button>
                </div>
              </div>
            )}

            {(() => {
              const sysTickets = (window.__sysTickets || []);
              // Load system tickets on first render
              if (!window.__sysTicketsLoaded) {
                window.__sysTicketsLoaded = true;
                supabase.from('system_tickets').select('*').order('created_at', { ascending: false }).then(({ data }) => {
                  window.__sysTickets = data || [];
                  setFormData(prev => ({...prev, _sysRefresh: Date.now()}));
                });
              }
              const CATS = { bug: '🐛', feature: '✨', improvement: '📈', question: '❓', urgent: '🚨' };
              const PRIS = { critical: '🚨', high: '🔴', medium: '🟡', low: '🟢' };
              const STATS = { Open: 'bg-blue-100 text-blue-700', 'In Progress': 'bg-amber-100 text-amber-700', Resolved: 'bg-emerald-100 text-emerald-700', Closed: 'bg-slate-100 text-slate-500' };
              return (
                <div className="space-y-2">
                  {sysTickets.length === 0 && <div className="text-center text-slate-400 text-sm py-8">No system tickets yet / لا توجد تذاكر نظام</div>}
                  {sysTickets.map(t => (
                    <div key={t.id} className="bg-white rounded-xl p-4 border border-slate-100">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-mono text-slate-400">{t.ticket_number}</span>
                            <span>{CATS[t.category] || '🐛'}</span>
                            <span>{PRIS[t.priority] || '🟡'}</span>
                            <span className={'px-2 py-0.5 rounded text-[10px] font-bold ' + (STATS[t.status] || STATS.Open)}>{t.status}</span>
                          </div>
                          <div className="text-sm font-bold">{t.title}</div>
                          {t.description && <div className="text-xs text-slate-500 mt-1 line-clamp-2">{t.description}</div>}
                          <div className="text-[10px] text-slate-400 mt-1">
                            {t.created_at ? new Date(t.created_at).toLocaleDateString() : ''} · {getUserName(t.created_by) || 'Unknown'}
                          </div>
                        </div>
                        {isAdmin && t.status !== 'Closed' && (
                          <div className="flex gap-1 flex-shrink-0">
                            {t.status === 'Open' && <button onClick={async () => { await dbUpdate('system_tickets', t.id, { status: 'In Progress' }, user?.id); window.__sysTicketsLoaded = false; setFormData(prev => ({...prev, _r: Date.now()})); }} className="px-2 py-1 bg-amber-500 text-white rounded text-[10px]">Start</button>}
                            {(t.status === 'Open' || t.status === 'In Progress') && <button onClick={async () => { await dbUpdate('system_tickets', t.id, { status: 'Resolved' }, user?.id); window.__sysTicketsLoaded = false; setFormData(prev => ({...prev, _r: Date.now()})); }} className="px-2 py-1 bg-emerald-500 text-white rounded text-[10px]">Resolve</button>}
                            <button onClick={async () => { await dbUpdate('system_tickets', t.id, { status: 'Closed' }, user?.id); window.__sysTicketsLoaded = false; setFormData(prev => ({...prev, _r: Date.now()})); }} className="px-2 py-1 bg-slate-500 text-white rounded text-[10px]">Close</button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
          </SafeSection>
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

      </main>{/* end content */}
      </div>{/* end flex sidebar+content */}

      {/* Quick Add FAB */}
      <div className="fixed bottom-20 right-4 z-40 fab-wrap">
        {showFAB && (
          <div className="absolute bottom-14 right-0 bg-white rounded-xl shadow-2xl border w-52 overflow-hidden mb-2">
            {[
              ['💰 New Invoice', () => { setTab('sales'); setFormData({ date: today() }); setShowAddInvoice(true); }],
              ['🎫 New Ticket', () => setTab('tickets')],
              ['📋 Daily Log', () => setTab('log')],
              ['📢 Announcement', () => setTab('admin')],
              ['🏭 Warehouse Expense', () => { setTab('warehouse'); setFormData({...formData, showAddWarehouse: true, whType: 'general'}); }],
            ].map(([label, action]) => (
              <button key={label} onClick={() => { action(); setShowFAB(false); }} className="w-full text-left px-4 py-2.5 text-xs font-semibold hover:bg-blue-50 border-b border-slate-50 last:border-0 transition">
                {label}
              </button>
            ))}
          </div>
        )}
        <button onClick={() => setShowFAB(!showFAB)}
          className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-lg hover:shadow-xl transition-all flex items-center justify-center text-xl"
          style={{ transform: showFAB ? 'rotate(45deg)' : 'none', transition: 'transform 0.2s' }}>
          +
        </button>
      </div>

      {/* Data Freshness Indicator */}
      {lastLoaded && (
        <div className="fixed bottom-4 left-4 lg:left-[220px] z-30 flex items-center gap-2">
          <button onClick={() => loadAllData()} className="px-2.5 py-1 bg-white/90 border border-slate-200 rounded-lg shadow-sm text-[10px] text-slate-500 hover:bg-slate-50 transition flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
            Synced {Math.floor((Date.now() - lastLoaded.getTime()) / 60000)}m ago
            <span className="text-slate-300">↻</span>
          </button>
        </div>
      )}

      {/* Phone Widget - floating on all tabs */}
      <PhoneWidget user={user} userProfile={userProfile} users={teamUsers} customers={customers} />

      {/* Treasury Inspector Modal — bilingual AR/EN transaction explainer */}
      {inspectedTreasury && (
        <TreasuryInspectorModal
          txn={inspectedTreasury}
          invoices={invoices}
          checks={checks}
          egyptBankTxns={egyptBankTxns}
          treasury={treasury}
          lang={lang}
          onOpenInvoice={(inv) => { setSelectedInvoice(inv); setTab('sales'); }}
          onClose={() => setInspectedTreasury(null)}
        />
      )}

      {/* AI Accountant Review Modal — full reconciliation audit */}
      {showAccountantReview && (
        <AccountingAuditorModal
          treasury={treasury}
          invoices={invoices}
          checks={checks}
          egyptBankTxns={egyptBankTxns}
          warehouse={warehouse}
          customers={customers}
          debts={debts}
          onClose={() => setShowAccountantReview(false)}
        />
      )}

      {/* "Order # not found — create invoice now?" Modal */}
      {pendingTreasuryRecord && (
        <div
          className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm"
          onClick={() => { setPendingTreasuryRecord(null); }}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-xl flex flex-col"
            style={{ maxHeight: 'calc(100vh - 24px)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 rounded-t-2xl bg-amber-600 border-b-4 border-amber-800" style={{ flexShrink: 0 }}>
              <div className="flex justify-between items-start gap-3">
                <div className="flex-1">
                  <div className="text-xl font-extrabold text-white">⚠️ Order #{pendingTreasuryRecord.record.order_number} Not Found</div>
                  <div className="text-lg font-bold text-white mt-1" style={{ direction: 'rtl' }}>
                    رقم الأمر #{pendingTreasuryRecord.record.order_number} غير موجود
                  </div>
                </div>
                <button onClick={() => setPendingTreasuryRecord(null)}
                  className="px-3 py-1.5 rounded-lg bg-white text-slate-900 text-sm font-extrabold hover:bg-slate-100 shadow">✕</button>
              </div>
            </div>

            <div className="p-5 space-y-4" style={{ overflowY: 'auto', flex: '1 1 auto', minHeight: 0 }}>
              {/* Typo suggestions */}
              {pendingTreasuryRecord.suggestions && pendingTreasuryRecord.suggestions.length > 0 && !formData.__creatingInvoice && (
                <div className="bg-blue-100 border-2 border-blue-500 rounded-lg p-3">
                  <div className="text-sm font-extrabold text-blue-900 mb-2">
                    Did you mean one of these? / هل تقصد أحد هذه؟
                  </div>
                  <div className="space-y-1.5">
                    {pendingTreasuryRecord.suggestions.map(inv => (
                      <button
                        key={inv.id}
                        onClick={() => finalizePendingTreasury(inv)}
                        className="w-full text-left px-3 py-2.5 bg-white hover:bg-blue-50 rounded-lg border-2 border-blue-300 hover:border-blue-500 transition"
                      >
                        <div className="flex justify-between items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-base font-extrabold text-slate-900">#{inv.order_number}</div>
                            <div className="text-sm font-semibold text-slate-800" style={{ direction: 'rtl' }}>{inv.customer_name || '—'}</div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-sm font-extrabold text-emerald-700">{fE(inv.total_amount)}</div>
                            <div className="text-xs text-slate-600">Outstanding: {fE(inv.outstanding || 0)}</div>
                          </div>
                        </div>
                        <div className="text-xs text-blue-800 font-bold mt-1">→ Link treasury to this invoice</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Inline create-invoice form */}
              {formData.__creatingInvoice ? (
                <div className="bg-emerald-100 border-2 border-emerald-500 rounded-lg p-4 space-y-3">
                  <div className="text-sm font-extrabold text-emerald-900">
                    Create new invoice #{pendingTreasuryRecord.record.order_number}
                  </div>
                  <div className="text-sm font-bold text-emerald-800" style={{ direction: 'rtl' }}>
                    إنشاء فاتورة جديدة رقم {pendingTreasuryRecord.record.order_number}
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-700">Customer Name / اسم العميل *</label>
                    <input
                      autoFocus
                      value={formData.__newInvCustomer || ''}
                      onChange={e => {
                        const v = e.target.value;
                        setFormData({ ...formData, __newInvCustomer: v, __newInvCustomerId: null });
                      }}
                      placeholder="Type or pick from customers below"
                      className="w-full px-3 py-2 rounded-lg border-2 border-slate-300 text-sm font-semibold"
                      style={{ direction: 'rtl' }}
                    />
                    {formData.__newInvCustomer && formData.__newInvCustomer.length >= 2 && (
                      <div className="mt-1 max-h-[140px] overflow-auto rounded border border-slate-200 bg-white">
                        {customers
                          .filter(c => String(c.name || '').includes(formData.__newInvCustomer))
                          .slice(0, 6)
                          .map(c => (
                            <div key={c.id}
                              onClick={() => setFormData({ ...formData, __newInvCustomer: c.name, __newInvCustomerId: c.id })}
                              className="px-3 py-2 text-sm cursor-pointer hover:bg-emerald-50 border-b border-slate-100">
                              <span className="font-bold text-slate-900" style={{ direction: 'rtl' }}>{c.name}</span>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-700">Invoice Total / إجمالي *</label>
                      <input
                        type="number"
                        value={formData.__newInvTotal ?? pendingTreasuryRecord.amount}
                        onChange={e => setFormData({ ...formData, __newInvTotal: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border-2 border-slate-300 text-sm font-semibold"
                      />
                      <div className="text-[10px] text-slate-600 mt-0.5">
                        Defaulted from payment. Adjust if invoice is larger.
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-700">Invoice Date / تاريخ</label>
                      <input
                        type="date"
                        value={formData.__newInvDate || pendingTreasuryRecord.record.transaction_date || today()}
                        onChange={e => setFormData({ ...formData, __newInvDate: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border-2 border-slate-300 text-sm font-semibold"
                      />
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={async () => {
                        const name = String(formData.__newInvCustomer || '').trim();
                        const totalAmt = Number(formData.__newInvTotal ?? pendingTreasuryRecord.amount);
                        if (!name) { toast.warning('Customer name is required / اسم العميل مطلوب'); return; }
                        if (!(totalAmt > 0)) { toast.warning('Invoice total must be > 0'); return; }
                        const orderNum = pendingTreasuryRecord.record.order_number;
                        const invDate = formData.__newInvDate || pendingTreasuryRecord.record.transaction_date || today();
                        try {
                          const { data: inserted, error } = await supabase.from('invoices').insert({
                            order_number: sanitize(orderNum),
                            customer_name: sanitize(name),
                            customer_id: formData.__newInvCustomerId || null,
                            invoice_date: invDate,
                            total_amount: totalAmt,
                            total_collected: 0,
                            outstanding: totalAmt,
                            source: 'treasury',
                          }).select('id, order_number, customer_name, total_amount, outstanding').single();
                          if (error) throw error;
                          toast.success('Invoice #' + orderNum + ' created ✓');
                          await finalizePendingTreasury(inserted);
                          setFormData(prev => {
                            const next = { ...prev };
                            delete next.__creatingInvoice;
                            delete next.__newInvCustomer;
                            delete next.__newInvCustomerId;
                            delete next.__newInvTotal;
                            delete next.__newInvDate;
                            return next;
                          });
                        } catch (err) {
                          toast.error(err.message || 'Failed to create invoice');
                        }
                      }}
                      className="flex-1 px-4 py-2.5 bg-emerald-700 text-white rounded-lg text-sm font-extrabold hover:bg-emerald-800 shadow"
                    >
                      ✓ Create Invoice + Save Treasury / إنشاء وحفظ
                    </button>
                    <button
                      onClick={() => setFormData(prev => {
                        const next = { ...prev };
                        delete next.__creatingInvoice;
                        delete next.__newInvCustomer;
                        delete next.__newInvCustomerId;
                        delete next.__newInvTotal;
                        delete next.__newInvDate;
                        return next;
                      })}
                      className="px-4 py-2.5 bg-slate-300 text-slate-900 rounded-lg text-sm font-bold hover:bg-slate-400"
                    >
                      ← Back
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="text-sm text-slate-900 font-semibold leading-relaxed">
                    This order doesn't exist in Sales yet. To save this treasury payment, you need to either pick a matching invoice or create a new one.
                  </div>
                  <div className="text-sm text-slate-800 font-semibold leading-relaxed" style={{ direction: 'rtl' }}>
                    هذا الأمر غير موجود في المبيعات. لحفظ هذه الدفعة، إما اختر فاتورة مطابقة أو أنشئ واحدة جديدة.
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={() => setFormData({
                        ...formData,
                        __creatingInvoice: true,
                        __newInvCustomer: formData.desc || '',
                        __newInvCustomerId: null,
                        __newInvTotal: pendingTreasuryRecord.amount,
                        __newInvDate: pendingTreasuryRecord.record.transaction_date || today(),
                      })}
                      className="flex-1 px-4 py-2.5 bg-emerald-700 text-white rounded-lg text-sm font-extrabold hover:bg-emerald-800 shadow"
                    >
                      + Create Invoice Now / إنشاء فاتورة الآن
                    </button>
                    <button
                      onClick={() => setPendingTreasuryRecord(null)}
                      className="px-4 py-2.5 bg-slate-300 text-slate-900 rounded-lg text-sm font-bold hover:bg-slate-400"
                    >
                      Cancel / إلغاء
                    </button>
                  </div>
                  <div className="text-xs text-slate-600 font-medium text-center pt-1">
                    Cancel returns to the treasury form. Your entry is not saved yet.
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
    </ErrorBoundary>
    </ToastProvider>
  );
}
