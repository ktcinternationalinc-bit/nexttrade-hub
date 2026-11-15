'use client';
// v55.83-A.6.27.38 — Universal ProductPicker
//
// One picker component used wherever a product needs to be selected:
//   - Inbound Shipments line items
//   - Inventory Adjustments (quantity / transfer)
//   - Sales Invoice lines (Build 4.6 will plug in)
//
// THREE MODES (all coexist):
//   1. Quick-code prefix search — user types LL, LLBK, LLBKUS → matches quick_code
//   2. Keyword search           — user types "embossed", "brown", "cotton" → matches name + slug
//   3. Cascade dropdowns        — pick Family → Category narrows → Grade narrows... etc.
//
// SORTING (universal): featured ⭐ first, then use_count desc, then quick_code + name alphabetical.
//
// MODES:
//   - mode="lenient" (default for receiving) — operator picks a master row; can override later
//   - mode="strict"  (sales/transfers) — picker filters to products with on-hand stock only
//
// Props:
//   onPick(product)     — callback when user picks a row
//   value (optional)    — product_id to highlight as currently selected
//   placeholder         — search input placeholder text
//   filterByStock       — boolean; when true, only show products with qty_remaining > 0 in any layer
//   onClose             — callback when user dismisses (clicks outside or presses Escape)
//   userProfile         — current user (for permissions)

import { useState, useEffect, useMemo, useRef } from 'react';
import { supabase, dbUpdate } from '../lib/supabase';

var LEVEL_COLS = {
  1: { col: 'family_list_id',       label: 'Family',       parent: null },
  2: { col: 'category_list_id',     label: 'Category',     parent: 1 },
  3: { col: 'grade_list_id',        label: 'Grade',        parent: 1 },
  4: { col: 'construction_list_id', label: 'Construction', parent: 1 },
  5: { col: 'backing_list_id',      label: 'Backing',      parent: 1 },
  6: { col: 'color_list_id',        label: 'Color',        parent: 1 },
  7: { col: 'pattern_list_id',      label: 'Pattern',      parent: 1 },
  8: { col: 'spec_class_list_id',   label: 'Spec Class',   parent: 1 },
  9: { col: 'origin_list_id',       label: 'Origin',       parent: 1 },
};

export default function ProductPicker(props) {
  var onPick = props.onPick || function () {};
  var onClose = props.onClose || function () {};
  var placeholder = props.placeholder || 'Search by quick code (e.g. LLBKUS) or keyword (e.g. embossed brown)';
  var filterByStock = props.filterByStock === true;
  var userProfile = props.userProfile;
  var isSuperAdmin = props.isSuperAdmin === true;
  var canEdit = isSuperAdmin || (props.modulePerms && props.modulePerms['Edit Inventory'] === true);

  var [products, setProducts] = useState([]);
  var [lists, setLists] = useState([]);          // inventory_lists rows for cascade dropdowns
  var [rules, setRules] = useState([]);          // inventory_list_rules rows
  var [layers, setLayers] = useState([]);        // open inventory_layers (for filterByStock)
  var [loading, setLoading] = useState(true);

  var [query, setQuery] = useState('');
  var [cascade, setCascade] = useState({});      // { level: option_id }
  var [showCascade, setShowCascade] = useState(false);
  var inputRef = useRef(null);

  useEffect(function () {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  // ── Load data ────────────────────────────────────────────────────
  useEffect(function () {
    var cancelled = false;
    async function load() {
      setLoading(true);
      try {
        var qProducts = supabase.from('inventory_products').select('*').eq('active', true);
        var qLists    = supabase.from('inventory_lists').select('*').eq('active', true).order('level').order('display_order');
        var qRules    = supabase.from('inventory_list_rules').select('*');
        var qLayers   = filterByStock
          ? supabase.from('inventory_layers').select('product_id,qty_remaining,warehouse_id').eq('status', 'open').gt('qty_remaining', 0)
          : Promise.resolve({ data: [] });
        var [pRes, lRes, rRes, layerRes] = await Promise.all([qProducts, qLists, qRules, qLayers]);
        if (cancelled) return;
        setProducts(pRes.data || []);
        setLists(lRes.data || []);
        setRules(rRes.data || []);
        setLayers(layerRes.data || []);
      } catch (e) {
        console.error('[product-picker] load failed:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return function () { cancelled = true; };
  }, [filterByStock]);

  // ── Helpers ──────────────────────────────────────────────────────
  function listById(id) { return lists.find(function (l) { return l.id === id; }) || null; }
  function listByLevelAndCode(level, code) {
    return lists.find(function (l) { return l.level === level && l.code === code; }) || null;
  }
  // Stock-on-hand lookup (only used if filterByStock)
  var stockByProduct = useMemo(function () {
    var m = {};
    layers.forEach(function (L) {
      m[L.product_id] = (m[L.product_id] || 0) + Number(L.qty_remaining || 0);
    });
    return m;
  }, [layers]);

  // Format a product into a one-line summary using its FK labels
  function describe(p) {
    var parts = [];
    [1, 2, 3, 4, 5, 6, 7, 8, 9].forEach(function (lvl) {
      var L = listById(p[LEVEL_COLS[lvl].col]);
      if (L) parts.push(L.label_en);
    });
    return parts.join(' · ');
  }

  // ── Filtering / sorting ──────────────────────────────────────────
  var filtered = useMemo(function () {
    var list = products.slice();
    var q = query.trim();

    // Mode 1: Quick code prefix (input is purely A-Z, length >= 1)
    var isQuickCodeSearch = q.length > 0 && /^[A-Za-z0-9]+$/.test(q);

    if (q) {
      var qLower = q.toLowerCase();
      list = list.filter(function (p) {
        // quick_code prefix
        if (isQuickCodeSearch && p.quick_code && p.quick_code.toLowerCase().indexOf(qLower) === 0) return true;
        // keyword in name_en
        if (p.name_en && p.name_en.toLowerCase().indexOf(qLower) >= 0) return true;
        // keyword in name_ar
        if (p.name_ar && p.name_ar.indexOf(q) >= 0) return true;
        // keyword in slug
        if (p.classification_slug && p.classification_slug.toLowerCase().indexOf(qLower) >= 0) return true;
        // keyword in any of its FK labels (so "embossed" matches category=EM, "cotton" matches backing=CT)
        var hit = false;
        [1, 2, 3, 4, 5, 6, 7, 8, 9].forEach(function (lvl) {
          if (hit) return;
          var L = listById(p[LEVEL_COLS[lvl].col]);
          if (L && L.label_en && L.label_en.toLowerCase().indexOf(qLower) >= 0) hit = true;
        });
        return hit;
      });
    }

    // Mode 3: cascade dropdowns
    Object.keys(cascade).forEach(function (lvlStr) {
      var lvl = Number(lvlStr);
      var pickedId = cascade[lvlStr];
      if (!pickedId) return;
      list = list.filter(function (p) { return p[LEVEL_COLS[lvl].col] === pickedId; });
    });

    // Strict mode: only products with stock
    if (filterByStock) {
      list = list.filter(function (p) { return (stockByProduct[p.id] || 0) > 0; });
    }

    // Sort: featured first, then use_count desc, then alphabetical by quick_code + name
    list.sort(function (a, b) {
      if ((a.featured ? 1 : 0) !== (b.featured ? 1 : 0)) return b.featured ? 1 : -1;
      var uca = Number(a.use_count || 0);
      var ucb = Number(b.use_count || 0);
      if (uca !== ucb) return ucb - uca;
      var qa = (a.quick_code || '') + (a.name_en || '');
      var qb = (b.quick_code || '') + (b.name_en || '');
      return qa.localeCompare(qb);
    });

    return list;
  }, [products, lists, query, cascade, filterByStock, stockByProduct]);

  // ── Cascade option helpers ───────────────────────────────────────
  // Get the options for a level, restricted by the chosen Family (if any) and active status
  function cascadeOptionsFor(level) {
    var familyId = cascade[1];
    var family = familyId ? listById(familyId) : null;
    return lists.filter(function (L) {
      if (L.level !== level || !L.active) return false;
      // If Family chosen, restrict child levels via rules
      if (level !== 1 && family) {
        var hasRule = rules.some(function (r) { return r.child_list_id === L.id && r.parent_list_id === family.id; });
        var anyRuleForChild = rules.some(function (r) { return r.child_list_id === L.id; });
        // If there are NO rules at all for this child, treat it as universal (no parent restriction)
        if (!hasRule && anyRuleForChild) return false;
      }
      return true;
    });
  }

  function clearCascade() { setCascade({}); }

  // ── Star toggle (featured) ──────────────────────────────────────
  async function toggleFeatured(product, e) {
    e.stopPropagation();
    if (!canEdit) return;
    try {
      var nextFeatured = !product.featured;
      await dbUpdate('inventory_products', product.id, { featured: nextFeatured }, userProfile && userProfile.id);
      setProducts(function (prev) {
        return prev.map(function (p) { return p.id === product.id ? Object.assign({}, p, { featured: nextFeatured }) : p; });
      });
    } catch (err) {
      console.error('[product-picker] toggle featured failed:', err);
    }
  }

  // ── Pick handler ────────────────────────────────────────────────
  function handlePick(product) {
    // Increment client-side use_count optimistically (DB trigger will increment again on actual receipt insert,
    // but having a local bump means the picker feels responsive even before the receipt saves)
    onPick(product);
    onClose();
  }

  // ── Render ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="fixed inset-0 z-[300] bg-black/70 backdrop-blur-sm flex items-center justify-center" style={{ padding: 16 }}>
        <div className="bg-white rounded-2xl p-6 text-slate-700 font-semibold">Loading products...</div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[300] bg-black/70 backdrop-blur-sm overflow-y-auto" onClick={onClose} style={{ padding: 16 }}>
      <div className="bg-white rounded-2xl shadow-2xl mx-auto" onClick={function (e) { e.stopPropagation(); }} style={{ maxWidth: 1200 }}>
        {/* Header */}
        <div className="rounded-t-2xl flex justify-between items-center gap-2" style={{ background: '#1e3a8a', padding: '14px 20px' }}>
          <div>
            <div className="text-lg font-extrabold" style={{ color: '#ffffff' }}>🔍 Pick a Product</div>
            <div className="text-xs font-semibold" style={{ color: '#dbeafe' }}>
              {filterByStock ? 'Showing only products with on-hand stock' : 'All active products'}
              {' · '}{filtered.length} match{filtered.length === 1 ? '' : 'es'}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: '#ffffff', color: '#1e293b', width: 36, height: 36, fontSize: 20, lineHeight: 1, border: '2px solid #cbd5e1', borderRadius: '50%', fontWeight: 800 }}>✕</button>
        </div>

        <div style={{ padding: 20 }}>
          {/* Search input */}
          <input
            ref={inputRef}
            type="text"
            placeholder={placeholder}
            value={query}
            onChange={function (e) { setQuery(e.target.value); }}
            className="w-full px-4 py-2.5 border-2 border-slate-300 rounded-lg text-base bg-white focus:border-blue-500 focus:outline-none"
          />

          {/* Cascade toggle + active cascade chips */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              onClick={function () { setShowCascade(!showCascade); }}
              className="px-3 py-1.5 text-xs font-extrabold rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800"
            >
              📂 {showCascade ? 'Hide' : 'Show'} cascade filters
            </button>
            {Object.keys(cascade).length > 0 && (
              <button
                onClick={clearCascade}
                className="px-3 py-1.5 text-xs font-extrabold rounded-lg bg-rose-100 hover:bg-rose-200 text-rose-900"
              >
                ✕ Clear filters
              </button>
            )}
            {/* Active cascade chips */}
            {Object.keys(cascade).map(function (lvlStr) {
              var lvl = Number(lvlStr);
              var pickedId = cascade[lvlStr];
              if (!pickedId) return null;
              var opt = listById(pickedId);
              if (!opt) return null;
              return (
                <span key={lvl} className="text-[11px] bg-blue-100 text-blue-900 px-2 py-1 rounded font-bold">
                  {LEVEL_COLS[lvl].label}: {opt.code} ({opt.label_en})
                  <button onClick={function () { var next = Object.assign({}, cascade); delete next[lvl]; setCascade(next); }} className="ml-1 text-blue-700 font-extrabold">✕</button>
                </span>
              );
            })}
          </div>

          {/* Cascade grid */}
          {showCascade && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mt-2 grid grid-cols-3 gap-2">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (lvl) {
                var opts = cascadeOptionsFor(lvl);
                return (
                  <label key={lvl} className="text-[11px] font-extrabold text-slate-700">
                    {LEVEL_COLS[lvl].label}
                    <select
                      value={cascade[lvl] || ''}
                      onChange={function (e) {
                        var next = Object.assign({}, cascade);
                        if (e.target.value) next[lvl] = e.target.value;
                        else delete next[lvl];
                        // Clear all dependent levels if Family changes
                        if (lvl === 1) { next = e.target.value ? { 1: e.target.value } : {}; }
                        setCascade(next);
                      }}
                      className="w-full mt-0.5 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white"
                    >
                      <option value="">— any —</option>
                      {opts.map(function (o) { return <option key={o.id} value={o.id}>{o.code} — {o.label_en}</option>; })}
                    </select>
                  </label>
                );
              })}
            </div>
          )}

          {/* Result list */}
          <div className="mt-3 bg-white border-2 border-slate-200 rounded-lg overflow-hidden" style={{ maxHeight: 'calc(100vh - 360px)', minHeight: 200, overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <div className="text-center text-slate-500 italic text-sm py-8">
                {products.length === 0
                  ? 'No products in the master. Import via Inventory → Product List → Import Products.'
                  : filterByStock
                    ? 'No products with on-hand stock match your search/filters.'
                    : 'No products match.'}
              </div>
            ) : (
              filtered.slice(0, 200).map(function (p) {
                var stock = stockByProduct[p.id] || 0;
                return (
                  <div key={p.id}
                       onClick={function () { handlePick(p); }}
                       className="grid items-center border-t border-slate-100 cursor-pointer hover:bg-blue-50"
                       style={{ gridTemplateColumns: '36px 110px 1fr 90px 70px', padding: '8px 12px', gap: 8 }}>
                    <button
                      onClick={function (e) { toggleFeatured(p, e); }}
                      title={p.featured ? 'Unstar (remove from featured)' : 'Star (mark as featured)'}
                      style={{ background: 'transparent', border: 'none', fontSize: 18, lineHeight: 1, cursor: canEdit ? 'pointer' : 'default', opacity: canEdit ? 1 : 0.5 }}
                    >
                      {p.featured ? '⭐' : '☆'}
                    </button>
                    <div className="font-mono font-extrabold text-slate-900 text-sm">{p.quick_code || '—'}</div>
                    <div className="text-sm">
                      <div className="font-semibold text-slate-900 truncate">{describe(p)}</div>
                      <div className="text-[10px] text-slate-500 font-mono truncate">{p.classification_slug}</div>
                    </div>
                    <div className="text-[11px] text-right text-slate-600">
                      {filterByStock ? <><span className="font-extrabold text-emerald-700">{stock.toFixed(2)}</span> on hand</> : ''}
                    </div>
                    <div className="text-[10px] text-right text-slate-500">
                      used <span className="font-mono font-bold">{p.use_count || 0}×</span>
                    </div>
                  </div>
                );
              })
            )}
            {filtered.length > 200 && (
              <div className="text-center text-[11px] text-slate-500 italic py-2 border-t border-slate-100">
                Showing first 200 of {filtered.length} matches. Narrow your search to see more specific products.
              </div>
            )}
          </div>

          {/* Tip */}
          <div className="mt-2 text-[10px] text-slate-500 italic">
            ⭐ = featured (always at top) · use_count = how often this product has been picked · Type to search by quick code or keyword.
            {canEdit && ' Click ☆ to star/unstar.'}
          </div>
        </div>
      </div>
    </div>
  );
}
