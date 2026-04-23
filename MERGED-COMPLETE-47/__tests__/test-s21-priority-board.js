// ============================================================
// S21 (Apr 23 2026) — Priority Board: per-person ticket columns
// with drag-and-drop reorder + Team Priorities Today strip on dashboard.
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

var pb = fs.readFileSync(path.join(REPO, 'src/components/PriorityBoard.jsx'), 'utf8');
var tt = fs.readFileSync(path.join(REPO, 'src/components/TicketsTab.jsx'), 'utf8');
var page = fs.readFileSync(path.join(REPO, 'src/app/page.jsx'), 'utf8');

// ==== SQL column ====
test('S21.1 SQL adds assignee_priority column', function() {
  var sqlPath = path.join(REPO, 'sql/s21_ticket_assignee_priority.sql');
  assert(fs.existsSync(sqlPath), 'SQL file exists');
  var sql = fs.readFileSync(sqlPath, 'utf8');
  assert(/ADD COLUMN IF NOT EXISTS assignee_priority INTEGER/.test(sql),
    'adds assignee_priority integer column');
  assert(/CREATE INDEX IF NOT EXISTS idx_tickets_assignee_priority/.test(sql),
    'creates index for ordering within a person');
});

// ==== PriorityBoard component ====
test('S21.2 PriorityBoard is default-exported', function() {
  assert(/export default function PriorityBoard/.test(pb));
});

test('S21.3 Board groups tickets by assigned_to', function() {
  assert(/byUser\[t\.assigned_to\]\.ranked\.push\(t\)/.test(pb),
    'ranked tickets pushed into per-user buckets');
  assert(/byUser\[t\.assigned_to\]\.unranked\.push\(t\)/.test(pb),
    'unranked tickets pushed into per-user buckets');
});

test('S21.4 Ranked list sorted ascending by assignee_priority', function() {
  assert(/col\.ranked\.sort\(function\(a, b\) \{ return Number\(a\.assignee_priority\) - Number\(b\.assignee_priority\); \}\)/.test(pb),
    'priority 1 goes on top');
});

test('S21.5 Drag handlers set/clear the dragging state', function() {
  assert(/onDragStart\(e, t\)/.test(pb), 'onDragStart exists');
  assert(/setDragging\(\{ ticketId: t\.id, fromUserId: t\.assigned_to \}\)/.test(pb),
    'dragging state captured');
  assert(/function onDragEnd\(\)/.test(pb), 'onDragEnd clears state');
});

test('S21.6 Drop renumbers target column 1..N', function() {
  assert(/var newPriority = idx \+ 1;/.test(pb),
    'new priorities are 1-based');
  assert(/dbUpdate\('tickets', updates\[i\]\.id, updates\[i\]\.changes, currentUserId\)/.test(pb),
    'persists via dbUpdate');
});

test('S21.7 Cross-column drop closes gap in source column', function() {
  assert(/if \(crossColumn\) \{[\s\S]{0,500}srcRanked\.forEach/.test(pb),
    'source column renumbered when ticket moves to another column');
});

test('S21.8 Non-admin cannot move tickets across columns', function() {
  assert(/Only admins can move tickets between people/.test(pb),
    'permission guard message present');
  assert(/if \(crossColumn && !isAdmin\)/.test(pb),
    'cross-column guard in place');
});

test('S21.9 Non-admin cannot reorder another person\'s column', function() {
  assert(/You can only reorder your own column/.test(pb),
    'same-column permission message');
});

test('S21.10 Today strip shows each person\'s #1 priority', function() {
  assert(/var top = col && col\.ranked\.length > 0 \? col\.ranked\[0\] : null/.test(pb),
    'top priority pulled from rank index 0');
  assert(/🎯 Today — Everyone's #1 Priority/.test(pb),
    'Today strip header');
});

test('S21.11 Ranked badge shows priority number', function() {
  // The ticket card renders the rank in a circular badge
  assert(/bg-indigo-600 text-white rounded-full/.test(pb),
    'rank badge styled');
  assert(/\{rank\}/.test(pb),
    'rank value rendered in card');
});

test('S21.12 Clear ranks button confirms before wiping', function() {
  assert(/Clear all priority numbers for this person\?/.test(pb),
    'confirm dialog before clearing');
});

test('S21.13 Status filter toggles between active-only and include-closed', function() {
  assert(/setStatusFilter\('open'\)/.test(pb), 'active-only state');
  assert(/setStatusFilter\('all'\)/.test(pb), 'include-closed state');
  assert(/Include done\/closed/.test(pb), 'toggle label');
});

// ==== TicketsTab wiring ====
test('S21.14 TicketsTab imports PriorityBoard', function() {
  assert(/import PriorityBoard from '\.\/PriorityBoard'/.test(tt));
});

test('S21.15 TicketsTab has a List / Board view toggle', function() {
  assert(/const \[viewMode, setViewMode\] = useState\('list'\)/.test(tt),
    'viewMode state');
  assert(/🗂️ Priority Board/.test(tt), 'board toggle label');
  assert(/📋 List/.test(tt), 'list toggle label');
});

test('S21.16 Board passes required props', function() {
  var m = tt.match(/<PriorityBoard[\s\S]*?\/>/);
  assert(m, 'component used');
  var block = m[0];
  ['tickets=', 'users=', 'currentUserId=', 'isAdmin=', 'onReorder=', 'onSelectTicket=', 'onRefresh='].forEach(function(p) {
    assert(block.indexOf(p) >= 0, 'prop ' + p + ' passed');
  });
});

test('S21.17 Board-view render opens ticket detail on click', function() {
  assert(/onSelectTicket=\{\(t\) => \{ setSel\(t\); loadComments\(t\.id\); \}\}/.test(tt),
    'click on card opens detail view');
});

// ==== Dashboard Today strip ====
test('S21.18 Dashboard shows Team Priorities Today strip', function() {
  assert(/🎯 Team Priorities Today/.test(page),
    'dashboard strip header');
});

test('S21.19 Dashboard strip finds each user\'s lowest (#1) priority ticket', function() {
  assert(/if \(!current \|\| Number\(t\.assignee_priority\) < Number\(current\.assignee_priority\)\)/.test(page),
    'finds lowest number (top priority)');
});

test('S21.20 Dashboard strip clicks through to ticket detail', function() {
  assert(/onClick=\{\(\) => \{ setOpenTicketId\(t\.id\); setTab\('tickets'\); \}\}/.test(page),
    'click jumps to tickets tab with ticket open');
});

test('S21.21 Dashboard strip hides when no one has prioritized anything', function() {
  assert(/if \(!anyoneHasPriorities\) return null/.test(page),
    'empty state: no rendering');
});

test('S21.22 Dashboard strip ignores closed/done/resolved tickets', function() {
  // The filter must exclude finished tickets — no one should see "Closed" ones as #1
  assert(/s === 'closed' \|\| s === 'done' \|\| s === 'resolved' \|\| s === 'cancelled'/.test(page),
    'filter excludes finished statuses');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
