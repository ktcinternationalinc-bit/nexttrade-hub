// ============================================================
// Session 14 (Apr 22 2026) — Dashboard ticket UI redesign + Proactive Watcher
//
// Two pieces covered:
//  Part A — Dashboard ticket card cleanup:
//    1. Left-border priority color on every ticket card (red/amber/yellow/grey)
//    2. Title is visual star, ticket# becomes a small tag
//    3. Pill-style status badges (replacing inline cramped text)
//    4. Explicit "N DAYS OVERDUE" / "DUE TODAY" / "DUE date" variants
//    5. Avatar circles on last-update blocks (replacing purple text)
//    6. Section headers have left accent bar for chapter-like feel
//
//  Part B — Proactive Watcher uses briefing engine:
//    1. Watcher imports briefingEngine
//    2. loadUserBusinessContext helper queries the 6 tables concurrently
//    3. briefingItemToAlert maps briefing items into ai_alerts rows
//    4. Both scanners run per user (original alerts + briefing alerts)
//    5. Briefing alerts get type prefix 'briefing_' so they're distinguishable
//    6. /api/ask greeter surfaces unacked watcher alerts in greeting
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

var page = fs.readFileSync(path.join(REPO, 'src/app/page.jsx'), 'utf8');
var watchRoute = fs.readFileSync(path.join(REPO, 'src/app/api/nadia/watch/route.js'), 'utf8');
var askRoute = fs.readFileSync(path.join(REPO, 'src/app/api/ask/route.js'), 'utf8');

// ===== PART A: DASHBOARD TICKET UI =====

test('S14.UI1 TicketCard has priority-colored left border', function() {
  assert(/const priBorderColor = \(p\) =>/.test(page),
    'priBorderColor helper must be defined');
  assert(/borderLeft: '3px solid ' \+ leftBorderColor/.test(page),
    'TicketCard must render a 3px left border in the computed priority color');
});

test('S14.UI2 priBorderColor maps priorities to distinct colors', function() {
  // urgent/high → red, medium → amber, low → grey
  assert(/p === 'urgent' \|\| p === 'high'.*return '#ef4444'/.test(page),
    'urgent/high priority should be red (#ef4444)');
  assert(/p === 'medium'.*return '#f59e0b'/.test(page),
    'medium priority should be amber (#f59e0b)');
  assert(/p === 'low'.*return '#64748b'/.test(page),
    'low priority should be grey (#64748b)');
});

test('S14.UI3 Overdue takes precedence over priority color', function() {
  // Overdue should force red regardless of priority
  assert(/daysOverdue > 0 \? '#ef4444' :/.test(page),
    'overdue tickets always get the red border, even if their priority is low');
});

test('S14.UI4 Due-today takes amber (urgent but not overdue)', function() {
  assert(/dueToday \? '#f59e0b' : priBorderColor/.test(page),
    'due-today tickets get amber border — sits between overdue red and normal priority color');
});

test('S14.UI5 Title is visually prominent, ticket# is a small tag', function() {
  // The title now has fontSize 14 and fontWeight 700; ticket# dropped to fontSize 10 fontWeight 700 color #64748b (subtle grey)
  var titleMatch = page.match(/\{t\.title\}[\s\S]{0,100}/);
  assert(/fontSize: 14, fontWeight: 700, color: '#f1f5f9'/.test(page),
    'title must be fontSize 14, fontWeight 700, in bright f1f5f9 color');
  // Ticket number should be subtle monospace tag
  assert(/fontSize: 10, fontWeight: 700, color: '#64748b', fontFamily: 'monospace'[\s\S]{0,80}\{t\.ticket_number\}/.test(page),
    'ticket number must be small subdued monospace tag');
});

test('S14.UI6 Status renders as pill, not inline cramped text', function() {
  assert(/const statusPillStyle = \(status\) =>/.test(page),
    'statusPillStyle helper must exist');
  assert(/<span style=\{statusPillStyle\(t\.status\)\}/.test(page),
    'TicketCard must render status using the pill style');
  // Verify pill has border (distinguishes from previous background-only badges)
  assert(/border: '1px solid ' \+ s\.border/.test(page),
    'status pills must have a 1px border for clearer edge definition');
});

test('S14.UI7 Overdue shows "N DAYS OVERDUE" not cryptic icon', function() {
  assert(/daysOverdue === 1 \? '1 DAY OVERDUE' : daysOverdue \+ ' DAYS OVERDUE'/.test(page),
    'overdue label must spell out the exact number of days, pluralizing correctly');
  // And NOT the old cryptic "⚠ OVERDUE"
  assert(!/⚠ OVERDUE/.test(page), 'old cryptic warning icon must be removed');
});

test('S14.UI8 Due-today has its own explicit badge', function() {
  assert(/DUE TODAY/.test(page),
    'due-today tickets must have an explicit amber "DUE TODAY" badge');
});

test('S14.UI9 Last-update block uses avatar circle, not purple text', function() {
  assert(/const initialsOf = \(name\) =>/.test(page),
    'initialsOf helper must exist');
  // The last-update block must render the avatar with initials
  assert(/\{initialsOf\(updaterName\)\}/.test(page),
    'TicketCard last-update block must render initials in a circle avatar');
});

test('S14.UI10 Section header has left accent bar', function() {
  assert(/sectionHeaderStyle = \(color, bgColor\) => \(\{[\s\S]*?borderLeft: '3px solid ' \+ color/.test(page),
    'section headers must have a 3px left accent bar in their theme color');
});

test('S14.UI11 Section label is UPPERCASE for chapter-like feel', function() {
  assert(/textTransform: 'uppercase'/.test(page) && /letterSpacing: '0\.04em'/.test(page),
    'section labels should be uppercase with tracked letter-spacing');
});

test('S14.UI12 UpdateCard also uses avatar circle and cleaner layout', function() {
  // The UpdateCard must use the same initialsOf helper and the avatar pattern
  var upCardMatch = page.match(/const UpdateCard = \(\{ c \}\) => \{[\s\S]*?const commenter[\s\S]*?return \(/);
  assert(upCardMatch, 'UpdateCard definition found');
  // It uses the same borderLeft 3px accent pattern now
  var fullUpdate = page.match(/const UpdateCard = \(\{ c \}\)[\s\S]{0,2500}/);
  assert(fullUpdate && /borderLeft: '3px solid #a78bfa'/.test(fullUpdate[0]),
    'UpdateCard should use 3px purple left border to match ticket card visual language');
  assert(fullUpdate && /c\.is_system \? '🤖' : initialsOf\(commenter\?\.name\)/.test(fullUpdate[0]),
    'UpdateCard must use initialsOf for the commenter avatar');
});

// ===== PART B: PROACTIVE WATCHER + BRIEFING ENGINE =====

test('S14.W1 Watcher imports briefing engine', function() {
  assert(/import \* as briefingEngine from '\.\.\/\.\.\/\.\.\/\.\.\/lib\/briefing-engine'/.test(watchRoute),
    'nadia/watch route must import briefingEngine');
});

test('S14.W2 loadUserBusinessContext loads 6 tables concurrently', function() {
  assert(/async function loadUserBusinessContext\(userId\)/.test(watchRoute),
    'loadUserBusinessContext helper must exist');
  assert(/await Promise\.all\(\[[\s\S]{0,500}tickets[\s\S]*?invoices[\s\S]*?checks[\s\S]*?calendar_events[\s\S]*?follow_ups[\s\S]*?customers/.test(watchRoute),
    'must query all 6 tables concurrently with Promise.all');
});

test('S14.W3 briefingItemToAlert maps briefing items to ai_alerts row shape', function() {
  assert(/function briefingItemToAlert\(item, userId\)/.test(watchRoute),
    'briefingItemToAlert helper must exist');
  assert(/alert_type: 'briefing_' \+ \(item\.kind \|\| 'generic'\)/.test(watchRoute),
    'mapped alerts must prefix alert_type with "briefing_"');
  // Required fields
  ['target_user_id', 'severity', 'subject', 'body', 'recommendation'].forEach(function(f) {
    assert(new RegExp(f + ':').test(watchRoute),
      'briefingItemToAlert must set field: ' + f);
  });
});

test('S14.W4 Severity mapping: critical → critical, high → high, else → medium', function() {
  assert(/item\.urgency === 'critical' \? 'critical' : item\.urgency === 'high' \? 'high' : 'medium'/.test(watchRoute),
    'severity must be a 3-way map from urgency');
});

test('S14.W5 Both scanners run in runWatch (decision engine + briefing)', function() {
  assert(/SCAN 1/.test(watchRoute) && /SCAN 2/.test(watchRoute),
    'both scanners must be clearly labeled SCAN 1 and SCAN 2');
  assert(/briefingEngine\.buildBriefing\(ctx\)/.test(watchRoute),
    'must call buildBriefing on each user\'s context');
});

test('S14.W6 Summary counts briefing_alerts_written separately', function() {
  assert(/briefing_alerts_written/.test(watchRoute),
    'summary object must track briefing_alerts_written separately from alerts_written for observability');
});

test('S14.W7 Briefing scan errors are non-fatal (continue to next user)', function() {
  // Errors in SCAN 2 should be captured in summary.errors but not break SCAN 1 results
  assert(/summary\.errors\.push\('briefing[^']*' \+ uid/.test(watchRoute),
    'briefing errors must be recorded per-user in summary.errors');
});

// ===== PART B-2: /api/ask SURFACES ALERTS =====

test('S14.A1 /api/ask loads ai_alerts for greeting context', function() {
  assert(/watcherAlerts = \[\]/.test(askRoute),
    'askRoute must declare watcherAlerts var');
  assert(/supabase\.from\('ai_alerts'\)[\s\S]{0,400}\.eq\('target_user_id', userId\)/.test(askRoute),
    'askRoute must query ai_alerts filtered to the current user');
});

test('S14.A2 Only UNACKNOWLEDGED alerts are surfaced', function() {
  assert(/\.or\('acknowledged\.is\.null,acknowledged\.eq\.false'\)/.test(askRoute),
    'must filter to unacknowledged only — acked alerts are old news');
});

test('S14.A3 Alerts only run on isFirstGreeting (not every turn)', function() {
  // The ai_alerts block should be inside the isFirstGreeting guard
  var alertsBlock = askRoute.match(/Recent alerts from the proactive watcher[\s\S]{0,50}|PROACTIVE WATCHER[\s\S]{0,500}/);
  // Easier: check the guard wraps the code
  assert(/if \(isFirstGreeting && userId\) \{[\s\S]{0,500}ai_alerts/.test(askRoute),
    'ai_alerts query must be inside if (isFirstGreeting && userId)');
});

test('S14.A4 System prompt tells Claude to use alerts naturally in greeting', function() {
  assert(/RECENT ALERTS FROM THE PROACTIVE WATCHER/.test(askRoute),
    'system prompt must label the alerts section clearly');
  assert(/Mention only the 1-2 most important ones naturally/.test(askRoute),
    'Claude must be instructed to surface at most 1-2, not all, so greeting stays natural');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
