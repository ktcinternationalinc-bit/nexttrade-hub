// v55.83-A.6.21 (Max May 14 2026) — Inventory Stage B: Inventory View
//
// Pivot table: SKU × Warehouse → current quantity, computed from inv_movements.
// For each (sku_id, warehouse_id) pair, sum qty_change across all movements.
// That's the current stock on hand.
//
// Filters: by warehouse, by product_type, by SKU search.
// Highlights: zero-stock rows in slate, low-stock rows in amber (if reorder
// point configured on SKU), totals row at bottom.

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { canViewInventory } from '../lib/inventory-permissions';

function fmtNum(n) {
  if (n == null) return '—';
  var v = Number(n);
  if (isNaN(v) || v === 0) return '0';
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function InventoryView({ userProfile, modulePerms, toast }) {
  var [skus, setSkus] = useState([]);
  var [warehouses, setWarehouses] = useState([]);
  var [movements, setMovements] = useState([]);
  var [loading, setLoading] = useState(true);
  var [loadError, setLoadError] = useState(null);
  var [filterWarehouse, setFilterWarehouse] = useState('all');
  var [filterType, setFilterType] = useState('all');
  var [search, setSearch] = useState('');
  var [hideZero, setHideZero] = useState(true);

  async function loadAll() {
    setLoading(true);
    setLoadError(null);
    try {
      var [skuResp, whResp, movResp] = await Promise.all([
        supabase.from('inv_skus').select('*').is('deleted_at', null).order('sku_number'),
        supabase.from('inv_warehouses').select('*').is('deleted_at', null).order('code'),
        // Movements: we only need sku_id, warehouse_id, qty_change for the pivot
        supabase.from('inv_movements').select('sku_id, warehouse_id, qty_change'),
      ]);
      if (skuResp.error || whResp.error || movResp.error) {
        setLoadError((skuResp.error || whResp.error || movResp.error).message || 'Could not load inventory data.');
      }
      setSkus(skuResp.data || []);
      setWarehouses(whResp.data || []);
      setMovements(movResp.data || []);
    } catch (e) {
      setLoadError(e.message || String(e));
    }
    setLoading(false);
  }
  useEffect(function () { loadAll(); }, []);

  // Build pivot: { [skuId]: { [warehouseId]: qty, total: qty } }
  var pivot = useMemo(function () {
    var result = {};
    movements.forEach(function (m) {
      if (!m.sku_id) return;
      if (!result[m.sku_id]) result[m.sku_id] = { total: 0 };
      var wh = m.warehouse_id || '_unknown';
      result[m.sku_id][wh] = (result[m.sku_id][wh] || 0) + Number(m.qty_change || 0);
      result[m.sku_id].total += Number(m.qty_change || 0);
    });
    return result;
  }, [movements]);

  // Product type options
  var productTypes = useMemo(function () {
    var set = {};
    skus.forEach(function (s) { if (s.product_type) set[s.product_type] = true; });
    return Object.keys(set).sort();
  }, [skus]);

  // Filtered SKUs
  var visibleSkus = useMemo(function () {
    var q = search.trim().toLowerCase();
    return skus.filter(function (s) {
      if (filterType !== 'all' && s.product_type !== filterType) return false;
      if (q) {
        var hay = ((s.sku_number || '') + ' ' + (s.description || '') + ' ' + (s.description_ar || '')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      if (hideZero) {
        var totalQty = (pivot[s.id] && pivot[s.id].total) || 0;
        if (filterWarehouse === 'all') {
          if (totalQty <= 0) return false;
        } else {
          var whQty = (pivot[s.id] && pivot[s.id][filterWarehouse]) || 0;
          if (whQty <= 0) return false;
        }
      }
      return true;
    });
  }, [skus, search, filterType, filterWarehouse, hideZero, pivot]);

  // Warehouses to display as columns (filter respects)
  var displayWarehouses = useMemo(function () {
    if (filterWarehouse === 'all') return warehouses;
    return warehouses.filter(function (w) { return w.id === filterWarehouse; });
  }, [warehouses, filterWarehouse]);

  // Grand totals
  var totals = useMemo(function () {
    var result = { total: 0 };
    displayWarehouses.forEach(function (w) { result[w.id] = 0; });
    visibleSkus.forEach(function (s) {
      displayWarehouses.forEach(function (w) {
        result[w.id] += (pivot[s.id] && pivot[s.id][w.id]) || 0;
      });
      result.total += (pivot[s.id] && pivot[s.id].total) || 0;
    });
    return result;
  }, [visibleSkus, displayWarehouses, pivot]);

  if (loadError && skus.length === 0) {
    return (
      <div className="bg-amber-50 border border-amber-300 rounded-xl p-6">
        <div className="text-sm font-bold text-amber-900 mb-2">⚠️ Inventory schema not detected</div>
        <p className="text-xs text-amber-800 mb-2">
          The Inventory View needs the v55.83-A inventory schema installed. Run
          <code className="bg-amber-100 px-1 rounded mx-1">sql/v55-83-a-inventory-schema.sql</code>
          in Supabase.
        </p>
        <details className="text-[10px] text-amber-700"><summary className="cursor-pointer">Error</summary><code className="block bg-amber-100 p-2 rounded mt-1 font-mono">{loadError}</code></details>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl p-4 border border-slate-200">
      <div className="flex justify-between items-start mb-3 flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-bold">📊 Inventory View <span className="text-slate-400 font-normal">/ المخزون الحالي</span></h3>
          <p className="text-[11px] text-slate-500">
            Current stock by SKU × Warehouse. Computed from movement ledger.
          </p>
        </div>
        <button onClick={loadAll} disabled={loading}
          className="px-2 py-1 rounded border border-slate-300 hover:bg-slate-50 text-[10px] font-bold">
          {loading ? '⏳' : '🔄'} Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap mb-3 items-center">
        <input value={search} onChange={function (e) { setSearch(e.target.value); }}
          placeholder="🔍 Search SKU number or description..."
          className="border border-slate-300 rounded px-2 py-1 text-xs flex-1 min-w-[200px]" />
        <select value={filterWarehouse} onChange={function (e) { setFilterWarehouse(e.target.value); }}
          className="border border-slate-300 rounded px-2 py-1 text-xs">
          <option value="all">All warehouses</option>
          {warehouses.map(function (w) { return <option key={w.id} value={w.id}>{w.name}</option>; })}
        </select>
        <select value={filterType} onChange={function (e) { setFilterType(e.target.value); }}
          className="border border-slate-300 rounded px-2 py-1 text-xs">
          <option value="all">All product types</option>
          {productTypes.map(function (pt) { return <option key={pt} value={pt}>{pt}</option>; })}
        </select>
        <label className="flex items-center gap-1 text-[11px] text-slate-700">
          <input type="checkbox" checked={hideZero} onChange={function (e) { setHideZero(e.target.checked); }} />
          Hide zero-stock
        </label>
      </div>

      {loading ? (
        <div className="text-center py-8 text-sm text-slate-500">Loading inventory...</div>
      ) : visibleSkus.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-3xl mb-2 opacity-50">📦</div>
          <div className="text-sm font-bold text-slate-700">{skus.length === 0 ? 'No SKUs in your database yet' : 'No matching stock'}</div>
          <div className="text-[11px] text-slate-500 mt-1">
            {skus.length === 0 ? 'Add some on the Master SKUs tab first.' : 'Try adjusting filters or turning off "hide zero-stock".'}
          </div>
        </div>
      ) : (
        <div className="overflow-auto border border-slate-200 rounded">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 sticky top-0">
              <tr>
                <th className="px-2 py-2 text-left text-[10px] font-bold">SKU</th>
                <th className="px-2 py-2 text-left text-[10px] font-bold">Description / Type</th>
                <th className="px-2 py-2 text-center text-[10px] font-bold">Unit</th>
                {displayWarehouses.map(function (w) {
                  return <th key={w.id} className="px-2 py-2 text-right text-[10px] font-bold whitespace-nowrap">{w.code || w.name}</th>;
                })}
                <th className="px-2 py-2 text-right text-[10px] font-bold bg-indigo-100">TOTAL</th>
              </tr>
            </thead>
            <tbody>
              {visibleSkus.map(function (s) {
                var entry = pivot[s.id] || { total: 0 };
                var isZero = entry.total <= 0;
                return (
                  <tr key={s.id} className={'border-t border-slate-100 ' + (isZero ? 'bg-slate-50 text-slate-400' : 'hover:bg-blue-50')}>
                    <td className="px-2 py-1.5 font-mono text-[11px] font-bold">{s.sku_number}</td>
                    <td className="px-2 py-1.5">
                      <div className="text-xs font-medium">{s.description}</div>
                      {s.product_type && <div className="text-[9px] text-slate-500 uppercase tracking-wider">{s.product_type}</div>}
                    </td>
                    <td className="px-2 py-1.5 text-center text-[10px] text-slate-600">{s.primary_unit || 'piece'}</td>
                    {displayWarehouses.map(function (w) {
                      var qty = entry[w.id] || 0;
                      return <td key={w.id} className="px-2 py-1.5 text-right font-mono">{qty === 0 ? <span className="text-slate-400">0</span> : fmtNum(qty)}</td>;
                    })}
                    <td className={'px-2 py-1.5 text-right font-mono font-extrabold ' + (isZero ? '' : 'bg-indigo-50 text-indigo-900')}>{fmtNum(entry.total)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-slate-100 sticky bottom-0">
              <tr>
                <td colSpan={3} className="px-2 py-2 text-right text-[10px] font-bold">Totals →</td>
                {displayWarehouses.map(function (w) {
                  return <td key={w.id} className="px-2 py-2 text-right font-mono font-extrabold text-[11px]">{fmtNum(totals[w.id])}</td>;
                })}
                <td className="px-2 py-2 text-right font-mono font-extrabold text-[11px] bg-indigo-200">{fmtNum(totals.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="mt-2 text-[10px] text-slate-500">
        Showing {visibleSkus.length} of {skus.length} SKUs across {displayWarehouses.length} warehouse{displayWarehouses.length === 1 ? '' : 's'}.
        Stock = sum of all movement quantities (receipts + adjustments − sales).
      </div>
    </div>
  );
}
