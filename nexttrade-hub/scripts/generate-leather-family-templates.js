// v55.83-A.6.27.39 — Leather USA Family Templates (27 rows, one per quick code)
//
// Design: master holds the IDENTITY (Family + Grade + Color + Country).
// Specific variants (with full Cat/Constr/Back/Pattern) are created at receipt time
// by the get_or_create_variant() PL/pgSQL function and assigned suffixes -001, -002, etc.
//
// This file is the "starter set" — 27 family templates.
//
// Math: 1 Family × 3 Grades (LX/PR/ST) × 9 Colors × 1 Country = 27 rows
//
// Colors: BG, BK, BN, GR, HV, MR, NB, OL, WH (9)
//   (SW, DG, LG excluded per prior decision)
//
// At receipt time, operator picks the family, fills in 4 mandatory spec dropdowns,
// and the system either reuses an existing variant or creates a new one.

const XLSX = require('xlsx');
const fs = require('fs');

const FAMILY = { code: 'L', label_en: 'Leather', label_ar: 'جلد' };

const GRADES = [
  { code: 'LX', label_en: 'Luxurious',        label_ar: 'فاخر' },
  { code: 'PR', label_en: 'Standard Premium', label_ar: 'ستاندرد بريميوم' },
  { code: 'ST', label_en: 'Stock',            label_ar: 'ستوك' },
];

const COLORS = [
  { code: 'BG', label_en: 'Beige',     label_ar: 'بيج' },
  { code: 'BK', label_en: 'Black',     label_ar: 'أسود' },
  { code: 'BN', label_en: 'Brown',     label_ar: 'بني' },
  { code: 'GR', label_en: 'Gray',      label_ar: 'رمادي' },
  { code: 'HV', label_en: 'Havana',    label_ar: 'هافان' },
  { code: 'MR', label_en: 'Maroon',    label_ar: 'نبيتي' },
  { code: 'NB', label_en: 'Navy Blue', label_ar: 'كحلي' },
  { code: 'OL', label_en: 'Olive',     label_ar: 'زيتي' },
  { code: 'WH', label_en: 'White',     label_ar: 'أبيض' },
];

const COUNTRY = { code: 'US', label_en: 'United States', label_ar: 'الولايات المتحدة' };

const rows = [];
for (const grade of GRADES) {
  for (const color of COLORS) {
    // Quick code: Family[0] + Grade[0] + Color(2) + Country(2) = 6 chars
    const quick_code = FAMILY.code.charAt(0) + grade.code.charAt(0) + color.code + COUNTRY.code;

    // Classification slug — variable levels are blank (filled at receipt time)
    // Order: Family - Category - Grade - Construction - Backing - Color - Pattern - Spec - Country
    const classification_slug = FAMILY.code + '--' + grade.code + '---' + color.code + '---' + COUNTRY.code;

    const name_en = FAMILY.label_en + ' ' + grade.label_en + ' ' + color.label_en + ' (' + COUNTRY.label_en + ')';
    const name_ar = FAMILY.label_ar + ' ' + grade.label_ar + ' ' + color.label_ar + ' (' + COUNTRY.label_ar + ')';

    rows.push({
      quick_code, name_en, name_ar,
      family_code: FAMILY.code,
      category_code: '',       // filled at receipt time (variant creation)
      grade_code: grade.code,
      construction_code: '',   // filled at receipt time
      backing_code: '',        // filled at receipt time
      color_code: color.code,
      pattern_code: '',        // filled at receipt time
      spec_class_code: 'NA',
      origin_code: COUNTRY.code,
      classification_slug,
      default_uom: 'meter',
      default_supplier: '',
      default_cost: '',
      default_currency: 'USD',
      default_rack: '',
      notes: 'Family template — variants created automatically at receipt time',
      featured: 'FALSE',
      active: 'TRUE',
      is_family_template: 'TRUE',   // NEW — marks this as a template, not a variant
      variant_suffix: '',           // NEW — empty for templates; filled with -001/-002 for variants
    });
  }
}

console.log('Generated ' + rows.length + ' family template rows (expected: 27)');

// ─── Build workbook ────────────────────────────────────────────
const wb = XLSX.utils.book_new();

const headers = [
  'quick_code', 'name_en', 'name_ar',
  'family_code', 'category_code', 'grade_code', 'construction_code',
  'backing_code', 'color_code', 'pattern_code', 'spec_class_code', 'origin_code',
  'classification_slug',
  'default_uom', 'default_supplier', 'default_cost', 'default_currency', 'default_rack',
  'notes', 'featured', 'active',
  'is_family_template', 'variant_suffix',
];

const aoa = [headers];
for (const r of rows) {
  aoa.push(headers.map(h => r[h] === undefined ? '' : r[h]));
}

const productsSheet = XLSX.utils.aoa_to_sheet(aoa);
productsSheet['!cols'] = headers.map(h => {
  if (h.indexOf('name_') === 0) return { wch: 40 };
  if (h === 'notes') return { wch: 50 };
  if (h === 'classification_slug') return { wch: 24 };
  if (h.indexOf('code') >= 0) return { wch: 8 };
  if (h === 'is_family_template') return { wch: 18 };
  return { wch: 12 };
});
XLSX.utils.book_append_sheet(wb, productsSheet, 'Products');

// Sheet 2: Codes Reference
const codesAOA = [['Level', 'Code', 'English', 'Arabic']];
codesAOA.push([1, FAMILY.code, FAMILY.label_en, FAMILY.label_ar]);
GRADES.forEach(g => codesAOA.push([3, g.code, g.label_en + ' (Grade)', g.label_ar]));
COLORS.forEach(c => codesAOA.push([6, c.code, c.label_en + ' (Color)', c.label_ar]));
codesAOA.push([8, 'NA', 'Not Applicable (Spec Class)', 'غير مطبق']);
codesAOA.push([9, COUNTRY.code, COUNTRY.label_en + ' (Origin)', COUNTRY.label_ar]);
const codesSheet = XLSX.utils.aoa_to_sheet(codesAOA);
codesSheet['!cols'] = [{ wch: 7 }, { wch: 9 }, { wch: 32 }, { wch: 26 }];
XLSX.utils.book_append_sheet(wb, codesSheet, 'Codes Reference');

// Sheet 3: How variants work
const variantsAOA = [
  ['Family Template vs Variant'],
  [''],
  ['This file contains 27 FAMILY TEMPLATES — one per unique quick code.'],
  ['Each template defines a product IDENTITY (Family + Grade + Color + Country).'],
  [''],
  ['VARIANTS are created automatically at receive-stock time:'],
  ['  1. Operator picks a family template (e.g. LLBKUS = Leather Luxurious Black US)'],
  ['  2. Operator fills 4 mandatory spec dropdowns: Category, Construction, Backing, Pattern'],
  ['  3. System calls get_or_create_variant() and either:'],
  ['     a) Returns an existing variant that matches the specs, OR'],
  ['     b) Creates a NEW variant with the next sequential suffix (-001, -002, ...)'],
  [''],
  ['EXAMPLE:'],
  ['  Template: LLBKUS  (Luxurious Black US — no Cat/Constr/Back/Pattern set)'],
  ['  Variant:  LLBKUS-001  (Smooth · Regular · Cotton · None)'],
  ['  Variant:  LLBKUS-002  (Embossed · Perforated · Gray Suede · Mechanical Grain)'],
  ['  Variant:  LLBKUS-003  (Smooth · Foam Non-Perforated · Non-Woven · None)'],
  [''],
  ['STARRING:'],
  ['  Both family templates AND variants can be starred (featured = true).'],
  ['  Featured rows always appear at the top of search dropdowns.'],
  [''],
  ['SOFT WARNINGS:'],
  ['  When a variant is created with Category = Smooth but Color != Black,'],
  ['  the system shows a soft warning ("Smooth typically only available in Black")'],
  ['  but allows override if operator confirms.'],
  [''],
  ['SEARCH:'],
  ['  Typing "LL" → finds all Luxurious templates + variants'],
  ['  Typing "LLBK" → narrows to Black Luxurious'],
  ['  Typing "lux brown" → finds Luxurious Brown templates + variants'],
  ['  Typing "LLBKUS-002" → jumps straight to that specific variant'],
  ['  Multi-word, any order, case-insensitive, substring match.'],
];
const variantsSheet = XLSX.utils.aoa_to_sheet(variantsAOA);
variantsSheet['!cols'] = [{ wch: 90 }];
XLSX.utils.book_append_sheet(wb, variantsSheet, 'How Variants Work');

// ─── Write ──────────────────────────────────────────────────────
const stamp = new Date().toISOString().substring(0, 10);
const outPath = '/mnt/user-data/outputs/KTC-Leather-USA-Family-Templates-' + stamp + '.xlsx';
XLSX.writeFile(wb, outPath);
console.log('Wrote: ' + outPath);
console.log('Size: ' + (fs.statSync(outPath).size / 1024).toFixed(1) + ' KB');

// Show first 5 rows
console.log('\nFirst 5 rows:');
rows.slice(0, 5).forEach(r => console.log('  ' + r.quick_code + ' | ' + r.name_en));
console.log('\nLast row:');
const last = rows[rows.length - 1];
console.log('  ' + last.quick_code + ' | ' + last.name_en);
