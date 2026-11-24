// ═══════════════════════════════════════════════════════════════════════════
// v55.83-UD — the P&L on the PROFITABILITY cost engine, CONFIRMED vs TENTATIVE (Max, Nov 18 2026: "why isn't the P&L typed
// costs working — the avg costs are all blank ... use the avg price after shipping removed for CNF as in the other P&L report
// ... whatever is 100% confirmed should say confirmed, the other is tentative (missing data)").
// RUNS the real engine (lib/profitability-assemble.js) and the real split (lib/pnl-confirmed.js) on real-shaped rows. No database.
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var A = require(path.join(root, 'src/lib/profitability-assemble.js'));
var C = require(path.join(root, 'src/lib/pnl-confirmed.js'));
var PC = require(path.join(root, 'src/lib/product-cost.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra))); }
console.log('UD — P&L on the Profitability engine, confirmed vs tentative');

// ── a real-shaped month: an EXW sale fully documented, a CNF sale whose shipping is inside the price, a sale with no cost source
var asm = A.assembleProfitability({ date_from: '2026-06-01', date_to: '2026-12-31',
  invoices: [
    { id: 'i1', invoice_number: 'INV-1', accounting_customer_id: 'c1', invoice_date: '2026-07-01', record_status: 'active', currency: 'USD', release_number: '1002-10' },
    { id: 'i2', invoice_number: 'INV-2', accounting_customer_id: 'c2', invoice_date: '2026-07-02', record_status: 'active', currency: 'USD', release_number: '1002-20' },
    { id: 'i3', invoice_number: 'INV-3', accounting_customer_id: 'c1', invoice_date: '2026-07-03', record_status: 'active', currency: 'USD', release_number: '1002-30' }],
  items: [{ id: 'a', invoice_id: 'i1', description: 'Stock PVC Rolls', quantity: 10000, unit_price: 0.5 },
    { id: 'b', invoice_id: 'i2', description: 'Stock PVC Rolls', quantity: 10000, unit_price: 0.6 },
    { id: 'c', invoice_id: 'i3', description: 'Mystery Vinyl', quantity: 1000, unit_price: 2 }],
  customerNames: { c1: 'Alpha', c2: 'Beta' },
  groups: [{ id: 'g1', display_name: 'PVC Rolls', active: true }],
  groupNames: [{ group_id: 'g1', source: 'invoice', name_key: 'stock pvc rolls', raw_name: 'Stock PVC Rolls', active: true }, { group_id: 'g1', source: 'bill', name_key: 'rolls a grade', raw_name: 'Rolls A-Grade', active: true }],
  nameUnits: [{ name_key: 'stock pvc rolls', unit: 'lb' }, { name_key: 'mystery vinyl', unit: 'lb' }], lineUnits: [], factors: [],
  terms: [{ invoice_id: 'i1', basis: 'EXW' }, { invoice_id: 'i2', basis: 'CNF', embedded_transport: 1000 }, { invoice_id: 'i3', basis: 'EXW' }],
  lineReleasePounds: [], estimates: [],
  bills: [{ id: 'b1', vendor_name: 'NexPac Corporation', bill_number: 'NX1', bill_date: '2026-06-01', total_amount: 28125, record_status: 'active', bill_type: 'supplier', release_number: '' },
    { id: 'b2', vendor_name: 'Fast Freight', bill_number: 'T1', bill_date: '2026-07-03', total_amount: 400, record_status: 'active', bill_type: 'trucking', shipment_direction: 'outbound', release_number: '1002-10' },
    { id: 'b3', vendor_name: 'Fast Freight', bill_number: 'T2', bill_date: '2026-07-03', total_amount: 900, record_status: 'active', bill_type: 'trucking', shipment_direction: 'outbound', release_number: '1002-20' },
    { id: 'b4', vendor_name: 'Fast Freight', bill_number: 'T3', bill_date: '2026-07-03', total_amount: 100, record_status: 'active', bill_type: 'trucking', shipment_direction: 'outbound', release_number: '1002-30' }],
  billLines: [{ bill_id: 'b1', line_kind: 'item', description: 'Rolls A-Grade', qty: 100000, unit: 'lb', cost_amount: 25000, commission_amount: 3125 }] });
var metas = {}; asm.by_invoice.forEach(function (r) { if (r.invoice) { metas[r.key] = r.invoice; } });
var v = C.buildConfirmedPnl({ cells: asm.cells, invoiceMeta: metas, costsByKey: {}, pickCost: PC.pickCost, normalizeProductKey: PC.normalizeProductKey });
function inv(view, no) { return view.invoices.filter(function (r) { return r.label === no; })[0]; }
var i1 = inv(v.all, 'INV-1'), i2 = inv(v.all, 'INV-2'), i3 = inv(v.all, 'INV-3');
check('costs come from the purchase bill (not typed): INV-1 has COGS and an average cost', i1 && i1.cogs > 0 && i1.avg_cost_per_lb > 0, i1);
check('CNF: the $1,000 shipping inside INV-2’s price is taken OUT of revenue (6,000 invoiced → 5,000 goods)', i2 && i2.revenue === 5000 && i2.shipping_charged === 1000, i2);
check('… so its average price is the goods-only price (0.50 / lb, not 0.60)', i2 && i2.avg_price_per_lb === 0.5, i2 && i2.avg_price_per_lb);
check('EXW with bill cost, actual shipping bill, weights, basis → CONFIRMED', i1.status === 'confirmed' && i1.reasons.length === 0, i1.reasons);
check('a sale with no cost source → TENTATIVE, out of the margin, reason "no cost: …"', i3.status === 'tentative' && i3.uncosted_revenue === 2000 && i3.reasons.some(function (r) { return /^no cost/.test(r.why); }), i3.reasons);
check('a typed CNF shipping amount is a real figure; INV-2 is confirmed when nothing else is missing', i2.status === 'confirmed', i2.reasons);
check('views add up: confirmed + tentative = all (revenue, COGS, lines)', Math.round((v.confirmed.totals.revenue + v.tentative.totals.revenue) * 100) === Math.round(v.all.totals.revenue * 100) && Math.round((v.confirmed.totals.cogs + v.tentative.totals.cogs) * 100) === Math.round(v.all.totals.cogs * 100) && v.confirmed.totals.lines + v.tentative.totals.lines === v.all.totals.lines);
check('the confirmed view holds only confirmed sales; the tentative view only the rest', v.confirmed.invoices.every(function (r) { return r.status === 'confirmed'; }) && v.tentative.invoices.every(function (r) { return r.status !== 'confirmed'; }));
check('margin is on COSTED revenue only (the uncosted 2,000 is not in it)', v.all.totals.costed_revenue === Math.round((v.all.totals.revenue - 2000) * 100) / 100 && v.all.totals.uncosted_revenue === 2000);

// ── a typed P&L cost fills the gap — but the sale stays TENTATIVE ──
var typed = PC.groupCosts([{ product_key: 'mystery vinyl', cost_per_unit: 1.2, effective_from: '2026-06-01' }]);
var v2 = C.buildConfirmedPnl({ cells: asm.cells, invoiceMeta: metas, costsByKey: typed, pickCost: PC.pickCost, normalizeProductKey: PC.normalizeProductKey });
var t3 = inv(v2.all, 'INV-3');
check('a cost typed on the P&L screen is used only where the bills give none (1,000 × 1.20 = 1,200)', t3.cogs === 1200 && t3.uncosted_revenue === 0, t3);
check('… and that sale says TENTATIVE: "cost typed on the P&L screen"', t3.status === 'tentative' && t3.reasons.some(function (r) { return /typed on the P&L screen/.test(r.why); }), t3.reasons);
var typedLate = PC.groupCosts([{ product_key: 'mystery vinyl', cost_per_unit: 1.2, effective_from: '2026-09-01' }]);
check('a typed cost dated AFTER the sale is not used', inv(C.buildConfirmedPnl({ cells: asm.cells, invoiceMeta: metas, costsByKey: typedLate, pickCost: PC.pickCost, normalizeProductKey: PC.normalizeProductKey }).all, 'INV-3').uncosted_revenue === 2000);

// ── each kind of missing data makes a sale tentative, in plain words ──
function base() { return { invoice_id: 'x', invoice: 'X', invoice_date: '2026-07-01', description: 'D', product_key: 'n:d', product: 'D', orig_qty: 100, orig_unit_price: 1, invoiced: 100, goods_revenue: 100, transport_revenue: 0, pounds: 100, base_cost: 50, commission: 5, inbound_allowance: 1, brokerage: 0, bonded: 2, outbound_cost: 10, complete: true, flags: [] }; }
function k(mod, meta) { var c = Object.assign(base(), mod); return C.classifyCell(c, meta || null, null); }
check('complete + bill cost + nothing missing → confirmed; COGS = cost + commission + inbound + brokerage + bonded (58)', k({}).confirmed === true && k({}).cost === 58);
check('shipping only an estimate → tentative', k({ complete: false, flags: ['outbound_estimate'] }).reasons.indexOf('shipping is an estimate (no bill yet)') >= 0 && k({ complete: false, flags: ['outbound_estimate'] }).confirmed === false);
check('shipping bill missing → tentative', /shipping bill missing/.test(k({ complete: false, flags: ['outbound_bill_missing'] }).reasons.join()));
check('unit / weight missing → tentative', /unit not set/.test(k({ complete: false, pounds: null, flags: ['unit_unknown'] }).reasons.join()));
check('CNF shipping not separated → tentative, revenue falls back to the invoiced amount', (function () { var x = k({ complete: false, goods_revenue: null, flags: ['transport_not_separated'] }); return !x.confirmed && x.revenue === 100 && /not separated/.test(x.reasons.join()); })());
check('cost typed in the Profitability set-up → tentative', /typed by hand/.test(k({ complete: true, flags: ['cost_manual'] }).reasons.join()) && k({ flags: ['cost_manual'] }).confirmed === false);
check('cost from a purchase dated after the sale → tentative', /after the sale/.test(k({ flags: ['cost_assumed_before_first_purchase'] }).reasons.join()));
check('CNF / EXW guessed by rule → tentative', /guessed by rule/.test(k({}, { basis_source: 'inferred' }).reasons.join()) && k({}, { basis_source: 'inferred' }).confirmed === false);
check('shipping inside the price taken from an estimate → tentative', /estimate/.test(k({}, { embedded_used: 50, embedded_source: 'container cost (estimate)' }).reasons.join()));
check('brokerage / bonded unknown → tentative', /brokerage \/ bonded/.test(k({ bonded: null }).reasons.join()));
check('engine says not complete, no specific reason → still tentative, with a reason', (function () { var x = k({ complete: false }); return !x.confirmed && x.reasons.length === 1; })());

// ── wiring ──
var rt = fs.readFileSync(path.join(root, 'src/app/api/accounting/pnl/route.js'), 'utf8');
var ui = fs.readFileSync(path.join(root, 'src/components/PnLTab.jsx'), 'utf8');
var pr = fs.readFileSync(path.join(root, 'src/app/api/accounting/profitability/route.js'), 'utf8');
var ld = fs.readFileSync(path.join(root, 'src/lib/profitability-load-server.js'), 'utf8');
check('route: report uses the shared engine and strips sales figures along with margin when restricted', /loadProfitabilityInput\(db\)/.test(rt) && /assembleProfitability\(/.test(rt) && /buildConfirmedPnl\(/.test(rt) && /marginE \? outE : researcherView\(outE\)/.test(rt));
check('route: the older typed-costs-only view is kept (report_typed)', /action === 'report_typed'/.test(rt));
check('Profitability uses the very same loader (one way to read the data)', /loadProfitabilityInput\(db\)/.test(pr) && /pl_release_part_estimates/.test(ld) && /pl_warehouse_shipping/.test(ld));
check('screen: Confirmed / Tentative / All cards and filter, per-row badge with what is missing', /'✅ Confirmed'/.test(ui) && /Tentative \(missing data\)/.test(ui) && /setMode\(m\[0\]\)/.test(ui) && /missing: \{why\}/.test(ui));
check('screen: Avg price / lb and Avg cost / lb columns; revenue labelled "CNF shipping taken out"', /'Avg price \/ lb'/.test(ui) && /'Avg cost \/ lb'/.test(ui) && /CNF shipping taken out/.test(ui));
check('SWC-safe route and libs', [rt, ld, fs.readFileSync(path.join(root, 'src/lib/pnl-confirmed.js'), 'utf8')].every(function (s) { return s.indexOf('`') < 0 && !/=>/.test(s); }));
// Codex 11:50 P2 — standard allowances are labelled, never 'everything real'
(function () {
  var C = require(path.join(root, 'src/lib/pnl-confirmed.js'));
  var k = C.classifyCell({ complete: true, base_cost: 100, commission: 5, inbound_allowance: 200, brokerage: 0, bonded: 200, bonded_from: 'standard $200', goods_revenue: 1000, pounds: 10000, orig_qty: 10000, orig_unit_price: 0.1, invoiced: 1000, flags: [] }, null, null);
  check('UD-P2: a complete bill-cost sale with the inbound allowance and standard $200 bonded is confirmed AND lists both allowances', k.confirmed === true && k.allowances.indexOf('standard inbound allowance (per lb)') >= 0 && k.allowances.indexOf('standard $200 bonded') >= 0);
  var k2 = C.classifyCell({ complete: true, base_cost: 100, commission: 5, inbound_allowance: 0, brokerage: 0, bonded: 350, bonded_from: 'bill', goods_revenue: 1000, pounds: 10000, orig_qty: 10000, orig_unit_price: 0.1, invoiced: 1000, flags: [] }, null, null);
  check('UD-P2: bonded from a real bill is not called a standard allowance', k2.allowances.length === 0);
  var srcs = fs.readFileSync(path.join(root, 'src/app/api/accounting/pnl/route.js'), 'utf8') + fs.readFileSync(path.join(root, 'src/components/PnLTab.jsx'), 'utf8');
  check('UD-P2: no screen or report text calls CONFIRMED "everything real" / "100% real"', !/everything real|100% real/.test(srcs) && /standard allowances/.test(srcs));
})();
// v55.83-UD (Codex 12:15/12:30) — the REAL engine's answer through the history-window projection: no older bill records left anywhere
(function () {
  var PW = require(path.join(root, 'src/lib/profitability-window.js'));
  var src = []; (asm.cells || []).forEach(function (c) { (c.cost_sources || []).forEach(function (s) { src.push(s); }); });
  var dates = src.map(function (s) { return s.bill_date; }).filter(Boolean).sort();
  check('window (real engine): the fixture really has dated purchase sources', dates.length > 0, src);
  if (!dates.length) { return; }
  var floor = '2026-07-01'; var old = src.filter(function (s) { return !s.bill_date || s.bill_date < floor; });
  var copy = JSON.parse(JSON.stringify(asm)); var pj = PW.projectForWindow(copy, floor); var txt = JSON.stringify(pj);
  check('window (real engine): every purchase bill dated before the window is gone from the WHOLE answer', old.length > 0 && old.every(function (s) { return txt.indexOf('"bill_id":"' + s.bill_id + '"') < 0 && (!s.bill_number || txt.indexOf(s.bill_number) < 0); }), old);
  check('window (real engine): totals and every cell cost unchanged', JSON.stringify(pj.totals) === JSON.stringify(asm.totals) && pj.cells.every(function (c, i) { return c.base_cost === asm.cells[i].base_cost && c.profit === asm.cells[i].profit; }));
  check('window (real engine): the bill-name list carries no quantities, costs, suppliers or dates', (pj.bill_names || []).every(function (b) { return b.qty === undefined && b.cost === undefined && b.vendors === undefined && b.last_date === undefined; }));
})();
console.log('\nUD P&L confirmed: ' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
