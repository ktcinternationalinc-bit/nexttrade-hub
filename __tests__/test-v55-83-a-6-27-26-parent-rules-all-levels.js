// v55.83-A.6.27.26 — Master Lists: parent rules on every level (2-8)
//
// Max requested: "go to level 3 luxurious — should be able to tell it what
// this is applicable to (just leather). Level 4 same thing. All leads back
// to level 1."
//
// Previously only Levels 2 (Category) and 6 (Color) exposed the parent-rule
// editor — Levels 3, 4, 5, 7, 8 did not. Universal application is what Max
// wants: every option below Level 1 can be restricted to specific Families.
//
// Fix: LEVELS array marks every level 2-8 with hasParent: true, parentLevel: 1.
// Modal UI gating simplified from `hasParentLevel || activeLevel === 6` to
// just `hasParentLevel`. Parent-rule sync logic in save() likewise simplified.
//
// Build 2's cascading dropdown logic already handles parent rules on ANY
// level — it reads all rules generically. So just by unlocking the admin UI
// here, the cascading dropdowns in Product Master will respect new rules
// automatically with NO Build 2 code changes.

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var admin = read('src/components/InventoryMasterAdmin.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ── 1. LEVELS array: every level 2-8 has parent rules ─────────────
ok('1a: Level 1 (Family) has NO parent (it IS the top)',
  /num: 1, en: 'Product Family'[\s\S]{0,200}hasParent: false, parentLevel: null/.test(admin));
ok('1b: Level 2 (Category) has parent rules → Level 1',
  /num: 2, en: 'Category'[\s\S]{0,200}hasParent: true,\s+parentLevel: 1/.test(admin));
ok('1c: Level 3 (Grade) has parent rules → Level 1 (NEW)',
  /num: 3, en: 'Grade'[\s\S]{0,200}hasParent: true,\s+parentLevel: 1/.test(admin));
ok('1d: Level 4 (Construction) has parent rules → Level 1 (NEW)',
  /num: 4, en: 'Construction'[\s\S]{0,200}hasParent: true,\s+parentLevel: 1/.test(admin));
ok('1e: Level 5 (Backing) has parent rules → Level 1 (NEW)',
  /num: 5, en: 'Backing'[\s\S]{0,200}hasParent: true,\s+parentLevel: 1/.test(admin));
ok('1f: Level 6 (Color) has parent rules → Level 1',
  /num: 6, en: 'Color'[\s\S]{0,200}hasParent: true,\s+parentLevel: 1/.test(admin));
ok('1g: Level 7 (Pattern) has parent rules → Level 1 (NEW)',
  /num: 7, en: 'Pattern'[\s\S]{0,200}hasParent: true,\s+parentLevel: 1/.test(admin));
ok('1h: Level 8 (Spec Class) has parent rules → Level 1 (NEW)',
  /num: 8, en: 'Spec Class'[\s\S]{0,200}hasParent: true,\s+parentLevel: 1/.test(admin));

// ── 2. Gating logic simplified ────────────────────────────────────
ok('2a: stale "activeLevel === 6" gate REMOVED from modal UI',
  !/\(hasParentLevel \|\| activeLevel === 6\)/.test(admin));
ok('2b: modal parent-rule section gated only by hasParentLevel',
  /\{hasParentLevel && \(/.test(admin));
ok('2c: save() parent-rule sync gated only by hasParentLevel',
  /\/\/ Sync parent rules — every level except Level 1 supports them\.[\s\S]{0,300}if \(hasParentLevel\) \{/.test(admin));

// ── 3. Parent-rule UI elements preserved ──────────────────────────
ok('3a: parent options query still filters by parentLevel from current level meta',
  /options\.filter\(function \(o\) \{ return o\.level === levelMeta\.parentLevel && o\.active; \}\)/.test(admin));
ok('3b: parent label "Valid under which Product Family" still present',
  /Valid under which Product Family\?/.test(admin));
ok('3c: empty-rules hint "applies to ALL families" still present',
  /leave all unchecked → applies to ALL families/.test(admin));
ok('3d: parent checkbox grid still renders parent options with code · label',
  /\{p\.code\} · \{p\.label_en\}/.test(admin));

// ── 4. Save logic regression guards ───────────────────────────────
ok('4a: delete-then-insert of inventory_list_rules still intact',
  /supabase\.from\('inventory_list_rules'\)\.delete\(\)\.eq\('child_list_id', savedId\)/.test(admin) &&
  /supabase\.from\('inventory_list_rules'\)\.insert\(ruleRows\)/.test(admin));
ok('4b: A.6.27.25 diagnostic console.log still present',
  /\[inv-master\] Save\/Add button CLICKED/.test(admin));
ok('4c: A.6.27.25 alert fallbacks still present',
  /alert\('Code must be 1-4 uppercase letters\/digits/.test(admin));
ok('4d: A.6.27.24 modal overlay still present',
  /fixed inset-0 z-\[200\] bg-black\/70/.test(admin));
ok('4e: A.6.27.24 Esc key handler still present',
  /Escape/.test(admin));

// ── 5. Regression guards on other builds ──────────────────────────
ok('5a: Build 2 (InventoryProductMaster) still imported in InventoryTab',
  /import InventoryProductMaster from '\.\/InventoryProductMaster'/.test(read('src/components/InventoryTab.jsx')));
ok('5b: Build 2 universal cascading logic in optionsForLevel still intact',
  /if \(optRules\.length === 0\) return true/.test(read('src/components/InventoryProductMaster.jsx')) &&
  /return optRules\.some\(function \(rule\) \{/.test(read('src/components/InventoryProductMaster.jsx')));
ok('5c: A.6.27.21 fixLinksBusy state still present in page.jsx',
  /fixLinksBusy/.test(page));

// ── 6. Version stamp ──────────────────────────────────────────────
ok('6a: version stamp v55.83-A.6.27.26',
  /BUILD v55\.83-A\.6\.27\.26/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.26 universal-parent-rules tests passed');
