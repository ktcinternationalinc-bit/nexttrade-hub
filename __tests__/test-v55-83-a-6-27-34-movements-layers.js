// v55.83-A.6.27.34 — Inventory Phase 1 Build 4.3: Movements + FIFO Cost Layers
//
// Two new tables (inventory_movements, inventory_layers) + a Postgres trigger
// that auto-creates a movement + layer when a receipt is finalized. Two new
// read-only sub-tab components. Wires into InventoryTab.

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var mv  = read('src/components/InventoryMovementsLedger.jsx');
var cl  = read('src/components/InventoryCostLayers.jsx');
var inv = read('src/components/InventoryTab.jsx');
var sql = read('sql/v55-83-a-6-27-34-inventory-movements-layers.sql');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — SQL: inventory_movements table
// ══════════════════════════════════════════════════════════════════
ok('A1: inventory_movements table created',
  /CREATE TABLE IF NOT EXISTS inventory_movements/.test(sql));
ok('A2: id PK uuid with default',
  /id\s+uuid PRIMARY KEY DEFAULT gen_random_uuid\(\)/.test(sql));
ok('A3: movement_type NOT NULL with CHECK on 7 valid values',
  /CONSTRAINT chk_movement_type CHECK \(movement_type IN \([\s\S]{0,500}'receipt'[\s\S]{0,500}'sale'[\s\S]{0,500}'transfer_in'[\s\S]{0,500}'transfer_out'[\s\S]{0,500}'adjustment_in'[\s\S]{0,500}'adjustment_out'[\s\S]{0,500}'reversal'/.test(sql));
ok('A4: product_id FK to inventory_products with ON DELETE RESTRICT',
  /product_id\s+uuid NOT NULL REFERENCES inventory_products\(id\) ON DELETE RESTRICT/.test(sql));
ok('A5: warehouse_id FK to inv_warehouses',
  /warehouse_id\s+uuid REFERENCES inv_warehouses\(id\) ON DELETE RESTRICT/.test(sql));
ok('A6: quantity NOT NULL (signed)',
  /quantity\s+numeric NOT NULL/.test(sql));
ok('A7: source_receipt_id FK with ON DELETE SET NULL',
  /source_receipt_id\s+uuid REFERENCES inventory_stock_receipts\(id\) ON DELETE SET NULL/.test(sql));
ok('A8: source_layer_id FK added post-creation via DO block',
  /ALTER TABLE inventory_movements\s+ADD CONSTRAINT fk_movements_source_layer\s+FOREIGN KEY \(source_layer_id\) REFERENCES inventory_layers\(id\)/.test(sql));
ok('A9: chk_movement_uom constraint',
  /chk_movement_uom CHECK \(uom IS NULL OR uom IN \('kg','meter','yard','roll','piece','liter','sqm'\)\)/.test(sql));
ok('A10: chk_movement_cost_currency constraint',
  /chk_movement_cost_currency CHECK \(cost_currency IS NULL OR cost_currency IN \('EGP','USD','EUR'\)\)/.test(sql));
ok('A11: 6 indexes on movements (product/warehouse/date/type/receipt/product+wh)',
  /idx_movements_product\b/.test(sql) && /idx_movements_warehouse\b/.test(sql) &&
  /idx_movements_date\b/.test(sql) && /idx_movements_type\b/.test(sql) &&
  /idx_movements_receipt\b/.test(sql) && /idx_movements_product_wh\b/.test(sql));
ok('A12: RLS enabled on movements with read+write policies',
  /ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY/.test(sql) &&
  /CREATE POLICY inv_movements_read  ON inventory_movements FOR SELECT/.test(sql) &&
  /CREATE POLICY inv_movements_write ON inventory_movements FOR ALL/.test(sql));

// ══════════════════════════════════════════════════════════════════
// PART B — SQL: inventory_layers table
// ══════════════════════════════════════════════════════════════════
ok('B1: inventory_layers table created',
  /CREATE TABLE IF NOT EXISTS inventory_layers/.test(sql));
ok('B2: source_receipt_id UNIQUE FK (one layer per receipt max)',
  /source_receipt_id\s+uuid NOT NULL UNIQUE REFERENCES inventory_stock_receipts\(id\) ON DELETE RESTRICT/.test(sql));
ok('B3: product_id FK with RESTRICT',
  /product_id\s+uuid NOT NULL REFERENCES inventory_products\(id\) ON DELETE RESTRICT/.test(sql));
ok('B4: qty_received CHECK > 0',
  /qty_received\s+numeric NOT NULL CHECK \(qty_received > 0\)/.test(sql));
ok('B5: qty_remaining + CHECK constraints (>=0 and <= qty_received)',
  /qty_remaining\s+numeric NOT NULL/.test(sql) &&
  /chk_qty_remaining_nonneg CHECK \(qty_remaining >= 0\)/.test(sql) &&
  /chk_qty_remaining_lte_received CHECK \(qty_remaining <= qty_received\)/.test(sql));
ok('B6: cost_per_uom NOT NULL (frozen at finalization)',
  /cost_per_uom\s+numeric NOT NULL/.test(sql));
ok('B7: status CHECK (open/closed/reversed)',
  /chk_layer_status CHECK \(status IN \('open','closed','reversed'\)\)/.test(sql));
ok('B8: chk_layer_uom + chk_layer_cost_currency constraints',
  /chk_layer_uom CHECK \(uom IS NULL OR uom IN \('kg','meter','yard','roll','piece','liter','sqm'\)\)/.test(sql) &&
  /chk_layer_cost_currency CHECK \(cost_currency IS NULL OR cost_currency IN \('EGP','USD','EUR'\)\)/.test(sql));
ok('B9: updated_at trigger',
  /CREATE OR REPLACE FUNCTION update_inventory_layers_updated_at/.test(sql) &&
  /CREATE TRIGGER trigger_layers_updated_at/.test(sql));
ok('B10: 5 indexes including partial idx for open-by-product FIFO lookup',
  /idx_layers_product\b/.test(sql) && /idx_layers_warehouse\b/.test(sql) &&
  /idx_layers_status\b/.test(sql) && /idx_layers_receipt_number\b/.test(sql) &&
  /idx_layers_open_by_product\s+ON inventory_layers \(product_id, warehouse_id, receipt_date\) WHERE status = 'open' AND qty_remaining > 0/.test(sql));
ok('B11: RLS enabled on layers',
  /ALTER TABLE inventory_layers ENABLE ROW LEVEL SECURITY/.test(sql));

// ══════════════════════════════════════════════════════════════════
// PART C — SQL: trigger that auto-creates ledger entries on finalize
// ══════════════════════════════════════════════════════════════════
ok('C1: trigger function on_receipt_finalize_create_ledger defined',
  /CREATE OR REPLACE FUNCTION on_receipt_finalize_create_ledger\(\)/.test(sql));
ok('C2: trigger fires AFTER UPDATE on inventory_stock_receipts',
  /CREATE TRIGGER trigger_receipt_finalize_ledger\s+AFTER UPDATE ON inventory_stock_receipts/.test(sql));
ok('C3: trigger only fires on status transition to "finalized"',
  /IF NEW\.status = 'finalized'\s+AND \(OLD\.status IS NULL OR OLD\.status != 'finalized'\)/.test(sql));
ok('C4: trigger requires landed_cost_per_uom IS NOT NULL',
  /AND NEW\.landed_cost_per_uom IS NOT NULL/.test(sql));
ok('C5: trigger idempotent — checks for existing layer by source_receipt_id',
  /SELECT id INTO v_existing_layer_id FROM inventory_layers WHERE source_receipt_id = NEW\.id/.test(sql));
ok('C6: trigger inserts layer with qty_remaining = qty_received (NEW.quantity)',
  /INSERT INTO inventory_layers[\s\S]{0,800}NEW\.quantity, NEW\.quantity,/.test(sql));
ok('C7: trigger inserts movement row only if no existing receipt-type movement for this receipt',
  /IF NOT EXISTS \(\s+SELECT 1 FROM inventory_movements\s+WHERE source_receipt_id = NEW\.id AND movement_type = 'receipt'/.test(sql));
ok('C8: trigger handles cancellation (finalized → cancelled) by inserting reversal',
  /IF NEW\.status = 'cancelled' AND OLD\.status = 'finalized'/.test(sql) &&
  /'reversal', CURRENT_DATE/.test(sql));
ok('C9: cancelled trigger marks layer status as reversed (preserves audit)',
  /UPDATE inventory_layers SET status = 'reversed' WHERE source_receipt_id = NEW\.id/.test(sql));
ok('C10: backfill DO block handles pre-existing finalized receipts',
  /FOR r IN\s+SELECT \* FROM inventory_stock_receipts\s+WHERE status = 'finalized'[\s\S]{0,300}NOT EXISTS \(SELECT 1 FROM inventory_layers WHERE source_receipt_id/.test(sql));

// ══════════════════════════════════════════════════════════════════
// PART D — InventoryMovementsLedger component
// ══════════════════════════════════════════════════════════════════
ok('D1: component default exported',
  /export default function InventoryMovementsLedger/.test(mv));
ok('D2: imports canSeeInventoryCosts from inventory-permissions',
  /import \{ canSeeInventoryCosts \} from '\.\.\/lib\/inventory-permissions'/.test(mv));
ok('D3: canView gate (Inventory OR Edit Inventory OR super_admin)',
  /var canView = isSuperAdmin \|\| modulePerms\['Inventory'\] === true \|\| modulePerms\['Edit Inventory'\] === true/.test(mv));
ok('D4: seeCosts via canSeeInventoryCosts',
  /var seeCosts = canSeeInventoryCosts\(userProfile, modulePerms\)/.test(mv));
ok('D5: loads movements + products + warehouses in parallel',
  /Promise\.all\(\[\s+supabase\.from\('inventory_movements'\)[\s\S]{0,400}supabase\.from\('inventory_products'\)[\s\S]{0,300}supabase\.from\('inv_warehouses'\)/.test(mv));
ok('D6: movements query orders by created_at DESC with limit 1000',
  /\.order\('created_at', \{ ascending: false \}\)\.limit\(1000\)/.test(mv));
ok('D7: MOVEMENT_LABELS map with color-coded badges for 7 types',
  /var MOVEMENT_LABELS = \{[\s\S]{0,1000}receipt: \{ label: 'Receipt In', color: 'bg-emerald[\s\S]{0,1000}sale:[\s\S]{0,1000}transfer_in:[\s\S]{0,1000}transfer_out:[\s\S]{0,1000}adjustment_in:[\s\S]{0,1000}adjustment_out:[\s\S]{0,1000}reversal:/.test(mv));
ok('D8: filter bar: search + product + warehouse + type + date from/to',
  /filterProduct[\s\S]{0,2000}filterWarehouse[\s\S]{0,2000}filterType[\s\S]{0,2000}filterFrom[\s\S]{0,500}filterTo/.test(mv));
ok('D9: signed quantity colored rose for out, emerald for in',
  /var isOut = Number\(m\.quantity\) < 0/.test(mv) &&
  /\(isOut \? 'text-rose-700' : 'text-emerald-700'\)/.test(mv));
ok('D10: cost columns conditional on seeCosts',
  /\{seeCosts && <div>Cost \/ UOM<\/div>\}/.test(mv));
ok('D11: access-restricted screen when !canView',
  /if \(!canView\)[\s\S]{0,500}Access restricted/.test(mv));

// ══════════════════════════════════════════════════════════════════
// PART E — InventoryCostLayers component
// ══════════════════════════════════════════════════════════════════
ok('E1: component default exported',
  /export default function InventoryCostLayers/.test(cl));
ok('E2: canView + seeCosts gates',
  /var canView = isSuperAdmin \|\| modulePerms\['Inventory'\] === true \|\| modulePerms\['Edit Inventory'\] === true/.test(cl) &&
  /var seeCosts = canSeeInventoryCosts\(userProfile, modulePerms\)/.test(cl));
ok('E3: loads layers ORDERED BY receipt_date ASC (FIFO oldest first)',
  /\.order\('receipt_date', \{ ascending: true \}\)/.test(cl));
ok('E4: view toggle: summary vs layers',
  /setView\('summary'\)/.test(cl) && /setView\('layers'\)/.test(cl));
ok('E5: summary roll-up by product × warehouse with qty_remaining sum',
  /key = L\.product_id \+ ':' \+ \(L\.warehouse_id \|\| 'none'\)/.test(cl) &&
  /map\[key\]\.qty_remaining \+= Number\(L\.qty_remaining \|\| 0\)/.test(cl));
ok('E6: summary total_value = qty_remaining × cost_per_uom',
  /map\[key\]\.total_value \+= Number\(L\.qty_remaining \|\| 0\) \* Number\(L\.cost_per_uom \|\| 0\)/.test(cl));
ok('E7: grandTotalValue + grandTotalLayers computed',
  /var grandTotalValue = summary\.reduce/.test(cl) && /var grandTotalLayers = summary\.reduce/.test(cl));
ok('E8: grand-total strip visible only when seeCosts',
  /\{seeCosts && \(\s+<div className="grid grid-cols-3 gap-2 mb-3">/.test(cl));
ok('E9: 3 grand-total cards (inventory value / open layers / total all-time)',
  /TOTAL INVENTORY VALUE[\s\S]{0,500}OPEN LAYERS[\s\S]{0,500}TOTAL LAYERS \(ALL TIME\)/.test(cl));
ok('E10: filter by status (open/closed/reversed/all)',
  /<option value="open">Open only<\/option>[\s\S]{0,300}<option value="closed">Closed only<\/option>[\s\S]{0,300}<option value="reversed">Reversed only<\/option>[\s\S]{0,300}<option value="all">All statuses<\/option>/.test(cl));
ok('E11: layer row shows qty_remaining / qty_received fraction',
  /\{fmt\(L\.qty_remaining, 2\)\} <span className="text-slate-400 font-normal">\/ \{fmt\(L\.qty_received, 2\)\}<\/span>/.test(cl));
ok('E12: status badge variants (Open / Empty / Closed / Reversed)',
  /var statusLabel = L\.status === 'open' && Number\(L\.qty_remaining\) > 0 \? 'Open'[\s\S]{0,300}'Empty'[\s\S]{0,200}'Closed'[\s\S]{0,200}'Reversed'/.test(cl));
ok('E13: layer view shows age in days',
  /var age = ageDays\(L\.receipt_date\)/.test(cl) && /age \+ 'd'/.test(cl));
ok('E14: cost_per_uom column conditional on seeCosts',
  /\{seeCosts && <div>Cost \/ UOM<\/div>\}/.test(cl));

// ══════════════════════════════════════════════════════════════════
// PART F — Wiring into InventoryTab
// ══════════════════════════════════════════════════════════════════
ok('F1: InventoryTab imports InventoryMovementsLedger',
  /import InventoryMovementsLedger from '\.\/InventoryMovementsLedger'/.test(inv));
ok('F2: InventoryTab imports InventoryCostLayers',
  /import InventoryCostLayers from '\.\/InventoryCostLayers'/.test(inv));
ok('F3: SUBTABS includes movementsledger entry under Engine stage',
  /id: 'movementsledger', label: '📜 Movements', stage: 'Engine'/.test(inv));
ok('F4: SUBTABS includes costlayers entry under Engine stage',
  /id: 'costlayers',\s+label: '🧱 Cost Layers', stage: 'Engine'/.test(inv));
ok('F5: both tabs gated to (super_admin OR Inventory OR Edit Inventory)',
  /st\.id === 'movementsledger' \|\| st\.id === 'costlayers'[\s\S]{0,300}isSuperAdmin \|\| \(modulePerms && \(modulePerms\['Inventory'\] === true \|\| modulePerms\['Edit Inventory'\] === true\)\)/.test(inv));
ok('F6: movementsledger render branch with full props',
  /subtab === 'movementsledger' && \(\s*<InventoryMovementsLedger userProfile=\{userProfile\} modulePerms=\{modulePerms\} isSuperAdmin=\{isSuperAdmin\} toast=\{toast\}/.test(inv));
ok('F7: costlayers render branch with full props',
  /subtab === 'costlayers' && \(\s*<InventoryCostLayers userProfile=\{userProfile\} modulePerms=\{modulePerms\} isSuperAdmin=\{isSuperAdmin\} toast=\{toast\}/.test(inv));

// ══════════════════════════════════════════════════════════════════
// Regression guards
// ══════════════════════════════════════════════════════════════════
ok('R1: Build 4.0 (InventoryReceiving) still imported',
  /import InventoryReceiving from '\.\/InventoryReceiving'/.test(inv));
ok('R2: Build 4.2 (InventoryFinalizeCostDialog) still wired into InventoryReceiving',
  /import InventoryFinalizeCostDialog from '\.\/InventoryFinalizeCostDialog'/.test(read('src/components/InventoryReceiving.jsx')));
ok('R3: Build 4.5 (InventoryStockImport) still imported',
  /import InventoryStockImport from '\.\/InventoryStockImport'/.test(inv));
ok('R4: Build 4.1 — receivestock subtab still in nav',
  /id: 'receivestock', label: '🚚 Receive Stock'/.test(inv));
ok('R5: Build 4.1 — old shipments tab still commented out',
  /\/\/ \{ id: 'shipments', label: '🚢 Shipments'/.test(inv));
ok('R6: A.6.27.28 closed-tickets fetch still has NO .limit(100)',
  !/\.eq\('status', 'Closed'\)[\s\S]{0,200}\.limit\(100\)/.test(page));
ok('R7: A.6.27.31 WarehouseSettings modal still in place',
  /fixed inset-0 z-\[200\] bg-black\/70/.test(read('src/components/WarehouseSettings.jsx')));

// ── Version stamp ──────────────────────────────────────────────────
ok('V1: version stamp v55.83-A.6.27.34',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.34 Build 4.3 Movements+Layers tests passed');
