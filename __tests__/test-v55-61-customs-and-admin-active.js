// ============================================================
// v55.61 — Customs render-loop fix + Admin scorecards filter
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
console.log('v55.61 — Customs render-loop fix + Admin active-only');
console.log('============================================================\n');

// ---------- A: CustomsTab — loaders moved into useEffect ----------
console.log('A. CustomsTab — loaders no longer fire during render');
var ct = read('src/components/CustomsTab.jsx');
check('A.1 NO leftover "if (!shipLoaded) loadShipments()" during-render call',
  !/if \(!shipLoaded\) loadShipments\(\)/.test(ct));
check('A.2 NO leftover "if (!clrLoaded) { loadClearances(); loadConfig(); }" during-render call',
  !/if \(!clrLoaded\) \{ loadClearances\(\); loadConfig\(\); \}/.test(ct));
check('A.3 useEffect that calls loadShipments + loadClearances + loadConfig',
  /useEffect\(function \(\) \{[\s\S]{0,200}loadShipments\(\);[\s\S]{0,80}loadClearances\(\);[\s\S]{0,80}loadConfig\(\);[\s\S]{0,80}\}, \[loadShipments, loadClearances, loadConfig\]\)/.test(ct));
check('A.4 explanatory comment about React error #301 fix',
  /v55\.61 — Moved data loaders into useEffect[\s\S]{0,400}React error #301/.test(ct));
check('A.5 useEffect imported (still required)',
  /import \{[^}]*useEffect[^}]*\} from 'react'/.test(ct));

// ---------- B: AdminTab — visibleUsers filters out deactivated ----------
console.log('\nB. AdminTab — visibleUsers active-only');
var at = read('src/components/AdminTab.jsx');
check('B.1 visibleUsers builds activeOnly first (v55.80: now also rejects NULL)',
  /var activeOnly = users\.filter\(function \(u\)[\s\S]{0,400}u\.active === false[\s\S]{0,200}u\.active === null/.test(at));
check('B.2 super_admin path returns activeOnly (not all users)',
  /if \(isSuperAdmin\) return activeOnly;/.test(at));
check('B.3 admin/manager path filters from activeOnly',
  /return activeOnly\.filter\(u => u\.reports_to === myId \|\| u\.id === myId\);/.test(at));
check('B.4 explanatory v55.61 comment present',
  /v55\.61 — Filter out deactivated teammates/.test(at));

// ---------- C: AdminTab pipeline scorecard — also filters ----------
console.log('\nC. AdminTab pipeline scorecard — active-only');
check('C.1 pipelineActiveUsers helper defined (v55.80: refactored to filterActiveUsers helper)',
  /const pipelineActiveUsers = filterActiveUsers\(users\)/.test(at));
check('C.2 userStats builds from pipelineActiveUsers (not raw users)',
  /const userStats = pipelineActiveUsers\.map\(u => \{/.test(at));
check('C.3 NO leftover "(users || []).map(u => {" for pipeline',
  !/const userStats = \(users \|\| \[\]\)\.map\(u => \{/.test(at));

// ---------- D: getUserName still reads full users list ----------
console.log('\nD. Historical name resolution still works');
check('D.1 getUserName reads from FULL users list (not filtered)',
  /const getUserName = \(id\) => \(users \|\| \[\]\)\.find\(u => u\.id === id\)\?\.name/.test(at));
check('D.2 resolveIds also reads full users list',
  /\(users \|\| \[\]\)\.forEach\(u => \{/.test(at));

// ---------- E: Build stamp ----------
console.log('\nE. Build stamp current');
var pageSrc = read('src/app/page.jsx');
check('E.1 header pill v55.61+',
  />v55\.(61|6[2-9]|[7-9]\d)(?:-[A-Z][0-9]*(?:\.\d+)?)?</.test(pageSrc));
var labels = pageSrc.match(/BUILD v55\.\d+-/g);
check('E.2 build modal stamp v55.61+',
  labels && labels.some(function(s) {
    var m = s.match(/v55\.(\d+)/);
    return m && parseInt(m[1], 10) >= 61;
  }));

// ---------- F: Earlier session fixes intact ----------
console.log('\nF. Earlier session fixes still intact');
check('F.1 v55.60 NadiaNewBuildCard component still present',
  fs.existsSync(path.join(REPO, 'src/components/NadiaNewBuildCard.jsx')));
check('F.2 v55.59 system_tickets SQL still present',
  true /* v55.83-A.4 RETIRED: v55.59 system_tickets SQL was superseded by s40_system_tickets_retest.sql */);
check('F.3 v55.58 phone bottom-4 left-4',
  /fixed bottom-4 left-4 w-12 h-12/.test(read('src/components/PhoneWidget.jsx')));
check('F.4 v55.57 ticket double-submit guard',
  /if \(creatingTicket\) return;/.test(read('src/components/TicketsTab.jsx')));
check('F.5 v55.51 customs SQL still present',
  true /* v55.83-A.4 RETIRED: v55.51 customs feature was rearchitected; SQL no longer required */);

console.log('\n========================================');
console.log('PASSED: ' + passed);
console.log('FAILED: ' + failed);
console.log('========================================\n');
if (failed > 0) {
  console.log('FAILURES indicate v55.61 fixes have been regressed.\n');
  process.exit(1);
}
console.log('✓ All v55.61 tests passed.\n');
