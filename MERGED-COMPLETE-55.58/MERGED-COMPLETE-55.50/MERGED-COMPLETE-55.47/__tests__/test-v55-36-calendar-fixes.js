// Test suite for v55.36 calendar fixes
// =====================================
// Two bug categories:
//  - "Delete all in series" wasn't actually deleting all (silent .delete()
//    error swallowing + no series_id on legacy/orphan rows + picker hidden)
//  - No way to view a specific teammate's calendar to add events for them
//
// These tests assert the patches landed in source. They don't run the
// component — that requires a Next.js + jsdom harness we don't have here.

import fs from 'fs';
import path from 'path';

var REPO = path.resolve(new URL('.', import.meta.url).pathname, '..');

var passed = 0, failed = 0;
var errors = [];
function assert(cond, label) {
  if (cond) { passed++; }
  else { failed++; errors.push(label); console.log('  ✗ ' + label); }
}
function read(rel) { return fs.readFileSync(path.join(REPO, rel), 'utf8'); }

console.log('\n========================================');
console.log('v55.36 CALENDAR FIXES TEST SUITE');
console.log('========================================\n');

var cal = read('src/components/CalendarTab.jsx');

// ----------------------------------------------------------------------
// BUG 1 — Delete all in series hardening
// ----------------------------------------------------------------------
console.log('Bug 1: Delete-all hardening');

// 1a — Delete must capture .error and .data instead of throwing them away
assert(cal.indexOf('.delete().in(\'id\', ids).select(\'id\')') >= 0
    || /\.delete\(\)\.in\('id',\s*ids\)\.select\('id'\)/.test(cal),
  'B1.1 — delete().in() now uses .select(\'id\') so we get back the actual rows deleted');
assert(/if\s*\(\s*delRes\.error\s*\)/.test(cal),
  'B1.2 — captures error from the delete call');
assert(cal.indexOf('actuallyDeletedCount') >= 0,
  'B1.3 — counts actually-deleted rows from response, not from input ids');

// 1b — Post-delete verification
assert(cal.indexOf('still remain in the series') >= 0,
  'B1.4 — surfaces a clear error when rows survive the delete');
assert(cal.indexOf('survivors > 0') >= 0,
  'B1.5 — branches on survivor count, not just on error');
// Post-delete count query must use head:true count:'exact' for accuracy
assert(/select\(['"]id['"],\s*\{\s*count:\s*['"]exact['"],\s*head:\s*true\s*\}\)/.test(cal),
  'B1.6 — uses head+exact count for post-delete verification');

// 1c — Orphan-recurring fallback in resolveScopedIds
assert(cal.indexOf('orphan-recurring fallback') >= 0
    || cal.indexOf('orphan-recurring') >= 0,
  'B1.7 — comment block documents orphan-recurring fallback');
assert(cal.indexOf(".is('series_id', null)") >= 0,
  'B1.8 — orphan path queries WHERE series_id IS NULL');
// The orphan fallback must match by title + recurring + creator
assert(/\.eq\('title',\s*editEvent\.title\)/.test(cal)
    && /\.eq\('recurring',\s*editEvent\.recurring\)/.test(cal),
  'B1.9 — orphan fallback matches sibling rows by title+recurring');

// 1d — Picker UI broadened to include orphan-recurring events
var pickerGate = "(editEvent.series_id || (editEvent.recurring && editEvent.recurring !== 'none'))";
var pickerGateOccurrences = cal.split(pickerGate).length - 1;
assert(pickerGateOccurrences >= 3,
  'B1.10 — picker gate broadened on all 3 use sites (cancel/delete/restore), found ' + pickerGateOccurrences);

// 1e — scopedCount handles orphan-recurring
assert(cal.indexOf('isOrphanRecurring') >= 0,
  'B1.11 — scopedCount has orphan-recurring branch');

// ----------------------------------------------------------------------
// BUG 2 — Team-member calendar view + create on their calendar
// ----------------------------------------------------------------------
console.log('\nBug 2: Team-member calendar viewing');

// 2a — calViewUser state added
assert(cal.indexOf('calViewUser') >= 0,
  'B2.1 — calViewUser state introduced');
assert(/setCalViewUser/.test(cal),
  'B2.2 — setCalViewUser setter wired up');

// 2b — Filter uses focusUserId
assert(cal.indexOf('focusUserId') >= 0,
  'B2.3 — visibleEvents filter respects focusUserId (= calViewUser || myId)');
assert(/focusUserId\s*=\s*calViewUser\s*\|\|\s*myId/.test(cal),
  'B2.4 — focusUserId computed correctly');

// 2c — Picker dropdown rendered (super admin only)
assert(/isSuperAdmin\s*&&\s*Array\.isArray\(users\)/.test(cal),
  'B2.5 — picker is gated on super admin role');
assert(cal.indexOf("'s calendar") >= 0 || cal.indexOf("'s calendar\"") >= 0
    || cal.indexOf("'s calendar`") >= 0 || cal.indexOf('s calendar') >= 0,
  'B2.6 — option labels mention "X\'s calendar"');

// 2d — Pre-fill primary attendee when creating event on someone else's calendar
assert(/calViewUser\s*&&\s*calViewUser\s*!==\s*myId/.test(cal),
  'B2.7 — new-event button checks if calViewUser is set and not self');
assert(cal.indexOf('presetUsers') >= 0,
  'B2.8 — presetUsers variable used to pre-fill attendees');

// 2e — Banner when viewing someone else's calendar
assert(cal.indexOf('Viewing') >= 0 && cal.indexOf("'s calendar") >= 0,
  'B2.9 — banner text references "Viewing X\'s calendar"');
assert(cal.indexOf('Back to my calendar') >= 0,
  'B2.10 — banner has a "Back to my calendar" reset button');

// 2f — Dependency array on the visibleEvents memo includes calViewUser
assert(/\[allEvents,\s*calView,\s*user,\s*myId,\s*calViewUser\]/.test(cal),
  'B2.11 — visibleEvents memo deps include calViewUser');

// ----------------------------------------------------------------------
// BUG 1 SQL — orphan series_id backfill migration exists
// ----------------------------------------------------------------------
console.log('\nBug 1 SQL: Orphan series_id backfill migration');

var sqlPath = path.join(REPO, 'sql/s37_backfill_orphan_series_id.sql');
assert(fs.existsSync(sqlPath), 'B1S.1 — sql/s37_backfill_orphan_series_id.sql exists');
if (fs.existsSync(sqlPath)) {
  var sql = read('sql/s37_backfill_orphan_series_id.sql');
  assert(sql.indexOf('calendar_events_backup_s37') >= 0, 'B1S.2 — migration takes a safety backup');
  assert(sql.indexOf('series_id IS NULL') >= 0, 'B1S.3 — only touches rows with NULL series_id');
  assert(sql.indexOf("recurring <> 'none'") >= 0, 'B1S.4 — only touches recurring events');
  assert(sql.indexOf('gen_random_uuid()') >= 0, 'B1S.5 — assigns fresh UUIDs');
  assert(sql.indexOf('is_series_master = true') >= 0, 'B1S.6 — marks earliest row of each group as master');
  assert(sql.indexOf('HAVING COUNT(*) >= 2') >= 0, 'B1S.7 — only groups with 2+ rows count as series');
}

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
  errors.forEach(function (e) { console.log('  • ' + e); });
  process.exit(1);
}
console.log('✓ All v55.36 calendar-fix assertions present.\n');
