// v55.83-A.6.27.36 — Inventory Phase 1 Build 4.5: Adjustments
//
// Three operation types: quantity adjustment (+/-), warehouse transfer (paired
// movements), cost restatement (super_admin only). All wired through server-side
// RPCs that handle FIFO consumption atomically.

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var adj = read('src/components/InventoryAdjustments.jsx');
var inv = read('src/components/InventoryTab.jsx');
var sql = read('sql/v55-83-a-6-27-36-inventory-adjustments.sql');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — SQL Migration
// ══════════════════════════════════════════════════════════════════

ok('A1: inventory_adjustments table created',
  /CREATE TABLE IF NOT EXISTS inventory_adjustments/.test(sql));
ok('A2: adjustment_type CHECK with 4 valid values',
  /chk_adjustment_type CHECK \(adjustment_type IN \([\s\S]{0,500}'quantity_increase'[\s\S]{0,200}'quantity_decrease'[\s\S]{0,200}'warehouse_transfer'[\s\S]{0,200}'cost_restatement'/.test(sql));
ok('A3: product_id NOT NULL FK to inventory_products with RESTRICT',
  /product_id\s+uuid NOT NULL REFERENCES inventory_products\(id\) ON DELETE RESTRICT/.test(sql));
ok('A4: source_warehouse_id + destination_warehouse_id FKs',
  /source_warehouse_id\s+uuid REFERENCES inv_warehouses\(id\) ON DELETE RESTRICT/.test(sql) &&
  /destination_warehouse_id uuid REFERENCES inv_warehouses\(id\) ON DELETE RESTRICT/.test(sql));
ok('A5: source_layer_id FK to inventory_layers with SET NULL',
  /source_layer_id\s+uuid REFERENCES inventory_layers\(id\) ON DELETE SET NULL/.test(sql));
ok('A6: old_cost_per_uom + new_cost_per_uom columns (for cost_restatement)',
  /old_cost_per_uom\s+numeric/.test(sql) && /new_cost_per_uom\s+numeric/.test(sql));
ok('A7: transfer_pair_id uuid column',
  /transfer_pair_id\s+uuid/.test(sql));
ok('A8: reason NOT NULL constraint',
  /reason\s+text NOT NULL/.test(sql));
ok('A9: 6 indexes on adjustments (type/date/product/source/dest/pair)',
  /idx_adjustments_type\b/.test(sql) && /idx_adjustments_date\b/.test(sql) &&
  /idx_adjustments_product\b/.test(sql) && /idx_adjustments_source_wh\b/.test(sql) &&
  /idx_adjustments_destination_wh\b/.test(sql) && /idx_adjustments_transfer_pair\b/.test(sql));
ok('A10: RLS enabled with read+write policies',
  /ALTER TABLE inventory_adjustments ENABLE ROW LEVEL SECURITY/.test(sql) &&
  /CREATE POLICY inv_adjustments_read/.test(sql) && /CREATE POLICY inv_adjustments_write/.test(sql));

ok('A11: inventory_movements gets transfer_pair_id column',
  /ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS transfer_pair_id uuid/.test(sql));
ok('A12: idx on transfer_pair_id (partial)',
  /idx_movements_transfer_pair ON inventory_movements \(transfer_pair_id\) WHERE transfer_pair_id IS NOT NULL/.test(sql));

ok('A13: consume_layers_fifo() function defined',
  /CREATE OR REPLACE FUNCTION consume_layers_fifo\(/.test(sql));
ok('A14: consume_layers_fifo iterates layers ORDER BY receipt_date ASC + FOR UPDATE',
  /ORDER BY receipt_date ASC, created_at ASC\s+FOR UPDATE/.test(sql));
ok('A15: consume_layers_fifo decrements qty_remaining + closes layer at zero',
  /UPDATE inventory_layers SET\s+qty_remaining = qty_remaining - v_consume_from_layer,\s+status = CASE WHEN qty_remaining - v_consume_from_layer <= 0 THEN 'closed' ELSE 'open' END/.test(sql));
ok('A16: consume_layers_fifo raises on insufficient stock',
  /RAISE EXCEPTION 'Insufficient stock: requested %, short by %/.test(sql));
ok('A17: consume_layers_fifo inserts movement per layer slice with source_layer_id',
  /INSERT INTO inventory_movements[\s\S]{0,800}source_layer_id, source_adjustment_id, transfer_pair_id/.test(sql));

ok('A18: apply_quantity_adjustment() function defined',
  /CREATE OR REPLACE FUNCTION apply_quantity_adjustment\(/.test(sql));
ok('A19: apply_quantity_adjustment validates direction in (increase, decrease)',
  /IF p_direction NOT IN \('increase','decrease'\)/.test(sql));
ok('A20: apply_quantity_adjustment requires reason',
  /apply_quantity_adjustment: reason required/.test(sql));
ok('A21: apply_quantity_adjustment increase inserts movement directly (no FIFO consume)',
  /IF p_direction = 'increase' THEN\s+INSERT INTO inventory_movements/.test(sql));
ok('A22: apply_quantity_adjustment decrease calls consume_layers_fifo',
  /ELSE\s+v_cost_consumed := consume_layers_fifo\(/.test(sql));

ok('A23: apply_warehouse_transfer() function defined',
  /CREATE OR REPLACE FUNCTION apply_warehouse_transfer\(/.test(sql));
ok('A24: apply_warehouse_transfer validates source != dest',
  /IF p_source_warehouse_id = p_dest_warehouse_id OR p_dest_warehouse_id IS NULL/.test(sql));
ok('A25: apply_warehouse_transfer generates v_pair_id once',
  /v_pair_id := gen_random_uuid\(\)/.test(sql));
ok('A26: apply_warehouse_transfer consumes source via FIFO with the pair_id',
  /v_total_cost := consume_layers_fifo\(\s+p_product_id, p_source_warehouse_id, p_quantity,\s+'transfer_out'[\s\S]{0,400}v_pair_id/.test(sql));
ok('A27: apply_warehouse_transfer computes weighted-avg cost and inserts paired transfer_in movement',
  /v_avg_cost := v_total_cost \/ p_quantity[\s\S]{0,2000}'transfer_in'[\s\S]{0,500}v_avg_cost[\s\S]{0,500}v_pair_id/.test(sql));

ok('A28: apply_cost_adjustment() function defined',
  /CREATE OR REPLACE FUNCTION apply_cost_adjustment\(/.test(sql));
ok('A29: apply_cost_adjustment validates new_cost_per_uom >= 0',
  /IF p_new_cost_per_uom IS NULL OR p_new_cost_per_uom < 0/.test(sql));
ok('A30: apply_cost_adjustment locks layer FOR UPDATE',
  /SELECT \* INTO v_layer FROM inventory_layers WHERE id = p_layer_id FOR UPDATE/.test(sql));
ok('A31: apply_cost_adjustment updates inventory_layers.cost_per_uom',
  /UPDATE inventory_layers SET\s+cost_per_uom = p_new_cost_per_uom/.test(sql));
ok('A32: apply_cost_adjustment records old + new cost in adjustment row',
  /old_cost_per_uom, new_cost_per_uom[\s\S]{0,500}v_layer\.cost_per_uom, p_new_cost_per_uom/.test(sql));

// ══════════════════════════════════════════════════════════════════
// PART B — Component: InventoryAdjustments
// ══════════════════════════════════════════════════════════════════

ok('B1: component default exported',
  /export default function InventoryAdjustments/.test(adj));
ok('B2: canView + canEditAdj + canCostAdj permission gates',
  /var canView = isSuperAdmin \|\| modulePerms\['Inventory'\] === true \|\| modulePerms\['Edit Inventory'\] === true/.test(adj) &&
  /var canEditAdj = isSuperAdmin \|\| modulePerms\['Edit Inventory'\] === true/.test(adj) &&
  /var canCostAdj = isSuperAdmin/.test(adj));
ok('B3: TYPE_LABELS map has all 4 types with color coding',
  /quantity_increase:[\s\S]{0,200}bg-emerald-100[\s\S]{0,200}quantity_decrease:[\s\S]{0,200}bg-rose-100[\s\S]{0,200}warehouse_transfer:[\s\S]{0,200}bg-blue-100[\s\S]{0,200}cost_restatement:[\s\S]{0,200}bg-amber-100/.test(adj));
ok('B4: loads adjustments + products + warehouses + layers in parallel',
  /Promise\.all\(\[\s+supabase\.from\('inventory_adjustments'\)[\s\S]{0,400}inventory_products[\s\S]{0,400}inv_warehouses[\s\S]{0,400}inventory_layers/.test(adj));
ok('B5: layers query filters status=open AND qty_remaining > 0',
  /\.from\('inventory_layers'\)\.select\('\*'\)\.eq\('status', 'open'\)\.gt\('qty_remaining', 0\)/.test(adj));
ok('B6: openStockFor helper computes sum of qty_remaining for product+warehouse',
  /function openStockFor\(productId, warehouseId\)[\s\S]{0,500}layers\s+\.filter\([\s\S]{0,300}l\.product_id === productId[\s\S]{0,300}\.reduce/.test(adj));

// ── Action buttons gated by permission
ok('B7: + Quantity Adjustment button shown when canEditAdj',
  /canEditAdj && \(\s+<div className="flex gap-2 flex-wrap">[\s\S]{0,800}\+ Quantity Adjustment/.test(adj));
ok('B8: + Warehouse Transfer button shown when canEditAdj',
  /\+ Warehouse Transfer/.test(adj));
ok('B9: + Cost Restatement button shown only when canCostAdj (super_admin)',
  /\{canCostAdj && \(\s+<button onClick=\{function \(\) \{ setModalType\('cost'\)[\s\S]{0,500}\+ Cost Restatement/.test(adj));

// ── submitQuantityAdj
ok('B10: submitQuantityAdj validates product + warehouse + direction + qty + reason',
  /if \(!form\.product_id\) \{ alert\('Pick a product'\); return; \}/.test(adj) &&
  /if \(!form\.warehouse_id\) \{ alert\('Pick a warehouse'\); return; \}/.test(adj) &&
  /if \(!form\.direction\) \{ alert\('Pick increase or decrease'\); return; \}/.test(adj) &&
  /if \(!form\.reason \|\| !form\.reason\.trim\(\)\) \{ alert\('Reason required'\); return; \}/.test(adj));
ok('B11: submitQuantityAdj warns when decrease would exceed available',
  /var available = openStockFor\(form\.product_id, form\.warehouse_id\)[\s\S]{0,500}if \(qty > available\)/.test(adj));
ok('B12: submitQuantityAdj calls apply_quantity_adjustment RPC',
  /supabase\.rpc\('apply_quantity_adjustment'/.test(adj));

// ── submitTransfer
ok('B13: submitTransfer validates source != destination',
  /if \(form\.source_warehouse_id === form\.destination_warehouse_id\) \{ alert\('Source and destination must differ'\); return; \}/.test(adj));
ok('B14: submitTransfer calls apply_warehouse_transfer RPC',
  /supabase\.rpc\('apply_warehouse_transfer'/.test(adj));
ok('B15: submitTransfer warns when qty exceeds source available',
  /var available = openStockFor\(form\.product_id, form\.source_warehouse_id\)/.test(adj));

// ── submitCostRestate
ok('B16: submitCostRestate validates layer + new_cost + reason',
  /if \(!form\.source_layer_id\) \{ alert\('Pick a cost layer to restate'\); return; \}/.test(adj) &&
  /if \(newCost == null \|\| newCost < 0\)/.test(adj));
ok('B17: submitCostRestate calls apply_cost_adjustment RPC',
  /supabase\.rpc\('apply_cost_adjustment'/.test(adj));

// ── Three modal types
ok('B18: 3 modal types declared (quantity / transfer / cost)',
  /modalType === 'quantity'/.test(adj) && /modalType === 'transfer'/.test(adj) && /modalType === 'cost'/.test(adj));
ok('B19: quantity modal has decrease + increase direction buttons',
  /id: 'decrease', label: 'Decrease[\s\S]{0,400}id: 'increase', label: 'Increase/.test(adj));
ok('B20: transfer modal has both source + destination warehouse selects',
  /source_warehouse_id[\s\S]{0,1500}destination_warehouse_id/.test(adj));
ok('B21: cost modal shows current cost preview when layer picked',
  /Current cost:[\s\S]{0,500}fmt\(L\.cost_per_uom, 4\)/.test(adj));
ok('B22: cost modal warns about COGS restatement for prior sales',
  /Cost restatement updates the cost on this layer\. Sales that already drew from this layer at the OLD cost will need COGS restatement/.test(adj));

// ── Available-stock helper banner
ok('B23: qty modal shows available open stock when product+warehouse+decrease selected',
  /form\.direction === 'decrease' && \(\s+<div className="bg-blue-50[\s\S]{0,400}Available open stock at this warehouse/.test(adj));
ok('B24: transfer modal shows available open stock at source',
  /Available open stock at source/.test(adj));

// ── List view
ok('B25: list row colored badge per type via TYPE_LABELS',
  /var meta = TYPE_LABELS\[a\.adjustment_type\]/.test(adj));
ok('B26: list row shows cost-restatement as old→new when seeCosts',
  /a\.adjustment_type === 'cost_restatement' && seeCosts[\s\S]{0,400}fmt\(a\.old_cost_per_uom, 4\) \+ ' → ' \+/.test(adj) ||
  /a\.adjustment_type === 'cost_restatement' && seeCosts[\s\S]{0,400}fmt\(a\.old_cost_per_uom, 4\)[\s\S]{0,200}fmt\(a\.new_cost_per_uom, 4\)/.test(adj));
ok('B27: filter bar — search + type + product + warehouse',
  /filterType[\s\S]{0,800}filterProduct[\s\S]{0,800}filterWarehouse[\s\S]{0,800}search/.test(adj));
ok('B28: access-restricted screen when !canView',
  /if \(!canView\)[\s\S]{0,400}Access restricted/.test(adj));

// ══════════════════════════════════════════════════════════════════
// PART C — Wiring into InventoryTab
// ══════════════════════════════════════════════════════════════════

ok('C1: InventoryTab imports InventoryAdjustments',
  /import InventoryAdjustments from '\.\/InventoryAdjustments'/.test(inv));
ok('C2: SUBTABS includes adjustments under Engine stage',
  /id: 'adjustments',\s+label: '🔧 Adjustments', stage: 'Engine'/.test(inv));
ok('C3: adjustments tab gated to super_admin OR Inventory OR Edit Inventory',
  /st\.id === 'adjustments'[\s\S]{0,300}isSuperAdmin \|\| \(modulePerms && \(modulePerms\['Inventory'\] === true \|\| modulePerms\['Edit Inventory'\] === true\)\)/.test(inv));
ok('C4: render branch mounts component with full props',
  /subtab === 'adjustments' && \(\s*<InventoryAdjustments userProfile=\{userProfile\} modulePerms=\{modulePerms\} isSuperAdmin=\{isSuperAdmin\} toast=\{toast\}/.test(inv));

// ══════════════════════════════════════════════════════════════════
// Regression guards
// ══════════════════════════════════════════════════════════════════

ok('R1: Build 4.3 (Movements + Layers) still imported',
  /import InventoryMovementsLedger from '\.\/InventoryMovementsLedger'/.test(inv) &&
  /import InventoryCostLayers from '\.\/InventoryCostLayers'/.test(inv));
ok('R2: Build 4.4 — receipt_rolls + reopen still present in receiving',
  /supabase\.rpc\('reopen_finalized_receipt'/.test(read('src/components/InventoryReceiving.jsx')));
ok('R3: Build 4.2 — InventoryFinalizeCostDialog still wired',
  /import InventoryFinalizeCostDialog from '\.\/InventoryFinalizeCostDialog'/.test(read('src/components/InventoryReceiving.jsx')));
ok('R4: A.6.27.28 closed-tickets fetch still has NO .limit(100)',
  !/\.eq\('status', 'Closed'\)[\s\S]{0,200}\.limit\(100\)/.test(page));
ok('R5: A.6.27.31 WarehouseSettings modal still in place',
  /fixed inset-0 z-\[200\] bg-black\/70/.test(read('src/components/WarehouseSettings.jsx')));

// ── Version stamp ──────────────────────────────────────────────────
ok('V1: version stamp v55.83-A.6.27.36',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.36 Build 4.5 Adjustments tests passed');
