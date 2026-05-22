# Shipping Rate History Chart — Gap Review (v55.83-A.6.2)

Date: May 13, 2026
Trigger: Max screenshot showing chart with 14 rates / 10 active for USA→ALGERIA
where the line was visibly broken (empty 2025-11, stale icons 2026-01→03,
real curve only 2026-03→05).

This is a deep code review of the chart pipeline, end-to-end, with each
identified gap classified by severity.

---

## CRITICAL bugs (could explain Max's broken chart)

### BUG #1 — routeHistory uses strict string equality on origin/destination
**File:** src/components/ShippingRatesTab.jsx line 626-627
```js
if (selectedRoute.origin && r.origin !== selectedRoute.origin) return false;
if (selectedRoute.destination && r.destination !== selectedRoute.destination) return false;
```
**Issue:** Case-sensitive, whitespace-sensitive, alias-blind. If route is
"USA" but some rates have origin = "Usa", " USA " (trailing space), or
"United States", those rates get DROPPED from the chart entirely — but
they still count toward the "14 rates" total in the header (because that
count is based on a fuzzier match earlier in the route-card aggregation).

**Smoking gun match for Max's screenshot:** the header says 14 rates / 10 active
but the chart only renders a fraction. The strict equality filter is the
prime suspect.

**Fix:** Normalize both sides with `.trim().toLowerCase()` before compare.

### BUG #2 — port_of_loading / port_of_discharge same problem
**File:** same, lines 628-629
**Issue:** Strict equality on `pol` / `pod` too. If route was discovered
via one port pairing but some rates have null POL/POD, they're filtered
out even though they belong to the same origin→destination.

### BUG #3 — selectedRoute carries POL/POD that may not match historical entries
**Likely scenario:** When the user clicks a route card to drill in, the
card was aggregated by origin+destination+pol+pod. But many historical
rates may have NULL pol or NULL pod. selectedRoute.pol = "Houston" but
half the rates have pol = null or pol = "HOUSTON" — both excluded.

### BUG #4 — currency filter cascades silently
**File:** line 2139
```js
var trendRatesForChart = trendRates.filter(r => (r.currency || 'USD') === chartCurrency);
```
**Issue:** chartCurrency is picked by most-common; minority-currency rates
silently vanish from chart even when they're in the data. If route has
USD = 10 rates, EUR = 4 rates, the chart drops the 4 EUR rates entirely
unless user clicks the EUR tab. We added the currency tab in v55.83-A.6
which mitigates but doesn't fully fix this — a user landing on the chart
just sees "10 of 14" silently.

### BUG #5 — effective_date may be null on imported rates
**File:** line 2259-2263
```js
var validRatesForChart = trendRatesForChart.filter(function(r) {
  var eff = r.effective_date || '';
  var amt = Number(r.rate_amount || 0);
  return eff.length >= 10 && amt > 0;
});
```
**Issue:** A rate with `effective_date = null` or `''` is silently
excluded. The user sees no warning. If half the rates were imported
without effective_dates, half the chart data vanishes.

### BUG #6 — Date filter assumes ISO YYYY-MM-DD strings
**File:** line 2151-2160
```js
if (fwTo && eff && eff > fwTo) return false;
if (fwFrom && exp && exp < fwFrom) return false;
```
**Issue:** String comparison only works for ISO format. If any rate was
stored with a different date format (e.g., "11/15/2025" or
"2025-11-15T00:00:00.000Z" — different ISO form), the comparison breaks
silently and either drops rates that should be in OR keeps rates that
shouldn't.

### BUG #7 — Dot renderer paints stale icons even when the line is undefined
**File:** line 2523-2542
**Issue:** Recharts calls dot renderer for every X-axis category even
when the value is undefined. The renderer checks staleFlag separately
from value-presence. If `point._best === undefined` but
`point.__stale___best === undefined` too (no carry-forward yet), it
falls through to "fresh dot" — but at coordinates that may not make
sense. Not the trigger for Max's bug but a UX edge case.

---

## CORRECTNESS gaps (may distort the displayed line)

### GAP #1 — Carry-forward across month boundaries assumes inclusive expiry
**File:** line 2370-2374
```js
return eff <= monthEnd && (exp === '' || exp >= monthStart);
```
**Issue:** If expiry_date = "2025-11-30" and monthStart = "2025-12-01",
`expiry >= monthStart` is false. So the rate is NOT active in December,
even though it expired at the END of November. Correct mathematically.
But semantically: a rate active "through Nov 30" might be considered
applicable to Dec 1 negotiations because of grace periods. Edge case;
not a bug, just a design choice worth verifying.

### GAP #2 — Tomorrow's rates are excluded from "today"
**Issue:** A rate with effective_date = tomorrow shows on the chart's
"future" but not in "today's best rate" sidebar. This is correct but
worth surfacing to the user.

### GAP #3 — Multiple rates with same effective_date and same vendor are not deduped
**Issue:** If two MAERSK rates were imported both with eff = 2026-05-13,
both show up as separate data points. The chart picks the lower (correct)
but the table below shows both. Could be intentional (rate revisions).

### GAP #4 — Booking stars use rate.booking_date which can be null
**File:** line 2440-2455
**Issue:** If booking_date is null, falls back to effective_date. That
makes the star appear at the rate effective month, not the booking month
— misleading. Should require booking_date or skip the booking star.

### GAP #5 — chartShippingLine 'scope' silently zeros the chart when the dropdown selection has no matches
**Issue:** If user picks "MAERSK" in scope dropdown but the current
currency tab has zero MAERSK rates, the chart goes empty silently. No
"0 rates in this scope" message.

---

## UX gaps (Max-explicit issues)

### UX #1 — No indication WHY a month has no data
**Issue:** Max screenshot: 2025-11 is blank. No tooltip, no caption
explaining why. The diagnostic table I added in v55.83-A.6.1 helps but
it's hidden behind a click. Should always show a sub-line: "First active
month: 2025-12 (no rates active in 2025-11 despite first effective_date
being there)."

### UX #2 — "Best Active $3,575" headline doesn't match chart
**Issue:** The card above the chart says "Best Active (USD) $3,575" but
the chart's lowest point is ~$3,000 in 2026-05. Either the chart shows
a value the card doesn't acknowledge, or the chart's lowest point is
NOT a real rate. The card uses `Math.min(...primaryActive.map(r=>r.rate_amount))`
on the whole active set; chart uses month-by-month winners. They should
agree at the latest month.

**Probable cause:** the card's `primaryActive` and the chart's
`ratesForView` apply different filters. Mismatch is a credibility bug.

### UX #3 — No expiry markers on the chart
**Max said explicitly:** "remember- expiration dates need to be on this
graph...that's part of the historical perspective."

The current chart shows when a rate is ACTIVE but NOT when it EXPIRED.
A buyer negotiating wants to see "this rate expired here, this new one
took over here." We need vertical reference lines or rate-row-shaped
markers at expiry_date for each significant rate. ⏳ icon at stale dots
indicates "no replacement yet" but doesn't show WHICH rate expired.

### UX #4 — Time-window defaults are confusing
**Issue:** Period buttons (1M/3M/6M/1Y/3Y/All/Custom) live BELOW the chart.
The screenshot shows "1 Year" selected — but the chart only spans 7
months (2025-11 → 2026-05). That's because the data filter is one thing
and the chart's auto-range is another. Should align: if "1 Year" is
selected, the X-axis should run 12 months from today regardless of where
data starts.

---

## DATA INTEGRITY gaps (root causes of broken charts)

### DI #1 — No DB constraint requiring effective_date
**Issue:** Schema allows `effective_date NULL`. Imports often skip the
field. Chart silently excludes nulls.

### DI #2 — No DB constraint requiring expiry > effective
**Issue:** Schema allows expiry_date < effective_date (a rate
"backwards in time"). Chart's "active in month" logic returns FALSE for
all months when this happens, hiding the rate completely.

### DI #3 — No DB normalization on origin/destination text
**Issue:** "USA" vs "Usa" vs "U.S.A." all distinct strings. No CHECK,
no trigger, no enum. Allows the routeHistory filter to miss rates.

### DI #4 — currency may be NULL
**Issue:** `currency` is nullable. Chart fallback assumes 'USD' but
that's a guess. If a rate is actually EUR but stored with NULL currency,
it gets bucketed as USD on the chart — incorrect.

---

## TEST gaps

### TEST #1 — No test verifies routeHistory filter handles case variants
### TEST #2 — No test verifies chart with mixed-currency data
### TEST #3 — No test verifies chart with null effective_date
### TEST #4 — No test verifies chart with expiry < effective
### TEST #5 — No test reproduces Max's exact scenario (14 rates / partial chart)

---

## v55.83-A.6.2 — Targeted fixes

Once SQL output confirms the actual data shape, I will:

1. **CRITICAL:** Fix routeHistory string-match to be case+whitespace-insensitive
2. **CRITICAL:** Show expiry markers on chart (Max's explicit ask)
3. **CRITICAL:** Reconcile "Best Active" card with chart's lowest point
4. **DATA INTEGRITY:** Surface data-quality warnings inline ("3 rates have null effective_date — not shown")
5. **UX:** Always show why a month has no data (sub-caption, not hidden behind details)
6. **TEST:** Add 5 regression tests covering each scenario above

Severity ordering: 1 → 2 → 3 → 4 → 5 → 6
