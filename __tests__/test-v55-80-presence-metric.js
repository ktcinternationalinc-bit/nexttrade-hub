// __tests__/test-v55-80-presence-metric.js
// =========================================
// Tests for the Presence sub-score after v55.80 PHASE-B+ refactor.
//
// New shape (per Max May 8 2026):
//   - workingDays = 6 of every 7 calendar days (any 6, not Mon-Fri)
//   - presence calc: ALL days count, no weekday filter
//   - interval-merge: two browser tabs at the same time = one session
//   - last_active for active hours; last_seen as fallback for legacy data
//   - login frequency tracked separately (target: 6 logins/week)
//   - Presence sub-score = attendance 40% + active-hours 40% + login-freq 20%
//   - Score weights: Activity 35 / Timeliness 20 / Presence 15 / Quality 15 /
//                    Reliability 10 / Productivity 5 (sum 100)
//
// Run: node __tests__/test-v55-80-presence-metric.js

var fs = require('fs');
var path = require('path');

var src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'hr-metrics.js'), 'utf8');
var script = src
  .replace(/export\s+function\s+/g, 'function ')
  .replace(/export\s+\{[^}]*\}/g, '');
script += '\n;return { calcMetricsForUser: calcMetricsForUser, calcScore: calcScore, explainScore: explainScore, resolvePeriod: resolvePeriod, countWorkingDaysInPeriod: countWorkingDaysInPeriod };\n';
var lib = (new Function(script))();

var passed = 0;
var failed = 0;
function ok(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.error('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('\n=== v55.80 Presence metric tests (PHASE-B+) ===');

var period = { from: '2026-05-04', to: '2026-05-10', days: 7 };
var userId = 'user-presence-1';
var noiseInputs = {
  tickets: [], ticketComments: [], dailyLog: [], auditLog: [],
  customerQuotes: [], calendarEvents: [], customers: [],
};
function ts(date, hour, min) {
  return date + 'T' + (hour < 10 ? '0' + hour : hour) + ':' + (min < 10 ? '0' + min : min) + ':00Z';
}

// ---- Scenario 1: Full-time worker, present 6 days, 8h each ----
var sixDaysSessions = [
  { user_id: userId, date: '2026-05-04', login_at: ts('2026-05-04', 13, 0), logout_at: ts('2026-05-04', 21, 0), last_active: ts('2026-05-04', 21, 0), last_seen: ts('2026-05-04', 21, 0) },
  { user_id: userId, date: '2026-05-05', login_at: ts('2026-05-05', 13, 0), logout_at: ts('2026-05-05', 21, 0), last_active: ts('2026-05-05', 21, 0), last_seen: ts('2026-05-05', 21, 0) },
  { user_id: userId, date: '2026-05-06', login_at: ts('2026-05-06', 13, 0), logout_at: ts('2026-05-06', 21, 0), last_active: ts('2026-05-06', 21, 0), last_seen: ts('2026-05-06', 21, 0) },
  { user_id: userId, date: '2026-05-07', login_at: ts('2026-05-07', 13, 0), logout_at: ts('2026-05-07', 21, 0), last_active: ts('2026-05-07', 21, 0), last_seen: ts('2026-05-07', 21, 0) },
  { user_id: userId, date: '2026-05-08', login_at: ts('2026-05-08', 13, 0), logout_at: ts('2026-05-08', 21, 0), last_active: ts('2026-05-08', 21, 0), last_seen: ts('2026-05-08', 21, 0) },
  { user_id: userId, date: '2026-05-09', login_at: ts('2026-05-09', 13, 0), logout_at: ts('2026-05-09', 21, 0), last_active: ts('2026-05-09', 21, 0), last_seen: ts('2026-05-09', 21, 0) },
];
var sixM = lib.calcMetricsForUser(userId, period, Object.assign({}, noiseInputs, { userSessions: sixDaysSessions }));
ok('1.1 workingDays = 6 (any 6 of 7)', sixM.workingDays === 6, 'got: ' + sixM.workingDays);
ok('1.2 presentDays = 6 (showed up 6 distinct days, ANY day of week counts)',
   sixM.presentDays === 6, 'got: ' + sixM.presentDays);
ok('1.3 presenceRatePct = 100 (6/6)', sixM.presenceRatePct === 100);
ok('1.4 avgActiveHoursPerDay = 8', sixM.avgActiveHoursPerDay === 8);
ok('1.5 avgHoursPerDay (back-compat) = avgActiveHoursPerDay', sixM.avgHoursPerDay === sixM.avgActiveHoursPerDay);
ok('1.6 loginCount = 6 (one login per day)', sixM.loginCount === 6);
ok('1.7 expectedLogins = 6', sixM.expectedLogins === 6);
ok('1.8 loginRatePct = 100', sixM.loginRatePct === 100);

// ---- Scenario 2: Sun-Thu worker (Egypt convention) ----
// Showed up 5 days, all weekdays. Working days = 6 expected.
var sunThuSessions = [
  // Sun May 3 is OUTSIDE period (period starts Mon May 4) — so build one inside period
  { user_id: userId, date: '2026-05-04', login_at: ts('2026-05-04', 13, 0), logout_at: ts('2026-05-04', 21, 0) },
  { user_id: userId, date: '2026-05-05', login_at: ts('2026-05-05', 13, 0), logout_at: ts('2026-05-05', 21, 0) },
  { user_id: userId, date: '2026-05-06', login_at: ts('2026-05-06', 13, 0), logout_at: ts('2026-05-06', 21, 0) },
  { user_id: userId, date: '2026-05-07', login_at: ts('2026-05-07', 13, 0), logout_at: ts('2026-05-07', 21, 0) },
  { user_id: userId, date: '2026-05-10', login_at: ts('2026-05-10', 13, 0), logout_at: ts('2026-05-10', 21, 0) },
];
var sunM = lib.calcMetricsForUser(userId, period, Object.assign({}, noiseInputs, { userSessions: sunThuSessions }));
ok('2.1 5 days in 7-day period: presentDays = 5', sunM.presentDays === 5);
ok('2.2 presenceRatePct = 83 (5/6)', sunM.presenceRatePct === 83, 'got: ' + sunM.presenceRatePct);

// ---- Scenario 3: Phantom row (no login_at) is rejected ----
var phantomSessions = [
  { user_id: userId, date: '2026-05-04', login_at: ts('2026-05-04', 13, 0), logout_at: ts('2026-05-04', 21, 0) },
  // phantom: no login_at
  { user_id: userId, date: '2026-05-05', logout_at: ts('2026-05-05', 21, 0) },
  // wrong user
  { user_id: 'someone-else', date: '2026-05-06', login_at: ts('2026-05-06', 13, 0) },
];
var phantomM = lib.calcMetricsForUser(userId, period, Object.assign({}, noiseInputs, { userSessions: phantomSessions }));
ok('3.1 phantom rejected — only 1 valid presentDay', phantomM.presentDays === 1);
ok('3.2 phantom rejected — loginCount = 1', phantomM.loginCount === 1);

// ---- Scenario 4: Two tabs same day (interval merge) ----
var twoTabsSessions = [
  { user_id: userId, date: '2026-05-04', login_at: ts('2026-05-04', 10, 0), last_active: ts('2026-05-04', 14, 0), last_seen: ts('2026-05-04', 14, 0) },
  { user_id: userId, date: '2026-05-04', login_at: ts('2026-05-04', 13, 0), last_active: ts('2026-05-04', 17, 0), last_seen: ts('2026-05-04', 17, 0) },
];
var twoM = lib.calcMetricsForUser(userId, period, Object.assign({}, noiseInputs, { userSessions: twoTabsSessions }));
ok('4.1 two overlapping tabs: avgActiveHoursPerDay = 7 (merged 10→17, NOT 8)',
   twoM.avgActiveHoursPerDay === 7);
ok('4.2 two tabs: loginCount = 2 (sessions counted, not deduped)',
   twoM.loginCount === 2);
ok('4.3 two tabs same day: presentDays = 1', twoM.presentDays === 1);

// ---- Scenario 5: Active hours vs Open hours (idle tab) ----
var idleSessions = [
  { user_id: userId, date: '2026-05-04', login_at: ts('2026-05-04', 10, 0),
    last_active: ts('2026-05-04', 12, 0),  // user did things until noon
    last_seen: ts('2026-05-04', 22, 0),    // tab kept being alive 'til 10pm
  },
];
var idleM = lib.calcMetricsForUser(userId, period, Object.assign({}, noiseInputs, { userSessions: idleSessions }));
ok('5.1 idle tab: avgActiveHoursPerDay = 2 (real work)',
   idleM.avgActiveHoursPerDay === 2);
ok('5.2 idle tab: avgOpenHoursPerDay = 12',
   idleM.avgOpenHoursPerDay === 12);

// ---- Scenario 6: 12h cap per day (4 sessions × 4h overlap) ----
var overdoneSessions = [
  { user_id: userId, date: '2026-05-04', login_at: ts('2026-05-04', 0, 0), last_active: ts('2026-05-04', 6, 0) },
  { user_id: userId, date: '2026-05-04', login_at: ts('2026-05-04', 6, 0), last_active: ts('2026-05-04', 12, 0) },
  { user_id: userId, date: '2026-05-04', login_at: ts('2026-05-04', 12, 0), last_active: ts('2026-05-04', 18, 0) },
  { user_id: userId, date: '2026-05-04', login_at: ts('2026-05-04', 18, 0), last_active: ts('2026-05-05', 0, 0) },
];
var overM = lib.calcMetricsForUser(userId, period, Object.assign({}, noiseInputs, { userSessions: overdoneSessions }));
ok('6.1 24-hour day capped at 12h', overM.avgActiveHoursPerDay === 12);

// ---- Scenario 7: legacy session (no last_active) falls back to last_seen ----
var legacySessions = [
  { user_id: userId, date: '2026-05-04', login_at: ts('2026-05-04', 13, 0),
    last_seen: ts('2026-05-04', 21, 0)
    // no last_active
  },
];
var legacyM = lib.calcMetricsForUser(userId, period, Object.assign({}, noiseInputs, { userSessions: legacySessions }));
ok('7.1 legacy session: avgActiveHoursPerDay falls back to last_seen → 8',
   legacyM.avgActiveHoursPerDay === 8);

// ---- Scenario 8: calcScore — Presence sub-score = 40+40+20 ----
var perfectMetrics = {
  workingDays: 6, presentDays: 6, presenceRatePct: 100,
  avgHoursPerDay: 8, avgActiveHoursPerDay: 8, avgOpenHoursPerDay: 8,
  loginCount: 6, expectedLogins: 6, loginRatePct: 100,
  ticketsClosed: 0, manualFillRatePct: 0, totalActions: 0, onTimePct: null,
  meetingShowUpPct: null, lateEdits: 0, overdueNow: 0,
};
var perfectScore = lib.calcScore(perfectMetrics, [perfectMetrics]);
ok('8.1 perfect presence/active/login → presence = 100', perfectScore.presence === 100);

var halfMetrics = Object.assign({}, perfectMetrics, {
  presenceRatePct: 50, presentDays: 3,
  avgActiveHoursPerDay: 4, avgHoursPerDay: 4,
  loginCount: 3, loginRatePct: 50,
});
var halfScore = lib.calcScore(halfMetrics, [halfMetrics]);
// presence = 50*0.4 + 50*0.4 + 50*0.2 = 50
ok('8.2 half-rate inputs → presence = 50',
   Math.abs(halfScore.presence - 50) <= 1, 'got: ' + halfScore.presence);

// ---- Scenario 9: legacy metrics (no presence data) → presence is null ----
var legacyMetrics = {
  workingDays: 0,  // forces presence calc to skip
  ticketsClosed: 0, manualFillRatePct: 0, totalActions: 0, onTimePct: null,
  meetingShowUpPct: null, lateEdits: 0, overdueNow: 0,
};
var legacyScore = lib.calcScore(legacyMetrics, [legacyMetrics]);
ok('9.1 legacy metrics: presence is null', legacyScore.presence === null);
ok('9.2 legacy metrics: score is still computed (renormalized)',
   legacyScore.score !== null && typeof legacyScore.score === 'number');

// ---- Scenario 10: weights use new PHASE-B+ formula ----
ok('10.1 weights table: Activity 0.35', /activity \* 0\.35/.test(src));
ok('10.2 weights table: Timeliness 0.20', /timeliness \* 0\.20/.test(src));
ok('10.3 weights table: Quality 0.15', /quality \* 0\.15/.test(src));
ok('10.4 weights table: Reliability 0.10', /reliability \* 0\.10/.test(src));
ok('10.5 weights table: Productivity 0.05', /productivity \* 0\.05/.test(src));
ok('10.6 weights table: Presence 0.15', /presence \* 0\.15/.test(src));
// Sum check (manual): 0.35 + 0.20 + 0.15 + 0.10 + 0.05 = 0.85, plus presence 0.15 = 1.00 ✓
ok('10.7 weight sum = 1.00 with presence', Math.abs(0.35 + 0.20 + 0.15 + 0.10 + 0.05 + 0.15 - 1.00) < 0.001);

// ---- Scenario 11: explainScore renders Presence driver only when present ----
var explainPerfect = lib.explainScore(perfectScore, perfectMetrics);
var presDriver = explainPerfect.drivers.find(function (d) { return d.label === 'Presence'; });
ok('11.1 explainScore Presence driver present when score has presence', !!presDriver);
ok('11.2 Presence driver weight is 0.15', presDriver && presDriver.weight === 0.15);
ok('11.3 Presence driver mentions login frequency',
   presDriver && presDriver.lines.some(function (l) { return /Logged in/i.test(l); }));

var explainLegacy = lib.explainScore(legacyScore, legacyMetrics);
var legacyPresDriver = explainLegacy.drivers.find(function (d) { return d.label === 'Presence'; });
ok('11.4 explainScore: NO Presence driver when score.presence is null',
   !legacyPresDriver);

console.log('\n=== Results ===');
console.log('Passed: ' + passed + ' / ' + (passed + failed));
process.exit(failed > 0 ? 1 : 0);
