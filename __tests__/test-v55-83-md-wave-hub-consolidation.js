// ============================================================
// v55.83-MD — the three scattered Wave tabs (Wave Connection / Wave Import / Wave Sync Center) Max called
// "a big fucking mess" are now ONE guided "🌊 Wave" tab (WaveHub) with a Connect → Import → Review&Push step
// flow. WaveHub re-parents the existing tested components unchanged.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
function exists(p) { try { fs.accessSync(path.join(__dirname, '..', p)); return true; } catch (e) { return false; } }
var at = rd('src/components/AccountingTab.jsx');
var hub = exists('src/components/WaveHub.jsx') ? rd('src/components/WaveHub.jsx') : '';

ok('1: AccountingTab exposes ONE unified Wave tab (the three old tabs are gone)',
  /\['wavehub', '🌊 Wave'\]/.test(at) &&
  !/\['wave', '🌊 Wave Connection'\]/.test(at) &&
  !/\['waveimport', '⬇️ Wave Import'\]/.test(at) &&
  !/\['wavesync', '🔄 Wave Sync Center'\]/.test(at));
ok('2: AccountingTab renders WaveHub (and no longer the three components directly)',
  /import WaveHub from '\.\/WaveHub'/.test(at) &&
  /sub === 'wavehub' && <WaveHub/.test(at) &&
  !/sub === 'wavesync'/.test(at) && !/sub === 'waveimport'/.test(at));
ok('3: old deep-links to wave/waveimport/wavesync normalize to the unified hub',
  /if \(_initWaveStep\) \{ _initSub = 'wavehub'; \}/.test(at) &&
  /_initSub === 'wave'\) \{ _initWaveStep = 'connect'; \}/.test(at));
ok('4: WaveHub re-parents the three existing components under a step nav',
  /import WaveConnectionTab from '\.\/WaveConnectionTab'/.test(hub) &&
  /import WaveImportTab from '\.\/WaveImportTab'/.test(hub) &&
  /import WaveSyncCenter from '\.\/WaveSyncCenter'/.test(hub) &&
  /step === 'connect'/.test(hub) && /step === 'mirror'/.test(hub) && /step === 'sync'/.test(hub));
ok('5: the Review & Push step is gated on canWaveSync, and the "open Wave Connection" jump is wired internally',
  /if \(canWaveSync\) \{ steps\.push\(\['sync'/.test(hub) &&
  /onGoToWaveConnection=\{function \(\) \{ setStep\('connect'\); \}\}/.test(hub) &&
  /step === 'sync' && canWaveSync/.test(hub));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-MD wave-hub-consolidation tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
