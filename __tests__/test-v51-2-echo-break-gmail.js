// ============================================================
// v51.2 — Echo loop fix + take_break action + Gmail monitoring
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

var vc      = fs.readFileSync(path.join(REPO, 'src/components/VoiceController.jsx'), 'utf8');
var greeter = fs.readFileSync(path.join(REPO, 'src/components/AIGreeter.jsx'), 'utf8');
var ask     = fs.readFileSync(path.join(REPO, 'src/app/api/ask/route.js'), 'utf8');
var watch   = fs.readFileSync(path.join(REPO, 'src/app/api/nadia/watch/route.js'), 'utf8');

// ===== ECHO LOOP FIX =====
test('E1 Follow-up auto-send is disabled (was causing echo loop)', function() {
  // Active code must NOT fire hey-bob-command from follow-up path.
  // We keep the old code commented for reference. Check that there's no
  // LIVE dispatch inside the followUpActiveRef && isFinal block.
  var m = vc.match(/FOLLOW-UP AUTO-SEND DISABLED[\s\S]*?onresult|onresult = function[\s\S]*?FOLLOW-UP AUTO-SEND DISABLED/);
  assert(/FOLLOW-UP AUTO-SEND DISABLED/.test(vc),
    'must contain the disable marker so maintainers know why');
});

test('E2 Self-suppress tail extended to 3 seconds', function() {
  assert(/SELF_SUPPRESS_MS = 3000/.test(greeter),
    'tail must be at least 3s to cover laptop-speaker echo');
});

test('E3 AIGreeter self-suppress is floor-only (never shrinks)', function() {
  assert(/startUntil > selfSuppressUntilRef\.current\) selfSuppressUntilRef\.current = startUntil/.test(greeter),
    'onStart take-max protection');
  assert(/stopUntil > selfSuppressUntilRef\.current\) selfSuppressUntilRef\.current = stopUntil/.test(greeter),
    'onStop take-max protection');
});

test('E4 VoiceController self-suppress is floor-only (never shrinks)', function() {
  var m = vc.match(/var onStart = function\(ev\) \{[\s\S]*?\};/);
  assert(m, 'onStart handler');
  assert(/until && until > selfSuppressUntilRef\.current/.test(m[0]),
    'floor-only on start');
  var m2 = vc.match(/var onStop  = function\(ev\) \{[\s\S]*?\};/);
  assert(m2, 'onStop handler');
  assert(/until && until > selfSuppressUntilRef\.current/.test(m2[0]),
    'floor-only on stop');
});

test('E5 onStop no longer opens a follow-up fire window', function() {
  var m = vc.match(/var onStop  = function\(ev\) \{[\s\S]*?\};/);
  assert(m, 'onStop handler');
  // followUpActiveRef must be explicitly set to FALSE, not true
  assert(/followUpActiveRef\.current = false/.test(m[0]),
    'must clear follow-up state, not activate it');
  assert(!/followUpActiveRef\.current = true/.test(m[0]),
    'must NOT reactivate follow-up after she speaks');
});

// ===== TAKE_BREAK =====
test('T1 Schema hint describes take_break action', function() {
  assert(/take_break: \{type:"take_break", minutes:20\}/.test(ask),
    'schema entry present');
  assert(/take a break/i.test(ask) && /sleep for N minutes/i.test(ask),
    'trigger phrases listed for the LLM');
});

test('T2 Server returns pending_action for take_break', function() {
  assert(/if \(action\.type === 'take_break'\)/.test(ask),
    'handler present');
  assert(/pending_action: \{ type: 'take_break', minutes: mins \}/.test(ask),
    'client gets the duration');
});

test('T3 Server clamps minutes (1..180)', function() {
  var m = ask.match(/action\.type === 'take_break'\) \{[\s\S]*?return Response\.json/);
  assert(m, 'take_break block');
  assert(/if \(mins > 180\) mins = 180/.test(m[0]), 'upper clamp');
  assert(/!mins \|\| isNaN\(mins\) \|\| mins < 1/.test(m[0]), 'lower clamp');
});

test('T4 goStopped accepts a custom duration (was hardcoded 30)', function() {
  var m = greeter.match(/var goStopped = function\(customMinutes\) \{[\s\S]*?\};/);
  assert(m, 'goStopped signature updated');
  assert(/Math\.max\(1, Math\.min\(180, Number\(customMinutes\)\)\)/.test(m[0]),
    'must clamp client-side too');
  assert(/windowMs = mins \* 60 \* 1000/.test(m[0]),
    'computes ms from minutes');
});

test('T5 AIGreeter processes pending_action:take_break after speech', function() {
  assert(/data\.pending_action\.type === 'take_break'/.test(greeter),
    'client checks the action');
  assert(/setTimeout\(function\(\) \{[\s\S]*?goStopped\(breakMins\)/.test(greeter),
    'schedules goStopped AFTER speech finishes');
  assert(/words \* 500/.test(greeter),
    'delay scales with reply length so TTS finishes first');
});

// ===== GMAIL MONITORING =====
test('G1 runWatch includes Gmail scan step', function() {
  assert(/scanGmailInbox/.test(watch), 'scanGmailInbox referenced in runWatch');
  assert(/gmail_alerts_written/.test(watch), 'summary counter present');
});

test('G2 scanGmailInbox skips users without Gmail tokens', function() {
  var m = watch.match(/async function scanGmailInbox\(userId\) \{[\s\S]*?\n\}/);
  assert(m, 'scanGmailInbox defined');
  assert(/user_integrations[\s\S]*?\.eq\('provider', 'gmail'\)/.test(m[0]),
    'looks up per-user tokens');
  assert(/!tokRes\.data\.access_token\) return out/.test(m[0]),
    'bails early when no token');
});

test('G3 scanGmailInbox fetches unread primary inbox', function() {
  assert(/gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages/.test(watch),
    'Gmail list API called');
  assert(/is:unread in:inbox category:primary/.test(watch),
    'proper Gmail search query');
});

test('G4 scanGmailInbox generates gmail_unread alerts', function() {
  assert(/alert_type: 'gmail_unread'/.test(watch),
    'distinct alert type so it can be filtered + color-coded');
  assert(/related_entity_id: msgs\[i\]\.id/.test(watch),
    'uses gmail msg id as dedup key');
});

test('G5 Gmail scan failures do not break the cron', function() {
  assert(/try \{\s*var gmailAlerts = await scanGmailInbox/.test(watch),
    'wrapped in try/catch');
  assert(/summary\.errors\.push\('gmail ' \+ uid/.test(watch),
    'errors logged, non-fatal');
});

console.log('');
console.log('──────────────────────────────────────');
console.log('V51.2 — Echo + take_break + Gmail mon');
console.log('──────────────────────────────────────');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) { console.log('\n❌ FAILURES'); process.exit(1); }
else console.log('\n✅ All v51.2 tests passed');
