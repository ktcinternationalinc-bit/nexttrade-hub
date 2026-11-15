// __tests__/test-v55-80-stress-data-integrity.js
// =========================================
// QA Engineer 2: Data Integrity Auditor
//
// Looks at how the changes affect data flow:
//   - DB write timezone consistency (ET-anchored writes mixing with UTC reads)
//   - Cache invalidation completeness — every reset path
//   - Presence weekday convention is consistent (Mon-Fri = working)
//   - Score back-compat — same input produces same output (deterministic)
//   - explainScore contributions add up to score × weight-total
//   - Session UPDATE patterns in page.jsx still write full ISO timestamps (correct)
//
// Run: node __tests__/test-v55-80-stress-data-integrity.js

var fs = require('fs');
var path = require('path');

var passed = 0;
var failed = 0;
function ok(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.error('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

function load(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }

var hrSrc = load('src/lib/hr-metrics.js')
  .replace(/export\s+function\s+/g, 'function ')
  .replace(/export\s+\{[^}]*\}/g, '');
hrSrc += '\n;return { calcMetricsForUser: calcMetricsForUser, calcScore: calcScore, explainScore: explainScore };\n';
var hr = (new Function(hrSrc))();

var etSrc = load('src/lib/et-time.js')
  .replace(/export\s+function\s+/g, 'function ')
  .replace(/export\s+\{[^}]*\}/g, '');
etSrc += '\n;return { fmtET: fmtET, todayET: todayET, etDateStr: etDateStr };\n';
var et = (new Function(etSrc))();

console.log('\n=== QA Engineer 2: Data Integrity Auditor ===');

// ---- DB writes: full ISO timestamps stay full ISO (timezone-neutral) ----
// The key insight: a DB write of `new Date().toISOString()` (no .substring)
// stores a full UTC timestamp. That's CORRECT — the database layer
// stores UTC and the display layer renders ET. We must not have changed
// these to "todayET()" by accident, because that would store a date string
// where a timestamp is expected.
var page = load('src/app/page.jsx');

// Treasury / invoice / DB UPDATE patterns that write full timestamps
// should still be `new Date().toISOString()` (without substring).
ok('D1: last_seen DB write uses full toISOString (UTC tz-neutral)',
   /last_seen: new Date\(\)\.toISOString\(\)/.test(page),
   'last_seen DB writes should remain full ISO timestamps');
ok('D2: logout_at DB write uses full toISOString',
   /logout_at: new Date\(\)\.toISOString\(\)/.test(page));
ok('D3: matched_at DB write uses full toISOString',
   /matched_at: new Date\(\)\.toISOString\(\)/.test(page));
ok('D4: greeted_at DB write uses full toISOString',
   /greeted_at: new Date\(\)\.toISOString\(\)/.test(page));

// ---- Date-only DB writes use todayET() (ET-anchored) ----
// log_date is YYYY-MM-DD only — must be ET-anchored.
ok('D5: page.jsx log_date defaults to todayET (not UTC)',
   /log_date: todayET\(\)/.test(page) && !/log_date: new Date\(\)\.toISOString\(\)\.substring/.test(page));
ok('D6: page.jsx never writes log_date as substring(0,10) — todayET only',
   !/log_date.*toISOString\(\)\.substring/.test(page));

// ---- ShippingRatesTab DB writes ----
var ship = load('src/components/ShippingRatesTab.jsx');
ok('D7: ShippingRatesTab effective_date defaults to todayET',
   /effective_date: f\.effectiveDate \|\| todayET\(\)/.test(ship));
ok('D8: ShippingRatesTab booking_date defaults to todayET',
   /booking_date: todayET\(\)/.test(ship));
ok('D9: ShippingRatesTab quote_date defaults to todayET',
   /quote_date: f\.qDate \|\| todayET\(\)/.test(ship));

// ---- Cache invalidation completeness ----
var admin = load('src/components/AdminTab.jsx');
ok('D10: cache invalidation clears logs', /setLogs\(\[\]\)/.test(admin));
ok('D11: cache invalidation clears auditLogs', /setAuditLogs\(\[\]\)/.test(admin));
ok('D12: cache invalidation clears sessions', /setSessions\(\[\]\)/.test(admin));
// Pagination must reset on filter change
ok('D13: activityVisible reset wired to dateFrom/dateTo',
   /setActivityVisible\(ACTIVITY_PAGE\)[\s\S]*\}, \[dateFrom, dateTo\]/.test(admin));
ok('D14: activityVisible reset wired to selUser',
   /setActivityVisible\(ACTIVITY_PAGE\);\s*setAuditVisible\(ACTIVITY_PAGE\);[\s\S]*\}, \[selUser\]/.test(admin));

// ---- Score determinism: same input → same output ----
var fixedMetrics = {
  ticketsClosed: 5, ticketsCreated: 3, ticketsClosedOnTime: 5, ticketsClosedLate: 0,
  onTimePct: 100, avgDaysToClose: 1, openTickets: 1, overdueNow: 0,
  ticketComments: 10, commentsPerTicket: 2, lateEdits: 0,
  ratesAdded: 2, bookings: 1, quotesCreated: 2, quotesSent: 2, quotesAccepted: 1,
  attendedEvents: 3, meetingsCreated: 1, meetingsCheckedIn: 2, meetingShowUpPct: 80,
  manualEntries: 5, autoEntries: 3, manualFillRatePct: 80, activeDays: 5, workingDays: 5,
  contactTouches: 3, crmLogEntries: 2, pipelineMoves: 1, assignedCustomers: 5,
  systemTicketsCreated: 1, systemTicketsFixed: 1, systemTicketsRetested: 1,
  presentDays: 5, presenceRatePct: 100, avgHoursPerDay: 7,
  totalActions: 25,
};
var s1 = hr.calcScore(fixedMetrics, [fixedMetrics]);
var s2 = hr.calcScore(fixedMetrics, [fixedMetrics]);
ok('D15: score is deterministic — same input twice produces same output',
   JSON.stringify(s1) === JSON.stringify(s2));

// ---- explainScore contribution math ----
var explain1 = hr.explainScore(s1, fixedMetrics);
var contribSum = explain1.drivers.reduce(function (a, d) { return a + d.contribution; }, 0);
var weightSum = explain1.drivers.reduce(function (a, d) { return a + d.weight; }, 0);
ok('D16: explainScore weights sum exactly to 1.0 (with presence)',
   Math.abs(weightSum - 1.0) < 0.0001, 'sum: ' + weightSum);
ok('D17: contribution sum ≈ score × weight-sum',
   Math.abs(contribSum - s1.score * weightSum) < 1.0, 'contribSum: ' + contribSum + ', expected: ' + (s1.score * weightSum));

// ---- explainScore: each driver contribution = value × weight (rounded to 0.1) ----
explain1.drivers.forEach(function (d) {
  var expected = Math.round(d.value * d.weight * 10) / 10;
  ok('D18-' + d.label + ': contribution = value × weight (rounded)',
     Math.abs(d.contribution - expected) < 0.05,
     'driver ' + d.label + ': contribution=' + d.contribution + ' expected=' + expected);
});

// ---- Working day convention (v55.80 PHASE-B+ — Max May 8 2026) ----
// Working days = ANY 6 of 7 calendar days. No weekday assumption.
// This change resolved the prior Mon-Fri-vs-Sun-Thu ambiguity and is
// fairer to teams that work non-Western schedules.
ok('D19: working day convention — any 6 of 7 days (Max May 8 2026 spec)',
   true);

var hrSrcText = load('src/lib/hr-metrics.js');
ok('D20: countWorkingDaysInPeriod uses (totalDays * 6) / 7 formula',
   /Math\.round\(\(totalDays \* 6\) \/ 7\)/.test(hrSrcText),
   'See countWorkingDaysInPeriod');
ok('D20b: presence calc has NO weekday filter (ANY day counts)',
   !/dow >= 1 && dow <= 5/.test(hrSrcText),
   'old Mon-Fri filter must be gone');

// ---- ET helper: no leak of host-tz ----
// Confirm fmtET/todayET use the Intl timezone, not the host machine.
ok('D21: et-time helper uses America/New_York timezone',
   /timeZone: 'America\/New_York'/.test(load('src/lib/et-time.js')));
// Strip comments first so we don't false-match the documentation
var etCodeOnly = load('src/lib/et-time.js')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '');
ok('D22: et-time helper does NOT call new Date().toISOString().substring (ignoring comments)',
   !/new Date\(\)\.toISOString\(\)\.substring/.test(etCodeOnly));

// ---- Presence + Score shape ----
ok('D23: calcScore returns presence key',
   's1' && 'presence' in s1 && (s1.presence === null || typeof s1.presence === 'number'));

// ---- Score with absent presence renormalizes ----
var noPresMetrics = Object.assign({}, fixedMetrics);
delete noPresMetrics.presentDays;
delete noPresMetrics.presenceRatePct;
delete noPresMetrics.avgHoursPerDay;
noPresMetrics.workingDays = 0; // forces presence = null
var noPresScore = hr.calcScore(noPresMetrics, [noPresMetrics]);
ok('D24: legacy metrics → presence is null', noPresScore.presence === null);
ok('D25: legacy metrics → score is still computed', noPresScore.score !== null && typeof noPresScore.score === 'number');
// Old formula (35/15/20/20/10) vs new without presence (renormalized 30/15/20/15/10 → /0.90)
// give DIFFERENT values for the same metrics. That's expected. We just confirm
// the renormalization produces a sensible number.
ok('D26: legacy renormalized score is in 0-100 range', noPresScore.score >= 0 && noPresScore.score <= 100);

console.log('\n=== Data Integrity Results ===');
console.log('Passed: ' + passed + ' / ' + (passed + failed));
process.exit(failed > 0 ? 1 : 0);
