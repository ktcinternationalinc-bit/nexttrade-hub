// ============================================================
// v55.82-L — Personal Coach blank screen — 10th report
//
// Max May 11 2026: "the personal coach is not giving any feedback
// when you click on it. It just gives you a blank screen a blank
// spot on your personal Coach."
//
// ROOT CAUSES (3 layered):
//
//   #1 (FATAL — explains blank spot): Personal Coach card was rendered
//      INSIDE the `hasAnyActivity && (...)` branch in MyPerformance.jsx
//      starting line 403. If the user's metrics summed to zero
//      (low-activity period, OR — much worse — silent metrics fetch
//      failure returning all zeros), the entire `hasAnyActivity`
//      branch was skipped and the Personal Coach card was never even
//      mounted. The "no activity" cyan banner showed instead. From
//      Max's perspective: blank spot where coach used to be.
//
//   #2 (CONTRIBUTING — explains "click does nothing"): The auto-fetch
//      effect had `if (!hasAnyActivity) return;` so even when the card
//      DID render via some other path, no auto-fetch ever happened.
//      The button itself was disabled with `disabled={!current}` so
//      a user with slow-loading metrics couldn't manually trigger
//      either.
//
//   #3 (CONTRIBUTING — explains "no feedback when clicked"): When
//      Vercel env var ANTHROPIC_API_KEY was missing, the API returned
//      a 500 with a developer-jargon error message. Client-side
//      coachError was shown as small pink text-rose-700 chip that
//      Max couldn't see — looked like nothing happened.
//
// FIXES:
//   - Coach card MOVED OUT of hasAnyActivity branch — always mounts
//     while !loading
//   - Auto-fetch effect: dropped !current and !hasAnyActivity gates,
//     now fires for any user as soon as the panel opens
//   - Button disabled gate dropped !current, only checks coachLoading
//   - Error display upgraded to full warning card with retry button
//   - API route: branched system prompt by activity sum — produces
//     real coaching message for zero-activity users instead of failing
//   - API route: friendlier error messages for missing key / 401 /
//     429 / 500 / network failures
//   - API route: added GET handler for diagnostics + checks
//     has_anthropic_key
// ============================================================

var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) { console.log('✓ ' + label); }
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

var myPerf = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'MyPerformance.jsx'), 'utf8');
var coachRoute = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'api', 'hr-report', 'coach', 'route.js'), 'utf8');

// =====================================================================
// FIX #1 — Coach card moved OUT of hasAnyActivity branch (root cause)
// =====================================================================

// 1a — Coach card is gated only on !loading, not nested in hasAnyActivity
ok('1a: Personal Coach card rendered when !loading (NOT inside hasAnyActivity)',
  /\{!loading && \(\s*<div className="bg-gradient-to-r from-violet-50 to-pink-50/.test(myPerf),
  'card must render even for users with zero activity in the period'
);

// 1b — REGRESSION GUARD: the coach card is NOT a descendant of the
//      `hasAnyActivity && (` block. Verify by checking that "Personal
//      Coach card" comment appears AFTER the closing `</>` `)}` of the
//      hasAnyActivity branch, not before.
ok('1b: REGRESSION GUARD — coach card sits AFTER hasAnyActivity branch closes',
  (function() {
    // Find the closing of the hasAnyActivity branch — pattern: `</>` then `)}` on next line
    var branchClose = myPerf.search(/<\/>\s*\n\s*\)\}/);
    var coachCard  = myPerf.indexOf('AI Coach card');
    if (branchClose < 0 || coachCard < 0) return false;
    return coachCard > branchClose;
  })(),
  'critical guard against the bug Max reported 10 times'
);

// 1c — v55.82-L marker comment explains why we moved it
ok('1c: v55.82-L migration note in MyPerformance.jsx',
  /v55\.82-L[\s\S]{0,400}MOVED OUT of the [\s\S]{0,30}hasAnyActivity/.test(myPerf)
);

// =====================================================================
// FIX #2 — Auto-fetch no longer gated on hasAnyActivity / current
// =====================================================================

// 2a — Auto-fetch effect no longer has !current gate
ok('2a: Auto-fetch effect no longer bails on !current',
  (function() {
    // Find the autoFetchedRef block. The OLD version had `if (!current) return;` early.
    // The NEW v55.82-L version does NOT.
    var idx = myPerf.indexOf('var autoFetchedRef = useRef');
    if (idx < 0) {
      idx = myPerf.indexOf('autoFetchedRef = useRef'); // useRef on its own line
    }
    if (idx < 0) {
      // try const/var form
      idx = myPerf.indexOf('autoFetchedRef');
    }
    if (idx < 0) return false;
    // Look at the surrounding 600 chars
    var slice = myPerf.slice(idx, idx + 700);
    return !/if \(!current\) return;/.test(slice);
  })(),
  'must not silently bail when current metrics are still loading'
);

// 2b — Auto-fetch effect no longer has !hasAnyActivity gate
ok('2b: Auto-fetch effect no longer bails on !hasAnyActivity',
  (function() {
    var idx = myPerf.indexOf('autoFetchedRef');
    if (idx < 0) return false;
    var slice = myPerf.slice(idx, idx + 700);
    return !/if \(!hasAnyActivity\) return;/.test(slice);
  })(),
  'zero-activity users still get coach feedback (the API has a no-activity branch)'
);

// 2c — Auto-fetch effect still has dedup guard
ok('2c: Auto-fetch effect still uses autoFetchedRef to prevent loops',
  /autoFetchedRef\.current === key/.test(myPerf)
);

// 2d — Button no longer disabled by !current — Max could not click it before
ok('2d: Coach button disabled gate only checks coachLoading (not !current)',
  /onClick=\{requestCoach\}\s*disabled=\{coachLoading\}/.test(myPerf),
  'user can always click — even before metrics finish loading'
);

// 2e — requestCoach gracefully handles missing current by sending {}
ok('2e: requestCoach sends metrics: current || {} (defensive)',
  /metrics: current \|\| \{\}/.test(myPerf),
  'API receives a valid payload even if metrics never loaded'
);

// 2f — REGRESSION GUARD: requestCoach no longer has `if (!current) return;`
ok('2f: REGRESSION GUARD — requestCoach no longer bails on !current',
  (function() {
    var idx = myPerf.indexOf('const requestCoach = async');
    if (idx < 0) return false;
    var slice = myPerf.slice(idx, idx + 500);
    return !/if \(!current\) return;/.test(slice);
  })(),
  'clicking the button must always do SOMETHING — not silently no-op'
);

// =====================================================================
// FIX #3 — Error display upgraded to full warning card with retry
// =====================================================================

// 3a — Full warning card with bold heading replaces tiny pink chip
ok('3a: Error UI is a full warning card, not just a tiny chip',
  /Coach can\\'t respond right now/.test(myPerf)
);

// 3b — Retry button inside error card
ok('3b: Error card has a "Try again" retry button',
  /Try again/.test(myPerf) && /onClick=\{requestCoach\}/.test(myPerf)
);

// =====================================================================
// API route #4 — graceful handling for missing key + low-activity
// =====================================================================

// 4a — GET handler added for diagnostics
ok('4a: API route has GET handler for diagnostics',
  /export async function GET\(\)/.test(coachRoute) && /has_anthropic_key: !!process\.env\.ANTHROPIC_API_KEY/.test(coachRoute)
);

// 4b — Missing API key error is user-friendly (mentions admin + Vercel)
ok('4b: Missing API key returns friendly admin-facing error',
  /AI coach is not connected yet[\s\S]{0,200}admin to set ANTHROPIC_API_KEY/.test(coachRoute)
);

// 4c — REGRESSION GUARD: old jargon-only error string is gone
ok('4c: REGRESSION GUARD — old "ANTHROPIC_API_KEY not set in Vercel" exact string is gone',
  !/error: 'ANTHROPIC_API_KEY not set in Vercel environment variables\.'/.test(coachRoute)
);

// 4d — Activity sum is computed in the API
ok('4d: API computes activity sum to decide low-activity branch',
  /var activitySum =/.test(coachRoute) && /var isLowActivity = activitySum === 0/.test(coachRoute)
);

// 4e — Low-activity branch has its own system prompt
ok('4e: Low-activity branch uses a dedicated system prompt',
  /if \(isLowActivity\) \{\s*system =[\s\S]{0,1500}no recorded activity in/.test(coachRoute)
);

// 4f — Low-activity prompt is reassuring, not corrective
ok('4f: Low-activity prompt forbids judgmental language',
  /No judgment/.test(coachRoute) && /encourage|warm|supportive/i.test(coachRoute)
);

// 4g — Anthropic non-OK errors get specific friendly messages
ok('4g: 401 error becomes "AI service key is invalid" friendly message',
  /response\.status === 401[\s\S]{0,300}service key is invalid/.test(coachRoute)
);

// 4h — 429 rate-limit gets dedicated message
ok('4h: 429 rate-limit gets dedicated friendly message',
  /response\.status === 429[\s\S]{0,200}rate-limited/.test(coachRoute)
);

// 4i — Network error caught separately from non-OK response
ok('4i: Network/fetch error caught with its own handler',
  /try \{\s*response = await fetch\('https:\/\/api\.anthropic\.com/.test(coachRoute) && /Could not reach the AI service/.test(coachRoute)
);

// 4j — Empty Claude response surfaced as error instead of silent empty
ok('4j: Empty Claude response surfaced as error (not silent empty message)',
  /!text\.trim\(\)[\s\S]{0,300}empty response/.test(coachRoute),
  'critical: never let a blank message slip through to the client'
);

// 4k — Bad JSON from Anthropic caught
ok('4k: Bad JSON from Anthropic caught with friendly message',
  /unreadable response/.test(coachRoute)
);

// =====================================================================
// Final
// =====================================================================

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' test' + (failures.length === 1 ? '' : 's') + ' failed:');
  failures.forEach(function(f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.82-L Personal Coach blank-screen tests passed');
