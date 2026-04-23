// ============================================================
// S22 (Apr 23 2026) — Close-ticket resilience + button readability,
// Nadia memory persistence + crash hardening + prettier face.
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

var tt = fs.readFileSync(path.join(REPO, 'src/components/TicketsTab.jsx'), 'utf8');
var page = fs.readFileSync(path.join(REPO, 'src/app/page.jsx'), 'utf8');
var face = fs.readFileSync(path.join(REPO, 'src/components/NadiaFace.jsx'), 'utf8');
var greeter = fs.readFileSync(path.join(REPO, 'src/components/AIGreeter.jsx'), 'utf8');

// ==== Close ticket resilience ====

test('S22.1 Close flow retries without closed_at/closed_by if those columns missing', function() {
  assert(/if \(\/closed_at\|closed_by\|column\/i\.test\(msg\)\)/.test(tt),
    'catches the column-missing error and retries');
  assert(/await dbUpdate\('tickets', ticket\.id, \{ status: 'Closed', updated_by: myId \}, myId\)/.test(tt),
    'falls back to minimal payload on retry');
});

test('S22.2 Closing comment failure does not block the close itself', function() {
  assert(/\[close\] could not save closing comment/.test(tt),
    'comment insert wrapped in its own try/catch');
});

test('S22.3 Notification calls are wrapped in try/catch', function() {
  // notifyTicketStatus calls are now inside try { ... } catch (_) {}
  var m = tt.match(/try \{\s*if \(ticket\.assigned_to && ticket\.assigned_to !== myId\) notifyTicketStatus/);
  assert(m, 'notify block wrapped');
});

test('S22.4 Close error surfaces friendly message', function() {
  assert(/'Could not close: ' \+ m/.test(tt),
    'user sees a clear error prefix when close fails');
});

// ==== Button readability ====

test('S22.5 Close-Ticket modal button uses positive green gradient (not alarming red)', function() {
  // Max feedback: the red button felt like "warning / delete" not "confirm".
  // Updated to a green gradient matching the positive completion intent.
  assert(/linear-gradient\(135deg, #059669, #047857\)/.test(tt),
    'button uses the positive emerald→green gradient when enabled');
  assert(/'#94a3b8'/.test(tt),
    'button is muted grey when disabled (no comment yet)');
  assert(/font-extrabold/.test(tt), 'bold text for readability');
});

test('S22.6 Status-change buttons use filled background, not bordered-only', function() {
  assert(/className="px-3 py-1\.5 rounded-lg text-\[11px\] font-extrabold text-white hover:opacity-90/.test(tt),
    'filled + white text');
  // Closed is now a gradient; other statuses still use STATUS_COLORS[s]
  assert(/background: STATUS_COLORS\[s\]/.test(tt),
    'non-Closed statuses use their color token');
});

test('S22.7 Closed status button uses a positive checkmark + gradient', function() {
  // Max feedback: "close button color is bad". Swapped 🔒 (lock / security
  // intent) for ✓ (completion intent) and replaced dark slate with the
  // positive emerald→green gradient so the chip reads as "mark done".
  assert(/s === 'Closed' \? '✓ Close' : s/.test(tt),
    'Closed button shows a checkmark');
  assert(/'linear-gradient\(135deg, #059669, #047857\)'/.test(tt),
    'Closed status chip uses green gradient instead of dark slate');
});

test('S22.7b Close modal is also rendered inside the detail view', function() {
  // Original bug: closeModal was only rendered in the LIST view return.
  // Since the detail view early-returns above the list view, the modal
  // was unreachable when the user clicked "✓ Close" from inside a ticket.
  // This test guards that we render the modal in BOTH returns.
  var matches = tt.match(/\{closeModal && \(/g) || [];
  assert(matches.length >= 2,
    'closeModal rendered in both the detail view AND the list view; found ' + matches.length + ' occurrence(s)');
});

// ==== SQL migration ====

test('S22.8 SQL file adds closed_at + closed_by columns', function() {
  var p = path.join(REPO, 'sql/s22_tickets_closed_columns.sql');
  assert(fs.existsSync(p), 'SQL file exists');
  var sql = fs.readFileSync(p, 'utf8');
  assert(/ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ/.test(sql), 'closed_at');
  assert(/ADD COLUMN IF NOT EXISTS closed_by UUID/.test(sql), 'closed_by');
});

// ==== Nadia memory persistence ====

test('S22.9 Page.jsx hydrates greeterMessages from localStorage', function() {
  assert(/localStorage\.getItem\('nadia\.messages\.' \+ uid\)/.test(page),
    'load keyed by user id');
  assert(/setGreeterMessages\(parsed\)/.test(page), 'sets state from parsed JSON');
});

test('S22.10 Page.jsx persists greeterMessages on every change', function() {
  assert(/localStorage\.setItem\('nadia\.messages\.' \+ uid/.test(page),
    'save keyed by user id');
  assert(/greeterMessages \|\| \[\]\)\.slice\(-80\)/.test(page),
    'capped at last 80 messages');
});

test('S22.11 API history bumped from 8 to 20 turns for richer memory', function() {
  assert(/hist\.slice\(-20\)/.test(greeter), 'sends last 20 turns');
  assert(!/hist\.slice\(-8\)/.test(greeter), 'no stale -8 references');
});

// ==== Crash hardening ====

test('S22.12 stopSpeech is bulletproof — every step in its own try/catch', function() {
  // Look for the stopSpeech function signature and count try blocks in the
  // next 800 chars.
  var i = greeter.indexOf('var stopSpeech = function');
  assert(i > 0, 'stopSpeech found');
  var block = greeter.substring(i, i + 800);
  var tryCount = (block.match(/try \{/g) || []).length;
  assert(tryCount >= 4, 'multiple independent try blocks (got ' + tryCount + ')');
});

test('S22.13 Mic button handler wrapped — one failure cannot kill the button', function() {
  assert(/\/\/ S22 \(Apr 23 2026\) — Every step wrapped/.test(greeter),
    'mic handler has the hardening comment');
  assert(/try \{ if \(speaking\) stopSpeech\(\); \} catch \(e\) \{\}/.test(greeter),
    'stopSpeech call is isolated');
});

test('S22.14 Face audio hook guard prevents double createMediaElementSource', function() {
  assert(/audioElement\.__nadiaHooked/.test(face),
    'marks element so re-renders do not re-hook');
  assert(/if \(!audioElement\.__nadiaHooked/.test(face),
    'check applied before createMediaElementSource');
});

// ==== Prettier face ====

test('S22.15 Face has larger, rounder eyes', function() {
  assert(/eyeRx = faceRx \* 0\.19/.test(face), 'wider eyes');
  assert(/eyeRy = faceRy \* 0\.115/.test(face), 'taller eyes');
  assert(/irisR = eyeRx \* 0\.62/.test(face), 'bigger iris');
});

test('S22.16 Face has fuller mouth', function() {
  assert(/mouthW = faceRx \* 0\.58/.test(face), 'wider mouth');
  assert(/mouthOpen \* faceRy \* 0\.38/.test(face), 'more expressive lip motion');
});

test('S22.17 Face palette softened — warmer skin, lips', function() {
  assert(/skinLight  = '#fde0c7'/.test(face), 'warmer skin light');
  assert(/skinBase   = '#f2bf9b'/.test(face), 'warmer skin base');
  assert(/lipBase    = '#d85e6f'/.test(face), 'softer lip base');
});

// ==== S22.2 — Browser crash on dashboard: resource-leak fixes ====

test('S22.18 NadiaFace disconnects prior source/analyser before wiring new one', function() {
  assert(/var disconnectPrior = function/.test(face),
    'disconnectPrior helper exists');
  assert(/disconnectPrior\(\);/.test(face),
    'disconnectPrior is called before creating new source (prevents accumulating connections)');
});

test('S22.19 NadiaFace effect cleanup always runs, even if try block threw', function() {
  // The old version registered cleanup INSIDE the try block. If the try
  // failed before the return statement, cleanup was never registered.
  // New version uses a `cancelled` flag + outer return so cleanup is
  // guaranteed.
  assert(/var cancelled = false;/.test(face),
    'uses cancelled flag');
  assert(/if \(cancelled\) return;/.test(face),
    'RAF loops check cancelled flag');
});

test('S22.20 Dashboard AIGreeter is wrapped in SafeSection so crashes never kill the page', function() {
  var page = fs.readFileSync(path.join(REPO, 'src/app/page.jsx'), 'utf8');
  assert(/<SafeSection label="Nadia">[\s\S]{0,300}<AIGreeter/.test(page),
    'dashboard AIGreeter wrapped in SafeSection "Nadia"');
});

// ==== S22.3 — Priority Board unranked pile is expandable ====

test('S22.21 Priority Board has per-user expand/collapse state for the Unranked pile', function() {
  var pb = fs.readFileSync(path.join(REPO, 'src/components/PriorityBoard.jsx'), 'utf8');
  assert(/var \[expandedUnranked, setExpandedUnranked\] = useState\(\{\}\)/.test(pb),
    'expandedUnranked state exists');
});

test('S22.22 Priority Board renders a clickable "Show N more" button (not a dead label)', function() {
  var pb = fs.readFileSync(path.join(REPO, 'src/components/PriorityBoard.jsx'), 'utf8');
  // The old code used <div>+ N more</div> which wasn't clickable. Now it's
  // a <button> that toggles expandedUnranked for that user.
  assert(/\+ Show ' \+ hiddenCount \+ ' more/.test(pb),
    'button label shows + Show N more when collapsed');
  assert(/− Show less/.test(pb),
    'button label shows − Show less when expanded');
  assert(/setExpandedUnranked\(function\(prev\)/.test(pb),
    'click toggles the expanded state');
});

// ==== S22.4 — Close modal enforces comment assertively ====

test('S22.23 Close modal shows an up-front enforcement banner', function() {
  // Max reported "click Close, nothing happens" when the button was
  // silently disabled. The banner makes the rule obvious BEFORE the
  // user tries to submit.
  assert(/You must type a closing comment below/.test(tt),
    'amber banner at top of modal');
});

test('S22.24 Empty comment field shows a red border until filled', function() {
  // Visual cue backing up the banner: when comment is empty, textarea
  // has border-2 border-red-400.
  assert(/border-2 border-red-400/.test(tt),
    'empty textarea has red 2px border');
});

test('S22.25 Close button is always clickable + alerts on empty submit', function() {
  // Button no longer uses the `disabled` attribute — we handle validation
  // in finalizeClose with a loud alert. This was the fix for "clicking
  // Close does nothing".
  assert(/alert\('⚠️ A closing comment is required/.test(tt),
    'alert() fires loudly when comment is empty on submit');
  // The disabled attribute was removed from both modal instances
  assert(!/disabled=\{!closeModal\.comment\.trim\(\)\}/.test(tt),
    'the disabled-on-empty attribute is gone from both modals');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
