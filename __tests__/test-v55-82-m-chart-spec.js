// ============================================================
// v55.82-M — Shipping historical chart per Max May 12 2026 spec
//
// Seven required behaviors:
//   1. X-axis = effective-date months, starting from earliest
//   2. Active-window logic: rate is active in M when its
//      [effective_date, expiry_date] overlaps M
//   3. Monthly best = lowest active price (exclude expired if
//      active alternative exists)
//   4. Carry-forward: if no active rate this month, show last
//      known best with stale marker
//   5. Continuous monthly graph (no gaps from first to today)
//   6. Click → scroll to + highlight matching rate row
//   7. Goal: clear "which record made each point" trace
// ============================================================

var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) { console.log('✓ ' + label); }
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

var src = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ShippingRatesTab.jsx'), 'utf8');

// ============================================================
// SPEC #1 — X-axis based on effective date timeline
// ============================================================

ok('1a: validRatesForChart now requires effective_date (was expiry_date)',
  /validRatesForChart = trendRatesForChart\.filter[\s\S]{0,500}r\.effective_date \|\| ''[\s\S]{0,300}eff\.length >= 10/.test(src),
  'spec point 1 — X-axis driven by effective date, not expiry'
);

ok('1b: Earliest effective month computed as starting point',
  /firstMonth = validRatesForChart\.reduce[\s\S]{0,300}r\.effective_date\.substring\(0,7\)/.test(src),
  'X-axis must start from the first existing effective month per spec'
);

ok('1c: REGRESSION GUARD — old expiry-anchored validRates filter is gone',
  // Old line was: var exp = r.expiry_date || ''; ... return exp.length >= 7 && amt > 0;
  !/validRatesForChart = trendRatesForChart\.filter\(function\(r\) \{\s*var exp = r\.expiry_date/.test(src),
  'must not anchor on expiry anymore'
);

// ============================================================
// SPEC #2 — Active-window rule
// ============================================================

ok('2a: Active-window check is the documented (eff <= monthEnd && (no exp || exp >= monthStart))',
  /eff <= monthEnd && \(exp === '' \|\| exp >= monthStart\)/.test(src),
  'spec point 2 — overlap test'
);

ok('2b: Each month gets a monthStart/monthEnd boundary',
  /var monthStart = firstDayOf\(m\)/.test(src) &&
  /var monthEnd = lastDayOf\(m\)/.test(src)
);

ok('2c: Null/empty expiry_date treated as "no end date" (always active)',
  /var exp = r\.expiry_date \|\| ''; \/\/ empty = never expires/.test(src) ||
  /empty = never expires/.test(src)
);

// ============================================================
// SPEC #3 — Monthly best rate = lowest active price
// ============================================================

ok('3a: Per-month winner selected as lowest rate via reduce()',
  // v55.83-A.6 — activeForLine → activeForGroup rename
  (/winner = activeForLine\.reduce[\s\S]{0,300}Number\(r\.rate_amount\) < Number\(acc\.rate_amount\) \? r : acc/.test(src) ||
   /winner = activeForGroup\.reduce[\s\S]{0,300}Number\(r\.rate_amount\) < Number\(acc\.rate_amount\) \? r : acc/.test(src)),
  'spec point 3 — lowest valid active price wins'
);

ok('3b: Market-floor "_best" line picks lowest across ALL active rates',
  /bestRow = activeInMonth\.reduce[\s\S]{0,300}Number\(r\.rate_amount\) < Number\(acc\.rate_amount\) \? r : acc/.test(src)
);

// ============================================================
// SPEC #4 — Carry-forward with stale marker
// ============================================================

ok('4a: lastBestForLine map tracks the most recent best per line/group',
  // v55.83-A.6 — variable iteration var renamed L → G (group, not just shipping_line)
  /var lastBestForLine = \{\}/.test(src) &&
  (/lastBestForLine\[L\] = \{ price: Number\(winner\.rate_amount\), rateId: winner\.id, asOfMonth: m \}/.test(src) ||
   /lastBestForLine\[G\] = \{ price: Number\(winner\.rate_amount\), rateId: winner\.id, asOfMonth: m \}/.test(src))
);

ok('4b: When no active rate exists, carry-forward branch runs and sets stale flag',
  // v55.83-A.6 — same L → G iteration rename
  (/else if \(lastBestForLine\[L\]\) \{[\s\S]{0,500}point\['__stale__' \+ L\] = true/.test(src) ||
   /else if \(lastBestForLine\[G\]\) \{[\s\S]{0,500}point\['__stale__' \+ G\] = true/.test(src)),
  'spec point 4 — carry-forward marks the point stale'
);

ok('4c: Stale dot renderer marks stale points distinctly',
  // v55.83-A.6 (Max May 13 2026 spec) — stale rendering changed from a hollow
  // dashed circle to a SOLID dot + ⏳ icon overlay above the dot. The line
  // itself is now solid (no more dotted-grey). Accept either form.
  (/staleFlag[\s\S]{0,300}circle cx=\{cx\} cy=\{cy\} r=\{4\} fill="#fff"[\s\S]{0,100}strokeDasharray="2 2"/.test(src) ||
   /staleFlag[\s\S]{0,400}⏳/.test(src)),
  'stale carry-forward must be visually marked (hollow dashed dot OR ⏳ icon)'
);

ok('4d: Tooltip shows "last known — no newer rate" indicator on stale points',
  /last known — no newer rate/.test(src),
  'spec point 4 — UI clearly distinguishes stale from active'
);

// ============================================================
// SPEC #5 — Continuous monthly graph (no gaps)
// ============================================================

ok('5a: Months loop rolls forward continuously from firstMonth to endMonth',
  /while \(cur <= endMonth && safety < 600\) \{[\s\S]{0,200}months\.push\(cur\);\s*cur = nextMonth\(cur\)/.test(src),
  'spec point 5 — every month rendered, no gaps'
);

ok('5b: nextMonth helper increments YYYY-MM correctly (handles December → January)',
  /m \+= 1; if \(m > 12\) \{ m = 1; y \+= 1; \}/.test(src)
);

ok('5c: REGRESSION GUARD — months no longer derived from monthsSet (sparse)',
  // Old code did: var monthsSet = new Set(); validRatesForChart.forEach(...monthsSet.add(m));
  // var months = Array.from(monthsSet).sort();
  // That was sparse — only months that had data. New code is continuous.
  !/var monthsSet = new Set\(\);\s*var validRatesForChart/.test(src),
  'old sparse-month derivation removed'
);

ok('5d: Safety cap on month iteration (no infinite loop)',
  /safety < 600/.test(src) || /safety < \d+/.test(src)
);

// ============================================================
// SPEC #6 — Click on chart point → scroll to + highlight row
// ============================================================

ok('6a: highlightedRateId state declared',
  /const \[highlightedRateId, setHighlightedRateId\] = useState\(null\)/.test(src)
);

ok('6b: Auto-clear effect drops the highlight after 3 seconds',
  /useEffect\(function\(\) \{\s*if \(!highlightedRateId\) return;\s*var t = setTimeout\(function\(\) \{ setHighlightedRateId\(null\); \}, 3000\)/.test(src),
  'highlight should be a flash, not permanent'
);

ok('6c: Chart onClick handler resolves the clicked payload to first sourceId',
  /var handleChartClick = function\(state\) \{[\s\S]{0,800}__sourceIds__\[0\][\s\S]{0,200}setHighlightedRateId\(firstId\)/.test(src)
);

ok('6d: Each trendPoint carries __sourceIds__ for click resolution',
  /point\.__sourceIds__ = pointSourceIds/.test(src)
);

ok('6e: Chart container has onClick={handleChartClick}',
  /<ComposedChart [\s\S]{0,200}onClick=\{handleChartClick\}/.test(src)
);

ok('6f: Rate row has id={"rate-row-" + r.id} for scrollIntoView target',
  /id=\{'rate-row-' \+ r\.id\}/.test(src)
);

ok('6g: handleChartClick calls scrollIntoView with smooth + center',
  /scrollIntoView\(\{ behavior: 'smooth', block: 'center' \}\)/.test(src)
);

ok('6h: Highlighted row gets a visible ring + bg flash',
  /ring-4 ring-yellow-400[\s\S]{0,100}bg-yellow-50/.test(src) ||
  /ring-yellow-400[\s\S]{0,200}bg-yellow-50/.test(src),
  'spec point 6 — highlight that exact record'
);

ok('6i: Highlighted row transitions smoothly (not instant flash)',
  /transition-all duration-300/.test(src)
);

// ============================================================
// SPEC #7 — Goal: trace each point back to its source record
// ============================================================

ok('7a: Each line plotted carries per-group __source__ ids',
  // v55.83-A.6 — L → G iteration rename
  (/point\['__source__' \+ L\] = winner\.id/.test(src) ||
   /point\['__source__' \+ G\] = winner\.id/.test(src)) &&
  /point\.__source___best = bestRow\.id/.test(src)
);

ok('7b: Carry-forward stale points still expose their (last known) source id',
  // v55.83-A.6 — L → G iteration rename
  /point\['__source__' \+ L\] = lastBestForLine\[L\]\.rateId/.test(src) ||
  /point\['__source__' \+ G\] = lastBestForLine\[G\]\.rateId/.test(src)
);

ok('7c: Header subtitle explains the click → jump affordance',
  /click any point → jump to the rate below/.test(src) ||
  /click any point/.test(src),
  'spec point 7 — user should understand the chart→table link'
);

ok('7d: Chart subtitle explains X-axis is by month (not expiry-anchored)',
  // v55.83-A.6 — caption restructured to mention "X-axis: month" instead of
  // "effective-date timeline". Both convey the same intent (month-based axis).
  /effective-date timeline/.test(src) ||
  /X-axis: month/.test(src),
  'UI clearly labels what X-axis represents'
);

// ============================================================
// Final
// ============================================================

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' test' + (failures.length === 1 ? '' : 's') + ' failed:');
  failures.forEach(function(f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.82-M chart-spec tests passed');
