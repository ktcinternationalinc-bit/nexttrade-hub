// ============================================================
// v54.5 — Nadia silence-pause commit + Calendar always-visible buttons
// ============================================================
//
// Bugs from v54.x:
//   1. After "Hey Nadia" → "I'm here" → user speaks → silence
//      Root cause: Web Speech's `isFinal` is unreliable. Engine collected
//      command tokens but never committed them when the user paused.
//      Fix: silence-pause timer (1.5s) + onend force-commit using a new
//      engine.commitPending() method.
//
//   2. "Where's the cancel/delete button?"
//      Root cause: buttons were gated behind permission checks; if a
//      check returned false (or user wasn't matched as creator/admin),
//      NO button appeared. User had no signal anything was missing.
//      Fix: always render Cancel + Delete buttons; permissions enforced
//      in click handlers with a clear toast.
//
//   3. "I clicked the event but no edit/cancel modal opened"
//      Root cause: only the tiny ✏️ pencil icon opened the edit modal.
//      Fix: clicking the event title/body itself now opens edit modal.
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
var vc       = fs.readFileSync(path.join(REPO, 'src/components/VoiceController.jsx'), 'utf8');
var engine   = fs.readFileSync(path.join(REPO, 'src/lib/voice/wake-word.js'), 'utf8');

// ===== ENGINE: commitPending =====

test('E1 wake engine exposes commitPending() method', function() {
  assert(/function commitPending\(\)/.test(engine),
    'commitPending defined');
  assert(/return \{ process: process, reset: reset, isCollecting: isCollecting, commitPending: commitPending \}/.test(engine),
    'exported in factory return');
});

test('E2 commitPending returns null when not collecting', function() {
  assert(/if \(state\.activeCommand === null\) return null/.test(engine),
    'guard against no-op call');
});

test('E3 commitPending returns trimmed command when meaningful', function() {
  var m = engine.match(/function commitPending\(\) \{[\s\S]*?\n  \}/);
  assert(m, 'commitPending body');
  assert(/var cmd = state\.activeCommand\.trim\(\)/.test(m[0]),
    'trims');
  assert(/if \(cmd\.length < MIN_COMMAND_CHARS\) return null/.test(m[0]),
    'rejects too-short fragments');
  assert(/return cmd/.test(m[0]),
    'returns the command');
});

test('E4 commitPending clears state so next "Hey Nadia" starts fresh', function() {
  var m = engine.match(/function commitPending\(\) \{[\s\S]*?\n  \}/);
  assert(m, 'body');
  assert(/state\.activeCommand = null/.test(m[0]),
    'clears active command');
  assert(/state\.lastTriggeredAt = Date\.now\(\)/.test(m[0]),
    'updates debounce timestamp');
});

// ===== VOICE CONTROLLER: silence timer + onend force-commit =====

test('V1 SILENCE_PAUSE_MS = 1500 and silenceTimerRef declared', function() {
  assert(/var silenceTimerRef = useRef\(null\)/.test(vc),
    'silence timer ref declared');
  assert(/var SILENCE_PAUSE_MS = 1500/.test(vc),
    '1.5-second pause threshold');
});

test('V2 During collection, every transcript chunk restarts the silence timer', function() {
  var block = vc.match(/if \(engineRef\.current\.isCollecting\(\)\) \{[\s\S]*?silenceTimerRef\.current = setTimeout/);
  assert(block, 'collection-mode silence-timer block');
  assert(/if \(silenceTimerRef\.current\) clearTimeout\(silenceTimerRef\.current\)/.test(block[0]),
    'clears previous timer before restarting');
});

test('V3 Silence timer fires commitPending after pause and dispatches command', function() {
  var m = vc.match(/silenceTimerRef\.current = setTimeout\(function\(\) \{[\s\S]*?\}, SILENCE_PAUSE_MS\);/);
  assert(m, 'silence-timer callback');
  assert(/engineRef\.current\.commitPending\(\)/.test(m[0]),
    'calls commitPending');
  assert(/window\.dispatchEvent\(new CustomEvent\('hey-bob-command'/.test(m[0]),
    'dispatches command on commit');
});

test('V4 onend force-commits any pending command before restarting recognizer', function() {
  var m = vc.match(/rec\.onend = function\(\) \{[\s\S]*?\};/);
  assert(m, 'onend handler');
  assert(/if \(engineRef\.current && engineRef\.current\.isCollecting\(\)\)/.test(m[0]),
    'checks for pending collection');
  assert(/var pending = engineRef\.current\.commitPending\(\)/.test(m[0]),
    'forces commit');
  assert(/window\.dispatchEvent\(new CustomEvent\('hey-bob-command'/.test(m[0]),
    'dispatches command on force-commit');
});

test('V5 stop() clears silence timer along with restart timer', function() {
  var m = vc.match(/var stop = useCallback\(function\(\) \{[\s\S]*?\}, \[clearFollowUp\]\);/);
  assert(m, 'stop function');
  assert(/if \(silenceTimerRef\.current\) \{ clearTimeout\(silenceTimerRef\.current\); silenceTimerRef\.current = null; \}/.test(m[0]),
    'silence timer cleared on stop (no leaks)');
});

test('V6 onresult clears silence timer when full command commits via engine', function() {
  // When out.trigger fires (engine got isFinal), the silence path is
  // redundant — clear the timer to avoid double-fire.
  var m = vc.match(/if \(out\.trigger && out\.command\) \{[\s\S]*?\}\s*\};/);
  assert(m, 'trigger block');
  assert(/clearTimeout\(silenceTimerRef\.current\)/.test(m[0]),
    'cancels pending silence-commit when engine trigger fires first');
});

// ===== CALENDAR: always-visible Cancel + Delete buttons =====

test('C1 Cancel button is rendered UNCONDITIONALLY (no canCancel gate)', function() {
  // The visible button is always there. canCancel is enforced INSIDE
  // cancelMeeting() via toast.error, not at the render layer. This
  // ensures user always sees the button so they're never confused.
  var modalBlock = calendar.match(/v54\.5[\s\S]*?Already cancelled[\s\S]*?\}\)\}/);
  // Simpler: the cancel button block must NOT be wrapped in {canCancel...}
  var buttons = calendar.match(/Cancel this meeting[\s\S]{0,200}/);
  // Ensure no canCancel(editEvent) wrapper IMMEDIATELY before the button
  assert(!/\{canCancel\(editEvent\) && \(\s*<button\s*onClick=\{cancelMeeting\}/.test(calendar),
    'cancel button is no longer gated by canCancel at render');
  assert(/onClick=\{cancelMeeting\}/.test(calendar),
    'cancel handler still wired');
});

test('C2 Delete button is rendered UNCONDITIONALLY (no canDelete gate)', function() {
  assert(!/\{canDelete\(editEvent\) && \(\s*<button\s*onClick=\{deleteMeeting\}/.test(calendar),
    'delete button is no longer gated by canDelete at render');
  assert(/onClick=\{deleteMeeting\}/.test(calendar),
    'delete handler still wired');
});

test('C3 Permission checks remain INSIDE the click handlers (defense in depth)', function() {
  var cancelBody = calendar.match(/const cancelMeeting = async[\s\S]*?\n  \};/);
  assert(cancelBody, 'cancelMeeting');
  assert(/if \(!canCancel\(editEvent\)\)/.test(cancelBody[0]),
    'cancelMeeting still checks canCancel internally');
  assert(/toast\.error/.test(cancelBody[0]),
    'shows clear error if user lacks permission');

  var deleteBody = calendar.match(/const deleteMeeting = async[\s\S]*?\n  \};/);
  assert(deleteBody, 'deleteMeeting');
  assert(/if \(!canDelete\(editEvent\)\)/.test(deleteBody[0]),
    'deleteMeeting still checks canDelete internally');
});

test('C4 Cancel button uses bold red styling (impossible to miss)', function() {
  assert(/border-2 border-red-400[\s\S]{0,200}Cancel this meeting/.test(calendar),
    'thick red border + larger text');
});

test('C5 Delete button uses bold black styling (impossible to miss)', function() {
  assert(/border-2 border-slate-900[\s\S]{0,400}DELETE permanently/.test(calendar),
    'thick black border + larger text');
});

// ===== CALENDAR: clickable event opens edit modal =====

test('CL1 Day-detail event title is clickable to open edit modal', function() {
  // The text/title div now has onClick={() => openEditEvent(ev)}
  // and cursor-pointer styling.
  var m = calendar.match(/<div onClick=\{\(\) => openEditEvent\(ev\)\} className="cursor-pointer flex-1[\s\S]{0,500}\{ev\.title\}/);
  assert(m, 'event body clickable in day-detail view');
});

test('CL2 Postponed events have an Edit button (was hidden before)', function() {
  // Previously: event_status === 'postponed' → only "Postponed" badge,
  // no edit access. Now: badge + ✏️ button for Edit / Cancel / Delete.
  assert(/Postponed[\s\S]{0,500}Edit \/ Cancel \/ Delete/.test(calendar),
    'postponed events expose Edit access');
});

test('CL3 Completed events expose a settings/edit button (was hidden before)', function() {
  assert(/title="Edit \/ Cancel \/ Delete"[\s\S]{0,100}⚙/.test(calendar),
    'completed events have ⚙ Edit / Cancel / Delete button');
});

// ===== MODAL SCROLLABILITY (preserved from v54.4) =====

test('M1 Edit modal is scrollable when content overflows viewport', function() {
  assert(/max-h-\[90vh\] overflow-y-auto/.test(calendar),
    'modal has max-height + overflow-y-auto so buttons at bottom are reachable');
});

console.log('');
console.log('──────────────────────────────────────────────────');
console.log('V54.5 — NADIA SILENCE-PAUSE + ALWAYS-VISIBLE CANCEL/DELETE');
console.log('──────────────────────────────────────────────────');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) { console.log('\n❌ FAILURES'); process.exit(1); }
else console.log('\n✅ All v54.5 tests passed');
