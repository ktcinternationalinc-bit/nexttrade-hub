// v55.83-A.6.27.35 — Inventory Phase 1 Build 4.4: Two-Phase Receiving + Roll Detail + Edit/Reopen
//
// - New child table inventory_receipt_rolls (one row per physical roll)
// - Status enum extended with 'pending_detail'
// - expected_* columns on inventory_stock_receipts (rolls/gross/net/uom_total)
// - reopen_finalized_receipt() SQL function
// - openEdit + reopenReceipt JS functions
// - Modal UI: Phase 1 expected totals section + Phase 2 individual rolls editor + variance summary
// - USD as default purchase_currency (was EGP)

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var rec = read('src/components/InventoryReceiving.jsx');
var sql = read('sql/v55-83-a-6-27-35-inventory-two-phase-receiving.sql');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — SQL Migration
// ══════════════════════════════════════════════════════════════════

ok('A1: SQL adds expected_rolls column',
  /ALTER TABLE inventory_stock_receipts ADD COLUMN IF NOT EXISTS expected_rolls\s+integer/.test(sql));
ok('A2: SQL adds expected_gross_kg column',
  /ALTER TABLE inventory_stock_receipts ADD COLUMN IF NOT EXISTS expected_gross_kg\s+numeric/.test(sql));
ok('A3: SQL adds expected_net_kg column',
  /ALTER TABLE inventory_stock_receipts ADD COLUMN IF NOT EXISTS expected_net_kg\s+numeric/.test(sql));
ok('A4: SQL adds expected_uom_total column',
  /ALTER TABLE inventory_stock_receipts ADD COLUMN IF NOT EXISTS expected_uom_total\s+numeric/.test(sql));
ok('A5: SQL adds variance_acknowledged column',
  /ALTER TABLE inventory_stock_receipts ADD COLUMN IF NOT EXISTS variance_acknowledged\s+boolean/.test(sql));
ok('A6: SQL extends chk_status to include pending_detail',
  /DROP CONSTRAINT IF EXISTS chk_status[\s\S]{0,300}status IN \('active','pending_detail','received','finalized','cancelled'\)/.test(sql));
ok('A7: SQL creates inventory_receipt_rolls table',
  /CREATE TABLE IF NOT EXISTS inventory_receipt_rolls/.test(sql));
ok('A8: receipt_rolls.receipt_id FK with CASCADE delete',
  /receipt_id\s+uuid NOT NULL REFERENCES inventory_stock_receipts\(id\) ON DELETE CASCADE/.test(sql));
ok('A9: receipt_rolls has roll_number + roll_sequence + gross/net/meters/rack/notes',
  /roll_number\s+text/.test(sql) && /roll_sequence\s+integer/.test(sql) &&
  /gross_kg\s+numeric/.test(sql) && /net_kg\s+numeric/.test(sql) && /meters\s+numeric/.test(sql) &&
  /rack\s+text/.test(sql) && /notes\s+text/.test(sql));
ok('A10: receipt_rolls has CHECK constraints (non-negative)',
  /chk_roll_gross_nonneg CHECK \(gross_kg IS NULL OR gross_kg >= 0\)/.test(sql) &&
  /chk_roll_net_nonneg\s+CHECK \(net_kg\s+IS NULL OR net_kg\s+>= 0\)/.test(sql) &&
  /chk_roll_meters_nonneg CHECK \(meters\s+IS NULL OR meters\s+>= 0\)/.test(sql));
ok('A11: receipt_rolls has indexes (receipt + sequence)',
  /idx_receipt_rolls_receipt\b/.test(sql) && /idx_receipt_rolls_sequence\b/.test(sql));
ok('A12: receipt_rolls has updated_at trigger',
  /CREATE OR REPLACE FUNCTION update_inventory_receipt_rolls_updated_at/.test(sql) &&
  /CREATE TRIGGER trigger_receipt_rolls_updated_at/.test(sql));
ok('A13: receipt_rolls RLS enabled',
  /ALTER TABLE inventory_receipt_rolls ENABLE ROW LEVEL SECURITY/.test(sql) &&
  /CREATE POLICY inv_receipt_rolls_read/.test(sql) &&
  /CREATE POLICY inv_receipt_rolls_write/.test(sql));
ok('A14: reopen_finalized_receipt function defined',
  /CREATE OR REPLACE FUNCTION reopen_finalized_receipt\(p_receipt_id uuid, p_user_id uuid, p_reason text\)/.test(sql));
ok('A15: reopen inserts reversal movement',
  /INSERT INTO inventory_movements[\s\S]{0,500}'reversal'[\s\S]{0,300}-r\.quantity/.test(sql));
ok('A16: reopen marks layer status as reversed',
  /UPDATE inventory_layers SET status = 'reversed' WHERE source_receipt_id = r\.id AND status = 'open'/.test(sql));
ok('A17: reopen flips status to received + clears finalize fields',
  /UPDATE inventory_stock_receipts SET[\s\S]{0,500}status = 'received'[\s\S]{0,300}landed_cost_per_uom = NULL[\s\S]{0,300}finalized_at = NULL[\s\S]{0,300}finalized_by = NULL/.test(sql));

// ══════════════════════════════════════════════════════════════════
// PART B — Component: emptyLine + header defaults
// ══════════════════════════════════════════════════════════════════

ok('B1: emptyLine has expected_rolls',
  /expected_rolls: ''/.test(rec));
ok('B2: emptyLine has expected_gross_kg / expected_net_kg / expected_uom_total',
  /expected_gross_kg: ''/.test(rec) && /expected_net_kg: ''/.test(rec) && /expected_uom_total: ''/.test(rec));
ok('B3: emptyLine has rolls: [] (Phase 2 child rows)',
  /\/\/ v55\.83-A\.6\.27\.35 — Phase 2 roll detail rows[\s\S]{0,200}rolls: \[\]/.test(rec));
ok('B4: emptyLine has existing_id (tracks edit mode)',
  /existing_id: null/.test(rec));
ok('B5: emptyLine has variance_acknowledged',
  /variance_acknowledged: false/.test(rec));
ok('B6: per-line currency default flipped to USD (was EGP)',
  /\/\/ v55\.83-A\.6\.27\.35 — per-line currency default USD[\s\S]{0,200}currency: 'USD'/.test(rec));
ok('B7: purchase_currency in header state defaults to USD',
  /purchase_currency: 'USD'/.test(rec));
ok('B8: openNew/closeModal both use USD purchase_currency',
  rec.split("purchase_currency: 'USD'").length >= 4); // 3 occurrences = 4 split pieces

// ══════════════════════════════════════════════════════════════════
// PART C — Save flow: two-phase status derivation + edit-mode UPDATE
// ══════════════════════════════════════════════════════════════════

ok('C1: status derived from data (pending_detail vs received)',
  /var hasActualOrRolls = \(qty != null && qty > 0\) \|\| \(L2\.rolls \|\| \[\]\)\.length > 0/.test(rec) &&
  /var lineStatus = hasActualOrRolls \? 'received' : 'pending_detail'/.test(rec));
ok('C2: save validation allows blank quantity if expected_* OR rolls present',
  /var hasActual = L\.quantity && asNum\(L\.quantity\) !== null && asNum\(L\.quantity\) > 0/.test(rec) &&
  /var hasExpected = asNum\(L\.expected_uom_total\) > 0 \|\| asNum\(L\.expected_rolls\) > 0/.test(rec) &&
  /var hasRolls = \(L\.rolls \|\| \[\]\)\.length > 0/.test(rec));
ok('C3: variance vs expected requires reason or acknowledge',
  /hasVarianceVsExpected[\s\S]{0,300}variance_acknowledged[\s\S]{0,200}variance_reason/.test(rec));
ok('C4: edit mode UPDATE vs INSERT depending on existing_id',
  /if \(L2\.existing_id\) \{\s+\/\/ Edit mode: update existing row\s+await dbUpdate\('inventory_stock_receipts', L2\.existing_id/.test(rec));
ok('C5: edit mode reuses existing receipt_number (does not regenerate)',
  /if \(editingReceiptNumber\) \{\s+receiptNumber = editingReceiptNumber/.test(rec));
ok('C6: rolls inserted into inventory_receipt_rolls table',
  /await dbInsert\('inventory_receipt_rolls'/.test(rec));
ok('C7: edit mode deletes existing rolls before re-inserting (replacement)',
  /if \(L2\.existing_id\) \{\s+await supabase\.from\('inventory_receipt_rolls'\)\.delete\(\)\.eq\('receipt_id', lineId\)/.test(rec));
ok('C8: roll save includes all 6 fields + roll_sequence + audit',
  /roll_number:[\s\S]{0,200}roll_sequence: ri \+ 1[\s\S]{0,200}gross_kg:[\s\S]{0,100}net_kg:[\s\S]{0,100}meters:[\s\S]{0,100}rack:[\s\S]{0,100}notes:/.test(rec));
ok('C9: payload includes all 4 expected_* fields',
  /expected_rolls: asNum\(L2\.expected_rolls\)/.test(rec) &&
  /expected_gross_kg: asNum\(L2\.expected_gross_kg\)/.test(rec) &&
  /expected_net_kg: asNum\(L2\.expected_net_kg\)/.test(rec) &&
  /expected_uom_total: asNum\(L2\.expected_uom_total\)/.test(rec));
ok('C10: payload includes variance_acknowledged',
  /variance_acknowledged: L2\.variance_acknowledged === true/.test(rec));

// ══════════════════════════════════════════════════════════════════
// PART D — openEdit + reopenReceipt functions
// ══════════════════════════════════════════════════════════════════

ok('D1: openEdit function declared',
  /async function openEdit\(grouped\)/.test(rec));
ok('D2: openEdit requires canEdit permission',
  /if \(!canEdit\) \{ alert\('Edit Inventory permission required'\); return; \}/.test(rec));
ok('D3: openEdit blocks editing of cancelled receipts',
  /if \(grouped\.status === 'cancelled'\)[\s\S]{0,300}Cannot edit a cancelled receipt/.test(rec));
ok('D4: openEdit blocks direct edit of finalized — routes to Reopen',
  /if \(grouped\.status === 'finalized'\)[\s\S]{0,300}Cannot edit a finalized receipt directly\. Use "Reopen"/.test(rec));
ok('D5: openEdit loads rolls for each line in parallel',
  /await supabase\.from\('inventory_receipt_rolls'\)\.select\('\*'\)\.in\('receipt_id', ids\)\.order\('roll_sequence'\)/.test(rec));
ok('D6: openEdit hydrates each line with existing_id',
  /L\.existing_id = r\.id/.test(rec));
ok('D7: openEdit hydrates rolls into L.rolls',
  /L\.rolls = \(rollsByReceipt\[r\.id\] \|\| \[\]\)\.map/.test(rec));
ok('D8: reopenReceipt function declared',
  /async function reopenReceipt\(grouped\)/.test(rec));
ok('D9: reopenReceipt requires isSuperAdmin',
  /if \(!isSuperAdmin\) \{\s+alert\('Reopening a finalized receipt is restricted to super_admin/.test(rec));
ok('D10: reopenReceipt prompts for reason + confirmation',
  /window\.prompt\([\s\S]{0,200}Enter a reason for reopening:/.test(rec) &&
  /window\.confirm\('Confirm reopen of/.test(rec));
ok('D11: reopenReceipt calls reopen_finalized_receipt RPC per line',
  /supabase\.rpc\('reopen_finalized_receipt', \{\s+p_receipt_id: lineRow\.id,\s+p_user_id: userProfile && userProfile\.id,\s+p_reason: reason\.trim\(\)/.test(rec));

// ══════════════════════════════════════════════════════════════════
// PART E — UI: Phase 1 + Phase 2 + Variance + Edit/Reopen buttons
// ══════════════════════════════════════════════════════════════════

ok('E1: Phase 1 section renders with expected_rolls input',
  /PHASE 1 — EXPECTED TOTALS[\s\S]{0,2000}Expected Rolls[\s\S]{0,500}value=\{line\.expected_rolls\}/.test(rec));
ok('E2: Phase 1 has expected_gross_kg input',
  /Expected Gross \(kg\)[\s\S]{0,400}value=\{line\.expected_gross_kg\}/.test(rec));
ok('E3: Phase 1 has expected_net_kg input',
  /Expected Net \(kg\)[\s\S]{0,400}value=\{line\.expected_net_kg\}/.test(rec));
ok('E4: Phase 1 has expected_uom_total input',
  /Expected Total[\s\S]{0,400}value=\{line\.expected_uom_total\}/.test(rec));
ok('E5: Phase 2 section renders with INDIVIDUAL ROLLS header',
  /PHASE 2 — INDIVIDUAL ROLLS/.test(rec));
ok('E6: Add Roll button appends a new empty roll row',
  /newRolls\.push\(\{ roll_number: '', gross_kg: '', net_kg: '', meters: '', rack:[\s\S]{0,500}\+ Add Roll/.test(rec));
ok('E7: Roll row has inputs for all 6 fields',
  /value=\{r\.roll_number\}/.test(rec) && /value=\{r\.gross_kg\}/.test(rec) &&
  /value=\{r\.net_kg\}/.test(rec) && /value=\{r\.meters\}/.test(rec) &&
  /value=\{r\.rack\}/.test(rec) && /value=\{r\.notes\}/.test(rec));
ok('E8: Roll row has remove (✕) button',
  /onClick=\{function \(\) \{\s+var nr = \(line\.rolls \|\| \[\]\)\.slice\(\); nr\.splice\(rIdx, 1\); updateLineField/.test(rec));
ok('E9: Variance summary panel shows EXPECTED MATCHES ACTUAL or VARIANCE DETECTED',
  /VARIANCE DETECTED[\s\S]{0,200}EXPECTED MATCHES ACTUAL/.test(rec) ||
  /hasAnyVariance \? '⚠ VARIANCE DETECTED' : '✓ EXPECTED MATCHES ACTUAL'/.test(rec));
ok('E10: Variance computed across rolls/gross/net/meters dimensions',
  /var hasAnyVariance =[\s\S]{0,400}expRolls != null && rolls\.length !== expRolls[\s\S]{0,200}expGross != null && Math\.abs\(rollSumGross - expGross\) > 0\.01[\s\S]{0,200}expMeters != null && Math\.abs\(rollSumMeters - expMeters\) > 0\.01/.test(rec));
ok('E11: Variance reason input shown when variance present',
  /hasAnyVariance && \(\s+<div className="mt-2 space-y-1">[\s\S]{0,500}variance_reason/.test(rec));
ok('E12: Acknowledge checkbox for variance',
  /variance_acknowledged === true[\s\S]{0,300}Acknowledge variance/.test(rec));
ok('E13: Edit button in list — gated by canEdit + non-finalized + non-cancelled',
  /canEdit && !isCancelled && !isFinalized && \(\s+<button\s+onClick=\{function \(\) \{ openEdit\(g\); \}\}/.test(rec));
ok('E14: Reopen button in list — super_admin only + finalized only',
  /isSuperAdmin && isFinalized && \(\s+<button\s+onClick=\{function \(\) \{ reopenReceipt\(g\); \}\}/.test(rec));
ok('E15: Modal title shows edit mode when editingReceiptNumber is set',
  /\{editingReceiptNumber \? 'Edit Receipt ' \+ editingReceiptNumber : 'New Stock Receipt'\}/.test(rec));

// ══════════════════════════════════════════════════════════════════
// PART F — Status badge + filter
// ══════════════════════════════════════════════════════════════════

ok('F1: pending_detail badge variant',
  /g\.status === 'pending_detail' \? 'bg-orange-100 text-orange-900'/.test(rec));
ok('F2: pending_detail label "Pending Detail"',
  /g\.status === 'pending_detail' \? 'Pending Detail'/.test(rec));
ok('F3: filter dropdown includes pending_detail option',
  /<option value="pending_detail">Pending Detail \(no rolls\/qty yet\)<\/option>/.test(rec));

// ══════════════════════════════════════════════════════════════════
// Regression guards
// ══════════════════════════════════════════════════════════════════

ok('R1: Build 4.0 receipt_number RPC still in saveReceipt',
  /supabase\.rpc\('generate_receipt_number', \{ p_date: header\.receipt_date \}\)/.test(rec));
ok('R2: Build 4.1 shipment_reference still required',
  /Shipment Reference required/.test(rec));
ok('R3: Build 4.2 — InventoryFinalizeCostDialog still imported + wired',
  /import InventoryFinalizeCostDialog from '\.\/InventoryFinalizeCostDialog'/.test(rec));
ok('R4: Build 4.3 — Movements + Layers components still imported in InventoryTab',
  /import InventoryMovementsLedger from '\.\/InventoryMovementsLedger'/.test(read('src/components/InventoryTab.jsx')) &&
  /import InventoryCostLayers from '\.\/InventoryCostLayers'/.test(read('src/components/InventoryTab.jsx')));
ok('R5: A.6.27.28 closed-tickets fetch still has NO .limit(100)',
  !/\.eq\('status', 'Closed'\)[\s\S]{0,200}\.limit\(100\)/.test(page));
ok('R6: A.6.27.31 WarehouseSettings modal still in place',
  /fixed inset-0 z-\[200\] bg-black\/70/.test(read('src/components/WarehouseSettings.jsx')));

// ── Version stamp ──────────────────────────────────────────────────
ok('V1: version stamp v55.83-A.6.27.35',
  /BUILD v55\.83-A\.6\.27\.35/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.35 Build 4.4 two-phase + edit + reopen tests passed');
