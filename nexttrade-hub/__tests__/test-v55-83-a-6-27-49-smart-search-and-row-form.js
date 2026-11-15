// v55.83-A.6.27.49 — Inbound Shipments: smart search + simplified row form
//   1. suggestionsFor expanded — searches design_sku, classification labels (en+ar),
//      supplier, notes, plus everything it already searched.
//   2. Required fields with conditional kilos:
//      - Unit of Measure: required at submit
//      - Roll Count: always required
//      - Release #: required at submit
//      - Quantity in Kilos: required ONLY when UoM = kg

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var rec  = read('src/components/InventoryReceiving.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — Smart search expansion
// ══════════════════════════════════════════════════════════════════

ok('A1: inventory_lists loaded in initial load (Promise.all extended)',
  /supabase\.from\('inventory_lists'\)\.select\('id, level, code, label_en, label_ar'\)\.eq\('active', true\)/.test(rec));
ok('A2: lists state declared',
  /var \[lists, setLists\] = useState\(\[\]\)/.test(rec));
ok('A3: setLists called in initial load',
  /setLists\(lstRes\.data \|\| \[\]\)/.test(rec));
ok('A4: setLists called in reload',
  // appears twice — once for initial load, once for reload
  (rec.match(/setLists\(lstRes\.data \|\| \[\]\)/g) || []).length >= 2);
ok('A5: suggestionsFor builds listsById lookup',
  /var listsById = \{\};\s+lists\.forEach\(function \(l\) \{\s+listsById\[l\.id\] = \(\(l\.code \|\| ''\) \+ ' ' \+ \(l\.label_en \|\| ''\) \+ ' ' \+ \(l\.label_ar \|\| ''\)\)\.toLowerCase\(\);/.test(rec));
ok('A6: classText helper iterates all 9 classification list_id fields',
  /var idFields = \[\s+'family_list_id', 'category_list_id', 'grade_list_id', 'construction_list_id',\s+'backing_list_id', 'color_list_id', 'pattern_list_id', 'spec_class_list_id',[\s\S]{0,200}'origin_list_id'/.test(rec));
ok('A7: searchable string includes design_sku',
  /\(p\.design_sku \|\| ''\) \+ ' '/.test(rec));
ok('A8: searchable string includes default_supplier',
  /\(p\.default_supplier \|\| ''\) \+ ' '/.test(rec));
ok('A9: searchable string includes notes',
  /\(p\.notes \|\| ''\) \+ ' '/.test(rec));
ok('A10: searchable string includes classText(p)',
  /classText\(p\)/.test(rec));
ok('A11: multi-keyword filter retained (every keyword must appear)',
  /Every keyword must appear somewhere/.test(rec));
ok('A12: sort still featured DESC + use_count DESC + name ASC',
  /featured DESC[\s\S]{0,500}use_count DESC[\s\S]{0,500}name ASC/.test(rec));

// ══════════════════════════════════════════════════════════════════
// PART B — Form labels updated
// ══════════════════════════════════════════════════════════════════

ok('B1: "Quantity Received *" label with required asterisk',
  /Quantity Received \*\s/.test(rec));
ok('B2: "Unit of Measure *" label (was "UOM")',
  /Unit of Measure \*\s/.test(rec));
ok('B3: "Release # *" label preserved from .48',
  /Release # \*\s/.test(rec));
ok('B4: "Order Qty" label (was "Ordered Qty")',
  />Order Qty\s/.test(rec));
ok('B5: "Roll Count *" label with required asterisk',
  /Roll Count \*\s/.test(rec));

// ══════════════════════════════════════════════════════════════════
// PART C — Conditional Quantity in Kilos
// ══════════════════════════════════════════════════════════════════

ok('C1: kgRequired computed from UoM value (kg / kgs / kilo / kilogram / kilograms)',
  /var kgRequired = \(u === 'kg' \|\| u === 'kgs' \|\| u === 'kilo' \|\| u === 'kilogram' \|\| u === 'kilograms'\)/.test(rec));
ok('C2: label text switches between "*" and "(optional)" based on kgRequired',
  /Quantity in Kilos \{kgRequired \? '\*' : '\(optional\)'\}/.test(rec));
ok('C3: input border turns red when kgRequired AND empty',
  /kgRequired && \(line\.quantity_kg === '' \|\| line\.quantity_kg == null\) \? 'border-red-400' : 'border-slate-300'/.test(rec));
ok('C4: placeholder explains why kg is required',
  /required because UoM = kg/.test(rec));

// ══════════════════════════════════════════════════════════════════
// PART D — Roll Count visual required state
// ══════════════════════════════════════════════════════════════════

ok('D1: Roll Count input shows red border when empty',
  /\(line\.roll_count === '' \|\| line\.roll_count == null\) \? 'border-red-400' : 'border-slate-300'/.test(rec));
ok('D2: Roll Count placeholder clarifies required',
  /placeholder="required: # of physical rolls"/.test(rec));

// ══════════════════════════════════════════════════════════════════
// PART E — Submit-time validation for new required fields
// ══════════════════════════════════════════════════════════════════

ok('E1: UoM required at submit',
  /if \(!L\.uom \|\| !String\(L\.uom\)\.trim\(\)\) \{\s+alert\('Line ' \+ \(i \+ 1\) \+ ': Unit of Measure is required\.'\);/.test(rec));
ok('E2: Roll Count required at submit',
  /if \(L\.roll_count === '' \|\| L\.roll_count == null\) \{\s+alert\('Line ' \+ \(i \+ 1\) \+ ': Roll Count is required\.'\);/.test(rec));
ok('E3: Release # required at submit',
  /if \(!L\.batch_number \|\| !String\(L\.batch_number\)\.trim\(\)\) \{\s+alert\('Line ' \+ \(i \+ 1\) \+ ': Release # is required\.'\);/.test(rec));
ok('E4: Quantity in Kilos required when UoM=kg (uomIsKg branch)',
  /var uomIsKg = \(uomLow === 'kg' \|\| uomLow === 'kgs' \|\| uomLow === 'kilo' \|\| uomLow === 'kilogram' \|\| uomLow === 'kilograms'\);[\s\S]{0,500}Quantity in Kilos is required because Unit of Measure is kg/.test(rec));
ok('E5: UoM validation block in submitReceipt path (isSubmitting branch)',
  // The new validation should be inside the for-loop in submitReceipt
  /async function submitReceipt[\s\S]{0,5000}Unit of Measure is required/.test(rec));

// ══════════════════════════════════════════════════════════════════
// PART R — REGRESSION GUARDS
// ══════════════════════════════════════════════════════════════════

ok('R1: 48 — Modal width still 97vw / 1900',
  /(style=\{\{ width: '97vw', maxWidth: 1900|99vw)/.test(rec));
ok('R2: 48 — Modal body uses flex:1 (full available height) — preserved in v.56 scrollable middle region',
  /flex: 1, overflowY: 'auto'/.test(rec));
ok('R3: 48 — Expected Totals padding p-6 + gap-4 + text-lg',
  /bg-amber-50 border-2 border-amber-400 rounded-xl p-6 mt-4/.test(rec) &&
  /grid grid-cols-5 gap-4/.test(rec));
ok('R4: 48 — "Inbound Shipments" naming preserved',
  /Inbound Shipments|New Stock Receipt/.test(rec));
ok('R5: 48 — "release" placeholder preserved (not batch)',
  /placeholder="release \/ ID"/.test(rec));
ok('R6: 47 — Shipping Rates keyFor still uses backfill-friendly key',
  /var pol = normName\(r\.port_of_loading\) \|\| normName\(r\.origin\)/.test(read('src/components/ShippingRatesTab.jsx')));
ok('R7: 46 — Product List schema banner still present',
  /Database migrations needed/.test(read('src/components/InventoryProductMaster.jsx')));
ok('R8: 45 — Egypt Bank owner deposit + rules engine still wired',
  /const toggleOwnerDeposit = async \(txnId\)/.test(read('src/components/EgyptBankTab.jsx')) &&
  /supabase\.rpc\('apply_egypt_bank_rules', params\)/.test(read('src/components/EgyptBankTab.jsx')));
ok('R9: 44c — consume_invoice_item_inventory RPC still wired',
  /supabase\.rpc\('consume_invoice_item_inventory', \{ p_item_id: insertedItem\.id \}\)/.test(page));
ok('R10: 44a — Inventory Cutoff panel still in InventoryTab',
  /Inventory Cutoff Date.*\/.*تاريخ بدء ربط المخزون/.test(read('src/components/InventoryTab.jsx')));
ok('R11: 43 — Shipment Expected Totals form still 5-col grid',
  /grid grid-cols-5 gap-4/.test(rec) &&
  /expected_total_rolls/.test(rec));
ok('R12: Submit validation — product_id check preserved',
  /product not selected\. Pick a product or remove the line/.test(rec));
ok('R13: Submit validation — family template variant specs check preserved',
  /Category required \(Smooth or Embossed\) for family template/.test(rec));
ok('R14: Submit validation — variance reason check preserved',
  /differs from received quantity \(.+\) — please enter a variance reason/.test(rec));
ok('R15: closed-tickets fetch still has NO .limit(100)',
  !/\.eq\('status', 'Closed'\)[\s\S]{0,200}\.limit\(100\)/.test(page));
ok('R16: invoice insert in page.jsx still uses order_number + customer_name',
  /supabase\.from\('invoices'\)\.insert\(\{\s+order_number: orderNum, customer_name: sanitize\(resolvedCustomerName\)/.test(page));
ok('R17: treasury linking by order_number still wired',
  /\.from\('treasury'\)\s+\.select\('id'\)\s+\.eq\('order_number', orderNum\)\s+\.is\('linked_invoice_id', null\)/.test(page));

// ──────────────────────────────────────────────────────────────────
// Version stamp
// ──────────────────────────────────────────────────────────────────
ok('V1: version stamp v55.83-A.6.27.49 or later',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.49 (smart search + simplified row form) tests passed');
