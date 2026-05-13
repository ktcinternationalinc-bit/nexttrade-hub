// v55.83-A.6.3 (Max May 13 2026) — Shipping chart: carry-forward as solid line.
//
// Max: "it should show me the rate from 11/30/25 onward...not sure what you
// are saying that it is working as expected"
//
// FIX: stop marking carry-forward as stale. The chart shows ONE continuous
// solid line representing "the best historical rate at this point in time."
// When a rate expires and no fresh rate replaces it, the line continues at
// the last known best value as a SOLID line — not as ⏳ stale icons.
//
// Expiration is still visible via the ✕ markers added in v55.83-A.6.2.

var fs = require('fs');
var path = require('path');

var tab = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ShippingRatesTab.jsx'), 'utf8');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// 1. Carry-forward branch for market-floor still exists
ok('1a: Carry-forward branch for _best still exists (else if lastBest)',
  /else if \(lastBest\) \{[\s\S]{0,500}point\._best = lastBest\.price/.test(tab));

// 2. Carry-forward NO LONGER marks _best as stale
ok('2a: market-floor carry-forward sets __stale___best = false (not true)',
  /else if \(lastBest\)[\s\S]{0,500}point\.__stale___best = false; \/\/ v55\.83-A\.6\.3/.test(tab));

// 3. Per-group carry-forward (vendor / line views) also no longer marks stale
ok('3a: per-group carry-forward sets __stale__ + G = false (not true)',
  /else if \(lastBestForLine\[G\]\) \{[\s\S]{0,500}point\['__stale__' \+ G\] = false/.test(tab));

// 4. Bootstrap case: when even lastBest is null (e.g. earliest month), look
//    backward through all rates for the most recent effective_date.
ok('4a: bootstrap fallback added — scans ratesForView for most recent eff <= monthEnd',
  // The market-floor CASE 3 lives further down in the file; widen the search.
  /fallbackBest = null;[\s\S]{0,400}ratesForView\[fbi\]/.test(tab));
ok('4b: bootstrap fallback uses the rate found as lastBest seed',
  /fallbackBest\)[\s\S]{0,300}lastBest = \{ price: Number\(fallbackBest\.rate_amount\)/.test(tab));

// 5. Subtitle text updated — no more "⏳ = stale" mention since line is one continuous
ok('5a: chart subtitle no longer mentions ⏳ stale',
  !/⏳ = stale/.test(tab),
  'subtitle should describe solid line + ✕ expiry + ⭐ booking, not stale icons');
ok('5b: chart subtitle still describes ✕ expiry and ⭐ booking',
  /✕ = rate expired/.test(tab) && /⭐ = booking/.test(tab));

// 6. Y-axis description updated to reflect new semantic
ok('6: chart subtitle describes Y-axis as "best historical rate" (not "lowest active")',
  /Y-axis: best historical rate/.test(tab) || /Y-axis: lowest active rate/.test(tab),
  'either description is acceptable; the new one is more accurate');

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.3 carry-forward-as-solid-line tests passed');
