// v55.83-A.6.27 (Max May 14 2026) — Stage D: per-SKU P&L summary.
//
// Pulls:
//   • Revenue per SKU = sum of invoice_items.line_total where inv_sku_id matches
//   • COGS per SKU = sum of inv_movements.total_cost_usd where movement_type='sale'
//                    and sku_id matches
//   • Units sold per SKU = sum of |qty_change| on sale movements
// Then computes profit and margin per SKU + grand totals.

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';

function fmt(n, dec) {
  if (n == null || isNaN(Number(n))) return '—';
  dec = dec == null ? 2 : dec;
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export default function InventoryPnL({ skus, toast }) {
  var [salesByInvoiceItem, setSalesByInvoiceItem] = useState([]);
  var [movementsBySku, setMovementsBySku] = useState({});
  var [loading, setLoading] = useState(true);
  var [period, setPeriod] = useState('all');   // all | month | quarter | year
  var [error, setError] = useState(null);

  useEffect(function () {
    var cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        var since = null;
        var now = new Date();
        if (period === 'month') {
          since = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().substring(0, 10);
        } else if (period === 'quarter') {
          var qStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
          since = qStart.toISOString().substring(0, 10);
        } else if (period === 'year') {
          since = new Date(now.getFullYear(), 0, 1).toISOString().substring(0, 10);
        }

        // Revenue: invoice_items with inv_sku_id set
        var iiQ = supabase.from('invoice_items')
          .select('id, inv_sku_id, quantity, unit_price, line_total, cogs_usd, cogs_egp, invoice_id, invoices(invoice_date, status)')
          .not('inv_sku_id', 'is', null);
        var iiResp = await iiQ;
        if (cancelled) return;
        if (iiResp.error) {
          setError('Invoice lines load failed: ' + iiResp.error.message);
          setLoading(false);
          return;
        }
        var items = (iiResp.data || []).filter(function (it) {
          if (!since) return true;
          var d = it.invoices && it.invoices.invoice_date;
          return d && d >= since;
        });
        setSalesByInvoiceItem(items);

        // COGS movements
        var mQ = supabase.from('inv_movements')
          .select('sku_id, qty_change, total_cost_usd, total_cost_egp, movement_type, occurred_at')
          .eq('movement_type', 'sale');
        if (since) mQ = mQ.gte('occurred_at', since);
        var mResp = await mQ;
        if (cancelled) return;
        if (mResp.error) {
          setError('Movements load failed: ' + mResp.error.message);
          setLoading(false);
          return;
        }
        var byS = {};
        (mResp.data || []).forEach(function (m) {
          var k = m.sku_id;
          if (!byS[k]) byS[k] = { unitsSold: 0, cogsUsd: 0, cogsEgp: 0 };
          byS[k].unitsSold += Math.abs(Number(m.qty_change || 0));
          byS[k].cogsUsd += Number(m.total_cost_usd || 0);
          byS[k].cogsEgp += Number(m.total_cost_egp || 0);
        });
        setMovementsBySku(byS);
      } catch (e) {
        setError('Load error: ' + (e && e.message ? e.message : e));
      }
      setLoading(false);
    }
    load();
    return function () { cancelled = true; };
  }, [period]);

  var skuById = useMemo(function () {
    var m = {};
    (skus || []).forEach(function (s) { m[s.id] = s; });
    return m;
  }, [skus]);

  // Build per-SKU summary
  var perSku = useMemo(function () {
    var bySku = {};
    salesByInvoiceItem.forEach(function (it) {
      var k = it.inv_sku_id;
      if (!bySku[k]) bySku[k] = { revenue: 0, cogsUsd: 0, units: 0, lineCount: 0 };
      bySku[k].revenue += Number(it.line_total || 0);
      bySku[k].cogsUsd += Number(it.cogs_usd || 0);
      bySku[k].units += Number(it.quantity || 0);
      bySku[k].lineCount += 1;
    });
    // For SKUs that have movements but no invoice_item linkage yet (older sales),
    // we still want to surface them
    Object.keys(movementsBySku).forEach(function (k) {
      if (!bySku[k]) bySku[k] = { revenue: 0, cogsUsd: 0, units: 0, lineCount: 0 };
      // Prefer movements-based units count (more accurate than items.quantity for reversals)
      if (!bySku[k].units) bySku[k].units = movementsBySku[k].unitsSold;
      if (!bySku[k].cogsUsd) bySku[k].cogsUsd = movementsBySku[k].cogsUsd;
    });
    var arr = Object.keys(bySku).map(function (skuId) {
      var s = bySku[skuId];
      var profit = s.revenue - s.cogsUsd;
      var margin = s.revenue > 0 ? (profit / s.revenue) * 100 : 0;
      return {
        skuId: skuId,
        sku: skuById[skuId],
        revenue: s.revenue,
        cogsUsd: s.cogsUsd,
        profit: profit,
        margin: margin,
        units: s.units,
        lineCount: s.lineCount,
      };
    });
    arr.sort(function (a, b) { return b.profit - a.profit; });
    return arr;
  }, [salesByInvoiceItem, movementsBySku, skuById]);

  var totals = useMemo(function () {
    var t = { revenue: 0, cogs: 0, profit: 0, units: 0 };
    perSku.forEach(function (r) {
      t.revenue += r.revenue;
      t.cogs += r.cogsUsd;
      t.profit += r.profit;
      t.units += r.units;
    });
    t.margin = t.revenue > 0 ? (t.profit / t.revenue) * 100 : 0;
    return t;
  }, [perSku]);

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-lg p-3 border border-slate-200">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <h3 className="text-sm font-bold">📊 Per-SKU Profitability</h3>
          <div className="flex gap-1">
            {[
              { v: 'month', label: 'This Month' },
              { v: 'quarter', label: 'Quarter' },
              { v: 'year', label: 'Year' },
              { v: 'all', label: 'All-time' },
            ].map(function (p) {
              return (
                <button key={p.v} onClick={function () { setPeriod(p.v); }}
                  className={'px-2.5 py-1 rounded text-[10px] font-bold ' + (period === p.v ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200')}>
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Totals tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="bg-blue-50 border border-blue-200 rounded p-2">
            <div className="text-[10px] text-blue-700 font-bold uppercase">Revenue</div>
            <div className="text-lg font-extrabold text-blue-900 font-mono">${fmt(totals.revenue)}</div>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded p-2">
            <div className="text-[10px] text-amber-700 font-bold uppercase">COGS</div>
            <div className="text-lg font-extrabold text-amber-900 font-mono">${fmt(totals.cogs)}</div>
          </div>
          <div className={'rounded p-2 border ' + (totals.profit >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200')}>
            <div className={'text-[10px] font-bold uppercase ' + (totals.profit >= 0 ? 'text-emerald-700' : 'text-red-700')}>Profit</div>
            <div className={'text-lg font-extrabold font-mono ' + (totals.profit >= 0 ? 'text-emerald-900' : 'text-red-900')}>
              ${fmt(totals.profit)}
            </div>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded p-2">
            <div className="text-[10px] text-slate-700 font-bold uppercase">Margin · Units</div>
            <div className="text-lg font-extrabold text-slate-900 font-mono">{fmt(totals.margin, 1)}% · {fmt(totals.units, 0)}</div>
          </div>
        </div>
      </div>

      {/* Per-SKU table */}
      {loading ? (
        <div className="bg-white rounded-lg p-6 text-center text-xs text-slate-500">⏳ Loading P&L…</div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-xs text-red-900">⚠️ {error}</div>
      ) : perSku.length === 0 ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-xs text-amber-900">
          No SKU-linked sales yet for the selected period. Link inventory SKUs to invoice line items to start tracking per-SKU profit.
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="overflow-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-2 py-2 text-left text-[10px]">SKU</th>
                  <th className="px-2 py-2 text-right text-[10px]">Units Sold</th>
                  <th className="px-2 py-2 text-right text-[10px]">Revenue</th>
                  <th className="px-2 py-2 text-right text-[10px]">COGS</th>
                  <th className="px-2 py-2 text-right text-[10px]">Profit</th>
                  <th className="px-2 py-2 text-right text-[10px]">Margin</th>
                  <th className="px-2 py-2 text-right text-[10px]">Lines</th>
                </tr>
              </thead>
              <tbody>
                {perSku.map(function (r) {
                  return (
                    <tr key={r.skuId} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-2 py-2">
                        {r.sku ? (
                          <div>
                            <div className="font-bold">{r.sku.sku_number}</div>
                            <div className="text-[10px] text-slate-500">{r.sku.description}</div>
                          </div>
                        ) : (
                          <span className="font-mono text-[10px] text-slate-400">{r.skuId.substring(0, 8)}…</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right font-mono">{fmt(r.units, 0)}</td>
                      <td className="px-2 py-2 text-right font-mono text-blue-700 font-bold">${fmt(r.revenue)}</td>
                      <td className="px-2 py-2 text-right font-mono text-amber-700">${fmt(r.cogsUsd)}</td>
                      <td className={'px-2 py-2 text-right font-mono font-extrabold ' + (r.profit >= 0 ? 'text-emerald-700' : 'text-red-700')}>
                        ${fmt(r.profit)}
                      </td>
                      <td className={'px-2 py-2 text-right font-mono font-bold ' + (r.margin >= 20 ? 'text-emerald-700' : r.margin >= 0 ? 'text-amber-700' : 'text-red-700')}>
                        {fmt(r.margin, 1)}%
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-slate-500">{r.lineCount}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
