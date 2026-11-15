// __tests__/test-v55-80-email-and-visibility.js
// =========================================
// Static-source tests for v55.80 (Phase B / Section 13):
//   - Email status panel escalates from green to red when 0 sent
//   - Email status panel marks DEGRADED when ≥50% failures
//   - "NOT DELIVERING" badge replaces CONFIGURED when silent failure
//   - Visibility-aware logout: tab hidden 3 min triggers soft logout
//   - heartbeat re-pulses when tab becomes visible
//
// Run: node __tests__/test-v55-80-email-and-visibility.js

var fs = require('fs');
var path = require('path');

var passed = 0;
var failed = 0;
function ok(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.error('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

function load(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }

console.log('\n=== v55.80 email + visibility tests ===');

// ---- Email status escalation ----
var email = load('src/components/EmailStatusPanel.jsx');

ok('email: silentFailure flag derived', /var silentFailure = isReady && attempted >= 3 && succeeded === 0/.test(email));
ok('email: degraded flag derived', /var degraded = isReady && !silentFailure && attempted >= 5 && \(failed \/ attempted\) >= 0\.5/.test(email));
ok('email: pillBg flips to rose-600 on silent failure', /silentFailure \? 'bg-rose-600'/.test(email));
ok('email: pillBg flips to amber-500 on degraded', /degraded \? 'bg-amber-500'/.test(email));
ok('email: NOT DELIVERING badge label', /'NOT DELIVERING'/.test(email));
ok('email: DEGRADED badge label', /'DEGRADED'/.test(email));
ok('email: silent-failure callout has 🚨', /🚨 Emails are NOT delivering/.test(email));
ok('email: degraded callout has ⚠️', /⚠️ Email delivery is degraded/.test(email));
ok('email: 24h sent number turns rose on silent failure', /silentFailure \? 'text-rose-600' : 'text-emerald-700'/.test(email));
ok('email: panel bg flips on silent failure', /silentFailure\) panelBg = 'bg-rose-50 border-rose-300'/.test(email));

// Behavioral check: simulate the boolean logic with a tiny shim.
function deriveFlags(attempted, succeeded, isReady) {
  var failed = attempted - succeeded;
  var silentFailure = isReady && attempted >= 3 && succeeded === 0;
  var degraded = isReady && !silentFailure && attempted >= 5 && (failed / attempted) >= 0.5;
  return { silentFailure: silentFailure, degraded: degraded, failed: failed };
}

ok('email logic: 5 attempted, 0 sent → silentFailure', deriveFlags(5, 0, true).silentFailure === true);
ok('email logic: 2 attempted, 0 sent → not flagged (under threshold)', deriveFlags(2, 0, true).silentFailure === false);
ok('email logic: 10 attempted, 6 sent → not silent, not degraded', deriveFlags(10, 6, true).silentFailure === false && deriveFlags(10, 6, true).degraded === false);
ok('email logic: 10 attempted, 4 sent → degraded', deriveFlags(10, 4, true).degraded === true);
ok('email logic: 10 attempted, 5 sent → degraded (boundary)', deriveFlags(10, 5, true).degraded === true);
ok('email logic: not configured → no escalation', deriveFlags(5, 0, false).silentFailure === false);

// ---- Visibility-aware logout ----
var page = load('src/app/page.jsx');

ok('vis: visibilitychange listener attached', /document\.addEventListener\('visibilitychange', handleVisibilityChange\)/.test(page));
ok('vis: visibilitychange listener cleaned up', /document\.removeEventListener\('visibilitychange', handleVisibilityChange\)/.test(page));
ok('vis: HIDDEN_TIMEOUT_MS is 3 minutes', /HIDDEN_TIMEOUT_MS = 3 \* 60 \* 1000/.test(page));
ok('vis: hidden state schedules soft logout', /document\.visibilityState === 'hidden'[\s\S]*setTimeout/.test(page));
ok('vis: hidden timeout sends logout event', /event_type: 'logout', notes: 'tab_hidden_timeout'/.test(page));
ok('vis: visible state cancels timer', /if \(hiddenTimer\) \{ clearTimeout\(hiddenTimer\); hiddenTimer = null/.test(page));
ok('vis: visible state re-fires heartbeat', /document\.visibilityState === 'visible'[\s\S]*heartbeatTick\(\)/.test(page));
ok('vis: cleanup clears hidden timer on unmount', /if \(hiddenTimer\) clearTimeout\(hiddenTimer\)/.test(page));

console.log('\n=== Results ===');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
process.exit(failed > 0 ? 1 : 0);
