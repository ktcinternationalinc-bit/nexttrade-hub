// ============================================================
// v55.60 — Nadia new-build card + archived-ack + Resend steps
// ============================================================

var fs = require('fs');
var path = require('path');
var REPO = path.resolve(__dirname, '..');
var read = function (rel) { return fs.readFileSync(path.join(REPO, rel), 'utf8'); };

var passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { console.log('✓ ' + label); passed++; }
  else { console.log('✗ ' + label); failed++; }
}

console.log('============================================================');
console.log('v55.60 — Nadia new-build + ack visibility + Resend steps');
console.log('============================================================\n');

// ---------- A: NadiaNewBuildCard component ----------
console.log('A. NadiaNewBuildCard component shipped');
var cardPath = path.join(REPO, 'src/components/NadiaNewBuildCard.jsx');
check('A.1 file exists', fs.existsSync(cardPath));
if (fs.existsSync(cardPath)) {
  var card = read('src/components/NadiaNewBuildCard.jsx');
  check('A.2 imports BUILD_HISTORY from WhatsNewWidget',
    /import \{ BUILD_HISTORY \} from '\.\/WhatsNewWidget'/.test(card));
  check('A.3 reads localStorage to detect seen-build',
    /localStorage\.getItem\(STORAGE_KEY\)/.test(card));
  check('A.4 dismiss persists current version to localStorage',
    /localStorage\.setItem\(STORAGE_KEY, latest\.version\)/.test(card));
  check('A.5 picks top 3 highlights from items',
    /\.items \|\| \[\]\)\.slice\(0, 3\)/.test(card));
  check('A.6 has "Got it" dismiss button',
    /✓ Got it/.test(card));
  check('A.7 displays the build version prominently',
    /\{latest\.version\}/.test(card));
  check('A.8 Nadia robot emoji 🤖',
    /🤖/.test(card));
}

// ---------- B: Mounted on dashboard ----------
console.log('\nB. NadiaNewBuildCard mounted on dashboard');
var pageSrc = read('src/app/page.jsx');
check('B.1 imported in page.jsx',
  /import NadiaNewBuildCard from '\.\.\/components\/NadiaNewBuildCard'/.test(pageSrc));
check('B.2 rendered above PendingNadiaMessages',
  /<NadiaNewBuildCard \/>[\s\S]{0,800}<PendingNadiaMessages/.test(pageSrc));

// ---------- C: Archived announcements — active-only filter ----------
console.log('\nC. Archived announcements filter to active users');
check('C.1 dashboard archived view filters to active users',
  /const activeTeamUsers = \(teamUsers \|\| \[\]\)\.filter\(u => u && u\.active !== false\)/.test(pageSrc));
check('C.2 dashboard archived uses activeTeamUsers for targets',
  /a\.target_user[\s\S]{0,80}activeTeamUsers\.filter\(u => u\.id === a\.target_user\)[\s\S]{0,40}activeTeamUsers/.test(pageSrc));
var adminSrc = read('src/components/AdminTab.jsx');
check('C.3 AdminTab announcements filter to active users',
  /var activeUsers = \(users \|\| \[\]\)\.filter\(u => u && u\.active !== false\);[\s\S]{0,200}var targetUsers = a\.target_user \? activeUsers/.test(adminSrc));

// ---------- D: Archived announcement ack display improved ----------
console.log('\nD. Archived announcement acknowledgment block improved');
check('D.1 dashboard archived has prominent ack pull-out',
  /v55\.60 — Acknowledgment block in archived announcements/.test(pageSrc));
check('D.2 ack pull-out shows "Acknowledgments: X/Y"',
  /Acknowledgments: <span/.test(pageSrc));
check('D.3 ack pull-out shows ALL ACKNOWLEDGED state',
  /ALL ACKNOWLEDGED/.test(pageSrc));
check('D.4 ack pull-out shows "Acknowledged by:" + names',
  /✅ Acknowledged by:/.test(pageSrc));
check('D.5 ack pull-out shows "Not acknowledged:" + names',
  /Not acknowledged:/.test(pageSrc));

// ---------- E: Resend setup instructions inline ----------
console.log('\nE. Resend setup instructions in EmailStatusPanel');
var emailSrc = read('src/components/EmailStatusPanel.jsx');
check('E.1 detects default FROM address',
  /\/onboarding@resend\\\.dev\/i\.test\(status\.from_email\)/.test(emailSrc));
check('E.2 shows step-by-step instructions disclosure',
  /Step-by-step instructions/.test(emailSrc));
check('E.3 instructions mention resend.com/domains',
  /resend\.com\/domains/.test(emailSrc));
check('E.4 instructions mention Bluehost DNS',
  /Bluehost/.test(emailSrc));
check('E.5 instructions mention switching NOTIFICATION_FROM_EMAIL in Vercel',
  /NOTIFICATION_FROM_EMAIL/.test(emailSrc));
check('E.6 hint about asking Claude with screenshot',
  /screenshot of the Resend domain page/.test(emailSrc));

// ---------- F: Build stamp ----------
console.log('\nF. Build stamp current');
check('F.1 header pill v55.60+',
  />v55\.(60|6[1-9]|[7-9]\d)</.test(pageSrc));
var labels = pageSrc.match(/BUILD v55\.\d+-/g);
check('F.2 build modal stamp v55.60+',
  labels && labels.some(function(s) {
    var m = s.match(/v55\.(\d+)/);
    return m && parseInt(m[1], 10) >= 60;
  }));

// ---------- G: Earlier session fixes intact ----------
console.log('\nG. Earlier session fixes intact');
check('G.1 v55.59 system_tickets SQL still present',
  fs.existsSync(path.join(REPO, 'supabase/system-tickets-setup.sql')));
check('G.2 v55.58 phone bottom-4 left-4',
  /fixed bottom-4 left-4 w-12 h-12/.test(read('src/components/PhoneWidget.jsx')));
check('G.3 v55.57 ticket double-submit guard',
  /if \(creatingTicket\) return;/.test(read('src/components/TicketsTab.jsx')));
check('G.4 v55.51 customs SQL still present',
  fs.existsSync(path.join(REPO, 'supabase/customs-phase-1.sql')));

console.log('\n========================================');
console.log('PASSED: ' + passed);
console.log('FAILED: ' + failed);
console.log('========================================\n');
if (failed > 0) {
  console.log('FAILURES indicate v55.60 fixes have been regressed.\n');
  process.exit(1);
}
console.log('✓ All v55.60 tests passed.\n');
