// v55.83-OO — P&L engine (Max, Oct 11): product costs with effective dates →
// profit per invoice and per period.
//
// RULES, exactly as ordered:
// • Costs are entered per product with an EFFECTIVE-FROM date. Changing a cost
//   adds a new dated row; invoices on/after that date use the new cost,
//   invoices before it keep the old one. History is never overwritten.
// • A line whose product has NO cost on its invoice date is reported as
//   UNCOSTED — its revenue is shown but it is never guessed into the margin.
// • Shipping lines (by name, EN+AR) are revenue-only: excluded from COGS and
//   from product P&L, shown separately.
// • Non-USD invoices are excluded from the USD P&L and listed separately.
// • TWO special permissions: pnl.edit_costs to enter/change costs,
//   pnl.view to see the P&L (super admin passes both automatically).
import { NextResponse } from 'next/server';
import { assertPermission } from '../../../../lib/server-permissions';
import { createClient } from '@supabase/supabase-js';
import { normalizeProductKey, pickCost, groupCosts } from '../../../../lib/product-cost';

var API_BUILD_MARKER = 'v55.83-OO-pnl';
var PAGE = 1000; var MAX_ROWS = 20000;

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}
async function fetchAll(buildQ) {
  var out = []; var from = 0;
  while (out.length < MAX_ROWS) {
    var res = await buildQ().range(from, from + PAGE - 1);
    if (res.error) { throw new Error(res.error.message); }
    var rows = res.data || [];
    for (var i = 0; i < rows.length; i++) { out.push(rows[i]); }
    if (rows.length < PAGE) { break; }
    from += PAGE;
  }
  return out;
}
function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
var SHIPPING_RX = /ship|freight|delivery|courier|شحن|توصيل/i;
function isShippingLine(name) { return SHIPPING_RX.test(String(name || '')); }
function isLiveInvoice(i) {
  var st = i.record_status;
  return st !== 'void' && st !== 'cancelled' && st !== 'archived' && st !== 'deleted';
}

export async function POST(req) {
  var db = admin();
  try {
    var body = await req.json();
    var action = body.action;
    var userId = body.user_id;
    if (!userId) { return NextResponse.json({ error: 'user_id required' }, { status: 400 }); }

    // ── set_cost / delete_cost: the cost-entry permission
    if (action === 'set_cost' || action === 'delete_cost') {
      var pe = await assertPermission(db, userId, 'pnl.edit_costs', req);
      if (!pe || pe.ok !== true) { return NextResponse.json({ error: 'This needs the "P&L: Edit Product Costs" permission — grant it in Settings → Permissions.' }, { status: 403 }); }
      if (action === 'delete_cost') {
        if (!body.id) { return NextResponse.json({ error: 'id required.' }, { status: 400 }); }
        var delR = await db.from('product_costs').delete().eq('id', body.id).select('id');
        if (delR.error) { return NextResponse.json({ error: delR.error.message }, { status: 400 }); }
        return NextResponse.json({ ok: true, deleted: ((delR.data || []).length), api_build_marker: API_BUILD_MARKER });
      }
      var rawName = String(body.product || '').trim().replace(/\s+/g, ' ');
      var key = normalizeProductKey(rawName);
      var cost = Number(body.cost_per_unit);
      var eff = String(body.effective_from || '').trim();
      if (!key) { return NextResponse.json({ error: 'Product name required.' }, { status: 400 }); }
      if (!(cost >= 0)) { return NextResponse.json({ error: 'Cost must be zero or more.' }, { status: 400 }); }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(eff)) { return NextResponse.json({ error: 'Effective-from date required (YYYY-MM-DD).' }, { status: 400 }); }
      var up = await db.from('product_costs').upsert({ product_key: key, product_label: rawName, cost_per_unit: r2(cost), effective_from: eff, notes: body.notes || null, created_by: userId }, { onConflict: 'product_key,effective_from' }).select('id');
      if (up.error) { return NextResponse.json({ error: up.error.message }, { status: 400 }); }
      return NextResponse.json({ ok: true, saved: { product: rawName, cost_per_unit: r2(cost), effective_from: eff }, api_build_marker: API_BUILD_MARKER });
    }

    // ── everything below is P&L viewing
    var pv = await assertPermission(db, userId, 'pnl.view', req);
    if (!pv || pv.ok !== true) { return NextResponse.json({ error: 'This needs the "P&L: View" permission — grant it in Settings → Permissions.' }, { status: 403 }); }

    var costRowsAll = await fetchAll(function () { return db.from('product_costs').select('id, product_key, product_label, cost_per_unit, effective_from, notes, created_at').order('effective_from', { ascending: false }); });
    var costsByKey = groupCosts(costRowsAll);

    if (action === 'list_costs') {
      // Every product ever sold (from invoice lines) + its cost history.
      var itemsL = await fetchAll(function () { return db.from('accounting_invoice_items').select('description, wave_product_name'); });
      var seen = {};
      itemsL.forEach(function (it) {
        var nameL = String(it.wave_product_name || it.description || '').trim().replace(/\s+/g, ' ');
        if (!nameL || isShippingLine(nameL)) { return; }
        var kL = normalizeProductKey(nameL);
        if (!seen[kL]) { seen[kL] = nameL; }
      });
      var productsOut = Object.keys(seen).map(function (k) {
        var hist = (costsByKey[k] || []).slice().sort(function (a, b) { return a.effective_from < b.effective_from ? 1 : -1; });
        return { product: seen[k], product_key: k, current_cost: hist.length ? hist[0].cost_per_unit : null, current_since: hist.length ? hist[0].effective_from : null, history: hist };
      }).sort(function (a, b) { return a.product.localeCompare(b.product); });
      // Costs entered for products not (yet) seen on any invoice still show.
      Object.keys(costsByKey).forEach(function (k) {
        if (seen[k]) { return; }
        var hist2 = costsByKey[k].slice().sort(function (a, b) { return a.effective_from < b.effective_from ? 1 : -1; });
        productsOut.push({ product: hist2[0].product_label || k, product_key: k, current_cost: hist2[0].cost_per_unit, current_since: hist2[0].effective_from, history: hist2, not_on_invoices: true });
      });
      return NextResponse.json({ ok: true, products: productsOut, api_build_marker: API_BUILD_MARKER });
    }

    if (action === 'report') {
      var df = body.date_from || null; var dt = body.date_to || null;
      var inv = await fetchAll(function () {
        var q = db.from('accounting_invoices').select('id, invoice_number, accounting_customer_id, invoice_date, total_amount, record_status, currency').order('invoice_date', { ascending: false });
        if (df) { q = q.gte('invoice_date', df); }
        if (dt) { q = q.lte('invoice_date', dt); }
        return q;
      });
      inv = inv.filter(isLiveInvoice);
      var custMap = {};
      try {
        var cs = await fetchAll(function () { return db.from('accounting_customers').select('id, company_name, contact_name'); });
        cs.forEach(function (c) { custMap[c.id] = c.company_name || c.contact_name || ''; });
      } catch (eC) {}
      var invById = {}; var usdIds = {}; var nonUsdAgg = {};
      inv.forEach(function (i) {
        invById[i.id] = i;
        var cur = i.currency || 'USD';
        if (cur === 'USD') { usdIds[i.id] = true; }
        else {
          if (!nonUsdAgg[cur]) { nonUsdAgg[cur] = { currency: cur, revenue: 0, invoices: 0 }; }
          nonUsdAgg[cur].revenue = r2(nonUsdAgg[cur].revenue + (Number(i.total_amount) || 0));
          nonUsdAgg[cur].invoices += 1;
        }
      });
      var items = await fetchAll(function () { return db.from('accounting_invoice_items').select('invoice_id, description, quantity, unit_price, wave_product_name'); });

      var products = {}; var byInvoice = {}; var uncostedProducts = {};
      var revenue = 0, cogs = 0, shippingRevenue = 0, uncostedRevenue = 0, costedLines = 0, uncostedLines = 0;
      items.forEach(function (it) {
        var parent = invById[it.invoice_id];
        if (!parent || usdIds[it.invoice_id] !== true) { return; }
        var qty = Number(it.quantity) || 0;
        var price = Number(it.unit_price) || 0;
        var amount = r2(qty * price);
        if (amount === 0 && qty === 0) { return; }
        var name = String(it.wave_product_name || it.description || '(no description)').trim().replace(/\s+/g, ' ') || '(no description)';
        if (!byInvoice[it.invoice_id]) {
          byInvoice[it.invoice_id] = { invoice: parent.invoice_number, customer: custMap[parent.accounting_customer_id] || '(unknown)', invoice_date: parent.invoice_date, revenue: 0, cogs: 0, profit: 0, shipping: 0, uncosted_revenue: 0 };
        }
        var bi = byInvoice[it.invoice_id];
        if (isShippingLine(name)) { shippingRevenue = r2(shippingRevenue + amount); bi.shipping = r2(bi.shipping + amount); return; }
        var k = normalizeProductKey(name);
        var cRow = pickCost(costsByKey[k], parent.invoice_date);
        revenue = r2(revenue + amount);
        bi.revenue = r2(bi.revenue + amount);
        if (!products[k]) { products[k] = { product: name, qty: 0, revenue: 0, cogs: 0, costed_qty: 0, uncosted_revenue: 0 }; }
        products[k].qty = r2(products[k].qty + qty);
        products[k].revenue = r2(products[k].revenue + amount);
        if (cRow) {
          var lineCogs = r2(qty * (Number(cRow.cost_per_unit) || 0));
          cogs = r2(cogs + lineCogs);
          bi.cogs = r2(bi.cogs + lineCogs);
          products[k].cogs = r2(products[k].cogs + lineCogs);
          products[k].costed_qty = r2(products[k].costed_qty + qty);
          costedLines += 1;
        } else {
          uncostedRevenue = r2(uncostedRevenue + amount);
          bi.uncosted_revenue = r2(bi.uncosted_revenue + amount);
          products[k].uncosted_revenue = r2(products[k].uncosted_revenue + amount);
          if (!uncostedProducts[k]) { uncostedProducts[k] = { product: name, revenue: 0, reason: (costsByKey[k] && costsByKey[k].length) ? 'has costs, but none effective on these invoice dates — add an earlier-dated cost' : 'no cost entered yet' }; }
          uncostedProducts[k].revenue = r2(uncostedProducts[k].revenue + amount);
          uncostedLines += 1;
        }
      });

      var productRows = Object.keys(products).map(function (k) {
        var p = products[k];
        var costedRevShare = p.revenue - p.uncosted_revenue;
        return {
          product: p.product, qty: p.qty, revenue: p.revenue,
          avg_sale_price: p.qty > 0 ? r2(p.revenue / p.qty) : null,
          avg_cost: p.costed_qty > 0 ? r2(p.cogs / p.costed_qty) : null,
          cogs: p.cogs,
          profit: r2(costedRevShare - p.cogs),
          margin_pct: costedRevShare > 0 ? r2(((costedRevShare - p.cogs) / costedRevShare) * 100) : null,
          uncosted_revenue: p.uncosted_revenue
        };
      }).sort(function (a, b) { return b.revenue - a.revenue; });
      var invoiceRows = Object.keys(byInvoice).map(function (k) {
        var b = byInvoice[k];
        var costedRev = r2(b.revenue - b.uncosted_revenue);
        b.profit = r2(costedRev - b.cogs);
        b.margin_pct = costedRev > 0 ? r2((b.profit / costedRev) * 100) : null;
        return b;
      }).sort(function (a, b) { return (a.invoice_date || '') < (b.invoice_date || '') ? 1 : -1; });
      var costedRevenueTotal = r2(revenue - uncostedRevenue);
      var grossProfit = r2(costedRevenueTotal - cogs);
      var nonUsdRows = Object.keys(nonUsdAgg).map(function (k) { return nonUsdAgg[k]; });

      return NextResponse.json({
        ok: true,
        totals: {
          revenue: r2(revenue),
          costed_revenue: costedRevenueTotal,
          cogs: r2(cogs),
          gross_profit: grossProfit,
          margin_pct: costedRevenueTotal > 0 ? r2((grossProfit / costedRevenueTotal) * 100) : null,
          shipping_revenue: r2(shippingRevenue),
          uncosted_revenue: r2(uncostedRevenue),
          costed_lines: costedLines,
          uncosted_lines: uncostedLines,
          invoices: invoiceRows.length
        },
        products: productRows.slice(0, 500),
        invoices: invoiceRows.slice(0, 800),
        uncosted_products: Object.keys(uncostedProducts).map(function (k) { return uncostedProducts[k]; }).sort(function (a, b) { return b.revenue - a.revenue; }),
        non_usd: nonUsdRows,
        source: 'accounting_invoices ' + inv.length + ' live invoices in period · costs effective-dated per invoice date · margin computed on COSTED revenue only · shipping excluded from COGS',
        api_build_marker: API_BUILD_MARKER
      });
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e && e.message) || 'pnl failed' }, { status: 500 });
  }
}
