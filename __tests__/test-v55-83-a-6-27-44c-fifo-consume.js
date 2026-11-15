// v55.83-A.6.27.44c — Line-level FIFO consumption fires on invoice submit.
// Each inventory-linked item triggers consume_invoice_item_inventory RPC.
// Backorders auto-created on oversell. Failure is soft (toast, not error).
// Strict regression guards against invoice/banking/treasury/checks logic.

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var sql44a = read('sql/v55-83-a-6-27-44-invoice-inventory-integration.sql');
var sql44b = read('sql/v55-83-a-6-27-44b-invoice-items-variant-linkage.sql');
var sql44c = read('sql/v55-83-a-6-27-44c-line-level-consumption.sql');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — SQL: line-level consume + reverse functions
// ══════════════════════════════════════════════════════════════════

ok('A1: consume_invoice_item_inventory function declared',
  /CREATE OR REPLACE FUNCTION consume_invoice_item_inventory\(p_item_id uuid\)/.test(sql44c));
ok('A2: reads invoice_items row with FOR UPDATE lock',
  /SELECT \* INTO v_item FROM invoice_items WHERE id = p_item_id FOR UPDATE/.test(sql44c));
ok('A3: idempotent — early return if already consumed',
  /IF v_item\.inventory_status = 'consumed' THEN[\s\S]{0,200}'already_consumed', true/.test(sql44c));
ok('A4: silently skips items where uses_inventory != true',
  /IF v_item\.uses_inventory IS NOT TRUE THEN[\s\S]{0,200}RETURN jsonb_build_object\('skipped', true/.test(sql44c));
ok('A5: errors clearly if variant_id is null when flagged',
  /RAISE EXCEPTION 'Invoice item % marked uses_inventory but has no variant_id'/.test(sql44c));
ok('A6: validates sale_quantity > 0',
  /IF v_item\.sale_quantity IS NULL OR v_item\.sale_quantity <= 0 THEN[\s\S]{0,200}RAISE EXCEPTION 'Invoice item % has invalid sale_quantity/.test(sql44c));
ok('A7: errors clearly if variant_id points to a family template',
  /IF v_template_row\.is_family_template = true THEN[\s\S]{0,300}pick a specific variant instead, or use Manual mode/.test(sql44c));
ok('A8: walks inventory_layers oldest-first with FOR UPDATE',
  /FROM inventory_layers[\s\S]{0,500}ORDER BY received_at ASC, id ASC\s+FOR UPDATE/.test(sql44c));
ok('A9: deducts qty_remaining + builds consumed_layers JSONB array',
  /UPDATE inventory_layers\s+SET qty_remaining = qty_remaining - v_consumed_qty[\s\S]{0,500}v_consumed_layers := v_consumed_layers \|\| jsonb_build_object/.test(sql44c));
ok('A10: creates backorder row when remaining > 0 after layer walk',
  /IF v_remaining > 0 THEN[\s\S]{0,500}INSERT INTO inventory_backorders/.test(sql44c));
ok('A11: stamps invoice_items with cogs_total + gross_profit + inventory_status="consumed"',
  /UPDATE invoice_items\s+SET consumed_layers\s+= v_consumed_layers,\s+cogs_total\s+= v_total_cogs,\s+gross_profit\s+= COALESCE\(line_total, 0\) - v_total_cogs,\s+inventory_consumed_at = now\(\),\s+inventory_status\s+= 'consumed'/.test(sql44c));
ok('A12: tolerates missing inventory_layers table',
  /EXCEPTION WHEN undefined_table THEN[\s\S]{0,200}inventory_layers table missing — run Build 4\.3 SQL/.test(sql44c));

ok('A13: reverse_invoice_item_inventory function declared',
  /CREATE OR REPLACE FUNCTION reverse_invoice_item_inventory\(p_item_id uuid\)/.test(sql44c));
ok('A14: reverse restores layer qty_remaining',
  /UPDATE inventory_layers\s+SET qty_remaining = qty_remaining \+ v_qty/.test(sql44c));
ok('A15: reverse cancels open backorders for that variant on this invoice',
  /UPDATE inventory_backorders\s+SET status = 'cancelled'[\s\S]{0,500}WHERE invoice_id = v_item\.invoice_id AND status = 'open' AND variant_id = v_item\.variant_id/.test(sql44c));
ok('A16: reverse clears the item cogs fields and sets status=reversed',
  /UPDATE invoice_items\s+SET inventory_status\s+= 'reversed',\s+consumed_layers\s+= NULL,\s+cogs_total\s+= NULL,\s+gross_profit\s+= NULL/.test(sql44c));

// ══════════════════════════════════════════════════════════════════
// PART B — page.jsx: save flow calls RPC after dbInsert
// ══════════════════════════════════════════════════════════════════

ok('B1: consume_invoice_item_inventory RPC called only when uses_inventory + variant_id + insertedItem',
  /if \(item\.uses_inventory === true && item\.variant_id && insertedItem && insertedItem\.id\) \{/.test(page));
ok('B2: RPC called with p_item_id = insertedItem.id',
  /supabase\.rpc\('consume_invoice_item_inventory', \{ p_item_id: insertedItem\.id \}\)/.test(page));
ok('B3: RPC failure does NOT throw — wrapped in try/catch + toast.warning',
  /try \{[\s\S]{0,500}supabase\.rpc\('consume_invoice_item_inventory'[\s\S]{0,2500}\} catch \(e\) \{[\s\S]{0,300}toast\.warning\('Inventory deduction failed/.test(page));
ok('B4: RPC error on response is also logged + toast.warning',
  /if \(consumeRes\.error\) \{[\s\S]{0,500}console\.error\('\[invoice-save\] consume_invoice_item_inventory failed:[\s\S]{0,500}toast\.warning\('Inventory consumption failed/.test(page));
ok('B5: backorder warning toast fires when backorder_qty > 0',
  /consumeRes\.data && consumeRes\.data\.backorder_qty && Number\(consumeRes\.data\.backorder_qty\) > 0[\s\S]{0,500}created backorder for/.test(page));
ok('B6: error messages bilingual (English + Arabic)',
  /فشل خصم المخزون/.test(page) &&
  /تم إنشاء طلب معلق/.test(page));

// ══════════════════════════════════════════════════════════════════
// PART R — REGRESSION GUARDS
// ══════════════════════════════════════════════════════════════════

ok('R1: legacy product picker still wired (manual/custom item add path)',
  /formData\.customDesc \|\| ''/.test(page) &&
  /formData\.customQty \|\| ''/.test(page) &&
  /formData\.customPrice \|\| ''/.test(page));
ok('R2: existing inventory (legacy) list filter still present',
  /inventory\.filter\(p => \{[\s\S]{0,300}p\.reference_number/.test(page));
ok('R3: legacy items still get product_id + inv_sku_id fields',
  /product_id: item\.product_id \|\| null,\s+inv_sku_id: item\.inv_sku_id \|\| null/.test(page));
ok('R4: invoice insert still uses order_number + customer_name + total_amount',
  /supabase\.from\('invoices'\)\.insert\(\{\s+order_number: orderNum, customer_name: sanitize\(resolvedCustomerName\)/.test(page));
ok('R5: total_amount computed from items.reduce OR formData.amount fallback',
  /totalAmt = items\.reduce\(\(a, i\) => a \+ \(i\.inv_total \|\| 0\), 0\) \|\| parseAmount\(formData\.amount\)/.test(page));
ok('R6: missing-field validation unchanged (Order #, Customer, Items/amount)',
  /missing\.push\('Order #'\)[\s\S]{0,300}missing\.push\('Customer'\)[\s\S]{0,200}missing\.push\('Items \(or amount\)'\)/.test(page));
ok('R7: treasury linking by order_number after invoice insert still wired',
  /\.from\('treasury'\)\s+\.select\('id'\)\s+\.eq\('order_number', orderNum\)\s+\.is\('linked_invoice_id', null\)/.test(page));
ok('R8: recalcInvoiceCollected still called after treasury backfill',
  /await recalcInvoiceCollected\(inserted\.id\)/.test(page));
ok('R9: PaymentForm component unchanged',
  /function PaymentForm\(\{ invoice, categories/.test(page));
ok('R10: bank reconciliation by check_number + order_number signal scoring intact',
  /chk\.order_number && desc\.indexOf\(String\(chk\.order_number\)\.toLowerCase\(\)\) >= 0/.test(page));
ok('R11: source=manual on new invoices unchanged',
  /source: 'manual'/.test(page));
ok('R12: legacy stage-D consumeFifo call (for inv_sku_id linked items) still present + unchanged',
  /if \(item\.inv_sku_id && Number\(item\.inv_qty\) > 0 && insertedItem && insertedItem\.id\) \{[\s\S]{0,500}const drain = await consumeFifo/.test(page));
ok('R13: dbInsert(invoice_items) call site count unchanged (3 sites)',
  page.split("dbInsert('invoice_items'").length === 4);
ok('R14: stage-D inv_movements insert (sale) still wired',
  /\.from\('inv_movements'\)\.insert\(\{[\s\S]{0,500}movement_type: 'sale'/.test(page));

// ══════════════════════════════════════════════════════════════════
// PART S — Stable carryover from prior builds
// ══════════════════════════════════════════════════════════════════

ok('S1: 44a SQL still defines consume_invoice_inventory (invoice-level legacy fn)',
  /CREATE OR REPLACE FUNCTION consume_invoice_inventory\(p_invoice_id uuid\)/.test(sql44a));
ok('S2: 44b SQL still adds 12 cols to invoice_items',
  /ALTER TABLE invoice_items[\s\S]{0,500}ADD COLUMN IF NOT EXISTS uses_inventory boolean DEFAULT false/.test(sql44b));
ok('S3: 44b — page.jsx still has the 📦 From Inventory tab',
  /📦 From Inventory \/ من المخزون/.test(page));
ok('S4: 44a — InventoryTab still has the cutoff admin panel',
  /Inventory Cutoff Date.*\/.*تاريخ بدء ربط المخزون/.test(read('src/components/InventoryTab.jsx')));
ok('S5: closed-tickets fetch still has NO .limit(100)',
  !/\.eq\('status', 'Closed'\)[\s\S]{0,200}\.limit\(100\)/.test(page));

// ── Version stamp ──────────────────────────────────────────────────
ok('V1: version stamp v55.83-A.6.27.44',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.44c (FIFO consumption) tests passed');
