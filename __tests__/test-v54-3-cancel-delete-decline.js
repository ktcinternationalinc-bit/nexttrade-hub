// ============================================================
// v54.3 — Calendar role-based actions (cancel / delete / decline)
// ============================================================
//
// Rules:
//   canCancel   = creator OR assigned_to OR super_admin
//   canDelete   = super_admin ONLY (typed-DELETE confirm)
//   canDecline  = attendee who is NOT creator AND NOT already declined
//
// Decline flow:
//   - Adds self to declined_by[]
//   - Records optional reason in decline_reasons{}
//   - Emails the creator via /api/notify
//   - Event stays scheduled for everyone else
//   - User can un-decline (accept again) later
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

var calendar = fs.readFileSync(path.join(REPO, 'src/components/CalendarTab.jsx'), 'utf8');

// ===== PERMISSION HELPERS =====

test('P1 isSuperAdmin flag derived from userProfile.role', function() {
  assert(/const isSuperAdmin = userProfile && userProfile\.role === 'super_admin'/.test(calendar),
    'admin flag present');
});

test('P2 canCancel allows creator, admin, or primary assignee', function() {
  var m = calendar.match(/const canCancel = \(ev\) => \{[\s\S]*?\n  \};/);
  assert(m, 'canCancel defined');
  var body = m[0];
  assert(/if \(isSuperAdmin\) return true/.test(body), 'admin override');
  assert(/if \(ev\.created_by === myId\) return true/.test(body), 'creator can cancel');
  assert(/if \(ev\.assigned_to === myId\) return true/.test(body), 'primary assignee can cancel');
});

test('P3 canDelete is super_admin ONLY (hard delete is dangerous)', function() {
  var m = calendar.match(/const canDelete = \(ev\) => \{[\s\S]*?\n  \};/);
  assert(m, 'canDelete defined');
  var body = m[0];
  assert(/return !!isSuperAdmin/.test(body),
    'only returns true for admins');
  // Must NOT include a generic "creator can delete" branch — that would
  // permit accidental permanent loss
  assert(!/ev\.created_by === myId.*return true/.test(body),
    'creator alone cannot delete (only soft-cancel)');
});

test('P4 canDecline: attendee only, not creator, not already declined', function() {
  var m = calendar.match(/const canDecline = \(ev\) => \{[\s\S]*?\n  \};/);
  assert(m, 'canDecline defined');
  var body = m[0];
  // Creator can't decline their own meeting
  assert(/if \(ev\.created_by === myId\) return false/.test(body),
    'creator blocked from declining');
  // Must be in attendees
  assert(/attendees\.indexOf\(myId\) !== -1/.test(body),
    'checks attendees membership');
  // Must not be already declined
  assert(/alreadyDeclined = Array\.isArray\(ev\.declined_by\) && ev\.declined_by\.indexOf\(myId\) !== -1/.test(body),
    'checks existing decline');
  assert(/if \(alreadyDeclined\) return false/.test(body),
    'blocks re-decline');
});

test('P5 hasDeclined helper for UI rendering', function() {
  assert(/const hasDeclined = \(ev\) => \{[\s\S]*?\n  \}/.test(calendar),
    'hasDeclined defined');
  assert(/ev\.declined_by\.indexOf\(myId\) !== -1/.test(calendar),
    'checks declined_by array');
});

// ===== CANCEL =====

test('C1 cancelMeeting gated by canCancel', function() {
  var m = calendar.match(/const cancelMeeting = async[\s\S]*?\n  \};/);
  assert(m, 'cancelMeeting defined');
  assert(/if \(!canCancel\(editEvent\)\)/.test(m[0]),
    'permission check present');
});

test('C2 cancelMeeting writes status + cancelled_at + cancelled_by + reason', function() {
  var m = calendar.match(/const cancelMeeting = async[\s\S]*?\n  \};/);
  assert(m, 'handler body');
  assert(/status: 'cancelled'/.test(m[0]), 'sets cancelled status');
  assert(/cancelled_at: new Date\(\)\.toISOString\(\)/.test(m[0]), 'timestamp');
  assert(/cancelled_by: myId/.test(m[0]), 'user id');
  assert(/cancellation_reason/.test(m[0]), 'reason field');
});

// ===== DELETE =====

test('D1 deleteMeeting gated by canDelete (admin only)', function() {
  var m = calendar.match(/const deleteMeeting = async[\s\S]*?\n  \};/);
  assert(m, 'deleteMeeting defined');
  assert(/if \(!canDelete\(editEvent\)\)/.test(m[0]),
    'admin-only gate');
});

test('D2 deleteMeeting requires typing DELETE exactly', function() {
  var m = calendar.match(/const deleteMeeting = async[\s\S]*?\n  \};/);
  assert(m, 'body');
  assert(/if \(typed !== 'DELETE'\)/.test(m[0]),
    'strict DELETE match');
});

test('D3 deleteMeeting writes audit row BEFORE deleting', function() {
  var m = calendar.match(/const deleteMeeting = async[\s\S]*?\n  \};/);
  assert(m, 'body');
  // logActivity must appear before the .delete() call
  var logIdx = m[0].indexOf('logActivity');
  var delIdx = m[0].indexOf(".from('calendar_events').delete()");
  assert(logIdx > -1 && delIdx > -1 && logIdx < delIdx,
    'audit row logged before delete so we can trace even after removal');
});

test('D4 deleteMeeting physically removes the row', function() {
  var m = calendar.match(/const deleteMeeting = async[\s\S]*?\n  \};/);
  assert(m, 'body');
  assert(/supabase\.from\('calendar_events'\)\.delete\(\)\.eq\('id', editEvent\.id\)/.test(m[0]),
    'hard delete via DB');
});

// ===== DECLINE =====

test('De1 declineInvite gated by canDecline', function() {
  var m = calendar.match(/const declineInvite = async[\s\S]*?\n  \};/);
  assert(m, 'declineInvite defined');
  assert(/if \(!canDecline\(editEvent\)\)/.test(m[0]),
    'permission check');
});

test('De2 declineInvite adds self to declined_by[] without removing from attendees', function() {
  var m = calendar.match(/const declineInvite = async[\s\S]*?\n  \};/);
  assert(m, 'body');
  // declined_by gets the user pushed
  assert(/newDeclinedBy\.push\(myId\)/.test(m[0]),
    'adds self to declined_by');
  // attendees[] is NOT mutated — event still shows (crossed out) on user's cal
  // The dbUpdate payload contains declined_by but not attendees
  var update = m[0].match(/dbUpdate\('calendar_events', editEvent\.id, \{[\s\S]*?\}, myId\)/);
  assert(update, 'dbUpdate call');
  assert(!/attendees:/.test(update[0]),
    'does NOT strip user from attendees (kept for history + re-accept)');
});

test('De3 declineInvite records reason in decline_reasons{} if provided', function() {
  var m = calendar.match(/const declineInvite = async[\s\S]*?\n  \};/);
  assert(m, 'body');
  assert(/newReasons\[myId\] = reason/.test(m[0]),
    'reason stored keyed by user id');
});

test('De4 declineInvite sends email to creator via /api/notify', function() {
  var m = calendar.match(/const declineInvite = async[\s\S]*?\n  \};/);
  assert(m, 'body');
  assert(/fetch\('\/api\/notify'/.test(m[0]),
    'calls notify API');
  assert(/recipientIds: \[creator\.id\]/.test(m[0]),
    'email goes to the event creator specifically');
  assert(/declined/.test(m[0]),
    'subject/body mentions decline');
});

test('De5 undeclineInvite lets user re-accept a previously declined invite', function() {
  assert(/const undeclineInvite = async/.test(calendar),
    'undecline handler exists');
  // Removes self from declined_by
  var m = calendar.match(/const undeclineInvite = async[\s\S]*?\n  \};/);
  assert(m, 'body');
  // Accept either arrow or function(u) style
  assert(/\.filter\(\(id\) => id !== myId\)/.test(m[0])
      || /\.filter\(function\(u\) \{ return u !== myId; \}\)/.test(m[0])
      || /\.filter\(\(u\) => u !== myId\)/.test(m[0])
      || /\.filter\(id => id !== myId\)/.test(m[0]),
    'removes self from declined_by (any filter style)');
});

// ===== UI WIRING =====

test('UI1 Cancel button rendered only when canCancel', function() {
  assert(/\{canCancel\(editEvent\) && \(\s*<button\s*onClick=\{cancelMeeting\}/.test(calendar),
    'cancel button gated');
});

test('UI2 Decline button rendered only when canDecline', function() {
  assert(/\{canDecline\(editEvent\) && \(\s*<button\s*onClick=\{declineInvite\}/.test(calendar),
    'decline button gated');
});

test('UI3 Delete button rendered only when canDelete', function() {
  assert(/\{canDelete\(editEvent\) && \(\s*<button\s*onClick=\{deleteMeeting\}/.test(calendar),
    'delete button gated');
});

test('UI4 Previously-declined users see an Accept button instead of Decline', function() {
  assert(/\{hasDeclined\(editEvent\) && \(\s*<button\s*onClick=\{undeclineInvite\}/.test(calendar),
    're-accept button shown when already declined');
});

test('UI5 Cancelled events show a Restore button instead of Cancel', function() {
  // Already wired in v54.1
  assert(/editEvent\.status === 'cancelled' \?[\s\S]{0,500}onClick=\{uncancelMeeting\}/.test(calendar),
    'restore flow preserved');
});

// ===== SQL MIGRATION =====

test('SQL1 s25 migration exists', function() {
  assert(fs.existsSync(path.join(REPO, 'sql/s25_attendee_decline.sql')),
    's25 migration file present');
});

test('SQL2 s25 adds declined_by UUID[] + decline_reasons JSONB + GIN index', function() {
  var sql = fs.readFileSync(path.join(REPO, 'sql/s25_attendee_decline.sql'), 'utf8');
  assert(/ADD COLUMN IF NOT EXISTS declined_by UUID\[\]/.test(sql),
    'declined_by array column');
  assert(/ADD COLUMN IF NOT EXISTS decline_reasons JSONB/.test(sql),
    'decline_reasons JSONB');
  assert(/CREATE INDEX IF NOT EXISTS idx_events_declined_by ON calendar_events USING GIN/.test(sql),
    'GIN index for fast "my declined meetings" lookup');
});

test('SQL3 s25 migration is idempotent (IF NOT EXISTS)', function() {
  var sql = fs.readFileSync(path.join(REPO, 'sql/s25_attendee_decline.sql'), 'utf8');
  assert(/IF NOT EXISTS/.test(sql), 'idempotent column adds');
});

console.log('');
console.log('──────────────────────────────────────────────────');
console.log('V54.3 — CANCEL/DELETE/DECLINE WITH ROLE PERMS');
console.log('──────────────────────────────────────────────────');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) { console.log('\n❌ FAILURES'); process.exit(1); }
else console.log('\n✅ All v54.3 tests passed');
