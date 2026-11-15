// ============================================================
// Session 11 (Apr 22 2026) — AI Accountant smarter duplicate detection
//
// Problem: the old C3 detector fired 174 "critical" duplicate alerts, 72 of
// which were legitimate repeats (taxis, phone bills, small same-day expenses).
// That drowned the real signal (big bank deposit duplicates in 5-6 figures).
//
// Fix: split the single DUPLICATE_TREASURY finding into:
//   - DUPLICATE_TREASURY_HIGH (critical, >= 100k EGP)
//   - DUPLICATE_TREASURY_LOW (warning, < 100k EGP)
//   - suppress small (<5k) recurring-vendor patterns entirely (taxi, phone, etc.)
// ============================================================

var fs = require('fs');
var path = require('path');
var assert = require('assert');
var REPO = path.resolve(__dirname, '..');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('✓ ' + name); passed++; }
  catch (e) { console.log('✗ ' + name + ' — ' + e.message); failed++; }
}

var auditor = fs.readFileSync(path.join(REPO, 'src/lib/accounting-auditor.js'), 'utf8');

test('S11.1 Old single DUPLICATE_TREASURY code removed', function() {
  // The old single finding is replaced with _HIGH and _LOW variants.
  assert(!/code: 'DUPLICATE_TREASURY'[^_]/.test(auditor),
    'old DUPLICATE_TREASURY code must be gone — replaced with HIGH/LOW split');
});

test('S11.2 New DUPLICATE_TREASURY_HIGH code exists with critical severity', function() {
  assert(/code: 'DUPLICATE_TREASURY_HIGH'/.test(auditor),
    'DUPLICATE_TREASURY_HIGH code must exist');
  var block = auditor.match(/if \(highValueDupes\.length > 0\) \{[\s\S]*?\}\);[\s\S]*?\}/);
  assert(block, 'highValueDupes finding block found');
  assert(/severity: 'critical'/.test(block[0]), 'HIGH variant must be critical severity');
});

test('S11.3 New DUPLICATE_TREASURY_LOW code exists with warning severity', function() {
  assert(/code: 'DUPLICATE_TREASURY_LOW'/.test(auditor),
    'DUPLICATE_TREASURY_LOW code must exist');
  var block = auditor.match(/if \(otherDupes\.length > 0\) \{[\s\S]*?\}\);[\s\S]*?\}/);
  assert(block, 'otherDupes finding block found');
  assert(/severity: 'warning'/.test(block[0]), 'LOW variant must be warning severity, not critical');
});

test('S11.4 High/low split uses 100,000 EGP threshold', function() {
  assert(/HIGH_VALUE_THRESHOLD = 100000/.test(auditor),
    '100k EGP threshold constant must exist');
  assert(/d\.amount >= HIGH_VALUE_THRESHOLD/.test(auditor),
    'threshold comparison must be used to partition');
});

test('S11.5 Recurring-expense keyword list covers the common patterns', function() {
  // These showed up most often in Max's actual data as legitimate repeats
  var required = ['تاكس', 'مواصلات', 'بنزين', 'بصمه', 'عهده', 'تليفون', 'كهرباء', 'كشف', 'علاج', 'مساهمه تكافليه'];
  required.forEach(function(k) {
    assert(auditor.indexOf(k) >= 0, 'recurringKeywords must include ' + k);
  });
});

test('S11.6 Small-amount threshold for keyword suppression is 5,000 EGP', function() {
  assert(/d\.amount >= 5000/.test(auditor),
    '5000 EGP threshold must be present for recurring-expense suppression');
  assert(/if \(d\.amount >= 5000\) return false/.test(auditor),
    'suppression must only apply below 5k EGP');
});

test('S11.7 isRecurringSmallExpense helper is defined and used', function() {
  assert(/function isRecurringSmallExpense\(d\)/.test(auditor),
    'helper function must exist');
  assert(/if \(isRecurringSmallExpense\(dupes\[fd\]\)\)/.test(auditor),
    'helper must be used in the filter loop');
});

test('S11.8 Suppressed count is surfaced in the LOW finding description', function() {
  assert(/suppressedCount > 0/.test(auditor),
    'suppressedCount must be tracked');
  assert(/suppressed as likely legitimate/.test(auditor),
    'suppress note must appear in the English title');
});

test('S11.9 Both findings preserve the bilingual AR titles', function() {
  assert(/titleAr: highValueDupes\.length/.test(auditor),
    'HIGH finding must have Arabic title');
  assert(/titleAr: otherDupes\.length/.test(auditor),
    'LOW finding must have Arabic title');
});

test('S11.10 Action text points user to the right place', function() {
  // actionEn appears for both HIGH and LOW variants with correct guidance
  assert(/master treasury Excel/.test(auditor),
    'HIGH variant must tell user to compare against master Excel');
  assert(/Review in Treasury tab/.test(auditor),
    'LOW variant must point user to Treasury tab for review');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
