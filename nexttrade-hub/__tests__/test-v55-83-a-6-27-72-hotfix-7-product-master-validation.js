/* v72 HOTFIX 7 — Product Master save: UI conformity + duplicate detection.
 *
 * Max's complaints:
 *   1. "if there is any error it should tell the user that they need to fill out
 *      something they missed ...regular ui conformity and regulations that should
 *      be there in the first place"
 *      → save() must collect ALL missing fields and report them in one message,
 *        not one-at-a-time.
 *   2. "if there is a duplicate created you must say that this is a duplicate
 *      with another and name it....no duplicates allowed"
 *      → save() must detect duplicates by quick_code, classification_slug, name_en,
 *        AND name_ar — and NAME the conflicting product in the error message. */
var path = require('path');
var fs = require('fs');

function ok(name, cond) {
  if (!cond) { console.log('  ✗ ' + name); process.exitCode = 1; }
  else { console.log('  ✓ ' + name); }
}

var pm = fs.readFileSync(path.join(__dirname, '..', 'src/components/InventoryProductMaster.jsx'), 'utf8');

console.log('\n── 1. UI conformity — all missing fields reported in one message ──');

ok('A1: save() collects validation errors into a missing[] array',
  /var missing = \[\]/.test(pm));

ok('A2: missing English name pushes into missing[]',
  /if \(!nameEn\) missing\.push\('• English name/.test(pm));

ok('A3: missing Arabic name pushes into missing[]',
  /if \(!nameAr\) missing\.push\('• Arabic name/.test(pm));

ok('A4: missing Levels 1-8 push into missing[]',
  /for \(var lvl = 1; lvl <= 8; lvl\+\+\)[\s\S]{0,200}missing\.push\('• Level ' \+ lvl/.test(pm));

ok('A5: missing fields reported in ONE message with bullet list',
  /if \(missing\.length > 0\) \{[\s\S]{0,300}Cannot save — please fill in these required fields/.test(pm) &&
  /missing\.join\('\\n'\)/.test(pm));

ok('A6: message includes count of missing fields',
  /\+ missing\.length \+ ' field' \+ \(missing\.length === 1 \? '' : 's'\) \+ ' missing/.test(pm));

console.log('\n── 2. Duplicate detection — names the conflicting product ──');

ok('B1: describeConflict helper produces a clear "name — quick code — status — id" string',
  /function describeConflict\(p, conflictField\)[\s\S]{0,500}p\.active \? 'ACTIVE' : 'INACTIVE \(deactivated\)'/.test(pm));

ok('B2: Quick Code duplicate check now includes inactive products (not just active)',
  // Old code had `p.active && (quick code match)` — new code must drop the p.active filter
  /var dupCode = products\.find\(function \(p\) \{[\s\S]{0,500}\(p\.quick_code \|\| ''\)\.trim\(\)\.toLowerCase\(\) === quickCode\.toLowerCase\(\)/.test(pm) &&
  // Old `p.active && (...quick_code match)` should be gone
  !/return p\.active && \(p\.quick_code \|\| ''\)\.trim\(\)\.toLowerCase\(\) === quickCode\.toLowerCase\(\)/.test(pm));

ok('B3: Quick Code duplicate message uses describeConflict and says "DUPLICATE QUICK CODE — cannot save"',
  /DUPLICATE QUICK CODE — cannot save[\s\S]{0,300}describeConflict\(dupCode/.test(pm));

ok('B4: Classification slug duplicate detected (same exact L1-L9 combination)',
  /var dupSlug = products\.find\(function \(p\) \{[\s\S]{0,300}return p\.classification_slug === slug/.test(pm) &&
  /DUPLICATE CLASSIFICATION — cannot save/.test(pm));

ok('B5: Classification dup message names the conflicting product and shows the slug',
  /describeConflict\(dupSlug/.test(pm) &&
  /Classification slug: ' \+ slug/.test(pm));

ok('B6: English name duplicate detected (case-insensitive, trimmed)',
  /var dupNameEn = products\.find\(function \(p\) \{[\s\S]{0,300}\(p\.name_en \|\| ''\)\.trim\(\)\.toLowerCase\(\) === nameEn\.toLowerCase\(\)/.test(pm) &&
  /DUPLICATE ENGLISH NAME — cannot save/.test(pm) &&
  /describeConflict\(dupNameEn/.test(pm));

ok('B7: Arabic name duplicate detected (case-insensitive, trimmed)',
  /var dupNameAr = products\.find\(function \(p\) \{[\s\S]{0,300}\(p\.name_ar \|\| ''\)\.trim\(\)\.toLowerCase\(\) === nameAr\.toLowerCase\(\)/.test(pm) &&
  /DUPLICATE ARABIC NAME — cannot save/.test(pm) &&
  /describeConflict\(dupNameAr/.test(pm));

ok('B8: every duplicate check excludes self when editing (modalMode === edit)',
  // Should appear 4 times (one for each dup check)
  (pm.match(/if \(modalMode === 'edit' && p\.id === modalProductId\) return false/g) || []).length >= 4);

ok('B9: every duplicate error ends with "No duplicates allowed"',
  (pm.match(/No duplicates allowed/g) || []).length >= 4);

console.log('\n── 3. End-to-end logic checks ──');

ok('C1: order of validation: missing fields → slug → quick code → slug dup → name dups',
  pm.indexOf('Cannot save — please fill in these required fields') <
  pm.indexOf('DUPLICATE QUICK CODE') &&
  pm.indexOf('DUPLICATE QUICK CODE') <
  pm.indexOf('DUPLICATE CLASSIFICATION') &&
  pm.indexOf('DUPLICATE CLASSIFICATION') <
  pm.indexOf('DUPLICATE ENGLISH NAME') &&
  pm.indexOf('DUPLICATE ENGLISH NAME') <
  pm.indexOf('DUPLICATE ARABIC NAME'));

ok('C2: fail() helper still uses BOTH toast.error AND alert() (unmissable feedback)',
  /function fail\(msg\)[\s\S]{0,300}toast\.error\(msg\)[\s\S]{0,200}alert\(msg\)/.test(pm));

ok('C3: HOTFIX 7 comment block exists explaining the changes',
  /HOTFIX 7[\s\S]{0,300}Collect ALL missing fields[\s\S]{0,200}Comprehensive duplicate detection/.test(pm));

console.log('\n══════════════════════════════════════════════');
if (process.exitCode) console.log('FAILED');
else console.log('✅ HOTFIX 7 — UI conformity + duplicate naming');
console.log('══════════════════════════════════════════════');
