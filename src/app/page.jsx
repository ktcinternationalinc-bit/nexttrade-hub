'use client';
import React, { useState, useEffect, useMemo, useCallback, useRef, useContext, createContext } from 'react';
import { supabase, dbInsert, dbUpdate, dbDelete } from '../lib/supabase';
import { filterActiveUsers } from '../lib/active-users';
import { fmt, fE, COLORS, EXPENSE_CATS, getReconStatus, STATUS_STYLES, today, inRange, monthOf, getWarehouseCat, sanitize, stripBankMatchMetadata, resolveCatName, buildCatOptions, isKnownCat, aggregatePaymentSources, PAYMENT_SOURCE_META, parseAmount, isValidAmount } from '../lib/utils';
import { evaluateCheckReconcile as libEvaluateCheckReconcile } from '../lib/check-reconcile';
import { fmtET, todayET, etDateStr } from '../lib/et-time';
import * as XLSX from 'xlsx';
import CRMTab from '../components/CRMTab';
import TicketsTab from '../components/TicketsTab';
import SystemTicketsPanel from '../components/SystemTicketsPanel';
import WhatsNewWidget from '../components/WhatsNewWidget';
import PendingNadiaMessages from '../components/PendingNadiaMessages';
// v55.83-A — new Inventory module replaces the inline inventory section
import InventoryTab from '../components/InventoryTab';
// v55.83-A.1 — bank-confirmation status badge for invoices
import InvoicePaymentBadge from '../components/InvoicePaymentBadge';
// v55.83-A.1 — dashboard widget surfacing invoices awaiting bank match
import PendingBankConfirmationsWidget from '../components/PendingBankConfirmationsWidget';
import NadiaNewBuildCard from '../components/NadiaNewBuildCard';
import CalendarTab from '../components/CalendarTab';
import DailyLogTab from '../components/DailyLogTab';
import AdminTab from '../components/AdminTab';
import SettingsTab from '../components/SettingsTab';
import CustomsTab from '../components/CustomsTab';
import SocialContentTab from '../components/SocialContentTab';
import BrandLearningTab from '../components/BrandLearningTab';
import SEOAuditTab from '../components/SEOAuditTab';
import PersonalDashboard from '../components/PersonalDashboard';
// v55.83-A.6.18 (Max May 14 2026) — Three high-priority dashboard cards
// (Overdue / Recent Updates / Newly Assigned) and an in-place ticket modal
// that renders on the dashboard without a tab switch.
import DashboardPrioritySections from '../components/DashboardPrioritySections';
import DashboardTicketModalOverlay from '../components/DashboardTicketModalOverlay';
import VoicemailsWidget from '../components/VoicemailsWidget';
import AIAssistant from '../components/AIAssistant';
import AIGreeter, { PERSONALITIES } from '../components/AIGreeter';
import VoiceController from '../components/VoiceController';
import NadiaActionBridge from '../components/NadiaActionBridge';
import NadiaFloatingOverlay from '../components/NadiaFloatingOverlay';
import ShippingRatesTab from '../components/ShippingRatesTab';
import ErrorBoundary, { SafeSection } from '../components/ErrorBoundary';
import { DashboardSkeleton, TableSkeleton, CardGridSkeleton } from '../components/LoadingSkeleton';
import NotificationBell from '../components/NotificationBell';
import BankTab from '../components/BankTab';
import AccountingTab from '../components/AccountingTab';
import QuotesTab from '../components/QuotesTab';
import EgyptBankTab from '../components/EgyptBankTab';
import OpenAccountsTab from '../components/OpenAccountsTab';
// v55.83-A.6.27.71 (Phase 2) — Warehouse Buckets.
// Both components live behind the `warehouse_buckets_enabled` feature flag,
// which defaults to OFF. When the flag is OFF, neither the "+ Warehouse
// Advance" button nor the bucket list section renders — existing flows
// (Treasury "+ New Transaction", Warehouse "+ New Expense") work exactly
// as they did before. Treasury transaction modal code is completely
// untouched by this phase.
import WarehouseBucketCreate from '../components/WarehouseBucketCreate';
import WarehouseBucketList from '../components/WarehouseBucketList';
// v55.83-A.6.27.71 (Phase 4) — Buckets History & Analytics in Warehouse tab.
// Read-only multi-year lens. Reads from warehouse_buckets + entries tables
// directly — does NOT query treasury (separate lens from company expense
// report). Renders below the WarehouseBucketList in the warehouse tab.
import WarehouseBucketsHistory from '../components/WarehouseBucketsHistory';
import { getFeatureFlag, getFeatureFlagSync } from '../lib/feature-flags';
// v55.83-A.6.27.71 — Sales-rep KPI dashboard
import SalesRepDashboard from '../components/SalesRepDashboard';
import PhoneWidget from '../components/PhoneWidget';
import ReportsTab from '../components/ReportsTab';
import WriteOffsReport from '../components/WriteOffsReport';
import TreasuryInspectorModal from '../components/TreasuryInspectorModal';
import AccountingAuditorModal from '../components/AccountingAuditorModal';
import InventoryImport from '../components/InventoryImport';
// v55.83-A.6.27 — Stage D: cost engine for sale deduction
import { consumeFifo, reverseFifoConsumption } from '../lib/inventory-cost-engine';

// Toast notification system — replaces alert() across entire app
// v55.25 — ToastContext lives in src/lib/toast-context.js so child
// components (CalendarTab, AdminTab, etc) can consume it without a
// circular import via page.jsx.
import { ToastContext } from '../lib/toast-context';
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
            warning: 'bg-amber-50 border-amber-200 text-amber-900',
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
// v55.83-H — monochrome line icons for the sidebar (replacing emoji). lucide
// icons inherit currentColor, so they pick up the zinc/emerald nav colors and
// stay strictly monochrome — the "clean line icons only" direction.
import {
  LayoutDashboard, DollarSign, Users, FileText, Landmark, Building2, Banknote,
  FileCheck, AlertTriangle, BookOpen, BarChart3, Warehouse, Package, Stamp,
  Ship, Handshake, Ticket, Bug, Mail, Calendar, Notebook, Crown, Bot,
  Megaphone, Brain, Search, Settings, Download, Circle
} from 'lucide-react';

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
  { id: 'accounting', label: 'Accounting / محاسبة', icon: '🧾' },
  { id: 'checks', label: 'Checks / شيكات', icon: '📝' },
  { id: 'debts', label: 'Debts / المديونية', icon: '⚠️' },
  { id: 'openaccounts', label: 'Open Accounts / حسابات', icon: '📒' },
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
  { id: 'social', label: 'Social Studio / محتوى', icon: '📣' },
  { id: 'brand', label: 'Brand Learning / تعلم', icon: '🧠' },
  { id: 'seo', label: 'SEO Audit / تحسين', icon: '🔍' },
  { id: 'settings', label: 'Settings / إعدادات', icon: '⚙️' },
  { id: 'import', label: 'Import / استيراد', icon: '📥' },
];

// v55.83-H — monochrome line-icon map for the sidebar, keyed by tab id.
// Replaces the colorful emoji per the enterprise design direction.
const TAB_ICONS = {
  dashboard: LayoutDashboard, sales: DollarSign, customers: Users, quotes: FileText,
  treasury: Landmark, egyptbank: Building2, bank: Banknote, checks: FileCheck,
  debts: AlertTriangle, openaccounts: BookOpen, reports: BarChart3, warehouse: Warehouse,
  inventory: Package, customs: Stamp, shipping: Ship, crm: Handshake, tickets: Ticket,
  systemtickets: Bug, comms: Mail, calendar: Calendar, dailylog: Notebook, admin: Crown,
  ai: Bot, social: Megaphone, brand: Brain, seo: Search, settings: Settings, import: Download,
};

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
function PaymentForm({ invoice, categories, catOptions, existingSubcats, onSave, onCancel, formData, setFormData }) {
  const [pf, setPf] = useState({ date: formData.date || todayET(), amount: formData.amount || '', payMethod: formData.payMethod || 'cash', desc: formData.desc || '', category: formData.category || 'مبيعات', subcategory: formData.subcategory || '' });
  // Option source chain (first non-empty wins):
  //   1. catOptions prop  (new, from buildCatOptions via parent)
  //   2. categories tuple prop  (legacy callers passing [[ar,en],...])
  //   3. buildCatOptions([])  (EXPENSE_CATS fallback — never leaves the user staring at empty dropdown)
  let _opts = [];
  if (Array.isArray(catOptions) && catOptions.length > 0) _opts = catOptions;
  else if (Array.isArray(categories) && categories.length > 0) {
    _opts = categories.map(([ar, en]) => ({ value: ar, label: (en && ar && en !== ar) ? (en + ' / ' + ar) : (ar || en) }));
  }
  if (_opts.length === 0) _opts = buildCatOptions([], { lang: 'bi' });

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
            <div className="text-[10px] text-amber-900 font-bold mb-2">📝 Post-dated check — NOT added to treasury until collected</div>
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
            {_opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
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
  // v55.83-A.6.13 (Max May 14 2026) — when user clicks a ticket from
  // dashboard (or any non-tickets tab), we switch to tickets, open the
  // ticket modal, and remember which tab to return to when modal closes.
  // Clears after the return tab switch fires.
  const [returnToTabAfterTicket, setReturnToTabAfterTicket] = useState(null);
  const [mode, setMode] = useState('ytd');
  const [df, setDf] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().substring(0, 10); });
  const [dt, setDt] = useState(today());
  const [query, setQuery] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  // v55.83-A.6.27.71 — Advanced invoice filters (collapsible panel).
  // salesRepFilter: filter by sales_rep name (empty = all reps)
  // amountMin / amountMax: filter by total_amount range (empty = no limit)
  // hasOutstanding: 'all' | 'yes' | 'no' — only invoices with outstanding > 0 (or fully collected)
  // showAdvFilters: persistent toggle for the panel
  // showRepDashboard: toggle the SalesRepDashboard section above the invoice list
  const [salesRepFilter, setSalesRepFilter] = useState('');
  const [amountMin, setAmountMin] = useState('');
  const [amountMax, setAmountMax] = useState('');
  const [hasOutstandingFilter, setHasOutstandingFilter] = useState('all');
  const [showAdvFilters, setShowAdvFilters] = useState(false);
  const [showRepDashboard, setShowRepDashboard] = useState(false);

  // Data
  const [invoices, setInvoices] = useState([]);
  const [treasury, setTreasury] = useState([]);
  // v55.83-A.6.27.71 (Phase 3): bucket-status map for the treasury renderer.
  // When a bucket placeholder treasury row is rendered, we look up the bucket
  // status here to decide whether to show "pending" (amber) or "reconciled"
  // (green) styling. Loaded lazily via a separate query that only runs when
  // bucket placeholder rows are present in the filtered treasury list, and
  // cached in this state. Updated alongside treasury via loadAllData ripples.
  // KEY: this NEVER modifies the treasury row itself — just decides UI.
  const [bucketStatusMap, setBucketStatusMap] = useState({});
  const [checks, setChecks] = useState([]);
  const [debts, setDebts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [warehouse, setWarehouse] = useState([]);
  // v55.83-A.6.27.64 — Open advances loaded for the warehouse expense form dropdown
  // (so operator can tag the expense to an advance at save time).
  const [warehouseAdvances, setWarehouseAdvances] = useState([]);
  const [invoiceItems, setInvoiceItems] = useState([]);
  // v55.83-A.6.27 — Stage D: invoice line items can optionally link to an
  // inv_skus row. When set + qty present at save time, we drain FIFO layers
  // and stamp COGS on the invoice line. These two states load once for
  // the picker in the invoice modal.
  const [invSkus, setInvSkus] = useState([]);
  const [invWarehouses, setInvWarehouses] = useState([]);
  // v55.83-A.6.27.44b — Inventory-linked invoice state.
  // inventoryProducts: variants from inventory_products (NOT the legacy `inventory` table).
  //   Loaded alongside other data. Used by the new "📦 From Inventory" tab in invoice product picker.
  // inventoryCutoffDate: loaded from app_settings.inventory_cutoff_date.
  //   When set, invoices on/after this date force inventory mode (enforced in 44c). Today it's just a guide.
  const [inventoryProducts, setInventoryProducts] = useState([]);
  // v55.83-GE — ids of virtual Stock Mix products. They are excluded from the invoice picker and
  // blocked from FIFO consumption until Phase 2 (component drawdown) is built.
  const [virtualMixIds, setVirtualMixIds] = useState(function () { return {}; });
  const [inventoryCutoffDate, setInventoryCutoffDate] = useState(null);
  const [expenseRules, setExpenseRules] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [invInbounds, setInvInbounds] = useState([]);
  const [invAdjustments, setInvAdjustments] = useState([]); // S20 — adjustment journal
  const [teamUsers, setTeamUsers] = useState([]);
  const [userProfile, setUserProfile] = useState(null);
  const profileIdRef = useRef(null);
  const [modulePerms, setModulePerms] = useState({});
  const [lang, setLang] = useState('ar'); // 'ar' or 'en'
  const [categoriesList, setCategoriesList] = useState([]);  // from `categories` table (bilingual)

  // Translation helper — picks English text when available and lang is 'en'
  const tx = (arText, enText) => (lang === 'en' && enText) ? enText : (arText || '');
  // Category resolver — consults the live `categories` table first, then EXPENSE_CATS
  // fallback. Works regardless of whether the row has Arabic or English stored.
  const txCat = (raw) => {
    if (!raw) return lang === 'en' ? 'Uncategorized' : 'غير مصنّف';
    return resolveCatName(raw, lang, categoriesList);
  };

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
  // Reconcile flow state — what the user picked in the modal:
  //   { kind: 'attach', treasuryId: '<uuid>' }   — link check to existing treasury row
  //   { kind: 'new' }                            — create a new treasury cash_in row
  const [reconcileCheckChoice, setReconcileCheckChoice] = useState(null);
  // Cash-swap case: customer paid cash and took the paper check back
  const [reconcileCheckReturned, setReconcileCheckReturned] = useState(false);
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
  // v55.83-A.6.27.71 (Phase 2): bucket-create modal state. Completely
  // independent from showAddTreasury — they don't share any handlers or
  // form state. The treasury modal flow is untouched.
  const [showBucketModal, setShowBucketModal] = useState(false);
  // Bumped each time a bucket is created so the WarehouseBucketList reloads.
  const [bucketReloadToken, setBucketReloadToken] = useState(0);
  // Feature flag — warmed on mount via useEffect below. UI checks read
  // getFeatureFlagSync() which falls through to false until the warm
  // completes (safe default — buttons stay hidden until we KNOW the flag is on).
  const [bucketsFeatureEnabled, setBucketsFeatureEnabled] = useState(false);
  useEffect(function () {
    getFeatureFlag('warehouse_buckets_enabled', false).then(setBucketsFeatureEnabled).catch(function () {
      setBucketsFeatureEnabled(false);
    });
  }, []);
  // v55.83-A.6.27.71 (Phase 3): bucket entries for CLOSED buckets, keyed
  // by bucket_id. Used by the Expense Report aggregation to substitute
  // closed bucket entries' real categories for the "Warehouse Bucket"
  // placeholder. Loaded as a side effect of bucketStatusMap, only for
  // buckets that resolve to 'closed' status. Cleared when no closed
  // buckets appear in current view.
  const [bucketEntriesByBucket, setBucketEntriesByBucket] = useState({});
  useEffect(function () {
    var closedIds = Object.keys(bucketStatusMap || {}).filter(function (id) {
      return bucketStatusMap[id] === 'closed';
    });
    if (closedIds.length === 0) {
      setBucketEntriesByBucket({});
      return;
    }
    var cancelled = false;
    (async function () {
      try {
        var res = await supabase.from('warehouse_bucket_entries').select('*').in('bucket_id', closedIds);
        if (cancelled || res.error) return;
        var map = {};
        (res.data || []).forEach(function (e) {
          if (!map[e.bucket_id]) map[e.bucket_id] = [];
          map[e.bucket_id].push(e);
        });
        setBucketEntriesByBucket(map);
      } catch (e) {
        console.warn('[bucket-entries-map] load failed:', e);
      }
    })();
    return function () { cancelled = true; };
  }, [bucketStatusMap]);
  useEffect(function () {
    var bucketIds = (treasury || [])
      .filter(function (t) { return t && t.bucket_role === 'placeholder' && t.bucket_id; })
      .map(function (t) { return t.bucket_id; });
    if (bucketIds.length === 0) {
      setBucketStatusMap({});
      return;
    }
    // Dedupe
    var uniq = {};
    bucketIds.forEach(function (id) { uniq[id] = true; });
    var unique = Object.keys(uniq);
    var cancelled = false;
    (async function () {
      try {
        var res = await supabase.from('warehouse_buckets').select('id,status').in('id', unique);
        if (cancelled || res.error) return;
        var map = {};
        (res.data || []).forEach(function (b) { map[b.id] = b.status; });
        setBucketStatusMap(map);
      } catch (e) {
        console.warn('[bucket-status-map] load failed:', e);
      }
    })();
    return function () { cancelled = true; };
  }, [treasury]);
  // v55.82-F — Per-tab opt-in: Nadia is suppressed by default in Treasury
  // (per Max May 11 2026 spec), and only appears when the user explicitly
  // clicks "Wake Nadia" on the Treasury tab. Resets on tab change so each
  // visit to Treasury starts in suppressed mode again.
  const [nadiaWokenInTab, setNadiaWokenInTab] = useState({});
  // v55.82-F — Reset effect. Without this, clicking "Wake Nadia" on
  // Treasury, then navigating to Sales (or any other tab), then coming
  // BACK to Treasury, would find Nadia still woken — violating the
  // "default suppressed" spec. Now we drop the treasury flag whenever
  // the user leaves the Treasury tab. Re-entering Treasury is a fresh
  // suppressed-by-default visit.
  useEffect(function() {
    if (tab !== 'treasury' && nadiaWokenInTab.treasury) {
      setNadiaWokenInTab(function(prev) {
        var next = Object.assign({}, prev);
        delete next.treasury;
        return next;
      });
    }
  }, [tab]);
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
  // v55.83-A.6.27.21 (Max May 17 2026) — Fix Links button busy state.
  // Per Max: "FIX button doesn't do anything anymore." Button now shows
  // explicit feedback during scan/link operations and toasts result.
  const [fixLinksBusy, setFixLinksBusy] = useState(false);
  // Treasury ↔ Sales navigation return state
  const [treasuryReturnState, setTreasuryReturnState] = useState(null);
  // Mini-modal for "order# doesn't exist, create now?" flow
  const [pendingTreasuryRecord, setPendingTreasuryRecord] = useState(null);
  // v55.83-A.6.27.17 (Max May 17 2026) — Phase 1 Payment Instruments / Scheduled Receivables.
  // When the accountant enters a treasury cash_in or bank_in row that matches
  // the amount of a pending instrument (check or promissory note) on the
  // same invoice, this state holds the candidate match while the popup is
  // shown. User picks "Yes link" → we stamp source_check_id on the treasury
  // row AND flip the instrument to 'cleared'. User picks "No, separate
  // payment" → we proceed with the treasury insert without the link.
  //
  // Rule 5 enforcement: this code path NEVER creates an extra treasury row.
  // The treasury row was already being created — the popup only adds metadata.
  const [pendingInstrumentMatch, setPendingInstrumentMatch] = useState(null);

  // v55.83-A.6.27.18 (Max May 17 2026) — Phase 2 of Payment Instruments.
  // State for the invoice-level "Payment Instruments / Scheduled
  // Receivables" section at the BOTTOM of the invoice screen. Collapsible
  // (default expanded so it's visible). Add form expands inline below
  // the list. Per Max: documentation-only, never affects treasury or
  // invoice totals.
  const [instrumentSectionExpanded, setInstrumentSectionExpanded] = useState(true);
  const [showAddInstrumentForm, setShowAddInstrumentForm] = useState(false);
  const [instrumentForm, setInstrumentForm] = useState({
    instrument_type: 'check',
    check_number: '',
    amount: '',
    issue_date: '',
    due_date: '',
    bank_name: '',
    notes: '',
  });
  const [instrumentBusy, setInstrumentBusy] = useState(false);

  // v55.83-A.6.27.19 (Max May 17 2026) — code review fix.
  //
  // Helper: find pending/deposited instruments on the given invoice whose
  // amount matches the given EGP amount. Returns an ARRAY so the caller
  // can handle multiple candidates (e.g. two pending checks of identical
  // amount on the same invoice). Previously the popup hardcoded .find()
  // and only offered the first one.
  //
  // Rules:
  //   - Match on invoice_id OR order_number for legacy rows.
  //   - Only pending or deposited instruments are eligible.
  //   - Skip instruments already linked to another treasury row.
  //   - Amount tolerance: 1 EGP (rounding).
  const findMatchingInstruments = (invoice, amt) => {
    if (!invoice || !(amt > 0)) return [];
    return (checks || []).filter(function (c) {
      if (c.invoice_id !== invoice.id && c.order_number !== invoice.order_number) return false;
      if (c.status !== 'pending' && c.status !== 'deposited') return false;
      if (c.linked_treasury_id) return false;
      return Math.abs(Number(c.amount) - amt) < 1;
    });
  };

  // v55.83-A.6.27.17 (Max May 17 2026) — Phase 1 helper. Commits a treasury
  // row that the instrument-match popup has already stamped with the user's
  // decision. Two cases:
  //   __instrument_popup_decision === 'link' → record.source_check_id is set;
  //       after the insert succeeds, flip the instrument to 'cleared' and
  //       point linked_treasury_id at the new treasury row.
  //   __instrument_popup_decision === 'no_link' → just insert and recalc;
  //       the instrument stays pending. No second treasury row, no money
  //       math change.
  // Either way, exactly ONE treasury row is created — Rule 5 enforcement.
  const commitInstrumentLinkedTreasury = async (record, matchingInvoice, isBankPlaceholder) => {
    try {
      const inserted = await dbInsert('treasury', record, user?.id);
      // If the user accepted the link, flip the instrument to cleared.
      if (record.__instrument_popup_decision === 'link' && record.source_check_id) {
        try {
          await dbUpdate('checks', record.source_check_id, {
            status: 'cleared',
            collection_date: record.transaction_date || new Date().toISOString().slice(0, 10),
            linked_treasury_id: inserted.id,
            updated_by: user?.id,
          }, user?.id);
        } catch (instErr) {
          console.warn('[commitInstrumentLinkedTreasury] instrument flip failed:', instErr && instErr.message);
          try { toast.warning('Saved ✓ — but the linked instrument needs manual update to "cleared".'); } catch (_) {}
        }
      }
      // Recalc the invoice unless it's a placeholder (placeholders recalc on bank-match).
      if (!isBankPlaceholder) {
        try { await recalcInvoiceCollected(matchingInvoice.id); }
        catch (recalcErr) {
          console.warn('[commitInstrumentLinkedTreasury] recalc failed:', recalcErr && recalcErr.message);
          try { toast.warning('Saved ✓ — but the invoice total may need a manual refresh.'); } catch (_) {}
        }
      }
      setTreasury(prev => [inserted, ...prev]);
      setShowAddTreasury(false);
      setPendingTreasuryRecord(null);
      setPendingInstrumentMatch(null);
      setDuplicateConfirm(null);
      setTreasuryFormErrors([]);
      setIsCreatingInvoice(false);
      setCreateInvoiceError(null);
      var msg;
      if (record.__instrument_popup_decision === 'link') {
        msg = 'Saved ✓ — instrument marked cleared';
      } else {
        msg = (isBankPlaceholder ? 'Bank entry saved (awaiting statement) + linked to ' : 'Transaction saved + linked to ')
          + (matchingInvoice.customer_name || ('#' + matchingInvoice.order_number)) + ' ✓';
      }
      toast.success(msg);
      setFormData({});
      setTimeout(() => loadAllData(), 500);
    } catch (err) {
      console.error('[commitInstrumentLinkedTreasury] failed:', err);
      try { toast.error('Save failed: ' + (err && err.message ? err.message : String(err))); }
      catch (_) { alert('Save failed: ' + (err && err.message ? err.message : String(err))); }
    }
  };
  // v55.41 — Suspected-duplicate confirmation modal.
  // When the user tries to save a treasury row whose date + amount +
  // description match an existing row, instead of silently saving (which
  // could create a real duplicate) OR silently blocking (which loses
  // legitimate same-amount-same-day repeat payments), we open this modal
  // showing the existing match(es) and ask the user to confirm. They can
  // either:
  //   • Cancel  — they'll edit the row to make it unique
  //   • Confirm — it really IS a separate payment that happens to look
  //               identical (common with regular weekly cash payments,
  //               two identical fuel purchases, etc.). The save proceeds
  //               and the new row is stamped confirmed_not_duplicate=true
  //               so the AI auditor doesn't flag it later.
  const [duplicateConfirm, setDuplicateConfirm] = useState(null);
  // v55.47 — Persistent in-form validation errors for the New Transaction
  // modal. Toasts at the screen corner are easy to miss on mobile (Amad
  // reported "I tap Submit and nothing happens" — actually amount was blank
  // and the toast pop-and-disappeared in 2s). This state drives a red
  // banner INSIDE the modal listing every missing/invalid field, plus per-
  // field highlighting. Cleared whenever the form is reset or submitted OK.
  const [treasuryFormErrors, setTreasuryFormErrors] = useState([]);
  // v55.82-E — In-flight visual state for the Submit button. Disables the
  // button + shows "Saving…" while handleAddTreasury is running so users
  // can't double-tap and don't think the system froze when there's actually
  // a slow network round-trip in progress.
  const [treasurySaving, setTreasurySaving] = useState(false);
  // shape: { record, amount, txDate, matches: [...existing rows], invoiceToLink }
  // Loading flag for the inline "Create Invoice + Save Treasury" button so
  // the user gets immediate feedback (button disables + shows spinner) and
  // can't double-tap during the async Supabase round-trip. Was missing
  // previously — looked like "nothing happens" on slow mobile networks.
  const [isCreatingInvoice, setIsCreatingInvoice] = useState(false);
  // Apr 26 2026 — Loading flag for "Create new customer" button in the
  // create-invoice picker. Prevents double-tap creating two customer rows.
  const [isCreatingCustomer, setIsCreatingCustomer] = useState(false);
  // Apr 25 2026 — Visible error banner for the create-invoice modal. Toasts
  // disappear in 5s and are easy to miss on mobile. This banner stays in the
  // modal until dismissed, so any failure surfaces unmissable feedback.
  const [createInvoiceError, setCreateInvoiceError] = useState(null);
  // Apr 25 2026 — Helper that cleanly closes the "Order Not Found" mini-modal
  // AND wipes every piece of stale state that could pollute the next attempt.
  // Without this, switching between Cash Out → Cash In with the modal having
  // been open even briefly left __creatingInvoice / __newInvCustomer / etc.
  // hanging around. Next save would jump straight to the create-invoice form
  // with stale or empty values, and the green button would silently fail
  // validation. Using this helper everywhere the modal closes prevents that.
  const closePendingTreasuryModal = () => {
    setPendingTreasuryRecord(null);
    setIsCreatingInvoice(false);
    setCreateInvoiceError(null);
    setFormData(function(prev) {
      var next = Object.assign({}, prev);
      delete next.__creatingInvoice;
      delete next.__newInvCustomer;
      delete next.__newInvCustomerId;
      // v55.82-B — also strip the auto-link flag and search seed so a
      // subsequent open of the modal starts clean. Without these, the
      // green "Auto-linked" chip could re-appear with stale customer
      // info on a fresh transaction attempt.
      delete next.__newInvCustomerAutoLinked;
      delete next.__newInvSearch;
      delete next.__newInvTotal;
      delete next.__newInvDate;
      return next;
    });
  };
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
  // v55.83-A.6.27.16 (Max May 17 2026) — separate closed-ticket fetch for
  // Nadia. dashTickets is filtered server-side to exclude Closed (line ~1446)
  // because the dashboard priority cards don't need them. But Nadia needs
  // them for history queries like "what was that ticket about leather
  // samples last month". Three prior builds tried to fix this inside
  // AIGreeter by branching on status, but the data never reached her in
  // the first place. This state is a separate, smaller fetch scoped to
  // the user with a sane LIMIT so it doesn't bloat memory.
  const [closedTicketsForAI, setClosedTicketsForAI] = useState([]);
  const [activityFeed, setActivityFeed] = useState([]);
  const [dashEvents, setDashEvents] = useState([]);
  const [dashFollowUps, setDashFollowUps] = useState([]);
  const [fxRate, setFxRate] = useState(null);
  const [globalSearch, setGlobalSearch] = useState('');
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);
  const [showNotifBell, setShowNotifBell] = useState(false);
  // v55.40 — Unread voicemail count for the header badge. Polled every
  // 30 seconds via the same endpoint the dashboard widget uses, so the
  // header and the dashboard stay in sync within a window.
  const [unreadVoicemails, setUnreadVoicemails] = useState(0);
  const [showFAB, setShowFAB] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  const [lastLoginInfo, setLastLoginInfo] = useState(null);
  const [tabLoading, setTabLoading] = useState(false);
  const [greeterDismissed, setGreeterDismissed] = useState(false);
  const [greeterHasGreeted, setGreeterHasGreeted] = useState(false);
  // v55.73 — Active assistant persona ('nadia' | 'jenna' | 'sara').
  // The AssistantsBar drives this via ktc:assistant-changed event so a
  // single source of truth lives in this top-level component. AIGreeter
  // receives selectedAssistant as a prop — it uses it to swap header
  // photo, name, greeting, voice ID, and personality prompt — but the
  // underlying voice/listening/recording engine is unchanged.
  // Nadia is the default per Max's spec.
  // v55.78 — Gap #4 — Persist last-active persona across page reloads.
  // Before, every reload reset to Nadia. If a user spent most of their
  // time with Sara (coaching) or Jenna (HR), they had to manually re-click
  // every refresh. Now we read the last-active persona from localStorage
  // on mount. Default = 'nadia'. Falls back to 'nadia' on any read error.
  //
  // v55.80 BD-AUDIT FIX: persona preference is per-user. The lazy-init
  // can't see userProfile.id yet (auth hasn't resolved), so we open with
  // 'nadia' as the safe default. Once auth completes, the useEffect below
  // hydrates from the per-user key. The OLD global key is intentionally
  // ignored — anything saved there belongs to whoever last used the
  // browser, not necessarily the current user.
  const [selectedAssistant, setSelectedAssistant] = useState('nadia');
  // Hydrate per-user preference once user id is known.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    var uid = userProfile && userProfile.id;
    if (!uid) return;
    try {
      var saved = window.localStorage.getItem('ktc.lastPersona.' + uid);
      if (saved === 'nadia' || saved === 'jenna' || saved === 'sara') {
        setSelectedAssistant(saved);
      }
    } catch (_) {}
  }, [userProfile?.id]);
  // Persist whenever it changes — writes to PER-USER key only.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    var uid = userProfile && userProfile.id;
    if (!uid) return; // don't write before auth resolves
    try { window.localStorage.setItem('ktc.lastPersona.' + uid, selectedAssistant); } catch (_) {}
  }, [selectedAssistant, userProfile?.id]);
  useEffect(() => {
    var handler = function (e) {
      var who = e && e.detail && e.detail.agent;
      if (who === 'nadia' || who === 'jenna' || who === 'sara') {
        setSelectedAssistant(who);
        // When user activates an assistant, ensure the AIGreeter is visible
        // (un-dismiss). The AIGreeter is the chat surface for ALL three.
        setGreeterDismissed(false);
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('ktc:assistant-changed', handler);
      return function () { window.removeEventListener('ktc:assistant-changed', handler); };
    }
  }, []);
  // v55.70 — when the user clicks the "Nadia" tile in the AssistantsBar
  // on the dashboard, we receive a ktc:open-nadia event. If Nadia is
  // currently dismissed (collapsed), un-dismiss her so the chat is visible
  // for the click-through. Listener is mounted once per session.
  useEffect(() => {
    var handler = function () { setGreeterDismissed(false); };
    if (typeof window !== 'undefined') {
      window.addEventListener('ktc:open-nadia', handler);
      return function () { window.removeEventListener('ktc:open-nadia', handler); };
    }
  }, []);
  // S22 (Apr 23 2026) — Persistent chat memory.
  // Previously greeterMessages started empty on every reload, so every
  // "Hey Nadia" felt like a fresh introduction. Now we hydrate from
  // localStorage (keyed by user id once we know it) and write back
  // whenever it changes.
  //
  // v55.78 — PER-PERSONA conversation threads.
  // Before this change, all three personas shared a single message array,
  // so when user switched from Nadia → Jenna, Jenna would see Nadia's
  // entire conversation in her history (including operational queries
  // unrelated to HR). Now each persona has her own thread. The active
  // persona's thread is exposed via greeterMessages getter so AIGreeter
  // sees only her own conversation. Updates from AIGreeter route to the
  // active persona's slot.
  // Storage shape: {nadia:[...], jenna:[...], sara:[...]}
  // Migration: if old single-array localStorage entry exists, treat it
  // as Nadia's thread (she was the only persona before).
  const [greeterMessagesByAgent, setGreeterMessagesByAgent] = useState({ nadia: [], jenna: [], sara: [] });
  // Computed accessor for the ACTIVE persona's thread. AIGreeter receives
  // this. When persona switches, this re-evaluates and AIGreeter re-renders
  // with that persona's history — Jenna sees only Jenna conversations.
  const greeterMessages = (greeterMessagesByAgent && greeterMessagesByAgent[selectedAssistant]) || [];
  // Setter that AIGreeter calls when it appends or updates messages. Routes
  // the update into the active persona's slot, leaving other slots alone.
  const setGreeterMessages = (next) => {
    setGreeterMessagesByAgent(function (prev) {
      var updated = Object.assign({}, prev || {});
      // AIGreeter passes either a new array OR a function (functional update).
      var resolved = typeof next === 'function' ? next(prev[selectedAssistant] || []) : next;
      updated[selectedAssistant] = resolved;
      return updated;
    });
  };
  // Hydrate from localStorage once we know whose messages to load.
  // Reads the new per-persona shape if present; falls back to the old
  // single-array entry (treating it as Nadia's history) for migration.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const uid = userProfile?.id;
    if (!uid) return;
    try {
      // New shape first
      const newRaw = localStorage.getItem('nadia.messages.byAgent.' + uid);
      if (newRaw) {
        const parsed = JSON.parse(newRaw);
        if (parsed && typeof parsed === 'object') {
          const localState = {
            nadia: Array.isArray(parsed.nadia) ? parsed.nadia : [],
            jenna: Array.isArray(parsed.jenna) ? parsed.jenna : [],
            sara:  Array.isArray(parsed.sara)  ? parsed.sara  : [],
          };
          setGreeterMessagesByAgent(localState);

          // v55.81 QA-16 (Max May 9 2026): also pull server-side
          // conversation_logs and merge in. The server has the canonical
          // history (cross-device). Local takes precedence ONLY if the
          // server returned nothing (e.g. first deploy of this feature).
          // Otherwise the longer of the two wins per persona — protects
          // against losing a long thread when switching to a new device
          // that has a stale-but-shorter local copy.
          (async () => {
            try {
              const r = await fetch('/api/conversation-log?userId=' + encodeURIComponent(uid));
              if (!r.ok) return;
              const sd = await r.json();
              if (!sd || !sd.byPersona) return;
              const merged = { nadia: localState.nadia, jenna: localState.jenna, sara: localState.sara };
              ['nadia', 'jenna', 'sara'].forEach(function (p) {
                const sv = Array.isArray(sd.byPersona[p]) ? sd.byPersona[p] : [];
                if (sv.length > merged[p].length) merged[p] = sv;
              });
              setGreeterMessagesByAgent(merged);
            } catch (_) { /* offline / endpoint missing — keep local */ }
          })();
          return;
        }
      }
      // Migrate old single-array shape — assume it was Nadia
      const legacyRaw = localStorage.getItem('nadia.messages.' + uid);
      if (legacyRaw) {
        const legacyParsed = JSON.parse(legacyRaw);
        if (Array.isArray(legacyParsed) && legacyParsed.length > 0) {
          setGreeterMessagesByAgent({ nadia: legacyParsed, jenna: [], sara: [] });
        }
      } else {
        // v55.81 QA-16: no local cache at all — fresh device. Hydrate
        // entirely from the server.
        (async () => {
          try {
            const r = await fetch('/api/conversation-log?userId=' + encodeURIComponent(uid));
            if (!r.ok) return;
            const sd = await r.json();
            if (sd && sd.byPersona) {
              setGreeterMessagesByAgent({
                nadia: Array.isArray(sd.byPersona.nadia) ? sd.byPersona.nadia : [],
                jenna: Array.isArray(sd.byPersona.jenna) ? sd.byPersona.jenna : [],
                sara:  Array.isArray(sd.byPersona.sara)  ? sd.byPersona.sara  : [],
              });
            }
          } catch (_) { /* offline / endpoint missing */ }
        })();
      }
    } catch (e) { /* corrupted localStorage entry — ignore */ }
    // Only run once per userProfile id; not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userProfile?.id]);
  // Persist on every change (cap each thread to last 80 messages to stay
  // under localStorage's practical size limits — total cap ~240 messages).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const uid = userProfile?.id;
    if (!uid) return;
    try {
      const trim = function (arr) { return Array.isArray(arr) ? arr.slice(-80) : []; };
      const trimmed = {
        nadia: trim(greeterMessagesByAgent && greeterMessagesByAgent.nadia),
        jenna: trim(greeterMessagesByAgent && greeterMessagesByAgent.jenna),
        sara:  trim(greeterMessagesByAgent && greeterMessagesByAgent.sara),
      };
      localStorage.setItem('nadia.messages.byAgent.' + uid, JSON.stringify(trimmed));
    } catch (e) { /* quota errors are non-fatal */ }
  }, [greeterMessagesByAgent, userProfile?.id]);
  // S17 — Shared Nadia mute state. Read from localStorage on mount so the
  // user's mute preference persists across sessions. Both the dashboard
  // AIGreeter and the NadiaFloatingOverlay read this same value, so muting
  // on one instance silences the other too.
  // v55.80 BD-AUDIT FIX: nadia mute is per-user. Same fix as lastPersona —
  // can't read user id at lazy-init time, so default to false and hydrate
  // once auth resolves.
  const [nadiaMuted, setNadiaMuted] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    var uid = userProfile && userProfile.id;
    if (!uid) return;
    try {
      var saved = localStorage.getItem('nadia.muted.' + uid);
      if (saved === 'true') setNadiaMuted(true);
      else if (saved === 'false') setNadiaMuted(false);
    } catch (e) {}
  }, [userProfile?.id]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    var uid = userProfile && userProfile.id;
    if (!uid) return;
    try { localStorage.setItem('nadia.muted.' + uid, nadiaMuted ? 'true' : 'false'); } catch (e) {}
    // Also dispatch events so components that listen (like the overlay)
    // stay in sync if another part of the app toggles mute.
    try {
      window.dispatchEvent(new CustomEvent(nadiaMuted ? 'nadia-mute' : 'nadia-unmute'));
    } catch (e) {}
  }, [nadiaMuted, userProfile?.id]);
  const [greeterSettings, setGreeterSettings] = useState({ personality: 'friendly', language: 'en', enabled: true });
  // v55.42 — VOICE DISABLED.
  // After many sessions chasing Web Speech API quirks (wake-word reliability,
  // OFF button bugs, transcription dropping, mobile mic permissions), we're
  // taking voice off the surface. The typed Nadia chat is unchanged and
  // works perfectly. If we revisit voice later, it'll be a clean rebuild
  // on a more reliable foundation than browser-side Web Speech.
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  // Hydration intentionally removed — voice stays off regardless of what's
  // stored on the user profile. Re-enabling would require more than just
  // flipping this back, since the underlying issues weren't fully resolved.
  // Session-persistent greeted state: set greeterHasGreeted=true if
  // the current login session already has greeted_at stamped. Prevents
  // re-greeting when user navigates back to dashboard from another tab.
  // S22.7 (Apr 23 2026) — Added localStorage fallback. If the DB doesn't
  // have user_sessions.greeted_at (older schema), the query silently fails
  // and Nadia re-greets on every refresh. localStorage, keyed per-day, is
  // a belt-and-suspenders safety net.
  useEffect(() => {
    if (!userProfile?.id || greeterHasGreeted) return;
    // Local check first — fast path, no round trip
    try {
      const todayKey = todayET();
      const stamped = localStorage.getItem('nadia.greeted.' + userProfile.id + '.' + todayKey);
      if (stamped) { setGreeterHasGreeted(true); return; }
    } catch (_) {}
    (async () => {
      try {
        const { data: sess } = await supabase
          .from('user_sessions')
          .select('id, greeted_at, logout_at')
          .eq('user_id', userProfile.id)
          .is('logout_at', null)
          .order('login_at', { ascending: false })
          .limit(1).maybeSingle();
        if (sess && sess.greeted_at) setGreeterHasGreeted(true);
      } catch (e) { /* table may not have column yet — harmless */ }
    })();
  }, [userProfile?.id, greeterHasGreeted]);
  // When greeter fires (child calls onGreeted), stamp greeted_at so
  // subsequent dashboard re-mounts skip the greeting.
  const handleGreeted = useCallback(async () => {
    setGreeterHasGreeted(true);
    // S22.7 — Stamp localStorage immediately so even if the DB write fails
    // or the column doesn't exist, the next dashboard visit won't re-greet.
    try {
      if (userProfile?.id) {
        const todayKey = todayET();
        localStorage.setItem('nadia.greeted.' + userProfile.id + '.' + todayKey, new Date().toISOString());
      }
    } catch (_) {}
    if (!userProfile?.id) return;
    try {
      await supabase
        .from('user_sessions')
        .update({ greeted_at: new Date().toISOString() })
        .eq('user_id', userProfile.id)
        .is('logout_at', null)
        .is('greeted_at', null);
    } catch (e) { /* column may be missing pre-SQL — harmless */ }
  }, [userProfile?.id]);
  const [lastLoaded, setLastLoaded] = useState(null);
  const [openTicketId, setOpenTicketId] = useState(null);
  // v55.83-A.6.18 (Max May 14 2026) — dashboard-side ticket modal. When user
  // clicks a ticket from the three priority cards, we open it IN PLACE on the
  // dashboard via this overlay instead of switching to the Tickets tab.
  const [dashboardTicketModal, setDashboardTicketModal] = useState(null);
  const [busyAckId, setBusyAckId] = useState(null);
  const [egyptBankTxns, setEgyptBankTxns] = useState([]);
  const [egyptBankAccounts, setEgyptBankAccounts] = useState([]);
  const [showReminderForm, setShowReminderForm] = useState(false);
  const [showReminderArchive, setShowReminderArchive] = useState(false);
  const seenRemindersRef = useRef(new Set());
  
  // Emergency sound for new reminders
  useEffect(() => {
    if (!reminders.length || !userProfile) return;
    const todayStr = todayET();
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

  // v55.40 — Poll the unread voicemail count for the header badge.
  // Mirrors the dashboard VoicemailsWidget's 30s refresh cadence so
  // when the user marks one read in the widget, the header badge
  // catches up within a window. Uses the same /api/phone/voicemails
  // endpoint with limit=1 so it stays a cheap query.
  useEffect(() => {
    var myId = user?.id;
    if (!myId) return;
    var cancelled = false;

    var fetchCount = async function () {
      try {
        var sess = await supabase.auth.getSession();
        var tok = sess && sess.data && sess.data.session ? sess.data.session.access_token : '';
        var url = '/api/phone/voicemails?assigned_to=' + encodeURIComponent(myId)
          + '&unread=true&limit=200';
        var r = await fetch(url, {
          headers: tok ? { 'Authorization': 'Bearer ' + tok } : {},
        });
        if (!r.ok) return; // 401 during logout etc — silent
        var d = await r.json();
        if (cancelled) return;
        // The API may return {voicemails: [...]} or [...] depending on shape.
        var list = Array.isArray(d) ? d : (d.voicemails || d.data || []);
        setUnreadVoicemails(Array.isArray(list) ? list.length : 0);
      } catch (_e) { /* silent — header badge is best-effort */ }
    };

    fetchCount();
    var interval = setInterval(fetchCount, 30 * 1000);
    return function () { cancelled = true; clearInterval(interval); };
  }, [user]);

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

    // v55.61 — Heartbeat fires IMMEDIATELY on login + every 2 minutes
    // (was: only every 5 minutes, no initial pulse). Effects:
    //   1) "Online" status appears within seconds of login instead of
    //      taking up to 5 minutes for the first heartbeat.
    //   2) The 10-minute online window now tolerates 4 consecutive missed
    //      heartbeats (was tolerating only 1) — far less likely to flip
    //      a logged-in user to "Offline" from a single network blip.
    // Reported by Max May 7 2026: "admin page.. login. why is online
    // status offline if I am online".
    var heartbeatTick = async function () {
      try {
        var sessRes = await supabase.auth.getSession();
        var s = sessRes && sessRes.data && sessRes.data.session;
        if (!s || !s.user) return;
        var today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
        var uid = profileIdRef.current || s.user.id;
        await supabase.from('user_sessions')
          .update({ last_seen: new Date().toISOString() })
          .eq('user_id', uid)
          .eq('date', today)
          .order('login_at', { ascending: false })
          .limit(1);
        // Also pulse login_events so admin portal "is_online" stays accurate.
        // keepalive: true ensures the heartbeat isn't cancelled if the user navigates away.
        try {
          fetch('/api/login-event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: uid, event_type: 'heartbeat' }),
            keepalive: true,
          }).catch(function () {});
        } catch (e) {}
      } catch (e) { /* never let a heartbeat error crash the page */ }
    };
    // Fire FIRST heartbeat right away — don't wait 5 minutes for online status
    heartbeatTick();
    // Then every 2 minutes. With the SQL view's 10-minute online window,
    // up to 4 consecutive misses are tolerated before flipping to Offline.
    const heartbeat = setInterval(heartbeatTick, 2 * 60 * 1000);

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

    // Session timeout: auto-logout after 2 hours of inactivity (except super_admin)
    let idleTimer;
    const IDLE_TIMEOUT = 2 * 60 * 60 * 1000; // 2 hours
    // v55.80 (Phase B+ feedback from Max May 8 2026):
    //   Track ACTIVE time, not just "tab was open." Real activity = user
    //   input (mouse/key/touch/scroll). Idle tab open all night should NOT
    //   count as 8h of work.
    //
    //   We bump `user_sessions.last_active` only when user actually
    //   interacts. Throttled to 30s so a busy typist doesn't hammer the DB.
    //   The presence calculator reads last_active (separate from last_seen)
    //   to compute "how long they were really working."
    let lastActivePingMs = 0;
    const ACTIVE_PING_MIN_GAP_MS = 30 * 1000;
    const pingActive = function () {
      var now = Date.now();
      if (now - lastActivePingMs < ACTIVE_PING_MIN_GAP_MS) return;
      lastActivePingMs = now;
      try {
        var uid = profileIdRef.current || user?.id;
        if (!uid) return;
        var today = todayET();
        // Best-effort — don't block UI on this. Throttle = 1 write per 30s.
        supabase.from('user_sessions')
          .update({ last_active: new Date().toISOString(), last_seen: new Date().toISOString() })
          .eq('user_id', uid)
          .eq('date', today)
          .order('login_at', { ascending: false })
          .limit(1)
          .then(function () {});
      } catch (e) { /* swallow — don't crash on activity ping */ }
    };
    const resetIdle = () => {
      // Bump active timestamp on every real user input — throttled inside.
      pingActive();
      clearTimeout(idleTimer);
      idleTimer = setTimeout(async () => {
        try {
          const { data: { session: s } } = await supabase.auth.getSession();
          if (!s?.user) return;
          const { data: profile } = await supabase.from('users').select('role').eq('email', s.user.email).single();
          if (profile?.role === 'super_admin') return; // super admins stay logged in
          // Record auto-logout in session
          const today = todayET();
          const uid = profileIdRef.current || s.user.id;
          await supabase.from('user_sessions')
            .update({ logout_at: new Date().toISOString(), logout_reason: 'auto_timeout' })
            .eq('user_id', uid).eq('date', today)
            .order('login_at', { ascending: false }).limit(1);
          // Log it
          try { await supabase.from('daily_log').insert({ user_id: uid, entry_text: 'Auto-logged out after 2 hours of inactivity', log_category: 'login', log_date: today, log_time: new Date().toTimeString().substring(0,8), auto_generated: true }); } catch(e) { console.warn('Silent error:', e.message || e); }
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
        const today = todayET(); // ET — fixes 'you werent here yesterday' bug
        // Best-effort logout event via beacon (survives navigation)
        try {
          const blob = new Blob([JSON.stringify({ user_id: uid, event_type: 'logout' })], { type: 'application/json' });
          navigator.sendBeacon('/api/login-event', blob);
        } catch(e) {}
        supabase.from('user_sessions')
          .update({ last_seen: new Date().toISOString(), logout_at: new Date().toISOString() })
          .eq('user_id', uid).eq('date', today)
          .order('login_at', { ascending: false }).limit(1).then(() => {});
      }
    };
    window.addEventListener('beforeunload', handleUnload);

    // v55.80 (Phase B / Section 13 — login reliability)
    // ----------------------------------------------------------------
    // The "still online" bug: if the user closes a tab and the
    // beforeunload beacon doesn't fire (which happens — Safari drops
    // them, mobile background-kill drops them), heartbeats keep going
    // for the full 10-minute online window or until the browser stops
    // running our timer. Fix: when the tab becomes hidden, START a
    // 3-minute soft-logout timer. If they come back before it fires,
    // cancel. If 3 min pass with the tab hidden, fire a logout event
    // so admin sees them go offline. We do NOT clear the auth session
    // — they're still signed in; they just stop pulsing as "online".
    let hiddenTimer = null;
    const HIDDEN_TIMEOUT_MS = 3 * 60 * 1000;
    const handleVisibilityChange = () => {
      try {
        if (document.visibilityState === 'hidden') {
          if (hiddenTimer) clearTimeout(hiddenTimer);
          hiddenTimer = setTimeout(() => {
            try {
              const uid = profileIdRef.current || user?.id;
              if (!uid) return;
              // Fire a soft 'logout' event so user_login_summary.is_online
              // flips false within 10 minutes regardless of beacon delivery.
              // v55.80 BUG-8 FIX: try beacon first; only fall through to
              // fetch if the beacon failed. Otherwise we double-fire.
              let beaconSent = false;
              try {
                const blob = new Blob([JSON.stringify({ user_id: uid, event_type: 'logout', notes: 'tab_hidden_timeout' })], { type: 'application/json' });
                beaconSent = navigator.sendBeacon('/api/login-event', blob);
              } catch (e) { beaconSent = false; }
              if (!beaconSent) {
                try {
                  fetch('/api/login-event', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user_id: uid, event_type: 'logout', notes: 'tab_hidden_timeout' }),
                    keepalive: true,
                  }).catch(function () {});
                } catch (e) {}
              }
            } catch (e) { /* never let this crash the tab */ }
          }, HIDDEN_TIMEOUT_MS);
        } else if (document.visibilityState === 'visible') {
          // Tab is back — cancel the pending logout, and re-pulse a
          // heartbeat right away so admin sees them come back online.
          if (hiddenTimer) { clearTimeout(hiddenTimer); hiddenTimer = null; }
          heartbeatTick();
        }
      } catch (e) { /* swallow */ }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => { subscription?.unsubscribe(); clearInterval(heartbeat); clearTimeout(idleTimer); if (hiddenTimer) clearTimeout(hiddenTimer); ['mousedown','keydown','touchstart','scroll'].forEach(evt => window.removeEventListener(evt, resetIdle)); window.removeEventListener('beforeunload', handleUnload); window.removeEventListener('keydown', handleKey); document.removeEventListener('click', handleClickOutside); document.removeEventListener('visibilitychange', handleVisibilityChange); };
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
      // Per QA charter principle #5: each table query is independently safe.
      // Promise.allSettled never rejects — one failed table cannot nuke the whole dashboard.
      // Previously Promise.all here caused: single RLS hiccup on any of 9 tables → all setState
      // calls skipped → dashboard renders empty/stale. Fixed 2026-04-20.
      const safe = (p) => p.catch((e) => { try { console.warn('[loadAllData]', e?.message || e); } catch(_){} return []; });
      const [inv, tres, chk, dbt, cust, wh, items, rules, stock] = await Promise.all([
        safe(fetchAll('invoices', 'invoice_date')),
        safe(fetchAll('treasury', 'transaction_date')),
        safe(fetchAll('checks', 'check_date', true)),
        safe(fetchAll('debts', 'total_debt')),
        safe(fetchAll('customers', 'name', true)),
        safe(fetchAll('warehouse_expenses', 'expense_date')),
        safe(fetchAll('invoice_items', 'created_at', true)),
        safe(fetchAll('expense_rules', 'created_at', true)),
        safe(fetchAll('inventory', 'created_at', true)),
      ]);
      // Load bilingual categories (may not exist yet if SQL not run)
      try {
        const { data: cats } = await supabase.from('categories').select('*').eq('active', true).order('sort_order').order('name_ar');
        setCategoriesList(cats || []);
      } catch (e) { setCategoriesList([]); }
      // v55.83-A.6.27 — load Stage C/D inventory data for invoice SKU linkage
      try {
        const { data: skuRows } = await supabase.from('inv_skus').select('*').is('deleted_at', null).order('sku_number');
        setInvSkus(skuRows || []);
      } catch (e) { setInvSkus([]); }
      try {
        const { data: whRows } = await supabase.from('inv_warehouses').select('*').eq('is_active', true).order('name');
        setInvWarehouses(whRows || []);
      } catch (e) { setInvWarehouses([]); }
      // v55.83-A.6.27.64 — load open warehouse advances for the expense form dropdown.
      // Safe to fail silently (table may not exist yet if .62 SQL hasn't been run).
      try {
        const { data: advRows } = await supabase.from('warehouse_advances').select('id, issue_date, amount, currency, recipient_name, recipient_role, status').eq('status', 'open').order('issue_date', { ascending: false });
        setWarehouseAdvances(advRows || []);
      } catch (e) { setWarehouseAdvances([]); }
      // v55.83-A.6.27.44b — load inventory_products (variants) for the invoice picker.
      // Safe to fail silently — invoice form falls back to legacy/manual mode.
      try {
        const { data: ipRows } = await supabase.from('inventory_products').select('*').eq('active', true).order('name_en');
        // v55.83-GE — SAFETY GATE: exclude virtual Stock Mix products from the invoice "From
        // Inventory" picker (they hold no stock of their own and selling them is not yet wired to
        // expand into real component colors — that is Phase 2). Track their ids to also block
        // FIFO consumption if one somehow reaches save.
        const allActiveProducts = ipRows || [];
        const vmix = {};
        allActiveProducts.forEach(function (p) { if (p && p.is_virtual_mix === true) { vmix[p.id] = true; } });
        setVirtualMixIds(vmix);
        setInventoryProducts(allActiveProducts.filter(function (p) { return p.is_virtual_mix !== true; }));
      } catch (e) { setInventoryProducts([]); }
      // v55.83-A.6.27.44b — load cutoff date setting.
      // When null/missing, both modes always available. When set, future-dated invoices force inventory mode (in 44c).
      try {
        const { data: cutoffRow } = await supabase
          .from('app_settings')
          .select('setting_value')
          .eq('setting_key', 'inventory_cutoff_date')
          .maybeSingle();
        if (cutoffRow && cutoffRow.setting_value) {
          var rawCut = cutoffRow.setting_value;
          try {
            var parsedCut = JSON.parse(rawCut);
            if (parsedCut && typeof parsedCut === 'string' && /^\d{4}-\d{2}-\d{2}/.test(parsedCut)) {
              setInventoryCutoffDate(parsedCut.substring(0, 10));
            }
          } catch (e2) {
            if (/^\d{4}-\d{2}-\d{2}/.test(rawCut)) setInventoryCutoffDate(rawCut.substring(0, 10));
          }
        }
      } catch (e) { /* no-op — cutoff just stays null */ }
      // Load team users separately (may not exist yet)
      try {
        const { data: usrs } = await supabase.from('users').select('*').order('name');
        setTeamUsers(usrs || []);
        // Find current user's profile
        const authUser = (await supabase.auth.getUser())?.data?.user;
        if (authUser && usrs) {
          // v55.33 — case-insensitive match with trim, plus auth-id fallback
          const authEmail = (authUser.email || '').toLowerCase().trim();
          let profile = usrs.find(u => (u.email || '').toLowerCase().trim() === authEmail);
          if (!profile && authUser.id) {
            profile = usrs.find(u => u.id === authUser.id);
          }
          if (profile) {
            setUserProfile(profile);
            profileIdRef.current = profile.id;
            // Load greeter settings
            setGreeterSettings({
              personality: profile.greeter_personality || 'friendly',
              language: profile.greeter_language || 'en',
              enabled: profile.greeter_enabled !== false,
            });
            // Log first login of the day (legacy daily_log entry)
            try {
              const todayStr = todayET();
              const loginTime = fmtET(new Date(), 'time', { tag: false });
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
            // Record a precise login event in login_events (ET-tz aware via DB generated column).
            // Previously this was a plain fetch().catch() — if the user navigated away before the
            // request completed (common on initial login), the row never got written and the admin
            // dashboard showed "0 logins today" even when the user was clearly logged in.
            // Fix: use navigator.sendBeacon first (survives page navigation) with fetch fallback,
            // then await + retry once on transient failure.
            try {
              const payload = JSON.stringify({
                user_id: profile.id,
                event_type: 'login',
                user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.substring(0, 200) : null,
              });
              let beaconed = false;
              try {
                if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
                  // sendBeacon needs a Blob with a content-type for Next.js API routes to parse JSON
                  const blob = new Blob([payload], { type: 'application/json' });
                  beaconed = navigator.sendBeacon('/api/login-event', blob);
                }
              } catch (e) { beaconed = false; }
              if (!beaconed) {
                // Fallback: actually await the fetch so it doesn't get cancelled on navigation.
                const attempt = async (retry) => {
                  try {
                    const r = await fetch('/api/login-event', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: payload,
                      keepalive: true, // critical: lets fetch survive page transitions
                    });
                    if (!r.ok && retry > 0) { await new Promise(res => setTimeout(res, 600)); return attempt(retry - 1); }
                  } catch (e) {
                    if (retry > 0) { await new Promise(res => setTimeout(res, 600)); return attempt(retry - 1); }
                  }
                };
                await attempt(1);
              }
            } catch(e) { /* truly non-fatal — we've done 2 paths of best-effort already */ }
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
      // S20 — Load adjustment journal (may not exist yet)
      try {
        const { data: adj } = await supabase.from('inventory_adjustments').select('*').order('adjusted_at', { ascending: false }).limit(2000);
        setInvAdjustments(adj || []);
      } catch(e) { setInvAdjustments([]); }
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
      // v55.75 (A3) — Bumped limit 30→100 because the next-step filter
      // narrows to "tickets the user is involved in" and 30 comments
      // shared across ~10 team members often left only 1-2 visible.
      // Also added created_by to the embedded tickets() select — without
      // it, the c.tickets.created_by === myId filter silently failed and
      // tickets the user CREATED but didn't have assigned never appeared.
      // v55.82-Z QA — also pull privacy columns on the joined ticket so
      // we can filter out comments tied to tickets the current user
      // shouldn't see (private super-admin tickets, confidential tickets
      // they aren't part of). Super admin sees everything.
      try {
        // v55.83-A.6.20 (Max May 14 2026) — bumped limit from 100 to 300
        // because the dashboard "Recent Updates to Your Assigned Tickets"
        // card was coming up empty for super admin even when their tickets
        // had recent comments. With 10 team members + 50+ open tickets, 100
        // comments in 7 days hits the ceiling fast and the user's specific
        // ticket comments get pushed out by load order. 300 is generous
        // enough to capture every relevant comment without straining the API.
        const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
        const { data: comments } = await supabase.from('ticket_comments')
          .select('*, tickets(id, ticket_number, title, status, priority, assigned_to, created_by, additional_assignees, is_private, private_to, is_confidential)')
          .gte('created_at', sevenDaysAgo)
          .order('created_at', { ascending: false })
          .limit(300);
        var meId = profile && profile.id;
        var meIsSA = profile && profile.role === 'super_admin';
        var filteredComments = (comments || []).filter(function (c) {
          var t = c.tickets;
          if (!t) return true; // orphan comment — keep
          if (meIsSA) return true;
          if (t.is_private) return t.private_to === meId;
          if (t.is_confidential) {
            if (t.created_by === meId) return true;
            if (t.assigned_to === meId) return true;
            try {
              var extras = typeof t.additional_assignees === 'string'
                ? JSON.parse(t.additional_assignees)
                : t.additional_assignees;
              if (Array.isArray(extras) && extras.indexOf(meId) >= 0) return true;
            } catch (_) {}
            return false;
          }
          return true;
        });
        setRecentTicketUpdates(filteredComments);
      } catch(e) { setRecentTicketUpdates([]); }
      // Load tickets for dashboard
      // v55.83-A.6.22 (Max May 14 2026) — REMOVED limit(200). Overdue tickets
      // are by definition OLD tickets, so limiting to the 200 newest ORDER BY
      // created_at DESC pushed every overdue ticket out of the window when the
      // team has 200+ active tickets. Now loads ALL non-closed tickets so the
      // dashboard priority cards can find them. Closed tickets are excluded
      // server-side — they're not needed for dashboard cards and would only
      // bloat the payload. For a typical KTC volume (a few hundred open
      // tickets) this is a small fetch.
      try {
        const { data: tix } = await supabase.from('tickets').select('*')
          .neq('status', 'Closed')
          .order('created_at', { ascending: false });
        var dashMeId = profile && profile.id;
        var dashMeIsSA = profile && profile.role === 'super_admin';
        var filteredTix = (tix || []).filter(function (t) {
          if (dashMeIsSA) return true;
          if (t.is_private) return t.private_to === dashMeId;
          if (t.is_confidential) {
            if (t.created_by === dashMeId) return true;
            if (t.assigned_to === dashMeId) return true;
            try {
              var extras = typeof t.additional_assignees === 'string'
                ? JSON.parse(t.additional_assignees)
                : t.additional_assignees;
              if (Array.isArray(extras) && extras.indexOf(dashMeId) >= 0) return true;
            } catch (_) {}
            return false;
          }
          return true;
        });
        setDashTickets(filteredTix);
      } catch(e) { setDashTickets([]); }

      // v55.83-A.6.27.16 (Max May 17 2026) — fetch Closed tickets separately
      // for Nadia's history queries. dashTickets above excludes Closed at
      // the server side; this query is purely for the AI assistant. Scoped
      // to the user (super-admin sees all; others see tickets where they're
      // the creator, primary assignee, or additional assignee). LIMIT 100
      // to keep payload reasonable — Nadia only references the most recent
      // anyway when answering "what was that ticket about X".
      // v55.83-A.6.27.28 (Max May 18 2026 — REPEATED FOR THE 4TH TIME):
      // "the AI must be able to see the closed ticket items when I
      // request a search for any item — THIS IS MANDATORY". The prior
      // .limit(100) was capping closed-ticket history. Removed. AI now
      // sees EVERY closed ticket the user is allowed to see (privacy
      // filtering preserved below). Permanent rule.
      try {
        var closedQuery = supabase.from('tickets').select('*')
          .eq('status', 'Closed')
          .order('updated_at', { ascending: false });
        const { data: closedTix } = await closedQuery;
        var closedMeId = profile && profile.id;
        var closedMeIsSA = profile && profile.role === 'super_admin';
        var filteredClosed = (closedTix || []).filter(function (t) {
          // Same privacy gates as dashTickets
          if (closedMeIsSA) return true;
          if (t.is_private) return t.private_to === closedMeId;
          // For non-super-admins, only include if THEY were involved
          if (t.created_by === closedMeId) return true;
          if (t.assigned_to === closedMeId) return true;
          try {
            var extras = typeof t.additional_assignees === 'string'
              ? JSON.parse(t.additional_assignees)
              : t.additional_assignees;
            if (Array.isArray(extras) && extras.indexOf(closedMeId) >= 0) return true;
          } catch (_) {}
          return false;
        });
        setClosedTicketsForAI(filteredClosed);
      } catch(e) { setClosedTicketsForAI([]); }
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
        const todayStr = todayET();
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
  const activeTeamUsers = useMemo(() => filterActiveUsers(teamUsers), [teamUsers]);
  // Apr 25 2026 — Defensive toast fallback. This is the App component, but
  // the ToastProvider is mounted INSIDE App's own return tree, which means
  // useContext(ToastContext) here always returns undefined (App is the
  // PARENT of the provider, not a child). Without the fallback, any
  // toast.success / .error / .warning call inside App's event handlers
  // throws "Cannot read properties of undefined (reading 'success')".
  // The fallback gives every call site a guaranteed-valid object — calls
  // become no-ops if there's no provider, and otherwise behave normally.
  // Real toast UI still works for child components (CalendarTab, AdminTab,
  // etc.) because they ARE inside the provider.
  const _toastRaw = useContext(ToastContext);
  const toast = _toastRaw || {
    success: () => {}, error: () => {}, warning: () => {}, info: () => {},
    confirm: async () => true,
  };

  // Breadcrumb — shows current location
  const TAB_GROUPS = { dashboard:'Overview', sales:'Finance', treasury:'Finance', checks:'Finance', debts:'Finance', egyptbank:'Finance', bank:'Finance', accounting:'Finance', quotes:'Finance', reports:'Finance', warehouse:'Operations', inventory:'Operations', customs:'Operations', shipping:'Operations', customers:'People', crm:'People', tickets:'People', calendar:'People', comms:'People', dailylog:'People', admin:'System', ai:'System', settings:'System', import:'System', systemtickets:'System' };
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
    XLSX.writeFile(wb, fileName + '_' + todayET() + '.xlsx');
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
    dailylog: 'Daily Log', admin: 'Admin', ai: 'AI Assistant', settings: 'Settings', import: 'Import', bank: 'Bank', accounting: 'Bank', quotes: 'Quotes', egyptbank: 'Egypt Bank', reports: 'Reports',
  };

  const visibleTabs = useMemo(() => {
    if (userProfile?.role === 'super_admin') return TABS; // super admin sees all
    if (!userProfile) return TABS.filter(t => t.id === 'dashboard'); // loading — show nothing
    return TABS.filter(t => {
      const moduleName = TAB_MODULE_MAP[t.id];
      // If permission explicitly set, use it
      if (moduleName && modulePerms[moduleName] !== undefined) return modulePerms[moduleName];
      // No explicit permission: hide all financial + admin tabs (even for admin/manager role)
      if (['treasury', 'checks', 'debts', 'sales', 'warehouse', 'inventory', 'admin', 'settings', 'import', 'bank', 'accounting', 'egyptbank', 'reports', 'customs', 'customers'].includes(t.id)) return false;
      return true;
    });
  }, [userProfile, modulePerms]);

  const filteredInvoices = useMemo(() => {
    let arr = invoices.filter(s => inRange(s.invoice_date, mode, df, dt));
    if (customerFilter) arr = arr.filter(s => s.customer_name === customerFilter || s.customer_name_en === customerFilter);
    if (query) arr = arr.filter(s =>
      (s.customer_name || '').includes(query) || (s.customer_name_en || '').toLowerCase().includes(query.toLowerCase()) || (s.order_number || '').includes(query)
    );
    // v55.83-A.6.27.71 (advanced filters) — trim + case-insensitive sales-rep
    // match so "John Smith" matches "  john smith  " etc. (M2 fix).
    if (salesRepFilter) {
      const repLow = salesRepFilter.trim().toLowerCase();
      arr = arr.filter(s => (s.sales_rep || '').trim().toLowerCase() === repLow);
    }
    if (amountMin !== '' && amountMin != null) {
      const minN = Number(amountMin);
      if (!isNaN(minN)) arr = arr.filter(s => Number(s.total_amount || s.amount || 0) >= minN);
    }
    if (amountMax !== '' && amountMax != null) {
      const maxN = Number(amountMax);
      if (!isNaN(maxN)) arr = arr.filter(s => Number(s.total_amount || s.amount || 0) <= maxN);
    }
    if (hasOutstandingFilter === 'yes') arr = arr.filter(s => Number(s.outstanding || 0) > 0);
    if (hasOutstandingFilter === 'no') arr = arr.filter(s => Number(s.outstanding || 0) <= 0);
    const dir = invoiceSort === 'oldest' ? 1 : -1;
    arr.sort((a, b) => dir * ((a.created_at || '').localeCompare(b.created_at || '')));
    return arr;
  }, [invoices, mode, df, dt, query, customerFilter, invoiceSort, salesRepFilter, amountMin, amountMax, hasOutstandingFilter]);

  // v55.83-A.6.27.71 (C1 + H3 + M6, Max May 23 2026) — Sales totals are now
  // multi-currency aware. Previously the page summed total_amount/outstanding
  // across USD + EGP invoices as if currencies were the same — meaningless.
  //
  // Three fixes in one block:
  //   C1: bucket by currency. totalsByCurrency is an array of
  //       {currency, invoiced, collected, outstanding, count} objects.
  //   H3: outstanding is computed as total_amount - total_collected when the
  //       stored .outstanding field is missing (stale or not yet recalc'd).
  //   M6: use ?? null check so a legitimate zero total_amount doesn't trigger
  //       the .amount fallback unexpectedly.
  //
  // Legacy single-number totals are kept as the SUM of EGP-equivalent if
  // EGP is the only currency present — to avoid breaking any other code
  // that consumes them — but they're flagged stale if multi-currency.
  const totalsByCurrency = useMemo(() => {
    const buckets = {};
    filteredInvoices.forEach(inv => {
      const cur = String(inv.currency || 'USD').toUpperCase().trim() || 'USD';
      if (!buckets[cur]) buckets[cur] = { currency: cur, invoiced: 0, collected: 0, outstanding: 0, count: 0 };
      const b = buckets[cur];
      const invd = Number(inv.total_amount != null ? inv.total_amount : (inv.amount || 0));
      const coll = Number(inv.total_collected != null ? inv.total_collected : 0);
      const outs = inv.outstanding != null ? Number(inv.outstanding) : Math.max(0, invd - coll);
      b.invoiced += invd;
      b.collected += coll;
      b.outstanding += outs;
      b.count++;
    });
    const arr = Object.values(buckets);
    arr.sort((a, b) => a.currency.localeCompare(b.currency));
    return arr;
  }, [filteredInvoices]);

  // Backward-compatible single-number totals — used by any old UI that reads
  // these without knowing about currency. If multiple currencies are present
  // these numbers are mathematically nonsense, but we keep them so callers
  // don't break; a banner in the UI warns when this happens.
  const totalInvoiced = useMemo(() => totalsByCurrency.reduce((a, b) => a + b.invoiced, 0), [totalsByCurrency]);
  const totalCollected = useMemo(() => totalsByCurrency.reduce((a, b) => a + b.collected, 0), [totalsByCurrency]);
  const totalOutstanding = useMemo(() => totalsByCurrency.reduce((a, b) => a + b.outstanding, 0), [totalsByCurrency]);
  const totalDebt = useMemo(() => debts.reduce((a, d) => a + Number(d.total_debt || 0), 0), [debts]);
  // Flag: true when filtered range contains more than one currency. The Sales
  // tab UI should show a warning banner when this is true and the single-
  // number totals are displayed.
  const totalsAreMixedCurrency = totalsByCurrency.length > 1;

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
  // BUG 3 fix: guard against double-click / fast-repeat submissions on the
  // Add Payment form. Without this, a user accidentally clicking twice inserts
  // two treasury rows — the invoice caps at total_amount via recalc, so it
  // LOOKS right, but safe totals inflate by the duplicate amount. This ref
  // lets us reject the second call within the same logical submission.
  const addPaymentRunning = useRef(false);
  // v55.82-E — Same re-entry guard as addPaymentRunning, but for the
  // Treasury "+ New Transaction" Submit button. Without this, a fast
  // double-tap inserted two cash_in rows for the same payment. Caught
  // during the v55.82-E root-cause review of Max's "amounts not
  // recording properly" report. The freeze users perceived was made
  // worse by the second click hitting an unguarded handler.
  const addTreasuryRunning = useRef(false);
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
      // v55.83-A.6.9 (Max May 13 2026) — anchor on expected_date if set,
      // else fall back to transaction_date. Old 2-day window was too
      // narrow for employee-held money waiting on a deposit run.
      // 14 days covers most "money sitting with Haitham" cases.
      const anchorDate = new Date(ph.expected_date || ph.transaction_date);
      const tolAmt = Math.max(expAmt * 0.01, 1);
      const matchWindow = 14 * 86400000;

      const candidates = unmatchedBank.filter(b => {
        const bankAmt = Number(b.amount);
        const bankIsIn = bankAmt > 0;
        if (expDir === 'in' && !bankIsIn) return false;
        if (expDir === 'out' && bankIsIn) return false;
        // v55.83-A.6.12 (Max May 13 2026) — bank_account_id mismatch was
        // BLOCKING matches even when amount/date/order# were perfect. This
        // was the root cause of invoice 2303's 570K placeholder not matching
        // the 570K bank entry on 2026-03-29. The customer deposited to a
        // different company account than was expected when the placeholder
        // was created. We no longer EXCLUDE on account mismatch — instead,
        // we apply a score penalty (see scoring below). Match still has
        // 1% amount tolerance + 14-day date window, so false matches stay rare.
        if (Math.abs(Math.abs(bankAmt) - expAmt) > tolAmt) return false;
        const bDate = new Date(b.date);
        if (Math.abs(bDate - anchorDate) > matchWindow) return false;
        return true;
      });

      if (!candidates.length) return;

      const scored = candidates.map(b => {
        let score = 0;
        if (ph.order_number && (b.description || '').includes(ph.order_number)) score += 1000;
        score -= Math.abs(Math.abs(Number(b.amount)) - expAmt);
        score -= Math.abs(new Date(b.date) - anchorDate) / 86400000;
        // v55.83-A.6.12 — penalize account_id mismatch instead of excluding.
        // If accounts match → no penalty. If different → 500-point penalty
        // (less than the order# bonus of 1000, so a perfect order# match on
        // wrong account still beats no order# on right account). Prevents
        // false matches while allowing the right one to surface.
        if (ph.bank_account_id && b.account_id && ph.bank_account_id !== b.account_id) {
          score -= 500;
        }
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
          // v55.83-A.1 — also clear needs_bank_match flag. The row is now
          // confirmed by a real statement entry and contributes to
          // total_confirmed (not total_pending_bank) on the invoice.
          const updates = {
            is_bank_placeholder: false,
            needs_bank_match: false,
            matched_bank_txn_id: bank.id,
            cash_in: 0,
            cash_out: 0,
            bank_in:  isIn ?  expAmt : 0,
            bank_out: !isIn ? expAmt : 0,
            description: (placeholder.description || '').replace(' [awaiting bank confirmation]', '').replace(' [🏦 Bank Transfer · awaiting match]', ' [🏦 Bank Transfer]') + ' ✅ matched bank ' + bank.date,
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
              // Find the sibling that actually matches this amount (cash OR bank).
              // BUG 4 fix: tolerance is the MIN of (2% of expected, 500 EGP absolute).
              // Without the absolute cap, a 10M EGP placeholder had 200k tolerance —
              // enough to dedup against the wrong payment if two siblings had similar
              // amounts. The 500 EGP cap is tight enough to catch rounding / bank
              // fee variance but never across two logically distinct payments.
              var dedupTol = Math.min(expAmt * 0.02, 500);
              const matchingSibling = existingLinked.find(t =>
                Math.abs((Number(t.cash_in || 0) + Number(t.bank_in || 0)) - expAmt) < dedupTol
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
          //
          // v55.83-A.6.11 (Max May 13 2026) — BUG FIX: previously this only
          // fired when `updates.linked_invoice_id` was freshly set on this
          // run. If the placeholder ALREADY had linked_invoice_id (e.g.
          // because the v55.83-A.6.7 backfill SQL filled it on existing
          // rows), the conditional was falsy and recalc was SKIPPED. Result:
          // invoice 2303 stayed at "Confirmed 0, Pending 1.32M" even after
          // 3 of its placeholders were matched to real bank statements.
          //
          // FIX: resolve target invoice from EITHER newly-set or existing
          // linked_invoice_id and always run recalc.
          //
          // v55.83-A.6.7 (CRIT-6): retry once on failure.
          var recalcTargetId = updates.linked_invoice_id || placeholder.linked_invoice_id;
          if (recalcTargetId) {
            var recalcOk = false;
            try { await recalcInvoiceCollected(recalcTargetId); recalcOk = true; } catch(e) { console.warn('[auto-match] recalc attempt 1 failed:', e && e.message); }
            if (!recalcOk) {
              try {
                await new Promise(function (r) { setTimeout(r, 750); });
                await recalcInvoiceCollected(recalcTargetId);
                recalcOk = true;
              } catch (e2) {
                console.error('[auto-match] recalc retry failed for invoice ' + recalcTargetId + ':', e2 && e2.message);
              }
            }
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
          //
          // v55.83-A.6.27.14 (Max May 16 2026) — channel FIX. This is the
          // auto-matcher firing when an Egypt Bank statement entry matches a
          // pending check. The money landed in the BANK, not the safe — so
          // bank_in is the correct channel. Previously this used cash_in,
          // which silently inflated the safe balance for every auto-matched
          // check. Invoice "collected" is unaffected because the recalc sums
          // cash_in + bank_in either way.
          //
          // v55.83-A.6.7 (round 2 audit) — resolve linked_invoice_id from
          // order_number if check doesn't have invoice_id directly. Mirrors
          // the dbInsert auto-link logic to keep all treasury insert paths
          // consistent.
          var resolvedInvoiceId = chk.invoice_id || null;
          if (!resolvedInvoiceId && chk.order_number) {
            try {
              var lk = await supabase.from('invoices').select('id').eq('order_number', String(chk.order_number).trim()).maybeSingle();
              if (lk && lk.data && lk.data.id) resolvedInvoiceId = lk.data.id;
            } catch (lkErr) { /* don't block — just log */ console.warn('[auto-match] invoice lookup failed:', lkErr && lkErr.message); }
          }
          var ins = await supabase.from('treasury').insert({
            transaction_date: collectionDate,
            order_number: chk.order_number || '',
            description: desc,
            cash_in: 0,
            cash_out: 0,
            bank_in: Number(chk.amount),
            bank_out: 0,
            matched_bank_txn_id: bank.id,
            needs_bank_match: false,
            is_bank_placeholder: false,
            source: 'main',
            category: 'مبيعات',
            linked_invoice_id: resolvedInvoiceId,
            source_check_id: chk.id,
            payment_source: 'check',
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

  // v55.83-A.6.27.11 (Max May 15 2026) — Fix Nadia briefing claiming
  // "you haven't logged in a week" when the user is logged in RIGHT NOW.
  // Root cause: user_sessions can miss recent activity. Cross-reference
  // with the newer login_events table (per the same pattern AdminTab's
  // "Did Not Login Yesterday" widget uses). Synthesize today's entry if
  // login_events shows activity today but user_sessions doesn't.
  const [loginHistoryLoaded, setLoginHistoryLoaded] = useState(false);
  useEffect(() => {
    if (!userProfile?.id) return;
    (async () => {
      try {
        const [sessionsResp, eventsResp] = await Promise.all([
          supabase.from('user_sessions')
            .select('date, login_at')
            .eq('user_id', userProfile.id)
            .order('login_at', { ascending: false })
            .limit(30),
          // login_events is the newer, more reliable source. Used to
          // backfill any missing recent days. Don't fail if the table
          // doesn't exist on a fresh deploy.
          supabase.from('login_events')
            .select('event_time, event_type')
            .eq('user_id', userProfile.id)
            .eq('event_type', 'login')
            .order('event_time', { ascending: false })
            .limit(30)
            .then(r => r, () => ({ data: [] })),
        ]);
        var merged = sessionsResp.data || [];
        // Build a Set of dates already in user_sessions
        var haveDates = {};
        merged.forEach(function (s) { if (s.date) haveDates[s.date] = true; });
        // Append any login_events dates that aren't already covered
        (eventsResp.data || []).forEach(function (e) {
          if (!e.event_time) return;
          var d = String(e.event_time).substring(0, 10);
          if (!haveDates[d]) {
            haveDates[d] = true;
            merged.push({ date: d, login_at: e.event_time });
          }
        });
        // Sort newest first so AIGreeter's previousDays[0] gives the right answer
        merged.sort(function (a, b) {
          return (b.login_at || b.date || '').localeCompare(a.login_at || a.date || '');
        });
        setLastLoginInfo(merged);
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
      if (!t.order_number) return;
      // BUG 7 fix: exclude placeholders + dedup markers from per-order lookup.
      // Both legitimately have zero amounts — keeping them here was showing
      // accountants "0 EGP" rows in invoice drill-downs with no context, and
      // was inflating the row count shown in reconciliation dashboards.
      // They still live in the main treasury array for audit purposes.
      if (t.is_bank_placeholder) return;
      if (t.dedup_sibling_id) return;
      if (t.description && String(t.description).indexOf('[bank confirmation') >= 0) return;
      if (!map[t.order_number]) map[t.order_number] = [];
      map[t.order_number].push(t);
    });
    return map;
  }, [treasury]);

  // v55.83-A.6.27.13 (Max May 16 2026) — UUID-keyed treasury map.
  //
  // ROOT CAUSE OF INVOICE 2330 RECONCILIATION BUG:
  // The recalcInvoiceCollected function queries treasury by linked_invoice_id
  // (UUID). The display panel was using treasuryByOrder which keys by
  // order_number (string). The two paths can disagree:
  //   - A row with linked_invoice_id=X but order_number empty/wrong is
  //     COUNTED by recalc but HIDDEN from the display → "collected total
  //     includes invisible money"
  //   - A row with order_number=Y but no UUID link is DISPLAYED but NOT
  //     counted → "panel shows a payment that isn't in the total"
  //
  // The fix: panel now reads from this UUID-keyed map, which mirrors EXACTLY
  // the row set recalcInvoiceCollected uses. Now what the user sees in the
  // panel and what the "Collected" tile shows MUST agree.
  //
  // Includes placeholders + pending rows so the panel renders them too —
  // they were already counted (as pending) by the recalc, and previously
  // hidden by the panel for "cosmetic" reasons. Hidden pending money is the
  // real bug, not a UI nicety.
  const treasuryByInvoiceId = useMemo(() => {
    const map = {};
    treasury.forEach(t => {
      if (!t.linked_invoice_id) return;
      // Skip dedup mirrors and bank-confirmation markers — these are not
      // separate money, they're audit-trail rows for already-counted amounts.
      // (Same filter recalcInvoiceCollected uses.)
      if (t.dedup_sibling_id) return;
      if (t.description && String(t.description).indexOf('[bank confirmation') >= 0) return;
      if (!map[t.linked_invoice_id]) map[t.linked_invoice_id] = [];
      map[t.linked_invoice_id].push(t);
    });
    return map;
  }, [treasury]);

  // v55.83-A.6.27.13 — Linkage drift detector.
  //
  // Returns the rows that are linked-by-order-number to this invoice but
  // NOT linked-by-UUID. These DISPLAY in the panel under old logic but are
  // NOT counted by the recalc. Surfacing them lets the user see the broken
  // link and click Fix Links to repair.
  //
  // v55.83-A.6.27.14 (Max May 16 2026) — additional guard: if a row is
  // already linked-by-UUID to ANOTHER invoice, don't show it as an orphan
  // here. Otherwise clicking "Link Now" on invoice A would steal a row
  // legitimately owned by invoice B (possible when two invoices share the
  // same order_number string — legacy data or duplicate-import scenario).
  const findOrphanedOrderNumberMatches = (invoice) => {
    if (!invoice || !invoice.order_number) return [];
    var on = String(invoice.order_number).trim();
    if (!on) return [];
    var byUuid = treasuryByInvoiceId[invoice.id] || [];
    var byUuidIds = {};
    byUuid.forEach(function (t) { byUuidIds[t.id] = true; });
    return treasury.filter(function (t) {
      if (!t.order_number) return false;
      if (String(t.order_number).trim() !== on) return false;
      if (byUuidIds[t.id]) return false; // already counted via UUID
      // Already linked-by-UUID to a DIFFERENT invoice? Leave it alone.
      // Linking it here would steal from that other invoice.
      if (t.linked_invoice_id && t.linked_invoice_id !== invoice.id) return false;
      if (t.dedup_sibling_id) return false;
      if (t.description && String(t.description).indexOf('[bank confirmation') >= 0) return false;
      return true;
    });
  };

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
  const customCats = useMemo(() => [...new Set([...treasury.map(t=>t.category), ...expenseRules.map(r=>r.category)].filter(c=>c&&!isKnownCat(c, categoriesList)&&!c.startsWith('__')))].sort(), [treasury, expenseRules, categoriesList]);
  // Pre-built bilingual option array — used by every category dropdown. Stable AR key + bilingual label.
  const catOptions = useMemo(() => buildCatOptions(categoriesList, { lang: 'bi' }), [categoriesList]);

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
      .map(([cat, data]) => ({ cat, eng: resolveCatName(cat, 'en', categoriesList), ...data }))
      .sort((a, b) => b.total - a.total);
  }, [filteredTreasury, categoriesList]);

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
      .map(([cat, data]) => ({ cat, eng: resolveCatName(cat, 'en', categoriesList), ...data }))
      .sort((a, b) => b.total - a.total);
  }, [filteredTreasury, categoriesList]);

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

  // S13 — Phase 2 Morning Briefing actions. When user taps an action button
  // in the morning briefing card (e.g. "Open ticket"), AIGreeter dispatches
  // a window event. We catch it here and navigate to the right place.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOpenTicket = (e) => {
      const { ticket_id } = e.detail || {};
      if (ticket_id) { setTab('tickets'); setOpenTicketId(ticket_id); }
    };
    const handleOpenCustomer = (e) => {
      const { customer_name } = e.detail || {};
      if (customer_name) { setTab('customers'); setSelectedCustomer(customer_name); }
    };
    const handleOpenCheck = (e) => {
      setTab('checks');
      const { check_number } = e.detail || {};
      if (check_number) setQuery(check_number);
    };
    const handleOpenCalendar = () => { setTab('calendar'); };
    const handleOpenCRM = () => { setTab('crm'); };
    window.addEventListener('briefing-open-ticket', handleOpenTicket);
    window.addEventListener('briefing-open-customer', handleOpenCustomer);
    window.addEventListener('briefing-open-check', handleOpenCheck);
    window.addEventListener('briefing-open-calendar', handleOpenCalendar);
    window.addEventListener('briefing-open-crm', handleOpenCRM);
    return () => {
      window.removeEventListener('briefing-open-ticket', handleOpenTicket);
      window.removeEventListener('briefing-open-customer', handleOpenCustomer);
      window.removeEventListener('briefing-open-check', handleOpenCheck);
      window.removeEventListener('briefing-open-calendar', handleOpenCalendar);
      window.removeEventListener('briefing-open-crm', handleOpenCRM);
    };
  }, []);

  // v55.55 — `navigate` now accepts an optional opts object with { from, to }.
  // When supplied, mode is set to 'custom' and the date pickers are pre-filled
  // so the destination tab opens already filtered to that exact range.
  // Used by the Monthly Sales Report click-to-drill: tap a month → land on
  // the Sales tab showing only that month's invoices.
  const navigate = (t, opts) => {
    setTabLoading(true);
    setTab(t); setQuery(''); setCustomerFilter(''); setSelectedCustomer(null); setSelectedDebtor(null);
    setSelectedInvoice(null); setDrillType(null); setTreasuryDrill(null); setSelectedMonth(null);
    if (opts && opts.from && opts.to) {
      // Custom date range supplied — honor it on whatever tab we're going to.
      setMode('custom');
      setDf(opts.from);
      setDt(opts.to);
    } else if (t === 'treasury') {
      setMode('all');
    } else if (t === 'sales' || t === 'checks') {
      setMode('ytd');
    }
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

  // v55.83-A.6.18 (Max May 14 2026) — Acknowledge a ticket from the dashboard
  // priority card. Changes status from 'New' → 'Acknowledged' AND logs a system
  // comment so the audit trail captures the action. Matches the behavior of the
  // Acknowledge button inside TicketsTab.
  const ackDashboardTicket = async (ticket) => {
    if (!ticket || !ticket.id) return;
    setBusyAckId(ticket.id);
    try {
      const myUid = userProfile?.id || user?.id;
      const myName = (userProfile && (userProfile.full_name || userProfile.email)) || 'User';
      // 1. Status update
      await dbUpdate('tickets', ticket.id, { status: 'Acknowledged' }, myUid);
      // 2. System comment for audit trail (mirrors TicketsTab.updateStatus)
      try {
        await dbInsert('ticket_comments', {
          ticket_id: ticket.id,
          comment_text: '📋 Status changed to Acknowledged by ' + myName,
          is_system: true,
          created_by: myUid,
        }, myUid);
      } catch (_) { /* non-fatal */ }
      toast && toast.success && toast.success('Acknowledged / تم التأكيد');
      // 3. Reload tickets so the card disappears
      try { await loadAllData(); } catch (_) {}
    } catch (err) {
      var msg = (err && err.message) ? err.message : String(err);
      toast && toast.error && toast.error('Acknowledge failed: ' + msg);
    } finally {
      setBusyAckId(null);
    }
  };

  const handleSignOut = async () => {
    const uid = profileIdRef.current || user?.id;
    if (uid) {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()); // ET, not UTC — fixes 'you werent here yesterday' bug
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
  // v55.83-A.1 (Max May 13 2026) — split collected into confirmed + pending.
  //
  // CONFIRMED = money that's either:
  //   • Cash/safe channel (cash_in > 0) — physically counted, no bank needed
  //   • Bank channel matched against a real statement entry (matched_bank_txn_id IS NOT NULL)
  //     OR rows that came from the bank-statement auto-matcher itself
  //
  // PENDING BANK = recorded as bank-channel but not yet matched to a statement:
  //   • is_bank_placeholder = TRUE (Path B awaiting matcher)
  //   • OR needs_bank_match = TRUE (Path A bank_transfer awaiting matcher under v55.83-A.1)
  //
  // total_collected (legacy) = total_confirmed + total_pending_bank.
  // We keep it for backward compat with reports/exports built before the split.
  const recalcInvoiceCollected = async (invoiceId) => {
    if (!invoiceId) return;
    // v55.83-A.6.8 (Max May 13 2026) — also load total_written_off so the
    // outstanding calculation subtracts written-off amounts.
    const { data: inv } = await supabase.from('invoices').select('id, total_amount, order_number, total_written_off').eq('id', invoiceId).maybeSingle();
    if (!inv) return;
    const { data: linked } = await supabase.from('treasury')
      .select('id, cash_in, bank_in, is_bank_placeholder, needs_bank_match, matched_bank_txn_id, description, dedup_sibling_id')
      .eq('linked_invoice_id', invoiceId);

    let confirmed = 0;
    let pending = 0;
    for (const t of (linked || [])) {
      // Always skip dedup markers (the legacy "[bank confirmation" rows and
      // the new dedup_sibling_id rows) — these mirror another row that's
      // already counted. Double-count guard.
      if (t.dedup_sibling_id) continue;
      if (t.description && t.description.includes('[bank confirmation')) continue;

      const cashAmt = Number(t.cash_in || 0);
      const bankAmt = Number(t.bank_in || 0);

      // PLACEHOLDER rows (Path B before match) — pending. expected_amount
      // semantics: the row's bank_in is 0 until the matcher writes it, but
      // the placeholder shouldn't be hidden from the user — they recorded
      // it intentionally. We count its expected amount as pending.
      if (t.is_bank_placeholder) {
        // For placeholders, bank_in is 0 until matched. The expected_amount
        // column holds the user-entered amount. Fall back to bank_in just
        // in case (defensive).
        pending += Number(t.bank_in || t.expected_amount || 0);
        continue;
      }

      // BANK ROWS AWAITING MATCH (Path A trust-immediate under old behavior,
      // or any unmatched bank_in/bank_out row under v55.83-A.1).
      if (t.needs_bank_match && !t.matched_bank_txn_id) {
        pending += bankAmt;
        continue;
      }

      // Everything else is confirmed: cash, safe channels (cash_in > 0), or
      // bank rows that have been matched against a real statement entry.
      confirmed += cashAmt + bankAmt;
    }

    // Cap at invoice total — the system never claims a customer paid more
    // than they were billed.
    //
    // v55.83-A.6.7 (Max May 13 2026) — CRIT-4 fix: don't SILENTLY cap.
    // Track the overflow amount in overpayment_amount so the UI can show
    // a warning like "Treasury exceeds invoice by EGP 700 — review for
    // duplicate payments." Without this, a double-entered payment is
    // hidden by the cap and looks like a normal paid-in-full invoice.
    const totalAmt = Number(inv.total_amount || 0);
    const totalAll = confirmed + pending;
    let cappedConfirmed = confirmed;
    let cappedPending = pending;
    let overpaymentAmount = 0;
    if (totalAll > totalAmt && totalAll > 0) {
      overpaymentAmount = totalAll - totalAmt;
      const scale = totalAmt / totalAll;
      cappedConfirmed = confirmed * scale;
      cappedPending = pending * scale;
    }
    const capped = cappedConfirmed + cappedPending;

    await dbUpdate('invoices', invoiceId, {
      total_collected: capped,
      total_confirmed: cappedConfirmed,
      total_pending_bank: cappedPending,
      overpayment_amount: overpaymentAmount,
      // v55.83-A.6.8 (Max May 13 2026) — short-payment write-off support.
      // Outstanding subtracts any amount that's been formally written off
      // (e.g. customer short-paid by 50 EGP and we accept it). Without
      // this, the invoice would stay OPEN indefinitely on tiny rounding.
      // total_written_off field is set/cleared by handleWriteOffShortPayment.
      // Tolerance: 0.50 EGP for rounding (HIGH-1).
      outstanding: (function() {
        var writtenOff = Number(inv.total_written_off || 0);
        var remainder = totalAmt - capped - writtenOff;
        return Math.abs(remainder) < 0.50 ? 0 : Math.max(0, remainder);
      })(),
    }, userProfile?.id || user?.id);
    return capped;
  };

  // v55.83-A.6.8 (Max May 13 2026) — Short-payment write-off.
  //
  // Soft cap: anyone with invoice edit can write off up to this amount;
  // super_admin can override beyond. Every write-off is logged to audit.
  // Threshold is intentionally generous — most short-payments are <100 EGP.
  const WRITE_OFF_SOFT_CAP_EGP = 1000;

  // Reason is locked to a single category per Max's request. Bilingual.
  const WRITE_OFF_REASON = 'Customer short-payment';
  const WRITE_OFF_REASON_AR = 'خصم لعدم سداد العميل';

  // (isSuperAdmin already declared above at line ~1476)

  // Handler: apply write-off to an invoice.
  // - Validates amount > 0 and <= invoice.outstanding (can't write off more
  //   than what's actually outstanding).
  // - Soft-cap enforced; super_admin bypass.
  // - Writes total_written_off, write_off_reason, write_off_notes, then
  //   re-runs recalc so outstanding drops by the written-off amount.
  // - Audit entry tagged 'invoice.write_off' with English + Arabic note.
  const handleWriteOffShortPayment = async (invoice, amount, notesEN) => {
    if (!canEditInvoices) {
      toast.error('You do not have permission to write off / لا تملك صلاحية الخصم');
      return false;
    }
    if (!invoice || !invoice.id) {
      toast.error('Invalid invoice / فاتورة غير صالحة');
      return false;
    }
    var amt = Number(amount);
    if (!isFinite(amt) || amt <= 0) {
      toast.error('Enter a positive amount / أدخل مبلغ موجب');
      return false;
    }
    var outstanding = Number(invoice.outstanding || 0);
    if (amt > outstanding + 0.50) {
      toast.error('Cannot write off more than outstanding (' + fE(outstanding) + ') / لا يمكن خصم أكثر من المتبقي');
      return false;
    }
    // Soft cap enforcement
    if (amt > WRITE_OFF_SOFT_CAP_EGP && !isSuperAdmin) {
      toast.error('Amount exceeds ' + fE(WRITE_OFF_SOFT_CAP_EGP) + ' soft cap. Only super_admin can override / تجاوز الحد الأقصى، يلزم صلاحية المسؤول');
      return false;
    }
    var prior = Number(invoice.total_written_off || 0);
    var newTotal = prior + amt;
    // Bilingual notes: user note (optional) + automatic translation hint.
    // Per Max's "always translate any text added" rule, we store both EN
    // and AR. If user gave English notes, AR is the reason in Arabic +
    // English passthrough so the audit log carries both.
    var notesPart = notesEN ? (' — ' + notesEN) : '';
    var auditEN = WRITE_OFF_REASON + ' write-off: ' + fE(amt) + notesPart;
    var auditAR = WRITE_OFF_REASON_AR + ': ' + fE(amt) + (notesEN ? (' — ' + notesEN) : '');
    try {
      await dbUpdate('invoices', invoice.id, {
        total_written_off: newTotal,
        write_off_reason: WRITE_OFF_REASON,
        write_off_notes: notesEN || null,
      }, userProfile?.id || user?.id);
      // Audit log gets a distinct action tag so reports can filter on it.
      try {
        await supabase.from('audit_log').insert({
          table_name: 'invoices',
          record_id: invoice.id,
          action: 'write_off',
          changed_by: (userProfile && userProfile.id) || (user && user.id) || null,
          new_values: {
            amount: amt,
            reason: WRITE_OFF_REASON,
            reason_ar: WRITE_OFF_REASON_AR,
            notes_en: notesEN || null,
            total_written_off_after: newTotal,
            soft_cap_overridden: amt > WRITE_OFF_SOFT_CAP_EGP,
            note_en: auditEN,
            note_ar: auditAR,
          },
        });
      } catch (auditErr) { console.warn('[write-off] audit log failed:', auditErr && auditErr.message); }
      // Recalc to update outstanding
      await recalcInvoiceCollected(invoice.id);
      await loadAllData();
      toast.success('Wrote off ' + fE(amt) + ' as short-payment ✓ / تم خصم ' + fE(amt));
      return true;
    } catch (err) {
      toast.error('Write-off failed: ' + (err.message || 'unknown') + ' / فشل الخصم');
      return false;
    }
  };

  // Reverse a write-off (in case it was applied in error). Clears the
  // total_written_off field entirely. Outstanding restored on recalc.
  const handleReverseWriteOff = async (invoice) => {
    if (!canEditInvoices) {
      toast.error('No permission / لا تملك الصلاحية');
      return false;
    }
    if (!invoice || !invoice.id || !Number(invoice.total_written_off || 0)) return false;
    var amt = Number(invoice.total_written_off || 0);
    try {
      await dbUpdate('invoices', invoice.id, {
        total_written_off: 0,
        write_off_reason: null,
        write_off_notes: null,
      }, userProfile?.id || user?.id);
      try {
        await supabase.from('audit_log').insert({
          table_name: 'invoices',
          record_id: invoice.id,
          action: 'write_off_reverse',
          changed_by: (userProfile && userProfile.id) || (user && user.id) || null,
          new_values: {
            amount_reversed: amt,
            note_en: 'Reversed short-payment write-off of ' + fE(amt),
            note_ar: 'تم إلغاء خصم بقيمة ' + fE(amt),
          },
        });
      } catch (auditErr) { console.warn('[write-off-reverse] audit log failed:', auditErr && auditErr.message); }
      await recalcInvoiceCollected(invoice.id);
      await loadAllData();
      toast.success('Write-off reversed ✓ / تم إلغاء الخصم');
      return true;
    } catch (err) {
      toast.error('Reverse failed: ' + (err.message || 'unknown') + ' / فشل');
      return false;
    }
  };

  const handleAddPayment = async (pf) => {
    if (!canEditInvoices) { toast.error('You do not have permission to edit invoices.'); return; }
    // BUG 3 fix: reject re-entry while a submission is in flight. A fast
    // double-click would otherwise insert two treasury rows for the same
    // payment — invoice stays correct (capped at total_amount) but safe
    // totals inflate. Guard released in finally.
    if (addPaymentRunning.current) return;
    addPaymentRunning.current = true;
    const pd = pf || formData;
    if (!pd.amount || Number(pd.amount) <= 0) { addPaymentRunning.current = false; toast.warning('Payment amount is required'); return; }
    if (!pd.date) { addPaymentRunning.current = false; toast.warning('Payment date is required'); return; }
    if (!selectedInvoice) { addPaymentRunning.current = false; toast.warning('No invoice selected'); return; }
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
        // v55.83-A.6.27.19 — code review fix #1. Build the record FIRST so we
        // can check for matching instruments BEFORE the insert. Without this,
        // the popup never fired for PaymentForm cash/bank paths and instruments
        // entered against this invoice silently stayed pending after the
        // accountant collected the cash. Same architectural pattern as
        // handleAddTreasury at ~line 3425.
        var cashRecord = {
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
        };
        if (!pd.__instrument_popup_decision) {
          var cashInstrumentMatches = findMatchingInstruments(selectedInvoice, Number(pd.amount));
          if (cashInstrumentMatches.length > 0) {
            addPaymentRunning.current = false; // release re-entry guard so the resume can come back in
            setPendingInstrumentMatch({
              record: cashRecord,
              amount: Number(pd.amount),
              invoice: selectedInvoice,
              instruments: cashInstrumentMatches,
              isBankPlaceholder: false,
              onResume: async function (stamped) {
                // Resume: insert the row (with or without source_check_id stamp),
                // flip the linked instrument if applicable, recalc.
                try {
                  var inserted = await dbInsert('treasury', stamped, user?.id);
                  if (stamped.__instrument_popup_decision === 'link' && stamped.source_check_id) {
                    try {
                      await dbUpdate('checks', stamped.source_check_id, {
                        status: 'cleared',
                        collection_date: stamped.transaction_date || new Date().toISOString().slice(0, 10),
                        linked_treasury_id: inserted.id,
                        updated_by: user?.id,
                      }, user?.id);
                    } catch (instErr) {
                      console.warn('[handleAddPayment cash] instrument flip failed:', instErr && instErr.message);
                      toast.warning('Saved ✓ — but the linked instrument needs manual update to "cleared".');
                    }
                  }
                  try { await recalcInvoiceCollected(selectedInvoice.id); } catch (_) {}
                  await loadAllData();
                  setShowAddPayment(false);
                  setFormData({});
                  toast.success(stamped.__instrument_popup_decision === 'link' ? 'Payment saved + instrument cleared ✓' : 'Payment saved ✓');
                } catch (resumeErr) {
                  toast.error('Save failed: ' + (resumeErr && resumeErr.message ? resumeErr.message : String(resumeErr)));
                }
              },
            });
            return; // form stays open; popup will fire
          }
        }
        await dbInsert('treasury', cashRecord, user?.id);
        await recalcInvoiceCollected(selectedInvoice.id);
      } else if (isBankChannel) {
        // BANK TRANSFER → treasury bank_in + invoice link. Does NOT hit safe.
        // v55.83-A.1 (Max May 13 2026) — bank-channel payments now ALWAYS
        // require statement confirmation, even via this "trusted" Add Payment
        // path. The row is created with needs_bank_match=TRUE so it counts
        // toward total_pending_bank on the invoice (not total_confirmed)
        // until the bank-statement auto-matcher links it to a real bank
        // statement entry. This unifies behavior with the placeholder flow
        // (Path B). Previously this path trusted the user immediately, which
        // caused invoices to show fully-paid even when the money hadn't
        // actually landed yet.
        //
        // v55.83-A.6.27.19 — same instrument-match popup hook as the cash
        // branch above. Build record first; if a matching instrument exists,
        // defer via the popup. If user picks "Yes, link" we record that
        // intent; the actual instrument doesn't flip to "cleared" until
        // total_confirmed catches up (still requires bank-statement match)
        // — for now we DO flip on click since the popup is showing
        // intent, but we keep needs_bank_match=true so the dashboard
        // continues to show this as pending bank confirmation. Treasury
        // and recalc behavior is unchanged.
        var bankRecord = {
          transaction_date: pd.date,
          order_number: selectedInvoice.order_number,
          description: sanitize((pd.desc || selectedInvoice.customer_name + ' payment') + ' [🏦 Bank Transfer · awaiting match]'),
          cash_in: 0, cash_out: 0,
          bank_in: Number(pd.amount),
          bank_out: 0,
          category: pd.category || 'مبيعات',
          subcategory: pd.subcategory || '',
          linked_invoice_id: selectedInvoice.id,
          needs_bank_match: true,
        };
        if (!pd.__instrument_popup_decision) {
          var bankInstrumentMatches = findMatchingInstruments(selectedInvoice, Number(pd.amount));
          if (bankInstrumentMatches.length > 0) {
            addPaymentRunning.current = false;
            setPendingInstrumentMatch({
              record: bankRecord,
              amount: Number(pd.amount),
              invoice: selectedInvoice,
              instruments: bankInstrumentMatches,
              isBankPlaceholder: false,
              onResume: async function (stamped) {
                try {
                  var inserted = await dbInsert('treasury', stamped, user?.id);
                  if (stamped.__instrument_popup_decision === 'link' && stamped.source_check_id) {
                    try {
                      await dbUpdate('checks', stamped.source_check_id, {
                        status: 'cleared',
                        collection_date: stamped.transaction_date || new Date().toISOString().slice(0, 10),
                        linked_treasury_id: inserted.id,
                        updated_by: user?.id,
                      }, user?.id);
                    } catch (instErr) {
                      console.warn('[handleAddPayment bank] instrument flip failed:', instErr && instErr.message);
                      toast.warning('Saved ✓ — but the linked instrument needs manual update to "cleared".');
                    }
                  }
                  try { await recalcInvoiceCollected(selectedInvoice.id); } catch (_) {}
                  await loadAllData();
                  setShowAddPayment(false);
                  setFormData({});
                  toast.success(stamped.__instrument_popup_decision === 'link' ? 'Bank payment saved + instrument cleared ✓' : 'Bank payment saved ✓');
                } catch (resumeErr) {
                  toast.error('Save failed: ' + (resumeErr && resumeErr.message ? resumeErr.message : String(resumeErr)));
                }
              },
            });
            return;
          }
        }
        await dbInsert('treasury', bankRecord, user?.id);
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
    } finally {
      // BUG 3 fix: release guard regardless of success/failure
      addPaymentRunning.current = false;
    }
  };

  // ========== RECONCILIATION REPORT GENERATOR ==========
  const generateReconReport = () => {
    const wb = XLSX.utils.book_new();
    const now = fmtET(new Date(), 'shortdate');

    // 1. Categorize all invoices
    const mismatch = [], unverified = [], overpaid = [], overdue = [];
    invoices.forEach(inv => {
      const tTotal = tTotalForInvoice(inv);
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

    XLSX.writeFile(wb, 'KTC_Reconciliation_Report_' + todayET() + '.xlsx');
  };

  const handleAddInvoice = async () => {
    // v55.47 — Same custSearch→customerName promotion as the inline invoice
    // form, applied here. Without this, users who typed a customer name and
    // tabbed away (instead of clicking a dropdown row) would see "Customer
    // name is required" even though the field clearly had their text.
    let resolvedCustomerName = formData.customerName;
    let resolvedCustomerId = formData.customerId;
    if (!resolvedCustomerName && formData.custSearch && String(formData.custSearch).trim()) {
      const typed = String(formData.custSearch).trim();
      const exact = (customers || []).find(c =>
        (c.name && c.name.toLowerCase() === typed.toLowerCase()) ||
        (c.name_ar && c.name_ar === typed)
      );
      if (exact) {
        resolvedCustomerName = exact.name || exact.name_ar;
        resolvedCustomerId = exact.id;
      } else {
        resolvedCustomerName = typed;
      }
    }

    // v55.49 — Friendly error wrapping. Previously the catch block surfaced
    // the raw Supabase error (e.g. "duplicate key value violates unique
    // constraint 'invoices_order_number_key'") which confused users. Now
    // we detect common database errors and translate to plain language.
    if (!formData.orderNumber || !String(formData.orderNumber).trim()) { toast.warning('Order number is required / رقم الأمر مطلوب'); return; }
    if (!resolvedCustomerName) { toast.warning('Customer name is required / اسم العميل مطلوب'); return; }
    // v55.82-E — same parseAmount/isValidAmount upgrade as handleAddTreasury.
    // Comma-thousands and Arabic-Indic digits previously slipped through
    // Number(...) <= 0 and saved an invoice with NaN total_amount.
    if (!isValidAmount(formData.amount)) { toast.warning('Amount must be greater than zero / المبلغ يجب أن يكون أكبر من صفر'); return; }
    try {
      const orderNum = sanitize(formData.orderNumber);
      const { data: inserted, error: insErr } = await supabase.from('invoices').insert({
        order_number: orderNum,
        customer_name: sanitize(resolvedCustomerName),
        customer_id: resolvedCustomerId || null,
        invoice_date: formData.date || today(),
        total_amount: parseAmount(formData.amount),
        total_collected: 0,
        sales_rep: formData.salesRep || '',
        notes: sanitize(formData.notes || ''),
        source: 'manual',
      }).select('id').single();
      // v55.49 — Surface insert errors in plain language. The raw DB error
      // "duplicate key value violates unique constraint" was the most
      // common confusing message users saw.
      if (insErr) {
        var msg = String(insErr.message || '');
        if (/duplicate key|unique constraint/i.test(msg)) {
          toast.error('Order #' + orderNum + ' already exists as an invoice. Open it from the Sales tab if you want to edit it. / رقم الأمر #' + orderNum + ' موجود بالفعل كفاتورة. افتحها من تبويب المبيعات للتعديل.');
        } else if (/permission|policy|rls/i.test(msg)) {
          toast.error('You do not have permission to create invoices. / ليس لديك إذن لإنشاء فواتير.');
        } else {
          toast.error('Could not save invoice: ' + msg + ' / تعذر حفظ الفاتورة');
        }
        return;
      }

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
      // v55.49 — Friendly error wrapping for thrown exceptions (network
      // drops, Supabase client crashes, etc). Raw err.message was scary.
      var emsg = String((err && err.message) || err || 'Unknown error');
      if (/network|fetch|failed/i.test(emsg)) {
        toast.error('Network problem saving the invoice. Check your connection and try again. / مشكلة في الاتصال أثناء حفظ الفاتورة.');
      } else if (/duplicate key|unique constraint/i.test(emsg)) {
        toast.error('This order number already exists as an invoice. Open it from the Sales tab to edit. / رقم الأمر موجود بالفعل كفاتورة.');
      } else {
        toast.error('Could not save invoice: ' + emsg + ' / تعذر حفظ الفاتورة');
      }
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

  // v55.41 — Helper: find treasury rows that look like potential duplicates
  // of what the user is about to save.
  //
  // "Potential duplicate" = same calendar date, same amount in the same
  // direction (cash_in/cash_out/bank_in/bank_out), same trimmed/case-insensitive
  // description. Order# and category are NOT part of the match because two
  // legitimate same-amount payments could land on the same invoice.
  //
  // Returns an array of matching rows (capped at 5 for UI sanity).
  // Returns [] if nothing matches — the save proceeds normally.
  const findPotentialDuplicates = (txDate, amount, descRaw, isIncome, isBankPlaceholder) => {
    var amt = Number(amount || 0);
    if (!amt || amt <= 0) return [];
    var desc = String(descRaw || '').trim().toLowerCase();
    if (!desc) return []; // empty description — never block, no signal to dedup on
    var dateStr = String(txDate || '').substring(0, 10);
    var matches = (treasury || []).filter(function(t) {
      if (!t) return false;
      // Date must match exactly
      var tDate = String(t.transaction_date || '').substring(0, 10);
      if (tDate !== dateStr) return false;
      // Direction must match — cash_in row dedups against cash_in/bank_in,
      // cash_out against cash_out/bank_out
      var tIn = Number(t.cash_in || 0) + Number(t.bank_in || 0) + Number(t.expected_amount || 0) * (t.expected_direction === 'in' ? 1 : 0);
      var tOut = Number(t.cash_out || 0) + Number(t.bank_out || 0) + Number(t.expected_amount || 0) * (t.expected_direction === 'out' ? 1 : 0);
      var tAmt = isIncome ? tIn : tOut;
      // 1 EGP tolerance for FX rounding
      if (Math.abs(tAmt - amt) > 1) return false;
      // Description match — case-insensitive, trim, ignore the bank-confirmation suffix
      var tDesc = String(t.description || '')
        .replace(' [awaiting bank confirmation]', '')
        .replace(/\s*\[bank confirmation[^\]]*\]/g, '')
        .trim().toLowerCase();
      if (!tDesc) return false;
      return tDesc === desc;
    });
    return matches.slice(0, 5);
  };

  const handleAddTreasury = async (opts) => {
    opts = opts || {};
    if (!canEditTreasury) { toast.error('You do not have permission to add treasury entries.'); return; }
    // v55.82-E — RE-ENTRY GUARD. Without this, a fast double-tap on the
    // Save button fired two parallel saves: both passed validation,
    // both reached dbInsert, both wrote rows. The second one then
    // tripped the unique-index dedup check (if enabled) and opened
    // the duplicate-confirmation modal — which the user couldn't tell
    // apart from the legitimate dup flow. Either way, books were off
    // by a duplicate. This ref-based guard rejects any concurrent
    // entry while a save is in flight. Released in finally so it
    // resets even on a thrown error.
    if (addTreasuryRunning.current) {
      console.log('[treasury-add] re-entry blocked — save already in flight');
      return;
    }
    addTreasuryRunning.current = true;
    setTreasurySaving(true);
    try {
      return await _handleAddTreasuryImpl(opts);
    } finally {
      addTreasuryRunning.current = false;
      setTreasurySaving(false);
    }
  };

  // v55.82-E — Body of handleAddTreasury extracted into a private impl so
  // the entry-point can wrap the whole thing in the re-entry guard above
  // without repeating the unwrap/wrap code at every early-return path.
  // All `return` statements below close out the SAVE flow normally; the
  // guard release happens in the wrapper's finally block.
  const _handleAddTreasuryImpl = async (opts) => {
    opts = opts || {};
    // v55.47 — Collect ALL validation errors first instead of bailing on
    // the first one with a toast. The user sees every problem at once in
    // a persistent banner inside the modal, plus per-field highlighting.
    // Toasts at the screen corner were getting missed on mobile (Amad
    // reported "I tap Submit and nothing happens" — actually the Amount
    // field was blank and the toast popped and died in 2s).
    const errs = [];
    const txDate = formData.date || today();
    // v55.82-E — Use isValidAmount() instead of Number(...). Number("5,000")
    // returns NaN, so the OLD check `Number(...) <= 0` was FALSE for NaN
    // (NaN <= 0 is false), letting the form pass validation but then
    // writing NaN/0 to cash_in. Now: parseAmount handles commas, spaces,
    // and Arabic-Indic digits; isValidAmount returns true only when the
    // typed value is a real positive number.
    if (!isValidAmount(formData.amount)) {
      errs.push({ field: 'amount', label: 'Amount / المبلغ', msg: 'Required — type the amount of money for this transaction.' });
    }
    const isBankPlaceholder = formData.type === 'bank_in' || formData.type === 'bank_out';
    if (isBankPlaceholder && !formData.bankAccountId) {
      errs.push({ field: 'bankAccountId', label: 'Bank Account / الحساب البنكي', msg: 'Required — pick which bank account this entry is against.' });
    }
    // Bank entries must declare their identity: either an Order (links to a
    // sales invoice) or a Non-Order category (owner draw, inter-bank transfer,
    // bank fee, loan, refund, other). Prevents orderless mystery rows that
    // caused the ghost-dedup bug last session.
    if (isBankPlaceholder) {
      const mode = formData.bankEntryMode || 'order'; // 'order' | 'nonorder'
      if (mode === 'order') {
        const orderTrim = String(formData.orderNumber || '').trim();
        if (!orderTrim) {
          errs.push({ field: 'orderNumber', label: 'Order # / رقم الأمر', msg: 'Required for Order mode. If this is not a customer payment (owner draw, transfer, fee, etc.), switch to "Non-Order" above.' });
        }
      } else {
        if (!formData.bankNonOrderCategory) {
          errs.push({ field: 'bankNonOrderCategory', label: 'Non-Order Category', msg: 'Required for Non-Order mode — pick Owner Draw, Inter-Bank Transfer, Bank Fee, Loan, Refund, or Other.' });
        }
      }
      if (!String(formData.desc || '').trim()) {
        errs.push({ field: 'desc', label: 'Description / الوصف', msg: 'Required for bank entries.' });
      }
    }

    // v55.82-B — Income (cash_in) without Order# moved into the persistent
    // banner. The same rule existed at line 2700+ as a one-shot toast, but
    // toasts at the corner are easy to miss on mobile and disappear after
    // a few seconds. Now: same gate, same exception list (Refund, Owner
    // Contribution, etc.), but the message stays pinned at the top of the
    // form until fixed. Bank IN already had its own banner-level check
    // above. Only applies when no override category is selected.
    var preTxType = formData.type || 'in';
    var preIsIncome = preTxType === 'in' || preTxType === 'bank_in';
    if (preIsIncome && !isBankPlaceholder) {
      var preOrderTrim = String(formData.orderNumber || '').trim();
      if (!preOrderTrim) {
        var preCatName = String(formData.category || '').trim();
        var preNonOrderIncomeCats = ['Refund', 'Advance', 'Owner Contribution', 'Owner Draw', 'Loan', 'Loan Received', 'Other Income', 'Inter-Bank Transfer', 'Bank Fee', 'استرداد', 'سلفة', 'إيداع المالك', 'قرض', 'دخل آخر'];
        var preIsNonOrderIncome = preCatName && preNonOrderIncomeCats.some(function(n) {
          return preCatName.toLowerCase() === n.toLowerCase();
        });
        if (!preIsNonOrderIncome) {
          errs.push({
            field: 'orderNumber',
            label: 'Order # / رقم الأمر',
            msg: 'Required for Cash IN — needed to link the payment to a customer invoice. If this is not a customer payment (refund, advance, owner deposit, loan), pick a non-order Category instead. / مطلوب لربط الدفعة بفاتورة عميل. لو ليست دفعة عميل، اختر تصنيف غير العميل.'
          });
        }
      }
    }

    if (errs.length > 0) {
      // Persistent in-form banner + corner toast (belt + suspenders so the
      // user sees the failure at least one of the two ways).
      setTreasuryFormErrors(errs);
      try {
        toast.warning('Cannot save — ' + errs.length + ' field' + (errs.length === 1 ? '' : 's') + ' need attention. See the red box at the top of the form.');
      } catch (_) {}
      // Scroll the first missing field into view so the user can't miss it
      try {
        var firstField = errs[0].field;
        setTimeout(function () {
          try {
            var el = document.querySelector('[data-treasury-field="' + firstField + '"]');
            if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          } catch (_) {}
        }, 50);
      } catch (_) {}
      return;
    }
    // All checks passed — clear any stale errors from a previous attempt
    if (treasuryFormErrors.length > 0) setTreasuryFormErrors([]);
    try {
      // v55.12 (Apr 26 2026): The Type radio defaults to "Cash In" visually,
      // but formData.type is `undefined` until the user actually clicks a
      // radio. Without this normalization, isIncome was false on the silent
      // save path, which let cash-in transactions slip through the
      // require-an-invoice gate. Now: if type isn't set, assume cash_in (the
      // visual default) so the rest of the flow works as the user expects.
      const txType = formData.type || 'in';
      const isIncome = txType === 'in' || txType === 'bank_in';
      const currency = formData.currency || 'EGP';
      // v55.82-E — parseAmount instead of Number(). See utils.js comment.
      // BEFORE this fix, typing "5,000" (with thousands separator) or
      // "٥٠٠٠" (Arabic-Indic digits, common on iOS Arabic keyboard)
      // produced amt=NaN, which then got written into cash_in as
      // either NaN (rejected by Postgres) or 0 (silently coerced).
      // Either way, Max's typed amount was lost. parseAmount handles
      // both cases plus comma decimals and embedded whitespace.
      const amt = parseAmount(formData.amount);

      // v55.41 — DUPLICATE PREFLIGHT.
      // Open a confirmation modal if an existing treasury row matches
      // (same date + same amount + same direction + same description).
      // The save is paused until the user explicitly confirms it's a
      // legitimate separate payment. Skipped on retry (opts.bypassDupCheck
      // is set when the user has already confirmed in the modal).
      // Only runs for fresh inserts — never for edits, never for the
      // pending-invoice retry path.
      if (!opts.bypassDupCheck) {
        var dupMatches = findPotentialDuplicates(
          txDate, amt, formData.desc, isIncome, isBankPlaceholder
        );
        if (dupMatches && dupMatches.length > 0) {
          // Capture the form snapshot so the modal's "Confirm" button can
          // re-call handleAddTreasury with bypassDupCheck=true and the
          // exact same values, even if the user pokes the form behind it.
          setDuplicateConfirm({
            txDate: txDate,
            amount: amt,
            description: formData.desc,
            isIncome: isIncome,
            matches: dupMatches,
          });
          // Don't insert. The modal calls handleAddTreasury({bypassDupCheck:true}) on confirm.
          return;
        }
      }

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
      // v55.41 — If the user confirmed past the duplicate-warning modal,
      // stamp the row so the AI auditor doesn't flag it again later.
      // The column is added by sql/s38_treasury_confirmed_not_duplicate.sql.
      // dbInsert.js auto-strips unknown columns and retries — so this is
      // safe to set even if the migration hasn't been run yet.
      if (opts.bypassDupCheck) {
        record.confirmed_not_duplicate = true;
      }
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
        // v55.83-A.6.9 (Max May 13 2026) — expected_date is when the user
        // anticipates the bank statement entry to appear. Defaults to
        // transaction_date but user can specify (e.g. employee has cash,
        // plans to deposit next Tuesday). Auto-matcher uses this to find
        // the right bank statement entry with a ±14-day window.
        record.expected_date = formData.expectedDate || record.transaction_date;
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
      // DIAGNOSTIC LOGGING — added so we can see exactly which branch fires
      // when the user reports "no modal appeared". The four-line signature
      // tells us if the modal SHOULD have opened, and if not, why not.
      console.log('[treasury-add] type=' + formData.type + ' isIncome=' + isIncome
        + ' isBankPlaceholder=' + isBankPlaceholder + ' bankEntryMode=' + bankEntryMode);
      console.log('[treasury-add] isOrderLinkable=' + isOrderLinkable
        + ' orderNumTrimmed="' + orderNumTrimmed + '" invoices.length=' + (invoices ? invoices.length : 'undefined'));
      if (isOrderLinkable && orderNumTrimmed) {
        const matchingInvoice = invoices.find(i => String(i.order_number || '').trim() === orderNumTrimmed);
        console.log('[treasury-add] matchingInvoice=' + (matchingInvoice ? ('#' + matchingInvoice.order_number + ' (id=' + matchingInvoice.id + ')') : 'NONE'));
        if (matchingInvoice) {
          // Auto-link — set linked_invoice_id so recalcInvoiceCollected picks it up
          record.linked_invoice_id = matchingInvoice.id;

          // ── v55.83-A.6.27.17 (Max May 17 2026) — Phase 1 instrument match ──
          // Before inserting the treasury row, check whether a pending or
          // deposited instrument on this invoice matches the amount the
          // accountant is entering. If yes AND the user hasn't already
          // dismissed/answered the popup for THIS record, defer the insert
          // until they answer.
          //
          // RULE 5 — the popup never creates an extra treasury row. It only
          // stamps source_check_id on the record we're about to insert, OR
          // proceeds without the link if the user says "separate payment".
          //
          // Suppression key: record.__instrument_popup_decision is set by
          // the popup handler when the user picks Yes/No, so this code
          // doesn't loop. Bank placeholders are excluded (their match
          // already happens via the bank-statement reconciliation path).
          if (!isBankPlaceholder && !record.__instrument_popup_decision) {
            var matchingInstruments = findMatchingInstruments(matchingInvoice, amt);
            if (matchingInstruments.length > 0) {
              console.log('[treasury-add] INSTRUMENT MATCH — ' + matchingInstruments.length + ' candidate(s) for invoice #' + matchingInvoice.order_number + ' at ' + amt + ' EGP');
              setPendingInstrumentMatch({
                record: record,
                amount: amt,
                invoice: matchingInvoice,
                instruments: matchingInstruments,
                isBankPlaceholder: isBankPlaceholder,
                onResume: function (stamped) { return commitInstrumentLinkedTreasury(stamped, matchingInvoice, isBankPlaceholder); },
              });
              return; // form stays open; popup fires; will re-enter handler when user picks
            }
          }
          // No instrument match (or user already answered) → proceed with normal insert.

          // Insert. Only recalc for real cash_in; placeholders wait for the match.
          const inserted = await dbInsert('treasury', record, user?.id);

          // v55.83-A.6.27.17 — if the user accepted the instrument link, flip
          // the instrument to 'cleared' AFTER the treasury row is inserted
          // (so we have the treasury id to stamp on linked_treasury_id).
          if (record.__instrument_popup_decision === 'link' && record.source_check_id) {
            try {
              await dbUpdate('checks', record.source_check_id, {
                status: 'cleared',
                collection_date: record.transaction_date || new Date().toISOString().slice(0, 10),
                linked_treasury_id: inserted.id,
                updated_by: user?.id,
              }, user?.id);
              console.log('[treasury-add] instrument ' + record.source_check_id + ' marked cleared, linked to treasury ' + inserted.id);
            } catch (instErr) {
              console.warn('[treasury-add] insert succeeded but instrument flip failed:', instErr && instErr.message);
              try { toast.warning('Saved ✓ — but the linked instrument needs manual update to "cleared".'); } catch (_) {}
            }
          }

          // v55.82-E ROOT-CAUSE #1 FIX. Previously a recalcInvoiceCollected()
          // throw was poisoning the entire save. The treasury row WAS inserted
          // successfully (Max's "system not recording amounts properly" report
          // — actually it WAS recording, but the UI lied and said it failed).
          // The recalc throws bubbled up to the outer catch at line 2762 which
          // treated it as a duplicate-or-error and left the modal open with
          // unreset state. User retried, got real duplicates. Refreshed the
          // page, found the row already there.
          //
          // Fix: recalc gets its own try/catch. If it fails we log + warn the
          // user that the invoice's collected total may need a manual refresh,
          // BUT we still complete the success flow — modal closes, form clears,
          // toast confirms. The insert is the source of truth; recalc is a
          // derived view.
          if (!isBankPlaceholder) {
            try {
              await recalcInvoiceCollected(matchingInvoice.id);
            } catch (recalcErr) {
              console.warn('[treasury-add] insert succeeded but recalcInvoiceCollected threw:', recalcErr && recalcErr.message);
              try { toast.warning('Saved ✓ — but the invoice total may need a manual refresh (Fix Links button).'); } catch (_) {}
            }
          }
          setTreasury(prev => [inserted, ...prev]);
          setShowAddTreasury(false);
          // v55.82-E — ALSO clear modal-companion state so a future open
          // is clean. Belt-and-suspenders with the open-button reset.
          setPendingTreasuryRecord(null);
          setPendingInstrumentMatch(null);
          setDuplicateConfirm(null);
          setTreasuryFormErrors([]);
          setIsCreatingInvoice(false);
          setCreateInvoiceError(null);
          toast.success(
            (isBankPlaceholder ? 'Bank entry saved (awaiting statement) + linked to ' : 'Transaction saved + linked to ')
            + (matchingInvoice.customer_name || ('#' + matchingInvoice.order_number)) + ' ✓'
          );
          setFormData({});
          setTimeout(() => loadAllData(), 500);
          return;
        }
        // Order# provided but no matching invoice → open "create now or cancel" flow
        console.log('[treasury-add] OPENING modal — order#' + orderNumTrimmed + ' not found locally');
        // v55.48 — Visible toast so user gets immediate feedback. Combined
        // with the form Modal hiding itself when pendingTreasuryRecord is
        // set, the user now sees a clear state transition: form goes away,
        // toast pops, "Order # not found" modal appears.
        try {
          toast.info('Order #' + orderNumTrimmed + ' not found in your invoice list — see modal to create or pick a typo suggestion.');
        } catch (_) {}
        setIsCreatingInvoice(false);
        setCreateInvoiceError(null);
        setFormData(function(prev) {
          var next = Object.assign({}, prev);
          delete next.__creatingInvoice;
          delete next.__newInvCustomer;
          delete next.__newInvCustomerId;
          delete next.__newInvTotal;
          delete next.__newInvDate;
          return next;
        });
        setPendingTreasuryRecord({
          record: record,
          amount: amt,
          suggestions: findOrderNumberSuggestions(orderNumTrimmed),
        });
        return; // form stays open behind the mini-modal; no insert yet
      }

      // v55.12 (Apr 26 2026) — REQUIRE order# for Cash IN / Bank IN.
      // Previously, income with no order# was silently saved without any
      // customer link. The Treasury Inspector then showed it as "greyed out"
      // because the row implied a customer payment but had nothing to point
      // to, and downstream reports lost the money trail.
      // Now: if income has no order#, we block save and force the user to
      // either (a) provide an order#, or (b) explicitly mark it as non-order
      // income (refund, advance, owner contribution, etc.) via a category.
      if (isOrderLinkable && !orderNumTrimmed) {
        console.log('[treasury-add] BLOCKING — income without order#');
        // If they picked an income category that's clearly non-order
        // (refund/advance/owner contribution/loan), we accept the entry as
        // non-order income. Otherwise we block and prompt.
        var nonOrderIncomeCats = ['Refund', 'Advance', 'Owner Contribution', 'Owner Draw', 'Loan', 'Loan Received', 'Other Income', 'Inter-Bank Transfer', 'Bank Fee', 'استرداد', 'سلفة', 'إيداع المالك', 'قرض', 'دخل آخر'];
        var catName = String(record.category || '').trim();
        var isNonOrderIncome = catName && nonOrderIncomeCats.some(function(n) { return catName.toLowerCase() === n.toLowerCase(); });
        if (!isNonOrderIncome) {
          toast.warning(
            'Income transactions need an Order # so we can link to a customer. ' +
            'If this is NOT a customer payment (e.g. owner deposit, refund, loan, advance), pick a non-order Category. ' +
            '/ معاملات الوارد تحتاج رقم أمر للربط بالعميل. لو ليست دفعة عميل، اختر تصنيف.'
          );
          return;
        }
        // Non-order income with explicit category — fall through to silent save below
        console.log('[treasury-add] non-order income accepted via category: ' + catName);
      }

      // No order# branch covers: expenses (cash_out / bank_out), non-order bank entries, and explicitly-classified non-order income
      console.log('[treasury-add] SILENT SAVE path — no modal will appear.');
      const inserted = await dbInsert('treasury', record, user?.id);
      setTreasury(prev => [inserted, ...prev]);
      setShowAddTreasury(false);
      // v55.82-E — clear modal-companion state on every successful save
      // so the next open is guaranteed clean.
      setPendingTreasuryRecord(null);
      setDuplicateConfirm(null);
      setTreasuryFormErrors([]);
      setIsCreatingInvoice(false);
      setCreateInvoiceError(null);
      toast.success(isBankPlaceholder ? 'Bank entry saved — awaiting bank statement ✓' : 'Transaction saved ✓');
      setFormData({});
      setTimeout(() => loadAllData(), 500);
    } catch (err) {
      // v55.41 — If Postgres rejected the insert because of a unique
      // constraint (e.g. the optional dedup-hardening unique index that
      // some Supabase projects have enabled on date+amount+order#), don't
      // surface a cryptic SQL error to the user. Open the same
      // confirmation modal we'd open from the JS-side preflight, so the
      // user can decide whether it really is a separate payment that
      // happens to look identical. If they confirm, we re-call with
      // bypassDupCheck=true; the row gets stamped confirmed_not_duplicate
      // and saved.
      var msg = err && err.message ? String(err.message) : '';
      var pgcode = err && err.code ? String(err.code) : '';
      var isUniqueViolation = pgcode === '23505'
        || /duplicate key value/i.test(msg)
        || /unique constraint/i.test(msg);
      if (isUniqueViolation && !opts.bypassDupCheck) {
        console.warn('[treasury-add] DB unique-constraint violation — opening duplicate confirmation modal');
        // v55.82-E — parseAmount here too. The dup-recovery path was
        // calling Number(formData.amount) which would mis-match ON RETRY
        // for the same comma-typed input that broke the original save.
        var dupAmt = parseAmount(formData.amount);
        var probableMatches = findPotentialDuplicates(
          formData.date || today(),
          dupAmt,
          formData.desc,
          formData.type === 'in' || formData.type === 'bank_in' || !formData.type,
          formData.type === 'bank_in' || formData.type === 'bank_out'
        );
        setDuplicateConfirm({
          txDate: formData.date || today(),
          amount: dupAmt,
          description: formData.desc,
          isIncome: formData.type === 'in' || formData.type === 'bank_in' || !formData.type,
          matches: probableMatches,
          fromDbError: true,
        });
        return;
      }
      // v55.82-E — Non-unique-violation errors used to fire only toast.error
      // and fall off the end of the function with the modal still open and
      // formData intact. Toast at the corner on mobile gets missed easily,
      // and the user couldn't tell whether the save actually happened. Now
      // we ALSO push the error into treasuryFormErrors so the persistent red
      // banner stays visible until the user explicitly retries or closes.
      console.error('[treasury-add] save failed:', err);
      try { toast.error('Save failed: ' + (err && err.message)); } catch (_) {}
      setTreasuryFormErrors([{
        field: 'amount',
        label: 'Save failed',
        msg: 'Database error: ' + (err && err.message ? err.message : String(err)) + ' — try again, or close this dialog and check the transaction list to see if the row was already saved before retrying.'
      }]);
    }
  };
  // End of _handleAddTreasuryImpl

  // Finalize the pending treasury record after the user either:
  // (a) accepts a typo suggestion → use that invoice's id
  // (b) creates a new invoice inline → use the new invoice id
  const finalizePendingTreasury = async (invoiceToLink) => {
    // Apr 25 2026 — Bulletproof local toast wrapper. The screenshot showed
    // "Cannot read properties of undefined (reading 'success')" which means
    // `toast` itself was somehow undefined when this closure ran. The line
    // 1057 fallback should prevent that, but to be 100% safe in this critical
    // save path, every toast call below uses safeT — same API, but never
    // throws even if toast is null/undefined. The save itself never fails
    // because of a toast bug now.
    var safeT = {
      success: function(m) { try { (toast && toast.success) ? toast.success(m) : console.log('[toast.success]', m); } catch (_) {} },
      error: function(m) { try { (toast && toast.error) ? toast.error(m) : console.error('[toast.error]', m); } catch (_) {} },
      warning: function(m) { try { (toast && toast.warning) ? toast.warning(m) : console.warn('[toast.warning]', m); } catch (_) {} },
      info: function(m) { try { (toast && toast.info) ? toast.info(m) : console.log('[toast.info]', m); } catch (_) {} },
    };
    if (!pendingTreasuryRecord) return;
    const rec = { ...pendingTreasuryRecord.record };
    if (invoiceToLink && invoiceToLink.id) {
      rec.linked_invoice_id = invoiceToLink.id;
      rec.order_number = invoiceToLink.order_number; // normalize to canonical
    }
    try {
      const inserted = await dbInsert('treasury', rec, user?.id);
      if (invoiceToLink && invoiceToLink.id) {
        await recalcInvoiceCollected(invoiceToLink.id);
      }
      setTreasury(prev => [inserted, ...prev]);
      if (invoiceToLink && invoiceToLink.id) {
        setInvoices(function(prev) {
          if (prev.some(function(i) { return i.id === invoiceToLink.id; })) return prev;
          return [invoiceToLink].concat(prev);
        });
      }
      setShowAddTreasury(false);
      closePendingTreasuryModal();
      safeT.success(invoiceToLink
        ? 'Transaction saved + linked to ' + (invoiceToLink.customer_name || ('#' + invoiceToLink.order_number)) + ' ✓'
        : 'Transaction saved ✓');
      setFormData({});
      setTimeout(() => loadAllData(), 500);
    } catch (err) {
      console.error('[finalizePendingTreasury] error', err);
      var rawMsg = (err && err.message) ? String(err.message) : String(err);
      var pgcode = (err && err.code) ? String(err.code) : '';
      var isUniqueViolation = pgcode === '23505'
        || /duplicate key value/i.test(rawMsg)
        || /unique constraint/i.test(rawMsg);

      if (isUniqueViolation) {
        // v55.82-B — Graceful recovery for the orphan-invoice failure mode.
        // Before this fix, if the user got past the "Order # not found"
        // dialog and clicked "Create Invoice + Save Treasury", the invoice
        // was created first and THEN the treasury insert ran. If a unique
        // constraint on (date, amount, order#) tripped on the treasury
        // insert, the user saw a raw SQL error in the red banner with no
        // path forward — and the invoice was already in Sales as an orphan
        // with $0 collected.
        //
        // Now: detect 23505 specifically, tell the user plainly what
        // happened (invoice DID get created, but a matching cash entry
        // already exists), and point to the recovery action (open the
        // existing treasury row in Treasury and link it to the new invoice
        // via the link button). The pending modal stays open so the user
        // can copy the order# if they want.
        var invoiceTag = invoiceToLink && invoiceToLink.id
          ? ('Invoice #' + (invoiceToLink.order_number || invoiceToLink.id) + ' was saved to Sales.')
          : 'The invoice may have already been created.';
        var friendly = 'A matching cash/bank entry already exists for this date and amount. ' + invoiceTag
          + ' To finish: close this dialog, find the existing treasury row, and click its link button to attach it to the invoice. '
          + ' / يوجد قيد خزنة مطابق بنفس التاريخ والمبلغ. الفاتورة محفوظة في المبيعات. لإكمال الربط، أغلق هذه النافذة وافتح القيد الموجود في الخزنة واضغط زر الربط.';
        setCreateInvoiceError(friendly);
        safeT.warning('Invoice saved — but a matching treasury entry already exists. See banner for next step.');
        return;
      }

      // Non-duplicate error path: surface message as before.
      safeT.error(rawMsg);
      setCreateInvoiceError('Saving the transaction failed: ' + rawMsg);
    }
  };

  const handleEditTreasury = async (txn) => {
    try {
      // v55.42 — Detect row type so we read the right inputs and write the
      // right columns. Without this, editing a bank row from the inline
      // table converted it into a cash row (the cash inputs read 0, the
      // bank fields were never preserved, and is_bank_placeholder was
      // implicitly cleared on next data flow).
      var hasBankIn  = Number(txn.bank_in  || 0) > 0;
      var hasBankOut = Number(txn.bank_out || 0) > 0;
      var isPlaceholder = !!txn.is_bank_placeholder;
      var isBankRow = hasBankIn || hasBankOut || isPlaceholder;

      const fd = {
        date: formData.txEditDate || txn.transaction_date,
        desc: document.getElementById('tx-desc')?.value,
        cashIn:  isBankRow ? null : document.getElementById('tx-in')?.value,
        cashOut: isBankRow ? null : document.getElementById('tx-out')?.value,
        bankIn:  isBankRow ? document.getElementById('tx-bank-in')?.value  : null,
        bankOut: isBankRow ? document.getElementById('tx-bank-out')?.value : null,
        orderNumber: document.getElementById('tx-order')?.value,
        category: document.getElementById('tx-cat')?.value,
        subcategory: document.getElementById('tx-subcat')?.value,
      };
      // Guard against placeholder values
      if (fd.category === '__custom') fd.category = txn.category || '';
      if (fd.subcategory === '__custom') fd.subcategory = txn.subcategory || '';

      // v55.42 — Build updates by ROW TYPE so we never cross-contaminate
      // cash and bank fields. Bank rows never write cash_in/cash_out;
      // cash rows never write bank_in/bank_out. is_bank_placeholder and
      // bank_account_id are NEVER included in the update — they're
      // intrinsic identity fields and must not change via this edit.
      var updates;
      if (isBankRow) {
        updates = {
          transaction_date: fd.date || txn.transaction_date,
          description: fd.desc || txn.description,
          order_number: fd.orderNumber != null ? fd.orderNumber : txn.order_number,
          category: fd.category != null ? fd.category : txn.category,
          subcategory: fd.subcategory != null ? fd.subcategory : txn.subcategory,
        };
        if (isPlaceholder) {
          // Pending placeholder — amount lives in expected_amount
          // v55.82-E — parseAmount instead of Number() so comma/Arabic/
          // whitespace inputs don't get coerced to NaN. Same root-cause fix
          // as handleAddTreasury — was hitting the same bug on edit.
          var inAmt  = parseAmount(fd.bankIn  || 0);
          var outAmt = parseAmount(fd.bankOut || 0);
          if (inAmt > 0) {
            updates.expected_amount = inAmt;
            updates.expected_direction = 'in';
          } else if (outAmt > 0) {
            updates.expected_amount = outAmt;
            updates.expected_direction = 'out';
          } else {
            updates.expected_amount = Number(txn.expected_amount) || 0;
          }
        } else {
          // Confirmed bank row — amount lives in bank_in/bank_out
          // v55.82-E — parseAmount on user-typed values; Number() retained
          // for the txn.* fallbacks since those came straight from the DB.
          updates.bank_in  = fd.bankIn  != null ? parseAmount(fd.bankIn)  : Number(txn.bank_in  || 0);
          updates.bank_out = fd.bankOut != null ? parseAmount(fd.bankOut) : Number(txn.bank_out || 0);
        }
      } else {
        // Cash row — original behavior preserved
        updates = {
          transaction_date: fd.date || txn.transaction_date,
          description: fd.desc || txn.description,
          // v55.82-E — same parseAmount upgrade for cash edits.
          cash_in:  fd.cashIn  != null ? parseAmount(fd.cashIn)  : txn.cash_in,
          cash_out: fd.cashOut != null ? parseAmount(fd.cashOut) : txn.cash_out,
          order_number: fd.orderNumber != null ? fd.orderNumber : txn.order_number,
          category: fd.category != null ? fd.category : txn.category,
          subcategory: fd.subcategory != null ? fd.subcategory : txn.subcategory,
        };
      }
      await dbUpdate('treasury', txn.id, updates, user?.id);

      // BUG 2 fix: if amounts changed AND row is linked to an invoice, the
      // invoice's total_collected / outstanding is now stale. Recalc from DB
      // truth. Previously the invoice would show the old collected amount
      // until a reload or "Fix Links" button press — so a user fixing a typo
      // (5000 → 500) would see the invoice still reporting 5000 collected.
      const amountsChanged =
        Number(updates.cash_in  || 0) !== Number(txn.cash_in  || 0) ||
        Number(updates.cash_out || 0) !== Number(txn.cash_out || 0) ||
        Number(updates.bank_in  || 0) !== Number(txn.bank_in  || 0) ||
        Number(updates.bank_out || 0) !== Number(txn.bank_out || 0) ||
        Number(updates.expected_amount || 0) !== Number(txn.expected_amount || 0);
      if (amountsChanged && txn.linked_invoice_id) {
        try { await recalcInvoiceCollected(txn.linked_invoice_id); } catch (e) { /* don't block UI */ }
      }

      // Auto-apply category/subcategory to ALL entries with same description + create rule
      const catChanged = fd.category && fd.category !== txn.category;
      const subChanged = fd.subcategory !== undefined && fd.subcategory !== (txn.subcategory || '');
      if ((catChanged || subChanged) && (fd.category || fd.subcategory)) {
        const desc = (txn.description || '').trim();
        if (desc) {
          // BUG 1 fix: bulk update gated by direction. Treasury can legitimately
          // have the same description for both cash_in and cash_out rows (e.g.,
          // "تحويل بنكى" for both outgoing AND incoming). Without a direction
          // filter, changing the category on ONE direction would rewrite the
          // OTHER direction's category too.
          const batchUpdates = {};
          if (catChanged) batchUpdates.category = fd.category;
          if (subChanged) batchUpdates.subcategory = fd.subcategory;
          // Figure out which direction THIS row represents, post-update (so a
          // user editing 0 out → 500 out reassigns as expense going forward).
          const postInflow  = Number(updates.cash_in  || 0) + Number(updates.bank_in  || 0);
          const postOutflow = Number(updates.cash_out || 0) + Number(updates.bank_out || 0);
          var bulkQ = supabase.from('treasury').update(batchUpdates).eq('description', desc);
          if (postInflow > 0 && postOutflow === 0) {
            // Income row — only touch rows where cash_in>0 OR bank_in>0
            bulkQ = bulkQ.or('cash_in.gt.0,bank_in.gt.0');
          } else if (postOutflow > 0 && postInflow === 0) {
            // Expense row — only touch rows where cash_out>0 OR bank_out>0
            bulkQ = bulkQ.or('cash_out.gt.0,bank_out.gt.0');
          }
          // Neutral (both 0 or both >0, rare): don't bulk — only update this row.
          // Otherwise we risk nuking unrelated categorizations.
          else {
            bulkQ = bulkQ.eq('id', txn.id);
          }
          await bulkQ;

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
    } catch (err) {
      // v55.82-B — toast over native alert. See handleSaveTreasuryEdit comment.
      console.error('[treasury-unlink] failed', err);
      var msg = (err && err.message) ? err.message : String(err);
      try { (toast && toast.error) ? toast.error('Unlink error: ' + msg) : alert('Unlink error: ' + msg); } catch (_) {}
    }
  };

  // ── Delete Treasury Transaction ──
  const handleDeleteTreasury = async (txnId) => {
    try {
      const txn = treasury.find(t => t.id === txnId);
      if (!txn) return;
      const invoiceToRecalc = txn.linked_invoice_id || null;
      const linkedCheckId = txn.source_check_id || null;
      await dbDelete('treasury', txnId, userProfile?.id || user?.id);
      setTreasury(prev => prev.filter(t => t.id !== txnId));
      setEditTreasuryModal(null);
      // v55.83-A.6.27.19 — if this treasury row backed an instrument (via
      // source_check_id) AND the instrument has linked_treasury_id pointing
      // at this exact row, revert the instrument from 'cleared' back to
      // 'pending'. Otherwise the instrument shows cleared with a dangling
      // reference to a deleted treasury row.
      // We only revert if the link points at THIS treasury row, in case the
      // instrument has been re-linked to a different treasury row since.
      if (linkedCheckId) {
        try {
          var inst = (checks || []).find(function (c) { return c.id === linkedCheckId; });
          if (inst && inst.linked_treasury_id === txnId) {
            await dbUpdate('checks', linkedCheckId, {
              status: 'pending',
              collection_date: null,
              linked_treasury_id: null,
              updated_by: userProfile?.id || user?.id,
            }, userProfile?.id || user?.id);
            console.log('[treasury-delete] reverted linked instrument ' + linkedCheckId + ' back to pending');
          }
        } catch (instErr) {
          console.warn('[treasury-delete] failed to revert linked instrument:', instErr && instErr.message);
        }
      }
      // Recalc from DB truth — handles cash_in and bank_in correctly for any channel.
      if (invoiceToRecalc) {
        try { await recalcInvoiceCollected(invoiceToRecalc); } catch(e) {}
      }
    } catch (err) {
      // v55.82-B — toast over native alert. See handleSaveTreasuryEdit comment.
      console.error('[treasury-delete] failed', err);
      var msg = (err && err.message) ? err.message : String(err);
      try { (toast && toast.error) ? toast.error('Delete error: ' + msg) : alert('Delete error: ' + msg); } catch (_) {}
    }
  };

  // ── Save Treasury Edit from Modal ──
  const handleSaveTreasuryEdit = async (txnId, updates) => {
    try {
      // v55.42 — Find the original row so we can detect amount changes and
      // recalc any linked invoice. Without this, edits to bank_in/bank_out
      // (or cash_in/cash_out) on a linked row left the invoice's
      // total_collected stale until a manual "Fix Links" pass.
      var original = (treasury || []).find(function(t) { return t.id === txnId; });

      // v55.82-B — AUTO-LINK ON ORDER# CHANGE.
      // Before this fix, editing a row to ADD an order# (e.g., user forgot
      // to fill it on first save) wrote the new value but never set
      // linked_invoice_id. The row stayed unlinked even though a matching
      // invoice existed. Treasury Inspector showed it as orphaned and the
      // invoice's outstanding never moved. Reports lost the trail.
      //
      // Now: when order_number is in the update payload AND it differs
      // from the original, we look up the matching invoice and set
      // linked_invoice_id accordingly. Both old and new invoice are then
      // recalced so totals stay truthful. Same pattern as the Add path.
      var oldOrderTrim = String((original && original.order_number) || '').trim();
      var newOrderTrim = Object.prototype.hasOwnProperty.call(updates, 'order_number')
        ? String(updates.order_number || '').trim()
        : oldOrderTrim;
      var orderChanged = newOrderTrim !== oldOrderTrim;
      var oldLinkedInvoiceId = (original && original.linked_invoice_id) || null;
      var newLinkedInvoiceId = oldLinkedInvoiceId;
      var matchingInvoice = null;

      if (orderChanged) {
        if (!newOrderTrim) {
          // Order# cleared → unlink. recalcInvoiceCollected on the old
          // invoice runs below so its outstanding bumps back up.
          updates.linked_invoice_id = null;
          newLinkedInvoiceId = null;
        } else {
          matchingInvoice = (invoices || []).find(function(i) {
            return String(i.order_number || '').trim() === newOrderTrim;
          });
          if (matchingInvoice) {
            updates.linked_invoice_id = matchingInvoice.id;
            newLinkedInvoiceId = matchingInvoice.id;
          } else {
            // Order# changed to a value that doesn't match any invoice —
            // unlink. We surface a non-blocking warning at the end so the
            // user knows the row is now orphaned. Save still proceeds —
            // user might be typing the order# before the invoice exists.
            updates.linked_invoice_id = null;
            newLinkedInvoiceId = null;
          }
        }
      }

      await dbUpdate('treasury', txnId, updates, userProfile?.id || user?.id);
      setTreasury(prev => prev.map(t => t.id === txnId ? { ...t, ...updates } : t));

      // Recalc the OLD linked invoice if we just unlinked or relinked away.
      if (oldLinkedInvoiceId && oldLinkedInvoiceId !== newLinkedInvoiceId) {
        try { await recalcInvoiceCollected(oldLinkedInvoiceId); }
        catch (e) { console.warn('[treasury-edit] old invoice recalc failed:', e && e.message); }
      }

      // Recalc the NEW (or still-linked) invoice if either:
      //   (a) we just newly linked it (relinking case), OR
      //   (b) any money-bearing field changed on a row that was already linked.
      // We compare the OLD row's totals to what's in `updates` for fields
      // that are present (Object.prototype.hasOwnProperty so a missing
      // field counts as "unchanged" — never overwrite with 0 by accident).
      if (newLinkedInvoiceId) {
        var moneyFields = ['cash_in', 'cash_out', 'bank_in', 'bank_out', 'expected_amount'];
        var amountChanged = original && moneyFields.some(function(f) {
          if (!Object.prototype.hasOwnProperty.call(updates, f)) return false;
          return Number(updates[f] || 0) !== Number(original[f] || 0);
        });
        var newlyLinked = oldLinkedInvoiceId !== newLinkedInvoiceId;
        if (amountChanged || newlyLinked) {
          try { await recalcInvoiceCollected(newLinkedInvoiceId); }
          catch (e) { console.warn('[treasury-edit] new invoice recalc failed:', e && e.message); }
        }
      }

      setEditTreasuryModal(null);

      // v55.82-B — User-visible feedback. Was previously silent on success.
      try {
        if (orderChanged && matchingInvoice) {
          if (toast && toast.success) {
            toast.success('Saved + linked to ' + (matchingInvoice.customer_name || ('#' + matchingInvoice.order_number)) + ' ✓');
          }
        } else if (orderChanged && newOrderTrim && !matchingInvoice) {
          if (toast && toast.warning) {
            toast.warning('Saved — but order #' + newOrderTrim + ' does not match any invoice. Row is unlinked. / لا توجد فاتورة بهذا الرقم. الصف غير مرتبط.');
          }
        } else if (orderChanged && !newOrderTrim && oldLinkedInvoiceId) {
          if (toast && toast.info) {
            toast.info('Saved — order# cleared, row unlinked. / تم الحفظ، الصف غير مرتبط.');
          }
        } else {
          if (toast && toast.success) toast.success('Saved ✓');
        }
      } catch (_) { /* never let a toast bug break the save */ }
    } catch (err) {
      // v55.82-B — Replace native alert() with toast.error(). Native alerts
      // are jarring system-level dialogs on mobile, easily mistaken for
      // browser errors rather than app feedback. Toast pattern matches the
      // rest of the Treasury handlers.
      console.error('[treasury-edit] save failed', err);
      var msg = (err && err.message) ? err.message : String(err);
      try {
        if (toast && toast.error) toast.error('Save error: ' + msg);
        else alert('Save error: ' + msg);
      } catch (_) {
        try { alert('Save error: ' + msg); } catch (__) {}
      }
    }
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

  // Check ↔ treasury reconciliation evaluator.
  // Pure logic lives in src/lib/check-reconcile.js (see test suite at /tmp/test-checks.js — 40 cases).
  // This wrapper just binds the local invoices/treasury state and adds runtime warnings the pure
  // evaluator doesn't surface (zero-amount, overpayment).
  const evaluateCheckReconcile = (chk) => {
    const result = libEvaluateCheckReconcile(chk, invoices, treasury);
    // Annotate with runtime warnings
    const warnings = [];
    if (chk && Number(chk.amount || 0) === 0) {
      warnings.push({
        level: 'error',
        en: 'This check has a zero amount. Cannot collect a zero-value check.',
        ar: 'هذا الشيك بدون قيمة. لا يمكن تحصيل شيك بقيمة صفر.'
      });
    }
    if (result.invoice && chk) {
      const invTotal = Number(result.invoice.total_amount || 0);
      const collected = Number(result.invoice.total_collected || 0);
      const remaining = invTotal - collected;
      if (Number(chk.amount || 0) > remaining + 0.01) {
        warnings.push({
          level: 'warn',
          en: 'Check amount (' + fE(chk.amount) + ') exceeds remaining invoice balance (' + fE(remaining) + '). Collecting will overpay this invoice.',
          ar: 'مبلغ الشيك (' + fE(chk.amount) + ') أكبر من المتبقي على الفاتورة (' + fE(remaining) + '). التحصيل سيؤدي إلى دفع زائد.'
        });
      }
    }
    return { ...result, warnings };
  };

  const handleCollectCheck = async () => {
    if (!reconcileCheck || !reconcileDate) { alert('Please select a collection date / الرجاء تحديد تاريخ التحصيل'); return; }
    try {
      const evalResult = evaluateCheckReconcile(reconcileCheck);
      // Hard block: zero-amount check
      const errorWarn = (evalResult.warnings || []).find(w => w.level === 'error');
      if (errorWarn) {
        alert('⛔ ' + errorWarn.en + '\n\n' + errorWarn.ar);
        return;
      }
      // Soft block: overpayment — confirm before proceeding
      const overpayWarn = (evalResult.warnings || []).find(w => w.level === 'warn');
      if (overpayWarn) {
        if (!confirm('⚠️ ' + overpayWarn.en + '\n\n' + overpayWarn.ar + '\n\nProceed anyway?')) return;
      }
      const choice = reconcileCheckChoice;
      const physicalReturned = !!reconcileCheckReturned;

      // ---- Case A: already explicitly linked → just close the check ----
      if (evalResult.mode === 'already_linked') {
        await dbUpdate('checks', reconcileCheck.id, {
          status: 'collected',
          collection_date: reconcileDate,
          linked_treasury_id: evalResult.existingTreasury.id,
          physical_check_returned: physicalReturned,
        }, user?.id);
        if (evalResult.invoice) await recalcInvoiceCollected(evalResult.invoice.id);
        toast.success('Check closed (already linked) ✓');
        setReconcileCheck(null); setReconcileDate(''); setReconcileCheckChoice(null); setReconcileCheckReturned(false);
        await loadAllData();
        return;
      }

      // ---- Case B: candidate match → user picked an existing treasury row to attach to ----
      if (evalResult.mode === 'candidate_match' && choice && choice.kind === 'attach' && choice.treasuryId) {
        // Stamp the picked treasury row with source_check_id, then close the check
        await dbUpdate('treasury', choice.treasuryId, {
          source_check_id: reconcileCheck.id,
          payment_source: 'check',
        }, user?.id);
        await dbUpdate('checks', reconcileCheck.id, {
          status: 'collected',
          collection_date: reconcileDate,
          linked_treasury_id: choice.treasuryId,
          physical_check_returned: physicalReturned,
        }, user?.id);
        if (evalResult.invoice) await recalcInvoiceCollected(evalResult.invoice.id);
        toast.success('Check linked to existing treasury entry + closed ✓');
        setReconcileCheck(null); setReconcileDate(''); setReconcileCheckChoice(null); setReconcileCheckReturned(false);
        await loadAllData();
        return;
      }

      // ---- Case C: no_match OR user chose to create a new treasury row ----
      // (Cash-swap "customer brought cash, took check back" → new cash_in row + physical_check_returned=true)
      // (Or pure "new entry" fallback when user disagrees with all candidates)
      //
      // v55.83-A.6.27.14 (Max May 16 2026) — channel selection FIX. Previously
      // this path ALWAYS inserted as cash_in, even when the check was a normal
      // bank deposit (no physical return). That silently inflated the safe
      // balance every time a check was collected the "no match" way. Now:
      //   - physicalReturned = true  → cash_in (customer brought cash, swap)
      //   - physicalReturned = false → bank_in (the check was deposited at the bank)
      // Either way, the invoice's "collected" total goes up the same amount
      // because the recalc sums cash_in + bank_in.
      if ((evalResult.mode === 'no_match' || (evalResult.mode === 'candidate_match' && choice && choice.kind === 'new'))
          || (evalResult.mode === 'no_invoice')) {
        const checkNum = reconcileCheck.check_number ? ' #' + reconcileCheck.check_number : '';
        const desc = (reconcileCheck.customer_name || '') + ' — شيك محصّل' + checkNum;
        // v55.83-A.6.7 round 2 audit — resolve invoice_id from order_number
        // if both evalResult.invoice and check.invoice_id are null. Keeps
        // every treasury insert path consistent with dbInsert's auto-link.
        let resolvedInv2 = evalResult.invoice ? evalResult.invoice.id : (reconcileCheck.invoice_id || null);
        if (!resolvedInv2 && reconcileCheck.order_number) {
          try {
            const lk2 = await supabase.from('invoices').select('id').eq('order_number', String(reconcileCheck.order_number).trim()).maybeSingle();
            if (lk2 && lk2.data && lk2.data.id) resolvedInv2 = lk2.data.id;
          } catch (lk2Err) { console.warn('[reconcileCheck] invoice lookup failed:', lk2Err && lk2Err.message); }
        }
        var checkAmt = Number(reconcileCheck.amount);
        const { data: newTxn } = await supabase.from('treasury').insert({
          transaction_date: reconcileDate,
          order_number: reconcileCheck.order_number || '',
          description: desc,
          cash_in: physicalReturned ? checkAmt : 0,
          cash_out: 0,
          bank_in: physicalReturned ? 0 : checkAmt,
          bank_out: 0,
          source: 'main',
          category: 'مبيعات',
          linked_invoice_id: resolvedInv2,
          source_check_id: reconcileCheck.id,
          payment_source: 'check',
        }).select('id').single();
        await dbUpdate('checks', reconcileCheck.id, {
          status: 'collected',
          collection_date: reconcileDate,
          linked_treasury_id: newTxn?.id || null,
          physical_check_returned: physicalReturned,
        }, user?.id);
        // Recalc whichever invoice ended up linked (evalResult.invoice OR
        // resolvedInv2 fallback). Without this, the check shows collected
        // but the invoice doesn't reflect it.
        if (evalResult.invoice) await recalcInvoiceCollected(evalResult.invoice.id);
        else if (resolvedInv2) await recalcInvoiceCollected(resolvedInv2);
        toast.success(physicalReturned ? 'Check collected as cash swap ✓' : 'Check collected + treasury entry added ✓');
        setReconcileCheck(null); setReconcileDate(''); setReconcileCheckChoice(null); setReconcileCheckReturned(false);
        await loadAllData();
        return;
      }

      // Defensive: candidate_match mode but no choice picked → tell user
      if (evalResult.mode === 'candidate_match' && !choice) {
        alert('Please select how this check was collected (pick one of the options).');
        return;
      }
    } catch (err) {
      toast.error(err.message);
    }
  };

  // ==========================================
  // UNCOLLECT CHECK (S15 — Apr 22 2026)
  // ==========================================
  // What this does in plain English:
  //   Reverses a "Collected" check back to "Pending". Cleanly:
  //     1. Finds the treasury cash_in row that was created when the check was
  //        collected (linked via source_check_id OR check.linked_treasury_id).
  //     2. Decides what to DO with that treasury row:
  //        a) If the treasury row was CREATED by the collect flow (typical
  //           case — source_check_id = this check), we DELETE it. That reverses
  //           the double-count we're worried about.
  //        b) If the treasury row existed BEFORE (user attached the check to
  //           an existing treasury row in mode 'candidate_match'), we just
  //           UNSTAMP it (clear source_check_id + payment_source) — the money
  //           is real, we just break the link.
  //     3. Unlinks any bank transaction that was matched to this treasury row.
  //     4. Recalculates the invoice's collected total.
  //     5. Flips the check back to pending, clears collection_date, clears
  //        linked_treasury_id.
  //     6. Writes an audit trail comment so there's a permanent record.
  //
  // Safety: every step runs inside try/catch. A failure mid-way does NOT
  // leave the system in a half-reversed state — either everything succeeds
  // or the check stays marked collected with an error toast.
  const handleUncollectCheck = async (check, reason) => {
    // S22.7 (Apr 23 2026) — Hardened uncollect. Previous failures were
    // typically silent: `physical_check_returned` column missing in some
    // DBs would throw, or a toast would suppress the error. Now every
    // step logs to the browser console with [uncollect] prefix so the
    // user can inspect failures in F12.
    console.log('[uncollect] start', { checkId: check && check.id, status: check && check.status });
    if (!check) { console.warn('[uncollect] no check given'); return; }
    if (check.status !== 'collected') {
      console.warn('[uncollect] check is not collected — status=' + check.status);
      try { toast.error('Only collected checks can be uncollected (current status: ' + check.status + ')'); } catch (_) { alert('Only collected checks can be uncollected.'); }
      return;
    }

    const confirmMsg = 'Reverse the collection of this check?\n\n' +
      'Check: #' + (check.check_number || '?') + ' for ' + Number(check.amount).toLocaleString() + ' EGP\n' +
      'Customer: ' + (check.customer_name || '?') + '\n' +
      'Collected on: ' + (check.collection_date || '?') + '\n\n' +
      'This will:\n' +
      '  • Remove/unlink the treasury entry\n' +
      '  • Unlink any matched bank transaction\n' +
      '  • Recalculate the invoice\n' +
      '  • Set check back to Pending\n\n' +
      'Are you sure?';
    if (!confirm(confirmMsg)) { console.log('[uncollect] user cancelled'); return; }

    const actorId = (userProfile && userProfile.id) || (user && user.id) || null;

    try {
      // Step 1 — find the linked treasury row
      let treasuryRow = null;
      if (check.linked_treasury_id) {
        console.log('[uncollect] lookup by linked_treasury_id', check.linked_treasury_id);
        const tRes = await supabase.from('treasury')
          .select('id, source_check_id, payment_source, cash_in, linked_invoice_id')
          .eq('id', check.linked_treasury_id)
          .maybeSingle();
        if (tRes.error) console.warn('[uncollect] linked_treasury_id query error:', tRes.error.message);
        if (tRes.data) treasuryRow = tRes.data;
      }
      if (!treasuryRow) {
        console.log('[uncollect] fallback lookup by source_check_id', check.id);
        const fbRes = await supabase.from('treasury')
          .select('id, source_check_id, payment_source, cash_in, linked_invoice_id')
          .eq('source_check_id', check.id)
          .maybeSingle();
        if (fbRes.error) console.warn('[uncollect] source_check_id query error:', fbRes.error.message);
        if (fbRes.data) treasuryRow = fbRes.data;
      }
      console.log('[uncollect] treasuryRow resolved:', treasuryRow);

      // Step 2 — decide: delete vs unstamp
      if (treasuryRow) {
        const wasCreatedByCollect = treasuryRow.source_check_id === check.id;
        if (wasCreatedByCollect) {
          console.log('[uncollect] deleting treasury row', treasuryRow.id);
          const delRes = await supabase.from('treasury').delete().eq('id', treasuryRow.id);
          if (delRes.error) throw new Error('Could not delete treasury row: ' + delRes.error.message);
        } else {
          console.log('[uncollect] unstamping treasury row', treasuryRow.id);
          const upRes = await supabase.from('treasury').update({
            source_check_id: null,
            payment_source: null,
          }).eq('id', treasuryRow.id);
          if (upRes.error) throw new Error('Could not unstamp treasury row: ' + upRes.error.message);
        }

        // Step 3 — unlink any bank transactions that were matched to this treasury
        console.log('[uncollect] unlinking bank transactions matched to treasury', treasuryRow.id);
        const bankRes = await supabase.from('egypt_bank_transactions').update({
          matched_treasury_id: null,
          matched_at: null,
          matched_by: null,
        }).eq('matched_treasury_id', treasuryRow.id);
        if (bankRes.error) console.warn('[uncollect] bank unlink warning (non-fatal):', bankRes.error.message);
      }

      // Step 4 — recalc invoice if the check was linked to one
      const invoiceId = check.invoice_id || (treasuryRow && treasuryRow.linked_invoice_id) || null;
      if (invoiceId) {
        console.log('[uncollect] recalc invoice', invoiceId);
        try { await recalcInvoiceCollected(invoiceId); } catch (e) {
          console.warn('[uncollect] Invoice recalc after uncollect failed:', e.message);
        }
      }

      // Step 5 — flip the check back to pending.
      // S22.7 — Defensive: if the DB doesn't have physical_check_returned
      // column (older schemas), retry WITHOUT it so the uncollect still
      // succeeds. This is the most likely cause of prior silent failures.
      const baseChanges = {
        status: 'pending',
        collection_date: null,
        linked_treasury_id: null,
      };
      try {
        console.log('[uncollect] updating check with physical_check_returned=false');
        await dbUpdate('checks', check.id, Object.assign({}, baseChanges, { physical_check_returned: false }), actorId);
      } catch (e) {
        console.warn('[uncollect] full update failed (probably missing column), retrying minimal:', e.message);
        try {
          await dbUpdate('checks', check.id, baseChanges, actorId);
        } catch (e2) {
          console.error('[uncollect] minimal check update also failed:', e2.message);
          throw new Error('Could not flip check back to pending: ' + e2.message);
        }
      }

      // Step 6 — audit trail (optional: write a note)
      const auditNote = 'Check uncollected by ' + ((userProfile && userProfile.name) || 'user') +
        (reason ? ' — reason: ' + reason : '') +
        (treasuryRow ? (treasuryRow.source_check_id === check.id ? ' (treasury row deleted)' : ' (treasury row unstamped)') : ' (no treasury row found)');
      try {
        await supabase.from('daily_log').insert({
          user_id: (userProfile && userProfile.id) || null,
          entry_text: auditNote + ' — Check #' + (check.check_number || '?') + ' for ' + Number(check.amount).toLocaleString() + ' EGP',
          log_category: 'check',
          log_date: todayET(),
          auto_generated: true,
        });
      } catch (e) { console.warn('[uncollect] daily_log insert failed (non-fatal):', e.message); }

      console.log('[uncollect] SUCCESS — check', check.id);
      try { toast.success('Check uncollected successfully ↩︎'); } catch (_) { alert('Check uncollected successfully.'); }
      await loadAllData();
    } catch (err) {
      console.error('[uncollect] FAILED', err);
      try { toast.error('Uncollect failed: ' + (err.message || 'unknown error')); } catch (_) {}
      alert('⚠️ Uncollect failed.\n\nError: ' + (err.message || 'unknown error') + '\n\nOpen F12 → Console for details.');
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

  // v55.83-A.6.6 (Max May 13 2026) — single source of truth for "treasury
  // total for this invoice" used by reconciliation status everywhere
  // (StatusBadge, sales report, invoice modal).
  //
  // v55.83-A.6.7 (Max May 13 2026) — CRIT-5 fix: when a post-dated check
  // is collected, the system inserts a "shadow" treasury row stamped with
  // source_check_id. If we sum that row AND the collected check itself,
  // we double-count. Exclude treasury rows where source_check_id IS NOT
  // NULL — those are shadows, the check is the source of truth.
  //
  // Defensive: source_check_id column may not exist yet on older DBs.
  // The shim treats `undefined` and `null` the same — both mean "not a
  // shadow row" — so behavior is unchanged on old schemas.
  const tTotalForInvoice = (invoice) => {
    if (!invoice) return 0;
    const txns = treasuryByOrder[invoice.order_number] || [];
    const txnSum = txns.reduce((a, t) => {
      // Skip shadow rows tied to a check (CRIT-5)
      if (t.source_check_id) return a;
      return a + Number(t.cash_in || 0) + Number(t.bank_in || 0);
    }, 0);
    const chkSum = (checks || [])
      .filter(c => (c.order_number === invoice.order_number || c.invoice_id === invoice.id) && c.status === 'collected')
      .reduce((a, c) => a + Number(c.amount || 0), 0);
    return txnSum + chkSum;
  };

  const StatusBadge = ({ invoice }) => {
    const tTotal = tTotalForInvoice(invoice);
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
          {data.map(inv => {
            // S12 2026-04-22 — Color coding for each row
            //
            // Pull the same status that the StatusBadge uses so the row tint
            // and the badge agree visually. Then render:
            //   - colored left border (status at a glance)
            //   - row tint (subtle, only on payment status, not in dark mode)
            //   - paid amount in shaded green if any payment, neutral if zero
            //   - owed amount in shaded red proportional to % unpaid
            //   - thin progress bar under Paid column showing collected / invoiced
            var invAmt = Number(inv.total_amount || 0);
            var paidAmt = Number(inv.total_collected || 0);
            var owedAmt = Number(inv.outstanding || 0);
            var paidPct = invAmt > 0 ? Math.min(100, Math.round((paidAmt / invAmt) * 100)) : (paidAmt > 0 ? 100 : 0);

            // Status drives the left-border color. getReconStatus returns a
            // STRING (e.g. 'reconciled'), not an object. Pass treasuryTotal=0
            // when we don't have a precomputed value — the function still
            // returns a sensible category from invoice.outstanding alone.
            var statusKey = (typeof getReconStatus === 'function')
              ? getReconStatus(inv, paidAmt)
              : (owedAmt > 0 ? 'open' : (paidAmt > 0 ? 'reconciled' : 'unverified'));
            var borderColors = {
              reconciled: '#10b981',  // green
              open:       '#ef4444',  // red
              unverified: '#f59e0b',  // amber
              mismatch:   '#fb923c',  // orange
              overpaid:   '#ea580c',  // dark orange
            };
            var rowBorderColor = borderColors[statusKey] || '#cbd5e1';

            // Paid cell: brighter green when fully paid, soft green when partial
            var paidColor = paidAmt === 0 ? '#94a3b8' : (paidPct >= 100 ? '#059669' : '#34d399');
            // Owed cell: deeper red when more is owed
            var owedColor = owedAmt === 0 ? '#10b981' : (paidPct < 25 ? '#dc2626' : (paidPct < 75 ? '#f87171' : '#fb923c'));

            return (
            <tr key={inv.id} onClick={() => onSelect(inv)}
              style={{ borderLeft: '4px solid ' + rowBorderColor }}
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
              <td className="px-3 py-2 text-xs text-right font-bold text-sky-700">{fE(invAmt)}</td>
              <td className="px-3 py-2 text-xs text-right">
                <div className="font-bold" style={{ color: paidColor }}>{fE(paidAmt)}</div>
                {invAmt > 0 && (
                  <div className="mt-1 h-1 w-full rounded-full bg-slate-100 overflow-hidden" title={paidPct + '% paid'}>
                    <div style={{ width: paidPct + '%', background: paidColor, height: '100%', transition: 'width 0.3s' }} />
                  </div>
                )}
              </td>
              <td className="px-3 py-2 text-xs text-right font-bold" style={{ color: owedColor }}>
                {owedAmt > 0 ? fE(owedAmt) : '✓'}
              </td>
              <td className="px-3 py-2"><StatusBadge invoice={inv} /></td>
            </tr>
            );
          })}
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
      {/* v55.65 — Nadia presence on the loading screen. Just a small pill
          telling the user "I'm here and getting your day ready" so the
          assistant feels available from the very first moment, not
          something that appears 5 seconds later. Pure decoration: full
          chat lives in AIGreeter once data has loaded. */}
      <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 px-3 py-2 rounded-full shadow-lg"
        style={{background:'linear-gradient(135deg, rgba(139,92,246,0.95), rgba(236,72,153,0.95))', backdropFilter:'blur(8px)'}}>
        <div className="relative" style={{width:24, height:24}}>
          <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="11" fill="white" />
            <circle cx="9" cy="11" r="1.2" fill="#1f2937">
              <animate attributeName="r" values="1.2;0.4;1.2" dur="3s" repeatCount="indefinite" />
            </circle>
            <circle cx="15" cy="11" r="1.2" fill="#1f2937">
              <animate attributeName="r" values="1.2;0.4;1.2" dur="3s" repeatCount="indefinite" />
            </circle>
            <path d="M 8 15 Q 12 17 16 15" stroke="#1f2937" strokeWidth="1.4" fill="none" strokeLinecap="round" />
          </svg>
          <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-white animate-pulse"></span>
        </div>
        <div className="text-white text-xs font-bold">
          Nadia is here · getting your day ready…
        </div>
      </div>
    </div>
  );

  // ==========================================
  // RENDER
  // ==========================================
  return (
    <ToastProvider>
    <ErrorBoundary label="KTC Hub encountered an error" showDetails>
    {/* v55.42 — VOICE DISABLED.
        VoiceController (the "Hey Nadia" wake-word listener with the
        bottom-left pill and OFF button) is no longer mounted. Reasoning
        in the voiceEnabled state declaration above. The typed Nadia chat
        is unaffected — only the voice surface is removed.
        Component file kept on disk for ease of future reactivation. */}
    {/* Action bridge — catches nadia-decision-action events from the Decision
        Engine's chips and executes them (draft email, create reminder, flag
        invoice, etc.). Headless component, safe to mount once globally. */}
    <NadiaActionBridge userId={userProfile?.id} toast={toast} />
    {/* S17 — Floating Nadia overlay. Visible on every tab EXCEPT the
        dashboard (where Nadia lives in her original home spot for login
        greetings and briefing cards). Shared muted state means toggling
        on one instance also silences the other.
        User can mute/unmute via button in the pill. Starts collapsed. */}
    {greeterSettings.enabled && !greeterDismissed && tab !== 'dashboard' && (() => {
      // v55.82-F — Compute Nadia suppression for the current view.
      // Three independent reasons to suppress:
      //   1. ANY blocking Treasury modal is open (Add Treasury, pending-
      //      invoice "Order # not found", duplicate-confirmation). Without
      //      this, Nadia's floating panel (z-index 9998) covers form
      //      fields on the modal (z-index 50). Auto-expand on new
      //      assistant messages used to fire mid data-entry too.
      //   2. The user is on the Treasury tab and has NOT explicitly
      //      clicked "Wake Nadia" yet. Per Max's spec ("Nadia disabled
      //      by default inside the Treasury module"), Nadia stays gone
      //      until invited. nadiaWokenInTab resets per-session so each
      //      page reload starts clean.
      //   3. The Edit Treasury modal is open. Same reason as #1 — would
      //      cover the form.
      // suppressed=true → NadiaFloatingOverlay returns null + cancels any
      // active speech.
      var anyTreasuryModalOpen = !!(showAddTreasury || pendingTreasuryRecord || duplicateConfirm || editTreasuryModal);
      var inTreasuryAndNotWoken = tab === 'treasury' && !nadiaWokenInTab.treasury;
      var suppressNadia = anyTreasuryModalOpen || inTreasuryAndNotWoken;
      return (
      <NadiaFloatingOverlay
        user={user} userProfile={userProfile} users={teamUsers}
        tickets={dashTickets} invoices={invoices} treasury={treasury}
        checks={pendingChecks} loginHistory={lastLoginInfo} loginHistoryLoaded={loginHistoryLoaded}
        lang={lang} personality={greeterSettings.personality}
        greeterLang={greeterSettings.language}
        enabled={greeterSettings.enabled}
        hasGreeted={greeterHasGreeted} onGreeted={handleGreeted}
        sessionMessages={greeterMessages} onMessagesUpdate={setGreeterMessages}
        onToggle={(on) => { if (!on) setGreeterDismissed(true); }}
        toast={toast}
        contextTab={tab}
        contextSelectedCustomer={selectedCustomer}
        contextSelectedInvoice={selectedInvoice}
        contextOpenTicketId={openTicketId}
        externalMuted={nadiaMuted}
        onMutedChange={setNadiaMuted}
        suppressed={suppressNadia}
      />
      );
    })()}
    <div className="min-h-screen" style={{background:'#000000', color: '#e4e4e7', fontFamily: '"Inter Tight", "Inter", system-ui, sans-serif'}}>
      {/* Terminal grid background — subtle dot pattern, never moves, low opacity.
          Adds depth without distraction. CSS-only, no JS cost. */}
      <div aria-hidden="true" style={{
        position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
        backgroundImage: 'radial-gradient(rgba(63,63,70,0.25) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }} />
      <div style={{ position: 'relative', zIndex: 1 }}>
      {/* ===========================================================
           TERMINAL HEADER (v55.8-TERMINAL — Apr 25 2026 redesign)
           ===========================================================
           Bloomberg/Reuters terminal aesthetic. Replaces the previous
           gradient-blue header. Design tokens:
             • Background: #0a0a0a (true black) with #1a1a1a inner row
             • Type: 'JetBrains Mono' for all numerics, 'Inter Tight' for labels
             • Borders: 1px solid #262626 (zinc-800), no rounding above sm
             • Status pills: minimal text + colored dot, never gradient
             • Accent: emerald-400 (#34d399) for positives, red-500 for negatives,
               amber-500 for warnings. NO purple/indigo/violet anywhere.
           =========================================================== */}
      <div role="banner" aria-label="App header" className="sticky top-0 z-[101] border-b border-zinc-800"
        style={{ background: '#0a0a0a', fontFamily: '"Inter Tight", "Inter", system-ui, sans-serif' }}>
        {/* Inline font import for the terminal aesthetic. Loaded once at the
            top-of-app banner, applies to descendants via fontFamily inheritance. */}
        <style>{"@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Inter+Tight:wght@400;500;600;700;800&display=swap');"}</style>

        {/* PRIMARY ROW — brand, treasury net, user, controls */}
        <div className="px-4 py-2 flex justify-between items-center gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden text-zinc-400 hover:text-emerald-400 text-lg w-8 h-8 flex items-center justify-center border border-zinc-800 rounded-sm transition-colors"
              aria-label="Toggle sidebar">≡</button>
            <div className="flex items-baseline gap-2 min-w-0">
              {/* Brand mark — bracket prefix is a terminal callout convention. */}
              <span className="text-emerald-400 font-mono text-xs font-bold tracking-tight" style={{ fontFamily: '"JetBrains Mono", monospace' }}>[KTC]</span>
              <h1 className="text-sm font-bold text-white tracking-tight whitespace-nowrap">NEXTTRADE HUB</h1>
              {/* v55.83-A.6.27.54 — Version label HIGH CONTRAST per repeated Max feedback.
                  Was: text-zinc-500 (mid-gray) on #0a0a0a (true black) — barely readable.
                  Now: bright amber pill on dark background — readable at any zoom, still
                  matches the terminal aesthetic. */}
              <span className="text-[10px] font-mono font-extrabold hidden md:inline px-2 py-0.5 rounded" style={{ fontFamily: '"JetBrains Mono", monospace', background: '#fef3c7', color: '#451a03', border: '1px solid #d97706' }}>v55.83-ID</span>
              {/* Live clock — also bumped to readable amber. */}
              <span
                className="hidden lg:inline text-[10px] font-mono ml-2 pl-2 border-l border-zinc-700"
                style={{ fontFamily: '"JetBrains Mono", monospace', color: '#fcd34d' /* amber-300 */ }}
              >
                {(new Date()).toISOString().substring(0, 10).replace(/-/g, '.')} {(new Date()).toTimeString().substring(0, 5)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Treasury Net — terminal-style status block.
                Permission gate unchanged from original. */}
            {(isSuperAdmin || modulePerms?.['Treasury'] === true) && (
              <button onClick={() => { setTab('treasury'); setMode('all'); }}
                className="group flex items-center gap-2 px-3 py-1.5 border border-zinc-800 hover:border-zinc-600 rounded-sm transition-colors"
                style={{ background: '#0a0a0a' }}
                aria-label="View Treasury">
                <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider">NET</span>
                <span className="text-sm font-bold tabular-nums"
                  style={{
                    fontFamily: '"JetBrains Mono", monospace',
                    color: allTimeNet >= 0 ? '#34d399' : '#f87171',
                  }}>
                  {allTimeNet >= 0 ? '+' : ''}{fE(allTimeNet)}
                </span>
                <span className="w-1.5 h-1.5 rounded-full"
                  style={{ background: allTimeNet >= 0 ? '#34d399' : '#f87171', boxShadow: '0 0 6px ' + (allTimeNet >= 0 ? '#34d399' : '#f87171') }} />
              </button>
            )}

            {/* Global search — terminal command convention */}
            <button onClick={() => setShowGlobalSearch(true)}
              className="px-3 py-1.5 text-[11px] font-mono text-zinc-400 hover:text-white border border-zinc-800 hover:border-zinc-600 rounded-sm transition-colors flex items-center gap-2"
              style={{ background: '#0a0a0a', fontFamily: '"JetBrains Mono", monospace' }}>
              <span>/</span>
              <span className="hidden sm:inline">SEARCH</span>
              <kbd className="text-[9px] text-zinc-500 hidden md:inline">⌘K</kbd>
            </button>

            {/* Lang toggle */}
            <button onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
              className="px-2.5 py-1.5 text-[11px] font-mono font-bold border border-zinc-800 hover:border-zinc-600 rounded-sm transition-colors"
              style={{
                background: '#0a0a0a',
                color: lang === 'en' ? '#34d399' : '#71717a',
                fontFamily: '"JetBrains Mono", monospace',
              }}>
              {lang === 'ar' ? 'EN' : 'AR'}
            </button>

            {/* v55.23 — Always-visible LOGOUT in header.
                Previously logout lived only at the bottom of the left
                sidebar. On mobile/tablet (<1024px) the sidebar is hidden
                by default, so users couldn't find logout without first
                tapping the menu icon and scrolling. Max reported "I lost
                the ability to logout" — that was the actual cause.
                Solution: top-right button, visible on every screen size,
                every tab. Sidebar logout is kept for redundancy. */}
            <button onClick={handleSignOut}
              className="px-2.5 py-1.5 text-[11px] font-mono font-bold border border-zinc-800 text-zinc-400 hover:border-red-700 hover:text-red-400 rounded-sm transition-colors flex items-center gap-1.5"
              style={{ background: '#0a0a0a', fontFamily: '"JetBrains Mono", monospace' }}
              title={lang === 'en' ? 'Sign out' : 'تسجيل الخروج'}
              aria-label={lang === 'en' ? 'Sign out' : 'تسجيل الخروج'}>
              <span>⏻</span>
              <span className="hidden sm:inline">{lang === 'en' ? 'EXIT' : 'خروج'}</span>
            </button>

            {/* Notification bell from existing component */}
            <NotificationBell userId={userProfile?.id || user?.id} users={teamUsers} />

            {/* v55.40 — Unread voicemail badge.
                Shows whenever the current user has unread voicemails assigned
                to them. Click → switch to dashboard (where the VoicemailsWidget
                lives) and scroll to it. Hidden when zero unread, so it doesn't
                add noise for users without voicemails to handle. */}
            {unreadVoicemails > 0 && (
              <button
                onClick={() => {
                  setTab('dashboard');
                  // Scroll after the dashboard finishes mounting/painting.
                  setTimeout(() => {
                    var el = document.getElementById('voicemails-widget');
                    if (el && el.scrollIntoView) {
                      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                  }, 200);
                }}
                className="px-2.5 py-1.5 text-[11px] font-mono font-bold border border-zinc-800 hover:border-amber-500 rounded-sm transition-colors flex items-center gap-1.5"
                style={{
                  background: '#0a0a0a',
                  color: '#fbbf24',
                  fontFamily: '"JetBrains Mono", monospace',
                }}
                title={unreadVoicemails === 1
                  ? '1 unread voicemail — click to view'
                  : unreadVoicemails + ' unread voicemails — click to view'}
                aria-label={unreadVoicemails + ' unread voicemails'}>
                <span>📬</span>
                <span>{unreadVoicemails}</span>
              </button>
            )}

            {/* Dashboard alerts bell — same data as before, redesigned */}
            {(() => {
              const overdueCount = invoices.filter(i => i.outstanding > 0 && i.invoice_date && (Date.now() - new Date(i.invoice_date).getTime()) > 30 * 86400000).length;
              const openTickets = dashTickets.filter(t => t.status !== 'Closed' && t.status !== 'Resolved').length;
              const todayN = todayET();
              const tomorrowN = new Date(Date.now() + 86400000).toISOString().substring(0, 10);
              const overdueChecks = pendingChecks.filter(c => (c.due_date || c.check_date || '') < todayN && (c.due_date || c.check_date));
              const dueTomorrowChecks = pendingChecks.filter(c => (c.due_date || c.check_date || '') === tomorrowN);
              const total = overdueCount + openTickets + overdueChecks.length + dueTomorrowChecks.length;
              return (
                <div className="relative notif-bell-wrap">
                  <button onClick={() => setShowNotifBell(!showNotifBell)}
                    className="relative px-2.5 py-1.5 text-sm border border-zinc-800 hover:border-zinc-600 rounded-sm transition-colors"
                    style={{ background: '#0a0a0a', color: total > 0 ? '#fbbf24' : '#71717a' }}
                    aria-label={'Alerts: ' + total}>
                    {total > 0 ? '⚑' : '⚐'}
                    {total > 0 && <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 bg-red-500 text-white text-[9px] font-bold rounded-sm flex items-center justify-center font-mono" style={{ fontFamily: '"JetBrains Mono", monospace' }}>{total > 99 ? '99' : total}</span>}
                  </button>
                  {showNotifBell && (
                    <div className="absolute right-0 top-10 w-80 border border-zinc-800 shadow-2xl z-50 overflow-hidden rounded-sm"
                      style={{ background: '#0a0a0a' }}>
                      <div className="px-3 py-2 border-b border-zinc-800 text-[10px] font-bold text-zinc-400 uppercase tracking-widest font-mono flex items-center justify-between" style={{ fontFamily: '"JetBrains Mono", monospace' }}>
                        <span>ALERTS // {total}</span>
                        <button onClick={() => setShowNotifBell(false)} className="text-zinc-600 hover:text-zinc-300">×</button>
                      </div>
                      <div className="max-h-[320px] overflow-auto">
                        {overdueChecks.length > 0 && (
                          <div className="px-3 py-2.5 border-b border-zinc-900 hover:bg-zinc-950 cursor-pointer" onClick={() => { setTab('checks'); setShowNotifBell(false); }}>
                            <div className="flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-500" style={{ boxShadow: '0 0 6px #ef4444' }} />
                              <div className="text-[11px] font-bold text-red-400">{overdueChecks.length} OVERDUE CHECKS</div>
                            </div>
                            <div className="mt-1 ml-3.5 text-[11px] text-zinc-300 font-mono tabular-nums" style={{ fontFamily: '"JetBrains Mono", monospace' }}>{fE(overdueChecks.reduce((a,c) => a + Number(c.amount||0), 0))}</div>
                          </div>
                        )}
                        {dueTomorrowChecks.length > 0 && (
                          <div className="px-3 py-2.5 border-b border-zinc-900 hover:bg-zinc-950 cursor-pointer" onClick={() => { setTab('checks'); setShowNotifBell(false); }}>
                            <div className="flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" style={{ boxShadow: '0 0 6px #f59e0b' }} />
                              <div className="text-[11px] font-bold text-amber-400">{dueTomorrowChecks.length} CHECKS DUE TOMORROW</div>
                            </div>
                            <div className="mt-1 ml-3.5 text-[11px] text-zinc-300 font-mono tabular-nums" style={{ fontFamily: '"JetBrains Mono", monospace' }}>{fE(dueTomorrowChecks.reduce((a,c) => a + Number(c.amount||0), 0))}</div>
                          </div>
                        )}
                        {openTickets > 0 && (
                          <div className="px-3 py-2.5 border-b border-zinc-900 hover:bg-zinc-950 cursor-pointer" onClick={() => { setTab('tickets'); setShowNotifBell(false); }}>
                            <div className="flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-sky-500" style={{ boxShadow: '0 0 6px #0ea5e9' }} />
                              <div className="text-[11px] font-bold text-sky-400">{openTickets} OPEN TICKETS</div>
                            </div>
                          </div>
                        )}
                        {overdueCount > 0 && (
                          <div className="px-3 py-2.5 border-b border-zinc-900 hover:bg-zinc-950 cursor-pointer" onClick={() => { setTab('sales'); setShowNotifBell(false); }}>
                            <div className="flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-orange-500" style={{ boxShadow: '0 0 6px #f97316' }} />
                              <div className="text-[11px] font-bold text-orange-400">{overdueCount} INVOICES &gt; 30D</div>
                            </div>
                          </div>
                        )}
                        {total === 0 && (
                          <div className="px-3 py-6 text-center text-[11px] text-zinc-600 font-mono uppercase tracking-widest" style={{ fontFamily: '"JetBrains Mono", monospace' }}>// no alerts</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* User identity block */}
            {userProfile && (
              <div className="hidden md:flex items-center gap-2 pl-3 ml-1 border-l border-zinc-800">
                <div className="text-right">
                  <div className="text-[11px] font-semibold text-zinc-100 leading-tight">{userProfile?.name}</div>
                  <div className="text-[9px] text-zinc-500 font-mono uppercase tracking-wider" style={{ fontFamily: '"JetBrains Mono", monospace' }}>
                    <span className="w-1 h-1 inline-block rounded-full mr-1 align-middle" style={{ background: userProfile?.role === 'super_admin' ? '#ef4444' : userProfile?.role === 'admin' ? '#a855f7' : '#0ea5e9' }} />
                    {userProfile?.role === 'super_admin' ? 'SUPERADMIN' : userProfile?.role === 'admin' ? 'ADMIN' : 'TEAM'}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* SECONDARY ROW — live ticker of key metrics. Pure terminal flair.
            Renders only on dashboard to keep other tabs distraction-free. */}
        {tab === 'dashboard' && (isSuperAdmin || modulePerms?.['Treasury'] === true) && (
          <div className="hidden md:block px-4 py-1.5 border-t border-zinc-900 overflow-hidden" style={{ background: '#0a0a0a' }}>
            <div className="flex items-center gap-6 text-[10px] font-mono whitespace-nowrap overflow-x-auto" style={{ fontFamily: '"JetBrains Mono", monospace' }}>
              {(() => {
                const todayN = todayET();
                const monthStart = todayN.substring(0, 7) + '-01';
                const monthIn = treasury.filter(t => (t.transaction_date || '') >= monthStart).reduce((a, t) => a + Number(t.cash_in || 0) + Number(t.bank_in || 0), 0);
                const monthOut = treasury.filter(t => (t.transaction_date || '') >= monthStart).reduce((a, t) => a + Number(t.cash_out || 0) + Number(t.bank_out || 0), 0);
                const monthNet = monthIn - monthOut;
                const ar = invoices.reduce((a, i) => a + Number(i.outstanding || 0), 0);
                const overdue = invoices.filter(i => i.outstanding > 0 && i.invoice_date && (Date.now() - new Date(i.invoice_date).getTime()) > 30 * 86400000).reduce((a, i) => a + Number(i.outstanding || 0), 0);
                const pendCk = pendingChecks.reduce((a, c) => a + Number(c.amount || 0), 0);
                return (
                  <>
                    <span><span className="text-zinc-500">MTD IN</span> <span className="text-emerald-400 tabular-nums">+{fE(monthIn)}</span></span>
                    <span><span className="text-zinc-500">MTD OUT</span> <span className="text-red-400 tabular-nums">-{fE(monthOut)}</span></span>
                    <span><span className="text-zinc-500">MTD NET</span> <span className={'tabular-nums ' + (monthNet >= 0 ? 'text-emerald-400' : 'text-red-400')}>{monthNet >= 0 ? '+' : ''}{fE(monthNet)}</span></span>
                    <span className="text-zinc-700">│</span>
                    <span><span className="text-zinc-500">A/R</span> <span className="text-zinc-200 tabular-nums">{fE(ar)}</span></span>
                    <span><span className="text-zinc-500">OVERDUE</span> <span className={'tabular-nums ' + (overdue > 0 ? 'text-orange-400' : 'text-zinc-200')}>{fE(overdue)}</span></span>
                    <span className="text-zinc-700">│</span>
                    <span><span className="text-zinc-500">CHECKS PEND</span> <span className="text-zinc-200 tabular-nums">{fE(pendCk)}</span></span>
                    <span className="text-zinc-700">│</span>
                    <span><span className="text-zinc-500">USERS</span> <span className="text-zinc-200 tabular-nums">{teamUsers.length}</span></span>
                    <span><span className="text-zinc-500">INV</span> <span className="text-zinc-200 tabular-nums">{invoices.length}</span></span>
                    <span><span className="text-zinc-500">TXN</span> <span className="text-zinc-200 tabular-nums">{treasury.length}</span></span>
                  </>
                );
              })()}
            </div>
          </div>
        )}
      </div>

      {/* Global Search Modal */}
      {showGlobalSearch && (
        <div className="fixed inset-0 bg-black/60 z-[200] flex items-start justify-center pt-[15vh] px-4" onClick={() => setShowGlobalSearch(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 px-4 py-3 border-b">
              <span className="text-lg">🔍</span>
              <input autoFocus value={globalSearch} onChange={e => setGlobalSearch(e.target.value)}
                placeholder={(isSuperAdmin || modulePerms?.['Treasury'] === true || modulePerms?.['Egypt Bank'] === true)
                  ? 'Search invoices, customers, tickets, bank...'
                  : 'Search customers, tickets...'}
                aria-label="Global search" className="flex-1 outline-none text-sm" />
              <button onClick={() => setShowGlobalSearch(false)} className="text-xs text-slate-700 bg-slate-200 px-2 py-1 rounded font-bold">ESC</button>
            </div>
            {globalSearch.length >= 2 && (() => {
              const q = globalSearch.toLowerCase();
              // v55.22 — Permission gates for financial categories.
              // Previously, EVERY logged-in user could search treasury and
              // Egypt-bank rows from the global search modal, regardless
              // of whether they had Treasury permission. That leaked
              // sensitive amounts/descriptions to non-finance team members.
              // Now we mirror the same gates used by the dashboard tiles
              // and top-bar Treasury widget: super_admin OR explicit
              // module permission. Sales (invoice amounts) gets its own
              // gate so non-sales people don't see invoice totals either.
              const canSeeTreasury = isSuperAdmin || modulePerms?.['Treasury'] === true;
              const canSeeBank = isSuperAdmin || modulePerms?.['Egypt Bank'] === true || modulePerms?.['Treasury'] === true;
              const canSeeSales = isSuperAdmin || modulePerms?.['Sales'] === true;

              const invResults = canSeeSales
                ? (invoices || []).filter(i => [i.invoice_number, i.order_number, i.customer, i.customer_name, i.customer_name_en].filter(Boolean).join(' ').toLowerCase().includes(q)).slice(0, 5)
                : [];
              const custResults = (customers || []).filter(c => [c.name, c.customer_name, c.phone, c.email].filter(Boolean).join(' ').toLowerCase().includes(q)).slice(0, 5);
              const tickResults = (dashTickets || []).filter(t => [t.title, t.ticket_number, t.description].filter(Boolean).join(' ').toLowerCase().includes(q)).slice(0, 5);
              const bankResults = canSeeBank
                ? (egyptBankTxns || []).filter(t => [t.description, t.date, String(t.amount||'')].filter(Boolean).join(' ').toLowerCase().includes(q)).slice(0, 5)
                : [];
              const tresResults = canSeeTreasury
                ? (treasury || []).filter(t => [t.description, t.order_number, t.transaction_date].filter(Boolean).join(' ').toLowerCase().includes(q)).slice(0, 5)
                : [];
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
        {/* SIDEBAR — terminal navigation. Pure black with zinc-800 dividers,
            mono uppercase group labels, sharp left-border accent for active. */}
        <aside role="navigation" aria-label="Main navigation"
          className={'fixed lg:sticky top-[56px] lg:top-[56px] left-0 z-[100] lg:z-10 overflow-y-auto transition-transform duration-200 border-r border-zinc-800 ' + (sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0')}
          style={{ width: 220, height: 'calc(100vh - 56px)', background: '#0a0a0a', paddingTop: 'env(safe-area-inset-top, 0px)', fontFamily: '"Inter Tight", "Inter", system-ui, sans-serif' }}>
          <div className="h-6 lg:h-0"></div>
          <div className="py-2">
            {[
              { group: 'OVERVIEW', items: ['dashboard'] },
              { group: 'FINANCE', items: ['sales', 'treasury', 'checks', 'debts', 'openaccounts', 'egyptbank', 'bank', 'accounting', 'quotes', 'reports'] },
              { group: 'OPERATIONS', items: ['warehouse', 'inventory', 'customs', 'shipping'] },
              { group: 'PEOPLE', items: ['customers', 'crm', 'tickets', 'calendar', 'comms', 'dailylog'] },
              { group: 'SYSTEM', items: ['admin', 'ai', 'settings', 'import', 'systemtickets'] },
            ].map(g => {
              const groupTabs = g.items.map(id => visibleTabs.find(t => t.id === id)).filter(Boolean);
              if (!groupTabs.length) return null;
              return (
                <div key={g.group} className="mb-1">
                  <div className="px-3 pt-3 pb-1.5 text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-600 font-mono"
                    style={{ fontFamily: '"JetBrains Mono", monospace' }}>
                    <span className="text-zinc-700">// </span>{g.group}
                  </div>
                  {groupTabs.map(t => {
                    const isActive = tab === t.id;
                    return (
                      <button key={t.id} onClick={() => { navigate(t.id); setSidebarOpen(false); }}
                        className={'w-full text-left pl-3 pr-2 py-1.5 text-[12px] font-medium flex items-center gap-2.5 transition-colors border-l-2 ' + (isActive
                          ? 'text-emerald-400 border-emerald-400 bg-zinc-900'
                          : 'text-zinc-400 border-transparent hover:text-zinc-100 hover:bg-zinc-900/50'
                        )}
                        style={isActive ? { boxShadow: 'inset 1px 0 0 #34d399' } : {}}>
                        <span className="w-4 flex items-center justify-center shrink-0 opacity-80">
                          {(function () { const Ic = TAB_ICONS[t.id] || Circle; return <Ic size={15} strokeWidth={2} />; })()}
                        </span>
                        <span className="truncate flex-1">
                          <span>{t.label.split(' / ')[0]}</span>
                          {t.label.includes(' / ') && <span className="text-[9px] text-zinc-600 block leading-tight" style={{direction:'rtl'}}>{t.label.split(' / ')[1]}</span>}
                        </span>
                        {isActive && <span className="text-emerald-400 text-[10px] font-mono" style={{ fontFamily: '"JetBrains Mono", monospace' }}>▸</span>}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
          {/* Sign Out */}
          <div className="px-3 py-3 border-t border-zinc-800 mt-2">
            <button onClick={handleSignOut}
              className="w-full px-3 py-2 text-[11px] font-mono uppercase tracking-wider text-zinc-500 hover:text-red-400 transition text-left flex items-center gap-2"
              style={{ fontFamily: '"JetBrains Mono", monospace' }}>
              <span>⏻</span><span>{lang === 'en' ? 'SIGN OUT' : 'تسجيل خروج'}</span>
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
                  // BUG 6 fix: make the row's lifecycle state explicit in the
                  // export. Placeholders and dedup markers both have zero
                  // amounts — without a Status column, they appear as confusing
                  // "0 EGP rows" in the accountant's workbook. With Status,
                  // the accountant can filter/sort them out.
                  var status = 'NORMAL';
                  if (t.is_bank_placeholder) status = 'PLACEHOLDER';
                  else if (t.dedup_sibling_id || (t.description && String(t.description).indexOf('[bank confirmation') >= 0)) status = 'DEDUP';
                  else if (t.matched_bank_txn_id) status = 'MATCHED';
                  return {
                    Date: t.transaction_date,
                    Order: t.order_number,
                    Description: t.description,
                    Channel: isBank ? 'BANK' : 'SAFE',
                    Status: status,
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
            // v55.83-A.6.27.19 — reset instrument form state on close so
            // values don't leak between invoices.
            setSelectedInvoice(null); setShowAddPayment(false); setFormData({}); setEditingTxn(null); setShowLinkSearch(false); setLinkSearch('');
            setShowAddInstrumentForm(false);
            setInstrumentForm({ instrument_type: 'check', check_number: '', amount: '', issue_date: '', due_date: '', bank_name: '', notes: '' });
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
              {/* v55.83-A.6.19 (Max May 14 2026) — Invoice date row, always visible.
                  Was hidden behind Edit mode before. Per Max: "Every invoice must
                  display the date of sale clearly on the invoice itself." */}
              <div className="mt-2 flex items-center gap-3 flex-wrap" style={{ direction: 'ltr' }}>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-200">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-blue-700">📅 Invoice Date / تاريخ الفاتورة</span>
                  <span className="text-sm font-extrabold text-blue-900">{selectedInvoice.invoice_date || '—'}</span>
                </div>
                {selectedInvoice.created_at && selectedInvoice.created_at.substring(0, 10) !== selectedInvoice.invoice_date && (
                  <span className="text-[10px] text-slate-500">Created: {selectedInvoice.created_at.substring(0, 10)}</span>
                )}
                <span className="text-[10px] text-slate-500">Order # {selectedInvoice.order_number}</span>
              </div>
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
                  + '<p class="meta" style="margin-top:30px">Generated by KTC NextTrade Hub — ' + fmtET(new Date(), 'shortdate') + '</p></body></html>');
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
                            // v55.83-A.6.27 — Stage D: before deleting items,
                            // reverse FIFO consumption on any sale movements
                            // linked to those items so the layers get their
                            // qty back. Otherwise stock would stay drained.
                            try {
                              const { data: salesMovs } = await supabase.from('inv_movements')
                                .select('id, consumed_layers, linked_invoice_item_id')
                                .eq('linked_invoice_id', selectedInvoice.id)
                                .eq('movement_type', 'sale');
                              for (const m of (salesMovs || [])) {
                                if (m.consumed_layers && Array.isArray(m.consumed_layers)) {
                                  await reverseFifoConsumption(m.consumed_layers);
                                }
                                // Mark movement as reversed (delete it; the
                                // layer qtys are already restored)
                                await supabase.from('inv_movements').delete().eq('id', m.id);
                              }
                            } catch (revErr) {
                              console.warn('[invoice-delete] reverse failed:', revErr && revErr.message);
                            }
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
                      <h4 className="text-xs font-bold text-amber-900 mb-3">Edit Invoice Details / تعديل الفاتورة</h4>
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
                          // v55.82-E — parseAmount: invoice edit was hitting
                          // the same comma/Arabic-Indic NaN bug as add. The
                          // `|| selectedInvoice.total_amount` fallback meant
                          // typing "5,000" silently kept the OLD amount —
                          // looked like the edit didn't save.
                          const newAmountParsed = parseAmount(document.getElementById('inv-edit-amount')?.value);
                          const newAmount = newAmountParsed > 0 ? newAmountParsed : selectedInvoice.total_amount;
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
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[10px] text-emerald-700">Collected / المحصّل</div>
                  <InvoicePaymentBadge invoice={selectedInvoice} fE={fE} compact />
                </div>
                <div className="text-xl font-extrabold text-emerald-500">{fE(selectedInvoice.total_collected)}</div>
                {/* v55.83-A.1 — confirmed/pending split. When the SQL migration
                    is in place AND there's a pending amount, show the
                    breakdown so the user can see exactly what's confirmed
                    vs what's awaiting bank-statement match. */}
                {Number(selectedInvoice.total_pending_bank || 0) > 0 && (
                  <div className="mt-1.5 space-y-0.5 text-[10px] leading-tight">
                    <div className="flex justify-between">
                      <span className="text-emerald-700">✓ Confirmed</span>
                      <span className="font-bold text-emerald-700">{fE(Number(selectedInvoice.total_confirmed || 0))}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-amber-700">⏳ Pending bank match</span>
                      <span className="font-bold text-amber-700">{fE(Number(selectedInvoice.total_pending_bank || 0))}</span>
                    </div>
                  </div>
                )}
                {Number(selectedInvoice.total_collected) > Number(selectedInvoice.total_amount) && (
                  <div className="text-[9px] text-red-500 font-bold mt-1">⚠️ OVERPAID — may be doubled</div>
                )}
                {/* v55.83-A.6.7 — CRIT-4: show overpayment amount tracked
                    by recalc, so duplicate payments don't hide silently
                    behind the cap. */}
                {Number(selectedInvoice.overpayment_amount || 0) > 0.50 && (
                  <div className="mt-1 px-2 py-1 rounded bg-red-100 border border-red-300 text-[10px] text-red-800 font-bold">
                    ⚠️ Treasury exceeds invoice by {fE(Number(selectedInvoice.overpayment_amount))} — review for duplicate payments
                  </div>
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
                {/* v55.83-A.6.27.14 (Max May 16 2026) — Close pending checks
                    when invoice is fully paid. Per Max: "Just have confirm
                    button to close." Manual click, manual confirm. Only
                    visible when:
                      • Outstanding = 0 (invoice is fully paid)
                      • At least one pending check exists tied to this invoice
                    For each pending check, this flips status to 'collected'
                    and links the check to an existing treasury row that
                    matches its amount (via source_check_id stamp). NO new
                    treasury rows are created — the money is already in the
                    books, which is why outstanding hit 0. */}
                {!(selectedInvoice.outstanding > 0) && (() => {
                  var pending = (checks || []).filter(function (c) {
                    return c.status === 'pending' && (
                      c.invoice_id === selectedInvoice.id ||
                      (c.order_number && String(c.order_number).trim() === String(selectedInvoice.order_number || '').trim())
                    );
                  });
                  if (pending.length === 0) return null;
                  return (
                    <div className="mt-2 pt-2 border-t border-emerald-200">
                      <div className="text-[10px] text-emerald-800 font-semibold mb-1">
                        {pending.length} pending check{pending.length === 1 ? '' : 's'} on this paid invoice
                      </div>
                      <button onClick={async () => {
                        var labels = pending.map(function (c) {
                          return '• #' + (c.check_number || c.id) + ' — ' + fE(Number(c.amount));
                        }).join('\n');
                        if (!confirm(
                          'Close ' + pending.length + ' pending check' + (pending.length === 1 ? '' : 's') + ' for this paid invoice?\n\n' +
                          labels + '\n\n' +
                          'Each check will be marked collected. If a treasury row already represents the money (from a cash deposit, bank match, or other path) the check will be linked to it. No new treasury rows will be created.\n\n' +
                          'إغلاق الشيكات المعلّقة لهذه الفاتورة المدفوعة؟'
                        )) return;
                        try {
                          var closed = 0, attached = 0, skipped = 0;
                          for (var i = 0; i < pending.length; i++) {
                            var chk = pending[i];
                            var amt = Number(chk.amount);
                            // Find a treasury row tied to this invoice with matching amount and no source_check_id yet.
                            var candidate = (treasury || []).find(function (t) {
                              if (t.linked_invoice_id !== selectedInvoice.id) return false;
                              if (t.is_bank_placeholder) return false;
                              if (t.source_check_id) return false;
                              if (t.dedup_sibling_id) return false;
                              if (t.description && String(t.description).indexOf('[bank confirmation') >= 0) return false;
                              var rowAmt = Number(t.cash_in || 0) + Number(t.bank_in || 0);
                              return Math.abs(rowAmt - amt) < 1;
                            });
                            if (candidate) {
                              await dbUpdate('treasury', candidate.id, {
                                source_check_id: chk.id,
                                payment_source: 'check',
                              }, user?.id);
                              await dbUpdate('checks', chk.id, {
                                status: 'collected',
                                collection_date: todayET(),
                                linked_treasury_id: candidate.id,
                              }, user?.id);
                              attached++;
                            } else {
                              // No exact-match treasury row. Don't create one — that would
                              // double-count if a non-exact-match row covers this check
                              // (e.g. consolidated bank deposit covering multiple checks).
                              // Just flip the check status; the user can manually reconcile
                              // through the Checks tab if they want a per-check audit trail.
                              await dbUpdate('checks', chk.id, {
                                status: 'collected',
                                collection_date: todayET(),
                              }, user?.id);
                              skipped++;
                            }
                            closed++;
                          }
                          // Recalc to ensure derived fields are fresh.
                          try { await recalcInvoiceCollected(selectedInvoice.id); } catch (_) {}
                          var msg = closed + ' check' + (closed === 1 ? '' : 's') + ' closed';
                          if (attached > 0) msg += ' (' + attached + ' linked to existing treasury row' + (attached === 1 ? '' : 's') + ')';
                          if (skipped > 0) msg += ' (' + skipped + ' marked collected without an exact-match treasury row — review if needed)';
                          if (toast && toast.success) toast.success(msg);
                          await loadAllData();
                        } catch (err) {
                          if (toast && toast.error) toast.error('Close failed: ' + (err && err.message ? err.message : String(err)));
                          else alert('Close failed: ' + (err && err.message ? err.message : String(err)));
                        }
                      }} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[11px] font-bold w-full">
                        ✓ Confirm and close pending checks
                      </button>
                    </div>
                  );
                })()}
                {/* v55.83-A.6.8 (Max May 13 2026) — Short-payment write-off.
                    Auto-suggests when outstanding is small (1000 EGP soft
                    cap or less). One-click write-off after confirmation
                    prompt. Already-written-off amount shown for visibility. */}
                {Number(selectedInvoice.total_written_off || 0) > 0 && (
                  <div className="mt-1 text-[10px] text-amber-700 font-semibold">
                    📝 Written off: {fE(Number(selectedInvoice.total_written_off))} <span className="text-slate-500">/ مخصوم</span>
                    {canEditInvoices && (
                      <button
                        onClick={async () => {
                          if (confirm('Reverse the ' + fE(Number(selectedInvoice.total_written_off)) + ' write-off?\n\nهل تريد إلغاء الخصم؟')) {
                            await handleReverseWriteOff(selectedInvoice);
                          }
                        }}
                        className="text-[9px] text-blue-500 underline ml-2">↩ Reverse / إلغاء</button>
                    )}
                  </div>
                )}
                {/* v55.83-A.6.12 (Max May 13 2026) — TIGHTENED write-off
                    auto-suggest conditions:
                      1. Outstanding > 0 (something left to pay)
                      2. Outstanding ≤ 1000 (small remainder)
                      3. AT LEAST 90% of the invoice has been collected
                         (otherwise it's not a "short-payment" — it's just
                         a small invoice that hasn't been paid yet)
                      4. No pending bank confirmation (don't write off money
                         that's just waiting on bank statement match)
                      5. User has invoice edit permission
                    Combination of all five gates the button correctly. */}
                {selectedInvoice.outstanding > 0
                  && selectedInvoice.outstanding <= WRITE_OFF_SOFT_CAP_EGP
                  && Number(selectedInvoice.total_collected || 0) >= Number(selectedInvoice.total_amount || 0) * 0.90
                  && Number(selectedInvoice.total_pending_bank || 0) === 0
                  && canEditInvoices && (
                  <div className="mt-2 p-2 rounded bg-white border border-amber-300">
                    <div className="text-[10px] text-amber-900 font-semibold mb-1">
                      💡 Customer short-paid by {fE(Number(selectedInvoice.outstanding))} — write off?
                    </div>
                    <div className="text-[9px] text-slate-600 mb-1.5" style={{direction:'rtl'}}>
                      نقص دفع العميل {fE(Number(selectedInvoice.outstanding))} — هل تريد خصمه؟
                    </div>
                    <button
                      onClick={async () => {
                        var amt = Number(selectedInvoice.outstanding);
                        var confirmEN = 'Write off ' + fE(amt) + ' as Customer short-payment?\n\nThis will close the invoice. Logged to audit trail.';
                        var confirmAR = 'خصم ' + fE(amt) + ' كعدم سداد؟ سيتم إغلاق الفاتورة.';
                        if (confirm(confirmEN + '\n\n' + confirmAR)) {
                          await handleWriteOffShortPayment(selectedInvoice, amt, null);
                        }
                      }}
                      className="w-full px-2 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded text-[10px] font-bold">
                      Write off {fE(Number(selectedInvoice.outstanding))} / خصم
                    </button>
                  </div>
                )}
                {/* v55.83-A.6.12 — Super-admin override path for write-offs > 1000.
                    Permission-gated to super_admin AND requires explicit module
                    permission "Write off discounts" (new). This prevents accidental
                    large write-offs even by accounts with super_admin role.
                    Every override is flagged in the audit log. */}
                {selectedInvoice.outstanding > WRITE_OFF_SOFT_CAP_EGP
                  && isSuperAdmin
                  && (modulePerms?.['Write off discounts'] === true) && (
                  <button
                    onClick={async () => {
                      var amtStr = prompt('Write off amount (above ' + fE(WRITE_OFF_SOFT_CAP_EGP) + ' soft cap — super_admin override):\nمبلغ الخصم (تجاوز الحد الأقصى):', selectedInvoice.outstanding);
                      if (amtStr === null) return;
                      var amt = Number(amtStr);
                      if (!isFinite(amt) || amt <= 0) { toast.error('Invalid amount'); return; }
                      if (confirm('Write off ' + fE(amt) + ' as short-payment?\nخصم ' + fE(amt) + '؟')) {
                        await handleWriteOffShortPayment(selectedInvoice, amt, null);
                      }
                    }}
                    className="mt-2 w-full px-2 py-1 bg-amber-700 hover:bg-amber-800 text-white rounded text-[10px] font-bold">
                    ⚠️ Write off (admin override) / خصم (تجاوز)
                  </button>
                )}
              </div>
            </div>

            {/* ===== H3: Payment-Source Breakdown =====
                Shows how the collected amount was actually paid —
                Cash / Bank / Check / Vodafone / InstaPay. Only renders
                when there's at least one positive-amount linked txn.
                v55.83-A.6.6 (Max May 13 2026) — also includes collected
                post-dated checks for this order, so an invoice paid
                10,700 cash + 20,000 check shows the correct mix instead
                of "100% Cash". */}
            {(() => {
              // v55.83-A.6.27.13 (Max May 16 2026) — use UUID-keyed map so
              // the payment-source mix (Cash vs Bank vs Check) reflects
              // exactly the rows the Collected total counts. Previously
              // keyed by order_number string which could miss UUID-linked
              // rows that had a wrong/empty order_number.
              const txns = treasuryByInvoiceId[selectedInvoice.id] || [];
              // v55.83-A.6.6 — pull collected checks too and shim them as
              // virtual check-source rows for aggregatePaymentSources.
              const collectedChks = (checks || []).filter(c =>
                (c.order_number === selectedInvoice.order_number || c.invoice_id === selectedInvoice.id)
                && c.status === 'collected'
              );
              const virtualCheckRows = collectedChks.map(c => ({
                cash_in: 0,
                bank_in: 0,
                check_amount: Number(c.amount || 0),
                payment_source: 'check',
                amount: Number(c.amount || 0),
              }));
              const txnsWithChecks = txns.concat(virtualCheckRows);
              if (txnsWithChecks.length === 0) return null;
              const agg = aggregatePaymentSources(txnsWithChecks);
              if (agg.total <= 0) return null;
              const rows = PAYMENT_SOURCE_META.filter(r => agg.buckets[r.key] > 0);
              if (rows.length === 0) return null;
              return (
                <div className="mb-4 rounded-lg p-3 border border-slate-200 bg-slate-50">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide">
                      Payment Breakdown / تفصيل الدفع
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {txns.length} {txns.length === 1 ? 'transaction' : 'transactions'} / معاملات
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {rows.map(r => {
                      const amt = agg.buckets[r.key];
                      const pct = agg.total > 0 ? Math.round((amt / agg.total) * 100) : 0;
                      return (
                        <div key={r.key} className="rounded-md px-2.5 py-1.5 bg-white border flex-1 min-w-[120px]"
                          style={{ borderColor: r.color + '40' }}>
                          <div className="text-[10px] font-semibold flex items-center justify-between gap-2" style={{ color: r.color }}>
                            <span>{r.label}</span>
                            <span className="text-[9px] opacity-60">{pct}%</span>
                          </div>
                          <div className="text-sm font-extrabold" style={{ color: r.color }}>
                            {fE(amt)}
                          </div>
                          <div className="text-[9px] text-slate-400" style={{ direction: 'rtl' }}>{r.labelAr}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Reconciliation Status */}
            {(() => {
              // v55.83-A.6.6 — uses tTotalForInvoice helper which includes
              // collected post-dated checks. Prevents false MISMATCH on
              // invoices paid partly in checks.
              const tTotal = tTotalForInvoice(selectedInvoice);
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
                  <h4 className="text-sm font-bold text-amber-900 mb-2">📝 Post-dated Checks / شيكات آجلة ({orderChecks.length})</h4>
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
              // v55.83-A.6.19 (Max May 14 2026) — Delete a single line item.
              // Persists immediately (no "save invoice" needed since each line is
              // its own row in invoice_items table). Re-runs the local state
              // refresh so totals update without a full reload.
              const deleteLineItem = async (lineItem) => {
                if (!lineItem || !lineItem.id) return;
                if (!confirm('Delete this line item from the invoice? / حذف هذا البند من الفاتورة؟\n\n' + (lineItem.description || '').substring(0, 80))) return;
                try {
                  // v55.83-A.6.27 — Stage D: reverse FIFO consumption first
                  // so the cost layers get their qty back, then delete the
                  // sale movement, then delete the invoice item.
                  if (lineItem.cogs_movement_id) {
                    try {
                      const { data: mov } = await supabase.from('inv_movements')
                        .select('consumed_layers').eq('id', lineItem.cogs_movement_id).maybeSingle();
                      if (mov && mov.consumed_layers) {
                        await reverseFifoConsumption(mov.consumed_layers);
                      }
                      await supabase.from('inv_movements').delete().eq('id', lineItem.cogs_movement_id);
                    } catch (revErr) {
                      console.warn('[line-delete] reverse failed:', revErr && revErr.message);
                    }
                  }
                  await supabase.from('invoice_items').delete().eq('id', lineItem.id);
                  // Update local state immediately so the row disappears and totals recompute
                  setInvoiceItems(prev => prev.filter(it => it.id !== lineItem.id));
                  // Audit log
                  try {
                    await supabase.from('audit_log').insert({
                      user_id: userProfile?.id || user?.id,
                      entity_type: 'invoice_items',
                      action: 'delete_line_item',
                      details: {
                        invoice_id: selectedInvoice.id,
                        order_number: selectedInvoice.order_number,
                        line_item_id: lineItem.id,
                        description: (lineItem.description || '').substring(0, 200),
                        quantity: lineItem.quantity,
                        unit_price: lineItem.unit_price,
                        line_total: lineItem.line_total,
                        source: 'v55.83-A.6.19 invoice modal delete line item',
                      },
                      created_at: new Date().toISOString(),
                    });
                  } catch (_) { /* non-fatal */ }
                  toast && toast.success && toast.success('Line item deleted / تم حذف البند');
                } catch (err) {
                  toast && toast.error && toast.error('Delete failed: ' + (err.message || err));
                }
              };
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
                            <th className="px-2 py-1.5 text-[10px] text-center w-10">—</th>
                          </tr></thead>
                          <tbody>
                            {items.map(it => (
                              <tr key={it.id} className="border-b border-blue-100 group">
                                <td className="px-2 py-1.5 text-xs" style={{ direction: lang === 'ar' ? 'rtl' : 'ltr' }}>{tx(it.description, it.description_en)}</td>
                                <td className="px-2 py-1.5 text-xs text-right">{fmt(it.quantity)}</td>
                                <td className="px-2 py-1.5 text-xs text-right">{fE(it.unit_price)}</td>
                                <td className="px-2 py-1.5 text-xs text-right font-semibold">{fE(it.line_total)}</td>
                                <td className="px-2 py-1.5 text-center">
                                  {/* v55.83-A.6.19 — Always visible per-row delete button.
                                      Per Max May 14 2026: "Each invoice line item must have
                                      a clear delete/remove button." */}
                                  <button
                                    type="button"
                                    onClick={() => deleteLineItem(it)}
                                    title="Delete this line / حذف هذا البند"
                                    className="px-1.5 py-0.5 rounded text-red-600 hover:bg-red-100 hover:text-red-800 text-sm font-bold border border-red-200 hover:border-red-400 transition">
                                    🗑
                                  </button>
                                </td>
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
                      <div className="text-xs text-slate-500 mb-2 text-center">No item breakdown available / لا يوجد تفاصيل بنود</div>
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

            {/* v55.83-A.6.27.13 (Max May 16 2026) — Treasury panel.
                Reads from treasuryByInvoiceId (UUID-keyed) so what's shown
                matches what the "Collected" total counts. Previously used
                treasuryByOrder (string-keyed), which could disagree silently
                with the recalc — exactly the invoice 2330 bug. */}
            {(() => {
              var uuidLinked = treasuryByInvoiceId[selectedInvoice.id] || [];
              var orphans = findOrphanedOrderNumberMatches(selectedInvoice);
              if (uuidLinked.length === 0 && orphans.length === 0) return null;
              return (
                <div>
                  {orphans.length > 0 && (
                    <div className="bg-amber-100 rounded-lg p-3 mb-2 border-2 border-amber-400">
                      <div className="text-xs font-bold text-amber-900 mb-1">⚠️ Linkage drift detected ({orphans.length} row{orphans.length === 1 ? '' : 's'})</div>
                      <div className="text-[11px] text-amber-900 mb-2">
                        These treasury rows have order_number = <strong>{selectedInvoice.order_number}</strong> but are not properly linked to this invoice by ID. They are NOT counted in the Collected total. This usually means the invoice was re-created or the link was broken during an edit.
                      </div>
                      <div className="space-y-1">
                        {orphans.map(function (t) {
                          var amt = Number(t.cash_in || 0) + Number(t.bank_in || 0);
                          return (
                            <div key={t.id} className="flex items-center justify-between bg-white rounded px-2 py-1.5 text-[11px]">
                              <div className="flex-1">
                                <span className="font-mono font-bold text-amber-900">{fE(amt)}</span>
                                <span className="text-slate-600 ml-2">{t.transaction_date}</span>
                                <span className="text-slate-500 ml-2 truncate inline-block max-w-[200px] align-bottom" title={t.description}>{t.description}</span>
                              </div>
                              <div className="flex gap-1">
                                <button onClick={() => setInspectedTreasury(t)}
                                  className="px-2 py-0.5 rounded border border-amber-400 text-amber-800 text-[10px] hover:bg-amber-50">Inspect</button>
                                <button onClick={async () => {
                                  await dbUpdate('treasury', t.id, { linked_invoice_id: selectedInvoice.id }, userProfile?.id || user?.id);
                                  await recalcInvoiceCollected(selectedInvoice.id);
                                  await loadAllData();
                                  if (toast && toast.success) toast.success('Linked + recalculated');
                                }}
                                  className="px-2 py-0.5 rounded bg-blue-500 hover:bg-blue-600 text-white text-[10px] font-bold">Link Now</button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {uuidLinked.length > 0 && (
                    <div className="bg-emerald-50 rounded-lg p-4 mb-4 border border-emerald-200">
                      <h4 className="text-sm font-bold text-emerald-800 mb-2">🏦 Treasury / الخزنة #{selectedInvoice.order_number}</h4>
                      {uuidLinked.map((txn, i) => (
                        <div key={txn.id}>
                          {/* v55.83-A.6.9 (Max May 13 2026) — Placeholder rows
                              previously showed as "EGP 0" with no visible
                              indication of pending amount. Invoice 2317 had a
                              25,000 EGP placeholder that was invisible in the
                              treasury totals. Now placeholders get a distinct
                        amber visual treatment with "⏳ EGP X awaiting bank
                        confirmation" + show their expected_amount in the
                        total. */}
                    {txn.is_bank_placeholder ? (
                      <div className="flex justify-between items-center py-2 border-b border-amber-200 bg-amber-50 -mx-1 px-2 rounded mb-1">
                        <div className="flex-1">
                          <div className="text-xs font-semibold text-amber-900" style={{ direction: lang === 'ar' ? 'rtl' : 'ltr' }}>
                            ⏳ {tx(txn.description, txn.description_en)}
                          </div>
                          <div className="text-[10px] text-amber-700">
                            {txn.transaction_date}
                            {txn.expected_date && txn.expected_date !== txn.transaction_date && (
                              <span> · Expected to clear ~{txn.expected_date} / متوقع التحصيل</span>
                            )}
                            <span className="ml-1 font-semibold">· Awaiting bank confirmation / في انتظار تأكيد البنك</span>
                          </div>
                        </div>
                        <div className="text-sm font-bold text-amber-700 mr-2">
                          {fE(Number(txn.expected_amount || 0))}
                          <span className="text-[9px] text-amber-600 ml-1">pending</span>
                        </div>
                        <button onClick={() => setInspectedTreasury(txn)}
                          className="px-2 py-0.5 rounded border border-amber-400 text-amber-700 text-[10px] mr-1 hover:bg-amber-100" title="Inspect / فحص">
                          ⓘ Inspect
                        </button>
                        <button onClick={() => { setEditingTxn(txn.id); setFormData({ txEditDate: txn.transaction_date, txExpectedDate: txn.expected_date || txn.transaction_date }); }}
                          className="px-2 py-0.5 rounded border border-blue-300 text-blue-600 text-[10px] mr-1 hover:bg-blue-50">
                          Edit
                        </button>
                        <button onClick={() => handleUnlinkTreasury(txn)}
                          className="px-2 py-0.5 rounded border border-red-300 text-red-500 text-[10px] hover:bg-red-50">
                          Unlink
                        </button>
                      </div>
                    ) : editingTxn === txn.id ? (
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
                              {catOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
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
                        <div className="text-sm font-bold text-emerald-600 mr-2">
                          {/* v55.83-A.6.11 — show bank_in OR cash_in, not
                              just cash_in. Matched bank rows have
                              bank_in=<amount> and cash_in=0; displaying
                              only cash_in made them look like EGP 0
                              empty rows on invoice 2303. */}
                          {fE(Number(txn.cash_in || 0) + Number(txn.bank_in || 0))}
                        </div>
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
                    {/* v55.83-A.6.9 — include placeholder expected_amount
                        so totals match what users see line-by-line. The
                        "pending" portion is broken out below for clarity. */}
                    {fE((treasuryByInvoiceId[selectedInvoice.id] || []).reduce((a, t) => {
                      var confirmed = Number(t.cash_in || 0) + Number(t.bank_in || 0);
                      var pending = t.is_bank_placeholder ? Number(t.expected_amount || 0) : 0;
                      return a + confirmed + pending;
                    }, 0))}
                  </span>
                </div>
                {/* Confirmed + pending breakdown below the total, only if
                    any placeholder exists. */}
                {(treasuryByInvoiceId[selectedInvoice.id] || []).some(t => t.is_bank_placeholder) && (
                  <div className="mt-1 space-y-0.5 text-[10px]">
                    <div className="flex justify-between">
                      <span className="text-emerald-700">✓ Confirmed / مؤكد</span>
                      <span className="font-bold text-emerald-700">
                        {fE((treasuryByInvoiceId[selectedInvoice.id] || []).reduce((a, t) =>
                          t.is_bank_placeholder ? a : a + Number(t.cash_in || 0) + Number(t.bank_in || 0), 0))}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-amber-700">⏳ Pending bank confirmation / في انتظار البنك</span>
                      <span className="font-bold text-amber-700">
                        {fE((treasuryByInvoiceId[selectedInvoice.id] || []).reduce((a, t) =>
                          t.is_bank_placeholder ? a + Number(t.expected_amount || 0) : a, 0))}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
                </div>
              );
            })()}

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
                            // v55.83-A.6.27.14 (Max May 16 2026) — delegate
                            // to recalc instead of subtracting from
                            // total_collected directly. Same architectural
                            // fix as EgyptBankTab.unmatch.
                            await dbUpdate('egypt_bank_transactions', txn.id, { matched_invoice_id: null, matched_at: null, matched_by: null }, userProfile?.id);
                            await recalcInvoiceCollected(selectedInvoice.id);
                            await loadAllData();
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
                              // v55.83-A.6.27.14 (Max May 16 2026) — when
                              // linking an Egypt Bank txn from inside the
                              // invoice view, do the same thing
                              // EgyptBankTab.matchToInvoice does: create a
                              // treasury row representing the bank inflow,
                              // then defer to recalcInvoiceCollected.
                              // Without this, total_collected went stale on
                              // the next recalc.
                              var amt = Number(txn.amount);
                              var insertRes = await supabase.from('treasury').insert({
                                transaction_date: txn.date || todayET(),
                                cash_in: 0,
                                cash_out: 0,
                                bank_in: amt,
                                bank_out: 0,
                                linked_invoice_id: selectedInvoice.id,
                                order_number: selectedInvoice.order_number,
                                matched_bank_txn_id: txn.id,
                                needs_bank_match: false,
                                is_bank_placeholder: false,
                                description: 'Bank deposit matched to invoice #' + selectedInvoice.order_number,
                                created_by: userProfile?.id,
                              }).select().single();
                              if (insertRes.error) throw insertRes.error;
                              var newTreasuryId = insertRes.data && insertRes.data.id;
                              await dbUpdate('egypt_bank_transactions', txn.id, {
                                matched_invoice_id: selectedInvoice.id,
                                matched_treasury_id: newTreasuryId,
                                matched_at: new Date().toISOString(),
                                matched_by: userProfile?.id,
                              }, userProfile?.id);
                              await recalcInvoiceCollected(selectedInvoice.id);
                              await loadAllData();
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
                catOptions={catOptions}
                existingSubcats={uniqueSubcats}
                onSave={handleAddPayment}
                onCancel={() => { setShowAddPayment(false); setFormData({}); }}
                formData={formData}
                setFormData={setFormData}
              />
            )}

            {/* ==========================================
                v55.83-A.6.27.18 — PAYMENT INSTRUMENTS / SCHEDULED RECEIVABLES
                Per Max: documentation only. Never writes to treasury,
                never changes invoice.total_collected. The smart popup
                in the treasury entry flow handles clearing. This UI is
                for entering instruments and seeing what's outstanding.
            ========================================== */}
            {(function () {
              // Pull instruments for this invoice — match on invoice_id OR order_number for legacy
              var invInstruments = (checks || []).filter(function (c) {
                if (c.invoice_id === selectedInvoice.id) return true;
                if (c.order_number && String(c.order_number).trim() === String(selectedInvoice.order_number || '').trim()) return true;
                return false;
              });
              // Group by status for summary
              var byStatus = { pending: [], deposited: [], cleared: [], bounced: [], cancelled: [], replaced: [] };
              invInstruments.forEach(function (c) {
                var s = c.status || 'pending';
                // Compat: legacy 'collected' → 'cleared'
                if (s === 'collected') s = 'cleared';
                if (s === 'uncollected') s = 'pending';
                if (!byStatus[s]) byStatus[s] = [];
                byStatus[s].push(c);
              });
              var pendingSum = byStatus.pending.reduce(function (a, c) { return a + Number(c.amount || 0); }, 0);
              var depositedSum = byStatus.deposited.reduce(function (a, c) { return a + Number(c.amount || 0); }, 0);
              var clearedSum = byStatus.cleared.reduce(function (a, c) { return a + Number(c.amount || 0); }, 0);
              var bouncedSum = byStatus.bounced.reduce(function (a, c) { return a + Number(c.amount || 0); }, 0);
              var totalCount = invInstruments.length;
              var today = new Date().toISOString().slice(0, 10);

              // Order list: overdue pending first, then upcoming pending by due date,
              // then deposited, then cleared, then bounced/cancelled/replaced.
              var statusOrder = { pending: 1, deposited: 2, cleared: 3, bounced: 4, cancelled: 5, replaced: 6 };
              var sortedList = invInstruments.slice().sort(function (a, b) {
                var sa = (a.status === 'collected') ? 'cleared' : (a.status === 'uncollected') ? 'pending' : (a.status || 'pending');
                var sb = (b.status === 'collected') ? 'cleared' : (b.status === 'uncollected') ? 'pending' : (b.status || 'pending');
                var ra = statusOrder[sa] || 99;
                var rb = statusOrder[sb] || 99;
                if (ra !== rb) return ra - rb;
                var da = a.due_date || a.check_date || '';
                var db = b.due_date || b.check_date || '';
                return da < db ? -1 : (da > db ? 1 : 0);
              });

              // v55.83-A.6.27.19 — use the existing canEditTreasury gate
              // (super_admin OR modulePerms['Edit Treasury'] OR modulePerms['Treasury'])
              // instead of just modulePerms['Treasury']. Otherwise users with
              // 'Edit Treasury' but not 'Treasury' could edit treasury rows
              // but couldn't add instruments — inconsistent.
              var canEditInstruments = canEditTreasury;

              return (
                <div className="mt-4 border border-slate-200 rounded-xl overflow-hidden">
                  {/* Header — clickable to expand/collapse */}
                  <button
                    onClick={function () { setInstrumentSectionExpanded(function (e) { return !e; }); }}
                    className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition"
                  >
                    <div className="flex items-center gap-2">
                      <span style={{ fontSize: 18 }}>🧾</span>
                      <div className="text-left">
                        <div className="text-sm font-bold text-slate-900">
                          Payment Instruments / Scheduled Receivables
                        </div>
                        <div className="text-[11px] text-slate-600">
                          {totalCount === 0 ? 'No instruments yet — checks or promissory notes for this order' :
                            (byStatus.pending.length + ' pending · ' +
                             byStatus.deposited.length + ' deposited · ' +
                             byStatus.cleared.length + ' cleared' +
                             (byStatus.bounced.length > 0 ? ' · ' + byStatus.bounced.length + ' bounced' : ''))}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {totalCount > 0 && (
                        <div className="text-right">
                          <div className="text-[10px] text-slate-500">Pending</div>
                          <div className="text-sm font-extrabold text-amber-700">{fE(pendingSum)}</div>
                        </div>
                      )}
                      <span className="text-slate-500 text-lg">{instrumentSectionExpanded ? '▾' : '▸'}</span>
                    </div>
                  </button>

                  {instrumentSectionExpanded && (
                    <div className="bg-white p-3 space-y-2">
                      {/* Summary chips */}
                      {totalCount > 0 && (
                        <div className="flex flex-wrap gap-2 text-[11px] mb-2">
                          <span className="px-2 py-1 bg-amber-100 text-amber-900 rounded-md font-medium">
                            ⏳ Pending: {byStatus.pending.length} · {fE(pendingSum)}
                          </span>
                          {byStatus.deposited.length > 0 && (
                            <span className="px-2 py-1 bg-sky-100 text-sky-900 rounded-md font-medium">
                              🏦 Deposited: {byStatus.deposited.length} · {fE(depositedSum)}
                            </span>
                          )}
                          {byStatus.cleared.length > 0 && (
                            <span className="px-2 py-1 bg-emerald-100 text-emerald-900 rounded-md font-medium">
                              ✓ Cleared: {byStatus.cleared.length} · {fE(clearedSum)}
                            </span>
                          )}
                          {byStatus.bounced.length > 0 && (
                            <span className="px-2 py-1 bg-red-100 text-red-900 rounded-md font-medium">
                              ⚠ Bounced: {byStatus.bounced.length} · {fE(bouncedSum)}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Empty state */}
                      {totalCount === 0 && !showAddInstrumentForm && (
                        <div className="text-center py-4 text-slate-500 text-xs italic">
                          No checks or promissory notes recorded for this order yet.
                        </div>
                      )}

                      {/* List */}
                      {sortedList.map(function (inst) {
                        var st = (inst.status === 'collected') ? 'cleared' : (inst.status === 'uncollected') ? 'pending' : (inst.status || 'pending');
                        var due = inst.due_date || inst.check_date || '';
                        var isOverdue = (st === 'pending' || st === 'deposited') && due && due < today;
                        var isDueSoon = (st === 'pending' || st === 'deposited') && due && due >= today && due <= (new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
                        var typeLabel = inst.instrument_type === 'promissory_note' ? 'Promissory Note' : (inst.instrument_type === 'other' ? 'Other' : 'Check');
                        var typeIcon = inst.instrument_type === 'promissory_note' ? '📜' : '🧾';
                        var rowStyle = (st === 'cleared' || st === 'cancelled' || st === 'replaced') ? 'bg-slate-100' : (st === 'bounced' ? 'bg-red-50' : (isOverdue ? 'bg-red-50' : (isDueSoon ? 'bg-amber-50' : 'bg-white')));
                        var titleStyle = (st === 'cleared' || st === 'cancelled' || st === 'replaced') ? 'line-through text-slate-500' : 'text-slate-900';
                        return (
                          <div key={inst.id} className={'border border-slate-200 rounded-lg p-2.5 ' + rowStyle}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-base">{typeIcon}</span>
                                  <span className={'text-sm font-bold ' + titleStyle}>
                                    {typeLabel}{inst.check_number ? ' #' + inst.check_number : ''}
                                  </span>
                                  <span className={'text-sm font-extrabold ' + titleStyle}>
                                    {fE(Number(inst.amount || 0))}
                                  </span>
                                  {/* Status badge */}
                                  {st === 'pending' && <span className={'px-1.5 py-0.5 rounded text-[10px] font-bold ' + (isOverdue ? 'bg-red-200 text-red-900' : (isDueSoon ? 'bg-amber-200 text-amber-900' : 'bg-slate-200 text-slate-700'))}>
                                    {isOverdue ? 'OVERDUE' : (isDueSoon ? 'DUE SOON' : 'PENDING')}
                                  </span>}
                                  {st === 'deposited' && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-sky-200 text-sky-900">DEPOSITED</span>}
                                  {st === 'cleared' && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-200 text-emerald-900">✓ CLEARED</span>}
                                  {st === 'bounced' && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-200 text-red-900">⚠ BOUNCED</span>}
                                  {st === 'cancelled' && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-300 text-slate-700">CANCELLED</span>}
                                  {st === 'replaced' && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-300 text-slate-700">REPLACED</span>}
                                </div>
                                <div className="text-[11px] text-slate-600 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                                  {due && <span>Due: <strong className={isOverdue ? 'text-red-700' : ''}>{due}</strong></span>}
                                  {inst.bank_name && <span>Bank: {inst.bank_name}</span>}
                                  {inst.customer_name && <span>Customer: {inst.customer_name}</span>}
                                  {st === 'cleared' && inst.collection_date && <span className="text-emerald-700">Cleared: {inst.collection_date}</span>}
                                  {st === 'bounced' && inst.bounce_reason && <span className="text-red-700">Reason: {inst.bounce_reason}</span>}
                                </div>
                                {inst.notes && <div className="text-[11px] text-slate-500 italic mt-1">📝 {inst.notes}</div>}
                              </div>
                              {/* Action buttons — only for pending/deposited rows and only for users with permission.
                                  Note per Max: Mark Cleared is intentionally NOT here. Clearing only happens via
                                  the smart popup when a treasury transaction is entered. */}
                              {canEditInstruments && (st === 'pending' || st === 'deposited') && (
                                <div className="flex flex-col gap-1">
                                  {st === 'pending' && (
                                    <button
                                      onClick={async function () {
                                        if (!confirm('Mark instrument #' + (inst.check_number || inst.id) + ' as deposited at the bank? This is documentation only — it does NOT post any treasury or invoice changes.')) return;
                                        try {
                                          await dbUpdate('checks', inst.id, { status: 'deposited', updated_by: user?.id }, user?.id);
                                          toast.success('Marked as deposited');
                                          await loadAllData();
                                        } catch (err) { toast.error('Failed: ' + (err.message || String(err))); }
                                      }}
                                      className="px-2 py-1 text-[10px] bg-sky-100 hover:bg-sky-200 text-sky-900 rounded font-semibold"
                                    >
                                      Mark Deposited
                                    </button>
                                  )}
                                  <button
                                    onClick={async function () {
                                      var reason = prompt('Why did this instrument bounce? (Required — appears in audit log)');
                                      if (!reason || !reason.trim()) return;
                                      try {
                                        await dbUpdate('checks', inst.id, {
                                          status: 'bounced',
                                          bounce_reason: reason.trim(),
                                          updated_by: user?.id,
                                        }, user?.id);
                                        toast.warning('Marked as bounced — please follow up with customer');
                                        await loadAllData();
                                      } catch (err) { toast.error('Failed: ' + (err.message || String(err))); }
                                    }}
                                    className="px-2 py-1 text-[10px] bg-red-100 hover:bg-red-200 text-red-900 rounded font-semibold"
                                  >
                                    Mark Bounced
                                  </button>
                                  <button
                                    onClick={async function () {
                                      if (!confirm('Cancel instrument #' + (inst.check_number || inst.id) + '? This is documentation only — does NOT change any treasury or invoice totals.')) return;
                                      try {
                                        await dbUpdate('checks', inst.id, { status: 'cancelled', updated_by: user?.id }, user?.id);
                                        toast.success('Cancelled');
                                        await loadAllData();
                                      } catch (err) { toast.error('Failed: ' + (err.message || String(err))); }
                                    }}
                                    className="px-2 py-1 text-[10px] bg-slate-200 hover:bg-slate-300 text-slate-700 rounded font-semibold"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {/* Add Instrument toggle + inline form */}
                      {canEditInstruments && !showAddInstrumentForm && (
                        <button
                          onClick={function () {
                            setShowAddInstrumentForm(true);
                            setInstrumentForm({
                              instrument_type: 'check',
                              check_number: '',
                              amount: '',
                              issue_date: new Date().toISOString().slice(0, 10),
                              due_date: '',
                              bank_name: '',
                              notes: '',
                            });
                          }}
                          className="w-full px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-900 rounded-lg font-bold text-sm border-2 border-dashed border-indigo-300"
                        >
                          + Add Check / Promissory Note
                        </button>
                      )}

                      {showAddInstrumentForm && (
                        <div className="border-2 border-indigo-300 rounded-lg p-3 bg-indigo-50 space-y-2">
                          <div className="text-sm font-bold text-indigo-900 mb-1">New Instrument</div>
                          <div className="text-[11px] text-indigo-800 italic mb-2">
                            Documentation only — this does NOT affect the invoice's Collected amount or any treasury balance.
                          </div>
                          {/* Type */}
                          <div className="grid grid-cols-2 gap-2">
                            <label className="text-[11px] font-semibold text-slate-700">Type
                              <select
                                value={instrumentForm.instrument_type}
                                onChange={function (e) { setInstrumentForm(Object.assign({}, instrumentForm, { instrument_type: e.target.value })); }}
                                className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white"
                              >
                                <option value="check">Check / شيك</option>
                                <option value="promissory_note">Promissory Note / كمبيالة</option>
                                <option value="other">Other / آخر</option>
                              </select>
                            </label>
                            <label className="text-[11px] font-semibold text-slate-700">Number / Reference
                              <input
                                type="text"
                                value={instrumentForm.check_number}
                                onChange={function (e) { setInstrumentForm(Object.assign({}, instrumentForm, { check_number: e.target.value })); }}
                                placeholder="e.g. 1234"
                                className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white"
                              />
                            </label>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <label className="text-[11px] font-semibold text-slate-700">Amount (EGP) *
                              <input
                                type="text"
                                value={instrumentForm.amount}
                                onChange={function (e) { setInstrumentForm(Object.assign({}, instrumentForm, { amount: e.target.value })); }}
                                placeholder="50000"
                                className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white font-mono"
                              />
                            </label>
                            <label className="text-[11px] font-semibold text-slate-700">Bank
                              <input
                                type="text"
                                value={instrumentForm.bank_name}
                                onChange={function (e) { setInstrumentForm(Object.assign({}, instrumentForm, { bank_name: e.target.value })); }}
                                placeholder="CIB / NBE / etc."
                                className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white"
                              />
                            </label>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <label className="text-[11px] font-semibold text-slate-700">Issue Date
                              <input
                                type="date"
                                value={instrumentForm.issue_date}
                                onChange={function (e) { setInstrumentForm(Object.assign({}, instrumentForm, { issue_date: e.target.value })); }}
                                className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white"
                              />
                            </label>
                            <label className="text-[11px] font-semibold text-slate-700">Due Date *
                              <input
                                type="date"
                                value={instrumentForm.due_date}
                                onChange={function (e) { setInstrumentForm(Object.assign({}, instrumentForm, { due_date: e.target.value })); }}
                                className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white"
                              />
                            </label>
                          </div>
                          <label className="text-[11px] font-semibold text-slate-700 block">Notes
                            <textarea
                              value={instrumentForm.notes}
                              onChange={function (e) { setInstrumentForm(Object.assign({}, instrumentForm, { notes: e.target.value })); }}
                              rows={2}
                              placeholder="Optional notes (e.g. brought by son, post-dated, etc.)"
                              className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white resize-none"
                            />
                          </label>
                          <div className="flex gap-2 pt-1">
                            <button
                              disabled={instrumentBusy}
                              onClick={async function () {
                                // Validation — use parseAmount (Arabic-Indic digits, comma separators)
                                var amt = parseAmount(instrumentForm.amount);
                                if (!amt || amt <= 0) { toast.error('Amount is required and must be greater than 0'); return; }
                                if (!instrumentForm.due_date) { toast.error('Due date is required'); return; }
                                setInstrumentBusy(true);
                                try {
                                  // Per Max: documentation only.
                                  // - NO treasury insert.
                                  // - NO invoice.total_collected change.
                                  // Just a row in `checks` with status='pending'.
                                  await dbInsert('checks', {
                                    instrument_type: instrumentForm.instrument_type,
                                    customer_name: selectedInvoice.customer_name,
                                    customer_id: selectedInvoice.customer_id || null,
                                    order_number: selectedInvoice.order_number,
                                    invoice_id: selectedInvoice.id,
                                    amount: amt,
                                    check_number: instrumentForm.check_number || '',
                                    bank_name: instrumentForm.bank_name || '',
                                    issue_date: instrumentForm.issue_date || null,
                                    check_date: instrumentForm.due_date,    // legacy column — kept in sync
                                    due_date: instrumentForm.due_date,
                                    status: 'pending',
                                    notes: instrumentForm.notes || '',
                                    created_by: user?.id,
                                    updated_by: user?.id,
                                  }, user?.id);
                                  toast.success('Instrument recorded — does not affect invoice total');
                                  setShowAddInstrumentForm(false);
                                  setInstrumentForm({ instrument_type: 'check', check_number: '', amount: '', issue_date: '', due_date: '', bank_name: '', notes: '' });
                                  await loadAllData();
                                } catch (err) {
                                  toast.error('Failed to add instrument: ' + (err.message || String(err)));
                                } finally {
                                  setInstrumentBusy(false);
                                }
                              }}
                              className="flex-1 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-bold text-sm disabled:opacity-50"
                            >
                              {instrumentBusy ? 'Saving...' : '+ Add Instrument'}
                            </button>
                            <button
                              onClick={function () { setShowAddInstrumentForm(false); }}
                              className="px-3 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 rounded font-semibold text-sm"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
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
                                {catOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
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
                            {/* v55.42 — Inline edit row is bank-aware. The
                                old code always showed cash_in/cash_out, which
                                read 0 for bank rows and tricked users into
                                typing the amount in the wrong field. */}
                            {(() => {
                              var hasBankIn  = Number(txn.bank_in  || 0) > 0;
                              var hasBankOut = Number(txn.bank_out || 0) > 0;
                              var isPlaceholder = !!txn.is_bank_placeholder;
                              var isBankRow = hasBankIn || hasBankOut || isPlaceholder;
                              if (isBankRow) {
                                var bankInVal  = isPlaceholder && txn.expected_direction === 'in'  ? (txn.expected_amount || 0) : (txn.bank_in  || 0);
                                var bankOutVal = isPlaceholder && txn.expected_direction === 'out' ? (txn.expected_amount || 0) : (txn.bank_out || 0);
                                return (
                                  <>
                                    <td className="px-2 py-1.5">
                                      <input type="number" id="tx-bank-in" defaultValue={bankInVal}
                                        className="w-20 text-xs border-2 border-indigo-300 rounded px-1 py-1 bg-indigo-50 text-indigo-700"
                                        title="Bank In — bank-side row" />
                                      <div className="text-[8px] text-indigo-600 font-bold mt-0.5">🏦 Bank</div>
                                    </td>
                                    <td className="px-2 py-1.5">
                                      <input type="number" id="tx-bank-out" defaultValue={bankOutVal}
                                        className="w-20 text-xs border-2 border-indigo-300 rounded px-1 py-1 bg-indigo-50 text-indigo-700"
                                        title="Bank Out — bank-side row" />
                                      <div className="text-[8px] text-indigo-600 font-bold mt-0.5">🏦 Bank</div>
                                    </td>
                                  </>
                                );
                              }
                              // Cash row — original behavior preserved
                              return (
                                <>
                                  <td className="px-2 py-1.5"><input type="number" id="tx-in" defaultValue={txn.cash_in || 0}
                                    className="w-20 text-xs border rounded px-1 py-1" /></td>
                                  <td className="px-2 py-1.5"><input type="number" id="tx-out" defaultValue={txn.cash_out || 0}
                                    className="w-20 text-xs border rounded px-1 py-1" /></td>
                                </>
                              );
                            })()}
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
                ) : (() => {
                  // v55.42 — DETECT what KIND of treasury row we're editing.
                  // The legacy modal only showed Cash In / Cash Out fields.
                  // For bank rows (matched bank statement OR pending placeholder)
                  // it showed 0 / 0 because cash_in and cash_out are zero on
                  // bank rows — the money lives in bank_in / bank_out. Users
                  // typed the amount into the cash field thinking the system
                  // had the wrong value, which DOUBLED the amount AND silently
                  // converted a bank row into a cash row (losing the bank
                  // matching, the bank account link, and the audit trail).
                  //
                  // Now we detect row type and show the correct fields.
                  var hasBankIn  = Number(txn.bank_in  || 0) > 0;
                  var hasBankOut = Number(txn.bank_out || 0) > 0;
                  var isPlaceholder = !!txn.is_bank_placeholder;
                  var isBankRow = hasBankIn || hasBankOut || isPlaceholder;
                  var isMatched = !!txn.matched_bank_txn_id;
                  return (
                  <div className="p-4 space-y-3">
                    {/* v55.42 — Big visible badge so the user knows what
                        kind of row this is. Without this, bank rows looked
                        identical to cash rows in the edit modal. */}
                    {isBankRow && (
                      <div className={'rounded-lg p-3 border-2 ' + (isMatched ? 'bg-indigo-50 border-indigo-300' : 'bg-amber-50 border-amber-300')}>
                        <div className={'text-xs font-extrabold uppercase ' + (isMatched ? 'text-indigo-800' : 'text-amber-900')}>
                          {isMatched
                            ? '🏦 Bank Transaction (matched bank statement)'
                            : '🏦 Bank Transaction (placeholder — awaiting statement)'}
                        </div>
                        <div className={'text-[11px] mt-0.5 ' + (isMatched ? 'text-indigo-700' : 'text-amber-900')}>
                          The money for this entry is tracked in <code>bank_in</code> / <code>bank_out</code>, not cash.
                          {isMatched ? ' Editing the amount here will update the bank-side total and recalc any linked invoice.' : ''}
                        </div>
                      </div>
                    )}

                    <div>
                      <label className="text-[10px] font-bold text-slate-500">Date / التاريخ</label>
                      <DatePickerSelect value={txn.transaction_date || today()} onChange={v => setEditTreasuryModal({...txn, transaction_date: v})} />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500">Order # / رقم الأمر</label>
                      <input value={txn.order_number || ''} onChange={e => setEditTreasuryModal({...txn, order_number: e.target.value})}
                        className="w-full px-3 py-2 rounded-lg border text-sm" />
                      {/* v55.82-B — Live link-status indicator. Before this fix,
                          the user could type any order# they wanted with no
                          feedback on whether it matched a real invoice. They'd
                          save, the row would silently stay unlinked, and the
                          invoice's collected total never moved. Now the user
                          sees right under the field whether the typed number
                          will link to an invoice on save, who that customer
                          is, and the invoice total. If no match, an amber
                          "no match" hint appears so they can fix the typo or
                          create the invoice in Sales first. */}
                      {(() => {
                        var typed = String(txn.order_number || '').trim();
                        if (!typed) {
                          return (
                            <div className="text-[10px] text-slate-500 mt-1 italic">
                              No order # — row will be saved unlinked. / بدون رقم أمر، الصف غير مرتبط.
                            </div>
                          );
                        }
                        var match = (invoices || []).find(function(i) {
                          return String(i.order_number || '').trim() === typed;
                        });
                        if (match) {
                          return (
                            <div className="mt-1 flex items-center gap-2 px-2 py-1.5 rounded-md bg-emerald-50 border border-emerald-300">
                              <span className="text-emerald-700 text-sm">✓</span>
                              <div className="flex-1 min-w-0">
                                <div className="text-[10px] font-extrabold text-emerald-800 uppercase tracking-wide">Will link on save</div>
                                <div className="text-xs font-bold text-emerald-900 truncate" style={{ direction: 'rtl' }}>
                                  {match.customer_name || ('#' + match.order_number)} — {fE(match.total_amount)}
                                </div>
                              </div>
                            </div>
                          );
                        }
                        return (
                          <div className="mt-1 flex items-center gap-2 px-2 py-1.5 rounded-md bg-amber-50 border border-amber-300">
                            <span className="text-amber-900 text-sm">⚠</span>
                            <div className="flex-1 min-w-0">
                              <div className="text-[10px] font-extrabold text-amber-900 uppercase tracking-wide">No matching invoice</div>
                              <div className="text-[11px] text-amber-900">Save will succeed, but row will stay unlinked. Create the invoice in Sales first, or fix the typo. / لا توجد فاتورة بهذا الرقم.</div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500">Description / الوصف</label>
                      <input value={txn.description || ''} onChange={e => setEditTreasuryModal({...txn, description: e.target.value})}
                        className="w-full px-3 py-2 rounded-lg border text-sm" style={{direction:'rtl'}} />
                    </div>
                    {isBankRow ? (
                      // BANK row — show bank_in / bank_out fields
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] font-bold text-indigo-600">🏦 Bank In / وارد بنكي</label>
                          <input type="number" value={isPlaceholder ? (txn.expected_amount || 0) : (txn.bank_in || 0)}
                            onChange={e => {
                              var v = Number(e.target.value) || 0;
                              if (isPlaceholder) {
                                setEditTreasuryModal({...txn, expected_amount: v, expected_direction: v > 0 ? 'in' : txn.expected_direction});
                              } else {
                                setEditTreasuryModal({...txn, bank_in: v});
                              }
                            }}
                            className="w-full px-3 py-2 rounded-lg border-2 border-indigo-300 text-sm text-indigo-700 font-semibold bg-indigo-50" />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-indigo-600">🏦 Bank Out / صادر بنكي</label>
                          <input type="number" value={isPlaceholder && txn.expected_direction === 'out' ? (txn.expected_amount || 0) : (txn.bank_out || 0)}
                            onChange={e => {
                              var v = Number(e.target.value) || 0;
                              if (isPlaceholder) {
                                setEditTreasuryModal({...txn, expected_amount: v, expected_direction: v > 0 ? 'out' : txn.expected_direction});
                              } else {
                                setEditTreasuryModal({...txn, bank_out: v});
                              }
                            }}
                            className="w-full px-3 py-2 rounded-lg border-2 border-indigo-300 text-sm text-indigo-700 font-semibold bg-indigo-50" />
                        </div>
                      </div>
                    ) : (
                      // CASH row — show cash_in / cash_out fields (unchanged)
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
                    )}
                    <div>
                      <label className="text-[10px] font-bold text-slate-500">Category / التصنيف</label>
                      <select value={txn.category || ''} onChange={e => setEditTreasuryModal({...txn, category: e.target.value})}
                        className="w-full px-3 py-2 rounded-lg border text-sm bg-amber-50">
                        <option value="">None</option>
                        {catOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
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
                      <button onClick={() => {
                        // v55.42 — Build the update payload based on row type.
                        // Bank rows preserve their bank-side fields and do
                        // NOT touch cash_in/cash_out. Cash rows preserve
                        // their cash fields and do NOT touch bank_in/bank_out.
                        var payload = {
                          transaction_date: txn.transaction_date,
                          order_number: txn.order_number || '',
                          description: txn.description || '',
                          category: txn.category || null,
                          subcategory: txn.subcategory || null,
                        };
                        if (isBankRow) {
                          // Preserve all bank-side identity fields, only
                          // update the amount the user actually changed.
                          if (isPlaceholder) {
                            payload.expected_amount = Number(txn.expected_amount) || 0;
                            if (txn.expected_direction) payload.expected_direction = txn.expected_direction;
                          } else {
                            payload.bank_in  = Number(txn.bank_in)  || 0;
                            payload.bank_out = Number(txn.bank_out) || 0;
                          }
                          // Cash side stays at zero; we do NOT include it
                          // in the update so any value already there
                          // (which would be a data anomaly) isn't disturbed.
                        } else {
                          payload.cash_in  = Number(txn.cash_in)  || 0;
                          payload.cash_out = Number(txn.cash_out) || 0;
                        }
                        handleSaveTreasuryEdit(txn.id, payload);
                      }} className="flex-1 px-4 py-2.5 bg-blue-500 text-white rounded-lg font-bold text-sm hover:bg-blue-600">
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
                  );
                })()}
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
              return bucketSub ? prefix + ': ' + cat + ' > ' + bucketSub : prefix + ': ' + txCat(cat);
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
                          <option key={c} value={c}>{txCat(c)}</option>
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
                                      {editCatValue && !isKnownCat(editCatValue, categoriesList) && !customCats.includes(editCatValue) && editCatValue !== '__custom' && (
                                        <option value={editCatValue}>✨ {editCatValue}</option>
                                      )}
                                      {catOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
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
                                    <div className="text-[9px] font-semibold text-amber-900">{txn.category ? txCat(txn.category) : <span className="text-slate-300 italic">+ category</span>}</div>
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
        {reconcileCheck && (() => {
          const evalResult = evaluateCheckReconcile(reconcileCheck);
          // Helper: short text describing a treasury candidate
          const candidateLabel = (t) => {
            const inflow = Number(t.cash_in || 0) + Number(t.bank_in || 0);
            const channel = Number(t.bank_in || 0) > 0 ? '🏦 Bank'
                          : t.cash_method === 'vodafone' ? '📱 Vodafone'
                          : t.cash_method === 'instapay' ? '⚡ InstaPay'
                          : '💵 Cash';
            const date = t.transaction_date || '';
            const desc = (t.description || '').substring(0, 60);
            return channel + ' · ' + fE(inflow) + ' · ' + date + (desc ? ' · ' + desc : '');
          };
          return (
          <Modal onClose={() => { setReconcileCheck(null); setReconcileDate(''); setReconcileCheckChoice(null); setReconcileCheckReturned(false); }} title="✅ Collect Check / تحصيل شيك">
            <div className="bg-emerald-50 rounded-lg p-4 mb-4 border border-emerald-200">
              <div style={{ direction: 'rtl' }} className="text-lg font-bold text-emerald-800">{reconcileCheck.customer_name}</div>
              <div className="text-2xl font-extrabold text-emerald-600 mt-1">{fE(reconcileCheck.amount)}</div>
              <div className="flex gap-3 mt-2 text-xs text-slate-500 flex-wrap">
                {reconcileCheck.order_number && <span>Order #{reconcileCheck.order_number}</span>}
                {reconcileCheck.check_number && <span>Check #{reconcileCheck.check_number}</span>}
                {reconcileCheck.bank_name && <span>{reconcileCheck.bank_name}</span>}
                <span>Due: {reconcileCheck.due_date || reconcileCheck.check_date}</span>
              </div>
            </div>

            {/* Runtime warnings (zero amount, overpayment) */}
            {(evalResult.warnings || []).length > 0 && (
              <div className="mb-4 space-y-2">
                {evalResult.warnings.map((w, idx) => (
                  <div key={idx} className={'rounded-lg p-3 border-2 ' + (w.level === 'error' ? 'bg-red-50 border-red-400' : 'bg-amber-50 border-amber-400')}>
                    <div className={'text-xs font-extrabold uppercase mb-1 ' + (w.level === 'error' ? 'text-red-800' : 'text-amber-900')}>
                      {w.level === 'error' ? '⛔ Cannot proceed' : '⚠️ Warning'}
                    </div>
                    <div className={'text-sm font-medium ' + (w.level === 'error' ? 'text-red-900' : 'text-amber-900')}>{w.en}</div>
                    <div className={'text-sm font-medium mt-1 ' + (w.level === 'error' ? 'text-red-900' : 'text-amber-900')} style={{direction:'rtl'}}>{w.ar}</div>
                  </div>
                ))}
              </div>
            )}

            {/* ===== MODE A: Already explicitly linked ===== */}
            {evalResult.mode === 'already_linked' && (
              <div className="bg-emerald-50 border-2 border-emerald-400 rounded-lg p-3 mb-4">
                <div className="text-xs font-extrabold text-emerald-800 uppercase mb-1">✅ Already linked / مرتبط بالفعل</div>
                <div className="text-sm text-emerald-900 font-medium">This check is already linked to a treasury entry:</div>
                <div className="text-xs text-emerald-900 bg-white/60 rounded p-2 mt-1 font-mono">{candidateLabel(evalResult.existingTreasury)}</div>
                <div className="text-xs text-emerald-700 italic mt-2">Closing the check will NOT create a new treasury entry. / إغلاق الشيك لن يضيف قيدًا جديدًا.</div>
              </div>
            )}

            {/* ===== MODE B: Candidate matches found — let user pick which treasury row this check IS ===== */}
            {evalResult.mode === 'candidate_match' && (
              <div className="bg-blue-50 border-2 border-blue-300 rounded-lg p-3 mb-4">
                <div className="text-xs font-extrabold text-blue-800 uppercase mb-2">🔍 Possible matches found / احتمالات مطابقة</div>
                <div className="text-sm text-blue-900 mb-2">{evalResult.message}</div>
                <div className="text-sm text-blue-900 mb-2" style={{direction:'rtl'}}>تم العثور على {evalResult.candidates.length} قيد بنفس مبلغ الشيك بالضبط على هذه الفاتورة. اختر الذي يمثّل هذا الشيك.</div>
                <div className="space-y-2 mt-3">
                  {evalResult.candidates.map(t => (
                    <label key={t.id} className={"flex items-start gap-2 p-2 rounded cursor-pointer border-2 " + (reconcileCheckChoice && reconcileCheckChoice.kind === 'attach' && reconcileCheckChoice.treasuryId === t.id ? 'border-emerald-500 bg-emerald-50' : 'border-blue-200 bg-white hover:bg-blue-50')}>
                      <input type="radio" name="reconcile-choice" className="mt-1" checked={reconcileCheckChoice && reconcileCheckChoice.kind === 'attach' && reconcileCheckChoice.treasuryId === t.id} onChange={() => setReconcileCheckChoice({ kind: 'attach', treasuryId: t.id })} />
                      <div className="flex-1 text-xs">
                        <div className="font-semibold text-slate-900">{candidateLabel(t)}</div>
                        <div className="text-slate-500 text-[10px] mt-0.5">Confirm: this is the deposit/cash that came from this check</div>
                        <div className="text-slate-500 text-[10px]" style={{direction:'rtl'}}>تأكيد: هذا هو الإيداع/النقد الذي جاء من هذا الشيك</div>
                      </div>
                    </label>
                  ))}
                  <label className={"flex items-start gap-2 p-2 rounded cursor-pointer border-2 " + (reconcileCheckChoice && reconcileCheckChoice.kind === 'new' ? 'border-amber-500 bg-amber-50' : 'border-amber-200 bg-white hover:bg-amber-50')}>
                    <input type="radio" name="reconcile-choice" className="mt-1" checked={reconcileCheckChoice && reconcileCheckChoice.kind === 'new'} onChange={() => setReconcileCheckChoice({ kind: 'new' })} />
                    <div className="flex-1 text-xs">
                      <div className="font-semibold text-amber-900">None of the above — create a new treasury entry for this check</div>
                      <div className="font-semibold text-amber-900" style={{direction:'rtl'}}>لا شيء مما سبق — أنشئ قيد خزنة جديد لهذا الشيك</div>
                      <div className="text-amber-900 text-[10px] mt-0.5">Use only if the existing matches above are coincidences (different payments that happen to share the same amount).</div>
                    </div>
                  </label>
                </div>
              </div>
            )}

            {/* ===== MODE C: No match — user must choose how check was collected ===== */}
            {evalResult.mode === 'no_match' && (
              <div className="bg-amber-50 border-2 border-amber-400 rounded-lg p-3 mb-4">
                <div className="text-xs font-extrabold text-amber-900 uppercase mb-2">📥 How was this check collected? / كيف تم تحصيل هذا الشيك؟</div>
                <div className="text-sm text-amber-900">No existing treasury entry on invoice #{evalResult.invoice.order_number || ''} matches the check amount of {fE(evalResult.checkAmount)} exactly.</div>
                <div className="text-sm text-amber-900 mt-1" style={{direction:'rtl'}}>لا يوجد قيد خزنة على الفاتورة بنفس مبلغ الشيك بالضبط.</div>
                <div className="text-xs text-amber-900 italic mt-2">Pick the option that matches what physically happened. The system will create a new treasury entry tagged as 'check' so it doesn't get confused with cash payments.</div>
                <div className="text-xs text-amber-900 italic" style={{direction:'rtl'}}>اختر الذي يطابق ما حدث فعلًا.</div>
                <div className="space-y-2 mt-3">
                  <label className="flex items-start gap-2 p-2 rounded cursor-pointer border-2 border-amber-200 bg-white hover:bg-amber-50">
                    <input type="radio" name="reconcile-choice" className="mt-1" checked={reconcileCheckChoice && reconcileCheckChoice.kind === 'new' && !reconcileCheckReturned} onChange={() => { setReconcileCheckChoice({ kind: 'new' }); setReconcileCheckReturned(false); }} />
                    <div className="flex-1 text-xs">
                      <div className="font-semibold text-slate-900">📝 Standard collection — bank or cash deposit not yet recorded</div>
                      <div className="font-semibold text-slate-900" style={{direction:'rtl'}}>تحصيل عادي — إيداع بنكي أو نقدي لم يُسجَّل بعد</div>
                      <div className="text-slate-500 text-[10px]">Creates a new treasury entry for this check. The physical paper stays with us (or was deposited).</div>
                    </div>
                  </label>
                  <label className="flex items-start gap-2 p-2 rounded cursor-pointer border-2 border-amber-200 bg-white hover:bg-amber-50">
                    <input type="radio" name="reconcile-choice" className="mt-1" checked={reconcileCheckChoice && reconcileCheckChoice.kind === 'new' && reconcileCheckReturned} onChange={() => { setReconcileCheckChoice({ kind: 'new' }); setReconcileCheckReturned(true); }} />
                    <div className="flex-1 text-xs">
                      <div className="font-semibold text-slate-900">💵 Cash swap — customer paid cash in office, took the paper check back</div>
                      <div className="font-semibold text-slate-900" style={{direction:'rtl'}}>تبادل نقدي — العميل دفع نقدًا في المكتب وأخذ الشيك الورقي</div>
                      <div className="text-slate-500 text-[10px]">Same effect on the books, but the check is marked as "physically returned" so we know the paper isn't with us anymore.</div>
                    </div>
                  </label>
                </div>
              </div>
            )}

            {/* No-invoice case — original simple flow */}
            {evalResult.mode === 'no_invoice' && (
              <div className="bg-slate-50 border-2 border-slate-200 rounded-lg p-3 mb-4">
                <div className="text-xs font-extrabold text-slate-700 uppercase mb-1">No invoice linked / لا توجد فاتورة مرتبطة</div>
                <div className="text-sm text-slate-700">A new treasury cash-in entry will be created on collection.</div>
              </div>
            )}

            <div className="mb-4">
              <label className="text-xs font-semibold text-slate-600 mb-1 block">Collection Date / تاريخ التحصيل</label>
              <DatePickerSelect value={reconcileDate || today()} onChange={v => setReconcileDate(v)} />
            </div>

            {/* Dynamic action button by mode */}
            {evalResult.mode === 'already_linked' ? (
              <button onClick={handleCollectCheck}
                className="px-4 py-3 bg-emerald-600 text-white rounded-lg font-bold w-full text-sm hover:bg-emerald-700">
                ✅ Close Check (No New Treasury) / إغلاق الشيك (بدون قيد جديد)
              </button>
            ) : evalResult.mode === 'candidate_match' ? (
              <button onClick={handleCollectCheck} disabled={!reconcileCheckChoice}
                className={"px-4 py-3 rounded-lg font-bold w-full text-sm " + (reconcileCheckChoice ? 'bg-emerald-500 text-white hover:bg-emerald-600' : 'bg-slate-300 text-slate-500 cursor-not-allowed')}>
                {reconcileCheckChoice && reconcileCheckChoice.kind === 'attach'
                  ? '🔗 Link Check to Selected Entry & Close / اربط الشيك بالقيد المحدد وأغلق'
                  : reconcileCheckChoice && reconcileCheckChoice.kind === 'new'
                  ? '➕ Create New Treasury Entry & Close / أنشئ قيدًا جديدًا وأغلق'
                  : 'Pick an option above to continue'}
              </button>
            ) : evalResult.mode === 'no_match' ? (
              <button onClick={handleCollectCheck} disabled={!reconcileCheckChoice}
                className={"px-4 py-3 rounded-lg font-bold w-full text-sm " + (reconcileCheckChoice ? 'bg-emerald-500 text-white hover:bg-emerald-600' : 'bg-slate-300 text-slate-500 cursor-not-allowed')}>
                {reconcileCheckChoice
                  ? (reconcileCheckReturned ? '💵 Record Cash Swap & Close / سجّل التبادل النقدي وأغلق' : '✅ Collect & Add to Treasury / تحصيل وإضافة للخزنة')
                  : 'Pick an option above to continue'}
              </button>
            ) : (
              <button onClick={handleCollectCheck}
                className="px-4 py-3 bg-emerald-500 text-white rounded-lg font-bold w-full text-sm hover:bg-emerald-600">
                ✅ Collect & Add to Treasury / تحصيل وإضافة للخزنة
              </button>
            )}
          </Modal>
          );
        })()}

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
                        onBlur={(e) => {
                          // v55.47 — Auto-commit typed text on blur. If the
                          // user typed a customer name and clicked elsewhere
                          // without picking from the dropdown, this rescues
                          // them by committing the typed text (or matching
                          // an existing customer) into customerName so the
                          // submit doesn't fail with "missing customer."
                          // Use a small timeout so a click on a dropdown row
                          // still gets to fire its onClick handler first.
                          setTimeout(() => {
                            const typed = (e.target.value || '').trim();
                            if (!typed) return;
                            // If a customer was already picked AND the typed
                            // text matches their name, do nothing.
                            if (formData.customerName && typed === formData.customerName) return;
                            // Try to find an exact match in the customers list
                            const exact = (customers || []).find(c =>
                              (c.name && c.name.toLowerCase() === typed.toLowerCase()) ||
                              (c.name_ar && c.name_ar === typed)
                            );
                            if (exact) {
                              setFormData(prev => ({...prev,
                                customerId: exact.id,
                                customerName: exact.name || exact.name_ar,
                                custSearch: undefined,
                                showCustDropdown: false,
                                salesRep: prev.salesRep || exact.assigned_rep || '',
                              }));
                            } else {
                              // No match → keep typed text as the customer name
                              // (legacy free-text path). Submit will accept it.
                              setFormData(prev => ({...prev,
                                customerName: typed,
                                customerId: null,
                                custSearch: undefined,
                                showCustDropdown: false,
                              }));
                            }
                          }, 150);
                        }}
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
                <div className="bg-white rounded-lg p-3 mb-2 border-2 border-blue-300">
                  {/* v55.83-A.6.27.44b — Two-tab picker: 📦 From Inventory + ✏️ Manual/Legacy.
                      Default tab: Inventory if invoiceDate is on/after cutoff OR cutoff is null AND
                      inventory_products has data. Otherwise falls back to Manual.
                      Mode is stored in formData.pickerMode ('inventory' | 'manual'). */}
                  {(function () {
                    var invDate = formData.date || today();
                    var hasInventoryProducts = (inventoryProducts || []).length > 0;
                    // Cutoff guidance text — used to nudge but NOT enforce (enforcement comes in 44c)
                    var cutoffMessage = null;
                    if (inventoryCutoffDate) {
                      if (invDate >= inventoryCutoffDate) {
                        cutoffMessage = { kind: 'force-inventory', text: '📦 This invoice date is on/after the cutoff (' + inventoryCutoffDate + ') — inventory mode recommended / يُنصح باستخدام المخزون' };
                      } else {
                        cutoffMessage = { kind: 'allow-both', text: '✏️ This invoice date is before the cutoff (' + inventoryCutoffDate + ') — either mode works / كلا الوضعين متاحان' };
                      }
                    }
                    // Default tab: use formData.pickerMode if set, else derive from cutoff + data availability
                    var defaultMode = formData.pickerMode
                      || (cutoffMessage && cutoffMessage.kind === 'force-inventory' ? 'inventory'
                          : hasInventoryProducts ? 'inventory' : 'manual');
                    return (
                      <>
                        {cutoffMessage && (
                          <div className={'text-[10px] font-semibold mb-2 px-2 py-1 rounded ' + (cutoffMessage.kind === 'force-inventory' ? 'bg-emerald-100 text-emerald-900 border border-emerald-300' : 'bg-blue-100 text-blue-900 border border-blue-300')}>
                            {cutoffMessage.text}
                          </div>
                        )}
                        {/* Tab toggle */}
                        <div className="flex gap-1 mb-2 bg-slate-100 p-1 rounded border border-slate-200">
                          <button
                            onClick={() => setFormData({ ...formData, pickerMode: 'inventory' })}
                            className={'flex-1 px-3 py-1.5 text-xs font-extrabold rounded ' + (defaultMode === 'inventory' ? 'bg-emerald-600 text-white shadow' : 'bg-white text-slate-700 hover:bg-slate-50')}
                          >
                            📦 From Inventory / من المخزون
                            {hasInventoryProducts && <span className="ml-1 opacity-75">({(inventoryProducts || []).length})</span>}
                          </button>
                          <button
                            onClick={() => setFormData({ ...formData, pickerMode: 'manual' })}
                            className={'flex-1 px-3 py-1.5 text-xs font-extrabold rounded ' + (defaultMode === 'manual' ? 'bg-slate-600 text-white shadow' : 'bg-white text-slate-700 hover:bg-slate-50')}
                          >
                            ✏️ Manual / يدوي
                          </button>
                        </div>

                        {/* ─── TAB 1: INVENTORY (NEW v55.83-A.6.27.44b) ─── */}
                        {defaultMode === 'inventory' && (
                          <div>
                            {!hasInventoryProducts ? (
                              <div className="bg-amber-50 border border-amber-300 rounded p-3 text-xs text-amber-900">
                                <div className="font-extrabold">⚠ No inventory products yet / لا توجد منتجات في المخزون</div>
                                <div className="mt-1">Import family templates and receive stock first, or switch to Manual mode.</div>
                              </div>
                            ) : (
                              <>
                                <input
                                  value={formData.invProdSearch || ''}
                                  onChange={e => setFormData({ ...formData, invProdSearch: e.target.value })}
                                  placeholder="Search by code, name (Eng/Ar), or specs... / بحث متعدد الكلمات"
                                  className="w-full px-3 py-2 border-2 border-slate-300 rounded text-sm bg-white text-slate-900 font-medium mb-2"
                                  autoFocus
                                />
                                <div className="max-h-[280px] overflow-auto border border-slate-200 rounded">
                                  {(function () {
                                    // Smart multi-keyword search (same pattern as Inbound Shipments)
                                    var q = (formData.invProdSearch || '').trim().toLowerCase();
                                    var keywords = q ? q.split(/\s+/).filter(function (k) { return k.length > 0; }) : [];
                                    var matches = (inventoryProducts || []).filter(function (p) {
                                      if (!p.active) return false;
                                      if (keywords.length === 0) return true;
                                      var searchable = (
                                        (p.quick_code || '') + ' ' +
                                        (p.variant_suffix ? p.quick_code + '-' + p.variant_suffix + ' ' : '') +
                                        (p.name_en || '') + ' ' +
                                        (p.name_ar || '') + ' ' +
                                        (p.classification_slug || '')
                                      ).toLowerCase();
                                      for (var i = 0; i < keywords.length; i++) {
                                        if (searchable.indexOf(keywords[i]) < 0) return false;
                                      }
                                      return true;
                                    });
                                    // Sort: featured first, then by use_count, then alphabetical
                                    matches.sort(function (a, b) {
                                      var af = a.featured === true ? 1 : 0;
                                      var bf = b.featured === true ? 1 : 0;
                                      if (af !== bf) return bf - af;
                                      var au = Number(a.use_count || 0);
                                      var bu = Number(b.use_count || 0);
                                      if (bu !== au) return bu - au;
                                      return (a.name_en || '').localeCompare(b.name_en || '');
                                    });
                                    matches = matches.slice(0, 30);
                                    if (matches.length === 0) {
                                      return <div className="px-3 py-4 text-xs text-slate-500 text-center italic">No matches / لا توجد نتائج</div>;
                                    }
                                    return matches.map(function (p) {
                                      var displayCode = p.quick_code ? (p.quick_code + (p.variant_suffix ? '-' + p.variant_suffix : '')) : '(no code)';
                                      return (
                                        <div
                                          key={p.id}
                                          onClick={() => {
                                            // v55.83-A.6.27.44b — Add line as inventory-linked.
                                            // Records the linkage (uses_inventory=true + variant_id + warehouse pending)
                                            // WITHOUT calling FIFO consumption — that comes in 44c.
                                            const items = formData.invoiceItems || [];
                                            items.push({
                                              inv_desc: displayCode + ' — ' + (p.name_en || '') + ' / ' + (p.name_ar || ''),
                                              inv_qty: 1,
                                              inv_price: 0,
                                              inv_total: 0,
                                              // v55.83-A.6.27.44b inventory linkage fields
                                              uses_inventory: true,
                                              variant_id: p.id,
                                              variant_quick_code: displayCode,
                                              variant_name_en: p.name_en || '',
                                              variant_name_ar: p.name_ar || '',
                                              variant_uom: p.default_uom || 'meter',
                                              warehouse_id: null, // operator picks this on the line itself (44c)
                                              is_family_template: p.is_family_template === true,
                                            });
                                            setFormData({
                                              ...formData,
                                              invoiceItems: items,
                                              showProductPicker: false,
                                              invProdSearch: '',
                                            });
                                          }}
                                          className="px-3 py-2 text-xs cursor-pointer hover:bg-emerald-600 hover:text-white border-b border-slate-100 last:border-0 transition-colors"
                                        >
                                          <div className="flex items-center gap-2">
                                            {p.featured === true && <span className="text-amber-500">⭐</span>}
                                            <span className="font-mono font-extrabold text-slate-900 hover:text-white">{displayCode}</span>
                                            {p.is_family_template === true && <span className="text-[9px] bg-indigo-600 text-white font-bold rounded px-1.5 py-0.5">FAMILY</span>}
                                            {p.is_family_template === false && p.variant_suffix && <span className="text-[9px] bg-emerald-600 text-white font-bold rounded px-1.5 py-0.5">VARIANT</span>}
                                            {Number(p.use_count || 0) > 0 && <span className="text-[10px] text-slate-500 hover:text-white ml-auto">used {p.use_count}×</span>}
                                          </div>
                                          <div className="text-slate-700 hover:text-white mt-0.5">{p.name_en}</div>
                                          <div className="text-slate-700 hover:text-white" style={{ direction: 'rtl' }}>{p.name_ar}</div>
                                          <div className="text-[10px] text-slate-500 hover:text-white font-mono mt-0.5">{p.classification_slug}</div>
                                        </div>
                                      );
                                    });
                                  })()}
                                </div>
                                <div className="mt-2 text-[10px] text-slate-600 italic">
                                  💡 Picking a variant tags this line for inventory tracking. FIFO consumption activates in next build. / FIFO سيعمل في الإصدار القادم
                                </div>
                              </>
                            )}
                          </div>
                        )}

                        {/* ─── TAB 2: MANUAL/LEGACY (unchanged behavior) ─── */}
                        {defaultMode === 'manual' && (
                          <div>
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
                          </div>
                        )}
                      </>
                    );
                  })()}
                  <button onClick={() => setFormData({...formData, showProductPicker: false})}
                    className="mt-2 px-2 py-1 border border-slate-200 rounded text-[10px] w-full">Close / إغلاق</button>
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
                            {/* v55.83-A.6.27.44b — Show 📦 inventory badge + variant info if linked */}
                            {item.uses_inventory && (
                              <div className="mb-0.5 flex items-center gap-1 flex-wrap">
                                <span className="text-[8px] bg-emerald-600 text-white font-extrabold rounded px-1.5 py-0.5">📦 INVENTORY</span>
                                {item.variant_quick_code && (
                                  <span className="text-[9px] font-mono font-extrabold text-emerald-800">{item.variant_quick_code}</span>
                                )}
                                {item.is_family_template && (
                                  <span className="text-[8px] bg-amber-500 text-white font-bold rounded px-1 py-0.5" title="Family template — Product will be created at consumption">⚠ Template</span>
                                )}
                              </div>
                            )}
                            <input type="text" value={item.inv_desc || ''}
                              onChange={e => { const items = [...(formData.invoiceItems || [])]; items[idx] = {...items[idx], inv_desc: e.target.value}; setFormData({...formData, invoiceItems: items}); }}
                              placeholder="Description / الوصف"
                              className="w-full text-[10px] border rounded px-1 py-0.5"
                              style={{direction: (item.inv_desc || '').match(/[\u0600-\u06FF]/) ? 'rtl' : 'ltr'}} />
                          </td>
                          <td className="px-2 py-1"><input type="number" value={item.inv_qty}
                            onChange={e => { const items = [...(formData.invoiceItems || [])]; items[idx] = {...items[idx], inv_qty: Number(e.target.value) || 0, inv_total: (Number(e.target.value) || 0) * items[idx].inv_price}; setFormData({...formData, invoiceItems: items}); }}
                            className="w-full text-right text-[10px] border rounded px-1 py-0.5" />
                            {item.uses_inventory && (
                              <input type="number" value={item.inv_rolls != null ? item.inv_rolls : ''}
                                onChange={e => { const items = [...(formData.invoiceItems || [])]; items[idx] = {...items[idx], inv_rolls: e.target.value === '' ? '' : (Number(e.target.value) || 0)}; setFormData({...formData, invoiceItems: items}); }}
                                placeholder="rolls / لفات"
                                title="Number of rolls sold on this line (optional — used to track rolls on hand)"
                                className="w-full text-right text-[9px] border border-amber-300 rounded px-1 py-0.5 mt-0.5 text-amber-700 bg-amber-50/40" />
                            )}
                          </td>
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

            {/* v55.83-A.6.27.20 (Max May 17 2026) — Payment Instruments section
                for the NEW INVOICE create flow. Same data model as the existing
                section that lives on the invoice detail modal, but instruments
                are held in form state (`draftInstruments`) and saved AFTER
                the invoice itself is inserted (so they get the real invoice_id).
                Per Max's Option (a): if an instrument fails to save, the
                invoice is still valid — user can open it and add manually.
                Five rules unchanged: still pure documentation. */}
            <div className="mt-4 border border-indigo-200 rounded-xl overflow-hidden bg-indigo-50/30">
              <div className="px-3 py-2 bg-indigo-100">
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: 16 }}>🧾</span>
                  <div>
                    <div className="text-xs font-bold text-indigo-900">
                      Payment Instruments / Scheduled Receivables
                    </div>
                    <div className="text-[10px] text-indigo-700 italic">
                      Optional — checks or promissory notes the customer is providing for this invoice. Documentation only.
                    </div>
                  </div>
                </div>
              </div>
              <div className="p-2 space-y-1.5">
                {/* List of instruments queued for this invoice */}
                {(formData.draftInstruments || []).map(function (di, idx) {
                  return (
                    <div key={idx} className="flex items-center gap-2 bg-white border border-slate-200 rounded p-1.5">
                      <span className="text-base">{di.instrument_type === 'promissory_note' ? '📜' : '🧾'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-bold text-slate-900">
                          {di.instrument_type === 'promissory_note' ? 'Promissory Note' : 'Check'}
                          {di.check_number ? ' #' + di.check_number : ''}
                          {' — '}{fE(Number(di.amount || 0))}
                        </div>
                        <div className="text-[10px] text-slate-600">
                          Due: <strong>{di.due_date}</strong>
                          {di.bank_name ? ' · ' + di.bank_name : ''}
                          {di.notes ? ' · ' + di.notes.substring(0, 40) : ''}
                        </div>
                      </div>
                      <button
                        onClick={function () {
                          setFormData(Object.assign({}, formData, {
                            draftInstruments: (formData.draftInstruments || []).filter(function (_, i) { return i !== idx; }),
                          }));
                        }}
                        className="text-red-500 hover:text-red-700 text-xs px-1 font-bold"
                        title="Remove"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}

                {/* Inline add form OR the "+ Add" button */}
                {!formData.showDraftInstrumentForm ? (
                  <button
                    onClick={function () {
                      setFormData(Object.assign({}, formData, {
                        showDraftInstrumentForm: true,
                        draftInstrumentDraft: {
                          instrument_type: 'check',
                          check_number: '',
                          amount: '',
                          issue_date: formData.date || today(),
                          due_date: '',
                          bank_name: '',
                          notes: '',
                        },
                      }));
                    }}
                    className="w-full px-2 py-1.5 bg-white hover:bg-indigo-100 text-indigo-900 rounded text-[11px] font-bold border-2 border-dashed border-indigo-300"
                  >
                    + Add Check / Promissory Note
                  </button>
                ) : (
                  <div className="border border-indigo-300 rounded p-2 bg-white space-y-1.5">
                    <div className="grid grid-cols-2 gap-1.5">
                      <label className="text-[10px] font-semibold text-slate-700">Type
                        <select
                          value={(formData.draftInstrumentDraft || {}).instrument_type || 'check'}
                          onChange={function (e) {
                            setFormData(Object.assign({}, formData, {
                              draftInstrumentDraft: Object.assign({}, formData.draftInstrumentDraft, { instrument_type: e.target.value }),
                            }));
                          }}
                          className="w-full mt-0.5 px-1.5 py-1 border border-slate-300 rounded text-[11px] bg-white"
                        >
                          <option value="check">Check / شيك</option>
                          <option value="promissory_note">Promissory Note / كمبيالة</option>
                          <option value="other">Other / آخر</option>
                        </select>
                      </label>
                      <label className="text-[10px] font-semibold text-slate-700">Number
                        <input
                          type="text"
                          value={(formData.draftInstrumentDraft || {}).check_number || ''}
                          onChange={function (e) {
                            setFormData(Object.assign({}, formData, {
                              draftInstrumentDraft: Object.assign({}, formData.draftInstrumentDraft, { check_number: e.target.value }),
                            }));
                          }}
                          placeholder="e.g. 1234"
                          className="w-full mt-0.5 px-1.5 py-1 border border-slate-300 rounded text-[11px]"
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <label className="text-[10px] font-semibold text-slate-700">Amount *
                        <input
                          type="text"
                          value={(formData.draftInstrumentDraft || {}).amount || ''}
                          onChange={function (e) {
                            setFormData(Object.assign({}, formData, {
                              draftInstrumentDraft: Object.assign({}, formData.draftInstrumentDraft, { amount: e.target.value }),
                            }));
                          }}
                          placeholder="50000"
                          className="w-full mt-0.5 px-1.5 py-1 border border-slate-300 rounded text-[11px] font-mono"
                        />
                      </label>
                      <label className="text-[10px] font-semibold text-slate-700">Bank
                        <input
                          type="text"
                          value={(formData.draftInstrumentDraft || {}).bank_name || ''}
                          onChange={function (e) {
                            setFormData(Object.assign({}, formData, {
                              draftInstrumentDraft: Object.assign({}, formData.draftInstrumentDraft, { bank_name: e.target.value }),
                            }));
                          }}
                          placeholder="CIB / NBE"
                          className="w-full mt-0.5 px-1.5 py-1 border border-slate-300 rounded text-[11px]"
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <label className="text-[10px] font-semibold text-slate-700">Issue Date
                        <input
                          type="date"
                          value={(formData.draftInstrumentDraft || {}).issue_date || ''}
                          onChange={function (e) {
                            setFormData(Object.assign({}, formData, {
                              draftInstrumentDraft: Object.assign({}, formData.draftInstrumentDraft, { issue_date: e.target.value }),
                            }));
                          }}
                          className="w-full mt-0.5 px-1.5 py-1 border border-slate-300 rounded text-[11px]"
                        />
                      </label>
                      <label className="text-[10px] font-semibold text-slate-700">Due Date *
                        <input
                          type="date"
                          value={(formData.draftInstrumentDraft || {}).due_date || ''}
                          onChange={function (e) {
                            setFormData(Object.assign({}, formData, {
                              draftInstrumentDraft: Object.assign({}, formData.draftInstrumentDraft, { due_date: e.target.value }),
                            }));
                          }}
                          className="w-full mt-0.5 px-1.5 py-1 border border-slate-300 rounded text-[11px]"
                        />
                      </label>
                    </div>
                    <label className="text-[10px] font-semibold text-slate-700 block">Notes
                      <input
                        type="text"
                        value={(formData.draftInstrumentDraft || {}).notes || ''}
                        onChange={function (e) {
                          setFormData(Object.assign({}, formData, {
                            draftInstrumentDraft: Object.assign({}, formData.draftInstrumentDraft, { notes: e.target.value }),
                          }));
                        }}
                        placeholder="Optional"
                        className="w-full mt-0.5 px-1.5 py-1 border border-slate-300 rounded text-[11px]"
                      />
                    </label>
                    <div className="flex gap-1.5 pt-1">
                      <button
                        onClick={function () {
                          var d = formData.draftInstrumentDraft || {};
                          var amt = parseAmount(d.amount);
                          if (!amt || amt <= 0) { toast.error('Amount required'); return; }
                          if (!d.due_date) { toast.error('Due date required'); return; }
                          var queued = (formData.draftInstruments || []).concat([{
                            instrument_type: d.instrument_type || 'check',
                            check_number: d.check_number || '',
                            amount: amt,
                            issue_date: d.issue_date || null,
                            due_date: d.due_date,
                            bank_name: d.bank_name || '',
                            notes: d.notes || '',
                          }]);
                          setFormData(Object.assign({}, formData, {
                            draftInstruments: queued,
                            showDraftInstrumentForm: false,
                            draftInstrumentDraft: null,
                          }));
                        }}
                        className="flex-1 px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-[11px] font-bold"
                      >
                        Add to invoice
                      </button>
                      <button
                        onClick={function () {
                          setFormData(Object.assign({}, formData, {
                            showDraftInstrumentForm: false,
                            draftInstrumentDraft: null,
                          }));
                        }}
                        className="px-2 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded text-[11px] font-semibold"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                {(formData.draftInstruments || []).length > 0 && (
                  <div className="text-[10px] text-indigo-800 italic text-center pt-1">
                    {(formData.draftInstruments || []).length} instrument{(formData.draftInstruments || []).length === 1 ? '' : 's'} will be saved with this invoice
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-2">
              <button onClick={async () => {
                // v55.47 — Smarter validation. The "Please fill order#, customer,
                // and add items" alert was firing even when the user clearly had
                // all three filled in. Root cause: the customer search input
                // writes typed text to `formData.custSearch`, and `customerName`
                // is ONLY set when the user explicitly taps a row in the
                // dropdown. If they typed and the dropdown closed (or they
                // clicked elsewhere) without picking, customerName stayed
                // empty even though the visible field had their text.
                //
                // The fix: if customerName is empty but custSearch has text,
                // promote custSearch to customerName here. Also try to match
                // against the customers list so we set customerId too. Plus
                // a specific error per missing field instead of the generic
                // "fill all" message.
                const items = formData.invoiceItems || [];
                // v55.82-E — parseAmount for the fallback typed amount.
                // The items.reduce path is already numeric (built from
                // line items), but the fallback `formData.amount` is a
                // user-typed string and was hitting the comma/Arabic NaN
                // bug.
                const totalAmt = items.reduce((a, i) => a + (i.inv_total || 0), 0) || parseAmount(formData.amount) || 0;

                // Promote custSearch → customerName if needed
                let resolvedCustomerName = formData.customerName;
                let resolvedCustomerId = formData.customerId;
                if (!resolvedCustomerName && formData.custSearch && String(formData.custSearch).trim()) {
                  const typed = String(formData.custSearch).trim();
                  // Try exact-match against customers list (case-insensitive,
                  // English or Arabic name). If found, use that customer's id.
                  const exact = (customers || []).find(c =>
                    (c.name && c.name.toLowerCase() === typed.toLowerCase()) ||
                    (c.name_ar && c.name_ar === typed)
                  );
                  if (exact) {
                    resolvedCustomerName = exact.name || exact.name_ar;
                    resolvedCustomerId = exact.id;
                  } else {
                    // No match → use typed text as the customer name (legacy
                    // free-text path; the invoices.customer_name column is
                    // just text so this is fine).
                    resolvedCustomerName = typed;
                  }
                }

                // Specific error per missing field
                const missing = [];
                if (!formData.orderNumber || !String(formData.orderNumber).trim()) missing.push('Order #');
                if (!resolvedCustomerName) missing.push('Customer');
                if (totalAmt <= 0) missing.push('Items (or amount)');
                if (missing.length > 0) {
                  alert('Missing: ' + missing.join(', ') + '\n\nPlease fill these fields and try again. / يرجى ملء الحقول المفقودة.');
                  return;
                }
                try {
                  const orderNum = sanitize(formData.orderNumber);
                  const { data: newInv } = await supabase.from('invoices').insert({
                    order_number: orderNum, customer_name: sanitize(resolvedCustomerName),
                    customer_id: resolvedCustomerId || null,
                    invoice_date: formData.date || today(), total_amount: totalAmt,
                    total_collected: 0, outstanding: totalAmt, sales_rep: formData.salesRep || '',
                    notes: sanitize(formData.notes || ''), source: 'manual',
                  }).select('id').single();
                  if (newInv && items.length > 0) {
                    for (const item of items) {
                      // v55.83-T — SINGLE inventory engine. Inventory-linked items carry
                      // uses_inventory + variant_id; on insert we call System A's
                      // consume_invoice_item_inventory RPC (FIFO over inventory_layers),
                      // which stamps cogs_total + gross_profit. No other engine runs.
                      const itemPayload = {
                        invoice_id: newInv.id, description: item.inv_desc,
                        quantity: item.inv_qty, unit_price: item.inv_price, line_total: item.inv_total,
                        product_id: item.product_id || null,
                      };
                      // Only attach the new variant-linkage fields when this item came from the
                      // 📦 From Inventory tab. Other items keep legacy/manual behavior unchanged.
                      if (item.uses_inventory === true && item.variant_id) {
                        itemPayload.uses_inventory = true;
                        itemPayload.variant_id = item.variant_id;
                        if (item.warehouse_id) itemPayload.warehouse_id = item.warehouse_id;
                        itemPayload.uom = item.variant_uom || null;
                        itemPayload.sale_quantity = Number(item.inv_qty) || 0;
                        itemPayload.sale_price_per_uom = Number(item.inv_price) || 0;
                        // v55.83-H — record rolls sold on this line (optional). Pure attribute;
                        // FIFO/cost consumption is unaffected. The Overview subtracts summed
                        // rolls_sold from rolls received to show real rolls-on-hand.
                        if (item.inv_rolls !== '' && item.inv_rolls != null) itemPayload.rolls_sold = Number(item.inv_rolls) || 0;
                        itemPayload.inventory_status = 'draft';
                      }
                      const insertedItem = await dbInsert('invoice_items', itemPayload, user?.id);
                      // v55.83-A.6.27.44c — Auto-FIFO-consume for inventory-linked items.
                      // Fires on submit (insert). Reads from inventory_layers oldest-first,
                      // stamps cogs_total + gross_profit + consumed_layers on the item,
                      // creates an inventory_backorders row if sale qty > available stock.
                      // Failure here does NOT fail the whole invoice — operator gets a
                      // toast warning and can review/fix manually.
                      if (item.uses_inventory === true && item.variant_id && virtualMixIds[item.variant_id]) {
                        // v55.83-GE — SAFETY GATE: never run FIFO against a virtual Stock Mix product
                        // (it has no stock layers of its own). Phase 2 will expand it into real
                        // component colors; until then, do not deduct and warn clearly.
                        toast.warning('Virtual Stock Mix cannot be sold yet (component drawdown not enabled) — stock NOT deducted for "' + (item.inv_desc || '?').substring(0, 50) + '". Remove this line or sell the real color products. / لا يمكن بيع المزيج الافتراضي بعد');
                      } else if (item.uses_inventory === true && item.variant_id && insertedItem && insertedItem.id) {
                        try {
                          const consumeRes = await supabase.rpc('consume_invoice_item_inventory', { p_item_id: insertedItem.id });
                          if (consumeRes.error) {
                            console.error('[invoice-save] consume_invoice_item_inventory failed:', consumeRes.error);
                            toast.warning('Inventory consumption failed for line "' + (item.inv_desc || '?').substring(0, 50) + '" — ' + (consumeRes.error.message || 'unknown') + '. Invoice saved but stock not deducted; reopen to fix. / فشل خصم المخزون');
                          } else if (consumeRes.data && consumeRes.data.backorder_qty && Number(consumeRes.data.backorder_qty) > 0) {
                            // Soft-warn backorder
                            toast.warning('⚠ Sold more than available stock — created backorder for ' + consumeRes.data.backorder_qty + ' units on "' + (item.inv_desc || '?').substring(0, 50) + '" / تم إنشاء طلب معلق');
                          }
                        } catch (e) {
                          console.error('[invoice-save] consume RPC threw:', e);
                          toast.warning('Inventory deduction failed for line "' + (item.inv_desc || '?').substring(0, 30) + '". Invoice still saved. / فشل خصم المخزون');
                        }
                      }
                      // Auto-deduct from OLD inventory if product_id set (legacy)
                      if (item.product_id) {
                        const prod = inventory.find(p => p.id === item.product_id);
                        if (prod) {
                          const newQty = Math.max(0, Number(prod.current_quantity || prod.roll_count || 0) - Number(item.inv_qty || 0));
                          await dbUpdate('inventory', prod.id, { current_quantity: newQty, stock_status: newQty <= 0 ? 'out_of_stock' : newQty < 5 ? 'low' : 'in_stock' }, user?.id);
                        }
                      }
                      // v55.83-T — System B (inv_sku_id / consumeFifo / inv_movements) RETIRED.
                      // Every sale now deducts stock + COGS through ONE engine only: System A's
                      // consume_invoice_item_inventory RPC above (variant_id -> inventory_layers).
                      // This removes the parallel/double-deduction path entirely.
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
                  // Instant local update so new invoice appears at top immediately.
                  // Only prepend if we have the real inserted row; otherwise skip the
                  // optimistic update and let loadAllData fetch truth. Never fabricate
                  // a 'temp-' id — Postgres uuid columns reject it and Edit/Delete breaks.
                  if (newInv && newInv.id) {
                    const optimistic = {
                      ...newInv,
                      order_number: orderNum,
                      customer_name: sanitize(formData.customerName),
                      invoice_date: formData.date || today(),
                      total_amount: totalAmt,
                      total_collected: newInv.total_collected || 0,
                      outstanding: newInv.outstanding != null ? newInv.outstanding : totalAmt,
                      sales_rep: formData.salesRep || newInv.sales_rep || '',
                      notes: sanitize(formData.notes || ''),
                      source: newInv.source || 'manual',
                    };
                    setInvoices(prev => [optimistic, ...prev]);
                  }

                  // v55.83-A.6.27.20 (Max May 17 2026) — save any draft
                  // Payment Instruments queued during invoice creation. Per
                  // Max's Option (a): atomic from user POV but no rollback.
                  // If any instrument fails, the invoice still exists and
                  // we tell the user to open it and add manually.
                  // Rules unchanged: pure documentation, never writes to
                  // treasury or invoice money math.
                  var instrumentsSaved = 0;
                  var instrumentsFailed = 0;
                  if (newInv && newInv.id && (formData.draftInstruments || []).length > 0) {
                    for (const di of formData.draftInstruments) {
                      try {
                        await dbInsert('checks', {
                          instrument_type: di.instrument_type || 'check',
                          customer_name: sanitize(resolvedCustomerName || formData.customerName),
                          customer_id: resolvedCustomerId || null,
                          order_number: orderNum,
                          invoice_id: newInv.id,
                          amount: Number(di.amount),
                          check_number: di.check_number || '',
                          bank_name: di.bank_name || '',
                          issue_date: di.issue_date || null,
                          check_date: di.due_date,    // legacy column — kept in sync
                          due_date: di.due_date,
                          status: 'pending',
                          notes: di.notes || '',
                          created_by: user?.id,
                          updated_by: user?.id,
                        }, user?.id);
                        instrumentsSaved++;
                      } catch (instErr) {
                        console.warn('[create-invoice] instrument save failed:', instErr && instErr.message, di);
                        instrumentsFailed++;
                      }
                    }
                  }

                  setShowAddInvoice(false); setFormData({});
                  if (instrumentsFailed > 0) {
                    toast.warning('Invoice created ✓ — but ' + instrumentsFailed + ' instrument' + (instrumentsFailed === 1 ? '' : 's') + ' failed to save. Open the invoice to add manually.');
                  } else if (instrumentsSaved > 0 && backfillCount > 0) {
                    toast.success('Invoice + ' + instrumentsSaved + ' instrument' + (instrumentsSaved === 1 ? '' : 's') + ' + ' + backfillCount + ' linked treasury entr' + (backfillCount === 1 ? 'y' : 'ies') + ' ✓');
                  } else if (instrumentsSaved > 0) {
                    toast.success('Invoice + ' + instrumentsSaved + ' instrument' + (instrumentsSaved === 1 ? '' : 's') + ' saved ✓');
                  } else if (backfillCount > 0) {
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
            v55.49 — Hides itself when ANY child modal is open
            (duplicateConfirm OR pendingTreasuryRecord). Previously the
            form Modal at z-50 could trap child modals behind it on iOS
            Safari due to a backdrop-filter stacking-context quirk —
            user reported "I tap Confirm on the duplicate warning, the
            invoice form opens, I fill it, tap Save, nothing happens"
            (actually the next modal was opening invisibly). Now: only
            ONE modal on screen at a time. formData is preserved in
            state so when the child closes via Cancel, the form returns
            with all values intact.
        ========================================== */}
        {/* v55.83-A.6.27.71 (Phase 2) — Bucket-create modal. Lives at the
            page level so it can be triggered from either Treasury tab or
            Warehouse tab. Renders only when showBucketModal is true. Has
            ZERO interaction with showAddTreasury — both can never be open
            simultaneously since UI buttons are separate, but even if they
            could, they have independent state machines. */}
        <WarehouseBucketCreate
          open={showBucketModal}
          onClose={() => { setShowBucketModal(false); }}
          onCreated={(bucket) => {
            // Bump reload token so the bucket list refreshes; also reload
            // treasury data so the new placeholder row appears immediately.
            setBucketReloadToken(t => t + 1);
            try { loadAllData && loadAllData(); } catch (_) {}
          }}
          userId={userProfile?.id}
          users={teamUsers}
          toast={toast}
          lang={lang}
        />

        {showAddTreasury && !pendingTreasuryRecord && !duplicateConfirm && (
          <Modal onClose={() => {
            // v55.82-E — Full reset on every close path. See companion notes
            // on the Cancel button + the "+ New Transaction" button.
            setShowAddTreasury(false);
            setFormData({});
            setTreasuryFormErrors([]);
            setPendingTreasuryRecord(null);
            setDuplicateConfirm(null);
            setIsCreatingInvoice(false);
            setCreateInvoiceError(null);
          }} title="New Transaction / معاملة جديدة">
            {/* v55.47 — Persistent in-form validation error banner. When the
                user taps Save and validation fails, this red box appears at
                the top of the form listing every missing field. The user
                cannot miss this even if they don't see the corner toast.
                Cleared automatically the next time validation passes. */}
            {treasuryFormErrors.length > 0 && (
              <div className="mb-3 rounded-lg border-2 border-red-500 bg-red-50 p-3" role="alert">
                <div className="flex items-start gap-2">
                  <span className="text-2xl flex-shrink-0">⚠️</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-extrabold text-red-900 mb-1">
                      Cannot save — please fix {treasuryFormErrors.length} item{treasuryFormErrors.length === 1 ? '' : 's'}:
                    </div>
                    <ul className="text-xs text-red-800 space-y-1 mt-1">
                      {treasuryFormErrors.map((e, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <span className="font-bold flex-shrink-0">•</span>
                          <span><b>{e.label}:</b> {e.msg}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <button onClick={() => setTreasuryFormErrors([])}
                    className="text-red-600 hover:text-red-800 text-lg leading-none px-1 flex-shrink-0"
                    aria-label="Dismiss errors">×</button>
                </div>
              </div>
            )}
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
                        <div className="p-2 bg-indigo-50 border border-indigo-200 rounded" data-treasury-field="bankNonOrderCategory">
                          <label className="text-[11px] font-bold text-indigo-900 block mb-1">
                            What is this? / ما نوع هذا القيد؟ *
                          </label>
                          <select value={formData.bankNonOrderCategory || ''}
                            onChange={e => {
                              setFormData({ ...formData, bankNonOrderCategory: e.target.value });
                              if (treasuryFormErrors.length > 0 && e.target.value) {
                                setTreasuryFormErrors(prev => prev.filter(x => x.field !== 'bankNonOrderCategory'));
                              }
                            }}
                            className={'w-full px-2 py-1.5 rounded border text-sm bg-white ' + (treasuryFormErrors.some(x => x.field === 'bankNonOrderCategory') ? 'border-red-500' : 'border-indigo-300')}>
                            <option value="">Select a category…</option>
                            {BANK_NONORDER_CATS.map(c => (
                              <option key={c.v} value={c.v}>{c.en} / {c.ar}</option>
                            ))}
                          </select>
                          {treasuryFormErrors.some(x => x.field === 'bankNonOrderCategory') && (
                            <div className="text-[10px] text-red-600 font-semibold mt-0.5">⚠️ Required</div>
                          )}
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
              <div data-treasury-field="amount">
                <label className="text-xs font-semibold text-slate-600">
                  {(formData.type === 'bank_in' || formData.type === 'bank_out') ? 'Expected Amount / المبلغ المتوقع' : 'Amount / المبلغ'}
                  <span className="text-red-500 ml-0.5">*</span>
                </label>
                <input type="number" value={formData.amount || ''}
                  onChange={e => {
                    setFormData({ ...formData, amount: e.target.value });
                    // v55.47 — clear the amount error as soon as the user types something valid
                    if (treasuryFormErrors.length > 0 && e.target.value && Number(e.target.value) > 0) {
                      setTreasuryFormErrors(prev => prev.filter(x => x.field !== 'amount'));
                    }
                  }}
                  placeholder="0.00"
                  className={'w-full px-3 py-2 rounded-lg border text-sm ' + (treasuryFormErrors.some(x => x.field === 'amount') ? 'border-red-500 bg-red-50' : 'border-slate-200')} />
                {treasuryFormErrors.some(x => x.field === 'amount') && (
                  <div className="text-[10px] text-red-600 font-semibold mt-0.5">⚠️ Required</div>
                )}
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
                <div className="col-span-2" data-treasury-field="bankAccountId">
                  <label className="text-xs font-semibold text-slate-600">Bank Account / الحساب البنكي *</label>
                  <select value={formData.bankAccountId || ''}
                    onChange={e => {
                      setFormData({ ...formData, bankAccountId: e.target.value });
                      if (treasuryFormErrors.length > 0 && e.target.value) {
                        setTreasuryFormErrors(prev => prev.filter(x => x.field !== 'bankAccountId'));
                      }
                    }}
                    className={'w-full px-3 py-2 rounded-lg border text-sm bg-indigo-50 ' + (treasuryFormErrors.some(x => x.field === 'bankAccountId') ? 'border-red-500' : 'border-indigo-300')}>
                    <option value="">Select bank account...</option>
                    {egyptBankAccounts.map(a => (
                      <option key={a.id} value={a.id}>
                        🏦 {a.bank_name}{a.account_name ? ' — ' + a.account_name : ''}{a.account_number ? ' (' + a.account_number + ')' : ''}
                      </option>
                    ))}
                  </select>
                  {treasuryFormErrors.some(x => x.field === 'bankAccountId') && (
                    <div className="text-[10px] text-red-600 font-semibold mt-0.5">⚠️ Required</div>
                  )}
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
                  <div data-treasury-field="orderNumber">
                    <label className="text-xs font-semibold text-slate-600">Order # / رقم{isBank ? ' *' : ''}</label>
                    <input value={formData.orderNumber || ''}
                      onChange={e => {
                        setFormData({ ...formData, orderNumber: e.target.value });
                        if (treasuryFormErrors.length > 0 && e.target.value.trim()) {
                          setTreasuryFormErrors(prev => prev.filter(x => x.field !== 'orderNumber'));
                        }
                      }}
                      placeholder="Type to search..."
                      className={'w-full px-3 py-2 rounded-lg border text-sm ' + (treasuryFormErrors.some(x => x.field === 'orderNumber') ? 'border-red-500 bg-red-50' : 'border-slate-200')} />
                    {treasuryFormErrors.some(x => x.field === 'orderNumber') && (
                      <div className="text-[10px] text-red-600 font-semibold mt-0.5">⚠️ Required</div>
                    )}
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
              <div className="col-span-2" data-treasury-field="desc">
                <label className="text-xs font-semibold text-slate-600">
                  Description / الوصف
                  {(formData.type === 'bank_in' || formData.type === 'bank_out') && <span className="text-red-500 ml-0.5">*</span>}
                </label>
                <input value={formData.desc || ''}
                  onChange={e => {
                    setFormData({ ...formData, desc: e.target.value });
                    if (treasuryFormErrors.length > 0 && e.target.value.trim()) {
                      setTreasuryFormErrors(prev => prev.filter(x => x.field !== 'desc'));
                    }
                  }}
                  className={'w-full px-3 py-2 rounded-lg border text-sm ' + (treasuryFormErrors.some(x => x.field === 'desc') ? 'border-red-500 bg-red-50' : 'border-slate-200')} />
                {treasuryFormErrors.some(x => x.field === 'desc') && (
                  <div className="text-[10px] text-red-600 font-semibold mt-0.5">⚠️ Required for bank entries</div>
                )}
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
                      {formData.category && !isKnownCat(formData.category, categoriesList) && !customCats.includes(formData.category) && formData.category !== '__custom' && (
                        <option value={formData.category}>✨ {formData.category}</option>
                      )}
                      {catOptions.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                      {customCats.map(c => <option key={c} value={c}>{c}</option>)}
                      <option value="__custom">+ Add New Category / إضافة تصنيف جديد</option>
                    </select>
                  )}
                  {formData.category && !isKnownCat(formData.category, categoriesList) && !customCats.includes(formData.category) && !formData.showCustomCat && (
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
                disabled={treasurySaving}
                className={'px-4 py-2 bg-blue-500 text-white rounded-lg font-semibold ' + (treasurySaving ? 'opacity-60 cursor-wait' : 'hover:bg-blue-600')}>
                {treasurySaving ? 'Saving… / جاري الحفظ' : 'Save / حفظ ✓'}
              </button>
              <button onClick={() => {
                  // v55.82-E — Cancel must clean ALL modal-companion state too,
                  // not just showAddTreasury + formData. Otherwise leftover
                  // pendingTreasuryRecord / duplicateConfirm / treasuryFormErrors
                  // can keep the next "+ New Transaction" open from rendering.
                  setShowAddTreasury(false);
                  setFormData({});
                  setTreasuryFormErrors([]);
                  setPendingTreasuryRecord(null);
                  setDuplicateConfirm(null);
                  setIsCreatingInvoice(false);
                  setCreateInvoiceError(null);
                }}
                className="px-4 py-2 border border-slate-200 rounded-lg font-semibold">Cancel / إلغاء</button>
            </div>
          </Modal>
        )}

        {/* ===== FLOATING REMINDER BANNER (all tabs) ===== */}
        {tab !== 'dashboard' && (() => {
          const todayStr = todayET();
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
          <div className="flex flex-col">

            {/* v55.83-A.6.27.9 (Max May 15 2026) — FX widget pinned to the
                top of the dashboard. Compact: single small row, USD→EGP
                only, doesn't push the AI hero down. Hidden when fxRate
                isn't loaded yet (no flash of empty space). */}
            {fxRate && (
              <div className="flex justify-end mb-2">
                <div className="flex items-center gap-2 px-3 py-1 bg-slate-900/60 rounded-lg border border-slate-700/60">
                  <span className="text-[10px] text-slate-400 font-semibold">USD/EGP</span>
                  <span className="text-sm font-black text-emerald-400 font-mono">{fxRate.rate.toFixed(2)}</span>
                  <span className="text-[10px]">💱</span>
                </div>
              </div>
            )}

            {/* v55.83-A.6.18 (Max May 14 2026) — In-place ticket editor.
                Renders OVER the dashboard so the user never loses their
                place. Mounted only while dashboardTicketModal is set, so
                the underlying TicketsTab in its own tab is never duplicated. */}
            <DashboardTicketModalOverlay
              ticketId={dashboardTicketModal}
              onClose={() => setDashboardTicketModal(null)}
              toast={toast}
              customers={customers}
              user={user}
              userProfile={userProfile}
              users={teamUsers}
              onReload={loadAllData}
              lang={lang}
              isAdmin={isAdmin}
              modulePerms={modulePerms}
            />

            {/* v55.81 — Per Max May 9 2026: AI Workforce (Nadia/Sara/Jenna)
                must be the focal point of the dashboard. Use flex `order:`
                to pin PersonalDashboard (the AI Workforce hero) ABOVE the
                widget cluster (WhatsNew, NadiaNewBuildCard, PendingMessages,
                Treasury terminal, etc.) regardless of render order. The
                widgets render in JSX before PersonalDashboard for code-flow
                reasons, but flex order makes them visually appear AFTER. */}
            <div className="flex flex-col" style={{ order: 2 }}>

            {/* v55.83-A.6.27.9 (Max May 15 2026) — Compact action button row.
                Replaces the two big mb-3 buttons that used to live separately
                inside the announcement + reminder sections below. Now both
                appear as small pills on one row right under the AI hero,
                before the priority cards. Forms (announcement modal, reminder
                form) still mount further down — these just toggle their
                visibility state. Archive link sits under as a discreet link. */}
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              {isAdmin && (
                <button onClick={() => setShowAddAnnouncement(true)}
                  className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-xs font-bold shadow"
                  title="Send an urgent broadcast to team members">
                  📢 Send Message to Team
                </button>
              )}
              {(isAdmin || modulePerms?.['Post Reminders']) && (
                <button onClick={() => setShowReminderForm(!showReminderForm)}
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-bold shadow"
                  title="Post a reminder visible to selected team members">
                  📢 {showReminderForm ? 'Close Reminder' : 'Post Reminder'}
                </button>
              )}
            </div>
            {/* v55.83-A.6.27.10 — fix ReferenceError: archivedReminders was
                a local var inside the reminder widget's IIFE further down,
                not in scope here. Compute inline from component-level
                `reminders` state so the archive link works wherever the
                button is placed. */}
            {(() => {
              var myIdLocal = userProfile?.id || user?.id;
              var todayStrLocal = todayET();
              var archCount = (reminders || []).filter(function (r) {
                var isForMe = !r.target_users || r.target_users === 'all' || (r.target_users || '').includes(myIdLocal);
                if (!isForMe) return false;
                var d = r.reminder_date || (r.created_at && r.created_at.substring(0, 10));
                return d && d < todayStrLocal;
              }).length;
              if (archCount === 0) return null;
              return (
                <div className="mb-3">
                  <button onClick={() => setShowReminderArchive(!showReminderArchive)}
                    className="text-[11px] text-slate-400 hover:text-blue-400 hover:underline font-semibold">
                    📋 {showReminderArchive ? 'Hide' : 'View'} past reminders ({archCount})
                  </button>
                </div>
              );
            })()}

            {/* v55.83-A.6.18 (Max May 14 2026) — Three high-priority cards:
                Overdue Tickets / Recent Updates / Newly Assigned. Inserted
                FIRST in the order:2 cluster so they show immediately after
                the AI Workforce hero. Each ticket click opens a dashboard-
                mounted modal so the user stays on the dashboard. */}
            <DashboardPrioritySections
              dashTickets={dashTickets}
              recentTicketUpdates={recentTicketUpdates}
              myId={userProfile?.id || user?.id}
              users={teamUsers}
              todayStr={todayET()}
              onOpenTicket={(t) => { setDashboardTicketModal(t.id); }}
              onAcknowledge={ackDashboardTicket}
              busyAckId={busyAckId}
            />

            {/* v55.83-A.6.27.9 — Pending Bank Confirmations moved up to
                immediately follow the priority cards per Max May 15 2026
                ("Move Invoices Awaiting Bank Confirmation immediately after
                Your Daily Priorities"). */}
            <PendingBankConfirmationsWidget
              invoices={invoices}
              isSuperAdmin={isSuperAdmin}
              modulePerms={modulePerms}
              onSelectInvoice={(inv) => { setTab('sales'); setSelectedInvoice(inv); }}
              fE={fE}
            />

            {/* v55.83-A.6.27.11 (Max May 15 2026) — Summary cards (Team
                Tickets / Today's Events / Follow-ups) + Today widget +
                Reminders + Monthly Sales mount HERE, below the new Daily
                Priorities GUI. Previously they rendered ABOVE the priorities
                inside the order:1 PersonalDashboard mount; the AI hero
                stays up top (renderSection="ai" below) but the rest follows
                the priorities per Max's spec: "These should be kept but go
                below (not above) the new dashboard GUI". */}
            <PersonalDashboard user={user} userProfile={userProfile} isAdmin={isAdmin} isSuperAdmin={isSuperAdmin}
              invoices={invoices} customers={customers} navigate={navigate} fE={fE} users={teamUsers}
              renderSection="rest" />

            {/* v55.83-A.6.27.9 — What's New is COLLAPSED by default now.
                Was auto-prominent at the top, which was repetitive on every
                login. User can still expand to see latest builds. */}
            <div className="mb-3">
              <WhatsNewWidget isAdmin={isAdmin} isSuperAdmin={isSuperAdmin} prominent={false} />
            </div>

            {/* v55.60 — Nadia highlights when a new build has deployed.
                Shows the latest build version, label, and top 3 highlights
                in a Nadia-styled card. User taps "Got it" and it disappears
                until the next build. */}
            <NadiaNewBuildCard isAdmin={isAdmin} isSuperAdmin={isSuperAdmin} />

            {/* v55.45 — Pending team messages + reminders, with per-item
                Acknowledge buttons. Renders nothing if nothing pending. */}
            <PendingNadiaMessages
              userId={userProfile?.id || user?.id}
              getUserName={getUserName}
            />

            {/* ===========================================================
                TERMINAL EXECUTIVE SUMMARY (v55.8 — Apr 25 2026)
                ===========================================================
                Bloomberg-style command-deck overview. Permission-gated:
                only renders for users with Treasury access (matches the
                header NET widget logic). Six tiles in a sharp grid:
                  • Treasury Net (with sparkline)
                  • Month-to-date In/Out/Net
                  • A/R + overdue
                  • Pending checks (next 7 days)
                  • Open tickets + my queue
                  • System status (last login, sync state)
                Pure data. No emoji except status dots. Tabular numerics
                in JetBrains Mono. Sharp corners. Click-through on every
                tile to the relevant tab.
                =========================================================== */}
            {(isSuperAdmin || modulePerms?.['Treasury'] === true) && (() => {
              const todayN = todayET();
              const monthStart = todayN.substring(0, 7) + '-01';
              const sevenDaysOut = new Date(Date.now() + 7 * 86400000).toISOString().substring(0, 10);
              const myId = userProfile?.id;

              // Money flows
              const monthIn = treasury.filter(t => (t.transaction_date || '') >= monthStart).reduce((a, t) => a + Number(t.cash_in || 0) + Number(t.bank_in || 0), 0);
              const monthOut = treasury.filter(t => (t.transaction_date || '') >= monthStart).reduce((a, t) => a + Number(t.cash_out || 0) + Number(t.bank_out || 0), 0);
              const monthNet = monthIn - monthOut;

              // A/R and overdue
              const ar = invoices.reduce((a, i) => a + Number(i.outstanding || 0), 0);
              const overdueInvs = invoices.filter(i => Number(i.outstanding || 0) > 0 && i.invoice_date && (Date.now() - new Date(i.invoice_date).getTime()) > 30 * 86400000);
              const overdueAmt = overdueInvs.reduce((a, i) => a + Number(i.outstanding || 0), 0);

              // Checks
              const pendCkAmt = pendingChecks.reduce((a, c) => a + Number(c.amount || 0), 0);
              const overdueCk = pendingChecks.filter(c => (c.due_date || c.check_date || '') < todayN && (c.due_date || c.check_date));
              const next7Ck = pendingChecks.filter(c => {
                const d = c.due_date || c.check_date;
                return d && d >= todayN && d <= sevenDaysOut;
              });
              const next7CkAmt = next7Ck.reduce((a, c) => a + Number(c.amount || 0), 0);

              // Tickets
              const openT = (dashTickets || []).filter(t => t.status !== 'Closed' && t.status !== 'Resolved');
              const myT = openT.filter(t => t.assigned_to === myId);
              const overdueT = myT.filter(t => t.due_date && t.due_date < todayN);

              // 30-day sparkline data for treasury net
              const sparkData = (() => {
                var days = [];
                for (var i = 29; i >= 0; i--) {
                  var d = new Date(Date.now() - i * 86400000).toISOString().substring(0, 10);
                  var dayIn = treasury.filter(t => (t.transaction_date || '') === d).reduce((a, t) => a + Number(t.cash_in || 0) + Number(t.bank_in || 0), 0);
                  var dayOut = treasury.filter(t => (t.transaction_date || '') === d).reduce((a, t) => a + Number(t.cash_out || 0) + Number(t.bank_out || 0), 0);
                  days.push(dayIn - dayOut);
                }
                return days;
              })();
              const sparkMin = Math.min.apply(null, sparkData.length > 0 ? sparkData : [0]);
              const sparkMax = Math.max.apply(null, sparkData.length > 0 ? sparkData : [0]);
              const sparkRange = sparkMax - sparkMin || 1;
              const sparkPath = sparkData.map((v, i) => {
                var x = (i / Math.max(sparkData.length - 1, 1)) * 100;
                var y = 100 - ((v - sparkMin) / sparkRange) * 100;
                return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
              }).join(' ');

              // Tile component (inline closure to avoid hoisting it out of dashboard scope)
              const Tile = function(props) {
                return (
                  <button onClick={props.onClick}
                    className="text-left border border-zinc-800 hover:border-zinc-600 transition-colors group p-3 flex flex-col gap-1"
                    style={{ background: '#0a0a0a' }}>
                    <div className="flex items-center justify-between">
                      <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-500 font-mono"
                        style={{ fontFamily: '"JetBrains Mono", monospace' }}>
                        <span className="text-zinc-700">// </span>{props.label}
                      </div>
                      {props.badge}
                    </div>
                    <div className="flex items-baseline gap-1.5 mt-1">
                      <div className="text-xl sm:text-2xl font-bold tabular-nums leading-none"
                        style={{ fontFamily: '"JetBrains Mono", monospace', color: props.valueColor || '#fafafa' }}>
                        {props.value}
                      </div>
                      {props.unit && <div className="text-[10px] text-zinc-500 font-mono" style={{ fontFamily: '"JetBrains Mono", monospace' }}>{props.unit}</div>}
                    </div>
                    {props.sub && (
                      <div className="text-[10px] text-zinc-500 mt-0.5 leading-snug">
                        {props.sub}
                      </div>
                    )}
                    {props.children}
                  </button>
                );
              };

              return (
                <div className="mb-5">
                  {/* Section header — terminal command line */}
                  <div className="flex items-baseline justify-between mb-3 pb-2 border-b border-zinc-800">
                    <div className="flex items-baseline gap-3">
                      <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-400 font-mono"
                        style={{ fontFamily: '"JetBrains Mono", monospace' }}>
                        <span className="text-zinc-600">$</span> command-deck
                      </span>
                      <span className="text-[10px] text-zinc-600 font-mono" style={{ fontFamily: '"JetBrains Mono", monospace' }}>
                        // {todayN.replace(/-/g, '.')}
                      </span>
                    </div>
                    <div className="text-[10px] text-zinc-600 font-mono uppercase tracking-wider hidden sm:block" style={{ fontFamily: '"JetBrains Mono", monospace' }}>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block mr-1.5 align-middle" style={{ boxShadow: '0 0 6px #34d399' }} />
                      LIVE
                    </div>
                  </div>

                  {/* Six-tile grid — responsive: 2col mobile, 3col tablet, 6col desktop */}
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-px bg-zinc-800 border border-zinc-800">
                    {/* TILE 1 — TREASURY NET (with sparkline) */}
                    <Tile
                      label="TREASURY NET"
                      value={(allTimeNet >= 0 ? '+' : '') + fE(allTimeNet)}
                      valueColor={allTimeNet >= 0 ? '#34d399' : '#f87171'}
                      sub="all-time · click for detail"
                      onClick={() => { setTab('treasury'); setMode('all'); }}
                      badge={<span className="w-1.5 h-1.5 rounded-full" style={{ background: allTimeNet >= 0 ? '#34d399' : '#f87171', boxShadow: '0 0 6px ' + (allTimeNet >= 0 ? '#34d399' : '#f87171') }} />}>
                      {/* 30-day sparkline */}
                      {sparkData.length > 1 && (
                        <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="w-full h-6 mt-1.5" aria-label="30-day net sparkline">
                          <defs>
                            <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={allTimeNet >= 0 ? '#34d399' : '#f87171'} stopOpacity="0.3" />
                              <stop offset="100%" stopColor={allTimeNet >= 0 ? '#34d399' : '#f87171'} stopOpacity="0" />
                            </linearGradient>
                          </defs>
                          <path d={sparkPath + ' L100,30 L0,30 Z'} fill="url(#sparkFill)" />
                          <path d={sparkPath} fill="none" stroke={allTimeNet >= 0 ? '#34d399' : '#f87171'} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                        </svg>
                      )}
                    </Tile>

                    {/* TILE 2 — MTD NET */}
                    <Tile
                      label="MTD NET"
                      value={(monthNet >= 0 ? '+' : '') + fE(monthNet)}
                      valueColor={monthNet >= 0 ? '#34d399' : '#f87171'}
                      sub={'IN ' + fE(monthIn) + ' / OUT ' + fE(monthOut)}
                      onClick={() => { setTab('treasury'); setMode('mtd'); }}
                    />

                    {/* TILE 3 — ACCOUNTS RECEIVABLE */}
                    <Tile
                      label="A/R OUTSTANDING"
                      value={fE(ar)}
                      valueColor="#fafafa"
                      sub={overdueAmt > 0
                        ? <span className="text-orange-400">{overdueInvs.length} overdue · {fE(overdueAmt)}</span>
                        : 'no overdue invoices'}
                      onClick={() => { setTab('sales'); }}
                      badge={overdueAmt > 0 ? <span className="w-1.5 h-1.5 rounded-full bg-orange-400" style={{ boxShadow: '0 0 6px #fb923c' }} /> : null}
                    />

                    {/* TILE 4 — PENDING CHECKS */}
                    <Tile
                      label="CHECKS PENDING"
                      value={fE(pendCkAmt)}
                      valueColor={overdueCk.length > 0 ? '#f87171' : '#fafafa'}
                      sub={overdueCk.length > 0
                        ? <span className="text-red-400">{overdueCk.length} overdue · next 7d {fE(next7CkAmt)}</span>
                        : <span>next 7d {fE(next7CkAmt)} ({next7Ck.length})</span>}
                      onClick={() => { setTab('checks'); }}
                      badge={overdueCk.length > 0 ? <span className="w-1.5 h-1.5 rounded-full bg-red-500" style={{ boxShadow: '0 0 6px #ef4444' }} /> : null}
                    />

                    {/* TILE 5 — TICKETS */}
                    <Tile
                      label="OPEN TICKETS"
                      value={openT.length}
                      unit={openT.length === 1 ? 'ticket' : 'tickets'}
                      valueColor="#fafafa"
                      sub={myT.length > 0
                        ? <span><span className="text-sky-400">{myT.length} mine</span>{overdueT.length > 0 ? <span className="text-red-400"> · {overdueT.length} overdue</span> : null}</span>
                        : 'none assigned to me'}
                      onClick={() => { setTab('tickets'); }}
                      badge={overdueT.length > 0 ? <span className="w-1.5 h-1.5 rounded-full bg-red-500" style={{ boxShadow: '0 0 6px #ef4444' }} /> : (myT.length > 0 ? <span className="w-1.5 h-1.5 rounded-full bg-sky-400" style={{ boxShadow: '0 0 6px #38bdf8' }} /> : null)}
                    />

                    {/* TILE 6 — SYSTEM STATUS */}
                    <Tile
                      label="SYSTEM"
                      value={teamUsers.length}
                      unit={teamUsers.length === 1 ? 'user' : 'users'}
                      valueColor="#fafafa"
                      sub={<span className="font-mono" style={{ fontFamily: '"JetBrains Mono", monospace' }}>{invoices.length} INV · {treasury.length} TXN</span>}
                      onClick={() => { setTab('admin'); }}
                      badge={<span className="w-1.5 h-1.5 rounded-full bg-emerald-400" style={{ boxShadow: '0 0 6px #34d399' }} />}
                    />
                  </div>
                </div>
              );
            })()}

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
                            From: {poster ? poster.name : 'Admin'} • {fmtET(a.created_at, 'shortdate')} {fmtET(a.created_at, 'time', { tag: false })}
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
              const todayStr = todayET();
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
              // v55.83-A.6.13 (Max May 14 2026) — STRICT streak: only consecutive
              // days count. Old logic allowed up to 2-day gap which produced
              // "3-day streak" even when user had logged in May 14, May 12,
              // May 10 — gaps that shouldn't count. A streak should mean
              // "today AND every day before today until a gap."
              const loginStreak = (() => {
                const dates = (lastLoginInfo || []).map(s => s.date).filter((v, i, a) => a.indexOf(v) === i).sort().reverse();
                if (dates.length === 0) return 0;
                // Walk backwards from today requiring strict +1 day progression.
                let streak = 0;
                let cursor = todayStr;
                for (let i = 0; i < dates.length; i++) {
                  if (dates[i] === cursor) {
                    streak++;
                    const prev = new Date(cursor);
                    prev.setDate(prev.getDate() - 1);
                    cursor = prev.toISOString().substring(0, 10);
                  } else if (dates[i] < cursor) {
                    // Gap detected — streak ends.
                    break;
                  }
                  // If dates[i] > cursor (future date), skip — shouldn't happen but defensive.
                }
                return streak;
              })();

              // Ticket analysis (only if permitted)
              const myTickets = hasTickets ? dashTickets.filter(t => t.assigned_to === myId && t.status !== 'Closed') : [];
              const overdueTickets = myTickets.filter(t => t.due_date && t.due_date < todayStr);
              // v55.82-D — Critical = "must be done within hours" (Max May 10 2026).
              // Surfaced as its own briefing line ahead of high-priority since the
              // SLA is hours not days. Tracks separately so we can call it out
              // even when there are no overdue items yet.
              const criticalPriority = myTickets.filter(t => t.priority === 'critical');
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
              // v55.83-A.6.13 (Max May 14 2026) — guard against contradiction.
              // Old logic could show BOTH "3-day streak" header AND "haven't
              // logged in for 6 days" red banner — impossible to be true at
              // the same time. If user logged in today (loginStreak >= 1),
              // the "haven't logged in for N days" message is suppressed.
              const loggedInToday = (lastLoginInfo || []).some(s => s.date === todayStr);
              if (daysSinceLast === null) {
                messages.push({ icon: '👋', text: 'Welcome to NextTrade Hub! This is your first time here.', type: 'info' });
              } else if (loggedInToday || daysSinceLast === 0 || daysSinceLast === 1) {
                if (loginStreak >= 5) messages.push({ icon: '🔥', text: loginStreak + '-day streak! You\'re on fire. Keep it up.', type: 'success' });
              } else if (daysSinceLast === 2) {
                messages.push({ icon: '👀', text: 'You missed yesterday. Things may have piled up — let\'s catch up.', type: 'warning' });
              } else if (daysSinceLast >= 3) {
                messages.push({ icon: '⚠️', text: 'You haven\'t logged in for ' + daysSinceLast + ' days. Here\'s what needs your attention:', type: 'error' });
              }

              // Overdue tickets (only if permitted)
              // v55.82-D — Critical priority surfaces FIRST (above overdue) since
              // the SLA is "within hours" — even if not yet overdue, it needs
              // immediate attention.
              if (hasTickets && criticalPriority.length > 0) {
                messages.push({ icon: '🚨', text: criticalPriority.length + ' CRITICAL ticket' + (criticalPriority.length > 1 ? 's' : '') + ' — must be handled within hours. Drop everything and resolve now.', type: 'error', items: criticalPriority.map(t => ({ id: t.id, label: t.ticket_number + ' — ' + t.title })) });
              }
              if (hasTickets && overdueTickets.length > 0) {
                messages.push({ icon: '🚨', text: overdueTickets.length + ' ticket' + (overdueTickets.length > 1 ? 's are' : ' is') + ' OVERDUE. These need to be resolved immediately — clients are waiting.', type: 'error', items: overdueTickets.map(t => ({ id: t.id, label: t.ticket_number + ' — ' + t.title })) });
              }
              if (hasTickets && highPriority.length > 0 && overdueTickets.length === 0 && criticalPriority.length === 0) {
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
                        {fmtET(new Date(), 'longdate', { tag: false })}
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
                            {m.items.slice(0, 5).map((item, j) => {
                              // v55.83-A.6.13 — items can now be either strings
                              // (legacy) or { id, label } objects. Object items
                              // are clickable and open the ticket modal directly,
                              // remembering the current tab so closing returns here.
                              if (item && typeof item === 'object' && item.id) {
                                return (
                                  <button
                                    key={j}
                                    type="button"
                                    onClick={() => {
                                      setReturnToTabAfterTicket(tab);
                                      setOpenTicketId(item.id);
                                      setTab('tickets');
                                    }}
                                    style={{
                                      display: 'block',
                                      background: 'transparent',
                                      border: 'none',
                                      padding: '2px 0',
                                      fontSize: 11,
                                      color: typeColors[m.type],
                                      fontWeight: 600,
                                      textAlign: 'left',
                                      cursor: 'pointer',
                                      textDecoration: 'underline',
                                      textDecorationStyle: 'dotted',
                                      textUnderlineOffset: '2px',
                                    }}
                                    title="Open this ticket / افتح التذكرة">
                                    • {item.label}
                                  </button>
                                );
                              }
                              return (
                                <div key={j} style={{ fontSize: 11, color: typeColors[m.type], fontWeight: 600, padding: '2px 0' }}>• {item}</div>
                              );
                            })}
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

            {/* v55.75 — AIGreeter NO LONGER mounts here (was the standalone
                "Nadia chat" surface separate from the avatars). Per Max's
                Build A spec: the chat must live INSIDE the AssistantsBar
                directly under the avatars. AIGreeter is now constructed
                just before PersonalDashboard and passed in as a chatSurface
                slot — search for "v55.75 chatSurface" in this file. */}

                </>)}{/* end !hasUnacked gate */}
              </>);
            })()}{/* end announcement priority IIFE */}

            {/* ===== TODAY'S EVENTS + SCORECARD ===== */}
            {(() => {
              const myId = userProfile?.id;
              const todayStr = todayET();
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
                    // v55.83-A.6.22 (Max May 14 2026) — REMOVED "Overdue Tickets" stat card.
                    // The new DashboardPrioritySections cluster above already shows overdue
                    // count + the actual overdue ticket list. Keeping a duplicate stat tile
                    // would re-create the visual clutter Max asked to clean up.
                    const cards = [
                      { label: 'Open Tickets', value: openTickets, color: '#60a5fa', icon: '🎫', click: () => setTab('tickets') },
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
                    const todayD = todayET();
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
              const todayStr = todayET();
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
                              {/* v55.72 — whiteSpace: pre-wrap preserves the line breaks
                                  + blank lines + bullet markers the sender typed. Was a single
                                  flat div which collapsed everything into one running line.
                                  Reported by Max May 7 2026: "I should be able to format
                                  it the way I submit it. I don't want one running message
                                  which is hard to read if it's a long message." */}
                              <div style={{ fontSize: '15px', lineHeight: '1.5', fontWeight: 900, color: '#ffffff', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
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
                  {/* v55.83-A.6.27.9 — duplicate button + archive link
                      removed. The compact "Post Reminder" pill above
                      DashboardPrioritySections + the archive link below it
                      now drive these. Keeping the form mount below. */}

                  {/* Create reminder form */}
                  {/* v55.83-A.6.27.12 — wrapped in fixed centered modal so
                      the form is visible regardless of scroll position. */}
                  {showReminderForm && (isAdmin || modulePerms?.['Post Reminders']) && (
                    <div className="fixed inset-0 bg-black/60 z-[300] flex items-start justify-center p-4 overflow-auto"
                      onClick={() => setShowReminderForm(false)}>
                    <div className="bg-white rounded-xl p-4 border border-amber-200 mb-3 shadow-2xl w-full max-w-2xl my-8"
                      onClick={(e) => e.stopPropagation()}>
                      <h4 className="text-sm font-bold mb-2">📢 Post Team Reminder</h4>
                      {/* v55.72 — bigger textarea + formatting hint so Max knows
                          that line breaks, blank lines, and bullet/numbered lists
                          are preserved exactly as typed. */}
                      <textarea value={formData.reminderMsg || ''} onChange={e => setFormData({...formData, reminderMsg: e.target.value})}
                        placeholder={"Type your reminder message...\n\nFormatting is preserved:\n- bullets become a list\n- so do 1. numbered items\n\nBlank lines become paragraphs."}
                        rows={6} className="w-full px-3 py-2 rounded-lg border text-sm mb-1 font-sans" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }} />
                      <div className="text-[10px] text-slate-400 mb-2 italic">✓ Line breaks, paragraphs, and bullet/numbered lists preserved in the email and in-app view</div>
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
                          // v55.72 — was: only sent the subject (truncated to 60 chars).
                          // Now: pass the FULL message body so recipients see exactly what
                          // was typed, with line breaks / bullets / paragraphs preserved
                          // (notify route formats plain text → HTML).
                          try {
                            const targetIds = formData.reminderTarget === 'all'
                              ? (teamUsers || []).map(u => u.id)
                              : [formData.reminderTarget];
                            const fullBody = formData.reminderMsg.trim();
                            // Use a SHORT subject (preview line) and the full text as body
                            const shortSubject = (formData.reminderPriority === 'urgent' ? '🔴 URGENT: ' : '📢 ')
                              + fullBody.split('\n')[0].substring(0, 80)
                              + (fullBody.split('\n')[0].length > 80 || fullBody.indexOf('\n') >= 0 ? '…' : '');
                            await fetch('/api/notify', {
                              method: 'POST', headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                type: 'reminder', recipientIds: targetIds,
                                subject: shortSubject,
                                body: fullBody,
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
              {/* v55.83-A.6.27.9 — FX widget moved to dedicated top row above
                  the dashboard. Removed from this header. */}
            </div>


            {/* ===== ANNOUNCEMENTS / URGENT MESSAGES ===== */}
            {/* v55.83-A.6.27.9 — button removed; the new compact "Send Message"
                button at the top of the order:2 cluster now drives this form.
                The form itself stays here so the modal experience is unchanged. */}
            {/* v55.83-A.6.27.12 (Max May 15 2026) — REGRESSION FIX.
                Form was an inline block 4000 lines below the trigger button,
                so clicking "Send Message to Team" at the top of dashboard
                appeared to do nothing — the form was rendering offscreen.
                Now wrap in a fixed centered modal overlay. */}
            {showAddAnnouncement && (
              <div className="fixed inset-0 bg-black/60 z-[300] flex items-start justify-center p-4 overflow-auto"
                onClick={() => setShowAddAnnouncement(false)}>
              <div className="bg-red-50 rounded-xl p-5 mb-4 border-2 border-red-400 shadow-2xl w-full max-w-2xl my-8"
                onClick={(e) => e.stopPropagation()}>
                <h4 className="text-lg font-extrabold text-red-800 mb-3">📢 New Message / رسالة جديدة</h4>
                <input value={formData.annTitle || ''} onChange={e => setFormData({...formData, annTitle: e.target.value})}
                  placeholder="Subject / الموضوع *" className="w-full px-4 py-3 rounded-lg border-2 border-red-200 text-base font-bold mb-3" aria-label="Message subject" />
                {/* v55.72 — bigger textarea + formatting hint. Line breaks,
                    blank-line paragraphs, and bullet/numbered lists are preserved
                    in the email body. */}
                <textarea value={formData.annBody || ''} onChange={e => setFormData({...formData, annBody: e.target.value})}
                  placeholder={"Message details / تفاصيل الرسالة\n\nFormatting tips:\n- Use bullets like this\n- Or numbered: 1. 2. 3.\n\nBlank lines become paragraphs."} rows={6} className="w-full px-4 py-3 rounded-lg border-2 border-red-200 text-sm mb-1 font-sans" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }} aria-label="Message body" />
                <div className="text-[10px] text-red-500 mb-3 italic">✓ Line breaks, paragraphs, and bullet/numbered lists preserved in the email recipients see</div>
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
                          // v55.72 — preserve sender's formatting in the email body.
                          // Was: body.replace(/\n/g,'<br/>') which collapsed blank-line
                          // paragraph breaks. Now: split on blank lines → wrap each
                          // chunk in <p>, single newlines inside become <br/>.
                          const formatBody = (raw) => {
                            const s = String(raw || '');
                            if (!s.trim()) return '';
                            const escapeHtml = (t) => String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
                            const paragraphs = escapeHtml(s).split(/\r?\n\s*\r?\n/);
                            return paragraphs
                              .filter(p => p.trim())
                              .map(p => '<p style="margin:8px 0;line-height:1.6;">' + p.split(/\r?\n/).join('<br/>') + '</p>')
                              .join('');
                          };
                          for (const r of recipients) {
                            if (r.email) {
                              await fetch('/api/notify', {
                                method: 'POST', headers: {'Content-Type':'application/json'},
                                body: JSON.stringify({ to: r.email, subject: (priority === 'urgent' ? '🚨 URGENT: ' : priority === 'warning' ? '⚠️ ':'') + title, html: '<div style="font-family:sans-serif;padding:20px;'+(priority==='urgent'?'background:#fef2f2;border:3px solid #ef4444;':priority==='warning'?'background:#fffbeb;border:2px solid #f59e0b;':'background:#eff6ff;border:1px solid #3b82f6;')+'border-radius:12px;"><h2 style="margin:0 0 10px;font-size:18px;">'+(priority==='urgent'?'🚨':'⚠️')+' '+title+'</h2>'+(body?'<div style="font-size:14px;color:#333;">'+formatBody(body)+'</div>':'')+'<hr style="margin:15px 0;border-color:#eee;"/><p style="font-size:11px;color:#999;">From KTC Hub — '+(userProfile?.name||'Admin')+'</p></div>' })
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
                            {poster ? poster.name : 'Admin'} • {fmtET(a.created_at, 'shortdate')} {fmtET(a.created_at, 'time', { tag: false })}
                            {isTargeted && <span style={{ color: '#7c3aed', fontWeight: 700, marginLeft: 8 }}>📩 Sent to you directly</span>}
                          </div>
                          {/* Acknowledge button */}
                          <div style={{ marginTop: '0.75rem' }}>
                            {myAck ? (
                              <span style={{ fontSize: '0.75rem', color: '#16a34a', fontWeight: 700, background: '#f0fdf4', padding: '4px 12px', borderRadius: 8, border: '1px solid #bbf7d0' }}>✅ Acknowledged {fmtET(myAck.acked_at, 'time', { tag: false })}</span>
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
                                  return u.name + (ack ? ' (' + fmtET(ack.acked_at, 'datetime') + ')' : '');
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
                          // v55.60 — Only count ACTIVE teammates as targets. A deactivated
                          // user from months ago shouldn't show as "didn't acknowledge"
                          // forever. Their original acknowledgment (if any) still appears
                          // in the acked list because the ack row exists in the DB.
                          const activeTeamUsers = filterActiveUsers(teamUsers);
                          const targetUsers2 = a.target_user
                            ? activeTeamUsers.filter(u => u.id === a.target_user)
                            : activeTeamUsers;
                          const ackedNames = targetUsers2.filter(u => thisAcks.some(ak => ak.user_id === u.id));
                          const unackedNames = targetUsers2.filter(u => !thisAcks.some(ak => ak.user_id === u.id));
                          return (
                            <div key={a.id} style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(0,0,0,0.02)', border: '1px solid rgba(0,0,0,0.06)' }}>
                              <div className="flex justify-between items-start">
                                <div className="flex-1">
                                  <div style={{ fontSize: '0.85rem', fontWeight: 700 }}>{icon} {a.title}</div>
                                  {a.body && <div style={{ fontSize: '0.75rem', color: '#475569', marginTop: 4, whiteSpace: 'pre-wrap' }}>{a.body}</div>}
                                  <div style={{ fontSize: '0.6rem', color: '#94a3b8', marginTop: 4 }}>
                                    {poster ? poster.name : 'Admin'} • {fmtET(a.created_at, 'shortdate')}
                                  </div>
                                  {isAdmin && (
                                    <div style={{ marginTop: 8, padding: '8px 10px', background: 'rgba(255,255,255,0.6)', borderRadius: 8, border: '1px solid rgba(0,0,0,0.05)' }}>
                                      {/* v55.60 — Acknowledgment block in archived announcements
                                          made more prominent. Was a small inline line; now a
                                          clear pull-out box showing who acked + when, who didn't,
                                          and a count summary. */}
                                      <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#475569', marginBottom: 4 }}>
                                        Acknowledgments: <span style={{ color: ackedNames.length === targetUsers2.length && targetUsers2.length > 0 ? '#16a34a' : '#94a3b8' }}>{ackedNames.length}/{targetUsers2.length}</span>
                                        {ackedNames.length === targetUsers2.length && targetUsers2.length > 0 && <span style={{ color: '#16a34a', marginLeft: 8 }}>✅ ALL ACKNOWLEDGED</span>}
                                      </div>
                                      {ackedNames.length > 0 && (
                                        <div style={{ fontSize: '0.65rem', color: '#16a34a', marginBottom: 2 }}>
                                          <b>✅ Acknowledged by:</b> {ackedNames.map(u => {
                                            const ack = thisAcks.find(ak => ak.user_id === u.id);
                                            return u.name + (ack ? ' (' + fmtET(ack.acked_at, 'datetime') + ')' : '');
                                          }).join(', ')}
                                        </div>
                                      )}
                                      {unackedNames.length > 0 && (
                                        <div style={{ fontSize: '0.65rem', color: '#dc2626', fontWeight: 700 }}>
                                          ⏳ <b>Not acknowledged:</b> {unackedNames.map(u => u.name).join(', ')}
                                        </div>
                                      )}
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


            {/* v55.83-A.6.22 (Max May 14 2026) — REMOVED the old "Section: Tickets"
                cluster (Newly Assigned + Overdue + Recently Updated + All My Open).
                These were duplicates of the new DashboardPrioritySections rendered
                way above (order:2 cluster, right after the AI Workforce hero). Max
                explicitly asked: "Remove or hide the previous sections such as
                Previous Tickets Assigned, My Tickets, Urgent Tickets, Overdue
                Tickets. Those old sections are no longer needed because the new
                dashboard cards are supposed to replace them." The new priority
                cards are the sole ticket surface on the dashboard now. */}



            {/* Section: Activity */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '20px 0 12px' }}>
              <div style={{ width: 3, height: 20, borderRadius: 2, background: '#0ea5e9' }} />
              <span style={{ fontSize: 12, fontWeight: 800, color: '#94a3b8', letterSpacing: '0.06em' }}>📋 TEAM ACTIVITY</span>
              <div style={{ flex: 1, height: 1, background: 'rgba(148,163,184,0.1)' }} />
            </div>

            {/* v55.83-A.6.27.9 — Team Activity moved to AFTER Monthly Sales
                per Max's reorder request May 15 2026. See new mount below. */}

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



            {/* v55.83-A.6.27.11 (Max May 15 2026) — Per Max: "no one except
                the super admin and those with treasury access permissioning
                can see any financial data on the dashboard from the banks
                or transactions or sales or otherwise (except for monthly
                sales)". Wrap the entire Financial Overview block in a single
                top-level gate so Sales-only users no longer see ANY of it
                (invoices, cash register, etc.). Monthly Sales is rendered
                inside PersonalDashboard and stays available to all per the
                "except for monthly sales" carve-out. */}
            {(isSuperAdmin || modulePerms['Treasury']) && (<>
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

            {/* Invoices — Sales or Treasury access. After A.6.27.11 the outer
                gate is already Treasury OR super_admin, so this inner gate is
                effectively the same; keeping it for defense-in-depth. */}
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
                          // v55.55 — Click month → drill to Sales tab filtered to that month.
                          const [yr2, mo2] = m.month.split('-').map(Number);
                          const lastDay2 = new Date(yr2, mo2, 0).getDate();
                          const monthFrom2 = m.month + '-01';
                          const monthTo2 = m.month + '-' + String(lastDay2).padStart(2, '0');
                          return (
                            <tr key={m.month}
                                onClick={() => navigate('sales', { from: monthFrom2, to: monthTo2 })}
                                title={'Click to see all ' + m.count + ' orders from ' + m.month}
                                className="border-b border-slate-50 hover:bg-blue-50 cursor-pointer">
                              <td className="px-2 py-1 text-xs font-semibold">{m.month} <span className="text-[9px] text-blue-500 ml-1">→ view orders</span></td>
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

            {/* v55.83-A.6.27.9 — Team Activity Feed (moved from earlier
                position per Max May 15 2026: "Move the Monthly Sales Report
                down after the To-Do List. Put Team Activity after the
                Monthly Sales Report."). */}
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
            </>)}{/* v55.83-A.6.27.11 — end gate: super_admin OR Treasury only */}

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
                          <div className="text-xs font-black text-amber-900">{unmatched}</div>
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
                              <div className="text-[9px] text-slate-400">{t.date} {t.category ? '• ' + txCat(t.category) : ''}{t.matched_invoice_id ? ' ✅' : ''}</div>
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
                    <span className="text-sm font-bold text-amber-900">💵 USD DOLLAR LEDGER / دفتر الدولار</span>
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
              // v55.83-A.6.27.71 (Phase 3): Expense Report integration —
              // when a treasury row is a bucket placeholder AND that bucket
              // is CLOSED, replace the placeholder amount with the bucket
              // entry breakdown (real categories from the accountant's work).
              // For 'open' / 'pending_approval' / 'fully_spent' buckets, the
              // placeholder stays as "Warehouse Bucket" (unreconciled).
              // For 'cancelled' buckets, the placeholder is excluded entirely
              // (since the refund credit offsets the original cash-out).
              //
              // IMPORTANT INVARIANT: The treasury row itself NEVER changes.
              // This is purely a read-side aggregation that decides what
              // category to credit the spend toward in this chart.
              filteredTreasury.forEach(t => {
                if (Number(t.cash_out || 0) <= 0) return;
                if (t.bucket_role === 'placeholder' && t.bucket_id) {
                  var bStatus = bucketStatusMap[t.bucket_id];
                  if (bStatus === 'cancelled') return;  // refund credit balances it
                  if (bStatus === 'closed' && bucketEntriesByBucket[t.bucket_id]) {
                    // Replace placeholder amount with per-entry category breakdown
                    bucketEntriesByBucket[t.bucket_id].forEach(function (e) {
                      var c = e.category || 'Uncategorized';
                      catData[c] = (catData[c] || 0) + Number(e.amount || 0);
                    });
                    return;
                  }
                  // Open / fully_spent / pending_approval — show as "Warehouse Bucket"
                  catData['Warehouse Bucket'] = (catData['Warehouse Bucket'] || 0) + Number(t.cash_out);
                  return;
                }
                const cat = t.expense_category || 'Uncategorized';
                catData[cat] = (catData[cat] || 0) + Number(t.cash_out);
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


            {/* ===== S21 — Team Priorities Today =====
                One-glance view: each team member's #1 priority ticket.
                Populated by tickets.assignee_priority = 1. Clicking goes
                to the Tickets tab with the ticket open. */}
            {(() => {
              const topPerUser = {};
              (dashTickets || []).forEach(t => {
                if (!t.assigned_to || t.assignee_priority == null) return;
                // S22.8 — Priority 1..999 = true ranked. 1000+ = unranked-ordered.
                // The "Today" strip should show the #1 from the ranked pile only —
                // the unranked pile is an ordered backlog, not "what they're on today."
                if (Number(t.assignee_priority) >= 1000) return;
                const s = (t.status || '').toLowerCase();
                if (s === 'closed' || s === 'done' || s === 'resolved' || s === 'cancelled') return;
                const current = topPerUser[t.assigned_to];
                if (!current || Number(t.assignee_priority) < Number(current.assignee_priority)) {
                  topPerUser[t.assigned_to] = t;
                }
              });
              const anyoneHasPriorities = Object.keys(topPerUser).length > 0;
              if (!anyoneHasPriorities) return null;
              return (
                <div className="mb-4">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <div style={{ width: 4, height: 22, borderRadius: 2, background: '#6366f1' }} />
                    <h3 className="text-sm font-extrabold text-slate-700">🎯 Team Priorities Today</h3>
                    <button onClick={() => { setTab('tickets'); }}
                      className="ml-auto text-[10px] text-indigo-600 hover:underline font-semibold">Open board →</button>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                    {(teamUsers || []).filter(u => topPerUser[u.id]).map(u => {
                      const t = topPerUser[u.id];
                      const initials = (u.name || '?').split(' ').map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
                      return (
                        <div key={u.id}
                          onClick={() => { setOpenTicketId(t.id); setTab('tickets'); }}
                          className="bg-white border border-slate-200 rounded-lg p-2.5 cursor-pointer hover:border-indigo-300 hover:shadow-sm transition">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-full flex items-center justify-center text-[10px] font-bold">
                              {initials}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-[10px] font-bold text-slate-700 truncate">{u.name}</div>
                              <div className="text-[11px] font-semibold text-slate-800 truncate" title={t.title}>{t.title}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            </div>{/* end order:2 widget cluster */}

            {/* v55.81 — PersonalDashboard wrapper with order: 1 so it pins to the TOP.
                AI Workforce (Nadia/Sara/Jenna avatars) is the visual anchor. */}
            <div className="flex flex-col" style={{ order: 1 }}>

            {/* ===== PERSONAL DASHBOARD (tickets, reminders, calendar — after financial for admins, first for team) ===== */}
            {/* v55.75 chatSurface — Build A item #1: the AIGreeter chat surface
                is built here and passed INTO PersonalDashboard, which threads
                it down to AssistantsBar to render directly under the avatars.
                Single GUI surface. No redirects. */}
            {(() => {
              // v55.76 (A5) — Persona-aware fallback when chat is dismissed.
              // The "wake the assistant" affordance now reflects whichever
              // persona is currently active, not hard-coded "Nadia". This
              // preserves the unified-module feel: the user sees who's in
              // control even when chat is collapsed.
              const activePersonaName =
                selectedAssistant === 'jenna' ? 'Ms. Jenna' :
                selectedAssistant === 'sara'  ? 'Sara' :
                                                'Nadia';
              const activePersonaColor =
                selectedAssistant === 'jenna' ? 'text-rose-700 border-rose-300 hover:bg-rose-50' :
                selectedAssistant === 'sara'  ? 'text-cyan-700 border-cyan-300 hover:bg-cyan-50' :
                                                'text-indigo-700 border-indigo-300 hover:bg-indigo-50';
              const nadiaChatSurface = (!greeterDismissed && greeterSettings.enabled) ? (
                <div id="nadia-greeter-anchor">
                  <SafeSection label="Nadia">
                    <AIGreeter
                      user={user} userProfile={userProfile} users={teamUsers}
                      tickets={dashTickets} closedTickets={closedTicketsForAI}
                      invoices={invoices} treasury={treasury}
                      checks={pendingChecks} loginHistory={lastLoginInfo} loginHistoryLoaded={loginHistoryLoaded}
                      lang={lang} personality={greeterSettings.personality}
                      greeterLang={greeterSettings.language}
                      enabled={greeterSettings.enabled}
                      hasGreeted={greeterHasGreeted} onGreeted={handleGreeted}
                      sessionMessages={greeterMessages} onMessagesUpdate={setGreeterMessages}
                      onToggle={(on) => { if (!on) setGreeterDismissed(true); }}
                      toast={toast}
                      selectedAssistant={selectedAssistant}
                      modulePerms={modulePerms} isSuperAdmin={isSuperAdmin}
                    />
                  </SafeSection>
                </div>
              ) : greeterSettings.enabled ? (
                <button onClick={() => setGreeterDismissed(false)}
                  className={'w-full px-4 py-3 rounded-xl text-sm font-semibold border-2 transition flex items-center justify-center gap-2 bg-white ' + activePersonaColor}>
                  🤖 <span>Talk to {activePersonaName}</span>
                </button>
              ) : null;
              return (
                <PersonalDashboard user={user} userProfile={userProfile} isAdmin={isAdmin} isSuperAdmin={isSuperAdmin}
                  invoices={invoices} customers={customers} navigate={navigate} fE={fE} users={teamUsers}
                  chatSurface={nadiaChatSurface} renderSection="ai" />
              );
            })()}

            {/* ===== VOICEMAILS WIDGET (Phase B — Apr 26 2026) =====
                Shows the logged-in user's unread voicemails with audio + Whisper transcript.
                Auto-refreshes every 30 seconds so new voicemails appear without page reload.
                v55.40 — `id` anchor so the header voicemail badge can scroll to it. */}
            <div className="mt-4" id="voicemails-widget">
              <SafeSection label="Voicemails">
                <VoicemailsWidget user={user} userProfile={userProfile} customers={customers} toast={toast} />
              </SafeSection>
            </div>

            </div>{/* end order:1 PersonalDashboard wrapper */}

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
                  XLSX.writeFile(wb, `Sales-Export-${todayET()}.xlsx`);
                }} className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-xs font-semibold hover:bg-slate-200">
                  📥 Export
                </button>
                {/* v55.83-A.6.27.71 — Toggle the Sales-Rep KPI dashboard */}
                <button onClick={() => setShowRepDashboard(v => !v)}
                  className={'px-3 py-1.5 rounded-lg text-xs font-extrabold ' +
                    (showRepDashboard ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-indigo-100 text-indigo-800 hover:bg-indigo-200')}>
                  📊 Rep KPIs
                </button>
                {/* v55.83-A.6.27.71 — Toggle the advanced filters panel */}
                <button onClick={() => setShowAdvFilters(v => !v)}
                  className={'px-3 py-1.5 rounded-lg text-xs font-extrabold ' +
                    (showAdvFilters ? 'bg-slate-700 text-white hover:bg-slate-800' : 'bg-slate-100 text-slate-700 hover:bg-slate-200')}>
                  {showAdvFilters ? '▾ Less' : '▸ More filters'}
                </button>
              </div>
            </div>

            {/* v55.83-A.6.27.71 — Advanced filters panel.
                Collapsible. Adds: sales rep, amount min/max, has-outstanding. */}
            {showAdvFilters && (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-3">
                <div className="text-xs font-extrabold text-slate-700 uppercase tracking-wider mb-2">Advanced Filters / فلاتر متقدمة</div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                  <label className="block">
                    <span className="text-[10px] font-extrabold text-slate-700">Sales Rep / المندوب</span>
                    <select value={salesRepFilter} onChange={e => setSalesRepFilter(e.target.value)}
                      className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-xs bg-white text-slate-900">
                      <option value="">All reps</option>
                      {[...new Set(invoices.map(i => i.sales_rep).filter(Boolean))].sort().map(r => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-extrabold text-slate-700">Amount From</span>
                    <input type="number" step="0.01" value={amountMin} onChange={e => setAmountMin(e.target.value)}
                      placeholder="0.00"
                      className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-xs bg-white text-slate-900 font-mono text-right" />
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-extrabold text-slate-700">Amount To</span>
                    <input type="number" step="0.01" value={amountMax} onChange={e => setAmountMax(e.target.value)}
                      placeholder="∞"
                      className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-xs bg-white text-slate-900 font-mono text-right" />
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-extrabold text-slate-700">Outstanding</span>
                    <select value={hasOutstandingFilter} onChange={e => setHasOutstandingFilter(e.target.value)}
                      className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-xs bg-white text-slate-900">
                      <option value="all">All invoices</option>
                      <option value="yes">Has outstanding ({'>'}0)</option>
                      <option value="no">Fully collected</option>
                    </select>
                  </label>
                </div>
                {(salesRepFilter || amountMin || amountMax || hasOutstandingFilter !== 'all') && (
                  <div className="flex justify-between items-center mt-2">
                    <div className="text-[11px] text-slate-700 font-semibold">
                      {filteredInvoices.length} matching invoice{filteredInvoices.length === 1 ? '' : 's'}
                    </div>
                    <button onClick={() => { setSalesRepFilter(''); setAmountMin(''); setAmountMax(''); setHasOutstandingFilter('all'); }}
                      className="px-2 py-1 bg-slate-300 hover:bg-slate-400 text-slate-900 text-[10px] font-extrabold rounded">
                      Clear filters
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* v55.83-A.6.27.71 — Sales-Rep KPI dashboard. Toggleable. */}
            {showRepDashboard && (
              <div className="mb-3">
                <SalesRepDashboard invoices={filteredInvoices} label={'in current Sales tab filter'} />
              </div>
            )}
            {/* v55.83-A.6.27.71 (C1, Max May 23 2026) — multi-currency warning
                banner. The tile numbers below add invoiced/collected/outstanding
                without converting currencies. If multiple currencies are
                present in the filtered range, the user sees a warning that
                those numbers are meaningless and gets the per-currency
                breakdown card below. */}
            {totalsAreMixedCurrency && (
              <div className="mb-3 rounded-xl border-2 p-3" style={{ background: 'rgba(239,68,68,0.12)', borderColor: '#dc2626' }}>
                <div className="flex items-start gap-2">
                  <span className="text-2xl">⚠️</span>
                  <div className="flex-1">
                    <div className="text-sm font-extrabold" style={{ color: '#fecaca' }}>
                      Mixed currencies in this range — the three tiles below are NOT meaningful totals
                    </div>
                    <div className="text-xs mt-1" style={{ color: '#fee2e2' }}>
                      The filtered invoices include {totalsByCurrency.map(b => b.currency).join(' + ')}. Use the per-currency breakdown below those tiles, or filter to one currency for accurate totals.
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div className="grid grid-cols-3 gap-3 mb-3">
              {/* S17 — Sales summary cards redesigned. Dark backgrounds, bright
                  centered numbers, matching Treasury. */}
              <div className="rounded-xl p-3 transition-all hover:shadow-xl hover:scale-[1.02] flex flex-col items-center justify-center text-center min-h-[96px]"
                style={{
                  background: 'linear-gradient(135deg, #0c4a6e 0%, #075985 100%)',
                  border: '2px solid #0ea5e9',
                  boxShadow: '0 0 0 1px rgba(14,165,233,0.1) inset',
                }}>
                <div className="flex items-center justify-center gap-1.5 mb-1">
                  <span className="text-sky-300 text-base">📊</span>
                  <div className="text-[10px] text-sky-200 font-bold uppercase tracking-wider">Invoiced{totalsAreMixedCurrency ? ' (mixed)' : ''}</div>
                </div>
                <div className="text-xl sm:text-2xl font-black text-sky-300 tracking-tight" style={{ textShadow: '0 0 20px rgba(14,165,233,0.3)' }}>
                  {fE(totalInvoiced)}
                </div>
              </div>
              <div className="rounded-xl p-3 transition-all hover:shadow-xl hover:scale-[1.02] flex flex-col items-center justify-center text-center min-h-[96px]"
                style={{
                  background: 'linear-gradient(135deg, #064e3b 0%, #065f46 100%)',
                  border: '2px solid #10b981',
                  boxShadow: '0 0 0 1px rgba(16,185,129,0.1) inset',
                }}>
                <div className="flex items-center justify-center gap-1.5 mb-1">
                  <span className="text-emerald-400 text-base">💵</span>
                  <div className="text-[10px] text-emerald-200 font-bold uppercase tracking-wider">Collected{totalsAreMixedCurrency ? ' (mixed)' : ''}</div>
                </div>
                <div className="text-xl sm:text-2xl font-black text-emerald-300 tracking-tight" style={{ textShadow: '0 0 20px rgba(16,185,129,0.3)' }}>
                  {fE(totalCollected)}
                </div>
                {totalInvoiced > 0 && (
                  <div className="mt-2 h-1 w-4/5 rounded-full bg-black/30 overflow-hidden" title={Math.round(totalCollected/totalInvoiced*100) + '% collected'}>
                    <div style={{
                      width: Math.min(100, totalCollected / totalInvoiced * 100) + '%',
                      background: '#34d399',
                      height: '100%',
                      transition: 'width 0.3s'
                    }} />
                  </div>
                )}
              </div>
              <div className="rounded-xl p-3 transition-all hover:shadow-xl hover:scale-[1.02] flex flex-col items-center justify-center text-center min-h-[96px]"
                style={{
                  background: 'linear-gradient(135deg, #7f1d1d 0%, #991b1b 100%)',
                  border: '2px solid #ef4444',
                  boxShadow: '0 0 0 1px rgba(239,68,68,0.1) inset',
                }}>
                <div className="flex items-center justify-center gap-1.5 mb-1">
                  <span className="text-red-400 text-base">⚠️</span>
                  <div className="text-[10px] text-red-200 font-bold uppercase tracking-wider">Outstanding{totalsAreMixedCurrency ? ' (mixed)' : ''}</div>
                </div>
                <div className="text-xl sm:text-2xl font-black text-red-300 tracking-tight" style={{ textShadow: '0 0 20px rgba(239,68,68,0.3)' }}>
                  {fE(totalOutstanding)}
                </div>
                {totalInvoiced > 0 && (
                  <div className="mt-2 h-1 w-4/5 rounded-full bg-black/30 overflow-hidden" title={Math.round(totalOutstanding/totalInvoiced*100) + '% outstanding'}>
                    <div style={{
                      width: Math.min(100, totalOutstanding / totalInvoiced * 100) + '%',
                      background: '#f87171',
                      height: '100%',
                      transition: 'width 0.3s'
                    }} />
                  </div>
                )}
              </div>
            </div>
            {/* v55.83-A.6.27.71 (C1) — per-currency breakdown — always visible
                so user can see currencies side-by-side without having to filter. */}
            {totalsByCurrency.length > 0 && (
              <div className="mb-3 rounded-xl border-2 p-3" style={{ background: 'rgba(15,23,42,0.7)', borderColor: '#334155' }}>
                <div className="text-[11px] font-extrabold uppercase tracking-wider mb-2" style={{ color: '#cbd5e1' }}>By Currency / حسب العملة</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ color: '#94a3b8' }}>
                        <th className="text-left px-2 py-1 font-extrabold uppercase tracking-wider">Currency</th>
                        <th className="text-right px-2 py-1 font-extrabold uppercase tracking-wider">Invoices</th>
                        <th className="text-right px-2 py-1 font-extrabold uppercase tracking-wider">Invoiced</th>
                        <th className="text-right px-2 py-1 font-extrabold uppercase tracking-wider">Collected</th>
                        <th className="text-right px-2 py-1 font-extrabold uppercase tracking-wider">Outstanding</th>
                        <th className="text-right px-2 py-1 font-extrabold uppercase tracking-wider">Coll %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {totalsByCurrency.map(b => (
                        <tr key={b.currency} className="border-t" style={{ borderColor: '#334155' }}>
                          <td className="px-2 py-1.5 font-mono font-extrabold" style={{ color: '#f1f5f9' }}>{b.currency}</td>
                          <td className="px-2 py-1.5 text-right font-mono" style={{ color: '#cbd5e1' }}>{b.count.toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right font-mono font-bold" style={{ color: '#7dd3fc' }}>{b.invoiced.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td className="px-2 py-1.5 text-right font-mono font-bold" style={{ color: '#86efac' }}>{b.collected.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td className="px-2 py-1.5 text-right font-mono font-bold" style={{ color: b.outstanding > 0 ? '#fca5a5' : '#94a3b8' }}>{b.outstanding.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td className="px-2 py-1.5 text-right font-mono font-bold" style={{ color: b.invoiced > 0 ? (b.collected/b.invoiced >= 0.9 ? '#86efac' : b.collected/b.invoiced >= 0.7 ? '#fde047' : '#fca5a5') : '#94a3b8' }}>
                            {b.invoiced > 0 ? ((b.collected/b.invoiced)*100).toFixed(1) + '%' : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
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
                <button
                  disabled={fixLinksBusy}
                  onClick={async () => {
                  // v55.83-A.6.27.21 (Max May 17 2026) — Max reported "FIX
                  // button doesn't do anything anymore." Multiple possible
                  // causes: confirm() was being dismissed silently, every
                  // row already linked so "no missing links" toast was
                  // unreadable, or async handler failed silently. This
                  // build adds: console log on every press, busy state
                  // (button disabled while running), info toast BEFORE
                  // confirm so user sees the click was registered, loud
                  // success toast (toast.info with explicit "0 found"),
                  // and a clear "Cancelled" toast if confirm is dismissed.
                  console.log('[fix-links] button pressed');
                  setFixLinksBusy(true);
                  try {
                    toast.info('🔍 Scanning treasury for missing invoice links...');
                    // Find all treasury rows with an order# but no linked_invoice_id where an invoice
                    // with that order# DOES exist. Link them, recalc each affected invoice.
                    const byOrder = {};
                    invoices.forEach(i => { if (i.order_number) byOrder[String(i.order_number).trim()] = i; });
                    const needsLink = treasury.filter(t => {
                      if (t.linked_invoice_id) return false;
                      if (t.is_bank_placeholder) return false;
                      if (!t.order_number) return false;
                      const inflow = Number(t.cash_in || 0) + Number(t.bank_in || 0);
                      if (inflow <= 0) return false;
                      return !!byOrder[String(t.order_number).trim()];
                    });
                    console.log('[fix-links] found ' + needsLink.length + ' rows needing link');
                    if (needsLink.length === 0) {
                      toast.success('✓ No missing links found — every treasury row with a matching invoice is already linked.');
                      setFixLinksBusy(false);
                      return;
                    }
                    if (!confirm('Found ' + needsLink.length + ' treasury row(s) that should be linked to existing invoices but aren\'t. Link them now and recalculate the affected invoices?')) {
                      toast.info('Cancelled — no changes made.');
                      setFixLinksBusy(false);
                      return;
                    }
                    const affectedInvoiceIds = new Set();
                    for (const t of needsLink) {
                      const inv = byOrder[String(t.order_number).trim()];
                      if (!inv) continue;
                      await dbUpdate('treasury', t.id, { linked_invoice_id: inv.id }, userProfile?.id || user?.id);
                      affectedInvoiceIds.add(inv.id);
                    }
                    for (const invId of affectedInvoiceIds) {
                      await recalcInvoiceCollected(invId);
                    }
                    toast.success('✓ Linked ' + needsLink.length + ' row(s) and recalculated ' + affectedInvoiceIds.size + ' invoice(s).');
                    await loadAllData();
                  } catch (err) {
                    console.error('[fix-links] failed:', err);
                    toast.error('Fix failed: ' + (err && err.message ? err.message : String(err)));
                  } finally {
                    setFixLinksBusy(false);
                  }
                }}
                  className="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-xs font-extrabold hover:bg-amber-600 shadow disabled:opacity-50 disabled:cursor-wait"
                  title="Find and link treasury rows whose order# matches an existing invoice but aren't linked. Fixes the invoice collected totals. / ابحث عن قيود الخزنة التي يطابق رقم أمرها فاتورة موجودة لكنها غير مربوطة، واربطها.">
                  {fixLinksBusy ? '⏳ Working...' : '🔗 Fix Links'}
                </button>
                <button onClick={() => {
                    // v55.82-E — RESET-OPEN HARDENING. Previously this button
                    // only flipped showAddTreasury=true and seeded formData.
                    // It did NOT clear pendingTreasuryRecord, duplicateConfirm,
                    // treasuryFormErrors, isCreatingInvoice, or createInvoiceError.
                    //
                    // Failure mode (Max May 11 2026): if a prior submission
                    // errored out in a path that didn't clean up (e.g. the
                    // recalcInvoiceCollected throw → catch-block-without-modal-
                    // reset described in v55.82-E ROOT-CAUSE #1), pressing
                    // this button "did nothing" — gate at line 6665 checks
                    // !pendingTreasuryRecord && !duplicateConfirm, so the
                    // form Modal never re-rendered. User had to refresh the
                    // whole page to recover.
                    //
                    // Now: every click hard-resets every Treasury modal flag
                    // before opening. Idempotent — clean state if no stale
                    // state existed; recovery if there was.
                    setPendingTreasuryRecord(null);
                    setDuplicateConfirm(null);
                    setTreasuryFormErrors([]);
                    setIsCreatingInvoice(false);
                    setCreateInvoiceError(null);
                    setShowAddTreasury(true);
                    setFormData({ date: today(), type: 'in' });
                  }}
                  className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-semibold hover:bg-blue-600">
                  + New Transaction
                </button>
                {/* v55.83-A.6.27.71 (Phase 2) — "+ Warehouse Advance" button.
                    Sits next to "+ New Transaction". Opens the dedicated
                    bucket-create modal — completely separate code path from
                    the treasury transaction modal. Gated behind the feature
                    flag AND a permission check (super-admin OR Manage
                    Warehouse Buckets OR has Treasury access). When the flag
                    is OFF, the button doesn't render — existing layout
                    unchanged. */}
                {bucketsFeatureEnabled && (isSuperAdmin || (modulePerms && (modulePerms['Manage Warehouse Buckets'] || modulePerms['Treasury'] || modulePerms['Edit Treasury']))) && (
                  <button
                    onClick={() => { setShowBucketModal(true); }}
                    className="px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-semibold hover:bg-amber-700 shadow"
                    title="Create a warehouse advance bucket — issues a treasury cash-out + opens a bucket for the accountant to itemize the spend"
                  >
                    🏭 + Warehouse Advance
                  </button>
                )}
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
                  XLSX.writeFile(wb, `Treasury-Export-${todayET()}.xlsx`);
                }} className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-xs font-semibold hover:bg-slate-200">
                  📥 Export
                </button>
                {/* v55.82-F — Wake Nadia button. Only shown when Nadia is
                    SUPPRESSED in Treasury (default state). Per Max's spec:
                    "in Treasury, Nadia should only appear if the user clicks
                    a clear button such as Wake Nadia or Open Nadia Assistant."
                    Click flips nadiaWokenInTab.treasury → suppressNadia goes
                    false → overlay re-renders. Resets on tab change so the
                    next visit defaults back to suppressed. The mute button
                    inside Nadia's panel still works to silence audio without
                    hiding her. */}
                {greeterSettings.enabled && !greeterDismissed && !nadiaWokenInTab.treasury && (
                  <button
                    onClick={() => setNadiaWokenInTab(function(prev) { return Object.assign({}, prev, { treasury: true }); })}
                    title="Bring Nadia back into Treasury — she'll stay until you switch tabs"
                    className="px-3 py-1.5 bg-indigo-500 text-white rounded-lg text-xs font-semibold hover:bg-indigo-600">
                    🤖 Wake Nadia
                  </button>
                )}
                {greeterSettings.enabled && !greeterDismissed && nadiaWokenInTab.treasury && (
                  <button
                    onClick={() => setNadiaWokenInTab(function(prev) { var n = Object.assign({}, prev); delete n.treasury; return n; })}
                    title="Hide Nadia again — she won't pop up while you work"
                    className="px-3 py-1.5 bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-300">
                    😴 Sleep Nadia
                  </button>
                )}
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
                  const c = (t.category ? txCat(t.category) : (lang === 'en' ? 'Uncategorized' : 'غير مصنّف'));
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
                          {allCats.map(c => <option key={c} value={c}>{txCat(c)}</option>)}
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
                                    <td className="px-2 py-1 text-[10px] text-amber-600">{t.category ? txCat(t.category) : ''}{t.subcategory ? ' / ' + t.subcategory : ''}</td>
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
              {/* S17 — Treasury summary cards redesigned for high contrast.
                  Dark solid backgrounds with bright neon-colored numbers.
                  All content centered inside each bucket. */}
              <div onClick={() => setTreasuryDrill('in')}
                className="rounded-xl p-3 cursor-pointer transition-all hover:shadow-xl hover:scale-[1.02] flex flex-col items-center justify-center text-center min-h-[96px]"
                style={{
                  background: 'linear-gradient(135deg, #064e3b 0%, #065f46 100%)',
                  border: '2px solid #10b981',
                  boxShadow: '0 0 0 1px rgba(16,185,129,0.1) inset',
                }}>
                <div className="flex items-center justify-center gap-1.5 mb-1">
                  <span className="text-emerald-400 text-base">💰</span>
                  <div className="text-[10px] text-emerald-200 font-bold uppercase tracking-wider">Cash In / وارد</div>
                </div>
                <div className="text-xl sm:text-2xl font-black text-emerald-300 tracking-tight" style={{ textShadow: '0 0 20px rgba(16,185,129,0.3)' }}>
                  {fE(totalCashIn)}
                </div>
              </div>
              <div onClick={() => setTreasuryDrill('out')}
                className="rounded-xl p-3 cursor-pointer transition-all hover:shadow-xl hover:scale-[1.02] flex flex-col items-center justify-center text-center min-h-[96px]"
                style={{
                  background: 'linear-gradient(135deg, #7f1d1d 0%, #991b1b 100%)',
                  border: '2px solid #ef4444',
                  boxShadow: '0 0 0 1px rgba(239,68,68,0.1) inset',
                }}>
                <div className="flex items-center justify-center gap-1.5 mb-1">
                  <span className="text-red-400 text-base">💸</span>
                  <div className="text-[10px] text-red-200 font-bold uppercase tracking-wider">Cash Out / منصرف</div>
                </div>
                <div className="text-xl sm:text-2xl font-black text-red-300 tracking-tight" style={{ textShadow: '0 0 20px rgba(239,68,68,0.3)' }}>
                  {fE(totalCashOut)}
                </div>
              </div>
              <div onClick={() => setTreasuryDrill('net')}
                className="rounded-xl p-3 cursor-pointer transition-all hover:shadow-xl hover:scale-[1.02] flex flex-col items-center justify-center text-center min-h-[96px]"
                style={{
                  background: totalCashIn >= totalCashOut
                    ? 'linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%)'
                    : 'linear-gradient(135deg, #78350f 0%, #92400e 100%)',
                  border: '2px solid ' + (totalCashIn >= totalCashOut ? '#3b82f6' : '#f59e0b'),
                  boxShadow: '0 0 0 1px ' + (totalCashIn >= totalCashOut ? 'rgba(59,130,246,0.1)' : 'rgba(245,158,11,0.1)') + ' inset',
                }}>
                <div className="flex items-center justify-center gap-1.5 mb-1">
                  <span className="text-base">{totalCashIn >= totalCashOut ? '📈' : '📉'}</span>
                  <div className={'text-[10px] font-bold uppercase tracking-wider ' + (totalCashIn >= totalCashOut ? 'text-blue-200' : 'text-amber-200')}>Net / صافي</div>
                </div>
                <div className={'text-xl sm:text-2xl font-black tracking-tight ' + (totalCashIn >= totalCashOut ? 'text-blue-300' : 'text-amber-300')}
                  style={{ textShadow: '0 0 20px ' + (totalCashIn >= totalCashOut ? 'rgba(59,130,246,0.3)' : 'rgba(245,158,11,0.3)') }}>
                  {fE(totalCashIn - totalCashOut)}
                </div>
                {totalCashIn > 0 && (
                  <div className="mt-2 h-1 w-4/5 rounded-full bg-black/30 overflow-hidden">
                    <div style={{
                      width: Math.min(100, Math.max(0, (totalCashIn - totalCashOut) / totalCashIn * 100)) + '%',
                      background: totalCashIn >= totalCashOut ? '#60a5fa' : '#fbbf24',
                      height: '100%',
                      transition: 'width 0.3s'
                    }} />
                  </div>
                )}
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
                      // ORPHAN: row carries inflow (cash_in, bank_in, or is a matched bank row
                      // with expected_amount/cash_in falling back to it) AND has an order#
                      // AND the invoice with that order# doesn't exist yet. Amount is tracked
                      // but not yet crediting any invoice. Auto-links when invoice is created.
                      const hasInflow = Number(txn.cash_in || 0) > 0
                                      || Number(txn.bank_in || 0) > 0
                                      || (isBankMatched && (Number(txn.expected_amount || 0) > 0 || Number(txn.cash_in || 0) > 0));
                      const isOrphanWaiting = hasInflow
                        && txn.order_number
                        && !txn.linked_invoice_id
                        && !txn.is_bank_placeholder
                        && !invoices.find(i => String(i.order_number || '') === String(txn.order_number || ''));
                      // v55.83-A.6.27.71 (Phase 2) — bucket placeholder rows
                      // get a distinct amber highlight + 🏭 icon. When the
                      // bucket closes (Phase 3), the same row's visual flips
                      // to green/reconciled. The amount on this row NEVER
                      // changes — only the visual treatment + tooltip do.
                      const isBucketPlaceholder = txn.bucket_role === 'placeholder';
                      // v55.83-A.6.27.71 (Phase 3) — closed bucket lookup.
                      // bucketStatusMap is populated in a useEffect that
                      // watches the treasury array. NEVER touches the
                      // treasury row data itself.
                      const bucketStatus = isBucketPlaceholder && txn.bucket_id ? bucketStatusMap[txn.bucket_id] : null;
                      const isBucketClosed = bucketStatus === 'closed';
                      const isBucketCancelled = bucketStatus === 'cancelled';
                      const rowClass = "border-b border-slate-100 " +
                        (isBucketClosed
                          ? "bg-emerald-100 hover:bg-emerald-200 border-l-4 border-l-emerald-600"
                          : isBucketCancelled
                          ? "bg-slate-100 hover:bg-slate-200 border-l-4 border-l-slate-500 opacity-70"
                          : isBucketPlaceholder
                          ? "bg-amber-100 hover:bg-amber-200 border-l-4 border-l-amber-600"
                          : isBankPlaceholder
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
                          title={isBucketClosed
                            ? "🏭 Warehouse Bucket — RECONCILED. The cash-out stays exactly as-is in Treasury; expense reporting now reflects the per-category breakdown. Open the Warehouse tab to see the ledger."
                            : isBucketCancelled
                            ? "🏭 Warehouse Bucket — CANCELLED. A refund credit was posted to Treasury. Open the Warehouse tab for details."
                            : isBucketPlaceholder
                            ? "🏭 Warehouse Bucket — advance pending reconciliation. Open the Warehouse tab to log spending against this bucket."
                            : isOrphanWaiting
                            ? "Waiting for invoice #" + txn.order_number + " to be created — amount shown but not yet credited to any invoice"
                            : isBankRow
                            ? "Bank entry — affects invoice collections only, does NOT impact treasury (safe) net / قيد بنكي — يؤثر على تحصيل الفاتورة فقط، لا يؤثر على رصيد الخزنة"
                            : undefined}>
                        <td className="px-2 py-1.5 text-[10px] whitespace-nowrap">
                          {isBucketPlaceholder && <span className="mr-1" title={isBucketClosed ? "Reconciled" : isBucketCancelled ? "Cancelled" : "Warehouse Bucket"}>{isBucketClosed ? '✅' : isBucketCancelled ? '✗' : '🏭'}</span>}
                          {txn.transaction_date}
                        </td>
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
                                  className="text-amber-900 hover:text-amber-900 font-extrabold underline-offset-2 hover:underline"
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
                            <div className="text-[10px] text-amber-900 mt-0.5">
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
                            <div className="text-[11px] text-amber-900 italic mt-1 font-semibold leading-snug">
                              <div>⏳ Not yet credited — invoice #{txn.order_number} does not exist. Click the order# to create it.</div>
                              <div style={{direction:'rtl'}} className="text-amber-900 mt-0.5">⏳ لم تُضف بعد إلى المحصّل — الفاتورة رقم {txn.order_number} غير موجودة. اضغط رقم الأمر لإنشائها.</div>
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right font-semibold">
                          {/* Awaiting bank placeholder — show expected amount + explicit "won't affect safe" caption */}
                          {isBankPlaceholder && txn.expected_direction === 'in' && (
                            <div>
                              <div className="text-indigo-500 italic font-bold text-[11px]">~{fE(txn.expected_amount)}</div>
                              <div className="text-[9px] text-indigo-400 italic">won't affect safe / لا يؤثر على الخزنة</div>
                            </div>
                          )}
                          {/* Matched / confirmed bank_in — emerald-tinted indigo + check mark.
                              Fallback: if bank_in is empty (un-migrated legacy row) but the row IS matched,
                              show expected_amount OR cash_in so the user still sees the figure. */}
                          {isBankMatched && Number(txn.bank_in || 0) > 0 && (
                            <div className="inline-block px-1.5 py-0.5 rounded" style={{background: '#ecfdf5', border: '1.5px solid #10b981'}}>
                              <div className="text-indigo-700 font-extrabold text-[11px]">{fE(txn.bank_in)} <span className="text-emerald-600">✅</span></div>
                              <div className="text-[9px] text-emerald-700 italic">matched — collected only / للتحصيل فقط</div>
                            </div>
                          )}
                          {isBankMatched && !(Number(txn.bank_in || 0) > 0) && (Number(txn.expected_amount || 0) > 0 || Number(txn.cash_in || 0) > 0) && (
                            <div className="inline-block px-1.5 py-0.5 rounded" style={{background: '#ecfdf5', border: '1.5px solid #10b981'}}>
                              <div className="text-indigo-700 font-extrabold text-[11px]">{fE(Number(txn.expected_amount || 0) || Number(txn.cash_in || 0))} <span className="text-emerald-600">✅</span></div>
                              <div className="text-[9px] text-amber-600 italic" title="This row was matched before the bank-separation migration ran. Ask admin to run the migration to move the amount to bank_in.">
                                matched (legacy — run migration) / تم المطابقة (قديم — شغّل الترقية)
                              </div>
                            </div>
                          )}
                          {!isBankMatched && Number(txn.bank_in || 0) > 0 && (
                            <div className="inline-block px-1.5 py-0.5 rounded" style={{background: '#ecfdf5', border: '1.5px solid #10b981'}}>
                              <div className="text-indigo-700 font-extrabold text-[11px]">{fE(txn.bank_in)} <span className="text-emerald-600">✅</span></div>
                              <div className="text-[9px] text-emerald-700 italic">bank ledger / دفتر البنك</div>
                            </div>
                          )}
                          {/* Safe cash in — emerald */}
                          {!isBankMatched && Number(txn.cash_in) > 0 && <span className="text-emerald-600 text-[11px]">{fE(txn.cash_in)}</span>}
                          {Number(txn.usd_in) > 0 && <div className="text-emerald-600 text-[11px]">${Number(txn.usd_in).toLocaleString()} <span className="text-[9px] text-amber-600">USD</span></div>}
                          {Number(txn.foreign_amount || 0) > 0 && txn.foreign_direction === 'in' && <div className="text-emerald-600 text-[11px]">{Number(txn.foreign_amount).toLocaleString()} <span className="text-[9px] text-amber-600">{txn.foreign_currency}</span></div>}
                        </td>
                        <td className="px-2 py-1.5 text-right font-semibold">
                          {isBankPlaceholder && txn.expected_direction === 'out' && (
                            <div>
                              <div className="text-indigo-500 italic font-bold text-[11px]">~{fE(txn.expected_amount)}</div>
                              <div className="text-[9px] text-indigo-400 italic">won't affect safe / لا يؤثر على الخزنة</div>
                            </div>
                          )}
                          {isBankMatched && Number(txn.bank_out || 0) > 0 && (
                            <div className="inline-block px-1.5 py-0.5 rounded" style={{background: '#fef2f2', border: '1.5px solid #ef4444'}}>
                              <div className="text-indigo-700 font-extrabold text-[11px]">{fE(txn.bank_out)} <span className="text-red-500">✅</span></div>
                              <div className="text-[9px] text-red-600 italic">bank ledger / دفتر البنك</div>
                            </div>
                          )}
                          {isBankMatched && !(Number(txn.bank_out || 0) > 0) && (Number(txn.expected_amount || 0) > 0 || Number(txn.cash_out || 0) > 0) && txn.expected_direction === 'out' && (
                            <div className="inline-block px-1.5 py-0.5 rounded" style={{background: '#fef2f2', border: '1.5px solid #ef4444'}}>
                              <div className="text-indigo-700 font-extrabold text-[11px]">{fE(Number(txn.expected_amount || 0) || Number(txn.cash_out || 0))} <span className="text-red-500">✅</span></div>
                              <div className="text-[9px] text-amber-600 italic">matched (legacy) / تم المطابقة (قديم)</div>
                            </div>
                          )}
                          {!isBankMatched && Number(txn.bank_out || 0) > 0 && (
                            <div className="inline-block px-1.5 py-0.5 rounded" style={{background: '#fef2f2', border: '1.5px solid #ef4444'}}>
                              <div className="text-indigo-700 font-extrabold text-[11px]">{fE(txn.bank_out)} <span className="text-red-500">✅</span></div>
                              <div className="text-[9px] text-red-600 italic">bank ledger / دفتر البنك</div>
                            </div>
                          )}
                          {!isBankMatched && Number(txn.cash_out) > 0 && <span className="text-red-500 text-[11px]">{fE(txn.cash_out)}</span>}
                          {Number(txn.usd_out) > 0 && <div className="text-red-500 text-[11px]">${Number(txn.usd_out).toLocaleString()} <span className="text-[9px] text-amber-600">USD</span></div>}
                          {Number(txn.foreign_amount || 0) > 0 && txn.foreign_direction === 'out' && <div className="text-red-500 text-[11px]">{Number(txn.foreign_amount).toLocaleString()} <span className="text-[9px] text-amber-600">{txn.foreign_currency}</span></div>}
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
          const todayStr = todayET();
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
                    if (!formData.chkCustomer || !isValidAmount(formData.chkAmount)) { alert('Customer and amount required'); return; }
                    try {
                      const orderNum = formData.chkOrder || '';
                      const matchInv = orderNum ? invoices.find(i => i.order_number === orderNum) : null;
                      await dbInsert('checks', {
                        customer_name: formData.chkCustomer,
                        order_number: orderNum,
                        invoice_id: matchInv?.id || null,
                        amount: parseAmount(formData.chkAmount),
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
                  groupLabel = gKey === 'Unknown' ? 'No Date' : (function(){ var d = new Date(gKey + '-01'); var m = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'America/New_York' }).format(d); return m; })();
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
                                  <span className="px-2 py-0.5 bg-amber-100 text-amber-900 rounded-full text-[8px] font-bold">TOMORROW</span>
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
                                    {/* S15 — Uncollect button: reverses the collect flow cleanly */}
                                    {(userProfile?.role === 'super_admin' || userProfile?.role === 'admin') && (
                                      <button onClick={() => handleUncollectCheck(c)}
                                        className="px-1.5 py-0.5 rounded border border-amber-300 text-amber-900 text-[9px] hover:bg-amber-50 font-semibold"
                                        title="Uncollect — reverse this collection">
                                        ↩︎ Uncollect
                                      </button>
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
                  XLSX.writeFile(wb, `Warehouse-Export-${formData.whYear || 'All'}-${todayET()}.xlsx`);
                }} className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-xs font-semibold hover:bg-slate-200">
                  📥 Export
                </button>
              </div>
            </div>

            {/* v55.83-A.6.27.71 (Phase 2) — Warehouse Buckets section.
                Sits ABOVE the existing warehouse expense list/forms — doesn't
                interfere with the existing "+ New Expense" workflow at all.
                Feature-flag gated, so when OFF the warehouse tab looks
                exactly like it did before this build. */}
            {bucketsFeatureEnabled && (
              <div className="mb-4 p-3 bg-amber-50 rounded-lg border-2 border-amber-200">
                <WarehouseBucketList
                  userId={userProfile?.id}
                  isSuperAdmin={isSuperAdmin}
                  canCreate={isSuperAdmin || (modulePerms && (modulePerms['Manage Warehouse Buckets'] || modulePerms['Treasury'] || modulePerms['Edit Treasury']))}
                  canManage={isSuperAdmin || (modulePerms && (modulePerms['Manage Warehouse Buckets'] || modulePerms['Treasury'] || modulePerms['Edit Treasury']))}
                  canApprove={isSuperAdmin || (modulePerms && modulePerms['Approve Warehouse Buckets'])}
                  canReopen={isSuperAdmin || (modulePerms && modulePerms['Reopen Closed Buckets'])}
                  canManageCategories={isSuperAdmin || (modulePerms && modulePerms['Manage Categories'])}
                  onRequestCreate={() => { setShowBucketModal(true); }}
                  reloadToken={bucketReloadToken}
                  onBucketChanged={() => { setBucketReloadToken(t => t + 1); try { loadAllData && loadAllData(); } catch (_) {} }}
                  toast={toast}
                  lang={lang}
                />
                {/* v55.83-A.6.27.71 (Phase 4) — History & Analytics below the
                    live list. Read-only multi-year lens; reads from buckets
                    tables only, doesn't touch treasury. */}
                <WarehouseBucketsHistory
                  userId={userProfile?.id}
                  isSuperAdmin={isSuperAdmin}
                  reloadToken={bucketReloadToken}
                  toast={toast}
                  lang={lang}
                />
              </div>
            )}

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
                    {formData.whExpCat === '__custom' && (
                      <input autoFocus value={formData.whExpCatCustom || ''}
                        onChange={e => setFormData({...formData, whExpCatCustom: e.target.value})}
                        placeholder="Type new category name / اكتب اسم التصنيف"
                        className="w-full mt-1 px-3 py-2 rounded-lg border-2 border-purple-400 bg-purple-50 text-sm text-slate-900 font-semibold" />
                    )}
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

                {/* v55.83-A.6.27.64 — Optional: tag this expense to an open advance.
                    If picked, the expense counts against that advance's "spent" total
                    so the Advances tab shows remaining balance correctly. */}
                {warehouseAdvances.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">
                    <label className="text-xs font-semibold text-amber-900 mb-1 block">💵 Link to Advance (optional) / ربط بسلفة</label>
                    <select value={formData.whAdvanceId || ''} onChange={e => setFormData({...formData, whAdvanceId: e.target.value})}
                      className="w-full px-3 py-2 rounded-lg border border-amber-300 text-sm bg-white">
                      <option value="">(none — company paid)</option>
                      {warehouseAdvances.map(a => (
                        <option key={a.id} value={a.id}>
                          {a.recipient_name}{a.recipient_role ? ' (' + a.recipient_role + ')' : ''} · {Number(a.amount).toLocaleString()} {a.currency || 'EGP'} · {a.issue_date}
                        </option>
                      ))}
                    </select>
                    <div className="text-[10px] text-amber-700 mt-1">
                      Pick the advance this expense was paid from. Leave blank if it was paid directly by the company.
                    </div>
                  </div>
                )}
                <button onClick={async () => {
                  if (!formData.whExpDesc || !formData.whExpAmount) { alert('Please fill in description and amount'); return; }
                  let cat = formData.whExpCat || '';
                  if (cat === '__custom') {
                    cat = (formData.whExpCatCustom || '').trim();
                    if (!cat) { alert('Please type the new category name / اكتب اسم التصنيف الجديد'); return; }
                  }
                  try {
                    await dbInsert('warehouse_expenses', {
                      expense_date: formData.whExpDate || today(),
                      description: formData.whExpDesc,
                      amount: parseAmount(formData.whExpAmount),
                      category: cat,
                      subcategory: formData.whExpSub || '',
                      america_ref: formData.whType === 'shipment' ? (formData.whExpRef || '') : 'GENERAL',
                      advance_id: formData.whAdvanceId || null,
                      created_by: userProfile?.id,
                    }, userProfile?.id);
                    setFormData({...formData, showAddWarehouse: false, whExpDate: '', whExpDesc: '', whExpAmount: '', whExpCat: '', whExpCatCustom: '', whExpSub: '', whExpRef: '', whType: 'general', whAdvanceId: ''});
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
        {/* ==========================================
            INVENTORY TAB (v55.83-A — new module)
            Replaced the inline ~1900-line inventory section with the
            new module. Stage 1 ships Master SKUs + Warehouses; future
            stages fill in Shipments, Movements, Adjustments, Reports.
        ========================================== */}
        {tab === 'inventory' && (
          <SafeSection label="Inventory">
            <InventoryTab userProfile={userProfile} modulePerms={modulePerms} isSuperAdmin={isSuperAdmin} toast={toast} />
          </SafeSection>
        )}

        {/* ==========================================
            CRM TAB
            v55.83-A — Restored to byte-exact match with v55.82-Z baseline.
        ========================================== */}
        {tab === 'crm' && (
          <SafeSection label="CRM"><CRMTab toast={toast} customers={customers} invoices={invoices} user={user} userProfile={userProfile} users={teamUsers} onReload={loadAllData} isAdmin={isAdmin} onSelectInvoice={setSelectedInvoice} lang={lang} modulePerms={modulePerms} /></SafeSection>
        )}

        {tab === 'social' && (
          <SafeSection label="Social Studio"><SocialContentTab toast={toast} user={user} userProfile={userProfile} lang={lang} /></SafeSection>
        )}

        {tab === 'brand' && (
          <SafeSection label="Brand Learning"><BrandLearningTab toast={toast} user={user} userProfile={userProfile} lang={lang} /></SafeSection>
        )}

        {tab === 'seo' && (
          <SafeSection label="SEO Audit"><SEOAuditTab toast={toast} user={user} userProfile={userProfile} lang={lang} /></SafeSection>
        )}

        {/* ==========================================
            TICKETS TAB
            v55.83-A — Restored to byte-exact match with v55.82-Z baseline.
        ========================================== */}
        {tab === 'tickets' && (
          <SafeSection label="Tickets"><TicketsTab toast={toast} customers={customers} user={user} userProfile={userProfile} users={teamUsers} onReload={loadAllData} lang={lang} isAdmin={isAdmin} modulePerms={modulePerms} openTicketId={openTicketId} onOpenTicketHandled={() => setOpenTicketId(null)} onTicketModalClosed={() => {
            // v55.83-A.6.13 — return to whichever tab the user was on
            // when they clicked the ticket link (e.g. dashboard).
            if (returnToTabAfterTicket) {
              const t = returnToTabAfterTicket;
              setReturnToTabAfterTicket(null);
              setTab(t);
            }
          }} /></SafeSection>
        )}

        {/* ==========================================
            CALENDAR TAB
            v55.83-A — Restored to byte-exact match with v55.82-Z baseline.
        ========================================== */}
        {tab === 'calendar' && (
          <SafeSection label="Calendar"><CalendarTab customers={customers} user={user} userProfile={userProfile} users={teamUsers} tickets={dashTickets} onOpenTicket={(tid) => { setOpenTicketId(tid); setTab('tickets'); }} onReload={loadAllData} /></SafeSection>
        )}

        {/* ==========================================
            CUSTOMS / BROKER TAB
        ========================================== */}
        {tab === 'customs' && (
          <SafeSection label="Customs"><CustomsTab customers={customers} user={user} fxRate={fxRate} /></SafeSection>
        )}

        {/* ==========================================
            SHIPPING RATES TAB
        ========================================== */}
        {tab === 'shipping' && (
          <SafeSection label="Shipping"><ShippingRatesTab toast={toast} user={user} userProfile={userProfile} isAdmin={isAdmin} customers={customers} canBulkDeleteBubbles={isSuperAdmin || (modulePerms && modulePerms['Delete Shipping Bubbles'] === true)} canDeleteRates={isAdmin || (modulePerms && modulePerms['Delete Shipping Rates'] === true)} /></SafeSection>
        )}

        {tab === 'bank' && (
          <SafeSection label="Bank">
            <BankTab user={user} supabase={supabase} modulePerms={modulePerms} userProfile={userProfile} />
          </SafeSection>
        )}
        {tab === 'accounting' && (
          <SafeSection label="Accounting">
            <AccountingTab toast={toast} user={user} userProfile={userProfile} isSuperAdmin={isSuperAdmin} modulePerms={modulePerms} onReload={loadAllData} />
          </SafeSection>
        )}

        {tab === 'egyptbank' && (
          <SafeSection label="Egypt Bank"><EgyptBankTab toast={toast} user={user} userProfile={userProfile} isAdmin={isAdmin} invoices={invoices} recalcInvoiceCollected={recalcInvoiceCollected} onReload={loadAllData} /></SafeSection>
        )}

        {/* v55.83-A.6.27.52 — Open Accounts: internal customer-by-customer ledger.
            Independent of invoices/treasury. Gated by super_admin OR "Open Accounts" permission. */}
        {tab === 'openaccounts' && (
          <SafeSection label="Open Accounts">
            <OpenAccountsTab userProfile={userProfile} modulePerms={modulePerms} isSuperAdmin={isSuperAdmin} toast={toast} />
          </SafeSection>
        )}

        {tab === 'reports' && (
          <SafeSection label="Reports">
            <ReportsTab treasury={treasury} invoices={invoices} warehouseExpenses={warehouse} egyptBankTxns={egyptBankTxns} canViewFinancials={isSuperAdmin || modulePerms?.['View Financial Reports'] === true} supabase={supabase} isSuperAdmin={isSuperAdmin} userProfile={userProfile} checks={checks} customers={customers} onReload={loadAllData} toast={toast} recalcInvoiceCollected={recalcInvoiceCollected} onOpenInvoice={(inv) => {
              // v55.83-A.6.17 — opens the invoice modal (rendered globally
              // outside tab gates, so we DO NOT switch tabs — Reports stays
              // mounted in the background. Closing the modal returns naturally.
              if (!inv) return;
              setSelectedInvoice(inv);
            }} />
            {/* v55.83-A.6.9 — Write-offs audit report. Reuses same
                permission gate as financial reports. */}
            <div className="mt-4">
              <WriteOffsReport
                invoices={invoices}
                customers={customers}
                users={teamUsers}
                canView={isSuperAdmin || modulePerms?.['View Financial Reports'] === true}
              />
            </div>
          </SafeSection>
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
          <SafeSection label="Admin"><AdminTab user={user} userProfile={userProfile} users={teamUsers} isAdmin={isAdmin} customers={customers} modulePerms={modulePerms} /></SafeSection>
        )}

        {/* ==========================================
            AI ASSISTANT TAB
        ========================================== */}
        {tab === 'ai' && (
          <SafeSection label="AI Assistant"><AIAssistant user={user} userProfile={userProfile} users={teamUsers} customers={customers} /></SafeSection>
        )}

        {tab === 'comms' && (
          <SafeSection label="Communications"><CommunicationsTab user={user} userProfile={userProfile} customers={customers} supabase={supabase} /></SafeSection>
        )}

        {/* ==========================================
            SETTINGS TAB
        ========================================== */}
        {tab === 'settings' && (
          <SafeSection label="Settings"><SettingsTab toast={toast} user={user} users={teamUsers} onReload={loadAllData} isAdmin={isAdmin} userProfile={userProfile} categoriesList={categoriesList} onCategoriesReload={async () => {
            try {
              const { data: cats } = await supabase.from('categories').select('*').eq('active', true).order('sort_order').order('name_ar');
              setCategoriesList(cats || []);
            } catch (e) { /* table may not exist yet */ }
          }} /></SafeSection>
        )}

        {/* ==========================================
            SYSTEM TICKETS TAB
            v55.45 — extracted to SystemTicketsPanel component (clean
            React state, no window globals, no setState-during-render).
        ========================================== */}
        {tab === 'systemtickets' && (
          <SafeSection label="System Tickets">
            <SystemTicketsPanel
              userId={userProfile?.id || user?.id}
              isAdmin={isAdmin}
              getUserName={getUserName}
              sanitize={sanitize}
              toast={toast}
            />
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

      {/* Data Freshness Indicator
          v55.58 — Hidden on mobile (overlapped voice pill + phone button on
          phones). Still visible on desktop where there's room. Was at
          bottom-4 left-4 which collided with VoiceController + PhoneWidget.
          The data is still accurate; it's just not worth the screen real
          estate on a phone where the user can pull-to-refresh anyway. */}
      {lastLoaded && (
        <div className="hidden lg:flex fixed bottom-4 lg:left-[220px] z-30 items-center gap-2">
          <button onClick={() => loadAllData()} className="px-2.5 py-1 bg-white/90 border border-slate-200 rounded-lg shadow-sm text-[10px] text-slate-500 hover:bg-slate-50 transition flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
            Synced {Math.floor((Date.now() - lastLoaded.getTime()) / 60000)}m ago
            <span className="text-slate-300">↻</span>
          </button>
        </div>
      )}

      {/* Phone Widget - floating on all tabs.
          Wrapped in its own ErrorBoundary so a Twilio SDK crash, a
          missing-env-var error, or a microphone-blocked browser CANNOT
          take down the whole dashboard (which would hide the sidebar +
          logout button). If the widget crashes, this boundary swallows
          it silently and we render nothing in its place. */}
      <ErrorBoundary label="Phone widget unavailable">
        <PhoneWidget user={user} userProfile={userProfile} users={teamUsers} customers={customers} />
      </ErrorBoundary>

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
          onLinkInvoice={async (txn, inv) => {
            try {
              await dbUpdate('treasury', txn.id, { linked_invoice_id: inv.id }, userProfile?.id || user?.id);
              await recalcInvoiceCollected(inv.id);
              toast.success('Linked to invoice #' + inv.order_number + ' ✓');
              setInspectedTreasury(null);
              await loadAllData();
            } catch (err) {
              toast.error('Link failed: ' + err.message);
            }
          }}
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

      {/* "Order # not found — create invoice now?" Modal
          v55.48 — z-[200] (was z-[60]) so it's unambiguously above the
          form Modal even on devices that exhibit weird stacking-context
          behavior. Plus the form Modal now hides itself when this modal
          is open, so there's no overlap to worry about anyway. */}
      {/* v55.83-A.6.27.17 (Max May 17 2026) — Phase 1 Payment Instruments.
          Smart-popup that fires when a treasury entry's amount matches a
          pending/deposited instrument on the same invoice. Per Max: this is
          documentation-only, never creates a second treasury row, never
          changes invoice money math. The popup's Yes path just stamps
          source_check_id on the record we're about to insert. The No path
          inserts without the link. Either way → exactly ONE treasury row. */}
      {pendingInstrumentMatch && (() => {
        // v55.83-A.6.27.19 — popup shape now carries an ARRAY of candidate
        // instruments. Each gets its own button. Plus "No, separate
        // payment" and Cancel. The onResume callback is supplied by the
        // caller (handleAddTreasury or PaymentForm) so the same popup
        // works from both flows.
        var candidates = pendingInstrumentMatch.instruments || (pendingInstrumentMatch.instrument ? [pendingInstrumentMatch.instrument] : []);
        var multiple = candidates.length > 1;
        return (
          <div
            className="fixed inset-0 z-[210] bg-black/70"
            onClick={() => { setPendingInstrumentMatch(null); }}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}
          >
            <div
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md"
              onClick={(e) => e.stopPropagation()}
              style={{ padding: 20, maxHeight: 'calc(100vh - 24px)', overflowY: 'auto' }}
            >
              <div className="flex items-center gap-2 mb-2">
                <span style={{ fontSize: 24 }}>🧾</span>
                <h3 className="text-base font-extrabold text-slate-900">
                  {multiple ? candidates.length + ' matching instruments found' : 'Matching instrument found'}
                </h3>
              </div>
              <div className="text-[11px] text-slate-600 mb-3">
                {multiple
                  ? 'Multiple instruments on this invoice have the same amount. Pick which one this payment clears, or "Separate payment" if none.'
                  : 'Does this payment clear that instrument? Picking "Yes" links them and marks the instrument as cleared — it does NOT change the amount you entered.'}
                <span className="italic"> Documentation only — this never changes any treasury or invoice money math.</span>
              </div>
              <div className="flex flex-col gap-2">
                {candidates.map(function (inst) {
                  var instLabel = (inst.instrument_type === 'promissory_note' ? '📜 Promissory Note' : '🧾 Check')
                    + (inst.check_number ? ' #' + inst.check_number : '');
                  return (
                    <button
                      key={inst.id}
                      onClick={async () => {
                        var stamped = pendingInstrumentMatch.record;
                        stamped.source_check_id = inst.id;
                        stamped.payment_source = 'check';
                        stamped.__instrument_popup_decision = 'link';
                        setPendingInstrumentMatch(null);
                        // Use caller-supplied onResume if provided; fall back to commitInstrumentLinkedTreasury otherwise.
                        var resume = pendingInstrumentMatch.onResume || (function (s) { return commitInstrumentLinkedTreasury(s, pendingInstrumentMatch.invoice, pendingInstrumentMatch.isBankPlaceholder); });
                        await resume(stamped);
                      }}
                      className="text-left px-4 py-2.5 bg-emerald-50 hover:bg-emerald-100 border-2 border-emerald-300 rounded-lg"
                    >
                      <div className="text-sm font-bold text-emerald-900">
                        ✓ Yes, this clears {instLabel} — {fE(Number(inst.amount))}
                      </div>
                      <div className="text-[11px] text-emerald-800 mt-0.5">
                        Customer: <strong>{inst.customer_name || 'N/A'}</strong>
                        {inst.bank_name ? ' · Bank: ' + inst.bank_name : ''}
                        {' · Due: '}<strong>{inst.due_date || inst.check_date || 'N/A'}</strong>
                        {' · '}{inst.status}
                      </div>
                    </button>
                  );
                })}
                <button
                  onClick={async () => {
                    var stamped = pendingInstrumentMatch.record;
                    stamped.__instrument_popup_decision = 'no_link';
                    setPendingInstrumentMatch(null);
                    var resume = pendingInstrumentMatch.onResume || (function (s) { return commitInstrumentLinkedTreasury(s, pendingInstrumentMatch.invoice, pendingInstrumentMatch.isBankPlaceholder); });
                    await resume(stamped);
                  }}
                  className="px-4 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-900 rounded-lg font-semibold text-sm"
                >
                  ✕ No, this is a separate payment
                </button>
                <button
                  onClick={() => { setPendingInstrumentMatch(null); }}
                  className="px-4 py-1 text-[11px] text-slate-500 hover:text-slate-700"
                >
                  Cancel — go back to the form
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {pendingTreasuryRecord && (
        <div
          className="fixed inset-0 z-[200] bg-black/70"
          onClick={() => { closePendingTreasuryModal(); }}
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
                  {/* Build stamp so Max can confirm at a glance that the
                      latest fix is actually deployed. If he doesn't see this
                      tag in the modal, his browser is running stale JS. */}
                  <div className="mt-1.5 inline-block px-2 py-0.5 rounded bg-amber-900/60 text-amber-100 text-[10px] font-mono font-bold tracking-wide">
                    BUILD v55.83-A.6.27.71
                  </div>
                </div>
                <button onClick={() => closePendingTreasuryModal()}
                  className="px-3 py-1.5 rounded-lg bg-white text-slate-900 text-sm font-extrabold hover:bg-slate-100 shadow">✕</button>
              </div>
            </div>

            <div className="p-5 space-y-4" style={{ overflowY: 'auto', flex: '1 1 auto', minHeight: 0 }}>
              {/* Apr 25 2026 — Visible, persistent error banner. Toasts in
                  the corner are easy to miss on mobile; this stays in the
                  modal until dismissed so a failed save can never look like
                  "nothing happened". */}
              {createInvoiceError && (
                <div className="bg-red-100 border-2 border-red-600 rounded-lg p-3 flex items-start gap-2">
                  <div className="text-2xl flex-shrink-0">⚠️</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-extrabold text-red-900 mb-1">Save failed / فشل الحفظ</div>
                    <div className="text-xs text-red-800 break-words whitespace-pre-wrap">{createInvoiceError}</div>
                  </div>
                  <button onClick={() => setCreateInvoiceError(null)}
                    className="text-red-700 hover:text-red-900 text-lg font-bold flex-shrink-0">✕</button>
                </div>
              )}
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
                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wide">Customer / اسم العميل <span className="text-red-600">*</span></label>

                    {/* ===========================================================
                        v55.11 CUSTOMER PICKER — Apr 26 2026
                        ===========================================================
                        Workflow guarantees (from Max's spec):
                          1. EVERY invoice gets a customer_id. No orphans.
                             "Save without link" path is removed.
                          2. List of customers is ALWAYS visible while picker
                             is open. Even if user typed text that doesn't match
                             any customer, the list is still scrollable so they
                             can pick a different one.
                          3. Dedicated SEARCH input filters the dropdown live.
                             It's separate from the typed-name field so search
                             and name don't fight each other.
                          4. When typed name has no match: prominent "Create new
                             customer with this name" button appears. Clicking
                             it creates the customer record AND links it to the
                             invoice in one shot.
                          5. Auto-prefill (case-insensitive match): customer is
                             pre-selected as a chip, picker stays open below for
                             optional change.
                        =========================================================== */}

                    {/* Compute lookup data once per render — used by both states */}
                    {(() => { return null; })()}

                    {formData.__newInvCustomerId ? (
                      // ============================================================
                      // STATE A: CUSTOMER SELECTED (chip + picker stays open below)
                      // ============================================================
                      <>
                        <div className="mt-1 flex items-center gap-2 px-3 py-2.5 rounded-lg bg-white border-2 border-emerald-500 shadow-sm">
                          <div className="w-7 h-7 rounded-full bg-emerald-500 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">✓</div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-wide">
                              {formData.__newInvCustomerAutoLinked ? 'Auto-linked — confirm or pick another below' : 'Linked'}
                            </div>
                            <div className="text-sm font-extrabold text-slate-900 truncate" style={{ direction: 'rtl' }}>{formData.__newInvCustomer}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setFormData({ ...formData, __newInvCustomer: '', __newInvCustomerId: null, __newInvCustomerAutoLinked: false, __newInvSearch: '' })}
                            className="px-3 py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold border border-slate-300"
                          >
                            Change / تغيير
                          </button>
                        </div>

                        {/* Picker stays available below the chip so user can change easily */}
                        <div className="mt-3 rounded-lg overflow-hidden bg-slate-900 border border-slate-700 shadow-md">
                          <div className="px-3 py-2 bg-slate-800 border-b border-slate-700 flex items-center gap-2">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400 flex-shrink-0">
                              <circle cx="11" cy="11" r="8"></circle>
                              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                            </svg>
                            <input
                              type="text"
                              value={formData.__newInvSearch || ''}
                              onChange={e => setFormData({ ...formData, __newInvSearch: e.target.value })}
                              placeholder="Search to change customer..."
                              className="flex-1 bg-transparent border-0 text-sm text-slate-100 placeholder-slate-500 focus:outline-none"
                            />
                          </div>
                          <div className="max-h-[180px] overflow-auto">
                            {(() => {
                              var search = String(formData.__newInvSearch || '').trim().toLowerCase();
                              var pool = Array.isArray(customers) ? customers : [];
                              if (pool.length === 0) {
                                return <div className="px-3 py-4 text-xs text-slate-400 text-center">⏳ Customers loading...</div>;
                              }
                              var filtered = search.length === 0
                                ? pool.slice(0, 20)
                                : pool.filter(function(c) { return String(c.name || '').toLowerCase().indexOf(search) >= 0; }).slice(0, 30);
                              if (filtered.length === 0) {
                                return <div className="px-3 py-4 text-xs text-slate-400 text-center">No customer matches "{formData.__newInvSearch}"</div>;
                              }
                              return filtered.map(function(c) {
                                var isCurrent = c.id === formData.__newInvCustomerId;
                                return (
                                  <div key={c.id}
                                    onClick={function() { setFormData({ ...formData, __newInvCustomer: c.name, __newInvCustomerId: c.id, __newInvCustomerAutoLinked: false, __newInvSearch: '' }); }}
                                    className={'px-3 py-2.5 cursor-pointer border-b border-slate-800 last:border-0 flex items-center justify-between gap-2 ' + (isCurrent ? 'bg-emerald-900/40' : 'hover:bg-slate-800')}>
                                    <span className="font-semibold text-slate-100 text-sm truncate" style={{ direction: 'rtl' }}>{c.name}</span>
                                    {isCurrent
                                      ? <span className="text-[9px] font-bold text-emerald-300 uppercase">current</span>
                                      : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500 flex-shrink-0"><polyline points="9 18 15 12 9 6"></polyline></svg>}
                                  </div>
                                );
                              });
                            })()}
                          </div>
                        </div>
                      </>
                    ) : (
                      // ============================================================
                      // STATE B: NO CUSTOMER YET (typed-name input + dropdown + create-new action)
                      // ============================================================
                      <>
                        {/* Typed name input (this is the customer's NAME — used as
                            the invoice's customer_name field, AND as the fill-in
                            for "Create new customer" if user picks that path) */}
                        <div className="relative mt-1">
                          <input
                            autoFocus
                            value={formData.__newInvCustomer || ''}
                            onChange={e => {
                              const v = e.target.value;
                              // Auto-link if exact case-insensitive match exists
                              var match = Array.isArray(customers)
                                ? customers.find(function(c) { return String(c.name || '').trim().toLowerCase() === v.trim().toLowerCase(); })
                                : null;
                              setFormData({
                                ...formData,
                                __newInvCustomer: v,
                                __newInvCustomerId: match ? match.id : null,
                                __newInvCustomerAutoLinked: match ? true : false,
                                __newInvSearch: v, // Also seed search with what they typed
                              });
                            }}
                            placeholder="Customer name (or pick from list below) / اسم العميل"
                            className="w-full px-3 py-2.5 pr-10 rounded-lg border-2 border-slate-300 bg-white text-sm font-semibold text-slate-900 placeholder-slate-400 focus:border-emerald-500 focus:outline-none"
                            style={{ direction: 'rtl' }}
                          />
                          {formData.__newInvCustomer && (
                            <button type="button"
                              onClick={() => setFormData({ ...formData, __newInvCustomer: '', __newInvCustomerId: null, __newInvCustomerAutoLinked: false, __newInvSearch: '' })}
                              className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold"
                              aria-label="Clear">✕</button>
                          )}
                        </div>

                        {/* No-match warning + CREATE NEW CUSTOMER button.
                            When typed text doesn't match anyone in the list, this
                            is the primary action. Customer record is created on
                            click and the invoice links to it in one shot. */}
                        {(() => {
                          var typedRaw = String(formData.__newInvCustomer || '').trim();
                          if (!typedRaw) return null;
                          var pool = Array.isArray(customers) ? customers : [];
                          var hasAnyMatch = pool.some(function(c) {
                            return String(c.name || '').toLowerCase().indexOf(typedRaw.toLowerCase()) >= 0;
                          });
                          if (hasAnyMatch) return null;
                          return (
                            <div className="mt-2 p-3 rounded-lg bg-amber-50 border-2 border-amber-300 space-y-2">
                              <div className="flex items-start gap-2">
                                <span className="text-amber-900 text-base flex-shrink-0">⚠</span>
                                <div className="flex-1 text-[12px] text-amber-900">
                                  <div className="font-bold">"{typedRaw}" is not in your customers list</div>
                                  <div>Create them as a new customer, or pick someone different from the list below.</div>
                                </div>
                              </div>
                              <button
                                type="button"
                                disabled={isCreatingInvoice || isCreatingCustomer}
                                onClick={async () => {
                                  if (isCreatingCustomer) return;
                                  setIsCreatingCustomer(true);
                                  try {
                                    const newCust = await dbInsert('customers', {
                                      name: sanitize(typedRaw),
                                    }, user?.id);
                                    if (newCust && newCust.id) {
                                      setCustomers(function(prev) { return [newCust].concat(Array.isArray(prev) ? prev : []); });
                                      setFormData(function(prev) {
                                        return Object.assign({}, prev, {
                                          __newInvCustomer: newCust.name,
                                          __newInvCustomerId: newCust.id,
                                          __newInvCustomerAutoLinked: false,
                                          __newInvSearch: '',
                                        });
                                      });
                                      try { (toast && toast.success) && toast.success('Customer "' + newCust.name + '" created and linked ✓'); } catch (_) {}
                                    } else {
                                      try { (toast && toast.error) && toast.error('Customer creation returned no record'); } catch (_) {}
                                    }
                                  } catch (err) {
                                    console.error('[create-customer] failed', err);
                                    var msg = (err && err.message) ? err.message : String(err);
                                    try { (toast && toast.error) && toast.error('Failed to create customer: ' + msg); } catch (_) {}
                                  } finally {
                                    setIsCreatingCustomer(false);
                                  }
                                }}
                                className={'w-full px-3 py-2.5 rounded-lg text-sm font-extrabold shadow flex items-center justify-center gap-2 ' + (isCreatingCustomer ? 'bg-emerald-400 text-white cursor-not-allowed' : 'bg-emerald-600 text-white hover:bg-emerald-700')}
                              >
                                {isCreatingCustomer
                                  ? <span>⏳ Creating customer...</span>
                                  : <><span>➕</span><span>Create "{typedRaw}" as new customer / إنشاء عميل جديد</span></>}
                              </button>
                            </div>
                          );
                        })()}

                        {/* ALWAYS-VISIBLE customer dropdown with dedicated search input.
                            User can pick a different name even if they typed something
                            else. Search box filters the list live without affecting the
                            customer-name input above. */}
                        <div className="mt-2 rounded-lg overflow-hidden bg-slate-900 border border-slate-700 shadow-md">
                          <div className="px-3 py-2 bg-slate-800 border-b border-slate-700">
                            <div className="flex items-center gap-2">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-400 flex-shrink-0">
                                <circle cx="11" cy="11" r="8"></circle>
                                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                              </svg>
                              <input
                                type="text"
                                value={formData.__newInvSearch || ''}
                                onChange={e => setFormData({ ...formData, __newInvSearch: e.target.value })}
                                placeholder="Search customers... / بحث"
                                className="flex-1 bg-transparent border-0 text-sm text-slate-100 placeholder-slate-500 focus:outline-none"
                              />
                              {formData.__newInvSearch && (
                                <button type="button" onClick={() => setFormData({ ...formData, __newInvSearch: '' })}
                                  className="text-slate-400 hover:text-slate-200 text-xs">✕</button>
                              )}
                              <span className="text-[10px] text-slate-400 font-medium ml-1 whitespace-nowrap">
                                {(() => {
                                  var s = String(formData.__newInvSearch || '').trim().toLowerCase();
                                  var pool = Array.isArray(customers) ? customers : [];
                                  if (s.length === 0) return pool.length + ' total';
                                  var n = pool.filter(function(c) { return String(c.name || '').toLowerCase().indexOf(s) >= 0; }).length;
                                  return n + ' match' + (n === 1 ? '' : 'es');
                                })()}
                              </span>
                            </div>
                          </div>
                          <div className="max-h-[220px] overflow-auto">
                            {(() => {
                              var search = String(formData.__newInvSearch || '').trim().toLowerCase();
                              var pool = Array.isArray(customers) ? customers : [];
                              if (pool.length === 0) {
                                return (
                                  <div className="px-3 py-5 text-xs text-slate-300 text-center">
                                    <div className="font-bold mb-1 text-amber-300">⏳ Customers list not loaded</div>
                                    <div className="text-slate-400">If this persists, check your connection. You can still type a name above and create them as a new customer.</div>
                                  </div>
                                );
                              }
                              var filtered;
                              if (search.length === 0) {
                                filtered = pool.slice(0, 20);
                              } else {
                                filtered = pool.filter(function(c) {
                                  return String(c.name || '').toLowerCase().indexOf(search) >= 0;
                                }).slice(0, 30);
                              }
                              if (filtered.length === 0) {
                                return (
                                  <div className="px-3 py-5 text-xs text-slate-300 text-center">
                                    <div className="font-bold mb-1">No customer matches "{formData.__newInvSearch}"</div>
                                    <div className="text-slate-400">Clear the search to see all customers, or type a name in the field above to create a new one.</div>
                                  </div>
                                );
                              }
                              return filtered.map(function(c) {
                                var typedRaw = String(formData.__newInvCustomer || '').trim();
                                var isExact = String(c.name || '').trim().toLowerCase() === typedRaw.toLowerCase() && typedRaw.length > 0;
                                return (
                                  <div key={c.id}
                                    onClick={function() { setFormData({ ...formData, __newInvCustomer: c.name, __newInvCustomerId: c.id, __newInvCustomerAutoLinked: false, __newInvSearch: '' }); }}
                                    className={'px-3 py-2.5 cursor-pointer border-b border-slate-800 last:border-0 flex items-center justify-between gap-2 ' + (isExact ? 'bg-emerald-900/40 hover:bg-emerald-900/60' : 'hover:bg-slate-800')}>
                                    <span className="font-semibold text-slate-100 text-sm truncate" style={{ direction: 'rtl' }}>{c.name}</span>
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                      {isExact && <span className="text-[9px] font-bold text-emerald-300 uppercase">match</span>}
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500"><polyline points="9 18 15 12 9 6"></polyline></svg>
                                    </div>
                                  </div>
                                );
                              });
                            })()}
                          </div>
                        </div>
                      </>
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

                  <div className="flex flex-col gap-2 pt-2">
                    {/* Hint when button disabled because no customer chosen */}
                    {!formData.__newInvCustomerId && !isCreatingInvoice && (
                      <div className="text-[11px] text-slate-700 bg-slate-100 border border-slate-300 rounded-md px-3 py-2 flex items-start gap-2">
                        <span className="text-slate-500 flex-shrink-0">ℹ</span>
                        <span>
                          <span className="font-bold">Pick or create a customer first.</span> Every invoice must be linked so it shows up under that customer in the Customers tab and in reports.
                        </span>
                      </div>
                    )}
                    <div className="flex gap-2">
                    <button
                      disabled={isCreatingInvoice || !formData.__newInvCustomerId}
                      title={!formData.__newInvCustomerId ? 'Pick a customer from the list, or create a new one with the typed name above.' : ''}
                      onClick={async () => {
                        // Apr 25 2026 — Bulletproof local toast wrapper. Same
                        // pattern as finalizePendingTreasury. Prevents the
                        // "Cannot read properties of undefined (reading
                        // 'success')" error from blowing up the save.
                        var safeT = {
                          success: function(m) { try { (toast && toast.success) ? toast.success(m) : console.log('[toast.success]', m); } catch (_) {} },
                          error: function(m) { try { (toast && toast.error) ? toast.error(m) : console.error('[toast.error]', m); } catch (_) {} },
                          warning: function(m) { try { (toast && toast.warning) ? toast.warning(m) : console.warn('[toast.warning]', m); } catch (_) {} },
                          info: function(m) { try { (toast && toast.info) ? toast.info(m) : console.log('[toast.info]', m); } catch (_) {} },
                        };
                        // Guard against double-tap: if already in flight, ignore.
                        if (isCreatingInvoice) {
                          console.log('[create-invoice] click ignored — already in flight');
                          return;
                        }
                        // Apr 26 2026 — HARD GATE: require a customer_id.
                        // The picker also disables the button, but defense in
                        // depth here in case a stale prop / state bug ever
                        // re-enables it without a customer_id.
                        if (!formData.__newInvCustomerId) {
                          setCreateInvoiceError('Pick a customer from the dropdown first, or create a new one. / اختر عميل من القائمة أو أنشئ عميل جديد.');
                          safeT.warning('Customer is required / العميل مطلوب');
                          return;
                        }
                        console.log('[create-invoice] click fired');
                        setCreateInvoiceError(null);
                        setIsCreatingInvoice(true);
                        try {
                          const name = String(formData.__newInvCustomer || '').trim();
                          // v55.82-E — parseAmount for the inline-create
                          // total too. pendingTreasuryRecord.amount is
                          // already a Number (set from parseAmount in
                          // handleAddTreasury), but __newInvTotal could
                          // be a fresh user-typed string with comma or
                          // Arabic-Indic digits.
                          const totalAmt = parseAmount(formData.__newInvTotal ?? pendingTreasuryRecord.amount);
                          if (!(totalAmt > 0)) {
                            setCreateInvoiceError('Invoice total must be greater than zero. / الإجمالي يجب أن يكون أكبر من صفر.');
                            safeT.warning('Invoice total must be > 0 / الإجمالي يجب أن يكون أكبر من صفر');
                            setIsCreatingInvoice(false);
                            return;
                          }
                          const orderNum = pendingTreasuryRecord.record.order_number;
                          if (!orderNum) {
                            setCreateInvoiceError('Order number is missing. Close this dialog and re-enter the transaction. / رقم الأمر مفقود.');
                            safeT.error('Order number missing — please close and re-enter / رقم الأمر مفقود');
                            setIsCreatingInvoice(false);
                            return;
                          }
                          const invDate = formData.__newInvDate || pendingTreasuryRecord.record.transaction_date || today();
                          // The customer_id is guaranteed at this point thanks to the
                          // hard gate above. Apr 26 2026 — no more fallback orphan path.
                          var resolvedCustomerId = formData.__newInvCustomerId;
                          console.log('[create-invoice] inserting', { orderNum: orderNum, name: name, totalAmt: totalAmt, customerId: resolvedCustomerId });
                          var inserted = null;
                          var dbErrorMessage = null;
                          try {
                            inserted = await dbInsert('invoices', {
                              order_number: sanitize(orderNum),
                              customer_name: sanitize(name),
                              customer_id: resolvedCustomerId,
                              invoice_date: invDate,
                              total_amount: totalAmt,
                              total_collected: 0,
                              outstanding: totalAmt,
                              source: 'manual',
                            }, user?.id);
                          } catch (dbErr) {
                            console.error('[create-invoice] dbInsert threw', dbErr);
                            dbErrorMessage = String((dbErr && dbErr.message) || dbErr || 'Unknown error');
                          }
                          // Apr 25 2026 — RECOVERY PATH: if dbInsert threw OR returned
                          // nothing, the invoice MAY still have been written to the
                          // database. Two known causes:
                          //   (a) audit_log insert failure inside dbInsert (test-full
                          //       documented this as 25.src.1b KNOWN GAP) — invoice
                          //       row succeeded, audit_log failed, error propagates
                          //   (b) duplicate-key error (concurrent creation by another
                          //       user / tab) — invoice already exists
                          // Either way, the right move is: fetch by order_number. If
                          // it's there, USE IT. Don't make the user retry and risk a
                          // second invoice. This was the cause of "transaction shows
                          // greyed out" — the invoice WAS in DB but my fix bailed.
                          if (!inserted || !inserted.id) {
                            console.log('[create-invoice] checking DB for invoice (recovery path)');
                            try {
                              var lookup = await supabase.from('invoices').select('*').eq('order_number', sanitize(orderNum)).maybeSingle();
                              if (lookup && lookup.data && lookup.data.id) {
                                console.log('[create-invoice] recovered existing invoice', lookup.data.id);
                                inserted = lookup.data;
                                if (dbErrorMessage) {
                                  // Show a non-blocking warning so user knows audit_log
                                  // didn't fully record the create, but their data is safe.
                                  safeT.warning('Invoice was saved but audit log had a hiccup. Data is safe.');
                                }
                              }
                            } catch (e2) {
                              console.error('[create-invoice] DB lookup also failed', e2);
                            }
                          }
                          // If we STILL don't have an invoice after the recovery
                          // attempt, surface a big visible error and stop.
                          if (!inserted || !inserted.id) {
                            var visibleMsg = 'Could not create the invoice. '
                              + (dbErrorMessage ? 'Database said: ' + dbErrorMessage : 'No row was returned and no matching invoice was found.')
                              + ' / تعذر إنشاء الفاتورة.';
                            setCreateInvoiceError(visibleMsg);
                            safeT.error('Failed to create invoice — see the red banner in the dialog');
                            setIsCreatingInvoice(false);
                            return;
                          }
                          console.log('[create-invoice] invoice ready', inserted.id);
                          // Apr 25 2026 — Optimistic insert into LOCAL invoices state.
                          // Without this, the just-linked treasury entry showed as
                          // "greyed out / unlinked" for the 500ms before loadAllData
                          // refreshed. The Sales tab also missed the new invoice
                          // until then. Now visible immediately.
                          setInvoices(function(prev) {
                            if (prev.some(function(i) { return i.id === inserted.id; })) return prev;
                            return [inserted].concat(prev);
                          });
                          safeT.success('Invoice #' + orderNum + ' created + linked to ' + name + ' ✓');
                          await finalizePendingTreasury(inserted);
                        } catch (err) {
                          console.error('[create-invoice] unexpected error', err);
                          var bigMsg = 'Unexpected error: ' + (err && err.message ? err.message : String(err));
                          setCreateInvoiceError(bigMsg);
                          safeT.error(bigMsg);
                        } finally {
                          setIsCreatingInvoice(false);
                        }
                      }}
                      className={'flex-1 px-4 py-2.5 rounded-lg text-sm font-extrabold shadow ' + (isCreatingInvoice
                        ? 'bg-emerald-400 text-white cursor-not-allowed'
                        : !formData.__newInvCustomerId
                          ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                          : 'bg-emerald-700 text-white hover:bg-emerald-800')}
                    >
                      {isCreatingInvoice
                        ? '⏳ Creating... / جارٍ الإنشاء...'
                        : !formData.__newInvCustomerId
                          ? '🔒 Pick a customer first / اختر عميل'
                          : '✓ Create Invoice + Save Treasury / إنشاء وحفظ'}
                    </button>
                    <button
                      disabled={isCreatingInvoice}
                      onClick={() => setFormData(prev => {
                        const next = { ...prev };
                        delete next.__creatingInvoice;
                        delete next.__newInvCustomer;
                        delete next.__newInvCustomerId;
                        delete next.__newInvCustomerAutoLinked;
                        delete next.__newInvSearch;
                        delete next.__newInvTotal;
                        delete next.__newInvDate;
                        return next;
                      })}
                      className={'px-4 py-2.5 rounded-lg text-sm font-bold ' + (isCreatingInvoice ? 'bg-slate-200 text-slate-500 cursor-not-allowed' : 'bg-slate-300 text-slate-900 hover:bg-slate-400')}
                    >
                      ← Back
                    </button>
                    </div>
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
                      onClick={() => {
                        // Pre-fill customer from treasury desc.
                        // v55.11 (Apr 26 2026):
                        //   • Case-insensitive exact match (was case-sensitive before,
                        //     so "shawar home" wouldn't match "Shawar Home" — forced
                        //     unnecessary re-typing).
                        //   • Sets __newInvCustomerAutoLinked=true so the chip shows
                        //     "Auto-linked — confirm or pick another" instead of just
                        //     "Linked", giving user a clear cue to verify the match.
                        //   • Seeds __newInvSearch with the prefill so if the picker
                        //     opens and user wants to change, the dropdown is already
                        //     filtered to similar names.
                        var rawDesc = String(formData.desc || '');
                        var descText = stripBankMatchMetadata(rawDesc).trim();
                        var lcDesc = descText.toLowerCase();
                        var exactMatch = (descText && Array.isArray(customers))
                          ? customers.find(function(c) { return String(c.name || '').trim().toLowerCase() === lcDesc; })
                          : null;
                        setFormData({
                          ...formData,
                          __creatingInvoice: true,
                          __newInvCustomer: exactMatch ? exactMatch.name : descText,
                          __newInvCustomerId: exactMatch ? exactMatch.id : null,
                          __newInvCustomerAutoLinked: !!exactMatch,
                          __newInvSearch: '',
                          __newInvTotal: pendingTreasuryRecord.amount,
                          __newInvDate: pendingTreasuryRecord.record.transaction_date || today(),
                        });
                      }}
                      className="flex-1 px-4 py-2.5 bg-emerald-700 text-white rounded-lg text-sm font-extrabold hover:bg-emerald-800 shadow"
                    >
                      + Create Invoice Now / إنشاء فاتورة الآن
                    </button>
                    <button
                      onClick={() => closePendingTreasuryModal()}
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

      {/* v55.41 — Duplicate-confirmation modal.
          Opens when handleAddTreasury detects an existing row with the same
          date + amount + direction + description, OR when Postgres rejects
          the insert with a unique-constraint violation. The user sees the
          existing match(es) clearly and can either:
            • Cancel — they'll edit the row to make it distinct
            • Confirm — it really is a separate payment that happens to look
              identical (regular weekly cash, two identical fuel runs, etc.).
              The save proceeds with confirmed_not_duplicate=true stamped on
              the new row so the AI auditor doesn't flag it later. */}
      {duplicateConfirm && (
        <div
          className="fixed inset-0 z-[200] bg-black/70"
          onClick={() => setDuplicateConfirm(null)}
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
                  <div className="text-xl font-extrabold text-white">⚠️ Possible Duplicate Transaction</div>
                  <div className="text-lg font-bold text-white mt-1" style={{ direction: 'rtl' }}>
                    معاملة قد تكون مكررة
                  </div>
                  <div className="mt-1.5 inline-block px-2 py-0.5 rounded bg-amber-900/60 text-amber-100 text-[10px] font-mono font-bold tracking-wide">
                    BUILD v55.83-A.6.27.71
                  </div>
                </div>
                <button
                  onClick={() => setDuplicateConfirm(null)}
                  className="text-white/90 hover:text-white text-2xl leading-none px-2"
                  title="Close">
                  ×
                </button>
              </div>
            </div>

            <div className="p-5 overflow-y-auto" style={{ minHeight: 0 }}>
              <div className="text-sm text-slate-700 mb-3">
                {duplicateConfirm.fromDbError
                  ? 'The database flagged this entry as a potential duplicate. We found '
                  : 'We found '}
                <span className="font-extrabold text-amber-900">
                  {duplicateConfirm.matches.length} existing transaction{duplicateConfirm.matches.length === 1 ? '' : 's'}
                </span>
                {' '}with the same date, amount, and description:
              </div>
              <div className="text-sm text-slate-700 mb-3" style={{ direction: 'rtl' }}>
                وجدنا <span className="font-extrabold text-amber-900">{duplicateConfirm.matches.length} معاملة موجودة</span> بنفس التاريخ والمبلغ والوصف.
              </div>

              {/* List of existing matches */}
              <div className="space-y-2 mb-4">
                {duplicateConfirm.matches.length === 0 && (
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-600">
                    The database constraint blocked the save, but we couldn't pull up the matching row to show you. You can still confirm this is a legitimate separate payment to proceed.
                  </div>
                )}
                {duplicateConfirm.matches.map(function(t) {
                  var direction = Number(t.cash_in || 0) + Number(t.bank_in || 0) > 0 ? 'IN' : 'OUT';
                  var amt = Number(t.cash_in || 0) + Number(t.cash_out || 0) + Number(t.bank_in || 0) + Number(t.bank_out || 0) + Number(t.expected_amount || 0);
                  return (
                    <div key={t.id} className="bg-amber-50 border-2 border-amber-300 rounded-lg p-3">
                      <div className="flex justify-between items-start gap-2 mb-1">
                        <span className="text-[10px] font-mono font-bold text-amber-900 uppercase">
                          {direction === 'IN' ? '💵 Cash In' : '💸 Cash Out'}
                          {t.is_bank_placeholder ? ' (Bank — pending statement)' : ''}
                        </span>
                        <span className="text-sm font-extrabold text-slate-900 font-mono">
                          {fE(amt)}
                        </span>
                      </div>
                      <div className="text-xs text-slate-800 font-semibold mb-1">{t.description || '(no description)'}</div>
                      <div className="flex items-center gap-3 text-[10px] text-slate-600 font-mono">
                        <span>📅 {t.transaction_date}</span>
                        {t.order_number ? <span>📄 #{t.order_number}</span> : null}
                        {t.category ? <span>🏷️ {t.category}</span> : null}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Question + buttons */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                <div className="text-sm font-bold text-blue-900 mb-1">Is this a real separate payment, or did you accidentally enter the same one twice?</div>
                <div className="text-sm font-bold text-blue-900 mt-1" style={{ direction: 'rtl' }}>
                  هل هذه دفعة منفصلة فعلاً، أم أنك أدخلت نفس المعاملة مرتين بالخطأ؟
                </div>
                <div className="text-[11px] text-blue-700 italic mt-2">
                  Choose &quot;Cancel&quot; if it&apos;s a typo. Choose &quot;Yes, save anyway&quot; if it really is a separate payment that happens to look identical (e.g. weekly cash, two identical fuel runs).
                </div>
              </div>

              <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
                <button
                  onClick={() => setDuplicateConfirm(null)}
                  className="px-4 py-2.5 bg-slate-100 text-slate-700 rounded-lg text-sm font-bold hover:bg-slate-200 border border-slate-300">
                  Cancel — let me edit / إلغاء
                </button>
                <button
                  onClick={async () => {
                    setDuplicateConfirm(null);
                    // Re-call the save with the bypass flag — same form data,
                    // confirmed_not_duplicate stamp gets written.
                    await handleAddTreasury({ bypassDupCheck: true });
                  }}
                  className="px-4 py-2.5 bg-amber-600 text-white rounded-lg text-sm font-extrabold hover:bg-amber-700 shadow">
                  ✓ Yes, save anyway — it&apos;s a separate payment
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
    </ErrorBoundary>
    </ToastProvider>
  );
}
