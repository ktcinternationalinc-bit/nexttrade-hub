/* v72 HOTFIX 24 — Standalone playback queue test harness.
 *
 * Self-contained HTML page that validates guardrail #1 (audio flush)
 * without involving providers or the server. Embedded 6s MP3 sliced
 * into 12 chunks; mouth analyser runs the real bucketing algorithm.
 *
 * This test ensures the harness contains the critical pieces and
 * matches the real production code paths it's meant to validate.
 */
var path = require('path');
var fs = require('fs');

function ok(name, cond) {
  if (!cond) { console.log('  ✗ ' + name); process.exitCode = 1; }
  else { console.log('  ✓ ' + name); }
}

var HARNESS = path.join(__dirname, '..', 'src/features/living-avatar/test-harness/playback-queue-harness.html');
var h = fs.readFileSync(HARNESS, 'utf8');
var hSize = fs.statSync(HARNESS).size;
var README = fs.readFileSync(
  path.join(__dirname, '..', 'src/features/living-avatar/test-harness/README.md'),
  'utf8'
);

console.log('\n── File is self-contained + sized correctly ──');

ok('A1: Harness file exists',
  fs.existsSync(HARNESS));

ok('A2: File is under 250KB (no bloat)',
  hSize < 250_000);

ok('A3: No external CSS / CDN references (truly standalone)',
  !/<link\s+[^>]*href=/i.test(h) && !/cdn\./.test(h));

ok('A4: No external JS source references',
  !/<script[^>]*src=/i.test(h));

ok('A5: Has <!doctype html> + lang attribute',
  /<!doctype html>/i.test(h) && /<html lang=/.test(h));

console.log('\n── Embedded MP3 test data ──');

ok('B1: TEST_MP3_B64 placeholder was replaced with real data',
  !/__TEST_MP3_B64_PLACEHOLDER__/.test(h));

ok('B2: TEST_MP3_B64 string is substantial (> 50KB base64)',
  /var TEST_MP3_B64 = "[A-Za-z0-9+/=]{50000,}";/.test(h));

ok('B3: Slicing function present (sliceTestMp3)',
  /function sliceTestMp3\(\)/.test(h));

ok('B4: Slices into 12 chunks (mimics ElevenLabs ~500ms cadence)',
  /var chunkCount = 12/.test(h));

console.log('\n── Playback queue port ──');

ok('C1: createPlaybackQueue function defined',
  /function createPlaybackQueue\(audioEl/.test(h));

ok('C2: appendChunk() decodes base64 → ArrayBuffer',
  /function base64ToBuffer/.test(h) && /sb\.appendBuffer\(buf\)/.test(h));

ok('C3: flush() exists and is exposed',
  /flush: function \(\) \{/.test(h));

ok('C4: flush sets aborted flag FIRST (before clearing queue)',
  /state\.aborted = true;[\s\S]{0,300}state\.pendingChunks = \[\]/.test(h));

ok('C5: flush aborts in-flight appendBuffer (sb.abort)',
  /if \(sb\.updating\) \{[\s\S]{0,100}sb\.abort\(\)/.test(h));

ok('C6: flush wipes SourceBuffer bytes (sb.remove(0, duration))',
  /sb\.remove\(0, audioEl\.duration\)/.test(h));

ok('C7: flush pauses audio AND jumps currentTime past end',
  /audioEl\.pause\(\)/.test(h) && /audioEl\.currentTime = audioEl\.duration/.test(h));

ok('C8: flush returns measured ms (for benchmarking)',
  /var dt = performance\.now\(\) - t0;[\s\S]{0,200}return dt/.test(h));

ok('C9: appendChunk drops new chunks while aborted (zombie defense)',
  /if \(state\.disposed \|\| state\.aborted\)[\s\S]{0,200}chunk\.dropped_due_to_aborted/.test(h));

ok('C10: reset() rebuilds the MediaSource via buildPipeline',
  /reset: function \(\) \{[\s\S]{0,200}buildPipeline\(\)/.test(h));

ok('C11: QuotaExceededError eviction handler present',
  /QuotaExceededError/.test(h) && /sb\.remove\(0, keepFrom\)/.test(h));

console.log('\n── Mouth analyser (port of useMouthSync) ──');

ok('D1: createMouthAnalyser function defined',
  /function createMouthAnalyser\(audioEl/.test(h));

ok('D2: Uses Web Audio API analyser with fftSize 256',
  /createAnalyser\(\)/.test(h) && /analyser\.fftSize = 256/.test(h));

ok('D3: Speech band bin range matches the React hook (bins 2-16)',
  /for \(var i = 2; i < 16; i\+\+\)/.test(h));

ok('D4: Bucketize thresholds match (0.05 / 0.18 / 0.38)',
  /level < 0\.05.*closed[\s\S]{0,300}level < 0\.18.*small[\s\S]{0,300}level < 0\.38.*medium/.test(h));

ok('D5: stop() forces final "closed" shape (so mouth visually closes on stop)',
  /stop: function \(\)[\s\S]{0,500}onShape\('closed', 0\)/.test(h));

console.log('\n── Visual UI elements ──');

ok('E1: Has a #mouth element that responds to shape class',
  /<div id="mouth"/.test(h) &&
  /\.mouth\.closed/.test(h) && /\.mouth\.wide/.test(h));

ok('E2: Has Start / INTERRUPT / Restart buttons',
  /id="btn-start"/.test(h) && /id="btn-interrupt"/.test(h) && /id="btn-restart"/.test(h));

ok('E3: Has live state chips (unlocked / ready / playing / aborted)',
  /id="chip-unlocked"/.test(h) && /id="chip-ready"/.test(h) &&
  /id="chip-playing"/.test(h) && /id="chip-aborted"/.test(h));

ok('E4: Has event log panel',
  /id="log"/.test(h) && /\.log \.entry/.test(h));

ok('E5: Has timing cells for flush→closed and flush→silent measurements',
  /id="t-flush"/.test(h) && /id="t-audiosilent"/.test(h));

console.log('\n── Interrupt timing measurement ──');

ok('F1: doInterrupt() captures performance.now() before flush',
  /function doInterrupt\(\)[\s\S]{0,500}lastFlushTs = performance\.now\(\)/.test(h));

ok('F2: Measures flush → mouth closed via shape watcher callback',
  /pendingShapeWatcher = function \(shape, level\)[\s\S]{0,400}shape === 'closed'/.test(h));

ok('F3: 800ms threshold enforces Max spec (warn class above 800)',
  /if \(ms > 800\) el\.classList\.add\('bad'\)/.test(h));

console.log('\n── Automated test runner ──');

ok('G1: Run-tests button present',
  /id="btn-runtests"/.test(h));

ok('G2: At least 14 numbered test assertions (T1..T14)',
  (function () {
    var matches = h.match(/done\('T\d+:/g) || [];
    return matches.length >= 14;
  })());

ok('G3: T5 specifically tests the <800ms mouth-close guarantee',
  /T5:[^']*Mouth closes <800ms after INTERRUPT/.test(h));

ok('G4: T10 specifically tests no-zombie-audio (chunks dropped while aborted)',
  /T10:[^']*New chunks dropped while aborted/.test(h));

ok('G5: Test runner outputs pass/fail counts',
  /passed[\s\S]{0,200}failed/.test(h));

console.log('\n── Cross-browser & robustness ──');

ok('H1: AudioContext fallback for webkitAudioContext (Safari)',
  /window\.AudioContext \|\| window\.webkitAudioContext/.test(h));

ok('H2: Feature-detects MediaSource availability',
  /typeof MediaSource === 'undefined'/.test(h));

ok('H3: Feature-detects audio/mpeg support',
  /MediaSource\.isTypeSupported\('audio\/mpeg'\)/.test(h));

ok('H4: Color-scheme dark for system theme integration',
  /color-scheme: dark/.test(h));

ok('H5: Mobile viewport meta tag',
  /<meta name="viewport"/.test(h));

console.log('\n── README documents how to use it ──');

ok('I1: README explains how to open the file',
  /Open `playback-queue-harness\.html`/.test(README));

ok('I2: README lists the critical T5 + T10 assertions',
  /T5/.test(README) && /T10/.test(README));

ok('I3: README sets expectation: cross-browser (Chrome + Safari)',
  /Chrome and Safari/.test(README));

ok('I4: README states what is NOT proven by this harness',
  /What this does NOT prove/i.test(README));

console.log('\n══════════════════════════════════════════════');
if (process.exitCode) console.log('FAILED');
else console.log('✅ HOTFIX 24 — Playback queue test harness built (real MP3, real algorithms, automated assertions)');
console.log('══════════════════════════════════════════════');
