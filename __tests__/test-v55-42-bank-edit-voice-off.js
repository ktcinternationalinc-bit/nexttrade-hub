// Test suite for v55.42 — bank-edit fix + Nadia OFF fix
// =============================================
//
// Bug 1 (bank rows lost their identity on edit):
// When a user clicked the edit pencil on a bank-side treasury row (one
// matched to an Egypt Bank statement, or a pending placeholder waiting
// for the statement), the modal's only money fields were "Cash In" and
// "Cash Out" — both showing 0 because the actual money was in bank_in /
// bank_out. The user typed the amount they expected to see, which:
//   • DOUBLED the amount (now both bank_in AND cash_in held the value)
//   • Silently converted the row from a bank row to a cash row (bank
//     identity fields were dropped from the update payload, so on the
//     next load they read as zero).
//   • Broke the link to the bank statement and the linked invoice's
//     total_collected went stale.
//
// Fix: detect bank rows, show bank fields, never write cash columns to
// bank rows or vice versa.
//
// Bug 2 (Nadia OFF button silently failed):
// The bottom-left "🎙️ Hey Nadia"/"Idle" pill has an OFF button. Clicking
// it called stop() locally, but did NOT change the parent's voiceEnabled
// state. Two things then happened:
//   • Any nadia-tts-stop event resurrected the indicator to "listening"
//     (onStop unconditionally setStatus('listening')).
//   • Nothing was persisted, so a refresh brought voice right back.
// Net effect: the OFF button looked like it did nothing.
//
// Fix: OFF now flips voiceEnabled→false in the parent AND persists to
// users.voice_enabled. onStop checks userStoppedRef + enabled before
// resurrecting status.

import fs from 'fs';
import path from 'path';

var REPO = path.resolve(new URL('.', import.meta.url).pathname, '..');

var passed = 0, failed = 0;
var errors = [];
function assert(cond, label) {
  if (cond) { passed++; }
  else { failed++; errors.push(label); console.log('  \u2717 ' + label); }
}
function read(rel) { return fs.readFileSync(path.join(REPO, rel), 'utf8'); }
function exists(rel) { return fs.existsSync(path.join(REPO, rel)); }

console.log('\n========================================');
console.log('v55.42 BANK-EDIT + VOICE-OFF TEST SUITE');
console.log('========================================\n');

var page = read('src/app/page.jsx');

// ----------------------------------------------------------------------
// BUG 1 — handleEditTreasury detects + preserves bank rows
// ----------------------------------------------------------------------
console.log('handleEditTreasury — bank-row detection + preservation');

assert(/v55\.42 — Detect row type/.test(page),
  'B.1 — handleEditTreasury has the v55.42 doc block');
// Detection variables present
assert(/var hasBankIn\s*=\s*Number\(txn\.bank_in/.test(page),
  'B.2 — detects hasBankIn');
assert(/var hasBankOut\s*=\s*Number\(txn\.bank_out/.test(page),
  'B.3 — detects hasBankOut');
assert(/var isPlaceholder\s*=\s*!!txn\.is_bank_placeholder/.test(page),
  'B.4 — detects placeholder rows');
assert(/var isBankRow\s*=\s*hasBankIn \|\| hasBankOut \|\| isPlaceholder/.test(page),
  'B.5 — combines into isBankRow');

// Reads the right inputs
assert(/document\.getElementById\('tx-bank-in'\)/.test(page),
  'B.6 — reads tx-bank-in input for bank rows');
assert(/document\.getElementById\('tx-bank-out'\)/.test(page),
  'B.7 — reads tx-bank-out input for bank rows');
// Cash inputs are NULL'd for bank rows so they don't bleed into updates
assert(/cashIn:\s*isBankRow \? null/.test(page),
  'B.8 — cashIn is null for bank rows (prevents cross-contamination)');
assert(/cashOut:\s*isBankRow \? null/.test(page),
  'B.9 — cashOut is null for bank rows');

// Bank rows write bank columns; placeholder rows write expected_amount
assert(/updates\.bank_in\s*=\s*fd\.bankIn/.test(page),
  'B.10 — writes bank_in for confirmed bank rows');
assert(/updates\.expected_amount\s*=\s*inAmt/.test(page) ||
       /updates\.expected_amount\s*=\s*outAmt/.test(page) ||
       /updates\.expected_amount\s*=\s*Number\(txn\.expected_amount\)/.test(page),
  'B.11 — writes expected_amount for placeholder rows');

// Identity fields are NEVER in the updates payload (immutability of identity)
// We check this by scanning the function body and asserting nothing sets
// is_bank_placeholder, bank_account_id, or matched_bank_txn_id.
var fnStart = page.indexOf('const handleEditTreasury');
var fnEnd = page.indexOf('// ── Treasury ↔ Invoice Linking', fnStart);
var fnBody = page.slice(fnStart, fnEnd);
assert(!/updates\.is_bank_placeholder\s*=/.test(fnBody),
  'B.12 — never writes is_bank_placeholder (preserves bank-row identity)');
assert(!/updates\.bank_account_id\s*=/.test(fnBody),
  'B.13 — never writes bank_account_id (preserves bank link)');
assert(!/updates\.matched_bank_txn_id\s*=/.test(fnBody),
  'B.14 — never writes matched_bank_txn_id (preserves bank-statement match)');

// expected_amount is included in the amountsChanged check (so recalc fires)
assert(/Number\(updates\.expected_amount/.test(fnBody),
  'B.15 — amountsChanged check covers expected_amount changes');

// ----------------------------------------------------------------------
// BUG 1 — Edit modal shows bank fields when row is a bank row
// ----------------------------------------------------------------------
console.log('\nEdit modal — bank-aware UI');

assert(/Bank Transaction \(matched bank statement\)/.test(page),
  'M.1 — modal labels confirmed bank rows clearly');
assert(/Bank Transaction \(placeholder/.test(page),
  'M.2 — modal labels placeholder rows clearly');
assert(/Bank In \/ وارد بنكي/.test(page),
  'M.3 — modal renders Bank In input for bank rows');
assert(/Bank Out \/ صادر بنكي/.test(page),
  'M.4 — modal renders Bank Out input for bank rows');
// The handleSaveTreasuryEdit payload built in the modal must include
// bank fields when the row is a bank row, NOT cash fields.
assert(/payload\.bank_in\s*=\s*Number\(txn\.bank_in\)/.test(page),
  'M.5 — modal save payload writes bank_in for confirmed bank rows');
assert(/payload\.expected_amount\s*=\s*Number\(txn\.expected_amount\)/.test(page),
  'M.6 — modal save payload writes expected_amount for placeholders');

// ----------------------------------------------------------------------
// BUG 1 — Inline edit row is bank-aware too
// ----------------------------------------------------------------------
console.log('\nInline edit row — bank-aware fields');

assert(/Inline edit row is bank-aware/.test(page),
  'I.1 — inline edit row has v55.42 doc block');
assert(/id="tx-bank-in"/.test(page),
  'I.2 — inline edit row has tx-bank-in input id');
assert(/id="tx-bank-out"/.test(page),
  'I.3 — inline edit row has tx-bank-out input id');

// ----------------------------------------------------------------------
// BUG 1 — handleSaveTreasuryEdit recalcs invoice on bank changes too
// ----------------------------------------------------------------------
console.log('\nhandleSaveTreasuryEdit — recalc fires for bank field changes too');

var saveFnIdx = page.indexOf('const handleSaveTreasuryEdit');
var saveFnBody = page.slice(saveFnIdx, saveFnIdx + 8000);
assert(/v55\.42/.test(saveFnBody),
  'S.1 — handleSaveTreasuryEdit has the v55.42 update');
assert(/moneyFields = \['cash_in', 'cash_out', 'bank_in', 'bank_out', 'expected_amount'\]/.test(saveFnBody),
  'S.2 — recalc fires on changes to ANY money-bearing field including bank/expected');
// v55.82-B — variable names changed from `original.linked_invoice_id` to
// `oldLinkedInvoiceId` / `newLinkedInvoiceId` (same semantics, supports
// the new auto-relink-on-order#-change feature). Either pattern is fine.
assert(/recalcInvoiceCollected\((original\.linked_invoice_id|oldLinkedInvoiceId|newLinkedInvoiceId)\)/.test(saveFnBody),
  'S.3 — recalcs the linked invoice when amounts change');

// ----------------------------------------------------------------------
// BUG 2 — VoiceController OFF button actually turns voice off
// ----------------------------------------------------------------------
console.log('\nVoiceController — OFF button now actually turns voice off');
var vc = read('src/components/VoiceController.jsx');

// New onTurnOff prop accepted
assert(/function VoiceController\(\{ userId, userProfile, enabled, onCommand, onTurnOff \}\)/.test(vc),
  'V.1 — VoiceController accepts an onTurnOff prop');
// OFF button calls stop() AND onTurnOff()
assert(/stop\(\);\s*if \(typeof onTurnOff === 'function'\)/.test(vc),
  'V.2 — OFF button calls stop() and then onTurnOff() if provided');
// onTurnOff is called with try/catch so a parent error doesn't break the UI
assert(/try \{ onTurnOff\(\); \} catch/.test(vc),
  'V.3 — onTurnOff is called inside a try/catch (defensive)');

// ----------------------------------------------------------------------
// BUG 2 — onStop no longer resurrects status when user stopped/disabled
// ----------------------------------------------------------------------
console.log('\nVoiceController — onStop respects userStoppedRef and enabled');

var onStopIdx = vc.indexOf('var onStop');
assert(onStopIdx > 0, 'V.4 — onStop handler is locatable');
var onStopBody = vc.slice(onStopIdx, onStopIdx + 2000);
assert(/if \(userStoppedRef\.current\) return;/.test(onStopBody),
  'V.5 — onStop returns early when user explicitly stopped');
assert(/if \(!enabled\) return;/.test(onStopBody),
  'V.6 — onStop returns early when voice is disabled');
// And the resurrection setStatus('listening') is now after the guards
var listenIdx = onStopBody.indexOf("setStatus('listening')");
var enabledGuardIdx = onStopBody.indexOf('if (!enabled) return;');
assert(listenIdx > enabledGuardIdx && enabledGuardIdx > 0,
  'V.7 — setStatus("listening") only fires AFTER the userStopped + enabled guards');

// ----------------------------------------------------------------------
// BUG 2 — page.jsx wires onTurnOff to flip + persist voiceEnabled
// (HISTORICAL — VoiceController was removed entirely in v55.43, so these
//  assertions now verify either the v55.42 wiring OR that VoiceController
//  is gone altogether. Both states are acceptable; both prevent the
//  "OFF button doesn't work" bug.)
// ----------------------------------------------------------------------
console.log('\npage.jsx — onTurnOff wired up + persistence (or VoiceController fully removed in v55.43+)');

// Either the VoiceController is mounted with onTurnOff, OR it's been
// removed entirely (which is the v55.43+ state).
var hasVoiceController = /<VoiceController/.test(page);
var voiceRemoved = !hasVoiceController && /VOICE DISABLED/.test(page);
assert(!hasVoiceController || /<VoiceController[\s\S]{0,800}onTurnOff=\{/.test(page),
  'P.1 — page.jsx either passes onTurnOff to VoiceController OR VoiceController is unmounted (v55.43+)');
assert(!hasVoiceController || /onTurnOff=\{[\s\S]{0,400}setVoiceEnabled\(false\)/.test(page),
  'P.2 — when VoiceController is mounted, onTurnOff handler sets voiceEnabled to false');
assert(voiceRemoved || /from\('users'\)\.update\(\{ voice_enabled: false \}\)/.test(page),
  'P.3 — when VoiceController is mounted, onTurnOff persists voice_enabled=false (or VoiceController is removed)');

// ----------------------------------------------------------------------
// REGRESSION GUARD — earlier fixes still in place
// ----------------------------------------------------------------------
console.log('\nRegression guard — previous fixes intact');
assert(/findPotentialDuplicates/.test(page),
  'G.1 — v55.41 duplicate-confirm helper still present');
assert(/AUTO-REGISTER/.test(read('src/components/PhoneWidget.jsx')),
  'G.2 — v55.40 phone auto-register still in place');
assert(/dialCallStatus === 'no-answer'/.test(read('src/app/api/phone/voicemail-record/route.js')),
  'G.3 — v55.39 voicemail dial-failed branch still in place');
assert(/const \[time, setTime\] = useState\(null\)/.test(read('src/app/login/page.jsx')),
  'G.4 — v55.38 login hydration fix still in place');
assert(exists('src/components/WhatsAppInbox.jsx'),
  'G.5 — v55.37 WhatsApp inbox still present');

// Make sure unrelated treasury flows haven't been broken by the edit changes
assert(/handleAddTreasury/.test(page),
  'G.6 — handleAddTreasury still present (transaction creation path)');
assert(/handleSplitTreasury/.test(page),
  'G.7 — handleSplitTreasury still present (split flow)');
assert(/recalcInvoiceCollected/.test(page),
  'G.8 — recalcInvoiceCollected still present (invoice math)');

// ----------------------------------------------------------------------
// VERSION STAMPS
// ----------------------------------------------------------------------
console.log('\nVersion stamps — bumped to v55.42');
function vNum(s) { var m = s.match(/v55\.(\d+)/); return m ? parseInt(m[1], 10) : 0; }
var headerMatch = page.match(/>v55\.\d+</);
var modalMatch = page.match(/BUILD v55\.\d+-/);
assert(headerMatch && vNum(headerMatch[0]) >= 42,
  'X.1 — header pill shows v55.42 or later');
assert(modalMatch && vNum(modalMatch[0]) >= 42,
  'X.2 — build modal shows v55.42-* or later');
assert(/BUILD v55\.42-BANK-EDIT-AND-VOICE-OFF/.test(page) || vNum(modalMatch[0]) > 42,
  'X.3 — build modal label is BUILD v55.42-BANK-EDIT-AND-VOICE-OFF or has been bumped past v55.42');
assert(!/>v55\.41</.test(page),
  'X.4 — no v55.41 header pill remains');

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
console.log('\u2713 All v55.42 assertions present.\n');
