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

// v55.83-GX — explicit EN + AR name columns (per QA) and Original/Received Qty so the
// snapshot reconciles with Inventory Overview (Current = layers, Original = receipts).
var SNAPSHOT_COLUMNS = [
  { key: 'code', label_en: 'Code', label_ar: 'الكود', align: 'left', format: 'text' },
  { key: 'name_en', label_en: 'Name (EN)', label_ar: 'الاسم (إنجليزي)', align: 'left', format: 'text' },
  { key: 'name_ar', label_en: 'Name (AR)', label_ar: 'الاسم (عربي)', align: 'left', format: 'text' },
  { key: 'family', label_en: 'Family', label_ar: 'العائلة', align: 'left', format: 'text' },
  { key: 'category', label_en: 'Category', label_ar: 'الفئة', align: 'left', format: 'text' },
  { key: 'grade', label_en: 'Grade', label_ar: 'الدرجة', align: 'left', format: 'text' },
  { key: 'color', label_en: 'Color', label_ar: 'اللون', align: 'left', format: 'text' },
  { key: 'origin', label_en: 'Origin', label_ar: 'المنشأ', align: 'left', format: 'text' },
  { key: 'uom', label_en: 'UOM', label_ar: 'الوحدة', align: 'center', format: 'text' },
  { key: 'qty_remaining', label_en: 'Current Qty', label_ar: 'الكمية الحالية', align: 'right', format: 'number', total: 'sum' },
  { key: 'original_qty', label_en: 'Received Qty', label_ar: 'الكمية المستلمة', align: 'right', format: 'number', total: 'sum' },
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

var MOVEMENT_COLUMNS = [
  { key: 'date', label_en: 'Date', label_ar: 'التاريخ', align: 'center', format: 'date' },
  { key: 'product', label_en: 'Product', label_ar: 'المنتج', align: 'left', format: 'text' },
  { key: 'type', label_en: 'Movement', label_ar: 'الحركة', align: 'left', format: 'text' },
  { key: 'qty_in', label_en: 'Qty In', label_ar: 'وارد', align: 'right', format: 'number', total: 'sum' },
  { key: 'qty_out', label_en: 'Qty Out', label_ar: 'صادر', align: 'right', format: 'number', total: 'sum' },
  { key: 'balance_after', label_en: 'Balance After', label_ar: 'الرصيد بعد', align: 'right', format: 'number' },
  { key: 'warehouse', label_en: 'Warehouse', label_ar: 'المخزن', align: 'left', format: 'text' },
  { key: 'reference', label_en: 'Reference', label_ar: 'المرجع', align: 'left', format: 'text' }
];


// v55.83-NF (Max Aug 12 2026) — "I NEED THE INVENTORY REPORT TO SHOW THE ORIGINAL
// QTY, AMOUNT RECEIVED AND AMOUNT SOLD.. AVG PRICE OF SALE ... WITH THE AVG COST
// PNL ETC... SHOW WHEN NUMBERS ARE AVAILABLE FOR THE PNL. OTHERWISE KEEP 0. ALSO
// SHOULD HAVE A CUSTOMER COPY WITHOUT PNL NUMBERS AND ALSO A COPY TO CONSOLIDATE
// ALL OF THE STOCK AS ONE NUMBER AND LUX AS ONE NUMBER ETC."
//
// Three reports share one row builder. pnl flags P&L-only columns (the
// customer copy drops them entirely — not masked, REMOVED, so they never ride
// along in a customer export). valuation keeps the existing permission gate.
//
// "Original" = all valid receipts ever; "Received" = the same figure in the
// Original column + a separate RECEIVED ROLLS column, because Max's rolls are a
// general count. "Sold" + revenue/COGS/profit come from invoice_items where
// uses_inventory=true (post-MX). Rows with no sales keep 0 (Max: "otherwise
// keep 0") — zero is a number the reader can trust, blank is ambiguous.
var FULL_PNL_COLUMNS = [
  { key: 'code', label_en: 'Code', label_ar: 'الكود', align: 'left', format: 'text' },
  { key: 'name_en', label_en: 'Name (EN)', label_ar: 'الاسم (إنجليزي)', align: 'left', format: 'text' },
  { key: 'name_ar', label_en: 'Name (AR)', label_ar: 'الاسم (عربي)', align: 'left', format: 'text' },
  { key: 'family', label_en: 'Family', label_ar: 'العائلة', align: 'left', format: 'text' },
  { key: 'color', label_en: 'Color', label_ar: 'اللون', align: 'left', format: 'text' },
  { key: 'uom', label_en: 'UOM', label_ar: 'الوحدة', align: 'center', format: 'text' },
  { key: 'original_qty', label_en: 'Original Qty', label_ar: 'الكمية الأصلية', align: 'right', format: 'number', total: 'sum' },
  { key: 'recv_rolls', label_en: 'Rolls Rcvd', label_ar: 'لفات مستلمة', align: 'right', format: 'number', total: 'sum' },
  { key: 'sold_qty', label_en: 'Sold Qty', label_ar: 'الكمية المباعة', align: 'right', format: 'number', total: 'sum' },
  { key: 'sold_rolls', label_en: 'Rolls Sold', label_ar: 'لفات مباعة', align: 'right', format: 'number', total: 'sum' },
  { key: 'qty_remaining', label_en: 'On Hand', label_ar: 'المتبقي', align: 'right', format: 'number', total: 'sum' },
  { key: 'avg_sale_price', label_en: 'Avg Sale Price', label_ar: 'متوسط سعر البيع', align: 'right', format: 'money', pnl: true },
  { key: 'revenue', label_en: 'Revenue', label_ar: 'الإيراد', align: 'right', format: 'money', total: 'sum', pnl: true },
  { key: 'avg_cost', label_en: 'Avg Cost', label_ar: 'متوسط التكلفة', align: 'right', format: 'money', valuation: true, pnl: true },
  { key: 'cogs', label_en: 'COGS', label_ar: 'تكلفة المبيعات', align: 'right', format: 'money', total: 'sum', valuation: true, pnl: true },
  { key: 'gross_profit', label_en: 'Gross Profit', label_ar: 'إجمالي الربح', align: 'right', format: 'money', total: 'sum', valuation: true, pnl: true },
  { key: 'margin_pct', label_en: 'Margin %', label_ar: 'الهامش %', align: 'right', format: 'percent', valuation: true, pnl: true },
  { key: 'stock_value', label_en: 'Stock Value', label_ar: 'قيمة المخزون', align: 'right', format: 'money', total: 'sum', valuation: true, pnl: true },
  { key: 'cost_status', label_en: 'Cost Status', label_ar: 'حالة التكلفة', align: 'center', format: 'text', pnl: true }
];

// Customer copy = the same rows with every pnl:true column REMOVED.
var CUSTOMER_COLUMNS = FULL_PNL_COLUMNS.filter(function (c) { return c.pnl !== true; });

// Consolidated = one row per family (all LUX as one number, all stock as one number).
var CONSOLIDATED_COLUMNS = [
  { key: 'family', label_en: 'Family', label_ar: 'العائلة', align: 'left', format: 'text' },
  { key: 'products', label_en: 'Products', label_ar: 'عدد المنتجات', align: 'right', format: 'number', total: 'sum' },
  { key: 'uom', label_en: 'UOM', label_ar: 'الوحدة', align: 'center', format: 'text' },
  { key: 'original_qty', label_en: 'Original Qty', label_ar: 'الكمية الأصلية', align: 'right', format: 'number', total: 'sum' },
  { key: 'recv_rolls', label_en: 'Rolls Rcvd', label_ar: 'لفات مستلمة', align: 'right', format: 'number', total: 'sum' },
  { key: 'sold_qty', label_en: 'Sold Qty', label_ar: 'الكمية المباعة', align: 'right', format: 'number', total: 'sum' },
  { key: 'sold_rolls', label_en: 'Rolls Sold', label_ar: 'لفات مباعة', align: 'right', format: 'number', total: 'sum' },
  { key: 'qty_remaining', label_en: 'On Hand', label_ar: 'المتبقي', align: 'right', format: 'number', total: 'sum' },
  { key: 'avg_sale_price', label_en: 'Avg Sale Price', label_ar: 'متوسط سعر البيع', align: 'right', format: 'money', pnl: true },
  { key: 'revenue', label_en: 'Revenue', label_ar: 'الإيراد', align: 'right', format: 'money', total: 'sum', pnl: true },
  { key: 'avg_cost', label_en: 'Avg Cost', label_ar: 'متوسط التكلفة', align: 'right', format: 'money', valuation: true, pnl: true },
  { key: 'cogs', label_en: 'COGS', label_ar: 'تكلفة المبيعات', align: 'right', format: 'money', total: 'sum', valuation: true, pnl: true },
  { key: 'gross_profit', label_en: 'Gross Profit', label_ar: 'إجمالي الربح', align: 'right', format: 'money', total: 'sum', valuation: true, pnl: true },
  { key: 'margin_pct', label_en: 'Margin %', label_ar: 'الهامش %', align: 'right', format: 'percent', valuation: true, pnl: true },
  { key: 'stock_value', label_en: 'Stock Value', label_ar: 'قيمة المخزون', align: 'right', format: 'money', total: 'sum', valuation: true, pnl: true }
];
var CONSOLIDATED_CUSTOMER_COLUMNS = CONSOLIDATED_COLUMNS.filter(function (c) { return c.pnl !== true; });

var REPORTS = [
  {
    id: 'full_pnl',
    title_en: 'Stock & P&L (Internal)',
    title_ar: 'المخزون والأرباح (داخلي)',
    desc_en: 'Per product: original qty, rolls received, sold qty/rolls, on hand, average sale price, revenue, average cost, COGS, gross profit and margin. P&L shows where numbers exist; otherwise 0. Cost Status flags stock still awaiting landed cost.',
    desc_ar: 'لكل منتج: الكمية الأصلية، اللفات المستلمة، المباع، المتبقي، متوسط سعر البيع، الإيراد، متوسط التكلفة، تكلفة المبيعات، الربح والهامش. الأرباح تظهر حيث تتوفر الأرقام وإلا صفر.',
    permission: 'inventory.reports.view',
    grouped: false,
    columns: FULL_PNL_COLUMNS
  },
  {
    id: 'customer_copy',
    title_en: 'Stock Report (Customer Copy)',
    title_ar: 'تقرير المخزون (نسخة العميل)',
    desc_en: 'Same products, same quantities — with every price, cost and profit column removed. Safe to send outside the company.',
    desc_ar: 'نفس المنتجات والكميات مع إزالة كل أعمدة الأسعار والتكاليف والأرباح. آمن للإرسال خارج الشركة.',
    permission: 'inventory.reports.view',
    grouped: false,
    columns: CUSTOMER_COLUMNS
  },
  {
    id: 'consolidated',
    title_en: 'Consolidated by Family (Internal)',
    title_ar: 'مجمّع حسب العائلة (داخلي)',
    desc_en: 'One row per product family — all LUX as one number, all Textile as one number, and a grand total. Quantities, sales and P&L rolled up.',
    desc_ar: 'صف واحد لكل عائلة منتجات — كل LUX كرقم واحد، كل النسيج كرقم واحد، مع إجمالي عام.',
    permission: 'inventory.reports.view',
    grouped: false,
    columns: CONSOLIDATED_COLUMNS
  },
  {
    id: 'consolidated_customer',
    title_en: 'Consolidated by Family (Customer Copy)',
    title_ar: 'مجمّع حسب العائلة (نسخة العميل)',
    desc_en: 'One row per family, quantities only — no prices, costs or profit.',
    desc_ar: 'صف واحد لكل عائلة، كميات فقط — بدون أسعار أو تكاليف أو أرباح.',
    permission: 'inventory.reports.view',
    grouped: false,
    columns: CONSOLIDATED_CUSTOMER_COLUMNS
  },
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
  },
  {
    id: 'movement',
    title_en: 'Inventory Movement',
    title_ar: 'حركة المخزون',
    desc_en: 'Movement history per product — receipts, sales, adjustments, transfers, reversals — with a running balance. Shows the most recent loaded movements.',
    desc_ar: 'سجل حركة كل منتج: استلام، بيع، تسويات، تحويلات، عكوسات، مع الرصيد الجاري. يعرض أحدث الحركات المحمّلة.',
    permission: 'inventory.reports.view',
    grouped: false,
    columns: MOVEMENT_COLUMNS
  }
];

function getReport(id) {
  var i;
  for (i = 0; i < REPORTS.length; i++) { if (REPORTS[i].id === id) { return REPORTS[i]; } }
  return null;
}

export { REPORTS, SNAPSHOT_COLUMNS, MIX_COLUMNS, MOVEMENT_COLUMNS, FULL_PNL_COLUMNS, CUSTOMER_COLUMNS, CONSOLIDATED_COLUMNS, CONSOLIDATED_CUSTOMER_COLUMNS, getReport };
