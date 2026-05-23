// v55.83-A.6.27.39 — Variant system + smart multi-keyword search +
// family template flow at receipt time + Smooth-Black soft warning.

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var rec  = read('src/components/InventoryReceiving.jsx');
var imp  = read('src/components/InventoryImportProducts.jsx');
var sql  = read('sql/v55-83-a-6-27-39-variants.sql');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — SQL: variant columns + RPC function
// ══════════════════════════════════════════════════════════════════

ok('A1: is_family_template column added with default false',
  /ADD COLUMN IF NOT EXISTS is_family_template boolean NOT NULL DEFAULT false/.test(sql));
ok('A2: variant_suffix column added',
  /ADD COLUMN IF NOT EXISTS variant_suffix text/.test(sql));
ok('A3: parent_template_id self-FK with ON DELETE SET NULL',
  /ADD COLUMN IF NOT EXISTS parent_template_id uuid REFERENCES inventory_products\(id\) ON DELETE SET NULL/.test(sql));
ok('A4: index on is_family_template partial WHERE true',
  /idx_inv_products_family_template ON inventory_products \(is_family_template\) WHERE is_family_template = true/.test(sql));
ok('A5: index on parent_template_id partial',
  /idx_inv_products_parent_template ON inventory_products \(parent_template_id\) WHERE parent_template_id IS NOT NULL/.test(sql));
ok('A6: composite index parent_template_id + variant_suffix',
  /idx_inv_products_variant_suffix.*parent_template_id, variant_suffix/.test(sql));

ok('A7: get_or_create_variant function declared',
  /CREATE OR REPLACE FUNCTION get_or_create_variant\(/.test(sql));
ok('A8: function accepts 5 params (template_id + 4 codes + optional user)',
  /p_template_id\s+uuid,[\s\S]{0,300}p_category_code text,[\s\S]{0,300}p_construction_code text,[\s\S]{0,300}p_backing_code\s+text,[\s\S]{0,300}p_pattern_code\s+text,[\s\S]{0,300}p_user_id\s+uuid DEFAULT NULL/.test(sql));
ok('A9: function validates template exists',
  /SELECT \* INTO v_template FROM inventory_products WHERE id = p_template_id;[\s\S]{0,200}RAISE EXCEPTION 'Family template % not found'/.test(sql));
ok('A10: function checks is_family_template',
  /IF NOT v_template\.is_family_template THEN\s+RAISE EXCEPTION 'Product % is not a family template'/.test(sql));
ok('A11: function resolves all 4 level codes to list IDs',
  /SELECT id INTO v_category_id\s+FROM inventory_lists WHERE level = 2 AND code = p_category_code/.test(sql) &&
  /SELECT id INTO v_construction_id FROM inventory_lists WHERE level = 4 AND code = p_construction_code/.test(sql) &&
  /SELECT id INTO v_backing_id\s+FROM inventory_lists WHERE level = 5 AND code = p_backing_code/.test(sql) &&
  /SELECT id INTO v_pattern_id\s+FROM inventory_lists WHERE level = 7 AND code = p_pattern_code/.test(sql));
ok('A12: function silent-reuses existing variant if specs match',
  /SELECT id INTO v_variant_id\s+FROM inventory_products\s+WHERE parent_template_id = p_template_id[\s\S]{0,1000}IF v_variant_id IS NOT NULL THEN[\s\S]{0,200}RETURN v_variant_id;/.test(sql));
ok('A13: function computes next sequential suffix MAX+1',
  /COALESCE\(MAX\(CAST\(variant_suffix AS integer\)\), 0\) \+ 1/.test(sql));
ok('A14: function zero-pads suffix to 3 digits',
  /v_next_suffix := lpad\(v_next_n::text, 3, '0'\)/.test(sql));
ok('A15: function inserts new variant with parent_template_id link',
  /INSERT INTO inventory_products \(/.test(sql) &&
  /parent_template_id,[\s\S]{0,2500}p_template_id,/.test(sql));
ok('A16: classification_slug rebuilt with full 9 codes',
  /v_family_code \|\| '-' \|\| p_category_code \|\| '-' \|\| v_grade_code \|\| '-' \|\|[\s\S]{0,300}'-NA-' \|\| v_origin_code/.test(sql));

// ══════════════════════════════════════════════════════════════════
// PART B — Importer: accepts new columns
// ══════════════════════════════════════════════════════════════════

ok('B1: TEMPLATE_HEADERS includes is_family_template',
  /'is_family_template'/.test(imp));
ok('B2: TEMPLATE_HEADERS includes variant_suffix',
  /'variant_suffix'/.test(imp));
ok('B3: payload includes is_family_template boolean parsing',
  /is_family_template: String\(raw\.is_family_template \|\| ''\)\.trim\(\)\.toUpperCase\(\) === 'TRUE'/.test(imp));
ok('B4: payload includes variant_suffix (trimmed, null if empty)',
  /variant_suffix: String\(raw\.variant_suffix \|\| ''\)\.trim\(\) \|\| null/.test(imp));

ok('B5: in-file duplicate check uses composite key (quick_code + variant_suffix)',
  /var qk = quickCode\.toLowerCase\(\) \+ '\|' \+ variantSfx/.test(imp));
ok('B6: findProductByQuickCode accepts variantSuffix arg',
  /function findProductByQuickCode\(code, variantSuffix\)/.test(imp));
ok('B7: findProductByQuickCode compares both quick_code and variant_suffix',
  /var pv = String\(p\.variant_suffix \|\| ''\)\.trim\(\);\s+return p\.active && \(p\.quick_code \|\| ''\)\.toLowerCase\(\) === k && pv === v/.test(imp));
ok('B8: DB dedup call site passes payload.variant_suffix',
  /findProductByQuickCode\(quickCode, payload\.variant_suffix\)/.test(imp));

// ══════════════════════════════════════════════════════════════════
// PART C — Receiving: line model + validation + variant resolution
// ══════════════════════════════════════════════════════════════════

ok('C1: emptyLine() has variant_category_code field',
  /variant_category_code: ''/.test(rec));
ok('C2: emptyLine() has variant_construction_code field',
  /variant_construction_code: ''/.test(rec));
ok('C3: emptyLine() has variant_backing_code field',
  /variant_backing_code: ''/.test(rec));
ok('C4: emptyLine() has variant_pattern_code field',
  /variant_pattern_code: ''/.test(rec));
ok('C5: emptyLine() has resolved_variant_id field',
  /resolved_variant_id: ''/.test(rec));

ok('C6: save validation requires variant_category_code when is_family_template',
  /if \(L\.product && L\.product\.is_family_template === true\) \{\s+if \(!L\.variant_category_code\)/.test(rec));
ok('C7: save validation requires variant_construction_code',
  /if \(!L\.variant_construction_code\) \{\s+alert\('Line ' \+ \(i \+ 1\) \+ ': Construction required/.test(rec));
ok('C8: save validation requires variant_backing_code',
  /if \(!L\.variant_backing_code\) \{\s+alert\('Line ' \+ \(i \+ 1\) \+ ': Backing required/.test(rec));
ok('C9: save validation requires variant_pattern_code',
  /if \(!L\.variant_pattern_code\) \{\s+alert\('Line ' \+ \(i \+ 1\) \+ ': Pattern required/.test(rec));

ok('C10: save flow calls supabase.rpc(get_or_create_variant) for templates',
  /if \(L2\.product && L2\.product\.is_family_template === true\) \{\s+var vRes = await supabase\.rpc\('get_or_create_variant'/.test(rec));
ok('C11: RPC params include template_id + 4 codes + user_id',
  /p_template_id:\s+L2\.product_id,[\s\S]{0,300}p_category_code:\s+L2\.variant_category_code,[\s\S]{0,200}p_construction_code: L2\.variant_construction_code,[\s\S]{0,200}p_backing_code:\s+L2\.variant_backing_code,[\s\S]{0,200}p_pattern_code:\s+L2\.variant_pattern_code/.test(rec));
ok('C12: RPC error handling — toast + setBusy(false) + return',
  /if \(vRes\.error\) \{\s+console\.error\('\[receiving\] get_or_create_variant failed:[\s\S]{0,500}setBusy\(false\);\s+return/.test(rec));
ok('C13: payload.product_id uses effectiveProductId (variant if resolved)',
  /product_id: effectiveProductId,/.test(rec));

// ══════════════════════════════════════════════════════════════════
// PART D — UI: variant spec dropdowns visible for family templates
// ══════════════════════════════════════════════════════════════════

ok('D1: family template banner shown in product header',
  /Family template — fill the 4 spec dropdowns below to create or match a variant/.test(rec));
ok('D2: Category dropdown rendered with SM + EM options',
  /<option value="SM">SM · Smooth<\/option>\s+<option value="EM">EM · Embossed<\/option>/.test(rec));
ok('D3: Construction dropdown rendered with 5 options',
  /<option value="RG">RG · Regular<\/option>[\s\S]{0,200}<option value="PF">PF · Perforated<\/option>[\s\S]{0,200}<option value="FN">FN · Foam Non-Perforated<\/option>[\s\S]{0,200}<option value="FP">FP · Foam Perforated<\/option>[\s\S]{0,200}<option value="TL">TL · Tri-Lam<\/option>/.test(rec));
ok('D4: Backing dropdown rendered with 7 options',
  /<option value="BK">BK · Black<\/option>[\s\S]{0,300}<option value="CT">CT · Cotton<\/option>[\s\S]{0,500}<option value="OT">OT · Other<\/option>/.test(rec));
ok('D5: Pattern dropdown rendered with 4 options',
  /<option value="NA">NA · None<\/option>[\s\S]{0,200}<option value="HC">HC · Honeycomb<\/option>[\s\S]{0,200}<option value="MG">MG · Mechanical Grain<\/option>[\s\S]{0,200}<option value="RG">RG · Normal Emboss<\/option>/.test(rec));
ok('D6a: Smooth-Black soft warning conditional on Smooth category',
  /line\.variant_category_code === 'SM' && line\.product/.test(rec));
ok('D6b: Smooth-Black warning message present',
  /Smooth leather is typically only available in Black/.test(rec));

// ══════════════════════════════════════════════════════════════════
// PART E — Smart multi-keyword search
// ══════════════════════════════════════════════════════════════════

ok('E1: suggestionsFor splits query on whitespace',
  /var keywords = query\.trim\(\)\.toLowerCase\(\)\.split\(\/\\s\+\/\)/.test(rec));
ok('E2: every keyword must appear as substring (AND, not OR)',
  /for \(var i = 0; i < keywords\.length; i\+\+\) \{\s+if \(searchable\.indexOf\(keywords\[i\]\) < 0\) return false;\s+\}\s+return true/.test(rec));
ok('E3: searchable includes quick_code, name_en, name_ar, slug, suffix (v.49 expanded to also include design_sku + supplier + notes + classification text)',
  /var searchable = \(\s*\(p\.quick_code \|\| ''\) \+ ' ' \+[\s\S]{0,2000}\(p\.variant_suffix \? p\.quick_code \+ '-' \+ p\.variant_suffix \+ ' ' : ''\)[\s\S]{0,2000}\(p\.classification_slug \|\| ''\)/.test(rec));
ok('E4: sort featured DESC first',
  /\(b\.featured === true \? 1 : 0\) - \(a\.featured === true \? 1 : 0\)/.test(rec));
ok('E5: sort use_count DESC second',
  /var bu = Number\(b\.use_count \|\| 0\);\s+if \(bu !== au\) return bu - au/.test(rec));
ok('E6: results limited to 20 (was 10)',
  /return matches\.slice\(0, 20\)/.test(rec));

ok('E7: suggestion dropdown shows ⭐ for featured',
  /\{s\.featured === true && <span title="Featured" className="text-amber-500">⭐<\/span>\}/.test(rec));
ok('E8: suggestion dropdown shows TEMPLATE badge for templates (renamed in .55)',
  /\{s\.is_family_template === true && <span className=[^>]*>TEMPLATE<\/span>\}/.test(rec));
ok('E9: suggestion dropdown shows VARIANT or PRODUCT badge for variants',
  /\{s\.is_family_template === false && s\.variant_suffix && <span[^>]*>(VARIANT|PRODUCT)<\/span>\}/.test(rec));
ok('E10: suggestion dropdown shows use_count when > 0',
  /Number\(s\.use_count \|\| 0\) > 0 && <span[^>]*>used \{s\.use_count\}×<\/span>/.test(rec));
ok('E11: displayCode appends suffix for variants',
  /var displayCode = s\.variant_suffix \? \(s\.quick_code \+ '-' \+ s\.variant_suffix\) : s\.quick_code/.test(rec));

// ══════════════════════════════════════════════════════════════════
// Regression guards
// ══════════════════════════════════════════════════════════════════

ok('R1: A.6.27.38 — REQUIRED_LEVELS still [1, 3, 6, 9]',
  /var REQUIRED_LEVELS = \[1, 3, 6, 9\]/.test(imp));
ok('R2: A.6.27.37 — saveShipmentHeaderOnly still exists',
  /async function saveShipmentHeaderOnly\(\)/.test(rec));
ok('R3: A.6.27.35 — reopen_finalized_receipt still wired',
  /supabase\.rpc\('reopen_finalized_receipt'/.test(rec));
ok('R4: A.6.27.28 closed-tickets fetch still has NO .limit(100)',
  !/\.eq\('status', 'Closed'\)[\s\S]{0,200}\.limit\(100\)/.test(page));

// ── Version stamp ──────────────────────────────────────────────────
ok('V1: version stamp v55.83-A.6.27.39',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.39 variant + smart search tests passed');
