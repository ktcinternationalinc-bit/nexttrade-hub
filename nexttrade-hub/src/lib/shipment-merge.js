'use client';
// v55.83-CQ — Inbound shipment MERGE engine (pure, fully testable).
// This encodes the data-integrity rules for merging several inbound shipments into
// one shell: aggregate the SAME product into one line, keep genuinely different
// products/UOMs separate, never double-count, and always preserve the original
// per-source line breakdown so nothing is lost. UI + DB writes are layered on top
// of these pure functions in a later build.

function num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }

// Product identity for aggregation. A product_id already encodes family/category/
// grade/construction/backing/color/pattern/spec/origin (it's one product), so the
// identity key is product_id + UOM. Same product received under a DIFFERENT UOM is
// intentionally NOT aggregated (kept separate + flagged) — you can't add kg to meters.
export function productIdentityKey(line) {
  var pid = line.product_id != null && line.product_id !== '' ? String(line.product_id) : ('noid:' + String(line.id || ''));
  return pid + '|' + String(line.uom || '').toLowerCase().trim();
}

// Aggregate source lines into combined lines. Same identity key -> one line with
// summed quantities; each contributing source line is preserved under `sources`.
export function aggregateLines(lines) {
  var map = {}; var order = [];
  (lines || []).forEach(function (ln) {
    var key = productIdentityKey(ln);
    if (!map[key]) {
      map[key] = {
        key: key,
        product_id: ln.product_id != null ? ln.product_id : null,
        uom: ln.uom || null,
        quantity: 0, quantity_kg: 0, roll_count: 0,
        expected_rolls: 0, expected_gross_kg: 0, expected_net_kg: 0,
        sources: []
      };
      order.push(key);
    }
    var g = map[key];
    g.quantity += num(ln.quantity);
    g.quantity_kg += num(ln.quantity_kg);
    g.roll_count += num(ln.roll_count);
    g.expected_rolls += num(ln.expected_rolls);
    g.expected_gross_kg += num(ln.expected_gross_kg);
    g.expected_net_kg += num(ln.expected_net_kg);
    g.sources.push({
      receipt_number: ln.receipt_number || null,
      line_id: ln.id != null ? ln.id : null,
      product_id: ln.product_id != null ? ln.product_id : null,
      uom: ln.uom || null,
      quantity: num(ln.quantity),
      quantity_kg: num(ln.quantity_kg),
      roll_count: num(ln.roll_count),
      status: ln.status || null,
      notes: ln.notes || null
    });
  });
  return order.map(function (k) { return map[k]; });
}

// Warnings the UI should surface before confirming a merge.
// - uom_conflict: the same product appears under more than one UOM (kept separate).
export function mergeWarnings(lines) {
  var byProduct = {}; var warns = [];
  (lines || []).forEach(function (ln) {
    var pid = ln.product_id != null && ln.product_id !== '' ? String(ln.product_id) : '';
    if (!pid) { return; }
    var u = String(ln.uom || '').toLowerCase().trim();
    if (!byProduct[pid]) { byProduct[pid] = {}; }
    byProduct[pid][u] = true;
  });
  Object.keys(byProduct).forEach(function (pid) {
    var uoms = Object.keys(byProduct[pid]);
    if (uoms.length > 1) { warns.push({ type: 'uom_conflict', product_id: pid, uoms: uoms }); }
  });
  return warns;
}

// Combine the expected shell totals from the source shipment headers.
export function mergeHeaderTotals(headers) {
  var t = { expected_total_rolls: 0, expected_total_gross_kg: 0, expected_total_net_kg: 0 };
  (headers || []).forEach(function (h) {
    t.expected_total_rolls += num(h.expected_total_rolls);
    t.expected_total_gross_kg += num(h.expected_total_gross_kg);
    t.expected_total_net_kg += num(h.expected_total_net_kg);
  });
  return t;
}

// Build a before/after summary for the audit log + a no-double-count guarantee.
export function mergePlan(lines, headers) {
  var aggregated = aggregateLines(lines);
  var before = { line_count: (lines || []).length, quantity: 0, quantity_kg: 0, roll_count: 0 };
  (lines || []).forEach(function (ln) { before.quantity += num(ln.quantity); before.quantity_kg += num(ln.quantity_kg); before.roll_count += num(ln.roll_count); });
  var after = { line_count: aggregated.length, quantity: 0, quantity_kg: 0, roll_count: 0 };
  aggregated.forEach(function (g) { after.quantity += g.quantity; after.quantity_kg += g.quantity_kg; after.roll_count += g.roll_count; });
  return {
    aggregated: aggregated,
    warnings: mergeWarnings(lines),
    header_totals: mergeHeaderTotals(headers),
    totals_before: before,
    totals_after: after,
    // Conservation: aggregation must never change the grand totals (rounded to avoid fp noise).
    balanced: Math.round(before.quantity * 1000) === Math.round(after.quantity * 1000)
      && Math.round(before.quantity_kg * 1000) === Math.round(after.quantity_kg * 1000)
      && Math.round(before.roll_count * 1000) === Math.round(after.roll_count * 1000)
  };
}
