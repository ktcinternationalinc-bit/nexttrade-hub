/* v72 HOTFIX 18 — Living Avatar Phase 1 foundation.
 *
 * Parallel build of the new real-time avatar architecture per Max's spec.
 * NOT replacing the legacy AIGreeter + AnimatedPortrait — sitting alongside
 * behind a feature flag (off by default).
 *
 * Three deliverables:
 *   1. WebSocket message schema (JSDoc, not TypeScript — JSX repo)
 *   2. XState 5 state machine
 *   3. LivingAvatar component + useMouthSync + useIdleBlink hooks
 *
 * Backend NOT built — waiting on tech-stack decisions (Phase 2).
 */
var path = require('path');
var fs = require('fs');

function ok(name, cond) {
  if (!cond) { console.log('  ✗ ' + name); process.exitCode = 1; }
  else { console.log('  ✓ ' + name); }
}

var flag    = fs.readFileSync(path.join(__dirname, '..', 'src/features/living-avatar/feature-flag.js'), 'utf8');
var index   = fs.readFileSync(path.join(__dirname, '..', 'src/features/living-avatar/index.js'), 'utf8');
var schema  = fs.readFileSync(path.join(__dirname, '..', 'src/features/living-avatar/lib/wire-schema.js'), 'utf8');
var machine = fs.readFileSync(path.join(__dirname, '..', 'src/features/living-avatar/lib/avatar-machine.js'), 'utf8');
var mouth   = fs.readFileSync(path.join(__dirname, '..', 'src/features/living-avatar/hooks/useMouthSync.js'), 'utf8');
var blink   = fs.readFileSync(path.join(__dirname, '..', 'src/features/living-avatar/hooks/useIdleBlink.js'), 'utf8');
var avatar  = fs.readFileSync(path.join(__dirname, '..', 'src/features/living-avatar/components/LivingAvatar.jsx'), 'utf8');
var pkg     = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

console.log('\n── Foundation: parallel structure, no legacy edits ──');

ok('A1: Folder structure exists at /src/features/living-avatar/',
  fs.existsSync(path.join(__dirname, '..', 'src/features/living-avatar')) &&
  fs.existsSync(path.join(__dirname, '..', 'src/features/living-avatar/hooks')) &&
  fs.existsSync(path.join(__dirname, '..', 'src/features/living-avatar/lib')) &&
  fs.existsSync(path.join(__dirname, '..', 'src/features/living-avatar/components')));

ok('A2: Legacy AIGreeter.jsx still exists (NOT replaced)',
  fs.existsSync(path.join(__dirname, '..', 'src/components/AIGreeter.jsx')));

ok('A3: Legacy AnimatedPortrait.jsx still exists (NOT replaced)',
  fs.existsSync(path.join(__dirname, '..', 'src/components/AnimatedPortrait.jsx')));

ok('A4: xstate dependency added to package.json',
  pkg.dependencies && pkg.dependencies.xstate);

ok('A5: Index barrel exports LivingAvatar + hooks + machine + schema + flag',
  /export.*LivingAvatar/.test(index) &&
  /export.*useMouthSync/.test(index) &&
  /export.*useIdleBlink/.test(index) &&
  /export.*livingAvatarMachine/.test(index) &&
  /export.*MESSAGE_TYPES/.test(index) &&
  /export.*isLivingAvatarEnabled/.test(index));

console.log('\n── Feature flag ──');

ok('B1: feature-flag.js defines DEFAULT_ENABLED = false (off by default)',
  /var DEFAULT_ENABLED = false/.test(flag));

ok('B2: isLivingAvatarEnabled() checks localStorage with SSR-safe guard',
  /typeof window === 'undefined'/.test(flag) &&
  /localStorage\.getItem\('useLivingAvatar'\)/.test(flag));

ok('B3: setLivingAvatarEnabled(bool) lets caller toggle from JS',
  /export function setLivingAvatarEnabled/.test(flag));

console.log('\n── WebSocket message schema (JSDoc, not TypeScript) ──');

ok('C1: Schema uses JSDoc @typedef instead of TypeScript interface',
  /@typedef/.test(schema) && !/^interface /m.test(schema) && !/^type \w+ =/m.test(schema));

ok('C2: BaseEnvelope defines conversationId + personaId + sequenceId + timestamp + type + payload',
  /BaseEnvelope[\s\S]{0,500}conversationId[\s\S]{0,200}personaId[\s\S]{0,200}sequenceId[\s\S]{0,200}timestamp/.test(schema));

ok('C3: MESSAGE_TYPES enum covers all client + server message types',
  /CLIENT_AUDIO_CHUNK[\s\S]{0,800}CLIENT_INTERRUPT[\s\S]{0,800}SERVER_TTS_CHUNK[\s\S]{0,800}SERVER_AVATAR_STATE/.test(schema));

ok('C4: buildMessage() helper centralizes envelope construction',
  /export function buildMessage\(type, fields\)/.test(schema) &&
  /timestamp: Date\.now\(\)/.test(schema));

ok('C5: isStale() helper rejects messages with old sequenceId',
  /export function isStale\(msg, acceptedSequenceId\)/.test(schema) &&
  /msg\.sequenceId < acceptedSequenceId/.test(schema));

console.log('\n── XState 5 machine ──');

ok('D1: Uses XState 5 setup() + createMachine() API',
  /import \{ setup, assign \} from 'xstate'/.test(machine) &&
  /setup\(\{[\s\S]+\}\)\.createMachine/.test(machine));

ok('D2: Five core states defined: idle / listening / thinking / speaking / interrupted / error',
  /idle: \{/.test(machine) &&
  /listening: \{/.test(machine) &&
  /thinking: \{/.test(machine) &&
  /speaking: \{/.test(machine) &&
  /interrupted: \{/.test(machine) &&
  /error: \{/.test(machine));

ok('D3: INTERRUPT event handled in thinking AND speaking states',
  /thinking:[\s\S]{0,800}INTERRUPT: \{[\s\S]{0,200}target: 'interrupted'/.test(machine) &&
  /speaking:[\s\S]{0,800}INTERRUPT: \{[\s\S]{0,200}target: 'interrupted'/.test(machine));

ok('D4: INTERRUPT action bumps sequenceId so stale messages get rejected',
  /INTERRUPT[\s\S]{0,300}bumpSequence/.test(machine));

ok('D5: Persona switch is a global transition (works from any state)',
  /SWITCH_PERSONA: \{[\s\S]{0,500}target: '\.idle'[\s\S]{0,200}bumpSequence/.test(machine));

ok('D6: interrupted state has auto-transition back to listening (barge-in flow)',
  /interrupted: \{[\s\S]{0,400}after: \{[\s\S]{0,200}target: 'listening'/.test(machine));

ok('D7: bumpSequence action increments sequenceId in context',
  /bumpSequence: assign\(function \(args\) \{[\s\S]{0,200}context\.sequenceId \+ 1/.test(machine));

ok('D8: getDisplayState helper hides XState internals from callers',
  /export function getDisplayState/.test(machine));

console.log('\n── useMouthSync hook ──');

ok('E1: Hook imports from React (useEffect + useRef)',
  /import \{ useEffect, useRef \} from 'react'/.test(mouth));

ok('E2: Primary path uses Web Audio API analyser',
  /createAnalyser\(\)/.test(mouth) &&
  /getByteFrequencyData/.test(mouth));

ok('E3: Bucketizes amplitude into closed / small / medium / wide',
  /function bucketize\(level\)/.test(mouth) &&
  /'closed'/.test(mouth) && /'small'/.test(mouth) && /'medium'/.test(mouth) && /'wide'/.test(mouth));

ok('E4: Fallback path uses timed oscillation when Web Audio unavailable',
  /startTimedFallback/.test(mouth) &&
  /setInterval/.test(mouth));

ok('E5: Cleanup tears down RAF + interval + analyser source',
  /cancelAnimationFrame\(rafRef\.current\)/.test(mouth) &&
  /clearInterval\(fallbackTimerRef\.current\)/.test(mouth) &&
  /sourceRef\.current\.disconnect/.test(mouth));

ok('E6: Cleanup resets mouth to closed (no stuck-open bug)',
  /onShapeRef\.current\('closed', 0\)/.test(mouth));

ok('E7: Cleanup fires on speaking=false AND on unmount (returns cleanup function)',
  /if \(!speaking \|\| !audioElement\) \{[\s\S]{0,200}cleanup\(\);[\s\S]{0,100}return cleanup;[\s\S]{0,100}\}/.test(mouth));

console.log('\n── useIdleBlink hook ──');

ok('F1: Hook is paused while speaking',
  /paused/.test(blink) &&
  /if \(paused\) \{[\s\S]{0,200}onBlinkRef\.current\(false\)/.test(blink));

ok('F2: Schedules blinks with jitter (3-5s base interval with random variance)',
  /baseInterval \* \(0\.75 \+ Math\.random\(\) \* 0\.75\)/.test(blink));

ok('F3: 5% chance of double-blink (natural human behavior)',
  /Math\.random\(\) < 0\.05/.test(blink));

ok('F4: Cleanup clears timeout + resets blinking to false',
  /clearTimeout\(timer\)/.test(blink) &&
  /onBlinkRef\.current\(false\)/.test(blink));

console.log('\n── LivingAvatar component ──');

ok('G1: Hard rule enforced: only active+speaking persona animates',
  /isSpeaking = isActive && speakingPersonaId === personaId && machineState === 'speaking'/.test(avatar));

ok('G2: Audio element only passed to useMouthSync when this avatar is the speaker',
  /audioElement: isSpeaking \? audioElement : null/.test(avatar));

ok('G3: Blink suppressed while speaking',
  /useIdleBlink\(\{[\s\S]{0,200}paused: isSpeaking/.test(avatar));

ok('G4: Per-persona face anchors for Nadia + Jenna + Sara',
  /nadia:[\s\S]{0,500}skinTone: '#d8a988'/.test(avatar) &&
  /jenna:[\s\S]{0,500}skinTone: '#d8a886'/.test(avatar) &&
  /sara:[\s\S]{0,500}skinTone: '#e8c4a0'/.test(avatar));

ok('G5: Inactive avatars rendered with reduced opacity + grayscale (visual cue)',
  /opacity: isActive \? 1 : 0\.55/.test(avatar) &&
  /grayscale\(0\.4\)/.test(avatar));

ok('G6: Photo onError fallback shows persona initial (same diagnostic as legacy)',
  /onError=\{function \(e\)/.test(avatar) &&
  /textContent = \(alt \|\| '\?'\)\.charAt\(0\)\.toUpperCase\(\)/.test(avatar));

ok('G7: data-* attributes expose state for testing + debugging',
  /data-state=\{machineState\}/.test(avatar) &&
  /data-persona=\{personaId\}/.test(avatar) &&
  /data-speaking=\{isSpeaking \? 'true' : 'false'\}/.test(avatar));

console.log('\n══════════════════════════════════════════════');
if (process.exitCode) console.log('FAILED');
else console.log('✅ HOTFIX 18 — Living Avatar Phase 1 foundation built (parallel, flag-gated, frontend-only)');
console.log('══════════════════════════════════════════════');
