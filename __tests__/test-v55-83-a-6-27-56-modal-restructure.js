// v55.83-A.6.27.56 — Inbound Shipments modal GUI restructure.
//
// 3-region layout:
//   Region 1 (sticky top, flexShrink:0): Shipment Info form (collapsible) +
//     Shipment Expected Totals card (always visible)
//   Region 2 (scrollable middle, flex:1 overflow-auto): Product Lines + Add
//     button + Reconciliation Panel
//   Region 3 (sticky bottom): Cancel / Save Shell / Save Draft / Submit buttons
//
// Collapsibility:
//   - headerCollapsed state, default false (expanded)
//   - Click the SHIPMENT INFO bar to toggle
//   - When collapsed, shows shipment_reference inline so it's not lost
//   - Auto-collapses when adding a 2nd+ product line
//   - Always resets to expanded on openNew() and openEdit()

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
// PART A — State + handlers
// ══════════════════════════════════════════════════════════════════

ok('A1: headerCollapsed state declared, default false',
  /var \[headerCollapsed, setHeaderCollapsed\] = useState\(false\)/.test(rec));
ok('A2: comment explains collapsible header + auto-collapse + Save Draft trigger',
  /collapsible Shipment Info section[\s\S]{0,200}Default expanded/.test(rec));
ok('A3: openNew resets headerCollapsed to false (expanded by default)',
  /setLines\(\[emptyLine\(\)\]\);\s+setHeaderCollapsed\(false\);\s+\/\/ v55\.83-A\.6\.27\.56[\s\S]{0,80}setModalOpen\(true\);/.test(rec));
ok('A4: openEdit header-only branch resets headerCollapsed to false',
  /setLines\(\[emptyLine\(\)\]\);\s+setHeaderCollapsed\(false\);\s+setModalOpen\(true\);\s+setBusy\(false\);\s+return/.test(rec));
ok('A5: openEdit full-edit branch resets headerCollapsed to false',
  /setLines\(loadedLines\.length \? loadedLines : \[emptyLine\(\)\]\);\s+setHeaderCollapsed\(false\);\s+setModalOpen\(true\)/.test(rec));
ok('A6: addLine auto-collapses header when going from 1+ lines (focus on lines)',
  /if \(prev\.length >= 1\) \{\s+try \{ setHeaderCollapsed\(true\); \} catch \(_\) \{\}/.test(rec));

// ══════════════════════════════════════════════════════════════════
// PART B — Region 1: Sticky top (Shipment Info form, collapsible)
// ══════════════════════════════════════════════════════════════════

ok('B1: Region 1 outer wrapper uses flexShrink:0 + borderBottom (sticky top)',
  /<div style=\{\{ padding: '20px 20px 0 20px', flexShrink: 0, borderBottom: '1px solid #e2e8f0' \}\}>/.test(rec));
ok('B2: Comment marks the 3-region layout explanation',
  /3-region modal layout/.test(rec) &&
  /Region 1[\s\S]{0,100}non-scrolling top/.test(rec) &&
  /Region 2[\s\S]{0,100}scrollable middle/.test(rec));
ok('B3: Shipment Info has clickable collapse toggle button',
  /onClick=\{function \(\) \{ setHeaderCollapsed\(!headerCollapsed\); \}\}/.test(rec) &&
  /SHIPMENT INFO/.test(rec));
ok('B4: chevron ▶ shown when collapsed, ▼ when expanded',
  /\{headerCollapsed \? '▶' : '▼'\} SHIPMENT INFO/.test(rec));
ok('B5: when collapsed, shipment_reference is shown inline as preview',
  /\{headerCollapsed && header\.shipment_reference && \(\s+<span className="ml-2 font-mono font-bold text-indigo-700">\{header\.shipment_reference\}<\/span>/.test(rec));
ok('B6: collapse/expand text label switches based on state',
  /\{headerCollapsed \? 'expand' : 'collapse'\}/.test(rec));
ok('B7: Shipment Info form content only renders when !headerCollapsed',
  /\{!headerCollapsed && \(\s+<div className="px-3 pb-3">/.test(rec));
ok('B8: Shipment Expected Totals card stays OUTSIDE the collapsible (always visible)',
  /v55\.83-A\.6\.27\.56 — NOT collapsible \(small and important; stays visible\)/.test(rec));

// ══════════════════════════════════════════════════════════════════
// PART C — Region 2: Scrollable middle (Product Lines)
// ══════════════════════════════════════════════════════════════════

ok('C1: Region 2 has flex:1 + overflowY:auto + minHeight:0 (so flex shrinking works)',
  /<div style=\{\{ padding: '12px 20px', flex: 1, overflowY: 'auto', minHeight: 0 \}\}>/.test(rec));
ok('C2: Region 2 comment explains why only product lines scroll',
  /Region 2: scrollable middle/.test(rec) &&
  /only product lines scroll/i.test(rec));
ok('C3: PRODUCT LINES header is inside Region 2 (not Region 1)',
  /<div style=\{\{ padding: '12px 20px', flex: 1, overflowY: 'auto', minHeight: 0 \}\}>\s+\{\/\* Lines \*\/\}\s+<div className="text-\[11px\] font-extrabold text-slate-700 tracking-wider mb-2">PRODUCT LINES/.test(rec));

// ══════════════════════════════════════════════════════════════════
// PART D — Region 3: Sticky bottom (unchanged but verify preserved)
// ══════════════════════════════════════════════════════════════════

ok('D1: Footer with Cancel/Save Shell/Save Draft/Submit still in place',
  /<div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 rounded-b-2xl flex-wrap"[\s\S]{0,200}<button onClick=\{closeModal\}/.test(rec));
ok('D2: Cancel button preserved',
  /<button onClick=\{closeModal\} disabled=\{busy\} className="px-4 py-2 bg-slate-300/.test(rec));
ok('D3: Save Shell button preserved',
  /onClick=\{saveShipmentHeaderOnly\}/.test(rec) &&
  /📋 Save Shell Only/.test(rec));
ok('D4: Save Draft button preserved',
  /💾 Save Draft/.test(rec) && /onClick=\{function \(\) \{ saveReceipt\(\); \}\}/.test(rec));
ok('D5: Submit button preserved',
  /onClick=\{submitReceipt\}/.test(rec) && /✓ Submit/.test(rec));

// ══════════════════════════════════════════════════════════════════
// PART E — Modal outer structure (still flex column for 3 regions to stack)
// ══════════════════════════════════════════════════════════════════

ok('E1: Modal outer div still flex column (so 3 regions stack vertically)',
  /display: 'flex', flexDirection: 'column'/.test(rec));
ok('E2: Modal max width set (1900px in .56, none in .60)',
  /maxWidth: (1900|'none')/.test(rec));
ok('E3: Modal max height set (96vh in .56, calc(100vh - 12px) in .60)',
  /maxHeight: ('96vh'|'calc\(100vh - 12px\)')/.test(rec));

// ══════════════════════════════════════════════════════════════════
// PART R — REGRESSION GUARDS
// ══════════════════════════════════════════════════════════════════

ok('R1: 55 — openaccounts still in FINANCE sidebar',
  /\{ group: 'FINANCE', items: \['sales', 'treasury', 'checks', 'debts', 'openaccounts'/.test(page));
ok('R2: 60 — deleteProduct permissive fallback when can_delete_product RPC unavailable',
  /can_delete_product unavailable, proceeding permissive/.test(read('src/components/InventoryProductMaster.jsx')));
ok('R3: 55 — typeFilter default = variants (restored per HOTFIX 12)',
  /useState\('variants'\)/.test(read('src/components/InventoryProductMaster.jsx')));
ok('R4: 55 — TEMPLATE rename preserved (not FAMILY)',
  /TEMPLATE</.test(read('src/components/InventoryProductMaster.jsx')) &&
  !/>FAMILY</.test(read('src/components/InventoryProductMaster.jsx')));
ok('R5: 55 — showTemplates state in InventoryOverview',
  /var \[showTemplates, setShowTemplates\] = useState\(false\)/.test(read('src/components/InventoryOverview.jsx')));
ok('R6: 55 — per-line PHASE 1 EXPECTED TOTALS still GONE',
  !/PHASE 1 — EXPECTED TOTALS \(from supplier invoice/.test(rec));
ok('R7: 55 — picker hover bg-indigo-100 preserved',
  /hover:bg-indigo-100 active:bg-indigo-200/.test(rec));
ok('R8: 55 — TEXTJOIN formula in Excel template preserved',
  /f: 'TEXTJOIN\("-",TRUE,E' \+ rowNum \+ ':M' \+ rowNum \+ '\)'/.test(read('src/components/InventoryImportProducts.jsx')));
ok('R9: 54 — header version pill amber bg preserved',
  /background: '#fef3c7'/.test(page));
ok('R10: 53 — Business Entities + Open Accounts entity picker preserved',
  /Our Entity for this Account \* \/ كياننا/.test(read('src/components/OpenAccountsTab.jsx')));
ok('R11: 52 — Open Accounts tab registered',
  /\{ id: 'openaccounts', label: 'Open Accounts \/ حسابات', icon: '📒' \}/.test(page));
ok('R12: 51 — InventoryOverview default export preserved',
  /export default function InventoryOverview/.test(read('src/components/InventoryOverview.jsx')));
ok('R13: 49 — Smart search includes design_sku + classText',
  /\(p\.design_sku \|\| ''\) \+ ' '/.test(rec) && /classText\(p\)/.test(rec));
ok('R14: 48 — Inbound Shipments + Product List labels preserved',
  /label: '🚚 Inbound Shipments'/.test(read('src/components/InventoryTab.jsx')) &&
  /label: '🏷️ Product List'/.test(read('src/components/InventoryTab.jsx')));
ok('R15: Shipment-LEVEL Expected Totals card preserved (📦 Shipment Expected Totals)',
  /📦 Shipment Expected Totals/.test(rec));
ok('R16: Add another product line button still present in scrollable region',
  /\+ Add another product line/.test(rec));
ok('R17: Quantity Received + UoM + Release # + Roll Count labels preserved (.49)',
  /Quantity Received \*\s/.test(rec) &&
  /Unit of Measure \*\s/.test(rec) &&
  /Release # \*\s/.test(rec) &&
  /Roll Count \*\s/.test(rec));
ok('R18: 44c — consume_invoice_item_inventory RPC still wired',
  /supabase\.rpc\('consume_invoice_item_inventory', \{ p_item_id: insertedItem\.id \}\)/.test(page));
ok('R19: closed-tickets fetch still has NO .limit(100)',
  !/\.eq\('status', 'Closed'\)[\s\S]{0,200}\.limit\(100\)/.test(page));

// ──────────────────────────────────────────────────────────────────
// Version stamp
// ──────────────────────────────────────────────────────────────────
ok('V1: version stamp v55.83-A.6.27.56 or later',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.56 (modal GUI restructure) tests passed');
