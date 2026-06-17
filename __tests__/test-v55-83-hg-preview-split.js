// ============================================================
// v55.83-HG — previewProportionalSplit() robustness + correctness.
//
// Codex QA caution (HE/HF pass): the shared previewProportionalSplit() helper assumed
// `rows` is always an array; a direct/test caller passing null/undefined would crash.
// HG normalizes rows up front. These tests lock both the normalization and the core
// proportional-split math (exact-sum: remainder goes to the last line).
//
// The helper is READ-ONLY (no DB / no mutation); it is the math the Stage A preview uses
// and that Stage B will reuse once the allocation rule is confirmed.
// ============================================================

var assert = require('assert');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// Load the real helper from source (CommonJS interop via a tiny shim isn't needed — the
// file uses `export {}`, so we read+eval the function body is overkill; instead re-require
// through a transpile-free path: the function is pure, so we mirror its contract by
// requiring the compiled module is not available in plain node. We therefore re-implement
// the SAME normalization+split here is NOT acceptable for a regression test, so instead we
// dynamically evaluate the source's function.)
var fs = require('fs');
var src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'mix-composition.js'), 'utf8');
// Extract and eval previewProportionalSplit (pure function, no imports used inside it).
var startIdx = src.indexOf('function previewProportionalSplit');
var endMarker = 'export {';
var fnSrc = src.substring(startIdx, src.indexOf(endMarker));
// eslint-disable-next-line no-eval
eval(fnSrc); // defines previewProportionalSplit in this scope

// ---------- 1. robustness (the HG fix) ----------
ok('1a: null rows → empty lines, total 0, not feasible for qty>0',
  (function () { var r = previewProportionalSplit(null, 100); return r.lines.length === 0 && r.total_available === 0 && r.feasible === false; })());
ok('1b: undefined rows → empty lines',
  (function () { var r = previewProportionalSplit(undefined, 50); return r.lines.length === 0 && r.feasible === false; })());
ok('1c: non-array rows → empty lines (no crash)',
  (function () { var r = previewProportionalSplit(42, 10); return r.lines.length === 0; })());
ok('1d: empty array, qty 0 → feasible true (0 <= 0)',
  (function () { var r = previewProportionalSplit([], 0); return r.feasible === true && r.total_available === 0; })());

// ---------- 2. proportional split math (exact sum) ----------
var rows = [{ component_product_id: 'a', component_color: 'Black', available: 60 },
            { component_product_id: 'b', component_color: 'White', available: 40 }];
ok('2a: splits proportionally by availability',
  (function () { var r = previewProportionalSplit(rows, 100); return r.lines[0].planned === 60 && r.lines[1].planned === 40; })());
ok('2b: planned lines sum to EXACTLY the sale qty (remainder to last)',
  (function () { var r = previewProportionalSplit(rows, 33.33); var s = r.lines.reduce(function (a, l) { return a + l.planned; }, 0); return Math.abs(s - 33.33) < 1e-9; })());
ok('2c: feasible when qty <= total',
  (function () { var r = previewProportionalSplit(rows, 100); return r.feasible === true; })());
ok('2d: NOT feasible when qty exceeds total, with per-line shortfall reported',
  (function () { var r = previewProportionalSplit(rows, 200); return r.feasible === false && r.lines.some(function (l) { return l.shortfall > 0; }); })());
ok('2e: remaining_if_filled never negative (clamped)',
  (function () { var r = previewProportionalSplit(rows, 200); return r.lines.every(function (l) { return l.remaining_if_filled >= 0; }); })());

// ---------- 3. source wiring ----------
ok('3a: helper normalizes rows (Array.isArray guard present)',
  /rows\s*=\s*Array\.isArray\(rows\)\s*\?\s*rows\s*:\s*\[\]/.test(src));

console.log('');
if (failures.length === 0) {
  console.log('✅ All v55.83-HG previewProportionalSplit tests passed');
  process.exit(0);
} else {
  console.log('❌ ' + failures.length + ' tests FAILED:');
  failures.forEach(function (f) { console.log('   - ' + f); });
  process.exit(1);
}
