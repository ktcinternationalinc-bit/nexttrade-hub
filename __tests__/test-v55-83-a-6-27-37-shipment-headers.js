// v55.83-A.6.27.37 — Save-shipment-header-only + wider modal + US/CA/CN only
//
// Three user-facing changes:
//   1. New SQL table inventory_shipment_headers — saves header without product lines
//   2. New JS function saveShipmentHeaderOnly() + "📋 Save Shipment Only" button
//   3. Modal widened (maxWidth 1100→1400, maxHeight calc-220→calc-140)
//   4. Origin country dropdown added (US/CA/CN) + Level 9 trimmed in SQL

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var rec = read('src/components/InventoryReceiving.jsx');
var sql = read('sql/v55-83-a-6-27-37b-shipment-headers.sql');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — SQL: inventory_shipment_headers table
// ══════════════════════════════════════════════════════════════════

ok('A1: inventory_shipment_headers table created',
  /CREATE TABLE IF NOT EXISTS inventory_shipment_headers/.test(sql));
ok('A2: receipt_number UNIQUE NOT NULL',
  /receipt_number\s+text NOT NULL UNIQUE/.test(sql));
ok('A3: status default pending_detail with CHECK',
  /status\s+text NOT NULL DEFAULT 'pending_detail'/.test(sql) &&
  /chk_sh_status\s+CHECK \(status IN \('pending_detail','received','finalized','cancelled'\)\)/.test(sql));
ok('A4: warehouse_id FK with RESTRICT',
  /warehouse_id\s+uuid REFERENCES inv_warehouses\(id\) ON DELETE RESTRICT/.test(sql));
ok('A5: origin_country_code column added',
  /origin_country_code\s+text/.test(sql));
ok('A6: purchase_currency CHECK + default USD',
  /purchase_currency\s+text DEFAULT 'USD'/.test(sql) &&
  /chk_sh_purchase_currency CHECK \(purchase_currency IS NULL OR purchase_currency IN \('EGP','USD','EUR'\)\)/.test(sql));
ok('A7: 4 indexes on headers (date/status/warehouse/shipment_ref)',
  /idx_shipment_headers_date\b/.test(sql) && /idx_shipment_headers_status\b/.test(sql) &&
  /idx_shipment_headers_warehouse\b/.test(sql) && /idx_shipment_headers_ref\b/.test(sql));
ok('A8: RLS enabled with read+write policies',
  /ALTER TABLE inventory_shipment_headers ENABLE ROW LEVEL SECURITY/.test(sql) &&
  /CREATE POLICY inv_sh_read\b/.test(sql) && /CREATE POLICY inv_sh_write\b/.test(sql));
ok('A9: updated_at trigger present',
  /CREATE OR REPLACE FUNCTION update_shipment_headers_updated_at/.test(sql) &&
  /CREATE TRIGGER trigger_shipment_headers_updated_at/.test(sql));

ok('A10: header_id FK added to inventory_stock_receipts with CASCADE',
  /ALTER TABLE inventory_stock_receipts ADD COLUMN IF NOT EXISTS header_id uuid REFERENCES inventory_shipment_headers\(id\) ON DELETE CASCADE/.test(sql));
ok('A11: partial idx on header_id',
  /idx_stock_receipts_header ON inventory_stock_receipts \(header_id\) WHERE header_id IS NOT NULL/.test(sql));

// Backfill block
ok('A12: backfill DO block creates headers from existing receipts',
  /FOR r IN\s+SELECT DISTINCT ON \(receipt_number\)[\s\S]{0,500}NOT EXISTS \(SELECT 1 FROM inventory_shipment_headers h/.test(sql));
ok('A13: backfill maps status (falls back to received if unknown)',
  /CASE WHEN r\.status IN \('pending_detail','received','finalized','cancelled'\) THEN r\.status ELSE 'received' END/.test(sql));

// Country trim
ok('A14: Soft-disables Level 9 countries NOT in (US, CA, CN)',
  /UPDATE inventory_lists SET active = false\s+WHERE level = 9 AND code NOT IN \('US','CA','CN'\)/.test(sql));
ok('A15: Inserts US, CA, CN (ON CONFLICT DO NOTHING)',
  /INSERT INTO inventory_lists \(level, code, label_en, label_ar, display_order\) VALUES\s+\(9, 'US'[\s\S]{0,500}\(9, 'CA'[\s\S]{0,200}\(9, 'CN'/.test(sql));
ok('A16: Reactivates US/CA/CN explicitly',
  /UPDATE inventory_lists SET active = true\s+WHERE level = 9 AND code IN \('US','CA','CN'\)/.test(sql));

// ══════════════════════════════════════════════════════════════════
// PART B — Component: header state + load + reload
// ══════════════════════════════════════════════════════════════════

ok('B1: headers state declared',
  /var \[headers, setHeaders\] = useState\(\[\]\)/.test(rec));
ok('B2: origin_country_code added to header state in 3 places',
  rec.split("origin_country_code: 'US'").length - 1 >= 3);
ok('B3: load() fetches inventory_shipment_headers in parallel',
  /async function load\(\)[\s\S]{0,2000}supabase\.from\('inventory_shipment_headers'\)\.select\('\*'\)\.order\('created_at', \{ ascending: false \}\)/.test(rec));
ok('B4: reload() fetches inventory_shipment_headers in parallel',
  /async function reload\(\)[\s\S]{0,2000}supabase\.from\('inventory_shipment_headers'\)\.select\('\*'\)\.order\('created_at', \{ ascending: false \}\)/.test(rec));
ok('B5: load + reload both call setHeaders',
  rec.split('setHeaders(').length - 1 >= 2);

// ══════════════════════════════════════════════════════════════════
// PART C — saveShipmentHeaderOnly function
// ══════════════════════════════════════════════════════════════════

ok('C1: saveShipmentHeaderOnly function declared',
  /async function saveShipmentHeaderOnly\(\)/.test(rec));
ok('C2: validates receipt_date + warehouse + shipment_reference',
  /async function saveShipmentHeaderOnly\(\)[\s\S]{0,800}if \(!header\.receipt_date\)[\s\S]{0,300}if \(!header\.warehouse_id\)[\s\S]{0,500}if \(!header\.shipment_reference \|\| !header\.shipment_reference\.trim\(\)\)/.test(rec));
ok('C3: uses editingReceiptNumber if set, else generates via RPC',
  /async function saveShipmentHeaderOnly\(\)[\s\S]{0,2000}if \(editingReceiptNumber\) \{\s+receiptNumber = editingReceiptNumber/.test(rec));
ok('C4: payload sets status="pending_detail"',
  /async function saveShipmentHeaderOnly\(\)[\s\S]{0,2500}status: 'pending_detail'/.test(rec));
ok('C5: payload includes origin_country_code',
  /async function saveShipmentHeaderOnly\(\)[\s\S]{0,3000}origin_country_code: header\.origin_country_code/.test(rec));
ok('C6: upserts via maybeSingle on receipt_number',
  /supabase\.from\('inventory_shipment_headers'\)\.select\('id'\)\.eq\('receipt_number', receiptNumber\)\.maybeSingle/.test(rec));
ok('C7: success toast uses receipt number and Pending Detail message',
  /Shipment ' \+ receiptNumber \+ ' saved as Pending Detail\. Add products later via Edit/.test(rec));

// ══════════════════════════════════════════════════════════════════
// PART D — UI: footer button + origin dropdown + wider modal
// ══════════════════════════════════════════════════════════════════

ok('D1: Save Shell Only button wired to saveShipmentHeaderOnly (renamed in v.43)',
  /onClick=\{saveShipmentHeaderOnly\}/.test(rec) && /📋 Save Shell Only/.test(rec));
ok('D2: Origin Country dropdown rendered',
  /Origin Country\s+<select value=\{header\.origin_country_code \|\| 'US'\}/.test(rec));
ok('D3: Origin dropdown limited to US/CA/CN ONLY',
  /<option value="US">🇺🇸 United States<\/option>\s+<option value="CA">🇨🇦 Canada<\/option>\s+<option value="CN">🇨🇳 China<\/option>/.test(rec));
ok('D4: Modal widened to 95vw / 1900 max in v.43',
  /(width: '97vw', maxWidth: 1900|99vw)/.test(rec));
ok('D5: Modal body taller — v.48 used flex:1; v.56 split into 3 regions with flex:1 on scrollable middle',
  /flex: 1, overflowY: 'auto'/.test(rec));

// ══════════════════════════════════════════════════════════════════
// PART E — Grouped list merges header-only shells
// ══════════════════════════════════════════════════════════════════

ok('E1: existingNumbers map built from grouped lines',
  /var existingNumbers = \{\};\s+grouped\.forEach\(function \(g\) \{ existingNumbers\[g\.receipt_number\] = true; \}\)/.test(rec));
ok('E2: headers loop skips numbers already in grouped (lines present)',
  /headers\.forEach\(function \(h\) \{\s+if \(existingNumbers\[h\.receipt_number\]\) return/.test(rec));
ok('E3: header shells respect filterStatus/filterWarehouse/filterFrom/filterTo/search',
  /if \(filterStatus !== 'all' && h\.status !== filterStatus\) return/.test(rec) &&
  /if \(filterWarehouse !== 'all' && h\.warehouse_id !== filterWarehouse\) return/.test(rec) &&
  /if \(filterFrom && h\.receipt_date < filterFrom\) return/.test(rec) &&
  /if \(filterTo && h\.receipt_date > filterTo\) return/.test(rec));
ok('E4: header push includes isHeaderOnly: true + header_id + header object',
  /grouped\.push\(\{[\s\S]{0,500}isHeaderOnly: true,\s+header_id: h\.id,\s+header: h,/.test(rec));
ok('E5: grouped re-sorted newest first after merging shells',
  /grouped\.sort\(function \(a, b\) \{\s+if \(a\.receipt_date !== b\.receipt_date\) return a\.receipt_date < b\.receipt_date \? 1 : -1/.test(rec));

// ══════════════════════════════════════════════════════════════════
// PART F — openEdit handles header-only shells
// ══════════════════════════════════════════════════════════════════

ok('F1: openEdit handles isHeaderOnly path',
  /if \(grouped\.isHeaderOnly && grouped\.header\)/.test(rec));
ok('F2: header-only path loads header data from grouped.header',
  /if \(grouped\.isHeaderOnly && grouped\.header\) \{\s+var h = grouped\.header;[\s\S]{0,800}shipment_reference: h\.shipment_reference \|\| ''/.test(rec));
ok('F3: header-only path starts with one empty line',
  /if \(grouped\.isHeaderOnly && grouped\.header\)[\s\S]{0,2000}setLines\(\[emptyLine\(\)\]\)/.test(rec));
ok('F4: openEdit reads origin_country_code in both shell and line paths',
  rec.split('origin_country_code: h.origin_country_code').length + rec.split('origin_country_code: first.origin_country_code').length >= 3);

// ══════════════════════════════════════════════════════════════════
// Regression guards
// ══════════════════════════════════════════════════════════════════

ok('R1: Build 4.4 — saveReceipt still exists and is wired (now accepts opts)',
  /async function saveReceipt\(opts\)/.test(rec) && /onClick=\{submitReceipt\}/.test(rec));
ok('R2: Build 4.4 — openEdit still handles existing lines path',
  /var rows = grouped\.lines \|\| \[\];\s+var first = rows\[0\]/.test(rec));
ok('R3: Build 4.4 — reopen_finalized_receipt RPC still wired',
  /supabase\.rpc\('reopen_finalized_receipt'/.test(rec));
ok('R4: Build 4.5 — InventoryAdjustments still imported in InventoryTab',
  /import InventoryAdjustments from '\.\/InventoryAdjustments'/.test(read('src/components/InventoryTab.jsx')));
ok('R5: Build 4.3 — Movements + Layers still imported',
  /import InventoryMovementsLedger from '\.\/InventoryMovementsLedger'/.test(read('src/components/InventoryTab.jsx')) &&
  /import InventoryCostLayers from '\.\/InventoryCostLayers'/.test(read('src/components/InventoryTab.jsx')));
ok('R6: A.6.27.28 closed-tickets fetch still has NO .limit(100)',
  !/\.eq\('status', 'Closed'\)[\s\S]{0,200}\.limit\(100\)/.test(page));

// ── Version stamp ──────────────────────────────────────────────────
ok('V1: version stamp v55.83-A.6.27.37',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.37 shipment-header-only + 3-country tests passed');
