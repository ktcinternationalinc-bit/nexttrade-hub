// v55.83-A.6.27.25 — Save/Add button diagnostic logging + alert fallback
//
// Max reports the "+ Add" button does NOTHING after deploying Build 1
// (A.6.27.23). The button IS visible in the UI but clicking it produces
// no visible result. Most likely root causes:
//   (a) SQL migration not yet run → inventory_lists table doesn't exist
//       → dbInsert throws → caught silently as toast.error (which may
//       not be visible to Max for various reasons — dark theme, off-
//       screen, dismissing too fast)
//   (b) Validation failing silently because toast.error doesn't render
//   (c) Click handler not firing at all (rare but possible)
//
// This build:
//   1. Logs '[inv-master] Save/Add button CLICKED' the moment the button
//      is pressed — confirms whether the click handler runs at all
//   2. Logs every step of save() including validation inputs, branch
//      taken, dbInsert result, and reload/close
//   3. Calls alert() for validation failures so user sees them even if
//      toast doesn't render
//   4. Calls alert() in the catch block with a hint about likely root
//      cause (SQL migration not run, or RLS blocking)
//
// Result: when Max clicks Add and "nothing happens", we will instantly
// know whether it was a click-handler issue, validation, dbInsert error,
// or something else entirely. No more guessing.

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

// ── 1. Click-firing diagnostic ────────────────────────────────────
ok('1a: button onClick logs "Save/Add button CLICKED" to console',
  /console\.log\('\[inv-master\] Save\/Add button CLICKED'\)/.test(admin));
ok('1b: button onClick still calls save()',
  /console\.log\('\[inv-master\] Save\/Add button CLICKED'\);\s*save\(\);/.test(admin));

// ── 2. save() step-by-step logging ────────────────────────────────
ok('2a: save() logs entry with editing + activeLevel + form',
  /console\.log\('\[inv-master\] save\(\) called\. editing ='/.test(admin));
ok('2b: save() logs validation inputs',
  /console\.log\('\[inv-master\] validation inputs:/.test(admin));
ok('2c: save() logs validation pass before db call',
  /console\.log\('\[inv-master\] validation PASSED\. Saving to Supabase/.test(admin));
ok('2d: save() logs dbInsert success with savedId',
  /console\.log\('\[inv-master\] dbInsert SUCCESS\. savedId =', savedId\)/.test(admin));
ok('2e: save() logs dbUpdate success',
  /console\.log\('\[inv-master\] dbUpdate SUCCESS'\)/.test(admin));
ok('2f: save() logs parent-rule sync step',
  /console\.log\('\[inv-master\] syncing parent rules for level/.test(admin));
ok('2g: save() logs reload step',
  /console\.log\('\[inv-master\] reload \+ close modal'\)/.test(admin));

// ── 3. Validation failure logging ─────────────────────────────────
ok('3a: console.warn on bad code',
  /console\.warn\('\[inv-master\] validation FAILED: code must be 1-4/.test(admin));
ok('3b: console.warn on missing English label',
  /console\.warn\('\[inv-master\] validation FAILED: English label empty'\)/.test(admin));
ok('3c: console.warn on missing Arabic label',
  /console\.warn\('\[inv-master\] validation FAILED: Arabic label empty'\)/.test(admin));
ok('3d: console.warn on duplicate code',
  /console\.warn\('\[inv-master\] validation FAILED: duplicate code'/.test(admin));

// ── 4. Visible alert() fallbacks for validation ───────────────────
ok('4a: alert on bad code shows what was entered',
  /alert\('Code must be 1-4 uppercase letters\/digits[\s\S]{0,150}You entered: "' \+ code/.test(admin));
ok('4b: alert on missing English label',
  /alert\('English Label is required\.'\)/.test(admin));
ok('4c: alert on missing Arabic label',
  /alert\('Arabic Label is required\.'\)/.test(admin));
ok('4d: alert on duplicate code',
  /alert\('Code "' \+ code \+ '" is already in use at this level\./.test(admin));

// ── 5. Catch-block diagnostics + hint ─────────────────────────────
ok('5a: catch block logs full error with console.error',
  /console\.error\('\[inv-master\] save FAILED with caught error:', err\)/.test(admin));
ok('5b: catch block shows alert with the error message',
  /alert\('Save failed: ' \+ msg \+ hint\)/.test(admin));
ok('5c: catch block detects "relation does not exist" → SQL-not-run hint',
  /Likely cause: the SQL migration was not run yet in Supabase\. Run the v55\.83-A\.6\.27\.22 migration first/.test(admin));
ok('5d: catch block detects RLS error → RLS hint',
  /Likely cause: Row Level Security policies on inventory_lists are blocking/.test(admin));

// ── 6. Save function logic still intact (no regression) ───────────
ok('6a: dbInsert call still present',
  /dbInsert\('inventory_lists',\s*\{[\s\S]{0,300}level: activeLevel/.test(admin));
ok('6b: dbUpdate call still present',
  /dbUpdate\('inventory_lists', editing/.test(admin));
ok('6c: parent-rule delete-then-insert pattern still present',
  /supabase\.from\('inventory_list_rules'\)\.delete\(\)\.eq\('child_list_id', savedId\)/.test(admin) &&
  /supabase\.from\('inventory_list_rules'\)\.insert\(ruleRows\)/.test(admin));
ok('6d: reload + cancelEdit still called after success',
  /await reload\(\);\s*cancelEdit\(\);/.test(admin));

// ── 7. Other A.6.27.24 fixes still in place ───────────────────────
ok('7a: modal overlay still present',
  /fixed inset-0 z-\[200\] bg-black\/70/.test(admin));
ok('7b: Esc handler still present',
  /Escape/.test(admin));

// ── 8. Regression guards on other Builds ──────────────────────────
ok('8a: Build 2 (InventoryProductMaster) still imported in InventoryTab',
  /import InventoryProductMaster from '\.\/InventoryProductMaster'/.test(read('src/components/InventoryTab.jsx')));
ok('8b: A.6.27.21 fixLinksBusy state still present',
  /fixLinksBusy/.test(page));

// ── 9. Version stamp ──────────────────────────────────────────────
ok('9a: version stamp v55.83-A.6.27.25',
  /BUILD v55\.83-A\.6\.27\.25/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.25 save-button-diagnostic tests passed');
