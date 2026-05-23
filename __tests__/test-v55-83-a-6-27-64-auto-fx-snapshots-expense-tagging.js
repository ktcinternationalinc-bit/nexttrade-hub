// v55.83-A.6.27.64 — Auto FX snapshot capture in receipt + sale RPCs.
//                    Expense-to-advance tagging dropdown in warehouse expense form.

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var sql  = read('sql/v55-83-a-6-27-64-auto-fx-snapshots.sql');
var wn   = read('src/components/WhatsNewWidget.jsx');
var fxp  = read('src/components/FxPnLReport.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — SQL migration
// ══════════════════════════════════════════════════════════════════
ok('A1: ALTER invoice_items ADD cost_egp_at_sale',
  /ALTER TABLE invoice_items\s+ADD COLUMN IF NOT EXISTS cost_egp_at_sale NUMERIC\(14,2\)/.test(sql));
ok('A2: ALTER invoice_items ADD fx_rate_at_sale',
  /ALTER TABLE invoice_items\s+ADD COLUMN IF NOT EXISTS fx_rate_at_sale\s+NUMERIC\(14,6\)/.test(sql));
ok('A3: REPLACES on_receipt_finalize_create_ledger trigger',
  /CREATE OR REPLACE FUNCTION on_receipt_finalize_create_ledger\(\)/.test(sql));
ok('A4: receipt trigger DECLAREs FX vars (v_layer_currency, v_fx_rate, v_cost_egp_per_uom)',
  /v_layer_currency\s+text/.test(sql) &&
  /v_fx_rate\s+numeric/.test(sql) &&
  /v_cost_egp_per_uom\s+numeric/.test(sql));
ok('A5: receipt trigger branches on EGP vs other currency',
  /IF v_layer_currency = 'EGP' THEN/.test(sql) &&
  /v_fx_rate := 1/.test(sql) &&
  /v_cost_egp_per_uom := NEW\.landed_cost_per_uom/.test(sql));
ok('A6: receipt trigger calls fx_rate_for_date for non-EGP currencies',
  /v_fx_rate := fx_rate_for_date\(v_layer_currency, 'EGP', NEW\.receipt_date\)/.test(sql));
ok('A7: receipt trigger has EXCEPTION WHEN undefined_function graceful degrade',
  /EXCEPTION WHEN undefined_function THEN[\s\S]{0,200}v_fx_rate := NULL/.test(sql));
ok('A8: receipt trigger INSERT includes cost_egp_at_receipt + fx_rate_at_receipt',
  /INSERT INTO inventory_layers \([\s\S]{0,400}cost_egp_at_receipt, fx_rate_at_receipt/.test(sql) &&
  /v_cost_egp_per_uom, v_fx_rate/.test(sql));
ok('A9: REPLACES consume_invoice_item_inventory',
  /CREATE OR REPLACE FUNCTION consume_invoice_item_inventory\(p_item_id uuid\)/.test(sql));
ok('A10: sale fn DECLAREs v_invoice_date + v_fx_rate_at_sale + v_cost_egp_at_sale + v_layer_fx',
  /v_invoice_date\s+date/.test(sql) &&
  /v_fx_rate_at_sale\s+numeric/.test(sql) &&
  /v_cost_egp_at_sale\s+numeric := 0/.test(sql) &&
  /v_layer_fx\s+numeric/.test(sql));
ok('A11: sale fn looks up invoice_date from invoices table',
  /SELECT invoice_date INTO v_invoice_date FROM invoices WHERE id = v_item\.invoice_id/.test(sql));
ok('A12: sale fn reads cost_currency from each layer',
  /SELECT id, product_id, warehouse_id, cost_per_uom, cost_currency, qty_remaining, receipt_date/.test(sql));
ok('A13: sale fn branches on EGP layer (no FX) vs non-EGP',
  /IF v_layer\.cost_currency = 'EGP' OR v_layer\.cost_currency IS NULL THEN/.test(sql) &&
  /v_cost_egp_at_sale := v_cost_egp_at_sale \+ v_consumed_cost/.test(sql));
ok('A14: sale fn uses INVOICE date for FX lookup (not layer receipt_date)',
  /fx_rate_for_date\(v_layer\.cost_currency, 'EGP', v_invoice_date\)/.test(sql));
ok('A15: sale fn accumulates per-slice EGP cost using sale-day rate',
  /v_cost_egp_at_sale := v_cost_egp_at_sale \+ \(v_consumed_cost \* v_layer_fx\)/.test(sql));
ok('A16: sale fn UPDATE stamps cost_egp_at_sale + fx_rate_at_sale on invoice_items',
  /cost_egp_at_sale\s+= CASE WHEN v_cost_egp_at_sale > 0 THEN v_cost_egp_at_sale ELSE NULL END/.test(sql) &&
  /fx_rate_at_sale\s+= v_fx_rate_at_sale/.test(sql));
ok('A17: sale fn returns FX info in jsonb',
  /'cost_egp_at_sale', v_cost_egp_at_sale/.test(sql) &&
  /'fx_rate_at_sale', v_fx_rate_at_sale/.test(sql));
ok('A18: sale fn preserves existing FIFO/idempotency/backorder logic',
  /already_consumed/.test(sql) &&
  /inventory_backorders/.test(sql) &&
  /backorder_qty/.test(sql));
ok('A19: SQL is REPLACE-only + ADD-COLUMN (no drops, no breaking changes)',
  !/DROP TABLE/.test(sql) &&
  !/DROP COLUMN/.test(sql.split('BACKOUT')[0]) && // backout block has DROPs but main body doesn't
  /CREATE OR REPLACE FUNCTION/.test(sql));
ok('A20: SQL has backout block',
  /BACKOUT[\s\S]{0,500}DROP COLUMN IF EXISTS cost_egp_at_sale/.test(sql) &&
  /DROP COLUMN IF EXISTS fx_rate_at_sale/.test(sql));

// ══════════════════════════════════════════════════════════════════
// PART B — page.jsx warehouseAdvances state + load
// ══════════════════════════════════════════════════════════════════
ok('B1: warehouseAdvances state declared',
  /const \[warehouseAdvances, setWarehouseAdvances\] = useState\(\[\]\)/.test(page));
ok('B2: advances load fetches open advances with key columns',
  /supabase\.from\('warehouse_advances'\)\.select\('id, issue_date, amount, currency, recipient_name, recipient_role, status'\)\.eq\('status', 'open'\)/.test(page));
ok('B3: advances load ordered by issue_date desc',
  /\.eq\('status', 'open'\)\.order\('issue_date', \{ ascending: false \}\)/.test(page));
ok('B4: advances load has graceful try/catch (table may not exist yet)',
  /try \{[\s\S]{0,500}setWarehouseAdvances\(advRows \|\| \[\]\);[\s\S]{0,200}\} catch \(e\) \{ setWarehouseAdvances\(\[\]\); \}/.test(page));

// ══════════════════════════════════════════════════════════════════
// PART C — Warehouse expense form dropdown
// ══════════════════════════════════════════════════════════════════
ok('C1: dropdown only shown when warehouseAdvances.length > 0',
  /\{warehouseAdvances\.length > 0 && \(/.test(page));
ok('C2: dropdown label says "Link to Advance"',
  /💵 Link to Advance \(optional\) \/ ربط بسلفة/.test(page));
ok('C3: dropdown has empty/none default option',
  /<option value="">\(none — company paid\)<\/option>/.test(page));
ok('C4: dropdown maps warehouseAdvances with key + label format',
  /warehouseAdvances\.map\(a => \(\s+<option key=\{a\.id\} value=\{a\.id\}>/.test(page));
ok('C5: dropdown shows recipient_name + role + amount + currency + date',
  /\{a\.recipient_name\}\{a\.recipient_role \? ' \(' \+ a\.recipient_role \+ '\)' : ''\} · \{Number\(a\.amount\)\.toLocaleString\(\)\} \{a\.currency \|\| 'EGP'\} · \{a\.issue_date\}/.test(page));
ok('C6: dropdown change handler sets formData.whAdvanceId',
  /onChange=\{e => setFormData\(\{\.\.\.formData, whAdvanceId: e\.target\.value\}\)\}/.test(page));
ok('C7: dropdown uses formData.whAdvanceId for value',
  /value=\{formData\.whAdvanceId \|\| ''\}/.test(page));
ok('C8: expense insert payload includes advance_id',
  /advance_id: formData\.whAdvanceId \|\| null/.test(page));
ok('C9: reset clears whAdvanceId after save',
  /whAdvanceId: ''/.test(page));
ok('C10: hint text explains "pick the advance" + "leave blank if company paid"',
  /Pick the advance this expense was paid from/.test(page) &&
  /Leave blank if it was paid directly by the company/.test(page));

// ══════════════════════════════════════════════════════════════════
// PART D — FxPnLReport small tolerance fix
// ══════════════════════════════════════════════════════════════════
ok('D1: FxPnLReport tolerates both received_at and receipt_date column names',
  /l\.received_at \|\| l\.receipt_date/.test(fxp));

// ══════════════════════════════════════════════════════════════════
// PART R — REGRESSION GUARDS
// ══════════════════════════════════════════════════════════════════
ok('R1: 63 — fx_rates SQL preserved',
  fs.existsSync(path.join(__dirname, '..', 'sql/v55-83-a-6-27-63-fx-rates-and-snapshots.sql')));
ok('R2: 63 — FxRatesPanel preserved',
  fs.existsSync(path.join(__dirname, '..', 'src/components/FxRatesPanel.jsx')));
ok('R3: 63 — FxPnLReport preserved',
  fs.existsSync(path.join(__dirname, '..', 'src/components/FxPnLReport.jsx')));
ok('R4: 63 — fxrates + fxpnl subtabs preserved',
  /\{ id: 'fxrates'/.test(read('src/components/InventoryTab.jsx')) &&
  /\{ id: 'fxpnl'/.test(read('src/components/InventoryTab.jsx')));
ok('R5: 62 — warehouse_advances SQL preserved',
  fs.existsSync(path.join(__dirname, '..', 'sql/v55-83-a-6-27-62-warehouse-advances.sql')));
ok('R6: 62 — WarehouseAdvancesTab preserved',
  fs.existsSync(path.join(__dirname, '..', 'src/components/WarehouseAdvancesTab.jsx')));
ok('R7: 61 — AttachmentManager preserved',
  fs.existsSync(path.join(__dirname, '..', 'src/components/AttachmentManager.jsx')));
ok('R8: 60 — Deactivate-blocks-login fix preserved',
  /profile && profile\.active === false/.test(read('src/app/login/page.jsx')));
ok('R9: 60 — Product Overview history modal preserved',
  /function openHistory\(product\)/.test(read('src/components/InventoryOverview.jsx')));
ok('R10: 59 — mini-invoice + Invoice button preserved',
  /\+ Invoice/.test(read('src/components/OpenAccountsTab.jsx')));
ok('R11: 55 — openaccounts in FINANCE sidebar preserved',
  /\{ group: 'FINANCE', items: \['sales', 'treasury', 'checks', 'debts', 'openaccounts'/.test(page));
ok('R12: closed-tickets fetch still has NO .limit(100)',
  !/\.eq\('status', 'Closed'\)[\s\S]{0,200}\.limit\(100\)/.test(page));
ok('R13: WhatsNew widget has .64 entry',
  /version: 'v55\.83-A\.6\.27\.64'/.test(wn));
ok('R14: WhatsNew widget still has .63 + .62 + .61 + .60 entries',
  /version: 'v55\.83-A\.6\.27\.63'/.test(wn) &&
  /version: 'v55\.83-A\.6\.27\.62'/.test(wn) &&
  /version: 'v55\.83-A\.6\.27\.61'/.test(wn) &&
  /version: 'v55\.83-A\.6\.27\.60'/.test(wn));

// ──────────────────────────────────────────────────────────────────
// Version stamp
// ──────────────────────────────────────────────────────────────────
ok('V1: version stamp v55.83-A.6.27.64 or later',
  /BUILD v55\.83-A\.6\.27\.(64|6[5-9]|[7-9]\d)/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.64 tests passed');
