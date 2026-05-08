// ============================================================
// CHANGE-SPECIFIC tests — Prevailing avatars + floating quick-access
//
// Max May 7 2026: "The icons have to be very prevailing because
// sometimes I'm looking for Nadia so I can ask her a question and
// I can't find her in the dashboard. I should be in big icons. I
// can scroll all the way up and I could see them and I can ask a
// question if she's not appearing in the dashboard I can open her
// I can activate her."
//
// Two changes scoped to this:
//   1. Avatars made bigger / more prevailing (maxWidth 200→320, padding
//      bumped, name text 2xl→3xl/4xl, role badge bigger).
//   2. NEW floating quick-access trio appears in fixed bottom-right after
//      scrolling past 400px. One tap → smooth-scroll back to top + auto-
//      open that assistant's panel.
//
// NOTE per Max's workflow rule: this suite runs ONLY for this change.
// Full suite runs only when Max says "BUILD".
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
console.log('CHANGE-SPECIFIC: Prevailing avatars + floating quick-access');
console.log('============================================================');

var ab = read('src/components/AssistantsBar.jsx');

// ============================================================
// 1. Tile sizing made more prevailing
// ============================================================
group('1. Avatars are now prevailing (bigger)');

check('1.1 Avatar maxWidth bumped to 320px (was 200)',
  /maxWidth: 320, aspectRatio: '1 \/ 1'/.test(ab));
check('1.2 Tile padding bumped to p-4 sm:p-6 (was p-3 sm:p-4)',
  /rounded-3xl p-4 sm:p-6 transition-all/.test(ab));
check('1.3 Name text scaled up to text-3xl sm:text-4xl (was text-2xl sm:text-3xl)',
  /<h3 className="text-3xl sm:text-4xl font-extrabold text-white">/.test(ab));
check('1.4 Role badge text scaled up to text-xs (was text-[10px])',
  /<span className="text-xs font-bold uppercase tracking-wide px-2\.5 py-1 rounded-full bg-white\/30 backdrop-blur text-white">/.test(ab));
check('1.5 Summary line text scaled up to text-sm (was text-xs)',
  /<p className="text-sm text-white font-semibold mt-2 px-2 leading-snug min-h-\[2\.5em\]"/.test(ab));
check('1.6 Notification badge bumped to h-7 + px-2.5 (was h-6 + px-2)',
  /absolute top-3 right-3 px-2\.5 min-w-\[28px\] h-7 rounded-full text-white text-sm/.test(ab));
check('1.7 Default shadow upgraded to shadow-lg + hover:shadow-2xl',
  /hover:shadow-2xl hover:-translate-y-1 ring-2 ring-transparent shadow-lg/.test(ab));
check('1.8 Comment notes the "PREVAILING" intent for traceability',
  /v55\.71 PREVAILING/.test(ab));

// ============================================================
// 2. Floating quick-access bar (scroll-triggered)
// ============================================================
group('2. Floating quick-access trio after scroll');

check('2.1 showFloating state declared',
  /\[showFloating, setShowFloating\] = useState\(false\)/.test(ab));
check('2.2 Scroll listener wires window.addEventListener("scroll")',
  /window\.addEventListener\('scroll', onScroll, \{ passive: true \}\)/.test(ab));
check('2.3 Threshold is 400px (well past hero tiles)',
  /window\.scrollY > 400/.test(ab));
check('2.4 Scroll listener cleans up on unmount',
  /window\.removeEventListener\('scroll', onScroll\)/.test(ab));
check('2.5 Listener uses passive: true for scroll perf',
  /\{ passive: true \}/.test(ab));
check('2.6 SSR-safe: typeof window check before adding listener',
  /var onScroll = function[\s\S]{0,300}if \(typeof window === 'undefined'\) return;|if \(typeof window === 'undefined'\) return;[\s\S]{0,200}var onScroll/.test(ab));
check('2.7 Floating bar fixed bottom-right, z-50 (above other content)',
  /fixed bottom-4 right-4 z-50/.test(ab));
check('2.8 Floating bar only renders when showFloating === true',
  /\{showFloating && \(/.test(ab));

// ============================================================
// 3. Floating bar contains all three assistants
// ============================================================
group('3. Floating bar shows Nadia + Jenna + Sara');

check('3.1 FloatingMini for Nadia',
  /<FloatingMini who="nadia" label="Nadia"/.test(ab));
check('3.2 FloatingMini for Jenna',
  /<FloatingMini who="jenna" label="Jenna"/.test(ab));
check('3.3 FloatingMini for Sara',
  /<FloatingMini who="sara" label="Sara"/.test(ab));
check('3.4 FloatingMini component defined',
  /^function FloatingMini\(props\) \{/m.test(ab));

// ============================================================
// 4. jumpAndOpen behavior — scroll back AND open panel
// ============================================================
group('4. Click any floating mini → scroll up + open');

check('4.1 jumpAndOpen function defined',
  /var jumpAndOpen = function \(who\) \{/.test(ab));
check('4.2 jumpAndOpen scrolls to top with smooth behavior',
  /window\.scrollTo\(\{ top: 0, behavior: 'smooth' \}\)/.test(ab));
check('4.3 jumpAndOpen calls setOpenPanel(who) to expand the right one',
  /jumpAndOpen = function \(who\) \{[\s\S]{0,500}setOpenPanel\(who\)/.test(ab));
check('4.4 jumpAndOpen("nadia") also fires onTalkToNadia for chat focus',
  /jumpAndOpen = function \(who\) \{[\s\S]{0,800}who === 'nadia' && onTalkToNadia/.test(ab));
check('4.5 scrollTo wrapped in try/catch (no crash on old browsers)',
  /try \{[\s\S]{0,150}window\.scrollTo\(\{ top: 0/.test(ab));
check('4.6 Each FloatingMini onClick wires jumpAndOpen with its who',
  /onClick=\{function \(\) \{ jumpAndOpen\('nadia'\); \}\}/.test(ab)
  && /onClick=\{function \(\) \{ jumpAndOpen\('jenna'\); \}\}/.test(ab)
  && /onClick=\{function \(\) \{ jumpAndOpen\('sara'\); \}\}/.test(ab));

// ============================================================
// 5. FloatingMini visual + accessibility
// ============================================================
group('5. FloatingMini visual + a11y');

check('5.1 FloatingMini has title attribute (browser tooltip)',
  /title=\{'Jump to ' \+ props\.label\}/.test(ab));
check('5.2 FloatingMini has aria-label for screen readers',
  /aria-label=\{'Jump to ' \+ props\.label\}/.test(ab));
check('5.3 Visible 14×14 (56px) circular avatar — small but tappable',
  /w-14 h-14 rounded-full shadow-xl ring-4 ring-white/.test(ab));
check('5.4 Hover-revealed label slides in for clarity',
  /opacity-0 group-hover:opacity-100 translate-x-2 group-hover:translate-x-0 transition-all/.test(ab));
check('5.5 Mini avatar has notification badge if items waiting',
  /props\.badge > 0 && \(/.test(ab));
check('5.6 Notification badge pulses if pulse prop is true',
  /props\.pulse \? ' animate-pulse' : ''/.test(ab));
check('5.7 Hover scales up the avatar (hover:scale-110)',
  /hover:scale-110/.test(ab));

// ============================================================
// 6. Wiring — counts and gradients passed correctly per assistant
// ============================================================
group('6. Floating mini receives correct per-assistant data');

check('6.1 Nadia mini gets nadiaUrgentCount as badge',
  /<FloatingMini who="nadia"[\s\S]{0,200}badge=\{nadiaUrgentCount\}/.test(ab));
check('6.2 Nadia mini gets pulse=true (always pulsing on urgent)',
  /<FloatingMini who="nadia"[\s\S]{0,200}pulse=\{true\}/.test(ab));
check('6.3 Jenna mini sums pendingReq + pendingCmp + newResponses',
  /<FloatingMini who="jenna"[\s\S]{0,300}badge=\{jennaSummary\.newResponses \+ jennaSummary\.pendingReq \+ jennaSummary\.pendingCmp\}/.test(ab));
check('6.4 Jenna mini pulses only when newResponses > 0',
  /<FloatingMini who="jenna"[\s\S]{0,200}pulse=\{jennaSummary\.newResponses > 0\}/.test(ab));
check('6.5 Sara mini badge is 1 if not seen today, 0 otherwise',
  /<FloatingMini who="sara"[\s\S]{0,200}badge=\{saraSeenToday \? 0 : 1\}/.test(ab));
check('6.6 Sara mini gradient cyan→indigo matches her main tile',
  /<FloatingMini who="sara"[\s\S]{0,400}bg="linear-gradient\(135deg, #06b6d4, #6366f1\)"/.test(ab));
check('6.7 Nadia mini gradient indigo→pink matches main tile',
  /<FloatingMini who="nadia"[\s\S]{0,400}bg="linear-gradient\(135deg, #6366f1, #ec4899\)"/.test(ab));
check('6.8 Jenna mini gradient amber→fuchsia matches main tile',
  /<FloatingMini who="jenna"[\s\S]{0,400}bg="linear-gradient\(135deg, #f59e0b, #d946ef\)"/.test(ab));

// ============================================================
// 7. Doesn't break existing v55.71 architecture
// ============================================================
group('7. Existing v55.71 architecture intact');

check('7.1 Three Tiles still rendered (Nadia/Jenna/Sara)',
  /<Tile[\s\S]{0,200}who="nadia"/.test(ab)
  && /<Tile[\s\S]{0,200}who="jenna"/.test(ab)
  && /<Tile[\s\S]{0,200}who="sara"/.test(ab));
check('7.2 togglePanel logic still in place',
  /var togglePanel = function \(which\) \{/.test(ab));
check('7.3 Nadia auto-open on first daily load preserved (v55.80 BD-audit: defaults to "nadia")',
  /var \[openPanel, setOpenPanel\] = useState\('nadia'\)/.test(ab));
check('7.4 MyHRDesk still mounts inside Jenna panel',
  /openPanel === 'jenna'[\s\S]{0,1500}<MyHRDesk/.test(ab));
check('7.5 MyPerformance still mounts inside Sara panel',
  /openPanel === 'sara'[\s\S]{0,1500}<MyPerformance/.test(ab));
check('7.6 Wave animation state untouched',
  /\[waveState, setWaveState\] = useState\(\{ nadia: false, jenna: false, sara: false \}\)/.test(ab));
check('7.7 PREVAILING comment block is in place for context',
  /Max May 7 2026: "icons have to be very prevailing"/.test(ab));

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
