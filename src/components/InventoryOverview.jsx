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

  // v55.83-A.6.27.60 — History drilldown modal state. When user clicks "↗ History"
  // on a product row, this opens a modal showing all inbound shipments, outbound
  // sales, and the current stock summary for that product.
  var [historyProduct, setHistoryProduct] = useState(null); // null = closed; object = open for that product
  var [historyLayers, setHistoryLayers] = useState([]);     // inventory_layers rows for inbound history
  var [historyMovements, setHistoryMovements] = useState([]); // inventory_movements rows for outbound history
  var [historyLoading, setHistoryLoading] = useState(false);
  var [historyError, setHistoryError] = useState(null);

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

  // v55.83-A.6.27.60 — open the product History drawer.
  // Fetches inventory_layers (inbound shipments) and inventory_movements
  // (outbound sales / adjustments) for the given product. Each query is in its
  // own try/catch so a single missing table doesn't kill the whole drawer.
  async function openHistory(product) {
    if (!product) return;
    setHistoryProduct(product);
    setHistoryLayers([]);
    setHistoryMovements([]);
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      var layersRes = await supabase
        .from('inventory_layers')
        .select('*')
        .eq('product_id', product.id)
        .order('received_at', { ascending: false });
      if (!layersRes.error) setHistoryLayers(layersRes.data || []);
      else console.warn('[history] layers query failed:', layersRes.error.message);
    } catch (e) { console.warn('[history] layers threw:', e); }
    try {
      var movRes = await supabase
        .from('inventory_movements')
        .select('*')
        .eq('product_id', product.id)
        .order('moved_at', { ascending: false });
      if (!movRes.error) setHistoryMovements(movRes.data || []);
      else console.warn('[history] movements query failed:', movRes.error.message);
    } catch (e) { console.warn('[history] movements threw:', e); }
    setHistoryLoading(false);
  }
  function closeHistory() {
    setHistoryProduct(null);
    setHistoryLayers([]);
    setHistoryMovements([]);
    setHistoryError(null);
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
      {/* Header — v55.83-A.6.27.72 HOTFIX 16. Centered title per Max's request:
          "make it more professional looking ... center what's in stock now".
          Title block is dead-center horizontally; Expand/Collapse buttons sit
          in the top-right corner without competing for vertical space. */}
      <div className="relative bg-gradient-to-br from-slate-900 via-indigo-900 to-purple-900 text-white rounded-xl px-4 py-6 shadow-xl border border-indigo-700/30 overflow-hidden">
        {/* Subtle decorative gradient halo */}
        <div className="absolute -top-20 -right-20 w-64 h-64 bg-indigo-500 opacity-10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 w-48 h-48 bg-purple-500 opacity-10 rounded-full blur-3xl pointer-events-none" />
        {/* Action buttons — top-right */}
        <div className="absolute top-3 right-3 flex gap-2 z-10">
          <button onClick={expandAll} className="px-3 py-1.5 bg-white/10 hover:bg-white/20 backdrop-blur-sm text-white text-xs font-extrabold rounded-lg border border-white/20 transition">⬇ Expand All</button>
          <button onClick={collapseAll} className="px-3 py-1.5 bg-white/10 hover:bg-white/20 backdrop-blur-sm text-white text-xs font-extrabold rounded-lg border border-white/20 transition">⬆ Collapse All</button>
        </div>
        {/* Centered title block */}
        <div className="text-center relative z-0">
          <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-indigo-300 mb-1">Inventory Overview · نظرة عامة على المخزون</div>
          <div className="text-3xl font-extrabold mt-1 bg-gradient-to-r from-white via-indigo-100 to-purple-100 bg-clip-text text-transparent">
            📊 What&apos;s in stock right now
          </div>
          <div className="text-sm font-semibold text-indigo-200 mt-1" style={{ direction: 'rtl' }}>المخزون الحالي حسب فئة المنتج</div>
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
        <label className="flex items-center gap-1.5 text-xs font-extrabold text-slate-900" title="Template Products have no physical stock — they're only used to create Products.">
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
      {/* v55.83-A.6.27.60 — Filter section defaults to ALWAYS OPEN (was: open only
          when filters active). User wanted all 9 levels visible by default per Max
          May 22 2026 — option A. */}
      <details className="bg-white border border-slate-200 rounded-lg shadow-sm" open>
        <summary className="px-4 py-2.5 cursor-pointer font-extrabold text-slate-900 bg-gradient-to-r from-slate-50 to-indigo-50/50 hover:from-slate-100 hover:to-indigo-100/50 rounded-t-lg flex items-center justify-between border-b border-slate-200">
          <span className="flex items-center gap-2">
            <span className="text-indigo-600">🔍</span>
            <span>Filter by classification</span>
            <span className="text-[10px] text-slate-500 font-semibold tracking-wider">Family → Category → Grade → ...</span>
          </span>
          {activeFilterCount > 0 && (
            <span className="text-xs bg-indigo-700 text-white px-2 py-0.5 rounded-full font-bold">{activeFilterCount} active</span>
          )}
        </summary>
        <div className="p-3 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {[
            { field: 'family_list_id',      label_en: 'Family',       label_ar: 'العائلة',   level: 1 },
            { field: 'category_list_id',    label_en: 'Category',     label_ar: 'الفئة',     level: 2 },
            { field: 'grade_list_id',       label_en: 'Grade',        label_ar: 'الدرجة',    level: 3 },
            { field: 'construction_list_id',label_en: 'Construction', label_ar: 'التركيب',   level: 4 },
            { field: 'backing_list_id',     label_en: 'Backing',      label_ar: 'الظهر',     level: 5 },
            { field: 'color_list_id',       label_en: 'Color',        label_ar: 'اللون',     level: 6 },
            { field: 'pattern_list_id',     label_en: 'Pattern',      label_ar: 'النقش',     level: 7 },
            { field: 'spec_class_list_id',  label_en: 'Spec',         label_ar: 'المواصفات', level: 8 },
            { field: 'origin_list_id',      label_en: 'Origin',       label_ar: 'المنشأ',    level: 9 },
          ].map(function (f) {
            var opts = availableOptionsByLevel[f.field] || [];
            var current = filterLevels[f.field] || '';
            var disabled = opts.length === 0 && !current;
            return (
              <label key={f.field} className="block">
                {/* HOTFIX 16 — Level badge + label, tighter typography */}
                <span className="flex items-center gap-1.5 mb-1">
                  <span className={'inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-extrabold ' + (current ? 'bg-indigo-600 text-white' : disabled ? 'bg-slate-200 text-slate-400' : 'bg-slate-200 text-slate-700')}>{f.level}</span>
                  <span className={'text-[11px] font-extrabold ' + (current ? 'text-indigo-900' : 'text-slate-800')}>{f.label_en}</span>
                  <span className="text-[10px] text-slate-500" style={{direction:'rtl'}}>{f.label_ar}</span>
                </span>
                <select
                  value={current}
                  onChange={function (e) { setFilterLevel(f.field, e.target.value); }}
                  disabled={disabled}
                  className={'w-full px-2.5 py-1.5 border rounded-md text-sm font-bold transition shadow-sm ' + (current ? 'border-indigo-500 bg-indigo-50 text-indigo-900 ring-1 ring-indigo-200' : disabled ? 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed' : 'border-slate-300 bg-white text-slate-900 hover:border-slate-400')}
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

      {/* Grand totals — v55.83-A.6.27.72 HOTFIX 16: world-class inventory aesthetic.
          Dark slate base + colored left-border accent + icon badge + tabular numbers.
          Replaces flat saturated tiles with something that reads as professional. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="bg-slate-900 text-white rounded-lg shadow-lg border-l-4 border-slate-500 px-3 py-2.5 flex items-center gap-3">
          <div className="text-2xl opacity-80">📦</div>
          <div className="flex-1 min-w-0">
            <div className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-400">Products</div>
            <div className="text-2xl font-extrabold mt-0 leading-tight tabular-nums">{fmtInt(grandTotals.product_count)}</div>
            <div className="text-[9px] text-slate-500" style={{ direction: 'rtl' }}>منتجات</div>
          </div>
        </div>
        <div className="bg-slate-900 text-white rounded-lg shadow-lg border-l-4 border-blue-500 px-3 py-2.5 flex items-center gap-3">
          <div className="text-2xl opacity-80">📊</div>
          <div className="flex-1 min-w-0">
            <div className="text-[9px] font-bold uppercase tracking-[0.15em] text-blue-300">Current Stock</div>
            <div className="text-2xl font-extrabold mt-0 leading-tight tabular-nums text-blue-100">{fmtNum(grandTotals.current_qty, 2)}</div>
            <div className="text-[9px] text-blue-400" style={{ direction: 'rtl' }}>المخزون الحالي</div>
          </div>
        </div>
        <div className="bg-slate-900 text-white rounded-lg shadow-lg border-l-4 border-indigo-500 px-3 py-2.5 flex items-center gap-3">
          <div className="text-2xl opacity-80">🗂️</div>
          <div className="flex-1 min-w-0">
            <div className="text-[9px] font-bold uppercase tracking-[0.15em] text-indigo-300">Original Stock</div>
            <div className="text-2xl font-extrabold mt-0 leading-tight tabular-nums text-indigo-100">{fmtNum(grandTotals.original_qty, 2)}</div>
            <div className="text-[9px] text-indigo-400" style={{ direction: 'rtl' }}>الأصلي</div>
          </div>
        </div>
        <div className="bg-slate-900 text-white rounded-lg shadow-lg border-l-4 border-emerald-500 px-3 py-2.5 flex items-center gap-3">
          <div className="text-2xl opacity-80">✅</div>
          <div className="flex-1 min-w-0">
            <div className="text-[9px] font-bold uppercase tracking-[0.15em] text-emerald-300">Sold</div>
            <div className="text-2xl font-extrabold mt-0 leading-tight tabular-nums text-emerald-100">{fmtNum(grandTotals.sold_qty, 2)}</div>
            <div className="text-[9px] text-emerald-400" style={{ direction: 'rtl' }}>المباع</div>
          </div>
        </div>
      </div>
      {seeCosts && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <div className="bg-slate-900 text-white rounded-lg shadow-lg border-l-4 border-amber-500 px-3 py-2.5 flex items-center gap-3">
            <div className="text-2xl opacity-80">💰</div>
            <div className="flex-1 min-w-0">
              <div className="text-[9px] font-bold uppercase tracking-[0.15em] text-amber-300">Revenue</div>
              <div className="text-2xl font-extrabold mt-0 leading-tight tabular-nums text-amber-100">{fmtNum(grandTotals.sold_revenue, 2)}</div>
              <div className="text-[9px] text-amber-400" style={{ direction: 'rtl' }}>الإيرادات</div>
            </div>
          </div>
          <div className="bg-slate-900 text-white rounded-lg shadow-lg border-l-4 border-orange-500 px-3 py-2.5 flex items-center gap-3">
            <div className="text-2xl opacity-80">📉</div>
            <div className="flex-1 min-w-0">
              <div className="text-[9px] font-bold uppercase tracking-[0.15em] text-orange-300">COGS</div>
              <div className="text-2xl font-extrabold mt-0 leading-tight tabular-nums text-orange-100">{fmtNum(grandTotals.cogs_total, 2)}</div>
              <div className="text-[9px] text-orange-400" style={{ direction: 'rtl' }}>التكلفة</div>
            </div>
          </div>
          <div className={'bg-slate-900 text-white rounded-lg shadow-lg border-l-4 px-3 py-2.5 flex items-center gap-3 ' + (grandTotals.gross_profit >= 0 ? 'border-emerald-500' : 'border-red-500')}>
            <div className="text-2xl opacity-80">{grandTotals.gross_profit >= 0 ? '📈' : '⚠️'}</div>
            <div className="flex-1 min-w-0">
              <div className={'text-[9px] font-bold uppercase tracking-[0.15em] ' + (grandTotals.gross_profit >= 0 ? 'text-emerald-300' : 'text-red-300')}>Gross Profit</div>
              <div className={'text-2xl font-extrabold mt-0 leading-tight tabular-nums ' + (grandTotals.gross_profit >= 0 ? 'text-emerald-100' : 'text-red-100')}>{fmtNum(grandTotals.gross_profit, 2)}</div>
              <div className={'text-[9px] ' + (grandTotals.gross_profit >= 0 ? 'text-emerald-400' : 'text-red-400')} style={{ direction: 'rtl' }}>الربح الإجمالي</div>
            </div>
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
                      // v55.83-A.6.27.60 — 9-level classification labels for inline display
                      var levelLabels = [
                        ['F', listsById[p.family_list_id]],
                        ['Cat', listsById[p.category_list_id]],
                        ['Gr', listsById[p.grade_list_id]],
                        ['Co', listsById[p.construction_list_id]],
                        ['B', listsById[p.backing_list_id]],
                        ['Cl', listsById[p.color_list_id]],
                        ['P', listsById[p.pattern_list_id]],
                        ['Sp', listsById[p.spec_class_list_id]],
                        ['O', listsById[p.origin_list_id]],
                      ].filter(function (pair) { return pair[1]; });
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
                            {/* v55.83-A.6.27.60 — All 9 classification levels inline under name */}
                            {levelLabels.length > 0 && (
                              <div className="text-[10px] text-slate-600 mt-0.5 leading-relaxed">
                                {levelLabels.map(function (pair, i) {
                                  return (
                                    <span key={i} className="inline-block mr-2">
                                      <span className="font-bold text-slate-500">{pair[0]}:</span>{' '}
                                      <span className="text-slate-800">{pair[1].label_en || pair[1].code}</span>
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                            {/* v55.83-A.6.27.60 — History drilldown link */}
                            <button
                              onClick={function () { openHistory(p); }}
                              className="text-[10px] text-blue-700 hover:text-blue-900 font-bold mt-0.5 hover:underline"
                              title="View inbound shipments, outbound sales, and stock history for this product"
                            >↗ History</button>
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

      {/* v55.83-A.6.27.60 — Product History drilldown modal.
          Opens when user clicks "↗ History" on any product row. Shows:
            • Stock summary (current / original / sold / avg cost / P&L)
            • Inbound shipments (inventory_layers — when stock was received)
            • Outbound movements (inventory_movements — sales + adjustments) */}
      {historyProduct && (
        <div className="fixed inset-0 bg-black/60 z-[120] flex items-start justify-center p-4 overflow-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl my-4">
            {/* Modal header */}
            <div className="bg-gradient-to-r from-blue-700 to-indigo-700 text-white rounded-t-2xl px-5 py-3 flex justify-between items-center">
              <div>
                <div className="text-lg font-extrabold">📜 Product History</div>
                <div className="text-xs font-semibold text-blue-100">
                  {historyProduct.quick_code || ''}{historyProduct.variant_suffix ? '-' + historyProduct.variant_suffix : ''}
                  {' · '}
                  {historyProduct.name_en || '—'}
                </div>
              </div>
              <button
                onClick={closeHistory}
                aria-label="Close"
                className="bg-white text-slate-800 w-9 h-9 rounded-full font-bold text-lg shadow"
              >✕</button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {/* Stock summary */}
              {(function () {
                var s = productStats[historyProduct.id] || { current_qty: 0, current_weighted_cost: 0, original_qty: 0, sold_qty: 0, sold_revenue: 0, cogs_total: 0, gross_profit: 0 };
                var avgCost = s.current_qty > 0 ? s.current_weighted_cost / s.current_qty : 0;
                var avgSold = s.sold_qty > 0 ? s.sold_revenue / s.sold_qty : 0;
                return (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <div className="bg-blue-100 border border-blue-300 rounded p-2">
                      <div className="text-[10px] font-extrabold text-blue-900 uppercase tracking-wider">Current Stock</div>
                      <div className="text-lg font-mono font-extrabold text-blue-900">{fmtNum(s.current_qty, 2)} {historyProduct.default_uom || ''}</div>
                    </div>
                    <div className="bg-indigo-100 border border-indigo-300 rounded p-2">
                      <div className="text-[10px] font-extrabold text-indigo-900 uppercase tracking-wider">Original Received</div>
                      <div className="text-lg font-mono font-extrabold text-indigo-900">{fmtNum(s.original_qty, 2)}</div>
                    </div>
                    <div className="bg-emerald-100 border border-emerald-300 rounded p-2">
                      <div className="text-[10px] font-extrabold text-emerald-900 uppercase tracking-wider">Sold</div>
                      <div className="text-lg font-mono font-extrabold text-emerald-900">{fmtNum(s.sold_qty, 2)}</div>
                    </div>
                    {seeCosts && (
                      <div className={'border rounded p-2 ' + (s.gross_profit >= 0 ? 'bg-emerald-50 border-emerald-300' : 'bg-red-50 border-red-300')}>
                        <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-900">P&amp;L</div>
                        <div className={'text-lg font-mono font-extrabold ' + (s.gross_profit >= 0 ? 'text-emerald-900' : 'text-red-900')}>{fmtNum(s.gross_profit, 2)}</div>
                        <div className="text-[10px] text-slate-700">Avg cost {fmtNum(avgCost, 2)} · sold {fmtNum(avgSold, 2)}</div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {historyLoading && (
                <div className="text-center py-6 text-slate-600 font-semibold">Loading history...</div>
              )}

              {!historyLoading && (
                <>
                  {/* Inbound shipments */}
                  <div>
                    <div className="text-sm font-extrabold text-slate-900 mb-2">📥 Inbound — Stock Received ({historyLayers.length})</div>
                    {historyLayers.length === 0 ? (
                      <div className="text-xs text-slate-600 italic p-3 bg-slate-50 rounded">No inbound history found for this product.</div>
                    ) : (
                      <div className="overflow-auto border border-slate-200 rounded">
                        <table className="w-full text-xs">
                          <thead className="bg-slate-100">
                            <tr>
                              <th className="px-2 py-1.5 text-left font-extrabold text-slate-900">Receipt #</th>
                              <th className="px-2 py-1.5 text-left font-extrabold text-slate-900">Date</th>
                              <th className="px-2 py-1.5 text-left font-extrabold text-slate-900">Supplier</th>
                              <th className="px-2 py-1.5 text-right font-extrabold text-slate-900">Qty Received</th>
                              <th className="px-2 py-1.5 text-right font-extrabold text-slate-900">Qty Remaining</th>
                              {seeCosts && <th className="px-2 py-1.5 text-right font-extrabold text-slate-900 bg-amber-50">Unit Cost</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {historyLayers.map(function (layer) {
                              return (
                                <tr key={layer.id} className="border-b border-slate-200">
                                  <td className="px-2 py-1.5 font-mono text-slate-800">{layer.receipt_number || '—'}</td>
                                  <td className="px-2 py-1.5 font-mono text-slate-700">{layer.received_at ? String(layer.received_at).substring(0, 10) : '—'}</td>
                                  <td className="px-2 py-1.5 text-slate-700">{layer.supplier || '—'}</td>
                                  <td className="px-2 py-1.5 text-right font-mono font-bold text-indigo-900">{fmtNum(layer.qty_received || layer.quantity || 0, 2)}</td>
                                  <td className="px-2 py-1.5 text-right font-mono font-bold text-blue-900">{fmtNum(layer.qty_remaining || 0, 2)}</td>
                                  {seeCosts && <td className="px-2 py-1.5 text-right font-mono text-slate-800 bg-amber-50">{fmtNum(layer.unit_cost || 0, 2)} {layer.cost_currency || ''}</td>}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Outbound movements */}
                  <div>
                    <div className="text-sm font-extrabold text-slate-900 mb-2">📤 Outbound — Movements ({historyMovements.length})</div>
                    {historyMovements.length === 0 ? (
                      <div className="text-xs text-slate-600 italic p-3 bg-slate-50 rounded">No outbound history found for this product.</div>
                    ) : (
                      <div className="overflow-auto border border-slate-200 rounded">
                        <table className="w-full text-xs">
                          <thead className="bg-slate-100">
                            <tr>
                              <th className="px-2 py-1.5 text-left font-extrabold text-slate-900">Date</th>
                              <th className="px-2 py-1.5 text-left font-extrabold text-slate-900">Type</th>
                              <th className="px-2 py-1.5 text-left font-extrabold text-slate-900">Reference</th>
                              <th className="px-2 py-1.5 text-right font-extrabold text-slate-900">Qty</th>
                              {seeCosts && <th className="px-2 py-1.5 text-right font-extrabold text-slate-900 bg-amber-50">Revenue</th>}
                              {seeCosts && <th className="px-2 py-1.5 text-right font-extrabold text-slate-900 bg-amber-50">COGS</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {historyMovements.map(function (mov) {
                              return (
                                <tr key={mov.id} className="border-b border-slate-200">
                                  <td className="px-2 py-1.5 font-mono text-slate-700">{mov.moved_at ? String(mov.moved_at).substring(0, 10) : '—'}</td>
                                  <td className="px-2 py-1.5 text-slate-800 font-semibold">{mov.movement_type || mov.type || '—'}</td>
                                  <td className="px-2 py-1.5 font-mono text-slate-700">{mov.invoice_number || mov.reference || mov.notes || '—'}</td>
                                  <td className="px-2 py-1.5 text-right font-mono font-bold text-emerald-800">{fmtNum(mov.quantity || mov.qty || 0, 2)}</td>
                                  {seeCosts && <td className="px-2 py-1.5 text-right font-mono text-slate-800 bg-amber-50">{fmtNum(mov.revenue || 0, 2)}</td>}
                                  {seeCosts && <td className="px-2 py-1.5 text-right font-mono text-slate-800 bg-amber-50">{fmtNum(mov.cogs || 0, 2)}</td>}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Modal footer */}
            <div className="border-t border-slate-200 px-5 py-3 flex justify-end bg-slate-50 rounded-b-2xl">
              <button onClick={closeHistory} className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-extrabold rounded">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
