// ============================================================
// v55.27 — Tickets status constraint must cover every UI status
// ============================================================
//
// Background: Through v55.26 the UI offered "Blocked" and "On Hold" status
// options, but the database CHECK constraint on tickets.status didn't
// include them. Clicking those buttons fired an UPDATE that Postgres
// rejected with a CHECK violation, so the status never actually changed.
//
// This test prevents that drift from happening again. It parses the
// STATUSES array out of TicketsTab.jsx and verifies every entry is also
// present in either:
//   1. The s33 migration (for existing installs), AND
//   2. The schema.sql constraint (for fresh installs).
//
// If someone adds a new status to the UI in a future session without
// also updating the DB constraint, this test fails loudly.
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

// Pull the UI's STATUSES list out of TicketsTab.jsx
var ticketsTab = fs.readFileSync(path.join(REPO, 'src/components/TicketsTab.jsx'), 'utf8');
var match = ticketsTab.match(/const STATUSES = \[([^\]]+)\]/);
if (!match) {
  console.log('✗ Could not locate STATUSES array in TicketsTab.jsx');
  process.exit(1);
}
var uiStatuses = match[1]
  .split(',')
  .map(function(s) { return s.replace(/['"\s]/g, ''); })
  .filter(Boolean);

console.log('UI statuses:', uiStatuses.join(', '));

// Pull the s33 migration's allowed-status list
var s33 = fs.readFileSync(path.join(REPO, 'sql/s33_tickets_status_constraint_fix.sql'), 'utf8');
var s33Match = s33.match(/CHECK \(status IN \(([\s\S]*?)\)\)/);
if (!s33Match) {
  console.log('✗ Could not locate CHECK clause in s33 migration');
  process.exit(1);
}
var s33Statuses = s33Match[1]
  .split(',')
  .map(function(s) { return s.replace(/['"\s\n]/g, ''); })
  .filter(Boolean);

console.log('s33 migration statuses:', s33Statuses.join(', '));

// Pull schema.sql's tickets.status constraint
var schema = fs.readFileSync(path.join(REPO, 'supabase/schema.sql'), 'utf8');
// Match the line in CREATE TABLE tickets that defines status with a CHECK
var schemaMatch = schema.match(/status TEXT NOT NULL DEFAULT 'New' CHECK \(status IN \(([^)]+)\)\)/);
if (!schemaMatch) {
  console.log('✗ Could not locate tickets.status CHECK in schema.sql');
  process.exit(1);
}
var schemaStatuses = schemaMatch[1]
  .split(',')
  .map(function(s) { return s.replace(/['"\s]/g, ''); })
  .filter(Boolean);

console.log('schema.sql statuses:', schemaStatuses.join(', '));

// ---- Tests ----

test('Every UI status is allowed by the s33 migration', function() {
  uiStatuses.forEach(function(s) {
    assert(s33Statuses.indexOf(s) >= 0,
      'UI status "' + s + '" missing from s33 migration — clicking this button in the UI would silently fail');
  });
});

test('Every UI status is allowed by schema.sql (for fresh installs)', function() {
  uiStatuses.forEach(function(s) {
    assert(schemaStatuses.indexOf(s) >= 0,
      'UI status "' + s + '" missing from schema.sql — fresh installs would reject this status');
  });
});

test('s33 migration drops old constraint before adding new one', function() {
  assert(/DROP CONSTRAINT/i.test(s33),
    's33 must DROP the old CHECK constraint (otherwise ALTER TABLE ADD CONSTRAINT fails on existing installs)');
  // The drop must come BEFORE the add
  var dropIdx = s33.search(/DROP CONSTRAINT/i);
  var addIdx = s33.search(/ADD CONSTRAINT/i);
  assert(dropIdx > -1 && addIdx > -1 && dropIdx < addIdx,
    'DROP must precede ADD for the migration to actually replace the constraint');
});

test('s33 migration is idempotent (uses IF EXISTS or pg_constraint lookup)', function() {
  // Either pattern is acceptable: explicit IF EXISTS on DROP, OR a DO block
  // that loops through pg_constraint and drops by name.
  assert(/IF EXISTS/i.test(s33) || /pg_constraint/i.test(s33),
    'Migration must be safely re-runnable');
});

test('Specific bug repro: Blocked is allowed', function() {
  assert(s33Statuses.indexOf('Blocked') >= 0, 's33 must allow Blocked');
  assert(schemaStatuses.indexOf('Blocked') >= 0, 'schema.sql must allow Blocked');
  assert(uiStatuses.indexOf('Blocked') >= 0, 'UI must offer Blocked');
});

test('Specific bug repro: On Hold is allowed', function() {
  assert(s33Statuses.indexOf('OnHold') >= 0, 's33 must allow On Hold (parsed as OnHold after stripping quotes/spaces)');
  assert(schemaStatuses.indexOf('OnHold') >= 0, 'schema.sql must allow On Hold');
  assert(uiStatuses.indexOf('OnHold') >= 0, 'UI must offer On Hold');
});

test('Legacy statuses (Waiting/Testing/Ready) preserved for backward compat', function() {
  // These were in the original DB constraint but never in the UI. Any
  // historical rows with these statuses must stay valid.
  ['Waiting', 'Testing', 'Ready'].forEach(function(s) {
    assert(s33Statuses.indexOf(s) >= 0, 's33 should preserve legacy status "' + s + '"');
    assert(schemaStatuses.indexOf(s) >= 0, 'schema.sql should preserve legacy status "' + s + '"');
  });
});

console.log('\n──────────────────────────────────────────────────');
console.log('V55.27 — TICKETS STATUS CONSTRAINT FIX');
console.log('──────────────────────────────────────────────────');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed === 0) {
  console.log('\n✅ All v55.27 status constraint tests passed');
} else {
  console.log('\n❌ FAILURES');
  process.exit(1);
}
