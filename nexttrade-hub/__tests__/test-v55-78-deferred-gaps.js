// ============================================================
// v55.78 — Deferred-gaps closure tests
//
// After v55.77 shipped persona-engine wiring (per-persona voice +
// system prompt + comprehensive halt on switch), five gaps remained:
//   #1 Wake-word hardcoded to "Hey Nadia"
//   #2 Chat history shared across personas (cross-pollination)
//   #3 Only Nadia had animated avatar (Jenna/Sara static)
//   #4 No persona persistence across page reloads
//   #5 Silence-detection threshold hardcoded (no ambient calibration)
// This file pins all 5 fixes so they don't regress.
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
console.log('v55.78 — DEFERRED GAPS CLOSURE');
console.log('============================================================');

var ag = read('src/components/AIGreeter.jsx');
var ab = read('src/components/AssistantsBar.jsx');
var vc = read('src/components/VoiceController.jsx');
var ww = read('src/lib/voice/wake-word.js');
var pg = read('src/app/page.jsx');
var pa = read('src/components/PortraitAvatar.jsx');

// ============================================================
// Gap #1 — Wake-word for all three personas
// ============================================================
group('Gap #1 — Wake-word recognizes all three personas + routes');

check('#1.1 Wake regex includes Jenna variants',
  /jenna\|gina\|jeanna\|jana\|gianna\|jenn\|jenny/.test(ww));
check('#1.2 Wake regex includes Sara variants',
  /sara\|sarah\|sarra\|sera\|sarai/.test(ww));
check('#1.3 VARIANT_TO_AGENT maps Jenna variants to "jenna"',
  /jenna: 'jenna'[\s\S]{0,300}gina: 'jenna'/.test(ww));
check('#1.4 VARIANT_TO_AGENT maps Sara variants to "sara"',
  /sara: 'sara'[\s\S]{0,200}sarah: 'sara'/.test(ww));
check('#1.5 detectWakeWord returns agent field',
  /agent: agent[\s\S]{0,200}\}/.test(ww) && /var agent = VARIANT_TO_AGENT\[variant\]/.test(ww));
check('#1.6 createWakeEngine state tracks activeAgent',
  /activeAgent: null/.test(ww));
check('#1.7 createWakeEngine.process returns out.agent',
  /out\.agent = state\.activeAgent/.test(ww) && /out\.agent = det\.agent/.test(ww));
check('#1.8 getActiveAgent accessor exposed',
  /function getActiveAgent\(\)[\s\S]{0,80}return state\.activeAgent/.test(ww)
  && /return \{[\s\S]{0,200}getActiveAgent: getActiveAgent/.test(ww));
check('#1.9 VoiceController dispatches agent in hey-bob-command detail (silence path)',
  /var pendingAgent = engineRef\.current\.getActiveAgent[\s\S]{0,300}detail: \{ command: pending, agent: pendingAgent \|\| null/.test(vc));
check('#1.10 VoiceController dispatches agent in hey-bob-command detail (trigger path)',
  /detail: \{ command: out\.command, agent: out\.agent \|\| null/.test(vc));
check('#1.11 AIGreeter onBobCommand reads agent from event detail',
  /var namedAgent = ev && ev\.detail && ev\.detail\.agent/.test(ag));
check('#1.12 AIGreeter dispatches ktc:assistant-changed when wake-word names different persona',
  /namedAgent !== activeAgentKey[\s\S]{0,500}ktc:assistant-changed[\s\S]{0,200}detail: \{ agent: namedAgent \}/.test(ag));
check('#1.13 AssistantsBar listens for external ktc:assistant-changed (syncs openPanel)',
  // Handler is defined ABOVE addEventListener, so setOpenPanel
  // appears before the addEventListener line. Verify by ordering:
  // first occurrence of setOpenPanel(function (prev) { return prev === who
  // followed by addEventListener('ktc:assistant-changed'.
  /setOpenPanel\(function \(prev\) \{ return prev === who[\s\S]{0,200}addEventListener\('ktc:assistant-changed'/.test(ab));
check('#1.14 AssistantsBar handler ignores invalid agent values',
  /who !== 'nadia' && who !== 'jenna' && who !== 'sara'\) return/.test(ab));

// ============================================================
// Gap #2 — Per-persona conversation history
// ============================================================
group('Gap #2 — Per-persona conversation threads (no cross-pollination)');

check('#2.1 greeterMessagesByAgent state holds all three threads',
  /useState\(\{ nadia: \[\], jenna: \[\], sara: \[\] \}\)/.test(pg));
check('#2.2 greeterMessages reads active persona thread',
  /greeterMessages = \(greeterMessagesByAgent && greeterMessagesByAgent\[selectedAssistant\]\) \|\| \[\]/.test(pg));
check('#2.3 setGreeterMessages routes updates to active persona slot',
  /updated\[selectedAssistant\] = resolved/.test(pg));
check('#2.4 setGreeterMessages handles functional updates',
  /typeof next === 'function' \? next\(prev\[selectedAssistant\] \|\| \[\]\) : next/.test(pg));
check('#2.5 localStorage hydration reads new byAgent shape',
  /localStorage\.getItem\('nadia\.messages\.byAgent\.' \+ uid\)/.test(pg));
check('#2.6 localStorage hydration migrates legacy single-array shape',
  /localStorage\.getItem\('nadia\.messages\.' \+ uid\)[\s\S]{0,400}setGreeterMessagesByAgent\(\{ nadia: legacyParsed/.test(pg));
check('#2.7 Persistence writes byAgent shape with per-thread cap',
  /localStorage\.setItem\('nadia\.messages\.byAgent\.' \+ uid, JSON\.stringify\(trimmed\)\)/.test(pg)
  && /trim\(greeterMessagesByAgent && greeterMessagesByAgent\.nadia\)/.test(pg));

// ============================================================
// Gap #3 — Animated avatars for Jenna and Sara
// ============================================================
group('Gap #3 — PortraitAvatar gives Jenna and Sara audio-reactive animation');

check('#3.1 PortraitAvatar component file exists',
  /export default function PortraitAvatar\(/.test(pa));
check('#3.2 PortraitAvatar accepts speaking, listening, loading, audioElement props',
  /speaking = false[\s\S]{0,200}listening = false[\s\S]{0,200}loading = false[\s\S]{0,200}audioElement = null/.test(pa));
check('#3.3 PortraitAvatar wires Web Audio analyser when speaking + audioElement provided',
  /analyser = ctx\.createAnalyser\(\)[\s\S]{0,200}analyser\.fftSize = 256/.test(pa));
check('#3.4 PortraitAvatar has fallback shimmer when audio source unavailable',
  /var startFallback = function \(\)/.test(pa));
check('#3.5 PortraitAvatar disconnects prior source on cleanup (no leak)',
  /var disconnectPrior = function \(\)[\s\S]{0,300}sourceRef\.current\.disconnect/.test(pa));
check('#3.6 PortraitAvatar listening state shows red breathing ring',
  /listening && !speaking[\s\S]{0,300}border: '2px solid #ef4444'/.test(pa));
check('#3.7 PortraitAvatar loading state shows thinking dots',
  /\{loading && \(/.test(pa) && /avatar-loading-dot/.test(pa));
check('#3.8 PortraitAvatar idle breathing animation',
  /setBreath\(1 \+ Math\.sin\(i \/ 8\) \* 0\.012\)/.test(pa));
check('#3.9 AIGreeter imports PortraitAvatar',
  /import PortraitAvatar from '\.\/PortraitAvatar'/.test(ag));
check('#3.10 AIGreeter uses AnimatedPortrait for ALL personas (HOTFIX 13 unified — was PortraitAvatar for non-Nadia)',
  /<AnimatedPortrait[\s\S]{0,500}photo=\{activeAgent\.photo\}[\s\S]{0,400}audioElement=\{currentAudio\}/.test(ag));
check('#3.11 AnimatedPortrait wired with faceAnchors (HOTFIX 13 — was conditional NadiaFace for Nadia)',
  /<AnimatedPortrait[\s\S]{0,600}faceAnchors=\{activeAgent\.faceAnchors\}/.test(ag));

// ============================================================
// Gap #4 — Persona persistence across page reloads
// ============================================================
group('Gap #4 — Last-active persona persists across reloads');

check('#4.1 page.jsx selectedAssistant per-user persona key (BD-audit fix v55.80)',
  /'ktc\.lastPersona\.' \+ uid|getItem\('ktc\.lastPersona\.'/.test(pg));
check('#4.2 page.jsx accepts only valid persona values from storage',
  /saved === 'nadia' \|\| saved === 'jenna' \|\| saved === 'sara'/.test(pg));
check('#4.3 page.jsx persists selectedAssistant on every change (per-user key)',
  /setItem\('ktc\.lastPersona\.' \+ uid, selectedAssistant\)/.test(pg));
check('#4.4 AssistantsBar openPanel hydrates from per-user localStorage after auth',
  /'ktc\.lastPersona\.' \+ myId|getItem\('ktc\.lastPersona\.'/.test(ab));
check('#4.5 AssistantsBar fall back to nadia (default before user known)',
  /useState\('nadia'\)|return 'nadia'/.test(ab));

// ============================================================
// Gap #5 — Adaptive silence threshold
// ============================================================
group('Gap #5 — Conversation mode silence threshold adapts to ambient noise');

check('#5.1 Calibration window defined (~600ms)',
  /var CALIBRATION_MS = 600/.test(ag));
check('#5.2 Floor + ceiling thresholds bound the result',
  /var FLOOR_THRESHOLD = 8/.test(ag) && /var CEILING_THRESHOLD = 35/.test(ag));
check('#5.3 Threshold multiplier is 1.8x ambient',
  /var THRESHOLD_MULTIPLIER = 1\.8/.test(ag));
check('#5.4 Calibration samples collected during initial window',
  /calibrationSamples\.push\(rms\)/.test(ag));
check('#5.5 Median used for ambient floor (robust to outliers)',
  /calibrationSamples\.sort[\s\S]{0,200}calibrationSamples\[Math\.floor\(calibrationSamples\.length \/ 2\)\]/.test(ag));
check('#5.6 SILENCE_THRESHOLD assigned from calibrated value',
  /SILENCE_THRESHOLD = threshold/.test(ag));
check('#5.7 lastVoice reset after calibration (no false-positive trigger)',
  /calibrated = true;\s*lastVoice = Date\.now\(\)/.test(ag));
check('#5.8 Calibration phase blocks silence-trigger logic',
  /if \(!calibrated\) \{[\s\S]{0,1500}return;/.test(ag));

// ============================================================
// Carry-forward — v55.77 still intact
// ============================================================
group('Carry-forward — v55.77 engine wiring still intact');

check('Carry — getElevenLabsVoiceId still imported',
  /getElevenLabsVoiceId/.test(ag));
check('Carry — personaVoiceId still resolved at TTS time',
  /var personaVoiceId = getElevenLabsVoiceId\(activeAgentKey\)/.test(ag));
check('Carry — personaIntro still prepended to sysPrompt',
  /var sysPrompt = personaIntro\s*\+\s*persona\.prompt/.test(ag));
check('Carry — discardRecordingRef still gates onstop send',
  /var discardRecordingRef = useRef\(false\)/.test(ag));
check('Carry — Persona-switch effect still comprehensive',
  /endConversationMonitoring === 'function'/.test(ag));
check('Carry — MyHRDesk active-prop defer-load still in place',
  /var \[hasBeenActive, setHasBeenActive\] = useState\(isActive\)/.test(read('src/components/MyHRDesk.jsx')));

console.log('\n--- SUMMARY ---');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach(function (f, i) { console.log('  ' + (i + 1) + '. ' + f); });
  process.exit(1);
}
console.log('\nAll ' + passed + ' v55.78 deferred-gaps tests passed.');
