// v55.83-MY — Product History "Sales" tab shows the ORDERS that took stock.
//
// Max (Aug 11 2026): "in the inventory in the sales tab when I click on one of
// the products I should also be able to see the sales that caused any
// deductions from that product. for example 2365 was an order that deducted
// from LUX-BK".
//
// Two real bugs found while building this:
//   1. The movements query ordered by 'moved_at' and the layers query by
//      'received_at'. NEITHER COLUMN EXISTS (they are movement_date and
//      receipt_date). Postgres rejects the ORDER BY, so the whole query errored
//      and the tab rendered empty even when rows existed. The error only went
//      to console.warn, so it looked like "no data" rather than "broken query".
//   2. Even when it worked, it listed inventory_movements — which carry no
//      order number and no customer — so it could never answer Max's question.
//
// The tab now reads invoice_items directly (not through movements), so a sale
// still lists even if its ledger row is missing. Everything invoiced before the
// MX migration is in exactly that state.

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var ov = read('src/components/InventoryOverview.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — The broken ORDER BY columns (silent empty-tab bug)
// ══════════════════════════════════════════════════════════════════

ok('A1: movements no longer order by the nonexistent moved_at column',
  ov.indexOf("order('moved_at'") === -1);
ok('A2: movements order by the real column, movement_date',
  /from\('inventory_movements'\)[\s\S]{0,300}order\('movement_date'/.test(ov));
ok('A3: layers no longer order by the nonexistent received_at column',
  ov.indexOf("order('received_at'") === -1);
ok('A4: layers order by the real column, receipt_date',
  /from\('inventory_layers'\)[\s\S]{0,300}order\('receipt_date'/.test(ov));
ok('A5: the reason is documented so nobody "restores" the old names',
  /does not exist on this table/.test(ov) && /renders empty even when layers exist/.test(ov));
ok('A6: movement rows read reference_number, not the nonexistent invoice_number/reference',
  /mov\.reference_number \|\| mov\.notes/.test(ov) &&
  ov.indexOf('mov.invoice_number || mov.reference') === -1);
ok('A7: movement date cell uses movement_date too (was mov.moved_at)',
  /mov\.movement_date \? String\(mov\.movement_date\)/.test(ov) &&
  ov.indexOf('mov.moved_at ?') === -1);

// ══════════════════════════════════════════════════════════════════
// PART B — The tab answers "which order took my stock"
// ══════════════════════════════════════════════════════════════════

ok('B1: sale lines are loaded from invoice_items, keyed by this product',
  /from\('invoice_items'\)[\s\S]{0,400}\.eq\('variant_id', product\.id\)/.test(ov));
ok('B2: read straight from invoice_items, NOT through movements',
  /Read straight from invoice_items rather than through movements/.test(ov));
ok('B3: invoice order number and customer are joined in',
  /from\('invoices'\)[\s\S]{0,200}order_number, customer/.test(ov));
ok('B4: the join is a batched .in() lookup, not a query per row',
  /\.in\('id', invIds\)/.test(ov));
ok('B5: the table shows an Order # column',
  />Order #<\/th>/.test(ov));
ok('B6: the table shows a Customer column',
  />Customer<\/th>/.test(ov));
ok('B7: quantity and rolls are both shown (Max tracks general roll counts)',
  />Qty<\/th>/.test(ov) && />Rolls<\/th>/.test(ov));
ok('B8: each row shows whether stock actually came off',
  /✓ deducted/.test(ov) && /⚠ not deducted/.test(ov) && /↩ returned/.test(ov));
ok('B9: shortfalls are flagged on the line',
  /short \{fmtNum\(ln\.backorder/.test(ov));

// ══════════════════════════════════════════════════════════════════
// PART C — Totals must not lie
// ══════════════════════════════════════════════════════════════════

ok('C1: a totals row exists',
  />Total sold<\/td>/.test(ov));
ok('C2: reversed lines are excluded from the qty total',
  /reduce\(function \(a, l\) \{ return a \+ \(l\.status === 'reversed' \? 0 : l\.qty\); \}, 0\)/.test(ov));
ok('C3: reversed lines are excluded from the rolls total',
  /reduce\(function \(a, l\) \{ return a \+ \(l\.status === 'reversed' \? 0 : l\.rolls\); \}, 0\)/.test(ov));
ok('C4: reversed lines are excluded from COGS and profit totals',
  (ov.match(/l\.status === 'reversed' \? 0 : \(l\.(cogs|profit) \|\| 0\)/g) || []).length === 2);
ok('C5: reversed rows are visually dimmed rather than hidden (audit trail kept)',
  /reversed \? \{ opacity: 0\.55 \} : null/.test(ov));

// ══════════════════════════════════════════════════════════════════
// PART D — Honest empty state
// ══════════════════════════════════════════════════════════════════

ok('D1: the empty state explains the pre-MX history gap instead of just "no data"',
  /those invoices were created before the/.test(ov) && /cannot be listed here/.test(ov));
ok('D2: the old bare "No outbound history found" message is gone',
  ov.indexOf('No outbound history found for this product.') === -1);
ok('D3: empty state uses dark-on-light contrast (PERMANENT RULE 8)',
  /background: '#fef3c7', color: '#1c1917'/.test(ov));

// ══════════════════════════════════════════════════════════════════
// PART E — Tab count + cost gating
// ══════════════════════════════════════════════════════════════════

ok('E1: the Sales tab counter counts SALES, not ledger rows',
  /k: 'sales', label: 'Sales \(' \+ historySaleLines\.length/.test(ov));
ok('E2: cost and profit columns stay behind the existing seeCosts permission',
  (ov.match(/\{seeCosts && <th[^>]*>COGS<\/th>\}/g) || []).length >= 1 &&
  /\{seeCosts && <th[^>]*>Profit<\/th>\}/.test(ov));
ok('E3: state is cleared when the drawer opens AND when it closes',
  (ov.match(/setHistorySaleLines\(\[\]\)/g) || []).length >= 3);
ok('E4: the raw ledger is kept as supporting detail below the orders',
  /Stock movement ledger/.test(ov));
ok('E5: negative ledger quantities render red (stock going out)',
  /q < 0 \? 'text-red-300' : 'text-emerald-300'/.test(ov));
ok('E6: the sale-lines query has its own try/catch (RULE: independent loading)',
  /catch \(e\) \{ console\.warn\('\[history\] sale lines threw:'/.test(ov));

console.log('');
if (failures.length) {
  console.log('FAILED (' + failures.length + '):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
} else {
  console.log('ALL CHECKS PASSED — v55.83-MY product history sales tab');
}
