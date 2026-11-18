// v55.83-UD — P&L on the Profitability cost engine, split CONFIRMED vs TENTATIVE (Max, Nov 18 2026: "why isn't the P&L typed
// costs working — the avg costs are all blank ... use the avg price after shipping removed for CNF as in the other P&L report ...
// a non-confirmed P&L: whatever is 100% confirmed says confirmed, the rest is tentative (missing data)").
//
// Input: the cells of assembleProfitability (one per invoice goods line per release, already with CNF shipping taken out of the
// price, costs from the purchase bills, commission, inbound allowance, brokerage, bonded), the invoice facts (by_invoice[].invoice)
// and the costs typed on the P&L screen (product_costs, per unit, effective-dated) — used ONLY where the engine has no cost.
//
// A sale is CONFIRMED when the engine calls it complete (bill cost, every weight, the release, the pricing basis, the actual shipping
// bill, nothing unallocated) AND no estimate, no typed cost, no guessed basis was used. (Codex 11:50) CONFIRMED still includes the
// STANDARD allowances Max approved — the inbound allowance per lb and the standard $200 bonded per Houston container — which are
// not bills: each row lists them under 'allowances', and the screen says "bill costs + standard allowances", never "100% real".
// Everything else is TENTATIVE, with the reasons in plain words. A sale with no cost at all stays out of the margin (as before).
// Pure, no database. SWC-safe (var + concatenation).

function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function r4(x) { return Math.round((Number(x) || 0) * 10000) / 10000; }
function nz(x) { return x === null || x === undefined ? 0 : Number(x) || 0; }

export var REASON_WORDS = {
  unit_unknown: 'unit not set (lb / kg / ton …)',
  release_missing: 'no release number',
  basis_missing: 'pricing basis (CNF / EXW) not set',
  transport_not_separated: 'shipping inside the CNF price not separated',
  allocation_unresolved_missing_weight: 'a weight on the invoice or release is missing',
  purchase_line_without_cost: 'a linked supplier bill line has no cost',
  cost_manual: 'cost typed by hand (Profitability set-up), not from a bill',
  cost_assumed_before_first_purchase: 'cost taken from a purchase dated after the sale',
  outbound_bill_missing: 'shipping bill missing',
  outbound_estimate: 'shipping is an estimate (no bill yet)',
  release_split_missing: 'pounds per release not split',
  embedded_exceeds_goods: 'shipping typed inside the price is more than the goods'
};

// one cell → { qty, pounds, revenue, cost, cost_source, shipping_charged, shipping_cost, confirmed, reasons[] }
export function classifyCell(c, meta, typed) {
  var reasons = [];
  function add(r) { if (r && reasons.indexOf(r) < 0) { reasons.push(r); } }
  (c.flags || []).forEach(function (f) { if (f !== 'cost_missing' && f !== 'no_bill_description_linked' && f !== 'not_grouped_no_cost_source' && REASON_WORDS[f]) { add(REASON_WORDS[f]); } });
  // revenue = the goods price (CNF: shipping inside the price taken out). Not separable → the invoiced amount, tentative.
  var revenue = c.goods_revenue !== null && c.goods_revenue !== undefined ? Number(c.goods_revenue) : nz(c.invoiced);
  if (c.goods_revenue === null || c.goods_revenue === undefined) { add('shipping inside the price could not be taken out'); }
  // this cell's share of the invoice line quantity (a line split over two releases is two cells)
  var lineAmt = nz(c.orig_qty) * nz(c.orig_unit_price);
  var qty = lineAmt > 0 ? nz(c.orig_qty) * nz(c.invoiced) / lineAmt : nz(c.orig_qty);
  var cost = null; var source = null;
  if (c.base_cost !== null && c.base_cost !== undefined) {
    cost = nz(c.base_cost) + nz(c.commission) + nz(c.inbound_allowance) + nz(c.brokerage) + nz(c.bonded); source = 'bills';
    if (c.commission === null || c.commission === undefined) { add('commission not known'); }
    if (c.brokerage === null || c.brokerage === undefined || c.bonded === null || c.bonded === undefined) { add('brokerage / bonded not known'); }
  } else if (typed && Number(typed.cost_per_unit) >= 0) {
    cost = qty * Number(typed.cost_per_unit); source = 'typed';
    add('cost typed on the P&L screen (per unit), not from the bills');
  } else {
    add('no cost: ' + (c.cost_missing_reason || 'missing'));
  }
  if (meta) {
    if (meta.basis_source === 'inferred') { add('CNF / EXW guessed by rule, not confirmed on the invoice'); }
    if (meta.embedded_used > 0 && /estimate/i.test(String(meta.embedded_source || ''))) { add('shipping inside the price is an estimate'); }
  }
  var allowances = [];
  if (source === 'bills' && nz(c.inbound_allowance) > 0) { allowances.push('standard inbound allowance (per lb)'); }
  if (source === 'bills' && nz(c.bonded) > 0 && /standard/i.test(String(c.bonded_from || ''))) { allowances.push('standard $200 bonded'); }
  var confirmed = c.complete === true && source === 'bills' && reasons.length === 0;
  if (!confirmed && !reasons.length) { add('not complete in the Profitability report'); }
  return { qty: qty, pounds: c.pounds, revenue: revenue, cost: cost === null ? null : r2(cost), cost_source: source,
    shipping_charged: c.transport_revenue, shipping_cost: c.outbound_cost, confirmed: confirmed, reasons: reasons, allowances: allowances };
}

function newRow(key, label, extra) {
  return Object.assign({ key: key, label: label, qty: 0, pounds: 0, pounds_missing: false, revenue: 0, costed_revenue: 0, cogs: 0, costed_qty: 0, costed_pounds: 0,
    uncosted_revenue: 0, shipping_charged: 0, shipping_cost: 0, cells: 0, confirmed_cells: 0, reasons: {}, allowances: {} }, extra || {});
}
function addTo(row, k) {
  row.cells++; if (k.confirmed) { row.confirmed_cells++; }
  row.qty += k.qty; if (k.pounds !== null && k.pounds > 0) { row.pounds += k.pounds; } else { row.pounds_missing = true; }
  row.revenue += k.revenue; row.shipping_charged += nz(k.shipping_charged); row.shipping_cost += nz(k.shipping_cost);
  if (k.cost === null) { row.uncosted_revenue += k.revenue; }
  else { row.costed_revenue += k.revenue; row.cogs += k.cost; row.costed_qty += k.qty; if (k.pounds !== null && k.pounds > 0) { row.costed_pounds += k.pounds; } }
  k.reasons.forEach(function (r) { row.reasons[r] = (row.reasons[r] || 0) + 1; });
  (k.allowances || []).forEach(function (a) { row.allowances[a] = (row.allowances[a] || 0) + 1; });
}
function finish(row) {
  var o = { key: row.key, label: row.label, invoice_date: row.invoice_date, customer: row.customer,
    qty: r2(row.qty), pounds: Math.round(row.pounds * 1000) / 1000, revenue: r2(row.revenue), costed_revenue: r2(row.costed_revenue), cogs: r2(row.cogs),
    uncosted_revenue: r2(row.uncosted_revenue), shipping_charged: r2(row.shipping_charged), shipping_cost: r2(row.shipping_cost), cells: row.cells, confirmed_cells: row.confirmed_cells };
  o.avg_price = row.qty > 0 ? r4(row.revenue / row.qty) : null;
  o.avg_price_per_lb = row.pounds > 0 && !row.pounds_missing ? r4(row.revenue / row.pounds) : null;
  o.avg_cost = row.costed_qty > 0 ? r4(row.cogs / row.costed_qty) : null;
  o.avg_cost_per_lb = row.costed_pounds > 0 ? r4(row.cogs / row.costed_pounds) : null;
  o.profit = r2(row.costed_revenue - row.cogs);
  o.margin_pct = row.costed_revenue > 0 ? r2((row.costed_revenue - row.cogs) / row.costed_revenue * 100) : null;
  o.status = row.cells > 0 && row.confirmed_cells === row.cells ? 'confirmed' : (row.confirmed_cells > 0 ? 'partly' : 'tentative');
  o.reasons = Object.keys(row.reasons).map(function (r) { return { why: r, sales: row.reasons[r] }; }).sort(function (a, b) { return b.sales - a.sales; });
  o.allowances = Object.keys(row.allowances).map(function (a) { return { what: a, sales: row.allowances[a] }; });
  return o;
}

// opts: { cells, invoiceMeta: { invoice_id: meta }, costsByKey, pickCost, normalizeProductKey }
// → { all, confirmed, tentative } — each { totals, products, invoices }
export function buildConfirmedPnl(opts) {
  var cells = opts.cells || []; var metas = opts.invoiceMeta || {};
  var keyed = cells.map(function (c) {
    var typed = null;
    if ((c.base_cost === null || c.base_cost === undefined) && opts.pickCost && opts.normalizeProductKey && opts.costsByKey) {
      typed = opts.pickCost(opts.costsByKey[opts.normalizeProductKey(c.description)], String(c.invoice_date || '').substring(0, 10));
    }
    return { c: c, k: classifyCell(c, metas[c.invoice_id] || null, typed) };
  });
  function view(filterFn) {
    var tot = newRow('all', 'All'); var prods = {}; var pOrder = []; var invs = {}; var iOrder = [];
    keyed.forEach(function (x) {
      if (!filterFn(x.k)) { return; }
      addTo(tot, x.k);
      var pk = x.c.product_key || ('n:' + String(x.c.description || '')); if (!prods[pk]) { prods[pk] = newRow(pk, x.c.product || String(x.c.description || '').trim()); pOrder.push(pk); } addTo(prods[pk], x.k);
      var ik = x.c.invoice_id; if (!invs[ik]) { invs[ik] = newRow(ik, x.c.invoice, { invoice_date: String(x.c.invoice_date || '').substring(0, 10), customer: x.c.customer || '' }); iOrder.push(ik); } addTo(invs[ik], x.k);
    });
    var t = finish(tot);
    return {
      totals: { revenue: t.revenue, costed_revenue: t.costed_revenue, cogs: t.cogs, gross_profit: t.profit, margin_pct: t.margin_pct, shipping_revenue: t.shipping_charged,
        shipping_cost: t.shipping_cost, uncosted_revenue: t.uncosted_revenue, uncosted_lines: keyed.filter(function (x) { return filterFn(x.k) && x.k.cost === null; }).length,
        lines: t.cells, confirmed_lines: t.confirmed_cells, invoices: iOrder.length },
      products: pOrder.map(function (k) { return finish(prods[k]); }).sort(function (a, b) { return b.revenue - a.revenue; }),
      invoices: iOrder.map(function (k) { return finish(invs[k]); }).sort(function (a, b) { return String(b.invoice_date || '').localeCompare(String(a.invoice_date || '')); })
    };
  }
  return {
    all: view(function () { return true; }),
    confirmed: view(function (k) { return k.confirmed; }),
    tentative: view(function (k) { return !k.confirmed; })
  };
}
