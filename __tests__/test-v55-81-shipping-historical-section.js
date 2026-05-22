// __tests__/test-v55-81-shipping-historical-section.js
// =============================================================
// v55.81 Checkpoint 2 #16 + #17 + #18 + #19
//   #16 — Expired rates move to a "Historical Rates" section
//         instead of disappearing.
//   #17 — Three-button toggle: Active / Historical / Both
//         (replaces the dropdown). Default is Active.
//   #18 — Historical section visually dimmed at 60% opacity.
//   #19 — Sort: alphabetical by destination, Active first.
// =============================================================

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var ship = fs.readFileSync(path.join(ROOT, 'src/components/ShippingRatesTab.jsx'), 'utf8');

var failures = [];
function ok(name, cond) {
  if (cond) { console.log('  ✓', name); }
  else { failures.push(name); console.log('  ✗', name); }
}

// =============================================================
// #17 — Three-button toggle, defaults to Active
// =============================================================
console.log('#17 — Active / Historical / Both toggle');

ok('filterExpiry default state is "active" (was "all")',
  /useState\(['"]active['"]\)/.test(ship) ||
  /return ['"]active['"];\s*\}/.test(ship));
ok('Old dropdown <select> for filterExpiry is removed',
  !/<select value=\{filterExpiry\}/.test(ship));
ok('Active button exists with emerald-700 active style',
  /setFilterExpiry(?:Persist)?\(['"]active['"]\)/.test(ship) &&
  /text-emerald-700/.test(ship));
ok('Historical button exists with the 📜 icon',
  /setFilterExpiry(?:Persist)?\(['"]expired['"]\)/.test(ship) &&
  /📜 Historical/.test(ship));
ok('"Both" button exists for the all-rates view',
  /setFilterExpiry(?:Persist)?\(['"]all['"]\)/.test(ship) &&
  /\bBoth\b/.test(ship));
ok('Toggle has v55.81 #17 marker comment',
  ship.indexOf('v55.81 #17') !== -1);

// =============================================================
// #16 — Historical section split (active first, then historical)
// =============================================================
console.log('\n#16 — Historical Rates section split');

ok('routeGroups marks each group as historicalGroup when ALL rates expired',
  /historicalGroup:\s*ar\.length\s*===\s*0/.test(ship));
ok('activeRouteGroups memo filters out historical groups',
  /activeRouteGroups[\s\S]{0,200}!rg\.historicalGroup/.test(ship));
ok('historicalRouteGroups memo keeps only historical groups',
  /historicalRouteGroups[\s\S]{0,200}return rg\.historicalGroup;/.test(ship));
ok('Routes-card view renders activeRouteGroups (top section)',
  /activeRouteGroups\.map\(renderRouteCard\)/.test(ship));
ok('Routes-card view renders historicalRouteGroups (bottom section)',
  /historicalRouteGroups\.map\(renderRouteCard\)/.test(ship));
ok('Routes view has v55.81 #16 marker',
  ship.indexOf('v55.81 #16') !== -1);
ok('Active section header reads "✅ Active Rates"',
  /✅ Active Rates/.test(ship));
ok('Historical section header reads "📜 Historical Rates"',
  /📜 Historical Rates/.test(ship));
ok('Historical section header notes "kept for reference"',
  /kept for reference/.test(ship));
ok('Empty-state still works when both buckets are empty',
  /activeRouteGroups\.length === 0 && historicalRouteGroups\.length === 0/.test(ship));

// =============================================================
// #18 — Historical visually dimmed
// =============================================================
console.log('\n#18 — Historical visual distinction');

ok('Routes-card historical section uses opacity-60',
  /opacity-60 hover:opacity-100/.test(ship) &&
  ship.indexOf('v55.81 #18') !== -1);
ok('List view rows still dimmed when expired (opacity-60)',
  /\(exp \? 'opacity-60' : ''\)/.test(ship));
ok('List view active divider header uses bg-emerald-50',
  /bg-emerald-50\/60[\s\S]{0,200}✅ Active Rates/.test(ship));
ok('List view historical divider header uses bg-slate-100',
  /bg-slate-100[\s\S]{0,200}📜 Historical Rates/.test(ship));

// =============================================================
// #19 — Sort: active first, alphabetical by destination
// =============================================================
console.log('\n#19 — Sort: active first then alphabetical destination');

ok('Bubble view sort function: active groups before historical',
  /if \(a\.historicalGroup !== b\.historicalGroup\) return a\.historicalGroup \? 1 : -1;/.test(ship));
ok('Bubble view sort: alphabetical by destination',
  // A.6.27.15: dropped the rightLabel fallback in the sort since every
  // group has a populated destination now. Accept either shape.
  /var ad = \(a\.destination \|\| a\.rightLabel \|\| ''\)\.toLowerCase\(\);/.test(ship) ||
  /var ad = \(a\.destination \|\| ''\)\.toLowerCase\(\);/.test(ship));
ok('Bubble view sort: secondary alphabetical by origin',
  /var ao = \(a\.origin \|\| a\.leftLabel \|\| ''\)\.toLowerCase\(\);/.test(ship) ||
  /var ao = \(a\.origin \|\| ''\)\.toLowerCase\(\);/.test(ship));
ok('Old "sort by count desc" pattern is gone',
  !/sort\(\(a,b\) => b\.count - a\.count\)/.test(ship));
ok('List view sort: active rows always before historical (primary key)',
  /var ax = isExpired\(a\.expiry_date\) \? 1 : 0;[\s\S]{0,200}if \(ax !== bx\) return ax - bx;/.test(ship));
ok('List view section divider only shows in "all" mode',
  /var showDivider = filterExpiry === 'all' && activeCount > 0 && historicalCount > 0;/.test(ship));

console.log('\n' + (failures.length === 0 ? 'PASS' : 'FAIL') + ' — ' + (24 - failures.length) + '/24 assertions');
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
