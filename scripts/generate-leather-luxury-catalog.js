// v55.83-A.6.27.37 — Leather Luxury catalog generator
//
// Produces a ready-to-import .xlsx file with ALL Leather Luxury variations:
//   Family = Leather (LE)
//   Grade  = Luxurious (LX)
//   For each: 11 standard colors × 12 origin countries = 132 products
//
// Output: /mnt/user-data/outputs/KTC-Leather-Luxury-Catalog-2026-05-19.xlsx
//
// Sheets:
//   1. "Products" — the actual import data (132 rows)
//   2. "Codes Reference" — lookup of all short codes used
//   3. "Rules" — variance/origin rules
//   4. "Instructions" — how to use this file

const XLSX = require('xlsx');
const fs = require('fs');

// ─── Source data ────────────────────────────────────────────────
const FAMILY = { code: 'LE', label_en: 'Leather', label_ar: 'جلد' };
const GRADE  = { code: 'LX', label_en: 'Luxurious', label_ar: 'فاخر' };

// 11 standard colors (excludes pool-restricted blues, includes DG dark grey added in 4.37)
const COLORS = [
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

// 12 origin countries (Level 9 in master lists)
const ORIGINS = [
  { code: 'US', label_en: 'United States', label_ar: 'الولايات المتحدة' },
  { code: 'CN', label_en: 'China',         label_ar: 'الصين' },
  { code: 'KR', label_en: 'South Korea',   label_ar: 'كوريا الجنوبية' },
  { code: 'TR', label_en: 'Turkey',        label_ar: 'تركيا' },
  { code: 'IT', label_en: 'Italy',         label_ar: 'إيطاليا' },
  { code: 'EG', label_en: 'Egypt',         label_ar: 'مصر' },
  { code: 'DE', label_en: 'Germany',       label_ar: 'ألمانيا' },
  { code: 'JP', label_en: 'Japan',         label_ar: 'اليابان' },
  { code: 'VN', label_en: 'Vietnam',       label_ar: 'فيتنام' },
  { code: 'IN', label_en: 'India',         label_ar: 'الهند' },
  { code: 'BR', label_en: 'Brazil',        label_ar: 'البرازيل' },
  { code: 'MX', label_en: 'Mexico',        label_ar: 'المكسيك' },
];

// ─── Generate the 132 product rows ─────────────────────────────
const rows = [];
let seq = 0;
for (const color of COLORS) {
  for (const origin of ORIGINS) {
    seq++;
    const quick_code = FAMILY.code + GRADE.code + color.code + origin.code; // e.g. LELXBKUS
    const name_en = FAMILY.label_en + ' ' + GRADE.label_en + ' ' + color.label_en + ' (' + origin.label_en + ')';
    const name_ar = FAMILY.label_ar + ' ' + GRADE.label_ar + ' ' + color.label_ar + ' (' + origin.label_ar + ')';
    const classification_slug = FAMILY.code + '-' + GRADE.code + '-' + color.code + '-' + origin.code;
    rows.push({
      quick_code,
      name_en,
      name_ar,
      family_code: FAMILY.code,
      category_code: '',           // Leather has 2 categories (SM/EM) — left blank for you to fill per row, or fill SM as default if you want
      grade_code: GRADE.code,
      construction_code: '',       // varies per product — fill at receiving time
      backing_code: '',            // varies per product — fill at receiving time
      color_code: color.code,
      pattern_code: '',            // most leather has no pattern
      spec_class_code: '',         // thickness — fill at receiving time
      origin_code: origin.code,
      classification_slug,
      default_uom: 'meter',
      default_supplier: '',        // fill per origin manually
      default_cost: '',            // fill manually
      default_currency: 'USD',
      default_rack: '',
      notes: '',
      active: 'TRUE',
    });
  }
}

console.log('Generated ' + rows.length + ' Leather Luxury products');

// ─── Build the workbook ─────────────────────────────────────────
const wb = XLSX.utils.book_new();

// Sheet 1: Products (the import data)
const productsAOA = [
  // Header row matches Build 3 Import Products template
  [
    'quick_code', 'name_en', 'name_ar',
    'family_code', 'category_code', 'grade_code', 'construction_code',
    'backing_code', 'color_code', 'pattern_code', 'spec_class_code', 'origin_code',
    'classification_slug',
    'default_uom', 'default_supplier', 'default_cost', 'default_currency', 'default_rack',
    'notes', 'active',
  ],
];
for (const r of rows) {
  productsAOA.push([
    r.quick_code, r.name_en, r.name_ar,
    r.family_code, r.category_code, r.grade_code, r.construction_code,
    r.backing_code, r.color_code, r.pattern_code, r.spec_class_code, r.origin_code,
    r.classification_slug,
    r.default_uom, r.default_supplier, r.default_cost, r.default_currency, r.default_rack,
    r.notes, r.active,
  ]);
}
const productsSheet = XLSX.utils.aoa_to_sheet(productsAOA);
productsSheet['!cols'] = [
  { wch: 12 }, { wch: 38 }, { wch: 38 },
  { wch: 7 }, { wch: 9 }, { wch: 7 }, { wch: 11 },
  { wch: 9 }, { wch: 7 }, { wch: 9 }, { wch: 11 }, { wch: 8 },
  { wch: 24 },
  { wch: 9 }, { wch: 22 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
  { wch: 24 }, { wch: 6 },
];
XLSX.utils.book_append_sheet(wb, productsSheet, 'Products');

// Sheet 2: Codes Reference (so the importer knows what's valid)
const codesAOA = [
  ['Level', 'Code', 'English', 'Arabic'],
  // Level 1
  [1, 'LE', 'Leather (Family)', 'جلد'],
  // Level 3 (used)
  [3, 'LX', 'Luxurious (Grade)', 'فاخر'],
  // Level 6 colors
  ...COLORS.map(function (c) { return [6, c.code, c.label_en + ' (Color)', c.label_ar]; }),
  // Level 9 origins
  ...ORIGINS.map(function (o) { return [9, o.code, o.label_en + ' (Origin)', o.label_ar]; }),
];
const codesSheet = XLSX.utils.aoa_to_sheet(codesAOA);
codesSheet['!cols'] = [{ wch: 7 }, { wch: 9 }, { wch: 28 }, { wch: 22 }];
XLSX.utils.book_append_sheet(wb, codesSheet, 'Codes Reference');

// Sheet 3: Rules
const rulesAOA = [
  ['Rule', 'Detail'],
  ['Quick code format', '{Family}{Grade}{Color}{Origin} — 8 characters total, 2 letters each'],
  ['Example', 'LELXBKUS = Leather + Luxurious + Black + United States'],
  ['Origin (Level 9)', 'NEW field added in v55.83-A.6.27.37. Required for Leather Luxury catalog.'],
  ['Category (Level 2)', 'BLANK in this template — Leather has SM (Smooth) and EM (Embossed). Fill in per row OR leave blank to set per receipt.'],
  ['Construction / Backing / Spec Class', 'BLANK — varies per actual roll. Set at receiving time via the actual_* override fields on the receipt line.'],
  ['Pattern', 'BLANK — most Luxurious leather is solid (no pattern).'],
  ['Default UOM', 'meter (changeable per row)'],
  ['Default Currency', 'USD (changeable per row)'],
  ['Default Supplier / Cost / Rack', 'BLANK — fill per origin OR leave blank and set at receipt time'],
  ['Active', 'TRUE — all rows imported as active'],
];
const rulesSheet = XLSX.utils.aoa_to_sheet(rulesAOA);
rulesSheet['!cols'] = [{ wch: 30 }, { wch: 80 }];
XLSX.utils.book_append_sheet(wb, rulesSheet, 'Rules');

// Sheet 4: Instructions
const instrAOA = [
  ['KTC NextTrade Hub — Leather Luxury Catalog Import'],
  [''],
  ['PURPOSE:'],
  ['Bulk-import the full Leather Luxury product catalog into the Product Master.'],
  ['132 products = 11 colors × 12 origin countries, all Family=Leather, Grade=Luxurious.'],
  [''],
  ['PREREQUISITE — RUN THIS SQL FIRST:'],
  ['Run sql/v55-83-a-6-27-37-classification-refresh.sql in Supabase to:'],
  ['  1. Rename family codes from L/T/P/B to LE/TX/PV/BD'],
  ['  2. Add Dark Grey (DG) color'],
  ['  3. Add Origin Country (Level 9) with 12 country codes'],
  ['  4. Add origin_list_id column to inventory_products'],
  [''],
  ['HOW TO IMPORT:'],
  ['  1. Open Inventory → Product Master → Import Products'],
  ['  2. Upload this file'],
  ['  3. Preview screen shows 132 valid rows + 0 errors'],
  ['  4. Click Commit'],
  [''],
  ['BEFORE COMMITTING — REVIEW:'],
  ['  • Quick codes follow the {Family}{Grade}{Color}{Origin} pattern (8 chars total)'],
  ['  • category_code is BLANK — Leather has SM (Smooth) and EM (Embossed).'],
  ['    Fill SM in the column for all rows if you want every product defaulted to Smooth.'],
  ['    Or leave blank and pick per receipt later.'],
  ['  • default_supplier / default_cost are BLANK — fill per origin if you have'],
  ['    consistent supply, or leave blank and override at receipt time.'],
  [''],
  ['AFTER IMPORT:'],
  ['  • Each of the 132 products will have its own row in inventory_products'],
  ['  • You can then start using them in Receive Stock, sales invoices, reports, etc.'],
  ['  • To add more later (e.g. extend to Leather Premium = Grade PR), generate a similar file'],
  [''],
  ['NEXT CATALOGS (after this one):'],
  ['  • Leather Premium (PR) — same colors × same countries = 132 more'],
  ['  • Leather Stock (ST) — economy line'],
  ['  • PVC Pool — separate generator (different fields apply)'],
  ['  • Textile, Boat Decking — each with their own applicable levels'],
];
const instrSheet = XLSX.utils.aoa_to_sheet(instrAOA);
instrSheet['!cols'] = [{ wch: 90 }];
XLSX.utils.book_append_sheet(wb, instrSheet, 'Instructions');

// ─── Write ───────────────────────────────────────────────────────
const stamp = new Date().toISOString().substring(0, 10);
const outPath = '/mnt/user-data/outputs/KTC-Leather-Luxury-Catalog-' + stamp + '.xlsx';
XLSX.writeFile(wb, outPath);
console.log('Wrote: ' + outPath);
const stats = fs.statSync(outPath);
console.log('Size: ' + (stats.size / 1024).toFixed(1) + ' KB');
