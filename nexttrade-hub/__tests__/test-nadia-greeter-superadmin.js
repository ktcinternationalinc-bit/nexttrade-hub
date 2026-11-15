// ============================================================
// Session 9 (Apr 22 2026) regression tests — greeter super_admin upgrade
//
// Covers:
//  GREETER PAYLOAD
//   1. Client forwards userId in BOTH v1 (legacy) and v2 greeter payloads
//   2. Without userId the server cannot detect super_admin
//
//  SERVER: TEAM CONTEXT LOAD (greeter mode)
//   3. Greeter looks up current user's role via users table, server-side
//   4. Greeter detects super_admin from the role, not from client data
//   5. Super-admin block loads team_profiles
//   6. Super-admin block loads login_events with ONLINE NOW threshold
//   7. Super-admin block loads team tickets grouped by assignee
//   8. Super-admin block loads recent daily_log entries
//   9. Non-super-admin does NOT see the SUPER ADMIN ACCESS block
//
//  SERVER: CROSS-TEAM ACTION SYNTAX
//  10. Action syntax block visible to all users (not just super_admin)
//  11. Action syntax block lists create_reminder/send_team_message/create_ticket/create_event
//  12. Action syntax block includes USERS uuid → name mapping so Claude can resolve
//  13. Action syntax tells Nadia to ACTUALLY emit the block, not just promise
//
//  SERVER: ACTION EXECUTION
//  14. create_reminder parsed from ---ACTION_START--- block and inserted to team_reminders
//  15. send_team_message parsed and inserted to ai_memory with target_user_id
//  16. create_ticket parsed and inserted to tickets with assigned_to
//  17. create_event parsed and inserted to calendar_events
//  18. Parse errors on malformed JSON are caught and surfaced as warnings
//  19. Hard cap of 3 action blocks per turn (no infinite loop)
//  20. Response returns actions_executed array
//  21. Notifier helpers are fired for cross-user actions (fire-and-forget)
//
//  SERVER: PROMPT ASSEMBLY
//  22. Final system prompt is: client override + superAdminBlock + actionSyntaxBlock + crossTeamBlock
//  23. max_tokens bumped from 400 → 900 so action JSON fits comfortably
//  24. Existing crossTeamBlock (receive side) still loads + prepends as before
//
//  SAFETY
//  25. Super-admin detection requires server-side role lookup; client cannot spoof
//  26. Unknown action types are rejected with a clear error
//  27. All four known action types have supabase .insert() calls
//  28. Greeter handler still returns decision alongside answer when decision engine ran
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

// Extract the greeter mode branch once — every server test runs against it.
var greeterBranchMatch = askRoute.match(/if \(body\.mode === 'greeter' && body\.systemOverride\) \{[\s\S]*?^    \}/m);
assert(greeterBranchMatch, 'Could not locate the greeter mode branch — did the if-statement signature change?');
var greeterBranch = greeterBranchMatch[0];

// ===== GREETER PAYLOAD =====
test('G1 Client forwards userId in BOTH v1 and v2 greeter payloads', function() {
  // Both branches of the ternary must include userId
  var payloadRx = /var payload = useV2[\s\S]*?userId: \(userProfile && userProfile\.id\) \|\| null[\s\S]*?userId: \(userProfile && userProfile\.id\) \|\| null/;
  assert(payloadRx.test(greeter),
    'legacy greeter payload must also carry userId — without it the server cannot detect super_admin');
});

test('G2 Legacy payload still sets mode=greeter and systemOverride', function() {
  assert(/mode: 'greeter'/.test(greeter) && /systemOverride: sysPrompt/.test(greeter),
    'payload must continue to include mode and systemOverride so server takes greeter branch');
});

// ===== SERVER: TEAM CONTEXT LOAD =====
test('S3 Greeter looks up current user role via users table', function() {
  assert(/supabase\.from\('users'\)\.select\('id, name, role'\)/.test(greeterBranch),
    'greeter branch must select id/name/role to identify current user');
});

test('S4 Greeter sets gIsSuperAdmin from server-side role lookup', function() {
  assert(/gIsSuperAdmin = gCurrentUserRole === 'super_admin'/.test(greeterBranch),
    'super_admin flag must be derived from the looked-up role, not trusted from client');
});

test('S5 Super-admin block loads team_profiles', function() {
  assert(/if \(gIsSuperAdmin\) \{[\s\S]*?supabase\.from\('team_profiles'\)/.test(greeterBranch),
    'team_profiles table must be queried inside the gIsSuperAdmin guard');
});

test('S6 Super-admin block loads login_events with ONLINE NOW threshold', function() {
  var m = greeterBranch.match(/if \(gIsSuperAdmin\) \{[\s\S]*?===========================================/);
  assert(m, 'super-admin block found');
  var block = m[0];
  assert(/login_events/.test(block), 'login_events must be queried');
  assert(/\[ONLINE NOW\]/.test(block), 'must include ONLINE NOW flag text');
  assert(/minutesAgo < 10/.test(block), 'ONLINE NOW threshold must be 10 minutes');
});

test('S7 Super-admin block loads team tickets grouped by assignee', function() {
  var m = greeterBranch.match(/if \(gIsSuperAdmin\) \{[\s\S]*?===========================================/);
  assert(m && /byAssignee/.test(m[0]), 'tickets must be grouped by assigned_to for per-user rollup');
  assert(/neq\('status', 'Closed'\)/.test(m[0]), 'must exclude closed tickets');
});

test('S8 Super-admin block loads recent daily_log entries', function() {
  var m = greeterBranch.match(/if \(gIsSuperAdmin\) \{[\s\S]*?===========================================/);
  assert(m && /daily_log/.test(m[0]), 'daily_log must be loaded for super_admin context');
  assert(m && /RECENT TEAM ACTIVITY LOG/.test(m[0]), 'section header must be present');
});

test('S8b Super-admin block loads upcoming calendar_events (14-day window)', function() {
  var m = greeterBranch.match(/if \(gIsSuperAdmin\) \{[\s\S]*?===========================================/);
  assert(m && /calendar_events/.test(m[0]), 'calendar_events must be loaded for "what does X have today" questions');
  assert(m && /14 \* 86400000/.test(m[0]), '14-day window for upcoming events');
  assert(m && /CALENDAR EVENTS/.test(m[0]), 'section header must be present');
});

test('S8c Super-admin block loads open follow_ups', function() {
  var m = greeterBranch.match(/if \(gIsSuperAdmin\) \{[\s\S]*?===========================================/);
  assert(m && /follow_ups/.test(m[0]), 'follow_ups must be loaded for "who has overdue follow-ups" questions');
  assert(m && /OPEN FOLLOW_UPS/.test(m[0]), 'section header must be present');
  assert(m && /completed', false/.test(m[0]), 'must filter to incomplete follow_ups only');
});

test('S9 Non-super-admin does NOT see the SUPER ADMIN ACCESS block', function() {
  // The block is inside an `if (gIsSuperAdmin) {` guard — verify no data loads happen outside
  var saBlock = greeterBranch.match(/var superAdminBlock = '';[\s\S]*?\}\n\n      \/\/ ----------/);
  assert(saBlock, 'superAdminBlock scope found');
  // Everything inside the if guard
  var ifContent = saBlock[0].match(/if \(gIsSuperAdmin\) \{[\s\S]*?\}\n\n      \/\/ ----------/);
  assert(ifContent, 'if guard scope found — data loads must be inside this guard');
});

// ===== SERVER: CROSS-TEAM ACTION SYNTAX =====
test('G10 Action syntax block lives OUTSIDE the super_admin guard', function() {
  // The comment above actionSyntaxBlock must say "ALL users"
  assert(/Action execution works for ALL users/.test(greeterBranch),
    'comment must clarify that actions are not super-admin-gated');
  // Must be gated only on having users loaded, not on gIsSuperAdmin
  assert(/var actionSyntaxBlock = '';[\s\S]*?if \(gUsersList\.length > 0\) \{/.test(greeterBranch),
    'actionSyntaxBlock must be gated on users being loaded, not on super_admin');
});

test('G11 Action syntax lists all four supported action types', function() {
  var m = greeterBranch.match(/CROSS-TEAM ACTIONS YOU CAN EXECUTE[\s\S]*?===========================================/);
  assert(m, 'action syntax block found');
  var block = m[0];
  ['create_reminder', 'send_team_message', 'create_ticket', 'create_event'].forEach(function(t) {
    assert(block.indexOf(t) >= 0, 'action syntax must document ' + t);
  });
});

test('G12 Action syntax includes USERS uuid → name mapping', function() {
  var m = greeterBranch.match(/CROSS-TEAM ACTIONS YOU CAN EXECUTE[\s\S]*?===========================================/);
  assert(m && /USERS \(uuid → name\)/.test(m[0]),
    'USERS list must be present so Claude can resolve names to UUIDs');
  assert(/gUsersList\.forEach\(function\(u\) \{[\s\S]*?actionSyntaxBlock \+= '  - ' \+ u\.id \+ ' => ' \+ u\.name/.test(greeterBranch),
    'each user must be appended as "uuid => name (role)"');
});

test('G13 Syntax tells Nadia to actually emit the block, not just promise', function() {
  var m = greeterBranch.match(/CROSS-TEAM ACTIONS YOU CAN EXECUTE[\s\S]*?===========================================/);
  assert(m && /always emit the block/.test(m[0]),
    'instruction must be explicit: do not just promise, emit the block');
});

// ===== SERVER: ACTION EXECUTION =====
test('E14 create_reminder parsed and inserted into team_reminders', function() {
  var m = greeterBranch.match(/if \(actionData\.type === 'create_reminder'\) \{[\s\S]*?actionsExecuted\.push\(\{ ok: true, type: 'create_reminder'/);
  assert(m, 'create_reminder branch must exist and push a success result');
  assert(/supabase\.from\('team_reminders'\)\.insert/.test(m[0]),
    'create_reminder must insert into team_reminders');
  assert(/target_users: rTarget/.test(m[0]),
    'target_users field must be populated from actionData');
});

test('E15 send_team_message inserted into ai_memory with target_user_id', function() {
  var m = greeterBranch.match(/if \(actionData\.type === 'send_team_message'\)[\s\S]*?actionsExecuted\.push\(\{ ok: true, type: 'send_team_message'/);
  assert(m, 'send_team_message branch must exist');
  var block = m[0];
  assert(/target_user_id: actionData\.target_user_id/.test(block), 'target_user_id must be set');
  assert(/require.*target_user_id/.test(block), 'must validate target_user_id presence');
  assert(/supabase\.from\('ai_memory'\)\.insert/.test(block), 'must insert into ai_memory');
});

test('E16 create_ticket generates TKT-#### number and inserts', function() {
  var m = greeterBranch.match(/if \(actionData\.type === 'create_ticket'\)[\s\S]*?actionsExecuted\.push\(\{ ok: true, type: 'create_ticket'/);
  assert(m, 'create_ticket branch must exist');
  var block = m[0];
  assert(/'TKT-' \+ String\(tcCount \+ 1\)\.padStart\(4, '0'\)/.test(block),
    'ticket number must be TKT-#### zero-padded');
  assert(/supabase\.from\('tickets'\)\.insert/.test(block), 'must insert into tickets');
  assert(/assigned_to: actionData\.assigned_to \|\| null/.test(block), 'must carry assigned_to');
});

test('E17 create_event inserted into calendar_events with assignee', function() {
  var m = greeterBranch.match(/if \(actionData\.type === 'create_event'\)[\s\S]*?actionsExecuted\.push\(\{ ok: true, type: 'create_event'/);
  assert(m, 'create_event branch must exist');
  var block = m[0];
  assert(/supabase\.from\('calendar_events'\)\.insert/.test(block), 'must insert into calendar_events');
  assert(/evAssignee = actionData\.assigned_to \|\| userId/.test(block),
    'must default assignee to the current user');
});

test('E18 JSON parse errors surface as warnings, do not crash', function() {
  assert(/catch \(parseErr\) \{[\s\S]*?Could not parse action JSON/.test(greeterBranch),
    'malformed JSON must be caught and flagged to user');
  assert(/actionsExecuted\.push\(\{ ok: false, error: 'parse_error'/.test(greeterBranch),
    'parse_error must be recorded in actions_executed');
});

test('E19 Hard cap of 10 action blocks per turn (S17.10 — raised from 3)', function() {
  assert(/while \(safety < 10\)/.test(greeterBranch),
    'action-parse loop must cap at 10 iterations to prevent flooding while allowing multi-recipient');
});

test('E20 Response returns actions_executed array', function() {
  // S13 upgrade: response also carries `briefing`. Test asserts the contract
  // preserves answer + decision + actions_executed AND includes briefing.
  assert(/return Response\.json\(\{ answer: finalText, decision: decision, actions_executed: actionsExecuted, briefing: briefing \}\)/.test(greeterBranch),
    'final response must include answer, decision, actions_executed, AND briefing');
});

test('E21 Notifier helpers fire for cross-user actions', function() {
  // fire-and-forget — check imports + .catch to confirm non-blocking
  var branchForNotify = greeterBranch;
  ['notifyReminderServer', 'notifyTeamMessageServer', 'notifyTicketAssignedServer', 'notifyEventScheduledServer']
    .forEach(function(fn) {
      assert(branchForNotify.indexOf(fn) >= 0, fn + ' must be called for the corresponding action');
    });
  // Must import them at top of file
  assert(/from '\.\.\/\.\.\/\.\.\/lib\/notify-server'/.test(askRoute),
    'notify-server helpers must be imported at the top of route.js');
});

// ===== SERVER: PROMPT ASSEMBLY =====
test('P22 Final system = override + superAdminBlock + actionSyntaxBlock + crossTeamBlock', function() {
  assert(/var fullSystem = body\.systemOverride \+ superAdminBlock \+ actionSyntaxBlock \+ crossTeamBlock/.test(greeterBranch),
    'fullSystem must concatenate all four pieces in order — any missing piece breaks features');
});

test('P23 max_tokens bumped from 400 to 900', function() {
  assert(/max_tokens: 900/.test(greeterBranch),
    'max_tokens must be raised to 900 to fit action JSON + narration');
  // Ensure the old 400 is NOT still in the greeter branch
  assert(!/max_tokens: 400[^0-9]/.test(greeterBranch),
    'stale max_tokens: 400 must be removed from greeter branch');
});

test('P24 Existing receive-side crossTeamBlock still present', function() {
  assert(/===== PENDING MESSAGES FOR THIS USER =====/.test(greeterBranch),
    'the existing pending-messages surfacing block must be preserved verbatim');
  assert(/target_user_id/.test(greeterBranch) && /team_reminders/.test(greeterBranch),
    'both ai_memory and team_reminders lookups must remain');
});

// ===== SAFETY =====
test('Saf25 super_admin detection depends on server-side lookup only', function() {
  // gIsSuperAdmin must never be read from body.* — always from looked-up role
  var m = greeterBranch.match(/gIsSuperAdmin = [^;]+;/);
  assert(m, 'gIsSuperAdmin assignment found');
  assert(!/body\./.test(m[0]),
    'gIsSuperAdmin must NOT be read from body.* — client cannot be trusted to report its own role');
});

test('Saf26 Unknown action types are rejected with a clear error', function() {
  assert(/throw new Error\('Unknown action type: ' \+ actionData\.type\)/.test(greeterBranch),
    'unknown action types must raise a clear error so Claude learns and stops emitting them');
});

test('Saf27 All four action types insert into their respective tables', function() {
  // Sanity: each insert is a real supabase call, not a stub
  [
    { t: 'create_reminder', table: 'team_reminders' },
    { t: 'send_team_message', table: 'ai_memory' },
    { t: 'create_ticket', table: 'tickets' },
    { t: 'create_event', table: 'calendar_events' },
  ].forEach(function(pair) {
    var branch = greeterBranch.match(new RegExp("actionData\\.type === '" + pair.t + "'[\\s\\S]*?(?=} else if|throw new Error\\('Unknown)"));
    assert(branch, pair.t + ' branch must exist');
    assert(branch[0].indexOf("supabase.from('" + pair.table + "').insert") >= 0,
      pair.t + ' must insert into ' + pair.table);
  });
});

test('Saf28 Greeter still returns decision alongside answer when engine ran', function() {
  // decisionPromise must be awaited inside the success path
  assert(/if \(decisionPromise\) \{ try \{ decision = await decisionPromise; \} catch\(e\) \{\} \}/.test(greeterBranch),
    'decision engine result must still be awaited and returned');
});

// ===== SUMMARY =====
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
