// ============================================================
// v54 — Priority Board drag-across-distance UX
// ============================================================
// Covers three mechanisms working together:
//   1. Edge auto-scroll during drag (document-level listener)
//   2. Scroll-snap disabled during drag (so auto-scroll actually works)
//   3. Always-visible Move-to menu (touch-friendly)
//   4. Column pulse highlight when jumped-to from person-picker
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

// ===== EDGE AUTO-SCROLL =====

test('E1 checkEdgeScroll helper exists separate from the event handler', function() {
  // Refactor: the edge-detection math is in its own function so it can
  // be called from both the strip-level and document-level listeners.
  assert(/function checkEdgeScroll\(clientX\)/.test(board),
    'checkEdgeScroll is a named function taking clientX');
});

test('E2 Edge zone is 100px on each side (bumped from 80 for better reach)', function() {
  var m = board.match(/function checkEdgeScroll[\s\S]*?\n  \}/);
  assert(m, 'checkEdgeScroll body');
  assert(/EDGE_ZONE = 100/.test(m[0]),
    'EDGE_ZONE set to 100');
});

test('E3 Max scroll speed is 22 px/frame with a 5px floor', function() {
  var m = board.match(/function checkEdgeScroll[\s\S]*?\n  \}/);
  assert(m, 'body');
  assert(/MAX_SPEED = 22/.test(m[0]),
    'MAX_SPEED ramped up');
  assert(/MIN_SPEED = 5/.test(m[0]),
    'MIN_SPEED floor so initial edge-touch actually moves');
});

test('E4 Document-level dragover listener attached on dragstart, removed on dragend', function() {
  assert(/document\.addEventListener\('dragover', docHandler\)/.test(board),
    'adds document listener on drag start');
  assert(/document\.removeEventListener\('dragover', documentDragOverRef\.current\)/.test(board),
    'removes document listener on drag end');
  assert(/documentDragOverRef = useRef\(null\)/.test(board),
    'ref holds the handler so we can detach the exact same function');
});

test('E5 Document listener uses the SAME checkEdgeScroll math', function() {
  // No duplication of edge-detection math — both strip + document handlers
  // call checkEdgeScroll(ev.clientX).
  assert(/var docHandler = function\(ev\) \{ checkEdgeScroll\(ev\.clientX\); \}/.test(board),
    'document handler delegates to checkEdgeScroll');
});

test('E6 stopEdgeScroll called on dragend AND dragleave AND drop', function() {
  // dragend: handled in onDragEnd
  assert(/function onDragEnd[\s\S]*?stopEdgeScroll\(\)/.test(board),
    'dragend stops scroll');
  // dragleave/drop on the board strip:
  assert(/onDragLeave=\{stopEdgeScroll\}/.test(board),
    'dragleave stops scroll');
  assert(/onDrop=\{stopEdgeScroll\}/.test(board),
    'drop stops scroll');
});

// ===== SCROLL-SNAP FIGHT FIX =====

test('S1 Scroll-snap disabled while dragging (was mandatory, fighting the RAF)', function() {
  // The bug: scroll-snap-type: x mandatory yanks the viewport back to
  // the nearest snap point during programmatic scroll, so edge-scroll
  // did nothing. Fix: scrollSnapType switches to 'none' when dragging.
  assert(/scrollSnapType: dragging \? 'none' : 'x mandatory'/.test(board),
    'scroll-snap toggled by dragging state');
});

// ===== MOVE-TO MENU =====

test('M1 Move-to menu state declared', function() {
  assert(/\[moveToPickerFor, setMoveToPickerFor\] = useState\(null\)/.test(board),
    'moveToPickerFor state');
});

test('M2 Move-to menu is visible on every card (no opacity-0 group-hover gate)', function() {
  // The old design hid the button behind hover, which fails on touch
  // devices. v52.2 removed opacity-0/group-hover.
  var m = board.match(/\{canDrag && \(users \|\| \[\]\)\.length > 1 && \(\s*<div className="(relative mt-1 pt-1 border-t border-slate-100[^"]*)"/);
  assert(m, 'Move-to menu container found');
  assert(!/opacity-0/.test(m[1]),
    'container must NOT use opacity-0 (was hiding on touch)');
  assert(!/group-hover/.test(m[1]),
    'container must NOT use group-hover (was hiding on touch)');
});

test('M3 Move-to button toggles the picker for the card', function() {
  assert(/setMoveToPickerFor\(moveToPickerFor === t\.id \? null : t\.id\)/.test(board),
    'click toggles picker open/closed');
});

test('M4 Move-to dropdown filters out the ticket\'s current assignee', function() {
  assert(/filter\(function\(u\) \{ return u\.id !== t\.assigned_to; \}\)/.test(board),
    'current assignee omitted from the picker so user cannot pick same person');
});

test('M5 Picking from dropdown calls reassignTicketTo', function() {
  assert(/onClick=\{function\(e\) \{\s*e\.stopPropagation\(\);\s*reassignTicketTo\(t, u\.id\);\s*\}\}/.test(board),
    'user selection triggers reassign');
});

test('M6 reassignTicketTo exists and delegates to onDropCol for consistency', function() {
  var m = board.match(/async function reassignTicketTo\(ticket, targetUserId\) \{[\s\S]*?\n  \}/);
  assert(m, 'reassignTicketTo defined');
  assert(/onDropCol\(fakeEvent, targetUserId, targetPosition, 'unranked'\)/.test(m[0]),
    'delegates to the existing drop handler so behavior is identical');
});

test('M7 reassignTicketTo respects canDragTicket permission', function() {
  var m = board.match(/async function reassignTicketTo\(ticket, targetUserId\) \{[\s\S]*?\n  \}/);
  assert(m, 'reassignTicketTo body');
  assert(/if \(!canDragTicket\(ticket\)\)/.test(m[0]),
    'only people on the ticket (or admin) can move it');
});

// ===== COLUMN PULSE =====

test('C1 highlightedColumn state declared', function() {
  assert(/\[highlightedColumn, setHighlightedColumn\] = useState\(null\)/.test(board),
    'state for column pulse');
});

test('C2 Person-picker click sets highlightedColumn and auto-clears after 1.5s', function() {
  assert(/setHighlightedColumn\(u\.id\)/.test(board),
    'click sets highlight to that column');
  assert(/setTimeout\(function\(\) \{ setHighlightedColumn\(function\(cur\) \{ return cur === u\.id \? null : cur; \}\)/.test(board),
    'auto-clears 1.5s later (and only if still this column, so rapid clicks work)');
  assert(/\}, 1500\)/.test(board),
    '1.5-second duration');
});

test('C3 Column renders with pulse classes when highlighted', function() {
  assert(/highlightedColumn === u\.id \? 'ring-4 ring-indigo-400 ring-opacity-75 shadow-xl scale-\[1\.02\]' : ''/.test(board),
    'column wrapper gets indigo ring + shadow + slight scale when matching');
});

// ===== INTEGRATION =====

test('I1 Drop zones still visible during drag (v52 behavior preserved)', function() {
  assert(/window\.__priorityBoardDragging = true/.test(board),
    'drag start flag set');
  assert(/window\.__priorityBoardDragging = false/.test(board),
    'drag end flag cleared');
});

test('I2 All three mechanisms coexist (edge scroll + move-to menu + column pulse)', function() {
  // Not a behavioral test — just a structural sanity check that we
  // didn't delete one while adding another.
  assert(/documentDragOverRef/.test(board), 'edge scroll path present');
  assert(/moveToPickerFor/.test(board), 'move-to menu present');
  assert(/highlightedColumn/.test(board), 'column pulse present');
});

console.log('');
console.log('──────────────────────────────────────────────────');
console.log('V54 — PRIORITY BOARD DRAG-ACROSS-DISTANCE');
console.log('──────────────────────────────────────────────────');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) { console.log('\n❌ FAILURES'); process.exit(1); }
else console.log('\n✅ All v54 drag-across-distance tests passed');
