// ============================================================
// v55.55 — Monthly Sales Report click-to-drill regression
//
// Bug fixed: clicking a month in the Monthly Sales Report on the
// dashboard did nothing. Now it navigates to the Sales tab with
// mode='custom' and df/dt set to the month's first/last day.
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
console.log('v55.55 — Monthly Sales Report click-to-drill');
console.log('============================================================\n');

var pdSrc = read('src/components/PersonalDashboard.jsx');
var pageSrc = read('src/app/page.jsx');

// ---------- A: navigate() now accepts opts with date range ----------
console.log('A. navigate() accepts opts={from,to}');
check('A.1 navigate signature has opts param',
  /const navigate = \(t, opts\) =>/.test(pageSrc));
check('A.2 navigate handles opts.from + opts.to',
  /if \(opts && opts\.from && opts\.to\)/.test(pageSrc));
check('A.3 navigate sets mode=custom when opts present',
  /setMode\('custom'\);[\s\S]{0,80}setDf\(opts\.from\);[\s\S]{0,80}setDt\(opts\.to\)/.test(pageSrc));

// ---------- B: PersonalDashboard month rows clickable ----------
console.log('\nB. Monthly Sales Report (dashboard) — month rows clickable');
check('B.1 onClick handler on month <tr>',
  /onClick=\{\(\) => navigate\('sales', \{ from: monthFrom, to: monthTo \}\)\}/.test(pdSrc));
check('B.2 cursor-pointer class on row',
  /<tr key=\{month\}[\s\S]{0,400}cursor-pointer/.test(pdSrc));
check('B.3 last-day-of-month calculation present (Date day 0 trick)',
  /new Date\(yr, mo, 0\)\.getDate\(\)/.test(pdSrc));
check('B.4 monthFrom built as YYYY-MM-01',
  /const monthFrom = month \+ '-01'/.test(pdSrc));
check('B.5 monthTo padded with leading zero',
  /String\(lastDay\)\.padStart\(2, '0'\)/.test(pdSrc));
check('B.6 visible drill-down hint "view orders"',
  /→ view orders/.test(pdSrc));
check('B.7 hover title shows count + month',
  /title=\{'Click to see all ' \+ data\.count \+ ' orders from ' \+ month\}/.test(pdSrc));

// ---------- C: Reports tab Monthly Sales — also clickable ----------
console.log('\nC. Reports tab Monthly Sales — also clickable');
check('C.1 second navigate call on month <tr> in Reports tab',
  /navigate\('sales', \{ from: monthFrom2, to: monthTo2 \}\)/.test(pageSrc));
check('C.2 cursor-pointer + hover-blue on Reports row',
  /<tr key=\{m\.month\}[\s\S]{0,300}cursor-pointer/.test(pageSrc));
check('C.3 Reports last-day calc',
  /new Date\(yr2, mo2, 0\)\.getDate\(\)/.test(pageSrc));

// ---------- D: Build stamp ----------
console.log('\nD. Build stamp current');
check('D.1 header pill v55.55+',
  />v55\.(5[5-9]|[6-9]\d)</.test(pageSrc));
var anyBuildLabel = pageSrc.match(/BUILD v55\.\d+-/g);
check('D.2 build modal stamp v55.55+',
  anyBuildLabel && anyBuildLabel.some(function(s) {
    var m = s.match(/v55\.(\d+)/);
    return m && parseInt(m[1], 10) >= 55;
  }));

// ---------- E: Earlier session fixes intact ----------
console.log('\nE. Earlier session fixes still intact (no regression)');
// v55.71+ moved MyPerformance from PersonalDashboard into AssistantsBar.
// SafeSection wrapping moved with it (was a regression — restored in v55.80).
check('E.1 SafeSection wraps MyPerformance (in AssistantsBar after v55.71 move)',
  /<SafeSection label="My Performance">[\s\S]{0,200}<MyPerformance/.test(read('src/components/AssistantsBar.jsx')));
check('E.2 v55.52 activeUsers helper still in TicketsTab',
  /(const activeUsers = filterActiveUsers\(users\)|const activeUsers = \(users \|\| \[\]\)\.filter\(u => u && u\.active !== false\))/.test(read('src/components/TicketsTab.jsx')));
check('E.3 v55.51 customs SQL file present',
  fs.existsSync(path.join(REPO, 'supabase/customs-phase-1.sql')));
check('E.4 v55.50 cancelEventRemindersBulk import',
  /cancelEventRemindersBulk/.test(read('src/components/CalendarTab.jsx')));

console.log('\n========================================');
console.log('PASSED: ' + passed);
console.log('FAILED: ' + failed);
console.log('========================================\n');
if (failed > 0) {
  console.log('FAILURES indicate the v55.55 monthly-drilldown has been regressed.\n');
  process.exit(1);
}
console.log('✓ All v55.55 monthly drill-down tests passed.\n');
