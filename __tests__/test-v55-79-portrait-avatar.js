// ============================================================
// v55.79 — Animated avatar parity (Jenna + Sara)
//
// Before: Nadia had animated SVG NadiaFace with lip-sync; Jenna and
// Sara showed static photos with a colored ring. Big visual gap.
// Now: PortraitAvatar component drives Jenna + Sara avatars with
// audio-amplitude-reactive concentric rings. All three personas have
// living talking faces.
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
console.log('v55.79 — Animated avatars for Jenna and Sara');
console.log('============================================================');

var pa = read('src/components/PortraitAvatar.jsx');
var ag = read('src/components/AIGreeter.jsx');
var css = read('src/app/globals.css');

group('1. PortraitAvatar component exists and is structured');
check('1.1 PortraitAvatar.jsx is a default export',
  /export default function PortraitAvatar\b/.test(pa));
check('1.2 Accepts the same props as NadiaFace plus photo/alt',
  /\{[\s\S]*photo[\s\S]*alt[\s\S]*speaking[\s\S]*listening[\s\S]*loading[\s\S]*color[\s\S]*size[\s\S]*audioElement[\s\S]*\}/.test(pa));
check('1.3 Imports React hooks',
  /import \{ useEffect, useRef, useState \} from 'react'/.test(pa));

group('2. Audio analyser pattern matches NadiaFace hardening');
check('2.1 Uses AudioContext / webkitAudioContext detection',
  /window\.AudioContext \|\| window\.webkitAudioContext/.test(pa));
check('2.2 Creates AnalyserNode with fftSize',
  /ctx\.createAnalyser\(\)[\s\S]{0,200}fftSize/.test(pa));
check('2.3 Uses getByteTimeDomainData for amplitude',
  /getByteTimeDomainData\(data\)/.test(pa));
check('2.4 Disconnects prior source before wiring new (no leak)',
  /var disconnectPrior = function \(\) \{[\s\S]{0,400}sourceRef\.current\.disconnect/.test(pa));
check('2.5 RAF cleanup on unmount + cancellation',
  /cancelled = true/.test(pa) && /cancelAnimationFrame\(localRaf\)|cancelAnimationFrame\(rafRef\.current\)/.test(pa));
check('2.6 Resumes suspended AudioContext (mobile autoplay policy)',
  /ctx\.state === 'suspended'[\s\S]{0,80}ctx\.resume\(\)/.test(pa));

group('3. Defensive double-hook guard (v55.79 QA fix)');
check('3.1 Checks __nadiaHooked + __portraitHooked before createMediaElementSource',
  /audioElement\.__nadiaHooked \|\| audioElement\.__portraitHooked/.test(pa));
check('3.2 Falls back to procedural shimmer if already hooked',
  /__nadiaHooked \|\| audioElement\.__portraitHooked\) \{\s*startFallback\(\)/.test(pa));
check('3.3 Sets __portraitHooked marker after successful createMediaElementSource',
  /audioElement\.__portraitHooked = true/.test(pa));

group('4. Procedural fallback when audioElement absent');
check('4.1 Has startFallback function for browser-TTS path',
  /var startFallback = function \(\) \{/.test(pa));
check('4.2 Fallback uses smoothed random target (no jitter)',
  /target = 0\.\d+ \+ Math\.random\(\) \* 0\.\d+/.test(pa));

group('5. Visual states');
check('5.1 Speaking renders concentric pulsing rings',
  /\{speaking && \(\s*<div\s+aria-hidden\s+style=\{\{[\s\S]{0,300}border: '2px solid ' \+ color/.test(pa));
check('5.2 Speaking modulates photo scale with amp',
  /var photoScale = speaking \? \(1 \+ amp \* 0\.04\)/.test(pa));
check('5.3 Listening renders red breathing ring',
  /listening && !speaking && \([\s\S]{0,400}border: '2px solid #ef4444'/.test(pa));
check('5.4 Listening pulse className wired',
  /className=\{listeningPulse\}/.test(pa));
check('5.5 avatar-listening-pulse keyframe defined in globals.css',
  /@keyframes avatarListeningBreath\b[\s\S]{0,300}\.avatar-listening-pulse \{[\s\S]{0,80}animation: avatarListeningBreath/.test(css));
check('5.6 Loading renders thinking dots',
  /\{loading && \([\s\S]{0,400}bottom: -10/.test(pa));
check('5.7 Idle breath oscillation when not speaking/listening',
  /Math\.sin\(i \/ 8\) \* 0\.012/.test(pa));

group('6. AIGreeter wires PortraitAvatar for non-Nadia personas');
check('6.1 PortraitAvatar imported',
  /import PortraitAvatar from '\.\/PortraitAvatar'/.test(ag));
check('6.2 Conditional render: Nadia → NadiaFace, others → PortraitAvatar',
  /activeAgentKey === 'nadia' \? \(\s*<NadiaFace/.test(ag)
  && /\) : \(\s*(?:\/\/[^\n]*\n\s*)*<PortraitAvatar/.test(ag));
check('6.3 PortraitAvatar receives audioElement={currentAudio}',
  /<PortraitAvatar[\s\S]{0,300}audioElement=\{currentAudio\}/.test(ag));
check('6.4 PortraitAvatar receives uiColor from active persona',
  /<PortraitAvatar[\s\S]{0,300}color=\{uiColor\}/.test(ag));
check('6.5 PortraitAvatar receives speaking + listening + loading from same state',
  /<PortraitAvatar[\s\S]{0,500}speaking=\{speaking\}[\s\S]{0,200}listening=\{listening\}[\s\S]{0,200}loading=\{loading\}/.test(ag));

console.log('\n--- SUMMARY ---');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach(function (f, i) { console.log('  ' + (i + 1) + '. ' + f); });
  process.exit(1);
}
console.log('\nAll ' + passed + ' v55.79 portrait-avatar tests passed.');
