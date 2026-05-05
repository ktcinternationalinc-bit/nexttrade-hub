// ============================================================
// v54.6 — Nadia's first-load "something went wrong" bug
// ============================================================
//
// Bug: On first page load (before user even spoke), Nadia would say
// "Sorry, something went wrong" if the API request hiccupped — which
// happens routinely on Vercel cold starts, transient 503s, or slow
// DB warmups. The error message persisted in the chat thread and
// her ELEVEN voice spoke it aloud, confusing users.
//
// Fix:
//   1. Distinguish greeting fetches from user-message fetches.
//   2. Defensive parse: detect non-OK / non-JSON responses BEFORE
//      calling res.json() (which throws on HTML error pages).
//   3. Greeting failures retry once silently (1.5s backoff). If the
//      retry also fails, stay quiet — empty chat is better than
//      "something went wrong".
//   4. Empty answer on a greeting → stay quiet (don't speak silence).
//   5. User-message failures still get a visible message, but it's
//      actionable: "couldn't reach the server, try again" not
//      "something went wrong".
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

test('S1 Defensive parse: checks res.ok and content-type before .json()', function() {
  // The original code went straight to res.json() — which throws on
  // HTML error pages. v54.6 inspects res.ok + content-type FIRST.
  assert(/var contentType = res\.headers && res\.headers\.get && res\.headers\.get\('content-type'\)/.test(greeter),
    'reads content-type defensively');
  assert(/var looksLikeJson = contentType && contentType\.indexOf\('application\/json'\) !== -1/.test(greeter),
    'checks for JSON content-type');
  assert(/if \(!res\.ok \|\| !looksLikeJson\)/.test(greeter),
    'gates the failure path');
});

test('S2 Greeting failures retry once with backoff', function() {
  var m = greeter.match(/if \(anyGreeting\) \{[\s\S]*?await new Promise\(function\(r\) \{ setTimeout\(r, 1500\); \}\);[\s\S]*?\}/);
  assert(m, 'greeting-retry block');
  assert(/var res2 = await fetch\(endpoint/.test(m[0]),
    'second fetch attempt');
  assert(/setTimeout\(r, 1500\)/.test(m[0]),
    '1.5s backoff before retry');
});

test('S3 Greeting retry failure → stay quiet (no error message)', function() {
  // Find the retry-failure block
  var m = greeter.match(/greeting retry also failed[\s\S]{0,400}/);
  assert(m, 'retry-failure block with logging');
  // Must NOT push "something went wrong" to messages
  assert(!/setMessages.*something went wrong/i.test(m[0]),
    'no "something went wrong" pollution');
  // Must just return after logging
  assert(/setLoading\(false\);[\s\S]{0,50}return;/.test(m[0]),
    'silently returns after logging');
});

test('S4 User-message failures still produce visible feedback', function() {
  // The non-greeting failure path inside the !res.ok branch
  var m = greeter.match(/} else \{\s*\/\/ User-initiated message failed[\s\S]*?return;\s*\}/);
  assert(m, 'user-message failure block');
  assert(/setMessages\(\[\]\.concat\(msgs, \[\{ role: 'assistant', text: errText \}\]\)\)/.test(m[0]),
    'shows error message to user (they need feedback for an action they took)');
  assert(/I couldn't reach the server/.test(m[0]) || /لم أستطع الوصول إلى الخادم/.test(m[0]),
    'message is actionable, not generic');
});

test('S5 Outer catch: greeting → silent, user message → visible', function() {
  // The outer try/catch wrapping the whole fetch
  var m = greeter.match(/\} catch\(e\) \{[\s\S]*?\/\/ v54\.6[\s\S]*?\}\s*setLoading\(false\);\s*\};/);
  assert(m, 'outer catch block updated');
  assert(/if \(anyGreeting\) \{[\s\S]{0,200}return;[\s\S]{0,50}\}/.test(m[0]),
    'greeting path returns silently from catch too');
  assert(/Sorry, I couldn/.test(m[0]),
    'user-message catch shows clear error (apostrophe-tolerant match)');
});

test('S6 No more "Sorry, something went wrong" anywhere', function() {
  // The OLD canonical fallback string is gone (replaced with actionable text)
  assert(!/Sorry, something went wrong/.test(greeter),
    'old generic English message removed');
  assert(!/عذراً، حدث خطأ\./.test(greeter),
    'old generic Arabic message removed');
});

test('S7 Empty greeting answer → stay quiet (no speak silence)', function() {
  var m = greeter.match(/if \(anyGreeting && !aiText\.trim\(\)\)[\s\S]{0,300}\}/);
  assert(m, 'empty-answer guard for greetings');
  assert(/setLoading\(false\);[\s\S]{0,50}return;/.test(m[0]),
    'returns without speaking when answer is empty');
});

console.log('');
console.log('──────────────────────────────────────────────────');
console.log('V54.6 — NO "SOMETHING WENT WRONG" ON FIRST LOAD');
console.log('──────────────────────────────────────────────────');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) { console.log('\n❌ FAILURES'); process.exit(1); }
else console.log('\n✅ All v54.6 tests passed');
