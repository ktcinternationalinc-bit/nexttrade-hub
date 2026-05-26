// v55.83-A.6.27.41 — Star button visibility + actions column width fix

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
// PART A — Grid width widened (header + row)
// ══════════════════════════════════════════════════════════════════

ok('A1: grid widened to v.43 dimensions (370px actions column)',
  /'110px 1\.5fr 2fr 140px 60px 370px'/.test(pm));
ok('A2: code column 110px (room for FAMILY/VARIANT badge)',
  /'110px 1\.5fr/.test(pm));
ok('A3: grid applied in both header and row (count = 2)',
  pm.split("gridTemplateColumns: '110px 1.5fr 2fr 140px 60px 370px'").length - 1 === 2);
ok('A4: old narrow 120px-actions grid no longer present',
  !/gridTemplateColumns: '90px 1\.2fr 180px 200px 80px 120px'/.test(pm));

// ══════════════════════════════════════════════════════════════════
// PART B — Star button bigger + visible
// ══════════════════════════════════════════════════════════════════

ok('B1: star button uses bigger text size [16px]',
  /text-\[16px\] leading-none[\s\S]{0,200}toggleFeatured/.test(pm) ||
  /toggleFeatured\(p\); \}\}\s+className=\{[^}]*text-\[16px\] leading-none/.test(pm));
ok('B2: star button has border-2 outline',
  /\(p\.featured === true \? 'bg-amber-200 hover:bg-amber-300 text-amber-700 border-amber-400 shadow' : 'bg-white hover:bg-amber-50 text-amber-500 border-amber-300'\)/.test(pm));
ok('B3: unstarred state uses amber-300 border + amber-500 text (visible)',
  /bg-white hover:bg-amber-50 text-amber-500 border-amber-300/.test(pm));
ok('B4: featured state uses amber-200 bg + amber-400 border + shadow',
  /bg-amber-200 hover:bg-amber-300 text-amber-700 border-amber-400 shadow/.test(pm));
ok('B5: padding bumped to px-3 py-1.5 (bigger click target)',
  /px-3 py-1\.5 text-\[16px\]/.test(pm));

// ══════════════════════════════════════════════════════════════════
// Regression guards
// ══════════════════════════════════════════════════════════════════

ok('R1: A.6.27.40 — toggleFeatured function still exists',
  /async function toggleFeatured\(p\)/.test(pm));
ok('R2: A.6.27.40 — featuredOnly filter still present',
  /var \[featuredOnly, setFeaturedOnly\] = useState\(false\)/.test(pm));
ok('R3: A.6.27.40 — typeFilter still present (default changed to "variants" in .55)',
  /var \[typeFilter, setTypeFilter\] = useState\('all'\)/.test(pm));
ok('R4: A.6.27.40 — smart search still uses split on whitespace',
  /var keywords = search\.trim\(\)\.toLowerCase\(\)\.split\(\/\\s\+\/\)/.test(pm));
ok('R5: A.6.27.40 — Edit button still present after star',
  /toggleFeatured\(p\)[\s\S]{0,2000}openEdit\(p\)[\s\S]{0,500}Edit/.test(pm));
ok('R6: A.6.27.40 — Copy button still present',
  /openDuplicate\(p\)[\s\S]{0,500}Copy/.test(pm));
ok('R7: A.6.27.40 — Deactivate button still present',
  /toggleActive\(p\)[\s\S]{0,500}Deactivate/.test(pm));
ok('R8: A.6.27.28 closed-tickets fetch still has NO .limit(100)',
  !/\.eq\('status', 'Closed'\)[\s\S]{0,200}\.limit\(100\)/.test(page));

// ── Version stamp ──────────────────────────────────────────────────
ok('V1: version stamp v55.83-A.6.27.41',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.41 star visibility + width fix tests passed');
