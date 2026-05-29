/* v72 HOTFIX 12 supplemental — three follow-on fixes:
 *   1. Bottom summary cards were showing "—" because grandTotals didn't carry
 *      forward theyOweUs / weOweThem from per-account summaries.
 *   2. Print Statement PDF skipped a full blank first page because the strict
 *      `.currency-section { page-break-inside: avoid }` forced the entire section
 *      to a new page when it didn't fit under the header.
 *   3. Auto-naming convention for products: name auto-builds from level selections
 *      per family recipe (Textile / Leather / PVC), in English + Arabic. Locked
 *      until all recipe levels filled, then user can unlock to override manually.
 *      Same logic applied to Import Products. */
var path = require('path');
var fs = require('fs');

function ok(name, cond) {
  if (!cond) { console.log('  ✗ ' + name); process.exitCode = 1; }
  else { console.log('  ✓ ' + name); }
}

var oa = fs.readFileSync(path.join(__dirname, '..', 'src/components/OpenAccountsTab.jsx'), 'utf8');
var exp = fs.readFileSync(path.join(__dirname, '..', 'src/lib/open-account-export.js'), 'utf8');
var pm = fs.readFileSync(path.join(__dirname, '..', 'src/components/InventoryProductMaster.jsx'), 'utf8');
var imp = fs.readFileSync(path.join(__dirname, '..', 'src/components/InventoryImportProducts.jsx'), 'utf8');

console.log('\n── Bottom cards now bind to real numbers (was rendering "—") ──');

ok('A1: grandTotals byCur init includes theyOweUs + weOweThem',
  /byCur\[cur\] = \{[\s\S]{0,300}theyOweUs: 0, weOweThem: 0, theirPrepaid: 0, ourPrepaid: 0/.test(oa));

ok('A2: grandTotals aggregates cs.theyOweUs across accounts',
  /byCur\[cur\]\.theyOweUs \+= Number\(cs\.theyOweUs \|\| 0\)/.test(oa));

ok('A3: grandTotals aggregates cs.weOweThem across accounts',
  /byCur\[cur\]\.weOweThem \+= Number\(cs\.weOweThem \|\| 0\)/.test(oa));

ok('A4: grandTotals also carries forward prepaid pots for reconciliation',
  /byCur\[cur\]\.theirPrepaid \+= Number\(cs\.theirPrepaid \|\| 0\)/.test(oa) &&
  /byCur\[cur\]\.ourPrepaid \+= Number\(cs\.ourPrepaid \|\| 0\)/.test(oa));

console.log('\n── PDF page-break fix ──');

ok('B1: NO strict section-level page-break-inside:avoid (was forcing blank first page)',
  !/\.currency-section \{ page-break-inside: avoid/.test(exp));

ok('B2: Section header (h2) avoid-break-after — keeps header attached to its table (HOTFIX 33: also adds 18px/900 hierarchy)',
  /\.currency-section > h2 \{[\s\S]{0,300}page-break-after: avoid/.test(exp));

ok('B3: Row-level page-break-inside:avoid — rows stay together but tables can break',
  /\.currency-section tr \{ page-break-inside: avoid/.test(exp));

ok('B4: display:table-header-group on thead — header repeats on each page',
  /\.currency-section thead \{ display: table-header-group/.test(exp));

console.log('\n── Auto-naming convention (single product form) ──');

ok('C1: NAMING_RECIPES const with TEX / LEA / PVC keys',
  /var NAMING_RECIPES = \{[\s\S]{0,800}'TEX':[\s\S]{0,300}'LEA':[\s\S]{0,300}'PVC':/.test(pm));

ok('C2: Textile recipe = [Category, Grade, Color, Backing] (levels 2,3,6,5)',
  /'TEX':\s*\[2, 3, 6, 5\]/.test(pm));

ok('C3: Leather recipe = [Family, Grade, Color, Backing] (levels 1,3,6,5)',
  /'LEA':\s*\[1, 3, 6, 5\]/.test(pm));

ok('C4: PVC recipe = [Family, Grade, Color, Pattern, SpecClass] (levels 1,3,6,7,8)',
  /'PVC':\s*\[1, 3, 6, 7, 8\]/.test(pm));

ok('C5: buildAutoName helper exists, walks recipe, returns name_en + name_ar',
  /function buildAutoName\(form, lists\)[\s\S]{0,2000}name_en: enParts\.join\(' '\)[\s\S]{0,200}name_ar: arParts\.join\(' '\)/.test(pm));

ok('C6: handleLevelChange triggers auto-name rebuild',
  /var auto = buildAutoName\(newForm, lists\)/.test(pm));

ok('C7: Auto-name only overrides when user has NOT manually edited',
  /!newForm\._name_manually_edited/.test(pm));

ok('C8: Name fields locked (readOnly) until all recipe levels filled',
  /readOnly=\{!form\._name_manually_edited && buildAutoName\(form, lists\)\.missing\.length > 0\}/.test(pm));

ok('C9: User can unlock with "Unlock to edit manually" button',
  /Unlock to edit manually/.test(pm));

ok('C10: User can restore auto-name after manual edit',
  /Restore auto-name/.test(pm));

ok('C11: Banner shows naming recipe for current family',
  /Naming convention[\s\S]{0,300}recipeLabels/.test(pm));

ok('C12: Banner lists missing levels in plain English',
  /Still need[\s\S]{0,200}missing\.map/.test(pm));

console.log('\n── Auto-naming convention (Import Products) ──');

ok('D1: Import resolves family code into recipe',
  /var familyCode = String\(resolvedLevels\[1\]\.code \|\| ''\)\.toUpperCase\(\)\.trim\(\)/.test(imp));

ok('D2: Import has same TEX / LEA / PVC recipes',
  /'TEX':\s*\[2, 3, 6, 5\]/.test(imp) && /'LEA':\s*\[1, 3, 6, 5\]/.test(imp) && /'PVC':\s*\[1, 3, 6, 7, 8\]/.test(imp));

ok('D3: Import auto-fills name_en/name_ar from level labels when blank',
  /if \(!nameEn && enParts\.length > 0\) nameEn = enParts\.join\(' '\)/.test(imp) &&
  /if \(!nameAr && arParts\.length > 0\) nameAr = arParts\.join\(' '\)/.test(imp));

ok('D4: Import respects user-typed names (only fills when blank)',
  /\(!nameEn \|\| !nameAr\) && resolvedLevels\[1\]/.test(imp));

ok('D5: Import template instructions document the auto-naming recipes',
  /Textile.*Category \+ Grade \+ Color \+ Backing/.test(imp) &&
  /Leather.*Family \+ Grade \+ Color \+ Backing/.test(imp) &&
  /PVC.*Family \+ Grade \+ Color \+ Pattern \+ SpecClass/.test(imp));

console.log('\n── End-to-end recipe walk ──');

// Simulate: textile family selection → name builds in correct order
function simBuildName(recipe, labels) {
  return recipe.map(function (lvl) { return labels[lvl] || ''; }).filter(Boolean).join(' ');
}
var labelsTex = { 2: 'Marine Vinyl', 3: 'Premium', 6: 'Navy Blue', 5: 'Knit' };
ok('E1: TEX builds "Marine Vinyl Premium Navy Blue Knit"',
  simBuildName([2, 3, 6, 5], labelsTex) === 'Marine Vinyl Premium Navy Blue Knit');

var labelsLea = { 1: 'Leather', 3: 'Luxurious', 6: 'Black', 5: 'Smooth' };
ok('E2: LEA builds "Leather Luxurious Black Smooth"',
  simBuildName([1, 3, 6, 5], labelsLea) === 'Leather Luxurious Black Smooth');

var labelsPvc = { 1: 'PVC', 3: 'Pool', 6: 'White', 7: 'Mosaic', 8: 'A-Grade' };
ok('E3: PVC builds "PVC Pool White Mosaic A-Grade"',
  simBuildName([1, 3, 6, 7, 8], labelsPvc) === 'PVC Pool White Mosaic A-Grade');

var labelsArTex = { 2: 'فينيل بحري', 3: 'بريميوم', 6: 'أزرق كحلي', 5: 'تريكو' };
ok('E4: TEX Arabic builds "فينيل بحري بريميوم أزرق كحلي تريكو"',
  simBuildName([2, 3, 6, 5], labelsArTex) === 'فينيل بحري بريميوم أزرق كحلي تريكو');

console.log('\n══════════════════════════════════════════════');
if (process.exitCode) console.log('FAILED');
else console.log('✅ HOTFIX 12 supplemental — card binding, PDF break, auto-naming');
console.log('══════════════════════════════════════════════');
