// ============================================================
// v55.83-MC/MI - feed-owner control.
// Settings must let the operator set each Wave bank account to "Hub feeds it"
// or "Wave feeds it", and MI groups duplicate Wave Cash/Bank rows so the page
// is not a repeated wall of identical bank names.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('OK ' + label);
  else { failures.push(label + (hint ? ' - ' + hint : '')); console.log('FAIL ' + label + (hint ? ' - ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var sync = rd('src/components/WaveSyncCenter.jsx');
var route = rd('src/app/api/wave/account-feed-owner/route.js');

ok('1: the feed-owner control loads + sets via /api/wave/account-feed-owner',
  /function loadFeedOwners\(\)/.test(sync) &&
  /function setFeedOwner\(acctId, owner, acctIds\)/.test(sync) &&
  /\/api\/wave\/account-feed-owner/.test(sync));
ok('2: each Wave bank account gets a Hub / Wave-feed choice + a blocked state',
  /Hub feeds it/.test(sync) && /Wave feeds it/.test(sync) &&
  /not set - push blocked/.test(sync) &&
  /setFeedOwner\(a\.wave_account_id, 'HUB', acctIds\)/.test(sync) &&
  /setFeedOwner\(a\.wave_account_id, 'WAVE_FEED', acctIds\)/.test(sync));
ok('3: MI groups duplicate account names and sends wave_account_ids for one-click updates',
  /duplicate_count/.test(route) &&
  /wave_account_ids/.test(route) &&
  /\.in\('wave_account_id', acctIds\)/.test(route) &&
  /grouped \{a\.duplicate_count\} duplicate Wave accounts/.test(sync));
ok('4: the REAL one-time Wave step is still shown with the do-not-delete warning',
  /Banking/.test(sync) &&
  /Connected Accounts/.test(sync) &&
  /Automatically import transactions into account/.test(sync) &&
  /do NOT click the trashcan/.test(sync));
ok('5: the one-time migration warning shows when the column is not applied',
  /feedOwnerMig/.test(sync) && /v55-83-MC-wave-feed-owner\.sql/.test(sync));

console.log('');
if (failures.length === 0) { console.log('All v55.83-MI feed-owner-ui tests passed'); process.exit(0); }
else { console.log(failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
