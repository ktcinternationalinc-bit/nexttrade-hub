'use client';
// v55.83-A.6.27.30 — Inventory Phase 1 Build 4.5: Bulk Import Legacy Stock
//
// One-time tool to bring existing inventory into the new classification
// system. Each row of the spreadsheet becomes one stock receipt with
// receipt_type = 'legacy_import'. No new SQL — uses inventory_stock_receipts
// table from Build 4.0.
//
// Permission: super_admin OR Edit Inventory (same as Build 4.0).
// Cost columns visibility: canSeeInventoryCosts helper.
//
// Decisions locked:
//   - 3-sheet template (Stock Import + Products Reference + Warehouses Reference + Instructions)
//   - Validation rejects rows with unknown product_quick_code or warehouse_name
//   - receipt_date defaults to today if blank
//   - Stops on first DB error during commit
//   - Each row becomes ONE receipt (sequential numbers RCV-YYYY-MM-DD-NNN)

import { useState, useEffect, useRef } from 'react';
import RestrictedNotice from './RestrictedNotice';
import * as XLSX from 'xlsx';
import { supabase, dbInsert } from '../lib/supabase';
import { canSeeInventoryCosts } from '../lib/inventory-permissions';

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

function asDate(v) {
  if (isBlank(v)) return null;
  // Handle Excel date serial number
  if (typeof v === 'number') {
    var d = XLSX.SSF.parse_date_code(v);
    if (d && d.y && d.m && d.d) {
      var mm = String(d.m).padStart(2, '0');
      var dd = String(d.d).padStart(2, '0');
      return d.y + '-' + mm + '-' + dd;
    }
    return 'INVALID';
  }
  // Already a string — normalize
  var s = String(v).trim();
  // Try YYYY-MM-DD pattern
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Try ISO date parse
  var parsed = new Date(s);
  if (isNaN(parsed.getTime())) return 'INVALID';
  return parsed.toISOString().substring(0, 10);
}

export default function InventoryStockImport(props) {
  var userProfile = props.userProfile;
  var modulePerms = props.modulePerms || {};
  var isSuperAdmin = props.isSuperAdmin === true;
  var toast = props.toast || { success: function(){}, error: function(){}, warning: function(){}, info: function(){} };

  // Permission gates
  var canImport = isSuperAdmin || modulePerms['Edit Inventory'] === true;
  var seeCosts = canSeeInventoryCosts(userProfile, modulePerms);

  var [products, setProducts] = useState([]);
  var [warehouses, setWarehouses] = useState([]);
  var [loading, setLoading] = useState(true);
  var [parsedRows, setParsedRows] = useState(null);
  var [busy, setBusy] = useState(false);
  var [importResult, setImportResult] = useState(null);
  var fileInputRef = useRef(null);

  // Build template headers — cost columns gated by seeCosts
  var TEMPLATE_HEADERS = (function () {
    var base = [
      'product_quick_code',
      'quantity',
      'uom',
      'warehouse_name',
      'rack',
      'supplier',
      'batch_number',
    ];
    if (seeCosts) {
      base = base.concat(['cost_per_uom', 'currency']);
    }
    base = base.concat([
      'receipt_date',
      'container_number',
      'notes',
      'actual_thickness_mm',
      'actual_width_m',
      'actual_gsm',
      'actual_density',
      'actual_weight_per_roll',
      'actual_roll_length_m',
    ]);
    return base;
  })();

  // Load reference data once
  useEffect(function () {
    if (!canImport) { setLoading(false); return; }
    var cancelled = false;
    async function load() {
      setLoading(true);
      try {
        var [prodRes, whRes] = await Promise.all([
          supabase.from('inventory_products').select('*').eq('active', true),
          supabase.from('inv_warehouses').select('*').order('name'),
        ]);
        if (cancelled) return;
        setProducts(prodRes.data || []);
        setWarehouses(whRes.data || []);
      } catch (e) {
        console.error('[stock-import] load failed:', e);
        toast.error('Failed to load reference data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return function () { cancelled = true; };
  }, [canImport]);

  // ── Lookup helpers ────────────────────────────────────────────────
  function findProductByQuickCode(code) {
    if (isBlank(code)) return null;
    var k = String(code).trim().toLowerCase();
    return products.find(function (p) {
      return p.active && (p.quick_code || '').toLowerCase() === k;
    }) || null;
  }

  function findWarehouseByName(name) {
    if (isBlank(name)) return null;
    var k = String(name).trim().toLowerCase();
    return warehouses.find(function (w) {
      return (w.name || '').toLowerCase() === k;
    }) || null;
  }

  // ── Template generation ────────────────────────────────────────────
  function downloadTemplate() {
    if (!products.length) {
      alert('You don\'t have any products in the Product List yet. Add products first (or use Import Products in Build 3) before importing stock.');
      return;
    }
    if (!warehouses.length) {
      alert('You don\'t have any warehouses defined yet. Add warehouses in Inventory → Warehouses before importing stock.');
      return;
    }
    var wb = XLSX.utils.book_new();

    // v55.83-A.6.27.61 — Sheet 0: Shipment Info (header — one row of fields for the whole shipment).
    // These values apply to ALL product lines in Stock Import sheet UNLESS the row overrides.
    // Saves you from repeating "warehouse_name" and "supplier" on every line.
    var shipmentInfoHeaders = [
      'shipment_reference',
      'warehouse_name',
      'receipt_date',
      'supplier',
      'freight_forwarder',
      'shipping_line',
      'origin_country',
      'bl_number',
      'container_number',
      'eta',
      'total_shipping_cost',
      'shipping_cost_currency',
      'notes',
    ];
    var shipmentInfoExample = [
      'KTC-2026-042',                            // shipment_reference
      warehouses[0] ? warehouses[0].name : '',   // warehouse_name
      new Date().toISOString().substring(0, 10), // receipt_date
      'ABC Suppliers',                            // supplier
      'DHL Global Forwarding',                    // freight_forwarder
      'Maersk',                                   // shipping_line
      'China',                                    // origin_country
      'MAEU123456789',                            // bl_number
      'MAEU1234567',                              // container_number
      '',                                         // eta
      '4500',                                     // total_shipping_cost
      'USD',                                      // shipping_cost_currency
      'Q3 leather replenishment',                 // notes
    ];
    var shipmentSheet = XLSX.utils.aoa_to_sheet([shipmentInfoHeaders, shipmentInfoExample]);
    shipmentSheet['!cols'] = shipmentInfoHeaders.map(function (h) {
      if (h === 'shipment_reference' || h === 'bl_number' || h === 'container_number') return { wch: 20 };
      if (h === 'warehouse_name' || h === 'supplier' || h === 'freight_forwarder' || h === 'shipping_line') return { wch: 22 };
      if (h === 'notes') return { wch: 40 };
      return { wch: 14 };
    });
    XLSX.utils.book_append_sheet(wb, shipmentSheet, 'Shipment Info');

    // Sheet 1: Stock Import — one example row
    var exampleRow = (function () {
      var p = products[0];
      var w = warehouses[0];
      var row = [
        p.quick_code || 'NM-204',
        '500',
        p.default_uom || 'meter',
        w.name,
        p.default_rack || 'A-12',
        p.default_supplier || 'ABC Suppliers',
        'LEGACY-001',
      ];
      if (seeCosts) {
        row.push(p.default_cost != null ? String(p.default_cost) : '250');
        row.push(p.default_currency || 'EGP');
      }
      row.push(new Date().toISOString().substring(0, 10));
      row.push('');
      row.push('Legacy stock as of today — delete example row before import');
      // tech specs — empty (only override when actual differs from master)
      row.push(''); row.push(''); row.push(''); row.push(''); row.push(''); row.push('');
      return row;
    })();

    var impSheet = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, exampleRow]);
    impSheet['!cols'] = TEMPLATE_HEADERS.map(function (h) {
      if (h === 'product_quick_code') return { wch: 16 };
      if (h === 'warehouse_name') return { wch: 24 };
      if (h === 'supplier') return { wch: 24 };
      if (h === 'batch_number' || h === 'container_number') return { wch: 18 };
      if (h === 'notes') return { wch: 40 };
      if (h === 'receipt_date') return { wch: 12 };
      return { wch: 12 };
    });
    XLSX.utils.book_append_sheet(wb, impSheet, 'Stock Import');

    // Sheet 2: Products Reference
    var prodHeaders = ['Quick Code', 'Name (English)', 'Name (Arabic)', 'Default UOM', 'Default Supplier', 'Classification Slug'];
    if (seeCosts) prodHeaders.push('Default Cost', 'Default Currency');
    var prodAOA = [prodHeaders];
    products.slice().sort(function (a, b) {
      return (a.quick_code || a.name_en || '').localeCompare(b.quick_code || b.name_en || '');
    }).forEach(function (p) {
      var row = [
        p.quick_code || '',
        p.name_en || '',
        p.name_ar || '',
        p.default_uom || '',
        p.default_supplier || '',
        p.classification_slug || '',
      ];
      if (seeCosts) {
        row.push(p.default_cost != null ? p.default_cost : '');
        row.push(p.default_currency || '');
      }
      prodAOA.push(row);
    });
    var prodSheet = XLSX.utils.aoa_to_sheet(prodAOA);
    prodSheet['!cols'] = [{ wch: 16 }, { wch: 35 }, { wch: 35 }, { wch: 10 }, { wch: 22 }, { wch: 28 }];
    if (seeCosts) prodSheet['!cols'].push({ wch: 12 }, { wch: 10 });
    XLSX.utils.book_append_sheet(wb, prodSheet, 'Products Reference');

    // Sheet 3: Warehouses Reference
    var whAOA = [['Warehouse Name', 'Code', 'Location', 'Notes']];
    warehouses.forEach(function (w) {
      whAOA.push([w.name || '', w.code || '', w.location || '', w.notes || '']);
    });
    var whSheet = XLSX.utils.aoa_to_sheet(whAOA);
    whSheet['!cols'] = [{ wch: 24 }, { wch: 10 }, { wch: 24 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, whSheet, 'Warehouses Reference');

    // Sheet 4: Instructions
    var instr = [
      ['KTC NextTrade Hub — Import Shipment Template (v55.83-A.6.27.61)'],
      [''],
      ['PURPOSE:'],
      ['Bulk-import an entire shipment in one Excel file. Each shipment has ONE set of'],
      ['shipment-level info (forwarder, BL #, container #, warehouse, supplier, etc.) and'],
      ['MANY product lines (one row per product received).'],
      [''],
      ['STRUCTURE:'],
      ['• Sheet "Shipment Info" — fill ONE row with shipment-level fields. These apply to'],
      ['  ALL product lines below. (Don\'t repeat them per row.)'],
      ['• Sheet "Stock Import" — fill MANY rows, one per product received in this shipment.'],
      ['  If you leave warehouse_name / supplier / receipt_date / container_number BLANK on'],
      ['  a row, it inherits from "Shipment Info" sheet. Override per-row only when needed.'],
      [''],
      ['HOW TO USE:'],
      ['1. Fill in the "Shipment Info" sheet — only one data row, shipment-level fields.'],
      ['2. Fill in the "Stock Import" sheet — one row per product received.'],
      ['3. product_quick_code must match an existing product (see Products Reference).'],
      ['4. quantity is required (must be > 0).'],
      ['5. uom is optional — defaults to the product master if blank.'],
      ['6. Tech spec overrides (thickness, width, GSM, density, weight, length) only fill'],
      ['   if the actual roll differs from the product master default.'],
      ['7. Delete the example rows before uploading.'],
      ['8. Save as .xlsx and upload via the Import Shipment screen.'],
      [''],
      ['VALIDATION:'],
      ['- Unknown quick codes → row rejected with row#.'],
      ['- Unknown warehouse names → row rejected with row#.'],
      ['- Invalid numbers/dates → row rejected with specific reason.'],
      [''],
      ['NOTE ON COSTS:'],
      ['- Cost columns only appear if you have View Costs permission.'],
      ['- Users without cost access can still import — cost just stays blank.'],
      [''],
      ['UOM values: ' + VALID_UOM.join(', ')],
      ['Currency values: ' + VALID_CURRENCY.join(', ')],
    ];
    var instrSheet = XLSX.utils.aoa_to_sheet(instr);
    instrSheet['!cols'] = [{ wch: 90 }];
    XLSX.utils.book_append_sheet(wb, instrSheet, 'Instructions');

    var stamp = new Date().toISOString().substring(0, 10);
    XLSX.writeFile(wb, 'KTC-Import-Shipment-Template-' + stamp + '.xlsx');
    toast.success('Template downloaded. Fill it out and upload back here.');
  }

  // ── Upload + parse + validate ─────────────────────────────────────
  async function handleFileUpload(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    setImportResult(null);
    setParsedRows(null);
    setBusy(true);
    try {
      var data = await file.arrayBuffer();
      var wb = XLSX.read(data);

      // v55.83-A.6.27.61 — Try to read Shipment Info sheet first (new template structure).
      // Its values become defaults for any Stock Import rows that leave fields blank.
      var shipmentDefaults = {};
      if (wb.SheetNames.includes('Shipment Info')) {
        try {
          var infoSheet = wb.Sheets['Shipment Info'];
          var infoRows = XLSX.utils.sheet_to_json(infoSheet, { defval: '' });
          if (infoRows && infoRows.length > 0) {
            // Use first data row as defaults
            shipmentDefaults = infoRows[0] || {};
          }
        } catch (e) {
          console.warn('[stock-import] could not parse Shipment Info sheet:', e);
        }
      }

      var sheetName = 'Stock Import';
      if (!wb.SheetNames.includes(sheetName)) {
        sheetName = wb.SheetNames[0];
        // If first sheet is Shipment Info, skip past it
        if (sheetName === 'Shipment Info' && wb.SheetNames.length > 1) {
          sheetName = wb.SheetNames[1];
        }
      }
      var sheet = wb.Sheets[sheetName];
      var rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      if (!rows.length) {
        toast.error('No rows found in the Stock Import sheet');
        setBusy(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      var result = validateRows(rows, shipmentDefaults);
      setParsedRows(result);
      var hint = '';
      if (shipmentDefaults && Object.keys(shipmentDefaults).length > 0) {
        hint = ' (' + Object.keys(shipmentDefaults).filter(function (k) { return shipmentDefaults[k]; }).length + ' shipment-level defaults applied)';
      }
      toast.info('Parsed ' + rows.length + ' row(s)' + hint + '. Review preview below.');
    } catch (err) {
      console.error('[stock-import] parse failed:', err);
      toast.error('Could not parse file: ' + ((err && err.message) || String(err)));
      alert('Could not parse the file. Make sure it\'s a valid .xlsx file with a "Stock Import" sheet.\n\nError: ' + ((err && err.message) || String(err)));
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  // v55.83-A.6.27.61 — validateRows now takes shipmentDefaults (from Shipment Info sheet).
  // When a row leaves a field blank, fall back to the shipment-level default before erroring.
  function validateRows(rows, shipmentDefaults) {
    shipmentDefaults = shipmentDefaults || {};
    var valid = [];
    var errors = [];
    var todayStr = new Date().toISOString().substring(0, 10);

    // Helper: get the row value, or fall back to shipment-level default
    function getWithDefault(raw, key) {
      var rowVal = raw[key];
      if (rowVal != null && String(rowVal).trim() !== '') return rowVal;
      var dflt = shipmentDefaults[key];
      if (dflt != null && String(dflt).trim() !== '') return dflt;
      return '';
    }

    rows.forEach(function (raw, idx) {
      var rowNum = idx + 2; // header is row 1
      var errs = [];

      var quickCode = String(raw.product_quick_code || '').trim();
      if (!quickCode) {
        errs.push('product_quick_code required');
      }
      var product = quickCode ? findProductByQuickCode(quickCode) : null;
      if (quickCode && !product) {
        errs.push('product_quick_code "' + quickCode + '" not found in Product List (or product is inactive)');
      }

      var qty = asNumber(raw.quantity);
      if (qty === null) errs.push('quantity required');
      else if (qty === 'INVALID') errs.push('quantity must be a number (got "' + raw.quantity + '")');
      else if (qty <= 0) errs.push('quantity must be greater than 0 (got ' + qty + ')');

      // v55.83-A.6.27.61 — warehouse_name falls back to shipment default
      var warehouseName = String(getWithDefault(raw, 'warehouse_name') || '').trim();
      if (!warehouseName) errs.push('warehouse_name required');
      var warehouse = warehouseName ? findWarehouseByName(warehouseName) : null;
      if (warehouseName && !warehouse) {
        errs.push('warehouse_name "' + warehouseName + '" not found (see Warehouses Reference sheet)');
      }

      var uom = String(raw.uom || '').trim().toLowerCase();
      if (uom && VALID_UOM.indexOf(uom) < 0) {
        errs.push('uom must be one of: ' + VALID_UOM.join(', '));
      }

      var currency = String(raw.currency || '').trim().toUpperCase();
      if (currency && VALID_CURRENCY.indexOf(currency) < 0) {
        errs.push('currency must be one of: ' + VALID_CURRENCY.join(', '));
      }

      // v55.83-A.6.27.61 — receipt_date falls back to shipment default
      var receiptDate = asDate(getWithDefault(raw, 'receipt_date'));
      if (receiptDate === 'INVALID') {
        errs.push('receipt_date is invalid (got "' + getWithDefault(raw, 'receipt_date') + '"). Use YYYY-MM-DD or leave blank for today.');
      }

      // Numeric validation for cost + tech specs
      ['cost_per_uom','actual_thickness_mm','actual_width_m','actual_gsm','actual_density','actual_weight_per_roll','actual_roll_length_m'].forEach(function (k) {
        var n = asNumber(raw[k]);
        if (n === 'INVALID') errs.push(k + ' must be a number (got "' + raw[k] + '")');
      });

      if (errs.length) {
        errors.push({ rowNum: rowNum, raw: raw, errors: errs });
        return;
      }

      var cost = asNumber(raw.cost_per_uom);
      var resolvedCost = (cost === null || cost === 'INVALID') ? null : cost;
      var total = (resolvedCost != null && qty != null) ? qty * resolvedCost : null;
      // If user lacks cost access, force costs to null regardless of file content
      if (!seeCosts) {
        resolvedCost = null;
        total = null;
        currency = null;
      }

      var payload = {
        receipt_type: 'legacy_import',
        receipt_date: receiptDate || todayStr,
        status: 'active',
        product_id: product.id,
        quantity: qty,
        uom: uom || product.default_uom || null,
        actual_thickness_mm: asNumber(raw.actual_thickness_mm) === 'INVALID' ? null : asNumber(raw.actual_thickness_mm),
        actual_width_m: asNumber(raw.actual_width_m) === 'INVALID' ? null : asNumber(raw.actual_width_m),
        actual_gsm: asNumber(raw.actual_gsm) === 'INVALID' ? null : asNumber(raw.actual_gsm),
        actual_density: asNumber(raw.actual_density) === 'INVALID' ? null : asNumber(raw.actual_density),
        actual_weight_per_roll: asNumber(raw.actual_weight_per_roll) === 'INVALID' ? null : asNumber(raw.actual_weight_per_roll),
        actual_roll_length_m: asNumber(raw.actual_roll_length_m) === 'INVALID' ? null : asNumber(raw.actual_roll_length_m),
        supplier: String(getWithDefault(raw, 'supplier') || '').trim() || null,
        batch_number: String(raw.batch_number || '').trim() || null,
        container_number: String(getWithDefault(raw, 'container_number') || '').trim() || null,
        cost_per_uom: resolvedCost,
        currency: currency || null,
        total_cost: total,
        warehouse_id: warehouse.id,
        rack: String(raw.rack || '').trim() || null,
        notes: String(raw.notes || '').trim() || null,
      };

      valid.push({
        rowNum: rowNum,
        raw: raw,
        payload: payload,
        productDisplay: product.name_en + (product.name_ar ? ' / ' + product.name_ar : ''),
        warehouseName: warehouse.name,
      });
    });

    return { valid: valid, errors: errors };
  }

  // ── Commit ────────────────────────────────────────────────────────
  async function commitImport() {
    if (!parsedRows || !parsedRows.valid.length) return;
    setBusy(true);
    var inserted = 0;
    var failed = 0;
    var failedRows = [];
    var receiptNumbersAssigned = [];

    try {
      for (var i = 0; i < parsedRows.valid.length; i++) {
        var row = parsedRows.valid[i];
        try {
          // Get a fresh receipt number for THIS row (each legacy row = its own receipt)
          var rnRes = await supabase.rpc('generate_receipt_number', { p_date: row.payload.receipt_date });
          if (rnRes.error) throw rnRes.error;
          var receiptNumber = rnRes.data;

          var rowPayload = Object.assign({}, row.payload, {
            receipt_number: receiptNumber,
            created_by: userProfile && userProfile.id,
            updated_by: userProfile && userProfile.id,
          });
          await dbInsert('inventory_stock_receipts', rowPayload, userProfile && userProfile.id);
          inserted++;
          receiptNumbersAssigned.push(receiptNumber);
        } catch (err) {
          failed++;
          failedRows.push({ rowNum: row.rowNum, error: (err && err.message) || String(err) });
          break; // stop on first error per Max's call
        }
      }
      setImportResult({
        inserted: inserted,
        errors: parsedRows.errors.length,
        failed: failed,
        failedRows: failedRows,
        firstReceipt: receiptNumbersAssigned[0] || null,
        lastReceipt: receiptNumbersAssigned[receiptNumbersAssigned.length - 1] || null,
      });
      if (failed === 0) {
        toast.success('Imported ' + inserted + ' legacy stock receipt(s).');
        setParsedRows(null);
      } else {
        toast.error('Import stopped after ' + failed + ' DB error(s). ' + inserted + ' rows saved before the error.');
      }
    } catch (err) {
      console.error('[stock-import] catastrophic error:', err);
      toast.error('Import aborted: ' + ((err && err.message) || String(err)));
    } finally {
      setBusy(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────
  if (!canImport) {
    return (
      <div style={{ padding: 24 }}>
        <RestrictedNotice title="Access restricted" message={'Importing stock requires the "Edit Inventory" permission. Ask Max to grant it from Settings - Roles & Permissions.'} />
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
          <span style={{ fontSize: 24 }}>📦</span>
          <h2 className="text-xl font-extrabold text-slate-900">Import Stock</h2>
        </div>
        <div className="text-sm text-slate-700 font-medium mt-1">
          One-time bulk import of your existing inventory. Each row in the Excel file becomes one stock receipt with type = "legacy_import".
        </div>
        <div className="text-sm text-slate-700 font-medium" style={{ direction: 'rtl' }}>
          استيراد المخزون الحالي بالجملة لمرة واحدة. كل صف في ملف Excel يصبح إيصال مخزون مع النوع "استيراد قديم".
        </div>
      </div>

      {/* Helper banner */}
      <div className="bg-blue-50 border border-blue-300 rounded-lg p-3 mb-4 text-sm text-blue-900">
        <div className="font-extrabold mb-1">💡 When to use this vs. Inbound Shipments</div>
        <ul className="list-disc ml-5 space-y-1 text-blue-800">
          <li><span className="font-bold">Use this (Import Stock)</span> to bring legacy inventory — rolls that are already in your warehouses — into the new system in one go.</li>
          <li><span className="font-bold">Use Inbound Shipments (the other tab)</span> for new shipments arriving from now on, one shipment at a time.</li>
        </ul>
      </div>

      {/* Step 1 */}
      <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 mb-4">
        <div className="text-[11px] font-extrabold text-slate-700 tracking-wider mb-2">STEP 1 — DOWNLOAD TEMPLATE</div>
        <div className="text-sm text-slate-700 mb-3">
          The template includes a Products Reference sheet (your active products with quick codes) and a Warehouses Reference sheet so you know exactly what to type.
        </div>
        <button
          onClick={downloadTemplate}
          disabled={busy}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-extrabold rounded-lg shadow"
        >
          📥 Download Stock Import Template (.xlsx)
        </button>
        {!seeCosts && (
          <div className="text-xs text-amber-700 italic mt-2">
            Note: you don't have cost-view permission, so cost and currency columns are omitted from the template. Rows will save with cost = blank.
          </div>
        )}
      </div>

      {/* Step 2 */}
      <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 mb-4">
        <div className="text-[11px] font-extrabold text-slate-700 tracking-wider mb-2">STEP 2 — UPLOAD FILLED TEMPLATE</div>
        <div className="text-sm text-slate-700 mb-3">
          Every row is validated against your Product List and warehouses. You'll see a preview before anything is saved.
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
          <div className="grid grid-cols-2 gap-2 mb-4">
            <div className="bg-emerald-50 border border-emerald-300 rounded-lg p-3">
              <div className="text-[10px] font-extrabold text-emerald-700 tracking-wider">READY TO IMPORT</div>
              <div className="text-2xl font-extrabold text-emerald-900">{parsedRows.valid.length}</div>
              <div className="text-[10px] text-emerald-700">rows will create new receipts</div>
            </div>
            <div className="bg-red-50 border border-red-300 rounded-lg p-3">
              <div className="text-[10px] font-extrabold text-red-700 tracking-wider">ERRORS</div>
              <div className="text-2xl font-extrabold text-red-900">{parsedRows.errors.length}</div>
              <div className="text-[10px] text-red-700">rows will NOT be imported — fix and re-upload</div>
            </div>
          </div>

          {/* Errors */}
          {parsedRows.errors.length > 0 && (
            <div className="bg-red-50 border-2 border-red-300 rounded-lg p-3 mb-3">
              <div className="text-sm font-extrabold text-red-900 mb-2">❌ Errors ({parsedRows.errors.length})</div>
              <div className="space-y-1 max-h-64 overflow-auto">
                {parsedRows.errors.slice(0, 50).map(function (e, i) {
                  return (
                    <div key={i} className="text-xs text-red-900 font-mono bg-white rounded p-2 border border-red-200">
                      <span className="font-bold">Row {e.rowNum}</span>{e.raw.product_quick_code ? ' (' + e.raw.product_quick_code + ')' : ''}: {e.errors.join(' · ')}
                    </div>
                  );
                })}
                {parsedRows.errors.length > 50 && <div className="text-xs italic">... and {parsedRows.errors.length - 50} more errors</div>}
              </div>
            </div>
          )}

          {/* Valid rows */}
          {parsedRows.valid.length > 0 && (
            <details className="bg-emerald-50 border border-emerald-300 rounded-lg p-3 mb-3" open>
              <summary className="text-sm font-extrabold text-emerald-900 cursor-pointer">✓ Ready to import ({parsedRows.valid.length} rows)</summary>
              <div className="mt-2 space-y-1 max-h-72 overflow-auto">
                {parsedRows.valid.slice(0, 50).map(function (v, i) {
                  return (
                    <div key={i} className="text-xs bg-white rounded p-2 border border-emerald-200">
                      <span className="font-bold">Row {v.rowNum}:</span>{' '}
                      <span className="font-mono">{v.raw.product_quick_code}</span>{' · '}
                      <span className="font-semibold">{v.payload.quantity} {v.payload.uom || ''}</span>{' → '}
                      {v.warehouseName}{v.payload.rack ? ' (' + v.payload.rack + ')' : ''}
                      {v.payload.batch_number && <span className="text-slate-500"> · batch {v.payload.batch_number}</span>}
                      {seeCosts && v.payload.cost_per_uom != null && <span className="text-slate-500"> · {v.payload.cost_per_uom} {v.payload.currency || ''}</span>}
                    </div>
                  );
                })}
                {parsedRows.valid.length > 50 && <div className="text-xs italic">... and {parsedRows.valid.length - 50} more rows</div>}
              </div>
            </details>
          )}

          {/* Commit */}
          <div className="flex gap-2 mt-4">
            <button
              onClick={commitImport}
              disabled={busy || parsedRows.valid.length === 0}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-extrabold rounded-lg shadow"
            >
              {busy ? 'Importing...' : '✓ Commit Import (' + parsedRows.valid.length + ' rows)'}
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

      {/* Result after commit */}
      {importResult && (
        <div className="bg-emerald-50 border-2 border-emerald-400 rounded-xl p-4">
          <div className="text-base font-extrabold text-emerald-900 mb-2">✅ Import complete</div>
          <div className="text-sm text-slate-900 space-y-1">
            <div>• Inserted: <span className="font-extrabold text-emerald-700">{importResult.inserted}</span> legacy stock receipt(s)</div>
            {importResult.firstReceipt && (
              <div>• Receipt numbers: <span className="font-mono font-extrabold">{importResult.firstReceipt}</span>{importResult.firstReceipt !== importResult.lastReceipt ? <> through <span className="font-mono font-extrabold">{importResult.lastReceipt}</span></> : null}</div>
            )}
            <div>• Errors before import: <span className="font-extrabold text-red-700">{importResult.errors}</span> rows (fix and re-upload)</div>
            {importResult.failed > 0 && (
              <div className="mt-2 bg-red-50 border border-red-300 rounded p-2">
                <div className="font-extrabold text-red-900">⚠ Database errors on {importResult.failed} row(s) — import stopped:</div>
                {importResult.failedRows.map(function (f, i) {
                  return <div key={i} className="text-xs text-red-800 mt-1">Row {f.rowNum}: {f.error}</div>;
                })}
              </div>
            )}
            <div className="mt-2 text-xs text-slate-600 italic">View the imported receipts in the Inbound Shipments tab (filter by "Legacy" badge).</div>
          </div>
        </div>
      )}
    </div>
  );
}
