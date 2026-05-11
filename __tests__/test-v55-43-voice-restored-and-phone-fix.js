// Test suite for v55.43 — voice RESTORED + phone signature fix
// =============================================
//
// What v55.43 ships:
//
// 1. Phone "an application error has occurred" fix.
//    The Twilio webhook signature check was failing because we computed
//    the signature against one URL while Twilio signed a different one
//    (Vercel proxy mangling). Now we try multiple plausible URLs and
//    accept the request if ANY matches Twilio's signature.
//
// 2. Voice input RESTORED. Two clean modes, no Hey-Nadia wake word:
//      🎙️ Press-to-record — tap to start, tap to stop. Audio → Whisper
//          → transcript → sent to Nadia. Like ChatGPT's keyboard mic.
//      🗣️ Voice conversation — tap once for hands-free back-and-forth.
//          Records → transcribes → Nadia replies with voice → mic
//          re-opens automatically → loop. Tap again to stop. Like
//          ChatGPT's advanced voice mode.

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
console.log('v55.43 VOICE-RESTORED + PHONE-SIG SUITE');
console.log('========================================\n');

var page = read('src/app/page.jsx');
var greeter = read('src/components/AIGreeter.jsx');
var settings = read('src/components/SettingsTab.jsx');
var phoneAuth = read('src/lib/phone-auth.js');

// ----------------------------------------------------------------------
// PHONE SIG FIX
// ----------------------------------------------------------------------
console.log('verifyTwilioSignature — robust against Vercel proxy URL quirks');
assert(/computeSignature/.test(phoneAuth), 'P.1 — computeSignature helper extracted');
assert(/var candidates = \[\];/.test(phoneAuth), 'P.2 — multiple URL candidates collected');
assert(/protocol \+ ':\/\/' \+ hostHeader/.test(phoneAuth), 'P.3 — host-header URL candidate');
assert(/candidates\.push\(req\.url\)/.test(phoneAuth), 'P.4 — req.url candidate');
assert(/process\.env\.NEXT_PUBLIC_APP_URL/.test(phoneAuth), 'P.5 — NEXT_PUBLIC_APP_URL candidate');
assert(/'https:\/\/nexttrade-hub\.vercel\.app' \+ pathAndQuery/.test(phoneAuth), 'P.6 — production fallback candidate');
assert(/var seen = \{\};[\s\S]{0,300}var unique = \[\];/.test(phoneAuth), 'P.7 — candidates de-duplicated');
assert(/for \(var u = 0; u < unique\.length; u\+\+\)/.test(phoneAuth), 'P.8 — loops candidates');
assert(/if \(expected === twilioSig\)/.test(phoneAuth), 'P.9 — accepts any matching candidate');
assert(/signature matched candidate #/.test(phoneAuth), 'P.10 — logs which candidate matched');
assert(/NO candidate matched\. Tried/.test(phoneAuth), 'P.11 — logs all tried URLs on failure');

// ----------------------------------------------------------------------
// PHONE INCOMING — bullet-proof catch handler
// ----------------------------------------------------------------------
console.log('\n/api/phone/incoming — catch handler is bullet-proof');
var incoming = read('src/app/api/phone/incoming/route.js');
assert(/Be defensive/.test(incoming), 'I.1 — catch has defensive doc block');
assert(/var msg = '\(unknown\)';/.test(incoming), 'I.2 — safe default error string');
assert(/Last resort — even building the fallback TwiML failed/.test(incoming), 'I.3 — last-resort fallback');
assert(/<Say>Thank you for calling KTC\. Please try again or send a message\.<\/Say>/.test(incoming),
  'I.4 — last-resort plays a polite message instead of "application error"');

// ----------------------------------------------------------------------
// VOICE RESTORED — 🎙️ press-to-record (Mode 1)
// ----------------------------------------------------------------------
console.log('\nVoice restored — 🎙️ press-to-record button');
assert(/v55\.43 — VOICE INPUT BUTTONS — RESTORED/.test(greeter),
  'M1.1 — voice-restored doc block present');
assert(/onClick=\{toggleRecording\}/.test(greeter),
  'M1.2 — 🎙️ button wired to toggleRecording');
assert(/disabled=\{transcribing \|\| conversationMode\}/.test(greeter),
  'M1.3 — 🎙️ button disabled during transcribe OR conversation mode');
assert(/aria-label="Voice record"/.test(greeter),
  'M1.4 — 🎙️ button has aria-label');
assert(/var startRecording = async function/.test(greeter),
  'M1.5 — startRecording function preserved');
assert(/var stopRecording = function/.test(greeter),
  'M1.6 — stopRecording function preserved');
assert(/'\/api\/transcribe'/.test(greeter),
  'M1.7 — uploads to /api/transcribe');
assert(/setTranscribing\(true\)/.test(greeter),
  'M1.8 — sets transcribing state during upload');

// ----------------------------------------------------------------------
// VOICE RESTORED — 🗣️ conversation mode (Mode 2)
// ----------------------------------------------------------------------
console.log('\nVoice restored — 🗣️ conversation mode (ChatGPT-style)');
assert(/var \[conversationMode, setConversationMode\] = useState\(false\)/.test(greeter),
  'M2.1 — conversationMode state declared');
assert(/conversationModeRef = useRef\(false\)/.test(greeter),
  'M2.2 — conversationModeRef for handler reads');
assert(/var toggleConversationMode = async function/.test(greeter),
  'M2.3 — toggleConversationMode defined');
assert(/onClick=\{toggleConversationMode\}/.test(greeter),
  'M2.4 — 🗣️ button wired to toggleConversationMode');
assert(/var startConversationTurn = async function/.test(greeter),
  'M2.5 — startConversationTurn defined');
assert(/AudioContext/.test(greeter),
  'M2.6 — uses AudioContext for silence detection');
assert(/createAnalyser/.test(greeter),
  'M2.7 — creates AnalyserNode for volume monitoring');
assert(/getByteTimeDomainData/.test(greeter),
  'M2.8 — reads time-domain audio for RMS');
assert(/SILENCE_THRESHOLD/.test(greeter),
  'M2.9 — silence threshold constant');
assert(/SILENCE_HOLD_MS/.test(greeter),
  'M2.10 — silence hold duration constant');
assert(/window\.addEventListener\('nadia-tts-stop', onTtsEnd\)/.test(greeter),
  'M2.11 — listens for TTS-end to auto-restart turn');
assert(/conversationModeRef\.current && !recording/.test(greeter),
  'M2.12 — auto-restart only fires when still in mode and idle');
assert(/setConversationMode\(false\);[\s\S]{0,300}endConversationMonitoring/.test(greeter),
  'M2.13 — turning off cleans up monitoring');
assert(/cancelAnimationFrame/.test(greeter),
  'M2.14 — animation-frame loop cleanup');
assert(/setTimeout\(function\(\) \{[\s\S]{0,200}stopRecording[\s\S]{0,100}\}, 30000\)/.test(greeter),
  'M2.15 — 30s safety cap on a single turn');

// ----------------------------------------------------------------------
// VOICE RESTORED — surface text + Settings tab
// ----------------------------------------------------------------------
console.log('\nVoice restored — surface text + Settings tab');
assert(/Type or speak to/.test(greeter) && /activeAgent && activeAgent\.name/.test(greeter),
  'V.1 — placeholder mentions speaking, dynamic per persona (v55.81: not hardcoded to Nadia)');
assert(/\['voice', '🎙️ Voice'\]/.test(settings),
  'V.2 — Voice tab restored in Settings nav');
assert(/<VoiceSettingsPanel/.test(settings),
  'V.3 — VoiceSettingsPanel rendered');
assert(!/Voice — currently disabled/.test(settings),
  'V.4 — old "currently disabled" stub removed');

// ----------------------------------------------------------------------
// HEY NADIA WAKE WORD STAYS OUT (intentional — user said "without Hey Nadia")
// ----------------------------------------------------------------------
console.log('\nHey Nadia wake word stays OUT (per user request)');
assert(!/<VoiceController/.test(page),
  'H.1 — VoiceController is NOT mounted (no always-on wake word)');

// ----------------------------------------------------------------------
// REGRESSION GUARD
// ----------------------------------------------------------------------
console.log('\nRegression guard — previous fixes intact');
assert(/v55\.42 — Detect row type/.test(page),
  'G.1 — v55.42 bank-edit detection still in place');
assert(/findPotentialDuplicates/.test(page),
  'G.2 — v55.41 duplicate-confirm helper still present');
assert(/AUTO-REGISTER/.test(read('src/components/PhoneWidget.jsx')),
  'G.3 — v55.40 phone auto-register still in place');
assert(/dialCallStatus === 'no-answer'/.test(read('src/app/api/phone/voicemail-record/route.js')),
  'G.4 — v55.39 voicemail dial-failed branch still in place');
assert(/const \[time, setTime\] = useState\(null\)/.test(read('src/app/login/page.jsx')),
  'G.5 — v55.38 login hydration fix still in place');
assert(exists('src/components/WhatsAppInbox.jsx'),
  'G.6 — v55.37 WhatsApp inbox still present');
assert(exists('src/app/api/transcribe/route.js'),
  'G.7 — /api/transcribe Whisper endpoint present');
assert(exists('src/app/api/tts/route.js'),
  'G.8 — /api/tts ElevenLabs endpoint present (needed for conversation TTS)');

// ----------------------------------------------------------------------
// VERSION STAMPS
// ----------------------------------------------------------------------
console.log('\nVersion stamps — bumped to v55.43');
function vNum(s) { var m = s.match(/v55\.(\d+)/); return m ? parseInt(m[1], 10) : 0; }
var headerMatch = page.match(/>v55\.\d+(?:-[A-Z])?</);
var modalMatch = page.match(/BUILD v55\.\d+-/);
assert(headerMatch && vNum(headerMatch[0]) >= 43, 'X.1 — header pill v55.43 or later');
assert(modalMatch && vNum(modalMatch[0]) >= 43, 'X.2 — build modal v55.43+');
assert(/BUILD v55\.43-VOICE-RESTORED-AND-PHONE-FIX/.test(page) || vNum(modalMatch[0]) > 43,
  'X.3 — build modal label correct (or bumped past v55.43)');
assert(!/>v55\.42</.test(page), 'X.4 — no v55.42 header pill remains');

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
console.log('\u2713 All v55.43 assertions present.\n');
