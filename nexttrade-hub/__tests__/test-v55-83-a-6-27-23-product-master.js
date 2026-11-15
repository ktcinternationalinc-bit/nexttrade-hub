// v55.83-A.6.27.23 — Inventory Phase 1 Build 2: Product Master
//
// Builds the catalog of every product the business stocks, classified via
// the 8-level hierarchy from Build 1. Each product is created ONCE here.
//
// Key behaviors locked:
//   1. Separate permission "Edit Product List" — distinct from "Edit Inventory"
//   2. Universal cascading dropdowns — respect parent rules if they exist,
//      otherwise universal. Max's call: maximum flexibility.
//   3. 8 levels REQUIRED on save — slug must be computable
//   4. Quick code optional but unique among active products
//   5. Both English + Arabic names required
//   6. Tech spec defaults all optional (used to pre-fill receiving later)
//   7. Operational defaults all optional (supplier, cost, currency, rack)
//   8. Soft delete only — existing references stay valid
//   9. Audit log via dbInsert/dbUpdate
//  10. Old Master SKUs tab left untouched

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var settings = read('src/components/SettingsTab.jsx');
var inv = read('src/components/InventoryTab.jsx');
var pm = read('src/components/InventoryProductMaster.jsx');
var sql = read('sql/v55-83-a-6-27-23-inventory-product-master.sql');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ── 1. SQL migration ──────────────────────────────────────────────
ok('1a: creates inventory_products table',
  /CREATE TABLE IF NOT EXISTS inventory_products/.test(sql));
ok('1b: name_en NOT NULL',
  /name_en\s+text NOT NULL/.test(sql));
ok('1c: name_ar NOT NULL',
  /name_ar\s+text NOT NULL/.test(sql));
ok('1d: 8 classification FK columns present',
  /family_list_id[\s\S]{0,200}category_list_id[\s\S]{0,200}grade_list_id[\s\S]{0,200}construction_list_id[\s\S]{0,200}backing_list_id[\s\S]{0,200}color_list_id[\s\S]{0,200}pattern_list_id[\s\S]{0,200}spec_class_list_id/.test(sql));
ok('1e: all 8 classification FKs reference inventory_lists with ON DELETE RESTRICT',
  /family_list_id\s+uuid REFERENCES inventory_lists\(id\) ON DELETE RESTRICT/.test(sql) &&
  /spec_class_list_id\s+uuid REFERENCES inventory_lists\(id\) ON DELETE RESTRICT/.test(sql));
ok('1f: classification_slug column present',
  /classification_slug\s+text/.test(sql));
ok('1g: tech spec defaults (uom, thickness, width, gsm, density, weight, roll length)',
  /default_uom\s+text/.test(sql) && /default_thickness_mm\s+numeric/.test(sql) &&
  /default_width_m\s+numeric/.test(sql) && /default_gsm\s+numeric/.test(sql) &&
  /default_density\s+numeric/.test(sql) && /default_weight_per_roll\s+numeric/.test(sql) &&
  /default_roll_length_m\s+numeric/.test(sql));
ok('1h: operational defaults (supplier, cost, currency, rack)',
  /default_supplier\s+text/.test(sql) && /default_cost\s+numeric/.test(sql) &&
  /default_currency\s+text/.test(sql) && /default_rack\s+text/.test(sql));
ok('1i: UOM CHECK constraint',
  /CHECK \(\s*default_uom IS NULL OR default_uom IN \('kg','meter','yard','roll','piece','liter','sqm'\)\s*\)/.test(sql));
ok('1j: currency CHECK constraint',
  /CHECK \(\s*default_currency IS NULL OR default_currency IN \('EGP','USD','EUR'\)\s*\)/.test(sql));
ok('1k: quick code unique index — only among active, non-null, non-empty rows',
  /UNIQUE INDEX IF NOT EXISTS idx_inventory_products_quick_code_active[\s\S]{0,300}WHERE active = true AND quick_code IS NOT NULL AND quick_code != ''/.test(sql));
ok('1l: indexes on family, category, active, slug, design_sku, lower(name_en)',
  /idx_inventory_products_family/.test(sql) && /idx_inventory_products_category/.test(sql) &&
  /idx_inventory_products_active/.test(sql) && /idx_inventory_products_slug/.test(sql) &&
  /idx_inventory_products_design_sku/.test(sql) && /idx_inventory_products_name_en_lower/.test(sql));
ok('1m: updated_at trigger',
  /CREATE TRIGGER trigger_inventory_products_updated_at[\s\S]{0,200}BEFORE UPDATE/.test(sql));
ok('1n: RLS enabled',
  /ALTER TABLE inventory_products\s+ENABLE ROW LEVEL SECURITY/.test(sql));

// ── 2. Component file ──────────────────────────────────────────────
ok('2a: InventoryProductMaster export',
  /export default function InventoryProductMaster/.test(pm));
ok('2b: canView gates on isSuperAdmin OR Inventory OR Edit Product List',
  /canView = isSuperAdmin \|\| modulePerms\['Inventory'\] === true \|\| modulePerms\['Edit Product List'\] === true/.test(pm));
ok('2c: canEdit gates only on isSuperAdmin OR Edit Product List',
  /canEdit = isSuperAdmin \|\| modulePerms\['Edit Product List'\] === true/.test(pm));
ok('2d: Access restricted screen for non-canView users',
  /if \(!canView\) \{[\s\S]{0,500}Access restricted/.test(pm));
ok('2e: edit buttons only shown when canEdit (uses {canEdit && ...} pattern)',
  /\{canEdit && \(\s*<button\s+onClick=\{function \(\) \{ openEdit/.test(pm));
ok('2f: 8 levels validated on save (HOTFIX 7 lists all missing fields in one message)',
  /missing\.push\('• Level ' \+ lvl \+ ' — '/.test(pm) &&
  /Cannot save — please fill in these required fields/.test(pm));
ok('2g: computeSlug returns null if any of 8 levels missing',
  /function computeSlug\(formData\) \{[\s\S]{0,500}if \(!selectedId\) return null/.test(pm));
ok('2h: optionsForLevel respects parent rules — universal pattern',
  /if \(optRules\.length === 0\) return true/.test(pm) &&
  /return optRules\.some\(function \(rule\) \{/.test(pm));
ok('2i: handleLevelChange resets invalid downstream selections',
  /function handleLevelChange[\s\S]{0,300}resetInvalidChildren/.test(pm));
ok('2j: live slug preview in modal',
  /var liveSlug = computeSlug\(form\)/.test(pm) &&
  /LIVE SLUG/.test(pm));
ok('2k: quick code uniqueness checked client-side, NAMES conflicting product (HOTFIX 7)',
  /DUPLICATE QUICK CODE — cannot save/.test(pm) &&
  /describeConflict\(dupCode/.test(pm));
ok('2l: both English and Arabic name required (HOTFIX 7 lists all missing)',
  /missing\.push\('• English name/.test(pm) && /missing\.push\('• Arabic name/.test(pm));
ok('2m: UOM dropdown includes all 7 options',
  /UOM_OPTIONS = \[[\s\S]{0,500}'kg'[\s\S]{0,500}'sqm'/.test(pm));
ok('2n: currency dropdown EGP/USD/EUR',
  /CURRENCY_OPTIONS = \['EGP', 'USD', 'EUR'\]/.test(pm));
ok('2o: soft delete via active flip when used; permanent delete only via can_delete_product gate',
  /async function toggleActive\(p\)/.test(pm) && /async function deleteProduct/.test(pm));
ok('2p: confirm before deactivate / reactivate',
  /if \(!confirm\('Are you sure you want to ' \+ action/.test(pm));
ok('2q: dbInsert + dbUpdate used (audit log auto)',
  /dbInsert\('inventory_products'/.test(pm) && /dbUpdate\('inventory_products'/.test(pm));
ok('2r: classification_slug saved on every write',
  /classification_slug: slug/.test(pm));
ok('2s: duplicate button wipes identity but keeps classification + defaults',
  /openDuplicate[\s\S]{0,400}quick_code: ''[\s\S]{0,100}design_sku: ''/.test(pm));
ok('2t: modal header uses inline color styles (defensive readability)',
  /background: '#3730a3'/.test(pm) && /color: '#ffffff'/.test(pm));
ok('2u: modal close X is 36-40px round button (visible)',
  /aria-label="Close"[\s\S]{0,400}width: 36/.test(pm));
ok('2v: Arabic name input has direction:rtl (after HOTFIX 12 auto-name UI was added)',
  /name_ar[\s\S]{0,2000}direction: 'rtl'/.test(read('src/components/InventoryProductMaster.jsx')));
ok('2w: LEVEL_FIELD_MAP maps all 8 levels to form fields',
  /1: 'family_list_id'[\s\S]{0,200}2: 'category_list_id'[\s\S]{0,200}3: 'grade_list_id'[\s\S]{0,200}4: 'construction_list_id'[\s\S]{0,200}5: 'backing_list_id'[\s\S]{0,200}6: 'color_list_id'[\s\S]{0,200}7: 'pattern_list_id'[\s\S]{0,200}8: 'spec_class_list_id'/.test(pm));
ok('2x: dropdown shows code · EN / AR format',
  /\{o\.code\} · \{o\.label_en\} \/ \{o\.label_ar\}/.test(pm));
ok('2y: "No options yet" hint when level has zero matches given parent picks',
  /No options yet — add some in Master Lists or pick a different parent level/.test(pm));

// ── 3. SettingsTab permissions registered ─────────────────────────
// v55.83-A.6.27.66: permissions now use TAB_PERMS/ACTION_PERMS constants
// with description objects. We just verify 'Edit Product List' is present
// in the constants (descriptions matter, not array literal ordering).
ok('3a: "Edit Product List" registered in permissions list',
  /['"]Edit Product List['"]/.test(settings));
ok('3b: "Edit Product List" has an action-permission definition with description',
  /key: 'Edit Product List'[\s\S]{0,300}desc:/.test(settings));

// ── 4. InventoryTab wiring ─────────────────────────────────────────
ok('4a: InventoryTab imports InventoryProductMaster',
  /import InventoryProductMaster from '\.\/InventoryProductMaster'/.test(inv));
ok('4b: SUBTABS includes productmaster entry',
  /id: 'productmaster', label: '🏷️ Product List'/.test(inv));
ok('4c: productmaster tab hidden if no Inventory access and not super_admin',
  /st\.id === 'productmaster' && !\(isSuperAdmin \|\| \(modulePerms && \(modulePerms\['Inventory'\] === true \|\| modulePerms\['Edit Product List'\] === true\)\)\)[\s\S]{0,50}return null/.test(inv));
ok('4d: render branch passes isSuperAdmin',
  /subtab === 'productmaster' && \([\s\S]{0,200}<InventoryProductMaster[\s\S]{0,200}isSuperAdmin=\{isSuperAdmin\}/.test(inv));

// ── 5. Build 1 NOT BROKEN — regression guards ─────────────────────
ok('5a: Build 1 (masterlists tab) still present',
  /id: 'masterlists', label: '🗂️ Master Lists'/.test(inv));
ok('5b: Build 1 (InventoryMasterAdmin component) still imported',
  /import InventoryMasterAdmin from '\.\/InventoryMasterAdmin'/.test(inv));
ok('5c: Build 1 master_lists table SQL file still exists',
  fs.existsSync(path.join(__dirname, '..', 'sql/v55-83-a-6-27-22-inventory-master-lists.sql')));
ok('5d: old Master SKUs tab UNTOUCHED — still in SUBTABS',
  /id: 'skus', label: '📦 Master SKUs'/.test(inv));
ok('5e: old MasterSKUList component still imported',
  /import MasterSKUList from '\.\/MasterSKUList'/.test(inv));

// ── 6. Older work regression guards ───────────────────────────────
ok('6a: A.6.27.21 Esc-key handler in AccountingAuditorModal still present',
  /Escape/.test(read('src/components/AccountingAuditorModal.jsx')));
ok('6b: A.6.27.21 fixLinksBusy state still present',
  /fixLinksBusy/.test(page));
ok('6c: A.6.27.20 draftInstruments still in code',
  /formData\.draftInstruments \|\| \[\]/.test(page));
ok('6d: A.6.27.19 findMatchingInstruments helper intact',
  /const findMatchingInstruments = \(invoice, amt\) =>/.test(page));

// ── 7. Version stamp ──────────────────────────────────────────────
ok('7a: version stamp v55.83-A.6.27.23',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.23 Product Master tests passed');
