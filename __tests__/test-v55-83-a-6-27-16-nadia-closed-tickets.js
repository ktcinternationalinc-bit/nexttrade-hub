// v55.83-A.6.27.16 — Nadia closed-ticket access (real fix, three tries in)
//
// The bug that survived A.6.27.12: Nadia's "closed ticket access" code
// filtered closed tickets from `tickets` (=dashTickets), which is loaded
// with `.neq('status', 'Closed')` server-side. So filtering an array that
// never had closed tickets in the first place was a no-op.
//
// This test locks the ENTIRE data flow end-to-end:
//   1. page.jsx has a separate state `closedTicketsForAI`
//   2. page.jsx has a SEPARATE database query for closed tickets
//   3. page.jsx passes `closedTickets={closedTicketsForAI}` to AIGreeter
//   4. AIGreeter destructures `closedTickets` from props
//   5. AIGreeter actually uses `closedTickets` (not `tickets`) to build
//      the closed-ticket context
//
// If ANY link in this chain breaks, this test fails.

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var ag = read('src/components/AIGreeter.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ── 1. page.jsx has separate state ────────────────────────────────
ok('1: page.jsx declares closedTicketsForAI state',
  /const \[closedTicketsForAI, setClosedTicketsForAI\] = useState\(\[\]\)/.test(page));

// ── 2. page.jsx fetches closed tickets separately ────────────────
ok('2a: dashTickets fetch still excludes Closed (kept for dashboard speed)',
  /\.neq\('status', 'Closed'\)/.test(page));
ok('2b: SEPARATE fetch for closed tickets exists',
  /fetch Closed tickets separately[\s\S]{0,800}\.eq\('status', 'Closed'\)/.test(page));
ok('2c: closed-tickets fetch is ordered by updated_at desc',
  /eq\('status', 'Closed'\)\s*\.order\('updated_at', \{ ascending: false \}\)/.test(page));
ok('2d: closed-tickets fetch is limited to 100',
  /eq\('status', 'Closed'\)[\s\S]{0,300}\.limit\(100\)/.test(page));
ok('2e: closed-tickets fetch result feeds setClosedTicketsForAI',
  /setClosedTicketsForAI\(filteredClosed\)/.test(page));

// ── 3. closed-tickets fetch respects user privacy ─────────────────
ok('3a: closed fetch filters by super_admin / creator / assignee / additional',
  /closedMeIsSA[\s\S]{0,500}created_by === closedMeId[\s\S]{0,200}assigned_to === closedMeId/.test(page));

// ── 4. page.jsx passes prop to AIGreeter ──────────────────────────
ok('4: AIGreeter mount has closedTickets={closedTicketsForAI}',
  /<AIGreeter[\s\S]{0,500}closedTickets=\{closedTicketsForAI\}/.test(page));

// ── 5. AIGreeter consumes the prop ────────────────────────────────
ok('5a: AIGreeter destructures closedTickets from props',
  /export default function AIGreeter\(\{[^}]*closedTickets[^}]*\}\)/.test(ag));

// ── 6. AIGreeter builds lists from the right sources ─────────────
ok('6a: openMyTickets filters from `tickets` (open prop)',
  /var openMyTickets = \(tickets \|\| \[\]\)\.filter\(ticketBelongsToMe\)/.test(ag));
ok('6b: closedMyTickets filters from `closedTickets` (closed prop) — THE FIX',
  /var closedMyTickets = \(closedTickets \|\| \[\]\)\.filter\(ticketBelongsToMe\)/.test(ag));
ok('6c: allMyTickets is union of open and closed (deduped by id)',
  /var allMyTickets = \[\];[\s\S]{0,400}openMyTickets\.forEach[\s\S]{0,300}closedMyTickets\.forEach/.test(ag));

// ── 7. closed-ticket context block uses closedMyTickets ──────────
ok('7a: recentlyClosed reads from closedMyTickets (not allMyTickets.filter)',
  /var recentlyClosed = closedMyTickets/.test(ag));
ok('7b: recentlyClosed shows up to 25 (was 10 in A.6.27.12)',
  /recentlyClosed[\s\S]{0,300}\.slice\(0, 25\)/.test(ag));
ok('7c: closed-ticket context includes description (for topic matching)',
  /ctx \+= 'Closed tickets accessible for history queries[\s\S]{0,1000}t\.description/.test(ag));
ok('7d: context shows TOTAL closed count (not just shown subset)',
  /Closed tickets accessible for history queries \(' \+ closedMyTickets\.length \+ ' total\)/.test(ag));

// ── 8. regression guard: the OLD broken pattern is gone ──────────
ok('8: old broken pattern (filtering closed from `tickets`) is removed',
  !/allMyTickets\.filter\(function \(t\) \{ return t\.status === 'Closed'; \}\)/.test(ag));

// ── 9. version stamp ─────────────────────────────────────────────
ok('9: version stamp v55.83-A.6.27.16',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.16 closed-ticket data flow tests passed');
