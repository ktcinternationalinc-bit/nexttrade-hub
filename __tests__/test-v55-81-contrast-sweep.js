// __tests__/test-v55-81-contrast-sweep.js
// =============================================================
// v55.81 Checkpoint 1 #6 — Contrast audit
//
// Max May 9 2026: full UI sweep for yellow-on-yellow / low
// contrast small-text combos. Continues the v55.75 Phase A4
// baseline (which fixed 164+ such combos) and pins the v55.81
// fixes so they don't regress.
//
// What this proves:
//   1) The five components fixed this round have the bumped
//      colors and v55.81 #6 marker comments where applicable.
//   2) No remaining offenders exist anywhere in src/components:
//        - no text-[8/9/10]px paired with text-slate-400
//        - no bg-amber-100 + text-amber-500/600/700 combos
//        - no bg-yellow-100/200 + text-yellow-500/600/700
//        - no small text (8/9px) in amber-500/600/700
// =============================================================

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var COMPONENTS = path.join(ROOT, 'src/components');
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

var failures = [];
function ok(name, cond) {
  if (cond) { console.log('  ✓', name); }
  else { failures.push(name); console.log('  ✗', name); }
}

console.log('Targeted v55.81 #6 fixes');

// PersonalDashboard pipeline empty-state hint
var pdash = read('src/components/PersonalDashboard.jsx');
ok('PersonalDashboard pipeline empty-hint uses slate-500 (not slate-400)',
  /text-\[10px\] text-slate-500"\>When customers are assigned/.test(pdash));
ok('PersonalDashboard has no text-[10px] text-slate-400 anywhere',
  !/text-\[10px\] text-slate-400/.test(pdash));

// HRReport scoring formula footnote
var hrreport = read('src/components/HRReport.jsx');
ok('HRReport scoring formula footnote uses slate-500 at 9px',
  /text-\[9px\] text-slate-500 mt-2 italic/.test(hrreport));
ok('HRReport has no text-[9px] text-slate-400',
  !/text-\[9px\] text-slate-400/.test(hrreport));

// AdminHRInbox status & severity colors
var adminhr = read('src/components/AdminHRInbox.jsx');
ok('AdminHRInbox under_review label uses amber-900 (was amber-700)',
  /under_review:[\s\S]{0,40}'bg-amber-100',[\s\S]{0,40}'text-amber-900'/.test(adminhr));
ok('AdminHRInbox investigating label uses amber-900',
  /investigating:[\s\S]{0,40}'bg-amber-100',[\s\S]{0,40}'text-amber-900'/.test(adminhr));
ok('AdminHRInbox medium severity uses amber-900',
  /medium:\s*'bg-amber-100 text-amber-900'/.test(adminhr));
ok('AdminHRInbox has the v55.81 #6 marker',
  adminhr.indexOf('v55.81 #6') !== -1 && adminhr.indexOf('amber-700 → amber-900') !== -1);
ok('AdminHRInbox has zero remaining bg-amber-100 + text-amber-700 combos',
  !/bg-amber-100[^"\']*text-amber-700/.test(adminhr) &&
  !/text-amber-700[^"\']*bg-amber-100/.test(adminhr));

// AdminTab pinned + sensitive-fields badges
var admin = read('src/components/AdminTab.jsx');
ok('AdminTab PINNED badge uses amber-900 + border (was amber-700, no border)',
  /text-\[9px\] bg-amber-100 text-amber-900 px-1\.5 py-0\.5 rounded font-bold border border-amber-200">📌 PINNED/.test(admin));
ok('AdminTab sensitive-fields warning uses amber-900 + border',
  /bg-amber-100 text-amber-900 text-\[9px\] font-bold border border-amber-200">⚠️ \{a\.sensitive_fields_changed/.test(admin));
ok('AdminTab has zero remaining bg-amber-100 + text-amber-700 combos',
  !/bg-amber-100[^"\']*text-amber-700/.test(admin) &&
  !/text-amber-700[^"\']*bg-amber-100/.test(admin));

// QuotesTab status badge palette
var quotes = read('src/components/QuotesTab.jsx');
ok('QuotesTab statusColor expired uses amber-900 + border',
  /expired:\s*'bg-amber-100 text-amber-900 border border-amber-200'/.test(quotes));
ok('QuotesTab statusColor sent bumped to blue-700 (was blue-600)',
  /sent:\s*'bg-blue-100 text-blue-700'/.test(quotes));
ok('QuotesTab statusColor rejected bumped to red-700 (was red-600)',
  /rejected:\s*'bg-red-100 text-red-700'/.test(quotes));
ok('QuotesTab has the v55.81 #6 marker',
  quotes.indexOf('v55.81 #6') !== -1);
ok('QuotesTab has zero remaining bg-amber-100 + text-amber-600 combos',
  !/bg-amber-100[^"\']*text-amber-600/.test(quotes));

// =============================================================
// Whole-codebase regression guard — every primary component file
// must be free of the four offender patterns. This is the test
// that catches NEW low-contrast combos sneaking back in.
// =============================================================
console.log('\nWhole-codebase regression guard');

var componentFiles = fs.readdirSync(COMPONENTS).filter(function (f) { return f.endsWith('.jsx'); });

var globalSmallSlate400 = 0;
var globalAmberLowContrast = 0;
var globalYellowLowContrast = 0;
var globalSmallAmber = 0;
var firstOffender = '';

componentFiles.forEach(function (f) {
  var src = fs.readFileSync(path.join(COMPONENTS, f), 'utf8');
  // v55.82-H — WhatsNewWidget's BUILD_HISTORY contains descriptive prose
  // that mentions historical className patterns (e.g. "removed bg-amber-100
  // + text-amber-700 combo"). These are documentation, not live JSX, so
  // skip them when sweeping for contrast bugs.
  if (f === 'WhatsNewWidget.jsx') return;
  src.split('\n').forEach(function (line, i) {
    if (/text-\[(8|9|10)px\][^"]*text-slate-400/.test(line) ||
        /text-slate-400[^"]*text-\[(8|9|10)px\]/.test(line)) {
      globalSmallSlate400++;
      if (!firstOffender) firstOffender = f + ':' + (i + 1) + ' (small + slate-400)';
    }
    if (/bg-amber-100[^"]*text-amber-(500|600|700)\b/.test(line) ||
        /text-amber-(500|600|700)[^"]*bg-amber-100\b/.test(line)) {
      globalAmberLowContrast++;
      if (!firstOffender) firstOffender = f + ':' + (i + 1) + ' (amber low-contrast)';
    }
    if (/bg-yellow-(100|200)[^"]*text-yellow-(500|600|700)\b/.test(line) ||
        /text-yellow-(500|600|700)[^"]*bg-yellow-(100|200)\b/.test(line)) {
      globalYellowLowContrast++;
      if (!firstOffender) firstOffender = f + ':' + (i + 1) + ' (yellow low-contrast)';
    }
    if (/text-\[(8|9)px\][^"]*text-amber-(500|600|700)\b/.test(line)) {
      globalSmallAmber++;
      if (!firstOffender) firstOffender = f + ':' + (i + 1) + ' (small amber)';
    }
  });
});

ok('Zero small-text (8/9/10px) + text-slate-400 combos remaining',
  globalSmallSlate400 === 0);
ok('Zero bg-amber-100 + text-amber-500/600/700 combos remaining',
  globalAmberLowContrast === 0);
ok('Zero bg-yellow-100/200 + text-yellow-500/600/700 combos remaining',
  globalYellowLowContrast === 0);
ok('Zero small-text (8/9px) in text-amber-500/600/700 remaining',
  globalSmallAmber === 0);
ok('Reports zero offenders — first-offender slot is empty',
  firstOffender === '');

console.log('\n' + (failures.length === 0 ? 'PASS' : 'FAIL') + ' — ' + (22 - failures.length) + '/22 assertions');
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach(function (f) { console.log('  - ' + f); });
  if (firstOffender) console.log('\nFirst offender found: ' + firstOffender);
  process.exit(1);
}
