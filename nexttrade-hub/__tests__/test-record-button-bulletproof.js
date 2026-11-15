// ============================================================
// Session 10 (Apr 22 2026) regression tests — Record button bulletproofing
//
// What broke before: the 🎙️ Record button required OPENAI_API_KEY in Vercel.
// If the key was missing OR anything else went wrong, the button showed a
// tiny top-right toast for 4 seconds that was easy to miss, especially on
// mobile. Users reported "it records, lets me stop, but nothing happens."
//
// What's fixed:
//   1. Parallel browser-backup speech recognition runs alongside MediaRecorder
//   2. If Whisper fails OR returns empty, fall back to the browser transcript
//   3. Errors surface as big red cards INSIDE the chat, not as auto-dismissed toasts
//   4. Every step logs to console with [record] prefix for post-mortem diagnosis
//   5. Silent-return bug (chunks.length===0) replaced with a clear error path
//   6. Tiny-blob case also falls back to browser transcript when available
//   7. API-key-missing error shows a plain-English explanation in chat
//
// Coverage:
//   B1–B4    Parallel backup SpeechRecognition plumbing
//   W1–W4    Whisper → backup fallback logic
//   E1–E5    Inline red error cards replace silent toasts
//   L1–L3    Console logging at every decision point
//   M1–M2    Graceful teardown on stop and on error
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
var api     = fs.readFileSync(path.join(REPO, 'src/app/api/transcribe/route.js'), 'utf8');

// Pull just the recording functions for scoped assertions.
var recordBlockMatch = greeter.match(/var startRecording = async function\(\) \{[\s\S]*?^  \};/m);
assert(recordBlockMatch, 'Could not locate startRecording block — has the function signature changed?');
var recordBlock = recordBlockMatch[0];

// ===== B: BACKUP RECOGNITION PLUMBING =====
test('B1 Backup recognition refs declared alongside recorder refs', function() {
  assert(/recordBackupRecogRef = useRef\(null\)/.test(greeter),
    'ref for the backup recognizer must exist');
  assert(/recordBackupTextRef = useRef\(''\)/.test(greeter),
    'ref for accumulated backup text must exist');
});

test('B2 Backup SR started in parallel when recording begins', function() {
  // Must look up SpeechRecognition and start a fresh instance
  assert(/window\.SpeechRecognition \|\| window\.webkitSpeechRecognition/.test(recordBlock),
    'startRecording must discover SpeechRecognition constructor');
  assert(/recordBackupRecogRef\.current = br/.test(recordBlock),
    'backup recognizer must be stored in its ref');
  assert(/br\.start\(\)/.test(recordBlock),
    'backup recognizer must actually be started');
});

test('B3 Backup SR accumulates only final results into the buffer', function() {
  assert(/if \(res2\.isFinal && res2\[0\] && res2\[0\]\.transcript\)/.test(recordBlock),
    'only finalized transcripts should add to recordBackupTextRef — interim results would double-count');
  assert(/recordBackupTextRef\.current = \(recordBackupTextRef\.current \|\| ''\) \+ added/.test(recordBlock),
    'backup buffer must append finalized text');
});

test('B4 Backup SR gets torn down cleanly on stop', function() {
  // stopBackupRecog helper must null out handlers and abort()
  assert(/var stopBackupRecog = function\(\)/.test(greeter),
    'stopBackupRecog helper must exist');
  var helper = greeter.match(/var stopBackupRecog = function\(\) \{[\s\S]*?^  \};/m);
  assert(helper, 'stopBackupRecog helper scope found');
  assert(/onresult = null[\s\S]*?onerror = null[\s\S]*?onend = null/.test(helper[0]),
    'all handlers must be nulled out to prevent leaks');
  assert(/\.stop\(\)[\s\S]*?\.abort\(\)/.test(helper[0]),
    'both stop and abort must be attempted');
});

// ===== W: WHISPER → BACKUP FALLBACK =====
test('W1 Whisper is still the primary transcription path', function() {
  assert(/fetch\('\/api\/transcribe'/.test(recordBlock),
    'Whisper endpoint must still be called first for best quality');
});

test('W2 Browser backup text is used when Whisper returns empty or errors', function() {
  // The fallback decision variable
  assert(/var finalText = whisperText \|\| backupText/.test(recordBlock),
    'finalText must fall back to backupText when Whisper gives nothing');
});

test('W3 Tiny blob case also falls back to backup text when available', function() {
  // The tiny-blob branch must attempt backup before erroring
  var tinyBranch = recordBlock.match(/if \(blob\.size < 1000\) \{[\s\S]*?return;\s*\}/);
  assert(tinyBranch, 'tiny-blob branch found');
  assert(/if \(backupText\)[\s\S]*?doSend\(backupText\)/.test(tinyBranch[0]),
    'tiny blob must try backup text before declaring failure');
});

test('W4 No-chunks case also falls back to backup text when available', function() {
  // Non-greedy match until the next CASE comment marker
  var noChunksBranch = recordBlock.match(/if \(chunks\.length === 0\) \{[\s\S]*?^      \}/m);
  assert(noChunksBranch, 'no-chunks branch found');
  // Previously: silent `return`. Now: try backup, else error.
  assert(/if \(backupText\) \{[\s\S]*?doSend\(backupText\)/.test(noChunksBranch[0]),
    'no-chunks path must try backup text before erroring');
  assert(/pushRecordError\(/.test(noChunksBranch[0]),
    'no-chunks path must surface a clear error if backup is also empty — no silent return');
});

// ===== E: INLINE RED ERROR CARDS =====
test('E1 pushRecordError helper exists and marks message as isRecordError', function() {
  assert(/var pushRecordError = function\(title, detail\)/.test(greeter),
    'pushRecordError helper must be defined');
  var helper = greeter.match(/var pushRecordError = function\(title, detail\) \{[\s\S]*?^  \};/m);
  assert(helper, 'pushRecordError scope found');
  assert(/isRecordError: true/.test(helper[0]),
    'pushed message must flag isRecordError for red styling');
  assert(/setMessages\(newMsgs\)/.test(helper[0]),
    'message must actually be added to the chat — not just logged');
});

test('E2 Error cards render with red border and high-contrast background', function() {
  assert(/m\.isRecordError[\s\S]{0,200}border-red-500/.test(greeter),
    'isRecordError messages must have a red border class');
  assert(/rgba\(220, 38, 38, 0\.15\)/.test(greeter),
    'isRecordError messages must have the red translucent background');
});

test('E3 Error-card branch in renderer handles BOTH older-messages AND lastMsg paths', function() {
  // Two render branches exist: messages.slice(0,-1).map and lastMsg block.
  // Both must check isRecordError.
  var errorBranchMatches = greeter.match(/isRecordError/g) || [];
  // One in pushRecordError helper + two in renderer = 3+ occurrences at minimum
  assert(errorBranchMatches.length >= 3,
    'isRecordError must be checked in helper + messages renderer + lastMsg renderer (found ' + errorBranchMatches.length + ')');
});

test('E4 Mic-denied path uses pushRecordError (not silent toast)', function() {
  var gumBlock = recordBlock.match(/getUserMedia[\s\S]*?catch \(e\) \{[\s\S]*?return;\s*\}/);
  assert(gumBlock, 'getUserMedia catch branch found');
  assert(/pushRecordError/.test(gumBlock[0]),
    'mic-denied must show an inline red card, not an auto-dismissing toast');
});

test('E5 API-key-missing case has a dedicated plain-English message', function() {
  // When Whisper returns "OPENAI_API_KEY" style error AND backup is empty,
  // the error detail must call out the specific config issue.
  assert(/OPENAI_API_KEY\|not configured/.test(recordBlock) ||
         /\/OPENAI_API_KEY\|not configured\/i/.test(recordBlock),
    'code must detect the specific "not configured" server error pattern');
  // v55.82-O — wording softened from "has not been configured" to
  // "is not configured", and the OPENAI_API_KEY phrase is now embedded
  // in the user-facing detail. Accept either phrasing.
  assert(/(has not been configured in Vercel|is not configured in Vercel)/.test(recordBlock),
    'dedicated message must explain WHAT is not configured in plain English');
});

// ===== L: CONSOLE LOGGING =====
test('L1 Every key step logs with [record] prefix', function() {
  var prefixMatches = recordBlock.match(/\[record\]/g) || [];
  assert(prefixMatches.length >= 8,
    'at least 8 [record] log points expected — found ' + prefixMatches.length);
});

test('L2 Whisper success and failure both log', function() {
  assert(/\[record\] Whisper returned/.test(recordBlock),
    'Whisper success path must log character count');
  assert(/\[record\] Whisper failed/.test(recordBlock) || /\[record\] Whisper fetch threw/.test(recordBlock),
    'Whisper failure path must log the error');
});

test('L3 Fallback decision logs which path was used', function() {
  assert(/\[record\] falling back to backup transcript/.test(recordBlock) ||
         /\[record\] using browser backup transcript because Whisper failed/.test(recordBlock),
    'code must log when the browser backup is being used in place of Whisper');
});

// ===== M: TEARDOWN SAFETY =====
test('M1 mr.onerror tears down backup recognizer too', function() {
  var onerrorBlock = recordBlock.match(/mr\.onerror = function\(ev\) \{[\s\S]*?\};/);
  assert(onerrorBlock, 'mr.onerror block found');
  assert(/stopBackupRecog\(\)/.test(onerrorBlock[0]),
    'mr.onerror must also stop the backup recognizer to avoid orphans');
});

test('M2 mr.onstop tears down backup AFTER letting it flush any interim', function() {
  var onstopBlock = recordBlock.match(/mr\.onstop = async function\(\) \{[\s\S]*?\};/);
  assert(onstopBlock, 'mr.onstop block found');
  // Must await a brief pause then stop backup recog — so final results can arrive
  assert(/await new Promise\(function\(resolve\) \{ setTimeout\(resolve, 250\); \}\)/.test(onstopBlock[0]),
    'a small await before teardown lets the backup recognizer emit any final transcript');
  assert(/stopBackupRecog\(\)/.test(onstopBlock[0]),
    'mr.onstop must tear down the backup recognizer before processing');
});

// ===== API ROUTE (unchanged, but sanity checks) =====
test('API1 Transcribe route still reports missing OPENAI_API_KEY clearly', function() {
  assert(/Add OPENAI_API_KEY to Vercel env vars/.test(api),
    'server error message must name the env var so client can detect and handle it');
});

test('API2 Transcribe route has no backticks (SWC-safe)', function() {
  assert(api.indexOf(String.fromCharCode(96)) === -1,
    'API route must use string concatenation, not template literals');
});

// ===== SUMMARY =====
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
