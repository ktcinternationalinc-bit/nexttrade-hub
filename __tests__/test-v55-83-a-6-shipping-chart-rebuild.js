// v55.83-A.6 (Max May 13 2026) — Shipping rate history chart rebuild.
//
// Tests:
//   1. Three chart views (floor / vendor / line) are present with toggle buttons
//   2. Currency tabs render when multiple currencies exist
//   3. Stale points use a ⏳ icon overlay (not a dashed line)
//   4. Date filter uses "active during window" semantics (not "expiry/effective IN window")
//   5. Time-window caption shows first-month → last-month
//   6. Market floor is the default chart view
//   7. The old _bestStale dashed line is gone
//   8. groupsToPlot is capped at 10 to avoid spaghetti charts

var fs = require('fs');
var path = require('path');

var tab = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ShippingRatesTab.jsx'), 'utf8');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// 1. Chart view toggle
ok('1a: chartView state declared with default \'floor\'',
  /\[chartView, setChartView\] = useState\('floor'\)/.test(tab));
ok('1b: Floor view button present',
  /🏆 Market Floor/.test(tab));
ok('1c: Vendor view button present',
  /🏢 By Vendor/.test(tab));
ok('1d: Shipping-line view button present',
  /🚢 By Line/.test(tab));
ok('1e: View buttons wired to setChartView',
  /setChartView\('floor'\)/.test(tab) &&
  /setChartView\('vendor'\)/.test(tab) &&
  /setChartView\('line'\)/.test(tab));

// 2. Currency override
ok('2a: chartCurrencyOverride state declared',
  /\[chartCurrencyOverride, setChartCurrencyOverride\] = useState\(''\)/.test(tab));
ok('2b: chartCurrency resolves override → auto-pick',
  /chartCurrency = \(chartCurrencyOverride && trendCurrencies\.indexOf\(chartCurrencyOverride\) >= 0\)\s*\?\s*chartCurrencyOverride\s*:\s*autoCurrency/.test(tab));
ok('2c: Currency tabs render when >1 currency present',
  /trendCurrencies\.length > 1[\s\S]{0,2000}setChartCurrencyOverride\(c\)/.test(tab));

// 3. Stale rendering — ⏳ icon overlay, no dashed line
ok('3a: makeDotRenderer adds ⏳ glyph for stale points',
  /staleFlag[\s\S]{0,400}⏳/.test(tab));
ok('3b: No more _bestStale dashed line (replaced by per-point icon)',
  !/dataKey="_bestStale"/.test(tab),
  'old dashed-overlay line should be removed');
ok('3c: _best line is solid (no strokeDasharray on the market-floor line)',
  /<Line type="monotone" dataKey="_best"[^>]*strokeWidth=\{3\}[^>]*\/>/.test(tab) ||
  /<Line type="monotone" dataKey="_best" name="Market best" stroke="#0f172a" strokeWidth=\{3\} connectNulls=\{true\}/.test(tab));

// 4. Date filter semantics
ok('4a: Date filter uses "rate active during window" semantics',
  /Rate has to have started by the end of the window/.test(tab) &&
  /Rate has to still be active by the start of the window/.test(tab));
ok('4b: Old broken "expiry || effective inside window" filter is gone',
  !/trendRates\.filter\(r => \(r\.expiry_date \|\| r\.effective_date \|\| ''\) >= rateHistoryDf\)/.test(tab),
  'pre-v55.83-A.6 filter must be removed');

// 5. Time-window caption
ok('5a: Caption shows first → last month range',
  /months\[0\][\s\S]{0,80}months\[months\.length - 1\]/.test(tab));
ok('5b: Caption describes view mode',
  /Showing.*market floor/.test(tab) &&
  /Showing[\s\S]{0,200}vendor/.test(tab) &&
  /Showing[\s\S]{0,200}shipping line/.test(tab));

// 6. Floor is default
ok('6: chartView defaults to floor',
  /useState\('floor'\)/.test(tab));

// 7. Per-group rendering uses groupsToPlot, capped at 10
ok('7a: groupsToPlot resolved from breakdownField',
  /breakdownField = null[\s\S]{0,200}chartView === 'vendor'[\s\S]{0,80}breakdownField = 'vendor_name'/.test(tab));
ok('7b: groupsToPlot capped at 10 to avoid spaghetti',
  /groupsToPlot\.length > 10[\s\S]{0,400}\.slice\(0, 10\)/.test(tab));
ok('7c: Chart renders one Line per group when not in floor view',
  /chartView === 'floor' \?[\s\S]{0,800}groupsToPlot\.map\(function\(G, i\)/.test(tab));

// 8. Scope filter (chartShippingLine) still works
ok('8: chartShippingLine narrows ratesForView (scope filter, independent of view)',
  /chartShippingLine !== 'all'[\s\S]{0,400}ratesForView = ratesForView\.filter[\s\S]{0,200}shipping_line/.test(tab));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6 shipping chart rebuild tests passed');
