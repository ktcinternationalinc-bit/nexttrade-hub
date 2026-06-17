'use client';
// v55.83-A.6.27.62 — Inventory P&L Reports.
//
// WHAT IT DOES:
//   • Pulls all inventory_layers (= receipts) and inventory_movements (= sales/adjustments)
//   • Aggregates into 4 different cuts:
//     ─ Per Product (qty sold, revenue, COGS, gross profit, margin %)
//     ─ Per Category (rolled up by master_list category)
//     ─ Per Warehouse (rolled up by warehouse_id)
//     ─ Per Period (date range filter applied to all 3 above)
//   • Top 10 movers — best margin, worst margin, top revenue, top profit
//   • Excel export
//   • Print
//
// PERMISSIONS:
//   • Requires "See Inventory P&L" permission (or super_admin)
//   • Without permission → shows blocked screen

import { useState, useEffect, useMemo } from 'react';
import RestrictedNotice from './RestrictedNotice';
import { supabase } from '../lib/supabase';
import { canSeeInventoryPnL } from '../lib/inventory-permissions';

function fmtNum(n, dp) {
  if (n == null || isNaN(Number(n))) return '0.' + '0'.repeat(dp == null ? 2 : dp);
  return Number(n).toLocaleString(undefined, {
    minimumFractionDigits: dp == null ? 2 : dp,
    maximumFractionDigits: dp == null ? 2 : dp,
  });
}
function fmtPct(n) {
  if (n == null || isNaN(Number(n))) return '—';
  return Number(n).toFixed(1) + '%';
}

// Date range presets
var TODAY = function () { return new Date().toISOString().substring(0, 10); };
function firstOfMonth() {
  var d = new Date(); d.setDate(1);
  return d.toISOString().substring(0, 10);
}
function firstOfLastMonth() {
  var d = new Date(); d.setMonth(d.getMonth() - 1); d.setDate(1);
  return d.toISOString().substring(0, 10);
}
function lastOfLastMonth() {
  var d = new Date(); d.setDate(0); // sets to last day of previous month
  return d.toISOString().substring(0, 10);
}
function firstOfYear() {
  var y = new Date().getFullYear();
  return y + '-01-01';
}

export default function InventoryPnLReports(props) {
  var userProfile = props.userProfile || null;
  var modulePerms = props.modulePerms || {};
  var isSuperAdmin = !!props.isSuperAdmin;
  var toast = props.toast || { success: function(){}, error: function(){}, info: function(){} };

  var canSeePnL = isSuperAdmin || canSeeInventoryPnL(modulePerms);

  var [products, setProducts] = useState([]);
  var [warehouses, setWarehouses] = useState([]);
  var [lists, setLists] = useState([]);
  var [layers, setLayers] = useState([]);       // inventory_layers (receipts)
  var [movements, setMovements] = useState([]); // inventory_movements (sales/adjustments)
  var [loading, setLoading] = useState(true);
  var [error, setError] = useState(null);

  var [groupBy, setGroupBy] = useState('product'); // 'product' | 'category' | 'warehouse'
  var [dateFrom, setDateFrom] = useState(firstOfMonth());
  var [dateTo, setDateTo] = useState(TODAY());
  // v55.83-A.6.27.66 (C1, Max May 23 2026) — currency filter. P&L numbers
  // are meaningless if USD movements and EGP movements are summed without
  // conversion. Default to the most common currency in the data; user can
  // switch to a specific currency or 'all' (which shows a warning banner).
  var [currencyFilter, setCurrencyFilter] = useState('EGP');

  useEffect(function () {
    if (!canSeePnL) { setLoading(false); return; }
    var cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        var [prodRes, whRes, listRes, layRes, movRes] = await Promise.all([
          supabase.from('inventory_products').select('id, quick_code, name_en, name_ar, family_list_id, category_list_id, default_uom, is_family_template').eq('active', true),
          supabase.from('inventory_warehouses').select('id, name'),
          supabase.from('inventory_classification_lists').select('id, label_en, code, level'),
          supabase.from('inventory_layers').select('*'),
          supabase.from('inventory_movements').select('*'),
        ]);
        if (cancelled) return;
        if (prodRes.error) throw prodRes.error;
        setProducts((prodRes.data || []).filter(function (p) { return p.is_family_template !== true; }));
        if (whRes && !whRes.error) setWarehouses(whRes.data || []);
        if (listRes && !listRes.error) setLists(listRes.data || []);
        if (layRes && !layRes.error) setLayers(layRes.data || []);
        else if (layRes && layRes.error) console.warn('[pnl] layers query:', layRes.error.message);
        if (movRes && !movRes.error) setMovements(movRes.data || []);
        else if (movRes && movRes.error) console.warn('[pnl] movements query:', movRes.error.message);
      } catch (e) {
        if (!cancelled) {
          console.error('[pnl] load failed:', e);
          setError((e && e.message) || String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return function () { cancelled = true; };
  }, [canSeePnL]);

  // ── Aggregation logic ────────────────────────────────────────
  // For each product: filter movements within date range, accumulate sold qty,
  // revenue, COGS. Compute gross profit + margin.
  var productStats = useMemo(function () {
    var byProduct = {}; // product_id → stats
    products.forEach(function (p) {
      byProduct[p.id] = {
        product: p,
        sold_qty: 0,
        revenue: 0,
        cogs: 0,
        gross_profit: 0,
        margin_pct: 0,
      };
    });

    movements.forEach(function (m) {
      var d = m.moved_at ? String(m.moved_at).substring(0, 10) : '';
      if (dateFrom && d < dateFrom) return;
      if (dateTo && d > dateTo) return;
      // v55.83-A.6.27.66 (C1) — currency filter. Skip movements that don't
      // match the selected currency. 'all' includes everything (and a warning
      // banner is shown at the top so the user knows totals are mixed).
      var mCur = String(m.cost_currency || m.currency || 'EGP').toUpperCase();
      if (currencyFilter !== 'all' && mCur !== currencyFilter) return;
      var s = byProduct[m.product_id];
      if (!s) return;
      var qty = Number(m.quantity || m.qty || 0);
      var rev = Number(m.revenue || 0);
      var cogs = Number(m.cogs || 0);
      // Treat positive qty as outbound sale (revenue) — adjust here if your
      // movement schema uses sign differently.
      var isOutbound = (m.movement_type === 'sale') || (m.type === 'sale') ||
                       (m.movement_type === 'outbound') || qty > 0;
      if (isOutbound) {
        s.sold_qty += Math.abs(qty);
        s.revenue += rev;
        s.cogs += cogs;
      }
    });

    Object.keys(byProduct).forEach(function (pid) {
      var s = byProduct[pid];
      s.gross_profit = s.revenue - s.cogs;
      s.margin_pct = s.revenue > 0 ? (s.gross_profit / s.revenue) * 100 : 0;
    });

    return byProduct;
  }, [products, movements, dateFrom, dateTo, currencyFilter]);

  // v55.83-A.6.27.66 (C1) — derive currencies actually present in the data
  // for the selected date range, so the dropdown only shows real options
  // and so we can flash a warning when multiple currencies coexist.
  var presentCurrencies = useMemo(function () {
    var seen = {};
    movements.forEach(function (m) {
      var d = m.moved_at ? String(m.moved_at).substring(0, 10) : '';
      if (dateFrom && d < dateFrom) return;
      if (dateTo && d > dateTo) return;
      var c = String(m.cost_currency || m.currency || 'EGP').toUpperCase();
      seen[c] = true;
    });
    return Object.keys(seen).sort();
  }, [movements, dateFrom, dateTo]);

  // Rows for the current groupBy
  var rows = useMemo(function () {
    if (groupBy === 'product') {
      // One row per product (filter to those with any sale)
      var arr = Object.keys(productStats).map(function (pid) { return productStats[pid]; });
      arr = arr.filter(function (s) { return s.sold_qty > 0 || s.revenue !== 0 || s.cogs !== 0; });
      arr.sort(function (a, b) { return b.gross_profit - a.gross_profit; });
      return arr.map(function (s) {
        return {
          key: s.product.id,
          label: (s.product.quick_code || '') + ' · ' + (s.product.name_en || ''),
          sold_qty: s.sold_qty,
          revenue: s.revenue,
          cogs: s.cogs,
          gross_profit: s.gross_profit,
          margin_pct: s.margin_pct,
        };
      });
    }
    if (groupBy === 'category') {
      var listsById = {};
      lists.forEach(function (l) { listsById[l.id] = l; });
      var byCat = {};
      Object.keys(productStats).forEach(function (pid) {
        var s = productStats[pid];
        var catList = listsById[s.product.category_list_id];
        var key = catList ? catList.id : '__uncat';
        var label = catList ? (catList.label_en || catList.code) : '(Uncategorized)';
        if (!byCat[key]) byCat[key] = { key: key, label: label, sold_qty: 0, revenue: 0, cogs: 0 };
        byCat[key].sold_qty += s.sold_qty;
        byCat[key].revenue += s.revenue;
        byCat[key].cogs += s.cogs;
      });
      var arr = Object.values(byCat).filter(function (g) { return g.sold_qty > 0 || g.revenue !== 0 || g.cogs !== 0; });
      arr.forEach(function (g) {
        g.gross_profit = g.revenue - g.cogs;
        g.margin_pct = g.revenue > 0 ? (g.gross_profit / g.revenue) * 100 : 0;
      });
      arr.sort(function (a, b) { return b.gross_profit - a.gross_profit; });
      return arr;
    }
    if (groupBy === 'warehouse') {
      var whById = {};
      warehouses.forEach(function (w) { whById[w.id] = w; });
      var byWh = {};
      movements.forEach(function (m) {
        var d = m.moved_at ? String(m.moved_at).substring(0, 10) : '';
        if (dateFrom && d < dateFrom) return;
        if (dateTo && d > dateTo) return;
        var qty = Number(m.quantity || m.qty || 0);
        var rev = Number(m.revenue || 0);
        var cogs = Number(m.cogs || 0);
        var isOutbound = (m.movement_type === 'sale') || (m.type === 'sale') ||
                         (m.movement_type === 'outbound') || qty > 0;
        if (!isOutbound) return;
        var key = m.warehouse_id || '__unwh';
        var label = m.warehouse_id && whById[m.warehouse_id] ? whById[m.warehouse_id].name : '(No warehouse)';
        if (!byWh[key]) byWh[key] = { key: key, label: label, sold_qty: 0, revenue: 0, cogs: 0 };
        byWh[key].sold_qty += Math.abs(qty);
        byWh[key].revenue += rev;
        byWh[key].cogs += cogs;
      });
      var arr = Object.values(byWh);
      arr.forEach(function (g) {
        g.gross_profit = g.revenue - g.cogs;
        g.margin_pct = g.revenue > 0 ? (g.gross_profit / g.revenue) * 100 : 0;
      });
      arr.sort(function (a, b) { return b.gross_profit - a.gross_profit; });
      return arr;
    }
    return [];
  }, [groupBy, productStats, lists, warehouses, movements, dateFrom, dateTo]);

  // Grand totals
  var grandTotal = useMemo(function () {
    var t = { sold_qty: 0, revenue: 0, cogs: 0, gross_profit: 0 };
    rows.forEach(function (r) {
      t.sold_qty += r.sold_qty;
      t.revenue += r.revenue;
      t.cogs += r.cogs;
      t.gross_profit += r.gross_profit;
    });
    t.margin_pct = t.revenue > 0 ? (t.gross_profit / t.revenue) * 100 : 0;
    return t;
  }, [rows]);

  // Top 10 best/worst (only meaningful for per-product view)
  var topMovers = useMemo(function () {
    if (groupBy !== 'product') return null;
    var withSales = rows.slice();
    var best = withSales.slice(0, 10);
    var worst = withSales.slice().sort(function (a, b) { return a.gross_profit - b.gross_profit; }).slice(0, 10);
    var topRev = withSales.slice().sort(function (a, b) { return b.revenue - a.revenue; }).slice(0, 10);
    return { best: best, worst: worst, topRev: topRev };
  }, [groupBy, rows]);

  async function exportExcel() {
    try {
      var XLSX = await import('xlsx');
      var wb = XLSX.utils.book_new();
      // Sheet 1: current rows
      var headers = [groupBy === 'product' ? 'Product' : groupBy === 'category' ? 'Category' : 'Warehouse',
                     'Sold Qty', 'Revenue', 'COGS', 'Gross Profit', 'Margin %'];
      var aoa = [headers];
      rows.forEach(function (r) {
        aoa.push([r.label, r.sold_qty, r.revenue, r.cogs, r.gross_profit, r.margin_pct]);
      });
      // Total row
      aoa.push(['TOTAL', grandTotal.sold_qty, grandTotal.revenue, grandTotal.cogs, grandTotal.gross_profit, grandTotal.margin_pct]);
      var sheet = XLSX.utils.aoa_to_sheet(aoa);
      sheet['!cols'] = [{ wch: 40 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 }];
      XLSX.utils.book_append_sheet(wb, sheet, 'P&L by ' + groupBy);
      // Sheet 2: Filters used
      var infoAOA = [
        ['KTC NextTrade Hub — P&L Report'],
        [''],
        ['Generated', new Date().toISOString()],
        ['Group by', groupBy],
        ['Date from', dateFrom],
        ['Date to', dateTo],
        ['Total rows', rows.length],
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(infoAOA), 'Filters');
      var stamp = new Date().toISOString().substring(0, 10);
      XLSX.writeFile(wb, 'KTC-PnL-Report-' + groupBy + '-' + stamp + '.xlsx');
      toast.success('P&L report exported');
    } catch (e) {
      console.error('[pnl] export failed:', e);
      toast.error('Export failed: ' + ((e && e.message) || String(e)));
    }
  }

  function printReport() {
    try { window.print(); } catch (e) { /* ignore */ }
  }

  // ── Render ───────────────────────────────────────────────────
  if (!canSeePnL) {
    return (
      <div className="p-6">
        <RestrictedNotice title="Access restricted" message={'You do not have permission to view inventory P&L reports. Ask a super admin to grant you the "See Inventory P&L" permission.'} />
      </div>
    );
  }
  if (loading) {
    return <div className="p-6 text-center text-slate-600 font-semibold">Loading P&L data...</div>;
  }
  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border-2 border-red-200 rounded p-4 text-red-900 font-semibold">
          ⚠️ {error}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-700 via-teal-600 to-cyan-600 text-white rounded-lg p-4">
        <h2 className="text-xl font-extrabold">💹 P&L Reports / تقارير الأرباح</h2>
        <div className="text-xs font-semibold text-emerald-100 mt-1">
          Revenue, COGS, gross profit, and margin — by product, category, warehouse, or period
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border-2 border-slate-200 rounded-lg p-3 space-y-2">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
          <label className="block">
            <span className="text-xs font-extrabold text-slate-900">Group By</span>
            <select value={groupBy} onChange={function (e) { setGroupBy(e.target.value); }} className="w-full mt-0.5 px-2 py-1.5 border-2 border-slate-300 rounded text-sm bg-white text-slate-900 font-extrabold">
              <option value="product">Product</option>
              <option value="category">Category</option>
              <option value="warehouse">Warehouse</option>
            </select>
          </label>
          {/* v55.83-A.6.27.66 (C1) — currency filter. Defaults to EGP because
              it's the most common in KTC Egypt operations. 'all' is allowed
              but shows a warning that numbers are mixed-currency totals. */}
          <label className="block">
            <span className="text-xs font-extrabold text-slate-900">Currency</span>
            <select value={currencyFilter} onChange={function (e) { setCurrencyFilter(e.target.value); }} className="w-full mt-0.5 px-2 py-1.5 border-2 border-slate-300 rounded text-sm bg-white text-slate-900 font-extrabold">
              <option value="EGP">EGP only</option>
              <option value="USD">USD only</option>
              <option value="EUR">EUR only</option>
              <option value="all">All (mixed — numbers will be misleading!)</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-extrabold text-slate-900">Date From</span>
            <input type="date" value={dateFrom} onChange={function (e) { setDateFrom(e.target.value); }} className="w-full mt-0.5 px-2 py-1.5 border-2 border-slate-300 rounded text-sm bg-white text-slate-900" />
          </label>
          <label className="block">
            <span className="text-xs font-extrabold text-slate-900">Date To</span>
            <input type="date" value={dateTo} onChange={function (e) { setDateTo(e.target.value); }} className="w-full mt-0.5 px-2 py-1.5 border-2 border-slate-300 rounded text-sm bg-white text-slate-900" />
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-extrabold text-slate-900">Quick</span>
            <div className="flex gap-1 flex-wrap">
              <button onClick={function () { setDateFrom(firstOfMonth()); setDateTo(TODAY()); }} className="px-2 py-1 bg-slate-200 hover:bg-slate-300 text-slate-800 text-[10px] font-bold rounded">MTD</button>
              <button onClick={function () { setDateFrom(firstOfLastMonth()); setDateTo(lastOfLastMonth()); }} className="px-2 py-1 bg-slate-200 hover:bg-slate-300 text-slate-800 text-[10px] font-bold rounded">Last Mo</button>
              <button onClick={function () { setDateFrom(firstOfYear()); setDateTo(TODAY()); }} className="px-2 py-1 bg-slate-200 hover:bg-slate-300 text-slate-800 text-[10px] font-bold rounded">YTD</button>
              <button onClick={function () { setDateFrom('2014-01-01'); setDateTo(TODAY()); }} className="px-2 py-1 bg-slate-200 hover:bg-slate-300 text-slate-800 text-[10px] font-bold rounded">All</button>
            </div>
          </div>
        </div>
        {/* v55.83-A.6.27.66 (C1) — banner when mixing currencies */}
        {currencyFilter === 'all' && presentCurrencies.length > 1 && (
          <div className="rounded p-2 border-2" style={{ background: 'rgba(248,113,113,0.15)', borderColor: '#dc2626', color: '#fef2f2' }}>
            <span style={{ color: '#fca5a5', fontWeight: 800 }}>⚠ Mixed-currency totals:</span>{' '}
            <span style={{ color: '#fef2f2' }}>This range contains movements in {presentCurrencies.join(' + ')}. Numbers below are added without conversion and DO NOT reflect real profit. Pick a single currency to see meaningful figures.</span>
          </div>
        )}
        {currencyFilter !== 'all' && presentCurrencies.length > 1 && presentCurrencies.indexOf(currencyFilter) >= 0 && (
          <div className="rounded p-2 border-2 text-[11px]" style={{ background: 'rgba(56,189,248,0.1)', borderColor: '#0284c7', color: '#e0f2fe' }}>
            <span style={{ color: '#7dd3fc', fontWeight: 700 }}>ℹ Showing {currencyFilter} only.</span>{' '}
            <span style={{ color: '#e0f2fe' }}>Other currencies in this range ({presentCurrencies.filter(function (c) { return c !== currencyFilter; }).join(', ')}) are excluded.</span>
          </div>
        )}
        <div className="flex gap-2 flex-wrap pt-2 border-t border-slate-200">
          <button onClick={exportExcel} className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-extrabold rounded shadow">📊 Export Excel</button>
          <button onClick={printReport} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-800 text-white text-xs font-extrabold rounded shadow">🖨️ Print</button>
        </div>
      </div>

      {/* Grand totals */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <div className="bg-blue-100 border border-blue-300 rounded p-3">
          <div className="text-[10px] font-extrabold text-blue-900 uppercase tracking-wider">Sold Qty</div>
          <div className="text-lg font-mono font-extrabold text-blue-900">{fmtNum(grandTotal.sold_qty, 2)}</div>
        </div>
        <div className="bg-emerald-100 border border-emerald-300 rounded p-3">
          <div className="text-[10px] font-extrabold text-emerald-900 uppercase tracking-wider">Revenue</div>
          <div className="text-lg font-mono font-extrabold text-emerald-900">{fmtNum(grandTotal.revenue, 2)}</div>
        </div>
        <div className="bg-amber-100 border border-amber-300 rounded p-3">
          <div className="text-[10px] font-extrabold text-amber-900 uppercase tracking-wider">COGS</div>
          <div className="text-lg font-mono font-extrabold text-amber-900">{fmtNum(grandTotal.cogs, 2)}</div>
        </div>
        <div className={'border rounded p-3 ' + (grandTotal.gross_profit >= 0 ? 'bg-teal-100 border-teal-300' : 'bg-red-100 border-red-300')}>
          <div className={'text-[10px] font-extrabold uppercase tracking-wider ' + (grandTotal.gross_profit >= 0 ? 'text-teal-900' : 'text-red-900')}>Gross Profit</div>
          <div className={'text-lg font-mono font-extrabold ' + (grandTotal.gross_profit >= 0 ? 'text-teal-900' : 'text-red-900')}>{fmtNum(grandTotal.gross_profit, 2)}</div>
        </div>
        <div className="bg-violet-100 border border-violet-300 rounded p-3">
          <div className="text-[10px] font-extrabold text-violet-900 uppercase tracking-wider">Margin</div>
          <div className="text-lg font-mono font-extrabold text-violet-900">{fmtPct(grandTotal.margin_pct)}</div>
        </div>
      </div>

      {/* Main rows table */}
      {rows.length === 0 ? (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-8 text-center text-slate-600 italic">
          No sales activity in the selected date range. Try widening the date range or check that inventory_movements has data.
        </div>
      ) : (
        <div className="overflow-auto border-2 border-slate-200 rounded">
          <table className="w-full text-xs">
            <thead className="bg-slate-800 text-white">
              <tr>
                <th className="px-3 py-2 text-left font-extrabold uppercase tracking-wider">{groupBy.charAt(0).toUpperCase() + groupBy.slice(1)}</th>
                <th className="px-3 py-2 text-right font-extrabold uppercase tracking-wider">Sold Qty</th>
                <th className="px-3 py-2 text-right font-extrabold uppercase tracking-wider">Revenue</th>
                <th className="px-3 py-2 text-right font-extrabold uppercase tracking-wider">COGS</th>
                <th className="px-3 py-2 text-right font-extrabold uppercase tracking-wider">Gross Profit</th>
                <th className="px-3 py-2 text-right font-extrabold uppercase tracking-wider">Margin</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(function (r) {
                return (
                  <tr key={r.key} className="border-b border-slate-200 hover:bg-slate-50">
                    <td className="px-3 py-1.5 text-slate-900 font-semibold">{r.label}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-blue-900">{fmtNum(r.sold_qty, 2)}</td>
                    <td className="px-3 py-1.5 text-right font-mono font-bold text-emerald-800">{fmtNum(r.revenue, 2)}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-amber-800">{fmtNum(r.cogs, 2)}</td>
                    <td className={'px-3 py-1.5 text-right font-mono font-extrabold ' + (r.gross_profit >= 0 ? 'text-teal-800' : 'text-red-700')}>{fmtNum(r.gross_profit, 2)}</td>
                    <td className={'px-3 py-1.5 text-right font-mono font-extrabold ' + (r.margin_pct >= 0 ? 'text-violet-800' : 'text-red-700')}>{fmtPct(r.margin_pct)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-slate-200 font-extrabold">
                <td className="px-3 py-2 text-slate-900">TOTAL ({rows.length} rows)</td>
                <td className="px-3 py-2 text-right font-mono text-blue-900">{fmtNum(grandTotal.sold_qty, 2)}</td>
                <td className="px-3 py-2 text-right font-mono text-emerald-900">{fmtNum(grandTotal.revenue, 2)}</td>
                <td className="px-3 py-2 text-right font-mono text-amber-900">{fmtNum(grandTotal.cogs, 2)}</td>
                <td className={'px-3 py-2 text-right font-mono ' + (grandTotal.gross_profit >= 0 ? 'text-teal-900' : 'text-red-800')}>{fmtNum(grandTotal.gross_profit, 2)}</td>
                <td className={'px-3 py-2 text-right font-mono ' + (grandTotal.margin_pct >= 0 ? 'text-violet-900' : 'text-red-800')}>{fmtPct(grandTotal.margin_pct)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Top movers (only when group by product) */}
      {topMovers && rows.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-emerald-50 border-2 border-emerald-300 rounded-lg p-3">
            <div className="text-sm font-extrabold text-emerald-900 mb-2">🏆 Top 10 by Gross Profit</div>
            <div className="space-y-1">
              {topMovers.best.map(function (r, i) {
                return (
                  <div key={r.key} className="text-xs flex justify-between items-center bg-white border border-emerald-200 rounded px-2 py-1">
                    <span className="font-semibold text-slate-900 truncate flex-1">{i + 1}. {r.label}</span>
                    <span className="font-mono font-extrabold text-emerald-800 ml-2">{fmtNum(r.gross_profit, 2)}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="bg-red-50 border-2 border-red-300 rounded-lg p-3">
            <div className="text-sm font-extrabold text-red-900 mb-2">📉 Bottom 10 by Gross Profit</div>
            <div className="space-y-1">
              {topMovers.worst.map(function (r, i) {
                return (
                  <div key={r.key} className="text-xs flex justify-between items-center bg-white border border-red-200 rounded px-2 py-1">
                    <span className="font-semibold text-slate-900 truncate flex-1">{i + 1}. {r.label}</span>
                    <span className={'font-mono font-extrabold ml-2 ' + (r.gross_profit >= 0 ? 'text-teal-800' : 'text-red-700')}>{fmtNum(r.gross_profit, 2)}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="bg-blue-50 border-2 border-blue-300 rounded-lg p-3">
            <div className="text-sm font-extrabold text-blue-900 mb-2">💰 Top 10 by Revenue</div>
            <div className="space-y-1">
              {topMovers.topRev.map(function (r, i) {
                return (
                  <div key={r.key} className="text-xs flex justify-between items-center bg-white border border-blue-200 rounded px-2 py-1">
                    <span className="font-semibold text-slate-900 truncate flex-1">{i + 1}. {r.label}</span>
                    <span className="font-mono font-extrabold text-blue-800 ml-2">{fmtNum(r.revenue, 2)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
