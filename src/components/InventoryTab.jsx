// v55.83-A — Inventory Tab (Stage 1)
//
// Replaces the legacy inline inventory section in page.jsx. Stage 1 ships:
//   • Master SKU list (CRUD)
//   • Warehouse management (CRUD)
//   • Coming-soon placeholders for Shipments, Inventory View, Movements, Reports
//
// Future stages will fill in those placeholders without restructuring this tab.
import { useState } from 'react';
import MasterSKUList from './MasterSKUList';
import WarehouseSettings from './WarehouseSettings';
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
  // Default to Master SKUs since Inventory View needs Stage B before it has data
  var [subtab, setSubtab] = useState('skus');

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
              v55.83-A · Stage 1 of 6
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
          var available = st.stage === 'A';
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

      {/* Coming-soon placeholders for Stage B+ */}
      {['inventory','shipments','movements','adjustments','reports'].indexOf(subtab) >= 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 text-center">
          <div className="text-3xl mb-2">🚧</div>
          <div className="text-sm font-bold text-blue-900 mb-1">Coming in a future build</div>
          <div className="text-xs text-blue-800 max-w-md mx-auto">
            This section is part of Stage {SUBTABS.find(function (s) { return s.id === subtab; }).stage} of the new inventory module. For now, use the <strong>Master SKUs</strong> and <strong>Warehouses</strong> tabs above to set up your product database and physical locations.
          </div>
        </div>
      )}

      {/* Stage 1 guidance */}
      <details className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs">
        <summary className="font-bold text-slate-700 cursor-pointer">
          ℹ️ What's in this build (v55.83-A · Stage 1 of 6)
        </summary>
        <div className="mt-2 space-y-2 text-slate-600 leading-relaxed">
          <p>
            <strong>Stage 1 is the foundation.</strong> You can set up your product database (SKUs) and physical locations (Warehouses). Stock quantities, shipments, and P&L all come in later stages.
          </p>
          <p className="font-semibold text-slate-700">Roadmap:</p>
          <ul className="space-y-1 pl-4">
            {SUBTABS.map(function (st) {
              return (
                <li key={st.id} className={st.stage === 'A' ? 'text-emerald-700' : ''}>
                  <strong>Stage {st.stage}:</strong> {st.desc}
                  {st.stage === 'A' && <span className="ml-1">✓ shipped</span>}
                </li>
              );
            })}
          </ul>
        </div>
      </details>
    </div>
  );
}
