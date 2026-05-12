// ============================================================
// v55.82-J — Shipping bubbles sorted by destination continent + dropdown
//
// Max May 11 2026:
//   "Shipping bubbles should be sorted by destination countries by
//    continent. Drop down"
//
// Implementation:
//   • CONTINENTS const + COUNTRY_TO_CONTINENT map covering ~150 countries
//     across the 6 continents plus an "Other" fallback
//   • continentOf(country) — case-insensitive lookup returning a continent
//     name, defaulting to 'Other'
//   • continentFilter state — persists in localStorage like the other
//     shipping filter preferences
//   • Dropdown rendered next to the Active/Historical/Both filter pills.
//     Shows per-continent counts and a clear-X button.
//   • routeGroups annotated with destContinent and FILTERED by continent
//     when continentFilter !== 'all'
//   • Active + Historical sections both render as continent groups (with
//     section headers) when no continent is selected; flat grid when one
//     is selected.
// ============================================================

var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) { console.log('✓ ' + label); }
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

var src = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ShippingRatesTab.jsx'), 'utf8');

// =====================================================================
// FIX #1 — Constants + helper
// =====================================================================

ok('1a: CONTINENTS const declared with all 6 continents + Other',
  /const CONTINENTS = \['Africa', 'Asia', 'Europe', 'North America', 'South America', 'Oceania', 'Other'\]/.test(src)
);

ok('1b: COUNTRY_TO_CONTINENT map declared',
  /const COUNTRY_TO_CONTINENT = \(function \(\)/.test(src)
);

ok('1c: continentOf helper defined and case-insensitive',
  /const continentOf = function \(country\)[\s\S]{0,300}toLowerCase\(\)/.test(src)
);

ok('1d: Helper defaults to "Other" for unknown countries',
  /return COUNTRY_TO_CONTINENT\[key\] \|\| 'Other'/.test(src)
);

ok('1e: Country map covers Egypt (sanity — KTC primary origin)',
  /'Egypt'/.test(src) && /'مصر'/.test(src)
);

ok('1f: Country map covers USA variants (sanity — KTC primary destination)',
  /'United States'/.test(src) && /'USA'/.test(src) && /'U\.S\.A\.'/.test(src)
);

ok('1g: Country map covers China + China variant codes',
  /'China'/.test(src) && /'CN'/.test(src) && /'الصين'/.test(src)
);

// =====================================================================
// FIX #2 — State + persistence
// =====================================================================

ok('2a: continentFilter state declared with localStorage hydration',
  /const \[continentFilter, setContinentFilter\] = useState\(function\(\)[\s\S]{0,400}localStorage\.getItem\('ktc_shipping_continent_filter'\)/.test(src)
);

ok('2b: setContinentFilterPersist persists to localStorage on change',
  /setContinentFilterPersist = function\(v\)[\s\S]{0,300}localStorage\.setItem\('ktc_shipping_continent_filter'/.test(src)
);

ok('2c: Default value is "all"',
  /return 'all';[\s\S]{0,200}setContinentFilterPersist/.test(src)
);

// =====================================================================
// FIX #3 — routeGroups annotation + filter
// =====================================================================

ok('3a: routeGroups annotates each row with destContinent',
  /destContinent: continentOf\(data\.destination\)/.test(src)
);

ok('3b: routeGroups filters by continentFilter when not "all"',
  /\.filter\(function \(rg\) \{[\s\S]{0,300}if \(continentFilter === 'all'\) return true;[\s\S]{0,200}return rg\.destContinent === continentFilter/.test(src)
);

ok('3c: routeGroups useMemo dep includes continentFilter',
  /\}, \[filtered, groupByPort, continentFilter\]\)/.test(src),
  'memo invalidates when continent filter changes'
);

// =====================================================================
// FIX #4 — Dropdown UI
// =====================================================================

ok('4a: Dropdown rendered with id "continent-filter"',
  /id="continent-filter"/.test(src)
);

ok('4b: Dropdown shows per-continent route counts',
  /byContinent\[c\] \|\| 0/.test(src)
);

ok('4c: Dropdown has "All continents" option as first entry',
  /All continents \(\{totalRoutes\}\)/.test(src)
);

ok('4d: Clear-X button shown when filter !== "all"',
  /continentFilter !== 'all' && \(\s*<button[\s\S]{0,400}setContinentFilterPersist\('all'\)/.test(src)
);

ok('4e: Dropdown change handler calls setContinentFilterPersist',
  /onChange=\{function \(e\) \{ setContinentFilterPersist\(e\.target\.value\)/.test(src)
);

// =====================================================================
// FIX #5 — Continent section headers in the bubble grid
// =====================================================================

ok('5a: Active section groups into continent sections when filter is "all"',
  /continentFilter === 'all' \? \(\s*\(function \(\) \{[\s\S]{0,300}groupedByContinent[\s\S]{0,300}activeRouteGroups\.forEach/.test(src)
);

ok('5b: Continent sections render in canonical CONTINENTS order',
  /CONTINENTS\.filter\(function \(c\) \{ return groupedByContinent\[c\] && groupedByContinent\[c\]\.length > 0/.test(src)
);

ok('5c: Each continent section has its own header with route count',
  /text-\[11px\] font-extrabold text-slate-700 uppercase tracking-wider">\{emoji\} \{c\}/.test(src)
);

ok('5d: Flat grid (no continent headers) when a specific continent is selected',
  /\) : \(\s*<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">\s*\{activeRouteGroups\.map\(renderRouteCard\)\}/.test(src)
);

ok('5e: Historical section ALSO groups by continent for symmetry',
  /histByContinent[\s\S]{0,200}historicalRouteGroups\.forEach/.test(src)
);

// =====================================================================
// REGRESSION GUARDS
// =====================================================================

ok('6a: REGRESSION GUARD — historicalRouteGroups still computed from routeGroups',
  /historicalRouteGroups = useMemo\(function \(\) \{\s*return routeGroups\.filter\(function \(rg\) \{ return rg\.historicalGroup;/.test(src)
);

ok('6b: REGRESSION GUARD — activeRouteGroups still computed from routeGroups',
  /activeRouteGroups = useMemo\(function \(\) \{\s*return routeGroups\.filter\(function \(rg\) \{ return !rg\.historicalGroup;/.test(src)
);

ok('6c: REGRESSION GUARD — Active section header counts still rendered',
  /\(\{activeRouteGroups\.length\} \{activeRouteGroups\.length === 1 \? 'route' : 'routes'\}/.test(src)
);

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' test' + (failures.length === 1 ? '' : 's') + ' failed:');
  failures.forEach(function(f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.82-J continent dropdown + sorting tests passed');
