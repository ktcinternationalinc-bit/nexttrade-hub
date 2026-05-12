// __tests__/test-v55-81-empty-white-blocks.js
// =============================================================
// v55.81 Checkpoint 1 #5 — Empty white blocks audit
//
// Max May 9 2026: "customer touches, share operate, daily log
// stream show empty white sections."
//
// What this proves:
//   1) PersonalDashboard's "My Pipeline" card no longer renders
//      a row of seven zero-pills when an admin has zero customers.
//      It shows a clear empty-state message instead.
//   2) MyPerformance's activity grid no longer renders a wall of
//      "0" tiles when the user has literally no activity in the
//      selected period. It shows a single Sara empty-state card.
//   3) The empty-state and the activity grid use the SAME gate
//      (one is the inverse of the other) so they can't both render.
// =============================================================

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var pdash = fs.readFileSync(path.join(ROOT, 'src/components/PersonalDashboard.jsx'), 'utf8');
var mperf = fs.readFileSync(path.join(ROOT, 'src/components/MyPerformance.jsx'), 'utf8');

var failures = [];
function ok(name, cond) {
  if (cond) { console.log('  ✓', name); }
  else { failures.push(name); console.log('  ✗', name); }
}

console.log('PersonalDashboard — Pipeline empty state');
ok('Pipeline card has the v55.81 #5 marker comment',
  /v55\.81\s*#5[\s\S]*Pipeline shown for admins even with 0/.test(pdash));
ok('Pipeline card branches on myCustomers.length === 0',
  /myCustomers\.length\s*===\s*0\s*\?/.test(pdash));
ok('Pipeline empty state copy mentions "No clients assigned"',
  /No clients assigned to you yet/.test(pdash));
ok('Pipeline empty state explains what the section is (Lead → Won)',
  /Lead\s*→\s*Qualified\s*→\s*Proposal\s*→\s*Won/.test(pdash));
ok('Pipeline pills only render when myCustomers.length > 0',
  /myCustomers\.length\s*===\s*0\s*\?[\s\S]*?:\s*\(\s*<div className="flex gap-1\.5 flex-wrap mb-2">/.test(pdash));

console.log('\nMyPerformance — empty activity state');
ok('MyPerformance has the v55.81 #5 marker comment',
  mperf.indexOf('v55.81 #5') !== -1 && mperf.indexOf('wall') !== -1 && mperf.indexOf('of zero tiles') !== -1);
ok('hasAnyActivity useMemo defined (QA-9 refactor)',
  /const hasAnyActivity = useMemo/.test(mperf));
ok('Empty-state branch uses !hasAnyActivity',
  /!loading && current && !hasAnyActivity/.test(mperf));
ok('Activity grid branch uses hasAnyActivity (positive)',
  /!loading && current && hasAnyActivity && \(/.test(mperf));
ok('Empty state copy says "No activity in <period>"',
  /No activity in\s*\{periodLabel\}/.test(mperf));
ok('Empty state copy mentions tickets / comments / customer touches',
  /tickets, comments, daily log entries, customer touches/.test(mperf));
ok('hasAnyActivity sums all 16 activity signals',
  (function () {
    var fields = ['ticketsClosed','ticketsCreated','ticketComments','manualEntries',
                  'autoEntries','ratesAdded','bookings','quotesCreated',
                  'contactTouches','pipelineMoves','assignedEvents','attendedEvents',
                  'meetingsCreated','meetingsCheckedIn',
                  'systemTicketsCreated','systemTicketsRetested'];
    return fields.every(function (f) { return mperf.indexOf('current.' + f + ' || 0') !== -1; });
  })());
ok('Wins highlights still inside the activity-grid branch',
  /hasAnyActivity && \([\s\S]{0,600}<Wins/.test(mperf));
ok('Daily Log Bar still inside the activity-grid branch',
  /hasAnyActivity && \([\s\S]*?<DailyLogBar/.test(mperf));
// v55.82-K — Personal Coach card MOVED OUT of hasAnyActivity branch
// (Max May 11 2026, 10th report of blank coach panel). Card now always
// renders while !loading so users with zero activity still get coach
// feedback. Verify the card is gated on !loading, not nested in the
// hasAnyActivity branch.
ok('Personal Coach card always renders while !loading (v55.82-K)',
  /\{!loading && \(\s*<div className="bg-gradient-to-r from-violet-50 to-pink-50/.test(mperf));
// Structure closes cleanly — the coach card is the LAST major block
// before the closing </div> + );. v55.82-R widened the body (wrapped
// feedback in a white card for contrast) so the window grew.
ok('Component closes cleanly (coach card → closing div → return)',
  /Personal Coach[\s\S]{0,4500}<\/div>\s*\)\}\s*<\/div>\s*\);\s*\}/.test(mperf));

console.log('\nMyHRDesk — empty state was already there (no regression)');
var mhr = fs.readFileSync(path.join(ROOT, 'src/components/MyHRDesk.jsx'), 'utf8');
ok('MyHRDesk still shows "No items filed yet" when fully empty',
  /No items filed yet/.test(mhr));
ok('MyHRDesk recent submissions list still gated on myRecent.length > 0',
  /myRecent\.length\s*>\s*0\s*&&/.test(mhr));

console.log('\n' + (failures.length === 0 ? 'PASS' : 'FAIL') + ' — ' + (16 - failures.length) + '/16 assertions');
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
