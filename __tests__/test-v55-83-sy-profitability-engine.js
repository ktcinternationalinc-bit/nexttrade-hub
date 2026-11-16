// ═══════════════════════════════════════════════════════════════════════════
// v55.83-SY — the profitability calculation engine, checked against the worked examples Max approved (Nov 16 2026):
// EXW · CNF · trucking-included (yards, bill missing) · one invoice on two releases · grouped product drill-down.
// Plus his test list: "yards and linear meters, actual NexPac commission, Houston versus Canada, mixed-origin
// invoices, two-release invoices, CNF revenue separation, missing bills, and duplicate allocations. Every total must
// trace back to its source records."
// Everything here is RUN (pure functions). Nothing reads or writes a database.
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var P = require(path.join(root, 'src/lib/profitability.js'));
var fs = require('fs');
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 900))); }
function sum(rows, f) { var t = 0; rows.forEach(function (r) { t += Math.round((Number(r[f]) || 0) * 100); }); return t / 100; }

// actual purchase bills (NexPac): cost and the commission recorded ON the bill line
var BILLS = [
  { bill_id: 'pb1', bill_number: 'NX-1', vendor: 'NexPac Corporation', bill_date: '2026-05-20', release: '', description: 'Stock PVC Rolls', qty: 100000, unit: 'lb', cost_amount: 25000, commission_amount: 3125 },
  { bill_id: 'pb1', bill_number: 'NX-1', vendor: 'NexPac Corporation', bill_date: '2026-05-20', release: '', description: 'PVC Auto Seconds', qty: 100000, unit: 'lb', cost_amount: 18000, commission_amount: 2250 }
];
var LINKS = { 'stock pvc rolls': ['stock pvc rolls'], 'pvc auto seconds': ['pvc auto seconds'], 'pvc auto seconds yd': ['pvc auto seconds'] };
function costOf(inv, cell) { return P.resolveCost({ billNameKeys: LINKS[P.nameKey(cell.description)] || [P.nameKey(cell.description)], invoiceDate: inv.date, releases: inv.releases, productKey: cell.product_key }, BILLS, { windowDays: 90 }); }
function run(invoices, extra) { return P.buildCells(Object.assign({ invoices: invoices, costOf: costOf }, extra || {})); }
function by(cells, desc, rel) { return cells.filter(function (c) { return c.description === desc && (rel === undefined || c.release === rel); })[0]; }

console.log('SY — profitability engine');

// ── units ──
check('U1: 1 yard = 2.5 lb, and $0.30 / yard = $0.12 / lb', P.toPounds(10000, 'yards') === 25000 && Math.abs(P.pricePerPound(0.30, 'yd') - 0.12) < 1e-9);
check('U2: 1 linear metre = 2.5 lb (a business weight, set per unit)', P.toPounds(4000, 'Linear Meter') === 10000 && P.toPounds(4000, 'LM') === 10000);
check('U3: a product can carry its own factor', P.toPounds(100, 'yd', 'g:x', { byProduct: { 'g:x': { yd: 3 } } }) === 300);
check('U4: an unknown or missing unit is NEVER guessed', P.toPounds(100, 'roll') === null && P.toPounds(100, '') === null && P.pricePerPound(1, 'each') === null);
check('U5: splitting to the cent always adds back ($1,000.01 three ways)', (function () { var a = P.allocate(1000.01, [1, 1, 1]); return Math.round((a[0] + a[1] + a[2]) * 100) === 100001; })());

// ── Example 1: EXW ──
var ex1 = run([{ id: 'i1', number: 'INV-1', date: '2026-07-01', customer: 'Alpha', basis: 'EXW', releases: ['REL-1'], lines: [
  { id: 'a', description: 'Stock PVC Rolls', qty: 25000, unit: 'lb', unit_price: 0.40 },
  { id: 'b', description: 'PVC Auto Seconds', qty: 25000, unit: 'lb', unit_price: 0.30 },
  { id: 'c', description: 'Freight', qty: 1, unit: '', unit_price: 1200 }] }], { outbound: { REL1: { actual: 1000 } } });
var r1 = by(ex1.cells, 'Stock PVC Rolls'), s1 = by(ex1.cells, 'PVC Auto Seconds');
check('E1a: EXW goods revenue stays goods-only ($10,000 / $7,500; $0.40 and $0.30 per lb)', r1.goods_revenue === 10000 && s1.goods_revenue === 7500);
check('E1b: the invoice freight line is TRANSPORTATION REVENUE, split by pounds ($600 each)', r1.transport_revenue === 600 && s1.transport_revenue === 600 && r1.transport_source === 'invoice line');
check('E1c: base cost comes from the ACTUAL bill ($0.25 and $0.18 per lb), commission from the bill line', r1.base_cost === 6250 && s1.base_cost === 4500 && r1.commission === 781.25 && s1.commission === 562.5 && r1.cost_method === 'window');
check('E1d: standard inbound allowance = pounds × $0.02', r1.inbound_allowance === 500 && s1.inbound_allowance === 500);
check('E1e: the $1,000 trucking bill is split by pounds — $500 each, $0.02 / lb', r1.outbound_cost === 500 && s1.outbound_cost === 500);
check('E1f: profit $2,568.75 + $2,037.50 = $4,606.25; transportation profit $200 shown apart', r1.profit === 2568.75 && s1.profit === 2037.5 && sum(ex1.cells, 'profit') === 4606.25 && r1.transport_profit === 100 && r1.complete === true);
check('E1g: it traces back — $18,700 invoiced − all costs = profit', Math.round((18700 - (10750 + 1343.75 + 1000 + 1000)) * 100) === Math.round(sum(ex1.cells, 'profit') * 100));

// ── Example 2: CNF with brokerage ──
function cnf(embedded) { return run([{ id: 'i2', number: 'INV-2', date: '2026-07-02', customer: 'Beta', basis: 'CNF', embedded_transport: embedded, releases: ['REL-2'], lines: [
  { id: 'a', description: 'Stock PVC Rolls', qty: 25000, unit: 'lb', unit_price: 0.46 },
  { id: 'b', description: 'PVC Auto Seconds', qty: 25000, unit: 'lb', unit_price: 0.36 }] }], { outbound: { REL2: { actual: 2800 } }, brokerage: { REL2: 300 } }); }
var ex2 = cnf(3000); var r2c = by(ex2.cells, 'Stock PVC Rolls'), s2c = by(ex2.cells, 'PVC Auto Seconds');
check('E2a: CNF — the entered $3,000 is taken OUT of the goods price (goods $10,000 / $7,500), never added on top', r2c.goods_revenue === 10000 && s2c.goods_revenue === 7500 && r2c.transport_revenue === 1500 && sum(ex2.cells, 'goods_revenue') + sum(ex2.cells, 'transport_revenue') === 20500);
check('E2b: outbound $2,800 → $1,400 each; brokerage $300 → $150 each, in its own column', r2c.outbound_cost === 1400 && r2c.brokerage === 150 && r2c.bonded === 0);
check('E2c: profit $2,418.75 + $1,887.50 = $4,306.25', r2c.profit === 2418.75 && s2c.profit === 1887.5 && sum(ex2.cells, 'profit') === 4306.25);
var ex2b = cnf(2000);
check('E2d: changing the entered amount moves money between goods and transportation — total revenue and total profit do NOT move', sum(ex2b.cells, 'profit') === 4306.25 && sum(ex2b.cells, 'goods_revenue') === 18500 && sum(ex2b.cells, 'transport_revenue') === 2000 && by(ex2b.cells, 'Stock PVC Rolls').goods_revenue === 10500);
var ex2c = cnf(null);
check('E2e: CNF with nothing entered → "transportation not separated"; the price is NOT labelled a confirmed goods price', ex2c.flags.some(function (f) { return f.kind === 'transport_not_separated'; }) && by(ex2c.cells, 'Stock PVC Rolls').goods_price_confirmed === false && by(ex2c.cells, 'Stock PVC Rolls').complete === false);
var exwManual = run([{ id: 'i9', number: 'INV-9', date: '2026-07-02', customer: 'Beta', basis: 'EXW', embedded_transport: 500, releases: ['REL-9'], lines: [{ id: 'a', description: 'Stock PVC Rolls', qty: 1000, unit: 'lb', unit_price: 0.40 }] }]);
check('E2f: on EXW a typed amount cannot invent revenue the invoice does not carry', exwManual.cells[0].transport_revenue === 0 && exwManual.cells[0].goods_revenue === 400 && exwManual.flags.some(function (f) { return f.kind === 'manual_transport_ignored_not_inclusive'; }));

// ── Example 3: trucking included, sold in YARDS, bill missing ──
function ex3(out) { return run([{ id: 'i3', number: 'INV-3', date: '2026-07-03', customer: 'Gamma', basis: 'TRUCKING_INCLUDED', embedded_transport: 1000, releases: ['REL-3'], lines: [
  { id: 'a', description: 'Stock PVC Rolls', qty: 25000, unit: 'lb', unit_price: 0.42 },
  { id: 'b', description: 'PVC Auto Seconds YD', qty: 10000, unit: 'yd', unit_price: 0.80 }] }], { outbound: { REL3: out } }); }
var e3 = ex3({ estimate: 900 }); var s3 = by(e3.cells, 'PVC Auto Seconds YD');
check('E3a: 10,000 yards at $0.80 = 25,000 lb; goods $7,500 = $0.30 / lb; the original 10,000 yd and $0.80 are kept', s3.pounds === 25000 && s3.goods_revenue === 7500 && s3.orig_qty === 10000 && s3.orig_unit === 'yd' && s3.orig_unit_price === 0.8 && s3.unit_factor === 2.5);
check('E3b: an ESTIMATE is labelled an estimate and the row is not "complete"', s3.outbound_kind === 'estimate' && s3.outbound_cost === 450 && s3.complete === false && sum(e3.cells, 'profit') === 4506.25);
var e3m = ex3(undefined);
check('E3c: a missing bill is UNKNOWN, not zero — outbound is null, only profit-before-outbound ($5,406.25) is given', by(e3m.cells, 'Stock PVC Rolls').outbound_cost === null && by(e3m.cells, 'Stock PVC Rolls').outbound_kind === 'unknown' && sum(e3m.cells, 'profit') === 5406.25 && by(e3m.cells, 'Stock PVC Rolls').transport_profit === null);
var e3a = ex3({ actual: 1000, estimate: 900 });
check('E3d: when the bill arrives it REPLACES the estimate (never both): profit $4,406.25, transportation profit $0', sum(e3a.cells, 'profit') === 4406.25 && sum(e3a.cells, 'outbound_cost') === 1000 && by(e3a.cells, 'Stock PVC Rolls').transport_profit === 0);

// ── Example 4: one invoice on two releases; one bill covering both ──
var split = P.splitBillAcrossReleases({ amount: 1500, releases: [{ release: 'REL-A' }, { release: 'REL-B' }] }, { RELA: 50000, RELB: 25000 });
check('E4a: a $1,500 bill over two releases is split FIRST between the releases by pounds ($1,000 / $500)', split.shares.RELA === 1000 && split.shares.RELB === 500 && split.method === 'pounds');
var ex4 = run([{ id: 'i4', number: 'INV-4', date: '2026-07-04', customer: 'Delta', basis: 'EXW', releases: ['REL-A', 'REL-B'], lines: [
  { id: 'a', description: 'Stock PVC Rolls', qty: 25000, unit: 'lb', unit_price: 0.40, release_pounds: { RELA: 25000 } },
  { id: 'b', description: 'PVC Auto Seconds', qty: 50000, unit: 'lb', unit_price: 0.30, release_pounds: { RELA: 25000, RELB: 25000 } },
  { id: 'c', description: 'Freight charge', qty: 1, unit: '', unit_price: 1800 }] }], { outbound: { RELA: { actual: split.shares.RELA }, RELB: { actual: split.shares.RELB } } });
check('E4b: three cells — A: Rolls, A: Seconds, B: Seconds — each $2,568.75 / $2,037.50 / $2,037.50', ex4.cells.length === 3 && by(ex4.cells, 'Stock PVC Rolls', 'RELA').profit === 2568.75 && by(ex4.cells, 'PVC Auto Seconds', 'RELA').profit === 2037.5 && by(ex4.cells, 'PVC Auto Seconds', 'RELB').profit === 2037.5);
check('E4c: total $6,643.75 = $26,800 − $20,156.25, and the bill’s two shares add back to $1,500', sum(ex4.cells, 'profit') === 6643.75 && sum(ex4.cells, 'outbound_cost') === 1500 && sum(ex4.cells, 'transport_revenue') === 1800);
check('E4d: explicit shares that do not add up to the bill are refused', P.splitBillAcrossReleases({ amount: 1500, releases: [{ release: 'A', share: 900 }, { release: 'B', share: 500 }] }, {}).problem === 'shares_do_not_add_up');
check('E4e: the same release linked twice to one bill is counted ONCE and flagged', (function () { var d = P.splitBillAcrossReleases({ amount: 1000, releases: [{ release: 'REL-A' }, { release: 'rel a' }] }, { RELA: 10 }); return d.shares.RELA === 1000 && d.problem === 'duplicate_release_link'; })());
var noSplit = run([{ id: 'i5', number: 'INV-5', date: '2026-07-04', customer: 'Delta', basis: 'EXW', releases: ['REL-A', 'REL-B'], lines: [{ id: 'a', description: 'Stock PVC Rolls', qty: 1000, unit: 'lb', unit_price: 0.40 }] }]);
check('E4f: a two-release invoice whose pounds were not assigned to releases is flagged, not guessed', noSplit.flags.some(function (f) { return f.kind === 'release_split_missing'; }) && noSplit.cells[0].release === '' && noSplit.cells[0].complete === false);

// ── grouping changes the presentation only ──
var grp = { 'premium pvc leather seconds': { id: 'G1', name: 'Texas Seconds' }, 'grade b texas': { id: 'G1', name: 'Texas Seconds' } };
var gInv = [{ id: 'g1', number: 'INV-G1', date: '2026-07-05', customer: 'Alpha', basis: 'EXW', releases: ['REL-G1'], lines: [{ id: 'a', description: 'Premium PVC Leather Seconds', qty: 25000, unit: 'lb', unit_price: 0.30 }] },
  { id: 'g2', number: 'INV-G2', date: '2026-07-06', customer: 'Beta', basis: 'EXW', releases: ['REL-G2'], lines: [{ id: 'a', description: 'Grade B Texas', qty: 4000, unit: 'yd', unit_price: 0.875 }] }];
var grouped = P.buildCells({ invoices: gInv, groupOf: function (d) { return grp[P.nameKey(d)] || null; } });
var plain = P.buildCells({ invoices: gInv });
var gRows = P.summarize(grouped.cells, function (c) { return c.product_key; }, function (c) { return c.product; });
check('G1: three names can sit under one chosen name; the group is ONE row', gRows.length === 1 && gRows[0].label === 'Texas Seconds' && gRows[0].name_list.length === 2);
check('G2: weighted average — 35,000 lb, $11,000, $0.3143 / lb (NOT the $0.325 average of $0.30 and $0.35)', gRows[0].pounds === 35000 && gRows[0].goods_revenue === 11000 && gRows[0].avg_goods_price_per_lb === 0.3143);
check('G3: grouping does not change any total (same cells, same sums)', sum(grouped.cells, 'goods_revenue') === sum(plain.cells, 'goods_revenue') && sum(grouped.cells, 'profit') === sum(plain.cells, 'profit') && P.reconcile(grouped.cells, gRows).ok);
var byCust = P.summarize(ex4.cells.concat(ex1.cells), function (c) { return c.customer; });
var byInv = P.summarize(ex4.cells.concat(ex1.cells), function (c) { return c.invoice_id; });
check('G4: the customer view, the invoice view and the cells all reconcile to the same totals', P.reconcile(ex4.cells.concat(ex1.cells), byCust).ok && P.reconcile(ex4.cells.concat(ex1.cells), byInv).ok && sum(byCust, 'profit') === 11250);
var filt = ex4.cells.filter(function (c) { return c.description === 'Stock PVC Rolls'; });
check('G5: filtering to one product cannot change its share of a shipment’s cost ($500, as in the full view)', filt.length === 1 && filt[0].outbound_cost === 500);

// ── which purchases cost this sale ──
var lines = [
  { bill_id: 'b1', bill_date: '2026-03-01', release: '', description: 'Texas Seconds', qty: 10000, unit: 'lb', cost_amount: 1500, commission_amount: 187.5 },
  { bill_id: 'b2', bill_date: '2026-06-10', release: '', description: 'Texas Seconds', qty: 30000, unit: 'lb', cost_amount: 6000, commission_amount: 750 },
  { bill_id: 'b3', bill_date: '2026-06-20', release: '', description: 'Texas Seconds', qty: 4000, unit: 'yd', cost_amount: 2500, commission_amount: 312.5 },
  { bill_id: 'b4', bill_date: '2026-06-25', release: 'REL-77', description: 'Texas Seconds', qty: 20000, unit: 'lb', cost_amount: 3000, commission_amount: 375 },
  { bill_id: 'b5', bill_date: '2026-08-01', release: '', description: 'Texas Seconds', qty: 50000, unit: 'lb', cost_amount: 50000, commission_amount: 0 },
  { bill_id: 'b6', bill_date: '2026-06-15', release: '', description: 'Something Else Entirely', qty: 1000, unit: 'lb', cost_amount: 9999, commission_amount: 0 }];
var q = { billNameKeys: ['texas seconds'], invoiceDate: '2026-07-01', releases: ['REL-77'] };
var cR = P.resolveCost(q, lines, { windowDays: 90 });
check('C1: a bill that carries the SAME release number as the sale is used first ($0.15 / lb)', cR.method === 'release' && Math.abs(cR.base_per_lb - 0.15) < 1e-9 && cR.sources.length === 1 && cR.sources[0].bill_id === 'b4');
var cW = P.resolveCost({ billNameKeys: ['texas seconds'], invoiceDate: '2026-07-01', releases: ['REL-OTHER'] }, lines, { windowDays: 90 });
check('C2: otherwise the pound-weighted actual cost of linked purchases in the 90 days up to the invoice date — $11,500 ÷ 60,000 lb, yards converted', cW.method === 'window' && Math.abs(cW.base_per_lb - 11500 / 60000) < 1e-9 && cW.sources.length === 3 && Math.abs(cW.commission_per_lb - 1437.5 / 60000) < 1e-9);
check('C3: a LATER purchase (Aug 1) never changes an earlier sale, and an unlinked description is never used', cW.sources.every(function (s) { return s.bill_id !== 'b5' && s.bill_id !== 'b6'; }));
var cL = P.resolveCost({ billNameKeys: ['texas seconds'], invoiceDate: '2026-07-01', releases: [] }, lines.slice(0, 1), { windowDays: 90 });
check('C4: nothing in the window → the last purchase before the sale', cL.method === 'last_purchase' && Math.abs(cL.base_per_lb - 0.15) < 1e-9);
check('C5: no purchase at all → MISSING (null), never zero', P.resolveCost({ billNameKeys: ['never bought'], invoiceDate: '2026-07-01', releases: [] }, lines, {}) === null);
check('C6: a typed fallback is used only when nothing else exists, and is labelled manual', P.resolveCost({ billNameKeys: ['never bought'], invoiceDate: '2026-07-01', releases: [], manual: { base_per_lb: 0.2 } }, lines, {}).method === 'manual');
var charged = P.buildCells({ invoices: [{ id: 'k', number: 'K', date: '2026-07-01', customer: 'A', basis: 'EXW', releases: ['REL-OTHER'], lines: [{ id: 'a', description: 'Texas Seconds', qty: 1000, unit: 'lb', unit_price: 0.5 }] }], costOf: function () { return cW; } });
check('C7: the sale is charged RATE × ITS OWN POUNDS ($191.67 for 1,000 lb) — never the $11,500 of the bills', charged.cells[0].base_cost === 191.67 && charged.cells[0].commission === 23.96);
var noCost = P.buildCells({ invoices: [{ id: 'm', number: 'M', date: '2026-07-01', customer: 'A', basis: 'EXW', releases: ['REL-M'], lines: [{ id: 'a', description: 'Unknown Product', qty: 1000, unit: 'lb', unit_price: 0.5 }] }], costOf: function () { return null; }, outbound: { RELM: { actual: 10 } } });
check('C8: a missing cost stays visibly missing and the margin is NOT called complete', noCost.cells[0].base_cost === null && noCost.cells[0].complete === false && noCost.cells[0].flags.indexOf('cost_missing') >= 0);
var nonNexpac = P.buildCells({ invoices: [{ id: 'n', number: 'N', date: '2026-07-01', customer: 'A', basis: 'EXW', releases: ['REL-N'], lines: [{ id: 'a', description: 'Other Supplier Goods', qty: 1000, unit: 'lb', unit_price: 0.5 }] }], costOf: function () { return P.resolveCost({ billNameKeys: ['other supplier goods'], invoiceDate: '2026-07-01', releases: [] }, [{ bill_id: 'o1', bill_date: '2026-06-01', description: 'Other Supplier Goods', qty: 1000, unit: 'lb', cost_amount: 300, commission_amount: null }], {}); } });
check('C9: no commission on a bill = no commission charged (no blanket 12.5%)', nonNexpac.cells[0].commission === 0 && nonNexpac.cells[0].base_cost === 300);

// ── Houston only ──
var pool = P.houstonPoolAllocation(900, [{ release: 'H-1', origin: 'Houston' }, { release: 'H-2', origin: 'HOUSTON' }, { release: 'C-1', origin: 'Canada' }, { release: 'X-1', origin: '' }, { release: 'H-3', origin: 'houston' }]);
check('H1: an unlinked brokerage / bonded pool is shared equally across the HOUSTON releases only ($300 × 3)', pool.shares.H1 === 300 && pool.shares.H2 === 300 && pool.shares.H3 === 300 && Object.keys(pool.shares).length === 3);
check('H2: Canada gets ZERO and unknown origin is flagged, never assumed Houston', pool.excluded.indexOf('C1') >= 0 && pool.unknown_origin.indexOf('X1') >= 0 && pool.shares.C1 === undefined && pool.shares.X1 === undefined);
var mixed = P.buildCells({ invoices: [{ id: 'mx', number: 'MX', date: '2026-07-01', customer: 'A', basis: 'EXW', releases: ['H-1', 'C-1'], lines: [
  { id: 'a', description: 'Stock PVC Rolls', qty: 20000, unit: 'lb', unit_price: 0.4, release_pounds: { H1: 10000, C1: 10000 } }] }], brokerage: { H1: pool.shares.H1 }, bonded: { H1: 120 } });
check('H3: a mixed-origin invoice — only its Houston portion carries the charge; brokerage and bonded stay in separate columns', by(mixed.cells, 'Stock PVC Rolls', 'H1').brokerage === 300 && by(mixed.cells, 'Stock PVC Rolls', 'H1').bonded === 120 && by(mixed.cells, 'Stock PVC Rolls', 'C1').brokerage === 0 && by(mixed.cells, 'Stock PVC Rolls', 'C1').bonded === 0);
check('H4: with no Houston release nothing is allocated — the amount is reported as unallocated', P.houstonPoolAllocation(500, [{ release: 'C-1', origin: 'Canada' }]).unallocated === 500);

check('H5: a release number starting 1002- is Houston', P.releaseOrigin('1002-4471', '').origin === 'HOUSTON' && P.releaseOrigin(' 1002 - 88', '').origin === 'HOUSTON');
check('H6: the word Houston on the invoice is Houston, whatever the release number', P.releaseOrigin('REL-55', 'Ship from: Houston, TX').origin === 'HOUSTON' && P.releaseOrigin('REL-55', 'Ship from: Houston, TX').source === 'invoice wording');
check('H7: a release number starting 1001- shipped out of CANADA; a prefix nobody mapped (1009-) is UNKNOWN and says why; 10021- is not 1002-', P.releaseOrigin('1001-1567', '').origin === 'CANADA' && P.releaseOrigin('1009-1', '').origin === '' && /not mapped/.test(P.releaseOrigin('1009-1', '').source) && P.releaseOrigin('10021-5', '').origin === '');
check('H8: a Canada release (1001-) gets ZERO from the Houston pool, straight from the release numbers', (function () { var o = P.releaseOrigin('1001-1567', '').origin; var pl = P.houstonPoolAllocation(100, [{ release: '1001-1567', origin: o }, { release: '1002-9', origin: P.releaseOrigin('1002-9', '').origin }]); return o === 'CANADA' && pl.shares['10029'] === 100 && pl.excluded.length === 1; })());
// ── basis suggestion: wording suggests, a person confirms ──
check('B1: CNF / C&F wording suggests CNF; a separate freight line suggests EXW; neither → no suggestion', P.suggestBasis('Price C&F Alexandria', false) === 'CNF' && P.suggestBasis('', true) === 'EXW' && P.suggestBasis('PVC rolls', false) === null);
check('B2: an invoice with no basis is flagged and never complete', (function () { var x = P.buildCells({ invoices: [{ id: 'z', number: 'Z', date: '2026-07-01', customer: 'A', releases: ['R'], lines: [{ id: 'a', description: 'Rolls', qty: 10, unit: 'lb', unit_price: 1 }] }] }); return x.flags.some(function (f) { return f.kind === 'basis_missing'; }) && x.cells[0].complete === false; })());

// ── REVIEW DEFECT 1 (Nov 16): a purchase line with no cost became $0 and the margin was called complete ──
function sale500(billLine, manual) { return P.buildCells({ invoices: [{ id: 'd1', number: 'D1', date: '2026-07-01', customer: 'A', basis: 'EXW', releases: ['REL-D1'], lines: [{ id: 'a', description: 'Mystery Vinyl', qty: 1000, unit: 'lb', unit_price: 0.5 }] }],
  costOf: function (inv) { return P.resolveCost({ billNameKeys: ['mystery vinyl'], invoiceDate: inv.date, releases: inv.releases, manual: manual }, [].concat(billLine), {}); }, outbound: { RELD1: { actual: 10 } } }); }
var d1 = sale500({ bill_id: 'x1', bill_date: '2026-06-01', description: 'Mystery Vinyl', qty: 1000, unit: 'lb', cost_amount: null, amount: null, commission_amount: null });
check('D1a: a bill line with NO cost → the cost is UNKNOWN (null), never $0; the $500 sale is NOT complete and says why', d1.cells[0].base_cost === null && d1.cells[0].commission === null && d1.cells[0].complete === false && d1.cells[0].flags.indexOf('cost_missing') >= 0 && d1.cells[0].flags.indexOf('purchase_line_without_cost') >= 0 && d1.cells[0].missing_cost_lines.length === 1, d1.cells[0]);
check('D1b: the row’s profit is only the known part and the summary lists base cost as unknown', (function () { var r = P.summarize(d1.cells, function (c) { return c.invoice_id; })[0]; return r.complete === false && r.unknown_fields.indexOf('base_cost') >= 0 && r.avg_base_cost_per_lb === null; })());
check('D1c: zero, negative and not-a-number costs are unknown too', ['0', 0, -5, 'abc', ''].every(function (v) { var x = sale500({ bill_id: 'x', bill_date: '2026-06-01', description: 'Mystery Vinyl', qty: 1000, unit: 'lb', cost_amount: v, amount: null }); return x.cells[0].base_cost === null && x.cells[0].complete === false; }));
check('D1d: a non-commission vendor’s line has no cost_amount but a printed amount — that amount IS the cost ($0.30 / lb)', (function () { var x = sale500({ bill_id: 'x', bill_date: '2026-06-01', description: 'Mystery Vinyl', qty: 1000, unit: 'lb', cost_amount: null, amount: 300, commission_amount: null }); return x.cells[0].base_cost === 300 && x.cells[0].commission === 0 && x.cells[0].complete === true; })());
check('D1e: one good line and one line without a cost on the same purchase set → unknown, not a partial rate that looks exact', (function () { var x = sale500([{ bill_id: 'x1', bill_date: '2026-06-01', description: 'Mystery Vinyl', qty: 1000, unit: 'lb', cost_amount: 300 }, { bill_id: 'x2', bill_date: '2026-06-02', description: 'Mystery Vinyl', qty: 1000, unit: 'lb', cost_amount: null, amount: null }]); return x.cells[0].base_cost === null && x.cells[0].complete === false && x.cells[0].missing_cost_lines[0].bill_id === 'x2'; })());
check('D1f: a typed fallback of 0 is not a cost', P.resolveCost({ billNameKeys: ['nothing'], invoiceDate: '2026-07-01', releases: [], manual: { base_per_lb: 0 } }, [], {}) === null);

// ── REVIEW DEFECT 2 (Nov 16): one product without a weight pushed ALL transportation onto the product that had one ──
function twoProducts(unitB, basis, embedded) { return P.buildCells({ invoices: [{ id: 'd2', number: 'D2', date: '2026-07-01', customer: 'A', basis: basis || 'EXW', embedded_transport: embedded, releases: ['REL-D2'], lines: [
  { id: 'a', description: 'Known Weight Rolls', qty: 1000, unit: 'lb', unit_price: 0.5 }, { id: 'b', description: 'Unknown Weight Rolls', qty: 40, unit: unitB, unit_price: 12.5 }].concat(basis ? [] : [{ id: 'c', description: 'Freight', qty: 1, unit: '', unit_price: 200 }]) }],
  costOf: function () { return { base_per_lb: 0.2, commission_per_lb: 0, method: 'window', sources: [] }; }, outbound: { RELD2: { actual: 150 } }, brokerage: { RELD2: 60 } }); }
var d2 = twoProducts('roll'); var kA = by(d2.cells, 'Known Weight Rolls'), kB = by(d2.cells, 'Unknown Weight Rolls');
check('D2a: the product WITH a weight no longer receives all of the freight charged — it is unresolved for both', kA.transport_revenue === null && kB.transport_revenue === null, [kA.transport_revenue, kB.transport_revenue]);
check('D2b: the trucking bill and the brokerage on that release are unresolved for both, not loaded onto one', kA.outbound_cost === null && kB.outbound_cost === null && kA.brokerage === null && kB.brokerage === null);
check('D2c: EVERY affected row is flagged and NEITHER is complete', kA.complete === false && kB.complete === false && kA.flags.indexOf('allocation_unresolved_missing_weight') >= 0 && kB.flags.indexOf('allocation_unresolved_missing_weight') >= 0);
check('D2d: the amounts are not lost — $200 charged, $150 trucking and $60 brokerage are listed as unallocated', (function () { var u = {}; d2.unallocated.forEach(function (x) { u[x.what] = x.amount; }); return u.transport_revenue === 200 && u.outbound_cost === 150 && u.brokerage === 60; })(), d2.unallocated);
var d2g = P.summarize(d2.cells, function () { return 'g'; });
check('D2e: a grouped row with part of its weight missing shows NO average price (it would divide all the revenue by some of the pounds)', d2g[0].avg_goods_price_per_lb === null && d2g[0].weight_missing === true && d2g[0].pounds_incomplete === true && d2g[0].complete === false, d2g[0]);
var d2c = twoProducts('roll', 'CNF', 100);
check('D2f: CNF with a missing weight — the goods price cannot be separated for anyone, so goods revenue is unknown, not guessed', by(d2c.cells, 'Known Weight Rolls').goods_revenue === null && by(d2c.cells, 'Unknown Weight Rolls').goods_revenue === null && d2c.unallocated.some(function (x) { return x.what === 'embedded_transport' && x.amount === 100; }));
var d2ok = twoProducts('lb');
check('D2g: once every weight is known the same invoice resolves and reconciles ($200 charged, $150 trucking, $60 brokerage, all placed)', sum(d2ok.cells, 'transport_revenue') === 200 && sum(d2ok.cells, 'outbound_cost') === 150 && sum(d2ok.cells, 'brokerage') === 60 && d2ok.unallocated.length === 0 && d2ok.cells.every(function (c) { return c.complete === true; }));

// ── the assembly step: real-shaped rows in, the three views out ──
var A = require(path.join(root, 'src/lib/profitability-assemble.js'));
check('A0: release numbers written together are separated ("1001-5 / 1002-11", "1002-1 & 1002-2", "1002-3, 1002-4")', A.splitReleases('1001-5 / 1002-11').length === 2 && A.splitReleases('1002-1 & 1002-2')[1].raw === '1002-2' && A.splitReleases('1002-3, 1002-4').length === 2 && A.splitReleases('1002-3').length === 1);
var asm = A.assembleProfitability({ date_from: '2026-06-01', date_to: '2026-12-31',
  invoices: [{ id: 'i1', invoice_number: 'INV-1', accounting_customer_id: 'c1', invoice_date: '2026-07-01', record_status: 'active', currency: 'USD', release_number: '1002-10' },
    { id: 'i2', invoice_number: 'INV-2', accounting_customer_id: 'c2', invoice_date: '2026-05-01', record_status: 'active', currency: 'USD', release_number: '1002-10' },
    { id: 'i3', invoice_number: 'INV-3', accounting_customer_id: 'c1', invoice_date: '2026-07-02', record_status: 'active', currency: 'USD', release_number: '1001-5 / 1002-11' },
    { id: 'i4', invoice_number: 'INV-VOID', accounting_customer_id: 'c1', invoice_date: '2026-07-02', record_status: 'void', currency: 'USD', release_number: '1002-10' }],
  items: [{ id: 'a', invoice_id: 'i1', description: 'Stock PVC Rolls', quantity: 25000, unit_price: 0.4 }, { id: 'f', invoice_id: 'i1', description: 'Freight', quantity: 1, unit_price: 600 },
    { id: 'b', invoice_id: 'i2', description: 'PVC Auto Seconds', quantity: 10000, unit_price: 0.75 }, { id: 'c', invoice_id: 'i3', description: 'Stock PVC Rolls', quantity: 20000, unit_price: 0.4 },
    { id: 'v', invoice_id: 'i4', description: 'Stock PVC Rolls', quantity: 99999, unit_price: 9 }],
  customerNames: { c1: 'Alpha', c2: 'Beta' },
  groups: [{ id: 'g1', display_name: 'PVC Rolls', active: true }],
  groupNames: [{ group_id: 'g1', source: 'invoice', name_key: 'stock pvc rolls', raw_name: 'Stock PVC Rolls', active: true }, { group_id: 'g1', source: 'bill', name_key: 'rolls a grade', raw_name: 'Rolls A-Grade', active: true }],
  nameUnits: [{ name_key: 'stock pvc rolls', unit: 'lb' }, { name_key: 'pvc auto seconds', unit: 'yd' }], lineUnits: [], factors: [], terms: [{ invoice_id: 'i1', basis: 'EXW' }, { invoice_id: 'i3', basis: 'EXW' }],
  lineReleasePounds: [{ invoice_item_id: 'c', release_key: '10015', pounds: 10000 }, { invoice_item_id: 'c', release_key: '100211', pounds: 10000 }], estimates: [],
  bills: [{ id: 'b1', vendor_name: 'NexPac Corporation', bill_number: 'NX1', bill_date: '2026-06-01', total_amount: 28125, record_status: 'active', bill_type: 'supplier', release_number: '' },
    { id: 'b2', vendor_name: 'Fast Freight', bill_number: 'T1', bill_date: '2026-07-03', total_amount: 1000, record_status: 'active', bill_type: 'trucking', shipment_direction: 'outbound', release_number: '1002-10' },
    { id: 'b3', vendor_name: 'KN Brokerage', bill_number: 'K1', bill_date: '2026-07-03', total_amount: 300, record_status: 'active', bill_type: 'bonded_brokerage', release_number: '1002-11' },
    { id: 'b4', vendor_name: 'KN Brokerage', bill_number: 'K2', bill_date: '2026-07-03', total_amount: 999, record_status: 'active', bill_type: 'bonded_brokerage', release_number: '1001-5' },
    { id: 'b5', vendor_name: 'Inbound Haulage', bill_number: 'T2', bill_date: '2026-07-03', total_amount: 777, record_status: 'active', bill_type: 'trucking', shipment_direction: 'inbound', release_number: '1002-11' },
    { id: 'b6', vendor_name: 'Old Trucker', bill_number: 'T3', bill_date: '2026-07-03', total_amount: 555, record_status: 'void', bill_type: 'trucking', shipment_direction: 'outbound', release_number: '1002-10' }],
  billLines: [{ bill_id: 'b1', line_kind: 'item', description: 'Rolls A-Grade', qty: 100000, unit: 'lb', cost_amount: 25000, commission_amount: 3125 }] });
var aI1 = asm.by_invoice.filter(function (r) { return r.label === 'INV-1'; })[0], aI3 = asm.by_invoice.filter(function (r) { return r.label === 'INV-3'; })[0];
check('A1: only invoices in the period are reported; a void invoice is ignored; an older invoice on the same release is used for the split only', asm.by_invoice.length === 2 && asm.counts.invoices_in_period === 2 && asm.counts.invoices_brought_in_for_shared_releases === 1);
check('A2: the $1,000 trucking bill on release 1002-10 is shared with the OLDER invoice on that release (10,000 yd = 25,000 lb) — INV-1 carries $500, not $1,000', aI1.outbound_cost === 500 && aI1.profit === 2568.75 && aI1.complete === true, aI1);
check('A3: goods cost and commission come from the linked supplier bill line (NX1), by pounds', aI1.base_cost === 6250 && aI1.commission === 781.25 && asm.cells.filter(function (c) { return c.invoice === 'INV-1'; })[0].cost_sources[0].bill_number === 'NX1');
check('A4: a two-release invoice gives one cell per release with its own origin (1001- Canada, 1002- Houston)', asm.cells.filter(function (c) { return c.invoice === 'INV-3'; }).map(function (c) { return c.origin; }).sort().join(',') === 'CANADA,HOUSTON');
check('A5: brokerage lands on the Houston release only; the brokerage bill on the Canada release is NOT allocated and is listed', aI3.brokerage === 300 && asm.cells.filter(function (c) { return c.origin === 'CANADA'; })[0].brokerage === 0 && asm.unallocated.some(function (u) { return u.bill === 'K2' && u.amount === 999; }) && asm.flags.some(function (f) { return f.kind === 'brokerage_bill_on_non_houston_release'; }));
check('A6: an INBOUND trucking bill is not outbound transportation — it is flagged, not counted; a void bill is ignored', aI3.unknown_fields.indexOf('outbound_cost') >= 0 && asm.flags.some(function (f) { return f.kind === 'transport_bill_not_marked_outbound' && f.bill === 'T2'; }) && !JSON.stringify(asm).match(/T3/));
check('A7: the product, customer and invoice views reconcile to the same totals', asm.reconciled.product && asm.reconciled.customer && asm.reconciled.invoice && asm.totals.goods_revenue === 18000 && asm.by_product.length === 1 && asm.by_product[0].label === 'PVC Rolls');
var asm2 = A.assembleProfitability({ date_from: '2026-06-01', date_to: '', invoices: [{ id: 'z1', invoice_number: 'Z1', accounting_customer_id: 'c1', invoice_date: '2026-07-01', record_status: 'active', currency: 'USD', release_number: '1002-50' }], items: [{ id: 'q', invoice_id: 'z1', description: 'Texas Seconds', quantity: 1000, unit_price: 0.5 }], customerNames: {}, groups: [], groupNames: [], nameUnits: [], lineUnits: [], factors: [], terms: [], lineReleasePounds: [], estimates: [],
  bills: [{ id: 'bb', vendor_name: 'NexPac Corporation', bill_number: 'NX9', bill_date: '2026-06-15', total_amount: 1, record_status: 'active', bill_type: 'supplier', release_number: '' }], billLines: [{ bill_id: 'bb', line_kind: 'item', description: 'Texas Seconds', qty: 1000, unit: 'lb', cost_amount: 100, commission_amount: 12.5 }] });
check('A8: with nothing set up, nothing is guessed — no unit, no basis, and a supplier line with the SAME NAME is not used as the cost until a person links it', asm2.cells[0].pounds === null && asm2.cells[0].base_cost === null && asm2.cells[0].complete === false && asm2.cells[0].flags.indexOf('unit_unknown') >= 0 && asm2.bill_names.length === 1 && asm2.invoice_names[0].unit === '');
var routeSrc = fs.readFileSync(path.join(root, 'src/app/api/accounting/profitability/route.js'), 'utf8');
check('A9 (pin): the route never writes to an invoice, a bill, inventory or the ledger — only to its own pl_ tables and the audit trail', (function () { var w = routeSrc.match(/from\('([a-z_]+)'\)\.(insert|update|upsert|delete)/g) || []; return w.length > 5 && w.every(function (x) { return /from\('pl_/.test(x); }); })(), routeSrc.match(/from\('([a-z_]+)'\)\.(insert|update|upsert|delete)/g));
check('A10 (pin): two permissions — pnl.view to see, pnl.edit_costs to change the set-up; every set-up change is audited', /assertPermission\(db, userId, 'pnl\.view'/.test(routeSrc) && /assertPermission\(db, userId, 'pnl\.edit_costs'/.test(routeSrc) && (routeSrc.match(/await audit\(db, userId, 'pl_/g) || []).length >= 9);
var uiSrc = fs.readFileSync(path.join(root, 'src/components/ProfitabilityTab.jsx'), 'utf8');
check('A11 (pin): the screen says it is NOT the cash report, shows unknown as unknown, and never uses the bg-white class the dark theme repaints', /This is NOT the cash report/.test(uiSrc) && />unknown</.test(uiSrc) && !/className="[^"]*bg-white/.test(uiSrc) && /known part only/.test(uiSrc));
var wnS = fs.readFileSync(path.join(root, 'src/components/WhatsNewWidget.jsx'), 'utf8');
check('A12 (pin): What’s New has v55.83-SY with one technical line; badge at SY or later; the menu has the new button', /version: 'v55\.83-SY'/.test(wnS) && /superAdminOnly: true/.test(wnS.substring(wnS.indexOf("version: 'v55.83-SY'"), wnS.indexOf("version: 'v55.83-SX'"))) && />v55\.83-S[Y-Z]<\/span>/.test(fs.readFileSync(path.join(root, 'src/app/page.jsx'), 'utf8')) && /\['profitability', /.test(fs.readFileSync(path.join(root, 'src/components/AccountingTab.jsx'), 'utf8')));

// ── house rules ──
var src = fs.readFileSync(path.join(root, 'src/lib/profitability.js'), 'utf8');
check('Z1 (pin): pure engine — no database, no clock, var only, no template strings', !/supabase|\.from\(|new Date\(\)|Date\.now\(\)/.test(src) && !/\b(let|const)\s/.test(src) && src.indexOf('`') < 0);

console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
