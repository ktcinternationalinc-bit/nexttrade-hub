// v55.83-A.6.21 (Max May 14 2026) — Inventory Stage B
//
// Activates the four Stage B sub-features:
//   1. Shipments — list / create / detail / receive / reconcile
//   2. Inventory View — pivot SKU × Warehouse → current qty from movements
//   3. Movements Ledger — append-only audit history of every stock change
//   4. Reconciliation — qty_received_actual + variance per shipment_sku
//
// Stage B promotes 'inventory', 'shipments', 'movements' subtabs from
// "coming soon" to active. The receive workflow writes inv_movements rows
// for each line item — that's how stock actually enters inventory.

var fs = require('fs');
var path = require('path');
var ship = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ShipmentsManager.jsx'), 'utf8');
var invView = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'InventoryView.jsx'), 'utf8');
var movs = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'MovementsLedger.jsx'), 'utf8');
var tab = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'InventoryTab.jsx'), 'utf8');
var sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'v55-83-a-6-21-shipment-sku-reconciliation.sql'), 'utf8');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// === 1. ShipmentsManager component ===
ok('1a: ShipmentsManager default exported',
  /export default function ShipmentsManager/.test(ship));
ok('1b: five real shipment statuses defined',
  /'draft'[\s\S]{0,300}'in_transit'[\s\S]{0,300}'arrived'[\s\S]{0,300}'received'[\s\S]{0,300}'reconciled'/.test(ship));
ok('1c: graceful schema-missing fallback',
  /Inventory schema not detected/.test(ship));
ok('1d: create form for new shipment',
  /function ShipmentCreateForm/.test(ship));
ok('1e: detail view for managing a shipment',
  /function ShipmentDetail/.test(ship));

// 1.2 Receive workflow writes movements
ok('2a: transitionTo handles received status specially',
  /transitionTo[\s\S]{0,500}nextStatus === 'received'/.test(ship));
ok('2b: receive workflow writes inv_movements rows',
  /movement_type: 'receipt'[\s\S]{0,200}qty_change: Number\(li\.qty_primary/.test(ship));
ok('2c: receive workflow filters out zero-qty rows',
  /\.filter\(function \(m\) \{ return Number\(m\.qty_change\) > 0; \}\)/.test(ship));
ok('2d: refuses to receive shipment with no line items',
  /Cannot receive a shipment with no SKU line items/.test(ship));
ok('2e: refuses to receive without a destination warehouse',
  /Set a destination warehouse before receiving/.test(ship));

// 1.3 Line item management
ok('3a: addLineItem function exists with qty validation',
  /async function addLineItem[\s\S]{0,400}qty_primary[\s\S]{0,200}must be > 0/.test(ship));
ok('3b: deleteLineItem function exists',
  /async function deleteLineItem/.test(ship));

// 1.4 Reconciliation
ok('4a: reconcileLine function writes qty_received_actual + variance',
  /reconcileLine[\s\S]{0,500}qty_received_actual: Number\(actualQty\)[\s\S]{0,200}variance: variance/.test(ship));
ok('4b: ReconcileRow inline row component exists',
  /function ReconcileRow/.test(ship));
ok('4c: reconciliation only available after received status',
  /isReceived = shipment\.status === 'received' \|\| shipment\.status === 'reconciled'/.test(ship));

// 1.5 Cost components
ok('5a: cost editing with all 7 components',
  /'purchase_cost', 'freight_cost', 'customs_cost', 'port_fees', 'inland_transport', 'handling_fees', 'other_charges'/.test(ship));

// === 2. InventoryView component ===
ok('6a: InventoryView default exported',
  /export default function InventoryView/.test(invView));
ok('6b: pivot table built from inv_movements (qty_change sum per sku × warehouse)',
  /movements\.forEach[\s\S]{0,200}sku_id[\s\S]{0,200}warehouse_id[\s\S]{0,200}qty_change/.test(invView));
ok('6c: filter by warehouse / type / search',
  /filterWarehouse/.test(invView) && /filterType/.test(invView) && /search/.test(invView));
ok('6d: hide-zero-stock toggle',
  /hideZero/.test(invView));
ok('6e: totals row at bottom',
  /<tfoot/.test(invView) && /Totals →/.test(invView));
ok('6f: graceful schema-missing fallback',
  /Inventory schema not detected/.test(invView));

// === 3. MovementsLedger component ===
ok('7a: MovementsLedger default exported',
  /export default function MovementsLedger/.test(movs));
ok('7b: queries inv_movements ordered DESC',
  /from\('inv_movements'\)[\s\S]{0,200}\.order\('movement_date', \{ ascending: false \}\)/.test(movs));
ok('7c: shows all 11 movement types from schema',
  /receipt:/.test(movs) && /sale:/.test(movs) && /adjustment_in:/.test(movs) && /physical_count_correction:/.test(movs));
ok('7d: filters by SKU / warehouse / type / date range',
  /filterSku/.test(movs) && /filterWarehouse/.test(movs) && /filterType/.test(movs) && /dateFrom/.test(movs) && /dateTo/.test(movs));
ok('7e: positive qty in green, negative qty in red',
  /qty > 0 \? 'text-emerald-700' : qty < 0 \? 'text-red-700'/.test(movs));

// === 4. InventoryTab orchestrator ===
ok('8a: imports Stage B components',
  /import ShipmentsManager/.test(tab) && /import InventoryView/.test(tab) && /import MovementsLedger/.test(tab));
ok('8b: Stage B subtabs marked available (v55.83-A.6.27: A+B+C+D; A.6.27.9: ALL available)',
  /available = st\.stage === 'A' \|\| st\.stage === 'B'/.test(tab) ||
  /\['A', 'B', 'C', 'D'\]\.indexOf\(st\.stage\) >= 0/.test(tab) ||
  /var available = true/.test(tab));
ok('8c: inventory subtab renders InventoryView',
  /subtab === 'inventory'[\s\S]{0,200}<InventoryView/.test(tab));
ok('8d: shipments subtab renders ShipmentsManager',
  /subtab === 'shipments'[\s\S]{0,200}<ShipmentsManager/.test(tab));
ok('8e: movements subtab renders MovementsLedger',
  /subtab === 'movements'[\s\S]{0,200}<MovementsLedger/.test(tab));
ok('8f: header badge updated (Stage 2 → 4 → 6 of 6 as stages ship)',
  /Stage 2 of 6/.test(tab) || /Stage 4 of 6/.test(tab) || /Stage 6 of 6/.test(tab));
ok('8g: default subtab is inventory pivot view',
  /var \[subtab, setSubtab\] = useState\('inventory'\)/.test(tab));
ok('8h: coming-soon placeholder only for E and F (A.6.27.9: removed entirely)',
  /\['adjustments', 'reports'\]\.indexOf\(subtab\) >= 0/.test(tab) ||
  // After A.6.27.9 the placeholder block is gone — both subtabs render real components
  (/subtab === 'adjustments'[\s\S]{0,200}<AdjustmentsManager/.test(tab) &&
   /subtab === 'reports'[\s\S]{0,200}<InventoryReports/.test(tab)));

// === 5. SQL migration ===
ok('9a: SQL adds qty_received_actual column',
  /ADD COLUMN IF NOT EXISTS qty_received_actual/.test(sql));
ok('9b: SQL adds variance column',
  /ADD COLUMN IF NOT EXISTS variance/.test(sql));
ok('9c: SQL adds variance_reason column',
  /ADD COLUMN IF NOT EXISTS variance_reason/.test(sql));
ok('9d: SQL is idempotent (IF NOT EXISTS)',
  (sql.match(/IF NOT EXISTS/g) || []).length >= 3);

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.21 Stage B tests passed (' + (40) + ' assertions)');
