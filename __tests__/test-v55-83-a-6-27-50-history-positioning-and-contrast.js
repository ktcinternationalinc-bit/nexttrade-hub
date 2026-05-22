// v55.83-A.6.27.50 — History modal top positioning + tab contrast + schema toast
//   1. Variant History modal anchored to top of viewport (items-start, pt-6)
//      so user sees it immediately without scrolling.
//   2. Tab contrast bumped to fully solid: active = black-on-white with thick
//      indigo-600 border, inactive = white-on-slate-800. Opacity tricks removed.
//   3. Schema diagnostic now fires a warning toast on page load when migrations
//      are missing, so the user doesn't have to notice the banner silently.

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var vh   = read('src/components/InventoryVariantHistory.jsx');
var pm   = read('src/components/InventoryProductMaster.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — Modal anchored to top of viewport (not center)
// ══════════════════════════════════════════════════════════════════

ok('A1: modal uses items-start (top alignment) instead of items-center',
  /fixed inset-0 z-\[200\] bg-black\/80 flex items-start justify-center/.test(vh) &&
  !/items-center justify-center p-4/.test(vh));
ok('A2: modal has pt-6 (padding-top) so it sits 24px below viewport top',
  /flex items-start justify-center pt-6 pb-6 px-4/.test(vh));
ok('A3: overlay is scrollable (so long modals work on short screens)',
  /flex items-start justify-center pt-6 pb-6 px-4 overflow-y-auto/.test(vh));
ok('A4: modal maxHeight uses calc(100vh - 60px) to fit between paddings',
  /maxHeight: 'calc\(100vh - 60px\)'/.test(vh));
ok('A5: backdrop still closes modal on click',
  /fixed inset-0 z-\[200\][^"]*" onClick=\{onClose\}>/.test(vh));

// ══════════════════════════════════════════════════════════════════
// PART B — Tab contrast (high-contrast active/inactive)
// ══════════════════════════════════════════════════════════════════

ok('B1: active tab is bg-white text-slate-900 (BLACK text on WHITE, max contrast)',
  /active \? 'bg-white text-slate-900 border-2 border-b-0 border-indigo-600 shadow-md'/.test(vh));
ok('B2: inactive tab is bg-slate-800 text-white (WHITE text on near-black)',
  /'bg-slate-800 text-white hover:bg-slate-700 border-2 border-transparent'/.test(vh));
ok('B3: opacity tricks removed from separator (was opacity-90)',
  /<span className="mx-1">\/<\/span>/.test(vh) &&
  !/<span className="mx-1 opacity-90">\/</.test(vh));
ok('B4: opacity tricks removed from count (was opacity-95)',
  /<span className="ml-1 text-xs">\(\{t\.count\}\)<\/span>/.test(vh) &&
  !/text-xs opacity-95/.test(vh));
ok('B5: tab strip border bumped to indigo-400 for clearer divider',
  /flex gap-1 px-4 pt-3 bg-indigo-100 border-b-2 border-indigo-400/.test(vh));
ok('B6: active tab border indigo-400 → indigo-600 (more visible)',
  /border-indigo-600 shadow-md/.test(vh));

// ══════════════════════════════════════════════════════════════════
// PART C — Schema diagnostic now also fires a toast on page load
// ══════════════════════════════════════════════════════════════════

ok('C1: schema diagnostic toast fires when issues.length > 0',
  /if \(issues\.length > 0 && !cancelled\) \{\s+toast\.warning\(/.test(pm));
ok('C2: toast message mentions migration count + tells user to look at banner',
  /Database missing ' \+ issues\.length \+ ' migration/.test(pm) &&
  /see the amber banner above for details/.test(pm));
ok('C3: toast mentions the star button as an example consequence',
  /Some buttons \(like the star\) won.{1,2}t save until the SQL is run/.test(pm));
ok('C4: existing banner render still gated on schemaIssues.length > 0',
  /\{schemaIssues\.length > 0 && \(/.test(pm));
ok('C5: existing diagnostic for .38/.39/.43 migrations still in place',
  /issues\.push\(\{ migration: 'v55\.83-A\.6\.27\.38'/.test(pm) &&
  /issues\.push\(\{ migration: 'v55\.83-A\.6\.27\.39'/.test(pm) &&
  /issues\.push\(\{ migration: 'v55\.83-A\.6\.27\.43'/.test(pm));

// ══════════════════════════════════════════════════════════════════
// PART D — toggleFeatured diagnostic still in place (from .46)
// ══════════════════════════════════════════════════════════════════

ok('D1: toggleFeatured pre-write probe still queries featured column',
  /var verifyRes = await supabase\.from\('inventory_products'\)\.select\('id, featured'\)/.test(pm));
ok('D2: toggleFeatured surfaces "run migration .38" message on missing column',
  /Stars not yet enabled — run SQL migration v55\.83-A\.6\.27\.38/.test(pm));
ok('D3: toggleFeatured read-back after write detects auto-strip',
  /var after = await supabase\.from\('inventory_products'\)\.select\('featured'\)/.test(pm));
ok('D4: toggleFeatured persistence error message',
  /Star save did not persist — check that SQL migration \.38 was run/.test(pm));

// ══════════════════════════════════════════════════════════════════
// PART R — REGRESSION GUARDS
// ══════════════════════════════════════════════════════════════════

ok('R1: 49 — Smart search includes design_sku + supplier + notes + classText',
  /\(p\.design_sku \|\| ''\) \+ ' '/.test(read('src/components/InventoryReceiving.jsx')) &&
  /classText\(p\)/.test(read('src/components/InventoryReceiving.jsx')));
ok('R2: 49 — Quantity Received * label present',
  /Quantity Received \*\s/.test(read('src/components/InventoryReceiving.jsx')));
ok('R3: 49 — kgRequired conditional UoM kg check',
  /var kgRequired = \(u === 'kg' \|\| u === 'kgs' \|\| u === 'kilo'/.test(read('src/components/InventoryReceiving.jsx')));
ok('R4: 48 — Modal width 97vw / 1900',
  /style=\{\{ width: '97vw', maxWidth: 1900/.test(read('src/components/InventoryReceiving.jsx')));
ok('R5: 48 — Inbound Shipments naming preserved (Receive Stock gone)',
  !/Receive Stock/.test(read('src/components/InventoryReceiving.jsx')));
ok('R6: 48 — Product List naming preserved (Product Master gone from InventoryTab)',
  !/Product Master/.test(read('src/components/InventoryTab.jsx')));
ok('R7: 47 — Shipping Rates keyFor uses port_of_loading + port_of_discharge + effective_date',
  /var pol = normName\(r\.port_of_loading\) \|\| normName\(r\.origin\)/.test(read('src/components/ShippingRatesTab.jsx')));
ok('R8: 46 — openDuplicate inlines form (no async race)',
  /function openDuplicate\(p\) \{\s+setModalMode\('new'\);/.test(pm));
ok('R9: 45 — Egypt Bank owner deposit + rules still wired',
  /const toggleOwnerDeposit = async \(txnId\)/.test(read('src/components/EgyptBankTab.jsx')) &&
  /supabase\.rpc\('apply_egypt_bank_rules', params\)/.test(read('src/components/EgyptBankTab.jsx')));
ok('R10: 44c — consume_invoice_item_inventory RPC still wired',
  /supabase\.rpc\('consume_invoice_item_inventory', \{ p_item_id: insertedItem\.id \}\)/.test(page));
ok('R11: 44d.1 — VariantHistory component default export preserved',
  /export default function InventoryVariantHistory/.test(vh));
ok('R12: 44d.1 — 4 tabs still present (summary/inbound/outbound/adjustments)',
  /id: 'summary'/.test(vh) && /id: 'inbound'/.test(vh) && /id: 'outbound'/.test(vh) && /id: 'adjustments'/.test(vh));
ok('R13: 44d.1 — 12 Card invocations in summary still present',
  (vh.match(/<Card label_en=/g) || []).length === 12);
ok('R14: History button still toasts + scrolls to top',
  /toast\.success\('📂 History opened for/.test(pm) &&
  /window\.scrollTo\(\{ top: 0, behavior: 'smooth' \}\)/.test(pm));
ok('R15: closed-tickets fetch still has NO .limit(100)',
  !/\.eq\('status', 'Closed'\)[\s\S]{0,200}\.limit\(100\)/.test(page));
ok('R16: invoice insert in page.jsx still uses order_number + customer_name',
  /supabase\.from\('invoices'\)\.insert\(\{\s+order_number: orderNum, customer_name: sanitize\(resolvedCustomerName\)/.test(page));
ok('R17: treasury linking by order_number still wired',
  /\.from\('treasury'\)\s+\.select\('id'\)\s+\.eq\('order_number', orderNum\)\s+\.is\('linked_invoice_id', null\)/.test(page));

// ──────────────────────────────────────────────────────────────────
// Version stamp
// ──────────────────────────────────────────────────────────────────
ok('V1: version stamp v55.83-A.6.27.50 or later',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.50 (history positioning + contrast + schema toast) tests passed');
