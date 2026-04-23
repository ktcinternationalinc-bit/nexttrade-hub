// ============================================================
// Session 17.6 (Apr 23 2026) — Tab-aware proactive greeting + TTS fixes
//
// Three fixes tested here:
//
// 1. TAB-AWARE GREETING
//    When user navigates to a non-dashboard tab, Nadia proactively says
//    something relevant to THAT tab — not just "good morning Mohamed".
//    Runs once per tab per session (tracked via lastGreetedTabRef).
//    Fires only AFTER the initial login greeting has happened.
//
// 2. TTS CUTOFF FIX
//    Previously, prior audio's onended callback could fire mid-way through
//    a new speech and flip speaking state off, making Nadia appear to stop
//    mid-sentence. Now uses a per-speech ID so stale callbacks no-op.
//    Also dispatches a global 'nadia-stop-all' event so unmounted
//    AIGreeter instances silence their in-memory audio.
//
// 3. ALWAYS-MOUNTED OVERLAY AIGREETER
//    Previously, the overlay only mounted AIGreeter when expanded. That
//    meant tab_greeting couldn't fire until user clicked the pill. Now
//    AIGreeter is mounted (hidden) even when pill is collapsed, so Nadia
//    can start speaking proactively. A badge on the pill shows unread count.
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

var greeter = fs.readFileSync(path.join(REPO, 'src/components/AIGreeter.jsx'), 'utf8');
var overlay = fs.readFileSync(path.join(REPO, 'src/components/NadiaFloatingOverlay.jsx'), 'utf8');
var page = fs.readFileSync(path.join(REPO, 'src/app/page.jsx'), 'utf8');

// ======================================================
// PART 1 — TAB-AWARE PROACTIVE GREETING
// ======================================================

test('S17.6.T1 lastGreetedTabRef tracks which tab Nadia has greeted on', function() {
  assert(/var lastGreetedTabRef = useRef\(null\)/.test(greeter),
    'lastGreetedTabRef must be declared to avoid re-greeting same tab');
});

test('S17.6.T2 Tab-greeting effect waits for initial login greeting first', function() {
  var m = greeter.match(/useEffect\(function\(\) \{[\s\S]{0,800}lastGreetedTabRef/);
  assert(m, 'tab-greeting effect found');
  assert(/if \(!hasGreeted\) return;\s*\/\/ wait for initial greeting first/.test(m[0])
    || /if \(!hasGreeted\) return;/.test(m[0]),
    'effect must skip until login greeting has happened (!hasGreeted)');
});

test('S17.6.T3 Dashboard tab does NOT trigger tab_greeting (dashboard is primary home)', function() {
  assert(/if \(contextTab === 'dashboard'\) return;/.test(greeter),
    'dashboard tab must be excluded from tab_greeting');
});

test('S17.6.T4 Tab-greeting fires at most once per tab via ref comparison', function() {
  assert(/if \(lastGreetedTabRef\.current === contextTab\) return;/.test(greeter),
    'must skip if we\'ve already greeted this tab');
  assert(/lastGreetedTabRef\.current = contextTab;/.test(greeter),
    'must record that we\'ve now greeted this tab');
});

test('S17.6.T5 Tab-greeting is deferred slightly so tab paints first', function() {
  // The setTimeout delay for tab greeting
  var m = greeter.match(/useEffect\(function\(\) \{[\s\S]{0,800}lastGreetedTabRef[\s\S]{0,500}setTimeout\(function\(\) \{\s*doSend\(null, 'tab_greeting'\);\s*\}, 600\)/);
  assert(m, 'tab-greeting must setTimeout 600ms before firing doSend');
});

test('S17.6.T6 Tab-greeting deps include contextTab, hasGreeted, enabled', function() {
  // The useEffect deps must trigger on tab change and login greeting completion
  var m = greeter.match(/lastGreetedTabRef[\s\S]{0,600}\}, \[contextTab, hasGreeted, enabled\]\)/);
  assert(m, 'useEffect deps must include contextTab, hasGreeted, enabled');
});

// ======================================================
// PART 2 — doSend handles tab_greeting mode
// ======================================================

test('S17.6.D1 doSend detects tab_greeting vs login greeting vs normal message', function() {
  assert(/var isTabGreet = isGreeting === 'tab_greeting';/.test(greeter),
    'doSend must detect tab_greeting string mode');
  assert(/var isLoginGreet = isGreeting === true;/.test(greeter),
    'doSend must detect login greeting (isGreeting === true)');
  assert(/var anyGreeting = isLoginGreet \|\| isTabGreet;/.test(greeter),
    'doSend must distinguish either-greeting from normal message');
});

test('S17.6.D2 Tab_greeting does NOT reset visible messages (conversation stays)', function() {
  // For login greeting, msgs = []. For tab greeting, msgs keeps existing history.
  assert(/var msgs = isLoginGreet \? \[\] : \[\]\.concat\(messages\);/.test(greeter),
    'only login greeting wipes visible messages; tab greeting preserves them');
});

test('S17.6.D3 Tab_greeting prompt is tab-specific and actionable', function() {
  // S17.7 updated: prompt now asks for 2-3 sentences (not 1 short sentence)
  // with specific numbers/names + warm tone, because the old 15-word cap
  // made Nadia sound robotic.
  assert(/The user just navigated to the "' \+ contextTab \+ '" tab/.test(greeter),
    'tab_greeting prompt must reference the current tab');
  assert(/Give a 2-3 sentence proactive update/.test(greeter),
    'tab_greeting must request a 2-3 sentence update (upgraded from old terse 15-word version)');
  assert(/cite real numbers, names, counts, or dates/.test(greeter),
    'tab_greeting must instruct Nadia to cite specific data from context');
  assert(/Do NOT say hello\/hi\/good morning/.test(greeter),
    'tab_greeting must tell Nadia to skip greeting words');
});

test('S17.6.D4 Tab_greeting does NOT trigger expensive morning briefing', function() {
  // Server only computes briefing when isGreeting=true. Tab greeting should
  // send isLoginGreet (false for tab_greeting) so briefing is skipped.
  var m = greeter.match(/payload = useV2[\s\S]{0,600}isGreeting: isLoginGreet/);
  assert(m, 'payload.isGreeting must be isLoginGreet (not anyGreeting) so tab greet skips briefing');
});

test('S17.6.D5 Tab_greeting still skips chat history in API call', function() {
  // history: anyGreeting ? [] : hist.slice(-8) — both greeting types start fresh on server
  assert(/history: anyGreeting \? \[\] : hist\.slice\(-8\)/.test(greeter),
    'both greeting types must send empty history to keep prompts focused');
});

// ======================================================
// PART 3 — TTS CUTOFF FIX
// ======================================================

test('S17.6.TTS1 doSpeak captures a unique speech ID per invocation', function() {
  assert(/var mySpeechId = Date\.now\(\) \+ '-' \+ Math\.random\(\)\.toString\(36\)/.test(greeter),
    'each doSpeak call must generate a unique speech ID');
});

test('S17.6.TTS2 doSpeak tags the new audio element with speech ID', function() {
  assert(/audio\._speechId = mySpeechId;/.test(greeter),
    'audio element must be tagged with mySpeechId for later race checks');
});

test('S17.6.TTS3 fireStop no-ops if speech ID no longer matches (race safety)', function() {
  // When a NEW speech starts, the OLD audio's onended shouldn't flip state
  assert(/if \(audioRef\.current && audioRef\.current\._speechId !== mySpeechId\) return;/.test(greeter),
    'fireStop must guard with speech ID comparison');
});

test('S17.6.TTS4 doSpeak stops prior audio BEFORE starting new', function() {
  // Unlink + pause before the new audio setup
  assert(/audioRef\.current = null;[\s\S]{0,80}prior\.onended = null;[\s\S]{0,80}prior\.pause\(\)/.test(greeter),
    'must unlink audioRef, null handlers, pause prior audio');
});

test('S17.6.TTS5 doSpeak broadcasts nadia-stop-all with senderId (S17.9 fix)', function() {
  // S17.9 (Apr 23) — the event now carries a senderId so instances can
  // ignore events they sent themselves. Without this, Nadia was cutting
  // off after 2-3 words by telling herself to stop.
  assert(/new CustomEvent\('nadia-stop-all', \{\s*detail: \{ senderId: instanceIdRef\.current \}/.test(greeter),
    'nadia-stop-all event must carry senderId tag (S17.9)');
});

test('S17.6.TTS6 AIGreeter listens for nadia-stop-all but ignores own signal (S17.9 fix)', function() {
  // Listener now accepts the event object, checks senderId, ignores if self
  assert(/var onStopAll = function\(ev\) \{/.test(greeter),
    'onStopAll takes the event so it can inspect senderId');
  assert(/if \(senderId && senderId === instanceIdRef\.current\) return;/.test(greeter),
    'onStopAll must ignore events that came from this same instance');
  assert(/window\.addEventListener\('nadia-stop-all', onStopAll\)/.test(greeter),
    'AIGreeter must register nadia-stop-all listener');
  assert(/window\.removeEventListener\('nadia-stop-all', onStopAll\)/.test(greeter),
    'cleanup must remove listener (no memory leak)');
});

test('S17.6.TTS7 doSpeak honors mute that happened during TTS fetch', function() {
  // If user mutes while the TTS fetch is still pending, we should NOT
  // play the blob when it arrives. Check inside the .then(blob) block.
  var m = greeter.match(/\}\)\.then\(function\(blob\) \{[\s\S]{0,300}if \(muted\) return;/);
  assert(m, 'after TTS fetch returns, must re-check muted before playing');
});

// ======================================================
// PART 4 — ALWAYS-MOUNTED OVERLAY AIGREETER
// ======================================================

test('S17.6.O1 Overlay mounts AIGreeter even when pill is collapsed', function() {
  // The collapsed branch must include <AIGreeter ... /> (visually hidden)
  var collapsedBranch = overlay.match(/if \(!expanded\) \{[\s\S]*?return \(\s*<>[\s\S]*?<\/>\s*\);/);
  assert(collapsedBranch, 'collapsed return should be a fragment with hidden AIGreeter');
  assert(/<AIGreeter \{\.\.\.props\} muted=\{muted\}/.test(collapsedBranch ? collapsedBranch[0] : ''),
    'collapsed pill must include the hidden AIGreeter mount');
});

test('S17.6.O2 Hidden AIGreeter is visually invisible but rendered', function() {
  // Positioned offscreen with very small size
  assert(/position: 'fixed', left: -99999, top: -99999, width: 1, height: 1/.test(overlay),
    'hidden AIGreeter wrapper must be positioned offscreen');
});

test('S17.6.O3 Hidden wrapper has aria-hidden and pointer-events:none', function() {
  assert(/aria-hidden="true"/.test(overlay),
    'hidden wrapper must have aria-hidden for a11y');
  assert(/pointerEvents: 'none'/.test(overlay),
    'hidden wrapper must have pointer-events:none so it doesn\'t steal clicks');
});

test('S17.6.O4 Collapsed pill shows unread message count badge', function() {
  assert(/var unreadCount = 0/.test(overlay),
    'unreadCount state must be computed');
  assert(/unreadCount > 0 && !muted/.test(overlay),
    'badge shows only when there are unread messages AND user is not muted');
});

test('S17.6.O5 Unread count resets when user opens the pill', function() {
  assert(/var \[lastOpenedAt, setLastOpenedAt\] = useState/.test(overlay),
    'lastOpenedAt state must exist');
  assert(/if \(expanded\) setLastOpenedAt\(Date\.now\(\)\)/.test(overlay),
    'opening the pill must update lastOpenedAt to clear unread indicator');
});

test('S17.6.O6 Badge style is pill-shaped with number, not just a dot', function() {
  // Before: just a small dot indicator. Now: shows the actual count.
  assert(/\{unreadCount\}/.test(overlay),
    'badge must render the count number, not just an indicator dot');
});

// ======================================================
// PART 5 — REGRESSION (dashboard Nadia unchanged)
// ======================================================

test('S17.6.REG1 Dashboard AIGreeter still mounted directly in page.jsx', function() {
  var direct = (page.match(/<AIGreeter\b/g) || []).length;
  assert(direct === 1,
    'exactly one direct <AIGreeter> mount must remain (dashboard home) — found ' + direct);
});

test('S17.6.REG2 Dashboard AIGreeter does NOT receive muted or context props (S17.8 revert)', function() {
  // S17.8 reverted dashboard to original props — no muted, no context props.
  // The overlay still handles muting/context for non-dashboard tabs.
  var m = page.match(/<AIGreeter\s[\s\S]*?\/>/);
  assert(m && !/muted=\{nadiaMuted\}/.test(m[0]),
    'dashboard AIGreeter must NOT receive muted prop (original behavior restored)');
  assert(m && !/contextTab=\{tab\}/.test(m[0]),
    'dashboard AIGreeter must NOT receive contextTab (original behavior restored)');
});

test('S17.6.REG3 Login greeting still fires on loginHistoryLoaded', function() {
  assert(/if \(hasGreeted \|\| !enabled \|\| !loginHistoryLoaded\) return;/.test(greeter),
    'initial login greeting must still gate on loginHistoryLoaded');
});

test('S17.6.REG4 Overlay still gated on tab !== dashboard', function() {
  assert(/tab !== 'dashboard' && \(\s*<NadiaFloatingOverlay/.test(page),
    'overlay must still skip dashboard (dashboard has its own AIGreeter)');
});

test('S17.6.REG5 nadiaMuted state still shared between dashboard + overlay', function() {
  assert(/const \[nadiaMuted, setNadiaMuted\] = useState\(/.test(page),
    'shared nadiaMuted state must still be at page level');
});

test('S17.6.REG6 Morning briefing card wiring still intact', function() {
  assert(/if \(data\.briefing && \(data\.briefing\.top3 \|\| data\.briefing\.all_clear\)\)/.test(greeter),
    'briefing card wiring still present in doSend response handler');
});

test('S17.6.REG7 Close-with-comment modal still works (S17)', function() {
  var ticketsTab = fs.readFileSync(path.join(REPO, 'src/components/TicketsTab.jsx'), 'utf8');
  assert(/const finalizeClose = async \(\) => \{/.test(ticketsTab),
    'S17 finalizeClose still defined');
});

test('S17.6.REG8 Check uncollect still intact', function() {
  assert(/const handleUncollectCheck = async \(check, reason\) =>/.test(page),
    'check uncollect handler still defined');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
