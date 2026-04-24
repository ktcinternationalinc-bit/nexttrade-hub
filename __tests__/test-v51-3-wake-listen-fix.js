// ============================================================
// v51.3 — "Hey Nadia wakes but can't hear command" bug fix
// ============================================================
// ROOT CAUSE: When the user said "Hey Nadia" (especially during
// hard-stop), Nadia spoke an acknowledgment ("I'm here") via doSpeak.
// doSpeak set the self-suppress window to `now + 30000ms` as an upper
// bound, meant to be shortened when TTS actually ended. But the onStop
// handler was taking MAX of current vs new (floor-only), so the 30s
// upper bound stayed in place. Result: the mic was deaf for 30 seconds
// after EVERY ack, dropping the user's follow-up command.
//
// FIX: On TTS stop, REPLACE the suppress window with now+tail (3s),
// not floor-max. On start we still take-max so rapid start/stop events
// can't shrink the safety window mid-speech.
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

test('W1 AIGreeter fireStop REPLACES suppress window (not take-max)', function() {
  var m = greeter.match(/var fireStop = function\(\) \{[\s\S]*?\n    \};/);
  assert(m, 'fireStop defined');
  assert(/selfSuppressUntilRef\.current = stopUntil/.test(m[0]),
    'direct assignment on stop so mic frees up after ~3s tail');
  assert(!/if \(stopUntil > selfSuppressUntilRef\.current\) selfSuppressUntilRef\.current = stopUntil/.test(m[0]),
    'must NOT take-max; that kept the mic deaf for 30s after ack');
});

test('W2 AIGreeter onStart still uses floor-only (30s safety upper bound)', function() {
  // Start must remain floor-only — a quick onStart→onStop cycle during
  // a long TTS must not shrink the suppress window.
  assert(/startUntil = Date\.now\(\) \+ 30 \* 1000/.test(greeter),
    '30s upper bound still set on start');
  assert(/startUntil > selfSuppressUntilRef\.current\) selfSuppressUntilRef\.current = startUntil/.test(greeter),
    'floor-only on start kept');
});

test('W3 VoiceController onStop REPLACES suppress (not take-max)', function() {
  var m = vc.match(/var onStop  = function\(ev\) \{[\s\S]*?\};/);
  assert(m, 'onStop defined');
  assert(/if \(until\) selfSuppressUntilRef\.current = until/.test(m[0]),
    'direct assignment so stop event actually trims the window');
  assert(!/if \(until && until > selfSuppressUntilRef\.current\) selfSuppressUntilRef\.current = until/.test(m[0]),
    'must NOT take-max on stop');
});

test('W4 VoiceController onStart still uses floor-only', function() {
  var m = vc.match(/var onStart = function\(ev\) \{[\s\S]*?\};/);
  assert(m, 'onStart defined');
  assert(/if \(until && until > selfSuppressUntilRef\.current\) selfSuppressUntilRef\.current = until/.test(m[0]),
    'floor-only on start kept');
});

test('W5 Hard-stop wake path falls through to wake engine', function() {
  // When hard-stopped and wake word IS detected, code should NOT return —
  // it should fall through to engineRef.current.process() below.
  var m = vc.match(/if \(hardStopUntilRef\.current && Date\.now\(\) < hardStopUntilRef\.current\) \{[\s\S]*?\}\s*\n\s*setLastTranscript/);
  assert(m, 'hard-stop block present');
  assert(!/return[;\s]*\n[\s\S]*?setLastTranscript/.test(m[0]),
    'must NOT return on wake-matched — must fall through');
});

test('W6 Wake-ack does not prevent the next command from being heard', function() {
  // After doSpeak("I'm here") fires, fireStop sets selfSuppress to now+3s.
  // The user's command arriving ~2-4s after ack should then not be
  // suppressed. Verified structurally: fireStop uses SELF_SUPPRESS_MS,
  // which is 3000ms.
  assert(/var SELF_SUPPRESS_MS = 3000/.test(greeter),
    'tail is 3 seconds, matching typical time between "Hey Nadia" ack and the command');
});

console.log('');
console.log('──────────────────────────────────────────────────');
console.log('V51.3 — WAKE-WORD LISTEN-AFTER-ACK BUG FIX');
console.log('──────────────────────────────────────────────────');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) { console.log('\n❌ FAILURES'); process.exit(1); }
else console.log('\n✅ All v51.3 tests passed');
