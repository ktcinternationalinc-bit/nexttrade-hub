// v55.83-A.6.27.40 — Star toggle in Product Master tab + Featured/Type filters
// + smart multi-keyword search + featured-first sort + FAMILY/VARIANT badges.

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var pm   = read('src/components/InventoryProductMaster.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — toggleFeatured function
// ══════════════════════════════════════════════════════════════════

ok('A1: toggleFeatured async function declared',
  /async function toggleFeatured\(p\)/.test(pm));
ok('A2: toggleFeatured flips featured to !(p.featured === true)',
  /var newVal = !\(p\.featured === true\)/.test(pm));
ok('A3: toggleFeatured calls dbUpdate(inventory_products) with featured field',
  /await dbUpdate\('inventory_products', p\.id, \{\s+featured: newVal,/.test(pm));
ok('A4: toggleFeatured shows star/unstar toast',
  /toast\.success\(\(newVal \? '⭐ Starred: ' : '☆ Unstarred: '\)/.test(pm));
ok('A5: toggleFeatured awaits reload after update',
  /toggleFeatured\(p\)[\s\S]{0,3000}await reload\(\)/.test(pm));
ok('A6: toggleFeatured handles errors with toast.error',
  /\[product-master\] toggleFeatured failed:[\s\S]{0,300}toast\.error\('Star toggle failed:/.test(pm));

// ══════════════════════════════════════════════════════════════════
// PART B — Star button in row UI
// ══════════════════════════════════════════════════════════════════

ok('B1: ⭐ star button wired to toggleFeatured',
  /onClick=\{function \(\) \{ toggleFeatured\(p\); \}\}/.test(pm));
ok('B2: filled star (⭐) when featured, hollow (☆) when not',
  /\{p\.featured === true \? '⭐' : '☆'\}/.test(pm));
ok('B3: button styled amber when featured, white-with-amber-outline when not (v.41+)',
  /\(p\.featured === true \? 'bg-amber-200 hover:bg-amber-300/.test(pm));
ok('B4: hover tooltip on star button explains the action',
  /title=\{p\.featured === true \? 'Featured — click to unstar/.test(pm));
ok('B5: star button gated on canEdit',
  /\{canEdit && \(\s+<button\s+onClick=\{function \(\) \{ toggleFeatured\(p\); \}\}/.test(pm));

// ══════════════════════════════════════════════════════════════════
// PART C — Quick code shows variant suffix + FAMILY/VARIANT badges
// ══════════════════════════════════════════════════════════════════

ok('C1: quick_code display appends variant_suffix for variants',
  /\{p\.quick_code\}\{p\.variant_suffix \? \('-' \+ p\.variant_suffix\) : ''\}/.test(pm));
ok('C2: TEMPLATE badge shown when is_family_template is true (renamed from FAMILY in .55)',
  /p\.is_family_template === true && \([\s\S]{0,200}TEMPLATE/.test(pm));
ok('C3: VARIANT/PRODUCT badge shown when not template and has suffix',
  /p\.is_family_template === false && p\.variant_suffix && \([\s\S]{0,200}(VARIANT|PRODUCT)/.test(pm));
ok('C4: use_count display when > 0',
  /Number\(p\.use_count \|\| 0\) > 0 && \([\s\S]{0,200}used \{p\.use_count\}×/.test(pm));

// ══════════════════════════════════════════════════════════════════
// PART D — Filters state + UI
// ══════════════════════════════════════════════════════════════════

ok('D1: featuredOnly state declared',
  /var \[featuredOnly, setFeaturedOnly\] = useState\(false\)/.test(pm));
ok('D2: typeFilter state declared (default changed to "variants" in .55 — templates pollute product list)',
  /var \[typeFilter, setTypeFilter\] = useState\('variants'\)/.test(pm));

ok('D3: Featured-only checkbox rendered',
  /⭐ Starred only/.test(pm) &&
  /<input type="checkbox" checked=\{featuredOnly\} onChange=\{function \(e\) \{ setFeaturedOnly\(e\.target\.checked\); \}\} \/>/.test(pm));
ok('D4: Type filter select with 3 options (Variants/Products rename — Variants first as default; Template Products + All)',
  /<option value="variants">(Variants|Products)/.test(pm) &&
  /<option value="all">All/.test(pm) &&
  /<option value="templates">Template Products only/.test(pm));

// ══════════════════════════════════════════════════════════════════
// PART E — Filter logic + smart multi-keyword search + featured sort
// ══════════════════════════════════════════════════════════════════

ok('E1: featuredOnly filters list to p.featured === true',
  /if \(featuredOnly\) \{\s+list = list\.filter\(function \(p\) \{ return p\.featured === true; \}\)/.test(pm));
ok('E2: typeFilter "templates" path filters to is_family_template === true',
  /if \(typeFilter === 'templates'\) \{\s+list = list\.filter\(function \(p\) \{ return p\.is_family_template === true; \}\)/.test(pm));
ok('E3: typeFilter "variants" path filters to !template AND variant_suffix',
  /typeFilter === 'variants'[\s\S]{0,500}return p\.is_family_template === false && p\.variant_suffix/.test(pm));

ok('E4: search splits on whitespace into keywords array',
  /var keywords = search\.trim\(\)\.toLowerCase\(\)\.split\(\/\\s\+\/\)/.test(pm));
ok('E5: search every keyword must appear as substring (AND not OR)',
  /for \(var i = 0; i < keywords\.length; i\+\+\) \{\s+if \(searchable\.indexOf\(keywords\[i\]\) < 0\) return false/.test(pm));
ok('E6: searchable concatenates quick_code + variant tag + names + sku + slug',
  /var searchable = \([\s\S]{0,500}\(p\.quick_code \|\| ''\)[\s\S]{0,300}\(p\.variant_suffix \? p\.quick_code \+ '-' \+ p\.variant_suffix \+ ' ' : ''\)[\s\S]{0,300}\(p\.classification_slug \|\| ''\)/.test(pm));

ok('E7: sort featured DESC first',
  /var af = a\.featured === true \? 1 : 0;\s+var bf = b\.featured === true \? 1 : 0;\s+if \(af !== bf\) return bf - af/.test(pm));
ok('E8: sort use_count DESC second',
  /var bu = Number\(b\.use_count \|\| 0\);\s+if \(bu !== au\) return bu - au/.test(pm));
ok('E9: sort name_en ASC last',
  /return \(a\.name_en \|\| ''\)\.localeCompare\(b\.name_en \|\| ''\)/.test(pm));
ok('E10: useMemo deps include featuredOnly and typeFilter',
  /\[products, showInactive, familyFilter, search, featuredOnly, typeFilter\]/.test(pm));

// ══════════════════════════════════════════════════════════════════
// Regression guards
// ══════════════════════════════════════════════════════════════════

ok('R1: A.6.27.39 — get_or_create_variant SQL still present',
  /CREATE OR REPLACE FUNCTION get_or_create_variant\(/.test(read('sql/v55-83-a-6-27-39-variants.sql')));
ok('R2: A.6.27.39 — emptyLine still has variant_category_code',
  /variant_category_code: ''/.test(read('src/components/InventoryReceiving.jsx')));
ok('R3: A.6.27.38 — REQUIRED_LEVELS still [1, 3, 6, 9]',
  /var REQUIRED_LEVELS = \[1, 3, 6, 9\]/.test(read('src/components/InventoryImportProducts.jsx')));
ok('R4: A.6.27.37 — saveShipmentHeaderOnly still exists',
  /async function saveShipmentHeaderOnly\(\)/.test(read('src/components/InventoryReceiving.jsx')));
ok('R5: A.6.27.28 closed-tickets fetch still has NO .limit(100)',
  !/\.eq\('status', 'Closed'\)[\s\S]{0,200}\.limit\(100\)/.test(page));
ok('R6: toggleActive function still exists (regression of B5)',
  /async function toggleActive\(p\)/.test(pm));

// ── Version stamp ──────────────────────────────────────────────────
ok('V1: version stamp v55.83-A.6.27.40',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.40 star toggle + filters tests passed');
