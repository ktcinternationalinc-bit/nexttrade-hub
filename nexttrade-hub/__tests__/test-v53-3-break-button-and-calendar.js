// ============================================================
// v53.3 — Break button always visible + calendar update/delete + conflict detection
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
var ask     = fs.readFileSync(path.join(REPO, 'src/app/api/ask/route.js'), 'utf8');

// ===== BREAK BUTTON VISIBILITY =====
test('B1 Break button is rendered when Nadia is idle (not buried behind pause state)', function() {
  // The always-visible row is gated ONLY on NOT speaking/listening/recording/stopped.
  // It should NOT require `paused` to be true.
  assert(/\{!speaking && !listening && !recording && !\(stoppedUntil > Date\.now\(\)\) && \(/.test(greeter),
    'break button visibility uses only negative gates — not "paused"');
});

test('B2 Break button calls goStopped()', function() {
  // The 💤 30m button onClick wires to goStopped
  assert(/onClick=\{function\(\) \{ goStopped\(\); \}\}[\s\S]{0,400}<span>💤<\/span>/.test(greeter),
    '30m button triggers the 30-min hard stop');
});

test('B3 Break button has Arabic + English tooltip', function() {
  assert(/Sleep for 30 minutes|30 دقيقة/.test(greeter),
    'tooltip works in both languages');
});

test('B4 When paused, button row shows a wake-her-up option on the left', function() {
  // The left side of the row conditionally renders:
  //   paused ? <wake button> : <hint text>
  assert(/paused \? \(\s*<button/.test(greeter),
    'left side toggles between wake button and hint text based on paused state');
});

test('B5 When idle (not paused), hint text reminds user they can say "take a break"', function() {
  assert(/take a 20 minute break/.test(greeter),
    'English hint present');
  assert(/خذي استراحة/.test(greeter),
    'Arabic hint present');
});

test('B6 Break row is hidden while Nadia is actively speaking', function() {
  // Speaking takes over with the big red stop bar; the small row is suppressed.
  assert(/\{!speaking && !listening && !recording && !\(stoppedUntil > Date\.now\(\)\)/.test(greeter),
    'hidden during speech/listen/record/stopped');
});

// ===== CALENDAR UPDATE =====
test('C1 update_event handler exists', function() {
  assert(/actionData\.type === 'update_event'/.test(ask),
    'update_event branch present');
});

test('C2 update_event accepts event_id or title_match lookup', function() {
  var m = ask.match(/actionData\.type === 'update_event'\) \{[\s\S]*?\n            \} else if/);
  assert(m, 'update_event block');
  assert(/if \(actionData\.event_id\)/.test(m[0]),
    'event_id path');
  assert(/else if \(actionData\.title_match\)/.test(m[0]),
    'title_match fallback');
});

test('C3 update_event writes new_title / new_event_date / new_event_time / new_assigned_to', function() {
  var m = ask.match(/actionData\.type === 'update_event'\) \{[\s\S]*?\n            \} else if/);
  assert(m, 'block');
  assert(/if \(actionData\.new_title\) uPatch\.title = actionData\.new_title/.test(m[0]),
    'new_title');
  assert(/if \(actionData\.new_event_date\) uPatch\.event_date = actionData\.new_event_date/.test(m[0]),
    'new_event_date');
  assert(/if \(actionData\.new_event_time !== undefined\) uPatch\.event_time = actionData\.new_event_time \|\| null/.test(m[0]),
    'new_event_time (allows clearing)');
  assert(/if \(actionData\.new_assigned_to\) uPatch\.assigned_to = actionData\.new_assigned_to/.test(m[0]),
    'new_assigned_to');
});

// ===== CALENDAR DELETE =====
test('C4 delete_event handler exists', function() {
  assert(/actionData\.type === 'delete_event'/.test(ask),
    'delete_event branch present');
});

test('C5 delete_event accepts event_id or title_match', function() {
  var m = ask.match(/actionData\.type === 'delete_event'\) \{[\s\S]*?\n            \} else/);
  assert(m, 'delete_event block');
  assert(/if \(actionData\.event_id\)/.test(m[0]),
    'id path');
  assert(/else if \(actionData\.title_match\)/.test(m[0]),
    'title_match path');
});

test('C6 delete_event actually deletes from calendar_events', function() {
  var m = ask.match(/actionData\.type === 'delete_event'\) \{[\s\S]*?\n            \} else/);
  assert(m, 'block');
  assert(/supabase\.from\('calendar_events'\)\.delete\(\)\.eq\('id', dTarget\.id\)/.test(m[0]),
    'performs actual delete by id');
});

// ===== CONFLICT DETECTION =====
test('C7 create_event checks for time conflict before inserting', function() {
  var m = ask.match(/actionData\.type === 'create_event'\) \{[\s\S]*?\n            \} else if \(actionData\.type === 'update_event'/);
  assert(m, 'create_event block');
  assert(/if \(actionData\.event_time && !actionData\.force\)/.test(m[0]),
    'conflict check gated on presence of time AND absence of force');
  assert(/\.eq\('event_date', actionData\.event_date\)[\s\S]{0,200}\.eq\('assigned_to', evAssignee\)[\s\S]{0,200}\.eq\('event_time', actionData\.event_time\)/.test(m[0]),
    'conflict query matches on date + assignee + time');
});

test('C8 create_event conflict returns warning and short-circuits', function() {
  var m = ask.match(/actionData\.type === 'create_event'\) \{[\s\S]*?\n            \} else if \(actionData\.type === 'update_event'/);
  assert(m, 'block');
  assert(/Time conflict[\s\S]{0,200}Say "schedule anyway" or "override"/.test(m[0]),
    'user-facing warning message present');
  assert(/conflict: true/.test(m[0]),
    'actionsExecuted entry flagged as conflict');
  assert(/continue;/.test(m[0]),
    'short-circuits (skips insert) via continue');
});

test('C9 force=true bypasses conflict check on create', function() {
  var m = ask.match(/actionData\.type === 'create_event'\) \{[\s\S]*?\n            \} else if \(actionData\.type === 'update_event'/);
  assert(m, 'block');
  assert(/if \(actionData\.event_time && !actionData\.force\) \{/.test(m[0]),
    'force skips conflict check');
  assert(/if \(actionData\.force\) execLine \+= ' \(override/.test(m[0]),
    'success message notes override was used');
});

test('C10 update_event also checks for conflict on the NEW slot', function() {
  var m = ask.match(/actionData\.type === 'update_event'\) \{[\s\S]*?\n            \} else if/);
  assert(m, 'block');
  assert(/if \(newTime && !actionData\.force &&[\s\S]{0,300}newDate !== uTarget\.event_date/.test(m[0]),
    'only runs conflict check when target slot differs');
  assert(/\.neq\('id', uTarget\.id\)/.test(m[0]),
    'excludes the event being moved from conflict check (otherwise it conflicts with itself)');
});

test('C11 update_event conflict message tells user how to override', function() {
  var m = ask.match(/actionData\.type === 'update_event'\) \{[\s\S]*?\n            \} else if/);
  assert(m, 'block');
  assert(/Cannot move — conflict[\s\S]{0,200}Say "move anyway"/.test(m[0]),
    'clear override instruction');
});

// ===== SCHEMA HINTS FOR NADIA =====
test('S1 Schema tells Nadia about update_event + delete_event + force override', function() {
  assert(/\* update_event: \{[\s\S]{0,200}"new_event_time"/.test(ask),
    'update_event schema listed');
  assert(/\* delete_event: \{[\s\S]{0,100}"title_match"/.test(ask),
    'delete_event schema listed');
});

test('S2 Schema tells Nadia how to handle conflict response', function() {
  assert(/Tell the user about the conflict and ASK if they want to override/.test(ask),
    'Nadia is instructed to ASK, not auto-override');
  assert(/re-emit the action with "force":true/.test(ask),
    'Nadia knows how to re-emit with force');
});

test('S3 Schema tells Nadia natural-language trigger phrases for update/delete', function() {
  assert(/move my 2pm meeting to 3pm/.test(ask),
    'move → update_event example');
  assert(/cancel my 2pm meeting[\s\S]{0,50}delete_event/.test(ask),
    'cancel → delete_event example');
});

console.log('');
console.log('──────────────────────────────────────────────────');
console.log('V53.3 — BREAK BUTTON + CALENDAR UPDATES + CONFLICTS');
console.log('──────────────────────────────────────────────────');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) { console.log('\n❌ FAILURES'); process.exit(1); }
else console.log('\n✅ All v53.3 tests passed');
