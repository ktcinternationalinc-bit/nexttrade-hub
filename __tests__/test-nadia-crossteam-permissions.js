// ============================================================
// Session 8 v24 (Apr 22 2026) regression tests
//
// Covers:
//  VOICE
//   1. Silence timeout extended to 60s (was 3.5s) — no mid-thought cutoff
//   2. Big red STOP & SEND button replaces tiny status strip
//   3. Stale recognition instance cleanup on every startListen
//   4. Auto-restart on premature Chromium onend
//   5. Silence timer only resets on real speech content
//  AI PAGE-SHIFT
//   6. scrollIntoView replaced with scoped scrollTop on nearest overflow ancestor
//  NADIA SCOPE (super_admin)
//   7. Super admin scope expansion block in system prompt
//   8. Team activity (login_events) loaded for super_admin
//  CROSS-TEAM MESSAGING
//   9. Greeter mode loads pending ai_memory targeted at recipient
//  10. Greeter mode loads active team_reminders for recipient
//  11. Pending messages appended to system prompt in greeter mode
//  PERMISSIONS
//  12. Non-admins blocked from create_rate
//  13. Non-admins blocked from send_team_message to other users
//  14. Non-admins blocked from create_reminder targeting other users
//  15. Non-admins blocked from create_ticket assigning to other users
//  16. Clear block reason returned in answer
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

var greeter  = fs.readFileSync(path.join(REPO, 'src/components/AIGreeter.jsx'), 'utf8');
var askRoute = fs.readFileSync(path.join(REPO, 'src/app/api/ask/route.js'), 'utf8');

// ===== VOICE =====
test('V1 Silence timeout extended to 60s (no mid-thought cutoff)', function() {
  assert(/var SILENCE_TIMEOUT_MS = 60000/.test(greeter),
    'SILENCE_TIMEOUT_MS must be 60000 (60 seconds) — was 3500 which cut users off');
});

test('V1b Silence timeout is positioned as a safety net, not primary stop', function() {
  // The comment must explicitly flag the new intent: user tap is primary
  assert(/safety net/.test(greeter) || /press-to-stop/.test(greeter),
    'code must document that user tap is the primary stop mechanism');
});

test('V2 Big red STOP & SEND button present when listening', function() {
  assert(/STOP & SEND/.test(greeter),
    'button must display "STOP & SEND" copy so users can find it');
  // Button must be wired to stopListen
  assert(/<button onClick=\{stopListen\}[\s\S]*?bg-red-500[\s\S]*?STOP & SEND/.test(greeter),
    'big button must be wired to stopListen, with bg-red-500, containing STOP & SEND label');
});

test('V3 Stale recognition instance cleanup before each start', function() {
  assert(/if \(recognitionRef\.current\) \{[\s\S]*?abort\(\)[\s\S]*?recognitionRef\.current = null/.test(greeter),
    'startListen must null+abort any existing instance first — fixes first-few-clicks bug');
});

test('V4 Auto-restart on premature onend', function() {
  assert(/userWantsListenRef\.current/.test(greeter),
    'userWantsListenRef must track user intent across onend events');
  assert(/recentSpeech = \(Date\.now\(\) - lastVoiceActivityRef\.current\) < SILENCE_TIMEOUT_MS/.test(greeter),
    'onend must check recent speech activity to decide restart');
  assert(/nextRec\.start\(\)/.test(greeter),
    'onend must actually build and start a fresh recognition when continuation intended');
});

test('V5 Silence timer only resets on real speech content, not empty ticks', function() {
  assert(/if \(sawContent\) \{[\s\S]*?resetSilenceTimer/.test(greeter),
    'resetSilenceTimer must be gated on sawContent — prevents no-speech chatter from resetting');
});

// ===== AI PAGE-SHIFT =====
test('S6 scrollIntoView replaced with scoped scrollTop', function() {
  // Original bug: chatEndRef.current.scrollIntoView({ behavior: 'smooth' })
  // propagated up to the page. Fixed implementation must walk ancestors and
  // set scrollTop on the first overflow-y-auto ancestor only.
  assert(/scroller\.scrollTop = scroller\.scrollHeight/.test(greeter),
    'must set scrollTop directly on the scrollable ancestor');
  // Strip comments before checking that no actual scrollIntoView call remains.
  // The fix's explanatory comment references the old call for documentation.
  var codeOnly = greeter.split('\n').filter(function(ln) {
    var t = ln.trim();
    return t && !t.startsWith('//') && !t.startsWith('*');
  }).join('\n');
  assert(!/chatEndRef\.current\.scrollIntoView/.test(codeOnly),
    'old scrollIntoView call must be gone from executable code (comments OK)');
});

// ===== NADIA SCOPE =====
test('N7 Super admin scope block injected when isSuperAdmin', function() {
  assert(/if \(isSuperAdmin\) \{[\s\S]*?SUPER ADMIN ACCESS/.test(askRoute),
    'system prompt must include explicit super_admin scope block');
});

test('N7b Scope block mentions visibility tables (tickets/events/daily_log/team_profiles)', function() {
  // Find the block and verify it mentions what data is visible
  var m = askRoute.match(/SUPER ADMIN ACCESS[\s\S]*?===========================================/);
  assert(m, 'scope block found');
  var block = m[0];
  ['TICKETS', 'CALENDAR', 'DAILY_LOG', 'TEAM PROFILES', 'FOLLOW_UPS'].forEach(function(word) {
    assert(block.indexOf(word) >= 0, 'scope block must mention ' + word);
  });
});

test('N7c Scope block explicitly forbids the "just a personal assistant" refusal', function() {
  var m = askRoute.match(/SUPER ADMIN ACCESS[\s\S]*?===========================================/);
  assert(m && /Do NOT refuse/.test(m[0]),
    'block must explicitly tell Nadia not to refuse with "personal assistant" style excuses');
});

test('N8 Team activity (login_events) loaded for super_admin', function() {
  assert(/login_events[\s\S]*?gte\('created_at'[\s\S]*?since/.test(askRoute),
    'super_admin path must query login_events with a recency filter');
  assert(/\[ONLINE NOW\]/.test(askRoute),
    'output must flag users who are currently online');
});

// ===== CROSS-TEAM MESSAGING =====
test('M9 Greeter loads pending ai_memory targeted at recipient', function() {
  assert(/supabase\.from\('ai_memory'\)[\s\S]*?\.eq\('target_user_id', userId\)/.test(askRoute),
    'greeter must fetch ai_memory rows where target_user_id = the recipient user');
});

test('M9b Pending messages exclude expired ones', function() {
  assert(/expires_at\.is\.null,expires_at\.gt\./.test(askRoute),
    'pending query must OR expires_at IS NULL with expires_at > now');
});

test('M10 Greeter loads active team_reminders for recipient', function() {
  assert(/team_reminders[\s\S]*?target_users\.eq\.all,target_users\.eq\./.test(askRoute),
    'team_reminders query must match target_users = all OR target_users = recipient uuid');
});

test('M10b team_reminders filtered to due today or earlier', function() {
  assert(/r\.reminder_date <= new Date\(\)\.toISOString\(\)\.substring\(0, ?10\)/.test(askRoute),
    'only surface reminders due today or in the past, not future ones');
});

test('M11 Pending messages block appended to system prompt', function() {
  assert(/PENDING MESSAGES FOR THIS USER/.test(askRoute),
    'system prompt must include a labeled PENDING MESSAGES block');
  assert(/body\.systemOverride \+ crossTeamBlock/.test(askRoute),
    'crossTeamBlock must be concatenated onto the greeter system prompt');
});

// ===== PERMISSIONS =====
test('P12 Non-admins blocked from create_rate (the only admin-only action)', function() {
  assert(/actionData\.type === 'create_rate'[\s\S]*?blocked = true/.test(askRoute),
    'create_rate must be gated for non-admins');
  assert(/Only admins can log shipping rates/.test(askRoute),
    'block reason must be clear and helpful');
});

test('P13 All team members CAN send_team_message to other users (Max updated policy — everyone collaborates)', function() {
  // Verify the restriction is NOT present. If any block on send_team_message exists for non-admins, this fails.
  var gateMatch = askRoute.match(/if \(!isAdminish\) \{[\s\S]*?\}\s*if \(blocked\)/);
  assert(gateMatch, 'permission gate block exists');
  assert(!/send_team_message[\s\S]*?blocked = true/.test(gateMatch[0]),
    'there must be NO send_team_message block inside the !isAdminish gate');
});

test('P14 All team members CAN create_reminder targeting other users', function() {
  var gateMatch = askRoute.match(/if \(!isAdminish\) \{[\s\S]*?\}\s*if \(blocked\)/);
  assert(gateMatch, 'permission gate block exists');
  assert(!/create_reminder[\s\S]*?blocked = true/.test(gateMatch[0]),
    'there must be NO create_reminder block inside the !isAdminish gate');
});

test('P15 All team members CAN create_ticket assigning to other users', function() {
  var gateMatch = askRoute.match(/if \(!isAdminish\) \{[\s\S]*?\}\s*if \(blocked\)/);
  assert(gateMatch, 'permission gate block exists');
  assert(!/create_ticket[\s\S]*?blocked = true/.test(gateMatch[0]),
    'there must be NO create_ticket block inside the !isAdminish gate');
});

test('P15b Policy comment documents the "everyone can send to everyone" intent', function() {
  assert(/everyone can send to everyone/.test(askRoute) || /collaborate freely/.test(askRoute),
    'code must document the open-collaboration policy so future changes do not silently re-lock it');
});

test('P16 Block returns clear reason in answer (for the rates case)', function() {
  assert(/if \(blocked\) \{[\s\S]*?Response\.json\([\s\S]*?blockReason/.test(askRoute),
    'blocked actions must return a Response.json containing the blockReason');
});

test('P16b Super admin bypasses all permission gates', function() {
  // The isAdminish flag must be the gate, and must be true for isSuperAdmin
  assert(/var isAdminish = isSuperAdmin \|\| currentUserRole === 'admin'/.test(askRoute),
    'isAdminish flag must include isSuperAdmin');
  assert(/if \(!isAdminish\) \{/.test(askRoute),
    'all permission checks must be inside if(!isAdminish) so admins pass unchecked');
});

// ===== GREETER SURFACING URGENT ITEMS =====
test('G1 Greeter computes unacknowledged tickets separately', function() {
  assert(/var unackedTickets = myTickets\.filter\(function\(t\) \{ return t\.status === 'New'; \}\)/.test(greeter),
    'unackedTickets = tickets still in New status (user has not acknowledged)');
});

test('G2 Greeter computes tickets due today specifically (not just overdue)', function() {
  assert(/var dueTodayTickets = myTickets\.filter\(function\(t\) \{ return t\.due_date === todayStr; \}\)/.test(greeter),
    'dueTodayTickets = tickets with due_date exactly today');
});

test('G3 Greeter context emphasizes unacked/due-today/overdue prominently', function() {
  assert(/SURFACE THESE PROMINENTLY/.test(greeter),
    'context must instruct Nadia not to bury urgent items');
  assert(/UNACKNOWLEDGED tickets waiting for first response/.test(greeter),
    'unacked block present');
  assert(/DUE TODAY/.test(greeter),
    'due-today block present');
  assert(/OVERDUE tickets/.test(greeter),
    'overdue block present');
});

test('G4 System prompt tells Nadia to proactively surface urgent items', function() {
  assert(/PROACTIVELY surface urgent items/.test(greeter),
    'system prompt must explicitly tell Nadia to lead with urgent items');
  assert(/do not invent urgency/.test(greeter),
    'but must not fabricate urgency when none exists');
});

console.log('');
console.log('─────────────────────────────────────');
console.log('V24 REGRESSION RESULTS');
console.log('─────────────────────────────────────');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) { console.log('\n❌ FAILURES'); process.exit(1); }
else console.log('\n✅ All v24 regression tests passed');
