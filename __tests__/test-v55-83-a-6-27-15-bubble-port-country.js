// v55.83-A.6.27.15 — Bubble shows + groups by (country/POL → country/POD)
//
// Per Max May 16 2026: "bubbles need to have country/pol. and country of
// destination/pod MUST HAVE and broken down by this and displayed -- if
// anything is different in those 4 combinations then you need a separate
// bubble."
//
// Each unique (origin country, POL, destination country, POD) tuple is its
// own bubble. Same country pair but different ports → separate bubbles.

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var srt = read('src/components/ShippingRatesTab.jsx');
var page = read('src/app/page.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

ok('1: route group key uses all 4 parts (origin, POL, destination, POD)',
  /var key = normForKey\(originRaw\) \+ '\|' \+ normForKey\(polRaw\)\s*\+ '\|\|' \+ normForKey\(destRaw\) \+ '\|' \+ normForKey\(podRaw\)/.test(srt));

ok('2: pol and pod are preserved on the group object (not conditional on groupByPort)',
  /pol: polRaw \|\| null,\s*pod: podRaw \|\| null/.test(srt));

ok('3: useMemo dependency array dropped groupByPort (bubble grouping is now mode-independent)',
  /\}, \[filtered, continentFilter\]\);/.test(srt));

ok('4: continent dropdown count uses the same 4-part key as bubbles',
  /match the bubble's 4-part grouping[\s\S]{0,200}\(r\.port_of_loading \|\| ''\)\.toLowerCase\(\)\.trim\(\)/.test(srt));

ok('5: TT/FT/ETD always shows on per-port bubbles (no longer gated by groupByPort)',
  /show always \(every bubble is now per-port/.test(srt));

ok('6: render code uses fromLabel/fromSub format (port main + country sub)',
  /var fromLabel, fromSub, toLabel, toSub/.test(srt));

ok('7: render shows country sub when port differs from country',
  /if \(rg\.pol && rg\.pol !== rg\.origin\) \{[\s\S]{0,200}fromSub = rg\.origin/.test(srt));

ok('8: clicking bubble passes the specific POL/POD to setSelectedRoute',
  /setSelectedRoute\(\{origin:rg\.origin,destination:rg\.destination,pol:rg\.pol\|\|null,pod:rg\.pod\|\|null\}\)/.test(srt));

ok('9: version stamp v55.83-A.6.27.15',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.15 tests passed');

