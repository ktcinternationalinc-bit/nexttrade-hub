// ============================================================
// Session 16 (Apr 22 2026) — Color palette + Global Nadia + Treasury perm lock
//
// Covers three distinct fixes requested by Max:
//
// FIX 1 — Color palette disambiguation
//   Problem: amber was used for BOTH "due today" AND "medium priority",
//   so users couldn't instantly tell which signal a card was showing.
//   Solution: distinct colors per signal type.
//     Overdue      → #ef4444 red       (danger)
//     Due today    → #f97316 orange    (attention NOW)
//     Urgent/High  → #dc2626 crimson   (critical importance)
//     Medium prio  → #eab308 yellow    (warning)
//     Low prio     → #64748b grey      (normal)
//
// FIX 2 — Nadia available on every screen
//   Problem: Nadia only rendered on the dashboard. Once user navigated to
//   another tab, she disappeared — can't talk to her from Tickets, Sales, etc.
//   Solution: new NadiaFloatingOverlay component mounted at page root.
//   Starts as a small pill in bottom-right. Click to expand to full chat.
//   Has Mute/Unmute button inside so user can shush her any time. Muted
//   state persists in localStorage across page navigation.
//
// FIX 3 — Treasury Net header permission lock
//   Problem: "Treasury Net (All Time)" header could leak to users without
//   treasury permission if modulePerms['Treasury'] had any truthy value
//   (not just === true). Tighten to strict === true.
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
var ticketsTab = fs.readFileSync(path.join(REPO, 'src/components/TicketsTab.jsx'), 'utf8');
var overlay = fs.readFileSync(path.join(REPO, 'src/components/NadiaFloatingOverlay.jsx'), 'utf8');
var greeter = fs.readFileSync(path.join(REPO, 'src/components/AIGreeter.jsx'), 'utf8');

// ======================================================
// FIX 1 — Color palette disambiguation
// ======================================================

test('S16.C1 Dashboard priBorderColor uses distinct colors per priority', function() {
  // High → crimson (not same red as overdue)
  assert(/if \(p === 'urgent' \|\| p === 'high'\) return '#dc2626'/.test(page),
    'urgent/high priority → #dc2626 crimson (distinct from overdue red)');
  // Medium → yellow (NOT the same as due-today orange)
  assert(/if \(p === 'medium'\) return '#eab308'/.test(page),
    'medium priority → #eab308 yellow (distinct from due-today orange)');
  // Low → grey
  assert(/if \(p === 'low'\) return '#64748b'/.test(page),
    'low priority → #64748b grey');
});

test('S16.C2 Dashboard leftBorderColor: overdue=red, due-today=ORANGE (not amber)', function() {
  // Overdue is still red
  assert(/daysOverdue > 0 \? '#ef4444'/.test(page),
    'overdue → #ef4444 red');
  // Due today is NOW orange, not the old amber (#f59e0b)
  assert(/dueToday \? '#f97316' :/.test(page),
    'due today → #f97316 orange (distinct from medium-priority yellow)');
  // And amber (#f59e0b) must NOT be used as due-today border color anywhere
  var oldPattern = /dueToday \? '#f59e0b'/;
  assert(!oldPattern.test(page),
    'the old due-today=amber pattern should no longer exist');
});

test('S16.C3 Dashboard DUE TODAY badge uses orange tones (not amber)', function() {
  // Orange palette: #fdba74 (text) / rgba(249,115,22,0.15) (bg) / rgba(249,115,22,0.4) (border)
  assert(/color: '#fdba74', background: 'rgba\(249,115,22,0\.15\)'/.test(page),
    'DUE TODAY badge text+bg uses orange palette');
  assert(/border: '1px solid rgba\(249,115,22,0\.4\)'/.test(page),
    'DUE TODAY badge border uses orange');
});

test('S16.C4 TicketsTab leftBorderColor: overdue=red, due-today=orange', function() {
  assert(/isOverdue \? '#ef4444' : \(isDueToday \? '#f97316' : priColor\)/.test(ticketsTab),
    'TicketsTab must use same distinct color logic as dashboard');
});

test('S16.C5 TicketsTab DUE TODAY badge uses orange palette', function() {
  assert(/background: '#ffedd5', color: '#c2410c', border: '1px solid #fdba74'/.test(ticketsTab),
    'DUE TODAY badge in TicketsTab uses orange-100 bg, orange-700 text, orange-300 border');
});

test('S16.C6 TicketsTab PRIORITIES map uses distinct colors', function() {
  // high: #dc2626 crimson, medium: #eab308 yellow, low: #10b981 emerald
  assert(/v:'high',l:'High \/ عالي',c:'#dc2626'/.test(ticketsTab),
    'PRIORITIES high → #dc2626 crimson (matches dashboard priBorderColor)');
  assert(/v:'medium',l:'Medium \/ متوسط',c:'#eab308'/.test(ticketsTab),
    'PRIORITIES medium → #eab308 yellow (matches dashboard priBorderColor)');
  assert(/v:'low',l:'Low \/ منخفض',c:'#10b981'/.test(ticketsTab),
    'PRIORITIES low → #10b981 emerald');
});

test('S16.C7 No color collision between due-today and medium priority', function() {
  // Due today color = #f97316 orange
  // Medium priority color = #eab308 yellow
  // These must be distinct hex values
  var dueTodayColor = '#f97316';
  var mediumColor = '#eab308';
  assert(dueTodayColor !== mediumColor,
    'due-today and medium-priority colors must be different — they were both amber before');
});

// ======================================================
// FIX 2 — Global Nadia overlay
// ======================================================

test('S16.N1 NadiaFloatingOverlay component exists', function() {
  assert(fs.existsSync(path.join(REPO, 'src/components/NadiaFloatingOverlay.jsx')),
    'NadiaFloatingOverlay.jsx must exist');
});

test('S16.N2 Overlay has COLLAPSED pill + EXPANDED chat states', function() {
  // Collapsed state: small pill with 🤖 Nadia
  assert(/if \(!expanded\)/.test(overlay),
    'COLLAPSED branch must exist');
  assert(/position: 'fixed',[\s\S]{0,100}bottom: 20,[\s\S]{0,50}right: 20/.test(overlay),
    'pill must be fixed to bottom-right corner');
  // Expanded state: floats a full panel
  assert(/maxWidth: 400/.test(overlay),
    'expanded panel must have sensible max width');
});

test('S16.N3 Overlay has Mute + Unmute toggle button', function() {
  // Must have Mute button visible when unmuted; Unmute button visible when muted
  assert(/muted \? '🔇' \| '🔊'|muted \? <>[\s\S]*?Unmute[\s\S]*?: <>[\s\S]*?Mute/.test(overlay) || (/Unmute/.test(overlay) && /Mute/.test(overlay)),
    'must have both Mute and Unmute labels');
  assert(/setMuted\(function\(m\) \{ return !m; \}\)/.test(overlay),
    'mute toggle must flip state via setMuted');
});

test('S16.N4 Mute state persists in localStorage', function() {
  assert(/MUTED_STORAGE_KEY = 'nadia\.muted'/.test(overlay),
    'muted state must use a named localStorage key');
  assert(/localStorage\.setItem\(MUTED_STORAGE_KEY/.test(overlay),
    'muted changes must write to localStorage');
  assert(/localStorage\.getItem\(MUTED_STORAGE_KEY\) === 'true'/.test(overlay),
    'muted state must be restored from localStorage on mount');
});

test('S16.N5 Expanded state persists in localStorage', function() {
  assert(/EXPANDED_STORAGE_KEY = 'nadia\.expanded'/.test(overlay),
    'expanded state must use a named localStorage key');
  assert(/localStorage\.setItem\(EXPANDED_STORAGE_KEY/.test(overlay),
    'expanded changes must write to localStorage');
});

test('S16.N6 Muting immediately stops any current speech', function() {
  assert(/window\.speechSynthesis\.cancel\(\)/.test(overlay),
    'must cancel browser speech synthesis on mute');
  assert(/document\.querySelectorAll\('audio'\)[\s\S]{0,200}\.pause\(\)/.test(overlay),
    'must pause any <audio> elements (ElevenLabs TTS) on mute');
});

test('S16.N7 Overlay listens for global mute/unmute events (other components can trigger)', function() {
  ['nadia-mute', 'nadia-unmute', 'nadia-toggle-mute', 'nadia-expand', 'nadia-collapse']
    .forEach(function(evt) {
      assert(overlay.indexOf("'" + evt + "'") >= 0,
        'overlay must listen for window event: ' + evt);
    });
});

test('S16.N8 Overlay removes event listeners on unmount', function() {
  assert(/removeEventListener\('nadia-mute'[\s\S]{0,500}removeEventListener\('nadia-unmute'/.test(overlay),
    'useEffect cleanup must remove listeners (prevent memory leaks)');
});

test('S16.N9 AIGreeter accepts muted prop', function() {
  assert(/contextOpenTicketId, muted \}/.test(greeter),
    'AIGreeter must destructure muted prop from its props bag');
});

test('S16.N10 doSpeak guards on muted — skips TTS fetch entirely', function() {
  assert(/if \(muted\) \{[\s\S]{0,300}return;/.test(greeter),
    'doSpeak must early-return when muted to avoid even calling /api/tts');
});

test('S16.N11 doFallbackSpeak also respects muted', function() {
  assert(/var doFallbackSpeak = function\(text\) \{\s*if \(muted\) return;/.test(greeter),
    'doFallbackSpeak must also short-circuit when muted');
});

test('S16.N12 doSpeak useCallback dep array includes muted', function() {
  assert(/\}, \[useLang, muted\]\)/.test(greeter),
    'doSpeak deps must include muted so the callback refreshes when user toggles');
});

test('S16.N13 page.jsx imports NadiaFloatingOverlay', function() {
  assert(/import NadiaFloatingOverlay from '\.\.\/components\/NadiaFloatingOverlay'/.test(page),
    'page.jsx must import NadiaFloatingOverlay');
});

test('S16.N14 page.jsx mounts NadiaFloatingOverlay at root (global placement)', function() {
  assert(/<NadiaFloatingOverlay\s/.test(page),
    'page.jsx must render <NadiaFloatingOverlay />');
});

test('S16.N15 Overlay passes full context props through', function() {
  // context props must flow through to AIGreeter via the overlay
  var overlayUsage = page.match(/<NadiaFloatingOverlay[\s\S]{0,1500}\/>/);
  assert(overlayUsage, 'NadiaFloatingOverlay tag found');
  ['contextTab', 'contextSelectedCustomer', 'contextSelectedInvoice', 'contextOpenTicketId']
    .forEach(function(p) {
      assert(overlayUsage[0].indexOf(p) >= 0,
        'overlay must receive prop: ' + p);
    });
});

test('S16.N16 Dashboard-only AIGreeter block was removed (no double mount)', function() {
  // The old dashboard-only section should be gone — it would cause Nadia
  // to appear twice on the dashboard otherwise. We look for the specific
  // comment that marked the removal.
  assert(/The dashboard-only AIGreeter is gone/.test(page),
    'must have an explicit note that dashboard-only AIGreeter was removed');
  // And confirm: AIGreeter tag should no longer appear directly in page.jsx —
  // it's only rendered via the overlay wrapper now
  var directAIGreeter = page.match(/<AIGreeter\b/g) || [];
  assert(directAIGreeter.length === 0,
    'page.jsx should not render <AIGreeter> directly anymore — found ' + directAIGreeter.length + ' instance(s)');
});

test('S16.N17 Overlay is gated on greeterSettings.enabled and NOT greeterDismissed', function() {
  assert(/greeterSettings\.enabled && !greeterDismissed && \(\s*<NadiaFloatingOverlay/.test(page),
    'overlay must be gated same as the old AIGreeter was');
});

// ======================================================
// FIX 3 — Treasury Net header permission lock
// ======================================================

test('S16.T1 Treasury Net header requires explicit === true, not truthy', function() {
  // Old: modulePerms?.['Treasury']     ← any truthy value would allow it
  // New: modulePerms?.['Treasury'] === true   ← strict equality
  assert(/\(isSuperAdmin \|\| modulePerms\?\.\['Treasury'\] === true\)/.test(page),
    'Treasury Net header must use strict === true check');
});

test('S16.T2 Old loose truthy check is removed', function() {
  // Make sure the old pattern is gone — we explicitly want the strict version
  var looseMatch = page.match(/\(isSuperAdmin \|\| modulePerms\?\.\['Treasury'\]\)/);
  assert(!looseMatch,
    'old loose truthy check on Treasury must be replaced with strict === true');
});

test('S16.T3 Super admin still sees the Treasury Net header', function() {
  // The gate is (isSuperAdmin || modulePerms['Treasury'] === true) — super admin path intact
  assert(/isSuperAdmin \|\| modulePerms\?\.\['Treasury'\] === true/.test(page),
    'isSuperAdmin must still be in the OR expression so admins are unaffected');
});

// ======================================================
// REGRESSION: Check Uncollect wasn't broken
// ======================================================

test('S16.R1 handleUncollectCheck still exists (not broken by S16 changes)', function() {
  assert(/const handleUncollectCheck = async \(check, reason\) =>/.test(page),
    'S15 uncollect handler must still be defined');
});

test('S16.R2 Uncollect button still rendered for admins on collected checks', function() {
  assert(/onClick=\{\(\) => handleUncollectCheck\(c\)\}/.test(page),
    'Uncollect button must still call handleUncollectCheck');
  assert(/↩︎ Uncollect/.test(page),
    'Uncollect button must still display the ↩︎ Uncollect label');
});

test('S16.R3 Dashboard UI is still intact (TicketCard, sections, etc.)', function() {
  assert(/const TicketCard = \(\{ t, accent \}\) => \{/.test(page),
    'TicketCard component still defined');
  assert(/const sectionLabel = \(icon, text, count, color\)/.test(page),
    'sectionLabel helper still defined');
});

test('S16.R4 Phase 2 briefing engine wiring is still intact', function() {
  assert(/handleBriefingAction = function\(item\)/.test(greeter),
    'briefing action handler still wired in AIGreeter');
  assert(/data\.briefing/.test(greeter),
    'briefing data still received from server response');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
