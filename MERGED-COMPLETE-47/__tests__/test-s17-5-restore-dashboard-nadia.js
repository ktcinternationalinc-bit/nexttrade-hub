// ============================================================
// Session 17.5 (Apr 23 2026) — Restore dashboard Nadia to her original home
//
// What happened: in S16 I moved Nadia from dashboard-embedded to a floating
// overlay everywhere — but that broke her primary home on the dashboard
// (login greeting + briefing cards in the main dashboard area).
//
// The correct design Max wants:
//   - Dashboard: Nadia lives in her ORIGINAL spot (embedded AIGreeter) —
//     full login greeting, morning briefing cards, the works. Nothing
//     about this should have changed from before S16.
//   - Every OTHER tab: the floating pill overlay is present for
//     continued conversation and mute/unmute.
//   - Both share state: same sessionMessages (no double greeting, chat
//     history continuous), same muted flag (mute once, stays muted).
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
var overlay = fs.readFileSync(path.join(REPO, 'src/components/NadiaFloatingOverlay.jsx'), 'utf8');

// ======================================================
// RESTORATION — Dashboard AIGreeter is back in its home
// ======================================================

test('S17.5.R1 AIGreeter restored on dashboard', function() {
  // page.jsx must have exactly ONE direct <AIGreeter mount again (the
  // dashboard one). The overlay renders AIGreeter internally, but from
  // page.jsx's perspective there should be one visible <AIGreeter tag.
  var directAIGreeter = (page.match(/<AIGreeter\b/g) || []).length;
  assert(directAIGreeter === 1,
    'expected exactly 1 direct <AIGreeter mount in page.jsx (dashboard home) — found ' + directAIGreeter);
});

test('S17.5.R2 Dashboard AIGreeter has the original wrapper class', function() {
  // The original wrapper used max-md:order-last so Nadia sinks to the bottom on mobile
  assert(/<div className="max-md:order-last">\s*\n\s*\{!greeterDismissed && greeterSettings\.enabled \?/.test(page),
    'dashboard AIGreeter wrapper must have max-md:order-last (original behavior)');
});

test('S17.5.R3 Dashboard AIGreeter receives all its original props', function() {
  // The props that matter for the FULL greeting experience must be passed:
  // sessionMessages, hasGreeted, onGreeted, onMessagesUpdate, loginHistoryLoaded
  var greeterSection = page.match(/<AIGreeter\s[\s\S]*?\/>/);
  assert(greeterSection, 'AIGreeter tag found');
  ['user', 'userProfile', 'tickets', 'invoices', 'treasury', 'checks',
   'loginHistory', 'loginHistoryLoaded', 'hasGreeted', 'onGreeted',
   'sessionMessages', 'onMessagesUpdate'].forEach(function(p) {
    assert(new RegExp('\\b' + p + '=').test(greeterSection[0]),
      'dashboard AIGreeter must receive prop: ' + p);
  });
});

test('S17.5.R4 Dashboard AIGreeter does NOT receive muted prop (original behavior)', function() {
  // S17.8 (Apr 23) — Reverted to original props only. You wanted the
  // dashboard to work EXACTLY as it used to before any of the recent tab/
  // overlay changes. That means no muted prop. The overlay-only mute
  // button still works via page-level events and audio element control.
  var greeterSection = page.match(/<AIGreeter\s[\s\S]*?\/>/);
  assert(greeterSection && !/muted=\{nadiaMuted\}/.test(greeterSection[0]),
    'dashboard AIGreeter must NOT receive muted prop (restored original behavior)');
});

test('S17.5.R5 Dashboard AIGreeter does NOT receive context props (original behavior)', function() {
  // Same reason as R4 — context props changed Nadia\'s prompt on the
  // dashboard. Reverted.
  var greeterSection = page.match(/<AIGreeter\s[\s\S]*?\/>/);
  ['contextTab', 'contextSelectedCustomer', 'contextSelectedInvoice', 'contextOpenTicketId']
    .forEach(function(p) {
      assert(greeterSection && !new RegExp('\\b' + p + '=').test(greeterSection[0]),
        'dashboard AIGreeter must NOT receive context prop: ' + p + ' (original behavior)');
    });
});

// ======================================================
// OVERLAY — Now only renders on NON-dashboard tabs
// ======================================================

test('S17.5.O1 Floating overlay is gated to non-dashboard tabs only', function() {
  // The render gate must include tab !== 'dashboard' to prevent
  // double-mounting Nadia on the dashboard.
  assert(/tab !== 'dashboard' && \(\s*<NadiaFloatingOverlay/.test(page),
    'overlay must have tab !== \'dashboard\' in its render gate');
});

test('S17.5.O2 Overlay is still mounted (on other tabs)', function() {
  assert(/<NadiaFloatingOverlay\s/.test(page),
    'NadiaFloatingOverlay must still be rendered');
  assert(/import NadiaFloatingOverlay from '\.\.\/components\/NadiaFloatingOverlay'/.test(page),
    'overlay import must still be present');
});

test('S17.5.O3 Overlay receives externalMuted + onMutedChange for shared mute state', function() {
  var overlaySection = page.match(/<NadiaFloatingOverlay[\s\S]*?\/>/);
  assert(overlaySection, 'overlay JSX found');
  assert(/externalMuted=\{nadiaMuted\}/.test(overlaySection[0]),
    'overlay must receive externalMuted={nadiaMuted}');
  assert(/onMutedChange=\{setNadiaMuted\}/.test(overlaySection[0]),
    'overlay must receive onMutedChange={setNadiaMuted}');
});

// ======================================================
// SHARED STATE — Page-level nadiaMuted
// ======================================================

test('S17.5.S1 nadiaMuted state declared at page level', function() {
  assert(/const \[nadiaMuted, setNadiaMuted\] = useState\(/.test(page),
    'nadiaMuted state must be declared at page root');
});

test('S17.5.S2 nadiaMuted restored from localStorage on mount', function() {
  assert(/localStorage\.getItem\('nadia\.muted'\) === 'true'/.test(page),
    'nadiaMuted initial value must read from localStorage "nadia.muted"');
});

test('S17.5.S3 nadiaMuted persisted to localStorage when changed', function() {
  assert(/localStorage\.setItem\('nadia\.muted', nadiaMuted \? 'true' : 'false'\)/.test(page),
    'nadiaMuted changes must write back to localStorage');
});

test('S17.5.S4 nadiaMuted changes dispatch sync events', function() {
  // So any component listening for nadia-mute / nadia-unmute (like the
  // overlay's event listeners) stays in sync.
  assert(/new CustomEvent\(nadiaMuted \? 'nadia-mute' : 'nadia-unmute'\)/.test(page),
    'muting must dispatch nadia-mute / nadia-unmute events for cross-component sync');
});

// ======================================================
// OVERLAY — Uses externalMuted when provided
// ======================================================

test('S17.5.OV1 Overlay detects externalMuted takeover', function() {
  assert(/var usingExternalMuted = typeof props\.externalMuted === 'boolean' && typeof props\.onMutedChange === 'function'/.test(overlay),
    'overlay must detect when parent is controlling muted state');
});

test('S17.5.OV2 Overlay uses externalMuted as source of truth when provided', function() {
  assert(/var muted = usingExternalMuted \? props\.externalMuted : internalMuted/.test(overlay),
    'muted value must come from props.externalMuted when parent controls it');
});

test('S17.5.OV3 Overlay setMuted delegates to parent callback when external', function() {
  // When parent controls muted, setMuted() must call props.onMutedChange()
  // instead of setting local state.
  assert(/if \(usingExternalMuted\) \{\s*props\.onMutedChange\(resolved\);/.test(overlay),
    'setMuted must call props.onMutedChange when parent controls state');
});

test('S17.5.OV4 Overlay does NOT persist muted to localStorage when externally controlled', function() {
  // When parent owns muted, parent does the persistence. Overlay must not
  // also write to localStorage (would cause a potential race).
  assert(/if \(usingExternalMuted\) return;\s*try \{ localStorage\.setItem\(MUTED_STORAGE_KEY/.test(overlay),
    'overlay must skip localStorage persistence when parent controls muted');
});

test('S17.5.OV5 Overlay still works standalone (no externalMuted) — backwards compat', function() {
  // The fallback to internalMuted must still exist
  assert(/var \[internalMuted, setInternalMuted\] = useState/.test(overlay),
    'internalMuted state must still exist for standalone usage');
});

// ======================================================
// REGRESSION — Nothing else broken
// ======================================================

test('S17.5.REG1 Morning briefing cards still in AIGreeter flow', function() {
  var greeter = fs.readFileSync(path.join(REPO, 'src/components/AIGreeter.jsx'), 'utf8');
  assert(/handleBriefingAction/.test(greeter),
    'briefing action handler still in AIGreeter');
});

test('S17.5.REG2 Login greeting gate is intact', function() {
  var greeter = fs.readFileSync(path.join(REPO, 'src/components/AIGreeter.jsx'), 'utf8');
  assert(/loginHistoryLoaded/.test(greeter),
    'AIGreeter still gates on loginHistoryLoaded for login greeting');
});

test('S17.5.REG3 Close-with-comment modal still intact (S17)', function() {
  var ticketsTab = fs.readFileSync(path.join(REPO, 'src/components/TicketsTab.jsx'), 'utf8');
  assert(/const finalizeClose = async \(\) => \{/.test(ticketsTab),
    'finalizeClose still defined');
  assert(/disabled=\{!closeModal\.comment\.trim\(\)\}/.test(ticketsTab),
    'close button still requires comment');
});

test('S17.5.REG4 Summary card dark palette still intact (S17)', function() {
  assert(/linear-gradient\(135deg, #064e3b 0%, #065f46 100%\)/.test(page),
    'Treasury Cash In still uses dark emerald');
});

test('S17.5.REG5 Check uncollect handler still intact', function() {
  assert(/const handleUncollectCheck = async \(check, reason\) =>/.test(page),
    'uncollect handler still defined');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
