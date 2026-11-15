// ============================================================
// v54.3 — Meeting permissions + decline + hard delete
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

test('P1 isSuperAdmin helper checks userProfile.role', function() {
  assert(/const isSuperAdmin = userProfile && userProfile\.role === 'super_admin'/.test(calendar),
    'super admin detection');
});

test('P2 canCancel allows creator, primary assignee, and super admin', function() {
  var m = calendar.match(/const canCancel = \(ev\) => \{[\s\S]*?\n  \};/);
  assert(m, 'canCancel defined');
  assert(/if \(isSuperAdmin\) return true/.test(m[0]), 'admin can');
  assert(/if \(ev\.created_by === myId\) return true/.test(m[0]), 'creator can');
  assert(/if \(ev\.assigned_to === myId\) return true/.test(m[0]), 'primary assignee can');
});

test('P3 canDelete is admin-only (hard delete is dangerous)', function() {
  var m = calendar.match(/const canDelete = \(ev\) => \{[\s\S]*?\n  \};/);
  assert(m, 'canDelete defined');
  assert(/return !!isSuperAdmin/.test(m[0]),
    'ONLY super admin can hard-delete');
});

test('P4 canDecline blocks creator from declining own meeting', function() {
  var m = calendar.match(/const canDecline = \(ev\) => \{[\s\S]*?\n  \};/);
  assert(m, 'canDecline defined');
  assert(/if \(ev\.created_by === myId\) return false/.test(m[0]),
    'creator cannot decline their own meeting');
});

test('P5 canDecline requires being an attendee', function() {
  var m = calendar.match(/const canDecline = \(ev\) => \{[\s\S]*?\n  \};/);
  assert(m, 'canDecline body');
  assert(/const inAttendees = Array\.isArray\(ev\.attendees\) && ev\.attendees\.indexOf\(myId\) !== -1/.test(m[0]),
    'checks attendees membership');
  assert(/if \(!inAttendees\) return false/.test(m[0]),
    'blocks non-attendees');
});

test('P6 canDecline blocks already-declined users', function() {
  var m = calendar.match(/const canDecline = \(ev\) => \{[\s\S]*?\n  \};/);
  assert(m, 'body');
  assert(/if \(alreadyDeclined\) return false/.test(m[0]),
    'already-declined cannot re-decline');
});

test('P7 hasDeclined helper for undecline button visibility', function() {
  assert(/const hasDeclined = \(ev\) => \{/.test(calendar),
    'hasDeclined helper');
});

// ===== HARD DELETE =====

test('D1 performDelete requires typed DELETE confirmation', function() {
  // v55.25 — typed-confirmation moved from window.prompt() to an inline
  // <input> in the z-200 overlay (window.prompt was being silently suppressed
  // by some browsers). The state variable is `actionTyped`.
  var m = calendar.match(/const performDelete = async[\s\S]*?\n  \};/);
  assert(m, 'performDelete defined');
  assert(/if \(actionTyped !== 'DELETE'\)/.test(m[0]),
    'must type DELETE exactly (actionTyped state)');
  // And confirm the overlay has the input wired:
  assert(/value=\{actionTyped\}[\s\S]{0,100}onChange=\{e => setActionTyped/.test(calendar),
    'overlay has input wired to setActionTyped');
});

test('D2 performDelete gated by canDelete (admin only)', function() {
  var m = calendar.match(/const performDelete = async[\s\S]*?\n  \};/);
  assert(m, 'body');
  assert(/if \(!canDelete\(editEvent\)\)/.test(m[0]),
    'permission check first');
});

test('D3 performDelete writes audit log BEFORE deleting the row', function() {
  // Critical: after the row is gone you can't reconstruct who deleted it,
  // so the audit entry must happen first.
  var m = calendar.match(/const performDelete = async[\s\S]*?\n  \};/);
  assert(m, 'body');
  var logIdx = m[0].indexOf('logActivity');
  var deleteIdx = m[0].indexOf(".delete()");
  assert(logIdx !== -1 && deleteIdx !== -1 && logIdx < deleteIdx,
    'logActivity called before the hard delete');
});

test('D4 performDelete uses hard DELETE (not soft cancel)', function() {
  var m = calendar.match(/const performDelete = async[\s\S]*?\n  \};/);
  assert(m, 'body');
  // v55.33 — bulk delete via .in('id', ids) instead of .eq('id', editEvent.id)
  // so 'following' and 'series' scope work too.
  assert(/supabase\.from\('calendar_events'\)\.delete\(\)\.in\('id', ids\)/.test(m[0]),
    'actually deletes via .in(id, ids)');
});

// ===== DECLINE =====

test('DC1 performDecline exists with permission gate', function() {
  // v55.33 — declineInvite renamed to performDecline (consistency with performCancel/performDelete)
  var m = calendar.match(/const performDecline = async[\s\S]*?\n  \};/);
  assert(m, 'performDecline defined');
  assert(/if \(!canDecline\(editEvent\)\)/.test(m[0]),
    'permission check');
});

test('DC2 performDecline reads reason from actionReason state (no window.prompt)', function() {
  // v55.33 — window.prompt removed because Chromium silently suppressed it
  // after a few uses on the same page. Reason now read from actionReason
  // state, populated by the in-modal decline stage input.
  var m = calendar.match(/const performDecline = async[\s\S]*?\n  \};/);
  assert(m, 'body');
  assert(!/window\.prompt\(/.test(m[0]),
    'no window.prompt in performDecline (was getting suppressed by browsers)');
  assert(/actionReason/.test(m[0]),
    'reads reason from actionReason state');
});

test('DC3 performDecline appends myId to declined_by array', function() {
  var m = calendar.match(/const performDecline = async[\s\S]*?\n  \};/);
  assert(m, 'body');
  assert(/newDeclinedBy = Array\.isArray\(editEvent\.declined_by\) \? editEvent\.declined_by\.slice\(\) : \[\]/.test(m[0]),
    'defensive copy of existing decline list');
  assert(/newDeclinedBy\.indexOf\(myId\) === -1\) newDeclinedBy\.push\(myId\)/.test(m[0]),
    'avoids duplicates');
});

test('DC4 performDecline stores reason in decline_reasons JSONB', function() {
  var m = calendar.match(/const performDecline = async[\s\S]*?\n  \};/);
  assert(m, 'body');
  assert(/if \(reason\) newReasons\[myId\] = reason/.test(m[0]),
    'reason keyed by user id; only stored when provided');
});

test('DC5 performDecline emails the creator via /api/notify', function() {
  var m = calendar.match(/const performDecline = async[\s\S]*?\n  \};/);
  assert(m, 'body');
  assert(/fetch\('\/api\/notify'/.test(m[0]),
    'hits the notify endpoint');
  // Correct payload shape for /api/notify
  assert(/recipientIds: \[creator\.id\]/.test(m[0]),
    'targets the creator user id');
  assert(/type: 'event_declined'/.test(m[0]),
    'distinct notification type');
  assert(/triggeredBy: myId/.test(m[0]),
    'audit trail: who declined');
});

test('DC6 performDecline email failure does NOT block the decline', function() {
  var m = calendar.match(/const performDecline = async[\s\S]*?\n  \};/);
  assert(m, 'body');
  // The email fetch is inside its own try/catch that just swallows errors
  assert(/\} catch \(e\) \{ \/\* email is best-effort; don't block the decline \*\/ \}/.test(m[0]),
    'email wrapped in separate try/catch so a notify failure does not abort the state change');
});

test('DC7 undeclineInvite removes myId and clears reason', function() {
  var m = calendar.match(/const undeclineInvite = async[\s\S]*?\n  \};/);
  assert(m, 'undeclineInvite defined');
  assert(/newDeclinedBy = \(editEvent\.declined_by \|\| \[\]\)\.filter\(\(id\) => id !== myId\)/.test(m[0]),
    'filter-out self');
  assert(/delete newReasons\[myId\]/.test(m[0]),
    'clear any reason text');
});

// ===== MODAL UI =====

test('UI1 Cancel button rendered ALWAYS — permission enforced in handler (v55.25 state-machine)', function() {
  // v55.25 — button click does the canCancel() check (toast on denial),
  // then transitions to actionStage='cancel'. The z-200 overlay's confirm
  // button calls performCancel().
  assert(/setActionStage\('cancel'\)/.test(calendar),
    'cancel button transitions to actionStage cancel');
  assert(/onClick=\{performCancel\}/.test(calendar),
    'overlay confirm wires performCancel');
  assert(!/\{canCancel\(editEvent\) && \(\s*<button[^>]*setActionStage\('cancel'\)/.test(calendar),
    'no longer gated at render layer (handler shows toast if user lacks rights)');
});

test('UI2 Delete button rendered ALWAYS — permission enforced in handler (v55.25 state-machine)', function() {
  // v55.25 — same pattern as cancel; click → canDelete() check → setActionStage('delete')
  // → typing DELETE in the overlay enables the confirm button → performDelete().
  assert(/setActionStage\('delete'\)/.test(calendar),
    'delete button transitions to actionStage delete');
  assert(/onClick=\{performDelete\}/.test(calendar),
    'overlay confirm wires performDelete');
  assert(!/\{canDelete\(editEvent\) && \(\s*<button[^>]*setActionStage\('delete'\)/.test(calendar),
    'no longer gated at render layer');
});

test('UI3 Decline button gated by canDecline() (attendees only)', function() {
  assert(/\{canDecline\(editEvent\) && \(/.test(calendar),
    'decline button conditional on permission');
  assert(/Decline invitation/.test(calendar),
    'decline label');
});

test('UI4 Undecline (Accept) button shown only when user has declined', function() {
  assert(/\{hasDeclined\(editEvent\) && \(/.test(calendar),
    'undecline button conditional');
  assert(/Accept invitation \(you had declined\)/.test(calendar),
    'label makes the state reversal clear');
});

test('UI5 Modal shows roster of who has declined', function() {
  assert(/Array\.isArray\(editEvent\.declined_by\) && editEvent\.declined_by\.length > 0/.test(calendar),
    'declined list conditional');
  assert(/editEvent\.decline_reasons && editEvent\.decline_reasons\[uid\]/.test(calendar),
    'reasons shown inline per decliner');
});

// ===== SQL MIGRATION =====

test('SQL1 s25 migration file exists', function() {
  assert(fs.existsSync(path.join(REPO, 'sql/s25_attendee_decline.sql')),
    's25 file present');
});

test('SQL2 Adds declined_by UUID[] column', function() {
  var sql = fs.readFileSync(path.join(REPO, 'sql/s25_attendee_decline.sql'), 'utf8');
  assert(/ADD COLUMN IF NOT EXISTS declined_by UUID\[\] DEFAULT '\{\}'/.test(sql),
    'declined_by array column');
});

test('SQL3 Adds decline_reasons JSONB column', function() {
  var sql = fs.readFileSync(path.join(REPO, 'sql/s25_attendee_decline.sql'), 'utf8');
  assert(/ADD COLUMN IF NOT EXISTS decline_reasons JSONB DEFAULT '\{\}'::jsonb/.test(sql),
    'decline_reasons jsonb');
});

test('SQL4 GIN index on declined_by for fast lookups', function() {
  var sql = fs.readFileSync(path.join(REPO, 'sql/s25_attendee_decline.sql'), 'utf8');
  assert(/CREATE INDEX IF NOT EXISTS idx_events_declined_by ON calendar_events USING GIN \(declined_by\)/.test(sql),
    'GIN index');
});

test('SQL5 Idempotent with duplicate_table guard on backup', function() {
  var sql = fs.readFileSync(path.join(REPO, 'sql/s25_attendee_decline.sql'), 'utf8');
  assert(/EXCEPTION WHEN duplicate_table/.test(sql), 'safe re-run');
  assert(/IF NOT EXISTS/.test(sql), 'IF NOT EXISTS on columns + index');
});

console.log('');
console.log('──────────────────────────────────────────────────');
console.log('V54.3 — PERMISSIONS + DECLINE + HARD DELETE');
console.log('──────────────────────────────────────────────────');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) { console.log('\n❌ FAILURES'); process.exit(1); }
else console.log('\n✅ All v54.3 tests passed');
