// ============================================================
// Session 17.9 (Apr 23 2026) — BUG FIX: Nadia cuts off after 2-3 words
//
// Root cause: doSpeak dispatched a "nadia-stop-all" event to silence
// any other instance that might still be playing audio. But THIS
// instance also listened for that same event — so she told herself to
// stop the moment she started speaking.
//
// Fix: tag the event with a unique instance ID. The listener ignores
// events that came from itself.
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

test('S17.9.B1 instanceIdRef is declared', function() {
  assert(/var instanceIdRef = useRef\(null\)/.test(greeter),
    'instanceIdRef must be declared for uniquely identifying this AIGreeter');
});

test('S17.9.B2 instanceIdRef initialized with a unique value on first render', function() {
  assert(/if \(!instanceIdRef\.current\) \{\s*instanceIdRef\.current = 'nadia-' \+ Date\.now\(\)/.test(greeter),
    'instanceIdRef.current must be set to a unique value on first render');
});

test('S17.9.B3 nadia-stop-all event carries senderId', function() {
  assert(/new CustomEvent\('nadia-stop-all', \{\s*detail: \{ senderId: instanceIdRef\.current \}/.test(greeter),
    'nadia-stop-all event must carry senderId in detail');
});

test('S17.9.B4 Listener ignores events from self', function() {
  assert(/var senderId = ev && ev\.detail && ev\.detail\.senderId;\s*if \(senderId && senderId === instanceIdRef\.current\) return;/.test(greeter),
    'onStopAll listener must compare senderId to own instanceIdRef and return early if match');
});

test('S17.9.B5 Listener still triggers stopSpeech for events from OTHER instances', function() {
  // After the ignore-self check, stopSpeech should still be called
  assert(/if \(senderId && senderId === instanceIdRef\.current\) return;[\s\S]{0,50}stopSpeech\(\);/.test(greeter),
    'onStopAll must call stopSpeech after the self-check passes');
});

// Regression — dashboard props still original
test('S17.9.R1 Dashboard AIGreeter still has original props only', function() {
  var page = fs.readFileSync(path.join(REPO, 'src/app/page.jsx'), 'utf8');
  var m = page.match(/<AIGreeter\s([\s\S]*?)\/>/);
  assert(m, 'AIGreeter found');
  assert(!/\bmuted=/.test(m[1]),
    'dashboard must NOT pass muted prop');
  assert(!/\bcontextTab=/.test(m[1]),
    'dashboard must NOT pass contextTab prop');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
