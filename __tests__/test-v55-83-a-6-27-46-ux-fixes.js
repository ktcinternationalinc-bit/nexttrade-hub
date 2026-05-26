// v55.83-A.6.27.46 — Product Master UX fixes:
//   1. Copy race condition fixed (no async openEdit dependency)
//   2. Copy-save validation message when quick_code blank
//   3. Star toggle diagnostic for missing SQL migration
//   4. Schema diagnostic banner detects missing migrations on mount
//   5. History button toasts confirmation + scrolls to top
//   6. Variant History modal z-index bumped to 200 + tab contrast fix
//   7. Code suffix + label contrast bumped (slate-500 → slate-700)
//   Plus 18 regression guards.

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var pm   = read('src/components/InventoryProductMaster.jsx');
var vh   = read('src/components/InventoryVariantHistory.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — Copy race condition fix
// ══════════════════════════════════════════════════════════════════

ok('A1: openDuplicate no longer calls openEdit (was the race condition)',
  !/function openDuplicate\(p\) \{\s+openEdit\(p\);/.test(pm));
ok('A2: openDuplicate sets modalMode synchronously to "new"',
  /function openDuplicate\(p\) \{\s+setModalMode\('new'\);/.test(pm));
ok('A3: openDuplicate skips editLocked (new copy has no references)',
  /function openDuplicate\(p\)[\s\S]{0,500}setEditLocked\(false\)/.test(pm));
ok('A4: openDuplicate inlines all form fields (no reliance on prev)',
  /function openDuplicate\(p\)[\s\S]{0,3000}setForm\(\{[\s\S]{0,2000}quick_code: '',/.test(pm));
ok('A5: openDuplicate names use " (copy)" suffix for English',
  /name_en: \(p\.name_en \|\| ''\) \+ ' \(copy\)'/.test(pm));
ok('A6: openDuplicate gives immediate toast feedback',
  /openDuplicate\(p\)[\s\S]{0,3500}toast\.success\('✓ Copied — change the Quick Code, then Save \/ تم النسخ/.test(pm));

// ══════════════════════════════════════════════════════════════════
// PART B — Copy-save validation
// ══════════════════════════════════════════════════════════════════

ok('B1: save() detects copy + blank quick_code → clear error toast',
  /modalMode === 'new' && \(form\.name_en \|\| ''\)\.endsWith\('\(copy\)'\) && !quickCode/.test(pm));
ok('B2: error message is actionable and bilingual',
  /Please change the Quick Code before saving this copied item \/ يرجى تغيير الكود قبل الحفظ/.test(pm));

// ══════════════════════════════════════════════════════════════════
// PART C — Star toggle silent-failure detection
// ══════════════════════════════════════════════════════════════════

ok('C1: toggleFeatured probes for featured column BEFORE writing',
  /async function toggleFeatured[\s\S]{0,1500}var verifyRes = await supabase\.from\('inventory_products'\)\.select\('id, featured'\)/.test(pm));
ok('C2: toggleFeatured detects "column featured does not exist" error',
  /verifyRes\.error && \/column\.\*featured\.\*does not exist\/i\.test\(verifyRes\.error\.message \|\| ''\)/.test(pm));
ok('C3: clear migration-needed message',
  /Stars not yet enabled — run SQL migration v55\.83-A\.6\.27\.38/.test(pm));
ok('C4: read-back AFTER dbUpdate to confirm write took effect',
  /var after = await supabase\.from\('inventory_products'\)\.select\('featured'\)\.eq\('id', p\.id\)/.test(pm));
ok('C5: error if read-back shows no change (auto-strip caught)',
  /Star save did not persist — check that SQL migration \.38 was run/.test(pm));

// ══════════════════════════════════════════════════════════════════
// PART D — Schema diagnostic banner
// ══════════════════════════════════════════════════════════════════

ok('D1: schemaIssues state declared',
  /var \[schemaIssues, setSchemaIssues\] = useState\(\[\]\)/.test(pm));
ok('D2: load probes for featured + use_count (.38)',
  /supabase\.from\('inventory_products'\)\.select\('featured, use_count'\)\.limit\(1\)/.test(pm));
ok('D3: load probes for variant_suffix + parent_template_id (.39)',
  /supabase\.from\('inventory_products'\)\.select\('is_family_template, variant_suffix, parent_template_id'\)\.limit\(1\)/.test(pm));
ok('D4: load probes for can_delete_product RPC (.43)',
  /supabase\.rpc\('can_delete_product', \{ p_id: '00000000-0000-0000-0000-000000000000' \}\)/.test(pm));
ok('D5: each issue tagged with migration + affects',
  /issues\.push\(\{ migration: 'v55\.83-A\.6\.27\.38', columns_missing: \['featured', 'use_count'\], affects: 'Star\/favorite button' \}\)/.test(pm) &&
  /issues\.push\(\{ migration: 'v55\.83-A\.6\.27\.39'[\s\S]{0,500}affects: 'Family templates \/ Create Variant' \}\)/.test(pm) &&
  /issues\.push\(\{ migration: 'v55\.83-A\.6\.27\.43'[\s\S]{0,500}affects: 'Edit lock \+ Delete button' \}\)/.test(pm));
ok('D6: banner rendered only when schemaIssues.length > 0',
  /\{schemaIssues\.length > 0 && \(\s+<div className="bg-amber-100 border-2 border-amber-500/.test(pm));
ok('D7: banner is bilingual (English + Arabic)',
  /Database migrations needed[\s\S]{0,500}هناك ترقيات قاعدة بيانات مطلوبة/.test(pm));
ok('D8: banner lists each issue with migration number + affects + columns_missing',
  /<span className="font-mono">\{iss\.migration\}<\/span>/.test(pm) &&
  /Affects:[\s\S]{0,300}\{iss\.affects\}/.test(pm) &&
  /\{iss\.columns_missing\.join\(', '\)\}/.test(pm));

// ══════════════════════════════════════════════════════════════════
// PART E — History button feedback
// ══════════════════════════════════════════════════════════════════

ok('E1: History button toasts on click',
  /onClick=\{function \(\) \{\s+setHistoryVariant\(p\);\s+toast\.success\('📂 History opened for/.test(pm));
ok('E2: History button scrolls to top of page',
  /window\.scrollTo\(\{ top: 0, behavior: 'smooth' \}\)/.test(pm));
ok('E3: History toast is bilingual',
  /📂 History opened for[\s\S]{0,300}\/ تم فتح السجل/.test(pm));

// ══════════════════════════════════════════════════════════════════
// PART F — Variant History modal contrast + z-index
// ══════════════════════════════════════════════════════════════════

ok('F1: modal z-index bumped from z-[100] to z-[200]',
  /fixed inset-0 z-\[200\] bg-black\/80/.test(vh));
ok('F2: tab strip uses high-contrast indigo background',
  /flex gap-1 px-4 pt-3 bg-indigo-100 border-b-2 border-indigo-400/.test(vh));
ok('F3: inactive tab uses solid bg-slate-700 + white text (WCAG AAA)',
  /active \? 'bg-white text-slate-900 border-2 border-b-0 border-indigo-600 shadow-md' : 'bg-slate-800 text-white hover:bg-slate-700 border-2 border-transparent'/.test(vh));
ok('F4: opacity-75 replaced with opacity-90 or 95 (more readable)',
  !/opacity-75 mx-1/.test(vh) &&
  /opacity-90/.test(vh));
ok('F5: tab uses transition-colors for smooth state change',
  /text-sm font-extrabold rounded-t-lg transition-colors/.test(vh));

// ══════════════════════════════════════════════════════════════════
// PART G — Bullet text contrast (Product Master row)
// ══════════════════════════════════════════════════════════════════

ok('G1: code suffix uses slate-700 not slate-500',
  /<span className="text-slate-700 font-mono"> \(\{b\.code\}\)<\/span>/.test(pm) &&
  !/<span className="text-slate-500 font-mono"> \(\{b\.code\}\)/.test(pm));
ok('G2: bullet label uses font-extrabold + slate-700 (not font-bold + slate-600)',
  /<span className="font-extrabold text-slate-700">\{b\.label\}:/.test(pm) &&
  !/<span className="font-bold text-slate-600">\{b\.label\}:/.test(pm));

// ══════════════════════════════════════════════════════════════════
// PART R — REGRESSION GUARDS (CRITICAL)
// ══════════════════════════════════════════════════════════════════

ok('R1: 45 — Egypt Bank Owner Deposit toggle still wired',
  /const toggleOwnerDeposit = async \(txnId\)/.test(read('src/components/EgyptBankTab.jsx')));
ok('R2: 45 — Egypt Bank Rules engine RPC call still wired',
  /supabase\.rpc\('apply_egypt_bank_rules', params\)/.test(read('src/components/EgyptBankTab.jsx')));
ok('R3: 45 — Egypt Bank matchToInvoice still defined',
  /const matchToInvoice = async \(txnId, invoiceId\)/.test(read('src/components/EgyptBankTab.jsx')));
ok('R4: 45 — Egypt Bank recalcInvoiceCollected still wired',
  /await recalcInvoiceCollected\(invoiceId\)/.test(read('src/components/EgyptBankTab.jsx')));
ok('R5: 44a — InventoryTab cutoff panel still present',
  /Inventory Cutoff Date.*\/.*تاريخ بدء ربط المخزون/.test(read('src/components/InventoryTab.jsx')));
ok('R6: 44b — 📦 From Inventory tab still in invoice form',
  /📦 From Inventory \/ من المخزون/.test(page));
ok('R7: 44c — consume_invoice_item_inventory RPC still wired',
  /supabase\.rpc\('consume_invoice_item_inventory', \{ p_item_id: insertedItem\.id \}\)/.test(page));
ok('R8: 44d.1 — Variant History component still default-exported',
  /export default function InventoryVariantHistory/.test(vh));
ok('R9: Star button still rendered',
  /toggleFeatured\(p\)/.test(pm) &&
  /p\.featured === true \? '⭐' : '☆'/.test(pm));
ok('R10: 🔍 History button still rendered for all viewers (no canEdit gate)',
  /🔍 History/.test(pm) &&
  /setHistoryVariant\(p\)/.test(pm));
ok('R11: Delete button still wired with type-DELETE confirm',
  /Type DELETE \(in capitals\) to confirm/.test(pm));
ok('R12: + Variant button still wired (v55.83-A.6.27.66 Issue 10 — variant flow REPLACED with openCloneTemplate)',
  /openCloneTemplate\(p\)/.test(pm) || /openCreateVariant\(p\)/.test(pm));
ok('R13: Edit button still calls openEdit',
  /onClick=\{function \(\) \{ openEdit\(p\); \}\}/.test(pm));
ok('R14: Copy button still calls openDuplicate',
  /onClick=\{function \(\) \{ openDuplicate\(p\); \}\}/.test(pm));
ok('R15: can_delete_product RPC still called in deleteProduct (templates always-OK, variants checked)',
  /supabase\.rpc\('can_delete_product', \{ p_id: p\.id \}\)/.test(pm));
ok('R16: save() validates English + Arabic name required (HOTFIX 7 — collects all missing fields, shows in one message via alert+toast)',
  /missing\.push\('• English name/.test(pm) &&
  /missing\.push\('• Arabic name/.test(pm) &&
  /Cannot save — please fill in these required fields/.test(pm));
ok('R17: save() validates all 8 classification levels',
  /for \(var lvl = 1; lvl <= 8; lvl\+\+\) \{/.test(pm));
ok('R18: closed-tickets fetch still has NO .limit(100)',
  !/\.eq\('status', 'Closed'\)[\s\S]{0,200}\.limit\(100\)/.test(page));
ok('R19: invoice insert still uses order_number + customer_name',
  /supabase\.from\('invoices'\)\.insert\(\{\s+order_number: orderNum, customer_name: sanitize\(resolvedCustomerName\)/.test(page));
ok('R20: treasury linking by order_number still wired',
  /\.from\('treasury'\)\s+\.select\('id'\)\s+\.eq\('order_number', orderNum\)\s+\.is\('linked_invoice_id', null\)/.test(page));

// ──────────────────────────────────────────────────────────────────
// Version stamp
// ──────────────────────────────────────────────────────────────────
ok('V1: version stamp v55.83-A.6.27.46 or later',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.46 (UX fixes) tests passed');
