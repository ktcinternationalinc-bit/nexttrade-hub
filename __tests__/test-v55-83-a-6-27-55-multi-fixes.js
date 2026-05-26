// v55.83-A.6.27.55 — Multi-fix build:
//   1. openaccounts added to FINANCE sidebar group (visibility bug from .52)
//   2. Delete button alert fallback (toast-bypass when toast fails silently)
//   3. Product List default = variants only (was 'all')
//   4. "Family Templates" → "Template Products" rename in user-facing strings
//   5. Inventory Overview excludes Template Products by default + showTemplates toggle
//   6. Removed the per-line PHASE 1 EXPECTED TOTALS box (Max repeated request)
//   7. Picker hover bg-indigo-50 → bg-indigo-100 (text no longer washes out)
//   9. Excel template: =TEXTJOIN("-",TRUE,E#:M#) pre-filled in classification_slug column

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page     = read('src/app/page.jsx');
var pm       = read('src/components/InventoryProductMaster.jsx');
var ov       = read('src/components/InventoryOverview.jsx');
var rec      = read('src/components/InventoryReceiving.jsx');
var imp      = read('src/components/InventoryImportProducts.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — Item 1: openaccounts in FINANCE sidebar group
// ══════════════════════════════════════════════════════════════════

ok('A1: FINANCE group includes openaccounts (between debts and egyptbank)',
  /\{ group: 'FINANCE', items: \['sales', 'treasury', 'checks', 'debts', 'openaccounts', 'egyptbank', 'bank', 'quotes', 'reports'\] \}/.test(page));
ok('A2: openaccounts tab object still registered',
  /\{ id: 'openaccounts', label: 'Open Accounts \/ حسابات', icon: '📒' \}/.test(page));
ok('A3: render branch for openaccounts still in place',
  /\{tab === 'openaccounts' && \(\s+<SafeSection label="Open Accounts">/.test(page));

// ══════════════════════════════════════════════════════════════════
// PART B — Item 2: Delete button alert fallback
// ══════════════════════════════════════════════════════════════════

ok('B1: deleteProduct logs to console on click (diagnostic trail)',
  /console\.log\('\[product-master\] deleteProduct clicked for:'/.test(pm));
ok('B2: error toast fires on delete failure (defense in depth)',
  /try \{ toast\.error\('Delete failed: ' \+ errMsg2\); \} catch \(_\) \{\}/.test(pm));
ok('B3: explicit "function does not exist" → run SQL .43 message (in schema check)',
  /function.*can_delete_product.*does not exist|could not find the function/.test(pm) &&
  /v55\.83-A\.6\.27\.43/.test(pm));
ok('B4: helpful hint when delete blocked by FK constraints',
  /violates foreign key constraint|still referenced/i.test(pm));
ok('B5: final delete error fires alert as fallback (or hint shown via alert)',
  /catch \(e\) \{[\s\S]{0,1500}alert\(/.test(pm));
ok('B4: success on delete uses try/catch around toast',
  /try \{ toast\.success\('Permanently deleted: ' \+ \(p\.name_en \|\| p\.quick_code\)\); \} catch \(_\) \{\}/.test(pm));

// ══════════════════════════════════════════════════════════════════
// PART C — Item 3: Default typeFilter = variants
// ══════════════════════════════════════════════════════════════════

ok('C1: typeFilter default useState("variants") (was "all")',
  /var \[typeFilter, setTypeFilter\] = useState\('variants'\)/.test(pm));
ok('C2: comment explains the Max directive about templates not polluting Product List',
  /default of product list should be the variants/.test(pm));

// ══════════════════════════════════════════════════════════════════
// PART D — Item 4: "Family Templates" → "Template Products" rename
// (D1-D4 loosened in .60: "Variants" further renamed to "Products" per Max May 22)
// ══════════════════════════════════════════════════════════════════

ok('D1: dropdown labels use "Template Products" and a default-Products option (renamed in .60)',
  /<option value="variants">(Variants|Products)/.test(pm) &&
  /<option value="templates">Template Products only/.test(pm));
ok('D2: FAMILY badge → TEMPLATE badge in Product List rows',
  /TEMPLATE</.test(pm) && !/>FAMILY</.test(pm));
ok('D3: + Variant/Product button title mentions template or blueprint',
  /Create (a spec variant of this template product|an actual Product from this Template blueprint)/.test(pm));
ok('D4: edit-lock heading REMOVED in .60 (templates always editable now)',
  /v55\.83-A\.6\.27\.60 — Lock banner REMOVED/.test(pm));
ok('D5: edit-lock body REMOVED in .60 (variants are independent post-creation)',
  /v55\.83-A\.6\.27\.60 — Spec-field edit lock REMOVED/.test(pm));
ok('D6: picker dropdown badge renamed FAMILY → TEMPLATE in Receiving',
  /s\.is_family_template === true && <span className="text-\[9px\] bg-indigo-200 text-indigo-900 font-bold rounded px-1\.5">TEMPLATE<\/span>/.test(rec));

// ══════════════════════════════════════════════════════════════════
// PART E — Item 5: Inventory Overview excludes templates
// ══════════════════════════════════════════════════════════════════

ok('E1: showTemplates state declared, default false',
  /var \[showTemplates, setShowTemplates\] = useState\(false\)/.test(ov));
ok('E2: comment explains why templates have no physical stock',
  /Templates have no[\s\S]{0,80}physical stock/.test(ov));
ok('E3: filteredProducts skips templates when !showTemplates',
  /if \(!showTemplates && p\.is_family_template === true\) return false/.test(ov));
ok('E4: showTemplates added to useMemo deps array',
  /\}, \[products, productStats, listsById, search, showZeroStock, showTemplates, filterLevels\]\)/.test(ov));
ok('E5: "Show Template Products" checkbox rendered in toolbar',
  /<input type="checkbox" checked=\{showTemplates\} onChange=\{function \(e\) \{ setShowTemplates\(e\.target\.checked\); \}\}/.test(ov) &&
  /Show Template Products \/ إظهار قوالب المنتجات/.test(ov));

// ══════════════════════════════════════════════════════════════════
// PART F — Item 6: Per-line PHASE 1 EXPECTED TOTALS box REMOVED
// ══════════════════════════════════════════════════════════════════

ok('F1: per-line "PHASE 1 — EXPECTED TOTALS" box is GONE from Receiving',
  !/PHASE 1 — EXPECTED TOTALS \(from supplier invoice/.test(rec));
ok('F2: removal comment present (so future Claudes know not to add it back)',
  /REMOVED per-line PHASE 1 EXPECTED TOTALS box/.test(rec));
ok('F3: per-line expected_rolls state field still preserved (back-compat with old receipts)',
  /expected_rolls: '',/.test(rec));
ok('F4: per-line Expected Rolls/Gross/Net input fields no longer rendered',
  !/<label className="text-\[11px\] font-extrabold text-amber-900">Expected Rolls/.test(rec) &&
  !/<label className="text-\[11px\] font-extrabold text-amber-900">Expected Gross/.test(rec));

// ══════════════════════════════════════════════════════════════════
// PART G — Item 7: Picker hover contrast
// ══════════════════════════════════════════════════════════════════

ok('G1: picker rows use hover:bg-indigo-100 (was -50 — too light)',
  /className="w-full text-left px-3 py-1\.5 text-xs hover:bg-indigo-100 active:bg-indigo-200/.test(rec));
ok('G2: name line uses text-slate-800 font-semibold (was text-slate-700, washed out on hover)',
  /<div className="text-slate-800 font-semibold">\{s\.name_en\}/.test(rec));
ok('G3: classification slug uses text-slate-700 font-semibold (was text-slate-500)',
  /<div className="text-\[10px\] text-slate-700 font-mono font-semibold">\{s\.classification_slug\}/.test(rec));
ok('G4: VARIANT/PRODUCT badge uses darker bg-emerald-200 text-emerald-900',
  /s\.is_family_template === false && s\.variant_suffix && <span className="text-\[9px\] bg-emerald-200 text-emerald-900 font-bold rounded px-1\.5">(VARIANT|PRODUCT)/.test(rec));
ok('G5: "used Nx" counter uses text-slate-700 font-bold (was -500, washed out)',
  /<span className="text-\[10px\] text-slate-700 font-bold ml-auto">used \{s\.use_count\}×<\/span>/.test(rec));

// ══════════════════════════════════════════════════════════════════
// PART H — Item 9: Excel template TEXTJOIN slug formula
// ══════════════════════════════════════════════════════════════════

ok('H1: downloadTemplate computes slugColIndex via TEMPLATE_HEADERS.indexOf',
  /var slugColIndex = TEMPLATE_HEADERS\.indexOf\('classification_slug'\)/.test(imp));
ok('H2: slug column letter computed via XLSX.utils.encode_col',
  /var slugColLetter = XLSX\.utils\.encode_col\(slugColIndex\)/.test(imp));
ok('H3: TEXTJOIN formula written to 200 blank rows (rowNum 3..202)',
  /for \(var rowNum = 3; rowNum <= 202; rowNum\+\+\)/.test(imp));
ok('H4: formula is exactly =TEXTJOIN("-",TRUE,E#:M#)',
  /f: 'TEXTJOIN\("-",TRUE,E' \+ rowNum \+ ':M' \+ rowNum \+ '\)'/.test(imp));
ok('H5: cell type set to "s" (string) with initial value ""',
  /t: 's',[\s\S]{0,300}v: '',/.test(imp));
ok('H6: sheet range extended to row 202 so Excel renders the formulas',
  /var range = XLSX\.utils\.decode_range\(ref \|\| 'A1'\);\s+if \(range\.e\.r < 201\) \{ range\.e\.r = 201; prodSheet\['!ref'\] = XLSX\.utils\.encode_range\(range\);/.test(imp));
ok('H7: comment notes this is the .55 bonus from the deferred cascading-template request',
  /bonus from the deferred Excel-template cascading[\s\S]{0,300}Auto-formula only/.test(imp));

// ══════════════════════════════════════════════════════════════════
// PART R — REGRESSION GUARDS
// ══════════════════════════════════════════════════════════════════

ok('R1: 54 — header version pill uses amber bg #fef3c7 (preserved)',
  /background: '#fef3c7'/.test(page));
ok('R2: 53 — Business Entities section in SettingsTab preserved',
  /\['entities', '🏢 Business Entities'\]/.test(read('src/components/SettingsTab.jsx')));
ok('R3: 53 — Open Accounts entity picker still wired',
  /Our Entity for this Account \* \/ كياننا/.test(read('src/components/OpenAccountsTab.jsx')));
ok('R4: 53 — Print + Excel buttons still on account card',
  /🖨️ Print/.test(read('src/components/OpenAccountsTab.jsx')) &&
  /📊 Excel/.test(read('src/components/OpenAccountsTab.jsx')));
ok('R5: 52 — 5-type transaction picker (v55.83-A.6.27.72 replaces CREDIT/DEBIT radio)',
  /Sales Invoice/.test(read('src/components/OpenAccountsTab.jsx')) &&
  /Vendor Bill/.test(read('src/components/OpenAccountsTab.jsx')) &&
  /Payment Received/.test(read('src/components/OpenAccountsTab.jsx')) &&
  /Payment Sent/.test(read('src/components/OpenAccountsTab.jsx')));
ok('R6: 51 — InventoryOverview default export preserved',
  /export default function InventoryOverview/.test(ov));
ok('R7: 51 — Inventory tab default subtab = overview',
  /var \[subtab, setSubtab\] = useState\('overview'\)/.test(read('src/components/InventoryTab.jsx')));
ok('R8: 50 — Variant History modal anchored to top',
  /flex items-start justify-center pt-6 pb-6 px-4/.test(read('src/components/InventoryVariantHistory.jsx')));
ok('R9: 49 — Smart search includes design_sku + classText',
  /\(p\.design_sku \|\| ''\) \+ ' '/.test(rec) &&
  /classText\(p\)/.test(rec));
ok('R10: 49 — Quantity Received + UoM + Release # + Roll Count required labels',
  /Quantity Received \*\s/.test(rec) &&
  /Unit of Measure \*\s/.test(rec) &&
  /Release # \*\s/.test(rec) &&
  /Roll Count \*\s/.test(rec));
ok('R11: 48 — Inbound Shipments + Product List labels in InventoryTab',
  /label: '🚚 Inbound Shipments'/.test(read('src/components/InventoryTab.jsx')) &&
  /label: '🏷️ Product List'/.test(read('src/components/InventoryTab.jsx')));
ok('R12: 47 — Shipping Rates keyFor uses port_of_loading + effective_date',
  /var pol = normName\(r\.port_of_loading\) \|\| normName\(r\.origin\)/.test(read('src/components/ShippingRatesTab.jsx')));
ok('R13: 46 — Schema banner still in Product List',
  /Database migrations needed/.test(pm));
ok('R14: 45 — Egypt Bank owner deposit + apply rules RPC still wired',
  /const toggleOwnerDeposit = async \(txnId\)/.test(read('src/components/EgyptBankTab.jsx')) &&
  /supabase\.rpc\('apply_egypt_bank_rules', params\)/.test(read('src/components/EgyptBankTab.jsx')));
ok('R15: 44c — consume_invoice_item_inventory RPC still wired',
  /supabase\.rpc\('consume_invoice_item_inventory', \{ p_item_id: insertedItem\.id \}\)/.test(page));
ok('R16: closed-tickets fetch still has NO .limit(100)',
  !/\.eq\('status', 'Closed'\)[\s\S]{0,200}\.limit\(100\)/.test(page));
ok('R17: existing top-level tabs unchanged (treasury, egyptbank, bank, checks, debts all present)',
  /id: 'treasury'/.test(page) && /id: 'egyptbank'/.test(page) && /id: 'bank'/.test(page) &&
  /id: 'checks'/.test(page) && /id: 'debts'/.test(page));
ok('R18: Inbound Shipments modal width preserved (97vw / 1900 in .55, 99vw in .60)',
  /(width: '97vw', maxWidth: 1900|99vw)/.test(rec));
ok('R19: Shipment-LEVEL Expected Totals card preserved (only per-LINE removed)',
  /Shipment Expected Totals/.test(rec));

// ──────────────────────────────────────────────────────────────────
// Version stamp
// ──────────────────────────────────────────────────────────────────
ok('V1: version stamp v55.83-A.6.27.55 or later',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.55 (7-item multi-fix) tests passed');
