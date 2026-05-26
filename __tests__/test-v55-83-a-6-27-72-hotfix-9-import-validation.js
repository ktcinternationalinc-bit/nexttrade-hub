/* v72 HOTFIX 9 — Import Products: comprehensive duplicate detection + naming.
 *
 * Max asked: "make sure the import products and import shipments are working
 * as per these changes as well." (referring to HOTFIX 7 patterns)
 *
 * Import Products previously only checked quick_code for duplicates. Now mirrors
 * the single-product HOTFIX 7 flow:
 *   - Within-file: quick_code+suffix, classification_slug, name_en, name_ar
 *   - Against DB: same four fields
 *   - Every conflict NAMES the colliding product (existing row + import row number)
 *   - Quick_code check now includes INACTIVE products too
 *
 * Stock Import (Import Shipments) already follows the HOTFIX 7 pattern of
 * collecting all errors per row, so it needed no changes. */
var path = require('path');
var fs = require('fs');

function ok(name, cond) {
  if (!cond) { console.log('  ✗ ' + name); process.exitCode = 1; }
  else { console.log('  ✓ ' + name); }
}

var imp = fs.readFileSync(path.join(__dirname, '..', 'src/components/InventoryImportProducts.jsx'), 'utf8');
var stock = fs.readFileSync(path.join(__dirname, '..', 'src/components/InventoryStockImport.jsx'), 'utf8');

console.log('\n── HOTFIX 9 — Import Products: 4-way duplicate detection helpers ──');

ok('A1: findProductByQuickCode now includes INACTIVE products (HOTFIX 9 — was active-only)',
  /var pv = String\(p\.variant_suffix \|\| ''\)\.trim\(\);\s+return \(p\.quick_code \|\| ''\)\.toLowerCase\(\) === k && pv === v/.test(imp) &&
  !/return p\.active && \(p\.quick_code \|\| ''\)\.toLowerCase\(\) === k && pv === v/.test(imp));

ok('A2: findProductByNameEn helper exists (case-insensitive, trimmed)',
  /function findProductByNameEn\(name\)[\s\S]{0,300}\(p\.name_en \|\| ''\)\.trim\(\)\.toLowerCase\(\) === k/.test(imp));

ok('A3: findProductByNameAr helper exists',
  /function findProductByNameAr\(name\)[\s\S]{0,300}\(p\.name_ar \|\| ''\)\.trim\(\)\.toLowerCase\(\) === k/.test(imp));

ok('A4: findProductBySlug helper exists',
  /function findProductBySlug\(slug\)[\s\S]{0,200}p\.classification_slug === slug/.test(imp));

ok('A5: describeConflict helper produces named conflict string',
  /function describeConflict\(p\)[\s\S]{0,400}p\.active \? 'ACTIVE' : 'INACTIVE'/.test(imp));

console.log('\n── Within-file duplicate tracking (4 fields) ──');

ok('B1: tracks within-file quick_code+suffix collisions',
  /var seenQuickCodes = \{\}/.test(imp));

ok('B2: tracks within-file classification_slug collisions',
  /var seenSlugs = \{\}/.test(imp));

ok('B3: tracks within-file name_en collisions',
  /var seenNameEn = \{\}/.test(imp));

ok('B4: tracks within-file name_ar collisions',
  /var seenNameAr = \{\}/.test(imp));

ok('B5: within-file quick_code dup error uses DUPLICATE prefix + names the row',
  /DUPLICATE within file — quick_code "[\s\S]{0,200}already appears on row/.test(imp));

ok('B6: within-file English name dup error names the row',
  /DUPLICATE within file — English name "[\s\S]{0,200}already appears on row/.test(imp));

ok('B7: within-file Arabic name dup error names the row',
  /DUPLICATE within file — Arabic name "[\s\S]{0,200}already appears on row/.test(imp));

ok('B8: within-file classification slug dup error names the row',
  /DUPLICATE within file — classification slug "[\s\S]{0,200}already appears on row/.test(imp));

ok('B9: every within-file dup error ends with "No duplicates allowed"',
  (imp.match(/No duplicates allowed/g) || []).length >= 4);

console.log('\n── DB duplicate detection (names the colliding product) ──');

ok('C1: DB slug conflict detected and conflict described',
  /var dupSlug = findProductBySlug\(slug\)[\s\S]{0,400}DUPLICATE in database — classification slug[\s\S]{0,200}describeConflict\(dupSlug\)/.test(imp));

ok('C2: DB name_en conflict detected and conflict described',
  /var dupEn = findProductByNameEn\(nameEn\)[\s\S]{0,400}DUPLICATE in database — English name[\s\S]{0,200}describeConflict\(dupEn\)/.test(imp));

ok('C3: DB name_ar conflict detected and conflict described',
  /var dupAr = findProductByNameAr\(nameAr\)[\s\S]{0,400}DUPLICATE in database — Arabic name[\s\S]{0,200}describeConflict\(dupAr\)/.test(imp));

ok('C4: enrich/skipped paths NAME the existing product (was generic "product already exists")',
  /enrich\.push\(\{[\s\S]{0,300}conflictDesc: describeConflict\(existing\)/.test(imp) &&
  /skipped\.push\(\{[\s\S]{0,300}'Already exists: ' \+ describeConflict\(existing\)/.test(imp));

console.log('\n── Stock Import (Import Shipments) — already row-by-row validation ──');

ok('D1: Stock Import validateRows collects errors per row (matches HOTFIX 7 pattern)',
  /function validateRows\(rows[\s\S]{0,100}var errors = \[\][\s\S]{0,3000}errors\.push\(\{ rowNum: rowNum, raw: raw, errors: errs \}\)/.test(stock));

ok('D2: Stock Import row errors are arrays (multiple errors per row possible)',
  /var errs = \[\][\s\S]{0,3000}if \(errs\.length\)[\s\S]{0,200}errors\.push\(\{ rowNum: rowNum, raw: raw, errors: errs \}\)/.test(stock));

console.log('\n══════════════════════════════════════════════');
if (process.exitCode) console.log('FAILED');
else console.log('✅ HOTFIX 9 — Import flows aligned with HOTFIX 7 conventions');
console.log('══════════════════════════════════════════════');
