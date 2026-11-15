// __tests__/test-v55-80-admin-focus-and-pagination.js
// =========================================
// Static-source tests for v55.80 (Phase B):
//   - Section 3: Admin focus mode (Just me / Team toggle) wired + persisted
//   - Section 6: Activity feed + audit log paginated to 50/page
//   - "Reviewing X" header renders only when drilled
//   - Cache-invalidation effect clears slices when filter changes
//
// We don't render React here — these are static checks against the
// component source. They confirm the hooks, JSX, and state names exist
// and are wired correctly. Pairs nicely with the Babel parse smoke test.
//
// Run: node __tests__/test-v55-80-admin-focus-and-pagination.js

var fs = require('fs');
var path = require('path');

var passed = 0;
var failed = 0;
function ok(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.error('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

function load(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }

console.log('\n=== v55.80 admin focus + pagination tests ===');

var admin = load('src/components/AdminTab.jsx');

// ---- Section 3: Focus mode ----
ok('focus: viewMode state declared', /const \[viewMode, setViewMode\]/.test(admin));
ok('focus: viewMode hydrates from localStorage', /localStorage\.getItem\('ktc\.adminViewMode'\)/.test(admin));
ok('focus: viewMode persists to localStorage', /localStorage\.setItem\('ktc\.adminViewMode'/.test(admin));
ok('focus: viewMode "team" default', /window\.localStorage\.getItem\('ktc\.adminViewMode'\) \|\| 'team'/.test(admin));
ok('focus: Just me button wired to setViewMode("me")', /setViewMode\('me'\)/.test(admin));
ok('focus: Team button wired to setViewMode("team")', /setViewMode\('team'\)/.test(admin));
ok('focus: viewMode "me" forces selUser = myId', /viewMode === 'me' && myId/.test(admin));
ok('focus: viewMode "team" restores selUser to all', /viewMode === 'team'\)\s*\{\s*if \(selUser !== 'all'\)/.test(admin));
ok('focus: "Reviewing" header rendered when drilled', /Reviewing:/.test(admin) && /Back to team view/.test(admin));
ok('focus: ET disclosure banner present', /All dates and times below are in U\.S\. Eastern Time/.test(admin));

// ---- Section 6: Pagination ----
ok('pagination: ACTIVITY_PAGE = 50', /const ACTIVITY_PAGE = 50;/.test(admin));
ok('pagination: activityVisible state', /\[activityVisible, setActivityVisible\]/.test(admin));
ok('pagination: auditVisible state', /\[auditVisible, setAuditVisible\]/.test(admin));
ok('pagination: filteredLogs sliced to activityVisible', /filteredLogs\.slice\(0, activityVisible\)/.test(admin));
ok('pagination: audit Filter slice', /auditFiltered\.slice\(0, auditVisible\)/.test(admin));
ok('pagination: Load 50 more button (activity)', /Load 50 more.*activityVisible/s.test(admin));
ok('pagination: Load 50 more button (audit)', /Load 50 more.*auditVisible/s.test(admin));
ok('pagination: visible counts reset on date change', /setActivityVisible\(ACTIVITY_PAGE\)[\s\S]*setAuditVisible\(ACTIVITY_PAGE\)[\s\S]*\}, \[dateFrom, dateTo\]/.test(admin));
ok('pagination: visible counts reset on selUser change', /setActivityVisible\(ACTIVITY_PAGE\)[\s\S]*setAuditVisible\(ACTIVITY_PAGE\)[\s\S]*\}, \[selUser\]/.test(admin));

// ---- Section 2: Cache invalidation ----
ok('cache: setLogs([]) on filter change', /if \(loaded\) \{[\s\S]*setLogs\(\[\]\)/.test(admin));
ok('cache: setAuditLogs([]) on filter change', /if \(loaded\) \{[\s\S]*setAuditLogs\(\[\]\)/.test(admin));
ok('cache: setSessions([]) on filter change', /if \(loaded\) \{[\s\S]*setSessions\(\[\]\)/.test(admin));

// ---- ET imports ----
ok('et: imports fmtET', /import \{[^}]*fmtET[^}]*\} from '\.\.\/lib\/et-time'/.test(admin));
ok('et: imports todayET', /import \{[^}]*todayET[^}]*\} from '\.\.\/lib\/et-time'/.test(admin));
ok('et: no toLocaleString remains in admin (except number toLocaleString)', !/(?<![Nn]umber\(.*?\.)toLocaleString\(\[/.test(admin));

console.log('\n=== Results ===');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
process.exit(failed > 0 ? 1 : 0);
