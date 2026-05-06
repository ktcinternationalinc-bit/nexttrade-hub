// ============================================================
// v55.58 — Floating button layout regression
//
// Bug fixed: on mobile, the phone button (📞), voice indicator
// pill, Nadia bubble, FAB (+), and "Synced X ago" pill all sat
// in roughly the same screen corner, overlapping each other.
//
// Final layout:
//   Bottom-LEFT stack (from bottom up):
//     - PhoneWidget 📞 button at bottom-4 left-4
//     - VoiceController pill at bottom: 72, left: 16
//     - Nadia bubble (collapsed) OR panel (expanded) at left: 16,
//       bottom: 124 — both anchored LEFT to keep right side clear
//   Bottom-RIGHT corner:
//     - FAB owns it alone at bottom-20 right-4
//   "Synced X ago" pill: hidden on mobile, visible on desktop only
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
console.log('v55.58 — Floating button layout regression');
console.log('============================================================\n');

// ---------- A: PhoneWidget at bottom-left corner ----------
console.log('A. PhoneWidget at bottom-left corner');
var phoneSrc = read('src/components/PhoneWidget.jsx');
check('A.1 floating button has bottom-4 left-4 (was bottom-6 left-20)',
  /fixed bottom-4 left-4 w-12 h-12 rounded-full bg-green-500/.test(phoneSrc));
check('A.2 v55.58 explanatory comment present',
  /v55\.58 — Floating phone button moved to bottom-left corner/.test(phoneSrc));
check('A.3 NO leftover bottom-6 left-20 reference',
  !/fixed bottom-6 left-20/.test(phoneSrc));

// ---------- B: VoiceController stacks ABOVE phone button ----------
console.log('\nB. VoiceController pushed up to bottom 72');
var voiceSrc = read('src/components/VoiceController.jsx');
check('B.1 position is bottom: 72 left: 16',
  /position: 'fixed', bottom: 72, left: 16/.test(voiceSrc));
check('B.2 v55.58 explanatory comment present',
  /v55\.58 — Was bottom: 16, left: 16/.test(voiceSrc));
check('B.3 NO leftover bottom: 16 left: 16 main position',
  !/position: 'fixed', bottom: 16, left: 16/.test(voiceSrc));

// ---------- C: Nadia bubble + panel both anchored LEFT ----------
console.log('\nC. NadiaFloatingOverlay anchored left, away from FAB');
var nadiaSrc = read('src/components/NadiaFloatingOverlay.jsx');
// v55.59 — bubble moved from bottom: 124 to bottom: 76 since the voice pill
// is hidden now. Accept either position so the test isn't fragile.
check('C.1 collapsed bubble at left: 16, bottom 76 or 124',
  /bottom: (76|124),\s*\n\s*left: 16,\s*\n\s*zIndex: 9998/.test(nadiaSrc));
check('C.2 expanded panel at left: 16, maxWidth 380',
  /position: 'fixed', bottom: (76|124), left: 16, zIndex: 9998, maxWidth: 380/.test(nadiaSrc));
check('C.3 expanded panel width capped to NOT bleed into FAB column',
  /width: 'calc\(100vw - 96px\)'/.test(nadiaSrc));
check('C.4 v55.58 comment about LEFT-side anchoring present',
  /v55\.58 — Moved to LEFT side of screen entirely/.test(nadiaSrc));
check('C.5 NO leftover right: 20 main position',
  !/bottom: 20,\s*\n\s*right: 20,\s*\n\s*zIndex: 9998/.test(nadiaSrc));

// ---------- D: Synced-X-ago pill hidden on mobile ----------
console.log('\nD. Synced X ago pill hidden on mobile');
var pageSrc = read('src/app/page.jsx');
check('D.1 pill has `hidden lg:flex` (was just `flex`)',
  /<div className="hidden lg:flex fixed bottom-4 lg:left-\[220px\] z-30/.test(pageSrc));
check('D.2 v55.58 comment about hiding on mobile present',
  /v55\.58 — Hidden on mobile \(overlapped voice pill \+ phone button on/.test(pageSrc));

// ---------- E: FAB unchanged at bottom-right corner ----------
console.log('\nE. FAB still at bottom-right corner (unchanged)');
check('E.1 FAB at bottom-20 right-4',
  /<div className="fixed bottom-20 right-4 z-40 fab-wrap">/.test(pageSrc));

// ---------- F: Build stamp current ----------
console.log('\nF. Build stamp current');
check('F.1 header pill v55.58+',
  />v55\.(5[8-9]|[6-9]\d)</.test(pageSrc));
var labels = pageSrc.match(/BUILD v55\.\d+-/g);
check('F.2 build modal stamp v55.58+',
  labels && labels.some(function(s) {
    var m = s.match(/v55\.(\d+)/);
    return m && parseInt(m[1], 10) >= 58;
  }));

// ---------- G: Earlier session fixes still intact ----------
console.log('\nG. Earlier session fixes intact (no regression)');
check('G.1 v55.57 ticket double-submit guard still in TicketsTab',
  /if \(creatingTicket\) return;/.test(read('src/components/TicketsTab.jsx')));
check('G.2 v55.56 phone health route present',
  fs.existsSync(path.join(REPO, 'src/app/api/phone/health/route.js')));
check('G.3 v55.55 monthly drill-down still wired',
  /navigate\('sales', \{ from: monthFrom, to: monthTo \}\)/.test(read('src/components/PersonalDashboard.jsx')));
check('G.4 v55.54 SafeSection wraps MyPerformance',
  /<SafeSection label="My Performance">/.test(read('src/components/PersonalDashboard.jsx')));
check('G.5 v55.52 activeUsers helper still in TicketsTab',
  /(const activeUsers = filterActiveUsers\(users\)|const activeUsers = \(users \|\| \[\]\)\.filter\(u => u && u\.active !== false\))/.test(read('src/components/TicketsTab.jsx')));
check('G.6 v55.51 customs SQL file present',
  fs.existsSync(path.join(REPO, 'supabase/customs-phase-1.sql')));

console.log('\n========================================');
console.log('PASSED: ' + passed);
console.log('FAILED: ' + failed);
console.log('========================================\n');
if (failed > 0) {
  console.log('FAILURES indicate the v55.58 floating layout has been regressed.\n');
  process.exit(1);
}
console.log('✓ All v55.58 floating layout tests passed.\n');
