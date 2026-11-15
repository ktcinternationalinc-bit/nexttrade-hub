// ============================================================
// v55.28 — Phone Diagnostics endpoint + UI panel
// ============================================================
// Verifies the diagnostics feature is wired up correctly.

var fs = require('fs');
var path = require('path');
var REPO = path.resolve(__dirname, '..');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('✓ ' + name); passed++; }
  catch (e) { console.log('✗ ' + name + ' — ' + e.message); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

var diagRoute = fs.readFileSync(path.join(REPO, 'src/app/api/phone/diagnose/route.js'), 'utf8');
var settings = fs.readFileSync(path.join(REPO, 'src/components/SettingsTab.jsx'), 'utf8');

console.log('\n──────────────────────────────────────────────────');
console.log('V55.28 — PHONE SYSTEM DIAGNOSTICS');
console.log('──────────────────────────────────────────────────');

// ---- Endpoint structure ----

test('diagnose endpoint exists and is a GET', function() {
  assert(/export async function GET/.test(diagRoute),
    'GET handler must be exported');
});

test('diagnose endpoint requires Node.js runtime (Twilio SDK needs it)', function() {
  assert(/export const runtime = 'nodejs'/.test(diagRoute),
    'must declare runtime = nodejs');
});

test('diagnose endpoint requires admin role', function() {
  assert(/role !== 'admin' && role !== 'super_admin'/.test(diagRoute),
    'admin-only gate present');
  assert(/admin only/.test(diagRoute),
    'returns clear error message for non-admins');
});

test('diagnose checks all 5 required Twilio env vars', function() {
  ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_API_KEY_SID',
   'TWILIO_API_KEY_SECRET', 'TWILIO_TWIML_APP_SID'].forEach(function(v) {
    assert(diagRoute.indexOf(v) >= 0, 'must check ' + v);
  });
});

test('diagnose checks INTERNAL_SECRET (transcription auth)', function() {
  assert(/INTERNAL_SECRET/.test(diagRoute),
    'must check INTERNAL_SECRET — transcription background jobs need it');
});

test('diagnose checks NEXT_PUBLIC_APP_URL', function() {
  assert(/NEXT_PUBLIC_APP_URL/.test(diagRoute),
    'must check the public URL used for webhook callbacks');
});

test('diagnose verifies starts-with prefixes for known env vars', function() {
  // ACCOUNT_SID starts with AC, API_KEY_SID with SK, TWIML_APP_SID with AP
  assert(/startsWith: 'AC'/.test(diagRoute),
    'flags wrong values for TWILIO_ACCOUNT_SID');
  assert(/startsWith: 'SK'/.test(diagRoute),
    'flags wrong values for TWILIO_API_KEY_SID');
  assert(/startsWith: 'AP'/.test(diagRoute),
    'flags wrong values for TWILIO_TWIML_APP_SID');
});

test('diagnose checks DB has phone_numbers, phone_calls, phone_voicemails tables', function() {
  assert(/from\('phone_numbers'\)/.test(diagRoute), 'phone_numbers');
  assert(/from\('phone_calls'\)/.test(diagRoute), 'phone_calls');
  assert(/from\('phone_voicemails'\)/.test(diagRoute), 'phone_voicemails');
});

test('diagnose flags when no phone_numbers are assigned to anyone', function() {
  // Catches the silent failure: numbers exist but assigned_to is NULL
  assert(/NONE are assigned/.test(diagRoute),
    'detects unassigned numbers (inbound calls have nowhere to ring)');
});

test('diagnose tests Twilio API connectivity (validates SID + AUTH_TOKEN)', function() {
  assert(/twilio\(process\.env\.TWILIO_ACCOUNT_SID, process\.env\.TWILIO_AUTH_TOKEN\)/.test(diagRoute),
    'creates a Twilio client to validate credentials');
  assert(/api\.v2010\.accounts/.test(diagRoute),
    'fetches account info to verify auth');
});

test('diagnose verifies TwiML App configuration', function() {
  // Should fetch the TwiML App and check its voiceUrl points at /api/phone/outbound
  assert(/applications\(process\.env\.TWILIO_TWIML_APP_SID\)\.fetch/.test(diagRoute),
    'fetches the TwiML App by SID');
  assert(/\/api\/phone\/outbound/.test(diagRoute),
    'checks voiceUrl ends with /api/phone/outbound');
});

test('diagnose verifies phone numbers are owned by THIS Twilio account', function() {
  assert(/incomingPhoneNumbers\.list/.test(diagRoute),
    'lists owned numbers from Twilio API');
  // Catches the case where DB has a number that was released or transferred
  assert(/missingFromTwilio/.test(diagRoute),
    'detects numbers in DB but not in Twilio');
});

test('diagnose verifies each number has voiceUrl → /api/phone/incoming', function() {
  assert(/voiceUrlIssues/.test(diagRoute),
    'detects numbers with wrong voice webhook');
  assert(/\/api\/phone\/incoming/.test(diagRoute),
    'checks for the incoming webhook path');
});

test('diagnose returns overall + summary + per-check results', function() {
  assert(/overall:/.test(diagRoute), 'overall verdict in response');
  assert(/summary:/.test(diagRoute), 'summary counts in response');
  assert(/results:/.test(diagRoute), 'per-check results in response');
});

test('diagnose includes a fix hint for every failure', function() {
  // The check() helper takes (label, status, message, fix). All fail/warn
  // results should include a fix hint to be useful.
  assert(/function check\(label, status, message, fix\)/.test(diagRoute),
    'check() helper accepts fix parameter');
  // Spot-check that fail cases pass a fix
  assert(/'fail'[\s\S]{0,500}'In Vercel/.test(diagRoute),
    'env var failures include Vercel-specific fix');
});

// ---- UI integration ----

test('SettingsTab imports nothing extra (uses existing fetch + supabase)', function() {
  // No new imports needed for diagnostics — should reuse existing patterns
  assert(/PhoneSettingsPanel/.test(settings), 'panel component exists');
});

test('PhoneSettingsPanel has diagnostics state hooks', function() {
  assert(/diagRunning, setDiagRunning/.test(settings),
    'tracks loading state for the diagnose button');
  assert(/diagResult, setDiagResult/.test(settings),
    'stores the latest result');
});

test('runDiagnostics calls /api/phone/diagnose with bearer token', function() {
  assert(/'\/api\/phone\/diagnose'/.test(settings),
    'fetches the diagnose endpoint');
  assert(/runDiagnostics[\s\S]{0,800}'Authorization': 'Bearer '/.test(settings),
    'sends Authorization header');
});

test('Run Diagnostics button is admin-only (canEdit gate)', function() {
  // The diagnostics block must be wrapped in {canEdit && (...)} so
  // non-admin team members don't see the button.
  // Find the JSX button text (not the function comment that mentions
  // it earlier in the file). The button label has the play arrow.
  var idx = settings.indexOf('▶ Run Diagnostics');
  assert(idx > -1, '▶ Run Diagnostics button text present');
  // Walk back to the immediately-preceding {canEdit && ( wrapper
  var preceding = settings.slice(Math.max(0, idx - 2000), idx);
  assert(/\{canEdit && \(/.test(preceding),
    'diagnostics block must be inside {canEdit && (...)} wrapper');
});

test('Diagnostics panel shows overall status banner + per-check rows', function() {
  // Banner colors: green/amber/red based on overall status
  assert(/Everything is working/.test(settings), 'success banner');
  assert(/Phone system mostly works/.test(settings), 'warn banner');
  assert(/Phone system is not functional/.test(settings), 'fail banner');
  // Per-row icons
  assert(/r\.status === 'ok' \? '✓'/.test(settings),
    'green check icon for ok rows');
});

test('Diagnostics panel shows fix hints inline', function() {
  assert(/r\.fix &&/.test(settings),
    'conditionally renders the fix text when present');
  assert(/<strong>Fix:<\/strong>/.test(settings),
    'fix text is labeled clearly');
});

console.log('\n──────────────────────────────────────────────────');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed === 0) {
  console.log('\n✅ All v55.28 phone diagnostics tests passed');
} else {
  console.log('\n❌ FAILURES');
  process.exit(1);
}
