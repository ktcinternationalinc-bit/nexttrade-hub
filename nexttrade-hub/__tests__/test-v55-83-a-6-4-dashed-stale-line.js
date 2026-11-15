// v55.83-A.6.4 (Max May 13 2026) — Shipping chart: dashed grey line for expired-with-no-replacement
//
// Max: "the icon should still be a line but like a dashed grey line to
// indicate expired and no fresh rate"
//
// Architecture: TWO continuous lines for market-floor view:
//   _bestActive — solid dark line (fresh rates active in month)
//   _bestStale  — dashed grey line (expired carry-forward, no replacement)
//
// Bridge writes at transition months ensure the dashed and solid segments
// visually meet (no gap). Bootstrap fallback (CASE 3) ensures the line
// starts at the earliest effective_date — no blank first month.

var fs = require('fs');
var path = require('path');

var tab = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ShippingRatesTab.jsx'), 'utf8');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// 1. Two-line architecture
ok('1a: CASE 1 (active in month) writes point._bestActive',
  /CASE 1[\s\S]{0,300}point\._bestActive = Number\(bestRow\.rate_amount\)/.test(tab));
ok('1b: CASE 2 (carry-forward) writes point._bestStale',
  /CASE 2[\s\S]{0,1500}point\._bestStale = lastBest\.price/.test(tab));
ok('1c: lastBest tracks wasStale flag for bridge writes',
  /lastBest = \{[^}]*wasStale: false[^}]*\}/.test(tab));
ok('1d: stale→fresh transition writes _bestStale at fresh value (bridge)',
  /lastBest && lastBest\.wasStale[\s\S]{0,200}point\._bestStale = Number\(bestRow\.rate_amount\)/.test(tab));

// 2. CASE 3 bootstrap fallback
ok('2a: CASE 3 bootstrap fallback exists for first month',
  /CASE 3[\s\S]{0,800}fallbackBest = null;[\s\S]{0,400}ratesForView\[fbi\]/.test(tab));
ok('2b: bootstrap fallback seeds as ACTIVE (solid)',
  /if \(fallbackBest\)[\s\S]{0,300}point\._bestActive = Number\(fallbackBest\.rate_amount\)/.test(tab));
ok('2c: bootstrap fallback seeds lastBest so subsequent months can carry-forward',
  /if \(fallbackBest\)[\s\S]{0,800}lastBest = \{ price: Number\(fallbackBest\.rate_amount\)/.test(tab));

// 3. Chart JSX renders two lines
ok('3a: <Line dataKey="_bestActive"> renders as solid dark',
  /dataKey="_bestActive"[\s\S]{0,500}stroke="(#0f172a|#38bdf8)"[\s\S]{0,200}strokeWidth=\{3\}/.test(tab));
ok('3a-2: _bestActive line has connectNulls=true',
  /dataKey="_bestActive"[\s\S]{0,400}connectNulls=\{true\}/.test(tab));
ok('3b: <Line dataKey="_bestStale"> renders as dashed grey',
  /dataKey="_bestStale"[\s\S]{0,300}stroke="#94a3b8"[\s\S]{0,200}strokeDasharray="6 4"/.test(tab));
ok('3b-2: _bestStale line has connectNulls=true',
  /dataKey="_bestStale"[\s\S]{0,400}connectNulls=\{true\}/.test(tab));

// 4. Dot renderer no longer adds ⏳ icon (dashed line replaces it)
ok('4a: makeDotRenderer does NOT add ⏳ icon (dashed grey line handles this)',
  !/staleFlag[\s\S]{0,400}⏳/.test(tab),
  '⏳ icon overlay should be removed — dashed grey line handles the visual indication');

// 5. Subtitle explains the new visual
ok('5a: subtitle mentions "solid line" for active rate',
  /solid line/.test(tab));
ok('5b: subtitle mentions "dashed grey" for expired',
  /dashed grey/.test(tab));

// 6. Tooltip integration unchanged — still labels stale correctly
ok('6: tooltip handles isStale label',
  /isStale[\s\S]{0,200}last known.{0,50}no newer rate/.test(tab));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.4 dashed-grey stale-line tests passed');
