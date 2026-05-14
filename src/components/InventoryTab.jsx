// v55.83-A — Inventory Tab (Stage 1)
// v55.83-A.6.21 — Stage B activated: Shipments + Inventory View + Movements
//
// Stage 1 (A): Master SKUs + Warehouses
// Stage 2 (B): Shipments form/list/receive, Inventory pivot, Movements ledger,
//              Reconciliation per shipment line item
// Stage 3-6: Landed cost, P&L, adjustments, reports — future builds
import { useState } from 'react';
import MasterSKUList from './MasterSKUList';
import WarehouseSettings from './WarehouseSettings';
import ShipmentsManager from './ShipmentsManager';
import InventoryView from './InventoryView';
import MovementsLedger from './MovementsLedger';
import {
  canViewInventory,
  canSeeInventoryCosts,
  canSeeInventoryPnL,
} from '../lib/inventory-permissions';

var SUBTABS = [
  { id: 'inventory', label: '📊 Inventory View', stage: 'B', desc: 'Master inventory with current quantities by SKU + warehouse' },
  { id: 'skus', label: '📦 Master SKUs', stage: 'A', desc: 'Define the products you stock' },
  { id: 'shipments', label: '🚢 Shipments', stage: 'B', desc: 'Receive inventory from suppliers' },
  { id: 'movements', label: '📜 Movements', stage: 'B', desc: 'Every stock change, append-only ledger' },
  { id: 'adjustments', label: '🔧 Adjustments', stage: 'E', desc: 'Damage, returns, transfers, count corrections' },
  { id: 'warehouses', label: '🏭 Warehouses', stage: 'A', desc: 'Physical stock locations' },
  { id: 'reports', label: '📈 Reports', stage: 'F', desc: 'Profitability, aging, slow-moving' },
];

export default function InventoryTab({ userProfile, modulePerms, toast }) {
  // v55.83-A.6.21 — Stage B ships, so default landing is the Inventory pivot view
  // (it's the most useful "where is my stock right now?" surface). User can still
  // jump to skus/warehouses/shipments via the subtab nav.
  var [subtab, setSubtab] = useState('inventory');

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
            <span className="px-2 py-0.5 rounded bg-blue-200 text-blue-900 font-bold">
              v55.83-A.6.21 · Stage 2 of 6
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
          // v55.83-A.6.21 — Stage B (Inventory View, Shipments, Movements) is now active.
          var available = st.stage === 'A' || st.stage === 'B';
          var isActive = subtab === st.id;
          return (
            <button key={st.id}
              onClick={function () { if (available) setSubtab(st.id); }}
              disabled={!available}
              title={available ? st.desc : ('Coming in Stage ' + st.stage)}
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
      {/* v55.83-A.6.21 — Stage B components */}
      {subtab === 'inventory' && (
        <InventoryView userProfile={userProfile} modulePerms={modulePerms} toast={toast} />
      )}
      {subtab === 'shipments' && (
        <ShipmentsManager userProfile={userProfile} modulePerms={modulePerms} toast={toast} />
      )}
      {subtab === 'movements' && (
        <MovementsLedger userProfile={userProfile} modulePerms={modulePerms} toast={toast} />
      )}

      {/* Coming-soon placeholders for Stage E+ only (adjustments, reports) */}
      {['adjustments', 'reports'].indexOf(subtab) >= 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 text-center">
          <div className="text-3xl mb-2">🚧</div>
          <div className="text-sm font-bold text-blue-900 mb-1">Coming in Stage {SUBTABS.find(function (s) { return s.id === subtab; }).stage}</div>
          <div className="text-xs text-blue-800 max-w-md mx-auto">
            {subtab === 'adjustments' && 'Damage, returns, transfers, and physical count corrections will live here (Stage E).'}
            {subtab === 'reports' && 'Profitability, aging, and slow-moving inventory reports come in Stage F.'}
          </div>
        </div>
      )}

      {/* Stage 1 guidance */}
      <details className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs">
        <summary className="font-bold text-slate-700 cursor-pointer">
          ℹ️ What's in this build (v55.83-A.6.21 · Stage 2 of 6)
        </summary>
        <div className="mt-2 space-y-2 text-slate-600 leading-relaxed">
          <p>
            <strong>Stage 2 (B) adds operational inventory.</strong> You can now create shipments, track them from draft → in transit → arrived → received, add SKU line items with multi-unit quantities, reconcile expected vs actual on receipt, see current stock pivoted by SKU × Warehouse, and audit every movement.
          </p>
          <p className="font-semibold text-slate-700">Roadmap:</p>
          <ul className="space-y-1 pl-4">
            {SUBTABS.map(function (st) {
              var done = st.stage === 'A' || st.stage === 'B';
              return (
                <li key={st.id} className={done ? 'text-emerald-700' : ''}>
                  <strong>Stage {st.stage}:</strong> {st.desc}
                  {done && <span className="ml-1">✓ shipped</span>}
                </li>
              );
            })}
          </ul>
          <p className="text-[10px] text-slate-500 mt-2">
            <strong>Setup:</strong> If you haven't run the inventory schema yet, run <code>sql/v55-83-a-inventory-schema.sql</code> in Supabase. For reconciliation columns, also run the v55.83-A.6.21 SQL inline in chat.
          </p>
        </div>
      </details>
    </div>
  );
}
