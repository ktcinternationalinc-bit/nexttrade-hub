// v55.83-A — Inventory Tab (Stage 1)
// v55.83-A.6.21 — Stage B activated: Shipments + Inventory View + Movements
// v55.83-A.6.27 — Stage C+D activated: Layers ledger, per-SKU P&L,
//                  landed cost finalization (via shipment detail), sale
//                  deduction (via invoice line SKU linkage).
// v55.83-A.6.27.9 — Stage E + F activated: Adjustments + Reports.
//                   ALL 6 STAGES NOW SHIPPED.
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import MasterSKUList from './MasterSKUList';
import WarehouseSettings from './WarehouseSettings';
import ShipmentsManager from './ShipmentsManager';
import InventoryView from './InventoryView';
import MovementsLedger from './MovementsLedger';
import LayersLedger from './LayersLedger';
import InventoryPnL from './InventoryPnL';
import AdjustmentsManager from './AdjustmentsManager';
import InventoryReports from './InventoryReports';
import InventoryMasterAdmin from './InventoryMasterAdmin';
import InventoryProductMaster from './InventoryProductMaster';
import InventoryImportProducts from './InventoryImportProducts';
import InventoryReceiving from './InventoryReceiving';
import InventoryStockImport from './InventoryStockImport';
import InventoryMovementsLedger from './InventoryMovementsLedger';
import InventoryCostLayers from './InventoryCostLayers';
import InventoryAdjustments from './InventoryAdjustments';
import InventoryOverview from './InventoryOverview';
// v55.83-A.6.27.62 — new reports + warehouse advances subtabs
import InventoryPnLReports from './InventoryPnLReports';
import WarehouseAdvancesTab from './WarehouseAdvancesTab';
// v55.83-A.6.27.63 — FX rates admin + FX P&L report
import FxRatesPanel from './FxRatesPanel';
import FxPnLReport from './FxPnLReport';
import {
  canViewInventory,
  canSeeInventoryCosts,
  canSeeInventoryPnL,
} from '../lib/inventory-permissions';

var SUBTABS = [
  // v55.83-H — grouped navigation: each tab carries a `group` (core / import /
  // financial) and a clean emoji-free `name`. Grouping + monochrome labels make
  // the nav read as an executive command center rather than a colorful menu.
  // Old hidden subtabs (inventory/skus/shipments/layers/pnl/movements/adjustments/
  // reports) remain imported in code but have no nav entry.
  { id: 'overview',        group: 'core',      name: 'Overview',          label: '📊 Overview', stage: 'View', desc: 'One-screen view of current stock by Family, with cascading multi-level classification filters.' },
  { id: 'productmaster',   group: 'core',      name: 'Product List',      label: '🏷️ Product List', stage: 'Classification', desc: 'Define each product with classification + quick code + defaults' },
  { id: 'masterlists',     group: 'core',      name: 'Master Lists',      label: '🗂️ Master Lists', stage: 'Classification', desc: 'Manage the 8 classification levels (Product Family, Category, Grade, etc.) — super-admin only' },
  { id: 'importproducts',  group: 'core',      name: 'Import Products',   label: '📥 Import Products', stage: 'Classification', desc: 'Bulk-import products from an Excel file with template + preview + validation' },
  { id: 'warehouses',      group: 'core',      name: 'Warehouses',        label: '🏭 Warehouses', stage: 'A', desc: 'Physical stock locations' },
  { id: 'movementsledger', group: 'core',      name: 'Movements',         label: '📜 Movements', stage: 'Engine', desc: 'Append-only log of every stock change. Auto-populated when receipts are finalized.' },
  { id: 'adjustments',     group: 'core',      name: 'Adjustments',       label: '🔧 Adjustments', stage: 'Engine', desc: 'Damage / theft / count corrections, warehouse transfers, cost restatements.' },

  { id: 'receivestock',    group: 'import',    name: 'Inbound Shipments', label: '🚚 Inbound Shipments', stage: 'Receiving', desc: 'Record incoming shipments. Import a NEXPAC report inside a shipment to set its expected rolls/weights, then compare against actual.' },
  { id: 'importstock',     group: 'import',    name: 'Import Shipment',   label: '📦 Import Shipment', stage: 'Receiving', desc: 'One-time bulk import of existing inventory + shipment metadata from Excel.' },
  { id: 'costlayers',      group: 'import',    name: 'Cost Layers',       label: '🧱 Cost Layers', stage: 'Engine', desc: 'FIFO cost layers per product per warehouse. Stock-on-hand + inventory value.' },
  { id: 'advances',        group: 'import',    name: 'Advances',          label: '💵 Advances', stage: 'Reports', desc: 'Issue cash advances; track spending against each advance.' },

  { id: 'pnlreports',      group: 'financial', name: 'P&L Reports',       label: '💹 P&L Reports', stage: 'Reports', desc: 'Profit and Loss by product, category, warehouse, or period. Top movers + export.' },
  { id: 'fxrates',         group: 'financial', name: 'FX Rates',          label: '💱 FX Rates', stage: 'Reports', desc: 'Daily USD/EGP and other exchange rates. Used by FX P&L report.' },
  { id: 'fxpnl',           group: 'financial', name: 'FX P&L',            label: '💱 FX P&L', stage: 'Reports', desc: 'Separates real margin from currency-movement gain/loss.' },
];

var SUBTAB_GROUPS = [
  { key: 'core',      label: 'Core Inventory' },
  { key: 'import',    label: 'Import Operations' },
  { key: 'financial', label: 'Financial Intelligence' },
];

export default function InventoryTab({ userProfile, modulePerms, toast, isSuperAdmin }) {
  var [subtab, setSubtab] = useState('overview');

  // v55.83-A.6.27.44 — load SKUs + warehouses once at this level so Layers + P&L
  // subtabs don't each refetch.
  var [skus, setSkus] = useState([]);
  var [warehouses, setWarehouses] = useState([]);

  // v55.83-A.6.27.44a — Inventory Cutoff Date setting (admin panel).
  // When set, new invoices dated on/after this date are required to use inventory linkage.
  // When NULL (default), both manual and inventory-linked modes always allowed.
  // Only super_admin OR users with 'Adjust Inventory' permission can change this.
  var [cutoffDate, setCutoffDate] = useState(null);          // ISO date string or null
  var [cutoffLoading, setCutoffLoading] = useState(true);
  var [cutoffSaving, setCutoffSaving] = useState(false);
  var [cutoffPanelOpen, setCutoffPanelOpen] = useState(false);

  // Permission to edit the cutoff (matches the bilingual "Adjust Inventory" permission).
  var canManageCutoff = isSuperAdmin
    || (modulePerms && modulePerms['Adjust Inventory'] === true);

  useEffect(function () {
    var cancelled = false;
    async function loadCutoff() {
      try {
        var resp = await supabase
          .from('app_settings')
          .select('setting_value')
          .eq('setting_key', 'inventory_cutoff_date')
          .maybeSingle();
        if (cancelled) return;
        if (resp && resp.data && resp.data.setting_value) {
          var raw = resp.data.setting_value;
          // setting_value is text — could be JSON 'null', or a quoted/unquoted date string
          try {
            var parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'string' && /^\d{4}-\d{2}-\d{2}/.test(parsed)) {
              setCutoffDate(parsed.substring(0, 10));
            } else {
              setCutoffDate(null);
            }
          } catch (e) {
            // Not JSON — accept as raw date string
            if (/^\d{4}-\d{2}-\d{2}/.test(raw)) setCutoffDate(raw.substring(0, 10));
            else setCutoffDate(null);
          }
        } else {
          setCutoffDate(null);
        }
      } catch (e) {
        console.warn('[inventory] load cutoff failed:', e);
        if (!cancelled) setCutoffDate(null);
      } finally {
        if (!cancelled) setCutoffLoading(false);
      }
    }
    loadCutoff();
    return function () { cancelled = true; };
  }, []);

  async function saveCutoff(newValue) {
    // newValue: ISO date string "2026-06-01" OR null to clear
    setCutoffSaving(true);
    try {
      var jsonVal = newValue ? JSON.stringify(newValue) : 'null';
      // Try update first; fall back to insert if no row exists
      var existing = await supabase
        .from('app_settings')
        .select('id')
        .eq('setting_key', 'inventory_cutoff_date')
        .maybeSingle();
      if (existing && existing.data && existing.data.id) {
        var upd = await supabase
          .from('app_settings')
          .update({ setting_value: jsonVal })
          .eq('id', existing.data.id);
        if (upd.error) throw upd.error;
      } else {
        var ins = await supabase
          .from('app_settings')
          .insert({ setting_key: 'inventory_cutoff_date', setting_value: jsonVal });
        if (ins.error) throw ins.error;
      }
      setCutoffDate(newValue);
      if (toast && toast.success) {
        toast.success(newValue
          ? 'Inventory cutoff set to ' + newValue + ' — invoices on/after this date will require inventory linkage'
          : 'Inventory cutoff cleared — both modes always allowed');
      }
    } catch (e) {
      console.error('[inventory] saveCutoff failed:', e);
      if (toast && toast.error) toast.error('Failed to save cutoff: ' + ((e && e.message) || String(e)));
    } finally {
      setCutoffSaving(false);
    }
  }

  useEffect(function () {
    var cancelled = false;
    async function load() {
      try {
        var [sResp, wResp] = await Promise.all([
          supabase.from('inv_skus').select('*').is('deleted_at', null).order('sku_number'),
          supabase.from('inv_warehouses').select('*').eq('is_active', true).order('name'),
        ]);
        if (cancelled) return;
        setSkus(sResp.data || []);
        setWarehouses(wResp.data || []);
      } catch (e) {}
    }
    load();
    return function () { cancelled = true; };
  }, []);

  if (!canViewInventory(userProfile, modulePerms)) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
        <div className="text-3xl mb-2">🔒</div>
        <div className="text-sm font-bold text-amber-900 mb-1">Inventory access required</div>
        <div className="text-xs text-amber-800">
          Ask a super admin to grant you the <strong>Inventory</strong> permission in Settings.
        </div>
      </div>
    );
  }

  var seeCosts = canSeeInventoryCosts(userProfile, modulePerms);
  var seePnL = canSeeInventoryPnL(userProfile, modulePerms);

  return (
    <div className="space-y-4">
      {/* Header strip — v55.83-A.6.27.72 HOTFIX 29 — Per Max May 28 2026 screenshot:
          the old `bg-gradient-to-r from-indigo-50 via-blue-50 to-cyan-50` rendered as
          BRIGHT pastel because gradients bypass the dark-theme bg-X-50 overrides in
          globals.css. Combined with the dark theme auto-brightening `text-slate-900`,
          the title vanished entirely (white-on-pastel). Replaced with a dark slate-to-
          indigo gradient that fits the theme, with explicit bright text colors that
          stand out on the dark surface. */}
      <div className="bg-gradient-to-r from-slate-800 via-indigo-900 to-slate-800 rounded-xl p-4 border border-indigo-500/30 shadow-lg">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-xl font-extrabold text-white">📦 Inventory</h2>
            <p className="text-xs text-indigo-200 font-medium">
              Track every shipment from arrival through sale. Costs, stock, and profit in one place.
            </p>
          </div>
          <div className="flex items-center gap-1 text-[11px]">
            <span className="px-2 py-1 rounded bg-emerald-600 text-white font-extrabold ring-1 ring-emerald-700/50 shadow-sm">
              v55.83-A.6.27.45 · Invoice variant picker
            </span>
            {seePnL && (
              <span className="px-2 py-0.5 rounded bg-emerald-600 text-white font-extrabold ring-1 ring-emerald-700/50 shadow-sm">
                P&L access
              </span>
            )}
            {seeCosts && !seePnL && (
              <span className="px-2 py-0.5 rounded bg-amber-600 text-white font-extrabold ring-1 ring-amber-700/50 shadow-sm">
                Cost access
              </span>
            )}
          </div>
        </div>
      </div>

      {/* v55.83-A.6.27.44a — INVENTORY CUTOFF DATE admin panel (super_admin OR Adjust Inventory only).
          When set, new invoices on/after this date will be required to use inventory linkage.
          Sits between header and subtab nav so it's discoverable but not in the way. */}
      {canManageCutoff && (
        <div className="bg-white border-2 border-indigo-200 rounded-xl overflow-hidden">
          <button
            onClick={function () { setCutoffPanelOpen(!cutoffPanelOpen); }}
            className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-indigo-50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-base">⚙️</span>
              <div className="text-left">
                <div className="text-sm font-extrabold text-slate-900">
                  Inventory Cutoff Date <span className="text-slate-500 font-normal">/</span> <span style={{ direction: 'rtl' }}>تاريخ بدء ربط المخزون</span>
                </div>
                <div className="text-[11px] text-slate-600 font-semibold">
                  {cutoffLoading
                    ? 'Loading… / جاري التحميل…'
                    : (cutoffDate
                        ? '🟢 Active from ' + cutoffDate + ' / نشط من ' + cutoffDate
                        : '⚪ Not set — both modes always allowed / غير محدد — كلا الوضعين متاحان')}
                </div>
              </div>
            </div>
            <span className="text-slate-500 text-xs font-bold">{cutoffPanelOpen ? '▲' : '▼'}</span>
          </button>
          {cutoffPanelOpen && (
            <div className="border-t-2 border-indigo-200 bg-indigo-50 px-4 py-3 space-y-3">
              <div className="text-xs text-slate-800 font-semibold leading-relaxed">
                When set, invoices dated <strong>on or after</strong> this date will be required to use inventory linkage (pick a warehouse and variant, with FIFO consumption on submit). Invoices dated <strong>before</strong> this date can still use manual entry. Leave blank to allow both modes for all dates.
                <br /><br />
                <span style={{ direction: 'rtl' }} className="block">
                  عند تحديد هذا التاريخ، يجب على الفواتير المؤرخة في هذا التاريخ أو بعده استخدام ربط المخزون (اختيار مستودع ومنتج، مع خصم FIFO عند الإرسال). الفواتير المؤرخة قبل هذا التاريخ يمكن أن تستخدم الإدخال اليدوي. اتركه فارغًا للسماح بكلا الوضعين لجميع التواريخ.
                </span>
              </div>
              <div className="flex items-end gap-2 flex-wrap">
                <label className="text-xs font-extrabold text-slate-900">
                  Cutoff Date / التاريخ
                  <input
                    type="date"
                    value={cutoffDate || ''}
                    onChange={function (e) {
                      // Just stage the value; user must click Save to commit
                      setCutoffDate(e.target.value || null);
                    }}
                    disabled={cutoffSaving}
                    className="block mt-1 px-3 py-2 border-2 border-slate-300 rounded text-sm bg-white text-slate-900 font-bold"
                  />
                </label>
                <button
                  onClick={function () { saveCutoff(cutoffDate); }}
                  disabled={cutoffSaving || cutoffLoading}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-extrabold rounded-lg shadow"
                >
                  {cutoffSaving ? 'Saving… / حفظ…' : '💾 Save / حفظ'}
                </button>
                <button
                  onClick={function () { saveCutoff(null); }}
                  disabled={cutoffSaving || cutoffLoading || !cutoffDate}
                  className="px-4 py-2 bg-slate-300 hover:bg-slate-400 disabled:opacity-50 text-slate-900 text-sm font-bold rounded-lg"
                  title="Clear the cutoff. Both modes will be allowed for all dates."
                >
                  Clear / مسح
                </button>
              </div>
              {!isSuperAdmin && (
                <div className="text-[10px] text-amber-800 font-semibold italic">
                  ⚠ You have Adjust Inventory permission. Changes affect all invoice creation going forward.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Subtab nav — v55.83-H: grouped into Core Inventory / Import Operations /
          Financial Intelligence with clean (emoji-free) labels. All permission
          gating is preserved via the visibility helper below. */}
      <div className="bg-slate-50 rounded-lg p-2 border border-slate-200 space-y-2">
        {(function () {
          // Returns { hidden, available } for a subtab, applying the same
          // permission rules as before.
          function visFor(st) {
            var available = true;
            if (st.id === 'pnl' && !seePnL) available = false;
            if (st.id === 'layers' && !seeCosts && !seePnL) available = false;
            if (st.id === 'masterlists' && !(isSuperAdmin || (modulePerms && modulePerms['Manage Inventory Master'] === true))) return { hidden: true };
            if (st.id === 'productmaster' && !(isSuperAdmin || (modulePerms && (modulePerms['Inventory'] === true || modulePerms['Edit Product List'] === true)))) return { hidden: true };
            if (st.id === 'importproducts' && !(isSuperAdmin || (modulePerms && modulePerms['Edit Product List'] === true))) return { hidden: true };
            if (st.id === 'receivestock' && !(isSuperAdmin || (modulePerms && (modulePerms['Inventory'] === true || modulePerms['Edit Inventory'] === true)))) return { hidden: true };
            if (st.id === 'importstock' && !(isSuperAdmin || (modulePerms && modulePerms['Edit Inventory'] === true))) return { hidden: true };
            if ((st.id === 'movementsledger' || st.id === 'costlayers') && !(isSuperAdmin || (modulePerms && (modulePerms['Inventory'] === true || modulePerms['Edit Inventory'] === true)))) return { hidden: true };
            if (st.id === 'adjustments' && !(isSuperAdmin || (modulePerms && (modulePerms['Inventory'] === true || modulePerms['Edit Inventory'] === true)))) return { hidden: true };
            return { hidden: false, available: available };
          }
          return SUBTAB_GROUPS.map(function (grp) {
            var tabsInGroup = SUBTABS.filter(function (st) { return st.group === grp.key; })
              .map(function (st) { return { st: st, vis: visFor(st) }; })
              .filter(function (x) { return !x.vis.hidden; });
            if (tabsInGroup.length === 0) return null;
            return (
              <div key={grp.key}>
                <div className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-slate-400 px-1 mb-1">{grp.label}</div>
                <div className="flex gap-1 flex-wrap">
                  {tabsInGroup.map(function (x) {
                    var st = x.st;
                    var available = x.vis.available !== false;
                    var isActive = subtab === st.id;
                    return (
                      <button key={st.id}
                        onClick={function () { if (available) setSubtab(st.id); }}
                        disabled={!available}
                        title={available ? st.desc : (st.id === 'pnl' ? 'Requires P&L permission' : st.id === 'layers' ? 'Requires cost access' : 'Coming in Stage ' + st.stage)}
                        className={'px-3 py-1.5 rounded-md text-xs font-bold transition '
                          + (isActive
                            ? 'bg-indigo-600 text-white shadow'
                            : available
                              ? 'text-slate-700 hover:bg-white border border-transparent hover:border-slate-200'
                              : 'text-slate-400 cursor-not-allowed')}>
                        {st.name}
                        {!available && <span className="ml-1 text-[9px] opacity-60">· Stage {st.stage}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          });
        })()}
      </div>

      {/* Subtab content */}
      {subtab === 'skus' && (
        <MasterSKUList userProfile={userProfile} modulePerms={modulePerms} toast={toast} />
      )}
      {subtab === 'warehouses' && (
        <WarehouseSettings userProfile={userProfile} modulePerms={modulePerms} toast={toast} />
      )}
      {subtab === 'inventory' && (
        <InventoryView userProfile={userProfile} modulePerms={modulePerms} toast={toast} />
      )}
      {subtab === 'shipments' && (
        <ShipmentsManager userProfile={userProfile} modulePerms={modulePerms} toast={toast} />
      )}
      {subtab === 'movements' && (
        <MovementsLedger userProfile={userProfile} modulePerms={modulePerms} toast={toast} />
      )}
      {subtab === 'layers' && (
        <LayersLedger skus={skus} warehouses={warehouses} toast={toast} />
      )}
      {subtab === 'pnl' && (
        <InventoryPnL skus={skus} toast={toast} />
      )}
      {/* v55.83-T — System B AdjustmentsManager (writes inv_layers) REMOVED.
          The live Adjustments tab now renders ONLY System A's InventoryAdjustments
          (see subtab === 'adjustments' below), so adjustments hit the same engine
          as receiving, sales, and the dashboard. */}
      {subtab === 'reports' && (
        <InventoryReports skus={skus} warehouses={warehouses} toast={toast} />
      )}
      {/* v55.83-A.6.27.51 — Inventory Overview (new default landing) */}
      {subtab === 'overview' && (
        <InventoryOverview userProfile={userProfile} modulePerms={modulePerms} isSuperAdmin={isSuperAdmin} toast={toast} />
      )}
      {/* v55.83-A.6.27.22 — Phase 1 Build 1: Master Lists admin */}
      {subtab === 'masterlists' && (
        <InventoryMasterAdmin userProfile={userProfile} modulePerms={modulePerms} isSuperAdmin={isSuperAdmin} toast={toast} />
      )}
      {/* v55.83-A.6.27.23 — Phase 1 Build 2: Product List catalog */}
      {subtab === 'productmaster' && (
        <InventoryProductMaster userProfile={userProfile} modulePerms={modulePerms} isSuperAdmin={isSuperAdmin} toast={toast} />
      )}
      {/* v55.83-A.6.27.28 — Phase 1 Build 3: Bulk Import Products */}
      {subtab === 'importproducts' && (
        <InventoryImportProducts userProfile={userProfile} modulePerms={modulePerms} isSuperAdmin={isSuperAdmin} toast={toast} />
      )}
      {/* v55.83-A.6.27.29 — Phase 1 Build 4.0: Inbound Shipments */}
      {subtab === 'receivestock' && (
        <InventoryReceiving userProfile={userProfile} modulePerms={modulePerms} isSuperAdmin={isSuperAdmin} toast={toast} />
      )}
      {/* v55.83-A.6.27.30 — Phase 1 Build 4.5: Bulk Import Legacy Stock */}
      {subtab === 'importstock' && (
        <InventoryStockImport userProfile={userProfile} modulePerms={modulePerms} isSuperAdmin={isSuperAdmin} toast={toast} />
      )}
      {/* v55.83-A.6.27.34 — Phase 1 Build 4.3: Movements Ledger (read-only) */}
      {subtab === 'movementsledger' && (
        <InventoryMovementsLedger userProfile={userProfile} modulePerms={modulePerms} isSuperAdmin={isSuperAdmin} toast={toast} />
      )}
      {/* v55.83-A.6.27.34 — Phase 1 Build 4.3: Cost Layers (read-only) */}
      {subtab === 'costlayers' && (
        <InventoryCostLayers userProfile={userProfile} modulePerms={modulePerms} isSuperAdmin={isSuperAdmin} toast={toast} />
      )}
      {/* v55.83-A.6.27.36 — Phase 1 Build 4.5: Adjustments */}
      {subtab === 'adjustments' && (
        <InventoryAdjustments userProfile={userProfile} modulePerms={modulePerms} isSuperAdmin={isSuperAdmin} toast={toast} />
      )}

      {/* v55.83-A.6.27.62 — Inventory P&L Reports */}
      {subtab === 'pnlreports' && (
        <InventoryPnLReports userProfile={userProfile} modulePerms={modulePerms} isSuperAdmin={isSuperAdmin} toast={toast} />
      )}
      {/* v55.83-A.6.27.62 — Warehouse Advances workflow */}
      {subtab === 'advances' && (
        <WarehouseAdvancesTab userProfile={userProfile} toast={toast} canEdit={isSuperAdmin || (modulePerms && modulePerms['Edit Inventory'] === true)} />
      )}

      {/* v55.83-A.6.27.63 — FX Rates admin */}
      {subtab === 'fxrates' && (
        <FxRatesPanel userProfile={userProfile} toast={toast} canEdit={isSuperAdmin || (modulePerms && modulePerms['Edit Treasury'] === true)} />
      )}
      {/* v55.83-A.6.27.63 — FX P&L report (real margin vs FX gain/loss) */}
      {subtab === 'fxpnl' && (
        <FxPnLReport userProfile={userProfile} modulePerms={modulePerms} isSuperAdmin={isSuperAdmin} toast={toast} />
      )}

      {/* v55.83-A.6.27.60 — Removed stale "What's in this build" details panel.
          Release notes belong in the WhatsNewWidget popup (top-right version pill),
          not duplicated on each tab page. Cleaner, less noisy. */}
    </div>
  );
}
