'use client';
// v55.83-A.6.27.51 — Inventory Overview screen.
//
// One-screen view of "what do I have in stock right now?" Grouped by Product
// Family (textiles, pool supplies, etc.) as an accordion. Each row shows:
//   - Quick Code + Design SKU
//   - Name (EN / AR)
//   - Classification
//   - Current Stock (sum of inventory_layers.qty_remaining > 0)
//   - Original Stock (sum of inventory_stock_receipts.quantity)
//   - Sold (sum of invoice_items.sale_quantity WHERE inventory_status='consumed')
//   - Avg Cost (super_admin only) — weighted avg of current layers
//   - P&L (super_admin only) — sum of invoice_items.gross_profit
//
// Read-only. Tolerates missing tables / migrations. Bilingual.

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';

function fmtNum(n, dp) {
  if (n == null || n === '' || isNaN(Number(n))) return '—';
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: dp == null ? 2 : dp, maximumFractionDigits: dp == null ? 2 : dp });
}
function fmtInt(n) {
  if (n == null || n === '' || isNaN(Number(n))) return '—';
  return Number(n).toLocaleString();
}

export default function InventoryOverview(props) {
  var userProfile = props.userProfile;
  var modulePerms = props.modulePerms || {};
  var isSuperAdmin = props.isSuperAdmin === true;
  var toast = props.toast || { success: function(){}, error: function(){}, warning: function(){}, info: function(){} };

  // Permission: anyone with Inventory or Edit Inventory can VIEW the overview.
  // Cost + P&L columns are gated separately (super_admin only by default,
  // or anyone with the "See Inventory Costs" permission).
  var canView = isSuperAdmin || modulePerms['Inventory'] === true || modulePerms['Edit Inventory'] === true;
  var seeCosts = isSuperAdmin || modulePerms['See Inventory Costs'] === true;

  // Data
  var [products, setProducts] = useState([]);
  var [lists, setLists] = useState([]);
  var [layers, setLayers] = useState([]);          // inventory_layers (current stock)
  var [receipts, setReceipts] = useState([]);      // inventory_stock_receipts (original received)
  var [salesItems, setSalesItems] = useState([]);  // invoice_items where uses_inventory + variant_id
  var [loading, setLoading] = useState(true);
  var [error, setError] = useState(null);

  // UI state
  var [search, setSearch] = useState('');
  var [collapsedGroups, setCollapsedGroups] = useState({});  // { familyId: true } when collapsed
  var [showZeroStock, setShowZeroStock] = useState(false);   // hide rows with 0 current AND 0 received by default
  // v55.83-A.6.27.55 — hide Template Products by default. Templates have no
  // physical stock (they exist only to spawn variants), so including them in
  // "what's in stock" pollutes the totals + accordion. Off by default; toggle
  // exposes them for the rare case someone wants to audit templates too.
  var [showTemplates, setShowTemplates] = useState(false);

  // v55.83-A.6.27.51 — Cascading multi-level filters. User can filter by ANY
  // combination of the 9 classification levels. Each dropdown shows only the
  // options that match the higher-level filters that are already set.
  // Set to '' for "any value at this level."
  var [filterLevels, setFilterLevels] = useState({
    family_list_id: '',
    category_list_id: '',
    grade_list_id: '',
    construction_list_id: '',
    backing_list_id: '',
    color_list_id: '',
    pattern_list_id: '',
    spec_class_list_id: '',
    origin_list_id: '',
  });
  function setFilterLevel(field, val) {
    setFilterLevels(function (prev) {
      return Object.assign({}, prev, { [field]: val });
    });
  }
  function clearFilters() {
    setFilterLevels({
      family_list_id: '', category_list_id: '', grade_list_id: '', construction_list_id: '',
      backing_list_id: '', color_list_id: '', pattern_list_id: '', spec_class_list_id: '', origin_list_id: '',
    });
    setSearch('');
  }

  useEffect(function () {
    if (!canView) { setLoading(false); return; }
    var cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        // Tolerate-missing-table wrapper for tables introduced in newer migrations.
        var safe = function (q) {
          return q.then(function (r) { return r; }).catch(function (e) {
            console.warn('[inventory-overview] query failed:', e && e.message);
            return { data: [], error: e };
          });
        };

        var [prodRes, lstRes, layRes, recRes, soldRes] = await Promise.all([
          supabase.from('inventory_products').select('*').eq('active', true).order('updated_at', { ascending: false }),
          supabase.from('inventory_lists').select('id, level, code, label_en, label_ar').eq('active', true),
          safe(supabase.from('inventory_layers').select('product_id, qty_remaining, cost_per_uom').gt('qty_remaining', 0)),
          safe(supabase.from('inventory_stock_receipts').select('product_id, quantity')),
          safe(supabase.from('invoice_items').select('variant_id, sale_quantity, sale_price_per_uom, cogs_total, gross_profit, inventory_status').eq('inventory_status', 'consumed')),
        ]);
        if (cancelled) return;

        setProducts(prodRes.data || []);
        setLists(lstRes.data || []);
        setLayers((layRes && layRes.data) || []);
        setReceipts((recRes && recRes.data) || []);
        setSalesItems((soldRes && soldRes.data) || []);
      } catch (e) {
        if (!cancelled) {
          console.error('[inventory-overview] load failed:', e);
          setError((e && e.message) || String(e));
          toast.error('Failed to load inventory overview');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return function () { cancelled = true; };
  }, [canView]);

  // Build a list lookup by id (so we can resolve family/category names)
  var listsById = useMemo(function () {
    var m = {};
    lists.forEach(function (l) { m[l.id] = l; });
    return m;
  }, [lists]);

  // Build aggregations per product
  var productStats = useMemo(function () {
    var stats = {};
    // Initialize entry for every product
    products.forEach(function (p) {
      stats[p.id] = {
        current_qty: 0,
        current_weighted_cost: 0,  // sum(qty * cost) for weighted avg
        original_qty: 0,
        sold_qty: 0,
        sold_revenue: 0,
        cogs_total: 0,
        gross_profit: 0,
      };
    });
    // Sum layers (current stock + cost-weighted)
    layers.forEach(function (l) {
      var s = stats[l.product_id];
      if (!s) return;  // layer for unknown product
      var qty = Number(l.qty_remaining || 0);
      s.current_qty += qty;
      s.current_weighted_cost += qty * Number(l.cost_per_uom || 0);
    });
    // Sum receipts (original received)
    receipts.forEach(function (r) {
      var s = stats[r.product_id];
      if (!s) return;
      s.original_qty += Number(r.quantity || 0);
    });
    // Sum sales (sold_qty + revenue + cogs + gross_profit) — by variant_id
    salesItems.forEach(function (it) {
      var s = stats[it.variant_id];
      if (!s) return;
      var qty = Number(it.sale_quantity || 0);
      s.sold_qty += qty;
      s.sold_revenue += qty * Number(it.sale_price_per_uom || 0);
      s.cogs_total += Number(it.cogs_total || 0);
      s.gross_profit += Number(it.gross_profit || 0);
    });
    return stats;
  }, [products, layers, receipts, salesItems]);

  // Filter products by search term + zero-stock toggle + classification filters
  var filteredProducts = useMemo(function () {
    var q = (search || '').trim().toLowerCase();
    var keywords = q ? q.split(/\s+/).filter(Boolean) : [];
    var levelFields = Object.keys(filterLevels);
    return products.filter(function (p) {
      // v55.83-A.6.27.55 — hide template products by default (no physical stock).
      if (!showTemplates && p.is_family_template === true) return false;
      var s = productStats[p.id] || { current_qty: 0, original_qty: 0 };
      // Hide rows with zero current AND zero original unless toggle on
      if (!showZeroStock && s.current_qty === 0 && s.original_qty === 0) return false;
      // v55.83-A.6.27.51 — Apply classification-level filters (each is exact match
      // on list_id, or '' = any). All set filters must match (AND across levels).
      for (var fi = 0; fi < levelFields.length; fi++) {
        var f = levelFields[fi];
        var want = filterLevels[f];
        if (want && p[f] !== want) return false;
      }
      // Smart multi-keyword search across all the same fields as Inbound Shipments search
      if (keywords.length > 0) {
        var familyLabel = listsById[p.family_list_id] ? ((listsById[p.family_list_id].code || '') + ' ' + (listsById[p.family_list_id].label_en || '') + ' ' + (listsById[p.family_list_id].label_ar || '')) : '';
        var categoryLabel = listsById[p.category_list_id] ? ((listsById[p.category_list_id].code || '') + ' ' + (listsById[p.category_list_id].label_en || '') + ' ' + (listsById[p.category_list_id].label_ar || '')) : '';
        var searchable = ((p.quick_code || '') + ' ' + (p.design_sku || '') + ' ' + (p.name_en || '') + ' ' + (p.name_ar || '') + ' ' + (p.classification_slug || '') + ' ' + familyLabel + ' ' + categoryLabel).toLowerCase();
        for (var i = 0; i < keywords.length; i++) {
          if (searchable.indexOf(keywords[i]) < 0) return false;
        }
      }
      return true;
    });
  }, [products, productStats, listsById, search, showZeroStock, showTemplates, filterLevels]);

  // v55.83-A.6.27.51 — Cascading dropdown options.
  // For each level, the available options are derived from products that match
  // ALL HIGHER-level filters. So picking Family=Textiles narrows the Category
  // dropdown to only categories that exist within Textile products, and so on.
  var availableOptionsByLevel = useMemo(function () {
    var levelOrder = [
      'family_list_id', 'category_list_id', 'grade_list_id', 'construction_list_id',
      'backing_list_id', 'color_list_id', 'pattern_list_id', 'spec_class_list_id', 'origin_list_id',
    ];
    var result = {};
    // For each level, build the set of list_ids present in products that match
    // every filter EXCEPT this level's own filter (so the user can change their
    // mind without first un-setting).
    levelOrder.forEach(function (lvl) {
      var ids = {};
      products.forEach(function (p) {
        // Apply all OTHER levels' filters; skip the current level
        var match = true;
        for (var i = 0; i < levelOrder.length; i++) {
          var other = levelOrder[i];
          if (other === lvl) continue;
          var want = filterLevels[other];
          if (want && p[other] !== want) { match = false; break; }
        }
        if (match && p[lvl]) ids[p[lvl]] = true;
      });
      // Convert ids → option array with label
      var opts = Object.keys(ids).map(function (id) {
        var l = listsById[id];
        return {
          id: id,
          code: l ? (l.code || '') : '',
          label: l ? ((l.label_en || '') + (l.label_ar ? ' / ' + l.label_ar : '')) : id,
        };
      });
      opts.sort(function (a, b) { return (a.label || '').localeCompare(b.label || ''); });
      result[lvl] = opts;
    });
    return result;
  }, [products, filterLevels, listsById]);

  // How many filters are currently active
  var activeFilterCount = useMemo(function () {
    var c = 0;
    Object.keys(filterLevels).forEach(function (k) { if (filterLevels[k]) c++; });
    if (search.trim()) c++;
    return c;
  }, [filterLevels, search]);

  // Group by family
  var grouped = useMemo(function () {
    var groups = {};  // { family_list_id: { label_en, label_ar, code, products: [], totals } }
    var ungroupedKey = '__ungrouped__';
    filteredProducts.forEach(function (p) {
      var familyId = p.family_list_id || ungroupedKey;
      if (!groups[familyId]) {
        var lst = familyId === ungroupedKey ? null : listsById[familyId];
        groups[familyId] = {
          family_id: familyId,
          code: lst ? (lst.code || '—') : '—',
          label_en: lst ? (lst.label_en || 'Unclassified') : 'Unclassified',
          label_ar: lst ? (lst.label_ar || 'غير مصنف') : 'غير مصنف',
          products: [],
          totals: {
            current_qty: 0, original_qty: 0, sold_qty: 0,
            sold_revenue: 0, cogs_total: 0, gross_profit: 0,
          },
        };
      }
      groups[familyId].products.push(p);
      var s = productStats[p.id] || {};
      groups[familyId].totals.current_qty += s.current_qty || 0;
      groups[familyId].totals.original_qty += s.original_qty || 0;
      groups[familyId].totals.sold_qty += s.sold_qty || 0;
      groups[familyId].totals.sold_revenue += s.sold_revenue || 0;
      groups[familyId].totals.cogs_total += s.cogs_total || 0;
      groups[familyId].totals.gross_profit += s.gross_profit || 0;
    });
    // Convert to sorted array (alphabetic by label_en, "Unclassified" last)
    var arr = Object.keys(groups).map(function (k) { return groups[k]; });
    arr.sort(function (a, b) {
      if (a.family_id === ungroupedKey) return 1;
      if (b.family_id === ungroupedKey) return -1;
      return (a.label_en || '').localeCompare(b.label_en || '');
    });
    return arr;
  }, [filteredProducts, productStats, listsById]);

  // Grand totals across all visible products
  var grandTotals = useMemo(function () {
    var t = { current_qty: 0, original_qty: 0, sold_qty: 0, sold_revenue: 0, cogs_total: 0, gross_profit: 0, product_count: 0 };
    grouped.forEach(function (g) {
      t.current_qty += g.totals.current_qty;
      t.original_qty += g.totals.original_qty;
      t.sold_qty += g.totals.sold_qty;
      t.sold_revenue += g.totals.sold_revenue;
      t.cogs_total += g.totals.cogs_total;
      t.gross_profit += g.totals.gross_profit;
      t.product_count += g.products.length;
    });
    return t;
  }, [grouped]);

  function toggleGroup(familyId) {
    setCollapsedGroups(function (prev) {
      var copy = Object.assign({}, prev);
      if (copy[familyId]) delete copy[familyId];
      else copy[familyId] = true;
      return copy;
    });
  }
  function collapseAll() { var c = {}; grouped.forEach(function (g) { c[g.family_id] = true; }); setCollapsedGroups(c); }
  function expandAll() { setCollapsedGroups({}); }

  if (!canView) {
    return (
      <div className="bg-amber-50 border-2 border-amber-300 rounded-lg p-4 text-amber-900 font-semibold">
        You don&apos;t have permission to view the Inventory Overview. Ask a super admin to grant you the &quot;Inventory&quot; permission.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-700 to-purple-700 text-white rounded-xl p-4 shadow-md">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-indigo-100">Inventory Overview / نظرة عامة على المخزون</div>
            <div className="text-2xl font-extrabold mt-0.5">📊 What&apos;s in stock right now</div>
            <div className="text-sm font-semibold text-indigo-50 mt-0.5" style={{ direction: 'rtl' }}>المخزون الحالي حسب فئة المنتج</div>
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <button onClick={expandAll} className="px-3 py-1.5 bg-white text-indigo-900 text-xs font-extrabold rounded shadow hover:bg-indigo-50">⬇ Expand All / فتح الكل</button>
            <button onClick={collapseAll} className="px-3 py-1.5 bg-slate-800 text-white text-xs font-extrabold rounded shadow hover:bg-slate-900">⬆ Collapse All / طي الكل</button>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="bg-white border-2 border-slate-300 rounded-lg p-3 flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={function (e) { setSearch(e.target.value); }}
          placeholder="Search by code, design SKU, name, category, family..."
          className="flex-1 min-w-[280px] px-3 py-2 border-2 border-slate-300 rounded text-sm bg-white text-slate-900 font-bold"
        />
        <label className="flex items-center gap-1.5 text-xs font-extrabold text-slate-900">
          <input type="checkbox" checked={showZeroStock} onChange={function (e) { setShowZeroStock(e.target.checked); }} className="w-4 h-4" />
          Show zero-stock items / إظهار المخزون الصفري
        </label>
        <label className="flex items-center gap-1.5 text-xs font-extrabold text-slate-900" title="Template Products have no physical stock — they're only used to create variants.">
          <input type="checkbox" checked={showTemplates} onChange={function (e) { setShowTemplates(e.target.checked); }} className="w-4 h-4" />
          Show Template Products / إظهار قوالب المنتجات
        </label>
        {activeFilterCount > 0 && (
          <button
            onClick={clearFilters}
            className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-extrabold rounded shadow"
          >
            ✕ Clear {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'} / مسح
          </button>
        )}
      </div>

      {/* v55.83-A.6.27.51 — Cascading classification filters.
          9 dropdowns, one per level. Options cascade: choosing Family=Textiles
          narrows the Category dropdown to categories that exist in Textile products. */}
      <details className="bg-white border-2 border-indigo-300 rounded-lg" open={activeFilterCount > 0}>
        <summary className="px-4 py-2 cursor-pointer font-extrabold text-slate-900 bg-indigo-50 hover:bg-indigo-100 rounded-t-lg flex items-center justify-between">
          <span>🔍 Filter by classification (Family → Category → Grade → ...) / تصفية حسب التصنيف</span>
          {activeFilterCount > 0 && (
            <span className="text-xs bg-indigo-700 text-white px-2 py-0.5 rounded">{activeFilterCount} active</span>
          )}
        </summary>
        <div className="p-3 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-2">
          {[
            { field: 'family_list_id',      label_en: '1. Family',       label_ar: 'العائلة' },
            { field: 'category_list_id',    label_en: '2. Category',     label_ar: 'الفئة' },
            { field: 'grade_list_id',       label_en: '3. Grade',        label_ar: 'الدرجة' },
            { field: 'construction_list_id',label_en: '4. Construction', label_ar: 'التركيب' },
            { field: 'backing_list_id',     label_en: '5. Backing',      label_ar: 'الظهر' },
            { field: 'color_list_id',       label_en: '6. Color',        label_ar: 'اللون' },
            { field: 'pattern_list_id',     label_en: '7. Pattern',      label_ar: 'النقش' },
            { field: 'spec_class_list_id',  label_en: '8. Spec',         label_ar: 'المواصفات' },
            { field: 'origin_list_id',      label_en: '9. Origin',       label_ar: 'المنشأ' },
          ].map(function (f) {
            var opts = availableOptionsByLevel[f.field] || [];
            var current = filterLevels[f.field] || '';
            // Disable if no options available AND no value currently selected
            // (i.e., the higher-level filter eliminated this level entirely).
            var disabled = opts.length === 0 && !current;
            return (
              <label key={f.field} className="block">
                <span className="text-[11px] font-extrabold text-slate-900 block">{f.label_en} <span className="text-slate-600" style={{direction:'rtl'}}>/ {f.label_ar}</span></span>
                <select
                  value={current}
                  onChange={function (e) { setFilterLevel(f.field, e.target.value); }}
                  disabled={disabled}
                  className={'w-full mt-0.5 px-2 py-1.5 border-2 rounded text-sm font-bold ' + (current ? 'border-indigo-500 bg-indigo-50 text-indigo-900' : disabled ? 'border-slate-200 bg-slate-100 text-slate-400' : 'border-slate-300 bg-white text-slate-900')}
                >
                  <option value="">{disabled ? '— none match —' : '— Any —'}</option>
                  {opts.map(function (o) {
                    return <option key={o.id} value={o.id}>{o.code ? o.code + ' — ' : ''}{o.label}</option>;
                  })}
                </select>
              </label>
            );
          })}
        </div>
      </details>

      {/* Grand totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="bg-slate-800 text-white rounded p-2 shadow">
          <div className="text-[10px] font-bold uppercase tracking-wider">Products / منتجات</div>
          <div className="text-xl font-extrabold mt-0.5">{fmtInt(grandTotals.product_count)}</div>
        </div>
        <div className="bg-blue-700 text-white rounded p-2 shadow">
          <div className="text-[10px] font-bold uppercase tracking-wider">Current Stock / المخزون الحالي</div>
          <div className="text-xl font-extrabold mt-0.5">{fmtNum(grandTotals.current_qty, 2)}</div>
        </div>
        <div className="bg-indigo-700 text-white rounded p-2 shadow">
          <div className="text-[10px] font-bold uppercase tracking-wider">Original Stock / الأصلي</div>
          <div className="text-xl font-extrabold mt-0.5">{fmtNum(grandTotals.original_qty, 2)}</div>
        </div>
        <div className="bg-emerald-700 text-white rounded p-2 shadow">
          <div className="text-[10px] font-bold uppercase tracking-wider">Sold / المباع</div>
          <div className="text-xl font-extrabold mt-0.5">{fmtNum(grandTotals.sold_qty, 2)}</div>
        </div>
      </div>
      {seeCosts && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <div className="bg-amber-700 text-white rounded p-2 shadow">
            <div className="text-[10px] font-bold uppercase tracking-wider">Revenue / الإيرادات</div>
            <div className="text-xl font-extrabold mt-0.5">{fmtNum(grandTotals.sold_revenue, 2)}</div>
          </div>
          <div className="bg-orange-700 text-white rounded p-2 shadow">
            <div className="text-[10px] font-bold uppercase tracking-wider">COGS / التكلفة</div>
            <div className="text-xl font-extrabold mt-0.5">{fmtNum(grandTotals.cogs_total, 2)}</div>
          </div>
          <div className={(grandTotals.gross_profit >= 0 ? 'bg-emerald-800' : 'bg-red-700') + ' text-white rounded p-2 shadow'}>
            <div className="text-[10px] font-bold uppercase tracking-wider">Gross Profit / الربح الإجمالي</div>
            <div className="text-xl font-extrabold mt-0.5">{fmtNum(grandTotals.gross_profit, 2)}</div>
          </div>
        </div>
      )}

      {/* Loading / error / empty states */}
      {loading && <div className="text-center py-10 text-slate-600 font-bold">Loading inventory... / جاري التحميل</div>}
      {error && !loading && (
        <div className="bg-red-100 border-2 border-red-400 text-red-900 rounded p-3 font-bold">
          Failed to load: {error}
        </div>
      )}
      {!loading && !error && grouped.length === 0 && (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-lg p-6 text-center">
          <div className="text-base font-extrabold text-amber-900">No inventory to show / لا يوجد مخزون</div>
          <div className="text-xs text-amber-700 mt-1">
            {search ? 'Try a different search term, or' : 'Either no products are stocked yet, or'}
            {' check "Show zero-stock items" to include products with no current or original stock.'}
          </div>
        </div>
      )}

      {/* Accordion groups */}
      {!loading && !error && grouped.length > 0 && grouped.map(function (g) {
        var collapsed = !!collapsedGroups[g.family_id];
        return (
          <div key={g.family_id} className="bg-white border-2 border-slate-300 rounded-lg overflow-hidden">
            {/* Group header — click to toggle */}
            <button
              onClick={function () { toggleGroup(g.family_id); }}
              className="w-full px-4 py-3 bg-slate-100 hover:bg-slate-200 flex items-center justify-between text-left"
            >
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-lg font-extrabold text-slate-900">{collapsed ? '▶' : '▼'}</span>
                <span className="px-2 py-0.5 bg-slate-800 text-white text-xs font-extrabold rounded">{g.code}</span>
                <span className="text-base font-extrabold text-slate-900">{g.label_en}</span>
                <span className="text-sm font-bold text-slate-700" style={{ direction: 'rtl' }}>/ {g.label_ar}</span>
                <span className="text-xs text-slate-700 font-semibold">({g.products.length} {g.products.length === 1 ? 'product' : 'products'})</span>
              </div>
              <div className="flex items-center gap-3 text-xs font-bold text-slate-800 flex-wrap">
                <div>Current: <span className="text-blue-900">{fmtNum(g.totals.current_qty, 2)}</span></div>
                <div>Original: <span className="text-indigo-900">{fmtNum(g.totals.original_qty, 2)}</span></div>
                <div>Sold: <span className="text-emerald-800">{fmtNum(g.totals.sold_qty, 2)}</span></div>
                {seeCosts && (
                  <div>P&amp;L: <span className={g.totals.gross_profit >= 0 ? 'text-emerald-800' : 'text-red-700'}>{fmtNum(g.totals.gross_profit, 2)}</span></div>
                )}
              </div>
            </button>

            {/* Group body — products table */}
            {!collapsed && (
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-extrabold text-slate-900 border-b-2 border-slate-300">Code</th>
                      <th className="px-3 py-2 text-left text-xs font-extrabold text-slate-900 border-b-2 border-slate-300">Design SKU</th>
                      <th className="px-3 py-2 text-left text-xs font-extrabold text-slate-900 border-b-2 border-slate-300">Name</th>
                      <th className="px-3 py-2 text-right text-xs font-extrabold text-slate-900 border-b-2 border-slate-300">Current</th>
                      <th className="px-3 py-2 text-right text-xs font-extrabold text-slate-900 border-b-2 border-slate-300">Original</th>
                      <th className="px-3 py-2 text-right text-xs font-extrabold text-slate-900 border-b-2 border-slate-300">Sold</th>
                      {seeCosts && (
                        <>
                          <th className="px-3 py-2 text-right text-xs font-extrabold text-slate-900 border-b-2 border-slate-300 bg-amber-50">Avg Cost</th>
                          <th className="px-3 py-2 text-right text-xs font-extrabold text-slate-900 border-b-2 border-slate-300 bg-amber-50">Avg Sold Price</th>
                          <th className="px-3 py-2 text-right text-xs font-extrabold text-slate-900 border-b-2 border-slate-300 bg-amber-50">P&amp;L</th>
                        </>
                      )}
                      <th className="px-3 py-2 text-left text-xs font-extrabold text-slate-900 border-b-2 border-slate-300">UoM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.products.map(function (p) {
                      var s = productStats[p.id] || { current_qty: 0, current_weighted_cost: 0, original_qty: 0, sold_qty: 0, sold_revenue: 0, cogs_total: 0, gross_profit: 0 };
                      var avgCost = s.current_qty > 0 ? s.current_weighted_cost / s.current_qty : 0;
                      var avgSoldPrice = s.sold_qty > 0 ? s.sold_revenue / s.sold_qty : 0;
                      return (
                        <tr key={p.id} className="border-b border-slate-200 hover:bg-slate-50">
                          <td className="px-3 py-1.5 font-mono text-slate-900 font-bold">
                            {p.quick_code || '—'}
                            {p.variant_suffix && <span className="text-slate-700">-{p.variant_suffix}</span>}
                          </td>
                          <td className="px-3 py-1.5 font-mono text-slate-700">{p.design_sku || '—'}</td>
                          <td className="px-3 py-1.5">
                            <div className="font-bold text-slate-900">{p.name_en || '—'}</div>
                            {p.name_ar && <div className="text-xs text-slate-700" style={{ direction: 'rtl' }}>{p.name_ar}</div>}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono font-extrabold text-blue-900">{fmtNum(s.current_qty, 2)}</td>
                          <td className="px-3 py-1.5 text-right font-mono text-indigo-900">{fmtNum(s.original_qty, 2)}</td>
                          <td className="px-3 py-1.5 text-right font-mono text-emerald-800">{fmtNum(s.sold_qty, 2)}</td>
                          {seeCosts && (
                            <>
                              <td className="px-3 py-1.5 text-right font-mono text-slate-900 bg-amber-50">{fmtNum(avgCost, 2)}</td>
                              <td className="px-3 py-1.5 text-right font-mono text-slate-900 bg-amber-50">{fmtNum(avgSoldPrice, 2)}</td>
                              <td className={'px-3 py-1.5 text-right font-mono font-extrabold bg-amber-50 ' + (s.gross_profit >= 0 ? 'text-emerald-800' : 'text-red-700')}>{fmtNum(s.gross_profit, 2)}</td>
                            </>
                          )}
                          <td className="px-3 py-1.5 text-xs text-slate-700">{p.default_uom || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}

      {/* Footer note about super_admin gating */}
      {!seeCosts && !loading && (
        <div className="text-xs text-slate-600 italic mt-2">
          Avg Cost and P&amp;L columns are hidden. Ask a super admin to grant you the &quot;See Inventory Costs&quot; permission to view them.
        </div>
      )}
    </div>
  );
}
