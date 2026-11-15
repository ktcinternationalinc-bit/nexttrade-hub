// v55.83-A.6.27.38 — Importer accepts Level 9 (origin) + featured/active columns,
// only Levels 1/3/6/9 required, other levels optional with null FK.

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var imp  = read('src/components/InventoryImportProducts.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — LEVEL_COL + LEVEL_FK extended to 9 levels
// ══════════════════════════════════════════════════════════════════

ok('A1: LEVEL_COL has Level 9 → origin_code',
  /var LEVEL_COL = \{[\s\S]{0,500}9: 'origin_code'/.test(imp));
ok('A2: LEVEL_FK has Level 9 → origin_list_id',
  /var LEVEL_FK = \{[\s\S]{0,500}9: 'origin_list_id'/.test(imp));
ok('A3: REQUIRED_LEVELS constant = [1, 3, 6, 9]',
  /var REQUIRED_LEVELS = \[1, 3, 6, 9\]/.test(imp));

// ══════════════════════════════════════════════════════════════════
// PART B — Template headers updated
// ══════════════════════════════════════════════════════════════════

ok('B1: TEMPLATE_HEADERS includes origin_code',
  /'origin_code'/.test(imp));
ok('B2: TEMPLATE_HEADERS includes classification_slug',
  /'classification_slug'/.test(imp));
ok('B3: TEMPLATE_HEADERS includes featured',
  /'featured'/.test(imp));
ok('B4: TEMPLATE_HEADERS includes active',
  /TEMPLATE_HEADERS = \[[\s\S]{0,2000}'active'/.test(imp));

// ══════════════════════════════════════════════════════════════════
// PART C — Validation loop relaxed
// ══════════════════════════════════════════════════════════════════

ok('C1: validation loop iterates 1-9 (was 1-8)',
  /\[1, 2, 3, 4, 5, 6, 7, 8, 9\]\.forEach\(function \(lvl\)/.test(imp));
ok('C2: isRequired check against REQUIRED_LEVELS',
  /var isRequired = REQUIRED_LEVELS\.indexOf\(lvl\) >= 0/.test(imp));
ok('C3: only required levels error when missing',
  /if \(!rawCode\) \{\s+if \(isRequired\) \{\s+errs\.push\('L' \+ lvl \+ ' \(' \+ col \+ '\) is required'\)/.test(imp));
ok('C4: cascade check extended to Level 9',
  /\[2, 3, 4, 5, 6, 7, 8, 9\]\.forEach\(function \(lvl\) \{\s+var opt = resolvedLevels\[lvl\];\s+if \(opt && !familyValidForChild/.test(imp));

// ══════════════════════════════════════════════════════════════════
// PART D — Payload includes optional FKs + origin + featured + active
// ══════════════════════════════════════════════════════════════════

ok('D1: payload classification_slug spans all 9 levels with dash separator',
  /var slug = \[1,2,3,4,5,6,7,8,9\]\.map\(function \(l\) \{\s+return resolvedLevels\[l\] \? resolvedLevels\[l\]\.code : ''/.test(imp));
ok('D2: slug joined with dashes (not dots)',
  /\}\)\.join\('-'\)/.test(imp));
ok('D3: family_list_id uses resolvedLevels[1] safely (handles null)',
  /family_list_id:\s+resolvedLevels\[1\] \? resolvedLevels\[1\]\.id : null/.test(imp));
ok('D4: category_list_id nullable in payload',
  /category_list_id:\s+resolvedLevels\[2\] \? resolvedLevels\[2\]\.id : null/.test(imp));
ok('D5: origin_list_id in payload',
  /origin_list_id:\s+resolvedLevels\[9\] \? resolvedLevels\[9\]\.id : null/.test(imp));
ok('D6: payload includes featured boolean from raw.featured',
  /featured: featuredRaw === 'TRUE' \|\| featuredRaw === '1' \|\| featuredRaw === 'YES'/.test(imp));
ok('D7: payload includes active boolean with default TRUE if blank',
  /active: activeRaw === '' \? true : \(activeRaw === 'TRUE' \|\| activeRaw === '1' \|\| activeRaw === 'YES'\)/.test(imp));

// ══════════════════════════════════════════════════════════════════
// PART E — Active hardcoded override removed
// ══════════════════════════════════════════════════════════════════

ok('E1: rowPayload Object.assign no longer hardcodes active: true',
  !/Object\.assign\(\{\}, row\.payload, \{\s+active: true,\s+created_by/.test(imp));
ok('E2: rowPayload Object.assign only sets created_by/updated_by',
  /Object\.assign\(\{\}, row\.payload, \{\s+created_by: userProfile && userProfile\.id,\s+updated_by: userProfile && userProfile\.id,\s+\}\)/.test(imp));

// ══════════════════════════════════════════════════════════════════
// PART F — Template example row updated to 9-level format
// ══════════════════════════════════════════════════════════════════

ok('F1: example row in template references LLBKUS quick code',
  /LLBKUS/.test(imp));
ok('F2: example row includes US origin',
  /'L-SM-LX-RG-CT-BK-NA-NA-US'/.test(imp));

// ══════════════════════════════════════════════════════════════════
// Regression guards
// ══════════════════════════════════════════════════════════════════

ok('R1: Build 4.4 — reopen_finalized_receipt RPC still wired',
  /supabase\.rpc\('reopen_finalized_receipt'/.test(read('src/components/InventoryReceiving.jsx')));
ok('R2: Build 4.5 — InventoryAdjustments still imported',
  /import InventoryAdjustments from '\.\/InventoryAdjustments'/.test(read('src/components/InventoryTab.jsx')));
ok('R3: Build 37 — inventory_shipment_headers still wired in receiving',
  /supabase\.from\('inventory_shipment_headers'\)/.test(read('src/components/InventoryReceiving.jsx')));
ok('R4: A.6.27.28 closed-tickets fetch still has NO .limit(100)',
  !/\.eq\('status', 'Closed'\)[\s\S]{0,200}\.limit\(100\)/.test(page));

// ── Version stamp ──────────────────────────────────────────────────
ok('V1: version stamp v55.83-A.6.27.38',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.38 importer-relaxation tests passed');
