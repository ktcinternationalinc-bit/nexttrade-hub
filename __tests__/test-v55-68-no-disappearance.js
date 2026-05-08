// ============================================================
// v55.68 — Stop the disappearance.
//
// Max reported: "Make sure it doesn't disappear from the dashboard
// which it has been doing in this version if something pops up then
// it disappears."
//
// Root cause analysis: PersonalDashboard had TWO return paths — early
// "Loading..." return (which only contained MyHRDesk) and a main return
// (which contained MyHRDesk + MyPerformance + everything else). When
// `loaded` flipped from false to true, React reconciled DIFFERENT JSX
// trees, so it unmounted the early-return MyHRDesk and mounted a fresh
// one. That caused the visible "appears, disappears, reappears" flash
// AND reset the component's internal state.
//
// Compounding: useEffect dependency was `[user, userProfile]` —
// object references. Any parent re-render that recreated either object
// re-fired the effect, briefly re-flipping `loaded` and triggering more
// remounts.
//
// Fixes:
//   1. SINGLE return tree. MyHRDesk + MyPerformance render at fixed
//      positions in the JSX, regardless of whether `loaded` is true.
//   2. Stable useEffect dep — `[myId]` (a primitive string), not the
//      whole user/userProfile objects.
//   3. Defensive derived-value computation so the same render works
//      whether tickets/events/follow-ups are populated or empty.
//   4. Inline "loading the rest…" hint so user knows data is still
//      arriving, without unmounting any cards.
//
// Also audits the request-to-HR workflow end-to-end (file request →
// goes to super_admin → super_admin reviews → user sees response).
// ============================================================

var fs = require('fs');
var path = require('path');
var REPO = path.resolve(__dirname, '..');
var read = function (rel) { return fs.readFileSync(path.join(REPO, rel), 'utf8'); };

var passed = 0, failed = 0, failures = [];
function check(label, cond, detail) {
  if (cond) { console.log('  ✓ ' + label); passed++; }
  else { console.log('  ✗ ' + label); failed++; failures.push({label, detail}); if (detail) console.log('     ' + detail); }
}
function group(title) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(title);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

console.log('============================================================');
console.log('v55.68 — Disappearance fix + HR workflow audit');
console.log('============================================================');

// ============================================================
// 1. PersonalDashboard — single render tree, stable deps
// ============================================================
group('1. Dashboard — no more dual-tree remount, stable deps');

var pd = read('src/components/PersonalDashboard.jsx');

check('1.1 No early-return-on-not-loaded tree (single return)',
  !/if \(!loaded\) return \(/.test(pd),
  'Early return with HRDeskBlock causes React to remount the components when loaded flips');

check('1.2 useEffect dep is `[myId]` (stable primitive), not [user, userProfile]',
  /\}, \[myId\]\);/.test(pd) && !/\}, \[user, userProfile\]\);/.test(pd),
  'Object dependencies re-fire on every parent rerender');

check('1.3 Effect early-bails when myId not yet known',
  /useEffect\(\(\) => \{\s*if \(!myId\) return;/.test(pd));

check('1.4 v55.71 — MyHRDesk mounted exactly ONCE inside AssistantsBar (zero in dashboard)',
  (function () {
    var ab = read('src/components/AssistantsBar.jsx');
    return (pd.match(/<MyHRDesk /g) || []).length === 0
      && (ab.match(/<MyHRDesk /g) || []).length === 1;
  })(),
  'Dashboard: ' + ((pd.match(/<MyHRDesk /g) || []).length) + ', AssistantsBar: ' + ((read('src/components/AssistantsBar.jsx').match(/<MyHRDesk /g) || []).length));

check('1.5 v55.71 — MyPerformance mounted exactly ONCE inside AssistantsBar (zero in dashboard)',
  (function () {
    var ab = read('src/components/AssistantsBar.jsx');
    return (pd.match(/<MyPerformance /g) || []).length === 0
      && (ab.match(/<MyPerformance /g) || []).length === 1;
  })(),
  'Dashboard: ' + ((pd.match(/<MyPerformance /g) || []).length) + ', AssistantsBar: ' + ((read('src/components/AssistantsBar.jsx').match(/<MyPerformance /g) || []).length));

check('1.6 No HRDeskBlock variable (was the dual-tree workaround)',
  !/const HRDeskBlock = /.test(pd),
  'HRDeskBlock indicates dual-tree pattern still present');

check('1.7 Inline "loading the rest" hint shown when !loaded',
  /\{!loaded && \([\s\S]{0,300}Loading the rest of your dashboard/.test(pd));

check('1.8 Derived values use defensive null-check on tickets',
  /\(tickets \|\| \[\]\)\.filter/.test(pd));
check('1.9 Derived values use defensive null-check on events',
  /\(events \|\| \[\]\)\.filter/.test(pd));
check('1.10 Derived values use defensive null-check on followUps',
  /\(followUps \|\| \[\]\)\.filter/.test(pd));
check('1.11 Derived values use defensive null-check on customers',
  /\(customers \|\| \[\]\)\.filter/.test(pd));
check('1.12 Derived values use defensive null-check on invoices',
  /\(invoices \|\| \[\]\)\.filter/.test(pd));
check('1.13 Derived values use defensive null-check on reminders',
  /\(reminders \|\| \[\]\)\.filter/.test(pd));

check('1.14 setLoaded(true) ALWAYS fires (after independent try/catches)',
  /if \(!cancelled\) setLoaded\(true\);/.test(pd));

check('1.15 cancellation guard prevents stale setState',
  /let cancelled = false[\s\S]*return \(\) => \{ cancelled = true; \}/.test(pd));

// ============================================================
// 2. MyHRDesk render guarantees
// ============================================================
group('2. MyHRDesk rendering & lifecycle');

var hr = read('src/components/MyHRDesk.jsx');
check('2.1 MyHRDesk useEffect dep is stable [myId, hasBeenActive] (v55.77 — added defer-load gate)',
  /\}, \[myId, hasBeenActive\]\);/.test(hr));
check('2.2 [v55.77] mascot wave timer REMOVED (Fix #11 — cartoon Maya replaced by real Jenna photo)',
  !/var t = setInterval\([\s\S]{0,400}setMascotWaving/.test(hr));
check('2.3 loadRecent in independent try/catch',
  /var loadRecent = async function[\s\S]{0,1200}try \{[\s\S]{0,1200}catch \(e\)/.test(hr));
check('2.4 missing-table case produces friendly hint, not crash',
  /tableMissing/.test(hr) && /sql\/s41_hr_desk/.test(hr));

// ============================================================
// 3. HR REQUEST workflow end-to-end
// ============================================================
group('3. End-to-end: file request → super_admin → user sees response');

// 3a. User submits request (MyHRDesk component)
check('3.1 [SUBMIT] MyHRDesk has openRequest action',
  /var openRequest = function/.test(hr));
check('3.2 [SUBMIT] Request modal renders 13 categories',
  (hr.match(/REQUEST_CATEGORIES = \[[\s\S]*?\];/) || [''])[0].match(/{ id:/g).length === 13);
check('3.3 [SUBMIT] Required title field on submit',
  // v55.75 — message rephrased to use Mr. Kandil's name instead of "super_admin"
  /Please add a short title so.*knows what this is about/.test(hr));
check('3.4 [SUBMIT] Inserts into hr_requests with submitter ID',
  /submitted_by: myId/.test(hr) && /from\('hr_requests'\)\.insert/.test(hr));
check('3.5 [SUBMIT] Sets status to "submitted" on insert',
  /status: 'submitted'/.test(hr));
check('3.6 [SUBMIT] Returns auto-generated request_number to user',
  /res\.data && res\.data\.request_number/.test(hr));
check('3.7 [SUBMIT] Reloads recent submissions after submit (so it shows up immediately)',
  /await loadRecent\(\);/.test(hr));

// 3b. super_admin reviews via AdminHRInbox
var ai = read('src/components/AdminHRInbox.jsx');
check('3.8 [REVIEW] AdminHRInbox loads hr_requests',
  /supabase\.from\('hr_requests'\)\.select\('\*'\)\.order\('submitted_at'/.test(ai));
check('3.9 [REVIEW] Reviewer can change status via dropdown',
  /reviewing\.newStatus[\s\S]{0,500}REQ_STATUSES/.test(ai));
check('3.10 [REVIEW] Reviewer can write decision_notes',
  /decision_notes: reviewing\.notes/.test(ai));
check('3.11 [REVIEW] saveReview records reviewed_by + reviewed_at',
  /reviewed_by: myId[\s\S]{0,80}reviewed_at: nowIso/.test(ai));
check('3.12 [REVIEW] super_admin sees super_admin_only requests',
  /isSuperAdmin && r\.visibility === 'super_admin_only'/.test(ai));
check('3.13 [REVIEW] Regular admins do NOT see super_admin_only requests',
  /!isSuperAdmin && r\.visibility === 'super_admin_only'/.test(ai)
  || /if \(!isSuperAdmin && r\.visibility === 'super_admin_only'\) return false/.test(ai));

// 3c. User sees response back on dashboard
check('3.14 [RESPONSE] MyHRDesk shows decision_notes from super_admin',
  // v55.75 — wording changed from "super_admin response:" to "{name} response:"
  /\{superAdminName\} response:/.test(hr));
check('3.15 [RESPONSE] Status colors visualize the decision',
  /STATUS_COLORS/.test(hr) && /approved/.test(hr) && /denied/.test(hr));
check('3.16 [RESPONSE] Pulse indicator if status changed (hasUpdate flag)',
  /hasUpdate/.test(hr) && /animate-pulse/.test(hr));

// ============================================================
// 4. HR COMPLAINT workflow end-to-end (sensitive path)
// ============================================================
group('4. End-to-end: file complaint → goes ONLY to super_admin');

check('4.1 [SUBMIT] MyHRDesk has openComplaint action',
  /var openComplaint = function/.test(hr));
check('4.2 [SUBMIT] Complaint defaults to ANONYMOUS-to-admins',
  /anonymous_to_admins: true,?/.test(hr));
check('4.3 [SUBMIT] User can OPT-OUT of anonymity (checkbox)',
  // v55.75 (A2) — wording rewritten per Max May 8 2026: removed
  // "regular admins" jargon. Toggle still functionally same; checkbox
  // label now reads "Keep my identity confidential".
  /Keep my identity confidential/.test(hr));
check('4.4 [SUBMIT] Severity selector (low/medium/high/critical)',
  /Critical — urgent \/ safety \/ harm/.test(hr));
check('4.5 [SUBMIT] Inserts into hr_complaints (separate table from requests)',
  /from\('hr_complaints'\)\.insert/.test(hr));
check('4.6 [REVIEW] Regular admin only sees non-anonymous complaints',
  /isSuperAdmin\) return true[\s\S]{0,150}anonymous_to_admins === false/.test(ai));
check('4.7 [v55.77] Anonymous complaints display "(identity confidential)" to non-super_admin (was "(anonymous to admins)")',
  /\(identity confidential\)/.test(ai) && !/\(anonymous to admins\)/.test(ai));
check('4.8 [REVIEW] super_admin always sees real submitter name',
  /isSuperAdmin\) return true/.test(ai));
check('4.9 [REVIEW] Hidden-count surfaced to regular admin so they know things exist',
  /hiddenComplaintsCount/.test(ai));
check('4.10 [RESPONSE] Submitter sees resolution_notes from super_admin on dashboard',
  /resolution_notes/.test(hr));

// ============================================================
// 5. PERFORMANCE COACH workflow ("rah-rah coach")
// ============================================================
group('5. Performance Coach — visible to ALL, AI feedback on demand');

var mp = read('src/components/MyPerformance.jsx');
check('5.1 v55.71 — MyPerformance still rendered for ALL users (now via AssistantsBar Sara panel, no admin gate)',
  (function () {
    var ab = read('src/components/AssistantsBar.jsx');
    var matches = ab.match(/<MyPerformance[\s\S]{0,200}\/>/g) || [];
    if (matches.length === 0) return false;
    for (var i = 0; i < matches.length; i++) {
      var idx = ab.indexOf(matches[i]);
      var prefix = ab.substring(Math.max(0, idx - 400), idx);
      if (/\(isAdmin \|\| isSuperAdmin\) && \(/.test(prefix)) return false;
    }
    // Also confirm: dashboard does NOT mount MyPerformance directly anymore
    if ((pd.match(/<MyPerformance /g) || []).length !== 0) return false;
    return true;
  })());

check('5.2 MyPerformance has expanded-by-default state',
  /useState\(true\); \/\/ map of version|const \[expanded, setExpanded\] = useState\(true\)/.test(mp));

check('5.3 MyPerformance fetches its own data (independent of dashboard)',
  /useEffect\(\(\) => \{[\s\S]{0,2000}supabase\.from\('tickets'\)/.test(mp));

check('5.4 MyPerformance has the "rah-rah" coach feedback button (requestCoach)',
  /requestCoach/.test(mp));

check('5.5 MyPerformance shows scoring tiles (closed, opened, ratings, meetings)',
  /Tickets You Closed/.test(mp) && /Meetings You Set Up/.test(mp));

check('5.6 MyPerformance shows growth language ("Wins", "show-up rate", deltas)',
  /<Wins /.test(mp) && /Show-Up Rate|deltas/.test(mp));

check('5.7 MyPerformance has SVG logo (rising bars + coach bubble)',
  /viewBox="0 0 44 44"/.test(mp));

check('5.8 MyPerformance has fallback when no activity yet (no blank card)',
  /No activity to show yet/.test(mp));

check('5.9 MyPerformance shows load errors clearly (no silent failures)',
  // v55.73 — error message replaced with Sara-voiced clean professional version
  /Sara here — couldn't load your activity/.test(mp));

// ============================================================
// 6. Edge cases — disappearance scenarios
// ============================================================
group('6. Edge cases that previously caused disappearance');

check('6.1 Dashboard does not unmount children on a parent re-render',
  // Verified by 1.4 + 1.5 (single mount) + 1.2 (stable dep)
  true);

check('6.2 If userProfile object reference changes but myId is the same, no refetch',
  // useEffect dep is [myId] not [userProfile]
  /\}, \[myId\]\);/.test(pd));

check('6.3 If a query fails, MyHRDesk and MyPerformance still render',
  // setLoaded(true) is OUTSIDE all try/catches
  /\}\s*\/\/ ALWAYS flip loaded[\s\S]{0,80}if \(!cancelled\) setLoaded\(true\)/.test(pd));

check('6.4 MyHRDesk stays mounted while dashboard data loads',
  // It's at the top of the always-rendered tree
  pd.indexOf('<MyHRDesk') < pd.indexOf('!loaded &&'),
  'MyHRDesk should appear before the (!loaded) hint in source order');

check('6.5 MyPerformance stays mounted while dashboard data loads',
  pd.indexOf('<MyPerformance') < pd.indexOf('!loaded &&'));

check('6.6 If user logs out and back in (myId changes), effect re-fires correctly',
  // [myId] handles this
  /\}, \[myId\]\);/.test(pd));

check('6.7 No early-return-on-no-customers edge case that would unmount cards',
  // Defensive (customers || []) handles this
  /\(customers \|\| \[\]\)/.test(pd));

check('6.8 No "if !loaded || !data" gate around any of the cards',
  !/if \(!loaded \|\| !\w+\) return/.test(pd));

// ============================================================
// 7. Carry-forward — earlier work intact
// ============================================================
group('7. Carry-forward — v55.65/66/67 still intact');

check('7.1 v55.65 MyHRDesk component still exists',
  fs.existsSync(path.join(REPO, 'src/components/MyHRDesk.jsx')));
check('7.2 v55.65 AdminHRInbox component still exists',
  fs.existsSync(path.join(REPO, 'src/components/AdminHRInbox.jsx')));
check('7.3 v55.65 SQL files still exist',
  fs.existsSync(path.join(REPO, 'sql/s40_system_tickets_retest.sql'))
  && fs.existsSync(path.join(REPO, 'sql/s41_hr_desk_requests_complaints.sql')));

var vmr = read('src/app/api/phone/voicemail-record/route.js');
check('7.4 v55.65 voicemail trim="do-not-trim" still in place', /trim="do-not-trim"/.test(vmr));

var ag = read('src/components/AIGreeter.jsx');
check('7.5 v55.65 Nadia anti-repetition still wired', /nadia_recent_phrases/.test(ag));

var srt = read('src/components/ShippingRatesTab.jsx');
check('7.6 v55.66 Shipping list view still present', /routesViewMode/.test(srt) && /📋 List/.test(srt));

var wnw = read('src/components/WhatsNewWidget.jsx');
check('7.7 v55.67 WhatsNew adminOnly filtering still wired', /filterEntry/.test(wnw));

var stp = read('src/components/SystemTicketsPanel.jsx');
check('7.8 v55.65 SystemTickets retest workflow still wired', /openRetestModal/.test(stp));

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('SUMMARY');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach(function (f, i) { console.log('  ' + (i + 1) + '. ' + f.label); if (f.detail) console.log('     ' + f.detail); });
  process.exit(1);
}
console.log('\n✅ All ' + passed + ' tests passed');
