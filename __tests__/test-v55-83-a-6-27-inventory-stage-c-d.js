// ⚠ SUPERSEDED by v55.83-T (2026-06-07) — DO NOT use these assertions to drive code changes.
// The two parallel inventory engines were consolidated into ONE. System B (inv_sku_id /
// consumeFifo / inv_layers / inv_movements / AdjustmentsManager) was intentionally retired.
// Assertions in this Stage-B/C/D/E/F suite describe that removed dual-engine behavior and no
// longer reflect the product. Current behavior is covered by test-v55-83-t-single-inventory-engine.js.
// Left in place for history; expected to fail. Do NOT re-add System B to make it pass.

// v55.83-A.6.27 (Max May 14 2026) — Inventory Stage C + D
//
// Verifies:
//   • SQL has all the right tables/columns
//   • FX helper exports & shape
//   • Cost engine exports & shape (rollup, allocate, finalize, consume, reverse, restate)
//   • FinalizeCostDialog rendering pieces
//   • LayersLedger + InventoryPnL components present and wired
//   • InventoryTab activates Stage C + D subtabs
//   • ShipmentsManager has Finalize button + dialog mount
//   • page.jsx invoice modal: SKU picker per line, consumeFifo wired on save,
//     reverseFifoConsumption on delete

var fs = require('fs');
var path = require('path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

var sql = read('sql/v55-83-a-6-27-inventory-stage-c-d.sql');
var fx = read('src/lib/inventory-fx.js');
var ce = read('src/lib/inventory-cost-engine.js');
var dlg = read('src/components/FinalizeCostDialog.jsx');
var layers = read('src/components/LayersLedger.jsx');
var pnl = read('src/components/InventoryPnL.jsx');
var invTab = read('src/components/InventoryTab.jsx');
var ships = read('src/components/ShipmentsManager.jsx');
var page = read('src/app/page.jsx');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// ── 1. SQL schema ──────────────────────────────────────────────────────
ok('1a: inv_layers table created',
  /CREATE TABLE IF NOT EXISTS inv_layers/.test(sql));
ok('1b: inv_cost_adjustments table created',
  /CREATE TABLE IF NOT EXISTS inv_cost_adjustments/.test(sql));
ok('1c: inv_fx_rates table created OR reused (v55.83-A.6.27.1: foundation table reused, columns documented in commented-out block)',
  /CREATE TABLE IF NOT EXISTS inv_fx_rates/.test(sql)
  || /inv_fx_rates already exists from the foundation schema/.test(sql));
ok('1d: inv_shipments gets allocation_method with valid check constraint',
  /ALTER TABLE inv_shipments[\s\S]{0,800}allocation_method TEXT[\s\S]{0,200}CHECK \(allocation_method IN \('by_qty', 'by_kg', 'by_value'\)\)/.test(sql));
ok('1e: inv_layers has cost_is_provisional flag',
  /cost_is_provisional BOOLEAN NOT NULL DEFAULT TRUE/.test(sql));
ok('1f: inv_layers has qty_remaining + qty_received',
  /qty_received NUMERIC[\s\S]{0,200}qty_remaining NUMERIC/.test(sql));
ok('1g: inv_movements gets consumed_layers JSONB',
  /ALTER TABLE inv_movements[\s\S]{0,800}consumed_layers JSONB/.test(sql));
ok('1h: invoice_items gets inv_sku_id + cogs columns',
  /ALTER TABLE invoice_items[\s\S]{0,800}inv_sku_id UUID[\s\S]{0,400}cogs_usd NUMERIC/.test(sql));
ok('1i: idempotent — uses IF NOT EXISTS throughout',
  (sql.match(/IF NOT EXISTS/g) || []).length >= 5);

// ── 2. FX helper ──────────────────────────────────────────────────────
ok('2a: getFxRate exported',
  /export async function getFxRate/.test(fx));
ok('2b: saveManualRate exported',
  /export async function saveManualRate/.test(fx));
ok('2c: convert exported',
  /export async function convert/.test(fx));
ok('2d: hits exchangerate.host API',
  /exchangerate\.host/.test(fx));
ok('2e: caches rates in inv_fx_rates',
  /from\('inv_fx_rates'\)/.test(fx));
ok('2f: USD bridging fallback for cross-currency',
  /bridged via USD/.test(fx));

// ── 3. Cost engine ────────────────────────────────────────────────────
ok('3a: rollupShipmentCost exported',
  /export async function rollupShipmentCost/.test(ce));
ok('3b: allocateAcrossSkus exported',
  /export function allocateAcrossSkus/.test(ce));
ok('3c: finalizeShipmentCost exported',
  /export async function finalizeShipmentCost/.test(ce));
ok('3d: consumeFifo exported',
  /export async function consumeFifo/.test(ce));
ok('3e: reverseFifoConsumption exported',
  /export async function reverseFifoConsumption/.test(ce));
ok('3f: rollup sums all 7 cost components',
  /var COST_COMPONENTS = \[[\s\S]{0,200}'purchase_cost'[\s\S]{0,200}'freight_cost'[\s\S]{0,200}'customs_cost'[\s\S]{0,200}'port_fees'[\s\S]{0,200}'inland_transport'[\s\S]{0,200}'handling_fees'[\s\S]{0,200}'other_charges'/.test(ce));
ok('3g: allocate handles by_qty, by_kg, by_value',
  /method === 'by_kg'/.test(ce) && /method === 'by_value'/.test(ce));
ok('3h: allocate falls back to qty when basis is zero for non-default method',
  /basis <= 0 && method !== 'by_qty'[\s\S]{0,200}basis = Number\(li\.qty_primary/.test(ce));
ok('3i: consumeFifo orders by received_at ASC then created_at ASC',
  /\.order\('received_at', \{ ascending: true \}\)[\s\S]{0,200}\.order\('created_at', \{ ascending: true \}\)/.test(ce));
ok('3j: consumeFifo returns shortfall when not enough stock',
  /shortfall: remaining/.test(ce));
ok('3k: consumeFifo rolls back on partial failure',
  /Rollback already-drained layers/.test(ce));
ok('3l: finalizeShipmentCost calls restateCostForLayer when layer cost changes',
  /Math\.abs\(oldUnitUsd - a\.unitUsd\) > 0\.0001[\s\S]{0,400}restateCostForLayer/.test(ce));
ok('3m: restate writes inv_cost_adjustments audit row',
  /from\('inv_cost_adjustments'\)\.insert/.test(ce));

// ── 4. FinalizeCostDialog ─────────────────────────────────────────────
ok('4a: dialog imports rollup + allocate + finalize',
  /import \{ rollupShipmentCost, allocateAcrossSkus, finalizeShipmentCost \}/.test(dlg));
ok('4b: dialog has FX block with override',
  /Override rate/.test(dlg) && /applyOverride/.test(dlg));
ok('4c: dialog has allocation method picker (3 options)',
  /by_qty[\s\S]{0,1000}by_kg[\s\S]{0,1000}by_value/.test(dlg));
ok('4d: dialog shows per-SKU allocation preview',
  /Per-SKU Allocation Preview/.test(dlg));
ok('4e: dialog confirms with restate summary',
  /restatedAdjustments/.test(dlg));

// ── 5. LayersLedger ───────────────────────────────────────────────────
ok('5a: LayersLedger loads from inv_layers',
  /from\('inv_layers'\)/.test(layers));
ok('5b: LayersLedger shows provisional/finalized/restated badges',
  /Provisional/.test(layers) && /Final/.test(layers) && /Restated/.test(layers));
ok('5c: LayersLedger pulls adjustments for "Restated x N" badge',
  /from\('inv_cost_adjustments'\)/.test(layers));
ok('5d: LayersLedger has SKU + warehouse filters',
  /skuFilter/.test(layers) && /warehouseFilter/.test(layers));

// ── 6. InventoryPnL ───────────────────────────────────────────────────
ok('6a: PnL loads invoice_items with inv_sku_id NOT NULL',
  /from\('invoice_items'\)[\s\S]{0,400}\.not\('inv_sku_id', 'is', null\)/.test(pnl));
ok('6b: PnL loads sale movements',
  /from\('inv_movements'\)[\s\S]{0,400}\.eq\('movement_type', 'sale'\)/.test(pnl));
ok('6c: PnL computes profit and margin per SKU',
  /profit: profit[\s\S]{0,200}margin: margin/.test(pnl));
ok('6d: PnL has period filter (month/quarter/year/all)',
  /period === 'month'/.test(pnl) && /period === 'quarter'/.test(pnl) && /period === 'year'/.test(pnl));

// ── 7. InventoryTab activates C+D ────────────────────────────────────
ok('7a: SUBTABS includes layers (stage C)',
  /id: 'layers'[\s\S]{0,200}stage: 'C'/.test(invTab));
ok('7b: SUBTABS includes pnl (stage D)',
  /id: 'pnl'[\s\S]{0,200}stage: 'D'/.test(invTab));
ok('7c: C and D stages available (A.6.27: A+B+C+D; A.6.27.9: all)',
  /\['A', 'B', 'C', 'D'\]\.indexOf\(st\.stage\) >= 0/.test(invTab) ||
  /var available = true/.test(invTab));
ok('7d: imports LayersLedger + InventoryPnL',
  /import LayersLedger from '\.\/LayersLedger'/.test(invTab)
  && /import InventoryPnL from '\.\/InventoryPnL'/.test(invTab));
ok('7e: version stamp present (Stage X of 6 banner removed in v.43)',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));

// ── 8. ShipmentsManager wires the dialog ─────────────────────────────
ok('8a: imports FinalizeCostDialog',
  /import FinalizeCostDialog from '\.\/FinalizeCostDialog'/.test(ships));
ok('8b: showFinalizeDialog state',
  /var \[showFinalizeDialog, setShowFinalizeDialog\] = useState\(false\)/.test(ships));
ok('8c: Finalize Landed Cost button shown when received && !cost_finalized_at',
  /isReceived && !shipment\.cost_finalized_at[\s\S]{0,400}💰 Finalize Landed Cost/.test(ships));
ok('8d: dialog mounted inside ShipmentDetail render',
  /showFinalizeDialog && \(\s*<FinalizeCostDialog/.test(ships));
ok('8e: shipment finalized badge + landed cost summary banner',
  /Cost finalized/.test(ships) && /Landed Total/.test(ships));

// ── 9. page.jsx invoice modal: SKU picker + drain on save ────────────
ok('9a: page imports consumeFifo + reverseFifoConsumption',
  /import \{ consumeFifo, reverseFifoConsumption \} from '\.\.\/lib\/inventory-cost-engine'/.test(page));
ok('9b: invSkus state',
  /const \[invSkus, setInvSkus\] = useState\(\[\]\)/.test(page));
ok('9c: invSkus loaded from inv_skus (active rows, by deleted_at after A.6.27.11)',
  // A.6.27.11 — corrected column convention: filter by deleted_at IS NULL
  // and order by sku_number (the real column). Old form is_active+sku_code
  // is wrong. Accept either form for back-compat.
  /from\('inv_skus'\)\.select\('\*'\)\.eq\('is_active', true\)/.test(page) ||
  /from\('inv_skus'\)\.select\('\*'\)\.is\('deleted_at', null\)/.test(page));
ok('9d: SKU column added to invoice items table header',
  /📦 SKU \(optional\)/.test(page));
ok('9e: SKU picker dropdown maps invSkus to options',
  // A.6.27.11 — uses s.sku_number (real column) instead of s.sku_code.
  /\(invSkus \|\| \[\]\)\.map\(s => \(\s*<option key=\{s\.id\} value=\{s\.id\}>\{s\.(sku_number|sku_code)\}<\/option>/.test(page));
ok('9f: inv_sku_id is saved into invoice_items insert',
  /inv_sku_id: item\.inv_sku_id \|\| null/.test(page));
ok('9g: consumeFifo called when inv_sku_id + qty set',
  /item\.inv_sku_id && Number\(item\.inv_qty\) > 0[\s\S]{0,400}consumeFifo\(item\.inv_sku_id/.test(page));
ok('9h: sale movement inserted with consumed_layers + linked_invoice_item_id',
  /movement_type: 'sale'/.test(page)
  && /consumed_layers: drain\.consumed/.test(page)
  && /linked_invoice_item_id: insertedItem\.id/.test(page));
ok('9i: COGS stamped on invoice_item after movement',
  /update\(\{[\s\S]{0,200}cogs_usd: drain\.totalCogsUsd[\s\S]{0,200}cogs_movement_id: movInsert\.data\.id/.test(page));
ok('9j: shortfall warned via toast',
  /drain\.shortfall > 0[\s\S]{0,200}Stock shortfall/.test(page));
ok('9k: invoice delete reverses FIFO consumption',
  /reverseFifoConsumption\(m\.consumed_layers\)/.test(page));
ok('9l: single line item delete reverses FIFO + deletes movement',
  /lineItem\.cogs_movement_id[\s\S]{0,400}reverseFifoConsumption\(mov\.consumed_layers\)[\s\S]{0,200}delete\(\)\.eq\('id', lineItem\.cogs_movement_id\)/.test(page));

// ── 10. Version stamps in sync ───────────────────────────────────────
ok('10a: page.jsx version stamp v55.83-A.6.27',
  /BUILD v55\.83-A\.6\.27/.test(page));
ok('10b: WhatsNewWidget has v55.83-A.6.27.x entry at top of BUILD_HISTORY',
  /export const BUILD_HISTORY = \[\s*\{\s*version: 'v55\.83-A\.6\.27(\.\d+)?'/.test(read('src/components/WhatsNewWidget.jsx')));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27 Stage C+D tests passed');
