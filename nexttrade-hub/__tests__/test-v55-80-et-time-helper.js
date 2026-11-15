// __tests__/test-v55-80-et-time-helper.js
// =========================================
// Tests for the fmtET helper added in v55.80 (Phase B / Section 8).
//
// These tests verify:
//   - fmtET renders consistent ET output for every supported kind
//   - the 'ET' tag appears on time/datetime by default
//   - the 'ET' tag is suppressed on pure-date kinds
//   - bad input returns '—' (never throws)
//   - relativeET handles "just now" / "Xm ago" / "Yesterday" / dates
//   - fmtETRange collapses same-day, expands different-day
//
// Run: node __tests__/test-v55-80-et-time-helper.js

var assert = require('assert');

// We can't `import` ESM from a CJS test runner without a transpiler. The
// existing test files load source by reading the file and using a subset
// pattern. Since et-time.js is pure (no React, no Supabase), we read it as
// text and eval the named functions. This matches how other helpers are
// tested in this repo (see test-hr-metrics.js).
var fs = require('fs');
var path = require('path');

var src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'et-time.js'), 'utf8');

// Strip ES module markers so we can eval as a script and harvest the named functions.
var script = src
  .replace(/export\s+function\s+/g, 'function ')
  .replace(/export\s+\{[^}]*\}/g, '');

// Wrap in IIFE so the helpers don't leak; return what we need.
script += '\n;return { fmtET: fmtET, fmtETRange: fmtETRange, relativeET: relativeET, todayET: todayET, yesterdayET: yesterdayET, etDateStr: etDateStr, etHour: etHour, etGreetingWord: etGreetingWord, daysAgoET: daysAgoET, cmpETDays: cmpETDays };\n';

var lib = (new Function(script))();

var passed = 0;
var failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; }
  else { failed++; console.error('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('\n=== v55.80 et-time helper tests ===');

// ---- fmtET basic kinds ----
var sample = '2026-05-08T18:14:00Z'; // 2:14 PM ET (EDT, UTC-4) on May 8
ok('fmtET(sample, "date")', lib.fmtET(sample, 'date') === 'May 8, 2026', 'got: ' + lib.fmtET(sample, 'date'));
ok('fmtET(sample, "shortdate")', lib.fmtET(sample, 'shortdate') === 'May 8', 'got: ' + lib.fmtET(sample, 'shortdate'));
ok('fmtET(sample, "time") has ET tag', /\sET$/.test(lib.fmtET(sample, 'time')), 'got: ' + lib.fmtET(sample, 'time'));
ok('fmtET(sample, "time") shows 2:14 PM', /2:14\sPM/.test(lib.fmtET(sample, 'time')), 'got: ' + lib.fmtET(sample, 'time'));
ok('fmtET(sample, "datetime") shows date AND time AND ET', /May 8.*2:14\sPM\sET/.test(lib.fmtET(sample, 'datetime')), 'got: ' + lib.fmtET(sample, 'datetime'));
ok('fmtET(sample, "longdate") shows weekday + full date', /Friday.*May 8.*2026/.test(lib.fmtET(sample, 'longdate')), 'got: ' + lib.fmtET(sample, 'longdate'));
ok('fmtET(sample, "weekday") returns just weekday', lib.fmtET(sample, 'weekday') === 'Friday', 'got: ' + lib.fmtET(sample, 'weekday'));
ok('fmtET(sample, "iso") returns YYYY-MM-DD with no tag', lib.fmtET(sample, 'iso') === '2026-05-08', 'got: ' + lib.fmtET(sample, 'iso'));
ok('fmtET(sample, "monthday") returns 5/8', lib.fmtET(sample, 'monthday') === '5/8', 'got: ' + lib.fmtET(sample, 'monthday'));

// ---- ET tag default behavior ----
ok('fmtET pure date has NO tag', !/ET$/.test(lib.fmtET(sample, 'date')), 'got: ' + lib.fmtET(sample, 'date'));
ok('fmtET shortdate has NO tag', !/ET$/.test(lib.fmtET(sample, 'shortdate')), 'got: ' + lib.fmtET(sample, 'shortdate'));
ok('fmtET datetime DOES have tag', /ET$/.test(lib.fmtET(sample, 'datetime')), 'got: ' + lib.fmtET(sample, 'datetime'));

// ---- ET tag suppression via opts ----
ok('fmtET datetime tag suppressible', !/ET$/.test(lib.fmtET(sample, 'datetime', { tag: false })), 'got: ' + lib.fmtET(sample, 'datetime', { tag: false }));
ok('fmtET date tag forceable', /ET$/.test(lib.fmtET(sample, 'date', { tag: true })), 'got: ' + lib.fmtET(sample, 'date', { tag: true }));

// ---- Input flexibility ----
ok('fmtET accepts Date object', lib.fmtET(new Date(sample), 'shortdate') === 'May 8', 'got: ' + lib.fmtET(new Date(sample), 'shortdate'));
ok('fmtET accepts epoch ms', lib.fmtET(new Date(sample).getTime(), 'shortdate') === 'May 8', 'got: ' + lib.fmtET(new Date(sample).getTime(), 'shortdate'));
ok('fmtET accepts bare YYYY-MM-DD', lib.fmtET('2026-05-08', 'shortdate') === 'May 8', 'got: ' + lib.fmtET('2026-05-08', 'shortdate'));

// ---- ET timezone correctness (the real test) ----
// 2026-01-15T03:00:00Z is 10:00 PM ET on Jan 14 (EST, UTC-5)
// Naive UTC handling would say "Jan 15" — ET says "Jan 14". This is the bug
// the helper was built to prevent.
var lateNight = '2026-01-15T03:00:00Z';
ok('fmtET respects ET boundary (10pm ET on 14th, NOT UTC 15th)',
   lib.fmtET(lateNight, 'iso') === '2026-01-14',
   'got: ' + lib.fmtET(lateNight, 'iso'));
ok('fmtET shortdate respects ET boundary',
   lib.fmtET(lateNight, 'shortdate') === 'Jan 14',
   'got: ' + lib.fmtET(lateNight, 'shortdate'));

// ---- Bad input handling ----
ok('fmtET(null) returns "—"', lib.fmtET(null, 'date') === '—');
ok('fmtET(undefined) returns "—"', lib.fmtET(undefined, 'date') === '—');
ok('fmtET("") returns "—"', lib.fmtET('', 'date') === '—');
ok('fmtET("garbage") returns "—"', lib.fmtET('not-a-date', 'date') === '—');
ok('fmtET(NaN) returns "—"', lib.fmtET(NaN, 'date') === '—');
ok('fmtET never throws on bad input', (function () {
  try { lib.fmtET({}, 'date'); lib.fmtET([], 'date'); lib.fmtET(false, 'date'); return true; }
  catch (e) { return false; }
})());

// ---- Default kind ----
ok('fmtET no-kind defaults to datetime', /May 8.*PM\sET/.test(lib.fmtET(sample)), 'got: ' + lib.fmtET(sample));

// ---- relativeET ----
ok('relativeET(now) === "just now"', lib.relativeET(new Date()) === 'just now', 'got: ' + lib.relativeET(new Date()));
ok('relativeET(2 min ago) === "2m ago"', lib.relativeET(new Date(Date.now() - 2 * 60 * 1000)) === '2m ago', 'got: ' + lib.relativeET(new Date(Date.now() - 2 * 60 * 1000)));
ok('relativeET(3 hr ago) === "3h ago"', lib.relativeET(new Date(Date.now() - 3 * 60 * 60 * 1000)) === '3h ago', 'got: ' + lib.relativeET(new Date(Date.now() - 3 * 60 * 60 * 1000)));
ok('relativeET(null) === "—"', lib.relativeET(null) === '—');

// ---- fmtETRange ----
ok('fmtETRange(same day) collapses', lib.fmtETRange('2026-05-08', '2026-05-08', 'shortdate') === 'May 8', 'got: ' + lib.fmtETRange('2026-05-08', '2026-05-08', 'shortdate'));
ok('fmtETRange(diff day) expands', lib.fmtETRange('2026-05-01', '2026-05-08', 'shortdate') === 'May 1 → May 8', 'got: ' + lib.fmtETRange('2026-05-01', '2026-05-08', 'shortdate'));
ok('fmtETRange(only from) returns from', lib.fmtETRange('2026-05-01', null, 'shortdate') === 'May 1');
ok('fmtETRange(only to) returns to', lib.fmtETRange(null, '2026-05-01', 'shortdate') === 'May 1');
ok('fmtETRange(both null) returns "—"', lib.fmtETRange(null, null, 'shortdate') === '—');

// ---- todayET / yesterdayET / cmpETDays still work after the rewrite ----
ok('todayET returns YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(lib.todayET()), 'got: ' + lib.todayET());
ok('yesterdayET returns YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(lib.yesterdayET()), 'got: ' + lib.yesterdayET());
ok('todayET !== yesterdayET', lib.todayET() !== lib.yesterdayET());
ok('cmpETDays(today, yesterday) === -1', lib.cmpETDays(lib.todayET(), lib.yesterdayET()) === -1);
ok('cmpETDays(yesterday, today) === 1', lib.cmpETDays(lib.yesterdayET(), lib.todayET()) === 1);
ok('cmpETDays(same, same) === 0', lib.cmpETDays('2026-05-08', '2026-05-08') === 0);
ok('cmpETDays(null, x) === 0', lib.cmpETDays(null, '2026-05-08') === 0);

// ---- daysAgoET ----
ok('daysAgoET(0) === todayET', lib.daysAgoET(0) === lib.todayET());
ok('daysAgoET(1) === yesterdayET', lib.daysAgoET(1) === lib.yesterdayET());
ok('daysAgoET(7) returns valid YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(lib.daysAgoET(7)));

// ---- etGreetingWord ----
var greet = lib.etGreetingWord();
ok('etGreetingWord returns morning|afternoon|evening', ['morning', 'afternoon', 'evening'].indexOf(greet) >= 0, 'got: ' + greet);

console.log('\n=== Results ===');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
process.exit(failed > 0 ? 1 : 0);
