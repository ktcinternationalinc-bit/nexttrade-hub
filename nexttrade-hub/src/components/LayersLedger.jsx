// v55.83-A.6.27 (Max May 14 2026) — Stage C/D: FIFO Layers Ledger
//
// Shows each SKU's cost layers (one per receipt):
//   • qty_received vs qty_remaining (so you see what's been drained)
//   • landed_unit_cost in USD + EGP
//   • Provisional flag (cost not yet finalized)
//   • Source shipment ref + received date
//   • Indication if cost was adjusted after sales (drills into cost_adjustments)

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';

function fmt(n, dec) {
  if (n == null || isNaN(Number(n))) return '—';
  dec = dec == null ? 2 : dec;
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtDate(iso) {
  if (!iso) return '—';
  return String(iso).substring(0, 10);
}

export default function LayersLedger({ skus, warehouses, toast }) {
  var [layers, setLayers] = useState([]);
  var [shipments, setShipments] = useState({});
  var [adjustments, setAdjustments] = useState({});
  var [loading, setLoading] = useState(true);
  var [skuFilter, setSkuFilter] = useState('all');
  var [warehouseFilter, setWarehouseFilter] = useState('all');
  var [showEmpty, setShowEmpty] = useState(false);

  useEffect(function () {
    var cancelled = false;
    async function load() {
      setLoading(true);
      try {
        var layersResp = await supabase.from('inv_layers')
          .select('*')
          .order('received_at', { ascending: false });
        if (cancelled) return;
        if (layersResp.error) {
          toast && toast.error && toast.error('Could not load layers: ' + layersResp.error.message);
          setLoading(false);
          return;
        }
        var L = layersResp.data || [];
        setLayers(L);

        // Pull shipments for the source refs
        var shipmentIds = Array.from(new Set(L.map(function (x) { return x.source_shipment_id; }).filter(Boolean)));
        if (shipmentIds.length > 0) {
          var sResp = await supabase.from('inv_shipments').select('id, shipment_ref, supplier_name').in('id', shipmentIds);
          var byId = {};
          (sResp.data || []).forEach(function (s) { byId[s.id] = s; });
          if (!cancelled) setShipments(byId);
        }

        // Pull adjustments grouped by layer_id (one indicator if any)
        var layerIds = L.map(function (x) { return x.id; });
        if (layerIds.length > 0) {
          var aResp = await supabase.from('inv_cost_adjustments').select('layer_id, total_cogs_delta_usd, adjusted_at').in('layer_id', layerIds);
          var byLayer = {};
          (aResp.data || []).forEach(function (a) {
            if (!byLayer[a.layer_id]) byLayer[a.layer_id] = [];
            byLayer[a.layer_id].push(a);
          });
          if (!cancelled) setAdjustments(byLayer);
        }
      } catch (e) {
        toast && toast.error && toast.error('Layers load error: ' + (e && e.message ? e.message : e));
      }
      setLoading(false);
    }
    load();
    return function () { cancelled = true; };
  }, []);

  var skuById = useMemo(function () {
    var m = {};
    (skus || []).forEach(function (s) { m[s.id] = s; });
    return m;
  }, [skus]);

  var warehouseById = useMemo(function () {
    var m = {};
    (warehouses || []).forEach(function (w) { m[w.id] = w; });
    return m;
  }, [warehouses]);

  var filteredLayers = useMemo(function () {
    return layers.filter(function (L) {
      if (skuFilter !== 'all' && L.sku_id !== skuFilter) return false;
      if (warehouseFilter !== 'all' && L.warehouse_id !== warehouseFilter) return false;
      if (!showEmpty && Number(L.qty_remaining) <= 0) return false;
      return true;
    });
  }, [layers, skuFilter, warehouseFilter, showEmpty]);

  // Group by SKU for cleaner display
  var grouped = useMemo(function () {
    var g = {};
    filteredLayers.forEach(function (L) {
      var k = L.sku_id;
      if (!g[k]) g[k] = [];
      g[k].push(L);
    });
    return g;
  }, [filteredLayers]);

  // Per-SKU totals
  function skuTotals(rows) {
    var totalQty = 0;
    var totalCostUsd = 0;
    rows.forEach(function (L) {
      var q = Number(L.qty_remaining || 0);
      var u = Number(L.landed_unit_cost_usd || 0);
      totalQty += q;
      totalCostUsd += q * u;
    });
    return { totalQty: totalQty, totalCostUsd: totalCostUsd, weightedUnit: totalQty > 0 ? totalCostUsd / totalQty : 0 };
  }

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-lg p-3 border border-slate-200">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <h3 className="text-sm font-bold">🧱 FIFO Layers Ledger</h3>
          <div className="text-[10px] text-slate-500">
            {filteredLayers.length} layer{filteredLayers.length === 1 ? '' : 's'} ·
            {' '}{Object.keys(grouped).length} SKU{Object.keys(grouped).length === 1 ? '' : 's'}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap text-[11px]">
          <select value={skuFilter} onChange={function (e) { setSkuFilter(e.target.value); }}
            className="border border-slate-300 rounded px-2 py-1 text-xs">
            <option value="all">All SKUs</option>
            {(skus || []).map(function (s) {
              return <option key={s.id} value={s.id}>{s.sku_number} — {s.name}</option>;
            })}
          </select>
          <select value={warehouseFilter} onChange={function (e) { setWarehouseFilter(e.target.value); }}
            className="border border-slate-300 rounded px-2 py-1 text-xs">
            <option value="all">All warehouses</option>
            {(warehouses || []).map(function (w) {
              return <option key={w.id} value={w.id}>{w.name}</option>;
            })}
          </select>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={showEmpty} onChange={function (e) { setShowEmpty(e.target.checked); }} />
            <span className="text-slate-600">Show fully-drained layers</span>
          </label>
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-lg p-6 text-center text-xs text-slate-500">⏳ Loading layers…</div>
      ) : Object.keys(grouped).length === 0 ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-xs text-amber-900">
          No layers match the current filters. Finalize a shipment's landed cost to create layers, or toggle "Show fully-drained layers" to see exhausted layers.
        </div>
      ) : (
        Object.keys(grouped).map(function (skuId) {
          var rows = grouped[skuId];
          var sku = skuById[skuId];
          var t = skuTotals(rows);
          return (
            <div key={skuId} className="bg-white rounded-lg border border-slate-200 overflow-hidden">
              <div className="bg-slate-50 px-3 py-2 border-b border-slate-200 flex justify-between items-center flex-wrap gap-2">
                <div>
                  <div className="text-xs font-extrabold">{sku ? sku.sku_number + ' — ' + sku.description : skuId.substring(0, 8)}</div>
                  {sku && sku.description && <div className="text-[10px] text-slate-500">{sku.description}</div>}
                </div>
                <div className="flex items-center gap-3 text-[10px]">
                  <div><span className="text-slate-500">Remaining:</span> <span className="font-bold font-mono">{fmt(t.totalQty, 0)}</span></div>
                  <div><span className="text-slate-500">Stock Value:</span> <span className="font-bold font-mono">${fmt(t.totalCostUsd)}</span></div>
                  <div><span className="text-slate-500">Weighted Cost:</span> <span className="font-bold font-mono">${fmt(t.weightedUnit, 4)}</span></div>
                </div>
              </div>
              <div className="overflow-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50/50">
                    <tr>
                      <th className="px-2 py-1.5 text-left text-[10px]">Received</th>
                      <th className="px-2 py-1.5 text-left text-[10px]">Shipment</th>
                      <th className="px-2 py-1.5 text-left text-[10px]">Warehouse</th>
                      <th className="px-2 py-1.5 text-right text-[10px]">Qty Rcvd</th>
                      <th className="px-2 py-1.5 text-right text-[10px]">Qty Remain</th>
                      <th className="px-2 py-1.5 text-right text-[10px]">Unit USD</th>
                      <th className="px-2 py-1.5 text-right text-[10px]">Unit EGP</th>
                      <th className="px-2 py-1.5 text-center text-[10px]">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(function (L) {
                      var ship = shipments[L.source_shipment_id];
                      var wh = warehouseById[L.warehouse_id];
                      var adj = adjustments[L.id];
                      var depleted = Number(L.qty_remaining) <= 0;
                      var partial = Number(L.qty_remaining) > 0 && Number(L.qty_remaining) < Number(L.qty_received);
                      return (
                        <tr key={L.id} className={'border-t border-slate-100 ' + (depleted ? 'opacity-50' : '')}>
                          <td className="px-2 py-1.5">{fmtDate(L.received_at)}</td>
                          <td className="px-2 py-1.5">
                            {ship ? <span className="font-mono">{ship.shipment_ref}</span> : '—'}
                            {ship && ship.supplier_name && <div className="text-[9px] text-slate-500">{ship.supplier_name}</div>}
                          </td>
                          <td className="px-2 py-1.5">{wh ? wh.name : '—'}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{fmt(L.qty_received, 0)}</td>
                          <td className={'px-2 py-1.5 text-right font-mono font-bold ' + (depleted ? 'text-slate-400' : partial ? 'text-amber-700' : 'text-emerald-700')}>
                            {fmt(L.qty_remaining, 0)}
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono">${fmt(L.landed_unit_cost_usd, 4)}</td>
                          <td className="px-2 py-1.5 text-right font-mono">£E {fmt(L.landed_unit_cost_egp, 2)}</td>
                          <td className="px-2 py-1.5 text-center">
                            {L.cost_is_provisional && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 font-bold" title="Cost not yet finalized — sales drained at provisional rate may be restated later">
                                ⚠️ Provisional
                              </span>
                            )}
                            {!L.cost_is_provisional && !adj && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-900 font-bold">✓ Final</span>
                            )}
                            {adj && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-900 font-bold" title={adj.length + ' adjustment(s) recorded'}>
                                🔄 Restated × {adj.length}
                              </span>
                            )}
                            {depleted && (
                              <div className="text-[9px] text-slate-400 mt-0.5">depleted</div>
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
        })
      )}
    </div>
  );
}
