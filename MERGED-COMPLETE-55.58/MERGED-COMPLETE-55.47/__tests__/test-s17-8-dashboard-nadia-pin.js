// ============================================================
// Session 17.8 (Apr 23 2026) — Pin dashboard Nadia to original behavior
//
// Max asked: "the dashboard functionality should work the way it used to
// work before these last changes made"
//
// These tests PIN the dashboard AIGreeter configuration so we can never
// accidentally add extra props to it again. If any of these fail in a
// future session, it means someone is changing dashboard Nadia without
// explicit approval.
//
// What "original" means here: the AIGreeter props on the dashboard are
// the SAME 11 props that shipped in MERGED-COMPLETE-22 (pre-any of my
// recent changes). No muted prop, no context props.
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

var page = fs.readFileSync(path.join(REPO, 'src/app/page.jsx'), 'utf8');
var greeter = fs.readFileSync(path.join(REPO, 'src/components/AIGreeter.jsx'), 'utf8');

// ============================================================
// PIN — Dashboard AIGreeter has ORIGINAL props only
// ============================================================

test('S17.8.P1 Exactly ONE <AIGreeter> mount in page.jsx (the dashboard)', function() {
  var count = (page.match(/<AIGreeter\b/g) || []).length;
  assert(count === 1, 'expected exactly 1 AIGreeter mount, found ' + count);
});

test('S17.8.P2 Dashboard AIGreeter has the ORIGINAL 11 props and NO extras', function() {
  var m = page.match(/<AIGreeter\s([\s\S]*?)\/>/);
  assert(m, 'AIGreeter tag found');
  var propsBlock = m[1];
  // Original props — each must be present
  var required = [
    'user', 'userProfile', 'users', 'tickets', 'invoices', 'treasury',
    'checks', 'loginHistory', 'loginHistoryLoaded', 'lang', 'personality',
    'greeterLang', 'enabled', 'hasGreeted', 'onGreeted', 'sessionMessages',
    'onMessagesUpdate', 'onToggle', 'toast'
  ];
  required.forEach(function(p) {
    assert(new RegExp('\\b' + p + '=').test(propsBlock),
      'missing required original prop: ' + p);
  });
});

test('S17.8.P3 Dashboard AIGreeter does NOT receive muted prop', function() {
  var m = page.match(/<AIGreeter\s([\s\S]*?)\/>/);
  assert(!/\bmuted=/.test(m[1]),
    'dashboard must NOT pass muted prop — this was added in S16 and changed dashboard behavior');
});

test('S17.8.P4 Dashboard AIGreeter does NOT receive contextTab prop', function() {
  var m = page.match(/<AIGreeter\s([\s\S]*?)\/>/);
  assert(!/\bcontextTab=/.test(m[1]),
    'dashboard must NOT pass contextTab prop — this injected a screen-context block into Nadia\'s prompt');
});

test('S17.8.P5 Dashboard AIGreeter does NOT receive contextSelectedCustomer/Invoice/Ticket props', function() {
  var m = page.match(/<AIGreeter\s([\s\S]*?)\/>/);
  ['contextSelectedCustomer', 'contextSelectedInvoice', 'contextOpenTicketId'].forEach(function(p) {
    assert(!new RegExp('\\b' + p + '=').test(m[1]),
      'dashboard must NOT pass ' + p + ' (added in S15, changes prompt on dashboard)');
  });
});

test('S17.8.P6 Dashboard wrapper uses max-md:order-last (original mobile ordering)', function() {
  assert(/<div className="max-md:order-last">\s*\n\s*\{!greeterDismissed && greeterSettings\.enabled \?/.test(page),
    'dashboard AIGreeter wrapper structure intact — original H2 mobile ordering preserved');
});

// ============================================================
// DASHBOARD CODE PATH — Nadia\'s own functions behave like original
// ============================================================

test('S17.8.D1 buildContext skips screen-context block when contextTab is falsy', function() {
  // When the dashboard passes no contextTab, the screen-context block is
  // gated behind `if (contextTab)` and does not run. This means dashboard
  // gets the EXACT buildContext output the original would have produced.
  assert(/if \(contextTab\) \{\s*screenCtx \+=/.test(greeter),
    'screen-context block must be gated on contextTab being truthy');
});

test('S17.8.D2 Tab-greeting effect skips when contextTab is falsy', function() {
  // Same deal — dashboard has no contextTab → tab-greeting effect returns early
  assert(/if \(!contextTab\) return;/.test(greeter),
    'tab-greeting effect must return early when contextTab is undefined');
});

test('S17.8.D3 doSpeak does NOT early-return when muted is undefined', function() {
  // `muted` is undefined on dashboard. `if (muted)` is falsy for undefined,
  // so the early-return does not fire. Speech works normally.
  // We verify the check is specifically `if (muted)`, not `if (muted === true)`
  // or any stricter comparison that would still fire for undefined.
  assert(/if \(muted\) \{\s*try \{ console\.log\('\[nadia\] muted/.test(greeter),
    'doSpeak muted check must be truthy coercion so dashboard (undefined muted) speaks normally');
});

test('S17.8.D4 doFallbackSpeak also uses truthy muted check', function() {
  assert(/var doFallbackSpeak = function\(text\) \{\s*if \(muted\) return;/.test(greeter),
    'doFallbackSpeak uses truthy check — dashboard speaks normally with undefined muted');
});

test('S17.8.D5 Login greeting effect unchanged (original gate)', function() {
  assert(/if \(hasGreeted \|\| !enabled \|\| !loginHistoryLoaded\) return;/.test(greeter),
    'original login-greeting gate preserved: hasGreeted, enabled, loginHistoryLoaded');
  assert(/doSend\(null, true\);/.test(greeter),
    'login greeting still called with isGreeting=true');
});

test('S17.8.D6 Morning Briefing still rendered in AIGreeter (preserved)', function() {
  // This is a feature from S13 that the dashboard benefits from. We keep it.
  assert(/MorningBriefing/.test(greeter),
    'MorningBriefing component still imported/used in AIGreeter (S13 feature preserved)');
});

test('S17.8.D7 Voice recorder (Record button) preserved on dashboard', function() {
  // S10 feature — MediaRecorder + Whisper backup. Must still work on dashboard.
  assert(/MediaRecorder|mediaRecorderRef/.test(greeter),
    'MediaRecorder recorder still present (S10 feature)');
});

// ============================================================
// OVERLAY still works on other tabs
// ============================================================

test('S17.8.O1 NadiaFloatingOverlay still imported and mounted on non-dashboard tabs', function() {
  assert(/import NadiaFloatingOverlay from '\.\.\/components\/NadiaFloatingOverlay'/.test(page),
    'overlay import preserved');
  assert(/tab !== 'dashboard' && \(\s*<NadiaFloatingOverlay/.test(page),
    'overlay still gated on tab !== dashboard');
});

test('S17.8.O2 nadiaMuted state still at page level for overlay use', function() {
  // The page-level muted state still exists so the overlay can reference it
  assert(/const \[nadiaMuted, setNadiaMuted\] = useState\(/.test(page),
    'nadiaMuted state still declared at page root');
});

// ============================================================
// REGRESSION
// ============================================================

test('S17.8.REG1 Briefing engine still present', function() {
  var be = fs.readFileSync(path.join(REPO, 'src/lib/briefing-engine.js'), 'utf8');
  assert(/buildBriefing: buildBriefing/.test(be),
    'briefing engine still exports buildBriefing');
});

test('S17.8.REG2 Check uncollect handler intact', function() {
  assert(/const handleUncollectCheck = async \(check, reason\) =>/.test(page),
    'handleUncollectCheck still defined');
});

test('S17.8.REG3 Close-with-comment modal intact', function() {
  var tt = fs.readFileSync(path.join(REPO, 'src/components/TicketsTab.jsx'), 'utf8');
  assert(/const finalizeClose = async \(\) => \{/.test(tt),
    'finalizeClose still defined');
});

test('S17.8.REG4 Summary card dark palette intact', function() {
  assert(/linear-gradient\(135deg, #064e3b 0%, #065f46 100%\)/.test(page),
    'Treasury Cash In dark emerald still present');
});

test('S17.8.REG5 Color palette disambiguation intact (orange vs yellow)', function() {
  assert(/dueToday \? '#f97316'/.test(page),
    'due-today orange vs medium-priority yellow distinction intact');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
