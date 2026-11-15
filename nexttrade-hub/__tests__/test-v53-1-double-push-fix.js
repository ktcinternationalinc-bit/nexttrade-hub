// ============================================================
// v53.1 — CRITICAL BUG FIX: double-pushed user message
// ============================================================
// ROOT CAUSE: the client pushes the user's message into its local
// conversation state before sending `history` to the API. So the
// outgoing `history` array's last entry IS the current question. The
// server was then pushing `{role:'user', content:question}` on top,
// sending the same user message to Claude twice. Claude correctly
// replied "you said that twice" because the context actually showed it
// twice. This also doubled tokens → slower responses.
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

var ask = fs.readFileSync(path.join(REPO, 'src/app/api/ask/route.js'), 'utf8');
var askV2 = fs.readFileSync(path.join(REPO, 'src/app/api/ask-v2/route.js'), 'utf8');

// ===== CORE FIX =====
test('D1 /api/ask (main path) guards against double-pushing the user message', function() {
  assert(/var lastMsg = messages\[messages\.length - 1\]/.test(ask),
    'must inspect the tail of history');
  assert(/var alreadyInHistory = lastMsg && lastMsg\.role === 'user' && String\(lastMsg\.content \|\| ''\)\.trim\(\) === String\(question \|\| ''\)\.trim\(\)/.test(ask),
    'must compare last history entry to current question');
  assert(/if \(!alreadyInHistory\) \{[\s\S]{0,80}messages\.push\(\{ role: 'user', content: question \}\)/.test(ask),
    'push only if NOT already present');
});

test('D1b /api/ask (GREETER MODE path) also guards against double-push', function() {
  // v53.2 — the greeter path is what AIGreeter.jsx actually uses. v53.1
  // fixed only the other path; this test pins the greeter fix.
  assert(/var lastG = gMessages\[gMessages\.length - 1\]/.test(ask),
    'greeter path inspects tail');
  assert(/var greeterAlreadyHas = lastG && lastG\.role === 'user' && String\(lastG\.content \|\| ''\)\.trim\(\) === String\(question \|\| ''\)\.trim\(\)/.test(ask),
    'greeter path compares tail to question');
  assert(/if \(!greeterAlreadyHas\) \{[\s\S]{0,100}gMessages\.push\(\{ role: 'user', content: question \}\)/.test(ask),
    'greeter push is guarded');
});

test('D2 /api/ask-v2 has the same guard', function() {
  assert(/var lastMsgV2 = messages\[messages\.length - 1\]/.test(askV2),
    'v2 inspects tail');
  assert(/var alreadyInHistoryV2 = lastMsgV2 && lastMsgV2\.role === 'user' && String\(lastMsgV2\.content \|\| ''\)\.trim\(\) === String\(question \|\| ''\)\.trim\(\)/.test(askV2),
    'v2 compares');
  assert(/if \(!alreadyInHistoryV2\) \{[\s\S]{0,80}messages\.push\(\{ role: 'user', content: question \}\)/.test(askV2),
    'v2 push-guarded');
});

// ===== REVERTED v53 BLOAT =====
test('R1 v53 anti-hallucination prompt rules removed (they were band-aid, not root cause)', function() {
  assert(!/NEVER claim the user said something they did not say/.test(ask),
    'removed fabrication rule');
  assert(!/NEVER accuse the user of repeating themselves/.test(ask),
    'removed accusation rule');
  assert(!/NEVER use sarcasm/.test(ask),
    'removed sarcasm rule');
});

test('R2 v53 light-mode fetch reverted to full fetch', function() {
  assert(!/var needsHeavy/.test(ask),
    'light/heavy branching gone');
  assert(!/var lightLimit/.test(ask),
    'lightLimit gone');
  assert(/safe\(supabase\.from\('invoices'\)[\s\S]{0,400}\.limit\(500\)\)/.test(ask),
    'full 500 invoice load restored');
});

test('R3 History slice is back to -10', function() {
  assert(/history\.slice\(-10\)\.forEach/.test(ask),
    'reverted to original 10-message history');
});

// ===== SIMULATION: check that the edge case works right =====
test('S1 Fresh conversation (empty history + first message) still pushes the question', function() {
  // In the empty-history case, lastMsg is undefined → alreadyInHistory = false → push fires.
  // The expression short-circuits safely. Confirm by reading the code.
  var m = ask.match(/var messages = \[\];[\s\S]*?messages\.push\(\{ role: 'user', content: question \}\);[\s\S]*?\}/);
  assert(m, 'build block found');
  // lastMsg used with optional-short-circuit
  assert(/lastMsg && lastMsg\.role === 'user'/.test(m[0]),
    'lastMsg guarded against undefined');
});

test('S2 Question whitespace differences do not cause false non-match', function() {
  // The trim() on both sides means "hello " and "hello" match correctly.
  assert(/String\(lastMsg\.content \|\| ''\)\.trim\(\) === String\(question \|\| ''\)\.trim\(\)/.test(ask),
    'both sides trimmed before compare');
});

console.log('');
console.log('──────────────────────────────────────────────────');
console.log('V53.1 — DOUBLE-PUSH BUG FIX (root cause)');
console.log('──────────────────────────────────────────────────');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) { console.log('\n❌ FAILURES'); process.exit(1); }
else console.log('\n✅ All v53.1 tests passed');
