// v55.83-A.6.22 (Max May 14 2026) — Dashboard data fix:
//
//   1. The "Overdue" priority card was empty because dashTickets had a
//      limit(200) ORDER BY created_at DESC. Old overdue tickets fall outside
//      that window when the team has 200+ active tickets. Now loads ALL
//      non-closed tickets — no limit.
//
//   2. Removed the old duplicate ticket sections from the dashboard per
//      Max's explicit ask: "Remove the older duplicate ticket sections from
//      the dashboard UI." These were:
//        - page.jsx ~8524: "Overdue Tickets" stat card in the stats grid
//        - page.jsx ~9081-9416: entire "Section: Tickets" CollapsibleSection
//          cluster (Newly Assigned / Overdue / Recently Updated / All My Open)
//        - PersonalDashboard.jsx ~245: "My Tickets" small stat card
//        - PersonalDashboard.jsx ~253: full "🎫 My Tickets ({n})" list
//
//   3. The new DashboardPrioritySections cluster (added in A.6.18, fixed in
//      A.6.20) is now the SOLE ticket priority surface on the dashboard.

var fs = require('fs');
var path = require('path');
var page = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'page.jsx'), 'utf8');
var pd = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'PersonalDashboard.jsx'), 'utf8');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// === 1. The 200-row limit is gone ===
ok('1a: dashTickets query no longer uses limit(200)',
  !/from\('tickets'\)\.select\('\*'\)\.order\('created_at', \{ ascending: false \}\)\.limit\(200\)/.test(page));
ok('1b: dashTickets query filters out Closed at the server',
  /from\('tickets'\)[\s\S]{0,200}\.neq\('status', 'Closed'\)/.test(page));
ok('1c: explanatory comment about why the limit was removed',
  /v55\.83-A\.6\.22[\s\S]{0,500}REMOVED limit\(200\)/.test(page));

// === 2. Old "Section: Tickets" cluster removed ===
ok('2a: old "Section: Tickets" header is gone',
  !/\{\/\* Section: Tickets \*\/\}\s*<div style=\{\{ display: 'flex', alignItems: 'center', gap: 10, margin: '20px 0 12px' \}\}>\s*<div style=\{\{ width: 3, height: 20, borderRadius: 2, background: '#8b5cf6' \}\} \/>/.test(page));
ok('2b: old CollapsibleSection id="overdue" is gone',
  !/<CollapsibleSection id="overdue" icon="🚨" title="Overdue Tickets"/.test(page));
ok('2c: old CollapsibleSection id="newAssign" is gone',
  !/<CollapsibleSection id="newAssign" icon="✨" title="Newly Assigned to You"/.test(page));
ok('2d: old CollapsibleSection id="allOpen" is gone',
  !/<CollapsibleSection id="allOpen" icon="📋" title="All My Open Tickets"/.test(page));
ok('2e: old CollapsibleSection id="recentUpd" is gone',
  !/<CollapsibleSection id="recentUpd" icon="💬" title="Recently Updated"/.test(page));
ok('2f: explanatory comment about why the section was removed',
  /v55\.83-A\.6\.22[\s\S]{0,800}REMOVED the old "Section: Tickets"/.test(page));

// === 3. Old "Overdue Tickets" stat card removed ===
ok('3a: "Overdue Tickets" stat card label gone from cards array',
  !/label: 'Overdue Tickets', value: overdueTickets/.test(page));
ok('3b: comment about why the stat card was removed',
  /v55\.83-A\.6\.22[\s\S]{0,500}REMOVED "Overdue Tickets" stat card/.test(page));

// === 4. PersonalDashboard "My Tickets" removed ===
ok('4a: PersonalDashboard "My Tickets" small stat card gone',
  !/<div className="text-xs text-slate-700">My Tickets<\/div>/.test(pd));
ok('4b: PersonalDashboard "🎫 My Tickets" full list section gone',
  !/🎫 My Tickets \(\{myTickets\.length\}\)/.test(pd));
ok('4c: "Assigned by Me" stat card kept (different surface — delegation tracking)',
  /Assigned by Me/.test(pd));
ok('4d: "Tickets I Assigned" full list kept (different surface)',
  /📤 Tickets I Assigned/.test(pd));
ok('4e: comment about why these were removed',
  /v55\.83-A\.6\.22[\s\S]{0,500}REMOVED "My Tickets"/.test(pd));

// === 5. The new priority sections are STILL there ===
ok('5a: DashboardPrioritySections still imported',
  /import DashboardPrioritySections/.test(page));
ok('5b: DashboardPrioritySections still rendered',
  /<DashboardPrioritySections/.test(page));
ok('5c: DashboardTicketModalOverlay still rendered',
  /<DashboardTicketModalOverlay/.test(page));
ok('5d: ackDashboardTicket handler intact',
  /const ackDashboardTicket = async/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.22 dashboard data fix tests passed');
