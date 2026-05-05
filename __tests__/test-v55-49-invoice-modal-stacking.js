// ============================================================
// v55.49 — Treasury invoice-modal iOS Safari stacking fixes
//
// Bug context (as of May 6 2026):
//   Max reported "for the 20th time" that creating an invoice from
//   the Treasury form shows wrong/missing error messages and the
//   final button does nothing. Trace:
//
//     1. User taps Save on a new bank-in transaction
//     2. Duplicate-confirm modal opens (z-[70]) on top of form
//        modal (z-50). Has backdrop-blur-sm.
//     3. User taps Confirm → modal closes, save proceeds
//     4. Order-not-found path triggers, pending modal opens
//     5. On iOS Safari: backdrop-blur creates a new stacking
//        context that traps z-index, so the pending modal can
//        appear INVISIBLY behind the form modal
//
//   v55.48 fixed half the problem (form modal hides when pending
//   opens). v55.49 fixes the rest: form ALSO hides when
//   duplicate-confirm opens, AND backdrop-blur is removed from
//   both modals so iOS can't trigger the stacking bug.
//
// What this test guards against (and what would FAIL the test
// if someone re-introduces the bug):
//   - duplicate-confirm modal at z-[200] (not z-[70])
//   - duplicate-confirm modal NOT using backdrop-blur-sm
//   - pending-record modal NOT using backdrop-blur-sm
//   - form Modal hidden when duplicateConfirm OR pendingTreasuryRecord set
//   - friendly error messages for duplicate / permission / network errors
// ============================================================

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var REPO = path.resolve(__dirname, '..');
var pSrc = fs.readFileSync(path.join(REPO, 'src/app/page.jsx'), 'utf8');

var passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { console.log('✓ ' + label); passed++; }
  else { console.log('✗ ' + label); failed++; }
}

console.log('============================================================');
console.log('v55.49 — Invoice modal iOS Safari stacking regression suite');
console.log('============================================================\n');

// ---------- A: Form Modal hides when child modals open ----------
console.log('A. Form Modal hides itself when child modals are open');

// Find the New Transaction modal gate — look for the literal expression
// that gates the form Modal render
check('A.1 form modal gate references both pendingTreasuryRecord AND duplicateConfirm',
  /\{showAddTreasury && !pendingTreasuryRecord && !duplicateConfirm && \(/.test(pSrc));

// ---------- B: backdrop-blur removed from both treasury-related modals ----------
console.log('\nB. backdrop-blur removed (iOS Safari stacking-context kryptonite)');

// Find duplicate-confirm modal opening div
var dupModalMatch = pSrc.match(/\{duplicateConfirm && \(\s*<div[\s\S]{0,300}?className=([^>]+)/);
check('B.1 duplicate-confirm modal exists', !!dupModalMatch);
check('B.2 duplicate-confirm modal does NOT use backdrop-blur-sm',
  dupModalMatch && !/backdrop-blur/.test(dupModalMatch[1]));

// Find pending-record modal opening div
var pendModalMatch = pSrc.match(/\{pendingTreasuryRecord && \(\s*<div[\s\S]{0,300}?className=([^>]+)/);
check('B.3 pending-record modal exists', !!pendModalMatch);
check('B.4 pending-record modal does NOT use backdrop-blur-sm',
  pendModalMatch && !/backdrop-blur/.test(pendModalMatch[1]));

// ---------- C: z-index bumped to 200 on both child modals ----------
console.log('\nC. z-index = 200 on both child modals (above form Modal\'s z-50)');

check('C.1 duplicate-confirm modal at z-[200]',
  dupModalMatch && /z-\[200\]/.test(dupModalMatch[1]));
check('C.2 pending-record modal at z-[200]',
  pendModalMatch && /z-\[200\]/.test(pendModalMatch[1]));

// ---------- D: Friendly error messages on standalone Add Invoice ----------
console.log('\nD. Friendly error wrapping on standalone Add Invoice handler');

var addInvSection = pSrc.match(/const handleAddInvoice = async[\s\S]*?\n  \};/);
check('D.0 handleAddInvoice found', !!addInvSection);
check('D.1 detects duplicate-key DB error and shows friendly message',
  addInvSection && /duplicate key\|unique constraint/i.test(addInvSection[0]));
check('D.2 detects permission/RLS errors and shows friendly message',
  addInvSection && /permission\|policy\|rls/i.test(addInvSection[0]));
check('D.3 detects network errors and shows friendly message',
  addInvSection && /network\|fetch\|failed/i.test(addInvSection[0]));
check('D.4 friendly messages are bilingual (English / Arabic)',
  addInvSection && /موجود بالفعل|تعذر حفظ/.test(addInvSection[0]));
check('D.5 shows the order # in the duplicate message (not just "duplicate detected")',
  addInvSection && /Order #' \+ orderNum \+ ' already exists/.test(addInvSection[0]));

// ---------- E: Build stamps point to v55.49 or later ----------
console.log('\nE. Build stamps current');

check('E.1 header pill bumped to v55.49 or later',
  />v55\.(49|5\d|6\d|7\d|8\d|9\d)</.test(pSrc));
// v55.50+ replaced the v55.49 build label with newer ones; the fix is
// still in place if the form Modal is gated correctly (verified in A)
// and the modals don't use backdrop-blur (verified in B). The build
// label just confirms a build > v55.41 (the original incorrect pin).
var anyBuildLabel = pSrc.match(/BUILD v55\.\d+-/g);
check('E.2 build modal stamp uses BUILD v55.X- format',
  anyBuildLabel && anyBuildLabel.length >= 1);
check('E.3 stamp version is at least v55.49 (was v55.41 before fix)',
  anyBuildLabel && anyBuildLabel.some(function(s) {
    var m = s.match(/v55\.(\d+)/);
    return m && parseInt(m[1], 10) >= 49;
  }));

// ---------- F: Regression — v55.48 fixes still in place ----------
console.log('\nF. v55.48 fixes still intact (no regression)');

check('F.1 toast.info pops when order# not found (v55.48 fix)',
  /toast\.info\('Order #' \+ orderNumTrimmed \+ ' not found/.test(pSrc));

// ---------- F: Regression — earlier session fixes still in place ----------
console.log('\nG. Earlier session fixes (v55.41-v55.47) still intact');

check('G.1 v55.47 inline validation banner still rendered',
  /treasuryFormErrors\.length > 0 && \(/.test(pSrc));
check('G.2 v55.47 amount field has data-treasury-field anchor',
  /data-treasury-field="amount"/.test(pSrc));
check('G.3 v55.41 confirmed_not_duplicate stamp on bypassDupCheck path',
  /confirmed_not_duplicate = true/.test(pSrc));

// ---------- Summary ----------
console.log('\n========================================');
console.log('PASSED: ' + passed);
console.log('FAILED: ' + failed);
console.log('========================================\n');

if (failed > 0) {
  console.log('FAILURES indicate the v55.49 fix has been regressed. Re-read the bug context at the top of this file before "fixing" the test — the test is likely correct.\n');
  process.exit(1);
}
console.log('✓ All v55.49 invoice-modal stacking tests passed.\n');
