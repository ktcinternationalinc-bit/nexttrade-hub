// ⚠ SUPERSEDED by v55.83-T (2026-06-07) — DO NOT use these assertions to drive code changes.
// The two parallel inventory engines were consolidated into ONE. System B (inv_sku_id /
// consumeFifo / inv_layers / inv_movements / AdjustmentsManager) was intentionally retired.
// Assertions in this Stage-B/C/D/E/F suite describe that removed dual-engine behavior and no
// longer reflect the product. Current behavior is covered by test-v55-83-t-single-inventory-engine.js.
// Left in place for history; expected to fail. Do NOT re-add System B to make it pass.

// v55.83-A.6.27.44b — Invoice form: 📦 From Inventory + ✏️ Manual tabs in product picker.
// Records variant linkage on invoice_items WITHOUT FIFO consumption.
// Strict regression guards on invoice/banking/treasury/checks logic.

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var sql44a = read('sql/v55-83-a-6-27-44-invoice-inventory-integration.sql');
var sql44b = read('sql/v55-83-a-6-27-44b-invoice-items-variant-linkage.sql');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — SQL: invoice_items now has the same linkage columns
// ══════════════════════════════════════════════════════════════════

ok('A1: ALTER TABLE invoice_items ADD uses_inventory boolean',
  /ALTER TABLE invoice_items[\s\S]{0,1500}ADD COLUMN IF NOT EXISTS uses_inventory boolean DEFAULT false/.test(sql44b));
ok('A2: variant_id + warehouse_id + uom columns added',
  /ADD COLUMN IF NOT EXISTS variant_id uuid REFERENCES inventory_products\(id\)/.test(sql44b) &&
  /ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES warehouses\(id\)/.test(sql44b) &&
  /ADD COLUMN IF NOT EXISTS uom text/.test(sql44b));
ok('A3: sale_quantity + sale_price_per_uom columns',
  /ADD COLUMN IF NOT EXISTS sale_quantity numeric\(12,3\)/.test(sql44b) &&
  /ADD COLUMN IF NOT EXISTS sale_price_per_uom numeric\(14,2\)/.test(sql44b));
ok('A4: consumed_layers + cogs_total + gross_profit columns',
  /consumed_layers jsonb/.test(sql44b) &&
  /cogs_total numeric\(14,2\)/.test(sql44b) &&
  /gross_profit numeric\(14,2\)/.test(sql44b));
ok('A5: inventory_consumed_at + inventory_status + backorder_qty',
  /inventory_consumed_at timestamptz/.test(sql44b) &&
  /inventory_status text DEFAULT 'none'/.test(sql44b) &&
  /backorder_qty numeric\(12,3\) DEFAULT 0/.test(sql44b));
ok('A6: Index on variant_id',
  /idx_invoice_items_variant_id\s+ON invoice_items \(variant_id\)/.test(sql44b));
ok('A7: Partial index on uses_inventory = true',
  /idx_invoice_items_uses_inventory[\s\S]{0,200}WHERE uses_inventory = true/.test(sql44b));

// ══════════════════════════════════════════════════════════════════
// PART B — State + load on page.jsx
// ══════════════════════════════════════════════════════════════════

ok('B1: inventoryProducts state declared',
  /const \[inventoryProducts, setInventoryProducts\] = useState\(\[\]\)/.test(page));
ok('B2: inventoryCutoffDate state declared',
  /const \[inventoryCutoffDate, setInventoryCutoffDate\] = useState\(null\)/.test(page));
ok('B3: loads inventory_products on app boot (filtered to active=true)',
  /from\('inventory_products'\)\.select\('\*'\)\.eq\('active', true\)/.test(page));
ok('B4: loads cutoff date from app_settings.inventory_cutoff_date',
  /from\('app_settings'\)\s+\.select\('setting_value'\)\s+\.eq\('setting_key', 'inventory_cutoff_date'\)/.test(page));
ok('B5: cutoff parser handles both JSON and raw date string',
  /var parsedCut = JSON\.parse\(rawCut\);[\s\S]{0,500}if \(\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\/\.test\(rawCut\)\) setInventoryCutoffDate/.test(page));
ok('B6: loads degrade gracefully (try/catch around each)',
  /try \{\s+const \{ data: ipRows \} = await supabase\.from\('inventory_products'\)[\s\S]{0,500}\} catch \(e\) \{ setInventoryProducts\(\[\]\); \}/.test(page));

// ══════════════════════════════════════════════════════════════════
// PART C — Two-tab picker UI inside showProductPicker
// ══════════════════════════════════════════════════════════════════

ok('C1: pickerMode tab state stored in formData',
  /formData\.pickerMode/.test(page) &&
  /setFormData\(\{ \.\.\.formData, pickerMode: 'inventory' \}\)/.test(page) &&
  /setFormData\(\{ \.\.\.formData, pickerMode: 'manual' \}\)/.test(page));
ok('C2: cutoff guidance message shown when cutoff set',
  /var cutoffMessage = null;[\s\S]{0,500}if \(inventoryCutoffDate\) \{[\s\S]{0,500}if \(invDate >= inventoryCutoffDate\)/.test(page));
ok('C3: cutoff message is bilingual',
  /inventory mode recommended \/ يُنصح باستخدام المخزون/.test(page) &&
  /either mode works \/ كلا الوضعين متاحان/.test(page));
ok('C4: default mode prefers inventory when on/after cutoff',
  /var defaultMode = formData\.pickerMode\s+\|\| \(cutoffMessage && cutoffMessage\.kind === 'force-inventory' \? 'inventory'\s+: hasInventoryProducts \? 'inventory' : 'manual'\)/.test(page));
ok('C5: Inventory tab button bilingual + count badge',
  /📦 From Inventory \/ من المخزون/.test(page));
ok('C6: Manual tab button bilingual',
  /✏️ Manual \/ يدوي/.test(page));
ok('C7: tab buttons high contrast — selected uses emerald-600 or slate-600 + white',
  /defaultMode === 'inventory' \? 'bg-emerald-600 text-white shadow'/.test(page) &&
  /defaultMode === 'manual' \? 'bg-slate-600 text-white shadow'/.test(page));

// ══════════════════════════════════════════════════════════════════
// PART D — Inventory tab content
// ══════════════════════════════════════════════════════════════════

ok('D1: empty-state warning when no inventory_products yet',
  /!hasInventoryProducts \? \([\s\S]{0,500}⚠ No inventory products yet \/ لا توجد منتجات في المخزون/.test(page));
ok('D2: smart multi-keyword search input bilingual placeholder',
  /placeholder="Search by code, name \(Eng\/Ar\), or specs\.\.\. \/ بحث متعدد الكلمات"/.test(page));
ok('D3: smart search splits on whitespace + every keyword must match',
  /q\.split\(\/\\s\+\/\)\.filter\(function/.test(page) &&
  /if \(searchable\.indexOf\(keywords\[i\]\) < 0\) return false;/.test(page));
ok('D4: searchable includes quick_code + variant_suffix + name_en + name_ar + slug',
  /searchable = \([\s\S]{0,500}\(p\.quick_code \|\| ''\)[\s\S]{0,500}p\.variant_suffix \? p\.quick_code \+ '-' \+ p\.variant_suffix[\s\S]{0,500}\(p\.name_ar \|\| ''\)[\s\S]{0,500}\(p\.classification_slug \|\| ''\)/.test(page));
ok('D5: sort featured DESC → use_count DESC → name ASC',
  /var af = a\.featured === true \? 1 : 0;[\s\S]{0,300}if \(af !== bf\) return bf - af;[\s\S]{0,200}var bu = Number\(b\.use_count \|\| 0\);[\s\S]{0,200}if \(bu !== au\) return bu - au/.test(page));
ok('D6: dropdown shows ⭐ featured + FAMILY/VARIANT badges',
  /p\.featured === true && <span className="text-amber-500">⭐<\/span>/.test(page) &&
  /p\.is_family_template === true && <span[^>]*>FAMILY<\/span>/.test(page) &&
  /p\.is_family_template === false && p\.variant_suffix && <span[^>]*>VARIANT<\/span>/.test(page));
ok('D7: hover uses emerald-600 + text-white (no white-on-white invisibility)',
  /hover:bg-emerald-600 hover:text-white/.test(page));
ok('D8: clicking a variant pushes new line with uses_inventory + variant_id',
  /uses_inventory: true,\s+variant_id: p\.id,/.test(page));
ok('D9: line payload captures variant_quick_code + name_en + name_ar + uom',
  /variant_quick_code: displayCode,[\s\S]{0,200}variant_name_en: p\.name_en[\s\S]{0,200}variant_name_ar: p\.name_ar[\s\S]{0,200}variant_uom: p\.default_uom \|\| 'meter'/.test(page));
ok('D10: line records is_family_template flag for downstream get_or_create_variant',
  /is_family_template: p\.is_family_template === true/.test(page));
ok('D11: hint about FIFO landing in next build (bilingual)',
  /FIFO consumption activates in next build[\s\S]{0,200}FIFO سيعمل في الإصدار القادم/.test(page));

// ══════════════════════════════════════════════════════════════════
// PART E — Visual badge in items list when inventory-linked
// ══════════════════════════════════════════════════════════════════

ok('E1: items list shows 📦 INVENTORY badge when item.uses_inventory',
  /item\.uses_inventory && \([\s\S]{0,500}📦 INVENTORY/.test(page));
ok('E2: badge uses bg-emerald-600 text-white (high contrast)',
  /bg-emerald-600 text-white font-extrabold rounded px-1\.5 py-0\.5">📦 INVENTORY/.test(page));
ok('E3: quick_code shown next to badge',
  /item\.variant_quick_code && \([\s\S]{0,500}\{item\.variant_quick_code\}/.test(page));
ok('E4: family template warning shown when item.is_family_template',
  /item\.is_family_template && \(\s+<span[\s\S]{0,500}⚠ Template/.test(page));

// ══════════════════════════════════════════════════════════════════
// PART F — Save logic: persist linkage WITHOUT FIFO yet
// ══════════════════════════════════════════════════════════════════

ok('F1: itemPayload base structure unchanged for legacy items',
  /const itemPayload = \{\s+invoice_id: newInv\.id, description: item\.inv_desc/.test(page));
ok('F2: inventory linkage fields added only when uses_inventory === true && variant_id',
  /if \(item\.uses_inventory === true && item\.variant_id\) \{\s+itemPayload\.uses_inventory = true;\s+itemPayload\.variant_id = item\.variant_id/.test(page));
ok('F3: sale_quantity + sale_price_per_uom + uom + inventory_status persisted',
  /itemPayload\.uom = item\.variant_uom \|\| null;\s+itemPayload\.sale_quantity = Number\(item\.inv_qty\) \|\| 0;\s+itemPayload\.sale_price_per_uom = Number\(item\.inv_price\) \|\| 0;\s+itemPayload\.inventory_status = 'draft'/.test(page));
ok('F4: NO consume_invoice_inventory RPC called yet (44b deferred)',
  !/supabase\.rpc\('consume_invoice_inventory'/.test(page));
ok('F5: NO get_or_create_variant called from invoice save flow yet',
  // (it IS called in InventoryReceiving.jsx — make sure it stays out of page.jsx invoice save)
  !/await supabase\.rpc\('get_or_create_variant'[\s\S]{0,500}invoice_id/.test(page));

// ══════════════════════════════════════════════════════════════════
// PART R — REGRESSION GUARDS (THE MOST IMPORTANT PART)
// Confirms 44b did NOT break existing invoice/banking/treasury/checks logic.
// ══════════════════════════════════════════════════════════════════

ok('R1: legacy product picker still wired (custom item add path)',
  /formData\.customDesc \|\| ''/.test(page) &&
  /formData\.customQty \|\| ''/.test(page) &&
  /formData\.customPrice \|\| ''/.test(page));
ok('R2: existing inventory (legacy) list filter still present',
  /inventory\.filter\(p => \{[\s\S]{0,300}p\.reference_number/.test(page));
ok('R3: legacy items still get product_id + inv_sku_id fields',
  /product_id: item\.product_id \|\| null,\s+inv_sku_id: item\.inv_sku_id \|\| null/.test(page));
ok('R4: invoice insert still uses order_number + customer_name + total_amount',
  /supabase\.from\('invoices'\)\.insert\(\{\s+order_number: orderNum, customer_name: sanitize\(resolvedCustomerName\)/.test(page));
ok('R5: total_amount still computed from items.reduce OR formData.amount fallback',
  /totalAmt = items\.reduce\(\(a, i\) => a \+ \(i\.inv_total \|\| 0\), 0\) \|\| parseAmount\(formData\.amount\)/.test(page));
ok('R6: missing-field validation unchanged (Order #, Customer, Items/amount)',
  /missing\.push\('Order #'\)[\s\S]{0,300}missing\.push\('Customer'\)[\s\S]{0,200}missing\.push\('Items \(or amount\)'\)/.test(page));
ok('R7: treasury linking by order_number after invoice insert still wired',
  /\.from\('treasury'\)\s+\.select\('id'\)\s+\.eq\('order_number', orderNum\)\s+\.is\('linked_invoice_id', null\)/.test(page));
ok('R8: recalcInvoiceCollected still called after treasury backfill',
  /await recalcInvoiceCollected\(inserted\.id\)/.test(page));
ok('R9: PaymentForm component unchanged',
  /function PaymentForm\(\{ invoice, categories/.test(page));
ok('R10: bank reconciliation (check_number + order_number signal scoring) intact',
  /chk\.order_number && desc\.indexOf\(String\(chk\.order_number\)\.toLowerCase\(\)\) >= 0/.test(page));
ok('R11: handleAddInvoice signature/source=manual unchanged',
  /source: 'manual'/.test(page));
ok('R12: dbInsert(\'invoice_items\') call sites unchanged in count (3 distinct sites)',
  // 3 sites: import, editor, new-invoice form. Adding inventory linkage to the new-invoice
  // form must NOT introduce a duplicate insert.
  page.split("dbInsert('invoice_items'").length === 4);  // n+1 due to split semantics

// ══════════════════════════════════════════════════════════════════
// PART S — Stable carryover from prior builds
// ══════════════════════════════════════════════════════════════════

ok('S1: 44a foundation SQL still present',
  /CREATE OR REPLACE FUNCTION consume_invoice_inventory\(p_invoice_id uuid\)/.test(sql44a));
ok('S2: .43 — can_delete_product still defined',
  /CREATE OR REPLACE FUNCTION can_delete_product\(p_id uuid\)/.test(read('sql/v55-83-a-6-27-43-expected-totals-variance.sql')));
ok('S3: .39 — get_or_create_variant still defined',
  /CREATE OR REPLACE FUNCTION get_or_create_variant\(/.test(read('sql/v55-83-a-6-27-39-variants.sql')));
ok('S4: closed-tickets fetch still has NO .limit(100) (carry from .28)',
  !/\.eq\('status', 'Closed'\)[\s\S]{0,200}\.limit\(100\)/.test(page));

// ── Version stamp ──────────────────────────────────────────────────
ok('V1: version stamp v55.83-A.6.27.44',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.44b (invoice picker) tests passed');
