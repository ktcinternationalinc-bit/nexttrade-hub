// Test suite for v55.39 voicemail dial-fail fix
// =============================================
// The bug: when a customer called a KTC number that routed to a team member
// whose browser wasn't currently registered with Twilio (widget closed,
// mic permission failed, etc.), the <Dial> verb in our incoming TwiML
// would fail almost instantly. Twilio then POSTed to the action URL on
// <Dial> — which is /api/phone/voicemail-record — to find out what to
// do next.
//
// The voicemail-record handler had logic for two cases:
//   • DialCallStatus = completed/answered → hang up
//   • RecordingUrl + RecordingSid set     → save voicemail row
//
// But it had NO case for "Dial failed without connecting." When that
// callback hit (DialCallStatus=no-answer/failed/busy/canceled, no
// RecordingUrl), the code fell through to the "no recording" branch
// and just returned <Hangup />. Customers heard the disclaimer then an
// immediate line drop instead of a voicemail prompt.
//
// The fix: add a third branch that returns Record TwiML when
// DialCallStatus indicates the dial did NOT connect.

import fs from 'fs';
import path from 'path';

var REPO = path.resolve(new URL('.', import.meta.url).pathname, '..');

var passed = 0, failed = 0;
var errors = [];
function assert(cond, label) {
  if (cond) { passed++; }
  else { failed++; errors.push(label); console.log('  \u2717 ' + label); }
}
function read(rel) { return fs.readFileSync(path.join(REPO, rel), 'utf8'); }
function exists(rel) { return fs.existsSync(path.join(REPO, rel)); }

console.log('\n========================================');
console.log('v55.39 VOICEMAIL DIAL-FAIL FIX TEST SUITE');
console.log('========================================\n');

// ----------------------------------------------------------------------
// VOICEMAIL-RECORD — dial-failed branch present and well-formed
// ----------------------------------------------------------------------
console.log('voicemail-record route — dial-failed branch handles all four failure statuses');
var vm = read('src/app/api/phone/voicemail-record/route.js');

// All four DialCallStatus failure values must be checked
assert(/dialCallStatus === 'no-answer'/.test(vm),
  'V.1 — checks DialCallStatus = no-answer');
assert(/dialCallStatus === 'failed'/.test(vm),
  'V.2 — checks DialCallStatus = failed');
assert(/dialCallStatus === 'busy'/.test(vm),
  'V.3 — checks DialCallStatus = busy');
assert(/dialCallStatus === 'canceled'/.test(vm),
  'V.4 — checks DialCallStatus = canceled');

// The branch must return TwiML containing a <Record> verb (i.e. it must
// actually start recording a voicemail, not just hang up).
// Anchor on the actual `if` statement (not the doc comment that mentions
// the same string), then look at a generous window of characters after.
var noAnswerIdx = vm.indexOf("if (dialCallStatus === 'no-answer'");
assert(noAnswerIdx > 0, 'V.5 — no-answer branch is reachable');
var afterBranch = vm.slice(noAnswerIdx, noAnswerIdx + 3000);
assert(/<Record action=/.test(afterBranch),
  'V.6 — dial-failed branch returns TwiML with <Record action="..."');
assert(/playBeep="true"/.test(afterBranch),
  'V.7 — Record verb plays the beep so caller knows when to talk');
assert(/maxLength="180"/.test(afterBranch),
  'V.8 — Record verb caps voicemail length at 180s (matches incoming/route.js)');
assert(/recordingStatusCallback/.test(afterBranch),
  'V.9 — Record verb sets recordingStatusCallback so audio is saved');
assert(/finishOnKey="#"/.test(afterBranch),
  'V.10 — Record verb lets caller end voicemail by pressing #');
assert(/<Say[^>]*>[\s\S]*?leave a message[\s\S]*?<\/Say>/i.test(afterBranch),
  'V.11 — dial-failed branch plays a "leave a message" prompt before Record');

// ----------------------------------------------------------------------
// REGRESSION GUARDS — the existing two cases must still work
// ----------------------------------------------------------------------
console.log('\nvoicemail-record route — existing branches still intact');

// CASE 1: Dial succeeded → hang up (short-circuits before reaching Record)
assert(/dialCallStatus === 'completed'/.test(vm),
  'V.12 — completed-call branch preserved (hangs up cleanly when call connected)');
assert(/dialCallStatus === 'answered'/.test(vm),
  'V.13 — answered-call branch preserved');

// CASE 3: Recording arrived → save to DB + trigger transcription
assert(/twilio_recording_sid/.test(vm),
  'V.14 — phone_voicemails save path preserved (twilio_recording_sid column write)');
assert(/transcribe-async/.test(vm),
  'V.15 — Whisper transcription trigger preserved');
assert(/onConflict: 'twilio_recording_sid'/.test(vm),
  'V.16 — race-safe upsert with unique constraint preserved');

// ----------------------------------------------------------------------
// SHAPE CHECKS — the new branch must not break Twilio's strict TwiML parser
// ----------------------------------------------------------------------
console.log('\nvoicemail-record route — TwiML shape correctness');

assert(/<\?xml version="1\.0" encoding="UTF-8"\?>/.test(vm),
  'V.17 — TwiML responses include XML declaration');

// The new branch must build voicemailRecordUrl without backticks (Vercel SWC issue)
var noBlockComments = vm.replace(/\/\*[\s\S]*?\*\//g, '');
var noLineComments = noBlockComments.replace(/(^|[^:\\])\/\/.*$/gm, '$1');
var backticksInCode = (noLineComments.match(/`/g) || []).length;
assert(backticksInCode === 0,
  'V.18 — no backticks/template literals in voicemail-record code (Vercel SWC compatibility)');

// The new dial-failed branch must build voicemailRecordUrl using
// getPublicBaseUrl (absolute) — Twilio webhook callback URLs MUST be
// absolute. Relative URLs would cause Twilio to silently 404.
assert(/var voicemailRecordUrl = getPublicBaseUrl/.test(vm),
  'V.19 — dial-failed branch builds an absolute voicemail action URL via getPublicBaseUrl');

// ----------------------------------------------------------------------
// INCOMING — confirm /api/phone/incoming still has the <Dial action="..."> shape
// (so the new branch in voicemail-record actually gets exercised)
// ----------------------------------------------------------------------
console.log('\nincoming route — Dial action wiring still routes to voicemail-record');
var inc = read('src/app/api/phone/incoming/route.js');

assert(/<Dial /.test(inc), 'I.1 — incoming TwiML still uses <Dial>');
assert(/voicemailUrl/.test(inc), 'I.2 — incoming still builds voicemailUrl');
assert(/voicemail-record/.test(inc),
  'I.3 — incoming routes Dial action to /api/phone/voicemail-record');
assert(/timeout="25"/.test(inc),
  'I.4 — Dial timeout preserved at 25s (avoids ringing-into-the-void experience)');

// Version stamps — at least v55.39 (forward-compatible)
console.log('\nVersion stamps — bumped to v55.39 or later');
var page = read('src/app/page.jsx');
function vNum(s) { var m = s.match(/v55\.(\d+)/); return m ? parseInt(m[1], 10) : 0; }
var headerMatch = page.match(/>v55\.\d+(?:-[A-Z])?</);
var modalMatch = page.match(/BUILD v55\.\d+-/);
assert(headerMatch && vNum(headerMatch[0]) >= 39,
  'V.20 — header pill shows v55.39 or later');
assert(modalMatch && vNum(modalMatch[0]) >= 39,
  'V.21 — build modal shows v55.39-* or later');
assert(!/>v55\.38</.test(page), 'V.22 — no v55.38 header pill remains');
assert(!/BUILD v55\.38-LOGIN-HYDRATION-FIX/.test(page),
  'V.23 — no v55.38 build modal label remains');

// ----------------------------------------------------------------------
// REGRESSION GUARD — earlier fixes still in place
// ----------------------------------------------------------------------
console.log('\nRegression guard — v55.38 + v55.37 features intact');
assert(/const \[time, setTime\] = useState\(null\)/.test(read('src/app/login/page.jsx')),
  'G.1 — v55.38 login hydration fix still in place');
assert(/translate="no"/.test(read('src/app/layout.jsx')),
  'G.2 — v55.38 layout notranslate guard still in place');
assert(exists('src/components/WhatsAppInbox.jsx'),
  'G.3 — v55.37 WhatsApp inbox component still present');
assert(exists('src/app/api/phone/diagnose/route.js'),
  'G.4 — phone diagnostic endpoint still present');

// ----------------------------------------------------------------------
// SUMMARY
// ----------------------------------------------------------------------
console.log('\n========================================');
console.log('TOTAL: ' + (passed + failed) + ' assertions');
console.log('PASSED: ' + passed);
console.log('FAILED: ' + failed);
console.log('========================================\n');

if (failed > 0) {
  console.log('FAILURES:');
  errors.forEach(function (e) { console.log('  \u2022 ' + e); });
  process.exit(1);
}
console.log('\u2713 All v55.39 voicemail dial-fail fix assertions present.\n');
