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
import { NextResponse } from 'next/server';
import { assertPermission } from '../../../../lib/server-permissions';
import { createClient } from '@supabase/supabase-js';

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
    var userId = body.user_id;
    if (!userId) { return NextResponse.json({ error: 'user_id required' }, { status: 400 }); }
    var perm = await assertPermission(db, userId, 'ar.view_invoice_balances', req);
    if (!perm || perm.ok !== true) {
      return NextResponse.json({ error: 'This needs the "AR: View Invoice Balances" permission — grant it in Settings → Permissions.' }, { status: 403 });
    }
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

    var items = await fetchAll(function () {
      return db.from('accounting_invoice_items').select('invoice_id, description, quantity, unit_price, wave_product_name');
    });

    var products = {}; var customers = {}; var custProd = {};
    var shippingRevenue = 0; var shippingLines = 0; var productRevenue = 0; var itemCount = 0;
    var usdInvoiceSet = {};
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

      if (isShippingLine(name)) {
        shippingRevenue = r2(shippingRevenue + amount);
        shippingLines += 1;
        if (!customers[cid]) { customers[cid] = { customer: cname, revenue: 0, qty: 0, shipping: 0, invSet: {} }; }
        customers[cid].shipping = r2(customers[cid].shipping + amount);
        customers[cid].invSet[it.invoice_id] = true;
        return;
      }

      productRevenue = r2(productRevenue + amount);
      if (!products[name]) { products[name] = { product: name, qty: 0, revenue: 0, invSet: {} }; }
      products[name].qty = r2(products[name].qty + qty);
      products[name].revenue = r2(products[name].revenue + amount);
      products[name].invSet[it.invoice_id] = true;

      if (!customers[cid]) { customers[cid] = { customer: cname, revenue: 0, qty: 0, shipping: 0, invSet: {} }; }
      customers[cid].revenue = r2(customers[cid].revenue + amount);
      customers[cid].qty = r2(customers[cid].qty + qty);
      customers[cid].invSet[it.invoice_id] = true;

      var ck = cid + '||' + name;
      if (!custProd[ck]) { custProd[ck] = { customer: cname, product: name, qty: 0, revenue: 0 }; }
      custProd[ck].qty = r2(custProd[ck].qty + qty);
      custProd[ck].revenue = r2(custProd[ck].revenue + amount);
    });

    function withAvg(rows) {
      return rows.map(function (p) {
        p.avg_price = p.qty > 0 ? r2(p.revenue / p.qty) : null;
        return p;
      });
    }
    var productRows = withAvg(Object.keys(products).map(function (k) {
      var p = products[k];
      return { product: p.product, qty: p.qty, revenue: p.revenue, invoices: Object.keys(p.invSet).length };
    })).sort(function (a, b) { return b.revenue - a.revenue; });
    var customerRows = Object.keys(customers).map(function (k) {
      var c = customers[k];
      return { customer: c.customer, revenue: c.revenue, qty: c.qty, shipping: c.shipping, invoices: Object.keys(c.invSet).length };
    }).sort(function (a, b) { return b.revenue - a.revenue; });
    var custProdRows = withAvg(Object.keys(custProd).map(function (k) { return custProd[k]; }))
      .sort(function (a, b) { return b.revenue - a.revenue; }).slice(0, 2000);
    var nonUsdRows = Object.keys(nonUsdAgg).map(function (k) { return nonUsdAgg[k]; }).sort(function (a, b) { return b.revenue - a.revenue; });

    return NextResponse.json({
      ok: true,
      totals: {
        product_revenue: r2(productRevenue),
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
