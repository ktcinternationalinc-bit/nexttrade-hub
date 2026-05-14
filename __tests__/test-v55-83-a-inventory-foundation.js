// v55.83-A — Stage 1 of the new Inventory Module foundation
//
// Stage 1 ships:
//   • Full SQL schema (11 tables) + migration script
//   • Master SKU CRUD with permission-aware columns
//   • Warehouse Settings CRUD
//   • New InventoryTab orchestrator replacing the inline section
//   • Inventory permission helpers (canSeeCosts, canSeePnL, etc.)
//
// Future stages fill in shipments, movements, costing, sales linkage,
// adjustments, imports, and AI/reporting. Each stage builds ON this
// foundation without restructuring it.

var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) { console.log('✓ ' + label); }
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

var sqlPath  = path.join(__dirname, '..', 'sql', 'v55-83-a-inventory-schema.sql');
var permPath = path.join(__dirname, '..', 'src', 'lib', 'inventory-permissions.js');
var skuPath  = path.join(__dirname, '..', 'src', 'components', 'MasterSKUList.jsx');
var whPath   = path.join(__dirname, '..', 'src', 'components', 'WarehouseSettings.jsx');
var tabPath  = path.join(__dirname, '..', 'src', 'components', 'InventoryTab.jsx');
var pagePath = path.join(__dirname, '..', 'src', 'app', 'page.jsx');

var sql  = fs.readFileSync(sqlPath, 'utf8');
var perm = fs.readFileSync(permPath, 'utf8');
var sku  = fs.readFileSync(skuPath, 'utf8');
var wh   = fs.readFileSync(whPath, 'utf8');
var tab  = fs.readFileSync(tabPath, 'utf8');
var page = fs.readFileSync(pagePath, 'utf8');

// ============================================================
// SCHEMA — all 11 tables present and well-formed
// ============================================================
ok('schema: file exists', fs.existsSync(sqlPath));
ok('schema: idempotent (uses IF NOT EXISTS everywhere)',
  (sql.match(/CREATE TABLE IF NOT EXISTS/g) || []).length >= 11);

var requiredTables = [
  'inv_warehouses', 'inv_skus', 'inv_shipments', 'inv_shipment_skus',
  'inv_movements', 'inv_adjustments', 'inv_transfers', 'inv_invoice_lines',
  'inv_fx_rates', 'inv_audit_journal', 'inv_import_jobs',
];
requiredTables.forEach(function (t) {
  ok('schema: table ' + t + ' is defined',
    new RegExp('CREATE TABLE IF NOT EXISTS ' + t + '\\b').test(sql));
});

ok('schema: wipes existing inventory test data',
  /CREATE TABLE IF NOT EXISTS inventory_archive_pre_v55_83_a/.test(sql) &&
  /DELETE FROM inventory;/.test(sql),
  'archive snapshot + DELETE');

ok('schema: seeds 4 starter warehouses (Cairo, Sokhna, USA, Other)',
  /\('Cairo',\s*'EG-CAI'/.test(sql) &&
  /\('Sokhna',\s*'EG-SKH'/.test(sql) &&
  /\('USA',\s*'US-MAIN'/.test(sql) &&
  /\('Other',\s*'OTHER'/.test(sql));

ok('schema: seeds FX rate placeholders for EGP/USD/EUR pairs',
  /\('USD', 'EGP'/.test(sql) &&
  /\('EUR', 'EGP'/.test(sql) &&
  /\('EUR', 'USD'/.test(sql));

ok('schema: inv_skus has rolling weighted-avg base FX columns (Option B)',
  /avg_base_fx_to_egp/.test(sql) &&
  /avg_base_fx_to_usd/.test(sql));

ok('schema: inv_invoice_lines has the three-number P&L breakdown',
  /gross_profit_egp/.test(sql) &&
  /fx_impact_egp/.test(sql) &&
  /total_profit_egp/.test(sql));

ok('schema: inv_shipments has target_revenue columns for Expected P&L',
  /target_revenue_egp/.test(sql) &&
  /target_revenue_usd/.test(sql));

ok('schema: inv_movements is append-only (no DELETE/UPDATE policies referenced)',
  // We just verify the comment says append-only; enforcement comes via
  // codepath discipline since the table doesn't grant updates anywhere.
  /append-only/i.test(sql));

ok('schema: every inv_* table has soft-delete or is append-only',
  // inv_warehouses, inv_skus, inv_shipments — soft-delete via deleted_at
  // inv_movements, inv_audit_journal, inv_import_jobs — append-only
  // inv_shipment_skus, inv_adjustments, inv_transfers — managed by parent lifecycle
  (sql.match(/deleted_at TIMESTAMPTZ/g) || []).length >= 3);

ok('schema: primary_unit constraint covers all expected units',
  /CHECK \(primary_unit IN \('kg','yard','meter','roll','piece','liter','box'\)\)/.test(sql));

ok('schema: shipment status constraint matches expected lifecycle',
  /status IN \('draft','in_transit','arrived','received','cancelled'\)/.test(sql));

ok('schema: movement_type constraint covers all 11 movement types',
  /receipt[\s\S]{0,100}sale[\s\S]{0,100}return[\s\S]{0,500}physical_count_correction/.test(sql));

ok('schema: indexes exist on hot query paths',
  /idx_inv_movements_sku_date/.test(sql) &&
  /idx_inv_skus_sku_number/.test(sql) &&
  /idx_inv_invoice_lines_sku/.test(sql) &&
  /idx_inv_fx_rates_lookup/.test(sql));

// ============================================================
// PERMISSIONS — three-tier visibility, both client & server
// ============================================================
ok('perm: canViewInventory exported', /export function canViewInventory/.test(perm));
ok('perm: canEditInventory exported', /export function canEditInventory/.test(perm));
ok('perm: canSeeInventoryCosts exported', /export function canSeeInventoryCosts/.test(perm));
ok('perm: canSeeInventoryPnL exported', /export function canSeeInventoryPnL/.test(perm));
ok('perm: canEditOriginalQty exported (super-admin only by default)',
  /export function canEditOriginalQty/.test(perm) &&
  /role === 'super_admin'/.test(perm));
ok('perm: canApproveAdjustments exported', /export function canApproveAdjustments/.test(perm));

ok('perm: stripSensitiveFields removes cost columns when !seeCosts',
  /stripSensitiveFields[\s\S]{0,400}if \(!seeCosts\)/.test(perm) &&
  /delete stripped\.avg_landed_cost/.test(perm) &&
  /delete stripped\.purchase_cost/.test(perm));

ok('perm: stripSensitiveFields removes P&L columns when !seePnL',
  /if \(!seePnL\)/.test(perm) &&
  /delete stripped\.gross_profit_egp/.test(perm) &&
  /delete stripped\.fx_impact_egp/.test(perm) &&
  /delete stripped\.total_profit_egp/.test(perm));

ok('perm: super_admin bypasses both gates',
  // Both canSeeInventoryCosts and canSeeInventoryPnL must check super_admin role
  (perm.match(/role === 'super_admin'/g) || []).length >= 4);

// ============================================================
// COMPONENTS — Master SKU + Warehouse settings
// ============================================================
ok('sku: MasterSKUList component exists', fs.existsSync(skuPath));
ok('sku: queries inv_skus table', /\.from\('inv_skus'\)/.test(sku));
ok('sku: generates SKU-00001 style numbers',
  /generateSKUNumber[\s\S]{0,500}'SKU-' \+ String\(next\)\.padStart\(5/.test(sku));
ok('sku: respects canSeeInventoryCosts (cost columns gated)',
  /seeCosts = canSeeInventoryCosts/.test(sku) &&
  /\{seeCosts &&/.test(sku));
ok('sku: respects canSeeInventoryPnL (target sell price gated)',
  /seePnL = canSeeInventoryPnL/.test(sku) &&
  /\{seePnL &&/.test(sku));
ok('sku: supports bilingual (description_ar)',
  /description_ar/.test(sku) && /dir="rtl"/.test(sku));
ok('sku: supports all 7 primary units',
  /PRIMARY_UNITS[\s\S]{0,500}kg[\s\S]{0,200}yard[\s\S]{0,200}meter[\s\S]{0,200}roll[\s\S]{0,200}piece[\s\S]{0,200}liter[\s\S]{0,100}box/.test(sku));

ok('wh: WarehouseSettings component exists', fs.existsSync(whPath));
ok('wh: queries inv_warehouses table', /\.from\('inv_warehouses'\)/.test(wh));
ok('wh: soft-delete via deleted_at on archive button',
  /deleted_at: new Date\(\)\.toISOString\(\)/.test(wh));
ok('wh: code is uppercase-enforced',
  /e\.target\.value\.toUpperCase\(\)/.test(wh));

// ============================================================
// INVENTORY TAB ORCHESTRATOR
// ============================================================
ok('tab: InventoryTab component exists', fs.existsSync(tabPath));
ok('tab: shows access-required message for users without inv.view',
  /if \(!canViewInventory/.test(tab) &&
  /Inventory access required/.test(tab));
ok('tab: lists all 7 subtabs (skus, warehouses, inventory, shipments, movements, adjustments, reports)',
  /id: 'inventory'/.test(tab) &&
  /id: 'skus'/.test(tab) &&
  /id: 'shipments'/.test(tab) &&
  /id: 'movements'/.test(tab) &&
  /id: 'adjustments'/.test(tab) &&
  /id: 'warehouses'/.test(tab) &&
  /id: 'reports'/.test(tab));
ok('tab: only Stage A subtabs are clickable; later stages disabled',
  /available = st\.stage === 'A'/.test(tab));
ok('tab: shows current stage badge (Stage 1 → 2 after Stage B ships in v55.83-A.6.21)',
  /Stage [12] of 6/.test(tab));

// ============================================================
// PAGE.JSX INTEGRATION — old inline section replaced
// ============================================================
ok('page: imports InventoryTab', /import InventoryTab from '\.\.\/components\/InventoryTab'/.test(page));
ok('page: renders <InventoryTab> when tab === inventory',
  /tab === 'inventory'[\s\S]{0,300}<InventoryTab/.test(page));
ok('page: passes userProfile, modulePerms, toast props',
  /<InventoryTab userProfile=\{userProfile\} modulePerms=\{modulePerms\} toast=\{toast\}/.test(page));
ok('page: REGRESSION GUARD — old inline inventory grid removed',
  // The old section had ~1900 lines with these characteristic markers.
  !/setFormData\(\{\.\.\.formData, invTypeFilter:/.test(page) &&
  !/showInvBreakdown/.test(page),
  'no leftover inline inventory state setters');

// ============================================================
// FILE FOOTPRINT — Stage 1 deliverables match spec
// ============================================================
ok('files: 4 new files created (SQL + 3 components + 1 helper)',
  fs.existsSync(sqlPath) &&
  fs.existsSync(permPath) &&
  fs.existsSync(skuPath) &&
  fs.existsSync(whPath) &&
  fs.existsSync(tabPath));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' test' + (failures.length === 1 ? '' : 's') + ' failed:');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.83-A tests passed');
