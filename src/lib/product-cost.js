// v55.83-OO — product cost resolution for the P&L.
// A product's cost is EFFECTIVE-DATED: the cost that applies to an invoice line
// is the row with the LATEST effective_from that is ON OR BEFORE the invoice
// date. No row qualifies -> null (the line is reported as UNCOSTED, never
// guessed). Pure functions so the launch tests exercise them with real cases.

export function normalizeProductKey(name) {
  return String(name == null ? '' : name).trim().replace(/\s+/g, ' ').toLowerCase();
}

// costRows: [{ cost_per_unit, effective_from (YYYY-MM-DD) }] for ONE product.
// invoiceDate: YYYY-MM-DD. Returns the applicable row or null.
export function pickCost(costRows, invoiceDate) {
  if (!invoiceDate) { return null; }
  var best = null;
  (costRows || []).forEach(function (r) {
    if (!r || !r.effective_from) { return; }
    if (r.effective_from > invoiceDate) { return; }
    if (!best || r.effective_from > best.effective_from) { best = r; }
  });
  return best;
}

// Build { product_key: [rows...] } from the flat product_costs table.
export function groupCosts(allRows) {
  var byKey = {};
  (allRows || []).forEach(function (r) {
    var k = normalizeProductKey(r.product_key);
    if (!k) { return; }
    if (!byKey[k]) { byKey[k] = []; }
    byKey[k].push(r);
  });
  return byKey;
}
