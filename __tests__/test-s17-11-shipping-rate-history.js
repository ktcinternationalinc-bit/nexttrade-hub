// ============================================================
// S17.11 (Apr 23 2026) — Shipping Rates UX revamp
// Fixes:
//   - "Can't uncheck Active Only" — separated hide-expired from time period
//   - Adds 1M and 6M time filters
//   - Proper line chart with per-shipping-line breakdown
//   - Confirms historical rates (expired) ARE included when hide-expired is off
// ============================================================

var fs = require('fs');
var path = require('path');
var assert = require('assert');
var REPO = path.resolve(__dirname, '..');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('✓ ' + name); passed++; }
  catch (e) { console.log('✗ ' + name + ' — ' + e.message); failed++; }
}

var tab = fs.readFileSync(path.join(REPO, 'src/components/ShippingRatesTab.jsx'), 'utf8');

test('S17.11.1 recharts LineChart imported', function() {
  assert(/import \{[^}]*LineChart[^}]*Line[^}]*\} from 'recharts'/.test(tab),
    'must import LineChart and Line from recharts');
});

test('S17.11.2 hideExpired state added (replaces Active Only mode)', function() {
  assert(/const \[hideExpired, setHideExpired\] = useState\(false\)/.test(tab),
    'hideExpired state must default to false (show ALL rates incl. expired)');
});

test('S17.11.3 chartShippingLine state added', function() {
  assert(/const \[chartShippingLine, setChartShippingLine\] = useState\('all'\)/.test(tab),
    'chartShippingLine state must exist with default all');
});

test('S17.11.4 "Hide expired" is a checkbox, not a button', function() {
  assert(/<input type="checkbox" checked=\{hideExpired\}/.test(tab),
    'hideExpired must render as a checkbox so user can toggle freely');
});

test('S17.11.5 Time period filter has 1M option', function() {
  assert(/'1m','1 Month',30/.test(tab),
    'must include 1 Month button (30 days)');
});

test('S17.11.6 Time period filter has 6M option', function() {
  assert(/'6m','6 Months',180/.test(tab),
    'must include 6 Months button (180 days)');
});

test('S17.11.7 Time period filter no longer contains "Active Only"', function() {
  // Check the full file doesn't have the old ['active','✅ Active Only'] array entry
  assert(!/'active',\s*'✅ Active Only'/.test(tab),
    'Active Only button must NOT exist anywhere in the new UI');
});

test('S17.11.8 Filter logic applies hideExpired AFTER date filters', function() {
  assert(/if \(rateHistoryDf\) filtered = filtered\.filter\(r => \(r\.effective_date \|\| ''\) >= rateHistoryDf\);[\s\S]{0,120}if \(rateHistoryDt\)[\s\S]{0,120}if \(hideExpired\) filtered = filtered\.filter\(r => !isExpired\(r\.expiry_date\)\);/.test(tab),
    'filter chain must use hideExpired (not rateHistoryMode===active)');
});

test('S17.11.9 Old rateHistoryMode==="active" logic is gone', function() {
  assert(!/rateHistoryMode === 'active'/.test(tab),
    'all references to old "active" mode must be removed');
  assert(!/rateHistoryMode !== 'active'/.test(tab),
    'all references to old "active" mode must be removed');
});

test('S17.11.10 Rate trend chart renders with trendPoints data', function() {
  // v55.83-A.5 — chart type changed from <LineChart> to <ComposedChart> with
  // multiple <Line> children; trendPoints is still the data source. Accept either form.
  assert(/<(Line|Composed)Chart\s+data=\{trendPoints\}/.test(tab) ||
    /var trendPoints = months\.map/.test(tab),
    'trendPoints must be defined and fed to the trend chart');
});

test('S17.11.11 Chart supports per-group view rendering one Line per group', function() {
  // v55.83-A.6 — chart restructured to use chartView ('floor' / 'vendor' /
  // 'line'). When chartView is 'vendor' or 'line', the chart maps groupsToPlot
  // → one <Line> per group. Replaces the old chartShippingLine === 'all' branch.
  assert(/chartShippingLine === 'all'\s*\?\s*linesToPlot\.map/.test(tab) ||
    /groupsToPlot\.map\(function\(G, i\)/.test(tab),
    'when grouped by vendor or shipping line, should render one Line per group');
});

test('S17.11.12 Chart supports scope filtering by specific shipping line', function() {
  // v55.83-A.6 — chartShippingLine is now a SCOPE filter (not a render mode).
  // When non-'all', ratesForView is narrowed to that shipping line, and the
  // chart still renders according to chartView. Verify the scope filter exists.
  assert(/\(<Line type="monotone" dataKey=\{chartShippingLine\}/.test(tab) ||
    /chartShippingLine !== 'all'/.test(tab) ||
    /ratesForView = ratesForView\.filter[\s\S]{0,200}shipping_line[\s\S]{0,80}chartShippingLine/.test(tab),
    'specific-line selection must narrow the chart data');
});

test('S17.11.13 Stale rendering is per-point (icon overlay, not dashed line)', function() {
  // v55.83-A.6 — Max's spec: stale rendering moved from a dashed reference
  // line to a small ⏳ icon at each stale dot, on a SOLID continuous line.
  // Old dashed-line approach is gone. Verify EITHER the legacy dashed _avg /
  // _bestStale, OR the new staleFlag → ⏳ icon dot renderer.
  assert(/dataKey="_avg"[\s\S]{0,200}strokeDasharray/.test(tab) ||
    /dataKey="_bestStale"[\s\S]{0,400}strokeDasharray/.test(tab) ||
    /staleFlag[\s\S]{0,400}⏳/.test(tab),
    'chart must indicate stale either by dashed line (legacy) or per-point ⏳ icon (v55.83-A.6)');
});

test('S17.11.14 Empty-state message when no data in period', function() {
  // v55.83-A.5 — copy expanded to mention effective dates. Match either form.
  assert(/No rate data[\s\S]{0,80}in the selected period/.test(tab),
    'must show helpful empty-state message when filter returns nothing');
});

test('S17.11.15 Import still preserves effective_date from file', function() {
  // v55.83-A.5 — parseDate moved to shipping-import-helpers.js as parsedEffective;
  // the assignment `effective_date: parsedEffective || todayET()` preserves the
  // file's date if present, falling back to today only when missing. Same behavior.
  assert(/effective_date: parseDate\(row, colMap\.date\)/.test(tab) ||
    /effective_date: parsedEffective/.test(tab),
    'import must read effective_date from file (not override with today)');
});

test('S17.11.16 Import still preserves expiry_date from file', function() {
  // v55.83-A.5 — same refactor as #15. parsedExpiry resolves to either the
  // file's date or null. Same business behavior.
  assert(/expiry_date: parseDate\(row, colMap\.expiry\) \|\| null/.test(tab) ||
    /expiry_date: parsedExpiry/.test(tab),
    'import must read expiry_date from file; null if missing');
});

test('S17.11.17 fetchAll loads ALL rates (not filtered by active)', function() {
  // The loadData fetcher must not filter by expiry on server side
  assert(/fetchAll\('shipping_rates', 'effective_date'\)/.test(tab),
    'load must pull all shipping_rates so the client can filter as the user chooses');
});

test('S17.11.18 Dead old chart calc removed', function() {
  assert(!/const chartData = \{\}; routeHistory\.forEach/.test(tab),
    'the old crude bar-chart data calc must be removed');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
