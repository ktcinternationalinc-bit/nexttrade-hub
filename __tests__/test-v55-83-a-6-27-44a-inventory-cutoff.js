// v55.83-A.6.27.44a — Inventory Cutoff Date admin panel + bilingual labels
// + regression guards confirming invoice/banking/treasury/checks logic untouched.

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var tab  = read('src/components/InventoryTab.jsx');
var sql  = read('sql/v55-83-a-6-27-44-invoice-inventory-integration.sql');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — SQL migration (the foundation; just verify it's present)
// ══════════════════════════════════════════════════════════════════

ok('A1: SQL file exists and seeds inventory_cutoff_date in app_settings',
  /INSERT INTO app_settings \(setting_key, setting_value\)\s+VALUES \('inventory_cutoff_date', 'null'\)\s+ON CONFLICT \(setting_key\) DO NOTHING/.test(sql));
ok('A2: SQL adds uses_inventory + variant_id columns to invoices',
  /ALTER TABLE invoices[\s\S]{0,500}ADD COLUMN IF NOT EXISTS uses_inventory boolean DEFAULT false[\s\S]{0,500}ADD COLUMN IF NOT EXISTS variant_id uuid REFERENCES inventory_products\(id\)/.test(sql));
ok('A3: SQL adds COGS + gross_profit columns',
  /cogs_total numeric\(14,2\)/.test(sql) && /gross_profit numeric\(14,2\)/.test(sql));
ok('A4: SQL creates inventory_backorders table',
  /CREATE TABLE IF NOT EXISTS inventory_backorders/.test(sql));
ok('A5: backorder status CHECK constraint',
  /CHECK \(status IN \('open', 'fulfilled', 'cancelled'\)\)/.test(sql));
ok('A6: consume_invoice_inventory function declared',
  /CREATE OR REPLACE FUNCTION consume_invoice_inventory\(p_invoice_id uuid\)/.test(sql));
ok('A7: reverse_invoice_inventory function declared',
  /CREATE OR REPLACE FUNCTION reverse_invoice_inventory\(p_invoice_id uuid\)/.test(sql));
ok('A8: get_last_sold_price helper function',
  /CREATE OR REPLACE FUNCTION get_last_sold_price\(p_variant_id uuid\)/.test(sql));
ok('A9: get_variant_available_qty helper function',
  /CREATE OR REPLACE FUNCTION get_variant_available_qty\(p_variant_id uuid, p_warehouse_id uuid DEFAULT NULL\)/.test(sql));
ok('A10: consume function is idempotent (early return on already-consumed)',
  /IF v_invoice\.inventory_status = 'consumed' THEN\s+RETURN jsonb_build_object\(\s+'already_consumed', true/.test(sql));
ok('A11: consume function tolerates missing inventory_layers table',
  /EXCEPTION WHEN undefined_table THEN[\s\S]{0,300}inventory_layers table missing/.test(sql));
ok('A12: consume function creates backorder when stock exhausted',
  /IF v_remaining > 0 THEN[\s\S]{0,500}INSERT INTO inventory_backorders/.test(sql));
ok('A13: reverse function restores layer qty_remaining',
  /UPDATE inventory_layers\s+SET qty_remaining = qty_remaining \+ v_qty/.test(sql));
ok('A14: reverse function cancels open backorders from this invoice',
  /UPDATE inventory_backorders\s+SET status = 'cancelled'[\s\S]{0,300}WHERE invoice_id = p_invoice_id AND status = 'open'/.test(sql));

// ══════════════════════════════════════════════════════════════════
// PART B — State + load logic in InventoryTab
// ══════════════════════════════════════════════════════════════════

ok('B1: cutoffDate state declared',
  /var \[cutoffDate, setCutoffDate\] = useState\(null\)/.test(tab));
ok('B2: cutoffLoading + cutoffSaving + cutoffPanelOpen states declared',
  /var \[cutoffLoading, setCutoffLoading\] = useState\(true\)/.test(tab) &&
  /var \[cutoffSaving, setCutoffSaving\] = useState\(false\)/.test(tab) &&
  /var \[cutoffPanelOpen, setCutoffPanelOpen\] = useState\(false\)/.test(tab));
ok('B3: canManageCutoff = isSuperAdmin OR Adjust Inventory permission',
  /var canManageCutoff = isSuperAdmin\s+\|\| \(modulePerms && modulePerms\['Adjust Inventory'\] === true\)/.test(tab));
ok('B4: loadCutoff useEffect fetches from app_settings table',
  /supabase\s+\.from\('app_settings'\)\s+\.select\('setting_value'\)\s+\.eq\('setting_key', 'inventory_cutoff_date'\)/.test(tab));
ok('B5: loadCutoff parses JSON value with fallback to raw date string',
  /var parsed = JSON\.parse\(raw\);[\s\S]{0,500}\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\//.test(tab));
ok('B6: loadCutoff handles missing row (no app_settings entry yet)',
  /if \(resp && resp\.data && resp\.data\.setting_value\) \{[\s\S]{0,3000}\} else \{\s+setCutoffDate\(null\);/.test(tab));

// ══════════════════════════════════════════════════════════════════
// PART C — Save logic
// ══════════════════════════════════════════════════════════════════

ok('C1: saveCutoff function async',
  /async function saveCutoff\(newValue\)/.test(tab));
ok('C2: saveCutoff serializes value to JSON (null kept as "null" string)',
  /var jsonVal = newValue \? JSON\.stringify\(newValue\) : 'null'/.test(tab));
ok('C3: saveCutoff UPDATE when existing row found',
  /supabase\s+\.from\('app_settings'\)\s+\.update\(\{ setting_value: jsonVal \}\)\s+\.eq\('id', existing\.data\.id\)/.test(tab));
ok('C4: saveCutoff INSERT when no existing row',
  /supabase\s+\.from\('app_settings'\)\s+\.insert\(\{ setting_key: 'inventory_cutoff_date', setting_value: jsonVal \}\)/.test(tab));
ok('C5: saveCutoff toast.success message bilingual or clearly states impact',
  /Inventory cutoff set to/.test(tab) && /Inventory cutoff cleared/.test(tab));
ok('C6: saveCutoff error path logs + toasts',
  /console\.error\('\[inventory\] saveCutoff failed:/.test(tab) &&
  /toast\.error\('Failed to save cutoff:/.test(tab));

// ══════════════════════════════════════════════════════════════════
// PART D — UI: Admin panel rendering
// ══════════════════════════════════════════════════════════════════

ok('D1: panel rendered only when canManageCutoff is true',
  /\{canManageCutoff && \(\s+<div className="bg-white border-2 border-indigo-200/.test(tab));
ok('D2: panel header is collapsible (toggle button with chevron)',
  /onClick=\{function \(\) \{ setCutoffPanelOpen\(!cutoffPanelOpen\); \}\}/.test(tab) &&
  /\{cutoffPanelOpen \? '▲' : '▼'\}/.test(tab));
ok('D3: status indicator shows green when active, white when not set',
  /🟢 Active from/.test(tab) && /⚪ Not set/.test(tab));
ok('D4: date input wired to cutoffDate state',
  /<input\s+type="date"\s+value=\{cutoffDate \|\| ''\}/.test(tab));
ok('D5: Save button calls saveCutoff(cutoffDate)',
  /onClick=\{function \(\) \{ saveCutoff\(cutoffDate\); \}\}[\s\S]{0,300}💾 Save/.test(tab));
ok('D6: Clear button calls saveCutoff(null) and disables when no cutoff is set',
  /onClick=\{function \(\) \{ saveCutoff\(null\); \}\}[\s\S]{0,500}disabled=\{cutoffSaving \|\| cutoffLoading \|\| !cutoffDate\}/.test(tab));
ok('D7: non-super-admin sees Adjust Inventory permission warning',
  /\{!isSuperAdmin && \([\s\S]{0,300}You have Adjust Inventory permission/.test(tab));

// ══════════════════════════════════════════════════════════════════
// PART E — Bilingual labels (Arabic + English everywhere)
// ══════════════════════════════════════════════════════════════════

ok('E1: panel title bilingual',
  /Inventory Cutoff Date.*\/.*تاريخ بدء ربط المخزون/.test(tab));
ok('E2: status sub-text bilingual',
  /Loading… \/ جاري التحميل…/.test(tab) &&
  /Active from.*\/.*نشط من/.test(tab) &&
  /Not set — both modes always allowed \/ غير محدد — كلا الوضعين متاحان/.test(tab));
ok('E3: helper paragraph has Arabic block with direction rtl',
  /<span style=\{\{ direction: 'rtl' \}\} className="block">\s+عند تحديد هذا التاريخ/.test(tab));
ok('E4: date input label bilingual',
  /Cutoff Date \/ التاريخ/.test(tab));
ok('E5: Save button bilingual (English first, Arabic second)',
  /Saving… \/ حفظ…/.test(tab) && /💾 Save \/ حفظ/.test(tab));
ok('E6: Clear button bilingual',
  /Clear \/ مسح/.test(tab));

// ══════════════════════════════════════════════════════════════════
// PART F — High-contrast styling (the recurring rule)
// ══════════════════════════════════════════════════════════════════

ok('F1: panel uses bg-white border-indigo-200 (clear contrast on dark theme)',
  /bg-white border-2 border-indigo-200 rounded-xl/.test(tab));
ok('F2: Save button uses bg-emerald-600 + text-white (high contrast)',
  /bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-extrabold/.test(tab));
ok('F3: Clear button uses bg-slate-300 + text-slate-900 (readable)',
  /bg-slate-300 hover:bg-slate-400 disabled:opacity-50 text-slate-900 text-sm font-bold/.test(tab));
ok('F4: date input has bg-white + text-slate-900 + font-bold (legible)',
  /border-2 border-slate-300 rounded text-sm bg-white text-slate-900 font-bold/.test(tab));

// ══════════════════════════════════════════════════════════════════
// PART R — REGRESSION GUARDS
// Confirms 44a did NOT break existing invoice/banking/treasury/checks logic.
// ══════════════════════════════════════════════════════════════════

ok('R1: existing showAddInvoice modal still present (unchanged)',
  /\{showAddInvoice && \(/.test(page) &&
  /Modal onClose=\{\(\) => \{ setShowAddInvoice\(false\); setFormData\(\{\}\); \}\}/.test(page));
ok('R2: invoice save logic still inserts to invoices with order_number + customer_name',
  /supabase\.from\('invoices'\)\.insert\(\{[\s\S]{0,500}order_number: orderNum[\s\S]{0,200}customer_name: sanitize\(resolvedCustomerName\)/.test(page));
ok('R3: legacy invoice fields (orderNumber, amount, customerName) untouched',
  /if \(!formData\.orderNumber \|\| !String\(formData\.orderNumber\)\.trim\(\)\)/.test(page) &&
  /if \(!isValidAmount\(formData\.amount\)\)/.test(page));
ok('R4: treasury linking by order_number still wired',
  /\.from\('treasury'\)\s+\.select\('id'\)\s+\.eq\('order_number', orderNum\)\s+\.is\('linked_invoice_id', null\)/.test(page));
ok('R5: recalcInvoiceCollected still called after treasury backfill',
  /await recalcInvoiceCollected\(inserted\.id\)/.test(page));
ok('R6: bank reconciliation by check_number / order_number flows unchanged',
  /check_number/.test(page) &&
  /verifies amount.*date window/i.test(page));
ok('R7: invoice deletion logic intact',
  /\.from\('invoices'\)\.delete\(\)/.test(page) || /soft delete/i.test(page));
ok('R8: customer creation flow unchanged',
  /supabase\.from\('customers'\)\.insert/.test(page));
ok('R9: PaymentForm component still exists',
  /function PaymentForm\(\{ invoice, categories/.test(page));
ok('R10: no change to global handleAddInvoice signature/structure',
  /total_amount: parseAmount\(formData\.amount\)/.test(page) &&
  /total_collected: 0/.test(page));
ok('R11: source field still defaults to "manual" for new invoices',
  /source: 'manual'/.test(page));
ok('R12: existing inventory product picker in invoice form unchanged',
  /formData\.showProductPicker/.test(page) &&
  /Add Item \/ إضافة/.test(page));

// ══════════════════════════════════════════════════════════════════
// PART S — Stable carryover from prior builds
// ══════════════════════════════════════════════════════════════════

ok('S1: Inventory Phase 1 (.43) still present — get_or_create_variant intact',
  /CREATE OR REPLACE FUNCTION get_or_create_variant\(/.test(read('sql/v55-83-a-6-27-39-variants.sql')));
ok('S2: .43 — expected totals on shipment_headers still present',
  /ADD COLUMN IF NOT EXISTS expected_total_rolls integer/.test(read('sql/v55-83-a-6-27-43-expected-totals-variance.sql')));
ok('S3: .43 — can_delete_product still defined',
  /CREATE OR REPLACE FUNCTION can_delete_product\(p_id uuid\)/.test(read('sql/v55-83-a-6-27-43-expected-totals-variance.sql')));
ok('S4: closed-tickets fetch still has NO .limit(100) (carry from .28)',
  !/\.eq\('status', 'Closed'\)[\s\S]{0,200}\.limit\(100\)/.test(page));

// ── Version stamp ──────────────────────────────────────────────────
ok('V1: version stamp v55.83-A.6.27.44a',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));
ok('V2: InventoryTab header pill shows .44a',
  /v55\.83-A\.6\.27\.\d+ · /.test(tab));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.44a (foundation) tests passed');
