// ============================================================
// v55.33 — Calendar recurring fixes + Shipping currency fixes
// ============================================================
// Headline: recurring meetings now actually work (cancel / delete /
// restore each have their own scope picker; occurrences inherit
// attendees, description, location, link, all-day from the master;
// reminders fire for every attendee). Shipping rate views stop
// silently mixing currencies (USD chart no longer averages USD with
// EUR; summary cards group by primary currency; per-row Δ vs prev
// shows whether a vendor is raising or lowering rates over time).
// ============================================================

var fs = require('fs');
var path = require('path');
var REPO = path.resolve(__dirname, '..');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('✓ ' + name); passed++; }
  catch (e) { console.log('✗ ' + name + ' — ' + e.message); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

var calTab     = fs.readFileSync(path.join(REPO, 'src/components/CalendarTab.jsx'), 'utf8');
var genOcc     = fs.readFileSync(path.join(REPO, 'src/app/api/events/generate-occurrences/route.js'), 'utf8');
var shipTab    = fs.readFileSync(path.join(REPO, 'src/components/ShippingRatesTab.jsx'), 'utf8');
var page       = fs.readFileSync(path.join(REPO, 'src/app/page.jsx'), 'utf8');

console.log('\n──────────────────────────────────────────────────');
console.log('V55.33 — CALENDAR RECURRING + SHIPPING CURRENCY');
console.log('──────────────────────────────────────────────────');

// ============================================================
// CALENDAR — SCOPE STATE + HELPERS
// ============================================================

test('Cal: cancelScope state defined with default single', function() {
  assert(/const \[cancelScope, setCancelScope\] = useState\('single'\)/.test(calTab),
    'cancelScope state present');
});

test('Cal: deleteScope state defined with default single', function() {
  assert(/const \[deleteScope, setDeleteScope\] = useState\('single'\)/.test(calTab),
    'deleteScope state present');
});

test('Cal: restoreScope state defined with default single', function() {
  assert(/const \[restoreScope, setRestoreScope\] = useState\('single'\)/.test(calTab),
    'restoreScope state present');
});

test('Cal: resolveScopedIds helper exists and handles single/series/following', function() {
  assert(/const resolveScopedIds = async \(scope\) =>/.test(calTab),
    'resolveScopedIds defined');
  var fn = calTab.match(/const resolveScopedIds = async[\s\S]*?\n  \};/);
  assert(fn, 'fn body extracted');
  assert(/scope === 'single'/.test(fn[0]), 'handles single');
  assert(/scope === 'series'/.test(fn[0]), 'handles series');
  assert(/scope === 'following'/.test(fn[0]), 'handles following');
  assert(/\.gte\('event_date', editEvent\.event_date\)/.test(fn[0]),
    'following uses gte event_date');
});

test('Cal: scopedCount helper provides live preview from local state', function() {
  assert(/const scopedCount = \(scope\) =>/.test(calTab),
    'scopedCount defined');
  var fn = calTab.match(/const scopedCount = \(scope\)[\s\S]*?\n  \};/);
  assert(fn, 'fn body extracted');
  assert(/events\.filter/.test(fn[0]),
    'reads from local events state for instant preview (no DB query per click)');
});

// ============================================================
// CALENDAR — LIFECYCLE FUNCTIONS USE SCOPE HELPERS
// ============================================================

test('Cal: performCancel uses resolveScopedIds(cancelScope)', function() {
  var fn = calTab.match(/const performCancel = async[\s\S]*?\n  \};/);
  assert(fn, 'performCancel found');
  assert(/resolveScopedIds\(cancelScope\)/.test(fn[0]),
    'cancel uses cancelScope');
  assert(/for \(const id of ids\)/.test(fn[0]) || /\.update\([\s\S]+?\)[\s\S]*?\.in\('id',\s*ids\)/.test(fn[0]),
    'either loops resolved ids OR uses bulk .update().in()');
  assert(/await loadEvents\(\)/.test(fn[0]) || /loadEvents\(\)/.test(fn[0]),
    'refreshes local calendar after cancel');
});

test('Cal: performDelete uses .delete().in(id, ids)', function() {
  var fn = calTab.match(/const performDelete = async[\s\S]*?\n  \};/);
  assert(fn, 'performDelete found');
  assert(/resolveScopedIds\(deleteScope\)/.test(fn[0]),
    'delete uses deleteScope');
  assert(/\.delete\(\)[\s\S]*?\.in\('id', ids\)/.test(fn[0]),
    'bulk delete via .in(id, ids)');
  assert(/loadEvents\(\)/.test(fn[0]),
    'refreshes after delete');
});

test('Cal: performDecline exists and reads reason from actionReason (no window.prompt)', function() {
  var fn = calTab.match(/const performDecline = async[\s\S]*?\n  \};/);
  assert(fn, 'performDecline found (renamed from declineInvite)');
  assert(/actionReason/.test(fn[0]),
    'reads reason from actionReason state');
  assert(!/window\.prompt\(/.test(fn[0]),
    'no window.prompt (was getting silently suppressed by browsers)');
  assert(/declinePatch\s*=\s*\{/.test(fn[0]),
    'patch stored as declinePatch const');
});

test('Cal: uncancelMeeting uses resolveScopedIds(restoreScope)', function() {
  var fn = calTab.match(/const uncancelMeeting = async[\s\S]*?\n  \};/);
  assert(fn, 'uncancelMeeting found');
  assert(/resolveScopedIds\(restoreScope\)/.test(fn[0]),
    'restore is now scope-aware');
  assert(/await loadEvents\(\)/.test(fn[0]),
    'refreshes after restore');
});

// ============================================================
// CALENDAR — UI WIRING
// ============================================================

test('Cal UI: Decline button opens setActionStage("decline")', function() {
  // v55.33 — was direct declineInvite call; now opens an in-modal stage
  // so the reason input renders inline (window.prompt was unreliable).
  assert(/setActionStage\('decline'\)/.test(calTab),
    'decline button transitions to actionStage decline');
});

test('Cal UI: Restore button opens setActionStage("restore")', function() {
  // v55.33 — was direct uncancelMeeting; now opens stage with scope picker.
  assert(/setActionStage\('restore'\)/.test(calTab),
    'restore button transitions to actionStage restore');
});

test('Cal UI: Cancel dialog has scope picker with "Will cancel N meetings" preview', function() {
  assert(/Will cancel/.test(calTab),
    'cancel dialog shows live count');
  assert(/scopedCount\(cancelScope\)/.test(calTab),
    'preview reads from scopedCount(cancelScope)');
});

test('Cal UI: Delete dialog has scope picker with "Will permanently delete N meetings" preview', function() {
  assert(/Will permanently delete/.test(calTab),
    'delete dialog shows live count');
  assert(/scopedCount\(deleteScope\)/.test(calTab),
    'preview reads from scopedCount(deleteScope)');
});

test('Cal UI: edit modal has description, event_type, and customer_id fields', function() {
  assert(/editForm\.description/.test(calTab),
    'description field present');
  assert(/editForm\.eventType/.test(calTab),
    'event_type field present');
  assert(/editForm\.customerId/.test(calTab),
    'customer_id field present');
});

test('Cal: saveEditEvent supports following scope and bulk-propagates fieldUpdate', function() {
  var fn = calTab.match(/const saveEditEvent = async[\s\S]*?\n  \};/);
  assert(fn, 'saveEditEvent found');
  assert(/editScope === 'following'/.test(fn[0]),
    'handles "this and following" scope');
  assert(/\.update\(fieldUpdate\)\.in\('id', sibIds\)/.test(fn[0]),
    'bulk-propagates ALL non-date fields to siblings (was only title/time before)');
});

// ============================================================
// GENERATE-OCCURRENCES — INHERIT FIELDS + ATTENDEE REMINDERS
// ============================================================

test('GenOcc: childRows inherit attendees from master', function() {
  assert(/attendees: master\.attendees \|\| \[\]/.test(genOcc),
    'attendees carried forward to each occurrence');
});

test('GenOcc: childRows inherit description, location, join_link, all_day from master', function() {
  assert(/description: master\.description \|\| null/.test(genOcc),
    'description inherited');
  assert(/location: master\.location \|\| null/.test(genOcc),
    'location inherited');
  assert(/join_link: master\.join_link \|\| null/.test(genOcc),
    'join_link inherited');
  assert(/all_day: !!master\.all_day/.test(genOcc),
    'all_day inherited');
});

test('GenOcc: select after upsert includes attendees', function() {
  assert(/\.select\('id, event_date, assigned_to, attendees'\)/.test(genOcc),
    'attendees fetched back so the reminder loop can see them');
});

test('GenOcc: reminder loop builds recipients union (master.attendees + occ.assigned_to)', function() {
  assert(/recipients = master\.attendees\.slice\(\)/.test(genOcc),
    'starts with master.attendees');
  assert(/recipients\.indexOf\(occ\.assigned_to\) === -1/.test(genOcc),
    'avoids double-adding assigned_to if already in attendees');
  assert(/for \(var ri = 0; ri < recipients\.length; ri\+\+\)/.test(genOcc),
    'creates reminders for every recipient (was only assigned_to before — side-attendees got no reminders past the first occurrence)');
});

// ============================================================
// SHIPPING RATES — CURRENCY-AWARE
// ============================================================

test('Shipping: trend chart Y-axis tickFormatter uses chartSym (not hardcoded $)', function() {
  assert(/tickFormatter=\{function\(v\)\{ return chartSym \+ v; \}\}/.test(shipTab),
    'Y-axis tick uses dynamic chartSym');
  assert(!/tickFormatter=\{function\(v\)\{ return '\$' \+ v; \}\}/.test(shipTab),
    'old hardcoded $ tick is gone');
});

test('Shipping: mixed-currency warning banner present', function() {
  // Banner above chart when more than one currency on the route
  assert(/Mixed currencies on this route/.test(shipTab),
    'route_detail mixed-currency banner');
});

test('Shipping: summary cards filter by primary currency', function() {
  assert(/primaryCurrency/.test(shipTab),
    'primaryCurrency variable computed');
  assert(/primaryActive/.test(shipTab),
    'primaryActive used for "Best Active" card');
  assert(/primaryHistory/.test(shipTab),
    'primaryHistory used for Highest/Avg cards');
});

test('Shipping: "Best rate in period" filters to primary currency', function() {
  assert(/bestCurrency/.test(shipTab),
    'best-rate uses bestCurrency variable');
  assert(/filteredPrimary/.test(shipTab),
    'best-rate computed from filteredPrimary (currency-restricted)');
});

test('Shipping: period-over-period change banner present', function() {
  assert(/Period-over-period/.test(shipTab),
    'period-over-period comparison banner present');
  assert(/priorAvg/.test(shipTab) && /currentAvg/.test(shipTab),
    'computes prior + current period averages');
});

test('Shipping: per-row "Δ vs prev" column in historical rates table', function() {
  assert(/Δ vs prev/.test(shipTab),
    'column header present');
  assert(/deltas\[r\.id\]/.test(shipTab),
    'delta lookup keyed by row id');
});

test('Shipping: executeImport uses BATCH_SIZE 50', function() {
  assert(/const BATCH_SIZE = 50/.test(shipTab),
    'batch size constant');
  assert(/importData\.slice\(i, i \+ BATCH_SIZE\)/.test(shipTab),
    'slices into batches');
  assert(/supabase\.from\('shipping_rates'\)\.insert\(batch\)/.test(shipTab),
    'bulk inserts batch');
});

test('Shipping: executeImport has per-row fallback in catch block', function() {
  // If a batch fails, fall back to per-row dbInsert so we don't lose all 50.
  assert(/for \(const row of batch\)/.test(shipTab),
    'per-row loop inside catch as fallback');
  assert(/dbInsert\('shipping_rates', row, myId\)/.test(shipTab),
    'fallback uses dbInsert (audited)');
});

// ============================================================
// BUILD STAMP
// ============================================================

test('Build stamp: header shows v55.33 or later', function() {
  var match = page.match(/>v55\.(\d+)</);
  assert(match && Number(match[1]) >= 33,
    'page.jsx header build stamp shows v55.33+ (currently: ' + (match ? 'v55.' + match[1] : 'NOT FOUND') + ')');
});

test('Build stamp: in-app modal stamp present (any v55.x-LABEL format)', function() {
  // Original test asserted the exact v55.33 modal label. The modal label
  // updates per build. Just verify SOME BUILD label is present.
  assert(/BUILD v55\.\d+/.test(page),
    'in-app modal stamp present');
});

// ============================================================
// SUMMARY
// ============================================================

console.log('\n──────────────────────────────────────────────────');
console.log('Passed: ' + passed + '   Failed: ' + failed);
console.log('──────────────────────────────────────────────────\n');
process.exit(failed > 0 ? 1 : 0);
