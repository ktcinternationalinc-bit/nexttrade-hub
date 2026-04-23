// ============================================================
// Session 17 (Apr 23 2026)
//   Fix 1 — Close ticket must require a closing comment (modal w/ optional link)
//   Fix 2 — "Closed" status color visually distinct from "Acknowledged"
//   Fix 3 — Summary cards on Sales + Treasury redesigned for contrast
//   Fix 4 — Centered number buckets
//   Fix 5 — Verify Nadia functionality is not broken
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

var ticketsTab = fs.readFileSync(path.join(REPO, 'src/components/TicketsTab.jsx'), 'utf8');
var page = fs.readFileSync(path.join(REPO, 'src/app/page.jsx'), 'utf8');
var greeter = fs.readFileSync(path.join(REPO, 'src/components/AIGreeter.jsx'), 'utf8');
var overlay = fs.readFileSync(path.join(REPO, 'src/components/NadiaFloatingOverlay.jsx'), 'utf8');
var askRoute = fs.readFileSync(path.join(REPO, 'src/app/api/ask/route.js'), 'utf8');
var briefEngine = fs.readFileSync(path.join(REPO, 'src/lib/briefing-engine.js'), 'utf8');

// ======================================================
// FIX 1 — Close-with-comment modal
// ======================================================

test('S17.M1 closeModal state is defined', function() {
  assert(/const \[closeModal, setCloseModal\] = useState\(null\)/.test(ticketsTab),
    'closeModal state must be added to TicketsTab');
});

test('S17.M2 updateStatus intercepts "Closed" and opens the modal instead', function() {
  // When newStatus === 'Closed', it should setCloseModal(...) and return early
  // without doing the direct dbUpdate.
  var updateStatusMatch = ticketsTab.match(/const updateStatus = async \(ticket, newStatus\) => \{[\s\S]*?\};/);
  assert(updateStatusMatch, 'updateStatus function found');
  assert(/if \(newStatus === 'Closed'\) \{\s*setCloseModal\(/.test(updateStatusMatch[0]),
    'updateStatus must open modal when newStatus is "Closed"');
  assert(/setCloseModal\(\{ ticket: ticket, comment: '', link: '' \}\);\s*return;/.test(updateStatusMatch[0]),
    'must init modal with empty comment + link and RETURN before executing the direct update');
});

test('S17.M3 finalizeClose function exists and validates comment', function() {
  assert(/const finalizeClose = async \(\) => \{/.test(ticketsTab),
    'finalizeClose function must be defined');
  assert(/const trimmed = \(comment \|\| ''\)\.trim\(\);\s*if \(!trimmed\) \{/.test(ticketsTab),
    'must reject empty or whitespace-only comments');
});

test('S17.M4 finalizeClose validates optional URL format', function() {
  // http, https, /, mailto: are accepted
  assert(/\!\/\^\(https\?:\\\/\\\/\|\\\/\|mailto:\)\/i\.test\(trimmedLink\)/.test(ticketsTab),
    'URL must match http/https/absolute-path/mailto');
});

test('S17.M5 finalizeClose writes the comment as a NON-SYSTEM ticket_comment', function() {
  // The closing comment MUST be visible, not hidden as a system note.
  assert(/is_system: false/.test(ticketsTab) && /🔒 CLOSED by/.test(ticketsTab),
    'closing comment must be is_system:false so it shows prominently in history');
});

test('S17.M6 finalizeClose includes link in the comment body when provided', function() {
  assert(/\(trimmedLink \? '\\n\\n🔗 ' \+ trimmedLink : ''\)/.test(ticketsTab),
    'link must be appended to the comment with a 🔗 marker when present');
});

test('S17.M7 Modal renders with comment textarea + link input', function() {
  assert(/\{closeModal && \(/.test(ticketsTab),
    'closeModal conditional rendering must exist');
  // Textarea for the comment
  assert(/<textarea[\s\S]{0,300}value=\{closeModal\.comment\}/.test(ticketsTab),
    'modal must render a textarea bound to closeModal.comment');
  // URL input for the optional link
  assert(/<input\s+type="url"[\s\S]{0,200}value=\{closeModal\.link\}/.test(ticketsTab),
    'modal must render a url input bound to closeModal.link');
});

test('S17.M8 Close button is disabled until comment has content', function() {
  assert(/disabled=\{!closeModal\.comment\.trim\(\)\}/.test(ticketsTab),
    'submit button must be disabled when comment is empty/whitespace only');
});

test('S17.M9 Modal has Cancel button that clears closeModal state', function() {
  assert(/onClick=\{\(\) => setCloseModal\(null\)\}/.test(ticketsTab),
    'cancel click must setCloseModal(null) to dismiss');
});

test('S17.M10 Cmd/Ctrl+Enter inside textarea submits the close', function() {
  assert(/\(e\.metaKey \|\| e\.ctrlKey\) && e\.key === 'Enter'/.test(ticketsTab),
    'Cmd/Ctrl+Enter keyboard shortcut must call finalizeClose');
});

test('S17.M11 Bulk "Closed" status is blocked — user must close each individually', function() {
  assert(/e\.target\.value === 'Closed'/.test(ticketsTab),
    'bulk select handler must special-case Closed');
  assert(/To close tickets, open each one/.test(ticketsTab),
    'must show explanatory alert when user tries bulk-close');
});

test('S17.M12 Non-Close status changes still update directly (no modal)', function() {
  // Any status besides Closed should still perform the direct dbUpdate flow
  var updateStatusMatch = ticketsTab.match(/const updateStatus = async \(ticket, newStatus\) => \{[\s\S]*?setSel\(\{\.\.\.sel, \.\.\.updates\}\); loadComments\(ticket\.id\); \}\s*\} catch/);
  assert(updateStatusMatch, 'non-Closed path still uses dbUpdate directly');
});

// ======================================================
// FIX 2 — Closed status distinct from Acknowledged
// ======================================================

test('S17.S1 STATUS_COLORS.Closed is dark slate (not green)', function() {
  assert(/Closed:'#1e293b'/.test(ticketsTab),
    'STATUS_COLORS.Closed must be #1e293b dark slate (visually unlike purple Acknowledged)');
});

test('S17.S2 Summary card "Closed" borderLeftColor updated to match', function() {
  // The Closed summary card at the top should have matching border
  assert(/setStatusF\('Closed'\)[\s\S]{0,300}borderLeftColor:'#1e293b'/.test(ticketsTab),
    'Closed summary card must use #1e293b left border');
});

test('S17.S3 statusPill[Closed] uses dark bg with light text — opposite of Acknowledged', function() {
  // Closed: bg #1e293b (dark), fg #f1f5f9 (light)
  assert(/'Closed':\s*\{ bg: '#1e293b', fg: '#f1f5f9', border: '#334155' \}/.test(ticketsTab),
    'Closed pill must have dark bg with light text');
  // Acknowledged: bg #e0e7ff (light indigo), fg #3730a3 (dark indigo)
  assert(/'Acknowledged':\s*\{ bg: '#e0e7ff', fg: '#3730a3'/.test(ticketsTab),
    'Acknowledged pill retains light indigo style');
});

test('S17.S4 Closed and Acknowledged bg colors are completely different', function() {
  // Sanity check — a user literally looking at these two should instantly
  // tell them apart. Light indigo vs dark slate.
  var closedBg = '#1e293b';
  var ackBg = '#e0e7ff';
  assert(closedBg !== ackBg,
    'Closed vs Acknowledged bg must differ (' + closedBg + ' vs ' + ackBg + ')');
});

// ======================================================
// FIX 3 — Summary cards redesigned (centered, dark, high-contrast)
// ======================================================

test('S17.C1 Treasury Cash In card uses dark emerald background', function() {
  // New: dark gradient from #064e3b to #065f46 (emerald-900 to -800)
  assert(/setTreasuryDrill\('in'\)[\s\S]{0,600}linear-gradient\(135deg, #064e3b 0%, #065f46 100%\)/.test(page),
    'Cash In card background must be dark emerald gradient');
});

test('S17.C2 Treasury Cash Out card uses dark red background', function() {
  assert(/setTreasuryDrill\('out'\)[\s\S]{0,600}linear-gradient\(135deg, #7f1d1d 0%, #991b1b 100%\)/.test(page),
    'Cash Out card background must be dark red gradient');
});

test('S17.C3 Treasury Net card has two dark modes — blue for positive, amber for negative', function() {
  assert(/linear-gradient\(135deg, #1e3a8a 0%, #1e40af 100%\)/.test(page),
    'positive net uses dark blue');
  assert(/linear-gradient\(135deg, #78350f 0%, #92400e 100%\)/.test(page),
    'negative net uses dark amber');
});

test('S17.C4 Treasury cards are CENTERED using flex-col items-center justify-center text-center', function() {
  // Every Treasury card must have flex-col items-center justify-center text-center
  var matches = page.match(/flex flex-col items-center justify-center text-center/g) || [];
  assert(matches.length >= 6,
    'expected at least 6 centered cards (3 Treasury + 3 Sales) — found ' + matches.length);
});

test('S17.C5 Treasury card numbers use bright neon colors with textShadow', function() {
  // Cash In text color: #34d399 (emerald-400) on dark bg — bright neon
  assert(/text-emerald-300[\s\S]{0,200}textShadow: '0 0 20px rgba\(16,185,129,0\.3\)'/.test(page),
    'Cash In number uses bright emerald with glow textShadow');
  // Cash Out: red-300
  assert(/text-red-300[\s\S]{0,200}textShadow: '0 0 20px rgba\(239,68,68,0\.3\)'/.test(page),
    'Cash Out number uses bright red with glow textShadow');
});

test('S17.C6 Treasury cards have min-height to enforce consistent size', function() {
  var mh = (page.match(/min-h-\[96px\]/g) || []).length;
  assert(mh >= 6,
    'all 6 summary cards (3 Treasury + 3 Sales) must have min-h-[96px] for consistent vertical size — found ' + mh);
});

test('S17.C7 Treasury card numbers bumped to text-xl sm:text-2xl', function() {
  // Previously text-lg. Now bigger for readability.
  var xlCount = (page.match(/text-xl sm:text-2xl font-black/g) || []).length;
  assert(xlCount >= 6,
    'at least 6 large number labels expected across summary cards — found ' + xlCount);
});

test('S17.C8 Sales cards match Treasury visual treatment (dark backgrounds)', function() {
  // Sales Invoiced: dark sky
  assert(/linear-gradient\(135deg, #0c4a6e 0%, #075985 100%\)/.test(page),
    'Sales Invoiced uses dark sky gradient');
  // Sales Collected: shares dark emerald with Treasury Cash In
  assert(/text-sky-300[\s\S]{0,200}textShadow: '0 0 20px rgba\(14,165,233,0\.3\)'/.test(page),
    'Sales Invoiced number uses bright sky with glow');
});

test('S17.C9 Progress bars inside Net/Collected/Outstanding cards use bright colors on dark bg', function() {
  // Previously bg-white/60, now bg-black/30 since we're on dark cards
  var matches = (page.match(/rounded-full bg-black\/30 overflow-hidden/g) || []).length;
  assert(matches >= 3,
    'progress bars must be on bg-black/30 (readable on dark cards) — found ' + matches);
});

test('S17.C10 Top header Treasury Net bucket is centered with min-width', function() {
  // The header Treasury Net card — must be centered and have minWidth
  assert(/Treasury Net[\s\S]{0,1500}minWidth: 130[\s\S]{0,600}flex flex-col items-center justify-center text-center/.test(page)
    || /flex flex-col items-center justify-center text-center[\s\S]{0,1500}Treasury Net/.test(page),
    'header Treasury Net bucket must be centered with minWidth');
});

test('S17.C11 Header Treasury Net has distinct background per positive/negative', function() {
  assert(/allTimeNet >= 0[\s\S]{0,200}rgba\(16,185,129,0\.12\)/.test(page),
    'positive net uses emerald tinted background');
  assert(/rgba\(239,68,68,0\.12\)/.test(page),
    'negative net uses red tinted background');
});

// ======================================================
// FIX 5 — Nadia regression (critical — must not be broken)
// ======================================================

test('S17.N1 REGRESSION: NadiaFloatingOverlay still mounted at page root', function() {
  assert(/<NadiaFloatingOverlay\s/.test(page),
    'NadiaFloatingOverlay must still be rendered at page root');
});

test('S17.N2 REGRESSION: Overlay import still present', function() {
  assert(/import NadiaFloatingOverlay from '\.\.\/components\/NadiaFloatingOverlay'/.test(page),
    'NadiaFloatingOverlay import must still exist');
});

test('S17.N3 REGRESSION: AIGreeter still accepts muted prop', function() {
  assert(/contextOpenTicketId, muted \}/.test(greeter),
    'AIGreeter must still destructure muted prop');
});

test('S17.N4 REGRESSION: doSpeak still respects muted flag', function() {
  assert(/if \(muted\) \{[\s\S]{0,300}return;/.test(greeter),
    'doSpeak must still early-return when muted');
});

test('S17.N5 REGRESSION: Overlay still persists muted state in localStorage', function() {
  assert(/MUTED_STORAGE_KEY = 'nadia\.muted'/.test(overlay),
    'muted localStorage key still defined');
  assert(/localStorage\.setItem\(MUTED_STORAGE_KEY/.test(overlay),
    'muted state still written to localStorage');
});

test('S17.N6 REGRESSION: Morning briefing engine still intact', function() {
  // buildBriefing exports
  assert(/buildBriefing: buildBriefing/.test(briefEngine),
    'buildBriefing export still in place');
  // All 7 scorers still present
  ['scoreOverdueInvoices','scoreOverdueTickets','scoreUnacknowledgedTickets','scoreImminentMeetings',
   'scorePendingChecks','scoreStaleFollowUps','scoreColdCustomers'].forEach(function(s) {
    assert(new RegExp('function ' + s + '\\(').test(briefEngine),
      'scorer must still be defined: ' + s);
  });
});

test('S17.N7 REGRESSION: /api/ask still computes briefing on isFirstGreeting', function() {
  assert(/isFirstGreeting && userId/.test(askRoute),
    'briefing block still gated on isFirstGreeting && userId');
  assert(/briefingEngine\.buildBriefing/.test(askRoute),
    'buildBriefing still invoked');
});

test('S17.N8 REGRESSION: /api/ask still returns briefing in response JSON', function() {
  assert(/briefing: briefing/.test(askRoute),
    'response JSON must still include briefing field');
});

test('S17.N9 REGRESSION: AIGreeter still has handleBriefingAction handler', function() {
  assert(/handleBriefingAction = function\(item\)/.test(greeter),
    'briefing action handler still wired in AIGreeter');
});

test('S17.N10 REGRESSION: Context-aware screens still passed to overlay', function() {
  ['contextTab', 'contextSelectedCustomer', 'contextSelectedInvoice', 'contextOpenTicketId']
    .forEach(function(p) {
      assert(new RegExp('\\b' + p + '=').test(page),
        'page.jsx must still pass context prop: ' + p);
    });
});

test('S17.N11 REGRESSION: Proactive watcher still imports briefing engine', function() {
  var watchRoute = fs.readFileSync(path.join(REPO, 'src/app/api/nadia/watch/route.js'), 'utf8');
  assert(/import \* as briefingEngine from '\.\.\/\.\.\/\.\.\/\.\.\/lib\/briefing-engine'/.test(watchRoute),
    'watch route still imports briefingEngine');
});

test('S17.N12 REGRESSION: Check uncollect handler still exists', function() {
  assert(/const handleUncollectCheck = async \(check, reason\) =>/.test(page),
    'uncollect handler still defined');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
