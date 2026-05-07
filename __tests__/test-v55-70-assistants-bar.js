// ============================================================
// v55.70 — AssistantsBar: two big avatar tiles for Nadia + Jenna
//
// Max May 7 2026:
//   "There should be a big large person that's Nadia and a large
//   person that is the HR rep [Jenna]. Nadia is your AI executive
//   secretary, the HR rep is your relationship manager / coach who
//   gives feedback on how to improve your performance. Two big icons
//   organized in a way that's clear in the dashboard. It doesn't
//   disappear and you should get a morning brief from your executive
//   system initially and then your HR person in the agenda."
//
// Implementation:
//   - New AssistantsBar component at the very top of the dashboard.
//   - Two big animated SVG avatars side-by-side (responsive: stack on
//     mobile, side-by-side on tablet+).
//   - Each shows: name, role badge, summary line ("morning brief" /
//     "today's agenda"), notification count pulse, click-through CTA.
//   - Click Nadia → scrolls to AIGreeter chat + un-dismisses if hidden.
//   - Click Jenna → scrolls to MyHRDesk + MyPerformance section.
//   - Both anchored with stable IDs (#nadia-greeter-anchor and
//     #jenna-section-anchor) so scroll-into-view works.
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
console.log('v55.70 — AssistantsBar (Nadia + Jenna avatars)');
console.log('============================================================');

// ============================================================
// 1. AssistantsBar component exists and is well-formed
// ============================================================
group('1. AssistantsBar component');

var ab = read('src/components/AssistantsBar.jsx');
check('1.1 AssistantsBar.jsx exists', ab.length > 5000);
check('1.2 default export', /export default function AssistantsBar/.test(ab));
check('1.3 accepts user, userProfile, users props',
  /function AssistantsBar\(\{[\s\S]{0,200}user, userProfile, users/.test(ab));
check('1.4 accepts tickets + checks props for Nadia\'s summary',
  /tickets, checks/.test(ab));
check('1.5 v55.71 — accepts onTalkToNadia handler (Jenna/Sara self-contained, no scroll handlers needed)',
  /onTalkToNadia,/.test(ab));

// ============================================================
// 2. Three big avatar tiles (v55.71 expanded from two)
// ============================================================
group('2. Three big avatar tiles (Nadia + Jenna + Sara)');

check('2.1 v55.71 — Nadia tile rendered via Tile component with name="Nadia"',
  /<Tile[\s\S]{0,200}who="nadia"[\s\S]{0,200}name="Nadia"/.test(ab));
check('2.2 v55.71 — Jenna tile rendered via Tile component with name="Jenna"',
  /<Tile[\s\S]{0,200}who="jenna"[\s\S]{0,200}name="Jenna"/.test(ab));
check('2.3 v55.71 — Nadia role labeled "Executive Asst" (was "Executive Secretary" in v55.70)',
  /name="Nadia"[\s\S]{0,200}role="Executive Asst"/.test(ab));
check('2.4 v55.71 — Sara role labeled "Work Coach" (replaces v55.70 "Relationship Coach")',
  /name="Sara"[\s\S]{0,200}role="Work Coach"/.test(ab));
check('2.5 v55.71 — Avatars rendered via PhotoAvatar (was 96px SVG in v55.70)',
  /<PhotoAvatar src="\/avatars\/nadia\.png"/.test(ab)
  && /<PhotoAvatar src="\/avatars\/jenna\.png"/.test(ab)
  && /<PhotoAvatar src="\/avatars\/sara\.png"/.test(ab));
check('2.6 v55.71 — Grid uses 3 columns on tablet+ (was 2 in v55.70)',
  /grid grid-cols-1 sm:grid-cols-3/.test(ab));
check('2.7a v55.71 — Tile click triggers togglePanel (replaces v55.70 onTalkTo*)',
  /onClick=\{function \(\) \{ togglePanel\(who\); \}\}/.test(ab));
check('2.7b v55.71 — togglePanel handles all three avatars uniformly',
  /var togglePanel = function \(which\) \{[\s\S]{0,200}prev === which \? null : which/.test(ab));
check('2.8 v55.71 — Hover lifts card (transform/translate when not open)',
  /hover:-translate-y/.test(ab) && /hover:shadow-2xl/.test(ab));
check('2.9 v55.71 — Three distinct gradients distinguish all three avatars (asserted in suite 1.1-1.3 of v55.71)',
  /linear-gradient\(135deg, #6366f1 0%, #8b5cf6 50%, #ec4899 100%\)/.test(ab)
  && /linear-gradient\(135deg, #f59e0b 0%, #f43f5e 50%, #d946ef 100%\)/.test(ab)
  && /linear-gradient\(135deg, #06b6d4 0%, #0ea5e9 50%, #6366f1 100%\)/.test(ab));

// ============================================================
// 3. Animated avatars
// ============================================================
group('3. Animated avatars — wave + hover');

check('3.1 v55.71 — Unified waveState object covers all three avatars (Nadia, Jenna, Sara)',
  /\[waveState, setWaveState\] = useState\(\{ nadia: false, jenna: false, sara: false \}\)/.test(ab));
check('3.2a Periodic wave scheduled for Nadia',
  /schedule\('nadia',/.test(ab));
check('3.2b Periodic wave scheduled for Jenna',
  /schedule\('jenna',/.test(ab));
check('3.3 v55.71 — Wave animation uses CSS transform with smooth transition (now on photo tilt + scale)',
  /transition: 'transform 400ms cubic-bezier/.test(ab));
check('3.4 v55.71 — Hover triggers wave via setWave(who, true) for any avatar',
  /onMouseEnter=\{function \(\) \{ setWave\(who, true\); \}\}/.test(ab));
check('3.5 v55.71 — Cleanup on unmount (clearInterval + clearTimeout)',
  /clearInterval\(loop\); triggers\.forEach\(function \(t\) \{ clearTimeout\(t\); \}\)/.test(ab));
check('3.6 v55.71 — Three-avatar offsets so they don\'t move in lock-step (Nadia 0s, Jenna 5s, Sara 10s)',
  /schedule\('nadia', 0\)[\s\S]{0,100}schedule\('jenna', 5000\)[\s\S]{0,100}schedule\('sara', 10000\)/.test(ab));

// ============================================================
// 4. Summary lines — morning brief + agenda
// ============================================================
group('4. Summary lines (morning brief / today\'s agenda)');

check('4.1 v55.71 — Nadia panel labeled "Morning Brief"',
  /Morning Brief/.test(ab));
check('4.2 v55.71 — Greeting line uses greetTime (Good morning/afternoon/evening)',
  /greetTime \+ ', ' \+ firstName/.test(ab));
check('4.3 Nadia summary computes urgent count from tickets',
  /var nadiaUrgentCount = myAck \+ myDueToday \+ myOverdue \+ checksDueToday/.test(ab));
check('4.4 v55.71 — Nadia summary handles "all caught up" empty state',
  /all caught up today/.test(ab));
check('4.5 Jenna summary fetches HR Desk data',
  /supabase\.from\('hr_requests'\)[\s\S]{0,400}supabase\.from\('hr_complaints'\)/.test(ab));
check('4.6 Jenna summary handles missing hr_requests/complaints tables gracefully',
  // v55.71 text: "HR setup needed (run sql/s41)."
  /tableMissing/.test(ab) && /HR setup needed/.test(ab));
check('4.7 Jenna summary handles "nothing pending" empty state',
  // v55.71 — empty state text is "File a request, raise a concern, or just say hi."
  /File a request, raise a concern, or just say hi/.test(ab));
check('4.8 Notification count pulse on Nadia tile if urgent items > 0',
  // v55.71 — Nadia tile gets notifCount={nadiaUrgentCount} + notifPulse={true}.
  // The Tile's badge applies animate-pulse when notifPulse is true.
  /notifCount=\{nadiaUrgentCount\}[\s\S]{0,80}notifPulse=\{true\}/.test(ab)
  && /props\.notifPulse \? ' animate-pulse' : ''/.test(ab));
check('4.9 Notification count pulse on Jenna tile if pending items > 0',
  // v55.71 — sum of pending counts is passed as notifCount prop on the Jenna Tile
  /notifCount=\{jennaSummary\.newResponses \+ jennaSummary\.pendingReq \+ jennaSummary\.pendingCmp\}/.test(ab));
check('4.10 v55.71 — New responses get emerald pulse (notifPulse + emerald badgeColor when newResponses > 0)',
  // Split into two props in v55.71: notifPulse for pulse animation, badgeColor for color.
  // Both should switch to "newResponses > 0" condition.
  /notifPulse=\{jennaSummary\.newResponses > 0\}/.test(ab)
  && /badgeColor=\{jennaSummary\.newResponses > 0 \? 'bg-emerald-500' : 'bg-amber-500'\}/.test(ab));

// ============================================================
// 5. Click-through navigation
// ============================================================
group('5. Click navigation');

var pd = read('src/components/PersonalDashboard.jsx');
check('5.1 PersonalDashboard imports AssistantsBar',
  /import AssistantsBar from '\.\/AssistantsBar'/.test(pd));
check('5.2 AssistantsBar mounted at the TOP of dashboard (before overdue or anything)',
  pd.indexOf('<AssistantsBar') < pd.indexOf('OVERDUE'));
check('5.3 onTalkToNadia handler scrolls to #nadia-greeter-anchor',
  /onTalkToNadia=\{function \(\) \{[\s\S]{0,400}getElementById\('nadia-greeter-anchor'\)/.test(pd));
check('5.4 onTalkToNadia dispatches ktc:open-nadia event',
  /window\.dispatchEvent\(new CustomEvent\('ktc:open-nadia'\)\)/.test(pd));
check('5.5 v55.71 SUPERSEDES — Jenna no longer needs scroll handler (panel mounts inline via togglePanel)',
  /togglePanel\('jenna'\)|togglePanel\(who\)/.test(read('src/components/AssistantsBar.jsx')));
check('5.6 Smooth-scroll behavior used (still wired for Nadia chat scroll)',
  /scrollIntoView\(\{ behavior: 'smooth'/.test(pd));

// page.jsx anchors + listener
var pg = read('src/app/page.jsx');
check('5.7 page.jsx adds id="nadia-greeter-anchor" to AIGreeter wrapper',
  /id="nadia-greeter-anchor"/.test(pg));
check('5.8 page.jsx listens for ktc:open-nadia event to un-dismiss Nadia',
  /window\.addEventListener\('ktc:open-nadia'/.test(pg));
check('5.9 ktc:open-nadia handler sets greeterDismissed=false',
  /var handler = function \(\) \{ setGreeterDismissed\(false\); \}/.test(pg));
check('5.10 Event listener cleans up on unmount',
  /window\.removeEventListener\('ktc:open-nadia'/.test(pg));

// v55.71 — Jenna mounts MyHRDesk inline in her expand panel inside AssistantsBar
check('5.11 v55.71 SUPERSEDES — MyHRDesk + MyPerformance now mount inline inside AssistantsBar Jenna/Sara panels',
  (function () {
    var ab = read('src/components/AssistantsBar.jsx');
    return /openPanel === 'jenna'[\s\S]{0,1500}<MyHRDesk/.test(ab)
      && /openPanel === 'sara'[\s\S]{0,1500}<MyPerformance/.test(ab);
  })());

// ============================================================
// 6. Persistence — never disappears
// ============================================================
group('6. Persistence — AssistantsBar never disappears');

check('6.1 AssistantsBar rendered OUTSIDE any loaded gate',
  // The dashboard return tree starts with the bar, no if(!loaded) wrapping it
  pd.indexOf('<AssistantsBar') > 0
  && !/if \(!loaded\) return \(/.test(pd));
check('6.2 AssistantsBar JSX rendered exactly ONCE in the file (not counting import/comments)',
  (pd.match(/<AssistantsBar/g) || []).length === 1);
check('6.3 No conditional gating around AssistantsBar (no isAdmin/isSuperAdmin/etc.)',
  // Look for any && (...) wrapping the AssistantsBar mount
  !/\{[a-zA-Z]+ && \(\s*<AssistantsBar/.test(pd));
check('6.4 v55.71 SUPERSEDES — Jenna and Sara panels render inline (no external anchor); MyHRDesk + MyPerformance mount unconditionally inside AssistantsBar',
  (function () {
    var ab = read('src/components/AssistantsBar.jsx');
    return /<MyHRDesk /.test(ab)
      && /<MyPerformance /.test(ab)
      && !/\(isAdmin \|\| isSuperAdmin\) && \([\s\S]{0,200}<MyHRDesk/.test(ab)
      && !/\(isAdmin \|\| isSuperAdmin\) && \([\s\S]{0,200}<MyPerformance/.test(ab);
  })());

// ============================================================
// 7. Greeting — "Good morning Max" line
// ============================================================
group('7. Personal greeting line');

check('7.1 v55.71 — Greeting includes "Good morning/afternoon/evening" via greetTime',
  /var greetTime = \(function \(\) \{ var h = new Date\(\)\.getHours\(\); return h < 12 \? 'Good morning' : h < 18 \? 'Good afternoon' : 'Good evening'/.test(ab));
check('7.2 Greeting derives firstName from userProfile or user',
  /var firstName = \(\(userProfile && userProfile\.name\) \|\| \(user && user\.email\) \|\| 'there'\)\.split/.test(ab));
check('7.3 v55.71 — Nadia\'s tile line greets the user by name (greetTime + firstName)',
  /greetTime \+ ', ' \+ firstName/.test(ab));

// ============================================================
// 8. Edge cases
// ============================================================
group('8. Edge cases');

check('8.1 Defensive: tickets prop null → uses empty array',
  /var safeTickets = tickets \|\| \[\]/.test(ab));
check('8.2 Defensive: checks prop null → uses empty array',
  /var safeChecks = checks \|\| \[\]/.test(ab));
check('8.3 Jenna data fetch wrapped in try/catch',
  (function () {
    var fn = ab.match(/var loadJenna = async function \(\) \{[\s\S]*?\n    \};/);
    if (!fn) return false;
    return /try \{/.test(fn[0]) && /\} catch \(e\)/.test(fn[0]) && /supabase\.from\('hr_requests'\)/.test(fn[0]);
  })());
check('8.4 Jenna useEffect has stable [myId] dep (not user/userProfile objects)',
  /\}, \[myId\]\)/.test(ab));
check('8.5 Jenna useEffect cancellation guard',
  /var cancelled = false;[\s\S]{0,3000}return function \(\) \{ cancelled = true; \}/.test(ab));
check('8.6 If onTalkToNadia handler not provided, click is a no-op (no crash)',
  /if \(onTalkToNadia\) onTalkToNadia\(\)/.test(ab));
check('8.7 v55.71 — Jenna is fully self-contained (no onTalkToJenna handler needed; MyHRDesk mounts inline in panel)',
  // In v55.71 architecture, clicking Jenna toggles her panel which mounts
  // MyHRDesk inline. No external scroll/event needed. Verify she doesn't
  // require an external onTalkToJenna prop and instead toggles her panel.
  /togglePanel\('jenna'\)|togglePanel\(who\)/.test(ab) && /openPanel === 'jenna'[\s\S]{0,1500}<MyHRDesk/.test(ab));
check('8.8 scrollIntoView wrapped in try/catch (no crash on missing element)',
  /try \{[\s\S]{0,200}scrollIntoView/.test(pd));

// ============================================================
// 9. Carry-forward — earlier work intact
// ============================================================
group('9. Carry-forward — v55.65/66/67/68/69 still intact');

check('9.1 v55.71 SUPERSEDES — MyHRDesk now in AssistantsBar (zero dashboard mounts)',
  (pd.match(/<MyHRDesk /g) || []).length === 0);
check('9.2 v55.71 SUPERSEDES — MyPerformance now in AssistantsBar (zero dashboard mounts)',
  (pd.match(/<MyPerformance /g) || []).length === 0);
check('9.3 v55.68 stable [myId] effect dep',
  /\}, \[myId\]\);/.test(pd));
check('9.4 v55.68 no early-return tree',
  !/if \(!loaded\) return \(/.test(pd));

var hr = read('src/components/MyHRDesk.jsx');
check('9.5 v55.65 MyHRDesk component still present', hr.length > 5000);
var ai = read('src/components/AdminHRInbox.jsx');
check('9.6 v55.65 AdminHRInbox still present', ai.length > 3000);
var srt = read('src/components/ShippingRatesTab.jsx');
check('9.7 v55.66 Shipping list view still present', /routesViewMode/.test(srt));
var wnw = read('src/components/WhatsNewWidget.jsx');
check('9.8 v55.67 WhatsNew filtering still wired', /filterEntry/.test(wnw));
var tt = read('src/components/TicketsTab.jsx');
check('9.9 v55.69 ticket optimistic save still wired', /savingRef/.test(tt));
var vmr = read('src/app/api/phone/voicemail-record/route.js');
check('9.10 v55.65 voicemail trim="do-not-trim" still in place', /trim="do-not-trim"/.test(vmr));

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
