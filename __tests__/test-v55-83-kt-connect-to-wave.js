// ============================================================
// v55.83-KT — Max: "it needs to connect to Wave. PERIOD. just connect." Two things:
//  (1) Kill the placeholder-state CONTRADICTION: when a silo is on a placeholder id, the page no longer
//      shows "writes enabled / READ-WRITE / production push ENABLED" next to a fully-BLOCKED wall. It
//      shows ONE truth — NOT CONNECTED — and hides the moot toggles/setup.
//  (2) A ONE-CLICK "Connect this silo to Wave now": asks the token what businesses it can see, matches
//      this silo by name, and binds it via the hardened all-or-nothing route. If the token can't see a
//      match, it says exactly that (the one real blocker) — no runaround.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var banner = rd('src/components/SiloBanner.jsx');
var filter = rd('src/components/WaveBusinessFilter.jsx');
var sync = rd('src/components/WaveSyncCenter.jsx');
var acct = rd('src/components/AccountingTab.jsx');
var conn = rd('src/components/WaveConnectionTab.jsx');

ok('1: SiloBanner shows "NOT CONNECTED TO WAVE" (red) for a placeholder silo, not READ-WRITE',
  /var notConnected = props\.notConnected;/.test(banner) &&
  /if \(!registered \|\| notConnected\)/.test(banner) &&
  /NOT CONNECTED TO WAVE/.test(banner));
ok('2: the Wave business badge says "Not connected to Wave" for a placeholder silo (not "writes enabled")',
  /var notConnected = isPlaceholderWaveBusiness\(sel\.wave_business_id\)/.test(filter) &&
  /notConnected \? '⚠ Not connected to Wave'/.test(filter));
ok('3: WaveSyncCenter passes notConnected to the banner + the production banners moved into the non-placeholder branch',
  /notConnected=\{isPlaceholderWaveBusiness\(active\)\}/.test(sync) &&
  /isPlaceholderWaveBusiness\(active\) \? \(/.test(sync) &&
  /REAL PRODUCTION Wave push is ENABLED/.test(sync));
ok('4: the full Settings (toggles/readiness/setup) only render when NOT a placeholder; placeholder shows a "connect first" note',
  /tab === 'settings' && canManageSettings && isPlaceholderWaveBusiness\(active\)/.test(sync) &&
  /tab === 'settings' && canManageSettings && !isPlaceholderWaveBusiness\(active\)/.test(sync) &&
  /Connect this silo to Wave first/.test(sync));
ok('5: one-click connectToWave asks the token what it can access, matches by name, then binds via bind-business',
  /function connectToWave\(\)/.test(sync) &&
  /fetch\('\/api\/wave\/check'\)/.test(sync) &&
  /labelCore = normName\(\(reg && reg\.label\) \|\| active\)/.test(sync) &&
  /function doBind\(toId, toName\)/.test(sync) &&
  /\/api\/wave\/bind-business/.test(sync));
ok('6: if the token can\'t see any business, it says exactly that (the one real blocker), not a runaround',
  /see ANY Wave businesses[\s\S]{0,30}It needs access to the Wave account/.test(sync) &&
  /add\/replace WAVE_ACCESS_TOKEN in Vercel/.test(sync));
ok('7: an ambiguous match lets the user pick from what the token actually sees (one click each)',
  /setConnectChoices\(cands\.length > 1 \? cands : bizs\)/.test(sync) &&
  /connectChoices\.map\(function \(b, i\)/.test(sync));
ok('8: the primary "Connect this silo to Wave now" button + the "open Wave Connection" jump are wired (jump now lives in WaveHub → setStep(connect) after the MD tab consolidation)',
  /🔗 Connect this silo to Wave now/.test(sync) &&
  /onGoToWaveConnection=\{function \(\) \{ setStep\('connect'\); \}\}/.test(rd('src/components/WaveHub.jsx')));
// v55.83-KW (Codex) — a successful bind MUST switch the browser's active business off the placeholder.
ok('9 (KW): after a successful connect, WaveSyncCenter switches the active business to the new real GUID (not the placeholder)',
  /import \{ getActiveWaveBusiness, setActiveWaveBusiness, scopeIfRegistered, isPlaceholderWaveBusiness \}/.test(sync) &&
  /var newGuid = res\.to_wave_business_id \|\| toId;/.test(sync) &&
  /setActiveWaveBusiness\(newGuid\)/.test(sync));
ok('10 (KW): WaveConnectionTab also switches the active business to the real GUID after binding the active silo',
  /import \{ isPlaceholderWaveBusiness, setActiveWaveBusiness, getActiveWaveBusiness \}/.test(conn) &&
  /if \(getActiveWaveBusiness\(\) === siloFrom\) \{ setActiveWaveBusiness\(realId\); \}/.test(conn));
ok('11 (KW): one-click connect auto-binds ONLY a confident name match — never a single non-matching business',
  /var match = \(cands\.length === 1\) \? cands\[0\] : null;/.test(sync) &&
  !/bizs\.length === 1 \? bizs\[0\]/.test(sync));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-KT connect-to-Wave tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
