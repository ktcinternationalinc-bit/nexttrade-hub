// ============================================================
// v55.83-MF (Codex open blocker: "WaveSyncCenter inner flow is still too confusing for operators"). The
// densest admin clutter in the Settings tab — the push-permission checklists + production write toggles, and
// the database-setup diagnostic — are now collapsed by default (one click to reveal). The operator-facing
// essentials (who-feeds-each-account control + the setup-status summary) stay visible.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var sync = rd('src/components/WaveSyncCenter.jsx');

ok('1: push-permissions + production write toggles are collapsed under an Advanced disclosure',
  /<summary[^>]*>⚙ Advanced — push permissions[\s\S]{0,80}production write controls/.test(sync) &&
  /Push permissions for:/.test(sync) &&
  // the Advanced summary appears BEFORE the push-permissions header (it wraps it)
  sync.indexOf('⚙ Advanced — push permissions') < sync.indexOf('Push permissions for:'));
ok('2: the database-setup diagnostic is collapsed under its own disclosure',
  /<summary[^>]*>⚙ Database setup check \(super-admin diagnostic\)/.test(sync));
ok('3: the operator essentials stay VISIBLE (not collapsed): the who-feeds-each-account control + setup status',
  /Who feeds each bank account\?/.test(sync) &&
  /Wave setup status —/.test(sync) &&
  // these must appear BEFORE the first Advanced <details> so they render up top, uncollapsed
  sync.indexOf('Who feeds each bank account?') < sync.indexOf('⚙ Database setup check'));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-MF settings-declutter tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
