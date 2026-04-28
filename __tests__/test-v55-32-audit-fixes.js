// ============================================================
// v55.32 — Calendar + Voicemail audit re-apply
// ============================================================
// SCOPE: Re-applies 11 audit fixes (3 voicemail security, 8 calendar
// correctness/UX) plus 1 lower-priority calendar fix (Bug 14: multi-
// attendee notes). The fixes were authored in a prior session and
// passed tests there, but the code was lost when the working zip was
// rebuilt for WhatsApp work. This test file is the regression guard:
// any future session that loses these patches will see this file fail
// loudly instead of the bugs silently coming back.
//
// Each test maps to a specific audit finding.
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

var calTab = fs.readFileSync(path.join(REPO, 'src/components/CalendarTab.jsx'), 'utf8');
var recordingStream = fs.readFileSync(path.join(REPO, 'src/app/api/phone/recording-stream/route.js'), 'utf8');
var transcribeAsync = fs.readFileSync(path.join(REPO, 'src/app/api/phone/transcribe-async/route.js'), 'utf8');
var transcribeCron = fs.readFileSync(path.join(REPO, 'src/app/api/phone/transcribe-cron/route.js'), 'utf8');
var page = fs.readFileSync(path.join(REPO, 'src/app/page.jsx'), 'utf8');

console.log('\n──────────────────────────────────────────────────');
console.log('V55.32 — CALENDAR + VOICEMAIL AUDIT FIXES');
console.log('──────────────────────────────────────────────────');

// ============================================================
// VOICEMAIL SECURITY FIXES
// ============================================================

test('VM Bug 7: recording-stream imports requireUser', function() {
  assert(/import \{ requireUser \} from/.test(recordingStream),
    'requireUser import present');
});

test('VM Bug 7: recording-stream calls requireUser at start', function() {
  assert(/var auth = await requireUser\(req\)/.test(recordingStream),
    'requireUser actually called');
  assert(/return new Response\('Authentication required', \{ status: 401 \}\)/.test(recordingStream),
    'returns 401 when no auth');
});

test('VM Bug 7: recording-stream enforces ownership (not just auth)', function() {
  assert(/Not authorized to listen to this recording/.test(recordingStream),
    'returns 403 for non-owner non-admin');
  // Voicemails own through assigned_to
  assert(/ownerId = lookup\.data\.assigned_to/.test(recordingStream),
    'voicemails: assigned_to is the owner');
  // Recordings own through parent call's user_id
  assert(/from\('phone_calls'\)[\s\S]{0,200}\.eq\('id', lookup\.data\.call_id\)/.test(recordingStream),
    'recordings: lookup parent call.user_id');
});

test('VM Bug 7: admins/super_admins bypass ownership check', function() {
  assert(/isAdmin\([^)]+\)/.test(recordingStream),
    'isAdmin helper invoked');
  assert(/role === 'admin' \|\| role === 'super_admin'/.test(recordingStream),
    'admin OR super_admin bypass logic');
});

test('VM Bug 4: transcribe-async no longer accepts spoofable Origin/Referer', function() {
  // The vulnerable check was: host header indexOf'd against origin/referer.
  // Both Origin and Referer are user-controllable, so any HTTP client
  // could set them and pass the check. Removed entirely.
  assert(!/origin\.indexOf\(host\)/.test(transcribeAsync),
    'old same-origin check is GONE');
  assert(!/req\.headers\.get\('referer'\)/.test(transcribeAsync),
    'no longer reads Referer header for auth');
});

test('VM Bug 4: transcribe-async only accepts INTERNAL_SECRET or Vercel cron', function() {
  assert(/INTERNAL_SECRET/.test(transcribeAsync),
    'INTERNAL_SECRET path present');
  assert(/CRON_SECRET/.test(transcribeAsync),
    'Vercel cron secret path present');
});

test('VM Bug 5: transcribe-cron passes INTERNAL_SECRET on voicemail calls', function() {
  // After Bug 4 fix removed the same-origin escape hatch, the cron HAS to
  // present INTERNAL_SECRET or transcribe-async rejects everything.
  assert(/X-Internal-Trigger['"]\s*\]\s*=\s*process\.env\.INTERNAL_SECRET/.test(transcribeCron),
    'cron sets X-Internal-Trigger header');
  // And it must do so on BOTH the voicemail and recording paths
  assert((transcribeCron.match(/X-Internal-Trigger/g) || []).length >= 2,
    'header set on both voicemail and recording calls');
});

// ============================================================
// CALENDAR FIXES — UX
// ============================================================

test('Cal Bug 1/2: cancelled events get strikethrough + ❌ in month view', function() {
  // Month view render path
  assert(/isCancelled = ev\.status === 'cancelled'/.test(calTab),
    'cancelled detection in render');
  assert(/isCancelled \? '❌ ' : ''/.test(calTab),
    '❌ prefix on cancelled events');
  // line-through opacity-50 should appear in the visualClasses logic
  assert(/(ev\.completed \|\| isCancelled)[\s\S]{0,80}line-through opacity-50/.test(calTab),
    'cancelled events get line-through styling');
});

test('Cal Bug 11: declined events filtered from "My" calendar view', function() {
  assert(/iDeclined = Array\.isArray\(e\.declined_by\) && e\.declined_by\.indexOf\(myId\) !== -1/.test(calTab),
    'declined detection in visibleEvents');
  assert(/if \(iDeclined\) return false/.test(calTab),
    'declined events excluded from My view');
});

// ============================================================
// CALENDAR FIXES — SECURITY
// ============================================================

test('Cal Bug 15/16: meeting note edit/delete requires ownership or admin', function() {
  assert(/canModifyNote = \(n\) =>/.test(calTab),
    'canModifyNote helper exists');
  assert(/n\.author_id === myId \|\| isAdmin/.test(calTab),
    'ownership = author OR admin');
  // saveEditedNote calls canModifyNote
  assert(/saveEditedNote[\s\S]{0,500}canModifyNote\(note\)/.test(calTab),
    'saveEditedNote enforces canModifyNote');
  // deleteNote calls canModifyNote
  assert(/deleteNote[\s\S]{0,300}canModifyNote\(note\)/.test(calTab),
    'deleteNote enforces canModifyNote');
});

// ============================================================
// CALENDAR FIXES — CORRECTNESS
// ============================================================

test('Cal Bug 3: saveEditEvent reschedules reminders for ALL attendees', function() {
  // Old code only reminded editEvent.assigned_to — the primary owner.
  // New code unions attendees[] with assigned_to and reschedules for all.
  assert(/freshRecipients[\s\S]{0,300}fresh\.attendees\.slice\(\)/.test(calTab),
    'single-edit path: walks attendees array');
  assert(/sibRecipients[\s\S]{0,300}sib\.attendees\.slice\(\)/.test(calTab),
    'series-edit path: walks attendees array per occurrence');
});

test('Cal Bug 6: series cancellation uses dbUpdate per row (audit trail)', function() {
  // Old code did a single `.from(...).update().eq(series_id, ...)` which
  // bypassed the audited dbUpdate helper. New code loops siblings and
  // calls dbUpdate on each so every cancellation is audited.
  var cancelFn = calTab.match(/performCancel = async \(\) => \{[\s\S]+?\n  \};/);
  assert(cancelFn, 'performCancel fn found');
  assert(/for \(const sib of \(siblings \|\| \[\]\)\)/.test(cancelFn[0]),
    'series cancel loops through siblings');
  assert(/dbUpdate\('calendar_events', sib\.id, cancelPatch/.test(cancelFn[0]),
    'each sibling cancel goes through dbUpdate (audited)');
  // And the OLD bypass pattern should NOT be present anymore
  assert(!/\.update\(cancelPatch\)\s*\.eq\('series_id'/.test(cancelFn[0]),
    'old un-audited bulk update is GONE');
});

test('Cal Bug 7 (calendar): performDelete respects editScope', function() {
  // Old code always deleted only the single row, even when scope=series.
  // That orphaned all child occurrences with broken series_id pointers.
  var deleteFn = calTab.match(/performDelete = async \(\) => \{[\s\S]+?\n  \};/);
  assert(deleteFn, 'performDelete fn found');
  assert(/editScope === 'series' && editEvent\.series_id/.test(deleteFn[0]),
    'performDelete branches on editScope');
  assert(/\.delete\(\)\.eq\('series_id', editEvent\.series_id\)/.test(deleteFn[0]),
    'series-scope delete removes by series_id (not just single row id)');
});

test('Cal Bug 8: actionBusy reset on success in performCancel + performDelete', function() {
  // Old code only reset on the catch path. Quick-reopening another event
  // saw frozen buttons. New code resets on success too.
  // Find each function and verify it calls setActionBusy(false) before
  // closeEditEvent in the success path.
  var cancelFn = calTab.match(/performCancel = async \(\) => \{[\s\S]+?\n  \};/);
  var deleteFn = calTab.match(/performDelete = async \(\) => \{[\s\S]+?\n  \};/);
  assert(cancelFn, 'performCancel fn found');
  assert(deleteFn, 'performDelete fn found');
  // Each should have setActionBusy(false) appearing TWICE (once on success,
  // once on catch). Old code had only one occurrence.
  var cancelResets = (cancelFn[0].match(/setActionBusy\(false\)/g) || []).length;
  var deleteResets = (deleteFn[0].match(/setActionBusy\(false\)/g) || []).length;
  assert(cancelResets >= 2, 'performCancel resets actionBusy on both success and catch (got ' + cancelResets + ')');
  assert(deleteResets >= 2, 'performDelete resets actionBusy on both success and catch (got ' + deleteResets + ')');
});

// ============================================================
// CALENDAR FIXES — LOWER-PRIORITY (Bug 14)
// ============================================================

test('Cal Bug 14: side-attendee posting note does NOT mark event completed', function() {
  // Posting a note used to stamp completed:true on the parent event for
  // the FIRST poster, regardless of who they were. So a side-attendee
  // adding a quick note marked the event "attended" for everyone before
  // the owner even joined. Now: only owner/creator posts trigger the
  // completion stamp.
  assert(/isOwnerOrCreator = \(notesEvent\.assigned_to === myId\) \|\| \(notesEvent\.created_by === myId\)/.test(calTab),
    'isOwnerOrCreator check in postNewNote');
  assert(/if \(!wasCompleted && isOwnerOrCreator\)/.test(calTab),
    'completion stamp gated by isOwnerOrCreator');
});

// ============================================================
// BUILD STAMP
// ============================================================

test('Build stamp bumped to v55.32', function() {
  assert(/>v55\.32</.test(page),
    'page.jsx build stamp shows v55.32');
});

// ============================================================
// SUMMARY
// ============================================================

console.log('\n──────────────────────────────────────────────────');
console.log('Passed: ' + passed + '   Failed: ' + failed);
console.log('──────────────────────────────────────────────────\n');
process.exit(failed > 0 ? 1 : 0);
