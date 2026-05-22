// v55.83-A.6.27.48 — Inventory module: renames + widening
//   1. "Receive Stock" → "Inbound Shipments" globally (UI only, no DB changes)
//   2. "Product Master" → "Product List" globally
//   3. "Batch #" → "Release #" label only (DB col stays batch_number)
//   4. Inbound Shipments modal: wider (95vw→97vw, 1800→1900) + taller (96vh)
//   5. Shipment Expected Totals: wider padding + larger gaps

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page    = read('src/app/page.jsx');
var receiv  = read('src/components/InventoryReceiving.jsx');
var pm      = read('src/components/InventoryProductMaster.jsx');
var invTab  = read('src/components/InventoryTab.jsx');
var picker  = read('src/components/ProductPicker.jsx');
var settings = read('src/components/SettingsTab.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — "Receive Stock" globally renamed to "Inbound Shipments"
// (except WhatsNewWidget which has historical changelog entries)
// ══════════════════════════════════════════════════════════════════

ok('A1: InventoryTab subtab label is "Inbound Shipments"',
  /label: '🚚 Inbound Shipments'/.test(invTab));
ok('A2: InventoryTab subtab no longer says "Receive Stock"',
  !/Receive Stock/.test(invTab));
ok('A3: InventoryReceiving has no "Receive Stock" leftover',
  !/Receive Stock/.test(receiv));
ok('A4: InventoryProductMaster has no "Receive Stock" leftover',
  !/Receive Stock/.test(pm));
ok('A5: ProductPicker has no "Receive Stock" leftover',
  !/Receive Stock/.test(picker));

// ══════════════════════════════════════════════════════════════════
// PART B — "Product Master" → "Product List"
// ══════════════════════════════════════════════════════════════════

ok('B1: InventoryTab subtab label is "Product List"',
  /label: '🏷️ Product List'/.test(invTab));
ok('B2: InventoryTab has no "Product Master" UI strings',
  !/Product Master/.test(invTab));
ok('B3: ProductPicker has no "Product Master" leftover',
  !/Product Master/.test(picker));
ok('B4: SettingsTab has no "Product Master" leftover',
  !/Product Master/.test(settings));
ok('B5: InventoryReceiving has no "Product Master" leftover',
  !/Product Master/.test(receiv));

// ══════════════════════════════════════════════════════════════════
// PART C — "Batch #" / "batch" label renamed to "Release"
// ══════════════════════════════════════════════════════════════════

ok('C1: Receiving form label is "Release # *" (not Batch #)',
  /Release # \*/.test(receiv) && !/>Batch # \*</.test(receiv));
ok('C2: Receiving placeholder uses "release / ID" (not batch / ID)',
  /placeholder="release \/ ID"/.test(receiv));
ok('C3: Receiving search placeholder uses "release" (not batch)',
  /Search receipt#, product, release, supplier/.test(receiv));
ok('C4: DB column batch_number references PRESERVED (label-only rename, no DB rename)',
  /batch_number/.test(receiv));

// ══════════════════════════════════════════════════════════════════
// PART D — Inbound Shipments modal widening (taller + wider)
// ══════════════════════════════════════════════════════════════════

ok('D1: modal container is 97vw / 1900max (was 95vw / 1800)',
  /style=\{\{ width: '97vw', maxWidth: 1900, maxHeight: '96vh', display: 'flex', flexDirection: 'column' \}\}/.test(receiv));
ok('D2: inner content uses flex:1 (fills modal height) — v.48 used single scrolling div; v.56 split into 3 regions, scrollable middle still has flex:1',
  /flex: 1, overflowY: 'auto'/.test(receiv));
ok('D3: old "calc(100vh - 140px)" pattern removed',
  !/maxHeight: 'calc\(100vh - 140px\)', overflowY: 'auto'/.test(receiv));

// ══════════════════════════════════════════════════════════════════
// PART E — Shipment Expected Totals widened
// ══════════════════════════════════════════════════════════════════

ok('E1: Expected Totals card padding p-4 → p-6',
  /bg-amber-50 border-2 border-amber-400 rounded-xl p-6 mt-4/.test(receiv));
ok('E2: Expected Totals grid gap-3 → gap-4',
  /<div className="grid grid-cols-5 gap-4">/.test(receiv));
ok('E3: Expected Totals heading uses text-lg (was text-base)',
  /<div className="text-lg font-extrabold text-slate-900">📦 Shipment Expected Totals/.test(receiv));

// ══════════════════════════════════════════════════════════════════
// PART R — REGRESSION GUARDS
// ══════════════════════════════════════════════════════════════════

ok('R1: 47 — Shipping rates keyFor uses new match key (port_of_loading + port_of_discharge + effective_date + vendor + line)',
  /var pol = normName\(r\.port_of_loading\) \|\| normName\(r\.origin\)/.test(read('src/components/ShippingRatesTab.jsx')) &&
  /String\(r\.effective_date \|\| ''\)\.trim\(\)/.test(read('src/components/ShippingRatesTab.jsx')));
ok('R2: 46 — Product List schema diagnostic banner still present',
  /Database migrations needed/.test(pm));
ok('R3: 46 — openDuplicate inlines form (no async openEdit race)',
  /function openDuplicate\(p\) \{\s+setModalMode\('new'\);/.test(pm));
ok('R4: 46 — toggleFeatured probes featured column before write',
  /var verifyRes = await supabase\.from\('inventory_products'\)\.select\('id, featured'\)/.test(pm));
ok('R5: 45 — Egypt Bank owner deposit toggle still wired',
  /const toggleOwnerDeposit = async \(txnId\)/.test(read('src/components/EgyptBankTab.jsx')));
ok('R6: 45 — apply_egypt_bank_rules RPC still called',
  /supabase\.rpc\('apply_egypt_bank_rules', params\)/.test(read('src/components/EgyptBankTab.jsx')));
ok('R7: 44d.1 — Variant History modal still rendered in Product List',
  /<InventoryVariantHistory/.test(pm));
ok('R8: 44c — consume_invoice_item_inventory RPC still wired',
  /supabase\.rpc\('consume_invoice_item_inventory', \{ p_item_id: insertedItem\.id \}\)/.test(page));
ok('R9: 44b — 📦 From Inventory tab in invoice form still present',
  /📦 From Inventory \/ من المخزون/.test(page));
ok('R10: 44a — Inventory Cutoff panel still in InventoryTab',
  /Inventory Cutoff Date.*\/.*تاريخ بدء ربط المخزون/.test(invTab));
ok('R11: 43 — Shipment Expected Totals form still uses 5-column grid',
  /grid grid-cols-5 gap-4/.test(receiv) &&
  /expected_total_rolls/.test(receiv));
ok('R12: Expected Totals fields preserved (rolls, gross_kg, net_kg, uom)',
  /expected_total_rolls: '',/.test(receiv) &&
  /expected_total_gross_kg: '',/.test(receiv) &&
  /expected_total_net_kg: '',/.test(receiv) &&
  /expected_total_uom: '',/.test(receiv));
ok('R13: Receiving submit logic preserved (submitReceipt + balanced/unbalanced branches)',
  /submitReceipt/.test(receiv) && /is_balanced/.test(receiv));
ok('R14: invoice insert in page.jsx still uses order_number + customer_name',
  /supabase\.from\('invoices'\)\.insert\(\{\s+order_number: orderNum, customer_name: sanitize\(resolvedCustomerName\)/.test(page));
ok('R15: treasury linking by order_number still wired',
  /\.from\('treasury'\)\s+\.select\('id'\)\s+\.eq\('order_number', orderNum\)\s+\.is\('linked_invoice_id', null\)/.test(page));
ok('R16: closed-tickets fetch still has NO .limit(100)',
  !/\.eq\('status', 'Closed'\)[\s\S]{0,200}\.limit\(100\)/.test(page));

// ──────────────────────────────────────────────────────────────────
// Version stamp
// ──────────────────────────────────────────────────────────────────
ok('V1: version stamp v55.83-A.6.27.48 or later',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.48 (renames + widening) tests passed');
