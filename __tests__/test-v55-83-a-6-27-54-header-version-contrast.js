// v55.83-A.6.27.54 — Header version label HIGH CONTRAST.
//
// THE THIRD TIME Max has reported the version label is too light to read.
// Previously: text-zinc-500 (mid-gray) on #0a0a0a (true black) — invisible
// at normal zoom.
// Now: bright amber pill (bg #fef3c7, text #451a03, border #d97706) —
// readable at any zoom, still terminal-aesthetic.
//
// Also bundling: missing SQL migration .38 for star/favorite button (the
// `featured` and `use_count` columns on inventory_products).

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — Version label uses amber HIGH CONTRAST pill
// ══════════════════════════════════════════════════════════════════

ok('A1: version label no longer uses text-zinc-500 (the light-gray problem)',
  !/text-\[10px\] text-zinc-500 font-mono hidden md:inline.*v55\.83-A\.6\.27/.test(page));
ok('A2: version label uses amber-100 pill background (#fef3c7)',
  /background: '#fef3c7'/.test(page));
ok('A3: version label uses amber-950 near-black text (#451a03)',
  /color: '#451a03'/.test(page));
ok('A4: version label has amber-600 border for definition',
  /border: '1px solid #d97706'/.test(page));
ok('A5: version label uses font-extrabold (max readability) — .54 amber pill preserved in newer builds',
  /text-\[10px\] font-mono font-extrabold hidden md:inline px-2 py-0\.5 rounded[\s\S]{0,500}v55\.83-A\.6\.27\.\d+/.test(page));
ok('A6: clock label also brightened from zinc-500 to amber-300',
  /color: '#fcd34d' \/\* amber-300 \*\//.test(page));
ok('A7: comment explains this is the third Max request',
  /THIRD TIME|repeated Max feedback|HIGH CONTRAST/.test(page));

// ══════════════════════════════════════════════════════════════════
// PART B — Version bump
// ══════════════════════════════════════════════════════════════════

ok('B1: version stamp updated to v55.83-A.6.27.54 or later',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));
ok('B2: header label shows v55.83-A.6.27.54 or later',
  />\s*v55\.83-A\.6\.27\.\d+\s*</.test(page));
ok('B3: page.jsx version stamps moved past v55.83-A.6.27.53 (no stale .53 refs)',
  !/v55\.83-A\.6\.27\.53(?!\D)/.test(page) || /BUILD v55\.83-A\.6\.27\.5[4-9]/.test(page));

// ══════════════════════════════════════════════════════════════════
// PART R — REGRESSION GUARDS (must not break prior builds)
// ══════════════════════════════════════════════════════════════════

ok('R1: 53 — Business Entities section in SettingsTab preserved',
  /\['entities', '🏢 Business Entities'\]/.test(read('src/components/SettingsTab.jsx')));
ok('R2: 53 — Open Accounts entity picker still wired',
  /Our Entity for this Account \* \/ كياننا/.test(read('src/components/OpenAccountsTab.jsx')));
ok('R3: 53 — Print + Excel buttons still on account card',
  /🖨️ Print/.test(read('src/components/OpenAccountsTab.jsx')) &&
  /📊 Excel/.test(read('src/components/OpenAccountsTab.jsx')));
ok('R4: 52 — open_accounts SQL still loads correctly',
  /supabase\.from\('open_accounts'\)\.select\('\*'\)\.order\('account_name'\)/.test(read('src/components/OpenAccountsTab.jsx')));
ok('R5: 52 — CREDIT vs DEBIT radio panels preserved',
  /CREDIT — money IN/.test(read('src/components/OpenAccountsTab.jsx')) &&
  /DEBIT — money OUT/.test(read('src/components/OpenAccountsTab.jsx')));
ok('R6: 52 — Open Accounts tab registered in main nav',
  /\{ id: 'openaccounts', label: 'Open Accounts \/ حسابات', icon: '📒' \}/.test(page));
ok('R7: 51 — InventoryOverview default export preserved',
  /export default function InventoryOverview/.test(read('src/components/InventoryOverview.jsx')));
ok('R8: 51 — Inventory tab default subtab = overview',
  /var \[subtab, setSubtab\] = useState\('overview'\)/.test(read('src/components/InventoryTab.jsx')));
ok('R9: 50 — Variant History modal anchored to top',
  /flex items-start justify-center pt-6 pb-6 px-4/.test(read('src/components/InventoryVariantHistory.jsx')));
ok('R10: 49 — Smart search includes design_sku + classText',
  /\(p\.design_sku \|\| ''\) \+ ' '/.test(read('src/components/InventoryReceiving.jsx')) &&
  /classText\(p\)/.test(read('src/components/InventoryReceiving.jsx')));
ok('R11: 48 — Inbound Shipments / Product List labels preserved',
  /label: '🚚 Inbound Shipments'/.test(read('src/components/InventoryTab.jsx')) &&
  /label: '🏷️ Product List'/.test(read('src/components/InventoryTab.jsx')));
ok('R12: 47 — Shipping Rates keyFor uses port_of_loading + effective_date',
  /var pol = normName\(r\.port_of_loading\) \|\| normName\(r\.origin\)/.test(read('src/components/ShippingRatesTab.jsx')));
ok('R13: 46 — Schema diagnostic banner still in InventoryProductMaster',
  /Database migrations needed/.test(read('src/components/InventoryProductMaster.jsx')));
ok('R14: 45 — Egypt Bank owner deposit + apply rules RPC still wired',
  /const toggleOwnerDeposit = async \(txnId\)/.test(read('src/components/EgyptBankTab.jsx')) &&
  /supabase\.rpc\('apply_egypt_bank_rules', params\)/.test(read('src/components/EgyptBankTab.jsx')));
ok('R15: 44c — consume_invoice_item_inventory RPC still wired',
  /supabase\.rpc\('consume_invoice_item_inventory', \{ p_item_id: insertedItem\.id \}\)/.test(page));
ok('R16: closed-tickets fetch still has NO .limit(100)',
  !/\.eq\('status', 'Closed'\)[\s\S]{0,200}\.limit\(100\)/.test(page));
ok('R17: invoice insert still uses order_number + customer_name',
  /supabase\.from\('invoices'\)\.insert\(\{\s+order_number: orderNum, customer_name: sanitize\(resolvedCustomerName\)/.test(page));

// ══════════════════════════════════════════════════════════════════
// PART P — Brand mark + main nav unchanged
// ══════════════════════════════════════════════════════════════════

ok('P1: [KTC] brand mark still emerald-400 (untouched)',
  /<span className="text-emerald-400 font-mono text-xs font-bold tracking-tight" style=\{\{ fontFamily: '"JetBrains Mono", monospace' \}\}>\[KTC\]<\/span>/.test(page));
ok('P2: NEXTTRADE HUB title still bold white (untouched)',
  /<h1 className="text-sm font-bold text-white tracking-tight whitespace-nowrap">NEXTTRADE HUB<\/h1>/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.54 (header version label contrast) tests passed');
