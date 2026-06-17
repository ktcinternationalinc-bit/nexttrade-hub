// InventoryReportCenter.jsx — bilingual (EN/AR) Inventory Report Center.
// A reusable reporting engine driven by inventory-report-defs.js: pick a report, toggle
// language (English / Arabic RTL), filter, run, export to Excel (CSV), and print. MVP reports:
//   1. Inventory Snapshot  — current stock on hand by product (+ valuation if permitted)
//   2. Stock Mix (Virtual) — composition of each virtual mix from REAL product stock only
// Virtual mixes are reported as composition ONLY and never counted as physical stock.
import { useState, useEffect } from 'react';
import RestrictedNotice from './RestrictedNotice';
import { supabase } from '../lib/supabase';
import ReportTable, { formatCell } from './ReportTable';
import { REPORTS, getReport, SNAPSHOT_COLUMNS, MIX_COLUMNS, MOVEMENT_COLUMNS } from '../lib/inventory-report-defs';
import { isCountableReceipt } from '../lib/inventory-receipts';

// Bilingual labels for inventory_movements.movement_type (data-driven, not inferred from text).
var MOVEMENT_TYPE_LABELS = {
  receipt: { en: 'Receipt', ar: 'استلام' },
  sale: { en: 'Sale', ar: 'بيع' },
  transfer_in: { en: 'Transfer In', ar: 'تحويل وارد' },
  transfer_out: { en: 'Transfer Out', ar: 'تحويل صادر' },
  adjustment_in: { en: 'Adjustment +', ar: 'تسوية +' },
  adjustment_out: { en: 'Adjustment −', ar: 'تسوية −' },
  reversal: { en: 'Reversal', ar: 'عكس' }
};
import { canViewInventoryReports, canExportInventoryReports, canSeeValuationInReports } from '../lib/inventory-permissions';

export default function InventoryReportCenter(props) {
  var userProfile = props.userProfile || null;
  var modulePerms = props.modulePerms || {};
  var toast = props.toast || { success: function () {}, error: function () {} };

  var mayView = canViewInventoryReports(userProfile, modulePerms);
  var mayExport = canExportInventoryReports(userProfile, modulePerms);
  var showValuation = canSeeValuationInReports(userProfile, modulePerms);

  var [reportId, setReportId] = useState('snapshot');
  var [lang, setLang] = useState('en');
  var [search, setSearch] = useState('');
  var [raw, setRaw] = useState(null);
  var [loading, setLoading] = useState(true);
  // v55.83-GW — surface load failures instead of silently showing an empty report.
  var [loadErrors, setLoadErrors] = useState([]);   // [{source, message}]
  var [diag, setDiag] = useState(null);             // counts for super-admin diagnostic
  // v55.83-GY/HD — match Inventory Overview's default view. Overview DELIBERATELY shows
  // zero-stock rows by default (Max, Jun 1 2026), so the Snapshot defaults to showing them
  // too (Codex QA: the earlier hide-by-default did NOT match Overview). Toggle hides them.
  var [showZero, setShowZero] = useState(true);
  var isSuperAdmin = !!(userProfile && userProfile.role === 'super_admin');

  var isRtl = lang === 'ar';
  var report = getReport(reportId);

  // v55.83-GW — wrap a Supabase query so a failure (missing column, RLS denial,
  // missing table) is CAPTURED and reported, not silently turned into empty data.
  // Each entry resolves to { source, data, error } — never rejects.
  function q(source, builder) {
    return builder.then(function (x) {
      return { source: source, data: (x && x.data) || [], error: x && x.error ? (x.error.message || String(x.error)) : null };
    }).catch(function (e) {
      return { source: source, data: [], error: (e && e.message) || String(e) };
    });
  }

  function load() {
    setLoading(true);
    setLoadErrors([]);
    Promise.all([
      q('inventory_products', supabase.from('inventory_products').select('id,name_en,name_ar,quick_code,design_sku,default_uom,family_list_id,category_list_id,grade_list_id,color_list_id,origin_list_id,is_virtual_mix,is_family_template,active').eq('active', true)),
      q('inventory_layers', supabase.from('inventory_layers').select('product_id,qty_remaining,cost_per_uom,warehouse_id,receipt_date').gt('qty_remaining', 0)),
      q('inventory_lists', supabase.from('inventory_lists').select('id,label_en,label_ar')),
      q('inv_warehouses', supabase.from('inv_warehouses').select('id,name,code')),
      q('inventory_stock_receipts', supabase.from('inventory_stock_receipts').select('product_id,receipt_date,quantity,quantity_kg,roll_count,uom,status')),
      q('inventory_mix_components', supabase.from('inventory_mix_components').select('mix_product_id,component_product_id,component_color,sort_order,is_active').eq('is_active', true)),
      q('inventory_movements', supabase.from('inventory_movements').select('product_id,movement_type,movement_date,warehouse_id,quantity,reference_number,created_at').order('movement_date', { ascending: true }).limit(5000))
    ]).then(function (res) {
      var products = res[0].data;
      var layers = res[1].data;
      var lists = res[2].data;
      var whs = res[3].data;
      var receipts = res[4].data;
      var comps = res[5].data;
      var movements = res[6].data;

      // Collect any per-table errors so the UI can show exactly what failed.
      var errs = [];
      res.forEach(function (r) { if (r.error) { errs.push({ source: r.source, message: r.error }); } });
      setLoadErrors(errs);

      var listMap = {}; lists.forEach(function (l) { listMap[l.id] = { en: l.label_en || '', ar: l.label_ar || '' }; });
      var whMap = {}; whs.forEach(function (w) { whMap[w.id] = w.name || w.code || ''; });
      var nameMap = {}; products.forEach(function (p) { nameMap[p.id] = p; });

      // Finalized cost layers — value/warehouse + finalized on-hand qty.
      var layerAgg = {};
      layers.forEach(function (l) {
        var pid = l.product_id; if (!pid) { return; }
        if (!layerAgg[pid]) { layerAgg[pid] = { qty: 0, value: 0, whs: {} }; }
        var q = Number(l.qty_remaining) || 0;
        layerAgg[pid].qty += q;
        layerAgg[pid].value += q * (Number(l.cost_per_uom) || 0);
        if (l.warehouse_id && whMap[l.warehouse_id]) { layerAgg[pid].whs[whMap[l.warehouse_id]] = true; }
      });

      // v55.83-GX — receipts aggregated EXACTLY like InventoryOverview so the report
      // reconciles with it:
      //   - skip cancelled / pending_detail / merged / reversed (as good as deleted)
      //   - original/received qty = sum of valid receipt.quantity (all valid statuses)
      //   - non-finalized valid receipts ("active"/"received") count as PENDING on-hand
      //     and are added into Current Qty (Overview shows them immediately, yellow)
      //   - primary received UOM = the UOM with the largest received qty (source of truth)
      var lastRecv = {}; var origByProduct = {}; var pendingByProduct = {};
      var recvUomByProduct = {}; var validReceiptCount = 0;
      receipts.forEach(function (r) {
        var pid = r.product_id; if (!pid) { return; }
        if (!isCountableReceipt(r)) { return; } // v55.83-IH — shared status filter (was inline; kept in sync with Overview)
        validReceiptCount += 1;
        var qv = Number(r.quantity) || 0;
        origByProduct[pid] = (origByProduct[pid] || 0) + qv;
        var uom = (r.uom || 'unit').toLowerCase();
        if (!recvUomByProduct[pid]) { recvUomByProduct[pid] = {}; }
        recvUomByProduct[pid][uom] = (recvUomByProduct[pid][uom] || 0) + qv;
        if (r.status !== 'finalized') { pendingByProduct[pid] = (pendingByProduct[pid] || 0) + qv; }
        if (r.receipt_date && (!lastRecv[pid] || r.receipt_date > lastRecv[pid])) { lastRecv[pid] = r.receipt_date; }
      });

      // Current on-hand = finalized layer qty + pending (received-but-not-finalized) qty.
      // This matches Overview's current_qty. availByProduct (used by mix composition) uses
      // the same on-hand figure so component availability agrees with the rest of the app.
      var currentByProduct = {};
      products.forEach(function (p) {
        var fin = (layerAgg[p.id] && layerAgg[p.id].qty) || 0;
        var pend = pendingByProduct[p.id] || 0;
        currentByProduct[p.id] = fin + pend;
      });
      var availByProduct = currentByProduct;

      // Primary received UOM per product (largest received qty wins).
      var recvUomPrimary = {};
      Object.keys(recvUomByProduct).forEach(function (pid) {
        var best = ''; var bestQ = -1; var m = recvUomByProduct[pid];
        Object.keys(m).forEach(function (u) { if (m[u] > bestQ) { bestQ = m[u]; best = u; } });
        recvUomPrimary[pid] = best;
      });

      setDiag({
        products: products.length, layers: layers.length, lists: lists.length,
        warehouses: whs.length, receiptsLoaded: receipts.length, receiptsValid: validReceiptCount,
        mixComponents: comps.length, movements: movements.length, errors: errs.length
      });

      var compsByMix = {};
      comps.forEach(function (c) { if (!compsByMix[c.mix_product_id]) { compsByMix[c.mix_product_id] = []; } compsByMix[c.mix_product_id].push(c); });

      setRaw({
        // Snapshot excludes virtual mixes AND family templates (no physical stock) —
        // same exclusions Inventory Overview applies.
        nonVirtual: products.filter(function (p) { return p.is_virtual_mix !== true && p.is_family_template !== true; }),
        mixes: products.filter(function (p) { return p.is_virtual_mix === true; }),
        listMap: listMap, whMap: whMap, nameMap: nameMap,
        layerAgg: layerAgg, availByProduct: availByProduct, currentByProduct: currentByProduct,
        lastRecv: lastRecv, origByProduct: origByProduct, recvUomPrimary: recvUomPrimary,
        compsByMix: compsByMix, movements: movements
      });
    }).catch(function (e) { console.error('[inv-reports] load', e); toast.error('Failed to load inventory data'); })
      .finally(function () { setLoading(false); });
  }
  useEffect(function () { if (mayView) { load(); } else { setLoading(false); } }, []);

  function pname(p) { if (!p) { return ''; } return isRtl ? (p.name_ar || p.name_en || '') : (p.name_en || p.name_ar || ''); }
  function listLabel(id) { var l = raw && raw.listMap[id]; if (!l) { return ''; } return isRtl ? (l.ar || l.en || '') : (l.en || l.ar || ''); }

  function snapshotRows() {
    if (!raw) { return []; }
    var q = (search || '').trim().toLowerCase();
    var rows = raw.nonVirtual.map(function (p) {
      var agg = raw.layerAgg[p.id] || { qty: 0, value: 0, whs: {} };
      var whNames = Object.keys(agg.whs);
      return {
        code: p.quick_code || p.design_sku || '',
        name: pname(p),
        name_en: p.name_en || '',
        name_ar: p.name_ar || '',
        family: listLabel(p.family_list_id),
        category: listLabel(p.category_list_id),
        grade: listLabel(p.grade_list_id),
        color: listLabel(p.color_list_id),
        origin: listLabel(p.origin_list_id),
        uom: (raw.recvUomPrimary && raw.recvUomPrimary[p.id]) || p.default_uom || 'unit',
        qty_remaining: Number(raw.currentByProduct[p.id]) || 0,
        original_qty: Number(raw.origByProduct[p.id]) || 0,
        warehouse: whNames.length > 1 ? (isRtl ? 'متعدد' : 'Multiple') : (whNames[0] || ''),
        avg_cost: agg.qty > 0 ? (agg.value / agg.qty) : 0,
        total_value: agg.value,
        last_received: raw.lastRecv[p.id] || ''
      };
    });
    if (q) { rows = rows.filter(function (r) { return (String(r.code).toLowerCase().indexOf(q) >= 0) || (String(r.name_en).toLowerCase().indexOf(q) >= 0) || (String(r.name_ar).toLowerCase().indexOf(q) >= 0); }); }
    // v55.83-GY — hide zero-stock rows by default (current 0 AND received 0), matching Overview.
    if (!showZero) { rows = rows.filter(function (r) { return (Number(r.qty_remaining) || 0) !== 0 || (Number(r.original_qty) || 0) !== 0; }); }
    rows.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
    return rows;
  }

  function mixSections() {
    if (!raw) { return []; }
    return raw.mixes.map(function (mix) {
      var comps = (raw.compsByMix[mix.id] || []).slice().sort(function (a, b) { return (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0); });
      var total = 0;
      comps.forEach(function (c) { total += (Number(raw.availByProduct[c.component_product_id]) || 0); });
      var rows = comps.map(function (c) {
        var avail = Number(raw.availByProduct[c.component_product_id]) || 0;
        return {
          component: pname(raw.nameMap[c.component_product_id]) || c.component_color || '',
          color: c.component_color || '',
          available: avail,
          pct: total > 0 ? (avail / total * 100) : 0
        };
      });
      return { id: mix.id, title: pname(mix) || mix.quick_code || '', rows: rows, total: total };
    });
  }

  function movementRows() {
    if (!raw || !raw.movements) { return []; }
    var q = (search || '').trim().toLowerCase();
    // Chronological per product so the running balance accumulates correctly.
    var sorted = raw.movements.slice().sort(function (a, b) {
      if (a.product_id !== b.product_id) { return String(a.product_id || '').localeCompare(String(b.product_id || '')); }
      var ad = (a.movement_date || '') + '|' + (a.created_at || '');
      var bd = (b.movement_date || '') + '|' + (b.created_at || '');
      return ad < bd ? -1 : ad > bd ? 1 : 0;
    });
    var running = {};
    var rows = sorted.map(function (m) {
      var pid = m.product_id;
      var qty = Number(m.quantity) || 0;       // signed: + in, − out
      running[pid] = (running[pid] || 0) + qty;
      var tm = MOVEMENT_TYPE_LABELS[m.movement_type] || { en: m.movement_type || '', ar: m.movement_type || '' };
      var prod = raw.nameMap[pid];
      return {
        _sort: (m.movement_date || '') + '|' + (m.created_at || ''),
        date: m.movement_date || '',
        product: pname(prod) || (prod && prod.quick_code) || '',
        type: isRtl ? tm.ar : tm.en,
        qty_in: qty > 0 ? qty : 0,
        qty_out: qty < 0 ? -qty : 0,
        balance_after: running[pid],
        warehouse: (m.warehouse_id && raw.whMap[m.warehouse_id]) || '',
        reference: m.reference_number || ''
      };
    });
    if (q) { rows = rows.filter(function (r) { return String(r.product).toLowerCase().indexOf(q) >= 0 || String(r.reference).toLowerCase().indexOf(q) >= 0; }); }
    // Display newest first (balance_after was already computed in chronological order).
    rows.sort(function (a, b) { return a._sort < b._sort ? 1 : a._sort > b._sort ? -1 : 0; });
    return rows;
  }

  // v55.83-IK — valuation double-gate (defense-in-depth). The display/export
  // paths already MASK valuation columns as "Restricted" when !showValuation,
  // but the real cost/value numbers (avg_cost, total_value) still rode along in
  // the row objects — visible via React props, serialized payloads, or memory.
  // Strip those keys at the single row chokepoint so the actual numbers never
  // leave this function when the viewer lacks inventory.valuation.view. Display
  // is unchanged: the masking checks the column's `valuation` flag, not the value.
  function stripValuation(rows, cols) {
    if (showValuation) { return rows; }
    var valKeys = (cols || []).filter(function (c) { return c.valuation; }).map(function (c) { return c.key; });
    if (!valKeys.length) { return rows; }
    return (rows || []).map(function (r) {
      var copy = Object.assign({}, r);
      valKeys.forEach(function (k) { copy[k] = null; });
      return copy;
    });
  }

  // Flat (non-grouped) reports share one row dispatcher.
  function flatRows() {
    var rows = (reportId === 'movement') ? movementRows() : snapshotRows();
    return stripValuation(rows, report && report.columns);
  }

  // ---- Export (CSV, Excel-readable, UTF-8 BOM so Arabic renders) ----
  function csvEscape(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }
  function colHeader(c) { return isRtl ? c.label_ar : c.label_en; }
  function cellExport(r, c) {
    if (c.valuation && !showValuation) { return isRtl ? 'مقيّد' : 'Restricted'; }
    var v = r[c.key];
    if (c.format === 'percent') { var p = Number(v); return isFinite(p) ? (p.toFixed(1) + '%') : ''; }
    return v == null ? '' : v;
  }
  function download(name, csv) {
    var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }
  // v55.83-HC — column totals for total:'sum' columns, mirroring ReportTable (and respecting
  // valuation gating) so PRINT and EXPORT carry the same totals row the screen shows.
  function flatTotals(rows, cols) {
    var totals = {};
    cols.forEach(function (c) {
      if (c.total === 'sum' && !(c.valuation && !showValuation)) {
        var s = 0, any = false;
        rows.forEach(function (r) { var n = Number(r[c.key]); if (isFinite(n)) { s += n; any = true; } });
        if (any) { totals[c.key] = s; }
      }
    });
    return totals;
  }
  function doExport() {
    if (!mayExport) { toast.error(isRtl ? 'لا تملك صلاحية التصدير' : 'You do not have export permission'); return; }
    var lines = [];
    if (!report.grouped) {
      var cols = report.columns;
      var rows = flatRows();
      lines.push(cols.map(colHeader).map(csvEscape).join(','));
      rows.forEach(function (r) { lines.push(cols.map(function (c) { return csvEscape(cellExport(r, c)); }).join(',')); });
      var totals = flatTotals(rows, cols);
      if (Object.keys(totals).length) {
        lines.push(cols.map(function (c, ci) {
          if (totals[c.key] !== undefined) { return csvEscape(totals[c.key]); }
          return csvEscape(ci === 0 ? (isRtl ? 'الإجمالي' : 'Total') : '');
        }).join(','));
      }
    } else {
      var mixHead = isRtl ? 'المزيج' : 'Mix';
      lines.push([csvEscape(mixHead)].concat(MIX_COLUMNS.map(colHeader).map(csvEscape)).join(','));
      mixSections().forEach(function (s) {
        s.rows.forEach(function (r) { lines.push([csvEscape(s.title)].concat(MIX_COLUMNS.map(function (c) { return csvEscape(cellExport(r, c)); })).join(',')); });
        // v55.83-HE (Codex QA FAIL fix) — per-section totals row, so grouped Stock Mix CSV
        // matches the on-screen "Total available". Mirrors flat-report totals.
        var st = flatTotals(s.rows, MIX_COLUMNS);
        if (Object.keys(st).length) {
          lines.push([csvEscape(s.title)].concat(MIX_COLUMNS.map(function (c, ci) {
            if (st[c.key] !== undefined) { return csvEscape(st[c.key]); }
            return csvEscape(ci === 0 ? (isRtl ? 'الإجمالي' : 'Total') : '');
          })).join(','));
        }
      });
    }
    download(reportId + '-' + lang + '.csv', lines.join('\n'));
    toast.success(isRtl ? 'تم التصدير' : 'Exported');
  }

  // ---- Print (own window, keeps Arabic/RTL clean) ----
  function printReport() {
    var title = isRtl ? report.title_ar : report.title_en;
    function th(cols) { return cols.map(function (c) { return '<th style="text-align:' + (c.align || 'left') + ';padding:4px 8px;border-bottom:2px solid #333">' + colHeader(c) + '</th>'; }).join(''); }
    function tr(r, cols) { return '<tr>' + cols.map(function (c) { return '<td style="text-align:' + (c.align || 'left') + ';padding:3px 8px;border-bottom:1px solid #ccc">' + formatCell(r[c.key], c, lang, showValuation) + '</td>'; }).join('') + '</tr>'; }
    // v55.83-HC — totals row for print, matching the on-screen and CSV totals.
    function tfoot(rows, cols) {
      var totals = flatTotals(rows, cols);
      if (!Object.keys(totals).length) { return ''; }
      return '<tfoot><tr style="font-weight:bold;background:#e2e8f0">' + cols.map(function (c, ci) {
        var cell = totals[c.key] !== undefined ? (Number(totals[c.key]) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : (ci === 0 ? (isRtl ? 'الإجمالي' : 'Total') : '');
        return '<td style="text-align:' + (c.align || 'left') + ';padding:4px 8px;border-top:2px solid #333">' + cell + '</td>';
      }).join('') + '</tr></tfoot>';
    }
    var body = '';
    if (!report.grouped) {
      var flatR = flatRows();
      body = '<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr>' + th(report.columns) + '</tr></thead><tbody>' + flatR.map(function (r) { return tr(r, report.columns); }).join('') + '</tbody>' + tfoot(flatR, report.columns) + '</table>';
    } else {
      mixSections().forEach(function (s) {
        body += '<h3 style="margin:16px 0 4px">' + s.title + '</h3>';
        // v55.83-HE (Codex QA FAIL fix) — per-section totals row in grouped print too.
        body += '<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr>' + th(MIX_COLUMNS) + '</tr></thead><tbody>' + s.rows.map(function (r) { return tr(r, MIX_COLUMNS); }).join('') + '</tbody>' + tfoot(s.rows, MIX_COLUMNS) + '</table>';
      });
    }
    var html = '<!doctype html><html dir="' + (isRtl ? 'rtl' : 'ltr') + '" lang="' + lang + '"><head><meta charset="utf-8"><title>' + title + '</title></head><body style="font-family:Arial,sans-serif;padding:16px"><h2>' + title + '</h2>' + body + '<script>window.onload=function(){window.print();}<\/script></body></html>';
    var w = window.open('', '_blank');
    if (!w) { toast.error(isRtl ? 'تعذر فتح نافذة الطباعة' : 'Could not open print window'); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }

  if (!mayView) {
    return <div className="p-4"><RestrictedNotice title="Access restricted" message="You do not have permission to view inventory reports (inventory.reports.view)." /></div>;
  }

  var btn = 'px-3 py-1.5 rounded text-xs font-bold border';
  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-slate-700">{isRtl ? 'التقرير:' : 'Report:'}</span>
        {REPORTS.map(function (rep) {
          return <button key={rep.id} onClick={function () { setReportId(rep.id); }} className={btn + ' ' + (reportId === rep.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-300')}>{isRtl ? rep.title_ar : rep.title_en}</button>;
        })}
        <span className="mx-1 text-slate-300">|</span>
        <button onClick={function () { setLang('en'); }} className={btn + ' ' + (lang === 'en' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-700 border-slate-300')}>English</button>
        <button onClick={function () { setLang('ar'); }} className={btn + ' ' + (lang === 'ar' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-700 border-slate-300')}>العربية</button>
        <span className="flex-1" />
        {mayExport && <button onClick={doExport} className={btn + ' bg-emerald-600 text-white border-emerald-600'}>{isRtl ? 'تصدير Excel' : 'Export Excel'}</button>}
        <button onClick={printReport} className={btn + ' bg-slate-600 text-white border-slate-600'}>{isRtl ? 'طباعة' : 'Print'}</button>
        <button onClick={load} className={btn + ' bg-white text-slate-700 border-slate-300'}>{isRtl ? 'تحديث' : 'Refresh'}</button>
      </div>

      {report && <div className="text-xs text-slate-500">{isRtl ? report.desc_ar : report.desc_en}</div>}

      {/* v55.83-GW — surface real load failures (missing table/column, RLS) instead of
          silently rendering an empty report. */}
      {loadErrors.length > 0 && (
        <div className="p-3 rounded border border-red-300 bg-red-50 text-red-800 text-xs">
          <div className="font-bold mb-1">{isRtl ? 'تعذّر تحميل بعض بيانات المخزون — التقرير قد يكون ناقصًا:' : 'Some inventory data failed to load — this report may be incomplete:'}</div>
          <ul className="list-disc ml-5 space-y-0.5">
            {loadErrors.map(function (er, i) { return <li key={i}><span className="font-mono font-bold">{er.source}</span>: {er.message}</li>; })}
          </ul>
          <div className="mt-1 text-[11px] text-red-700">{isRtl ? 'هذا غالبًا عمود/جدول مفقود في قاعدة البيانات. أبلغ المسؤول.' : 'This usually means a missing DB column/table. Report this to your administrator.'}</div>
        </div>
      )}

      {/* v55.83-GX/GY — non-blocking warning: products exist but there are NO finalized cost
          layers. Current Qty is NOT necessarily 0 here — received-but-not-finalized (pending)
          stock is included in Current Qty but has no cost/valuation yet. The two messages below
          distinguish "pending stock, no cost" from "nothing received". */}
      {!loading && loadErrors.length === 0 && reportId === 'snapshot' && diag && diag.products > 0 && diag.layers === 0 && (
        <div className="p-3 rounded border border-amber-300 bg-amber-50 text-amber-900 text-xs">
          {diag.receiptsValid > 0
            ? (isRtl ? 'لا توجد طبقات تكلفة موجبة (مُرحَّلة) — الكمية الحالية تعكس مخزونًا مُستلَمًا لكنه لم يُرحَّل بعد، وبلا تكلفة/قيمة حتى الترحيل.' : 'No positive (finalized) cost layers — Current Qty reflects received-but-not-finalized stock, which has no cost/valuation until it is finalized into cost layers.')
            : (isRtl ? 'توجد منتجات لكن لا يوجد مخزون مُستلَم بعد — الكمية الحالية ستظهر صفرًا.' : 'Products exist, but no stock has been received yet — Current Qty will show 0.')}
        </div>
      )}

      {/* Super-admin diagnostic — how many rows each source returned, so an empty report
          can be told apart from a broken query. */}
      {isSuperAdmin && diag && !loading && (
        <details className="text-[11px] text-slate-500">
          <summary className="cursor-pointer font-bold">{isRtl ? 'تشخيص (مسؤول)' : 'Diagnostics (super-admin)'}</summary>
          <div className="mt-1 font-mono">
            products: {diag.products} · layers(qty&gt;0): {diag.layers} · receipts(loaded): {diag.receiptsLoaded} · receipts(valid): {diag.receiptsValid} · movements: {diag.movements} · mixComponents: {diag.mixComponents} · lists: {diag.lists} · warehouses: {diag.warehouses} · errors: {diag.errors}
          </div>
        </details>
      )}

      {!report.grouped && (
        <div className="flex flex-wrap items-center gap-3">
          <input value={search} onChange={function (e) { setSearch(e.target.value); }} placeholder={reportId === 'movement' ? (isRtl ? 'بحث بالمنتج أو المرجع' : 'Search product or reference') : (isRtl ? 'بحث بالكود أو الاسم' : 'Search code or name')} className="px-3 py-1.5 rounded border border-slate-300 text-sm w-full max-w-xs" />
          {reportId === 'snapshot' && (
            <label className="flex items-center gap-1.5 text-xs text-slate-600 font-semibold cursor-pointer">
              <input type="checkbox" checked={showZero} onChange={function (e) { setShowZero(e.target.checked); }} />
              {isRtl ? 'إظهار العناصر صفرية المخزون' : 'Show zero-stock items'}
            </label>
          )}
        </div>
      )}

      {loading ? (
        <div className="p-4 text-slate-400 italic text-sm">{isRtl ? 'جارٍ التحميل…' : 'Loading…'}</div>
      ) : !report.grouped ? (
        (function () {
          var rows = flatRows();
          if (rows.length > 0) {
            return <ReportTable columns={report.columns} rows={rows} lang={lang} showValuation={showValuation} />;
          }
          // v55.83-GW — distinguish WHY a snapshot is empty instead of always "No data".
          var hasProducts = raw && raw.nonVirtual && raw.nonVirtual.length > 0;
          var hasLayers = diag && diag.layers > 0;
          var hasReceipts = diag && diag.receiptsValid > 0;
          var msg;
          if (loadErrors.length > 0) {
            msg = isRtl ? 'تعذّر تحميل البيانات (انظر الخطأ أعلاه).' : 'Inventory data could not be loaded (see the error above).';
          } else if (reportId === 'movement') {
            msg = isRtl ? 'لا توجد حركات مخزون مسجّلة.' : 'No inventory movements recorded yet.';
          } else if (search && search.trim()) {
            msg = isRtl ? 'لا توجد نتائج مطابقة لبحثك.' : 'No products match your search.';
          } else if (!hasProducts) {
            msg = isRtl ? 'لا توجد منتجات مفعّلة.' : 'No active products found.';
          } else if (!hasLayers && hasReceipts) {
            msg = isRtl ? 'توجد منتجات وإيصالات استلام، لكن لا توجد طبقات تكلفة موجبة — قد يكون المخزون مستلَمًا ولم يُرحَّل إلى طبقات بعد.' : 'Products and stock receipts exist, but no positive cost layers were found — stock may have been received but not yet finalized into cost layers.';
          } else if (!hasLayers) {
            msg = isRtl ? 'توجد منتجات لكن لا توجد كميات مخزون موجبة.' : 'Products exist, but no positive inventory layers (qty on hand) were found.';
          } else {
            msg = isRtl ? 'لا توجد بيانات.' : 'No data.';
          }
          return <div className="p-4 text-slate-500 text-sm bg-slate-50 border border-slate-200 rounded">{msg}</div>;
        })()
      ) : (
        <div className="space-y-4">
          {mixSections().length === 0 ? (
            <div className="p-4 text-slate-400 italic text-sm">{isRtl ? 'لا توجد مزائج افتراضية' : 'No virtual mixes defined'}</div>
          ) : mixSections().map(function (s) {
            return (
              <div key={s.id}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-bold text-slate-800">{s.title}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 font-bold">{isRtl ? 'افتراضي — عرض فقط' : 'Virtual — composition only'}</span>
                  <span className="text-xs text-slate-500">{(isRtl ? 'إجمالي الكمية المتاحة: ' : 'Total available: ') + (Number(s.total) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                </div>
                <ReportTable columns={MIX_COLUMNS} rows={s.rows} lang={lang} showValuation={showValuation} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
