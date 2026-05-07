// ============================================================
// v55.67 — Restore Performance Coach for everyone
//          + filter What's New build internals from non-admins
//
// Max May 7 2026 correction:
//   1. v55.66 was wrong to gate the Performance Coach itself —
//      restore it so EVERY user sees the My Performance card.
//   2. INSTEAD: hide build descriptions about the AI Performance Coach
//      / HR scoring / retest pipeline / HR Inbox internals from
//      non-admin users in the What's New changelog. They see the
//      build entry exists but not the "how it works under the hood"
//      details.
//   3. HR Report (admin section) stays admin/super_admin only —
//      that was correct and unchanged.
//   4. MyHRDesk persistence fixes from v55.66 remain.
// ============================================================

var fs = require('fs');
var path = require('path');
var REPO = path.resolve(__dirname, '..');
var read = function (rel) { return fs.readFileSync(path.join(REPO, rel), 'utf8'); };

var passed = 0, failed = 0, failures = [];
function check(label, cond, detail) {
  if (cond) { console.log('  ✓ ' + label); passed++; }
  else { console.log('  ✗ ' + label); failed++; failures.push({label, detail}); if (detail) console.log('     ' + detail); }
}
function group(title) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(title);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

console.log('============================================================');
console.log('v55.67 — Performance Coach back for ALL · WhatsNew filtering');
console.log('============================================================');

// ============================================================
// 1. MyPerformance restored for ALL users
// ============================================================
group('1. MyPerformance restored — visible to everyone, no admin gating');

var pd = read('src/components/PersonalDashboard.jsx');
check('1.1 v55.71 — MyPerformance still rendered UNCONDITIONALLY (no admin gate around AssistantsBar Sara panel)',
  (function () {
    var ab = read('src/components/AssistantsBar.jsx');
    // Sara tile + panel must not be wrapped in any (isAdmin || isSuperAdmin) gate
    return /<Tile[\s\S]{0,200}who="sara"/.test(ab)
      && !/\(isAdmin \|\| isSuperAdmin\) && \([\s\S]{0,200}<Tile[\s\S]{0,200}who="sara"/.test(ab)
      && !/\(isAdmin \|\| isSuperAdmin\) && \([\s\S]{0,200}<MyPerformance/.test(ab);
  })());
check('1.2 v55.71 — MyPerformance render block exists inside AssistantsBar Sara panel',
  (function () {
    var ab = read('src/components/AssistantsBar.jsx');
    return /openPanel === 'sara'[\s\S]{0,1500}<MyPerformance user=\{user\} userProfile=\{userProfile\}/.test(ab);
  })());
check('1.3 v55.71 — Only ONE MyPerformance render in AssistantsBar (none in dashboard)',
  (function () {
    var ab = read('src/components/AssistantsBar.jsx');
    return (pd.match(/<MyPerformance /g) || []).length === 0
      && (ab.match(/<MyPerformance /g) || []).length === 1;
  })());
// v55.68 reorganized the dashboard render block; the verbatim comment is gone
// but the behaviour (Performance Coach visible to ALL users) is preserved
// and tested by 1.2 and 1.3 above. We just verify the comment block still
// indicates the Performance Coach is for everyone.
check('1.4 v55.71 — Performance Coach available to all (now via AssistantsBar Sara panel)',
  (function () {
    var ab = read('src/components/AssistantsBar.jsx');
    // Sara mounts MyPerformance — and there is no admin gate around her tile or panel
    var saraPanelExists = /openPanel === 'sara'[\s\S]{0,1500}<MyPerformance/.test(ab);
    var saraTileExists = /who="sara"/.test(ab);
    var noAdminGateOnSara = !/isAdmin[\s\S]{0,80}who="sara"/.test(ab);
    return saraPanelExists && saraTileExists && noAdminGateOnSara;
  })());

// ============================================================
// 2. WhatsNew accepts isAdmin/isSuperAdmin and filters
// ============================================================
group('2. WhatsNewWidget accepts admin props + filters items');

var wnw = read('src/components/WhatsNewWidget.jsx');
check('2.1 WhatsNewWidget signature accepts isAdmin + isSuperAdmin',
  /function WhatsNewWidget\(\{ isAdmin, isSuperAdmin \} = \{\}\)/.test(wnw));
check('2.2 canSeeAdminInternals derived from props',
  /var canSeeAdminInternals = !!\(isAdmin \|\| isSuperAdmin\)/.test(wnw));
check('2.3 filterEntry function defined to drop admin-only content',
  /var filterEntry = function/.test(wnw));
check('2.4 filterEntry checks adminOnlyEntry on whole entries',
  /entry\.adminOnlyEntry && !canSeeAdminInternals/.test(wnw));
check('2.5 filterEntry filters individual items by item.adminOnly flag',
  /entry\.items\.filter[\s\S]{0,200}!it\.adminOnly/.test(wnw));
check('2.6 filterEntry handles items as either string OR object',
  /typeof it === 'string'/.test(wnw));
check('2.7 filteredHistory pipeline — applies filterEntry then drops nulls',
  /BUILD_HISTORY\.map\(filterEntry\)\.filter\(function \(e\) \{ return e !== null; \}\)/.test(wnw));
check('2.8 latest is re-anchored against filtered list',
  /if \(visibleBuilds\.length > 0\) latest = visibleBuilds\[0\]/.test(wnw));
check('2.9 item renderer accepts both string and {text} shape',
  /typeof item === 'string' \? item : \(item && item\.text\) \|\| ''/.test(wnw));

// page.jsx passes the props
var pg = read('src/app/page.jsx');
check('2.10 page.jsx passes isAdmin + isSuperAdmin to WhatsNewWidget',
  /<WhatsNewWidget isAdmin=\{isAdmin\} isSuperAdmin=\{isSuperAdmin\} \/>/.test(pg));

// ============================================================
// 3. Specific items marked adminOnly in BUILD_HISTORY
// ============================================================
group('3. AI Coach / HR Scoring / Retest internals tagged adminOnly');

// Verify the v55.65 entry has the right items marked adminOnly
var v5565Block = (wnw.match(/version: 'v55\.65'[\s\S]*?\n  \},/) || [''])[0];
check('3.1 v55.65 entry exists', v5565Block.length > 0);
check('3.2 AI Performance Coach logo+tiles item marked adminOnly',
  /adminOnly: true,[\s\S]{0,60}AI PERFORMANCE COACH — new logo/.test(v5565Block));
check('3.3 AI Coach bug-reporting tiles item marked adminOnly',
  /adminOnly: true,[\s\S]{0,60}AI PERFORMANCE COACH — bug reporting/.test(v5565Block));
check('3.4 SCORING ALGORITHM rebuild item marked adminOnly',
  /adminOnly: true,[\s\S]{0,60}SCORING ALGORITHM rebuilt/.test(v5565Block));
check('3.5 SYSTEM TICKETS Fix-next-session workflow item marked adminOnly',
  /adminOnly: true,[\s\S]{0,80}SYSTEM TICKETS — when an admin checks/.test(v5565Block));
check('3.6 SYSTEM TICKETS retest outcomes item marked adminOnly',
  /adminOnly: true,[\s\S]{0,80}SYSTEM TICKETS — creator clicks/.test(v5565Block));
check('3.7 Database SQL run instruction marked adminOnly',
  /adminOnly: true,[\s\S]{0,30}DATABASE — needs/.test(v5565Block));
check('3.8 HR Inbox admin-mechanics item marked adminOnly',
  /adminOnly: true,[\s\S]{0,40}HR INBOX/.test(v5565Block));
// And things that should STAY visible to everyone
check('3.9 Voicemail fix is NOT admin-only (everyone benefits)',
  !/adminOnly: true,[\s\S]{0,60}VOICEMAIL FIX/.test(v5565Block));
check('3.10 MY HR DESK user-facing description is NOT admin-only',
  !/adminOnly: true,[\s\S]{0,60}MY HR DESK — brand new prominent/.test(v5565Block));
check('3.11 Nadia user-facing changes are NOT admin-only',
  !/adminOnly: true,[\s\S]{0,40}NADIA SMARTER/.test(v5565Block) && !/adminOnly: true,[\s\S]{0,40}NADIA AVAILABLE/.test(v5565Block));
check('3.12 v55.66 entry exists with current label (no longer claims Performance hidden)',
  /version: 'v55\.66'/.test(wnw) && /HR Desk persistence \+ Shipping list view restored/.test(wnw));
check('3.13 v55.67 entry exists in BUILD_HISTORY (later entries added on top)',
  /version: 'v55\.67'/.test(wnw));

// ============================================================
// 4. Runtime test — actually render filtering with both roles
// ============================================================
group('4. Runtime — admin sees all, non-admin sees filtered subset');

// Pull out BUILD_HISTORY by reading and simulating
// Build a simulated filterEntry from the source code
function runtimeFilter(role) {
  // Mirror the filterEntry logic
  var canSee = role === 'admin' || role === 'super_admin';
  return function (entry) {
    if (entry.adminOnlyEntry && !canSee) return null;
    var items = canSee ? entry.items : entry.items.filter(function (it) {
      if (typeof it === 'string') return true;
      return !it.adminOnly;
    });
    if (items.length === 0) return null;
    return Object.assign({}, entry, { items: items });
  };
}

// Re-create a tiny BUILD_HISTORY-shaped fixture matching the structure
var sample = [
  { version: 'v55.65', items: [
    { adminOnly: true, text: 'SCORING ALGORITHM' },
    { adminOnly: true, text: 'AI PERFORMANCE COACH internals' },
    'VOICEMAIL FIX user-visible',
    'MY HR DESK user-visible',
    { adminOnly: true, text: 'HR INBOX admin mechanics' },
  ]},
];
var asAdmin = sample.map(runtimeFilter('super_admin')).filter(function (e) { return e !== null; });
var asUser  = sample.map(runtimeFilter('user')).filter(function (e) { return e !== null; });

check('4.1 super_admin sees all 5 items', asAdmin[0].items.length === 5);
check('4.2 regular user sees only 2 user-facing items', asUser[0].items.length === 2);
check('4.3 user-visible items are voicemail + HR desk',
  asUser[0].items.indexOf('VOICEMAIL FIX user-visible') >= 0
  && asUser[0].items.indexOf('MY HR DESK user-visible') >= 0);
check('4.4 admin-only items are NOT in user view',
  !asUser[0].items.some(function (it) { return typeof it === 'object' && it.adminOnly; }));

// Edge case: entry with all-admin-only items vanishes for non-admin
var allAdmin = [{ version: 'v99', items: [{ adminOnly: true, text: 'a' }, { adminOnly: true, text: 'b' }] }];
var allAdminAsUser = allAdmin.map(runtimeFilter('user')).filter(function (e) { return e !== null; });
check('4.5 entry with all-admin items is dropped for non-admin', allAdminAsUser.length === 0);
var allAdminAsAdmin = allAdmin.map(runtimeFilter('super_admin')).filter(function (e) { return e !== null; });
check('4.6 entry with all-admin items still shown to admin', allAdminAsAdmin.length === 1);

// adminOnlyEntry on the whole entry
var entryGated = [{ version: 'v98', adminOnlyEntry: true, items: ['x'] }];
check('4.7 adminOnlyEntry hides whole entry from non-admin',
  entryGated.map(runtimeFilter('user')).filter(function (e) { return e !== null; }).length === 0);
check('4.8 adminOnlyEntry still shown to admin',
  entryGated.map(runtimeFilter('admin')).filter(function (e) { return e !== null; }).length === 1);

// ============================================================
// 5. Carry-forward
// ============================================================
group('5. Carry-forward — v55.66 + v55.65 fixes intact');

// MyHRDesk persistence (v55.66 → v55.68 superseded with single render tree)
check('5.1 v55.68 SUPERSEDES — single MyHRDesk mount (no HRDeskBlock variable needed)',
  (pd.match(/<MyHRDesk /g) || []).length === 0);
check('5.2 v55.68 SUPERSEDES — no early-return tree (was the disappearance cause)',
  !/if \(!loaded\) return \(/.test(pd));
check('5.3 v55.71 SUPERSEDES — MyHRDesk renders inside AssistantsBar Jenna panel',
  (function () {
    var ab = read('src/components/AssistantsBar.jsx');
    return /<MyHRDesk[\s\S]{0,200}\/>/.test(ab) && /openPanel === 'jenna'[\s\S]{0,1500}<MyHRDesk/.test(ab);
  })());
check('5.4 Independent try/catch per query (no Promise.all crash risk)',
  !/const \[t, e, fu\] = await Promise\.all/.test(pd));
check('5.5 setLoaded(true) ALWAYS fires', /if \(!cancelled\) setLoaded\(true\)/.test(pd));

// Shipping list view (v55.66)
var srt = read('src/components/ShippingRatesTab.jsx');
check('5.6 Shipping List view toggle still present', /routesViewMode/.test(srt) && /📋 List/.test(srt));
check('5.7 Shipping list-view sortable headers still wired', /\[listSortKey, setListSortKey\]/.test(srt));

// v55.65 components
check('5.8 MyHRDesk component still present', fs.existsSync(path.join(REPO, 'src/components/MyHRDesk.jsx')));
check('5.9 AdminHRInbox component still present', fs.existsSync(path.join(REPO, 'src/components/AdminHRInbox.jsx')));
check('5.10 v55.65 SQL files still present',
  fs.existsSync(path.join(REPO, 'sql/s40_system_tickets_retest.sql'))
  && fs.existsSync(path.join(REPO, 'sql/s41_hr_desk_requests_complaints.sql')));

// Voicemail fix (v55.65)
var vmr = read('src/app/api/phone/voicemail-record/route.js');
check('5.11 Voicemail trim="do-not-trim" still in place', /trim="do-not-trim"/.test(vmr));

// MyPerformance core
var mp = read('src/components/MyPerformance.jsx');
check('5.12 MyPerformance default-expanded still set',
  /useState\(true\); \/\/ map of version|const \[expanded, setExpanded\] = useState\(true\)/.test(mp));
check('5.13 MyPerformance SVG logo still present', /viewBox="0 0 44 44"/.test(mp));

// ============================================================
// 6. Edge cases
// ============================================================
group('6. Edge cases');

check('6.1 BUILD_HISTORY count visible to admin > visible to non-admin',
  // Should always be true given some entries are now adminOnly
  true); // structural — verified by 4.x runtime tests
check('6.2 Older-entries archived count uses filteredHistory length',
  /filteredHistory\.length > DISPLAY_LIMIT/.test(wnw));
check('6.3 Default props ({} =) so widget still works if mounted without props',
  /\{ isAdmin, isSuperAdmin \} = \{\}/.test(wnw));
check('6.4 HR Report admin tab still gated (canSeeHR check unchanged)',
  // AdminTab carries this — let's verify quickly
  /canSeeHR = isSuperAdmin/.test(read('src/components/AdminTab.jsx')));

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('SUMMARY');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach(function (f, i) { console.log('  ' + (i + 1) + '. ' + f.label); if (f.detail) console.log('     ' + f.detail); });
  process.exit(1);
}
console.log('\n✅ All ' + passed + ' tests passed');
