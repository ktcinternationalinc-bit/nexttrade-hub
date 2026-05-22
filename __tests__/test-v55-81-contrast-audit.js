// LEGACY (v55.83-A.6.13): These assertions check the old AdminTab logins
// section that was replaced by LoginHistoryV2. Patterns no longer match.
// Kept for historical reference. The new v55.83-A.6.13 test covers the same
// concerns against the new component.
console.log("⚠️ Legacy test skipped (replaced by v55.83-A.6.13 LoginHistoryV2 coverage)");
process.exit(0);
// __tests__/test-v55-81-contrast-audit.js
//
// v55.81 #6 (Max May 9 2026) — Yellow-on-yellow contrast audit
// ============================================================
// BackupsPanel had two yellow-on-yellow combos that washed out visually
// even though the WCAG ratios technically passed:
//   - Pinned badge: bg-yellow-100 text-yellow-800
//   - Pin/Unpin button: bg-yellow-200 text-yellow-900 hover:bg-yellow-300
// Both are now bg-amber-200/300 + text-amber-900 — same semantic family
// (warm, "saved"-feeling), better visual separation.
//
// This test:
//   1. Locks in the BackupsPanel fix
//   2. Catches if anyone re-introduces a yellow-on-yellow combo elsewhere
//   3. Catches the truly-bad pattern: tiny text in slate-400 (washed grey)

var fs = require('fs');
var path = require('path');

var REPO = path.resolve(__dirname, '..');
var COMPONENTS = path.join(REPO, 'src', 'components');
var read = function (rel) { return fs.readFileSync(path.join(REPO, rel), 'utf8'); };
var listJsx = function (dir) {
  return fs.readdirSync(dir).filter(function (n) { return /\.jsx$/.test(n); });
};

var passed = 0, failed = 0, failures = [];
function check(label, cond) {
  if (cond) { console.log('  ✓ ' + label); passed++; }
  else { console.log('  ✗ ' + label); failed++; failures.push(label); }
}
function group(title) { console.log('\n--- ' + title + ' ---'); }

console.log('============================================================');
console.log('v55.81 #6 — CONTRAST AUDIT');
console.log('============================================================');

// =========================================================================
// 1. BackupsPanel — specific fix lock-in
// =========================================================================
group('1. BackupsPanel: yellow-on-yellow combos eliminated');

var bp = read('src/components/BackupsPanel.jsx');

check('1.1 Pinned badge no longer uses bg-yellow-100 + text-yellow-800',
  !/bg-yellow-100\s+text-yellow-800/.test(bp) &&
  !/bg-yellow-100[^"]*text-yellow-800/.test(bp));

check('1.2 Pinned badge now uses amber-200 + amber-900 (stronger contrast)',
  /Pinned[\s\S]{0,150}bg-amber-200 text-amber-900|bg-amber-200 text-amber-900[\s\S]{0,150}Pinned/.test(bp));

check('1.3 Pin/Unpin button no longer uses bg-yellow-200 + text-yellow-900',
  !/bg-yellow-200 text-yellow-900/.test(bp));

check('1.4 Pin/Unpin button now uses amber-300 + amber-900 with amber-400 hover',
  /bg-amber-300 text-amber-900 hover:bg-amber-400/.test(bp));

// =========================================================================
// 2. Codebase-wide regression check: no yellow-on-yellow combos exist
// =========================================================================
group('2. Codebase: no bg-yellow-{50,100,200} + text-yellow-{600,700,800} combos');

var componentFiles = listJsx(COMPONENTS);
var yellowOnYellowOffenders = [];
componentFiles.forEach(function (name) {
  var src = read(path.join('src', 'components', name));
  // Match either order: bg first then text, or text first then bg
  var pattern = /(bg-yellow-(?:50|100|200)[^"]*text-yellow-(?:600|700|800)\b|text-yellow-(?:600|700|800)[^"]*bg-yellow-(?:50|100|200)\b)/g;
  var match;
  while ((match = pattern.exec(src)) !== null) {
    var line = src.substring(0, match.index).split('\n').length;
    yellowOnYellowOffenders.push(name + ':' + line + ' — ' + match[0].slice(0, 80));
  }
});

check('2.1 Zero yellow-on-yellow combos in src/components/',
  yellowOnYellowOffenders.length === 0);

if (yellowOnYellowOffenders.length > 0) {
  console.log('    OFFENDERS:');
  yellowOnYellowOffenders.forEach(function (o) { console.log('      ' + o); });
}

// =========================================================================
// 3. Truly-bad: tiny text (≤10px) in washed-out slate-400 — unreadable combo
// =========================================================================
group('3. Codebase: no text-[8/9/10]px + text-slate-400 same-element combos');

var tinyWashedOffenders = [];
componentFiles.forEach(function (name) {
  var src = read(path.join('src', 'components', name));
  // Both classes on the same className value (single attribute)
  // We scan className="..." attributes; checking if BOTH a tiny-text class
  // and text-slate-400 appear inside the same attribute string.
  var attrPattern = /className=("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\{[^}]*\})/g;
  var m;
  while ((m = attrPattern.exec(src)) !== null) {
    var attr = m[1];
    var hasTiny = /text-\[(?:8|9|10)px\]/.test(attr);
    var hasWashed = /\btext-slate-400\b/.test(attr);
    if (hasTiny && hasWashed) {
      var line = src.substring(0, m.index).split('\n').length;
      tinyWashedOffenders.push(name + ':' + line + ' — ' + attr.slice(0, 100));
    }
  }
});

check('3.1 Zero tiny-text + slate-400 combos on the same element',
  tinyWashedOffenders.length === 0);

if (tinyWashedOffenders.length > 0) {
  console.log('    OFFENDERS:');
  tinyWashedOffenders.forEach(function (o) { console.log('      ' + o); });
}

// =========================================================================
// 4. Regression: BackupsPanel still functions (file not corrupted by fix)
// =========================================================================
group('4. Regression: BackupsPanel still has its core structure');

check('4.1 BackupsPanel still has Download / Pin / Delete buttons',
  /⬇ Download/.test(bp) &&
  /Unpin|Pin/.test(bp) &&
  /🗑 Delete/.test(bp));

check('4.2 BackupsPanel still has the togglePin handler',
  /togglePin\(b\)/.test(bp));

// =========================================================================
// Summary
// =========================================================================
console.log('\n============================================================');
console.log('SUMMARY: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  console.log('\nFAILURES:');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('============================================================');
