// v55.83-A.6.26 (Max May 14 2026) — Chart active-line color
//
// User screamed about the "missing line" between 2026-04 and 2026-05 in the
// Best Rate Over Time chart. After staring at the screenshot, the line WAS
// actually being drawn — just at stroke="#0f172a" (slate-950), which is
// near-black on a near-black background = invisible.
//
// All the bridge logic / connectNulls work I added in A.6.24 was correct.
// The visual gap was a contrast bug, not a data bug. This test pins the
// active line color to something that ACTUALLY shows on dark theme.

var fs = require('fs');
var path = require('path');
var src = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ShippingRatesTab.jsx'), 'utf8');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// === Color of the active line ===
ok('1a: _bestActive line uses a high-contrast color (NOT slate-950 which was invisible on dark)',
  !/dataKey="_bestActive"[\s\S]{0,300}stroke="#0f172a"/.test(src));

ok('1b: _bestActive line uses sky-400 #38bdf8 (high contrast on both dark and light)',
  /dataKey="_bestActive"[\s\S]{0,300}stroke="#38bdf8"/.test(src));

ok('1c: dot fill matches stroke color so dots are visible too',
  /dataKey="_bestActive"[\s\S]{0,300}dot=\{\{r: 4, fill: '#38bdf8', stroke: '#38bdf8'\}\}/.test(src));

ok('1d: explanatory comment about the contrast fix',
  /v55\.83-A\.6\.26[\s\S]{0,800}#38bdf8/.test(src));

// === Dashed stale line still uses slate-400 (visible on dark already) ===
ok('2a: _bestStale line still uses #94a3b8 (slate-400) — visible on dark theme',
  /dataKey="_bestStale"[\s\S]{0,300}stroke="#94a3b8"/.test(src));

// === Bridge logic from A.6.24 still in place ===
ok('3a: solid→dashed back-write bridge still in place',
  /lastBest\.wasStale === false && prevPoint && prevPoint\._bestActive != null[\s\S]{0,200}prevPoint\._bestStale = prevPoint\._bestActive/.test(src));

ok('3b: dashed→solid forward-write bridge still in place',
  /if \(lastBest && lastBest\.wasStale\)[\s\S]{0,200}point\._bestStale = Number\(bestRow\.rate_amount\)/.test(src));

// === connectNulls=true on both lines (so single-month gaps still bridge) ===
ok('4a: _bestActive line has connectNulls=true',
  /dataKey="_bestActive"[\s\S]{0,400}connectNulls=\{true\}/.test(src));
ok('4b: _bestStale line has connectNulls=true',
  /dataKey="_bestStale"[\s\S]{0,400}connectNulls=\{true\}/.test(src));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.26 chart contrast tests passed');
