// ============================================================
// v55.50 — Calendar delete/cancel performance fix
//
// Bug context (May 6 2026): Max reported "I'm trying to delete a
// recurring meeting and all its occurrences. I clicked Delete and
// it's been hanging for 10 minutes."
//
// Root cause: performDelete and performCancel both used a
// SEQUENTIAL await loop to cancel reminders + (in cancel's case)
// to update each event row. For a daily meeting series with 365
// occurrences that's 365+ round-trips to Supabase before the
// actual operation finished. On slow networks: minutes. On
// flaky networks: forever.
//
// Fix: bulk DB calls (one round-trip regardless of series size)
// + 60s timeout watchdog so a single hung call can never freeze
// the modal forever.
//
// What this test guards against:
//   - sequential per-row cancelEventReminders loop in performDelete
//   - sequential per-row dbUpdate loop in performCancel
//   - missing timeout watchdog on either operation
//   - cancelEventRemindersBulk helper missing or renamed
// ============================================================

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var REPO = path.resolve(__dirname, '..');
var calSrc = fs.readFileSync(path.join(REPO, 'src/components/CalendarTab.jsx'), 'utf8');
var remSrc = fs.readFileSync(path.join(REPO, 'src/lib/reminders.js'), 'utf8');

var passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { console.log('✓ ' + label); passed++; }
  else { console.log('✗ ' + label); failed++; }
}

console.log('============================================================');
console.log('v55.50 — Calendar delete/cancel bulk-operation regression');
console.log('============================================================\n');

// ---------- A: Bulk helper exists ----------
console.log('A. cancelEventRemindersBulk helper present in lib/reminders');

check('A.1 cancelEventRemindersBulk function exported',
  /export async function cancelEventRemindersBulk/.test(remSrc));
check('A.2 uses .in() to delete many target_ids in one DB call',
  /\.in\('target_id', eventIds\)/.test(remSrc));
check('A.3 still scoped to target_kind = event',
  /cancelEventRemindersBulk[\s\S]*\.eq\('target_kind', 'event'\)/.test(remSrc));
check('A.4 still preserves SENT rows (only deletes unsent)',
  /cancelEventRemindersBulk[\s\S]*\.is\('sent_at', null\)/.test(remSrc));

// ---------- B: CalendarTab imports the bulk helper ----------
console.log('\nB. CalendarTab imports cancelEventRemindersBulk');

check('B.1 imports cancelEventRemindersBulk from ../lib/reminders',
  /import \{[^}]*cancelEventRemindersBulk[^}]*\} from '\.\.\/lib\/reminders'/.test(calSrc));

// ---------- C: performDelete uses bulk reminder cancel ----------
console.log('\nC. performDelete uses bulk reminder cancel (no per-row loop)');

var perfDelete = calSrc.match(/const performDelete = async \(\) => \{[\s\S]*?\n  \};/);
check('C.0 performDelete found', !!perfDelete);
check('C.1 performDelete calls cancelEventRemindersBulk',
  perfDelete && /cancelEventRemindersBulk\(ids\)/.test(perfDelete[0]));
check('C.2 performDelete does NOT contain a `for (const id of ids)` loop with await cancelEventReminders',
  perfDelete && !/for \(const id of ids\)[\s\S]{0,200}await cancelEventReminders\(/.test(perfDelete[0]));

// ---------- D: performDelete has timeout watchdog ----------
console.log('\nD. performDelete has 60s timeout watchdog (no infinite hangs)');

check('D.1 performDelete has TOTAL_TIMEOUT_MS constant',
  perfDelete && /TOTAL_TIMEOUT_MS/.test(perfDelete[0]));
check('D.2 performDelete uses Promise.race with watchdog',
  perfDelete && /Promise\.race\(\[/.test(perfDelete[0]));
check('D.3 timeout is 60 seconds',
  perfDelete && /TOTAL_TIMEOUT_MS = 60000/.test(perfDelete[0]));
check('D.4 timeout error message mentions seconds',
  perfDelete && /timed out/.test(perfDelete[0]));

// ---------- E: performCancel uses bulk update + bulk reminder cancel ----------
console.log('\nE. performCancel uses bulk update + bulk reminder cancel');

var perfCancel = calSrc.match(/const performCancel = async \(\) => \{[\s\S]*?\n  \};/);
check('E.0 performCancel found', !!perfCancel);
check('E.1 performCancel uses bulk supabase.from(\'calendar_events\').update()',
  perfCancel && /supabase\s*\n?\s*\.from\('calendar_events'\)\s*\n?\s*\.update\(cancelPatch\)\s*\n?\s*\.in\('id', ids\)/.test(perfCancel[0]));
check('E.2 performCancel does NOT contain per-row `for (const id of ids)` with await dbUpdate',
  perfCancel && !/for \(const id of ids\)[\s\S]{0,200}await dbUpdate/.test(perfCancel[0]));
check('E.3 performCancel calls cancelEventRemindersBulk',
  perfCancel && /cancelEventRemindersBulk\(ids\)/.test(perfCancel[0]));
check('E.4 performCancel has timeout watchdog too',
  perfCancel && /Promise\.race\(\[/.test(perfCancel[0]) && /TOTAL_TIMEOUT_MS/.test(perfCancel[0]));

// ---------- F: Background refresh (loadEvents not awaited) ----------
console.log('\nF. loadEvents() runs in background (UI never appears hung after success)');

check('F.1 performDelete calls loadEvents().catch — not await loadEvents()',
  perfDelete && /loadEvents\(\)\.catch\(/.test(perfDelete[0]) && !/await loadEvents\(\);[\s\S]{0,50}if \(onRefresh\) onRefresh\(\);/.test(perfDelete[0]));
check('F.2 performCancel calls loadEvents().catch — not await loadEvents()',
  perfCancel && /loadEvents\(\)\.catch\(/.test(perfCancel[0]));

// ---------- G: Build stamp current ----------
console.log('\nG. Build stamps current');

var pSrc = fs.readFileSync(path.join(REPO, 'src/app/page.jsx'), 'utf8');
check('G.1 header pill bumped to v55.50',
  />v55\.50</.test(pSrc));
check('G.2 build modal stamp shows v55.50',
  /BUILD v55\.50-CALENDAR-DELETE-BULK-FIX/.test(pSrc));

// ---------- H: Earlier session fixes still intact ----------
console.log('\nH. Earlier session fixes still intact (no regression)');

check('H.1 v55.49 form-modal hide gate still present',
  /\{showAddTreasury && !pendingTreasuryRecord && !duplicateConfirm && \(/.test(pSrc));
check('H.2 v55.48 toast.info still pops on order# not found',
  /toast\.info\('Order #' \+ orderNumTrimmed \+ ' not found/.test(pSrc));
check('H.3 v55.47 inline validation banner still rendered',
  /treasuryFormErrors\.length > 0 && \(/.test(pSrc));

// ---------- Summary ----------
console.log('\n========================================');
console.log('PASSED: ' + passed);
console.log('FAILED: ' + failed);
console.log('========================================\n');

if (failed > 0) {
  console.log('FAILURES indicate the v55.50 calendar-delete fix has been regressed.\n');
  process.exit(1);
}
console.log('✓ All v55.50 calendar bulk-operation tests passed.\n');
