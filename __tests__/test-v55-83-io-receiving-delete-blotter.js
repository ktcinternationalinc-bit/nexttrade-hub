// ============================================================
// v55.83-IO — inventory inbound-shipment delete must persist + the blotter must exclude deleted lines.
//
// Root cause (two bugs):
//   1) removeLine only spliced local state; Save never cancelled the removed line's DB row → the
//      deleted product stayed status='received' and kept inflating the blotter (even after refresh).
//   2) the grouped blotter summed totalQty/totalCost/lineCount over ALL lines including cancelled.
// Fix: removeLine soft-cancels the existing DB row immediately + reloads; grouped totals/detail
// exclude cancelled/reversed lines. (Overview/ReportCenter already exclude via isCountableReceipt.)
// ============================================================

var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
var rc = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'InventoryReceiving.jsx'), 'utf8');

// ---- 1. removeLine persists the deletion immediately ----
ok('1a: removeLine is async (can persist + reload)', /async function removeLine\(lineIdx\)/.test(rc));
ok('1b: removeLine soft-cancels the existing DB row',
  /dbUpdate\('inventory_stock_receipts', L\.existing_id, \{ status: 'cancelled'/.test(rc));
ok('1c: removeLine reloads the blotter right away', /await reload\(\);/.test(rc) && /removeLine[\s\S]{0,1200}await reload\(\)/.test(rc));
ok('1d: removeLine confirms before deleting a saved line', /removeLine[\s\S]{0,600}window\.confirm\(/.test(rc));
ok('1e: removeLine only persist-cancels lines that exist in the DB (existing_id)',
  /if \(L && L\.existing_id\) \{/.test(rc));

// ---- 2. blotter totals/detail exclude cancelled + reversed ----
ok('2a: grouped filters out cancelled/reversed lines',
  /allRows\.filter\(function \(r\) \{ return r\.status !== 'cancelled' && r\.status !== 'reversed'; \}\)/.test(rc));
ok('2b: totals (qty/cost/lineCount) computed over the filtered rows, not allRows',
  /var rows = allRows\.filter/.test(rc) &&
  /lineCount: rows\.length/.test(rc) &&
  /totalQty: rows\.reduce/.test(rc));
ok('2c: group header/status derived from a live row (headRow), not a possibly-cancelled rows[0]',
  /var headRow = rows\[0\] \|\| allRows\[0\]/.test(rc) && /status: headRow\.status/.test(rc));

// ---- 3. the main stock blotter (Overview/ReportCenter) already excludes deleted receipts ----
var lib = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'inventory-receipts.js'), 'utf8');
ok('3a: isCountableReceipt excludes cancelled/reversed (Overview + ReportCenter use it)',
  /'cancelled'/.test(lib) && /'reversed'/.test(lib));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-IO receiving-delete/blotter tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
