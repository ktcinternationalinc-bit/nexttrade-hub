// ============================================================
// v55.65 — Voicemail "We couldn't hear you" fix
//
// Bug reported by Max May 7 2026:
//   "Voice mail comes up but can't hear me leaving a message
//    and keeps saying. We couldn't hear you"
//
// Root cause:
//   Twilio's <Record trim="trim-silence"> aggressively trims
//   audio when ambient silence is detected, often returning
//   a zero-duration recording. Twilio's default fallback for
//   a zero-duration recording is to play "We couldn't hear you".
//
//   Compounding factors:
//     - No `timeout` attribute → defaults to 5 seconds, too
//       short for someone gathering thoughts after the beep.
//     - No <Pause> between beep and recording → beep audio
//       could bleed into the start of the recording and get
//       trimmed off along with the start of the message.
//
// Fix: in all three <Record> blocks (incoming/route.js × 2,
// voicemail-record/route.js × 1):
//   1. Change trim="trim-silence" → trim="do-not-trim"
//   2. Add timeout="10" so callers have 10s to start speaking
//   3. Add <Pause length="1" /> before <Record>
// ============================================================

var fs = require('fs');
var path = require('path');
var REPO = path.resolve(__dirname, '..');
var read = function (rel) { return fs.readFileSync(path.join(REPO, rel), 'utf8'); };

var passed = 0, failed = 0;
function check(label, cond, detail) {
  if (cond) { console.log('  ✓ ' + label); passed++; }
  else { console.log('  ✗ ' + label); failed++; if (detail) console.log('     ' + detail); }
}
function group(title) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(title);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

console.log('============================================================');
console.log('v55.65 — Voicemail "We couldn\'t hear you" fix');
console.log('============================================================');

// ============================================================
// 1. voicemail-record/route.js
// ============================================================
group('1. voicemail-record/route.js — Case 2 (Dial failed → voicemail)');

var vmr = read('src/app/api/phone/voicemail-record/route.js');
check('1.1 NO trim-silence attribute on Record',
  !/trim="trim-silence"/.test(vmr));
check('1.2 trim is now do-not-trim', /trim="do-not-trim"/.test(vmr));
check('1.3 timeout="10" attribute present', /timeout="10"/.test(vmr));
check('1.4 <Pause length="1" /> before <Record>',
  /<Pause length="1" \/>[\s\S]{0,120}<Record/.test(vmr));
check('1.5 Comment explains the bug fix',
  /couldn.*hear[\s\S]{0,400}trim-silence/i.test(vmr));

// ============================================================
// 2. incoming/route.js — buildFallbackTwiml
// ============================================================
group('2. incoming/route.js — fallback voicemail (no routing configured)');

var inc = read('src/app/api/phone/incoming/route.js');
// Count occurrences of each fix
var trimSilenceMatches = (inc.match(/trim="trim-silence"/g) || []).length;
var doNotTrimMatches = (inc.match(/trim="do-not-trim"/g) || []).length;
var timeoutMatches = (inc.match(/timeout="10"/g) || []).length;
var pauseMatches = (inc.match(/<Pause length="1"/g) || []).length;
// In incoming/route.js there are also two twiml += variants; account for both syntaxes
var doNotTrimAll = (inc.match(/do-not-trim/g) || []).length;
var timeoutAll = (inc.match(/timeout=\\?"10\\?"/g) || []).length;
var pauseAll = (inc.match(/Pause length=\\?"1\\?"/g) || []).length;

check('2.1 NO trim-silence attribute remaining', trimSilenceMatches === 0,
  'found ' + trimSilenceMatches);
// Count actual ATTRIBUTE uses only, ignoring comments
var doNotTrimAttr = (inc.match(/trim=\\?"do-not-trim\\?"/g) || []).length;
check('2.2 do-not-trim used as attribute 3 times (one per Record block)', doNotTrimAttr === 3,
  'found ' + doNotTrimAttr + ' attribute uses (additional mentions in comments are fine)');
check('2.3 timeout="10" appears 3 times', timeoutAll === 3,
  'found ' + timeoutAll);
check('2.4 <Pause length="1" /> appears 3 times', pauseAll === 3,
  'found ' + pauseAll);

// ============================================================
// 3. End-to-end flow audit
// ============================================================
group('3. End-to-end voicemail flow');

check('3.1 voicemail-record returns valid TwiML response',
  /Content-Type[^']*'\s*:\s*'text\/xml'/.test(vmr));
check('3.2 voicemail-record handles all three callback shapes (case 1/2/3)',
  /CASE 1[\s\S]*CASE 2[\s\S]*CASE 3/.test(vmr) || /Case 1[\s\S]*Case 2[\s\S]*Case 3/.test(vmr));
check('3.3 incoming hangs up gracefully on error', /<Hangup/.test(inc));

// ============================================================
// 4. Regression — make sure other Record-related logic still works
// ============================================================
group('4. Regression — recording-callback + idempotent insert');

var recCb = read('src/app/api/phone/recording-callback/route.js');
check('4.1 recording-callback still handles RecordingSid', /RecordingSid/.test(recCb));
check('4.2 phone_voicemails upsert idempotency preserved (onConflict)',
  /onConflict:\s*'twilio_recording_sid'/.test(vmr));
check('4.3 transcribe-async fire-and-forget preserved',
  /transcribe-async/.test(vmr));
check('4.4 verifyTwilioSignature still wired', /verifyTwilioSignature/.test(vmr));

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('SUMMARY');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
process.exit(failed > 0 ? 1 : 0);
