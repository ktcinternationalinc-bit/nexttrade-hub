// __tests__/test-v55-80-shipping-trends-view.js
// =============================================
// v55.80 — Trends view in ShippingRatesTab.
//
// Per Max May 8 2026: a line graph showing rate changes over time per
// container size (20', 40', 40HC). Backend data structure:
//
//   trendData = [
//     { month: '2024-01', "20' GP": 1500, "40' GP": 2200, "40' HC": 2400 },
//     { month: '2024-02', ... },
//   ]
//
// Run: node __tests__/test-v55-80-shipping-trends-view.js

var fs = require('fs');
var path = require('path');

var src = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ShippingRatesTab.jsx'), 'utf8');

var passed = 0;
var failed = 0;
function ok(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.error('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('\n=== Trends view structure tests ===\n');

// Component-level checks
ok('Trends button exists in main routes header',
   /onClick=\{\(\)=>setView\('trends'\)\}.*📈 Trends/.test(src));
ok('Trends view block defined',
   /view === 'trends'/.test(src));
ok('Default trend range is 12 months',
   /useState\('12m'\)/.test(src));

// Filter UI
ok('Range buttons: 6m, 12m, 24m, all',
   /'6m'.*'12m'.*'24m'.*'all'/s.test(src));
ok('Origin filter dropdown',
   /trendOrigin.*setTrendOrigin/.test(src));
ok('Destination filter dropdown',
   /trendDest.*setTrendDest/.test(src));
ok('Currency filter dropdown',
   /trendCurrency.*setTrendCurrency/.test(src));

// Chart structure
ok('Uses LineChart from recharts',
   /<LineChart\s+data=\{trendData\}/.test(src));
ok('20\' GP line plotted',
   /dataKey="20' GP"/.test(src));
ok('40\' GP line plotted',
   /dataKey="40' GP"/.test(src));
ok('40\' HC line plotted',
   /dataKey="40' HC"/.test(src));
ok('connectNulls=true (don\'t break line on missing month)',
   /connectNulls/.test(src));

// Data prep
ok('Groups by month (YYYY-MM)',
   /\.substring\(0,\s*7\)/.test(src));
ok('Uses ResponsiveContainer for chart',
   /<ResponsiveContainer\s+width="100%"\s+height="100%">[\s\S]*?<LineChart/.test(src));
ok('Tooltip and Legend present',
   /<RTooltip\s*\/>[\s\S]*?<RLegend\s*\/>/.test(src));

// Per-container summary cards
ok('Per-container summary (latest, change %)',
   /summaryByCT[\s\S]+?TARGETS\.map/.test(src));
ok('Change % colored: red for up, green for down',
   /text-red-600.*text-emerald-600|text-emerald-600.*text-red-600/s.test(src));

// Empty state
ok('Empty-state message when no data in window',
   /No rates in this window/.test(src));

// Container normalization in trend grouping
ok('Container normalization — 20ft variants → "20\' GP"',
   /20.*\|\|.*20ft|20.*\|\|.*ctLower/.test(src));
ok('Container normalization — 40HC/40HQ → "40\' HC"',
   /40.*hc.*hq|hq.*hc/i.test(src));

// Filter the rate set BEFORE charting (don't include outside-window)
ok('Trend filters: cutoffStr from daysAgoET',
   /cutoffStr = daysAgoET\(cutoffDays\)/.test(src));
ok('Trend filters by date >= cutoff',
   /effective_date < cutoffStr/.test(src));

console.log('\n=== Results ===');
console.log('Passed: ' + passed + ' / ' + (passed + failed));
process.exit(failed > 0 ? 1 : 0);
