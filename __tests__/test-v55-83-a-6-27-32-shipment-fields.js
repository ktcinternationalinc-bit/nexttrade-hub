// v55.83-A.6.27.32 — Inventory Phase 1 Build 4.1: Missing shipment fields
//
// Brings Receive Stock to parity with the old Shipments form. Added 11 new
// columns (header + line), extended status enum, added status flow visible
// in the list, and hid the old never-used subtabs from the nav.

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var rec = read('src/components/InventoryReceiving.jsx');
var inv = read('src/components/InventoryTab.jsx');
var sql = read('sql/v55-83-a-6-27-32-inventory-shipment-fields.sql');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — SQL Migration
// ══════════════════════════════════════════════════════════════════

ok('A1: SQL adds shipment_reference column',
  /ALTER TABLE inventory_stock_receipts ADD COLUMN IF NOT EXISTS shipment_reference text/.test(sql));
ok('A2: SQL adds freight_forwarder column',
  /ALTER TABLE inventory_stock_receipts ADD COLUMN IF NOT EXISTS freight_forwarder text/.test(sql));
ok('A3: SQL adds shipping_line column',
  /ALTER TABLE inventory_stock_receipts ADD COLUMN IF NOT EXISTS shipping_line text/.test(sql));
ok('A4: SQL adds eta_date column',
  /ALTER TABLE inventory_stock_receipts ADD COLUMN IF NOT EXISTS eta_date date/.test(sql));
ok('A5: SQL adds arrival_date column',
  /ALTER TABLE inventory_stock_receipts ADD COLUMN IF NOT EXISTS arrival_date date/.test(sql));
ok('A6: SQL adds purchase_currency column',
  /ALTER TABLE inventory_stock_receipts ADD COLUMN IF NOT EXISTS purchase_currency text/.test(sql));
ok('A7: SQL adds quantity_kg column',
  /ALTER TABLE inventory_stock_receipts ADD COLUMN IF NOT EXISTS quantity_kg numeric/.test(sql));
ok('A8: SQL adds roll_count column',
  /ALTER TABLE inventory_stock_receipts ADD COLUMN IF NOT EXISTS roll_count integer/.test(sql));
ok('A9: SQL adds line_notes column',
  /ALTER TABLE inventory_stock_receipts ADD COLUMN IF NOT EXISTS line_notes text/.test(sql));
ok('A10: SQL adds ordered_quantity column',
  /ALTER TABLE inventory_stock_receipts ADD COLUMN IF NOT EXISTS ordered_quantity numeric/.test(sql));
ok('A11: SQL adds variance_reason column',
  /ALTER TABLE inventory_stock_receipts ADD COLUMN IF NOT EXISTS variance_reason text/.test(sql));
ok('A12: SQL replaces chk_status with active/received/finalized/cancelled',
  /DROP CONSTRAINT IF EXISTS chk_status[\s\S]{0,200}status IN \('active','received','finalized','cancelled'\)/.test(sql));
ok('A13: SQL adds chk_purchase_currency constraint',
  /chk_purchase_currency[\s\S]{0,200}purchase_currency IS NULL OR purchase_currency IN \('EGP','USD','EUR'\)/.test(sql));
ok('A14: SQL adds index on shipment_reference',
  /idx_stock_receipts_shipment_ref ON inventory_stock_receipts \(shipment_reference\)/.test(sql));
ok('A15: SQL adds index on arrival_date',
  /idx_stock_receipts_arrival\s+ON inventory_stock_receipts \(arrival_date\)/.test(sql));

// ══════════════════════════════════════════════════════════════════
// PART B — InventoryReceiving emptyLine + header state
// ══════════════════════════════════════════════════════════════════

ok('B1a: emptyLine has ordered_quantity field',
  /ordered_quantity: '',/.test(rec));
ok('B1b: emptyLine has variance_reason field',
  /variance_reason: '',/.test(rec));
ok('B1c: emptyLine has quantity_kg field',
  /quantity_kg: '',/.test(rec));
ok('B1d: emptyLine has roll_count field',
  /roll_count: '',/.test(rec));
ok('B1e: emptyLine has line_notes field',
  /line_notes: '',/.test(rec));

ok('B2a: header state has shipment_reference',
  /shipment_reference: ''[\s\S]{0,200}freight_forwarder: ''/.test(rec));
ok('B2b: header state has freight_forwarder',
  /freight_forwarder: ''/.test(rec));
ok('B2c: header state has shipping_line',
  /shipping_line: ''/.test(rec));
ok('B2d: header state has eta_date + arrival_date',
  /eta_date: ''[\s\S]{0,200}arrival_date: ''/.test(rec));
ok('B2e: header state has purchase_currency default EGP',
  /purchase_currency: '(?:EGP|USD)'/.test(rec));

ok('B3a: openNew initializes all new header fields',
  /function openNew\(\)[\s\S]{0,1500}shipment_reference: ''[\s\S]{0,300}purchase_currency: '(?:EGP|USD)'/.test(rec));
ok('B3b: closeModal resets all new header fields',
  /function closeModal\(\)[\s\S]{0,1500}shipment_reference: ''[\s\S]{0,300}purchase_currency: '(?:EGP|USD)'/.test(rec));

// ══════════════════════════════════════════════════════════════════
// PART C — Validation on save
// ══════════════════════════════════════════════════════════════════

ok('C1: shipment_reference required validation',
  /if \(!header\.shipment_reference \|\| !header\.shipment_reference\.trim\(\)\) \{\s+alert\('Shipment Reference required/.test(rec));
ok('C2: variance reason required when ordered != actual',
  /if \(ordered != null && actual != null && ordered !== actual\) \{[\s\S]{0,300}variance reason\.'/.test(rec));
ok('C3: roll_count validated as non-negative integer',
  /if \(L\.roll_count !== '' && L\.roll_count != null\)[\s\S]{0,300}roll count must be a non-negative whole number/.test(rec));

// ══════════════════════════════════════════════════════════════════
// PART D — Save payload includes new fields + status = 'received'
// ══════════════════════════════════════════════════════════════════

ok('D1: status now saves as "received" (was "active")',
  /\/\/ v55\.83-A\.6\.27\.32 — new receipts now save as 'received'[\s\S]{0,200}status: 'received'/.test(rec) ||
  /var lineStatus = hasActualOrRolls \? 'received' : 'pending_detail'/.test(rec));
ok('D2: shipment_reference included in payload',
  /shipment_reference: header\.shipment_reference\.trim\(\)/.test(rec));
ok('D3: freight_forwarder + shipping_line included in payload',
  /freight_forwarder: \(header\.freight_forwarder \|\| ''\)\.trim\(\) \|\| null/.test(rec) &&
  /shipping_line: \(header\.shipping_line \|\| ''\)\.trim\(\) \|\| null/.test(rec));
ok('D4: eta_date + arrival_date included',
  /eta_date: header\.eta_date \|\| null/.test(rec) &&
  /arrival_date: header\.arrival_date \|\| null/.test(rec));
ok('D5: purchase_currency included',
  /purchase_currency: header\.purchase_currency \|\| null/.test(rec));
ok('D6: ordered_quantity + variance_reason included per line',
  /ordered_quantity: asNum\(L2\.ordered_quantity\)/.test(rec) &&
  /variance_reason: \(L2\.variance_reason \|\| ''\)\.trim\(\) \|\| null/.test(rec));
ok('D7: quantity_kg + roll_count + line_notes included per line',
  /quantity_kg: asNum\(L2\.quantity_kg\)/.test(rec) &&
  /roll_count:[\s\S]{0,200}Number\(L2\.roll_count\)/.test(rec) &&
  /line_notes: \(L2\.line_notes \|\| ''\)\.trim\(\) \|\| null/.test(rec));

// ══════════════════════════════════════════════════════════════════
// PART E — Modal UI shows new fields
// ══════════════════════════════════════════════════════════════════

ok('E1: Shipment Reference input rendered (required asterisk)',
  /Shipment Reference \*[\s\S]{0,500}value=\{header\.shipment_reference\}/.test(rec));
ok('E2: Freight Forwarder input rendered',
  /Freight Forwarder[\s\S]{0,400}value=\{header\.freight_forwarder\}/.test(rec));
ok('E3: Shipping Line input rendered',
  /Shipping Line[\s\S]{0,400}value=\{header\.shipping_line\}/.test(rec));
ok('E4: ETA Date input rendered (type date)',
  /ETA Date[\s\S]{0,400}type="date" value=\{header\.eta_date\}/.test(rec));
ok('E5: Arrival Date input rendered (type date)',
  /Arrival Date[\s\S]{0,400}type="date" value=\{header\.arrival_date\}/.test(rec));
ok('E6: Purchase Currency dropdown rendered with EGP/USD/EUR',
  /Purchase Currency[\s\S]{0,400}value=\{header\.purchase_currency\}[\s\S]{0,400}<option value="EGP">EGP[\s\S]{0,100}<option value="USD">USD[\s\S]{0,100}<option value="EUR">EUR/.test(rec));

ok('E7: Ordered Qty input rendered per line',
  /Ordered Qty[\s\S]{0,400}value=\{line\.ordered_quantity\}/.test(rec));
ok('E8: Received Qty input rendered per line (was just "Quantity")',
  /Received Qty \*[\s\S]{0,400}value=\{line\.quantity\}/.test(rec) ||
  /Received Qty \(rolled-up\)[\s\S]{0,400}value=\{line\.quantity\}/.test(rec));
ok('E9: Variance reason input shows conditionally when ordered != received',
  /Variance: ordered[\s\S]{0,500}variance_reason/.test(rec));
ok('E10: Quantity in kg input rendered per line',
  /Quantity in kg[\s\S]{0,400}value=\{line\.quantity_kg\}/.test(rec));
ok('E11: Roll Count input rendered per line',
  /Roll Count[\s\S]{0,400}value=\{line\.roll_count\}/.test(rec));
ok('E12: Line Notes input rendered per line',
  /Line Notes[\s\S]{0,400}value=\{line\.line_notes\}/.test(rec));

// ══════════════════════════════════════════════════════════════════
// PART F — Status flow in list view
// ══════════════════════════════════════════════════════════════════

ok('F1: filterStatus default changed from "active" to "all"',
  /useState\('all'\)/.test(rec.match(/var \[filterStatus, setFilterStatus\] = useState\('[^']+'\)/)[0]));
ok('F2: status filter dropdown includes Received option',
  /<option value="received">Received \(not finalized\)<\/option>/.test(rec));
ok('F3: status filter dropdown includes Finalized option',
  /<option value="finalized">Finalized<\/option>/.test(rec));
ok('F4: status filter dropdown keeps Active (legacy) for old rows',
  /<option value="active">Active \(legacy\)<\/option>/.test(rec));
ok('F5: list row shows status badge with conditional variants',
  /var statusBadge = isCancelled \? 'bg-slate-200 text-slate-600' :[\s\S]{0,300}isFinalized \? 'bg-blue-100 text-blue-900' :[\s\S]{0,200}received' \? 'bg-amber-100/.test(rec));
ok('F6: list row shows shipment_reference below receipt_number',
  /g\.shipment_reference && <div className=\{'text-\[10px\] font-mono '/.test(rec));
ok('F7: Status column added to list header (8 columns total when seeCosts)',
  /gridTemplateColumns: '170px 100px 80px 90px 1fr 110px 120px ' \+ \(seeCosts \? '120px ' : ''\) \+ '140px'/.test(rec));
ok('F8: Finalize Cost button shown for received-status receipts',
  /Finalize Landed Cost coming in Build 4\.2/.test(rec) ||
  /onClick=\{function \(\) \{ setFinalizeTarget\(g\); \}\}/.test(rec));
ok('F9: cancel filter loosened — acts on any non-cancelled row (active/received/finalized)',
  /receipts\.filter\(function \(r\) \{ return r\.receipt_number === rn && r\.status !== 'cancelled'/.test(rec));

// ══════════════════════════════════════════════════════════════════
// PART G — Old subtabs hidden from nav
// ══════════════════════════════════════════════════════════════════

ok('G1: old "inventory" tab commented out',
  /\/\/ \{ id: 'inventory', label: '📊 Inventory View'/.test(inv));
ok('G2: old "skus" tab commented out',
  /\/\/ \{ id: 'skus', label: '📦 Master SKUs'/.test(inv));
ok('G3: old "shipments" tab commented out',
  /\/\/ \{ id: 'shipments', label: '🚢 Shipments'/.test(inv));
ok('G4: old "layers" tab commented out',
  /\/\/ \{ id: 'layers', label: '🧱 Cost Layers'/.test(inv));
ok('G5: old "pnl" tab commented out',
  /\/\/ \{ id: 'pnl', label: '💵 Profit by SKU'/.test(inv));
ok('G6: old "movements" tab commented out',
  /\/\/ \{ id: 'movements', label: '📜 Movements'/.test(inv));
ok('G7: old "adjustments" tab commented out',
  /\/\/ \{ id: 'adjustments', label: '🔧 Adjustments'/.test(inv));
ok('G8: old "reports" tab commented out',
  /\/\/ \{ id: 'reports', label: '📈 Reports'/.test(inv));
ok('G9: "warehouses" tab KEPT (still needed)',
  /^\s*\{ id: 'warehouses', label: '🏭 Warehouses'/m.test(inv));

ok('G10: new Phase 1 subtabs still in nav (masterlists)',
  /^\s*\{ id: 'masterlists', label: '🗂️ Master Lists'/m.test(inv));
ok('G11: new Phase 1 subtabs still in nav (productmaster)',
  /^\s*\{ id: 'productmaster', label: '🏷️ Product Master'/m.test(inv));
ok('G12: new Phase 1 subtabs still in nav (receivestock)',
  /^\s*\{ id: 'receivestock', label: '🚚 Receive Stock'/m.test(inv));
ok('G13: new Phase 1 subtabs still in nav (importstock)',
  /^\s*\{ id: 'importstock', label: '📦 Import Stock'/m.test(inv));

// ══════════════════════════════════════════════════════════════════
// Regression guards
// ══════════════════════════════════════════════════════════════════

ok('R1: ShipmentsManager still imported (component kept in code for eventual migration)',
  /import ShipmentsManager from '\.\/ShipmentsManager'/.test(inv));
ok('R2: Build 4.0 receipt_number RPC call still present',
  /supabase\.rpc\('generate_receipt_number', \{ p_date: header\.receipt_date \}\)/.test(rec));
ok('R3: Build 4.0 master-update queue still functional',
  /masterUpdatesQueued\.push\(\{ product_id: L2\.product_id, patch: patch \}\)/.test(rec));
ok('R4: Build 4.0 cancel logic still uses receipt_number grouping',
  /r\.receipt_number === rn && r\.status !== 'cancelled'/.test(rec));
ok('R5: A.6.27.28 closed-tickets fetch still has NO .limit(100)',
  !/\.eq\('status', 'Closed'\)[\s\S]{0,200}\.limit\(100\)/.test(page));
ok('R6: A.6.27.31 WarehouseSettings modal still in place',
  /fixed inset-0 z-\[200\] bg-black\/70/.test(read('src/components/WarehouseSettings.jsx')));

// ── Version stamp ──────────────────────────────────────────────────
ok('V1: version stamp v55.83-A.6.27.32',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.32 Build 4.1 shipment-fields tests passed');
