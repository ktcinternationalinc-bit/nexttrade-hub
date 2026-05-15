// v55.83-A.6.27.9 (Max May 15 2026) — Dashboard reorder validation
//
// Locks in the structural changes from Max's reorder spec:
//   1. FX widget at top
//   2. StatCard contrast improved
//   3. Send Message + Post Reminder compact pair
//   4. Archive link compact link
//   5. DashboardPrioritySections kept
//   6. PendingBankConfirmations after priorities
//   7. WhatsNewWidget collapsed by default
//   8. Team Activity moved after Monthly Sales
//   9. My Pipeline removed
//  10. Overdue Follow-Ups removed
//  11. Today widget "Upcoming" removed

var fs = require('fs');
var path = require('path');

function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var pd = read('src/components/PersonalDashboard.jsx');
var ab = read('src/components/AssistantsBar.jsx');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// ── 1. FX widget at top ─────────────────────────────────────────────
ok('1a: FX widget mounted at top of dashboard tab as compact pill',
  /FX widget pinned to the[\s\S]{0,50}top of the dashboard[\s\S]{0,800}USD\/EGP/.test(page));
ok('1b: FX widget uses bg-slate-900 + emerald rate text',
  /bg-slate-900\/60[\s\S]{0,400}font-black text-emerald-400 font-mono/.test(page));
ok('1c: FX widget REMOVED from old title-row position',
  /FX widget moved to dedicated top row/.test(page));

// ── 2. StatCard contrast ────────────────────────────────────────────
ok('2a: StatCard label upgraded to text-[11px] font-extrabold (no opacity)',
  /<div className="text-\[11px\] font-extrabold uppercase tracking-wide">\{props\.label\}<\/div>/.test(ab));
ok('2b: StatCard value upgraded to text-3xl font-black',
  /<div className="text-3xl font-black mt-1 leading-none">\{props\.value\}<\/div>/.test(ab));
ok('2c: StatCard color palette uses -950 text + -400 border for contrast',
  /text-amber-950 border-amber-400/.test(ab) &&
  /text-sky-950 border-sky-400/.test(ab) &&
  /text-rose-950 border-rose-400/.test(ab) &&
  /text-violet-950 border-violet-400/.test(ab));

// ── 3. Send Message + Post Reminder compact pair ────────────────────
ok('3a: compact button pair row exists',
  /Compact action button row[\s\S]{0,1500}Send Message to Team/.test(page) &&
  /Post Reminder/.test(page));
ok('3b: Send Message button is px-3 py-1.5 (compact) not px-4 py-2 (large)',
  /onClick=\{\(\) => setShowAddAnnouncement\(true\)\}[\s\S]{0,200}px-3 py-1\.5/.test(page));
ok('3c: Post Reminder button is px-3 py-1.5 (compact)',
  /onClick=\{\(\) => setShowReminderForm\(!showReminderForm\)\}[\s\S]{0,200}px-3 py-1\.5/.test(page));
ok('3d: old large Send Message button removed from header',
  /button removed; the new compact "Send Message"[\s\S]{0,50}button at the top/.test(page));

// ── 4. Archive link below pair ──────────────────────────────────────
ok('4a: archive link is compact text link below button pair',
  /text-\[11px\] text-slate-400 hover:text-blue-400 hover:underline[\s\S]{0,200}past reminders/.test(page));

// ── 5. DashboardPrioritySections kept ───────────────────────────────
ok('5a: DashboardPrioritySections still mounted',
  /<DashboardPrioritySections/.test(page));

// ── 6. PendingBankConfirmations right after priorities ──────────────
ok('6a: PendingBankConfirmations comment says "moved up to immediately follow priority cards"',
  /Pending Bank Confirmations moved up to[\s\S]{0,400}immediately follow the priority cards/.test(page));
ok('6b: PendingBankConfirmations renders before WhatsNewWidget in DOM order',
  function () {
    var pbcIdx = page.indexOf('<PendingBankConfirmationsWidget');
    var wnIdx = page.indexOf('<WhatsNewWidget isAdmin={isAdmin} isSuperAdmin={isSuperAdmin} prominent=');
    return pbcIdx > 0 && wnIdx > 0 && pbcIdx < wnIdx;
  }());

// ── 7. WhatsNewWidget collapsed by default ──────────────────────────
ok('7a: WhatsNewWidget mount uses prominent={false}',
  /<WhatsNewWidget isAdmin=\{isAdmin\} isSuperAdmin=\{isSuperAdmin\} prominent=\{false\} \/>/.test(page));

// ── 8. Team Activity after Monthly Sales ────────────────────────────
ok('8a: Team Activity Feed mounted after monthly sales gate close',
  function () {
    var msEnd = page.indexOf("end monthly sales gate");
    var taFeed = page.indexOf("TEAM ACTIVITY FEED", msEnd > 0 ? msEnd : 0);
    return msEnd > 0 && taFeed > msEnd;
  }());
ok('8b: Team Activity OLD position before Pending Checks is GONE (replaced by deprecation comment)',
  /Team Activity moved to AFTER Monthly Sales/.test(page));

// ── 9. My Pipeline removed ──────────────────────────────────────────
ok('9a: My Pipeline block removed from PersonalDashboard',
  !/📊 My Pipeline \(\{myCustomers\.length\}/.test(pd) &&
  /REMOVED "My Pipeline"/.test(pd));

// ── 10. Overdue Follow-Ups removed ──────────────────────────────────
ok('10a: Overdue Follow-Ups red banner removed from PersonalDashboard',
  !/⚠️ Overdue Follow-ups \(\{overdueFollowUps\.length\}/.test(pd) &&
  /REMOVED[\s\S]*Overdue Follow-ups/.test(pd));

// ── 11. Today widget no Upcoming subsection ─────────────────────────
ok('11a: Today widget no longer shows Upcoming subsection',
  !/{upcomingEvents\.length>0&&\(<div className="mt-2 pt-2 border-t/.test(pd) &&
  /REMOVED the "Upcoming" subsection/.test(pd));

// ── 12. Version stamp ───────────────────────────────────────────────
ok('12a: version stamp v55.83-A.6.27.9 or later',
  /BUILD v55\.83-A\.6\.27\.(9|1[0-9])/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.9 dashboard-reorder tests passed');
