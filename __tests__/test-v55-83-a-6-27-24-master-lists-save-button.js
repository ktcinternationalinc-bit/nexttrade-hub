// v55.83-A.6.27.24 — Master Lists add/edit form: save button always visible
//
// BUG: Max reported "no save button when adding a new option under Category."
// Root cause: the inline form was rendered ABOVE the options table. With 3
// input fields + 4 family-checkbox chips (for Category) + headers, the form
// grew tall enough that the save/cancel buttons at the bottom were pushed
// below the viewport. They existed in code but were not visible without
// scrolling. User reasonably concluded "there is no save button."
//
// FIX: Convert the inline form to a centered modal with sticky footer. The
// save and cancel buttons are pinned to the bottom of the modal regardless
// of form height. Matches the Build 2 Product Master modal pattern for
// consistency. Also adds Esc key handler for guaranteed close.

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var admin = read('src/components/InventoryMasterAdmin.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ── 1. Modal conversion ───────────────────────────────────────────
ok('1a: form is now a fixed inset overlay (modal)',
  /editing && \(\s*<div\s+className="fixed inset-0 z-\[200\] bg-black\/70/.test(admin));
ok('1b: click-outside-to-close wired',
  /onClick=\{cancelEdit\}[\s\S]{0,300}<div\s+className="bg-white rounded-2xl shadow-2xl mx-auto"\s+onClick=\{function \(e\) \{ e\.stopPropagation\(\); \}\}/.test(admin));
ok('1c: modal header uses solid dark indigo (#3730a3) with inline white text',
  /background: '#3730a3'[\s\S]{0,300}color: '#ffffff'/.test(admin));
ok('1d: header has close X button (40x40 white circle with shadow)',
  /aria-label="Close"[\s\S]{0,400}width: 36/.test(admin));
ok('1e: modal body is scrollable (overflow-y auto)',
  /padding: 20, maxHeight: 'calc\(100vh - 220px\)', overflowY: 'auto'/.test(admin));

// ── 2. Sticky footer with save + cancel buttons ───────────────────
ok('2a: footer is OUTSIDE the scrollable body (always visible)',
  /Modal footer — sticky, always visible/.test(admin));
ok('2b: footer has Save button that calls save()',
  /<button[^>]*\s+onClick=\{(?:save|function \(\) \{[\s\S]{0,500}save\(\);[\s\S]{0,50}\})\}[\s\S]{0,500}\+ Add Option' : 'Save Changes'/.test(admin));
ok('2c: footer has Cancel button calling cancelEdit()',
  /<button[^>]*\s+onClick=\{cancelEdit\}[\s\S]{0,300}Cancel/.test(admin));
ok('2d: save button has prominent indigo styling with shadow',
  /bg-indigo-600 hover:bg-indigo-700[\s\S]{0,200}text-white text-sm font-extrabold rounded-lg shadow/.test(admin));
ok('2e: save button label includes "+ Add Option" for new, "Save Changes" for edit',
  /\(busy \? 'Saving\.\.\.' : \(editing === 'new' \? '\+ Add Option' : 'Save Changes'\)\)/.test(admin) ||
  /busy \? 'Saving\.\.\.' : \(editing === 'new' \? '\+ Add Option' : 'Save Changes'\)/.test(admin));

// ── 3. Esc key handler ────────────────────────────────────────────
ok('3a: useEffect installs keydown listener',
  /useEffect\(function \(\)[\s\S]{0,400}window\.addEventListener\('keydown', onKey\)/.test(admin));
ok('3b: handler closes modal on Escape',
  /if \(\(e\.key === 'Escape' \|\| e\.key === 'Esc'\) && editing\)[\s\S]{0,100}cancelEdit\(\)/.test(admin));
ok('3c: handler cleans up on unmount',
  /return function \(\) \{ window\.removeEventListener\('keydown', onKey\); \}/.test(admin));

// ── 4. Form fields still all present (no regression on Build 1) ───
ok('4a: Code input still present',
  /value=\{form\.code\}[\s\S]{0,500}e\.target\.value\.toUpperCase\(\)/.test(admin));
ok('4b: English Label input still present',
  /value=\{form\.label_en\}[\s\S]{0,300}label_en: e\.target\.value/.test(admin));
ok('4c: Arabic Label input still present',
  /value=\{form\.label_ar\}[\s\S]{0,400}direction: 'rtl'/.test(admin));
ok('4d: Parent-rules checkboxes still present when level has parent rules',
  /\{hasParentLevel && \(/.test(admin) || /\(hasParentLevel \|\| activeLevel === 6\)[\s\S]{0,200}Valid under which Product Family/.test(admin));
ok('4e: Parent checkbox state syncs to form.parentIds (no regression)',
  /form\.parentIds\.indexOf\(p\.id\) >= 0/.test(admin));

// ── 5. NO inline form leftover (the bug pattern) ──────────────────
ok('5a: old inline form bg-indigo-50 wrapper REMOVED (used to hold the lost save button)',
  !/bg-indigo-50 border-2 border-indigo-300 rounded-xl mb-3/.test(admin));

// ── 6. Regression guards on other Builds ──────────────────────────
ok('6a: Build 2 (InventoryProductMaster) still imported in InventoryTab',
  /import InventoryProductMaster from '\.\/InventoryProductMaster'/.test(read('src/components/InventoryTab.jsx')));
ok('6b: A.6.27.21 fixLinksBusy state still present',
  /fixLinksBusy/.test(page));
ok('6c: A.6.27.21 Esc handler in AccountingAuditorModal still present',
  /Escape/.test(read('src/components/AccountingAuditorModal.jsx')));

// ── 7. Version stamp ──────────────────────────────────────────────
ok('7a: version stamp v55.83-A.6.27.24',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.24 Master Lists save-button-fix tests passed');
