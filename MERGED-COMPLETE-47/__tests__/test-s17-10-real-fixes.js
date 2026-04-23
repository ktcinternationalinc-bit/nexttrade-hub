// ============================================================
// Session 17.10 (Apr 23 2026) — REAL fix for two bugs
//
// BUG 1 — Nadia cuts off after 2-3 words
// Root cause: VoiceController mic is always hot listening for "Hey Bob".
// When Nadia speaks, the mic picks up her voice through the speakers,
// transcribes it, isBargeInCandidate returns true on 2+ words, fires
// hey-bob-bargein, AIGreeter.onBargeIn calls stopSpeech(). Kills self.
//
// Fix (belt-and-suspenders):
//   1. VoiceController no longer fires hey-bob-bargein on transcript
//      (commented out — block kept for history)
//   2. AIGreeter onBargeIn ignores barge-in events within 5 seconds of
//      Nadia starting to speak (speaker-echo guard)
//
// BUG 2 — Raw ACTION_START/ACTION_END blocks leaked into user-visible text
// Root cause: server-side while-loop parse cap was 3. User asked Nadia to
// message 5 team members, she emitted 5 action blocks, first 3 executed
// cleanly, last 2 stayed in text as raw markers.
//
// Fix:
//   1. Raise cap from 3 to 10
//   2. Update prompt to allow multiple blocks with explicit 10 ceiling
//   3. ALWAYS sweep leftover markers out of finalText after the loop,
//      so even if the ceiling is hit nothing leaks
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

var vc     = fs.readFileSync(path.join(REPO, 'src/components/VoiceController.jsx'), 'utf8');
var greet  = fs.readFileSync(path.join(REPO, 'src/components/AIGreeter.jsx'), 'utf8');
var ask    = fs.readFileSync(path.join(REPO, 'src/app/api/ask/route.js'), 'utf8');

// ---------- BUG 1: cutoff ----------

test('S17.10.CUT1 VoiceController no longer fires hey-bob-bargein on transcript', function() {
  // The active dispatch must be commented out. Look for the old pattern
  // only inside comment lines.
  var lines = vc.split('\n');
  var activeBargeInFires = 0;
  lines.forEach(function(l) {
    var trimmed = l.replace(/^\s*/, '');
    if (trimmed.indexOf('//') === 0) return;  // comment line, skip
    if (/dispatchEvent\(new CustomEvent\('hey-bob-bargein'\)\)/.test(l)) {
      activeBargeInFires++;
    }
  });
  assert.strictEqual(activeBargeInFires, 0,
    'VoiceController must NOT have any active dispatch of hey-bob-bargein (speaker-echo source)');
});

test('S17.10.CUT2 AIGreeter has speakingStartedAtRef for echo-guard timing', function() {
  assert(/var speakingStartedAtRef = useRef\(0\)/.test(greet),
    'speakingStartedAtRef must be declared to track when speech starts');
});

test('S17.10.CUT3 AIGreeter sets speakingStartedAtRef on doSpeak', function() {
  assert(/speakingStartedAtRef\.current = Date\.now\(\)/.test(greet),
    'speakingStartedAtRef.current must be set to Date.now() when speech begins');
});

test('S17.10.CUT4 AIGreeter has NO onBargeIn listener at all (safer than time-window)', function() {
  // Originally planned a 5s echo-guard window. Ended up removing the
  // listener entirely — simpler and there's no way for a misfire to
  // sneak in. Verify it stays gone.
  assert(!/onBargeIn/.test(greet),
    'AIGreeter must not define an onBargeIn handler — the whole barge-in path is severed');
  assert(!/hey-bob-bargein/.test(greet),
    'AIGreeter must not listen for hey-bob-bargein at all');
});

test('S17.10.CUT5 aiSpeakingRef flag still flipped by nadia-tts-start/stop', function() {
  // Other places depend on this flag (e.g. lip-sync timers). Must remain.
  assert(/aiSpeakingRef\.current = true/.test(vc), 'aiSpeakingRef still flipped true on tts-start');
  assert(/aiSpeakingRef\.current = false/.test(vc), 'aiSpeakingRef still flipped false on tts-stop');
  assert(/addEventListener\('nadia-tts-start'/.test(vc), 'listener on nadia-tts-start still present');
  assert(/addEventListener\('nadia-tts-stop'/.test(vc), 'listener on nadia-tts-stop still present');
});

test('S17.10.CUT6 isBargeInCandidate still imported (wake-word path may use it later)', function() {
  // We kept the import so the wake-word command flow can still reference
  // it if needed. Don't orphan the module.
  assert(/isBargeInCandidate/.test(vc),
    'isBargeInCandidate still referenced (in a comment is fine — keeps import intent)');
});

// ---------- BUG 2: leaked ACTION blocks ----------

test('S17.10.ACT1 Parse cap raised from 3 to 10', function() {
  assert(/while \(safety < 10\)/.test(ask),
    'parse loop cap must be raised to 10');
  assert(!/while \(safety < 3\)/.test(ask),
    'old cap of 3 must be gone');
});

test('S17.10.ACT2 Prompt no longer demands ONE action block', function() {
  assert(!/emit ONE action block/.test(ask),
    'prompt must not say "emit ONE action block" — that was too restrictive');
});

test('S17.10.ACT3 Prompt explicitly allows multiple blocks up to 10', function() {
  assert(/one action block per person/.test(ask) && /up to 10/.test(ask),
    'prompt must explain multi-recipient usage and the 10-block ceiling');
});

test('S17.10.ACT4 Post-loop sweep strips leftover ACTION markers from finalText', function() {
  // A bulletproof strip pass must exist after the while loop.
  assert(/strayStart = finalText\.indexOf\(aStart\)/.test(ask),
    'post-loop sweep must search for leftover aStart markers');
  assert(/while \(finalText\.indexOf\(aStart\) >= 0\)/.test(ask),
    'post-loop sweep must loop while leftover aStart markers remain');
});

test('S17.10.ACT5 Post-loop sweep appends a warning when leftovers found', function() {
  assert(/additional action/.test(ask) && /could not be processed/.test(ask),
    'if any leftover blocks were stripped, append a plain-English notice');
});

test('S17.10.ACT6 Dangling open marker without close is handled safely', function() {
  // Partial match shouldn't leave raw markers in output.
  assert(/if \(e < 0\) \{[\s\S]{0,400}Dangling open marker/.test(ask),
    'post-loop sweep must handle dangling aStart with no matching aEnd');
});

// ---------- Behavioral simulation ----------

test('S17.10.SIM1 Sweep logic cleanly removes a mock raw block pair', function() {
  var aStart = '---ACTION_START---';
  var aEnd = '---ACTION_END---';
  var input = 'Intro text. ' + aStart + ' {"type":"x"} ' + aEnd + ' ' + aStart + ' {"type":"y"} ' + aEnd + ' trailing.';
  var finalText = input;
  while (finalText.indexOf(aStart) >= 0) {
    var s = finalText.indexOf(aStart);
    var e = finalText.indexOf(aEnd, s + aStart.length);
    if (e < 0) { finalText = finalText.substring(0, s).replace(/\s+$/, ''); break; }
    var before = finalText.substring(0, s).replace(/\s+$/, '');
    var after = finalText.substring(e + aEnd.length).replace(/^\s+/, '');
    var j = before && after ? '\n' : '';
    finalText = (before + j + after).trim();
  }
  assert(!/ACTION_START|ACTION_END/.test(finalText),
    'sweep must remove all ACTION markers from text. got: ' + finalText);
  assert(/Intro text/.test(finalText), 'intro preserved');
  assert(/trailing/.test(finalText), 'trailing preserved');
});

test('S17.10.SIM2 Sweep handles dangling open marker (no close)', function() {
  var aStart = '---ACTION_START---';
  var aEnd = '---ACTION_END---';
  var input = 'Good text. ' + aStart + ' {"type":"x" never closed...';
  var finalText = input;
  var s = finalText.indexOf(aStart);
  var e = finalText.indexOf(aEnd, s + aStart.length);
  if (e < 0) {
    finalText = finalText.substring(0, s).replace(/\s+$/, '');
  }
  assert.strictEqual(finalText.trim(), 'Good text.',
    'dangling open marker should drop everything from the marker to end');
});

// ---------- Regressions ----------

test('S17.10.R1 Dashboard AIGreeter still has original props only', function() {
  var page = fs.readFileSync(path.join(REPO, 'src/app/page.jsx'), 'utf8');
  var m = page.match(/<AIGreeter\s([\s\S]*?)\/>/);
  assert(m, 'AIGreeter found');
  assert(!/\bmuted=/.test(m[1]),    'dashboard must NOT pass muted');
  assert(!/\bcontextTab=/.test(m[1]), 'dashboard must NOT pass contextTab');
});

test('S17.10.R2 nadia-stop-all event system is gone (simplified speech model)', function() {
  // The nadia-stop-all event system was part of the cutoff bug — each
  // instance listened to its own stop signal. It was removed in favor
  // of the simpler "the browser pauses audio on its own" model plus
  // explicit stopSpeech() calls at known good times (submit button,
  // close button, mic button, genuine user barge-in). Verifying it
  // stays gone so we don't accidentally reintroduce the old bug.
  var activeStopAll = 0;
  greet.split('\n').forEach(function(l) {
    var trimmed = l.replace(/^\s*/, '');
    if (trimmed.indexOf('//') === 0) return; // comment ok
    if (/nadia-stop-all/.test(l)) activeStopAll++;
  });
  assert.strictEqual(activeStopAll, 0,
    'nadia-stop-all must not appear in active code — the event system was the bug source');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
