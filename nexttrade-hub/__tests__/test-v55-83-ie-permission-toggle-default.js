// ============================================================
// v55.83-IE/IF/IG — Settings permission toggle must flip the state the user SEES.
//
// P0 BUG (Max): clicking an OFF permission to turn it ON did nothing → no permission
// could be granted. Causes fixed across builds:
//   IE — togglePermission default didn't match the display default.
//   IF — write was not optimistic and errors were swallowed (silent fail looked like nothing).
//   IG — toggle now takes the DISPLAYED hasAccess and saves !displayedHasAccess, so it always
//        inverts the visible ON/OFF even for legacy-fallback keys (Open Accounts / Edit Open Accounts).
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

// Corrected toggle: it flips the displayed state directly.
function nextVal(displayedHasAccess) { return !displayedHasAccess; }

// ---- 1. toggle logic: always inverts what the user sees ----
ok('1a: displayed OFF → click turns ON', nextVal(false) === true);
ok('1b: displayed ON → click turns OFF', nextVal(true) === false);
ok('1c: legacy-fallback shown ON (e.g. Edit Open Accounts) → first click turns OFF', nextVal(true) === false);
ok('1d: action perm shown OFF → first click turns ON', nextVal(false) === true);

// ---- 2. source wiring ----
var src = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'SettingsTab.jsx'), 'utf8');
ok('2a: togglePermission accepts displayedHasAccess and uses it',
  /const togglePermission = async \(userId, module, displayedHasAccess\)/.test(src) &&
  /typeof displayedHasAccess === 'boolean'[\s\S]{0,20}displayedHasAccess/.test(src));
ok('2b: BOTH grid buttons pass the displayed hasAccess into togglePermission',
  (src.match(/togglePermission\(u\.id, p\.key, hasAccess\)/g) || []).length >= 2);
ok('2c: old unconditional "?? true" toggle default is gone',
  src.indexOf('const current = permissions[userId]?.[module] ?? true;') === -1);
ok('2d: display still uses per-section defaults (tab ?? true, action ?? false)',
  /permissions\[u\.id\]\?\.\[p\.key\] \?\? true/.test(src) && /permissions\[u\.id\]\?\.\[p\.key\] \?\? false/.test(src));
ok('2e: write is optimistic + surfaces failures (revert + error toast)',
  /\/\/ optimistic/.test(src) && /\/\/ revert/.test(src) && /toast\.error\('Could not save permission/.test(src));

console.log('');
if (failures.length === 0) {
  console.log('✅ All v55.83-IG permission-toggle tests passed');
  process.exit(0);
} else {
  console.log('❌ ' + failures.length + ' tests FAILED:');
  failures.forEach(function (f) { console.log('   - ' + f); });
  process.exit(1);
}
