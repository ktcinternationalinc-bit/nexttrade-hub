// v55.83-A.6.20 (Max May 14 2026) — Dashboard fix:
//   1. Three priority cards ALWAYS render — no more "all empty = invisible" trap.
//      Each card has its own visible empty state. A "Daily Priorities" header
//      banner sits at the very top so the dashboard ALWAYS visibly changes.
//   2. Dashboard ticket modal mounts TicketsTab with detailOnly=true, which
//      suppresses the list view + shows a loading state until `sel` populates.
//      Fixes the "click ticket → modal shows tickets list, not the ticket" bug.
//   3. recentTicketUpdates pulls 300 comments instead of 100 so super admins
//      can actually see comments on their own tickets in 7-day window.

var fs = require('fs');
var path = require('path');
var prio = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'DashboardPrioritySections.jsx'), 'utf8');
var overlay = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'DashboardTicketModalOverlay.jsx'), 'utf8');
var ticketsTab = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'TicketsTab.jsx'), 'utf8');
var page = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'page.jsx'), 'utf8');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// === 1. Cards always render ===
ok('1a: NO conditional wrapping overdue card with > 0 check',
  !/\{overdue\.length > 0 && \(\s*<div/.test(prio));
ok('1b: NO conditional wrapping recent updates card',
  !/\{recentUpdates\.length > 0 && \(\s*<div/.test(prio));
ok('1c: NO conditional wrapping newly assigned card',
  !/\{newlyAssigned\.length > 0 && \(\s*<div/.test(prio));

// === 2. Each card has its own empty state ===
ok('2a: overdue card empty state',
  /overdue\.length === 0 \?[\s\S]{0,200}No overdue tickets/.test(prio));
ok('2b: recent updates empty state',
  /recentUpdates\.length === 0 \?[\s\S]{0,200}No recent updates/.test(prio));
ok('2c: newly assigned empty state',
  /newlyAssigned\.length === 0 \?[\s\S]{0,200}No new tickets to acknowledge/.test(prio));

// === 3. Daily Priorities banner always visible ===
ok('3a: Daily Priorities header banner exists',
  /Your Daily Priorities/.test(prio));
ok('3b: banner shows count badges color-coded by category',
  /\{overdue\.length\} overdue[\s\S]{0,200}\{recentUpdates\.length\} updates[\s\S]{0,200}\{newlyAssigned\.length\} new/.test(prio));
ok('3c: banner shows "all clear" pill when everything is empty',
  /allEmpty[\s\S]{0,500}You're all clear/.test(prio));

// === 4. TicketsTab detailOnly mode ===
ok('4a: TicketsTab signature accepts detailOnly prop',
  /TicketsTab\(\{[\s\S]{0,300}detailOnly\s*\}\)/.test(ticketsTab));
ok('4b: detailOnly + no sel short-circuits to loading state',
  /if \(detailOnly && !sel\)[\s\S]{0,200}Loading ticket/.test(ticketsTab));
ok('4c: list view never rendered when detailOnly + no sel',
  /detailOnly && !sel[\s\S]{0,400}return \(/.test(ticketsTab));

// === 5. Overlay passes detailOnly=true ===
ok('5a: overlay passes detailOnly={true} to TicketsTab',
  /<TicketsTab[\s\S]{0,500}detailOnly=\{true\}/.test(overlay));

// === 6. page.jsx — comment fetch limit bumped to 300 ===
ok('6a: ticket_comments limit bumped to 300 (from 100)',
  /\.limit\(300\)/.test(page) && /v55\.83-A\.6\.20[\s\S]{0,400}bumped limit/.test(page));

// === 7. Existing wiring preserved ===
ok('7a: DashboardPrioritySections still rendered on dashboard',
  /<DashboardPrioritySections/.test(page));
ok('7b: DashboardTicketModalOverlay still wired',
  /<DashboardTicketModalOverlay/.test(page));
ok('7c: ackDashboardTicket handler still exists',
  /const ackDashboardTicket = async/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.20 tests passed');
