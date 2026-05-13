// v55.83-A.6.2 (Max May 13 2026) — Shipping rate history chart gap-fix.
//
// Fixes from gap review (docs/shipping-chart-gap-review-v55-83-a-6-2.md):
//   1. routeHistory uses case+whitespace-insensitive match on
//      origin/destination/pol/pod
//   2. POL/POD null-tolerant (rate missing POL doesn't get filtered out
//      just because route card aggregated a POL)
//   3. Expiry markers (✕) shown on chart at each rate's expiry_date
//   4. Inline data-quality warning panel surfaces gaps between
//      "rates in route" and "rates plotted" with specific reasons
//   5. Tooltip handles expired_rate marker

var fs = require('fs');
var path = require('path');

var tab = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ShippingRatesTab.jsx'), 'utf8');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// 1. routeHistory case-insensitive match
ok('1a: routeHistory normalizes origin via trim().toLowerCase()',
  /var norm = function\(s\) \{ return \(s \|\| ''\)\.trim\(\)\.toLowerCase\(\); \}/.test(tab));
ok('1b: routeHistory compares normalized origin',
  /if \(routeOrigin && norm\(r\.origin\) !== routeOrigin\) return false/.test(tab));
ok('1c: routeHistory compares normalized destination',
  /if \(routeDest && norm\(r\.destination\) !== routeDest\) return false/.test(tab));
ok('1d: routeHistory normalizes POL with null-tolerance',
  /if \(routePol && r\.port_of_loading && norm\(r\.port_of_loading\) !== routePol\) return false/.test(tab));
ok('1e: routeHistory normalizes POD with null-tolerance',
  /if \(routePod && r\.port_of_discharge && norm\(r\.port_of_discharge\) !== routePod\) return false/.test(tab));
ok('1f: strict-equality version of routeHistory removed',
  !/if \(selectedRoute\.origin && r\.origin !== selectedRoute\.origin\) return false/.test(tab),
  'old strict-equality pattern must not still exist');

// 2. Expiry markers
ok('2a: expiryMarkers data array built from ratesForView',
  /var expiryMarkers = ratesForView[\s\S]{0,300}r\.expiry_date \|\| ''[\s\S]{0,200}return exp\.length >= 7/.test(tab));
ok('2b: expiryMarkers carry month + expired_rate + vendor',
  /month: \(r\.expiry_date \|\| ''\)\.substring\(0, 7\)[\s\S]{0,200}expired_rate: Number\(r\.rate_amount[\s\S]{0,100}vendor: r\.vendor_name/.test(tab));
ok('2c: ExpiryMarkerShape function defined',
  /var ExpiryMarkerShape = function\(props\)/.test(tab));
ok('2d: ExpiryMarkerShape draws a red ✕ (two crossing lines)',
  /ExpiryMarkerShape[\s\S]{0,800}stroke="#dc2626"[\s\S]{0,200}stroke="#dc2626"/.test(tab));
ok('2e: <Scatter name="Expirations" /> renders on chart',
  /<Scatter[\s\S]{0,200}name="Expirations"[\s\S]{0,200}data=\{expiryMarkers\}[\s\S]{0,200}shape=\{ExpiryMarkerShape\}/.test(tab));
ok('2f: Tooltip handles expired_rate label',
  /name === 'expired_rate' \|\| name === 'Expirations'/.test(tab));
ok('2g: Chart subtitle mentions ✕ expiry marker',
  /✕ = rate expired/.test(tab));

// 3. Data-quality warning panel
ok('3a: dataQuality counters object built',
  /var dataQuality = \{[\s\S]{0,80}totalInRoute: routeHistory\.length/.test(tab));
ok('3b: counts rates with missing effective_date',
  /missingEffective: routeHistory\.filter[\s\S]{0,200}eff\.length < 10/.test(tab));
ok('3c: counts rates with zero/missing amount',
  /missingAmount: routeHistory\.filter[\s\S]{0,200}rate_amount \|\| 0\) > 0/.test(tab));
ok('3d: counts rates with missing currency',
  /missingCurrency: routeHistory\.filter[\s\S]{0,200}!r\.currency \|\| r\.currency\.trim/.test(tab));
ok('3e: counts rates with expiry before effective (impossible window)',
  /expiryBeforeEffective: routeHistory\.filter[\s\S]{0,300}r\.expiry_date < r\.effective_date/.test(tab));
ok('3f: Warning panel renders when totalInRoute > validForChart',
  /dataQuality\.totalInRoute > dataQuality\.validForChart\)[\s\S]{0,200}Chart shows[\s\S]{0,400}of [\s\S]{0,100}rates on this route/.test(tab));
ok('3g: Warning panel explains each exclusion category',
  /no.*effective_date[\s\S]{0,1500}rate amount of 0[\s\S]{0,1500}expiry before effective[\s\S]{0,1500}no.*currency/.test(tab));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.2 shipping chart gap-fix tests passed');
