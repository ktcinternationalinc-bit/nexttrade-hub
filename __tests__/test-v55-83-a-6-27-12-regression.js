// v55.83-A.6.27.12 — Regression tests for this round of fixes.
//
// These specifically catch the regressions Max called out:
//   - Send Message + Post Reminder buttons appeared dead (forms were inline
//     4000 lines below the trigger, off-viewport)
//   - Phone had no hang-up button outside callState=active
//   - Nadia leaked financial data to non-Treasury users
//   - Nadia couldn't see closed tickets
//   - Stat tile labels too light/small
//   - Comment previews too small

var fs = require('fs');
var path = require('path');

function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var ab = read('src/components/AssistantsBar.jsx');
var dps = read('src/components/DashboardPrioritySections.jsx');
var ag = read('src/components/AIGreeter.jsx');
var pw = read('src/components/PhoneWidget.jsx');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// ── 1. REGRESSION: Send Message + Post Reminder must work ─────────
// The bug: forms rendered inline DOM 4000 lines below the trigger button,
// so they appeared off-screen. Wrap in fixed centered modal overlays.
ok('1a: Send Message form wrapped in fixed centered modal overlay',
  /showAddAnnouncement && \(\s*<div className="fixed inset-0 bg-black\/60 z-\[300\]/.test(page));
ok('1b: Send Message modal closes on backdrop click',
  /showAddAnnouncement && \([\s\S]{0,500}onClick=\{\(\) => setShowAddAnnouncement\(false\)\}/.test(page));
ok('1c: Send Message modal content stops propagation',
  /<div className="bg-red-50[\s\S]{0,200}onClick=\{\(e\) => e\.stopPropagation\(\)\}/.test(page));
ok('1d: Post Reminder form wrapped in fixed centered modal',
  /showReminderForm && \(isAdmin \|\| modulePerms\?\.\['Post Reminders'\]\) && \(\s*<div className="fixed inset-0 bg-black\/60 z-\[300\]/.test(page));

// ── 2. Stat tile labels readable (per Max "DO NOT USE WHITE") ────
ok('2a: StatCard label text-sm (was text-xs)',
  /<div className="text-sm font-black uppercase tracking-wide text-slate-900">\{props\.label\}<\/div>/.test(ab));
ok('2b: StatCard value text-4xl (was text-3xl)',
  /text-4xl font-black mt-1 leading-none/.test(ab));
ok('2c: Persona role badge has solid bg-white text-slate-900',
  /bg-white text-slate-900 shadow/.test(ab));
ok('2d: regression — role badge no longer bg-white\/30 text-white (low contrast)',
  !/bg-white\/30 backdrop-blur text-white/.test(ab));

// ── 3. Recent Updates comment preview readable ────────────────────
ok('3a: Comment preview uses text-sm (was text-[11px])',
  /text-sm text-slate-900 font-medium/.test(dps));
ok('3b: Comment preview text is slate-900 (not slate-700)',
  !/text-\[11px\] text-slate-700 italic/.test(dps));
ok('3c: Author/time line bumped to text-xs font-semibold',
  /text-xs text-slate-700 font-semibold/.test(dps));

// ── 4. Nadia chat: skip empty bubbles ─────────────────────────────
ok('4a: AIGreeter skips messages with no text/briefing/decision',
  /if \(!hasText && !hasBriefing && !hasDecision && !hasRecordError\) return null/.test(ag));
ok('4b: AIGreeter only renders text bubble when hasText',
  /\{hasText && \(\s*<div className=/.test(ag));

// ── 5. Phone hang-up available in connecting/ringing states ──────
ok('5a: PhoneWidget has cancel button for connecting state',
  /callState === 'connecting' \|\| callState === 'ringing'[\s\S]{0,500}onClick=\{endCall\}/.test(pw));
ok('5b: Cancel button labeled "Cancel"',
  /📵 Cancel/.test(pw));
ok('5c: regression — old text-only Connecting indicator gone',
  !/<div className="mt-2 text-xs text-amber-400 animate-pulse">Connecting\.\.\.<\/div>/.test(pw));

// ── 6. Phone error formatter has actionable hints ────────────────
ok('6a: formatErr hints for code 20101 (AccessTokenInvalid)',
  /e\.code === 20101 \|\| e\.code === '20101'[\s\S]{0,400}TWILIO_API_KEY/.test(pw));
ok('6b: formatErr hints for code 31201 (mic perms)',
  /e\.code === 31201[\s\S]{0,400}Microphone permission denied/.test(pw));

// ── 7. Nadia: closed-ticket access + financial gating ─────────────
ok('7a: AIGreeter builds allMyTickets (open + closed)',
  // A.6.27.12 form: var allMyTickets = (tickets || []).filter(ticketBelongsToMe)
  //   — broken because `tickets` excluded Closed at the server.
  // A.6.27.16 form: allMyTickets is built as a union of openMyTickets + closedMyTickets.
  /var allMyTickets = \(tickets \|\| \[\]\)\.filter\(ticketBelongsToMe\)/.test(ag) ||
  /var allMyTickets = \[\];[\s\S]{0,400}openMyTickets\.forEach[\s\S]{0,300}closedMyTickets\.forEach/.test(ag));
ok('7b: AIGreeter myTickets excludes Closed',
  // A.6.27.12: filter from allMyTickets. A.6.27.16: assigned directly from openMyTickets
  // (because dashTickets is already Closed-free at the server).
  /var myTickets = allMyTickets\.filter\(function \(t\) \{ return t\.status !== 'Closed'; \}\)/.test(ag) ||
  /var myTickets = openMyTickets;/.test(ag));
ok('7c: AIGreeter surfaces recentlyClosed tickets for history queries',
  // A.6.27.12 banner text vs A.6.27.16 banner text
  /Recently CLOSED tickets \(available for history queries; not in active counts\)/.test(ag) ||
  /Closed tickets accessible for history queries/.test(ag));
ok('7d: AIGreeter accepts modulePerms + isSuperAdmin props',
  /modulePerms, isSuperAdmin \}\)/.test(ag));
ok('7e: financial context behind canSeeFinancials gate',
  /var canSeeFinancials = isSuperAdmin[\s\S]{0,400}modulePerms\['View Financial Reports'\] === true/.test(ag));
ok('7f: explicit prohibition message when user lacks Treasury perm',
  /This user does NOT have Treasury or Financial Reports permissions[\s\S]{0,300}DO NOT discuss invoice amounts/.test(ag));
ok('7g: page.jsx passes modulePerms + isSuperAdmin to AIGreeter',
  /<AIGreeter[\s\S]{0,1500}modulePerms=\{modulePerms\} isSuperAdmin=\{isSuperAdmin\}/.test(page));

// ── 8. Version stamp ─────────────────────────────────────────────
ok('8a: version stamp v55.83-A.6.27.12',
  /BUILD v55\.83-A\.6\.27\.1[23456789]/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.12 regression tests passed');
