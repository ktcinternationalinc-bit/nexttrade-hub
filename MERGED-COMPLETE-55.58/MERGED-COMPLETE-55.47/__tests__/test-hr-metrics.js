// Test suite for src/lib/hr-metrics.js
// Run with: node __tests__/test-hr-metrics.js
// Standalone — no Jest, just plain assertions, prints PASS/FAIL summary.

import {
  resolvePeriod,
  resolvePriorPeriod,
  inPeriod,
  countWorkingDaysInPeriod,
  calcMetricsForUser,
  calcScore,
  computeDeltas,
} from '../src/lib/hr-metrics.js';

let passed = 0, failed = 0;
const errors = [];

function assert(cond, label) {
  if (cond) { passed++; }
  else { failed++; errors.push(label); console.log('  ✗ ' + label); }
}

function eq(a, b, label) { assert(a === b, label + ' (got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b) + ')'); }
function close(a, b, tol, label) { assert(Math.abs(a - b) <= (tol || 0.01), label + ' (got ' + a + ', expected ~' + b + ')'); }

console.log('\n========================================');
console.log('HR METRICS ENGINE TEST SUITE');
console.log('========================================\n');

// ----------------------------------------------------------------------
// Section 1: Period resolution
// ----------------------------------------------------------------------
console.log('Section 1: resolvePeriod / resolvePriorPeriod');

const p7 = resolvePeriod('7d');
eq(p7.days, 7, 'S1.1 — 7d period spans 7 days');
assert(p7.from < p7.to || p7.from === p7.to, 'S1.2 — 7d period from <= to');

const pYesterday = resolvePeriod('yesterday');
eq(pYesterday.days, 1, 'S1.3 — yesterday is 1 day');
eq(pYesterday.from, pYesterday.to, 'S1.4 — yesterday from === to');

const p30 = resolvePeriod('30d');
eq(p30.days, 30, 'S1.5 — 30d is 30 days');

const p3mo = resolvePeriod('3mo');
eq(p3mo.days, 90, 'S1.6 — 3mo is 90 days');

const p1y = resolvePeriod('1y');
eq(p1y.days, 365, 'S1.7 — 1y is 365 days');

const pCustom = resolvePeriod('custom', { from: '2026-04-01', to: '2026-04-10' });
eq(pCustom.days, 10, 'S1.8 — custom 4/1 to 4/10 is 10 days');
eq(pCustom.from, '2026-04-01', 'S1.9 — custom from preserved');
eq(pCustom.to, '2026-04-10', 'S1.10 — custom to preserved');

const prior = resolvePriorPeriod({ from: '2026-04-08', to: '2026-04-14', days: 7 });
eq(prior.from, '2026-04-01', 'S1.11 — prior of 4/8-4/14 starts 4/1');
eq(prior.to, '2026-04-07', 'S1.12 — prior of 4/8-4/14 ends 4/7');
eq(prior.days, 7, 'S1.13 — prior period same length as current');

// ----------------------------------------------------------------------
// Section 2: inPeriod & working days
// ----------------------------------------------------------------------
console.log('\nSection 2: inPeriod helpers');

const period = { from: '2026-04-01', to: '2026-04-07', days: 7 };
assert(inPeriod('2026-04-03', period), 'S2.1 — date inside period');
assert(inPeriod('2026-04-01T10:00:00', period), 'S2.2 — timestamp on first day');
assert(inPeriod('2026-04-07T23:59:59', period), 'S2.3 — timestamp on last day');
assert(!inPeriod('2026-03-31', period), 'S2.4 — date before period excluded');
assert(!inPeriod('2026-04-08', period), 'S2.5 — date after period excluded');
assert(!inPeriod(null, period), 'S2.6 — null date never in period');

// 2026-04-01 is a Wednesday. Apr 1-7 = Wed, Thu, Fri, Sat, Sun, Mon, Tue → 5 weekdays
const wd = countWorkingDaysInPeriod(period);
eq(wd, 5, 'S2.7 — Apr 1-7 2026 has 5 working days (Mon-Fri)');

const wd1 = countWorkingDaysInPeriod({ from: '2026-04-04', to: '2026-04-05' });
eq(wd1, 1, 'S2.8 — Sat-Sun has 0 working days but minimum 1 returned');

// ----------------------------------------------------------------------
// Section 3: Ticket metrics
// ----------------------------------------------------------------------
console.log('\nSection 3: Ticket metrics');

const USER_A = 'aaaa1111-aaaa-1111-aaaa-111111111111';
const USER_B = 'bbbb2222-bbbb-2222-bbbb-222222222222';

const period30 = { from: '2026-04-01', to: '2026-04-30', days: 30 };

const tickets = [
  // user A created 3 tickets in period, closed 2 of them on time
  { id: 't1', created_by: USER_A, assigned_to: USER_A, closed_by: USER_A, status: 'Closed',
    created_at: '2026-04-02T10:00:00Z', closed_at: '2026-04-05T10:00:00Z', due_date: '2026-04-10' },
  { id: 't2', created_by: USER_A, assigned_to: USER_A, closed_by: USER_A, status: 'Closed',
    created_at: '2026-04-03T10:00:00Z', closed_at: '2026-04-08T10:00:00Z', due_date: '2026-04-09' },
  { id: 't3', created_by: USER_A, assigned_to: USER_A, status: 'In Progress',
    created_at: '2026-04-15T10:00:00Z', due_date: '2026-04-20' },
  // user B created 1, closed 1 LATE
  { id: 't4', created_by: USER_B, assigned_to: USER_B, closed_by: USER_B, status: 'Closed',
    created_at: '2026-04-01T10:00:00Z', closed_at: '2026-04-15T10:00:00Z', due_date: '2026-04-05' },
  // overdue and open assigned to A
  { id: 't5', assigned_to: USER_A, status: 'In Progress',
    created_at: '2026-03-01T10:00:00Z', due_date: '2026-03-15' },
];

const mA = calcMetricsForUser(USER_A, period30, { tickets });
eq(mA.ticketsCreated, 3, 'S3.1 — User A created 3 tickets in period');
eq(mA.ticketsClosed, 2, 'S3.2 — User A closed 2 tickets in period');
eq(mA.ticketsClosedOnTime, 2, 'S3.3 — User A both closures were on time');
eq(mA.onTimePct, 100, 'S3.4 — User A on-time pct = 100');
assert(mA.overdueNow >= 1, 'S3.5 — User A has at least 1 overdue ticket open now');

const mB = calcMetricsForUser(USER_B, period30, { tickets });
eq(mB.ticketsClosed, 1, 'S3.6 — User B closed 1 ticket');
eq(mB.ticketsClosedOnTime, 0, 'S3.7 — User B closed 0 on time');
eq(mB.ticketsClosedLate, 1, 'S3.8 — User B closed 1 late');
eq(mB.onTimePct, 0, 'S3.9 — User B on-time pct = 0');

// User C closed nothing — onTimePct should be null (don't punish)
const mC = calcMetricsForUser('cccc-no-tickets', period30, { tickets });
eq(mC.onTimePct, null, 'S3.10 — User with 0 closures has null on-time pct');

// ----------------------------------------------------------------------
// Section 4: Ticket comments / engagement
// ----------------------------------------------------------------------
console.log('\nSection 4: Ticket comment engagement');

const ticketComments = [
  { ticket_id: 't1', created_by: USER_A, created_at: '2026-04-04T10:00:00Z' },
  { ticket_id: 't1', created_by: USER_A, created_at: '2026-04-05T08:00:00Z' },
  { ticket_id: 't2', created_by: USER_A, created_at: '2026-04-06T10:00:00Z' },
  { ticket_id: 't1', created_by: USER_B, created_at: '2026-04-04T11:00:00Z' },
];

const mAComm = calcMetricsForUser(USER_A, period30, { tickets, ticketComments });
eq(mAComm.ticketComments, 3, 'S4.1 — User A wrote 3 comments in period');
// User A is assigned to 4 tickets (t1, t2, t3, t5) → 3 comments / 4 = 0.75 → 0.8
close(mAComm.commentsPerTicket, 0.8, 0.01, 'S4.2 — User A comments-per-ticket = 0.8 (3 comments / 4 assigned)');

// ----------------------------------------------------------------------
// Section 5: Shipping rates + bookings via audit log
// ----------------------------------------------------------------------
console.log('\nSection 5: Shipping rates / bookings');

const auditLog = [
  // User A added 2 rates
  { table_name: 'shipping_rates', action: 'create', changed_by: USER_A, created_at: '2026-04-05T10:00:00Z' },
  { table_name: 'shipping_rates', action: 'create', changed_by: USER_A, created_at: '2026-04-12T10:00:00Z' },
  // User A booked 1
  { table_name: 'shipping_rates', action: 'update', changed_by: USER_A, created_at: '2026-04-15T10:00:00Z',
    new_values: { booked: true } },
  // User B added 1
  { table_name: 'shipping_rates', action: 'create', changed_by: USER_B, created_at: '2026-04-08T10:00:00Z' },
  // out-of-period
  { table_name: 'shipping_rates', action: 'create', changed_by: USER_A, created_at: '2026-03-01T10:00:00Z' },
  // pipeline move on customer (used in S6)
  { table_name: 'customers', action: 'update', changed_by: USER_A, created_at: '2026-04-10T10:00:00Z',
    old_values: { pipeline_stage: 'lead' }, new_values: { pipeline_stage: 'qualified' } },
  // pipeline NOT a move (same stage)
  { table_name: 'customers', action: 'update', changed_by: USER_A, created_at: '2026-04-11T10:00:00Z',
    old_values: { pipeline_stage: 'qualified' }, new_values: { name: 'updated' } },
  // contact touch
  { table_name: 'customers', action: 'update', changed_by: USER_A, created_at: '2026-04-12T10:00:00Z',
    old_values: {}, new_values: { last_contact_date: '2026-04-12' } },
];

const mARates = calcMetricsForUser(USER_A, period30, { tickets, auditLog });
eq(mARates.ratesAdded, 2, 'S5.1 — User A added 2 rates in period');
eq(mARates.bookings, 1, 'S5.2 — User A booked 1 rate in period');

// ----------------------------------------------------------------------
// Section 6: CRM (pipeline moves, contact touches)
// ----------------------------------------------------------------------
console.log('\nSection 6: CRM metrics');

const mACRM = calcMetricsForUser(USER_A, period30, { tickets, auditLog });
eq(mACRM.pipelineMoves, 1, 'S6.1 — User A moved 1 customer in pipeline');
eq(mACRM.contactTouches, 1, 'S6.2 — User A logged 1 contact touch');

// ----------------------------------------------------------------------
// Section 7: Quotes
// ----------------------------------------------------------------------
console.log('\nSection 7: Quotes');

const customerQuotes = [
  { id: 'q1', created_by: USER_A, status: 'sent', created_at: '2026-04-05T10:00:00Z' },
  { id: 'q2', created_by: USER_A, status: 'accepted', created_at: '2026-04-12T10:00:00Z' },
  { id: 'q3', created_by: USER_A, status: 'draft', created_at: '2026-04-15T10:00:00Z' },
  { id: 'q4', created_by: USER_B, status: 'sent', created_at: '2026-04-08T10:00:00Z' },
  { id: 'q5', created_by: USER_A, status: 'sent', created_at: '2026-03-01T10:00:00Z' }, // out
];

const mAQuote = calcMetricsForUser(USER_A, period30, { tickets, customerQuotes });
eq(mAQuote.quotesCreated, 3, 'S7.1 — User A created 3 quotes in period');
eq(mAQuote.quotesSent, 2, 'S7.2 — User A had 2 quotes sent or accepted');
eq(mAQuote.quotesAccepted, 1, 'S7.3 — User A had 1 quote accepted');

// ----------------------------------------------------------------------
// Section 8: Daily log
// ----------------------------------------------------------------------
console.log('\nSection 8: Daily log fill rate');

const dailyLog = [
  // User A wrote manual entries on 4 different weekdays
  { user_id: USER_A, log_date: '2026-04-01', auto_generated: false }, // Wed
  { user_id: USER_A, log_date: '2026-04-02', auto_generated: false }, // Thu
  { user_id: USER_A, log_date: '2026-04-06', auto_generated: false }, // Mon
  { user_id: USER_A, log_date: '2026-04-07', auto_generated: false }, // Tue
  // and a bunch of auto-generated
  { user_id: USER_A, log_date: '2026-04-01', auto_generated: true },
  { user_id: USER_A, log_date: '2026-04-03', auto_generated: true }, // Fri
];

const periodApr1to7 = { from: '2026-04-01', to: '2026-04-07', days: 7 };
const mLog = calcMetricsForUser(USER_A, periodApr1to7, { tickets: [], dailyLog });
eq(mLog.manualEntries, 4, 'S8.1 — 4 manual entries');
eq(mLog.autoEntries, 2, 'S8.2 — 2 auto entries');
eq(mLog.manualDays, 4, 'S8.3 — 4 unique days with manual entries');
// 5 working days in period, 4 manual = 80%
eq(mLog.manualFillRatePct, 80, 'S8.4 — manual fill rate = 80%');

// ----------------------------------------------------------------------
// Section 9: Calendar
// ----------------------------------------------------------------------
console.log('\nSection 9: Calendar attendance');

const calendarEvents = [
  // User A is owner + attendee of 2 events, completed 1
  { id: 'e1', assigned_to: USER_A, attendees: [USER_A, USER_B], event_date: '2026-04-05', completed: true,
    declined_by: [], status: 'scheduled' },
  { id: 'e2', assigned_to: USER_A, attendees: [USER_A], event_date: '2026-04-10', completed: false,
    declined_by: [], status: 'scheduled' },
  // User A invited only as attendee
  { id: 'e3', assigned_to: USER_B, attendees: [USER_A, USER_B], event_date: '2026-04-12', completed: false,
    declined_by: [], status: 'scheduled' },
  // User A declined this one
  { id: 'e4', assigned_to: USER_B, attendees: [USER_A, USER_B], event_date: '2026-04-14', completed: false,
    declined_by: [USER_A], status: 'scheduled' },
  // cancelled — ignore
  { id: 'e5', assigned_to: USER_A, attendees: [USER_A], event_date: '2026-04-15', completed: false,
    declined_by: [], status: 'cancelled' },
];

const mCal = calcMetricsForUser(USER_A, period30, { tickets: [], calendarEvents });
eq(mCal.assignedEvents, 2, 'S9.1 — User A is owner of 2 active events');
eq(mCal.completedEvents, 1, 'S9.2 — 1 of those is completed');
eq(mCal.attendedEvents, 4, 'S9.3 — User A attendee of 4 events');
eq(mCal.declinedEvents, 1, 'S9.4 — User A declined 1 event');

// ----------------------------------------------------------------------
// Section 10: Score calculation
// ----------------------------------------------------------------------
console.log('\nSection 10: Score formula');

const teamA = calcMetricsForUser(USER_A, period30, {
  tickets, ticketComments, auditLog, customerQuotes,
  dailyLog, calendarEvents, customers: [],
});
const teamB = calcMetricsForUser(USER_B, period30, {
  tickets, ticketComments, auditLog, customerQuotes,
  dailyLog, calendarEvents, customers: [],
});

const scoreA = calcScore(teamA, [teamA, teamB]);
const scoreB = calcScore(teamB, [teamA, teamB]);
assert(scoreA.score >= 0 && scoreA.score <= 100, 'S10.1 — Score A within 0-100');
assert(scoreB.score >= 0 && scoreB.score <= 100, 'S10.2 — Score B within 0-100');
assert(scoreA.productivity >= scoreB.productivity, 'S10.3 — A more productive than B (created/closed more)');
assert(scoreA.timeliness > scoreB.timeliness, 'S10.4 — A more timely (closed on time vs B late)');

// Empty team — should not crash
const emptyScore = calcScore(teamA, []);
eq(emptyScore.score, null, 'S10.5 — Empty team yields null score');

// Null user metrics — should not crash
const nullScore = calcScore(null, [teamA]);
eq(nullScore, null, 'S10.6 — null user metrics yields null');

// ----------------------------------------------------------------------
// Section 11: Period-over-period deltas
// ----------------------------------------------------------------------
console.log('\nSection 11: Deltas');

const delta = computeDeltas(
  { ticketsClosed: 10, ticketsCreated: 5, ratesAdded: 3, bookings: 1, quotesCreated: 2,
    ticketComments: 8, manualEntries: 12, pipelineMoves: 2, attendedEvents: 6, totalActions: 47 },
  { ticketsClosed: 5, ticketsCreated: 5, ratesAdded: 6, bookings: 0, quotesCreated: 1,
    ticketComments: 4, manualEntries: 10, pipelineMoves: 1, attendedEvents: 3, totalActions: 30 }
);

eq(delta.ticketsClosed.diff, 5, 'S11.1 — closed went up by 5');
eq(delta.ticketsClosed.pct, 100, 'S11.2 — closed up 100%');
eq(delta.ticketsCreated.diff, 0, 'S11.3 — created flat');
eq(delta.ticketsCreated.pct, 0, 'S11.4 — created 0% change');
eq(delta.ratesAdded.diff, -3, 'S11.5 — rates dropped by 3');
assert(delta.ratesAdded.pct < 0, 'S11.6 — rates pct negative');
eq(delta.bookings.pct, 100, 'S11.7 — bookings: from 0 to 1 → 100%');

// ----------------------------------------------------------------------
// SUMMARY
// ----------------------------------------------------------------------
console.log('\n========================================');
console.log('TOTAL: ' + (passed + failed) + ' assertions');
console.log('PASSED: ' + passed);
console.log('FAILED: ' + failed);
console.log('========================================\n');

if (failed > 0) {
  console.log('FAILURES:');
  errors.forEach(function (e) { console.log('  • ' + e); });
  process.exit(1);
}
console.log('✓ All HR metrics tests passing.\n');
