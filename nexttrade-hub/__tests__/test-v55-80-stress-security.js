// __tests__/test-v55-80-stress-security.js
// =========================================
// QA Engineer 4: Security & Permissions Reviewer
//
// Looks at:
//   - Admin focus mode is UI-only — does the underlying data still
//     enforce the original permission model (filterActiveUsers + role)?
//   - HR Report data fetch is still gated by visibleUsers (which
//     filters to direct reports for non-super-admin)
//   - localStorage tampering — non-admin setting ktc.adminViewMode
//     can't escalate privilege (data layer enforces)
//   - Presence DB column reads — sessions are filtered by user_id
//     (no leak across users)
//   - AI HR review prompt now includes Presence — does it still
//     respect privacy when shared (no PII beyond what was already there)?
//   - Visibility-aware logout fires `event_type: 'logout'` —
//     does this race with active heartbeat?
//
// Run: node __tests__/test-v55-80-stress-security.js

var fs = require('fs');
var path = require('path');

var passed = 0;
var failed = 0;
function ok(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.error('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

function load(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }

console.log('\n=== QA Engineer 4: Security & Permissions Reviewer ===');

// ---- AdminTab focus mode is UI only — visibleUsers still gated by role ----
var admin = load('src/components/AdminTab.jsx');
ok('S1: visibleUsers still filtered by role (super_admin sees all, others see direct reports)',
   /isSuperAdmin\) return activeOnly[\s\S]{0,200}reports_to === myId \|\| u\.id === myId/.test(admin),
   'visibleUsers permission gate must still exist');
ok('S2: focus mode toggle does NOT bypass visibleUsers',
   /value=\{selUser\}[\s\S]+?visibleUsers\.map/.test(admin),
   'selUser dropdown options come from visibleUsers, not raw users');

// ---- HRReport data fetch ----
var hr = load('src/components/HRReport.jsx');
ok('S3: HRReport iterates visibleUsers (not all users) for metrics',
   /visibleUsers\.map\(u => \(\{[\s\S]{0,200}calcMetricsForUser/.test(hr));

// ---- localStorage tamper-resistance ----
// The ktc.adminViewMode key is read with try/catch — even if a user sets
// it to malicious JSON it shouldn't crash. AND viewMode 'me' just sets
// selUser=myId, which still goes through visibleUsers filter (so a non-admin
// already only sees themselves).
ok('S4: localStorage read wrapped in try/catch (resilient to corruption)',
   /try \{ return window\.localStorage\.getItem\('ktc\.adminViewMode'\) \|\| 'team'/.test(admin));
ok('S5: localStorage write wrapped in try/catch',
   /try \{ window\.localStorage\.setItem\('ktc\.adminViewMode'/.test(admin));

// ---- Presence: cross-user data isolation ----
var hrm = load('src/lib/hr-metrics.js');
ok('S6: presence sessions filtered by userId (no cross-user leak)',
   /userSessions\.filter\(function \(s\) \{[\s\S]{0,200}s\.user_id !== userId/.test(hrm),
   'presence calculation must reject sessions from other users');

// ---- AI HR review prompt — Presence inclusion is privacy-acceptable ----
var hrReview = load('src/app/api/hr-report/review/route.js');
ok('S7: AI review includes Presence sub-score (PHASE-B+ format)',
   /Presence \(15%\)/.test(hrReview));
ok('S8: AI review presence section uses metrics, not raw IDs/PII',
   /=== PRESENCE \(time on system\) ===[\s\S]+?Showed up on:[\s\S]+?Login frequency:/.test(hrReview));
ok('S9: AI review does NOT include user IP / user_agent / session_id',
   !/ip_address|user_agent|session_id/.test(hrReview),
   'review prompt should never include identifying network info');

// ---- Visibility-aware logout race conditions ----
var page = load('src/app/page.jsx');
// The hidden timer is cleared when tab becomes visible
ok('S10: visibility timer canceled when tab becomes visible',
   /visibilityState === 'visible'[\s\S]{0,200}clearTimeout\(hiddenTimer\); hiddenTimer = null/.test(page));
// Cleanup clears timer on unmount
ok('S11: cleanup clears hidden timer on unmount',
   /if \(hiddenTimer\) clearTimeout\(hiddenTimer\)/.test(page));
// Logout event posts to /api/login-event with type=logout, NOT to a privileged route
ok('S12: visibility logout posts to /api/login-event (existing public endpoint)',
   /\/api\/login-event[\s\S]{0,300}event_type.*'logout'.*tab_hidden_timeout/.test(page));

// ---- HR review uses metrics object, not raw DB query ----
ok('S13: AI review POST handler reads metrics from BODY (passed by client), not direct DB',
   /var metrics = body\.metrics/.test(hrReview),
   'metrics arrive sanitized through the React component, not direct DB-to-AI');

// ---- AdminTab section gating ----
ok('S14: AdminTab section nav respects super_admin vs admin',
   /isSuperAdmin/.test(admin) || /isAdmin/.test(admin),
   'must conditionally render sections based on role');

// ---- HR Report: self-view exclusion (privileged users see all except self?) ----
// v55.79 spec: super_admin sees all including self; privileged (view_hr_report)
// sees all EXCEPT self. Verify this is preserved.
ok('S15: HRReport visibleUsers logic considers role',
   /isSuperAdmin/.test(hr) || /super_admin/.test(hr));

// ---- ET helper does not write any data ----
var etCode = load('src/lib/et-time.js')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '');
ok('S16: et-time helper has no DB writes / fetch calls',
   !/supabase\.|fetch\(|axios\./.test(etCode),
   'pure formatting helper');
ok('S17: et-time helper has no localStorage / cookies access',
   !/localStorage|sessionStorage|document\.cookie/.test(etCode));

// ---- Presence metric does not leak login IP / user_agent ----
ok('S18: hr-metrics presence calc does not access user_agent / ip',
   !/user_agent|ip_address/.test(hrm.match(/PRESENCE[\s\S]{0,3000}/)?.[0] || ''));

// ---- Per-user scoping (no cross-user leak) ----
ok('S19: presence calc still scopes to user via validSessions filter',
   /validSessions = sessionsInPeriod\.filter/.test(hrm),
   'validSessions narrows from already-user-scoped sessionsInPeriod');

// ---- Email status panel does not log API key / FROM email externally ----
var email = load('src/components/EmailStatusPanel.jsx');
ok('S20: EmailStatusPanel does not log API key',
   !/process\.env\.RESEND_API_KEY/.test(email),
   'API key only handled server-side');

// ---- HRReport: presence data lookup does not bypass user_id filter ----
ok('S21: HRReport user_sessions fetch via supabase has no cross-user trickery',
   /supabase\.from\('user_sessions'\)\.select\([^)]+\)\.gte\('date'/.test(hr),
   'fetches all sessions in window, then per-user filtering happens in calcMetricsForUser');

// (This is by design: the view loads the WHOLE team's session data with one
// query, then the per-user calculation filters. Permission to see those rows
// is enforced via visibleUsers — non-admin can't construct a row for another
// user. RLS on user_sessions table is the ultimate gate.)

console.log('\n=== Security Results ===');
console.log('Passed: ' + passed + ' / ' + (passed + failed));
process.exit(failed > 0 ? 1 : 0);
