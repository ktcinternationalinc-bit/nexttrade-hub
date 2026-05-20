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
import {
  canViewInventory,
  canSeeInventoryCosts,
  canSeeInventoryPnL,
} from '../lib/inventory-permissions';

var SUBTABS = [
  // v55.83-A.6.27.32 — old-system subtabs HIDDEN from nav (Max never used
  // them; new Phase 1 system replaces them). Components stay imported and
  // in code for the eventual cleanup build, but no nav entries point here.
  // Old tabs that were hidden: inventory (view), skus (Master SKUs),
  // shipments, layers (Cost Layers), pnl (Profit by SKU), movements,
  // adjustments, reports. These will be rebuilt in Builds 4.2-5 against
  // the new Product Master.
  // { id: 'inventory', label: '📊 Inventory View', stage: 'B', desc: '...' },
  // { id: 'skus', label: '📦 Master SKUs', stage: 'A', desc: '...' },
  // { id: 'shipments', label: '🚢 Shipments', stage: 'B', desc: '...' },
  // { id: 'layers', label: '🧱 Cost Layers', stage: 'C', desc: '...' },
  // { id: 'pnl', label: '💵 Profit by SKU', stage: 'D', desc: '...' },
  // { id: 'movements', label: '📜 Movements', stage: 'B', desc: '...' },
  // { id: 'adjustments', label: '🔧 Adjustments', stage: 'E', desc: '...' },
  // { id: 'reports', label: '📈 Reports', stage: 'F', desc: '...' },
  { id: 'warehouses', label: '🏭 Warehouses', stage: 'A', desc: 'Physical stock locations' },
  // v55.83-A.6.27.22 — Phase 1 Build 1 of the classification system
  { id: 'masterlists', label: '🗂️ Master Lists', stage: 'Classification', desc: 'Manage the 8 classification levels (Product Family, Category, Grade, etc.) — super-admin only' },
  // v55.83-A.6.27.23 — Phase 1 Build 2: Product Master catalog
  { id: 'productmaster', label: '🏷️ Product Master', stage: 'Classification', desc: 'Define each product with classification + quick code + defaults' },
  // v55.83-A.6.27.28 — Phase 1 Build 3: Bulk import products from Excel
  { id: 'importproducts', label: '📥 Import Products', stage: 'Classification', desc: 'Bulk-import products from an Excel file with template + preview + validation' },
  // v55.83-A.6.27.29 — Phase 1 Build 4.0: Receive Stock (warehouse receiving)
  { id: 'receivestock', label: '🚚 Receive Stock', stage: 'Receiving', desc: 'Record incoming shipments. Multi-line per receipt with autofill from Product Master.' },
  // v55.83-A.6.27.30 — Phase 1 Build 4.5: Bulk import legacy stock
  { id: 'importstock', label: '📦 Import Stock', stage: 'Receiving', desc: 'One-time bulk import of existing inventory from Excel.' },
  // v55.83-A.6.27.34 — Phase 1 Build 4.3: Movements Ledger + FIFO Cost Layers (engine)
  { id: 'movementsledger', label: '📜 Movements', stage: 'Engine', desc: 'Append-only log of every stock change. Auto-populated when receipts are finalized.' },
  { id: 'costlayers',      label: '🧱 Cost Layers', stage: 'Engine', desc: 'FIFO cost layers per product per warehouse. Stock-on-hand + inventory value.' },
  // v55.83-A.6.27.36 — Phase 1 Build 4.5: Adjustments (qty / transfer / cost)
  { id: 'adjustments',     label: '🔧 Adjustments', stage: 'Engine', desc: 'Damage / theft / count corrections, warehouse transfers, cost restatements.' },
];

export default function InventoryTab({ userProfile, modulePerms, toast, isSuperAdmin }) {
  var [subtab, setSubtab] = useState('inventory');

  // v55.83-A.6.27 — load SKUs + warehouses once at this level so Layers + P&L
  // subtabs don't each refetch.
  var [skus, setSkus] = useState([]);
  var [warehouses, setWarehouses] = useState([]);
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
      {/* Header strip */}
      <div className="bg-gradient-to-r from-indigo-50 via-blue-50 to-cyan-50 rounded-xl p-4 border border-blue-100">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-xl font-extrabold text-slate-900">📦 Inventory</h2>
            <p className="text-xs text-slate-600">
              Track every shipment from arrival through sale. Costs, stock, and profit in one place.
            </p>
          </div>
          <div className="flex items-center gap-1 text-[10px]">
            <span className="px-2 py-0.5 rounded bg-emerald-200 text-emerald-900 font-bold">
              v55.83-A.6.27.9 · Stage 6 of 6 — COMPLETE ✓
            </span>
            {seePnL && (
              <span className="px-2 py-0.5 rounded bg-emerald-200 text-emerald-900 font-bold">
                P&L access
              </span>
            )}
            {seeCosts && !seePnL && (
              <span className="px-2 py-0.5 rounded bg-amber-200 text-amber-900 font-bold">
                Cost access
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Subtab nav */}
      <div className="flex gap-1 flex-wrap bg-slate-50 rounded-lg p-1 border border-slate-200">
        {SUBTABS.map(function (st) {
          // v55.83-A.6.27.9 — ALL stages now active.
          var available = true;
          // P&L tab requires the per-user pnl access permission
          if (st.id === 'pnl' && !seePnL) available = false;
          // Layers tab requires cost access (P&L access implies cost access)
          if (st.id === 'layers' && !seeCosts && !seePnL) available = false;
          // v55.83-A.6.27.22 — Master Lists tab requires super_admin or
          // "Manage Inventory Master" permission. Hidden entirely for
          // users without it (not just disabled) — this is admin-only.
          if (st.id === 'masterlists' && !(isSuperAdmin || (modulePerms && modulePerms['Manage Inventory Master'] === true))) {
            return null;
          }
          // v55.83-A.6.27.23 — Product Master tab visible to anyone with
          // Inventory access (read-only) or super_admin / Edit Product
          // Master (full CRUD). Component itself handles edit-gating.
          if (st.id === 'productmaster' && !(isSuperAdmin || (modulePerms && (modulePerms['Inventory'] === true || modulePerms['Edit Product Master'] === true)))) {
            return null;
          }
          // v55.83-A.6.27.28 — Import Products tab requires Edit Product
          // Master (same as creating individual products). Hidden if no
          // perm. This is a heavy-impact action — strict gate.
          if (st.id === 'importproducts' && !(isSuperAdmin || (modulePerms && modulePerms['Edit Product Master'] === true))) {
            return null;
          }
          // v55.83-A.6.27.29 — Receive Stock tab visible to anyone with
          // Inventory access (read-only) or super_admin / Edit Inventory
          // (full CRUD). Cost fields inside the component are gated
          // separately by canSeeInventoryCosts.
          if (st.id === 'receivestock' && !(isSuperAdmin || (modulePerms && (modulePerms['Inventory'] === true || modulePerms['Edit Inventory'] === true)))) {
            return null;
          }
          // v55.83-A.6.27.30 — Import Stock tab gated to super_admin OR
          // Edit Inventory (same as Receive Stock — both write to the
          // same table). Cost columns in the template/preview are gated
          // separately by canSeeInventoryCosts inside the component.
          if (st.id === 'importstock' && !(isSuperAdmin || (modulePerms && modulePerms['Edit Inventory'] === true))) {
            return null;
          }
          // v55.83-A.6.27.34 — Movements Ledger + Cost Layers: read-only views.
          // Available to anyone with Inventory access (read-only) or super_admin
          // / Edit Inventory. Cost columns inside each component are gated
          // separately by canSeeInventoryCosts.
          if ((st.id === 'movementsledger' || st.id === 'costlayers') &&
              !(isSuperAdmin || (modulePerms && (modulePerms['Inventory'] === true || modulePerms['Edit Inventory'] === true)))) {
            return null;
          }
          // v55.83-A.6.27.36 — Adjustments tab: view requires Inventory; creating requires Edit Inventory (handled in component)
          if (st.id === 'adjustments' &&
              !(isSuperAdmin || (modulePerms && (modulePerms['Inventory'] === true || modulePerms['Edit Inventory'] === true)))) {
            return null;
          }
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
                    ? 'text-slate-700 hover:bg-white'
                    : 'text-slate-400 cursor-not-allowed')}>
              {st.label}
              {!available && <span className="ml-1 text-[9px] opacity-60">· Stage {st.stage}</span>}
            </button>
          );
        })}
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
      {/* v55.83-A.6.27.9 — Stage E + F live */}
      {subtab === 'adjustments' && (
        <AdjustmentsManager skus={skus} warehouses={warehouses} userProfile={userProfile} modulePerms={modulePerms} toast={toast} />
      )}
      {subtab === 'reports' && (
        <InventoryReports skus={skus} warehouses={warehouses} toast={toast} />
      )}
      {/* v55.83-A.6.27.22 — Phase 1 Build 1: Master Lists admin */}
      {subtab === 'masterlists' && (
        <InventoryMasterAdmin userProfile={userProfile} modulePerms={modulePerms} isSuperAdmin={isSuperAdmin} toast={toast} />
      )}
      {/* v55.83-A.6.27.23 — Phase 1 Build 2: Product Master catalog */}
      {subtab === 'productmaster' && (
        <InventoryProductMaster userProfile={userProfile} modulePerms={modulePerms} isSuperAdmin={isSuperAdmin} toast={toast} />
      )}
      {/* v55.83-A.6.27.28 — Phase 1 Build 3: Bulk Import Products */}
      {subtab === 'importproducts' && (
        <InventoryImportProducts userProfile={userProfile} modulePerms={modulePerms} isSuperAdmin={isSuperAdmin} toast={toast} />
      )}
      {/* v55.83-A.6.27.29 — Phase 1 Build 4.0: Receive Stock */}
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

      {/* Stage guidance */}
      <details className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs">
        <summary className="font-bold text-slate-700 cursor-pointer">
          ℹ️ What's in this build (v55.83-A.6.27.9 · Stage 6 of 6 — ALL STAGES SHIPPED)
        </summary>
        <div className="mt-2 space-y-2 text-slate-600 leading-relaxed">
          <p>
            <strong>The inventory module is complete.</strong> All six stages
            have shipped: master SKUs &amp; warehouses (A), shipments &amp;
            movements (B), landed cost finalization (C), FIFO sale deduction
            &amp; P&amp;L (D), adjustments with approval workflow (E), and
            operational reports — stock value, aging, slow-moving (F).
          </p>
          <p className="font-semibold text-slate-700">All stages:</p>
          <ul className="space-y-1 pl-4">
            {SUBTABS.map(function (st) {
              return (
                <li key={st.id} className="text-emerald-700">
                  <strong>Stage {st.stage}:</strong> {st.desc} ✓ shipped
                </li>
              );
            })}
          </ul>
        </div>
      </details>
    </div>
  );
}
