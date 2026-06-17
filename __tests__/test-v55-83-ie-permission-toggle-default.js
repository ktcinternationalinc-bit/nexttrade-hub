// ============================================================
// v55.83-IE — Settings permission toggle must use the SAME default as the display.
//
// P0 BUG (Max): clicking an OFF permission to turn it ON did nothing, so no
// permission could be granted. Cause: the grid displays TAB_PERMS default ON
// (?? true) and ACTION_PERMS default OFF (?? false), but togglePermission always
// used `?? true`. For an action permission with no saved row: display = OFF, but
// toggle computed current = true → newVal = false → re-saved OFF → no change.
//
// Fix: togglePermission derives the default from the key's list (TAB vs ACTION),
// so the first click flips it the way the user sees it.
//
// Part 1 = the toggle logic; Part 2 = source wiring.
// ============================================================

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// Model of the corrected toggle: default depends on whether the key is a tab perm.
function nextVal(stored, isTabPerm) {
  var def = isTabPerm ? true : false;
  var current = (stored === undefined || stored === null) ? def : stored;
  return !current;
}

// ---- 1. toggle logic ----
ok('1a: OFF action perm (no row) → first click turns it ON', nextVal(undefined, false) === true);
ok('1b: ON tab perm (no row) → first click turns it OFF', nextVal(undefined, true) === false);
ok('1c: explicitly-false action perm → click turns ON', nextVal(false, false) === true);
ok('1d: explicitly-true action perm → click turns OFF', nextVal(true, false) === false);
ok('1e (regression): the OLD always-?? true logic would have FAILED to turn on an OFF action perm',
  (function () { var oldCurrent = (undefined === undefined ? true : undefined); return (!oldCurrent) === false; })()); // old code → stays false

// ---- 2. source wiring ----
var src = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'SettingsTab.jsx'), 'utf8');
ok('2a: togglePermission derives default from TAB_PERMS membership',
  /const isTabPerm = TAB_PERMS\.some\(p => p\.key === module\)/.test(src) && /const current = permissions\[userId\]\?\.\[module\] \?\? def/.test(src));
ok('2b: old unconditional "?? true" in togglePermission is gone',
  src.indexOf('const current = permissions[userId]?.[module] ?? true;') === -1);
ok('2c: display still uses per-section defaults (tab ?? true, action ?? false)',
  /permissions\[u\.id\]\?\.\[p\.key\] \?\? true/.test(src) && /permissions\[u\.id\]\?\.\[p\.key\] \?\? false/.test(src));

console.log('');
if (failures.length === 0) {
  console.log('✅ All v55.83-IE permission-toggle-default tests passed');
  process.exit(0);
} else {
  console.log('❌ ' + failures.length + ' tests FAILED:');
  failures.forEach(function (f) { console.log('   - ' + f); });
  process.exit(1);
}
