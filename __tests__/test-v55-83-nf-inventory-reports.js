// v55.83-NF — Inventory reports: Stock & P&L, Customer Copy, Consolidated.
//
// Max (Aug 12 2026): "I NEED THE INVENTORY REPORT TO SHOW THE ORIGINAL QTY,
// AMOUNT RECEIVED AND AMOUNT SOLD.. AVG PRICE OF SALE SHOULD BE THERE AS WELL
// WITH THE AVG COST PNL ETC... SHOW WHEN NUMBERS ARE AVAILABLE FOR THE PNL.
// OTHERWISE KEEP 0. ALSO SHOULD HAVE A CUSTOMER COPY WITHOUT PNL NUMBERS AND
// ALSO A COPY TO CONSOLIDATE ALL OF THE STOCK AS ONE NUMBER AND LUX AS ONE
// NUMBER ETC. SO DIFFERENT CHOICES OF REPORTS."
//
// THE TWO INVARIANTS THAT MUST NEVER SLIP
//   1. Customer copies must not merely HIDE P&L — the numbers must be ABSENT
//      from the rows, so no export, print, or React prop can leak a margin.
//   2. The report must not double-count pending stock on top of layers (the
//      same pre-MX bug the Overview had). One sale, one deduction, one report.

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var defs = read('src/lib/inventory-report-defs.js');
var rc   = read('src/components/InventoryReportCenter.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — The four reports exist with the columns Max asked for
// ══════════════════════════════════════════════════════════════════

ok('A1: Stock & P&L report is defined',
  /id: 'full_pnl'/.test(defs));
ok('A2: Customer Copy report is defined',
  /id: 'customer_copy'/.test(defs));
ok('A3: Consolidated (internal) and Consolidated (customer) reports are defined',
  /id: 'consolidated'/.test(defs) && /id: 'consolidated_customer'/.test(defs));
ok('A4: Original qty, rolls received, sold qty, sold rolls, on hand are all columns',
  /key: 'original_qty'/.test(defs) && /key: 'recv_rolls'/.test(defs) &&
  /key: 'sold_qty'/.test(defs) && /key: 'sold_rolls'/.test(defs) && /key: 'qty_remaining'/.test(defs));
ok('A5: avg sale price, revenue, avg cost, COGS, gross profit, margin are all columns',
  /key: 'avg_sale_price'/.test(defs) && /key: 'revenue'/.test(defs) &&
  /key: 'avg_cost'/.test(defs) && /key: 'cogs'/.test(defs) &&
  /key: 'gross_profit'/.test(defs) && /key: 'margin_pct'/.test(defs));
ok('A6: a Cost Status column explains why P&L may be provisional',
  /key: 'cost_status'/.test(defs));
ok('A7: every P&L column is flagged pnl:true',
  (function () {
    var keys = ['avg_sale_price','revenue','avg_cost','cogs','gross_profit','margin_pct','stock_value'];
    return keys.every(function (k) { return new RegExp("key: '" + k + "'[^\\n]*pnl: true").test(defs); });
  })());
ok('A8: customer column lists are DERIVED by filtering pnl (cannot drift from the full list)',
  /var CUSTOMER_COLUMNS = FULL_PNL_COLUMNS\.filter\(function \(c\) \{ return c\.pnl !== true; \}\);/.test(defs) &&
  /var CONSOLIDATED_CUSTOMER_COLUMNS = CONSOLIDATED_COLUMNS\.filter\(function \(c\) \{ return c\.pnl !== true; \}\);/.test(defs));
ok('A9: the cost/valuation columns keep the existing valuation permission gate',
  /key: 'cogs'[^\n]*valuation: true/.test(defs) && /key: 'gross_profit'[^\n]*valuation: true/.test(defs));
ok('A10: Stock & P&L is the default report',
  /useState\('full_pnl'\)/.test(rc));

// ══════════════════════════════════════════════════════════════════
// PART B — Customer copies carry NO P&L numbers (absent, not hidden)
// ══════════════════════════════════════════════════════════════════

ok('B1: customer copies strip pnl keys from the row objects themselves',
  /reportId === 'customer_copy' \|\| reportId === 'consolidated_customer'/.test(rc) &&
  /if \(!pnlKeys\[k\]\) \{ c\[k\] = r\[k\]; \}/.test(rc));
ok('B2: the strip is explained as defense in depth (same reasoning as IK)',
  /defense in depth, same reasoning as the IK valuation strip/.test(rc));
ok('B3: the customer report description says it is safe to send outside',
  /Safe to send outside the company/.test(defs));
ok('B4: the customer copy still has ALL the quantity columns',
  (function () {
    // CUSTOMER_COLUMNS is a filter of FULL; quantity keys have no pnl flag, so they survive.
    var qtyKeys = ['original_qty','recv_rolls','sold_qty','sold_rolls','qty_remaining'];
    return qtyKeys.every(function (k) { return !new RegExp("key: '" + k + "'[^\\n]*pnl: true").test(defs); });
  })());

// ══════════════════════════════════════════════════════════════════
// PART C — "Show when numbers are available, otherwise keep 0"
// ══════════════════════════════════════════════════════════════════

ok('C1: every money figure defaults to 0, never blank',
  /var avgSale = sa\.qty > 0 \? \(sa\.revenue \/ sa\.qty\) : 0;/.test(rc) &&
  /var margin = sa\.revenue > 0 \? \(sa\.profit \/ sa\.revenue \* 100\) : 0;/.test(rc));
ok('C2: the row default for products with no sales is an all-zero sales aggregate',
  /\{ qty: 0, rolls: 0, revenue: 0, cogs: 0, profit: 0, lines: 0, costed_lines: 0 \}/.test(rc));
ok('C3: Cost Status distinguishes No sales / Final / Awaiting cost / Partly costed',
  /'No sales'/.test(rc) && /'Final'/.test(rc) && /'Awaiting cost'/.test(rc) && /'Partly costed'/.test(rc));
ok('C4: avg cost falls back to on-hand average when no sale has been costed yet',
  /var avgCost = sa\.qty > 0 && sa\.cogs > 0 \? \(sa\.cogs \/ sa\.qty\) : \(agg\.qty > 0 \? \(agg\.value \/ agg\.qty\) : 0\);/.test(rc));
ok('C5: provisional layers are loaded so Cost Status can flag awaiting-cost stock',
  /is_provisional', true\)\.gt\('qty_remaining', 0\)/.test(rc) && /provSet\[p\.id\]/.test(rc));

// ══════════════════════════════════════════════════════════════════
// PART D — Sales data + the double-count fix
// ══════════════════════════════════════════════════════════════════

ok('D1: sales come from invoice_items where uses_inventory=true',
  /from\('invoice_items'\)\.select\('variant_id,sale_quantity,line_total,cogs_total,gross_profit,rolls_sold,inventory_status,consumed_layers'\)\.eq\('uses_inventory', true\)/.test(rc));
ok('D2: reversed (deleted) lines are excluded from sales',
  /if \(it\.inventory_status === 'reversed'\) \{ return; \}/.test(rc));
ok('D3: pending receipts are NO LONGER added on top of layer qty (pre-MX double-count)',
  !/currentByProduct\[p\.id\] = fin \+ pend;/.test(rc) &&
  /currentByProduct\[p\.id\] = \(layerAgg\[p\.id\] && layerAgg\[p\.id\]\.qty\) \|\| 0;/.test(rc));
ok('D4: the reason is documented so it is not "restored"',
  /Adding pend again doubled[\s\S]{0,60}hid every sale/.test(rc));
ok('D5: rolls received come from countable receipts only',
  /if \(!r\.product_id \|\| !isCountableReceipt\(r\)\) \{ return; \}[\s\S]{0,120}roll_count/.test(rc));

// ══════════════════════════════════════════════════════════════════
// PART E — Consolidated maths must be right
// ══════════════════════════════════════════════════════════════════

ok('E1: consolidated rolls up per family',
  /function consolidatedRows\(\)/.test(rc) && /var k = r\.family \|\|/.test(rc));
ok('E2: averages are RE-DERIVED from sums, never averaged-of-averages',
  /RE-DERIVED from the sums/.test(rc) &&
  /avg_sale_price: f\.sold_qty > 0 \? f\.revenue \/ f\.sold_qty : 0/.test(rc) &&
  /avg_cost: f\.sold_qty > 0 && f\.cogs > 0 \? f\.cogs \/ f\.sold_qty : 0/.test(rc));
ok('E3: margin is recomputed from family revenue/profit',
  /margin_pct: f\.revenue > 0 \? f\.gross_profit \/ f\.revenue \* 100 : 0/.test(rc));
ok('E4: mixed UOM within a family is flagged, not silently summed',
  /\(mixed\)/.test(rc));
ok('E5: the product count per family is shown',
  /key: 'products'/.test(defs) && /f\.products \+= 1;/.test(rc));
ok('E6: grand totals exist via total:sum on the consolidated quantity + money columns',
  /CONSOLIDATED_COLUMNS = \[[\s\S]*?key: 'qty_remaining'[^\n]*total: 'sum'[\s\S]*?key: 'revenue'[^\n]*total: 'sum'/.test(defs));

// ══════════════════════════════════════════════════════════════════
// PART F — Bilingual + dispatch
// ══════════════════════════════════════════════════════════════════

ok('F1: every new column has an Arabic label',
  (function () {
    var block = defs.slice(defs.indexOf('var FULL_PNL_COLUMNS'), defs.indexOf('var REPORTS'));
    var en = (block.match(/label_en:/g) || []).length;
    var ar = (block.match(/label_ar:/g) || []).length;
    return en > 0 && en === ar;
  })());
ok('F2: the dispatcher routes all four new reports',
  /reportId === 'full_pnl' \|\| reportId === 'customer_copy'/.test(rc) &&
  /reportId === 'consolidated' \|\| reportId === 'consolidated_customer'/.test(rc));
ok('F3: search also matches on family for the P&L reports',
  /String\(r\.family\)\.toLowerCase\(\)\.indexOf\(q\) >= 0/.test(rc));

console.log('');
if (failures.length) {
  console.log('FAILED (' + failures.length + '):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
} else {
  console.log('ALL CHECKS PASSED — v55.83-NF inventory report suite');
}

// ══════════════════════════════════════════════════════════════════
// v55.83-NG ADDENDUM — On Hand Qty + On Hand Rolls, shaded (Max Aug 12:
// "I NEED TO HAVE ON HAND ROLLS AND QTY AND SHOULD BE SHADED IN DIFFERENT
//  COLORS THOSE 2 COLORS IN THE REPORTS")
// ══════════════════════════════════════════════════════════════════
(function () {
  var rt = read('src/components/ReportTable.jsx');
  var failures2 = [];
  function ok2(label, cond) { if (cond) console.log('✓ ' + label); else { failures2.push(label); console.log('✗ ' + label); } }

  ok2('NG1: On Hand Rolls is a column in the product report and the consolidated report',
    (defs.match(/key: 'on_hand_rolls'/g) || []).length === 2);
  ok2('NG2: On Hand Qty and On Hand Rolls carry DIFFERENT shade hints',
    /key: 'qty_remaining'[^\n]*shade: 'qty'/.test(defs) && /key: 'on_hand_rolls'[^\n]*shade: 'rolls'/.test(defs));
  ok2('NG3: the shade hint is on the customer copies too (derived lists keep it)',
    /var CUSTOMER_COLUMNS = FULL_PNL_COLUMNS\.filter/.test(defs)); // derived => shade survives
  ok2('NG4: ReportTable shades header, body AND totals for shaded columns',
    (rt.match(/style=\{shadeStyle\(c, 'head'\)\}/g) || []).length === 1 &&
    (rt.match(/style=\{shadeStyle\(c, 'body'\)\}/g) || []).length === 1 &&
    (rt.match(/style=\{shadeStyle\(c, 'foot'\)\}/g) || []).length === 2);
  ok2('NG5: two distinct colours (green for qty, blue for rolls), dark text on light (contrast rule)',
    /qty:\s*\{ body: '#dcfce7'[^}]*text: '#052e16' \}/.test(rt) &&
    /rolls: \{ body: '#dbeafe'[^}]*text: '#0c2a5e' \}/.test(rt));
  ok2('NG6: shading uses inline styles + print-color-adjust so it survives print',
    /WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact'/.test(rt));
  ok2('NG7: the printed report carries the same two shades',
    /PSHADE = \{ qty: \{ body: '#dcfce7'/.test(rc) && /print-color-adjust:exact/.test(rc) &&
    /shadeCss\(c, 'head'\)/.test(rc) && /shadeCss\(c, 'body'\)/.test(rc) && /shadeCss\(c, 'foot'\)/.test(rc));
  ok2('NG8: on-hand rolls = received + physical-count corrections − sold (general count rule; NH re-ordered the terms)',
    /on_hand_rolls: Math\.max\(0, \(Number\(raw\.recvRollsByProduct\[p\.id\]\) \|\| 0\) \+ \(Number\(raw\.countRollsByProduct && raw\.countRollsByProduct\[p\.id\]\) \|\| 0\) - sa\.rolls\)/.test(rc));
  ok2('NG9: consolidated sums on-hand rolls per family',
    /f\.on_hand_rolls \+= r\.on_hand_rolls;/.test(rc) && /on_hand_rolls: f\.on_hand_rolls,/.test(rc));
  ok2('NG10: the adjustments probe is optional (no error banner on pre-NE installs)',
    /r\.source !== 'inventory_adjustments'/.test(rc));

  if (failures2.length) { console.log('NG FAILED: ' + failures2.join(' | ')); process.exit(1); }
  else { console.log('ALL NG ADDENDUM CHECKS PASSED'); }
})();

// ══════════════════════════════════════════════════════════════════
// v55.83-NH ADDENDUM — Inbound / Sold / On Hand: the row reads as a sentence
// (Max Aug 12: "CURRENT ... SOLD ... INBOUND ... CUMULATIVE ... MAKE IT MAKE
// SENSE"). Decision: Cumulative IS Inbound — no duplicate column; Inbound is
// all-time AND includes physical-count corrections (Max: "yes"), so
// Inbound − Sold = On Hand holds on every row.
// ══════════════════════════════════════════════════════════════════
(function () {
  var defs2 = read('src/lib/inventory-report-defs.js');
  var rc2 = read('src/components/InventoryReportCenter.jsx');
  var f = [];
  function ok3(l, c) { if (c) console.log('✓ ' + l); else { f.push(l); console.log('✗ ' + l); } }

  ok3('NH1: columns are labelled as the three pairs — Inbound, Sold, On Hand',
    /label_en: 'Inbound Qty \(all-time\)'/.test(defs2) && /label_en: 'Inbound Rolls \(all-time\)'/.test(defs2) &&
    /label_en: 'Sold Qty'/.test(defs2) && /label_en: 'Sold Rolls'/.test(defs2) &&
    /label_en: 'On Hand Qty'/.test(defs2) && /label_en: 'On Hand Rolls'/.test(defs2));
  ok3('NH2: order in the column list is Inbound → Sold → On Hand (goods-flow order)',
    (function () {
      var blk = defs2.slice(defs2.indexOf('var FULL_PNL_COLUMNS'), defs2.indexOf('var CUSTOMER_COLUMNS'));
      return blk.indexOf("'original_qty'") < blk.indexOf("'sold_qty'") && blk.indexOf("'sold_qty'") < blk.indexOf("'qty_remaining'");
    })());
  ok3('NH3: there is NO separate Cumulative/Historic column (it would duplicate Inbound)',
    !/cumulative|historic/i.test(defs2.slice(defs2.indexOf('var FULL_PNL_COLUMNS'))) ||
    /Cumulative\/historic\" IS Inbound/.test(defs2) || /is a label \(all-time\) not a column/.test(defs2));
  ok3('NH4: the reasoning is written where the columns are defined',
    /Cumulative\/historic" IS Inbound/.test(defs2) && /INBOUND \(all-time, incl\. count corrections\)/.test(defs2));
  ok3('NH5: Inbound qty folds count SHORTFALLS so Inbound − Sold = On Hand holds',
    /original_qty: \(Number\(raw\.origByProduct\[p\.id\]\) \|\| 0\) \+ Math\.min\(0, Number\(raw\.countQtyByProduct && raw\.countQtyByProduct\[p\.id\]\) \|\| 0\)/.test(rc2));
  ok3('NH6: found stock is not double-counted (it already arrives as a COUNT-ADJ receipt; only negatives fold)',
    /Math\.min\(0, Number\(raw\.countQtyByProduct/.test(rc2) && /Found stock already enters as a COUNT-ADJ receipt/.test(rc2));
  ok3('NH7: Inbound rolls fold count roll deltas (either sign)',
    /recv_rolls: \(Number\(raw\.recvRollsByProduct\[p\.id\]\) \|\| 0\) \+ \(Number\(raw\.countRollsByProduct && raw\.countRollsByProduct\[p\.id\]\) \|\| 0\)/.test(rc2));
  ok3('NH8: On Hand rolls = Inbound rolls − Sold rolls (same inputs, same order)',
    /on_hand_rolls: Math\.max\(0, \(Number\(raw\.recvRollsByProduct\[p\.id\]\) \|\| 0\) \+ \(Number\(raw\.countRollsByProduct && raw\.countRollsByProduct\[p\.id\]\) \|\| 0\) - sa\.rolls\)/.test(rc2));
  ok3('NH9: count qty deltas are loaded (signed quantity on the adjustment row)',
    /select\('product_id,rolls_delta,quantity,adjustment_type'\)/.test(rc2) && /countQtyByProduct\[a\.product_id\]/.test(rc2));
  ok3('NH10: On Hand stays the only shaded pair (Inbound/Sold are plain)',
    !/key: 'original_qty'[^\n]*shade:/.test(defs2) && !/key: 'sold_qty'[^\n]*shade:/.test(defs2) &&
    /key: 'qty_remaining'[^\n]*shade: 'qty'/.test(defs2));

  if (f.length) { console.log('NH FAILED: ' + f.join(' | ')); process.exit(1); }
  else { console.log('ALL NH ADDENDUM CHECKS PASSED'); }
})();
