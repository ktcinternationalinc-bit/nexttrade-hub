// v55.83-A.6.27.9 (Max May 15 2026) — Inventory Stage F: Reports
//
// Three report views in one component, toggled via subtab:
//   1. Stock Value — total $ value tied up in inventory, broken down by SKU
//   2. Aging — how long each layer has been sitting (>90d, >180d, >365d)
//   3. Slow-Moving — SKUs with no sale activity in the last N days

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';

function fmt(n, dec) {
  if (n == null || isNaN(Number(n))) return '—';
  dec = dec == null ? 2 : dec;
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function daysBetween(iso) {
  if (!iso) return null;
  var then = new Date(iso).getTime();
  var now = Date.now();
  return Math.floor((now - then) / 86400000);
}

export default function InventoryReports({ skus, warehouses, toast }) {
  var [view, setView] = useState('value');
  var [layers, setLayers] = useState([]);
  var [movements, setMovements] = useState([]);
  var [loading, setLoading] = useState(true);

  useEffect(function () {
    var cancelled = false;
    async function load() {
      setLoading(true);
      try {
        var [lResp, mResp] = await Promise.all([
          supabase.from('inv_layers').select('*'),
          supabase.from('inv_movements').select('sku_id, warehouse_id, movement_type, qty_change, occurred_at').gte('occurred_at', new Date(Date.now() - 365 * 86400000).toISOString()),
        ]);
        if (cancelled) return;
        if (lResp.error) toast && toast.error && toast.error('Layers load: ' + lResp.error.message);
        if (mResp.error) toast && toast.error && toast.error('Movements load: ' + mResp.error.message);
        setLayers(lResp.data || []);
        setMovements(mResp.data || []);
      } catch (e) {
        toast && toast.error && toast.error('Load error: ' + (e && e.message ? e.message : e));
      }
      setLoading(false);
    }
    load();
    return function () { cancelled = true; };
  }, []);

  var skuById = useMemo(function () {
    var m = {}; (skus || []).forEach(function (s) { m[s.id] = s; }); return m;
  }, [skus]);

  // === Stock Value report ===
  var stockValue = useMemo(function () {
    var bySku = {};
    layers.forEach(function (L) {
      var q = Number(L.qty_remaining || 0);
      if (q <= 0) return;
      var k = L.sku_id;
      if (!bySku[k]) bySku[k] = { qty: 0, valueUsd: 0, valueEgp: 0, oldestReceivedAt: null };
      bySku[k].qty += q;
      bySku[k].valueUsd += q * Number(L.landed_unit_cost_usd || 0);
      bySku[k].valueEgp += q * Number(L.landed_unit_cost_egp || 0);
      if (!bySku[k].oldestReceivedAt || L.received_at < bySku[k].oldestReceivedAt) {
        bySku[k].oldestReceivedAt = L.received_at;
      }
    });
    var arr = Object.keys(bySku).map(function (k) {
      return Object.assign({ skuId: k, sku: skuById[k] }, bySku[k]);
    });
    arr.sort(function (a, b) { return b.valueUsd - a.valueUsd; });
    return arr;
  }, [layers, skuById]);

  var totalStockValue = useMemo(function () {
    return stockValue.reduce(function (acc, r) {
      acc.qty += r.qty; acc.valueUsd += r.valueUsd; acc.valueEgp += r.valueEgp;
      return acc;
    }, { qty: 0, valueUsd: 0, valueEgp: 0 });
  }, [stockValue]);

  // === Aging report ===
  var aging = useMemo(function () {
    var buckets = { fresh: 0, m1to3: 0, m3to6: 0, m6to12: 0, over12: 0 };
    var bucketValue = { fresh: 0, m1to3: 0, m3to6: 0, m6to12: 0, over12: 0 };
    var rows = [];
    layers.forEach(function (L) {
      var q = Number(L.qty_remaining || 0);
      if (q <= 0) return;
      var days = daysBetween(L.received_at);
      var v = q * Number(L.landed_unit_cost_usd || 0);
      var bucket = 'fresh';
      if (days != null) {
        if (days > 365) bucket = 'over12';
        else if (days > 180) bucket = 'm6to12';
        else if (days > 90) bucket = 'm3to6';
        else if (days > 30) bucket = 'm1to3';
      }
      buckets[bucket] += q;
      bucketValue[bucket] += v;
      rows.push({ layer: L, sku: skuById[L.sku_id], days: days, value: v, bucket: bucket });
    });
    rows.sort(function (a, b) { return (b.days || 0) - (a.days || 0); });
    return { buckets: buckets, bucketValue: bucketValue, rows: rows };
  }, [layers, skuById]);

  // === Slow-Moving report ===
  var [slowDays, setSlowDays] = useState(60);
  var slowMoving = useMemo(function () {
    // For every SKU with stock-on-hand, find the most recent SALE movement.
    // If no sale in last `slowDays` days → flagged.
    var lastSaleBySku = {};
    movements.forEach(function (m) {
      if (m.movement_type !== 'sale') return;
      if (!lastSaleBySku[m.sku_id] || m.occurred_at > lastSaleBySku[m.sku_id]) {
        lastSaleBySku[m.sku_id] = m.occurred_at;
      }
    });
    return stockValue.map(function (r) {
      var lastSale = lastSaleBySku[r.skuId];
      var daysSinceSale = lastSale ? daysBetween(lastSale) : null;
      return Object.assign({}, r, {
        lastSale: lastSale,
        daysSinceSale: daysSinceSale,
        isSlow: daysSinceSale == null || daysSinceSale > slowDays,
      });
    }).filter(function (r) { return r.isSlow; })
      .sort(function (a, b) { return b.valueUsd - a.valueUsd; });
  }, [stockValue, movements, slowDays]);

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-lg p-3 border border-slate-200">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-sm font-bold">📈 Inventory Reports</h3>
          <div className="flex gap-1">
            {[
              { v: 'value', label: '💰 Stock Value' },
              { v: 'aging', label: '⏰ Aging' },
              { v: 'slow', label: '🐢 Slow-Moving' },
            ].map(function (t) {
              return (
                <button key={t.v} onClick={function () { setView(t.v); }}
                  className={'px-3 py-1.5 rounded text-[11px] font-bold ' + (view === t.v ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200')}>
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {loading && (
        <div className="bg-white rounded-lg p-6 text-center text-xs text-slate-500">⏳ Loading…</div>
      )}

      {!loading && view === 'value' && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-blue-50 border border-blue-200 rounded p-3">
              <div className="text-[10px] text-blue-700 font-bold uppercase">Total Units</div>
              <div className="text-2xl font-extrabold text-blue-900 font-mono">{fmt(totalStockValue.qty, 0)}</div>
            </div>
            <div className="bg-emerald-50 border border-emerald-200 rounded p-3">
              <div className="text-[10px] text-emerald-700 font-bold uppercase">Stock Value (USD)</div>
              <div className="text-2xl font-extrabold text-emerald-900 font-mono">${fmt(totalStockValue.valueUsd)}</div>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded p-3">
              <div className="text-[10px] text-amber-700 font-bold uppercase">Stock Value (EGP)</div>
              <div className="text-2xl font-extrabold text-amber-900 font-mono">£E {fmt(totalStockValue.valueEgp)}</div>
            </div>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <div className="overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-2 py-2 text-left text-[10px]">SKU</th>
                    <th className="px-2 py-2 text-right text-[10px]">Qty</th>
                    <th className="px-2 py-2 text-right text-[10px]">Value (USD)</th>
                    <th className="px-2 py-2 text-right text-[10px]">Value (EGP)</th>
                    <th className="px-2 py-2 text-left text-[10px]">Oldest Receipt</th>
                  </tr>
                </thead>
                <tbody>
                  {stockValue.length === 0 ? (
                    <tr><td colSpan="5" className="px-2 py-4 text-center text-slate-500">No stock on hand</td></tr>
                  ) : stockValue.map(function (r) {
                    return (
                      <tr key={r.skuId} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-2 py-2">
                          {r.sku ? <><span className="font-bold">{r.sku.sku_number}</span> <span className="text-slate-500 text-[10px]">{r.sku.description}</span></> : r.skuId.substring(0, 8) + '…'}
                        </td>
                        <td className="px-2 py-2 text-right font-mono">{fmt(r.qty, 0)}</td>
                        <td className="px-2 py-2 text-right font-mono font-bold text-emerald-700">${fmt(r.valueUsd)}</td>
                        <td className="px-2 py-2 text-right font-mono text-amber-700">£E {fmt(r.valueEgp)}</td>
                        <td className="px-2 py-2 text-[10px] text-slate-500">{r.oldestReceivedAt || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {!loading && view === 'aging' && (
        <>
          <div className="grid grid-cols-5 gap-2">
            {[
              { k: 'fresh', label: '< 1mo', color: 'emerald' },
              { k: 'm1to3', label: '1–3mo', color: 'sky' },
              { k: 'm3to6', label: '3–6mo', color: 'amber' },
              { k: 'm6to12', label: '6–12mo', color: 'orange' },
              { k: 'over12', label: '> 12mo', color: 'red' },
            ].map(function (b) {
              return (
                <div key={b.k} className={'rounded p-3 border bg-' + b.color + '-50 border-' + b.color + '-200'}>
                  <div className={'text-[10px] font-bold uppercase text-' + b.color + '-700'}>{b.label}</div>
                  <div className={'text-xl font-extrabold font-mono text-' + b.color + '-900'}>{fmt(aging.buckets[b.k], 0)}</div>
                  <div className={'text-[9px] font-mono text-' + b.color + '-700'}>${fmt(aging.bucketValue[b.k])}</div>
                </div>
              );
            })}
          </div>
          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <div className="overflow-auto max-h-[500px]">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    <th className="px-2 py-2 text-left text-[10px]">SKU</th>
                    <th className="px-2 py-2 text-left text-[10px]">Received</th>
                    <th className="px-2 py-2 text-right text-[10px]">Days Old</th>
                    <th className="px-2 py-2 text-right text-[10px]">Qty Left</th>
                    <th className="px-2 py-2 text-right text-[10px]">Value (USD)</th>
                  </tr>
                </thead>
                <tbody>
                  {aging.rows.length === 0 ? (
                    <tr><td colSpan="5" className="px-2 py-4 text-center text-slate-500">No layers with remaining stock</td></tr>
                  ) : aging.rows.map(function (r) {
                    var bColor = r.bucket === 'over12' ? 'text-red-700' :
                                 r.bucket === 'm6to12' ? 'text-orange-700' :
                                 r.bucket === 'm3to6' ? 'text-amber-700' :
                                 r.bucket === 'm1to3' ? 'text-sky-700' : 'text-emerald-700';
                    return (
                      <tr key={r.layer.id} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-2 py-2">{r.sku ? r.sku.sku_number : r.layer.sku_id.substring(0, 8) + '…'}</td>
                        <td className="px-2 py-2 text-[10px] text-slate-500">{r.layer.received_at}</td>
                        <td className={'px-2 py-2 text-right font-mono font-bold ' + bColor}>{r.days != null ? r.days : '—'}</td>
                        <td className="px-2 py-2 text-right font-mono">{fmt(r.layer.qty_remaining, 0)}</td>
                        <td className="px-2 py-2 text-right font-mono">${fmt(r.value)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {!loading && view === 'slow' && (
        <>
          <div className="bg-white rounded-lg p-3 border border-slate-200 flex items-center gap-3 flex-wrap">
            <span className="text-xs text-slate-700">Flag SKUs with no sales in the last</span>
            <select value={slowDays} onChange={function (e) { setSlowDays(Number(e.target.value)); }}
              className="border border-slate-300 rounded px-2 py-1 text-xs font-bold">
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={90}>90 days</option>
              <option value={180}>180 days</option>
            </select>
            <div className="ml-auto text-[11px] font-bold text-slate-700">
              <span className="text-red-700">{slowMoving.length}</span> SKU{slowMoving.length === 1 ? '' : 's'} flagged ·
              {' '}<span className="text-red-700">${fmt(slowMoving.reduce(function (a, r) { return a + r.valueUsd; }, 0))}</span> tied up
            </div>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <div className="overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-2 py-2 text-left text-[10px]">SKU</th>
                    <th className="px-2 py-2 text-right text-[10px]">Stock Qty</th>
                    <th className="px-2 py-2 text-right text-[10px]">Stock Value</th>
                    <th className="px-2 py-2 text-left text-[10px]">Last Sale</th>
                    <th className="px-2 py-2 text-right text-[10px]">Days Idle</th>
                  </tr>
                </thead>
                <tbody>
                  {slowMoving.length === 0 ? (
                    <tr><td colSpan="5" className="px-2 py-4 text-center text-slate-500">No slow-moving SKUs at this threshold</td></tr>
                  ) : slowMoving.map(function (r) {
                    return (
                      <tr key={r.skuId} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-2 py-2">
                          {r.sku ? <><span className="font-bold">{r.sku.sku_number}</span> <span className="text-slate-500 text-[10px]">{r.sku.description}</span></> : r.skuId.substring(0, 8) + '…'}
                        </td>
                        <td className="px-2 py-2 text-right font-mono">{fmt(r.qty, 0)}</td>
                        <td className="px-2 py-2 text-right font-mono font-bold text-red-700">${fmt(r.valueUsd)}</td>
                        <td className="px-2 py-2 text-[10px] text-slate-500">{r.lastSale ? r.lastSale.substring(0, 10) : 'never'}</td>
                        <td className="px-2 py-2 text-right font-mono font-bold text-red-700">{r.daysSinceSale != null ? r.daysSinceSale : '∞'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
