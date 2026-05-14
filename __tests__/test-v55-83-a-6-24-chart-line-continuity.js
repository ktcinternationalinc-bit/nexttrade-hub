// v55.83-A.6.24 (Max May 14 2026) — Chart line continuity
//
// Per Max: "If the chart moves from an active rate to an expired rate, the
// line should continue visually. It can change style from solid to dashed,
// but it should not disappear or create a gap."
//
// Bug: solid → dashed transition left a visual gap because the previous
// (active) month had no _bestStale value, so Recharts had nothing to draw
// the dashed line FROM. The dashed→solid bridge already worked because
// the current (newly active) month wrote both _bestStale + _bestActive.
//
// Fix: when entering CASE 2 (stale carry-forward), back-write _bestStale
// onto the PREVIOUS point at its active value.
//
// Same logic now applies to per-group lines (By Vendor / By Line) via
// {G}__active and {G}__stale data keys.

var fs = require('fs');
var path = require('path');
var src = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ShippingRatesTab.jsx'), 'utf8');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// === 1. Market floor bridge (solid → dashed) ===
ok('1a: prevPoint tracker declared outside months.map closure',
  /var prevPoint = null;\s*\n\s*var trendPoints = months\.map/.test(src));
ok('1b: prevPoint reassigned at end of each iteration (before return)',
  /prevPoint = point;\s*\n\s*return point;/.test(src));
ok('1c: CASE 2 back-writes _bestStale onto prevPoint when transition is solid→dashed',
  /lastBest\.wasStale === false && prevPoint && prevPoint\._bestActive != null[\s\S]{0,200}prevPoint\._bestStale = prevPoint\._bestActive/.test(src));
ok('1d: CASE 1 still bridges dashed→solid (existing behavior preserved)',
  /lastBest && lastBest\.wasStale[\s\S]{0,200}point\._bestStale = Number\(bestRow\.rate_amount\)/.test(src));

// === 2. Per-group (By Vendor / By Line) split ===
ok('2a: per-group CASE 1 writes G__active',
  /point\[G \+ '__active'\] = winPrice/.test(src));
ok('2b: per-group CASE 1 bridges dashed→solid when prev was stale',
  /prevWasStaleForG[\s\S]{0,300}point\[G \+ '__stale'\] = winPrice/.test(src));
ok('2c: per-group CASE 2 writes G__stale',
  /point\[G \+ '__stale'\] = lastBestForLine\[G\]\.price/.test(src));
ok('2d: per-group CASE 2 back-writes G__stale onto prevPoint at solid→dashed transition',
  /prevWasStaleForG === false && prevPoint && prevPoint\[G \+ '__active'\] != null[\s\S]{0,200}prevPoint\[G \+ '__stale'\] = prevPoint\[G \+ '__active'\]/.test(src));
ok('2e: per-group lastBestForLine now tracks wasStale flag',
  /lastBestForLine\[G\] = \{ price: winPrice, rateId: winner\.id, asOfMonth: m, wasStale: false \}/.test(src)
  && /lastBestForLine\[G\]\.wasStale = true/.test(src));
ok('2f: per-group CASE 3 bootstrap writes G__active',
  /fallbackForGroup[\s\S]{0,500}point\[G \+ '__active'\] = fbPrice/.test(src));
ok('2g: legacy point[G] field still written (back-compat for tooltip/click)',
  /point\[G\] = winPrice/.test(src)
  && /point\[G\] = lastBestForLine\[G\]\.price/.test(src)
  && /point\[G\] = fbPrice/.test(src));

// === 3. Render side — per-group emits TWO lines with same color ===
ok('3a: Fragment imported for per-group dual-line wrapper',
  /import \{[^}]*Fragment[^}]*\} from 'react'/.test(src));
ok('3b: per-group rendering emits {G}__active line (solid)',
  /dataKey=\{G \+ '__active'\}[\s\S]{0,200}stroke=\{col\}[\s\S]{0,100}strokeWidth=\{2\}/.test(src));
ok('3c: per-group rendering emits {G}__stale line (dashed, same color, lower opacity)',
  /dataKey=\{G \+ '__stale'\}[\s\S]{0,500}strokeDasharray="6 4"/.test(src)
  && /dataKey=\{G \+ '__stale'\}[\s\S]{0,500}strokeOpacity=\{0\.5\}/.test(src));
ok('3d: both per-group lines use connectNulls so transitions bridge cleanly',
  (src.match(/dataKey=\{G \+ '__active'\}[\s\S]{0,300}connectNulls=\{true\}/g) || []).length >= 1
  && (src.match(/dataKey=\{G \+ '__stale'\}[\s\S]{0,400}connectNulls=\{true\}/g) || []).length >= 1);

// === 4. Market floor render unchanged (still has both _bestActive and _bestStale) ===
ok('4a: _bestActive line still rendered (solid dark)',
  /dataKey="_bestActive"[\s\S]{0,200}stroke="(#0f172a|#38bdf8)"[\s\S]{0,100}connectNulls=\{true\}/.test(src));
ok('4b: _bestStale line still rendered (dashed grey)',
  /dataKey="_bestStale"[\s\S]{0,300}strokeDasharray="6 4"[\s\S]{0,100}connectNulls=\{true\}/.test(src));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.24 chart continuity tests passed');
