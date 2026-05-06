// ============================================================
// v54.1 — Closed tickets greyed-out at bottom of each column
// ============================================================
// Max: "All closed tickets for priority should appear on bottom
// of their buckets greyed out and closed... show last 5 and then
// drill down for more."
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

// ===== DATA =====
test('D1 closedByUser memo builds a per-user list independent of statusFilter', function() {
  assert(/var closedByUser = useMemo\(function\(\) \{/.test(board),
    'closedByUser memo defined');
  // Does not depend on statusFilter — only on tickets + users.
  var m = board.match(/var closedByUser = useMemo\(function\(\) \{[\s\S]*?\n  \}, \[[^\]]*\]\);/);
  assert(m, 'closedByUser memo body');
  assert(/\[tickets, users\]\);/.test(m[0]),
    'dependency array is [tickets, users] — statusFilter intentionally excluded');
});

test('D2 closedByUser includes closed/done/cancelled/resolved statuses', function() {
  var m = board.match(/var closedByUser = useMemo\(function\(\) \{[\s\S]*?\n  \}, \[[^\]]*\]\);/);
  assert(m, 'closedByUser memo body');
  assert(/s === 'closed' \|\| s === 'done' \|\| s === 'cancelled' \|\| s === 'resolved'/.test(m[0]),
    'all four closed-type statuses included');
});

test('D3 closedByUser sorts most-recently-closed first', function() {
  var m = board.match(/var closedByUser = useMemo\(function\(\) \{[\s\S]*?\n  \}, \[[^\]]*\]\);/);
  assert(m, 'memo body');
  assert(/return tb - ta;/.test(m[0]),
    'descending sort (recent first)');
  assert(/a\.closed_at \|\| a\.updated_at \|\| a\.created_at/.test(m[0]),
    'falls back through closed_at → updated_at → created_at');
});

test('D4 visibleTickets always excludes closed (they only render in closed pile)', function() {
  // The filter must exclude closed regardless of statusFilter value.
  // Old logic: if (statusFilter === 'open') { exclude closed } else { include all }
  // New logic: always exclude closed, statusFilter only affects behavior later
  var m = board.match(/var visibleTickets = useMemo\(function\(\) \{[\s\S]*?\}, \[tickets\]\);/);
  assert(m, 'visibleTickets defined');
  assert(/s !== 'closed' && s !== 'done' && s !== 'cancelled' && s !== 'resolved'/.test(m[0]),
    'always filters out closed statuses');
  assert(!/if \(statusFilter === 'open'\)/.test(m[0]),
    'must NOT gate filter on statusFilter (that was the old pattern)');
});

// ===== STATE =====
test('S1 expandedClosed state declared per-column', function() {
  assert(/\[expandedClosed, setExpandedClosed\] = useState\(\{\}\)/.test(board),
    'expandedClosed map state');
});

// ===== RENDER =====
test('R1 renderClosedCard function exists', function() {
  assert(/function renderClosedCard\(t\) \{/.test(board),
    'renderClosedCard defined');
});

test('R2 Closed cards are greyed out with opacity-60', function() {
  var m = board.match(/function renderClosedCard\(t\) \{[\s\S]*?\n  \}/);
  assert(m, 'renderClosedCard body');
  assert(/opacity-60/.test(m[0]),
    'closed cards render at 60% opacity');
});

test('R3 Closed card title has line-through style', function() {
  var m = board.match(/function renderClosedCard\(t\) \{[\s\S]*?\n  \}/);
  assert(m, 'body');
  assert(/line-through/.test(m[0]),
    'title uses line-through so closed state is visually unmistakable');
});

test('R4 Closed cards are NOT draggable', function() {
  var m = board.match(/function renderClosedCard\(t\) \{[\s\S]*?\n  \}/);
  assert(m, 'body');
  assert(!/draggable=\{/.test(m[0]),
    'no draggable attribute (cannot be dragged)');
  assert(!/onDragStart/.test(m[0]),
    'no onDragStart handler');
});

test('R5 Clicking a closed card still opens the detail modal', function() {
  var m = board.match(/function renderClosedCard\(t\) \{[\s\S]*?\n  \}/);
  assert(m, 'body');
  assert(/onClick=\{function\(\) \{ if \(onSelectTicket\) onSelectTicket\(t\); \}\}/.test(m[0]),
    'click wires to onSelectTicket so user can reopen or review');
});

test('R6 Closed card shows relative date (today / yesterday / Nd ago)', function() {
  var m = board.match(/function renderClosedCard\(t\) \{[\s\S]*?\n  \}/);
  assert(m, 'body');
  assert(/daysAgo === 0 \? 'today'/.test(m[0]), 'today branch');
  assert(/daysAgo === 1 \? 'yesterday'/.test(m[0]), 'yesterday branch');
  assert(/daysAgo \+ 'd ago'/.test(m[0]), 'generic N days ago branch');
});

// ===== COLUMN INTEGRATION =====
test('C1 Closed pile renders at bottom of each column (after unranked)', function() {
  // The closed pile block starts AFTER the Drop-here-to-demote zone.
  // We identify it by the "CLOSED pile" comment + the closedByUser access.
  assert(/v54\.1 — CLOSED pile/.test(board),
    'closed pile section marked');
  assert(/closedByUser\[u\.id\]/.test(board),
    'uses per-user closed list');
});

test('C2 Default view shows only 5 most recent closed tickets', function() {
  assert(/Math\.min\(5, closedList\.length\)/.test(board),
    'collapsed view caps at 5');
});

test('C3 Show-more button appears only when more than 5 closed exist', function() {
  assert(/closedList\.length > 5 && \(\s*<button/.test(board),
    'show-more only when > 5 to expand');
});

test('C4 Show-more button toggles expandedClosed for that column', function() {
  assert(/setExpandedClosed\(function\(prev\)/.test(board),
    'toggles expand state per column');
  // User interaction: clicking toggles current value
  assert(/next\[u\.id\] = !prev\[u\.id\]/.test(board),
    'toggle increments/decrements the per-column flag');
});

test('C5 Pile heading shows count and uses "Closed" label', function() {
  assert(/'Closed \(' \+ closedList\.length \+ '\)'|Closed \(\{closedList\.length\}\)/.test(board),
    'heading shows total closed count');
});

test('C6 Show-less available when expanded', function() {
  assert(/isExpandedC \? '− Show less' : '\+ Show ' \+ hiddenC \+ ' more'/.test(board),
    'expand button toggles label between Show less and Show N more');
});

// ===== NO REGRESSION =====
test('N1 Ranked pile unchanged — still renders numbered tickets via renderTicketCard', function() {
  assert(/col\.ranked\.map\(function\(t, idx\) \{[\s\S]{0,200}renderTicketCard\(t, idx \+ 1\)/.test(board),
    'ranked pile still calls renderTicketCard with rank number');
});

test('N2 Unranked pile unchanged — still supports drop-and-reorder', function() {
  assert(/renderDropZone\(u\.id, 0, 'unranked'\)/.test(board),
    'unranked pile still has drop zones');
});

console.log('');
console.log('──────────────────────────────────────────────────');
console.log('V54.1 — CLOSED TICKETS AT BOTTOM OF COLUMNS');
console.log('──────────────────────────────────────────────────');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) { console.log('\n❌ FAILURES'); process.exit(1); }
else console.log('\n✅ All v54.1 tests passed');
