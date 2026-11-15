// v55.83-MZ — Treasury currency toggle.
//
// Max (Aug 11 2026): "when we have USD enter ... there also needs to be a bucket
// that tracks cash USD or EUR or whatever case IN and OUT. Default is showing
// EGP but there should be toggle that shows the OTHER CURRENCIES THE IN AND OUT
// AND NET ON DEMAND AND SHOW IT CLEARLY AND ALSO SHOW THE SPECIFIC TRANSACTIONS
// THAT MAKE UP THOSE VALUES IN THOSE 3 BUCKETS. AND ... a way to toggle and see
// the balance of the other currencies."
//
// THE DANGEROUS REGRESSION THIS FILE GUARDS
// Currencies must never be summed together. There is no FX conversion in the
// Treasury tab, so adding usd_in to cash_in would produce a number that looks
// authoritative and means nothing. Every assertion below exists to keep each
// currency sealed in its own bucket.
//
// Data shapes in the treasury table:
//   EGP   -> cash_in / cash_out
//   USD   -> usd_in / usd_out
//   other -> foreign_amount + foreign_currency + foreign_direction

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// Strip comments so prose explaining a rule can't satisfy a check about code.
var code = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ══════════════════════════════════════════════════════════════════
// PART A — Default is EGP (Max: "Default is showing EGP")
// ══════════════════════════════════════════════════════════════════

ok('A1: a currency view state exists',
  /const \[treasuryCurrency, setTreasuryCurrency\] = useState\(/.test(code));
ok('A2: it DEFAULTS TO EGP',
  /const \[treasuryCurrency, setTreasuryCurrency\] = useState\('EGP'\)/.test(code));
ok('A3: it is session-only — a stale toggle must not mislabel money on next visit',
  !/localStorage[\s\S]{0,120}treasuryCurrency/.test(code) &&
  !/treasuryCurrency[\s\S]{0,120}localStorage/.test(code));

// ══════════════════════════════════════════════════════════════════
// PART B — Currencies stay sealed (no silent FX)
// ══════════════════════════════════════════════════════════════════

ok('B1: EGP reads cash_in/cash_out only',
  /if \(cur === 'EGP'\)[\s\S]{0,160}cash_in[\s\S]{0,80}cash_out/.test(code));
ok('B2: USD reads usd_in/usd_out only',
  /if \(cur === 'USD'\)[\s\S]{0,160}usd_in[\s\S]{0,80}usd_out/.test(code));
ok('B3: other currencies read foreign_amount + foreign_direction',
  /foreign_currency === cur[\s\S]{0,240}foreign_direction === 'out'/.test(code));
ok('B4: a row with nothing in the active currency contributes zero',
  /return \{ in: 0, out: 0 \};/.test(code));
ok('B5: totals never add usd_in to cash_in (the cardinal sin)',
  !/cash_in[^\n]{0,60}\+[^\n]{0,20}usd_in/.test(code) &&
  !/usd_in[^\n]{0,60}\+[^\n]{0,20}cash_in/.test(code));
ok('B6: no FX rate is applied anywhere in the currency maths',
  !/currencyTotals[\s\S]{0,600}(fx_rate|exchange_rate|\* rate)/.test(code));
ok('B7: the no-conversion rule is written down for whoever edits this next',
  /never summed together|no FX conversion|not converted/i.test(page));

// ══════════════════════════════════════════════════════════════════
// PART C — The three buckets follow the toggle
// ══════════════════════════════════════════════════════════════════

ok('C1: totals are computed per selected currency',
  /const currencyTotals = useMemo/.test(code));
ok('C2: net is derived from that currency\'s own in and out',
  /net: cin - cout/.test(code));
ok('C3: the In card shows the currency total, not the EGP total',
  /\{fCur\(currencyTotals\.in\)\}/.test(code));
ok('C4: the Out card shows the currency total',
  /\{fCur\(currencyTotals\.out\)\}/.test(code));
ok('C5: the Net card shows the currency total',
  /\{fCur\(currencyTotals\.net\)\}/.test(code));
ok('C6: card labels name the active currency so a screenshot is never ambiguous',
  /\{treasuryCurrency\} In \/ وارد/.test(code) &&
  /\{treasuryCurrency\} Out \/ منصرف/.test(code) &&
  /\{treasuryCurrency\} Net \/ صافي/.test(code));
ok('C7: the net card colour follows the currency net, not the EGP net',
  /background: currencyTotals\.net >= 0/.test(code));
ok('C8: the progress bar uses currency figures too (no EGP leak)',
  /currencyTotals\.net \/ currencyTotals\.in \* 100/.test(code));

// ══════════════════════════════════════════════════════════════════
// PART D — "Show the specific transactions that make up those values"
// ══════════════════════════════════════════════════════════════════

ok('D1: the backing transaction list is computed',
  /const currencyTxns = useMemo/.test(code));
ok('D2: it only includes rows holding money in that currency',
  /return a\.in > 0 \|\| a\.out > 0;/.test(code));
ok('D3: the list is rendered for non-EGP views',
  /\{treasuryCurrency !== 'EGP' && \([\s\S]{0,600}transactions \(\{currencyTxns\.length\}\)/.test(page));
ok('D4: clicking a bucket narrows the list to In or Out',
  /treasuryDrill === 'in' \? a\.in > 0 : a\.out > 0/.test(code));
ok('D5: there is a way back to the unfiltered list',
  /Show all \{treasuryCurrency\}/.test(code));
ok('D6: the list carries its own totals row that matches the cards',
  /Total \{treasuryCurrency\}/.test(code));
ok('D7: switching currency clears any active drill (stale In/Out filter)',
  /setTreasuryCurrency\(cur\); setTreasuryDrill\(null\)/.test(code));

// ══════════════════════════════════════════════════════════════════
// PART E — Balance in other currencies
// ══════════════════════════════════════════════════════════════════

ok('E1: a per-currency running balance exists',
  /const currencyBalanceMap = useMemo/.test(code));
ok('E2: EGP still uses the original balance map (no behaviour change)',
  /if \(treasuryCurrency === 'EGP'\) return treasuryBalanceMap;/.test(code));
ok('E3: rows with no movement in that currency do not carry the balance forward',
  /if \(a\.in === 0 && a\.out === 0\) return; /.test(code));
ok('E4: balance accumulates from the FULL set, so date filters do not rewrite history',
  /const sorted = \[\.\.\.treasury\]\.sort[\s\S]{0,400}currencyAmounts\(t, treasuryCurrency\)/.test(code));
ok('E5: the main table balance column follows the toggle',
  /currencyBalanceMap\[txn\.id\]/.test(code) &&
  !/fE\(treasuryBalanceMap\[txn\.id\] \|\| 0\)/.test(code));
ok('E6: a row with no balance shows a dash, not a repeated previous figure',
  /currencyBalanceMap\[txn\.id\] == null[\s\S]{0,200}—/.test(page));
ok('E7: the balance column header names the currency when it is not EGP',
  /Balance\{treasuryCurrency !== 'EGP' \? ' \(' \+ treasuryCurrency \+ '\)' : ''\}/.test(code));
ok('E8: bank rows are still excluded from the safe balance',
  /Bank row — not part of safe balance/.test(page));

// ══════════════════════════════════════════════════════════════════
// PART F — The toggle itself
// ══════════════════════════════════════════════════════════════════

ok('F1: available currencies are discovered from the data, not hard-coded',
  /const treasuryCurrencies = useMemo/.test(code) &&
  /found\[t\.foreign_currency\] = true/.test(code));
ok('F2: EGP is always offered and always first',
  /return \['EGP'\]\.concat\(/.test(code));
ok('F3: the switcher is hidden when there is only EGP money',
  /\{treasuryCurrencies\.length > 1 && \(/.test(code));
ok('F4: the active currency is marked for screen readers',
  /aria-pressed=\{active\}/.test(code));
ok('F5: a visible warning states the figures are not converted',
  /not converted to EGP/.test(page));
ok('F6: that warning is dark-on-light (PERMANENT RULE 8)',
  /background: '#fef3c7', color: '#1c1917'/.test(code));
ok('F7: a dedicated formatter is used — fE() is EGP-only',
  /const fCur = useCallback/.test(code));
ok('F8: unknown currencies still render readably (code suffix, no bare number)',
  /\(sym \? '' : ' ' \+ c\)/.test(code));

console.log('');
if (failures.length) {
  console.log('FAILED (' + failures.length + '):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
} else {
  console.log('ALL CHECKS PASSED — v55.83-MZ treasury currency toggle');
}
