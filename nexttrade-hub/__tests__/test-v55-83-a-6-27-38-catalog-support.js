// v55.83-A.6.27.38 — Catalog support + Universal ProductPicker
//
// SQL: featured + use_count + drop UNIQUE on quick_code + Level 9 + Pattern parent rules
// JS:  ProductPicker (3 modes — quick code prefix, keyword, cascade) + featured-first sort
//      + importer accepts featured column + relaxed validation (L1/L3/L6/L9 required only)

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var pp = read('src/components/ProductPicker.jsx');
var imp = read('src/components/InventoryImportProducts.jsx');
var sql = read('sql/v55-83-a-6-27-38-catalog-support.sql');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — SQL Migration
// ══════════════════════════════════════════════════════════════════

ok('A1: Fix Level CHECK constraint (1-8 → 1-9)',
  /ALTER TABLE inventory_lists DROP CONSTRAINT IF EXISTS inventory_lists_level_check;[\s\S]{0,300}CHECK \(level BETWEEN 1 AND 9\)/.test(sql));
ok('A2: Add Level 9 US (United States)',
  /INSERT INTO inventory_lists \(level, code, label_en, label_ar, display_order\) VALUES\s+\(9, 'US', 'United States'/.test(sql));
ok('A3: Add featured boolean column',
  /ALTER TABLE inventory_products ADD COLUMN IF NOT EXISTS featured boolean DEFAULT false/.test(sql));
ok('A4: Add use_count integer column',
  /ALTER TABLE inventory_products ADD COLUMN IF NOT EXISTS use_count integer DEFAULT 0/.test(sql));
ok('A5: Index on featured (partial, WHERE featured=true)',
  /CREATE INDEX IF NOT EXISTS idx_inv_products_featured\s+ON inventory_products \(featured\) WHERE featured = true/.test(sql));
ok('A6: Index on use_count DESC',
  /CREATE INDEX IF NOT EXISTS idx_inv_products_use_count ON inventory_products \(use_count DESC\)/.test(sql));
ok('A7: Drop UNIQUE on quick_code (idx_inv_products_quick_code_active)',
  /DROP INDEX IF EXISTS idx_inv_products_quick_code_active/.test(sql));
ok('A8: Replace with non-UNIQUE quick_code index',
  /CREATE INDEX IF NOT EXISTS idx_inv_products_quick_code ON inventory_products \(lower\(quick_code\)\) WHERE quick_code IS NOT NULL/.test(sql));
ok('A9: increment_product_use_count trigger function',
  /CREATE OR REPLACE FUNCTION increment_product_use_count\(\)[\s\S]{0,500}UPDATE inventory_products\s+SET use_count = COALESCE\(use_count, 0\) \+ 1\s+WHERE id = NEW\.product_id/.test(sql));
ok('A10: Trigger fires AFTER INSERT on inventory_stock_receipts',
  /CREATE TRIGGER trigger_increment_use_count_on_receipt\s+AFTER INSERT ON inventory_stock_receipts/.test(sql));
ok('A11: Add Leather Pattern rules (MG, RG, NA → L)',
  /INSERT INTO inventory_list_rules \(child_list_id, parent_list_id\)\s+SELECT c\.id, p\.id\s+FROM inventory_lists c, inventory_lists p\s+WHERE c\.level = 7 AND c\.code IN \('MG','RG','NA'\)\s+AND p\.level = 1 AND p\.code = 'L'/.test(sql));
ok('A12: Refresh classification_slug for existing products',
  /UPDATE inventory_products p\s+SET classification_slug = COALESCE\(\(SELECT code FROM inventory_lists WHERE id = p\.family_list_id\)/.test(sql));

// ══════════════════════════════════════════════════════════════════
// PART B — ProductPicker component
// ══════════════════════════════════════════════════════════════════

ok('B1: ProductPicker component default exported',
  /export default function ProductPicker/.test(pp));
ok('B2: Loads inventory_products + inventory_lists + inventory_list_rules in parallel',
  /Promise\.all\(\[qProducts, qLists, qRules, qLayers\]\)/.test(pp));
ok('B3: filterByStock branch fetches inventory_layers',
  /filterByStock\s+\? supabase\.from\('inventory_layers'\)\.select\('product_id,qty_remaining,warehouse_id'\)\.eq\('status', 'open'\)\.gt\('qty_remaining', 0\)/.test(pp));
ok('B4: Quick-code prefix search via .indexOf === 0',
  /isQuickCodeSearch && p\.quick_code && p\.quick_code\.toLowerCase\(\)\.indexOf\(qLower\) === 0/.test(pp));
ok('B5: Keyword search matches name_en + name_ar + slug',
  /p\.name_en && p\.name_en\.toLowerCase\(\)\.indexOf\(qLower\) >= 0/.test(pp) &&
  /p\.name_ar && p\.name_ar\.indexOf\(q\) >= 0/.test(pp) &&
  /p\.classification_slug && p\.classification_slug\.toLowerCase\(\)\.indexOf\(qLower\) >= 0/.test(pp));
ok('B6: Keyword search also matches FK labels (e.g. "embossed" → Category EM)',
  /\[1, 2, 3, 4, 5, 6, 7, 8, 9\]\.forEach\(function \(lvl\)[\s\S]{0,500}L\.label_en && L\.label_en\.toLowerCase\(\)\.indexOf\(qLower\) >= 0/.test(pp));
ok('B7: Cascade dropdowns filter by each picked level',
  /Object\.keys\(cascade\)\.forEach\(function \(lvlStr\)[\s\S]{0,400}p\[LEVEL_COLS\[lvl\]\.col\] === pickedId/.test(pp));
ok('B8: filterByStock filters products with stockByProduct[id] > 0',
  /filterByStock\) \{\s+list = list\.filter\(function \(p\) \{ return \(stockByProduct\[p\.id\] \|\| 0\) > 0/.test(pp));
ok('B9: Sort featured-first, then use_count desc, then alphabetical',
  /list\.sort\(function \(a, b\) \{[\s\S]{0,400}a\.featured \? 1 : 0[\s\S]{0,200}Number\(a\.use_count \|\| 0\)[\s\S]{0,300}qa\.localeCompare\(qb\)/.test(pp));
ok('B10: Cascade options respect Family parent rules',
  /function cascadeOptionsFor\(level\)[\s\S]{0,800}rules\.some\(function \(r\) \{ return r\.child_list_id === L\.id && r\.parent_list_id === family\.id/.test(pp));
ok('B11: Toggle featured via star button (canEdit-gated)',
  /async function toggleFeatured\(product, e\)[\s\S]{0,500}if \(!canEdit\) return[\s\S]{0,500}dbUpdate\('inventory_products', product\.id, \{ featured: nextFeatured \}/.test(pp));
ok('B12: ⭐ vs ☆ icons based on featured flag',
  /\{p\.featured \? '⭐' : '☆'\}/.test(pp));
ok('B13: Cap visible results at 200 with overflow message',
  /filtered\.slice\(0, 200\)\.map/.test(pp) &&
  /Showing first 200 of \{filtered\.length\} matches/.test(pp));
ok('B14: Cascade level 1 (Family) change resets all dependent levels',
  /if \(lvl === 1\) \{ next = e\.target\.value \? \{ 1: e\.target\.value \} : \{\}; \}/.test(pp));
ok('B15: Active cascade chips shown above results with ✕ remove',
  /Object\.keys\(cascade\)\.map\(function \(lvlStr\)[\s\S]{0,800}delete next\[lvl\]; setCascade\(next\)/.test(pp));
ok('B16: Header shows filtered.length count and "matches" label',
  /\{filtered\.length\} match\{filtered\.length === 1 \? '' : 'es'\}/.test(pp));
ok('B17: Empty-state message differs for filterByStock vs not',
  /No products with on-hand stock match your search\/filters/.test(pp));

// ══════════════════════════════════════════════════════════════════
// PART C — Importer relaxation + featured column
// ══════════════════════════════════════════════════════════════════

ok('C1: REQUIRED_LEVELS limited to [1, 3, 6, 9]',
  /var REQUIRED_LEVELS = \[1, 3, 6, 9\]/.test(imp));
ok('C2: LEVEL_COL includes origin_code at Level 9',
  /9: 'origin_code'/.test(imp));
ok('C3: LEVEL_FK includes origin_list_id at Level 9',
  /9: 'origin_list_id'/.test(imp));
ok('C4: Validator uses REQUIRED_LEVELS.indexOf(lvl) for is-required check',
  /var isRequired = REQUIRED_LEVELS\.indexOf\(lvl\) >= 0/.test(imp));
ok('C5: Importer parses featured column (TRUE/1/YES → true)',
  /var featuredRaw = String\(raw\.featured \|\| ''\)\.trim\(\)\.toUpperCase\(\)/.test(imp) &&
  /featured: featuredRaw === 'TRUE' \|\| featuredRaw === '1' \|\| featuredRaw === 'YES'/.test(imp));
ok('C6: TEMPLATE_HEADERS includes featured column',
  /'featured'/.test(imp));
ok('C7: Cascade rule check extended to Level 9',
  /\[2, 3, 4, 5, 6, 7, 8, 9\]\.forEach/.test(imp));

// ══════════════════════════════════════════════════════════════════
// PART D — Catalog Excel (verify the generator wrote correct row count)
// ══════════════════════════════════════════════════════════════════

ok('D1: Generator script exists',
  fs.existsSync(path.join(__dirname, '..', 'scripts/generate-leather-usa-full-catalog-v38.js')));
ok('D2: Generator builds quick_code from Family[0]+Grade[0]+Color+Country',
  /quick_code = FAMILY\.code\.charAt\(0\) \+ grade\.code\.charAt\(0\) \+ color\.code \+ COUNTRY\.code/.test(read('scripts/generate-leather-usa-full-catalog-v38.js')));
ok('D3: Generator uses Smooth-only-Black filter',
  /COLORS_SMOOTH = \[\s+\{ code: 'BK'/.test(read('scripts/generate-leather-usa-full-catalog-v38.js')));
ok('D4: Generator uses Embossed-only-MG+RG patterns (no HC)',
  /PATTERNS_EMBOSSED = \[\s+\{ code: 'MG'[\s\S]{0,300}\{ code: 'RG'/.test(read('scripts/generate-leather-usa-full-catalog-v38.js')) &&
  !/PATTERNS_EMBOSSED[\s\S]{0,300}'HC'/.test(read('scripts/generate-leather-usa-full-catalog-v38.js')));
ok('D5: Generator does NOT include FP construction',
  !/CONSTRUCTIONS = \[[\s\S]{0,400}code: 'FP'/.test(read('scripts/generate-leather-usa-full-catalog-v38.js')));
ok('D6: Generator does NOT include FL/OT/NA/GR backings',
  (function () {
    var src = read('scripts/generate-leather-usa-full-catalog-v38.js');
    var match = src.match(/const BACKINGS = \[([\s\S]*?)\];/);
    if (!match) return false;
    var backingsBlock = match[1];
    return !/code: 'FL'/.test(backingsBlock) &&
           !/code: 'OT'/.test(backingsBlock) &&
           !/code: 'NA'/.test(backingsBlock) &&
           !/code: 'GR'/.test(backingsBlock);
  })());
ok('D7: Generator excludes SW/DG/LG colors',
  !/COLORS_ALL = \[[\s\S]{0,1500}code: 'SW'/.test(read('scripts/generate-leather-usa-full-catalog-v38.js')) &&
  !/COLORS_ALL = \[[\s\S]{0,1500}code: 'DG'/.test(read('scripts/generate-leather-usa-full-catalog-v38.js')) &&
  !/COLORS_ALL = \[[\s\S]{0,1500}code: 'LG'/.test(read('scripts/generate-leather-usa-full-catalog-v38.js')));
ok('D8: Generator excludes Grade NA',
  !/GRADES = \[[\s\S]{0,500}code: 'NA'/.test(read('scripts/generate-leather-usa-full-catalog-v38.js')));
ok('D9: All rows start with featured = FALSE (Option E)',
  /featured: 'FALSE'/.test(read('scripts/generate-leather-usa-full-catalog-v38.js')));

// ══════════════════════════════════════════════════════════════════
// Regression guards
// ══════════════════════════════════════════════════════════════════

ok('R1: Build 4.3 — Movements + Layers still imported',
  /import InventoryMovementsLedger from '\.\/InventoryMovementsLedger'/.test(read('src/components/InventoryTab.jsx')));
ok('R2: Build 4.4 — reopen_finalized_receipt still in receiving',
  /supabase\.rpc\('reopen_finalized_receipt'/.test(read('src/components/InventoryReceiving.jsx')));
ok('R3: Build 4.5 — InventoryAdjustments still imported',
  /import InventoryAdjustments from '\.\/InventoryAdjustments'/.test(read('src/components/InventoryTab.jsx')));
ok('R4: Build 4.6 — saveShipmentHeaderOnly still in receiving (37 shipment-only feature)',
  /async function saveShipmentHeaderOnly\(\)/.test(read('src/components/InventoryReceiving.jsx')));
ok('R5: A.6.27.28 closed-tickets fetch still has NO .limit(100)',
  !/\.eq\('status', 'Closed'\)[\s\S]{0,200}\.limit\(100\)/.test(page));

// ── Version stamp ──────────────────────────────────────────────────
ok('V1: version stamp v55.83-A.6.27.38',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.38 catalog support + ProductPicker tests passed');
