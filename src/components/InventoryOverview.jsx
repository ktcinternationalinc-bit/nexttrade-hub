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
import RestrictedNotice from './RestrictedNotice';
import { isCountableReceipt } from '../lib/inventory-receipts';
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
  var [showZeroStock, setShowZeroStock] = useState(true);    // Max Jun 1 2026: show zero-stock items by default
  // v55.83-A.6.27.55 — hide Template Products by default. Templates have no
  // physical stock (they exist only to spawn variants), so including them in
  // "what's in stock" pollutes the totals + accordion. Off by default; toggle
  // exposes them for the rare case someone wants to audit templates too.
  var [showTemplates, setShowTemplates] = useState(false);

  // v55.83-A.6.27.60 — History drilldown modal state. When user clicks "↗ History"
  // on a product row, this opens a modal showing all inbound shipments, outbound
  // sales, and the current stock summary for that product.
  var [historyProduct, setHistoryProduct] = useState(null); // null = closed; object = open for that product
  var [historyLayers, setHistoryLayers] = useState([]);     // inventory_layers rows (finalized cost layers)
  var [historyReceipts, setHistoryReceipts] = useState([]); // v55.83-S — inventory_stock_receipts (real inbound orders, finalized OR pending)
  var [historyMovements, setHistoryMovements] = useState([]); // inventory_movements rows for outbound history
  var [historyLoading, setHistoryLoading] = useState(false);
  var [historyError, setHistoryError] = useState(null);
  var [historyTab, setHistoryTab] = useState('summary'); // v55.83-R drill-down tabs: summary | inbound | sales
  var [historyIntakeByCountry, setHistoryIntakeByCountry] = useState([]); // [{country, kg, rolls, qty}] — intake split US vs Canada etc.

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
    setHistoryTab('summary');
    setHistoryLayers([]);
    setHistoryMovements([]);
    setHistoryReceipts([]);
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
    // v55.83-S — Inbound Orders must come from the actual stock receipts, not the cost
    // layers. A cost layer only exists AFTER finalization, but on-hand qty also includes
    // received-but-not-yet-finalized stock — which has a real receipt but no layer. Reading
    // layers made the Inbound tab look empty for pending stock even though qty existed.
    try {
      var inbRes = await supabase
        .from('inventory_stock_receipts')
        .select('*')
        .eq('product_id', product.id)
        .order('receipt_date', { ascending: false });
      if (!inbRes.error) setHistoryReceipts((inbRes.data || []).filter(function (r) { return r.status !== 'cancelled' && r.status !== 'merged' && r.status !== 'reversed'; }));
      else console.warn('[history] receipts query failed:', inbRes.error.message);
    } catch (e) { console.warn('[history] receipts threw:', e); }
    try {
      var movRes = await supabase
        .from('inventory_movements')
        .select('*')
        .eq('product_id', product.id)
        .order('moved_at', { ascending: false });
      if (!movRes.error) setHistoryMovements(movRes.data || []);
      else console.warn('[history] movements query failed:', movRes.error.message);
    } catch (e) { console.warn('[history] movements threw:', e); }
    // v55.83-A (Max Jun 1 2026) — Intake by country: how much of this product
    // was RECEIVED from each country (US vs Canada etc.). Sold-as-one, tracked-by-intake.
    try {
      var COUNTRY_LABELS = { US: 'United States', CA: 'Canada', EG: 'Egypt', CN: 'China', TR: 'Turkey', IT: 'Italy', KR: 'South Korea', USCA: 'US/Canada' };
      var rcRes = await supabase
        .from('inventory_stock_receipts')
        .select('quantity, quantity_kg, roll_count, origin_country_code, status')
        .eq('product_id', product.id);
      if (!rcRes.error && rcRes.data) {
        var byC = {};
        rcRes.data.forEach(function (r) {
          if (r.status === 'cancelled') return;
          var c = r.origin_country_code || 'Unspecified';
          if (!byC[c]) byC[c] = { country: c, label: COUNTRY_LABELS[c] || c, kg: 0, rolls: 0, qty: 0 };
          byC[c].kg += Number(r.quantity_kg || 0) || 0;
          byC[c].rolls += Number(r.roll_count || 0) || 0;
          byC[c].qty += Number(r.quantity || 0) || 0;
        });
        var arr = Object.keys(byC).map(function (k) { return byC[k]; });
        arr.sort(function (a, b) { return b.kg - a.kg; });
        setHistoryIntakeByCountry(arr);
      }
    } catch (e) { console.warn('[history] intake-by-country threw:', e); }
    setHistoryLoading(false);
  }
  function closeHistory() {
    setHistoryProduct(null);
    setHistoryLayers([]);
    setHistoryMovements([]);
    setHistoryReceipts([]);
    setHistoryIntakeByCountry([]);
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
          safe(supabase.from('inventory_stock_receipts').select('product_id, quantity, quantity_kg, roll_count, uom, status')),
          safe(supabase.from('invoice_items').select('variant_id, sale_quantity, sale_price_per_uom, cogs_total, gross_profit, inventory_status, rolls_sold').eq('inventory_status', 'consumed')),
        ]);
        if (cancelled) return;

        // v55.83-HT (Codex FAIL fix) — Supabase returns {data:null,error} on a failed query
        // WITHOUT throwing, so the try/catch never fires and a real failure (RLS / missing column /
        // missing table on the CORE products/lists or the stock layers/receipts) would render as
        // EMPTY stock — a false "no inventory" story. Surface those errors explicitly so the screen
        // shows the load failure instead. Sold/sales data is optional (profit strip only) → warn only.
        var _qErrs = [];
        if (prodRes && prodRes.error) { _qErrs.push('products: ' + prodRes.error.message); }
        if (lstRes && lstRes.error) { _qErrs.push('classifications: ' + lstRes.error.message); }
        if (layRes && layRes.error) { _qErrs.push('stock layers: ' + layRes.error.message); }
        if (recRes && recRes.error) { _qErrs.push('receipts: ' + recRes.error.message); }
        if (soldRes && soldRes.error) { console.warn('[inventory-overview] sales data failed (profit strip partial):', soldRes.error.message); }
        if (_qErrs.length) {
          setError(_qErrs.join('; '));
          toast.error('Failed to load inventory: ' + _qErrs.join('; '));
        }

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
        current_qty: 0,           // finalized on-hand (from layers)
        current_weighted_cost: 0, // sum(qty * cost) for weighted avg
        original_qty: 0,
        sold_qty: 0,
        sold_revenue: 0,
        cogs_total: 0,
        gross_profit: 0,
        // v55.83-A (Max Jun 1 2026) — show stock immediately + status dot + UOM toggle
        finalized_qty: 0,         // qty from finalized receipts (green)
        pending_qty: 0,           // qty from received-but-not-finalized receipts (yellow)
        recv_by_uom: {},          // { kg: 120, meter: 50, ... } from received qty in its UoM
        recv_kg: 0,               // summed Quantity in Kilos across receipts
        recv_rolls: 0,            // summed Roll Count across receipts (rolls received)
        sold_rolls: 0,            // v55.83-H — summed rolls_sold across consumed sales
        has_pending: false,       // any receipt not yet finalized
        has_finalized: false,     // any receipt finalized
      };
    });
    // Sum layers (FINALIZED current stock + cost-weighted)
    layers.forEach(function (l) {
      var s = stats[l.product_id];
      if (!s) return;  // layer for unknown product
      var qty = Number(l.qty_remaining || 0);
      s.current_qty += qty;
      s.finalized_qty += qty;
      s.current_weighted_cost += qty * Number(l.cost_per_uom || 0);
    });
    // Sum receipts (original received + pending stock + per-UOM + kg + rolls + status)
    receipts.forEach(function (r) {
      var s = stats[r.product_id];
      if (!s) return;
      // v55.83-H — A CANCELLED receipt is as good as deleted. Bail out before it
      // touches ANY total. Previously the quantity was added to original_qty (and
      // recv_by_uom / recv_kg / recv_rolls) above the status check, so a cancelled
      // receipt still inflated "Original Stock" — e.g. LUX-BK showed Original 28,381
      // (18,381 received + 10,000 cancelled) instead of the correct 18,381.
      //
      // v55.83-H QA — Also exclude 'pending_detail'. That status means the shipment
      // is logged but NOT physically counted yet; the receiving form stores the
      // supplier's EXPECTED quantity (or a 0.001 placeholder) in the quantity column
      // just to satisfy the >0 check. Counting it here showed expected/unverified
      // goods as real on-hand stock AND inflated Original. On-hand = only what has
      // actually arrived: 'active' / 'received' (pending cost) or 'finalized'.
      if (!isCountableReceipt(r)) return; // v55.83-IH — shared status filter (kept in sync with Report Center)
      var q = Number(r.quantity || 0);
      s.original_qty += q;
      var uom = (r.uom || 'unit').toLowerCase();
      if (!s.recv_by_uom[uom]) s.recv_by_uom[uom] = 0;
      s.recv_by_uom[uom] += q;
      s.recv_kg += Number(r.quantity_kg || 0) || 0;
      s.recv_rolls += Number(r.roll_count || 0) || 0;
      if (r.status === 'finalized') {
        s.has_finalized = true;
      } else {
        // received but NOT finalized → counts as pending (yellow) on-hand
        s.pending_qty += q;
        s.has_pending = true;
        // show stock immediately: include pending in current_qty so it appears right away
        s.current_qty += q;
      }
    });
    // Sum sales (sold_qty + revenue + cogs + gross_profit) — by variant_id
    salesItems.forEach(function (it) {
      var s = stats[it.variant_id];
      if (!s) return;
      var qty = Number(it.sale_quantity || 0);
      s.sold_qty += qty;
      s.sold_rolls += Number(it.rolls_sold || 0) || 0;
      s.sold_revenue += qty * Number(it.sale_price_per_uom || 0);
      s.cogs_total += Number(it.cogs_total || 0);
      s.gross_profit += Number(it.gross_profit || 0);
    });
    // v55.83-CO — derive each product's REAL UOM from its received lines (the
    // corrected source of truth). The product master default_uom is only a fallback;
    // a stale master 'unit' must NOT override a receipt line corrected to 'kg'.
    Object.keys(stats).forEach(function (pid) {
      var s2 = stats[pid]; var best = ''; var bestQ = -1;
      Object.keys(s2.recv_by_uom).forEach(function (u) { if (s2.recv_by_uom[u] > bestQ) { bestQ = s2.recv_by_uom[u]; best = u; } });
      s2.recv_uom_primary = best; // '' when there are no (non-cancelled) receipts
    });
    return stats;
  }, [products, layers, receipts, salesItems]);

  // UOM source of truth: received-line UOM first, product-master default only as fallback.
  function effUom(p) {
    var s3 = productStats && productStats[p.id];
    if (s3 && s3.recv_uom_primary) { return s3.recv_uom_primary; }
    return (p.default_uom || 'unit');
  }
  // UOM sort: '', 'asc', or 'desc'. Ordered kg < meter < yard < unit < roll, others last.
  var UOM_RANK = { kg: 0, sqm: 1, meter: 2, meters: 2, yard: 3, yards: 3, unit: 4, units: 4, piece: 4, pieces: 4, roll: 5, rolls: 5 };
  function uomRank(u) { var k = String(u || '').toLowerCase().trim(); return UOM_RANK[k] != null ? UOM_RANK[k] : 90; }
  var [uomSort, setUomSort] = useState('');

  // Filter products by search term + zero-stock toggle + classification filters
  var filteredProducts = useMemo(function () {
    var q = (search || '').trim().toLowerCase();
    var keywords = q ? q.split(/\s+/).filter(Boolean) : [];
    var levelFields = Object.keys(filterLevels);
    return products.filter(function (p) {
      // v55.83-A.6.27.55 — hide template products by default (no physical stock).
      if (!showTemplates && p.is_family_template === true) return false;
      // v55.83-DR — hide virtual Stock Mix SKUs: they hold no layers and are not
      // physical inventory (their real colors are counted on their own rows).
      if (p.is_virtual_mix === true) return false;
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
            rolls_current: 0, rolls_original: 0, rolls_sold: 0,
            by_uom: {},  // { kg: {current,original,sold}, meter: {...} } — break out per unit so units are never summed together
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
      // v55.83 — break each product's qty out by its own unit of measure so the
      // family line never adds kg + meters + units into one meaningless number.
      var pUomKey = effUom(p).toLowerCase().trim();
      if (!groups[familyId].totals.by_uom[pUomKey]) groups[familyId].totals.by_uom[pUomKey] = { current: 0, original: 0, sold: 0 };
      groups[familyId].totals.by_uom[pUomKey].current += s.current_qty || 0;
      groups[familyId].totals.by_uom[pUomKey].original += s.original_qty || 0;
      groups[familyId].totals.by_uom[pUomKey].sold += s.sold_qty || 0;
      // v55.83-H — roll totals per family (goods received in rolls but sold by weight/length)
      var gUom = effUom(p).toLowerCase().trim();
      if (gUom !== 'roll' && gUom !== 'rolls') {
        var gOrig = s.recv_rolls || 0;
        var gSold = s.sold_rolls || 0;
        groups[familyId].totals.rolls_original += gOrig;
        groups[familyId].totals.rolls_sold += gSold;
        groups[familyId].totals.rolls_current += Math.max(0, gOrig - gSold);
      }
    });
    // Convert to sorted array (alphabetic by label_en, "Unclassified" last)
    var arr = Object.keys(groups).map(function (k) { return groups[k]; });
    // v55.83-H (Max Jun 2 2026) — within each family, list products largest amount
    // first → lowest. Sort by current on-hand desc, then by original received desc,
    // then by name so zero-stock items settle at the bottom in a stable order.
    arr.forEach(function (g) {
      g.products.sort(function (pa, pb) {
        if (uomSort) {
          var ra = uomRank(effUom(pa)), rb = uomRank(effUom(pb));
          if (ra !== rb) { return uomSort === 'desc' ? (rb - ra) : (ra - rb); }
          var la = effUom(pa).toLowerCase(), lb = effUom(pb).toLowerCase();
          if (la !== lb) { return uomSort === 'desc' ? lb.localeCompare(la) : la.localeCompare(lb); }
        }
        var sa = productStats[pa.id] || {};
        var sb = productStats[pb.id] || {};
        var ca = Number(sa.current_qty || 0), cb = Number(sb.current_qty || 0);
        if (cb !== ca) return cb - ca;
        var oa = Number(sa.original_qty || 0), ob = Number(sb.original_qty || 0);
        if (ob !== oa) return ob - oa;
        return String(pa.name_en || '').localeCompare(String(pb.name_en || ''));
      });
    });
    arr.sort(function (a, b) {
      if (a.family_id === ungroupedKey) return 1;
      if (b.family_id === ungroupedKey) return -1;
      return (a.label_en || '').localeCompare(b.label_en || '');
    });
    return arr;
  }, [filteredProducts, productStats, listsById, uomSort]);

  // Grand totals across all visible products
  var grandTotals = useMemo(function () {
    // v55.83-A (Max Jun 1 2026) — quantities are kept PER UNIT OF MEASURE (kg, sqm,
    // meter, rolls...) because you can't add kg to sqm. Money (revenue/cogs/profit)
    // is one currency so it sums across everything. product_count is a simple count.
    var t = { sold_revenue: 0, cogs_total: 0, gross_profit: 0, product_count: 0, inventory_value: 0, awaiting_cost: 0, rolls_original: 0, rolls_current: 0, rolls_sold: 0 };
    var byUnit = {}; // { kg: {current, original, sold}, sqm: {...}, ... }
    function bucket(u) {
      // v55.83-H QA — normalize unit aliases so the summary doesn't show two
      // separate blocks for the same unit (e.g. "roll" vs "rolls", "meter" vs
      // "meters"). Without this, a product set to default_uom "rolls" and another
      // set to "roll" produced two identical "ROLLS" rows that each held half the total.
      var raw = (u || 'unit').toLowerCase().trim();
      var aliases = { rolls: 'roll', meters: 'meter', metre: 'meter', metres: 'meter',
                      yards: 'yard', pieces: 'piece', pcs: 'piece', pc: 'piece',
                      units: 'unit', m2: 'sqm', 'sq_m': 'sqm', sqmeter: 'sqm', sqmeters: 'sqm', kgs: 'kg' };
      var key = aliases[raw] || raw;
      if (!byUnit[key]) byUnit[key] = { unit: key, current_qty: 0, original_qty: 0, sold_qty: 0 };
      return byUnit[key];
    }
    products.forEach(function (p) {
      var s = productStats[p.id];
      if (!s) return;
      var u = effUom(p);
      var b = bucket(u);
      b.current_qty += s.current_qty || 0;
      b.original_qty += s.original_qty || 0;
      b.sold_qty += s.sold_qty || 0;
      // v55.83-H — roll totals for goods received in rolls but sold by kg/meter.
      // (Products sold IN rolls already appear under the 'roll' unit block above.)
      var uomN = effUom(p).toLowerCase().trim();
      if (uomN !== 'roll' && uomN !== 'rolls') {
        var oRolls = s.recv_rolls || 0;
        var sRolls = s.sold_rolls || 0;
        t.rolls_original += oRolls;
        t.rolls_sold += sRolls;
        t.rolls_current += Math.max(0, oRolls - sRolls);
      }
      t.sold_revenue += s.sold_revenue || 0;
      t.cogs_total += s.cogs_total || 0;
      t.gross_profit += s.gross_profit || 0;
      // v55.83-H — executive KPI strip aggregates
      t.inventory_value += s.current_weighted_cost || 0;   // EGP value of finalized on-hand
      if (s.has_pending) t.awaiting_cost += 1;             // products with stock not yet costed
    });
    // only count products that pass the current filter set (grouped)
    grouped.forEach(function (g) { t.product_count += g.products.length; });
    // stable, readable order of units
    var order = ['kg', 'sqm', 'meter', 'yard', 'roll', 'rolls', 'piece', 'unit'];
    var units = Object.keys(byUnit).sort(function (a, b2) {
      var ia = order.indexOf(a), ib = order.indexOf(b2);
      if (ia === -1) ia = 99; if (ib === -1) ib = 99;
      return ia - ib;
    }).map(function (k) { return byUnit[k]; });
    t.units = units;
    return t;
  }, [products, productStats, grouped]);

  // pretty label for a unit code
  function unitLabel(u) {
    var map = { kg: 'KG', sqm: 'SQM (m²)', meter: 'METERS', meters: 'METERS', yard: 'YARDS', roll: 'ROLLS', rolls: 'ROLLS', piece: 'PIECES', unit: 'UNITS' };
    return map[(u || '').toLowerCase()] || (u || 'UNITS').toUpperCase();
  }

  // v55.83 — each unit of measure gets its own badge color so KG, METERS, UNITS,
  // etc. are visually separated at a glance.
  function uomBadgeColor(u) {
    var m = { kg: 'bg-blue-600', meter: 'bg-teal-600', meters: 'bg-teal-600', yard: 'bg-sky-600', sqm: 'bg-indigo-600', piece: 'bg-violet-600', unit: 'bg-violet-600', liter: 'bg-cyan-600' };
    return m[(u || '').toLowerCase()] || 'bg-slate-600';
  }

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
      <div style={{ padding: 24 }}>
        <RestrictedNotice title="Access restricted" message={'You do not have permission to view the Inventory Overview. Ask a super admin to grant you the "Inventory" permission.'} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header — v55.83-H polish: a clean, borderless page header (no heavy banner
          box) with a one-line description. Calmer and less boxed-in. */}
      <div className="flex items-start justify-between gap-3 pt-1">
        <div>
          <div className="text-xl font-extrabold leading-tight text-slate-100">Inventory Overview</div>
          <div className="text-xs font-medium text-slate-400 mt-0.5">Stock, landed cost, and profitability across warehouses.</div>
          <div className="text-[11px] font-semibold text-slate-500 mt-0.5" style={{ direction: 'rtl' }}>المخزون الحالي حسب فئة المنتج</div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={expandAll} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-extrabold rounded-lg border border-slate-700 transition">Expand All</button>
          <button onClick={collapseAll} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-extrabold rounded-lg border border-slate-700 transition">Collapse All</button>
        </div>
      </div>

      {/* Executive KPI strip — v55.83-H. Single-valued, real aggregates only.
          Quantities stay in the per-unit blocks below (can't add kg to sqm), so
          these cards are the cross-product figures that DO sum cleanly. Financial
          cards are gated behind seeCosts. */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {(function () {
          var cards = [];
          if (seeCosts) {
            cards.push({ k: 'val', label: 'Inventory Value', value: fmtNum(grandTotals.inventory_value, 2) + ' EGP', tone: 'slate', sub: 'finalized stock' });
          }
          cards.push({ k: 'prod', label: 'Products', value: fmtNum(grandTotals.product_count, 0), tone: 'slate', sub: (grouped.length) + ' famil' + (grouped.length === 1 ? 'y' : 'ies') });
          cards.push({ k: 'await', label: 'Awaiting Cost', value: fmtNum(grandTotals.awaiting_cost, 0), tone: grandTotals.awaiting_cost > 0 ? 'amber' : 'slate', sub: 'received, not finalized' });
          if (seeCosts) {
            cards.push({ k: 'rev', label: 'Sold Revenue', value: fmtNum(grandTotals.sold_revenue, 2), tone: 'slate', sub: 'all currencies' });
            cards.push({ k: 'cogs', label: 'COGS', value: fmtNum(grandTotals.cogs_total, 2), tone: 'slate', sub: 'cost of goods sold' });
            cards.push({ k: 'gp', label: 'Gross Profit', value: fmtNum(grandTotals.gross_profit, 2), tone: grandTotals.gross_profit > 0 ? 'emerald' : grandTotals.gross_profit < 0 ? 'red' : 'slate', sub: 'revenue − COGS' });
          }
          var numTone = { slate: 'text-slate-100', amber: 'text-amber-400', emerald: 'text-emerald-400', red: 'text-red-400' };
          return cards.map(function (c) {
            return (
              <div key={c.k} className="bg-slate-900/70 border border-slate-700/60 rounded-xl px-4 py-3.5">
                <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{c.label}</div>
                <div className={'text-xl font-extrabold tabular-nums leading-tight mt-1 ' + (numTone[c.tone] || numTone.slate)}>{c.value}</div>
                <div className="text-[10px] font-medium text-slate-500 mt-1">{c.sub}</div>
              </div>
            );
          });
        })()}
      </div>

      {/* Toolbar */}
      <div className="bg-slate-900/70 border border-slate-700/60 rounded-xl p-3 flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={function (e) { setSearch(e.target.value); }}
          placeholder="Search by code, design SKU, name, category, family..."
          className="flex-1 min-w-[280px] px-3 py-2 border border-slate-600 rounded-lg text-sm bg-slate-800 text-slate-100 placeholder-slate-500 font-semibold focus:outline-none focus:border-indigo-500"
        />
        <label className="flex items-center gap-1.5 text-xs font-bold text-slate-200">
          <input type="checkbox" checked={showZeroStock} onChange={function (e) { setShowZeroStock(e.target.checked); }} className="w-4 h-4" />
          Show zero-stock items / إظهار المخزون الصفري
        </label>
        <button type="button" onClick={function () { setUomSort(uomSort === 'asc' ? 'desc' : (uomSort === 'desc' ? '' : 'asc')); }}
          className={'flex items-center gap-1 text-xs font-bold rounded px-2.5 py-1 border ' + (uomSort ? 'bg-indigo-600 text-white border-indigo-400' : 'bg-slate-800 text-slate-200 border-slate-600')}>
          Sort by UOM {uomSort === 'asc' ? '▲' : uomSort === 'desc' ? '▼' : ''}
        </button>
        {/* status dot legend */}
        <span className="inline-flex items-center gap-3 text-[11px] font-bold text-slate-300">
          <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-emerald-400"></span>Cost finalized</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-amber-400"></span>Needs cost</span>
        </span>
        <label className="flex items-center gap-1.5 text-xs font-bold text-slate-200" title="Template Products have no physical stock — they're only used to create Products.">
          <input type="checkbox" checked={showTemplates} onChange={function (e) { setShowTemplates(e.target.checked); }} className="w-4 h-4" />
          Show Template Products / إظهار قوالب المنتجات
        </label>
        {activeFilterCount > 0 && (
          <button
            onClick={clearFilters}
            className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-extrabold rounded-lg shadow"
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
          May 22 2026 — option A.
          v55.83-A.6.27.72 HOTFIX 29 — gradient was bg-gradient-to-r from-slate-50
          to-indigo-50/50, rendering as bright pastel that washed out the
          "Family → Category → Grade..." breadcrumb. Now uses a dark slate→indigo
          gradient with bright text for proper dark-theme contrast. */}
      <details className="bg-slate-900/70 border border-slate-700/60 rounded-xl overflow-hidden" open={activeFilterCount > 0}>
        <summary className="px-4 py-2.5 cursor-pointer font-extrabold bg-slate-800/60 hover:bg-slate-800 flex items-center justify-between border-b border-slate-700/60">
          <span className="flex items-center gap-2">
            <span className="text-indigo-300">🔍</span>
            <span className="text-slate-100">Filter by classification</span>
            <span className="text-[10px] text-slate-400 font-semibold tracking-wider">Family → Category → Grade → …</span>
          </span>
          {activeFilterCount > 0 && (
            <span className="text-xs bg-indigo-600 text-white px-2 py-0.5 rounded-full font-bold ring-1 ring-indigo-700/50 shadow-sm">{activeFilterCount} active</span>
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
                  <span className={'inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-extrabold ' + (current ? 'bg-indigo-600 text-white' : disabled ? 'bg-slate-200 text-slate-400' : 'bg-slate-200 text-slate-300')}>{f.level}</span>
                  <span className={'text-[11px] font-extrabold ' + (current ? 'text-indigo-300' : 'text-slate-200')}>{f.label_en}</span>
                  <span className="text-[10px] text-slate-500" style={{direction:'rtl'}}>{f.label_ar}</span>
                </span>
                <select
                  value={current}
                  onChange={function (e) { setFilterLevel(f.field, e.target.value); }}
                  disabled={disabled}
                  className={'w-full px-2.5 py-1.5 border rounded-md text-sm font-bold transition shadow-sm ' + (current ? 'border-indigo-500 bg-indigo-500/20 text-indigo-200 ring-1 ring-indigo-500/40' : disabled ? 'border-slate-700 bg-slate-900 text-slate-400 cursor-not-allowed' : 'border-slate-600 bg-slate-800 text-slate-200 hover:border-slate-500')}
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

      {/* Stock Summary — v55.83-H polish. One card replacing the separate Products,
          per-unit, rolls, and revenue/cogs/profit blocks (the reviewers' "too many
          stacked boxes"). Quantities stay PER unit of measure (kg/meter/… can't be
          summed); money totals sum across all. No numbers changed — display only. */}
      <div className="bg-slate-900/70 border border-slate-700/60 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-700/60 flex items-center justify-between">
          <span className="text-xs font-extrabold uppercase tracking-[0.15em] text-slate-300">Stock Summary</span>
          <span className="text-[10px] font-semibold text-slate-500">{fmtInt(grandTotals.product_count)} products · by unit of measure</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[9px] uppercase tracking-[0.14em] text-slate-500">
              <th className="text-left font-bold px-4 py-2">Unit</th>
              <th className="text-right font-bold px-4 py-2">Current</th>
              <th className="text-right font-bold px-4 py-2">Original</th>
              <th className="text-right font-bold px-4 py-2">Sold</th>
            </tr>
          </thead>
          <tbody>
            {(grandTotals.units || []).map(function (u) {
              return (
                <tr key={u.unit} className="border-t border-slate-800">
                  <td className="px-4 py-2.5"><span className="px-2 py-0.5 bg-blue-600/90 text-white text-[10px] font-extrabold rounded tracking-wider">{unitLabel(u.unit)}</span></td>
                  <td className="px-4 py-2.5 text-right font-mono font-extrabold tabular-nums text-blue-200">{fmtNum(u.current_qty, 2)}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-indigo-200">{fmtNum(u.original_qty, 2)}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-emerald-200">{fmtNum(u.sold_qty, 2)}</td>
                </tr>
              );
            })}
            {grandTotals.rolls_original > 0 && (
              <tr className="border-t border-slate-800">
                <td className="px-4 py-2.5"><span className="px-2 py-0.5 bg-amber-600 text-white text-[10px] font-extrabold rounded tracking-wider">ROLLS</span></td>
                <td className="px-4 py-2.5 text-right font-mono font-extrabold tabular-nums text-amber-200">{fmtNum(grandTotals.rolls_current, 0)}</td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums text-amber-200/70">{fmtNum(grandTotals.rolls_original, 0)}</td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums text-emerald-200">{fmtNum(grandTotals.rolls_sold, 0)}</td>
              </tr>
            )}
            {(!grandTotals.units || grandTotals.units.length === 0) && !(grandTotals.rolls_original > 0) && (
              <tr><td colSpan={4} className="px-4 py-3 text-center text-slate-500 text-xs">No stock yet / لا يوجد مخزون</td></tr>
            )}
          </tbody>
        </table>
        {seeCosts && (
          <div className="grid grid-cols-3 divide-x divide-slate-800 border-t border-slate-700/60 bg-slate-900/40">
            <div className="px-4 py-3">
              <div className="text-[9px] font-bold uppercase tracking-[0.15em] text-amber-300">Revenue</div>
              <div className="text-lg font-extrabold tabular-nums text-amber-100 leading-tight">{fmtNum(grandTotals.sold_revenue, 2)}</div>
            </div>
            <div className="px-4 py-3">
              <div className="text-[9px] font-bold uppercase tracking-[0.15em] text-orange-300">COGS</div>
              <div className="text-lg font-extrabold tabular-nums text-orange-100 leading-tight">{fmtNum(grandTotals.cogs_total, 2)}</div>
            </div>
            <div className="px-4 py-3">
              <div className={'text-[9px] font-bold uppercase tracking-[0.15em] ' + (grandTotals.gross_profit >= 0 ? 'text-emerald-300' : 'text-red-300')}>Gross Profit</div>
              <div className={'text-lg font-extrabold tabular-nums leading-tight ' + (grandTotals.gross_profit >= 0 ? 'text-emerald-100' : 'text-red-100')}>{fmtNum(grandTotals.gross_profit, 2)}</div>
            </div>
          </div>
        )}
      </div>

      {/* Loading / error / empty states */}
      {loading && <div className="text-center py-10 text-slate-400 font-bold">Loading inventory... / جاري التحميل</div>}
      {error && !loading && (
        <div className="bg-red-100 border-2 border-red-400 text-red-300 rounded p-3 font-bold">
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
          <div key={g.family_id} className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden shadow-lg">
            {/* Group header — click to toggle */}
            <button
              onClick={function () { toggleGroup(g.family_id); }}
              className="w-full px-4 py-3 bg-gradient-to-r from-slate-800 to-slate-900 hover:from-slate-700 hover:to-slate-800 flex items-center justify-between text-left border-b border-slate-700"
            >
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-lg font-extrabold text-slate-300">{collapsed ? '▶' : '▼'}</span>
                <span className="px-2 py-0.5 bg-orange-500 text-white text-xs font-extrabold rounded">{g.code}</span>
                <span className="text-base font-extrabold text-white">{g.label_en}</span>
                <span className="text-sm font-bold text-slate-400" style={{ direction: 'rtl' }}>/ {g.label_ar}</span>
                <span className="text-xs text-slate-400 font-semibold">({g.products.length} {g.products.length === 1 ? 'product' : 'products'})</span>
              </div>
              <div className="flex items-center gap-2 text-xs font-bold text-slate-300 flex-wrap justify-end">
                {Object.keys(g.totals.by_uom || {}).filter(function (u) {
                  var b = g.totals.by_uom[u];
                  return (b.current || 0) !== 0 || (b.original || 0) !== 0 || (b.sold || 0) !== 0;
                }).sort().map(function (u) {
                  var b = g.totals.by_uom[u];
                  return (
                    <div key={u} className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-800/80 border border-slate-700">
                      <span className={'px-1.5 py-0.5 rounded text-white text-[9px] font-extrabold tracking-wider ' + uomBadgeColor(u)}>{unitLabel(u)}</span>
                      <span className="text-blue-200">{fmtNum(b.current, 2)}</span>
                      <span className="text-slate-500 font-semibold">/ {fmtNum(b.original, 2)}</span>
                      {b.sold > 0 && <span className="text-emerald-300 ml-0.5">· {fmtNum(b.sold, 2)} sold</span>}
                    </div>
                  );
                })}
                {g.totals.rolls_original > 0 && (
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-amber-500/15 border border-amber-500/40">
                    <span className="px-1.5 py-0.5 rounded text-white text-[9px] font-extrabold tracking-wider bg-amber-600">ROLLS</span>
                    <span className="text-amber-300">{fmtNum(g.totals.rolls_current, 0)}</span>
                    <span className="text-slate-500 font-semibold">/ {fmtNum(g.totals.rolls_original, 0)}</span>
                  </div>
                )}
                {seeCosts && (
                  <div className="px-2 py-1">P&amp;L: <span className={g.totals.gross_profit >= 0 ? 'text-emerald-300' : 'text-red-300'}>{fmtNum(g.totals.gross_profit, 2)}</span></div>
                )}
              </div>
            </button>

            {/* Group body — products table */}
            {!collapsed && (
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-950 sticky top-0 z-10">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-[11px] uppercase tracking-wider font-extrabold text-slate-400 border-b-2 border-slate-700">Code</th>
                      <th className="px-3 py-2.5 text-left text-[11px] uppercase tracking-wider font-extrabold text-slate-400 border-b-2 border-slate-700">Design SKU</th>
                      <th className="px-3 py-2.5 text-left text-[11px] uppercase tracking-wider font-extrabold text-slate-400 border-b-2 border-slate-700">Name</th>
                      <th className="px-3 py-2.5 text-right text-[11px] uppercase tracking-wider font-extrabold text-slate-400 border-b-2 border-slate-700">Current</th>
                      <th className="px-3 py-2.5 text-right text-[11px] uppercase tracking-wider font-extrabold text-slate-400 border-b-2 border-slate-700">Original</th>
                      <th className="px-3 py-2.5 text-right text-[11px] uppercase tracking-wider font-extrabold text-slate-400 border-b-2 border-slate-700">Sold</th>
                      <th className="px-3 py-2.5 text-right text-[11px] uppercase tracking-wider font-extrabold text-amber-300 border-b-2 border-slate-700">Rolls<div className="text-[8px] font-bold text-slate-500 normal-case tracking-normal">on hand / recv</div></th>
                      {seeCosts && (
                        <>
                          <th className="px-3 py-2.5 text-right text-[11px] uppercase tracking-wider font-extrabold text-amber-300 border-b-2 border-slate-700 bg-slate-900">Avg Cost</th>
                          <th className="px-3 py-2.5 text-right text-[11px] uppercase tracking-wider font-extrabold text-amber-300 border-b-2 border-slate-700 bg-slate-900">Avg Sold Price</th>
                          <th className="px-3 py-2.5 text-right text-[11px] uppercase tracking-wider font-extrabold text-amber-300 border-b-2 border-slate-700 bg-slate-900">P&amp;L</th>
                        </>
                      )}
                      <th className="px-3 py-2.5 text-left text-[11px] uppercase tracking-wider font-extrabold text-slate-400 border-b-2 border-slate-700">UoM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.products.map(function (p, rowIdx) {
                      var s = productStats[p.id] || { current_qty: 0, current_weighted_cost: 0, original_qty: 0, sold_qty: 0, sold_revenue: 0, cogs_total: 0, gross_profit: 0 };
                      var avgCost = s.finalized_qty > 0 ? s.current_weighted_cost / s.finalized_qty : 0; // v55.83-H QA: divide cost by FINALIZED qty only (current_qty also includes uncosted pending stock, which understated avg cost)
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
                      // v55.83-A (Max Jun 1 2026) — NAME IS NOW DRIVEN BY THE STORED name_en,
                      // which the rename SQL builds per the agreed convention:
                      //   Leather/Textile (family code L/T): Family Category Grade Construction Backing Color
                      //   PVC/Boat (P/B):                    Family Category Grade Construction Color Backing Pattern Spec
                      // The GUI previously REBUILT the name live (Category Grade Color Backing),
                      // which ignored the stored name and showed the wrong order. We now show the
                      // stored name as the single source of truth. If a product has no stored name
                      // yet, fall back to a family-aware computed name (same order + word de-dupe).
                      function famOrder(code) {
                        var c = String(code || '').toUpperCase();
                        if (c === 'P' || c === 'B') {
                          return ['family_list_id','category_list_id','grade_list_id','construction_list_id','color_list_id','backing_list_id','pattern_list_id','spec_class_list_id'];
                        }
                        // L, T, and default
                        return ['family_list_id','category_list_id','grade_list_id','construction_list_id','backing_list_id','color_list_id'];
                      }
                      function dedupeWords(str) {
                        var seen = {};
                        return String(str || '').split(/\s+/).filter(function (w) {
                          if (!w) return false;
                          var k = w.toLowerCase();
                          if (seen[k]) return false;
                          seen[k] = true; return true;
                        }).join(' ');
                      }
                      function buildFrom(field) {
                        var famEntry = listsById[p.family_list_id];
                        var order = famOrder(famEntry && famEntry.code);
                        var noise = { 'not applicable': 1, 'none': 1, 'n/a': 1, 'na': 1, '': 1 };
                        var parts = order.map(function (col) {
                          var l = listsById[p[col]];
                          if (!l) return '';
                          var v = (field === 'ar') ? (l.label_ar || '') : (l.label_en || l.code || '');
                          if (noise[String(v).toLowerCase().trim()]) return '';
                          return v;
                        }).filter(function (v) { return v; });
                        return dedupeWords(parts.join(' '));
                      }
                      var displayNameEn = (p.name_en && p.name_en.trim()) ? p.name_en : (buildFrom('en') || '—');
                      var displayNameAr = (p.name_ar && p.name_ar.trim()) ? p.name_ar : (buildFrom('ar') || '');
                      // v55.83-A (Max Jun 1 2026) — clearer separation between items:
                      // zebra striping + thicker divider + roomier padding so each
                      // multi-line product reads as its own block, not a wall of text.
                      var zebra = (rowIdx % 2 === 0) ? 'bg-slate-800/40' : 'bg-slate-900/40';
                      // v55.83-H (Max Jun 2 2026) — rolls in the row.
                      //   • original rolls = rolls received (recv_rolls)
                      //   • current rolls  = received − rolls sold (real depletion; never below 0)
                      //   • sold rolls     = rolls entered on sales lines
                      // For products SOLD in rolls, the main qty IS rolls, so no sub-line.
                      var uomNorm = String(effUom(p) || '').toLowerCase().trim();
                      var isRollUnit = uomNorm === 'roll' || uomNorm === 'rolls';
                      var origRolls = s.recv_rolls || 0;
                      var soldRolls = s.sold_rolls || 0;
                      var currRolls = Math.max(0, origRolls - soldRolls);
                      var showRolls = !isRollUnit && (origRolls > 0 || soldRolls > 0);
                      return (
                        <tr key={p.id} className={zebra + ' border-b-2 border-slate-700 hover:bg-slate-700/50 align-top'}>
                          <td onClick={function () { openHistory(p); }} title="Open drill-down — inbound orders + sales for this product" className="px-3 py-3 font-mono text-slate-100 font-bold cursor-pointer hover:text-indigo-200 transition-colors">
                            {p.quick_code || '—'}
                            {p.variant_suffix && <span className="text-slate-400">-{p.variant_suffix}</span>}
                          </td>
                          <td className="px-3 py-3 font-mono text-slate-300">{p.design_sku || '—'}</td>
                          <td className="px-3 py-3">
                            <div onClick={function () { openHistory(p); }} className="font-bold text-white text-[13px] cursor-pointer hover:text-indigo-200 transition-colors" title="Open drill-down — inbound orders + sales">{displayNameEn}</div>
                            {displayNameAr && <div className="text-xs text-slate-300" style={{ direction: 'rtl' }}>{displayNameAr}</div>}
                            <div className="mt-0.5">
                              <span className="inline-block px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-200 text-[10px] font-bold tracking-wide">Sold in: {effUom(p)}</span>
                            </div>
                            {/* v55.83-A.6.27.60 — All 9 classification levels inline under name */}
                            {levelLabels.length > 0 && (
                              <div className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                                {levelLabels.map(function (pair, i) {
                                  return (
                                    <span key={i} className="inline-block mr-2">
                                      <span className="font-bold text-slate-500">{pair[0]}:</span>{' '}
                                      <span className="text-slate-200">{pair[1].label_en || pair[1].code}</span>
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                            {/* v55.83-A.6.27.60 — History drilldown link */}
                            <button
                              onClick={function () { openHistory(p); }}
                              className="inline-flex items-center gap-1 mt-1.5 px-2.5 py-1 rounded-md bg-indigo-500/15 hover:bg-indigo-500/30 border border-indigo-500/40 text-indigo-200 text-[11px] font-extrabold transition"
                              title="Open the drill-down — the inbound orders this stock came from + the sales that drew it down"
                            >📜 Inbound &amp; sales →</button>
                          </td>
                          {/* v55.83-A.6.27.72 HOTFIX 29 — Per Max screenshot May 28 2026: Current/Original
                              columns showing 0.00 in text-blue-300 / text-indigo-300 / text-emerald-300
                              against the dark row bg made them unreadable (HOTFIX 25 rule violated).
                              Switched to -300 light shades so the numbers stand out on dark surfaces. */}
                          <td className="px-3 py-3 text-right font-mono font-extrabold text-blue-300">
                            <span className="inline-flex items-center gap-1.5 justify-end">
                              {(s.current_qty > 0 || s.has_pending) && (
                                <span
                                  title={s.has_pending ? 'Received — awaiting cost finalize' : 'Cost finalized'}
                                  className={'inline-block w-2 h-2 rounded-full ' + (s.has_pending ? 'bg-amber-400' : 'bg-emerald-400')}
                                ></span>
                              )}
                              <span>{fmtNum(s.current_qty, 2)}</span>
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right font-mono text-indigo-300">{fmtNum(s.original_qty, 2)}</td>
                          <td className="px-3 py-3 text-right font-mono text-emerald-300">{fmtNum(s.sold_qty, 2)}</td>
                          <td className="px-3 py-3 text-right font-mono" title="Rolls on hand = received − sold">
                            {showRolls ? (
                              <span>
                                <span className="font-extrabold text-amber-300">{fmtNum(currRolls, 0)}</span>
                                <span className="text-slate-500 text-[11px]"> / {fmtNum(origRolls, 0)}</span>
                                {soldRolls > 0 && <div className="text-[10px] font-semibold text-emerald-400/70">{fmtNum(soldRolls, 0)} sold</div>}
                              </span>
                            ) : <span className="text-slate-400">—</span>}
                          </td>
                          {seeCosts && (
                            <>
                              <td className="px-3 py-3 text-right font-mono text-amber-200 bg-slate-800/60">{fmtNum(avgCost, 2)}</td>
                              <td className="px-3 py-3 text-right font-mono text-amber-200 bg-slate-800/60">{fmtNum(avgSoldPrice, 2)}</td>
                              <td className={'px-3 py-3 text-right font-mono font-extrabold bg-slate-800/60 ' + (s.gross_profit >= 0 ? 'text-emerald-300' : 'text-red-300')}>{fmtNum(s.gross_profit, 2)}</td>
                            </>
                          )}
                          <td className="px-3 py-3 text-xs font-bold text-slate-200">{effUom(p)}</td>
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
        <div className="text-xs text-slate-400 italic mt-2">
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
          <div className="bg-slate-950 text-slate-100 rounded-2xl shadow-2xl w-full max-w-5xl my-4 border border-slate-800">
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
                className="bg-white text-slate-200 w-9 h-9 rounded-full font-bold text-lg shadow"
              >✕</button>
            </div>

            {/* v55.83-R — tabbed drill-down: Summary · Inbound Orders · Sales */}
            <div className="flex gap-1 px-5 pt-3 border-b border-slate-800 bg-slate-900/40">
              {[
                { k: 'summary', label: 'Summary' },
                { k: 'inbound', label: 'Inbound Orders (' + historyReceipts.length + ')' },
                { k: 'sales', label: 'Sales (' + historyMovements.length + ')' },
              ].map(function (t) {
                var on = historyTab === t.k;
                return (
                  <button key={t.k} onClick={function () { setHistoryTab(t.k); }}
                    className={'px-4 py-2 text-sm font-extrabold rounded-t-lg border-b-2 -mb-px transition ' + (on ? 'border-indigo-400 text-indigo-200 bg-slate-800/60' : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30')}>
                    {t.label}
                  </button>
                );
              })}
            </div>

            <div className="px-5 py-4 space-y-4">
              {/* Stock summary */}
              {historyTab === 'summary' && (function () {
                var s = productStats[historyProduct.id] || { current_qty: 0, current_weighted_cost: 0, original_qty: 0, sold_qty: 0, sold_revenue: 0, cogs_total: 0, gross_profit: 0 };
                var avgCost = s.finalized_qty > 0 ? s.current_weighted_cost / s.finalized_qty : 0; // v55.83-H QA: divide cost by FINALIZED qty only (current_qty also includes uncosted pending stock, which understated avg cost)
                var avgSold = s.sold_qty > 0 ? s.sold_revenue / s.sold_qty : 0;
                return (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <div className="bg-blue-500/15 border border-blue-500/30 rounded p-2">
                      <div className="text-[10px] font-extrabold text-blue-300 uppercase tracking-wider">Current Stock</div>
                      <div className="text-lg font-mono font-extrabold text-blue-300">{fmtNum(s.current_qty, 2)} {historyProduct.default_uom || ''}</div>
                    </div>
                    <div className="bg-indigo-500/15 border border-indigo-500/30 rounded p-2">
                      <div className="text-[10px] font-extrabold text-indigo-300 uppercase tracking-wider">Original Received</div>
                      <div className="text-lg font-mono font-extrabold text-indigo-300">{fmtNum(s.original_qty, 2)}</div>
                    </div>
                    <div className="bg-emerald-500/15 border border-emerald-500/30 rounded p-2">
                      <div className="text-[10px] font-extrabold text-emerald-300 uppercase tracking-wider">Sold</div>
                      <div className="text-lg font-mono font-extrabold text-emerald-300">{fmtNum(s.sold_qty, 2)}</div>
                    </div>
                    {seeCosts && (
                      <div className={'border rounded p-2 ' + (s.gross_profit >= 0 ? 'bg-emerald-500/15 border-emerald-500/40' : 'bg-red-500/15 border-red-500/40')}>
                        <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-100">P&amp;L</div>
                        <div className={'text-lg font-mono font-extrabold ' + (s.gross_profit >= 0 ? 'text-emerald-300' : 'text-red-300')}>{fmtNum(s.gross_profit, 2)}</div>
                        <div className="text-[10px] text-slate-300">Avg cost {fmtNum(avgCost, 2)} · sold {fmtNum(avgSold, 2)}</div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {historyLoading && (
                <div className="text-center py-6 text-slate-400 font-semibold">Loading history...</div>
              )}

              {!historyLoading && (
                <>
                  {/* v55.83-A (Max Jun 1 2026) — Intake by Country: how much of this
                      product was received from each country. Product sells as ONE unit;
                      this shows the US-vs-Canada (etc.) intake split. */}
                  {historyTab === 'summary' && historyIntakeByCountry.length > 0 && (
                    <div className="mb-4">
                      <div className="text-sm font-extrabold text-slate-100 mb-2">🌍 Intake by Country — where stock came from</div>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        {historyIntakeByCountry.map(function (c) {
                          return (
                            <div key={c.country} className="bg-slate-800/60 border border-slate-700 rounded p-2">
                              <div className="text-[11px] font-extrabold text-slate-300 uppercase">{c.label}</div>
                              <div className="text-slate-100 font-bold text-sm">{(Math.round(c.kg * 1000) / 1000).toLocaleString()} kg</div>
                              <div className="text-[11px] text-slate-400">{c.rolls.toLocaleString()} rolls · {(Math.round(c.qty * 1000) / 1000).toLocaleString()} qty</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* v55.83-S — Inbound Orders sourced from stock receipts (finalized OR
                      pending), so on-hand stock always shows the shipments it came from.
                      Cost layers only exist after finalization, so reading them hid
                      received-but-not-yet-finalized stock. */}
                  {historyTab === 'inbound' && (
                  <div>
                    <div className="text-sm font-extrabold text-slate-100 mb-2">📥 Inbound Orders — shipments this stock came from ({historyReceipts.length})</div>
                    {historyReceipts.length === 0 ? (
                      <div className="text-xs text-slate-400 italic p-3 bg-slate-800/40 rounded">No inbound shipments recorded for this product yet.</div>
                    ) : (
                      <div className="overflow-auto border border-slate-700 rounded">
                        <table className="w-full text-xs">
                          <thead className="bg-slate-800/70">
                            <tr>
                              <th className="px-2 py-1.5 text-left font-extrabold text-slate-100">Date</th>
                              <th className="px-2 py-1.5 text-left font-extrabold text-slate-100">Shipment / Receipt</th>
                              <th className="px-2 py-1.5 text-left font-extrabold text-slate-100">Supplier</th>
                              <th className="px-2 py-1.5 text-left font-extrabold text-slate-100">Origin</th>
                              <th className="px-2 py-1.5 text-right font-extrabold text-slate-100">Qty Received</th>
                              <th className="px-2 py-1.5 text-right font-extrabold text-slate-100">Rolls</th>
                              <th className="px-2 py-1.5 text-left font-extrabold text-slate-100">Status</th>
                              {seeCosts && <th className="px-2 py-1.5 text-right font-extrabold text-amber-200 bg-amber-500/10">Unit Cost</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {historyReceipts.map(function (r) {
                              var st = r.status || 'received';
                              var badge = st === 'finalized'
                                ? { cls: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40', txt: 'In stock · costed' }
                                : (st === 'pending_detail'
                                  ? { cls: 'bg-slate-600/30 text-slate-300 border border-slate-500/40', txt: 'Logged · not counted' }
                                  : { cls: 'bg-amber-500/15 text-amber-300 border border-amber-500/40', txt: 'Received · awaiting cost' });
                              var ref = r.receipt_number || r.shipment_reference || r.container_number || '—';
                              return (
                                <tr key={r.id} className="border-b border-slate-700">
                                  <td className="px-2 py-1.5 font-mono text-slate-300">{r.receipt_date ? String(r.receipt_date).substring(0, 10) : '—'}</td>
                                  <td className="px-2 py-1.5 font-mono text-slate-200">{ref}</td>
                                  <td className="px-2 py-1.5 text-slate-300">{r.supplier || '—'}</td>
                                  <td className="px-2 py-1.5 text-slate-300">{r.origin_country_code || '—'}</td>
                                  <td className="px-2 py-1.5 text-right font-mono font-bold text-indigo-300">{fmtNum(r.quantity || 0, 2)} {r.uom || ''}</td>
                                  <td className="px-2 py-1.5 text-right font-mono text-amber-200">{fmtNum(r.roll_count || 0, 0)}</td>
                                  <td className="px-2 py-1.5"><span className={'inline-block px-2 py-0.5 rounded text-[10px] font-bold ' + badge.cls}>{badge.txt}</span></td>
                                  {seeCosts && <td className="px-2 py-1.5 text-right font-mono text-amber-100 bg-amber-500/10">{r.cost_per_uom != null ? fmtNum(r.cost_per_uom, 2) + ' ' + (r.currency || '') : '—'}</td>}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                  )}

                  {/* Outbound movements */}
                  {historyTab === 'sales' && (
                  <div>
                    <div className="text-sm font-extrabold text-slate-100 mb-2">📤 Outbound — Movements ({historyMovements.length})</div>
                    {historyMovements.length === 0 ? (
                      <div className="text-xs text-slate-400 italic p-3 bg-slate-800/40 rounded">No outbound history found for this product.</div>
                    ) : (
                      <div className="overflow-auto border border-slate-700 rounded">
                        <table className="w-full text-xs">
                          <thead className="bg-slate-800/70">
                            <tr>
                              <th className="px-2 py-1.5 text-left font-extrabold text-slate-100">Date</th>
                              <th className="px-2 py-1.5 text-left font-extrabold text-slate-100">Type</th>
                              <th className="px-2 py-1.5 text-left font-extrabold text-slate-100">Reference</th>
                              <th className="px-2 py-1.5 text-right font-extrabold text-slate-100">Qty</th>
                              {seeCosts && <th className="px-2 py-1.5 text-right font-extrabold text-amber-200 bg-amber-500/10">Revenue</th>}
                              {seeCosts && <th className="px-2 py-1.5 text-right font-extrabold text-amber-200 bg-amber-500/10">COGS</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {historyMovements.map(function (mov) {
                              return (
                                <tr key={mov.id} className="border-b border-slate-700">
                                  <td className="px-2 py-1.5 font-mono text-slate-300">{mov.moved_at ? String(mov.moved_at).substring(0, 10) : '—'}</td>
                                  <td className="px-2 py-1.5 text-slate-200 font-semibold">{mov.movement_type || mov.type || '—'}</td>
                                  <td className="px-2 py-1.5 font-mono text-slate-300">{mov.invoice_number || mov.reference || mov.notes || '—'}</td>
                                  <td className="px-2 py-1.5 text-right font-mono font-bold text-emerald-300">{fmtNum(mov.quantity || mov.qty || 0, 2)}</td>
                                  {seeCosts && <td className="px-2 py-1.5 text-right font-mono text-amber-100 bg-amber-500/10">{fmtNum(mov.revenue || 0, 2)}</td>}
                                  {seeCosts && <td className="px-2 py-1.5 text-right font-mono text-amber-100 bg-amber-500/10">{fmtNum(mov.cogs || 0, 2)}</td>}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                  )}
                </>
              )}
            </div>

            {/* Modal footer */}
            <div className="border-t border-slate-800 px-5 py-3 flex justify-end bg-slate-900/60 rounded-b-2xl">
              <button onClick={closeHistory} className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-extrabold rounded">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
