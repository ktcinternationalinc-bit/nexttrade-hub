// v55.83-MX — Sales invoices actually deduct inventory.
//
// Max (Aug 10 2026): stock sold on an invoice was not coming off the Inventory
// screen — roll count and KG both stayed put.
//
// Root cause: a sale deducts from inventory_layers, but a layer was only ever
// created when a receipt's cost was FINALIZED. The Overview showed un-finalized
// stock as on-hand anyway. So selling not-yet-costed goods found no layer,
// deducted zero, wrote a silent backorder, and booked COGS as zero.
//
// Max's two decisions that shape this fix:
//   1. "yes can sell goods before costs are finalized — costs can be later
//      entered and pnl updated"  → provisional layers + restatement on finalize
//   2. "roll counts are not roll specific. general roll counts"
//      → no per-roll picking; the roll TOTAL just has to be right
//
// These checks guard the invariants. The dangerous regressions are: layers
// going back to finalize-only (stock stops moving again), or Overview
// re-adding pending receipts on top of layers (stock doubles and every sale
// becomes invisible again).

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var sql       = read('sql/v55-83-MX-sellable-on-arrival-inventory.sql');
var page      = read('src/app/page.jsx');
var overview  = read('src/components/InventoryOverview.jsx');
var receiving = read('src/components/InventoryReceiving.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}


// ══════════════════════════════════════════════════════════════════
// PART Z — THE FOUNDATION (schema audit proved this was never run)
// ══════════════════════════════════════════════════════════════════
// Max's Aug 10 catalog audit: invoice_items was missing EVERY column that ties
// a sale to a product, and inventory_backorders didn't exist. dbInsert's
// self-healing loop stripped all 7 inventory fields per line and saved the row
// anyway, so the link was discarded silently for months. Part 1 of the
// migration must create them or nothing else in this file can work.

var ITEM_COLS = ['uses_inventory','variant_id','warehouse_id','uom','sale_quantity',
  'sale_price_per_uom','inventory_status','consumed_layers','cogs_total',
  'gross_profit','inventory_consumed_at','backorder_qty'];
ok('Z1: migration adds every missing invoice_items column',
  ITEM_COLS.every(function (c) {
    return new RegExp('ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS ' + c + '\\s').test(sql);
  }));
ok('Z2: every add is IF NOT EXISTS (safe to re-run)',
  (sql.match(/ALTER TABLE invoice_items ADD COLUMN(?! IF NOT EXISTS)/g) || []).length === 0);
ok('Z3: inventory_backorders table is created (it did not exist)',
  /CREATE TABLE IF NOT EXISTS inventory_backorders/.test(sql));
ok('Z4: inventory_backorders has RLS enabled (PERMANENT RULE 9)',
  /ALTER TABLE inventory_backorders ENABLE ROW LEVEL SECURITY/.test(sql));
ok('Z5: inventory_backorders has all four RLS policies (RULE 9)',
  /backorders_select/.test(sql) && /backorders_insert/.test(sql) &&
  /backorders_update/.test(sql) && /backorders_delete/.test(sql));
ok('Z6: Part 1 (schema) comes before Part 2 (engine) in the file',
  sql.indexOf('PART 1') < sql.indexOf('PART 2') &&
  sql.indexOf('ADD COLUMN IF NOT EXISTS uses_inventory') <
  sql.indexOf('CREATE OR REPLACE FUNCTION consume_invoice_item_inventory'));
ok('Z7: foreign keys are added defensively so a re-run cannot fail',
  /EXCEPTION WHEN duplicate_object THEN NULL/.test(sql));
ok('Z8: inventory_status is constrained to known values',
  /chk_item_inventory_status[\s\S]{0,200}'draft','consumed','reversed'/.test(sql));
ok('Z9: the app now SHOUTS when the inventory link gets stripped again',
  /STOCK NOT LINKED/.test(page) && /__strippedColumns/.test(page));
ok('Z10: that warning is an error toast, not a soft warning',
  /toast\.error\('\u26a0 STOCK NOT LINKED/.test(page));
ok('Z11: migration verification counts the restored columns',
  /Sale->product link columns now present \(need 12\)/.test(sql));

// ══════════════════════════════════════════════════════════════════
// PART A — Stock is sellable the moment it arrives (Max decision #1)
// ══════════════════════════════════════════════════════════════════

ok('A1: a layer is created on receipt arrival, not only on finalize',
  /CREATE OR REPLACE FUNCTION on_receipt_create_provisional_layer/.test(sql));
ok('A2: that trigger is actually attached to inventory_stock_receipts',
  /CREATE TRIGGER trigger_receipt_provisional_layer[\s\S]{0,200}ON inventory_stock_receipts/.test(sql));
ok('A3: it fires on INSERT and on status changes',
  /AFTER INSERT OR UPDATE OF status/.test(sql));
ok('A4: arrival layers open at cost 0 and are flagged provisional',
  /is_provisional/.test(sql) && /COALESCE\(NEW\.landed_cost_per_uom, 0\)/.test(sql));
ok('A5: non-countable receipts never create stock (cancelled/pending_detail/merged/reversed)',
  /fn_receipt_is_countable/.test(sql) &&
  /'cancelled', 'pending_detail', 'merged', 'reversed'/.test(sql));
ok('A6: the SQL status list matches the app\'s list exactly (drift guard)',
  (function () {
    var appList = read('src/lib/inventory-receipts.js')
      .match(/INVALID_RECEIPT_STATUSES = \[([^\]]+)\]/);
    if (!appList) return false;
    var names = appList[1].match(/'[a-z_]+'/g) || [];
    for (var i = 0; i < names.length; i++) {
      if (sql.indexOf(names[i]) === -1) return false;
    }
    return names.length === 4;
  })());

// ══════════════════════════════════════════════════════════════════
// PART B — Cost entered later, P&L updated (Max decision #1, part 2)
// ══════════════════════════════════════════════════════════════════

ok('B1: a restatement function exists',
  /CREATE OR REPLACE FUNCTION restate_cogs_for_layer/.test(sql));
ok('B2: finalize UPDATES the existing layer instead of skipping it',
  /THE KEY CHANGE[\s\S]{0,400}UPDATE inventory_layers[\s\S]{0,300}is_provisional = false/.test(sql));
ok('B3: finalize does NOT reset qty_remaining (goods may already be sold)',
  !/is_provisional = false,[\s\S]{0,200}qty_remaining\s*=/.test(sql));
ok('B4: finalize triggers restatement of earlier sales',
  /v_restated := restate_cogs_for_layer\(v_layer_id\)/.test(sql));
ok('B5: restatement recomputes profit, not just cost',
  /gross_profit\s+= COALESCE\(line_total, 0\) - v_new_cogs/.test(sql));
ok('B6: restatement is stamped so it can be traced',
  /cost_restated_at/.test(sql));

// ══════════════════════════════════════════════════════════════════
// PART C — Overview must not double-count (the trap this fix creates)
// ══════════════════════════════════════════════════════════════════

ok('C1: pending receipts are NO LONGER added on top of layer quantities',
  !/pending_qty \+= q;[\s\S]{0,200}s\.current_qty \+= q;/.test(overview));
ok('C2: pending is still tracked (it is a cost state, just not extra stock)',
  /s\.pending_qty \+= q;/.test(overview) && /s\.has_pending = true;/.test(overview));
ok('C3: the reason is recorded in the code so nobody re-adds it',
  /double the stock and re-hide every sale/.test(overview));
ok('C4: layers remain the source of on-hand quantity',
  /s\.current_qty \+= qty;[\s\S]{0,80}s\.finalized_qty \+= qty;/.test(overview));

// ══════════════════════════════════════════════════════════════════
// PART D — Roll counts (Max decision #2: general totals, not per-roll)
// ══════════════════════════════════════════════════════════════════

ok('D1: sold rolls come from ALL inventory lines, not only consumed ones',
  /\.eq\('uses_inventory', true\)/.test(overview));
ok('D2: the old consumed-only filter is gone (it hid rolls whenever FIFO failed)',
  !/rolls_sold'\)\.eq\('inventory_status', 'consumed'\)/.test(overview));
ok('D3: reversed lines are excluded from sold totals',
  /if \(it\.inventory_status === 'reversed'\) return;/.test(overview));
ok('D4: no per-roll picking was introduced (Max said general counts only)',
  !/roll_id/.test(page) && !/inventory_receipt_rolls/.test(page));

// ══════════════════════════════════════════════════════════════════
// PART E — Deleting gives the stock back (bug 3)
// ══════════════════════════════════════════════════════════════════

ok('E1: invoice delete calls the real reversal RPC',
  /reverse_invoice_item_inventory[\s\S]{0,200}invoice_id/.test(page) ||
  (page.indexOf("rpc('reverse_invoice_item_inventory'") > -1));
ok('E2: single line delete calls it too',
  (page.match(/rpc\('reverse_invoice_item_inventory'/g) || []).length >= 2);
ok('E3: reversal failure warns before deleting rather than failing silently',
  /Could not return stock to inventory/.test(page) &&
  /Inventory will stay short/.test(page));
ok('E4: the reversal function tolerates non-consumed lines instead of raising',
  /'not_consumed'/.test(sql) && !/RAISE EXCEPTION 'Invoice item % is not consumed/.test(sql));
ok('E5: reversal reopens layers it had closed',
  /status = CASE WHEN status = 'closed' THEN 'open' ELSE status END/.test(sql));
ok('E6: reversal removes the sale ledger row',
  /DELETE FROM inventory_movements[\s\S]{0,120}movement_type = 'sale'/.test(sql));

// ══════════════════════════════════════════════════════════════════
// PART F — Double-deduction protection (must never regress)
// ══════════════════════════════════════════════════════════════════

ok('F1: consuming an already-consumed line is a no-op',
  /IF v_item\.inventory_status = 'consumed' THEN[\s\S]{0,200}already_consumed/.test(sql));
ok('F2: layer creation is guarded against duplicates',
  /SELECT \* INTO v_layer FROM inventory_layers WHERE source_receipt_id = NEW\.id/.test(sql));
ok('F3: backfill cannot create a second layer for a receipt',
  /ON CONFLICT \(source_receipt_id\) DO NOTHING/.test(sql));
ok('F4: a receipt quantity edit only resizes a layer that has NOT been sold from',
  /v_layer\.qty_remaining = v_layer\.qty_received/.test(sql));
ok('F5: the "Add Items" panel warns that it does not deduct stock',
  /Lines added here do NOT deduct from inventory/.test(page));

// ══════════════════════════════════════════════════════════════════
// PART G — Audit trail + overselling visibility
// ══════════════════════════════════════════════════════════════════

ok('G1: a sale now writes an inventory_movements row',
  /'sale', CURRENT_DATE, v_resolved_variant/.test(sql));
ok('G2: the sale movement quantity is negative (stock going out)',
  /-v_total_consumed/.test(sql));
ok('G3: movement uom is coerced to the allowed list (receipts can say "unit")',
  /fn_safe_movement_uom/.test(sql));
ok('G4: the movement links back to its invoice line',
  /source_invoice_item_id/.test(sql));
ok('G5: the invoice picker now loads real available stock',
  /from\('inventory_layers'\)[\s\S]{0,600}setStockAvailable/.test(page) &&
  /const \[stockAvailable, setStockAvailable\] = useState\(\{\}\)/.test(page));
ok('G6: the picker warns when a product has no stock',
  /No stock on hand — selling this creates a shortage/.test(page));
ok('G7: the picker flags stock whose cost is not final',
  /cost not final yet/.test(page));

// ══════════════════════════════════════════════════════════════════
// PART H — Backfill + safety
// ══════════════════════════════════════════════════════════════════

ok('H1: existing un-costed stock gets layers (otherwise it stays undeductable)',
  /INSERT INTO inventory_layers[\s\S]{0,900}FROM inventory_stock_receipts r[\s\S]{0,300}NOT EXISTS/.test(sql));
ok('H2: the migration ends with a verification readout',
  /Countable receipts still missing a stock layer \(want 0\)/.test(sql));
ok('H3: cost can never go negative',
  /chk_layer_cost_nonneg[\s\S]{0,120}cost_per_uom >= 0/.test(sql));

// ══════════════════════════════════════════════════════════════════
// PART I — Variance panel contrast (Max: "more contrast ... much clearer")
// ══════════════════════════════════════════════════════════════════

ok('I1: variance card no longer relies on purge-prone Tailwind amber classes',
  !/bg-amber-100 text-amber-950/.test(receiving.match(/var vCardStyle[\s\S]{0,600}/)[0]));
ok('I2: colours are inline styles, which cannot be stripped by the CSS build',
  /var vCardStyle = /.test(receiving) &&
  /background: '#fef3c7', color: '#1c1917'/.test(receiving));
ok('I3: variance text is near-black on pale amber (dark-on-light, per Rule 6)',
  /color: '#1c1917'/.test(receiving));
ok('I4: balanced state is also dark-on-light',
  /background: '#dcfce7', color: '#052e16'/.test(receiving));
ok('I5: every branch has a border so the block reads as a card',
  (receiving.match(/vCardStyle = [\s\S]{0,500}?;/)[0].match(/border: '1px solid/g) || []).length === 3);
ok('I6: the old class-based variable is fully removed',
  receiving.indexOf('vCardCls') === -1);

// ══════════════════════════════════════════════════════════════════

console.log('');
if (failures.length) {
  console.log('FAILED (' + failures.length + '):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
} else {
  console.log('ALL CHECKS PASSED — v55.83-MX inventory deduction + variance contrast');
}
