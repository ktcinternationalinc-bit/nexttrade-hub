// ============================================================
// v55.83-MI — Max's live failure: the "Who feeds each bank account?" list was FLOODED with duplicate-named
// Wave Cash/Bank accounts (e.g. "Business Checking Plus (704)" x4), and clicking Hub/Wave only set ONE of
// them, so the firewall still blocked the others. Fix: the route GROUPS exact-name duplicates and the set
// applies the owner to EVERY underlying wave_account_id in the group (wave_account_ids[]); the UI sends that
// array. Behavior-relevant static guards on both the route and the caller.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var route = rd('src/app/api/wave/account-feed-owner/route.js');
var sync = rd('src/components/WaveSyncCenter.jsx');

ok('1: list groups exact-name duplicate Cash/Bank accounts (one row, all underlying ids, duplicate_count, MIXED owner)',
  /var groups = \{\};/.test(route) &&
  /groups\[key\]\.wave_account_ids\.push\(c\.wave_account_id\)/.test(route) &&
  /duplicate_count = groups\[key\]\.wave_account_ids\.length/.test(route) &&
  /if \(groups\[key\]\.wave_feed_owner !== owner\) \{ groups\[key\]\.wave_feed_owner = 'MIXED'; \}/.test(route));
ok('2: set applies the owner to ALL ids in the group via .in(wave_account_id, acctIds), validating each is a real bank/cash account',
  /var acctIds = Array\.isArray\(body\.wave_account_ids\) && body\.wave_account_ids\.length \? body\.wave_account_ids : \(acctId \? \[acctId\] : \[\]\)/.test(route) &&
  /update\(\{ wave_feed_owner: owner \}\)\.eq\('wave_business_id', bid\)\.in\('wave_account_id', acctIds\)/.test(route) &&
  /if \(!valid\[acctIds\[i\]\]\) \{ return NextResponse\.json\(\{ error: 'That account is not a Wave Cash\/Bank account/.test(route));
ok('3: the UI sends the WHOLE group (wave_account_ids), so one click sets every duplicate — not just the first',
  /function setFeedOwner\(acctId, owner, acctIds\)/.test(sync) &&
  /wave_account_ids: acctIds \|\| null/.test(sync) &&
  /var acctIds = a\.wave_account_ids && a\.wave_account_ids\.length \? a\.wave_account_ids : \[a\.wave_account_id\]/.test(sync) &&
  /setFeedOwner\(a\.wave_account_id, 'HUB', acctIds\)/.test(sync));
ok('4: the grouped row tells the user it covers N duplicates + shows mixed/not-set states',
  /grouped \{a\.duplicate_count\} duplicate Wave accounts/.test(sync) &&
  /mixed owner - choose one/.test(sync));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-MI feed-owner-grouping tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
