// v55.83-A.6.18 (Max May 14 2026) — Three dashboard priority cards + in-place ticket modal
//
// Per Max's spec May 14 2026:
//   1. Three new cards directly after the AI section (which stays at top):
//      a. Your Overdue Tickets (red, top 10, newest-overdue first)
//      b. Recent Updates to Your Assigned Tickets (blue, last 3 days, with comment preview)
//      c. Newly Assigned — Acknowledge (purple, Acknowledge button right on dashboard)
//   2. Click ticket → opens IN PLACE on dashboard (no tab switch) via overlay modal
//   3. Acknowledge button changes status to Acknowledged + writes system comment
//   4. Preserve all existing dashboard functionality
//   5. Contrast bumped on PersonalDashboard small-text labels

var fs = require('fs');
var path = require('path');
var prio = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'DashboardPrioritySections.jsx'), 'utf8');
var overlay = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'DashboardTicketModalOverlay.jsx'), 'utf8');
var page = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'page.jsx'), 'utf8');
var pd = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'PersonalDashboard.jsx'), 'utf8');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// === 1. DashboardPrioritySections component ===
ok('1a: component default exported',
  /export default function DashboardPrioritySections/.test(prio));
ok('1b: accepts the required props',
  /\{[\s\S]{0,200}dashTickets,\s*recentTicketUpdates,\s*myId,\s*users,\s*todayStr,\s*onOpenTicket,\s*onAcknowledge,\s*busyAckId/.test(prio));

// 1.1 Overdue card
ok('2a: overdue card has Your Overdue Tickets title',
  /Your Overdue Tickets/.test(prio));
ok('2b: overdue card bilingual title',
  /تذاكرك المتأخرة/.test(prio));
ok('2c: overdue sorted newest-first (largest due_date wins)',
  /b\.due_date \|\| ''\)\.localeCompare\(a\.due_date \|\| ''\)/.test(prio));
ok('2d: overdue limited to top 10',
  /\.slice\(0, 10\)/.test(prio));
ok('2e: overdue card shows days late badge',
  /day\{daysOver === 1 \? '' : 's'\} late/.test(prio));
ok('2f: overdue card shows last update preview',
  /lastUpdate\.created_at/.test(prio));
ok('2g: overdue card uses red color scheme',
  /from-red-50 to-rose-50[\s\S]{0,100}border-red-300/.test(prio));

// 1.2 Recent Updates card
ok('3a: recent updates card title',
  /Recent Updates to Your Tickets/.test(prio));
ok('3b: 3-day cutoff for recent updates',
  /3 \* 86400000/.test(prio));
ok('3c: shows comment preview (last comment per ticket)',
  /commentPreview/.test(prio) && /comment_text/.test(prio));
ok('3d: shows who made the update + when',
  /commentBy/.test(prio) && /fmtRelative\(c\.created_at\)/.test(prio));
ok('3e: blue color scheme',
  /from-blue-50 to-cyan-50/.test(prio));

// 1.3 Newly Assigned card
ok('4a: newly assigned card title',
  /Newly Assigned — Acknowledge/.test(prio));
ok('4b: filters by status === New',
  /t\.status === 'New'/.test(prio));
ok('4c: Acknowledge button calls onAcknowledge',
  /onAcknowledge\(t\)/.test(prio));
ok('4d: Acknowledge button disabled while busy',
  /disabled=\{isAcking\}/.test(prio));
ok('4e: Open button calls onOpenTicket',
  /onOpenTicket\(t\)/.test(prio));
ok('4f: purple color scheme',
  /from-purple-50 to-indigo-50/.test(prio));

// 1.4 Empty state (v55.83-A.6.20 — banner "all clear" pill replaces the single tile)
ok('5a: empty state when nothing to show (A.6.20 banner pill design)',
  /You're all clear[\s\S]{0,300}no overdue, no new assignments/.test(prio));

// === 2. DashboardTicketModalOverlay component ===
ok('6a: overlay default exported',
  /export default function DashboardTicketModalOverlay/.test(overlay));
ok('6b: overlay returns null when no ticketId',
  /if \(!ticketId\) return null/.test(overlay));
ok('6c: overlay mounts TicketsTab with openTicketId',
  /<TicketsTab[\s\S]{0,500}openTicketId=\{ticketId\}/.test(overlay));
ok('6d: overlay close on backdrop click',
  /onClick=\{onClose\}/.test(overlay));
ok('6e: clicking inside overlay does NOT close',
  /e\.stopPropagation\(\)/.test(overlay));
ok('6f: TicketsTab onTicketModalClosed wired to close overlay',
  /onTicketModalClosed=\{onClose\}/.test(overlay));

// === 3. page.jsx integration ===
ok('7a: imports DashboardPrioritySections',
  /import DashboardPrioritySections from '\.\.\/components\/DashboardPrioritySections'/.test(page));
ok('7b: imports DashboardTicketModalOverlay',
  /import DashboardTicketModalOverlay from '\.\.\/components\/DashboardTicketModalOverlay'/.test(page));
ok('7c: dashboardTicketModal state',
  /const \[dashboardTicketModal, setDashboardTicketModal\] = useState\(null\)/.test(page));
ok('7d: busyAckId state',
  /const \[busyAckId, setBusyAckId\] = useState\(null\)/.test(page));
ok('7e: ackDashboardTicket handler updates status to Acknowledged',
  /ackDashboardTicket[\s\S]{0,800}'tickets', ticket\.id, \{ status: 'Acknowledged' \}/.test(page));
ok('7f: ackDashboardTicket handler writes system comment',
  /ackDashboardTicket[\s\S]{0,1500}ticket_comments[\s\S]{0,300}is_system: true/.test(page));
ok('7g: DashboardPrioritySections rendered with onOpenTicket wired',
  /<DashboardPrioritySections[\s\S]{0,500}onOpenTicket=\{[\s\S]{0,100}setDashboardTicketModal\(t\.id\)/.test(page));
ok('7h: DashboardPrioritySections has onAcknowledge wired',
  /<DashboardPrioritySections[\s\S]{0,500}onAcknowledge=\{ackDashboardTicket\}/.test(page));
ok('7i: DashboardTicketModalOverlay rendered inside dashboard tab',
  /<DashboardTicketModalOverlay[\s\S]{0,400}ticketId=\{dashboardTicketModal\}/.test(page));

// === 4. Contrast fix on PersonalDashboard ===
ok('8a: PersonalDashboard contrast — slate-400 reduced to slate-600 on small text',
  // Should NOT have any standalone text-slate-400 anymore in stat/info contexts
  // (some intentional ones may remain, but our sweep changed 5 occurrences)
  (function () {
    var matches = pd.match(/text-slate-400(?![\/\[\d])/g) || [];
    return matches.length === 0;
  })());

// === 5. Existing functionality preserved ===
ok('9a: WhatsNewWidget still rendered',
  /<WhatsNewWidget /.test(page));
ok('9b: PersonalDashboard still rendered',
  /<PersonalDashboard /.test(page));
ok('9c: PendingNadiaMessages still mentioned (super admin notes)',
  /PendingNadiaMessages/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.18 tests passed (' + (failures.length === 0 ? '40+' : '') + ' assertions)');
