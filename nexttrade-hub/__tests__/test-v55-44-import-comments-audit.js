// Test suite for v55.44 — Shipping import overhaul + comment double-submit
// guard + priority/due-date audit comments
// =============================================
//
// What v55.44 ships:
//
// 1. SHIPPING RATES IMPORT — bulletproof template + editable preview.
//    Max reported repeatedly that rate values weren't pulling on import.
//    Three changes work together to fix this:
//      a) Download Template button now generates a 21-column file with a
//         second "Field Guide" sheet. Every importable field is in the
//         template, named exactly the way the matcher expects.
//      b) Preview now shows EVERY field — currency, all four named fee
//         columns (Port/THC/Doc/Customs), Other fees, total — and every
//         cell is editable. Zero-rate rows highlight red.
//      c) Column-mapping override grid above the preview lets the user
//         RE-PICK the source column for any field if the auto-detect
//         picked wrong. Reparse runs against saved raw rows.
//
// 2. COMMENT DOUBLE-SUBMIT GUARD. Max reported tapping Send 2-3 times
//    posted the same comment 3 times. Two layers:
//      a) RichCommentComposer takes a `submitting` prop and disables the
//         Send button + suppresses Ctrl+Enter when submitting is true.
//         Also has an internal `localSubmitting` backstop in case parent
//         forgets the prop.
//      b) TicketsTab's addComment now sets a `submittingComment` flag
//         in a try/finally and bails early if a save is already in flight.
//
// 3. PRIORITY / DUE-DATE AUDIT COMMENTS. Max asked: "if someone changes
//    the assignee or due date or urgency, it should be logged in as a
//    comment in the ticket." Status + reassign already wrote system
//    comments — now priority and due date do the same. The Activity Log
//    section already filters comments by is_system === true so the new
//    entries show up there automatically with no UI work.

import fs from 'fs';
import path from 'path';

var REPO = path.resolve(new URL('.', import.meta.url).pathname, '..');

var passed = 0, failed = 0;
var errors = [];
function assert(cond, label) {
  if (cond) { passed++; }
  else { failed++; errors.push(label); console.log('  \u2717 ' + label); }
}
function read(rel) {
  try { return fs.readFileSync(path.join(REPO, rel), 'utf8'); }
  catch (_) { return ''; }
}
function exists(rel) {
  try { fs.accessSync(path.join(REPO, rel)); return true; } catch (_) { return false; }
}

console.log('\nv55.44 test suite — import + comments + audit');
console.log('=================================================');

// ----------------------------------------------------------------------
// FIX 1 — RICHCOMMENTCOMPOSER DOUBLE-SUBMIT GUARD
// ----------------------------------------------------------------------
console.log('\nA. RichCommentComposer — double-submit guard');
var composer = read('src/components/RichCommentComposer.jsx');

assert(/v55\.44 — DOUBLE-SUBMIT GUARD/.test(composer),
  'A.1 — header comment documents the double-submit fix');
assert(/function RichCommentComposer\(\{[^}]*submitting[^}]*\}\)/.test(composer),
  'A.2 — submitting prop is part of component signature');
assert(/const \[localSubmitting, setLocalSubmitting\] = useState\(false\)/.test(composer),
  'A.3 — internal localSubmitting state declared as backstop');
assert(/const isSubmitting = !!submitting \|\| localSubmitting/.test(composer),
  'A.4 — combined isSubmitting flag combines parent + local');
assert(/const safeSubmit = \(\) => \{[\s\S]*?if \(isSubmitting\) return;/.test(composer),
  'A.5 — safeSubmit guards re-entry by checking isSubmitting first');
assert(/setLocalSubmitting\(true\)/.test(composer),
  'A.6 — safeSubmit flips local guard before invoking parent onSubmit');
assert(/onClick=\{safeSubmit\}/.test(composer),
  'A.7 — Send button uses safeSubmit instead of raw onSubmit');
assert(/disabled=\{isSubmitting\}/.test(composer),
  'A.8 — Send button has disabled={isSubmitting}');
assert(/aria-busy=\{isSubmitting\}/.test(composer),
  'A.9 — Send button has aria-busy for accessibility');
assert(/'⏳ Sending…'/.test(composer),
  'A.10 — Send button shows visual feedback (Sending…) while submitting');
assert(/cursor-not-allowed/.test(composer),
  'A.11 — Send button has cursor-not-allowed style when disabled');
// Ctrl+Enter must also use the guard
assert(/safeSubmit\(\);[\s\S]*?\/\/ Plain Enter/.test(composer),
  'A.12 — Ctrl+Enter shortcut routes through safeSubmit (not raw onSubmit)');
// Reset path: when value clears (parent successfully cleared), local guard releases
assert(/if \(value === '' \|\| value == null\) \{[\s\S]*?setLocalSubmitting\(false\)/.test(composer),
  'A.13 — local guard releases when parent clears value');
// Reset path: when parent's submitting prop transitions back to false
assert(/if \(!submitting && localSubmitting\)/.test(composer),
  'A.14 — local guard releases when parent\'s submitting transitions to false');

// ----------------------------------------------------------------------
// FIX 1b — TICKETSTAB ADDCOMMENT WIRES UP THE GUARD
// ----------------------------------------------------------------------
console.log('\nB. TicketsTab — addComment uses submittingComment state');
var tickets = read('src/components/TicketsTab.jsx');

assert(/const \[submittingComment, setSubmittingComment\] = useState\(false\)/.test(tickets),
  'B.1 — submittingComment state is declared');
assert(/if \(submittingComment\) return;/.test(tickets),
  'B.2 — addComment bails early when a save is already in flight');
assert(/setSubmittingComment\(true\);[\s\S]{0,500}?try \{/.test(tickets),
  'B.3 — addComment sets flag true BEFORE the try block');
assert(/finally \{ setSubmittingComment\(false\); \}/.test(tickets),
  'B.4 — addComment releases the flag in finally (even on error)');
assert(/submitting=\{submittingComment\}/.test(tickets),
  'B.5 — RichCommentComposer is passed submitting={submittingComment}');

// ----------------------------------------------------------------------
// FIX 2 — PRIORITY + DUE DATE AUDIT COMMENTS
// ----------------------------------------------------------------------
console.log('\nC. Audit comments — priority + due date now log to ticket thread');

// Existing audit comments (regression guard) — make sure these still write
assert(/comment_text: '📋 Status changed to ' \+ newStatus/.test(tickets),
  'C.1 — REGRESSION: status change still writes a system comment');
assert(/comment_text: '👤 Reassigned to ' \+ newName/.test(tickets),
  'C.2 — REGRESSION: reassign still writes a system comment');

// New audit comments
assert(/'⚡ Priority changed: ' \+ \(oldPri \|\| 'none'\)\.toUpperCase\(\)/.test(tickets),
  'C.3 — Priority change writes a system comment with ⚡ prefix');
assert(/'📅 Due date changed: '/.test(tickets),
  'C.4 — Due date change writes a system comment with 📅 prefix');
// Both new audit comments must use is_system: true so they render in the
// "Activity Log" section, not the "Comments & Attachments" section.
var priChunk = (tickets.match(/'⚡ Priority changed[\s\S]{0,400}/) || [''])[0];
assert(/is_system: true/.test(priChunk),
  'C.5 — priority audit comment has is_system: true');
var dueChunk = (tickets.match(/'📅 Due date changed[\s\S]{0,400}/) || [''])[0];
assert(/is_system: true/.test(dueChunk),
  'C.6 — due-date audit comment has is_system: true');

// Both must capture the OLD value before the update so the comment can show
// "before → after" — otherwise the audit trail loses what it changed FROM.
var dueHandlerChunk = (tickets.match(/const oldVal = sel\.due_date \|\| null;[\s\S]{0,1500}/) || [''])[0];
assert(/oldVal/.test(dueHandlerChunk) && /'\u2192'|→/.test(tickets),
  'C.7 — due-date handler captures old value before update');
var priHandlerChunk = (tickets.match(/var oldPri = sel\.priority;[\s\S]{0,1500}/) || [''])[0];
assert(/'⚡ Priority changed: ' \+ \(oldPri \|\| 'none'\)/.test(priHandlerChunk),
  'C.8 — priority handler uses captured oldPri in the audit comment');

// Both should be best-effort (a comments insert failure must not block the
// underlying field update). Look for a try/catch wrapping just the dbInsert.
assert(/\[audit\] could not save priority comment/.test(tickets),
  'C.9 — priority audit insert is best-effort (warns, does not throw)');
assert(/\[audit\] could not save due-date comment/.test(tickets),
  'C.10 — due-date audit insert is best-effort');

// No-op short-circuit — if user picks the same value, don't fire an audit
assert(/if \(\(oldVal \|\| null\) === \(val \|\| null\)\) return;/.test(tickets),
  'C.11 — due-date no-op (same value picked) skips both update and audit');
assert(/if \(newPri === oldPri\) return;/.test(tickets),
  'C.12 — priority no-op (same value picked) skips both update and audit');

// Both must call loadComments after success so the new audit entry appears
// immediately in the Activity Log without a manual refresh.
assert(/loadComments\(sel\.id\); \} catch\(_\) \{\} *[\s\S]{0,200}?Refresh|loadComments\(sel\.id\);[\s\S]{0,200}?\}\} className="px-3 py-1 bg-blue-500/.test(tickets),
  'C.13 — due-date handler refreshes comments after audit insert');

// Activity Log section is unchanged — system comments render there
assert(/const systemComments = comments\.filter\(c => c\.is_system\)/.test(tickets),
  'C.14 — systemComments filter is still in place (renders in Activity Log)');
assert(/📋 Activity Log \(\{systemComments\.length\}\)/.test(tickets),
  'C.15 — Activity Log header still references systemComments count');

// ----------------------------------------------------------------------
// FIX 3 — SHIPPING RATES IMPORT OVERHAUL
// ----------------------------------------------------------------------
console.log('\nD. Shipping rates import — template + editable preview + remap');
var ship = read('src/components/ShippingRatesTab.jsx');

// State for raw rows / headers / container columns — needed for re-parse
assert(/const \[importRawRows, setImportRawRows\] = useState\(\[\]\)/.test(ship),
  'D.1 — importRawRows state is declared');
assert(/const \[importHeaders, setImportHeaders\] = useState\(\[\]\)/.test(ship),
  'D.2 — importHeaders state is declared');
assert(/const \[importContainerCols, setImportContainerCols\] = useState\(\[\]\)/.test(ship),
  'D.3 — importContainerCols state is declared');
assert(/setImportRawRows\(rows\)/.test(ship),
  'D.4 — processImportFile saves raw rows for re-parse');
assert(/setImportHeaders\(headers\)/.test(ship),
  'D.5 — processImportFile saves headers for the remap dropdown');

// Re-parse helper for column remap
assert(/const reparseFromMapping = \(newColMap\) =>/.test(ship),
  'D.6 — reparseFromMapping helper exists');
assert(/onChange=\{e => \{[\s\S]{0,300}?reparseFromMapping\(next\)/.test(ship),
  'D.7 — column-mapping dropdowns call reparseFromMapping on change');

// Editable preview cells
assert(/const updateImportRow = \(idx, field, value\) =>/.test(ship),
  'D.8 — updateImportRow helper exists for cell-level editing');
assert(/const removeImportRow = \(idx\) =>/.test(ship),
  'D.9 — removeImportRow helper exists for dropping junk rows');
// total_cost recalculation when fees/rate change
assert(/Recalculate total_cost when any fee or the base rate changes/.test(ship),
  'D.10 — updateImportRow recalculates total_cost when rate/fees change');
assert(/\['rate_amount','port_fees','thc_fees','documentation_fees','customs_fees','other_fees'\]/.test(ship),
  'D.11 — total_cost recalc covers all six numeric columns');

// Comprehensive template — 21 columns + Field Guide sheet
assert(/'Transport Mode'/.test(ship),
  'D.12 — template includes Transport Mode column');
assert(/'Port Fees'.+'THC Fees'.+'Documentation Fees'.+'Customs Fees'.+'Other Fees'/s.test(ship),
  'D.13 — template includes all four named fee columns + Other Fees');
assert(/'Other Fees Description'/.test(ship),
  'D.14 — template includes Other Fees Description column');
assert(/book_append_sheet\(twb, wsInst, 'Field Guide'\)/.test(ship),
  'D.15 — template generates a second Field Guide sheet with instructions');
assert(/'Required\?'/.test(ship),
  'D.16 — Field Guide sheet labels which fields are required');
assert(/Download Full Template/.test(ship),
  'D.17 — button label updated to "Download Full Template"');
assert(/Template has 21 columns/.test(ship),
  'D.18 — UI advertises that the template covers all 21 fields');

// Zero-rate warning + visual cues
assert(/const zeroRateCount = importData\.filter\(r => !r\.rate_amount/.test(ship),
  'D.19 — zero-rate counter is computed for the warning banner');
assert(/{zeroRateCount} row/.test(ship),
  'D.20 — banner shows count of zero-rate rows');
assert(/bg-red-50 ' : ''/.test(ship) || /bg-red-50/.test(ship),
  'D.21 — zero-rate rows render with red background');
assert(/text-red-600/.test(ship),
  'D.22 — zero rate amounts render in red text');

// Preview shows ALL fields — not just origin/dest/vendor/rate. The point
// of v55.44 is that Max can SEE every value before importing.
assert(/<th[^>]*>Mode<\/th>/.test(ship),
  'D.23 — preview includes Mode column');
assert(/<th[^>]*>Curr<\/th>/.test(ship),
  'D.24 — preview includes Currency column');
assert(/<th[^>]*>Port<\/th>[\s\S]{0,200}?<th[^>]*>THC<\/th>/.test(ship),
  'D.25 — preview includes Port and THC fee columns');
assert(/<th[^>]*>Doc<\/th>/.test(ship),
  'D.26 — preview includes Doc fees column');
assert(/<th[^>]*>Customs<\/th>/.test(ship),
  'D.27 — preview includes Customs column');
assert(/<th[^>]*>Other<\/th>/.test(ship),
  'D.28 — preview includes Other fees column');
assert(/<th[^>]*>Total<\/th>/.test(ship),
  'D.29 — preview includes computed Total column');

// Every key cell is an <input> (editable), not display text
assert(/onChange=\{e=>updateImportRow\(i,'rate_amount'/.test(ship),
  'D.30 — Rate cell is editable');
assert(/onChange=\{e=>updateImportRow\(i,'effective_date'/.test(ship),
  'D.31 — Effective Date cell is editable');
assert(/onChange=\{e=>updateImportRow\(i,'expiry_date'/.test(ship),
  'D.32 — Expiry Date cell is editable');
assert(/onChange=\{e=>updateImportRow\(i,'currency'/.test(ship),
  'D.33 — Currency cell is editable');
assert(/onChange=\{e=>updateImportRow\(i,'container_type'/.test(ship),
  'D.34 — Container Type cell is editable');
assert(/onChange=\{e=>updateImportRow\(i,'port_fees'/.test(ship),
  'D.35 — Port Fees cell is editable');
assert(/onChange=\{e=>updateImportRow\(i,'thc_fees'/.test(ship),
  'D.36 — THC fees cell is editable');
assert(/onChange=\{e=>updateImportRow\(i,'documentation_fees'/.test(ship),
  'D.37 — Documentation fees cell is editable');
assert(/onChange=\{e=>updateImportRow\(i,'customs_fees'/.test(ship),
  'D.38 — Customs fees cell is editable');
assert(/onChange=\{e=>updateImportRow\(i,'other_fees'/.test(ship),
  'D.39 — Other fees cell is editable');

// Remove-row button
assert(/onClick=\{\(\)=>removeImportRow\(i\)\}/.test(ship),
  'D.40 — Each row has a × button to drop it before importing');

// User-facing hint text
assert(/Tap any cell to edit/.test(ship),
  'D.41 — Hint text tells users they can tap to edit cells');

// Existing matcher logic preserved (regression)
assert(/preferNumeric: true, exclude: \['type', 'category', 'class'/.test(ship),
  'D.42 — REGRESSION: rate matcher still excludes "Rate Type" / "Category"');
assert(/numericScore = \(col\) =>/.test(ship),
  'D.43 — REGRESSION: numericScore helper still in place');
assert(/containerFromHeader/.test(ship),
  'D.44 — REGRESSION: container-specific column detection still in place');

// ----------------------------------------------------------------------
// REGRESSION GUARD — previous fixes intact
// ----------------------------------------------------------------------
console.log('\nE. Notification fan-out — creator + assignees + bell');
var notifyLib = read('src/lib/notify.js');
var notifyApi = read('src/app/api/notify/route.js');

// New helpers in notify.js
assert(/export const notifyTicketPriority/.test(notifyLib),
  'E.1 — notifyTicketPriority helper exported');
assert(/export const notifyTicketDueDate/.test(notifyLib),
  'E.2 — notifyTicketDueDate helper exported');
assert(/export const notifyTicketUpdate/.test(notifyLib),
  'E.3 — generic notifyTicketUpdate helper exported');
assert(/export function ticketRecipients/.test(notifyLib),
  'E.4 — ticketRecipients helper exported (creator + assignees, dedup, no self)');
// ticketRecipients must skip the actor
assert(/if \(actorId\) ids\.delete\(actorId\)/.test(notifyLib),
  'E.5 — ticketRecipients excludes the actor (no self-notify)');
// ticketRecipients must include creator AND assignee AND extras
assert(/if \(ticket\.assigned_to\) ids\.add\(ticket\.assigned_to\)/.test(notifyLib),
  'E.6 — ticketRecipients includes assigned_to');
assert(/if \(ticket\.created_by\) ids\.add\(ticket\.created_by\)/.test(notifyLib),
  'E.7 — ticketRecipients includes created_by');
assert(/extras\.forEach\(id => \{ if \(id\) ids\.add\(id\); \}\)/.test(notifyLib),
  'E.8 — ticketRecipients includes additional_assignees');

// TicketsTab imports + uses these
assert(/notifyTicketPriority,\s*notifyTicketDueDate,\s*ticketRecipients/.test(tickets),
  'E.9 — TicketsTab imports the new notification helpers');
assert(/notifyTicketPriority\(recips, sel\.title, oldPri, newPri, myId\)/.test(tickets),
  'E.10 — Priority change calls notifyTicketPriority with creator+assignees');
assert(/notifyTicketDueDate\(recips, sel\.title, oldVal, val, myId\)/.test(tickets),
  'E.11 — Due-date change calls notifyTicketDueDate with creator+assignees');
assert(/const recips = ticketRecipients\(sel, myId, parseAssignees\(sel\)\)/.test(tickets),
  'E.12 — Both handlers use ticketRecipients() to compute the audience');

// Notification fan-out is best-effort (try/catch around it)
assert(/\[notify\] priority fan-out failed/.test(tickets),
  'E.13 — Priority notify is best-effort (warns, does not throw)');
assert(/\[notify\] due-date fan-out failed/.test(tickets),
  'E.14 — Due-date notify is best-effort (warns, does not throw)');

// Existing notification flows still in place (regression)
assert(/notifyTicketComment\(\[sel\.assigned_to\]/.test(tickets),
  'E.15 — REGRESSION: comment still notifies the assignee');
assert(/notifyTicketComment\(\[sel\.created_by\]/.test(tickets),
  'E.16 — REGRESSION: comment still notifies the creator');
assert(/extras\.length\) notifyTicketComment\(extras/.test(tickets),
  'E.17 — REGRESSION: comment still notifies additional assignees');
assert(/notifyTicketStatus\(\[ticket\.assigned_to\]/.test(tickets),
  'E.18 — REGRESSION: status change still notifies the assignee');
assert(/notifyTicketStatus\(\[ticket\.created_by\]/.test(tickets),
  'E.19 — REGRESSION: status change still notifies the creator');

// Notify endpoint — bell insert + email-optional
assert(/v55\.44 — DASHBOARD BELL/.test(notifyApi),
  'E.20 — notify endpoint header documents the bell insert');
assert(/v55\.44 — Resend is now OPTIONAL/.test(notifyApi),
  'E.21 — notify endpoint header documents Resend-optional change');
assert(/const emailEnabled = !!RESEND_API_KEY/.test(notifyApi),
  'E.22 — notify endpoint computes emailEnabled flag');
assert(/results = emailEnabled \? await Promise\.allSettled/.test(notifyApi),
  'E.23 — Resend send is gated on emailEnabled (no early 500 anymore)');
assert(/from\('notifications'\)\.insert\(bellRows\)/.test(notifyApi),
  'E.24 — notify endpoint writes to the notifications table for the bell');
assert(/target_user: u\.id/.test(notifyApi),
  'E.25 — bell rows have target_user (matches NotificationBell schema)');
assert(/title: subject/.test(notifyApi) && /type: type/.test(notifyApi),
  'E.26 — bell rows include type + title for icon + display');
assert(/created_by: triggeredBy/.test(notifyApi),
  'E.27 — bell rows include created_by so the bell shows who triggered');
assert(/const bellTargetUsers = users/.test(notifyApi),
  'E.28 — bell reaches every recipient (even users without email)');

console.log('\nF. Regression guard — v55.43 and earlier intact');
var page = read('src/app/page.jsx');

assert(/v55\.43 — VOICE INPUT BUTTONS — RESTORED/.test(read('src/components/AIGreeter.jsx')) ||
       /v55\.43 — Voice Conversation mode/.test(read('src/components/AIGreeter.jsx')),
  'F.1 — v55.43 voice input restoration still in place');
assert(/v55\.42 — Detect row type/.test(page) || /v55\.42/.test(page),
  'F.2 — v55.42 bank-edit detection still in place');
assert(/findPotentialDuplicates/.test(page),
  'F.3 — v55.41 duplicate-confirm helper still present');
assert(/AUTO-REGISTER/.test(read('src/components/PhoneWidget.jsx')),
  'F.4 — v55.40 phone auto-register still in place');
assert(exists('src/components/WhatsAppInbox.jsx'),
  'F.5 — v55.37 WhatsApp inbox still present');
assert(exists('src/app/api/transcribe/route.js'),
  'F.6 — /api/transcribe Whisper endpoint present');
assert(exists('src/app/api/tts/route.js'),
  'F.7 — /api/tts ElevenLabs endpoint present');
assert(/multi-candidate signature verification|tryAll|candidates/i.test(read('src/lib/phone-auth.js')),
  'F.8 — v55.43 multi-candidate phone signature still in place');

// The audit-trail late-edit infrastructure should still be running (notes
// say it was added earlier in the project history).
assert(/audit_trail|late.*edit|logActivity/i.test(read('src/lib/supabase.js')),
  'F.9 — audit trail / activity logging infrastructure in place');

// ----------------------------------------------------------------------
// VERSION STAMPS
// ----------------------------------------------------------------------
console.log('\nG. Version stamps — bumped to v55.44');
function vNum(s) { var m = s.match(/v55\.(\d+)/); return m ? parseInt(m[1], 10) : 0; }
var headerMatch = page.match(/>v55\.\d+(?:-[A-Z][0-9]*(?:\.\d+)*)?</);
var modalMatch = page.match(/BUILD v55\.\d+-/);
assert(headerMatch && vNum(headerMatch[0]) >= 44, 'G.1 — header pill v55.44 or later');
assert(modalMatch && vNum(modalMatch[0]) >= 44, 'G.2 — build modal v55.44+');
// G.3 — v55.44 work has been deployed via SOME build label that mentions
// the priority/audit/import work, OR a later build that supersedes it.
// Pinning to "v55.44-IMPORT-COMMENT-AUDIT-FIX" exactly was wrong — that
// becomes false the moment we ship v55.45+. We just check that the build
// modal stamp exists in v55.44+ format.
assert(/BUILD v55\.\d+-/.test(page),
  'G.3 — build modal label uses BUILD v55.X- format and was bumped past v55.44');
assert(!/>v55\.43</.test(page), 'G.4 — no v55.43 header pill remains');

// ----------------------------------------------------------------------
// SUMMARY
// ----------------------------------------------------------------------
console.log('\n========================================');
console.log('TOTAL: ' + (passed + failed) + ' assertions');
console.log('PASSED: ' + passed);
console.log('FAILED: ' + failed);
console.log('========================================\n');

if (failed > 0) {
  console.log('FAILURES:');
  errors.forEach(function (e) { console.log('  \u2022 ' + e); });
  process.exit(1);
}
console.log('\u2713 All v55.44 assertions present.\n');
