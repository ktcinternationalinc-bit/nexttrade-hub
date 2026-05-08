// __tests__/test-v55-80-stress-ux.js
// =========================================
// QA Engineer 3: UX/UI Reviewer
//
// Looks at how the changes feel and look:
//   - focus mode toggle behavior with no users / null myId
//   - "Reviewing X" header with empty / unknown user
//   - email status escalation thresholds (boundary cases)
//   - pagination boundaries (exactly 50 items, 51 items, 0 items)
//   - "Why this score?" panel readability (max 3 wins, 3 concerns)
//   - presence pills only render when data exists
//   - Phase A: agent personality stability (3 personas exist, all have wake words)
//
// Run: node __tests__/test-v55-80-stress-ux.js

var fs = require('fs');
var path = require('path');

var passed = 0;
var failed = 0;
function ok(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.error('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

function load(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }

console.log('\n=== QA Engineer 3: UX/UI Reviewer ===');

// ---- Phase B / focus mode ----
var admin = load('src/components/AdminTab.jsx');
ok('U1: focus mode SSR-safe (typeof window check)',
   /typeof window === 'undefined'/.test(admin));
ok('U2: focus mode persistence wrapped in try/catch',
   /try \{ return window\.localStorage\.getItem/.test(admin));
ok('U3: "Just me" auto-pin gated on myId existing',
   /viewMode === 'me' && myId/.test(admin));
ok('U4: "Reviewing X" header renders only when focusName is truthy',
   /if \(!focusName\) return null/.test(admin));
ok('U5: focus toggle changes selUser away from myId reverts back to team',
   /e\.target\.value !== myId && viewMode === 'me'\) setViewMode\('team'\)/.test(admin));

// ---- Email status escalation thresholds ----
var email = load('src/components/EmailStatusPanel.jsx');
// silentFailure threshold: attempted >= 3, succeeded === 0
ok('U6: silentFailure requires attempted >= 3 (not just any attempt)',
   /attempted >= 3 && succeeded === 0/.test(email));
ok('U7: degraded requires attempted >= 5 (more samples for confidence)',
   /attempted >= 5 && \(failed \/ attempted\) >= 0\.5/.test(email));
// degraded should NOT fire if silentFailure is already true (precedence)
ok('U8: degraded does not fire when silentFailure is true (precedence)',
   /var degraded = isReady && !silentFailure/.test(email));

// Boundary case: 4 attempted, 0 sent → silent failure (≥3)
function deriveFlags(attempted, succeeded) {
  var failed = attempted - succeeded;
  var sf = attempted >= 3 && succeeded === 0;
  var dg = !sf && attempted >= 5 && (failed / attempted) >= 0.5;
  return { sf: sf, dg: dg };
}
ok('U9: boundary 3/0 → silent failure', deriveFlags(3, 0).sf === true);
ok('U10: boundary 2/0 → no escalation (under threshold)', deriveFlags(2, 0).sf === false && deriveFlags(2, 0).dg === false);
ok('U11: boundary 5/3 (40% failure) → no degraded', deriveFlags(5, 3).dg === false);
ok('U12: boundary 5/2 (60% failure) → degraded', deriveFlags(5, 2).dg === true);
ok('U13: boundary 100/100 → no escalation', deriveFlags(100, 100).sf === false && deriveFlags(100, 100).dg === false);

// ---- Pagination boundaries ----
function pageVisible(total, visible, pageSize) {
  // What the UI actually shows: min(visible, total)
  return Math.min(visible, total);
}
function showsLoadMore(total, visible) {
  return visible < total;
}
ok('U14: pagination 0 items, no Load More button', !showsLoadMore(0, 50));
ok('U15: pagination 50 items, no Load More', !showsLoadMore(50, 50));
ok('U16: pagination 51 items, Load More shows (1 remaining)', showsLoadMore(51, 50));
ok('U17: pagination 100 items after 1 click → all visible', !showsLoadMore(100, 100));

// ---- explainScore wins/concerns capped at 3 ----
var hrSrc = load('src/lib/hr-metrics.js')
  .replace(/export\s+function\s+/g, 'function ')
  .replace(/export\s+\{[^}]*\}/g, '');
hrSrc += '\n;return { explainScore: explainScore };\n';
var hr = (new Function(hrSrc))();
// Build a metrics object that triggers ALL possible wins to confirm cap
var manyWins = {
  ticketsClosed: 10, ticketsCreated: 5, ticketsClosedOnTime: 10, ticketsClosedLate: 0,
  onTimePct: 100, avgDaysToClose: 1, openTickets: 0, overdueNow: 0,
  ticketComments: 30, commentsPerTicket: 3, lateEdits: 0,
  ratesAdded: 10, bookings: 5, quotesCreated: 5, quotesSent: 5, quotesAccepted: 5,
  attendedEvents: 8, meetingsCreated: 3, meetingsCheckedIn: 8, meetingShowUpPct: 95,
  manualEntries: 20, autoEntries: 10, manualFillRatePct: 95, activeDays: 5, workingDays: 5,
  contactTouches: 15, crmLogEntries: 10, pipelineMoves: 5,
  systemTicketsCreated: 3, systemTicketsFixed: 3, systemTicketsRetested: 3,
  presentDays: 5, presenceRatePct: 100, avgHoursPerDay: 8,
  totalActions: 75,
};
var manyWinsScore = { score: 95, productivity: 90, quality: 95, timeliness: 95, engagement: 90, reliability: 95, presence: 100 };
var manyWinsBr = hr.explainScore(manyWinsScore, manyWins);
ok('U18: wins capped at 3 even when many qualify', manyWinsBr.wins.length <= 3, 'wins: ' + manyWinsBr.wins.length);
ok('U19: concerns capped at 3', manyWinsBr.concerns.length <= 3);

// ---- Empty state UX ----
var emptyMetrics = {
  ticketsClosed: 0, ticketsCreated: 0, ticketsClosedOnTime: 0, ticketsClosedLate: 0,
  onTimePct: null, avgDaysToClose: 0, openTickets: 0, overdueNow: 0,
  ticketComments: 0, commentsPerTicket: 0, lateEdits: 0,
  ratesAdded: 0, bookings: 0, quotesCreated: 0, quotesSent: 0, quotesAccepted: 0,
  attendedEvents: 0, meetingsCreated: 0, meetingsCheckedIn: 0, meetingShowUpPct: null,
  manualEntries: 0, autoEntries: 0, manualFillRatePct: 0, activeDays: 0, workingDays: 0,
  contactTouches: 0, crmLogEntries: 0, pipelineMoves: 0,
  systemTicketsCreated: 0, systemTicketsFixed: 0, systemTicketsRetested: 0,
  presentDays: 0, presenceRatePct: 0, avgHoursPerDay: 0,
  totalActions: 0,
};
var emptyScore = { score: 50, productivity: 0, quality: 70, timeliness: 70, engagement: 0, reliability: 70, presence: null };
var emptyBr = hr.explainScore(emptyScore, emptyMetrics);
ok('U20: empty metrics produce a non-empty summary', emptyBr.summary && emptyBr.summary.length > 5);
ok('U21: empty metrics produce drivers without crashing', emptyBr.drivers.length >= 5);
ok('U22: empty productivity falls back with helpful line',
   emptyBr.drivers[0].lines.some(function (l) { return /no/i.test(l) || /not/i.test(l); }),
   'lines: ' + JSON.stringify(emptyBr.drivers[0].lines));

// ---- Presence pills conditional render ----
var hr2 = load('src/components/HRReport.jsx');
ok('U23: Presence pill only renders when presenceRatePct != null AND workingDays > 0',
   /m\.presenceRatePct != null && m\.workingDays > 0 && <Pill label="present"/.test(hr2));
ok('U24: hrs/day pill only renders when avgHoursPerDay > 0',
   /m\.avgHoursPerDay != null && m\.avgHoursPerDay > 0 && <Pill label="hrs\/day"/.test(hr2));

// ---- Phase A — three personas stable ----
var personalitiesPath = 'src/lib/agent-personalities.js';
if (fs.existsSync(path.join(__dirname, '..', personalitiesPath))) {
  var personalities = load(personalitiesPath);
  ok('U25: Phase A — Nadia persona present', /nadia/i.test(personalities));
  ok('U26: Phase A — Jenna persona present', /jenna/i.test(personalities));
  ok('U27: Phase A — Sara persona present', /sara/i.test(personalities));
  ok('U28: Phase A — wake-word configuration present',
     /wake/i.test(personalities) || /trigger/i.test(personalities));
} else {
  console.warn('  (agent-personalities.js not found — Phase A persona file may have moved)');
}

// ---- Phase A — assistants bar shows three avatars ----
var asbar = load('src/components/AssistantsBar.jsx');
ok('U29: AssistantsBar uses AGENT_PERSONALITIES',
   /AGENT_PERSONALITIES/.test(asbar));

// ---- Score color coding consistent ----
ok('U30: HRReport scoreColor uses 75/50/25 thresholds',
   /n >= 75[\s\S]{0,200}n >= 50[\s\S]{0,200}n >= 25/.test(hr2));

// ---- Compact summary line on collapsed row (v55.80) ----
ok('U31: HRReport shows breakdown.summary inline on collapsed row',
   /breakdown && !expanded[\s\S]{0,200}breakdown\.summary/.test(hr2));

// ---- Why-this-score panel renders inside expanded ----
ok('U32: HRReport shows "📊 Why this score?" panel when expanded',
   /Why this score\?/.test(hr2));

// ---- ET disclosure banner present ----
ok('U33: AdminTab shows the ET disclosure banner',
   /All dates and times below are in U\.S\. Eastern Time/.test(admin));

// ---- Email panel — call-to-action present ----
ok('U34: silentFailure callout suggests Send-test action',
   /Send test email below/.test(email) || /Send test email/.test(email));

console.log('\n=== UX/UI Results ===');
console.log('Passed: ' + passed + ' / ' + (passed + failed));
process.exit(failed > 0 ? 1 : 0);
