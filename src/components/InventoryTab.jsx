// v55.83-A — Inventory Tab (Stage 1)
// v55.83-A.6.21 — Stage B activated: Shipments + Inventory View + Movements
// v55.83-A.6.27 — Stage C+D activated: Layers ledger, per-SKU P&L,
//                  landed cost finalization (via shipment detail), sale
//                  deduction (via invoice line SKU linkage).
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import MasterSKUList from './MasterSKUList';
import WarehouseSettings from './WarehouseSettings';
import ShipmentsManager from './ShipmentsManager';
import InventoryView from './InventoryView';
import MovementsLedger from './MovementsLedger';
import LayersLedger from './LayersLedger';
import InventoryPnL from './InventoryPnL';
import {
  canViewInventory,
  canSeeInventoryCosts,
  canSeeInventoryPnL,
} from '../lib/inventory-permissions';

var SUBTABS = [
  { id: 'inventory', label: '📊 Inventory View', stage: 'B', desc: 'Master inventory with current quantities by SKU + warehouse' },
  { id: 'skus', label: '📦 Master SKUs', stage: 'A', desc: 'Define the products you stock' },
  { id: 'shipments', label: '🚢 Shipments', stage: 'B', desc: 'Receive inventory from suppliers' },
  { id: 'layers', label: '🧱 Cost Layers', stage: 'C', desc: 'Per-shipment FIFO cost layers (Stage C: landed cost)' },
  { id: 'pnl', label: '💵 Profit by SKU', stage: 'D', desc: 'Revenue minus COGS, per SKU (Stage D: sale deduction)' },
  { id: 'movements', label: '📜 Movements', stage: 'B', desc: 'Every stock change, append-only ledger' },
  { id: 'adjustments', label: '🔧 Adjustments', stage: 'E', desc: 'Damage, returns, transfers, count corrections' },
  { id: 'warehouses', label: '🏭 Warehouses', stage: 'A', desc: 'Physical stock locations' },
  { id: 'reports', label: '📈 Reports', stage: 'F', desc: 'Profitability, aging, slow-moving' },
];

export default function InventoryTab({ userProfile, modulePerms, toast }) {
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
          supabase.from('inv_skus').select('*').eq('is_active', true).order('sku_code'),
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
            <span className="px-2 py-0.5 rounded bg-blue-200 text-blue-900 font-bold">
              v55.83-A.6.27 · Stage 4 of 6
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
          // v55.83-A.6.27 — Stages A, B, C, D all active. Only E, F remain.
          var available = ['A', 'B', 'C', 'D'].indexOf(st.stage) >= 0;
          // P&L tab requires the per-user pnl access permission
          if (st.id === 'pnl' && !seePnL) available = false;
          // Layers tab requires cost access (P&L access implies cost access)
          if (st.id === 'layers' && !seeCosts && !seePnL) available = false;
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

      {/* Stage guidance */}
      <details className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs">
        <summary className="font-bold text-slate-700 cursor-pointer">
          ℹ️ What's in this build (v55.83-A.6.27 · Stage 4 of 6)
        </summary>
        <div className="mt-2 space-y-2 text-slate-600 leading-relaxed">
          <p>
            <strong>Stages C + D add full landed cost + sale deduction.</strong> Each shipment
            now has its own cost basis: open a shipment, click "💰 Finalize Landed Cost",
            pick an allocation method (qty / weight / value), and the system writes locked
            cost layers for FIFO consumption. When you save an invoice line with a linked
            SKU, the layers drain oldest-first and COGS is stamped on the line — see
            "Profit by SKU" for the result.
          </p>
          <p className="font-semibold text-slate-700">Roadmap:</p>
          <ul className="space-y-1 pl-4">
            {SUBTABS.map(function (st) {
              var done = ['A', 'B', 'C', 'D'].indexOf(st.stage) >= 0;
              return (
                <li key={st.id} className={done ? 'text-emerald-700' : ''}>
                  <strong>Stage {st.stage}:</strong> {st.desc}
                  {done && <span className="ml-1">✓ shipped</span>}
                </li>
              );
            })}
          </ul>
          <p className="text-[10px] text-slate-500 mt-2">
            <strong>Setup:</strong> If you haven't run <code>sql/v55-83-a-6-27-inventory-stage-c-d.sql</code> in
            Supabase yet, run it before using the Finalize Landed Cost feature.
          </p>
        </div>
      </details>
    </div>
  );
}
