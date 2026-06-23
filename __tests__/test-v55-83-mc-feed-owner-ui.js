// ============================================================
// v55.83-MC — the per-account feed-owner control surface (the piece that unblocks Hub-as-source). The
// Settings tab must let the operator set each Wave bank account to "Hub feeds it" or "Wave feeds it",
// surface the not-set/blocked state, the one-time migration warning, and the REAL Wave step (Banking →
// Connected Accounts → turn off auto-import) — in plain language, dark theme.
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

ok('1: the feed-owner control loads + sets via /api/wave/account-feed-owner',
  /function loadFeedOwners\(\)/.test(sync) &&
  /function setFeedOwner\(acctId, owner\)/.test(sync) &&
  /\/api\/wave\/account-feed-owner/.test(sync));
ok('2: each Wave bank account gets a Hub / Wave-feed choice + a not-set "push blocked" state',
  /Hub feeds it/.test(sync) && /Wave feeds it/.test(sync) &&
  /not set — push blocked/.test(sync) &&
  /setFeedOwner\(a\.wave_account_id, 'HUB'\)/.test(sync) &&
  /setFeedOwner\(a\.wave_account_id, 'WAVE_FEED'\)/.test(sync));
ok('3: the REAL one-time Wave step is shown (Banking → Connected Accounts → turn off auto-import), with the do-NOT-delete warning',
  /Banking → Connected Accounts/.test(sync) &&
  /Automatically import transactions into account/.test(sync) &&
  /do NOT click the trashcan/.test(sync));
ok('4: the one-time migration warning shows when the column is not applied',
  /feedOwnerMig/.test(sync) && /v55-83-MC-wave-feed-owner\.sql/.test(sync));
ok('5: the section is dark-themed (not a bright-white card) — readability',
  /bg-slate-900 border border-slate-700 text-slate-100[\s\S]{0,120}Who feeds each bank account/.test(sync));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-MC feed-owner-ui tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
