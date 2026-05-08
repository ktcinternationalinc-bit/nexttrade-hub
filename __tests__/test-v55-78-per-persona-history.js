// ============================================================
// v55.78 — Per-persona conversation history
//
// Each persona has her own thread. Switching personas surfaces only
// HER conversation, not the others'. localStorage persists all three.
// Migration: old single-array entries become Nadia's thread.
// ============================================================
var fs = require('fs');
var path = require('path');
var REPO = path.resolve(__dirname, '..');
var read = function (rel) { return fs.readFileSync(path.join(REPO, rel), 'utf8'); };
var passed = 0, failed = 0, failures = [];
function check(label, cond) {
  if (cond) { console.log('  v ' + label); passed++; }
  else { console.log('  X ' + label); failed++; failures.push(label); }
}
function group(title) { console.log('\n--- ' + title + ' ---'); }

console.log('============================================================');
console.log('v55.78 — Per-persona conversation history');
console.log('============================================================');

var pg = read('src/app/page.jsx');
var ag = read('src/components/AIGreeter.jsx');

group('State shape: object keyed by persona, not single array');
check('1.1 greeterMessagesByAgent state with 3 keys',
  /useState\(\{ nadia: \[\], jenna: \[\], sara: \[\] \}\)/.test(pg));
check('1.2 greeterMessages getter resolves active slot',
  /greeterMessagesByAgent && greeterMessagesByAgent\[selectedAssistant\]\) \|\| \[\]/.test(pg));
check('1.3 setGreeterMessages routes update into active persona slot only',
  /updated\[selectedAssistant\] = resolved/.test(pg));
check('1.4 Functional updates supported',
  /typeof next === 'function' \? next\(prev\[selectedAssistant\] \|\| \[\]\) : next/.test(pg));

group('localStorage hydration');
check('2.1 Reads new per-persona shape from localStorage',
  /localStorage\.getItem\('nadia\.messages\.byAgent\.' \+ uid\)/.test(pg));
check('2.2 Falls back to legacy single-array (migration to Nadia slot)',
  /localStorage\.getItem\('nadia\.messages\.' \+ uid\)[\s\S]{0,400}setGreeterMessagesByAgent\(\{ nadia: legacyParsed, jenna: \[\], sara: \[\] \}\)/.test(pg));
check('2.3 Defensive: each slot validated as Array on hydrate',
  /Array\.isArray\(parsed\.nadia\) \? parsed\.nadia : \[\]/.test(pg)
  && /Array\.isArray\(parsed\.jenna\) \? parsed\.jenna : \[\]/.test(pg)
  && /Array\.isArray\(parsed\.sara\)  \? parsed\.sara  : \[\]/.test(pg));

group('localStorage persistence');
check('3.1 Persists object shape under new key',
  /setItem\('nadia\.messages\.byAgent\.' \+ uid, JSON\.stringify\(trimmed\)\)/.test(pg));
check('3.2 Each slot trimmed to last 80 entries',
  /trim = function \(arr\) \{ return Array\.isArray\(arr\) \? arr\.slice\(-80\) : \[\]/.test(pg));

group('AIGreeter consumes the active slice transparently');
check('4.1 AIGreeter unchanged signature: sessionMessages={greeterMessages}',
  /sessionMessages=\{greeterMessages\}/.test(pg));
check('4.2 AIGreeter still derives messages from prop (no internal slot logic)',
  /var messages = sessionMessages \|\| \[\]/.test(ag));

console.log('\n--- SUMMARY ---');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach(function (f, i) { console.log('  ' + (i + 1) + '. ' + f); });
  process.exit(1);
}
console.log('\nAll ' + passed + ' v55.78 per-persona-history tests passed.');
