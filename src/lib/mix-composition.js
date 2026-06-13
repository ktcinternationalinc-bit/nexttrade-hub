// mix-composition.js
// PHASE 1 (read-only) helpers for the Stock Mix Lot feature. Pure functions only —
// no DB, no network, no inventory mutation. Given the mapped component products and
// their current available quantities (summed from inventory_layers.qty_remaining),
// produce the composition report: per-color available, % of mix, and total available.
//
// Phase 2 (proportional drawdown on a real sale) is NOT in this file and must not be
// added here — this stays a read-only calculator.

// components: [{ component_product_id, component_color, name_en, quick_code, is_active }]
// availByProduct: { [product_id]: number }  (sum of qty_remaining for that product)
// Returns { rows:[{...,available,pct}], total }
function buildComposition(components, availByProduct) {
  var list = (components || []).filter(function (c) { return c && c.is_active !== false; });
  var withQty = list.map(function (c) {
    var avail = Number((availByProduct || {})[c.component_product_id]) || 0;
    return {
      component_product_id: c.component_product_id,
      component_color: c.component_color || '',
      name_en: c.name_en || '',
      quick_code: c.quick_code || '',
      available: avail
    };
  });
  var total = 0;
  var i;
  for (i = 0; i < withQty.length; i++) { total = total + withQty[i].available; }
  for (i = 0; i < withQty.length; i++) {
    withQty[i].pct = total > 0 ? (withQty[i].available / total) * 100 : 0;
  }
  // Sort by availability descending so the dominant color reads first.
  withQty.sort(function (a, b) { return b.available - a.available; });
  return { rows: withQty, total: total };
}

// Preview-only proportional split (Phase 2 will USE this for the real consume, but here
// it is exposed read-only so the report/preview can show "selling N would consume...").
// Splits saleQty across components by current availability, last component absorbs the
// rounding remainder so the parts sum to exactly saleQty. Marks shortfall but does NOT
// redistribute here (redistribution is a Phase 2 decision wired with a warning + confirm).
function previewProportionalSplit(rows, saleQty, decimals) {
  decimals = decimals == null ? 2 : decimals;
  var sale = Number(saleQty) || 0;
  var total = 0; var i;
  for (i = 0; i < (rows || []).length; i++) { total = total + (Number(rows[i].available) || 0); }
  var out = [];
  var running = 0;
  var f = Math.pow(10, decimals);
  for (i = 0; i < rows.length; i++) {
    var share;
    if (i === rows.length - 1) {
      share = Math.round((sale - running) * f) / f; // remainder to last
    } else {
      share = total > 0 ? Math.round((sale * (Number(rows[i].available) || 0) / total) * f) / f : 0;
      running = running + share;
    }
    var avail = Number(rows[i].available) || 0;
    out.push({
      component_product_id: rows[i].component_product_id,
      component_color: rows[i].component_color,
      planned: share,
      available: avail,
      shortfall: share > avail ? Math.round((share - avail) * f) / f : 0,
      remaining_if_filled: Math.max(0, Math.round((avail - share) * f) / f)
    });
  }
  return { lines: out, total_available: total, sale_qty: sale, feasible: sale <= total };
}

export { buildComposition, previewProportionalSplit };
