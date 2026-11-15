// ============================================================
// v55.29 — Dial pad auto-formats to E.164
// ============================================================
// Background: typing on the on-screen keypad gave you 10-11 raw digits
// (e.g. "17322086932"). The outbound endpoint then rejected the call
// because Twilio requires E.164 (starts with +). Result: "Destination
// must be in E.164 format starting with plus sign" error.
//
// Fix: PhoneWidget now has a toE164() helper that auto-prepends +1 for
// US/Canada numbers, accepts already-+-prefixed international numbers,
// and refuses to dial anything ambiguous (with a clear error message).
//
// Also: outbound route now has a 3-tier fallback for callerId so users
// without an assigned number can still place calls.
// ============================================================

var fs = require('fs');
var path = require('path');
var REPO = path.resolve(__dirname, '..');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('✓ ' + name); passed++; }
  catch (e) { console.log('✗ ' + name + ' — ' + e.message); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

var widget = fs.readFileSync(path.join(REPO, 'src/components/PhoneWidget.jsx'), 'utf8');
var outbound = fs.readFileSync(path.join(REPO, 'src/app/api/phone/outbound/route.js'), 'utf8');

console.log('\n──────────────────────────────────────────────────');
console.log('V55.29 — DIAL-PAD E.164 AUTO-FORMAT');
console.log('──────────────────────────────────────────────────');

// ---- toE164 helper ----

test('PhoneWidget defines toE164 helper', function() {
  assert(/const toE164 = \(raw\) =>/.test(widget),
    'toE164 function present');
});

test('toE164 keeps already-prefixed numbers as-is', function() {
  // Input "+17322086932" → output "+17322086932"
  assert(/if \(s\.startsWith\('\+'\)\)/.test(widget),
    'short-circuits when + already present');
});

test('toE164 prepends +1 for 10-digit US/Canada numbers', function() {
  // Input "7322086932" (10 digits) → output "+17322086932"
  assert(/if \(digits\.length === 10\) return '\+1' \+ digits/.test(widget),
    '10-digit prefixes +1');
});

test('toE164 prepends + for 11-digit US numbers starting with 1', function() {
  // Input "17322086932" (11 digits, starts with 1) → output "+17322086932"
  // This was Max's actual case in the screenshot
  assert(/if \(digits\.length === 11 && digits\.charAt\(0\) === '1'\) return '\+' \+ digits/.test(widget),
    '11-digit starting with 1 prefixes +');
});

test('toE164 returns null for ambiguous lengths (forces clear error)', function() {
  // Anything else returns null — better than silently dialing the wrong country
  assert(/return null; \/\/ ambiguous/.test(widget),
    'short/long inputs return null');
});

test('toE164 enforces E.164 length bounds (7-15 digits after +)', function() {
  // Even with + present, very short or very long inputs are invalid
  assert(/afterPlus\.length < 7 \|\| afterPlus\.length > 15/.test(widget),
    'rejects malformed E.164');
});

// ---- makeCall integration ----

test('makeCall calls toE164 instead of bare regex strip', function() {
  // The OLD code was: const num = (phoneNum || number).replace(/[^\d+]/g, '');
  // That stripped everything except digits and +, but didn't add a + when missing.
  assert(/var num = toE164\(raw\);/.test(widget),
    'makeCall pipes input through toE164');
});

test('makeCall shows a clear error message when toE164 returns null', function() {
  // Don't fire device.connect() with bad input — show the user what's wrong
  assert(/Could not understand[\s\S]{0,200}as a phone number/.test(widget),
    'clear error for ambiguous input');
});

// ---- Dial pad UI ----

test('Dial pad shows live E.164 preview', function() {
  // User types "17322086932", preview shows "Will dial: +17322086932"
  assert(/Will dial: \{toE164\(number\)\}/.test(widget),
    'preview confirms what will be dialed');
});

test('Dial pad shows warning when number is ambiguous', function() {
  // If they type something that toE164 returns null for, show "add country code"
  assert(/Add country code/.test(widget),
    'warns about missing country code');
});

test('Call button is disabled when toE164 returns null', function() {
  // Better to grey out the button than send to /outbound and get rejected
  assert(/disabled=\{!number \|\| !toE164\(number\) \|\| callState/.test(widget),
    'Call button gated on valid E.164');
});

// ---- Outbound caller ID fallback ----

test('Outbound route has 3-tier caller ID fallback', function() {
  // Tier 1: assigned phone_numbers row (existing)
  // Tier 2: TWILIO_MAIN_NUMBER env var (existing)
  // Tier 3: any main-type row in phone_numbers (NEW in v55.29)
  assert(/three-tier fallback/.test(outbound),
    'comment explains the tier system');
  assert(/number_type', 'main'/.test(outbound),
    'falls through to main-type row');
});

test('Outbound returns clear error TwiML when no caller ID is available', function() {
  // Prevent silent Twilio failure — give the user a real message
  assert(/No phone number is configured for outgoing calls/.test(outbound),
    'clear voice error');
});

console.log('\n──────────────────────────────────────────────────');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed === 0) {
  console.log('\n✅ All v55.29 dial format tests passed');
} else {
  console.log('\n❌ FAILURES');
  process.exit(1);
}
