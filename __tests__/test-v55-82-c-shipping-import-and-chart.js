// ============================================================
// v55.82-C — Shipping import template + trend chart fixes
//
// Max May 10, 2026:
//   "Make sure import template matches this template and pulls in all
//    of this data. Use the expiration date as the main data to graph
//    the movement of price over period of time. Best price of any
//    freight forwarder as the key for any period that has several
//    quotes. Bookings should be indicated with star in graph for what
//    price was booked at. So you can have several stars. Make sure
//    nine if fields are empty. All other rules we had previously apply.
//    Test your work!"
//
// Findings + fixes covered by this test file:
//
//   #1 IMPORT — "Other Fees Description" column was being dropped
//      Template column 20 ("BAF" / "CAF" / "ISPS" labels) had no
//      counterpart in colMap, so the import discarded the surcharge
//      labels every time. Fix: added otherFeesDesc to both colMap
//      blocks (processImportFile + reparseFromMapping), wrote
//      other_fees_desc into baseFields, and surfaced it in the
//      mapping UI label list.
//
//   #2 CHART — X-axis was effective_date, should be expiry_date
//      Per Max: "use the expiration date as the main data to graph"
//
//   #3 CHART — Aggregate was AVG, should be BEST PRICE
//      Per Max: "best price of any freight forwarder as the key for
//      any period that there are several quotes in the same period"
//
//   #4 CHART — No booking markers
//      Per Max: "bookings should be indicated with star in graph for
//      what price was booked at. So you can have several stars."
//      Recharts ComposedChart + Scatter with custom 5-point star shape.
//
//   #5 CHART — NaN safety on empty fields
//      Per Max: "make sure nine if fields are empty"
//      Defensive filtering: rate=0 / no expiry / no booking_date all
//      excluded from chart, no Math.min on empty array (Infinity), no
//      undefined dataKey explosions.
//
//   #6 SCHEMA — other_fees_desc column migration provided
//      The import retry loop will strip the column if the DB doesn't
//      have it, but users want the labels saved — migration ships.
// ============================================================

var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) { console.log('✓ ' + label); }
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

var tabSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ShippingRatesTab.jsx'), 'utf8');
var migrationsDir = path.join(__dirname, '..', 'migrations');

// =====================================================================
// FIX #1 — Import captures Other Fees Description (template column 20)
// =====================================================================

// 1a — colMap has otherFeesDesc key in processImportFile
ok('1a: processImportFile colMap includes otherFeesDesc',
  /colMap = \{[\s\S]{0,3000}otherFeesDesc: findColSmart/.test(tabSrc),
  'otherFeesDesc must be auto-detected in the import column map'
);

// 1b — keyword list covers the obvious header variants
ok('1b: otherFeesDesc keyword list covers "other fees description" / "fee description" / "surcharge label"',
  /otherFeesDesc: findColSmart\(\['other fees description'[\s\S]{0,300}'fee description'[\s\S]{0,200}'surcharge label'/.test(tabSrc)
);

// 1c — excludes "amount" and "value" (so we don't grab the numeric column by mistake)
ok('1c: otherFeesDesc keyword search excludes "amount" / "value"',
  /otherFeesDesc: findColSmart\(\[[^\]]+\], \{ exclude: \['amount', 'value'\] \}\)/.test(tabSrc)
);

// 1d — baseFields in processImportFile writes other_fees_desc
ok('1d: processImportFile baseFields writes other_fees_desc',
  (function() {
    var procIdx = tabSrc.indexOf('const processImportFile');
    var procEnd = tabSrc.indexOf('const reparseFromMapping');
    var slice = tabSrc.slice(procIdx, procEnd);
    return /other_fees_desc: getVal\(row, colMap\.otherFeesDesc\)/.test(slice);
  })(),
  'must persist the surcharge label in the rate record'
);

// 1e — reparseFromMapping ALSO writes other_fees_desc (so user-remapped columns work too)
ok('1e: reparseFromMapping baseFields also writes other_fees_desc',
  (function() {
    var idx = tabSrc.indexOf('const reparseFromMapping');
    var slice = tabSrc.slice(idx, idx + 4000);
    return /other_fees_desc: getVal\(row, newColMap\.otherFeesDesc\)/.test(slice);
  })(),
  'second import path must mirror the first — bug fixes here historically only landed in one'
);

// 1f — mapping UI label list includes Other Fees Description
ok('1f: mapping UI label list includes [\'otherFeesDesc\', \'Other Fees Description\']',
  /\['otherFeesDesc', 'Other Fees Description'\]/.test(tabSrc),
  'user must be able to remap this column if auto-detect picked the wrong one'
);

// 1g — sanity: the template generation block already has "Other Fees Description"
//      header (no change needed, but confirm we didn't break it).
ok('1g: TEMPLATE GENERATION still emits "Other Fees Description" header (unchanged)',
  /'Other Fees Description'/.test(tabSrc) && /'Notes'\s*,\s*\]/.test(tabSrc)
);

// =====================================================================
// FIX #2/#3/#4/#5 — Trend chart rewrite
// =====================================================================

// Locate the chart IIFE so we can scope all assertions to it. The chart
// is the only block that mentions "Best Rate Over Time".
var chartIdx = tabSrc.indexOf('Best Rate Over Time');
ok('chart-anchor: chart block exists with new title',
  chartIdx > 0,
  '"Best Rate Over Time" replaces the old "Rate Trend Over Time" title'
);
// v55.82-M added ~3K of new code (active-window logic, carry-forward,
// click handler, dot renderer) between the upstream trendRates filter
// and the chart title, so we widen the upstream window from 9000 → 13000.
var chartSlice = chartIdx > 0 ? tabSrc.slice(Math.max(0, chartIdx - 13000), chartIdx + 10000) : '';

// 2a — v55.82-M: X-axis driven by EFFECTIVE date timeline (Max May 12 2026
//      respec). The old C-build expiry anchor is superseded.
ok('2a: v55.82-M — trendRates filter still uses expiry/effective fallback for the period filter (input narrowing)',
  /\(r\.expiry_date \|\| r\.effective_date \|\| ''\) >= rateHistoryDf/.test(chartSlice)
  && /\(r\.expiry_date \|\| r\.effective_date \|\| ''\) <= rateHistoryDt/.test(chartSlice),
  'period filter still uses either-or anchor — narrows input rows'
);

// 2b — v55.82-M: months timeline now built from earliest effective_date
ok('2b: v55.82-M — months timeline starts at earliest effective_date',
  /r\.effective_date\.substring\(0,7\)/.test(chartSlice) &&
  /firstMonth = validRatesForChart\.reduce/.test(chartSlice),
  'chart X-axis = effective-date timeline per Max May 12 spec'
);

// 2c — REGRESSION GUARD: chart should no longer build monthsSet from expiry_date
ok('2c: REGRESSION GUARD — chart no longer buckets months from expiry_date',
  !/monthsSet[\s\S]{0,400}r\.expiry_date \|\| ''\)\.substring\(0,7\)/.test(chartSlice),
  'expiry-bucket approach removed in v55.82-M'
);

// 3a — v55.82-M: per-line aggregation uses reduce() picking lowest (best = lowest), not Math.min.apply
ok('3a: v55.82-M — per-shipping-line winner picked via reduce() lowest',
  /winner = activeForLine\.reduce[\s\S]{0,300}Number\(r\.rate_amount\) < Number\(acc\.rate_amount\) \? r : acc/.test(chartSlice),
  'aggregate is "best = lowest" but uses reduce so we can carry the winning row id'
);

// 3b — overall (market-best) line uses same reduce + dataKey "_best"
ok('3b: market-floor line uses reduce-min and dataKey "_best"',
  /bestRow = activeInMonth\.reduce/.test(chartSlice)
  && /dataKey="_best"/.test(chartSlice)
);

// 3c — REGRESSION GUARD: no avg/sum across multiple rates remains
ok('3c: REGRESSION GUARD — chart no longer averages rates per period',
  !/point\[L\] = Math\.round\(sum \/ ratesForLine\.length\)/.test(chartSlice)
  && !/point\._avg = /.test(chartSlice),
  'avg-based aggregation must be gone'
);

// 3d — period-over-period banner also uses BEST not AVG
//      v55.82-M: period-over-period code uses Math.min.apply for the
//      pure trendRates input (still the same upstream block). Accept
//      either old Math.min.apply or new reduce-based pickers as long
//      as the "best price" framing is intact.
ok('3d: period-over-period uses best (lowest) price logic',
  (/currentBest = Math\.min\.apply/.test(chartSlice) || /currentBest = .+reduce/.test(chartSlice))
  && (/priorBest = Math\.min\.apply/.test(chartSlice) || /priorBest = .+reduce/.test(chartSlice))
  && /Period-over-period \(best price\)/.test(chartSlice)
);

// 4a — booking stars layer present with Scatter
ok('4a: chart renders <Scatter name="Bookings" /> for booking stars',
  /<Scatter[\s\S]{0,200}name="Bookings"[\s\S]{0,200}data=\{bookingStars\}/.test(chartSlice)
);

// 4b — bookingStars built from booked rows with proper (booking_date, rate) coords
ok('4b: bookingStars are built from r.booked rows, anchored to booking_date',
  /bookingStars = trendRatesForChart[\s\S]{0,400}\.filter\(function\(r\) \{[\s\S]{0,400}if \(!r\.booked\) return false/.test(chartSlice)
  && /booking_date \|\| r\.effective_date \|\| ''/.test(chartSlice)
);

// 4c — uses ComposedChart not LineChart (so Scatter and Line can coexist)
ok('4c: chart uses ComposedChart (not LineChart) so stars + lines coexist',
  /<ComposedChart data=\{trendPoints\}/.test(chartSlice)
);

// 4d — custom 5-point star shape is defined and used
ok('4d: 5-point StarShape function defined and passed to Scatter',
  /var StarShape = function\(props\)/.test(chartSlice)
  && /shape=\{StarShape\}/.test(chartSlice)
);

// 4e — booking-month is added to trendPoints if it isn't already a category
//      v55.82-M: same forEach, just uses .indexOf instead of .includes for
//      old-runtime safety. Accept either.
ok('4e: booking months are added to trendPoints if missing (so Scatter renders)',
  /bookingStars\.forEach\(function\(b\) \{[\s\S]{0,400}if \(months\.indexOf\(b\.month\) < 0\)/.test(chartSlice)
  || /bookingStars\.forEach\(function\(b\) \{[\s\S]{0,300}if \(!months\.includes\(b\.month\)\)/.test(chartSlice)
);

// 5a — v55.82-M: validRatesForChart filters effective_date + rate > 0 now
ok('5a: v55.82-M — validRatesForChart filters out rate <= 0 AND missing effective_date',
  /validRatesForChart = trendRatesForChart\.filter\(function\(r\) \{[\s\S]{0,300}eff\.length >= 10 && amt > 0/.test(chartSlice),
  'empty/zero rate fields safe — no NaN on chart'
);

// 5b — bookingStars filter rejects empty booking_date AND rate=0
ok('5b: bookingStars filter rejects empty booking_date AND rate=0',
  /bookingStars = trendRatesForChart[\s\S]{0,800}bd\.length >= 7 && amt > 0/.test(chartSlice)
);

// 5c — StarShape returns null on NaN cx/cy (defensive)
ok('5c: StarShape returns null on NaN cx/cy',
  /if \(cx == null \|\| cy == null \|\| isNaN\(cx\) \|\| isNaN\(cy\)\) return null/.test(chartSlice)
);

// 5d — v55.82-M: reduce-based winner picks naturally guard against empty
//      input (the if (activeForLine.length > 0) check stays in place).
ok('5d: v55.82-M — winner-pick guarded by activeForLine.length > 0',
  /if \(activeForLine\.length > 0\) \{[\s\S]{0,400}winner = activeForLine\.reduce/.test(chartSlice)
);

// 5e — empty-state message describes the new effective-date requirement
ok('5e: v55.82-M — empty-state message points at missing effective dates',
  /No rate data with effective dates in the selected period/.test(chartSlice)
);

// 5f — header sub-line explains the new effective-date axis + click affordance
ok('5f: v55.82-M — chart header explains effective-date timeline + click rule',
  /effective-date timeline/.test(chartSlice) && /⭐ = booking/.test(chartSlice)
  && /click any point/.test(chartSlice)
);

// 5g — footer counter shows booking count
ok('5g: chart footer shows booking-star count when > 0',
  /\{bookingStars\.length\} booking/.test(chartSlice)
);

// =====================================================================
// FIX #6 — Migration for the new column
// =====================================================================

ok('6a: migration file v55.82-c-shipping-other-fees-desc.sql exists',
  fs.existsSync(path.join(migrationsDir, 'v55.82-c-shipping-other-fees-desc.sql'))
);

ok('6b: migration uses ADD COLUMN IF NOT EXISTS (idempotent)',
  (function() {
    var p = path.join(migrationsDir, 'v55.82-c-shipping-other-fees-desc.sql');
    if (!fs.existsSync(p)) return false;
    var sql = fs.readFileSync(p, 'utf8');
    return /ADD COLUMN IF NOT EXISTS other_fees_desc TEXT/.test(sql);
  })(),
  'migration must be safe to re-run'
);

// =====================================================================
// Recharts import sanity
// =====================================================================

ok('imports: ComposedChart and Scatter imported from recharts',
  /import \{[^}]*ComposedChart[^}]*\} from 'recharts'/.test(tabSrc)
  && /import \{[^}]*Scatter[^}]*\} from 'recharts'/.test(tabSrc)
);

// =====================================================================
// Final
// =====================================================================

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' test' + (failures.length === 1 ? '' : 's') + ' failed:');
  failures.forEach(function(f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.82-C shipping import + chart fix tests passed');
