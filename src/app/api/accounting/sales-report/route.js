// v55.83-ON — SALES REPORT (Max, Oct 11): sales broken down by product and by
// customer for a period (default June 1, 2026 onward), with quantity, revenue,
// AVERAGE PRICE per product, and SHIPPING separated out of product sales.
//
// Source of truth: accounting_invoices (live only — record_status not
// void/cancelled/archived/deleted) + accounting_invoice_items. Every column
// read here is proven by working Hub code (AccountingDashboard reads
// record_status/currency; the invoice form writes the item fields) — the
// schema-truth gate pins this file.
//
// Money honesty: non-USD invoices are NEVER summed into the USD tables; they
// are reported separately per currency, same rule as the dashboard.
//
// Permission: ar.view_invoice_balances via the proven assertPermission ladder
// (super admin passes everything automatically).
import { verifiedCaller } from '../../../../lib/verified-caller'; // v55.83-WQ — the route acts only for the verified signed-in person
import { NextResponse } from 'next/server';
import { windowFloorFor, clampFrom } from '../../../../lib/visibility-window-server'; // v55.83-UD: employees see only their history window
import { assertPermission } from '../../../../lib/server-permissions';
import { createClient } from '@supabase/supabase-js';
import { businessOfInvoice } from '../../../../lib/business-of';
import { nameKey, toPounds, unitKey, isTransportLine, DEFAULT_UNIT_FACTORS, isFoamLine, foamFactors, weightFactorsFor } from '../../../../lib/profitability'; // v55.83-TE — merged names + pounds, the same rules as Profitability
import { lineQuantity, blankQty, addQuantity, finishQuantity, totalAverage } from '../../../../lib/sales-units'; // v55.83-WL — yard goods stay in yards, as in Profitability

var API_BUILD_MARKER = 'v55.83-ON-sales-report';
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
// Shipping lines are separated by NAME (English + Arabic), never guessed by amount.
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
    var whoWQ = await verifiedCaller(req, body, createClient); // v55.83-WQ (Codex 21 Nov, F3): never a user_id from the request
    if (whoWQ.error) { return NextResponse.json({ error: whoWQ.error }, { status: whoWQ.status || 401 }); }
    var userId = whoWQ.userId;
    if (!userId) { return NextResponse.json({ error: 'user_id required' }, { status: 400 }); }
    var perm = await assertPermission(db, userId, 'ar.view_invoice_balances', req);
    if (!perm || perm.ok !== true) {
      return NextResponse.json({ error: 'This needs the "AR: View Invoice Balances" permission — grant it in Settings → Module Access.' }, { status: 403 });
    }
    // v55.83-UD (Codex 12:00 P1) — employees see ONLY the permitted history window; super admin sees all-time. Fails closed.
    var vwin = await windowFloorFor(db, perm.ctx); if (vwin.error) { return NextResponse.json({ error: vwin.error }, { status: 503 }); }
    body.date_from = clampFrom(body.date_from, vwin.floor);
    var df = body.date_from || null; var dt = body.date_to || null;

    var inv = await fetchAll(function () {
      var q = db.from('accounting_invoices').select('id, invoice_number, accounting_customer_id, invoice_date, total_amount, record_status, currency, source, wave_invoice_id, wave_business_id').order('invoice_date', { ascending: false });
      if (df) { q = q.gte('invoice_date', df); }
      if (dt) { q = q.lte('invoice_date', dt); }
      return q;
    });
    inv = inv.filter(isLiveInvoice);

    var custMap = {}; var custTag = {};
    try {
      var cs = await fetchAll(function () { return db.from('accounting_customers').select('id, company_name, contact_name, business_tag'); });
      cs.forEach(function (c) { custMap[c.id] = c.company_name || c.contact_name || ''; if (c.business_tag) { custTag[c.id] = c.business_tag; } });
    } catch (eC) {}
    // v55.83-OV — the Sales Report is per BUSINESS (US default): the same
    // shared rule as the dashboard, so an Egyptian customer's USD invoice can
    // never leak into US sales numbers.
    var bizSel = body.business === 'EG' ? 'EG' : 'US';
    inv = inv.filter(function (i) { return businessOfInvoice(i, custTag) === bizSel; });

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

    var items = await fetchAll(function () {
      return db.from('accounting_invoice_items').select('id, invoice_id, description, quantity, unit_price, wave_product_name');
    });
    // v55.83-TE (Max, Nov 16: "the sales report should use the merged names and the top values should specify qty / LBS") —
    // the product groups, units and shipping marks set on the Profitability report. Missing tables = report by raw name, no pounds.
    async function opt(t, cols) { try { return await fetchAll(function () { return db.from(t).select(cols); }); } catch (eO) { return []; } }
    var gRows = await opt('pl_product_groups', 'id, display_name, active, created_at');
    var gnRows = await opt('pl_group_names', 'group_id, source, name_key, active');
    // v55.83-WL — the "keep in yards" switch of each description (the report still runs before that column exists)
    var nuRows = await opt('pl_name_units', 'name_key, unit, keep_unit'); var keepReady = nuRows.length > 0;
    if (!nuRows.length) { nuRows = await opt('pl_name_units', 'name_key, unit'); }
    var luRows = await opt('pl_line_units', 'invoice_item_id, unit');
    var ufRows = await opt('pl_unit_factors', 'unit, pounds_per_unit');
    var nkRows = await opt('pl_name_kinds', 'name_key, kind');
    var gName = {}; var canonOf = {}; var canonByName = {};
    gRows.filter(function (g) { return g.active !== false; }).sort(function (a, b) { return String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.id).localeCompare(String(b.id)); }).forEach(function (g) {
      var k = nameKey(g.display_name) || ('id:' + g.id); if (!canonByName[k]) { canonByName[k] = g.id; gName[g.id] = g.display_name; } canonOf[g.id] = canonByName[k]; });
    var groupOfName = {}; gnRows.forEach(function (n) { if (n.active !== false && n.source === 'invoice' && canonOf[n.group_id]) { groupOfName[n.name_key] = canonOf[n.group_id]; } });
    var unitOfName = {}; var keepOfName = {}; nuRows.forEach(function (u) { unitOfName[u.name_key] = u.unit; if (u.keep_unit === true) { keepOfName[u.name_key] = true; } });
    var unitOfLine = {}; luRows.forEach(function (u) { unitOfLine[u.invoice_item_id] = u.unit; });
    var factors = { units: Object.assign({}, DEFAULT_UNIT_FACTORS) }; ufRows.forEach(function (f) { var u = unitKey(f.unit); if (u && Number(f.pounds_per_unit) > 0) { factors.units[u] = Number(f.pounds_per_unit); } });
    var kindOf = {}; nkRows.forEach(function (k) { kindOf[k.name_key] = k.kind; });

    var products = {}; var customers = {}; var custProd = {};
    var shippingRevenue = 0; var shippingLines = 0; var productRevenue = 0; var itemCount = 0; var poundsTotal = 0; var yardsTotal = 0; var revLbTotal = 0; var revYdTotal = 0; var noUnitLines = 0;
    var usdInvoiceSet = {};
    var invAgg = {}; // v55.83-UD (Max, Nov 18: "click on an invoice by the customer — each shipment — to see it")
    function ia(id) { return invAgg[id] || (invAgg[id] = { product: 0, shipping: 0, pounds: 0, yards: 0 }); }
    items.forEach(function (it) {
      var parent = invById[it.invoice_id];
      if (!parent || usdIds[it.invoice_id] !== true) { return; } // USD tables only; non-USD reported separately
      var qty = Number(it.quantity) || 0;
      var price = Number(it.unit_price) || 0;
      var amount = r2(qty * price);
      if (amount === 0 && qty === 0) { return; }
      var name = String(it.wave_product_name || it.description || '(no description)').trim() || '(no description)';
      var cid = parent.accounting_customer_id || '(none)';
      var cname = custMap[cid] || '(unknown customer)';
      usdInvoiceSet[it.invoice_id] = true;
      itemCount += 1;

      var nk = nameKey(name);
      var shipping = kindOf[nk] === 'transport' || (kindOf[nk] !== 'goods' && (isShippingLine(name) || isTransportLine(name))); // TE: + overweight / surcharges and the hand marks
      if (shipping) {
        shippingRevenue = r2(shippingRevenue + amount);
        shippingLines += 1;
        if (!customers[cid]) { customers[cid] = { customer: cname, revenue: 0, qty: 0, shipping: 0, invSet: {} }; }
        customers[cid].shipping = r2(customers[cid].shipping + amount);
        customers[cid].invSet[it.invoice_id] = true;
        ia(it.invoice_id).shipping = r2(ia(it.invoice_id).shipping + amount);
        return;
      }

      productRevenue = r2(productRevenue + amount);
      // TE — the MERGED name when the description is in a product group; pounds from the unit set on the description (or the line)
      var gid = groupOfName[nk]; var pkey = gid ? 'g:' + gid : 'n:' + nk; var plabel = gid ? gName[gid] : name;
      // v55.83-UZ (Max, Nov 19: anything with foam weighs 3 lb per yard) — the same rule as Profitability
      // the line's product name + description decide the weight table, never the merged group's name (Codex 07:36): headliner 1.25 lb / yd, foam 3, else standard
      // v55.83-WL — one rule for the quantity (src/lib/sales-units.js): kept in yards → yards, never pounds; otherwise pounds as before
      var unit = unitOfLine[it.id] || unitOfName[nk] || ''; var q = lineQuantity(it, qty, unit, { marked: keepOfName[nk] === true, ready: keepReady }, factors); var lb = q.lb;
      if (q.kept) { yardsTotal += q.yd; revYdTotal = r2(revYdTotal + amount); } else if (lb === null) { noUnitLines += 1; } else { poundsTotal += lb; revLbTotal = r2(revLbTotal + amount); }
      if (!products[pkey]) { products[pkey] = { product: plabel, grouped: !!gid, qty: 0, revenue: 0, q: blankQty(), invSet: {}, names: {} }; }
      products[pkey].qty = r2(products[pkey].qty + qty);
      products[pkey].revenue = r2(products[pkey].revenue + amount);
      products[pkey].invSet[it.invoice_id] = true;
      addQuantity(products[pkey].q, q, amount);
      var nm0 = products[pkey].names[nk] || (products[pkey].names[nk] = { product: name, unit: unit || null, kept_in_yards: q.kept, qty: 0, revenue: 0, q: blankQty(), invSet: {} });
      nm0.qty = r2(nm0.qty + qty); nm0.revenue = r2(nm0.revenue + amount); nm0.invSet[it.invoice_id] = true; addQuantity(nm0.q, q, amount);

      if (!customers[cid]) { customers[cid] = { customer: cname, revenue: 0, qty: 0, shipping: 0, invSet: {} }; }
      customers[cid].revenue = r2(customers[cid].revenue + amount);
      customers[cid].qty = r2(customers[cid].qty + qty);
      customers[cid].invSet[it.invoice_id] = true;
      ia(it.invoice_id).product = r2(ia(it.invoice_id).product + amount); if (q.kept) { ia(it.invoice_id).yards += q.yd; } else if (lb !== null) { ia(it.invoice_id).pounds += lb; }

      var ck = cid + '||' + pkey;
      if (!custProd[ck]) { custProd[ck] = { customer: cname, product: plabel, qty: 0, revenue: 0, q: blankQty() }; }
      custProd[ck].qty = r2(custProd[ck].qty + qty);
      custProd[ck].revenue = r2(custProd[ck].revenue + amount);
      addQuantity(custProd[ck].q, q, amount);
    });

    function withAvg(rows) {
      return rows.map(function (p) {
        p.avg_price = p.qty > 0 ? r2(p.revenue / p.qty) : null;
        // TE — average $ per POUND: only when every line behind it has a unit (pounds are never guessed)
        // WL — pounds and yards apart, each with its own average; never one blended figure
        if (p.q) { var fq = finishQuantity(p.q); p.pounds = fq.pounds; p.yards = fq.yards; p.avg_price_per_lb = fq.avg_price_per_lb; p.avg_price_per_yd = fq.avg_price_per_yd; p.pounds_incomplete = fq.pounds_incomplete; delete p.q; }
        return p;
      });
    }
    var productRows = withAvg(Object.keys(products).map(function (k) {
      var p = products[k];
      var subs = withAvg(Object.keys(p.names).map(function (k2) { var n2 = p.names[k2]; return { product: n2.product, unit: n2.unit, kept_in_yards: n2.kept_in_yards === true, qty: n2.qty, revenue: n2.revenue, q: n2.q, invoices: Object.keys(n2.invSet).length }; })).sort(function (a, b) { return b.revenue - a.revenue; });
      return { product: p.product, grouped: p.grouped, qty: p.qty, revenue: p.revenue, q: p.q, invoices: Object.keys(p.invSet).length, names: subs };
    })).sort(function (a, b) { return b.revenue - a.revenue; });
    var customerRows = Object.keys(customers).map(function (k) {
      var c = customers[k];
      // each invoice (shipment) of this customer, newest first — the screen opens it on a click
      var list = Object.keys(c.invSet).map(function (iid) { var iv = invById[iid] || {}; var ag = invAgg[iid] || { product: 0, shipping: 0, pounds: 0, yards: 0 }; return { id: iid, invoice_number: iv.invoice_number || null, invoice_date: iv.invoice_date || null, product: ag.product, shipping: ag.shipping, pounds: Math.round(ag.pounds), yards: Math.round(ag.yards || 0), total: Number(iv.total_amount) || 0 }; })
        .sort(function (a, b) { return String(b.invoice_date || '').localeCompare(String(a.invoice_date || '')); });
      return { customer: c.customer, revenue: c.revenue, qty: c.qty, shipping: c.shipping, invoices: Object.keys(c.invSet).length, invoice_list: list.slice(0, 200) };
    }).sort(function (a, b) { return b.revenue - a.revenue; });
    var custProdRows = withAvg(Object.keys(custProd).map(function (k) { return custProd[k]; }))
      .sort(function (a, b) { return b.revenue - a.revenue; }).slice(0, 2000);
    var nonUsdRows = Object.keys(nonUsdAgg).map(function (k) { return nonUsdAgg[k]; }).sort(function (a, b) { return b.revenue - a.revenue; });

    return NextResponse.json({
      ok: true,
      totals: {
        product_revenue: r2(productRevenue), pounds: Math.round(poundsTotal), yards: Math.round(yardsTotal), pounds_revenue: r2(revLbTotal), yards_revenue: r2(revYdTotal), lines_without_unit: noUnitLines,
        // v55.83-WM (Codex 22:26) — the totals' averages come from the UNROUNDED quantities, like every row; only the shown quantity is rounded
        avg_price_per_lb: totalAverage(revLbTotal, poundsTotal, noUnitLines > 0), avg_price_per_yd: totalAverage(revYdTotal, yardsTotal, false),
        shipping_revenue: r2(shippingRevenue),
        grand_total: r2(productRevenue + shippingRevenue),
        invoices: Object.keys(usdInvoiceSet).length,
        line_items: itemCount,
        shipping_lines: shippingLines
      },
      products: productRows.slice(0, 500),
      customers: customerRows.slice(0, 500),
      customer_products: custProdRows,
      non_usd: nonUsdRows,
      source: 'accounting_invoices ' + inv.length + ' live invoices in period · ' + itemCount + ' USD line items · averages = revenue / quantity · shipping split by line name',
      api_build_marker: API_BUILD_MARKER
    });
  } catch (e) {
    return NextResponse.json({ error: (e && e.message) || 'sales report failed' }, { status: 500 });
  }
}
