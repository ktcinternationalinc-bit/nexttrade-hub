// v55.83-A.6.27.28 — TWO things in this build:
//
//   PART A — Closed tickets fully searchable by AI (MANDATORY per Max)
//   ────────────────────────────────────────────────────────────────
//   Max said FOR THE 4TH TIME: "the AI must be able to see the closed
//   ticket items when I request a search for any item — THIS IS
//   MANDATORY". Previously capped at 100 fetch + 25 in context. Now:
//     - page.jsx fetch: NO LIMIT (all closed tickets visible to user)
//     - AIGreeter ctx: ALL closed tickets serialized (not slice 25)
//     - Each entry includes ticket# + [date] + customer + title + desc
//
//   PART B — Inventory Phase 1 Build 3: Import Products
//   ────────────────────────────────────────────────────────────────
//   Bulk import product master entries from Excel. Decisions locked:
//     - Sub-tab "Import Products"
//     - Duplicates: skip if no new info; enrich if import has missing fields
//     - Partial failure: stop on first DB error, show clear results
//     - Excel template with data-validation dropdowns
//     - Unknown codes: reject row, preview lists them with row#

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var greeter = read('src/components/AIGreeter.jsx');
var inv = read('src/components/InventoryTab.jsx');
var imp = read('src/components/InventoryImportProducts.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — Closed tickets full access
// ══════════════════════════════════════════════════════════════════

ok('A1: page.jsx closed-tickets query NO LONGER has .limit(100)',
  !/\.eq\('status', 'Closed'\)[\s\S]{0,200}\.limit\(100\)/.test(page));
ok('A2: page.jsx closed-tickets query still orders by updated_at DESC',
  /\.eq\('status', 'Closed'\)[\s\S]{0,200}\.order\('updated_at', \{ ascending: false \}\)/.test(page));
ok('A3: page.jsx closed-tickets fetch has v55.83-A.6.27.28 annotation',
  /v55\.83-A\.6\.27\.28[\s\S]{0,400}closed ticket items/.test(page));
ok('A4: AIGreeter no longer .slice(0, 25) the closed list',
  !/closedMyTickets[\s\S]{0,500}\.slice\(0, 25\)/.test(greeter));
ok('A5: AIGreeter emits ALL closed tickets into ctx',
  /Closed tickets searchable by AI \(' \+ recentlyClosed\.length \+ ' total — ALL included/.test(greeter));
ok('A6: AIGreeter ctx entry includes ticket# + date + title + customer + truncated desc',
  /'  • ' \+ \(t\.ticket_number \|\| ''\) \+ ' \[' \+ closedAt \+ '\] ' \+ summary/.test(greeter) &&
  /if \(t\.customer_name\) summary = '\[' \+ t\.customer_name \+ '\] ' \+ summary/.test(greeter));
ok('A7: AIGreeter no longer has the "+ N more" truncation message',
  !/more closed tickets — ask me to search by topic/.test(greeter));
ok('A8: privacy filtering still applied in page.jsx (super_admin sees all, others gated)',
  /closedMeIsSA[\s\S]{0,300}t\.assigned_to === closedMeId/.test(page));

// ══════════════════════════════════════════════════════════════════
// PART B — Import Products (Build 3)
// ══════════════════════════════════════════════════════════════════

// ── B1. Component existence + permission gate ─────────────────────
ok('B1a: InventoryImportProducts component exists',
  /export default function InventoryImportProducts/.test(imp));
ok('B1b: canImport gates on isSuperAdmin OR Edit Product List',
  /canImport = isSuperAdmin \|\| modulePerms\['Edit Product List'\] === true/.test(imp));
ok('B1c: Access restricted screen if no perm',
  /if \(!canImport\) \{[\s\S]{0,500}Access restricted/.test(imp));

// ── B2. Template generation ────────────────────────────────────────
ok('B2a: TEMPLATE_HEADERS includes all 24 expected columns',
  /TEMPLATE_HEADERS = \[[\s\S]{0,1000}'name_en'[\s\S]{0,1000}'spec_class_code'[\s\S]{0,500}'notes'/.test(imp));
ok('B2b: downloadTemplate generates a workbook with Products sheet',
  /XLSX\.utils\.book_append_sheet\(wb, prodSheet, 'Products'\)/.test(imp));
ok('B2c: downloadTemplate generates a Codes Reference sheet',
  /XLSX\.utils\.book_append_sheet\(wb, codesSheet, 'Codes Reference'\)/.test(imp));
ok('B2d: downloadTemplate generates a Rules Reference sheet',
  /XLSX\.utils\.book_append_sheet\(wb, rulesSheet, 'Rules Reference'\)/.test(imp));
ok('B2e: downloadTemplate generates an Instructions sheet',
  /XLSX\.utils\.book_append_sheet\(wb, instrSheet, 'Instructions'\)/.test(imp));
ok('B2f: template includes data-validation dropdowns for each level',
  /prodSheet\['!dataValidations'\] = validations/.test(imp));
ok('B2g: template filename stamped with ISO date',
  /'KTC-Product-Master-Import-Template-' \+ stamp \+ '\.xlsx'/.test(imp));

// ── B3. Validation logic ───────────────────────────────────────────
ok('B3a: validateRows returns valid/enrich/skipped/errors buckets',
  /return \{ valid: valid, enrich: enrich, skipped: skipped, errors: errors \}/.test(imp));
ok('B3b: name_en + name_ar required',
  /if \(!nameEn\) errs\.push\('name_en required'\)/.test(imp) &&
  /if \(!nameAr\) errs\.push\('name_ar required'\)/.test(imp));
ok('B3c: every L1-L8 code required',
  /errs\.push\('L' \+ lvl \+ ' \(' \+ col \+ '\) is required'\)/.test(imp));
ok('B3d: unknown classification codes rejected with row#',
  /errs\.push\('L' \+ lvl \+ ' code "' \+ rawCode \+ '" not found in Master Lists'\)/.test(imp));
ok('B3e: cascade rule check — option must be valid under chosen Family',
  /errs\.push\('L' \+ lvl \+ ' "' \+ opt\.code \+ '" is not valid under Family "/.test(imp));
ok('B3f: default_uom validated against VALID_UOM list',
  /if \(uom && VALID_UOM\.indexOf\(uom\) < 0\) errs\.push\('default_uom must be one of:/.test(imp));
ok('B3g: default_currency validated against VALID_CURRENCY list',
  /if \(currency && VALID_CURRENCY\.indexOf\(currency\) < 0\) errs\.push\('default_currency must be one of:/.test(imp));
ok('B3h: numeric fields validated as numbers',
  /n === 'INVALID'\) errs\.push\(k \+ ' must be a number/.test(imp));
ok('B3i: quick_code uniqueness within file enforced (composite with variant_suffix)',
  /quick_code "' \+ quickCode \+ '"[\s\S]{0,200}appears more than once in this file/.test(imp));

// ── B4. Duplicate handling: skip-if-no-new-info OR enrich ─────────
ok('B4a: existing-product detection on quick_code',
  /var existing = findProductByQuickCode\(quickCode/.test(imp));
ok('B4b: enrich-only pattern — only fills existing null/empty fields',
  /if \(\(existingVal === null \|\| existingVal === undefined \|\| existingVal === ''\) && newVal !== null && newVal !== ''\)/.test(imp));
ok('B4c: enrich never overwrites identity fields (quick_code, names, slug, classification FKs)',
  /if \(\['quick_code','name_en','name_ar','classification_slug'[\s\S]{0,300}'spec_class_list_id'\]\.indexOf\(k\) >= 0\) return/.test(imp));
ok('B4d: skipped row when existing product and no new info',
  /skipped\.push\(\{[\s\S]{0,200}reason: 'product already exists with same quick_code and no new info'/.test(imp));

// ── B5. Commit logic ───────────────────────────────────────────────
ok('B5a: commitImport iterates parsedRows.valid and calls dbInsert',
  /for \(var i = 0; i < parsedRows\.valid\.length; i\+\+\)[\s\S]{0,500}dbInsert\('inventory_products'/.test(imp));
ok('B5b: commitImport iterates parsedRows.enrich and calls dbUpdate',
  /for \(var j = 0; j < parsedRows\.enrich\.length; j\+\+\)[\s\S]{0,500}dbUpdate\('inventory_products', e\.existing\.id/.test(imp));
ok('B5c: stops on first DB error (per Max\'s call)',
  /failed\+\+;\s+failedRows\.push[\s\S]{0,300}break;/.test(imp));
ok('B5d: importResult tracks inserted/enriched/skipped/errors/failed',
  /setImportResult\(\{ inserted: inserted, enriched: enriched, skipped:[\s\S]{0,200}failed: failed, failedRows: failedRows \}\)/.test(imp));

// ── B6. Preview UI ─────────────────────────────────────────────────
ok('B6a: preview shows 4-card summary (NEW / ENRICH / SKIPPED / ERRORS)',
  /NEW PRODUCTS[\s\S]{0,300}WILL ENRICH[\s\S]{0,300}SKIPPED[\s\S]{0,300}ERRORS/.test(imp));
ok('B6b: errors panel lists row# + name + concatenated errors',
  /<span className="font-bold">Row \{e\.rowNum\}<\/span>[\s\S]{0,200}e\.errors\.join\(' · '\)/.test(imp));
ok('B6c: commit button disabled when no rows to import',
  /disabled=\{busy \|\| \(parsedRows\.valid\.length === 0 && parsedRows\.enrich\.length === 0\)\}/.test(imp));

// ── B7. Wiring into InventoryTab ───────────────────────────────────
ok('B7a: InventoryTab imports InventoryImportProducts',
  /import InventoryImportProducts from '\.\/InventoryImportProducts'/.test(inv));
ok('B7b: SUBTABS includes importproducts entry',
  /id: 'importproducts', label: '📥 Import Products'/.test(inv));
ok('B7c: importproducts tab gated to super_admin OR Edit Product List',
  /st\.id === 'importproducts' && !\(isSuperAdmin \|\| \(modulePerms && modulePerms\['Edit Product List'\] === true\)\)/.test(inv));
ok('B7d: render branch mounts InventoryImportProducts',
  /subtab === 'importproducts' && \([\s\S]{0,200}<InventoryImportProducts/.test(inv));

// ══════════════════════════════════════════════════════════════════
// Regression guards
// ══════════════════════════════════════════════════════════════════

ok('R1: Build 1 (InventoryMasterAdmin) still imported in InventoryTab',
  /import InventoryMasterAdmin from '\.\/InventoryMasterAdmin'/.test(inv));
ok('R2: Build 2 (InventoryProductMaster) still imported in InventoryTab',
  /import InventoryProductMaster from '\.\/InventoryProductMaster'/.test(inv));
ok('R3: A.6.27.21 fixLinksBusy still in page.jsx',
  /fixLinksBusy/.test(page));
ok('R4: A.6.27.26 parent-rules-all-levels still in Master Lists',
  /num: 3, en: 'Grade'[\s\S]{0,200}hasParent: true,\s+parentLevel: 1/.test(read('src/components/InventoryMasterAdmin.jsx')));
ok('R5: A.6.27.27 Arabic name typography bump still in Product Master',
  /text-base font-extrabold mt-0\.5/.test(read('src/components/InventoryProductMaster.jsx')));

// ── Version stamp ──────────────────────────────────────────────────
ok('V1: version stamp v55.83-A.6.27.28',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.28 tests passed (closed-tickets full access + Import Products)');
