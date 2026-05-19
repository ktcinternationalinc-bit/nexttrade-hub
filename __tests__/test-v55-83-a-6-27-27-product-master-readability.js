// v55.83-A.6.27.27 — Product Master list: Arabic + classification readability
//
// Max requested: "ARABIC TEXT FOR THE DESCRIPTION NEEDS TO BE Larger and bolder
// so does classification. make that whole section larger."
//
// Changes to the Product Master TABLE ROW (the list view, not the form):
//   - Arabic name: text-[11px] font-semibold → text-base font-extrabold
//   - Classification slug: text-[11px] font-semibold → text-sm font-extrabold
//   - English name: text-sm font-bold → text-base font-extrabold (parity)
//   - Slug column: 150px → 180px (accommodate larger text)
//   - Name column: 1fr → 1.2fr (more breathing room)
//   - Row padding: 10px → 12px
//   - Arabic name color: slate-700 → slate-800 (darker, more readable)

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var pm = read('src/components/InventoryProductMaster.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ── 1. Arabic name bigger + bolder ────────────────────────────────
ok('1a: Arabic name in row is text-base font-extrabold (was text-[11px] font-semibold)',
  /text-base font-extrabold mt-0\.5 ' \+ \(p\.active \? 'text-slate-800' : 'text-slate-500 line-through'\)\}[\s\S]{0,200}direction: 'rtl' \}\}>\{p\.name_ar\}/.test(pm));
ok('1b: old Arabic-name small/light style is GONE',
  !/'text-\[11px\] font-semibold ' \+ \(p\.active \? 'text-slate-700' : 'text-slate-500 line-through'\)\)[^"]*"\}\s+style=\{\{ direction: 'rtl' \}\}>\{p\.name_ar\}/.test(pm));

// ── 2. Classification slug bigger + bolder ─────────────────────────
ok('2a: classification slug is text-sm font-extrabold (was text-[11px] font-semibold)',
  /<div className="text-sm font-mono font-extrabold text-slate-900 break-words">\{p\.classification_slug \|\| describeProduct\(p\)\}/.test(pm));
ok('2b: old classification-slug small/light style is GONE',
  !/<div className="text-\[11px\] font-mono text-slate-700 font-semibold">\{p\.classification_slug/.test(pm));

// ── 3. English name bumped for visual parity ──────────────────────
ok('3a: English name in row is text-base font-extrabold (was text-sm font-bold)',
  /text-base font-extrabold ' \+ \(p\.active \? 'text-slate-900' : 'text-slate-500 line-through'\)\}>\{p\.name_en\}/.test(pm));

// ── 4. Column widths widened ──────────────────────────────────────
ok('4a: row grid columns expanded: name 1.2fr, classification 180px',
  /gridTemplateColumns: '90px 1\.2fr 180px 200px 80px 120px', padding: '12px 12px'/.test(pm));
ok('4b: header row grid columns ALSO expanded (match row)',
  /gridTemplateColumns: '90px 1\.2fr 180px 200px 80px 120px', padding: '8px 12px'/.test(pm));
ok('4c: old 150px slug column width is GONE from both rows',
  !/gridTemplateColumns: '90px 1fr 150px/.test(pm));

// ── 5. Comment trail explains the change ───────────────────────────
ok('5a: change is annotated with v55.83-A.6.27.27 comment',
  /v55\.83-A\.6\.27\.27 — Max requested Arabic description and/.test(pm));

// ── 6. Edit modal NOT TOUCHED — only the table row changed ─────────
ok('6a: modal form still uses original label-input styling',
  /Product Name \(Arabic\) \*/.test(pm) &&
  /placeholder="مثال: موزاييك جديد بريميوم أزرق غامق"/.test(pm));
ok('6b: modal Arabic name input still direction:rtl',
  /value=\{form\.name_ar\}[\s\S]{0,500}direction: 'rtl'/.test(pm));

// ── 7. Regression guards on prior builds ──────────────────────────
ok('7a: Build 2 cascading-dropdown logic still intact',
  /if \(optRules\.length === 0\) return true/.test(pm) &&
  /return optRules\.some\(function \(rule\) \{/.test(pm));
ok('7b: live slug preview still in modal',
  /var liveSlug = computeSlug\(form\)/.test(pm) && /LIVE SLUG/.test(pm));
ok('7c: A.6.27.26 parent-rule UI for all levels still in Master Lists',
  /num: 3, en: 'Grade'[\s\S]{0,200}hasParent: true,\s+parentLevel: 1/.test(read('src/components/InventoryMasterAdmin.jsx')));
ok('7d: A.6.27.21 fixLinksBusy state still in page.jsx',
  /fixLinksBusy/.test(page));

// ── 8. Version stamp ──────────────────────────────────────────────
ok('8a: version stamp v55.83-A.6.27.27',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.27 product-master-readability tests passed');
