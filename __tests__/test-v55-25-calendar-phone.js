// ============================================================
// v55.25 — Calendar cancel/delete + Phone SDK reliability
// ============================================================
// These tests cover the exact bugs that made multiple sessions
// fail to fix calendar cancel/delete, and the phone "Twilio Voice
// SDK script failed to load" issue.
//
// Categories:
//   C1-C4: Toast context wiring (the silent-failure bug)
//   C5-C8: onReload/onRefresh prop fix
//   C9-C12: Cancel button rendering & state machine
//   C13-C16: Delete button rendering & state machine
//   C17-C20: Prominent overlay confirmation dialogs
//   C21-C24: Permission gates fire visible toasts
//   P1-P4: Twilio Voice SDK bundled (no CDN dependency)
//   P5-P7: Token endpoint robustness
//   E1-E3: formatErr defensive coverage
// ============================================================

var fs = require('fs');
var path = require('path');
var assert = require('assert');
var REPO = path.resolve(__dirname, '..');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('✓ ' + name); passed++; }
  catch (e) { console.log('✗ ' + name + ' — ' + e.message); failed++; }
}

var page = fs.readFileSync(path.join(REPO, 'src/app/page.jsx'), 'utf8');
var calendar = fs.readFileSync(path.join(REPO, 'src/components/CalendarTab.jsx'), 'utf8');
var phone = fs.readFileSync(path.join(REPO, 'src/components/PhoneWidget.jsx'), 'utf8');
var pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
var toastCtxFile = path.join(REPO, 'src/lib/toast-context.js');

// ============================================================
// C1-C4: Toast context wiring — the silent-failure root cause
// ============================================================

test('C1 toast-context.js exists and exports ToastContext', function() {
  assert(fs.existsSync(toastCtxFile), 'toast-context.js must exist');
  var src = fs.readFileSync(toastCtxFile, 'utf8');
  assert(/export const ToastContext\s*=\s*React\.createContext/.test(src),
    'ToastContext must be exported with React.createContext');
});

test('C2 page.jsx imports ToastContext from the shared lib (not a circular path)', function() {
  assert(/import\s*\{\s*ToastContext\s*\}\s*from\s*['"]\.\.\/lib\/toast-context['"]/.test(page),
    'page.jsx must import ToastContext from ../lib/toast-context');
  // Make sure the old inline declaration is gone — duplicates would shadow the import
  assert(!/const ToastContext\s*=\s*React\.createContext/.test(page),
    'page.jsx should NOT redeclare ToastContext locally — that would shadow the shared one');
});

test('C3 CalendarTab imports useContext AND ToastContext', function() {
  assert(/import\s*\{[^}]*useContext[^}]*\}\s*from\s*['"]react['"]/.test(calendar),
    'CalendarTab must import useContext from react');
  assert(/import\s*\{\s*ToastContext\s*\}\s*from\s*['"]\.\.\/lib\/toast-context['"]/.test(calendar),
    'CalendarTab must import ToastContext from the shared lib');
});

test('C4 CalendarTab consumes ToastContext (this was the silent failure root cause)', function() {
  // The bug: every "if (toast) toast.error(...)" silently no-op'd because
  // toast was never declared. Fix: useContext(ToastContext).
  assert(/const\s+toast\s*=\s*useContext\(ToastContext\)/.test(calendar),
    'CalendarTab must declare const toast = useContext(ToastContext)');
});

// ============================================================
// C5-C8: onReload vs onRefresh prop name mismatch fix
// ============================================================

test('C5 page.jsx still passes onReload to CalendarTab', function() {
  assert(/<CalendarTab[\s\S]{0,400}onReload=\{loadAllData\}/.test(page),
    'page.jsx passes onReload (existing wiring preserved)');
});

test('C6 CalendarTab destructures BOTH onReload and onRefresh', function() {
  // The fix: accept either prop name and unify them. Otherwise renaming
  // one without the other breaks again.
  assert(/function\s+CalendarTab\(\{[^}]*onReload[^}]*onRefresh[^}]*\}\)/.test(calendar)
      || /function\s+CalendarTab\(\{[^}]*onRefresh[^}]*onReload[^}]*\}\)/.test(calendar),
    'CalendarTab must destructure both onReload and onRefresh from props');
});

test('C7 CalendarTab unifies onReload and onRefresh into a single onRefresh variable', function() {
  assert(/const\s+onRefresh\s*=\s*onRefreshProp\s*\|\|\s*onReload/.test(calendar),
    'CalendarTab must alias onReload to onRefresh so all internal calls work');
});

test('C8 cancel/delete handlers actually call onRefresh (so calendar reloads after success)', function() {
  // Find performCancel and performDelete functions
  var perfCancelMatch = calendar.match(/const\s+performCancel\s*=\s*async\s*\(\)\s*=>\s*\{[\s\S]+?\n\s\s\};/);
  assert(perfCancelMatch, 'performCancel function must exist');
  assert(/onRefresh\(\)/.test(perfCancelMatch[0]),
    'performCancel must call onRefresh() so calendar reloads after cancellation');

  var perfDeleteMatch = calendar.match(/const\s+performDelete\s*=\s*async\s*\(\)\s*=>\s*\{[\s\S]+?\n\s\s\};/);
  assert(perfDeleteMatch, 'performDelete function must exist');
  assert(/onRefresh\(\)/.test(perfDeleteMatch[0]),
    'performDelete must call onRefresh() so calendar reloads after deletion');
});

// ============================================================
// C9-C12: Cancel button → state machine
// ============================================================

test('C9 Cancel button enters cancel stage on click', function() {
  // Find the "Cancel this meeting" button and confirm its onClick eventually
  // calls setActionStage('cancel').
  var cancelBtn = calendar.match(/Cancel this meeting[\s\S]{0,300}/);
  assert(cancelBtn, 'Cancel this meeting button must exist');
  // Permission check happens FIRST then setActionStage
  assert(/setActionStage\('cancel'\)/.test(calendar),
    'Cancel button must trigger setActionStage(\'cancel\')');
});

test('C10 Cancel button shows toast when permission denied', function() {
  // The pattern: if (!canCancel(...)) { toast.error(...); return; }
  assert(/!canCancel\(editEvent\)[\s\S]{0,200}toast\.error/.test(calendar),
    'Cancel button must call toast.error when canCancel returns false');
});

test('C11 performCancel is wired to a button (not orphaned)', function() {
  assert(/onClick=\{performCancel\}/.test(calendar),
    'performCancel must be referenced from a button onClick');
});

test('C12 Cancel confirm button shows busy state', function() {
  // While the action is running, button should say "Cancelling..." not be silent
  assert(/Cancelling\.\.\.|جاري الإلغاء/.test(calendar),
    'Cancel button must show busy text while async operation runs');
});

// ============================================================
// C13-C16: Delete button → state machine
// ============================================================

test('C13 Delete button enters delete stage on click', function() {
  assert(/setActionStage\('delete'\)/.test(calendar),
    'Delete button must trigger setActionStage(\'delete\')');
});

test('C14 Delete button shows toast when permission denied (non-super-admin)', function() {
  assert(/!canDelete\(editEvent\)[\s\S]{0,200}toast\.error/.test(calendar),
    'Delete button must call toast.error when user is not super-admin');
});

test('C15 Delete confirmation requires typing DELETE exactly', function() {
  // The button must be disabled unless actionTyped === 'DELETE'
  assert(/actionTyped\s*!==?\s*['"]DELETE['"]/.test(calendar),
    'Delete confirm button must be disabled unless DELETE is typed exactly');
});

test('C16 performDelete is wired to a button (not orphaned)', function() {
  assert(/onClick=\{performDelete\}/.test(calendar),
    'performDelete must be referenced from a button onClick');
});

// ============================================================
// C17-C20: Prominent overlay confirmation dialogs
// ============================================================

test('C17 Cancel confirmation renders as a top-level z-200 overlay', function() {
  // The fix for "I click cancel and nothing happens" — the inline
  // version was below the fold. The new overlay is impossible to miss.
  assert(/actionStage === ['"]cancel['"][\s\S]{0,300}z-\[200\]/.test(calendar),
    'Cancel confirmation must render as z-[200] overlay (above the modal)');
});

test('C18 Delete confirmation renders as a top-level z-200 overlay', function() {
  assert(/actionStage === ['"]delete['"][\s\S]{0,300}z-\[200\]/.test(calendar),
    'Delete confirmation must render as z-[200] overlay (above the modal)');
});

test('C19 Confirmation overlays render OUTSIDE the edit-modal IIFE', function() {
  // Otherwise they'd be inside the modal that has its own scroll/clipping.
  // The pattern we want: the IIFE closes }) (), then actionStage checks come.
  var afterIife = calendar.indexOf('})()}', calendar.indexOf("editEvent && (() =>"));
  assert(afterIife > -1, 'IIFE-style edit modal must exist and close properly');
  var afterIifeContent = calendar.slice(afterIife);
  assert(/actionStage === ['"]cancel['"]/.test(afterIifeContent),
    'cancel overlay must render after the edit-modal IIFE closes');
  assert(/actionStage === ['"]delete['"]/.test(afterIifeContent),
    'delete overlay must render after the edit-modal IIFE closes');
});

test('C20 Old inline confirmation block is removed', function() {
  // Make sure I didn't leave both inline AND overlay versions which would
  // double-render and confuse users
  // The old inline block was: ) : actionStage === 'cancel' ? ( <div className="bg-red-50 border-2 border-red-400
  assert(!/\)\s*:\s*actionStage === ['"]cancel['"]\s*\?\s*\(\s*\/?\*?[^<]*<div className="bg-red-50 border-2/.test(calendar),
    'Inline (button-replacement) cancel block should be replaced by overlay');
});

// ============================================================
// C21-C24: Permission gates show toasts (no silent failures)
// ============================================================

test('C21 canCancel function exists and gates by role', function() {
  assert(/const\s+canCancel\s*=\s*\(ev\)\s*=>/.test(calendar),
    'canCancel must be a function taking an event');
  assert(/isSuperAdmin/.test(calendar),
    'canCancel logic must reference isSuperAdmin');
});

test('C22 canDelete is super-admin only', function() {
  var match = calendar.match(/const\s+canDelete\s*=\s*\([^)]*\)\s*=>\s*\{[^}]+\}/);
  assert(match, 'canDelete must exist');
  assert(/isSuperAdmin/.test(match[0]),
    'canDelete must require super_admin');
});

test('C23 toast.error is called (not just logged) for permission denials', function() {
  // Count occurrences — at minimum cancel and delete denial paths
  var errCount = (calendar.match(/toast\.error\(/g) || []).length;
  assert(errCount >= 4, 'expected at least 4 toast.error calls, found ' + errCount);
});

test('C24 toast.success is called on successful cancel/delete', function() {
  assert(/toast\.success[\s\S]{0,200}Meeting cancelled/.test(calendar),
    'Successful cancel must show success toast');
  assert(/toast\.success[\s\S]{0,200}permanently deleted|Meeting permanently/.test(calendar),
    'Successful delete must show success toast');
});

// ============================================================
// P1-P4: Twilio Voice SDK bundled (no CDN dependency)
// ============================================================

test('P1 @twilio/voice-sdk is in package.json dependencies', function() {
  assert(pkg.dependencies && pkg.dependencies['@twilio/voice-sdk'],
    'package.json must include @twilio/voice-sdk in dependencies');
});

test('P2 PhoneWidget no longer fetches sdk.twilio.com via script tag', function() {
  assert(!/sdk\.twilio\.com\/js\/voice/.test(phone),
    'PhoneWidget must NOT load Voice SDK from sdk.twilio.com (use bundled npm import instead)');
});

test('P3 PhoneWidget uses dynamic import("@twilio/voice-sdk")', function() {
  assert(/import\(\s*['"]@twilio\/voice-sdk['"]\s*\)/.test(phone),
    'PhoneWidget must use dynamic import() to load the SDK from npm');
});

test('P4 PhoneWidget no longer references window.Twilio.Device', function() {
  // The old code did `new window.Twilio.Device(...)`. The new code uses
  // the imported class.
  assert(!/new\s+window\.Twilio\.Device/.test(phone),
    'PhoneWidget must use the imported Device class, not window.Twilio.Device');
});

// ============================================================
// P5-P7: Token endpoint robustness
// ============================================================

var tokenRoute = fs.readFileSync(path.join(REPO, 'src/app/api/phone/token/route.js'), 'utf8');

test('P5 Token route uses official twilio.jwt.AccessToken (not hand-rolled JWT)', function() {
  assert(/twilio\.jwt\.AccessToken/.test(tokenRoute),
    'Token route must use twilio.jwt.AccessToken (the hand-rolled JWT was rejected by SDK v2)');
});

test('P6 Token route returns clear error when env vars are missing', function() {
  assert(/Missing env vars/.test(tokenRoute),
    'Token route must return a clear missing-env-vars error');
  assert(/TWILIO_ACCOUNT_SID/.test(tokenRoute) && /TWILIO_API_KEY_SID/.test(tokenRoute),
    'Token route must check the four required Twilio env vars by name');
});

test('P7 Token route enforces user_id matches authenticated user (anti-impersonation)', function() {
  assert(/user_id mismatch/.test(tokenRoute),
    'Token route must reject when body.user_id does not match auth.user.id');
});

// ============================================================
// E1-E3: formatErr defensive coverage
// ============================================================

test('E1 PhoneWidget exports formatErr (so DOM Events do not yield "[object Event]")', function() {
  assert(/function\s+formatErr\(/.test(phone),
    'PhoneWidget must define a formatErr helper');
});

test('E2 formatErr handles DOM Event specifically', function() {
  assert(/instanceof Event/.test(phone),
    'formatErr must check for DOM Event type');
});

test('E3 PhoneWidget does NOT use raw "e.message || String(e)" pattern in catch blocks', function() {
  // That was the original "[object Event]" bug. We replaced ALL of them
  // with formatErr.
  // Look for the specific bad pattern:
  assert(!/setError\([^)]*['"][^'"]*['"]\s*\+\s*\(e\.message\s*\|\|\s*String\(e\)\)/.test(phone),
    'No catch handler should use the bad e.message || String(e) pattern any more');
});

// ============================================================
// S1-S3: SettingsTab phone-numbers auth fix (the "no numbers
// registered" message even after running s30 SQL)
// ============================================================

var settings = fs.readFileSync(path.join(REPO, 'src/components/SettingsTab.jsx'), 'utf8');
var phoneAuth = fs.readFileSync(path.join(REPO, 'src/lib/phone-auth.js'), 'utf8');

test('S1 SettingsTab GET /api/phone/numbers sends Authorization header', function() {
  // The bug: fetch('/api/phone/numbers') with no headers → server can't
  // identify the user → 401 → frontend shows "no numbers" even though SQL
  // populated 4 rows.
  var settingsLoadBlock = settings.match(/Fetch phone numbers[\s\S]{0,400}/);
  assert(settingsLoadBlock, 'phone numbers fetch block must exist');
  assert(/headers:\s*authHeader/.test(settingsLoadBlock[0])
      || /Authorization['"]?\s*:\s*['"]?Bearer/.test(settingsLoadBlock[0]),
    'GET /api/phone/numbers must include Authorization header');
});

test('S2 SettingsTab PATCH /api/phone/numbers also sends Authorization', function() {
  var patchBlock = settings.match(/method:\s*['"]PATCH['"][\s\S]{0,400}/);
  assert(patchBlock, 'PATCH block must exist');
  assert(/Authorization['"]?\s*:/.test(patchBlock[0]),
    'PATCH /api/phone/numbers must include Authorization header');
});

test('S3 phone-auth.js handles modern split-cookie format (sb-*-auth-token.0/.1)', function() {
  // Modern Supabase SSR clients split the auth cookie across multiple
  // numbered cookies because the JWT exceeds the per-cookie size limit.
  // Without this fallback, browsers that use the modern format silently
  // fail auth → empty number list.
  assert(/sb-\[\^=\]\*-auth-token\\\.\(\\d\+\)/.test(phoneAuth)
      || /-auth-token\\\.\(\\\\d\+\)/.test(phoneAuth)
      || /split.+auth-token/i.test(phoneAuth),
    'phone-auth.js must handle the .0/.1 split-cookie format');
});
console.log('\n========================================');
console.log('Passed: ' + passed + '   Failed: ' + failed);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
