// __tests__/test-v55-81-admin-individual-view.js
// =================================================
// v55.81 — Admin Individual View + expanded login activity stats.
// Per Max May 9 2026 #7, #9, #10, #11, #12, #15:
//
//   #7  Team View vs Individual View — when an admin selects a person,
//       page focuses on them; team data hides
//   #8  Date display — "Today — Saturday, May 9, 2026 (ET)"
//   #9  Per-employee stats: Total logins, total logouts, total logged-in
//       time, avg session, active working time, last login, last logout
//   #10 Distinguish Average Session Time vs Active Working Time (separate)
//   #11 Distinguish manual logout vs auto-timeout
//   #12 Missed login tracking — "Logged in X out of expected Y days"
//   #15 Selected employee mismatch bug (already fixed in test-v55-81-reviewing-header-stale-bug.js)
//
// Run: node __tests__/test-v55-81-admin-individual-view.js

var fs = require('fs');
var path = require('path');

var src = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'AdminTab.jsx'), 'utf8');

var passed = 0;
var failed = 0;
function ok(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.error('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('\n=== Admin Individual View + login stats (v55.81) ===\n');

// =======================================================================
// #7 — Team View vs Individual View
// =======================================================================

// Scorecards filter: when individual focused, only show their card
ok('#7.1 Scorecards grid filters to focused user when one is selected',
   /focusId\s*=\s*\(selUser !== 'all'\) \? selUser : drillUser/.test(src));
ok('#7.2 Scorecards shows ONLY focused user when an individual is selected',
   /scorecards\.filter\(u => u\.id === focusId\)/.test(src));

// Team Login Summary stays hidden when individual is focused
ok('#7.3 Team Login Summary hidden when individual focused',
   /selUser === 'all' && \(\s*<div className="bg-white rounded-xl p-4 mb-3">\s*<h3 className="text-sm font-bold mb-3">👥 Team Login Summary/.test(src));

// =======================================================================
// #8 — Date display with explicit dates
// =======================================================================
ok('#8.1 Date label shows period name + explicit date format',
   /presetLabel = \(\{[\s\S]+?today: 'Today'[\s\S]+?yesterday: 'Yesterday'/.test(src));
ok('#8.2 Date label shows "Today — <fmtDay>" pattern',
   /labelSingle \+ ' — '/.test(src) && /fmtDay\(dateFrom\)/.test(src));
ok('#8.3 Range label uses arrow separator',
   /fmtDay\(dateFrom\) \+ ' → ' \+ fmtDay\(dateTo\)/.test(src));
ok('#8.4 Uses fmtET("longdate") for explicit dates',
   /fmtET\(iso, 'longdate'\)/.test(src));

// =======================================================================
// #9, #10, #11 — Expanded per-employee login stats
// =======================================================================

// 8 stat cards in the expanded individual view
ok('#9.1 Total Logins card', /Total Logins[\s\S]{0,200}totalLogins/.test(src));
ok('#9.2 Total Logged-In Time card',
   /Total Logged-In Time/.test(src) && /totalLoggedInMin/.test(src));
ok('#9.3 Active Working Time card (separate from logged-in time)',
   /Active Working Time/.test(src) && /totalActiveMin/.test(src));
ok('#9.4 Avg Session card', /Avg Session/.test(src) && /avgSessionMins/.test(src));
ok('#9.5 Manual Logouts card', /Manual Logouts[\s\S]{0,150}manualLogouts2/.test(src));
ok('#9.6 Auto Timeouts card', /Auto Timeouts[\s\S]{0,150}autoLogouts2/.test(src));
ok('#9.7 Last Login card', /Last Login/.test(src) && /lastLogin \?/.test(src));
ok('#9.8 Last Logout card', /Last Logout/.test(src) && /lastLogout \?/.test(src));

// #10 Active Working Time uses last_active anchor (the v55.80 column)
ok('#10.1 Active Working Time uses last_active anchor',
   /s\.last_active \|\| s\.last_seen/.test(src));

// #11 Manual vs auto-timeout distinguished
ok('#11.1 Manual logouts filter on logout_reason === "manual"',
   /logout_reason === 'manual'/.test(src));
ok('#11.2 Auto timeouts filter on logout_reason === "auto_timeout"',
   /logout_reason === 'auto_timeout'/.test(src));
ok('#11.3 AUTO TIMEOUT badge visible in session row',
   /AUTO TIMEOUT/.test(src));
ok('#11.4 CLOCKED OUT badge visible for manual logout',
   /CLOCKED OUT/.test(src));
ok('#11.5 ACTIVE badge for sessions still open',
   /ACTIVE/.test(src) && /animate-pulse/.test(src));

// =======================================================================
// #12 — Missed login tracking / consistency
// =======================================================================
ok('#12.1 Login Consistency card exists',
   /Login Consistency/.test(src));
ok('#12.2 Working week = any 6 of 7 days',
   /periodDays \* 6\) \/ 7/.test(src));
ok('#12.3 Shows "Logged in X / Y expected days"',
   /actualDays/.test(src) && /expectedDays/.test(src) && /expected work days/.test(src));
ok('#12.4 Consistency percentage shown',
   /consistency = expectedDays > 0 \? Math\.round\(\(actualDays \/ expectedDays\) \* 100\)/.test(src));
ok('#12.5 "Days Since Last Login" shown',
   /Days Since Last Login/.test(src));
ok('#12.6 Missed-days warning banner when actual < expected',
   /Missed \{expectedDays - actualDays\}/.test(src));
ok('#12.7 Tone changes by consistency (green/amber/red)',
   /consistency >= 100 \? 'text-emerald|consistency >= 80 \? 'text-amber/.test(src));

// =======================================================================
// #13 — Employee rankings
// =======================================================================
ok('#13.1 Rank-by selector exists',
   /\[rankBy, setRankBy\]/.test(src) && /Rank by:/.test(src));
ok('#13.2 Rank options include closedT, ratesCompleted, etc.',
   /value="closedT"/.test(src) && /value="ratesCompleted"/.test(src) && /value="quotesCompleted"/.test(src));
ok('#13.3 Lower-is-better metrics (overdue) inverted',
   /key === 'overdueCount' \|\| key === 'avgOverdueDays'/.test(src));
ok('#13.4 Top-3 medal badges (🥇 🥈 🥉)',
   /🥇 #1/.test(src) && /🥈 #2/.test(src) && /🥉 #3/.test(src));
ok('#13.5 Rank dropdown hidden when individual focused',
   /!\(\(selUser !== 'all'\) \|\| drillUser\)/.test(src));

// =======================================================================
// #14 — Period switching speed
// =======================================================================
ok('#14.1 loadData uses Promise.all for parallelization',
   /Promise\.all\(queries\)/.test(src));
ok('#14.2 Each query has independent .catch (one failure does not block others)',
   /\.catch\(function \(e\) \{ console\.warn\('logs:'/.test(src));
ok('#14.3 Refresh button shows "Loading…" state',
   /Loading…|⟳ Loading/.test(src));
ok('#14.4 Refresh button disabled while loading',
   /disabled=\{!loaded\}/.test(src));

// =======================================================================
// #15 — Selected employee mismatch (already in test-v55-81-reviewing-header)
// =======================================================================
ok('#15 Cross-reference: dropdown clears drillUser (Reviewing-header bug)',
   /setSelUser\(e\.target\.value\);\s*setDrillUser\(null\)/.test(src));

console.log('\n=== Results ===');
console.log('Passed: ' + passed + ' / ' + (passed + failed));
process.exit(failed > 0 ? 1 : 0);
