// __tests__/test-v55-80-score-breakdown.js
// =========================================
// Tests for explainScore() — the plain-English score breakdown.
//
// v55.80 PHASE-B refactor (May 8 2026, per Max's feedback):
//   New weights:
//     Activity      35%  (the lead — threshold-based, not relative)
//     Timeliness    20%
//     Presence      15%  (with presence data — else absent and renormalized)
//     Quality       15%
//     Reliability   10%
//     Productivity   5%  (intentionally tiny — kept relative)
//   Engagement is NO LONGER in the formula.
//
// Run: node __tests__/test-v55-80-score-breakdown.js

var fs = require('fs');
var path = require('path');

var src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'hr-metrics.js'), 'utf8');
var script = src
  .replace(/export\s+function\s+/g, 'function ')
  .replace(/export\s+\{[^}]*\}/g, '');
script += '\n;return { explainScore: explainScore, calcScore: calcScore };\n';
var lib = (new Function(script))();

var passed = 0;
var failed = 0;
function ok(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.error('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('\n=== v55.80 PHASE-B explainScore tests ===');

// ---- Null-safety ----
ok('explainScore(null, null) returns safe shape', (function () {
  var r = lib.explainScore(null, null);
  return r && r.summary && Array.isArray(r.drivers) && Array.isArray(r.wins) && Array.isArray(r.concerns);
})());
ok('explainScore(score, null) returns safe shape', (function () {
  var r = lib.explainScore({ score: 80 }, null);
  return r && r.drivers.length === 0;
})());
ok('explainScore({score:null}, m) returns "not enough data"', (function () {
  var r = lib.explainScore({ score: null }, { ticketsClosed: 0 });
  return /not enough/i.test(r.summary);
})());

// ---- Strong performer scenario (no presence) ----
var strongScore = {
  score: 84,
  activity: 85, productivity: 80, quality: 85, timeliness: 88, engagement: 82, reliability: 90,
};
var strongMetrics = {
  ticketsClosed: 12, ticketsCreated: 5, ticketsClosedOnTime: 12, ticketsClosedLate: 0,
  avgDaysToClose: 1.5, openTickets: 2, overdueNow: 0,
  ticketComments: 25, commentsPerTicket: 2.1, lateEdits: 0,
  ratesAdded: 5, bookings: 3, quotesCreated: 4, quotesSent: 4, quotesAccepted: 3,
  attendedEvents: 8, meetingsCreated: 2, meetingsCheckedIn: 6, meetingShowUpPct: 95,
  manualEntries: 18, autoEntries: 12, manualFillRatePct: 90, activeDays: 18, workingDays: 17,
  contactTouches: 15, crmLogEntries: 10, pipelineMoves: 4,
  systemTicketsCreated: 3, systemTicketsFixed: 3, systemTicketsRetested: 3,
  loginCount: 16, expectedLogins: 17, loginRatePct: 94,
  totalActions: 75, onTimePct: 100,
};

var strongR = lib.explainScore(strongScore, strongMetrics);
ok('strong: 5 drivers (no presence)', strongR.drivers.length === 5);
ok('strong: drivers in expected order',
  strongR.drivers.map(function (d) { return d.label; }).join(',') === 'Activity,Timeliness,Quality,Reliability,Productivity');
ok('strong: each driver has weight + value + lines',
  strongR.drivers.every(function (d) {
    return typeof d.weight === 'number' && typeof d.value === 'number' && Array.isArray(d.lines) && d.lines.length > 0;
  }));
ok('strong: weights sum to 0.85 (presence missing)', (function () {
  var sum = strongR.drivers.reduce(function (a, d) { return a + d.weight; }, 0);
  return Math.abs(sum - 0.85) < 0.001;
})());
ok('strong: Activity weight is 0.35 (the lead)', strongR.drivers[0].weight === 0.35);
ok('strong: Productivity weight is 0.05 (the trail)', strongR.drivers[4].weight === 0.05);
ok('strong: contribution sum ≈ score × weight-total', (function () {
  var sum = strongR.drivers.reduce(function (a, d) { return a + d.contribution; }, 0);
  var wTotal = strongR.drivers.reduce(function (a, d) { return a + d.weight; }, 0);
  // Each driver's contribution is value × weight, rounded to 0.1.
  // The sum can drift up to ~5 × 0.05 = 0.25 from rounding alone, plus
  // the score itself is a rounded-from-weighted-sum. Allow 2.0 slack.
  return Math.abs(sum - strongScore.score * wTotal) < 2.0;
})());
ok('strong: at least 1 win', strongR.wins.length >= 1, 'wins: ' + JSON.stringify(strongR.wins));
ok('strong: 0 concerns', strongR.concerns.length === 0, 'concerns: ' + JSON.stringify(strongR.concerns));
ok('strong: summary starts with score', strongR.summary.indexOf('84') === 0, 'got: ' + strongR.summary);
ok('strong: Activity driver shows login count',
  strongR.drivers[0].lines.some(function (l) { return /Logged in 16/i.test(l); }),
  'lines: ' + JSON.stringify(strongR.drivers[0].lines));
ok('strong: Activity driver shows ticket comments',
  strongR.drivers[0].lines.some(function (l) { return /25 ticket comments/i.test(l); }));
ok('strong: Activity driver shows meetings organized',
  strongR.drivers[0].lines.some(function (l) { return /Organized 2 meetings/i.test(l); }));

// ---- Strong performer with presence ----
var strongWithPresenceScore = Object.assign({}, strongScore, { presence: 88 });
var strongWithPresenceMetrics = Object.assign({}, strongMetrics, {
  presentDays: 16, presenceRatePct: 94, avgHoursPerDay: 7.5,
});
var strongPR = lib.explainScore(strongWithPresenceScore, strongWithPresenceMetrics);
ok('strong+presence: 6 drivers',
  strongPR.drivers.length === 6);
ok('strong+presence: order',
  strongPR.drivers.map(function (d) { return d.label; }).join(',') === 'Activity,Timeliness,Presence,Quality,Reliability,Productivity');
ok('strong+presence: weights sum to 1.00',
  Math.abs(strongPR.drivers.reduce(function (a, d) { return a + d.weight; }, 0) - 1.00) < 0.001);
ok('strong+presence: Presence weight is 0.15', strongPR.drivers[2].weight === 0.15);
ok('strong+presence: presence driver shows hours/day',
  strongPR.drivers[2].lines.some(function (l) { return /7\.5/.test(l); }));

// ---- Struggling performer ----
var weakScore = {
  score: 32,
  activity: 28, productivity: 25, quality: 30, timeliness: 28, engagement: 35, reliability: 50,
};
var weakMetrics = {
  ticketsClosed: 2, ticketsCreated: 1, ticketsClosedOnTime: 1, ticketsClosedLate: 1,
  avgDaysToClose: 8, openTickets: 12, overdueNow: 5,
  ticketComments: 3, commentsPerTicket: 0.2, lateEdits: 4,
  ratesAdded: 0, bookings: 0, quotesCreated: 1, quotesSent: 1, quotesAccepted: 0,
  attendedEvents: 1, meetingsCreated: 0, meetingsCheckedIn: 0, meetingShowUpPct: 40,
  manualEntries: 4, autoEntries: 8, manualFillRatePct: 25, activeDays: 5, workingDays: 17,
  contactTouches: 2, crmLogEntries: 1, pipelineMoves: 0,
  systemTicketsCreated: 2, systemTicketsFixed: 0, systemTicketsRetested: 0,
  loginCount: 4, expectedLogins: 17, loginRatePct: 24,
  totalActions: 12, onTimePct: 50,
};
var weakR = lib.explainScore(weakScore, weakMetrics);
ok('weak: at least 2 concerns',
  weakR.concerns.length >= 2, 'concerns: ' + JSON.stringify(weakR.concerns));
ok('weak: overdue concern present',
  weakR.concerns.some(function (c) { return /overdue/i.test(c); }));
ok('weak: critical concerns surfaced (overdue OR low-login OR late-edits)',
  weakR.concerns.some(function (c) { return /overdue|Only logged in|late edit|Only showed up/i.test(c); }),
  'concerns: ' + JSON.stringify(weakR.concerns));
ok('weak: low-login concern surfaced',
  weakR.concerns.some(function (c) { return /Only logged in/i.test(c); }),
  'concerns: ' + JSON.stringify(weakR.concerns));
ok('weak: concerns capped at 3', weakR.concerns.length <= 3);
ok('weak: summary mentions dragging down',
  /dragging|drag/i.test(weakR.summary), 'got: ' + weakR.summary);

// ---- Empty state ----
var newScore = {
  score: 50, activity: 0, productivity: 0, quality: 70, timeliness: 70, engagement: 0, reliability: 70,
};
var newMetrics = {
  ticketsClosed: 0, ticketsCreated: 0, ticketsClosedOnTime: 0, ticketsClosedLate: 0,
  avgDaysToClose: 0, openTickets: 0, overdueNow: 0,
  ticketComments: 0, commentsPerTicket: 0, lateEdits: 0,
  ratesAdded: 0, bookings: 0, quotesCreated: 0, quotesSent: 0, quotesAccepted: 0,
  attendedEvents: 0, meetingsCreated: 0, meetingsCheckedIn: 0, meetingShowUpPct: null,
  manualEntries: 0, autoEntries: 0, manualFillRatePct: 0, activeDays: 0, workingDays: 5,
  contactTouches: 0, crmLogEntries: 0, pipelineMoves: 0,
  systemTicketsCreated: 0, systemTicketsFixed: 0, systemTicketsRetested: 0,
  loginCount: 0, expectedLogins: 5, loginRatePct: 0,
  totalActions: 0, onTimePct: null,
};
var newR = lib.explainScore(newScore, newMetrics);
ok('empty: every driver has at least one fallback line',
  newR.drivers.every(function (d) { return d.lines.length >= 1; }));
ok('empty: Activity fallback says something useful',
  /no activity yet|start by/i.test(newR.drivers[0].lines.join(' ')),
  'got: ' + newR.drivers[0].lines.join(' '));
ok('empty: doesn\'t crash', typeof newR.summary === 'string');

// ---- Pluralization ----
var oneTicketMetrics = Object.assign({}, strongMetrics, {
  ticketsClosed: 1, ticketsClosedOnTime: 1, ticketsClosedLate: 0, overdueNow: 1, lateEdits: 1,
  attendedEvents: 1, meetingsCreated: 1, meetingsCheckedIn: 1,
});
var oneR = lib.explainScore(strongScore, oneTicketMetrics);
ok('plural: "1 ticket closed" not "1 tickets closed"',
  JSON.stringify(oneR).indexOf('1 tickets closed') < 0);
ok('plural: "1 meeting organized" not "1 meetings organized"',
  JSON.stringify(oneR).indexOf('1 meetings organized') < 0);
ok('plural: "1 late edit" not "1 late edits"',
  oneR.concerns.indexOf('1 late edits — values changed >24h after creation') < 0);

// ---- Tone classification ----
ok('tone: Activity 85 is "good"', strongR.drivers[0].tone === 'good');
ok('tone: Productivity 25 (weak) is low or poor',
  weakR.drivers[4].tone === 'low' || weakR.drivers[4].tone === 'poor');

// ---- Specific value rendering ----
ok('specific: "12 tickets closed" appears in Productivity',
  strongR.drivers[4].lines.some(function (l) { return /12 tickets closed/i.test(l); }));
ok('specific: "3 of 4 quotes accepted" appears in Quality',
  strongR.drivers[2].lines.some(function (l) { return /3 of 4 quotes accepted/i.test(l); }));

// ---- Wins/concerns are scannable strings ----
ok('wins are short strings',
  strongR.wins.every(function (w) { return typeof w === 'string' && w.length < 120; }));
ok('concerns are short strings',
  weakR.concerns.every(function (c) { return typeof c === 'string' && c.length < 120; }));

console.log('\n=== Results ===');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
process.exit(failed > 0 ? 1 : 0);
