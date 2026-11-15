// v55.83-A.6.27.60 — Inventory + UX cleanup
//
// Scope (11 items):
//   1. Always allow template edit/delete (variants are independent — Max May 22)
//   2. Light-blue highlight on template rows in Product List
//   3. Center all form labels app-wide (one CSS rule)
//   4. Default 9 filter levels expanded on Inventory Overview
//   5. Strip stale "What's in this build" banners
//   6. Deactivate-actually-blocks-login fix (security)
//   7. Duplicate user warning on Add Team Member
//   8. Inbound Shipments modal go BIG (99vw × 99vh)
//   9. Rename "Import Stock" → "Import Shipment"
//   10. Rename "Variants" → "Products" everywhere user-facing
//   11. Product Overview enhancement — 9 levels inline + history drilldown

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page    = read('src/app/page.jsx');
var login   = read('src/app/login/page.jsx');
var ipm     = read('src/components/InventoryProductMaster.jsx');
var ir      = read('src/components/InventoryReceiving.jsx');
var iov     = read('src/components/InventoryOverview.jsx');
var it      = read('src/components/InventoryTab.jsx');
var settings = read('src/components/SettingsTab.jsx');
var css     = read('src/app/globals.css');
var wn      = read('src/components/WhatsNewWidget.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// ITEM 1 — Always allow template edit/delete
// ══════════════════════════════════════════════════════════════════
ok('1.1: Spec-field edit lock REMOVED comment present',
  /v55\.83-A\.6\.27\.60 — Spec-field edit lock REMOVED/.test(ipm));
ok('1.2: Always-allow-delete comment present (mental model: variants are independent)',
  /v55\.83-A\.6\.27\.60 — Always allow deleting templates/.test(ipm));
ok('1.3: Lock banner removed from edit modal',
  /v55\.83-A\.6\.27\.60 — Lock banner REMOVED/.test(ipm));

// ══════════════════════════════════════════════════════════════════
// ITEM 2 — Light-blue highlight on template rows
// ══════════════════════════════════════════════════════════════════
ok('2.1: Light-blue background on template rows comment',
  /v55\.83-A\.6\.27\.60 — Light-blue background on template rows/.test(ipm));
ok('2.2: bg-sky-50 used on template rows',
  /bg-sky-50/.test(ipm));
ok('2.3: TEMPLATE badge uses stronger sky color',
  /v55\.83-A\.6\.27\.60 — TEMPLATE badge uses stronger sky color/.test(ipm));

// ══════════════════════════════════════════════════════════════════
// ITEM 3 — Center all form labels app-wide (one CSS rule)
// ══════════════════════════════════════════════════════════════════
ok('3.1: globals.css has the v55.83-A.6.27.60 label-centering rule',
  /v55\.83-A\.6\.27\.60 — Center form labels app-wide/.test(css));
ok('3.2: CSS targets label[class*="text-["][class*="font-"] selector',
  /label\[class\*="text-\["\]\[class\*="font-"\]/.test(css));
ok('3.3: CSS rule includes text-align: center',
  /text-align: center/.test(css));
ok('3.4: CSS excludes checkbox + radio labels via :not() chain',
  /:not\(:has\(input\[type="checkbox"\]\)\):not\(:has\(input\[type="radio"\]\)\)/.test(css));
ok('3.5: CSS excludes labels with explicit text-left/text-right alignment',
  /:not\(\[class\*="text-left"\]\):not\(\[class\*="text-right"\]\)/.test(css));

// ══════════════════════════════════════════════════════════════════
// ITEM 4 — Default 9 filter levels expanded on Inventory Overview
// ══════════════════════════════════════════════════════════════════
ok('4.1: Filter section defaults to ALWAYS OPEN comment',
  /v55\.83-A\.6\.27\.60 — Filter section defaults to ALWAYS OPEN/.test(iov));

// ══════════════════════════════════════════════════════════════════
// ITEM 5 — Strip stale "What's in this build" banners
// ══════════════════════════════════════════════════════════════════
ok('5.1: Stale What\'s in this build panel removed from InventoryTab',
  /v55\.83-A\.6\.27\.60 — Removed stale "What's in this build" details panel/.test(it));
ok('5.2: No remaining stale "What\'s in this build" rendered text in InventoryTab',
  // Allow the comment about removal (line starts with `{/*`); forbid actual rendered text
  !/<details[^>]*>[\s\S]{0,200}What.?s in this build/.test(it));

// ══════════════════════════════════════════════════════════════════
// ITEM 6 — Deactivate-actually-blocks-login (security)
// ══════════════════════════════════════════════════════════════════
ok('6.1: login flow SELECTs profile.active',
  /\.select\('id, name, active'\)/.test(login));
ok('6.2: deactivated users get signed out (v55.83-A.6.27.66 — now uses isActiveUser helper which catches NULL too)',
  /if \(profile && !isActiveUser\(profile\)\)/.test(login) &&
  /supabase\.auth\.signOut\(\)/.test(login));
ok('6.3: blocking error shown to deactivated user',
  /Your account has been deactivated\. Contact your administrator to restore access/.test(login));
ok('6.4: session insert NO LONGER falls back to data.user.id (auth UUID)',
  !/var sessionUserId = profile\?\.id \|\| data\.user\.id/.test(login));
ok('6.5: session insert is gated on profile?.id',
  /if \(profile\?\.id\) \{/.test(login) &&
  /user_id: profile\.id/.test(login));
ok('6.6: console.warn fires when no profile.id found',
  /\[login\] no users\.id found for/.test(login));
ok('6.7: comments explain the .60 changes',
  /v55\.83-A\.6\.27\.60 — Profile lookup now blocks deactivated users/.test(login));

// ══════════════════════════════════════════════════════════════════
// ITEM 7 — Duplicate user warning on Add Team Member
// ══════════════════════════════════════════════════════════════════
ok('7.1: handleAddMember includes v55.83-A.6.27.60 dup guard comment',
  /v55\.83-A\.6\.27\.60 — Duplicate-user guard/.test(settings));
ok('7.2: Case-insensitive email match check',
  /var newEmail = \(f\.email \|\| ''\)\.toLowerCase\(\)\.trim\(\)/.test(settings) &&
  /var dupByEmail = \(users \|\| \[\]\)\.find/.test(settings));
ok('7.3: Email dup → hard block with error including existing user info',
  /A team member with email/.test(settings) &&
  /already exists/.test(settings));
ok('7.4: Name match → confirm dialog (not hard block)',
  /var dupByName = \(users \|\| \[\]\)\.find/.test(settings) &&
  /window\.confirm/.test(settings) &&
  /Adding another row will likely create duplicate-stats problems/.test(settings));
ok('7.5: Email check fires before name check (short-circuit)',
  /if \(dupByEmail\) \{[\s\S]{0,500}if \(dupByName\) \{/.test(settings));

// ══════════════════════════════════════════════════════════════════
// ITEM 8 — Inbound Shipments modal go BIG
// ══════════════════════════════════════════════════════════════════
ok('8.1: Modal sizing comment present (HOTFIX 21+23 superseded the v55.83-A.6.27.60 comment)',
  /HOTFIX 21\+23 — Max May 27 2026 screenshots/.test(ir) ||
  /HOTFIX 21 — Max May 27 2026 screenshot/.test(ir) ||
  /v55\.83-A\.6\.27\.60 — Modal now near-fullscreen \(99vw × calc 100vh - 12px\)/.test(ir));
ok('8.2: 99vw used',
  /99vw/.test(ir));

// ══════════════════════════════════════════════════════════════════
// ITEM 9 — Rename Import Stock → Import Shipment
// ══════════════════════════════════════════════════════════════════
ok('9.1: Sidebar label uses "Import Shipment" not "Import Stock"',
  /label: '📦 Import Shipment'/.test(it));
ok('9.2: id stays "importstock" for backward compat',
  /id: 'importstock'/.test(it));

// ══════════════════════════════════════════════════════════════════
// ITEM 10 — Rename "Variants" → "Products" everywhere user-facing
// ══════════════════════════════════════════════════════════════════
ok('10.1: filter dropdown shows "Products only (actual SKUs) — default" (HOTFIX 12 shortened label)',
  /Products only \(actual SKUs\) — default/.test(read('src/components/InventoryProductMaster.jsx')));
ok('10.2: filter dropdown "Template blueprints only" option (v72 HOTFIX 8 relabel)',
  /<option value="templates">Template blueprints only \(for creating Products\)<\/option>/.test(ipm));
ok('10.3: "+ Variant" button renamed to "+ Product"',
  /\+ Product\s*<\/button>/.test(ipm));
ok('10.4: + Product button tooltip clarifies independence',
  /Create an actual Product from this Template blueprint \(independent — edits\/deletes to template won't affect it\)/.test(ipm));
ok('10.5: Receiving picker VARIANT badge → PRODUCT badge',
  />PRODUCT</.test(ir) &&
  !/<span className="text-\[9px\] bg-emerald-200 text-emerald-900 font-bold rounded px-1\.5">VARIANT</.test(ir));
ok('10.6: InventoryOverview "Template Products" tooltip uses "Products" not "variants"',
  /Template Products have no physical stock — they're only used to create Products/.test(iov));
ok('10.7: InventoryProductMaster history tooltip uses "Product" not "variant"',
  /View full history of this Product/.test(ipm));
ok('10.8: page.jsx Template badge tooltip uses "Product" not "variant"',
  /Family template — Product will be created at consumption/.test(page));

// ══════════════════════════════════════════════════════════════════
// ITEM 11 — Product Overview enhancement (9 levels + history drilldown)
// ══════════════════════════════════════════════════════════════════
ok('11.1: historyProduct state declared',
  /var \[historyProduct, setHistoryProduct\] = useState\(null\)/.test(iov));
ok('11.2: historyLayers state declared',
  /var \[historyLayers, setHistoryLayers\] = useState\(\[\]\)/.test(iov));
ok('11.3: historyMovements state declared',
  /var \[historyMovements, setHistoryMovements\] = useState\(\[\]\)/.test(iov));
ok('11.4: historyLoading + historyError state declared',
  /var \[historyLoading, setHistoryLoading\] = useState\(false\)/.test(iov) &&
  /var \[historyError, setHistoryError\] = useState\(null\)/.test(iov));
ok('11.5: openHistory(product) helper queries inventory_layers',
  /async function openHistory\(product\)/.test(iov) &&
  /\.from\('inventory_layers'\)/.test(iov) &&
  /\.eq\('product_id', product\.id\)/.test(iov));
ok('11.6: openHistory queries inventory_movements too',
  /\.from\('inventory_movements'\)/.test(iov));
ok('11.7: openHistory queries each in own try/catch (graceful degrade)',
  // Two try blocks inside openHistory body
  (iov.match(/console\.warn\('\[history\]/g) || []).length >= 2);
ok('11.8: closeHistory clears all state',
  /function closeHistory\(\)/.test(iov) &&
  /setHistoryProduct\(null\)/.test(iov) &&
  /setHistoryLayers\(\[\]\)/.test(iov) &&
  /setHistoryMovements\(\[\]\)/.test(iov));
ok('11.9: Each product row computes 9 level labels',
  /var levelLabels = \[/.test(iov) &&
  /listsById\[p\.family_list_id\]/.test(iov) &&
  /listsById\[p\.origin_list_id\]/.test(iov));
ok('11.10: 9 level labels rendered under name (F:/Cat:/Gr:/Co:/B:/Cl:/P:/Sp:/O:)',
  /\['F', listsById\[p\.family_list_id\]\]/.test(iov) &&
  /\['Cat', listsById\[p\.category_list_id\]\]/.test(iov) &&
  /\['Gr', listsById\[p\.grade_list_id\]\]/.test(iov) &&
  /\['O', listsById\[p\.origin_list_id\]\]/.test(iov));
ok('11.11: ↗ History link button on each row, calls openHistory',
  /onClick=\{function \(\) \{ openHistory\(p\); \}\}/.test(iov) &&
  /↗ History/.test(iov));
ok('11.12: History modal renders when historyProduct truthy',
  /\{historyProduct && \(/.test(iov));
ok('11.13: History modal shows gradient blue header',
  /bg-gradient-to-r from-blue-700 to-indigo-700/.test(iov));
ok('11.14: History modal stock summary tiles (Current / Original / Sold / P&L)',
  /Current Stock/.test(iov) &&
  /Original Received/.test(iov) &&
  />Sold</.test(iov));
ok('11.15: History modal inbound shipments table with key columns',
  /📥 Inbound — Stock Received/.test(iov) &&
  />Receipt #</.test(iov) &&
  />Supplier</.test(iov) &&
  />Qty Received</.test(iov) &&
  />Qty Remaining</.test(iov));
ok('11.16: History modal outbound movements table',
  /📤 Outbound — Movements/.test(iov) &&
  /movement_type \|\| mov\.type/.test(iov));
ok('11.17: History modal has Close button in footer',
  /onClick=\{closeHistory\}/.test(iov) &&
  />Close</.test(iov));
ok('11.18: History modal sized max-w-5xl with z-[120]',
  /max-w-5xl/.test(iov) &&
  /z-\[120\]/.test(iov));

// ══════════════════════════════════════════════════════════════════
// PART R — REGRESSION GUARDS
// ══════════════════════════════════════════════════════════════════
ok('R1: 59 — printOpenAccountInvoice helper still exists',
  fs.existsSync(path.join(__dirname, '..', 'src/lib/open-account-invoice-print.js')));
ok('R2: 59 — mini-invoice SQL still in sql/ folder',
  fs.existsSync(path.join(__dirname, '..', 'sql/v55-83-a-6-27-59-open-account-invoices.sql')));
ok('R3: 59 — OpenAccountsTab still has + Invoice button',
  /\+ Invoice/.test(read('src/components/OpenAccountsTab.jsx')));
ok('R4: 58 — multi-currency walk preserved',
  /var sim = simulate\(arr\)/.test(read('src/components/OpenAccountsTab.jsx')));
ok('R5: 57 — Shipping rate save instrumentation preserved',
  /console\.log\('\[shipping-rates\] save attempt:'/.test(read('src/components/ShippingRatesTab.jsx')));
ok('R6: 56 — Inbound Shipments 3-region modal preserved',
  /var \[headerCollapsed, setHeaderCollapsed\] = useState\(false\)/.test(ir));
ok('R7: 55 — openaccounts in FINANCE sidebar preserved',
  /\{ group: 'FINANCE', items: \['sales', 'treasury', 'checks', 'debts', 'openaccounts'/.test(page));
ok('R8: 54 — amber header version pill preserved',
  /background: '#fef3c7'/.test(page));
ok('R9: 53 — Business Entities entity picker on accounts preserved',
  /Our Entity for this Account \* \/ كياننا/.test(read('src/components/OpenAccountsTab.jsx')));
ok('R10: 52 — Open Accounts tab registered',
  /\{ id: 'openaccounts', label: 'Open Accounts \/ حسابات', icon: '📒' \}/.test(page));
ok('R11: closed-tickets fetch still has NO .limit(100)',
  !/\.eq\('status', 'Closed'\)[\s\S]{0,200}\.limit\(100\)/.test(page));
ok('R12: WhatsNew widget has .60 entry',
  /version: 'v55\.83-A\.6\.27\.60'/.test(wn));
ok('R13: WhatsNew widget still has .59 entry',
  /version: 'v55\.83-A\.6\.27\.59'/.test(wn));
ok('R14: 40 — variantTemplate state REMOVED in v55.83-A.6.27.71 Phase 4 cleanup (variant modal was orphaned dead code)',
  !/var \[variantTemplate, setVariantTemplate\] = useState\(null\)/.test(ipm));

// ──────────────────────────────────────────────────────────────────
// Version stamp
// ──────────────────────────────────────────────────────────────────
ok('V1: version stamp v55.83-A.6.27.60 or later',
  /BUILD v55\.83-A\.6\.27\.(60|6\d|[7-9]\d)/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.60 tests passed');
