// ============================================================
// v54.1 — Priority Board contrast + Calendar cancel + multi-attendee
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

var board    = fs.readFileSync(path.join(REPO, 'src/components/PriorityBoard.jsx'), 'utf8');
var calendar = fs.readFileSync(path.join(REPO, 'src/components/CalendarTab.jsx'), 'utf8');

// ===== PRIORITY BOARD — TICKET NUMBER + CONTRAST =====

test('PB1 Ticket card shows ticket_number', function() {
  assert(/\{t\.ticket_number && \(/.test(board),
    'conditional render of ticket_number');
  assert(/\{t\.ticket_number\}/.test(board),
    'actually outputs t.ticket_number');
});

test('PB2 Starred cards use stronger amber for visibility', function() {
  // Was from-amber-50 to-white (nearly invisible). Now from-amber-200 to-amber-100.
  assert(/from-amber-200 to-amber-100/.test(board),
    'stronger amber gradient');
  assert(/border-amber-500 border-2/.test(board),
    'bold border');
  assert(/shadow-amber-300/.test(board),
    'stronger shadow');
});

test('PB3 Starred cards use darker text for readability', function() {
  // Title text switches to slate-900 (near-black) when starred
  assert(/isStarred \? 'text-slate-900' : 'text-slate-800'/.test(board),
    'title darker on amber');
  // Ticket number uses amber-900 on starred (very dark, readable on amber-200)
  assert(/isStarred \? 'text-amber-900' : 'text-slate-500'/.test(board),
    'ticket number contrast');
});

test('PB4 Due date + "+N others" also have contrast-adjusted colors on starred', function() {
  assert(/isStarred \? 'text-amber-900 font-semibold' : 'text-slate-500'/.test(board),
    'due date readable on amber');
  assert(/isStarred \? 'text-amber-800' : 'text-slate-400'/.test(board),
    'other-assignees count readable');
});

// ===== CALENDAR — CANCEL MEETING =====

test('CM1 cancelMeeting handler exists', function() {
  assert(/const cancelMeeting = async \(\) => \{/.test(calendar),
    'cancelMeeting function');
});

test('CM2 cancelMeeting writes status + cancelled_at + cancelled_by + reason', function() {
  var m = calendar.match(/const cancelMeeting = async[\s\S]*?\n  \};/);
  assert(m, 'handler body');
  assert(/status: 'cancelled'/.test(m[0]), 'sets cancelled status');
  assert(/cancelled_at: new Date\(\)\.toISOString\(\)/.test(m[0]), 'timestamp');
  assert(/cancelled_by: myId/.test(m[0]), 'user id');
  assert(/cancellation_reason/.test(m[0]), 'reason field');
});

test('CM3 cancelMeeting prompts for reason (optional) and confirms', function() {
  var m = calendar.match(/const cancelMeeting = async[\s\S]*?\n  \};/);
  assert(m, 'body');
  assert(/window\.prompt\(/.test(m[0]),
    'prompts user for optional reason');
  assert(/if \(reason === null\) return/.test(m[0]),
    'pressing Cancel on prompt aborts (vs empty string which proceeds)');
  assert(/if \(!confirm\(/.test(m[0]),
    'secondary confirm');
});

test('CM4 cancelMeeting honors scope (single vs series)', function() {
  var m = calendar.match(/const cancelMeeting = async[\s\S]*?\n  \};/);
  assert(m, 'body');
  assert(/if \(editScope === 'series' && editEvent\.series_id\)/.test(m[0]),
    'series-wide cancel path');
  assert(/\.eq\('series_id', editEvent\.series_id\)/.test(m[0]),
    'bulk update by series_id');
});

test('CM5 uncancelMeeting (restore) exists and clears all cancellation fields', function() {
  var m = calendar.match(/const uncancelMeeting = async[\s\S]*?\n  \};/);
  assert(m, 'uncancelMeeting function');
  assert(/status: 'scheduled'/.test(m[0]), 'resets to scheduled');
  assert(/cancelled_at: null/.test(m[0]), 'clears cancel timestamp');
  assert(/cancelled_by: null/.test(m[0]), 'clears cancel user');
  assert(/cancellation_reason: null/.test(m[0]), 'clears reason');
});

test('CM6 Edit modal shows Cancel button when event is scheduled', function() {
  assert(/onClick=\{cancelMeeting\}/.test(calendar),
    'cancel button wired');
  assert(/Cancel this meeting/.test(calendar),
    'user-facing label');
});

test('CM7 Edit modal shows Restore button when event is cancelled', function() {
  assert(/editEvent\.status === 'cancelled' \?/.test(calendar),
    'conditional on status');
  assert(/onClick=\{uncancelMeeting\}/.test(calendar),
    'restore button wired');
  assert(/Restore this cancelled meeting/.test(calendar),
    'restore label');
});

test('CM8 Modal shows cancellation reason when present', function() {
  assert(/editEvent\.cancellation_reason && \(/.test(calendar),
    'conditional render of reason');
  assert(/\{editEvent\.cancellation_reason\}/.test(calendar),
    'actually outputs the reason');
});

// ===== CALENDAR — MULTI-ATTENDEE =====

test('MA1 Event creation builds ONE row with attendees array (not N rows)', function() {
  // Bug was: `for (const uid of assignees)` → N inserts
  // Fix: single `const payload = {...}` + `dbInsert` outside any loop
  assert(/const attendees = Array\.from\(new Set\(assignees\)\)/.test(calendar),
    'dedupes and collects all attendees');
  // The old loop `for (const uid of assignees) { ... dbInsert ... }` must be gone
  var createBlock = calendar.match(/\/\/ v54\.1 — ONE event, multiple attendees[\s\S]*?if \(isRecurring && row\.series_id\)/);
  assert(createBlock, 'v54.1 create block present');
  assert(!/for \(const uid of assignees\) \{[\s\S]{0,100}payload = \{/.test(createBlock[0]),
    'no more per-invitee loop creating rows');
});

test('MA2 Payload includes attendees array', function() {
  assert(/attendees: attendees,[\s\S]{0,50}\/\/ ALL invited users/.test(calendar),
    'attendees field written to payload');
});

test('MA3 assigned_to becomes the first attendee (owner), not reassigned per-user', function() {
  assert(/const ownerUid = attendees\[0\]/.test(calendar),
    'owner = first attendee');
  assert(/assigned_to: ownerUid/.test(calendar),
    'assigned_to uses owner');
});

test('MA4 Reminders scheduled for ALL attendees at once (not per-user loop)', function() {
  // scheduleEventReminders gets the full attendees array
  assert(/scheduleEventReminders\(row, attendees, myId\)/.test(calendar),
    'reminders go to everyone in one call');
});

test('MA5 visibleEvents (My calendar) includes events where user is in attendees', function() {
  var m = calendar.match(/const visibleEvents = useMemo[\s\S]*?\n  \}, \[allEvents, calView, user, myId\]\);/);
  assert(m, 'visibleEvents memo');
  assert(/var inAttendees = Array\.isArray\(e\.attendees\) && e\.attendees\.indexOf\(myId\) !== -1/.test(m[0]),
    'checks attendees membership');
  assert(/e\.assigned_to === myId \|\| e\.created_by === myId \|\| inAttendees/.test(m[0]),
    'OR condition includes attendees');
});

// ===== SQL MIGRATION =====

test('SQL1 Migration file exists', function() {
  assert(fs.existsSync(path.join(REPO, 'sql/s24_calendar_cancel_and_attendees.sql')),
    's24 migration present');
});

test('SQL2 Migration adds status column with CHECK constraint', function() {
  var sql = fs.readFileSync(path.join(REPO, 'sql/s24_calendar_cancel_and_attendees.sql'), 'utf8');
  assert(/ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'scheduled'/.test(sql),
    'status column');
  assert(/CHECK \(status IN \('scheduled', 'cancelled', 'completed'\)\)/.test(sql),
    'status enum');
});

test('SQL3 Migration adds cancellation audit fields', function() {
  var sql = fs.readFileSync(path.join(REPO, 'sql/s24_calendar_cancel_and_attendees.sql'), 'utf8');
  assert(/ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ/.test(sql), 'cancelled_at');
  assert(/ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES users\(id\)/.test(sql), 'cancelled_by FK');
  assert(/ADD COLUMN IF NOT EXISTS cancellation_reason TEXT/.test(sql), 'reason field');
});

test('SQL4 Migration adds attendees array column with GIN index', function() {
  var sql = fs.readFileSync(path.join(REPO, 'sql/s24_calendar_cancel_and_attendees.sql'), 'utf8');
  assert(/ADD COLUMN IF NOT EXISTS attendees UUID\[\] DEFAULT '\{\}'/.test(sql), 'attendees array col');
  assert(/CREATE INDEX IF NOT EXISTS idx_events_attendees ON calendar_events USING GIN \(attendees\)/.test(sql),
    'GIN index for fast attendees @> lookup');
});

test('SQL5 Migration backfills legacy rows (attendees = [assigned_to])', function() {
  var sql = fs.readFileSync(path.join(REPO, 'sql/s24_calendar_cancel_and_attendees.sql'), 'utf8');
  assert(/SET attendees = ARRAY\[assigned_to\][\s\S]{0,100}assigned_to IS NOT NULL/.test(sql),
    'backfill so existing events have at least one attendee');
});

test('SQL6 Migration is idempotent (safe to re-run)', function() {
  var sql = fs.readFileSync(path.join(REPO, 'sql/s24_calendar_cancel_and_attendees.sql'), 'utf8');
  assert(/IF NOT EXISTS/.test(sql), 'IF NOT EXISTS usage');
  assert(/EXCEPTION WHEN duplicate_table/.test(sql), 'duplicate_table guard on backup');
});

console.log('');
console.log('──────────────────────────────────────────────────');
console.log('V54.1 — CONTRAST + CANCEL MEETING + MULTI-ATTENDEE');
console.log('──────────────────────────────────────────────────');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) { console.log('\n❌ FAILURES'); process.exit(1); }
else console.log('\n✅ All v54.1 tests passed');
