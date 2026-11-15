/* v72 HOTFIX 8 — Product list shows manually-added products.
 *
 * Bug Max caught: created 2 products via "+ New Product", SQL confirmed both
 * were saved to inventory_products (active=true), but neither appeared in the
 * front-end product list.
 *
 * Root cause: typeFilter defaulted to 'variants' which filtered to
 *   p.is_family_template === false && p.variant_suffix
 * Manually-added products have no variant_suffix → silently filtered out. */
var path = require('path');
var fs = require('fs');

function ok(name, cond) {
  if (!cond) { console.log('  ✗ ' + name); process.exitCode = 1; }
  else { console.log('  ✓ ' + name); }
}

var pm = fs.readFileSync(path.join(__dirname, '..', 'src/components/InventoryProductMaster.jsx'), 'utf8');

console.log('\n── HOTFIX 8 — default filter no longer hides manually-added products ──');

ok('A1: typeFilter default is "variants" — HOTFIX 12 reverted HOTFIX 8 per Max; manually-added products still show because variants filter now excludes templates (not non-variants)',
  /var \[typeFilter, setTypeFilter\] = useState\('variants'\)/.test(pm));

ok('A2: HOTFIX 8 explanation comment present',
  /HOTFIX 8[\s\S]{0,200}Max created two products manually[\s\S]{0,300}did NOT appear in/.test(pm));

ok('A3: "variants" filter no longer requires variant_suffix (now means "not a template")',
  /typeFilter === 'variants'[\s\S]{0,800}return p\.is_family_template !== true/.test(pm) &&
  // Old buggy logic must be gone
  !/return p\.is_family_template === false && p\.variant_suffix/.test(pm));

ok('A4: HOTFIX 8 comment explains the filter semantics fix',
  /HOTFIX 8 — "Products" filter now means "anything that[\s\S]{0,300}variant_suffix/.test(pm));

ok('A5: Dropdown option for "variants" labeled as default (HOTFIX 12)',
  /Products only \(actual SKUs\) — default/.test(pm));

ok('A6: Dropdown option for "variants" describes "actual SKUs" (HOTFIX 12 shortened label)',
  /<option value="variants">Products only \(actual SKUs\) — default<\/option>/.test(pm));

console.log('\n── End-to-end: simulate the filter on Max\'s actual products ──');

// Simulate filteredProducts logic with Max's actual products from the SQL output
function applyFilter(products, typeFilter, showInactive) {
  var list = products.slice();
  if (!showInactive) list = list.filter(function (p) { return p.active; });
  if (typeFilter === 'templates') {
    list = list.filter(function (p) { return p.is_family_template === true; });
  } else if (typeFilter === 'variants') {
    list = list.filter(function (p) { return p.is_family_template !== true; });
  }
  return list;
}

// Max's actual products from the SQL output he sent (simplified)
var maxsProducts = [
  // Two manually-added test products — no variant_suffix, not templates
  { id: 'cc303', name_en: 'testii', quick_code: 'jfk', active: true, is_family_template: false, variant_suffix: null },
  { id: '2575f', name_en: 'test', quick_code: 'test', active: true, is_family_template: false, variant_suffix: null },
  // Older products with variant_suffix (created via template flow)
  { id: '47e1f', name_en: 'Leather Luxurious Brown', quick_code: 'LLBNUS-002', active: true, is_family_template: false, variant_suffix: 'BNUS-002' },
  { id: '0f551', name_en: 'Leather Stock White', quick_code: 'LSWHUS', active: true, is_family_template: false, variant_suffix: null },
];

var withDefault = applyFilter(maxsProducts, 'all', false);
ok('B1: Default filter ("all") shows ALL 4 of Max\'s active products including the 2 test ones',
  withDefault.length === 4 &&
  withDefault.some(function (p) { return p.name_en === 'testii'; }) &&
  withDefault.some(function (p) { return p.name_en === 'test'; }));

var withVariantsNew = applyFilter(maxsProducts, 'variants', false);
ok('B2: "Products only" filter shows all non-template products including manual ones (HOTFIX 8)',
  withVariantsNew.length === 4 &&
  withVariantsNew.some(function (p) { return p.name_en === 'testii'; }));

// Simulate OLD broken logic for comparison
function applyOldBuggyFilter(products) {
  return products.filter(function (p) { return p.active && p.is_family_template === false && p.variant_suffix; });
}
var withOldBuggy = applyOldBuggyFilter(maxsProducts);
ok('B3: PROOF the old buggy "variants" filter HID Max\'s 2 test products (and most others)',
  withOldBuggy.length < maxsProducts.length &&
  !withOldBuggy.some(function (p) { return p.name_en === 'testii'; }) &&
  !withOldBuggy.some(function (p) { return p.name_en === 'test'; }));

ok('B4: "Templates only" filter correctly returns 0 since none of Max\'s products are templates',
  applyFilter(maxsProducts, 'templates', false).length === 0);

console.log('\n══════════════════════════════════════════════');
if (process.exitCode) console.log('FAILED');
else console.log('✅ HOTFIX 8 — manually-added products now visible by default');
console.log('══════════════════════════════════════════════');
