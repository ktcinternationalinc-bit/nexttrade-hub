// v55.83-A.6.25 (Max May 14 2026) — Self-load architecture
//
// Max's diagnostic insight, the right one this time: "the old sections show
// data while the new sections show zero" → the new component's data wiring,
// not the database, is broken.
//
// Fix: component now fetches its OWN tickets and comments inside a useEffect,
// using identical SQL to PersonalDashboard.jsx (the working surface). No more
// dependency on parent state (dashTickets, recentTicketUpdates) which could
// be empty/stale/fail-silently.

var fs = require('fs');
var path = require('path');
var dps = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'DashboardPrioritySections.jsx'), 'utf8');
var pd = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'PersonalDashboard.jsx'), 'utf8');
var page = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'page.jsx'), 'utf8');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// === 1. SELF-LOAD — component now owns its data ===
ok('1a: useEffect imported',
  /import \{[^}]*useEffect[^}]*\} from 'react'/.test(dps));
ok('1b: supabase imported directly into the component',
  /import \{ supabase \} from '\.\.\/lib\/supabase'/.test(dps));
ok('1c: local tickets state',
  /var \[tickets, setTickets\] = useState\(\[\]\)/.test(dps));
ok('1d: local comments state',
  /var \[comments, setComments\] = useState\(\[\]\)/.test(dps));
ok('1e: useEffect triggers load on myId change',
  /useEffect\(function \(\) \{[\s\S]{0,200}if \(!myId\) return;[\s\S]{0,2000}\}, \[myId\]\)/.test(dps));
ok('1f: load is cancelable on unmount',
  /var cancelled = false[\s\S]{0,2000}return function \(\) \{ cancelled = true; \}/.test(dps));

// === 2. SQL parity with PersonalDashboard ===
ok('2a: tickets query — same shape as PersonalDashboard (select * order by created_at DESC, no limit, no neq)',
  /from\('tickets'\)\s*\.select\('\*'\)\s*\.order\('created_at', \{ ascending: false \}\)/.test(dps)
  && !/from\('tickets'\)[^;]*\.neq\(/.test(dps)
  && !/from\('tickets'\)[^;]*\.limit\(/.test(dps));
ok('2b: comments query — same shape as page.jsx (7-day window, joins tickets, limit 300)',
  /from\('ticket_comments'\)[\s\S]{0,400}select\('\*, tickets\(id, ticket_number, title, status, priority, assigned_to, created_by, additional_assignees, is_private, private_to, is_confidential\)'\)[\s\S]{0,400}\.gte\('created_at',[\s\S]{0,100}\.limit\(300\)/.test(dps));

// === 3. Bucket filters use isMineByAssign (parity with PersonalDashboard) ===
ok('3a: isMineByAssign helper matches PersonalDashboard exactly',
  /function isMineByAssign\(t\) \{\s*return t\.assigned_to === myId \|\| parseExtras\(t\)\.indexOf\(myId\) >= 0;\s*\}/.test(dps));
ok('3b: myDirectTickets uses self-loaded `tickets`, not the prop',
  /myDirectTickets = useMemo\(function \(\) \{\s*return \(tickets \|\| \[\]\)\.filter/.test(dps));
ok('3c: iDelegatedTickets uses self-loaded `tickets`, not the prop',
  /iDelegatedTickets = useMemo\(function \(\) \{\s*return \(tickets \|\| \[\]\)\.filter/.test(dps));
ok('3d: useMemo deps reference self-loaded `tickets` not prop `dashTickets`',
  /\}, \[tickets, myId\]\)/.test(dps));

// === 4. Comments path uses self-loaded `comments` ===
ok('4a: pickLatestPerTicket reads from self-loaded `comments` state',
  /pickLatestPerTicket\(ticketBucket\)[\s\S]{0,200}\(comments \|\| \[\]\)\.forEach/.test(dps));
ok('4b: updatesMyDirect useMemo deps include self-loaded `comments`',
  /updatesMyDirect = useMemo[\s\S]{0,200}\[myDirectTickets, comments, threeDaysAgoIso\]/.test(dps));

// === 5. Props no longer drive state — they're ignored ===
ok('5a: dashTickets prop accepted but renamed _ignored to flag it',
  /dashTickets: _ignoredDashTickets/.test(dps));
ok('5b: recentTicketUpdates prop accepted but renamed _ignored',
  /recentTicketUpdates: _ignoredRecentTicketUpdates/.test(dps));

// === 6. Load state surfaced to user ===
ok('6a: spinner shown while !loaded',
  /if \(!loaded\)[\s\S]{0,300}Loading your priorities/.test(dps));
ok('6b: error shown if loadError',
  /if \(loadError\)[\s\S]{0,400}couldn't load tickets/.test(dps));
ok('6c: amber warning if myId not yet available',
  /if \(!myId\)[\s\S]{0,300}waiting for user profile/.test(dps));

// === 7. Click-to-open modal wiring unchanged ===
ok('7a: page.jsx still wires onOpenTicket via setDashboardTicketModal',
  /onOpenTicket=\{\(t\) => \{ setDashboardTicketModal\(t\.id\); \}\}/.test(page));
ok('7b: DashboardTicketModalOverlay still mounted',
  /<DashboardTicketModalOverlay/.test(page));

// === 8. Three cards × two sub-sections (per spec) ===
ok('8a: Overdue card has My Direct + I Delegated sub-sections',
  /Your Overdue Tickets[\s\S]{0,2000}📥 My Direct[\s\S]{0,2000}📤 I Delegated/.test(dps));
ok('8b: Recent Updates card has My Direct + I Delegated sub-sections',
  /Recent Updates \(Last 3 Days\)[\s\S]{0,2000}📥 My Direct[\s\S]{0,2000}📤 I Delegated/.test(dps));
ok('8c: Newly Assigned card has My Direct + I Delegated sub-sections',
  /Newly Assigned[\s\S]{0,3000}📥 My Direct — Acknowledge[\s\S]{0,3000}📤 I Delegated — Awaiting Acknowledgment/.test(dps));

// === 9. PersonalDashboard's working surface — confirm the SQL we're mirroring is in fact there ===
ok('9a: PersonalDashboard still uses identical tickets SQL (proof of mirror)',
  /supabase\.from\('tickets'\)\.select\('\*'\)\.order\('created_at', \{ ascending: false \}\)/.test(pd));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.25 self-load tests passed');
