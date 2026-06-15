// inventory-report-defs.js — declarative, bilingual (EN/AR) Inventory report definitions.
// Each report declares its columns once (label_en/label_ar/align/format/total/valuation);
// the renderer (ReportTable.jsx) and the Report Center (InventoryReportCenter.jsx) read these
// so reports are data, not hard-coded screens. To add a report: add an entry here + a row
// builder in InventoryReportCenter. SWC-safe: var + string concat, no template literals.
//
// Column fields:
//   key        — property on the built row object
//   label_en   — English column header
//   label_ar   — Arabic column header
//   align      — 'left' | 'right' | 'center'  (numbers right)
//   format     — 'text' | 'number' | 'money' | 'percent' | 'date'
//   total      — 'sum' to show a column total in the footer (numbers only)
//   valuation  — true if this column shows cost/value (hidden as "Restricted"
//                unless the viewer has inventory.valuation.view)

var SNAPSHOT_COLUMNS = [
  { key: 'code', label_en: 'Code', label_ar: 'الكود', align: 'left', format: 'text' },
  { key: 'name', label_en: 'Product Name', label_ar: 'اسم المنتج', align: 'left', format: 'text' },
  { key: 'family', label_en: 'Family', label_ar: 'العائلة', align: 'left', format: 'text' },
  { key: 'category', label_en: 'Category', label_ar: 'الفئة', align: 'left', format: 'text' },
  { key: 'grade', label_en: 'Grade', label_ar: 'الدرجة', align: 'left', format: 'text' },
  { key: 'color', label_en: 'Color', label_ar: 'اللون', align: 'left', format: 'text' },
  { key: 'origin', label_en: 'Origin', label_ar: 'المنشأ', align: 'left', format: 'text' },
  { key: 'uom', label_en: 'UOM', label_ar: 'الوحدة', align: 'center', format: 'text' },
  { key: 'qty_remaining', label_en: 'Qty Remaining', label_ar: 'الكمية المتبقية', align: 'right', format: 'number', total: 'sum' },
  { key: 'warehouse', label_en: 'Warehouse', label_ar: 'المخزن', align: 'left', format: 'text' },
  { key: 'avg_cost', label_en: 'Avg Cost', label_ar: 'متوسط التكلفة', align: 'right', format: 'money', valuation: true },
  { key: 'total_value', label_en: 'Total Value', label_ar: 'القيمة الإجمالية', align: 'right', format: 'money', total: 'sum', valuation: true },
  { key: 'last_received', label_en: 'Last Received', label_ar: 'آخر استلام', align: 'center', format: 'date' }
];

var MIX_COLUMNS = [
  { key: 'component', label_en: 'Component', label_ar: 'المكوّن', align: 'left', format: 'text' },
  { key: 'color', label_en: 'Color', label_ar: 'اللون', align: 'left', format: 'text' },
  { key: 'available', label_en: 'Available Qty', label_ar: 'الكمية المتاحة', align: 'right', format: 'number', total: 'sum' },
  { key: 'pct', label_en: '% of Mix', label_ar: 'نسبة المزيج', align: 'right', format: 'percent' }
];

var REPORTS = [
  {
    id: 'snapshot',
    title_en: 'Inventory Snapshot',
    title_ar: 'جرد المخزون الحالي',
    desc_en: 'Current stock on hand by product, with classification and (if permitted) valuation.',
    desc_ar: 'المخزون الحالي لكل منتج مع التصنيف والقيمة (حسب الصلاحية).',
    permission: 'inventory.reports.view',
    grouped: false,
    columns: SNAPSHOT_COLUMNS
  },
  {
    id: 'virtual_mix',
    title_en: 'Stock Mix (Virtual) Composition',
    title_ar: 'تركيب المزيج الافتراضي',
    desc_en: 'What each virtual Stock Mix Lot is composed of, from real product stock. Composition only — never counted as physical stock.',
    desc_ar: 'مكوّنات كل مزيج افتراضي من مخزون المنتجات الحقيقية. عرض فقط — لا يُحتسب كمخزون فعلي.',
    permission: 'inventory.reports.view',
    grouped: true,
    columns: MIX_COLUMNS
  }
];

function getReport(id) {
  var i;
  for (i = 0; i < REPORTS.length; i++) { if (REPORTS[i].id === id) { return REPORTS[i]; } }
  return null;
}

export { REPORTS, SNAPSHOT_COLUMNS, MIX_COLUMNS, getReport };
