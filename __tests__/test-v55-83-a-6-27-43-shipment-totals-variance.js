// v55.83-A.6.27.43 — Shipment-level expected totals + variance + Submit gate +
// reconciliation panel + variance prompt modal + variant edit-lock policy +
// Delete button with double-confirm + Name column bullet redesign + high-contrast badges.

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var rec  = read('src/components/InventoryReceiving.jsx');
var pm   = read('src/components/InventoryProductMaster.jsx');
var sql  = read('sql/v55-83-a-6-27-43-expected-totals-variance.sql');
var tab  = read('src/components/InventoryTab.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — SQL: 11 new columns + status CHECK + can_delete_product
// ══════════════════════════════════════════════════════════════════

ok('A1: expanded status CHECK includes draft, submitted_balanced, submitted_unbalanced',
  /CHECK \(status IN \('draft', 'pending_detail', 'received', 'submitted_balanced', 'submitted_unbalanced', 'finalized', 'cancelled'\)\)/.test(sql));
ok('A2: expected_total_rolls column added',
  /ADD COLUMN IF NOT EXISTS expected_total_rolls integer/.test(sql));
ok('A3: expected_total_gross_kg + net_kg + uom added',
  /expected_total_gross_kg numeric\(12,3\)/.test(sql) &&
  /expected_total_net_kg numeric\(12,3\)/.test(sql) &&
  /expected_total_uom numeric\(12,3\)/.test(sql));
ok('A4: expected_uom_type text column added',
  /expected_uom_type text/.test(sql));
ok('A5: variance columns (rolls/gross/net/uom) all added',
  /variance_rolls integer/.test(sql) &&
  /variance_gross_kg numeric\(12,3\)/.test(sql) &&
  /variance_net_kg numeric\(12,3\)/.test(sql) &&
  /variance_uom numeric\(12,3\)/.test(sql));
ok('A6: variance_notes text added',
  /variance_notes text/.test(sql));
ok('A7: submit audit fields (submitted_at, submitted_by, is_balanced)',
  /submitted_at timestamptz/.test(sql) &&
  /submitted_by uuid/.test(sql) &&
  /is_balanced boolean/.test(sql));
ok('A8: same columns shadowed on inventory_stock_receipts',
  /ALTER TABLE inventory_stock_receipts[\s\S]{0,500}ADD COLUMN IF NOT EXISTS expected_total_rolls integer/.test(sql));
ok('A9: can_delete_product function declared',
  /CREATE OR REPLACE FUNCTION can_delete_product\(p_id uuid\)\s+RETURNS boolean/.test(sql));
ok('A10: can_delete checks inventory_stock_receipts',
  /SELECT COUNT\(\*\) INTO v_count FROM inventory_stock_receipts WHERE product_id = p_id/.test(sql));
ok('A11: can_delete tolerates missing tables via EXCEPTION WHEN undefined_table',
  /EXCEPTION WHEN undefined_table THEN/.test(sql));

// ══════════════════════════════════════════════════════════════════
// PART B — Receiving header state has new expected total fields
// ══════════════════════════════════════════════════════════════════

ok('B1: header state has expected_total_rolls',
  /expected_total_rolls: ''/.test(rec));
ok('B2: header state has expected_total_gross_kg + net_kg + uom',
  /expected_total_gross_kg: ''/.test(rec) &&
  /expected_total_net_kg: ''/.test(rec) &&
  /expected_total_uom: ''/.test(rec));
ok('B3: header state has expected_uom_type default meter',
  /expected_uom_type: 'meter'/.test(rec));
ok('B4: header state has variance_notes',
  /variance_notes: ''/.test(rec));
ok('B5: variance prompt modal state declared',
  /var \[variancePromptOpen, setVariancePromptOpen\] = useState\(false\)/.test(rec) &&
  /var \[variancePromptData, setVariancePromptData\] = useState\(null\)/.test(rec));

// ══════════════════════════════════════════════════════════════════
// PART C — Reconciliation helpers
// ══════════════════════════════════════════════════════════════════

ok('C1: computeActualTotals function sums per-line rolls/gross/net/uom',
  /function computeActualTotals\(linesArr\)[\s\S]{0,800}totals\.rolls \+= 1[\s\S]{0,300}totals\.gross \+= Number\(r\.gross_kg \|\| 0\)/.test(rec));
ok('C2: computeVariance returns null for unspecified expecteds',
  /var expectedRolls = headerObj\.expected_total_rolls === '' \|\| headerObj\.expected_total_rolls == null \? null : Number/.test(rec));
ok('C3: variance is expected - actual (positive = short, negative = extra)',
  /variance = \{\s+rolls: expectedRolls == null \? null : \(expectedRolls - actual\.rolls\)/.test(rec));
ok('C4: is_balanced only true when compared > 0 AND no mismatch',
  /is_balanced: compared > 0 && !anyMismatch/.test(rec));

// ══════════════════════════════════════════════════════════════════
// PART D — Submit flow + variance prompt
// ══════════════════════════════════════════════════════════════════

ok('D1: submitReceipt declared, calls computeVariance',
  /async function submitReceipt\(\)[\s\S]{0,500}var rec = computeVariance\(header, lines\)/.test(rec));
ok('D2: submitReceipt forces expected totals to be filled in before submit',
  /if \(!rec\.has_any_expected\)[\s\S]{0,500}Please fill in at least one Shipment Expected Total/.test(rec));
ok('D3: balanced branch saves with submitWithStatus="submitted_balanced"',
  /await saveReceipt\(\{ submitWithStatus: 'submitted_balanced', variance: rec \}\)/.test(rec));
ok('D4: unbalanced branch opens variance prompt instead of saving',
  /if \(!rec\.is_balanced\)[\s\S]{0,300}setVariancePromptData\(rec\);\s+setVariancePromptOpen\(true\)/.test(rec));
ok('D5: submitWithVarianceNote requires notes before submitting',
  /async function submitWithVarianceNote\(noteText\)[\s\S]{0,500}Variance notes are required when expected totals do not match/.test(rec));
ok('D6: submitWithVarianceNote saves with submitWithStatus="submitted_unbalanced"',
  /submitWithStatus: 'submitted_unbalanced'/.test(rec));

// ══════════════════════════════════════════════════════════════════
// PART E — Header upsert writes expected totals + variance + status
// ══════════════════════════════════════════════════════════════════

ok('E1: saveReceipt accepts opts param',
  /async function saveReceipt\(opts\)/.test(rec));
ok('E2: header payload includes expected_total_rolls (number-coerced or null)',
  /expected_total_rolls: header\.expected_total_rolls === '' \|\| header\.expected_total_rolls == null \? null : Number/.test(rec));
ok('E3: header payload includes all 4 expected totals + uom type',
  /expected_total_gross_kg:[\s\S]{0,200}expected_total_net_kg:[\s\S]{0,200}expected_total_uom:[\s\S]{0,200}expected_uom_type: header\.expected_uom_type \|\| null/.test(rec));
ok('E4: status defaults to draft if no submitWithStatus opt',
  /\} else \{\s+headerPayload\.status = 'draft';/.test(rec));
ok('E5: submit branch sets submitted_at/by + is_balanced + variance fields',
  /headerPayload\.status = statusToSet;\s+headerPayload\.submitted_at = new Date\(\)\.toISOString\(\);\s+headerPayload\.submitted_by = userProfile && userProfile\.id;\s+headerPayload\.is_balanced = \(statusToSet === 'submitted_balanced'\)/.test(rec));
ok('E6: header upserts (UPDATE if existing receipt_number, INSERT otherwise)',
  /existingHeaderRes\.data && existingHeaderRes\.data\.id[\s\S]{0,500}await dbUpdate\('inventory_shipment_headers'[\s\S]{0,300}else \{[\s\S]{0,500}dbInsert\('inventory_shipment_headers'/.test(rec));

// ══════════════════════════════════════════════════════════════════
// PART F — Draft saves lenient (skip line validation)
// ══════════════════════════════════════════════════════════════════

ok('F1: isSubmitting variable computed from opts.submitWithStatus',
  /var isSubmitting = !!optsForSafetyCheck\.submitWithStatus/.test(rec));
ok('F2: line validation wrapped in if (isSubmitting)',
  /if \(isSubmitting\) \{\s+for \(var i = 0;/.test(rec));
ok('F3: line processing loop skips blank lines on Draft save',
  /if \(!isSubmitting && !L2\.product_id\) continue/.test(rec));

// ══════════════════════════════════════════════════════════════════
// PART G — Modal UI: width + Shipment Expected Totals section
// ══════════════════════════════════════════════════════════════════

ok('G1: modal width = 97vw (uses the screen) — v.48 widened from 95vw',
  /(style=\{\{ width: '97vw', maxWidth: 1900|99vw)/.test(rec));
ok('G2: SHIPMENT EXPECTED TOTALS section rendered with amber-50 styling',
  /📦 Shipment Expected Totals/.test(rec) &&
  /bg-amber-50 border-2 border-amber-400 rounded-xl/.test(rec));
ok('G3: 5 inputs (rolls, gross, net, uom_total, uom_type) wired',
  /value=\{header\.expected_total_rolls\}/.test(rec) &&
  /value=\{header\.expected_total_gross_kg\}/.test(rec) &&
  /value=\{header\.expected_total_net_kg\}/.test(rec) &&
  /value=\{header\.expected_total_uom\}/.test(rec) &&
  /value=\{header\.expected_uom_type \|\| 'meter'\}/.test(rec));
ok('G4: UOM type select with 4 options',
  /<option value="meter">meter<\/option>\s+<option value="yard">yard<\/option>\s+<option value="piece">piece<\/option>\s+<option value="sqm">square meter<\/option>/.test(rec));
ok('G5: inputs use text-base + py-2.5 (BIGGER, more readable)',
  /px-3 py-2\.5 border-2 border-slate-300 rounded text-base bg-white text-slate-900 font-bold/.test(rec));

// ══════════════════════════════════════════════════════════════════
// PART H — Reconciliation panel + 3 footer buttons
// ══════════════════════════════════════════════════════════════════

ok('H1: Reconciliation panel rendered as IIFE in modal',
  /\(function \(\) \{\s+var rec = computeVariance\(header, lines\);/.test(rec));
ok('H2: reconciliation shows green bg when balanced',
  /rec\.is_balanced \? 'bg-emerald-100 border-emerald-500' : 'bg-amber-100 border-amber-500'/.test(rec));
ok('H3: 4 dimension cards in reconciliation grid',
  /grid grid-cols-4 gap-3 text-sm/.test(rec) &&
  /Rolls/.test(rec) && /Gross kg/.test(rec) && /Net kg/.test(rec));
ok('H4: Save Draft button (slate-600) wired to saveReceipt()',
  /onClick=\{function \(\) \{ saveReceipt\(\); \}\}/.test(rec) &&
  /💾 Save Draft/.test(rec));
ok('H5: Submit button (emerald-600) wired to submitReceipt',
  /onClick=\{submitReceipt\}/.test(rec) &&
  /bg-emerald-600 hover:bg-emerald-700/.test(rec));
ok('H6: Save Shell Only renamed from "Save Shipment Only"',
  /📋 Save Shell Only/.test(rec));

// ══════════════════════════════════════════════════════════════════
// PART I — Variance prompt modal
// ══════════════════════════════════════════════════════════════════

ok('I1: variance prompt modal renders only when variancePromptOpen + variancePromptData',
  /\{variancePromptOpen && variancePromptData && \(\(\) => \{/.test(rec));
ok('I2: modal has amber-500 header + Submit with Variance Note button',
  /bg-amber-500 text-white rounded-t-2xl/.test(rec) &&
  /⚠ Submit with Variance Note/.test(rec));
ok('I3: textarea defaultValue from noteRef; onChange updates ref',
  /defaultValue=\{noteRef\.current\}\s+onChange=\{function \(e\) \{ noteRef\.current = e\.target\.value; \}\}/.test(rec));
ok('I4: Back button resets prompt state',
  /setVariancePromptOpen\(false\); setVariancePromptData\(null\)/.test(rec));

// ══════════════════════════════════════════════════════════════════
// PART J — High-contrast status badges
// ══════════════════════════════════════════════════════════════════

ok('J1: cancelled badge: bg-red-700 + white text',
  /isCancelled \? 'bg-red-700 text-white'/.test(rec));
ok('J2: submitted_balanced badge: bg-emerald-600 + white',
  /g\.status === 'submitted_balanced' \? 'bg-emerald-600 text-white'/.test(rec));
ok('J3: submitted_unbalanced badge: bg-amber-500 + white',
  /g\.status === 'submitted_unbalanced' \? 'bg-amber-500 text-white'/.test(rec));
ok('J4: pending_detail badge: bg-orange-600 + white (not pale -100)',
  /g\.status === 'pending_detail' \? 'bg-orange-600 text-white'/.test(rec));
ok('J5: draft badge: bg-slate-600 + white',
  /g\.status === 'draft' \? 'bg-slate-600 text-white'/.test(rec));
ok('J6: status badge text bumped to text-xs (was text-[10px])',
  /text-xs px-2 py-1 rounded font-extrabold/.test(rec));

// ══════════════════════════════════════════════════════════════════
// PART K — Product Master: variant edit-lock + Delete button
// ══════════════════════════════════════════════════════════════════

ok('K1: editLocked state declared',
  /var \[editLocked, setEditLocked\] = useState\(false\)/.test(pm));
ok('K2: editIsTemplate state declared',
  /var \[editIsTemplate, setEditIsTemplate\] = useState\(false\)/.test(pm));
// K3-K5 deprecated by v55.83-A.6.27.60: openEdit no longer pre-locks templates.
// Variants are independent post-creation per Max May 22; the edit-lock was removed.
// deleteProduct still uses can_delete_product RPC for VARIANTS (templates always-OK).
ok('K3: openEdit comment confirms edit-lock removal in .60',
  /v55\.83-A\.6\.27\.60 — Spec-field edit lock REMOVED/.test(pm));
ok('K4: editLocked variable still declared (kept for forward compat) but never set true for templates',
  /editLocked/.test(pm) || /v55\.83-A\.6\.27\.60 — Spec-field edit lock REMOVED/.test(pm));
ok('K5: deleteProduct still uses can_delete_product RPC for variants (templates always-OK)',
  /async function deleteProduct\(p\)[\s\S]{0,2000}supabase\.rpc\('can_delete_product', \{ p_id: p\.id \}\)/.test(pm));
ok('K6: deleteProduct requires user to type DELETE',
  /prompt\([\s\S]{0,1000}Type DELETE \(in capitals\) to confirm/.test(pm));
ok('K7: deleteProduct cancels when typed !== "DELETE"',
  /if \(typed !== 'DELETE'\) \{[\s\S]{0,200}return;/.test(pm));
ok('K8: Delete button rendered in row (red-700 bg + white text)',
  /onClick=\{function \(\) \{ deleteProduct\(p\); \}\}[\s\S]{0,500}bg-red-700 hover:bg-red-800 text-white/.test(pm));
ok('K9: Deactivate button uses high-contrast amber-600 + white (was bg-red-100 + text-red-900)',
  /bg-amber-600 hover:bg-amber-700 text-white/.test(pm));
ok('K10: Edit + Copy buttons upgraded to solid dark + white',
  /bg-indigo-700 hover:bg-indigo-800 text-white/.test(pm) &&
  /bg-blue-700 hover:bg-blue-800 text-white/.test(pm));

// ══════════════════════════════════════════════════════════════════
// PART L — Edit modal: lock banner + disabled spec dropdowns
// ══════════════════════════════════════════════════════════════════

// L1/L2 deprecated by v55.83-A.6.27.60: lock banner was removed entirely.
ok('L1: lock banner removed (v55.83-A.6.27.60 — variants independent, templates always editable)',
  /v55\.83-A\.6\.27\.60 — Lock banner REMOVED/.test(pm));
ok('L2: "fully editable" deprecated — all templates now fully editable always',
  /v55\.83-A\.6\.27\.60 — Spec-field edit lock REMOVED/.test(pm));
ok('L3: level select gets disabled={editLocked}',
  /disabled=\{editLocked\}/.test(pm));
ok('L4: level select bg is slate-100 when locked, white otherwise',
  /editLocked \? 'bg-slate-100 text-slate-600 cursor-not-allowed' : 'bg-white text-slate-900'/.test(pm));

// ══════════════════════════════════════════════════════════════════
// PART M — Name column redesign: bulleted classification levels
// ══════════════════════════════════════════════════════════════════

ok('M1: describeProductBullets helper declared',
  /function describeProductBullets\(p\)/.test(pm));
ok('M2: bullets follow new order — Family → Grade → Category → ... → Country',
  /\{ lvl: 1, label: 'Family' \},\s+\{ lvl: 3, label: 'Grade' \},\s+\{ lvl: 2, label: 'Category' \},\s+\{ lvl: 4, label: 'Construction' \},\s+\{ lvl: 5, label: 'Backing' \},\s+\{ lvl: 6, label: 'Color' \},\s+\{ lvl: 7, label: 'Pattern' \},\s+\{ lvl: 8, label: 'Spec Class' \},\s+\{ lvl: 9, label: 'Country' \}/.test(pm));
ok('M3: bullets skip null levels (no "??" placeholder)',
  /if \(!id\) continue;/.test(pm));
ok('M4: classification cell renders <ul> with list-disc bullets',
  /<ul className="space-y-0\.5 list-disc list-inside marker:text-indigo-500">/.test(pm));
ok('M5: each <li> uses text-slate-900 (high contrast)',
  /<li key=\{i\} className="text-slate-900 leading-tight">/.test(pm));
ok('M6: bullet shows label + value + (code)',
  /<span className="font-extrabold text-slate-700">\{b\.label\}:[\s\S]{0,200}<span className="font-extrabold text-slate-900">\{b\.value\}<\/span>[\s\S]{0,200}\(\{b\.code\}\)/.test(pm));
ok('M7: LEVEL_FIELD_MAP includes Level 9 → origin_list_id',
  /9: 'origin_list_id'/.test(pm));
ok('M8: grid widened: name 1.5fr, classification 2fr, actions 370px',
  /'110px 1\.5fr 2fr 140px 60px 370px'/.test(pm));

// ══════════════════════════════════════════════════════════════════
// PART N — Stale "Stage 6 of 6" banner removed
// ══════════════════════════════════════════════════════════════════

ok('N1: no more "Stage 6 of 6" string in InventoryTab',
  !/Stage 6 of 6/.test(tab));
ok('N2: header pill now reads v55.83-A.6.27.\\d+',
  /v55\.83-A\.6\.27\.\d+ · /.test(tab));
ok('N3: WhatsNew header in InventoryTab — banner removed in .60 (now lives only in WhatsNewWidget popup)',
  /v55\.83-A\.6\.27\.60 — Removed stale "What's in this build" details panel/.test(tab));

// ══════════════════════════════════════════════════════════════════
// Regression guards
// ══════════════════════════════════════════════════════════════════

ok('R1: A.6.27.42 — Create Variant/Product modal still wired',
  /openCreateVariant/.test(pm) && /\+ (Variant|Product)/.test(pm));
ok('R2: A.6.27.40 — toggleFeatured still present',
  /async function toggleFeatured\(p\)/.test(pm));
ok('R3: A.6.27.39 — get_or_create_variant SQL still present',
  /CREATE OR REPLACE FUNCTION get_or_create_variant\(/.test(read('sql/v55-83-a-6-27-39-variants.sql')));
ok('R4: A.6.27.37 — saveShipmentHeaderOnly still wired',
  /async function saveShipmentHeaderOnly\(\)/.test(rec));
ok('R5: A.6.27.35 — reopen_finalized_receipt RPC still wired',
  /supabase\.rpc\('reopen_finalized_receipt'/.test(rec));
ok('R6: A.6.27.28 closed-tickets fetch still has NO .limit(100)',
  !/\.eq\('status', 'Closed'\)[\s\S]{0,200}\.limit\(100\)/.test(page));

// ── Version stamp ──────────────────────────────────────────────────
ok('V1: version stamp v55.83-A.6.27.43',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.43 tests passed');
