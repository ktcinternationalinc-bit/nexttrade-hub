// ============================================================
// v55.30 — dbInsert/dbUpdate resilient to missing columns
// ============================================================
// Background: when a UI feature ships before its SQL migration is run,
// supabase-js returns "Could not find the 'X' column of 'Y' in the
// schema cache". Until v55.30 this killed the entire save and the
// user lost their work.
//
// The fix: dbInsert and dbUpdate now detect the missing-column error,
// strip that field, and retry once. The save succeeds with whatever
// fields exist; only the unmappable field is dropped, with a console
// warning telling the developer to run the missing migration.
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

var supabaseLib = fs.readFileSync(path.join(REPO, 'src/lib/supabase.js'), 'utf8');
var s34 = fs.readFileSync(path.join(REPO, 'sql/s34_calendar_columns_consolidated.sql'), 'utf8');

console.log('\n──────────────────────────────────────────────────');
console.log('V55.30 — DB HELPERS RESILIENT TO MISSING COLUMNS');
console.log('──────────────────────────────────────────────────');

// ---- extractMissingColumn helper ----

test('extractMissingColumn helper exists', function() {
  assert(/function extractMissingColumn\(error\)/.test(supabaseLib),
    'helper present');
});

test('extractMissingColumn handles "Could not find the X column" pattern', function() {
  // This is the exact error supabase-js returned in Max's screenshot
  assert(/Could not find the '\(\[\^'\]\+\)' column/.test(supabaseLib),
    'matches the schema-cache error pattern');
});

test('extractMissingColumn handles raw Postgres "column X of relation" pattern', function() {
  // Fallback for non-PostgREST errors — direct PG error messages
  assert(/column "\(\[\^"\]\+\)" of relation/.test(supabaseLib),
    'matches direct PG error pattern');
});

test('extractMissingColumn returns null when no match', function() {
  // Critical — must not steal regular errors and silently strip fields
  // when the error is something else (RLS denial, FK violation, etc.)
  assert(/return null;/.test(supabaseLib),
    'returns null on non-match');
});

// ---- dbInsert behavior ----

test('dbInsert tries first, then strips on missing-column error, then retries ONCE', function() {
  var fnMatch = supabaseLib.match(/export async function dbInsert[\s\S]+?\n\}/);
  assert(fnMatch, 'dbInsert function found');
  var body = fnMatch[0];
  // Two distinct supabase.from(...).insert() calls — first attempt + retry
  var inserts = body.match(/supabase\.from\(table\)\.insert/g) || [];
  assert(inserts.length === 2,
    'must call insert exactly twice (first + retry); found ' + inserts.length);
});

test('dbInsert only strips a column that was actually in the record', function() {
  // Defensive: don't strip a column the user didn't even pass —
  // that would mask bugs where the column name in the error is unrelated
  // to what we sent (impossible in normal flow, but worth guarding).
  assert(/if \(missing && missing in attemptRecord\)/.test(supabaseLib),
    'only strip if column was in the record');
});

test('dbInsert logs a warning telling the dev to run the migration', function() {
  assert(/Run the SQL migration that adds this column/.test(supabaseLib),
    'console warning instructs the dev');
});

test('dbInsert audit log uses the post-strip record (not the original)', function() {
  var fnMatch = supabaseLib.match(/export async function dbInsert[\s\S]+?\n\}/);
  assert(fnMatch, 'dbInsert');
  // new_values should match what was actually written, not the rejected version
  assert(/new_values: attemptRecord/.test(fnMatch[0]),
    'audit reflects what actually got persisted');
});

// ---- dbUpdate behavior ----

test('dbUpdate has the same retry pattern', function() {
  var fnMatch = supabaseLib.match(/export async function dbUpdate[\s\S]+?(?=\n\/\/ Helper: delete|$)/);
  assert(fnMatch, 'dbUpdate function found');
  var body = fnMatch[0];
  var updates = body.match(/supabase\.from\(table\)\.update/g) || [];
  // 2 updates: first + retry. (The plain old-row .select doesn't count.)
  assert(updates.length === 2,
    'must call update exactly twice; found ' + updates.length);
});

test('dbUpdate handles the case where stripping the only field leaves nothing', function() {
  // If the user only changed all_day and that column is missing,
  // there's nothing left to update — return the old row instead of
  // running an empty UPDATE that would clobber updated_at unnecessarily.
  assert(/if \(Object\.keys\(retryChanges\)\.length === 0\)/.test(supabaseLib),
    'handles empty-changes case');
});

test('dbUpdate audit log uses attemptChanges', function() {
  // Same fix as dbInsert — audit reflects reality
  assert(/new_values: attemptChanges/.test(supabaseLib),
    'audit reflects what actually got persisted');
});

test('Both helpers attach __strippedColumns diagnostic to returned data', function() {
  // Non-enumerable so it doesn't break consumers that JSON.stringify the row.
  // Useful when we want to surface "this column was dropped" warnings later.
  var occurrences = supabaseLib.match(/__strippedColumns/g) || [];
  // 2 occurrences expected: one defineProperty call inside dbInsert, one inside dbUpdate.
  assert(occurrences.length >= 2,
    'both helpers tag the row; found ' + occurrences.length);
  assert(/enumerable: false/.test(supabaseLib),
    'tag is non-enumerable to avoid leaking into JSON.stringify');
});

// ---- s34 migration ----

test('s34 migration adds all_day column (the actual missing one)', function() {
  assert(/ADD COLUMN IF NOT EXISTS all_day BOOLEAN NOT NULL DEFAULT FALSE/.test(s34),
    'all_day column added');
});

test('s34 migration adds location and join_link', function() {
  assert(/ADD COLUMN IF NOT EXISTS location TEXT/.test(s34), 'location');
  assert(/ADD COLUMN IF NOT EXISTS join_link TEXT/.test(s34), 'join_link');
});

test('s34 migration includes s24 cancel/attendees columns (idempotent re-apply)', function() {
  assert(/ADD COLUMN IF NOT EXISTS status TEXT/.test(s34), 'status');
  assert(/ADD COLUMN IF NOT EXISTS attendees UUID/.test(s34), 'attendees');
  assert(/ADD COLUMN IF NOT EXISTS cancelled_at/.test(s34), 'cancelled_at');
});

test('s34 migration is idempotent (every ADD has IF NOT EXISTS)', function() {
  // Catch any column add that forgot IF NOT EXISTS — re-running would error.
  var adds = s34.match(/ADD COLUMN(?! IF NOT EXISTS)/g) || [];
  assert(adds.length === 0, 'all ADD COLUMN must use IF NOT EXISTS');
});

test('s34 migration triggers PostgREST schema reload', function() {
  // Without this, supabase-js may keep saying "schema cache" until the
  // next deploy. Triggering NOTIFY makes the fix immediate.
  assert(/NOTIFY pgrst, 'reload schema'/.test(s34),
    'must NOTIFY pgrst so the API picks up new columns immediately');
});

console.log('\n──────────────────────────────────────────────────');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed === 0) {
  console.log('\n✅ All v55.30 missing-column resilience tests passed');
} else {
  console.log('\n❌ FAILURES');
  process.exit(1);
}
