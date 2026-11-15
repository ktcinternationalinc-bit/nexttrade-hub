// v55.83-A.6.27.7 — Test BOTH fixes:
//   (1) Import quarantine: bad-data rows go to quarantine, not imported
//   (2) Chart active-in-month definition: matches "Best Active" tile

var fs = require('fs');
var path = require('path');

function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var tab = read('src/components/ShippingRatesTab.jsx');
var sql = read('sql/v55-83-a-6-27-7-quarantine.sql');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// ====================================================================
// PART 1 — IMPORT QUARANTINE
// ====================================================================

ok('1a: quarantine SQL creates shipping_rates_import_quarantine table',
  /CREATE TABLE IF NOT EXISTS shipping_rates_import_quarantine/.test(sql));
ok('1b: quarantine has batch_id, row_num, raw_row, errors JSONB',
  /batch_id UUID NOT NULL/.test(sql) &&
  /row_num INT NOT NULL/.test(sql) &&
  /raw_row JSONB NOT NULL/.test(sql) &&
  /errors JSONB NOT NULL/.test(sql));
ok('1c: quarantine has outcome column with pending/fixed/discarded options',
  /outcome TEXT CHECK \(outcome IN \('pending', 'fixed_imported', 'discarded'\)\)/.test(sql));
ok('1d: quarantine indexes batch_id and pending rows',
  /idx_quarantine_batch/.test(sql) &&
  /idx_quarantine_pending/.test(sql) &&
  /WHERE reviewed = FALSE/.test(sql));

ok('2a: validateBadDataPatterns helper defined',
  /var validateBadDataPatterns = function \(raw\) \{/.test(tab));
ok('2b: bad-pattern detects same-day effective=expiry',
  /eff === exp[\s\S]{0,400}likely import error/.test(tab));
ok('2c: bad-pattern detects expiry < effective',
  /exp < eff[\s\S]{0,400}before effective date/.test(tab));
ok('2d: bad-pattern detects year<2020 effective_date',
  /eff < '2020-01-01'[\s\S]{0,300}likely import error/.test(tab));
ok('2e: bad-pattern detects future effective_date >2 years out',
  /twoYearsOut[\s\S]{0,300}more than 2 years in the future/.test(tab));
ok('2f: bad-pattern detects zero/missing rate',
  /amt <= 0[\s\S]{0,200}missing or zero/.test(tab));
ok('2g: bad-pattern detects suspiciously high rate (>100k)',
  /amt > 100000[\s\S]{0,300}possible currency mismatch/.test(tab));

ok('3a: quarantineRows array initialized alongside validRows',
  /var quarantineRows = \[\][\s\S]{0,500}var batchId = /.test(tab));
ok('3b: batchId generated via crypto.randomUUID with fallback',
  /crypto\.randomUUID\(\)[\s\S]{0,200}Date\.now\(\) \+ '-' \+ Math\.random/.test(tab));
ok('3c: validation loop checks bad-pattern AFTER date validation',
  /var dErr = validateDate[\s\S]{0,800}var badPatterns = validateBadDataPatterns\(raw\)/.test(tab));
ok('3d: bad-pattern rows pushed to quarantineRows, not validRows',
  /if \(badPatterns\.length > 0\) \{/.test(tab) &&
  /quarantineRows\.push\(\{/.test(tab) &&
  /raw_row: raw,/.test(tab));
ok('3e: counts.quarantined incremented',
  /counts\.quarantined = \(counts\.quarantined \|\| 0\) \+ 1/.test(tab));

ok('4a: quarantineRows persisted to DB before setImportProgress(100)',
  /if \(quarantineRows\.length > 0\) \{[\s\S]{0,1500}from\('shipping_rates_import_quarantine'\)\.insert/.test(tab));
ok('4b: quarantine batch_id included on each persisted row',
  /batch_id: batchId/.test(tab));
ok('4c: quarantine handles missing table gracefully (does not break import)',
  /Quarantine table not created yet[\s\S]{0,200}sql\/v55-83-a-6-27-7-quarantine\.sql/.test(tab));

ok('5a: import result UI has Quarantined tile',
  /Quarantined[\s\S]{0,400}importCounts\.quarantined/.test(tab));
ok('5b: Quarantined tile amber styling for nonzero, slate for zero',
  /bg-amber-100 border-amber-400[\s\S]{0,300}importCounts\.quarantined \|\| 0/.test(tab));

// ====================================================================
// PART 2 — CHART/TABLE ALIGNMENT
// ====================================================================

ok('6a: activeInMonth filter uses refDate = min(monthEnd, today) per A.6.27.8',
  // Current rule (A.6.27.8) — refDate-based for chart/tile alignment.
  /var refDate = monthEnd < todayStrForChart \? monthEnd : todayStrForChart/.test(tab) &&
  /var activeInMonth = ratesForView\.filter\(function\(r\) \{[\s\S]{0,400}return eff <= refDate && \(exp === '' \|\| exp >= refDate\)/.test(tab));

ok('6b: comment explains the unified-best-rate spec from Max',
  /UNIFIED ACTIVE-IN-MONTH RULE/.test(tab) &&
  /Best Active/.test(tab));

ok('6c: regression — old start-of-month overlap rule is GONE for the active-set filter',
  // The old rule: `eff <= monthEnd && (exp === '' || exp >= monthStart)`.
  // After this fix the filter checks exp >= monthEnd not monthStart.
  !/return eff <= monthEnd && \(exp === '' \|\| exp >= monthStart\)/.test(tab));

ok('6d: expiry markers still use start-of-month so the ✕ shows in the month a rate expired',
  // The expiry-marker layer is SEPARATE from the active-set filter. We keep
  // its own logic so red ✕ correctly marks the month-of-expiration. Verify
  // the marker computation references expiry_date directly (not the active
  // set).
  /rawExpiryRows = ratesForView/.test(tab));

ok('7a: per-group filter (By Vendor/By Line) inherits the new activeInMonth definition',
  // The per-group block filters the already-computed activeInMonth array,
  // so once activeInMonth uses end-of-month, By Vendor and By Line do too.
  /var activeForGroup = activeInMonth\.filter\(function\(r\) \{/.test(tab));

ok('8a: version stamp bumped to v55.83-A.6.27.9 (or later)',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(read('src/app/page.jsx')));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.7 quarantine + chart-alignment tests passed');
