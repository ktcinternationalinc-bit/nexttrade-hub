// ============================================================
// v53 — Edge auto-scroll during drag + Move-to click picker
//
// Covers the real drag-across-distance problem that v52 didn't solve:
//   - edge auto-scroll so distant columns come into view mid-drag
//   - click-to-move picker so you don't have to drag at all
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
test('ES1 Board strip listens for dragover to track cursor position', function() {
  assert(/onDragOver=\{handleBoardDragOver\}/.test(board),
    'scroll container wires handleBoardDragOver');
  assert(/onDragLeave=\{stopEdgeScroll\}/.test(board),
    'stops when cursor leaves the container');
  assert(/onDrop=\{stopEdgeScroll\}/.test(board),
    'stops on drop');
});

test('ES2 handleBoardDragOver computes speed from edge distance', function() {
  var m = board.match(/function handleBoardDragOver\(e\) \{[\s\S]*?\n  \}/);
  assert(m, 'handler defined');
  var body = m[0];
  assert(/EDGE_ZONE = 80/.test(body), 'defines an edge-zone width (80px)');
  assert(/MAX_SPEED = 18/.test(body), 'defines a max scroll speed');
  assert(/x < rect\.left \+ EDGE_ZONE/.test(body), 'detects left edge');
  assert(/x > rect\.right - EDGE_ZONE/.test(body), 'detects right edge');
});

test('ES3 Speed scales closer-to-edge → faster', function() {
  var m = board.match(/function handleBoardDragOver\(e\) \{[\s\S]*?\n  \}/);
  assert(m, 'handler body');
  // Closer to edge means the ratio is higher → speed is higher
  assert(/leftT = 1 - \(x - rect\.left\) \/ EDGE_ZONE/.test(m[0]),
    'left-edge speed ramp based on distance');
  assert(/rightT = 1 - \(rect\.right - x\) \/ EDGE_ZONE/.test(m[0]),
    'right-edge speed ramp based on distance');
});

test('ES4 RAF loop runs only while near an edge', function() {
  // Tick function checks speed ref; stops if zero
  var m = board.match(/function edgeScrollTick\(\) \{[\s\S]*?\n  \}/);
  assert(m, 'tick defined');
  assert(/if \(!el \|\| !edgeScrollSpeedRef\.current\)/.test(m[0]),
    'tick exits when speed is 0');
  assert(/el\.scrollLeft \+= edgeScrollSpeedRef\.current/.test(m[0]),
    'applies horizontal scroll each frame');
});

test('ES5 stopEdgeScroll cancels RAF and resets speed', function() {
  var m = board.match(/function stopEdgeScroll\(\) \{[\s\S]*?\n  \}/);
  assert(m, 'stopEdgeScroll defined');
  assert(/cancelAnimationFrame/.test(m[0]), 'cancels the RAF');
  assert(/edgeScrollSpeedRef\.current = 0/.test(m[0]), 'resets speed ref');
});

test('ES6 onDragEnd stops edge-scroll', function() {
  var m = board.match(/function onDragEnd\(\) \{[\s\S]*?\n  \}/);
  assert(m, 'onDragEnd defined');
  assert(/stopEdgeScroll\(\)/.test(m[0]),
    'edge-scroll must stop when the drag ends');
});

test('ES7 Edge scroll skipped when nothing is being dragged', function() {
  var m = board.match(/function handleBoardDragOver\(e\) \{[\s\S]*?\n  \}/);
  assert(m, 'handler');
  assert(/if \(!dragging\) return/.test(m[0]),
    'bail early when there\'s no active drag');
});

// ===== MOVE-TO PICKER =====
test('MT1 Picker state declared', function() {
  assert(/\[moveToPickerFor, setMoveToPickerFor\] = useState\(null\)/.test(board),
    'picker state present');
});

test('MT2 reassignTicketTo helper exists', function() {
  var m = board.match(/async function reassignTicketTo\(ticket, targetUserId\) \{[\s\S]*?\n  \}/);
  assert(m, 'reassignTicketTo defined');
});

test('MT3 reassignTicketTo refuses same-user reassignment', function() {
  var m = board.match(/async function reassignTicketTo\(ticket, targetUserId\) \{[\s\S]*?\n  \}/);
  assert(m, 'function body');
  assert(/ticket\.assigned_to === targetUserId[\s\S]{0,200}Already assigned/.test(m[0]),
    'no-op + toast when same person');
});

test('MT4 reassignTicketTo enforces permission (canDragTicket)', function() {
  var m = board.match(/async function reassignTicketTo\(ticket, targetUserId\) \{[\s\S]*?\n  \}/);
  assert(m, 'function body');
  assert(/if \(!canDragTicket\(ticket\)\)/.test(m[0]),
    'only people on ticket can click-to-move');
});

test('MT5 reassignTicketTo reuses onDropCol (no duplicated reassign logic)', function() {
  var m = board.match(/async function reassignTicketTo\(ticket, targetUserId\) \{[\s\S]*?\n  \}/);
  assert(m, 'function body');
  assert(/setDragging\(\{ ticketId: ticket\.id, fromUserId: ticket\.assigned_to \}\)/.test(m[0]),
    'primes the same drag state onDropCol expects');
  assert(/onDropCol\(fakeEvent, targetUserId/.test(m[0]),
    'dispatches through the same drop handler as drag-and-drop');
});

test('MT6 reassignTicketTo drops into target unranked pile at end', function() {
  var m = board.match(/async function reassignTicketTo\(ticket, targetUserId\) \{[\s\S]*?\n  \}/);
  assert(m, 'function body');
  assert(/targetCol\.unranked && targetCol\.unranked\.length/.test(m[0]),
    'computes insertion position as end of unranked');
  assert(/onDropCol\(fakeEvent, targetUserId, targetPosition, 'unranked'\)/.test(m[0]),
    'pile argument is unranked');
});

test('MT7 Move-to button shown on hover only (opacity-0 group-hover)', function() {
  assert(/opacity-0 group-hover:opacity-100/.test(board),
    'button hidden by default, revealed on card hover');
});

test('MT8 Card wrapper has group class so group-hover triggers', function() {
  assert(/className=\{'group relative border rounded-lg/.test(board),
    'card wrapper uses Tailwind group pattern');
});

test('MT9 Picker lists all OTHER users (not self)', function() {
  assert(/\(users \|\| \[\]\)\.filter\(function\(u\) \{ return u\.id !== t\.assigned_to/.test(board),
    'filters out current assignee from the list');
});

test('MT10 Clicking a picker row triggers reassignTicketTo', function() {
  assert(/reassignTicketTo\(t, u\.id\)/.test(board),
    'click wires to helper with ticket + target user');
});

test('MT11 Picker hides for single-user teams', function() {
  assert(/\(users \|\| \[\]\)\.length > 1/.test(board),
    'skip rendering the move-to button when only one user exists');
});

test('MT12 Permission gate on move-to button (canDrag)', function() {
  // The button's outer container is gated on canDrag && length>1
  var m = board.match(/MOVE TO PICKER[\s\S]{0,1500}/);
  assert(m, 'move-to section marker');
  assert(/canDrag && \(users \|\| \[\]\)\.length > 1/.test(m[0]),
    'button hidden entirely for users without drag permission');
});

console.log('');
console.log('──────────────────────────────────────');
console.log('V53 — EDGE SCROLL + MOVE-TO PICKER');
console.log('──────────────────────────────────────');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) { console.log('\n❌ FAILURES'); process.exit(1); }
else console.log('\n✅ All v53 tests passed');
