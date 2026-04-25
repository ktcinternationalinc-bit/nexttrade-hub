// ============================================================
// v54.6 — `lang` ReferenceError + Nadia wake-ack stuck-stop bug
// ============================================================
//
// Bug 1: Clicking any event in the bottom-of-calendar list (or anywhere
//        Cancel/Decline button shows) crashed with "ReferenceError: lang
//        is not defined". The variable was used 28+ times but never
//        declared. This is the root cause of "no delete button visible"
//        — React stopped rendering the component the moment the error
//        threw, so the modal that contains the buttons never appeared.
//
// Bug 2: After "Hey Nadia" → ack, Nadia stays silent. Root cause: the
//        wake-ack handler un-paused her but didn't clear the hard-stop
//        state. If the user previously said "stop for 30 min", doSpeak's
//        stopped-gate silenced both the ack AND every follow-up command.
//        Symptom: she's totally non-responsive until the 30-min window
//        expires naturally.
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

var calendar = fs.readFileSync(path.join(REPO, 'src/components/CalendarTab.jsx'), 'utf8');
var greeter  = fs.readFileSync(path.join(REPO, 'src/components/AIGreeter.jsx'), 'utf8');

// ===== BUG 1: lang declared =====

test('L1 `lang` is declared at the top of CalendarTab', function() {
  // Must appear BEFORE any usage of `lang === 'ar'`. Read profile,
  // fall back to 'en'.
  assert(/const lang = \(userProfile && userProfile\.preferred_language === 'ar'\) \? 'ar' : 'en';/.test(calendar),
    'lang declared with safe fallback');
});

test('L2 lang declaration appears BEFORE any reference to `lang === \'ar\'`', function() {
  var declIdx = calendar.indexOf("const lang = (userProfile && userProfile.preferred_language === 'ar')");
  assert(declIdx > -1, 'lang declaration found');
  // Find first usage that's not in a comment
  var firstUse = -1;
  var lines = calendar.split('\n');
  var charCount = 0;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (/lang === 'ar'/.test(line) && !line.trim().startsWith('//')) {
      // Ignore the declaration itself
      if (!/const lang =/.test(line)) {
        firstUse = charCount;
        break;
      }
    }
    charCount += line.length + 1;
  }
  assert(firstUse > declIdx, 'all uses of lang === "ar" come after the declaration');
});

test('L3 No reference to undeclared `lang` survives at top level', function() {
  // Quick smoke test: count occurrences of `lang === 'ar'` and verify
  // at least one declaration handles them.
  var uses = (calendar.match(/lang === 'ar'/g) || []).length;
  assert(uses >= 10, 'lang === "ar" usage exists');
  var decls = (calendar.match(/const lang = /g) || []).length;
  assert(decls >= 1, 'at least one const lang = declaration');
});

// ===== BUG 2: Wake-ack clears hard-stop =====

test('N1 onWakeAck clears hard-stopped state (setStoppedUntil(0))', function() {
  var m = greeter.match(/var onWakeAck = function\(\) \{[\s\S]*?\};/);
  assert(m, 'onWakeAck handler found');
  assert(/setStoppedUntil\(0\)/.test(m[0]),
    'onWakeAck must reset the hard-stop window');
  assert(/stoppedRef\.current = 0/.test(m[0]),
    'onWakeAck must reset the ref too');
});

test('N2 onWakeAck removes the persisted stop-key from localStorage', function() {
  var m = greeter.match(/var onWakeAck = function\(\) \{[\s\S]*?\};/);
  assert(m, 'handler');
  assert(/localStorage\.removeItem\(STOP_KEY\)/.test(m[0]),
    'persisted stop window cleared so it does not return on next page load');
});

test('N3 onWakeAck still un-pauses (regression check for the older fix)', function() {
  var m = greeter.match(/var onWakeAck = function\(\) \{[\s\S]*?\};/);
  assert(m, 'handler');
  assert(/setPaused\(false\); pausedRef\.current = false/.test(m[0]),
    'paused state still cleared');
});

test('N4 onWakeAck calls doSpeak AFTER all silencing states are cleared', function() {
  var m = greeter.match(/var onWakeAck = function\(\) \{[\s\S]*?\};/);
  assert(m, 'handler');
  var body = m[0];
  var unpauseIdx = body.indexOf('pausedRef.current = false');
  var unstopIdx = body.indexOf('stoppedRef.current = 0');
  var speakIdx = body.indexOf('doSpeak(ack)');
  assert(unpauseIdx > -1 && unstopIdx > -1 && speakIdx > -1, 'all key calls present');
  assert(unpauseIdx < speakIdx, 'unpause before doSpeak');
  assert(unstopIdx < speakIdx, 'un-stop before doSpeak (otherwise ack would be silenced)');
});

console.log('');
console.log('──────────────────────────────────────────────────');
console.log('V54.6 — `lang` REFERROR + WAKE-ACK STUCK-STOP FIX');
console.log('──────────────────────────────────────────────────');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) { console.log('\n❌ FAILURES'); process.exit(1); }
else console.log('\n✅ All v54.6 tests passed');
