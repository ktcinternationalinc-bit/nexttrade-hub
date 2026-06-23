// ============================================================
// v55.83-ME (Codex MD cautions) — (1) a deep-link to the old Wave Import / Sync sub-tab must land on the
// RIGHT step of the unified WaveHub, not strand the user on Connect. (2) Pulling Wave categories must NOT
// erase an operator's per-account feed-owner choice (the anti-duplicate setting).
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var at = rd('src/components/AccountingTab.jsx');
var hub = rd('src/components/WaveHub.jsx');
var syncCat = rd('src/app/api/wave/sync-categories/route.js');

ok('1: legacy Wave deep-links map to the intended WaveHub step (wave→connect, waveimport→mirror, wavesync→sync)',
  /_initSub === 'wave'\) \{ _initWaveStep = 'connect'; \}/.test(at) &&
  /_initSub === 'waveimport'\) \{ _initWaveStep = 'mirror'; \}/.test(at) &&
  /_initSub === 'wavesync'\) \{ _initWaveStep = 'sync'; \}/.test(at));
ok('2: AccountingTab passes initialWaveStep to WaveHub, and WaveHub honors it',
  /initialWaveStep=\{_initWaveStep\}/.test(at) &&
  /useState\(props\.initialWaveStep \|\| 'connect'\)/.test(hub));
ok('3: sync-categories UPDATES a fixed rowPayload (not an upsert/replace), so it can only touch the columns it lists',
  /await db\.from\('wave_categories'\)\.update\(rowPayload\)\.eq\('id', exRow\.id\)/.test(syncCat));
ok('4: that rowPayload does NOT include wave_feed_owner — so a category pull preserves the operator\'s owner choice',
  /var rowPayload = \{[\s\S]*?last_synced_hash: fp\s*\};/.test(syncCat) &&
  !/wave_feed_owner/.test(syncCat.match(/var rowPayload = \{[\s\S]*?last_synced_hash: fp\s*\};/)[0]));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-ME deeplink + owner-persistence tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
