// v55.83-A.6.5 (Max May 13 2026) — Shipping chart fixes:
//   1. X-axis sorted chronologically (oldest left → newest right)
//   2. Expiry markers deduplicated by month (no 14 ✕'s for 14 rates)
//   3. Per-group bootstrap so By Line / By Vendor lines are continuous
//   4. Expiry data written into trendPoints (not separate scatter data)
//
// Max: "from left to right it should be the older date to the newer dates
// first of all. what are all of those x's representing. why is there not
// continuous line"

var fs = require('fs');
var path = require('path');
var tab = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ShippingRatesTab.jsx'), 'utf8');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// 1. Expiry merged into trendPoints (X-axis fix)
ok('1a: rawExpiryRows extracted from ratesForView',
  /var rawExpiryRows = ratesForView/.test(tab));
ok('1b: expiry data grouped by month into expiryByMonth bucket',
  /var expiryByMonth = \{\}[\s\S]{0,400}expiryByMonth\[m\][\s\S]{0,100}rates: \[\]/.test(tab));
ok('1c: trendPoint enriched with __expiredCount__',
  /pt\.__expiredCount__ = bucket\.count/.test(tab));
ok('1d: trendPoint enriched with __expiredAtY__ (Y-coord for marker)',
  /pt\.__expiredAtY__ = avgPrice/.test(tab));
ok('1e: trendPoints re-sorted by month after expiry-merge',
  /Re-sort after potential additions[\s\S]{0,400}trendPoints\.sort/.test(tab));

// 2. Expiry scatter no longer has its own data prop (uses parent data)
ok('2a: <Scatter name="Expirations"> reads from parent ComposedChart data',
  /<Scatter[\s\S]{0,400}name="Expirations"[\s\S]{0,300}dataKey="__expiredAtY__"[\s\S]{0,300}shape=\{ExpiryMarkerShape\}/.test(tab));
ok('2b: separate data={expiryMarkers} prop REMOVED from Scatter',
  !/<Scatter[\s\S]{0,200}name="Expirations"[\s\S]{0,200}data=\{expiryMarkers\}/.test(tab),
  'must not pass a separate data array — that breaks X-axis ordering');

// 3. ExpiryMarkerShape shows ×N count badge when dedup > 1
ok('3a: ExpiryMarkerShape reads __expiredCount__ from payload',
  /ExpiryMarkerShape[\s\S]{0,400}__expiredCount__/.test(tab));
ok('3b: ExpiryMarkerShape renders ×N text badge when count > 1',
  /ExpiryMarkerShape[\s\S]{0,800}count > 1[\s\S]{0,400}×\$\{count\}|count > 1[\s\S]{0,400}×\{count\}/.test(tab));

// 4. Per-group CASE 3 bootstrap for By Line / By Vendor views
ok('4a: per-group CASE 3 bootstrap fallback exists',
  /CASE 3 \(v55\.83-A\.6\.5\)[\s\S]{0,800}fallbackForGroup = null/.test(tab));
ok('4b: bootstrap scans ratesForView for rates matching the group',
  /fallbackForGroup[\s\S]{0,800}fbgrG !== G/.test(tab));
ok('4c: bootstrap seeds lastBestForLine[G] so subsequent months can carry forward',
  /fallbackForGroup\)[\s\S]{0,400}lastBestForLine\[G\] = \{ price: Number\(fallbackForGroup\.rate_amount\)/.test(tab));

// 5. Tooltip handles new __expiredAtY__ dataKey
ok('5a: tooltip handles __expiredAtY__ dataKey',
  /name === '(expired_rate|__expiredAtY__)' \|\| name === 'Expirations'/.test(tab));
ok('5b: tooltip shows count for deduplicated expiry markers',
  /__expiredCount__[\s\S]{0,400}rates expired/.test(tab));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.5 chart fixes tests passed');
