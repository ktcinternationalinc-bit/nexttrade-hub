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

test('S17.11.10 Rate trend LineChart renders', function() {
  assert(/<LineChart data=\{trendPoints\}/.test(tab),
    'must render LineChart with trendPoints data');
});

test('S17.11.11 Chart supports "all lines" view overlaying each shipping line', function() {
  assert(/chartShippingLine === 'all'\s*\?\s*linesToPlot\.map/.test(tab),
    'when chartShippingLine=all, should render one Line per shipping line');
});

test('S17.11.12 Chart supports specific shipping-line view', function() {
  assert(/\(<Line type="monotone" dataKey=\{chartShippingLine\}/.test(tab),
    'when a specific line is selected, only that Line renders');
});

test('S17.11.13 Overall average dashed line shown in all-lines mode', function() {
  assert(/dataKey="_avg"[\s\S]{0,120}strokeDasharray/.test(tab),
    'overall average should be a dashed reference line in all-lines mode');
});

test('S17.11.14 Empty-state message when no data in period', function() {
  assert(/No rate data in the selected period/.test(tab),
    'must show helpful empty-state message when filter returns nothing');
});

test('S17.11.15 Import still preserves effective_date from file', function() {
  // parseDate on the "date" column → effective_date
  assert(/effective_date: parseDate\(row, colMap\.date\)/.test(tab),
    'import must read effective_date from file (not override with today)');
});

test('S17.11.16 Import still preserves expiry_date from file', function() {
  assert(/expiry_date: parseDate\(row, colMap\.expiry\) \|\| null/.test(tab),
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
