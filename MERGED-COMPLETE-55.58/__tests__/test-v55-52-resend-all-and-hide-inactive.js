// ============================================================
// v55.52 — "Test all teammates" Resend feature + hide deactivated
// users from dropdowns
//
// What this guards against:
//   - The new bulk Resend POST mode disappearing
//   - The "Test all teammates" button vanishing from the panel
//   - Deactivated users sneaking back into TicketsTab / CRMTab /
//     CalendarTab / DailyLogTab / TranslationPanel dropdowns
//   - The full `users` list disappearing from name-resolution lookups
//     (we want deactivated users to still appear in HISTORICAL records)
//   - Build stamp drift
// ============================================================

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var REPO = path.resolve(__dirname, '..');
var read = function (rel) { return fs.readFileSync(path.join(REPO, rel), 'utf8'); };

var passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { console.log('✓ ' + label); passed++; }
  else { console.log('✗ ' + label); failed++; }
}

console.log('============================================================');
console.log('v55.52 — Resend bulk + hide deactivated users');
console.log('============================================================\n');

// ---------- A: API route — bulk send mode ----------
console.log('A. /api/notify/test POST supports { all: true } mode');
var routeSrc = read('src/app/api/notify/test/route.js');
check('A.1 POST handler accepts the `all` flag in body',
  /var sendAll = body && body\.all === true/.test(routeSrc));
check('A.2 bulk path has its own branch in POST',
  /v55\.52 — Bulk "test all teammates" path/.test(routeSrc));
check('A.3 bulk path queries active users with email addresses',
  /supabase\.from\('users'\)[\s\S]{0,200}\.or\('active\.is\.null,active\.eq\.true'\)/.test(routeSrc));
check('A.4 bulk path filters out blank emails defensively',
  /!!u\.email && String\(u\.email\)\.trim\(\) !== ''/.test(routeSrc));
check('A.5 bulk path sequentially loops with a small delay (no rate-limit blast)',
  /setTimeout\(r, 100\)/.test(routeSrc));
check('A.6 bulk path returns per-person results array',
  /results: results/.test(routeSrc) && /perResult\.ok = !!okAll/.test(routeSrc));
check('A.7 bulk path logs each send to notification_log',
  /supabase\.from\('notification_log'\)\.insert\([\s\S]{0,300}Bulk Resend test/.test(routeSrc));
check('A.8 single-recipient path still works (unchanged)',
  /single-recipient path \(unchanged\)/.test(routeSrc));

// ---------- B: EmailStatusPanel — UI ----------
console.log('\nB. EmailStatusPanel — bulk test button + results table');
var panelSrc = read('src/components/EmailStatusPanel.jsx');
check('B.1 bulkTesting state exists',
  /var \[bulkTesting, setBulkTesting\] = useState\(false\)/.test(panelSrc));
check('B.2 bulkResult state exists',
  /var \[bulkResult, setBulkResult\] = useState\(null\)/.test(panelSrc));
check('B.3 bulkConfirming gate state exists (prevents accidental mass-send)',
  /var \[bulkConfirming, setBulkConfirming\] = useState\(false\)/.test(panelSrc));
check('B.4 sendTestToAll handler defined',
  /var sendTestToAll = async function/.test(panelSrc));
check('B.5 sendTestToAll posts { all: true }',
  /JSON\.stringify\(\{ all: true, triggered_by_user_id:/.test(panelSrc));
check('B.6 "Test all teammates" button rendered',
  /Test all teammates/.test(panelSrc));
check('B.7 confirmation prompt before bulk send',
  /Send a real email to every active teammate\?/.test(panelSrc));
check('B.8 results table renders per-person rows',
  /bulkResult\.results\.map/.test(panelSrc) && /<table/.test(panelSrc));
check('B.9 each row shows ✅ Sent or ❌ failure reason',
  /✅ Sent/.test(panelSrc) && /❌/.test(panelSrc));

// ---------- C: Hide deactivated users — TicketsTab ----------
console.log('\nC. TicketsTab — activeUsers in dropdowns');
var ticketsSrc = read('src/components/TicketsTab.jsx');
check('C.1 activeUsers helper defined inside the component',
  /const activeUsers = \(users \|\| \[\]\)\.filter\(u => u && u\.active !== false\)/.test(ticketsSrc));
check('C.2 getUserName still reads from the FULL users list (so historical records still resolve names)',
  /const getUserName = \(id\) => \(users \|\| \[\]\)\.find\(u => u\.id === id\)\?\.name/.test(ticketsSrc));
check('C.3 reassign-inside-ticket uses activeUsers',
  /activeUsers\.filter\(u => !parseAssignees\(sel\)\.includes\(u\.id\)\)/.test(ticketsSrc));
check('C.4 owner / assigned filter dropdowns use activeUsers',
  (ticketsSrc.match(/activeUsers\.map\(u => <option key=\{u\.id\} value=\{u\.id\}>\{u\.name\}<\/option>\)/g) || []).length >= 3);
check('C.5 inline new-ticket Assign-To uses activeUsers',
  /activeUsers\.map\(u=><option key=\{u\.id\} value=\{u\.id\}>\{u\.name\}<\/option>\)/.test(ticketsSrc));
check('C.6 additional-assignees checkbox row uses activeUsers',
  /activeUsers\.filter\(u => u\.id !== f\.assignedTo\)/.test(ticketsSrc));
// Negative tests — none of the dropdown patterns should still iterate full users
check('C.7 NO remaining `(users || []).map(u => <option`',
  !/\(users \|\| \[\]\)\.map\(u => <option/.test(ticketsSrc));
check('C.8 NO remaining `(users||[]).map(u=><option`',
  !/\(users\|\|\[\]\)\.map\(u=><option/.test(ticketsSrc));

// ---------- D: Hide deactivated users — CRMTab ----------
console.log('\nD. CRMTab — activeUsers in dropdowns');
var crmSrc = read('src/components/CRMTab.jsx');
check('D.1 activeUsers helper defined',
  /const activeUsers = \(users \|\| \[\]\)\.filter\(u => u && u\.active !== false\)/.test(crmSrc));
check('D.2 NO remaining `(users || []).map(u => <option`',
  !/\(users \|\| \[\]\)\.map\(u => <option/.test(crmSrc));
check('D.3 NO remaining `(users||[]).map(u=><option`',
  !/\(users\|\|\[\]\)\.map\(u=><option/.test(crmSrc));

// ---------- E: Hide deactivated users — CalendarTab ----------
console.log('\nE. CalendarTab — activeUsers in dropdowns');
var calSrc = read('src/components/CalendarTab.jsx');
check('E.1 activeUsers helper defined',
  /const activeUsers = \(users \|\| \[\]\)\.filter\(u => u && u\.active !== false\)/.test(calSrc));
check('E.2 selectAllUsers picks active users only',
  /setSelectedUsers\(activeUsers\.map\(u => u\.id\)\)/.test(calSrc));
check('E.3 "All Team" highlight compared against activeUsers.length',
  /selectedUsers\.length === activeUsers\.length/.test(calSrc));
check('E.4 assignee picker buttons render activeUsers',
  /\{activeUsers\.map\(u => \(\s*<button key=\{u\.id\} onClick=\{\(\) => toggleUser\(u\.id\)\}/.test(calSrc));
// Existing v55.40-era filter is still there (super-admin user-switcher) and that one already filtered active
check('E.5 super-admin user-switcher still filters active (v55.40 fix preserved)',
  /users\.filter\(u => u\.id !== myId && u\.active !== false\)/.test(calSrc));

// ---------- F: Hide deactivated users — DailyLogTab ----------
console.log('\nF. DailyLogTab — only active users in team summary');
var dailySrc = read('src/components/DailyLogTab.jsx');
check('F.1 teamSummary filters to active users',
  /const activeUsers = users\.filter\(u => u && u\.active !== false\)/.test(dailySrc));
check('F.2 teamSummary maps activeUsers (not the full users array)',
  /return activeUsers\.map\(u => \{/.test(dailySrc));

// ---------- G: TranslationPanel ----------
console.log('\nG. TranslationPanel — only active users get language config');
var transSrc = read('src/components/TranslationPanel.jsx');
check('G.1 language access list filters to active users',
  /users\.filter\(u => u && u\.active !== false\)\.map\(u => \(/.test(transSrc));

// ---------- H: Build stamp + page wiring ----------
console.log('\nH. Build stamp current');
var pSrc = read('src/app/page.jsx');
check('H.1 header pill at v55.52 or later',
  />v55\.(5[2-9]|[6-9]\d)</.test(pSrc));
var anyBuildLabel = pSrc.match(/BUILD v55\.\d+-/g);
check('H.2 build modal stamp version is at least v55.52',
  anyBuildLabel && anyBuildLabel.some(function(s) {
    var m = s.match(/v55\.(\d+)/);
    return m && parseInt(m[1], 10) >= 52;
  }));

// ---------- I: Earlier session fixes still intact ----------
console.log('\nI. Earlier session fixes still intact (no regression)');
check('I.1 v55.51 Customs Phase 1 SQL still present',
  fs.existsSync(path.join(REPO, 'supabase/customs-phase-1.sql')));
check('I.2 v55.51 CustomsRateLibrary component still present',
  fs.existsSync(path.join(REPO, 'src/components/CustomsRateLibrary.jsx')));
check('I.3 v55.50 cancelEventRemindersBulk import still present',
  /cancelEventRemindersBulk/.test(read('src/components/CalendarTab.jsx')));
check('I.4 v55.49 form-modal hide gate still present',
  /\{showAddTreasury && !pendingTreasuryRecord && !duplicateConfirm && \(/.test(pSrc));
check('I.5 v55.46 EmailStatusPanel mounted on AdminTab',
  /<EmailStatusPanel/.test(read('src/components/AdminTab.jsx')));

console.log('\n========================================');
console.log('PASSED: ' + passed);
console.log('FAILED: ' + failed);
console.log('========================================\n');
if (failed > 0) {
  console.log('FAILURES indicate the v55.52 fixes have been regressed.\n');
  process.exit(1);
}
console.log('✓ All v55.52 tests passed.\n');
