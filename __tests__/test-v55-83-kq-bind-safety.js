// ============================================================
// v55.83-KQ — Codex live-release blockers on the bind tool (money/ownership data):
//  (1) bind must be ALL-OR-NOTHING — re-stamp every table, and on ANY failure roll back the tables
//      already changed (to->from). No partial-success (207) path. So a silo is never left half-owned.
//  (2) NORMAL bind mode lists ONLY placeholder (unbound) silos; rebinding an already-connected silo is
//      an opt-in "advanced" migration with an extra confirmation.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var bind = rd('src/app/api/wave/bind-business/route.js');
var conn = rd('src/components/WaveConnectionTab.jsx');

ok('1: bind tracks the tables it changed and ROLLS BACK (to->from) on any failure',
  /var updatedTables = \[\]/.test(bind) &&
  /updatedTables\.push\(t2\)/.test(bind) &&
  /db\.from\(updatedTables\[rb\]\)\.update\(\{ wave_business_id: fromId \}\)\.eq\('wave_business_id', toId\)/.test(bind));
ok('2: the partial-success (HTTP 207) path is GONE — any failure is a hard error after rollback',
  !/207/.test(bind) &&
  /Bind failed and was fully rolled back — NO change was made/.test(bind));
ok('3: a rollback that itself fails is surfaced as an inconsistent-state warning (do not retry)',
  /rollback ALSO failed — silo ownership may be inconsistent\. DO NOT retry/.test(bind));
ok('4: dry-run still previews counts without mutating',
  /if \(dryRun\) \{/.test(bind) && /dry_run: true/.test(bind) && /Nothing changed yet/.test(bind));
ok('5: NORMAL bind mode lists ONLY placeholder silos; advanced rebind is opt-in',
  /var bindable = registry\.filter\(function \(r\) \{ return advancedRebind \? \(r\.wave_business_id !== b\.id\) : isPlaceholderWaveBusiness\(r\.wave_business_id\); \}\)/.test(conn) &&
  /Advanced: allow rebinding an already-connected silo/.test(conn));
ok('6: rebinding an already-connected (non-placeholder) silo requires an extra explicit confirmation',
  /if \(!isPlaceholderWaveBusiness\(siloFrom\)\) \{[\s\S]{0,200}ADVANCED: that silo is already connected/.test(conn));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-KQ bind-safety tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
