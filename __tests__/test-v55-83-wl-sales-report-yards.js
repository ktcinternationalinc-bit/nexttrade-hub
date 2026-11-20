// v55.83-WL — Sales Report: goods kept in yards stay in yards (Max, 20 Nov 2026). Runs the REAL route with a fake database and
// renders the REAL cells. Every invoice, customer and figure here is made up.
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var Module = require('module');
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 900))); }
console.log('WL — Sales Report keeps yard goods in yards');
var P = require(path.join(root, 'src/lib/profitability.js'));
var S = require(path.join(root, 'src/lib/sales-units.js'));

// ── the one rule, on its own
var F = { units: Object.assign({}, P.DEFAULT_UNIT_FACTORS) }; var ON = { marked: true, ready: true }; var OFF = { marked: false, ready: true };
function lq(name, qty, unit, keep) { return S.lineQuantity({ wave_product_name: name, description: '' }, qty, unit, keep, F); }
check('a description marked “keep in yards”, sold in yards → yards, no pounds', lq('Mesh fabric', 100, 'yd', ON).kept === true && lq('Mesh fabric', 100, 'yd', ON).yd === 100 && lq('Mesh fabric', 100, 'yd', ON).lb === null);
check('headliner sold in yards is kept in yards by the rule, with no mark at all', lq('Headliner Grey', 100, 'yd', OFF).kept === true && lq('Headliner Grey', 100, 'yd', OFF).yd === 100);
check('linear metres become yards by LENGTH (1 m = 1.09361 yd), not by the pounds table', Math.abs(lq('Mesh fabric', 100, 'lm', ON).yd - 109.361) < 0.0001);
check('PVC in yards with no mark is converted to pounds exactly as before (2.5 lb per yard; foam 3)', lq('PVC roll', 100, 'yd', OFF).kept === false && lq('PVC roll', 100, 'yd', OFF).lb === 250 && lq('Foam laminated PVC', 100, 'yd', OFF).lb === 300);
check('a marked description sold by the POUND or the kilo is still pounds (the mark only matters for yards / metres)', lq('Mesh fabric', 100, 'lb', ON).kept === false && lq('Mesh fabric', 100, 'lb', ON).lb === 100 && lq('Headliner', 10, 'kg', OFF).kept === false);
check('before the database step (no keep-in-yards column) nothing is kept: headliner is 1.25 lb per yard as today', lq('Headliner Grey', 100, 'yd', { marked: false, ready: false }).kept === false && lq('Headliner Grey', 100, 'yd', { marked: false, ready: false }).lb === 125);
check('a line with no unit is neither: pounds unknown, never guessed', lq('PVC roll', 100, '', OFF).lb === null && lq('PVC roll', 100, '', OFF).kept === false);
var ag = S.blankQty(); S.addQuantity(ag, lq('PVC roll', 100, 'yd', OFF), 500); S.addQuantity(ag, lq('Mesh fabric', 200, 'yd', ON), 600); var fin = S.finishQuantity(ag);
check('one row with both: 250 lb at $2.0000 / lb and 200 yd at $3.0000 / yd — the two are never blended', fin.pounds === 250 && fin.yards === 200 && fin.avg_price_per_lb === 2 && fin.avg_price_per_yd === 3, fin);
S.addQuantity(ag, lq('PVC roll', 5, '', OFF), 50); var fin2 = S.finishQuantity(ag);
check('…a pound line without a unit removes the per-pound average only; the per-yard average stays', fin2.avg_price_per_lb === null && fin2.pounds_incomplete === true && fin2.avg_price_per_yd === 3);

// ── the REAL route
function stub(file, exportsObj) { var id = require.resolve(file); var m0 = new Module(id); m0.filename = id; m0.loaded = true; m0.exports = exportsObj; require.cache[id] = m0; }
var world = { keepColumn: true, tables: {} };
function chain(table) { var q = { cols: '' };
  q.select = function (c) { q.cols = String(c || ''); return q; };
  ['order', 'eq', 'gte', 'lte', 'in', 'not', 'or', 'neq', 'is'].forEach(function (k) { q[k] = function () { return q; }; });
  q.range = function (a) {
    if (table === 'pl_name_units' && q.cols.indexOf('keep_unit') >= 0 && !world.keepColumn) { return Promise.resolve({ data: null, error: { message: 'column pl_name_units.keep_unit does not exist' } }); }
    return Promise.resolve({ data: a === 0 ? (world.tables[table] || []) : [], error: null }); };
  return q; }
stub(path.join(root, 'node_modules/next/server.js'), { NextResponse: { json: function (body, init) { return { status: (init && init.status) || 200, body: body }; } } });
stub('@supabase/supabase-js', { createClient: function () { return { from: chain }; } });
stub(path.join(root, 'src/lib/server-permissions.js'), { assertPermission: async function () { return { ok: true, ctx: {} }; } });
stub(path.join(root, 'src/lib/visibility-window-server.js'), { windowFloorFor: async function () { return { floor: null }; }, clampFrom: function (d0) { return d0; } });
stub(path.join(root, 'src/lib/business-of.js'), { businessOfInvoice: function () { return 'US'; } });
var ROUTE = require(path.join(root, 'src/app/api/accounting/sales-report/route.js'));
function post() { return ROUTE.POST({ json: async function () { return { user_id: 'u1', date_from: '2026-06-01' }; }, headers: { get: function () { return 'Bearer x'; } } }); }
function inv(id, cust) { return { id: id, invoice_number: 'T-' + id, accounting_customer_id: cust, invoice_date: '2026-11-01', total_amount: 0, record_status: 'active', currency: 'USD' }; }
function item(id, invId, name, qty, price) { return { id: id, invoice_id: invId, description: '', quantity: qty, unit_price: price, wave_product_name: name }; }
function seed() {
  world.tables = {
    accounting_invoices: [inv('i1', 'c1'), inv('i2', 'c1')],
    accounting_customers: [{ id: 'c1', company_name: 'Test Buyer', contact_name: null, business_tag: null }],
    accounting_invoice_items: [item('l1', 'i1', 'PVC roll', 1000, 1), item('l2', 'i1', 'Mesh fabric', 500, 2), item('l3', 'i2', 'Headliner Grey', 200, 3), item('l4', 'i2', 'Mesh fabric', 100, 2), item('l5', 'i2', 'Net cloth', 100, 4)],
    pl_name_units: [{ name_key: P.nameKey('PVC roll'), unit: 'yd', keep_unit: false }, { name_key: P.nameKey('Mesh fabric'), unit: 'yd', keep_unit: true }, { name_key: P.nameKey('Headliner Grey'), unit: 'yd', keep_unit: false }, { name_key: P.nameKey('Net cloth'), unit: 'lm', keep_unit: true }]
  };
}
function rowOf(list, name) { return (list || []).filter(function (r) { return r.product === name; })[0] || {}; }
(async function () {
  seed(); var r = await post(); var b = r.body; var t = b.totals || {};
  check('ROUTE answers ok', r.status === 200 && b.ok === true, b);
  check('TOTALS: only the PVC is in pounds (1,000 yd × 2.5 = 2,500 lb); mesh 600 + headliner 200 + 100 linear metres of net cloth (109 yd) = 909 yd kept in yards', t.pounds === 2500 && t.yards === 909, t);
  check('TOTALS: money is unchanged — product sales are the sum of every line; the pound goods and the yard goods carry their own revenue and add up to it', t.product_revenue === 3200 && t.pounds_revenue === 1000 && t.yards_revenue === 2200 && t.pounds_revenue + t.yards_revenue === t.product_revenue && t.lines_without_unit === 0, t);
  var pvc = rowOf(b.products, 'PVC roll'); var mesh = rowOf(b.products, 'Mesh fabric'); var head = rowOf(b.products, 'Headliner Grey'); var net = rowOf(b.products, 'Net cloth');
  check('BY PRODUCT: PVC 2,500 lb at $0.4000 / lb, no yards', pvc.pounds === 2500 && pvc.yards === 0 && pvc.avg_price_per_lb === 0.4 && pvc.avg_price_per_yd === null, pvc);
  check('BY PRODUCT: the marked fabric is 600 yd at $2.0000 / yd and adds NOTHING to pounds (it was 1,500 lb before)', mesh.yards === 600 && mesh.pounds === 0 && mesh.avg_price_per_yd === 2 && mesh.avg_price_per_lb === null && mesh.revenue === 1200, mesh);
  check('BY PRODUCT: headliner is 200 yd at $3.0000 / yd by the rule (not 250 lb)', head.yards === 200 && head.pounds === 0 && head.avg_price_per_yd === 3, head);
  check('BY PRODUCT: 100 linear metres kept in yards = 109 yd, price per yard = revenue ÷ yards', net.yards === 109 && Math.abs(net.avg_price_per_yd - 400 / 109.361) < 0.0001, net);
  check('BY PRODUCT: the description under a product says it is kept in yards', mesh.names && mesh.names[0].kept_in_yards === true && mesh.names[0].yards === 600 && pvc.names[0].kept_in_yards === false);
  check('no temporary working field leaks into the answer', JSON.stringify(b).indexOf('"q":') < 0 && JSON.stringify(b).indexOf('rev_lb') < 0);
  var cp = (b.customer_products || b.by_customer_product || []); var cust = (b.customers || [])[0] || {};
  var list = cust.invoice_list || []; var i1 = list.filter(function (x) { return x.id === 'i1'; })[0] || {}; var i2 = list.filter(function (x) { return x.id === 'i2'; })[0] || {};
  check('BY CUSTOMER: each invoice shows its own pounds and yards (invoice 1: 2,500 lb + 500 yd; invoice 2: 0 lb + 409 yd)', i1.pounds === 2500 && i1.yards === 500 && i2.pounds === 0 && i2.yards === 409, list);
  var key = Object.keys(b).filter(function (k) { return Array.isArray(b[k]) && b[k].length && b[k][0].customer && b[k][0].product; })[0]; var cps = b[key] || [];
  var cMesh = cps.filter(function (x) { return x.product === 'Mesh fabric'; })[0] || {};
  check('BY CUSTOMER × PRODUCT: the same split (mesh 600 yd, $2.0000 / yd, 0 lb)', cMesh.yards === 600 && cMesh.pounds === 0 && cMesh.avg_price_per_yd === 2, cps);
  // before the database step
  world.keepColumn = false; var rb = await post(); var tb = rb.body.totals;
  check('BEFORE the keep-in-yards database step the report still opens and is exactly the old one: everything in pounds, 0 yards (1,000×2.5 + 600×2.5 + 200×1.25 + 100×2.5)', rb.status === 200 && tb.yards === 0 && tb.pounds === 2500 + 1500 + 250 + 250 && tb.pounds_revenue === 3200, tb);
  world.keepColumn = true;
  // a marked description with the switch OFF everywhere
  world.tables.pl_name_units.forEach(function (u) { u.keep_unit = false; }); var rn = await post();
  check('with no description marked, only headliner stays in yards; the rest is pounds as before', rn.body.totals.yards === 200 && rn.body.totals.pounds === 2500 + 1500 + 250, rn.body.totals);

  // ── the screen: the REAL cells and words
  var React = require('react'); global.React = React; var RS = require('react-dom/server'); var C = require(path.join(root, 'src/components/SalesUnitCells.jsx'));
  function qh(row) { return RS.renderToStaticMarkup(React.createElement(C.SalesQtyCell, { row: row })); }
  function ah(row) { return RS.renderToStaticMarkup(React.createElement(C.SalesAvgCell, { row: row })); }
  check('SCREEN: a pounds-only row looks exactly as before (a plain number, a plain $ figure)', qh(pvc) === '<span><span>2,500</span></span>' && ah(pvc) === '<span><span>$0.4000</span></span>', qh(pvc) + ah(pvc));
  check('SCREEN: a yards-only row shows “600 yd” and “$2.0000 / yd” — no 0 lb, no dash for pounds', qh(mesh).indexOf('600 yd') > 0 && qh(mesh).indexOf('lb') < 0 && ah(mesh).indexOf('$2.0000 / yd') > 0 && ah(mesh).indexOf('—') < 0, qh(mesh) + ah(mesh));
  var both = { pounds: 250, yards: 200, avg_price_per_lb: 2, avg_price_per_yd: 3 };
  check('SCREEN: a row with both shows the two, each with its unit', qh(both).indexOf('250 lb') > 0 && qh(both).indexOf('200 yd') > 0 && ah(both).indexOf('$2.0000 / lb') > 0 && ah(both).indexOf('$3.0000 / yd') > 0);
  check('SCREEN: a pound line without a unit → the note and a dash per pound, the per-yard figure stays', qh(Object.assign({}, both, { pounds_incomplete: true })).indexOf('unit not set on some lines') > 0 && ah(Object.assign({}, both, { avg_price_per_lb: null })).indexOf('— / lb') > 0);
  var tx = S.totalsText(t);
  check('SCREEN top tile: “2,500 lb”, avg per lb from the POUND goods only ($0.4000, not all sales ÷ pounds = $1.28), and a yards line with its own average', tx.big === '2,500 lb' && tx.small === 'avg $0.4000 / lb' && tx.yards === '909 yd kept in yards · avg $2.4193 / yd', tx);
  // ── WM (Codex 22:26): the top box and the rows reconcile — averages from UNROUNDED quantities
  check('WM: the report totals carry their own averages: per pound = pound revenue ÷ unrounded pounds, per yard = yard revenue ÷ unrounded yards (2,200 ÷ 909.361)', t.avg_price_per_lb === 0.4 && t.avg_price_per_yd === Math.round(2200 / 909.361 * 10000) / 10000, t);
  world.tables.accounting_invoice_items = [item('n1', 'i1', 'Net cloth', 100, 4)]; world.tables.pl_name_units = [{ name_key: P.nameKey('Net cloth'), unit: 'lm', keep_unit: true }]; var r1 = await post(); var t1 = r1.body.totals; var n1 = rowOf(r1.body.products, 'Net cloth');
  check('WM: Codex’s case — 100 linear metres for $400 alone: the row says $3.6576 / yd and the top box says the SAME (it said $3.6697 from 109 rounded yards)', n1.avg_price_per_yd === 3.6576 && t1.avg_price_per_yd === 3.6576 && S.totalsText(t1).yards === '109 yd kept in yards · avg $3.6576 / yd' && t1.yards === 109, [n1, t1]);
  world.tables.accounting_invoice_items = [item('p1', 'i1', 'PVC roll', 3, 1), item('p2', 'i1', 'Odd thing', 5, 1)]; world.tables.pl_name_units = [{ name_key: P.nameKey('PVC roll'), unit: 'kg', keep_unit: false }]; var r2x = await post(); var t2 = r2x.body.totals; var p2 = rowOf(r2x.body.products, 'PVC roll');
  check('WM: pounds too — 3 kg for $3: row and top box both use 6.61386 lb (not 7 rounded); and a line with no unit still means NO per-pound average on the top box', p2.avg_price_per_lb === Math.round(3 / 6.61386 * 10000) / 10000 && t2.lines_without_unit === 1 && t2.avg_price_per_lb === null && S.totalsText(t2).small.indexOf('no unit set') > 0, [p2, t2]);
  world.tables.accounting_invoice_items = [item('p1', 'i1', 'PVC roll', 3, 1)]; var r3 = await post(); var t3 = r3.body.totals;
  check('WM: …with every unit set the top box equals the row to 4 decimals', t3.avg_price_per_lb === rowOf(r3.body.products, 'PVC roll').avg_price_per_lb && S.totalsText(t3).small === 'avg $' + t3.avg_price_per_lb.toFixed(4) + ' / lb', t3);
  check('WM: an answer from an older server (no averages sent) still shows the old words; no quantity → no average', S.totalsText({ pounds: 2500, product_revenue: 1000 }).small === 'avg $0.4000 / lb' && S.totalAverage(5, 0, false) === null && S.totalAverage(5, 2, true) === null && S.totalAverage(5, 2, false) === 2.5);
  seed(); t = (await post()).body.totals;
  check('SCREEN top tile: no yard goods → no yards line, the same words as before', S.totalsText({ pounds: 2500, product_revenue: 1000, yards: 0 }).yards === '' && S.totalsText({ pounds: 2500, product_revenue: 1000 }).small === 'avg $0.4000 / lb');
  check('SCREEN customer rows: one line of words per product', S.qtyAvgText(pvc) === '2,500 lb · avg $0.4000 / lb' && S.qtyAvgText(mesh) === '600 yd · avg $2.0000 / yd' && S.qtyAvgText(both) === '250 lb · avg $2.0000 / lb · 200 yd · avg $3.0000 / yd');
  var ui = fs.readFileSync(path.join(root, 'src/components/SalesReportTab.jsx'), 'utf8');
  check('the screen uses these cells and words (imports present) and the CSV carries yards and the per-yard price', /import \{ SalesQtyCell, SalesAvgCell \} from '\.\/SalesUnitCells'/.test(ui) && /import \{ qtyAvgText, totalsText \} from '\.\.\/lib\/sales-units'/.test(ui) && ui.indexOf('<SalesQtyCell row={p} />') > 0 && ui.indexOf('<SalesAvgCell row={n2} />') > 0 && ui.indexOf('{qtyAvgText(cp)}') > 0 && ui.indexOf("'yards', 'revenue', 'avg_price_per_lb', 'avg_price_per_yd'") > 0);
  var rt = fs.readFileSync(path.join(root, 'src/app/api/accounting/sales-report/route.js'), 'utf8'); var su = fs.readFileSync(path.join(root, 'src/lib/sales-units.js'), 'utf8');
  check('server style: no backticks, no arrow functions, no let / const in the route or the shared rule', rt.indexOf(String.fromCharCode(96)) < 0 && su.indexOf(String.fromCharCode(96)) < 0 && !/=>/.test(su) && !/\b(let|const)\s/.test(su) && /import \{ lineQuantity, blankQty, addQuantity, finishQuantity, totalAverage } from '\.\.\/\.\.\/\.\.\/\.\.\/lib\/sales-units'/.test(rt));
  console.log('\nWL: ' + pass + ' passed, ' + failN + ' failed');
  if (failN) { process.exit(1); }
})().catch(function (err) { console.log('  ✗ FAIL: route run threw ' + ((err && err.stack) || err)); process.exit(1); });
