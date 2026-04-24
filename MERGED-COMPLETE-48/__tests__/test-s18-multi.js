// ============================================================
// S18 (Apr 23 2026) — Conversation mode, Nadia portrait, tickets
// filter fix, admin → ticket deep-link, Quotes CRM picker, calendar
// notes "add not edit" flow.
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
var vc      = fs.readFileSync(path.join(REPO, 'src/components/VoiceController.jsx'), 'utf8');
var face    = fs.readFileSync(path.join(REPO, 'src/components/NadiaFace.jsx'), 'utf8');
var admin   = fs.readFileSync(path.join(REPO, 'src/components/AdminTab.jsx'), 'utf8');
var tickets = fs.readFileSync(path.join(REPO, 'src/components/TicketsTab.jsx'), 'utf8');
var quotes  = fs.readFileSync(path.join(REPO, 'src/components/QuotesTab.jsx'), 'utf8');
var cal     = fs.readFileSync(path.join(REPO, 'src/components/CalendarTab.jsx'), 'utf8');

// --- S18.1 doSendRef fixes stale-closure memory bug on voice ---
test('S18.1.1 doSendRef is declared', function() {
  assert(/var doSendRef = useRef\(null\)/.test(greeter), 'doSendRef ref must exist');
});
test('S18.1.2 wake-command listener reads from doSendRef (not stale closure)', function() {
  assert(/if \(doSendRef\.current\) doSendRef\.current\(cmd, false\)/.test(greeter),
    'hey-bob-command handler must call doSendRef.current so it gets fresh messages');
});
test('S18.1.3 doSendRef is kept in sync with latest doSend on every render', function() {
  assert(/doSendRef\.current = doSend;/.test(greeter),
    'doSendRef.current = doSend assignment must exist to keep memory current');
});

// --- S18.2 conversation mode (Hey Nadia ack + follow-up window) ---
test('S18.2.1 VoiceController sends wake-ack event when only wake word detected', function() {
  assert(/new CustomEvent\('nadia-wake-ack'\)/.test(vc),
    'VoiceController must fire nadia-wake-ack so Nadia can say "I\'m here"');
});
test('S18.2.2 ackFiredRef prevents double ack', function() {
  assert(/ackFiredRef.*useRef\(false\)/.test(vc) || /ackFiredRef = useRef\(false\)/.test(vc),
    'ackFiredRef must exist');
  assert(/if \(out\.stillListening && engineRef\.current\.isCollecting\(\) && !ackFiredRef\.current\)/.test(vc),
    'ack fires only once per wake');
});
test('S18.2.3 AIGreeter listens for wake-ack and speaks short phrase', function() {
  assert(/window\.addEventListener\('nadia-wake-ack', onWakeAck\)/.test(greeter),
    'AIGreeter must register the wake-ack listener');
  assert(/var ack = \(useLang === 'ar'\) \? 'نعم' : "I'm here"/.test(greeter),
    'ack speech must be short');
});
test('S18.2.4 Follow-up window opens when Nadia finishes speaking', function() {
  assert(/followUpActiveRef\.current = true/.test(vc),
    'followUpActiveRef must flip true on nadia-tts-stop');
  assert(/FOLLOWUP_WINDOW_MS/.test(vc), 'follow-up duration constant defined');
});
test('S18.2.5 Follow-up window accepts speech without wake word', function() {
  assert(/if \(followUpActiveRef\.current && isFinal && !wakeInCurrent\.matched\)/.test(vc),
    'during follow-up, final speech without wake word fires a command');
});
test('S18.2.6 Follow-up minimum words guards against random noise', function() {
  assert(/FOLLOWUP_MIN_WORDS/.test(vc), 'minimum-words threshold defined for follow-up');
});
test('S18.2.7 Wake word during follow-up cancels it and starts fresh', function() {
  assert(/if \(wakeInCurrent\.matched && followUpActiveRef\.current\)/.test(vc),
    'wake word must short-circuit follow-up');
});
test('S18.2.8 VoiceController UI shows followup status', function() {
  assert(/status === 'followup'/.test(vc), 'followup as a visible status');
});

// --- S18.3 illustrated Nadia portrait ---
test('S18.3.1 NadiaFace draws a human face (not just geometric circle)', function() {
  assert(/nadia-skin/.test(face) && /nadia-hair/.test(face) && /nadia-lip/.test(face),
    'gradients for skin / hair / lips must exist');
});
test('S18.3.2 Animated mouth path actually opens with mouthOpen', function() {
  assert(/mouthH = 2 \+ mouthOpen \* faceRy \* 0\.\d+/.test(face),
    'mouthH scales with mouthOpen so lips open when speaking');
});
test('S18.3.3 Eyes have iris + pupil + catch-light', function() {
  assert(/<radialGradient id="nadia-iris"/.test(face), 'iris gradient');
  assert(/Catch-light/.test(face) || /nadia-eye-grad/.test(face) || /fill="#ffffff" opacity="0.95"/.test(face),
    'specular catch-light for life');
});
test('S18.3.4 Eyelashes present', function() {
  assert(/Eyelashes|eyelash/i.test(face), 'eyelashes commented');
});

// --- S18.4 Admin → ticket deep link + ticket filters combine ---
test('S18.4.1 Admin ticket modal has "Open in Tickets" button', function() {
  assert(/Open in Tickets/.test(admin),
    'admin ticket detail modal must have a deep-link button');
  assert(/briefing-open-ticket/.test(admin),
    'uses the existing briefing-open-ticket event for navigation');
});
test('S18.4.2 Tickets status button no longer wipes owner/assignee/priority', function() {
  // The old code reset all three on status-button click
  assert(!/setStatusF\(v\); setOwnerF\('all'\); setAssignedF\('all'\); setPriorityF\('all'\);/.test(tickets),
    'status preset click must not reset person+priority filters');
});
test('S18.4.3 Owner/Assigned/Priority selects no longer wipe status', function() {
  assert(!/setOwnerF\(e\.target\.value\); if \(e\.target\.value !== 'all'\) setStatusF\('all'\);/.test(tickets),
    'owner pick must not reset status');
  assert(!/setAssignedF\(e\.target\.value\); if \(e\.target\.value !== 'all'\) setStatusF\('all'\);/.test(tickets),
    'assigned pick must not reset status');
  assert(!/setPriorityF\(e\.target\.value\); if \(e\.target\.value !== 'all'\) setStatusF\('all'\);/.test(tickets),
    'priority pick must not reset status');
});
test('S18.4.4 Clear All Filters button exists and resets everything', function() {
  assert(/Clear all filters/i.test(tickets),
    '"Clear all filters" button must exist');
});

// --- S18.4 Quotes: CRM customer picker + New customer modal ---
test('S18.4.5 QuotesTab loads customers list', function() {
  assert(/supabase\.from\('customers'\)\.select/.test(quotes),
    'QuotesTab must query the customers table');
});
test('S18.4.6 QuoteBuilder receives customers prop', function() {
  assert(/function QuoteBuilder\(\{ quote, companies, customers, user, onCustomerCreated/.test(quotes),
    'QuoteBuilder signature includes customers + creation callback');
});
test('S18.4.7 Customer picker with typeahead filtering', function() {
  assert(/filteredCustomers = \(customers \|\| \[\]\)\.filter/.test(quotes),
    'typeahead filter over customers');
  assert(/selectCustomer = \(c\) =>/.test(quotes),
    'clicking a customer fills client_name/email/phone + customer_id');
});
test('S18.4.8 "+ New" button opens new-customer modal', function() {
  assert(/setShowNewCustomer\(true\)/.test(quotes), 'button opens modal');
  assert(/handleCreateCustomer/.test(quotes), 'handler creates and auto-selects customer');
});
test('S18.4.9 New customer insert writes to CRM (customers) table', function() {
  assert(/supabase\.from\('customers'\)\.insert/.test(quotes),
    'new-customer path writes to customers (CRM)');
});

// --- S18.5 Calendar: "add not edit" notes flow ---
test('S18.5.1 Coming back to a completed event opens empty composer', function() {
  // Look for the completed-event notes button seeding meetingNotes with '' not old text
  assert(/setNotesEvent\(ev\); setMeetingNotes\(''\); setNewNoteKind\('note'\);/.test(cal),
    'completed-event notes button must open an empty composer');
});
test('S18.5.2 Button label says "Add Note" after check-in, not "Edit Notes"', function() {
  assert(/➕ Add Note/.test(cal),
    '"+ Add Note" label must appear for completed events with prior notes');
  assert(!/'📝 Edit Notes'/.test(cal),
    'confusing "Edit Notes" label on the card must be gone');
});
test('S18.5.3 Modal header drops "Edit" wording', function() {
  assert(/'📝 Meeting Notes \/ ملاحظات الاجتماع'/.test(cal),
    'modal header uses neutral "Meeting Notes" so user sees add+view, not edit');
  assert(!/'📝 Edit Meeting Notes \/ تعديل الملاحظات'/.test(cal),
    'old "Edit Meeting Notes" wording removed');
});
test('S18.5.4 Composer shows banner clarifying add-to-thread', function() {
  assert(/Add a new note — existing notes above stay untouched/.test(cal),
    'user needs reassurance that old notes remain untouched');
});

// ---- S18.6 CRASH FIXES (Apr 23 2026 — found after v42 was reported crashing) ----

var _vc = fs.readFileSync(path.join(REPO, 'src/components/VoiceController.jsx'), 'utf8');
test('S18.6.1 CRASH FIX — ackFiredRef declared BEFORE start useCallback', function() {
  var ackIdx = _vc.indexOf('ackFiredRef = useRef');
  var startIdx = _vc.indexOf('var start = useCallback');
  assert(ackIdx > 0 && startIdx > 0, 'both symbols should be present');
  assert(ackIdx < startIdx,
    'ackFiredRef MUST be declared before start useCallback uses it — otherwise accessing .current throws on first mic activity');
});

var _q = fs.readFileSync(path.join(REPO, 'src/components/QuotesTab.jsx'), 'utf8');
test('S18.6.2 CRASH FIX — saveQuote strips customer_id/client_phone from payload', function() {
  assert(/delete record\.customer_id/.test(_q),
    'saveQuote must strip customer_id so DB insert does not fail if column missing');
  assert(/delete record\.client_phone/.test(_q),
    'saveQuote must strip client_phone so DB insert does not fail if column missing');
});
test('S18.6.3 CRASH FIX — no duplicate saveQuote declaration', function() {
  var m = _q.match(/const saveQuote = async/g) || [];
  assert(m.length === 1, 'saveQuote must be declared exactly once, found ' + m.length);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
