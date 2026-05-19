// v55.83-A.6.27.30 — Inventory Phase 1 Build 4.5: Bulk Import Legacy Stock
//
// One-time tool to bring existing inventory into the new classification
// system. Each row of the Excel = one row in inventory_stock_receipts
// with receipt_type = 'legacy_import'. NO new SQL.
//
// Permission: super_admin OR Edit Inventory (same as Build 4.0).
// Cost columns visibility tied to canSeeInventoryCosts helper.

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var imp = read('src/components/InventoryStockImport.jsx');
var inv = read('src/components/InventoryTab.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — InventoryStockImport component
// ══════════════════════════════════════════════════════════════════

// ── A1. Component setup + permission ───────────────────────────────
ok('A1a: InventoryStockImport component exists with default export',
  /export default function InventoryStockImport/.test(imp));
ok('A1b: imports canSeeInventoryCosts from inventory-permissions',
  /import \{ canSeeInventoryCosts \} from '\.\.\/lib\/inventory-permissions'/.test(imp));
ok('A1c: imports XLSX library',
  /import \* as XLSX from 'xlsx'/.test(imp));
ok('A1d: imports dbInsert helper',
  /import \{ supabase, dbInsert \} from '\.\.\/lib\/supabase'/.test(imp));
ok('A1e: canImport gates on isSuperAdmin OR Edit Inventory',
  /canImport = isSuperAdmin \|\| modulePerms\['Edit Inventory'\] === true/.test(imp));
ok('A1f: seeCosts uses canSeeInventoryCosts helper',
  /seeCosts = canSeeInventoryCosts\(userProfile, modulePerms\)/.test(imp));
ok('A1g: access-restricted screen shown when no canImport',
  /if \(!canImport\)[\s\S]{0,500}Access restricted/.test(imp));

// ── A2. Template headers conditional on seeCosts ───────────────────
ok('A2a: TEMPLATE_HEADERS is computed via IIFE',
  /var TEMPLATE_HEADERS = \(function \(\) \{/.test(imp));
ok('A2b: cost_per_uom + currency columns only added if seeCosts',
  /if \(seeCosts\) \{\s+base = base\.concat\(\['cost_per_uom', 'currency'\]\)/.test(imp));
ok('A2c: base headers include product_quick_code, quantity, uom, warehouse_name',
  /'product_quick_code'[\s\S]{0,300}'quantity'[\s\S]{0,300}'uom'[\s\S]{0,300}'warehouse_name'/.test(imp));
ok('A2d: tech spec override columns present',
  /'actual_thickness_mm'[\s\S]{0,200}'actual_width_m'[\s\S]{0,200}'actual_gsm'[\s\S]{0,200}'actual_density'/.test(imp));

// ── A3. Template generation ────────────────────────────────────────
ok('A3a: downloadTemplate creates a 4-sheet workbook',
  /XLSX\.utils\.book_append_sheet\(wb, impSheet, 'Stock Import'\)/.test(imp) &&
  /XLSX\.utils\.book_append_sheet\(wb, prodSheet, 'Products Reference'\)/.test(imp) &&
  /XLSX\.utils\.book_append_sheet\(wb, whSheet, 'Warehouses Reference'\)/.test(imp) &&
  /XLSX\.utils\.book_append_sheet\(wb, instrSheet, 'Instructions'\)/.test(imp));
ok('A3b: blocks download if no products exist (with friendly alert)',
  /if \(!products\.length\)[\s\S]{0,300}don\\'t have any products in the Product Master/.test(imp));
ok('A3c: blocks download if no warehouses exist',
  /if \(!warehouses\.length\)[\s\S]{0,300}don\\'t have any warehouses defined/.test(imp));
ok('A3d: Products Reference sheet only includes cost columns if seeCosts',
  /if \(seeCosts\) prodHeaders\.push\('Default Cost', 'Default Currency'\)/.test(imp));
ok('A3e: template filename stamped with ISO date',
  /'KTC-Legacy-Stock-Import-Template-' \+ stamp \+ '\.xlsx'/.test(imp));

// ── A4. Date parsing — handles Excel serial and string dates ───────
ok('A4a: asDate handles Excel SSF serial numbers',
  /XLSX\.SSF\.parse_date_code\(v\)/.test(imp));
ok('A4b: asDate handles YYYY-MM-DD strings directly',
  /\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\//.test(imp));
ok('A4c: asDate returns INVALID sentinel for unparseable values',
  /if \(isNaN\(parsed\.getTime\(\)\)\) return 'INVALID'/.test(imp));

// ── A5. Validation logic ───────────────────────────────────────────
ok('A5a: validateRows returns valid + errors buckets',
  /return \{ valid: valid, errors: errors \}/.test(imp));
ok('A5b: product_quick_code required',
  /if \(!quickCode\) \{\s+errs\.push\('product_quick_code required'\)/.test(imp));
ok('A5c: unknown product_quick_code rejected with row#',
  /errs\.push\('product_quick_code "' \+ quickCode \+ '" not found in Product Master/.test(imp));
ok('A5d: quantity required and must be > 0',
  /if \(qty === null\) errs\.push\('quantity required'\)/.test(imp) &&
  /else if \(qty <= 0\) errs\.push\('quantity must be greater than 0/.test(imp));
ok('A5e: warehouse_name required',
  /if \(!warehouseName\) errs\.push\('warehouse_name required'\)/.test(imp));
ok('A5f: unknown warehouse_name rejected with row#',
  /errs\.push\('warehouse_name "' \+ warehouseName \+ '" not found/.test(imp));
ok('A5g: uom validated against VALID_UOM if provided',
  /if \(uom && VALID_UOM\.indexOf\(uom\) < 0\)[\s\S]{0,200}uom must be one of:/.test(imp));
ok('A5h: currency validated against VALID_CURRENCY if provided',
  /if \(currency && VALID_CURRENCY\.indexOf\(currency\) < 0\)[\s\S]{0,200}currency must be one of:/.test(imp));
ok('A5i: receipt_date validated, invalid rejected with row#',
  /if \(receiptDate === 'INVALID'\)[\s\S]{0,200}receipt_date is invalid/.test(imp));
ok('A5j: numeric override columns validated',
  /\['cost_per_uom','actual_thickness_mm','actual_width_m','actual_gsm','actual_density','actual_weight_per_roll','actual_roll_length_m'\]\.forEach/.test(imp));

// ── A6. Defaults applied ───────────────────────────────────────────
ok('A6a: receipt_date defaults to today if blank',
  /receipt_date: receiptDate \|\| todayStr/.test(imp));
ok('A6b: uom inherits from product master if blank',
  /uom: uom \|\| product\.default_uom \|\| null/.test(imp));
ok('A6c: receipt_type forced to legacy_import',
  /receipt_type: 'legacy_import'/.test(imp));
ok('A6d: status forced to active',
  /status: 'active'/.test(imp));

// ── A7. Cost-access gating in commit payload ───────────────────────
ok('A7a: if !seeCosts, force cost/currency to null regardless of file',
  /if \(!seeCosts\) \{\s+resolvedCost = null;\s+total = null;\s+currency = null/.test(imp));

// ── A8. Commit flow ────────────────────────────────────────────────
ok('A8a: commitImport iterates parsedRows.valid',
  /for \(var i = 0; i < parsedRows\.valid\.length; i\+\+\)/.test(imp));
ok('A8b: each row gets its own generate_receipt_number RPC call',
  /supabase\.rpc\('generate_receipt_number', \{ p_date: row\.payload\.receipt_date \}\)/.test(imp));
ok('A8c: dbInsert into inventory_stock_receipts',
  /dbInsert\('inventory_stock_receipts', rowPayload, userProfile && userProfile\.id\)/.test(imp));
ok('A8d: stops on first DB error (per Max\'s call)',
  /catch \(err\) \{[\s\S]{0,300}break;/.test(imp));
ok('A8e: tracks first + last receipt numbers assigned',
  /firstReceipt: receiptNumbersAssigned\[0\] \|\| null/.test(imp) &&
  /lastReceipt: receiptNumbersAssigned\[receiptNumbersAssigned\.length - 1\] \|\| null/.test(imp));

// ── A9. Preview UI ─────────────────────────────────────────────────
ok('A9a: preview shows VALID + ERROR summary cards',
  /READY TO IMPORT[\s\S]{0,200}parsedRows\.valid\.length[\s\S]{0,400}ERRORS[\s\S]{0,200}parsedRows\.errors\.length/.test(imp));
ok('A9b: errors panel lists row# + quick_code + concatenated errors',
  /<span className="font-bold">Row \{e\.rowNum\}<\/span>[\s\S]{0,300}e\.errors\.join\(' · '\)/.test(imp));
ok('A9c: valid rows preview shows quick_code + quantity + uom + warehouse + batch',
  /v\.raw\.product_quick_code[\s\S]{0,300}v\.payload\.quantity[\s\S]{0,400}v\.warehouseName/.test(imp));
ok('A9d: cost shown in preview only when seeCosts',
  /seeCosts && v\.payload\.cost_per_uom != null/.test(imp));
ok('A9e: commit button disabled when no valid rows',
  /disabled=\{busy \|\| parsedRows\.valid\.length === 0\}/.test(imp));
ok('A9f: cost-permission notice shown to non-cost users on download step',
  /you don't have cost-view permission/.test(imp));

// ── A10. Helper banner explaining when to use this vs. Receive Stock
ok('A10a: helper banner present comparing this with Receive Stock',
  /When to use this vs\. Receive Stock[\s\S]{0,600}new shipments arriving from now on/.test(imp));

// ══════════════════════════════════════════════════════════════════
// PART B — InventoryTab wiring
// ══════════════════════════════════════════════════════════════════

ok('B1: InventoryTab imports InventoryStockImport',
  /import InventoryStockImport from '\.\/InventoryStockImport'/.test(inv));
ok('B2: SUBTABS includes importstock entry',
  /id: 'importstock', label: '📦 Import Stock'/.test(inv));
ok('B3: importstock tab gated to super_admin OR Edit Inventory',
  /st\.id === 'importstock' && !\(isSuperAdmin \|\| \(modulePerms && modulePerms\['Edit Inventory'\] === true\)\)/.test(inv));
ok('B4: render branch mounts InventoryStockImport with full props',
  /subtab === 'importstock' && \([\s\S]{0,300}<InventoryStockImport userProfile=\{userProfile\} modulePerms=\{modulePerms\} isSuperAdmin=\{isSuperAdmin\} toast=\{toast\}/.test(inv));

// ══════════════════════════════════════════════════════════════════
// Regression guards
// ══════════════════════════════════════════════════════════════════

ok('R1: Build 1 (InventoryMasterAdmin) still imported in InventoryTab',
  /import InventoryMasterAdmin from '\.\/InventoryMasterAdmin'/.test(inv));
ok('R2: Build 2 (InventoryProductMaster) still imported',
  /import InventoryProductMaster from '\.\/InventoryProductMaster'/.test(inv));
ok('R3: Build 3 (InventoryImportProducts) still imported',
  /import InventoryImportProducts from '\.\/InventoryImportProducts'/.test(inv));
ok('R4: Build 4.0 (InventoryReceiving) still imported',
  /import InventoryReceiving from '\.\/InventoryReceiving'/.test(inv));
ok('R5: A.6.27.28 closed-tickets fetch still has NO .limit(100)',
  !/\.eq\('status', 'Closed'\)[\s\S]{0,200}\.limit\(100\)/.test(page));
ok('R6: A.6.27.29 Receive Stock subtab still in SUBTABS',
  /id: 'receivestock', label: '🚚 Receive Stock'/.test(inv));
ok('R7: A.6.27.21 fixLinksBusy still in page.jsx',
  /fixLinksBusy/.test(page));

// ── Version stamp ──────────────────────────────────────────────────
ok('V1: version stamp v55.83-A.6.27.30',
  /BUILD v55\.83-A\.6\.27\.30/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.30 Build 4.5 Import Stock tests passed');
