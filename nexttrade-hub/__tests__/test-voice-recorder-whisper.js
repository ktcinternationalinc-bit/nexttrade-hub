// ============================================================
// Voice Recorder (MediaRecorder + Whisper) regression tests
// Session 8 v25 — Apr 22 2026
//
// Tests the new press-to-record / press-to-stop voice flow that
// replaces the unreliable Web Speech API for dictation.
//
// Covers:
//   1. /api/transcribe endpoint exists with nodejs runtime
//   2. Guards against missing OPENAI_API_KEY
//   3. Accepts audio form field, forwards to Whisper
//   4. Supports optional language hint (en/ar)
//   5. AIGreeter has MediaRecorder state + refs
//   6. Record button wired to toggleRecording
//   7. startRecording requests mic + creates MediaRecorder
//   8. stopRecording triggers upload + send
//   9. Barges in on speaking Nadia; mutually exclusive with live-mic
//  10. Cleanup on unmount releases mic stream
//  11. Guards against too-short (accidental tap) recordings
//  12. Big red RECORDING banner with timer shown while recording
//  13. Transcribing banner shown during upload
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

var transcribePath = path.join(REPO, 'src/app/api/transcribe/route.js');
var greeterPath    = path.join(REPO, 'src/components/AIGreeter.jsx');

test('REC1 /api/transcribe endpoint file exists', function() {
  assert(fs.existsSync(transcribePath), 'src/app/api/transcribe/route.js must exist');
});

var apiSrc = fs.readFileSync(transcribePath, 'utf8');
var greeter = fs.readFileSync(greeterPath, 'utf8');

test('REC2 API declares nodejs runtime (needed for multipart)', function() {
  assert(/export const runtime = 'nodejs'/.test(apiSrc), 'runtime must be nodejs');
});

test('REC3 API guards missing OPENAI_API_KEY with helpful message', function() {
  assert(/process\.env\.OPENAI_API_KEY/.test(apiSrc), 'must read OPENAI_API_KEY');
  assert(/if \(!apiKey\)/.test(apiSrc), 'must check apiKey presence');
  assert(/platform\.openai\.com/.test(apiSrc), 'error must include where to get the key');
});

test('REC4 API reads audio from multipart form field "audio"', function() {
  assert(/await request\.formData\(\)/.test(apiSrc), 'must parse formData');
  assert(/\.get\('audio'\)/.test(apiSrc), 'must read "audio" field');
  assert(/expected form field "audio"/.test(apiSrc), 'must tell caller which field was missing');
});

test('REC5 API forwards to OpenAI Whisper endpoint with Bearer auth', function() {
  assert(/api\.openai\.com\/v1\/audio\/transcriptions/.test(apiSrc), 'must POST to Whisper');
  assert(/Authorization: 'Bearer '/.test(apiSrc), 'must use Bearer auth');
  assert(/'model'.*'whisper-1'/.test(apiSrc) || /append\('model', 'whisper-1'\)/.test(apiSrc),
    'must set model=whisper-1');
});

test('REC6 API accepts optional language hint (en/ar)', function() {
  assert(/incoming\.get\('language'\)/.test(apiSrc), 'must look for language hint');
  assert(/lang === 'en' \|\| lang === 'ar'/.test(apiSrc), 'must validate against known set');
});

test('REC7 Greeter imports / declares MediaRecorder state', function() {
  assert(/\[recording, setRecording\]/.test(greeter), 'recording state');
  assert(/\[transcribing, setTranscribing\]/.test(greeter), 'transcribing state');
  assert(/mediaRecorderRef/.test(greeter), 'mediaRecorderRef');
  assert(/mediaStreamRef/.test(greeter), 'mediaStreamRef');
  assert(/audioChunksRef/.test(greeter), 'audioChunksRef');
});

test('REC8 Greeter exposes startRecording/stopRecording/toggleRecording', function() {
  assert(/var startRecording = async function/.test(greeter), 'startRecording defined');
  assert(/var stopRecording = function/.test(greeter), 'stopRecording defined');
  assert(/var toggleRecording = function/.test(greeter), 'toggleRecording defined');
});

test('REC9 startRecording requests mic via getUserMedia and creates MediaRecorder', function() {
  var m = greeter.match(/var startRecording = async function[\s\S]*?\n  \};/);
  assert(m, 'function body found');
  var body = m[0];
  assert(/navigator\.mediaDevices\.getUserMedia\(\{ audio: true \}\)/.test(body),
    'must request audio stream');
  assert(/new MediaRecorder/.test(body), 'must instantiate MediaRecorder');
});

test('REC10 startRecording picks a supported mime type with fallback', function() {
  var m = greeter.match(/var startRecording = async function[\s\S]*?\n  \};/);
  assert(m, 'startRecording body');
  var body = m[0];
  assert(/MediaRecorder\.isTypeSupported/.test(body), 'must probe supported types');
  assert(/audio\/webm/.test(body), 'must include webm/opus as preferred type');
});

test('REC11 onstop uploads to /api/transcribe and sends transcript to Nadia', function() {
  // v55.82-O — the onstop body grew significantly (auth-token grab, more
  // error branches). The original non-greedy regex captures the closing
  // ; of an inner try-finally instead of the function's outer };. Use a
  // broader scope (anywhere in greeter) to confirm the wiring exists.
  assert(/mr\.onstop = async function/.test(greeter), 'onstop handler defined');
  assert(/new FormData\(\)/.test(greeter), 'builds FormData');
  assert(/form\.append\('audio',/.test(greeter), 'attaches audio field');
  assert(/fetch\('\/api\/transcribe'/.test(greeter), 'posts to /api/transcribe');
  assert(/doSend\((text|finalText|backupText)\)/.test(greeter),
    'sends transcribed text (Whisper or browser backup) to Nadia');
});

test('REC12 onstop guards against tiny/silent blobs (<1 KB)', function() {
  var m = greeter.match(/mr\.onstop = async function[\s\S]*?\};/);
  assert(m, 'onstop body');
  assert(/blob\.size < 1000/.test(m[0]), 'must drop microscopic blobs as accidental taps');
});

test('REC13 Recorder is mutually exclusive with live-mic and barges in on speaking Nadia', function() {
  var m = greeter.match(/var startRecording = async function[\s\S]*?\n  \};/);
  assert(m, 'startRecording body');
  var body = m[0];
  assert(/if \(speaking\) \{[\s\S]*?stopSpeech/.test(body),
    'must stop Nadia if she\'s speaking');
  assert(/if \(listening\) \{[\s\S]*?stopListen/.test(body),
    'must stop live-mic if it\'s running');
});

test('REC14 Cleanup releases media tracks on unmount', function() {
  // Look for a useEffect that returns a cleanup calling releaseMediaStream / stopping tracks
  assert(/useEffect\(function\(\) \{[\s\S]*?return function\(\) \{[\s\S]*?releaseMediaStream/.test(greeter),
    'must have useEffect cleanup that releases mic stream');
  assert(/getTracks\(\)\.forEach\(function\(t\) \{ try \{ t\.stop/.test(greeter),
    'must stop every track to release the mic indicator');
});

test('REC15 Big red RECORDING banner shown while recording, with elapsed timer', function() {
  assert(/\{recording && \(/.test(greeter), 'conditional render on recording');
  // Timer format
  assert(/String\(Math\.floor\(recordElapsed \/ 60\)\)\.padStart\(2, ?'0'\) \+ ':' \+ String\(recordElapsed % 60\)\.padStart\(2, ?'0'\)/.test(greeter),
    'mm:ss timer displayed in banner');
});

test('REC16 Transcribing banner shown while upload in flight', function() {
  assert(/\{transcribing && \(/.test(greeter), 'conditional render on transcribing');
  assert(/Transcribing…/.test(greeter), 'English label present');
});

test('REC17 Toggle button wired to toggleRecording and disabled during transcription', function() {
  // The 🎙️ button must invoke toggleRecording AND be disabled while transcribing
  var buttonBlock = greeter.match(/<button[\s\S]*?onClick=\{toggleRecording\}[\s\S]*?\/button>/);
  assert(buttonBlock, '🎙️ Record button exists and invokes toggleRecording');
  // v55.43 — disabled clause now also covers conversationMode (the new
  // ChatGPT-style hands-free conversation toggle uses the same recorder
  // and would conflict if both fired at once). Either expression is ok.
  var disabled = buttonBlock[0];
  assert(/disabled=\{transcribing\}/.test(disabled) || /disabled=\{transcribing \|\| conversationMode\}/.test(disabled),
    'must be disabled while transcribing (or transcribing/conversationMode in v55.43+)');
});

test('REC18 Record button visually distinct from live-mic button', function() {
  // v55.43 — the live-mic button (🎤 listening) was removed; only the
  // press-to-record (🎙️ rose-600) and conversation (🗣️ emerald-500)
  // buttons remain. The visual-distinct intent of the original test is
  // still satisfied: the recorder button has its own distinct color.
  assert(/recording \? 'bg-rose-600/.test(greeter),
    'Record button uses rose-600');
});

test('REC19 Live-mic button remains present (both modes available)', function() {
  assert(/🎤/.test(greeter), '🎤 live-mic button still present');
  assert(/🎙️/.test(greeter), '🎙️ recorder button present');
});

test('REC20 Language hint passed to /api/transcribe based on current greeter lang', function() {
  var m = greeter.match(/mr\.onstop = async function[\s\S]*?\};/);
  assert(m, 'onstop body');
  assert(/form\.append\('language', useLang === 'ar' \? 'ar' : 'en'\)/.test(m[0]),
    'language hint must match current greeter language');
});

console.log('');
console.log('───────────────────────────────────');
console.log('VOICE RECORDER (WHISPER) RESULTS');
console.log('───────────────────────────────────');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) { console.log('\n❌ FAILURES'); process.exit(1); }
else console.log('\n✅ All recorder tests passed');
