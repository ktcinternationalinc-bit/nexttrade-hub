// v55.83-A.6.27.47 or later — Shipping Rates Import: match key updated for expiry_date backfill.
//
// Match key changed from origin|destination|expiry_date|vendor|line
//                   to port_of_loading|port_of_discharge|effective_date|vendor|shipping_line
// with origin/destination fallback when port_of_loading/discharge are blank.
//
// Why: expiry_date is the field being backfilled, so it cannot be part of the
// match key — historical rows have NULL expiry_date and would never match.

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
// PART A — Match key change
// ══════════════════════════════════════════════════════════════════

ok('A1: keyFor uses port_of_loading with origin fallback',
  /var pol = normName\(r\.port_of_loading\) \|\| normName\(r\.origin\)/.test(sr));
ok('A2: keyFor uses port_of_discharge with destination fallback',
  /var pod = normName\(r\.port_of_discharge\) \|\| normName\(r\.destination\)/.test(sr));
ok('A3: keyFor includes effective_date (not expiry_date)',
  /String\(r\.effective_date \|\| ''\)\.trim\(\)/.test(sr) &&
  !/var keyFor = function \(r\) \{\s+return \[\s+normName\(r\.origin\),\s+normName\(r\.destination\),\s+String\(r\.expiry_date/.test(sr));
ok('A4: keyFor still includes vendor_name + shipping_line',
  /normName\(r\.vendor_name\),\s+normName\(r\.shipping_line\),\s+\]\.join\('\|'\)/.test(sr));
ok('A5: comments explain the backfill rationale clearly',
  /Match key updated for expiry_date backfill use case/.test(sr) &&
  /BACKFILL/.test(sr));

// ══════════════════════════════════════════════════════════════════
// PART B — rowChanged: expiry_date is NO LONGER skipped (so changes detected)
// ══════════════════════════════════════════════════════════════════

ok('B1: expiry_date REMOVED from skipKeys (so NULL→date triggers update)',
  // The new skipKeys object must NOT contain expiry_date: 1
  /var skipKeys = \{[\s\S]*?\};/.test(sr) &&
  !/skipKeys = \{ id: 1, created_at: 1, updated_at: 1, origin: 1, destination: 1, expiry_date: 1/.test(sr));
ok('B2: port_of_loading + port_of_discharge ADDED to skipKeys (now match-key fields)',
  /port_of_loading: 1, port_of_discharge: 1/.test(sr));
ok('B3: origin + destination still in skipKeys (used as port fallback)',
  /origin: 1, destination: 1,/.test(sr));
ok('B4: effective_date ADDED to skipKeys (now in the match key)',
  /effective_date: 1,/.test(sr));
ok('B5: vendor_name + shipping_line still in skipKeys',
  /vendor_name: 1, shipping_line: 1/.test(sr));

// ══════════════════════════════════════════════════════════════════
// PART C — Backfill behavior verified by logic inspection
// ══════════════════════════════════════════════════════════════════

ok('C1: null-equivalence guard still present (blank→blank not a change)',
  /Treat null\/undefined\/'' as equivalent[\s\S]{0,200}continue;/.test(sr));
ok('C2: numeric comparison still present',
  /typeof ev === 'number' \|\| typeof nv === 'number'/.test(sr));
ok('C3: string fallback comparison still present',
  /if \(String\(nv\) !== String\(ev\)\) return true;/.test(sr));

// ══════════════════════════════════════════════════════════════════
// PART D — existingByKey + rowKey usage unchanged (still routes through keyFor)
// ══════════════════════════════════════════════════════════════════

ok('D1: existing rows indexed via keyFor(row)',
  /allExistingRows\.forEach\(function \(row\) \{ existingByKey\[keyFor\(row\)\] = row; \}\)/.test(sr));
ok('D2: import row key generated via keyFor(vr.data)',
  /var rowKey = keyFor\(vr\.data\);/.test(sr));
ok('D3: existingByKey[rowKey] still drives insert vs update branching',
  /var existing = existingByKey\[rowKey\];/.test(sr));

// ══════════════════════════════════════════════════════════════════
// PART R — REGRESSION GUARDS — confirm nothing else in the import flow changed
// ══════════════════════════════════════════════════════════════════

ok('R1: importMode toggle still present (update_only vs full_sync)',
  /const \[importMode, setImportMode\] = useState\('update_only'\)/.test(sr));
ok('R2: FULL SYNC typed confirmation gate still present',
  /FULL SYNC/.test(sr) && /case-sensitive/.test(sr));
ok('R3: importCounts state shape unchanged (added/updated/unchanged/failed/deleted)',
  /\{ added: 0, updated: 0, unchanged: 0, failed: 0, deleted: 0 \}/.test(sr));
ok('R4: per-row try/catch isolation still in place',
  /STEP 3 — per-row write loop, isolated try\/catch each/.test(sr));
ok('R5: Quarantine still triggers on bad data',
  /quarantineRows\.push/.test(sr) && /counts\.quarantined/.test(sr));
ok('R6: pre-flight SELECT failure aborts BEFORE writes (no partial state)',
  /SELECT failed — abort BEFORE any writes/.test(sr));
ok('R7: full_sync deletion logic still scoped to "rows NOT in import file"',
  /Find existing rows NOT present in the import file/.test(sr));
ok('R8: vendor + origin scoping on fetch unchanged',
  /\.in\('vendor_name', distinctVendors\.length > 0 \? distinctVendors : \['__none__'\]\)\s+\.in\('origin', distinctOrigins\.length > 0 \? distinctOrigins : \['__none__'\]\)/.test(sr));
ok('R9: normName helper preserved',
  /var normName = function \(s\) \{[\s\S]{0,500}\.replace\(\/\[\^a-z0-9\]\+\/g, ' '\)/.test(sr));
ok('R10: notifyShippingRate still imported (no notification regressions)',
  /import \{ notifyShippingRate, notifyShippingBooked \} from '\.\.\/lib\/notify'/.test(sr));
ok('R11: 46 — Product Master schema diagnostic banner still present',
  /Database migrations needed/.test(read('src/components/InventoryProductMaster.jsx')));
ok('R12: 45 — Egypt Bank owner deposit toggle still wired',
  /const toggleOwnerDeposit = async \(txnId\)/.test(read('src/components/EgyptBankTab.jsx')));
ok('R13: 44c — consume_invoice_item_inventory RPC still wired',
  /supabase\.rpc\('consume_invoice_item_inventory', \{ p_item_id: insertedItem\.id \}\)/.test(page));
ok('R14: 44a — Inventory cutoff panel still in InventoryTab',
  /Inventory Cutoff Date.*\/.*تاريخ بدء ربط المخزون/.test(read('src/components/InventoryTab.jsx')));

// ──────────────────────────────────────────────────────────────────
// Version stamp
// ──────────────────────────────────────────────────────────────────
ok('V1: version stamp v55.83-A.6.27.47 or later',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.47 or later (shipping rates backfill key) tests passed');
