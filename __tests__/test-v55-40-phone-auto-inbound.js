// Test suite for v55.40 — phone auto-register + voicemail visibility
// =============================================
// Two improvements ship together:
//
// 1. Auto-register the Twilio Voice SDK Device on app load when it's
//    safe (mic permission already granted; user routing includes browser;
//    not in vacation mode). Before this, every inbound call went to
//    voicemail because nobody had the phone widget open. Now browsers
//    actually ring when a call comes in, and a green dot on the floating
//    phone button shows the user when their device is ready to receive.
//
// 2. Header voicemail badge — a small "📬 N" button in the global header
//    that appears whenever the current user has unread voicemails. Clicking
//    it switches to the dashboard and scrolls to the existing
//    VoicemailsWidget. Solves the "where do I find voicemails" discovery
//    problem permanently.

import fs from 'fs';
import path from 'path';

var REPO = path.resolve(new URL('.', import.meta.url).pathname, '..');

var passed = 0, failed = 0;
var errors = [];
function assert(cond, label) {
  if (cond) { passed++; }
  else { failed++; errors.push(label); console.log('  \u2717 ' + label); }
}
function read(rel) { return fs.readFileSync(path.join(REPO, rel), 'utf8'); }
function exists(rel) { return fs.existsSync(path.join(REPO, rel)); }

console.log('\n========================================');
console.log('v55.40 PHONE AUTO-INBOUND TEST SUITE');
console.log('========================================\n');

// ----------------------------------------------------------------------
// PHONE WIDGET — auto-register useEffect present and well-gated
// ----------------------------------------------------------------------
console.log('PhoneWidget — auto-register effect is in place and properly gated');
var pw = read('src/components/PhoneWidget.jsx');

assert(/AUTO-REGISTER/.test(pw),
  'A.1 — PhoneWidget has the AUTO-REGISTER doc block');
assert(/navigator\.permissions\.query/.test(pw),
  'A.2 — auto-register checks Permissions API for microphone');
assert(/perm\.state !== 'granted'/.test(pw),
  'A.3 — auto-register bails when mic is not pre-granted (no jarring prompt)');
assert(/phone_routing/.test(pw),
  'A.4 — auto-register checks the user phone_routing preference');
assert(/phone_vacation_mode/.test(pw),
  'A.5 — auto-register checks vacation mode and bails if on');
assert(/routing\.data\.phone_routing === 'cell'/.test(pw),
  'A.6 — auto-register skips users explicitly routed to cell only');
assert(/setTimeout\(tryAutoRegister/.test(pw),
  'A.7 — auto-register runs after a short delay (avoids racing auth handshake)');
assert(/cancelled = true/.test(pw),
  'A.8 — auto-register effect cleans up cancelled flag on unmount');

// ----------------------------------------------------------------------
// PHONE WIDGET — deviceReady state lights up on registration
// ----------------------------------------------------------------------
console.log('\nPhoneWidget — deviceReady state + visual indicator wired up');

assert(/const \[deviceReady, setDeviceReady\] = useState\(false\)/.test(pw),
  'A.9 — deviceReady state declared');
assert(/setDeviceReady\(true\)/.test(pw),
  'A.10 — registered event flips deviceReady to true');
assert(/setDeviceReady\(false\)/.test(pw),
  'A.11 — unregistered event flips deviceReady back to false');

// The floating phone button must show a green dot when ready
var btnIdx = pw.indexOf('Floating phone button');
assert(btnIdx > 0, 'A.12 — phone button JSX is reachable');
var afterBtn = pw.slice(btnIdx, btnIdx + 2000);
assert(/deviceReady/.test(afterBtn),
  'A.13 — phone button JSX references deviceReady');
assert(/bg-emerald-400/.test(afterBtn) || /bg-green-400/.test(afterBtn),
  'A.14 — green ready dot styling is in the phone button');
assert(/title=\{deviceReady/.test(pw),
  'A.15 — phone button tooltip changes based on deviceReady');

// ----------------------------------------------------------------------
// PHONE WIDGET — auto-register must not break the existing lazy init
// ----------------------------------------------------------------------
console.log('\nPhoneWidget — existing lazy-init flow preserved');
assert(/if \(open && myId && !deviceRef\.current\) \{[\s\S]{0,80}initDevice\(\)/.test(pw),
  'A.16 — lazy init on widget open still works (back-compat)');
assert(/initDevice itself is idempotent/.test(pw),
  'A.17 — initDevice idempotency comment preserved (multi-init safe)');

// Cleanup must also clear deviceReady so an unmount + remount doesn't
// leave a stale "ready" indicator on a destroyed device.
assert(/deviceRef\.current\.destroy\(\);[\s\S]{0,200}setDeviceReady\(false\)/.test(pw),
  'A.18 — cleanup destroys device AND clears deviceReady');

// ----------------------------------------------------------------------
// HEADER VOICEMAIL BADGE — state, fetch, badge
// ----------------------------------------------------------------------
console.log('\nHeader voicemail badge — state + polling + UI in place');
var page = read('src/app/page.jsx');

assert(/const \[unreadVoicemails, setUnreadVoicemails\] = useState\(0\)/.test(page),
  'B.1 — unreadVoicemails state declared');
assert(/\/api\/phone\/voicemails\?assigned_to=/.test(page),
  'B.2 — page polls /api/phone/voicemails for unread count');
assert(/unread=true/.test(page),
  'B.3 — count fetch uses unread=true filter');
assert(/setInterval\(fetchCount, 30 \* 1000\)/.test(page),
  'B.4 — count refresh interval matches widget cadence (30s)');
assert(/keepalive|setUnreadVoicemails\(/.test(page),
  'B.5 — count is written back to state');

// Badge JSX
assert(/unreadVoicemails > 0 &&/.test(page),
  'B.6 — badge only renders when count > 0');
assert(/voicemails-widget/.test(page),
  'B.7 — badge click target references the voicemails-widget anchor');
assert(/scrollIntoView/.test(page),
  'B.8 — badge click scrolls to the widget');
assert(/setTab\('dashboard'\);[\s\S]{0,200}voicemails-widget/.test(page),
  'B.9 — badge switches to dashboard before scrolling');

// Anchor on the widget container
assert(/id="voicemails-widget"/.test(page),
  'B.10 — VoicemailsWidget container has the scroll anchor id');

// ----------------------------------------------------------------------
// REGRESSION GUARD — earlier fixes still in place
// ----------------------------------------------------------------------
console.log('\nRegression guard — v55.39 + v55.38 features intact');
var vm = read('src/app/api/phone/voicemail-record/route.js');
assert(/dialCallStatus === 'no-answer'/.test(vm),
  'G.1 — v55.39 dial-failed → record-voicemail branch still in place');
assert(/const \[time, setTime\] = useState\(null\)/.test(read('src/app/login/page.jsx')),
  'G.2 — v55.38 login hydration fix still in place');
assert(/translate="no"/.test(read('src/app/layout.jsx')),
  'G.3 — v55.38 layout notranslate guard still in place');
assert(exists('src/components/WhatsAppInbox.jsx'),
  'G.4 — v55.37 WhatsApp inbox still present');
assert(exists('src/app/api/phone/diagnose/route.js'),
  'G.5 — phone diagnostic endpoint still present');

// The cell forwarding UI we depend on for Feature 2 (data entry) must
// still be in SettingsTab — if it's gone, team members can't set their
// numbers and the auto-register optimisation is moot.
var st = read('src/components/SettingsTab.jsx');
assert(/forwarding_number/.test(st),
  'G.6 — SettingsTab still has the forwarding_number field');
assert(/Team Routing Preferences/.test(st),
  'G.7 — Team Routing Preferences section still rendered');

// ----------------------------------------------------------------------
// VERSION STAMPS
// ----------------------------------------------------------------------
console.log('\nVersion stamps — bumped to v55.40');
function vNum(s) { var m = s.match(/v55\.(\d+)/); return m ? parseInt(m[1], 10) : 0; }
var headerMatch = page.match(/>v55\.\d+(?:-[A-Z][0-9]*(?:\.\d+)?)?</);
var modalMatch = page.match(/BUILD v55\.\d+-/);
assert(headerMatch && vNum(headerMatch[0]) >= 40,
  'V.1 — header pill shows v55.40 or later');
assert(modalMatch && vNum(modalMatch[0]) >= 40,
  'V.2 — build modal shows v55.40-* or later');
// V.3 was a strict equality check — relaxed so future version bumps don't fail it.
// The label-shape (BUILD v55.NN-...) is enforced by V.2 above.
assert(/BUILD v55\.40-PHONE-AUTO-INBOUND/.test(page) || vNum(modalMatch[0]) > 40,
  'V.3 — build modal label is BUILD v55.40-PHONE-AUTO-INBOUND or has been bumped past v55.40');
assert(!/>v55\.39</.test(page),
  'V.4 — no v55.39 header pill remains');

// ----------------------------------------------------------------------
// CODE SHAPE — no template literals introduced (Vercel SWC compatibility)
// ----------------------------------------------------------------------
console.log('\nCode shape — Vercel SWC compatibility checks');

// New PhoneWidget code: scope the backtick check to the auto-register
// useEffect specifically. Other parts of the file have pre-existing
// template literals — we only care that the v55.40 additions follow
// the string-concat convention (which is what trips the Vercel SWC
// compiler when broken).
var autoRegStart = pw.indexOf('AUTO-REGISTER');
assert(autoRegStart > 0, 'C.1a — AUTO-REGISTER region locatable');
// Capture from the doc-block start through the end of the useEffect.
// The useEffect ends when the dependency array `[myId, initDevice]);` appears.
var autoRegEndMarker = '[myId, initDevice]);';
var autoRegEnd = pw.indexOf(autoRegEndMarker, autoRegStart);
assert(autoRegEnd > autoRegStart, 'C.1b — auto-register region terminates with expected dep array');
var autoRegRegion = pw.slice(autoRegStart, autoRegEnd);
// Strip block + line comments inside that region, then count backticks.
var autoRegCode = autoRegRegion
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
var autoRegBackticks = (autoRegCode.match(/`/g) || []).length;
assert(autoRegBackticks === 0,
  'C.1 — no backticks in v55.40 auto-register code (string concat preserved)');

// ----------------------------------------------------------------------
// SUMMARY
// ----------------------------------------------------------------------
console.log('\n========================================');
console.log('TOTAL: ' + (passed + failed) + ' assertions');
console.log('PASSED: ' + passed);
console.log('FAILED: ' + failed);
console.log('========================================\n');

if (failed > 0) {
  console.log('FAILURES:');
  errors.forEach(function (e) { console.log('  \u2022 ' + e); });
  process.exit(1);
}
console.log('\u2713 All v55.40 phone auto-inbound assertions present.\n');
