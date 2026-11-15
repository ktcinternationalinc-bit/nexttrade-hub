// v55.83-A.6.27.31 — WarehouseSettings: Add button fix
//
// Max reported "click Add Warehouse, nothing happens" while trying to
// set up warehouses for Build 4.0 receipts.
//
// Root cause (same as A.6.27.24 Master Lists save-button bug):
// the form rendered inline ABOVE the warehouse list, growing the page
// downward. The button "+ Add Warehouse" disappears (hidden by canEdit
// && !showAdd), the form appears in its place, but on tall pages where
// the user can't see both at once, it visually looks like nothing happened.
//
// Fix: convert the inline form to a centered modal with sticky footer.
// Always visible regardless of page length. Click outside / Esc to close.
// Plus diagnostic logging on the Add button + Save button + handleSave
// so any future failure produces visible feedback (alert popup + console).

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var wh = read('src/components/WarehouseSettings.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ── 1. Form converted to centered modal ───────────────────────────
ok('1a: form wrapper is a fixed-inset modal overlay',
  /showAdd && \(\s*<div\s+className="fixed inset-0 z-\[200\] bg-black\/70/.test(wh));
ok('1b: click-outside-to-close wired',
  /onClick=\{function \(\) \{ setShowAdd\(false\); setEditing\(null\); setForm\(\{\}\); \}\}[\s\S]{0,400}<div\s+className="bg-white rounded-2xl shadow-2xl mx-auto"\s+onClick=\{function \(e\) \{ e\.stopPropagation\(\); \}\}/.test(wh));
ok('1c: modal header uses solid dark indigo with inline white text (RULE 6 defensive)',
  /background: '#3730a3'[\s\S]{0,300}color: '#ffffff'/.test(wh));
ok('1d: modal has close X button',
  /aria-label="Close"[\s\S]{0,400}width: 36/.test(wh));
ok('1e: modal body is scrollable (maxHeight + overflowY auto)',
  /padding: 20, maxHeight: 'calc\(100vh - 220px\)', overflowY: 'auto'/.test(wh));
ok('1f: sticky footer with Cancel + Save buttons always visible',
  /\/\* Sticky footer \*\/[\s\S]{0,500}Add warehouse'\s*\}/.test(wh) ||
  /border-t border-slate-200 bg-slate-50 rounded-b-2xl[\s\S]{0,800}handleSave/.test(wh));

// ── 2. Old inline form pattern REMOVED ────────────────────────────
ok('2a: old inline bg-emerald-50 form wrapper is GONE',
  !/showAdd && \(\s*<div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-2">/.test(wh));

// ── 3. Diagnostic logging on Add button ───────────────────────────
ok('3a: + Add Warehouse button logs click',
  /\+ Add Warehouse button CLICKED — opening modal/.test(wh));

// ── 4. Diagnostic logging in handleSave ───────────────────────────
ok('4a: handleSave logs entry with editing + form',
  /console\.log\('\[warehouse\] handleSave called\. editing =', editing, ' form =', form\)/.test(wh));
ok('4b: handleSave logs payload before save',
  /console\.log\('\[warehouse\] payload =', payload\)/.test(wh));
ok('4c: handleSave logs SUCCESS for insert path',
  /console\.log\('\[warehouse\] insert SUCCESS'\)/.test(wh));
ok('4d: handleSave logs SUCCESS for update path',
  /console\.log\('\[warehouse\] update SUCCESS'\)/.test(wh));
ok('4e: handleSave catches errors with console.error + alert',
  /console\.error\('\[warehouse\] save FAILED:', err\)/.test(wh) &&
  /alert\('Save failed: ' \+ msg/.test(wh));

// ── 5. Validation feedback ────────────────────────────────────────
ok('5a: validation alert shown when name/code missing (not just toast)',
  /alert\('Name and Code are both required/.test(wh));
ok('5b: console.warn on validation failure',
  /console\.warn\('\[warehouse\] validation failed: name or code missing'\)/.test(wh));

// ── 6. Save button also logs click ────────────────────────────────
ok('6a: Save button (in modal footer) logs click before calling handleSave',
  /\[warehouse\] Save button CLICKED/.test(wh));

// ── 7. Esc key handler ────────────────────────────────────────────
ok('7a: useEffect installs Esc keydown listener',
  /useEffect\(function \(\)[\s\S]{0,300}window\.addEventListener\('keydown', onKey\)/.test(wh));
ok('7b: Esc handler closes modal on Escape',
  /if \(\(e\.key === 'Escape' \|\| e\.key === 'Esc'\) && showAdd\)/.test(wh));
ok('7c: Esc handler cleans up on unmount',
  /return function \(\) \{ window\.removeEventListener\('keydown', onKey\); \}/.test(wh));

// ── 8. Form fields preserved (no regression on existing functionality)
ok('8a: name input still present',
  /value=\{form\.name \|\| ''\}[\s\S]{0,200}name: e\.target\.value/.test(wh));
ok('8b: code input still present + uppercases',
  /value=\{form\.code \|\| ''\}[\s\S]{0,200}e\.target\.value\.toUpperCase\(\)/.test(wh));
ok('8c: country input still present',
  /value=\{form\.country \|\| ''\}/.test(wh));
ok('8d: default_currency dropdown with EGP/USD/EUR options',
  /value=\{form\.default_currency \|\| 'USD'\}[\s\S]{0,400}EGP — Egyptian Pound[\s\S]{0,200}USD — US Dollar[\s\S]{0,200}EUR — Euro/.test(wh));
ok('8e: is_active checkbox still present',
  /<input type="checkbox" checked=\{form\.is_active !== false\}/.test(wh));

// ── 9. Save logic regression guards ───────────────────────────────
ok('9a: dbInsert into inv_warehouses still called for new',
  /dbInsert\('inv_warehouses', payload, userProfile && userProfile\.id\)/.test(wh));
ok('9b: dbUpdate into inv_warehouses still called for edit',
  /dbUpdate\('inv_warehouses', editing\.id, payload, userProfile && userProfile\.id\)/.test(wh));
ok('9c: loadWarehouses() called after successful save (resets list)',
  /setShowAdd\(false\);\s+loadWarehouses\(\)/.test(wh));

// ── 10. Regression guards on prior builds ─────────────────────────
ok('R1: Build 4.0 (InventoryReceiving) still imported in InventoryTab',
  /import InventoryReceiving from '\.\/InventoryReceiving'/.test(read('src/components/InventoryTab.jsx')));
ok('R2: Build 4.5 (InventoryStockImport) still imported',
  /import InventoryStockImport from '\.\/InventoryStockImport'/.test(read('src/components/InventoryTab.jsx')));
ok('R3: A.6.27.28 closed-tickets fetch still has NO .limit(100)',
  !/\.eq\('status', 'Closed'\)[\s\S]{0,200}\.limit\(100\)/.test(page));
ok('R4: A.6.27.21 fixLinksBusy still in page.jsx',
  /fixLinksBusy/.test(page));

// ── 11. Version stamp ─────────────────────────────────────────────
ok('V1: version stamp v55.83-A.6.27.31',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.31 warehouse-modal-fix tests passed');
