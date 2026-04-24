'use client';
// ============================================================
// InventoryImport — bulk Excel import for inventory items.
//
// S19 (Apr 23 2026) — Max asked for the same fields that appear on
// the "+ Add Product" popup, importable from an Excel file. Also:
//   - Template download so users know column headers
//   - current_quantity is ONLY writable for NEW products; for existing
//     product_ids it is IGNORED with a warning unless super_admin
//     checked the override
//   - Each import row creates an inventory_inbounds entry AND
//     creates-or-aggregates the parent inventory row (same semantics
//     as the manual + Add Product flow)
//   - Expected quantity can be set in the template — written to a
//     separate inventory_expected table so the expected-vs-actual
//     report can compare them
// ============================================================

import { useState, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { supabase, dbInsert, dbUpdate } from '../lib/supabase';

// The template columns. Keep these in sync with the TEMPLATE_EXAMPLES below
// and with the parse map in parseRows().
//
// S20 (Apr 23 2026) — new "Inbound Quantity" column. Always the primary
// input. Original/Current are ONLY used the first time a product_id is
// seen. After that they are IGNORED unless super-admin ticked override.
var TEMPLATE_COLUMNS = [
  'Product ID',
  'Reference #',
  'Product Type',
  'Subcategory',
  'Description (Arabic)',
  'Description (English)',
  'Color (Arabic)',
  'Color (English)',
  'Inbound Quantity',       // ← primary input every time
  'Original Quantity',      // first-time only, or override permission
  'Current Quantity',       // first-time only, or override permission
  'Expected Quantity',
  'Unit of Measure',         // S22.11 — kg, ton, m, yd, roll, piece...
  'Linear Density (g/m)',    // S22.11 — for m/yd products (weight conversion)
  'Gross Weight (kg)',
  'Net Weight (kg)',
  'Unit Price',
  'Roll Count',
  'Shipment Reference',
  'Inbound Date',
  'Purchase Cost',
  'Purchase Currency',
  'Customs Cost',
  'Customs Currency',
  'Shipping Cost',
  'Shipping Currency',
  'Other Cost',
  'Other Currency',
  'FX Rate',
  'Notes',
];

// Three example rows: one brand-new product (first-time setup sets
// Original + Current), one existing-product inbound (Original/Current
// columns should be BLANK — system recomputes), and one with an Expected
// quantity filled in for later reconciliation.
var TEMPLATE_EXAMPLES = [
  // Columns in order — matches TEMPLATE_COLUMNS:
  //   Product ID, Reference #, Product Type, Subcategory, Desc AR, Desc EN,
  //   Color AR, Color EN, Inbound, Original, Current, Expected,
  //   Unit of Measure, Linear Density (g/m),
  //   Gross Weight (kg), Net Weight (kg), Unit Price, Roll Count,
  //   Shipment Reference, Inbound Date,
  //   Purchase Cost, Purchase Currency, Customs Cost, Customs Currency,
  //   Shipping Cost, Shipping Currency, Other Cost, Other Currency,
  //   FX Rate, Notes
  // Brand new — Inbound, Original and Current all filled. Yard-priced textile.
  ['SKU-001', 'REF-2026-001', 'Textiles', 'Cotton', 'قماش قطن أحمر', 'Red Cotton Fabric', 'أحمر', 'Red', 200, 200, 200, 0, 'yd', 420, 150, 140, 25, 10, 'SH-2026-01', '2026-04-20', 1200, 'USD', 5000, 'EGP', 800, 'USD', 0, 'EGP', 50, 'First batch — opening balance'],
  // Existing product — only Inbound is used; Original/Current blank. Yard-priced.
  ['SKU-001', 'REF-2026-015', 'Textiles', 'Cotton', 'قماش قطن أحمر', 'Red Cotton Fabric', 'أحمر', 'Red',  80,  '',  '',  0, 'yd', 420, 150, 140, 25,  4, 'SH-2026-02', '2026-05-10',  500, 'USD', 2000, 'EGP', 300, 'USD', 0, 'EGP', 50, 'Restock — inbound only'],
  // New product with Expected Qty for later comparison. Kg-priced leather.
  ['SKU-002', 'REF-2026-002', 'Leather', 'Genuine', 'جلد طبيعي بني', 'Brown Leather', 'بني', 'Brown',    50,  50,  50, 60, 'kg', '',   30,  28, 80,  5, 'SH-2026-01', '2026-04-20', 2500, 'USD', 3000, 'EGP', 400, 'USD', 0, 'EGP', 50, 'Expected 60, got 50'],
];

// Case-insensitive header lookup — users sometimes rename columns.
function getCell(row, col) {
  if (row[col] !== undefined && row[col] !== null && row[col] !== '') return row[col];
  var lower = col.toLowerCase();
  var keys = Object.keys(row);
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === lower) return row[keys[i]];
  }
  return '';
}

function parseNumber(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  var cleaned = String(v).replace(/[^0-9.\-]/g, '');
  var n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function parseDate(v) {
  if (!v) return '';
  if (typeof v === 'number') {
    // Excel serial date
    var d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return d.toISOString().substring(0, 10);
  }
  var s = String(v).trim();
  // try to detect yyyy-mm-dd or dd/mm/yyyy
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  var d2 = new Date(s);
  if (isNaN(d2.getTime())) return '';
  return d2.toISOString().substring(0, 10);
}

export default function InventoryImport({
  inventory,          // current inventory array so we can detect existing product_ids
  isSuperAdmin,       // only super_admin can override a locked current_quantity
  userId,             // for dbInsert/dbUpdate audit trail
  onClose,            // modal close callback
  onComplete,         // called after a successful import so the page reloads data
}) {
  var [step, setStep] = useState('select'); // select | preview | importing | done
  var [rows, setRows] = useState([]);
  var [warnings, setWarnings] = useState([]);
  var [importProgress, setImportProgress] = useState(0);
  var [result, setResult] = useState(null);
  var [overrideLock, setOverrideLock] = useState(false); // super_admin-only
  var fileInputRef = useRef(null);

  // Build a map of existing products so we can flag rows that would try
  // to overwrite a locked current_quantity.
  var existingByProductId = useMemo(function() {
    var map = {};
    (inventory || []).forEach(function(p) {
      if (p && p.product_id) map[String(p.product_id).trim()] = p;
    });
    return map;
  }, [inventory]);

  // ---- Template download ----
  var downloadTemplate = function() {
    var aoa = [TEMPLATE_COLUMNS].concat(TEMPLATE_EXAMPLES);
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    // Widen columns so text fits
    ws['!cols'] = TEMPLATE_COLUMNS.map(function(c) { return { wch: Math.max(14, c.length + 2) }; });
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Inventory');
    // A tiny Instructions sheet so users aren't confused about the three-field flow
    var instructions = [
      ['KTC Inventory Import Template'],
      [''],
      ['HOW TO USE'],
      ['1. Keep the header row. Fill in one row per product / inbound below.'],
      ['2. Save as .xlsx and upload through the Inventory → Import button.'],
      [''],
      ['THE THREE QUANTITY COLUMNS'],
      ['- Inbound Quantity — ALWAYS the primary input. It is how much arrived'],
      ['  in this shipment / batch.'],
      ['- Original Quantity — used ONLY the first time a Product ID is created.'],
      ['  For an existing Product ID it is IGNORED.'],
      ['- Current Quantity — used ONLY the first time a Product ID is created.'],
      ['  For an existing Product ID it is IGNORED. The system maintains the'],
      ['  running current value by adding Inbound Quantity to the previous total.'],
      [''],
      ['FIRST-TIME PRODUCTS (opening balances)'],
      ['- Fill Inbound, Original AND Current. Usually all three are equal.'],
      ['- If Inbound is blank, Original is used as the opening balance.'],
      [''],
      ['EXISTING PRODUCTS (subsequent shipments)'],
      ['- Fill Inbound only. Leave Original and Current BLANK.'],
      ['- The system adds Inbound to both Original and Current automatically.'],
      [''],
      ['SUPER-ADMIN OVERRIDE'],
      ['- Only a super-admin can adjust Original or Current for an existing product.'],
      ['- A checkbox on the import screen enables the override. Every such change'],
      ['  is written to a journal (inventory_adjustments table) so you always see'],
      ['  who adjusted what, when, from what, to what, and why.'],
      [''],
      ['EXPECTED QUANTITY'],
      ['- Optional. Use this to record what you expected on a shipment.'],
      ['- The Expected-vs-Actual report compares these against what arrived.'],
      ['- Expected quantity NEVER affects actual inventory numbers.'],
      [''],
      ['DATE FORMAT'],
      ['- yyyy-mm-dd is safest (e.g. 2026-04-20). Excel date cells also work.'],
      [''],
      ['CURRENCY'],
      ['- USD or EGP in the currency columns.'],
      ['- FX Rate is USD → EGP at the time of purchase. Default 50.'],
    ];
    var iws = XLSX.utils.aoa_to_sheet(instructions);
    iws['!cols'] = [{ wch: 80 }];
    XLSX.utils.book_append_sheet(wb, iws, 'Instructions');
    XLSX.writeFile(wb, 'KTC_Inventory_Import_Template.xlsx');
  };

  // ---- File read + parse ----
  var handleFile = async function(file) {
    try {
      var buf = await file.arrayBuffer();
      var wb = XLSX.read(buf, { type: 'array' });
      var sheetName = wb.SheetNames[0];
      var sheet = wb.Sheets[sheetName];
      var json = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      if (!json.length) { alert('The file is empty or unreadable.'); return; }
      var parsed = parseRows(json);
      setRows(parsed.rows);
      setWarnings(parsed.warnings);
      setStep('preview');
    } catch (e) {
      alert('Could not read file: ' + (e && e.message ? e.message : e));
    }
  };

  // ---- Main parser ----
  // S20 — Recognizes the Inbound Quantity column as the primary input.
  // Original and Current columns are picked up but their effect depends
  // on whether the product exists:
  //   - first-time: used to set opening balances
  //   - existing: IGNORED unless super-admin override is on (in which
  //     case the difference vs existing values becomes an adjustment
  //     journal entry).
  var parseRows = function(json) {
    var out = [];
    var warns = [];
    json.forEach(function(raw, idx) {
      var productId = String(getCell(raw, 'Product ID') || '').trim();
      if (!productId) {
        warns.push('Row ' + (idx + 2) + ' skipped — missing Product ID.');
        return;
      }
      var inboundQty = parseNumber(getCell(raw, 'Inbound Quantity'));
      var origQtyRaw = getCell(raw, 'Original Quantity');
      var currQtyRaw = getCell(raw, 'Current Quantity');
      var origProvided = origQtyRaw !== '' && origQtyRaw != null;
      var currProvided = currQtyRaw !== '' && currQtyRaw != null;
      var origQty = origProvided ? parseNumber(origQtyRaw) : 0;
      var currQty = currProvided ? parseNumber(currQtyRaw) : 0;

      var existing = existingByProductId[productId];

      // Determine the effective inbound amount for an inbound row.
      // First-time products: fall back to Original if Inbound blank.
      // Existing products: Inbound is required; Original/Current are ignored.
      if (!existing) {
        if (inboundQty <= 0) inboundQty = origQty || parseNumber(getCell(raw, 'Roll Count'));
        if (inboundQty <= 0 && origQty <= 0) {
          warns.push('Row ' + (idx + 2) + ' (' + productId + ') skipped — need Inbound Quantity or Original Quantity > 0.');
          return;
        }
      } else {
        if (inboundQty <= 0) {
          // Existing product and no inbound — only useful if super-admin is
          // making a pure adjustment (Original/Current changed). Still allow
          // the row through; flagged in UI.
          if (!origProvided && !currProvided) {
            warns.push('Row ' + (idx + 2) + ' (' + productId + ') skipped — existing product needs Inbound Quantity > 0.');
            return;
          }
        }
      }

      // Detect that Original/Current were provided for an existing product —
      // these are the rows that will be "ignored" unless super-admin override.
      var origWillBeIgnored = !!existing && origProvided;
      var currWillBeIgnored = !!existing && currProvided;

      var expectedQty = parseNumber(getCell(raw, 'Expected Quantity'));

      var row = {
        _rowNumber: idx + 2,
        product_id: productId,
        reference_number: String(getCell(raw, 'Reference #') || '').trim(),
        product_type: String(getCell(raw, 'Product Type') || '').trim(),
        subcategory: String(getCell(raw, 'Subcategory') || '').trim(),
        description: String(getCell(raw, 'Description (Arabic)') || '').trim(),
        description_en: String(getCell(raw, 'Description (English)') || '').trim(),
        color: String(getCell(raw, 'Color (Arabic)') || '').trim(),
        color_en: String(getCell(raw, 'Color (English)') || '').trim(),
        inbound_quantity: inboundQty,
        original_quantity_requested: origQty,
        original_quantity_provided: origProvided,
        current_quantity_requested: currQty,
        current_quantity_provided: currProvided,
        expected_quantity: expectedQty,
        // S22.11 — multi-unit support
        uom: String(getCell(raw, 'Unit of Measure') || '').trim() || null,
        linear_density_g_per_m: parseNumber(getCell(raw, 'Linear Density (g/m)')) || null,
        gross_weight: parseNumber(getCell(raw, 'Gross Weight (kg)')),
        net_weight: parseNumber(getCell(raw, 'Net Weight (kg)')),
        unit_price: parseNumber(getCell(raw, 'Unit Price')),
        roll_count: parseNumber(getCell(raw, 'Roll Count')),
        shipment_reference: String(getCell(raw, 'Shipment Reference') || '').trim(),
        inbound_date: parseDate(getCell(raw, 'Inbound Date')) || new Date().toISOString().substring(0, 10),
        purchase_cost: parseNumber(getCell(raw, 'Purchase Cost')),
        purchase_currency: String(getCell(raw, 'Purchase Currency') || 'USD').trim().toUpperCase() || 'USD',
        customs_cost: parseNumber(getCell(raw, 'Customs Cost')),
        customs_currency: String(getCell(raw, 'Customs Currency') || 'EGP').trim().toUpperCase() || 'EGP',
        shipping_cost: parseNumber(getCell(raw, 'Shipping Cost')),
        shipping_currency: String(getCell(raw, 'Shipping Currency') || 'USD').trim().toUpperCase() || 'USD',
        other_cost: parseNumber(getCell(raw, 'Other Cost')),
        other_currency: String(getCell(raw, 'Other Currency') || 'EGP').trim().toUpperCase() || 'EGP',
        fx_rate: parseNumber(getCell(raw, 'FX Rate')) || 50,
        notes: String(getCell(raw, 'Notes') || '').trim(),
        _existing: !!existing,
        _origWillBeIgnored: origWillBeIgnored,
        _currWillBeIgnored: currWillBeIgnored,
      };
      out.push(row);
    });
    return { rows: out, warnings: warns };
  };

  // ---- Execute import ----
  var runImport = async function() {
    setStep('importing');
    setImportProgress(0);
    var ok = 0, failed = 0;
    var errs = [];
    var lockedIgnored = 0;
    var expectedWritten = 0;
    var adjustmentsLogged = 0;

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      try {
        var existing = existingByProductId[r.product_id];
        var inboundQty = r.inbound_quantity || 0;

        // ---- 1. Log the inbound (only if there IS an inbound quantity) ----
        if (inboundQty > 0) {
          var inboundRecord = {
            product_id: r.product_id,
            reference_number: r.shipment_reference || r.reference_number,
            shipment_reference: r.shipment_reference,
            inbound_date: r.inbound_date,
            quantity: inboundQty,
            unit_price: r.unit_price,
            purchase_cost: r.purchase_cost,
            purchase_currency: r.purchase_currency,
            customs_cost: r.customs_cost,
            customs_currency: r.customs_currency,
            shipping_cost: r.shipping_cost,
            shipping_currency: r.shipping_currency,
            other_cost: r.other_cost,
            other_currency: r.other_currency,
            fx_rate: r.fx_rate,
            notes: r.notes,
          };
          await dbInsert('inventory_inbounds', inboundRecord, userId);
        }

        // ---- 2. Create or aggregate parent inventory row ----
        var adjustmentsForThisRow = [];
        if (existing) {
          var oldOrig = Number(existing.original_quantity || 0);
          var oldCurr = Number(existing.current_quantity || 0);
          // Default: inbound adds to both
          var newOrig = oldOrig + inboundQty;
          var newCurr = oldCurr + inboundQty;

          // Original Quantity column from the sheet: IGNORED unless super-admin override.
          if (r.original_quantity_provided) {
            if (isSuperAdmin && overrideLock) {
              if (r.original_quantity_requested !== oldOrig) {
                adjustmentsForThisRow.push({
                  field: 'original_quantity',
                  old: oldOrig,
                  new: r.original_quantity_requested,
                });
                newOrig = r.original_quantity_requested + inboundQty;
              }
            } else {
              lockedIgnored++;
            }
          }

          // Current Quantity column: same rule.
          if (r.current_quantity_provided) {
            if (isSuperAdmin && overrideLock) {
              if (r.current_quantity_requested !== oldCurr) {
                adjustmentsForThisRow.push({
                  field: 'current_quantity',
                  old: oldCurr,
                  new: r.current_quantity_requested,
                });
                newCurr = r.current_quantity_requested + inboundQty;
              }
            } else {
              lockedIgnored++;
            }
          }

          // Weighted cost averages, same as before
          var toEgp = function(amt, curr, fx) { return curr === 'USD' ? amt * fx : amt; };
          var oldFx = Number(existing.fx_rate) || 50;
          var newFx = r.fx_rate;
          var oldPurEgp = toEgp(Number(existing.purchase_cost) || 0, existing.purchase_currency, oldFx);
          var newPurEgp = toEgp(r.purchase_cost, r.purchase_currency, newFx);
          var avgPur = (oldOrig + inboundQty) > 0 ? (oldPurEgp + newPurEgp) / 2 : 0;
          var oldCusEgp = toEgp(Number(existing.customs_cost) || 0, existing.customs_currency, oldFx);
          var newCusEgp = toEgp(r.customs_cost, r.customs_currency, newFx);
          var avgCus = (oldOrig + inboundQty) > 0 ? (oldCusEgp + newCusEgp) / 2 : 0;

          await dbUpdate('inventory', existing.id, {
            original_quantity: newOrig,
            current_quantity: newCurr,
            purchase_cost: Math.round(avgPur * 100) / 100,
            purchase_currency: 'EGP',
            customs_cost: Math.round(avgCus * 100) / 100,
            customs_currency: 'EGP',
            shipping_cost: (Number(existing.shipping_cost) || 0) + toEgp(r.shipping_cost, r.shipping_currency, newFx),
            other_cost: (Number(existing.other_cost) || 0) + toEgp(r.other_cost, r.other_currency, newFx),
            fx_rate: newFx,
            shipment_reference: (existing.shipment_reference || '') + (r.shipment_reference ? (existing.shipment_reference ? ', ' : '') + r.shipment_reference : ''),
            last_inbound_date: r.inbound_date,
          }, userId);

          // Log any super-admin adjustments from this row
          for (var ai = 0; ai < adjustmentsForThisRow.length; ai++) {
            var adj = adjustmentsForThisRow[ai];
            try {
              await dbInsert('inventory_adjustments', {
                product_id: r.product_id,
                field: adj.field,
                old_value: adj.old,
                new_value: adj.new,
                reason: 'Super-admin override via Excel import (row ' + r._rowNumber + ')' + (r.notes ? ' — ' + r.notes : ''),
                source: 'import',
                adjusted_by: userId,
              }, userId);
              adjustmentsLogged++;
            } catch (adjErr) {
              if (!errs.some(function(e) { return /inventory_adjustments/.test(e); })) {
                errs.push('inventory_adjustments table missing — run the S20 SQL to enable the adjustment journal.');
              }
            }
          }
        } else {
          // Brand new product
          // First-time: Original = user value OR Inbound. Current = user value OR Original.
          var firstOrig = r.original_quantity_provided ? r.original_quantity_requested : inboundQty;
          var firstCurr = r.current_quantity_provided ? r.current_quantity_requested : firstOrig;
          var newInvRecord = {
            product_id: r.product_id,
            reference_number: r.reference_number,
            product_type: r.product_type,
            subcategory: r.subcategory,
            description: r.description,
            description_en: r.description_en,
            color: r.color,
            color_en: r.color_en,
            original_quantity: firstOrig,
            current_quantity: firstCurr,
            // S22.11 — UoM + linear density
            uom: r.uom,
            linear_density_g_per_m: r.linear_density_g_per_m,
            gross_weight: r.gross_weight,
            net_weight: r.net_weight,
            unit_price: r.unit_price,
            roll_count: r.roll_count || inboundQty || firstOrig,
            shipment_reference: r.shipment_reference,
            last_inbound_date: r.inbound_date,
            purchase_cost: r.purchase_cost,
            purchase_currency: r.purchase_currency,
            customs_cost: r.customs_cost,
            customs_currency: r.customs_currency,
            shipping_cost: r.shipping_cost,
            shipping_currency: r.shipping_currency,
            other_cost: r.other_cost,
            other_currency: r.other_currency,
            fx_rate: r.fx_rate,
          };
          try {
            await dbInsert('inventory', newInvRecord, userId);
          } catch (colErr) {
            if (String(colErr.message || '').match(/column.*uom|column.*linear_density/i)) {
              console.warn('[import] new columns missing — run s22_inventory_uom.sql. Retrying without.');
              delete newInvRecord.uom;
              delete newInvRecord.linear_density_g_per_m;
              await dbInsert('inventory', newInvRecord, userId);
            } else {
              throw colErr;
            }
          }
        }

        // ---- 3. Expected quantity (separate table so it doesn't affect actuals) ----
        if (r.expected_quantity > 0 && r.shipment_reference) {
          try {
            await dbInsert('inventory_expected', {
              product_id: r.product_id,
              shipment_reference: r.shipment_reference,
              expected_quantity: r.expected_quantity,
              expected_date: r.inbound_date,
              notes: r.notes || '',
            }, userId);
            expectedWritten++;
          } catch (expErr) {
            // Table may not exist yet — non-fatal. Warn once.
            if (!errs.some(function(e) { return /inventory_expected/.test(e); })) {
              errs.push('inventory_expected table missing — run the SQL in the handoff doc to enable Expected-vs-Actual reports.');
            }
          }
        }

        ok++;
      } catch (e) {
        failed++;
        if (errs.length < 5) errs.push('Row ' + r._rowNumber + ': ' + (e && e.message ? e.message : e));
      }
      setImportProgress(Math.round(((i + 1) / rows.length) * 100));
    }

    setResult({ ok: ok, failed: failed, errors: errs, lockedIgnored: lockedIgnored, expectedWritten: expectedWritten, adjustmentsLogged: adjustmentsLogged });
    setStep('done');
    if (onComplete) onComplete();
  };

  // ---- UI ----
  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col" onClick={function(e){e.stopPropagation();}}>
        <div className="px-5 py-3 border-b border-slate-100 flex justify-between items-center">
          <h3 className="text-base font-extrabold">📥 Import Inventory from Excel</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">×</button>
        </div>

        <div className="flex-1 overflow-auto p-5">
          {step === 'select' && (
            <div>
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-900">
                <div className="font-bold mb-1">How this works</div>
                <ul className="list-disc pl-4 space-y-1">
                  <li>Download the template, fill one row per product/inbound, save as .xlsx.</li>
                  <li>Upload it below. You'll preview every row before anything hits the database.</li>
                  <li><strong>Current Quantity</strong> is the opening balance for brand-new products. For existing product IDs it's ignored — the running total updates from each inbound you add.</li>
                  <li>Each row creates an <strong>inbound record</strong> you can see in the product detail (📥 Inbound History).</li>
                </ul>
              </div>

              <div className="flex gap-3 items-center mb-4">
                <button onClick={downloadTemplate}
                  className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-bold">
                  ⬇ Download Template
                </button>
                <span className="text-[11px] text-slate-500">Includes an Instructions sheet and two example rows.</span>
              </div>

              <div className="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center">
                <input type="file" accept=".xlsx,.xls" ref={fileInputRef}
                  onChange={function(e) { if (e.target.files && e.target.files[0]) handleFile(e.target.files[0]); }}
                  className="hidden" />
                <button onClick={function() { fileInputRef.current && fileInputRef.current.click(); }}
                  className="px-5 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-bold">
                  📁 Choose Excel File
                </button>
                <div className="text-[11px] text-slate-400 mt-2">.xlsx or .xls — any column order, we'll match headers automatically.</div>
              </div>
            </div>
          )}

          {step === 'preview' && (
            <div>
              <div className="flex justify-between items-center mb-3">
                <div className="text-sm font-bold">
                  Found <span className="text-blue-600">{rows.length}</span> row{rows.length === 1 ? '' : 's'} to import.
                </div>
                <button onClick={function() { setStep('select'); setRows([]); setWarnings([]); }}
                  className="text-xs text-slate-500 hover:text-slate-700">← Choose different file</button>
              </div>

              {warnings.length > 0 && (
                <div className="mb-3 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-900">
                  <div className="font-bold mb-1">⚠️ {warnings.length} row{warnings.length === 1 ? '' : 's'} will be skipped:</div>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {warnings.slice(0, 6).map(function(w, i) { return (<li key={i}>{w}</li>); })}
                    {warnings.length > 6 && (<li>...and {warnings.length - 6} more</li>)}
                  </ul>
                </div>
              )}

              {rows.some(function(r) { return r._origWillBeIgnored || r._currWillBeIgnored; }) && (
                <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded text-xs">
                  <div className="font-bold text-red-900 mb-1">🔒 Original / Current Quantity locked on existing products</div>
                  <div className="text-red-800 mb-2">
                    Some rows set an Original or Current Quantity for a product that already exists. By default these are <strong>ignored</strong> — the running totals are maintained by adding Inbound Quantity.
                  </div>
                  {isSuperAdmin ? (
                    <label className="flex items-center gap-2 text-red-900 font-semibold cursor-pointer">
                      <input type="checkbox" checked={overrideLock} onChange={function(e) { setOverrideLock(e.target.checked); }} />
                      <span>I'm a super-admin — apply these as adjustments (each one is logged as a journal entry on the product)</span>
                    </label>
                  ) : (
                    <div className="text-red-700 italic">Only a super-admin can override. Remove the values from those cells to silence this warning.</div>
                  )}
                </div>
              )}

              <div className="overflow-auto max-h-[360px] border rounded-lg">
                <table className="w-full text-[11px] border-collapse">
                  <thead className="sticky top-0 bg-slate-100"><tr>
                    <th className="px-2 py-1.5 text-left">Row</th>
                    <th className="px-2 py-1.5 text-left">Product ID</th>
                    <th className="px-2 py-1.5 text-left">Description</th>
                    <th className="px-2 py-1.5 text-right text-emerald-700">Inbound Qty</th>
                    <th className="px-2 py-1.5 text-right">Original Qty</th>
                    <th className="px-2 py-1.5 text-right">Current Qty</th>
                    <th className="px-2 py-1.5 text-right">Expected</th>
                    <th className="px-2 py-1.5 text-left">Shipment</th>
                    <th className="px-2 py-1.5 text-left">Inbound Date</th>
                    <th className="px-2 py-1.5 text-left">Notes</th>
                  </tr></thead>
                  <tbody>
                    {rows.map(function(r, i) {
                      var existingP = existingByProductId[r.product_id];
                      var effectiveOrig, effectiveCurr;
                      if (r._existing) {
                        var oldOrig = Number(existingP.original_quantity || 0);
                        var oldCurr = Number(existingP.current_quantity || 0);
                        if (r._origWillBeIgnored && isSuperAdmin && overrideLock) {
                          effectiveOrig = r.original_quantity_requested + r.inbound_quantity;
                        } else {
                          effectiveOrig = oldOrig + r.inbound_quantity;
                        }
                        if (r._currWillBeIgnored && isSuperAdmin && overrideLock) {
                          effectiveCurr = r.current_quantity_requested + r.inbound_quantity;
                        } else {
                          effectiveCurr = oldCurr + r.inbound_quantity;
                        }
                      } else {
                        effectiveOrig = r.original_quantity_provided ? r.original_quantity_requested : r.inbound_quantity;
                        effectiveCurr = r.current_quantity_provided ? r.current_quantity_requested : effectiveOrig;
                      }
                      return (
                        <tr key={i} className={'border-b border-slate-50 ' + (r._existing ? 'bg-blue-50' : '')}>
                          <td className="px-2 py-1 text-slate-400">{r._rowNumber}</td>
                          <td className="px-2 py-1 font-bold">{r.product_id} {r._existing && <span className="text-[9px] text-blue-600">(existing)</span>}</td>
                          <td className="px-2 py-1 truncate max-w-[140px]" title={r.description_en || r.description}>{r.description_en || r.description || '—'}</td>
                          <td className="px-2 py-1 text-right font-bold text-emerald-700">{r.inbound_quantity || <span className="text-slate-300">—</span>}</td>
                          <td className="px-2 py-1 text-right">
                            {r._origWillBeIgnored
                              ? (isSuperAdmin && overrideLock
                                ? <span className="text-red-600 font-bold" title="Super-admin override — journal entry will be written">{r.original_quantity_requested}*</span>
                                : <span className="text-slate-400 line-through" title="Ignored — product exists">{r.original_quantity_requested}</span>)
                              : (<span className="text-slate-700" title="Effective">{effectiveOrig}</span>)}
                          </td>
                          <td className="px-2 py-1 text-right">
                            {r._currWillBeIgnored
                              ? (isSuperAdmin && overrideLock
                                ? <span className="text-red-600 font-bold" title="Super-admin override — journal entry will be written">{r.current_quantity_requested}*</span>
                                : <span className="text-slate-400 line-through" title="Ignored — product exists">{r.current_quantity_requested}</span>)
                              : (<span className="text-slate-700" title="Effective">{effectiveCurr}</span>)}
                          </td>
                          <td className="px-2 py-1 text-right text-purple-600">{r.expected_quantity || '—'}</td>
                          <td className="px-2 py-1 text-blue-600">{r.shipment_reference || '—'}</td>
                          <td className="px-2 py-1 text-slate-600">{r.inbound_date}</td>
                          <td className="px-2 py-1 text-slate-500 truncate max-w-[120px]" title={r.notes}>{r.notes || ''}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                * = super-admin override — journal entry will be written for the change.
                Emerald = Inbound Qty (the primary input). Blue rows = existing products.
              </div>

              <div className="flex justify-between items-center mt-4 pt-3 border-t">
                <button onClick={onClose} className="px-4 py-2 text-xs text-slate-500 hover:text-slate-700">Cancel</button>
                <button onClick={runImport} disabled={rows.length === 0}
                  className="px-5 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-bold disabled:opacity-40">
                  ✓ Import {rows.length} row{rows.length === 1 ? '' : 's'}
                </button>
              </div>
            </div>
          )}

          {step === 'importing' && (
            <div className="text-center py-8">
              <div className="text-sm font-bold mb-2">Importing...</div>
              <div className="w-full max-w-md mx-auto h-3 bg-slate-200 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 transition-all" style={{ width: importProgress + '%' }} />
              </div>
              <div className="text-xs text-slate-500 mt-2">{importProgress}%</div>
            </div>
          )}

          {step === 'done' && result && (
            <div>
              <div className="text-center py-4">
                <div className="text-3xl mb-2">✅</div>
                <div className="text-lg font-extrabold">Import complete</div>
                <div className="text-sm text-slate-600 mt-1">
                  <span className="font-bold text-emerald-600">{result.ok}</span> row{result.ok === 1 ? '' : 's'} imported,{' '}
                  <span className="font-bold text-red-600">{result.failed}</span> failed
                </div>
              </div>
              {result.lockedIgnored > 0 && (
                <div className="mb-3 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-900">
                  🔒 {result.lockedIgnored} Original/Current Quantity cell{result.lockedIgnored === 1 ? '' : 's'} on existing products ignored per the lock rule.
                </div>
              )}
              {result.adjustmentsLogged > 0 && (
                <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-900">
                  🧾 {result.adjustmentsLogged} super-admin adjustment{result.adjustmentsLogged === 1 ? '' : 's'} logged to the product journal. View in Product Detail → Adjustment History.
                </div>
              )}
              {result.expectedWritten > 0 && (
                <div className="mb-3 p-2 bg-purple-50 border border-purple-200 rounded text-xs text-purple-900">
                  📋 {result.expectedWritten} expected-quantity entries recorded — visible in the Expected vs Actual report.
                </div>
              )}
              {result.errors && result.errors.length > 0 && (
                <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-900">
                  <div className="font-bold mb-1">Errors:</div>
                  <ul className="list-disc pl-4">
                    {result.errors.map(function(e, i) { return (<li key={i}>{e}</li>); })}
                  </ul>
                </div>
              )}
              <div className="flex justify-end pt-3 border-t">
                <button onClick={onClose} className="px-5 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-bold">Done</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
