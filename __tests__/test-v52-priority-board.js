// ============================================================
// v52 — Priority Board improvements
//
// Covers:
//   1. Fat drop zones (visible during any drag, taller when active)
//   2. Person-picker for horizontal navigation
//   3. Type-a-number priority badge
//   4. ⭐ Star toggle for today's focus
//   5. SQL migration for starred_today column
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

var board = fs.readFileSync(path.join(REPO, 'src/components/PriorityBoard.jsx'), 'utf8');

// ===== FAT DROP ZONES =====
test('PB1 Drop zones become visible during any drag', function() {
  assert(/window\.__priorityBoardDragging/.test(board),
    'must flag global dragging state so zones can show');
  // while dragging, zone has visible dashed border
  assert(/dragging\) \{[\s\S]{0,200}h-6 border border-dashed border-indigo-300/.test(board),
    'zones show dashed outline during drag');
});

test('PB2 Active drop zone is 4x larger than old design', function() {
  // Old: h-8 active / h-2 idle. New: h-10 active / h-6 dragging / h-3 idle.
  assert(/h-10 bg-indigo-100 border-2 border-dashed border-indigo-500/.test(board),
    'active drop zone is h-10 (40px)');
});

test('PB3 onDragStart sets the dragging flag; onDragEnd clears it', function() {
  assert(/function onDragStart[\s\S]{0,400}window\.__priorityBoardDragging = true/.test(board),
    'onDragStart sets global flag');
  assert(/function onDragEnd[\s\S]{0,300}window\.__priorityBoardDragging = false/.test(board),
    'onDragEnd clears global flag');
});

// ===== PERSON-PICKER =====
test('PB4 Board strip has ref for scroll navigation', function() {
  assert(/var boardStripRef = useRef\(null\)/.test(board), 'boardStripRef declared');
  assert(/var columnRefs = useRef\(\{\}\)/.test(board), 'columnRefs map declared');
  assert(/columnRefs\.current\[u\.id\] = el/.test(board), 'each column assigns its ref');
});

test('PB5 Person-picker renders only with 4+ employees', function() {
  assert(/\(users \|\| \[\]\)\.length > 3/.test(board),
    'conditional on user count (redundant with 1-3 people)');
});

test('PB6 Person-picker click scrolls that column into view', function() {
  assert(/node\.scrollIntoView\(\{ behavior: 'smooth', block: 'nearest', inline: 'start' \}\)/.test(board),
    'scrollIntoView wired on picker buttons');
});

test('PB7 Person-picker shows starred-count badge per person', function() {
  assert(/starredCount[\s\S]{0,200}starred_today/.test(board),
    'computes starred count per column');
  assert(/⭐\{starredCount\}/.test(board),
    'renders the star count badge');
});

// ===== TYPE-A-NUMBER =====
test('PB8 Rank badge is clickable (type-a-number entry point)', function() {
  assert(/\[editingPriorityFor, setEditingPriorityFor\] = useState\(null\)/.test(board),
    'edit state declared');
  assert(/setEditingPriorityFor\(t\.id\)/.test(board),
    'click on badge enters edit mode');
});

test('PB9 Number input submits on Enter, cancels on Escape', function() {
  var m = board.match(/isEditingPrio && \([\s\S]*?\/>/);
  assert(m, 'edit input rendered');
  assert(/e\.key === 'Enter'/.test(m[0]), 'Enter key handled');
  assert(/e\.key === 'Escape'/.test(m[0]), 'Escape key handled');
  assert(/setPriorityByNumber\(t, newRank\)/.test(m[0]),
    'Enter calls the reorder function');
});

test('PB10 setPriorityByNumber reorders the ranked pile sequentially', function() {
  var m = board.match(/function setPriorityByNumber\(ticket, newRank\) \{[\s\S]*?\n  \}/);
  assert(m, 'setPriorityByNumber defined');
  var body = m[0];
  assert(/others = col\.ranked\.filter/.test(body), 'strips current position');
  assert(/list\.splice\(pos, 0, ticket\)/.test(body), 'inserts at new position');
  assert(/newP = i \+ 1/.test(body), 'sequential 1..N renumbering');
});

test('PB11 setPriorityByNumber honors permission gate', function() {
  var m = board.match(/function setPriorityByNumber\(ticket, newRank\) \{[\s\S]*?\n  \}/);
  assert(m, 'function body');
  assert(/if \(!canDragTicket\(ticket\)\)/.test(m[0]),
    'must check canDragTicket before writing');
});

// ===== STAR SYSTEM =====
test('PB12 Star toggle writes starred_today + starred_at', function() {
  var m = board.match(/function toggleStar\(ticket\) \{[\s\S]*?\n  \}/);
  assert(m, 'toggleStar defined');
  var body = m[0];
  assert(/starred_today: newStarred/.test(body), 'flips the boolean');
  assert(/starred_at: newStarred \? new Date\(\)\.toISOString\(\) : null/.test(body),
    'stamps/clears starred_at with the toggle');
});

test('PB13 Star toggle permission-gated', function() {
  var m = board.match(/function toggleStar\(ticket\) \{[\s\S]*?\n  \}/);
  assert(m, 'function body');
  assert(/if \(!canDragTicket\(ticket\)\)/.test(m[0]),
    'only people on the ticket can star it');
});

test('PB14 Starred cards have amber glow + star icon', function() {
  // v54.1 bumped from amber-50→white (too pale) to amber-200→amber-100
  // with a bold amber-500 border for proper contrast.
  assert(/bg-gradient-to-br from-amber-200 to-amber-100[\s\S]{0,100}border-amber-500/.test(board),
    'starred card styling (strong amber, v54.1)');
  assert(/isStarred \? '⭐' : '☆'/.test(board),
    'filled vs empty star icon');
});

test('PB15 Star button visible to admin OR ticket assignee', function() {
  // Button is inside (canDrag || isAdmin) guard
  assert(/\{\(canDrag \|\| isAdmin\) && \(\s*<button[\s\S]*?toggleStar/.test(board),
    'star button permission guard');
});

// ===== SQL MIGRATION =====
test('SQL1 Migration file exists', function() {
  assert(fs.existsSync(path.join(REPO, 'sql/s23_ticket_starred_today.sql')),
    'sql/s23_ticket_starred_today.sql present');
});

test('SQL2 Migration is idempotent', function() {
  var sql = fs.readFileSync(path.join(REPO, 'sql/s23_ticket_starred_today.sql'), 'utf8');
  assert(/ADD COLUMN IF NOT EXISTS starred_today/.test(sql), 'IF NOT EXISTS on column');
  assert(/ADD COLUMN IF NOT EXISTS starred_at/.test(sql), 'IF NOT EXISTS on timestamp');
  assert(/CREATE INDEX IF NOT EXISTS idx_tickets_starred_today/.test(sql),
    'IF NOT EXISTS on partial index');
});

test('SQL3 Migration has backup block', function() {
  var sql = fs.readFileSync(path.join(REPO, 'sql/s23_ticket_starred_today.sql'), 'utf8');
  assert(/CREATE TABLE tickets_backup_s23/.test(sql), 'backup table created');
  assert(/EXCEPTION WHEN duplicate_table/.test(sql), 'safe to re-run');
});

console.log('');
console.log('──────────────────────────────────────');
console.log('V52 — PRIORITY BOARD IMPROVEMENTS');
console.log('──────────────────────────────────────');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) { console.log('\n❌ FAILURES'); process.exit(1); }
else console.log('\n✅ All v52 Priority Board tests passed');
