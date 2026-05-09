// __tests__/test-v55-81-reviewing-header-stale-bug.js
// =====================================================
// v55.81 — REGRESSION test for the bug Max caught with photo evidence
// on May 9 2026:
//
//   "Dropdown shows: Tamer (team)
//    Reviewing label says: Abdelrahman Hassan
//    Daily Login Archive correctly shows: Tamer"
//
// Root cause: AdminTab had two state vars (selUser + drillUser) and
// the "Reviewing X" header derived focusId from `drillUser || selUser`.
// The dropdown's onChange only set selUser — drillUser stayed pointing
// at whoever was last clicked on a scorecard, so the header showed the
// stale name while data filters (which use selUser directly) showed
// fresh data.
//
// Fix: dropdown onChange must clear drillUser. Header derives focusId
// with selUser-wins precedence: `(selUser !== 'all') ? selUser : drillUser`.
//
// Run: node __tests__/test-v55-81-reviewing-header-stale-bug.js

var fs = require('fs');
var path = require('path');

var src = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'AdminTab.jsx'), 'utf8');

var passed = 0;
var failed = 0;
function ok(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.error('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('\n=== Reviewing header stale-state bug regression test ===\n');

// 1. Dropdown onChange must clear drillUser
var dropdownMatch = src.match(/<select value=\{selUser\} onChange=\{e => \{[\s\S]+?\}\}[\s\S]+?\/select>/);
ok('Dropdown onChange exists', !!dropdownMatch);
if (dropdownMatch) {
  ok('Dropdown onChange calls setSelUser',
     /setSelUser\(e\.target\.value\)/.test(dropdownMatch[0]));
  ok('Dropdown onChange ALSO clears drillUser (the fix for Max\'s bug)',
     /setDrillUser\(null\)/.test(dropdownMatch[0]),
     'without this clear, drillUser stays stale and the Reviewing header shows the wrong name');
}

// 2. focusId resolution uses selUser-wins precedence (NOT drillUser-wins)
//    The fix is the line: `var focusId = (selUser !== 'all') ? selUser : drillUser;`
ok('focusId uses selUser-wins precedence (NOT drillUser-wins)',
   /var focusId = \(selUser !== 'all'\) \? selUser : drillUser/.test(src),
   'must match: var focusId = (selUser !== \'all\') ? selUser : drillUser');
ok('focusId no longer uses the buggy `drillUser || selUser` pattern',
   !/var focusId = drillUser \|\| selUser;/.test(src),
   'old pattern caused stale-display bug');

// 3. Scorecard click still updates BOTH atomically (so they stay in sync)
var scorecardMatch = src.match(/onClick=\{\(\) => \{[\s\S]+?const newDrill = drillUser === u\.id \? null : u\.id;[\s\S]+?\}\}/);
ok('Scorecard onClick atomically updates both selUser and drillUser', !!scorecardMatch);
if (scorecardMatch) {
  ok('Scorecard onClick sets drillUser', /setDrillUser\(newDrill\)/.test(scorecardMatch[0]));
  ok('Scorecard onClick sets selUser to keep dropdown in sync', /setSelUser\(newDrill \|\| 'all'\)/.test(scorecardMatch[0]));
}

// 4. The "Back to team view" button clears BOTH
var backBtnMatch = src.match(/Back to team view[\s\S]{0,200}|✕ Back[\s\S]{0,200}|setDrillUser\(null\); setSelUser\('all'\); setViewMode\('team'\)/);
ok('"Back to team view" button clears both states + viewMode',
   /setDrillUser\(null\);\s*setSelUser\('all'\);\s*setViewMode\('team'\)/.test(src));

// 5. CRITICAL: ensure the comment explaining the fix is in place so future
// devs don't undo it accidentally
ok('Fix is documented in source so it doesn\'t regress',
   /v55\.81 BUG FIX[\s\S]{0,100}drillUser/i.test(src) || /Max May 9 2026/.test(src));

console.log('\n=== Results ===');
console.log('Passed: ' + passed + ' / ' + (passed + failed));
process.exit(failed > 0 ? 1 : 0);
