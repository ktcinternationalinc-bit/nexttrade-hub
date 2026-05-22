// v55.83-A.6.13 (Max May 14 2026) — Three fixes:
//   1. Login streak now requires CONSECUTIVE days (no more 2-day-gap leniency)
//   2. Contradiction guard — never show "haven't logged in for N days" if
//      user logged in today (streak >= 1)
//   3. Dashboard ticket items are CLICKABLE and return to previous tab
//      when modal closes
//   4. LoginHistoryV2 has a third "Sessions" tab for raw forensic view
//   5. login-events warning banner moved into LoginHistoryV2

var fs = require('fs');
var path = require('path');
var page = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'page.jsx'), 'utf8');
var tickets = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'TicketsTab.jsx'), 'utf8');
var v2 = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'LoginHistoryV2.jsx'), 'utf8');
var admin = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'AdminTab.jsx'), 'utf8');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// 1. Strict streak — old "diff <= 2" pattern removed, new strict walk added
ok('1a: strict streak walks consecutive days only (no 2-day-gap fallback)',
  !/if \(diff <= 2\) streak\+\+; else break;/.test(page),
  'old lenient pattern must be removed');
ok('1b: new streak resets on any gap',
  /loginStreak = \(\(\) => \{[\s\S]{0,800}if \(dates\[i\] === cursor\)[\s\S]{0,400}break;/.test(page));

// 2. Contradiction guard — "haven't logged in" suppressed if logged in today
ok('2a: loggedInToday flag computed before showing streak vs absence',
  /const loggedInToday = \(lastLoginInfo \|\| \[\]\)\.some\(s => s\.date === todayStr\)/.test(page));
ok('2b: absence message only fires when NOT logged in today AND >= 3 days',
  /else if \(loggedInToday \|\| daysSinceLast === 0 \|\| daysSinceLast === 1\)/.test(page));

// 3. Dashboard ticket items pass {id, label} objects (not just strings)
ok('3a: criticalPriority items have id + label',
  /criticalPriority\.map\(t => \(\{ id: t\.id, label: t\.ticket_number \+ ' — ' \+ t\.title \}\)\)/.test(page));
ok('3b: overdueTickets items have id + label',
  /overdueTickets\.map\(t => \(\{ id: t\.id, label: t\.ticket_number \+ ' — ' \+ t\.title \}\)\)/.test(page));

// 4. Render handles both string (legacy) and {id,label} (clickable)
ok('4a: render detects object items',
  /if \(item && typeof item === 'object' && item\.id\)/.test(page));
ok('4b: button click sets returnToTabAfterTicket and switches tab',
  /setReturnToTabAfterTicket\(tab\);\s*setOpenTicketId\(item\.id\);\s*setTab\('tickets'\);/.test(page));

// 5. TicketsTab fires onTicketModalClosed when modal closes
ok('5a: TicketsTab accepts onTicketModalClosed prop',
  /onTicketModalClosed/.test(tickets));
ok('5b: useEffect fires callback when sel transitions to null',
  /prevSelRef\.current && !sel && typeof onTicketModalClosed === 'function'/.test(tickets));

// 6. page.jsx switches tab back when onTicketModalClosed fires
ok('6a: returnToTabAfterTicket state defined',
  /const \[returnToTabAfterTicket, setReturnToTabAfterTicket\] = useState\(null\)/.test(page));
ok('6b: onTicketModalClosed handler restores prior tab',
  /onTicketModalClosed=\{\(\) => \{[\s\S]{0,400}setReturnToTabAfterTicket\(null\);\s*setTab\(t\);/.test(page));

// 7. LoginHistoryV2 Sessions tab added
ok('7a: V2 has sessions viewMode',
  /viewMode === 'sessions'/.test(v2));
ok('7b: Sessions tab button bilingual',
  /🔬 Sessions \/ الجلسات/.test(v2));
ok('7c: SessionsView function defined and renders raw session log',
  /function SessionsView\(/.test(v2) && /AUTO TIMEOUT \/ تلقائي/.test(v2));

// 8. Warning banner moved into V2
ok('8a: V2 accepts loginSummaryWarning prop',
  /loginSummaryWarning,/.test(v2));
ok('8b: V2 renders warning banner when prop set',
  /loginSummaryWarning &&[\s\S]{0,200}Online status not working/.test(v2));
ok('8c: AdminTab passes loginSummaryWarning to V2',
  /loginSummaryWarning=\{loginSummaryWarning\}/.test(admin));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.13 tests passed');
