// v55.83-A.6.27.44d.1 — Variant History modal in Product Master.
// 4 tabs: Stock Summary / Inbound / Outbound / Adjustments.
// Bilingual, read-only, regression-safe.

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var pm = read('src/components/InventoryProductMaster.jsx');
var vh = read('src/components/InventoryVariantHistory.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — VariantHistory component file
// ══════════════════════════════════════════════════════════════════

ok('A1: VariantHistory component file exists + default export',
  /export default function InventoryVariantHistory\(\{ variant, onClose, isOpen \}\)/.test(vh));
ok('A2: 4 tab IDs declared (summary, inbound, outbound, adjustments)',
  /id: 'summary'/.test(vh) && /id: 'inbound'/.test(vh) && /id: 'outbound'/.test(vh) && /id: 'adjustments'/.test(vh));
ok('A3: all tabs bilingual (label_en + label_ar)',
  /label_en: '📊 Stock Summary', label_ar: 'ملخص المخزون'/.test(vh) &&
  /label_en: '📥 Inbound', label_ar: 'الوارد'/.test(vh) &&
  /label_en: '📤 Outbound', label_ar: 'المباع'/.test(vh) &&
  /label_en: '⚖️ Adjustments', label_ar: 'التسويات'/.test(vh));
ok('A4: header is bilingual (Variant History / سجل المنتج)',
  /Variant History \/ سجل المنتج/.test(vh));
ok('A5: Close button bilingual',
  /✕ Close \/ إغلاق/.test(vh));

// ══════════════════════════════════════════════════════════════════
// PART B — Data loading: 4 parallel queries with safeQuery wrapper
// ══════════════════════════════════════════════════════════════════

ok('B1: receipts query — inventory_stock_receipts by product_id',
  /from\('inventory_stock_receipts'\)\s+\.select\([^)]+\)\s+\.eq\('product_id', variant\.id\)/.test(vh));
ok('B2: outbound query — invoice_items where variant_id matches',
  /from\('invoice_items'\)\s+\.select\([^)]+\)\s+\.eq\('variant_id', variant\.id\)/.test(vh));
ok('B3: outbound enriched with invoice metadata (order_number + customer)',
  /from\('invoices'\)\s+\.select\('id, order_number, customer_name, invoice_date'\)\s+\.in\('id', invIds\)/.test(vh));
ok('B4: adjustments query — inventory_adjustments by product_id (table may be missing)',
  /from\('inventory_adjustments'\)[\s\S]{0,500}\.eq\('product_id', variant\.id\)/.test(vh));
ok('B5: layers query — inventory_layers with qty_remaining > 0',
  /from\('inventory_layers'\)[\s\S]{0,500}\.gt\('qty_remaining', 0\)/.test(vh));
ok('B6: safeQuery wrapper tolerates missing tables (catch returns empty array)',
  /var safeQuery = function \(promise\)[\s\S]{0,500}return \{ data: \[\], error: e \};/.test(vh));
ok('B7: load cancelled flag prevents setState after unmount',
  /var cancelled = false;/.test(vh) &&
  /return function \(\) \{ cancelled = true; \};/.test(vh));

// ══════════════════════════════════════════════════════════════════
// PART C — Stock summary math
// ══════════════════════════════════════════════════════════════════

ok('C1: totalReceived sums receipts.quantity',
  /receipts\.forEach\(function \(r\) \{ totalReceived \+= Number\(r\.quantity \|\| 0\); \}\)/.test(vh));
ok('C2: totalSold only counts consumed outbound (status filter)',
  /outbound\.forEach[\s\S]{0,500}if \(r\.inventory_status === 'consumed'\) \{[\s\S]{0,500}totalSold \+= Number\(r\.sale_quantity \|\| 0\)/.test(vh));
ok('C3: totalAdjusted only counts approved/consumed adjustments',
  /adjustments\.forEach[\s\S]{0,500}if \(a\.status === 'approved' \|\| a\.status === 'consumed'\)[\s\S]{0,200}totalAdjusted \+= Number\(a\.qty_change \|\| 0\)/.test(vh));
ok('C4: weighted avg cost computed correctly (sum of qty*cost / sum of qty)',
  /var avgCost = totalRemaining > 0 \? weightedCost \/ totalRemaining : 0/.test(vh));
ok('C5: gross margin pct computed when totalRevenue > 0',
  /var margin = totalRevenue > 0 \? \(gp \/ totalRevenue\) \* 100 : 0/.test(vh));
ok('C6: last sale price found from most recent consumed outbound',
  /var lastSale = outbound\.find\(function \(r\) \{\s+return r\.inventory_status === 'consumed' && r\.sale_price_per_uom != null/.test(vh));

// ══════════════════════════════════════════════════════════════════
// PART D — UI rendering: 12 summary cards + 3 tables
// ══════════════════════════════════════════════════════════════════

ok('D1: summary tab shows 12 cards (grid-cols-2 md:grid-cols-4)',
  /tab === 'summary' && \([\s\S]{0,500}grid grid-cols-2 md:grid-cols-4/.test(vh));
ok('D2: 12 distinct Card invocations rendered in summary',
  (vh.match(/<Card label_en=/g) || []).length === 12);
ok('D3: gross profit/margin colors switch on sign (emerald positive / red negative)',
  /accent=\{stockSummary\.grossProfit >= 0 \? 'emerald' : 'red'\}/.test(vh));
ok('D4: Card component uses solid bg + white text (high contrast)',
  /rounded-lg p-3 text-white/.test(vh) &&
  /indigo:\s+'bg-indigo-700'/.test(vh));
ok('D5: inbound tab renders Table with 7 columns including Status badge',
  /tab === 'inbound' && \([\s\S]{0,3000}rows=\{receipts\}[\s\S]{0,3000}en: 'Status', ar: 'الحالة'/.test(vh));
ok('D6: outbound tab renders gross profit color-by-sign',
  /tab === 'outbound' && \([\s\S]{0,5000}Number\(r\.gross_profit \|\| 0\) >= 0 \? 'text-emerald-700' : 'text-red-700'/.test(vh));
ok('D7: outbound shows backorder column when backorder_qty > 0',
  /en: 'Backorder', ar: 'طلب معلق'[\s\S]{0,500}Number\(r\.backorder_qty \|\| 0\) > 0/.test(vh));
ok('D8: adjustments tab color-codes qty_change (positive emerald / negative red)',
  /tab === 'adjustments' && \([\s\S]{0,3000}Number\(r\.qty_change \|\| 0\) > 0 \? 'text-emerald-700' : Number\(r\.qty_change \|\| 0\) < 0 \? 'text-red-700'/.test(vh));
ok('D9: empty states bilingual (no data row → "No X yet. / لا يوجد X بعد")',
  /empty_en="No inbound receipts yet\."/.test(vh) &&
  /empty_en="No sales yet for this variant\."/.test(vh) &&
  /empty_en="No adjustments recorded for this variant\."/.test(vh));
ok('D10: tabs row has hover/active states distinguishable',
  /active \? 'bg-white text-indigo-900 border-2 border-b-0 border-slate-200' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'/.test(vh));

// ══════════════════════════════════════════════════════════════════
// PART E — Modal mechanics
// ══════════════════════════════════════════════════════════════════

ok('E1: modal returns null when !isOpen or no variant',
  /if \(!isOpen \|\| !variant\) return null/.test(vh));
ok('E2: backdrop click closes modal',
  /<div className="fixed inset-0 z-\[100\] bg-black\/70[^"]*" onClick=\{onClose\}>/.test(vh));
ok('E3: inner content stopPropagation on click',
  /onClick=\{function \(e\) \{ e\.stopPropagation\(\); \}\}/.test(vh));
ok('E4: modal width 95vw / max 1600',
  /style=\{\{ width: '95vw', maxWidth: 1600, maxHeight: '92vh' \}\}/.test(vh));
ok('E5: displayCode appends variant_suffix when present',
  /var displayCode = variant\.quick_code \+ \(variant\.variant_suffix \? '-' \+ variant\.variant_suffix : ''\)/.test(vh));

// ══════════════════════════════════════════════════════════════════
// PART F — Product Master integration
// ══════════════════════════════════════════════════════════════════

ok('F1: ProductMaster imports VariantHistory',
  /import InventoryVariantHistory from '\.\/InventoryVariantHistory'/.test(pm));
ok('F2: historyVariant state declared',
  /var \[historyVariant, setHistoryVariant\] = useState\(null\)/.test(pm));
ok('F3: 🔍 History button rendered (no canEdit gate — read-only available to all viewers)',
  /onClick=\{function \(\) \{ setHistoryVariant\(p\); \}\}[\s\S]{0,500}🔍 History/.test(pm));
ok('F4: History button uses slate-700 + white (high contrast)',
  /bg-slate-700 hover:bg-slate-800 text-white rounded font-extrabold shadow[\s\S]{0,500}🔍 History/.test(pm));
ok('F5: VariantHistory modal rendered with correct props',
  /<InventoryVariantHistory\s+variant=\{historyVariant\}\s+isOpen=\{!!historyVariant\}\s+onClose=\{function \(\) \{ setHistoryVariant\(null\); \}\}/.test(pm));
ok('F6: actions column grid widened to 370px to fit 6 buttons',
  /'110px 1\.5fr 2fr 140px 60px 370px'/.test(pm));
ok('F7: 370px grid applied in BOTH header and row',
  pm.split("gridTemplateColumns: '110px 1.5fr 2fr 140px 60px 370px'").length === 3);

// ══════════════════════════════════════════════════════════════════
// PART R — REGRESSION GUARDS
// ══════════════════════════════════════════════════════════════════

ok('R1: 44a — Inventory Cutoff Date panel still in InventoryTab',
  /Inventory Cutoff Date.*\/.*تاريخ بدء ربط المخزون/.test(read('src/components/InventoryTab.jsx')));
ok('R2: 44b — 📦 From Inventory tab still in page.jsx invoice form',
  /📦 From Inventory \/ من المخزون/.test(page));
ok('R3: 44c — consume_invoice_item_inventory RPC call still wired in save flow',
  /supabase\.rpc\('consume_invoice_item_inventory', \{ p_item_id: insertedItem\.id \}\)/.test(page));
ok('R4: legacy invoice insert + treasury linking + recalcInvoiceCollected intact',
  /supabase\.from\('invoices'\)\.insert\(\{\s+order_number: orderNum/.test(page) &&
  /await recalcInvoiceCollected\(inserted\.id\)/.test(page));
ok('R5: PaymentForm component unchanged',
  /function PaymentForm\(\{ invoice, categories/.test(page));
ok('R6: bank reconciliation by check_number / order_number still wired',
  /chk\.order_number && desc\.indexOf\(String\(chk\.order_number\)\.toLowerCase\(\)\) >= 0/.test(page));
ok('R7: dbInsert(invoice_items) call site count unchanged (3 sites)',
  page.split("dbInsert('invoice_items'").length === 4);
ok('R8: 44a — get_or_create_variant SQL still defined',
  /CREATE OR REPLACE FUNCTION get_or_create_variant\(/.test(read('sql/v55-83-a-6-27-39-variants.sql')));
ok('R9: 44c — consume_invoice_item_inventory SQL still defined',
  /CREATE OR REPLACE FUNCTION consume_invoice_item_inventory\(p_item_id uuid\)/.test(read('sql/v55-83-a-6-27-44c-line-level-consumption.sql')));
ok('R10: Product Master — Star + Edit + Variant + Copy + Deactivate + Delete buttons all intact',
  /toggleFeatured/.test(pm) && /openEdit/.test(pm) && /openCreateVariant/.test(pm) && /openDuplicate/.test(pm) && /toggleActive/.test(pm) && /deleteProduct/.test(pm));
ok('R11: closed-tickets fetch still has NO .limit(100)',
  !/\.eq\('status', 'Closed'\)[\s\S]{0,200}\.limit\(100\)/.test(page));
ok('R12: source=manual still default for new invoices',
  /source: 'manual'/.test(page));

// ── Version stamp ──────────────────────────────────────────────────
ok('V1: version stamp present',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.44d.1 (Variant History) tests passed');
