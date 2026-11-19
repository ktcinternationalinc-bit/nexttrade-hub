// v55.83-VA — WHERE DOES A SHIPPING NUMBER COME FROM? (Max, Nov 19 2026)
// Reads the ONE JSON that sql/v55-83-VA-readonly-shipping-questions.sql returns (pasted back by Max), runs the REAL
// Profitability engine on it and prints, per invoice, which source produced each shipping figure. Reads only; writes nothing.
//   node scripts/va-explain-shipping.js <file.json> [text to filter invoices / customers / releases by]
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var A = require(path.join(root, 'src/lib/profitability-assemble.js'));
var B = require(path.join(root, 'src/lib/business-of.js'));

// the same shaping the server loader does (src/lib/profitability-load-server.js), on the pasted rows
function toInput(j) {
  var arr = function (k) { return Array.isArray(j[k]) ? j[k] : []; };
  var custNames = {}; var custTag = {};
  arr('customers').forEach(function (c) { custNames[c.id] = c.company_name || c.contact_name || ''; if (c.business_tag) { custTag[c.id] = c.business_tag; } });
  var all = arr('invoices'); var notUs = all.filter(function (i) { return B.businessOfInvoice(i, custTag) !== 'US'; });
  var src = 'nextrade-staging'; arr('warehouseSettings').forEach(function (s) { if (s.key === 'active_source' && s.value) { src = s.value; } });
  var wh = arr('warehouseRows').filter(function (w) { return w.source === src && w.superseded === false && w.in_latest_feed === true; });
  return { notInReport: notUs, warehouseSource: src, input: {
    invoices: all.filter(function (i) { return B.businessOfInvoice(i, custTag) === 'US'; }), items: arr('items'), customerNames: custNames,
    bills: arr('bills'), billLines: [], windowDays: 90, warehouseRows: wh, warehouseOn: true,
    groups: [], groupNames: [], nameUnits: arr('nameUnits'), lineUnits: arr('lineUnits'), factors: arr('factors'), terms: arr('terms'),
    lineReleasePounds: arr('lineReleasePounds'), estimates: arr('estimates'), nameKinds: arr('nameKinds'), customerTerms: arr('customerTerms'),
    lineCosts: [], groupCosts: [], partEstimates: arr('partEstimates'), freeBillNames: [], date_from: '', date_to: '' } };
}
function explain(j, filter) {
  var t = toInput(j); var r = A.assembleProfitability(t.input); var out = [];
  var seed = {}; (j.seed_invoice_ids || []).forEach(function (id) { seed[id] = true; });
  var f = String(filter || '').toLowerCase();
  var cont = {}; r.containers.forEach(function (c) { cont[c.key] = c; });
  r.by_invoice.forEach(function (row) {
    var iv = row.invoice || {}; var rels = (iv.releases || []).map(function (x) { return x.raw; });
    var hay = (iv.number + ' ' + iv.customer + ' ' + rels.join(' ')).toLowerCase();
    if (f ? hay.indexOf(f) < 0 : !seed[iv.id]) { return; }
    var cells = r.cells.filter(function (c) { return c.invoice_id === iv.id; });
    var o = { invoice: iv.number, date: iv.date, customer: iv.customer, releases: rels, basis: iv.basis, basis_from: iv.basis_source, terms_on_invoice: iv.shipping_terms,
      pounds: row.pounds, invoiced: row.invoiced, goods_revenue: row.goods_revenue, shipping_charged: row.transport_revenue, shipping_charged_from: cells.map(function (c) { return c.transport_source; }).filter(function (x, i, a) { return x && a.indexOf(x) === i; }),
      shipping_inside_price: iv.embedded_used, shipping_inside_price_from: iv.embedded_source, our_shipping_cost: row.outbound_cost, our_cost_unknown: row.unknown_fields.indexOf('outbound_cost') >= 0,
      trucking_share: row.trucking_cost, freight_share: row.freight_cost, cost_from: cells.map(function (c) { return [c.trucking_from ? 'trucking: ' + c.trucking_from : null, c.freight_from ? 'freight: ' + c.freight_from : null].filter(Boolean).join(' · '); }).filter(function (x, i, a) { return x && a.indexOf(x) === i; }),
      containers: (iv.releases || []).map(function (x) { var c = cont[x.key]; return c ? { release: c.raw, pounds_on_release: c.pounds, invoices_sharing: c.invoices, status: c.status, shipping_bill_total: c.shipping_actual, shipping_estimate: c.shipping_estimate,
        trucking: { used: c.parts.trucking.used, status: c.parts.trucking.status, from: c.parts.trucking.estimate_from, bills: c.parts.trucking.bills }, freight: { used: c.parts.freight.used, status: c.parts.freight.status, from: c.parts.freight.estimate_from, bills: c.parts.freight.bills },
        warehouse: c.warehouse } : { release: x.raw, note: 'not in the report' }; }),
      flags: r.flags.filter(function (g) { return g.invoice_id === iv.id || (g.release && rels.indexOf(g.release) >= 0); }).map(function (g) { return g.kind + (g.why ? ' (' + g.why + ')' : ''); }) };
    out.push(o);
  });
  return { rows: out, report: r, notInReport: t.notInReport, warehouseSource: t.warehouseSource };
}
module.exports = { toInput: toInput, explain: explain };
if (require.main === module) {
  var j = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  if (j.copy_this_cell_to_claude) { j = j.copy_this_cell_to_claude; } if (Array.isArray(j)) { j = j[0].copy_this_cell_to_claude || j[0]; }
  var e = explain(j, process.argv[3]);
  console.log(JSON.stringify(e.rows, null, 1));
  if (e.notInReport.length) { console.log('NOT in the KTC report (other books): ' + e.notInReport.map(function (i) { return i.invoice_number; }).join(', ')); }
}
