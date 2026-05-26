// v55.83-A.6.27.57 — Shipping Rates save handler instrumentation.
//
// Previously: silent failures on trucking save. Buggy
// "toast ? toast.error : toast ? toast.error : alert" chain swallowed errors
// when toast was malformed; no console logging; no per-error-type guidance.
//
// Now: full diagnostic trail.
//   - console.log on save attempt + record contents
//   - alert() fallback on every error path (toast AND alert)
//   - Trucking-with-Ocean-mode confirm dialog (data-quality nudge)
//   - explicit success message
//   - error-pattern → actionable hint (missing table / missing column / RLS / duplicate)
//   - dbInsert return value verified — alerts if rate_type was silently stripped

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var sr   = read('src/components/ShippingRatesTab.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — Diagnostic instrumentation
// ══════════════════════════════════════════════════════════════════

ok('A1: comment explains the .57 instrumentation rationale (buggy toast chain swallowed errors)',
  /Full diagnostic instrumentation/.test(sr) &&
  /toast \? toast\.error : toast \? toast\.error : alert/.test(sr));
ok('A2: console.log fires at save attempt with formState',
  /console\.log\('\[shipping-rates\] save attempt:',[\s\S]{0,100}formState: f/.test(sr));
ok('A3: console.log of record before insert/update',
  /console\.log\('\[shipping-rates\] record to save:', record\)/.test(sr));
ok('A4: dbInsert/dbUpdate return value is captured (saved variable) and logged',
  /saved = await dbUpdate\('shipping_rates', editingRate\.id, record, myId\);\s+console\.log\('\[shipping-rates\] dbUpdate returned:', saved\)/.test(sr) &&
  /saved = await dbInsert\('shipping_rates', record, myId\);\s+console\.log\('\[shipping-rates\] dbInsert returned:', saved\)/.test(sr));
ok('A5: post-save check verifies rate_type made it through (catches silent column-stripping)',
  /if \(saved\.rate_type !== record\.rate_type\)/.test(sr));
ok('A6: rate_type mismatch fires alert with actionable message',
  /Warning: rate_type was stripped during save[\s\S]{0,200}may be missing the rate_type column/.test(sr));
ok('A7: console.log on save SUCCESS',
  /console\.log\('\[shipping-rates\] save SUCCESS:', successMsg\)/.test(sr));
ok('A8: console.error on save FAILED',
  /console\.error\('\[shipping-rates\] save FAILED:', err\)/.test(sr));

// ══════════════════════════════════════════════════════════════════
// PART B — Validation alerts upgraded with actionable detail
// ══════════════════════════════════════════════════════════════════

ok('B1: missing-field alert names which fields are empty',
  /missingMsg = 'Cannot save: missing required field\(s\)[\s\S]{0,300}Origin: ' \+ \(f\.origin \|\| '\(empty\)'\)/.test(sr));
ok('B2: missing rate_type alert is clearer than before',
  /Cannot save: Rate Type is required\.[\s\S]{0,150}Shipping, Trucking, or Customs\/Brokerage/.test(sr));

// ══════════════════════════════════════════════════════════════════
// PART C — Trucking-with-Ocean-mode sanity check
// ══════════════════════════════════════════════════════════════════

ok('C1: detects rate_type=Trucking with transport_mode=Ocean (data-quality issue)',
  /if \(f\.rateType === 'Trucking' && \(!f\.transportMode \|\| f\.transportMode === 'Ocean'\)\)/.test(sr));
ok('C2: shows confirm dialog with explanation when Trucking but Ocean mode',
  /this is a TRUCKING rate but Transport Mode is set to[\s\S]{0,300}Did you mean to set Mode = Trucking/.test(sr));
ok('C3: user can cancel and go back to fix the mode',
  /Click OK to save anyway, or Cancel to go back and change the Mode dropdown/.test(sr));

// ══════════════════════════════════════════════════════════════════
// PART D — Defense-in-depth error handling
// ══════════════════════════════════════════════════════════════════

ok('D1: success toast wrapped in try/catch (defense if toast is broken)',
  /try \{ if \(toast && toast\.success\) toast\.success\(successMsg\); \} catch \(_\) \{\}/.test(sr));
ok('D2: error toast also wrapped in try/catch + alert ALWAYS fires regardless of toast',
  /try \{ if \(toast && toast\.error\) toast\.error\('Save failed: ' \+ errMsg\); \} catch \(_\) \{\}[\s\S]{0,2000}alert\('Save failed:/.test(sr));
ok('D3: NO MORE buggy "toast ? toast.error : toast ? toast.error : alert" chain',
  !/toast \? toast\.error\(err\.message\) : toast \? toast\.error\(err\.message\) : alert\(err\.message\)/.test(sr) ||
  // The chain may still exist in OTHER handlers; we only require handleSaveRate doesn't use it.
  // Check handleSaveRate's specific block by searching nearby:
  !/handleSaveRate[\s\S]{0,3000}toast \? toast\.error\(err\.message\) : toast \? toast\.error\(err\.message\) : alert/.test(sr));

// ══════════════════════════════════════════════════════════════════
// PART E — Actionable error messages by pattern
// ══════════════════════════════════════════════════════════════════

ok('E1: "relation does not exist" → setup SQL never run message',
  /relation\.\*shipping_rates\.\*does not exist[\s\S]{0,300}setup SQL was never run/.test(sr));
ok('E2: "column does not exist" → SQL migration missing hint',
  /column\.\*does not exist[\s\S]{0,300}SQL migration is missing/.test(sr));
ok('E3: RLS violation → RLS policy hint',
  /violates row-level security policy[\s\S]{0,300}Ask Claude to check the policy/.test(sr));
ok('E4: duplicate key → edit existing rate instead hint',
  /duplicate key\|already exists[\s\S]{0,300}Edit the existing one instead/.test(sr));

// ══════════════════════════════════════════════════════════════════
// PART R — REGRESSION GUARDS
// ══════════════════════════════════════════════════════════════════

ok('R1: 56 — Inbound Shipments 3-region modal preserved (headerCollapsed state)',
  /var \[headerCollapsed, setHeaderCollapsed\] = useState\(false\)/.test(read('src/components/InventoryReceiving.jsx')));
ok('R2: 56 — Region 2 scrollable middle preserved',
  /Region 2: scrollable middle/.test(read('src/components/InventoryReceiving.jsx')));
ok('R3: 55 — openaccounts in FINANCE sidebar preserved',
  /\{ group: 'FINANCE', items: \['sales', 'treasury', 'checks', 'debts', 'openaccounts'/.test(page));
ok('R4: 55 — Product List default = variants',
  /var \[typeFilter, setTypeFilter\] = useState\('all'\)/.test(read('src/components/InventoryProductMaster.jsx')));
ok('R5: 55 — TEMPLATE rename preserved',
  /TEMPLATE</.test(read('src/components/InventoryProductMaster.jsx')) &&
  !/>FAMILY</.test(read('src/components/InventoryProductMaster.jsx')));
ok('R6: 55 — TEXTJOIN slug formula in Excel template preserved',
  /f: 'TEXTJOIN\("-",TRUE,E' \+ rowNum \+ ':M' \+ rowNum \+ '\)'/.test(read('src/components/InventoryImportProducts.jsx')));
ok('R7: 54 — header version pill amber bg preserved',
  /background: '#fef3c7'/.test(page));
ok('R8: 53 — Open Accounts entity picker preserved',
  /Our Entity for this Account \* \/ كياننا/.test(read('src/components/OpenAccountsTab.jsx')));
ok('R9: 52 — Open Accounts tab registered',
  /\{ id: 'openaccounts', label: 'Open Accounts \/ حسابات', icon: '📒' \}/.test(page));
ok('R10: 47 — Shipping Rates keyFor expiry_date backfill unchanged (different code path)',
  /var pol = normName\(r\.port_of_loading\) \|\| normName\(r\.origin\)/.test(sr));
ok('R11: 44c — consume_invoice_item_inventory RPC still wired',
  /supabase\.rpc\('consume_invoice_item_inventory', \{ p_item_id: insertedItem\.id \}\)/.test(page));
ok('R12: closed-tickets fetch still has NO .limit(100)',
  !/\.eq\('status', 'Closed'\)[\s\S]{0,200}\.limit\(100\)/.test(page));
ok('R13: handleSaveRate still inserts/updates shipping_rates table (function still functional)',
  /await dbInsert\('shipping_rates', record, myId\)/.test(sr) &&
  /await dbUpdate\('shipping_rates', editingRate\.id, record, myId\)/.test(sr));
ok('R14: handleSaveRate still calls notifyShippingRate after insert',
  /notifyShippingRate\('all', f\.origin, f\.destination, myId\)/.test(sr));
ok('R15: handleSaveRate still resets form + view + reloads data on success',
  /setF\(\{\}\);\s+setEditingRate\(null\);\s+setView\(selectedRoute \? 'route_detail' : 'routes'\);\s+await loadData\(\)/.test(sr));
ok('R16: existing record construction with all fields preserved',
  /const record = \{ origin: f\.origin, destination: f\.destination, vendor_name: f\.vendorName/.test(sr) &&
  /rate_type: f\.rateType/.test(sr) &&
  /total_cost: Number\(f\.rateAmount\|\|0\)\+Number\(f\.portFees\|\|0\)\+Number\(f\.thcFees\|\|0\)\+Number\(f\.docFees\|\|0\)\+Number\(f\.customsFees\|\|0\)\+Number\(f\.otherFees\|\|0\)/.test(sr));

// ──────────────────────────────────────────────────────────────────
// Version stamp
// ──────────────────────────────────────────────────────────────────
ok('V1: version stamp v55.83-A.6.27.57 or later',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.57 (shipping rates save instrumentation) tests passed');
