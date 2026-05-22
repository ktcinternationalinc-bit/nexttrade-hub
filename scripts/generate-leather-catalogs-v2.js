// v55.83-A.6.27.38 — Leather catalog generator (3 catalogs, 6-char quick codes)
//
// Generates 3 separate Excel files:
//   1. KTC-Leather-Luxurious-Catalog — Grade=LX, 12 colors × 4 countries = 48 rows
//   2. KTC-Leather-Stock-Catalog     — Grade=ST, 12 colors × 4 countries = 48 rows
//   3. KTC-Leather-Smooth-Catalog    — Category=SM, Grade=NA, 2 colors × 4 countries = 8 rows
//
// Quick code formula: Family[0] + Grade[0] + Color(2) + Country(2) = 6 chars
//   e.g. LE + LX + BK + US → LLBKUS  (Leather Luxurious Black USA)
//   e.g. LE + ST + DG + CN → LSDGCN  (Leather Stock Dark Grey China)
//   e.g. LE + NA + BK + EG → LNBKEG  (Leather Smooth Black Egypt — using NA grade)
//
// Database master codes are UNCHANGED — quick_code is just a compressed display string.
// classification_slug still spells out the full pattern: LE-LX-BK-US

const XLSX = require('xlsx');
const fs = require('fs');

// ─── Master code source data (matches inventory_lists rows) ─────
const FAMILY_LE = { code: 'LE', label_en: 'Leather', label_ar: 'جلد' };

const GRADES = {
  LX: { code: 'LX', label_en: 'Luxurious', label_ar: 'فاخر' },
  PR: { code: 'PR', label_en: 'Premium',   label_ar: 'بريميوم' },
  ST: { code: 'ST', label_en: 'Stock',     label_ar: 'ستوك' },
  NA: { code: 'NA', label_en: 'Not Applicable', label_ar: 'غير مطبق' },
};

const CATEGORY_SM = { code: 'SM', label_en: 'Smooth', label_ar: 'ناعم' };

const COLORS_12 = [
  { code: 'BK', label_en: 'Black',       label_ar: 'أسود' },
  { code: 'BG', label_en: 'Beige',       label_ar: 'بيج' },
  { code: 'BN', label_en: 'Brown',       label_ar: 'بني' },
  { code: 'RD', label_en: 'Red',         label_ar: 'أحمر' },
  { code: 'MR', label_en: 'Maroon',      label_ar: 'نبيتي' },
  { code: 'HV', label_en: 'Havana',      label_ar: 'هافان' },
  { code: 'OL', label_en: 'Olive',       label_ar: 'زيتي' },
  { code: 'SW', label_en: 'Snow White',  label_ar: 'أبيض ثلجي' },
  { code: 'WH', label_en: 'White',       label_ar: 'أبيض' },
  { code: 'GR', label_en: 'Gray',        label_ar: 'رمادي' },
  { code: 'LG', label_en: 'Light Gray',  label_ar: 'رمادي فاتح' },
  { code: 'DG', label_en: 'Dark Grey',   label_ar: 'رمادي غامق' },
];

const COLORS_SMOOTH = [
  { code: 'BK', label_en: 'Black', label_ar: 'أسود' },
  { code: 'OT', label_en: 'Other', label_ar: 'أخرى' },
];

const COUNTRIES = [
  { code: 'US', label_en: 'United States', label_ar: 'الولايات المتحدة' },
  { code: 'CA', label_en: 'Canada',        label_ar: 'كندا' },
  { code: 'CN', label_en: 'China',         label_ar: 'الصين' },
  { code: 'EG', label_en: 'Egypt',         label_ar: 'مصر' },
];

// ─── Helpers ────────────────────────────────────────────────────
function buildQuickCode(familyCode, gradeCode, colorCode, countryCode) {
  return familyCode.charAt(0) + gradeCode.charAt(0) + colorCode + countryCode;
}

function buildClassificationSlug(familyCode, categoryCode, gradeCode, colorCode, countryCode) {
  // Order: family - category - grade - color - country
  // Empty segments left as empty (renders LE--LX-BK-US if category absent)
  return [familyCode, categoryCode, gradeCode, colorCode, countryCode].join('-');
}

function buildName(familyLabel, categoryLabel, gradeLabel, colorLabel, countryLabel) {
  var parts = [familyLabel];
  if (categoryLabel) parts.push(categoryLabel);
  if (gradeLabel && gradeLabel !== 'Not Applicable' && gradeLabel !== 'غير مطبق') parts.push(gradeLabel);
  parts.push(colorLabel);
  return parts.join(' ') + ' (' + countryLabel + ')';
}

// ─── Workbook builder ───────────────────────────────────────────
function buildWorkbook(opts) {
  // opts = { title, filename, family, category, grade, colors, countries, instructions, includesEmbossed }
  var rows = [];
  var family = opts.family;
  var category = opts.category || null;
  var grade = opts.grade;

  for (var c = 0; c < opts.colors.length; c++) {
    var color = opts.colors[c];
    for (var k = 0; k < opts.countries.length; k++) {
      var country = opts.countries[k];
      var qc = buildQuickCode(family.code, grade.code, color.code, country.code);
      var slug = buildClassificationSlug(
        family.code,
        category ? category.code : '',
        grade.code,
        color.code,
        country.code
      );
      var name_en = buildName(
        family.label_en,
        category ? category.label_en : '',
        grade.label_en,
        color.label_en,
        country.label_en
      );
      var name_ar = buildName(
        family.label_ar,
        category ? category.label_ar : '',
        grade.label_ar,
        color.label_ar,
        country.label_ar
      );
      rows.push({
        quick_code: qc,
        name_en: name_en,
        name_ar: name_ar,
        family_code: family.code,
        category_code: category ? category.code : '',
        grade_code: grade.code,
        construction_code: '',
        backing_code: '',
        color_code: color.code,
        pattern_code: '',
        spec_class_code: '',
        origin_code: country.code,
        classification_slug: slug,
        default_uom: 'meter',
        default_supplier: '',
        default_cost: '',
        default_currency: 'USD',
        default_rack: '',
        notes: '',
        active: 'TRUE',
      });
    }
  }

  console.log('  Generated ' + rows.length + ' rows for "' + opts.title + '"');

  var wb = XLSX.utils.book_new();

  // Sheet 1: Products
  var productsAOA = [[
    'quick_code', 'name_en', 'name_ar',
    'family_code', 'category_code', 'grade_code', 'construction_code',
    'backing_code', 'color_code', 'pattern_code', 'spec_class_code', 'origin_code',
    'classification_slug',
    'default_uom', 'default_supplier', 'default_cost', 'default_currency', 'default_rack',
    'notes', 'active',
  ]];
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    productsAOA.push([
      row.quick_code, row.name_en, row.name_ar,
      row.family_code, row.category_code, row.grade_code, row.construction_code,
      row.backing_code, row.color_code, row.pattern_code, row.spec_class_code, row.origin_code,
      row.classification_slug,
      row.default_uom, row.default_supplier, row.default_cost, row.default_currency, row.default_rack,
      row.notes, row.active,
    ]);
  }
  var productsSheet = XLSX.utils.aoa_to_sheet(productsAOA);
  productsSheet['!cols'] = [
    { wch: 9 }, { wch: 44 }, { wch: 44 },
    { wch: 7 }, { wch: 9 }, { wch: 7 }, { wch: 11 },
    { wch: 9 }, { wch: 7 }, { wch: 9 }, { wch: 11 }, { wch: 8 },
    { wch: 22 },
    { wch: 9 }, { wch: 22 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
    { wch: 24 }, { wch: 6 },
  ];
  XLSX.utils.book_append_sheet(wb, productsSheet, 'Products');

  // Sheet 2: Codes Reference
  var codesAOA = [['Level', 'Code', 'English', 'Arabic']];
  codesAOA.push([1, family.code, family.label_en + ' (Family)', family.label_ar]);
  if (category) codesAOA.push([2, category.code, category.label_en + ' (Category)', category.label_ar]);
  codesAOA.push([3, grade.code, grade.label_en + ' (Grade)', grade.label_ar]);
  for (var ci = 0; ci < opts.colors.length; ci++) {
    var col = opts.colors[ci];
    codesAOA.push([6, col.code, col.label_en + ' (Color)', col.label_ar]);
  }
  for (var oi = 0; oi < opts.countries.length; oi++) {
    var origin = opts.countries[oi];
    codesAOA.push([9, origin.code, origin.label_en + ' (Origin)', origin.label_ar]);
  }
  var codesSheet = XLSX.utils.aoa_to_sheet(codesAOA);
  codesSheet['!cols'] = [{ wch: 7 }, { wch: 9 }, { wch: 30 }, { wch: 24 }];
  XLSX.utils.book_append_sheet(wb, codesSheet, 'Codes Reference');

  // Sheet 3: Rules
  var rulesAOA = [
    ['Rule', 'Detail'],
    ['Quick code format', '6 characters: Family[0] + Grade[0] + Color(2) + Country(2)'],
    ['Example', 'LLBKUS = Leather + Luxurious + Black + USA'],
    ['Family code in DB', family.code + ' (' + family.label_en + ') — 2-letter master code stays unchanged in DB'],
    ['Grade code in DB', grade.code + ' (' + grade.label_en + ')'],
    ['Category', category ? (category.code + ' = ' + category.label_en) : 'BLANK — set per receipt OR leave default'],
    ['Construction / Backing / Spec Class', 'BLANK — varies per actual roll, set at receiving'],
    ['Pattern', 'BLANK — most products are solid (no pattern)'],
    ['Default UOM', 'meter (changeable per row)'],
    ['Default Currency', 'USD (changeable per row)'],
    ['Default Supplier / Cost / Rack', 'BLANK — fill manually or set at receipt time'],
    ['Active', 'TRUE — all rows imported as active'],
    ['classification_slug', 'Spells out full FK chain: Family-Category-Grade-Color-Country'],
  ];
  var rulesSheet = XLSX.utils.aoa_to_sheet(rulesAOA);
  rulesSheet['!cols'] = [{ wch: 32 }, { wch: 80 }];
  XLSX.utils.book_append_sheet(wb, rulesSheet, 'Rules');

  // Sheet 4: Instructions
  var instrAOA = [
    ['KTC NextTrade Hub — ' + opts.title + ' Import'],
    [''],
    ['PURPOSE:'],
    ['Bulk-import ' + rows.length + ' products into the Product Master.'],
    [''],
    ['PREREQUISITE — RUN THIS SQL FIRST (only needed once across all catalogs):'],
    ['  1. Make sure Level 9 origin countries are: US / CA / CN / EG'],
    ['     INSERT INTO inventory_lists (level, code, label_en, label_ar, display_order) VALUES'],
    ['       (9, \'EG\', \'Egypt\', \'مصر\', 4) ON CONFLICT DO NOTHING;'],
    ['     UPDATE inventory_lists SET active=true WHERE level=9 AND code IN (\'US\',\'CA\',\'CN\',\'EG\');'],
  ];
  if (opts.title.indexOf('Smooth') >= 0) {
    instrAOA.push(['  2. Make sure "Other" color (OT) exists at Level 6:']);
    instrAOA.push(['     INSERT INTO inventory_lists (level, code, label_en, label_ar, display_order) VALUES']);
    instrAOA.push(['       (6, \'OT\', \'Other\', \'أخرى\', 99) ON CONFLICT DO NOTHING;']);
  }
  instrAOA.push(['']);
  instrAOA.push(['HOW TO IMPORT:']);
  instrAOA.push(['  1. Open Inventory → Product Master → Import Products']);
  instrAOA.push(['  2. Upload this file']);
  instrAOA.push(['  3. Preview screen shows ' + rows.length + ' valid rows + 0 errors']);
  instrAOA.push(['  4. Click Commit']);
  instrAOA.push(['']);
  instrAOA.push(['QUICK CODE FORMULA:']);
  instrAOA.push(['  6 characters: Family[0] + Grade[0] + Color(2) + Country(2)']);
  instrAOA.push(['  Examples in this file:']);
  for (var ex = 0; ex < Math.min(4, rows.length); ex++) {
    instrAOA.push(['    ' + rows[ex].quick_code + ' = ' + rows[ex].name_en]);
  }

  if (opts.instructions && opts.instructions.length) {
    instrAOA.push(['']);
    instrAOA.push(['NOTES SPECIFIC TO THIS CATALOG:']);
    for (var i2 = 0; i2 < opts.instructions.length; i2++) {
      instrAOA.push(['  • ' + opts.instructions[i2]]);
    }
  }

  var instrSheet = XLSX.utils.aoa_to_sheet(instrAOA);
  instrSheet['!cols'] = [{ wch: 100 }];
  XLSX.utils.book_append_sheet(wb, instrSheet, 'Instructions');

  XLSX.writeFile(wb, opts.filename);
  var stats = fs.statSync(opts.filename);
  console.log('  Wrote: ' + opts.filename + ' (' + (stats.size / 1024).toFixed(1) + ' KB)');
  console.log('');
}

// ─── Generate the 3 catalogs ────────────────────────────────────
var stamp = new Date().toISOString().substring(0, 10);

console.log('Generating Leather Luxurious...');
buildWorkbook({
  title: 'Leather Luxurious',
  filename: '/mnt/user-data/outputs/KTC-Leather-Luxurious-Catalog-' + stamp + '.xlsx',
  family: FAMILY_LE,
  category: null,
  grade: GRADES.LX,
  colors: COLORS_12,
  countries: COUNTRIES,
  instructions: [
    'Quick codes start with "LL" (Leather + Luxurious): LLBKUS, LLDGCN, LLBNEG, etc.',
    '12 colors × 4 countries = 48 rows total',
    'category_code BLANK — Leather can be Smooth (SM) or Embossed (EM); set per receipt',
  ],
});

console.log('Generating Leather Stock...');
buildWorkbook({
  title: 'Leather Stock',
  filename: '/mnt/user-data/outputs/KTC-Leather-Stock-Catalog-' + stamp + '.xlsx',
  family: FAMILY_LE,
  category: null,
  grade: GRADES.ST,
  colors: COLORS_12,
  countries: COUNTRIES,
  instructions: [
    'Quick codes start with "LS" (Leather + Stock): LSBKUS, LSDGCN, LSBNEG, etc.',
    '12 colors × 4 countries = 48 rows total',
    'Stock-grade economy line — typically used for fast-turn lower-margin items',
  ],
});

console.log('Generating Leather Smooth (Black + Other only)...');
buildWorkbook({
  title: 'Leather Smooth',
  filename: '/mnt/user-data/outputs/KTC-Leather-Smooth-Catalog-' + stamp + '.xlsx',
  family: FAMILY_LE,
  category: CATEGORY_SM,
  grade: GRADES.NA,
  colors: COLORS_SMOOTH,
  countries: COUNTRIES,
  instructions: [
    'Quick codes start with "LN" (Leather + N/A grade since smooth is a Category, not a Grade)',
    'Only 2 colors: Black (BK) and Other (OT) × 4 countries = 8 rows total',
    'Smooth is a Category (Level 2) so category_code = SM is filled',
    'Use this for sample/utility tracking when you don\'t need to break down by grade',
    'REQUIRES: "OT" color added at Level 6 (see Instructions sheet for SQL)',
  ],
});

console.log('All 3 catalogs generated.');
