// ============================================================
// v55.77 — Engine wiring fixes (#A, #B, #F, #G, #L)
//
// QA review uncovered that A1-A5 was largely cosmetic — all three
// personas spoke with the same voice, used the same system prompt,
// and the audio-stop on persona switch was a half-fix. These tests
// pin the engine wiring so each persona is actually distinct.
// ============================================================
var fs = require('fs');
var path = require('path');
var REPO = path.resolve(__dirname, '..');
var read = function (rel) { return fs.readFileSync(path.join(REPO, rel), 'utf8'); };
var passed = 0, failed = 0, failures = [];
function check(label, cond) {
  if (cond) { console.log('  v ' + label); passed++; }
  else { console.log('  X ' + label); failed++; failures.push(label); }
}
function group(title) { console.log('\n--- ' + title + ' ---'); }

console.log('============================================================');
console.log('v55.77 — ENGINE WIRING (per-persona voice + prompt + halt)');
console.log('============================================================');

var ag = read('src/components/AIGreeter.jsx');
var ab = read('src/components/AssistantsBar.jsx');
var hr = read('src/components/MyHRDesk.jsx');
var ap = read('src/lib/agent-personalities.js');

// ============================================================
// Fix #A — Per-persona TTS voice
// ============================================================
group('Fix #A — Each persona speaks with her OWN voice');

check('#A.1 getElevenLabsVoiceId imported from agent-personalities',
  /import \{[^}]*getElevenLabsVoiceId[^}]*\} from '\.\.\/lib\/agent-personalities'/.test(ag));
check('#A.2 personaVoiceId resolved from active persona',
  /var personaVoiceId = getElevenLabsVoiceId\(activeAgentKey\)/.test(ag));
check('#A.3 resolvedVoiceId prefers user override, falls back to persona voice',
  /var resolvedVoiceId = voicePrefs\.voice_id \|\| personaVoiceId \|\| undefined/.test(ag));
check('#A.4 TTS request body uses resolvedVoiceId (not raw voicePrefs)',
  /voiceId:      resolvedVoiceId/.test(ag));
check('#A.5 No more bare `voicePrefs.voice_id` in TTS payload (would skip persona)',
  !/voiceId:      voicePrefs\.voice_id \|\| undefined/.test(ag));
check('#A.6 Three distinct ElevenLabs voiceIds defined in agent-personalities',
  /voiceId: 'EXAVITQu4vr4xnSDxMaL'/.test(ap)
  && /voiceId: 'pFZP5JQG7iQjIQuC4Bku'/.test(ap)
  && /voiceId: 'XrExE9yKIg1WjnnlVkGX'/.test(ap));

// ============================================================
// Fix #B — Per-persona system prompt
// ============================================================
group('Fix #B — Each persona uses HER OWN system prompt');

check('#B.1 personaIntro prepended to sysPrompt',
  /var personaIntro = '';[\s\S]{0,2000}var sysPrompt = personaIntro\s*\+\s*persona\.prompt/.test(ag));
check('#B.2 personaIntro injects activeAgent.name + role',
  /You are ' \+ activeAgent\.name \+ ', the ' \+ activeAgent\.role \+ ' for KTC International/.test(ag));
check('#B.3 personaIntro injects activeAgent.personalityPrompt',
  /\(activeAgent\.personalityPrompt \|\| ''\)/.test(ag));
check('#B.4 Stay-in-character guidance per persona (Nadia → Jenna/Sara handoff hint)',
  /activeAgentKey === 'nadia' \?[\s\S]{0,200}for HR matters point them to Ms\. Jenna; for coaching point them to Sara/.test(ag));
check('#B.5 Jenna handoff hints include Nadia + Sara',
  /activeAgentKey === 'jenna' \?[\s\S]{0,250}for operational\/business matters point them to Nadia; for performance coaching point them to Sara/.test(ag));
check('#B.6 Sara handoff hints include Jenna + Nadia',
  /activeAgentKey === 'sara'[\s\S]{0,250}for HR matters point them to Ms\. Jenna; for daily operations point them to Nadia/.test(ag));
check('#B.7 personalityPrompt strings exist on all three personas in agent-personalities',
  /nadia:[\s\S]{0,3000}personalityPrompt:/.test(ap)
  && /jenna:[\s\S]{0,3000}personalityPrompt:/.test(ap)
  && /sara:[\s\S]{0,3000}personalityPrompt:/.test(ap));

// ============================================================
// Fix #F — Comprehensive voice halt on persona switch
// ============================================================
group('Fix #F — Persona switch halts ALL voice machinery (not just audio)');

check('#F.1 discardRecordingRef declared',
  /var discardRecordingRef = useRef\(false\)/.test(ag));
check('#F.2 onstop honors discardRecordingRef and skips doSend',
  /discardRecordingRef\.current[\s\S]{0,300}persona-switch discard[\s\S]{0,500}return;/.test(ag));
check('#F.3 onstop resets discard flag for next session',
  /discardRecordingRef\.current = false;/.test(ag));
check('#F.4 onstop releases media stream on discard',
  /discardRecordingRef\.current[\s\S]{0,500}releaseMediaStream/.test(ag));
check('#F.5 Persona-switch effect calls mediaRecorder.stop() when active',
  /mediaRecorderRef\.current\.state[\s\S]{0,200}discardRecordingRef\.current = true;\s*mediaRecorderRef\.current\.stop\(\)/.test(ag));
check('#F.6 Persona-switch effect exits conversation mode',
  /conversationModeRef\.current = false;\s*try \{ setConversationMode\(false\)/.test(ag));
check('#F.7 Persona-switch effect tears down conversation monitoring',
  /endConversationMonitoring === 'function'/.test(ag));
check('#F.8 Persona-switch effect fires nadia-tts-stop event',
  /window\.dispatchEvent\(new CustomEvent\('nadia-tts-stop'\)\)/.test(ag));
check('#F.9 Persona-switch effect clears pausedRef',
  /if \(pausedRef && pausedRef\.current\) \{ pausedRef\.current = false; setPaused\(false\)/.test(ag));
check('#F.10 Persona-switch effect dispatches ktc:assistant-changed-cleanup',
  /ktc:assistant-changed-cleanup[\s\S]{0,200}from: fromAgent, to: activeAgentKey/.test(ag));

// ============================================================
// Fix #G — MyHRDesk defer-load gate
// ============================================================
group('Fix #G — MyHRDesk does not fetch until user opens Jenna');

check('#G.1 MyHRDesk accepts active prop',
  /export default function MyHRDesk\(\{ user, userProfile, users, active \}\)/.test(hr));
check('#G.2 hasBeenActive state defers fetch',
  /var \[hasBeenActive, setHasBeenActive\] = useState\(isActive\)/.test(hr));
check('#G.3 loadRecent useEffect gated on hasBeenActive',
  /if \(!hasBeenActive\) return;\s*loadRecent\(\)/.test(hr));
check('#G.4 AssistantsBar passes active prop to MyHRDesk',
  /<MyHRDesk[\s\S]{0,200}active=\{openPanel === 'jenna'\}/.test(ab));

// ============================================================
// Fix #L — Modal closes on persona switch (form draft preserved)
// ============================================================
group('Fix #L — HR modal closes on persona switch but form draft preserved');

check('#L.1 MyHRDesk listens for ktc:assistant-changed-cleanup',
  /addEventListener\('ktc:assistant-changed-cleanup'/.test(hr));
check('#L.2 Handler closes modal when switching AWAY from Jenna',
  /to !== 'jenna' && openModal\) \{\s*setOpenModal\(null\)/.test(hr));
check('#L.3 Handler does NOT reset form state (draft preserved)',
  // Within the handler function body only — should NOT call setForm.
  // We isolate the handler block: from "var handler = function (ev) {" to its closing "};"
  (function () {
    var m = hr.match(/var handler = function \(ev\) \{[\s\S]*?\n    \};/);
    if (!m) return false;
    return !/setForm\(/.test(m[0]);
  })());
check('#L.4 Listener cleanup on unmount',
  /removeEventListener\('ktc:assistant-changed-cleanup'/.test(hr));

console.log('\n--- SUMMARY ---');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach(function (f, i) { console.log('  ' + (i + 1) + '. ' + f); });
  process.exit(1);
}
console.log('\nAll ' + passed + ' v55.77 engine-wiring tests passed.');
