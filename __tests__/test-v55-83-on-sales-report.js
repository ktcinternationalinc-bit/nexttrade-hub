// v55.83-ON — Sales Report (Max, Oct 11): by product + by customer, period-
// scoped (default June 1, 2026 →), average price per product, shipping
// separated from product sales, non-USD never mixed into USD.
var fs = require('fs');
var path = require('path');
function rd(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }
var rt = rd('src/app/api/accounting/sales-report/route.js');
var ui = rd('src/components/SalesReportTab.jsx');
var at = rd('src/components/AccountingTab.jsx');
var failed = [];
function ok(l, c) { if (c) console.log('✓ ' + l); else { failed.push(l); console.log('✗ ' + l); } }

ok('ON1: route is permission-gated (ar.view_invoice_balances) with the grant named on refusal',
  /assertPermission\(db, userId, 'ar\.view_invoice_balances', req\)/.test(rt) &&
  /"AR: View Invoice Balances" permission/.test(rt));
ok('ON2: only LIVE invoices count (void/cancelled/archived/deleted excluded), period on invoice_date',
  /st !== 'void' && st !== 'cancelled' && st !== 'archived' && st !== 'deleted'/.test(rt) &&
  /gte\('invoice_date', df\)/.test(rt) && /lte\('invoice_date', dt\)/.test(rt));
ok('ON3: shipping is separated by LINE NAME (EN + AR), never by amount guessing',
  /\/ship\|freight\|delivery\|courier\|شحن\|توصيل\/i/.test(rt) && /shippingRevenue/.test(rt) &&
  /shipping_revenue/.test(rt));
ok('ON4: average price = revenue / quantity, null when quantity is zero (no fake averages)',
  /p\.avg_price = p\.qty > 0 \? r2\(p\.revenue \/ p\.qty\) : null/.test(rt));
ok('ON5: product identity = wave_product_name || description (verified columns only)',
  /it\.wave_product_name \|\| it\.description/.test(rt) &&
  /select\('invoice_id, description, quantity, unit_price, wave_product_name'\)/.test(rt));
ok('ON6: non-USD invoices are reported separately, NEVER summed into the USD tables',
  /usdIds\[it\.invoice_id\] !== true\) \{ return; \}/.test(rt) && /non_usd: nonUsdRows/.test(rt) &&
  /never summed into USD/.test(ui));
ok('ON7: customer breakdown carries product revenue, qty, shipping and invoice count; customer×product rows with averages',
  /customer_products: custProdRows/.test(rt) && /shipping: c\.shipping/.test(rt));
ok('ON8: UI default period is June 1, 2026 onward; presets incl. Last month, Last 3 months, This year, 2025, All + custom Apply',
  /useState\('2026-06-01'\)/.test(ui) && /load\('2026-06-01', ''\)/.test(ui) &&
  /'Last month'/.test(ui) && /'Last 3 months'/.test(ui) && /'This year', '2026-01-01'/.test(ui) &&
  /'2025', '2025-01-01', '2025-12-31'/.test(ui) && /'All history'/.test(ui));
ok('ON9: clicking a customer expands their product breakdown with average prices',
  /setOpenCust\(open \? null : c\.customer\)/.test(ui) && /avg \{cp\.avg_price/.test(ui));
ok('ON10: both tables export CSV and the tab lives under Accounting',
  /sales-by-product\.csv/.test(ui) && /sales-by-customer\.csv/.test(ui) &&
  /\['sales_report', '📈 Sales Report'\]/.test(at));

if (failed.length) { console.log('FAILED (' + failed.length + '):'); failed.forEach(function (x) { console.log('  - ' + x); }); process.exit(1); }
else { console.log('ALL CHECKS PASSED — v55.83-ON sales report'); }
