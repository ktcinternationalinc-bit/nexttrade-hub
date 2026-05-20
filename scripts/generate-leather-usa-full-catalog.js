// v55.83-A.6.27.38 — Leather USA 684-row catalog (Smooth + Embossed)
//
// Per Max's filters:
//   Family       — L (Leather only)
//   Category     — SM, EM
//   Grade        — LX, PR, ST (NO NA — Leather always has a real grade)
//   Construction — RG, PF, FN (3 only, per Max's narrowing)
//   Backing      — BK, CT, GS, NW (4 only — FL, OT, NA, GR removed for this exercise)
//   Color        — BG, BK, BN, GR, HV, MR, NB, OL, WH (9 — removed SW, DG, LG)
//   Pattern      — Smooth branch: NA only. Embossed branch: MG, RG (no HC for this exercise, no NA)
//   Spec Class   — NA only at master level (thickness lives on receipts)
//   Country      — US only
//
// Math:
//   Smooth   = 3 grades × 3 constructions × 4 backings × 1 color (Black) × 1 pattern (NA) =  36 rows
//   Embossed = 3 grades × 3 constructions × 4 backings × 9 colors        × 2 patterns      = 648 rows
//   TOTAL = 684 rows
//
// All rows imported with featured = FALSE. Max stars favorites in UI after import.

const XLSX = require('xlsx');
const fs = require('fs');

const FAMILY = { code: 'L', label_en: 'Leather', label_ar: 'جلد' };

const CATEGORIES = {
  SM: { code: 'SM', label_en: 'Smooth',   label_ar: 'ناعم' },
  EM: { code: 'EM', label_en: 'Embossed', label_ar: 'منقوش' },
};

const GRADES = [
  { code: 'LX', label_en: 'Luxurious',        label_ar: 'فاخر' },
  { code: 'PR', label_en: 'Standard Premium', label_ar: 'ستاندرد بريميوم' },
  { code: 'ST', label_en: 'Stock',            label_ar: 'ستوك' },
];

const CONSTRUCTIONS = [
  { code: 'RG', label_en: 'Regular',             label_ar: 'عادي' },
  { code: 'PF', label_en: 'Perforated',          label_ar: 'مخرم' },
  { code: 'FN', label_en: 'Foam Non-Perforated', label_ar: 'إسفنج غير مخرم' },
];

const BACKINGS = [
  { code: 'BK', label_en: 'Black',      label_ar: 'أسود' },
  { code: 'CT', label_en: 'Cotton',     label_ar: 'قطن' },
  { code: 'GS', label_en: 'Gray Suede', label_ar: 'شامواه رمادي' },
  { code: 'NW', label_en: 'Non-Woven',  label_ar: 'نون ووفن' },
];

// 9 colors used by Embossed branch (Smooth uses only Black)
const COLORS_EMBOSSED = [
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

const COLOR_BLACK = { code: 'BK', label_en: 'Black', label_ar: 'أسود' };

const PATTERN_NONE = { code: 'NA', label_en: 'None', label_ar: 'بدون' };
const PATTERNS_EMBOSSED = [
  { code: 'MG', label_en: 'Mechanical Grain', label_ar: 'حبيبات ميكانيكية' },
  { code: 'RG', label_en: 'Normal Emboss',    label_ar: 'نقشة عادية' },
];

const SPEC_NA   = { code: 'NA', label_en: 'Not Applicable', label_ar: 'غير مطبق' };
const COUNTRY   = { code: 'US', label_en: 'United States',  label_ar: 'الولايات المتحدة' };

// ─── Build the rows ─────────────────────────────────────────────
const rows = [];

function pushRow(category, grade, construction, backing, color, pattern) {
  // Quick code: Family[0] + Grade[0] + Color(2) + Country(2) = 6 chars
  // (Multiple rows may share the same quick_code — they differ in cat/constr/back/pattern.
  //  The picker dropdown shows the full classification to distinguish them.)
  const quick_code = FAMILY.code.charAt(0) + grade.code.charAt(0) + color.code + COUNTRY.code;

  // Classification slug — the real unique identifier
  // Order: Family - Category - Grade - Construction - Backing - Color - Pattern - Spec - Country
  const classification_slug =
    FAMILY.code + '-' + category.code + '-' + grade.code + '-' +
    construction.code + '-' + backing.code + '-' + color.code + '-' +
    pattern.code + '-' + SPEC_NA.code + '-' + COUNTRY.code;

  // Full readable name showing every level
  const name_en =
    FAMILY.label_en + ' ' + category.label_en + ' ' + grade.label_en + ' · ' +
    construction.label_en + ' · ' + backing.label_en + ' backing · ' +
    color.label_en + ' · ' + pattern.label_en + ' · ' + COUNTRY.label_en;
  const name_ar =
    FAMILY.label_ar + ' ' + category.label_ar + ' ' + grade.label_ar + ' · ' +
    construction.label_ar + ' · ' + backing.label_ar + ' بطانة · ' +
    color.label_ar + ' · ' + pattern.label_ar + ' · ' + COUNTRY.label_ar;

  rows.push({
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
    classification_slug: classification_slug,
    default_uom: 'meter',
    default_supplier: '',
    default_cost: '',
    default_currency: 'USD',
    default_rack: '',
    notes: '',
    featured: 'FALSE',                // per Option E: all unfeatured; star later via UI
    active: 'TRUE',
  });
}

// Smooth branch — Black color only, None pattern only
for (const grade of GRADES) {
  for (const constr of CONSTRUCTIONS) {
    for (const back of BACKINGS) {
      pushRow(CATEGORIES.SM, grade, constr, back, COLOR_BLACK, PATTERN_NONE);
    }
  }
}

// Embossed branch — 9 colors × MG/RG patterns
for (const grade of GRADES) {
  for (const constr of CONSTRUCTIONS) {
    for (const back of BACKINGS) {
      for (const color of COLORS_EMBOSSED) {
        for (const pattern of PATTERNS_EMBOSSED) {
          pushRow(CATEGORIES.EM, grade, constr, back, color, pattern);
        }
      }
    }
  }
}

console.log('Generated ' + rows.length + ' rows');
console.log('  Expected: 3 × 3 × 4 × 1 × 1 = 36 (Smooth) + 3 × 3 × 4 × 9 × 2 = 648 (Embossed) = 684');

// ─── Build the workbook ─────────────────────────────────────────
const wb = XLSX.utils.book_new();

// Sheet 1: Products (the import data)
const productsAOA = [[
  'quick_code', 'name_en', 'name_ar',
  'family_code', 'category_code', 'grade_code', 'construction_code',
  'backing_code', 'color_code', 'pattern_code', 'spec_class_code', 'origin_code',
  'classification_slug',
  'default_uom', 'default_supplier', 'default_cost', 'default_currency', 'default_rack',
  'notes', 'featured', 'active',
]];
for (const r of rows) {
  productsAOA.push([
    r.quick_code, r.name_en, r.name_ar,
    r.family_code, r.category_code, r.grade_code, r.construction_code,
    r.backing_code, r.color_code, r.pattern_code, r.spec_class_code, r.origin_code,
    r.classification_slug,
    r.default_uom, r.default_supplier, r.default_cost, r.default_currency, r.default_rack,
    r.notes, r.featured, r.active,
  ]);
}
const productsSheet = XLSX.utils.aoa_to_sheet(productsAOA);
productsSheet['!cols'] = [
  { wch: 9 }, { wch: 60 }, { wch: 60 },
  { wch: 7 }, { wch: 9 }, { wch: 7 }, { wch: 11 },
  { wch: 9 }, { wch: 7 }, { wch: 9 }, { wch: 11 }, { wch: 8 },
  { wch: 30 },
  { wch: 9 }, { wch: 22 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
  { wch: 20 }, { wch: 8 }, { wch: 6 },
];
XLSX.utils.book_append_sheet(wb, productsSheet, 'Products');

// Sheet 2: Codes Reference
const codesAOA = [['Level', 'Code', 'English', 'Arabic']];
codesAOA.push([1, FAMILY.code, FAMILY.label_en + ' (Family)', FAMILY.label_ar]);
codesAOA.push([2, CATEGORIES.SM.code, CATEGORIES.SM.label_en + ' (Category)', CATEGORIES.SM.label_ar]);
codesAOA.push([2, CATEGORIES.EM.code, CATEGORIES.EM.label_en + ' (Category)', CATEGORIES.EM.label_ar]);
GRADES.forEach(g => codesAOA.push([3, g.code, g.label_en + ' (Grade)', g.label_ar]));
CONSTRUCTIONS.forEach(c => codesAOA.push([4, c.code, c.label_en + ' (Construction)', c.label_ar]));
BACKINGS.forEach(b => codesAOA.push([5, b.code, b.label_en + ' (Backing)', b.label_ar]));
COLORS_EMBOSSED.forEach(c => codesAOA.push([6, c.code, c.label_en + ' (Color)', c.label_ar]));
codesAOA.push([7, PATTERN_NONE.code, PATTERN_NONE.label_en + ' (Pattern)', PATTERN_NONE.label_ar]);
PATTERNS_EMBOSSED.forEach(p => codesAOA.push([7, p.code, p.label_en + ' (Pattern)', p.label_ar]));
codesAOA.push([8, SPEC_NA.code, SPEC_NA.label_en + ' (Spec Class)', SPEC_NA.label_ar]);
codesAOA.push([9, COUNTRY.code, COUNTRY.label_en + ' (Origin)', COUNTRY.label_ar]);
const codesSheet = XLSX.utils.aoa_to_sheet(codesAOA);
codesSheet['!cols'] = [{ wch: 7 }, { wch: 9 }, { wch: 32 }, { wch: 26 }];
XLSX.utils.book_append_sheet(wb, codesSheet, 'Codes Reference');

// Sheet 3: Rules
const rulesAOA = [
  ['Rule', 'Detail'],
  ['Total rows', '684 (Smooth=36 + Embossed=648)'],
  ['Quick code format', '6 characters: Family[0] + Grade[0] + Color(2) + Country(2)'],
  ['Example quick codes', 'LLBKUS, LPBNUS, LSGRUS, etc.'],
  ['Quick code uniqueness', 'NOT unique — many rows share a quick_code (e.g. all 72 LLBKUS variants).'],
  ['',                     'Use classification_slug as the real unique identifier.'],
  ['Featured (initial)',   'FALSE for all 684 rows. Star your favorites via UI after import.'],
  ['Smooth branch (SM)',   'Black color only · None pattern only · 3 grades × 3 constructions × 4 backings = 36 rows'],
  ['Embossed branch (EM)', '9 colors × 2 patterns (Mechanical Grain + Normal Emboss) × 3 grades × 3 constructions × 4 backings = 648 rows'],
  ['Spec Class',           'NA for all rows. Actual thickness recorded at receiving time on each receipt.'],
  ['Origin',               'US only. Add other countries to Level 9 + regenerate catalog if needed.'],
  ['Construction values',  'RG, PF, FN (Regular, Perforated, Foam Non-Perforated)'],
  ['Backing values',       'BK, CT, GS, NW (Black, Cotton, Gray Suede, Non-Woven)'],
  ['Colors excluded',      'Snow White (SW), Dark Grey (DG), Light Gray (LG) — not part of this initial import'],
  ['Construction excluded','FP (Foam Perforated), TL (Tri-Lam) — not part of this initial import'],
  ['Backing excluded',     'FL (Felt), GR (Gray), OT (Other), NA — not part of this initial import'],
];
const rulesSheet = XLSX.utils.aoa_to_sheet(rulesAOA);
rulesSheet['!cols'] = [{ wch: 32 }, { wch: 100 }];
XLSX.utils.book_append_sheet(wb, rulesSheet, 'Rules');

// Sheet 4: Instructions
const instrAOA = [
  ['KTC NextTrade Hub — Leather USA Full Catalog Import'],
  [''],
  ['CONTENTS:'],
  ['  • 684 Leather USA product master rows'],
  ['  • Covers every Family/Category/Grade/Construction/Backing/Color/Pattern combination per your filtering'],
  ['  • All rows imported with featured = FALSE — you star favorites via UI after'],
  [''],
  ['PREREQUISITE — RUN THE CONSOLIDATED SQL FIRST (the 10 chunks I sent earlier):'],
  ['  Chunk 1 — Fix Level CHECK + Add Level 9 US'],
  ['  Chunk 2 — inventory_shipment_headers table'],
  ['  Chunk 3 — Indexes + trigger + RLS for shipment_headers'],
  ['  Chunk 4 — Backfill headers from existing receipts'],
  ['  Chunk 5 — featured + use_count columns on inventory_products'],
  ['  Chunk 6 — Drop UNIQUE on quick_code'],
  ['  Chunk 7 — Auto-increment use_count via trigger'],
  ['  Chunk 8 — Fix Leather Pattern parent rules'],
  ['  Chunk 9 — Refresh classification_slug'],
  ['  Chunk 10 — Verification queries'],
  [''],
  ['HOW TO IMPORT:'],
  ['  1. Open Inventory → Product Master → Import Products'],
  ['  2. Upload this file'],
  ['  3. Preview screen shows 684 valid rows + 0 errors'],
  ['  4. Click Commit'],
  [''],
  ['AFTER IMPORT — STAR YOUR FAVORITES:'],
  ['  Build v55.83-A.6.27.38 adds a ⭐ Star toggle in the Product Master tab.'],
  ['  Click the star to mark a product as featured. Featured products always appear'],
  ['  at the top of search dropdowns in Receive Stock + Adjustments + Sales Invoice.'],
  [''],
  ['QUICK CODE LOGIC:'],
  ['  Quick codes are 6 characters: Family[0] + Grade[0] + Color(2) + Country(2)'],
  ['  Multiple rows share the same quick_code — they differ in construction/backing/pattern.'],
  ['  Example: LLBKUS appears 72 times (24 from Smooth + 48 from Embossed)'],
  ['  When the user types LLBKUS in search, the dropdown shows all 72 variants with'],
  ['  the full classification of each so they can pick the exact spec.'],
  [''],
  ['EXAMPLES IN THIS FILE:'],
];
for (let i = 0; i < 5 && i < rows.length; i++) {
  instrAOA.push(['  ' + rows[i].quick_code + ' = ' + rows[i].name_en]);
}
const instrSheet = XLSX.utils.aoa_to_sheet(instrAOA);
instrSheet['!cols'] = [{ wch: 100 }];
XLSX.utils.book_append_sheet(wb, instrSheet, 'Instructions');

// ─── Write ───────────────────────────────────────────────────────
const stamp = new Date().toISOString().substring(0, 10);
const outPath = '/mnt/user-data/outputs/KTC-Leather-USA-Full-Catalog-' + stamp + '.xlsx';
XLSX.writeFile(wb, outPath);
console.log('Wrote: ' + outPath);
console.log('Size: ' + (fs.statSync(outPath).size / 1024).toFixed(1) + ' KB');
