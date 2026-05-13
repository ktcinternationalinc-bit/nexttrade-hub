// v55.82-Z QA REGRESSION — Senior-QA-engineer audit of ticketing privacy.
// After v55.82-Z shipped, I traced every code path that reads or writes
// tickets to verify private/confidential tickets are filtered correctly.
// 12 gaps identified — this suite verifies each fix.
var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) { console.log('✓ ' + label); }
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

var tickets   = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'TicketsTab.jsx'), 'utf8');
var admin     = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'AdminTab.jsx'), 'utf8');
var dashboard = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'PersonalDashboard.jsx'), 'utf8');
var hrReport  = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'HRReport.jsx'), 'utf8');
var askRoute  = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'api', 'ask', 'route.js'), 'utf8');
var pageJsx   = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'page.jsx'), 'utf8');

// =============================================================
// GAP 1 (HIGH) — AI briefing leaked private/confidential to non-super-admin
// =============================================================
console.log('\nGAP 1: AI briefing path');
ok('1a: briefing pulls privacy columns alongside ticket data',
  /from\('tickets'\)\.select\([^)]*is_private[^)]*private_to[^)]*is_confidential/.test(askRoute));
ok('1b: briefing filters tickets when viewer is NOT super admin',
  /if \(!gIsSuperAdmin\) \{[\s\S]{0,200}visibleTickets = rawTickets\.filter/.test(askRoute));
ok('1c: briefing visibility honors private (private_to === userId)',
  /if \(t\.is_private\) return t\.private_to === userId/.test(askRoute));
ok('1d: briefing visibility honors confidential (creator/assignee/additional_assignees)',
  /if \(t\.is_confidential\)[\s\S]{0,800}t\.created_by === userId[\s\S]{0,300}t\.assigned_to === userId/.test(askRoute));
ok('1e: buildBriefing receives the FILTERED visibleTickets, not raw',
  /buildBriefing\(\{[\s\S]{0,400}tickets: visibleTickets/.test(askRoute));

// =============================================================
// GAP 2 (HIGH) — AdminTab leaked all tickets to regular admins
// =============================================================
console.log('\nGAP 2: AdminTab privacy gate');
ok('2a: AdminTab computes visibleTickets via privacy filter',
  /const visibleTickets = useMemo\(\(\) => \{[\s\S]{0,200}if \(isSuperAdmin\) return tickets;/.test(admin));
ok('2b: non-super-admin in AdminTab cannot see private tickets',
  /visibleTickets[\s\S]{0,500}if \(t\.is_private\) return false;/.test(admin));
ok('2c: AdminTab confidential check includes additional_assignees',
  /visibleTickets[\s\S]{0,1000}t\.additional_assignees[\s\S]{0,500}extras\.indexOf\(myId\) >= 0/.test(admin));
ok('2d: filteredTickets now derives from visibleTickets (not raw tickets)',
  /filteredTickets = useMemo[\s\S]{0,100}let arr = visibleTickets/.test(admin));
ok('2e: scorecard "myTickets" uses visibleTickets',
  /const myTickets = visibleTickets\.filter\(t => t\.assigned_to === u\.id\)/.test(admin));
ok('2f: scorecard "createdT" uses visibleTickets',
  /const createdT = visibleTickets\.filter\(t => t\.created_by === u\.id\)/.test(admin));

// =============================================================
// GAP 3 (MED) — HRReport included private tickets in scoring
// =============================================================
console.log('\nGAP 3: HRReport privacy filter');
ok('3a: HRReport strips private tickets unless viewer is super_admin',
  /if \(!isSuperAdmin\) \{[\s\S]{0,500}visibleHRTickets = tickets\.filter\(function \(t\) \{ return !t\.is_private/.test(hrReport));
ok('3b: HRReport also strips comments tied to private tickets',
  /privateIds\[c\.ticket_id\]/.test(hrReport));

// =============================================================
// GAP 4+8 — additional_assignees membership was missing from "my tickets"
// =============================================================
console.log('\nGAP 4+8: additional_assignees inclusion');
ok('4a: PersonalDashboard isMineByAssign checks both assigned_to AND additional_assignees',
  /isMineByAssign = \(t\) => t\.assigned_to === myId \|\| parseExtras\(t\)\.indexOf\(myId\) >= 0/.test(dashboard));
ok('4b: PersonalDashboard myTickets uses isMineByAssign (not just assigned_to)',
  /const myTickets = \(tickets \|\| \)?\)?\.filter\(t => isMineByAssign\(t\)/.test(dashboard) ||
  /const myTickets = \(tickets \|\| \[\]\)\.filter\(t => isMineByAssign\(t\)/.test(dashboard));
ok('4c: PersonalDashboard parseExtras handles JSON string + array',
  /parseExtras = \(t\) => \{[\s\S]{0,400}JSON\.parse\(t\.additional_assignees\)/.test(dashboard));

// =============================================================
// GAP 11 — Dashboard activity feed (page.jsx) leaked comments via join
// =============================================================
console.log('\nGAP 11: Dashboard activity feed privacy');
ok('11a: ticket_comments join pulls privacy columns from joined tickets',
  /from\('ticket_comments'\)[\s\S]{0,500}is_private[\s\S]{0,200}is_confidential/.test(pageJsx));
ok('11b: comment activity feed filtered by joined-ticket visibility',
  // v55.83-A — pattern allows for super_admin bypass between the filter
  // declaration and the privacy checks.
  /filteredComments = \(comments \|\| \[\]\)\.filter\(function \(c\)[\s\S]{0,800}t\.is_private[\s\S]{0,100}t\.private_to/.test(pageJsx));
ok('11c: setRecentTicketUpdates receives the FILTERED comments',
  /setRecentTicketUpdates\(filteredComments\)/.test(pageJsx));
ok('11d: dashTickets pull also privacy-filtered',
  /setDashTickets\(filteredTix\)/.test(pageJsx));
ok('11e: REGRESSION GUARD — old unfiltered setDashTickets/setRecentTicketUpdates calls are gone',
  !/setRecentTicketUpdates\(comments \|\| \[\]\)/.test(pageJsx) &&
  !/setDashTickets\(tix \|\| \[\]\)/.test(pageJsx));

// =============================================================
// GAP 6+7 — Defense-in-depth on mutations
// =============================================================
console.log('\nGAP 6+7: Mutation guards');
ok('6a: reassignTicket gates by canSeeTicket as defense-in-depth',
  /const reassignTicket = async \(ticket, newUserId\) => \{[\s\S]{0,300}if \(!canSeeTicket\(ticket\)\) return/.test(tickets));
ok('7a: deleteTicket gates by canSeeTicket as defense-in-depth',
  /const deleteTicket = async \(ticket\) => \{[\s\S]{0,300}if \(!canSeeTicket\(ticket\)\) return/.test(tickets));

// =============================================================
// GAP 12 — Detail modal didn't show privacy chips
// =============================================================
console.log('\nGAP 12: Detail modal privacy chips');
ok('12a: detail modal renders 🔒 PRIVATE chip when sel.is_private',
  /sel\.is_private && \(\s*<span[^>]*bg-sky-100[^>]*>\s*🔒 PRIVATE/.test(tickets));
ok('12b: detail modal renders 🟧 CONFIDENTIAL chip when sel.is_confidential',
  /sel\.is_confidential && \(\s*<span[^>]*bg-orange-100[^>]*>\s*🟧 CONFIDENTIAL/.test(tickets));

// =============================================================
// CARRY-FORWARD verifications from prior turns
// =============================================================
console.log('\nCARRY-FORWARDS');
ok('cf-1: canSeeTicket helper still exists in TicketsTab',
  /const canSeeTicket = \(t\) => \{/.test(tickets));
ok('cf-2: main filtered useMemo still uses canSeeTicket',
  /arr = arr\.filter\(canSeeTicket\)/.test(tickets));
ok('cf-3: closed-tint still wins over privacy tint',
  /t\.status === 'Closed'[\s\S]{0,80}'bg-slate-200 '[\s\S]{0,400}t\.is_private \? 'bg-sky-50 '/.test(tickets));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' test' + (failures.length === 1 ? '' : 's') + ' failed:');
  failures.forEach(function(f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.82-Z QA regression tests passed');
