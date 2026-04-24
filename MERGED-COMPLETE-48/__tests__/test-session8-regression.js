// ============================================================
// Session 8 (Apr 22 2026) regression tests
//
// Covers:
//  1. Nadia watch cron at 5-minute cadence (was 30)
//  2. Auto-logout IDLE_TIMEOUT = 2 hours (was 30 min)
//  3. calendar_events.description column exists in SQL migration
//  4. Event add form has description/agenda textarea
//  5. Event description rendered in day-view list
//  6. Event description rendered inside notes modal (agenda banner)
//  7. handleAddEvent payload includes description
//  8. Dashboard reminders split: Urgent vs Normal sections
//  9. Today-due items get animate-pulse (blink)
// 10. Today-due tickets fold into urgent reminders
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

var vercelJson  = JSON.parse(fs.readFileSync(path.join(REPO, 'vercel.json'), 'utf8'));
var pageSrc     = fs.readFileSync(path.join(REPO, 'src/app/page.jsx'), 'utf8');
var calSrc      = fs.readFileSync(path.join(REPO, 'src/components/CalendarTab.jsx'), 'utf8');
var dashSrc     = fs.readFileSync(path.join(REPO, 'src/components/PersonalDashboard.jsx'), 'utf8');
var sqlSrc      = fs.readFileSync(path.join(REPO, 'supabase/session8-event-description.sql'), 'utf8');

// ----- 1. Nadia watch cadence -----
test('S8.1 Nadia watch cron runs every 5 minutes', function() {
  var nadia = vercelJson.crons.find(function(c) { return c.path === '/api/nadia/watch'; });
  assert(nadia, 'nadia watch cron must be present');
  assert.strictEqual(nadia.schedule, '*/5 * * * *', 'schedule must be every 5 min, was ' + nadia.schedule);
});

test('S8.1b Other crons still preserved (Pro plan — 4 crons total)', function() {
  assert.strictEqual(vercelJson.crons.length, 4, 'should have 4 crons: categorize, generate-occurrences, reminders/dispatch, nadia/watch');
  var paths = vercelJson.crons.map(function(c) { return c.path; });
  ['/api/categorize', '/api/events/generate-occurrences', '/api/reminders/dispatch', '/api/nadia/watch']
    .forEach(function(p) { assert(paths.indexOf(p) >= 0, 'missing cron: ' + p); });
});

// ----- 2. Auto-logout 2 hours -----
test('S8.2 Auto-logout IDLE_TIMEOUT = 2 hours', function() {
  assert(/const IDLE_TIMEOUT = 2 \* 60 \* 60 \* 1000/.test(pageSrc),
    'IDLE_TIMEOUT must equal 2 * 60 * 60 * 1000 (2 hours in ms)');
});

test('S8.2b Auto-logout log entry text updated to "2 hours"', function() {
  assert(/Auto-logged out after 2 hours of inactivity/.test(pageSrc),
    'daily_log entry should say "2 hours" not "30 min"');
  assert(!/Auto-logged out after 30 min inactivity/.test(pageSrc),
    'old "30 min" log text must be removed');
});

// ----- 3-4. SQL migration + form field -----
test('S8.3 SQL migration adds description column with IF NOT EXISTS', function() {
  assert(/ALTER TABLE calendar_events[\s\S]*?ADD COLUMN IF NOT EXISTS description/.test(sqlSrc),
    'SQL must add description column idempotently');
});

test('S8.3b SQL migration creates backup table before altering', function() {
  assert(/CREATE TABLE calendar_events_backup_s8_20260422/.test(sqlSrc),
    'must create dated backup table before schema change');
});

test('S8.4 Add-event form has description/agenda textarea', function() {
  assert(/<textarea[^>]*value=\{f\.description/.test(calSrc),
    'form must have a textarea bound to f.description');
  assert(/Description \/ Agenda/.test(calSrc),
    'form must label the field "Description / Agenda"');
});

// ----- 5-6. Description rendered in UI -----
test('S8.5 Day-view event row shows description when present', function() {
  // Look for the 📋 prefix inside a conditional on ev.description in a list context
  assert(/ev\.description && \([\s\S]*?📋/.test(calSrc),
    'day-view must conditionally render description with 📋 prefix');
});

test('S8.6 Notes modal shows agenda banner when description exists', function() {
  assert(/notesEvent\.description && \([\s\S]*?Agenda:/.test(calSrc),
    'modal must render agenda block with "Agenda:" label when description present');
});

// ----- 7. Insert payload carries description -----
test('S8.7 handleAddEvent payload includes description', function() {
  // Match within the payload object literal
  assert(/const payload = \{[\s\S]*?description: f\.description \|\| null/.test(calSrc),
    'insert payload must carry description, defaulting to null');
});

// ----- 8-10. Dashboard reminders split -----
test('S8.8 Dashboard splits reminders into urgentReminders and normalReminders', function() {
  assert(/urgentReminders = reminders\.filter/.test(dashSrc),
    'urgent bucket filter must exist');
  assert(/normalReminders = reminders\.filter/.test(dashSrc),
    'normal bucket filter must exist');
});

test('S8.8b Urgent section labeled with 🔴 Urgent and count', function() {
  assert(/🔴 Urgent \(\{urgentAll\.length\}/.test(dashSrc),
    'urgent header must show count');
});

test('S8.8c Normal section labeled with count', function() {
  assert(/Normal \(\{normalReminders\.length\}/.test(dashSrc),
    'normal header must show count');
});

test('S8.9 Today-due items get animate-pulse blink class (not overdue)', function() {
  assert(/today && !overdue \? 'animate-pulse' : ''/.test(dashSrc),
    'animate-pulse must fire only for today && !overdue');
});

test('S8.9b Overdue items DO NOT blink (they use static red styling)', function() {
  // The conditional explicitly excludes overdue from the blink — grep for the negative condition
  var blinkLine = dashSrc.match(/const blinkClass = [^;]*;/);
  assert(blinkLine, 'blinkClass definition must exist');
  assert(/!overdue/.test(blinkLine[0]), 'blinkClass must require !overdue');
});

test('S8.10 Today-due tickets fold into urgent section', function() {
  assert(/todayDueTickets = \[\.\.\.myTickets, \.\.\.ticketsICreated\]/.test(dashSrc),
    'must combine both my tickets and tickets I assigned');
  assert(/\.filter\(t => t\.due_date === todayStr\)/.test(dashSrc),
    'must filter to exactly today (not overdue — those are in top banner)');
});

test('S8.10b Urgent array merges reminders + todayDueTickets', function() {
  assert(/const urgentAll = \[\.\.\.urgentReminders\.map[\s\S]*?todayDueTickets\]/.test(dashSrc),
    'urgentAll must merge both sources');
});

// ----- Sanity: did we accidentally break anything? -----
test('S8.sanity.1 Calendar still exports default component', function() {
  assert(/export default function CalendarTab/.test(calSrc),
    'CalendarTab default export preserved');
});

test('S8.sanity.2 page.jsx still has handleSignOut (manual logout path unchanged)', function() {
  assert(/const handleSignOut = async/.test(pageSrc),
    'manual sign-out preserved alongside auto-logout change');
});

test('S8.sanity.3 _checkInWithNotesLegacy still absent (dead code stayed removed)', function() {
  assert(!/_checkInWithNotesLegacy/.test(calSrc),
    'fossil function must stay deleted');
});

console.log('');
console.log('───────────────────────────────────');
console.log('SESSION 8 REGRESSION RESULTS');
console.log('───────────────────────────────────');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) { console.log('\n❌ FAILURES'); process.exit(1); }
else console.log('\n✅ All session 8 regression tests passed');
