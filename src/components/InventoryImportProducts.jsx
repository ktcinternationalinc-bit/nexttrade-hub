'use client';
// v55.83-A.6.27.28 — Inventory Phase 1 Build 3: Import Products
//
// Bulk-import product master entries from an Excel file. Two-step flow:
//   1. Download template → fill offline → upload
//   2. Validate every row → preview screen → user confirms → bulk insert
//
// Permission: super_admin OR "Edit Product List" (same gate as Build 2).
//
// Locked decisions (Max May 18 2026):
//   - Duplicate quick_code: skip the row UNLESS the import row has fields
//     the existing product is missing (then enrich)
//   - Partial failure: stop on first unexpected error, show clear results
//   - Excel template: WITH data validation dropdowns inside cells
//   - Unknown classification codes: reject by default; preview screen
//     lists them with confirmation option ("Did you mean X?")

import { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { supabase, dbInsert, dbUpdate } from '../lib/supabase';

// Map of level number → CODE column header in template
var LEVEL_COL = {
  1: 'family_code',
  2: 'category_code',
  3: 'grade_code',
  4: 'construction_code',
  5: 'backing_code',
  6: 'color_code',
  7: 'pattern_code',
  8: 'spec_class_code',
  9: 'origin_code',
};

// Map of level number → FK column on inventory_products
var LEVEL_FK = {
  1: 'family_list_id',
  2: 'category_list_id',
  3: 'grade_list_id',
  4: 'construction_list_id',
  5: 'backing_list_id',
  6: 'color_list_id',
  7: 'pattern_list_id',
  8: 'spec_class_list_id',
  9: 'origin_list_id',
};

// v55.83-A.6.27.38 — Levels that are REQUIRED on import (must have a code).
// The other levels can be left blank and filled at receipt time.
var REQUIRED_LEVELS = [1, 3, 6, 9];  // Family, Grade, Color, Origin

var TEMPLATE_HEADERS = [
  'name_en',
  'name_ar',
  'quick_code',
  'design_sku',
  'family_code',
  'category_code',
  'grade_code',
  'construction_code',
  'backing_code',
  'color_code',
  'pattern_code',
  'spec_class_code',
  'origin_code',           // v55.83-A.6.27.38 — Level 9 origin country
  'classification_slug',   // optional — generated if absent
  'default_uom',
  'default_thickness_mm',
  'default_width_m',
  'default_gsm',
  'default_density',
  'default_weight_per_roll',
  'default_roll_length_m',
  'default_supplier',
  'default_cost',
  'default_currency',
  'default_rack',
  'notes',
  'featured',              // v55.83-A.6.27.38 — TRUE/FALSE, default FALSE
  'active',                // v55.83-A.6.27.38 — TRUE/FALSE, default TRUE
  'is_family_template',    // v55.83-A.6.27.39 — TRUE for the 27 family templates
  'variant_suffix',        // v55.83-A.6.27.39 — '001'/'002'/... for variants; blank for templates
];

var VALID_UOM = ['kg','meter','yard','roll','piece','liter','sqm'];
var VALID_CURRENCY = ['EGP','USD','EUR'];

function isBlank(v) {
  return v === undefined || v === null || String(v).trim() === '';
}

function asNumber(v) {
  if (isBlank(v)) return null;
  var n = Number(v);
  return isNaN(n) ? 'INVALID' : n;
}

export default function InventoryImportProducts(props) {
  var userProfile = props.userProfile;
  var modulePerms = props.modulePerms || {};
  var isSuperAdmin = props.isSuperAdmin === true;
  var toast = props.toast || { success: function(){}, error: function(){}, warning: function(){}, info: function(){} };

  // Permission gates
  var canImport = isSuperAdmin || modulePerms['Edit Product List'] === true;

  var [lists, setLists] = useState([]);
  var [rules, setRules] = useState([]);
  var [products, setProducts] = useState([]);
  var [loading, setLoading] = useState(true);
  var [parsedRows, setParsedRows] = useState(null);  // {valid:[], errors:[], duplicates:[], unknowns:[]} or null
  var [busy, setBusy] = useState(false);
  var [importResult, setImportResult] = useState(null); // after commit
  var fileInputRef = useRef(null);

  // Load all reference data once
  useEffect(function () {
    if (!canImport) { setLoading(false); return; }
    var cancelled = false;
    async function load() {
      setLoading(true);
      try {
        var [lstRes, ruleRes, prodRes] = await Promise.all([
          supabase.from('inventory_lists').select('*').eq('active', true),
          supabase.from('inventory_list_rules').select('*'),
          supabase.from('inventory_products').select('*'),
        ]);
        if (cancelled) return;
        setLists(lstRes.data || []);
        setRules(ruleRes.data || []);
        setProducts(prodRes.data || []);
      } catch (e) {
        console.error('[inv-import] load failed:', e);
        toast.error('Failed to load reference data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return function () { cancelled = true; };
  }, [canImport]);

  // ── Lookup helpers ────────────────────────────────────────────────
  function findListByLevelAndCode(level, code) {
    if (isBlank(code)) return null;
    var u = String(code).trim().toUpperCase();
    return lists.find(function (l) { return l.level === level && l.code === u; }) || null;
  }

  function findProductByQuickCode(code, variantSuffix) {
    // v55.83-A.6.27.39 — Match by composite (quick_code, variant_suffix).
    // Two products can share the same quick_code if they have different suffixes.
    // v55.83-A.6.27.72 HOTFIX 9 — now includes INACTIVE products too (so reactivating
    // a deactivated quick_code is detected and reported clearly, not silently re-inserted).
    if (isBlank(code)) return null;
    var k = String(code).trim().toLowerCase();
    var v = String(variantSuffix || '').trim();
    return products.find(function (p) {
      var pv = String(p.variant_suffix || '').trim();
      return (p.quick_code || '').toLowerCase() === k && pv === v;
    }) || null;
  }

  // v55.83-A.6.27.72 HOTFIX 9 — Comprehensive duplicate-detection helpers.
  // Mirrors the HOTFIX 7 single-product flow: detect collisions on name_en, name_ar,
  // classification_slug (in addition to quick_code) — both within the imported file
  // AND against the existing products table. Always name the conflicting product.
  function findProductByNameEn(name) {
    if (isBlank(name)) return null;
    var k = String(name).trim().toLowerCase();
    return products.find(function (p) {
      return (p.name_en || '').trim().toLowerCase() === k;
    }) || null;
  }
  function findProductByNameAr(name) {
    if (isBlank(name)) return null;
    var k = String(name).trim().toLowerCase();
    return products.find(function (p) {
      return (p.name_ar || '').trim().toLowerCase() === k;
    }) || null;
  }
  function findProductBySlug(slug) {
    if (isBlank(slug)) return null;
    return products.find(function (p) { return p.classification_slug === slug; }) || null;
  }
  function describeConflict(p) {
    var lbl = (p.name_en || p.name_ar || '(unnamed)') + (p.name_ar && p.name_en !== p.name_ar ? ' / ' + p.name_ar : '');
    var code = p.quick_code ? p.quick_code : '(no quick code)';
    var status = p.active ? 'ACTIVE' : 'INACTIVE';
    return '"' + lbl + '" — Quick Code: ' + code + ' — Status: ' + status + ' — ID: ' + p.id;
  }

  function familyValidForChild(childOpt, familyOpt) {
    // For levels with parent rules pointing to Family, child must be valid under chosen Family.
    if (!childOpt || !familyOpt) return false;
    var childRules = rules.filter(function (r) { return r.child_list_id === childOpt.id; });
    if (childRules.length === 0) return true; // universal
    return childRules.some(function (r) { return r.parent_list_id === familyOpt.id; });
  }

  // ── Template generation with data-validation dropdowns ────────────
  function downloadTemplate() {
    if (!lists.length) { toast.error('Reference data still loading'); return; }
    var wb = XLSX.utils.book_new();

    // Sheet 1: Products (empty rows ready to fill)
    var prodSheet = XLSX.utils.aoa_to_sheet([
      TEMPLATE_HEADERS,
      // v55.83-A.6.27.38 — Example row showing the 9-level + featured/active format
      // Required: name_en, name_ar, family_code, grade_code, color_code, origin_code
      // Optional: everything else (operator fills at receipt time)
      ['Leather Luxurious Smooth Black US', 'جلد فاخر ناعم أسود', 'LLBKUS', '', 'L', 'SM', 'LX', 'RG', 'CT', 'BK', 'NA', 'NA', 'US', 'L-SM-LX-RG-CT-BK-NA-NA-US', 'meter', '', '', '', '', '', '', 'ABC Suppliers', '4.50', 'USD', 'A-12', 'Example row — delete before importing', 'FALSE', 'TRUE'],
    ]);

    // v55.83-A.6.27.55 — pre-fill the classification_slug column (column N) with
    // =TEXTJOIN("-",TRUE,E#:M#) for the next 200 blank rows. This auto-builds
    // the slug from the 9 code columns (E=family, F=category, G=grade,
    // H=construction, I=backing, J=color, K=pattern, L=spec_class, M=origin)
    // so the user only has to fill the dropdown columns and the slug appears
    // automatically. Skips empty rows (TEXTJOIN with delimiter="-" and
    // ignore_empty=TRUE returns "" when every input is blank).
    //
    // Per Max May 22 2026 — bonus from the deferred Excel-template cascading
    // request. Auto-formula only; cascading dropdowns still flat per .56 plan.
    var slugColIndex = TEMPLATE_HEADERS.indexOf('classification_slug');  // 13 (column N)
    if (slugColIndex >= 0) {
      var slugColLetter = XLSX.utils.encode_col(slugColIndex);  // 'N'
      for (var rowNum = 3; rowNum <= 202; rowNum++) {           // rows 3..202 (200 blanks below example row at 2)
        var cellAddr = slugColLetter + rowNum;
        prodSheet[cellAddr] = {
          t: 's',                                                  // string type (formula result)
          f: 'TEXTJOIN("-",TRUE,E' + rowNum + ':M' + rowNum + ')', // the formula itself
          v: '',                                                   // initial value before Excel evaluates
        };
      }
      // Extend the sheet range to include row 202 so Excel renders the formulas
      var ref = prodSheet['!ref'];
      var range = XLSX.utils.decode_range(ref || 'A1');
      if (range.e.r < 201) { range.e.r = 201; prodSheet['!ref'] = XLSX.utils.encode_range(range); }
    }

    // Apply column widths
    prodSheet['!cols'] = TEMPLATE_HEADERS.map(function (h) {
      if (h.indexOf('name_') === 0) return { wch: 40 };
      if (h === 'notes') return { wch: 40 };
      if (h.indexOf('code') >= 0) return { wch: 8 };
      return { wch: 14 };
    });

    // Add data validation for code columns + UOM + currency
    // Excel data validation requires SheetJS Pro for full support; we
    // approximate by adding a !dataValidations property (read by some
    // tools) and rely on the Codes Reference sheet for users to copy from.
    var validations = [];
    function rangeForCol(colIndex) {
      var colLetter = XLSX.utils.encode_col(colIndex);
      return colLetter + '2:' + colLetter + '5000';
    }
    function codesForLevel(level) {
      return lists.filter(function (l) { return l.level === level && l.active; }).map(function (l) { return l.code; });
    }
    [
      { col: TEMPLATE_HEADERS.indexOf('family_code'),       opts: codesForLevel(1) },
      { col: TEMPLATE_HEADERS.indexOf('category_code'),      opts: codesForLevel(2) },
      { col: TEMPLATE_HEADERS.indexOf('grade_code'),         opts: codesForLevel(3) },
      { col: TEMPLATE_HEADERS.indexOf('construction_code'),  opts: codesForLevel(4) },
      { col: TEMPLATE_HEADERS.indexOf('backing_code'),       opts: codesForLevel(5) },
      { col: TEMPLATE_HEADERS.indexOf('color_code'),         opts: codesForLevel(6) },
      { col: TEMPLATE_HEADERS.indexOf('pattern_code'),       opts: codesForLevel(7) },
      { col: TEMPLATE_HEADERS.indexOf('spec_class_code'),    opts: codesForLevel(8) },
      { col: TEMPLATE_HEADERS.indexOf('default_uom'),        opts: VALID_UOM },
      { col: TEMPLATE_HEADERS.indexOf('default_currency'),   opts: VALID_CURRENCY },
    ].forEach(function (v) {
      validations.push({
        sqref: rangeForCol(v.col),
        type: 'list',
        formula1: '"' + v.opts.join(',') + '"',
        allowBlank: true,
        showDropDown: false,
      });
    });
    prodSheet['!dataValidations'] = validations;

    XLSX.utils.book_append_sheet(wb, prodSheet, 'Products');

    // Sheet 2: Codes Reference (all codes by level)
    var codesAOA = [['Level', 'Code', 'English Label', 'Arabic Label']];
    [1, 2, 3, 4, 5, 6, 7, 8].forEach(function (lvl) {
      var levelName = ['', 'Product Family', 'Category', 'Grade', 'Construction', 'Backing', 'Color', 'Pattern', 'Spec Class'][lvl];
      var levelOpts = lists.filter(function (l) { return l.level === lvl && l.active; })
        .sort(function (a, b) { return (a.display_order || 0) - (b.display_order || 0); });
      levelOpts.forEach(function (o) {
        codesAOA.push(['L' + lvl + ' ' + levelName, o.code, o.label_en, o.label_ar]);
      });
      codesAOA.push(['', '', '', '']); // blank row between levels
    });
    var codesSheet = XLSX.utils.aoa_to_sheet(codesAOA);
    codesSheet['!cols'] = [{ wch: 24 }, { wch: 8 }, { wch: 30 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, codesSheet, 'Codes Reference');

    // Sheet 3: Rules Reference (which codes are restricted to which Families)
    var rulesAOA = [['Code', 'Level', 'Label', 'Valid Under Families (codes)']];
    lists.forEach(function (l) {
      var optRules = rules.filter(function (r) { return r.child_list_id === l.id; });
      if (optRules.length === 0) return; // universal — skip
      var parentCodes = optRules.map(function (r) {
        var p = lists.find(function (x) { return x.id === r.parent_list_id; });
        return p ? p.code : '?';
      }).sort().join(', ');
      rulesAOA.push([l.code, 'L' + l.level, l.label_en, parentCodes]);
    });
    if (rulesAOA.length === 1) rulesAOA.push(['', '', '', '(no rules defined — all codes are universal)']);
    var rulesSheet = XLSX.utils.aoa_to_sheet(rulesAOA);
    rulesSheet['!cols'] = [{ wch: 8 }, { wch: 6 }, { wch: 30 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, rulesSheet, 'Rules Reference');

    // Sheet 4: Instructions
    var instrAOA = [
      ['KTC NextTrade Hub — Product List Import Template'],
      [''],
      ['HOW TO USE:'],
      ['1. Fill in the "Products" sheet — one row per product.'],
      ['2. All 8 classification code columns are REQUIRED (family_code through spec_class_code).'],
      ['3. name_en, name_ar: AUTO-BUILT from your level selections if left blank — recipe per Family:'],
      ['     • Textile (TEX*) → Category + Grade + Color + Backing'],
      ['     • Leather (LEA*) → Family + Grade + Color + Backing'],
      ['     • PVC (PVC*)    → Family + Grade + Color + Pattern + SpecClass'],
      ['     • Other         → Family + Grade + Color + Backing (default)'],
      ['     Type your own names to override the auto-build. quick_code, design_sku optional.'],
      ['4. Default tech specs (UOM, thickness, width, GSM, etc.) are all optional.'],
      ['5. Default operational fields (supplier, cost, currency, rack) all optional.'],
      ['6. Delete the example row before uploading.'],
      ['7. Save as .xlsx and upload via the Import Products screen.'],
      [''],
      ['CLASSIFICATION CODES:'],
      ['- See "Codes Reference" sheet for all valid codes per level.'],
      ['- See "Rules Reference" sheet for which codes are restricted to which Families.'],
      ['- Codes must be UPPERCASE alphanumeric (A-Z, 0-9), 1-4 characters.'],
      [''],
      ['VALIDATION:'],
      ['- Every row is validated before commit. Errors stop the import for that row.'],
      ['- Unknown codes will be flagged on the preview — you can re-confirm or fix.'],
      ['- Quick codes must be unique across active products.'],
      ['- If a quick code matches an existing product, the import row will be SKIPPED.'],
      ['  Exception: if the import row has fields the existing product is missing, those fields'],
      ['  will ENRICH the existing product (never overwriting existing values).'],
      [''],
      ['UOM values: ' + VALID_UOM.join(', ')],
      ['Currency values: ' + VALID_CURRENCY.join(', ')],
    ];
    var instrSheet = XLSX.utils.aoa_to_sheet(instrAOA);
    instrSheet['!cols'] = [{ wch: 90 }];
    XLSX.utils.book_append_sheet(wb, instrSheet, 'Instructions');

    // Write + download
    var stamp = new Date().toISOString().substring(0, 10);
    XLSX.writeFile(wb, 'KTC-Product-Master-Import-Template-' + stamp + '.xlsx');
    toast.success('Template downloaded. Fill it out offline and upload here.');
  }

  // ── Upload handler ────────────────────────────────────────────────
  async function handleFileUpload(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    setImportResult(null);
    setParsedRows(null);
    setBusy(true);
    try {
      var data = await file.arrayBuffer();
      var wb = XLSX.read(data);
      var sheetName = 'Products';
      if (!wb.SheetNames.includes(sheetName)) {
        // fall back to first sheet if Products not found
        sheetName = wb.SheetNames[0];
      }
      var sheet = wb.Sheets[sheetName];
      var rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      if (!rows.length) {
        toast.error('No rows found in the Products sheet');
        setBusy(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      var result = validateRows(rows);
      setParsedRows(result);
      toast.info('Parsed ' + rows.length + ' row(s). Review preview below.');
    } catch (err) {
      console.error('[inv-import] parse failed:', err);
      toast.error('Could not parse file: ' + ((err && err.message) || String(err)));
      alert('Could not parse the file. Make sure it\'s a valid .xlsx (or .xls) file with a "Products" sheet.\n\nError: ' + ((err && err.message) || String(err)));
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  // ── Validation ────────────────────────────────────────────────────
  function validateRows(rows) {
    var valid = [];      // rows ready to insert as new products
    var enrich = [];     // rows that will enrich existing products
    var skipped = [];    // rows skipped because nothing new vs existing
    var errors = [];     // rows with validation errors
    // v55.83-A.6.27.72 HOTFIX 9 — Track all 4 dup types within-file.
    // Mirrors HOTFIX 7 single-product flow: detect collisions on quick_code+suffix,
    // classification_slug, name_en, name_ar so duplicates inside one file are caught
    // before any DB call (and named clearly so the user can fix the right row).
    var seenDesignSkus = {};   // Design SKU must be unique (Max Jun 1 2026)
    var seenQuickCodes = {};   // key: quick_code|variant_suffix → first rowNum seen
    var seenSlugs = {};        // key: slug → first rowNum seen
    var seenNameEn = {};       // key: name_en lowercased → first rowNum seen
    var seenNameAr = {};       // key: name_ar lowercased → first rowNum seen

    rows.forEach(function (raw, idx) {
      var rowNum = idx + 2; // +2 because header is row 1 and arrays are 0-indexed
      var errs = [];

      var nameEn = String(raw.name_en || '').trim();
      var nameAr = String(raw.name_ar || '').trim();
      var quickCode = String(raw.quick_code || '').trim();
      var designSku = String(raw.design_sku || '').trim();

      // v55.83-A.6.27.72 HOTFIX 12 — Auto-build name_en/name_ar from level selections
      // if the row leaves them blank. Mirrors the single-product Add form's recipe:
      //   TEX  → Category Grade Color Backing
      //   LEA  → Family Grade Color Backing
      //   PVC  → Family Grade Color Pattern SpecClass
      //   default → Family Grade Color Backing
      // Names are auto-filled BEFORE the empty-name check below so consistent naming
      // doesn't require the user to type every name manually.
      // (Resolution of levels happens just below; we'll re-fill nameEn/Ar after we
      // have resolvedLevels populated.)

      // v55.83-A.6.27.72 HOTFIX 12 — Defer empty-name check until AFTER level resolution
      // so we can auto-fill from levels. (Original blocking errs moved to after the
      // level-resolution block below.)

      // Resolve all 9 classification codes
      // v55.83-A.6.27.38 — Only Levels 1/3/6/9 (Family/Grade/Color/Origin) are REQUIRED.
      // The other 5 levels are optional placeholders — operator fills them at receipt time.
      var resolvedLevels = {};
      var unknownCodes = [];
      [1, 2, 3, 4, 5, 6, 7, 8, 9].forEach(function (lvl) {
        var col = LEVEL_COL[lvl];
        var rawCode = String(raw[col] || '').trim();
        var isRequired = REQUIRED_LEVELS.indexOf(lvl) >= 0;
        if (!rawCode) {
          if (isRequired) {
            errs.push('L' + lvl + ' (' + col + ') is required');
          }
          return;
        }
        var opt = findListByLevelAndCode(lvl, rawCode);
        if (!opt) {
          unknownCodes.push({ level: lvl, code: rawCode.toUpperCase(), col: col });
          errs.push('L' + lvl + ' code "' + rawCode + '" not found in Master Lists');
          return;
        }
        resolvedLevels[lvl] = opt;
      });

      // Cascade rule check — every non-Level-1 option must be valid under chosen Family
      // v55.83-A.6.27.38 — extended to Level 9
      if (resolvedLevels[1]) {
        [2, 3, 4, 5, 6, 7, 8, 9].forEach(function (lvl) {
          var opt = resolvedLevels[lvl];
          if (opt && !familyValidForChild(opt, resolvedLevels[1])) {
            errs.push('L' + lvl + ' "' + opt.code + '" is not valid under Family "' + resolvedLevels[1].code + '"');
          }
        });
      }

      // v55.83-A.6.27.72 HOTFIX 12 — Auto-fill name_en / name_ar from resolved levels
      // when the user left them blank in the import file. Uses the same family-specific
      // recipes as the manual Add Product form so naming is consistent end-to-end.
      // Only fills when blank — if user typed something, we respect it.
      if ((!nameEn || !nameAr) && resolvedLevels[1]) {
        var familyCode = String(resolvedLevels[1].code || '').toUpperCase().trim();
        // Recipes match the single-product form (NAMING_RECIPES in InventoryProductMaster.jsx)
        var IMPORT_RECIPES = {
          // v55.83-A (Jun 1 2026) — real family codes L/T/P/B. Match ProductMaster.
          'L':       [1, 2, 3, 4, 5, 6],   // Leather: Family Category Grade Construction Backing Color
          'T':       [1, 2, 3, 4, 5, 6],   // Textile: same 6-field order
          'P':       [1, 2, 3, 4, 6, 5, 7, 8], // PVC: Family Category Grade Construction Color Backing Pattern Spec
          'B':       [1, 2, 3, 4, 6, 5, 7, 8], // Boat Decking: same 8-field order
          'TEX':     [1, 2, 3, 4, 5, 6],
          'TEXTILE': [1, 2, 3, 4, 5, 6],
          'LEA':     [1, 2, 3, 4, 5, 6],
          'LEATHER': [1, 2, 3, 4, 5, 6],
          'PVC':     [1, 2, 3, 4, 6, 5, 7, 8],
          'PVCPOOL': [1, 2, 3, 4, 6, 5, 7, 8],
          'PVCBD':   [1, 2, 3, 4, 6, 5, 7, 8],
        };
        var recipe = IMPORT_RECIPES[familyCode];
        if (!recipe) {
          var prefixKey = Object.keys(IMPORT_RECIPES).find(function (k) { return familyCode.indexOf(k) === 0; });
          if (prefixKey) recipe = IMPORT_RECIPES[prefixKey];
        }
        if (!recipe) recipe = [1, 3, 6, 5]; // default
        var enParts = [];
        var arParts = [];
        recipe.forEach(function (lvl) {
          var lvlOpt = resolvedLevels[lvl];
          if (!lvlOpt) return;
          if (lvlOpt.label_en) enParts.push(String(lvlOpt.label_en).trim());
          if (lvlOpt.label_ar) arParts.push(String(lvlOpt.label_ar).trim());
        });
        if (!nameEn && enParts.length > 0) nameEn = enParts.join(' ');
        if (!nameAr && arParts.length > 0) nameAr = arParts.join(' ');
      }

      // NOW check empty names (after auto-fill attempt)
      if (!nameEn) errs.push('name_en is required (auto-fill failed — Family + recipe levels need to be filled in)');
      if (!nameAr) errs.push('name_ar is required (auto-fill failed — Family + recipe levels need to be filled in)');

      // UOM / currency / numbers
      var uom = String(raw.default_uom || '').trim().toLowerCase();
      if (!uom) errs.push('default_uom is required (one of: ' + VALID_UOM.join(', ') + ')');
      else if (VALID_UOM.indexOf(uom) < 0) errs.push('default_uom must be one of: ' + VALID_UOM.join(', '));
      var currency = String(raw.default_currency || '').trim().toUpperCase();
      if (currency && VALID_CURRENCY.indexOf(currency) < 0) errs.push('default_currency must be one of: ' + VALID_CURRENCY.join(', '));

      ['default_thickness_mm','default_width_m','default_gsm','default_density','default_weight_per_roll','default_roll_length_m','default_cost'].forEach(function (k) {
        var n = asNumber(raw[k]);
        if (n === 'INVALID') errs.push(k + ' must be a number (got "' + raw[k] + '")');
      });

      // Quick code uniqueness within file
      // v55.83-A.6.27.39 — Allow duplicate quick_codes when variant_suffix differs
      // (variants share their template's quick_code but have unique suffixes).
      // Composite key = quick_code + '-' + (variant_suffix || '')
      if (quickCode) {
        var variantSfx = String(raw.variant_suffix || '').trim();
        var qk = quickCode.toLowerCase() + '|' + variantSfx;
        if (seenQuickCodes[qk]) {
          errs.push('DUPLICATE within file — quick_code "' + quickCode + '"' +
            (variantSfx ? ' with variant_suffix "' + variantSfx + '"' : '') +
            ' already appears on row ' + seenQuickCodes[qk] + '. No duplicates allowed.');
        } else {
          seenQuickCodes[qk] = rowNum;
        }
      }

      // v55.83-A (Max Jun 1 2026) — DESIGN SKU must be UNIQUE (quick_code may repeat).
      if (designSku) {
        var dk = designSku.toLowerCase();
        if (seenDesignSkus[dk]) {
          errs.push('DUPLICATE within file — Design Code "' + designSku + '" already appears on row ' + seenDesignSkus[dk] + '. Design Codes must be unique.');
        } else {
          seenDesignSkus[dk] = rowNum;
        }
      }

      // v55.83-A.6.27.72 HOTFIX 9 — within-file duplicate checks for name_en, name_ar, slug.
      if (nameEn) {
        var enKey = nameEn.toLowerCase();
        if (seenNameEn[enKey]) {
          errs.push('DUPLICATE within file — English name "' + nameEn + '" already appears on row ' + seenNameEn[enKey] + '. No duplicates allowed.');
        } else {
          seenNameEn[enKey] = rowNum;
        }
      }
      if (nameAr) {
        var arKey = nameAr.toLowerCase();
        if (seenNameAr[arKey]) {
          errs.push('DUPLICATE within file — Arabic name "' + nameAr + '" already appears on row ' + seenNameAr[arKey] + '. No duplicates allowed.');
        } else {
          seenNameAr[arKey] = rowNum;
        }
      }
      // Slug check happens after slug is built (below, after the cascade check passes).

      if (errs.length) {
        errors.push({ rowNum: rowNum, raw: raw, errors: errs, unknownCodes: unknownCodes });
        return;
      }

      // Build the canonical payload
      // v55.83-A.6.27.38 — Levels 2/4/5/7/8 are optional → use null when not provided.
      // classification_slug uses dashes (matches the slug rebuild SQL).
      // Includes origin_list_id (Level 9) + featured boolean.
      var slug = [1,2,3,4,5,6,7,8,9].map(function (l) {
        return resolvedLevels[l] ? resolvedLevels[l].code : '';
      }).join('-');
      var featuredRaw = String(raw.featured || '').trim().toUpperCase();
      var activeRaw = String(raw.active || '').trim().toUpperCase();
      var payload = {
        name_en: nameEn,
        name_ar: nameAr,
        quick_code: quickCode || null,
        design_sku: designSku || null,
        family_list_id:        resolvedLevels[1] ? resolvedLevels[1].id : null,
        category_list_id:      resolvedLevels[2] ? resolvedLevels[2].id : null,
        grade_list_id:         resolvedLevels[3] ? resolvedLevels[3].id : null,
        construction_list_id:  resolvedLevels[4] ? resolvedLevels[4].id : null,
        backing_list_id:       resolvedLevels[5] ? resolvedLevels[5].id : null,
        color_list_id:         resolvedLevels[6] ? resolvedLevels[6].id : null,
        pattern_list_id:       resolvedLevels[7] ? resolvedLevels[7].id : null,
        spec_class_list_id:    resolvedLevels[8] ? resolvedLevels[8].id : null,
        origin_list_id:        resolvedLevels[9] ? resolvedLevels[9].id : null,
        classification_slug: slug,
        default_uom: uom || null,
        default_thickness_mm: asNumber(raw.default_thickness_mm) === 'INVALID' ? null : asNumber(raw.default_thickness_mm),
        default_width_m: asNumber(raw.default_width_m) === 'INVALID' ? null : asNumber(raw.default_width_m),
        default_gsm: asNumber(raw.default_gsm) === 'INVALID' ? null : asNumber(raw.default_gsm),
        default_density: asNumber(raw.default_density) === 'INVALID' ? null : asNumber(raw.default_density),
        default_weight_per_roll: asNumber(raw.default_weight_per_roll) === 'INVALID' ? null : asNumber(raw.default_weight_per_roll),
        default_roll_length_m: asNumber(raw.default_roll_length_m) === 'INVALID' ? null : asNumber(raw.default_roll_length_m),
        default_supplier: String(raw.default_supplier || '').trim() || null,
        default_cost: asNumber(raw.default_cost) === 'INVALID' ? null : asNumber(raw.default_cost),
        default_currency: currency || null,
        default_rack: String(raw.default_rack || '').trim() || null,
        notes: String(raw.notes || '').trim() || null,
        featured: featuredRaw === 'TRUE' || featuredRaw === '1' || featuredRaw === 'YES',
        active: activeRaw === '' ? true : (activeRaw === 'TRUE' || activeRaw === '1' || activeRaw === 'YES'),
        // v55.83-A.6.27.39 — family template + variant suffix support
        is_family_template: String(raw.is_family_template || '').trim().toUpperCase() === 'TRUE',
        variant_suffix: String(raw.variant_suffix || '').trim() || null,
      };

      // Duplicate against DB (v55.83-A.6.27.39: composite key with variant_suffix)
      // v55.83-A.6.27.72 HOTFIX 9 — also check classification_slug + name_en + name_ar
      // against the DB. Each conflict is NAMED so the user can see exactly which product
      // their import row would collide with. No duplicates allowed (mirrors single-product
      // HOTFIX 7 from the same release).

      // Within-file slug check (slug is built above this section)
      if (slug) {
        if (seenSlugs[slug]) {
          errors.push({ rowNum: rowNum, raw: raw, errors: ['DUPLICATE within file — classification slug "' + slug + '" already appears on row ' + seenSlugs[slug] + '. Same exact Family/Category/Grade/etc. combination. No duplicates allowed.'], unknownCodes: unknownCodes });
          return;
        } else {
          seenSlugs[slug] = rowNum;
        }
      }

      // DB classification_slug conflict
      var dupSlug = findProductBySlug(slug);
      if (dupSlug) {
        errors.push({ rowNum: rowNum, raw: raw, errors: ['DUPLICATE in database — classification slug "' + slug + '" already used by ' + describeConflict(dupSlug) + '. No duplicates allowed. Change at least one level code, or edit the existing product.'], unknownCodes: unknownCodes });
        return;
      }

      // DB name_en conflict
      var dupEn = findProductByNameEn(nameEn);
      if (dupEn) {
        errors.push({ rowNum: rowNum, raw: raw, errors: ['DUPLICATE in database — English name "' + nameEn + '" already used by ' + describeConflict(dupEn) + '. No duplicates allowed. Adjust the name slightly, or edit the existing product.'], unknownCodes: unknownCodes });
        return;
      }

      // DB name_ar conflict
      var dupAr = findProductByNameAr(nameAr);
      if (dupAr) {
        errors.push({ rowNum: rowNum, raw: raw, errors: ['DUPLICATE in database — Arabic name "' + nameAr + '" already used by ' + describeConflict(dupAr) + '. No duplicates allowed. Adjust the name slightly, or edit the existing product.'], unknownCodes: unknownCodes });
        return;
      }

      // DB quick_code conflict (existing enrich/skip logic — kept since enrichment is a
      // useful import feature that fills in missing fields without overwriting).
      if (quickCode) {
        var existing = findProductByQuickCode(quickCode, payload.variant_suffix);
        if (existing) {
          // Decide: skip or enrich?
          // Enrich = the import row has values for fields where the existing product is null/empty.
          // We never overwrite existing non-null values.
          var enrichPatch = {};
          var enrichedFields = [];
          Object.keys(payload).forEach(function (k) {
            // skip identity fields — we never change quick_code, names, slugs on enrich
            if (['quick_code','name_en','name_ar','classification_slug',
                 'family_list_id','category_list_id','grade_list_id','construction_list_id',
                 'backing_list_id','color_list_id','pattern_list_id','spec_class_list_id'].indexOf(k) >= 0) return;
            var existingVal = existing[k];
            var newVal = payload[k];
            // Only fill if existing is blank/null AND new has value
            if ((existingVal === null || existingVal === undefined || existingVal === '') && newVal !== null && newVal !== '') {
              enrichPatch[k] = newVal;
              enrichedFields.push(k);
            }
          });
          if (enrichedFields.length > 0) {
            enrich.push({ rowNum: rowNum, raw: raw, existing: existing, patch: enrichPatch, enrichedFields: enrichedFields, conflictDesc: describeConflict(existing) });
          } else {
            skipped.push({ rowNum: rowNum, raw: raw, existing: existing, reason: 'Already exists: ' + describeConflict(existing) + ' — no new info to enrich' });
          }
          return;
        }
      }

      valid.push({ rowNum: rowNum, raw: raw, payload: payload, slug: slug });
    });

    return { valid: valid, enrich: enrich, skipped: skipped, errors: errors };
  }

  // ── Commit import ─────────────────────────────────────────────────
  async function commitImport() {
    if (!parsedRows) return;
    setBusy(true);
    var inserted = 0;
    var enriched = 0;
    var failed = 0;
    var failedRows = [];
    try {
      // Insert new products
      for (var i = 0; i < parsedRows.valid.length; i++) {
        var row = parsedRows.valid[i];
        try {
          // v55.83-A.6.27.38 — preserve payload.active (already TRUE by default)
          // instead of hardcoding, so an explicit FALSE in the import is respected.
          var rowPayload = Object.assign({}, row.payload, {
            created_by: userProfile && userProfile.id,
            updated_by: userProfile && userProfile.id,
          });
          await dbInsert('inventory_products', rowPayload, userProfile && userProfile.id);
          inserted++;
        } catch (err) {
          failed++;
          failedRows.push({ rowNum: row.rowNum, error: (err && err.message) || String(err) });
          // Stop on first unexpected error per Max's call
          break;
        }
      }
      // Enrich existing products
      if (failed === 0) {
        for (var j = 0; j < parsedRows.enrich.length; j++) {
          var e = parsedRows.enrich[j];
          try {
            await dbUpdate('inventory_products', e.existing.id,
              Object.assign({}, e.patch, { updated_by: userProfile && userProfile.id }),
              userProfile && userProfile.id);
            enriched++;
          } catch (err) {
            failed++;
            failedRows.push({ rowNum: e.rowNum, error: (err && err.message) || String(err) });
            break;
          }
        }
      }
      setImportResult({ inserted: inserted, enriched: enriched, skipped: parsedRows.skipped.length, errors: parsedRows.errors.length, failed: failed, failedRows: failedRows });
      if (failed === 0) {
        toast.success('Import complete: ' + inserted + ' new products, ' + enriched + ' enriched.');
        setParsedRows(null);
      } else {
        toast.error('Import stopped after ' + failed + ' DB error(s). See preview for details.');
      }
      // Reload products so subsequent imports see fresh state
      try {
        var prodRes = await supabase.from('inventory_products').select('*');
        setProducts(prodRes.data || []);
      } catch (_) {}
    } catch (err) {
      console.error('[inv-import] commit catastrophic error:', err);
      toast.error('Import aborted: ' + ((err && err.message) || String(err)));
    } finally {
      setBusy(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────
  if (!canImport) {
    return (
      <div style={{ padding: 24 }}>
        <div className="bg-amber-50 border-2 border-amber-300 rounded-lg p-4">
          <div className="text-base font-extrabold text-amber-900">🔒 Access restricted</div>
          <div className="text-sm text-amber-800 mt-1 font-medium">
            Importing products requires the "Edit Product List" permission. Ask Max to grant it from Settings → Roles &amp; Permissions.
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div style={{ padding: 24 }} className="text-slate-600 font-medium">Loading reference data...</div>;
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200" style={{ padding: 20 }}>
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 24 }}>📥</span>
          <h2 className="text-xl font-extrabold text-slate-900">Import Products</h2>
        </div>
        <div className="text-sm text-slate-700 font-medium mt-1">
          Bulk-import product master entries from an Excel file. Download the template, fill it offline, upload back.
        </div>
        <div className="text-sm text-slate-700 font-medium" style={{ direction: 'rtl' }}>
          استيراد منتجات الكتالوج بالجملة من ملف Excel. حمّل القالب، املأه، ثم ارفعه مرة أخرى.
        </div>
      </div>

      {/* Step 1: download template */}
      <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 mb-4">
        <div className="text-[11px] font-extrabold text-slate-700 tracking-wider mb-2">STEP 1 — DOWNLOAD TEMPLATE</div>
        <div className="text-sm text-slate-700 mb-3">
          The template includes your current classification codes as dropdown options, plus a Codes Reference sheet and Rules Reference sheet.
        </div>
        <button
          onClick={downloadTemplate}
          disabled={busy}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-extrabold rounded-lg shadow"
        >
          📥 Download Import Template (.xlsx)
        </button>
      </div>

      {/* Step 2: upload */}
      <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 mb-4">
        <div className="text-[11px] font-extrabold text-slate-700 tracking-wider mb-2">STEP 2 — UPLOAD FILLED TEMPLATE</div>
        <div className="text-sm text-slate-700 mb-3">
          We'll validate every row against your Master Lists and show a preview before anything is saved.
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={handleFileUpload}
          disabled={busy}
          className="text-sm"
        />
      </div>

      {/* Preview */}
      {parsedRows && (
        <div className="bg-white rounded-xl border-2 border-indigo-300 p-4 mb-4">
          <div className="text-base font-extrabold text-indigo-900 mb-3">📋 IMPORT PREVIEW</div>

          {/* Summary stats */}
          <div className="grid grid-cols-4 gap-2 mb-4">
            <div className="bg-emerald-50 border border-emerald-300 rounded-lg p-3">
              <div className="text-[10px] font-extrabold text-emerald-700 tracking-wider">NEW PRODUCTS</div>
              <div className="text-2xl font-extrabold text-emerald-900">{parsedRows.valid.length}</div>
            </div>
            <div className="bg-blue-50 border border-blue-300 rounded-lg p-3">
              <div className="text-[10px] font-extrabold text-blue-700 tracking-wider">WILL ENRICH</div>
              <div className="text-2xl font-extrabold text-blue-900">{parsedRows.enrich.length}</div>
            </div>
            <div className="bg-slate-100 border border-slate-300 rounded-lg p-3">
              <div className="text-[10px] font-extrabold text-slate-700 tracking-wider">SKIPPED</div>
              <div className="text-2xl font-extrabold text-slate-900">{parsedRows.skipped.length}</div>
            </div>
            <div className="bg-red-50 border border-red-300 rounded-lg p-3">
              <div className="text-[10px] font-extrabold text-red-700 tracking-wider">ERRORS</div>
              <div className="text-2xl font-extrabold text-red-900">{parsedRows.errors.length}</div>
            </div>
          </div>

          {/* Errors */}
          {parsedRows.errors.length > 0 && (
            <div className="bg-red-50 border-2 border-red-300 rounded-lg p-3 mb-3">
              <div className="text-sm font-extrabold text-red-900 mb-2">❌ Errors ({parsedRows.errors.length}) — these rows will NOT be imported. Fix the file and re-upload.</div>
              <div className="space-y-1 max-h-64 overflow-auto">
                {parsedRows.errors.slice(0, 30).map(function (e, i) {
                  return (
                    <div key={i} className="text-xs text-red-900 font-mono bg-white rounded p-2 border border-red-200">
                      <span className="font-bold">Row {e.rowNum}</span> ({e.raw.name_en || '(no name)'}): {e.errors.join(' · ')}
                    </div>
                  );
                })}
                {parsedRows.errors.length > 30 && <div className="text-xs italic">... and {parsedRows.errors.length - 30} more errors</div>}
              </div>
            </div>
          )}

          {/* New products preview */}
          {parsedRows.valid.length > 0 && (
            <details className="bg-emerald-50 border border-emerald-300 rounded-lg p-3 mb-3" open>
              <summary className="text-sm font-extrabold text-emerald-900 cursor-pointer">✓ New products ({parsedRows.valid.length})</summary>
              <div className="mt-2 space-y-1 max-h-64 overflow-auto">
                {parsedRows.valid.slice(0, 30).map(function (v, i) {
                  return (
                    <div key={i} className="text-xs bg-white rounded p-2 border border-emerald-200">
                      <span className="font-bold">Row {v.rowNum}:</span>{' '}
                      <span className="font-mono">{v.payload.quick_code || '—'}</span>{' · '}
                      {v.payload.name_en}{' / '}
                      <span style={{ direction: 'rtl' }}>{v.payload.name_ar}</span>{' · '}
                      <span className="font-mono text-slate-600">{v.slug}</span>
                    </div>
                  );
                })}
                {parsedRows.valid.length > 30 && <div className="text-xs italic">... and {parsedRows.valid.length - 30} more</div>}
              </div>
            </details>
          )}

          {/* Enrichments */}
          {parsedRows.enrich.length > 0 && (
            <details className="bg-blue-50 border border-blue-300 rounded-lg p-3 mb-3">
              <summary className="text-sm font-extrabold text-blue-900 cursor-pointer">↑ Enrichments ({parsedRows.enrich.length}) — existing products that will be updated with new info only (never overwriting existing values)</summary>
              <div className="mt-2 space-y-1 max-h-64 overflow-auto">
                {parsedRows.enrich.map(function (e, i) {
                  return (
                    <div key={i} className="text-xs bg-white rounded p-2 border border-blue-200">
                      <span className="font-bold">Row {e.rowNum}:</span>{' '}
                      <span className="font-mono">{e.existing.quick_code}</span>{' · '}
                      {e.existing.name_en}{' — adds: '}
                      <span className="text-blue-700 font-semibold">{e.enrichedFields.join(', ')}</span>
                    </div>
                  );
                })}
              </div>
            </details>
          )}

          {/* Skipped */}
          {parsedRows.skipped.length > 0 && (
            <details className="bg-slate-100 border border-slate-300 rounded-lg p-3 mb-3">
              <summary className="text-sm font-extrabold text-slate-700 cursor-pointer">⏭ Skipped ({parsedRows.skipped.length}) — products with matching quick_code and no new info</summary>
              <div className="mt-2 space-y-1 max-h-64 overflow-auto">
                {parsedRows.skipped.map(function (s, i) {
                  return (
                    <div key={i} className="text-xs bg-white rounded p-2 border border-slate-200">
                      <span className="font-bold">Row {s.rowNum}:</span>{' '}
                      <span className="font-mono">{s.existing.quick_code}</span>{' — '}
                      {s.existing.name_en}
                    </div>
                  );
                })}
              </div>
            </details>
          )}

          {/* Commit / cancel */}
          <div className="flex gap-2 mt-4">
            <button
              onClick={commitImport}
              disabled={busy || (parsedRows.valid.length === 0 && parsedRows.enrich.length === 0)}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-extrabold rounded-lg shadow"
            >
              {busy ? 'Importing...' : '✓ Commit Import (' + (parsedRows.valid.length + parsedRows.enrich.length) + ' rows)'}
            </button>
            <button
              onClick={function () { setParsedRows(null); }}
              disabled={busy}
              className="px-4 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 text-sm font-bold rounded-lg"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Result summary after commit */}
      {importResult && (
        <div className="bg-emerald-50 border-2 border-emerald-400 rounded-xl p-4">
          <div className="text-base font-extrabold text-emerald-900 mb-2">✅ Import complete</div>
          <div className="text-sm text-slate-900 space-y-1">
            <div>• Inserted: <span className="font-extrabold text-emerald-700">{importResult.inserted}</span> new products</div>
            <div>• Enriched: <span className="font-extrabold text-blue-700">{importResult.enriched}</span> existing products</div>
            <div>• Skipped: <span className="font-extrabold text-slate-700">{importResult.skipped}</span> rows (no new info)</div>
            <div>• Errors before import: <span className="font-extrabold text-red-700">{importResult.errors}</span> rows (fix and re-upload)</div>
            {importResult.failed > 0 && (
              <div className="mt-2 bg-red-50 border border-red-300 rounded p-2">
                <div className="font-extrabold text-red-900">⚠ Database errors on {importResult.failed} row(s) — import stopped:</div>
                {importResult.failedRows.map(function (f, i) {
                  return <div key={i} className="text-xs text-red-800 mt-1">Row {f.rowNum}: {f.error}</div>;
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
