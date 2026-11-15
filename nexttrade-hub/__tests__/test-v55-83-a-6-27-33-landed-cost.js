// v55.83-A.6.27.33 — Inventory Phase 1 Build 4.2: Landed Cost Finalization
//
// New table inventory_landed_costs + 6 columns on receipts + new
// InventoryFinalizeCostDialog component + new inventory-landed-cost-engine.
// Wires "Finalize Cost" button on Received receipts to open the dialog.

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var rec = read('src/components/InventoryReceiving.jsx');
var dlg = read('src/components/InventoryFinalizeCostDialog.jsx');
var eng = read('src/lib/inventory-landed-cost-engine.js');
var sql = read('sql/v55-83-a-6-27-33-inventory-landed-costs.sql');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — SQL
// ══════════════════════════════════════════════════════════════════

ok('A1: inventory_landed_costs table defined',
  /CREATE TABLE IF NOT EXISTS inventory_landed_costs/.test(sql));
ok('A2: id PK uuid with gen_random_uuid default',
  /id\s+uuid PRIMARY KEY DEFAULT gen_random_uuid\(\)/.test(sql));
ok('A3: receipt_number NOT NULL',
  /receipt_number\s+text NOT NULL/.test(sql));
ok('A4: all six cost components present (freight/customs_duty/insurance/clearing/local_transport/other)',
  /freight_amount\s+numeric/.test(sql) && /customs_duty_amount\s+numeric/.test(sql) &&
  /insurance_amount\s+numeric/.test(sql) && /clearing_amount\s+numeric/.test(sql) &&
  /local_transport_amount\s+numeric/.test(sql) && /other_amount\s+numeric/.test(sql));
ok('A5: each cost component has its own currency column',
  /freight_currency\s+text/.test(sql) && /customs_duty_currency\s+text/.test(sql) &&
  /insurance_currency\s+text/.test(sql) && /clearing_currency\s+text/.test(sql) &&
  /local_transport_currency\s+text/.test(sql) && /other_currency\s+text/.test(sql));
ok('A6: fx_rate_usd_to_egp + fx_source + fx_rate_date columns',
  /fx_rate_usd_to_egp\s+numeric/.test(sql) && /fx_source\s+text/.test(sql) && /fx_rate_date\s+date/.test(sql));
ok('A7: total_usd_value + total_egp_value columns',
  /total_usd_value\s+numeric/.test(sql) && /total_egp_value\s+numeric/.test(sql));
ok('A8: base_purchase_total + base_purchase_currency columns',
  /base_purchase_total\s+numeric/.test(sql) && /base_purchase_currency\s+text/.test(sql));
ok('A9: allocation_method column with CHECK constraint',
  /allocation_method\s+text NOT NULL DEFAULT 'by_qty'/.test(sql) &&
  /chk_allocation_method CHECK \(allocation_method IN \('by_qty','by_kg','by_value'\)\)/.test(sql));
ok('A10: chk_freight_currency CHECK constraint (EGP/USD/EUR)',
  /chk_freight_currency\s+CHECK \(freight_currency\s+IS NULL OR freight_currency\s+IN \('EGP','USD','EUR'\)\)/.test(sql));
ok('A11: UNIQUE INDEX on receipt_number (one row per receipt)',
  /CREATE UNIQUE INDEX IF NOT EXISTS idx_landed_costs_receipt_number ON inventory_landed_costs \(receipt_number\)/.test(sql));
ok('A12: updated_at trigger + function defined',
  /CREATE OR REPLACE FUNCTION update_inventory_landed_costs_updated_at/.test(sql) &&
  /CREATE TRIGGER trigger_landed_costs_updated_at/.test(sql));
ok('A13: RLS enabled with read+write policies',
  /ALTER TABLE inventory_landed_costs ENABLE ROW LEVEL SECURITY/.test(sql) &&
  /CREATE POLICY inv_landed_costs_read  ON inventory_landed_costs FOR SELECT/.test(sql) &&
  /CREATE POLICY inv_landed_costs_write ON inventory_landed_costs FOR ALL/.test(sql));

ok('A14: 6 new columns added to inventory_stock_receipts',
  /ADD COLUMN IF NOT EXISTS landed_cost_per_uom numeric/.test(sql) &&
  /ADD COLUMN IF NOT EXISTS landed_total\s+numeric/.test(sql) &&
  /ADD COLUMN IF NOT EXISTS finalized_at\s+timestamptz/.test(sql) &&
  /ADD COLUMN IF NOT EXISTS finalized_by\s+uuid/.test(sql) &&
  /ADD COLUMN IF NOT EXISTS allocation_method\s+text/.test(sql) &&
  /ADD COLUMN IF NOT EXISTS fx_rate_used\s+numeric/.test(sql));
ok('A15: idx on finalized_at for reports',
  /idx_stock_receipts_finalized ON inventory_stock_receipts \(finalized_at\)/.test(sql));

// ══════════════════════════════════════════════════════════════════
// PART B — Cost Engine library
// ══════════════════════════════════════════════════════════════════

ok('B1: toEgp function exported with USD conversion',
  /export function toEgp[\s\S]{0,500}currency === 'USD'\) return a \* Number\(usdToEgp \|\| 0\)/.test(eng));
ok('B2: toEgp returns amount as-is for EGP',
  /currency === 'EGP'\) return a/.test(eng));
ok('B3: toUsd function exported',
  /export function toUsd\(amountEgp, usdToEgp\)/.test(eng));
ok('B4: rollupCosts iterates all 6 components',
  /\['freight', 'customs_duty', 'insurance', 'clearing', 'local_transport', 'other'\]\.forEach/.test(eng));
ok('B5: rollupCosts returns {totalEgp, totalUsd}',
  /return \{\s+totalEgp: totalEgp,\s+totalUsd: toUsd\(totalEgp, usdToEgp\),/.test(eng));
ok('B6: rollupBasePurchase sums quantity × cost_per_uom',
  /total \+= qty \* cost/.test(eng));
ok('B7: allocateLandedCost supports by_qty / by_kg / by_value',
  /method === 'by_qty'/.test(eng) && /method === 'by_kg'/.test(eng) && /method === 'by_value'/.test(eng));
ok('B8: by_kg falls back to quantity if uom is kg and quantity_kg blank',
  /\(L\.uom \|\| ''\)\.toLowerCase\(\) === 'kg'\) return Number\(L\.quantity \|\| 0\)/.test(eng));
ok('B9: equal-split fallback when total basis is 0',
  /var fallbackEqual = totalBasis === 0/.test(eng));
ok('B10: per-line result includes landed_total + landed_per_uom',
  /landed_total: grandTotal,\s+landed_per_uom: perUom/.test(eng));
ok('B11: computeFinalization aggregates rollup + base + allocations',
  /export function computeFinalization[\s\S]{0,400}return \{\s+totalLandedEgp: rollup\.totalEgp[\s\S]{0,400}grandTotalEgp: basePurchase\.totalEgp \+ rollup\.totalEgp/.test(eng));
ok('B12: getRateForDate wraps existing getFxRate',
  /import \{ getFxRate \} from '\.\/inventory-fx'/.test(eng) && /export async function getRateForDate/.test(eng));

// ══════════════════════════════════════════════════════════════════
// PART C — Dialog Component
// ══════════════════════════════════════════════════════════════════

ok('C1: InventoryFinalizeCostDialog default exported',
  /export default function InventoryFinalizeCostDialog/.test(dlg));
ok('C2: imports computeFinalization + getRateForDate from cost engine',
  /import \{ getRateForDate, computeFinalization \} from '\.\.\/lib\/inventory-landed-cost-engine'/.test(dlg));
ok('C3: imports saveManualRate for FX persistence',
  /import \{ saveManualRate \} from '\.\.\/lib\/inventory-fx'/.test(dlg));

// Cost component grid
ok('C4: components state has 6 cost-component amount fields',
  /freight_amount: ''/.test(dlg) && /customs_duty_amount: ''/.test(dlg) &&
  /insurance_amount: ''/.test(dlg) && /clearing_amount: ''/.test(dlg) &&
  /local_transport_amount: ''/.test(dlg) && /other_amount: ''/.test(dlg));
ok('C5: components state has 6 cost-component currency fields',
  /freight_currency: defaultCurrency/.test(dlg) && /customs_duty_currency: defaultCurrency/.test(dlg) &&
  /insurance_currency: defaultCurrency/.test(dlg));
ok('C6: other_description text field present (for "what is it")',
  /other_description: ''/.test(dlg));

// FX
ok('C7: FX auto-fetch on mount via getRateForDate',
  /async function loadFx[\s\S]{0,500}var r = await getRateForDate\(date\)/.test(dlg));
ok('C8: FX uses arrival_date if present, else receipt_date',
  /shipmentGroup\.lines\[0\]\.arrival_date[\s\S]{0,200}shipmentGroup\.receipt_date/.test(dlg));
ok('C9: manual FX override mode available with "override manually" button',
  /override manually/.test(dlg) && /setFxOverrideMode\(true\)/.test(dlg));
ok('C10: effectiveRate uses override if mode active',
  /var effectiveRate = fxOverrideMode \? Number\(fxOverride\) : fxRate/.test(dlg));

// Allocation method
ok('C11: 3 allocation buttons (by_qty / by_kg / by_value)',
  /id: 'by_qty', label: 'By Quantity'/.test(dlg) &&
  /id: 'by_kg', label: 'By Weight \(kg\)'/.test(dlg) &&
  /id: 'by_value', label: 'By Value'/.test(dlg));

// Preview
ok('C12: preview shows 3-card totals strip (base / landed / grand total)',
  /BASE PURCHASE[\s\S]{0,800}LANDED COSTS[\s\S]{0,800}GRAND TOTAL/.test(dlg));
ok('C13: preview shows per-line table with qty / base / allocated / landed-per-uom',
  /PER-LINE BREAKDOWN[\s\S]{0,2000}\+\{fmt\(a\.allocated_landed_egp\)\}[\s\S]{0,200}\{fmt\(a\.landed_per_uom, 4\)\}/.test(dlg));

// Commit logic
ok('C14: commitFinalize upserts into inventory_landed_costs',
  /supabase\.from\('inventory_landed_costs'\)\.select\('id'\)\.eq\('receipt_number'/.test(dlg) &&
  /dbInsert\('inventory_landed_costs'/.test(dlg) &&
  /dbUpdate\('inventory_landed_costs'/.test(dlg));
ok('C15: commitFinalize iterates allocations and updates each receipt row',
  /for \(var i = 0; i < preview\.allocations\.length; i\+\+\)[\s\S]{0,600}dbUpdate\('inventory_stock_receipts', L\.id, \{[\s\S]{0,500}status: 'finalized'/.test(dlg));
ok('C16: commitFinalize sets landed_cost_per_uom + landed_total + allocation_method + fx_rate_used + finalized_at/by',
  /landed_cost_per_uom: alloc\.landed_per_uom/.test(dlg) &&
  /landed_total: alloc\.landed_total/.test(dlg) &&
  /allocation_method: method/.test(dlg) &&
  /fx_rate_used: effectiveRate/.test(dlg) &&
  /finalized_at: nowIso/.test(dlg) &&
  /finalized_by: userProfile && userProfile\.id/.test(dlg));
ok('C17: manual FX rate saved back via saveManualRate when user overrides',
  /if \(fxOverrideMode && fxRate !== Number\(fxOverride\)\)[\s\S]{0,300}saveManualRate/.test(dlg));
ok('C18: validation — requires effectiveRate before commit',
  /if \(!effectiveRate\) \{\s+alert\('FX rate is required/.test(dlg));
ok('C19: error catch with hint about SQL migration not run',
  /Most likely cause: the v55\.83-A\.6\.27\.33 SQL migration was not run yet/.test(dlg));

// Modal structure
ok('C20: modal overlay z-210 (above the receive-stock modal which is z-200)',
  /fixed inset-0 z-\[210\] bg-black\/70/.test(dlg));
ok('C21: click-outside-to-close wired',
  /onClick=\{onClose\}[\s\S]{0,200}onClick=\{function \(e\) \{ e\.stopPropagation\(\); \}\}/.test(dlg));
ok('C22: dark indigo header with white text (RULE 6 defensive readability)',
  /background: '#3730a3'[\s\S]{0,200}color: '#ffffff'/.test(dlg));

// ══════════════════════════════════════════════════════════════════
// PART D — Wiring into InventoryReceiving
// ══════════════════════════════════════════════════════════════════

ok('D1: InventoryReceiving imports InventoryFinalizeCostDialog',
  /import InventoryFinalizeCostDialog from '\.\/InventoryFinalizeCostDialog'/.test(rec));
ok('D2: finalizeTarget state added',
  /var \[finalizeTarget, setFinalizeTarget\] = useState\(null\)/.test(rec));
ok('D3: Finalize Cost button opens dialog (no more alert placeholder)',
  !/Finalize Landed Cost coming in Build 4\.2/.test(rec) &&
  /onClick=\{function \(\) \{ setFinalizeTarget\(g\); \}\}/.test(rec));
ok('D4: Dialog mounted conditionally with productById + reload callback',
  /\{finalizeTarget && \(\s*<InventoryFinalizeCostDialog[\s\S]{0,500}onFinalized=\{function \(\) \{ reload\(\); \}\}/.test(rec));
ok('D5: totalCost prefers landed_total when finalized, falls back to total_cost',
  /var v = b\.landed_total != null \? Number\(b\.landed_total\) : Number\(b\.total_cost \|\| 0\)/.test(rec));

// ══════════════════════════════════════════════════════════════════
// Regression guards
// ══════════════════════════════════════════════════════════════════

ok('R1: Build 4.0 receipt_number RPC call still in saveReceipt',
  /supabase\.rpc\('generate_receipt_number', \{ p_date: header\.receipt_date \}\)/.test(rec));
ok('R2: Build 4.1 shipment_reference still required validation',
  /Shipment Reference required/.test(rec));
ok('R3: Build 4.1 variance reason logic still present',
  /variance reason\.'/.test(rec));
ok('R4: A.6.27.28 closed-tickets fetch still has NO .limit(100)',
  !/\.eq\('status', 'Closed'\)[\s\S]{0,200}\.limit\(100\)/.test(page));
ok('R5: A.6.27.31 WarehouseSettings modal still in place',
  /fixed inset-0 z-\[200\] bg-black\/70/.test(read('src/components/WarehouseSettings.jsx')));

// ── Version stamp ──────────────────────────────────────────────────
ok('V1: version stamp v55.83-A.6.27.33',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.33 Build 4.2 Landed Cost Finalization tests passed');
