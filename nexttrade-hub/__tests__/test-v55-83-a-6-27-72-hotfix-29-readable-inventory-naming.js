/* v72 HOTFIX 29 — Per Max May 28 2026 screenshots:
 *   1. Inventory Overview per-row Current/Original/Sold columns showed `0.00`
 *      in text-blue-900 / text-indigo-900 / text-emerald-800 against the dark
 *      row background — unreadable. The HOTFIX 25 rule ("no dark text on dark
 *      surface") was being violated because the dark theme conversion in
 *      globals.css only covered -500/-600/-700 text shades, leaving -800/-900
 *      to render as Tailwind's near-black defaults.
 *   2. Inventory header strip used a bright pastel gradient
 *      (bg-gradient-to-r from-indigo-50 via-blue-50 to-cyan-50). Gradients
 *      bypass the dark-theme bg-X-50 overrides in globals.css so they render
 *      as bright pastels. Combined with text-slate-900 (auto-brightened to
 *      white), result was white-on-pastel — title vanished.
 *   3. "Filter by classification" banner had the same gradient problem.
 *   4. Textile product naming convention was Family+Grade+Color+Backing
 *      ("Leather Luxurious Olive Cotton") but Max wants Category+Grade+
 *      Color+Backing ("Embossed Luxurious Olive Cotton").
 *
 * Three layers of fix:
 *   - globals.css: add dark-theme overrides for every text-X-800 / text-X-900
 *     so they auto-brighten on dark surfaces (enforces HOTFIX 25 GLOBALLY)
 *   - InventoryOverview.jsx: per-row stat cells use text-X-300 directly;
 *     classification filter banner uses dark gradient + bright text
 *   - InventoryTab.jsx: header strip uses dark gradient + white/indigo-200 text
 *   - InventoryOverview.jsx: display name computed from Category+Grade+Color+
 *     Backing labels at render time (falls back to imported name_en if any
 *     level missing)
 */
var path = require('path');
var fs = require('fs');

function ok(name, cond) {
  if (!cond) { console.log('  ✗ ' + name); process.exitCode = 1; }
  else { console.log('  ✓ ' + name); }
}

var globals = fs.readFileSync(path.join(__dirname, '..', 'src/app/globals.css'), 'utf8');
var invOverview = fs.readFileSync(path.join(__dirname, '..', 'src/components/InventoryOverview.jsx'), 'utf8');
var invTab = fs.readFileSync(path.join(__dirname, '..', 'src/components/InventoryTab.jsx'), 'utf8');

console.log('\n── globals.css: -800/-900 dark text auto-brightening rule ──');

ok('A1: HOTFIX 29 dark-text rule present in globals.css',
  /HOTFIX 29[\s\S]{0,800}-900[\s\S]{0,200}auto-brighten/i.test(globals));

ok('A2: text-blue-800/-900 mapped to bright sky shade (#7dd3fc)',
  /\.text-blue-800[\s\S]{0,200}#7dd3fc/.test(globals));

ok('A3: text-emerald-800/-900 (and green/teal/lime) mapped to bright (#6ee7b7)',
  /\.text-emerald-800[\s\S]{0,300}#6ee7b7/.test(globals));

ok('A4: text-red-800/-900 (and rose/pink) mapped to bright (#fca5a5)',
  /\.text-red-800[\s\S]{0,300}#fca5a5/.test(globals));

ok('A5: text-purple-800/-900 (and violet/fuchsia) mapped to bright (#c4b5fd)',
  /\.text-purple-800[\s\S]{0,300}#c4b5fd/.test(globals));

ok('A6: text-indigo-800/-900 mapped to bright (#a5b4fc)',
  /\.text-indigo-800[\s\S]{0,200}#a5b4fc/.test(globals));

ok('A7: text-orange-800/-900 mapped to bright (#fdba74)',
  /\.text-orange-800[\s\S]{0,200}#fdba74/.test(globals));

ok('A8: amber-800/-900 is INTENTIONALLY excluded (the JSX-chooses-shade exception)',
  /amber[\s\S]{0,200}excluded|excluded[\s\S]{0,200}amber/i.test(globals.match(/HOTFIX 29[\s\S]{0,2500}/)[0]));

console.log('\n── InventoryOverview per-row stat cells ──');

ok('B1: per-row current_qty uses text-blue-300 (was text-blue-900)',
  /font-extrabold text-blue-300">\{fmtNum\(s\.current_qty/.test(invOverview));

ok('B2: per-row original_qty uses text-indigo-300 (was text-indigo-900)',
  /text-indigo-300">\{fmtNum\(s\.original_qty/.test(invOverview));

ok('B3: per-row sold_qty uses text-emerald-300 (was text-emerald-800)',
  /text-emerald-300">\{fmtNum\(s\.sold_qty/.test(invOverview));

ok('B4: HOTFIX 29 comment explains the readability rule on per-row cells',
  /HOTFIX 29[\s\S]{0,500}Current\/Original[\s\S]{0,500}HOTFIX 25 rule/i.test(invOverview));

console.log('\n── InventoryTab header strip ──');

ok('C1: Header strip uses DARK gradient (slate-800 via indigo-900 to slate-800)',
  /bg-gradient-to-r from-slate-800 via-indigo-900 to-slate-800/.test(invTab));

ok('C2: Header strip NO LONGER uses bright pastel gradient (only mention is in the HOTFIX 29 explanation comment)',
  (function () {
    var occurrences = (invTab.match(/from-indigo-50 via-blue-50 to-cyan-50/g) || []).length;
    // Only the explanation comment should reference it; should appear exactly once (in a comment).
    // Verify the one occurrence is inside a comment context (preceded by "the old `").
    var inComment = /the old `bg-gradient-to-r from-indigo-50 via-blue-50 to-cyan-50`/.test(invTab);
    return occurrences === 1 && inComment;
  })());

ok('C3: Header title is now text-white (was text-slate-900)',
  /📦 Inventory<\/h2>/.test(invTab) &&
  /text-white">📦 Inventory/.test(invTab));

ok('C4: Subtitle uses text-indigo-200 for proper dark-surface contrast',
  /text-indigo-200 font-medium[\s\S]{0,400}Track every shipment/.test(invTab));

ok('C5: P&L access badge upgraded from bg-emerald-200/text-emerald-900 (washed) to solid bg-emerald-600/text-white',
  /bg-emerald-600 text-white font-extrabold ring-1[\s\S]{0,200}P&L access/.test(invTab));

ok('C6: Cost access badge upgraded from bg-amber-200/text-amber-900 to bg-amber-600/text-white',
  /bg-amber-600 text-white font-extrabold ring-1[\s\S]{0,200}Cost access/.test(invTab));

console.log('\n── InventoryOverview classification filter banner ──');

ok('D1: Classification banner uses dark gradient (slate-800 to indigo-900)',
  /bg-gradient-to-r from-slate-800 to-indigo-900\/70/.test(invOverview));

ok('D2: Classification banner NO LONGER uses bright pastel gradient',
  !/from-slate-50 to-indigo-50\/50/.test(invOverview));

ok('D3: Filter label "Filter by classification" uses text-white for contrast',
  /text-white">Filter by classification/.test(invOverview));

ok('D4: Breadcrumb "Family → Category → Grade" uses text-indigo-200 (was text-slate-500)',
  /text-indigo-200 font-semibold[\s\S]{0,200}Family.*Category.*Grade/.test(invOverview));

ok('D5: Active filter pill upgraded to solid bg-indigo-600 + ring',
  /bg-indigo-600 text-white px-2 py-0\.5 rounded-full font-bold ring-1/.test(invOverview));

console.log('\n── Naming convention: Category + Grade + Color + Backing ──');

ok('E1: Display name computed from Category+Grade+Color+Backing labels',
  /computedNameEn = \[catLbl, grdLbl, clrLbl, bckLbl\][\s\S]{0,400}\.join\(' '\)/.test(invOverview));

ok('E2: Arabic version computed similarly',
  /computedNameAr = \[catLbl, grdLbl, clrLbl, bckLbl\][\s\S]{0,400}label_ar[\s\S]{0,200}\.join\(' '\)/.test(invOverview));

ok('E3: Falls back to name_en if Category or Grade missing (safety)',
  /\(catLbl && grdLbl\) \? computedNameEn : \(p\.name_en \|\| '—'\)/.test(invOverview));

ok('E4: HOTFIX 29 comment documents the naming change',
  /HOTFIX 29[\s\S]{0,800}Category.*Grade.*Color.*Backing/i.test(invOverview));

ok('E5: displayNameEn used in render (not p.name_en directly)',
  /<div className="font-bold text-slate-900">\{displayNameEn\}<\/div>/.test(invOverview));

ok('E6: displayNameAr used in render (not p.name_ar directly)',
  /\{displayNameAr && <div className="text-xs[\s\S]{0,100}\{displayNameAr\}/.test(invOverview));

console.log('\n══════════════════════════════════════════════');
if (process.exitCode) console.log('FAILED');
else console.log('✅ HOTFIX 29 — readable -800/-900 text everywhere, dark banner gradients, Category-Grade-Color-Backing naming');
console.log('══════════════════════════════════════════════');
