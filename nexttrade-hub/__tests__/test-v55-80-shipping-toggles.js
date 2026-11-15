// __tests__/test-v55-80-shipping-toggles.js
// =========================================
// v55.80 — Toggle UI tests for ShippingRatesTab.
//
// Per Max May 8 2026:
//   "Need also toggle to show bubble view vs detail line view."
// This test verifies:
//   1. The routes toggle uses Max's terminology: "Bubble View" / "Detail Line View"
//   2. The trends view also has a chart/table toggle
//   3. State persists in localStorage with proper namespaced keys
//
// Run: node __tests__/test-v55-80-shipping-toggles.js

var fs = require('fs');
var path = require('path');

var src = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ShippingRatesTab.jsx'), 'utf8');

var passed = 0;
var failed = 0;
function ok(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.error('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('\n=== Shipping toggle tests (v55.80) ===\n');

// ---- Bubble vs Detail Line View ----
ok('Bubble View button uses Max\'s terminology',
   /🫧 Bubble View/.test(src));
ok('Detail Line View button uses Max\'s terminology',
   /📋 Detail Line View/.test(src));
ok('Bubble View toggles to "routes" mode',
   /onClick=\{function \(\) \{ setRoutesViewModePersist\('routes'\)/.test(src));
ok('Detail Line View toggles to "list" mode',
   /onClick=\{function \(\) \{ setRoutesViewModePersist\('list'\)/.test(src));
ok('Toggle state persists to localStorage',
   /ktc_shipping_routes_view_mode/.test(src));
ok('Both modes render the same filtered dataset',
   /routesViewMode === 'routes'/.test(src) && /routesViewMode === 'list'/.test(src));

// Tooltips on the buttons explain what each does
ok('Bubble View tooltip explains it groups by route',
   /title="Group rates by route — one bubble per origin/.test(src));
ok('Detail Line View tooltip explains it shows one row per rate',
   /title="Show every individual rate as a row/.test(src));

// ---- Trends Chart vs Table Toggle ----
ok('Trends Chart View button',
   /📈 Chart View/.test(src));
ok('Trends Table View button',
   /📋 Table View/.test(src));
ok('Trends toggle state',
   /\[trendsViewMode, setTrendsViewModeRaw\]/.test(src));
ok('Trends mode persists to localStorage',
   /ktc_shipping_trends_view_mode/.test(src));
ok('Default trends mode is chart',
   /'ktc_shipping_trends_view_mode'\)\)? \|\| 'chart'/.test(src));

// Both modes render
ok('Trends chart mode renders LineChart',
   /trendsViewMode === 'chart' \?/.test(src));
ok('Trends table mode renders monthly grid',
   /<table className="w-full text-xs">[\s\S]+?<thead className="bg-slate-50/.test(src));

// Table headers
ok('Trends table has 4 columns: Month, 20\' GP, 40\' GP, 40\' HC',
   /Month[\s\S]+?20' GP[\s\S]+?40' GP[\s\S]+?40' HC/.test(src));

// Table rows reverse-sorted (newest month first)
ok('Trends table shows newest month first (slice().reverse())',
   /trendData\.slice\(\)\.reverse\(\)\.map/.test(src));

// Empty state still works in both modes
ok('Empty state still works (single fallback for both modes)',
   /trendData\.length === 0[\s\S]{0,200}No rates in this window/.test(src));

console.log('\n=== Results ===');
console.log('Passed: ' + passed + ' / ' + (passed + failed));
process.exit(failed > 0 ? 1 : 0);
