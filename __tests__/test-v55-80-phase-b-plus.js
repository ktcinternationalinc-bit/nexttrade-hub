// __tests__/test-v55-80-phase-b-plus.js
// =========================================
// v55.80 PHASE-B+ feedback (Max May 8 2026):
//   1. Two browser tabs open at the same time = ONE session for hours
//      counting purposes. Interval-merge across tabs.
//   2. Active hours (last_active) ≠ open hours (last_seen). Score uses
//      active. Both surface in the breakdown.
//   3. Login frequency tracked alongside attendance — checking in matters.
//   4. High-priority tickets count more in Timeliness — closing a high-pri
//      on time is worth more than a low-pri, missing a high-pri hurts more.
//
// Run: node __tests__/test-v55-80-phase-b-plus.js

var fs = require('fs');
var path = require('path');

var src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'hr-metrics.js'), 'utf8');
var script = src
  .replace(/export\s+function\s+/g, 'function ')
  .replace(/export\s+\{[^}]*\}/g, '');
script += '\n;return { calcMetricsForUser: calcMetricsForUser, calcScore: calcScore, explainScore: explainScore, countWorkingDaysInPeriod: countWorkingDaysInPeriod };\n';
var lib = (new Function(script))();

var passed = 0;
var failed = 0;
function ok(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.error('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('\n=== v55.80 PHASE-B+ tests (interval merge + active hours + priority) ===');

// ---------------------------------------------------------------
// 1. INTERVAL MERGE — two overlapping tabs = one session for hours
// ---------------------------------------------------------------
var period = { from: '2026-05-04', to: '2026-05-04', days: 1 };
var noiseInputs = {
  tickets: [], ticketComments: [], dailyLog: [], auditLog: [],
  customerQuotes: [], calendarEvents: [], customers: [],
};

// Tab 1: login 10:00 → last_active 14:00 (4h active)
// Tab 2: login 13:00 → last_active 17:00 (4h active)
// OPEN UNION = 10:00 → 17:00 = 7h
// (No overlap waste because tab 2's end extends tab 1's interval)
var twoTabsSessions = [
  { user_id: 'u1', date: '2026-05-04',
    login_at: '2026-05-04T10:00:00Z', last_active: '2026-05-04T14:00:00Z', last_seen: '2026-05-04T14:00:00Z' },
  { user_id: 'u1', date: '2026-05-04',
    login_at: '2026-05-04T13:00:00Z', last_active: '2026-05-04T17:00:00Z', last_seen: '2026-05-04T17:00:00Z' },
];
var mTwoTabs = lib.calcMetricsForUser('u1', period, Object.assign({}, noiseInputs, { userSessions: twoTabsSessions }));
ok('1.1 two overlapping tabs: avgActiveHoursPerDay = 7h (NOT 8h — overlap removed)',
   mTwoTabs.avgActiveHoursPerDay === 7, 'got: ' + mTwoTabs.avgActiveHoursPerDay);
ok('1.2 two overlapping tabs: loginCount = 2 (still rewards check-ins)',
   mTwoTabs.loginCount === 2);
ok('1.3 presentDays = 1 (one calendar day)', mTwoTabs.presentDays === 1);

// Tab 1: 10:00 → 12:00 (2h)
// Tab 2: 14:00 → 16:00 (2h)
// No overlap, gap from 12-14. Total = 4h.
var twoNonOverlapSessions = [
  { user_id: 'u1', date: '2026-05-04',
    login_at: '2026-05-04T10:00:00Z', last_active: '2026-05-04T12:00:00Z', last_seen: '2026-05-04T12:00:00Z' },
  { user_id: 'u1', date: '2026-05-04',
    login_at: '2026-05-04T14:00:00Z', last_active: '2026-05-04T16:00:00Z', last_seen: '2026-05-04T16:00:00Z' },
];
var mNonOverlap = lib.calcMetricsForUser('u1', period, Object.assign({}, noiseInputs, { userSessions: twoNonOverlapSessions }));
ok('1.4 two non-overlapping tabs: avgActiveHoursPerDay = 4h',
   mNonOverlap.avgActiveHoursPerDay === 4, 'got: ' + mNonOverlap.avgActiveHoursPerDay);

// Three identical tabs (totally overlapping) — should still be 4h
var threeIdenticalSessions = [
  { user_id: 'u1', date: '2026-05-04',
    login_at: '2026-05-04T10:00:00Z', last_active: '2026-05-04T14:00:00Z', last_seen: '2026-05-04T14:00:00Z' },
  { user_id: 'u1', date: '2026-05-04',
    login_at: '2026-05-04T10:00:00Z', last_active: '2026-05-04T14:00:00Z', last_seen: '2026-05-04T14:00:00Z' },
  { user_id: 'u1', date: '2026-05-04',
    login_at: '2026-05-04T10:00:00Z', last_active: '2026-05-04T14:00:00Z', last_seen: '2026-05-04T14:00:00Z' },
];
var mIdentical = lib.calcMetricsForUser('u1', period, Object.assign({}, noiseInputs, { userSessions: threeIdenticalSessions }));
ok('1.5 three identical tabs: avgActiveHoursPerDay = 4h (NOT 12h — full dedup)',
   mIdentical.avgActiveHoursPerDay === 4, 'got: ' + mIdentical.avgActiveHoursPerDay);
ok('1.6 three identical tabs: loginCount = 3 (raw count preserved)',
   mIdentical.loginCount === 3);

// ---------------------------------------------------------------
// 2. ACTIVE vs OPEN — last_active = real work, last_seen = tab open
// ---------------------------------------------------------------

// Tab open all day (last_seen 12h after login) but last_active only 2h after.
// User opened tab at morning, did 2h of work, walked away.
var idleTabSessions = [
  { user_id: 'u1', date: '2026-05-04',
    login_at: '2026-05-04T10:00:00Z',
    last_active: '2026-05-04T12:00:00Z',  // stopped doing things at noon
    last_seen: '2026-05-04T22:00:00Z',    // tab kept being alive 'til 10pm
  },
];
var mIdle = lib.calcMetricsForUser('u1', period, Object.assign({}, noiseInputs, { userSessions: idleTabSessions }));
ok('2.1 active hours = 2h (real work)', mIdle.avgActiveHoursPerDay === 2, 'got: ' + mIdle.avgActiveHoursPerDay);
ok('2.2 open hours = 12h (tab was alive)', mIdle.avgOpenHoursPerDay === 12, 'got: ' + mIdle.avgOpenHoursPerDay);
ok('2.3 score uses active (avgHoursPerDay = avgActiveHoursPerDay for back-compat)',
   mIdle.avgHoursPerDay === mIdle.avgActiveHoursPerDay);

// Pre-migration session (last_active is null) — fallback to last_seen
var legacyOnlySessions = [
  { user_id: 'u1', date: '2026-05-04',
    login_at: '2026-05-04T10:00:00Z',
    last_seen: '2026-05-04T18:00:00Z',
    // last_active not set
  },
];
var mLegacy = lib.calcMetricsForUser('u1', period, Object.assign({}, noiseInputs, { userSessions: legacyOnlySessions }));
ok('2.4 legacy session (no last_active): falls back to last_seen → 8h',
   mLegacy.avgActiveHoursPerDay === 8, 'got: ' + mLegacy.avgActiveHoursPerDay);

// ---------------------------------------------------------------
// 3. PRIORITY-WEIGHTED TIMELINESS
// ---------------------------------------------------------------

// User closes 3 tickets in period: 1 urgent on time, 1 high late, 1 low on time
var weekPeriod = { from: '2026-05-04', to: '2026-05-10', days: 7 };
var priorityTickets = [
  // urgent on time — weight 3
  { id: 't1', created_by: 'u1', closed_by: 'u1', assigned_to: 'u1',
    priority: 'urgent', created_at: '2026-05-04T10:00:00Z',
    closed_at: '2026-05-04T15:00:00Z', due_date: '2026-05-04', status: 'Closed' },
  // high late — weight 2 but earned 0
  { id: 't2', created_by: 'u1', closed_by: 'u1', assigned_to: 'u1',
    priority: 'high', created_at: '2026-05-05T10:00:00Z',
    closed_at: '2026-05-08T15:00:00Z', due_date: '2026-05-06', status: 'Closed' },
  // low on time — weight 0.5
  { id: 't3', created_by: 'u1', closed_by: 'u1', assigned_to: 'u1',
    priority: 'low', created_at: '2026-05-07T10:00:00Z',
    closed_at: '2026-05-08T10:00:00Z', due_date: '2026-05-08', status: 'Closed' },
];
var mPri = lib.calcMetricsForUser('u1', weekPeriod, Object.assign({}, noiseInputs, { tickets: priorityTickets }));
// Bare on-time = 2/3 = 67%
// Priority-weighted = (3 + 0 + 0.5) / (3 + 2 + 0.5) = 3.5/5.5 = 64%
ok('3.1 bare onTimePct = 67%', mPri.onTimePct === 67, 'got: ' + mPri.onTimePct);
ok('3.2 priority-weighted on-time pct = 64% (high late hurt more than low on-time helped)',
   mPri.priorityWeightedOnTimePct === 64,
   'got: ' + mPri.priorityWeightedOnTimePct);
ok('3.3 closedByPriority breakdown correct',
   mPri.closedByPriority.urgent === 1
   && mPri.closedByPriority.high === 1
   && mPri.closedByPriority.low === 1);
ok('3.4 closedOnTimeByPriority breakdown correct',
   mPri.closedOnTimeByPriority.urgent === 1
   && mPri.closedOnTimeByPriority.high === 0
   && mPri.closedOnTimeByPriority.low === 1);

// Two open overdue tickets — one urgent (weight 3), one low (weight 0.5)
var todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
var yesterday = new Date(); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
var yStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(yesterday);
var openOverdueTickets = [
  { id: 'o1', created_by: 'u1', assigned_to: 'u1', priority: 'urgent',
    created_at: '2026-05-04T10:00:00Z', due_date: yStr, status: 'Open' },
  { id: 'o2', created_by: 'u1', assigned_to: 'u1', priority: 'low',
    created_at: '2026-05-05T10:00:00Z', due_date: yStr, status: 'Open' },
];
var mOverdue = lib.calcMetricsForUser('u1', weekPeriod, Object.assign({}, noiseInputs, { tickets: openOverdueTickets }));
ok('3.5 overdueNow = 2', mOverdue.overdueNow === 2);
ok('3.6 overdueByPriority breaks down correctly',
   mOverdue.overdueByPriority.urgent === 1 && mOverdue.overdueByPriority.low === 1);
ok('3.7 overdueWeightSum = 3.5 (urgent 3.0 + low 0.5)',
   Math.abs(mOverdue.overdueWeightSum - 3.5) < 0.01,
   'got: ' + mOverdue.overdueWeightSum);

// Calc the score and verify Timeliness reflects weighted overdue
var teamMetricsArr = [mOverdue];
var scoreOverdue = lib.calcScore(mOverdue, teamMetricsArr);
ok('3.8 timeliness reflects weighted overdue (urgent overdue hurts more)',
   scoreOverdue.timeliness < 70,
   'timeliness: ' + scoreOverdue.timeliness);

// ---------------------------------------------------------------
// 4. PRESENCE SUB-SCORE — three signals balanced (40/40/20)
// ---------------------------------------------------------------

// Perfect attendance + 8h active + perfect logins = 100
var perfectMetrics = {
  workingDays: 6, presentDays: 6, presenceRatePct: 100,
  avgHoursPerDay: 8, avgActiveHoursPerDay: 8, avgOpenHoursPerDay: 8,
  loginCount: 6, expectedLogins: 6, loginRatePct: 100,
  // ensure other inputs don't make calcScore null
  ticketsClosed: 0, manualFillRatePct: 0, totalActions: 0, onTimePct: null,
  meetingShowUpPct: null, lateEdits: 0, overdueNow: 0,
};
var perfectScore = lib.calcScore(perfectMetrics, [perfectMetrics]);
ok('4.1 perfect presence/active/login → presence = 100',
   perfectScore.presence === 100,
   'got: ' + perfectScore.presence);

// Showed up every day, but 8h tab open / 2h active = active is what counts
var idleMetrics = Object.assign({}, perfectMetrics, {
  avgActiveHoursPerDay: 2, avgHoursPerDay: 2, avgOpenHoursPerDay: 8,
});
var idleScore = lib.calcScore(idleMetrics, [idleMetrics]);
// presence = 100 * 0.4 + 25 * 0.4 + 100 * 0.2 = 40 + 10 + 20 = 70
ok('4.2 idle (8h open / 2h active): presence ≈ 70',
   Math.abs(idleScore.presence - 70) <= 1,
   'got: ' + idleScore.presence);

// Showed up every day, 8h active, but only logged in once
var onceMetrics = Object.assign({}, perfectMetrics, {
  loginCount: 1, expectedLogins: 6, loginRatePct: 17,
});
var onceScore = lib.calcScore(onceMetrics, [onceMetrics]);
// presence = 100 * 0.4 + 100 * 0.4 + 17 * 0.2 = 40 + 40 + 3.4 = 83
ok('4.3 logged in once but stayed all day: presence ≈ 83',
   Math.abs(onceScore.presence - 83) <= 2,
   'got: ' + onceScore.presence);

// ---------------------------------------------------------------
// 5. EXPLAIN SCORE — surfaces priority breakdown + open-vs-active
// ---------------------------------------------------------------

var explained = lib.explainScore(scoreOverdue, mOverdue);
var timelinessDriver = explained.drivers.find(function (d) { return d.label === 'Timeliness'; });
ok('5.1 explainScore Timeliness mentions high-priority overdue',
   timelinessDriver && timelinessDriver.lines.some(function (l) { return /high-priority/i.test(l); }),
   'lines: ' + JSON.stringify(timelinessDriver && timelinessDriver.lines));

// Add presence-with-idle scenario
var idleScoreFull = lib.calcScore(idleMetrics, [idleMetrics]);
var idleExplained = lib.explainScore(idleScoreFull, idleMetrics);
var presDriver = idleExplained.drivers.find(function (d) { return d.label === 'Presence'; });
ok('5.2 explainScore Presence mentions tab-open-vs-active',
   presDriver && presDriver.lines.some(function (l) { return /tab was open/i.test(l); }),
   'lines: ' + JSON.stringify(presDriver && presDriver.lines));
ok('5.3 idle scenario surfaces "tab open but only active" concern',
   idleExplained.concerns.some(function (c) { return /Tab open/i.test(c); }),
   'concerns: ' + JSON.stringify(idleExplained.concerns));

// ---------------------------------------------------------------
// 6. WORKING DAYS = 6 of 7 (still correct after refactor)
// ---------------------------------------------------------------
ok('6.1 7-day period = 6 working days', lib.countWorkingDaysInPeriod({ from: '2026-05-04', to: '2026-05-10' }) === 6);
ok('6.2 30-day period ≈ 26 working days', lib.countWorkingDaysInPeriod({ from: '2026-05-01', to: '2026-05-30' }) === 26);
ok('6.3 1-day period = 1 working day (min floor)', lib.countWorkingDaysInPeriod({ from: '2026-05-04', to: '2026-05-04' }) === 1);

console.log('\n=== Results ===');
console.log('Passed: ' + passed + ' / ' + (passed + failed));
process.exit(failed > 0 ? 1 : 0);
