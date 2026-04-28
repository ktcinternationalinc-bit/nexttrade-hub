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

test('C1 performCancel gated by canCancel', function() {
  // v55.25 — cancelMeeting was renamed to performCancel as part of the
  // state-machine refactor (button → setActionStage('cancel') → overlay → performCancel).
  var m = calendar.match(/const performCancel = async[\s\S]*?\n  \};/);
  assert(m, 'performCancel defined');
  assert(/if \(!canCancel\(editEvent\)\)/.test(m[0]),
    'permission check present');
});

test('C2 performCancel writes status + cancelled_at + cancelled_by + reason', function() {
  var m = calendar.match(/const performCancel = async[\s\S]*?\n  \};/);
  assert(m, 'handler body');
  assert(/status: 'cancelled'/.test(m[0]), 'sets cancelled status');
  assert(/cancelled_at: new Date\(\)\.toISOString\(\)/.test(m[0]), 'timestamp');
  assert(/cancelled_by: myId/.test(m[0]), 'user id');
  assert(/cancellation_reason/.test(m[0]), 'reason field');
});

// ===== DELETE =====

test('D1 performDelete gated by canDelete (admin only)', function() {
  // v55.25 — deleteMeeting renamed to performDelete (state-machine refactor).
  var m = calendar.match(/const performDelete = async[\s\S]*?\n  \};/);
  assert(m, 'performDelete defined');
  assert(/if \(!canDelete\(editEvent\)\)/.test(m[0]),
    'admin-only gate');
});

test('D2 performDelete requires typing DELETE exactly', function() {
  var m = calendar.match(/const performDelete = async[\s\S]*?\n  \};/);
  assert(m, 'body');
  // v55.25 — `typed` state was renamed to `actionTyped` for the unified
  // confirmation overlay (used by both cancel-with-reason and delete-with-confirm).
  assert(/if \(actionTyped !== 'DELETE'\)/.test(m[0]),
    'strict DELETE match (actionTyped)');
});

test('D3 performDelete writes audit row BEFORE deleting', function() {
  var m = calendar.match(/const performDelete = async[\s\S]*?\n  \};/);
  assert(m, 'body');
  // logActivity must appear before the .delete() call
  var logIdx = m[0].indexOf('logActivity');
  var delIdx = m[0].indexOf(".from('calendar_events').delete()");
  assert(logIdx > -1 && delIdx > -1 && logIdx < delIdx,
    'audit row logged before delete so we can trace even after removal');
});

test('D4 performDelete physically removes the row', function() {
  var m = calendar.match(/const performDelete = async[\s\S]*?\n  \};/);
  assert(m, 'body');
  // v55.33 — bulk delete via .in('id', ids) instead of .eq('id', editEvent.id)
  // so 'following' and 'series' scope work too.
  assert(/supabase\.from\('calendar_events'\)\.delete\(\)\.in\('id', ids\)/.test(m[0]),
    'hard delete via DB using .in(id, ids)');
});

// ===== DECLINE =====

test('De1 performDecline gated by canDecline', function() {
  // v55.33 — declineInvite renamed to performDecline (matches performCancel/performDelete naming)
  var m = calendar.match(/const performDecline = async[\s\S]*?\n  \};/);
  assert(m, 'performDecline defined');
  assert(/if \(!canDecline\(editEvent\)\)/.test(m[0]),
    'permission check');
});

test('De2 performDecline adds self to declined_by[] without removing from attendees', function() {
  // v55.33 — declinePatch is now built as a separate const so the test can
  // verify the patch shape directly. attendees: must NOT appear in declinePatch.
  var m = calendar.match(/const performDecline = async[\s\S]*?\n  \};/);
  assert(m, 'body');
  // declined_by gets the user pushed
  assert(/newDeclinedBy\.push\(myId\)/.test(m[0]),
    'adds self to declined_by');
  // The patch is stored in declinePatch — verify it exists and does NOT include attendees
  var declinePatchBlock = m[0].match(/declinePatch\s*=\s*\{[\s\S]*?\}/);
  assert(declinePatchBlock, 'declinePatch object literal found');
  assert(!/attendees:/.test(declinePatchBlock[0]),
    'declinePatch does NOT include attendees (kept in attendees[] for history + re-accept)');
});

test('De3 performDecline records reason in decline_reasons{} if provided', function() {
  var m = calendar.match(/const performDecline = async[\s\S]*?\n  \};/);
  assert(m, 'body');
  assert(/newReasons\[myId\] = reason/.test(m[0]),
    'reason stored keyed by user id');
});

test('De4 performDecline sends email to creator via /api/notify', function() {
  var m = calendar.match(/const performDecline = async[\s\S]*?\n  \};/);
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

test('UI1 Cancel button rendered ALWAYS — permission checked in click handler (v55.25 state-machine)', function() {
  // v55.25: cancel button is always visible. Click handler does the permission
  // check (with toast error), then transitions to actionStage='cancel' which
  // renders the z-200 confirmation overlay. The overlay's confirm button calls
  // performCancel(). Two-stage UI replaced the old direct-call flow because
  // window.prompt() was getting silently suppressed in some browsers.
  assert(/setActionStage\('cancel'\)/.test(calendar),
    'cancel button transitions to actionStage cancel');
  assert(/onClick=\{performCancel\}/.test(calendar),
    'overlay confirm button wires performCancel');
  // No render-gating wrapper around the cancel button:
  assert(!/\{canCancel\(editEvent\) && \(\s*<button[^>]*setActionStage\('cancel'\)/.test(calendar),
    'cancel button no longer gated at render time');
});

test('UI2 Decline button rendered only when canDecline', function() {
  // v55.33 — decline button now opens an in-modal stage instead of calling
  // declineInvite directly (window.prompt was getting silently suppressed)
  assert(/\{canDecline\(editEvent\) && \(/.test(calendar),
    'decline button gated on permission');
  assert(/setActionStage\('decline'\)/.test(calendar),
    'decline button transitions to actionStage decline');
});

test('UI3 Delete button rendered ALWAYS — permission checked in click handler (v55.25 state-machine)', function() {
  // v55.25: same pattern as cancel — button always visible, click handler
  // checks canDelete() and shows toast on denial, then transitions to
  // actionStage='delete'. Overlay confirm button (after typing DELETE)
  // calls performDelete().
  assert(/setActionStage\('delete'\)/.test(calendar),
    'delete button transitions to actionStage delete');
  assert(/onClick=\{performDelete\}/.test(calendar),
    'overlay confirm button wires performDelete');
  assert(!/\{canDelete\(editEvent\) && \(\s*<button[^>]*setActionStage\('delete'\)/.test(calendar),
    'delete button no longer gated at render time');
});

test('UI4 Previously-declined users see an Accept button instead of Decline', function() {
  assert(/\{hasDeclined\(editEvent\) && \(\s*<button\s*onClick=\{undeclineInvite\}/.test(calendar),
    're-accept button shown when already declined');
});

test('UI5 Cancelled events show a Restore button instead of Cancel', function() {
  // v55.33 — Restore button now opens setActionStage('restore') for the in-modal
  // confirmation flow with scope picker (was direct uncancelMeeting call)
  assert(/editEvent\.status === 'cancelled' \?[\s\S]{0,500}setActionStage\('restore'\)/.test(calendar),
    'restore flow uses actionStage');
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
