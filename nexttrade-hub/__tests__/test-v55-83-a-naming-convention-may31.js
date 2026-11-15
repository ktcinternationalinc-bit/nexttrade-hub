// v55.83-A — Inventory naming convention (Max May 31 2026) + orphan family filter fix
//
// Locks:
//   1. Textile (TX) & Leather (LE)  → Family>Category>Grade>Construction>Color  [1,2,3,4,6]
//   2. PVC Pool (PV) & Boat Decking (BD) → Family>Category>Grade>Color>Pattern>Spec [1,2,3,6,7,8]
//   3. Default recipe falls back to the textile/leather order [1,2,3,4,6]
//   4. "Not Applicable" / "None" labels are dropped from composed names
//   5. Overview filter never renders a raw UUID for an orphaned/inactive list id

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var pm = read('src/components/InventoryProductMaster.jsx');
var ov = read('src/components/InventoryOverview.jsx');

var failures = [];
function ok(label, cond) { if (!cond) failures.push(label); }

// --- naming recipes ---
ok('TX recipe = [1,2,3,4,6]', /'TX':\s*\[1, 2, 3, 4, 6\]/.test(pm));
ok('TEXTILE recipe = [1,2,3,4,6]', /'TEXTILE':\s*\[1, 2, 3, 4, 6\]/.test(pm));
ok('LE recipe = [1,2,3,4,6]', /'LE':\s*\[1, 2, 3, 4, 6\]/.test(pm));
ok('LEATHER recipe = [1,2,3,4,6]', /'LEATHER':\s*\[1, 2, 3, 4, 6\]/.test(pm));
ok('PV recipe = [1,2,3,4,6,5,7,8]', /'PV':\s*\[1, 2, 3, 4, 6, 5, 7, 8\]/.test(pm));
ok('PVC recipe = [1,2,3,4,6,5,7,8]', /'PVC':\s*\[1, 2, 3, 4, 6, 5, 7, 8\]/.test(pm));
ok('BD recipe = [1,2,3,4,6,5,7,8]', /'BD':\s*\[1, 2, 3, 4, 6, 5, 7, 8\]/.test(pm));
ok('default recipe = [1,2,3,4,6]', /if \(!recipe\) recipe = \[1, 2, 3, 4, 6\];/.test(pm));

// --- old stale recipes must be gone ---
ok('old TEX [2,3,6,5] removed', !/'TEX':\s*\[2, 3, 6, 5\]/.test(pm));
ok('old default [1,3,6,5] removed', !/if \(!recipe\) recipe = \[1, 3, 6, 5\];/.test(pm));

// --- noise filtering ---
ok('NAME_NOISE_EN defined w/ not applicable', /NAME_NOISE_EN\s*=\s*\{[^}]*'not applicable'/.test(pm));
ok('NAME_NOISE_EN includes none', /NAME_NOISE_EN\s*=\s*\{[^}]*'none'/.test(pm));
ok('en parts skip noise', /NAME_NOISE_EN\[le\.toLowerCase\(\)\]/.test(pm));
ok('ar parts skip noise', /NAME_NOISE_AR\[la\]/.test(pm));

// --- overview orphan fallback no longer leaks UUID ---
ok('orphan excluded via master-list sourcing', /lists\s*\.filter\(function \(l\) \{ return l\.level === lvl; \}\)/.test(ov));
ok('raw ": id" fallback removed', !/label:\s*l \? \(\(l\.label_en \|\| ''\)[^]*?\)\s*:\s*id,/.test(ov));


// --- word de-duplication (Leather x3 -> Leather x1) ---
ok('dedupeWords helper defined (ProductMaster)', /function dedupeWords\(s\)/.test(pm));
ok('buildAutoName applies dedupe', /name_en: dedupeWords\(enParts\.join/.test(pm) && /name_ar: dedupeWords\(arParts\.join/.test(pm));
ok('import applies dedupe', /importDedupe\(enParts\.join/.test(read('src/components/InventoryImportProducts.jsx')));


// --- Overview: zero-stock shown by default + options sourced from master list ---
ok('zero-stock default true', /useState\(true\);\s*\/\/ Max May 31 2026: show zero-stock/.test(ov));
ok('filter options sourced from master list', /build the filter options from the MASTER LIST/.test(ov));
ok('filter cascades via parent rules', /optRules\.some/.test(ov) && /\},\s*\[lists, rules, filterLevels\]\);/.test(ov));
ok('rules loaded in Overview', /inventory_list_rules/.test(ov) && /setRules\(/.test(ov));
ok('old product-usage option builder removed', !/if \(match && p\[lvl\]\) ids\[p\[lvl\]\] = true;/.test(ov));

if (failures.length) {
  console.log('FAIL (' + failures.length + '):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
} else {
  console.log('PASS — inventory naming convention + orphan filter fix (' + 24 + ' checks)');
}
