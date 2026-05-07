// ============================================================
// v55.65 — Comprehensive test suite
//
// Covers:
//   1. hr-metrics: meetingsCreated / meetingsCheckedIn / show-up rate
//   2. hr-metrics: systemTicketsCreated / systemTicketsFixed / retested
//   3. hr-metrics: new 5-axis scoring (productivity/quality/timeliness/engagement/reliability)
//   4. SystemTicketsPanel: fix-in-build modal + retest workflow + new badges
//   5. PersonalDashboard: bugsToRetest fetch + card rendering
//   6. MyPerformance: SVG logo + new metric tiles + system_tickets fetch
//   7. WhatsNewWidget: live bug-fix fetch + grouping by build version
//   8. SQL migration: new columns idempotent
//   9. Carry-forward: v55.62, v55.63, v55.64 changes still present
//  10. Edge cases: empty data, division-by-zero, missing columns, null values
//
// Run: node __tests__/test-v55-65-coach-and-system-tickets.js
// ============================================================

var fs = require('fs');
var path = require('path');
var REPO = path.resolve(__dirname, '..');
var read = function (rel) { return fs.readFileSync(path.join(REPO, rel), 'utf8'); };

var passed = 0, failed = 0;
var failures = [];
function check(label, cond, detail) {
  if (cond) { console.log('  ✓ ' + label); passed++; }
  else { console.log('  ✗ ' + label); failed++; failures.push({ label: label, detail: detail }); if (detail) console.log('     ' + detail); }
}
function group(title) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(title);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

console.log('============================================================');
console.log('v55.65 — Coach + System Tickets Build Pipeline');
console.log('============================================================');

// ============================================================
// 1. hr-metrics extensions
// ============================================================
group('1. hr-metrics — meeting check-ins, system tickets, new scoring');

var hrm = read('src/lib/hr-metrics.js');
check('1.1 hr-metrics tracks meetingsCreated', /meetingsCreated:/.test(hrm) && /createdEvents = calendarEvents\.filter/.test(hrm));
check('1.2 hr-metrics tracks meetingsCheckedIn (using checked_in_by)', /meetingsCheckedIn:/.test(hrm) && /checked_in_by !== userId/.test(hrm));
check('1.3 hr-metrics computes meetingShowUpPct', /meetingShowUpPct/.test(hrm) && /createdAndAttended\.length \/ createdEventsThatHaveOccurred\.length/.test(hrm));
check('1.4 show-up rate returns null when no meetings held (no penalty)', /createdEventsThatHaveOccurred\.length > 0[^?]*\?[^:]*:\s*null/.test(hrm));
check('1.5 systemTicketsCreated counted from data.systemTickets', /systemTicketsCreated:/.test(hrm) && /data\.systemTickets/.test(hrm));
check('1.6 systemTicketsFixed counted (status Fixed/Resolved/Closed or has build version)',
  /systemTicketsFixed/.test(hrm) && /claude_fixed_in_build_version \|\| t\.status === 'Resolved'/.test(hrm));
check('1.7 systemTicketsRetested counted (retest_completed_by === userId)',
  /retest_completed_by === userId && t\.retest_completed_at/.test(hrm));
check('1.8 calcScore returns new 5-axis object',
  /score:.*productivity:.*quality:.*timeliness:.*engagement:.*reliability:/.test(hrm.replace(/\s+/g, ' ')));
check('1.9 score uses weighted formula (0.35/0.15/0.20/0.20/0.10)',
  /productivity \* 0\.35[\s\S]*quality \* 0\.15[\s\S]*timeliness \* 0\.20[\s\S]*engagement \* 0\.20[\s\S]*reliability \* 0\.10/.test(hrm));
check('1.10 quality sub-score uses absolute % (not relative)', /quality_meetingShowup/.test(hrm) && /quality_quoteAccept/.test(hrm));
check('1.11 reliability sub-score includes show-up + retest follow-through',
  /reliability_show/.test(hrm) && /reliability_retest/.test(hrm));
check('1.12 productivity now includes meetingsCreated + systemTicketsCreated',
  /safeRatio\(myMetrics\.meetingsCreated[\s\S]*safeRatio\(myMetrics\.systemTicketsCreated/.test(hrm));
check('1.13 deltas include meetings + system tickets',
  /'meetingsCreated', 'meetingsCheckedIn', 'systemTicketsCreated', 'systemTicketsRetested'/.test(hrm));

// Pure-function behaviour test of calcScore
console.log('\n  -- calcScore pure-function behaviour --');
try {
  var hrModule = require('../src/lib/hr-metrics.js');
  var calcScore = hrModule.calcScore;
  var myMetrics = {
    ticketsClosed: 10, ticketsCreated: 5, ratesAdded: 3, bookings: 2, quotesCreated: 4,
    quotesSent: 4, quotesAccepted: 3,
    meetingsCreated: 8, meetingsCheckedIn: 7, meetingShowUpPct: 87,
    meetingsHeldFromMine: 8,
    systemTicketsCreated: 5, systemTicketsFixed: 4, systemTicketsRetested: 3,
    onTimePct: 90, overdueNow: 0, commentsPerTicket: 1.2,
    manualFillRatePct: 75, attendedEvents: 12, lateEdits: 1,
    crmLogEntries: 5, contactTouches: 3, manualEntries: 15,
  };
  var teamMetrics = [myMetrics, {
    ticketsClosed: 8, ratesAdded: 5, quotesCreated: 6, bookings: 1, ticketsCreated: 3,
    meetingsCreated: 4, attendedEvents: 8, commentsPerTicket: 0.8, meetingsCheckedIn: 4,
    systemTicketsCreated: 2,
  }];
  var s = calcScore(myMetrics, teamMetrics);
  check('1.14 calcScore returns numeric score 0-100', s && typeof s.score === 'number' && s.score >= 0 && s.score <= 100, 'got: ' + JSON.stringify(s));
  check('1.15 calcScore includes all 5 sub-scores',
    s && typeof s.productivity === 'number' && typeof s.quality === 'number'
    && typeof s.timeliness === 'number' && typeof s.engagement === 'number'
    && typeof s.reliability === 'number');
  check('1.16 high performer scores well (>50)', s && s.score > 50, 'got score: ' + (s && s.score));
  check('1.17 reliability reflects 87% show-up + 75% retest rate', s && s.reliability >= 70, 'got reliability: ' + (s && s.reliability));

  // Edge case: empty inputs
  var sNull = calcScore(null, []);
  check('1.18 calcScore handles null myMetrics', sNull === null);

  var sEmptyTeam = calcScore({ ticketsClosed: 0 }, []);
  check('1.19 calcScore handles empty team', sEmptyTeam && sEmptyTeam.score === null);

  // Edge case: division by zero
  var sZero = calcScore({
    ticketsClosed: 0, ratesAdded: 0, quotesCreated: 0, bookings: 0, ticketsCreated: 0,
    quotesSent: 0, quotesAccepted: 0, meetingsCreated: 0, meetingsCheckedIn: 0,
    meetingShowUpPct: null, meetingsHeldFromMine: 0,
    systemTicketsCreated: 0, systemTicketsFixed: 0, systemTicketsRetested: 0,
    onTimePct: null, overdueNow: 0, commentsPerTicket: 0, manualFillRatePct: 0,
    attendedEvents: 0, lateEdits: 0,
  }, [{ ticketsClosed: 0 }]);
  check('1.20 calcScore handles all-zero metrics without NaN/Infinity',
    sZero && Number.isFinite(sZero.score) && Number.isFinite(sZero.productivity),
    'got: ' + JSON.stringify(sZero));

  // Test calcMetricsForUser handles missing systemTickets gracefully (older callers)
  var calcMetricsForUser = hrModule.calcMetricsForUser;
  var resolvePeriod = hrModule.resolvePeriod;
  var period = resolvePeriod('30d');
  var legacy = calcMetricsForUser('u1', period, {
    tickets: [], ticketComments: [], dailyLog: [], auditLog: [],
    customerQuotes: [], calendarEvents: [], customers: [],
    // systemTickets intentionally missing
  });
  check('1.21 calcMetricsForUser gracefully handles missing data.systemTickets',
    legacy && legacy.systemTicketsCreated === 0 && legacy.systemTicketsFixed === 0);

  // Test meeting checked_in_by tracking
  var withMeetings = calcMetricsForUser('u1', period, {
    tickets: [], ticketComments: [], dailyLog: [], auditLog: [],
    customerQuotes: [], customers: [], systemTickets: [],
    calendarEvents: [
      { id: 'e1', created_by: 'u1', assigned_to: 'u1', event_date: period.from, status: 'active', checked_in_by: 'u1', event_status: 'attended' },
      { id: 'e2', created_by: 'u1', assigned_to: 'u1', event_date: period.from, status: 'active' /* no check-in */ },
      { id: 'e3', created_by: 'u2', assigned_to: 'u1', event_date: period.from, status: 'active', checked_in_by: 'u1' },
      { id: 'e4', created_by: 'u1', assigned_to: 'u2', event_date: period.from, status: 'cancelled' },
    ],
  });
  check('1.22 meetingsCreated counts events created_by user (excludes cancelled)',
    withMeetings.meetingsCreated === 2, 'got: ' + withMeetings.meetingsCreated);
  check('1.23 meetingsCheckedIn counts events checked_in_by user',
    withMeetings.meetingsCheckedIn === 2, 'got: ' + withMeetings.meetingsCheckedIn);
  check('1.24 show-up rate computes correctly (1 of 2 created met)',
    withMeetings.meetingShowUpPct === 50,
    'expected 50, got: ' + withMeetings.meetingShowUpPct);

  // Edge case: meetings created but none have happened yet (all future-dated)
  var futureMtgs = calcMetricsForUser('u1', period, {
    tickets: [], ticketComments: [], dailyLog: [], auditLog: [],
    customerQuotes: [], customers: [], systemTickets: [],
    calendarEvents: [
      { id: 'e1', created_by: 'u1', assigned_to: 'u1', event_date: '2099-12-31', status: 'active' },
    ],
  });
  check('1.25 future-dated meetings yield null show-up rate (no penalty)',
    futureMtgs.meetingShowUpPct === null,
    'got: ' + futureMtgs.meetingShowUpPct);

} catch (e) {
  check('1.14-1.25 hr-metrics runtime tests', false, 'Could not require module: ' + e.message);
}

// ============================================================
// 2. SystemTicketsPanel — fix-in-build + retest UI
// ============================================================
group('2. SystemTicketsPanel — fix-in-build modal + retest workflow');

var stp = read('src/components/SystemTicketsPanel.jsx');
check('2.1 has openFixModal helper', /openFixModal\s*=\s*function/.test(stp));
check('2.2 has saveFix helper that sets needs_retest=true', /saveFix\s*=\s*async function/.test(stp) && /needs_retest:\s*true/.test(stp));
check('2.3 saveFix sets claude_fixed_in_build_version + claude_fix_notes', /claude_fixed_in_build_version:\s*fixModal\.version/.test(stp) && /claude_fix_notes:\s*fixModal\.notes/.test(stp));
check('2.4 saveFix clears claude_review_requested after fix shipped', /claude_review_requested:\s*false/.test(stp));
check('2.5 saveFix sets status to Fixed', /status:\s*'Fixed'/.test(stp));
check('2.6 has openRetestModal + saveRetest helpers', /openRetestModal/.test(stp) && /saveRetest/.test(stp));
check('2.7 retest "passed" closes ticket', /retestModal\.outcome === 'passed'[\s\S]{0,200}status\s*=\s*'Closed'/.test(stp));
check('2.8 retest "failed" reopens + re-flags for Claude', /retestModal\.outcome === 'failed'[\s\S]{0,400}claude_review_requested\s*=\s*true/.test(stp) && /status\s*=\s*'Reopened'/.test(stp));
check('2.9 retest button only renders for the original creator', /t\.created_by === userId/.test(stp));
check('2.10 retest button only shown when needs_retest=true', /t\.needs_retest && t\.created_by === userId/.test(stp));
check('2.11 admin "Mark fixed in build" button visible', /Mark fixed in build/.test(stp));
check('2.12 build version badge shown when set', /claude_fixed_in_build_version[\s\S]{0,300}📦/.test(stp));
check('2.13 "Please retest" pulsing badge for creator', /animate-pulse[\s\S]{0,100}Please retest/.test(stp));
check('2.14 retest outcome badges (passed/failed/partial)',
  /retest_outcome === 'passed'/.test(stp) && /retest_outcome === 'failed'/.test(stp) && /retest_outcome === 'partial'/.test(stp));
check('2.15 retest modal has 3 outcome buttons',
  /Works perfectly[\s\S]*Partly works[\s\S]*Still broken/.test(stp));
check('2.16 Tailwind classes are LITERAL (not template strings) so JIT picks them up',
  !/className=\{[^}]*'border-' \+/.test(stp),
  'Found dynamic class string concatenation — Tailwind JIT will skip those');
check('2.17 retest_notes panel shows reviewer name', /RETEST NOTES[\s\S]{0,80}getUserName && getUserName\(t\.retest_completed_by\)/.test(stp));

// ============================================================
// 3. PersonalDashboard — bugsToRetest card
// ============================================================
group('3. PersonalDashboard — Bugs to Retest card');

var pd = read('src/components/PersonalDashboard.jsx');
check('3.1 has bugsToRetest state', /\[bugsToRetest, setBugsToRetest\]/.test(pd));
check('3.2 fetches system_tickets where created_by=me AND needs_retest=true',
  /from\('system_tickets'\)[\s\S]{0,300}\.eq\('created_by', pid\)[\s\S]{0,200}\.eq\('needs_retest', true\)/.test(pd));
check('3.3 fetch is in independent try/catch (won\'t kill dashboard)',
  /try \{[\s\S]{0,400}from\('system_tickets'\)[\s\S]{0,400}catch \(err\)/.test(pd));
check('3.4 card only renders when bugsToRetest.length > 0',
  /bugsToRetest && bugsToRetest\.length > 0/.test(pd));
check('3.5 card shows build version + fix date per bug',
  /claude_fixed_in_build_version[\s\S]{0,200}claude_last_fixed_at/.test(pd));
check('3.6 card has prominent CTA button', /Open System Tickets/.test(pd));
check('3.7 caps display to 5 with "and N more"', /bugsToRetest\.slice\(0, 5\)/.test(pd) && /more — see System Tickets/.test(pd));

// ============================================================
// 4. MyPerformance — logo, expanded default, new tiles
// ============================================================
group('4. MyPerformance — logo, defaults, new tiles');

var mp = read('src/components/MyPerformance.jsx');
check('4.1 expanded defaults to true (visible by default)', /useState\(true\); \/\/ map of version[\s\S]*$/.test(mp) || /const \[expanded, setExpanded\] = useState\(true\)/.test(mp));
check('4.2 inline SVG logo present', /<svg width="44" height="44" viewBox="0 0 44 44"/.test(mp));
check('4.3 logo has gradient + bars + bubble', /linearGradient id="mp-grad-bg"/.test(mp) && /<rect x="9"/.test(mp) && /<circle cx="34" cy="11"/.test(mp));
check('4.4 fetches system_tickets in load', /from\('system_tickets'\)/.test(mp));
check('4.5 system_tickets fetch is OR-ed for created_by + retest_completed_by',
  /\.or\('created_by\.eq\.' \+ myId \+ ',retest_completed_by\.eq\.' \+ myId\)/.test(mp));
check('4.6 new metric tiles: meetings created/attended/checked-in',
  /Meetings You Set Up/.test(mp) && /Meetings Attended/.test(mp) && /Meetings You Signed Into/.test(mp));
check('4.7 show-up rate tile color-codes by threshold',
  /meetingShowUpPct >= 80 \? 'emerald' : current\.meetingShowUpPct >= 50 \? 'amber' : 'rose'/.test(mp));
check('4.8 bug-reports tile shown only when systemTicketsCreated > 0',
  /systemTicketsCreated \|\| 0\) > 0[\s\S]{0,150}Bug Reports Filed/.test(mp));
check('4.9 retest tile shown only when systemTicketsRetested > 0',
  /systemTicketsRetested \|\| 0\) > 0[\s\S]{0,150}Bugs You Retested/.test(mp));
check('4.10 systemTickets passed into setData', /setData\(\{ tickets, ticketComments, dailyLog, auditLog, customerQuotes, calendarEvents, systemTickets \}\)/.test(mp));

// ============================================================
// 5. WhatsNewWidget — live bug-fix fetch + grouping
// ============================================================
group('5. WhatsNewWidget — live bug fixes + carry-forward');

var wnw = read('src/components/WhatsNewWidget.jsx');
check('5.1 imports supabase', /import \{ supabase \} from '\.\.\/lib\/supabase'/.test(wnw));
check('5.2 has bugsByBuild state', /\[bugsByBuild, setBugsByBuild\]/.test(wnw));
check('5.3 fetches system_tickets with claude_fixed_in_build_version IS NOT NULL',
  /\.not\('claude_fixed_in_build_version', 'is', null\)/.test(wnw));
check('5.4 fetch is in try/catch (silent fail on missing table)',
  /\(async function \(\)[\s\S]{0,80}try \{[\s\S]{0,800}from\('system_tickets'\)[\s\S]{0,800}\} catch \(e\)/.test(wnw));
check('5.5 bugs grouped by build version', /grouped\[v\] = \[\][\s\S]{0,150}grouped\[v\]\.push/.test(wnw));
check('5.6 renders bug fixes inside expanded panel', /Bug fixes shipped in this build/.test(wnw));
check('5.7 retest_outcome badge rendered (verified vs failed)', /retest_outcome === 'passed'[\s\S]{0,100}verified/.test(wnw));
check('5.8 v55.65 entry at top of BUILD_HISTORY', /version: 'v55\.65'/.test(wnw));
check('5.9 v55.64 still in BUILD_HISTORY (carry-forward)', /version: 'v55\.64'/.test(wnw));
check('5.10 v55.62 still in BUILD_HISTORY (carry-forward)', /version: 'v55\.62'/.test(wnw));
check('5.11 v55.65 entry mentions logo', /logo/i.test(wnw.match(/version: 'v55\.65'[\s\S]*?\}/)[0]));
check('5.12 v55.65 entry mentions retest workflow', /retest/i.test(wnw.match(/version: 'v55\.65'[\s\S]*?\}/)[0]));
check('5.13 v55.65 entry references SQL file s40', /s40_system_tickets_retest/.test(wnw));
check('5.14 100-build display cap preserved', /DISPLAY_LIMIT = 100/.test(wnw));
check('5.15 since-last-seen tracking preserved', /STORAGE_KEY = 'ktc_whatsnew_last_seen_version'/.test(wnw));

// ============================================================
// 6. SQL migration
// ============================================================
group('6. SQL — system_tickets retest columns');

var sqlNew = fs.existsSync(path.join(REPO, 'sql/s40_system_tickets_retest.sql'))
  ? read('sql/s40_system_tickets_retest.sql') : '';
check('6.1 sql/s40_system_tickets_retest.sql exists', sqlNew.length > 0);
check('6.2 adds claude_fixed_in_build_version', /ADD COLUMN IF NOT EXISTS claude_fixed_in_build_version TEXT/.test(sqlNew));
check('6.3 adds needs_retest BOOLEAN', /ADD COLUMN IF NOT EXISTS needs_retest BOOLEAN/.test(sqlNew));
check('6.4 adds retest_completed_at + _by', /retest_completed_at TIMESTAMPTZ/.test(sqlNew) && /retest_completed_by UUID/.test(sqlNew));
check('6.5 adds retest_outcome with CHECK constraint', /retest_outcome TEXT[\s\S]{0,120}CHECK[\s\S]{0,80}\('passed', 'failed', 'partial'\)/.test(sqlNew));
check('6.6 adds index on needs_retest WHERE TRUE', /CREATE INDEX IF NOT EXISTS idx_system_tickets_needs_retest[\s\S]{0,120}WHERE needs_retest = TRUE/.test(sqlNew));
check('6.7 adds index on claude_fixed_in_build_version', /CREATE INDEX IF NOT EXISTS idx_system_tickets_fixed_in_build/.test(sqlNew));
check('6.8 ALL statements use IF NOT EXISTS (safe re-run)',
  !/ADD COLUMN(?! IF NOT EXISTS)/.test(sqlNew),
  'Found ADD COLUMN without IF NOT EXISTS guard');

// Consolidated setup file should also pick up new columns
var sqlSetup = read('supabase/system-tickets-setup.sql');
check('6.9 system-tickets-setup.sql also has new columns (consolidated)',
  /claude_fixed_in_build_version/.test(sqlSetup) && /needs_retest/.test(sqlSetup));

// ============================================================
// 7. Carry-forward — v55.62 + v55.63 + v55.64 changes intact
// ============================================================
group('7. Carry-forward checks (v55.62 + v55.63 + v55.64)');

var srt = read('src/components/ShippingRatesTab.jsx');
check('7.1 v55.63 POL/POD filter state present', /filterPol/.test(srt) && /filterPod/.test(srt));
check('7.2 v55.63 groupByPort logic present', /groupByPort = filterPod !== 'all' \|\| filterPol !== 'all'/.test(srt));
check('7.3 v55.63 POL/POD/ETD/TT/FT columns in route detail',
  />POL</.test(srt) && />POD</.test(srt) && />ETD</.test(srt) && />TT</.test(srt) && />FT</.test(srt));
check('7.4 v55.63 Clear ports button',  /Clear ports/.test(srt));

var ct = read('src/components/CustomsTab.jsx');
check('7.5 v55.64 Customs import present', /openImport/.test(ct) && /downloadTemplate/.test(ct));
check('7.6 v55.64 Customs template has Shipment Reference as first column',
  /TEMPLATE_COLUMNS = \[[\s\S]{0,80}reference_number[\s\S]{0,80}Shipment Reference/.test(ct));
check('7.7 v55.64 Customs import preview has cell editing + validation',
  /updateImportCell/.test(ct) && /validateImport/.test(ct) && /importErrors/.test(ct));
check('7.8 v55.64 Customs import handles Excel date numbers',
  /XLSX\.SSF\.parse_date_code/.test(ct));
check('7.9 v55.64 Customs import accepts header aliases',
  /'b\/l': 'reference_number'/.test(ct) && /'invoice number': 'reference_number'/.test(ct));

var au = fs.existsSync(path.join(REPO, 'src/lib/active-users.js')) ? read('src/lib/active-users.js') : '';
check('7.10 v55.62 active-users helper still present + handles null',
  /isActiveUser/.test(au) && /active === null/.test(au));

// ============================================================
// 8. Integration: end-to-end flow
// ============================================================
group('8. End-to-end flow simulation');

// Simulate: admin marks a ticket fixed in build → creator sees retest card → retests
var adminFlow = stp.match(/saveFix\s*=\s*async function[\s\S]{0,800}/);
check('8.1 admin saveFix sets all required fields for full workflow',
  adminFlow && /needs_retest:\s*true/.test(adminFlow[0])
  && /claude_fixed_in_build_version/.test(adminFlow[0])
  && /claude_fix_notes/.test(adminFlow[0])
  && /claude_last_fixed_at/.test(adminFlow[0]));

var creatorFlow = stp.match(/saveRetest\s*=\s*async function[\s\S]{0,1500}/);
check('8.2 creator saveRetest clears needs_retest', creatorFlow && /needs_retest:\s*false/.test(creatorFlow[0]));
check('8.3 creator saveRetest records who and when', creatorFlow && /retest_completed_at/.test(creatorFlow[0]) && /retest_completed_by/.test(creatorFlow[0]));

// Dashboard pulls only own bugs
check('8.4 PersonalDashboard scopes to own user', /\.eq\('created_by', pid\)/.test(pd));

// What's New auto-pulls them
check('8.5 WhatsNew sees them post-fix',  /from\('system_tickets'\)[\s\S]{0,400}claude_fixed_in_build_version/.test(wnw));

// HR metrics counts them in scoring
check('8.6 hr-metrics counts the bug toward systemTicketsFixed',
  /systemTicketsFixed = systemTicketsCreated\.filter[\s\S]{0,200}claude_fixed_in_build_version/.test(hrm));

// ============================================================
// 9. Summary
// ============================================================
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('SUMMARY');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach(function (f, i) { console.log('  ' + (i + 1) + '. ' + f.label); if (f.detail) console.log('     ' + f.detail); });
  process.exit(1);
} else {
  console.log('\n✅ All ' + passed + ' tests passed');
  process.exit(0);
}
