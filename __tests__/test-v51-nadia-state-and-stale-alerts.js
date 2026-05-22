// ============================================================
// v51 (Apr 24 2026) — Nadia state-machine & stale alerts tests
//
// Covers:
//   STALE ALERTS
//    1. Alerts are cross-checked against live ticket state
//    2. Unack alerts are auto-dismissed when ticket.status !== 'New'
//    3. Overdue alerts auto-dismiss when due_date is no longer past
//    4. Closed tickets auto-dismiss any ticket alert
//    5. Stale IDs get upserted with acknowledged=true
//    6. Surviving alerts still get injected into context
//
//   HARD STOP STATE (30-min sleep)
//    7. STOP_KEY constant present
//    8. 30-minute window constant present
//    9. stoppedUntil state + ref declared
//   10. Persisted to localStorage on goStopped
//   11. Auto-expire timer clears on end of window
//   12. doSpeak blocks while stoppedRef.current > Date.now()
//   13. Initial auto-greeting blocks during hard stop
//   14. Tab-aware greeting blocks during hard stop
//   15. Wake-word commands ignored during hard stop
//   16. goStopped clears paused (mutually exclusive)
//   17. Hard-stop banner renders with countdown
//   18. Wake-up button clears stopped state
//
//   SELF-SUPPRESSION
//   19. selfSuppressUntilRef declared in AIGreeter
//   20. setSpeaking(true) sets an initial suppression window
//   21. fireStop extends suppression with tail buffer
//   22. Wake-word handler checks selfSuppress before processing
//   23. VoiceController reads detail.until from nadia-tts-start
//   24. VoiceController reads detail.until from nadia-tts-stop
//   25. VoiceController onresult drops events in suppression window
//
//   COORDINATION
//   26. goStopped dispatches nadia-stop-hard event with until
//   27. wakeFromStopped dispatches nadia-stop-wake event
//   28. VoiceController listens to both hard-stop events
//   29. VoiceController onresult drops events during hard stop
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
var askRoute = fs.readFileSync(path.join(REPO, 'src/app/api/ask/route.js'), 'utf8');

// ===== STALE ALERTS =====
test('A1 Alerts query includes related_entity_id for cross-check', function() {
  assert(/from\('ai_alerts'\)[\s\S]*?related_entity_id/.test(askRoute),
    'alerts query must select related_entity_id');
});

test('A2 Unack alerts flagged stale when ticket.status !== New', function() {
  assert(/at\.indexOf\('unack'\) >= 0 && t\.status && t\.status !== 'New'/.test(askRoute),
    'must match on unack type + non-New status');
});

test('A3 Overdue alerts flagged stale when due_date is in the future', function() {
  assert(/at\.indexOf\('overdue'\) >= 0[\s\S]*?t\.due_date && t\.due_date >= today/.test(askRoute),
    'overdue logic must check due_date >= today');
});

test('A4 Closed tickets flagged stale for any ticket-related alert', function() {
  assert(/at\.indexOf\('ticket'\) >= 0 && t\.status === 'Closed'/.test(askRoute),
    'must drop generic ticket alerts on Closed status');
});

test('A5 Stale IDs get upserted with acknowledged=true', function() {
  assert(/\.update\(\{ acknowledged: true, acknowledged_at:/.test(askRoute),
    'must write acknowledged=true + timestamp');
  assert(/\.in\('id', staleIds\)/.test(askRoute),
    'must filter to the stale ids only');
});

test('A6 Surviving alerts still get injected', function() {
  assert(/watcherAlerts = rawAlerts[\s\S]*?\.filter\(function\(a\) \{ return staleIds\.indexOf\(a\.id\) === -1/.test(askRoute),
    'final list must exclude stale ids but keep the rest');
});

// ===== HARD STOP (30-min sleep) =====
test('HS1 STOP_KEY constant defined', function() {
  assert(/var STOP_KEY = 'nadia:stoppedUntil'/.test(greeter),
    'localStorage key must be declared');
});

test('HS2 30-minute window constant declared', function() {
  assert(/STOP_WINDOW_MS = 30 \* 60 \* 1000/.test(greeter),
    'sleep window must be 30 minutes');
});

test('HS3 stoppedUntil state + ref declared', function() {
  assert(/\[stoppedUntil, setStoppedUntil\] = useState\(0\)/.test(greeter),
    'stoppedUntil state present');
  assert(/stoppedRef = useRef\(0\)/.test(greeter),
    'stoppedRef present for handler closures');
});

test('HS4 goStopped persists to localStorage', function() {
  assert(/localStorage\.setItem\(STOP_KEY, String\(until\)\)/.test(greeter),
    'goStopped must persist the until timestamp');
});

test('HS5 Auto-expire timer clears localStorage', function() {
  var m = greeter.match(/useEffect\(function\(\) \{[\s\S]*?stoppedUntil - Date\.now\(\)[\s\S]*?setTimeout\(function\(\) \{[\s\S]*?\}, remaining\)/);
  assert(m, 'auto-expire effect present');
  assert(/localStorage\.removeItem\(STOP_KEY\)/.test(greeter), 'removes the persisted key on expiry');
});

test('HS6 doSpeak blocks while stopped window is active', function() {
  assert(/stoppedRef\.current && stoppedRef\.current > Date\.now\(\)[\s\S]*?sleeping until/.test(greeter),
    'doSpeak guard must check stoppedRef');
});

test('HS7 Initial auto-greeting blocks during hard stop', function() {
  var m = greeter.match(/if \(hasGreeted \|\| !enabled \|\| !loginHistoryLoaded\) return;[\s\S]*?setTimeout\(function\(\) \{[\s\S]*?doSend\(null, true\)/);
  assert(m, 'initial greeting effect present');
  assert(/stoppedRef\.current && stoppedRef\.current > Date\.now\(\)/.test(m[0]),
    'initial greeting must skip when stopped');
});

test('HS8 Tab-aware greeting blocks during hard stop', function() {
  assert(/if \(stoppedRef\.current && stoppedRef\.current > Date\.now\(\)\) return;/.test(greeter),
    'tab-change greeting must skip when stopped');
});

test('HS9 Wake-word during stop immediately wakes Nadia (v51.1)', function() {
  // "Hey Nadia" must bypass the hard-stop guard. AIGreeter now clears
  // stopped state in the wake-word handler rather than dropping it.
  assert(/wake-word during stop window → waking immediately/.test(greeter),
    'explicit log for wake-word-wakes-her behavior');
  // And it must actually clear the stopped state inline
  assert(/if \(stoppedRef\.current && stoppedRef\.current > Date\.now\(\)\) \{[\s\S]{0,600}setStoppedUntil\(0\)/.test(greeter),
    'wake-word handler must clear stopped state when firing during stop window');
});

test('HS10 goStopped clears paused state', function() {
  // v51.2: signature changed to goStopped(customMinutes). Match either form.
  var m = greeter.match(/var goStopped = function\([^)]*\) \{[\s\S]*?\n  \};/);
  assert(m, 'goStopped defined');
  assert(/setPaused\(false\)[\s\S]*?pausedRef\.current = false/.test(m[0]),
    'goStopped must clear paused (mutually exclusive)');
});

test('HS11 Hard-stop banner renders with countdown', function() {
  assert(/stoppedUntil > Date\.now\(\)[\s\S]*?remainingMin/.test(greeter),
    'banner conditional + countdown variable present');
  assert(/Nadia is sleeping/.test(greeter),
    'English copy present');
});

test('HS12 Wake-up button clears stopped state', function() {
  var m = greeter.match(/var wakeFromStopped = function\(\) \{[\s\S]*?\};/);
  assert(m, 'wakeFromStopped defined');
  assert(/setStoppedUntil\(0\)/.test(m[0]),
    'must clear stoppedUntil');
  assert(/localStorage\.removeItem\(STOP_KEY\)/.test(m[0]),
    'must remove persisted key');
});

// ===== SELF-SUPPRESSION =====
test('SS1 AIGreeter has selfSuppressUntilRef', function() {
  assert(/selfSuppressUntilRef = useRef\(0\)/.test(greeter), 'ref declared');
});

test('SS2 setSpeaking(true) sets initial suppression window (floor-only)', function() {
  // start remains floor-only to protect mid-speech. v51.3 didn't change this side.
  var m = greeter.match(/setSpeaking\(true\);[\s\S]{0,1800}/);
  assert(m, 'setSpeaking(true) found');
  assert(/startUntil = Date\.now\(\) \+ 30 \* 1000/.test(m[0]),
    'still sets an initial 30s upper bound');
  assert(/startUntil > selfSuppressUntilRef\.current\) selfSuppressUntilRef\.current = startUntil/.test(m[0]),
    'uses floor-only update so a shorter window cannot shrink it mid-speech');
});

test('SS3 fireStop REPLACES suppression with now+tail (v51.3 fix)', function() {
  // v51.3: changed from floor-only back to direct assignment on stop,
  // so when TTS actually ends, the 30s upper bound set at start gets
  // trimmed down to 3s tail. Without this, the mic was deaf for 30s
  // after every ack — dropping the user command.
  assert(/stopUntil = Date\.now\(\) \+ SELF_SUPPRESS_MS/.test(greeter),
    'fireStop computes tail-end target');
  var m = greeter.match(/var fireStop = function\(\) \{[\s\S]*?\n    \};/);
  assert(m, 'fireStop body');
  assert(/selfSuppressUntilRef\.current = stopUntil/.test(m[0]),
    'fireStop direct-assigns (replaces), does not take-max');
  assert(!/if \(stopUntil > selfSuppressUntilRef\.current\)/.test(m[0]),
    'must NOT gate on take-max — that was the v51.2 bug');
});

test('SS4 AIGreeter no longer blocks commands on self-suppress (v54.2)', function() {
  // v54.2 removed the AIGreeter-level self-suppress re-check in onBobCommand.
  // VoiceController already filters based on suppress before dispatching;
  // if a command got here, it's real. Old code had:
  //   if (selfSuppressUntilRef.current && Date.now() < selfSuppressUntilRef.current) { return; }
  // with log "ignoring wake-word — self-suppress window active".
  // Both should be gone (or commented out).
  var m = greeter.match(/var onBobCommand = function\(ev\)[\s\S]*?if \(doSendRef\.current\) doSendRef\.current\(cmd, false\);/);
  assert(m, 'onBobCommand body');
  // No LIVE log line about dropping the wake-word in this handler
  var lines = m[0].split('\n').filter(function(l) { return l.trim() && !l.trim().startsWith('//'); });
  var hasActiveSuppressDropLog = lines.some(function(l) {
    return /ignoring wake-word — self-suppress window active/.test(l);
  });
  assert(!hasActiveSuppressDropLog,
    'no LIVE suppress-drop log in onBobCommand (commented lines ignored)');
});

test('SS5 VoiceController reads until from nadia-tts-start', function() {
  var m = vc.match(/var onStart = function\(ev\) \{[\s\S]*?\};/);
  assert(m, 'onStart handler present');
  assert(/var until = ev && ev\.detail && ev\.detail\.until/.test(m[0]),
    'must extract detail.until');
  assert(/selfSuppressUntilRef\.current = until/.test(m[0]),
    'must assign to self-suppress ref');
});

test('SS6 VoiceController reads until from nadia-tts-stop', function() {
  var m = vc.match(/var onStop  = function\(ev\) \{[\s\S]*?\n    \};/);
  assert(m, 'onStop handler present');
  assert(/var until = ev && ev\.detail && ev\.detail\.until/.test(m[0]),
    'must extract detail.until on stop for tail buffer');
});

test('SS7 VoiceController onresult drops events in suppression window', function() {
  assert(/selfSuppressUntilRef\.current && Date\.now\(\) < selfSuppressUntilRef\.current/.test(vc),
    'onresult must guard against self-suppress');
});

// ===== COORDINATION EVENTS =====
test('C1 goStopped dispatches nadia-stop-hard with until', function() {
  // v51.2: signature changed to goStopped(customMinutes).
  var m = greeter.match(/var goStopped = function\([^)]*\) \{[\s\S]*?\n  \};/);
  assert(m, 'goStopped defined');
  assert(/CustomEvent\('nadia-stop-hard', \{ detail: \{ until: until \} \}\)/.test(m[0]),
    'event payload must carry the until timestamp');
});

test('C2 wakeFromStopped dispatches nadia-stop-wake', function() {
  var m = greeter.match(/var wakeFromStopped = function\(\) \{[\s\S]*?\};/);
  assert(m, 'wakeFromStopped defined');
  assert(/CustomEvent\('nadia-stop-wake'\)/.test(m[0]),
    'wake event fired');
});

test('C3 VoiceController listens to both hard-stop events', function() {
  assert(/addEventListener\('nadia-stop-hard', onHardStop\)/.test(vc),
    'hard-stop listener attached');
  assert(/addEventListener\('nadia-stop-wake', onHardWake\)/.test(vc),
    'wake listener attached');
});

test('C4 VoiceController drops non-wake chatter during stop, lets wake-word through (v51.1)', function() {
  // New behavior: during hard-stop, the detector still runs on transcripts.
  // If wake word matches → fall through so AIGreeter can wake her.
  // Otherwise → drop.
  assert(/hardStopUntilRef\.current && Date\.now\(\) < hardStopUntilRef\.current\) \{[\s\S]{0,300}detectWakeWord/.test(vc),
    'hard-stop guard must call detectWakeWord before dropping');
  assert(/if \(!wakeCheck\.matched\) return; \/\/ drop non-wake chatter/.test(vc),
    'must drop non-wake transcripts during stop window');
});

test('C5 Cleanup removes the new event listeners', function() {
  assert(/removeEventListener\('nadia-stop-hard', onHardStop\)/.test(vc),
    'hard-stop listener cleaned up');
  assert(/removeEventListener\('nadia-stop-wake', onHardWake\)/.test(vc),
    'wake listener cleaned up');
});

console.log('');
console.log('──────────────────────────────────────');
console.log('V51 RESULTS (Nadia state + stale alerts)');
console.log('──────────────────────────────────────');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) { console.log('\n❌ FAILURES'); process.exit(1); }
else console.log('\n✅ All v51 tests passed');
