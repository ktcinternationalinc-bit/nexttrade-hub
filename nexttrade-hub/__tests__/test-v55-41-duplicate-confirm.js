// Test suite for v55.41 — duplicate-confirm warning flow
// =============================================
// The bug: when a user tried to add a treasury transaction that looked
// identical to an existing one (same date, same amount, same description),
// the save was silently blocked — there was no clear path forward and
// legitimate same-day same-amount repeats (e.g. weekly cash payments,
// identical fuel purchases) couldn't be entered at all.
//
// The fix: instead of blocking, show a warning modal listing the existing
// match(es) and ask the user to either:
//   • Cancel — they'll edit the row to make it distinct
//   • Confirm — it's a real separate payment that happens to look
//     identical. The save proceeds and the new row gets stamped with
//     confirmed_not_duplicate=true so the AI auditor doesn't flag it
//     later.
//
// This works for BOTH:
//   • JS-side preflight (always runs — uses local treasury state to spot
//     the duplicate before sending the insert at all)
//   • DB-side unique-constraint catch (catches Postgres 23505 errors and
//     re-routes them to the same modal — safe even if the local state
//     is stale and the preflight missed the match)

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
console.log('v55.41 DUPLICATE-CONFIRM TEST SUITE');
console.log('========================================\n');

var page = read('src/app/page.jsx');

// ----------------------------------------------------------------------
// FINDPOTENTIAL DUPLICATES — helper logic in place
// ----------------------------------------------------------------------
console.log('findPotentialDuplicates helper — in place and well-shaped');

assert(/const findPotentialDuplicates = /.test(page),
  'D.1 — findPotentialDuplicates helper is defined');
assert(/findPotentialDuplicates\s*=\s*\(txDate, amount, descRaw, isIncome, isBankPlaceholder\)/.test(page),
  'D.2 — helper takes (txDate, amount, descRaw, isIncome, isBankPlaceholder)');
// Empty-description guard: never block when there's no signal to dedup on
assert(/if \(!desc\) return \[\]/.test(page),
  'D.3 — empty description short-circuits to [] (no false positives)');
// Date match by truncated string
assert(/transaction_date \|\| ''\)\.substring\(0, 10\)/.test(page),
  'D.4 — date comparison uses substring(0,10) — handles ISO timestamps');
// Direction matching
assert(/var tAmt = isIncome \? tIn : tOut/.test(page),
  'D.5 — amount comparison respects direction (in vs out)');
// Tolerance
assert(/Math\.abs\(tAmt - amt\) > 1/.test(page),
  'D.6 — 1 EGP tolerance for FX rounding');
// Description match — case-insensitive, ignores bank-confirmation suffix
assert(/replace\(' \[awaiting bank confirmation\]'/.test(page),
  'D.7 — strips "[awaiting bank confirmation]" before comparing');
assert(/\\s\*\\\[bank confirmation/.test(page),
  'D.8 — strips "[bank confirmation ...]" tags before comparing');
// Cap at 5 matches
assert(/return matches\.slice\(0, 5\)/.test(page),
  'D.9 — caps results at 5 (UI sanity)');

// ----------------------------------------------------------------------
// HANDLE_ADD_TREASURY — preflight + bypassDupCheck param
// ----------------------------------------------------------------------
console.log('\nhandleAddTreasury — preflight + bypass param wired');

assert(/const handleAddTreasury = async \(opts\) =>/.test(page),
  'H.1 — handleAddTreasury accepts an opts argument');
assert(/opts = opts \|\| \{\}/.test(page),
  'H.2 — opts defaults to {} (back-compat with existing call sites)');
assert(/if \(!opts\.bypassDupCheck\) \{[\s\S]{0,300}findPotentialDuplicates/.test(page),
  'H.3 — preflight runs unless bypassDupCheck is true');
assert(/setDuplicateConfirm\(\{[\s\S]{0,400}matches: dupMatches/.test(page),
  'H.4 — opens duplicateConfirm modal with the matches when found');
assert(/return;\s*\}\s*\}\s*let cat/.test(page) ||
       /\/\/ Don't insert\. The modal calls handleAddTreasury\(\{bypassDupCheck:true\}\)/.test(page),
  'H.5 — preflight returns early when matches found (insert deferred)');

// ----------------------------------------------------------------------
// HANDLE_ADD_TREASURY — unique-constraint catch routes to modal
// ----------------------------------------------------------------------
console.log('\nhandleAddTreasury — Postgres 23505 catch → same modal flow');

assert(/pgcode === '23505'/.test(page),
  'H.6 — checks Postgres error code 23505 (unique_violation)');
assert(/duplicate key value/i.test(page),
  'H.7 — also matches by error message text (defensive)');
assert(/unique constraint/i.test(page),
  'H.8 — also matches "unique constraint" in error message');
assert(/if \(isUniqueViolation && !opts\.bypassDupCheck\)/.test(page),
  'H.9 — unique-violation handler does NOT loop when retry already bypassed');
assert(/fromDbError: true/.test(page),
  'H.10 — DB-side catch tags the modal data so UI can mention it');

// ----------------------------------------------------------------------
// CONFIRMED_NOT_DUPLICATE STAMP
// ----------------------------------------------------------------------
console.log('\nrecord.confirmed_not_duplicate stamp on bypass');

assert(/if \(opts\.bypassDupCheck\) \{[\s\S]{0,150}record\.confirmed_not_duplicate = true/.test(page),
  'S.1 — when bypassed, the inserted record gets confirmed_not_duplicate=true');

// ----------------------------------------------------------------------
// MODAL — render + buttons
// ----------------------------------------------------------------------
console.log('\nDuplicate-confirm modal — rendered with both action paths');

assert(/const \[duplicateConfirm, setDuplicateConfirm\] = useState\(null\)/.test(page),
  'M.1 — duplicateConfirm state declared');
assert(/\{duplicateConfirm && \(/.test(page),
  'M.2 — modal renders when duplicateConfirm is set');
assert(/Possible Duplicate Transaction/.test(page),
  'M.3 — modal has the bilingual heading');
assert(/معاملة قد تكون مكررة/.test(page),
  'M.4 — modal has the Arabic heading');
assert(/setDuplicateConfirm\(null\)/.test(page),
  'M.5 — Cancel button clears state without saving');
assert(/await handleAddTreasury\(\{ bypassDupCheck: true \}\)/.test(page),
  'M.6 — Confirm button re-calls save with bypassDupCheck=true');

// Modal must list the matching rows clearly
assert(/duplicateConfirm\.matches\.map/.test(page),
  'M.7 — modal lists each matching row');
// Modal must work even if the matches list is empty (DB-error path with stale state)
assert(/duplicateConfirm\.matches\.length === 0/.test(page),
  'M.8 — modal handles the empty-matches case gracefully (DB error fallback)');

// ----------------------------------------------------------------------
// AUDITOR — skips user-confirmed rows
// ----------------------------------------------------------------------
console.log('\nAI accounting auditor — respects the confirmed_not_duplicate flag');
var auditor = read('src/lib/accounting-auditor.js');

assert(/tr2\.confirmed_not_duplicate === true/.test(auditor),
  'A.1 — auditor skips rows where confirmed_not_duplicate is true');
assert(/dupeKey\[key\]\.confirmed_not_duplicate === true/.test(auditor),
  'A.2 — auditor also skips when the EXISTING row was user-confirmed (transitivity)');

// ----------------------------------------------------------------------
// SQL MIGRATION
// ----------------------------------------------------------------------
console.log('\nSQL migration s38 — confirmed_not_duplicate column');

assert(exists('sql/s38_treasury_confirmed_not_duplicate.sql'),
  'Q.1 — sql/s38_treasury_confirmed_not_duplicate.sql exists');
var sql = read('sql/s38_treasury_confirmed_not_duplicate.sql');
assert(/ALTER TABLE treasury\s+ADD COLUMN IF NOT EXISTS confirmed_not_duplicate BOOLEAN/i.test(sql),
  'Q.2 — migration adds the BOOLEAN column idempotently');
assert(/DEFAULT FALSE/.test(sql),
  'Q.3 — column defaults to FALSE so existing rows are unaffected');
assert(/COMMENT ON COLUMN treasury\.confirmed_not_duplicate/.test(sql),
  'Q.4 — column has a doc comment for future schema readers');

// ----------------------------------------------------------------------
// REGRESSION GUARD — earlier fixes still in place
// ----------------------------------------------------------------------
console.log('\nRegression guard — v55.40 + v55.39 + v55.38 features intact');
assert(/AUTO-REGISTER/.test(read('src/components/PhoneWidget.jsx')),
  'G.1 — v55.40 phone auto-register still in place');
assert(/const \[unreadVoicemails/.test(page),
  'G.2 — v55.40 voicemail badge still in place');
var vm = read('src/app/api/phone/voicemail-record/route.js');
assert(/dialCallStatus === 'no-answer'/.test(vm),
  'G.3 — v55.39 dial-failed → record-voicemail branch still in place');
assert(/const \[time, setTime\] = useState\(null\)/.test(read('src/app/login/page.jsx')),
  'G.4 — v55.38 login hydration fix still in place');
assert(exists('src/components/WhatsAppInbox.jsx'),
  'G.5 — v55.37 WhatsApp inbox still present');

// ----------------------------------------------------------------------
// VERSION STAMPS
// ----------------------------------------------------------------------
console.log('\nVersion stamps — bumped to v55.41');
function vNum(s) { var m = s.match(/v55\.(\d+)/); return m ? parseInt(m[1], 10) : 0; }
var headerMatch = page.match(/>v55\.\d+(?:-[A-Z][0-9]*(?:\.\d+)*)?</);
var modalMatch = page.match(/BUILD v55\.\d+-/);
assert(headerMatch && vNum(headerMatch[0]) >= 41,
  'V.1 — header pill shows v55.41 or later');
assert(modalMatch && vNum(modalMatch[0]) >= 41,
  'V.2 — build modal shows v55.41-* or later');
// V.3 was a strict equality on the build label — relaxed so future
// version bumps don't fail it. The label-shape (BUILD v55.NN-...) is
// already enforced by V.2 above.
assert(/BUILD v55\.41-DUPLICATE-CONFIRM/.test(page) || vNum(modalMatch[0]) > 41,
  'V.3 — build modal label is BUILD v55.41-DUPLICATE-CONFIRM or has been bumped past v55.41');
assert(!/>v55\.40</.test(page),
  'V.4 — no v55.40 header pill remains');

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
console.log('\u2713 All v55.41 duplicate-confirm assertions present.\n');
