// ============================================================
// v55.82-T — Coach "no data" race-condition fix per Max May 12 2026
//
// Reported: Sara's Personal Coach said "no recorded activity showing
// up yet" on a profile with 5 tickets closed, 45 created, 319 comments,
// 20 meetings, etc. The activity grid + Wins panel showed the metrics
// correctly. Root cause: the auto-fetch effect fired before `current`
// was populated, sending metrics:{} to the API. The AI then correctly
// responded based on the empty payload it received.
//
// Fix in three parts:
//   1. Frontend: auto-fetch waits for loading===false before firing
//   2. Frontend: the de-dup key includes a fingerprint of the metrics
//      (totalActions + key counts) so a real-data fetch supersedes a
//      stale-empty one
//   3. Backend: route refuses to write "no activity" when the metrics
//      object has <5 keys (a stub) — returns 503 "still loading" instead
// ============================================================

var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) { console.log('✓ ' + label); }
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

var myPerf = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'MyPerformance.jsx'), 'utf8');
var coachApi = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'api', 'hr-report', 'coach', 'route.js'), 'utf8');

// =============================================================
// Frontend gates
// =============================================================

ok('1a: Auto-fetch effect bails out while loading===true',
  /useEffect\(function \(\) \{[\s\S]{0,800}if \(loading\) return;/.test(myPerf),
  'previously fired with metrics:{} before data was ready');

ok('1b: Auto-fetch dep array includes loading (so it retries when load completes)',
  /\}, \[expanded, myId, period, current, loading\]\);/.test(myPerf));

ok('1c: De-dup key now includes a fingerprint of current metrics',
  /var fp = current[\s\S]{0,300}totalActions[\s\S]{0,200}var key = \(myId \|\| 'anon'\) \+ ':' \+ period \+ ':' \+ fp/.test(myPerf),
  'key includes activity counts so stale-empty fetch is superseded by real-data fetch');

ok('1d: Stale empty coachMsg is cleared before refetching',
  /if \(coachMsg\) setCoachMsg\(''\);\s*if \(coachError\) setCoachError\(''\);\s*requestCoach\(\);/.test(myPerf));

// =============================================================
// Backend safety net
// =============================================================

ok('2a: Route counts keys in metrics payload',
  /var metricsKeyCount = Object\.keys\(metrics \|\| \{\}\)\.length;/.test(coachApi));

ok('2b: Route refuses to call the LLM when metrics is empty AND activity is zero',
  /if \(isLowActivity && metricsLooksEmpty\) \{[\s\S]{0,400}return Response\.json\(/.test(coachApi),
  'avoid "no activity" misdiagnosis when client sent empty payload');

ok('2c: Route returns 503 + "still loading" message in that case',
  /Activity data is still loading[\s\S]{0,80}\}, \{ status: 503 \}\)/.test(coachApi));

ok('2d: Route logs the empty-payload case to Vercel for diagnostics',
  /\[hr-coach\] metrics payload looks empty/.test(coachApi));

// =============================================================
// REGRESSION GUARDS
// =============================================================

ok('3a: REGRESSION — old auto-fetch key (no fingerprint) is gone',
  !/var key = \(myId \|\| 'anon'\) \+ ':' \+ period;\s*if \(autoFetchedRef/.test(myPerf),
  'old key was just userId:period — caused stuck stale message');

ok('3b: REGRESSION — old early-return on coachMsg blocking refetch is replaced',
  // We removed `if (coachMsg || coachError || coachLoading) return;` and
  // replaced with a more targeted clear-and-refetch flow. The full triple-
  // OR pattern shouldn't appear anymore as a hard bail.
  !/if \(coachMsg \|\| coachError \|\| coachLoading\) return;\s*var key = \(myId \|\| 'anon'\) \+ ':' \+ period;/.test(myPerf));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' test' + (failures.length === 1 ? '' : 's') + ' failed:');
  failures.forEach(function(f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.82-T tests passed');
