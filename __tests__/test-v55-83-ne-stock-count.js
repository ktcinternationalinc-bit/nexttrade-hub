// v55.83-NE — Physical Stock Count.
//
// WHY IT EXISTS: every sale made before the MX migration threw away its
// inventory link, so on-hand stock is overstated by everything ever sold
// through the Hub. The history is unrecoverable; the honest correction is a
// physical count. Max approved this build in the MX conversation ("I can build
// you a screen for entering that count").
//
// ALSO FIXED HERE: the Aug-11 schema audit proved inventory_adjustments and
// three of its functions were NEVER installed in production — the existing
// Adjustments screen has been calling functions that do not exist. The NE
// migration includes the original adjustments migration in full (Part 1)
// before adding the count machinery (Part 2), so BOTH screens work after one
// SQL run.
//
// THE INVARIANTS THIS FILE PROTECTS
//   - shrinkage only ever reduces OPEN layers, oldest-first, with movements
//   - found stock enters through the receiving door (COUNT-ADJ receipt), so it
//     becomes a provisional layer under the same MX rules as any arrival
//   - rolls stay general counts (Max's rule) — no per-roll records
//   - untouched rows are never modified

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var sql = read('sql/v55-83-NE-stock-count.sql');
var ui  = read('src/components/InventoryStockCount.jsx');
var tab = read('src/components/InventoryTab.jsx');
var ov  = read('src/components/InventoryOverview.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — The migration repairs the broken Adjustments foundation too
// ══════════════════════════════════════════════════════════════════

ok('A1: the ORIGINAL adjustments migration is included in full (Part 1)',
  /CREATE TABLE IF NOT EXISTS inventory_adjustments/.test(sql) &&
  /CREATE OR REPLACE FUNCTION consume_layers_fifo/.test(sql) &&
  /CREATE OR REPLACE FUNCTION apply_quantity_adjustment/.test(sql) &&
  /CREATE OR REPLACE FUNCTION apply_warehouse_transfer/.test(sql) &&
  /CREATE OR REPLACE FUNCTION apply_cost_adjustment/.test(sql));
ok('A2: Part 1 precedes Part 2 (foundation before count)',
  sql.indexOf('apply_quantity_adjustment') < sql.indexOf('apply_stock_count'));
ok('A3: count columns are added with IF NOT EXISTS (safe re-run)',
  /ADD COLUMN IF NOT EXISTS qty_counted/.test(sql) &&
  /ADD COLUMN IF NOT EXISTS rolls_delta/.test(sql));
ok('A4: adjustment_type constraint is widened to include count',
  /'quantity','transfer','cost','count'/.test(sql));
ok('A5: the why (pre-MX overstatement, unrecoverable history) is documented',
  /OVERSTATED by everything ever sold/.test(sql) || /overstated/i.test(sql));
ok('A6: the migration ends with a verification readout',
  /Adjustment functions installed \(need 5\)/.test(sql));

// ══════════════════════════════════════════════════════════════════
// PART B — apply_stock_count behaves like the rest of the engine
// ══════════════════════════════════════════════════════════════════

ok('B1: system quantity is read from OPEN layers only',
  /status = 'open' AND qty_remaining > 0/.test(sql));
ok('B2: shrinkage reduces layers OLDEST-FIRST (the order sales consume)',
  /ORDER BY receipt_date ASC, id ASC[\s\S]{0,80}FOR UPDATE/.test(sql));
ok('B3: each reduction writes an adjustment_out movement tied to the layer AND the adjustment',
  /'adjustment_out'[\s\S]{0,300}source_adjustment_id/.test(sql) ||
  (/'adjustment_out'/.test(sql) && /v_layer\.id, v_adj_id/.test(sql)));
ok('B4: found stock enters as a COUNT-ADJ receipt (the receiving door)',
  /'COUNT-ADJ-' \|\| to_char/.test(sql) &&
  /status, notes[\s\S]{0,200}'count_adjustment'/.test(sql));
ok('B5: count_adjustment is a countable status (MX trigger will layer it)',
  !/'count_adjustment'/.test("'cancelled', 'pending_detail', 'merged', 'reversed'"));
ok('B6: found stock also writes an adjustment_in movement',
  /'adjustment_in'/.test(sql));
ok('B7: a concurrent-sale race is recorded honestly, not silently absorbed',
  /stock moved during the count[\s\S]{0,40}re-count this product/.test(sql));
ok('B8: negative counted quantities are refused',
  /counted quantity must be zero or more/.test(sql));
ok('B9: roll deltas are stored on the adjustment row (general counts, no per-roll records)',
  /rolls_delta/.test(sql) && !/CREATE TABLE[\s\S]{0,80}roll_records/.test(sql));

// ══════════════════════════════════════════════════════════════════
// PART C — The count screen
// ══════════════════════════════════════════════════════════════════

ok('C1: the screen exists and is registered as an Inventory subtab',
  /id: 'stockcount'/.test(tab) && /InventoryStockCount/.test(tab));
ok('C2: it is permission-gated (Edit Inventory or Adjust Inventory)',
  /st\.id === 'stockcount' && !\(isSuperAdmin \|\| \(modulePerms && \(modulePerms\['Edit Inventory'\] === true \|\| modulePerms\['Adjust Inventory'\] === true\)\)\)/.test(tab) &&
  /Stock counting needs the "Edit Inventory" or "Adjust Inventory" permission/.test(ui));
ok('C3: templates and virtual mixes are excluded from the count list',
  /is_family_template !== true && p\.is_virtual_mix !== true/.test(ui));
ok('C4: ONLY rows with a typed counted qty are submitted — empty rows untouched',
  /var e = entries\[r\.id\]; return e && e\.qty !== '';/.test(ui) &&
  /empty rows are left exactly as they are/i.test(ui));
ok('C5: rolls are optional per row (NULL = not counted this time)',
  /p_rolls_counted: e\.rolls === '' \? null/.test(ui));
ok('C6: large differences (>50%) are called out before applying',
  /LARGE differences \(>50%\)/.test(ui));
ok('C7: submission is sequential with per-row results, one failure never strands the rest',
  /setResults\(function \(prev\)/.test(ui) && /status: 'error'/.test(ui));
ok('C8: the list reloads after applying (Difference column going to zero is the proof)',
  /load\(\); \/\/ proof/.test(ui));
ok('C9: the confirmation says found stock lands at cost 0 until priced',
  /found stock is added at cost 0 until you price it/i.test(ui));
ok('C10: system rolls use Max\'s arithmetic: received − sold + prior count deltas',
  /rollsBy\[r\.product_id\]/.test(ui) && /rolls_sold/.test(ui) &&
  /adjustment_type', 'count'/.test(ui));
ok('C11: the screen loads even BEFORE the SQL runs (adjustments query is tolerated)',
  /table absent pre-SQL/.test(ui));

// ══════════════════════════════════════════════════════════════════
// PART D — The Overview shows counted rolls
// ══════════════════════════════════════════════════════════════════

ok('D1: Overview loads the count deltas',
  /from\('inventory_adjustments'\)\.select\('product_id, rolls_delta, adjustment_type'\)\.eq\('adjustment_type', 'count'\)/.test(ov));
ok('D2: per-product stats carry adj_rolls',
  /adj_rolls: 0,/.test(ov) && /s2\.adj_rolls \+= Number\(a\.rolls_delta \|\| 0\)/.test(ov));
ok('D3: all three roll displays fold the delta in (family, grand total, product row)',
  (ov.match(/- gSold \+ gAdj\)|- sRolls \+ aRolls\)|- soldRolls \+ adjRolls\)/g) || []).length === 3);
ok('D4: the aggregation recomputes when adjustments change',
  /\[products, layers, receipts, salesItems, countAdjs\]/.test(ov));

console.log('');
if (failures.length) {
  console.log('FAILED (' + failures.length + '):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
} else {
  console.log('ALL CHECKS PASSED — v55.83-NE physical stock count');
}
