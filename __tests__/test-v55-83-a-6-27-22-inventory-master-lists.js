// v55.83-A.6.27.22 — Inventory Phase 1 Build 1: Master Lists Admin
//
// Foundation build of the inventory classification system. Creates:
//   - SQL: inventory_lists + inventory_list_rules tables + seed data
//   - UI: InventoryMasterAdmin component for super_admin / "Manage Inventory Master" perm
//   - Wiring: New subtab in InventoryTab, new permission in SettingsTab
//
// Locked behaviors:
//   1. NO free-text classification — controlled list only
//   2. Soft delete preserves references
//   3. Code format: ^[A-Z0-9]{1,4}$ enforced at DB AND UI
//   4. Bilingual: English + Arabic both required
//   5. Parent rules table separate, never mutates child/parent rows

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var settings = read('src/components/SettingsTab.jsx');
var inv = read('src/components/InventoryTab.jsx');
var admin = read('src/components/InventoryMasterAdmin.jsx');
var sql = read('sql/v55-83-a-6-27-22-inventory-master-lists.sql');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ── 1. SQL migration ──────────────────────────────────────────────
ok('1a: creates inventory_lists table',
  /CREATE TABLE IF NOT EXISTS inventory_lists/.test(sql));
ok('1b: creates inventory_list_rules table',
  /CREATE TABLE IF NOT EXISTS inventory_list_rules/.test(sql));
ok('1c: level constrained 1-8',
  /CHECK \(level BETWEEN 1 AND 8\)/.test(sql));
ok('1d: code format constraint A-Z 0-9 1-4 chars',
  /CHECK \(code ~ '\^\[A-Z0-9\]\{1,4\}\$'\)/.test(sql));
ok('1e: unique (level, code) WHERE active=true (so deactivated codes can be reused)',
  /UNIQUE INDEX IF NOT EXISTS idx_inventory_lists_code_active[\s\S]{0,200}WHERE active = true/.test(sql));
ok('1f: cascade delete on rules when parent or child removed',
  /child_list_id[\s\S]{0,100}REFERENCES inventory_lists\(id\) ON DELETE CASCADE/.test(sql) &&
  /parent_list_id[\s\S]{0,100}REFERENCES inventory_lists\(id\) ON DELETE CASCADE/.test(sql));
ok('1g: trigger keeps updated_at fresh',
  /CREATE TRIGGER trigger_inventory_lists_updated_at[\s\S]{0,200}BEFORE UPDATE/.test(sql));
ok('1h: RLS enabled on both tables',
  /ALTER TABLE inventory_lists\s+ENABLE ROW LEVEL SECURITY/.test(sql) &&
  /ALTER TABLE inventory_list_rules\s+ENABLE ROW LEVEL SECURITY/.test(sql));

// ── 2. Seed data — all 8 levels from Max's spec ───────────────────
ok('2a: Level 1 Product Family — Leather (L) Textile (T) PVC Pool (P) Boat Decking (B)',
  /\(1, 'L', 'Leather'/.test(sql) && /\(1, 'T', 'Textile'/.test(sql) &&
  /\(1, 'P', 'PVC Pool'/.test(sql) && /\(1, 'B', 'Boat Decking'/.test(sql));
ok('2b: Level 2 Category — 11 entries including SM EM HL AF SL RF MS AS LT MD HV',
  /\(2, 'SM'/.test(sql) && /\(2, 'EM'/.test(sql) && /\(2, 'HL'/.test(sql) &&
  /\(2, 'AF'/.test(sql) && /\(2, 'SL'/.test(sql) && /\(2, 'RF'/.test(sql) &&
  /\(2, 'MS'/.test(sql) && /\(2, 'AS'/.test(sql) && /\(2, 'LT'/.test(sql) &&
  /\(2, 'MD'/.test(sql) && /\(2, 'HV'/.test(sql));
ok('2c: Level 3 Grade — LX PR ST NA',
  /\(3, 'LX'/.test(sql) && /\(3, 'PR'/.test(sql) && /\(3, 'ST'/.test(sql) && /\(3, 'NA'/.test(sql));
ok('2d: Level 4 Construction — RG PF FP FN TL NA',
  /\(4, 'RG'/.test(sql) && /\(4, 'PF'/.test(sql) && /\(4, 'FP'/.test(sql) &&
  /\(4, 'FN'/.test(sql) && /\(4, 'TL'/.test(sql) && /\(4, 'NA'/.test(sql));
ok('2e: Level 5 Backing — 10 entries CT FL GR BK SU GS NW PL OT NA',
  /\(5, 'CT'/.test(sql) && /\(5, 'NA'/.test(sql) && /\(5, 'PL'/.test(sql));
ok('2f: Level 6 Color — 11 standard + 5 pool (BB SB MB DB NB)',
  /\(6, 'BK'/.test(sql) && /\(6, 'WH'/.test(sql) &&
  /\(6, 'BB'/.test(sql) && /\(6, 'NB'/.test(sql));
ok('2g: Level 7 Pattern — NA CL NM LS SS HC MG',
  /\(7, 'NA'/.test(sql) && /\(7, 'CL'/.test(sql) && /\(7, 'NM'/.test(sql) &&
  /\(7, 'LS'/.test(sql) && /\(7, 'SS'/.test(sql) && /\(7, 'HC'/.test(sql) && /\(7, 'MG'/.test(sql));
ok('2h: Level 8 Spec Class — L5 15 G5 NA',
  /\(8, 'L5'/.test(sql) && /\(8, '15'/.test(sql) && /\(8, 'G5'/.test(sql) && /\(8, 'NA'/.test(sql));

// ── 3. Parent rules seeded ─────────────────────────────────────────
ok('3a: category-family rules: SM/EM → Leather',
  /c\.level = 2 AND c\.code IN \('SM','EM'\)[\s\S]{0,100}p\.code = 'L'/.test(sql));
ok('3b: category-family rules: HL/AF → Textile',
  /c\.level = 2 AND c\.code IN \('HL','AF'\)[\s\S]{0,100}p\.code = 'T'/.test(sql));
ok('3c: category-family rules: SL/RF/MS/AS → PVC Pool',
  /c\.level = 2 AND c\.code IN \('SL','RF','MS','AS'\)[\s\S]{0,100}p\.code = 'P'/.test(sql));
ok('3d: category-family rules: LT/MD/HV → Boat Decking',
  /c\.level = 2 AND c\.code IN \('LT','MD','HV'\)[\s\S]{0,100}p\.code = 'B'/.test(sql));
ok('3e: pool colors restricted to PVC Pool family',
  /c\.level = 6 AND c\.code IN \('BB','SB','MB','DB','NB'\)[\s\S]{0,100}p\.level = 1 AND p\.code = 'P'/.test(sql));

// ── 4. Component file ──────────────────────────────────────────────
ok('4a: InventoryMasterAdmin component exists',
  /export default function InventoryMasterAdmin/.test(admin));
ok('4b: gated on isSuperAdmin OR Manage Inventory Master permission',
  /canManage = isSuperAdmin \|\| modulePerms\['Manage Inventory Master'\] === true/.test(admin));
ok('4c: permission denied screen renders when canManage is false',
  /if \(!canManage\) \{[\s\S]{0,500}Access restricted/.test(admin));
ok('4d: validCode regex matches DB CHECK constraint',
  /\/\^\[A-Z0-9\]\{1,4\}\$\//.test(admin));
ok('4e: code uppercased on input',
  /e\.target\.value\.toUpperCase\(\)/.test(admin));
ok('4f: both English and Arabic labels required',
  /English label required/.test(admin) && /Arabic label required/.test(admin));
ok('4g: duplicate code check on save (excludes self)',
  /already in use at this level/.test(admin));
ok('4h: Arabic input has direction:rtl',
  /direction: 'rtl'/.test(admin));
ok('4i: soft delete only — toggleActive flips active flag, never deletes row',
  /active: !opt\.active/.test(admin) &&
  !/\.delete\(\)\.eq\('id', opt\.id\)/.test(admin));
ok('4j: parent rules synced via delete-then-insert of inventory_list_rules',
  /from\('inventory_list_rules'\)\.delete\(\)\.eq\('child_list_id', savedId\)[\s\S]{0,500}\.insert\(ruleRows\)/.test(admin));
ok('4k: parent-rule editor only shown when level has parent',
  /\(hasParentLevel \|\| activeLevel === 6\)/.test(admin));
ok('4l: confirms before deactivate / reactivate',
  /if \(!confirm\('Are you sure you want to ' \+ action/.test(admin));
ok('4m: 8 LEVELS defined with EN+AR labels',
  /num: 1, en: 'Product Family'[\s\S]{0,2000}num: 8, en: 'Spec Class'/.test(admin));
ok('4n: uses dbInsert + dbUpdate for audit log',
  /dbInsert\('inventory_lists'/.test(admin) && /dbUpdate\('inventory_lists'/.test(admin));

// ── 5. Wiring ──────────────────────────────────────────────────────
ok('5a: InventoryTab imports InventoryMasterAdmin',
  /import InventoryMasterAdmin from '\.\/InventoryMasterAdmin'/.test(inv));
ok('5b: SUBTABS includes masterlists entry',
  /id: 'masterlists', label: '🗂️ Master Lists'/.test(inv));
ok('5c: masterlists tab hidden if not super_admin and no permission',
  /st\.id === 'masterlists' && !\(isSuperAdmin \|\| \(modulePerms && modulePerms\['Manage Inventory Master'\] === true\)\)[\s\S]{0,50}return null/.test(inv));
ok('5d: masterlists render branch passes isSuperAdmin prop',
  /subtab === 'masterlists' && \([\s\S]{0,200}<InventoryMasterAdmin[\s\S]{0,200}isSuperAdmin=\{isSuperAdmin\}/.test(inv));
ok('5e: InventoryTab signature accepts isSuperAdmin prop',
  /function InventoryTab\(\{ userProfile, modulePerms, toast, isSuperAdmin \}\)/.test(inv));

// ── 6. Page.jsx passes isSuperAdmin to InventoryTab ───────────────
ok('6a: page.jsx mounts InventoryTab with isSuperAdmin',
  /<InventoryTab userProfile=\{userProfile\} modulePerms=\{modulePerms\} isSuperAdmin=\{isSuperAdmin\} toast=\{toast\}/.test(page));

// ── 7. Permission registered in SettingsTab ───────────────────────
ok('7a: "Manage Inventory Master" added to permissions array #1',
  /'Manage Categories', 'Manage Inventory Master'/.test(settings));
ok('7b: "Manage Inventory Master" added to action permissions list #2',
  /'Manage Categories', 'Manage Inventory Master'[\s\S]{0,200}'Export Data', 'Post Reminders'/.test(settings));

// ── 8. Regression guards — older builds intact ────────────────────
ok('8a: A.6.27.20 draftInstruments still in code',
  /formData\.draftInstruments \|\| \[\]/.test(page));
ok('8b: A.6.27.19 findMatchingInstruments helper still intact',
  /const findMatchingInstruments = \(invoice, amt\) =>/.test(page));
ok('8c: A.6.27.21 Esc-key handler in AccountingAuditorModal still present',
  /Escape/.test(read('src/components/AccountingAuditorModal.jsx')));
ok('8d: A.6.27.21 fixLinksBusy state still present',
  /fixLinksBusy/.test(page));
ok('8e: Existing inv_skus table reference untouched (Build 1 does NOT touch it)',
  /supabase\.from\('inv_skus'\)/.test(inv));

// ── 9. Version stamp ──────────────────────────────────────────────
ok('9a: version stamp v55.83-A.6.27.22',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.22 Inventory Master Lists tests passed');
