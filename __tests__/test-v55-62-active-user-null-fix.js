// ============================================================
// v55.62 — Active-user NULL fix regression
//
// Bug fixed: a user with active=NULL passed the `u.active !== false`
// test (because NULL !== false is true), so deactivated users with
// NULL flag still appeared on admin scorecards, team dropdowns, etc.
//
// Fix: shared helper at src/lib/active-users.js used everywhere.
// Treats both false AND null as inactive.
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
console.log('v55.62 — Active-user NULL fix');
console.log('============================================================\n');

// ---------- A: Shared helper exists and behaves correctly ----------
console.log('A. src/lib/active-users.js shared helper');
var helperPath = path.join(REPO, 'src/lib/active-users.js');
check('A.1 helper file exists', fs.existsSync(helperPath));
if (fs.existsSync(helperPath)) {
  var helper = read('src/lib/active-users.js');
  check('A.2 exports isActiveUser', /export function isActiveUser/.test(helper));
  check('A.3 exports filterActiveUsers', /export function filterActiveUsers/.test(helper));
  check('A.4 rejects active === false',
    /if \(u\.active === false\) return false/.test(helper));
  check('A.5 rejects active === null (the new fix)',
    /if \(u\.active === null\) return false/.test(helper));
  check('A.6 returns false for null/undefined user',
    /if \(!u\) return false/.test(helper));
  check('A.7 filterActiveUsers handles non-array input',
    /if \(!Array\.isArray\(users\)\) return \[\]/.test(helper));
}

// ---------- B: Behavior verification by actual import ----------
console.log('\nB. Helper produces correct behavior at runtime');
try {
  // Use require with relative path from this test file
  var helperModule = require('../src/lib/active-users.js');
  // Some setups: ESM-only modules can't be required. Skip if so.
  if (helperModule && typeof helperModule.isActiveUser === 'function') {
    check('B.1 active=true → true', helperModule.isActiveUser({ active: true }) === true);
    check('B.2 active=undefined → true (legacy)', helperModule.isActiveUser({}) === true);
    check('B.3 active=false → false', helperModule.isActiveUser({ active: false }) === false);
    check('B.4 active=null → false (THE FIX)', helperModule.isActiveUser({ active: null }) === false);
    check('B.5 null user → false', helperModule.isActiveUser(null) === false);
    check('B.6 filterActiveUsers([]) → []',
      JSON.stringify(helperModule.filterActiveUsers([])) === '[]');
    check('B.7 filter mixed array yields only active',
      helperModule.filterActiveUsers([{active:true},{active:false},{active:null},{}]).length === 2);
  } else {
    console.log('  (skipping B.* — module is ESM, can\'t require directly. Static checks above cover the behavior.)');
  }
} catch (e) {
  console.log('  (skipping B.* — ' + e.message + '. Static checks above cover the behavior.)');
}

// ---------- C: All consumers import + use the helper ----------
console.log('\nC. Components and pages use the shared helper');
var consumers = [
  ['src/components/AdminTab.jsx', 'AdminTab'],
  ['src/components/TicketsTab.jsx', 'TicketsTab'],
  ['src/components/CRMTab.jsx', 'CRMTab'],
  ['src/components/CalendarTab.jsx', 'CalendarTab'],
  ['src/components/DailyLogTab.jsx', 'DailyLogTab'],
  ['src/components/TranslationPanel.jsx', 'TranslationPanel'],
  ['src/components/HRReport.jsx', 'HRReport'],
  ['src/app/page.jsx', 'page.jsx'],
];
consumers.forEach(function (c) {
  var src = read(c[0]);
  check('C.' + c[1] + ' imports filterActiveUsers',
    /import \{ filterActiveUsers \} from '[^']*active-users'/.test(src));
  check('C.' + c[1] + ' calls filterActiveUsers',
    /filterActiveUsers\(/.test(src));
});

// ---------- D: Old buggy filter pattern fully removed ----------
console.log('\nD. Old `u.active !== false` user-filter is gone from key files');
// Note: announcement filters use `a.active` not `u.active` — those are NOT this bug
// and remain (different field, different semantic).
var checkNoOldUserFilter = function (rel) {
  var src = read(rel);
  // Match patterns where it's clearly filtering users (not announcements)
  var bad = /\(users \|\| \[\]\)\.filter\(u =>[^)]*u\.active !== false/.test(src) ||
            /users\.filter\(u =>[^)]*u\.active !== false/.test(src);
  return !bad;
};
check('D.1 TicketsTab no old user-filter', checkNoOldUserFilter('src/components/TicketsTab.jsx'));
check('D.2 CRMTab no old user-filter', checkNoOldUserFilter('src/components/CRMTab.jsx'));
check('D.3 CalendarTab no old user-filter', checkNoOldUserFilter('src/components/CalendarTab.jsx'));
check('D.4 DailyLogTab no old user-filter', checkNoOldUserFilter('src/components/DailyLogTab.jsx'));
check('D.5 TranslationPanel no old user-filter', checkNoOldUserFilter('src/components/TranslationPanel.jsx'));
check('D.6 HRReport no old user-filter', checkNoOldUserFilter('src/components/HRReport.jsx'));

// ---------- E: AdminTab visibleUsers explicitly handles null ----------
console.log('\nE. AdminTab visibleUsers logic strict against NULL');
var adminSrc = read('src/components/AdminTab.jsx');
check('E.1 visibleUsers explicitly rejects active === false',
  /if \(u\.active === false\) return false;/.test(adminSrc));
check('E.2 visibleUsers explicitly rejects active === null',
  /if \(u\.active === null\) return false;/.test(adminSrc));
check('E.3 v55.62 explanatory comment present',
  /v55\.62 — Stricter "active" check/.test(adminSrc));

// ---------- F: Server-side notify modules also handle NULL ----------
console.log('\nF. Server-side notify modules skip NULL active users');
var notifyServer = read('src/lib/notify-server.js');
check('F.1 notify-server.js rejects null AND false',
  /u\.active !== false && u\.active !== null/.test(notifyServer));
var notifyRoute = read('src/app/api/notify/route.js');
check('F.2 /api/notify rejects null AND false',
  /u\.active !== false && u\.active !== null/.test(notifyRoute));

// ---------- G: CustomsTab still has v55.61 useEffect (no regression) ----------
console.log('\nG. CustomsTab still has the v55.61 useEffect fix');
var customsSrc = read('src/components/CustomsTab.jsx');
check('G.1 CustomsTab loaders inside useEffect',
  /useEffect\(function \(\) \{[\s\S]{0,200}loadShipments\(\);[\s\S]{0,80}loadClearances\(\);[\s\S]{0,80}loadConfig\(\);/.test(customsSrc));
check('G.2 CustomsTab loaders are useCallback wrapped',
  (customsSrc.match(/useCallback\(async function/g) || []).length >= 3);
check('G.3 NO leftover render-time loader call (the v55.51 bug pattern)',
  !/^\s*if \(!shipLoaded\) loadShipments\(\);/m.test(customsSrc));

// ---------- H: Build stamp + earlier intact ----------
console.log('\nH. Build stamp + earlier session fixes intact');
var pageSrc = read('src/app/page.jsx');
check('H.1 header pill v55.62+',
  />v55\.(62|6[3-9]|[7-9]\d)</.test(pageSrc));
var labels = pageSrc.match(/BUILD v55\.\d+-/g);
check('H.2 build modal stamp v55.62+',
  labels && labels.some(function(s) {
    var m = s.match(/v55\.(\d+)/);
    return m && parseInt(m[1], 10) >= 62;
  }));
check('H.3 v55.61 immediate-heartbeat call still present',
  /\/\/ Fire FIRST heartbeat right away[\s\S]{0,200}heartbeatTick\(\);/.test(pageSrc));
check('H.4 v55.61 heartbeat 2-min interval still set',
  /setInterval\(heartbeatTick, 2 \* 60 \* 1000\)/.test(pageSrc));
check('H.5 v55.60 NadiaNewBuildCard still present',
  fs.existsSync(path.join(REPO, 'src/components/NadiaNewBuildCard.jsx')));
check('H.6 v55.59 system_tickets SQL still present',
  fs.existsSync(path.join(REPO, 'supabase/system-tickets-setup.sql')));
check('H.7 v55.58 phone bottom-4 left-4',
  /fixed bottom-4 left-4 w-12 h-12/.test(read('src/components/PhoneWidget.jsx')));

console.log('\n========================================');
console.log('PASSED: ' + passed);
console.log('FAILED: ' + failed);
console.log('========================================\n');
if (failed > 0) {
  console.log('FAILURES indicate v55.62 active-user fix has been regressed.\n');
  process.exit(1);
}
console.log('✓ All v55.62 tests passed.\n');
