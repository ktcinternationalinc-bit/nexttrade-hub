// ============================================================
// v51.1 — Delete ticket hardening + expanded Nadia update_ticket
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

var tickets = fs.readFileSync(path.join(REPO, 'src/components/TicketsTab.jsx'), 'utf8');
var ask     = fs.readFileSync(path.join(REPO, 'src/app/api/ask/route.js'), 'utf8');

// ===== DELETE HARDENING =====
test('D1 executeDelete no longer closes modal before async work', function() {
  var m = tickets.match(/const executeDelete = async \(\) => \{[\s\S]*?^  \};/m);
  assert(m, 'executeDelete found');
  var body = m[0];
  // Strip comments so a mention of "setConfirmDel(null)" in documentation
  // doesn't give a false positive for the code-layout check.
  var codeOnly = body.split('\n').filter(function(ln) {
    return !/^\s*\/\//.test(ln);
  }).join('\n');
  var preAsync = codeOnly.split('try {')[0];
  assert(!/setConfirmDel\(null\)/.test(preAsync),
    'setConfirmDel(null) must not run before the try block — otherwise a failed delete looks like a succeeded one');
});

test('D2 executeDelete has console logging for diagnosis', function() {
  assert(/console\.log\('\[delete\] starting'/.test(tickets),
    'start log');
  assert(/console\.log\('\[delete\] ticket row deleted'/.test(tickets),
    'success log');
  assert(/console\.error\('\[delete\] FAILED:'/.test(tickets),
    'error log');
});

test('D3 executeDelete clears referenced rows (comments, priorities, alerts)', function() {
  var m = tickets.match(/const executeDelete = async \(\) => \{[\s\S]*?^  \};/m);
  assert(m, 'executeDelete found');
  var body = m[0];
  assert(/ticket_comments'\)\.delete\(\)\.eq\('ticket_id'/.test(body),
    'clears ticket_comments');
  assert(/ticket_assignee_priorities'\)\.delete\(\)\.eq\('ticket_id'/.test(body),
    'clears per-assignee priority rows');
  assert(/ai_alerts'\)\.delete\(\)\.eq\('related_entity_id'/.test(body),
    'clears Nadia alerts so she does not reference the deleted ticket');
});

test('D4 executeDelete shows a user-visible toast on error', function() {
  assert(/toast\.error\('Delete failed: ' \+ msg\)/.test(tickets),
    'must surface error to user, not fail silently');
});

test('D5 executeDelete shows a success toast', function() {
  assert(/toast\.success\('Ticket deleted'\)/.test(tickets),
    'positive confirmation on success');
});

// ===== EXPANDED update_ticket =====
test('U1 update_ticket supports new_title', function() {
  assert(/if \(actionData\.new_title\) \{[\s\S]{0,200}up\.title = String\(actionData\.new_title\)/.test(ask),
    'new_title writes tickets.title');
});

test('U2 update_ticket supports description', function() {
  // Distinct from the existing search-by-title fallback at top of handler
  assert(/if \(actionData\.description !== undefined\) \{[\s\S]{0,200}up\.description = actionData\.description \? String\(actionData\.description\) : null/.test(ask),
    'description allows set OR clear');
});

test('U3 update_ticket supports category', function() {
  assert(/if \(actionData\.category\) \{ up\.category = String\(actionData\.category\)/.test(ask),
    'category supported');
});

test('U4 update_ticket supports comment-only add_comment path', function() {
  assert(/if \(actionData\.add_comment \|\| actionData\.comment\) \{/.test(ask),
    'comment-only mode accepted');
});

test('U5 update_ticket rejects calls with zero fields', function() {
  assert(/if \(ch\.length === 0\) \{[\s\S]*?throw new Error\('update_ticket called with no recognized fields/.test(ask),
    'empty updates throw a helpful error');
});

test('U6 update_ticket auto-acks stale alerts for the ticket it updated', function() {
  var m = ask.match(/} else if \(actionData\.type === 'update_ticket'\) \{[\s\S]*?execResult = '✅ Updated/);
  assert(m, 'update_ticket block present');
  assert(/ai_alerts'\)[\s\S]*?\.update\(\{ acknowledged: true[\s\S]*?\.eq\('related_entity_id', tk\.id\)/.test(m[0]),
    'Nadia auto-acks alerts tied to the ticket she just modified');
});

test('U7 update_ticket skips the .update call if no structural fields changed', function() {
  // Pure comment-only mode should not issue an empty UPDATE against tickets
  assert(/if \(Object\.keys\(up\)\.length > 0\) \{[\s\S]{0,200}\.update\(up\)/.test(ask),
    'update skipped when no columns changed');
});

test('U8 update_ticket schema hint includes new fields', function() {
  assert(/new_title/.test(ask) && /add_comment/.test(ask) && /description/.test(ask),
    'schema line lists new fields so Nadia knows to use them');
});

// ===== NADIA WAKE WORD DURING STOP (v51.1 behavior change) =====
var greeter = fs.readFileSync(path.join(REPO, 'src/components/AIGreeter.jsx'), 'utf8');
var vc = fs.readFileSync(path.join(REPO, 'src/components/VoiceController.jsx'), 'utf8');

test('W1 Wake-word during hard stop clears stopped state inline', function() {
  assert(/wake-word during stop window → waking immediately/.test(greeter),
    'explicit log for wake-word-wakes-her behavior');
  assert(/if \(stoppedRef\.current && stoppedRef\.current > Date\.now\(\)\) \{[\s\S]{0,600}setStoppedUntil\(0\)/.test(greeter),
    'handler clears stoppedUntil before falling through');
});

test('W2 VoiceController runs wake detector during hard stop (lets Hey Nadia through)', function() {
  assert(/hardStopUntilRef\.current && Date\.now\(\) < hardStopUntilRef\.current\) \{[\s\S]{0,300}detectWakeWord/.test(vc),
    'hard-stop guard still runs detectWakeWord before dropping');
});

test('W3 VoiceController drops non-wake chatter during hard stop', function() {
  assert(/if \(!wakeCheck\.matched\) return; \/\/ drop non-wake chatter/.test(vc),
    'non-wake transcripts dropped so random talk doesnt trigger her');
});

test('W4 VoiceController bypasses follow-up mode during hard stop', function() {
  assert(/Bypass follow-up mode during stop — user hasn't been conversing\./.test(vc),
    'follow-up mode cleared so Hey Nadia is the only path in');
});

console.log('');
console.log('──────────────────────────────────');
console.log('V51.1 DELETE + UPDATE_TICKET + WAKE');
console.log('──────────────────────────────────');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) { console.log('\n❌ FAILURES'); process.exit(1); }
else console.log('\n✅ All v51.1 tests passed');
