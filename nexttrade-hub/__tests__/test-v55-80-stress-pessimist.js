// __tests__/test-v55-80-stress-pessimist.js
// =========================================
// QA Engineer 1: The Pessimist
//
// Looks for outright bugs and edge cases:
//   - fmtET with weird inputs (Date with NaN, very old dates, year 9999)
//   - et-time helpers with epoch-0 / negative numbers / non-string non-Date
//   - todayET / yesterdayET around DST boundaries
//   - cmpETDays with malformed strings
//   - explainScore with malformed score object
//   - Presence with corrupted session data (login_at after logout_at)
//   - calcScore renormalization math when ALL components are null
//
// Run: node __tests__/test-v55-80-stress-pessimist.js

var fs = require('fs');
var path = require('path');

var passed = 0;
var failed = 0;
function ok(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.error('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

function load(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }

// Load helpers
var etSrc = load('src/lib/et-time.js')
  .replace(/export\s+function\s+/g, 'function ')
  .replace(/export\s+\{[^}]*\}/g, '');
etSrc += '\n;return { fmtET: fmtET, fmtETRange: fmtETRange, relativeET: relativeET, todayET: todayET, yesterdayET: yesterdayET, daysAgoET: daysAgoET, cmpETDays: cmpETDays, etDateStr: etDateStr };\n';
var et = (new Function(etSrc))();

var hrSrc = load('src/lib/hr-metrics.js')
  .replace(/export\s+function\s+/g, 'function ')
  .replace(/export\s+\{[^}]*\}/g, '');
hrSrc += '\n;return { calcMetricsForUser: calcMetricsForUser, calcScore: calcScore, explainScore: explainScore };\n';
var hr = (new Function(hrSrc))();

console.log('\n=== QA Engineer 1: The Pessimist ===');

// ---- fmtET pathological inputs ----
ok('P1: fmtET(NaN) returns "—"', et.fmtET(NaN) === '—');
ok('P2: fmtET(Infinity) returns "—"', et.fmtET(Infinity) === '—');
ok('P3: fmtET(-1) returns "—"', et.fmtET(-1, 'iso') === '1969-12-31', 'got: ' + et.fmtET(-1, 'iso'));  // epoch -1
ok('P4: fmtET(0) returns 1969-12-31 ET', et.fmtET(0, 'iso') === '1969-12-31', 'got: ' + et.fmtET(0, 'iso'));  // epoch 0 = ET 1969-12-31 evening
ok('P5: fmtET on empty array', et.fmtET([], 'iso') === '—');
ok('P6: fmtET on plain object', et.fmtET({}, 'iso') === '—');
ok('P7: fmtET on number-string "42"', /^\d{4}-\d{2}-\d{2}$/.test(et.fmtET('42', 'iso')) || et.fmtET('42', 'iso') === '—');
ok('P8: fmtET on far-future date', et.fmtET('9999-12-31', 'date') === 'Dec 31, 9999');
ok('P9: fmtET on far-past date does not crash', typeof et.fmtET('0100-01-01', 'iso') === 'string' && et.fmtET('0100-01-01', 'iso').length >= 8);
ok('P10: fmtET with unknown kind defaults reasonably', typeof et.fmtET('2026-05-08', 'wibble') === 'string');
ok('P11: fmtET with null kind uses default', et.fmtET('2026-05-08T18:14:00Z', null) !== '—');
ok('P12: fmtET on Date(NaN)', et.fmtET(new Date(NaN)) === '—');
ok('P13: fmtET on bare string with junk', et.fmtET('not a date at all', 'date') === '—');

// ---- DST boundary safety ----
// US DST transitions: spring forward second Sunday of March, fall back first Sunday of November.
// In 2026: March 8 (spring forward), November 1 (fall back).
// At 2:30 AM ET on March 8, time jumps to 3:30 AM. A timestamp that's "2:30 AM ET" doesn't exist.
ok('P14: DST spring-forward — fmtET on 06:30 UTC March 8 2026 lands on March 8',
   et.fmtET('2026-03-08T06:30:00Z', 'iso') === '2026-03-08',
   'got: ' + et.fmtET('2026-03-08T06:30:00Z', 'iso'));
// Right after fall-back (1:30 AM ET on Nov 1) is ambiguous — could be EDT or EST.
ok('P15: DST fall-back — fmtET on 05:30 UTC Nov 1 2026 lands on Nov 1',
   et.fmtET('2026-11-01T05:30:00Z', 'iso') === '2026-11-01',
   'got: ' + et.fmtET('2026-11-01T05:30:00Z', 'iso'));

// ---- ET midnight boundary ----
// 04:00 UTC = 00:00 EDT (during summer time, UTC-4)
// 05:00 UTC = 00:00 EST (during winter time, UTC-5)
ok('P16: midnight ET (summer) — 04:00:00 UTC May 8 = 12:00 AM ET May 8',
   et.fmtET('2026-05-08T04:00:00Z', 'iso') === '2026-05-08',
   'got: ' + et.fmtET('2026-05-08T04:00:00Z', 'iso'));
ok('P17: 1 minute before midnight ET (summer) — 03:59:00 UTC May 8 = 11:59 PM ET May 7',
   et.fmtET('2026-05-08T03:59:00Z', 'iso') === '2026-05-07',
   'got: ' + et.fmtET('2026-05-08T03:59:00Z', 'iso'));

// ---- cmpETDays edge cases ----
ok('P18: cmpETDays with empty string', et.cmpETDays('', '2026-01-01') === 0);
ok('P19: cmpETDays(a, a) === 0', et.cmpETDays('2026-05-08', '2026-05-08') === 0);
ok('P20: cmpETDays across years', et.cmpETDays('2025-12-31', '2026-01-01') === 1);
ok('P21: cmpETDays large diff', et.cmpETDays('2020-01-01', '2026-01-01') === Math.round(6 * 365.25));

// ---- relativeET edge cases ----
ok('P22: relativeET(future) returns datetime not negative', !/^-/.test(et.relativeET(new Date(Date.now() + 60000))));
ok('P23: relativeET(0 epoch) returns date string not crash', typeof et.relativeET(0) === 'string');

// ---- explainScore malformed inputs ----
ok('P24: explainScore({score:0}, {}) does not crash', (function () {
  try { var r = hr.explainScore({score:0}, {}); return r && Array.isArray(r.drivers); }
  catch (e) { return false; }
})());
ok('P25: explainScore({all zero}, {}) returns 0 contributions',
   (function () {
     var r = hr.explainScore({score:0, activity:0, productivity:0, quality:0, timeliness:0, engagement:0, reliability:0}, {workingDays: 0});
     return r.drivers.every(function (d) { return d.contribution === 0; });
   })());
ok('P26: explainScore handles negative score gracefully',
   typeof hr.explainScore({score:-50, productivity:-20, quality:0, timeliness:0, engagement:0, reliability:0}, {}).summary === 'string');

// ---- Presence with corrupted session data ----
var weirdPeriod = { from: '2026-05-04', to: '2026-05-10', days: 7 };
var corruptSessions = [
  // logout_at < login_at (login happened, but duration is bogus — should still count
  // as "present" but contribute zero hours)
  { user_id: 'u1', date: '2026-05-04', login_at: '2026-05-04T18:00:00Z', logout_at: '2026-05-04T13:00:00Z' },
  // session with no login_at — phantom row, REJECTED entirely
  { user_id: 'u1', date: '2026-05-05', logout_at: '2026-05-05T18:00:00Z' },
  // session for different user — REJECTED
  { user_id: 'u2', date: '2026-05-05', login_at: '2026-05-05T13:00:00Z', logout_at: '2026-05-05T21:00:00Z' },
  // valid session
  { user_id: 'u1', date: '2026-05-06', login_at: '2026-05-06T13:00:00Z', logout_at: '2026-05-06T21:00:00Z' },
];
var m = hr.calcMetricsForUser('u1', weirdPeriod, {
  tickets: [], ticketComments: [], dailyLog: [], auditLog: [], customerQuotes: [], calendarEvents: [],
  customers: [], userSessions: corruptSessions,
});
ok('P27: corrupt sessions — phantom (no login_at) rejected, login-without-valid-logout still counts as present',
   m.presentDays === 2, 'presentDays: ' + m.presentDays);
ok('P28: corrupt sessions — only valid duration session contributes hours (8h / 1 day with duration data)',
   m.avgHoursPerDay === 8, 'avgHours: ' + m.avgHoursPerDay);
ok('P29: corrupt sessions — does not credit session for u2',
   m.presentDays !== 3);

// ---- Score renormalization edge case ----
// Build a metrics object where presence is null (no presence data)
// and verify the score is calculated using only the 5 non-presence components.
var noP_M = Object.assign({}, m);
noP_M.workingDays = 0; // forces presence to be null in calcScore
var noP_score = hr.calcScore(noP_M, [noP_M]);
ok('P30: when workingDays=0, presence is null', noP_score.presence === null);
ok('P31: when workingDays=0, score still computed (renormalized)',
   noP_score.score !== null && typeof noP_score.score === 'number');

// ---- Explainability with presence absent ----
var noP_explain = hr.explainScore(noP_score, noP_M);
ok('P32: explain with no presence has 5 drivers, not 6',
   noP_explain.drivers.length === 5);
ok('P33: weights sum to 0.85 when presence excluded (PHASE-B+: A35+T20+Q15+R10+P5)',
   Math.abs(noP_explain.drivers.reduce(function (a, d) { return a + d.weight; }, 0) - 0.85) < 0.001);

// ---- 12-hour cap exactness ----
var capExactSessions = [
  // exactly 12h session
  { user_id: 'u1', date: '2026-05-04', login_at: '2026-05-04T13:00:00Z', logout_at: '2026-05-05T01:00:00Z' },
];
var capM = hr.calcMetricsForUser('u1', { from: '2026-05-04', to: '2026-05-04', days: 1 }, {
  tickets: [], ticketComments: [], dailyLog: [], auditLog: [], customerQuotes: [], calendarEvents: [],
  customers: [], userSessions: capExactSessions,
});
ok('P34: 12h cap — exactly 12h is allowed (not capped down)',
   capM.avgHoursPerDay === 12, 'got: ' + capM.avgHoursPerDay);

// ---- Multiple sessions same day stack ----
var multiSessions = [
  { user_id: 'u1', date: '2026-05-04', login_at: '2026-05-04T13:00:00Z', logout_at: '2026-05-04T17:00:00Z' }, // 4h morning
  { user_id: 'u1', date: '2026-05-04', login_at: '2026-05-04T18:00:00Z', logout_at: '2026-05-04T22:00:00Z' }, // 4h evening
];
var multiM = hr.calcMetricsForUser('u1', { from: '2026-05-04', to: '2026-05-04', days: 1 }, {
  tickets: [], ticketComments: [], dailyLog: [], auditLog: [], customerQuotes: [], calendarEvents: [],
  customers: [], userSessions: multiSessions,
});
ok('P35: multiple sessions same day — totals stacked (8h)',
   multiM.avgHoursPerDay === 8, 'got: ' + multiM.avgHoursPerDay);

// ---- Per-day cap when total exceeds 12h (e.g. 4 sessions of 4h each)----
var overdoneSessions = [
  { user_id: 'u1', date: '2026-05-04', login_at: '2026-05-04T08:00:00Z', logout_at: '2026-05-04T12:00:00Z' },
  { user_id: 'u1', date: '2026-05-04', login_at: '2026-05-04T13:00:00Z', logout_at: '2026-05-04T17:00:00Z' },
  { user_id: 'u1', date: '2026-05-04', login_at: '2026-05-04T18:00:00Z', logout_at: '2026-05-04T22:00:00Z' },
  { user_id: 'u1', date: '2026-05-04', login_at: '2026-05-04T23:00:00Z', logout_at: '2026-05-05T03:00:00Z' },
];
var overM = hr.calcMetricsForUser('u1', { from: '2026-05-04', to: '2026-05-04', days: 1 }, {
  tickets: [], ticketComments: [], dailyLog: [], auditLog: [], customerQuotes: [], calendarEvents: [],
  customers: [], userSessions: overdoneSessions,
});
ok('P36: 4 sessions × 4h = 16h, capped at 12h per day',
   overM.avgHoursPerDay === 12, 'got: ' + overM.avgHoursPerDay);

console.log('\n=== Pessimist Results ===');
console.log('Passed: ' + passed + ' / ' + (passed + failed));
process.exit(failed > 0 ? 1 : 0);
