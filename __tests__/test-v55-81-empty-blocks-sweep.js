// __tests__/test-v55-81-empty-blocks-sweep.js
//
// v55.81 #5 (Max May 9 2026) — Empty white blocks audit
// =====================================================
// Two surfaces showed empty/zero-redundant white blocks when the user had
// no data:
//   1. AssistantsBar Nadia panel: four "0" stat cards under the
//      "all caught up today" greeting line
//   2. MyPerformance DailyLogBar: "0 of 0 working days" with empty progress
//      bar when the period had no working days
//
// Both now branch on the empty case and render a friendly explainer panel
// instead of the zero-content. This test locks in those branches so a
// future refactor doesn't accidentally remove them.

var fs = require('fs');
var path = require('path');

var REPO = path.resolve(__dirname, '..');
var read = function (rel) { return fs.readFileSync(path.join(REPO, rel), 'utf8'); };

var passed = 0, failed = 0, failures = [];
function check(label, cond) {
  if (cond) { console.log('  ✓ ' + label); passed++; }
  else { console.log('  ✗ ' + label); failed++; failures.push(label); }
}
function group(title) { console.log('\n--- ' + title + ' ---'); }

console.log('============================================================');
console.log('v55.81 #5 — EMPTY WHITE BLOCKS SWEEP');
console.log('============================================================');

var ab = read('src/components/AssistantsBar.jsx');
var mp = read('src/components/MyPerformance.jsx');

// =========================================================================
// 1. AssistantsBar Nadia panel: all-zeros branch replaces the 4-card grid
// =========================================================================
group('1. Nadia panel: all-clear empty state replaces zero-stats grid');

check('1.1 Nadia panel branches on nadiaUrgentCount before rendering grid',
  /nadiaUrgentCount > 0 \?[\s\S]{0,200}<StatCard label="Need Ack"/.test(ab));

check('1.2 Empty-state panel exists with all-clear messaging',
  /Nothing needs action right now|all clear|all-clear/i.test(ab));

check('1.3 Empty-state panel uses emerald palette (positive signal, not amber/rose)',
  /border-emerald-200 bg-emerald-50[\s\S]{0,300}Nothing needs action/.test(ab));

check('1.4 Empty-state explains what will appear when there IS something to act on',
  /they'll show up here|will appear here|appear here as/i.test(ab));

check('1.5 The 4 StatCards still exist for the non-empty branch (regression: not deleted)',
  /<StatCard label="Need Ack"/.test(ab) &&
  /<StatCard label="Due Today"/.test(ab) &&
  /<StatCard label="Overdue"/.test(ab) &&
  /<StatCard label="Checks Due"/.test(ab));

check('1.6 Comment marks this as v55.81 #5 work',
  /v55\.81 #5/.test(ab));

// =========================================================================
// 2. MyPerformance DailyLogBar: zero-working-days branch
// =========================================================================
group('2. DailyLogBar: zero working days shows explainer, not 0/0 stat');

check('2.1 DailyLogBar early-returns when workingDays is falsy or zero',
  /function DailyLogBar[\s\S]{0,400}metrics\.workingDays === 0/.test(mp));

check('2.2 Empty-state panel uses slate (neutral, not alarm) tone',
  /workingDays === 0[\s\S]{0,500}bg-slate-50 rounded-lg[\s\S]{0,400}no working days in this period/.test(mp));

check('2.3 Empty-state explains what the bar tracks once there ARE working days',
  /once you have working days|Once you have working days|build credibility|streaks build/i.test(mp));

check('2.4 The non-empty render path still computes pct and renders the bar (regression check)',
  /metrics\.manualFillRatePct \|\| 0[\s\S]{0,800}h-2 bg-slate-200 rounded-full/.test(mp));

check('2.5 Comment marks this as v55.81 #5 work',
  /v55\.81 #5/.test(mp));

// =========================================================================
// 3. The previously-shipped activity-grid empty state is still in place
// =========================================================================
group('3. Regression: previously-shipped no-activity gate is still there');

check('3.1 MyPerformance still has the no-activity gate on the grid',
  // v55.82-V split this into Arabic + English branches with the T() helper.
  // Match either the literal English copy or the T('noActivity') lookup.
  /T\('noActivity'\)/.test(mp) || /any tickets, comments/.test(mp));

check('3.2 The gate sums every activity signal before deciding empty',
  // QA-9 (May 9 2026) renamed the local var anyActivity to a useMemo
  // called hasAnyActivity. Either name is acceptable as the canonical
  // gate — both list every activity field.
  /(anyActivity|hasAnyActivity)[\s\S]{0,500}ticketsClosed[\s\S]{0,500}ticketComments[\s\S]{0,500}contactTouches/.test(mp));

// =========================================================================
// Summary
// =========================================================================
console.log('\n============================================================');
console.log('SUMMARY: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  console.log('\nFAILURES:');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('============================================================');
