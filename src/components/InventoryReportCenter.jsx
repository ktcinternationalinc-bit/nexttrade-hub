// InventoryReportCenter.jsx — bilingual (EN/AR) Inventory Report Center.
// A reusable reporting engine driven by inventory-report-defs.js: pick a report, toggle
// language (English / Arabic RTL), filter, run, export to Excel (CSV), and print. MVP reports:
//   1. Inventory Snapshot  — current stock on hand by product (+ valuation if permitted)
//   2. Stock Mix (Virtual) — composition of each virtual mix from REAL product stock only
// Virtual mixes are reported as composition ONLY and never counted as physical stock.
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import ReportTable, { formatCell } from './ReportTable';
import { REPORTS, getReport, SNAPSHOT_COLUMNS, MIX_COLUMNS, MOVEMENT_COLUMNS } from '../lib/inventory-report-defs';

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

  var isRtl = lang === 'ar';
  var report = getReport(reportId);

  function load() {
    setLoading(true);
    Promise.all([
      supabase.from('inventory_products').select('id,name_en,name_ar,quick_code,design_sku,default_uom,family_list_id,category_list_id,grade_list_id,color_list_id,origin_list_id,is_virtual_mix,active').eq('active', true).then(function (x) { return x; }).catch(function () { return { data: [] }; }),
      supabase.from('inventory_layers').select('product_id,qty_remaining,cost_per_uom,warehouse_id,receipt_date').gt('qty_remaining', 0).then(function (x) { return x; }).catch(function () { return { data: [] }; }),
      supabase.from('inventory_lists').select('id,label_en,label_ar').then(function (x) { return x; }).catch(function () { return { data: [] }; }),
      supabase.from('inv_warehouses').select('id,name,code').then(function (x) { return x; }).catch(function () { return { data: [] }; }),
      supabase.from('inventory_stock_receipts').select('product_id,receipt_date').eq('status', 'finalized').then(function (x) { return x; }).catch(function () { return { data: [] }; }),
      supabase.from('inventory_mix_components').select('mix_product_id,component_product_id,component_color,sort_order,is_active').eq('is_active', true).then(function (x) { return x; }).catch(function () { return { data: [] }; }),
      supabase.from('inventory_movements').select('product_id,movement_type,movement_date,warehouse_id,quantity,reference_number,created_at').order('movement_date', { ascending: true }).limit(5000).then(function (x) { return x; }).catch(function () { return { data: [] }; })
    ]).then(function (res) {
      var products = (res[0] && res[0].data) || [];
      var layers = (res[1] && res[1].data) || [];
      var lists = (res[2] && res[2].data) || [];
      var whs = (res[3] && res[3].data) || [];
      var receipts = (res[4] && res[4].data) || [];
      var comps = (res[5] && res[5].data) || [];
      var movements = (res[6] && res[6].data) || [];

      var listMap = {}; lists.forEach(function (l) { listMap[l.id] = { en: l.label_en || '', ar: l.label_ar || '' }; });
      var whMap = {}; whs.forEach(function (w) { whMap[w.id] = w.name || w.code || ''; });
      var nameMap = {}; products.forEach(function (p) { nameMap[p.id] = p; });

      var layerAgg = {}; var availByProduct = {};
      layers.forEach(function (l) {
        var pid = l.product_id; if (!pid) { return; }
        if (!layerAgg[pid]) { layerAgg[pid] = { qty: 0, value: 0, whs: {} }; }
        var q = Number(l.qty_remaining) || 0;
        layerAgg[pid].qty += q;
        layerAgg[pid].value += q * (Number(l.cost_per_uom) || 0);
        if (l.warehouse_id && whMap[l.warehouse_id]) { layerAgg[pid].whs[whMap[l.warehouse_id]] = true; }
        availByProduct[pid] = (availByProduct[pid] || 0) + q;
      });

      var lastRecv = {};
      receipts.forEach(function (r) { var pid = r.product_id; if (!pid || !r.receipt_date) { return; } if (!lastRecv[pid] || r.receipt_date > lastRecv[pid]) { lastRecv[pid] = r.receipt_date; } });

      var compsByMix = {};
      comps.forEach(function (c) { if (!compsByMix[c.mix_product_id]) { compsByMix[c.mix_product_id] = []; } compsByMix[c.mix_product_id].push(c); });

      setRaw({
        nonVirtual: products.filter(function (p) { return p.is_virtual_mix !== true; }),
        mixes: products.filter(function (p) { return p.is_virtual_mix === true; }),
        listMap: listMap, whMap: whMap, nameMap: nameMap,
        layerAgg: layerAgg, availByProduct: availByProduct, lastRecv: lastRecv, compsByMix: compsByMix,
        movements: movements
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
        family: listLabel(p.family_list_id),
        category: listLabel(p.category_list_id),
        grade: listLabel(p.grade_list_id),
        color: listLabel(p.color_list_id),
        origin: listLabel(p.origin_list_id),
        uom: p.default_uom || '',
        qty_remaining: agg.qty,
        warehouse: whNames.length > 1 ? (isRtl ? 'متعدد' : 'Multiple') : (whNames[0] || ''),
        avg_cost: agg.qty > 0 ? (agg.value / agg.qty) : 0,
        total_value: agg.value,
        last_received: raw.lastRecv[p.id] || ''
      };
    });
    if (q) { rows = rows.filter(function (r) { return (String(r.code).toLowerCase().indexOf(q) >= 0) || (String(r.name).toLowerCase().indexOf(q) >= 0); }); }
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

  // Flat (non-grouped) reports share one row dispatcher.
  function flatRows() {
    if (reportId === 'movement') { return movementRows(); }
    return snapshotRows();
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
  function doExport() {
    if (!mayExport) { toast.error(isRtl ? 'لا تملك صلاحية التصدير' : 'You do not have export permission'); return; }
    var lines = [];
    if (!report.grouped) {
      var cols = report.columns;
      lines.push(cols.map(colHeader).map(csvEscape).join(','));
      flatRows().forEach(function (r) { lines.push(cols.map(function (c) { return csvEscape(cellExport(r, c)); }).join(',')); });
    } else {
      var mixHead = isRtl ? 'المزيج' : 'Mix';
      lines.push([csvEscape(mixHead)].concat(MIX_COLUMNS.map(colHeader).map(csvEscape)).join(','));
      mixSections().forEach(function (s) {
        s.rows.forEach(function (r) { lines.push([csvEscape(s.title)].concat(MIX_COLUMNS.map(function (c) { return csvEscape(cellExport(r, c)); })).join(',')); });
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
    var body = '';
    if (!report.grouped) {
      body = '<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr>' + th(report.columns) + '</tr></thead><tbody>' + flatRows().map(function (r) { return tr(r, report.columns); }).join('') + '</tbody></table>';
    } else {
      mixSections().forEach(function (s) {
        body += '<h3 style="margin:16px 0 4px">' + s.title + '</h3>';
        body += '<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr>' + th(MIX_COLUMNS) + '</tr></thead><tbody>' + s.rows.map(function (r) { return tr(r, MIX_COLUMNS); }).join('') + '</tbody></table>';
      });
    }
    var html = '<!doctype html><html dir="' + (isRtl ? 'rtl' : 'ltr') + '" lang="' + lang + '"><head><meta charset="utf-8"><title>' + title + '</title></head><body style="font-family:Arial,sans-serif;padding:16px"><h2>' + title + '</h2>' + body + '<script>window.onload=function(){window.print();}<\/script></body></html>';
    var w = window.open('', '_blank');
    if (!w) { toast.error(isRtl ? 'تعذر فتح نافذة الطباعة' : 'Could not open print window'); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }

  if (!mayView) {
    return <div className="p-4 text-sm bg-amber-50 border border-amber-200 rounded text-amber-900">You do not have permission to view inventory reports (inventory.reports.view).</div>;
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

      {!report.grouped && (
        <input value={search} onChange={function (e) { setSearch(e.target.value); }} placeholder={reportId === 'movement' ? (isRtl ? 'بحث بالمنتج أو المرجع' : 'Search product or reference') : (isRtl ? 'بحث بالكود أو الاسم' : 'Search code or name')} className="px-3 py-1.5 rounded border border-slate-300 text-sm w-full max-w-xs" />
      )}

      {loading ? (
        <div className="p-4 text-slate-400 italic text-sm">{isRtl ? 'جارٍ التحميل…' : 'Loading…'}</div>
      ) : !report.grouped ? (
        <ReportTable columns={report.columns} rows={flatRows()} lang={lang} showValuation={showValuation} />
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
