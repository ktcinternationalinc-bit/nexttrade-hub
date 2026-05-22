// __tests__/test-v55-80-shipping-import-historical.js
// =====================================================
// v55.80 PHASE-B+ — historical shipping rate import.
//
// Bugs being fixed:
//   1. parseDate silently returned '' when the date couldn't be parsed,
//      and the caller had `|| todayET()` — so unparseable historical
//      dates became "today" and the original date was lost.
//   2. parseDate used .toISOString().substring(0, 10) on Date objects
//      constructed from local-time strings, which causes off-by-one TZ
//      slide (Friday → Thursday in PST, etc.).
//   3. The MM/DD/YYYY vs DD/MM/YYYY ambiguity was punted to new Date()
//      which is locale-dependent and unreliable.
//   4. parseDate was duplicated inline in TWO places (processImportFile
//      and reparseFromMapping), so fixes only landed in one path.
//
// Run: node __tests__/test-v55-80-shipping-import-historical.js

var fs = require('fs');
var path = require('path');

var src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'shipping-import-helpers.js'), 'utf8');
var script = src
  .replace(/export\s+function\s+/g, 'function ')
  .replace(/export\s+\{[^}]*\}/g, '');
script += '\n;return { parseDate, parseNumberSmart, normalizeContainer };\n';
var lib = (new Function(script))();

var passed = 0;
var failed = 0;
function ok(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.error('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('\n=== shipping-import historical date tests ===\n');

function testDate(label, raw, expected) {
  var result = lib.parseDate({ d: raw }, 'd');
  ok(label + ' — input "' + raw + '" → ' + (expected || 'null'), result === expected, 'got: ' + result);
}

// ---- ISO format (YYYY-MM-DD) ----
testDate('ISO 1', '2024-10-05', '2024-10-05');
testDate('ISO 2', '2023-01-15', '2023-01-15');
testDate('ISO with slashes', '2024/10/05', '2024-10-05');
testDate('ISO 1-digit month', '2024-3-7', '2024-03-07');

// ---- US format (MM/DD/YYYY) ----
testDate('US 1', '10/5/2024', '2024-10-05');
testDate('US 2', '12/31/2023', '2023-12-31');
testDate('US 2-digit year', '10/5/24', '2024-10-05');
testDate('US clear DD/MM (day > 12)', '15/10/2024', '2024-10-15');

// ---- DD-MMM-YYYY ----
testDate('DD-MMM 1', '5-Oct-2024', '2024-10-05');
testDate('DD-MMM 2', '15-JAN-2023', '2023-01-15');
testDate('DD-Month-YYYY full month', '5-October-2024', '2024-10-05');
testDate('DD MMM YYYY space', '5 Oct 2024', '2024-10-05');

// ---- Long month format ----
testDate('Long format 1', 'October 5, 2024', '2024-10-05');
testDate('Long format 2', 'Jan 15 2023', '2023-01-15');

// ---- Excel serial ----
testDate('Excel serial 2024-09-01', 45536, '2024-09-01');
testDate('Excel serial 2023-01-01', 44927, '2023-01-01');

// ---- Excel serial as string ----
testDate('Excel serial string', '45536', '2024-09-01');

// ---- Date object ----
ok('Date object — local Sept 1 2024',
   lib.parseDate({ d: new Date(2024, 8, 1) }, 'd') === '2024-09-01');

// ---- Historical dates (the main fix) ----
testDate('Historical 2020', '2020-06-15', '2020-06-15');
testDate('Historical 2018', '03/04/2018', '2018-03-04');
testDate('Historical 5 years ago', '2019-12-31', '2019-12-31');

// ---- Invalid dates → null (NOT today) ----
ok('empty string → null', lib.parseDate({ d: '' }, 'd') === null);
ok('null → null', lib.parseDate({ d: null }, 'd') === null);
ok('undefined → null', lib.parseDate({ d: undefined }, 'd') === null);
ok('garbage → null', lib.parseDate({ d: 'not a date at all' }, 'd') === null);
ok('missing column → null', lib.parseDate({}, 'd') === null);
ok('null col arg → null', lib.parseDate({ d: '2024-01-01' }, null) === null);

// ---- Critical: never silently return today's date ----
var todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
ok('CRITICAL: empty input does NOT return today',
   lib.parseDate({ d: '' }, 'd') !== todayStr);
ok('CRITICAL: garbage does NOT return today',
   lib.parseDate({ d: 'xyz' }, 'd') !== todayStr);

// ---- Edge: Excel serial < 20000 (before 1955) is suspicious — treat as garbage ----
ok('Excel serial too small (< 20000) → fallback path',
   lib.parseDate({ d: 100 }, 'd') !== '1900-04-09'); // shouldn't be parsed as Excel serial

// ---- Boundary: Excel serial = 25569 is 1970-01-01 ----
ok('Just at Excel boundary low (20001)', typeof lib.parseDate({ d: 20001 }, 'd') === 'string');

// ---- Numeric string with garbage → null ----
testDate('rate-like string', '$2,500.00', null);  // not a date, shouldn't parse
testDate('phone-like string', '555-1234', null);  // not a date

// ---- Number parsing tests (regression) ----
ok('parseNumberSmart 1', lib.parseNumberSmart('$2,500.00') === 2500);
ok('parseNumberSmart 2', lib.parseNumberSmart('1.500,00') === 1500); // EU
ok('parseNumberSmart 3', lib.parseNumberSmart(2500) === 2500);
ok('parseNumberSmart NaN on empty', isNaN(lib.parseNumberSmart('')));
ok('parseNumberSmart NaN on garbage', isNaN(lib.parseNumberSmart('abc')));

// ---- Container normalizer ----
ok('container 20GP', lib.normalizeContainer('20GP') === "20' GP");
ok('container 40HC', lib.normalizeContainer('40HC') === "40' HC");
ok('container 40 HQ', lib.normalizeContainer('40 HQ') === "40' HC");
ok('container 45HC', lib.normalizeContainer('45HC') === "45' HC");
ok('container default empty', lib.normalizeContainer('') === '40ft');
ok('container default null', lib.normalizeContainer(null) === '40ft');

// ---- Code-level checks ----
var compSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ShippingRatesTab.jsx'), 'utf8');

ok('ShippingRatesTab imports shared helpers',
   /from ['"]\.\.\/lib\/shipping-import-helpers['"]/.test(compSrc));

// Critical regression check: no more silent || todayET() on parsedEffective.
// The pattern should be `parsedEffective || todayET()` — but ONLY ONCE
// per function (the explicit fallback after parseDate is called separately).
// We want to see: parsedEffective being assigned ONCE per function and
// the fallback being explicit, not buried in the assignment.
ok('No silent inline parseDate(...) || todayET() pattern',
   !/parseDate\([^)]+\) \|\| todayET\(\)/.test(compSrc),
   'parseDate result must be assigned to a named var first — no inline silent fallback');

ok('Warning logged when historical date fails to parse',
   /could not parse effective_date|could not parse expiry_date/.test(compSrc));

console.log('\n=== Results ===');
console.log('Passed: ' + passed + ' / ' + (passed + failed));
process.exit(failed > 0 ? 1 : 0);
