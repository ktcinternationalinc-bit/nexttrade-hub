// v55.83-A.6.27.38 — Leather USA full catalog (with your filters from this conversation)
//
// Filtered scope (from live DB + Max's restrictions):
//   1 Family       — L (Leather)
//   2 Category     — SM (Smooth), EM (Embossed)
//   3 Grade        — LX, PR, ST (no NA)
//   4 Construction — RG, PF, FN (you removed FP)
//   5 Backing      — BK, CT, GS, NW (you removed FL, OT, NA, GR)
//   6 Color        — BG, BK, BN, GR, HV, MR, NB, OL, WH (you removed SW, DG, LG)
//   7 Pattern      — Smooth=NA only; Embossed=MG, RG (you removed HC)
//   8 Spec Class   — NA (all leather has NA at master level)
//   9 Origin       — US
//
// Smooth branch:    3 grades × 3 constructions × 4 backings × 1 color (BK) × 1 pattern (NA) = 36 rows
// Embossed branch:  3 grades × 3 constructions × 4 backings × 9 colors × 2 patterns         = 648 rows
// Total: 684 rows
//
// All rows initially featured = FALSE. Max stars favorites via the UI after import.

const XLSX = require('xlsx');
const fs = require('fs');

// ─── Source data ────────────────────────────────────────────────
const FAMILY = { code: 'L', label_en: 'Leather', label_ar: 'جلد' };

const CATEGORIES = [
  { code: 'SM', label_en: 'Smooth',   label_ar: 'ناعم' },
  { code: 'EM', label_en: 'Embossed', label_ar: 'منقوش' },
];

const GRADES = [
  { code: 'LX', label_en: 'Luxurious',         label_ar: 'فاخر' },
  { code: 'PR', label_en: 'Standard Premium',  label_ar: 'ستاندرد بريميوم' },
  { code: 'ST', label_en: 'Stock',             label_ar: 'ستوك' },
];

const CONSTRUCTIONS = [
  { code: 'RG', label_en: 'Regular',             label_ar: 'عادي' },
  { code: 'PF', label_en: 'Perforated',          label_ar: 'مخرم' },
  { code: 'FN', label_en: 'Foam Non-Perforated', label_ar: 'إسفنج غير مخرم' },
];

const BACKINGS = [
  { code: 'BK', label_en: 'Black',     label_ar: 'أسود' },
  { code: 'CT', label_en: 'Cotton',    label_ar: 'قطن' },
  { code: 'GS', label_en: 'Gray Suede', label_ar: 'شامواه رمادي' },
  { code: 'NW', label_en: 'Non-Woven', label_ar: 'نون ووفن' },
];

const COLORS_ALL = [
  { code: 'BG', label_en: 'Beige',      label_ar: 'بيج' },
  { code: 'BK', label_en: 'Black',      label_ar: 'أسود' },
  { code: 'BN', label_en: 'Brown',      label_ar: 'بني' },
  { code: 'GR', label_en: 'Gray',       label_ar: 'رمادي' },
  { code: 'HV', label_en: 'Havana',     label_ar: 'هافان' },
  { code: 'MR', label_en: 'Maroon',     label_ar: 'نبيتي' },
  { code: 'NB', label_en: 'Navy Blue',  label_ar: 'كحلي' },
  { code: 'OL', label_en: 'Olive',      label_ar: 'زيتي' },
  { code: 'WH', label_en: 'White',      label_ar: 'أبيض' },
];

const COLORS_SMOOTH = [
  { code: 'BK', label_en: 'Black', label_ar: 'أسود' },
];

const PATTERN_NONE = { code: 'NA', label_en: 'None',             label_ar: 'بدون' };

const PATTERNS_EMBOSSED = [
  { code: 'MG', label_en: 'Mechanical Grain', label_ar: 'حبيبات ميكانيكية' },
  { code: 'RG', label_en: 'Normal Emboss',    label_ar: 'نقشة عادية' },
];

const SPEC_NA = { code: 'NA', label_en: 'Not Applicable', label_ar: 'غير مطبق' };
const COUNTRY = { code: 'US', label_en: 'United States',  label_ar: 'الولايات المتحدة' };

// ─── Build rows ─────────────────────────────────────────────────
function buildRow(category, grade, construction, backing, color, pattern) {
  // Quick code: Family[0] + Grade[0] + Color(2) + Country(2) = 6 chars
  var quick_code = FAMILY.code.charAt(0) + grade.code.charAt(0) + color.code + COUNTRY.code;
  // Full classification slug spells out everything
  var slug = [FAMILY.code, category.code, grade.code, construction.code, backing.code, color.code, pattern.code, SPEC_NA.code, COUNTRY.code].join('-');
  // Long-form name shows the entire breakdown (so dropdowns can summarize)
  var name_en = [
    FAMILY.label_en, category.label_en, grade.label_en,
    construction.label_en, backing.label_en + ' backing', color.label_en,
    pattern.label_en + ' pattern',
  ].join(' · ') + ' (' + COUNTRY.label_en + ')';
  var name_ar = [
    FAMILY.label_ar, category.label_ar, grade.label_ar,
    construction.label_ar, backing.label_ar, color.label_ar, pattern.label_ar,
  ].join(' · ') + ' (' + COUNTRY.label_ar + ')';
  return {
    quick_code: quick_code,
    name_en: name_en,
    name_ar: name_ar,
    family_code: FAMILY.code,
    category_code: category.code,
    grade_code: grade.code,
    construction_code: construction.code,
    backing_code: backing.code,
    color_code: color.code,
    pattern_code: pattern.code,
    spec_class_code: SPEC_NA.code,
    origin_code: COUNTRY.code,
    classification_slug: slug,
    default_uom: 'meter',
    default_supplier: '',
    default_cost: '',
    default_currency: 'USD',
    default_rack: '',
    notes: '',
    featured: 'FALSE',   // Max stars favorites later via UI
    active: 'TRUE',
  };
}

var rows = [];

// Smooth branch: only Black color, only NA pattern
for (var g = 0; g < GRADES.length; g++) {
  for (var c = 0; c < CONSTRUCTIONS.length; c++) {
    for (var b = 0; b < BACKINGS.length; b++) {
      for (var col = 0; col < COLORS_SMOOTH.length; col++) {
        rows.push(buildRow(CATEGORIES[0], GRADES[g], CONSTRUCTIONS[c], BACKINGS[b], COLORS_SMOOTH[col], PATTERN_NONE));
      }
    }
  }
}

// Embossed branch: all colors, MG + RG patterns
for (var g2 = 0; g2 < GRADES.length; g2++) {
  for (var c2 = 0; c2 < CONSTRUCTIONS.length; c2++) {
    for (var b2 = 0; b2 < BACKINGS.length; b2++) {
      for (var col2 = 0; col2 < COLORS_ALL.length; col2++) {
        for (var p2 = 0; p2 < PATTERNS_EMBOSSED.length; p2++) {
          rows.push(buildRow(CATEGORIES[1], GRADES[g2], CONSTRUCTIONS[c2], BACKINGS[b2], COLORS_ALL[col2], PATTERNS_EMBOSSED[p2]));
        }
      }
    }
  }
}

console.log('Generated ' + rows.length + ' rows');
console.log('  Smooth branch:   3 × 3 × 4 × 1 × 1 = 36');
console.log('  Embossed branch: 3 × 3 × 4 × 9 × 2 = 648');
console.log('  Total:           ' + rows.length);

// ─── Build workbook ─────────────────────────────────────────────
var wb = XLSX.utils.book_new();

// Sheet 1: Products
var productsAOA = [[
  'quick_code', 'name_en', 'name_ar',
  'family_code', 'category_code', 'grade_code', 'construction_code',
  'backing_code', 'color_code', 'pattern_code', 'spec_class_code', 'origin_code',
  'classification_slug',
  'default_uom', 'default_supplier', 'default_cost', 'default_currency', 'default_rack',
  'notes', 'featured', 'active',
]];
for (var i = 0; i < rows.length; i++) {
  var r = rows[i];
  productsAOA.push([
    r.quick_code, r.name_en, r.name_ar,
    r.family_code, r.category_code, r.grade_code, r.construction_code,
    r.backing_code, r.color_code, r.pattern_code, r.spec_class_code, r.origin_code,
    r.classification_slug,
    r.default_uom, r.default_supplier, r.default_cost, r.default_currency, r.default_rack,
    r.notes, r.featured, r.active,
  ]);
}
var productsSheet = XLSX.utils.aoa_to_sheet(productsAOA);
productsSheet['!cols'] = [
  { wch: 9 }, { wch: 65 }, { wch: 60 },
  { wch: 6 }, { wch: 8 }, { wch: 6 }, { wch: 11 },
  { wch: 8 }, { wch: 7 }, { wch: 8 }, { wch: 11 }, { wch: 7 },
  { wch: 28 },
  { wch: 9 }, { wch: 18 }, { wch: 10 }, { wch: 10 }, { wch: 9 },
  { wch: 18 }, { wch: 8 }, { wch: 6 },
];
XLSX.utils.book_append_sheet(wb, productsSheet, 'Products');

// Sheet 2: Codes Reference
var codesAOA = [['Level', 'Code', 'English', 'Arabic']];
codesAOA.push([1, 'L', 'Leather', 'جلد']);
CATEGORIES.forEach(function (x) { codesAOA.push([2, x.code, x.label_en + ' (Category)', x.label_ar]); });
GRADES.forEach(function (x) { codesAOA.push([3, x.code, x.label_en + ' (Grade)', x.label_ar]); });
CONSTRUCTIONS.forEach(function (x) { codesAOA.push([4, x.code, x.label_en + ' (Construction)', x.label_ar]); });
BACKINGS.forEach(function (x) { codesAOA.push([5, x.code, x.label_en + ' (Backing)', x.label_ar]); });
COLORS_ALL.forEach(function (x) { codesAOA.push([6, x.code, x.label_en + ' (Color)', x.label_ar]); });
codesAOA.push([7, 'NA', 'None (Pattern — for Smooth)', 'بدون']);
PATTERNS_EMBOSSED.forEach(function (x) { codesAOA.push([7, x.code, x.label_en + ' (Pattern — Embossed)', x.label_ar]); });
codesAOA.push([8, 'NA', 'Not Applicable (Spec — all Leather)', 'غير مطبق']);
codesAOA.push([9, 'US', 'United States (Origin)', 'الولايات المتحدة']);
var codesSheet = XLSX.utils.aoa_to_sheet(codesAOA);
codesSheet['!cols'] = [{ wch: 7 }, { wch: 8 }, { wch: 38 }, { wch: 24 }];
XLSX.utils.book_append_sheet(wb, codesSheet, 'Codes Reference');

// Sheet 3: Rules
var rulesAOA = [
  ['Rule', 'Detail'],
  ['Quick code format', '6 characters: Family[0] + Grade[0] + Color(2) + Country(2)'],
  ['Example', 'LLBKUS = Leather + Luxurious + Black + USA — multiple rows share this code but differ in Cat/Constr/Back/Pattern'],
  ['Why quick codes repeat', 'Quick code identifies the family/grade/color/country combo, not the construction details. Multiple master rows can share the same quick_code; classification_slug is the unique identifier.'],
  ['Smooth (SM) restrictions', 'Only Black color, only NA pattern (per Max). 3 grades × 3 constructions × 4 backings = 36 rows.'],
  ['Embossed (EM) variations', '9 colors × 3 grades × 3 constructions × 4 backings × 2 patterns (MG, RG) = 648 rows.'],
  ['featured column', 'All rows start FALSE. Max stars favorites via the Product Master UI after import. Featured rows appear at the top of product pickers everywhere.'],
  ['use_count column (auto)', 'Tracks how often a product is used on receipts/invoices. Picker sorts featured first, then by use_count desc, then alphabetical. Initial value 0.'],
  ['Default UOM', 'meter (changeable per row before import)'],
  ['Default Currency', 'USD'],
  ['Default Supplier / Cost / Rack', 'BLANK — fill in master if you have consistent values, or override at receipt time'],
  ['Active', 'TRUE — all rows imported as active'],
  ['classification_slug', 'Spells out the full FK chain: L-{SM/EM}-{LX/PR/ST}-{construction}-{backing}-{color}-{pattern}-NA-US'],
];
var rulesSheet = XLSX.utils.aoa_to_sheet(rulesAOA);
rulesSheet['!cols'] = [{ wch: 32 }, { wch: 95 }];
XLSX.utils.book_append_sheet(wb, rulesSheet, 'Rules');

// Sheet 4: Instructions
var instrAOA = [
  ['KTC NextTrade Hub — Leather USA Full Catalog Import'],
  [''],
  ['SCOPE: ' + rows.length + ' products covering every applicable combination of:'],
  ['  Family: Leather (L)'],
  ['  Categories: Smooth (SM), Embossed (EM)'],
  ['  Grades: Luxurious (LX), Standard Premium (PR), Stock (ST)'],
  ['  Constructions: Regular (RG), Perforated (PF), Foam Non-Perforated (FN)'],
  ['  Backings: Black (BK), Cotton (CT), Gray Suede (GS), Non-Woven (NW)'],
  ['  Colors: 9 colors (BG, BK, BN, GR, HV, MR, NB, OL, WH) — Smooth only uses Black'],
  ['  Patterns: NA (for Smooth) + MG, RG (for Embossed)'],
  ['  Spec Class: NA (all Leather at master level)'],
  ['  Origin: USA (US)'],
  [''],
  ['BREAKDOWN:'],
  ['  Smooth branch:   3 grades × 3 constructions × 4 backings × 1 color × 1 pattern = 36 rows'],
  ['  Embossed branch: 3 grades × 3 constructions × 4 backings × 9 colors × 2 patterns = 648 rows'],
  ['  Total: 684 rows'],
  [''],
  ['PREREQUISITES — run the consolidated SQL FIRST in Supabase'],
  ['  1. Level 9 constraint fix + USA added at Level 9'],
  ['  2. inventory_shipment_headers table created'],
  ['  3. featured + use_count columns added to inventory_products'],
  ['  4. UNIQUE constraint on quick_code dropped (allows duplicates)'],
  ['  5. Leather Pattern parent rules added (MG, RG, NA → Leather)'],
  [''],
  ['HOW TO IMPORT:'],
  ['  1. Open Inventory → Product Master → Import Products'],
  ['  2. Upload this file'],
  ['  3. Preview screen shows ' + rows.length + ' valid · 0 errors (assuming SQL ran correctly)'],
  ['  4. Click Commit'],
  [''],
  ['AFTER IMPORT:'],
  ['  • Go to Product Master tab'],
  ['  • Star (⭐) the products you sell most often — featured rows appear at the top of every picker'],
  ['  • Over time, use_count auto-increments based on actual usage — popular products naturally rise'],
  [''],
  ['EXAMPLE QUICK CODES IN THIS FILE:'],
];
for (var ex = 0; ex < 8; ex++) {
  instrAOA.push(['  ' + rows[ex].quick_code + ' → ' + rows[ex].classification_slug]);
}
var instrSheet = XLSX.utils.aoa_to_sheet(instrAOA);
instrSheet['!cols'] = [{ wch: 100 }];
XLSX.utils.book_append_sheet(wb, instrSheet, 'Instructions');

// ─── Write ───────────────────────────────────────────────────────
var stamp = new Date().toISOString().substring(0, 10);
var outPath = '/mnt/user-data/outputs/KTC-Leather-USA-Full-Catalog-' + stamp + '.xlsx';
XLSX.writeFile(wb, outPath);
console.log('\nWrote: ' + outPath);
var stats = fs.statSync(outPath);
console.log('Size: ' + (stats.size / 1024).toFixed(1) + ' KB');
