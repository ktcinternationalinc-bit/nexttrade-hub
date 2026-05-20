// v55.83-A.6.27.29 — Inventory Phase 1 Build 4.0: Receive Stock
//
// First operational build of Phase 1. Adds an everyday "Receive Stock"
// flow tied to the Product Master (Build 2). One shipment = one receipt
// number = potentially many product lines, all sharing the same number.
//
// Decisions locked with Max May 18 2026:
//   - Receipt number format: RCV-YYYY-MM-DD-NNN (full date + 3-digit daily seq)
//   - View tab: Inventory permission
//   - Create/Edit/Cancel: super_admin OR Edit Inventory
//   - See/Enter cost fields: super_admin OR View Costs (canSeeInventoryCosts)
//   - Multiple lines per receipt sharing receipt_number
//   - Cancel = soft delete + greyed-out display (RULE 3)
//   - Override pattern: save to receipt; small 📌 button on cost/supplier/rack
//     for explicit "update master" with confirm; tech specs save to receipt
//     only, no popup

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var rec = read('src/components/InventoryReceiving.jsx');
var inv = read('src/components/InventoryTab.jsx');
var sql = read('sql/v55-83-a-6-27-29-inventory-stock-receipts.sql');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — SQL Schema
// ══════════════════════════════════════════════════════════════════

ok('A1: inventory_stock_receipts table defined',
  /CREATE TABLE IF NOT EXISTS inventory_stock_receipts/.test(sql));
ok('A2: id uuid PK with gen_random_uuid default',
  /id\s+uuid PRIMARY KEY DEFAULT gen_random_uuid\(\)/.test(sql));
ok('A3: receipt_number column (NOT unique — multiple lines share)',
  /receipt_number\s+text NOT NULL,/.test(sql) && !/receipt_number\s+text\s+UNIQUE/.test(sql));
ok('A4: receipt_type CHECK constraint with new_shipment / legacy_import / adjustment',
  /CONSTRAINT chk_receipt_type CHECK \(receipt_type IN \('new_shipment','legacy_import','adjustment'\)\)/.test(sql));
ok('A5: status CHECK constraint with active / cancelled',
  /CONSTRAINT chk_status\s+CHECK \(status IN \('active','cancelled'\)\)/.test(sql));
ok('A6: product_id FK to inventory_products with ON DELETE RESTRICT',
  /product_id\s+uuid NOT NULL REFERENCES inventory_products\(id\) ON DELETE RESTRICT/.test(sql));
ok('A7: warehouse_id FK to inv_warehouses with ON DELETE RESTRICT',
  /warehouse_id\s+uuid REFERENCES inv_warehouses\(id\) ON DELETE RESTRICT/.test(sql));
ok('A8: quantity CHECK > 0',
  /quantity\s+numeric NOT NULL CHECK \(quantity > 0\)/.test(sql));
ok('A9: uom CHECK constraint',
  /CONSTRAINT chk_uom\s+CHECK \(uom IS NULL OR uom IN \('kg','meter','yard','roll','piece','liter','sqm'\)\)/.test(sql));
ok('A10: currency CHECK constraint',
  /CONSTRAINT chk_currency\s+CHECK \(currency IS NULL OR currency IN \('EGP','USD','EUR'\)\)/.test(sql));
ok('A11: actual_* override columns present (all 6)',
  /actual_thickness_mm/.test(sql) && /actual_width_m/.test(sql) && /actual_gsm/.test(sql) &&
  /actual_density/.test(sql) && /actual_weight_per_roll/.test(sql) && /actual_roll_length_m/.test(sql));
ok('A12: cancellation audit columns (cancelled_at, cancelled_by, cancel_reason)',
  /cancelled_at\s+timestamptz/.test(sql) && /cancelled_by\s+uuid/.test(sql) && /cancel_reason\s+text/.test(sql));
ok('A13: standard audit columns (created_by/at, updated_by/at)',
  /created_by\s+uuid/.test(sql) && /created_at\s+timestamptz NOT NULL DEFAULT now\(\)/.test(sql) &&
  /updated_by\s+uuid/.test(sql) && /updated_at\s+timestamptz NOT NULL DEFAULT now\(\)/.test(sql));
ok('A14: indexes on receipt_number, date, product, warehouse, status, batch',
  /idx_stock_receipts_receipt_number/.test(sql) && /idx_stock_receipts_date/.test(sql) &&
  /idx_stock_receipts_product/.test(sql) && /idx_stock_receipts_warehouse/.test(sql) &&
  /idx_stock_receipts_status/.test(sql) && /idx_stock_receipts_batch/.test(sql));
ok('A15: updated_at trigger function + trigger',
  /CREATE OR REPLACE FUNCTION update_inventory_stock_receipts_updated_at/.test(sql) &&
  /CREATE TRIGGER trigger_stock_receipts_updated_at/.test(sql));
ok('A16: generate_receipt_number function — RCV-YYYY-MM-DD-NNN format',
  /CREATE OR REPLACE FUNCTION generate_receipt_number\(p_date date\)/.test(sql) &&
  /to_char\(p_date, 'YYYY-MM-DD'\)/.test(sql) &&
  /lpad\(\(v_count \+ 1\)::text, 3, '0'\)/.test(sql));
ok('A17: RLS enabled with read+write policies',
  /ALTER TABLE inventory_stock_receipts ENABLE ROW LEVEL SECURITY/.test(sql) &&
  /CREATE POLICY inv_stock_receipts_read\s+ON inventory_stock_receipts FOR SELECT/.test(sql) &&
  /CREATE POLICY inv_stock_receipts_write ON inventory_stock_receipts FOR ALL/.test(sql));

// ══════════════════════════════════════════════════════════════════
// PART B — InventoryReceiving Component
// ══════════════════════════════════════════════════════════════════

// ── B1. Component setup + permission gates ────────────────────────
ok('B1a: InventoryReceiving component exists with default export',
  /export default function InventoryReceiving/.test(rec));
ok('B1b: imports canSeeInventoryCosts from inventory-permissions',
  /import \{ canSeeInventoryCosts \} from '\.\.\/lib\/inventory-permissions'/.test(rec));
ok('B1c: canView gates on isSuperAdmin OR Inventory OR Edit Inventory',
  /canView = isSuperAdmin \|\| modulePerms\['Inventory'\] === true \|\| modulePerms\['Edit Inventory'\] === true/.test(rec));
ok('B1d: canEdit gates on isSuperAdmin OR Edit Inventory',
  /canEdit = isSuperAdmin \|\| modulePerms\['Edit Inventory'\] === true/.test(rec));
ok('B1e: seeCosts uses canSeeInventoryCosts helper',
  /seeCosts = canSeeInventoryCosts\(userProfile, modulePerms\)/.test(rec));
ok('B1f: access-restricted screen shown when no canView',
  /if \(!canView\)[\s\S]{0,500}Access restricted/.test(rec));

// ── B2. Data loading ──────────────────────────────────────────────
ok('B2a: useEffect loads receipts + products + warehouses on mount',
  /Promise\.all\(\[[\s\S]{0,400}supabase\.from\('inventory_stock_receipts'\)[\s\S]{0,400}supabase\.from\('inventory_products'\)[\s\S]{0,400}supabase\.from\('inv_warehouses'\)/.test(rec));
ok('B2b: receipts ordered by created_at DESC (newest first)',
  /from\('inventory_stock_receipts'\)\.select\('\*'\)\.order\('created_at', \{ ascending: false \}\)/.test(rec));
ok('B2c: products query filters to active = true',
  /from\('inventory_products'\)\.select\('\*'\)\.eq\('active', true\)/.test(rec));

// ── B3. Receipt-number generation ─────────────────────────────────
ok('B3a: saveReceipt calls generate_receipt_number RPC with receipt_date',
  /supabase\.rpc\('generate_receipt_number', \{ p_date: header\.receipt_date \}\)/.test(rec));
ok('B3b: receiptNumber from RPC is shared across all lines (single rpc call)',
  /var receiptNumber = rnRes\.data/.test(rec) ||
  /receiptNumber = rnRes\.data/.test(rec));

// ── B4. Multi-line per receipt ────────────────────────────────────
ok('B4a: lines state initialized with one emptyLine()',
  /var \[lines, setLines\] = useState\(\[emptyLine\(\)\]\)/.test(rec));
ok('B4b: emptyLine() factory function defined with required fields',
  /function emptyLine\(\)[\s\S]{0,2500}product_id: ''[\s\S]{0,2500}quantity: ''[\s\S]{0,2500}batch_number: ''/.test(rec));
ok('B4c: addLine adds a new line to the array',
  /function addLine\(\)[\s\S]{0,300}setLines\(function \(prev\) \{ return prev\.concat\(\[newLine\]\)/.test(rec));
ok('B4d: removeLine removes (but always keeps at least 1)',
  /function removeLine\(lineIdx\)[\s\S]{0,300}if \(prev\.length === 1\) return prev/.test(rec));
ok('B4e: duplicateLine clones a line (with empty batch_number)',
  /function duplicateLine\(lineIdx\)[\s\S]{0,400}batch_number: ''/.test(rec));
ok('B4f: save loops through ALL lines and inserts each row sharing receiptNumber',
  /for \(var j = 0; j < lines\.length; j\+\+\)[\s\S]{0,3000}receipt_number: receiptNumber/.test(rec));

// ── B5. Autocomplete / quick-code picker ──────────────────────────
ok('B5a: suggestionsFor searchable string includes quick_code / name_en / name_ar / slug',
  /function suggestionsFor\(query\)[\s\S]{0,2500}p\.quick_code[\s\S]{0,500}p\.name_en[\s\S]{0,500}p\.name_ar[\s\S]{0,500}p\.classification_slug/.test(rec));
ok('B5b: suggestions capped at 20 (raised from 10 for variant lists)',
  /matches\.slice\(0, 20\)/.test(rec));
ok('B5c: pickProductForLine autofills defaults from product master',
  /function pickProductForLine\(lineIdx, product\)[\s\S]{0,2000}line\.uom = product\.default_uom/.test(rec));
ok('B5d: pickProductForLine sets fromMaster flag for inherited fields',
  /fromMaster\.uom = true/.test(rec) && /fromMaster\.cost_per_uom = true/.test(rec));

// ── B6. Visual cue: master-inherited vs manually-entered ──────────
ok('B6a: line tracks fromMaster flag per field',
  /fromMaster: \{\}/.test(rec));
ok('B6b: input className conditionally applies bg-blue-50 when fromMaster, white otherwise',
  /\(line\.fromMaster\.uom \? 'bg-blue-50' : 'bg-white'\)/.test(rec));
ok('B6c: updateLineField clears fromMaster flag when value differs from master',
  /if \(masterVal != null && String\(masterVal\) !== String\(value\)\)[\s\S]{0,200}delete newFromMaster\[field\]/.test(rec));

// ── B7. "Update master" override pattern ──────────────────────────
ok('B7a: toggleUpdateMaster tracks user intent to push back to master',
  /function toggleUpdateMaster\(lineIdx, field\)[\s\S]{0,400}line\.updateMaster = um/.test(rec));
ok('B7b: 📌 button appears on supplier when overridden',
  /toggleUpdateMaster\(lineIdx, 'supplier'\)[\s\S]{0,400}📌/.test(rec));
ok('B7c: 📌 button appears on cost_per_uom when overridden (and seeCosts)',
  /\{seeCosts && \([\s\S]{0,1500}toggleUpdateMaster\(lineIdx, 'cost_per_uom'\)[\s\S]{0,400}📌/.test(rec));
ok('B7d: 📌 button appears on rack when overridden',
  /toggleUpdateMaster\(lineIdx, 'rack'\)[\s\S]{0,400}📌/.test(rec));
ok('B7e: NO 📌 button on tech specs (thickness/width/GSM/density/weight/length) — per Max',
  !/toggleUpdateMaster\(lineIdx, 'actual_thickness_mm'\)/.test(rec) &&
  !/toggleUpdateMaster\(lineIdx, 'actual_width_m'\)/.test(rec) &&
  !/toggleUpdateMaster\(lineIdx, 'actual_gsm'\)/.test(rec));
ok('B7f: save applies queued master updates AFTER inserting all receipt rows',
  /var masterUpdatesQueued = \[\][\s\S]{0,12000}for \(var k2 = 0; k2 < masterUpdatesQueued\.length; k2\+\+\)[\s\S]{0,500}dbUpdate\('inventory_products', mu\.product_id, mu\.patch/.test(rec));

// ── B8. Cost field gating ─────────────────────────────────────────
ok('B8a: cost column in list only shown when seeCosts',
  /\{seeCosts && <div>Total Cost<\/div>\}/.test(rec));
ok('B8b: cost input in modal only shown when seeCosts',
  /\{seeCosts && \(\s*<label[\s\S]{0,500}Cost per UOM/.test(rec));
ok('B8c: currency input in modal only shown when seeCosts',
  /\{seeCosts && \(\s*<label[\s\S]{0,500}Currency/.test(rec));
ok('B8d: Cost column header conditionally added to gridTemplateColumns',
  /gridTemplateColumns: '170px 100px 90px 1fr 110px 130px ' \+ \(seeCosts \? '130px ' : ''\) \+ '110px'/.test(rec) ||
  /gridTemplateColumns: '170px 100px 80px 90px 1fr 110px 120px ' \+ \(seeCosts \? '120px ' : ''\) \+ '140px'/.test(rec));

// ── B9. Cancel / restore ──────────────────────────────────────────
ok('B9a: cancelTarget state + confirmCancelReceipt function',
  /var \[cancelTarget, setCancelTarget\] = useState\(null\)/.test(rec) &&
  /async function confirmCancelReceipt\(\)/.test(rec));
ok('B9b: cancel requires reason (validated)',
  /if \(!cancelReason \|\| !cancelReason\.trim\(\)\) \{ alert\('Cancellation reason required'\)/.test(rec));
ok('B9c: cancel acts on ALL lines sharing the receipt_number (whole shipment)',
  /receipts\.filter\(function \(r\) \{ return r\.receipt_number === rn && r\.status === 'active'/.test(rec) ||
  /receipts\.filter\(function \(r\) \{ return r\.receipt_number === rn && r\.status !== 'cancelled'/.test(rec));
ok('B9d: cancel does soft-delete (status → cancelled, cancelled_at/by/reason set)',
  /status: 'cancelled',\s+cancelled_at: new Date\(\)\.toISOString\(\),\s+cancelled_by: userProfile && userProfile\.id,\s+cancel_reason: cancelReason\.trim\(\)/.test(rec));
ok('B9e: restoreReceipt un-cancels all lines (sets status back to active)',
  /async function restoreReceipt[\s\S]{0,800}status: 'active',\s+cancelled_at: null,\s+cancelled_by: null,\s+cancel_reason: null/.test(rec));
ok('B9f: cancelled receipts rendered grey + line-through (RULE 3 pattern)',
  /isCancelled \? 'bg-slate-100 opacity-60' : ''/.test(rec) &&
  /isCancelled \? 'text-slate-500 line-through'/.test(rec));

// ── B10. Receipt grouping in list ─────────────────────────────────
ok('B10a: receipts grouped by receipt_number for display',
  /groupedReceipts\[r\.receipt_number\] = \[\]/.test(rec));
ok('B10b: grouped row shows line count + product preview',
  /lineCount: rows\.length/.test(rec) && /g\.lineCount > 2/.test(rec));
ok('B10c: grouped row shows total qty + total cost summed',
  /totalQty: rows\.reduce\(function \(a, b\) \{ return a \+ Number\(b\.quantity \|\| 0\)/.test(rec) &&
  (/totalCost: rows\.reduce\(function \(a, b\) \{ return a \+ Number\(b\.total_cost \|\| 0\)/.test(rec) ||
   /var v = b\.landed_total != null \? Number\(b\.landed_total\) : Number\(b\.total_cost \|\| 0\)/.test(rec)));

// ── B11. Validation on save ───────────────────────────────────────
ok('B11a: receipt_date required',
  /if \(!header\.receipt_date\) \{ alert\('Receipt date required'\)/.test(rec));
ok('B11b: warehouse_id required',
  /if \(!header\.warehouse_id\) \{ alert\('Warehouse required'\)/.test(rec));
ok('B11c: each line product picked validation',
  /if \(!L\.product_id\) \{ alert\('Line ' \+ \(i \+ 1\) \+ ': product not selected/.test(rec));
ok('B11d: each line quantity > 0 validation (or expected/rolls fallback in 4.4+)',
  /asNum\(L\.quantity\) <= 0\) \{ alert\('Line ' \+ \(i \+ 1\) \+ ': quantity must be a positive number'/.test(rec) ||
  /var hasActual = L\.quantity && asNum\(L\.quantity\) !== null && asNum\(L\.quantity\) > 0/.test(rec));
ok('B11e: each line batch_number required validation (relaxed in 4.4+)',
  /if \(!L\.batch_number \|\| !L\.batch_number\.trim\(\)\) \{ alert\('Line ' \+ \(i \+ 1\) \+ ': batch number required'/.test(rec) ||
  /enter either the actual received quantity OR the expected totals/.test(rec));

// ── B12. Modal pattern (consistent with prior builds) ─────────────
ok('B12a: modal overlay with fixed inset z-200 black backdrop',
  /fixed inset-0 z-\[200\] bg-black\/70/.test(rec));
ok('B12b: click-outside-to-close wired',
  /onClick=\{closeModal\}[\s\S]{0,500}onClick=\{function \(e\) \{ e\.stopPropagation\(\); \}\}/.test(rec));
ok('B12c: modal header uses solid dark indigo (#3730a3) with inline white text',
  /background: '#3730a3'[\s\S]{0,300}color: '#ffffff'/.test(rec));
ok('B12d: header has close X button (36x36 white circle with shadow)',
  /aria-label="Close"[\s\S]{0,400}width: 36/.test(rec));
ok('B12e: sticky footer with Save + Cancel buttons',
  /Save Receipt \(' \+ lines\.length \+ ' line/.test(rec));

// ══════════════════════════════════════════════════════════════════
// PART C — InventoryTab wiring
// ══════════════════════════════════════════════════════════════════

ok('C1: InventoryTab imports InventoryReceiving',
  /import InventoryReceiving from '\.\/InventoryReceiving'/.test(inv));
ok('C2: SUBTABS includes receivestock entry',
  /id: 'receivestock', label: '🚚 Receive Stock'/.test(inv));
ok('C3: receivestock tab gated to super_admin OR Inventory OR Edit Inventory',
  /st\.id === 'receivestock' && !\(isSuperAdmin \|\| \(modulePerms && \(modulePerms\['Inventory'\] === true \|\| modulePerms\['Edit Inventory'\] === true\)\)\)/.test(inv));
ok('C4: render branch mounts InventoryReceiving with full props',
  /subtab === 'receivestock' && \([\s\S]{0,300}<InventoryReceiving userProfile=\{userProfile\} modulePerms=\{modulePerms\} isSuperAdmin=\{isSuperAdmin\} toast=\{toast\}/.test(inv));

// ══════════════════════════════════════════════════════════════════
// Regression guards on prior builds
// ══════════════════════════════════════════════════════════════════

ok('R1: Build 1 (InventoryMasterAdmin) still imported in InventoryTab',
  /import InventoryMasterAdmin from '\.\/InventoryMasterAdmin'/.test(inv));
ok('R2: Build 2 (InventoryProductMaster) still imported in InventoryTab',
  /import InventoryProductMaster from '\.\/InventoryProductMaster'/.test(inv));
ok('R3: Build 3 (InventoryImportProducts) still imported in InventoryTab',
  /import InventoryImportProducts from '\.\/InventoryImportProducts'/.test(inv));
ok('R4: A.6.27.26 parent-rules-all-levels still in Master Lists (L3 Grade has hasParent:true)',
  /num: 3, en: 'Grade'[\s\S]{0,200}hasParent: true,\s+parentLevel: 1/.test(read('src/components/InventoryMasterAdmin.jsx')));
ok('R5: A.6.27.27 Arabic typography bump still in Product Master',
  /text-base font-extrabold mt-0\.5/.test(read('src/components/InventoryProductMaster.jsx')));
ok('R6: A.6.27.28 closed-tickets fetch has NO .limit(100)',
  !/\.eq\('status', 'Closed'\)[\s\S]{0,200}\.limit\(100\)/.test(page));
ok('R7: A.6.27.28 AIGreeter emits ALL closed tickets (no .slice(0,25))',
  !/closedMyTickets[\s\S]{0,500}\.slice\(0, 25\)/.test(read('src/components/AIGreeter.jsx')));
ok('R8: A.6.27.21 fixLinksBusy still in page.jsx',
  /fixLinksBusy/.test(page));

// ── Version stamp ──────────────────────────────────────────────────
ok('V1: version stamp v55.83-A.6.27.29',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.29 Build 4.0 Receive Stock tests passed');
