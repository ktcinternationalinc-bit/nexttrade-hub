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

// ==== S22.6 — Calendar save on recurring Saturday visibility ====

test('S22.26 Calendar save explicitly sets created_by on the event', function() {
  var cal = fs.readFileSync(path.join(REPO, 'src/components/CalendarTab.jsx'), 'utf8');
  // Without this, saving events for another user made them invisible in
  // Max's "My" view (filter: assigned_to===me OR created_by===me).
  assert(/created_by: myId/.test(cal),
    'created_by: myId is set in the insert payload');
});

test('S22.27 Calendar navigates to the event date after save', function() {
  var cal = fs.readFileSync(path.join(REPO, 'src/components/CalendarTab.jsx'), 'utf8');
  assert(/setCurDate\(new Date\(y, m, 1\)\)/.test(cal),
    'after save, calendar jumps to the event\'s month');
  assert(/setSelDate\(f\.eventDate\)/.test(cal),
    'after save, the event\'s day is selected so events on it are visible');
});

// ==== S22.7 — Priority Board: per-Max rules ====

test('S22.28 PriorityBoard.jsx exists (previous v48 was missing this file)', function() {
  assert(fs.existsSync(path.join(REPO, 'src/components/PriorityBoard.jsx')),
    'PriorityBoard.jsx exists on disk');
});

test('S22.29 Cross-column drag pushes old primary into additional_assignees', function() {
  var pb = fs.readFileSync(path.join(REPO, 'src/components/PriorityBoard.jsx'), 'utf8');
  assert(/newAdditional\.push\(oldPrimary\)/.test(pb),
    'old primary is demoted to additional_assignees');
});

test('S22.30 Dragged ticket in activity log distinguishes auto-add vs reassign', function() {
  var pb = fs.readFileSync(path.join(REPO, 'src/components/PriorityBoard.jsx'), 'utf8');
  // When target was already on the ticket: "now primary"
  // When target was not on the ticket: "auto-added"
  assert(/var wasAlreadyOnTicket = existingAdditional\.indexOf\(targetUserId\) !== -1 \|\| oldPrimary === targetUserId/.test(pb),
    'detection of whether target was already on the ticket');
  assert(/now primary/.test(pb), 'reassign message');
  assert(/auto-added by system/.test(pb), 'auto-add message');
});

// ==== S22.8 — Unranked pile reordering ====

test('S22.31 Priority convention: 1..999 ranked, 1000+ unranked-ordered, null unranked-unordered', function() {
  var pb = fs.readFileSync(path.join(REPO, 'src/components/PriorityBoard.jsx'), 'utf8');
  assert(/var UNRANKED_FLOOR = 1000/.test(pb),
    'UNRANKED_FLOOR constant defined');
  assert(/p != null && p < UNRANKED_FLOOR/.test(pb),
    'ranked pile = priority < UNRANKED_FLOOR');
});

test('S22.32 Unranked pile sorts user-ordered first, then untouched by created_at', function() {
  var pb = fs.readFileSync(path.join(REPO, 'src/components/PriorityBoard.jsx'), 'utf8');
  assert(/var aOrdered = pa != null && pa >= UNRANKED_FLOOR/.test(pb),
    'ordered check for unranked sort');
  assert(/if \(aOrdered && bOrdered\) return Number\(pa\) - Number\(pb\)/.test(pb),
    'both ordered → by priority');
  assert(/if \(aOrdered\) return -1/.test(pb),
    'ordered before unordered');
});

test('S22.33 Drop zones added to the unranked pile', function() {
  var pb = fs.readFileSync(path.join(REPO, 'src/components/PriorityBoard.jsx'), 'utf8');
  assert(/renderDropZone\(u\.id, 0, 'unranked'\)/.test(pb),
    'top drop zone in unranked pile');
  assert(/renderDropZone\(u\.id, idx \+ 1, 'unranked'\)/.test(pb),
    'inter-card drop zones in unranked pile');
});

test('S22.34 Renumbering uses pile-aware base offset', function() {
  var pb = fs.readFileSync(path.join(REPO, 'src/components/PriorityBoard.jsx'), 'utf8');
  assert(/var base = targetPile === 'unranked' \? UNRANKED_FLOOR : 0/.test(pb),
    'base = 0 for ranked, 1000 for unranked');
});

test('S22.35 Dashboard "Today" strip excludes unranked-ordered (1000+) priorities', function() {
  var page = fs.readFileSync(path.join(REPO, 'src/app/page.jsx'), 'utf8');
  // The strip should only show #1 from the RANKED pile (< 1000).
  // Someone with only unranked-ordered tickets shouldn't appear as
  // having a "top priority for today."
  assert(/if \(Number\(t\.assignee_priority\) >= 1000\) return/.test(page),
    'strip skips tickets with priority >= 1000');
});

// ==== S22.9 — Inventory overhaul ====

test('S22.36 Inventory quantity override uses its own dedicated permission (separate from Edit Inventory)', function() {
  var page = fs.readFileSync(path.join(REPO, 'src/app/page.jsx'), 'utf8');
  // S22.10 — Max: "inventory access is a permission outside of updating
  // inventory values". Two separate permissions:
  //   - "Edit Inventory" = day-to-day (add products, record inbounds, edit
  //     descriptions, photos)
  //   - "Adjust Inventory Quantities" = override Original/Current on an
  //     existing product (audit-event, writes a journal entry)
  assert(/canOverrideQty = userProfile\?\.role === 'super_admin' \|\| modulePerms\?\.\['Adjust Inventory Quantities'\] === true/.test(page),
    'form gate uses Adjust Inventory Quantities');
  assert(/const canOverrideQty = isSuperAdmin \|\| modulePerms\?\.\['Adjust Inventory Quantities'\] === true/.test(page),
    'save-flow gate uses Adjust Inventory Quantities');
  // And the permission is listed in SettingsTab so admins can grant it
  var settings = fs.readFileSync(path.join(REPO, 'src/components/SettingsTab.jsx'), 'utf8');
  assert(/'Adjust Inventory Quantities'/.test(settings),
    'Adjust Inventory Quantities listed in SettingsTab permissions UI');
});

test('S22.36b P&L / cost machinery is preserved (not accidentally removed)', function() {
  // Max explicitly flagged: don't break the P&L / cost / weighted-average
  // feature. This guards against future regressions that would silently
  // remove the cost fields.
  var page = fs.readFileSync(path.join(REPO, 'src/app/page.jsx'), 'utf8');
  assert(/purchase_cost:/.test(page), 'purchase_cost field still written');
  assert(/weighted-average costs/.test(page), 'weighted-average comment still present');
  assert(/modulePerms\?\.\['View Costs'\]/.test(page), 'View Costs permission still gates cost fields');
  assert(/View Financial Reports/.test(page), 'View Financial Reports permission still used');
});

// ==== S22.11 — Multi-unit + apples-to-apples P&L ====

test('S22.39 Product form has Unit of Measure + Linear Density fields', function() {
  var page = fs.readFileSync(path.join(REPO, 'src/app/page.jsx'), 'utf8');
  assert(/Unit of Measure/.test(page), 'UoM label present');
  assert(/value={formData\.prodUom \|\| ''}/.test(page), 'UoM value bound');
  assert(/Linear Density \(g\/m\)/.test(page), 'linear density label');
  assert(/prodLinearDensity/.test(page), 'linear density value bound');
});

test('S22.40 P&L panel shows per-kg, per-ton, per-meter, per-yard normalized views', function() {
  var page = fs.readFileSync(path.join(REPO, 'src/app/page.jsx'), 'utf8');
  assert(/Apples-to-Apples \(per unit of measure\)/.test(page), 'apples-to-apples header');
  assert(/Per kg/.test(page), 'per-kg row');
  assert(/Per ton/.test(page), 'per-ton row');
  assert(/Per meter/.test(page), 'per-meter row');
  assert(/Per yard/.test(page), 'per-yard row');
  // The linear density × weight conversion
  assert(/metersPerUnit = linearDensityGperM > 0 && netWeightPerUnit > 0/.test(page),
    'length ↔ weight conversion');
  assert(/totalYards = totalMeters \/ 0\.9144/.test(page),
    'yard = meter / 0.9144');
});

test('S22.41 Expected inventory can be entered manually (not just via Excel)', function() {
  var page = fs.readFileSync(path.join(REPO, 'src/app/page.jsx'), 'utf8');
  assert(/Add Expected Quantity Manually/.test(page), 'manual entry UI present');
  assert(/supabase\.from\('inventory_expected'\)\.insert/.test(page),
    'writes to inventory_expected table');
});

test('S22.42 Product insert is defensive about missing uom/linear_density columns', function() {
  // If Max hasn't run the s22 SQL yet, the insert must retry without the
  // new columns instead of failing outright.
  var page = fs.readFileSync(path.join(REPO, 'src/app/page.jsx'), 'utf8');
  assert(/column\.\*uom\|column\.\*linear_density/.test(page),
    'catches missing-column error');
  assert(/delete record\.uom[\s\S]{0,80}delete record\.linear_density_g_per_m/.test(page),
    'retries without the new columns');
});

test('S22.43 Import template includes Unit of Measure + Linear Density columns', function() {
  var imp = fs.readFileSync(path.join(REPO, 'src/components/InventoryImport.jsx'), 'utf8');
  assert(/'Unit of Measure'/.test(imp), 'UoM column in template');
  assert(/'Linear Density \(g\/m\)'/.test(imp), 'linear density column in template');
  assert(/uom: String\(getCell\(raw, 'Unit of Measure'\)[^)]*\)\.trim\(\) \|\| null/.test(imp),
    'uom parsed from template');
  assert(/linear_density_g_per_m: parseNumber\(getCell\(raw, 'Linear Density \(g\/m\)'\)\) \|\| null/.test(imp),
    'linear density parsed from template');
});

test('S22.44 SQL migration for uom + linear_density_g_per_m columns ships with the build', function() {
  var sqlPath = path.join(REPO, 'sql/s22_inventory_uom.sql');
  assert(fs.existsSync(sqlPath), 'SQL file exists');
  var sql = fs.readFileSync(sqlPath, 'utf8');
  assert(/ADD COLUMN IF NOT EXISTS uom TEXT/.test(sql), 'adds uom column');
  assert(/ADD COLUMN IF NOT EXISTS linear_density_g_per_m NUMERIC/.test(sql),
    'adds linear density column');
});

test('S22.45 Template download button is available directly on the Inventory tab', function() {
  var page = fs.readFileSync(path.join(REPO, 'src/app/page.jsx'), 'utf8');
  // Previously the Excel template was only reachable from INSIDE the
  // Import modal. Max: "make sure the template is a link I can download
  // from the portal itself." Now there's a button right next to Import
  // that generates the same XLSX on click.
  assert(/Download the Excel template for bulk import/.test(page),
    'tooltip confirms the direct download button');
  assert(/KTC_Inventory_Import_Template\.xlsx/.test(page),
    'filename for the download');
  // The header row must include the new UoM + Linear Density columns so
  // the direct download stays in sync with the import parser.
  assert(/'Unit of Measure','Linear Density \(g\/m\)'/.test(page),
    'template header includes the new UoM + linear density columns');
});

// ==== S22.13 — "Paused" state for Nadia ====

test('S22.46 Paused state separate from muted', function() {
  var greet = fs.readFileSync(path.join(REPO, 'src/components/AIGreeter.jsx'), 'utf8');
  assert(/var \[paused, setPaused\] = useState\(false\)/.test(greet),
    'paused state defined');
  assert(/pausedRef = useRef\(false\)/.test(greet),
    'pausedRef for handlers');
  assert(/pausedRef\.current = paused/.test(greet),
    'ref kept in sync with state');
});

test('S22.47 doSpeak is a no-op while paused', function() {
  var greet = fs.readFileSync(path.join(REPO, 'src/components/AIGreeter.jsx'), 'utf8');
  // Must check paused BEFORE the fetch (cheap) AND again after the blob
  // comes back (in case user paused during the async wait).
  assert(/if \(pausedRef\.current\) \{[\s\S]{0,200}paused — skipping TTS playback/.test(greet),
    'doSpeak guards on paused at entry');
  assert(/S22\.13 — same for paused[\s\S]{0,100}if \(pausedRef\.current\) return/.test(greet),
    'doSpeak re-checks paused after async fetch');
});

test('S22.48 stopSpeech sets paused=true (so she stays quiet after Stop)', function() {
  var greet = fs.readFileSync(path.join(REPO, 'src/components/AIGreeter.jsx'), 'utf8');
  // Scoped to the stopSpeech body
  var m = greet.match(/var stopSpeech = function\(\) \{[\s\S]*?\n  \};/);
  assert(m, 'stopSpeech body found');
  assert(/setPaused\(true\); pausedRef\.current = true/.test(m[0]),
    'stopSpeech enters paused state');
});

test('S22.49 Tab-change greeting respects paused (does not speak if user paused)', function() {
  var greet = fs.readFileSync(path.join(REPO, 'src/components/AIGreeter.jsx'), 'utf8');
  // Two guards in the tab-greet effect: one before the setTimeout, one
  // inside the callback (in case user paused during the 600ms delay).
  assert(/user tapped stop[\s\S]{0,150}if \(pausedRef\.current\) return/.test(greet),
    'tab-greet skipped when paused');
  assert(/Re-check paused right before firing[\s\S]{0,100}if \(pausedRef\.current\) return/.test(greet),
    're-check paused before firing after delay');
});

test('S22.50 "Hey Nadia" wake word clears paused', function() {
  var greet = fs.readFileSync(path.join(REPO, 'src/components/AIGreeter.jsx'), 'utf8');
  // Scoped to onBobCommand body
  var m = greet.match(/var onBobCommand = function\(ev\) \{[\s\S]*?\n    \};/);
  assert(m, 'onBobCommand found');
  assert(/setPaused\(false\); pausedRef\.current = false/.test(m[0]),
    'wake word un-pauses');
});

test('S22.51 Typing a message clears paused', function() {
  var greet = fs.readFileSync(path.join(REPO, 'src/components/AIGreeter.jsx'), 'utf8');
  // handleSubmit explicitly un-pauses
  assert(/handleSubmit = function\(\) \{[\s\S]{0,400}setPaused\(false\); pausedRef\.current = false/.test(greet),
    'handleSubmit un-pauses before calling doSend');
});

test('S22.52 Tapping the mic (listen or record) clears paused', function() {
  var greet = fs.readFileSync(path.join(REPO, 'src/components/AIGreeter.jsx'), 'utf8');
  // startListen body contains the un-pause
  var sl = greet.match(/var startListen = async function\(\) \{[\s\S]*?\n  \};/);
  assert(sl && /setPaused\(false\); pausedRef\.current = false/.test(sl[0]),
    'startListen un-pauses');
  // startRecording body contains the un-pause too
  var sr = greet.match(/var startRecording = async function\(\) \{[\s\S]*?try \{ setPaused\(false\); pausedRef\.current = false; \} catch/);
  assert(sr, 'startRecording un-pauses before doing anything else');
});

test('S22.53 Paused indicator button offers a one-tap wake up', function() {
  var greet = fs.readFileSync(path.join(REPO, 'src/components/AIGreeter.jsx'), 'utf8');
  assert(/Nadia is paused — tap to wake her/.test(greet),
    'visible paused indicator with wake-up button');
  assert(/paused && !speaking && !listening && !recording/.test(greet),
    'indicator shown only when paused AND nothing else is happening');
});

// ==== S22.14 — Quick-create a ticket from Priority Board ====

test('S22.54 Priority Board has quick-create state for per-column new tickets', function() {
  var pb = fs.readFileSync(path.join(REPO, 'src/components/PriorityBoard.jsx'), 'utf8');
  assert(/var \[quickCreateFor, setQuickCreateFor\]/.test(pb),
    'quickCreateFor state defined');
  assert(/var \[quickCreateForm, setQuickCreateForm\]/.test(pb),
    'quickCreateForm state defined');
});

test('S22.55 saveQuickTicket writes to tickets table with proper fields', function() {
  var pb = fs.readFileSync(path.join(REPO, 'src/components/PriorityBoard.jsx'), 'utf8');
  assert(/async function saveQuickTicket\(\)/.test(pb),
    'saveQuickTicket exists');
  // Scoped to the saveQuickTicket body — must set assigned_to, title, status
  var m = pb.match(/async function saveQuickTicket\(\)[\s\S]*?\n  \}/);
  assert(m, 'saveQuickTicket body found');
  assert(/dbInsert\('tickets'/.test(m[0]), 'inserts into tickets table');
  assert(/assigned_to: uid/.test(m[0]), 'assigned_to targets the specific user');
  assert(/status: 'New'/.test(m[0]), 'starts as New');
  assert(/ticket_number:/.test(m[0]), 'generates a ticket number');
});

test('S22.56 "+ New ticket for [Name]" button visible in each column', function() {
  var pb = fs.readFileSync(path.join(REPO, 'src/components/PriorityBoard.jsx'), 'utf8');
  assert(/\+ New ticket for/.test(pb),
    'button label present');
  // Button only shown to admins OR to the user themselves
  assert(/\(isAdmin \|\| u\.id === currentUserId\)/.test(pb),
    'quick-create button is admin-gated / self-assign-only');
});

test('S22.57 Empty column shows a direct "+ Add first ticket" button', function() {
  // Previously the empty state pointed to a button below ("create one below ↓")
  // but users missed it. Now the empty drop zone has the button right inside.
  var pb = fs.readFileSync(path.join(REPO, 'src/components/PriorityBoard.jsx'), 'utf8');
  assert(/has no tickets/.test(pb),
    'zero-ticket state still explains the situation');
  assert(/\+ Add first ticket/.test(pb),
    'direct + Add first ticket button inside the empty drop zone');
  assert(/Only [\s\S]{1,40}or an admin can create tickets/.test(pb),
    'non-admins who are not the target user get a clear explanation');
});

test('S22.58 Quick-create form: Enter submits, Escape cancels', function() {
  var pb = fs.readFileSync(path.join(REPO, 'src/components/PriorityBoard.jsx'), 'utf8');
  assert(/if \(e\.key === 'Enter' && !e\.shiftKey\) \{ e\.preventDefault\(\); saveQuickTicket\(\); \}/.test(pb),
    'Enter key submits');
  assert(/if \(e\.key === 'Escape'\) \{ setQuickCreateFor\(null\); \}/.test(pb),
    'Escape key cancels');
});

test('S22.37 Breakdown replaced with single unified table + dimension switcher', function() {
  var page = fs.readFileSync(path.join(REPO, 'src/app/page.jsx'), 'utf8');
  // Old: 3 side-by-side cards (the "bubble buckets"). New: one table with
  // a small pill row to switch between type/subcategory/color.
  assert(/Inventory Breakdown/.test(page), 'new unified header');
  assert(/Dimension selector — pill row BUT tight, not bubbly/.test(page),
    'dimension switcher in place');
  // The old 3-grid markup is gone
  assert(!/grid grid-cols-1 md:grid-cols-3 gap-3 mb-4/.test(page),
    'old 3-card bubble layout removed');
});

test('S22.38 Table view shows Batches + Adjustments counts for drill-down affordance', function() {
  var page = fs.readFileSync(path.join(REPO, 'src/app/page.jsx'), 'utf8');
  // Max: "each entry will have an amount and if you click on that line
  // item it will drill down." The table now surfaces inbound/adjustment
  // counts directly so users see there's something to drill into.
  assert(/batchCount = \(invInbounds \|\| \[\]\)\.filter\(ib => ib\.product_id === p\.product_id\)\.length/.test(page),
    'batch count per product row');
  assert(/adjCount = \(invAdjustments \|\| \[\]\)\.filter\(a => a\.product_id === p\.product_id\)\.length/.test(page),
    'adjustment count per product row');
  assert(/title="Click for full history/.test(page),
    'row hover hint shows drill-down is available');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
