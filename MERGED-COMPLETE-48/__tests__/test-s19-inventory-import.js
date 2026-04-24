// ============================================================
// S19 (Apr 23 2026) — Inventory import + current-qty lock
// + historical received-by-date + expected vs actual reports
// ============================================================
var fs = require('fs');
var path = require('path');
var assert = require('assert');
var REPO = path.resolve(__dirname, '..');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('✓ ' + name); passed++; }
  catch (e) { console.log('✗ ' + name + ' — ' + e.message); failed++; }
}

var imp = fs.readFileSync(path.join(REPO, 'src/components/InventoryImport.jsx'), 'utf8');
var page = fs.readFileSync(path.join(REPO, 'src/app/page.jsx'), 'utf8');

// --- Component exists and parses ---
test('S19.1 InventoryImport component file exists', function() {
  assert(imp.length > 1000, 'file should have substantive content');
});
test('S19.2 Component is default-exported', function() {
  assert(/export default function InventoryImport/.test(imp),
    'default export named InventoryImport');
});

// --- Template includes all the popup fields Max asked for ---
test('S19.3 Template has Product ID column', function() {
  assert(/TEMPLATE_COLUMNS = \[[\s\S]*?'Product ID'/.test(imp), 'Product ID column in template');
});
test('S19.4 Template covers both Arabic and English description/color', function() {
  assert(/'Description \(Arabic\)'/.test(imp) && /'Description \(English\)'/.test(imp), 'both descriptions');
  assert(/'Color \(Arabic\)'/.test(imp) && /'Color \(English\)'/.test(imp), 'both colors');
});
test('S19.5 Template covers Original + Current + Expected qty', function() {
  assert(/'Original Quantity'/.test(imp) && /'Current Quantity'/.test(imp) && /'Expected Quantity'/.test(imp),
    'all three quantity columns');
});
test('S19.6 Template covers cost fields for each currency pair', function() {
  ['Purchase Cost','Purchase Currency','Customs Cost','Customs Currency','Shipping Cost','Shipping Currency','Other Cost','Other Currency','FX Rate'].forEach(function(c) {
    assert(imp.indexOf("'" + c + "'") > 0, 'template has ' + c);
  });
});
test('S19.7 Template includes Shipment Reference for expected/actual linking', function() {
  assert(/'Shipment Reference'/.test(imp), 'shipment reference column');
});
test('S19.8 Template has Instructions sheet explaining the three-qty flow', function() {
  assert(/THE THREE QUANTITY COLUMNS/.test(imp), 'three-qty instructions');
  assert(/IGNORED/.test(imp), 'explains ignore behavior');
});

// --- Download-template path writes an .xlsx with both sheets ---
test('S19.9 Template download creates workbook with Inventory + Instructions sheets', function() {
  assert(/XLSX\.utils\.book_append_sheet\(wb, ws, 'Inventory'\)/.test(imp));
  assert(/XLSX\.utils\.book_append_sheet\(wb, iws, 'Instructions'\)/.test(imp));
  assert(/XLSX\.writeFile\(wb, 'KTC_Inventory_Import_Template\.xlsx'\)/.test(imp));
});

// --- Current Quantity lock semantics ---
test('S19.10 Lock is detected — existing product flagged in preview rows', function() {
  assert(/_origWillBeIgnored: origWillBeIgnored/.test(imp),
    'parseRows marks rows whose product already exists AND provided an Original Quantity');
  assert(/_currWillBeIgnored: currWillBeIgnored/.test(imp),
    'parseRows marks rows whose product already exists AND provided a Current Quantity');
});
test('S19.11 Super-admin override flows through into new totals', function() {
  assert(/isSuperAdmin && overrideLock/.test(imp),
    'import only writes overrides when super-admin AND override checkbox is on');
  assert(/adjustmentsLogged\+\+/.test(imp),
    'super-admin override increments adjustmentsLogged counter');
});
test('S19.12 Non-super-admin hitting a locked row is counted in lockedIgnored', function() {
  assert(/lockedIgnored\+\+;/.test(imp), 'locked rows increment the ignored counter');
});
test('S19.13 Warning banner shown in preview for locked rows', function() {
  assert(/Current Quantity locked on existing products/.test(imp),
    'preview shows a warning banner for locked rows');
});

// --- Each row creates an inbound record ---
test('S19.14 Every imported row writes to inventory_inbounds', function() {
  assert(/dbInsert\('inventory_inbounds', inboundRecord/.test(imp),
    'import writes inbound record');
});

// --- Create vs aggregate parent row ---
test('S19.15 New product_id → dbInsert into inventory', function() {
  assert(/dbInsert\('inventory', \{[\s\S]{0,100}product_id: r\.product_id/.test(imp),
    'brand-new product_id inserts into inventory');
});
test('S19.16 Existing product_id → dbUpdate aggregating quantities', function() {
  assert(/dbUpdate\('inventory', existing\.id/.test(imp), 'existing goes through dbUpdate');
  assert(/newOrig = oldOrig \+ inboundQty/.test(imp), 'original_quantity is cumulative via Inbound Qty');
  assert(/newCurr = oldCurr \+ inboundQty/.test(imp), 'current_quantity is cumulative via Inbound Qty');
});

// --- Expected quantity written to separate table (does not affect actuals) ---
test('S19.17 Expected quantity writes to inventory_expected (separate table)', function() {
  assert(/dbInsert\('inventory_expected'/.test(imp),
    'expected qty goes into its own table');
  assert(/if \(r\.expected_quantity > 0 && r\.shipment_reference\)/.test(imp),
    'only writes if both expected qty and shipment ref are set');
});
test('S19.18 Missing inventory_expected table fails gracefully', function() {
  assert(/inventory_expected table missing — run the SQL/.test(imp),
    'user-friendly message when the table does not exist yet');
});

// --- Wiring into page.jsx ---
test('S19.19 InventoryImport is imported in page.jsx', function() {
  assert(/import InventoryImport from '\.\.\/components\/InventoryImport'/.test(page));
});
test('S19.20 Inventory tab has a 📥 Import button', function() {
  assert(/showInvImport: true/.test(page), 'state wire for import modal exists');
  assert(/📥 Import/.test(page), '📥 Import label exists');
});
test('S19.21 Inventory tab has Historical + Expected buttons', function() {
  assert(/showInvHistorical/.test(page), 'Historical button state wiring');
  assert(/showInvExpected/.test(page), 'Expected-vs-actual button state wiring');
});

// --- Historical report ---
test('S19.22 Historical report renders when flag is set', function() {
  assert(/formData\.showInvHistorical && \(\(\) => \{/.test(page),
    'historical report IIFE exists on inventory tab');
  assert(/📅 Inventory Received as of/.test(page),
    'historical modal title clear');
});
test('S19.23 Historical report sums inbounds up to chosen date', function() {
  assert(/if \(!ib\.inbound_date \|\| ib\.inbound_date > asOfDate\) return;/.test(page),
    'date cutoff applied to inbounds');
});
test('S19.24 Historical report clearly labels it as received-only (not full stock)', function() {
  assert(/Note: this counts received inbounds only/.test(page),
    'honest disclaimer about received-only semantics');
});

// --- Expected vs Actual report ---
test('S19.25 Expected-vs-Actual report IIFE present', function() {
  assert(/formData\.showInvExpected && \(\(\) => \{/.test(page),
    'expected vs actual modal exists');
});
test('S19.26 Report groups by shipment_reference', function() {
  assert(/byShipment\[e\.shipment_reference\]/.test(page),
    'groups by shipment');
});
test('S19.27 Report computes delta = actual - expected per product', function() {
  assert(/delta: v\.actual - v\.expected/.test(page),
    'delta calculation');
});
test('S19.28 Shows a friendly empty state when inventory_expected is missing or empty', function() {
  assert(/No expected quantities recorded yet/.test(page),
    'empty state message');
});

// --- Add Product popup: Current Quantity lock ---
test('S19.29 +Add Product popup locks Original+Current unless super-admin or Edit Inventory permission', function() {
  // S22.9 (Apr 23 2026) — widened the unlock check to accept not just
  // super-admin but also any user with the "Edit Inventory" module
  // permission, matching Max's spec: "a super admin or permissioned to change it".
  assert(/three-field inventory flow/.test(page),
    'three-field lock logic in add popup');
  assert(/canOverrideQty = userProfile\?\.role === 'super_admin' \|\| modulePerms\?\.\['Edit Inventory'\] === true/.test(page),
    'unlock gate accepts super_admin OR Edit Inventory permission');
  assert(/qtyLocked = !isFirstTime && !canOverrideQty/.test(page),
    'lock = existing product + no override permission');
});
test('S19.30 Locked inputs disabled in add popup', function() {
  assert(/disabled=\{qtyLocked\}/.test(page),
    'inputs disabled when qtyLocked');
});

// --- SQL artifact ---
test('S19.31 SQL file for inventory_expected ships with the build', function() {
  var sqlPath = path.join(REPO, 'sql/s19_inventory_expected.sql');
  assert(fs.existsSync(sqlPath), 'SQL file exists at sql/s19_inventory_expected.sql');
  var sql = fs.readFileSync(sqlPath, 'utf8');
  assert(/CREATE TABLE IF NOT EXISTS inventory_expected/.test(sql), 'SQL creates table');
  assert(/expected_quantity NUMERIC/.test(sql), 'has expected_quantity col');
  assert(/shipment_reference TEXT NOT NULL/.test(sql), 'shipment_reference col');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
