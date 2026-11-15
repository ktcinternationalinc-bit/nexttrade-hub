// ============================================================
// v54.2 — Wake-listen root cause + autoplay unlock banner
// ============================================================
// Problems in v53/v54:
//   1. "Hey Nadia → I'm here → user speaks → silence"
//      - VoiceController's self-suppress check dropped the user's
//        command arriving 500-2000ms after her "I'm here" ack.
//      - AIGreeter's onBobCommand had a REDUNDANT suppress re-check
//        that dropped the command even if it got past VoiceController.
//
//   2. "She doesn't greet on morning login"
//      - Browser autoplay policy blocks audio.play() on fresh page
//        load. The greeting text appeared but audio was silent.
//
// Fixes in v54.2:
//   - Tail suppression reduced from 3000ms to 500ms (real echo is brief)
//   - VoiceController lets wake-word matches through during suppress
//   - AIGreeter.onBobCommand no longer re-checks suppress
//   - Autoplay-blocked detection + "Tap to hear" unlock banner
// ============================================================

var fs = require('fs');
var path = require('path');
var assert = require('assert');
var REPO = path.resolve(__dirname, '..');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('✓ ' + name); passed++; }
  catch (e) { console.log('✗ ' + name + ' — ' + e.message); failed++; }
}

var greeter = fs.readFileSync(path.join(REPO, 'src/components/AIGreeter.jsx'), 'utf8');
var vc      = fs.readFileSync(path.join(REPO, 'src/components/VoiceController.jsx'), 'utf8');

// ===== WAKE-LISTEN FIX =====

test('W1 SELF_SUPPRESS_MS reduced from 3000 to 500', function() {
  assert(/var SELF_SUPPRESS_MS = 500/.test(greeter),
    'tail is 500ms (real mic echo is under 500ms; longer was eating real commands)');
  assert(!/var SELF_SUPPRESS_MS = 3000/.test(greeter),
    'old 3000ms value gone');
});

test('W2 VoiceController lets wake-words through during self-suppress', function() {
  // The old check `if (selfSuppressUntilRef.current && ... ) return;` gated
  // the entire onresult before any transcript parsing. New code parses
  // transcript FIRST, then only drops non-wake-word matches during suppress.
  var m = vc.match(/rec\.onresult = function\(ev\) \{[\s\S]*?if \(selfSuppressUntilRef\.current && Date\.now\(\) < selfSuppressUntilRef\.current\)[\s\S]*?\}/);
  assert(m, 'suppress check still present');
  // It must contain a wake-word check, not just a blanket return
  assert(/detectWakeWord\(transcript\)/.test(m[0]),
    'parses transcript before deciding');
  assert(/if \(!inSuppressCheck\.matched\) \{[\s\S]{0,100}return/.test(m[0]),
    'only drops NON-wake transcripts during suppress');
});

test('W3 AIGreeter onBobCommand no longer re-checks self-suppress', function() {
  // By the time onBobCommand fires, VoiceController already decided the
  // event was legit. Re-checking was dropping commands that arrived in
  // the tail window.
  var m = greeter.match(/var onBobCommand = function\(ev\)[\s\S]*?if \(doSendRef\.current\) doSendRef\.current\(cmd, false\);/);
  assert(m, 'onBobCommand body found');
  // The actual suppress check must be commented out (or gone)
  assert(/REMOVED redundant self-suppress check/.test(m[0]),
    'explicit removal note present so future maintainers know why');
  // There must not be a LIVE `if (selfSuppressUntilRef.current ...) return;`
  // inside this handler
  var lines = m[0].split('\n').filter(function(l) { return l.trim() && !l.trim().startsWith('//'); });
  var suppressActive = lines.some(function(l) {
    return /if \(selfSuppressUntilRef\.current.*Date\.now\(\).*selfSuppressUntilRef\.current\) \{/.test(l)
        || /if \(selfSuppressUntilRef\.current && Date\.now\(\) < selfSuppressUntilRef\.current\) return/.test(l);
  });
  assert(!suppressActive,
    'no LIVE suppress-check that would drop commands (commented-out lines ignored)');
});

test('W4 VoiceController imports detectWakeWord (needed for in-suppress check)', function() {
  assert(/import \{ [^}]*detectWakeWord/.test(vc),
    'detectWakeWord available for the in-suppress check');
});

// ===== AUTOPLAY UNLOCK =====

test('AP1 autoplayBlocked state + pendingAutoplayRef declared', function() {
  assert(/\[autoplayBlocked, setAutoplayBlocked\] = useState\(false\)/.test(greeter),
    'state for the banner');
  assert(/var pendingAutoplayRef = useRef\(null\)/.test(greeter),
    'ref holds the queued audio so it can play after user tap');
});

test('AP2 audio.play().catch detects autoplay policy errors and queues for later', function() {
  var m = greeter.match(/audio\.play\(\)\.catch\(function\(err\) \{[\s\S]*?\}\);/);
  assert(m, 'catch handler');
  // Must check NotAllowedError / AbortError (the two autoplay-block errors)
  assert(/err\.name === 'NotAllowedError' \|\| err\.name === 'AbortError'/.test(m[0]),
    'checks for autoplay-specific error names');
  // On autoplay block: queue + set banner flag
  assert(/pendingAutoplayRef\.current = \{ text: text, blob: blob, url: url \}/.test(m[0]),
    'queues the pending audio');
  assert(/setAutoplayBlocked\(true\)/.test(m[0]),
    'flips banner flag');
});

test('AP3 Non-autoplay errors still fall back to SpeechSynthesis', function() {
  var m = greeter.match(/audio\.play\(\)\.catch\(function\(err\) \{[\s\S]*?\}\);/);
  assert(m, 'catch handler');
  // For non-autoplay errors: fall through to doFallbackSpeak
  assert(/} else \{[\s\S]{0,100}doFallbackSpeak\(text\)/.test(m[0]),
    'non-autoplay path still uses browser SpeechSynthesis');
});

test('AP4 Tap-to-hear banner renders when autoplayBlocked is true', function() {
  assert(/\{autoplayBlocked && !speaking && \(/.test(greeter),
    'banner gated on autoplayBlocked state');
  assert(/Tap to hear Nadia/.test(greeter),
    'English banner label');
  assert(/اضغط لسماع تحية ناديا/.test(greeter),
    'Arabic banner label');
});

test('AP5 Tap on banner plays the queued audio and clears the banner', function() {
  var m = greeter.match(/\{autoplayBlocked && !speaking && \(\s*<button\s*onClick=\{function\(\) \{[\s\S]*?\}\}/);
  assert(m, 'tap handler');
  assert(/var queued = pendingAutoplayRef\.current/.test(m[0]),
    'reads queued audio');
  assert(/setAutoplayBlocked\(false\)/.test(m[0]),
    'clears banner');
  assert(/new Audio\(queued\.url\)/.test(m[0]),
    'plays queued audio (user gesture unlocks it)');
});

console.log('');
console.log('──────────────────────────────────────────────────');
console.log('V54.2 — WAKE-LISTEN + AUTOPLAY UNLOCK');
console.log('──────────────────────────────────────────────────');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) { console.log('\n❌ FAILURES'); process.exit(1); }
else console.log('\n✅ All v54.2 tests passed');
