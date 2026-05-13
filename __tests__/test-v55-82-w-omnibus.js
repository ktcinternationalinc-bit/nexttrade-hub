// ============================================================
// v55.82-W — Max May 12 2026 omnibus (11 items)
// ============================================================
var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) { console.log('✓ ' + label); }
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

var tickets   = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'TicketsTab.jsx'), 'utf8');
var greeter   = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'AIGreeter.jsx'), 'utf8');
var sysPanel  = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'SystemTicketsPanel.jsx'), 'utf8');
var shipping  = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ShippingRatesTab.jsx'), 'utf8');
var admin     = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'AdminTab.jsx'), 'utf8');
var calendar  = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'CalendarTab.jsx'), 'utf8');
var hrMetrics = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'hr-metrics.js'), 'utf8');
var myPerf    = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'MyPerformance.jsx'), 'utf8');

// =============================================================
// ITEM 1 — Search hits closed tickets when query active
// =============================================================
ok('1a: search bypasses status filter when q is active (so closed tickets are searchable)',
  /var searchActive = q && q\.length > 0;\s*if \(!searchActive\)/.test(tickets));
ok('1b: REGRESSION GUARD — old unconditional status filter is gone',
  !/\bif \(statusF === 'open'\) arr = arr\.filter\(t => t\.status !== 'Closed'\);\s*else if \(statusF === 'mine'\)/.test(tickets) ||
  /if \(!searchActive\) \{\s*if \(statusF === 'open'\)/.test(tickets));

// =============================================================
// ITEM 2 — Recorder doesn't auto-restart after stop
// =============================================================
ok('2a: stopRecording() tears down backup recognizer immediately',
  /var stopRecording = function[\s\S]{0,1200}stopBackupRecog\(\)/.test(greeter));
ok('2b: backup onend uses MediaRecorder.state as canonical truth (not closure-captured `recording`)',
  /if \(recordBackupRecogRef\.current !== br\) return;[\s\S]{0,300}mediaRecorderRef\.current[\s\S]{0,200}state !== 'recording'/.test(greeter));
ok('2c: REGRESSION GUARD — old closure-captured `recording` check is gone',
  !/if \(recording && recordBackupRecogRef\.current === br\) \{\s*try \{ br\.start\(\)/.test(greeter));

// =============================================================
// ITEM 3 — Calendar attendance + notes display
// =============================================================
ok('3a: calendar shows attendance summary from checked_in_by + notes thread authors',
  /attendeeIds\[notesEvent\.checked_in_by\][\s\S]{0,400}notesThread[\s\S]{0,200}author_id/.test(calendar));
ok('3b: attendance summary renders Attended: <names>',
  /✓ Attended:[\s\S]{0,100}names\.join\(', '\)/.test(calendar));

// =============================================================
// ITEM 4 — Stagnant priority-board items penalize HR score
// =============================================================
ok('4a: hr-metrics computes stagnantPriorityTickets',
  /var stagnantPriorityTickets = assignedTickets\.filter\(function \(t\) \{[\s\S]{0,400}t\.starred_today/.test(hrMetrics));
ok('4b: stagnant requires 24+ hours of zero movement',
  /STAGNANT_HOURS = 24/.test(hrMetrics) &&
  /hoursSinceStar >= STAGNANT_HOURS/.test(hrMetrics));
ok('4c: stagnantPriorityCount exposed in metrics return',
  /stagnantPriorityCount: stagnantPriorityTickets\.length/.test(hrMetrics));
ok('4d: engagement score penalized by stagnant priorities (5 pts each, capped at 25)',
  /var stagnantPenalty = Math\.min\(25, \(myMetrics\.stagnantPriorityCount \|\| 0\) \* 5\);/.test(hrMetrics) &&
  /engagement = Math\.max\(0, engagement - stagnantPenalty\)/.test(hrMetrics));

// =============================================================
// ITEM 5 — SQL diagnostic for priority constraint shipped
// =============================================================
ok('5a: SQL diagnostic file exists at sql/v55-82-w-priority-check.sql',
  fs.existsSync(path.join(__dirname, '..', 'sql', 'v55-82-w-priority-check.sql')));

// =============================================================
// ITEM 6 — System ticket attachments
// =============================================================
ok('6a: SystemTicketsPanel has pendingFiles state + uploadPendingFiles helper',
  /var \[pendingFiles, setPendingFiles\]/.test(sysPanel) &&
  /var uploadPendingFiles = async function/.test(sysPanel));
ok('6b: uploadPendingFiles posts to ticket-attachments bucket',
  /supabase\.storage\.from\('ticket-attachments'\)\.upload/.test(sysPanel));
ok('6c: attachments included in INSERT row',
  /attachments: uploadedAttachments\.length > 0 \? uploadedAttachments : null/.test(sysPanel));
ok('6d: ticket card renders attachments as chips/links',
  /t\.attachments && Array\.isArray\(t\.attachments\) && t\.attachments\.length > 0/.test(sysPanel) &&
  /href=\{att\.url\}/.test(sysPanel));

// =============================================================
// ITEM 7+8 — Shipping graph: best-rate single line as default
// =============================================================
ok('7a: Floor view default = no spaghetti (only market floor renders)',
  // v55.83-A.6 — anti-spaghetti behavior moved from chartShippingLine === 'all'
  // branch to chartView === 'floor' (the default). Old: chartShippingLine === 'all' → linesToPlot=[].
  // New: chartView === 'floor' → groupsToPlot=[] (no breakdownField).
  (/chartShippingLine === 'all'\) \{\s*linesToPlot = \[\]; \/\/ default — only the _best market line shows/.test(shipping)) ||
  (/breakdownField = null/.test(shipping) && /chartView === 'vendor'[\s\S]{0,80}breakdownField = 'vendor_name'/.test(shipping)));
ok('8a: Floor view renders the market-best line',
  // v55.83-A.6 — chartShippingLine === 'all' && (<> _bestActive _bestStale </>) replaced
  // by chartView === 'floor' ? <Line dataKey="_best" /> : ... . Single solid line now,
  // stale handled via per-point icon, no dashed-grey overlay.
  (/chartShippingLine === 'all' && \(\s*<>[\s\S]{0,800}_bestActive[\s\S]{0,400}_bestStale[\s\S]{0,400}<\/>\s*\)/.test(shipping)) ||
  /chartView === 'floor' \?\s*\(?\s*<Line type="monotone" dataKey="_best"/.test(shipping));

// =============================================================
// ITEM 9 — Stale carry-forward best rate as dotted grey
// =============================================================
ok('9a: trend point captures market-best with stale-flag tracking',
  // v55.83-A.6 — _bestActive/_bestStale split collapsed back into a single
  // _best field + __stale___best flag. Same semantic: fresh vs carry-forward;
  // visual rendering now uses a solid line + icon overlay instead of two lines.
  (/point\._bestActive = Number\(bestRow\.rate_amount\)/.test(shipping) &&
   /point\._bestStale = lastBest\.price/.test(shipping)) ||
  (/point\._best = Number\(bestRow\.rate_amount\)/.test(shipping) &&
   /point\.__stale___best = true/.test(shipping) &&
   /point\._best = lastBest\.price/.test(shipping)));
ok('9b: Stale points are visually distinguished',
  // v55.83-A.6 (Max May 13 2026 spec) — stale rendering moved from a dashed
  // grey line (_bestStale) to a solid line with ⏳ icon overlays at stale dots.
  // Accept either form.
  /dataKey="_bestStale"[\s\S]{0,300}strokeDasharray="4 4"[\s\S]{0,200}stroke: '#94a3b8'/.test(shipping) ||
  /staleFlag[\s\S]{0,400}⏳/.test(shipping));

// =============================================================
// ITEM 10 — Smart name matching (case/punctuation insensitive)
// =============================================================
ok('10a: normName strips non-alphanumeric + collapses whitespace',
  /var normName = function \(s\) \{[\s\S]{0,400}replace\(\/\[\^a-z0-9\]\+\/g, ' '\)[\s\S]{0,200}replace\(\/\\s\+\/g, ' '\)/.test(shipping));
ok('10b: keyFor uses normName for vendor + line + origin + destination',
  /normName\(r\.origin\)[\s\S]{0,150}normName\(r\.destination\)[\s\S]{0,150}normName\(r\.vendor_name\)[\s\S]{0,150}normName\(r\.shipping_line\)/.test(shipping));

// =============================================================
// ITEM 11 — Login false-positive fix (cross-reference loginSummary)
// =============================================================
ok('11a: "Did Not Login" widget cross-references loginSummary',
  /loggedInYesterdayEvents = new Set\([\s\S]{0,300}loginSummary[\s\S]{0,300}logins_yesterday_et/.test(admin));
ok('11b: didLogIn helper checks both user_sessions AND loginSummary',
  /didLogIn = \(uid\) =>[\s\S]{0,100}loggedInYesterdaySessions\.has\(uid\)[\s\S]{0,100}loggedInYesterdayEvents\.has\(uid\)/.test(admin));

// =============================================================
// CARRY-FORWARDS from prior turns we want to keep verified
// =============================================================
ok('priv: TicketsTab still has private-ticket filter',
  // v55.82-Z centralized the privacy gate into canSeeTicket. Either the
  // old inline filter or the new helper-based one is acceptable as long
  // as private-ticket filtering exists somewhere.
  /arr = arr\.filter\(t => !t\.is_private \|\| t\.private_to === myId\)/.test(tickets) ||
  (/const canSeeTicket = \(t\) => \{/.test(tickets) &&
   /if \(t\.is_private\) return t\.private_to === myId/.test(tickets) &&
   /arr = arr\.filter\(canSeeTicket\)/.test(tickets)));
ok('coach-lang: coachLang still defaults from userProfile.preferred_language',
  /var pref = userProfile && userProfile\.preferred_language[\s\S]{0,200}return 'ar'/.test(myPerf));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' test' + (failures.length === 1 ? '' : 's') + ' failed:');
  failures.forEach(function(f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.82-W tests passed');
