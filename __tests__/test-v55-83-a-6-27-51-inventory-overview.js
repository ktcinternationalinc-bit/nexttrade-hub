// v55.83-A.6.27.51 — Inventory Overview screen
//   • Accordion grouped by Product Family
//   • Per-product: Current Stock / Original Stock / Sold / Avg Cost / Avg Sold / P&L
//   • Cascading 9-level classification filters
//   • Avg Cost + P&L gated to super_admin (or "See Inventory Costs" permission)
//   • Tolerates missing inventory_layers / inventory_stock_receipts / invoice_items tables

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page    = read('src/app/page.jsx');
var ov      = read('src/components/InventoryOverview.jsx');
var invTab  = read('src/components/InventoryTab.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — Component shape + permission gating
// ══════════════════════════════════════════════════════════════════

ok('A1: InventoryOverview component is a default export',
  /export default function InventoryOverview\(props\)/.test(ov));
ok('A2: canView = isSuperAdmin OR Inventory OR Edit Inventory permission',
  /var canView = isSuperAdmin \|\| modulePerms\['Inventory'\] === true \|\| modulePerms\['Edit Inventory'\] === true/.test(ov));
ok('A3: seeCosts = isSuperAdmin OR "See Inventory Costs" permission',
  /var seeCosts = isSuperAdmin \|\| modulePerms\['See Inventory Costs'\] === true/.test(ov));
ok('A4: shows permission-denied banner when !canView',
  /if \(!canView\) \{\s+return \(\s+<div className="bg-amber-50/.test(ov));

// ══════════════════════════════════════════════════════════════════
// PART B — Data loading (5 parallel queries with safe wrapper for missing tables)
// ══════════════════════════════════════════════════════════════════

ok('B1: loads inventory_products WHERE active=true',
  /supabase\.from\('inventory_products'\)\.select\('\*'\)\.eq\('active', true\)/.test(ov));
ok('B2: loads inventory_lists WHERE active=true',
  /supabase\.from\('inventory_lists'\)\.select\('id, level, code, label_en, label_ar'\)\.eq\('active', true\)/.test(ov));
ok('B3: loads inventory_layers WHERE qty_remaining > 0 (current stock)',
  /supabase\.from\('inventory_layers'\)\.select\('product_id, qty_remaining, cost_per_uom'\)\.gt\('qty_remaining', 0\)/.test(ov));
ok('B4: loads inventory_stock_receipts (original received qty)',
  /supabase\.from\('inventory_stock_receipts'\)\.select\('product_id, quantity'\)/.test(ov));
ok('B5: loads invoice_items WHERE inventory_status=consumed (sales)',
  /supabase\.from\('invoice_items'\)\.select\('variant_id, sale_quantity, sale_price_per_uom, cogs_total, gross_profit, inventory_status'\)\.eq\('inventory_status', 'consumed'\)/.test(ov));
ok('B6: safe() wrapper tolerates missing tables (returns { data: [], error })',
  /var safe = function \(q\) \{[\s\S]{0,300}return \{ data: \[\], error: e \};/.test(ov));
ok('B7: cancelled flag prevents setState after unmount',
  /var cancelled = false;/.test(ov) &&
  /return function \(\) \{ cancelled = true; \};/.test(ov));

// ══════════════════════════════════════════════════════════════════
// PART C — Aggregation math (productStats useMemo)
// ══════════════════════════════════════════════════════════════════

ok('C1: layers loop sums current_qty + current_weighted_cost',
  /layers\.forEach\(function \(l\) \{[\s\S]{0,500}s\.current_qty \+= qty;\s+s\.current_weighted_cost \+= qty \* Number\(l\.cost_per_uom \|\| 0\);/.test(ov));
ok('C2: receipts loop sums original_qty',
  /receipts\.forEach\(function \(r\) \{[\s\S]{0,300}s\.original_qty \+= Number\(r\.quantity \|\| 0\)/.test(ov));
ok('C3: salesItems loop sums sold_qty + revenue + cogs + gross_profit by variant_id',
  /salesItems\.forEach\(function \(it\) \{[\s\S]{0,600}var s = stats\[it\.variant_id\][\s\S]{0,500}s\.sold_qty \+= qty;[\s\S]{0,500}s\.gross_profit \+= Number\(it\.gross_profit \|\| 0\)/.test(ov));
ok('C4: per-product avgCost = current_weighted_cost / current_qty (when > 0)',
  /var avgCost = s\.current_qty > 0 \? s\.current_weighted_cost \/ s\.current_qty : 0/.test(ov));
ok('C5: per-product avgSoldPrice = sold_revenue / sold_qty (when > 0)',
  /var avgSoldPrice = s\.sold_qty > 0 \? s\.sold_revenue \/ s\.sold_qty : 0/.test(ov));

// ══════════════════════════════════════════════════════════════════
// PART D — Cascading filters (9 levels)
// ══════════════════════════════════════════════════════════════════

ok('D1: filterLevels state has all 9 classification levels',
  /family_list_id: '',\s+category_list_id: '',\s+grade_list_id: '',\s+construction_list_id: '',\s+backing_list_id: '',\s+color_list_id: '',\s+pattern_list_id: '',\s+spec_class_list_id: '',\s+origin_list_id: '',/.test(ov));
ok('D2: clearFilters resets all 9 levels + search',
  /function clearFilters\(\) \{[\s\S]{0,500}origin_list_id: '',\s+\}\);[\s\S]{0,200}setSearch\(''\);/.test(ov));
ok('D3: filteredProducts applies ALL set level filters (loops over levelFields)',
  /for \(var fi = 0; fi < levelFields\.length; fi\+\+\) \{\s+var f = levelFields\[fi\];\s+var want = filterLevels\[f\];\s+if \(want && p\[f\] !== want\) return false;/.test(ov));
ok('D4: availableOptionsByLevel cascades — excludes current level when computing options',
  /levelOrder\.forEach\(function \(lvl\) \{[\s\S]{0,800}if \(other === lvl\) continue;/.test(ov));
ok('D5: availableOptionsByLevel sorted by label',
  /opts\.sort\(function \(a, b\) \{ return \(a\.label \|\| ''\)\.localeCompare\(b\.label \|\| ''\); \}\)/.test(ov));
ok('D6: activeFilterCount memo counts non-empty filters + search',
  /Object\.keys\(filterLevels\)\.forEach\(function \(k\) \{ if \(filterLevels\[k\]\) c\+\+; \}\);[\s\S]{0,200}if \(search\.trim\(\)\) c\+\+;/.test(ov));

// ══════════════════════════════════════════════════════════════════
// PART E — Filter UI rendered (9 dropdowns in collapsible section)
// ══════════════════════════════════════════════════════════════════

ok('E1: filter section is visible (was <details> in .51, always-rendered in .60)',
  /Filter by classification/.test(ov));
ok('E2: filter section header bilingual',
  /Filter by classification \(Family → Category → Grade → \.\.\.\) \/ تصفية حسب التصنيف/.test(ov));
ok('E3: shows active filter count badge',
  /\{activeFilterCount\} active/.test(ov));
ok('E4: all 9 dropdowns rendered with bilingual labels',
  /label_en: '1\. Family',\s+label_ar: 'العائلة'/.test(ov) &&
  /label_en: '2\. Category',\s+label_ar: 'الفئة'/.test(ov) &&
  /label_en: '9\. Origin',\s+label_ar: 'المنشأ'/.test(ov));
ok('E5: dropdown disabled when no options + no current value (cascade dead-end)',
  /var disabled = opts\.length === 0 && !current/.test(ov));
ok('E6: dropdown indicates "— none match —" when disabled',
  /disabled \? '— none match —' : '— Any —'/.test(ov));
ok('E7: dropdown highlighted (indigo bg) when a value is selected',
  /current \? 'border-indigo-500 bg-indigo-50 text-indigo-900'/.test(ov));
ok('E8: Clear button shown when activeFilterCount > 0',
  /activeFilterCount > 0 && \(\s+<button\s+onClick=\{clearFilters\}/.test(ov));

// ══════════════════════════════════════════════════════════════════
// PART F — Accordion (grouped by family)
// ══════════════════════════════════════════════════════════════════

ok('F1: products grouped by family_list_id',
  /var familyId = p\.family_list_id \|\| ungroupedKey/.test(ov));
ok('F2: ungrouped/unclassified products go into a special bucket',
  /var ungroupedKey = '__ungrouped__'/.test(ov) &&
  /'Unclassified'/.test(ov));
ok('F3: group totals accumulate per-product stats',
  /groups\[familyId\]\.totals\.current_qty \+= s\.current_qty \|\| 0/.test(ov));
ok('F4: groups sorted alphabetically with Unclassified last',
  /if \(a\.family_id === ungroupedKey\) return 1;\s+if \(b\.family_id === ungroupedKey\) return -1;/.test(ov));
ok('F5: group header click toggles collapsed state',
  /onClick=\{function \(\) \{ toggleGroup\(g\.family_id\); \}\}/.test(ov));
ok('F6: group header shows ▶ when collapsed, ▼ when expanded',
  /\{collapsed \? '▶' : '▼'\}/.test(ov));
ok('F7: Expand All + Collapse All buttons',
  /onClick=\{expandAll\}[\s\S]{0,300}Expand All \/ فتح الكل/.test(ov) &&
  /onClick=\{collapseAll\}[\s\S]{0,300}Collapse All \/ طي الكل/.test(ov));
ok('F8: groups default to EXPANDED (collapsedGroups starts empty)',
  /var \[collapsedGroups, setCollapsedGroups\] = useState\(\{\}\)/.test(ov));

// ══════════════════════════════════════════════════════════════════
// PART G — Per-product table columns
// ══════════════════════════════════════════════════════════════════

ok('G1: Code column with variant_suffix when present',
  /\{p\.quick_code \|\| '—'\}\s+\{p\.variant_suffix && <span className="text-slate-700">-\{p\.variant_suffix\}<\/span>\}/.test(ov));
ok('G2: Design SKU column',
  /<th[^>]*>Design SKU</.test(ov));
ok('G3: Current/Original/Sold quantity columns',
  /<th[^>]*>Current</.test(ov) && /<th[^>]*>Original</.test(ov) && /<th[^>]*>Sold</.test(ov));
ok('G4: Avg Cost + Avg Sold Price + P&L columns gated to seeCosts',
  /seeCosts && \(\s+<>\s+<th[\s\S]{0,500}Avg Cost[\s\S]{0,500}Avg Sold Price[\s\S]{0,500}P&amp;L/.test(ov));
ok('G5: Cost columns have amber background',
  /bg-amber-50 border-2 border-amber-400|bg-amber-50/.test(ov));
ok('G6: P&L color-coded green when ≥0, red when <0',
  /s\.gross_profit >= 0 \? 'text-emerald-800' : 'text-red-700'/.test(ov));
ok('G7: row count footer note when seeCosts=false',
  /Avg Cost and P&amp;L columns are hidden\. Ask a super admin/.test(ov));

// ══════════════════════════════════════════════════════════════════
// PART H — Grand totals cards
// ══════════════════════════════════════════════════════════════════

ok('H1: grand totals memo computed from grouped',
  /var grandTotals = useMemo\(function \(\) \{[\s\S]{0,500}grouped\.forEach\(function \(g\)/.test(ov));
ok('H2: 4 always-visible total cards (Products, Current, Original, Sold)',
  /Products \/ منتجات/.test(ov) &&
  /Current Stock \/ المخزون الحالي/.test(ov) &&
  /Original Stock \/ الأصلي/.test(ov) &&
  /Sold \/ المباع/.test(ov));
ok('H3: 3 cost-gated total cards (Revenue, COGS, Gross Profit) shown only when seeCosts',
  /\{seeCosts && \(\s+<div className="grid grid-cols-1 md:grid-cols-3 gap-2">[\s\S]{0,2000}Revenue \/ الإيرادات[\s\S]{0,500}COGS \/ التكلفة[\s\S]{0,500}Gross Profit \/ الربح الإجمالي/.test(ov));

// ══════════════════════════════════════════════════════════════════
// PART I — InventoryTab wiring
// ══════════════════════════════════════════════════════════════════

ok('I1: InventoryTab imports InventoryOverview',
  /import InventoryOverview from '\.\/InventoryOverview'/.test(invTab));
ok('I2: "overview" subtab is FIRST in SUBTABS array (new default landing)',
  /var SUBTABS = \[[\s\S]{0,400}\{ id: 'overview', label: '📊 Overview'/.test(invTab));
ok('I3: subtab default changed from "inventory" (legacy hidden) to "overview"',
  /var \[subtab, setSubtab\] = useState\('overview'\)/.test(invTab) &&
  !/var \[subtab, setSubtab\] = useState\('inventory'\)/.test(invTab));
ok('I4: render branch wires overview to InventoryOverview component',
  /\{subtab === 'overview' && \(\s+<InventoryOverview userProfile=\{userProfile\}/.test(invTab));

// ══════════════════════════════════════════════════════════════════
// PART R — REGRESSION GUARDS
// ══════════════════════════════════════════════════════════════════

ok('R1: 50 — History modal still anchored to top with items-start',
  /flex items-start justify-center pt-6 pb-6 px-4/.test(read('src/components/InventoryVariantHistory.jsx')));
ok('R2: 50 — Tab contrast: active black-on-white + inactive white-on-slate-800',
  /'bg-white text-slate-900 border-2 border-b-0 border-indigo-600 shadow-md'/.test(read('src/components/InventoryVariantHistory.jsx')) &&
  /'bg-slate-800 text-white hover:bg-slate-700/.test(read('src/components/InventoryVariantHistory.jsx')));
ok('R3: 50 — Schema diagnostic toast still fires when issues found',
  /Database missing ' \+ issues\.length \+ ' migration/.test(read('src/components/InventoryProductMaster.jsx')));
ok('R4: 49 — Smart search in InventoryReceiving includes design_sku + classText',
  /\(p\.design_sku \|\| ''\) \+ ' '/.test(read('src/components/InventoryReceiving.jsx')) &&
  /classText\(p\)/.test(read('src/components/InventoryReceiving.jsx')));
ok('R5: 49 — Quantity Received * + UoM * + Release # * + Roll Count * labels',
  /Quantity Received \*\s/.test(read('src/components/InventoryReceiving.jsx')) &&
  /Unit of Measure \*\s/.test(read('src/components/InventoryReceiving.jsx')) &&
  /Release # \*\s/.test(read('src/components/InventoryReceiving.jsx')) &&
  /Roll Count \*\s/.test(read('src/components/InventoryReceiving.jsx')));
ok('R6: 48 — Modal sized for max real estate (97vw/1900 in .48, 99vw in .60)',
  /(width: '97vw', maxWidth: 1900|99vw)/.test(read('src/components/InventoryReceiving.jsx')));
ok('R7: 48 — "Inbound Shipments" + "Product List" labels still in InventoryTab',
  /label: '🚚 Inbound Shipments'/.test(invTab) &&
  /label: '🏷️ Product List'/.test(invTab));
ok('R8: 47 — Shipping Rates keyFor still uses port_of_loading + effective_date backfill key',
  /var pol = normName\(r\.port_of_loading\) \|\| normName\(r\.origin\)/.test(read('src/components/ShippingRatesTab.jsx')));
ok('R9: 46 — Product Master openDuplicate inlines form (no async race)',
  /function openDuplicate\(p\) \{\s+setModalMode\('new'\);/.test(read('src/components/InventoryProductMaster.jsx')));
ok('R10: 45 — Egypt Bank owner deposit + rules engine still wired',
  /const toggleOwnerDeposit = async \(txnId\)/.test(read('src/components/EgyptBankTab.jsx')) &&
  /supabase\.rpc\('apply_egypt_bank_rules', params\)/.test(read('src/components/EgyptBankTab.jsx')));
ok('R11: 44c — consume_invoice_item_inventory RPC still wired',
  /supabase\.rpc\('consume_invoice_item_inventory', \{ p_item_id: insertedItem\.id \}\)/.test(page));
ok('R12: 44d.1 — Variant History component still default-exports',
  /export default function InventoryVariantHistory/.test(read('src/components/InventoryVariantHistory.jsx')));
ok('R13: 44a — Inventory Cutoff panel still in InventoryTab',
  /Inventory Cutoff Date.*\/.*تاريخ بدء ربط المخزون/.test(invTab));
ok('R14: 43 — Shipment Expected Totals still 5-col grid in Receiving',
  /grid grid-cols-5 gap-4/.test(read('src/components/InventoryReceiving.jsx')));
ok('R15: closed-tickets fetch still has NO .limit(100)',
  !/\.eq\('status', 'Closed'\)[\s\S]{0,200}\.limit\(100\)/.test(page));
ok('R16: invoice insert in page.jsx still uses order_number + customer_name',
  /supabase\.from\('invoices'\)\.insert\(\{\s+order_number: orderNum, customer_name: sanitize\(resolvedCustomerName\)/.test(page));
ok('R17: treasury linking by order_number still wired',
  /\.from\('treasury'\)\s+\.select\('id'\)\s+\.eq\('order_number', orderNum\)\s+\.is\('linked_invoice_id', null\)/.test(page));

// ──────────────────────────────────────────────────────────────────
// Version stamp
// ──────────────────────────────────────────────────────────────────
ok('V1: version stamp v55.83-A.6.27.51 or later',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.51 (Inventory Overview + cascading filters) tests passed');
