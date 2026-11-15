/* v72 HOTFIX 13 — Bring the three AI personas to life with real photos +
 * animated faces + tuned voices.
 *
 * Max's words: "I have a portrait of all 3 ai assistants. Want to bring them
 * to life in my portal. talking with real gestures.. real people faces.. real
 * voices.. each with 3 unique personalities coming to life"
 *
 * What this hotfix does:
 *   1. TTS upgraded: eleven_turbo_v2_5 for English (more natural prosody),
 *      eleven_multilingual_v2 only for Arabic. Default stability dropped to
 *      0.35 (was 0.5) so voices are expressive instead of flat.
 *   2. Per-persona TTS settings (each persona's voice block has tts: {...}):
 *      Nadia composed (stab 0.45), Jenna warm (0.30), Sara bouncy (0.25).
 *   3. AIGreeter passes persona-tuned stability/similarity/style through to TTS
 *      whenever the user hasn't explicitly overridden them.
 *   4. NEW component AnimatedPortrait — real photo + audio-driven mouth + blinks
 *      + eyebrow lift + head sway. Replaces the conditional (NadiaFace for Nadia,
 *      PortraitAvatar for others) with a single component used for all 3.
 *   5. Each persona has its own faceAnchors block + gestureMode
 *      (composed / warm / bouncy) so they have distinct body language.
 */
var path = require('path');
var fs = require('fs');

function ok(name, cond) {
  if (!cond) { console.log('  ✗ ' + name); process.exitCode = 1; }
  else { console.log('  ✓ ' + name); }
}

var tts  = fs.readFileSync(path.join(__dirname, '..', 'src/app/api/tts/route.js'), 'utf8');
var ag   = fs.readFileSync(path.join(__dirname, '..', 'src/components/AIGreeter.jsx'), 'utf8');
var pers = fs.readFileSync(path.join(__dirname, '..', 'src/lib/agent-personalities.js'), 'utf8');
var ap   = fs.readFileSync(path.join(__dirname, '..', 'src/components/AnimatedPortrait.jsx'), 'utf8');

console.log('\n── TTS quality upgrade ──');

ok('A1: English uses eleven_turbo_v2_5 model (more natural prosody)',
  /eleven_turbo_v2_5/.test(tts));

ok('A2: Arabic detection switches model to eleven_multilingual_v2',
  /hasArabic = \/\[\\u0600-\\u06FF\]/.test(tts) &&
  /hasArabic \? 'eleven_multilingual_v2' : 'eleven_turbo_v2_5'/.test(tts));

ok('A3: Default stability dropped to 0.35 (was 0.5) for more expression',
  /clamp\(body\.stability, 0, 1, 0\.35\)/.test(tts));

ok('A4: Default similarity raised to 0.82 (was 0.75)',
  /clamp\(body\.similarity, 0, 1, 0\.82\)/.test(tts));

ok('A5: Default style nudged to 0.15 (was 0.0) for speaking-style energy',
  /clamp\(body\.style, 0, 1, 0\.15\)/.test(tts));

ok('A6: modelId variable selected dynamically, not hardcoded',
  /model_id: modelId/.test(tts));

console.log('\n── Per-persona TTS settings ──');

ok('B1: Nadia has tts block — composed (high stability, low style)',
  /name: 'Nadia'[\s\S]{0,2000}tts: \{ stability: 0\.45, similarity: 0\.85, style: 0\.10 \}/.test(pers));

ok('B2: Jenna has tts block — warm (lower stability, higher style)',
  /name: 'Jenna'[\s\S]{0,2000}tts: \{ stability: 0\.30, similarity: 0\.80, style: 0\.25 \}/.test(pers));

ok('B3: Sara has tts block — bouncy (lowest stability, highest style)',
  /name: 'Sara'[\s\S]{0,2000}tts: \{ stability: 0\.25, similarity: 0\.78, style: 0\.35 \}/.test(pers));

console.log('\n── AIGreeter wires persona TTS settings ──');

ok('C1: AIGreeter reads activeAgent.voice.tts',
  /var personaTTS = \(activeAgent && activeAgent\.voice && activeAgent\.voice\.tts\) \|\| \{\}/.test(ag));

ok('C2: stability falls back to personaTTS when user has no override',
  /resolvedStability\s+= voicePrefs\.stability\s+!= null \? voicePrefs\.stability\s+: personaTTS\.stability/.test(ag));

ok('C3: similarity falls back to personaTTS',
  /resolvedSimilarity\s+= voicePrefs\.similarity\s+!= null \? voicePrefs\.similarity\s+: personaTTS\.similarity/.test(ag));

ok('C4: style falls back to personaTTS',
  /resolvedStyle\s+= voicePrefs\.style\s+!= null \? voicePrefs\.style\s+: personaTTS\.style/.test(ag));

ok('C5: resolved values get sent in /api/tts request body',
  /stability:\s+resolvedStability/.test(ag) &&
  /similarity:\s+resolvedSimilarity/.test(ag) &&
  /style:\s+resolvedStyle/.test(ag));

console.log('\n── Per-persona face anchors + gesture mode ──');

ok('D1: Nadia has faceAnchors with gestures = "composed"',
  /name: 'Nadia'[\s\S]{0,3000}faceAnchors: \{[\s\S]{0,400}gestures: 'composed'/.test(pers));

ok('D2: Jenna has faceAnchors with gestures = "warm"',
  /name: 'Jenna'[\s\S]{0,3000}faceAnchors: \{[\s\S]{0,400}gestures: 'warm'/.test(pers));

ok('D3: Sara has faceAnchors with gestures = "bouncy"',
  /name: 'Sara'[\s\S]{0,3000}faceAnchors: \{[\s\S]{0,400}gestures: 'bouncy'/.test(pers));

ok('D4: All 3 personas have mouth + eyeL + eyeR anchors (HOTFIX 15 — measured per actual portrait)',
  (pers.match(/mouth:\s+\{ x: [\d.]+,\s+y: [\d.]+,\s+width: [\d.]+ \}/g) || []).length >= 3 &&
  (pers.match(/eyeL:\s+\{ x: [\d.]+,\s+y: [\d.]+,\s+width: [\d.]+ \}/g) || []).length >= 3 &&
  (pers.match(/eyeR:\s+\{ x: [\d.]+,\s+y: [\d.]+,\s+width: [\d.]+ \}/g) || []).length >= 3);

console.log('\n── AnimatedPortrait component ──');

ok('E1: AnimatedPortrait exports default function',
  /export default function AnimatedPortrait/.test(ap));

ok('E2: Accepts photo, speaking, listening, loading, audioElement, faceAnchors',
  /photo[\s\S]{0,200}speaking = false[\s\S]{0,200}listening = false[\s\S]{0,200}loading = false[\s\S]{0,200}audioElement = null[\s\S]{0,200}faceAnchors = null/.test(ap));

ok('E3: Audio-reactive — uses Web Audio API analyser for amplitude',
  /createAnalyser\(\)/.test(ap) && /getByteFrequencyData/.test(ap));

ok('E4: Mouth opens vertically with amplitude (real lip-sync)',
  /mouthOpenH = \(0\.06 \+ amp \* 0\.30\) \* mouthW/.test(ap));

ok('E5: Periodic blinks at human intervals (3-5s base)',
  /baseInterval = 3200 \+ Math\.random\(\) \* 2400/.test(ap));

ok('E6: Eyebrow lift on emphasis (driven by amplitude)',
  /setBrow\(Math\.min\(1, normalized \* 1\.1 \* gestureIntensity\.brow\)\)/.test(ap));

ok('E7: Head sway animation — translate + rotate driven by audio + persona',
  /setSway\(\{[\s\S]{0,400}rx: [\s\S]{0,100}ry: [\s\S]{0,100}tx: [\s\S]{0,100}ty:/.test(ap));

ok('E8: Per-persona gesture intensity (composed / warm / bouncy)',
  /gestureMode === 'bouncy'[\s\S]{0,300}sway: 1\.6/.test(ap) &&
  /gestureMode === 'warm'[\s\S]{0,300}sway: 1\.1/.test(ap) &&
  /sway: 0\.7/.test(ap));

ok('E9: Listening state — slow attentive head tilt',
  /if \(!listening\) return;[\s\S]{0,400}setSway\(\{/.test(ap));

ok('E10: Audio cleanup mirrors NadiaFace hardened teardown (no leaks)',
  /sourceRef\.current\.disconnect\(\)/.test(ap) &&
  /cancelAnimationFrame\(rafRef\.current\)/.test(ap));

ok('E11: Idle breathing scale when not speaking and not listening',
  /if \(speaking \|\| listening\) \{ setBreath\(1\); return; \}/.test(ap));

ok('E12: Loading state — thinking dots',
  /loading && \(/.test(ap) && /animatedPortraitDots/.test(ap));

console.log('\n── AIGreeter uses AnimatedPortrait for all 3 personas ──');

ok('F1: AnimatedPortrait imported in AIGreeter',
  /import AnimatedPortrait from '\.\/AnimatedPortrait'/.test(ag));

ok('F2: AnimatedPortrait renders unconditionally — no longer Nadia-only conditional',
  /<AnimatedPortrait\s/.test(ag));

ok('F3: AnimatedPortrait receives photo from activeAgent.photo',
  /<AnimatedPortrait[\s\S]{0,400}photo=\{activeAgent\.photo\}/.test(ag));

ok('F4: AnimatedPortrait receives faceAnchors from activeAgent.faceAnchors',
  /<AnimatedPortrait[\s\S]{0,600}faceAnchors=\{activeAgent\.faceAnchors\}/.test(ag));

ok('F5: AnimatedPortrait receives speaking + listening + loading + audioElement',
  /<AnimatedPortrait[\s\S]{0,700}speaking=\{speaking\}[\s\S]{0,200}listening=\{listening\}[\s\S]{0,200}loading=\{loading\}[\s\S]{0,200}audioElement=\{currentAudio\}/.test(ag));

ok('F6: Conditional "Nadia uses NadiaFace, others use PortraitAvatar" is REMOVED',
  !/activeAgentKey === 'nadia' \? \(\s*<NadiaFace/.test(ag));

console.log('\n══════════════════════════════════════════════');
if (process.exitCode) console.log('FAILED');
else console.log('✅ HOTFIX 13 — voices upgraded, faces brought to life on real photos');
console.log('══════════════════════════════════════════════');
