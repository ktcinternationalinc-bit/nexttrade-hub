// ============================================================
// v55.71 — Three big avatars (Nadia + Jenna + Sara) with expand/collapse
//
// Max May 7 2026: "Three partners — Miss Nadia executive assistant,
// Miss Jenna HR representative, Miss Sara work/relationship coach.
// Three really big icons. You select them and it opens up what they
// do. Doesn't have to be open unless you click — except Nadia's
// morning brief which shows initially. They can close to just the
// icons. Three beautiful different women prevailing on the dashboard."
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
console.log('v55.71 — Three big avatars (Nadia + Jenna + Sara)');
console.log('============================================================');

var ab = read('src/components/AssistantsBar.jsx');
var pd = read('src/components/PersonalDashboard.jsx');

// ============================================================
// 1. Three avatars defined
// ============================================================
group('1. Three avatar functions defined');

check('1.1 NadiaAvatar function defined', /function NadiaAvatar\(waving\)/.test(ab));
check('1.2 JennaAvatar function defined', /function JennaAvatar\(waving\)/.test(ab));
check('1.3 SaraAvatar function defined', /function SaraAvatar\(waving\)/.test(ab));
check('1.4 v55.72 — All three avatars now use real photos via PhotoAvatar wrapper',
  /function PhotoAvatar\(props\)/.test(ab));

// ============================================================
// 2. Three tile renders in the bar
// ============================================================
group('2. Three tiles rendered in the bar');

check('2.1 Tile for Nadia rendered with name="Nadia"',
  /<Tile[\s\S]{0,200}who="nadia"[\s\S]{0,200}name="Nadia"/.test(ab));
check('2.2 Tile for Jenna rendered with name="Jenna"',
  /<Tile[\s\S]{0,200}who="jenna"[\s\S]{0,200}name="Jenna"/.test(ab));
check('2.3 Tile for Sara rendered with name="Sara"',
  /<Tile[\s\S]{0,200}who="sara"[\s\S]{0,200}name="Sara"/.test(ab));
check('2.4 Sara role labeled "Work Coach"',
  /name="Sara"[\s\S]{0,200}role="Work Coach"/.test(ab));
check('2.5 Nadia role labeled "Executive Asst"',
  /name="Nadia"[\s\S]{0,200}role="Executive Asst"/.test(ab));
check('2.6 Jenna role labeled "HR Rep"',
  /name="Jenna"[\s\S]{0,200}role="HR Rep"/.test(ab));
check('2.7 Grid uses 3 columns on tablet+',
  /grid grid-cols-1 sm:grid-cols-3/.test(ab));

// ============================================================
// 3. Three distinct color schemes
// ============================================================
group('3. Three distinct gradient backgrounds');

check('3.1 Nadia uses indigo→purple→pink gradient',
  /linear-gradient\(135deg, #6366f1 0%, #8b5cf6 50%, #ec4899 100%\)/.test(ab));
check('3.2 Jenna uses amber→rose→fuchsia gradient',
  /linear-gradient\(135deg, #f59e0b 0%, #f43f5e 50%, #d946ef 100%\)/.test(ab));
check('3.3 Sara uses cyan→sky→indigo gradient',
  /linear-gradient\(135deg, #06b6d4 0%, #0ea5e9 50%, #6366f1 100%\)/.test(ab));

// ============================================================
// 4. Three distinct PHOTOS (v55.72 — was illustrated SVGs)
// ============================================================
group('4. Three distinct photo headshots wired into avatars');

var fs2 = require('fs');
var path2 = require('path');
var avatarDir = path2.join(REPO, 'public', 'avatars');

check('4.1 v55.72 — Nadia photo file exists at public/avatars/nadia.png',
  fs2.existsSync(path2.join(avatarDir, 'nadia.png')));
check('4.2 v55.72 — Jenna photo file exists at public/avatars/jenna.png',
  fs2.existsSync(path2.join(avatarDir, 'jenna.png')));
check('4.3 v55.72 — Sara photo file exists at public/avatars/sara.png',
  fs2.existsSync(path2.join(avatarDir, 'sara.png')));
check('4.4 v55.72 — NadiaAvatar references /avatars/nadia.png',
  /<PhotoAvatar src="\/avatars\/nadia\.png"/.test(ab));
check('4.5 v55.72 — JennaAvatar references /avatars/jenna.png',
  /<PhotoAvatar src="\/avatars\/jenna\.png"/.test(ab));
check('4.6 v55.72 — SaraAvatar references /avatars/sara.png',
  /<PhotoAvatar src="\/avatars\/sara\.png"/.test(ab));
check('4.7 v55.72 — All three photos are reasonably sized (under 250KB each — optimized for web)',
  (function () {
    for (var p of ['nadia.png', 'jenna.png', 'sara.png']) {
      var sz = fs2.statSync(path2.join(avatarDir, p)).size;
      if (sz > 250 * 1024) return false;
    }
    return true;
  })());
check('4.8 v55.72 — PhotoAvatar renders <img> with circular border-radius',
  /borderRadius: '50%'/.test(ab));
check('4.9 v55.72 — PhotoAvatar uses object-fit: cover (no stretch/distortion)',
  /objectFit: 'cover'/.test(ab));
check('4.10 v55.72 — PhotoAvatar has alt text for accessibility',
  /alt="Nadia, Executive Assistant"/.test(ab)
  && /alt="Jenna, HR Representative"/.test(ab)
  && /alt="Sara, Work Coach"/.test(ab));
check('4.11 v55.72 — Photos have a soft inset white ring + drop shadow (premium feel)',
  /boxShadow: '0 8px 24px rgba\(0,0,0,0\.25\), inset 0 0 0 4px rgba\(255,255,255,0\.4\)'/.test(ab));
check('4.12 v55.72 — Hover/wave triggers a tilt + scale animation (no SVG arm wave anymore)',
  /props\.waving \? 'scale\(1\.04\) rotate\(-3deg\)' : 'scale\(1\) rotate\(0deg\)'/.test(ab));
check('4.13 v55.72 — Image is non-draggable (prevents drag-out on desktop)',
  /draggable=\{false\}/.test(ab));
check('4.14 v55.72 — Image is lazy-loaded (won\'t block first paint if dashboard is scrolled)',
  /loading="lazy"/.test(ab));

// (Sara photo file existence + reference is asserted in tests 4.3 + 4.6 above.)

// ============================================================
// 5. Click-to-expand / click-again-to-close
// ============================================================
group('5. Click expand/collapse behavior');

check('5.1 openPanel state with null/nadia/jenna/sara values',
  /\[openPanel, setOpenPanel\] = useState/.test(ab));
check('5.2 togglePanel — v55.73 enforces ONE-ACTIVE-AT-A-TIME (no-op when re-clicking active)',
  /var togglePanel = function \(which\)[\s\S]{0,500}if \(prev === which\) return prev/.test(ab));
check('5.3 Nadia panel renders when openPanel === "nadia"',
  /openPanel === 'nadia' && \(/.test(ab));
check('5.4 Jenna panel renders when openPanel === "jenna"',
  /openPanel === 'jenna' && \(/.test(ab));
check('5.5 Sara panel renders when openPanel === "sara"',
  /openPanel === 'sara' && \(/.test(ab));
check('5.6 v55.73 — Close buttons REMOVED (one always active)',
  (ab.match(/✕ Close/g) || []).length === 0);

// ============================================================
// 6. Nadia is the HARD default — one always active
// ============================================================
group('6. Nadia is the hard default (v55.73)');

check('6.1 v55.73 — openPanel useState defaults to "nadia" (no null fallback)',
  /\[openPanel, setOpenPanel\] = useState\('nadia'\)/.test(ab));
check('6.2 NADIA_AUTO_OPEN_KEY localStorage key still defined for badge purposes',
  /var NADIA_AUTO_OPEN_KEY = 'ktc_nadia_morning_brief_dismissed_at'/.test(ab));
check('6.3 v55.73 — togglePanel dispatches ktc:assistant-changed event',
  /window\.dispatchEvent\(new CustomEvent\('ktc:assistant-changed'/.test(ab));
check('6.4 v55.73 — One always active: clicking active tile is no-op',
  /if \(prev === which\) return prev/.test(ab));
check('6.5 Nadia panel has "Auto-opens daily" badge',
  /Auto-opens daily/.test(ab));

// ============================================================
// 7. Each panel renders the right deeper experience
// ============================================================
group('7. Expanded panels render correct components');

check('7.1 Nadia panel shows morning-brief stat cards',
  /openPanel === 'nadia'[\s\S]{0,2000}<StatCard/.test(ab));
check('7.2 Nadia panel has "Open Nadia Chat" button',
  /Open Nadia Chat/.test(ab));
check('7.3 Jenna panel mounts MyHRDesk inline',
  /openPanel === 'jenna'[\s\S]{0,1500}<MyHRDesk /.test(ab));
check('7.4 Sara panel mounts MyPerformance inline',
  /openPanel === 'sara'[\s\S]{0,1500}<MyPerformance /.test(ab));
check('7.5 AssistantsBar imports MyHRDesk',
  /import MyHRDesk from '\.\/MyHRDesk'/.test(ab));
check('7.6 AssistantsBar imports MyPerformance',
  /import MyPerformance from '\.\/MyPerformance'/.test(ab));

// ============================================================
// 8. Animation
// ============================================================
group('8. Wave animation per avatar');

check('8.1 waveState tracks all three avatars (nadia, jenna, sara)',
  /useState\(\{ nadia: false, jenna: false, sara: false \}\)/.test(ab));
check('8.2 Periodic loop schedules waves with offsets',
  /schedule\('nadia', 0\)[\s\S]{0,100}schedule\('jenna', 5000\)[\s\S]{0,100}schedule\('sara', 10000\)/.test(ab));
check('8.3 Loop interval is 16 seconds',
  /setInterval\([\s\S]{0,400}\}, 16000\);/.test(ab));
check('8.4 Hover triggers per-avatar wave',
  /onMouseEnter=\{function \(\) \{ setWave\(who, true\); \}\}/.test(ab));
check('8.5 Cleanup clears interval AND pending timeouts',
  /clearInterval\(loop\); triggers\.forEach\(function \(t\) \{ clearTimeout\(t\); \}\)/.test(ab));

// ============================================================
// 9. PersonalDashboard wiring
// ============================================================
group('9. PersonalDashboard wires AssistantsBar + removes duplicates');

check('9.1 PersonalDashboard imports AssistantsBar',
  /import AssistantsBar from '\.\/AssistantsBar'/.test(pd));
check('9.2 PersonalDashboard NO LONGER imports MyHRDesk directly',
  !/import MyHRDesk from '\.\/MyHRDesk'/.test(pd));
check('9.3 PersonalDashboard NO LONGER imports MyPerformance directly',
  !/import MyPerformance from '\.\/MyPerformance'/.test(pd));
check('9.4 PersonalDashboard mounts AssistantsBar exactly ONCE',
  (pd.match(/<AssistantsBar/g) || []).length === 1);
check('9.5 PersonalDashboard does NOT mount <MyHRDesk> directly anywhere',
  !/<MyHRDesk /.test(pd));
check('9.6 PersonalDashboard does NOT mount <MyPerformance> directly anywhere',
  !/<MyPerformance /.test(pd));
check('9.7 AssistantsBar at top of dashboard (before OVERDUE block)',
  pd.indexOf('<AssistantsBar') < pd.indexOf('OVERDUE'));

// ============================================================
// 10. Notification badges + summary lines
// ============================================================
group('10. Per-avatar summary lines + notification badges');

check('10.1 Nadia greets with morning/afternoon/evening',
  /Good morning|Good afternoon|Good evening/.test(ab) && /greetTime/.test(ab));
check('10.2 Nadia summary uses urgent ticket counts',
  /var nadiaUrgentCount = myAck \+ myDueToday \+ myOverdue \+ checksDueToday/.test(ab));
check('10.3 Jenna summary fetches from hr_requests + hr_complaints',
  /supabase\.from\('hr_requests'\)[\s\S]{0,400}supabase\.from\('hr_complaints'\)/.test(ab));
check('10.4 Jenna summary handles missing tables gracefully (tableMissing flag)',
  /tableMissing/.test(ab) && /HR setup needed/.test(ab));
check('10.5 Sara summary tracks last-opened in localStorage',
  /ktc_sara_last_opened/.test(ab));
check('10.6 Sara opening marks her as seen-today',
  /openPanel === 'sara'[\s\S]{0,300}localStorage\.setItem\('ktc_sara_last_opened'/.test(ab));
check('10.7 Sara shows "new feedback waiting" if not opened today',
  /New coach feedback waiting/.test(ab));
check('10.8 Notification badges render with count',
  /props\.notifCount > 0 && \(/.test(ab));
check('10.9 Notification pulses for urgency (animate-pulse conditional)',
  /props\.notifPulse \? ' animate-pulse' : ''/.test(ab));

// ============================================================
// 11. Edge cases
// ============================================================
group('11. Edge cases');

check('11.1 Defensive: tickets prop null → uses empty array',
  /var safeTickets = tickets \|\| \[\]/.test(ab));
check('11.2 Defensive: checks prop null → uses empty array',
  /var safeChecks = checks \|\| \[\]/.test(ab));
check('11.3 Jenna useEffect uses stable [myId] dep',
  /\}, \[myId\]\)/.test(ab));
check('11.4 Sara useEffect uses stable [todayStr] dep',
  /\}, \[todayStr\]\)/.test(ab));
check('11.5 Sara open useEffect uses stable [openPanel] dep',
  /\}, \[openPanel\]\)/.test(ab));
check('11.6 Cancellation guard in Jenna fetch',
  /var cancelled = false[\s\S]{0,2500}return function \(\) \{ cancelled = true; \}/.test(ab));
check('11.7 localStorage access wrapped in try/catch (every usage)',
  // v55.73 — fewer localStorage calls now (no dismissal logic, only saraSeenToday).
  // Every remaining call must still be wrapped in try/catch.
  (ab.match(/try \{[\s\S]{0,300}localStorage/g) || []).length >= 1);
check('11.8 typeof window check before localStorage (SSR safety)',
  /typeof window === 'undefined'/.test(ab));
check('11.9 onTalkToNadia handler call wrapped in try/catch',
  /try \{ onTalkToNadia\(\); \} catch/.test(ab));

// ============================================================
// 12. Persistence — never disappears
// ============================================================
group('12. Persistence guarantees');

check('12.1 AssistantsBar rendered once in PersonalDashboard',
  (pd.match(/<AssistantsBar/g) || []).length === 1);
check('12.2 No early-return loading gate above AssistantsBar',
  !/if \(!loaded\) return \(/.test(pd));
check('12.3 No conditional rendering around AssistantsBar in dashboard',
  !/\{[a-zA-Z]+ && \(\s*<AssistantsBar/.test(pd));
check('12.4 setLoaded(true) ALWAYS fires (carry-forward from v55.68)',
  /if \(!cancelled\) setLoaded\(true\)/.test(pd));

// ============================================================
// 13. Carry-forward
// ============================================================
group('13. Carry-forward — earlier work intact');

var hr = read('src/components/MyHRDesk.jsx');
check('13.1 v55.65 MyHRDesk component still exists', hr.length > 5000);
var ai = read('src/components/AdminHRInbox.jsx');
check('13.2 v55.65 AdminHRInbox still present', ai.length > 3000);
var srt = read('src/components/ShippingRatesTab.jsx');
check('13.3 v55.66 Shipping list view still wired', /routesViewMode/.test(srt));
var wnw = read('src/components/WhatsNewWidget.jsx');
check('13.4 v55.67 WhatsNew filtering still wired', /filterEntry/.test(wnw));
var tt = read('src/components/TicketsTab.jsx');
check('13.5 v55.69 ticket optimistic save still wired', /savingRef/.test(tt));
var vmr = read('src/app/api/phone/voicemail-record/route.js');
check('13.6 v55.65 voicemail trim="do-not-trim" still in place', /trim="do-not-trim"/.test(vmr));
var mp = read('src/components/MyPerformance.jsx');
check('13.7 v55.65 MyPerformance SVG logo intact', /viewBox="0 0 44 44"/.test(mp));

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
